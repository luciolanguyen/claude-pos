/* ====================================================================
   CÔNG NỢ KHÁCH THEO TỪNG HOÁ ĐƠN

   Tổng nợ của khách vẫn tính một công thức như cũ (customerDebt trong
   db.js). File này chỉ trả lời thêm câu hỏi "khoản nợ đó nằm ở hoá đơn
   nào" — để thu ngân tích chọn đúng hoá đơn khách muốn trả, để biết hoá
   đơn nào nợ quá hạn, và để in sổ phụ công nợ cho khách xem.

   Cách chia:
     1. Tiền thu có gán vào hoá đơn (debt_allocations) thì trừ thẳng vào
        hoá đơn đó.
     2. Tiền thu KHÔNG gán (phiếu thu cũ trước đợt này, hoặc phần thu dư)
        và tiền cấn trừ trả hàng thì trừ dần từ khoản nợ cũ nhất: nợ đầu
        kỳ trước, rồi tới hoá đơn cũ nhất (FIFO).

   Nhờ vậy cộng hết phần còn nợ của từng hoá đơn luôn ra đúng bằng tổng
   nợ — hai con số không bao giờ vênh nhau.
   ==================================================================== */
import { all, get, run, saleOwedSql, returnCreditSql } from './db.js';

const days = (ts) => {
  const t = new Date(String(ts).replace(' ', 'T'));
  if (Number.isNaN(t.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - t.getTime()) / 86400000));
};

/**
 * Nợ của khách bóc ra từng hoá đơn.
 * @returns { opening_left, invoices: [...], credit, debt } hoặc null
 */
export function debtBreakdown(customerId) {
  const c = get('SELECT id, opening_debt FROM customers WHERE id = ?', [customerId]);
  if (!c) return null;

  const invoices = all(`
    SELECT s.id, s.code, s.ts, s.total, s.paid, s.payment_method,
           s.delivery_status, s.cod_status, s.cod_amount, s.cod_collected,
           ${saleOwedSql('s')} AS owed,
           COALESCE((SELECT SUM(a.amount) FROM debt_allocations a WHERE a.sale_id = s.id), 0) AS allocated
    FROM sales s
    WHERE s.customer_id = ? AND s.status = 'done'
    ORDER BY s.ts, s.id`, [customerId]);

  const payments = get(`
    SELECT COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount END), 0)
         - COALESCE(SUM(CASE WHEN direction = 'out' THEN amount END), 0) AS d
    FROM cash_transactions
    WHERE partner_type = 'customer' AND partner_id = ? AND category IN ('debt_in', 'debt_out')`,
  [customerId]).d;

  const returnCredit = get(`
    SELECT COALESCE(SUM(${returnCreditSql('sr')}), 0) AS d
    FROM sale_returns sr WHERE sr.customer_id = ?`, [customerId]).d;

  const allocatedTotal = invoices.reduce((a, i) => a + i.allocated, 0);

  /* Tiền chưa gán vào hoá đơn nào: phiếu thu cũ, phần thu dư, cấn trừ trả hàng */
  let pool = payments - allocatedTotal + returnCredit;
  let openingLeft = c.opening_debt;
  if (openingLeft < 0) { pool += -openingLeft; openingLeft = 0; }   // khách trả trước từ đầu

  const take = (need) => {
    if (pool <= 0 || need <= 0) return 0;
    const x = Math.min(pool, need);
    pool -= x;
    return x;
  };

  for (const inv of invoices) {
    /* Gán nhiều hơn số nợ (hoá đơn bị trả hàng bớt sau khi đã thu) thì phần
       dư quay về quỹ chung, không để hoá đơn âm */
    const base = inv.owed - inv.allocated;
    inv.base = base > 0 ? base : 0;
    if (base < 0) pool += -base;
  }

  openingLeft -= take(openingLeft);
  for (const inv of invoices) {
    inv.remaining = inv.base - take(inv.base);
    inv.age_days = days(inv.ts);
  }

  const invoiceDebt = invoices.reduce((a, i) => a + i.remaining, 0);
  return {
    opening_left: openingLeft,
    invoices,
    credit: pool > 0 ? pool : 0,
    debt: openingLeft + invoiceDebt - (pool > 0 ? pool : 0),
  };
}

/** Hoá đơn còn nợ và đã quá số ngày cho phép. */
export function overdueInvoices(customerId, maxDays) {
  if (!(maxDays > 0)) return [];
  const bd = debtBreakdown(customerId);
  if (!bd) return [];
  return bd.invoices.filter((i) => i.remaining > 0 && i.age_days > maxDays);
}

/**
 * Tính trước một phiếu thu nợ sẽ trả vào những hoá đơn nào.
 *
 * PHẢI gọi TRƯỚC khi ghi phiếu thu. Gọi sau thì khoản tiền mới đã nằm sẵn
 * trong quỹ chung và đã được chia ảo vào hoá đơn cũ nhất, rồi lại gán
 * thêm lần nữa — một khoản tiền bị trừ hai lần.
 *
 * Có tích chọn hoá đơn thì trả vào đúng những hoá đơn đó trước. Còn dư
 * (hoặc không chọn gì) thì trả dần từ khoản cũ nhất: nợ đầu kỳ, rồi hoá
 * đơn cũ nhất. Phần trả vào nợ đầu kỳ không có dòng gán vì nó không phải
 * một hoá đơn.
 *
 * Kể cả khi không chọn gì cũng ghi dòng gán ngay lúc thu, để lịch sử cố
 * định: nếu chỉ chia ảo lúc xem, một lần thu có chọn hoá đơn về sau sẽ
 * làm những lần thu trước "nhảy" sang hoá đơn khác.
 */
export function planAllocation(customerId, amount, saleIds = []) {
  const bd = debtBreakdown(customerId);
  let left = Math.round(Number(amount) || 0);
  if (!bd) return { rows: [], to_opening: 0, unallocated: left };

  const rows = [];
  const pay = (i) => {
    if (left <= 0 || i.remaining <= 0) return;
    const x = Math.min(left, i.remaining);
    rows.push({ sale_id: i.id, code: i.code, amount: x });
    i.remaining -= x;
    left -= x;
  };

  const wanted = new Set((saleIds || []).map(Number).filter(Boolean));
  for (const i of bd.invoices) if (wanted.has(i.id)) pay(i);

  let toOpening = 0;
  if (left > 0 && bd.opening_left > 0) {
    toOpening = Math.min(left, bd.opening_left);
    left -= toOpening;
  }
  for (const i of bd.invoices) pay(i);

  return { rows, to_opening: toOpening, unallocated: left };
}

/** Ghi các dòng gán đã tính sẵn, sau khi phiếu thu đã có số. */
export function writeAllocation(cashTxId, plan) {
  for (const row of plan.rows) {
    run('INSERT INTO debt_allocations(cash_tx_id, sale_id, amount) VALUES(?, ?, ?)',
      [cashTxId, row.sale_id, row.amount]);
  }
}

/**
 * Sổ phụ công nợ thu nhỏ: mọi chứng từ liên quan tới tiền của khách, mới
 * nhất trên cùng — để khi khách thắc mắc "tôi trả rồi mà", thu ngân chỉ
 * được ngay lần trả đó.
 */
export function customerLedger(customerId, limit = 200) {
  const bd = debtBreakdown(customerId);
  if (!bd) return null;
  const byId = new Map(bd.invoices.map((i) => [i.id, i]));

  const rows = [];
  for (const i of bd.invoices) {
    let kind;
    let status;
    if (i.delivery_status === 'failed') {
      kind = 'failed_invoice';
      status = 'Giao không thành công — không tính nợ';
    } else if (i.cod_status === 'pending' && i.cod_amount - i.cod_collected > 0) {
      kind = 'cod_invoice';
      status = 'Đang thu hộ COD — không tính nợ khách';
    } else if (i.remaining > 0) {
      kind = 'debt_invoice';
      status = 'Còn nợ';
    } else if (i.owed > 0 || i.allocated > 0) {
      kind = 'settled_invoice';
      status = 'Đã trả hết nợ';
    } else {
      kind = 'paid_invoice';
      status = 'Đã trả đủ tại quầy — không nợ';
    }
    rows.push({
      kind, ts: i.ts, id: i.id, code: i.code, total: i.total,
      remaining: i.remaining, age_days: i.age_days, status,
    });
  }

  const receipts = all(`
    SELECT t.id, t.code, t.ts, t.amount, t.direction, t.category, t.note,
           a.type AS account_type, a.name AS account_name, u.full_name AS user_name
    FROM cash_transactions t
    JOIN cash_accounts a ON a.id = t.account_id
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.partner_type = 'customer' AND t.partner_id = ? AND t.category IN ('debt_in', 'debt_out')
    ORDER BY t.ts DESC`, [customerId]);
  for (const t of receipts) {
    const alloc = all(`
      SELECT s.code, a.amount FROM debt_allocations a JOIN sales s ON s.id = a.sale_id
      WHERE a.cash_tx_id = ?`, [t.id]);
    rows.push({
      kind: t.direction === 'in' ? 'receipt' : 'refund',
      ts: t.ts, id: t.id, code: t.code, amount: t.amount,
      method: t.account_type === 'bank' ? 'Chuyển khoản' : 'Tiền mặt',
      account_name: t.account_name, user_name: t.user_name, note: t.note,
      applied_to: alloc,
    });
  }

  const offsets = all(`
    SELECT sr.id, sr.code, sr.ts, sr.total, sr.refunded, sr.refund_method, s.code AS sale_code
    FROM sale_returns sr LEFT JOIN sales s ON s.id = sr.sale_id
    WHERE sr.customer_id = ? AND ${returnCreditSql('sr')} > 0
    ORDER BY sr.ts DESC`, [customerId]);
  for (const r of offsets) {
    rows.push({
      kind: 'return_offset', ts: r.ts, id: r.id, code: r.code,
      amount: r.total - r.refunded, sale_code: r.sale_code,
      status: 'Trả hàng cấn trừ vào nợ',
    });
  }

  rows.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : b.id - a.id));
  void byId;
  return {
    debt: bd.debt,
    opening_left: bd.opening_left,
    credit: bd.credit,
    invoices: bd.invoices.filter((i) => i.remaining > 0).map((i) => ({
      id: i.id, code: i.code, ts: i.ts, total: i.total, remaining: i.remaining, age_days: i.age_days,
    })),
    rows: rows.slice(0, limit),
  };
}
