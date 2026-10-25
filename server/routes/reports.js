import { Router } from 'express';
import { all, get, accountBalance, customerDebt, supplierDebt } from '../db.js';
import { periodOf, salesSummary, salesSeries, operatingExpenses } from '../metrics.js';
import { overdueInvoices } from '../debt.js';
import { maxDebtDaysFor } from '../policy.js';
import { attendanceOfDay } from '../payroll.js';
import { supplyMap } from './orders.js';

const r = Router();

const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD giờ địa phương
const monthStart = () => today().slice(0, 8) + '01';

/* ============================ DASHBOARD ============================ */

r.get('/dashboard', (req, res) => {
  /* Kỳ đang xem + kỳ so sánh cùng số ngày (cùng giờ nếu kỳ chạy tới hôm nay).
     MỌI khối phân tích bên dưới dùng đúng kỳ này — trước đây biểu đồ luôn là
     30 ngày gần nhất, biểu đồ giờ luôn là hôm nay, dù đang chọn tháng trước. */
  const period = periodOf(req.query.from, req.query.to);
  const range = [period.fromTs, period.toTs];

  const summary = salesSummary(period);
  const compare = salesSummary(period.compare);
  const series = salesSeries(period);

  /* Giờ bán chạy trong kỳ: đủ 24 giờ — trước đây cắt cứng 7h–19h, đơn lúc 6h30
     hay 20h biến mất khỏi biểu đồ */
  const hourRows = all(`
    SELECT strftime('%H', ts) AS hour, SUM(total - vat_amount) AS revenue, COUNT(*) AS orders
    FROM sales WHERE status = 'done' AND datetime(ts) BETWEEN ? AND ?
    GROUP BY hour`, range);
  const hours = Array.from({ length: 24 }, (_, h) => {
    const row = hourRows.find((x) => Number(x.hour) === h);
    return { hour: h, revenue: row?.revenue || 0, orders: row?.orders || 0 };
  });

  /* Hàng bán chạy: gom theo MẶT HÀNG, số lượng quy về đơn vị cơ bản — trước đây
     một món bán cả "Cái" lẫn "Hộp" bị tách thành hai dòng xếp hạng */
  const products = all(`
    SELECT si.product_id, COALESCE(p.name, MAX(si.name_snapshot)) AS name, p.sku, p.base_unit,
           SUM(si.qty * si.factor) AS qty, SUM(si.amount) AS revenue,
           SUM(si.amount - si.qty * si.factor * si.unit_cost) AS profit
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    LEFT JOIN products p ON p.id = si.product_id
    WHERE s.status = 'done' AND datetime(s.ts) BETWEEN ? AND ?
    GROUP BY si.product_id`, range);
  const top = (key) => [...products].sort((a, b) => b[key] - a[key]).slice(0, 5);

  /* Doanh thu theo nhóm hàng: top 5 + "Khác", CỘNG ĐỦ TỔNG. Trước đây chỉ lấy 8
     nhóm rồi chia phần trăm trên tổng của 8 nhóm đó, nên tỷ trọng bị phóng to.
     Hàng mua hộ là một nhóm riêng. Đây là tiền hàng từng dòng — chưa chia giảm
     giá cả đơn, chưa trừ hàng trả. */
  const cats = all(`
    SELECT COALESCE(c.name, 'Chưa phân nhóm') AS name, SUM(si.amount) AS revenue
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN products p ON p.id = si.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE s.status = 'done' AND datetime(s.ts) BETWEEN ? AND ?
    GROUP BY c.id`, range);
  const consignAmt = get(`
    SELECT COALESCE(SUM(ci.amount), 0) AS v FROM sale_consign_items ci JOIN sales s ON s.id = ci.sale_id
    WHERE s.status = 'done' AND datetime(s.ts) BETWEEN ? AND ?`, range).v;
  if (consignAmt > 0) cats.push({ name: 'Hàng mua hộ', revenue: consignAmt });
  cats.sort((a, b) => b.revenue - a.revenue);
  const catTotal = cats.reduce((a, c) => a + c.revenue, 0);
  const categories = cats.slice(0, 5);
  const rest = cats.slice(5).reduce((a, c) => a + c.revenue, 0);
  if (rest > 0) categories.push({ name: `Khác (${cats.length - 5} nhóm)`, revenue: rest, other: true });

  // Cảnh báo tồn kho (tồn thực / định mức, theo đơn vị cơ bản)
  const lowStock = all(`
    SELECT * FROM (
      SELECT p.id, p.sku, p.name, p.base_unit, p.min_stock,
             COALESCE((SELECT SUM(qty) FROM stock s WHERE s.product_id = p.id), 0) AS qty
      FROM products p
      WHERE p.active = 1 AND p.track_stock = 1 AND p.min_stock > 0
    ) t
    WHERE t.qty <= t.min_stock
    ORDER BY (t.qty - t.min_stock) LIMIT 20`);

  /* Hết hàng THẬT SỰ cần nhập: chỉ món có bán trong 90 ngày gần nhất hoặc có
     định mức tồn (chủ tiệm chốt 11/10). Trước đây đếm cả món chưa nhập lần nào,
     món lâu không bán — ra con số kiểu "179 mặt hàng hết hàng" làm hoảng. */
  const outOfStock = get(`
    SELECT COUNT(*) AS n FROM products p
    WHERE p.active = 1 AND p.track_stock = 1
      AND COALESCE((SELECT SUM(qty) FROM stock s WHERE s.product_id = p.id), 0) <= 0
      AND (p.min_stock > 0 OR EXISTS (
        SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE si.product_id = p.id AND s.status = 'done'
          AND date(s.ts) >= date('now','localtime','-90 days')))`).n;

  /* ---------- Số dư TẠI THỜI ĐIỂM HIỆN TẠI — không theo kỳ đang chọn ---------- */
  const stockValue = get(`
    SELECT COALESCE(SUM(s.qty * p.cost_price), 0) AS value
    FROM stock s JOIN products p ON p.id = s.product_id WHERE p.active = 1`).value;
  const customerDebtTotal = all('SELECT id FROM customers WHERE active = 1')
    .reduce((a, c) => a + Math.max(0, customerDebt(c.id)), 0);
  const supplierDebtTotal = all('SELECT id FROM suppliers WHERE active = 1')
    .reduce((a, s) => a + Math.max(0, supplierDebt(s.id)), 0);
  const accounts = all('SELECT * FROM cash_accounts WHERE active = 1 ORDER BY sort_order, id');
  for (const a of accounts) a.balance = accountBalance(a.id);
  const cashTotal = accounts.reduce((a, x) => a + x.balance, 0);
  /* Thu / chi trong kỳ theo sổ quỹ — không kể chuyển quỹ (soát quỹ 30/09) */
  const cashFlow = get(`
    SELECT COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount END), 0) AS tin,
           COALESCE(SUM(CASE WHEN direction = 'out' THEN amount END), 0) AS tout
    FROM cash_live
    WHERE datetime(ts) BETWEEN ? AND ? AND category NOT IN ('transfer_in', 'transfer_out')`, range);

  const topCustomers = all(`
    SELECT c.id, c.name, SUM(s.total - s.vat_amount) AS revenue, COUNT(*) AS orders
    FROM sales s JOIN customers c ON c.id = s.customer_id
    WHERE s.status = 'done' AND datetime(s.ts) BETWEEN ? AND ?
    GROUP BY c.id ORDER BY revenue DESC LIMIT 5`, range);

  const recentSales = all(`
    SELECT s.id, s.code, s.ts, s.total, s.paid, s.payment_method, s.status,
           COALESCE(c.name, 'Khách lẻ') AS customer_name
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
    ORDER BY s.id DESC LIMIT 8`);

  res.json({
    period: { from: period.from, to: period.to, days: period.days, live: period.live, to_ts: period.toTs },
    compare_period: { from: period.compare.from, to: period.compare.to },
    as_of: period.as_of,
    summary, compare,
    series, hours,
    top: { revenue: top('revenue'), qty: top('qty'), profit: top('profit') },
    categories, category_total: catTotal,
    low_stock: lowStock, out_of_stock: outOfStock,
    stock_value: stockValue,
    customer_debt: customerDebtTotal, supplier_debt: supplierDebtTotal,
    cash_accounts: accounts, cash_total: cashTotal,
    cash_in: cashFlow.tin, cash_out: cashFlow.tout,
    expenses: operatingExpenses(period.fromTs, period.toTs),
    top_customers: topCustomers,
    recent_sales: recentSales,
  });
});

/* ==================================================================== *
 * KHỐI "CẦN XỬ LÝ" CỦA TỔNG QUAN (đợt B, plan pos-dashboard-plan.md)
 *
 * Những việc đang tồn đọng, mỗi việc kèm đường dẫn mở đúng danh sách đã
 * lọc. Tách API riêng: khối này lỗi thì chỉ khối này báo lỗi, phần còn lại
 * của Tổng quan vẫn dùng được.
 *
 * Không có nút làm thay việc ở đây (không thu tiền, không đặt hàng bằng một
 * cú bấm) — chỉ dẫn tới đúng chỗ để người làm tự xử lý.
 * Việc nào đang không có gì thì không trả về.
 * ==================================================================== */
r.get('/dashboard/actions', (req, res) => {
  const today = new Date().toLocaleDateString('sv-SE');
  const items = [];
  const push = (x) => { if (x.count > 0) items.push(x); };

  /* 1. Khách nợ quá số ngày cho phép (theo từng khách, hoặc chính sách chung) */
  let custN = 0;
  let custAmt = 0;
  for (const c of all('SELECT id FROM customers WHERE active = 1')) {
    if (customerDebt(c.id) <= 0) continue;
    const late = overdueInvoices(c.id, maxDebtDaysFor(c.id));
    if (late.length) { custN += 1; custAmt += late.reduce((a, i) => a + i.remaining, 0); }
  }
  push({
    key: 'customer_overdue', level: 'high', count: custN, amount: custAmt,
    label: `${custN} khách nợ quá hạn`, detail: `cần thu ${custAmt.toLocaleString('vi-VN')} đ`,
    action: 'Xem nợ quá hạn', to: '/customers?filter=overdue',
  });

  /* 2. Nợ nhà cung cấp quá hạn trả, và sắp đến hạn trong 3 ngày */
  const sup = get(`
    SELECT COUNT(DISTINCT supplier_id) AS n, COALESCE(SUM(total - paid), 0) AS amount
    FROM purchases WHERE status = 'done' AND total > paid
      AND due_date IS NOT NULL AND date(due_date) < date(?)`, [today]);
  const soon = get(`
    SELECT COUNT(DISTINCT supplier_id) AS n, COALESCE(SUM(total - paid), 0) AS amount
    FROM purchases WHERE status = 'done' AND total > paid
      AND due_date IS NOT NULL AND date(due_date) BETWEEN date(?) AND date(?, '+3 days')`, [today, today]);
  push({
    key: 'supplier_overdue', level: 'high', count: sup.n, amount: sup.amount,
    label: `${sup.n} nhà cung cấp quá hạn trả`, detail: `${sup.amount.toLocaleString('vi-VN')} đ`,
    action: 'Xem nợ NCC', to: '/suppliers?filter=overdue',
  });
  push({
    key: 'supplier_due_soon', level: 'medium', count: soon.n, amount: soon.amount,
    label: `${soon.n} nhà cung cấp đến hạn trả trong 3 ngày`, detail: `${soon.amount.toLocaleString('vi-VN')} đ`,
    action: 'Xem nợ NCC', to: '/suppliers?filter=debt',
  });

  /* 2b. Phiếu thủ kho đã nhận hàng, chờ chủ / quản lý chốt giá theo hoá đơn mối.
         Hàng đã vào kho với giá vốn tạm, chưa ghi nợ NCC — chốt càng sớm càng ít lệch */
  const pend = get(`
    SELECT COUNT(*) AS n, MIN(date(ts)) AS oldest FROM purchases WHERE status = 'pending_price'`);
  push({
    key: 'purchase_pending_price', level: 'medium', count: pend.n,
    label: `${pend.n} phiếu nhận hàng chờ chốt giá`,
    detail: pend.oldest ? `cũ nhất nhận ngày ${pend.oldest.split('-').reverse().join('/')} — chưa ghi nợ NCC` : 'chưa ghi nợ NCC',
    action: 'Chốt giá', to: '/purchases?status=pending_price',
  });

  /* 3. Hàng dưới định mức mà CHƯA nằm trong phiếu báo hết hàng nào đang mở —
        món đã báo rồi thì đừng nhắc nữa, kẻo đặt trùng */
  const low = get(`
    SELECT COUNT(*) AS n,
           COALESCE(SUM(CASE WHEN EXISTS (
             SELECT 1 FROM requisition_items ri JOIN requisitions rq ON rq.id = ri.requisition_id
             WHERE ri.product_id = t.id AND rq.status = 'open') THEN 1 ELSE 0 END), 0) AS reported
    FROM (
      SELECT p.id, p.min_stock,
             COALESCE((SELECT SUM(qty) FROM stock s WHERE s.product_id = p.id), 0) AS qty
      FROM products p WHERE p.active = 1 AND p.track_stock = 1 AND p.min_stock > 0
    ) t WHERE t.qty <= t.min_stock`);
  const lowNew = low.n - low.reported;
  push({
    key: 'low_stock', level: 'medium', count: lowNew,
    label: `${lowNew} mặt hàng dưới định mức chưa báo nhập`,
    detail: low.reported ? `${low.reported} món khác đã có trong phiếu báo hết hàng` : 'tồn hiện có ≤ tồn tối thiểu',
    action: 'Xem hàng cần nhập', to: '/products?filter=low',
  });

  /* 4. Đơn khách đặt: quá ngày hẹn giao, và còn thiếu hàng chưa đặt NCC */
  const late = get(`
    SELECT COUNT(*) AS n FROM sale_orders
    WHERE status IN ('open','partial') AND promised_at IS NOT NULL AND date(promised_at) < date(?)`, [today]).n;
  push({
    key: 'order_late', level: 'high', count: late,
    label: `${late} đơn đặt quá ngày hẹn giao`, detail: 'khách đang chờ',
    action: 'Xem đơn trễ', to: '/orders?late=1',
  });
  /* Cùng cách xét nguồn hàng với trang Đặt hàng (bộ lọc "Còn thiếu hàng"), để bấm
     sang đó thấy đúng chừng ấy đơn */
  const openIds = all("SELECT id FROM sale_orders WHERE status IN ('open','partial')").map((o) => o.id);
  const short = [...supplyMap(openIds).values()].filter((st) => ['short', 'partial'].includes(st?.state ?? st)).length;
  push({
    key: 'order_short', level: 'medium', count: short,
    label: `${short} đơn đặt còn thiếu hàng`, detail: 'kho chưa đủ giao — cần đặt thêm nhà cung cấp',
    action: 'Xem đơn thiếu hàng', to: '/orders?supply=need',
  });

  /* 5. Tiền thu hộ COD còn nằm ở người giao */
  const cod = get(`
    SELECT COUNT(*) AS n, COALESCE(SUM(cod_amount - cod_collected), 0) AS amount
    FROM sales WHERE status = 'done' AND cod_status = 'pending'`);
  push({
    key: 'cod_pending', level: 'medium', count: cod.n, amount: cod.amount,
    label: `${cod.n} đơn giao chưa đối soát tiền thu hộ`, detail: `${cod.amount.toLocaleString('vi-VN')} đ còn ở người giao`,
    action: 'Xem đơn thu hộ', to: '/sales?cod=pending',
  });

  /* 6. Phiếu bảo hành / sửa chữa quá ngày hẹn trả khách */
  const war = get(`
    SELECT COUNT(*) AS n FROM warranty_tickets
    WHERE status NOT IN ('delivered','cancelled') AND promised_at IS NOT NULL AND date(promised_at) < date(?)`, [today]).n;
  push({
    key: 'warranty_late', level: 'high', count: war,
    label: `${war} phiếu bảo hành quá hẹn trả khách`, detail: 'máy vẫn còn ở tiệm hoặc ở hãng',
    action: 'Xem phiếu trễ', to: '/warranty?late=1',
  });

  /* 6b. Phiếu sửa chờ chủ báo giá (vai trò Thợ, 25/10/2026) — máy nằm chờ ở tiệm,
         thợ chưa được sửa cho tới khi khách đồng ý giá */
  const wq = get(`
    SELECT COUNT(*) AS n FROM warranty_tickets
    WHERE quote_state = 'waiting_quote' AND status NOT IN ('delivered','cancelled')`).n;
  push({
    key: 'warranty_waiting_quote', level: 'medium', count: wq,
    label: `${wq} phiếu sửa chờ báo giá`, detail: 'thợ chưa được sửa cho tới khi khách đồng ý giá',
    action: 'Báo giá', to: '/warranty?quote=waiting_quote',
  });

  /* 7. Hàng mua hộ thu ngân đã bán, quản lý chưa khai hoa hồng / giá bốc */
  const rev = get(`
    SELECT COUNT(*) AS n, COUNT(DISTINCT ci.sale_id) AS bills
    FROM sale_consign_items ci JOIN sales s ON s.id = ci.sale_id
    WHERE ci.needs_review = 1 AND s.status = 'done'`);
  push({
    key: 'consign_review', level: 'medium', count: rev.n,
    label: `${rev.n} món mua hộ chờ khai hoa hồng`, detail: `trong ${rev.bills} hoá đơn — lãi của các đơn này đang tạm tính`,
    action: 'Xem hoá đơn', to: '/sales?review=1',
  });

  /* 8. Hôm nay còn người chưa chấm công (chỉ nhắc khi tiệm đã tới giờ làm) */
  try {
    const day = attendanceOfDay(today);
    const nowHm = new Date().toTimeString().slice(0, 5);
    const pending = (day.staff || []).filter((x) => !x.done && x.work_from && x.work_from <= nowHm);
    if (!day.shop_closed) {
      push({
        key: 'attendance', level: 'low', count: pending.length,
        label: `${pending.length} người chưa chấm công hôm nay`,
        detail: pending.slice(0, 3).map((x) => x.full_name).join(', ') + (pending.length > 3 ? '…' : ''),
        action: 'Mở bảng chấm công', to: '/pos',
      });
    }
  } catch { /* chưa dùng bảng lương: bỏ qua */ }

  const order = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => order[a.level] - order[b.level]);
  res.json({ as_of: new Date().toLocaleString('sv-SE'), items });
});

/* ============================ BÁO CÁO ============================== */

/** Báo cáo bán hàng: theo ngày / sản phẩm / nhân viên / khách hàng. */
r.get('/reports/sales', (req, res) => {
  const from = req.query.from || monthStart();
  const to = req.query.to || today();
  const groupBy = req.query.group_by || 'day';

  const groups = {
    day: { sql: "date(s.ts)", label: 'Ngày' },
    month: { sql: "strftime('%Y-%m', s.ts)", label: 'Tháng' },
    user: { sql: "COALESCE(u.full_name, 'Không rõ')", label: 'Nhân viên' },
    customer: { sql: "COALESCE(c.name, 'Khách lẻ')", label: 'Khách hàng' },
    payment: { sql: 's.payment_method', label: 'Hình thức thanh toán' },
  };
  const g = groups[groupBy] || groups.day;

  const rows = all(`
    SELECT ${g.sql} AS label,
           COUNT(*) AS orders,
           COALESCE(SUM(s.subtotal), 0) AS subtotal,
           COALESCE(SUM(s.discount), 0) AS discount,
           COALESCE(SUM(s.vat_amount), 0) AS vat,
           COALESCE(SUM(s.total), 0) AS revenue,
           COALESCE(SUM(s.cogs), 0) AS cogs,
           COALESCE(SUM(s.total - s.vat_amount - s.cogs - s.shipper_fee - s.points_amount), 0) AS profit,
           COALESCE(SUM(s.total - s.paid), 0) AS unpaid
    FROM sales s
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.status = 'done' AND date(s.ts) BETWEEN date(?) AND date(?)
    GROUP BY ${g.sql} ORDER BY revenue DESC`, [from, to]);

  const totals = rows.reduce((a, x) => ({
    orders: a.orders + x.orders, revenue: a.revenue + x.revenue,
    cogs: a.cogs + x.cogs, profit: a.profit + x.profit,
    vat: a.vat + x.vat, discount: a.discount + x.discount, unpaid: a.unpaid + x.unpaid,
  }), { orders: 0, revenue: 0, cogs: 0, profit: 0, vat: 0, discount: 0, unpaid: 0 });

  res.json({ from, to, group_by: groupBy, group_label: g.label, rows, totals });
});

/** Báo cáo lãi lỗ theo sản phẩm. */
r.get('/reports/products', (req, res) => {
  const from = req.query.from || monthStart();
  const to = req.query.to || today();
  const rows = all(`
    SELECT si.product_id, si.name_snapshot AS name, p.sku, p.base_unit,
           COALESCE(c.name, 'Chưa phân nhóm') AS category_name,
           SUM(si.qty * si.factor) AS qty_base,
           SUM(si.amount) AS revenue,
           SUM(si.qty * si.factor * si.unit_cost) AS cogs,
           SUM(si.amount - si.qty * si.factor * si.unit_cost) AS profit,
           COUNT(DISTINCT si.sale_id) AS orders
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN products p ON p.id = si.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE s.status = 'done' AND date(s.ts) BETWEEN date(?) AND date(?)
    GROUP BY si.product_id ORDER BY revenue DESC`, [from, to]);
  for (const x of rows) x.margin = x.revenue > 0 ? (x.profit / x.revenue) * 100 : 0;
  res.json({ from, to, rows });
});

/** Báo cáo mua hàng theo nhà cung cấp. */
r.get('/reports/purchases', (req, res) => {
  const from = req.query.from || monthStart();
  const to = req.query.to || today();
  const rows = all(`
    SELECT COALESCE(sup.name, 'Không rõ') AS label, sup.id AS supplier_id,
           COUNT(*) AS bills,
           COALESCE(SUM(p.total), 0) AS total,
           COALESCE(SUM(p.paid), 0) AS paid,
           COALESCE(SUM(p.total - p.paid), 0) AS unpaid
    FROM purchases p LEFT JOIN suppliers sup ON sup.id = p.supplier_id
    WHERE p.status = 'done' AND date(p.ts) BETWEEN date(?) AND date(?)
    GROUP BY p.supplier_id ORDER BY total DESC`, [from, to]);
  const totals = rows.reduce((a, x) => ({
    bills: a.bills + x.bills, total: a.total + x.total,
    paid: a.paid + x.paid, unpaid: a.unpaid + x.unpaid,
  }), { bills: 0, total: 0, paid: 0, unpaid: 0 });
  res.json({ from, to, rows, totals });
});

/** Báo cáo xuất nhập tồn. */
r.get('/reports/inventory', (req, res) => {
  const from = req.query.from || monthStart();
  const to = req.query.to || today();
  const rows = all(`
    SELECT p.id, p.sku, p.name, p.base_unit, p.cost_price,
           COALESCE((SELECT SUM(qty) FROM stock s WHERE s.product_id = p.id), 0) AS closing,
           COALESCE((SELECT SUM(m.qty_change) FROM stock_moves m
                     WHERE m.product_id = p.id AND m.qty_change > 0
                       AND date(m.ts) BETWEEN date(?) AND date(?)), 0) AS qty_in,
           COALESCE((SELECT -SUM(m.qty_change) FROM stock_moves m
                     WHERE m.product_id = p.id AND m.qty_change < 0
                       AND date(m.ts) BETWEEN date(?) AND date(?)), 0) AS qty_out
    FROM products p
    WHERE p.active = 1 AND p.track_stock = 1
    ORDER BY p.name`, [from, to, from, to]);
  for (const x of rows) {
    x.opening = x.closing - x.qty_in + x.qty_out;
    x.value = Math.round(x.closing * x.cost_price);
  }
  res.json({ from, to, rows, total_value: rows.reduce((a, x) => a + x.value, 0) });
});

/** Báo cáo lãi lỗ tổng hợp (kết quả kinh doanh). */
r.get('/reports/pnl', (req, res) => {
  /* Cùng một hàm tính với trang Tổng quan (server/metrics.js) — trước đây hai trang
     tự tính mỗi nơi một kiểu nên cùng một tháng ra hai con số doanh thu, lãi. */
  const period = periodOf(req.query.from, req.query.to);
  const s = salesSummary(period);
  const expenses = operatingExpenses(period.fromTs, period.toTs);
  const expenseTotal = expenses.reduce((a, x) => a + x.amount, 0);
  /* Điểm tích luỹ (mục IV.1): phát ra bao nhiêu điểm, khách đã dùng bao nhiêu —
     tiền khách gán bằng điểm đã trừ ngay trong lãi gộp */
  const points = get(`
    SELECT COALESCE(SUM(CASE WHEN points > 0 THEN points END), 0) AS earned,
           COALESCE(SUM(CASE WHEN points < 0 THEN -points END), 0) AS used,
           COALESCE(SUM(CASE WHEN kind = 'redeem' THEN money END), 0) AS money
    FROM loyalty_entries WHERE datetime(ts) BETWEEN ? AND ?`, [period.fromTs, period.toTs]);

  res.json({
    from: period.from, to: period.to,
    gross_sales: s.gross, discount: s.discount, ship_charged: s.ship_charged, vat: s.vat,
    returns: s.returns, returns_count: s.returns_count, net_revenue: s.revenue,
    cogs: s.cogs, sales_cogs: s.sales_cogs, returns_cogs: s.returns_cogs,
    shipper_fee: s.shipper_fee, points_amount: s.points_amount,
    gross_profit: s.profit,
    margin: s.margin ?? 0,
    missing_cost: s.missing_cost,
    expenses, expense_total: expenseTotal,
    points,
    net_profit: s.profit - expenseTotal,
  });
});

/* ==================================================================== */
/* LỊCH SỬ MUA HÀNG — theo mặt hàng hoặc theo nhà cung cấp               */
/* ==================================================================== */

r.get('/reports/purchase-history', (req, res) => {
  const from = req.query.from || monthStart();
  const to = req.query.to || today();
  const { product_id, supplier_id, q = '', limit = 500 } = req.query;

  const where = ["p.status = 'done'", 'date(p.ts) BETWEEN date(?) AND date(?)'];
  const params = [from, to];
  if (product_id) { where.push('pi.product_id = ?'); params.push(product_id); }
  if (supplier_id) { where.push('p.supplier_id = ?'); params.push(supplier_id); }
  if (q.trim()) {
    where.push('(pr.name LIKE ? OR pr.alias LIKE ? OR pr.sku LIKE ? OR s.name LIKE ? OR p.code LIKE ?)');
    const like = `%${q.trim()}%`;
    params.push(like, like, like, like, like);
  }

  const rows = all(`
    SELECT p.id AS purchase_id, p.code, p.ts, p.supplier_invoice,
           s.id AS supplier_id, COALESCE(s.name, 'Không rõ') AS supplier_name,
           pi.product_id, pr.name AS product_name, pr.sku, pr.base_unit,
           pi.unit_name, pi.factor, pi.qty, pi.price, pi.amount,
           (pi.qty * pi.factor) AS qty_base,
           CASE WHEN pi.qty * pi.factor > 0
                THEN CAST(ROUND(pi.amount / (pi.qty * pi.factor)) AS INTEGER)
                ELSE 0 END AS unit_price_base
    FROM purchase_items pi
    JOIN purchases p ON p.id = pi.purchase_id
    JOIN products pr ON pr.id = pi.product_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE ${where.join(' AND ')}
    ORDER BY p.ts DESC, p.id DESC LIMIT ${Number(limit)}`, params);

  const totals = {
    lines: rows.length,
    qty: rows.reduce((a, x) => a + x.qty_base, 0),
    amount: rows.reduce((a, x) => a + x.amount, 0),
    bills: new Set(rows.map((x) => x.purchase_id)).size,
  };

  // Gom theo mặt hàng để thấy giá nhập biến động thế nào
  const byProduct = {};
  for (const x of rows) {
    const g = byProduct[x.product_id] || (byProduct[x.product_id] = {
      product_id: x.product_id, name: x.product_name, sku: x.sku, base_unit: x.base_unit,
      qty: 0, amount: 0, times: 0, min_price: null, max_price: null, last_price: null, last_ts: null,
    });
    g.qty += x.qty_base;
    g.amount += x.amount;
    g.times += 1;
    const up = x.unit_price_base;
    g.min_price = g.min_price === null ? up : Math.min(g.min_price, up);
    g.max_price = g.max_price === null ? up : Math.max(g.max_price, up);
    if (!g.last_ts || x.ts > g.last_ts) { g.last_ts = x.ts; g.last_price = up; }
  }
  const products = Object.values(byProduct)
    .map((g) => ({ ...g, avg_price: g.qty > 0 ? Math.round(g.amount / g.qty) : 0 }))
    .sort((a, b) => b.amount - a.amount);

  res.json({ from, to, rows, totals, products });
});

/* ==================================================================== */
/* LỊCH SỬ BÁN HÀNG — theo mặt hàng hoặc theo khách hàng                 */
/* ==================================================================== */

r.get('/reports/sale-history', (req, res) => {
  const from = req.query.from || monthStart();
  const to = req.query.to || today();
  const { product_id, customer_id, q = '', limit = 500 } = req.query;

  const where = ["s.status = 'done'", 'date(s.ts) BETWEEN date(?) AND date(?)'];
  const params = [from, to];
  if (product_id) { where.push('si.product_id = ?'); params.push(product_id); }
  if (customer_id) { where.push('s.customer_id = ?'); params.push(customer_id); }
  if (q.trim()) {
    where.push('(si.name_snapshot LIKE ? OR pr.alias LIKE ? OR pr.sku LIKE ? OR c.name LIKE ? OR s.code LIKE ?)');
    const like = `%${q.trim()}%`;
    params.push(like, like, like, like, like);
  }

  const rows = all(`
    SELECT s.id AS sale_id, s.code, s.ts, s.payment_method,
           c.id AS customer_id, COALESCE(c.name, 'Khách lẻ') AS customer_name, c.phone AS customer_phone,
           u.full_name AS user_name,
           si.product_id, si.name_snapshot AS product_name, pr.sku, pr.base_unit,
           si.unit_name, si.factor, si.qty, si.price, si.discount, si.amount, si.unit_cost, si.note,
           (si.qty * si.factor) AS qty_base,
           (si.amount - si.qty * si.factor * si.unit_cost) AS profit
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN products pr ON pr.id = si.product_id
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN users u ON u.id = s.user_id
    WHERE ${where.join(' AND ')}
    ORDER BY s.ts DESC, s.id DESC LIMIT ${Number(limit)}`, params);

  const totals = {
    lines: rows.length,
    qty: rows.reduce((a, x) => a + x.qty_base, 0),
    amount: rows.reduce((a, x) => a + x.amount, 0),
    profit: rows.reduce((a, x) => a + x.profit, 0),
    bills: new Set(rows.map((x) => x.sale_id)).size,
  };

  // Gom theo mặt hàng: giá bán thấp nhất / cao nhất để soi bán hớ
  const byProduct = {};
  for (const x of rows) {
    const g = byProduct[x.product_id] || (byProduct[x.product_id] = {
      product_id: x.product_id, name: x.product_name, sku: x.sku, base_unit: x.base_unit,
      qty: 0, amount: 0, profit: 0, times: 0,
      min_price: null, max_price: null, last_price: null, last_ts: null,
    });
    g.qty += x.qty_base;
    g.amount += x.amount;
    g.profit += x.profit;
    g.times += 1;
    const up = x.qty_base > 0 ? Math.round(x.amount / x.qty_base) : 0;
    g.min_price = g.min_price === null ? up : Math.min(g.min_price, up);
    g.max_price = g.max_price === null ? up : Math.max(g.max_price, up);
    if (!g.last_ts || x.ts > g.last_ts) { g.last_ts = x.ts; g.last_price = up; }
  }
  const products = Object.values(byProduct)
    .map((g) => ({ ...g, avg_price: g.qty > 0 ? Math.round(g.amount / g.qty) : 0 }))
    .sort((a, b) => b.amount - a.amount);

  // Gom theo khách hàng
  const byCustomer = {};
  for (const x of rows) {
    const key = x.customer_id ?? 0;
    const g = byCustomer[key] || (byCustomer[key] = {
      customer_id: x.customer_id, name: x.customer_name, phone: x.customer_phone,
      amount: 0, profit: 0, qty: 0, bills: new Set(),
    });
    g.amount += x.amount;
    g.profit += x.profit;
    g.qty += x.qty_base;
    g.bills.add(x.sale_id);
  }
  const customers = Object.values(byCustomer)
    .map((g) => ({ ...g, bills: g.bills.size }))
    .sort((a, b) => b.amount - a.amount);

  res.json({ from, to, rows, totals, products, customers });
});

export default r;
