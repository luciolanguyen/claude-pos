import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { BarChart3, Download, TrendingUp, Package, Truck, Receipt } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch, useApp } from '../lib/store';
import { money, n, short, qty as fq, pct, date, range, RANGES } from '../lib/format';
import {
  Button, Select, Spinner, Empty, ErrorBox, Stat, Tabs, SearchInput,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';

const TABS = [
  { key: 'sales', label: 'Bán hàng' },
  { key: 'products', label: 'Lãi lỗ theo mặt hàng' },
  { key: 'pnl', label: 'Kết quả kinh doanh' },
  { key: 'inventory', label: 'Xuất nhập tồn' },
  { key: 'purchases', label: 'Mua hàng' },
];

function downloadCsv(name, head, rows) {
  const csv = '﻿' + [head, ...rows]
    .map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const [tab, setTab] = useState('sales');
  const [rangeKey, setRangeKey] = useState('month');
  const r = useMemo(() => range(rangeKey), [rangeKey]);

  return (
    <>
      <PageHeader
        title="Báo cáo"
        subtitle={`${r.label} · ${date(r.from)} — ${date(r.to)}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Select value={rangeKey} onChange={(e) => setRangeKey(e.target.value)} size="sm" className="!w-auto">
            {RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </div>
      </PageHeader>

      <div className="bg-card border-b border-line px-4">
        <Tabs tabs={TABS} value={tab} onChange={setTab} className="!border-b-0" />
      </div>

      <Page>
        {tab === 'sales' && <SalesReport r={r} />}
        {tab === 'products' && <ProductsReport r={r} />}
        {tab === 'pnl' && <PnlReport r={r} />}
        {tab === 'inventory' && <InventoryReport r={r} />}
        {tab === 'purchases' && <PurchasesReport r={r} />}
      </Page>
    </>
  );
}

/* ==================================================================== */

function SalesReport({ r }) {
  const [groupBy, setGroupBy] = useState('day');
  const { data, busy, error, reload } = useFetch(
    () => api.reportSales({ from: r.from, to: r.to, group_by: groupBy }),
    [r.from, r.to, groupBy]
  );

  if (busy && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const chart = [...data.rows]
    .sort((a, b) => String(a.label).localeCompare(String(b.label)))
    .slice(-31)
    .map((x) => ({
      name: groupBy === 'day' ? date(x.label).slice(0, 5) : String(x.label),
      'Doanh thu': x.revenue,
      'Lợi nhuận': x.profit,
    }));

  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-5">
        <Stat label="Số hoá đơn" value={n(data.totals.orders)} icon={Receipt} />
        <Stat label="Doanh thu" value={short(data.totals.revenue)} tone="good" />
        <Stat label="Giá vốn" value={short(data.totals.cogs)} />
        <Stat label="Lợi nhuận gộp" value={short(data.totals.profit)} tone="good" />
        <Stat
          label="Tỷ suất lợi nhuận"
          value={data.totals.revenue > 0 ? pct(data.totals.profit / data.totals.revenue * 100) : '—'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-muted-ink">Xem theo:</span>
        {[['day', 'Ngày'], ['month', 'Tháng'], ['user', 'Nhân viên'], ['customer', 'Khách hàng'], ['payment', 'Hình thức TT']].map(([k, l]) => (
          <button key={k} onClick={() => setGroupBy(k)}
            className={`btn btn-sm ${groupBy === k ? 'btn-secondary' : 'btn-outline'}`}>
            {l}
          </button>
        ))}
        <div className="flex-1" />
        <Button size="sm" icon={Download} disabled={!data.rows.length}
          onClick={() => downloadCsv(
            `baocao-banhang-${r.from}-${r.to}.csv`,
            [data.group_label, 'Số đơn', 'Tiền hàng', 'Giảm giá', 'Thuế', 'Doanh thu', 'Giá vốn', 'Lợi nhuận', 'Còn nợ'],
            data.rows.map((x) => [x.label, x.orders, x.subtotal, x.discount, x.vat, x.revenue, x.cogs, x.profit, x.unpaid])
          )}>
          Xuất Excel
        </Button>
      </div>

      {chart.length > 1 && (
        <div className="card p-2" style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#475569' }} tickLine={false}
                axisLine={{ stroke: '#E2E8F0' }} interval="preserveStartEnd" />
              <YAxis tickFormatter={short} tick={{ fontSize: 10, fill: '#475569' }} tickLine={false} axisLine={false} width={48} />
              <Tooltip formatter={(v) => money(v)} contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #E2E8F0' }} />
              <Bar dataKey="Doanh thu" fill="#047857" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Lợi nhuận" fill="#1D4ED8" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {!data.rows.length ? (
        <Empty icon={BarChart3} title="Chưa có dữ liệu bán hàng" message="Không có hoá đơn nào trong khoảng thời gian này." />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{data.group_label}</th>
                <th className="text-right">Số đơn</th>
                <th className="text-right">Tiền hàng</th>
                <th className="text-right">Giảm giá</th>
                <th className="text-right">Thuế GTGT</th>
                <th className="text-right">Doanh thu</th>
                <th className="text-right">Giá vốn</th>
                <th className="text-right">Lợi nhuận</th>
                <th className="text-right">Tỷ suất</th>
                <th className="text-right">Còn nợ</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((x, i) => (
                <tr key={i} className="hoverable">
                  <td className="font-semibold">{data.group_by === 'day' ? date(x.label) : x.label}</td>
                  <td className="num">{x.orders}</td>
                  <td className="num">{money(x.subtotal)}</td>
                  <td className="num text-muted-ink">{x.discount > 0 ? money(x.discount) : '—'}</td>
                  <td className="num text-muted-ink">{x.vat > 0 ? money(x.vat) : '—'}</td>
                  <td className="num font-semibold">{money(x.revenue)}</td>
                  <td className="num text-muted-ink">{money(x.cogs)}</td>
                  <td className="num font-semibold text-emerald-700">{money(x.profit)}</td>
                  <td className="num">{x.revenue > 0 ? pct(x.profit / x.revenue * 100) : '—'}</td>
                  <td className={`num ${x.unpaid > 0 ? 'text-danger' : 'text-muted-ink'}`}>
                    {x.unpaid > 0 ? money(x.unpaid) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>TỔNG CỘNG</td>
                <td className="num">{n(data.totals.orders)}</td>
                <td className="num">{money(data.totals.revenue - data.totals.vat + data.totals.discount)}</td>
                <td className="num">{money(data.totals.discount)}</td>
                <td className="num">{money(data.totals.vat)}</td>
                <td className="num">{money(data.totals.revenue)}</td>
                <td className="num">{money(data.totals.cogs)}</td>
                <td className="num text-emerald-700">{money(data.totals.profit)}</td>
                <td className="num">{data.totals.revenue > 0 ? pct(data.totals.profit / data.totals.revenue * 100) : '—'}</td>
                <td className="num text-danger">{money(data.totals.unpaid)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/* ==================================================================== */

function ProductsReport({ r }) {
  const [q, setQ] = useState('');
  const { data, busy, error, reload } = useFetch(
    () => api.reportProducts({ from: r.from, to: r.to }), [r.from, r.to]
  );

  const rows = useMemo(() => {
    if (!data?.rows) return [];
    return q.trim()
      ? data.rows.filter((x) => x.name.toLowerCase().includes(q.toLowerCase()) || (x.sku || '').toLowerCase().includes(q.toLowerCase()))
      : data.rows;
  }, [data, q]);

  const totals = useMemo(() => ({
    revenue: rows.reduce((a, x) => a + x.revenue, 0),
    cogs: rows.reduce((a, x) => a + x.cogs, 0),
    profit: rows.reduce((a, x) => a + x.profit, 0),
  }), [rows]);

  if (busy && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        <Stat label="Số mặt hàng bán ra" value={n(rows.length)} icon={Package} />
        <Stat label="Doanh thu" value={short(totals.revenue)} tone="good" />
        <Stat label="Giá vốn" value={short(totals.cogs)} />
        <Stat label="Lợi nhuận gộp" value={short(totals.profit)} tone="good" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Tìm mặt hàng..." className="w-full sm:w-72" />
        <div className="flex-1" />
        <Button size="sm" icon={Download} disabled={!rows.length}
          onClick={() => downloadCsv(
            `baocao-mathang-${r.from}-${r.to}.csv`,
            ['Mã hàng', 'Tên hàng', 'Nhóm', 'ĐVT', 'SL bán', 'Số đơn', 'Doanh thu', 'Giá vốn', 'Lợi nhuận', 'Tỷ suất %'],
            rows.map((x) => [x.sku, x.name, x.category_name, x.base_unit, x.qty_base, x.orders, x.revenue, x.cogs, x.profit, x.margin.toFixed(1)])
          )}>
          Xuất Excel
        </Button>
      </div>

      {!rows.length ? (
        <Empty icon={Package} title="Chưa có mặt hàng nào bán ra" message="Không có giao dịch bán trong khoảng thời gian này." />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Mã hàng</th><th>Tên hàng</th><th>Nhóm</th>
                <th className="text-right">SL bán</th>
                <th className="text-right">Số đơn</th>
                <th className="text-right">Doanh thu</th>
                <th className="text-right">Giá vốn</th>
                <th className="text-right">Lợi nhuận</th>
                <th className="text-right">Tỷ suất</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.product_id} className="hoverable">
                  <td className="font-mono text-muted-ink">{x.sku}</td>
                  <td className="font-semibold">{x.name}</td>
                  <td className="text-muted-ink">{x.category_name}</td>
                  <td className="num">{fq(x.qty_base)} {x.base_unit}</td>
                  <td className="num">{x.orders}</td>
                  <td className="num font-semibold">{money(x.revenue)}</td>
                  <td className="num text-muted-ink">{money(x.cogs)}</td>
                  <td className={`num font-semibold ${x.profit < 0 ? 'text-danger' : 'text-emerald-700'}`}>
                    {money(x.profit)}
                  </td>
                  <td className={`num ${x.margin < 0 ? 'text-danger' : ''}`}>{pct(x.margin)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>TỔNG CỘNG</td>
                <td className="num">{money(totals.revenue)}</td>
                <td className="num">{money(totals.cogs)}</td>
                <td className="num text-emerald-700">{money(totals.profit)}</td>
                <td className="num">{totals.revenue > 0 ? pct(totals.profit / totals.revenue * 100) : '—'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/* ==================================================================== */

function PnlReport({ r }) {
  const { data, busy, error, reload } = useFetch(
    () => api.reportPnl({ from: r.from, to: r.to }), [r.from, r.to]
  );

  if (busy && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const EXP_LABEL = {
    salary: 'Lương nhân viên', rent: 'Thuê mặt bằng', utility: 'Điện nước internet',
    transport: 'Vận chuyển, xăng xe', tax: 'Thuế, lệ phí', other_out: 'Chi khác',
  };

  const Row = ({ label, value, bold, indent, tone, hint }) => (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${indent ? 'pl-5' : ''} ${bold ? 'border-t border-line pt-2' : ''}`}>
      <span className={bold ? 'font-bold' : 'text-muted-ink text-[13px]'}>
        {label}
        {hint && <span className="text-2xs block text-muted-ink font-normal">{hint}</span>}
      </span>
      <span className={`tabular font-mono ${bold ? 'text-base font-bold' : 'text-[13px]'} ${
        tone === 'bad' ? 'text-danger' : tone === 'good' ? 'text-emerald-700' : ''}`}>
        {money(value)}
      </span>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        <Stat label="Doanh thu thuần" value={short(data.net_revenue)} tone="good" icon={TrendingUp} />
        <Stat label="Lợi nhuận gộp" value={short(data.gross_profit)} sub={`Tỷ suất ${pct(data.margin)}`} />
        <Stat label="Chi phí vận hành" value={short(data.expense_total)} tone="warn" />
        <Stat
          label="Lợi nhuận thực"
          value={short(data.net_profit)}
          tone={data.net_profit >= 0 ? 'good' : 'bad'}
          sub={data.net_revenue > 0 ? `${pct(data.net_profit / data.net_revenue * 100)} doanh thu` : ''}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="font-bold text-sm mb-2">Kết quả kinh doanh</h2>
          <Row label="Tổng tiền hàng bán ra" value={data.gross_sales} />
          <Row label="Trừ: giảm giá cho khách" value={-data.discount} indent />
          <Row label="Trừ: thuế GTGT đầu ra" value={-data.vat} indent />
          <Row label="Trừ: hàng khách trả lại" value={-data.returns} indent />
          <Row label="Doanh thu thuần" value={data.net_revenue} bold />
          <Row label="Trừ: giá vốn hàng bán" value={-data.cogs} indent />
          <Row label="Lợi nhuận gộp" value={data.gross_profit} bold tone="good"
            hint={`Tỷ suất lợi nhuận gộp ${pct(data.margin)}`} />
          <Row label="Trừ: chi phí vận hành" value={-data.expense_total} indent />
          <Row label="LỢI NHUẬN THỰC" value={data.net_profit} bold
            tone={data.net_profit >= 0 ? 'good' : 'bad'} />

          <p className="text-2xs text-muted-ink mt-3 leading-relaxed">
            Số liệu tính theo hoá đơn đã hoàn tất trong kỳ. Tiền chủ rút vốn và tiền
            trả nợ nhà cung cấp không tính là chi phí.
          </p>
        </div>

        <div className="card p-4">
          <h2 className="font-bold text-sm mb-2">Chi phí vận hành theo khoản mục</h2>
          {!data.expenses.length ? (
            <Empty title="Chưa ghi nhận chi phí nào" message="Lập phiếu chi ở màn hình Quỹ tiền để theo dõi chi phí." />
          ) : (
            <>
              {data.expenses.map((e) => (
                <div key={e.category} className="flex items-center gap-2 py-1.5">
                  <span className="text-[13px] flex-1">{EXP_LABEL[e.category] || e.category}</span>
                  <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden" aria-hidden="true">
                    <div className="h-full bg-warn rounded-full"
                      style={{ width: `${data.expense_total > 0 ? (e.amount / data.expense_total * 100) : 0}%` }} />
                  </div>
                  <span className="text-2xs text-muted-ink w-10 text-right tabular">
                    {data.expense_total > 0 ? Math.round(e.amount / data.expense_total * 100) : 0}%
                  </span>
                  <span className="tabular font-mono text-[13px] font-semibold w-24 text-right">{money(e.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-line mt-2 pt-2 font-bold">
                <span>Tổng chi phí</span>
                <span className="tabular font-mono">{money(data.expense_total)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <Button icon={Download}
        onClick={() => downloadCsv(
          `ketqua-kinhdoanh-${r.from}-${r.to}.csv`,
          ['Chỉ tiêu', 'Số tiền'],
          [
            ['Tổng tiền hàng bán ra', data.gross_sales],
            ['Giảm giá', -data.discount],
            ['Thuế GTGT', -data.vat],
            ['Hàng trả lại', -data.returns],
            ['Doanh thu thuần', data.net_revenue],
            ['Giá vốn hàng bán', -data.cogs],
            ['Lợi nhuận gộp', data.gross_profit],
            ...data.expenses.map((e) => [EXP_LABEL[e.category] || e.category, -e.amount]),
            ['Tổng chi phí vận hành', -data.expense_total],
            ['LỢI NHUẬN THỰC', data.net_profit],
          ]
        )}>
        Xuất Excel
      </Button>
    </div>
  );
}

/* ==================================================================== */

function InventoryReport({ r }) {
  const [q, setQ] = useState('');
  const { data, busy, error, reload } = useFetch(
    () => api.reportInventory({ from: r.from, to: r.to }), [r.from, r.to]
  );

  const rows = useMemo(() => {
    if (!data?.rows) return [];
    return q.trim()
      ? data.rows.filter((x) => x.name.toLowerCase().includes(q.toLowerCase()) || x.sku.toLowerCase().includes(q.toLowerCase()))
      : data.rows;
  }, [data, q]);

  if (busy && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-3">
        <Stat label="Số mặt hàng" value={n(rows.length)} icon={Package} />
        <Stat label="Tổng giá trị tồn cuối kỳ" value={short(data?.total_value || 0)} />
        <Stat label="Kỳ báo cáo" value={`${date(r.from)} — ${date(r.to)}`} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Tìm mặt hàng..." className="w-full sm:w-72" />
        <div className="flex-1" />
        <Button size="sm" icon={Download} disabled={!rows.length}
          onClick={() => downloadCsv(
            `xuat-nhap-ton-${r.from}-${r.to}.csv`,
            ['Mã hàng', 'Tên hàng', 'ĐVT', 'Tồn đầu kỳ', 'Nhập trong kỳ', 'Xuất trong kỳ', 'Tồn cuối kỳ', 'Giá vốn', 'Giá trị tồn'],
            rows.map((x) => [x.sku, x.name, x.base_unit, x.opening, x.qty_in, x.qty_out, x.closing, x.cost_price, x.value])
          )}>
          Xuất Excel
        </Button>
      </div>

      {!rows.length ? (
        <Empty icon={Package} title="Chưa có dữ liệu tồn kho" />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Mã hàng</th><th>Tên hàng</th><th>ĐVT</th>
                <th className="text-right">Tồn đầu kỳ</th>
                <th className="text-right">Nhập trong kỳ</th>
                <th className="text-right">Xuất trong kỳ</th>
                <th className="text-right">Tồn cuối kỳ</th>
                <th className="text-right">Giá vốn</th>
                <th className="text-right">Giá trị tồn</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id} className="hoverable">
                  <td className="font-mono text-muted-ink">{x.sku}</td>
                  <td className="font-semibold">{x.name}</td>
                  <td>{x.base_unit}</td>
                  <td className="num text-muted-ink">{fq(x.opening)}</td>
                  <td className="num text-emerald-700">{x.qty_in > 0 ? `+${fq(x.qty_in)}` : '—'}</td>
                  <td className="num text-danger">{x.qty_out > 0 ? `-${fq(x.qty_out)}` : '—'}</td>
                  <td className={`num font-semibold ${x.closing <= 0 ? 'text-danger' : ''}`}>{fq(x.closing)}</td>
                  <td className="num">{money(x.cost_price)}</td>
                  <td className="num font-semibold">{money(x.value)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={8} className="text-right">TỔNG GIÁ TRỊ TỒN CUỐI KỲ</td>
                <td className="num">{money(data.total_value)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/* ==================================================================== */

function PurchasesReport({ r }) {
  const { data, busy, error, reload } = useFetch(
    () => api.reportPurchases({ from: r.from, to: r.to }), [r.from, r.to]
  );

  if (busy && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        <Stat label="Số phiếu nhập" value={n(data.totals.bills)} icon={Truck} />
        <Stat label="Tổng tiền nhập" value={short(data.totals.total)} />
        <Stat label="Đã thanh toán" value={short(data.totals.paid)} tone="good" />
        <Stat label="Còn nợ NCC" value={short(data.totals.unpaid)} tone={data.totals.unpaid > 0 ? 'bad' : 'default'} />
      </div>

      <div className="flex justify-end">
        <Button size="sm" icon={Download} disabled={!data.rows.length}
          onClick={() => downloadCsv(
            `baocao-muahang-${r.from}-${r.to}.csv`,
            ['Nhà cung cấp', 'Số phiếu', 'Tổng tiền', 'Đã trả', 'Còn nợ'],
            data.rows.map((x) => [x.label, x.bills, x.total, x.paid, x.unpaid])
          )}>
          Xuất Excel
        </Button>
      </div>

      {!data.rows.length ? (
        <Empty icon={Truck} title="Chưa nhập hàng trong kỳ" message="Không có phiếu nhập nào trong khoảng thời gian này." />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Nhà cung cấp</th>
                <th className="text-right">Số phiếu</th>
                <th className="text-right">Tổng tiền nhập</th>
                <th className="text-right">Đã thanh toán</th>
                <th className="text-right">Còn nợ</th>
                <th className="text-right">Tỷ trọng</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((x, i) => (
                <tr key={i} className="hoverable">
                  <td className="font-semibold">{x.label}</td>
                  <td className="num">{x.bills}</td>
                  <td className="num font-semibold">{money(x.total)}</td>
                  <td className="num">{money(x.paid)}</td>
                  <td className={`num ${x.unpaid > 0 ? 'text-danger font-semibold' : 'text-muted-ink'}`}>
                    {x.unpaid > 0 ? money(x.unpaid) : '—'}
                  </td>
                  <td className="num">{data.totals.total > 0 ? pct(x.total / data.totals.total * 100) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>TỔNG CỘNG</td>
                <td className="num">{n(data.totals.bills)}</td>
                <td className="num">{money(data.totals.total)}</td>
                <td className="num">{money(data.totals.paid)}</td>
                <td className="num text-danger">{money(data.totals.unpaid)}</td>
                <td className="num">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
