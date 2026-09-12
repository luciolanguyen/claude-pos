import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  Truck, Plus, Pencil, Trash2, Wallet, FileText, ArrowLeft, Download, Landmark, Undo2, Phone,
  CreditCard, AlertTriangle, Copy, Printer, Banknote, MapPin, Mail, Info, Clock, User,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, useDebounced, useSearchMode } from '../lib/store';
import { useLiveReload } from '../lib/useLive';
import { money, n, short, date, datetime, smartTime, match, CASH_LABEL } from '../lib/format';
import {
  Button, IconButton, SearchInput, Spinner, Empty, ErrorBox, Badge, Confirm, Stat, Tabs,
  Modal, Field, MoneyInput, Select, Textarea,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import { SupplierForm } from '../components/CustomerForm';
import CashVoucherPrint from '../components/CashVoucherPrint';
import { ProductPicker } from '../components/ProductPicker';

/* Phân hệ nhà cung cấp gộp công nợ (tài liệu 10): không còn trang công nợ
   NCC riêng — lọc "đang nợ", "nợ quá hạn" ngay trên danh mục, trả nợ ngay
   trong hồ sơ. */
const FILTERS = [
  { key: '', label: 'Tất cả NCC' },
  { key: 'debt', label: 'Đang nợ' },
  { key: 'overdue', label: 'Nợ quá hạn' },
];

export default function Suppliers() {
  const { toast } = useApp();
  const [params, setParams] = useSearchParams();
  const filter = FILTERS.some((f) => f.key === params.get('filter')) ? params.get('filter') : '';
  const setFilter = (v) => {
    const next = new URLSearchParams(params);
    if (v) next.set('filter', v); else next.delete('filter');
    setParams(next, { replace: true });
  };
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [mode, setMode] = useSearchMode();
  const { data, busy, error, reload } = useFetch(
    () => api.suppliers({ q: dq, match: mode, filter }), [dq, mode, filter]);
  useLiveReload(reload);

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
      overdue: data.reduce((a, s) => a + (s.overdue_amount || 0), 0),
      overdueCount: data.filter((s) => s.overdue_count > 0).length,
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
    const head = ['Mã NCC', 'Tên nhà cung cấp', 'Người liên hệ', 'Số điện thoại', 'Địa chỉ', 'MST',
      'Hạn nợ (ngày)', 'Số phiếu nhập', 'Tổng nhập', 'Phiếu chưa trả', 'Đang nợ', 'Quá hạn'];
    const rows = data.map((s) => [
      s.code, s.name, s.contact_name || '',
      (s.phones || []).map((p) => (p.label ? `${p.phone} (${p.label})` : p.phone)).join('; '),
      s.address || '', s.tax_code || '', s.term_days, s.purchase_count, s.total_purchased,
      s.unpaid_bills, s.debt, s.overdue_amount,
    ]);
    const csv = '﻿' + [head, ...rows].map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = filter ? `nhacungcap-${filter}.csv` : 'nhacungcap.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Nhà cung cấp"
        subtitle={totals ? `${n(totals.count)} nhà cung cấp · ${n(totals.debtors)} đang nợ · tổng nợ ${money(totals.debt)}` : ''}
        actions={<>
          <Button icon={Download} onClick={exportCsv} disabled={!data?.length}>Xuất Excel</Button>
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Thêm nhà cung cấp</Button>
        </>}
      >
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={q} onChange={setQ} mode={mode} onMode={setMode} placeholder="Tìm tên, người liên hệ, số điện thoại..." className="w-full sm:w-80" />
          <div className="flex rounded-lg border border-line overflow-hidden" role="radiogroup" aria-label="Lọc theo công nợ">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`px-2.5 h-9 text-[13px] font-semibold whitespace-nowrap cursor-pointer transition-colors duration-150
                            ${filter === f.key ? 'bg-primary text-white' : 'bg-card hover:bg-muted'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </PageHeader>

      <Page className="space-y-3">
        {totals && (
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
            <Stat label="Số nhà cung cấp" value={n(totals.count)} icon={Truck} />
            <Stat label="Tổng đang nợ" value={short(totals.debt)} tone="bad" icon={Landmark}
              sub={`${n(totals.debtors)} NCC còn nợ`} onClick={() => setFilter('debt')} />
            <Stat label="Nợ đã quá hạn" value={short(totals.overdue)} tone={totals.overdue > 0 ? 'bad' : 'default'}
              icon={AlertTriangle} sub={`${n(totals.overdueCount)} NCC`} onClick={() => setFilter('overdue')} />
            <Stat label="Tổng đã nhập" value={short(totals.purchased)} icon={FileText} />
          </div>
        )}

        {busy && !data ? <Spinner />
          : error ? <ErrorBox error={error} onRetry={reload} />
            : !data?.length ? (
              <Empty
                icon={Truck}
                title={filter ? 'Không có nhà cung cấp nào khớp bộ lọc' : 'Chưa có nhà cung cấp nào'}
                message={filter ? '' : 'Thêm các mối lấy hàng để theo dõi công nợ và lịch sử nhập hàng.'}
                action={!filter && <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Thêm nhà cung cấp</Button>}
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
                          <Link to={`/suppliers/${s.id}`} className="font-semibold text-accent hover:underline">{s.name}</Link>
                          {s.active === 0 && <Badge tone="mute" className="ml-1.5">Ngừng</Badge>}
                          {s.bank_count > 0 && (
                            <div className="text-2xs text-muted-ink inline-flex items-center gap-1 ml-1.5">
                              <CreditCard size={10} aria-hidden="true" />{s.bank_count} TK
                            </div>
                          )}
                        </td>
                        <td>
                          {s.contact_name && <div>{s.contact_name}</div>}
                          {(s.phones || []).slice(0, 2).map((p, i) => (
                            <div key={i} className="text-2xs text-muted-ink tabular">
                              {p.phone}{p.label && <span className="ml-1 text-ink/70">· {p.label}</span>}
                            </div>
                          ))}
                          {(s.phones || []).length > 2 && <div className="text-2xs text-muted-ink">+{s.phones.length - 2} số khác</div>}
                        </td>
                        <td className="num text-muted-ink">{s.term_days > 0 ? `${s.term_days} ngày` : '—'}</td>
                        <td className="num">{s.purchase_count}</td>
                        <td className="num">{money(s.total_purchased)}</td>
                        <td className="num">
                          {s.debt > 0
                            ? <div className="flex flex-col items-end gap-0.5">
                                <span className="font-semibold text-danger">{money(s.debt)}</span>
                                {s.overdue_amount > 0 && <Badge tone="bad">Quá hạn {money(s.overdue_amount)}</Badge>}
                              </div>
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
                  {filter && (
                    <tfoot>
                      <tr>
                        <td colSpan={6} className="text-right">TỔNG CỘNG PHẢI TRẢ</td>
                        <td className="num text-danger">{money(totals.debt)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  )}
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

      {paying && (
        <SupplierPayModal
          supplierId={paying.id}
          onClose={() => setPaying(null)}
          onDone={() => reload()}
        />
      )}

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
/* Trả nợ nhà cung cấp — phiếu chi, chọn tài khoản nhận đã lưu của NCC    */
/* ==================================================================== */

const bankLine = (a) => [a.bank_name, a.account_no, a.holder].filter(Boolean).join(' · ') + (a.label ? ` [${a.label}]` : '');

export function SupplierPayModal({ supplierId, onClose, onDone }) {
  const { meta, user, toast, can } = useApp();
  const { data: s, busy, error, reload } = useFetch(() => api.supplier(supplierId), [supplierId]);
  const [amount, setAmount] = useState(0);
  const [touched, setTouched] = useState(false);
  const [method, setMethod] = useState('cash');
  const [accountId, setAccountId] = useState('');
  const [bankId, setBankId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [voucher, setVoucher] = useState(null);

  const cashAccounts = meta.accounts.filter((a) => a.type !== 'bank');
  const bankAccounts = meta.accounts.filter((a) => a.type === 'bank');
  const usable = method === 'transfer' && bankAccounts.length ? bankAccounts
    : (cashAccounts.length ? cashAccounts : meta.accounts);

  useEffect(() => { if (s && !touched) setAmount(Math.max(0, s.debt)); }, [s, touched]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setAccountId(usable[0]?.id || ''); }, [method, meta.accounts]);
  useEffect(() => {
    if (s && method === 'transfer' && !bankId) setBankId(s.bank_accounts?.[0]?.id || '');
  }, [s, method, bankId]);

  const picked = s?.bank_accounts?.find((a) => a.id === Number(bankId));
  const amt = Math.round(Number(amount) || 0);

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); toast('Đã chép số tài khoản', 'ok'); }
    catch { toast('Máy này không cho chép, hãy đọc số tài khoản trên màn hình', 'warn'); }
  };

  const submit = async (print) => {
    if (amt <= 0) { setErr('Số tiền trả phải lớn hơn 0.'); return; }
    if (method === 'transfer' && s.bank_accounts?.length && !picked) { setErr('Chọn tài khoản nhận của nhà cung cấp.'); return; }
    setSaving(true);
    setErr('');
    try {
      const res = await api.post(`/suppliers/${s.id}/pay`, {
        amount: amt,
        account_id: accountId || null,
        bank_account_id: method === 'transfer' && picked ? picked.id : null,
        note: note.trim() || undefined,
        user_id: user?.id || null,
      });
      toast(res.debt > 0
        ? `Đã chi ${money(amt)}. Còn nợ ${s.name} ${money(res.debt)}.`
        : `Đã chi ${money(amt)}. Đã hết nợ ${s.name}.`, 'ok', 6000);
      onDone?.(res);
      if (print && res.transaction?.id) {
        try {
          setVoucher(await api.get(`/cash/transactions/${res.transaction.id}`));
          return;
        } catch (e) {
          toast(`Đã lập phiếu chi nhưng không in được: ${e.message}`, 'warn', 7000);
        }
      }
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (voucher) {
    return <CashVoucherPrint voucher={voucher} onClose={() => { setVoucher(null); onClose(); }} />;
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Trả nợ nhà cung cấp"
      subtitle={s ? `${s.name} · lập phiếu chi` : ''}
      size="md"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button onClick={() => submit(false)} loading={saving} disabled={!s || amt <= 0}>Lập phiếu chi</Button>
        <Button variant="primary" icon={Printer} onClick={() => submit(true)} loading={saving}
          disabled={!s || amt <= 0 || !can('cash.voucher')}>
          Lập phiếu chi &amp; In
        </Button>
      </>}
    >
      {busy && !s ? <Spinner />
        : error ? <ErrorBox error={error} onRetry={reload} />
          : s && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="card p-2.5 text-center">
                  <div className="text-2xs font-bold text-muted-ink uppercase">Mình đang nợ</div>
                  <div className="text-2xl font-display font-bold tabular text-danger mt-0.5">{money(s.debt)}</div>
                  <div className="text-2xs text-muted-ink">{n(s.unpaid?.length || 0)} phiếu nhập chưa trả đủ</div>
                </div>
                <div className={`card p-2.5 text-center ${s.overdue_amount > 0 ? 'bg-red-50 border-danger/30' : ''}`}>
                  <div className="text-2xs font-bold text-muted-ink uppercase">Đã quá hạn</div>
                  <div className={`text-2xl font-display font-bold tabular mt-0.5 ${s.overdue_amount > 0 ? 'text-danger' : ''}`}>
                    {money(s.overdue_amount)}
                  </div>
                  <div className="text-2xs text-muted-ink">{s.term_days > 0 ? `Hạn trả ${s.term_days} ngày` : 'Không hẹn ngày'}</div>
                </div>
              </div>

              <Field label="Số tiền trả" required htmlFor="sp-amt">
                <MoneyInput id="sp-amt" size="lg" value={amount} autoFocus
                  onChange={(v) => { setTouched(true); setAmount(v); }} />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => { setTouched(true); setAmount(Math.max(0, s.debt)); }}>Trả hết</button>
                  {s.overdue_amount > 0 && (
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => { setTouched(true); setAmount(s.overdue_amount); }}>
                      Phần quá hạn
                    </button>
                  )}
                  <button type="button" className="btn btn-sm btn-outline"
                    onClick={() => { setTouched(true); setAmount(Math.round(s.debt / 2 / 1000) * 1000); }}>Một nửa</button>
                </div>
                {amt > s.debt && s.debt >= 0 && (
                  <p className="text-2xs text-warn font-semibold mt-1">Trả nhiều hơn số đang nợ — phần dư ghi thành tiền trả trước cho NCC.</p>
                )}
              </Field>

              <div>
                <span className="label" id="sp-method">Hình thức</span>
                <div role="radiogroup" aria-labelledby="sp-method" className="grid grid-cols-2 gap-1.5">
                  {[['cash', 'Tiền mặt', Banknote], ['transfer', 'Chuyển khoản', CreditCard]].map(([k, label, Icon]) => (
                    <label key={k}
                      className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[13px] font-semibold cursor-pointer
                                  transition-colors duration-150 focus-within:ring-2 focus-within:ring-accent/40
                                  ${method === k ? 'border-accent bg-accent-soft text-emerald-900' : 'border-line hover:bg-muted'}`}>
                      <input type="radio" name="sp-method" value={k} checked={method === k}
                        onChange={() => setMethod(k)} className="sr-only" />
                      <Icon size={15} aria-hidden="true" />{label}
                    </label>
                  ))}
                </div>
              </div>

              <Field label="Chi từ quỹ" htmlFor="sp-acc">
                <Select id="sp-acc" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
                  {usable.map((a) => <option key={a.id} value={a.id}>{a.name} — số dư {money(a.balance)}</option>)}
                </Select>
              </Field>

              {method === 'transfer' && (
                s.bank_accounts?.length ? (
                  <Field label="Chuyển vào tài khoản của NCC" required htmlFor="sp-bank">
                    <Select id="sp-bank" value={bankId} onChange={(e) => setBankId(e.target.value)}>
                      {s.bank_accounts.map((a) => <option key={a.id} value={a.id}>{bankLine(a)}</option>)}
                    </Select>
                    {picked && (
                      <div className="mt-2 rounded-lg border border-line bg-muted/40 p-2.5 text-[13px] flex items-center gap-2">
                        <CreditCard size={16} className="text-muted-ink shrink-0" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold">{picked.bank_name}{picked.label && <Badge tone="info" className="ml-1.5">{picked.label}</Badge>}</div>
                          <div className="font-mono text-base tracking-wide">{picked.account_no}</div>
                          {picked.holder && <div className="text-muted-ink">{picked.holder}</div>}
                        </div>
                        <IconButton icon={Copy} label="Chép số tài khoản" onClick={() => copy(picked.account_no)} />
                      </div>
                    )}
                  </Field>
                ) : (
                  <p className="rounded-lg border border-warn/30 bg-amber-50 p-2.5 text-[13px] text-amber-900">
                    NCC chưa lưu tài khoản ngân hàng nào. Lưu trong <b>Sửa thông tin NCC</b> để lần sau chỉ cần chọn.
                  </p>
                )
              )}

              <Field label="Ghi chú" htmlFor="sp-note">
                <Textarea id="sp-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Để trống thì tự ghi: Trả nợ NCC..." />
              </Field>

              {err && <p role="alert" className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
            </div>
          )}
    </Modal>
  );
}

/* ==================================================================== */
/* Hồ sơ nhà cung cấp — thông tin liên hệ, lịch sử giao dịch, công nợ     */
/* ==================================================================== */

const SUP_TABS = ['info', 'history', 'debt', 'quotes'];

export function SupplierDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { toast } = useApp();
  const { data: s, busy, error, reload } = useFetch(() => api.supplier(id), [id]);
  useLiveReload(reload);
  const [tab, setTab] = useState(SUP_TABS.includes(params.get('tab')) ? params.get('tab') : 'info');
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);

  if (busy && !s) return <><PageHeader title="Nhà cung cấp" /><Spinner /></>;
  if (error && !s) return <><PageHeader title="Nhà cung cấp" /><Page><ErrorBox error={error} onRetry={reload} /></Page></>;
  if (!s) return null;

  const totalPurchased = s.purchases.filter((p) => p.status !== 'cancelled').reduce((a, p) => a + p.total, 0);

  return (
    <>
      <PageHeader
        title={s.name}
        subtitle={[s.code, s.contact_name, s.phones?.[0]?.phone || s.phone].filter(Boolean).join(' · ')}
        actions={<>
          <Button icon={ArrowLeft} onClick={() => nav('/suppliers')}>Danh sách NCC</Button>
          <Button icon={Pencil} onClick={() => setEditing(true)}>Sửa thông tin</Button>
          {s.debt > 0 && (
            <Button variant="primary" icon={Wallet} onClick={() => setPaying(true)}>Trả nợ {money(s.debt)}</Button>
          )}
        </>}
      />

      <Page className="space-y-3">
        <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
          <Stat label="Tổng đã nhập" value={short(totalPurchased)} icon={FileText}
            sub={`${n(s.purchases.length)} phiếu nhập`} onClick={() => setTab('history')} />
          <Stat label="Đang nợ" value={money(s.debt)} tone={s.debt > 0 ? 'bad' : 'default'} icon={Landmark}
            sub={`${n(s.unpaid.length)} phiếu chưa trả đủ`} onClick={() => setTab('debt')} />
          <Stat label="Đã quá hạn" value={money(s.overdue_amount)} tone={s.overdue_amount > 0 ? 'bad' : 'default'}
            icon={AlertTriangle} sub={`${n(s.overdue_count)} phiếu`} onClick={() => setTab('debt')} />
          <Stat label="Hạn thanh toán" value={s.term_days > 0 ? `${s.term_days} ngày` : 'Trả ngay'} icon={Clock} />
        </div>

        <div className="card">
          <Tabs
            value={tab}
            onChange={setTab}
            className="px-2 pt-1"
            tabs={[
              { key: 'info', label: 'Thông tin liên hệ' },
              { key: 'history', label: 'Lịch sử giao dịch', count: s.purchases.length + s.returns.length || null },
              { key: 'debt', label: 'Công nợ', count: s.unpaid.length || null },
              { key: 'quotes', label: 'Báo giá' },
            ]}
          />
          {tab === 'info' && <SupplierInfoTab s={s} />}
          {tab === 'history' && <SupplierHistoryTab s={s} />}
          {tab === 'debt' && <SupplierDebtTab s={s} onPay={() => setPaying(true)} />}
          {tab === 'quotes' && <SupplierQuotesTab s={s} />}
        </div>
      </Page>

      <SupplierForm
        open={editing}
        supplier={s}
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); reload(); toast('Đã lưu thay đổi', 'ok'); }}
      />

      {paying && (
        <SupplierPayModal supplierId={s.id} onClose={() => setPaying(false)} onDone={() => reload()} />
      )}
    </>
  );
}

/* ==================================================================== */
/* Bảng báo giá của mối (tài liệu 15, mục 4.3)                            */
/*                                                                      */
/* Mối báo giá bao nhiêu cho từng mã hàng thì ghi vào đây. Lúc lập phiếu  */
/* mua tạm từ phiếu báo hết hàng, hệ thống lấy ĐÚNG con số này đổ vào đơn */
/* giá dự kiến — khỏi phải mở tin nhắn ra tra lại từng món.               */
/* ==================================================================== */

function SupplierQuotesTab({ s }) {
  const { toast, defaultWarehouse } = useApp();
  const { data, busy, error, reload } = useFetch(() => api.supplierQuotes(s.id), [s.id]);
  const { data: products } = useFetch(
    () => api.posProducts({ warehouse_id: defaultWarehouse }), [defaultWarehouse]);
  const [edits, setEdits] = useState({});
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);

  const rows = data?.rows || [];
  const shown = useMemo(() => {
    const k = q.trim();
    return k ? rows.filter((r) => match(r.name, k) || match(r.sku, k)) : rows;
  }, [rows, q]);

  const dirty = Object.keys(edits).length > 0;
  const valueOf = (r) => (edits[r.product_id] !== undefined ? edits[r.product_id] : r.quote_price);

  const save = async () => {
    setSaving(true);
    try {
      const payload = Object.entries(edits).map(([pid, price]) => ({
        product_id: Number(pid), quote_price: Math.round(Number(price) || 0),
      }));
      await api.saveSupplierQuotes(s.id, payload);
      setEdits({});
      reload();
      toast(`Đã lưu báo giá ${payload.length} mặt hàng của ${s.name}`, 'ok');
    } catch (e) {
      toast(e.message, 'bad', 6000);
    } finally { setSaving(false); }
  };

  /* Thêm mặt hàng mối này chưa từng bán: ghi báo giá 0 trước, gõ giá sau */
  const addProduct = async (p) => {
    try {
      await api.saveSupplierQuotes(s.id, [{ product_id: p.id, quote_price: 0 }]);
      setAdding(false);
      reload();
    } catch (e) { toast(e.message, 'bad', 6000); }
  };

  if (busy && !data) return <div className="p-3"><Spinner /></div>;
  if (error) return <div className="p-3"><ErrorBox error={error} onRetry={reload} /></div>;

  return (
    <div className="p-3 space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Tìm mặt hàng trong bảng báo giá..."
          className="w-full sm:w-72" />
        <div className="flex-1" />
        <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>Thêm mặt hàng</Button>
        {dirty && (
          <Button size="sm" variant="primary" loading={saving} onClick={save}>
            Lưu báo giá ({Object.keys(edits).length})
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <Empty
          icon={FileText}
          title="Chưa có báo giá nào của mối này"
          message="Ghi giá mối báo cho từng mã hàng. Lúc lập phiếu mua tạm, hệ thống tự đổ đúng con số này vào đơn giá."
          action={<Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Thêm mặt hàng</Button>}
        />
      ) : (
        <div className="table-wrap max-h-[52vh]">
          <table className="data">
            <thead>
              <tr>
                <th>Mã hàng</th>
                <th>Tên hàng</th>
                <th>Mã bên mối</th>
                <th className="text-right">Giá vốn hiện tại</th>
                <th className="text-right">Giá mua lần trước</th>
                <th className="text-right" style={{ width: 150 }}>Giá mối báo</th>
                <th>Ngày báo</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.product_id} className={edits[r.product_id] !== undefined ? 'bg-accent-soft/30' : ''}>
                  <td className="font-mono text-muted-ink">{r.sku}</td>
                  <td>
                    <div className="font-medium">{r.name}</div>
                    {r.product_active === 0 && <Badge tone="mute">Ngừng KD</Badge>}
                  </td>
                  <td className="text-muted-ink text-2xs font-mono">{r.supplier_sku || '—'}</td>
                  <td className="num text-muted-ink">{money(r.cost_price)}</td>
                  <td className="num text-muted-ink">
                    {r.last_price > 0 ? money(r.last_price) : '—'}
                  </td>
                  <td>
                    <MoneyInput
                      size="sm"
                      value={valueOf(r)}
                      onChange={(v) => setEdits((m) => ({ ...m, [r.product_id]: v }))}
                      aria-label={`Giá mối báo cho ${r.name}`}
                    />
                    <div className="text-2xs text-muted-ink text-right">
                      / {r.base_unit}
                    </div>
                  </td>
                  <td className="text-muted-ink text-2xs whitespace-nowrap">
                    {r.quote_at ? date(r.quote_at) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-2xs text-muted-ink">
        Giá tính theo <b>đơn vị cơ bản</b> của mặt hàng. Ghi 0 là bỏ báo giá — lúc đó phiếu mua tạm
        rơi về giá nhập gần nhất, rồi tới giá vốn.
      </p>

      <ProductPicker
        open={adding}
        onClose={() => setAdding(false)}
        products={(products || []).filter((p) => !rows.some((r) => r.product_id === p.id))}
        onPick={addProduct}
        withQty={false}
        title={`Thêm mặt hàng vào bảng báo giá của ${s.name}`}
      />
    </div>
  );
}

function InfoLine({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-line/60 last:border-0">
      <Icon size={14} className="text-muted-ink mt-0.5 shrink-0" aria-hidden="true" />
      <div className="w-32 shrink-0 text-muted-ink">{label}</div>
      <div className="min-w-0 flex-1 font-medium break-words">
        {children || <span className="text-muted-ink font-normal">—</span>}
      </div>
    </div>
  );
}

function SupplierInfoTab({ s }) {
  const { toast } = useApp();
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); toast('Đã chép', 'ok'); }
    catch { toast('Máy này không cho chép', 'warn'); }
  };
  return (
    <div className="p-3 grid gap-4 lg:grid-cols-2 text-[13px]">
      <section>
        <h3 className="text-2xs font-bold uppercase tracking-wide text-muted-ink mb-1">Thông tin chung</h3>
        <InfoLine icon={User} label="Người liên hệ">{s.contact_name}</InfoLine>
        <InfoLine icon={MapPin} label="Địa chỉ">{s.address}</InfoLine>
        <InfoLine icon={Mail} label="Email">{s.email}</InfoLine>
        <InfoLine icon={Info} label="Mã số thuế">{s.tax_code}</InfoLine>
        <InfoLine icon={Clock} label="Hạn thanh toán">{s.term_days > 0 ? `${s.term_days} ngày sau khi nhập` : 'Trả ngay'}</InfoLine>
        <InfoLine icon={Landmark} label="Nợ đầu kỳ">{s.opening_debt > 0 ? money(s.opening_debt) : null}</InfoLine>
        {s.note && <InfoLine icon={Info} label="Ghi chú">{s.note}</InfoLine>}

        <h3 className="text-2xs font-bold uppercase tracking-wide text-muted-ink mt-4 mb-1">Số điện thoại</h3>
        {s.phones?.length ? (
          <ul className="divide-y divide-line border border-line rounded">
            {s.phones.map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-2 py-1.5">
                <Phone size={13} className="text-muted-ink" aria-hidden="true" />
                <a href={`tel:${p.phone}`} className="font-semibold tabular text-accent hover:underline">{p.phone}</a>
                {p.label && <Badge tone="info">{p.label}</Badge>}
              </li>
            ))}
          </ul>
        ) : <p className="text-muted-ink">Chưa lưu số điện thoại.</p>}
      </section>

      <section>
        <h3 className="text-2xs font-bold uppercase tracking-wide text-muted-ink mb-1">Tài khoản ngân hàng</h3>
        {s.bank_accounts?.length ? (
          <div className="space-y-2">
            {s.bank_accounts.map((a) => (
              <div key={a.id} className="rounded-lg border border-line p-2.5 flex items-center gap-2">
                <CreditCard size={18} className="text-muted-ink shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold flex flex-wrap items-center gap-1.5">
                    {a.bank_name}{a.label && <Badge tone="info">{a.label}</Badge>}
                  </div>
                  <div className="font-mono text-base tracking-wide">{a.account_no}</div>
                  {a.holder && <div className="text-muted-ink">{a.holder}</div>}
                </div>
                <IconButton icon={Copy} label={`Chép số tài khoản ${a.bank_name}`} onClick={() => copy(a.account_no)} />
              </div>
            ))}
          </div>
        ) : <p className="text-muted-ink">Chưa lưu tài khoản ngân hàng nào.</p>}
      </section>
    </div>
  );
}

function SupplierHistoryTab({ s }) {
  const [kind, setKind] = useState('all');
  const rows = useMemo(() => {
    const list = [
      ...s.purchases.map((p) => ({ ...p, kind: 'purchase' })),
      ...s.returns.map((r) => ({ ...r, kind: 'return' })),
    ].filter((x) => kind === 'all' || x.kind === kind);
    return list.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  }, [s, kind]);

  return (
    <div>
      <div className="px-3 pt-2.5 flex items-center gap-2">
        <div className="flex rounded border border-line overflow-hidden" role="radiogroup" aria-label="Loại giao dịch">
          {[['all', 'Tất cả'], ['purchase', 'Nhập hàng'], ['return', 'Trả hàng']].map(([k, lb]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
              className={`px-2.5 h-8 text-[13px] font-semibold cursor-pointer transition-colors duration-100
                          ${kind === k ? 'bg-primary text-white' : 'bg-card hover:bg-muted'}`}>
              {lb}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? <Empty icon={FileText} title="Chưa có giao dịch" /> : (
        <div className="overflow-x-auto mt-2">
          <table className="data">
            <thead>
              <tr>
                <th>Loại</th><th>Mã phiếu</th><th>Ngày</th>
                <th className="text-right">Giá trị</th>
                <th className="text-right">Đã trả / NCC hoàn</th>
                <th className="text-right">Còn nợ</th>
                <th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={`${x.kind}${x.id}`} className={`hoverable ${x.status === 'cancelled' ? 'opacity-50' : ''}`}>
                  <td>
                    {x.kind === 'purchase'
                      ? <Badge tone="info"><FileText size={10} aria-hidden="true" /> Nhập hàng</Badge>
                      : <Badge tone="warn"><Undo2 size={10} aria-hidden="true" /> Trả hàng</Badge>}
                  </td>
                  <td className="font-mono font-semibold">
                    {x.code}
                    {x.status === 'cancelled' && <Badge tone="bad" className="ml-1">Huỷ</Badge>}
                  </td>
                  <td className="text-muted-ink whitespace-nowrap">{datetime(x.ts)}</td>
                  <td className={`num font-semibold ${x.kind === 'return' ? 'text-emerald-700' : ''}`}>
                    {x.kind === 'return' ? '-' : ''}{money(x.total)}
                  </td>
                  <td className="num">{money(x.kind === 'purchase' ? x.paid : x.refunded)}</td>
                  <td className={`num ${x.kind === 'purchase' && x.total - x.paid > 0 && x.status !== 'cancelled' ? 'text-danger font-semibold' : 'text-muted-ink'}`}>
                    {x.kind === 'purchase' && x.status !== 'cancelled' && x.total - x.paid > 0 ? money(x.total - x.paid) : '—'}
                  </td>
                  <td className="text-2xs">
                    <div className="flex flex-wrap gap-1">
                      {x.custom_count > 0 && <Badge tone="bad">Có hàng giao sai</Badge>}
                      {x.is_overdue === 1 && <Badge tone="bad">Quá hạn trả</Badge>}
                      {x.kind === 'return' && x.purchase_code && <span className="text-muted-ink">theo phiếu {x.purchase_code}</span>}
                      {x.kind === 'return' && x.mode === 'free' && <span className="text-muted-ink">trả tự do</span>}
                      {x.expense > 0 && <span className="text-muted-ink">chi phí trả {money(x.expense)}</span>}
                      {x.supplier_invoice && <span className="text-muted-ink">HĐ NCC {x.supplier_invoice}</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SupplierDebtTab({ s, onPay }) {
  return (
    <div className="p-3 space-y-3">
      <div className={`rounded-lg border p-3 flex flex-wrap items-center gap-3
                       ${s.overdue_amount > 0 ? 'border-danger/30 bg-red-50' : s.debt > 0 ? 'border-amber-200 bg-amber-50/60' : 'border-line bg-muted/40'}`}>
        <div className="flex-1 min-w-[12rem]">
          <div className="text-2xs font-bold uppercase text-muted-ink">Tổng nợ nhà cung cấp</div>
          <div className={`font-display font-bold text-3xl tabular ${s.debt > 0 ? 'text-danger' : ''}`} aria-live="polite">
            {money(s.debt)}
          </div>
          <div className="text-[13px] text-muted-ink mt-0.5">
            {s.unpaid.length ? `${n(s.unpaid.length)} phiếu nhập chưa trả đủ` : 'Không còn phiếu nhập nào nợ'}
            {s.opening_debt > 0 && ` · nợ đầu kỳ ${money(s.opening_debt)}`}
          </div>
        </div>
        <Button variant="primary" size="lg" icon={Wallet} onClick={onPay} disabled={!(s.debt > 0)}>Trả Nợ NCC</Button>
      </div>

      {s.overdue_amount > 0 && (
        <div role="status" className="rounded-lg border border-danger/30 bg-red-50 p-2.5 text-[13px] text-red-900 flex gap-2">
          <AlertTriangle size={15} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
          <span><b>{money(s.overdue_amount)}</b> ở {s.overdue_count} phiếu nhập đã quá hạn trả. Nên thu xếp trả sớm để giữ uy tín lấy hàng.</span>
        </div>
      )}

      <div>
        <h3 className="text-[13px] font-bold mb-1.5">Phiếu nhập còn nợ — cũ nhất trước</h3>
        {s.unpaid.length === 0 ? <p className="text-[13px] text-muted-ink">Không còn phiếu nào nợ.</p> : (
          <div className="overflow-x-auto border border-line rounded">
            <table className="data">
              <thead>
                <tr>
                  <th>Mã phiếu</th><th>Ngày nhập</th>
                  <th className="text-right">Tổng tiền</th><th className="text-right">Đã trả</th>
                  <th className="text-right">Còn nợ</th><th>Hạn trả</th>
                </tr>
              </thead>
              <tbody>
                {s.unpaid.map((p) => (
                  <tr key={p.id} className={p.is_overdue ? 'bg-red-50/70' : ''}>
                    <td className="font-mono font-semibold">{p.code}</td>
                    <td className="text-muted-ink whitespace-nowrap">{date(p.ts)} <span className="text-2xs">({p.age_days} ngày)</span></td>
                    <td className="num">{money(p.total)}</td>
                    <td className="num">{money(p.paid)}</td>
                    <td className="num font-semibold text-danger">{money(p.remaining)}</td>
                    <td>{p.due_date
                      ? (p.is_overdue ? <Badge tone="bad">{date(p.due_date)} · quá hạn</Badge> : <span className="text-muted-ink">{date(p.due_date)}</span>)
                      : <span className="text-muted-ink">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-[13px] font-bold mb-1.5">Lịch sử thanh toán</h3>
        {s.payments.length === 0 ? <p className="text-[13px] text-muted-ink">Chưa có phiếu chi / phiếu thu nào với NCC này.</p> : (
          <div className="overflow-x-auto border border-line rounded">
            <table className="data">
              <thead>
                <tr><th>Mã phiếu</th><th>Ngày</th><th>Loại</th><th className="text-right">Số tiền</th><th>Quỹ / tài khoản nhận</th><th>Diễn giải</th></tr>
              </thead>
              <tbody>
                {s.payments.map((p) => (
                  <tr key={p.id} className="hoverable">
                    <td className="font-mono">{p.code}</td>
                    <td className="text-muted-ink whitespace-nowrap">{datetime(p.ts)}</td>
                    <td><Badge tone={p.direction === 'out' ? 'bad' : 'ok'}>{p.direction === 'out' ? 'Chi' : 'Thu'} · {CASH_LABEL[p.category] || p.category}</Badge></td>
                    <td className={`num font-semibold ${p.direction === 'out' ? 'text-danger' : 'text-emerald-700'}`}>
                      {p.direction === 'out' ? '-' : '+'}{money(p.amount)}
                    </td>
                    <td className="text-[13px]">
                      <div>{p.account_name || '—'}</div>
                      {p.counterparty_account && <div className="text-2xs text-muted-ink font-mono">→ {p.counterparty_account}</div>}
                    </td>
                    <td className="text-muted-ink">{p.note}{p.user_name && <div className="text-2xs">{p.user_name}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
