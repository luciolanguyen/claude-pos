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

/* Ảnh hàng hoá (tài liệu 13, mục 1.4) — cùng cách bám tên CSDL như ảnh bảo hành */
export const PRODUCT_DIR = path.join(
  DATA_DIR, DB_NAME === 'pos' ? 'products' : `products-${DB_NAME}`);
if (!fs.existsSync(PRODUCT_DIR)) fs.mkdirSync(PRODUCT_DIR, { recursive: true });

/* Ảnh phiếu ứng lương có chữ ký (plan 28, §7.2) — cùng cách bám tên CSDL */
export const PAYROLL_DIR = path.join(
  DATA_DIR, DB_NAME === 'pos' ? 'payroll' : `payroll-${DB_NAME}`);
if (!fs.existsSync(PAYROLL_DIR)) fs.mkdirSync(PAYROLL_DIR, { recursive: true });

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

/* ------------------- Đợt 14: năm tài liệu đặc tả tiếp theo ------------------- */

/* Hồ sơ khách gộp công nợ (tài liệu 08): loại khách, và số ngày nợ tối đa
   riêng từng khách. Để trống max_debt_days = theo chính sách chung của tiệm;
   ghi 0 = khách này không giới hạn số ngày. */
addColumns('customers', {
  customer_type: "TEXT NOT NULL DEFAULT 'member'",   // member | vip | wholesale
  max_debt_days: 'INTEGER',
});

/* Phiếu chi trả nợ NCC ghi lại chuyển vào tài khoản nào của NCC (tài liệu 10) */
addColumns('cash_transactions', { counterparty_account: 'TEXT' });

/* Trả hàng NCC (tài liệu 11): dòng nào của phiếu nhập gốc, chi phí trả hàng */
addColumns('purchase_return_items', { purchase_item_id: 'INTEGER' });
addColumns('purchase_returns', {
  expense: 'INTEGER NOT NULL DEFAULT 0',
  expense_note: 'TEXT',
  mode: "TEXT NOT NULL DEFAULT 'free'",             // by_purchase | free
});

/* Trả hàng NCC — ai trả / ai chịu chi phí, và trạng thái theo dõi (plan 31, đợt 5).
 *
 * Chủ tiệm chốt: công nợ NCC CHỈ giảm khi NCC đã nhận hàng trả. Phiếu lập
 * trước đợt này coi như đã gửi và NCC đã nhận — đánh dấu MỘT LẦN lúc thêm
 * cột, để số nợ NCC đang có không nhảy sau khi nâng cấp. */
{
  const hadStatus = db.prepare('PRAGMA table_info(purchase_returns)').all()
    .some((c) => c.name === 'received_at');
  addColumns('purchase_returns', {
    expense_payer: "TEXT NOT NULL DEFAULT 'supplier'",  // ai đưa tiền trước: shop | supplier
    expense_bearer: "TEXT NOT NULL DEFAULT 'shop'",     // ai chịu: shop | supplier | split
    expense_shop: 'INTEGER NOT NULL DEFAULT 0',         // phần tiệm chịu (phần còn lại NCC chịu)
    expense_cash_tx_id: 'INTEGER',                      // phiếu chi tiền xe khi tiệm trả trước
    settle_method: "TEXT NOT NULL DEFAULT 'offset'",    // offset: cấn trừ công nợ · refund: NCC hoàn tiền
    sent_at: 'TEXT',                                    // đã gửi hàng đi
    received_at: 'TEXT',                                // NCC xác nhận đã nhận — từ lúc này mới trừ nợ
    issue_note: 'TEXT',                                 // trục trặc: NCC chê hàng, thiếu, hỏng thêm…
    issue_resolved_at: 'TEXT',
  });
  if (!hadStatus) {
    db.exec(`UPDATE purchase_returns
             SET sent_at = ts, received_at = ts, expense_shop = expense,
                 settle_method = CASE WHEN refunded > 0 THEN 'refund' ELSE 'offset' END`);
  }
}

/* Ngày cập nhật giá vốn gần nhất (plan 31, hạng mục 1.4b). Giá vốn đổi ở sáu
   chỗ (bình quân khi nhập, trả NCC, sửa tay, sản xuất, nhập Excel…) nên ghi
   bằng trigger — không đường nào lọt, khỏi vá từng chỗ. */
{
  const hadCostDate = db.prepare('PRAGMA table_info(products)').all().some((c) => c.name === 'cost_updated_at');
  addColumns('products', { cost_updated_at: 'TEXT' });
  /* Nâng cấp lần đầu: hàng có sẵn chưa có ngày nào. Lấy tạm ngày nhập hàng gần
     nhất — giá vốn bình quân được tính lại đúng lúc đó; chưa nhập lần nào thì
     để trống, thà không hiện còn hơn hiện một ngày bịa. */
  if (!hadCostDate) {
    db.exec(`UPDATE products SET cost_updated_at = (
               SELECT MAX(pu.ts) FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
               WHERE pi.product_id = products.id AND pu.status = 'done')
             WHERE cost_price > 0`);
  }
}
db.exec(`CREATE TRIGGER IF NOT EXISTS trg_products_cost_upd
         AFTER UPDATE OF cost_price ON products
         WHEN NEW.cost_price IS NOT OLD.cost_price
         BEGIN
           UPDATE products SET cost_updated_at = datetime('now','localtime') WHERE id = NEW.id;
         END`);
db.exec(`CREATE TRIGGER IF NOT EXISTS trg_products_cost_ins
         AFTER INSERT ON products
         WHEN NEW.cost_updated_at IS NULL AND NEW.cost_price > 0
         BEGIN
           UPDATE products SET cost_updated_at = datetime('now','localtime') WHERE id = NEW.id;
         END`);

/* ------------------------------------------------------------------ */
/* Mã vạch tự sinh (plan 30, P1)                                        */
/* ------------------------------------------------------------------ */
/**
 * Dựng sổ đăng ký mã vạch và hai bộ đếm. Chạy mỗi lần khởi động, và chạy lại
 * sau khi khôi phục một file sao lưu cũ chưa có hai bảng này — thiếu bộ đếm
 * là tạo hàng mới hỏng ngay.
 */
export function ensureBarcodeRegistry() {
  /* Mã vạch có dấu cách thừa hai đầu thì máy quét không bao giờ khớp; ô trống
     thì coi như không có mã */
  db.exec(`UPDATE products SET barcode = NULLIF(TRIM(barcode), '') WHERE barcode IS NOT NULL AND barcode <> TRIM(barcode) OR barcode = ''`);
  db.exec(`UPDATE product_units SET barcode = NULLIF(TRIM(barcode), '') WHERE barcode IS NOT NULL AND barcode <> TRIM(barcode) OR barcode = ''`);

  /* Bộ đếm mã tự sinh: máy mới đếm từ 1. Dựng lại sau khi khôi phục một file sao
     lưu thiếu bộ đếm thì phải nối tiếp SAU mã 828… lớn nhất đang có, kẻo cấp đè */
  db.exec(`INSERT OR IGNORE INTO barcode_counter(name, next_value, prefix, width)
           SELECT 'product', COALESCE(MAX(CAST(SUBSTR(code, 4) AS INTEGER)), 0) + 1, '828', 7
           FROM (SELECT barcode AS code FROM products UNION ALL SELECT barcode FROM product_units
                 UNION ALL SELECT code FROM barcodes)
           WHERE code GLOB '828[0-9][0-9][0-9][0-9][0-9][0-9][0-9]'`);
  /* Mã hàng SP… tự đặt: bắt đầu sau số lớn nhất đang có, từ đó chỉ tiến */
  db.exec(`INSERT OR IGNORE INTO barcode_counter(name, next_value, prefix, width)
           SELECT 'sku', COALESCE(MAX(CAST(SUBSTR(sku, 3) AS INTEGER)), 0) + 1, 'SP', 5
           FROM products WHERE sku GLOB 'SP[0-9]*' AND SUBSTR(sku, 3) NOT GLOB '*[^0-9]*'`);

  /* Nạp mọi mã đang có vào sổ đăng ký. Mã đang bị HAI chỗ cùng giữ thì KHÔNG
     nạp và không tự chọn giữ cái nào — chủ tiệm xem danh sách ở Thiết lập rồi
     quyết từng mã (plan 30, §11.1, chủ tiệm chốt). Chạy mỗi lần khởi động
     nhưng INSERT OR IGNORE nên vô hại. */
  const heldBy = `(SELECT COUNT(*) FROM products x WHERE x.barcode = c.code)
                + (SELECT COUNT(*) FROM product_units y WHERE y.barcode = c.code)`;
  db.exec(`INSERT OR IGNORE INTO barcodes(code, owner_type, owner_id, last_owner_id, source, note)
           SELECT c.code, 'product', c.id, c.id, 'manual', 'nạp từ dữ liệu có sẵn'
           FROM (SELECT barcode AS code, id FROM products WHERE barcode IS NOT NULL) c
           WHERE ${heldBy} = 1`);
  db.exec(`INSERT OR IGNORE INTO barcodes(code, owner_type, owner_id, last_owner_id, source, note)
           SELECT c.code, 'product_unit', c.id, c.id, 'manual', 'nạp từ dữ liệu có sẵn'
           FROM (SELECT barcode AS code, id FROM product_units WHERE barcode IS NOT NULL) c
           WHERE ${heldBy} = 1`);

  /* Chặn trùng ngay ở cơ sở dữ liệu — chỉ tạo được khi dữ liệu đã sạch trùng */
  const dup = (table) => db.prepare(`SELECT COUNT(*) AS n FROM (SELECT barcode FROM ${table}
                                     WHERE barcode IS NOT NULL GROUP BY barcode HAVING COUNT(*) > 1)`).get().n;
  if (!dup('products')) {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_products_barcode ON products(barcode) WHERE barcode IS NOT NULL');
  }
  if (!dup('product_units')) {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_units_barcode ON product_units(barcode) WHERE barcode IS NOT NULL');
  }
}
ensureBarcodeRegistry();

/* Bảo hành (plan 31, đợt 6): món thuộc phiếu tiếp nhận gom nào (3a), và
   khách báo hư bộ phận nào khi mặt hàng bảo hành riêng từng bộ phận (3e) */
addColumns('warranty_tickets', { batch_id: 'INTEGER', component_name: 'TEXT' });
db.exec('CREATE INDEX IF NOT EXISTS idx_wt_batch ON warranty_tickets(batch_id)');

/* Phân bổ VAT vào giá nhập (plan 31, 5.1d). Chỉ phiếu nhập MỚI có tích mới
   tính khác — phiếu cũ mặc định 0 / after_vat, đúng như cách đã tính xưa nay,
   không phiếu nào bị tính lại. Mỗi dòng ghi luôn thuế, phần chiết khấu và giá
   vốn đã đi vào kho, để mở lại phiếu còn đối chiếu được. NCC nhớ lựa chọn lần
   trước để lần sau nhập của mối đó tự tích sẵn. */
addColumns('purchases', {
  vat_in_cost: 'INTEGER NOT NULL DEFAULT 0',
  discount_mode: "TEXT NOT NULL DEFAULT 'after_vat'",   // after_vat | before_vat
});
addColumns('purchase_items', { line_vat: 'INTEGER', discount_share: 'INTEGER', cost_unit: 'INTEGER' });
addColumns('suppliers', { vat_in_cost: 'INTEGER NOT NULL DEFAULT 0', vat_discount_mode: 'TEXT' });

/* Mua hàng trừ vào lương nhân viên (plan 28, §6). Là TIỀN TRẢ BẰNG CÁCH KHÁC,
   không phải giảm giá: ghi vào discount thì sai căn cứ tính VAT và thổi phồng
   báo cáo giảm giá. Phần này cộng vào paid nên không thành nợ của khách, và
   không sinh phiếu thu vì không có đồng nào vào két. */
addColumns('sales', {
  salary_amount: 'INTEGER NOT NULL DEFAULT 0',
  salary_employee_id: 'INTEGER',
});
/* Trả hàng của hoá đơn trừ lương: hoàn lại vào lương, không chi tiền, không trừ nợ */
addColumns('sale_returns', { salary_refund: 'INTEGER NOT NULL DEFAULT 0' });

/* Chốt lương sớm theo ngày làm thực tế (BRD nâng cấp, mục 6): kỳ bị cắt làm hai,
   phần còn lại của kỳ mang sẵn số tiền phải trả nốt để cả kỳ vẫn đủ lương tháng. */
addColumns('payroll_cycles', { base_override: 'INTEGER', split_of: 'INTEGER' });

/* Mức hoa hồng mặc định của từng chủ hàng (BRD nâng cấp, mục 5): thu ngân không
   được thấy và không gõ hoa hồng nữa, nên máy chủ lấy mức đã thoả thuận sẵn ở
   hồ sơ chủ hàng; quản lý sửa lại sau nếu cần. */
addColumns('consign_partners', {
  commission_type: "TEXT NOT NULL DEFAULT 'percent'",
  commission_value: 'REAL NOT NULL DEFAULT 0',
});
/* Dòng hàng mua hộ còn CHỜ QUẢN LÝ khai hoa hồng / giá bốc — thu ngân bán xong
   là dòng này sáng đèn ở màn hình Hoá đơn và Đối tác vãng lai. */
addColumns('sale_consign_items', { needs_review: 'INTEGER NOT NULL DEFAULT 0' });

/* Đối tác vãng lai: trả tiền nhiều lần (BRD nâng cấp, mục 4). Trước đây mỗi đợt
   chốt chỉ có MỘT phiếu chi, trả thiếu là không ghi được. paid là tổng đã trả,
   cộng dồn từ bảng consign_payments. */
addColumns('consign_settlements', { paid: 'INTEGER NOT NULL DEFAULT 0' });
/* Đợt cũ đã chi đủ một lần: coi như đã trả hết, để số "còn nợ chủ hàng" không sai */
db.exec(`UPDATE consign_settlements SET paid = payout WHERE cash_tx_id IS NOT NULL AND paid = 0`);

/* Đơn đặt hàng: món thiếu tồn phải đặt thêm của NCC (BRD nâng cấp, mục 2).
   po_qty là số ĐÃ ĐẶT của mối, tính theo đúng đơn vị của dòng đơn — đặt được
   một phần thì ghi đúng phần đó, đơn vẫn nằm ở nhóm "còn thiếu". */
addColumns('sale_order_items', {
  po_qty: 'REAL NOT NULL DEFAULT 0',
  po_at: 'TEXT',
  po_note: 'TEXT',
  po_user_id: 'INTEGER',
});

/* Đặt hàng (tài liệu 12): ai đưa cọc, đợt giao là khách tự lấy hay giao đi */
addColumns('sale_order_deposits', { payer_name: 'TEXT' });
addColumns('sale_order_deliveries', { mode: "TEXT NOT NULL DEFAULT 'pickup'" });

/* Bảo hành và sửa chữa (tài liệu 09) */
addColumns('products', {
  warranty_months: 'INTEGER NOT NULL DEFAULT 0',    // bảo hành mặc định khi bán
  warranty_note: 'TEXT',                            // điều kiện bảo hành
});
addColumns('sale_items', { warranty_note: 'TEXT' });
addColumns('warranty_tickets', {
  ticket_type: "TEXT NOT NULL DEFAULT 'warranty'",  // warranty | repair
  discount: 'INTEGER NOT NULL DEFAULT 0',           // miễn giảm cho khách
  custom_parts_price: 'INTEGER NOT NULL DEFAULT 0', // linh kiện mua ngoài
  fees_total: 'INTEGER NOT NULL DEFAULT 0',         // phí phát sinh khác
  technician_id: 'INTEGER',
  exchange_mode: 'TEXT',                            // inherit | reset
  exchange_warranty_until: 'TEXT',
  exchange_serial: 'TEXT',
  exchange_qty: 'REAL',
});
addColumns('warranty_parts', {
  list_price: 'INTEGER NOT NULL DEFAULT 0',         // giá niêm yết lúc thêm
  /* Linh kiện giữ trên phiếu, chỉ trừ kho khi hoàn thành. Dòng của phiếu cũ
     đã trừ kho từ lúc thêm nên mặc định 1 — không trừ lần nữa. */
  stock_applied: 'INTEGER NOT NULL DEFAULT 1',
  approved_by: 'INTEGER',                           // ai duyệt giá dưới giá vốn
});
db.exec('CREATE INDEX IF NOT EXISTS idx_pri_pitem ON purchase_return_items(purchase_item_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_customers_type ON customers(customer_type)');

/* Chuyển số điện thoại và tài khoản ngân hàng đang ghi một ô chữ sang bảng
   nhiều dòng. Chạy mỗi lần khởi động nhưng chỉ đụng NCC chưa có dòng nào,
   nên chạy lại vô hại; NCC đã xoá hết số thì ô chữ cũng đã được xoá theo. */
db.exec(`INSERT INTO supplier_phones(supplier_id, phone, label, sort_order)
         SELECT s.id, trim(s.phone), NULL, 0 FROM suppliers s
         WHERE COALESCE(trim(s.phone), '') <> ''
           AND NOT EXISTS (SELECT 1 FROM supplier_phones p WHERE p.supplier_id = s.id)`);
db.exec(`INSERT INTO supplier_bank_accounts(supplier_id, bank_name, account_no, holder, label, sort_order)
         SELECT s.id, 'Chưa rõ ngân hàng', trim(s.bank_account), NULL, NULL, 0 FROM suppliers s
         WHERE COALESCE(trim(s.bank_account), '') <> ''
           AND NOT EXISTS (SELECT 1 FROM supplier_bank_accounts b WHERE b.supplier_id = s.id)`);

/* ------------------- Đợt 15: ba tài liệu đặc tả tiếp theo ------------------- */

/* Hàng hoá (tài liệu 13, 15): mô tả cho thu ngân tư vấn, quy cách đóng gói,
   và hai đơn vị mặc định — bán thì nhảy đơn vị nào, nhập thì đơn vị nào. */
addColumns('products', {
  description: 'TEXT',                               // thông số, chất liệu, cách dùng
  pack_spec: 'TEXT',                                 // "Lố 12 cái", "Thùng 360 cái"
  sell_unit_id: 'INTEGER',                           // đơn vị bán chính
  buy_unit_id: 'INTEGER',                            // đơn vị mua chính
});

/* Đơn vị tính có mã riêng, xoá mềm được, và khai được theo kiểu bắc cầu
   ("1 Thùng = 12 Lốc") — giữ lại lời khai để mở ra sửa vẫn thấy. */
addColumns('product_units', {
  active: 'INTEGER NOT NULL DEFAULT 1',              // 0 = ngừng hoạt động, ẩn ở POS
  ref_unit_id: 'INTEGER',                            // khai theo đơn vị nào
  ref_qty: 'REAL',                                   // bao nhiêu đơn vị đó
});

/* Chứng từ nối vào MÃ đơn vị, không chỉ nối bằng chữ (tài liệu 13, mục 1.3).
   Cột chữ unit_name / factor vẫn giữ nguyên: hoá đơn cũ phải đọc lại được
   đúng như lúc in, kể cả sau khi đơn vị bị đổi tên. */
addColumns('sale_items', { unit_id: 'INTEGER' });
addColumns('purchase_items', {
  unit_id: 'INTEGER',
  /* Tích ô "ghi đè giá vốn" ở dòng này thì lúc lưu phiếu giá vốn mặt hàng
     bị ghi đè bằng đơn giá nhập. Không tích thì giá vốn đứng yên. */
  overwrite_cost: 'INTEGER NOT NULL DEFAULT 0',
});
addColumns('sale_order_items', { unit_id: 'INTEGER' });
addColumns('sale_return_items', { unit_id: 'INTEGER' });
addColumns('purchase_return_items', { unit_id: 'INTEGER' });

/* Khách hàng tối đa 3 số điện thoại (tài liệu 14, mục 4) */
addColumns('customers', { phone2: 'TEXT', phone3: 'TEXT' });

/* Báo giá của từng mối cho từng mã hàng (tài liệu 15, mục 4.3) */
addColumns('product_suppliers', {
  quote_price: 'INTEGER NOT NULL DEFAULT 0',
  quote_at: 'TEXT',
  quote_note: 'TEXT',
});

/* Phiếu thu nợ in khổ K80 cần số nợ ĐÚNG LÚC THU, không phải lúc in lại —
   nên chốt luôn hai con số vào phiếu (tài liệu 14, mục 1.2). */
addColumns('cash_transactions', {
  debt_before: 'INTEGER',
  debt_after: 'INTEGER',
});

/* Phiếu báo hết hàng (tài liệu 15, mục 4): dòng nào đã chuyển sang phiếu mua
   tạm thì khoá lại, và phiếu lẻ gộp vào phiếu tổng nào. */
addColumns('requisition_items', {
  split_at: 'TEXT',
  split_draft_id: 'INTEGER',
});
addColumns('requisitions', { merged_into: 'INTEGER' });

/* Giao hàng: phí trả cho tài xế (khác phí thu của khách), và số đo đóng gói
   để khai với hãng vận chuyển (tài liệu 14, mục 5). */
addColumns('sales', {
  shipper_fee: 'INTEGER NOT NULL DEFAULT 0',
  ship_weight: 'REAL NOT NULL DEFAULT 0',
  ship_size: 'TEXT',
});

db.exec('CREATE INDEX IF NOT EXISTS idx_customers_phone2 ON customers(phone2)');
db.exec('CREATE INDEX IF NOT EXISTS idx_customers_phone3 ON customers(phone3)');
db.exec('CREATE INDEX IF NOT EXISTS idx_si_unit ON sale_items(unit_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_pi_unit ON purchase_items(unit_id)');

/* Nối chứng từ CŨ vào mã đơn vị theo tên đã lưu. Chỉ đụng dòng còn trống,
   nên chạy lại mỗi lần khởi động vô hại; dòng có tên đơn vị đã bị xoá khỏi
   danh mục thì để trống — không đoán bừa. */
for (const t of ['sale_items', 'purchase_items', 'sale_order_items',
  'sale_return_items', 'purchase_return_items']) {
  db.exec(`UPDATE ${t} SET unit_id = (
             SELECT pu.id FROM product_units pu
             WHERE pu.product_id = ${t}.product_id AND pu.unit_name = ${t}.unit_name
             LIMIT 1)
           WHERE unit_id IS NULL AND product_id IS NOT NULL`);
}

/* Đơn vị bán / mua chính: mặt hàng cũ chưa khai thì lấy đơn vị cơ bản.
   Chỉ điền chỗ còn trống, và chỉ khi mã đơn vị đó có thật. */
db.exec(`UPDATE products SET sell_unit_id = (
           SELECT pu.id FROM product_units pu
           WHERE pu.product_id = products.id AND pu.factor = 1 LIMIT 1)
         WHERE sell_unit_id IS NULL`);
db.exec(`UPDATE products SET buy_unit_id = sell_unit_id WHERE buy_unit_id IS NULL`);

/* ------------------- Đợt 16: ba tài liệu đặc tả tiếp theo ------------------- */

/* Quy cách đóng gói ghi theo TỪNG đơn vị (tài liệu 18, vùng 3): "Lố 12 cái"
   là quy cách của cái Lố, không phải của mặt hàng. Cột products.pack_spec cũ
   vẫn giữ, mang quy cách của đơn vị cơ bản để các màn hình cũ đọc được.

   Nhiều đơn vị cùng làm đơn vị bán chính / mua chính (tài liệu 16, mục 2.1):
   hai cột products.sell_unit_id, buy_unit_id vẫn giữ, trỏ vào đơn vị đầu
   tiên được tích — chỗ nào chỉ cần một đơn vị thì đọc hai cột đó như cũ. */
addColumns('product_units', {
  pack_spec: 'TEXT',
  is_sell_main: 'INTEGER NOT NULL DEFAULT 0',
  is_buy_main: 'INTEGER NOT NULL DEFAULT 0',
});

/* Ghi chú khi mua hàng: ưu đãi mặc định của mối, ví dụ "Mua 50 tặng 5" */
addColumns('products', { purchase_note: 'TEXT' });

/* Bộ hàng ghim theo mùa (tài liệu 16, mục 4): mỗi bộ một danh sách, bật bộ
   nào thì lưới bán hàng đẩy hàng của bộ đó lên đầu. */
addColumns('pos_featured', { set_id: 'INTEGER' });

/* Báo giá gõ thẳng trên phiếu báo hết hàng (tài liệu 17, mục 2.2) */
addColumns('requisition_item_suppliers', { quote_price: 'INTEGER' });

/* Bảng hàng ghim đời đầu khoá UNIQUE(kind, ref_id): một mặt hàng chỉ nằm
   được ở đúng một chỗ. Từ đợt 16 mỗi bộ theo mùa là một danh sách riêng,
   nên cùng một món phải nằm được ở nhiều bộ — dựng lại bảng với khoá ba
   cột. Soát trước rồi mới dựng, nên chạy lại mỗi lần khởi động vô hại. */
const pfUniqueOk = db.prepare("PRAGMA index_list('pos_featured')").all()
  .some((ix) => ix.unique
    && db.prepare(`PRAGMA index_info('${ix.name}')`).all().some((c) => c.name === 'set_id'));
if (!pfUniqueOk) {
  console.log('  [nâng cấp] dựng lại bảng pos_featured cho bộ hàng ghim theo mùa');
  db.exec(`
    CREATE TABLE pos_featured_new (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      kind       TEXT NOT NULL,
      ref_id     INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      note       TEXT,
      set_id     INTEGER,
      UNIQUE(kind, ref_id, set_id)
    );
    INSERT INTO pos_featured_new(id, kind, ref_id, sort_order, note, set_id)
      SELECT id, kind, ref_id, sort_order, note, set_id FROM pos_featured;
    DROP TABLE pos_featured;
    ALTER TABLE pos_featured_new RENAME TO pos_featured;
  `);
}
db.exec('CREATE INDEX IF NOT EXISTS idx_pf_set ON pos_featured(set_id)');

/* Đơn vị bán chính / mua chính của hàng cũ: lấy theo hai cột đang có */
db.exec(`UPDATE product_units SET is_sell_main = 1
         WHERE is_sell_main = 0 AND id IN (SELECT sell_unit_id FROM products WHERE sell_unit_id IS NOT NULL)`);
db.exec(`UPDATE product_units SET is_buy_main = 1
         WHERE is_buy_main = 0 AND id IN (SELECT buy_unit_id FROM products WHERE buy_unit_id IS NOT NULL)`);
/* Quy cách của mặt hàng chuyển xuống đơn vị cơ bản, chỉ khi đơn vị chưa có */
db.exec(`UPDATE product_units SET pack_spec = (
           SELECT p.pack_spec FROM products p WHERE p.id = product_units.product_id)
         WHERE pack_spec IS NULL AND factor = 1
           AND EXISTS (SELECT 1 FROM products p WHERE p.id = product_units.product_id
                        AND COALESCE(p.pack_spec, '') <> '')`);

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
/* Mã đơn vị tính của một dòng chứng từ (tài liệu 13, mục 1.3)          */
/*                                                                     */
/* Chứng từ nối vào MÃ đơn vị. Máy khách đời cũ và phiếu tạm lưu từ     */
/* trước chỉ gửi tên đơn vị, nên tra lại theo tên; tra không ra thì để  */
/* trống chứ không đoán bừa sang đơn vị khác.                           */
/* ------------------------------------------------------------------ */

export function resolveUnitId(productId, unitId, unitName) {
  const pid = Number(productId) || 0;
  if (!pid) return null;
  const id = Number(unitId) || 0;
  if (id) {
    const row = get('SELECT id FROM product_units WHERE id = ? AND product_id = ?', [id, pid]);
    if (row) return row.id;
  }
  const name = String(unitName ?? '').trim();
  if (!name) return null;
  return get('SELECT id FROM product_units WHERE product_id = ? AND unit_name = ? LIMIT 1',
    [pid, name])?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* Kiểu tìm kiếm: đúng hẳn hay có chứa (tài liệu 13, mục 2.1)          */
/*                                                                     */
/* "Tìm có chứa" là kiểu quen dùng: gõ một khúc tên là ra. Nhưng khi    */
/* quét mã vạch hay dò đúng một mã hàng thì kiểu đó trả về cả chục dòng */
/* rác — nên mỗi ô tìm kiếm cho chọn "Tìm chính xác".                   */
/*                                                                     */
/* Dùng: searchWhere('p.name', q, mode) -> { sql, params }             */
/* ------------------------------------------------------------------ */

/** 'exact' hoặc 'contains'. Gửi gì lạ thì coi như 'contains'. */
/**
 * Bỏ dấu, hạ chữ thường — dùng chung cho cả JS lẫn câu SQL.
 *
 * LIKE của SQLite chỉ biết hạ chữ thường của bảng chữ cái ASCII: "anh" tìm
 * ra "Anh", nhưng "ống" KHÔNG tìm ra "Ống" vì chữ Ố hoa nằm ngoài ASCII.
 * Tiệm bán "Ổ cắm", "Đèn LED", "Ống nước" — gõ thường mà không ra thì coi
 * như ô tìm hỏng. Thêm nữa, người đứng quầy quen gõ không dấu.
 */
export const vnFold = (v) => String(v ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .toLowerCase();

/* Khai cho SQLite dùng được hàm trên ngay trong câu truy vấn */
db.function('vnfold', { deterministic: true, varargs: false }, vnFold);

export function searchMode(v) {
  return String(v ?? '').toLowerCase() === 'exact' ? 'exact' : 'contains';
}

/**
 * Điều kiện tìm kiếm cho một hoặc nhiều cột.
 *
 * Mọi so khớp đi qua vnfold(): BỎ DẤU và hạ chữ thường cả hai vế, nên gõ
 * "ong thuy luc", "Ống Thuỷ Lực" hay "ống thuỷ lực" đều ra như nhau.
 *
 * Tìm chính xác thì so khớp cả chuỗi.
 *
 * Tìm có chứa KHÔNG BẮT ĐÚNG THỨ TỰ TỪ (tài liệu 16, mục 3): tách từ khoá
 * thành từng từ, mỗi từ phải có mặt ở một cột nào đó. Khách tên "Quốc Anh"
 * mà gõ "Anh Quốc" vẫn ra — người đứng quầy nhớ tên theo kiểu gọi, không
 * theo thứ tự ghi trong hồ sơ.
 */
export function searchWhere(columns, value, mode = 'contains') {
  const cols = Array.isArray(columns) ? columns : [columns];
  const v = String(value ?? '').trim();
  if (!v || !cols.length) return { sql: '', params: [] };

  if (searchMode(mode) === 'exact') {
    return {
      sql: '(' + cols.map((c) => `vnfold(${c}) LIKE ?`).join(' OR ') + ')',
      params: cols.map(() => vnFold(v)),
    };
  }

  /* Mỗi từ một điều kiện OR giữa các cột, rồi AND các từ lại với nhau.
     Giới hạn 6 từ: gõ cả câu dài thì câu truy vấn phình ra vô ích. */
  const words = v.split(/\s+/).filter(Boolean).slice(0, 6);
  const params = [];
  const parts = words.map((w) => {
    for (const _ of cols) params.push(`%${vnFold(w)}%`);
    return '(' + cols.map((c) => `vnfold(${c}) LIKE ?`).join(' OR ') + ')';
  });
  return { sql: '(' + parts.join(' AND ') + ')', params };
}

/**
 * Cột sắp xếp do người dùng bấm vào tiêu đề bảng. CHỈ nhận tên cột nằm
 * trong danh sách cho phép — ghép thẳng chuỗi của người dùng vào câu SQL
 * là mở cửa cho việc chèn câu lệnh lạ.
 */
/* ------------------------------------------------------------------ */
/* NẤC GIÁ SỈ THEO SỐ LƯỢNG (tài liệu 22)                              */
/*                                                                     */
/* Mua càng nhiều càng rẻ. Nấc khai theo TỪNG ĐƠN VỊ TÍNH: nấc của Cái */
/* khác nấc của Thùng. Giá nấc là giá tuyệt đối, không phụ thuộc bảng  */
/* giá đang chọn — nấc là thoả thuận theo số lượng, bảng giá là chính  */
/* sách theo nhóm khách, hai chuyện khác nhau.                         */
/* ------------------------------------------------------------------ */

/** Các nấc của một đơn vị tính, nấc nhỏ trước. Mỗi nấc { min_qty, price }. */
export function unitTiers(unitId) {
  const id = Number(unitId) || 0;
  if (!id) return [];
  return all(`SELECT min_qty, price FROM product_price_tiers
              WHERE unit_id = ? AND min_qty > 0 ORDER BY min_qty`, [id]);
}

/**
 * Giá của nấc ăn được khi mua `qty` đơn vị. Chưa tới nấc đầu tiên thì trả
 * null — lúc đó bán theo bảng giá như cũ, không đổi gì.
 */
export function tierPriceOf(unitId, qty) {
  const q = Number(qty) || 0;
  let hit = null;
  for (const t of unitTiers(unitId)) {
    /* Cộng thêm một chút để số lẻ kiểu 9.999999 vẫn coi là đủ 10 */
    if (q + 1e-9 >= Number(t.min_qty)) hit = t;
    else break;
  }
  return hit ? Math.round(Number(hit.price) || 0) : null;
}

export function orderBy(allowed, field, dir, fallback) {
  const col = allowed[String(field ?? '')];
  if (!col) return fallback;
  return `${col} ${String(dir ?? '').toLowerCase() === 'desc' ? 'DESC' : 'ASC'}`;
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
/* Bảo hành theo từng bộ phận (plan 31, hạng mục 3e)                   */
/* ------------------------------------------------------------------ */

/** Làm sạch danh sách bộ phận gửi lên: bỏ dòng trống, thời hạn phải > 0. */
export function normWarrantyParts(list) {
  return (Array.isArray(list) ? list : [])
    .map((x) => ({
      name: String(x?.name ?? '').trim(),
      duration: Math.round(Number(x?.duration) || 0),
      unit: x?.unit === 'day' ? 'day' : 'month',
    }))
    .filter((x) => x.name && x.duration > 0)
    .slice(0, 12);
}

/** Số tháng bảo hành chung đủ phủ bộ phận lâu nhất (7 ngày vẫn tính 1 tháng). */
export function monthsCovering(parts) {
  return parts.reduce((m, p) => Math.max(m, p.unit === 'day' ? Math.ceil(p.duration / 30) : p.duration), 0);
}

/** Hạn bảo hành của một bộ phận, tính từ ngày bán. */
export function partUntil(fromTs, duration, unit) {
  return get(`SELECT date(COALESCE(?, datetime('now','localtime')), '+' || ? || ?) AS d`,
    [fromTs || null, Math.max(0, Math.round(Number(duration) || 0)), unit === 'day' ? ' days' : ' months']).d;
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
 * Ghi đè giá vốn bằng đơn giá nhập, do người lập phiếu TỰ TÍCH CHỌN từng
 * dòng (tài liệu 13, mục 1.2). Đây là một trong hai đường duy nhất đổi giá
 * vốn của hàng dùng giá vốn cố định; đường kia là gõ tay ở thẻ hàng hoá.
 *
 * Ghi đè thì chốt luôn (cost_fixed = 1): lần nhập sau không tự đụng vào nữa.
 */
export function overwriteCost(productId, newUnitCost) {
  const v = Math.max(0, Math.round(Number(newUnitCost) || 0));
  if (!get('SELECT id FROM products WHERE id = ?', [productId])) return null;
  run('UPDATE products SET cost_price = ?, cost_fixed = 1 WHERE id = ?', [v, productId]);
  return v;
}

/**
 * Cập nhật giá vốn khi NHẬP hàng. newUnitCost tính theo đơn vị cơ bản.
 * Trả về giá vốn mới, hoặc null nếu không đổi gì.
 *
 * Hàng dùng GIÁ VỐN CỐ ĐỊNH thì phiếu nhập không được tự đụng vào con số đó
 * nữa — kể cả lần nhập đầu tiên (tài liệu 13, mục 1.2 bỏ hẳn luật cũ "lần
 * nhập đầu tự chốt"). Muốn đổi thì tích ô "Ghi đè giá vốn" ở dòng hàng trên
 * phiếu nhập, hoặc gõ tay trong thẻ hàng hoá.
 */
export function updateAvgCost(productId, inQtyBase, newUnitCost) {
  if (inQtyBase <= 0) return null;
  const p = get('SELECT cost_price, cost_method, cost_fixed FROM products WHERE id = ?', [productId]);
  if (!p) return null;

  if (costMethodOf(p) === 'fixed') return null;

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
/* Hoàn vào lương nhân viên (plan 28): hoá đơn gốc trả bằng lương, khách chưa từng
   nợ đồng nào — hoàn lại vào sổ lương, không được trừ vào nợ của khách. */
export const returnCreditSql = (a = 'sr') => `(CASE
    WHEN ${a}.refund_method IN ('voucher', 'salary') THEN 0
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
  return c.opening_debt + s - r - paid + debtAdjustTotal('customer', customerId);
}

/** Tổng các phiếu điều chỉnh công nợ (plan 31, 6c) — âm là giảm nợ. */
export function debtAdjustTotal(type, partnerId) {
  return get(`SELECT COALESCE(SUM(amount), 0) AS d FROM debt_adjustments
              WHERE partner_type = ? AND partner_id = ?`, [type, partnerId]).d;
}

/**
 * Công nợ nhà cung cấp = nợ đầu kỳ + (nhập chưa trả) − (trả hàng NCC ĐÃ NHẬN, trừ phần NCC đã
 * hoàn tiền mặt) − (đã trả nợ).
 *
 * Phiếu trả NCC chưa nhận hàng thì chưa trừ nợ (chủ tiệm chốt, plan 31 đợt 5). Tiền NCC
 * hoàn chỉ ghi được sau khi NCC đã nhận, nên nhánh "chưa nhận mà có hoàn tiền" chỉ để
 * sổ vẫn cân nếu dữ liệu cũ lỡ có.
 */
export function supplierDebt(supplierId) {
  const s = get('SELECT opening_debt FROM suppliers WHERE id = ?', [supplierId]);
  if (!s) return 0;
  const p = get(
    `SELECT COALESCE(SUM(total - paid), 0) AS d FROM purchases
     WHERE supplier_id = ? AND status = 'done'`,
    [supplierId]
  ).d;
  const r = get(
    `SELECT COALESCE(SUM(CASE WHEN received_at IS NOT NULL THEN total - refunded ELSE -refunded END), 0) AS d
     FROM purchase_returns WHERE supplier_id = ?`,
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
  return s.opening_debt + p - r - paid + debtAdjustTotal('supplier', supplierId);
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
