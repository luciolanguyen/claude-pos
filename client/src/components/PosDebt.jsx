/* ====================================================================
   THU NỢ KHÁCH HÀNG NGAY TẠI QUẦY

   Ba chỗ, cho ba tình huống khác nhau:

     - Nút "Thu nợ" trên thanh đầu: khách ghé chỉ để trả nợ, không mua gì.
     - Dòng cảnh báo khi chọn khách: nhắc thu ngân là người này còn nợ,
       ngay lúc chọn khách chứ không đợi tới lúc thanh toán.
     - Ô trong hộp thanh toán: khách vừa mua vừa trả nợ cũ trong một lần.

   Mỗi phiếu thu ghi rõ tên người thu, để cuối ngày chủ tiệm đối chiếu
   được với người đứng quầy.
   ==================================================================== */
import { useState, useEffect, useMemo } from 'react';
import {
  HandCoins, Search, AlertTriangle, Phone, CheckCircle2, Wallet, CreditCard,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, useDebounced } from '../lib/store';
import { money, n, date, datetime, match } from '../lib/format';
import {
  Button, Input, Select, Modal, Field, MoneyInput, Empty, Spinner,
  Badge, SearchInput, TotalRow, ErrorBox,
} from './ui';

/* ==================== NÚT THU NỢ TRÊN THANH ĐẦU ==================== */

/** Chỉ hiện khi tiệm đang có khách nợ, để lúc không ai nợ thì bớt một nút. */
export function DebtButton({ onOpen }) {
  const { data, reload } = useFetch(() => api.customerDebts(), []);

  useEffect(() => {
    const t = setInterval(reload, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [reload]);

  const rows = Array.isArray(data) ? data : (data?.rows || []);
  const owing = rows.filter((c) => c.debt > 0);
  if (!owing.length) return null;

  const overdue = owing.filter((c) => c.over_limit || c.oldest_days > 60).length;

  return (
    <button
      onClick={onOpen}
      className={`h-9 px-2.5 rounded border text-[13px] font-semibold hidden md:flex items-center gap-1.5
                  transition-colors duration-150 cursor-pointer
                  ${overdue > 0
                    ? 'bg-amber-500/20 border-amber-400/40 text-amber-200 hover:bg-amber-500/30'
                    : 'bg-white/10 border-white/15 text-slate-300 hover:text-white'}`}
      title={`${owing.length} khách còn nợ`}
      aria-label={`Thu nợ — ${owing.length} khách còn nợ`}
    >
      <HandCoins size={14} aria-hidden="true" />
      Thu nợ
      <span className="tabular">({n(owing.length)})</span>
    </button>
  );
}

/* ======================= HỘP THU NỢ ĐỘC LẬP ======================== */

export function DebtCollectModal({ open, onClose, onDone, customerId = null }) {
  const [picked, setPicked] = useState(customerId);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);

  const { data, busy, error, reload } = useFetch(
    () => api.customerDebts(), [], { skip: !open });

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

  /* Phải kiểm cả open: nếu chỉ xét picked thì lúc đóng hộp, nhánh này vẫn
     dựng CollectForm với <Modal open> cứng, hộp thoại không chịu đóng. */
  if (open && picked) {
    return (
      <CollectForm
        customerId={picked}
        onBack={customerId ? null : () => setPicked(null)}
        onClose={onClose}
        onDone={() => { reload(); onDone?.(); }}
      />
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Thu nợ khách hàng"
      subtitle="Chọn khách để xem còn nợ bao nhiêu rồi thu"
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
                            ? <span className={c.oldest_days > 60 ? 'text-danger font-semibold' : 'text-muted-ink'}>
                                {n(c.oldest_days)} ngày
                              </span>
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

/** Màn hình thu tiền của một khách cụ thể. */
function CollectForm({ customerId, onBack, onClose, onDone }) {
  const { user, meta, toast } = useApp();
  const { data: c, busy, error, reload } = useFetch(
    () => api.customerQuick(customerId), [customerId]);
  const [amount, setAmount] = useState(0);
  const [accountId, setAccountId] = useState('');
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (c) setAmount(c.debt || 0); }, [c]);

  const left = Math.max(0, (c?.debt || 0) - (Number(amount) || 0));

  const submit = async () => {
    const amt = Number(amount) || 0;
    if (amt <= 0) return toast('Số tiền phải lớn hơn 0', 'bad');
    if (amt > (c?.debt || 0)) {
      return toast(`Khách chỉ còn nợ ${money(c.debt)}, không thu quá được.`, 'bad', 6000);
    }
    setSaving(true);
    try {
      const res = await api.post(`/customers/${customerId}/pay`, {
        amount: amt,
        account_id: accountId || null,
        user_id: user?.id || null,
        note: note || `Khách ${c.name} trả nợ${method === 'transfer' ? ' (chuyển khoản)' : ''}`,
      });
      toast(
        res.debt > 0
          ? `Đã thu ${money(amt)}. Khách còn nợ ${money(res.debt)}.`
          : `Đã thu ${money(amt)}. Khách trả hết nợ.`,
        'ok', 7000);
      onDone?.();
      onClose();
    } catch (e) {
      toast(e.message, 'bad', 7000);
    } finally {
      setSaving(false);
    }
  };

  const bankAccounts = meta.accounts.filter((a) => a.type === 'bank');
  const cashAccounts = meta.accounts.filter((a) => a.type !== 'bank');
  const usable = method === 'transfer' && bankAccounts.length ? bankAccounts : cashAccounts;

  return (
    <Modal
      open
      onClose={onClose}
      title={c ? `Thu nợ: ${c.name}` : 'Thu nợ'}
      subtitle={c?.phone || ''}
      size="lg"
      footer={
        <>
          {onBack && <Button onClick={onBack}>Chọn khách khác</Button>}
          <div className="flex-1" />
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" icon={HandCoins} onClick={submit} loading={saving}
            disabled={!(Number(amount) > 0)}>
            Thu {money(Number(amount) || 0)}
          </Button>
        </>
      }
    >
      {busy ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : c && (
        <div className="space-y-3">
          <div className="card p-3 bg-amber-50 border-warn/30">
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] text-amber-900">Tổng còn nợ</span>
              <span className="text-2xl font-display font-bold tabular text-danger">{money(c.debt)}</span>
            </div>
            {c.over_limit && (
              <div className="text-[13px] text-amber-900 mt-1 flex gap-1.5">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
                Vượt hạn mức nợ {money(c.debt_limit)} của khách này.
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-2.5">
              <Field label="Số tiền thu">
                <MoneyInput size="lg" value={amount} onChange={setAmount} autoFocus />
              </Field>
              <div className="flex gap-1.5 flex-wrap">
                {[c.debt, Math.round(c.debt / 2), 500000, 1000000, 2000000]
                  .filter((v, i, a) => v > 0 && v <= c.debt && a.indexOf(v) === i)
                  .map((v) => (
                    <button key={v} type="button" className="btn btn-sm btn-outline"
                      onClick={() => setAmount(v)}>
                      {money(v)}
                    </button>
                  ))}
              </div>

              <Field label="Hình thức">
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { key: 'cash', label: 'Tiền mặt', icon: Wallet },
                    { key: 'transfer', label: 'Chuyển khoản', icon: CreditCard },
                  ].map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => { setMethod(m.key); setAccountId(''); }}
                      className={`btn btn-sm justify-center ${method === m.key ? 'btn-primary' : 'btn-outline'}`}
                    >
                      <m.icon size={14} aria-hidden="true" />
                      {m.label}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Vào quỹ">
                <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">Quỹ mặc định</option>
                  {usable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </Field>

              <Field label="Ghi chú" htmlFor="dc-note">
                <Input id="dc-note" value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="VD: trả nợ hoá đơn tháng trước" />
              </Field>

              <div className="card p-2.5 bg-muted/50">
                <TotalRow label="Sau khi thu, khách còn nợ" value={money(left)}
                  tone={left > 0 ? 'bad' : 'good'} big />
              </div>
            </div>

            <div>
              <h3 className="font-bold text-sm mb-1.5">Hoá đơn chưa trả hết</h3>
              {!c.unpaid_bills?.length ? (
                <p className="text-[13px] text-muted-ink">
                  Không có hoá đơn nào còn nợ. Khoản nợ này là nợ đầu kỳ khai lúc tạo hồ sơ khách.
                </p>
              ) : (
                <div className="table-wrap max-h-[38vh]">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Hoá đơn</th><th>Ngày</th>
                        <th className="text-right">Còn nợ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.unpaid_bills.map((b) => (
                        <tr key={b.id}>
                          <td className="font-mono">{b.code}</td>
                          <td className="text-muted-ink whitespace-nowrap">{date(b.ts)}</td>
                          <td className="num font-semibold text-danger">{money(b.remaining)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-2xs text-muted-ink mt-1.5 leading-relaxed">
                Tiền thu ghi thành một phiếu thu chung cho khách, không gán vào từng hoá đơn.
                Công nợ tính bằng tổng hoá đơn trừ tổng đã thu.
              </p>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ============ DÒNG CẢNH BÁO KHI CHỌN KHÁCH CÓ NỢ =================== */

/**
 * Hiện ngay dưới ô chọn khách trên màn hình bán hàng.
 * Mục đích là nhắc thu ngân đòi nợ đúng lúc còn gặp mặt khách, chứ không
 * phải đợi tới lúc bấm thanh toán mới biết.
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
      <button
        type="button"
        onClick={onCollect}
        className="btn btn-sm btn-outline shrink-0"
      >
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
