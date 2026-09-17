/* ====================================================================
   SỔ CÔNG NỢ THEO NGÀY (plan 31, hạng mục 6a / 6b / 6c)

   Công nợ của một khách / NCC xưa nay tính bằng một công thức tổng
   (customerDebt, supplierDebt trong db.js). Muốn in bảng tổng hợp theo kỳ,
   hay chốt "tổng nợ đến ngày …", thì phải biết khoản nợ đó dồn lên theo
   ngày tháng thế nào.

   File này bóc đúng công thức tổng ấy ra thành từng SỰ KIỆN có ngày và có
   dấu (+ tăng nợ, − giảm nợ): hoá đơn / phiếu nhập còn nợ, trả hàng cấn trừ,
   phiếu thu / chi nợ, điều chỉnh công nợ. Cộng hết mọi sự kiện với nợ đầu kỳ
   ban đầu thì RA ĐÚNG BẰNG công thức tổng — hàm checkSplit soát điều đó tới
   từng đồng, lệch là không cho chốt (plan 31, mục 3.5).

   Hoá đơn tính theo trạng thái HIỆN TẠI của nó (đã trả thêm, giao thất bại,
   COD đã nộp...) và nằm ở ngày lập hoá đơn — nên thu tiền thêm cho một hoá
   đơn cũ sau ngày chốt sẽ làm "tổng nợ đến ngày chốt" nhỏ đi. Màn hình ghi
   rõ chênh lệch đó so với con số lúc bấm chốt, không giấu.
   ==================================================================== */
import { all, get, saleOwedSql, returnCreditSql, customerDebt, supplierDebt } from './db.js';

export const PARTNER_TYPES = ['customer', 'supplier'];

export const EVENT_LABEL = {
  sale: 'Hoá đơn bán hàng',
  return: 'Khách trả hàng — cấn trừ nợ',
  receipt: 'Thu nợ',
  refund: 'Chi trả lại khách',
  purchase: 'Phiếu nhập hàng',
  purchase_return: 'Trả hàng NCC — NCC đã nhận',
  purchase_refund: 'NCC hoàn tiền trả hàng',
  payment: 'Trả nợ NCC',
  refund_in: 'NCC trả lại tiền',
  adjust: 'Điều chỉnh công nợ',
};

/** Câu SQL liệt kê sự kiện công nợ. Có partnerId thì một đối tác, không có thì mọi đối tác. */
function eventsSql(type, onePartner) {
  const p = (col) => (onePartner ? `${col} = ?` : `${col} IS NOT NULL`);
  if (type === 'customer') {
    return {
      sql: `
        SELECT 'sale' AS kind, s.id, s.code, s.ts, s.customer_id AS partner_id,
               ${saleOwedSql('s')} AS amount, NULL AS note
        FROM sales s WHERE ${p('s.customer_id')} AND s.status = 'done' AND ${saleOwedSql('s')} <> 0
        UNION ALL
        SELECT 'return', sr.id, sr.code, sr.ts, sr.customer_id,
               -(${returnCreditSql('sr')}), NULL
        FROM sale_returns sr WHERE ${p('sr.customer_id')} AND ${returnCreditSql('sr')} <> 0
        UNION ALL
        SELECT CASE WHEN t.direction = 'in' THEN 'receipt' ELSE 'refund' END, t.id, t.code, t.ts, t.partner_id,
               CASE WHEN t.direction = 'in' THEN -t.amount ELSE t.amount END, t.note
        FROM cash_transactions t
        WHERE t.partner_type = 'customer' AND ${p('t.partner_id')} AND t.category IN ('debt_in', 'debt_out')
        UNION ALL
        SELECT 'adjust', a.id, a.code, a.ts, a.partner_id, a.amount, a.reason
        FROM debt_adjustments a WHERE a.partner_type = 'customer' AND ${p('a.partner_id')}`,
      n: 4,
    };
  }
  return {
    sql: `
      SELECT 'purchase' AS kind, pu.id, pu.code, pu.ts, pu.supplier_id AS partner_id,
             pu.total - pu.paid AS amount, NULL AS note
      FROM purchases pu WHERE ${p('pu.supplier_id')} AND pu.status = 'done' AND pu.total - pu.paid <> 0
      UNION ALL
      /* Trả hàng NCC chỉ trừ nợ từ lúc NCC nhận hàng (plan 31, 5.2d) — nên nằm ở ngày nhận */
      SELECT CASE WHEN pr.received_at IS NOT NULL THEN 'purchase_return' ELSE 'purchase_refund' END,
             pr.id, pr.code, COALESCE(pr.received_at, pr.ts), pr.supplier_id,
             CASE WHEN pr.received_at IS NOT NULL THEN -(pr.total - pr.refunded) ELSE pr.refunded END, NULL
      FROM purchase_returns pr
      WHERE ${p('pr.supplier_id')}
        AND (CASE WHEN pr.received_at IS NOT NULL THEN pr.total - pr.refunded ELSE pr.refunded END) <> 0
      UNION ALL
      SELECT CASE WHEN t.direction = 'out' THEN 'payment' ELSE 'refund_in' END, t.id, t.code, t.ts, t.partner_id,
             CASE WHEN t.direction = 'out' THEN -t.amount ELSE t.amount END, t.note
      FROM cash_transactions t
      WHERE t.partner_type = 'supplier' AND ${p('t.partner_id')} AND t.category IN ('debt_in', 'debt_out')
      UNION ALL
      SELECT 'adjust', a.id, a.code, a.ts, a.partner_id, a.amount, a.reason
      FROM debt_adjustments a WHERE a.partner_type = 'supplier' AND ${p('a.partner_id')}`,
    n: 4,
  };
}

const partnerTable = (type) => (type === 'supplier' ? 'suppliers' : 'customers');

/** Hồ sơ đối tác kèm nợ đầu kỳ ban đầu. */
export function partnerOf(type, id) {
  return get(`SELECT id, code, name, phone, address, opening_debt FROM ${partnerTable(type)} WHERE id = ?`, [id]);
}

/** Mọi sự kiện công nợ của một đối tác, cũ nhất trước. */
export function debtEvents(type, id) {
  const { sql, n } = eventsSql(type, true);
  return all(`SELECT * FROM (${sql}) ORDER BY ts, kind, id`, Array(n).fill(id))
    .map((e) => ({ ...e, label: EVENT_LABEL[e.kind] || e.kind }));
}

/** Công nợ hiện tại theo công thức tổng xưa nay. */
export const currentDebt = (type, id) => (type === 'supplier' ? supplierDebt(id) : customerDebt(id));

/** Ngày "YYYY-MM-DD" của một mốc thời gian lưu trong CSDL. */
const dayOf = (ts) => String(ts || '').slice(0, 10);

/**
 * Chia công nợ tại một ngày: nợ tới hết ngày đó, và phần phát sinh sau.
 * ok = true khi (tới hết ngày) + (sau ngày) đúng bằng công thức tổng.
 */
export function checkSplit(type, id, date) {
  const partner = partnerOf(type, id);
  if (!partner) return null;
  const events = debtEvents(type, id);
  let before = partner.opening_debt || 0;
  let after = 0;
  for (const e of events) {
    if (dayOf(e.ts) <= date) before += e.amount;
    else after += e.amount;
  }
  const current = currentDebt(type, id);
  return { partner, events, before, after, current, ok: before + after === current, diff: current - (before + after) };
}

/** Mốc chốt đang có hiệu lực: mốc muộn nhất không sau ngày cho trước. */
export function activeClosing(type, id, upTo = null) {
  return get(`
    SELECT dc.*, u.full_name AS user_name FROM debt_closings dc
    LEFT JOIN users u ON u.id = dc.user_id
    WHERE dc.partner_type = ? AND dc.partner_id = ? ${upTo ? 'AND dc.close_date <= ?' : ''}
    ORDER BY dc.close_date DESC LIMIT 1`, upTo ? [type, id, upTo] : [type, id]) || null;
}

const dayBefore = (d) => get("SELECT date(?, '-1 day') AS d", [d]).d;
const today = () => get("SELECT date('now','localtime') AS d").d;

/**
 * Sổ chi tiết công nợ của một đối tác trong một kỳ.
 *
 * Có mốc chốt nằm trong kỳ (và không xin xem chi tiết) thì mọi chứng từ tới
 * hết ngày chốt gom thành MỘT dòng "Tổng nợ đến ngày chốt"; bấm xem chi tiết
 * (detail) là hiện lại đủ chứng từ gốc — dữ liệu gốc không bị đụng tới.
 */
export function debtStatement(type, id, { from = '', to = '', detail = false } = {}) {
  const partner = partnerOf(type, id);
  if (!partner) return null;
  const end = to || today();
  const events = debtEvents(type, id);
  const closing = activeClosing(type, id, end);

  /* Điểm bắt đầu: ngày trước "từ ngày", hoặc ngày chốt nếu muộn hơn */
  let startDay = from ? dayBefore(from) : '';
  let openingLabel = from ? `Nợ đầu kỳ (đến hết ${startDay.split('-').reverse().join('/')})` : 'Nợ đầu kỳ ban đầu';
  let usedClosing = null;
  if (closing && !detail && (!startDay || closing.close_date >= startDay)) {
    startDay = closing.close_date;
    openingLabel = `Tổng nợ đến ngày chốt ${closing.close_date.split('-').reverse().join('/')}`;
    usedClosing = closing;
  }

  let opening = partner.opening_debt || 0;
  const rows = [];
  for (const e of events) {
    const d = dayOf(e.ts);
    if (d > end) continue;
    if (startDay && d <= startDay) { opening += e.amount; continue; }
    rows.push(e);
  }
  let balance = opening;
  for (const r of rows) {
    r.increase = r.amount > 0 ? r.amount : 0;
    r.decrease = r.amount < 0 ? -r.amount : 0;
    balance += r.amount;
    r.balance = balance;
  }

  const current = currentDebt(type, id);
  const toToday = end >= today();
  return {
    type, partner, from, to: end, detail,
    opening: { label: openingLabel, amount: opening },
    closing: closing && {
      ...closing,
      /* Con số chốt lúc bấm và con số tính lại bây giờ có thể lệch khi chứng từ
         trước ngày chốt được thu tiền thêm / sửa / huỷ sau khi chốt */
      recomputed: usedClosing ? opening : null,
      drift: usedClosing ? opening - closing.amount : null,
    },
    used_closing: !!usedClosing,
    rows,
    increase: rows.reduce((a, r) => a + r.increase, 0),
    decrease: rows.reduce((a, r) => a + r.decrease, 0),
    closing_balance: balance,
    current_debt: current,
    /* Kỳ kéo tới hôm nay thì số cuối kỳ phải khớp đúng công nợ hiện tại */
    check_ok: toToday ? balance === current : null,
  };
}

/**
 * Bảng tổng hợp công nợ mọi đối tác trong kỳ (6a): nợ đầu kỳ, phát sinh tăng,
 * phát sinh giảm, nợ cuối kỳ. Gom một câu SQL cho cả loại đối tác rồi cộng
 * trong JS, khỏi mỗi người một lượt truy vấn.
 */
export function debtSummary(type, { from = '', to = '', q = '', onlyOwing = false } = {}) {
  const end = to || today();
  const startDay = from ? dayBefore(from) : '';
  const params = [];
  let where = 'WHERE 1 = 1';
  if (String(q).trim()) {
    where += ' AND (name LIKE ? OR phone LIKE ? OR code LIKE ?)';
    const like = `%${String(q).trim()}%`;
    params.push(like, like, like);
  }
  const partners = all(`SELECT id, code, name, phone, address, opening_debt, active
                        FROM ${partnerTable(type)} ${where} ORDER BY name`, params);
  const by = new Map(partners.map((p) => [p.id, {
    id: p.id, code: p.code, name: p.name, phone: p.phone, address: p.address, active: p.active,
    opening: p.opening_debt || 0, increase: 0, decrease: 0, closing: p.opening_debt || 0,
  }]));

  const { sql } = eventsSql(type, false);
  for (const e of all(`SELECT partner_id, ts, amount FROM (${sql})`)) {
    const row = by.get(e.partner_id);
    if (!row) continue;
    const d = dayOf(e.ts);
    if (d > end) continue;
    row.closing += e.amount;
    /* Không chọn từ ngày thì kỳ tính từ lúc mở sổ: nợ đầu kỳ là số mở sổ */
    if (startDay && d <= startDay) { row.opening += e.amount; continue; }
    if (e.amount > 0) row.increase += e.amount; else row.decrease -= e.amount;
  }

  const closings = new Map(all(`
    SELECT partner_id, MAX(close_date) AS close_date FROM debt_closings
    WHERE partner_type = ? AND close_date <= ? GROUP BY partner_id`, [type, end])
    .map((x) => [x.partner_id, x.close_date]));

  let rows = [...by.values()].map((r) => ({ ...r, close_date: closings.get(r.id) || null }));
  if (onlyOwing) rows = rows.filter((r) => r.opening !== 0 || r.increase !== 0 || r.decrease !== 0 || r.closing !== 0);
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  return {
    type, from, to: end, rows,
    totals: { count: rows.length, opening: sum('opening'), increase: sum('increase'), decrease: sum('decrease'), closing: sum('closing') },
  };
}
