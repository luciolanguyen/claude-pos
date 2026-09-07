import { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Truck, Plus, Pencil, Trash2, Wallet, FileText, ArrowLeft, Download, Landmark, Undo2,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, useDebounced } from '../lib/store';
import { money, n, short, date, datetime, smartTime, CASH_LABEL } from '../lib/format';
import {
  Button, IconButton, SearchInput, Spinner, Empty, ErrorBox, Badge, Confirm, Stat, Tabs,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import { SupplierForm } from '../components/CustomerForm';
import { DebtPayModal } from './Customers';

export default function Suppliers() {
  const { toast, meta } = useApp();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const { data, busy, error, reload } = useFetch(() => api.suppliers({ q: dq }), [dq]);

  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [paying, setPaying] = useState(null);
  const [busyAction, setBusyAction] = useState(false);

  const totals = useMemo(() => {
    if (!data) return null;
    return {
      count: data.length,
      debt: data.reduce((a, s) => a + Math.max(0, s.debt), 0),
      purchased: data.reduce((a, s) => a + s.total_purchased, 0),
      debtors: data.filter((s) => s.debt > 0).length,
    };
  }, [data]);

  const doDelete = async () => {
    setBusyAction(true);
    try {
      const res = await api.del(`/suppliers/${deleting.id}`);
      toast(res.message || `Đã xoá ${deleting.name}`, res.deactivated ? 'warn' : 'ok', 5000);
      setDeleting(null);
      reload();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusyAction(false);
    }
  };

  const exportCsv = () => {
    if (!data?.length) return;
    const head = ['Mã NCC', 'Tên nhà cung cấp', 'Người liên hệ', 'Điện thoại', 'Địa chỉ', 'MST', 'Hạn nợ (ngày)', 'Số phiếu nhập', 'Tổng nhập', 'Đang nợ'];
    const rows = data.map((s) => [
      s.code, s.name, s.contact_name || '', s.phone || '', s.address || '',
      s.tax_code || '', s.term_days, s.purchase_count, s.total_purchased, s.debt,
    ]);
    const csv = '﻿' + [head, ...rows].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'nhacungcap.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Nhà cung cấp"
        subtitle={totals ? `${n(totals.count)} nhà cung cấp · ${n(totals.debtors)} đang còn nợ` : ''}
        actions={<>
          <Button icon={Download} onClick={exportCsv} disabled={!data?.length}>Xuất Excel</Button>
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Thêm nhà cung cấp</Button>
        </>}
      >
        <SearchInput value={q} onChange={setQ} placeholder="Tìm tên, người liên hệ, số điện thoại..." className="w-full sm:w-80" />
      </PageHeader>

      <Page className="space-y-3">
        {totals && (
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
            <Stat label="Tổng số NCC" value={n(totals.count)} icon={Truck} />
            <Stat label="Đang còn nợ" value={n(totals.debtors)} tone={totals.debtors > 0 ? 'warn' : 'default'} />
            <Stat label="Tổng đang nợ" value={short(totals.debt)} tone="bad" icon={Landmark} />
            <Stat label="Tổng đã nhập" value={short(totals.purchased)} icon={FileText} />
          </div>
        )}

        {busy && !data ? <Spinner />
          : error ? <ErrorBox error={error} onRetry={reload} />
            : !data?.length ? (
              <Empty
                icon={Truck}
                title="Chưa có nhà cung cấp nào"
                message="Thêm các mối lấy hàng để theo dõi công nợ và lịch sử nhập hàng."
                action={<Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Thêm nhà cung cấp</Button>}
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Mã</th><th>Tên nhà cung cấp</th><th>Liên hệ</th>
                      <th className="text-right">Hạn nợ</th>
                      <th className="text-right">Số phiếu</th>
                      <th className="text-right">Tổng nhập</th>
                      <th className="text-right">Đang nợ</th>
                      <th>Nhập gần nhất</th>
                      <th className="text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((s) => (
                      <tr key={s.id} className={`hoverable ${s.active === 0 ? 'opacity-55' : ''}`}>
                        <td className="font-mono text-muted-ink">{s.code}</td>
                        <td>
                          <Link to={`/suppliers/${s.id}`} className="font-semibold text-accent hover:underline">
                            {s.name}
                          </Link>
                          {s.active === 0 && <Badge tone="mute" className="ml-1.5">Ngừng</Badge>}
                        </td>
                        <td>
                          {s.contact_name && <div>{s.contact_name}</div>}
                          {s.phone && <div className="text-2xs text-muted-ink tabular">{s.phone}</div>}
                        </td>
                        <td className="num text-muted-ink">{s.term_days > 0 ? `${s.term_days} ngày` : '—'}</td>
                        <td className="num">{s.purchase_count}</td>
                        <td className="num">{money(s.total_purchased)}</td>
                        <td className="num">
                          {s.debt > 0
                            ? <span className="font-semibold text-danger">{money(s.debt)}</span>
                            : <span className="text-muted-ink">—</span>}
                        </td>
                        <td className="text-muted-ink whitespace-nowrap">{s.last_purchase ? smartTime(s.last_purchase) : '—'}</td>
                        <td>
                          <div className="flex items-center justify-end gap-0.5">
                            {s.debt > 0 && (
                              <IconButton icon={Wallet} label={`Trả nợ ${s.name}`} size={14}
                                className="!text-warn" onClick={() => setPaying(s)} />
                            )}
                            <IconButton icon={Pencil} label={`Sửa ${s.name}`} size={14} onClick={() => setEditing(s)} />
                            <IconButton icon={Trash2} label={`Xoá ${s.name}`} size={14}
                              className="!text-danger hover:!bg-red-50" onClick={() => setDeleting(s)} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </Page>

      <SupplierForm
        open={!!editing}
        supplier={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={(s) => {
          setEditing(null); reload();
          toast(editing === 'new' ? `Đã thêm ${s.name}` : 'Đã lưu thay đổi', 'ok');
        }}
      />

      <DebtPayModal
        partner={paying}
        kind="supplier"
        accounts={meta.accounts}
        onClose={() => setPaying(null)}
        onDone={() => { setPaying(null); reload(); toast('Đã lập phiếu chi trả nợ', 'ok'); }}
      />

      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={doDelete}
        busy={busyAction}
        title="Xoá nhà cung cấp?"
        confirmText="Xoá nhà cung cấp"
        message={deleting && (
          <>
            Xoá <b>{deleting.name}</b> khỏi danh sách?
            {deleting.purchase_count > 0 && (
              <><br /><br />NCC này đã có <b>{deleting.purchase_count} phiếu nhập</b> nên sẽ chỉ chuyển sang
                trạng thái <b>Ngừng hợp tác</b>, giữ nguyên lịch sử nhập hàng.</>
            )}
            {deleting.debt > 0 && (
              <><br /><br /><span className="text-danger font-semibold">
                Lưu ý: đang còn nợ {money(deleting.debt)}.
              </span></>
            )}
          </>
        )}
      />
    </>
  );
}

/* ==================================================================== */

export function SupplierDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { toast, meta } = useApp();
  const { data: s, busy, error, reload } = useFetch(() => api.supplier(id), [id]);
  const [tab, setTab] = useState('purchases');
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(null);

  if (busy && !s) return <><PageHeader title="Nhà cung cấp" /><Spinner /></>;
  if (error) return <><PageHeader title="Nhà cung cấp" /><Page><ErrorBox error={error} onRetry={reload} /></Page></>;
  if (!s) return null;

  return (
    <>
      <PageHeader
        title={s.name}
        subtitle={[s.code, s.contact_name, s.phone, s.address].filter(Boolean).join(' · ')}
        actions={<>
          <Button icon={ArrowLeft} onClick={() => nav('/suppliers')}>Danh sách NCC</Button>
          {s.debt > 0 && (
            <Button variant="primary" icon={Wallet} onClick={() => setPaying(s)}>
              Trả nợ {money(s.debt)}
            </Button>
          )}
          <Button icon={Pencil} onClick={() => setEditing(true)}>Sửa thông tin</Button>
        </>}
      />

      <Page className="space-y-3">
        <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
          <Stat label="Tổng đã nhập" value={short(s.purchases.reduce((a, p) => a + p.total, 0))} />
          <Stat label="Số phiếu nhập" value={n(s.purchases.length)} icon={FileText} />
          <Stat label="Đang nợ" value={short(s.debt)} tone={s.debt > 0 ? 'bad' : 'default'} />
          <Stat label="Hạn thanh toán" value={s.term_days > 0 ? `${s.term_days} ngày` : 'Trả ngay'} />
        </div>

        {(s.tax_code || s.bank_account) && (
          <div className="card-pad text-[13px] grid gap-1 sm:grid-cols-2">
            <div className="text-muted-ink">Mã số thuế: <span className="text-ink">{s.tax_code || '—'}</span></div>
            <div className="text-muted-ink">Số tài khoản: <span className="text-ink font-mono">{s.bank_account || '—'}</span></div>
          </div>
        )}

        <div className="card">
          <Tabs
            value={tab}
            onChange={setTab}
            className="px-2 pt-1"
            tabs={[
              { key: 'purchases', label: 'Phiếu nhập hàng', count: s.purchases.length },
              { key: 'payments', label: 'Thanh toán', count: s.payments.length },
              { key: 'returns', label: 'Trả hàng', count: s.returns.length },
            ]}
          />

          {tab === 'purchases' && (
            s.purchases.length === 0
              ? <Empty icon={FileText} title="Chưa nhập hàng lần nào" />
              : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Mã phiếu</th><th>Ngày</th><th>Số HĐ NCC</th>
                      <th className="text-right">Tổng tiền</th>
                      <th className="text-right">Đã trả</th>
                      <th className="text-right">Còn nợ</th>
                      <th>Hạn trả</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.purchases.map((p) => (
                      <tr key={p.id} className={`hoverable ${p.status === 'cancelled' ? 'opacity-50' : ''}`}>
                        <td className="font-mono font-semibold">{p.code}
                          {p.status === 'cancelled' && <Badge tone="bad" className="ml-1">Huỷ</Badge>}</td>
                        <td className="text-muted-ink whitespace-nowrap">{datetime(p.ts)}</td>
                        <td className="font-mono text-muted-ink">{p.supplier_invoice || '—'}</td>
                        <td className="num font-semibold">{money(p.total)}</td>
                        <td className="num">{money(p.paid)}</td>
                        <td className={`num ${p.total - p.paid > 0 ? 'text-danger font-semibold' : 'text-muted-ink'}`}>
                          {p.total - p.paid > 0 ? money(p.total - p.paid) : '—'}
                        </td>
                        <td className="text-muted-ink">{p.due_date ? date(p.due_date) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
          )}

          {tab === 'payments' && (
            s.payments.length === 0
              ? <Empty icon={Wallet} title="Chưa có giao dịch thanh toán" />
              : (
                <table className="data">
                  <thead>
                    <tr><th>Mã phiếu</th><th>Ngày</th><th>Loại</th><th className="text-right">Số tiền</th><th>Diễn giải</th></tr>
                  </thead>
                  <tbody>
                    {s.payments.map((p) => (
                      <tr key={p.id} className="hoverable">
                        <td className="font-mono">{p.code}</td>
                        <td className="text-muted-ink whitespace-nowrap">{datetime(p.ts)}</td>
                        <td>
                          <Badge tone={p.direction === 'out' ? 'bad' : 'ok'}>
                            {p.direction === 'out' ? 'Chi' : 'Thu'} · {CASH_LABEL[p.category] || p.category}
                          </Badge>
                        </td>
                        <td className={`num font-semibold ${p.direction === 'out' ? 'text-danger' : 'text-emerald-700'}`}>
                          {p.direction === 'out' ? '-' : '+'}{money(p.amount)}
                        </td>
                        <td className="text-muted-ink">{p.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
          )}

          {tab === 'returns' && (
            s.returns.length === 0
              ? <Empty icon={Undo2} title="Chưa trả hàng lần nào" />
              : (
                <table className="data">
                  <thead>
                    <tr><th>Mã phiếu</th><th>Ngày</th><th className="text-right">Giá trị</th><th className="text-right">NCC hoàn</th><th>Lý do</th></tr>
                  </thead>
                  <tbody>
                    {s.returns.map((r) => (
                      <tr key={r.id} className="hoverable">
                        <td className="font-mono">{r.code}</td>
                        <td className="text-muted-ink">{date(r.ts)}</td>
                        <td className="num">{money(r.total)}</td>
                        <td className="num">{money(r.refunded)}</td>
                        <td className="text-muted-ink">{r.reason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
          )}
        </div>

        {s.note && <div className="card-pad text-[13px]"><b>Ghi chú: </b>{s.note}</div>}
      </Page>

      <SupplierForm
        open={editing}
        supplier={s}
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); reload(); toast('Đã lưu thay đổi', 'ok'); }}
      />

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
