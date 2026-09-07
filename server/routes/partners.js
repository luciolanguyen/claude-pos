import { Router } from 'express';
import { all, get, run, customerDebt, supplierDebt, addCashTx, defaultCashAccount } from '../db.js';

const r = Router();

function genCode(table, prefix) {
  const n = get(`SELECT COUNT(*) AS n FROM ${table}`).n + 1;
  let code = prefix + String(n).padStart(4, '0');
  let i = n;
  while (get(`SELECT id FROM ${table} WHERE code = ?`, [code])) {
    i += 1;
    code = prefix + String(i).padStart(4, '0');
  }
  return code;
}

/* =========================== NHÀ CUNG CẤP =========================== */

r.get('/suppliers', (req, res) => {
  const { q = '', active } = req.query;
  const where = [];
  const params = [];
  if (q.trim()) {
    where.push('(name LIKE ? OR code LIKE ? OR phone LIKE ? OR contact_name LIKE ?)');
    const like = `%${q.trim()}%`;
    params.push(like, like, like, like);
  }
  if (active !== undefined && active !== '') { where.push('active = ?'); params.push(Number(active)); }
  const sql = 'SELECT * FROM suppliers' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY name';
  const rows = all(sql, params);
  for (const s of rows) {
    s.debt = supplierDebt(s.id);
    const agg = get(
      `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS n, MAX(ts) AS last_ts
       FROM purchases WHERE supplier_id = ? AND status = 'done'`, [s.id]);
    s.total_purchased = agg.total;
    s.purchase_count = agg.n;
    s.last_purchase = agg.last_ts;
  }
  res.json(rows);
});

r.get('/suppliers/:id', (req, res) => {
  const s = get('SELECT * FROM suppliers WHERE id = ?', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp' });
  s.debt = supplierDebt(s.id);
  s.purchases = all(
    `SELECT id, code, ts, total, paid, status, supplier_invoice, due_date
     FROM purchases WHERE supplier_id = ? ORDER BY id DESC LIMIT 100`, [s.id]);
  s.returns = all(
    'SELECT id, code, ts, total, refunded, reason FROM purchase_returns WHERE supplier_id = ? ORDER BY id DESC LIMIT 50',
    [s.id]);
  s.payments = all(
    `SELECT * FROM cash_transactions
     WHERE partner_type = 'supplier' AND partner_id = ? ORDER BY id DESC LIMIT 100`, [s.id]);
  res.json(s);
});

r.post('/suppliers', (req, res) => {
  const b = req.body;
  if (!b.name?.trim()) return res.status(400).json({ error: 'Thiếu tên nhà cung cấp' });
  const code = b.code?.trim() || genCode('suppliers', 'NCC');
  if (get('SELECT id FROM suppliers WHERE code = ?', [code])) {
    return res.status(400).json({ error: `Mã "${code}" đã tồn tại` });
  }
  const info = run(`
    INSERT INTO suppliers(code, name, contact_name, phone, email, address, tax_code,
                          bank_account, opening_debt, term_days, note, active)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [code, b.name.trim(), b.contact_name || null, b.phone || null, b.email || null,
      b.address || null, b.tax_code || null, b.bank_account || null,
      Math.round(Number(b.opening_debt) || 0), Number(b.term_days) || 0, b.note || null]);
  res.json(get('SELECT * FROM suppliers WHERE id = ?', [Number(info.lastInsertRowid)]));
});

r.put('/suppliers/:id', (req, res) => {
  const b = req.body;
  run(`UPDATE suppliers SET name = ?, contact_name = ?, phone = ?, email = ?, address = ?,
         tax_code = ?, bank_account = ?, opening_debt = ?, term_days = ?, note = ?, active = ?
       WHERE id = ?`,
    [b.name, b.contact_name || null, b.phone || null, b.email || null, b.address || null,
      b.tax_code || null, b.bank_account || null, Math.round(Number(b.opening_debt) || 0),
      Number(b.term_days) || 0, b.note || null, b.active === 0 ? 0 : 1, req.params.id]);
  res.json(get('SELECT * FROM suppliers WHERE id = ?', [req.params.id]));
});

r.delete('/suppliers/:id', (req, res) => {
  const n = get('SELECT COUNT(*) AS n FROM purchases WHERE supplier_id = ?', [req.params.id]).n;
  if (n > 0) {
    run('UPDATE suppliers SET active = 0 WHERE id = ?', [req.params.id]);
    return res.json({ ok: true, deactivated: true, message: 'Nhà cung cấp đã có phiếu nhập nên được chuyển sang trạng thái Ngừng hợp tác.' });
  }
  run('DELETE FROM suppliers WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

/** Trả nợ nhà cung cấp (phiếu chi). */
r.post('/suppliers/:id/pay', (req, res) => {
  const s = get('SELECT * FROM suppliers WHERE id = ?', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp' });
  const amount = Math.round(Number(req.body.amount) || 0);
  if (amount <= 0) return res.status(400).json({ error: 'Số tiền phải lớn hơn 0' });
  const accountId = Number(req.body.account_id) || defaultCashAccount();
  if (!accountId) return res.status(400).json({ error: 'Chưa thiết lập quỹ tiền' });
  const t = addCashTx({
    accountId, direction: 'out', amount, category: 'debt_out',
    partnerType: 'supplier', partnerId: s.id, partnerName: s.name,
    note: req.body.note || `Trả nợ NCC ${s.name}`,
  });
  res.json({ ok: true, transaction: t, debt: supplierDebt(s.id) });
});

/* ============================ KHÁCH HÀNG ============================ */

r.get('/customers', (req, res) => {
  const { q = '', active, has_debt } = req.query;
  const where = [];
  const params = [];
  if (q.trim()) {
    where.push('(c.name LIKE ? OR c.code LIKE ? OR c.phone LIKE ? OR c.company_name LIKE ?)');
    const like = `%${q.trim()}%`;
    params.push(like, like, like, like);
  }
  if (active !== undefined && active !== '') { where.push('c.active = ?'); params.push(Number(active)); }
  const sql = `
    SELECT c.*, pl.name AS price_list_name
    FROM customers c LEFT JOIN price_lists pl ON pl.id = c.price_list_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.name`;
  let rows = all(sql, params);
  for (const c of rows) {
    c.debt = customerDebt(c.id);
    const agg = get(
      `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS n, MAX(ts) AS last_ts
       FROM sales WHERE customer_id = ? AND status = 'done'`, [c.id]);
    c.total_spent = agg.total;
    c.order_count = agg.n;
    c.last_order = agg.last_ts;
  }
  if (has_debt === '1') rows = rows.filter((c) => c.debt > 0);
  res.json(rows);
});

r.get('/customers/:id', (req, res) => {
  const c = get(`
    SELECT c.*, pl.name AS price_list_name
    FROM customers c LEFT JOIN price_lists pl ON pl.id = c.price_list_id
    WHERE c.id = ?`, [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
  c.debt = customerDebt(c.id);
  c.sales = all(
    `SELECT id, code, ts, total, paid, payment_method, status, is_vat_invoice
     FROM sales WHERE customer_id = ? ORDER BY id DESC LIMIT 100`, [c.id]);
  c.returns = all(
    'SELECT id, code, ts, total, refunded, reason FROM sale_returns WHERE customer_id = ? ORDER BY id DESC LIMIT 50',
    [c.id]);
  c.payments = all(
    `SELECT * FROM cash_transactions
     WHERE partner_type = 'customer' AND partner_id = ? ORDER BY id DESC LIMIT 100`, [c.id]);
  // Sản phẩm khách hay mua
  c.top_products = all(`
    SELECT si.product_id, si.name_snapshot AS name, si.unit_name,
           SUM(si.qty) AS qty, SUM(si.amount) AS amount
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.customer_id = ? AND s.status = 'done'
    GROUP BY si.product_id, si.unit_name ORDER BY amount DESC LIMIT 10`, [c.id]);
  res.json(c);
});

r.post('/customers', (req, res) => {
  const b = req.body;
  if (!b.name?.trim()) return res.status(400).json({ error: 'Thiếu tên khách hàng' });
  const code = b.code?.trim() || genCode('customers', 'KH');
  if (get('SELECT id FROM customers WHERE code = ?', [code])) {
    return res.status(400).json({ error: `Mã "${code}" đã tồn tại` });
  }
  const info = run(`
    INSERT INTO customers(code, name, phone, email, address, tax_code, company_name,
                          price_list_id, opening_debt, debt_limit, birthday, note, active)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [code, b.name.trim(), b.phone || null, b.email || null, b.address || null,
      b.tax_code || null, b.company_name || null, b.price_list_id || null,
      Math.round(Number(b.opening_debt) || 0), Math.round(Number(b.debt_limit) || 0),
      b.birthday || null, b.note || null]);
  res.json(get('SELECT * FROM customers WHERE id = ?', [Number(info.lastInsertRowid)]));
});

r.put('/customers/:id', (req, res) => {
  const b = req.body;
  run(`UPDATE customers SET name = ?, phone = ?, email = ?, address = ?, tax_code = ?,
         company_name = ?, price_list_id = ?, opening_debt = ?, debt_limit = ?,
         birthday = ?, note = ?, active = ?
       WHERE id = ?`,
    [b.name, b.phone || null, b.email || null, b.address || null, b.tax_code || null,
      b.company_name || null, b.price_list_id || null, Math.round(Number(b.opening_debt) || 0),
      Math.round(Number(b.debt_limit) || 0), b.birthday || null, b.note || null,
      b.active === 0 ? 0 : 1, req.params.id]);
  res.json(get('SELECT * FROM customers WHERE id = ?', [req.params.id]));
});

r.delete('/customers/:id', (req, res) => {
  const n = get('SELECT COUNT(*) AS n FROM sales WHERE customer_id = ?', [req.params.id]).n;
  if (n > 0) {
    run('UPDATE customers SET active = 0 WHERE id = ?', [req.params.id]);
    return res.json({ ok: true, deactivated: true, message: 'Khách hàng đã có hoá đơn nên được chuyển sang trạng thái Ngừng theo dõi.' });
  }
  run('DELETE FROM customers WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

/** Khách trả nợ (phiếu thu). */
r.post('/customers/:id/pay', (req, res) => {
  const c = get('SELECT * FROM customers WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
  const amount = Math.round(Number(req.body.amount) || 0);
  if (amount <= 0) return res.status(400).json({ error: 'Số tiền phải lớn hơn 0' });
  const accountId = Number(req.body.account_id) || defaultCashAccount();
  if (!accountId) return res.status(400).json({ error: 'Chưa thiết lập quỹ tiền' });
  const t = addCashTx({
    accountId, direction: 'in', amount, category: 'debt_in',
    partnerType: 'customer', partnerId: c.id, partnerName: c.name,
    note: req.body.note || `Khách ${c.name} trả nợ`,
  });
  res.json({ ok: true, transaction: t, debt: customerDebt(c.id) });
});

export default r;
