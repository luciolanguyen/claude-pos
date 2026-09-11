import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = process.env.POS_DB || path.join(DATA_DIR, 'pos.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/**
 * Ảnh chụp hàng bảo hành — để ngoài CSDL cho file pos.db khỏi phình to.
 *
 * Thư mục ảnh bám theo TÊN FILE CƠ SỞ DỮ LIỆU, không dùng chung một chỗ.
 * Chạy trên cơ sở dữ liệu thử (POS_DB=test.db) thì ảnh nằm ở warranty-test,
 * nên thao tác xoá sạch lúc kiểm thử không đụng tới ảnh của tiệm.
 */
const DB_NAME = path.basename(DB_PATH, path.extname(DB_PATH));
export const WARRANTY_DIR = path.join(
  DATA_DIR, DB_NAME === 'pos' ? 'warranty' : `warranty-${DB_NAME}`);
if (!fs.existsSync(WARRANTY_DIR)) fs.mkdirSync(WARRANTY_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

/* ------------------------------------------------------------------ */
/* Nâng cấp CSDL đang chạy                                             */
/*                                                                     */
/* CREATE TABLE IF NOT EXISTS chỉ tạo bảng mới, không thêm được cột vào */
/* bảng đã có dữ liệu. Hàm này bổ sung cột còn thiếu, chạy mỗi lần khởi */
/* động và bỏ qua cột đã tồn tại — nên cửa hàng đang dùng cập nhật lên  */
/* bản mới không mất dữ liệu.                                          */
/* ------------------------------------------------------------------ */
function addColumns(table, columns) {
  const have = new Set(
    db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
  );
  for (const [name, ddl] of Object.entries(columns)) {
    if (have.has(name)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
    console.log(`  [nâng cấp] thêm cột ${table}.${name}`);
  }
}

addColumns('products', {
  // Tên phụ: tìm được nhưng không in lên hoá đơn cho khách
  alias: 'TEXT',
  // Hàng tự sản xuất / lắp ráp từ linh kiện
  is_manufactured: 'INTEGER NOT NULL DEFAULT 0',
  // Cách tính giá vốn riêng cho món này: 'average' | 'fixed'.
  // Để trống nghĩa là theo thiết lập chung của tiệm.
  cost_method: 'TEXT',
  // Giá vốn cố định đã được chốt chưa. Lần nhập đầu tiên tự chốt, sau đó
  // giá nhập có đổi cũng không đụng tới nữa; chỉ người dùng sửa tay mới đổi.
  cost_fixed: 'INTEGER NOT NULL DEFAULT 0',
});

addColumns('sale_items', {
  discount_type: "TEXT NOT NULL DEFAULT 'amount'",   // amount | percent
  discount_percent: 'REAL NOT NULL DEFAULT 0',
  note: 'TEXT',                                      // ghi chú riêng cho dòng hàng
  // Bảo hành nhập tay lúc bán; warranty_until tính sẵn để tra cho nhanh
  warranty_months: 'INTEGER NOT NULL DEFAULT 0',
  warranty_until: 'TEXT',
  serial: 'TEXT',
});

/* Phiếu nhập: giá niêm yết của mối và % chiết khấu, để mở lại phiếu vẫn
   thấy được mối báo giá bao nhiêu và bớt mấy phần trăm. Cột price vẫn là
   giá sau chiết khấu — tức giá nhập sau cùng đi vào giá vốn. */
addColumns('purchase_items', {
  list_price: 'INTEGER NOT NULL DEFAULT 0',
  discount_percent: 'REAL NOT NULL DEFAULT 0',
});

/* Linh kiện bảo hành: giá bán cho khách, bên cạnh giá vốn đã có.
   Giá vốn để tính lãi ca sửa, giá bán để in phiếu và thu tiền khách. */
addColumns('warranty_tickets', {
  // Tổng tiền linh kiện tính theo GIÁ BÁN — để in phiếu và tự điền tiền thu
  parts_price: 'INTEGER NOT NULL DEFAULT 0',
});

addColumns('warranty_parts', {
  price: 'INTEGER NOT NULL DEFAULT 0',
  amount_sale: 'INTEGER NOT NULL DEFAULT 0',
});

/* Đổi hàng: nối phiếu trả hàng với hoá đơn hàng mới */
addColumns('sale_returns', {
  exchange_sale_id: 'INTEGER',
});

addColumns('sales', {
  discount_type: "TEXT NOT NULL DEFAULT 'amount'",
  discount_percent: 'REAL NOT NULL DEFAULT 0',
  // Giao hàng
  delivery_name: 'TEXT',
  delivery_phone: 'TEXT',
  delivery_address: 'TEXT',
  carrier_id: 'INTEGER',
  tracking_code: 'TEXT',
  ship_fee: 'INTEGER NOT NULL DEFAULT 0',
  ship_payer: "TEXT NOT NULL DEFAULT 'shop'",        // shop | customer
  cod_amount: 'INTEGER NOT NULL DEFAULT 0',
  delivery_status: 'TEXT',                            // NULL = không giao hàng
  delivery_note: 'TEXT',
  /* Mốc thời gian từng chặng. Một chữ trạng thái không trả lời được
     "đơn này đi mấy ngày rồi", nên phải ghi lại lúc chuyển chặng. */
  shipped_at: 'TEXT',                                 // lúc shipper cầm hàng đi
  delivered_at: 'TEXT',                               // lúc khách nhận được hàng
  collected_at: 'TEXT',                               // lúc tiền về tới tiệm
  shipper_name: 'TEXT',                               // ai cầm hàng đi, ghi tay cũng được
});

/* ------------------- Đợt 13: sáu tài liệu đặc tả POS ------------------- */

/* Mã PIN của quản lý, để duyệt tại chỗ những việc thu ngân không tự làm
   được: giảm giá quá hạn mức, bán nợ vượt hạn mức. Không bao giờ trả ra
   ngoài qua API. */
addColumns('users', { pin: 'TEXT' });

/* Kho hàng lỗi: hàng khách trả mà hỏng thì vào đây, không bán được. */
addColumns('warehouses', { is_defect: 'INTEGER NOT NULL DEFAULT 0' });

/* Nhóm hàng không nhận đổi trả. Đánh dấu ở nhóm cha thì cả nhánh ăn theo. */
addColumns('categories', { no_return: 'INTEGER NOT NULL DEFAULT 0' });

addColumns('sales', {
  /* Người mua hộ: khách chủ hưởng doanh số, người này chỉ đi mua giùm */
  buyer_id: 'INTEGER',
  buyer_name: 'TEXT',
  buyer_phone: 'TEXT',
  /* Thu hộ COD tách khỏi trạng thái giao hàng. Tiền còn ở người giao thì
     là khoản phải thu của đối tác vận chuyển, KHÔNG phải nợ của khách. */
  cod_status: 'TEXT',                          // NULL | pending | collected | cancelled
  cod_collected: 'INTEGER NOT NULL DEFAULT 0',
  shipper_user_id: 'INTEGER',                   // nhân viên tiệm đi giao
  shipper_phone: 'TEXT',                        // shipper tự do
  /* Phiếu đổi hàng dùng để trả tiền — không chạy qua quỹ */
  voucher_amount: 'INTEGER NOT NULL DEFAULT 0',
  /* Ai duyệt bằng mã PIN, và duyệt việc gì */
  approved_by: 'INTEGER',
  approval_note: 'TEXT',
});

addColumns('sale_items', {
  /* Giá niêm yết lúc bán, để soát lại mức giảm giá thật so với bảng giá */
  list_price: 'INTEGER NOT NULL DEFAULT 0',
});

addColumns('sale_returns', {
  refund_method: 'TEXT',                        // cash | transfer | debt | voucher
  voucher_id: 'INTEGER',
  fee_type: "TEXT NOT NULL DEFAULT 'amount'",
  fee_percent: 'REAL NOT NULL DEFAULT 0',
  /* Đổi hàng mà tiền thừa cấn trừ vào nợ cũ: bao nhiêu thì ghi ở đây */
  debt_offset: 'INTEGER NOT NULL DEFAULT 0',
});

addColumns('sale_return_items', {
  sale_item_id: 'INTEGER',                      // dòng nào của hoá đơn gốc
  condition: "TEXT NOT NULL DEFAULT 'good'",  // good | defect
  warehouse_id: 'INTEGER',                      // hàng trả về kho nào
});

/* Số thứ tự "Đơn Hàng X" của hoá đơn tạm, để tab mới không lấy trùng số */
addColumns('draft_sales', { tab_no: 'INTEGER' });

/* Tên chặng giao hàng cũ (đợt 11) gộp tiền vào trạng thái giao. Tài liệu
   mới tách làm hai: chặng giao và tiền thu hộ.

   Chạy MỖI LẦN khởi động, không chỉ một lần theo cờ: cả ba câu chạy lại vô
   hại vì chỉ đụng dòng còn mang tên cũ. Nếu chỉ dựa vào cờ thì cơ sở dữ liệu
   nào đã có cờ mà vẫn còn dòng tên cũ — ví dụ máy chủ bản cũ còn chạy và ghi
   thêm sau khi cờ đã đặt — sẽ kẹt mãi ở tên cũ, bảng theo dõi giao hàng hiện
   đơn đó không có chặng nào. Cờ giữ lại chỉ để biết đã từng nâng cấp. */
{
  db.exec(`UPDATE sales SET cod_status = 'collected', cod_collected = cod_amount
           WHERE delivery_status = 'collected' AND cod_amount > 0 AND cod_status IS NULL`);
  db.exec("UPDATE sales SET delivery_status = 'delivered' WHERE delivery_status = 'collected'");
  db.exec("UPDATE sales SET delivery_status = 'failed' WHERE delivery_status IN ('returned','cancelled')");
  const done = db.prepare("SELECT value FROM settings WHERE key = 'migrated_delivery_v13'").get();
  if (!done) {
    db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES('migrated_delivery_v13', 'true')").run();
  }
}

export const DB_FILE = DB_PATH;

/* ------------------------------------------------------------------ */
/* Helpers truy vấn                                                    */
/* ------------------------------------------------------------------ */

/** Trả về mảng bản ghi thuần (node:sqlite trả object null-prototype). */
export function all(sql, params = []) {
  return db.prepare(sql).all(...params).map((r) => ({ ...r }));
}

export function get(sql, params = []) {
  const row = db.prepare(sql).get(...params);
  return row ? { ...row } : null;
}

export function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

/** Chạy fn trong một transaction. Rollback nếu ném lỗi. */
/* Đếm số lớp tx đang mở. SQLite không cho BEGIN lồng trong BEGIN, nên lớp
   ngoài cùng dùng BEGIN/COMMIT, các lớp trong dùng SAVEPOINT. Nhờ vậy một
   nghiệp vụ lớn (giao hàng cho đơn đặt) gọi lại được nghiệp vụ nhỏ đã có
   sẵn (lập hoá đơn) mà vẫn giữ nguyên tính "được ăn cả, ngã về không". */
let txDepth = 0;

export function tx(fn) {
  const nested = txDepth > 0;
  const sp = `sp${txDepth}`;
  db.exec(nested ? `SAVEPOINT ${sp}` : 'BEGIN');
  txDepth++;
  try {
    const result = fn();
    txDepth--;
    db.exec(nested ? `RELEASE ${sp}` : 'COMMIT');
    return result;
  } catch (err) {
    txDepth--;
    try {
      db.exec(nested ? `ROLLBACK TO ${sp}; RELEASE ${sp}` : 'ROLLBACK');
    } catch { /* đã rollback */ }
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Thiết lập (settings)                                                */
/* ------------------------------------------------------------------ */

export function getSettings() {
  const rows = all('SELECT key, value FROM settings');
  const out = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); }
    catch { out[r.key] = r.value; }
  }
  return out;
}

export function setSetting(key, value) {
  run(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)]
  );
}

/* ------------------------------------------------------------------ */
/* Phân trang                                                          */
/*                                                                     */
/* Bảng hoá đơn, phiếu nhập, sổ quỹ mỗi năm thêm vài nghìn dòng. Đổ hết */
/* một lượt thì máy cũ trong tiệm tải nặng, nên cắt theo trang ngay ở   */
/* câu truy vấn. Chặn trên 200 dòng để một lời gọi lỡ tay không kéo cả  */
/* cơ sở dữ liệu về.                                                   */
/* ------------------------------------------------------------------ */

export const PAGE_SIZES = [10, 20, 50, 100];

export function pageParams(query = {}, defaultSize = 20) {
  const size = Math.min(Math.max(Number(query.page_size) || defaultSize, 1), 200);
  const page = Math.max(Number(query.page) || 1, 1);
  return { page, size, offset: (page - 1) * size };
}

/* ------------------------------------------------------------------ */
/* Cây nhóm hàng                                                       */
/*                                                                     */
/* Nhóm hàng xếp theo hình cây: Ngành hàng > Nhóm > Phân nhóm. Sản     */
/* phẩm luôn gán vào nhóm nhỏ nhất của nhánh đó.                       */
/*                                                                     */
/* Chọn lọc theo một nhóm CẤP TRÊN phải ra cả hàng nằm ở nhóm con —   */
/* chọn "Dây & cáp điện" mà không thấy hàng nào chỉ vì hàng nằm ở      */
/* nhóm cháu thì người dùng tưởng tiệm không có món đó.                */
/* ------------------------------------------------------------------ */

/** Id của một nhóm và TẤT CẢ nhóm con cháu bên dưới nó. */
export function categoryTreeIds(rootId) {
  const id = Number(rootId);
  if (!id) return [];
  const rows = all('SELECT id, parent_id FROM categories');
  const childrenOf = new Map();
  for (const c of rows) {
    const k = c.parent_id || 0;
    if (!childrenOf.has(k)) childrenOf.set(k, []);
    childrenOf.get(k).push(c.id);
  }
  const out = [];
  const stack = [id];
  /* Đi theo chiều rộng, có chặn lặp: dữ liệu hỏng (A là cha của B, B là
     cha của A) sẽ làm vòng lặp chạy mãi và treo máy chủ. */
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    for (const ch of childrenOf.get(cur) || []) stack.push(ch);
  }
  return out;
}

/** Mảnh SQL lọc theo nhóm hàng, đã bao gồm cả nhóm con. */
export function categoryFilter(categoryId, column = 'p.category_id') {
  const ids = categoryTreeIds(categoryId);
  if (!ids.length) return null;
  return { sql: `${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

/**
 * Cả cây nhóm hàng, kèm cấp và đường dẫn đầy đủ.
 * Đường dẫn ("Điện tử › Điện thoại › Smartphone") là thứ hiện ra ở ô lọc
 * và trên thẻ hàng hoá — chỉ hiện mỗi tên lá thì không biết nó nằm đâu.
 */
export function categoryTree() {
  const rows = all('SELECT * FROM categories ORDER BY sort_order, name');
  const byId = new Map(rows.map((c) => [c.id, { ...c, children: [] }]));
  const roots = [];
  for (const c of byId.values()) {
    const parent = c.parent_id ? byId.get(c.parent_id) : null;
    if (parent && parent.id !== c.id) parent.children.push(c);
    else roots.push(c);
  }
  const flat = [];
  const walk = (node, level, trail) => {
    node.level = level;
    node.path = [...trail, node.name].join(' › ');
    node.has_children = node.children.length > 0;
    flat.push(node);
    for (const ch of node.children) walk(ch, level + 1, [...trail, node.name]);
  };
  for (const r of roots) walk(r, 1, []);
  return { roots, flat };
}

/* ------------------------------------------------------------------ */
/* Sinh mã chứng từ: HD250905-0001                                     */
/* ------------------------------------------------------------------ */

export function nextCode(table, prefix) {
  const d = new Date();
  const stamp =
    String(d.getFullYear()).slice(2) +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0');
  const like = `${prefix}${stamp}-%`;
  const row = get(
    `SELECT code FROM ${table} WHERE code LIKE ? ORDER BY code DESC LIMIT 1`,
    [like]
  );
  const seq = row ? parseInt(row.code.split('-').pop(), 10) + 1 : 1;
  return `${prefix}${stamp}-${String(seq).padStart(4, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Kho: ghi biến động tồn + cập nhật tồn hiện tại                      */
/* ------------------------------------------------------------------ */

/**
 * Ghi một biến động kho. qtyChange tính theo ĐƠN VỊ CƠ BẢN.
 * Dương = nhập kho, âm = xuất kho.
 */
export function moveStock({
  productId, warehouseId, qtyChange, unitCost = 0,
  refType, refId = null, refCode = null, note = null, ts = null,
}) {
  const product = get('SELECT track_stock FROM products WHERE id = ?', [productId]);
  if (!product || !product.track_stock) return null;

  run(
    `INSERT INTO stock(product_id, warehouse_id, qty) VALUES(?, ?, 0)
     ON CONFLICT(product_id, warehouse_id) DO NOTHING`,
    [productId, warehouseId]
  );
  run(
    'UPDATE stock SET qty = qty + ? WHERE product_id = ? AND warehouse_id = ?',
    [qtyChange, productId, warehouseId]
  );
  const bal = get(
    'SELECT qty FROM stock WHERE product_id = ? AND warehouse_id = ?',
    [productId, warehouseId]
  );

  const moveInfo = run(
    `INSERT INTO stock_moves(ts, product_id, warehouse_id, qty_change, balance, unit_cost, ref_type, ref_id, ref_code, note)
     VALUES(COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [ts, productId, warehouseId, qtyChange, bal.qty, Math.round(unitCost), refType, refId, refCode, note]
  );

  /* { balance, moveId } chứ không phải mỗi con số tồn: phiếu cân bằng kho
     cần giữ lại số thẻ để sau này tra ngược "tồn bị sửa lúc nào, theo
     phiếu nào". Đổi được kiểu trả về vì không chỗ nào đang dùng nó. */
  return { balance: bal.qty, moveId: Number(moveInfo.lastInsertRowid) };
}

/* ------------------------------------------------------------------ *
 * GIÁ VỐN
 *
 * Hai cách tính, chọn ở Thiết lập cho cả tiệm, đổi riêng được từng món:
 *
 *  - bình quân (average): mỗi lần nhập hàng thì bình quân gia quyền lại
 *    theo số đang tồn; trả hàng cho nhà cung cấp thì rút phần đó ra.
 *    Giá vốn bám sát giá thị trường, hợp với hàng hay đổi giá như dây
 *    điện, cáp.
 *
 *  - cố định (fixed): chốt một lần rồi thôi. Lần nhập đầu tiên tự lấy giá
 *    nhập làm giá vốn; sau đó giá nhập lên xuống cũng không đụng tới, chỉ
 *    người dùng sửa tay mới đổi. Hợp với hàng giá ổn định, và với chủ
 *    tiệm muốn con số lãi nhìn cho dễ hiểu.
 *
 * Đổi phương pháp giữa chừng KHÔNG tính lại lịch sử: giá vốn đang có giữ
 * nguyên, cách mới chỉ ăn từ lần nhập kế tiếp. Làm vậy để lãi lỗ của các
 * hoá đơn đã xuất không bị đổi số sau lưng.
 * ------------------------------------------------------------------ */

export const COST_METHODS = {
  average: 'Bình quân gia quyền',
  fixed: 'Cố định',
};

/** Cách tính giá vốn thực sự áp dụng cho một mặt hàng. */
export function costMethodOf(product) {
  const own = product?.cost_method;
  if (own === 'average' || own === 'fixed') return own;
  const shop = getSettings()?.cost_method;
  return shop === 'fixed' ? 'fixed' : 'average';
}

/**
 * Cập nhật giá vốn khi NHẬP hàng. newUnitCost tính theo đơn vị cơ bản.
 * Trả về giá vốn mới, hoặc null nếu không đổi gì.
 */
export function updateAvgCost(productId, inQtyBase, newUnitCost) {
  if (inQtyBase <= 0) return null;
  const p = get('SELECT cost_price, cost_method, cost_fixed FROM products WHERE id = ?', [productId]);
  if (!p) return null;

  if (costMethodOf(p) === 'fixed') {
    // Đã chốt rồi thì thôi. Chưa chốt thì lần nhập này là lần đầu.
    if (p.cost_fixed) return null;
    const v = Math.round(newUnitCost);
    run('UPDATE products SET cost_price = ?, cost_fixed = 1 WHERE id = ?', [v, productId]);
    return v;
  }

  // Bình quân gia quyền theo số đang tồn SAU khi đã cộng hàng mới vào
  const totalQty = get(
    'SELECT COALESCE(SUM(qty), 0) AS q FROM stock WHERE product_id = ?',
    [productId]
  ).q;
  const oldQty = totalQty - inQtyBase;
  const avg = oldQty > 0
    ? (oldQty * p.cost_price + inQtyBase * newUnitCost) / totalQty
    : newUnitCost;
  const v = Math.round(avg);
  run('UPDATE products SET cost_price = ? WHERE id = ?', [v, productId]);
  return v;
}

/**
 * Cập nhật giá vốn khi TRẢ hàng lại cho nhà cung cấp — rút lô hàng đó ra
 * khỏi bình quân. outQtyBase và returnUnitCost tính theo đơn vị cơ bản.
 *
 * Giá vốn cố định thì không đụng tới: đã chốt là chốt.
 */
export function reverseAvgCost(productId, outQtyBase, returnUnitCost) {
  if (outQtyBase <= 0) return null;
  const p = get('SELECT cost_price, cost_method, cost_fixed FROM products WHERE id = ?', [productId]);
  if (!p) return null;
  if (costMethodOf(p) === 'fixed') return null;

  // Số tồn TRƯỚC khi trả = số tồn hiện tại + số vừa trả đi
  const totalQty = get(
    'SELECT COALESCE(SUM(qty), 0) AS q FROM stock WHERE product_id = ?',
    [productId]
  ).q;
  const before = totalQty + outQtyBase;
  const left = before - outQtyBase;
  // Trả hết sạch, hoặc số liệu không hợp lệ thì giữ nguyên giá vốn cũ —
  // thà giữ con số cũ còn hơn cho ra một con số âm hay bằng 0 vô nghĩa.
  if (left <= 0) return null;
  const rest = before * p.cost_price - outQtyBase * returnUnitCost;
  if (rest <= 0) return null;
  const v = Math.round(rest / left);
  run('UPDATE products SET cost_price = ? WHERE id = ?', [v, productId]);
  return v;
}

/** Giá vốn hiện tại theo đơn vị cơ bản. */
export function costOf(productId) {
  const p = get('SELECT cost_price FROM products WHERE id = ?', [productId]);
  return p ? p.cost_price : 0;
}

/* ------------------------------------------------------------------ */
/* Quỹ tiền                                                            */
/* ------------------------------------------------------------------ */

/** Ghi một phiếu thu/chi. direction: 'in' (thu) | 'out' (chi). */
export function addCashTx({
  accountId, direction, amount, category,
  partnerType = null, partnerId = null, partnerName = null,
  refType = null, refId = null, refCode = null,
  userId = null, note = null, ts = null,
}) {
  if (!amount || amount <= 0) return null;
  const code = nextCode('cash_transactions', direction === 'in' ? 'PT' : 'PC');
  const info = run(
    `INSERT INTO cash_transactions
      (code, ts, account_id, direction, amount, category, partner_type, partner_id, partner_name,
       ref_type, ref_id, ref_code, user_id, note)
     VALUES(?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [code, ts, accountId, direction, Math.round(amount), category, partnerType, partnerId,
      partnerName, refType, refId, refCode, userId, note]
  );
  return { id: Number(info.lastInsertRowid), code };
}

/** Số dư của một quỹ = số dư đầu kỳ + thu - chi. */
export function accountBalance(accountId) {
  const acc = get('SELECT opening_balance FROM cash_accounts WHERE id = ?', [accountId]);
  if (!acc) return 0;
  const t = get(
    `SELECT
       COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount END), 0) AS tin,
       COALESCE(SUM(CASE WHEN direction = 'out' THEN amount END), 0) AS tout
     FROM cash_transactions WHERE account_id = ?`,
    [accountId]
  );
  return acc.opening_balance + t.tin - t.tout;
}

/** Quỹ tiền mặt mặc định (dùng khi POS thanh toán tiền mặt). */
export function defaultCashAccount(type = 'cash') {
  const acc = get(
    'SELECT id FROM cash_accounts WHERE type = ? AND active = 1 ORDER BY sort_order, id LIMIT 1',
    [type]
  );
  return acc ? acc.id : null;
}

/* ------------------------------------------------------------------ */
/* Công nợ                                                             */
/* ------------------------------------------------------------------ */

/** Công nợ khách hàng = nợ đầu kỳ + (bán chưa thu) - (trả hàng chưa hoàn) - (thu nợ). */
/**
 * Số tiền KHÁCH còn nợ trên một hoá đơn (dùng trong câu SQL).
 *
 *   - giao hàng thất bại: hàng quay về tiệm, khách không nợ gì;
 *   - phần COD người giao chưa nộp về: đó là khoản phải thu của đối tác
 *     vận chuyển, KHÔNG phải nợ của khách. Tính nó là nợ khách thì khách
 *     lẻ không bao giờ đặt giao COD được, và cuối tháng tiệm đi đòi nhầm
 *     người một khoản khách đã trả tận tay shipper.
 */
export const saleOwedSql = (a = 's') => `MAX(0, CASE
    WHEN ${a}.delivery_status = 'failed' THEN 0
    ELSE ${a}.total - ${a}.paid
       - CASE WHEN ${a}.cod_status = 'pending' THEN ${a}.cod_amount - ${a}.cod_collected ELSE 0 END
  END)`;

/**
 * Phần trả hàng được trừ vào nợ (dùng trong câu SQL).
 *
 *   - cấp phiếu đổi hàng: giá trị nằm ở phiếu, KHÔNG trừ nợ thêm;
 *   - đổi hàng lấy món khác: phần đã bù vào hoá đơn mới không được trừ nợ
 *     lần nữa — chỉ phần tiệm cấn trừ vào nợ cũ (debt_offset) mới tính.
 *
 * Trước đợt 13 chỗ đổi hàng tính HAI LẦN với khách có tên: đổi món 300
 * nghìn lấy món 500 nghìn thì nợ bị ghi thấp đi 300 nghìn so với thật.
 * Công thức này sửa luôn cả các phiếu đổi hàng cũ.
 */
export const returnCreditSql = (a = 'sr') => `(CASE
    WHEN ${a}.refund_method = 'voucher' THEN 0
    WHEN ${a}.exchange_sale_id IS NOT NULL THEN ${a}.debt_offset
    ELSE ${a}.total - ${a}.refunded
  END)`;

export function customerDebt(customerId) {
  const c = get('SELECT opening_debt FROM customers WHERE id = ?', [customerId]);
  if (!c) return 0;
  const s = get(
    `SELECT COALESCE(SUM(${saleOwedSql('s')}), 0) AS d FROM sales s
     WHERE s.customer_id = ? AND s.status = 'done'`,
    [customerId]
  ).d;
  const r = get(
    `SELECT COALESCE(SUM(${returnCreditSql('sr')}), 0) AS d FROM sale_returns sr WHERE sr.customer_id = ?`,
    [customerId]
  ).d;
  const paid = get(
    `SELECT
       COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount END), 0) -
       COALESCE(SUM(CASE WHEN direction = 'out' THEN amount END), 0) AS d
     FROM cash_transactions
     WHERE partner_type = 'customer' AND partner_id = ? AND category IN ('debt_in','debt_out')`,
    [customerId]
  ).d;
  return c.opening_debt + s - r - paid;
}

/** Công nợ nhà cung cấp = nợ đầu kỳ + (nhập chưa trả) - (trả hàng chưa nhận) - (đã trả nợ). */
export function supplierDebt(supplierId) {
  const s = get('SELECT opening_debt FROM suppliers WHERE id = ?', [supplierId]);
  if (!s) return 0;
  const p = get(
    `SELECT COALESCE(SUM(total - paid), 0) AS d FROM purchases
     WHERE supplier_id = ? AND status = 'done'`,
    [supplierId]
  ).d;
  const r = get(
    `SELECT COALESCE(SUM(total - refunded), 0) AS d FROM purchase_returns WHERE supplier_id = ?`,
    [supplierId]
  ).d;
  const paid = get(
    `SELECT
       COALESCE(SUM(CASE WHEN direction = 'out' THEN amount END), 0) -
       COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount END), 0) AS d
     FROM cash_transactions
     WHERE partner_type = 'supplier' AND partner_id = ? AND category IN ('debt_in','debt_out')`,
    [supplierId]
  ).d;
  return s.opening_debt + p - r - paid;
}

/* ------------------------------------------------------------------ */
/* Nhật ký                                                             */
/* ------------------------------------------------------------------ */

export function logActivity(user, action, entity, entityId, detail) {
  run(
    `INSERT INTO activity_log(user_id, user_name, action, entity, entity_id, detail)
     VALUES(?, ?, ?, ?, ?, ?)`,
    [user?.id ?? null, user?.full_name ?? 'Hệ thống', action, entity, entityId, detail]
  );
}
