import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  TrendingUp, Wallet, Package, Users, AlertTriangle, ShoppingCart, Receipt,
  HandCoins, Landmark, PackageX, ArrowRight, Clock, Boxes, Truck,
} from 'lucide-react';
import { api } from '../lib/api';
import { useFetch, useApp } from '../lib/store';
import { money, n, short, qty as fq, smartTime, date, pct, RANGES, range, PAYMENT_LABEL } from '../lib/format';
import { Stat, Spinner, ErrorBox, Empty, Badge, Button } from '../components/ui';
import { PageHeader, Page } from '../components/Layout';

/* Bảng màu biểu đồ: khác nhau rõ cả về sắc lẫn độ đậm để người khó phân biệt màu vẫn đọc được */
const CHART_COLORS = ['#047857', '#1D4ED8', '#B45309', '#7C3AED', '#BE185D', '#0E7490', '#4D7C0F', '#9A3412'];

function ChartCard({ title, subtitle, children, action, height = 240 }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-2 px-3 py-2.5 border-b border-line">
        <div className="min-w-0">
          <h2 className="text-[13px] font-bold">{title}</h2>
          {subtitle && <p className="text-2xs text-muted-ink mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-2" style={{ height }}>{children}</div>
    </div>
  );
}

/** Khung tooltip dùng chung, luôn hiện nhãn + giá trị bằng chữ. */
function TipBox({ active, payload, label, formatter = money }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-line rounded shadow-pop px-2.5 py-1.5 text-[13px]">
      {label != null && <div className="font-semibold mb-0.5">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5 tabular">
          <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: p.color || p.fill }} aria-hidden="true" />
          <span className="text-muted-ink">{p.name}:</span>
          <span className="font-semibold font-mono">{formatter(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { store } = useApp();
  const [rangeKey, setRangeKey] = useState('month');
  const r = useMemo(() => range(rangeKey), [rangeKey]);
  const { data, busy, error, reload } = useFetch(
    () => api.dashboard({ from: r.from, to: r.to }), [r.from, r.to]
  );

  if (busy && !data) return <><PageHeader title="Tổng quan" /><Spinner /></>;
  if (error) return <><PageHeader title="Tổng quan" /><Page><ErrorBox error={error} onRetry={reload} /></Page></>;
  if (!data) return null;

  const growth = data.yesterday.revenue > 0
    ? ((data.today.revenue - data.yesterday.revenue) / data.yesterday.revenue) * 100
    : null;

  const chartDaily = data.daily_revenue.map((d) => ({
    day: date(d.day).slice(0, 5),
    'Doanh thu': d.revenue,
    'Lợi nhuận': d.profit,
    orders: d.orders,
  }));

  const chartHourly = Array.from({ length: 13 }, (_, i) => {
    const h = i + 7;
    const row = data.hourly.find((x) => Number(x.hour) === h);
    return { hour: `${h}h`, 'Doanh thu': row?.revenue || 0, orders: row?.orders || 0 };
  });

  const chartCategory = data.by_category.map((c, i) => ({
    name: c.name, value: c.revenue, fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  const totalCatRevenue = chartCategory.reduce((a, c) => a + c.value, 0);

  return (
    <>
      <PageHeader
        title="Tổng quan cửa hàng"
        subtitle={`${store.name || ''} · ${date(r.from)} — ${date(r.to)}`}
        actions={
          <Link to="/pos" className="btn btn-primary btn-touch">
            <ShoppingCart size={16} aria-hidden="true" />
            Mở màn hình bán hàng
          </Link>
        }
      >
        <div className="flex gap-1.5 flex-wrap">
          {RANGES.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setRangeKey(key)}
              className={`btn btn-sm ${rangeKey === key ? 'btn-secondary' : 'btn-outline'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </PageHeader>

      <Page className="space-y-3">
        {/* ------------------------ Số liệu hôm nay ------------------------ */}
        <section aria-label="Số liệu hôm nay">
          <h2 className="text-2xs font-bold text-muted-ink uppercase tracking-wide mb-2">Hôm nay</h2>
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Doanh thu hôm nay"
              value={short(data.today.revenue)}
              sub={`${data.today.orders} hoá đơn`}
              trend={growth}
              icon={TrendingUp}
              tone="good"
            />
            <Stat
              label="Lợi nhuận hôm nay"
              value={short(data.today.profit)}
              sub={data.today.revenue > 0 ? `Tỷ suất ${pct(data.today.profit / data.today.revenue * 100)}` : 'Chưa có đơn'}
              icon={Receipt}
            />
            <Stat
              label="Thu tiền mặt + CK"
              value={short(data.cash_today_in)}
              sub={`Chi ra ${short(data.cash_today_out)}`}
              icon={Wallet}
            />
            <Stat
              label="Tổng quỹ hiện có"
              value={short(data.cash_total)}
              sub={data.cash_accounts.map((a) => `${a.name}: ${short(a.balance)}`).join(' · ')}
              icon={Landmark}
              tone={data.cash_total < 0 ? 'bad' : 'default'}
            />
          </div>
        </section>

        {/* ------------------------ Số liệu kỳ chọn ------------------------ */}
        <section aria-label={`Số liệu ${r.label}`}>
          <h2 className="text-2xs font-bold text-muted-ink uppercase tracking-wide mb-2">{r.label}</h2>
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
            <Stat label="Doanh thu" value={short(data.range.revenue)} sub={`${data.range.orders} hoá đơn`} tone="good" />
            <Stat
              label="Lợi nhuận gộp"
              value={short(data.range.profit)}
              sub={data.range.revenue > 0 ? `Tỷ suất ${pct(data.range.profit / data.range.revenue * 100)}` : '—'}
            />
            <Stat label="Giá vốn hàng bán" value={short(data.range.cogs)} />
            <Stat
              label="Khách trả hàng"
              value={short(data.returns.amount)}
              sub={`${data.returns.n} phiếu`}
              tone={data.returns.amount > 0 ? 'warn' : 'default'}
            />
          </div>
        </section>

        {/* --------------------------- Biểu đồ ---------------------------- */}
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ChartCard
              title="Doanh thu &amp; lợi nhuận 30 ngày gần nhất"
              subtitle="Cột xanh đậm là doanh thu, đường xanh dương là lợi nhuận"
              height={280}
            >
              {chartDaily.length === 0
                ? <Empty title="Chưa có dữ liệu bán hàng" message="Biểu đồ sẽ hiện khi có hoá đơn đầu tiên." />
                : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartDaily} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#047857" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="#047857" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#475569' }} tickLine={false} axisLine={{ stroke: '#E2E8F0' }} interval="preserveStartEnd" />
                      <YAxis tickFormatter={short} tick={{ fontSize: 10, fill: '#475569' }} tickLine={false} axisLine={false} width={48} />
                      <Tooltip content={<TipBox />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey="Doanh thu" stroke="#047857" strokeWidth={2} fill="url(#gRev)" />
                      <Line type="monotone" dataKey="Lợi nhuận" stroke="#1D4ED8" strokeWidth={2} dot={false} strokeDasharray="5 3" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
            </ChartCard>
          </div>

          <ChartCard
            title="Doanh thu theo nhóm hàng"
            subtitle={r.label}
            height={280}
          >
            {chartCategory.length === 0
              ? <Empty title="Chưa có dữ liệu" />
              : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartCategory}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="45%"
                      innerRadius={44}
                      outerRadius={76}
                      paddingAngle={2}
                    >
                      {chartCategory.map((c, i) => <Cell key={i} fill={c.fill} />)}
                    </Pie>
                    <Tooltip content={<TipBox />} />
                    <Legend
                      wrapperStyle={{ fontSize: 11 }}
                      formatter={(v, e) => {
                        const p = totalCatRevenue > 0 ? (e.payload.value / totalCatRevenue * 100).toFixed(0) : 0;
                        return `${v} (${p}%)`;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
          </ChartCard>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <ChartCard title="Giờ bán chạy trong ngày" subtitle="Biết giờ cao điểm để bố trí người trực quầy">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartHourly} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#475569' }} tickLine={false} axisLine={{ stroke: '#E2E8F0' }} />
                <YAxis tickFormatter={short} tick={{ fontSize: 10, fill: '#475569' }} tickLine={false} axisLine={false} width={44} />
                <Tooltip content={<TipBox />} cursor={{ fill: '#F1F5F9' }} />
                <Bar dataKey="Doanh thu" fill="#047857" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Top sản phẩm */}
          <div className="card flex flex-col">
            <div className="px-3 py-2.5 border-b border-line flex items-center justify-between">
              <h2 className="text-[13px] font-bold">Hàng bán chạy nhất</h2>
              <Link to="/reports" className="text-2xs text-accent font-semibold hover:underline">
                Xem báo cáo
              </Link>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[240px]">
              {data.top_products.length === 0
                ? <Empty title="Chưa có dữ liệu" />
                : (
                  <ul className="divide-y divide-line">
                    {data.top_products.map((p, i) => (
                      <li key={i} className="px-3 py-2 flex items-center gap-2.5 hover:bg-muted/50 transition-colors duration-100">
                        <span className="w-5 h-5 rounded bg-muted text-2xs font-bold flex items-center justify-center shrink-0 tabular">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold truncate">{p.name}</div>
                          <div className="text-2xs text-muted-ink tabular">
                            Bán {fq(p.qty)} {p.unit_name} · lãi {short(p.profit)}
                          </div>
                        </div>
                        <span className="text-[13px] font-bold tabular font-mono shrink-0">{short(p.revenue)}</span>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          </div>

          {/* Khách hàng lớn */}
          <div className="card flex flex-col">
            <div className="px-3 py-2.5 border-b border-line flex items-center justify-between">
              <h2 className="text-[13px] font-bold">Khách mua nhiều nhất</h2>
              <Link to="/customers" className="text-2xs text-accent font-semibold hover:underline">
                Danh sách khách
              </Link>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[240px]">
              {data.top_customers.length === 0
                ? <Empty title="Chưa có khách quen" message="Hoá đơn chưa gắn tên khách sẽ không thống kê được." />
                : (
                  <ul className="divide-y divide-line">
                    {data.top_customers.map((c) => (
                      <li key={c.id}>
                        <Link
                          to={`/customers/${c.id}`}
                          className="px-3 py-2 flex items-center gap-2.5 hover:bg-muted/50 transition-colors duration-100"
                        >
                          <div className="w-6 h-6 rounded-full bg-accent-soft text-emerald-900 text-2xs
                                          font-bold flex items-center justify-center shrink-0" aria-hidden="true">
                            {c.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-semibold truncate">{c.name}</div>
                            <div className="text-2xs text-muted-ink tabular">{c.orders} đơn · {c.phone || 'chưa có SĐT'}</div>
                          </div>
                          <span className="text-[13px] font-bold tabular font-mono shrink-0">{short(c.revenue)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          </div>
        </div>

        {/* ------------------------ Cảnh báo & công nợ ---------------------- */}
        <div className="grid gap-3 lg:grid-cols-3">
          {/* Cảnh báo tồn kho */}
          <div className="card flex flex-col">
            <div className="px-3 py-2.5 border-b border-line flex items-center justify-between gap-2">
              <h2 className="text-[13px] font-bold flex items-center gap-1.5">
                <AlertTriangle size={14} className="text-warn" aria-hidden="true" />
                Cần nhập thêm hàng
              </h2>
              <Link to="/stock?filter=low" className="text-2xs text-accent font-semibold hover:underline">
                Xem kho
              </Link>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[220px]">
              {data.low_stock.length === 0
                ? <Empty icon={Boxes} title="Kho đang ổn" message="Không có mặt hàng nào dưới định mức tồn tối thiểu." />
                : (
                  <ul className="divide-y divide-line">
                    {data.low_stock.map((p) => (
                      <li key={p.id} className="px-3 py-2 flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold truncate">{p.name}</div>
                          <div className="text-2xs text-muted-ink font-mono">{p.sku}</div>
                        </div>
                        <Badge tone={p.qty <= 0 ? 'bad' : 'warn'}>
                          {fq(p.qty)}/{fq(p.min_stock)} {p.base_unit}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
            {data.out_of_stock > 0 && (
              <div className="px-3 py-2 border-t border-line bg-red-50 text-2xs text-danger font-semibold flex items-center gap-1.5">
                <PackageX size={13} aria-hidden="true" />
                {data.out_of_stock} mặt hàng đã hết sạch trong kho
              </div>
            )}
          </div>

          {/* Công nợ */}
          <div className="card">
            <div className="px-3 py-2.5 border-b border-line">
              <h2 className="text-[13px] font-bold">Công nợ &amp; tài sản</h2>
            </div>
            <div className="p-3 space-y-2.5">
              <Link
                to="/customer-debts"
                className="flex items-center gap-2.5 p-2 -m-2 rounded hover:bg-muted transition-colors duration-150"
              >
                <HandCoins size={17} className="text-warn shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold">Khách đang nợ mình</div>
                  <div className="text-2xs text-muted-ink">Tiền phải thu về</div>
                </div>
                <span className="font-display font-bold tabular text-warn">{short(data.customer_debt)}</span>
                <ArrowRight size={13} className="text-muted-ink shrink-0" aria-hidden="true" />
              </Link>

              <Link
                to="/supplier-debts"
                className="flex items-center gap-2.5 p-2 -m-2 rounded hover:bg-muted transition-colors duration-150"
              >
                <Truck size={17} className="text-danger shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold">Mình đang nợ NCC</div>
                  <div className="text-2xs text-muted-ink">Tiền phải trả</div>
                </div>
                <span className="font-display font-bold tabular text-danger">{short(data.supplier_debt)}</span>
                <ArrowRight size={13} className="text-muted-ink shrink-0" aria-hidden="true" />
              </Link>

              <Link
                to="/stock"
                className="flex items-center gap-2.5 p-2 -m-2 rounded hover:bg-muted transition-colors duration-150"
              >
                <Package size={17} className="text-info shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold">Giá trị hàng tồn kho</div>
                  <div className="text-2xs text-muted-ink">Tính theo giá vốn</div>
                </div>
                <span className="font-display font-bold tabular">{short(data.stock_value)}</span>
                <ArrowRight size={13} className="text-muted-ink shrink-0" aria-hidden="true" />
              </Link>

              <div className="pt-2.5 border-t border-line flex items-center justify-between">
                <span className="text-[13px] font-semibold">Vốn lưu động ước tính</span>
                <span className="font-display font-bold tabular text-accent">
                  {short(data.cash_total + data.stock_value + data.customer_debt - data.supplier_debt)}
                </span>
              </div>

              <div className="flex gap-3 text-2xs text-muted-ink pt-1">
                <span>{n(data.counts.products)} mặt hàng</span>
                <span>{n(data.counts.customers)} khách</span>
                <span>{n(data.counts.suppliers)} NCC</span>
              </div>
            </div>
          </div>

          {/* Hoá đơn gần đây */}
          <div className="card flex flex-col">
            <div className="px-3 py-2.5 border-b border-line flex items-center justify-between">
              <h2 className="text-[13px] font-bold flex items-center gap-1.5">
                <Clock size={14} className="text-muted-ink" aria-hidden="true" />
                Hoá đơn gần đây
              </h2>
              <Link to="/sales" className="text-2xs text-accent font-semibold hover:underline">
                Tất cả
              </Link>
            </div>
            <div className="flex-1 overflow-y-auto max-h-[260px]">
              {data.recent_sales.length === 0
                ? <Empty icon={Receipt} title="Chưa có hoá đơn nào" />
                : (
                  <ul className="divide-y divide-line">
                    {data.recent_sales.map((s) => (
                      <li key={s.id}>
                        <Link
                          to={`/sales?q=${s.code}`}
                          className="px-3 py-2 flex items-center gap-2 hover:bg-muted/50 transition-colors duration-100"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-semibold font-mono">{s.code}</div>
                            <div className="text-2xs text-muted-ink truncate">
                              {s.customer_name} · {smartTime(s.ts)}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[13px] font-bold tabular font-mono">{money(s.total)}</div>
                            <div className="text-2xs">
                              {s.total > s.paid
                                ? <span className="text-danger font-semibold">Còn nợ {short(s.total - s.paid)}</span>
                                : <span className="text-muted-ink">{PAYMENT_LABEL[s.payment_method]}</span>}
                            </div>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          </div>
        </div>

        {/* --------------------------- Chi phí ---------------------------- */}
        {data.expenses.length > 0 && (
          <ChartCard
            title={`Chi phí vận hành — ${r.label}`}
            subtitle="Không tính tiền mua hàng và trả nợ nhà cung cấp"
            height={220}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.expenses.map((e) => ({
                  name: ({
                    salary: 'Lương', rent: 'Mặt bằng', utility: 'Điện nước',
                    transport: 'Vận chuyển', tax: 'Thuế', capital_out: 'Rút vốn',
                    other_out: 'Chi khác',
                  })[e.category] || e.category,
                  'Số tiền': e.amount,
                }))}
                layout="vertical"
                margin={{ top: 4, right: 60, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                <XAxis type="number" tickFormatter={short} tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#0F172A' }} width={82} axisLine={false} tickLine={false} />
                <Tooltip content={<TipBox />} cursor={{ fill: '#F1F5F9' }} />
                <Bar dataKey="Số tiền" fill="#B45309" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}
      </Page>
    </>
  );
}
