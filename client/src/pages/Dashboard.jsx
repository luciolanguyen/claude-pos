/* ====================================================================
   TỔNG QUAN CỬA HÀNG (đợt A plan pos-dashboard-plan.md, 11/10/2026)

   Hai loại số, tách bạch:
     - số PHÁT SINH TRONG KỲ đang chọn: doanh thu, lãi, biểu đồ, nhóm hàng,
       hàng bán chạy, giờ bán, chi phí — MỌI khối đều theo đúng một kỳ;
     - số dư TẠI THỜI ĐIỂM HIỆN TẠI: quỹ, công nợ, tồn kho — không theo kỳ,
       ghi rõ "tại lúc …".
   Doanh thu, lãi tính bằng đúng hàm của Báo cáo Lãi lỗ (server/metrics.js),
   nên hai trang không bao giờ ra hai con số khác nhau nữa.
   ==================================================================== */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ComposedChart, Bar, Line, BarChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  ReferenceLine,
} from 'recharts';
import {
  Wallet, Package, AlertTriangle, ShoppingCart, Receipt, HandCoins, Truck, Clock, Boxes, Info,
  ArrowRight, PackageX, CircleCheck, RefreshCw,
} from 'lucide-react';
import { api } from '../lib/api';
import { useFetch, useApp } from '../lib/store';
import { useLiveReload } from '../lib/useLive';
import { money, n, short, qty as fq, smartTime, date, pct, PAYMENT_LABEL, CASH_LABEL } from '../lib/format';
import { Stat, ErrorBox, Empty, Badge } from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import PeriodPicker, { usePeriod } from '../components/PeriodPicker';

function Card({ title, subtitle, action, children, className = '' }) {
  return (
    /* min-w-0: ô lưới mặc định không co nhỏ hơn nội dung — thiếu cái này là trên
       điện thoại cả trang cuộn ngang vì một dòng chữ dài */
    <div className={`card flex flex-col min-w-0 ${className}`}>
      <div className="flex items-start justify-between gap-2 px-3 py-2.5 border-b border-line">
        <div className="min-w-0">
          <h2 className="text-[13px] font-bold">{title}</h2>
          {subtitle && <p className="text-2xs text-muted-ink mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/** Khung tooltip: luôn có nhãn + giá trị bằng chữ, mốc chưa tới thì nói rõ. */
function TipBox({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  return (
    <div className="bg-card border border-line rounded shadow-pop px-2.5 py-1.5 text-[13px]">
      <div className="font-semibold mb-0.5">{row.full || label}</div>
      {row.future ? <div className="text-muted-ink">Chưa đến</div> : (
        <>
          {payload.map((p, i) => (
            <div key={i} className="flex items-center gap-1.5 tabular">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: p.color || p.fill }} aria-hidden="true" />
              <span className="text-muted-ink">{p.name}:</span>
              <span className="font-semibold font-mono">{money(p.value)}</span>
            </div>
          ))}
          {row.orders != null && <div className="text-2xs text-muted-ink">{n(row.orders)} hoá đơn</div>}
        </>
      )}
    </div>
  );
}

/* ==================================================================== *
 * CẦN XỬ LÝ (đợt B) — việc tồn đọng, mỗi việc dẫn tới đúng danh sách đã lọc.
 * Lấy dữ liệu riêng: khối này lỗi thì chỉ khối này báo lỗi.
 * ==================================================================== */
const LEVEL = {
  high: { text: 'Gấp', dot: 'bg-danger', chip: 'text-danger' },
  medium: { text: 'Nên làm', dot: 'bg-warn', chip: 'text-warn' },
  low: { text: 'Nhắc', dot: 'bg-info', chip: 'text-info' },
};

function ActionsBlock() {
  const { data, busy, error, reload } = useFetch(() => api.dashboardActions(), []);
  useLiveReload(reload, { interval: 60000 });
  const items = data?.items || [];

  return (
    <section aria-label="Việc cần xử lý" className="card min-w-0">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-line">
        <h2 className="text-[13px] font-bold flex items-center gap-1.5">
          <AlertTriangle size={14} className="text-warn" aria-hidden="true" />
          Cần xử lý{items.length > 0 && <span className="text-muted-ink font-normal">({items.length} việc)</span>}
        </h2>
        <button type="button" onClick={reload} className="btn btn-sm btn-ghost !px-1.5" aria-label="Tải lại việc cần xử lý"
          title="Tải lại">
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
      </div>
      {error && !data ? (
        <div className="p-3 text-[13px] flex items-center gap-2">
          <span className="text-danger flex-1">Chưa tải được danh sách việc: {error.message}</span>
          <button type="button" className="btn btn-sm btn-outline" onClick={reload}>Thử lại</button>
        </div>
      ) : !data ? (
        /* Khung chờ giữ chỗ — trang không nhảy khi danh sách tải xong */
        <div className="p-3 space-y-2" aria-busy="true">
          {[0, 1].map((i) => <div key={i} className="h-9 rounded bg-muted animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="p-3 text-[13px] text-muted-ink flex items-center gap-2">
          <CircleCheck size={16} className="text-accent" aria-hidden="true" />
          Không có việc tồn đọng — nợ, đơn đặt, bảo hành, hàng cần nhập đều ổn.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((it) => {
            const lv = LEVEL[it.level] || LEVEL.medium;
            return (
              <li key={it.key} className="px-3 py-2 flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
                <span className={`w-2 h-2 rounded-full shrink-0 ${lv.dot}`} aria-hidden="true" />
                <span className={`text-2xs font-bold uppercase w-14 shrink-0 ${lv.chip}`}>{lv.text}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold">{it.label}</div>
                  {it.detail && <div className="text-2xs text-muted-ink truncate">{it.detail}</div>}
                </div>
                <Link to={it.to} className="btn btn-sm btn-outline shrink-0">
                  {it.action} <ArrowRight size={13} aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Khung chờ lần tải đầu: đúng bố cục trang để không nhảy khi số liệu về. */
function Skeleton() {
  const box = (h) => <div className="card animate-pulse bg-muted/60" style={{ height: h }} />;
  return (
    <Page className="space-y-3" aria-busy="true">
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i}>{box(92)}</div>)}</div>
      {box(120)}
      <div className="grid gap-3 lg:grid-cols-3"><div className="lg:col-span-2">{box(300)}</div>{box(300)}</div>
    </Page>
  );
}

/** Tăng giảm so với kỳ trước. Kỳ trước bằng 0 thì không chia — nói "mới phát sinh". */
function change(cur, prev) {
  if (cur == null || prev == null) return { trend: null, note: '' };
  if (prev === 0) return { trend: null, note: cur > 0 ? 'mới phát sinh' : '' };
  return { trend: ((cur - prev) / Math.abs(prev)) * 100, note: '' };
}

const pad = (x) => String(x).padStart(2, '0');
/** Nhãn trục cho từng cỡ mốc của biểu đồ. */
function axisLabel(bucket, key) {
  if (bucket === 'hour') return { short: `${Number(key)}h`, full: `${Number(key)}:00 – ${Number(key)}:59` };
  if (bucket === 'day') return { short: date(key).slice(0, 5), full: date(key) };
  if (bucket === 'week') return { short: date(key).slice(0, 5), full: `Tuần từ ${date(key)}` };
  const [y, m] = key.split('-');
  return { short: `${m}/${y.slice(2)}`, full: `Tháng ${Number(m)}/${y}` };
}

export default function Dashboard() {
  const { store } = useApp();
  const period = usePeriod('dashboard', 'month');
  const { data, busy, error, reload } = useFetch(
    () => api.dashboard({ from: period.from, to: period.to }), [period.from, period.to]);
  /* Tự làm mới 2 phút một lần và ngay khi có hoá đơn mới; không mất kỳ đang chọn */
  useLiveReload(reload, { interval: 120000 });
  const { data: cats } = useFetch(() => api.cashCategories(), []);
  const [topBy, setTopBy] = useState('revenue');
  const navigate = useNavigate();

  const catLabel = useMemo(() => {
    const m = new Map();
    for (const dir of ['in', 'out']) for (const c of cats?.[dir] || []) m.set(c.code, c.label);
    return (code) => m.get(code) || CASH_LABEL[code] || code;
  }, [cats]);

  const reportLink = (tab) => `/reports?tab=${tab}&from=${period.from}&to=${period.to}`;

  const header = (
    <PageHeader
      title="Tổng quan cửa hàng"
      subtitle={`${store.name || ''}${data?.as_of ? ` · cập nhật lúc ${data.as_of.slice(11, 16)}` : ''}`}
      actions={
        <Link to="/pos" className="btn btn-primary btn-touch">
          <ShoppingCart size={16} aria-hidden="true" />
          Mở màn hình bán hàng
        </Link>
      }
    >
      <PeriodPicker
        period={period}
        compare={data?.compare_period && {
          ...data.compare_period, sameTime: data.period?.live && !data.period.to_ts.endsWith('23:59:59'),
        }}
      />
    </PageHeader>
  );

  if (busy && !data) return <>{header}<Skeleton /></>;
  if (error && !data) return <>{header}<Page><ErrorBox error={error} onRetry={reload} /></Page></>;
  if (!data) return null;

  const s = data.summary;
  const c = data.compare;
  const seeCost = s.profit !== undefined;
  const rev = change(s.revenue, c.revenue);
  const prof = seeCost ? change(s.profit, c.profit) : null;
  const ord = change(s.orders, c.orders);
  const avg = change(s.avg_order, c.avg_order);

  const chart = data.series.rows.map((x) => {
    const l = axisLabel(data.series.bucket, x.key);
    return {
      key: x.key, label: l.short, full: l.full, future: x.revenue == null, orders: x.orders,
      'Doanh thu thuần': x.revenue, ...(seeCost ? { 'Lãi gộp': x.profit } : {}),
    };
  });
  const hasSales = data.series.rows.some((x) => x.revenue);
  const hours = data.hours.map((h) => ({ label: `${h.hour}h`, full: `${h.hour}:00 – ${h.hour}:59`, orders: h.orders, 'Doanh thu': h.revenue }));
  const topList = data.top[topBy] || [];
  const expenseTotal = data.expenses.reduce((a, e) => a + e.amount, 0);
  const asOf = data.as_of.slice(11, 16);

  return (
    <>
      {header}
      {/* Đang tải kỳ mới: làm mờ số cũ và nói rõ, không để số của kỳ cũ mang nhãn kỳ mới */}
      {(data.period.from !== period.from || data.period.to !== period.to) && (
        <p className="mx-4 mt-3 text-[13px] text-muted-ink flex items-center gap-2" role="status">
          <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
          Đang tải số liệu {period.label.toLowerCase()}… số bên dưới vẫn là của kỳ trước.
        </p>
      )}
      <Page className={`space-y-3 transition-opacity duration-150 ${
        data.period.from !== period.from || data.period.to !== period.to ? 'opacity-50' : ''}`}>
        {/* ------------------------- 4 số chính của kỳ ------------------------- */}
        <section aria-label="Số liệu chính của kỳ" className="grid gap-2 grid-cols-2 lg:grid-cols-4">
          <Stat onClick={() => navigate(reportLink('pnl'))} label="Doanh thu thuần" value={short(s.revenue)} tone="good" icon={Receipt}
              trend={rev.trend}
              sub={[rev.note, s.returns > 0 && `trả hàng −${short(s.returns)}`].filter(Boolean).join(' · ') || 'không gồm thuế GTGT'} />
          {seeCost && (
            <Stat onClick={() => navigate(reportLink('pnl'))} label={s.missing_cost > 0 ? 'Lãi gộp (tạm tính)' : 'Lãi gộp'} value={short(s.profit)}
                tone={s.profit < 0 ? 'bad' : 'default'} trend={prof.trend}
                sub={[prof.note, s.margin != null ? `biên ${pct(s.margin)}` : 'không áp dụng'].filter(Boolean).join(' · ')} />
          )}
          <Stat onClick={() => navigate(reportLink('sales'))} label="Số hoá đơn bán" value={n(s.orders)} trend={ord.trend}
              sub={[ord.note, s.returns_count > 0 && `${n(s.returns_count)} phiếu trả hàng`].filter(Boolean).join(' · ')} />
          <Stat label="Trung bình mỗi hoá đơn" value={short(s.avg_order)} trend={avg.trend} sub={avg.note} />
        </section>

        <ActionsBlock />

        {/* Lãi tạm tính: không để con số trông như chắc chắn */}
        {seeCost && s.missing_cost > 0 && (
          <p className="text-[13px] rounded border border-warn/40 bg-amber-50 p-2.5 flex gap-2">
            <AlertTriangle size={16} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Lãi gộp đang là <b>tạm tính</b>: {n(s.missing_cost)} mặt hàng bán trong kỳ chưa có giá vốn nên
              lãi của chúng bị tính cao hơn thật. Khai giá vốn ở trang <Link to="/products" className="text-accent font-semibold hover:underline">Hàng hoá</Link>.
            </span>
          </p>
        )}

        {/* ----------------------- Xu hướng + nhóm hàng ----------------------- */}
        <div className="grid gap-3 lg:grid-cols-3">
          <Card
            className="lg:col-span-2"
            title={seeCost ? 'Doanh thu thuần và lãi gộp' : 'Doanh thu thuần'}
            subtitle={{
              hour: 'Theo giờ trong ngày', day: 'Theo ngày', week: 'Theo tuần (từ thứ Hai)', month: 'Theo tháng',
            }[data.series.bucket]}
          >
            <div className="p-2" style={{ height: 260 }}>
              {!hasSales ? (
                <Empty title="Chưa có giao dịch trong kỳ" message="Đổi kỳ xem hoặc bán thêm hoá đơn." />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#475569' }} tickLine={false}
                      axisLine={{ stroke: '#E2E8F0' }} interval="preserveStartEnd" />
                    <YAxis tickFormatter={short} tick={{ fontSize: 10, fill: '#475569' }} tickLine={false} axisLine={false} width={52} />
                    <ReferenceLine y={0} stroke="#94A3B8" />
                    <Tooltip content={<TipBox />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Doanh thu thuần" fill="#047857" radius={[3, 3, 0, 0]} />
                    {seeCost && <Line dataKey="Lãi gộp" stroke="#1D4ED8" strokeWidth={2.5} dot={false} connectNulls={false} />}
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          <Card
            title="Theo nhóm hàng"
            subtitle="Tiền hàng từng dòng — chưa chia giảm giá cả đơn, chưa trừ trả hàng"
          >
            {data.categories.length === 0 ? <Empty title="Chưa có dữ liệu" /> : (
              <ul className="p-3 space-y-2.5">
                {data.categories.map((g) => {
                  const share = data.category_total > 0 ? (g.revenue / data.category_total) * 100 : 0;
                  return (
                    <li key={g.name}>
                      <div className="flex items-baseline justify-between gap-2 text-[13px]">
                        <span className={`truncate ${g.other ? 'text-muted-ink' : 'font-semibold'}`}>{g.name}</span>
                        <span className="tabular shrink-0"><b>{short(g.revenue)}</b>
                          <span className="text-muted-ink"> · {pct(share)}</span></span>
                      </div>
                      <div className="h-2 rounded bg-muted mt-1 overflow-hidden" aria-hidden="true">
                        <div className={`h-full rounded ${g.other ? 'bg-muted-ink/50' : 'bg-accent'}`} style={{ width: `${share}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        {/* ------------------- Hàng bán chạy · giờ bán · khách ------------------- */}
        <div className="grid gap-3 lg:grid-cols-3">
          <Card
            title="Hàng bán chạy"
            action={
              <div className="flex gap-1" role="group" aria-label="Xếp hạng theo">
                {[['revenue', 'Doanh thu'], ['qty', 'Số lượng'], ...(seeCost ? [['profit', 'Lãi']] : [])].map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={topBy === k} onClick={() => setTopBy(k)}
                    className={`btn btn-sm !px-2 !py-0.5 text-2xs ${topBy === k ? 'btn-secondary' : 'btn-outline'}`}>{l}</button>
                ))}
              </div>
            }
          >
            {topList.length === 0 ? <Empty title="Chưa có dữ liệu" /> : (
              <ul className="divide-y divide-line">
                {topList.map((p, i) => (
                  <li key={p.product_id} className="px-3 py-2 flex items-center gap-2.5">
                    <span className="w-5 h-5 rounded bg-muted text-2xs font-bold flex items-center justify-center shrink-0 tabular">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold truncate">{p.name}</div>
                      <div className="text-2xs text-muted-ink tabular">
                        {p.sku} · bán {fq(p.qty)} {p.base_unit}{seeCost && p.profit !== undefined && <> · lãi {short(p.profit)}</>}
                      </div>
                    </div>
                    <span className="text-[13px] font-bold tabular font-mono shrink-0">
                      {topBy === 'qty' ? `${fq(p.qty)} ${p.base_unit}` : short(topBy === 'profit' ? p.profit : p.revenue)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link to={reportLink('products')} className="px-3 py-2 border-t border-line text-2xs text-accent font-semibold hover:underline mt-auto">
              Xem tất cả mặt hàng
            </Link>
          </Card>

          <Card title="Giờ bán chạy" subtitle="Cộng dồn cả kỳ — biết giờ cao điểm để bố trí người trực quầy">
            <div className="p-2" style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hours} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#475569' }} tickLine={false} interval={2} />
                  <YAxis tickFormatter={short} tick={{ fontSize: 10, fill: '#475569' }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip content={<TipBox />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                  <Bar dataKey="Doanh thu" fill="#047857" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Khách mua nhiều" action={<Link to="/customers" className="text-2xs text-accent font-semibold hover:underline">Danh sách khách</Link>}>
            {data.top_customers.length === 0
              ? <Empty title="Chưa có khách quen" message="Hoá đơn chưa gắn tên khách sẽ không thống kê được." />
              : (
                <ul className="divide-y divide-line">
                  {data.top_customers.map((k) => (
                    <li key={k.id}>
                      <Link to={`/customers/${k.id}`} className="px-3 py-2 flex items-center gap-2.5 hover:bg-muted/50 transition-colors duration-100">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold truncate">{k.name}</div>
                          <div className="text-2xs text-muted-ink tabular">{n(k.orders)} hoá đơn trong kỳ</div>
                        </div>
                        <span className="text-[13px] font-bold tabular font-mono shrink-0">{short(k.revenue)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
          </Card>
        </div>

        {/* ------------- Số dư TẠI THỜI ĐIỂM HIỆN TẠI — không theo kỳ ------------- */}
        <div className="grid gap-3 lg:grid-cols-3">
          <Card title={`Tiền · công nợ · tồn kho — tại lúc ${asOf}`} subtitle="Số dư hiện tại, không đổi theo kỳ đang xem">
            <div className="p-3 space-y-2.5">
              {data.cash_accounts.map((a) => (
                <Link key={a.id} to="/cash" className="flex items-center gap-2.5 p-2 -m-2 rounded hover:bg-muted transition-colors duration-150">
                  <Wallet size={17} className="text-accent shrink-0" aria-hidden="true" />
                  <span className="text-[13px] font-semibold flex-1 truncate">{a.name}</span>
                  <span className={`font-display font-bold tabular ${a.balance < 0 ? 'text-danger' : ''}`}>{short(a.balance)}</span>
                </Link>
              ))}
              <Link to="/customers?filter=debt" className="flex items-center gap-2.5 p-2 -m-2 rounded hover:bg-muted transition-colors duration-150">
                <HandCoins size={17} className="text-warn shrink-0" aria-hidden="true" />
                <span className="text-[13px] font-semibold flex-1">Khách đang nợ mình</span>
                <span className="font-display font-bold tabular text-warn">{short(data.customer_debt)}</span>
                <ArrowRight size={13} className="text-muted-ink shrink-0" aria-hidden="true" />
              </Link>
              <Link to="/suppliers?filter=debt" className="flex items-center gap-2.5 p-2 -m-2 rounded hover:bg-muted transition-colors duration-150">
                <Truck size={17} className="text-danger shrink-0" aria-hidden="true" />
                <span className="text-[13px] font-semibold flex-1">Mình đang nợ NCC</span>
                <span className="font-display font-bold tabular text-danger">{short(data.supplier_debt)}</span>
                <ArrowRight size={13} className="text-muted-ink shrink-0" aria-hidden="true" />
              </Link>
              {data.stock_value !== undefined && (
                <>
                  <Link to="/products" className="flex items-center gap-2.5 p-2 -m-2 rounded hover:bg-muted transition-colors duration-150">
                    <Package size={17} className="text-info shrink-0" aria-hidden="true" />
                    <span className="text-[13px] font-semibold flex-1">Hàng tồn kho (theo giá vốn)</span>
                    <span className="font-display font-bold tabular">{short(data.stock_value)}</span>
                    <ArrowRight size={13} className="text-muted-ink shrink-0" aria-hidden="true" />
                  </Link>
                  <div className="pt-2.5 border-t border-line flex items-center justify-between gap-2"
                    title="Tổng quỹ + giá trị tồn kho + khách nợ − nợ nhà cung cấp. Chưa gồm tài sản khác của tiệm (xe, kệ, máy móc) và các khoản nợ khác.">
                    <span className="text-[13px] font-semibold flex items-center gap-1">
                      Tiền + hàng + phải thu − phải trả
                      <Info size={13} className="text-muted-ink" aria-label="Công thức: tổng quỹ + tồn kho + khách nợ − nợ NCC" />
                    </span>
                    <span className="font-display font-bold tabular text-accent">
                      {short(data.cash_total + data.stock_value + data.customer_debt - data.supplier_debt)}
                    </span>
                  </div>
                </>
              )}
            </div>
          </Card>

          <Card
            title="Cần nhập thêm hàng"
            subtitle="Tồn hiện có / tồn tối thiểu, theo đơn vị cơ bản"
            action={<Link to="/products?filter=low" className="text-2xs text-accent font-semibold hover:underline">Xem kho</Link>}
          >
            {data.low_stock.length === 0
              ? <Empty icon={Boxes} title="Kho đang ổn" message="Không có mặt hàng nào dưới định mức tồn tối thiểu." />
              : (
                <ul className="divide-y divide-line">
                  {data.low_stock.slice(0, 6).map((p) => (
                    <li key={p.id} className="px-3 py-2 flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold truncate">{p.name}</div>
                        <div className="text-2xs text-muted-ink font-mono">{p.sku}</div>
                      </div>
                      <Badge tone={p.qty <= 0 ? 'bad' : 'warn'} title="Tồn hiện có / tồn tối thiểu">
                        còn {fq(p.qty)} / tối thiểu {fq(p.min_stock)} {p.base_unit}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            {data.out_of_stock > 0 && (
              <div className="px-3 py-2 border-t border-line text-2xs text-danger font-semibold flex items-center gap-1.5 mt-auto">
                <PackageX size={13} aria-hidden="true" />
                {n(data.out_of_stock)} mặt hàng có bán trong 90 ngày qua đã hết sạch
              </div>
            )}
          </Card>

          <Card
            title="Hoá đơn mới nhất"
            subtitle="Không theo kỳ — 8 hoá đơn vừa lập"
            action={<Link to="/sales" className="text-2xs text-accent font-semibold hover:underline">Tất cả</Link>}
          >
            {data.recent_sales.length === 0 ? <Empty icon={Clock} title="Chưa có hoá đơn nào" /> : (
              <ul className="divide-y divide-line">
                {data.recent_sales.map((x) => (
                  <li key={x.id}>
                    <Link to={`/sales?q=${x.code}`} className="px-3 py-2 flex items-center gap-2 hover:bg-muted/50 transition-colors duration-100">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold font-mono">{x.code}</div>
                        <div className="text-2xs text-muted-ink truncate">{x.customer_name} · {smartTime(x.ts)}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[13px] font-bold tabular font-mono">{money(x.total)}</div>
                        <div className="text-2xs">
                          {x.status === 'cancelled' ? <span className="text-muted-ink">Đã huỷ</span>
                            : x.total > x.paid
                              ? <span className="text-danger font-semibold">Còn nợ {short(x.total - x.paid)}</span>
                              : <span className="text-muted-ink">{PAYMENT_LABEL[x.payment_method]}</span>}
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* ------------------- Dòng tiền và chi phí trong kỳ ------------------- */}
        <Card
          title="Dòng tiền và chi phí trong kỳ"
          subtitle="Theo sổ quỹ, không kể tiền chuyển giữa các quỹ. Chi phí không gồm tiền mua hàng, trả nợ NCC, tiền xe (đã trừ trong lãi gộp)."
          action={<Link to={reportLink('pnl')} className="text-2xs text-accent font-semibold hover:underline">Kết quả kinh doanh</Link>}
        >
          <div className="p-3 grid gap-3 sm:grid-cols-3">
            <div><div className="text-2xs text-muted-ink">Tiền thu vào</div><div className="font-display font-bold tabular text-emerald-700">{short(data.cash_in)}</div></div>
            <div><div className="text-2xs text-muted-ink">Tiền chi ra</div><div className="font-display font-bold tabular text-danger">{short(data.cash_out)}</div></div>
            <div><div className="text-2xs text-muted-ink">Chi phí vận hành</div><div className="font-display font-bold tabular">{short(expenseTotal)}</div></div>
          </div>
          {data.expenses.length > 0 && (
            <ul className="px-3 pb-3 space-y-1.5">
              {data.expenses.slice(0, 5).map((e) => (
                <li key={e.category} className="text-[13px]">
                  <div className="flex justify-between gap-2"><span>{catLabel(e.category)}</span><span className="tabular font-semibold">{short(e.amount)}</span></div>
                  <div className="h-1.5 rounded bg-muted mt-0.5 overflow-hidden" aria-hidden="true">
                    <div className="h-full bg-warn rounded" style={{ width: `${expenseTotal > 0 ? (e.amount / expenseTotal) * 100 : 0}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Page>
    </>
  );
}
