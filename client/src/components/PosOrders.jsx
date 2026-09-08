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
  AlertTriangle, CheckCircle2, Package, X,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, useDebounced } from '../lib/store';
import { money, n, qty as fq, date, datetime, isoDate, match } from '../lib/format';
import {
  Button, IconButton, Input, Select, Modal, Field, MoneyInput, Empty,
  Spinner, Badge, Combo, Textarea, QtyInput, SearchInput, TotalRow, ErrorBox,
} from './ui';

/* ==================== CHUÔNG ĐƠN TỚI HẸN ========================== */

/**
 * Nút chuông trên thanh đầu màn hình bán hàng.
 * Đếm đơn tới hẹn giao hôm nay và đơn đã quá hẹn. Tự làm mới mỗi 5 phút —
 * đủ để không bỏ sót mà không làm nặng máy chủ.
 */
export function OrderBell({ onOpen }) {
  const { data, reload } = useFetch(() => api.ordersSummary(), []);

  useEffect(() => {
    const t = setInterval(reload, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [reload]);

  const late = data?.late_count || 0;
  const open = data?.open_count || 0;
  if (!open) return null;

  return (
    <button
      onClick={onOpen}
      className={`relative h-9 px-2.5 rounded border text-[13px] font-semibold hidden md:flex items-center gap-1.5
                  transition-colors duration-150 cursor-pointer
                  ${late > 0
                    ? 'bg-red-500/20 border-red-400/40 text-red-200 hover:bg-red-500/30'
                    : 'bg-white/10 border-white/15 text-slate-300 hover:text-white'}`}
      title={late > 0 ? `${late} đơn đặt hàng đã quá hẹn giao` : `${open} đơn đặt hàng đang chờ`}
      aria-label={late > 0 ? `${late} đơn đặt hàng quá hẹn, ${open} đơn đang chờ` : `${open} đơn đặt hàng đang chờ`}
    >
      <Bell size={14} aria-hidden="true" />
      {late > 0 ? `${n(late)} trễ hẹn` : `${n(open)} đơn`}
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
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null);
  const dq = useDebounced(q, 300);

  const { data, busy, error, reload } = useFetch(
    () => api.orders({ q: dq, page_size: 50 }),
    [dq],
    { skip: !open }
  );

  useEffect(() => { if (open) { setQ(''); setPicked(null); } }, [open]);

  const rows = (data?.rows || []).filter((o) => o.status === 'open' || o.status === 'partial');

  if (picked) {
    return (
      <DeliverAtCounter
        orderId={picked}
        onClose={() => setPicked(null)}
        onDone={(res) => { setPicked(null); reload(); onDelivered?.(res); onClose(); }}
      />
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Khách tới lấy hàng đã đặt"
      subtitle="Tìm đơn theo mã, tên khách hoặc số điện thoại"
      size="lg"
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
                          {o.promised_at
                            ? <span className={o.is_late ? 'text-danger font-semibold' : ''}>
                                {date(o.promised_at)}{!!o.is_late && ' (trễ)'}
                              </span>
                            : <span className="text-muted-ink">—</span>}
                        </td>
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

  const submit = async () => {
    if (!chosen.length) return toast('Chưa chọn món nào để giao', 'bad');
    setBusy(true);
    try {
      const res = await api.post(`/orders/${o.id}/deliver`, {
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
      onDone?.(res);
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
          <Button variant="primary" icon={Truck} onClick={submit} loading={busy} disabled={!chosen.length}>
            Xuất hoá đơn giao hàng
          </Button>
        </>
      }
    >
      {loading || !o ? <Spinner /> : (
        <div className="space-y-3">
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

/* ==================== ĐỔI TRẢ HÀNG TẠI QUẦY ======================== */

/**
 * Khách đem hàng lại: trả hẳn lấy tiền, hoặc đổi sang món khác.
 * Phần mềm bù trừ tiền hai chiều — thiếu thì khách bù, thừa thì tiệm hoàn.
 */
export function ExchangeModal({ open, onClose, products, onDone }) {
  const { user, meta, toast, defaultWarehouse, defaultPriceList } = useApp();
  const [q, setQ] = useState('');
  const [sale, setSale] = useState(null);
  const [back, setBack] = useState([]);      // món khách trả lại
  const [swap, setSwap] = useState([]);      // món khách lấy về
  const [fee, setFee] = useState(0);
  const [paid, setPaid] = useState(0);
  const [method, setMethod] = useState('cash');
  const [accountId, setAccountId] = useState('');
  const [reason, setReason] = useState('');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const dq = useDebounced(q, 300);

  const { data: found, busy: searching } = useFetch(
    () => api.sales({ q: dq, page_size: 20 }),
    [dq],
    { skip: !open || !dq.trim() || !!sale }
  );

  useEffect(() => {
    if (open) return;
    setQ(''); setSale(null); setBack([]); setSwap([]);
    setFee(0); setPaid(0); setReason('');
  }, [open]);

  const openSale = async (id) => {
    try {
      const s = await api.sale(id);
      setSale(s);
      // Mặc định chưa chọn món nào — thu ngân tự bấm số lượng trả
      setBack(s.items.map((i) => ({
        product_id: i.product_id, name: i.name_snapshot, unit_name: i.unit_name,
        factor: i.factor, sold: i.qty, price: i.price, unit_cost: i.unit_cost, qty: 0,
      })));
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  const backValue = back.reduce((a, l) => a + Math.round(l.qty * l.price), 0);
  const credit = Math.max(0, backValue - (Number(fee) || 0));
  const swapValue = swap.reduce((a, l) => a + Math.round(l.qty * l.price), 0);
  const customerPays = Math.max(0, swapValue - credit);
  const shopRefunds = Math.max(0, credit - swapValue);

  useEffect(() => { setPaid(customerPays); }, [customerPays]);

  const addSwap = (p) => {
    const u = p.units?.find((x) => x.is_base) || p.units?.[0];
    if (!u) return;
    setSwap((ls) => {
      const i = ls.findIndex((l) => l.product_id === p.id && l.unit_name === u.unit_name);
      if (i >= 0) {
        const c = [...ls];
        c[i] = { ...c[i], qty: c[i].qty + 1 };
        return c;
      }
      return [...ls, {
        product_id: p.id, name: p.name, unit_name: u.unit_name, factor: u.factor,
        qty: 1, price: u.prices?.[defaultPriceList] ?? Object.values(u.prices || {})[0] ?? 0,
        stock: p.stock, track_stock: p.track_stock,
      }];
    });
  };

  const submit = async () => {
    const backItems = back.filter((l) => l.qty > 0);
    if (!backItems.length) return toast('Chưa chọn món khách trả lại', 'bad');
    setBusy(true);
    try {
      const res = await api.saleExchange({
        sale_id: sale?.id || null,
        customer_id: sale?.customer_id || null,
        warehouse_id: defaultWarehouse,
        price_list_id: defaultPriceList,
        user_id: user?.id || null,
        fee: Number(fee) || 0,
        reason: reason || (swap.length ? 'Đổi hàng' : 'Khách trả hàng'),
        return_items: backItems.map((l) => ({
          product_id: l.product_id, unit_name: l.unit_name, factor: l.factor,
          qty: l.qty, price: l.price, unit_cost: l.unit_cost,
        })),
        new_items: swap.filter((l) => l.qty > 0).map((l) => ({
          product_id: l.product_id, name_snapshot: l.name, unit_name: l.unit_name,
          factor: l.factor, qty: l.qty, price: l.price,
        })),
        paid: Number(paid) || 0,
        payment_method: method,
        account_id: accountId || null,
      });
      toast(
        res.sale_code
          ? `Đổi hàng xong: phiếu trả ${res.return_code}, hoá đơn mới ${res.sale_code}`
          : `Đã lập phiếu trả hàng ${res.return_code}, hoàn ${money(res.shop_refunds)}`,
        'ok', 7000);
      onDone?.(res);
      onClose();
    } catch (e) {
      toast(e.message, 'bad', 7000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Đổi trả hàng"
        subtitle={sale
          ? `Hoá đơn ${sale.code} · ${datetime(sale.ts)} · ${sale.customer_name || 'Khách lẻ'}`
          : 'Tìm hoá đơn cũ của khách trước'}
        size="xl"
        footer={
          <>
            <Button onClick={onClose}>Đóng</Button>
            {sale && <Button onClick={() => { setSale(null); setBack([]); setSwap([]); }}>Chọn hoá đơn khác</Button>}
            {sale && (
              <Button variant="primary" icon={RefreshCcw} onClick={submit} loading={busy}
                disabled={!back.some((l) => l.qty > 0)}>
                {swap.some((l) => l.qty > 0) ? 'Xác nhận đổi hàng' : 'Xác nhận trả hàng'}
              </Button>
            )}
          </>
        }
      >
        {!sale ? (
          <div className="space-y-2">
            <SearchInput value={q} onChange={setQ}
              placeholder="Gõ mã hoá đơn, tên khách hoặc số điện thoại..." autoFocus />
            {!dq.trim() ? (
              <Empty
                icon={Search}
                title="Tìm hoá đơn khách đã mua"
                message="Gõ mã hoá đơn trên phiếu khách cầm theo, hoặc số điện thoại khách."
              />
            ) : searching ? <Spinner />
              : !found?.rows?.length ? (
                <Empty icon={Search} title="Không tìm thấy hoá đơn nào" message={`Không có hoá đơn khớp "${q}".`} />
              ) : (
                <div className="table-wrap max-h-[50vh]">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Mã hoá đơn</th><th>Thời gian</th><th>Khách hàng</th>
                        <th className="text-right">Tổng tiền</th><th style={{ width: 80 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {found.rows.map((s) => (
                        <tr key={s.id} className="hover:bg-muted/60 cursor-pointer" onClick={() => openSale(s.id)}>
                          <td className="font-semibold tabular">{s.code}</td>
                          <td className="whitespace-nowrap text-muted-ink">{datetime(s.ts)}</td>
                          <td className="truncate max-w-[12rem]">{s.customer_name || 'Khách lẻ'}</td>
                          <td className="text-right tabular font-semibold">{money(s.total)}</td>
                          <td className="text-center">
                            <Button size="sm" variant="soft" onClick={(e) => { e.stopPropagation(); openSale(s.id); }}>
                              Chọn
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <h3 className="font-bold text-sm mb-1.5">1. Khách trả lại món nào</h3>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Tên hàng</th><th>Đơn vị</th>
                      <th className="text-right">Đã mua</th>
                      <th className="text-right">Đơn giá</th>
                      <th style={{ width: 104 }} className="text-right">Trả lại</th>
                      <th className="text-right">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {back.map((l, i) => (
                      <tr key={i} className={l.qty > 0 ? 'bg-emerald-50/60' : ''}>
                        <td>{l.name}</td>
                        <td>{l.unit_name}</td>
                        <td className="text-right tabular text-muted-ink">{fq(l.sold)}</td>
                        <td className="text-right tabular">{money(l.price)}</td>
                        <td>
                          <QtyInput
                            value={l.qty}
                            min={0}
                            onChange={(v) => setBack((ls) => ls.map((x, j) =>
                              (j === i ? { ...x, qty: Math.min(v, x.sold) } : x)))}
                          />
                        </td>
                        <td className="text-right tabular font-semibold">{money(Math.round(l.qty * l.price))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                <Button size="sm" onClick={() => setBack((ls) => ls.map((x) => ({ ...x, qty: x.sold })))}>
                  Trả hết hoá đơn
                </Button>
                <Button size="sm" onClick={() => setBack((ls) => ls.map((x) => ({ ...x, qty: 0 })))}>
                  Bỏ chọn hết
                </Button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="font-bold text-sm">
                  2. Khách lấy về món nào
                  <span className="font-normal text-muted-ink text-[13px] ml-1.5">
                    (bỏ trống nếu chỉ trả hàng lấy tiền)
                  </span>
                </h3>
                <Button size="sm" icon={Plus} onClick={() => setPicking(true)}>Chọn hàng đổi</Button>
              </div>
              {swap.length === 0 ? (
                <div className="card-pad text-center text-[13px] text-muted-ink">
                  Chưa chọn món đổi. Để trống thì tiệm hoàn tiền cho khách.
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Tên hàng</th><th>Đơn vị</th>
                        <th className="text-right">Kho có</th>
                        <th style={{ width: 104 }} className="text-right">Số lượng</th>
                        <th style={{ width: 130 }} className="text-right">Đơn giá</th>
                        <th className="text-right">Thành tiền</th>
                        <th style={{ width: 44 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {swap.map((l, i) => (
                        <tr key={i}>
                          <td>{l.name}</td>
                          <td>{l.unit_name}</td>
                          <td className={`text-right tabular ${l.track_stock && l.stock < l.qty * l.factor ? 'text-danger font-semibold' : 'text-muted-ink'}`}>
                            {l.track_stock ? fq(l.stock) : '—'}
                          </td>
                          <td>
                            <QtyInput value={l.qty} min={0}
                              onChange={(v) => setSwap((ls) => ls.map((x, j) => (j === i ? { ...x, qty: v } : x)))} />
                          </td>
                          <td>
                            <MoneyInput size="sm" value={l.price}
                              onChange={(v) => setSwap((ls) => ls.map((x, j) => (j === i ? { ...x, price: v } : x)))} />
                          </td>
                          <td className="text-right tabular font-semibold">{money(Math.round(l.qty * l.price))}</td>
                          <td className="text-center">
                            <IconButton icon={Trash2} label="Bỏ dòng này"
                              onClick={() => setSwap((ls) => ls.filter((_, j) => j !== i))} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="grid lg:grid-cols-2 gap-3">
              <div className="space-y-2.5">
                <Field label="Phí trả hàng" hint="Trừ vào tiền hoàn cho khách. Để 0 nếu không thu">
                  <MoneyInput value={fee} onChange={setFee} />
                </Field>
                <Field label="Lý do" htmlFor="ex-reason">
                  <Input id="ex-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                    placeholder="VD: hàng lỗi, khách lấy nhầm cỡ" />
                </Field>
                {customerPays > 0 && (
                  <>
                    <Field label="Khách bù thêm bây giờ">
                      <MoneyInput value={paid} onChange={setPaid} />
                    </Field>
                    <Field label="Hình thức">
                      <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                        <option value="cash">Tiền mặt</option>
                        <option value="transfer">Chuyển khoản</option>
                      </Select>
                    </Field>
                  </>
                )}
                <Field label={shopRefunds > 0 ? 'Chi từ quỹ' : 'Vào quỹ'}>
                  <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                    <option value="">Quỹ mặc định</option>
                    {meta.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                </Field>
              </div>

              <div className="card p-3 space-y-1 h-fit">
                <TotalRow label="Tiền hàng khách trả lại" value={money(backValue)} />
                {Number(fee) > 0 && <TotalRow label="Phí trả hàng" value={'− ' + money(fee)} />}
                <TotalRow label="Khách được trừ" value={money(credit)} tone="good" />
                <TotalRow label="Tiền hàng khách lấy về" value={money(swapValue)} />
                <div className="border-t border-line my-1" />
                {customerPays > 0 ? (
                  <>
                    <TotalRow label="Khách phải bù" value={money(customerPays)} big tone="bad" />
                    {Number(paid) < customerPays && (
                      <TotalRow label="Ghi nợ" value={money(customerPays - (Number(paid) || 0))} />
                    )}
                  </>
                ) : shopRefunds > 0 ? (
                  <TotalRow label="Tiệm hoàn lại khách" value={money(shopRefunds)} big tone="good" />
                ) : (
                  <TotalRow label="Vừa đủ, không phải bù" value="0 đ" big />
                )}
                <p className="text-2xs text-muted-ink pt-1.5 leading-relaxed">
                  Phần bù trừ không chạy qua quỹ vì tiền đó chưa từng ra vào két.
                  Chỉ phần chênh lệch thật mới ghi thu hoặc chi.
                </p>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <SwapProductPicker
        open={picking}
        onClose={() => setPicking(false)}
        products={products || []}
        onPick={addSwap}
      />
    </>
  );
}

/** Bảng chọn hàng để đổi — hiện giá bán và tồn, không hiện giá vốn. */
function SwapProductPicker({ open, onClose, products, onPick }) {
  const { meta, defaultPriceList } = useApp();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');

  useEffect(() => { if (open) setQ(''); }, [open]);

  const list = useMemo(() => {
    let l = products;
    if (cat) l = l.filter((p) => p.category_id === Number(cat));
    if (q.trim()) {
      l = l.filter((p) => match(p.name, q) || match(p.alias, q) || match(p.sku, q)
        || (p.barcode || '').includes(q.trim()));
    }
    return l.slice(0, 300);
  }, [products, q, cat]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Chọn hàng khách đổi lấy"
      size="lg"
      footer={<Button variant="primary" onClick={onClose}>Xong</Button>}
    >
      <div className="space-y-2">
        <div className="flex gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Gõ tên hàng hoặc quét mã vạch..."
            className="flex-1" autoFocus />
          <Select value={cat} onChange={(e) => setCat(e.target.value)} className="!w-auto">
            <option value="">Mọi nhóm hàng</option>
            {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        {list.length === 0 ? (
          <Empty icon={Search} title="Không tìm thấy hàng nào" message={`Không có mặt hàng khớp "${q}".`} />
        ) : (
          <div className="table-wrap max-h-[50vh]">
            <table className="data">
              <thead>
                <tr>
                  <th>Mã hàng</th><th>Tên hàng</th>
                  <th className="text-right">Tồn kho</th>
                  <th className="text-right">Giá bán</th>
                  <th style={{ width: 60 }} />
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const u = p.units?.find((x) => x.is_base) || p.units?.[0];
                  const price = u?.prices?.[defaultPriceList] ?? Object.values(u?.prices || {})[0] ?? 0;
                  return (
                    <tr key={p.id} className="hover:bg-muted/60 cursor-pointer" onClick={() => onPick(p)}>
                      <td className="tabular text-muted-ink">{p.sku}</td>
                      <td>
                        <div>{p.name}</div>
                        {p.alias && <div className="text-2xs text-muted-ink truncate">{p.alias}</div>}
                      </td>
                      <td className={`text-right tabular ${p.stock <= 0 ? 'text-danger' : ''}`}>
                        {p.track_stock ? `${fq(p.stock)} ${p.base_unit}` : '—'}
                      </td>
                      <td className="text-right tabular font-semibold">{money(price)}</td>
                      <td className="text-center"><IconButton icon={Plus} label={`Chọn ${p.name}`} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
