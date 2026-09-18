/* ====================================================================
   ĐẶT HÀNG VÀ ĐỔI TRẢ NGAY TẠI QUẦY

   Ba việc thu ngân hay phải làm giữa lúc đông khách, gom về màn hình bán
   hàng để khỏi phải nhảy qua màn hình khác rồi gõ lại từ đầu:

     - khách hỏi món hết hàng  -> biến giỏ hàng đang có thành đơn đặt
     - khách tới lấy hàng đã đặt -> mở đơn, chọn món giao, xuất hoá đơn
     - khách đem hàng lại đổi   -> trả món cũ, lấy món mới, bù trừ tiền

   Chuông trên thanh đầu đếm số đơn tới hẹn hoặc đã trễ, để thu ngân nhớ
   gọi khách mà không phải tự canh.
   ==================================================================== */
import { useState, useMemo, useEffect } from 'react';
import {
  ClipboardList, Bell, Truck, Search, RefreshCcw, Plus, Trash2,
  AlertTriangle, CheckCircle2, Package, X, Printer,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, useDebounced } from '../lib/store';
import { useLiveReload, useChangeReload } from '../lib/useLive';
import { money, n, qty as fq, date, datetime, isoDate, match } from '../lib/format';
import {
  Button, IconButton, Input, Select, Modal, Field, MoneyInput, Empty,
  Spinner, Badge, Combo, Textarea, QtyInput, SearchInput, TotalRow, ErrorBox,
} from './ui';
import InvoicePrint from './InvoicePrint';
import DeliveryInfoModal, { EMPTY_DELIVERY, deliveryBody, normalizeDelivery } from './PosDeliveryForm';
import DeliveryNotePrint from './DeliveryNotePrint';

/* ==================== CHUÔNG ĐƠN TỚI HẸN ========================== */

/**
 * Nút chuông trên thanh đầu màn hình bán hàng.
 * Đếm đơn tới hẹn giao hôm nay và đơn đã quá hẹn. Tự làm mới mỗi 5 phút —
 * đủ để không bỏ sót mà không làm nặng máy chủ.
 */
/* ================== ĐÈN HẠN GIAO (plan 31, hạng mục 1.5b) =================
 * Máy chủ tính sẵn `due_state` cho đơn còn chờ giao:
 *   late   quá ngày hẹn          · today  hẹn giao hôm nay
 *   soon   còn tối đa một ngày làm việc — KHÔNG đếm Thứ 7, Chủ nhật
 *   later  chưa tới hạn
 */
export const DUE = {
  late: { label: 'Trễ hẹn', short: 'trễ', dot: 'bg-red-500', pill: 'bg-red-50 border-red-300 text-red-800' },
  today: { label: 'Giao hôm nay', short: 'hôm nay', dot: 'bg-orange-500', pill: 'bg-orange-50 border-orange-300 text-orange-900' },
  soon: { label: 'Gần hạn', short: 'gần hạn', dot: 'bg-amber-400', pill: 'bg-amber-50 border-amber-300 text-amber-900' },
  later: { label: 'Chưa tới hạn', short: 'chưa tới', dot: 'bg-emerald-500', pill: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
};

/* ============ NGUỒN HÀNG CỦA ĐƠN (BRD nâng cấp, mục 2) ============
 * Khách đặt món tiệm không đủ tồn: phải nhớ đi đặt của mối, rồi đánh dấu lại
 * để cả tiệm biết đơn đó đang chờ hàng về chứ không phải chờ ai đi đặt.
 */
export const SUPPLY = {
  ready: { label: 'Đủ hàng — chờ giao', short: 'đủ hàng', dot: 'bg-emerald-500', pill: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
  short: { label: 'Chờ đặt hàng NCC', short: 'cần đặt', dot: 'bg-rose-500', pill: 'bg-rose-50 border-rose-300 text-rose-800' },
  partial: { label: 'Chờ đặt NCC thêm', short: 'đặt thiếu', dot: 'bg-violet-500', pill: 'bg-violet-50 border-violet-300 text-violet-800' },
  ordered: { label: 'Đã đặt NCC — chưa về', short: 'chờ hàng', dot: 'bg-sky-500', pill: 'bg-sky-50 border-sky-300 text-sky-800' },
};

export function SupplyBadge({ supply, showReady = false }) {
  const st = supply?.state;
  const d = SUPPLY[st];
  if (!d || (st === 'ready' && !showReady)) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-2xs font-semibold whitespace-nowrap ${d.pill}`}>
      <span className={`w-2 h-2 rounded-full ${d.dot}`} aria-hidden="true" />
      {d.label}
      {st === 'partial' && supply.short_lines > 0 && (
        <span className="font-normal">({supply.short_lines - supply.done_lines} món còn thiếu)</span>
      )}
    </span>
  );
}

/** Nhãn đèn hạn giao cạnh ngày hẹn. */
export function DueBadge({ state }) {
  const d = DUE[state];
  if (!d) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-2xs font-semibold whitespace-nowrap ${d.pill}`}>
      <span className={`w-2 h-2 rounded-full ${d.dot}`} aria-hidden="true" />
      {d.label}
    </span>
  );
}

const SEEN_KEY = 'thpos.orders.seen';
const readSeen = () => { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } };

export function OrderBell({ onOpen }) {
  const { data, reload } = useFetch(() => api.ordersSummary(), []);
  const [seen, setSeen] = useState(readSeen);

  /* Cập nhật ngay khi vừa lưu / giao / huỷ một đơn ở chính máy này, và mỗi phút
     một lần cho đơn máy khác vừa lưu — trước đây năm phút mới đếm lại nên phải
     chuyển trang mới thấy đơn "hôm nay", "gần hạn" (BRD mục 2). */
  useChangeReload(reload, ['/orders']);
  useLiveReload(reload, { interval: 60000 });

  const open = data?.open_count || 0;
  const maxId = data?.max_id || 0;
  /* Đơn mới do máy khác vừa lưu — quầy phải thấy ngay mà không cần đọc bảng (mục 2) */
  const fresh = maxId > seen;
  const needPo = (data?.short_count || 0) + (data?.partial_po_count || 0);
  const openList = () => {
    if (maxId) { try { localStorage.setItem(SEEN_KEY, String(maxId)); } catch { /* bộ nhớ bị chặn */ } setSeen(maxId); }
    onOpen?.();
  };
  if (!open) return null;
  const counts = {
    late: data?.late_count || 0, today: data?.today_count || 0,
    soon: data?.soon_count || 0, later: data?.later_count || 0,
  };
  /* Chỉ hiện những đèn đang sáng; không đơn nào gấp thì hiện tổng số đơn */
  const lit = ['late', 'today', 'soon'].filter((k) => counts[k] > 0);
  const tone = counts.late ? 'bg-red-500/20 border-red-400/40 text-red-100 hover:bg-red-500/30'
    : counts.today ? 'bg-orange-500/20 border-orange-400/40 text-orange-100 hover:bg-orange-500/30'
      : counts.soon ? 'bg-amber-400/15 border-amber-300/40 text-amber-100 hover:bg-amber-400/25'
        : 'bg-white/10 border-white/15 text-slate-300 hover:text-white';
  const summary = ['late', 'today', 'soon', 'later']
    .filter((k) => counts[k] > 0)
    .map((k) => `${counts[k]} đơn ${DUE[k].label.toLowerCase()}`)
    .join(' · ');

  const title = `${summary}${counts.soon ? ' (gần hạn không tính Thứ 7, Chủ nhật)' : ''}`
    + (needPo ? ` · ${needPo} đơn còn thiếu hàng cần đặt của mối` : '')
    + (fresh ? ' · có đơn mới' : '');

  return (
    <button
      onClick={openList}
      className={`relative h-9 px-2.5 rounded border text-[13px] font-semibold hidden md:flex items-center gap-2
                  transition-colors duration-150 cursor-pointer ${fresh ? 'ring-2 ring-amber-300' : ''} ${tone}`}
      title={title}
      aria-label={`Đơn đặt hàng: ${summary || `${open} đơn đang chờ`}`
        + (needPo ? `, ${needPo} đơn cần đặt hàng của nhà cung cấp` : '')
        + (fresh ? ', có đơn mới' : '')}
    >
      <Bell size={14} aria-hidden="true" />
      {lit.length ? lit.map((k) => (
        <span key={k} className="inline-flex items-center gap-1 whitespace-nowrap">
          <span className={`w-2 h-2 rounded-full ${DUE[k].dot}`} aria-hidden="true" />
          <span className="tabular">{n(counts[k])}</span> {DUE[k].short}
        </span>
      )) : `${n(open)} đơn`}
      {/* Còn đơn thiếu hàng chưa đặt mối: nhắc ngay ngoài quầy */}
      {needPo > 0 && (
        <span className="inline-flex items-center gap-1 whitespace-nowrap border-l border-white/20 pl-2">
          <span className="w-2 h-2 rounded-full bg-rose-400" aria-hidden="true" />
          <span className="tabular">{n(needPo)}</span> cần đặt
        </span>
      )}
      {fresh && (
        <span className="absolute -top-1 -right-1 flex h-3 w-3" aria-hidden="true">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-300 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-400 border border-amber-200" />
        </span>
      )}
    </button>
  );
}

/* ============== BIẾN GIỎ HÀNG THÀNH ĐƠN ĐẶT HÀNG =================== */

/**
 * Khách hỏi món tiệm hết hàng: giỏ đang gõ dở biến thẳng thành đơn đặt,
 * nhận cọc luôn. Không phải mở màn hình khác gõ lại.
 */
export function SaveAsOrderModal({ open, onClose, tab, customer, totals, onSaved }) {
  const { user, meta, toast, defaultWarehouse } = useApp();
  const [promisedAt, setPromisedAt] = useState(isoDate(new Date(Date.now() + 7 * 86400000)));
  const [deposit, setDeposit] = useState(0);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPromisedAt(isoDate(new Date(Date.now() + 7 * 86400000)));
    setDeposit(0);
    setNote(tab?.note || '');
    setGuestName('');
    setGuestPhone('');
  }, [open, tab?.note]);

  const total = totals?.total ?? 0;

  const submit = async () => {
    if (!tab?.cart?.length) return toast('Giỏ hàng đang trống', 'bad');
    setBusy(true);
    try {
      const res = await api.post('/orders', {
        customer_id: tab.customerId || null,
        customer_name: tab.customerId ? null : (guestName.trim() || null),
        customer_phone: tab.customerId ? null : (guestPhone.trim() || null),
        warehouse_id: defaultWarehouse,
        price_list_id: tab.priceListId || null,
        user_id: user?.id || null,
        promised_at: promisedAt || null,
        items: tab.cart.map((l) => ({
          product_id: l.product_id,
          name_snapshot: l.name,
          unit_name: l.unit_name,
          factor: l.factor,
          qty: l.qty,
          price: l.price,
          discount_type: l.discountType,
          discount: l.discountType === 'amount' ? l.discountValue : 0,
          discount_percent: l.discountType === 'percent' ? l.discountValue : 0,
          note: l.note || null,
        })),
        discount_type: tab.discountType,
        discount: tab.discountType === 'amount' ? tab.discountValue : 0,
        discount_percent: tab.discountType === 'percent' ? tab.discountValue : 0,
        delivery_name: tab.delivery?.name || null,
        delivery_phone: tab.delivery?.phone || null,
        delivery_address: tab.delivery?.address || null,
        carrier_id: tab.delivery?.carrier_id || null,
        deposit: Number(deposit) || 0,
        account_id: accountId || null,
        note: note || null,
      });
      toast(`Đã lập đơn đặt hàng ${res.code}`, 'ok', 6000);
      onSaved?.(res);
      onClose();
    } catch (e) {
      toast(e.message, 'bad', 7000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Chuyển giỏ hàng thành đơn đặt"
      subtitle="Hàng chưa có trong kho vẫn đặt được. Kho chỉ trừ lúc giao hàng."
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" icon={ClipboardList} onClick={submit} loading={busy}>
            Lập đơn đặt hàng
          </Button>
        </>
      }
    >
      <div className="space-y-2.5">
        <div className="card p-2.5 bg-muted/50 text-[13px] space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-ink">Khách hàng</span>
            <span className="font-semibold">{customer?.name || 'Khách lẻ'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-ink">Số mặt hàng</span>
            <span className="tabular font-semibold">{n(tab?.cart?.length || 0)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-ink">Tổng tiền đơn</span>
            <span className="tabular font-bold">{money(total)}</span>
          </div>
        </div>

        {!tab?.customerId && (
          <div className="grid sm:grid-cols-2 gap-2.5">
            <Field label="Tên khách" hint="Để còn gọi khi hàng về" htmlFor="so-name">
              <Input id="so-name" value={guestName} onChange={(e) => setGuestName(e.target.value)}
                placeholder="VD: Chú Tám thợ điện" autoFocus />
            </Field>
            <Field label="Số điện thoại" htmlFor="so-phone">
              <Input id="so-phone" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)}
                inputMode="tel" placeholder="09xx xxx xxx" />
            </Field>
          </div>
        )}

        <Field label="Hẹn ngày giao" htmlFor="so-date">
          <Input id="so-date" type="date" value={promisedAt} onChange={(e) => setPromisedAt(e.target.value)} />
        </Field>

        <Field label="Khách đặt cọc" hint="Tiền vào quỹ ngay, giao hàng sẽ tự trừ vào hoá đơn">
          <MoneyInput value={deposit} onChange={setDeposit} />
        </Field>
        <div className="flex gap-1.5 flex-wrap">
          {/* Chỉ gợi ý mức cọc không vượt quá tổng đơn — cọc quá tiền hàng
              thì máy chủ chặn, mà thu ngân không hiểu vì sao bấm không được */}
          {[Math.round(total * 0.3), Math.round(total / 2), 500000, total]
            .filter((v, i, a) => v > 0 && v <= total && a.indexOf(v) === i)
            .map((v) => (
              <button key={v} type="button" className="btn btn-sm" onClick={() => setDeposit(v)}>
                {money(v)}
              </button>
            ))}
        </div>

        {Number(deposit) > 0 && (
          <>
            <Field label="Cọc vào quỹ">
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Quỹ mặc định</option>
                {meta.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
            <div className="text-[13px] text-muted-ink tabular">
              Còn lại khi nhận hàng: <b className="text-ink">{money(Math.max(0, total - deposit))}</b>
            </div>
          </>
        )}

        <Field label="Ghi chú" htmlFor="so-note">
          <Textarea id="so-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="VD: khách dặn gọi trước khi giao" />
        </Field>
      </div>
    </Modal>
  );
}

/* ============ MỞ ĐƠN ĐÃ ĐẶT ĐỂ GIAO HÀNG TẠI QUẦY ================== */

export function PickOrderModal({ open, onClose, onDelivered }) {
  const { store, settings } = useApp();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null);
  const [printing, setPrinting] = useState(null);   // hoá đơn vừa xuất, chờ in
  const dq = useDebounced(q, 300);

  const { data, busy, error, reload } = useFetch(
    () => api.orders({ q: dq, page_size: 50 }),
    [dq],
    { skip: !open }
  );

  useEffect(() => { if (open) { setQ(''); setPicked(null); } }, [open]);

  const rows = (data?.rows || []).filter((o) => o.status === 'open' || o.status === 'partial');

  /* Hoá đơn vừa xuất — hiện mẫu in đè lên, đóng lại thì thoát luôn */
  if (printing) {
    return (
      <InvoicePrint
        sale={printing}
        store={store}
        invoice={settings?.invoice || {}}
        onClose={() => { setPrinting(null); onClose(); }}
      />
    );
  }

  if (open && picked) {
    return (
      <DeliverAtCounter
        orderId={picked}
        onClose={() => setPicked(null)}
        onDone={(res, sale) => {
          setPicked(null);
          reload();
          onDelivered?.(res);
          if (sale) setPrinting(sale);      // in ngay, khách còn đứng đó
          else onClose();
        }}
      />
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Khách tới lấy hàng đã đặt"
      subtitle="Tìm đơn theo mã, tên khách hoặc số điện thoại"
      size="xl"
      footer={<Button onClick={onClose}>Đóng</Button>}
    >
      <div className="space-y-2">
        <SearchInput value={q} onChange={setQ} placeholder="Gõ tên khách, số điện thoại hoặc mã đơn..." autoFocus />

        {busy && !data ? <Spinner />
          : error ? <ErrorBox error={error} onRetry={reload} />
            : rows.length === 0 ? (
              <Empty
                icon={ClipboardList}
                title="Không có đơn nào đang chờ"
                message={q ? `Không tìm thấy đơn khớp "${q}".` : 'Mọi đơn đặt hàng đều đã giao xong.'}
              />
            ) : (
              <div className="table-wrap max-h-[52vh]">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Mã đơn</th><th>Khách hàng</th><th>Hẹn giao</th>
                      {/* Đơn còn thiếu hàng: chờ đặt NCC, chờ đặt thêm, hay đã đặt mà chưa về.
                          Đủ hàng thì ô trống — giao được ngay (BRD nâng cấp, mục 2). */}
                      <th>Tình trạng hàng</th>
                      <th className="text-right">Tổng tiền</th>
                      <th className="text-right">Cọc còn</th>
                      <th style={{ width: 90 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((o) => (
                      <tr key={o.id} className="hover:bg-muted/60 cursor-pointer" onClick={() => setPicked(o.id)}>
                        <td className="font-semibold tabular">{o.code}</td>
                        <td>
                          <div className="truncate max-w-[13rem]">{o.customer_display}</div>
                          {o.phone_display && <div className="text-2xs text-muted-ink tabular">{o.phone_display}</div>}
                        </td>
                        <td className="whitespace-nowrap">
                          {o.promised_at ? (
                            <div className="flex flex-col items-start gap-0.5">
                              <span className={o.due_state === 'late' ? 'text-danger font-semibold' : ''}>{date(o.promised_at)}</span>
                              <DueBadge state={o.due_state} />
                            </div>
                          ) : <span className="text-muted-ink">—</span>}
                        </td>
                        <td><SupplyBadge supply={o.supply} /></td>
                        <td className="text-right tabular">{money(o.total)}</td>
                        <td className="text-right tabular">
                          {o.deposit_left > 0 ? money(o.deposit_left) : <span className="text-muted-ink">—</span>}
                        </td>
                        <td className="text-center">
                          <Button size="sm" variant="soft" icon={Truck}
                            onClick={(e) => { e.stopPropagation(); setPicked(o.id); }}>
                            Giao
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

/** Chọn món giao và xuất hoá đơn cho một đơn cụ thể. */
function DeliverAtCounter({ orderId, onClose, onDone }) {
  const { user, meta, toast } = useApp();
  const { data: o, busy: loading } = useFetch(() => api.order(orderId), [orderId]);
  const [qtys, setQtys] = useState({});
  const [paid, setPaid] = useState(0);
  const [method, setMethod] = useState('cash');
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  /* Khách nhờ giao tận nơi ngay lúc tới lấy (BRD mục 2): dùng đúng hộp thông tin
     giao hàng của màn hình bán hàng, không dựng thêm mẫu thứ hai. */
  const [ship, setShip] = useState(null);          // null = khách tự lấy
  const [editShip, setEditShip] = useState(false);
  const { data: carriers } = useFetch(() => api.carriers(), []);

  const pending = useMemo(
    () => (o?.items || []).filter((i) => i.remaining_qty > 0.0001), [o]);

  useEffect(() => {
    if (!pending.length) return;
    // Mặc định giao hết phần còn lại, nhưng không vượt quá số đang có trong kho
    const m = {};
    for (const i of pending) {
      m[i.id] = Math.max(0, Math.min(i.remaining_qty, Math.floor((i.stock_qty / i.factor) * 1000) / 1000));
    }
    setQtys(m);
  }, [pending]);

  const chosen = pending.filter((i) => (qtys[i.id] || 0) > 0);
  const gross = chosen.reduce((a, i) => {
    const q = qtys[i.id] || 0;
    const g = Math.round(q * i.price);
    const d = i.discount_type === 'percent'
      ? Math.round(g * (i.discount_percent || 0) / 100)
      : Math.round((i.discount || 0) * (q / i.qty));
    return a + g - Math.min(d, g);
  }, 0);
  const orderDisc = o && o.subtotal > 0 ? Math.round(o.discount * (gross / o.subtotal)) : 0;
  const saleTotal = gross - Math.min(orderDisc, gross);
  const useDeposit = Math.min(o?.deposit_left || 0, saleTotal);
  const stillOwed = Math.max(0, saleTotal - useDeposit - (Number(paid) || 0));

  useEffect(() => { setPaid(Math.max(0, saleTotal - useDeposit)); }, [saleTotal, useDeposit]);

  /** thenPrint: xuất hoá đơn xong thì mở luôn mẫu in cho khách cầm về. */
  const submit = async (thenPrint = false) => {
    if (!chosen.length) return toast('Chưa chọn món nào để giao', 'bad');
    setBusy(true);
    try {
      const res = await api.post(`/orders/${o.id}/deliver`, {
        /* Khách tự lấy thì không vào bảng giao hàng; nhờ giao thì gửi kèm
           thông tin giao theo đúng mẫu chung */
        mode: ship ? 'ship' : 'pickup',
        ...(ship ? deliveryBody(ship) : {}),
        items: chosen.map((i) => ({ item_id: i.id, qty: qtys[i.id] })),
        paid: Number(paid) || 0,
        received: Number(paid) || 0,
        payment_method: method,
        account_id: accountId || null,
        user_id: user?.id || null,
      });
      toast(
        `Đã xuất hoá đơn ${res.sale_code}${res.status === 'done' ? ' — đơn đã giao xong' : ' — đơn còn hàng chưa giao'}`,
        'ok', 7000);

      /* Lấy hoá đơn đầy đủ để in. Lấy không được thì vẫn coi như giao xong —
         hoá đơn đã lưu chắc rồi, chỉ là không in được ngay. */
      let sale = null;
      if (thenPrint) {
        try { sale = await api.sale(res.sale_id); }
        catch { toast('Đã xuất hoá đơn nhưng chưa mở được bản in. Vào mục Hoá đơn để in.', 'bad', 8000); }
      }
      onDone?.(res, sale);
    } catch (e) {
      toast(e.message, 'bad', 7000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={o ? `Giao hàng — đơn ${o.code}` : 'Giao hàng'}
      subtitle={o ? `${o.customer_display}${o.phone_display ? ' · ' + o.phone_display : ''}` : ''}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Quay lại</Button>
          {/* Trước đây có thêm nút [Xuất hoá đơn giao hàng] không in. Bỏ đi
              vì thừa: giao hàng thì bao giờ cũng phải có tờ phiếu đưa người
              giao, mà hai nút cạnh nhau chỉ khác nhau chữ "và in" là hay bấm
              nhầm. Cần bản không in thì vào màn hình Hoá đơn in lại. */}
          <Button variant="primary" icon={Printer} onClick={() => submit(true)} loading={busy}
            disabled={!chosen.length}>
            Xuất hoá đơn giao hàng và in
          </Button>
        </>
      }
    >
      {loading || !o ? <Spinner /> : (
        <div className="space-y-3">
          {o.supply && o.supply.state !== 'ready' && (
            <p role="status" className="flex flex-wrap items-center gap-1.5 text-[13px] rounded-lg border border-line bg-muted/40 px-2.5 py-1.5">
              <SupplyBadge supply={o.supply} />
              <span className="text-muted-ink">
                Đơn còn món chưa đủ tồn — chỉ giao được phần đang có, phần còn lại giao lần sau.
              </span>
            </p>
          )}
          {/* Khách tới lấy, nhưng nhờ giao tận nhà luôn — chọn ngay ở đây (BRD mục 2) */}
          <div role="tablist" aria-label="Hình thức giao" className="grid grid-cols-2 gap-1.5">
            {[['pickup', 'Khách tự lấy', Package, 'Khách đứng ở quầy nhận hàng'],
              ['ship', 'Giao hàng tận nơi', Truck, 'Ghi địa chỉ, người giao, phí ship']].map(([k, label, Icon, hint]) => {
              const on = (k === 'ship') === !!ship;
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => {
                    if (k === 'pickup') { setShip(null); return; }
                    setShip((cur) => cur || normalizeDelivery({
                      ...EMPTY_DELIVERY,
                      name: o.customer_display === 'Khách lẻ' ? '' : o.customer_display || '',
                      phone: o.phone_display || '',
                      address: o.delivery_address || o.customer_address || '',
                    }));
                    setEditShip(true);
                  }}
                  className={`flex items-center gap-2 rounded-lg border p-2.5 text-left cursor-pointer transition-colors duration-150
                              focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent
                              ${on ? 'border-accent bg-accent-soft' : 'border-line hover:bg-muted'}`}
                >
                  <Icon size={18} className={on ? 'text-emerald-800' : 'text-muted-ink'} aria-hidden="true" />
                  <span>
                    <span className="block text-[13px] font-bold">{label}</span>
                    <span className="block text-2xs text-muted-ink">{hint}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {ship && (
            <div className="card p-2.5 flex items-start gap-2 text-[13px]">
              <Truck size={16} className="text-muted-ink shrink-0 mt-0.5" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">
                  {ship.name || o.customer_display}{ship.phone ? ` · ${ship.phone}` : ''}
                </div>
                <div className="text-muted-ink">{ship.address || 'Chưa ghi địa chỉ giao'}</div>
                <div className="text-2xs text-muted-ink">
                  {[ship.carrierName && `hãng ${ship.carrierName}`,
                    ship.shipperMode === 'staff' && ship.shipperUserName && `người giao: ${ship.shipperUserName}`,
                    ship.shipperMode === 'free' && (ship.shipperName || ship.shipperPhone) && `shipper: ${[ship.shipperName, ship.shipperPhone].filter(Boolean).join(' ')}`,
                    Number(ship.shipFee) > 0 && `phí ${money(ship.shipFee)}${ship.shopPaysShip ? ' (tiệm chịu)' : ''}`,
                    ship.note].filter(Boolean).join(' · ') || 'Chưa có người giao — bấm Sửa để điền'}
                </div>
              </div>
              <Button size="sm" onClick={() => setEditShip(true)}>Sửa</Button>
            </div>
          )}

          <DeliveryInfoModal
            open={editShip}
            onClose={() => setEditShip(false)}
            value={ship}
            customer={{ name: o.customer_display, phone: o.phone_display, address: o.customer_address }}
            carriers={carriers || []}
            goodsTotal={saleTotal}
            canPay={false}
            onSave={(v) => { setShip(normalizeDelivery(v)); setEditShip(false); }}
            onClear={() => { setShip(null); setEditShip(false); }}
          />

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Tên hàng</th><th>Đơn vị</th>
                  <th className="text-right">Còn phải giao</th>
                  <th className="text-right">Kho có</th>
                  <th style={{ width: 104 }} className="text-right">Giao lần này</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((i) => {
                  const maxByStock = Math.floor((i.stock_qty / i.factor) * 1000) / 1000;
                  const notEnough = maxByStock < i.remaining_qty;
                  return (
                    <tr key={i.id}>
                      <td>{i.name_snapshot}</td>
                      <td>{i.unit_name}</td>
                      <td className="text-right tabular">{fq(i.remaining_qty)}</td>
                      <td className={`text-right tabular ${notEnough ? 'text-warn font-semibold' : 'text-muted-ink'}`}>
                        {fq(maxByStock)}
                        {notEnough && <span className="ml-1 text-2xs">thiếu</span>}
                      </td>
                      <td>
                        <QtyInput
                          value={qtys[i.id] || 0}
                          onChange={(v) => setQtys((m) => ({ ...m, [i.id]: Math.min(v, i.remaining_qty) }))}
                          min={0}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-2.5">
              <Field label="Khách trả thêm" hint="Ngoài phần đã cọc">
                <MoneyInput value={paid} onChange={setPaid} />
              </Field>
              <Field label="Hình thức">
                <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="cash">Tiền mặt</option>
                  <option value="transfer">Chuyển khoản</option>
                </Select>
              </Field>
              <Field label="Vào quỹ">
                <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">Quỹ mặc định</option>
                  {meta.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </Field>
            </div>
            <div className="card p-3 space-y-1 h-fit">
              <TotalRow label="Tiền hàng lần này" value={money(gross)} />
              {orderDisc > 0 && <TotalRow label="Giảm giá chia theo đợt" value={'− ' + money(orderDisc)} />}
              <TotalRow label="Tiền hoá đơn" value={money(saleTotal)} big />
              <TotalRow
                label="Trừ từ tiền cọc"
                value={useDeposit > 0 ? '− ' + money(useDeposit) : '—'}
                tone={useDeposit > 0 ? 'good' : undefined}
              />
              <TotalRow label="Khách trả thêm" value={money(Number(paid) || 0)} />
              <TotalRow
                label={stillOwed > 0 ? 'Khách còn nợ' : 'Đã trả đủ'}
                value={money(stillOwed)}
                big
                tone={stillOwed > 0 ? 'bad' : 'good'}
              />
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
