import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  Users, UserPlus, Pencil, Trash2, HandCoins, ArrowLeft, Download, TrendingUp, AlertTriangle, Clock,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, useDebounced } from '../lib/store';
import { useLiveReload } from '../lib/useLive';
import { money, n, short, smartTime, date } from '../lib/format';
import {
  Button, IconButton, SearchInput, Modal, Spinner, Empty, ErrorBox, Badge,
  Confirm, Field, MoneyInput, Select, Textarea, Stat,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import CustomerForm, { CUSTOMER_TYPES } from '../components/CustomerForm';
import CustomerProfile, { CustomerTypeBadge } from '../components/CustomerProfile';
import { DebtCollectModal } from '../components/PosDebt';

/* Phân hệ khách hàng gộp công nợ (tài liệu 08): không còn trang công nợ
   riêng — lọc "đang nợ", "nợ quá hạn", "vượt hạn mức" ngay trên danh mục. */
const FILTERS = [
  { key: '', label: 'Tất cả khách' },
  { key: 'debt', label: 'Đang nợ' },
  { key: 'overdue', label: 'Nợ quá hạn' },
  { key: 'over_limit', label: 'Vượt hạn mức' },
];

export default function Customers() {
  const { toast } = useApp();
  const [params, setParams] = useSearchParams();
  const filter = FILTERS.some((f) => f.key === params.get('filter')) ? params.get('filter') : '';
  const type = CUSTOMER_TYPES.some((t) => t.key === params.get('type')) ? params.get('type') : '';
  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const { data, busy, error, reload } = useFetch(
    () => api.customers({ q: dq, filter, type, detail: filter ? 1 : '' }), [dq, filter, type]);
  useLiveReload(reload);

  const [editing, setEditing] = useState(null);   // đối tượng hoặc 'new'
  const [deleting, setDeleting] = useState(null);
  const [collecting, setCollecting] = useState(null);
  const [busyAction, setBusyAction] = useState(false);

  const totals = useMemo(() => {
    if (!data) return null;
    return {
      count: data.length,
      debt: data.reduce((a, c) => a + Math.max(0, c.debt), 0),
      spent: data.reduce((a, c) => a + c.total_spent, 0),
      debtors: data.filter((c) => c.debt > 0).length,
      overdue: data.filter((c) => c.overdue_count > 0).length,
      overLimit: data.filter((c) => c.debt_limit > 0 && c.debt > c.debt_limit).length,
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
    const head = ['Mã KH', 'Tên khách hàng', 'Loại khách', 'Điện thoại', 'Địa chỉ', 'Bảng giá', 'Số đơn', 'Tổng mua',
      'Đang nợ', 'Hạn mức nợ', 'Số ngày nợ tối đa', ...(filter ? ['HĐ chưa trả', 'Nợ lâu nhất (ngày)', 'HĐ quá hạn'] : [])];
    const rows = data.map((c) => [
      c.code, c.name, CUSTOMER_TYPES.find((t) => t.key === c.customer_type)?.label || 'Thành viên',
      c.phone || '', c.address || '', c.price_list_name || 'Giá lẻ',
      c.order_count, c.total_spent, c.debt, c.debt_limit, c.max_debt_days ?? 'Theo tiệm',
      ...(filter ? [c.unpaid_bills ?? '', c.oldest_days ?? '', c.overdue_count ?? ''] : []),
    ]);
    const csv = '﻿' + [head, ...rows]
      .map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filter ? `khachhang-${filter}.csv` : 'khachhang.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const emptyText = {
    debt: 'Không có khách nào đang nợ.',
    overdue: 'Không có khách nào nợ quá hạn.',
    over_limit: 'Không có khách nào vượt hạn mức nợ.',
  }[filter];

  return (
    <>
      <PageHeader
        title="Khách hàng"
        subtitle={totals ? `${n(totals.count)} khách · ${n(totals.debtors)} đang nợ · tổng nợ ${money(totals.debt)}` : ''}
        actions={<>
          <Button icon={Download} onClick={exportCsv} disabled={!data?.length}>Xuất Excel</Button>
          <Button variant="primary" icon={UserPlus} onClick={() => setEditing('new')}>
            Thêm khách hàng
          </Button>
        </>}
      >
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Tìm tên, số điện thoại, mã khách..."
            className="w-full sm:w-72"
          />
          <div className="flex rounded-lg border border-line overflow-hidden" role="radiogroup" aria-label="Lọc theo công nợ">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={filter === f.key}
                onClick={() => setParam('filter', f.key)}
                className={`px-2.5 h-9 text-[13px] font-semibold whitespace-nowrap cursor-pointer transition-colors duration-150
                            ${filter === f.key ? 'bg-primary text-white' : 'bg-card hover:bg-muted'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label htmlFor="cust-type" className="sr-only">Loại khách</label>
          <select
            id="cust-type"
            className="input !w-auto h-9"
            value={type}
            onChange={(e) => setParam('type', e.target.value)}
          >
            <option value="">Mọi loại khách</option>
            {CUSTOMER_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
      </PageHeader>

      <Page className="space-y-3">
        {totals && (
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
            <Stat label="Số khách" value={n(totals.count)} icon={Users} />
            <Stat label="Tổng công nợ" value={short(totals.debt)} tone="warn" icon={HandCoins}
              sub={`${n(totals.debtors)} khách đang nợ`} onClick={() => setParam('filter', 'debt')} />
            {filter
              ? <Stat label="Nợ quá hạn" value={n(totals.overdue)} tone={totals.overdue > 0 ? 'bad' : 'default'}
                  icon={Clock} sub="khách có hoá đơn quá số ngày nợ" onClick={() => setParam('filter', 'overdue')} />
              : <Stat label="Tổng đã mua" value={short(totals.spent)} tone="good" icon={TrendingUp} />}
            <Stat label="Vượt hạn mức" value={n(totals.overLimit)} tone={totals.overLimit > 0 ? 'bad' : 'default'}
              icon={AlertTriangle} onClick={() => setParam('filter', 'over_limit')} />
          </div>
        )}

        {busy && !data ? <Spinner />
          : error ? <ErrorBox error={error} onRetry={reload} />
            : !data?.length ? (
              <Empty
                icon={Users}
                title={filter ? emptyText : 'Chưa có khách hàng nào'}
                message={q ? `Không tìm thấy khách khớp "${q}".` : filter ? '' : 'Thêm khách quen để theo dõi công nợ và lịch sử mua hàng.'}
                action={!filter && <Button variant="primary" icon={UserPlus} onClick={() => setEditing('new')}>Thêm khách hàng</Button>}
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Mã</th>
                      <th>Tên khách hàng</th>
                      <th>Điện thoại</th>
                      <th>Loại</th>
                      <th className="text-right">Số đơn</th>
                      <th className="text-right">Tổng mua</th>
                      <th className="text-right">Đang nợ</th>
                      {filter && <th>Nợ lâu nhất</th>}
                      <th>Mua gần nhất</th>
                      <th className="text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((c) => {
                      const overLimit = c.debt_limit > 0 && c.debt > c.debt_limit;
                      return (
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
                          <td><CustomerTypeBadge type={c.customer_type} /></td>
                          <td className="num">{c.order_count}</td>
                          <td className="num">{money(c.total_spent)}</td>
                          <td className="num">
                            {c.debt > 0
                              ? <div className="flex flex-col items-end gap-0.5">
                                  <span className={`font-semibold ${overLimit ? 'text-danger' : 'text-warn'}`}>{money(c.debt)}</span>
                                  {overLimit && <Badge tone="bad">Vượt hạn mức</Badge>}
                                  {c.overdue_count > 0 && <Badge tone="bad">{c.overdue_count} HĐ quá hạn</Badge>}
                                </div>
                              : <span className="text-muted-ink">—</span>}
                          </td>
                          {filter && (
                            <td className="whitespace-nowrap">
                              {c.oldest_unpaid
                                ? <span className={c.overdue_count > 0 ? 'text-danger font-semibold' : 'text-muted-ink'}>
                                    {date(c.oldest_unpaid)} ({c.oldest_days} ngày)
                                  </span>
                                : <span className="text-muted-ink">—</span>}
                            </td>
                          )}
                          <td className="text-muted-ink whitespace-nowrap">{c.last_order ? smartTime(c.last_order) : '—'}</td>
                          <td>
                            <div className="flex items-center justify-end gap-0.5">
                              {c.debt > 0 && (
                                <IconButton
                                  icon={HandCoins}
                                  label={`Thu nợ của ${c.name}`}
                                  size={14}
                                  className="!text-warn"
                                  onClick={() => setCollecting(c)}
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
                      );
                    })}
                  </tbody>
                  {filter && (
                    <tfoot>
                      <tr>
                        <td colSpan={6} className="text-right">TỔNG CỘNG PHẢI THU</td>
                        <td className="num text-warn">{money(totals.debt)}</td>
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  )}
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

      {/* Thu nợ dùng chung sổ phụ công nợ của màn hình bán hàng (tài liệu 05) */}
      {collecting && (
        <DebtCollectModal
          open
          customerId={collecting.id}
          onClose={() => setCollecting(null)}
          onDone={() => reload()}
        />
      )}

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
/* Hộp thu / trả nợ đơn giản — giữ lại cho màn hình cũ còn gọi tới        */
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
/* Trang hồ sơ một khách hàng — cùng hồ sơ ba tab với màn hình bán hàng   */
/* ==================================================================== */

const PROFILE_TABS = ['info', 'history', 'debt'];

export function CustomerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { toast } = useApp();
  const [customer, setCustomer] = useState(null);
  const [editing, setEditing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const initialTab = PROFILE_TABS.includes(params.get('tab')) ? params.get('tab') : 'info';

  return (
    <>
      <PageHeader
        title={customer?.name || 'Khách hàng'}
        subtitle="Hồ sơ khách hàng · lịch sử mua hàng · công nợ"
        actions={<>
          <Button icon={ArrowLeft} onClick={() => nav('/customers')}>Danh sách khách</Button>
          <Button icon={Pencil} onClick={() => setEditing(true)} disabled={!customer}>Sửa thông tin</Button>
        </>}
      />

      <Page>
        <CustomerProfile
          customerId={Number(id)}
          initialTab={initialTab}
          reloadKey={reloadKey}
          onLoaded={setCustomer}
        />
      </Page>

      <CustomerForm
        open={editing}
        customer={customer}
        onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); setReloadKey((k) => k + 1); toast('Đã lưu thay đổi', 'ok'); }}
      />
    </>
  );
}
