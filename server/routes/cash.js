import { Router } from 'express';
import {
  all, get, run, tx, addCashTx, accountBalance, pageParams, logActivity,
} from '../db.js';
import { can } from '../guard.js';

const r = Router();

/* ====================================================================
   DANH MỤC LOẠI THU / CHI

   Trước đây danh sách này nằm cứng trong mã nguồn, muốn thêm một khoản
   chi mới là phải sửa phần mềm. Giờ nằm ở bảng `cash_categories`: mấy
   loại dưới đây là loại HỆ THỐNG (builtin) vì chứng từ tự động đang ghi
   đúng mã đó — đổi được tên, không xoá được. Chủ tiệm khai thêm loại
   riêng bao nhiêu cũng được.

   `is_expense` = khoản chi này tính vào CHI PHÍ VẬN HÀNH khi tính lãi lỗ.
   Mua hàng, trả nợ NCC, chuyển quỹ, hoàn tiền khách, rút vốn thì không —
   đó là tiền ra nhưng không phải chi phí.
   ==================================================================== */
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
    { code: 'transfer_in', label: 'Nhận chuyển quỹ' },
    { code: 'other_in', label: 'Thu khác' },
  ],
  out: [
    { code: 'purchase', label: 'Chi mua hàng' },
    { code: 'debt_out', label: 'Trả nợ nhà cung cấp' },
    { code: 'sale_return', label: 'Hoàn tiền khách trả hàng' },
    { code: 'deposit_out', label: 'Hoàn cọc đơn đã huỷ' },
    { code: 'salary', label: 'Lương nhân viên', expense: true },
    /* Sinh từ bảng lương (plan 28) — ứng và thưởng đưa ngay là tiền ra khỏi két */
    { code: 'salary_advance', label: 'Ứng lương nhân viên', expense: true },
    { code: 'salary_bonus', label: 'Thưởng nhân viên', expense: true },
    { code: 'rent', label: 'Tiền thuê mặt bằng', expense: true },
    { code: 'utility', label: 'Điện, nước, internet', expense: true },
    { code: 'transport', label: 'Vận chuyển, xăng xe', expense: true },
    /* Sinh tự động khi bấm "đã giao xong" một đơn có tiền xe (yêu cầu 28/09, mục I.2) */
    { code: 'shipper_out', label: 'Tiền xe trả người giao hàng', expense: true },
    { code: 'tax', label: 'Thuế, lệ phí', expense: true },
    { code: 'capital_out', label: 'Chủ rút vốn' },
    { code: 'consign_out', label: 'Trả tiền hàng gửi bán của chủ vãng lai' },
    { code: 'transfer_out', label: 'Chuyển quỹ đi' },
    { code: 'other_out', label: 'Chi khác', expense: true },
  ],
};

/* Nạp loại hệ thống vào bảng nếu chưa có. Chạy lúc khởi động, chạy lại vô hại:
   chỉ thêm dòng còn thiếu, không đụng tên chủ tiệm đã sửa. */
function seedCategories() {
  let order = 0;
  for (const dir of ['in', 'out']) {
    for (const c of CASH_CATEGORIES[dir]) {
      order += 1;
      run(`INSERT INTO cash_categories(code, label, direction, is_expense, builtin, sort_order)
           VALUES(?, ?, ?, ?, 1, ?)
           ON CONFLICT(code) DO UPDATE SET builtin = 1, direction = excluded.direction`,
      [c.code, c.label, dir, c.expense ? 1 : 0, order]);
    }
  }
}
seedCategories();

/** Danh mục loại thu chi đang dùng, chia hai nhóm như trước để màn hình cũ không hỏng. */
function categoryList({ includeHidden = false } = {}) {
  const rows = all(`SELECT * FROM cash_categories ${includeHidden ? '' : 'WHERE active = 1'}
                    ORDER BY builtin DESC, sort_order, id`);
  return {
    in: rows.filter((c) => c.direction === 'in'),
    out: rows.filter((c) => c.direction === 'out'),
  };
}

r.get('/cash/categories', (req, res) => res.json(categoryList({ includeHidden: req.query.all === '1' })));

/** Khai thêm một loại thu / chi của riêng tiệm. */
r.post('/cash/categories', (req, res) => {
  const b = req.body || {};
  const label = String(b.label || '').trim();
  const direction = b.direction === 'in' ? 'in' : 'out';
  if (!label) return res.status(400).json({ error: 'Chưa đặt tên loại thu chi' });
  /* Mã máy sinh từ tên, để chủ tiệm khỏi phải nghĩ ra mã */
  const base = 'cat_' + label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24);
  let code = base || 'cat';
  let i = 1;
  while (get('SELECT id FROM cash_categories WHERE code = ?', [code])) { i += 1; code = `${base}_${i}`; }
  const maxOrder = get('SELECT COALESCE(MAX(sort_order), 0) AS v FROM cash_categories').v;
  run(`INSERT INTO cash_categories(code, label, direction, is_expense, builtin, sort_order)
       VALUES(?, ?, ?, ?, 0, ?)`,
  [code, label, direction, b.is_expense === false ? 0 : (direction === 'out' ? 1 : 0), maxOrder + 1]);
  logActivity(req.user, 'create', 'cash_category', code, `Khai loại ${direction === 'in' ? 'thu' : 'chi'} "${label}"`);
  res.json(get('SELECT * FROM cash_categories WHERE code = ?', [code]));
});

/** Sửa tên loại, bật tắt, hoặc đổi việc có tính vào chi phí hay không. */
r.put('/cash/categories/:id', (req, res) => {
  const c = get('SELECT * FROM cash_categories WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Không tìm thấy loại thu chi' });
  const b = req.body || {};
  const label = b.label === undefined ? c.label : String(b.label).trim();
  if (!label) return res.status(400).json({ error: 'Tên loại thu chi không được để trống' });
  /* Loại hệ thống không được tắt: chứng từ tự động vẫn ghi vào mã đó mỗi ngày */
  const active = c.builtin ? 1 : (b.active === 0 || b.active === false ? 0 : 1);
  run(`UPDATE cash_categories SET label = ?, is_expense = ?, active = ?, sort_order = ? WHERE id = ?`,
    [label, b.is_expense === undefined ? c.is_expense : (b.is_expense ? 1 : 0), active,
      b.sort_order === undefined ? c.sort_order : Number(b.sort_order) || 0, c.id]);
  logActivity(req.user, 'update', 'cash_category', c.code, `Sửa loại thu chi "${label}"`);
  res.json(get('SELECT * FROM cash_categories WHERE id = ?', [c.id]));
});

/** Xoá một loại tự khai. Đã có phiếu dùng tới thì chỉ ẩn đi. */
r.delete('/cash/categories/:id', (req, res) => {
  const c = get('SELECT * FROM cash_categories WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Không tìm thấy loại thu chi' });
  if (c.builtin) {
    return res.status(400).json({ error: `"${c.label}" là loại hệ thống, chứng từ tự động đang dùng — không xoá được.` });
  }
  const n = get('SELECT COUNT(*) AS n FROM cash_transactions WHERE category = ?', [c.code]).n;
  if (n > 0) {
    run('UPDATE cash_categories SET active = 0 WHERE id = ?', [c.id]);
    logActivity(req.user, 'update', 'cash_category', c.code, `Ẩn loại thu chi "${c.label}"`);
    return res.json({ ok: true, deactivated: true, message: `Đã có ${n} phiếu dùng loại này nên chỉ ẩn đi, không xoá.` });
  }
  run('DELETE FROM cash_categories WHERE id = ?', [c.id]);
  logActivity(req.user, 'delete', 'cash_category', c.code, `Xoá loại thu chi "${c.label}"`);
  res.json({ ok: true });
});

/** Nhãn tiếng Việt của một mã loại, lấy từ danh mục. */
const labelOf = (code) => get('SELECT label FROM cash_categories WHERE code = ?', [code])?.label || code;

/* ========================== TÀI KHOẢN QUỸ ========================== */

r.get('/cash/accounts', (req, res) => {
  const rows = all('SELECT * FROM cash_accounts WHERE active = 1 ORDER BY sort_order, id');
  for (const a of rows) {
    a.balance = accountBalance(a.id);
    const t = get(`
      SELECT COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount END), 0) AS tin,
             COALESCE(SUM(CASE WHEN direction = 'out' THEN amount END), 0) AS tout
      FROM cash_live
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

/**
 * Số dư của một (hoặc mọi) quỹ tính tới TRƯỚC một mốc — dùng cho "tồn đầu kỳ"
 * và cho cột số dư luỹ kế của sổ quỹ.
 *
 * Mốc có thể là một ngày (`before`), hoặc một vị trí trong sổ (`beforeRow`:
 * mọi phiếu cũ hơn phiếu đó). Phiếu đã huỷ không tính — đọc qua `cash_live`.
 */
function balanceBefore({ accountId = null, before = null, beforeRow = null }) {
  const opening = get(`SELECT COALESCE(SUM(opening_balance), 0) AS v FROM cash_accounts
                       ${accountId ? 'WHERE id = ?' : ''}`, accountId ? [accountId] : []).v;

  const where = ['1 = 1'];
  const params = [];
  if (accountId) { where.push('account_id = ?'); params.push(accountId); }
  if (before) { where.push('date(ts) < date(?)'); params.push(before); }
  if (beforeRow) {
    where.push('(ts < ? OR (ts = ? AND id < ?))');
    params.push(beforeRow.ts, beforeRow.ts, beforeRow.id);
  }
  const t = get(`
    SELECT COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount END), 0) AS tin,
           COALESCE(SUM(CASE WHEN direction = 'out' THEN amount END), 0) AS tout
    FROM cash_live WHERE ${where.join(' AND ')}`, params);
  return opening + t.tin - t.tout;
}

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
    ${w}`, params).n;

  /* Sắp theo NGÀY TRÊN PHIẾU chứ không theo số thứ tự: phiếu ghi bù cho hôm
     qua phải nằm đúng chỗ của hôm qua trong sổ. */
  const rows = all(`
    SELECT t.*, a.name AS account_name, a.type AS account_type, u.full_name AS user_name,
           cu.full_name AS cancelled_by_name, c.label AS category_label
    FROM cash_transactions t
    JOIN cash_accounts a ON a.id = t.account_id
    LEFT JOIN users u ON u.id = t.user_id
    LEFT JOIN users cu ON cu.id = t.cancelled_by
    LEFT JOIN cash_categories c ON c.code = t.category
    ${w}
    ORDER BY t.ts DESC, t.id DESC LIMIT ${size} OFFSET ${offset}`, params);

  /* Tổng phát sinh KHÔNG tính phiếu đã huỷ, cũng không tính tiền chuyển quỹ:
     nộp tiền mặt vào ngân hàng không phải là tiệm thu thêm hay chi thêm đồng nào. */
  const liveWhere = [...where, 't.cancelled_at IS NULL'];
  const totals = get(`
    SELECT COALESCE(SUM(CASE WHEN t.direction = 'in'  AND t.category NOT IN ('transfer_in','transfer_out')
                             THEN t.amount END), 0) AS total_in,
           COALESCE(SUM(CASE WHEN t.direction = 'out' AND t.category NOT IN ('transfer_in','transfer_out')
                             THEN t.amount END), 0) AS total_out,
           COALESCE(SUM(CASE WHEN t.category IN ('transfer_in','transfer_out') THEN t.amount END), 0) AS total_transfer
    FROM cash_transactions t WHERE ${liveWhere.join(' AND ')}`, params);

  /* Sổ quỹ kiểu sổ tay: tồn đầu kỳ — phát sinh — tồn cuối kỳ, kèm cột số dư sau
     từng phiếu. Chỉ có nghĩa khi đang xem cả sổ (không lọc loại, không tìm chữ),
     nên lọc gì thêm là tắt cột đó đi cho khỏi hiểu lầm. */
  const ledgerMode = !direction && !category && !partner_type && !q.trim();
  let opening = null;
  let closing = null;
  if (ledgerMode) {
    const accId = account_id ? Number(account_id) : null;
    opening = balanceBefore({ accountId: accId, before: from || null });
    const last = rows[rows.length - 1];
    let running = last ? balanceBefore({ accountId: accId, beforeRow: last }) : opening;
    for (const t of [...rows].reverse()) {
      if (t.cancelled_at) { t.balance = null; continue; }
      running += t.direction === 'in' ? t.amount : -t.amount;
      t.balance = running;
    }
    /* Tồn cuối kỳ = tồn đầu kỳ + phát sinh trong kỳ. Chuyển quỹ tuy không phải
       thu chi của tiệm nhưng vẫn làm đổi số dư của từng quỹ, nên chỗ này tính cả. */
    const move = get(`
      SELECT COALESCE(SUM(CASE WHEN t.direction = 'in'  THEN t.amount END), 0) AS tin,
             COALESCE(SUM(CASE WHEN t.direction = 'out' THEN t.amount END), 0) AS tout
      FROM cash_transactions t WHERE ${liveWhere.join(' AND ')}`, params);
    closing = opening + move.tin - move.tout;
  }

  res.json({
    rows, total, page, page_size: size,
    total_in: totals.total_in, total_out: totals.total_out,
    total_transfer: totals.total_transfer,
    net: totals.total_in - totals.total_out,
    ledger_mode: ledgerMode, opening, closing,
  });
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
           u.full_name AS user_name, cu.full_name AS cancelled_by_name
    FROM cash_transactions t
    JOIN cash_accounts a ON a.id = t.account_id
    LEFT JOIN users u ON u.id = t.user_id
    LEFT JOIN users cu ON cu.id = t.cancelled_by
    WHERE t.id = ?`, [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy phiếu' });
  /* Thu ngân xem lại được một phiếu theo số để in đưa khách — nhưng phiếu ứng lương,
     trả lương là tiền lương của đồng nghiệp: dò số phiếu là đọc được hết (plan 28, §9) */
  if (t.partner_type === 'employee' && !can(req, 'payroll.manage')) {
    return res.status(403).json({ error: 'Phiếu lương nhân viên chỉ chủ tiệm và quản lý xem được.', code: 'NO_PERM' });
  }

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
  t.category_label = labelOf(t.category);
  /* Phiếu chuyển quỹ: kèm phiếu đối ứng để mở phiếu nào cũng thấy chân kia */
  if (t.ref_type === 'cash_transfer' && t.ref_id) {
    t.pair = get(`SELECT t2.id, t2.code, t2.direction, t2.amount, a.name AS account_name
                  FROM cash_transactions t2 JOIN cash_accounts a ON a.id = t2.account_id
                  WHERE t2.id = ?`, [t.ref_id]);
  }
  res.json(t);
});

/** Ngày ghi trên phiếu: không nhận ngày mai trở đi. */
function normTs(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const day = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const today = get("SELECT date('now','localtime') AS d").d;
  if (day > today) {
    throw Object.assign(new Error('Không ghi phiếu cho ngày chưa tới.'), { status: 400, code: 'FUTURE_DATE' });
  }
  /* Ghi bù cho ngày cũ thì lấy giờ hiện tại, để phiếu trong cùng ngày vẫn xếp đúng thứ tự */
  return raw.length > 10 ? raw : `${day} ${get("SELECT time('now','localtime') AS t").t}`;
}

/** Lập phiếu thu / chi thủ công. */
r.post('/cash/transactions', (req, res) => {
  const b = req.body;
  const amount = Math.round(Number(b.amount) || 0);
  if (amount <= 0) return res.status(400).json({ error: 'Số tiền phải lớn hơn 0' });
  if (!['in', 'out'].includes(b.direction)) return res.status(400).json({ error: 'Loại phiếu không hợp lệ' });
  if (!b.account_id) return res.status(400).json({ error: 'Chưa chọn quỹ' });
  if (!b.category) return res.status(400).json({ error: 'Chưa chọn loại thu/chi' });

  let ts;
  try { ts = normTs(b.ts); } catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }

  let partnerName = b.partner_name || null;
  if (b.partner_type === 'customer' && b.partner_id) {
    partnerName = get('SELECT name FROM customers WHERE id = ?', [b.partner_id])?.name || partnerName;
  } else if (b.partner_type === 'supplier' && b.partner_id) {
    partnerName = get('SELECT name FROM suppliers WHERE id = ?', [b.partner_id])?.name || partnerName;
  }

  const t = addCashTx({
    accountId: Number(b.account_id), direction: b.direction, amount, category: b.category,
    partnerType: b.partner_type || null, partnerId: b.partner_id || null, partnerName,
    userId: b.user_id || req.user?.id || null, note: b.note || null, ts,
  });
  logActivity(req.user, 'create', 'cash_tx', t.id,
    `${b.direction === 'in' ? 'Phiếu thu' : 'Phiếu chi'} ${t.code} — ${amount.toLocaleString('vi-VN')} đ (${labelOf(b.category)})`);
  res.json(t);
});

/**
 * Sửa phiếu đã lập — CHỈ diễn giải, đối tượng và ngày.
 *
 * Số tiền, quỹ, loại thu chi thì không cho sửa: ba thứ đó sai thì huỷ phiếu rồi
 * lập lại, để sổ còn dấu vết chứ không phải một con số lặng lẽ đổi.
 */
r.put('/cash/transactions/:id', (req, res) => {
  const t = get('SELECT * FROM cash_transactions WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy phiếu' });
  if (t.cancelled_at) return res.status(400).json({ error: 'Phiếu đã huỷ thì không sửa được nữa.' });
  const b = req.body || {};

  let ts = t.ts;
  if (b.ts !== undefined) {
    try { ts = normTs(b.ts) || t.ts; } catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }
  }
  let partnerType = b.partner_type === undefined ? t.partner_type : (b.partner_type || null);
  let partnerId = b.partner_id === undefined ? t.partner_id : (b.partner_id || null);
  let partnerName = b.partner_name === undefined ? t.partner_name : (b.partner_name || null);
  if (partnerType === 'customer' && partnerId) {
    partnerName = get('SELECT name FROM customers WHERE id = ?', [partnerId])?.name || partnerName;
  } else if (partnerType === 'supplier' && partnerId) {
    partnerName = get('SELECT name FROM suppliers WHERE id = ?', [partnerId])?.name || partnerName;
  }
  const note = b.note === undefined ? t.note : (String(b.note || '').trim() || null);

  run(`UPDATE cash_transactions SET ts = ?, partner_type = ?, partner_id = ?, partner_name = ?, note = ?
       WHERE id = ?`, [ts, partnerType, partnerId, partnerName, note, t.id]);
  logActivity(req.user, 'update', 'cash_tx', t.id, `Sửa phiếu ${t.code}`);
  res.json(get('SELECT * FROM cash_transactions WHERE id = ?', [t.id]));
});

/**
 * HUỶ phiếu (thay cho xoá).
 *
 * Phiếu vẫn nằm trong sổ, đóng dấu đã huỷ, ghi rõ ai huỷ và vì sao; tiền thì
 * không tính nữa. Xoá hẳn như trước là số phiếu đứt quãng mà không ai biết vì sao,
 * và quỹ lệch thì không có đường nào dò lại.
 */
r.post('/cash/transactions/:id/cancel', (req, res) => {
  const t = get('SELECT * FROM cash_transactions WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy phiếu' });
  if (t.cancelled_at) return res.status(400).json({ error: `Phiếu ${t.code} đã huỷ rồi.` });

  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Phải ghi lý do huỷ phiếu.', code: 'NO_REASON' });

  /* Phiếu thu nợ đã xác nhận thì chỉ chủ cửa hàng huỷ được.

     Khách đưa tiền trả nợ, người đứng quầy ghi phiếu thu rồi bỏ đi là tiền biến
     mất khỏi sổ mà khách vẫn tưởng đã trả. */
  if (t.category === 'debt_in' && req.user && req.user.role !== 'owner') {
    return res.status(403).json({
      error: 'Phiếu thu nợ đã xác nhận thì chỉ chủ cửa hàng mới huỷ được.',
      code: 'RECEIPT_LOCKED',
    });
  }
  /* Phiếu sinh từ chứng từ khác thì huỷ chứng từ gốc, trừ cặp chuyển quỹ —
     cặp đó không có chứng từ gốc nào cả, hai chân tự nuôi nhau. */
  if (t.ref_type && t.ref_type !== 'cash_transfer') {
    return res.status(400).json({
      error: `Phiếu này sinh tự động từ chứng từ ${t.ref_code}. Hãy huỷ chứng từ gốc thay vì huỷ phiếu quỹ.`,
    });
  }

  const cancelled = tx(() => {
    const mark = (row) => {
      run(`UPDATE cash_transactions SET cancelled_at = datetime('now','localtime'), cancelled_by = ?, cancel_reason = ?
           WHERE id = ?`, [req.user?.id || null, reason, row.id]);
      logActivity(req.user, 'cancel', 'cash_tx', row.id,
        `Huỷ phiếu ${row.code} — ${row.amount.toLocaleString('vi-VN')} đ. Lý do: ${reason}`);
      return row.code;
    };
    const codes = [mark(t)];
    /* Chuyển quỹ là một cặp: huỷ một chân mà để chân kia là hai quỹ lệch vĩnh viễn */
    if (t.ref_type === 'cash_transfer' && t.ref_id) {
      const pair = get('SELECT * FROM cash_transactions WHERE id = ? AND cancelled_at IS NULL', [t.ref_id]);
      if (pair) codes.push(mark(pair));
    }
    return codes;
  });
  res.json({ ok: true, cancelled });
});

/**
 * Chuyển tiền giữa 2 quỹ (VD: nộp tiền mặt vào ngân hàng).
 *
 * Hai chân phải sống chết có nhau: ghi trong cùng một giao dịch, và nối với nhau
 * bằng ref_type/ref_id để huỷ chân này là chân kia huỷ theo.
 */
r.post('/cash/transfer', (req, res) => {
  const { from_account_id, to_account_id, amount, note } = req.body;
  const amt = Math.round(Number(amount) || 0);
  if (amt <= 0) return res.status(400).json({ error: 'Số tiền phải lớn hơn 0' });
  if (!from_account_id || !to_account_id) return res.status(400).json({ error: 'Chưa chọn đủ hai quỹ' });
  if (Number(from_account_id) === Number(to_account_id)) {
    return res.status(400).json({ error: 'Quỹ nguồn và quỹ đích phải khác nhau' });
  }
  let ts;
  try { ts = normTs(req.body.ts); } catch (e) { return res.status(400).json({ error: e.message, code: e.code }); }

  const from = get('SELECT name FROM cash_accounts WHERE id = ?', [from_account_id]);
  const to = get('SELECT name FROM cash_accounts WHERE id = ?', [to_account_id]);
  if (!from || !to) return res.status(400).json({ error: 'Quỹ không tồn tại' });
  if (accountBalance(Number(from_account_id)) < amt) {
    return res.status(400).json({ error: `Quỹ "${from.name}" không đủ số dư.` });
  }
  const label = note || `Chuyển quỹ ${from.name} sang ${to.name}`;

  const out = tx(() => {
    const o = addCashTx({
      accountId: Number(from_account_id), direction: 'out', amount: amt,
      category: 'transfer_out', note: label, userId: req.user?.id || null, ts,
    });
    const i = addCashTx({
      accountId: Number(to_account_id), direction: 'in', amount: amt,
      category: 'transfer_in', note: label, userId: req.user?.id || null, ts,
    });
    /* Nối hai chân lại với nhau */
    run(`UPDATE cash_transactions SET ref_type = 'cash_transfer', ref_id = ?, ref_code = ? WHERE id = ?`,
      [i.id, i.code, o.id]);
    run(`UPDATE cash_transactions SET ref_type = 'cash_transfer', ref_id = ?, ref_code = ? WHERE id = ?`,
      [o.id, o.code, i.id]);
    logActivity(req.user, 'create', 'cash_transfer', o.id,
      `Chuyển ${amt.toLocaleString('vi-VN')} đ từ "${from.name}" sang "${to.name}" (${o.code} / ${i.code})`);
    return { ok: true, out: o, in: i };
  });
  res.json(out);
});

/** Tổng quan quỹ theo khoảng thời gian: thu/chi theo loại + dòng tiền theo ngày. */
r.get('/cash/summary', (req, res) => {
  const from = req.query.from || new Date(new Date().setDate(1)).toISOString().slice(0, 10);
  const to = req.query.to || new Date().toISOString().slice(0, 10);

  const accounts = all('SELECT * FROM cash_accounts WHERE active = 1 ORDER BY sort_order, id');
  let totalBalance = 0;
  for (const a of accounts) { a.balance = accountBalance(a.id); totalBalance += a.balance; }

  /* Tiền chuyển giữa hai quỹ của chính tiệm thì không phải thu, không phải chi —
     tách riêng ra một con số cho chủ tiệm biết, chứ không cộng vào tổng. */
  const NOT_TRANSFER = "category NOT IN ('transfer_in','transfer_out')";

  const byCategory = all(`
    SELECT t.category, t.direction, SUM(t.amount) AS amount, COUNT(*) AS n,
           c.label AS category_label
    FROM cash_live t LEFT JOIN cash_categories c ON c.code = t.category
    WHERE date(t.ts) BETWEEN date(?) AND date(?)
    GROUP BY t.category, t.direction ORDER BY amount DESC`, [from, to]);

  const daily = all(`
    SELECT date(ts) AS day,
           COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount END), 0) AS tin,
           COALESCE(SUM(CASE WHEN direction = 'out' THEN amount END), 0) AS tout
    FROM cash_live
    WHERE date(ts) BETWEEN date(?) AND date(?) AND ${NOT_TRANSFER}
    GROUP BY date(ts) ORDER BY day`, [from, to]);

  const totals = get(`
    SELECT COALESCE(SUM(CASE WHEN direction = 'in'  AND ${NOT_TRANSFER} THEN amount END), 0) AS total_in,
           COALESCE(SUM(CASE WHEN direction = 'out' AND ${NOT_TRANSFER} THEN amount END), 0) AS total_out,
           COALESCE(SUM(CASE WHEN direction = 'out' AND category = 'transfer_out' THEN amount END), 0) AS total_transfer
    FROM cash_live WHERE date(ts) BETWEEN date(?) AND date(?)`, [from, to]);

  res.json({
    from, to, accounts, total_balance: totalBalance,
    total_in: totals.total_in, total_out: totals.total_out,
    total_transfer: totals.total_transfer,
    net: totals.total_in - totals.total_out,
    by_category: byCategory, daily,
  });
});

export default r;
