import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { HandCoins, Landmark, Download, AlertTriangle, Phone, Clock } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch } from '../lib/store';
import { money, n, short, date, smartTime } from '../lib/format';
import {
  Button, Spinner, Empty, ErrorBox, Badge, Stat, SearchInput,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import { DebtPayModal } from './Customers';

/** Số ngày kể từ mốc thời gian, dùng để tô cảnh báo nợ lâu. */
function daysSince(ts) {
  if (!ts) return 0;
  const d = new Date(String(ts).replace(' ', 'T'));
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

/* ==================================================================== */
/* Công nợ khách hàng — tiền phải thu                                    */
/* ==================================================================== */

export function CustomerDebts() {
  const { toast, meta } = useApp();
  const [q, setQ] = useState('');
  const { data, busy, error, reload } = useFetch(() => api.customerDebts(), []);
  const [paying, setPaying] = useState(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const list = q.trim()
      ? data.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || (c.phone || '').includes(q))
      : data;
    return [...list].sort((a, b) => b.debt - a.debt);
  }, [data, q]);

  const totals = useMemo(() => ({
    total: rows.reduce((a, c) => a + c.debt, 0),
    count: rows.length,
    overLimit: rows.filter((c) => c.over_limit).length,
    old: rows.filter((c) => daysSince(c.oldest_unpaid) > 60).length,
  }), [rows]);

  const exportCsv = () => {
    const head = ['Mã KH', 'Tên khách hàng', 'Điện thoại', 'Số HĐ chưa trả', 'Nợ đầu kỳ', 'Đang nợ', 'Hạn mức', 'Nợ từ ngày'];
    const csv = '﻿' + [head, ...rows.map((c) => [
      c.code, c.name, c.phone || '', c.unpaid_bills, c.opening_debt, c.debt, c.debt_limit,
      c.oldest_unpaid ? date(c.oldest_unpaid) : '',
    ])].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'congno-khachhang.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Công nợ khách hàng"
        subtitle="Số tiền khách đang nợ cửa hàng"
        actions={<Button icon={Download} onClick={exportCsv} disabled={!rows.length}>Xuất Excel</Button>}
      >
        <SearchInput value={q} onChange={setQ} placeholder="Tìm khách hàng..." className="w-full sm:w-80" />
      </PageHeader>

      <Page className="space-y-3">
        <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
          <Stat label="Tổng phải thu" value={short(totals.total)} tone="warn" icon={HandCoins} />
          <Stat label="Số khách nợ" value={n(totals.count)} />
          <Stat label="Vượt hạn mức" value={n(totals.overLimit)} tone={totals.overLimit > 0 ? 'bad' : 'default'} />
          <Stat label="Nợ quá 60 ngày" value={n(totals.old)} tone={totals.old > 0 ? 'bad' : 'default'} icon={Clock} />
        </div>

        {busy && !data ? <Spinner />
          : error ? <ErrorBox error={error} onRetry={reload} />
            : !rows.length ? (
              <Empty
                icon={HandCoins}
                title="Không có khách nào đang nợ"
                message="Tất cả hoá đơn đều đã được thanh toán đủ."
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Mã</th><th>Khách hàng</th><th>Điện thoại</th>
                      <th className="text-right">HĐ chưa trả</th>
                      <th className="text-right">Nợ đầu kỳ</th>
                      <th className="text-right">Đang nợ</th>
                      <th className="text-right">Hạn mức</th>
                      <th>Nợ lâu nhất</th>
                      <th className="text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => {
                      const days = daysSince(c.oldest_unpaid);
                      return (
                        <tr key={c.id} className="hoverable">
                          <td className="font-mono text-muted-ink">{c.code}</td>
                          <td>
                            <Link to={`/customers/${c.id}`} className="font-semibold text-accent hover:underline">
                              {c.name}
                            </Link>
                            {c.over_limit && (
                              <Badge tone="bad" className="ml-1.5">
                                <AlertTriangle size={10} aria-hidden="true" /> Vượt hạn mức
                              </Badge>
                            )}
                          </td>
                          <td className="tabular">
                            {c.phone
                              ? <a href={`tel:${c.phone}`} className="text-accent hover:underline inline-flex items-center gap-1">
                                  <Phone size={11} aria-hidden="true" />{c.phone}
                                </a>
                              : '—'}
                          </td>
                          <td className="num">{c.unpaid_bills}</td>
                          <td className="num text-muted-ink">{c.opening_debt > 0 ? money(c.opening_debt) : '—'}</td>
                          <td className="num font-bold text-warn">{money(c.debt)}</td>
                          <td className="num text-muted-ink">{c.debt_limit > 0 ? money(c.debt_limit) : 'Không giới hạn'}</td>
                          <td>
                            {c.oldest_unpaid
                              ? <span className={days > 60 ? 'text-danger font-semibold' : days > 30 ? 'text-warn' : 'text-muted-ink'}>
                                  {date(c.oldest_unpaid)} ({days} ngày)
                                </span>
                              : <span className="text-muted-ink">—</span>}
                          </td>
                          <td className="text-right">
                            <Button size="sm" variant="soft" onClick={() => setPaying(c)}>Thu nợ</Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5} className="text-right">TỔNG CỘNG PHẢI THU</td>
                      <td className="num text-warn">{money(totals.total)}</td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
      </Page>

      <DebtPayModal
        partner={paying}
        kind="customer"
        accounts={meta.accounts}
        onClose={() => setPaying(null)}
        onDone={() => { setPaying(null); reload(); toast('Đã lập phiếu thu nợ', 'ok'); }}
      />
    </>
  );
}

/* ==================================================================== */
/* Công nợ nhà cung cấp — tiền phải trả                                  */
/* ==================================================================== */

export function SupplierDebts() {
  const { toast, meta } = useApp();
  const [q, setQ] = useState('');
  const { data, busy, error, reload } = useFetch(() => api.supplierDebts(), []);
  const [paying, setPaying] = useState(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const list = q.trim()
      ? data.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()) || (s.phone || '').includes(q))
      : data;
    return [...list].sort((a, b) => b.debt - a.debt);
  }, [data, q]);

  const totals = useMemo(() => ({
    total: rows.reduce((a, s) => a + s.debt, 0),
    count: rows.length,
    overdue: rows.reduce((a, s) => a + s.overdue_amount, 0),
    overdueCount: rows.filter((s) => s.overdue_count > 0).length,
  }), [rows]);

  const exportCsv = () => {
    const head = ['Mã NCC', 'Tên nhà cung cấp', 'Điện thoại', 'Hạn nợ (ngày)', 'Phiếu chưa trả', 'Nợ đầu kỳ', 'Đang nợ', 'Quá hạn'];
    const csv = '﻿' + [head, ...rows.map((s) => [
      s.code, s.name, s.phone || '', s.term_days, s.unpaid_bills, s.opening_debt, s.debt, s.overdue_amount,
    ])].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'congno-nhacungcap.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Công nợ nhà cung cấp"
        subtitle="Số tiền cửa hàng đang nợ các mối lấy hàng"
        actions={<Button icon={Download} onClick={exportCsv} disabled={!rows.length}>Xuất Excel</Button>}
      >
        <SearchInput value={q} onChange={setQ} placeholder="Tìm nhà cung cấp..." className="w-full sm:w-80" />
      </PageHeader>

      <Page className="space-y-3">
        <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
          <Stat label="Tổng phải trả" value={short(totals.total)} tone="bad" icon={Landmark} />
          <Stat label="Số NCC đang nợ" value={n(totals.count)} />
          <Stat label="Đã quá hạn" value={short(totals.overdue)} tone={totals.overdue > 0 ? 'bad' : 'default'} icon={AlertTriangle} />
          <Stat label="NCC có nợ quá hạn" value={n(totals.overdueCount)} tone={totals.overdueCount > 0 ? 'warn' : 'default'} />
        </div>

        {totals.overdue > 0 && (
          <div className="card-pad bg-red-50 border-danger/30">
            <div className="flex gap-2.5">
              <AlertTriangle size={17} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-[13px]">
                <p className="font-semibold text-danger">Có khoản nợ đã quá hạn thanh toán</p>
                <p className="text-red-900/80 mt-0.5">
                  Tổng <b>{money(totals.overdue)}</b> ở {totals.overdueCount} nhà cung cấp đã quá ngày hẹn trả.
                  Nên thu xếp trả sớm để giữ uy tín lấy hàng.
                </p>
              </div>
            </div>
          </div>
        )}

        {busy && !data ? <Spinner />
          : error ? <ErrorBox error={error} onRetry={reload} />
            : !rows.length ? (
              <Empty
                icon={Landmark}
                title="Không nợ nhà cung cấp nào"
                message="Tất cả phiếu nhập đều đã thanh toán đủ."
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Mã</th><th>Nhà cung cấp</th><th>Điện thoại</th>
                      <th className="text-right">Hạn nợ</th>
                      <th className="text-right">Phiếu chưa trả</th>
                      <th className="text-right">Nợ đầu kỳ</th>
                      <th className="text-right">Đang nợ</th>
                      <th className="text-right">Quá hạn</th>
                      <th className="text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.id} className="hoverable">
                        <td className="font-mono text-muted-ink">{s.code}</td>
                        <td>
                          <Link to={`/suppliers/${s.id}`} className="font-semibold text-accent hover:underline">
                            {s.name}
                          </Link>
                        </td>
                        <td className="tabular">
                          {s.phone
                            ? <a href={`tel:${s.phone}`} className="text-accent hover:underline inline-flex items-center gap-1">
                                <Phone size={11} aria-hidden="true" />{s.phone}
                              </a>
                            : '—'}
                        </td>
                        <td className="num text-muted-ink">{s.term_days > 0 ? `${s.term_days}n` : '—'}</td>
                        <td className="num">{s.unpaid_bills}</td>
                        <td className="num text-muted-ink">{s.opening_debt > 0 ? money(s.opening_debt) : '—'}</td>
                        <td className="num font-bold text-danger">{money(s.debt)}</td>
                        <td className="num">
                          {s.overdue_amount > 0
                            ? <Badge tone="bad">{money(s.overdue_amount)}</Badge>
                            : <span className="text-muted-ink">—</span>}
                        </td>
                        <td className="text-right">
                          <Button size="sm" variant="soft" onClick={() => setPaying(s)}>Trả nợ</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={6} className="text-right">TỔNG CỘNG PHẢI TRẢ</td>
                      <td className="num text-danger">{money(totals.total)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
      </Page>

      <DebtPayModal
        partner={paying}
        kind="supplier"
        accounts={meta.accounts}
        onClose={() => setPaying(null)}
        onDone={() => { setPaying(null); reload(); toast('Đã lập phiếu chi trả nợ', 'ok'); }}
      />
    </>
  );
}
