import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Users, UserPlus, Pencil, Trash2, Phone, HandCoins, Receipt, ArrowLeft,
  Download, Package, TrendingUp,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, useDebounced } from '../lib/store';
import { money, n, short, qty as fq, date, datetime, smartTime, PAYMENT_LABEL, CASH_LABEL } from '../lib/format';
import {
  Button, IconButton, SearchInput, Modal, Spinner, Empty, ErrorBox, Badge,
  Confirm, Field, MoneyInput, Select, Textarea, Stat, Tabs,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import CustomerForm from '../components/CustomerForm';

export default function Customers() {
  const { toast, meta } = useApp();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [onlyDebt, setOnlyDebt] = useState(false);
  const { data, busy, error, reload } = useFetch(
    () => api.customers({ q: dq, has_debt: onlyDebt ? 1 : '' }), [dq, onlyDebt]
  );

  const [editing, setEditing] = useState(null);   // đối tượng hoặc 'new'
  const [deleting, setDeleting] = useState(null);
  const [paying, setPaying] = useState(null);
  const [busyAction, setBusyAction] = useState(false);

  const totals = useMemo(() => {
    if (!data) return null;
    return {
      count: data.length,
      debt: data.reduce((a, c) => a + Math.max(0, c.debt), 0),
      spent: data.reduce((a, c) => a + c.total_spent, 0),
      debtors: data.filter((c) => c.debt > 0).length,
    };
  }, [data]);

  const doDelete = async () => {
    setBusyAction(true);
    try {
      const res = await api.del(`/customers/${deleting.id}`);
      toast(res.message || `Đã xoá khách hàng ${deleting.name}`, res.deactivated ? 'warn' : 'ok', 5000);
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
    const head = ['Mã KH', 'Tên khách hàng', 'Điện thoại', 'Địa chỉ', 'Bảng giá', 'Số đơn', 'Tổng mua', 'Đang nợ', 'Hạn mức'];
    const rows = data.map((c) => [
      c.code, c.name, c.phone || '', c.address || '', c.price_list_name || 'Giá lẻ',
      c.order_count, c.total_spent, c.debt, c.debt_limit,
    ]);
    const csv = '﻿' + [head, ...rows]
      .map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'khachhang.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Khách hàng"
        subtitle={totals ? `${n(totals.count)} khách · ${n(totals.debtors)} khách đang nợ` : ''}
        actions={<>
          <Button icon={Download} onClick={exportCsv} disabled={!data?.length}>Xuất Excel</Button>
          <Button variant="primary" icon={UserPlus} onClick={() => setEditing('new')}>
            Thêm khách hàng
          </Button>
        </>}
      >
        <div className="flex flex-wrap gap-2">
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Tìm tên, số điện thoại, mã khách..."
            className="w-full sm:w-80"
          />
          <button
            onClick={() => setOnlyDebt((v) => !v)}
            className={`btn btn-sm ${onlyDebt ? 'btn-secondary' : 'btn-outline'}`}
          >
            <HandCoins size={13} aria-hidden="true" />
            Chỉ khách đang nợ
          </button>
        </div>
      </PageHeader>

      <Page className="space-y-3">
        {totals && (
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
            <Stat label="Tổng số khách" value={n(totals.count)} icon={Users} />
            <Stat label="Khách đang nợ" value={n(totals.debtors)} tone={totals.debtors > 0 ? 'warn' : 'default'} />
            <Stat label="Tổng công nợ" value={short(totals.debt)} tone="warn" icon={HandCoins} />
            <Stat label="Tổng đã mua" value={short(totals.spent)} tone="good" icon={TrendingUp} />
          </div>
        )}

        {busy && !data ? <Spinner />
          : error ? <ErrorBox error={error} onRetry={reload} />
            : !data?.length ? (
              <Empty
                icon={Users}
                title="Chưa có khách hàng nào"
                message={q ? `Không tìm thấy khách khớp "${q}".` : 'Thêm khách quen để theo dõi công nợ và lịch sử mua hàng.'}
                action={<Button variant="primary" icon={UserPlus} onClick={() => setEditing('new')}>Thêm khách hàng</Button>}
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Mã</th>
                      <th>Tên khách hàng</th>
                      <th>Điện thoại</th>
                      <th>Bảng giá</th>
                      <th className="text-right">Số đơn</th>
                      <th className="text-right">Tổng mua</th>
                      <th className="text-right">Đang nợ</th>
                      <th>Mua gần nhất</th>
                      <th className="text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((c) => (
                      <tr key={c.id} className={`hoverable ${c.active === 0 ? 'opacity-55' : ''}`}>
                        <td className="font-mono text-muted-ink">{c.code}</td>
                        <td>
                          <Link to={`/customers/${c.id}`} className="font-semibold text-accent hover:underline">
                            {c.name}
                          </Link>
                          {c.active === 0 && <Badge tone="mute" className="ml-1.5">Ngừng</Badge>}
                          {c.company_name && <div className="text-2xs text-muted-ink truncate max-w-[220px]">{c.company_name}</div>}
                        </td>
                        <td className="tabular">{c.phone || '—'}</td>
                        <td>{c.price_list_name ? <Badge tone="info">{c.price_list_name}</Badge> : <span className="text-muted-ink">Giá lẻ</span>}</td>
                        <td className="num">{c.order_count}</td>
                        <td className="num">{money(c.total_spent)}</td>
                        <td className="num">
                          {c.debt > 0
                            ? <span className={`font-semibold ${c.debt_limit > 0 && c.debt > c.debt_limit ? 'text-danger' : 'text-warn'}`}>
                                {money(c.debt)}
                              </span>
                            : <span className="text-muted-ink">—</span>}
                        </td>
                        <td className="text-muted-ink whitespace-nowrap">{c.last_order ? smartTime(c.last_order) : '—'}</td>
                        <td>
                          <div className="flex items-center justify-end gap-0.5">
                            {c.debt > 0 && (
                              <IconButton
                                icon={HandCoins}
                                label={`Thu nợ của ${c.name}`}
                                size={14}
                                className="!text-warn"
                                onClick={() => setPaying(c)}
                              />
                            )}
                            <IconButton icon={Pencil} label={`Sửa ${c.name}`} size={14} onClick={() => setEditing(c)} />
                            <IconButton
                              icon={Trash2}
                              label={`Xoá ${c.name}`}
                              size={14}
                              className="!text-danger hover:!bg-red-50"
                              onClick={() => setDeleting(c)}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </Page>

      <CustomerForm
        open={!!editing}
        customer={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={(c) => {
          setEditing(null);
          reload();
          toast(editing === 'new' ? `Đã thêm khách hàng ${c.name}` : 'Đã lưu thay đổi', 'ok');
        }}
      />

      <DebtPayModal
        partner={paying}
        kind="customer"
        accounts={meta.accounts}
        onClose={() => setPaying(null)}
        onDone={() => { setPaying(null); reload(); toast('Đã lập phiếu thu nợ', 'ok'); }}
      />

      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={doDelete}
        busy={busyAction}
        title="Xoá khách hàng?"
        confirmText="Xoá khách hàng"
        message={deleting && (
          <>
            Xoá <b>{deleting.name}</b> khỏi danh sách khách hàng?
            {deleting.order_count > 0 && (
              <>
                <br /><br />
                Khách này đã có <b>{deleting.order_count} hoá đơn</b> nên sẽ không xoá hẳn mà chỉ
                chuyển sang trạng thái <b>Ngừng theo dõi</b>, để lịch sử bán hàng không bị mất.
              </>
            )}
            {deleting.debt > 0 && (
              <>
                <br /><br />
                <span className="text-danger font-semibold">
                  Lưu ý: khách đang nợ {money(deleting.debt)}.
                </span>
              </>
            )}
          </>
        )}
      />
    </>
  );
}

/* ==================================================================== */
/* Hộp thu / trả nợ dùng chung cho khách hàng và nhà cung cấp            */
/* ==================================================================== */

export function DebtPayModal({ partner, kind, accounts, onClose, onDone }) {
  const [amount, setAmount] = useState(0);
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const isCustomer = kind === 'customer';

  useEffect(() => {
    if (!partner) return;
    setAmount(Math.max(0, partner.debt));
    setAccountId(accounts?.[0]?.id || '');
    setNote('');
    setErr('');
  }, [partner, accounts]);

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const path = isCustomer ? `/customers/${partner.id}/pay` : `/suppliers/${partner.id}/pay`;
      await api.post(path, { amount, account_id: accountId, note });
      onDone?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!partner}
      onClose={onClose}
      title={isCustomer ? 'Thu tiền nợ của khách' : 'Trả nợ nhà cung cấp'}
      subtitle={partner?.name}
      size="sm"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={submit} loading={busy}>
          {isCustomer ? 'Lập phiếu thu' : 'Lập phiếu chi'}
        </Button>
      </>}
    >
      {partner && (
        <div className="space-y-3">
          <div className="card p-2.5 text-center">
            <div className="text-2xs font-bold text-muted-ink uppercase">
              {isCustomer ? 'Khách đang nợ' : 'Mình đang nợ'}
            </div>
            <div className={`text-2xl font-display font-bold tabular mt-0.5 ${isCustomer ? 'text-warn' : 'text-danger'}`}>
              {money(partner.debt)}
            </div>
          </div>

          <Field label="Số tiền" required htmlFor="dp-amt">
            <MoneyInput id="dp-amt" size="lg" value={amount} onChange={setAmount} autoFocus />
            <div className="flex gap-1.5 mt-2">
              <button className="btn btn-sm btn-outline" onClick={() => setAmount(partner.debt)}>Trả hết</button>
              <button className="btn btn-sm btn-outline" onClick={() => setAmount(Math.round(partner.debt / 2 / 1000) * 1000)}>Một nửa</button>
            </div>
          </Field>

          <Field label={isCustomer ? 'Nộp vào quỹ' : 'Chi từ quỹ'} htmlFor="dp-acc">
            <Select id="dp-acc" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>{a.name} — số dư {money(a.balance)}</option>
              ))}
            </Select>
          </Field>

          <Field label="Ghi chú" htmlFor="dp-note">
            <Textarea id="dp-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
        </div>
      )}
    </Modal>
  );
}

/* ==================================================================== */
/* Trang chi tiết một khách hàng                                         */
/* ==================================================================== */

export function CustomerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { toast, meta, store } = useApp();
  const { data: c, busy, error, reload } = useFetch(() => api.customer(id), [id]);
  const [tab, setTab] = useState('sales');
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(null);

  if (busy && !c) return <><PageHeader title="Khách hàng" /><Spinner /></>;
  if (error) return <><PageHeader title="Khách hàng" /><Page><ErrorBox error={error} onRetry={reload} /></Page></>;
  if (!c) return null;

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={[c.code, c.phone, c.address].filter(Boolean).join(' · ')}
        actions={<>
          <Button icon={ArrowLeft} onClick={() => nav('/customers')}>Danh sách khách</Button>
          {c.debt > 0 && (
            <Button variant="primary" icon={HandCoins} onClick={() => setPaying(c)}>
              Thu nợ {money(c.debt)}
            </Button>
          )}
          <Button icon={Pencil} onClick={() => setEditing(true)}>Sửa thông tin</Button>
        </>}
      />

      <Page className="space-y-3">
        <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
          <Stat label="Tổng đã mua" value={short(c.sales.reduce((a, s) => a + s.total, 0))} tone="good" />
          <Stat label="Số hoá đơn" value={n(c.sales.length)} icon={Receipt} />
          <Stat
            label="Đang nợ"
            value={short(c.debt)}
            tone={c.debt > 0 ? 'warn' : 'default'}
            sub={c.debt_limit > 0 ? `Hạn mức ${short(c.debt_limit)}` : 'Không giới hạn'}
          />
          <Stat label="Nợ đầu kỳ" value={short(c.opening_debt)} />
        </div>

        {c.company_name && (
          <div className="card-pad text-[13px]">
            <div className="font-semibold mb-1">Thông tin xuất hoá đơn</div>
            <div className="grid gap-1 sm:grid-cols-2 text-muted-ink">
              <div>Tên công ty: <span className="text-ink">{c.company_name}</span></div>
              <div>Mã số thuế: <span className="text-ink">{c.tax_code || '—'}</span></div>
            </div>
          </div>
        )}

        <div className="card">
          <Tabs
            value={tab}
            onChange={setTab}
            className="px-2 pt-1"
            tabs={[
              { key: 'sales', label: 'Lịch sử mua hàng', count: c.sales.length },
              { key: 'products', label: 'Hàng hay mua', count: c.top_products.length },
              { key: 'payments', label: 'Thu chi tiền', count: c.payments.length },
              { key: 'returns', label: 'Trả hàng', count: c.returns.length },
            ]}
          />

          <div className="p-0">
            {tab === 'sales' && (
              c.sales.length === 0
                ? <Empty icon={Receipt} title="Khách chưa mua lần nào" />
                : (
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Mã hoá đơn</th><th>Ngày</th>
                        <th className="text-right">Tổng tiền</th>
                        <th className="text-right">Đã trả</th>
                        <th className="text-right">Còn nợ</th>
                        <th>Thanh toán</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.sales.map((s) => (
                        <tr key={s.id} className={`hoverable ${s.status === 'cancelled' ? 'opacity-50' : ''}`}>
                          <td>
                            <Link to={`/sales?q=${s.code}`} className="font-mono font-semibold text-accent hover:underline">
                              {s.code}
                            </Link>
                            {s.is_vat_invoice === 1 && <Badge tone="info" className="ml-1">GTGT</Badge>}
                            {s.status === 'cancelled' && <Badge tone="bad" className="ml-1">Huỷ</Badge>}
                          </td>
                          <td className="text-muted-ink whitespace-nowrap">{datetime(s.ts)}</td>
                          <td className="num font-semibold">{money(s.total)}</td>
                          <td className="num">{money(s.paid)}</td>
                          <td className={`num ${s.total - s.paid > 0 ? 'text-danger font-semibold' : 'text-muted-ink'}`}>
                            {s.total - s.paid > 0 ? money(s.total - s.paid) : '—'}
                          </td>
                          <td><Badge tone={s.payment_method === 'debt' ? 'warn' : 'mute'}>{PAYMENT_LABEL[s.payment_method]}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
            )}

            {tab === 'products' && (
              c.top_products.length === 0
                ? <Empty icon={Package} title="Chưa có dữ liệu" />
                : (
                  <table className="data">
                    <thead>
                      <tr><th>Tên hàng</th><th>ĐVT</th><th className="text-right">Đã mua</th><th className="text-right">Thành tiền</th></tr>
                    </thead>
                    <tbody>
                      {c.top_products.map((p, i) => (
                        <tr key={i} className="hoverable">
                          <td className="font-semibold">{p.name}</td>
                          <td>{p.unit_name}</td>
                          <td className="num">{fq(p.qty)}</td>
                          <td className="num font-semibold">{money(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
            )}

            {tab === 'payments' && (
              c.payments.length === 0
                ? <Empty icon={HandCoins} title="Chưa có giao dịch tiền" />
                : (
                  <table className="data">
                    <thead>
                      <tr><th>Mã phiếu</th><th>Ngày</th><th>Loại</th><th className="text-right">Số tiền</th><th>Diễn giải</th></tr>
                    </thead>
                    <tbody>
                      {c.payments.map((p) => (
                        <tr key={p.id} className="hoverable">
                          <td className="font-mono">{p.code}</td>
                          <td className="text-muted-ink whitespace-nowrap">{datetime(p.ts)}</td>
                          <td>
                            <Badge tone={p.direction === 'in' ? 'ok' : 'bad'}>
                              {p.direction === 'in' ? 'Thu' : 'Chi'} · {CASH_LABEL[p.category] || p.category}
                            </Badge>
                          </td>
                          <td className={`num font-semibold ${p.direction === 'in' ? 'text-emerald-700' : 'text-danger'}`}>
                            {p.direction === 'in' ? '+' : '-'}{money(p.amount)}
                          </td>
                          <td className="text-muted-ink">{p.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
            )}

            {tab === 'returns' && (
              c.returns.length === 0
                ? <Empty title="Khách chưa trả hàng lần nào" />
                : (
                  <table className="data">
                    <thead>
                      <tr><th>Mã phiếu</th><th>Ngày</th><th className="text-right">Giá trị</th><th className="text-right">Đã hoàn</th><th>Lý do</th></tr>
                    </thead>
                    <tbody>
                      {c.returns.map((rt) => (
                        <tr key={rt.id} className="hoverable">
                          <td className="font-mono">{rt.code}</td>
                          <td className="text-muted-ink">{date(rt.ts)}</td>
                          <td className="num">{money(rt.total)}</td>
                          <td className="num">{money(rt.refunded)}</td>
                          <td className="text-muted-ink">{rt.reason || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
            )}
          </div>
        </div>

        {c.note && (
          <div className="card-pad text-[13px]">
            <span className="font-semibold">Ghi chú: </span>{c.note}
          </div>
        )}
      </Page>

      <CustomerForm
        open={editing}
        customer={c}
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); reload(); toast('Đã lưu thay đổi', 'ok'); }}
      />

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
