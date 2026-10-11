/* ====================================================================
   SỐ LIỆU KINH DOANH DÙNG CHUNG — Tổng quan và Báo cáo Lãi lỗ (11/10/2026)

   Trước đây hai trang tự tính mỗi nơi một kiểu: Tổng quan lấy doanh thu
   gồm cả thuế GTGT và không trừ hàng trả, Lãi lỗ thì trừ cả hai — cùng một
   tháng mà hai trang ra hai con số. Từ nay cả hai gọi đúng một hàm ở đây.

   Quy ước (chủ tiệm chốt 11/10, plan pos-dashboard-plan.md mục 5 & 8):
     Doanh thu thuần = tiền hàng sau giảm giá + phí giao khách trả
                       − thuế GTGT − hàng khách trả (tính vào NGÀY TRẢ, không gồm thuế)
     Giá vốn thuần   = giá vốn hàng bán − giá vốn hàng khách trả về kho
     Lãi gộp         = doanh thu thuần − giá vốn thuần − tiền xe trả tài xế
                       − tiền khách gán bằng điểm tích luỹ
   Phí giao khách trả là tiền của tiệm (tiền xe đã trừ vào lãi), còn thuế là
   tiền thu hộ nhà nước.

   Hàng trả về kho lỗi cũng hoàn giá vốn: phần mềm nhập nó vào kho hàng lỗi
   theo đúng giá vốn, nên nó vẫn là hàng tồn — khi nào huỷ bỏ thì mới là lỗ.

   Thời gian so theo DẤU NGÀY GIỜ đầy đủ (`fromTs` … `toTs`) để so được
   "hôm nay tới giờ này" với "hôm qua tới cùng giờ".
   ==================================================================== */
import { all, get } from './db.js';

/* ------------------------------- Ngày giờ ------------------------------- */

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const parseDay = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return isoDay(d); };
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
const lastDayOfMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Kỳ đang xem và kỳ so sánh.
 *
 * Kỳ so sánh có CÙNG SỐ NGÀY và — nếu kỳ đang xem chạy tới hôm nay — dừng ở
 * CÙNG GIỜ: 9 giờ sáng thì so với hôm qua tới 9 giờ, không so với cả ngày
 * hôm qua (trước đây sáng nào cũng hiện "giảm 80%").
 * Kỳ bắt đầu ngày 1 của tháng thì so đúng các ngày đó của tháng trước
 * (1–11/10 so với 1–11/09), không lùi máy móc 11 ngày.
 */
export function periodOf(fromIn, toIn, now = new Date()) {
  const today = isoDay(now);
  let from = ISO.test(String(fromIn || '')) ? fromIn : `${today.slice(0, 8)}01`;
  let to = ISO.test(String(toIn || '')) ? toIn : today;
  if (to > today) to = today;
  if (from > to) [from, to] = [to, from];
  const live = to === today;
  const cut = live ? clock(now) : '23:59:59';

  let prevFrom;
  let prevTo;
  const f = parseDay(from);
  const t = parseDay(to);
  if (f.getDate() === 1 && f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear()) {
    /* Trong một tháng, bắt đầu từ mùng 1: so cùng các ngày của tháng trước */
    const py = f.getMonth() === 0 ? f.getFullYear() - 1 : f.getFullYear();
    const pm = (f.getMonth() + 11) % 12;
    const lastPrev = lastDayOfMonth(py, pm);
    const fullMonth = t.getDate() === lastDayOfMonth(t.getFullYear(), t.getMonth());
    prevFrom = isoDay(new Date(py, pm, 1));
    prevTo = isoDay(new Date(py, pm, fullMonth ? lastPrev : Math.min(t.getDate(), lastPrev)));
  } else {
    const n = daysBetween(from, to) + 1;
    prevFrom = addDays(from, -n);
    prevTo = addDays(to, -n);
  }
  return {
    from, to, days: daysBetween(from, to) + 1, live,
    fromTs: `${from} 00:00:00`, toTs: `${to} ${cut}`,
    compare: { from: prevFrom, to: prevTo, fromTs: `${prevFrom} 00:00:00`, toTs: `${prevTo} ${cut}` },
    as_of: `${today} ${clock(now)}`,
  };
}

/* ------------------------------ Tổng một kỳ ------------------------------ */

/** Thuế GTGT nằm trong tiền hàng khách trả lại (hoá đơn gốc có xuất VAT). */
const RETURN_VAT = `CASE WHEN s.is_vat_invoice = 1 AND COALESCE(si.vat_rate, 0) > 0
                    THEN ROUND(sri.amount * si.vat_rate / (100.0 + si.vat_rate)) ELSE 0 END`;

/**
 * Mọi con số kinh doanh của một khoảng thời gian.
 * Tên trường `profit`, `cogs`, `margin` cố ý trùng danh sách cột giá vốn của
 * máy chủ (index.js) — người không có quyền xem giá vốn tự động không thấy.
 */
export function salesSummary({ fromTs, toTs }) {
  const s = get(`
    SELECT COUNT(*) AS orders,
           COALESCE(SUM(subtotal), 0) AS gross,
           COALESCE(SUM(discount), 0) AS discount,
           COALESCE(SUM(vat_amount), 0) AS vat,
           COALESCE(SUM(total), 0) AS total,
           COALESCE(SUM(cogs), 0) AS cogs,
           COALESCE(SUM(shipper_fee), 0) AS shipper_fee,
           COALESCE(SUM(points_amount), 0) AS points_amount,
           COALESCE(SUM(CASE WHEN ship_payer = 'customer' THEN ship_fee ELSE 0 END), 0) AS ship_charged
    FROM sales WHERE status = 'done' AND datetime(ts) BETWEEN ? AND ?`, [fromTs, toTs]);

  const r = get(`
    SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS amount
    FROM sale_returns WHERE datetime(ts) BETWEEN ? AND ?`, [fromTs, toTs]);
  const ri = get(`
    SELECT COALESCE(SUM(sri.qty * sri.factor * sri.unit_cost), 0) AS cogs,
           COALESCE(SUM(${RETURN_VAT}), 0) AS vat
    FROM sale_return_items sri
    JOIN sale_returns sr ON sr.id = sri.return_id
    LEFT JOIN sale_items si ON si.id = sri.sale_item_id
    LEFT JOIN sales s ON s.id = sr.sale_id
    WHERE datetime(sr.ts) BETWEEN ? AND ?`, [fromTs, toTs]);

  /* Mặt hàng bán ra mà chưa có giá vốn: lãi của kỳ chỉ là TẠM TÍNH.
     Chỉ tính hàng có quản lý tồn kho — dịch vụ, tiền công vốn dĩ giá vốn 0
     (ô nhập hàng hoá ghi rõ "hàng dịch vụ / tiền công thì ghi 0"). */
  const missing = get(`
    SELECT COUNT(DISTINCT si.product_id) AS n
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    JOIN products p ON p.id = si.product_id
    WHERE s.status = 'done' AND si.unit_cost <= 0 AND p.track_stock = 1
      AND datetime(s.ts) BETWEEN ? AND ?`, [fromTs, toTs]).n;

  const salesRevenue = s.total - s.vat;                 // hoá đơn bán, sau giảm giá, gồm phí giao, không thuế
  const returnsRevenue = Math.round(r.amount - ri.vat);  // hàng trả, không thuế
  const revenue = salesRevenue - returnsRevenue;
  const cogs = Math.round(s.cogs - ri.cogs);
  const profit = revenue - cogs - s.shipper_fee - s.points_amount;
  return {
    orders: s.orders,
    gross: s.gross,
    discount: s.discount,
    vat: s.vat,
    ship_charged: s.ship_charged,
    sales_revenue: salesRevenue,
    returns: returnsRevenue,
    returns_count: r.n,
    revenue,
    cogs,
    sales_cogs: s.cogs,
    returns_cogs: Math.round(ri.cogs),
    shipper_fee: s.shipper_fee,
    points_amount: s.points_amount,
    profit,
    margin: revenue > 0 ? (profit / revenue) * 100 : null,
    avg_order: s.orders ? Math.round(salesRevenue / s.orders) : 0,
    missing_cost: missing,
  };
}

/* ---------------------------- Chuỗi theo thời gian ---------------------------- */

/** Chọn cỡ mốc: một ngày → theo giờ; ≤ 31 ngày → theo ngày; ≤ 120 ngày → theo tuần; dài hơn → theo tháng. */
export function bucketOf(days) {
  if (days <= 1) return 'hour';
  if (days <= 31) return 'day';
  if (days <= 120) return 'week';
  return 'month';
}

const KEY_SQL = {
  hour: (c) => `strftime('%H', ${c})`,
  day: (c) => `date(${c})`,
  week: (c) => `date(${c}, '-' || ((CAST(strftime('%w', ${c}) AS INTEGER) + 6) % 7) || ' days')`,   // thứ Hai đầu tuần
  month: (c) => `strftime('%Y-%m', ${c})`,
};

/** Đủ mọi mốc trong kỳ — mốc không bán được gì vẫn có mặt (số 0), mốc chưa tới thì null. */
function bucketKeys(period, bucket, now) {
  if (bucket === 'hour') return Array.from({ length: 24 }, (_, h) => pad(h));
  const keys = [];
  const seen = new Set();
  for (let d = period.from; d <= period.to; d = addDays(d, 1)) {
    const day = parseDay(d);
    let k = d;
    if (bucket === 'week') { const back = (day.getDay() + 6) % 7; k = addDays(d, -back); }
    if (bucket === 'month') k = d.slice(0, 7);
    if (!seen.has(k)) { seen.add(k); keys.push(k); }
  }
  return keys;
}

/** Doanh thu thuần, lãi gộp, số hoá đơn theo từng mốc của kỳ — cùng quy ước với salesSummary. */
export function salesSeries(period, now = new Date()) {
  const bucket = bucketOf(period.days);
  const k = KEY_SQL[bucket];
  const range = [period.fromTs, period.toTs];
  const sales = all(`
    SELECT ${k('ts')} AS k, COUNT(*) AS orders,
           SUM(total - vat_amount) AS revenue, SUM(cogs) AS cogs,
           SUM(shipper_fee + points_amount) AS minus
    FROM sales WHERE status = 'done' AND datetime(ts) BETWEEN ? AND ?
    GROUP BY k`, range);
  const rets = all(`
    SELECT ${k('sr.ts')} AS k,
           SUM(sri.amount - (${RETURN_VAT})) AS revenue,
           SUM(sri.qty * sri.factor * sri.unit_cost) AS cogs
    FROM sale_return_items sri
    JOIN sale_returns sr ON sr.id = sri.return_id
    LEFT JOIN sale_items si ON si.id = sri.sale_item_id
    LEFT JOIN sales s ON s.id = sr.sale_id
    WHERE datetime(sr.ts) BETWEEN ? AND ?
    GROUP BY k`, range);
  /* Phí đổi trả tiệm giữ lại: phiếu trả chỉ hoàn total = subtotal − fee */
  const fees = all(`
    SELECT ${k('ts')} AS k, SUM(fee) AS fee FROM sale_returns
    WHERE datetime(ts) BETWEEN ? AND ? GROUP BY k`, range);
  const byKey = (list) => new Map(list.map((x) => [String(x.k), x]));
  const S = byKey(sales);
  const R = byKey(rets);
  const F = byKey(fees);

  const today = isoDay(now);
  const nowHour = pad(now.getHours());
  return {
    bucket,
    rows: bucketKeys(period, bucket, now).map((key) => {
      /* Mốc chưa tới: để trống, không vẽ thành số 0 */
      const future = bucket === 'hour'
        ? period.from === today && key > nowHour
        : key > today;
      if (future) return { key, revenue: null, profit: null, orders: null };
      const s = S.get(key) || {};
      const r = R.get(key) || {};
      const fee = F.get(key)?.fee || 0;
      const revenue = Math.round((s.revenue || 0) - ((r.revenue || 0) - fee));
      const cogs = Math.round((s.cogs || 0) - (r.cogs || 0));
      return { key, revenue, profit: revenue - cogs - Math.round(s.minus || 0), orders: s.orders || 0 };
    }),
  };
}

/* ------------------------------- Chi phí ------------------------------- */

/**
 * Chi phí vận hành theo sổ quỹ (loại chi có cờ "tính vào chi phí").
 *
 * KHÔNG tính tiền xe trả tài xế (`shipper_out`): khoản đó đã trừ ngay trong lãi
 * gộp theo từng hoá đơn giao hàng — tính thêm ở đây là trừ hai lần.
 */
export function operatingExpenses(fromTs, toTs) {
  return all(`
    SELECT category, SUM(amount) AS amount FROM cash_live
    WHERE direction = 'out' AND datetime(ts) BETWEEN ? AND ?
      AND category <> 'shipper_out'
      AND category IN (SELECT code FROM cash_categories WHERE direction = 'out' AND is_expense = 1)
    GROUP BY category ORDER BY amount DESC`, [fromTs, toTs]);
}
