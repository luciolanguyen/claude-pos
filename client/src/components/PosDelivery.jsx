/* ====================================================================
   THEO DÕI ĐƠN GIAO HÀNG

   Hoá đơn xuất xong nhưng hàng chưa tới tay khách thì việc chưa xong.
   Bảng này trông những đơn đó đi tới đâu rồi.

   Bốn chặng, và chặng thứ ba tách khỏi chặng thứ tư có lý do:

     Chờ giao   hàng còn ở tiệm, chưa ai cầm đi
     Đang giao  người giao đã cầm hàng đi
     Đã giao    khách nhận được hàng rồi
     Đã thu tiền tiền đã về tới két

   "Đã giao" chưa phải là xong. Với đơn thu hộ, khách cầm hàng rồi mà
   tiền còn nằm trong túi người giao — tiệm vẫn đang bị nợ, và người
   giao có thể quên nộp. Gộp hai chặng làm một là mất dấu khoản tiền đó.

   Bấm "Đã thu tiền" thì phần mềm ghi phiếu thu và xoá nợ luôn, không
   phải vào sổ quỹ gõ lại lần nữa.
   ==================================================================== */
import { useState, useEffect } from 'react';
import {
  Truck, Package, CheckCircle2, Banknote, Undo2, X, Search,
  Printer, Clock, AlertTriangle, MapPin, Phone,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, useDebounced } from '../lib/store';
import { money, n, qty as fq, date, datetime, smartTime } from '../lib/format';
import {
  Button, IconButton, Input, Select, Modal, Field, MoneyInput, Empty,
  Spinner, Badge, Textarea, SearchInput, ErrorBox, Confirm,
} from './ui';
import DeliveryNotePrint from './DeliveryNotePrint';

/** Nhãn, màu và icon của từng chặng. */
export const DELIVERY_STEPS = {
  pending: { label: 'Chờ giao', tone: 'slate', icon: Package,
    hint: 'Hàng còn ở tiệm, chưa có ai cầm đi' },
  shipping: { label: 'Đang giao', tone: 'amber', icon: Truck,
    hint: 'Người giao đã cầm hàng đi' },
  delivered: { label: 'Đã giao', tone: 'sky', icon: CheckCircle2,
    hint: 'Khách nhận được hàng, nhưng tiền chưa chắc đã về' },
  collected: { label: 'Đã thu tiền', tone: 'emerald', icon: Banknote,
    hint: 'Tiền đã về tới két, đơn này xong' },
  returned: { label: 'Giao không được', tone: 'red', icon: Undo2,
    hint: 'Hàng quay về tiệm' },
  cancelled: { label: 'Bỏ giao', tone: 'slate', icon: X, hint: '' },
};

const TONE_CLASS = {
  slate: 'bg-slate-100 text-slate-700 border-slate-300',
  amber: 'bg-amber-100 text-amber-800 border-amber-300',
  sky: 'bg-sky-100 text-sky-800 border-sky-300',
  emerald: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  red: 'bg-red-100 text-red-700 border-red-300',
};

/** Chặng kế tiếp gợi ý cho mỗi chặng — để có nút bấm một phát. */
const NEXT_STEP = {
  pending: 'shipping',
  shipping: 'delivered',
  delivered: 'collected',
};

export function StepBadge({ status, size = 'md' }) {
  const s = DELIVERY_STEPS[status];
  if (!s) return null;
  const Icon = s.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-semibold
                  ${size === 'sm' ? 'text-2xs' : 'text-xs'} ${TONE_CLASS[s.tone]}`}
      title={s.hint}
    >
      <Icon size={size === 'sm' ? 11 : 12} aria-hidden="true" />
      {s.label}
    </span>
  );
}

/* ==================== CHUÔNG ĐƠN ĐANG GIAO ======================== */

/**
 * Nút trên thanh đầu màn hình bán hàng.
 * Chỉ hiện khi thật sự có đơn đang trên đường — không có thì ẩn đi cho
 * thanh đầu đỡ chật.
 */
export function DeliveryBell({ onOpen }) {
  const { data, reload } = useFetch(() => api.get('/deliveries', { active: '1', page_size: 1 }), []);

  useEffect(() => {
    const t = setInterval(reload, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [reload]);

  const active = data?.total || 0;
  const money_ = data?.pending_money || 0;
  if (!active) return null;

  return (
    <button
      onClick={onOpen}
      className="relative h-9 px-2.5 rounded border text-[13px] font-semibold hidden md:flex items-center gap-1.5
                 transition-colors duration-150 cursor-pointer
                 bg-white/10 border-white/15 text-slate-300 hover:text-white"
      title={money_ > 0
        ? `${active} đơn đang giao, còn phải thu ${money(money_)}`
        : `${active} đơn đang giao`}
      aria-label={`${active} đơn đang giao`}
    >
      <Truck size={14} aria-hidden="true" />
      {n(active)} đang giao
    </button>
  );
}

/* ====================== BẢNG THEO DÕI ============================= */

export function DeliveryBoard({ open, onClose }) {
  const { user, toast, can } = useApp();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [onlyActive, setOnlyActive] = useState(true);
  const [printing, setPrinting] = useState(null);
  const [collecting, setCollecting] = useState(null);
  const [detail, setDetail] = useState(null);

  const { data, busy, error, reload } = useFetch(
    () => api.get('/deliveries', {
      status, q: dq, active: onlyActive && !status ? '1' : '', page_size: 100,
    }),
    [status, dq, onlyActive, open]
  );

  if (!open) return null;

  const rows = data?.rows || [];
  const counts = data?.counts || {};

  /* Chuyển chặng. Sang "đã thu tiền" thì hỏi lại số tiền trước, vì việc
     đó sinh ra phiếu thu thật — bấm nhầm là sổ quỹ sai. */
  const step = async (row, next) => {
    if (next === 'collected' && row.owed > 0) { setCollecting(row); return; }
    try {
      await api.put(`/sales/${row.id}/delivery`, { delivery_status: next, user_id: user?.id });
      toast(`${row.code}: ${DELIVERY_STEPS[next].label.toLowerCase()}`, 'ok');
      reload();
    } catch (e) {
      toast(e.message, 'bad', 6000);
    }
  };

  const openNote = async (row) => {
    try {
      setPrinting(await api.get(`/deliveries/${row.id}`));
    } catch (e) {
      toast(e.message, 'bad', 6000);
    }
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title="Theo dõi giao hàng"
        subtitle={data
          ? `${n(data.total)} đơn${data.pending_money > 0 ? ` · còn phải thu ${money(data.pending_money)}` : ''}`
          : ''}
        size="xl"
        footer={<Button onClick={onClose}>Đóng</Button>}
      >
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={q} onChange={setQ}
              placeholder="Tìm mã hoá đơn, tên khách, địa chỉ, mã vận đơn..."
              className="w-full sm:w-80"
            />
            <div className="flex-1" />
            <label className="flex items-center gap-1.5 text-[13px] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyActive}
                disabled={!!status}
                onChange={(e) => setOnlyActive(e.target.checked)}
              />
              Chỉ đơn chưa xong
            </label>
          </div>

          {/* Thẻ lọc theo chặng, kèm số đơn đang ở chặng đó */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setStatus('')}
              className={`btn btn-sm ${status === '' ? 'btn-secondary' : 'btn-outline'}`}
            >
              Tất cả
            </button>
            {Object.entries(DELIVERY_STEPS).map(([k, s]) => {
              const Icon = s.icon;
              return (
                <button
                  key={k}
                  onClick={() => setStatus(status === k ? '' : k)}
                  title={s.hint}
                  className={`btn btn-sm ${status === k ? 'btn-secondary' : 'btn-outline'}`}
                >
                  <Icon size={13} aria-hidden="true" />
                  {s.label}
                  {counts[k] > 0 && (
                    <span className="ml-0.5 font-bold">{n(counts[k])}</span>
                  )}
                </button>
              );
            })}
          </div>

          {error && <ErrorBox error={error} onRetry={reload} />}
          {busy && !data && <Spinner />}

          {data && rows.length === 0 && (
            <Empty
              icon={Truck}
              title="Không có đơn giao hàng nào"
              sub={onlyActive
                ? 'Mọi đơn đã giao xong và thu đủ tiền.'
                : 'Hoá đơn có địa chỉ giao hàng sẽ hiện ở đây.'}
            />
          )}

          {rows.length > 0 && (
            <div className="max-h-[52vh] overflow-y-auto border border-line rounded-lg">
              <table className="table">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th>Hoá đơn</th>
                    <th>Người nhận</th>
                    <th>Chặng</th>
                    <th className="text-right">Cần thu</th>
                    <th>Người giao</th>
                    <th style={{ width: 200 }}>Việc tiếp theo</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const next = NEXT_STEP[row.delivery_status];
                    const late = row.days_out >= 3
                      && ['pending', 'shipping', 'delivered'].includes(row.delivery_status);
                    return (
                      <tr key={row.id} className="hover:bg-muted/60">
                        <td>
                          <button
                            className="text-accent hover:underline font-semibold"
                            onClick={() => setDetail(row)}
                          >
                            {row.code}
                          </button>
                          <div className="text-2xs text-muted-ink">
                            {date(row.ts)}
                            {late && (
                              <span className="ml-1 text-danger font-semibold">
                                · {n(row.days_out)} ngày rồi
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="font-medium">
                            {row.delivery_name || row.customer_name || 'Khách lẻ'}
                          </div>
                          <div className="text-2xs text-muted-ink truncate" style={{ maxWidth: 220 }}>
                            {row.delivery_phone || row.customer_phone || ''}
                            {row.delivery_address ? ` · ${row.delivery_address}` : ''}
                          </div>
                        </td>
                        <td><StepBadge status={row.delivery_status} /></td>
                        <td className="num">
                          {row.owed > 0
                            ? <span className="font-semibold text-danger">{money(row.owed)}</span>
                            : <span className="text-muted-ink">đã trả</span>}
                        </td>
                        <td className="text-[13px]">
                          {row.shipper_name || row.carrier_name || <span className="text-muted-ink">—</span>}
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            {next && (
                              <Button
                                size="sm"
                                variant={next === 'collected' ? 'primary' : 'secondary'}
                                icon={DELIVERY_STEPS[next].icon}
                                onClick={() => step(row, next)}
                              >
                                {DELIVERY_STEPS[next].label}
                              </Button>
                            )}
                            <IconButton
                              icon={Printer}
                              label={`In phiếu giao ${row.code}`}
                              onClick={() => openNote(row)}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      {printing && <DeliveryNotePrint note={printing} onClose={() => setPrinting(null)} />}

      {collecting && (
        <CollectFromShipper
          row={collecting}
          onClose={() => setCollecting(null)}
          onDone={() => { setCollecting(null); reload(); }}
        />
      )}

      {detail && (
        <DeliveryDetail
          row={detail}
          onClose={() => setDetail(null)}
          onChanged={reload}
          onPrint={() => { openNote(detail); setDetail(null); }}
        />
      )}
    </>
  );
}

/* ================= NGƯỜI GIAO NỘP TIỀN VỀ ========================= */

/**
 * Người giao mang tiền về. Việc này sinh ra phiếu thu thật và xoá nợ của
 * hoá đơn, nên phải hỏi lại rõ số tiền chứ không chỉ đổi một chữ trạng
 * thái — bấm nhầm thì sổ quỹ sai mà không ai biết.
 */
function CollectFromShipper({ row, onClose, onDone }) {
  const { user, toast } = useApp();
  const { data: accounts } = useFetch(() => api.get('/cash/accounts'), []);
  const [amount, setAmount] = useState(row.owed);
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (accounts?.length && !accountId) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  const short_ = row.owed - amount;

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const res = await api.put(`/sales/${row.id}/delivery`, {
        delivery_status: 'collected',
        amount, account_id: accountId, user_id: user?.id,
        delivery_note: note || undefined,
      });
      toast(
        res.receipt
          ? `Đã thu ${money(amount)} — phiếu thu ${res.receipt.code}`
          : `${row.code}: đã thu tiền`,
        'ok', 5000);
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
      title="Người giao nộp tiền"
      subtitle={`${row.code} · ${row.delivery_name || row.customer_name || 'Khách lẻ'}`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Huỷ</Button>
          <Button variant="primary" icon={Banknote} loading={busy}
            onClick={submit} disabled={busy || amount <= 0}>
            Thu {money(amount)}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {err && <ErrorBox error={err} title="Chưa lưu được" />}

        <div className="rounded-lg bg-muted p-2.5 text-[13px] space-y-0.5">
          <div className="flex justify-between">
            <span className="text-muted-ink">Tiền hàng của đơn</span>
            <span className="font-semibold">{money(row.total)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-ink">Khách đã trả trước</span>
            <span>{money(row.paid)}</span>
          </div>
          <div className="flex justify-between border-t border-line pt-1 mt-1">
            <span className="font-semibold">Người giao phải nộp về</span>
            <span className="font-bold text-danger">{money(row.owed)}</span>
          </div>
        </div>

        <Field label="Số tiền thực nhận">
          <MoneyInput value={amount} onChange={(v) => setAmount(Math.max(0, Math.min(v, row.owed)))} />
          <div className="flex gap-1 mt-1.5">
            <button className="btn btn-sm btn-outline" onClick={() => setAmount(row.owed)}>
              Đủ {money(row.owed)}
            </button>
          </div>
        </Field>

        {short_ > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[13px] text-amber-900">
            <div className="flex items-start gap-1.5">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                Nộp thiếu <b>{money(short_)}</b>. Phần thiếu vẫn treo nợ trên hoá đơn
                {row.customer_name ? ` của ${row.customer_name}` : ''}, đơn giao coi như đã xong.
                Nếu người giao hẹn nộp nốt sau thì để đơn ở chặng &ldquo;Đã giao&rdquo; sẽ dễ nhớ hơn.
              </div>
            </div>
          </div>
        )}

        <Field label="Nộp vào quỹ">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {(accounts || []).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </Field>

        <Field label="Ghi chú" hint="không bắt buộc">
          <Input value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Ví dụ: anh Hùng nộp lúc 5 giờ chiều" />
        </Field>
      </div>
    </Modal>
  );
}

/* ==================== XEM VÀ SỬA MỘT ĐƠN GIAO ===================== */

function DeliveryDetail({ row, onClose, onChanged, onPrint }) {
  const { user, toast } = useApp();
  const { data: carriers } = useFetch(() => api.get('/carriers'), []);
  const [shipper, setShipper] = useState(row.shipper_name || '');
  const [tracking, setTracking] = useState(row.tracking_code || '');
  const [carrierId, setCarrierId] = useState(row.carrier_id || '');
  const [note, setNote] = useState(row.delivery_note || '');
  const [status, setStatus] = useState(row.delivery_status);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  /* Chuyển thẳng sang "đã thu tiền" ở đây thì bỏ qua mất bước hỏi số tiền,
     nên chặn lại và chỉ cho làm từ nút ngoài bảng. */
  const moneyStep = status === 'collected' && row.delivery_status !== 'collected' && row.owed > 0;

  const save = async () => {
    setBusy(true); setErr('');
    try {
      await api.put(`/sales/${row.id}/delivery`, {
        delivery_status: status,
        shipper_name: shipper, tracking_code: tracking,
        carrier_id: carrierId || null, delivery_note: note,
        user_id: user?.id,
      });
      toast('Đã lưu thông tin giao hàng', 'ok');
      onChanged?.();
      onClose();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  const steps = ['pending', 'shipping', 'delivered', 'collected'];
  const at = { shipping: row.shipped_at, delivered: row.delivered_at, collected: row.collected_at };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Đơn giao ${row.code}`}
      subtitle={`${row.delivery_name || row.customer_name || 'Khách lẻ'} · ${date(row.ts)}`}
      footer={
        <>
          <Button icon={Printer} onClick={onPrint} className="mr-auto">In phiếu giao</Button>
          <Button onClick={onClose} disabled={busy}>Đóng</Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={busy || moneyStep}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {err && <ErrorBox error={err} title="Chưa lưu được" />}

        {/* Đường đi của đơn, kèm giờ từng chặng */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {steps.map((k, i) => {
            const s = DELIVERY_STEPS[k];
            const Icon = s.icon;
            const done = steps.indexOf(row.delivery_status) >= i;
            return (
              <div key={k} className="flex items-center gap-1 shrink-0">
                {i > 0 && <div className={`h-px w-4 ${done ? 'bg-accent' : 'bg-line'}`} />}
                <div className={`flex flex-col items-center gap-0.5 px-1.5 py-1 rounded
                                 ${done ? 'text-accent' : 'text-muted-ink'}`}>
                  <Icon size={16} aria-hidden="true" />
                  <span className="text-2xs font-semibold whitespace-nowrap">{s.label}</span>
                  <span className="text-2xs whitespace-nowrap">
                    {at[k] ? smartTime(at[k]) : (k === 'pending' ? smartTime(row.ts) : '—')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-lg bg-muted p-2.5 text-[13px] space-y-1">
          {row.delivery_address && (
            <div className="flex items-start gap-1.5">
              <MapPin size={14} className="shrink-0 mt-0.5 text-muted-ink" aria-hidden="true" />
              {row.delivery_address}
            </div>
          )}
          {(row.delivery_phone || row.customer_phone) && (
            <div className="flex items-center gap-1.5">
              <Phone size={14} className="shrink-0 text-muted-ink" aria-hidden="true" />
              {row.delivery_phone || row.customer_phone}
            </div>
          )}
          <div className="flex justify-between border-t border-line pt-1 mt-1">
            <span className="text-muted-ink">Tiền hàng</span>
            <span className="font-semibold">{money(row.total)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-ink">Còn phải thu</span>
            <span className={row.owed > 0 ? 'font-bold text-danger' : ''}>
              {row.owed > 0 ? money(row.owed) : 'đã thu đủ'}
            </span>
          </div>
        </div>

        <Field label="Chặng">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(DELIVERY_STEPS).map(([k, s]) => (
              <option key={k} value={k}>{s.label}</option>
            ))}
          </Select>
          {moneyStep && (
            <div className="text-xs text-amber-700 mt-1">
              Đơn này còn phải thu {money(row.owed)}. Đóng hộp thoại rồi bấm
              nút <b>Đã thu tiền</b> ngoài bảng để phần mềm ghi phiếu thu cho đúng.
            </div>
          )}
        </Field>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="Người giao" hint="ai cầm hàng đi">
            <Input value={shipper} onChange={(e) => setShipper(e.target.value)}
              placeholder="Tên người giao" />
          </Field>
          <Field label="Nhà xe / đơn vị vận chuyển">
            <Select value={carrierId} onChange={(e) => setCarrierId(e.target.value)}>
              <option value="">— Tiệm tự giao —</option>
              {(carriers || []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Mã vận đơn" hint="không bắt buộc">
          <Input value={tracking} onChange={(e) => setTracking(e.target.value)} />
        </Field>

        <Field label="Ghi chú giao hàng">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Ví dụ: gọi trước khi tới, nhà có chó" />
        </Field>
      </div>
    </Modal>
  );
}
