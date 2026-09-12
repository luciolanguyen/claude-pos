/* ====================================================================
   THU NỢ KHÁCH HÀNG NGAY TẠI QUẦY (tài liệu 05)

   Chỉ thu nợ được khi đã chọn một khách cụ thể. Khách lẻ không có công
   nợ, nên nút Thu nợ mờ đi.

   Hộp thu nợ là một SỔ PHỤ CÔNG NỢ thu nhỏ, mới nhất trên cùng:
     - hoá đơn còn nợ (đỏ), tích chọn được để trả đúng hoá đơn đó;
     - các lần trả nợ trước (xanh), kèm hình thức và trả vào hoá đơn nào;
     - đơn trả đủ tại quầy, để khách thắc mắc thì chỉ ngay cho khách xem.

   Không tích hoá đơn nào thì tiền thu trả dần từ khoản cũ nhất (FIFO).
   Phiếu thu đã xác nhận thì thu ngân không sửa, không xoá được — máy chủ
   chặn, chỉ chủ cửa hàng xoá được khi thu nhầm.
   ==================================================================== */
import { useState, useEffect, useMemo } from 'react';
import {
  HandCoins, AlertTriangle, CheckCircle2, Wallet, CreditCard, Printer, Lock, Users,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, useDebounced } from '../lib/store';
import { money, n, date, match } from '../lib/format';
import {
  Button, Input, Select, Modal, Field, MoneyInput, Empty, Spinner,
  Badge, SearchInput, TotalRow, ErrorBox,
} from './ui';

/* ==================== NÚT THU NỢ TRÊN THANH ĐẦU ==================== */

/**
 * Nút theo khách đang chọn. Khách lẻ thì mờ — không có công nợ để thu.
 * Khách đang nợ thì nút đổi màu và hiện luôn số nợ.
 */
export function DebtButton({ customer, onOpen }) {
  const has = !!customer;
  const debt = customer?.debt || 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!has}
      title={has
        ? (debt > 0 ? `${customer.name} đang nợ ${money(debt)}` : `${customer.name} không còn nợ — vẫn xem được sổ công nợ`)
        : 'Chọn khách hàng đã lưu trước — khách lẻ không có công nợ để thu'}
      aria-label={has ? `Thu nợ ${customer.name}` : 'Thu nợ — cần chọn khách hàng trước'}
      className={`h-9 px-2.5 rounded border text-[13px] font-semibold hidden md:flex items-center gap-1.5
                  transition-colors duration-150
                  ${!has
                    ? 'bg-white/5 border-white/10 text-slate-500 cursor-not-allowed'
                    : debt > 0
                      ? 'bg-amber-500/20 border-amber-400/40 text-amber-200 hover:bg-amber-500/30 cursor-pointer'
                      : 'bg-white/10 border-white/15 text-slate-300 hover:text-white cursor-pointer'}`}
    >
      <HandCoins size={14} aria-hidden="true" />
      Thu nợ
      {debt > 0 && <span className="tabular">{n(debt)}</span>}
    </button>
  );
}

/**
 * Nút thứ hai, luôn hiện (tài liệu 13, mục 3.3): mang nhãn số khách đang nợ
 * và mở thẳng danh sách tất cả khách còn nợ, thu được ngay tại đó mà không
 * phải quay ra chọn khách cho tab đang bán.
 */
export function AllDebtsButton({ customers = [], onOpen }) {
  const owing = customers.filter((c) => Number(c.debt) > 0);
  const total = owing.reduce((a, c) => a + Number(c.debt || 0), 0);
  return (
    <button
      type="button"
      onClick={onOpen}
      title={owing.length
        ? `${owing.length} khách đang nợ, tổng ${money(total)} — bấm để xem và thu`
        : 'Không có khách nào đang nợ'}
      aria-label={`Thu nợ — ${owing.length} khách đang nợ`}
      className={`h-9 px-2.5 rounded border text-[13px] font-semibold hidden lg:flex items-center gap-1.5
                  transition-colors duration-150 cursor-pointer
                  ${owing.length
                    ? 'bg-white/10 border-white/15 text-slate-200 hover:text-white hover:bg-white/20'
                    : 'bg-white/5 border-white/10 text-slate-400'}`}
    >
      <Users size={14} aria-hidden="true" />
      Thu nợ
      <span className="tabular">({n(owing.length)})</span>
    </button>
  );
}

/* ======================= HỘP THU NỢ ================================ */

/**
 * Có customerId thì mở thẳng sổ phụ của khách đó. Không có thì cho chọn
 * khách trong danh sách đang nợ trước.
 */
export function DebtCollectModal({ open, onClose, onDone, customerId = null }) {
  const [picked, setPicked] = useState(customerId);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);

  const { data, busy, error, reload } = useFetch(
    () => api.customerDebts(), [], { skip: !open || !!customerId });

  useEffect(() => {
    if (!open) return;
    setPicked(customerId);
    setQ('');
  }, [open, customerId]);

  const rows = Array.isArray(data) ? data : (data?.rows || []);
  const owing = useMemo(() => {
    let l = rows.filter((c) => c.debt > 0);
    if (dq.trim()) l = l.filter((c) => match(c.name, dq) || (c.phone || '').includes(dq.trim()));
    return l.sort((a, b) => b.debt - a.debt);
  }, [rows, dq]);

  /* Phải kiểm cả open: chỉ xét picked thì lúc đóng hộp nhánh này vẫn dựng
     sổ phụ với <Modal open> cứng, hộp thoại không chịu đóng. */
  if (open && picked) {
    return (
      <DebtLedgerModal
        customerId={picked}
        onBack={customerId ? null : () => setPicked(null)}
        onClose={onClose}
        onDone={(res) => { if (!customerId) reload(); onDone?.(res); }}
      />
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Thu nợ khách hàng"
      subtitle="Chọn khách để xem sổ công nợ rồi thu"
      size="lg"
      footer={<Button onClick={onClose}>Đóng</Button>}
    >
      <div className="space-y-2">
        <SearchInput value={q} onChange={setQ} placeholder="Gõ tên khách hoặc số điện thoại..." autoFocus />
        {busy && !data ? <Spinner />
          : error ? <ErrorBox error={error} onRetry={reload} />
            : owing.length === 0 ? (
              <Empty
                icon={CheckCircle2}
                title={dq ? 'Không tìm thấy khách nào' : 'Không có ai nợ'}
                message={dq ? `Không có khách nợ nào khớp "${q}".` : 'Mọi khách đều đã trả đủ.'}
              />
            ) : (
              <div className="table-wrap max-h-[52vh]">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Khách hàng</th>
                      <th className="text-right">Còn nợ</th>
                      <th className="text-right">Nợ lâu nhất</th>
                      <th style={{ width: 84 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {owing.map((c) => (
                      <tr key={c.id} className="hoverable clickable" onClick={() => setPicked(c.id)}>
                        <td>
                          <div className="font-medium truncate max-w-[14rem]">{c.name}</div>
                          {c.phone && <div className="text-2xs text-muted-ink tabular">{c.phone}</div>}
                        </td>
                        <td className="num font-bold text-danger">{money(c.debt)}</td>
                        <td className="num">
                          {c.oldest_days > 0
                            ? <span className={c.oldest_days > 60 ? 'text-danger font-semibold' : 'text-muted-ink'}>{n(c.oldest_days)} ngày</span>
                            : <span className="text-muted-ink">—</span>}
                        </td>
                        <td className="text-center">
                          <Button size="sm" variant="soft" icon={HandCoins}
                            onClick={(e) => { e.stopPropagation(); setPicked(c.id); }}>
                            Thu
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </div>
    </Modal>
  );
}

/* ----------------------- Sổ phụ và thu tiền ------------------------ */

/** Loại chứng từ trong sổ phụ. */
const KIND = {
  debt_invoice: 'Hoá đơn nợ',
  settled_invoice: 'Hoá đơn nợ',
  paid_invoice: 'Đơn trả đủ tại quầy',
  cod_invoice: 'Đơn giao thu hộ',
  failed_invoice: 'Đơn giao thất bại',
  receipt: 'Phiếu thu nợ',
  refund: 'Phiếu chi trả lại',
  return_offset: 'Trả hàng cấn trừ',
};

/**
 * Xem trước tiền thu sẽ trừ vào đâu — cùng thứ tự với máy chủ (debt.js):
 * hoá đơn đã tích trước, rồi nợ đầu kỳ, rồi hoá đơn cũ nhất.
 */
function previewAllocation(ledger, amount, picked) {
  const out = { rows: [], toOpening: 0, left: Math.max(0, Math.round(amount)) };
  if (!ledger) return out;
  const inv = (ledger.invoices || []).map((i) => ({ ...i }));
  const pay = (i) => {
    if (out.left <= 0 || i.remaining <= 0) return;
    const x = Math.min(out.left, i.remaining);
    out.rows.push({ id: i.id, code: i.code, amount: x });
    i.remaining -= x;
    out.left -= x;
  };
  for (const i of inv) if (picked.has(i.id)) pay(i);
  if (out.left > 0 && ledger.opening_left > 0) {
    out.toOpening = Math.min(out.left, ledger.opening_left);
    out.left -= out.toOpening;
  }
  for (const i of inv) pay(i);
  return out;
}

function DebtLedgerModal({ customerId, onBack, onClose, onDone }) {
  const { user, meta, toast } = useApp();
  const { data: L, busy, error, reload } = useFetch(() => api.customerLedger(customerId), [customerId]);
  const [picked, setPicked] = useState(() => new Set());
  const [amount, setAmount] = useState(0);
  const [touched, setTouched] = useState(false);
  const [method, setMethod] = useState('cash');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [view, setView] = useState('all');
  const [saving, setSaving] = useState(false);

  const debt = Math.max(0, L?.debt || 0);
  const invoices = L?.invoices || [];
  const pickedTotal = useMemo(
    () => invoices.filter((i) => picked.has(i.id)).reduce((a, i) => a + i.remaining, 0),
    [invoices, picked]);

  /* Số tiền thu bám theo lựa chọn cho tới khi thu ngân tự gõ số khác */
  useEffect(() => {
    if (!L || touched) return;
    setAmount(picked.size ? pickedTotal : debt);
  }, [L, picked, pickedTotal, debt, touched]);

  const amt = Math.round(Number(amount) || 0);
  const plan = useMemo(() => previewAllocation(L, amt, picked), [L, amt, picked]);
  const left = Math.max(0, debt - amt);

  const bank = meta.accounts.filter((a) => a.type === 'bank');
  const cash = meta.accounts.filter((a) => a.type !== 'bank');
  const usable = method === 'transfer' && bank.length ? bank : cash;

  const toggle = (id) => {
    setTouched(false);
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const rows = (L?.rows || []).filter((r) => view === 'all'
    || (view === 'debt' && r.kind === 'debt_invoice')
    || (view === 'money' && ['receipt', 'refund', 'return_offset'].includes(r.kind)));
  const maxDays = L?.max_debt_days || 0;

  const submit = async () => {
    if (amt <= 0) { toast('Số tiền thu phải lớn hơn 0', 'bad'); return; }
    if (amt > debt) { toast(`Khách chỉ còn nợ ${money(debt)}, không thu quá được.`, 'bad', 6000); return; }
    setSaving(true);
    try {
      const account = accountId || (method === 'transfer' ? bank[0]?.id : null) || null;
      const res = await api.post(`/customers/${customerId}/pay`, {
        amount: amt,
        sale_ids: [...picked],
        account_id: account,
        user_id: user?.id || null,
        note: note.trim()
          || (method === 'transfer' && !bank.length ? `Khách ${L.customer.name} trả nợ (chuyển khoản)` : undefined),
      });
      toast(
        res.debt > 0
          ? `Đã thu ${money(amt)}. ${L.customer.name} còn nợ ${money(res.debt)}.`
          : `Đã thu ${money(amt)}. ${L.customer.name} trả hết nợ.`,
        'ok', 7000);
      onDone?.(res);
      onClose();
    } catch (e) {
      toast(e.message, 'bad', 7000);
    } finally {
      setSaving(false);
    }
  };

  const c = L?.customer;

  return (
    <Modal
      open
      onClose={onClose}
      title={c ? `Thu nợ khách hàng — ${c.name}` : 'Thu nợ khách hàng'}
      subtitle={c ? [c.code, c.phone].filter(Boolean).join(' · ') : ''}
      size="xl"
      footer={<>
        {onBack && <Button onClick={onBack}>Chọn khách khác</Button>}
        <div className="flex-1" />
        <Button onClick={onClose}>Hủy bỏ</Button>
        <Button variant="primary" icon={Printer} onClick={submit} loading={saving}
          disabled={!L || amt <= 0 || amt > debt}>
          Xác nhận thu nợ &amp; In
        </Button>
      </>}
    >
      {busy && !L ? <Spinner />
        : error ? <ErrorBox error={error} onRetry={reload} />
          : L && (
            <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
              {/* ------------------------- Sổ phụ ------------------------- */}
              <div className="min-w-0 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-[13px] font-bold">Lịch sử giao dịch &amp; công nợ — mới nhất trên cùng</h3>
                  <div className="flex rounded border border-line overflow-hidden" role="radiogroup" aria-label="Lọc sổ phụ">
                    {[['all', 'Tất cả'], ['debt', 'Còn nợ'], ['money', 'Phiếu thu']].map(([k, lb]) => (
                      <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => setView(k)}
                        className={`px-2.5 h-8 text-[13px] font-semibold cursor-pointer transition-colors duration-100
                                    ${view === k ? 'bg-primary text-white' : 'bg-card hover:bg-muted'}`}>
                        {lb}
                      </button>
                    ))}
                  </div>
                </div>

                {rows.length === 0 ? (
                  <Empty icon={CheckCircle2} title="Không có chứng từ nào"
                    message={view === 'debt' ? 'Khách không còn hoá đơn nào nợ.' : 'Chưa có giao dịch với khách này.'} />
                ) : (
                  <div className="table-wrap max-h-[52vh] overflow-y-auto">
                    <table className="data">
                      <thead className="sticky top-0 z-10">
                        <tr>
                          <th style={{ width: 34 }} aria-label="Chọn hoá đơn" />
                          <th>Thời gian</th>
                          <th>Mã chứng từ</th>
                          <th>Loại chứng từ</th>
                          <th className="text-right">Giá trị đơn</th>
                          <th className="text-right">Trạng thái / Nợ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => {
                          const isDebt = r.kind === 'debt_invoice';
                          const on = isDebt && picked.has(r.id);
                          const overdue = isDebt && maxDays > 0 && r.age_days > maxDays;
                          return (
                            <tr key={`${r.kind}-${r.id}`}
                              className={`${on ? 'bg-accent-soft/40' : ''} ${isDebt ? 'hoverable clickable' : ''}`}
                              onClick={isDebt ? () => toggle(r.id) : undefined}>
                              <td className="text-center">
                                {isDebt && (
                                  <input type="checkbox" className="w-4 h-4 accent-emerald-700 cursor-pointer"
                                    checked={on} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()}
                                    aria-label={`Chọn trả hoá đơn ${r.code}`} />
                                )}
                              </td>
                              <td className="whitespace-nowrap text-muted-ink">{date(r.ts)}</td>
                              <td className="font-mono whitespace-nowrap">{r.code}</td>
                              <td className="whitespace-nowrap">{KIND[r.kind] || r.kind}</td>
                              <td className="num">{r.total != null ? money(r.total) : <span className="text-muted-ink">—</span>}</td>
                              <td className="text-right">
                                {isDebt && (
                                  <>
                                    <span className="font-bold text-danger tabular">Còn nợ {money(r.remaining)}</span>
                                    {overdue && <div><Badge tone="bad">Quá hạn · {n(r.age_days)} ngày</Badge></div>}
                                  </>
                                )}
                                {r.kind === 'settled_invoice' && <span className="text-emerald-700 font-semibold">Đã trả hết nợ</span>}
                                {r.kind === 'paid_invoice' && <Badge tone="mute">Đã trả đủ tại quầy - Không nợ</Badge>}
                                {(r.kind === 'cod_invoice' || r.kind === 'failed_invoice') && (
                                  <span className="text-2xs text-muted-ink">{r.status}</span>
                                )}
                                {r.kind === 'receipt' && (
                                  <>
                                    <span className="font-bold text-emerald-700 tabular">Trả +{money(r.amount)}</span>
                                    <div className="text-2xs text-muted-ink">
                                      {[r.method, r.applied_to?.length ? `vào ${r.applied_to.map((a) => a.code).join(', ')}` : null, r.user_name]
                                        .filter(Boolean).join(' · ')}
                                    </div>
                                  </>
                                )}
                                {r.kind === 'refund' && <span className="font-semibold text-danger tabular">Chi −{money(r.amount)}</span>}
                                {r.kind === 'return_offset' && (
                                  <>
                                    <span className="font-bold text-emerald-700 tabular">Trừ nợ +{money(r.amount)}</span>
                                    {r.sale_code && <div className="text-2xs text-muted-ink">hàng của {r.sale_code}</div>}
                                  </>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {L.opening_left > 0 && view !== 'money' && (
                          <tr>
                            <td />
                            <td className="text-muted-ink">—</td>
                            <td className="text-muted-ink">—</td>
                            <td>Nợ đầu kỳ</td>
                            <td className="num text-muted-ink">—</td>
                            <td className="text-right font-bold text-danger tabular">Còn nợ {money(L.opening_left)}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ------------------------ Thu tiền ------------------------ */}
              <div className="space-y-2.5">
                <div className={`card p-3 ${debt > 0 ? 'bg-amber-50 border-warn/30' : 'bg-emerald-50 border-emerald-200'}`}>
                  <div className="text-2xs font-bold uppercase text-muted-ink">Tổng nợ hiện tại</div>
                  <div className={`text-2xl font-display font-bold tabular ${debt > 0 ? 'text-danger' : 'text-emerald-700'}`}>
                    {money(debt)}
                  </div>
                  {c?.debt_limit > 0 && (
                    <div className={`text-2xs mt-0.5 ${L.over_limit ? 'text-danger font-semibold' : 'text-muted-ink'}`}>
                      Hạn mức {money(c.debt_limit)}{L.over_limit ? ' — đang vượt hạn mức' : ''}
                    </div>
                  )}
                  {L.overdue_count > 0 && (
                    <div className="text-2xs mt-0.5 text-danger font-semibold flex items-center gap-1">
                      <AlertTriangle size={11} aria-hidden="true" />
                      {L.overdue_count} hoá đơn nợ quá {maxDays} ngày — không bán nợ thêm được
                    </div>
                  )}
                </div>

                <Field label="Số tiền thu hôm nay" htmlFor="dl-amount">
                  <div className="flex gap-1.5">
                    <MoneyInput id="dl-amount" size="lg" value={amount} className="flex-1 min-w-0" autoFocus
                      onChange={(v) => { setTouched(true); setAmount(Math.max(0, v)); }} />
                    <Button onClick={() => { setTouched(true); setAmount(debt); }} disabled={debt <= 0}>
                      Thu hết nợ
                    </Button>
                  </div>
                  {amt > debt && (
                    <p className="text-2xs text-danger font-semibold mt-1">Khách chỉ còn nợ {money(debt)}.</p>
                  )}
                </Field>

                <p className="text-2xs text-muted-ink leading-relaxed -mt-1">
                  {picked.size > 0
                    ? <>Đã tích <b>{picked.size} hoá đơn</b> · cộng {money(pickedTotal)}. Tiền thu trả vào đúng các hoá đơn này trước.</>
                    : 'Không tích hoá đơn nào thì trừ dần từ hoá đơn cũ nhất (FIFO).'}
                </p>

                <Field label="Hình thức">
                  <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Hình thức thu nợ">
                    {[
                      { key: 'cash', label: 'Tiền mặt', icon: Wallet },
                      { key: 'transfer', label: 'Chuyển khoản', icon: CreditCard },
                    ].map((m) => (
                      <button key={m.key} type="button" role="radio" aria-checked={method === m.key}
                        onClick={() => { setMethod(m.key); setAccountId(''); }}
                        className={`btn btn-sm justify-center ${method === m.key ? 'btn-secondary' : 'btn-outline'}`}>
                        <m.icon size={14} aria-hidden="true" />
                        {m.label}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="Vào quỹ" htmlFor="dl-account">
                  <Select id="dl-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                    <option value="">{method === 'transfer' && bank.length ? bank[0].name : 'Quỹ mặc định'}</option>
                    {usable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                </Field>

                <Field label="Ghi chú" htmlFor="dl-note">
                  <Input id="dl-note" value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="Để trống: tự ghi hoá đơn được trả" />
                </Field>

                {amt > 0 && amt <= debt && (
                  <div className="card p-2.5 bg-muted/50 text-[13px] space-y-0.5">
                    <div className="text-2xs font-bold uppercase text-muted-ink mb-0.5">Tiền thu sẽ trừ vào</div>
                    {plan.rows.slice(0, 6).map((r) => (
                      <div key={r.id} className="flex justify-between gap-2">
                        <span className="font-mono">{r.code}</span>
                        <span className="tabular">{money(r.amount)}</span>
                      </div>
                    ))}
                    {plan.rows.length > 6 && (
                      <div className="text-2xs text-muted-ink">và {plan.rows.length - 6} hoá đơn khác</div>
                    )}
                    {plan.toOpening > 0 && (
                      <div className="flex justify-between gap-2">
                        <span>Nợ đầu kỳ</span><span className="tabular">{money(plan.toOpening)}</span>
                      </div>
                    )}
                    <div className="border-t border-line mt-1 pt-0.5">
                      <TotalRow label="Sau khi thu, khách còn nợ" value={money(left)} tone={left > 0 ? 'bad' : 'good'} big />
                    </div>
                  </div>
                )}

                <p className="text-2xs text-muted-ink leading-relaxed flex gap-1.5">
                  <Lock size={11} className="shrink-0 mt-0.5" aria-hidden="true" />
                  Phiếu thu đã xác nhận thì thu ngân không sửa, không xoá được. Thu nhầm thì báo chủ cửa hàng.
                </p>
              </div>
            </div>
          )}
    </Modal>
  );
}

/* ============ DÒNG CẢNH BÁO KHI CHỌN KHÁCH CÓ NỢ =================== */

/**
 * Hiện ngay dưới ô chọn khách trên màn hình bán hàng — nhắc thu ngân đòi
 * nợ đúng lúc còn gặp mặt khách, không đợi tới lúc bấm thanh toán.
 */
export function CustomerDebtBanner({ customer, onCollect }) {
  if (!customer || !(customer.debt > 0)) return null;
  const over = customer.debt_limit > 0 && customer.debt > customer.debt_limit;

  return (
    <div
      className={`mt-1.5 rounded p-2 text-[13px] flex flex-wrap items-center gap-x-2 gap-y-1
                  ${over ? 'bg-red-50 border border-danger/30' : 'bg-amber-50 border border-warn/30'}`}
      role="status"
    >
      <AlertTriangle size={14} className={over ? 'text-danger shrink-0' : 'text-warn shrink-0'} aria-hidden="true" />
      <span className={over ? 'text-rose-900' : 'text-amber-900'}>
        Khách còn nợ <b className="tabular">{money(customer.debt)}</b>
        {over && <> — <b>vượt hạn mức {money(customer.debt_limit)}</b></>}
      </span>
      <div className="flex-1" />
      <button type="button" onClick={onCollect} className="btn btn-sm btn-outline shrink-0">
        <HandCoins size={13} aria-hidden="true" />
        Thu nợ
      </button>
    </div>
  );
}

/* ========== Ô THU NỢ CŨ NGAY TRONG HỘP THANH TOÁN ================== */

/**
 * Khách vừa mua vừa trả nợ cũ. Tiền nợ cũ được thu thành một phiếu thu
 * RIÊNG sau khi lập hoá đơn, không cộng vào tiền hàng — nếu gộp chung thì
 * doanh thu hôm nay sẽ bị thổi lên bằng cả khoản nợ của tháng trước.
 */
export function CollectDebtRow({ customer, value, onChange }) {
  if (!customer || !(customer.debt > 0)) return null;
  const on = value > 0;

  return (
    <div className={`rounded border p-2.5 space-y-2 ${on ? 'border-accent bg-accent-soft/25' : 'border-line'}`}>
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="w-4 h-4 accent-emerald-700 cursor-pointer mt-0.5"
          checked={on}
          onChange={(e) => onChange(e.target.checked ? customer.debt : 0)}
        />
        <span className="text-[13px]">
          Thu luôn nợ cũ
          <span className="block text-2xs text-muted-ink">
            Khách còn nợ <b className="tabular">{money(customer.debt)}</b> từ những lần mua trước.
          </span>
        </span>
      </label>

      {on && (
        <>
          <MoneyInput value={value} onChange={(v) => onChange(Math.min(v, customer.debt))} />
          <p className="text-2xs text-muted-ink leading-relaxed">
            Khoản này ghi thành <b>phiếu thu riêng</b>, không cộng vào tiền hàng —
            để doanh thu hôm nay không bị tính lẫn nợ cũ.
          </p>
        </>
      )}
    </div>
  );
}
