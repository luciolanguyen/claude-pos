import { useState, useMemo, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import {
  Wallet, Plus, Minus, ArrowLeftRight, Download, Ban, Trash2, Landmark, Tags,
  TrendingUp, TrendingDown, Banknote, Printer, PencilLine,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, usePaged, useDebounced, fetchAllPages } from '../lib/store';
import { money, n, short, datetime, date, range, RANGES, CASH_LABEL, match, matchCustomer } from '../lib/format';
import {
  Button, IconButton, SearchInput, Select, Modal, Spinner, Empty, ErrorBox, Badge,
  Field, MoneyInput, Textarea, Stat, Input, Combo, Pager, PermGate,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import CashVoucherPrint from '../components/CashVoucherPrint';

/* Ngày hôm nay theo giờ máy, dạng 2026-09-30 — dùng cho ô ngày trên phiếu */
const today = () => new Date().toLocaleDateString('sv-SE');

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
  const [cancelling, setCancelling] = useState(null);   // phiếu đang huỷ
  const [editing, setEditing] = useState(null);         // phiếu đang sửa
  const [catsOpen, setCatsOpen] = useState(false);
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

  /* Nhãn tiếng Việt của loại thu chi: lấy theo danh mục máy chủ trả về, có gì
     lạ thì mới rơi về bảng nhãn cũ trong máy khách. */
  const catLabel = useMemo(() => {
    const m = new Map();
    for (const dir of ['in', 'out']) for (const c of cats?.[dir] || []) m.set(c.code, c.label);
    return (code) => m.get(code) || CASH_LABEL[code] || code;
  }, [cats]);

  const reloadAll = () => { reload(); reloadSummary(); loadMeta(); };



  const exportCsv = async () => {
    if (!rowCount) return;
    const allRows = await fetchAllPages((pg) => api.cashTransactions({ ...txFilters, ...pg }));
    const head = ['Mã phiếu', 'Ngày', 'Quỹ', 'Loại', 'Nội dung', 'Đối tượng', 'Thu', 'Chi',
      'Chứng từ', 'Diễn giải', 'Số dư sau phiếu', 'Tình trạng'];
    /* Kèm tồn đầu kỳ và tồn cuối kỳ như sổ quỹ giấy — mở Excel ra là dò lại được */
    const openRow = txData?.ledger_mode
      ? [['', date(r.from), '', '', 'TỒN ĐẦU KỲ', '', '', '', '', '', txData.opening, '']] : [];
    const closeRow = txData?.ledger_mode
      ? [['', date(r.to), '', '', 'TỒN CUỐI KỲ', '', '', '', '', '', txData.closing, '']] : [];
    const csv = '﻿' + [head, ...openRow, ...allRows.map((t) => [
      t.code, datetime(t.ts), t.account_name,
      t.direction === 'in' ? 'Thu' : 'Chi',
      t.category_label || catLabel(t.category),
      t.partner_name || '',
      t.direction === 'in' ? t.amount : '',
      t.direction === 'out' ? t.amount : '',
      t.ref_code || '', t.note || '',
      t.balance ?? '',
      t.cancelled_at ? `Đã huỵ: ${t.cancel_reason || ''}` : '',
    ]), ...closeRow].map((row) => row.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
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
          <Button icon={Tags} onClick={() => setCatsOpen(true)}>Loại thu chi</Button>
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
            {['in', 'out'].map((dir) => (cats?.[dir] || []).map((c) => (
              <option key={c.code} value={c.code}>{dir === 'in' ? 'Thu' : 'Chi'}: {c.label}</option>
            )))}
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
            {/* Chuyển quỹ không phải thu, không phải chi: nộp tiền mặt vào ngân hàng
                mà tính cả hai đầu thì hai con số này phồng lên gấp đôi (soát quỹ 30/09) */}
            <Stat label={`Tổng thu ${r.label.toLowerCase()}`} value={short(summary.total_in)} tone="good" icon={TrendingUp}
              sub={summary.total_transfer > 0 ? `chưa kể ${short(summary.total_transfer)} chuyển quỹ` : 'không kể chuyển quỹ'} />
            <Stat label={`Tổng chi ${r.label.toLowerCase()}`} value={short(summary.total_out)} tone="bad" icon={TrendingDown}
              sub={summary.total_transfer > 0 ? `chưa kể ${short(summary.total_transfer)} chuyển quỹ` : 'không kể chuyển quỹ'} />
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
          <PermGate perm="data.export">
            <Button size="sm" icon={Download} onClick={exportCsv} disabled={!rowCount}>Xuất Excel</Button>
          </PermGate>
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
                      {txData.ledger_mode && <th className="text-right">Số dư</th>}
                      <th>Chứng từ</th>
                      <th className="text-right">Thao tác</th>
                    </tr>
                    {/* Sổ quỹ đọc như sổ tay: tồn đầu kỳ ở trên, tồn cuối kỳ ở dưới */}
                    {txData.ledger_mode && (
                      <tr className="bg-muted/60">
                        <td colSpan={5} className="font-semibold">TỒN ĐẦU KỲ ({date(r.from)})</td>
                        <td colSpan={2} />
                        <td className="num font-bold">{money(txData.opening)}</td>
                        <td colSpan={2} />
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {txData.rows.map((t) => {
                      const off = !!t.cancelled_at;
                      /* Phiếu sinh từ chứng từ khác thì huỷ chứng từ gốc. Riêng cặp
                         chuyển quỹ thì huỷ được — huỷ một chân là chân kia huỷ theo. */
                      const canCancel = !off
                        && (!t.ref_type || t.ref_type === 'cash_transfer')
                        && (t.category !== 'debt_in' || user?.role === 'owner');
                      return (
                      <tr key={t.id} className={`hoverable ${off ? 'opacity-60' : ''}`}>
                        <td className={`font-mono font-semibold ${off ? 'line-through' : ''}`}>{t.code}</td>
                        <td className="text-muted-ink whitespace-nowrap">{datetime(t.ts)}</td>
                        <td className="text-muted-ink truncate max-w-[130px]">{t.account_name}</td>
                        <td>
                          <div className="flex items-center gap-1">
                            <Badge tone={off ? 'mute' : t.direction === 'in' ? 'ok' : 'bad'}>
                              {t.category_label || catLabel(t.category)}
                            </Badge>
                            {off && <Badge tone="bad">Đã huỷ</Badge>}
                          </div>
                          {t.note && <div className="text-2xs text-muted-ink truncate max-w-[240px] mt-0.5">{t.note}</div>}
                          {off && (
                            <div className="text-2xs text-danger truncate max-w-[240px]">
                              {t.cancel_reason}{t.cancelled_by_name ? ` · ${t.cancelled_by_name}` : ''}
                            </div>
                          )}
                        </td>
                        <td className="truncate max-w-[150px]">{t.partner_name || '—'}</td>
                        <td className={`num font-semibold ${off ? 'text-muted-ink line-through' : 'text-emerald-700'}`}>
                          {t.direction === 'in' ? money(t.amount) : ''}
                        </td>
                        <td className={`num font-semibold ${off ? 'text-muted-ink line-through' : 'text-danger'}`}>
                          {t.direction === 'out' ? money(t.amount) : ''}
                        </td>
                        {txData.ledger_mode && (
                          <td className="num text-muted-ink">{t.balance == null ? '—' : money(t.balance)}</td>
                        )}
                        <td className="font-mono text-2xs text-muted-ink">{t.ref_code || '—'}</td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            <IconButton
                              icon={Printer}
                              size={14}
                              label={`In ${t.direction === 'in' ? 'phiếu thu' : 'phiếu chi'} ${t.code}`}
                              onClick={() => openVoucher(t.id)}
                            />
                            {!off && (
                              <IconButton icon={PencilLine} size={14} label={`Sửa phiếu ${t.code}`}
                                onClick={() => setEditing(t)} />
                            )}
                            {canCancel && (
                              <IconButton icon={Ban} label={`Huỷ phiếu ${t.code}`} size={14}
                                className="!text-danger hover:!bg-red-50" onClick={() => setCancelling(t)} />
                            )}
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5} className="text-right">
                        TỔNG PHÁT SINH
                        <div className="text-2xs font-normal text-muted-ink">
                          không kể phiếu đã huỷ và tiền chuyển quỹ
                        </div>
                      </td>
                      <td className="num text-emerald-700">{money(txData.total_in)}</td>
                      <td className="num text-danger">{money(txData.total_out)}</td>
                      <td colSpan={txData.ledger_mode ? 3 : 2} className="num">
                        Chênh lệch: <span className={txData.net >= 0 ? 'text-emerald-700' : 'text-danger'}>
                          {money(txData.net)}
                        </span>
                      </td>
                    </tr>
                    {txData.ledger_mode && (
                      <tr className="bg-muted/60">
                        <td colSpan={5} className="text-right font-bold">TỒN CUỐI KỲ ({date(r.to)})</td>
                        <td colSpan={2} />
                        <td className="num font-bold">{money(txData.closing)}</td>
                        <td colSpan={2} />
                      </tr>
                    )}
                    {txData.total_transfer > 0 && (
                      <tr>
                        <td colSpan={txData.ledger_mode ? 10 : 9} className="text-2xs text-muted-ink">
                          Trong kỳ có {money(txData.total_transfer)} chuyển giữa các quỹ của tiệm — tiền vẫn nằm
                          trong nhà nên không tính là thu, cũng không tính là chi.
                        </td>
                      </tr>
                    )}
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

      {cancelling && (
        <CancelTxModal
          tx={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => { setCancelling(null); reloadAll(); }}
        />
      )}

      {editing && (
        <EditTxModal
          tx={editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); reloadAll(); }}
        />
      )}

      <CategoryManager open={catsOpen} onClose={() => setCatsOpen(false)} onSaved={reloadAll} />
    </>
  );
}

/* -------------------------------------------------------------------- */
/* HUỶ PHIẾU (soát quỹ 30/09)                                           */
/*                                                                      */
/* Trước đây phiếu ghi sai thì XOÁ hẳn: số phiếu đứt quãng mà không ai   */
/* biết vì sao, quỹ lệch cũng không có đường dò. Nay phiếu ở lại trong   */
/* sổ, đóng dấu đã huỷ, ghi rõ ai huỷ và vì sao.                        */
/* -------------------------------------------------------------------- */

function CancelTxModal({ tx: t, onClose, onDone }) {
  const { toast } = useApp();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const isTransfer = t.ref_type === 'cash_transfer';

  const save = async () => {
    if (!reason.trim()) { setErr('Ghi rõ vì sao huỷ phiếu này.'); return; }
    setBusy(true);
    try {
      const out = await api.cancelCashTx(t.id, reason.trim());
      toast(`Đã huỷ ${out.cancelled.join(' và ')}`, 'ok', 5000);
      onDone();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Huỷ phiếu thu chi"
      subtitle={`${t.code} · ${money(t.amount)}`}
      size="sm"
      footer={<>
        <Button onClick={onClose}>Quay lại</Button>
        <Button variant="danger" onClick={save} loading={busy}>Huỷ phiếu</Button>
      </>}
    >
      <div className="space-y-3">
        <p className="text-[13px]">
          Phiếu vẫn nằm trong sổ quỹ với dấu <b>đã huỷ</b>, chỉ không tính vào tiền nữa.
          Số dư quỹ <b>{t.account_name}</b> sẽ đổi {t.direction === 'in' ? '−' : '+'}{money(t.amount)}.
        </p>
        {isTransfer && (
          <p className="text-[13px] text-warn font-semibold bg-amber-50 border border-warn/25 rounded p-2.5">
            Đây là một chân của phiếu chuyển quỹ — huỷ phiếu này thì phiếu đối ứng
            ({t.ref_code}) cũng huỷ theo, nếu không hai quỹ sẽ lệch.
          </p>
        )}
        <Field label="Lý do huỷ" required htmlFor="cx-reason"
          hint="Người sau đọc sổ phải hiểu vì sao — ví dụ: gõ nhầm số tiền, lập trùng phiếu.">
          <Textarea id="cx-reason" rows={2} data-autofocus value={reason}
            onChange={(e) => { setReason(e.target.value); setErr(''); }} />
        </Field>
        {err && <p className="error-text" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------- */
/* SỬA PHIẾU — chỉ diễn giải, đối tượng và ngày                          */
/* -------------------------------------------------------------------- */

function EditTxModal({ tx: t, onClose, onDone }) {
  const { toast } = useApp();
  const [day, setDay] = useState(String(t.ts || '').slice(0, 10));
  const [note, setNote] = useState(t.note || '');
  const [partnerName, setPartnerName] = useState(t.partner_name || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setBusy(true);
    try {
      await api.updateCashTx(t.id, {
        ts: day,
        note,
        /* Đổi tên người nộp / người nhận thì thành đối tượng tự nhập, khỏi lệch
           với hồ sơ khách hay NCC đang gắn */
        ...(partnerName !== (t.partner_name || '') && !t.partner_id
          ? { partner_name: partnerName, partner_type: partnerName ? 'other' : null } : {}),
      });
      toast('Đã sửa phiếu', 'ok');
      onDone();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Sửa phiếu thu chi"
      subtitle={`${t.code} · ${money(t.amount)}`}
      size="sm"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={save} loading={busy}>Lưu</Button>
      </>}
    >
      <div className="space-y-3">
        <p className="text-2xs text-muted-ink">
          Số tiền, quỹ và loại thu chi thì không sửa được — ba thứ đó sai thì huỷ phiếu
          rồi lập lại, để sổ còn dấu vết.
        </p>
        <Field label="Ngày lập phiếu" htmlFor="ex-day">
          <Input id="ex-day" type="date" max={today()} value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        {!t.partner_id && (
          <Field label="Người nộp / người nhận" htmlFor="ex-partner">
            <Input id="ex-partner" value={partnerName} onChange={(e) => setPartnerName(e.target.value)} />
          </Field>
        )}
        <Field label="Diễn giải" htmlFor="ex-note">
          <Textarea id="ex-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {err && <p className="error-text" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------- */
/* DANH MỤC LOẠI THU / CHI                                              */
/*                                                                      */
/* Trước đây nằm cứng trong mã nguồn. Loại hệ thống (chứng từ tự động    */
/* đang dùng) thì đổi được tên, không xoá được.                          */
/* -------------------------------------------------------------------- */

function CategoryManager({ open, onClose, onSaved }) {
  const { toast } = useApp();
  const { data, busy, reload } = useFetch(() => api.cashCategories({ all: 1 }), [], { skip: !open });
  const [dir, setDir] = useState('out');
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);

  const add = async () => {
    if (!label.trim()) return;
    setAdding(true);
    try {
      await api.createCashCategory({ label: label.trim(), direction: dir });
      setLabel('');
      reload();
      onSaved?.();
    } catch (e) { toast(e.message, 'bad', 6000); } finally { setAdding(false); }
  };

  const toggleExpense = async (c) => {
    try {
      await api.updateCashCategory(c.id, { is_expense: !c.is_expense });
      reload();
      onSaved?.();
    } catch (e) { toast(e.message, 'bad', 6000); }
  };

  const remove = async (c) => {
    try {
      const res = await api.deleteCashCategory(c.id);
      toast(res.message || `Đã xoá loại "${c.label}"`, res.deactivated ? 'warn' : 'ok', 5000);
      reload();
      onSaved?.();
    } catch (e) { toast(e.message, 'bad', 6000); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Loại thu chi"
      subtitle="Khai thêm khoản thu, khoản chi của riêng tiệm"
      size="md"
      footer={<Button onClick={onClose}>Đóng</Button>}
    >
      {busy && !data ? <Spinner /> : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2 rounded border border-line p-2.5">
            <Field label="Khai thêm loại" htmlFor="cc-label" className="flex-1 min-w-[180px]">
              <Input id="cc-label" value={label} placeholder="VD: Tiền chợ, thuê kho, sửa xe"
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
            </Field>
            <Select value={dir} onChange={(e) => setDir(e.target.value)} className="!w-28" aria-label="Thu hay chi">
              <option value="out">Khoản chi</option>
              <option value="in">Khoản thu</option>
            </Select>
            <Button icon={Plus} onClick={add} loading={adding} disabled={!label.trim()}>Thêm</Button>
          </div>

          {['out', 'in'].map((d) => (
            <div key={d}>
              <h3 className="text-[13px] font-bold mb-1">{d === 'out' ? 'Các khoản chi' : 'Các khoản thu'}</h3>
              <div className="table-wrap max-h-[40vh]">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Tên loại</th>
                      {d === 'out' && <th className="text-center">Tính vào chi phí</th>}
                      <th className="text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.[d] || []).map((c) => (
                      <tr key={c.id} className={c.active ? '' : 'opacity-55'}>
                        <td>
                          {c.label}
                          {!!c.builtin && <Badge tone="mute" className="ml-1.5">Hệ thống</Badge>}
                          {!c.active && <Badge tone="bad" className="ml-1.5">Đang ẩn</Badge>}
                        </td>
                        {d === 'out' && (
                          <td className="text-center">
                            <input
                              type="checkbox"
                              className="w-4 h-4 accent-emerald-700 cursor-pointer"
                              checked={!!c.is_expense}
                              onChange={() => toggleExpense(c)}
                              aria-label={`"${c.label}" tính vào chi phí khi tính lãi lỗ`}
                            />
                          </td>
                        )}
                        <td className="text-right">
                          {!c.builtin && (
                            <IconButton icon={Ban} size={14} label={`Xoá loại ${c.label}`}
                              className="!text-danger hover:!bg-red-50" onClick={() => remove(c)} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <p className="text-2xs text-muted-ink">
            Cột <b>tính vào chi phí</b> quyết định khoản đó có bị trừ vào lãi khi xem Báo cáo hay không.
            Mua hàng, trả nợ nhà cung cấp, chuyển quỹ, chủ rút vốn thì không phải chi phí.
          </p>
        </div>
      )}
    </Modal>
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
  const [day, setDay] = useState(today());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const isIn = direction === 'in';
  const { data: customers } = useFetch(() => api.customers({ active: 1 }), [], { skip: partnerType !== 'customer' });
  const { data: suppliers } = useFetch(() => api.suppliers({ active: 1 }), [], { skip: partnerType !== 'supplier' });

  /* Dọn form khi ĐỔI loại phiếu (thu / chi) thôi. Trước đây còn nghe theo danh
     sách quỹ, mà danh sách đó tải lại là xoá sạch số đang gõ dở. */
  useEffect(() => {
    if (!direction) return;
    setAmount(0);
    setAccountId((prev) => prev || accounts[0]?.id || '');
    setCategory(direction === 'in' ? 'other_in' : 'other_out');
    setPartnerType(''); setPartnerId(null); setPartnerName('');
    setNote(''); setDay(today()); setErr('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction]);

  /* Quỹ mặc định chỉ điền khi chưa chọn gì */
  useEffect(() => {
    if (direction && !accountId && accounts[0]?.id) setAccountId(accounts[0].id);
  }, [direction, accountId, accounts]);

  const list = direction ? (categories?.[direction] || []) : [];

  const submit = async () => {
    if (amount <= 0) { setErr('Số tiền phải lớn hơn 0.'); return; }
    setBusy(true);
    setErr('');
    try {
      await api.post('/cash/transactions', {
        direction, amount, account_id: accountId, category, ts: day,
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

        <div className="grid grid-cols-2 gap-3">
          <Field label={isIn ? 'Nộp vào quỹ' : 'Chi từ quỹ'} required htmlFor="ct-acc">
            <Select id="ct-acc" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name} — số dư {money(a.balance)}</option>
              ))}
            </Select>
          </Field>
          {/* Chiều qua chi tiền xăng, sáng nay mới ghi — phải ghi được đúng ngày đó */}
          <Field label="Ngày lập phiếu" htmlFor="ct-day" hint="Ghi bù cho hôm trước thì chọn lại ngày">
            <Input id="ct-day" type="date" max={today()} value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
        </div>

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
  const [day, setDay] = useState(today());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  /* Chỉ dọn form lúc MỞ hộp. Trước đây còn nghe theo cả danh sách quỹ, nên quỹ
     vừa tải lại là số tiền đang gõ dở bay sạch. */
  useEffect(() => {
    if (!open) return;
    setFromId(accounts[0]?.id || '');
    setToId(accounts[1]?.id || '');
    setAmount(0); setNote(''); setDay(today()); setErr('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* Đổi quỹ nguồn mà trùng quỹ đích thì ĐẨY quỹ đích sang quỹ khác.

     Lỗi cũ nằm ở đây: danh sách quỹ đích lọc bỏ quỹ nguồn ra, nhưng giá trị đang
     chọn thì không sửa — ô hiện tên quỹ này mà trong bụng vẫn nhớ quỹ kia, bấm
     Chuyển tiền là máy chủ báo "hai quỹ phải khác nhau" dù nhìn rõ ràng khác. */
  const pickFrom = (id) => {
    setFromId(id);
    if (Number(toId) === Number(id)) {
      setToId(accounts.find((a) => Number(a.id) !== Number(id))?.id || '');
    }
  };

  const fromAcc = accounts.find((a) => Number(a.id) === Number(fromId));
  const toAcc = accounts.find((a) => Number(a.id) === Number(toId));

  const submit = async () => {
    if (!fromId || !toId) { setErr('Chọn đủ quỹ chuyển đi và quỹ nhận.'); return; }
    if (Number(fromId) === Number(toId)) { setErr('Quỹ nhận phải khác quỹ chuyển đi.'); return; }
    if (amount <= 0) { setErr('Số tiền phải lớn hơn 0.'); return; }
    if (fromAcc && amount > fromAcc.balance) {
      setErr(`Quỹ "${fromAcc.name}" chỉ còn ${money(fromAcc.balance)}.`);
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await api.post('/cash/transfer', {
        from_account_id: fromId, to_account_id: toId, amount, note, ts: day,
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
        <Field label="Chuyển từ quỹ" required htmlFor="tf-from">
          <Select id="tf-from" value={fromId} onChange={(e) => pickFrom(Number(e.target.value))}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} — số dư {money(a.balance)}</option>)}
          </Select>
        </Field>
        <Field label="Chuyển đến quỹ" required htmlFor="tf-to"
          error={fromId && Number(fromId) === Number(toId) ? 'Phải khác quỹ chuyển đi' : ''}>
          <Select id="tf-to" value={toId} onChange={(e) => setToId(Number(e.target.value))}>
            {/* Giữ đủ mọi quỹ trong danh sách, chỉ khoá quỹ nguồn lại — có thế thì
                ô hiển thị và giá trị bên trong mới luôn là một. */}
            {accounts.map((a) => (
              <option key={a.id} value={a.id} disabled={Number(a.id) === Number(fromId)}>
                {a.name} — số dư {money(a.balance)}
                {Number(a.id) === Number(fromId) ? ' (đang là quỹ chuyển đi)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Số tiền" required htmlFor="tf-amount">
            <MoneyInput id="tf-amount" size="lg" value={amount} onChange={setAmount} />
          </Field>
          <Field label="Ngày chuyển" htmlFor="tf-day" hint="Ghi bù cho hôm trước thì chọn lại ngày">
            <Input id="tf-day" type="date" max={today()} value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
        </div>
        {amount > 0 && fromAcc && toAcc && (
          <p className="text-2xs text-muted-ink">
            Sau khi chuyển: {fromAcc.name} còn <b className="tabular">{money(fromAcc.balance - amount)}</b> ·
            {' '}{toAcc.name} còn <b className="tabular">{money(toAcc.balance + amount)}</b>.
            Tổng tiền của tiệm không đổi.
          </p>
        )}
        <Field label="Ghi chú" htmlFor="tf-note">
          <Textarea id="tf-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
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
