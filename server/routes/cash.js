import { Router } from 'express';
import { all, get, run, addCashTx, accountBalance , pageParams } from '../db.js';

const r = Router();

/* Danh mục loại thu / chi cho hộ kinh doanh */
export const CASH_CATEGORIES = {
  in: [
    { code: 'sale', label: 'Thu bán hàng' },
    { code: 'cod_in', label: 'Thu hộ COD từ người giao hàng' },
    { code: 'debt_in', label: 'Thu công nợ khách' },
    { code: 'deposit_in', label: 'Khách đặt cọc đơn hàng' },
    { code: 'purchase_return', label: 'NCC hoàn tiền trả hàng' },
    { code: 'capital_in', label: 'Chủ góp vốn' },
    { code: 'warranty_in', label: 'Thu sửa chữa / bảo hành' },
    { code: 'custom_parts_in', label: 'Doanh thu linh kiện ngoài hệ thống' },
    { code: 'other_in', label: 'Thu khác' },
  ],
  out: [
    { code: 'purchase', label: 'Chi mua hàng' },
    { code: 'debt_out', label: 'Trả nợ nhà cung cấp' },
    { code: 'sale_return', label: 'Hoàn tiền khách trả hàng' },
    { code: 'deposit_out', label: 'Hoàn cọc đơn đã huỷ' },
    { code: 'salary', label: 'Lương nhân viên' },
    { code: 'rent', label: 'Tiền thuê mặt bằng' },
    { code: 'utility', label: 'Điện, nước, internet' },
    { code: 'transport', label: 'Vận chuyển, xăng xe' },
    { code: 'tax', label: 'Thuế, lệ phí' },
    { code: 'capital_out', label: 'Chủ rút vốn' },
    { code: 'other_out', label: 'Chi khác' },
  ],
};

r.get('/cash/categories', (req, res) => res.json(CASH_CATEGORIES));

/* ========================== TÀI KHOẢN QUỸ ========================== */

r.get('/cash/accounts', (req, res) => {
  const rows = all('SELECT * FROM cash_accounts WHERE active = 1 ORDER BY sort_order, id');
  for (const a of rows) {
    a.balance = accountBalance(a.id);
    const t = get(`
      SELECT COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount END), 0) AS tin,
             COALESCE(SUM(CASE WHEN direction = 'out' THEN amount END), 0) AS tout
      FROM cash_transactions
      WHERE account_id = ? AND date(ts) = date('now','localtime')`, [a.id]);
    a.today_in = t.tin;
    a.today_out = t.tout;
  }
  res.json(rows);
});

r.post('/cash/accounts', (req, res) => {
  const b = req.body;
  if (!b.name?.trim()) return res.status(400).json({ error: 'Thiếu tên quỹ' });
  const code = b.code?.trim() ||
    'Q' + String(get('SELECT COUNT(*) AS n FROM cash_accounts').n + 1).padStart(3, '0');
  if (get('SELECT id FROM cash_accounts WHERE code = ?', [code])) {
    return res.status(400).json({ error: `Mã quỹ "${code}" đã tồn tại` });
  }
  const info = run(`
    INSERT INTO cash_accounts(code, name, type, bank_name, account_no, opening_balance, sort_order)
    VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [code, b.name.trim(), b.type || 'cash', b.bank_name || null, b.account_no || null,
      Math.round(Number(b.opening_balance) || 0), Number(b.sort_order) || 0]);
  res.json(get('SELECT * FROM cash_accounts WHERE id = ?', [Number(info.lastInsertRowid)]));
});

r.put('/cash/accounts/:id', (req, res) => {
  const b = req.body;
  run(`UPDATE cash_accounts SET name = ?, type = ?, bank_name = ?, account_no = ?,
         opening_balance = ?, sort_order = ?, active = ? WHERE id = ?`,
    [b.name, b.type || 'cash', b.bank_name || null, b.account_no || null,
      Math.round(Number(b.opening_balance) || 0), Number(b.sort_order) || 0,
      b.active === 0 ? 0 : 1, req.params.id]);
  res.json(get('SELECT * FROM cash_accounts WHERE id = ?', [req.params.id]));
});

r.delete('/cash/accounts/:id', (req, res) => {
  const n = get('SELECT COUNT(*) AS n FROM cash_transactions WHERE account_id = ?', [req.params.id]).n;
  if (n > 0) {
    run('UPDATE cash_accounts SET active = 0 WHERE id = ?', [req.params.id]);
    return res.json({ ok: true, deactivated: true, message: `Quỹ đã có ${n} giao dịch nên chỉ được ẩn đi, không xoá.` });
  }
  run('DELETE FROM cash_accounts WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

/* =========================== SỔ QUỸ ================================ */

r.get('/cash/transactions', (req, res) => {
  const { account_id, direction, category, partner_type, from, to, q = '' } = req.query;
  const where = [];
  const params = [];
  if (account_id) { where.push('t.account_id = ?'); params.push(account_id); }
  if (direction) { where.push('t.direction = ?'); params.push(direction); }
  if (category) { where.push('t.category = ?'); params.push(category); }
  if (partner_type) { where.push('t.partner_type = ?'); params.push(partner_type); }
  if (from) { where.push('date(t.ts) >= date(?)'); params.push(from); }
  if (to) { where.push('date(t.ts) <= date(?)'); params.push(to); }
  if (q.trim()) {
    where.push('(t.code LIKE ? OR t.partner_name LIKE ? OR t.note LIKE ? OR t.ref_code LIKE ?)');
    const like = `%${q.trim()}%`;
    params.push(like, like, like, like);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { page, size, offset } = pageParams(req.query);
  const total = get(`
    SELECT COUNT(*) AS n
    FROM cash_transactions t
    JOIN cash_accounts a ON a.id = t.account_id
    LEFT JOIN users u ON u.id = t.user_id
    ${w}`, params).n;

  const rows = all(`
    SELECT t.*, a.name AS account_name, a.type AS account_type, u.full_name AS user_name
    FROM cash_transactions t
    JOIN cash_accounts a ON a.id = t.account_id
    LEFT JOIN users u ON u.id = t.user_id
    ${w}
    ORDER BY t.id DESC LIMIT ${size} OFFSET ${offset}`, params);

  const totals = get(`
    SELECT COALESCE(SUM(CASE WHEN t.direction = 'in'  THEN t.amount END), 0) AS total_in,
           COALESCE(SUM(CASE WHEN t.direction = 'out' THEN t.amount END), 0) AS total_out
    FROM cash_transactions t
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, params);

  res.json({ rows, total, page, page_size: size, ...totals, net: totals.total_in - totals.total_out });
});

/**
 * Một phiếu thu / chi để in ra giấy.
 *
 * Kèm luôn tên quỹ, tên người lập và tên đối tác — tờ phiếu đưa cho
 * khách ký phải có đủ những dòng đó, không thể để trống.
 */
r.get('/cash/transactions/:id', (req, res) => {
  const t = get(`
    SELECT t.*, a.name AS account_name, a.type AS account_type,
           u.full_name AS user_name
    FROM cash_transactions t
    JOIN cash_accounts a ON a.id = t.account_id
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.id = ?`, [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy phiếu' });

  /* Địa chỉ đối tác để in lên phiếu — khách ký nhận tiền thì trên phiếu
     phải có địa chỉ của người ký, không thì tờ phiếu không có giá trị. */
  if (t.partner_type === 'customer' && t.partner_id) {
    const c = get('SELECT name, phone, address FROM customers WHERE id = ?', [t.partner_id]);
    if (c) { t.partner_phone = c.phone; t.partner_address = c.address; }
  } else if (t.partner_type === 'supplier' && t.partner_id) {
    const sp = get('SELECT name, phone, address FROM suppliers WHERE id = ?', [t.partner_id]);
    if (sp) { t.partner_phone = sp.phone; t.partner_address = sp.address; }
  }

  /* Nhãn tiếng Việt của loại thu/chi, để khỏi in ra mã máy như debt_in */
  const list = CASH_CATEGORIES[t.direction] || [];
  t.category_label = list.find((x) => x.code === t.category)?.label || t.category;
  res.json(t);
});

/** Lập phiếu thu / chi thủ công. */
r.post('/cash/transactions', (req, res) => {
  const b = req.body;
  const amount = Math.round(Number(b.amount) || 0);
  if (amount <= 0) return res.status(400).json({ error: 'Số tiền phải lớn hơn 0' });
  if (!['in', 'out'].includes(b.direction)) return res.status(400).json({ error: 'Loại phiếu không hợp lệ' });
  if (!b.account_id) return res.status(400).json({ error: 'Chưa chọn quỹ' });
  if (!b.category) return res.status(400).json({ error: 'Chưa chọn loại thu/chi' });

  let partnerName = b.partner_name || null;
  if (b.partner_type === 'customer' && b.partner_id) {
    partnerName = get('SELECT name FROM customers WHERE id = ?', [b.partner_id])?.name || partnerName;
  } else if (b.partner_type === 'supplier' && b.partner_id) {
    partnerName = get('SELECT name FROM suppliers WHERE id = ?', [b.partner_id])?.name || partnerName;
  }

  const t = addCashTx({
    accountId: Number(b.account_id), direction: b.direction, amount, category: b.category,
    partnerType: b.partner_type || null, partnerId: b.partner_id || null, partnerName,
    userId: b.user_id || null, note: b.note || null, ts: b.ts || null,
  });
  res.json(t);
});

r.delete('/cash/transactions/:id', (req, res) => {
  const t = get('SELECT * FROM cash_transactions WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy phiếu' });
  /* Phiếu thu nợ đã xác nhận thì chỉ chủ cửa hàng xoá được.

     Khách đưa tiền trả nợ, người đứng quầy ghi phiếu thu rồi xoá đi là
     tiền biến mất khỏi sổ mà khách vẫn tưởng đã trả. Thu ngân vốn không
     có quyền quỹ, nhưng chặn thêm ở đây để kể cả quản lý cũng không tự
     xoá được — và không có đường nào SỬA phiếu thu, chỉ có thể xoá. */
  if (t.category === 'debt_in' && req.user && req.user.role !== 'owner') {
    return res.status(403).json({
      error: 'Phiếu thu nợ đã xác nhận thì chỉ chủ cửa hàng mới xoá được.',
      code: 'RECEIPT_LOCKED',
    });
  }
  if (t.ref_type) {
    return res.status(400).json({
      error: `Phiếu này sinh tự động từ chứng từ ${t.ref_code}. Hãy huỷ chứng từ gốc thay vì xoá phiếu quỹ.`,
    });
  }
  run('DELETE FROM cash_transactions WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

/** Chuyển tiền giữa 2 quỹ (VD: nộp tiền mặt vào ngân hàng). */
r.post('/cash/transfer', (req, res) => {
  const { from_account_id, to_account_id, amount, note } = req.body;
  const amt = Math.round(Number(amount) || 0);
  if (amt <= 0) return res.status(400).json({ error: 'Số tiền phải lớn hơn 0' });
  if (Number(from_account_id) === Number(to_account_id)) {
    return res.status(400).json({ error: 'Quỹ nguồn và quỹ đích phải khác nhau' });
  }
  const from = get('SELECT name FROM cash_accounts WHERE id = ?', [from_account_id]);
  const to = get('SELECT name FROM cash_accounts WHERE id = ?', [to_account_id]);
  if (!from || !to) return res.status(400).json({ error: 'Quỹ không tồn tại' });
  if (accountBalance(Number(from_account_id)) < amt) {
    return res.status(400).json({ error: `Quỹ "${from.name}" không đủ số dư.` });
  }
  const label = note || `Chuyển quỹ ${from.name} sang ${to.name}`;
  const out = addCashTx({
    accountId: Number(from_account_id), direction: 'out', amount: amt,
    category: 'transfer_out', note: label,
  });
  const inTx = addCashTx({
    accountId: Number(to_account_id), direction: 'in', amount: amt,
    category: 'transfer_in', note: label,
  });
  res.json({ ok: true, out, in: inTx });
});

/** Tổng quan quỹ theo khoảng thời gian: thu/chi theo loại + dòng tiền theo ngày. */
r.get('/cash/summary', (req, res) => {
  const from = req.query.from || new Date(new Date().setDate(1)).toISOString().slice(0, 10);
  const to = req.query.to || new Date().toISOString().slice(0, 10);

  const accounts = all('SELECT * FROM cash_accounts WHERE active = 1 ORDER BY sort_order, id');
  let totalBalance = 0;
  for (const a of accounts) { a.balance = accountBalance(a.id); totalBalance += a.balance; }

  const byCategory = all(`
    SELECT category, direction, SUM(amount) AS amount, COUNT(*) AS n
    FROM cash_transactions
    WHERE date(ts) BETWEEN date(?) AND date(?)
    GROUP BY category, direction ORDER BY amount DESC`, [from, to]);

  const daily = all(`
    SELECT date(ts) AS day,
           COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount END), 0) AS tin,
           COALESCE(SUM(CASE WHEN direction = 'out' THEN amount END), 0) AS tout
    FROM cash_transactions
    WHERE date(ts) BETWEEN date(?) AND date(?)
    GROUP BY date(ts) ORDER BY day`, [from, to]);

  const totals = get(`
    SELECT COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount END), 0) AS total_in,
           COALESCE(SUM(CASE WHEN direction = 'out' THEN amount END), 0) AS total_out
    FROM cash_transactions WHERE date(ts) BETWEEN date(?) AND date(?)`, [from, to]);

  res.json({
    from, to, accounts, total_balance: totalBalance,
    total_in: totals.total_in, total_out: totals.total_out,
    net: totals.total_in - totals.total_out,
    by_category: byCategory, daily,
  });
});

export default r;
