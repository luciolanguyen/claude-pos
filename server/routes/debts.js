/* ====================================================================
   CÔNG NỢ: IN TỔNG HỢP, SỬA CÔNG NỢ, NGÀY CHỐT (plan 31, nhóm 6)

     6a  Bảng tổng hợp công nợ khách / NCC theo kỳ, và sổ chi tiết từng người
     6c  Điều chỉnh công nợ: chủ / quản lý, bắt gõ PIN, bắt ghi lý do, lưu
         phiếu DC… ghi từ bao nhiêu sang bao nhiêu và ai duyệt
     6b  Ngày chốt công nợ riêng từng khách / NCC: đối chiếu trước khi chốt
         (lệch một đồng là không cho chốt), bỏ chốt được, chốt hàng loạt

   Quyền chặn ở access-map.js theo đường dẫn: xem sổ theo quyền khách hàng /
   mua hàng; sửa nợ và chốt nợ theo quyền debt.adjust (chủ và quản lý).
   ==================================================================== */
import { Router } from 'express';
import { all, get, run, tx, nextCode } from '../db.js';
import { verifyPin } from '../policy.js';
import {
  checkSplit, debtStatement, debtSummary, activeClosing, currentDebt, partnerOf,
} from '../ledger.js';

const r = Router();

const TYPE_OF = { customers: 'customer', suppliers: 'supplier' };
const WHO = { customer: 'khách hàng', supplier: 'nhà cung cấp' };
const money = (v) => Math.round(Number(v) || 0).toLocaleString('vi-VN');
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const today = () => get("SELECT date('now','localtime') AS d").d;
const fail = (res, e) => res.status(e.status || 400).json({ error: e.message, code: e.code });
const httpError = (message, code, status = 400) => Object.assign(new Error(message), { code, status });

/* ------------------------------------------------------------------ */
/* 6a — tổng hợp và sổ chi tiết                                        */
/* ------------------------------------------------------------------ */

const summary = (type) => (req, res) => {
  const { from = '', to = '', q = '', only_owing: onlyOwing } = req.query;
  if ((from && !isDate(from)) || (to && !isDate(to))) return res.status(400).json({ error: 'Ngày không hợp lệ.' });
  if (from && to && from > to) return res.status(400).json({ error: 'Từ ngày phải trước đến ngày.' });
  res.json(debtSummary(type, { from, to, q, onlyOwing: onlyOwing === '1' }));
};
r.get('/customer-debts/summary', summary('customer'));
r.get('/supplier-debts/summary', summary('supplier'));

r.get('/:kind(customers|suppliers)/:id/debt-statement', (req, res) => {
  const type = TYPE_OF[req.params.kind];
  const { from = '', to = '', detail } = req.query;
  if ((from && !isDate(from)) || (to && !isDate(to))) return res.status(400).json({ error: 'Ngày không hợp lệ.' });
  const st = debtStatement(type, Number(req.params.id), { from, to, detail: detail === '1' });
  if (!st) return res.status(404).json({ error: `Không tìm thấy ${WHO[type]}` });
  res.json(st);
});

/* ------------------------------------------------------------------ */
/* 6c — điều chỉnh công nợ                                             */
/* ------------------------------------------------------------------ */

r.get('/:kind(customers|suppliers)/:id/debt-adjustments', (req, res) => {
  const type = TYPE_OF[req.params.kind];
  res.json(all(`
    SELECT a.*, u.full_name AS user_name, ap.full_name AS approved_by_name
    FROM debt_adjustments a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN users ap ON ap.id = a.approved_by
    WHERE a.partner_type = ? AND a.partner_id = ? ORDER BY a.id DESC`, [type, Number(req.params.id)]));
});

/**
 * Sửa công nợ hiện tại. Gửi new_debt (nợ đúng phải là bao nhiêu) hoặc amount
 * (cộng / trừ bao nhiêu), kèm lý do và mã PIN của chủ / quản lý. Không sửa
 * chứng từ cũ nào: ghi một phiếu điều chỉnh DC… làm một dòng trong sổ nợ.
 */
r.post('/:kind(customers|suppliers)/:id/debt-adjustments', (req, res) => {
  const type = TYPE_OF[req.params.kind];
  const id = Number(req.params.id);
  const b = req.body || {};
  try {
    const partner = partnerOf(type, id);
    if (!partner) throw httpError(`Không tìm thấy ${WHO[type]}`, 'NOT_FOUND', 404);
    const reason = String(b.reason ?? '').trim();
    if (reason.length < 5) throw httpError('Phải ghi rõ lý do sửa công nợ (ít nhất 5 ký tự).', 'REASON_REQUIRED');

    /* Soát PIN trước khi tính gì: gõ sai thì dừng, khoá theo người đang thử */
    const approver = verifyPin(b.pin, `debt:${req.user?.id || req.ip}`);

    const result = tx(() => {
      const before = currentDebt(type, id);
      let amount;
      if (b.new_debt !== undefined && b.new_debt !== null && b.new_debt !== '') {
        amount = Math.round(Number(b.new_debt)) - before;
      } else {
        amount = Math.round(Number(b.amount) || 0);
      }
      if (!Number.isFinite(amount) || amount === 0) {
        throw httpError('Số công nợ mới bằng đúng số đang có — không có gì để sửa.', 'NO_CHANGE');
      }
      /* Nhìn nhầm số trên màn hình cũ: máy khác vừa thu nợ xong thì số "trước khi sửa" đã khác */
      if (b.expected_before !== undefined && Math.round(Number(b.expected_before)) !== before) {
        throw httpError(`Công nợ vừa đổi thành ${money(before)} đ (có người vừa thu / ghi nợ). Mở lại để xem số mới rồi sửa.`,
          'DEBT_CHANGED', 409);
      }
      const code = nextCode('debt_adjustments', 'DC');
      const info = run(`
        INSERT INTO debt_adjustments(code, partner_type, partner_id, partner_name, debt_before, debt_after,
                                     amount, reason, user_id, approved_by)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [code, type, id, partner.name, before, before + amount, amount, reason,
          req.user?.id || Number(b.user_id) || null, approver.id]);
      const after = currentDebt(type, id);
      if (after !== before + amount) throw httpError('Công nợ sau khi sửa không khớp — đã huỷ thao tác.', 'MISMATCH', 500);
      return { id: Number(info.lastInsertRowid), code, debt_before: before, debt_after: after, amount, approved_by_name: approver.full_name };
    });
    res.json(result);
  } catch (e) {
    fail(res, e);
  }
});

/* ------------------------------------------------------------------ */
/* 6b — ngày chốt công nợ                                              */
/* ------------------------------------------------------------------ */

r.get('/:kind(customers|suppliers)/:id/debt-closings', (req, res) => {
  const type = TYPE_OF[req.params.kind];
  res.json(all(`
    SELECT dc.*, u.full_name AS user_name FROM debt_closings dc
    LEFT JOIN users u ON u.id = dc.user_id
    WHERE dc.partner_type = ? AND dc.partner_id = ? ORDER BY dc.close_date DESC`, [type, Number(req.params.id)]));
});

/** Chốt một đối tác. Trả về mốc đã ghi, hoặc ném lỗi nếu đối chiếu lệch. */
function closeOne(type, id, closeDate, userId, note) {
  const split = checkSplit(type, id, closeDate);
  if (!split) throw httpError(`Không tìm thấy ${WHO[type]}`, 'NOT_FOUND', 404);
  /* Nguyên tắc đối chiếu (plan 31, mục 3.5): tính nợ theo từng chứng từ phải
     ra đúng bằng công thức tổng — lệch một đồng là không cho chốt */
  if (!split.ok) {
    throw httpError(`Đối chiếu lệch ${money(split.diff)} đ giữa sổ chi tiết và công nợ tổng — không chốt.`, 'CHECK_FAILED', 409);
  }
  if (get('SELECT id FROM debt_closings WHERE partner_type = ? AND partner_id = ? AND close_date = ?', [type, id, closeDate])) {
    throw httpError(`Đã có mốc chốt ngày ${closeDate.split('-').reverse().join('/')}.`, 'ALREADY_CLOSED', 409);
  }
  const info = run(`
    INSERT INTO debt_closings(partner_type, partner_id, close_date, amount, debt_at_action, user_id, note)
    VALUES(?, ?, ?, ?, ?, ?, ?)`, [type, id, closeDate, split.before, split.current, userId || null, note || null]);
  return { id: Number(info.lastInsertRowid), partner_id: id, name: split.partner.name, close_date: closeDate,
    amount: split.before, after: split.after, current: split.current };
}

const checkCloseDate = (d) => {
  if (!isDate(d)) throw httpError('Chọn ngày chốt công nợ.', 'DATE_REQUIRED');
  if (d > today()) throw httpError('Ngày chốt không được sau hôm nay.', 'FUTURE_DATE');
};

r.post('/:kind(customers|suppliers)/:id/debt-closings', (req, res) => {
  const type = TYPE_OF[req.params.kind];
  try {
    checkCloseDate(req.body?.close_date);
    res.json(tx(() => closeOne(type, Number(req.params.id), req.body.close_date,
      req.user?.id || Number(req.body.user_id), String(req.body.note ?? '').trim())));
  } catch (e) {
    fail(res, e);
  }
});

/** Bỏ chốt: xoá dòng mốc, sổ tự về như trước — không chứng từ nào bị đụng. */
r.delete('/:kind(customers|suppliers)/:id/debt-closings/:closingId', (req, res) => {
  const type = TYPE_OF[req.params.kind];
  const row = get('SELECT * FROM debt_closings WHERE id = ? AND partner_type = ? AND partner_id = ?',
    [Number(req.params.closingId), type, Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy mốc chốt' });
  run('DELETE FROM debt_closings WHERE id = ?', [row.id]);
  res.json({ ok: true, active: activeClosing(type, row.partner_id) });
});

/**
 * Chốt hàng loạt cùng một ngày. Không gửi danh sách thì chốt mọi người đang có
 * phát sinh công nợ. Người nào đối chiếu lệch hoặc đã có mốc ngày đó thì bỏ
 * qua và báo lại — những người khác vẫn chốt.
 */
r.post('/debt-closings/bulk', (req, res) => {
  const b = req.body || {};
  const type = b.partner_type === 'supplier' ? 'supplier' : b.partner_type === 'customer' ? 'customer' : null;
  try {
    if (!type) throw httpError('Chọn chốt công nợ khách hàng hay nhà cung cấp.', 'TYPE_REQUIRED');
    checkCloseDate(b.close_date);
    let ids = Array.isArray(b.partner_ids) ? b.partner_ids.map(Number).filter(Boolean) : null;
    if (!ids) {
      ids = debtSummary(type, { to: b.close_date, onlyOwing: true }).rows.map((x) => x.id);
    }
    const done = [];
    const skipped = [];
    tx(() => {
      for (const id of ids) {
        try {
          done.push(closeOne(type, id, b.close_date, req.user?.id || Number(b.user_id), String(b.note ?? '').trim()));
        } catch (e) {
          skipped.push({ partner_id: id, name: partnerOf(type, id)?.name || null, code: e.code, error: e.message });
        }
      }
    });
    res.json({ close_date: b.close_date, closed: done.length, skipped, rows: done });
  } catch (e) {
    fail(res, e);
  }
});

export default r;
