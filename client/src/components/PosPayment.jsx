/* ====================================================================
   HỘP THANH TOÁN (tài liệu 04, 05)

   Ba chặn trước khi cho bấm hoàn tất, xét theo công nợ thật trên máy chủ
   chứ không theo con số tải sẵn trên màn hình:

     - Khách còn hoá đơn nợ quá số ngày cho phép: đơn này phải trả đủ
       100%, không có nút ghi nợ.
     - Nợ sau đơn này vượt hạn mức: khoá nút hoàn tất, quản lý nhập PIN mới
       mở — kể cả chủ tiệm cũng phải gõ, để lại dấu ai cho phép.
     - Đơn giao hàng: phần khách chưa trả là tiền THU HỘ, không phải nợ,
       nên khách lẻ vẫn giao COD được.

   Máy chủ soát lại cả ba khi lưu. Ở đây khoá sớm để thu ngân khỏi bấm
   hụt giữa lúc khách đứng chờ.
   ==================================================================== */
import { useState, useEffect } from 'react';
import {
  Wallet, CreditCard, HandCoins, Tag, Printer, Truck, Lock, ShieldCheck,
  AlertTriangle, Ticket, X, Pencil, KeyRound,
} from 'lucide-react';
import { api } from '../lib/api';
import { money, n } from '../lib/format';
import { Button, IconButton, Modal, Field, MoneyInput } from './ui';
import { CollectDebtRow } from './PosDebt';
import { PinApprovalModal } from './PosApproval';
import { PrintChoice } from './PosDeliveryForm';

const METHODS = [
  { key: 'cash', label: 'Tiền mặt', icon: Wallet },
  { key: 'transfer', label: 'Chuyển khoản', icon: CreditCard },
  { key: 'debt', label: 'Ghi nợ', icon: HandCoins },
  { key: 'mixed', label: 'Kết hợp', icon: Tag },
];

export default function PaymentModal({ open, onClose, totals, customer, onSubmit, delivery, onEditDelivery }) {
  const codMode = !!delivery && delivery.codMode !== false;

  const [method, setMethod] = useState('cash');
  const [received, setReceived] = useState(0);
  const [transferAmount, setTransferAmount] = useState(0);
  const [debtAmount, setDebtAmount] = useState(0);
  const [prepaid, setPrepaid] = useState(0);
  const [collectDebt, setCollectDebt] = useState(0);   // thu luôn nợ cũ của khách
  const [credit, setCredit] = useState(null);
  const [approval, setApproval] = useState(null);
  const [pinAsk, setPinAsk] = useState(null);
  const [vCode, setVCode] = useState('');
  const [voucher, setVoucher] = useState(null);
  const [vBusy, setVBusy] = useState(false);
  const [vErr, setVErr] = useState('');
  const [print, setPrint] = useState({ invoice: true, note: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const voucherUse = voucher ? Math.min(voucher.balance, totals.total) : 0;
  const due = Math.max(0, totals.total - voucherUse);

  useEffect(() => {
    if (!open) return;
    setMethod(delivery?.prepaidMethod === 'transfer' ? 'transfer' : 'cash');
    setReceived(totals.total);
    setTransferAmount(0);
    setDebtAmount(0);
    setPrepaid(delivery ? Math.max(0, Math.round(Number(delivery.prepaid) || 0)) : 0);
    setCollectDebt(0);
    setApproval(null);
    setPinAsk(null);
    setVCode('');
    setVoucher(null);
    setVErr('');
    setPrint(delivery ? { invoice: true, note: true, ...(delivery.print || {}) } : { invoice: true, note: false });
    setErr('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* Áp phiếu đổi hàng xong thì tiền khách đưa bám theo số còn phải trả */
  useEffect(() => {
    if (open) setReceived(Math.max(0, totals.total - voucherUse));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voucherUse]);

  /* Công nợ, hạn mức, nợ quá hạn — hỏi thẳng máy chủ mỗi lần mở hộp */
  useEffect(() => {
    if (!open || !customer?.id) { setCredit(null); return undefined; }
    let alive = true;
    api.creditStatus(customer.id)
      .then((c) => { if (alive) setCredit(c); })
      .catch(() => { if (alive) setCredit(null); });
    return () => { alive = false; };
  }, [open, customer?.id]);

  useEffect(() => {
    if (credit?.blocked_overdue && method === 'debt') setMethod('cash');
  }, [credit, method]);

  /* ------------------------------ Tính tiền ------------------------------ */
  let paid;
  let change = 0;
  let remaining;
  let cashAmount;
  let transferAmt;
  let payMethod;
  if (codMode) {
    paid = Math.min(Math.max(0, prepaid), due);
    remaining = due - paid;                          // tiền thu hộ, không phải nợ
    cashAmount = method === 'transfer' ? 0 : paid;
    transferAmt = method === 'transfer' ? paid : 0;
    payMethod = remaining > 0 ? 'cod' : (method === 'transfer' ? 'transfer' : 'cash');
  } else {
    paid = method === 'cash' ? Math.min(received, due)
      : method === 'transfer' ? due
        : method === 'debt' ? Math.max(0, due - debtAmount)
          : Math.min(received + transferAmount, due);
    change = method === 'cash' ? Math.max(0, received - due) : 0;
    remaining = Math.max(0, due - paid);
    cashAmount = method === 'cash' ? Math.min(received, due)
      : method === 'mixed' ? Math.max(0, Math.min(received, due - transferAmount))
        : method === 'debt' ? paid : 0;
    transferAmt = method === 'transfer' ? due : method === 'mixed' ? Math.min(transferAmount, due) : 0;
    payMethod = remaining > 0 ? 'debt' : method;
  }

  const debtNow = !codMode && remaining > 0;
  const willOwe = (credit?.debt || 0) + remaining;
  const overLimit = debtNow && credit?.debt_limit > 0 && willOwe > credit.debt_limit;
  const overdueBlock = debtNow && !!credit?.blocked_overdue;
  const locked = overdueBlock || (overLimit && !approval);

  const QUICK = [
    due,
    Math.ceil(due / 10000) * 10000,
    Math.ceil(due / 50000) * 50000,
    Math.ceil(due / 100000) * 100000,
    Math.ceil(due / 500000) * 500000,
  ].filter((v, i, a) => v > 0 && a.indexOf(v) === i).slice(0, 5);

  const payload = (extra = {}) => ({
    collect_debt: collectDebt,
    payment_method: payMethod,
    paid,
    received: !codMode && method === 'cash' ? received : paid,
    cash_amount: cashAmount,
    transfer_amount: transferAmt,
    ...(voucher ? { voucher_code: voucher.code, voucher_amount: voucherUse } : {}),
    ...(approval ? { approval_token: approval.token } : {}),
    ...(delivery ? { _print: print } : {}),
    ...extra,
  });

  const run = async (extra = {}) => {
    setErr('');
    if (debtNow && !customer) {
      setErr('Đơn còn nợ lại nên bắt buộc phải chọn khách hàng để theo dõi công nợ.');
      return;
    }
    if (overdueBlock) {
      setErr('Khách còn hoá đơn nợ quá hạn — đơn này phải trả đủ 100%, không bán nợ thêm được.');
      return;
    }
    if (overLimit && !approval && !extra.approval_token) {
      setErr('Nợ vượt hạn mức — cần quản lý nhập mã PIN để mở khoá.');
      return;
    }
    setBusy(true);
    try {
      await onSubmit(payload(extra));
    } catch (e) {
      if (e.needsApproval) {
        setPinAsk({
          retry: true,
          reason: e.code === 'DEBT_LIMIT' ? 'bán nợ vượt hạn mức' : 'giảm giá vượt hạn mức',
          detail: e.message,
        });
      } else {
        setErr(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const lookupVoucher = async () => {
    const code = vCode.trim();
    if (!code) return;
    setVBusy(true);
    setVErr('');
    try {
      const v = await api.voucher(code);
      if (!v.usable) setVErr(`Phiếu ${v.code}: ${v.why_not}`);
      else if (v.customer_id && v.customer_id !== customer?.id) {
        setVErr(`Phiếu ${v.code} ghi đích danh khách "${v.customer_name || 'khác'}" — chọn đúng khách đó rồi mới dùng được.`);
      } else setVoucher(v);
    } catch (e) {
      setVErr(e.message);
    } finally {
      setVBusy(false);
    }
  };

  /* Enter để hoàn tất — trừ lúc đang gõ ô nhiều dòng, ô mã phiếu, hoặc đang hỏi PIN */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Enter' || e.shiftKey || pinAsk || busy) return;
      if (e.target.tagName === 'TEXTAREA' || e.target.dataset?.ownEnter) return;
      e.preventDefault();
      if (!locked) run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const printNone = delivery && !print.invoice && !print.note;
  const submitLabel = delivery
    ? (printNone ? 'Xác nhận đơn giao' : 'Xác nhận & In')
    : 'Hoàn tất & In hoá đơn';
  const shipper = delivery && (delivery.shipperMode === 'staff' ? delivery.shipperUserName
    : delivery.shipperMode === 'free' ? delivery.shipperName : '');

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={delivery ? 'Thanh toán đơn giao hàng' : 'Thanh toán'}
        subtitle={customer ? `Khách hàng: ${customer.name}` : 'Khách lẻ'}
        size="md"
        footer={<>
          <Button onClick={onClose}>Quay lại</Button>
          <Button variant="primary" size="lg" onClick={() => run()} loading={busy} disabled={locked}
            icon={locked ? Lock : Printer}>
            {submitLabel}
          </Button>
        </>}
      >
        <div className="space-y-4">
          <div className="bg-accent-soft/60 rounded-lg p-3 text-center">
            <div className="text-2xs font-bold text-emerald-900/70 uppercase tracking-wide">Khách phải trả</div>
            <div className="text-3xl font-display font-bold text-emerald-900 tabular mt-0.5">
              {money(totals.total)}
            </div>
            {totals.shipCharged > 0 && (
              <div className="text-2xs text-emerald-900/70 mt-0.5">đã gồm {money(totals.shipCharged)} phí giao hàng</div>
            )}
            {voucherUse > 0 && (
              <div className="text-[13px] text-emerald-900 mt-1">
                Trừ phiếu đổi hàng −{money(voucherUse)} → còn phải trả <b className="tabular">{money(due)}</b>
              </div>
            )}
          </div>

          {delivery && (
            <div className="card p-2.5 text-[13px] flex gap-2">
              <Truck size={15} className="text-muted-ink shrink-0 mt-0.5" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  Giao cho {delivery.name || customer?.name || 'khách'}{delivery.phone ? ` · ${delivery.phone}` : ''}
                </div>
                {delivery.address && <div className="text-muted-ink truncate">{delivery.address}</div>}
                {(delivery.carrierName || shipper) && (
                  <div className="text-2xs text-muted-ink">
                    {[delivery.carrierName, shipper && `người giao: ${shipper}`].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
              {onEditDelivery && <Button size="sm" icon={Pencil} onClick={onEditDelivery}>Sửa</Button>}
            </div>
          )}

          {overdueBlock && (
            <div className="rounded-lg border border-danger/30 bg-red-50 p-2.5 text-[13px] text-red-900 flex gap-2" role="alert">
              <AlertTriangle size={15} className="shrink-0 mt-0.5 text-danger" aria-hidden="true" />
              <div>
                Khách còn <b>{credit.overdue.length} hoá đơn nợ quá {credit.max_debt_days} ngày</b>
                {credit.overdue[0] && (
                  <> (cũ nhất {credit.overdue[0].code}, {credit.overdue[0].age_days} ngày, còn {money(credit.overdue[0].remaining)})</>
                )}. Đơn này <b>phải trả đủ 100%</b>, không bán nợ thêm.
              </div>
            </div>
          )}

          {overLimit && (approval ? (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-2.5 text-[13px] text-emerald-900 flex gap-2">
              <ShieldCheck size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span><b>{approval.approver?.full_name || 'Quản lý'}</b> đã duyệt bán nợ vượt hạn mức cho đơn này.</span>
            </div>
          ) : (
            <div className="rounded-lg border border-danger/30 bg-red-50 p-2.5 text-[13px] text-red-900 space-y-2" role="alert">
              <div className="flex gap-2">
                <Lock size={15} className="shrink-0 mt-0.5 text-danger" aria-hidden="true" />
                <div>
                  Nợ sau đơn này là <b className="tabular">{money(willOwe)}</b>, vượt hạn mức{' '}
                  <b className="tabular">{money(credit.debt_limit)}</b> của {customer?.name}. Nút hoàn tất đang khoá.
                </div>
              </div>
              <Button
                size="sm"
                variant="danger"
                icon={KeyRound}
                onClick={() => setPinAsk({
                  retry: false,
                  reason: 'bán nợ vượt hạn mức',
                  detail: <>Cho <b>{customer?.name}</b> nợ tới <b>{money(willOwe)}</b>, vượt hạn mức {money(credit.debt_limit)}.</>,
                })}
              >
                Quản lý nhập PIN để mở khoá
              </Button>
            </div>
          ))}

          {codMode ? (
            <div className="space-y-2.5">
              <Field label="Khách trả trước (đặt cọc)" hint="Để 0 nếu người giao thu toàn bộ khi giao" htmlFor="pay-prepaid">
                <MoneyInput id="pay-prepaid" size="lg" value={prepaid} onChange={(v) => setPrepaid(Math.max(0, v))} autoFocus />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <button type="button" className={`btn btn-sm ${paid === 0 ? 'btn-soft' : 'btn-outline'}`}
                    onClick={() => setPrepaid(0)}>
                    Chưa trả trước
                  </button>
                  <button type="button" className={`btn btn-sm ${paid >= due ? 'btn-soft' : 'btn-outline'}`}
                    onClick={() => setPrepaid(due)}>
                    Trả đủ {n(due)}
                  </button>
                </div>
              </Field>
              {paid > 0 && (
                <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Khách trả trước bằng">
                  {METHODS.slice(0, 2).map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      role="radio"
                      aria-checked={method === m.key}
                      onClick={() => setMethod(m.key)}
                      className={`btn btn-sm ${method === m.key ? 'btn-secondary' : 'btn-outline'}`}
                    >
                      <m.icon size={14} aria-hidden="true" />
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-semibold text-amber-900">Thu hộ (COD) — người giao thu của khách</span>
                  <span className="text-xl font-display font-bold tabular text-amber-900">{money(remaining)}</span>
                </div>
                <p className="text-2xs text-amber-900/80 mt-0.5 leading-relaxed">
                  Không tính vào công nợ khách. Khoản này nằm ở <b>Phải thu từ đối tác vận chuyển</b> với
                  trạng thái <b>Chờ đối soát COD</b>, tới khi người giao nộp tiền về.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div>
                <span className="label">Hình thức thanh toán</span>
                <div className="grid grid-cols-4 gap-1.5">
                  {METHODS.map((m) => {
                    const off = m.key === 'debt' && !!credit?.blocked_overdue;
                    return (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => {
                          setMethod(m.key);
                          /* Bấm "Ghi nợ" là khách nợ cả đơn; trả trước bao nhiêu thì gõ vào sau.
                             Để mặc định trả đủ thì bấm Ghi nợ mà hoá đơn vẫn không nợ đồng nào. */
                          if (m.key === 'debt' && method !== 'debt') setDebtAmount(due);
                        }}
                        disabled={off}
                        aria-pressed={method === m.key}
                        title={off ? 'Khách còn hoá đơn nợ quá hạn — không bán nợ thêm' : undefined}
                        className={`btn btn-touch flex-col !gap-0.5 !py-2 text-2xs
                                    ${method === m.key ? 'btn-secondary' : 'btn-outline'}`}
                      >
                        <m.icon size={16} aria-hidden="true" />
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {(method === 'cash' || method === 'mixed') && (
                <Field label="Tiền khách đưa" htmlFor="pay-received">
                  <MoneyInput id="pay-received" size="lg" value={received} onChange={setReceived} autoFocus />
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {QUICK.map((v) => (
                      <button key={v} type="button" onClick={() => setReceived(v)}
                        className={`btn btn-sm ${received === v ? 'btn-soft' : 'btn-outline'}`}>
                        {n(v)}
                      </button>
                    ))}
                  </div>
                </Field>
              )}

              {method === 'mixed' && (
                <Field label="Trong đó chuyển khoản" htmlFor="pay-transfer">
                  <MoneyInput id="pay-transfer" value={transferAmount} onChange={setTransferAmount} />
                </Field>
              )}

              {method === 'debt' && (
                <Field label="Khách trả trước bao nhiêu" hint="Để 0 nếu khách nợ toàn bộ. Phần còn lại ghi vào công nợ."
                  htmlFor="pay-partial">
                  <MoneyInput id="pay-partial" size="lg" value={due - debtAmount}
                    onChange={(v) => setDebtAmount(Math.max(0, due - v))} autoFocus />
                </Field>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="card p-2.5">
                  <div className="text-2xs font-bold text-muted-ink uppercase">Tiền thối lại</div>
                  <div className="text-lg font-display font-bold tabular mt-0.5">{money(change)}</div>
                </div>
                <div className="card p-2.5">
                  <div className="text-2xs font-bold text-muted-ink uppercase">Còn nợ lại</div>
                  <div className={`text-lg font-display font-bold tabular mt-0.5 ${remaining > 0 ? 'text-danger' : ''}`}>
                    {money(remaining)}
                  </div>
                </div>
              </div>

              {remaining > 0 && credit?.debt_limit > 0 && !overLimit && (
                <p className="text-2xs text-warn font-semibold">
                  Nợ sau đơn này: {money(willOwe)} / hạn mức {money(credit.debt_limit)}
                </p>
              )}
            </>
          )}

          {/* Phiếu đổi hàng khách mang tới — trừ thẳng vào tiền phải trả */}
          <div className="rounded border border-line p-2.5">
            {voucher ? (
              <div className="flex items-center gap-2 text-[13px]">
                <Ticket size={16} className="text-emerald-700 shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0">
                  Phiếu <b className="font-mono">{voucher.code}</b> — trừ <b className="tabular">{money(voucherUse)}</b>
                  {voucher.balance > voucherUse && (
                    <span className="text-2xs text-muted-ink"> (còn {money(voucher.balance - voucherUse)} dùng lần sau)</span>
                  )}
                </span>
                <IconButton icon={X} size={14} label="Bỏ dùng phiếu đổi hàng"
                  onClick={() => { setVoucher(null); setVCode(''); }} />
              </div>
            ) : (
              <div>
                <label htmlFor="pay-voucher" className="text-[13px] font-semibold flex items-center gap-1.5">
                  <Ticket size={14} aria-hidden="true" /> Khách có phiếu đổi hàng?
                </label>
                <div className="flex gap-1.5 mt-1">
                  <input
                    id="pay-voucher"
                    data-own-enter="1"
                    className="field field-sm font-mono uppercase flex-1"
                    value={vCode}
                    onChange={(e) => { setVCode(e.target.value.toUpperCase()); setVErr(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookupVoucher(); } }}
                    placeholder="Mã phiếu, VD: PDH2609-AB12C"
                  />
                  <Button size="sm" onClick={lookupVoucher} loading={vBusy} disabled={!vCode.trim()}>Áp dụng</Button>
                </div>
                {vErr && <p className="text-2xs text-danger font-semibold mt-1" role="alert">{vErr}</p>}
              </div>
            )}
          </div>

          {/* Khách vừa mua vừa trả nợ cũ — gộp hai việc vào một lần đứng quầy */}
          <CollectDebtRow customer={customer} value={collectDebt} onChange={setCollectDebt} />

          {collectDebt > 0 && (
            <div className="card p-2.5 bg-accent-soft/25 border-accent">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-semibold">Tổng khách đưa</span>
                <span className="text-lg font-display font-bold tabular">{money(paid + collectDebt)}</span>
              </div>
              <div className="text-2xs text-muted-ink tabular mt-0.5">
                {money(paid)} tiền hàng + {money(collectDebt)} nợ cũ
              </div>
            </div>
          )}

          {delivery && <PrintChoice value={print} onChange={setPrint} idPrefix="pay-print" />}

          {err && (
            <p role="alert" className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">
              {err}
            </p>
          )}
        </div>
      </Modal>

      <PinApprovalModal
        open={!!pinAsk}
        reason={pinAsk?.reason}
        detail={pinAsk?.detail}
        onClose={() => setPinAsk(null)}
        onApproved={(res) => {
          const ask = pinAsk;
          setApproval(res);
          setPinAsk(null);
          if (ask?.retry) run({ approval_token: res.token });
        }}
      />
    </>
  );
}
