import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = process.env.POS_DB || path.join(DATA_DIR, 'pos.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

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
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* đã rollback */ }
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

/**
 * Cập nhật giá vốn bình quân gia quyền khi nhập hàng.
 * newCost tính theo đơn vị cơ bản.
 */
export function updateAvgCost(productId, inQtyBase, newUnitCost) {
  if (inQtyBase <= 0) return;
  const p = get('SELECT cost_price FROM products WHERE id = ?', [productId]);
  if (!p) return;
  const totalQty = get(
    'SELECT COALESCE(SUM(qty), 0) AS q FROM stock WHERE product_id = ?',
    [productId]
  ).q;
  const oldQty = totalQty - inQtyBase;
  const avg = oldQty > 0
    ? (oldQty * p.cost_price + inQtyBase * newUnitCost) / totalQty
    : newUnitCost;
  run('UPDATE products SET cost_price = ? WHERE id = ?', [Math.round(avg), productId]);
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
