/* ====================================================================
   KHÁCH HÀNG VÀ NHÀ CUNG CẤP — MỖI BÊN MỘT HỒ SƠ GỘP CÔNG NỢ

   Đợt 14 (tài liệu 08 và 10): không còn trang "Công nợ khách" và "Công nợ
   NCC" riêng. Hạn mức, tuổi nợ, sổ phụ và nút thu / trả nợ nằm ngay trong
   hồ sơ; danh sách nợ, nợ quá hạn lọc thẳng từ danh mục khách / NCC.

   Nhà cung cấp lớn có nhiều số điện thoại (kinh doanh, kế toán, kho) và
   nhiều tài khoản ngân hàng — mỗi thứ một bảng riêng, có nhãn. Trả nợ bằng
   chuyển khoản thì chọn đúng tài khoản đã lưu, khỏi gõ tay nhầm số.
   ==================================================================== */
import { Router } from 'express';
import {
  all, get, run, tx, customerDebt, supplierDebt, addCashTx, defaultCashAccount,
  searchWhere, logActivity,
} from '../db.js';
import { planAllocation, writeAllocation, debtBreakdown } from '../debt.js';
import { maxDebtDaysFor, posPolicy, isApproverRole, peekApproval, consumeApproval } from '../policy.js';
import { customerBuyers, proxyStats } from '../customers.js';
import { permsOf } from '../permissions.js';

/**
 * Nợ đầu kỳ là con số công nợ (plan 31, 6c).
 *
 * Sửa hồ sơ: không gửi thì giữ nguyên — trước đây thiếu ô này là nợ đầu kỳ
 * bị ghi về 0 âm thầm. Gửi số khác thì từ chối: sửa nợ phải qua "Điều chỉnh
 * công nợ" (PIN, lý do, lưu vết).
 * Lập hồ sơ mới kèm nợ cũ: chỉ người có quyền sửa công nợ.
 */
function openingDebtFor(req, cur) {
  const b = req.body || {};
  const given = !(b.opening_debt === undefined || b.opening_debt === null || b.opening_debt === '');
  const v = given ? Math.round(Number(b.opening_debt) || 0) : (cur?.opening_debt || 0);
  if (cur) {
    if (v !== (cur.opening_debt || 0)) {
      throw Object.assign(new Error('Nợ đầu kỳ không sửa thẳng ở hồ sơ được nữa. Dùng "Điều chỉnh công nợ" — có mã PIN và lưu lại ai sửa, lý do.'),
        { status: 400, code: 'USE_DEBT_ADJUST' });
    }
    return v;
  }
  if (v !== 0 && req.user && !permsOf(req.user.role).includes('debt.adjust')) {
    throw Object.assign(new Error('Lập hồ sơ kèm nợ cũ cần chủ cửa hàng hoặc quản lý. Để nợ đầu kỳ 0 rồi nhờ chủ / quản lý điều chỉnh công nợ.'),
      { status: 403, code: 'NO_PERM', need: 'debt.adjust' });
  }
  return v;
}

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

/** Các số điện thoại của một NCC, kèm nhãn bộ phận. */
export function supplierPhones(supplierId) {
  return all(`SELECT id, phone, label FROM supplier_phones
              WHERE supplier_id = ? ORDER BY sort_order, id`, [supplierId]);
}

/** Các tài khoản ngân hàng của một NCC. */
export function supplierBanks(supplierId) {
  return all(`SELECT id, bank_name, account_no, holder, label FROM supplier_bank_accounts
              WHERE supplier_id = ? ORDER BY sort_order, id`, [supplierId]);
}

/** Phiếu nhập còn nợ đã quá hạn trả của một NCC. */
function supplierOverdue(supplierId) {
  return get(`
    SELECT COALESCE(SUM(total - paid), 0) AS amount, COUNT(*) AS n FROM purchases
    WHERE supplier_id = ? AND status = 'done' AND total > paid
      AND due_date IS NOT NULL AND date(due_date) < date('now','localtime')`, [supplierId]);
}

const clean = (v) => String(v ?? '').trim();

/** Soát danh sách tài khoản gửi lên. Trả về câu báo lỗi, hoặc chuỗi rỗng. */
function contactError(b) {
  if (!Array.isArray(b.bank_accounts)) return '';
  for (const [i, a] of b.bank_accounts.entries()) {
    const bank = clean(a?.bank_name);
    const no = clean(a?.account_no);
    if (!bank && !no && !clean(a?.holder) && !clean(a?.label)) continue;   // dòng trống bỏ qua
    if (!bank || !no) return `Tài khoản ngân hàng thứ ${i + 1} phải có đủ tên ngân hàng và số tài khoản.`;
  }
  return '';
}

/**
 * Ghi lại danh sách SĐT / tài khoản ngân hàng (gửi mảng nào thì thay mảng đó).
 * Cột phone / bank_account cũ vẫn giữ số đầu tiên: phiếu nhập, báo cáo,
 * màn hình cũ còn đọc hai cột này.
 */
function saveContacts(supplierId, b) {
  if (Array.isArray(b.phones)) {
    run('DELETE FROM supplier_phones WHERE supplier_id = ?', [supplierId]);
    b.phones
      .map((p) => ({ phone: clean(p?.phone), label: clean(p?.label) || null }))
      .filter((p) => p.phone)
      .forEach((p, i) => run(
        'INSERT INTO supplier_phones(supplier_id, phone, label, sort_order) VALUES(?, ?, ?, ?)',
        [supplierId, p.phone, p.label, i]));
    run('UPDATE suppliers SET phone = ? WHERE id = ?', [supplierPhones(supplierId)[0]?.phone || null, supplierId]);
  }
  if (Array.isArray(b.bank_accounts)) {
    run('DELETE FROM supplier_bank_accounts WHERE supplier_id = ?', [supplierId]);
    b.bank_accounts
      .map((a) => ({
        bank_name: clean(a?.bank_name), account_no: clean(a?.account_no),
        holder: clean(a?.holder) || null, label: clean(a?.label) || null,
      }))
      .filter((a) => a.bank_name && a.account_no)
      .forEach((a, i) => run(
        `INSERT INTO supplier_bank_accounts(supplier_id, bank_name, account_no, holder, label, sort_order)
         VALUES(?, ?, ?, ?, ?, ?)`,
        [supplierId, a.bank_name, a.account_no, a.holder, a.label, i]));
    const first = supplierBanks(supplierId)[0];
    run('UPDATE suppliers SET bank_account = ? WHERE id = ?',
      [first ? `${first.account_no} - ${first.bank_name}` : null, supplierId]);
  }
}

r.get('/suppliers', (req, res) => {
  const { q = '', active, filter = '', match = 'contains' } = req.query;
  const where = [];
  const params = [];
  if (q.trim()) {
    /* Tìm chính xác thì khớp cả chuỗi — quét mã NCC hay dán đúng số điện
       thoại thì không muốn ra thêm mấy mối tên gần giống (tài liệu 13).
       Tìm có chứa thì không bắt đúng thứ tự từ (tài liệu 16, mục 3). */
    const c = searchWhere(
      ['s.name', 's.code', 's.phone', 's.contact_name',
        '(SELECT GROUP_CONCAT(sp.phone) FROM supplier_phones sp WHERE sp.supplier_id = s.id)'],
      q, match);
    where.push(c.sql);
    params.push(...c.params);
  }
  if (active !== undefined && active !== '') { where.push('s.active = ?'); params.push(Number(active)); }
  let rows = all(`SELECT s.* FROM suppliers s ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.name`, params);
  for (const s of rows) {
    s.debt = supplierDebt(s.id);
    const agg = get(
      `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS n, MAX(ts) AS last_ts
       FROM purchases WHERE supplier_id = ? AND status = 'done'`, [s.id]);
    s.total_purchased = agg.total;
    s.purchase_count = agg.n;
    s.last_purchase = agg.last_ts;
    s.phones = supplierPhones(s.id);
    s.bank_count = get('SELECT COUNT(*) AS n FROM supplier_bank_accounts WHERE supplier_id = ?', [s.id]).n;
    const od = supplierOverdue(s.id);
    s.overdue_amount = od.amount;
    s.overdue_count = od.n;
    s.unpaid_bills = get(
      "SELECT COUNT(*) AS n FROM purchases WHERE supplier_id = ? AND status = 'done' AND total > paid", [s.id]).n;
  }
  if (filter === 'debt') rows = rows.filter((s) => s.debt > 0);
  if (filter === 'overdue') rows = rows.filter((s) => s.overdue_count > 0);
  res.json(rows);
});

r.get('/suppliers/:id', (req, res) => {
  const s = get('SELECT * FROM suppliers WHERE id = ?', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp' });
  s.debt = supplierDebt(s.id);
  s.phones = supplierPhones(s.id);
  s.bank_accounts = supplierBanks(s.id);
  const od = supplierOverdue(s.id);
  s.overdue_amount = od.amount;
  s.overdue_count = od.n;
  s.purchases = all(`
    SELECT p.id, p.code, p.ts, p.total, p.paid, p.status, p.supplier_invoice, p.due_date,
           (SELECT COUNT(*) FROM purchase_custom_items ci WHERE ci.purchase_id = p.id) AS custom_count,
           CASE WHEN p.status = 'done' AND p.total > p.paid AND p.due_date IS NOT NULL
                     AND date(p.due_date) < date('now','localtime') THEN 1 ELSE 0 END AS is_overdue
    FROM purchases p WHERE p.supplier_id = ? ORDER BY p.id DESC LIMIT 200`, [s.id]);
  s.returns = all(`
    SELECT pr.id, pr.code, pr.ts, pr.subtotal, pr.expense, pr.total, pr.refunded, pr.reason, pr.mode,
           pr.sent_at, pr.received_at, pr.settle_method,
           p.code AS purchase_code
    FROM purchase_returns pr LEFT JOIN purchases p ON p.id = pr.purchase_id
    WHERE pr.supplier_id = ? ORDER BY pr.id DESC LIMIT 200`, [s.id]);
  s.payments = all(`
    SELECT t.*, a.name AS account_name, u.full_name AS user_name, cc.label AS category_label
    FROM cash_live t
    LEFT JOIN cash_accounts a ON a.id = t.account_id
    LEFT JOIN users u ON u.id = t.user_id
    LEFT JOIN cash_categories cc ON cc.code = t.category
    WHERE t.partner_type = 'supplier' AND t.partner_id = ? ORDER BY t.id DESC LIMIT 200`, [s.id]);
  /* Phiếu còn nợ, cũ nhất trước — để kế toán thấy nên trả phiếu nào */
  s.unpaid = all(`
    SELECT id, code, ts, total, paid, (total - paid) AS remaining, due_date,
           CAST(julianday('now','localtime') - julianday(ts) AS INTEGER) AS age_days,
           CASE WHEN due_date IS NOT NULL AND date(due_date) < date('now','localtime') THEN 1 ELSE 0 END AS is_overdue
    FROM purchases WHERE supplier_id = ? AND status = 'done' AND total > paid
    ORDER BY ts, id`, [s.id]);
  res.json(s);
});

/* ==================================================================== *
 * BẢNG BÁO GIÁ CỦA NCC (tài liệu 15, mục 4.3)
 *
 * Mối báo giá bao nhiêu cho từng mã hàng thì lưu lại đây. Lúc lập phiếu mua
 * tạm từ phiếu báo hết hàng, hệ thống ƯU TIÊN lấy đúng con số mối đã báo;
 * chưa có báo giá thì rơi về giá nhập gần nhất rồi tới giá vốn.
 * ==================================================================== */

export function supplierQuotes(supplierId) {
  return all(`
    SELECT ps.product_id, ps.quote_price, ps.quote_at, ps.quote_note, ps.last_price,
           ps.supplier_sku, ps.is_primary,
           p.name, p.sku, p.base_unit, p.cost_price, p.active AS product_active
    FROM product_suppliers ps JOIN products p ON p.id = ps.product_id
    WHERE ps.supplier_id = ?
    ORDER BY ps.quote_price > 0 DESC, p.name`, [supplierId]);
}

r.get('/suppliers/:id/quotes', (req, res) => {
  if (!get('SELECT id FROM suppliers WHERE id = ?', [req.params.id])) {
    return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp' });
  }
  res.json({ rows: supplierQuotes(Number(req.params.id)) });
});

/** Lưu báo giá cho một hoặc nhiều mã hàng. Giá 0 = xoá báo giá của mã đó. */
r.put('/suppliers/:id/quotes', (req, res) => {
  const sid = Number(req.params.id);
  if (!get('SELECT id FROM suppliers WHERE id = ?', [sid])) {
    return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp' });
  }
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  try {
    tx(() => {
      for (const x of rows) {
        const pid = Number(x.product_id) || 0;
        if (!pid || !get('SELECT id FROM products WHERE id = ?', [pid])) continue;
        const price = Math.max(0, Math.round(Number(x.quote_price) || 0));
        run(`INSERT INTO product_suppliers(product_id, supplier_id, quote_price, quote_at, quote_note, supplier_sku)
             VALUES(?, ?, ?, CASE WHEN ? > 0 THEN datetime('now','localtime') ELSE NULL END, ?, ?)
             ON CONFLICT(product_id, supplier_id) DO UPDATE SET
               quote_price = excluded.quote_price,
               quote_at = excluded.quote_at,
               quote_note = excluded.quote_note,
               supplier_sku = COALESCE(excluded.supplier_sku, product_suppliers.supplier_sku)`,
        [pid, sid, price, price, String(x.quote_note ?? '').trim() || null,
          String(x.supplier_sku ?? '').trim() || null]);
      }
    });
    res.json({ ok: true, rows: supplierQuotes(sid) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

r.post('/suppliers', (req, res) => {
  const b = req.body;
  if (!b.name?.trim()) return res.status(400).json({ error: 'Thiếu tên nhà cung cấp' });
  const bad = contactError(b);
  if (bad) return res.status(400).json({ error: bad, code: 'BAD_BANK_ACCOUNT' });
  let openingDebt;
  try { openingDebt = openingDebtFor(req, null); } catch (e) { return gateError(res, e); }
  const code = b.code?.trim() || genCode('suppliers', 'NCC');
  if (get('SELECT id FROM suppliers WHERE code = ?', [code])) {
    return res.status(400).json({ error: `Mã "${code}" đã tồn tại` });
  }
  const id = tx(() => {
    const info = run(`
      INSERT INTO suppliers(code, name, contact_name, phone, email, address, tax_code,
                            bank_account, opening_debt, term_days, note, active)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [code, b.name.trim(), b.contact_name || null, b.phone || null, b.email || null,
        b.address || null, b.tax_code || null, b.bank_account || null,
        openingDebt, Number(b.term_days) || 0, b.note || null]);
    const newId = Number(info.lastInsertRowid);
    /* Màn hình cũ chỉ gửi một ô phone: coi đó là số đầu tiên */
    saveContacts(newId, {
      ...b,
      phones: Array.isArray(b.phones) ? b.phones : (clean(b.phone) ? [{ phone: b.phone }] : []),
    });
    return newId;
  });
  res.json({ ...get('SELECT * FROM suppliers WHERE id = ?', [id]), phones: supplierPhones(id), bank_accounts: supplierBanks(id) });
});

r.put('/suppliers/:id', (req, res) => {
  const b = req.body;
  const cur = get('SELECT * FROM suppliers WHERE id = ?', [req.params.id]);
  if (!cur) return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp' });
  const bad = contactError(b);
  if (bad) return res.status(400).json({ error: bad, code: 'BAD_BANK_ACCOUNT' });
  let openingDebt;
  try { openingDebt = openingDebtFor(req, cur); } catch (e) { return gateError(res, e); }
  tx(() => {
    run(`UPDATE suppliers SET name = ?, contact_name = ?, phone = ?, email = ?, address = ?,
           tax_code = ?, bank_account = ?, opening_debt = ?, term_days = ?, note = ?, active = ?
         WHERE id = ?`,
      [b.name ?? cur.name, b.contact_name || null, b.phone ?? cur.phone ?? null, b.email || null,
        b.address || null, b.tax_code || null, b.bank_account ?? cur.bank_account ?? null,
        openingDebt, Number(b.term_days) || 0, b.note || null,
        b.active === 0 ? 0 : 1, cur.id]);
    saveContacts(cur.id, b);
  });
  res.json({ ...get('SELECT * FROM suppliers WHERE id = ?', [cur.id]),
    phones: supplierPhones(cur.id), bank_accounts: supplierBanks(cur.id) });
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

/**
 * Trả nợ nhà cung cấp (phiếu chi). Chuyển khoản thì chọn một tài khoản đã
 * lưu của NCC: phiếu chi ghi lại đúng số tài khoản đã chuyển tới, để đối
 * chiếu sao kê ngân hàng về sau.
 */
r.post('/suppliers/:id/pay', (req, res) => {
  const s = get('SELECT * FROM suppliers WHERE id = ?', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp' });
  const amount = Math.round(Number(req.body.amount) || 0);
  if (amount <= 0) return res.status(400).json({ error: 'Số tiền phải lớn hơn 0' });
  const accountId = Number(req.body.account_id) || defaultCashAccount();
  if (!accountId) return res.status(400).json({ error: 'Chưa thiết lập quỹ tiền' });

  let counterparty = null;
  const bankId = Number(req.body.bank_account_id) || null;
  if (bankId) {
    const ba = get('SELECT * FROM supplier_bank_accounts WHERE id = ? AND supplier_id = ?', [bankId, s.id]);
    if (!ba) {
      return res.status(400).json({ error: 'Tài khoản ngân hàng này không thuộc nhà cung cấp đang trả nợ.', code: 'BANK_NOT_OF_SUPPLIER' });
    }
    counterparty = `${ba.bank_name} ${ba.account_no}${ba.holder ? ` - ${ba.holder}` : ''}${ba.label ? ` [${ba.label}]` : ''}`;
  }

  const out = tx(() => {
    const before = supplierDebt(s.id);
    const t = addCashTx({
      accountId, direction: 'out', amount, category: 'debt_out',
      partnerType: 'supplier', partnerId: s.id, partnerName: s.name,
      userId: req.body.user_id || req.user?.id || null,
      note: req.body.note || (counterparty
        ? `Trả nợ NCC ${s.name} — chuyển khoản tới ${counterparty}`
        : `Trả nợ NCC ${s.name}`),
      ts: req.body.ts || null,
    });
    const after = supplierDebt(s.id);
    if (t) {
      /* Chốt số nợ trước và sau ngay vào phiếu: in lại phiếu cũ sau vài tháng
         phải ra đúng con số hôm đó, không phải số nợ hôm nay (tài liệu 14) */
      run('UPDATE cash_transactions SET counterparty_account = ?, debt_before = ?, debt_after = ? WHERE id = ?',
        [counterparty, before, after, t.id]);
    }
    return {
      ok: true,
      transaction: t ? { ...t, counterparty_account: counterparty, debt_before: before, debt_after: after } : null,
      debt: after, debt_before: before,
    };
  });
  res.json(out);
});

/* ============================ KHÁCH HÀNG ============================ */

/** Loại khách: thành viên, VIP, khách sỉ. */
export const CUSTOMER_TYPES = ['member', 'vip', 'wholesale'];
const normType = (v) => (CUSTOMER_TYPES.includes(v) ? v : 'member');

/** Số ngày nợ tối đa riêng của khách. Rỗng = theo chính sách chung của tiệm. */
const normDays = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v))
  ? null : Math.max(0, Math.round(Number(v))));

/* ==================================================================== *
 * BA SỐ ĐIỆN THOẠI CỦA MỘT KHÁCH (tài liệu 14, mục 4)
 *
 * Nhà thầu hay đưa số của mình, của vợ, của thợ. Gõ số nào cũng phải ra
 * đúng một hồ sơ, nên cả ba ô đều được tra khi tìm.
 *
 * Một số KHÔNG được thuộc hai hồ sơ khác nhau: trùng số là lát nữa thu
 * ngân chọn nhầm khách và ghi nợ sang người khác.
 * ==================================================================== */

export const PHONE_FIELDS = ['phone', 'phone2', 'phone3'];
const PHONE_LABEL = { phone: 'SĐT 1', phone2: 'SĐT 2', phone3: 'SĐT 3' };

/** Ba ô số điện thoại sau khi dọn: bỏ khoảng trắng, ô rỗng thành null. */
function phoneValues(b, cur = null) {
  const out = {};
  for (const f of PHONE_FIELDS) {
    out[f] = b[f] === undefined ? (cur ? cur[f] ?? null : null) : (clean(b[f]) || null);
  }
  return out;
}

/**
 * Soát ba số của một hồ sơ. Trả về câu báo lỗi, hoặc chuỗi rỗng nếu sạch.
 * excludeId là hồ sơ đang sửa — chính nó không tính là trùng.
 */
function phoneError(values, excludeId = null) {
  const seen = new Map();
  for (const f of PHONE_FIELDS) {
    const v = values[f];
    if (!v) continue;
    if (seen.has(v)) {
      return `${PHONE_LABEL[f]} trùng với ${PHONE_LABEL[seen.get(v)]} của chính khách này.`;
    }
    seen.set(v, f);
    /* Số phụ chỉ có nghĩa khi đã có số chính: hồ sơ có SĐT 2 mà bỏ trống
       SĐT 1 thì mọi màn hình hiện số trống, nhìn như khách không có số. */
    if (f !== 'phone' && !values.phone) {
      return `Điền ${PHONE_LABEL.phone} trước khi thêm ${PHONE_LABEL[f]}.`;
    }
    const dup = get(`
      SELECT id, code, name FROM customers
      WHERE id <> COALESCE(?, -1) AND (phone = ? OR phone2 = ? OR phone3 = ?)
      LIMIT 1`, [excludeId ?? null, v, v, v]);
    if (dup) {
      return `Số ${v} (${PHONE_LABEL[f]}) đang là số của khách "${dup.name}" (${dup.code}).`
        + ' Một số điện thoại chỉ thuộc một hồ sơ khách.';
    }
  }
  return '';
}

/**
 * Hạn mức nợ và số ngày nợ tối đa là chốt chặn bán nợ của tài liệu 05: thu
 * ngân bán vượt hạn mức phải xin PIN quản lý. Thu ngân mà tự nâng được hạn
 * mức trong hồ sơ khách thì chốt đó vô nghĩa — nên đổi hai con số này cũng
 * phải là chủ / quản lý, hoặc có phiếu duyệt PIN. Tắt đăng nhập thì một máy
 * dùng chung, coi như toàn quyền. Trả về phiếu duyệt cần huỷ sau khi lưu.
 */
function creditGate(req, cur, limit, days) {
  const changed = limit !== (cur?.debt_limit || 0) || (days ?? null) !== (cur?.max_debt_days ?? null);
  if (!changed) return null;
  const actor = req.user;
  if (actor === undefined || isApproverRole(actor?.role)) return null;
  const token = req.body?.approval_token;
  if (!peekApproval(token)) {
    throw Object.assign(
      new Error('Đổi hạn mức nợ hoặc số ngày nợ tối đa cần chủ tiệm / quản lý nhập mã PIN để duyệt.'),
      { status: 400, code: 'CREDIT_APPROVAL', needs_approval: true });
  }
  return token;
}
const gateError = (res, e) => res.status(e.status || 400).json({
  error: e.message, code: e.code, needs_approval: e.needs_approval === true,
  ...(e.need ? { need: e.need } : {}),
});

/** Chi tiết công nợ để lọc và hiện cảnh báo: bao nhiêu hoá đơn nợ, nợ lâu nhất bao lâu, quá hạn chưa. */
function debtDetail(c) {
  const bd = debtBreakdown(c.id);
  const maxDays = maxDebtDaysFor(c.id);
  const unpaid = (bd?.invoices || []).filter((i) => i.remaining > 0);
  const oldest = unpaid[0] || null;          // hoá đơn xếp cũ nhất trước
  return {
    unpaid_bills: unpaid.length,
    oldest_unpaid: oldest?.ts || null,
    oldest_days: oldest?.age_days || 0,
    max_debt_days_effective: maxDays,
    overdue_count: maxDays > 0 ? unpaid.filter((i) => i.age_days > maxDays).length : 0,
    over_limit: c.debt_limit > 0 && c.debt > c.debt_limit,
  };
}

r.get('/customers', (req, res) => {
  const { q = '', active, has_debt, filter = '', type = '', detail, match = 'contains' } = req.query;
  const where = [];
  const params = [];
  if (q.trim()) {
    /* Tra đồng thời cả ba số điện thoại (tài liệu 14, mục 4.2): gõ số phụ
       của bà vợ cũng phải ra đúng hồ sơ nhà thầu đó. */
    const c = searchWhere(
      ['c.name', 'c.code', 'c.phone', 'c.phone2', 'c.phone3', 'c.company_name'], q, match);
    where.push(c.sql);
    params.push(...c.params);
  }
  if (active !== undefined && active !== '') { where.push('c.active = ?'); params.push(Number(active)); }
  if (CUSTOMER_TYPES.includes(type)) { where.push('c.customer_type = ?'); params.push(type); }
  const sql = `
    SELECT c.*, pl.name AS price_list_name
    FROM customers c LEFT JOIN price_lists pl ON pl.id = c.price_list_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.name`;
  let rows = all(sql, params);
  const wantDetail = detail === '1' || ['overdue', 'over_limit'].includes(filter);
  for (const c of rows) {
    c.debt = customerDebt(c.id);
    const agg = get(
      `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS n, MAX(ts) AS last_ts
       FROM sales WHERE customer_id = ? AND status = 'done'`, [c.id]);
    c.total_spent = agg.total;
    c.order_count = agg.n;
    c.last_order = agg.last_ts;
    /* Điểm tích luỹ (yêu cầu 28/09, mục IV.1) — số dư là tổng sổ điểm */
    c.points = get('SELECT COALESCE(SUM(points), 0) AS n FROM loyalty_entries WHERE customer_id = ?', [c.id]).n;
    /* Bóc nợ theo từng hoá đơn tốn công hơn, chỉ làm khi màn hình cần */
    if (wantDetail) Object.assign(c, debtDetail(c));
  }
  if (has_debt === '1' || filter === 'debt') rows = rows.filter((c) => c.debt > 0);
  if (filter === 'overdue') rows = rows.filter((c) => c.overdue_count > 0);
  if (filter === 'over_limit') rows = rows.filter((c) => c.over_limit);
  res.json(rows);
});

/**
 * Hồ sơ khách hàng thống nhất (tài liệu 08): thông tin hành chính + người mua
 * hộ liên kết, lịch sử mua sắm, và số liệu công nợ. Sổ phụ chi tiết lấy ở
 * /customers/:id/ledger.
 */
r.get('/customers/:id', (req, res) => {
  const c = get(`
    SELECT c.*, pl.name AS price_list_name
    FROM customers c LEFT JOIN price_lists pl ON pl.id = c.price_list_id
    WHERE c.id = ?`, [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
  c.debt = customerDebt(c.id);
  Object.assign(c, debtDetail(c));
  c.shop_max_debt_days = posPolicy().maxDebtDays;
  c.buyers = customerBuyers(c.id);
  c.proxy = proxyStats(c.id);
  const agg = get(
    `SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS n, MAX(ts) AS last_ts
     FROM sales WHERE customer_id = ? AND status = 'done'`, [c.id]);
  c.total_spent = agg.total;
  c.order_count = agg.n;
  c.last_order = agg.last_ts;
  c.sales = all(`
    SELECT s.id, s.code, s.ts, s.total, s.paid, s.payment_method, s.status, s.is_vat_invoice,
           s.delivery_status, s.cod_status, s.buyer_name,
           (SELECT COUNT(*) FROM warranty_tickets wt WHERE wt.sale_id = s.id AND wt.status <> 'cancelled') AS warranty_count
    FROM sales s WHERE s.customer_id = ? ORDER BY s.id DESC LIMIT 100`, [c.id]);
  c.returns = all(
    'SELECT id, code, ts, total, refunded, reason FROM sale_returns WHERE customer_id = ? ORDER BY id DESC LIMIT 50',
    [c.id]);
  c.payments = all(
    `SELECT * FROM cash_live
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
  /* Lưu nhanh người mua hộ: khách định danh bằng số điện thoại (tài liệu 03).
     Đã có hồ sơ cùng số thì dùng lại, không đẻ thêm một hồ sơ trùng. */
  if (b.dedupe_phone && String(b.phone || '').trim()) {
    /* Người mua hộ định danh bằng số điện thoại — tra cả ba ô, vì số đó có
       thể đang là số phụ của một hồ sơ đã có (tài liệu 14, mục 4.2) */
    const p = String(b.phone).trim();
    const same = get(`SELECT * FROM customers
                      WHERE (phone = ? OR phone2 = ? OR phone3 = ?) AND active = 1
                      ORDER BY id LIMIT 1`, [p, p, p]);
    if (same) return res.json({ ...same, existing: true });
  }
  if (!b.name?.trim()) return res.status(400).json({ error: 'Thiếu tên khách hàng' });
  const code = b.code?.trim() || genCode('customers', 'KH');
  if (get('SELECT id FROM customers WHERE code = ?', [code])) {
    return res.status(400).json({ error: `Mã "${code}" đã tồn tại` });
  }
  const phones = phoneValues(b);
  const badPhone = phoneError(phones, null);
  if (badPhone) return res.status(400).json({ error: badPhone, code: 'PHONE_TAKEN' });
  const limit = Math.max(0, Math.round(Number(b.debt_limit) || 0));
  const days = normDays(b.max_debt_days);
  let token;
  let openingDebt;
  try {
    openingDebt = openingDebtFor(req, null);
    token = creditGate(req, null, limit, days);
  } catch (e) { return gateError(res, e); }
  const info = run(`
    INSERT INTO customers(code, name, phone, phone2, phone3, email, address, tax_code, company_name,
                          price_list_id, opening_debt, debt_limit, birthday, note, active,
                          customer_type, max_debt_days)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [code, b.name.trim(), phones.phone, phones.phone2, phones.phone3,
      b.email || null, b.address || null,
      b.tax_code || null, b.company_name || null, b.price_list_id || null,
      openingDebt, limit,
      b.birthday || null, b.note || null, normType(b.customer_type), days]);
  if (token) consumeApproval(token);
  res.json(get('SELECT * FROM customers WHERE id = ?', [Number(info.lastInsertRowid)]));
});

r.put('/customers/:id', (req, res) => {
  const b = req.body;
  const cur = get('SELECT * FROM customers WHERE id = ?', [req.params.id]);
  if (!cur) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
  /* Màn hình cũ không gửi các trường này: giữ nguyên giá trị đang có */
  const type = b.customer_type === undefined ? cur.customer_type : normType(b.customer_type);
  const days = b.max_debt_days === undefined ? cur.max_debt_days : normDays(b.max_debt_days);
  const limit = b.debt_limit === undefined ? cur.debt_limit : Math.max(0, Math.round(Number(b.debt_limit) || 0));
  const phones = phoneValues(b, cur);
  const badPhone = phoneError(phones, cur.id);
  if (badPhone) return res.status(400).json({ error: badPhone, code: 'PHONE_TAKEN' });
  let token;
  let openingDebt;
  try {
    openingDebt = openingDebtFor(req, cur);
    token = creditGate(req, cur, limit, days);
  } catch (e) { return gateError(res, e); }
  run(`UPDATE customers SET name = ?, phone = ?, phone2 = ?, phone3 = ?, email = ?, address = ?, tax_code = ?,
         company_name = ?, price_list_id = ?, opening_debt = ?, debt_limit = ?,
         birthday = ?, note = ?, active = ?, customer_type = ?, max_debt_days = ?
       WHERE id = ?`,
    [b.name ?? cur.name, phones.phone, phones.phone2, phones.phone3,
      b.email || null, b.address || null, b.tax_code || null,
      b.company_name || null, b.price_list_id || null, openingDebt,
      limit, b.birthday || null, b.note || null,
      b.active === 0 ? 0 : 1, type, days, cur.id]);
  if (token) consumeApproval(token);
  res.json(get('SELECT * FROM customers WHERE id = ?', [cur.id]));
});

/**
 * Chỉnh riêng hạn mức nợ và số ngày nợ tối đa từ tab Công nợ của hồ sơ —
 * không phải gửi lại cả hồ sơ, tránh vô tình ghi đè thông tin người khác
 * đang sửa.
 */
r.put('/customers/:id/credit', (req, res) => {
  const cur = get('SELECT * FROM customers WHERE id = ?', [req.params.id]);
  if (!cur) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
  const limit = req.body.debt_limit === undefined ? cur.debt_limit : Math.max(0, Math.round(Number(req.body.debt_limit) || 0));
  const days = req.body.max_debt_days === undefined ? cur.max_debt_days : normDays(req.body.max_debt_days);
  let token;
  try { token = creditGate(req, cur, limit, days); } catch (e) { return gateError(res, e); }
  run('UPDATE customers SET debt_limit = ?, max_debt_days = ? WHERE id = ?', [limit, days, cur.id]);
  if (token) consumeApproval(token);
  const c = get('SELECT * FROM customers WHERE id = ?', [cur.id]);
  c.debt = customerDebt(c.id);
  res.json({ ...c, ...debtDetail(c) });
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

/* ==================================================================== *
 * GHI CHÚ HÀNG ĐẶC THÙ THEO TỪNG KHÁCH (tài liệu 24, phần 3)
 *
 * Mỗi nhà thầu gọi món theo kiểu của họ: "dây gân", "ống nhỏ", "cái cùi
 * chỏ". Thu ngân mới vào không biết đó là món gì trong kho. Bảng này nối
 * TÊN KHÁCH GỌI với MÃ HÀNG THẬT, kèm một câu nhắc.
 *
 * Gõ tên khách gọi ngoài màn hình bán hàng thì món thật nhảy lên đầu lưới.
 * ==================================================================== */

r.get('/customers/:id/product-notes', (req, res) => {
  res.json(all(`
    SELECT n.*, p.sku, p.name AS product_name, p.base_unit
    FROM customer_product_notes n
    LEFT JOIN products p ON p.id = n.product_id
    WHERE n.customer_id = ?
    ORDER BY n.sort_order, n.id`, [req.params.id]));
});

r.post('/customers/:id/product-notes', (req, res) => {
  const c = get('SELECT id FROM customers WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
  const alias = String(req.body?.alias || '').trim();
  if (!alias) return res.status(400).json({ error: 'Bắt buộc nhập tên khách quen gọi.' });
  const info = run(`INSERT INTO customer_product_notes(customer_id, alias, product_id, note, sort_order)
                    VALUES(?, ?, ?, ?, ?)`,
    [c.id, alias, Number(req.body.product_id) || null, req.body.note || null,
      Number(req.body.sort_order) || 0]);
  res.json(get('SELECT * FROM customer_product_notes WHERE id = ?', [Number(info.lastInsertRowid)]));
});

r.put('/product-notes/:id', (req, res) => {
  const n = get('SELECT * FROM customer_product_notes WHERE id = ?', [req.params.id]);
  if (!n) return res.status(404).json({ error: 'Không tìm thấy ghi chú' });
  const alias = String(req.body?.alias ?? n.alias).trim();
  if (!alias) return res.status(400).json({ error: 'Bắt buộc nhập tên khách quen gọi.' });
  run(`UPDATE customer_product_notes SET alias = ?, product_id = ?, note = ?, sort_order = ?
       WHERE id = ?`,
    [alias,
      req.body.product_id === undefined ? n.product_id : (Number(req.body.product_id) || null),
      req.body.note ?? n.note, Number(req.body.sort_order ?? n.sort_order) || 0, n.id]);
  res.json(get('SELECT * FROM customer_product_notes WHERE id = ?', [n.id]));
});

r.delete('/product-notes/:id', (req, res) => {
  run('DELETE FROM customer_product_notes WHERE id = ?', [req.params.id]);
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

  /* Thu nợ chỉ định hoá đơn (tài liệu 05): tích chọn hoá đơn nào thì trả vào
     đúng hoá đơn đó, không chọn thì trả dần từ khoản cũ nhất (FIFO). */
  const saleIds = Array.isArray(req.body.sale_ids) ? req.body.sale_ids : [];
  const out = tx(() => {
    /* Số nợ trước khi thu, để in lên phiếu K80 (tài liệu 14, mục 1.2) */
    const before = customerDebt(c.id);
    /* Chia tiền TRƯỚC khi ghi phiếu thu — xem chú thích ở planAllocation:
       làm sau thì một khoản tiền bị trừ hai lần */
    const plan = planAllocation(c.id, amount, saleIds);
    /* Ghi rõ ai thu, để cuối ngày chủ tiệm đối chiếu được phiếu thu với
       người đứng quầy — nhất là khi thu ngân cũng được phép thu nợ. */
    const t = addCashTx({
      accountId, direction: 'in', amount, category: 'debt_in',
      partnerType: 'customer', partnerId: c.id, partnerName: c.name,
      userId: req.body.user_id || req.user?.id || null,
      note: req.body.note || (plan.rows.length
        ? `Khách ${c.name} trả nợ ${plan.rows.map((x) => x.code).join(', ')}`
        : `Khách ${c.name} trả nợ`),
      ts: req.body.ts || null,
    });
    writeAllocation(t.id, plan);
    const after = customerDebt(c.id);
    run('UPDATE cash_transactions SET debt_before = ?, debt_after = ? WHERE id = ?',
      [before, after, t.id]);
    return {
      ok: true, transaction: { ...t, debt_before: before, debt_after: after },
      allocations: plan.rows, to_opening: plan.to_opening, overpaid: plan.unallocated,
      debt: after, debt_before: before,
    };
  });
  res.json(out);
});

/* ==================================================================== *
 * NHẬP KHÁCH HÀNG / NHÀ CUNG CẤP TỪ EXCEL (10/10/2026)
 *
 * Cùng nếp với nhập hàng hoá: máy khách đọc file, ghép cột, gửi các dòng
 * lên. `dry_run: true` chỉ KIỂM — trả từng lỗi, từng cảnh báo theo số dòng
 * thật trong file, kèm hồ sơ nào sẽ đổi gì. Có một lỗi là KHÔNG ghi dòng nào.
 *
 * Hai chế độ:
 *   create — chỉ thêm mới; mã đã có trong máy là lỗi.
 *   update — mã đã có thì sửa hồ sơ đó (chủ tiệm chốt 10/10); ô để trống thì
 *            GIỮ NGUYÊN số cũ, không xoá. Mã chưa có thì thêm mới.
 *
 * Cố ý KHÔNG nhận nợ đầu kỳ: nợ là tiền, phải đi đường "Điều chỉnh công nợ"
 * có PIN và lý do. Hạn mức nợ / số ngày nợ tối đa thì chỉ chủ / quản lý mới
 * đặt được qua file — người khác nhập thì hai cột đó bị bỏ qua có cảnh báo.
 * ==================================================================== */

/** Chữ thường không dấu — để nhận "Thành viên", "thanh vien", "THÀNH VIÊN" như nhau. */
const plain = (v) => clean(v).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase();

/**
 * Số điện thoại từ Excel: ô kiểu số làm rụng số 0 đầu (0909… thành 909…), có
 * khi lại ghi dạng +84. Dọn về một kiểu để so trùng cho đúng.
 */
function importPhone(v) {
  let s = clean(v).replace(/[\s.\-()]/g, '');
  if (!s) return '';
  if (/^\+?84\d{9}$/.test(s)) s = '0' + s.replace(/^\+?84/, '');
  if (/^\d{9}$/.test(s) && !s.startsWith('0')) s = '0' + s;
  return s;
}

/** Tiền gõ trong Excel: "5.000.000", "5,000,000 đ", 5000000 — đều ra 5000000. */
function importMoney(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return Math.round(v);
  const s = clean(v).replace(/[đ\s]/gi, '').replace(/[.,](?=\d{3}(\D|$))/g, '');
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

/** Ngày: 2026-10-10, 10/10/2026, hoặc số ngày kiểu Excel. Trả YYYY-MM-DD, '' nếu trống, null nếu sai. */
function importDate(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v === 'number' && v > 1000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = clean(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let y; let mo; let d;
  if (m) { [, y, mo, d] = m; } else {
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (!m) return null;
    [, d, mo, y] = m;
  }
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? null : iso;
}

const TYPE_WORDS = {
  'thanh vien': 'member', member: 'member', thuong: 'member', 'khach le': 'member',
  vip: 'vip', 'than thiet': 'vip',
  si: 'wholesale', 'khach si': 'wholesale', wholesale: 'wholesale', 'dai ly': 'wholesale',
};

const CUSTOMER_LABEL = {
  code: 'Mã KH', name: 'Tên khách hàng', phone: 'SĐT 1', phone2: 'SĐT 2', phone3: 'SĐT 3',
  email: 'Email', address: 'Địa chỉ', tax_code: 'Mã số thuế', company_name: 'Tên công ty',
  birthday: 'Ngày sinh', customer_type: 'Loại khách', debt_limit: 'Hạn mức nợ',
  max_debt_days: 'Số ngày nợ tối đa', note: 'Ghi chú',
};
const SUPPLIER_LABEL = {
  code: 'Mã NCC', name: 'Tên nhà cung cấp', contact_name: 'Người liên hệ', phone: 'Điện thoại',
  email: 'Email', address: 'Địa chỉ', tax_code: 'Mã số thuế', bank_name: 'Ngân hàng',
  account_no: 'Số tài khoản', term_days: 'Số ngày được nợ', note: 'Ghi chú',
};

/** Ô có điền gì không — để biết cột nào được nhập, cột nào để trống giữ nguyên. */
const filled = (v) => !(v === undefined || v === null || clean(v) === '');

/** Khung chung: soát từng dòng bằng `checkRow`, gom lỗi / cảnh báo / kế hoạch ghi. */
function runImport(req, res, { checkRow, write }) {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const mode = req.body?.mode === 'update' ? 'update' : 'create';
  if (!rows.length) return res.status(400).json({ error: 'Không có dòng dữ liệu nào để nhập.' });
  if (rows.length > 5000) return res.status(400).json({ error: 'Mỗi lần nhập tối đa 5.000 dòng.' });

  const errors = [];
  const warnings = [];
  const plan = [];
  const seen = { code: new Map(), phone: new Map() };
  const canCredit = req.user === undefined || isApproverRole(req.user?.role);
  if (rows.some((r) => filled(r.opening_debt))) {
    warnings.push({ line: null, msg: 'Cột nợ đầu kỳ bị bỏ qua — nhập nợ cũ bằng "Điều chỉnh công nợ" trong hồ sơ (có PIN, ghi lý do).' });
  }
  for (const r of rows) {
    const line = Number(r._line) || null;
    if (!Object.entries(r).some(([k, v]) => k !== '_line' && filled(v))) continue;   // dòng trống
    const err = (msg) => errors.push({ line, msg });
    const warn = (msg) => warnings.push({ line, msg });
    const item = checkRow(r, { mode, err, warn, seen, line, canCredit });
    if (item) plan.push(item);
  }

  const summary = {
    rows: plan.length,
    create: plan.filter((p) => p.action === 'create').length,
    update: plan.filter((p) => p.action === 'update').length,
    unchanged: plan.filter((p) => p.action === 'update' && !p.changes.length).length,
  };
  /* Bản xem trước: hồ sơ nào sẽ đổi gì (trước → sau). Cập nhật theo mã dễ ghi đè
     nhầm nếu file cũ, nên phải cho chủ tiệm nhìn thấy trước khi bấm nhập. */
  const preview = plan.slice(0, 300).map((p) => ({
    line: p.line, action: p.action, code: p.code || '(tự sinh)', name: p.values.name ?? p.cur?.name,
    changes: p.changes,
  }));
  const report = { mode, summary, errors, warnings, preview };
  if (req.body?.dry_run === true) return res.json({ ok: errors.length === 0, dry_run: true, ...report });
  if (errors.length) {
    return res.status(422).json({
      error: `Có ${errors.length} lỗi nên CHƯA nhập dòng nào. Sửa hết lỗi rồi nhập lại.`,
      code: 'IMPORT_INVALID', ...report,
    });
  }
  const out = tx(() => write(plan));
  logActivity(req.user, 'import', req.path.split('/')[1], null,
    `Nhập từ Excel: thêm ${summary.create}, cập nhật ${summary.update - summary.unchanged} hồ sơ`);
  res.json({ ok: true, ...report, ...out });
}

/** Danh sách cột đổi giữa hồ sơ cũ và giá trị mới. */
function diffOf(cur, values, labels) {
  if (!cur) return [];
  return Object.entries(values)
    .filter(([k, v]) => k !== 'code' && String(cur[k] ?? '') !== String(v ?? ''))
    .map(([k, v]) => ({ field: k, label: labels[k] || k, from: cur[k] ?? '', to: v ?? '' }));
}

/* ------------------------------ Khách hàng ------------------------------ */

function checkCustomer(r, { mode, err, warn, seen, line, canCredit }) {
  const code = clean(r.code);
  const cur = code ? get('SELECT * FROM customers WHERE code = ?', [code]) : null;
  if (code) {
    if (seen.code.has(code)) { err(`Mã "${code}" bị lặp, đã có ở dòng ${seen.code.get(code)}.`); return null; }
    seen.code.set(code, line);
  }
  if (cur && mode === 'create') {
    err(`Mã "${code}" đã có trong máy (${cur.name}). Muốn sửa hồ sơ cũ thì chọn chế độ "Cập nhật theo mã".`);
    return null;
  }
  if (!cur && !filled(r.name)) { err('Thiếu tên khách hàng.'); return null; }

  const v = {};
  for (const f of ['name', 'email', 'address', 'tax_code', 'company_name', 'note']) {
    if (filled(r[f])) v[f] = clean(r[f]);
  }
  for (const f of PHONE_FIELDS) if (filled(r[f])) v[f] = importPhone(r[f]);
  if (filled(r.birthday)) {
    const d = importDate(r.birthday);
    if (d === null) err(`Ngày sinh "${clean(r.birthday)}" không đọc được — ghi kiểu 25/12/1980.`);
    else v.birthday = d;
  }
  if (filled(r.customer_type)) {
    const t = TYPE_WORDS[plain(r.customer_type)];
    if (!t) warn(`Loại khách "${clean(r.customer_type)}" lạ — để "Thành viên". Ghi một trong: Thành viên, VIP, Khách sỉ.`);
    v.customer_type = t || 'member';
  }
  /* Hạn mức nợ và số ngày nợ tối đa là chốt chặn bán nợ — chỉ chủ / quản lý đặt được */
  for (const f of ['debt_limit', 'max_debt_days']) {
    if (!filled(r[f])) continue;
    if (!canCredit) { warn(`Cột "${CUSTOMER_LABEL[f]}" bị bỏ qua — chỉ chủ tiệm / quản lý mới đặt được.`); continue; }
    const n = f === 'debt_limit' ? importMoney(r[f]) : Number(clean(r[f]));
    if (!Number.isFinite(n) || n < 0) { err(`${CUSTOMER_LABEL[f]} "${clean(r[f])}" không phải số hợp lệ.`); continue; }
    v[f] = f === 'debt_limit' ? n : normDays(n);
  }

  /* Ba số điện thoại: gộp với số cũ (ô trống giữ nguyên), rồi soát trùng */
  const phones = phoneValues(v, cur);
  const bad = phoneError(phones, cur?.id ?? null);
  if (bad) err(bad);
  for (const f of PHONE_FIELDS) {
    const p = phones[f];
    if (!p || !filled(v[f])) continue;
    if (seen.phone.has(p)) err(`Số ${p} trùng với dòng ${seen.phone.get(p)} trong cùng file.`);
    else seen.phone.set(p, line);
  }

  return {
    line, code, cur, action: cur ? 'update' : 'create',
    values: v, changes: diffOf(cur, v, CUSTOMER_LABEL),
  };
}

function writeCustomers(plan) {
  let created = 0;
  let updated = 0;
  for (const p of plan) {
    const v = p.values;
    if (p.action === 'create') {
      const phones = phoneValues(v);
      run(`INSERT INTO customers(code, name, phone, phone2, phone3, email, address, tax_code, company_name,
                                 opening_debt, debt_limit, birthday, note, active, customer_type, max_debt_days)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 1, ?, ?)`,
      [p.code || genCode('customers', 'KH'), v.name, phones.phone, phones.phone2, phones.phone3,
        v.email || null, v.address || null, v.tax_code || null, v.company_name || null,
        v.debt_limit || 0, v.birthday || null, v.note || null, normType(v.customer_type), v.max_debt_days ?? null]);
      created += 1;
    } else if (p.changes.length) {
      const sets = Object.keys(v).filter((k) => k !== 'code');
      run(`UPDATE customers SET ${sets.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
        [...sets.map((k) => v[k]), p.cur.id]);
      updated += 1;
    }
  }
  return { created, updated };
}

r.post('/customers/import', (req, res) => runImport(req, res, { checkRow: checkCustomer, write: writeCustomers }));

/* ---------------------------- Nhà cung cấp ---------------------------- */

function checkSupplier(r, { mode, err, warn, seen, line }) {
  const code = clean(r.code);
  const cur = code ? get('SELECT * FROM suppliers WHERE code = ?', [code]) : null;
  if (code) {
    if (seen.code.has(code)) { err(`Mã "${code}" bị lặp, đã có ở dòng ${seen.code.get(code)}.`); return null; }
    seen.code.set(code, line);
  }
  if (cur && mode === 'create') {
    err(`Mã "${code}" đã có trong máy (${cur.name}). Muốn sửa hồ sơ cũ thì chọn chế độ "Cập nhật theo mã".`);
    return null;
  }
  if (!cur && !filled(r.name)) { err('Thiếu tên nhà cung cấp.'); return null; }

  const v = {};
  for (const f of ['name', 'contact_name', 'email', 'address', 'tax_code', 'note']) {
    if (filled(r[f])) v[f] = clean(r[f]);
  }
  if (filled(r.phone)) v.phone = importPhone(r.phone);
  if (filled(r.term_days)) {
    const n = Number(clean(r.term_days));
    if (!Number.isFinite(n) || n < 0) err(`Số ngày được nợ "${clean(r.term_days)}" không phải số hợp lệ.`);
    else v.term_days = Math.round(n);
  }
  /* Tài khoản ngân hàng: phải đủ cả tên ngân hàng lẫn số tài khoản */
  const bank = { bank_name: clean(r.bank_name), account_no: clean(r.account_no).replace(/\s/g, '') };
  if (bank.bank_name || bank.account_no) {
    const bad = contactError({ bank_accounts: [bank] });
    if (bad) err('Tài khoản ngân hàng phải có đủ tên ngân hàng và số tài khoản.');
    else { v.bank_name = bank.bank_name; v.account_no = bank.account_no; }
  }
  if (filled(r.phone) && !v.phone) warn('Số điện thoại trống sau khi dọn — bỏ qua.');

  /* So sánh: tài khoản ngân hàng nằm ở bảng riêng, đổi nghĩa là THÊM tài khoản mới */
  const changes = diffOf(cur, Object.fromEntries(Object.entries(v)
    .filter(([k]) => !['bank_name', 'account_no', 'phone'].includes(k))), SUPPLIER_LABEL);
  if (cur && v.phone && !supplierPhones(cur.id).some((p) => p.phone === v.phone)) {
    changes.push({ field: 'phone', label: 'Điện thoại', from: cur.phone || '', to: `${v.phone} (thêm số)` });
  }
  if (cur && v.account_no && !supplierBanks(cur.id).some((b) => b.account_no === v.account_no)) {
    changes.push({ field: 'bank', label: 'Tài khoản', from: '', to: `${v.account_no} - ${v.bank_name} (thêm tài khoản)` });
  }
  return { line, code, cur, action: cur ? 'update' : 'create', values: v, changes };
}

function writeSuppliers(plan) {
  let created = 0;
  let updated = 0;
  for (const p of plan) {
    const v = p.values;
    if (p.action === 'create') {
      const info = run(`
        INSERT INTO suppliers(code, name, contact_name, phone, email, address, tax_code,
                              bank_account, opening_debt, term_days, note, active)
        VALUES(?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, 1)`,
      [p.code || genCode('suppliers', 'NCC'), v.name, v.contact_name || null, v.phone || null,
        v.email || null, v.address || null, v.tax_code || null, v.term_days || 0, v.note || null]);
      const id = Number(info.lastInsertRowid);
      saveContacts(id, {
        phones: v.phone ? [{ phone: v.phone }] : [],
        bank_accounts: v.account_no ? [{ bank_name: v.bank_name, account_no: v.account_no }] : [],
      });
      created += 1;
    } else if (p.changes.length) {
      const cur = p.cur;
      const sets = Object.keys(v).filter((k) => !['code', 'phone', 'bank_name', 'account_no'].includes(k));
      if (sets.length) {
        run(`UPDATE suppliers SET ${sets.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
          [...sets.map((k) => v[k]), cur.id]);
      }
      /* Số / tài khoản mới thì THÊM vào danh sách đang có, không xoá số cũ */
      const phones = supplierPhones(cur.id);
      if (v.phone && !phones.some((x) => x.phone === v.phone)) {
        saveContacts(cur.id, { phones: [{ phone: v.phone }, ...phones] });
      }
      const banks = supplierBanks(cur.id);
      if (v.account_no && !banks.some((x) => x.account_no === v.account_no)) {
        saveContacts(cur.id, { bank_accounts: [...banks, { bank_name: v.bank_name, account_no: v.account_no }] });
      }
      updated += 1;
    }
  }
  return { created, updated };
}

r.post('/suppliers/import', (req, res) => runImport(req, res, { checkRow: checkSupplier, write: writeSuppliers }));

export default r;
