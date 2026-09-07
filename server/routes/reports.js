import { Router } from 'express';
import { all, get, accountBalance, customerDebt, supplierDebt } from '../db.js';

const r = Router();

const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD giờ địa phương
const monthStart = () => today().slice(0, 8) + '01';

/* ============================ DASHBOARD ============================ */

r.get('/dashboard', (req, res) => {
  const from = req.query.from || monthStart();
  const to = req.query.to || today();
  const d = today();

  const sumSales = (whereSql, params) => get(`
    SELECT COALESCE(SUM(total), 0) AS revenue,
           COALESCE(SUM(total - vat_amount - cogs), 0) AS profit,
           COALESCE(SUM(cogs), 0) AS cogs,
           COUNT(*) AS orders,
           COALESCE(SUM(total - paid), 0) AS unpaid
    FROM sales WHERE status = 'done' AND ${whereSql}`, params);

  const todayStats = sumSales('date(ts) = date(?)', [d]);
  const yesterdayStats = sumSales("date(ts) = date(?, '-1 day')", [d]);
  const rangeStats = sumSales('date(ts) BETWEEN date(?) AND date(?)', [from, to]);
  const monthStats = sumSales("strftime('%Y-%m', ts) = strftime('%Y-%m', ?)", [d]);

  // Doanh thu 30 ngày gần nhất
  const dailyRevenue = all(`
    SELECT date(ts) AS day,
           SUM(total) AS revenue,
           SUM(total - vat_amount - cogs) AS profit,
           COUNT(*) AS orders
    FROM sales WHERE status = 'done' AND date(ts) >= date(?, '-29 days')
    GROUP BY date(ts) ORDER BY day`, [d]);

  // Doanh thu theo giờ trong ngày -> biết giờ cao điểm
  const hourly = all(`
    SELECT strftime('%H', ts) AS hour, SUM(total) AS revenue, COUNT(*) AS orders
    FROM sales WHERE status = 'done' AND date(ts) = date(?)
    GROUP BY hour ORDER BY hour`, [d]);

  // Top sản phẩm bán chạy trong kỳ
  const topProducts = all(`
    SELECT si.product_id, si.name_snapshot AS name, si.unit_name,
           SUM(si.qty) AS qty, SUM(si.amount) AS revenue,
           SUM(si.amount - si.qty * si.factor * si.unit_cost) AS profit
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.status = 'done' AND date(s.ts) BETWEEN date(?) AND date(?)
    GROUP BY si.product_id, si.unit_name
    ORDER BY revenue DESC LIMIT 10`, [from, to]);

  // Doanh thu theo nhóm hàng
  const byCategory = all(`
    SELECT COALESCE(c.name, 'Chưa phân nhóm') AS name, SUM(si.amount) AS revenue
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN products p ON p.id = si.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE s.status = 'done' AND date(s.ts) BETWEEN date(?) AND date(?)
    GROUP BY c.id ORDER BY revenue DESC LIMIT 8`, [from, to]);

  // Cơ cấu thanh toán
  const byPayment = all(`
    SELECT payment_method, SUM(total) AS amount, COUNT(*) AS n
    FROM sales WHERE status = 'done' AND date(ts) BETWEEN date(?) AND date(?)
    GROUP BY payment_method`, [from, to]);

  // Cảnh báo tồn kho
  const lowStock = all(`
    SELECT * FROM (
      SELECT p.id, p.sku, p.name, p.base_unit, p.min_stock,
             COALESCE((SELECT SUM(qty) FROM stock s WHERE s.product_id = p.id), 0) AS qty
      FROM products p
      WHERE p.active = 1 AND p.track_stock = 1 AND p.min_stock > 0
    ) t
    WHERE t.qty <= t.min_stock
    ORDER BY (t.qty - t.min_stock) LIMIT 20`);

  const outOfStock = get(`
    SELECT COUNT(*) AS n FROM products p
    WHERE p.active = 1 AND p.track_stock = 1
      AND COALESCE((SELECT SUM(qty) FROM stock s WHERE s.product_id = p.id), 0) <= 0`).n;

  // Giá trị tồn kho
  const stockValue = get(`
    SELECT COALESCE(SUM(s.qty * p.cost_price), 0) AS value,
           COALESCE(SUM(s.qty), 0) AS qty
    FROM stock s JOIN products p ON p.id = s.product_id WHERE p.active = 1`);

  // Công nợ
  const customerDebtTotal = all('SELECT id FROM customers WHERE active = 1')
    .reduce((a, c) => a + Math.max(0, customerDebt(c.id)), 0);
  const supplierDebtTotal = all('SELECT id FROM suppliers WHERE active = 1')
    .reduce((a, s) => a + Math.max(0, supplierDebt(s.id)), 0);

  // Quỹ tiền
  const accounts = all('SELECT * FROM cash_accounts WHERE active = 1 ORDER BY sort_order, id');
  for (const a of accounts) a.balance = accountBalance(a.id);
  const cashTotal = accounts.reduce((a, x) => a + x.balance, 0);

  const cashToday = get(`
    SELECT COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount END), 0) AS tin,
           COALESCE(SUM(CASE WHEN direction = 'out' THEN amount END), 0) AS tout
    FROM cash_transactions WHERE date(ts) = date(?)`, [d]);

  // Chi phí trong kỳ (không tính mua hàng & trả nợ)
  const expenses = all(`
    SELECT category, SUM(amount) AS amount FROM cash_transactions
    WHERE direction = 'out' AND date(ts) BETWEEN date(?) AND date(?)
      AND category NOT IN ('purchase','debt_out','transfer_out','sale_return')
    GROUP BY category ORDER BY amount DESC`, [from, to]);

  // Khách hàng mua nhiều nhất
  const topCustomers = all(`
    SELECT c.id, c.name, c.phone, SUM(s.total) AS revenue, COUNT(*) AS orders
    FROM sales s JOIN customers c ON c.id = s.customer_id
    WHERE s.status = 'done' AND date(s.ts) BETWEEN date(?) AND date(?)
    GROUP BY c.id ORDER BY revenue DESC LIMIT 8`, [from, to]);

  const recentSales = all(`
    SELECT s.id, s.code, s.ts, s.total, s.paid, s.payment_method, s.status,
           COALESCE(c.name, 'Khách lẻ') AS customer_name
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
    ORDER BY s.id DESC LIMIT 8`);

  const returnsRange = get(`
    SELECT COALESCE(SUM(total), 0) AS amount, COUNT(*) AS n
    FROM sale_returns WHERE date(ts) BETWEEN date(?) AND date(?)`, [from, to]);

  res.json({
    from, to,
    today: todayStats, yesterday: yesterdayStats, range: rangeStats, month: monthStats,
    daily_revenue: dailyRevenue, hourly,
    top_products: topProducts, top_customers: topCustomers,
    by_category: byCategory, by_payment: byPayment,
    low_stock: lowStock, out_of_stock: outOfStock,
    stock_value: stockValue.value, stock_qty: stockValue.qty,
    customer_debt: customerDebtTotal, supplier_debt: supplierDebtTotal,
    cash_accounts: accounts, cash_total: cashTotal,
    cash_today_in: cashToday.tin, cash_today_out: cashToday.tout,
    expenses, returns: returnsRange,
    recent_sales: recentSales,
    counts: {
      products: get('SELECT COUNT(*) AS n FROM products WHERE active = 1').n,
      customers: get('SELECT COUNT(*) AS n FROM customers WHERE active = 1').n,
      suppliers: get('SELECT COUNT(*) AS n FROM suppliers WHERE active = 1').n,
    },
  });
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
           COALESCE(SUM(s.total - s.vat_amount - s.cogs), 0) AS profit,
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
  const from = req.query.from || monthStart();
  const to = req.query.to || today();

  const sales = get(`
    SELECT COALESCE(SUM(subtotal), 0) AS gross,
           COALESCE(SUM(discount), 0) AS discount,
           COALESCE(SUM(vat_amount), 0) AS vat,
           COALESCE(SUM(total), 0) AS total,
           COALESCE(SUM(cogs), 0) AS cogs
    FROM sales WHERE status = 'done' AND date(ts) BETWEEN date(?) AND date(?)`, [from, to]);

  const returns = get(`
    SELECT COALESCE(SUM(total), 0) AS total FROM sale_returns
    WHERE date(ts) BETWEEN date(?) AND date(?)`, [from, to]);

  const expenses = all(`
    SELECT category, SUM(amount) AS amount FROM cash_transactions
    WHERE direction = 'out' AND date(ts) BETWEEN date(?) AND date(?)
      AND category NOT IN ('purchase','debt_out','transfer_out','sale_return','capital_out')
    GROUP BY category ORDER BY amount DESC`, [from, to]);

  const expenseTotal = expenses.reduce((a, x) => a + x.amount, 0);
  const netRevenue = sales.total - sales.vat - returns.total;
  const grossProfit = netRevenue - sales.cogs;

  res.json({
    from, to,
    gross_sales: sales.gross, discount: sales.discount, vat: sales.vat,
    returns: returns.total, net_revenue: netRevenue,
    cogs: sales.cogs, gross_profit: grossProfit,
    margin: netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0,
    expenses, expense_total: expenseTotal,
    net_profit: grossProfit - expenseTotal,
  });
});

export default r;
