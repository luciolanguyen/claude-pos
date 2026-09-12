import { useState, useMemo, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import {
  Wallet, Plus, Minus, ArrowLeftRight, Download, Trash2, Landmark,
  TrendingUp, TrendingDown, Banknote, Printer,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, usePaged, useDebounced, fetchAllPages } from '../lib/store';
import { money, n, short, datetime, date, range, RANGES, CASH_LABEL, match, matchCustomer } from '../lib/format';
import {
  Button, IconButton, SearchInput, Select, Modal, Spinner, Empty, ErrorBox, Badge,
  Confirm, Field, MoneyInput, Textarea, Stat, Input, Combo, Pager,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import CashVoucherPrint from '../components/CashVoucherPrint';

export default function Cash() {
  const { toast, loadMeta, user } = useApp();
  const [rangeKey, setRangeKey] = useState('month');
  const r = useMemo(() => range(rangeKey), [rangeKey]);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [accountId, setAccountId] = useState('');
  const [direction, setDirection] = useState('');
  const [category, setCategory] = useState('');

  const { data: summary, reload: reloadSummary } = useFetch(
    () => api.cashSummary({ from: r.from, to: r.to }), [r.from, r.to]
  );
  const txFilters = useMemo(() => ({
    q: dq, from: r.from, to: r.to, account_id: accountId, direction, category,
  }), [dq, r.from, r.to, accountId, direction, category]);

  const {
    extra: txData, total: rowCount, busy, error, reload,
    page, setPage, pageSize, setPageSize,
  } = usePaged((pg) => api.cashTransactions({ ...txFilters, ...pg }), [txFilters], { key: 'cash' });
  const { data: cats } = useFetch(() => api.cashCategories(), []);

  const [creating, setCreating] = useState(null); // 'in' | 'out'
  const [transferring, setTransferring] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [voucher, setVoucher] = useState(null);   // phiếu đang mở để in

  /* Lấy tờ phiếu đầy đủ rồi mở hộp in. Dòng trong sổ quỹ không có sẵn
     địa chỉ người nộp và tên người lập, mà tờ phiếu thì cần. */
  const openVoucher = async (id) => {
    try {
      setVoucher(await api.get(`/cash/transactions/${id}`));
    } catch (e) {
      toast(e.message, 'bad', 6000);
    }
  };
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [busyAction, setBusyAction] = useState(false);

  const reloadAll = () => { reload(); reloadSummary(); loadMeta(); };

  const doDelete = async () => {
    setBusyAction(true);
    try {
      await api.del(`/cash/transactions/${deleting.id}`);
      toast('Đã xoá phiếu', 'ok');
      setDeleting(null);
      reloadAll();
    } catch (e) {
      toast(e.message, 'bad', 6000);
    } finally {
      setBusyAction(false);
    }
  };

  const exportCsv = async () => {
    if (!rowCount) return;
    const allRows = await fetchAllPages((pg) => api.cashTransactions({ ...txFilters, ...pg }));
    const head = ['Mã phiếu', 'Ngày', 'Quỹ', 'Loại', 'Nội dung', 'Đối tượng', 'Thu', 'Chi', 'Chứng từ', 'Diễn giải'];
    const csv = '﻿' + [head, ...allRows.map((t) => [
      t.code, datetime(t.ts), t.account_name,
      t.direction === 'in' ? 'Thu' : 'Chi',
      CASH_LABEL[t.category] || t.category,
      t.partner_name || '',
      t.direction === 'in' ? t.amount : '',
      t.direction === 'out' ? t.amount : '',
      t.ref_code || '', t.note || '',
    ])].map((row) => row.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `soquy-${r.from}-${r.to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const chartDaily = (summary?.daily || []).map((d) => ({
    day: date(d.day).slice(0, 5),
    'Thu': d.tin,
    'Chi': d.tout,
  }));

  return (
    <>
      <PageHeader
        title="Quỹ tiền"
        subtitle={`${r.label} · ${date(r.from)} — ${date(r.to)}`}
        actions={<>
          <Button icon={Landmark} onClick={() => setAccountsOpen(true)}>Quản lý quỹ</Button>
          <Button icon={ArrowLeftRight} onClick={() => setTransferring(true)}>Chuyển quỹ</Button>
          <Button icon={Minus} onClick={() => setCreating('out')}>Lập phiếu chi</Button>
          <Button variant="primary" icon={Plus} onClick={() => setCreating('in')}>Lập phiếu thu</Button>
        </>}
      >
        <div className="flex flex-wrap gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Tìm mã phiếu, đối tượng, diễn giải..." className="w-full sm:w-72" />
          <Select value={rangeKey} onChange={(e) => setRangeKey(e.target.value)} size="sm" className="!w-auto">
            {RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} size="sm" className="!w-auto">
            <option value="">Tất cả quỹ</option>
            {(summary?.accounts || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Select value={direction} onChange={(e) => setDirection(e.target.value)} size="sm" className="!w-auto">
            <option value="">Thu và chi</option>
            <option value="in">Chỉ phiếu thu</option>
            <option value="out">Chỉ phiếu chi</option>
          </Select>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} size="sm" className="!w-auto">
            <option value="">Mọi loại thu chi</option>
            {Object.entries(CASH_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </div>
      </PageHeader>

      <Page className="space-y-3">
        {/* Số dư từng quỹ */}
        {summary && (
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Tổng số dư tất cả quỹ"
              value={short(summary.total_balance)}
              tone={summary.total_balance < 0 ? 'bad' : 'good'}
              icon={Wallet}
              sub={`${summary.accounts.length} quỹ đang hoạt động`}
            />
            <Stat label={`Tổng thu ${r.label.toLowerCase()}`} value={short(summary.total_in)} tone="good" icon={TrendingUp} />
            <Stat label={`Tổng chi ${r.label.toLowerCase()}`} value={short(summary.total_out)} tone="bad" icon={TrendingDown} />
            <Stat
              label="Chênh lệch thu chi"
              value={short(summary.net)}
              tone={summary.net >= 0 ? 'good' : 'bad'}
            />
          </div>
        )}

        {summary?.accounts?.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {summary.accounts.map((a) => (
              <div key={a.id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-[13px] truncate">{a.name}</div>
                    <div className="text-2xs text-muted-ink">
                      {a.type === 'cash' ? 'Tiền mặt' : a.type === 'bank' ? a.bank_name || 'Ngân hàng' : 'Ví điện tử'}
                      {a.account_no && ` · ${a.account_no}`}
                    </div>
                  </div>
                  {a.type === 'cash'
                    ? <Banknote size={16} className="text-muted-ink shrink-0" aria-hidden="true" />
                    : <Landmark size={16} className="text-muted-ink shrink-0" aria-hidden="true" />}
                </div>
                <div className={`font-display text-xl font-bold tabular mt-1.5 ${a.balance < 0 ? 'text-danger' : ''}`}>
                  {money(a.balance)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Biểu đồ dòng tiền */}
        {chartDaily.length > 1 && (
          <div className="card">
            <div className="px-3 py-2.5 border-b border-line">
              <h2 className="text-[13px] font-bold">Dòng tiền theo ngày</h2>
              <p className="text-2xs text-muted-ink mt-0.5">Cột xanh là tiền thu vào, cột cam là tiền chi ra</p>
            </div>
            <div className="p-2" style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartDaily} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#475569' }} tickLine={false}
                    axisLine={{ stroke: '#E2E8F0' }} interval="preserveStartEnd" />
                  <YAxis tickFormatter={short} tick={{ fontSize: 10, fill: '#475569' }} tickLine={false} axisLine={false} width={48} />
                  <Tooltip
                    formatter={(v) => money(v)}
                    contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #E2E8F0' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Thu" fill="#047857" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Chi" fill="#B45309" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Sổ quỹ */}
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-bold">
            Sổ quỹ
            {txData?.rows && <span className="text-muted-ink font-normal ml-1.5">({n(rowCount)} phiếu)</span>}
          </h2>
          <Button size="sm" icon={Download} onClick={exportCsv} disabled={!rowCount}>Xuất Excel</Button>
        </div>

        {busy && !txData ? <Spinner />
          : error ? <ErrorBox error={error} onRetry={reload} />
            : !txData?.rows?.length ? (
              <Empty
                icon={Wallet}
                title="Không có phiếu thu chi nào"
                message="Thử đổi khoảng thời gian hoặc bỏ bớt bộ lọc."
              />
            ) : (
              <div className="card">
              <div className="table-wrap table-scroll !border-0 !rounded-none">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Mã phiếu</th><th>Thời gian</th><th>Quỹ</th><th>Nội dung</th><th>Đối tượng</th>
                      <th className="text-right">Thu</th>
                      <th className="text-right">Chi</th>
                      <th>Chứng từ</th>
                      <th className="text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txData.rows.map((t) => (
                      <tr key={t.id} className="hoverable">
                        <td className="font-mono font-semibold">{t.code}</td>
                        <td className="text-muted-ink whitespace-nowrap">{datetime(t.ts)}</td>
                        <td className="text-muted-ink truncate max-w-[130px]">{t.account_name}</td>
                        <td>
                          <Badge tone={t.direction === 'in' ? 'ok' : 'bad'}>
                            {CASH_LABEL[t.category] || t.category}
                          </Badge>
                          {t.note && <div className="text-2xs text-muted-ink truncate max-w-[240px] mt-0.5">{t.note}</div>}
                        </td>
                        <td className="truncate max-w-[150px]">{t.partner_name || '—'}</td>
                        <td className="num font-semibold text-emerald-700">
                          {t.direction === 'in' ? money(t.amount) : ''}
                        </td>
                        <td className="num font-semibold text-danger">
                          {t.direction === 'out' ? money(t.amount) : ''}
                        </td>
                        <td className="font-mono text-2xs text-muted-ink">{t.ref_code || '—'}</td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            <IconButton
                              icon={Printer}
                              size={14}
                              label={`In ${t.direction === 'in' ? 'phiếu thu' : 'phiếu chi'} ${t.code}`}
                              onClick={() => openVoucher(t.id)}
                            />
                            {/* Phiếu thu nợ đã xác nhận: chỉ chủ cửa hàng xoá được (tài liệu 05) — máy chủ cũng chặn */}
                            {!t.ref_type && (t.category !== 'debt_in' || user?.role === 'owner') && (
                              <IconButton icon={Trash2} label={`Xoá phiếu ${t.code}`} size={14}
                                className="!text-danger hover:!bg-red-50" onClick={() => setDeleting(t)} />
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5} className="text-right">TỔNG CỘNG</td>
                      <td className="num text-emerald-700">{money(txData.total_in)}</td>
                      <td className="num text-danger">{money(txData.total_out)}</td>
                      <td colSpan={2} className="num">
                        Chênh lệch: <span className={txData.net >= 0 ? 'text-emerald-700' : 'text-danger'}>
                          {money(txData.net)}
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <Pager
                page={page}
                pageSize={pageSize}
                total={rowCount}
                onPage={setPage}
                onPageSize={setPageSize}
              />
              </div>
            )}
      </Page>

      <CashTxForm
        direction={creating}
        categories={cats}
        accounts={summary?.accounts || []}
        onClose={() => setCreating(null)}
        onSaved={() => { setCreating(null); reloadAll(); toast('Đã lưu phiếu', 'ok'); }}
      />

      <TransferFundsModal
        open={transferring}
        accounts={summary?.accounts || []}
        onClose={() => setTransferring(false)}
        onDone={() => { setTransferring(false); reloadAll(); toast('Đã chuyển quỹ', 'ok'); }}
      />

      <AccountManager
        open={accountsOpen}
        onClose={() => { setAccountsOpen(false); reloadAll(); }}
      />

      {voucher && <CashVoucherPrint voucher={voucher} onClose={() => setVoucher(null)} />}

      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={doDelete}
        busy={busyAction}
        title="Xoá phiếu thu chi?"
        confirmText="Xoá phiếu"
        message={deleting && (
          <>Xoá phiếu <b className="font-mono">{deleting.code}</b> trị giá <b>{money(deleting.amount)}</b>?
            Số dư quỹ sẽ thay đổi tương ứng.</>
        )}
      />
    </>
  );
}

/* -------------------------------------------------------------------- */

function CashTxForm({ direction, categories, accounts, onClose, onSaved }) {
  const { user } = useApp();
  const [amount, setAmount] = useState(0);
  const [accountId, setAccountId] = useState('');
  const [category, setCategory] = useState('');
  const [partnerType, setPartnerType] = useState('');
  const [partnerId, setPartnerId] = useState(null);
  const [partnerName, setPartnerName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const isIn = direction === 'in';
  const { data: customers } = useFetch(() => api.customers({ active: 1 }), [], { skip: partnerType !== 'customer' });
  const { data: suppliers } = useFetch(() => api.suppliers({ active: 1 }), [], { skip: partnerType !== 'supplier' });

  useEffect(() => {
    if (!direction) return;
    setAmount(0);
    setAccountId(accounts[0]?.id || '');
    setCategory(isIn ? 'other_in' : 'other_out');
    setPartnerType(''); setPartnerId(null); setPartnerName('');
    setNote(''); setErr('');
  }, [direction, accounts, isIn]);

  const list = direction ? (categories?.[direction] || []) : [];

  const submit = async () => {
    if (amount <= 0) { setErr('Số tiền phải lớn hơn 0.'); return; }
    setBusy(true);
    setErr('');
    try {
      await api.post('/cash/transactions', {
        direction, amount, account_id: accountId, category,
        partner_type: partnerType || null,
        partner_id: partnerId,
        partner_name: partnerType === 'other' ? partnerName : null,
        user_id: user?.id, note,
      });
      onSaved?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!direction}
      onClose={onClose}
      title={isIn ? 'Lập phiếu thu' : 'Lập phiếu chi'}
      subtitle={isIn ? 'Ghi nhận tiền thu vào quỹ' : 'Ghi nhận tiền chi ra khỏi quỹ'}
      size="sm"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant={isIn ? 'primary' : 'danger'} onClick={submit} loading={busy}>
          {isIn ? 'Lưu phiếu thu' : 'Lưu phiếu chi'}
        </Button>
      </>}
    >
      <div className="space-y-3">
        <Field label="Số tiền" required htmlFor="ct-amount">
          <MoneyInput id="ct-amount" size="lg" value={amount} onChange={setAmount} autoFocus />
        </Field>

        <Field label={isIn ? 'Nộp vào quỹ' : 'Chi từ quỹ'} required htmlFor="ct-acc">
          <Select id="ct-acc" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} — số dư {money(a.balance)}</option>
            ))}
          </Select>
        </Field>

        <Field label="Nội dung thu chi" required htmlFor="ct-cat">
          <Select id="ct-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {list.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </Select>
        </Field>

        <Field label="Đối tượng liên quan" hint="Bỏ trống nếu không gắn với khách hay NCC cụ thể" htmlFor="ct-ptype">
          <Select id="ct-ptype" value={partnerType}
            onChange={(e) => { setPartnerType(e.target.value); setPartnerId(null); setPartnerName(''); }}>
            <option value="">— Không có —</option>
            <option value="customer">Khách hàng</option>
            <option value="supplier">Nhà cung cấp</option>
            <option value="staff">Nhân viên</option>
            <option value="other">Khác (tự nhập tên)</option>
          </Select>
        </Field>

        {partnerType === 'customer' && (
          <Combo
            items={customers || []}
            value={partnerId}
            onChange={setPartnerId}
            placeholder="Chọn khách hàng..."
            filter={matchCustomer}
            render={(c) => ({ label: c.name, sub: c.phone })}
          />
        )}
        {partnerType === 'supplier' && (
          <Combo
            items={suppliers || []}
            value={partnerId}
            onChange={setPartnerId}
            placeholder="Chọn nhà cung cấp..."
            filter={(s, q) => match(s.name, q) || (s.phone || '').includes(q)}
            render={(s) => ({ label: s.name, sub: s.phone })}
          />
        )}
        {(partnerType === 'other' || partnerType === 'staff') && (
          <Input value={partnerName} onChange={(e) => setPartnerName(e.target.value)}
            placeholder="Tên người nhận / người nộp" aria-label="Tên đối tượng" />
        )}

        <Field label="Diễn giải" htmlFor="ct-note">
          <Textarea id="ct-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={isIn ? 'Ví dụ: thu tiền cho thuê mặt bằng phụ' : 'Ví dụ: mua văn phòng phẩm, sửa xe giao hàng'} />
        </Field>

        {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------- */

function TransferFundsModal({ open, accounts, onClose, onDone }) {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setFromId(accounts[0]?.id || '');
    setToId(accounts[1]?.id || '');
    setAmount(0); setNote(''); setErr('');
  }, [open, accounts]);

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.post('/cash/transfer', {
        from_account_id: fromId, to_account_id: toId, amount, note,
      });
      onDone?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Chuyển tiền giữa các quỹ"
      subtitle="Ví dụ: nộp tiền mặt cuối ngày vào tài khoản ngân hàng"
      size="sm"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={submit} loading={busy}>Chuyển tiền</Button>
      </>}
    >
      <div className="space-y-3">
        <Field label="Chuyển từ quỹ" required>
          <Select value={fromId} onChange={(e) => setFromId(Number(e.target.value))}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} — số dư {money(a.balance)}</option>)}
          </Select>
        </Field>
        <Field label="Chuyển đến quỹ" required>
          <Select value={toId} onChange={(e) => setToId(Number(e.target.value))}>
            {accounts.filter((a) => a.id !== Number(fromId)).map((a) => (
              <option key={a.id} value={a.id}>{a.name} — số dư {money(a.balance)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Số tiền" required>
          <MoneyInput size="lg" value={amount} onChange={setAmount} />
        </Field>
        <Field label="Ghi chú">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------- */

function AccountManager({ open, onClose }) {
  const { toast } = useApp();
  const { data, busy, reload } = useFetch(() => api.cashAccounts(), [], { skip: !open });
  const [editing, setEditing] = useState(null);

  const remove = async (a) => {
    try {
      const res = await api.del(`/cash/accounts/${a.id}`);
      toast(res.message || `Đã xoá quỹ ${a.name}`, res.deactivated ? 'warn' : 'ok', 5000);
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Quản lý quỹ tiền"
        subtitle="Tiền mặt tại quầy, tài khoản ngân hàng, ví điện tử"
        size="md"
        footer={<>
          <Button icon={Plus} onClick={() => setEditing('new')}>Thêm quỹ</Button>
          <div className="flex-1" />
          <Button variant="primary" onClick={onClose}>Xong</Button>
        </>}
      >
        {busy ? <Spinner />
          : !data?.length ? <Empty icon={Wallet} title="Chưa có quỹ nào" />
            : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Mã</th><th>Tên quỹ</th><th>Loại</th>
                      <th className="text-right">Số dư đầu</th>
                      <th className="text-right">Số dư hiện tại</th>
                      <th className="text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((a) => (
                      <tr key={a.id} className="hoverable">
                        <td className="font-mono text-muted-ink">{a.code}</td>
                        <td>
                          <div className="font-semibold">{a.name}</div>
                          {a.bank_name && <div className="text-2xs text-muted-ink">{a.bank_name} · {a.account_no}</div>}
                        </td>
                        <td>
                          <Badge tone={a.type === 'cash' ? 'ok' : 'info'}>
                            {a.type === 'cash' ? 'Tiền mặt' : a.type === 'bank' ? 'Ngân hàng' : 'Ví điện tử'}
                          </Badge>
                        </td>
                        <td className="num text-muted-ink">{money(a.opening_balance)}</td>
                        <td className={`num font-bold ${a.balance < 0 ? 'text-danger' : ''}`}>{money(a.balance)}</td>
                        <td>
                          <div className="flex items-center justify-end gap-0.5">
                            <IconButton icon={Wallet} label={`Sửa quỹ ${a.name}`} size={14} onClick={() => setEditing(a)} />
                            <IconButton icon={Trash2} label={`Xoá quỹ ${a.name}`} size={14}
                              className="!text-danger hover:!bg-red-50" onClick={() => remove(a)} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </Modal>

      <AccountForm
        account={editing === 'new' ? null : editing}
        open={!!editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); reload(); toast('Đã lưu quỹ tiền', 'ok'); }}
      />
    </>
  );
}

function AccountForm({ open, account, onClose, onSaved }) {
  const [form, setForm] = useState({ code: '', name: '', type: 'cash', bank_name: '', account_no: '', opening_balance: 0, active: 1 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(account
      ? { ...account }
      : { code: '', name: '', type: 'cash', bank_name: '', account_no: '', opening_balance: 0, active: 1 });
    setErr('');
  }, [open, account]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const save = async () => {
    if (!form.name.trim()) { setErr('Bắt buộc nhập tên quỹ.'); return; }
    setBusy(true);
    setErr('');
    try {
      if (account) await api.put(`/cash/accounts/${account.id}`, form);
      else await api.post('/cash/accounts', form);
      onSaved?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={account ? `Sửa quỹ: ${account.name}` : 'Thêm quỹ tiền'}
      size="sm"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={save} loading={busy}>Lưu</Button>
      </>}
    >
      <div className="space-y-3">
        <Field label="Tên quỹ" required>
          <Input value={form.name} onChange={set('name')} placeholder="Ví dụ: Tiền mặt tại quầy" />
        </Field>
        <Field label="Loại quỹ">
          <Select value={form.type} onChange={set('type')}>
            <option value="cash">Tiền mặt</option>
            <option value="bank">Tài khoản ngân hàng</option>
            <option value="ewallet">Ví điện tử (Momo, ZaloPay...)</option>
          </Select>
        </Field>
        {form.type !== 'cash' && (
          <>
            <Field label="Tên ngân hàng / ví">
              <Input value={form.bank_name || ''} onChange={set('bank_name')} placeholder="MB Bank - CN Tiền Giang" />
            </Field>
            <Field label="Số tài khoản">
              <Input value={form.account_no || ''} onChange={set('account_no')} />
            </Field>
          </>
        )}
        <Field label="Số dư đầu kỳ" hint="Số tiền đang có khi bắt đầu dùng phần mềm">
          <MoneyInput value={form.opening_balance} onChange={(v) => setForm((f) => ({ ...f, opening_balance: v }))} />
        </Field>
        {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
      </div>
    </Modal>
  );
}
