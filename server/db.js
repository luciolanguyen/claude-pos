import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = process.env.POS_DB || path.join(DATA_DIR, 'pos.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/** Ảnh chụp hàng bảo hành — để ngoài CSDL cho file pos.db khỏi phình to. */
export const WARRANTY_DIR = path.join(DATA_DIR, 'warranty');
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
});

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

  run(
    `INSERT INTO stock_moves(ts, product_id, warehouse_id, qty_change, balance, unit_cost, ref_type, ref_id, ref_code, note)
     VALUES(COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [ts, productId, warehouseId, qtyChange, bal.qty, Math.round(unitCost), refType, refId, refCode, note]
  );
  return bal.qty;
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
export function customerDebt(customerId) {
  const c = get('SELECT opening_debt FROM customers WHERE id = ?', [customerId]);
  if (!c) return 0;
  const s = get(
    `SELECT COALESCE(SUM(total - paid), 0) AS d FROM sales
     WHERE customer_id = ? AND status = 'done'`,
    [customerId]
  ).d;
  const r = get(
    `SELECT COALESCE(SUM(total - refunded), 0) AS d FROM sale_returns WHERE customer_id = ?`,
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
