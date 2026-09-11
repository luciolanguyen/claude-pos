/* ====================================================================
   NGHIỆP VỤ BỔ SUNG CHO MÀN HÌNH BÁN HÀNG (đợt 13)

   - Duyệt bằng mã PIN quản lý
   - Sổ phụ công nợ, tình trạng hạn mức và nợ quá hạn của khách
   - Người mua hộ quen của một khách chủ
   - Phiếu đổi hàng
   - Đối soát tiền thu hộ COD với đối tác giao hàng
   ==================================================================== */
import { Router } from 'express';
import { all, get, run, tx, addCashTx, defaultCashAccount, customerDebt } from '../db.js';
import { verifyPin, issueApproval, posPolicy } from '../policy.js';
import { customerLedger, overdueInvoices } from '../debt.js';
import { lookupVoucher } from '../vouchers.js';

const r = Router();
const fail = (res, e) => res.status(e.status || 400).json({ error: e.message, code: e.code });

/** Đọc số tiền gửi lên. Thiếu hoặc hỏng thì dùng mặc định — không để NaN lọt. */
const moneyOr = (v, fallback) => (
  v === undefined || v === null || v === '' || Number.isNaN(Number(v))
    ? fallback : Math.round(Number(v)));

/* ------------------------------ Duyệt PIN ---------------------------- */

/**
 * Quản lý gõ PIN để duyệt tại chỗ. Trả về phiếu duyệt ngắn hạn, KHÔNG trả
 * lại mã PIN. Hoá đơn gửi kèm phiếu duyệt, máy chủ soát lại rồi mới lưu.
 */
r.post('/auth/approve', (req, res) => {
  try {
    const key = `u${req.user?.id || 0}@${req.ip || ''}`;
    const approver = verifyPin(req.body?.pin, key);
    res.json(issueApproval(approver, req.body?.reason));
  } catch (e) { fail(res, e); }
});

/** Chính sách bán hàng — máy khách cần để biết khi nào phải hỏi PIN. */
r.get('/pos/policy', (req, res) => res.json(posPolicy()));

/* ------------------------------ Công nợ ------------------------------ */

/**
 * Tình trạng tín dụng của khách — nhẹ, gọi mỗi lần mở hộp thanh toán.
 * Hai chặn của tài liệu 05:
 *   - vượt hạn mức nợ: khoá nút hoàn tất, cần PIN quản lý;
 *   - có hoá đơn nợ quá số ngày cho phép: bắt trả đủ 100%, không bán nợ.
 */
r.get('/customers/:id/credit-status', (req, res) => {
  const c = get('SELECT id, name, debt_limit FROM customers WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
  const policy = posPolicy();
  const debt = customerDebt(c.id);
  const overdue = overdueInvoices(c.id, policy.maxDebtDays);
  res.json({
    id: c.id, name: c.name, debt, debt_limit: c.debt_limit,
    available: c.debt_limit > 0 ? c.debt_limit - debt : null,
    max_debt_days: policy.maxDebtDays,
    blocked_overdue: overdue.length > 0,
    overdue: overdue.map((i) => ({
      id: i.id, code: i.code, ts: i.ts, remaining: i.remaining, age_days: i.age_days,
    })),
  });
});

/** Sổ phụ công nợ thu nhỏ, mới nhất trên cùng. */
r.get('/customers/:id/ledger', (req, res) => {
  const c = get('SELECT id, code, name, phone, address, debt_limit FROM customers WHERE id = ?',
    [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
  const policy = posPolicy();
  const led = customerLedger(c.id);
  const overdue = policy.maxDebtDays > 0
    ? led.invoices.filter((i) => i.age_days > policy.maxDebtDays) : [];
  res.json({
    customer: c,
    ...led,
    max_debt_days: policy.maxDebtDays,
    overdue_count: overdue.length,
    over_limit: c.debt_limit > 0 && led.debt > c.debt_limit,
  });
});

/* ---------------------------- Người mua hộ --------------------------- */

/**
 * Những người từng đi mua hộ cho một khách chủ, hay đi nhất lên đầu —
 * để thu ngân bấm chọn một phát thay vì gõ lại tên, số điện thoại.
 */
r.get('/customers/:id/buyers', (req, res) => {
  res.json(all(`
    SELECT s.buyer_id,
           COALESCE(b.name, s.buyer_name) AS name,
           COALESCE(b.phone, s.buyer_phone) AS phone,
           COUNT(*) AS times,
           COALESCE(SUM(s.total), 0) AS total,
           MAX(s.ts) AS last_ts
    FROM sales s
    LEFT JOIN customers b ON b.id = s.buyer_id
    WHERE s.customer_id = ? AND s.status = 'done'
      AND (s.buyer_id IS NOT NULL
           OR COALESCE(s.buyer_name, '') <> '' OR COALESCE(s.buyer_phone, '') <> '')
    GROUP BY COALESCE(CAST(s.buyer_id AS TEXT),
                      'x:' || COALESCE(s.buyer_phone, '') || ':' || COALESCE(s.buyer_name, ''))
    ORDER BY times DESC, last_ts DESC
    LIMIT 10`, [req.params.id]));
});

/**
 * Một người đã đi mua hộ bao nhiêu lần, cho bao nhiêu khách, tổng bao
 * nhiêu tiền. Doanh số và điểm vẫn tính cho khách chủ — đây chỉ là thống
 * kê riêng của người đi mua giùm.
 */
r.get('/customers/:id/proxy-stats', (req, res) => {
  const id = Number(req.params.id);
  res.json(get(`
    SELECT COUNT(*) AS times,
           COALESCE(SUM(total), 0) AS total,
           COUNT(DISTINCT customer_id) AS for_customers,
           MAX(ts) AS last_ts
    FROM sales
    WHERE buyer_id = ? AND status = 'done'
      AND (customer_id IS NULL OR customer_id <> ?)`, [id, id]));
});

/* ---------------------------- Phiếu đổi hàng ------------------------- */

r.get('/vouchers/:code', (req, res) => {
  const v = lookupVoucher(req.params.code);
  if (!v) return res.status(404).json({ error: `Không tìm thấy phiếu đổi hàng "${req.params.code}"` });
  res.json(v);
});

r.get('/vouchers', (req, res) => {
  const cid = Number(req.query.customer_id);
  res.json(all(`
    SELECT v.*, cu.name AS customer_name FROM vouchers v
    LEFT JOIN customers cu ON cu.id = v.customer_id
    ${cid ? 'WHERE v.customer_id = ?' : ''}
    ORDER BY v.id DESC LIMIT 50`, cid ? [cid] : []));
});

/* --------------------------- Đối soát COD ---------------------------- */

/**
 * Người giao / đối tác vận chuyển nộp lại tiền thu hộ.
 *
 * Đây mới là lúc tiền chính thức vào quỹ. Trước đó khoản COD nằm ở
 * "phải thu từ đối tác vận chuyển" — không phải nợ của khách.
 *
 * Nộp thiếu thì phần còn lại vẫn là khoản phải thu của đối tác, đơn giữ
 * trạng thái chờ đối soát. Khách vẫn không bị ghi nợ: khách đã trả đủ tận
 * tay người giao, thiếu là chuyện giữa tiệm với người giao.
 */
r.put('/sales/:id/cod', (req, res) => {
  try {
    const s = get(`
      SELECT s.*, ca.name AS carrier_name, u.full_name AS shipper_user_name
      FROM sales s
      LEFT JOIN carriers ca ON ca.id = s.carrier_id
      LEFT JOIN users u ON u.id = s.shipper_user_id
      WHERE s.id = ?`, [req.params.id]);
    if (!s) return res.status(404).json({ error: 'Không tìm thấy hoá đơn' });
    if (s.status !== 'done') throw Object.assign(new Error('Hoá đơn này đã bị huỷ'), { status: 400 });
    if (s.delivery_status === 'failed') {
      throw Object.assign(new Error('Giao không thành công thì không có tiền thu hộ để đối soát.'), { status: 400 });
    }
    if (s.cod_status !== 'pending') {
      throw Object.assign(new Error('Đơn này không có khoản thu hộ nào đang chờ đối soát.'),
        { status: 400, code: 'NO_COD_PENDING' });
    }

    const left = s.cod_amount - s.cod_collected;
    const amount = Math.min(moneyOr(req.body?.amount, left), left);
    if (!(amount > 0)) throw Object.assign(new Error('Số tiền nộp về phải lớn hơn 0.'), { status: 400 });

    const accountId = Number(req.body?.account_id) || defaultCashAccount();
    if (!accountId) throw Object.assign(new Error('Chưa thiết lập quỹ tiền'), { status: 400 });

    const out = tx(() => {
      const partner = s.carrier_name || s.shipper_user_name || s.shipper_name || 'Người giao hàng';
      const receipt = addCashTx({
        accountId, direction: 'in', amount, category: 'cod_in',
        partnerType: 'carrier',
        partnerId: s.carrier_id || s.shipper_user_id || null,
        partnerName: partner,
        refType: 'sale', refId: s.id, refCode: s.code,
        userId: req.user?.id || req.body?.user_id || null,
        note: req.body?.note || `Đối soát tiền thu hộ đơn ${s.code}`,
      });
      /* Mọi vế bên phải của một câu UPDATE đọc giá trị CŨ, nên cả ba chỗ
         "cod_collected + ?" đều cộng trên số trước khi nộp — đúng ý. */
      run(`UPDATE sales SET
             paid = paid + ?,
             cod_collected = cod_collected + ?,
             cod_status = CASE WHEN cod_collected + ? >= cod_amount THEN 'collected' ELSE 'pending' END,
             collected_at = CASE WHEN cod_collected + ? >= cod_amount
                                 THEN datetime('now','localtime') ELSE collected_at END
           WHERE id = ?`, [amount, amount, amount, amount, s.id]);
      return {
        ok: true, receipt,
        sale: get('SELECT * FROM sales WHERE id = ?', [s.id]),
        still_owed_by_partner: left - amount,
      };
    });
    res.json(out);
  } catch (e) { fail(res, e); }
});

/**
 * Phải thu từ đối tác vận chuyển: tiền COD còn nằm ở ai, bao nhiêu, từ
 * đơn cũ nhất ngày nào — để biết nên đòi ai trước.
 */
r.get('/cod-receivables', (req, res) => {
  const rows = all(`
    SELECT COALESCE(ca.name, u.full_name, NULLIF(s.shipper_name, ''), 'Chưa ghi người giao') AS partner,
           COUNT(*) AS orders,
           COALESCE(SUM(s.cod_amount - s.cod_collected), 0) AS amount,
           MIN(s.ts) AS oldest_ts
    FROM sales s
    LEFT JOIN carriers ca ON ca.id = s.carrier_id
    LEFT JOIN users u ON u.id = s.shipper_user_id
    WHERE s.status = 'done' AND s.cod_status = 'pending'
      AND COALESCE(s.delivery_status, '') <> 'failed'
    GROUP BY partner
    ORDER BY amount DESC`);
  res.json({ rows, total: rows.reduce((a, x) => a + x.amount, 0) });
});

export default r;
