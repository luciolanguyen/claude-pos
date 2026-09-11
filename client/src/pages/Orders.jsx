/* ====================================================================
   ĐẶT HÀNG CỦA KHÁCH

   Khách hỏi món tiệm chưa có, hoặc lấy số lượng lớn cần gom hàng. Ghi
   đơn, nhận cọc, hẹn ngày giao. Hàng về thì giao — giao được nhiều đợt,
   mỗi đợt ra một hoá đơn và tự trừ dần tiền cọc.

   Tài liệu 12: lập đơn xong tự in phiếu đặt hàng; mỗi lần nhận thêm cọc
   hay giao hàng đều in "phiếu tổng kết" cập nhật tới lúc đó — hàng đặt,
   đã giao / còn thiếu, các đợt giao, các lần cọc và nợ còn lại.
   ==================================================================== */
import { useState, useMemo, useEffect, useRef } from 'react';
import {
  ClipboardList, Plus, Eye, Search, Clock, AlertTriangle, Printer, XCircle,
  PackageCheck, HandCoins, Truck, ShoppingBag, Phone, CheckCircle2, Trash2, ShoppingCart,
  Store, MapPin, History,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, usePaged, useDebounced } from '../lib/store';
import { money, n, qty as fq, date, datetime, isoDate, match, readMoney, ROLE_LABEL } from '../lib/format';
import {
  Button, IconButton, SearchInput, Select, Modal, Spinner, Empty, ErrorBox, Badge,
  Field, MoneyInput, Textarea, Stat, Combo, QtyInput, Input, Tabs, Pager,
  TotalRow,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import { CategorySelect } from '../components/CategoryTree';
import { EMPTY_DELIVERY, deliveryBody } from '../components/PosDeliveryForm';

const STATUS = {
  open: { label: 'Chờ giao', tone: 'info', icon: Clock },
  partial: { label: 'Giao một phần', tone: 'warn', icon: PackageCheck },
  done: { label: 'Hoàn tất', tone: 'ok', icon: CheckCircle2 },
  cancelled: { label: 'Đã huỷ', tone: 'mute', icon: XCircle },
};

const StatusBadge = ({ s }) => {
  const st = STATUS[s] || { label: s, tone: 'mute', icon: Clock };
  const Icon = st.icon;
  return <Badge tone={st.tone}><Icon size={10} aria-hidden="true" />{st.label}</Badge>;
};

/** Giá bán của một đơn vị theo bảng giá đang chọn. */
const priceOfUnit = (unit, priceListId, fallbackList) =>
  unit?.prices?.[priceListId] ?? unit?.prices?.[fallbackList] ?? 0;

/** Tiền hàng của một đợt giao, không tính thuế và phí ship khách trả — khớp máy chủ. */
const deliveryGoods = (d) =>
  (d.sale_total || 0) - (d.sale_vat || 0) - (d.ship_payer === 'customer' ? (d.ship_fee || 0) : 0);

/** Đơn đã có hoạt động sau khi lập (giao hàng, hoặc nhận thêm cọc) thì không in lại phiếu đặt ban đầu. */
const hasActivity = (o) => (o?.deliveries?.length || 0) > 0
  || (o?.deposits || []).some((d) => d.amount > 0 && String(d.ts) > String(o.ts));

export default function Orders() {
  const [tab, setTab] = useState('orders');
  return (
    <>
      <PageHeader
        title="Đặt hàng"
        subtitle="Khách đặt trước, tiệm gom hàng rồi giao — giao được nhiều đợt"
      />
      <div className="bg-card border-b border-line px-4">
        <Tabs
          value={tab}
          onChange={setTab}
          className="!border-b-0"
          tabs={[
            { key: 'orders', label: 'Đơn đặt hàng' },
            { key: 'shortage', label: 'Cần mua để giao đơn' },
          ]}
        />
      </div>
      <Page>
        {tab === 'orders' ? <OrderList /> : <Shortage />}
      </Page>
    </>
  );
}

/* ========================== DANH SÁCH ĐƠN ========================== */

function OrderList() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [late, setLate] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [printJob, setPrintJob] = useState(null);   // phiếu đặt hàng vừa lập, tự in
  const dq = useDebounced(q, 300);

  const list = usePaged(
    (pg) => api.orders({ q: dq, status, late: late ? 1 : '', ...pg }),
    [dq, status, late],
    { key: 'orders' }
  );
  const { data: sum, reload: reloadSum } = useFetch(() => api.ordersSummary(), []);

  const refresh = () => { list.reload(); reloadSum(); };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Stat label="Đơn đang chờ" value={n(sum?.open_count)} icon={ClipboardList} />
        <Stat label="Giá trị chưa giao" value={money(sum?.open_value)} icon={ShoppingBag} />
        <Stat label="Cọc đang giữ" value={money(sum?.deposit_held)} icon={HandCoins} tone="ok" />
        <Stat
          label="Trễ hẹn giao"
          value={n(sum?.late_count)}
          icon={AlertTriangle}
          tone={sum?.late_count > 0 ? 'bad' : 'default'}
          onClick={() => { setLate(true); setStatus(''); }}
        />
      </div>

      <div className="card">
        <div className="p-3 flex flex-wrap items-center gap-2 border-b border-line">
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Tìm mã đơn, tên hoặc số điện thoại khách..."
            className="flex-1 min-w-[15rem]"
          />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-auto" aria-label="Lọc trạng thái đơn">
            <option value="">Mọi trạng thái</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <label className="flex items-center gap-1.5 text-[13px] cursor-pointer select-none">
            <input type="checkbox" checked={late} onChange={(e) => setLate(e.target.checked)} />
            Chỉ đơn trễ hẹn
          </label>
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            Đơn đặt hàng mới
          </Button>
        </div>

        {list.busy && !list.rows.length ? <Spinner />
          : list.error ? <ErrorBox error={list.error} onRetry={list.reload} />
            : list.rows.length === 0 ? (
              <Empty
                icon={ClipboardList}
                title="Chưa có đơn đặt hàng nào"
                message="Khách hỏi món tiệm chưa có thì ghi đơn ở đây, khỏi quên."
                action={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Đơn đặt hàng mới</Button>}
              />
            ) : (
              <>
                <div className="table-wrap table-scroll !border-0 !rounded-none">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Mã đơn</th><th>Ngày nhận</th><th>Khách hàng</th>
                        <th>Hẹn giao</th><th className="text-right">Tổng tiền</th>
                        <th className="text-right">Cọc còn</th>
                        <th className="text-center">Còn phải giao</th>
                        <th>Trạng thái</th><th style={{ width: 48 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {list.rows.map((o) => (
                        <tr
                          key={o.id}
                          className={`hover:bg-muted/60 cursor-pointer ${o.is_late ? 'bg-rose-50/70' : ''}`}
                          onClick={() => setOpenId(o.id)}
                        >
                          <td className="font-semibold tabular">{o.code}</td>
                          <td className="text-muted-ink whitespace-nowrap">{date(o.ts)}</td>
                          <td className="min-w-[10rem]">
                            <div className="truncate">{o.customer_display}</div>
                            {o.phone_display && (
                              <div className="text-2xs text-muted-ink tabular">{o.phone_display}</div>
                            )}
                          </td>
                          <td className="whitespace-nowrap">
                            {o.promised_at ? (
                              <span className={o.is_late ? 'text-danger font-semibold' : ''}>
                                {date(o.promised_at)}
                                {/* is_late là 0/1 của SQLite; thiếu !! thì React in ra số 0 */}
                                {!!o.is_late && <span className="ml-1 text-2xs">(trễ)</span>}
                              </span>
                            ) : <span className="text-muted-ink">—</span>}
                          </td>
                          <td className="text-right tabular font-semibold">{money(o.total)}</td>
                          <td className="text-right tabular">
                            {o.deposit_left > 0 ? money(o.deposit_left) : <span className="text-muted-ink">—</span>}
                          </td>
                          <td className="text-center tabular">
                            {o.pending_lines > 0 && (o.status === 'open' || o.status === 'partial')
                              ? <span>{o.pending_lines}/{o.item_count} món</span>
                              : <span className="text-muted-ink">—</span>}
                            {o.delivery_count > 0 && (
                              <div className="text-2xs text-muted-ink">đã giao {o.delivery_count} đợt</div>
                            )}
                          </td>
                          <td><StatusBadge s={o.status} /></td>
                          <td className="text-center">
                            <IconButton icon={Eye} label={`Xem đơn ${o.code}`} onClick={(e) => { e.stopPropagation(); setOpenId(o.id); }} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager
                  page={list.page}
                  pageSize={list.pageSize}
                  total={list.total}
                  onPage={list.setPage}
                  onPageSize={list.setPageSize}
                />
              </>
            )}
      </div>

      {creating && (
        <OrderForm
          onClose={() => setCreating(false)}
          onSaved={(res) => {
            refresh();
            /* Lập đơn xong tự mở bản in phiếu đặt hàng (tài liệu 12, mục 1) */
            if (res?.id) setPrintJob({ id: res.id, kind: 'order' });
          }}
        />
      )}
      {openId && <OrderDetail id={openId} onClose={() => setOpenId(null)} onChanged={refresh} />}
      {printJob && <OrderPrintJob job={printJob} onClose={() => setPrintJob(null)} />}
    </div>
  );
}

/* ======================= LẬP / SỬA ĐƠN ĐẶT HÀNG ===================== */

function OrderForm({ order, onClose, onSaved }) {
  const { meta, user, defaultPriceList, toast } = useApp();
  const editing = !!order;
  const { data: products } = useFetch(() => api.posProducts(), []);
  const { data: customers } = useFetch(() => api.customers(), []);

  const [customerId, setCustomerId] = useState(order?.customer_id || '');
  const [guestName, setGuestName] = useState(order?.customer_name || '');
  const [guestPhone, setGuestPhone] = useState(order?.customer_phone || '');
  const [priceListId, setPriceListId] = useState(order?.price_list_id || defaultPriceList || '');
  const [promisedAt, setPromisedAt] = useState(
    order?.promised_at || isoDate(new Date(Date.now() + 7 * 86400000)));
  const [lines, setLines] = useState(
    order?.items?.map((i) => ({
      product_id: i.product_id, name_snapshot: i.name_snapshot, unit_name: i.unit_name,
      factor: i.factor, qty: i.qty, price: i.price, delivered_qty: i.delivered_qty,
      discount_type: i.discount_type, discount: i.discount,
      discount_percent: i.discount_percent, note: i.note || '',
    })) || []);
  const [discType, setDiscType] = useState(order?.discount_type || 'amount');
  const [discValue, setDiscValue] = useState(
    order ? (order.discount_type === 'percent' ? order.discount_percent : order.discount) : 0);
  const [deposit, setDeposit] = useState(0);
  const [depositPayer, setDepositPayer] = useState('');
  const [note, setNote] = useState(order?.note || '');
  const [deliveryAddress, setDeliveryAddress] = useState(order?.delivery_address || '');
  const [carrierId, setCarrierId] = useState(order?.carrier_id || '');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data: carriers } = useFetch(() => api.carriers(), []);

  const subtotal = useMemo(() => lines.reduce((a, l) => {
    const gross = Math.round(l.qty * l.price);
    const d = l.discount_type === 'percent'
      ? Math.round(gross * (l.discount_percent || 0) / 100)
      : Math.round(l.discount || 0);
    return a + gross - Math.min(d, gross);
  }, 0), [lines]);

  const orderDiscount = Math.min(
    discType === 'percent' ? Math.round(subtotal * (Number(discValue) || 0) / 100) : Math.round(Number(discValue) || 0),
    subtotal);
  const total = subtotal - orderDiscount;

  /* Số lượng đang có trong đơn của từng mặt hàng (đơn vị cơ bản) — để bảng
     chọn hàng tô sáng nút giỏ và hiện số */
  const cartQty = useMemo(() => {
    const m = new Map();
    for (const l of lines) {
      const p = products?.find((x) => x.id === l.product_id);
      const base = p?.units?.find((u) => u.is_base) || p?.units?.[0];
      if (!base || base.unit_name === l.unit_name) m.set(l.product_id, (m.get(l.product_id) || 0) + Number(l.qty));
    }
    return m;
  }, [lines, products]);

  /** Bấm nút giỏ: chưa có thì thêm, có rồi thì GHI ĐÈ số lượng (tài liệu 12, mục 1). */
  const setProductQty = (p, qty) => {
    const unit = p.units?.find((u) => u.is_base) || p.units?.[0];
    const want = Number(qty) || 0;
    if (!unit || !(want > 0)) return;
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product_id === p.id && l.unit_name === unit.unit_name);
      if (i >= 0) {
        const copy = [...ls];
        copy[i] = { ...copy[i], qty: Math.max(want, copy[i].delivered_qty || 0) };
        return copy;
      }
      return [...ls, {
        product_id: p.id, name_snapshot: p.name, unit_name: unit.unit_name,
        factor: unit.factor, qty: want,
        price: priceOfUnit(unit, priceListId, defaultPriceList),
        delivered_qty: 0, discount_type: 'amount', discount: 0, discount_percent: 0,
        note: '', _units: p.units, _stock: p.stock,
      }];
    });
  };

  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const delLine = (i) => setLines((ls) => ls.filter((_, j) => j !== i));

  const save = async () => {
    if (!lines.length) return toast('Đơn phải có ít nhất 1 mặt hàng', 'bad');
    setBusy(true);
    try {
      const body = {
        customer_id: customerId || null,
        customer_name: customerId ? null : guestName,
        customer_phone: customerId ? null : guestPhone,
        price_list_id: priceListId || null,
        promised_at: promisedAt || null,
        user_id: user?.id || null,
        items: lines,
        discount_type: discType,
        discount: discType === 'amount' ? Number(discValue) || 0 : 0,
        discount_percent: discType === 'percent' ? Number(discValue) || 0 : 0,
        delivery_address: deliveryAddress || null,
        carrier_id: carrierId || null,
        note: note || null,
      };
      if (editing) {
        await api.put(`/orders/${order.id}`, body);
        toast('Đã lưu đơn đặt hàng', 'ok');
        onSaved?.();
      } else {
        const res = await api.post('/orders', {
          ...body,
          deposit: Number(deposit) || 0,
          payer_name: depositPayer.trim() || null,
        });
        toast(`Đã lập đơn ${res.code} — trạng thái Chờ giao`, 'ok');
        onSaved?.(res);
      }
      onClose();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const customerName = customers?.find((c) => c.id === customerId)?.name || guestName || 'khách đặt';

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={editing ? `Sửa đơn ${order.code}` : 'Đơn đặt hàng mới'}
        subtitle="Đơn đặt hàng chưa trừ kho. Kho chỉ trừ khi giao hàng."
        size="xl"
        footer={
          <>
            <Button onClick={onClose}>Đóng</Button>
            <Button variant="primary" icon={editing ? undefined : Printer} onClick={save} loading={busy}>
              {editing ? 'Lưu thay đổi' : 'Lập Đơn & In'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <Field label="Khách hàng" className="lg:col-span-2">
              <Combo
                items={customers || []}
                value={customerId}
                onChange={setCustomerId}
                placeholder="Khách lẻ / gõ tên để tìm"
                filter={(c, k) => match(c.name, k) || (c.phone || '').includes(k)}
                render={(c) => ({ label: c.name, sub: c.phone })}
              />
            </Field>
            <Field label="Hẹn ngày giao" htmlFor="od-promised">
              <Input id="od-promised" type="date" value={promisedAt} onChange={(e) => setPromisedAt(e.target.value)} />
            </Field>
            <Field label="Bảng giá">
              <Select value={priceListId} onChange={(e) => setPriceListId(Number(e.target.value))}>
                {meta.priceLists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          </div>

          {!customerId && (
            <div className="grid sm:grid-cols-2 gap-2.5">
              <Field label="Tên khách" hint="Khách chưa có hồ sơ thì ghi tạm để còn gọi" htmlFor="od-gname">
                <Input id="od-gname" value={guestName} onChange={(e) => setGuestName(e.target.value)}
                  placeholder="VD: Chú Tám thợ điện" />
              </Field>
              <Field label="Số điện thoại" htmlFor="od-gphone">
                <Input id="od-gphone" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)}
                  inputMode="tel" placeholder="09xx xxx xxx" />
              </Field>
            </div>
          )}

          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm">Hàng khách đặt ({lines.length})</h3>
            <Button icon={ShoppingCart} onClick={() => setPicking(true)}>Chọn hàng</Button>
          </div>

          {lines.length === 0 ? (
            <div className="card-pad text-center text-[13px] text-muted-ink">
              Chưa chọn mặt hàng nào. Bấm <b>Chọn hàng</b>, gõ số lượng rồi bấm nút giỏ.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Tên hàng</th><th style={{ width: 120 }}>Đơn vị</th>
                    <th style={{ width: 96 }} className="text-right">SL đặt</th>
                    <th style={{ width: 130 }} className="text-right">Đơn giá</th>
                    <th style={{ width: 150 }} className="text-right">Giảm giá</th>
                    <th style={{ width: 120 }} className="text-right">Thành tiền</th>
                    <th style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const gross = Math.round(l.qty * l.price);
                    const d = l.discount_type === 'percent'
                      ? Math.round(gross * (l.discount_percent || 0) / 100)
                      : Math.round(l.discount || 0);
                    const units = l._units || products?.find((p) => p.id === l.product_id)?.units || [];
                    return (
                      <tr key={i}>
                        <td>
                          <div className="font-medium">{l.name_snapshot}</div>
                          {l.delivered_qty > 0 && (
                            <div className="text-2xs text-emerald-700">đã giao {fq(l.delivered_qty)} {l.unit_name}</div>
                          )}
                          <Input
                            size="sm"
                            className="mt-1 !text-2xs"
                            value={l.note || ''}
                            onChange={(e) => setLine(i, { note: e.target.value })}
                            placeholder="Ghi chú riêng cho món này..."
                            aria-label={`Ghi chú cho ${l.name_snapshot}`}
                          />
                        </td>
                        <td>
                          <Select
                            size="sm"
                            value={l.unit_name}
                            aria-label={`Đơn vị của ${l.name_snapshot}`}
                            onChange={(e) => {
                              const u = units.find((x) => x.unit_name === e.target.value);
                              setLine(i, {
                                unit_name: e.target.value,
                                factor: u?.factor || 1,
                                price: priceOfUnit(u, priceListId, defaultPriceList) || l.price,
                              });
                            }}
                          >
                            {units.length
                              ? units.map((u) => <option key={u.unit_name} value={u.unit_name}>{u.unit_name}</option>)
                              : <option value={l.unit_name}>{l.unit_name}</option>}
                          </Select>
                        </td>
                        <td>
                          <QtyInput value={l.qty} onChange={(v) => setLine(i, { qty: v })} min={l.delivered_qty || 0}
                            aria-label={`Số lượng đặt ${l.name_snapshot}`} />
                        </td>
                        <td><MoneyInput size="sm" value={l.price} onChange={(v) => setLine(i, { price: v })}
                          aria-label={`Đơn giá ${l.name_snapshot}`} /></td>
                        <td>
                          <div className="flex gap-1">
                            <Select
                              size="sm"
                              className="!w-16"
                              value={l.discount_type}
                              aria-label={`Kiểu giảm giá ${l.name_snapshot}`}
                              onChange={(e) => setLine(i, { discount_type: e.target.value })}
                            >
                              <option value="amount">đ</option>
                              <option value="percent">%</option>
                            </Select>
                            {l.discount_type === 'percent'
                              ? <QtyInput value={l.discount_percent || 0} onChange={(v) => setLine(i, { discount_percent: v })} />
                              : <MoneyInput size="sm" value={l.discount || 0} onChange={(v) => setLine(i, { discount: v })} />}
                          </div>
                        </td>
                        <td className="text-right tabular font-semibold">{money(gross - Math.min(d, gross))}</td>
                        <td className="text-center">
                          <IconButton icon={Trash2} label={`Bỏ ${l.name_snapshot}`} onClick={() => delLine(i)}
                            disabled={l.delivered_qty > 0} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-3">
            <div className="space-y-2.5">
              <Field label="Giao tới" hint="Để trống nếu khách tự tới lấy" htmlFor="od-addr">
                <Textarea id="od-addr" rows={2} value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  placeholder="Số nhà, ấp/khu phố, xã/phường..." />
              </Field>
              <Field label="Nhà xe / đối tác giao">
                <Select value={carrierId} onChange={(e) => setCarrierId(e.target.value)}>
                  <option value="">Không qua nhà xe</option>
                  {(carriers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Ghi chú đơn" htmlFor="od-note">
                <Textarea id="od-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="VD: khách dặn gọi trước khi giao" />
              </Field>
            </div>

            <div className="card p-3 space-y-1 h-fit">
              <TotalRow label="Tiền hàng" value={money(subtotal)} />
              <div className="flex items-center justify-between gap-2 py-1">
                <span className="text-[13px] text-muted-ink">Giảm giá cả đơn</span>
                <div className="flex gap-1 items-center">
                  <Select size="sm" className="!w-16" value={discType} aria-label="Kiểu giảm giá cả đơn"
                    onChange={(e) => { setDiscType(e.target.value); setDiscValue(0); }}>
                    <option value="amount">đ</option>
                    <option value="percent">%</option>
                  </Select>
                  {discType === 'percent'
                    ? <QtyInput value={discValue} onChange={setDiscValue} />
                    : <MoneyInput size="sm" value={discValue} onChange={setDiscValue} />}
                </div>
              </div>
              {orderDiscount > 0 && <TotalRow label="Đã giảm" value={'− ' + money(orderDiscount)} />}
              <TotalRow label="Khách phải trả" value={money(total)} big />

              {!editing && (
                <div className="pt-2 border-t border-line mt-2 space-y-2">
                  <Field label="Khách đặt cọc" hint="Tiền vào quỹ ngay, giao hàng sẽ tự trừ vào hoá đơn">
                    <MoneyInput value={deposit} onChange={setDeposit} />
                  </Field>
                  {deposit > 0 && (
                    <>
                      <Field label="Người đưa cọc" hint={`Để trống = ${customerName}`} htmlFor="od-payer">
                        <Input id="od-payer" value={depositPayer} onChange={(e) => setDepositPayer(e.target.value)}
                          placeholder={customerName} />
                      </Field>
                      <div className="text-[13px] text-muted-ink tabular">
                        Còn lại khi nhận hàng: <b className="text-ink">{money(Math.max(0, total - deposit))}</b>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </Modal>

      <OrderProductPicker
        open={picking}
        onClose={() => setPicking(false)}
        products={products || []}
        priceListId={priceListId}
        cartQty={cartQty}
        lineCount={lines.length}
        onSetQty={setProductQty}
      />
    </>
  );
}

/* Bảng chọn hàng riêng cho đặt hàng: hiện GIÁ BÁN và tồn kho, không hiện
   giá vốn. Mỗi dòng có ô số lượng và nút giỏ (tài liệu 12, mục 1): bấm lần
   đầu là thêm, nút sáng lên kèm số; gõ số khác rồi bấm lại là ghi đè. */
function OrderProductPicker({ open, onClose, products, priceListId, cartQty, lineCount, onSetQty }) {
  const { meta, defaultPriceList } = useApp();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [want, setWant] = useState({});   // product_id -> số đang gõ, chưa bấm giỏ

  useEffect(() => { if (open) { setQ(''); setWant({}); } }, [open]);

  const list = useMemo(() => {
    let l = products;
    if (cat) l = l.filter((p) => p.category_id === Number(cat));
    if (q.trim()) {
      l = l.filter((p) => match(p.name, q) || match(p.alias, q) || match(p.sku, q)
        || (p.barcode || '').includes(q.trim()));
    }
    return l.slice(0, 300);
  }, [products, q, cat]);

  /* Quét mã vạch đúng một món thì Enter là cho vào giỏ luôn */
  const onSearchKey = (e) => {
    if (e.key !== 'Enter' || list.length !== 1) return;
    e.preventDefault();
    const p = list[0];
    onSetQty(p, want[p.id] ?? ((cartQty.get(p.id) || 0) + 1));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Chọn hàng khách đặt"
      subtitle="Gõ số lượng rồi bấm nút giỏ. Hàng hết tồn vẫn đặt được — đó là chuyện thường của đơn đặt hàng."
      size="lg"
      footer={<>
        <span className="mr-auto text-[13px] text-muted-ink">Đơn đang có <b className="text-ink">{n(lineCount)}</b> món</span>
        <Button variant="primary" onClick={onClose}>Xong</Button>
      </>}
    >
      <div className="space-y-2">
        <div className="flex gap-2" onKeyDown={onSearchKey}>
          <SearchInput value={q} onChange={setQ} placeholder="Gõ tên hàng, tên phụ hoặc quét mã vạch..."
            className="flex-1" autoFocus />
          <CategorySelect value={cat} onChange={setCat}
            categories={meta.categories} className="!w-auto"
            ariaLabel="Lọc theo nhóm hàng" />
        </div>

        {list.length === 0 ? (
          <Empty icon={Search} title="Không tìm thấy hàng nào" message={`Không có mặt hàng khớp "${q}".`} />
        ) : (
          <div className="table-wrap max-h-[52vh]">
            <table className="data">
              <thead>
                <tr>
                  <th>Mã hàng</th><th>Tên hàng</th>
                  <th className="text-right">Tồn kho</th>
                  <th className="text-right">Giá bán</th>
                  <th style={{ width: 196 }} className="text-right">Số lượng</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const u = p.units?.find((x) => x.is_base) || p.units?.[0];
                  const inCart = cartQty.get(p.id) || 0;
                  const value = want[p.id] ?? (inCart || 1);
                  const changed = inCart > 0 && Number(value) !== inCart;
                  return (
                    <tr key={p.id} className={inCart ? 'bg-accent-soft/40' : ''}>
                      <td className="tabular text-muted-ink">{p.sku}</td>
                      <td>
                        <div>{p.name}</div>
                        {p.alias && <div className="text-2xs text-muted-ink truncate">{p.alias}</div>}
                      </td>
                      <td className={`text-right tabular ${p.track_stock && p.stock <= 0 ? 'text-danger' : ''}`}>
                        {p.track_stock ? `${fq(p.stock)} ${p.base_unit}` : '—'}
                      </td>
                      <td className="text-right tabular font-semibold">
                        {money(priceOfUnit(u, priceListId, defaultPriceList))}
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1.5">
                          <QtyInput
                            value={value}
                            min={0}
                            onChange={(v) => setWant((m) => ({ ...m, [p.id]: v }))}
                            aria-label={`Số lượng đặt ${p.name}`}
                            className="!w-20"
                          />
                          <button
                            type="button"
                            onClick={() => { onSetQty(p, value); setWant((m) => { const c = { ...m }; delete c[p.id]; return c; }); }}
                            disabled={!(Number(value) > 0)}
                            aria-pressed={inCart > 0}
                            aria-label={inCart
                              ? `${p.name} đang có ${fq(inCart)} trong đơn — bấm để đổi thành ${fq(value)}`
                              : `Thêm ${fq(value)} ${p.name} vào đơn`}
                            className={`h-8 min-w-[5.25rem] px-2 rounded border text-[13px] font-semibold inline-flex items-center
                                        justify-center gap-1 cursor-pointer transition-colors duration-150 disabled:opacity-50
                                        disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2
                                        focus-visible:outline-offset-1 focus-visible:outline-accent
                                        ${inCart
                                          ? (changed ? 'bg-amber-500 border-amber-600 text-white hover:bg-amber-600'
                                            : 'bg-accent border-accent text-white hover:bg-emerald-700')
                                          : 'bg-card border-line hover:bg-muted'}`}
                          >
                            <ShoppingCart size={14} aria-hidden="true" />
                            {inCart ? `(${fq(inCart)})` : 'Thêm'}
                          </button>
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
  );
}

/* =========================== CHI TIẾT ĐƠN ========================== */

function OrderDetail({ id, onClose, onChanged }) {
  const { can, toast } = useApp();
  const { data: o, busy, error, reload, setData } = useFetch(() => api.order(id), [id]);
  const [delivering, setDelivering] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [printing, setPrinting] = useState(null);   // { kind, refId }

  const changed = () => { reload(); onChanged?.(); };
  const openOrder = o && (o.status === 'open' || o.status === 'partial');
  const active = hasActivity(o);

  /* Nhận cọc / giao hàng xong: lấy lại đơn mới nhất rồi in phiếu tổng kết */
  const afterAction = async (kind, refId) => {
    onChanged?.();
    try {
      const fresh = await api.order(id);
      setData(fresh);
      setPrinting({ kind, refId });
    } catch (e) {
      toast(`Đã lưu nhưng chưa mở được bản in: ${e.message}`, 'warn', 7000);
      reload();
    }
  };

  const timeline = useMemo(() => (o ? [
    ...o.deposits.map((d) => ({ type: 'deposit', ts: d.ts, d })),
    ...o.deliveries.map((d) => ({ type: 'delivery', ts: d.ts, d })),
  ].sort((a, b) => String(a.ts).localeCompare(String(b.ts)) || (a.type === 'deposit' ? -1 : 1)) : []), [o]);

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={o ? `Đơn đặt hàng ${o.code}` : 'Đơn đặt hàng'}
        subtitle={o ? `Nhận ngày ${datetime(o.ts)} · ${o.user_name || 'không rõ người nhận'}` : ''}
        size="xl"
        footer={
          <>
            <Button onClick={onClose}>Đóng</Button>
            {/* Đơn đã có cọc thêm / đã giao thì phiếu đặt ban đầu không còn đúng —
                chỉ in phiếu tổng kết cập nhật (tài liệu 12, mục 3.1) */}
            {o && !active && (
              <Button icon={Printer} onClick={() => setPrinting({ kind: 'order' })}>In phiếu đặt hàng</Button>
            )}
            {o && active && (
              <Button icon={Printer} onClick={() => setPrinting({ kind: 'summary' })}>
                {o.status === 'done' ? 'In phiếu tổng kết cuối' : 'In phiếu tổng kết'}
              </Button>
            )}
            {openOrder && <Button icon={XCircle} onClick={() => setCancelling(true)}>Huỷ đơn</Button>}
            {openOrder && <Button icon={HandCoins} onClick={() => setDepositing(true)}>Nhận thêm cọc</Button>}
            {openOrder && (
              <Button variant="primary" icon={Truck} onClick={() => setDelivering(true)}>
                Giao hàng
              </Button>
            )}
          </>
        }
      >
        {busy && !o ? <Spinner /> : error && !o ? <ErrorBox error={error} onRetry={reload} /> : o && (
          <div className="space-y-3">
            {o.is_late || (openOrder && o.promised_at && o.promised_at < isoDate()) ? (
              <div className="card-pad bg-rose-50 border-danger/30 text-[13px] flex gap-2.5">
                <AlertTriangle size={16} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-rose-900">
                  Đơn này hẹn giao ngày <b>{date(o.promised_at)}</b> mà chưa giao xong.
                  {o.phone_display && <> Gọi khách báo: <a href={`tel:${o.phone_display}`} className="text-accent font-semibold hover:underline">{o.phone_display}</a></>}
                </p>
              </div>
            ) : null}

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <InfoBox label="Khách hàng" value={o.customer_display} sub={o.phone_display} />
              <InfoBox label="Tổng tiền đơn" value={money(o.summary?.total ?? o.total)}
                sub={o.promised_at ? `hẹn giao ${date(o.promised_at)}` : 'không hẹn ngày'} />
              <InfoBox
                label="Tổng cọc"
                value={money(o.summary?.deposit_total ?? o.deposit)}
                sub={`${n(o.summary?.deposit_count || 0)} lần · còn giữ ${money(o.deposit_left)}`}
              />
              <InfoBox
                label="Nợ còn lại"
                value={money(o.summary?.remaining ?? Math.max(0, o.total - o.deposit))}
                sub={`đã giao ${money(o.summary?.delivered_value || 0)}`}
                tone={o.summary?.remaining > 0 ? 'bad' : 'good'}
              />
            </div>

            <div className="flex items-center gap-2">
              <StatusBadge s={o.status} />
              {openOrder && can('order.manage') && (
                <Button size="sm" onClick={() => setEditing(true)}>Sửa đơn</Button>
              )}
            </div>

            <div>
              <h3 className="font-bold text-sm mb-1.5">Hàng khách đặt</h3>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Tên hàng</th><th>Đơn vị</th>
                      <th className="text-right">Đặt</th>
                      <th className="text-right">Đã giao</th>
                      <th className="text-right">Còn thiếu</th>
                      <th className="text-right">Tồn kho</th>
                      <th className="text-right">Đơn giá</th>
                      <th className="text-right">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.items.map((i) => {
                      const shortStock = i.remaining_qty * i.factor > i.stock_qty;
                      return (
                        <tr key={i.id}>
                          <td>
                            <div>{i.name_snapshot}</div>
                            {i.note && <div className="text-2xs text-muted-ink">{i.note}</div>}
                          </td>
                          <td>{i.unit_name}</td>
                          <td className="text-right tabular">{fq(i.qty)}</td>
                          <td className="text-right tabular text-emerald-700 font-semibold">{fq(i.delivered_qty)}</td>
                          <td className="text-right tabular">
                            {i.remaining_qty > 0
                              ? <Badge tone="warn">Còn thiếu {fq(i.remaining_qty)}</Badge>
                              : <Badge tone="ok">Đủ</Badge>}
                          </td>
                          <td className={`text-right tabular ${shortStock && i.remaining_qty > 0 ? 'text-danger font-semibold' : 'text-muted-ink'}`}>
                            {fq(i.stock_qty)}
                            {shortStock && i.remaining_qty > 0 && <span className="ml-1 text-2xs">thiếu</span>}
                          </td>
                          <td className="text-right tabular">{money(i.price)}</td>
                          <td className="text-right tabular font-semibold">{money(i.amount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {timeline.length > 0 && (
              <div>
                <h3 className="font-bold text-sm mb-1.5 flex items-center gap-1.5">
                  <History size={14} aria-hidden="true" /> Dòng thời gian cọc và giao hàng
                </h3>
                <ol className="relative border-l-2 border-line ml-2 space-y-2">
                  {timeline.map((t) => (t.type === 'deposit'
                    ? <DepositEvent key={`dp${t.d.id}`} d={t.d} onPrint={() => setPrinting({ kind: 'deposit', refId: t.d.id })} />
                    : <DeliveryEvent key={`dl${t.d.id}`} d={t.d} onPrint={() => setPrinting({ kind: 'delivery', refId: t.d.id })} />))}
                </ol>
              </div>
            )}

            {(o.delivery_address || o.note) && (
              <div className="card-pad text-[13px] space-y-1">
                {o.delivery_address && (
                  <div><span className="text-muted-ink">Giao tới: </span>{o.delivery_address}
                    {o.carrier_name && <span className="text-muted-ink"> · qua {o.carrier_name}</span>}</div>
                )}
                {o.note && <div><span className="text-muted-ink">Ghi chú: </span>{o.note}</div>}
              </div>
            )}
          </div>
        )}
      </Modal>

      {delivering && o && (
        <DeliverModal order={o} onClose={() => setDelivering(false)}
          onDone={(res) => afterAction('delivery', res?.delivery_id)} />
      )}
      {depositing && o && (
        <DepositModal order={o} onClose={() => setDepositing(false)}
          onDone={(res) => afterAction('deposit', res?.deposit_id)} />
      )}
      {cancelling && o && (
        <CancelModal order={o} onClose={() => setCancelling(false)} onDone={() => { changed(); onClose(); }} />
      )}
      {editing && o && (
        <OrderForm order={o} onClose={() => setEditing(false)} onSaved={changed} />
      )}
      {printing && o && (
        <OrderSummaryPrint order={o} kind={printing.kind} refId={printing.refId} onClose={() => setPrinting(null)} />
      )}
    </>
  );
}

function InfoBox({ label, value, sub, tone }) {
  return (
    <div className="card p-2.5">
      <div className="text-2xs text-muted-ink uppercase tracking-wide">{label}</div>
      <div className={`font-semibold tabular truncate ${tone === 'bad' ? 'text-danger' : tone === 'good' ? 'text-emerald-700' : ''}`}>{value}</div>
      {sub && <div className="text-2xs text-muted-ink truncate">{sub}</div>}
    </div>
  );
}

function EventDot({ tone }) {
  return (
    <span
      className={`absolute -left-[9px] mt-2.5 w-4 h-4 rounded-full border-2 border-white ${tone}`}
      aria-hidden="true"
    />
  );
}

function DepositEvent({ d, onPrint }) {
  const refund = d.amount < 0;
  return (
    <li className="ml-4">
      <EventDot tone={refund ? 'bg-rose-500' : 'bg-emerald-600'} />
      <div className="card p-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <HandCoins size={15} className={refund ? 'text-danger' : 'text-emerald-700'} aria-hidden="true" />
        <span className="font-semibold">{refund ? 'Hoàn cọc' : `Nhận cọc lần ${d.seq}`}</span>
        <span className="text-muted-ink tabular">{datetime(d.ts)}</span>
        {!refund && <span>Người đưa: <b>{d.payer_display}</b></span>}
        {d.account_name && <span className="text-2xs text-muted-ink">{d.account_name}</span>}
        <span className="flex-1" />
        <span className={`tabular font-bold ${refund ? 'text-danger' : 'text-emerald-700'}`}>
          {refund ? '− ' : '+ '}{money(Math.abs(d.amount))}
        </span>
        {!refund && <IconButton icon={Printer} size={14} label={`In lại phiếu thu cọc lần ${d.seq}`} onClick={onPrint} />}
      </div>
    </li>
  );
}

function DeliveryEvent({ d, onPrint }) {
  const ship = d.mode === 'ship';
  const cancelled = d.sale_status === 'cancelled';
  return (
    <li className="ml-4">
      <EventDot tone={cancelled ? 'bg-slate-300' : ship ? 'bg-sky-600' : 'bg-primary'} />
      <div className={`card p-2 space-y-1 text-[13px] ${cancelled ? 'opacity-60' : ''}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {ship ? <Truck size={15} className="text-sky-700" aria-hidden="true" /> : <Store size={15} aria-hidden="true" />}
          <span className="font-semibold">Giao đợt {d.seq} — {ship ? 'Giao tận nơi' : 'Khách tự lấy'}</span>
          <span className="text-muted-ink tabular">{datetime(d.ts)}</span>
          <span className="font-mono text-2xs">{d.sale_code}</span>
          {cancelled && <Badge tone="bad">Hoá đơn đã huỷ</Badge>}
          <span className="flex-1" />
          <span className="tabular font-bold">{money(deliveryGoods(d))}</span>
          <IconButton icon={Printer} size={14} label={`In lại phiếu giao đợt ${d.seq}`} onClick={onPrint} />
        </div>
        {ship && (
          <div className="text-2xs text-muted-ink flex flex-wrap gap-x-3">
            <span className="inline-flex items-center gap-1"><MapPin size={11} aria-hidden="true" />
              {[d.delivery_name, d.delivery_phone, d.delivery_address].filter(Boolean).join(' · ') || 'Chưa ghi người nhận'}
            </span>
            {(d.carrier_name || d.shipper_name) && <span>{[d.carrier_name, d.shipper_name].filter(Boolean).join(' · ')}</span>}
            {d.cod_amount > 0 && <span className="font-semibold text-amber-800">COD {money(d.cod_amount)}</span>}
          </div>
        )}
        {d.items?.length > 0 && (
          <div className="text-2xs text-muted-ink">
            {d.items.map((i) => `${i.name_snapshot} × ${fq(i.qty)} ${i.unit_name}`).join(' · ')}
          </div>
        )}
      </div>
    </li>
  );
}

/* =========================== GIAO HÀNG ============================= */

const fromOrder = (o) => ({
  ...EMPTY_DELIVERY,
  name: o.delivery_name || o.customer_display || '',
  phone: o.delivery_phone || o.phone_display || '',
  address: o.delivery_address || o.customer_address || '',
  carrierId: o.carrier_id || null,
  carrierName: o.carrier_name || '',
});

function DeliverModal({ order, onClose, onDone }) {
  const { user, meta, toast } = useApp();
  const pending = order.items.filter((i) => i.remaining_qty > 0.0001);
  const [mode, setMode] = useState(order.delivery_address ? 'ship' : 'pickup');
  const [qtys, setQtys] = useState(() => {
    // Mặc định giao hết phần còn lại, nhưng không quá số đang có trong kho
    const m = {};
    for (const i of pending) {
      m[i.id] = Math.max(0, Math.min(i.remaining_qty, Math.floor((i.stock_qty / i.factor) * 1000) / 1000));
    }
    return m;
  });
  const [d, setD] = useState(() => fromOrder(order));
  const [paid, setPaid] = useState(0);
  const [method, setMethod] = useState('cash');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { data: carriers } = useFetch(() => api.carriers(), []);
  const { data: users } = useFetch(() => api.users(), []);
  const staff = (Array.isArray(users) ? users : []).filter((u) => u.active);
  const setDv = (k, v) => { setErr(''); setD((p) => ({ ...p, [k]: v })); };

  const chosen = pending.filter((i) => (qtys[i.id] || 0) > 0);
  const gross = chosen.reduce((a, i) => {
    const q = qtys[i.id] || 0;
    const g = Math.round(q * i.price);
    const disc = i.discount_type === 'percent'
      ? Math.round(g * (i.discount_percent || 0) / 100)
      : Math.round((i.discount || 0) * (q / i.qty));
    return a + g - Math.min(disc, g);
  }, 0);
  const orderDisc = order.subtotal > 0 ? Math.round(order.discount * (gross / order.subtotal)) : 0;
  const goods = gross - Math.min(orderDisc, gross);
  const shipFee = mode === 'ship' ? Math.max(0, Math.round(Number(d.shipFee) || 0)) : 0;
  const shipCharged = mode === 'ship' && !d.shopPaysShip ? shipFee : 0;
  const saleTotal = goods + shipCharged;
  const useDeposit = Math.min(order.deposit_left, saleTotal);
  const paidNow = Math.max(0, Number(paid) || 0);
  const rest = Math.max(0, saleTotal - useDeposit - paidNow);
  const codOn = mode === 'ship' && (d.codMode !== false || !order.customer_id);

  const check = () => {
    if (!chosen.length) return 'Chưa chọn món nào để giao.';
    if (mode !== 'ship') return '';
    if (!String(d.address).trim() && !d.carrierId && d.shipperMode === 'none') {
      return 'Giao tận nơi thì cần địa chỉ giao, hoặc đơn vị vận chuyển / người giao hàng.';
    }
    if (d.shipperMode === 'staff' && !d.shipperUserId) return 'Chọn nhân viên đi giao.';
    if (d.shipperMode === 'free' && !String(d.shipperName).trim() && !String(d.shipperPhone).trim()) {
      return 'Nhập tên hoặc số điện thoại của shipper tự do.';
    }
    return '';
  };

  const submit = async () => {
    const m = check();
    if (m) { setErr(m); return; }
    setBusy(true);
    try {
      const res = await api.post(`/orders/${order.id}/deliver`, {
        mode,
        items: chosen.map((i) => ({ item_id: i.id, qty: qtys[i.id] })),
        paid: paidNow,
        received: paidNow,
        payment_method: method,
        account_id: accountId || null,
        user_id: user?.id || null,
        note: note || null,
        ...(mode === 'ship' ? deliveryBody({ ...d, shipFee, codMode: codOn }) : {}),
      });
      toast(`Đã xuất hoá đơn ${res.sale_code} — đợt giao ${res.delivery_no}${res.status === 'done' ? ', đơn đã giao xong' : ''}`, 'ok', 6000);
      onClose();
      onDone?.(res);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Giao hàng cho đơn ${order.code}`}
      subtitle="Mỗi đợt giao xuất một hoá đơn bán hàng riêng, trừ kho và tự trừ tiền cọc còn giữ."
      size="xl"
      footer={
        <>
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" icon={Printer} onClick={submit} loading={busy} disabled={!chosen.length}>
            Xuất HĐ Giao Hàng
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div role="tablist" aria-label="Hình thức giao" className="grid grid-cols-2 gap-1.5">
          {[['pickup', 'Khách tự lấy', Store, 'Khách tới quầy nhận hàng'],
            ['ship', 'Giao hàng', Truck, 'Giao tận nơi, người giao thu hộ']].map(([k, label, Icon, hint]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={mode === k}
              onClick={() => { setMode(k); setErr(''); }}
              className={`flex items-center gap-2 rounded-lg border p-2.5 text-left cursor-pointer transition-colors duration-150
                          focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent
                          ${mode === k ? 'border-accent bg-accent-soft' : 'border-line hover:bg-muted'}`}
            >
              <Icon size={18} className={mode === k ? 'text-emerald-800' : 'text-muted-ink'} aria-hidden="true" />
              <span>
                <span className="block text-[13px] font-bold">{label}</span>
                <span className="block text-2xs text-muted-ink">{hint}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Tên hàng</th><th>Đơn vị</th>
                <th className="text-right">Còn phải giao</th>
                <th className="text-right">Tồn kho</th>
                <th style={{ width: 110 }} className="text-right">Giao đợt này</th>
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
                    </td>
                    <td>
                      <QtyInput
                        value={qtys[i.id] || 0}
                        onChange={(v) => setQtys((m) => ({ ...m, [i.id]: Math.min(v, i.remaining_qty) }))}
                        min={0}
                        aria-label={`Số lượng giao đợt này ${i.name_snapshot}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid lg:grid-cols-[1fr_300px] gap-3">
          <div className="space-y-2.5">
            {mode === 'ship' && (
              <>
                <section className="space-y-2.5" aria-labelledby="dl-h-recv">
                  <h3 id="dl-h-recv" className="text-[13px] font-bold">Người nhận</h3>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <Field label="Tên người nhận" htmlFor="dl-name">
                      <Input id="dl-name" value={d.name} onChange={(e) => setDv('name', e.target.value)} />
                    </Field>
                    <Field label="Số điện thoại" htmlFor="dl-phone">
                      <Input id="dl-phone" value={d.phone} onChange={(e) => setDv('phone', e.target.value)} inputMode="tel" />
                    </Field>
                  </div>
                  <Field label="Địa chỉ giao hàng" htmlFor="dl-addr">
                    <Textarea id="dl-addr" rows={2} value={d.address} onChange={(e) => setDv('address', e.target.value)}
                      placeholder="Số nhà, ấp/khu phố, xã/phường, huyện/tỉnh" />
                  </Field>
                </section>

                <section className="space-y-2.5 border-t border-line pt-3" aria-labelledby="dl-h-ship">
                  <h3 id="dl-h-ship" className="text-[13px] font-bold">Vận chuyển</h3>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <Field label="Đơn vị vận chuyển" htmlFor="dl-carrier">
                      <Select id="dl-carrier" value={d.carrierId || ''}
                        onChange={(e) => {
                          const cid = e.target.value ? Number(e.target.value) : null;
                          setErr('');
                          setD((p) => ({ ...p, carrierId: cid, carrierName: (carriers || []).find((c) => c.id === cid)?.name || '' }));
                        }}>
                        <option value="">— Không qua đối tác —</option>
                        {(carriers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </Select>
                    </Field>
                    <Field label="Mã vận đơn" htmlFor="dl-track">
                      <Input id="dl-track" value={d.trackingCode} onChange={(e) => setDv('trackingCode', e.target.value)} />
                    </Field>
                  </div>
                  <div>
                    <span className="label" id="dl-shipper">Người giao trực tiếp</span>
                    <div className="grid grid-cols-3 rounded border border-line overflow-hidden" role="radiogroup" aria-labelledby="dl-shipper">
                      {[['none', 'Không có'], ['staff', 'Nhân viên cửa hàng'], ['free', 'Shipper tự do']].map(([k, lb]) => (
                        <button key={k} type="button" role="radio" aria-checked={d.shipperMode === k}
                          onClick={() => setDv('shipperMode', k)}
                          className={`h-9 px-2 text-[13px] font-semibold transition-colors duration-100 cursor-pointer
                                      ${d.shipperMode === k ? 'bg-primary text-white' : 'bg-card hover:bg-muted'}`}>
                          {lb}
                        </button>
                      ))}
                    </div>
                  </div>
                  {d.shipperMode === 'staff' && (
                    <Field label="Nhân viên đi giao" htmlFor="dl-staff">
                      <Select id="dl-staff" value={d.shipperUserId || ''}
                        onChange={(e) => {
                          const uid = e.target.value ? Number(e.target.value) : null;
                          setErr('');
                          setD((p) => ({ ...p, shipperUserId: uid, shipperUserName: staff.find((u) => u.id === uid)?.full_name || '' }));
                        }}>
                        <option value="">— Chọn nhân viên —</option>
                        {staff.map((u) => (
                          <option key={u.id} value={u.id}>{u.full_name}{ROLE_LABEL[u.role] ? ` · ${ROLE_LABEL[u.role]}` : ''}</option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  {d.shipperMode === 'free' && (
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <Field label="Tên shipper" htmlFor="dl-sname">
                        <Input id="dl-sname" value={d.shipperName} onChange={(e) => setDv('shipperName', e.target.value)} />
                      </Field>
                      <Field label="Số điện thoại shipper" htmlFor="dl-sphone">
                        <Input id="dl-sphone" value={d.shipperPhone} onChange={(e) => setDv('shipperPhone', e.target.value)} inputMode="tel" />
                      </Field>
                    </div>
                  )}
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <Field label="Phí vận chuyển" htmlFor="dl-fee">
                      <MoneyInput id="dl-fee" value={d.shipFee} onChange={(v) => setDv('shipFee', Math.max(0, v))} />
                      <label className="flex items-center gap-1.5 mt-1.5 text-2xs cursor-pointer">
                        <input type="checkbox" className="w-3.5 h-3.5 accent-emerald-700 cursor-pointer"
                          checked={d.shopPaysShip} onChange={(e) => setDv('shopPaysShip', e.target.checked)} />
                        Cửa hàng chịu phí (không cộng vào hoá đơn)
                      </label>
                    </Field>
                    <Field label="Ghi chú giao hàng" htmlFor="dl-dnote">
                      <Input id="dl-dnote" value={d.note} onChange={(e) => setDv('note', e.target.value)}
                        placeholder="VD: gọi trước khi giao" />
                    </Field>
                  </div>
                </section>
              </>
            )}

            <div className="grid gap-2.5 sm:grid-cols-3">
              <Field label={mode === 'ship' ? 'Khách trả trước khi giao' : 'Khách trả thêm bây giờ'} hint="Ngoài phần đã cọc">
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
            <Field label="Ghi chú đợt giao" htmlFor="dl-note">
              <Input id="dl-note" value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="VD: giao đợt 1, còn thiếu dây" />
            </Field>
          </div>

          <div className="card p-3 space-y-1 h-fit">
            <TotalRow label="Tiền hàng đợt này" value={money(gross)} />
            {orderDisc > 0 && <TotalRow label="Giảm giá chia theo đợt" value={'− ' + money(orderDisc)} />}
            {shipCharged > 0 && <TotalRow label="Phí vận chuyển" value={money(shipCharged)} />}
            <TotalRow label="Tiền hoá đơn" value={money(saleTotal)} big />
            <TotalRow
              label="Trừ từ tiền cọc"
              value={useDeposit > 0 ? '− ' + money(useDeposit) : '—'}
              tone={useDeposit > 0 ? 'good' : undefined}
              hint={order.deposit_left > 0 ? `cọc còn ${money(order.deposit_left)}` : 'đơn không có cọc'}
            />
            <TotalRow label={mode === 'ship' ? 'Khách trả trước' : 'Khách trả thêm'} value={money(paidNow)} />
            <TotalRow
              label={rest <= 0 ? 'Đã trả đủ' : codOn ? 'Thu hộ (COD)' : 'Khách còn nợ'}
              value={money(rest)}
              big
              tone={rest > 0 ? (codOn ? undefined : 'bad') : 'good'}
            />
            {mode === 'ship' && order.customer_id && (
              <label className="flex items-start gap-1.5 text-2xs cursor-pointer pt-1">
                <input type="checkbox" className="w-3.5 h-3.5 mt-0.5 accent-emerald-700 cursor-pointer"
                  checked={d.codMode === false} onChange={(e) => setDv('codMode', !e.target.checked)} />
                <span>Không thu hộ — phần còn lại ghi nợ khách</span>
              </label>
            )}
            <p className="text-2xs text-muted-ink pt-1">Xuất xong tự in phiếu giao hàng kèm tổng kết đơn.</p>
          </div>
        </div>

        {err && <p role="alert" className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
      </div>
    </Modal>
  );
}

/* ============================ NHẬN CỌC ============================= */

function DepositModal({ order, onClose, onDone }) {
  const { user, meta, toast } = useApp();
  const left = order.total - order.deposit;
  const [amount, setAmount] = useState(0);
  const [payer, setPayer] = useState('');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const nextNo = (order.summary?.deposit_count || 0) + 1;

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/orders/${order.id}/deposit`, {
        amount: Number(amount) || 0,
        payer_name: payer.trim() || null,
        account_id: accountId || null,
        user_id: user?.id || null,
        note: note.trim() || null,
      });
      toast(`Đã ghi nhận cọc lần ${res.deposit_no} — ${res.payer_name}`, 'ok');
      onClose();
      onDone?.(res);
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Nhận thêm cọc — lần ${nextNo}`}
      subtitle={`Đơn ${order.code} — đã cọc ${money(order.deposit)}, còn ${money(left)} chưa cọc`}
      footer={
        <>
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" icon={Printer} onClick={submit} loading={busy} disabled={!(Number(amount) > 0)}>
            Ghi nhận cọc
          </Button>
        </>
      }
    >
      <div className="space-y-2.5">
        <Field label="Số tiền cọc" hint="Tiền vào quỹ ngay, khi giao hàng sẽ tự trừ vào hoá đơn">
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </Field>
        <div className="flex gap-1.5 flex-wrap">
          {/* Không gợi ý mức cọc vượt quá phần chưa cọc, máy chủ sẽ chặn */}
          {[Math.round(left / 2), 500000, 1000000, left]
            .filter((v, i, a) => v > 0 && v <= left && a.indexOf(v) === i)
            .map((v) => (
              <button key={v} type="button" className="btn btn-sm" onClick={() => setAmount(v)}>
                {money(v)}
              </button>
            ))}
        </div>
        <Field label="Người đưa cọc" hint={`Để trống thì ghi tên khách đặt: ${order.customer_display}`} htmlFor="dp-payer">
          <Input id="dp-payer" value={payer} onChange={(e) => setPayer(e.target.value)}
            placeholder={order.customer_display} />
        </Field>
        <Field label="Vào quỹ">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Quỹ mặc định</option>
            {meta.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="Ghi chú" htmlFor="dp-note">
          <Input id="dp-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: chuyển khoản qua Vietcombank" />
        </Field>
        <p className="text-2xs text-muted-ink">Ghi nhận xong tự in phiếu thu tiền cọc lần {nextNo} kèm tổng kết đơn.</p>
      </div>
    </Modal>
  );
}

/* ============================= HUỶ ĐƠN ============================= */

function CancelModal({ order, onClose, onDone }) {
  const { user, meta, toast } = useApp();
  const [refund, setRefund] = useState(order.deposit_left);
  const [reason, setReason] = useState('');
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/orders/${order.id}/cancel`, {
        refund: Number(refund) || 0, reason, account_id: accountId || null, user_id: user?.id || null,
      });
      toast('Đã huỷ đơn đặt hàng', 'ok');
      onDone?.();
      onClose();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Huỷ đơn ${order.code}`}
      subtitle="Các đợt đã giao vẫn giữ nguyên hoá đơn, chỉ phần chưa giao là bỏ."
      footer={
        <>
          <Button onClick={onClose}>Không huỷ nữa</Button>
          <Button variant="danger" icon={XCircle} onClick={submit} loading={busy}>Huỷ đơn</Button>
        </>
      }
    >
      <div className="space-y-2.5">
        <Field label="Lý do huỷ" htmlFor="cn-reason">
          <Input id="cn-reason" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="VD: khách đổi ý, hàng ngừng sản xuất" autoFocus />
        </Field>
        {order.deposit_left > 0 ? (
          <>
            <Field label="Hoàn lại cho khách" hint={`Cọc còn giữ ${money(order.deposit_left)}`}>
              <MoneyInput value={refund} onChange={setRefund} />
            </Field>
            <Field label="Chi từ quỹ">
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Quỹ mặc định</option>
                {meta.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
            {Number(refund) < order.deposit_left && (
              <div className="card-pad bg-amber-50 border-warn/30 text-[13px] text-amber-900">
                Giữ lại {money(order.deposit_left - (Number(refund) || 0))} tiền cọc.
                Nhớ nói rõ với khách vì sao không hoàn đủ.
              </div>
            )}
          </>
        ) : (
          <div className="text-[13px] text-muted-ink">Đơn này không còn tiền cọc phải hoàn.</div>
        )}
      </div>
    </Modal>
  );
}

/* ================ IN PHIẾU ĐẶT HÀNG / PHIẾU TỔNG KẾT ================= */

/** Lấy đơn mới nhất rồi in — dùng khi vừa lập đơn xong. */
function OrderPrintJob({ job, onClose }) {
  const { toast } = useApp();
  const { data: o, error } = useFetch(() => api.order(job.id), [job.id]);
  useEffect(() => {
    if (!error) return;
    toast(`Đã lưu đơn nhưng chưa mở được bản in: ${error.message}`, 'warn', 7000);
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);
  if (!o) return null;
  return <OrderSummaryPrint order={o} kind={job.kind} refId={job.refId} onClose={onClose} />;
}

const P = ({ children, className = '' }) => <div className={`text-[11px] ${className}`}>{children}</div>;
const PrintHeading = ({ children }) => (
  <div className="font-bold text-[12px] uppercase mt-3 mb-1 border-b border-black pb-0.5">{children}</div>
);

/**
 * kind:
 *   order     phiếu đặt hàng lúc vừa lập
 *   deposit   phiếu thu tiền cọc lần X + tổng kết
 *   delivery  phiếu giao hàng đợt X + tổng kết
 *   summary   phiếu tổng kết đơn, in lại lúc nào cũng được
 */
function OrderSummaryPrint({ order: o, kind = 'summary', refId = null, onClose }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const t = setTimeout(() => window.print(), 300);
    const after = () => closeRef.current?.();
    window.addEventListener('afterprint', after);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', after); };
  }, []);

  const st = o.store || {};
  const sum = o.summary || {};
  const positive = (o.deposits || []).filter((d) => d.amount > 0);
  const dep = kind === 'deposit'
    ? (o.deposits || []).find((d) => d.id === refId) || positive[positive.length - 1] : null;
  const dlv = kind === 'delivery'
    ? (o.deliveries || []).find((d) => d.id === refId) || o.deliveries?.[o.deliveries.length - 1] : null;
  const isOrder = kind === 'order';
  const title = dep ? `Phiếu thu tiền cọc lần ${dep.seq}`
    : dlv ? `Phiếu giao hàng đợt ${dlv.seq}`
      : isOrder ? 'Phiếu đặt hàng' : 'Phiếu tổng kết đơn hàng';
  const wide = kind === 'delivery' || kind === 'summary';

  return (
    <div className={`print-area ${wide ? 'size-a4' : 'size-a5'}`}>
      <div className="mx-auto p-6 text-black bg-white" style={{ width: wide ? '210mm' : '148mm' }}>
        <div className="text-center mb-2">
          <div className="font-bold text-base uppercase">{st.name || 'CỬA HÀNG'}</div>
          {st.address && <div className="text-[11px]">{st.address}</div>}
          {st.phone && <div className="text-[11px]">ĐT: {st.phone}</div>}
        </div>
        <h1 className="text-center font-bold text-sm uppercase mb-0.5">{title}</h1>
        <div className="text-center text-[11px] mb-2">
          Đơn {o.code} — lập ngày {datetime(o.ts)}
          {!isOrder && <> — in lúc {datetime(new Date())}</>}
        </div>

        <table className="w-full text-[11px] mb-1">
          <tbody>
            <tr><td className="py-0.5 w-28">Khách hàng</td><td className="font-semibold">{o.customer_display}</td></tr>
            {o.phone_display && <tr><td className="py-0.5">Điện thoại</td><td>{o.phone_display}</td></tr>}
            {o.promised_at && <tr><td className="py-0.5">Hẹn giao</td><td>{date(o.promised_at)}</td></tr>}
            <tr><td className="py-0.5">Trạng thái</td><td>{STATUS[o.status]?.label || o.status}</td></tr>
          </tbody>
        </table>

        {/* ---------- Lần cọc vừa thu ---------- */}
        {dep && (
          <div className="border-2 border-black p-2 my-2 text-[12px] space-y-0.5">
            <div className="flex justify-between"><span>Lần cọc</span><b>Lần {dep.seq}</b></div>
            <div className="flex justify-between"><span>Ngày thu</span><span>{datetime(dep.ts)}</span></div>
            <div className="flex justify-between"><span>Người đưa cọc</span><b>{dep.payer_display}</b></div>
            <div className="flex justify-between text-[14px]"><span>Số tiền</span><b>{n(dep.amount)} đ</b></div>
            <div className="italic text-[11px]">Bằng chữ: {readMoney(dep.amount)}</div>
          </div>
        )}

        {/* ---------- Đợt giao vừa xuất ---------- */}
        {dlv && (
          <div className="border-2 border-black p-2 my-2 text-[11px] space-y-0.5">
            <div className="flex justify-between text-[12px]">
              <b>Đợt {dlv.seq} — {dlv.mode === 'ship' ? 'Giao tận nơi' : 'Khách tự lấy'}</b>
              <span>{datetime(dlv.ts)} · HĐ {dlv.sale_code}</span>
            </div>
            {dlv.mode === 'ship' && (
              <>
                <div>Người nhận: <b>{dlv.delivery_name || o.customer_display}</b>{dlv.delivery_phone ? ` · ${dlv.delivery_phone}` : ''}</div>
                {dlv.delivery_address && <div>Địa chỉ: {dlv.delivery_address}</div>}
                {(dlv.carrier_name || dlv.shipper_name) && <div>Vận chuyển: {[dlv.carrier_name, dlv.shipper_name].filter(Boolean).join(' · ')}</div>}
                {dlv.ship_fee > 0 && <div>Phí ship: {n(dlv.ship_fee)} đ ({dlv.ship_payer === 'shop' ? 'cửa hàng chịu' : 'khách trả'})</div>}
              </>
            )}
            <table className="w-full border-collapse mt-1">
              <thead>
                <tr className="border-y border-black">
                  <th className="text-left py-0.5">Hàng giao đợt này</th>
                  <th className="text-right py-0.5 w-14">SL</th>
                  <th className="text-left py-0.5 w-14 pl-1">ĐVT</th>
                  <th className="text-right py-0.5 w-24">Thành tiền</th>
                </tr>
              </thead>
              <tbody>
                {(dlv.items || []).map((i, k) => (
                  <tr key={k} className="border-b border-slate-300">
                    <td className="py-0.5">{i.name_snapshot}</td>
                    <td className="text-right py-0.5">{fq(i.qty)}</td>
                    <td className="py-0.5 pl-1">{i.unit_name}</td>
                    <td className="text-right py-0.5">{n(i.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-between pt-0.5"><span>Tiền hoá đơn đợt này</span><b>{n(dlv.sale_total)} đ</b></div>
            {dlv.deposit_applied > 0 && <div className="flex justify-between"><span>Trừ từ tiền cọc</span><span>− {n(dlv.deposit_applied)}</span></div>}
            {dlv.cod_amount > 0 && <div className="flex justify-between text-[12px]"><b>Người giao thu hộ (COD)</b><b>{n(dlv.cod_amount)} đ</b></div>}
          </div>
        )}

        {/* ---------- 1 + 3. Hàng đặt, đã giao, còn thiếu ---------- */}
        <PrintHeading>{isOrder ? 'Hàng đặt' : '1. Danh sách hàng đặt'}</PrintHeading>
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="border-b border-black">
              <th className="text-left py-0.5">Tên hàng</th>
              <th className="text-right py-0.5 w-12">SL đặt</th>
              <th className="text-left py-0.5 w-12 pl-1">ĐVT</th>
              <th className="text-right py-0.5 w-20">Đơn giá</th>
              <th className="text-right py-0.5 w-24">Thành tiền</th>
              {!isOrder && <th className="text-right py-0.5 w-16">Đã giao</th>}
              {!isOrder && <th className="text-right py-0.5 w-16">Còn thiếu</th>}
            </tr>
          </thead>
          <tbody>
            {o.items.map((i) => (
              <tr key={i.id} className="border-b border-slate-300">
                <td className="py-0.5">{i.name_snapshot}</td>
                <td className="text-right py-0.5">{fq(i.qty)}</td>
                <td className="py-0.5 pl-1">{i.unit_name}</td>
                <td className="text-right py-0.5">{n(i.price)}</td>
                <td className="text-right py-0.5">{n(i.amount)}</td>
                {!isOrder && <td className="text-right py-0.5">{fq(i.delivered_qty)}</td>}
                {!isOrder && <td className="text-right py-0.5 font-semibold">{i.remaining_qty > 0 ? fq(i.remaining_qty) : '0'}</td>}
              </tr>
            ))}
          </tbody>
        </table>

        {/* ---------- 2. Các đợt giao ---------- */}
        {!isOrder && (o.deliveries || []).length > 0 && (
          <>
            <PrintHeading>2. Lịch sử giao hàng</PrintHeading>
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="border-b border-black">
                  <th className="text-left py-0.5 w-10">Đợt</th>
                  <th className="text-left py-0.5 w-28">Ngày</th>
                  <th className="text-left py-0.5">Hình thức · hàng giao</th>
                  <th className="text-right py-0.5 w-24">Tiền hàng</th>
                </tr>
              </thead>
              <tbody>
                {o.deliveries.map((d) => (
                  <tr key={d.id} className="border-b border-slate-300 align-top">
                    <td className="py-0.5">{d.seq}</td>
                    <td className="py-0.5">{datetime(d.ts)}</td>
                    <td className="py-0.5">
                      <b>{d.mode === 'ship' ? 'Giao tận nơi' : 'Khách tự lấy'}</b>
                      {d.sale_status === 'cancelled' && ' (hoá đơn đã huỷ)'}
                      {d.mode === 'ship' && d.delivery_address ? ` — ${d.delivery_address}` : ''}
                      <div>{(d.items || []).map((i) => `${i.name_snapshot} × ${fq(i.qty)}`).join('; ')}</div>
                    </td>
                    <td className="text-right py-0.5">{n(deliveryGoods(d))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* ---------- 4. Các lần cọc ---------- */}
        {!isOrder && (o.deposits || []).length > 0 && (
          <>
            <PrintHeading>{(o.deliveries || []).length > 0 ? '3' : '2'}. Lịch sử đặt cọc</PrintHeading>
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="border-b border-black">
                  <th className="text-left py-0.5 w-14">Lần</th>
                  <th className="text-left py-0.5 w-28">Ngày</th>
                  <th className="text-left py-0.5">Người đưa cọc</th>
                  <th className="text-right py-0.5 w-24">Số tiền</th>
                </tr>
              </thead>
              <tbody>
                {o.deposits.map((d) => (
                  <tr key={d.id} className="border-b border-slate-300">
                    <td className="py-0.5">{d.amount > 0 ? d.seq : 'Hoàn'}</td>
                    <td className="py-0.5">{datetime(d.ts)}</td>
                    <td className="py-0.5">{d.amount > 0 ? d.payer_display : (d.note || 'Hoàn cọc')}</td>
                    <td className="text-right py-0.5">{d.amount < 0 ? '− ' : ''}{n(Math.abs(d.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* ---------- Tổng kết ---------- */}
        {isOrder ? (
          <table className="w-full text-[11px] ml-auto mt-2" style={{ maxWidth: '64mm' }}>
            <tbody>
              <tr><td className="py-0.5">Tiền hàng</td><td className="text-right">{n(o.subtotal)}</td></tr>
              {o.discount > 0 && <tr><td className="py-0.5">Giảm giá</td><td className="text-right">− {n(o.discount)}</td></tr>}
              <tr className="border-t border-black font-bold"><td className="py-1">Tổng cộng</td><td className="text-right py-1">{n(o.total)} đ</td></tr>
              <tr><td className="py-0.5">Đã đặt cọc{positive[0] ? ` (${positive[0].payer_display})` : ''}</td><td className="text-right">{n(o.deposit)}</td></tr>
              <tr className="font-bold"><td className="py-0.5">Còn phải trả</td><td className="text-right">{n(Math.max(0, o.total - o.deposit))} đ</td></tr>
            </tbody>
          </table>
        ) : (
          <>
            <PrintHeading>Tổng kết</PrintHeading>
            <table className="w-full text-[12px] ml-auto" style={{ maxWidth: wide ? '96mm' : '80mm' }}>
              <tbody>
                <tr><td className="py-0.5">Tổng tiền đơn</td><td className="text-right">{n(sum.total ?? o.total)} đ</td></tr>
                <tr><td className="py-0.5">Tổng cọc ({n(sum.deposit_count || 0)} lần)</td><td className="text-right">{n(sum.deposit_total ?? o.deposit)} đ</td></tr>
                <tr><td className="py-0.5">Tổng giá trị đã giao</td><td className="text-right">{n(sum.delivered_value || 0)} đ</td></tr>
                {sum.paid_at_delivery > 0 && (
                  <tr><td className="py-0.5">Khách trả thêm khi nhận hàng</td><td className="text-right">{n(sum.paid_at_delivery)} đ</td></tr>
                )}
                <tr className="border-t-2 border-black font-bold text-[13px]">
                  <td className="py-1">TỔNG CỘNG (NỢ CÒN LẠI)</td>
                  <td className="text-right py-1">{n(sum.remaining ?? Math.max(0, o.total - o.deposit))} đ</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {o.note && <P className="mt-2">Ghi chú: {o.note}</P>}

        {isOrder && (
          <div className="text-[10px] mt-3 leading-relaxed">
            <div className="font-semibold mb-0.5">Lưu ý</div>
            <div>1. Giữ phiếu này để đối chiếu khi nhận hàng.</div>
            <div>2. Tiền cọc được trừ vào tiền hàng khi giao.</div>
            <div>3. Hàng đặt riêng theo yêu cầu, cửa hàng không nhận đổi trả.</div>
          </div>
        )}

        <div className="flex justify-between text-[11px] mt-6 text-center">
          <div className="flex-1">
            <div className="font-semibold">{dep ? 'Người đưa cọc' : dlv ? 'Người nhận hàng' : 'Khách hàng'}</div>
            <div className="text-[10px]">(ký, ghi rõ họ tên)</div>
          </div>
          <div className="flex-1">
            <div className="font-semibold">{dep ? 'Người thu tiền' : dlv ? 'Người giao hàng' : 'Người lập phiếu'}</div>
            <div className="text-[10px]">{o.user_name || ''}</div>
          </div>
        </div>
      </div>

      <div className="no-print fixed bottom-4 right-4 flex gap-2">
        <Button onClick={onClose}>Đóng</Button>
        <Button variant="primary" icon={Printer} onClick={() => window.print()}>In lại</Button>
      </div>
    </div>
  );
}

/* ================== CẦN MUA ĐỂ GIAO ĐƠN (GỢI Ý) ==================== */

function Shortage() {
  const { data, busy, error, reload } = useFetch(() => api.ordersShortage(), []);
  const [printing, setPrinting] = useState(false);

  if (busy) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.groups?.length) {
    return (
      <Empty
        icon={CheckCircle2}
        title="Không thiếu món nào"
        message="Hàng trong kho đủ giao hết đơn đang chờ, và không món nào dưới tồn tối thiểu."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="card-pad flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px]">
          <b>{n(data.total_items)} mặt hàng</b> cần mua, ước tính{' '}
          <b className="tabular">{money(data.est_cost)}</b> tiền vốn.
          <div className="text-muted-ink mt-0.5">
            Gồm hàng khách đã đặt mà kho không đủ, và hàng đang dưới mức tồn tối thiểu.
          </div>
        </div>
        <Button icon={Printer} onClick={() => setPrinting(true)}>In danh sách đi mua</Button>
      </div>

      {data.groups.map((g) => (
        <div key={g.supplier_id || 'unknown'} className="card">
          <div className="p-3 border-b border-line flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-bold text-sm">{g.supplier_name}</div>
              {g.supplier_phone && (
                <a href={`tel:${g.supplier_phone}`} className="text-[13px] link inline-flex items-center gap-1">
                  <Phone size={12} aria-hidden="true" />{g.supplier_phone}
                </a>
              )}
            </div>
            <div className="text-[13px] tabular">
              <span className="text-muted-ink">Ước vốn </span>
              <b>{money(g.est_cost)}</b>
            </div>
          </div>
          <div className="table-wrap !border-0 !rounded-none">
            <table className="data">
              <thead>
                <tr>
                  <th>Mã hàng</th><th>Tên hàng</th>
                  <th className="text-right">Đang có</th>
                  <th className="text-right">Khách đã đặt</th>
                  <th className="text-right">Tồn tối thiểu</th>
                  <th className="text-right">Cần mua</th>
                  <th>Vì sao</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((x) => (
                  <tr key={x.product_id}>
                    <td className="tabular text-muted-ink">{x.sku}</td>
                    <td>{x.name}</td>
                    <td className="text-right tabular">{fq(x.stock_qty)} {x.base_unit}</td>
                    <td className="text-right tabular">{x.ordered_qty > 0 ? fq(x.ordered_qty) : '—'}</td>
                    <td className="text-right tabular text-muted-ink">{fq(x.min_stock)}</td>
                    <td className="text-right tabular font-bold text-accent">{fq(x.shortage)} {x.base_unit}</td>
                    <td>
                      <Badge tone={x.reason === 'order' ? 'warn' : 'mute'}>
                        {x.reason === 'order' ? 'Khách đặt' : 'Dưới tồn tối thiểu'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {printing && <ShortagePrint data={data} onClose={() => setPrinting(false)} />}
    </div>
  );
}

function ShortagePrint({ data, onClose }) {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 250);
    const after = () => onClose();
    window.addEventListener('afterprint', after);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', after); };
  }, [onClose]);

  return (
    <div className="print-area size-a4">
      <div className="mx-auto p-8" style={{ width: '210mm' }}>
        <h1 className="text-center font-bold text-base uppercase mb-1">Danh sách hàng cần mua</h1>
        <div className="text-center text-[11px] mb-4">Lập ngày {date(new Date())}</div>
        {data.groups.map((g) => (
          <div key={g.supplier_id || 'unknown'} className="mb-4">
            <div className="font-bold text-[12px] mb-1">
              {g.supplier_name}{g.supplier_phone ? ` — ĐT ${g.supplier_phone}` : ''}
            </div>
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="border-y border-black">
                  <th className="text-left py-1">Mã</th>
                  <th className="text-left py-1">Tên hàng</th>
                  <th className="text-right py-1 w-20">Đang có</th>
                  <th className="text-right py-1 w-20">Cần mua</th>
                  <th className="text-left py-1 w-16">ĐVT</th>
                  <th className="text-left py-1 w-24">Đã lấy</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((x) => (
                  <tr key={x.product_id} className="border-b border-slate-300">
                    <td className="py-1">{x.sku}</td>
                    <td className="py-1">{x.name}</td>
                    <td className="text-right py-1">{fq(x.stock_qty)}</td>
                    <td className="text-right py-1 font-bold">{fq(x.shortage)}</td>
                    <td className="py-1">{x.base_unit}</td>
                    <td className="py-1" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <div className="no-print fixed bottom-4 right-4 flex gap-2">
        <Button onClick={onClose}>Đóng</Button>
        <Button variant="primary" icon={Printer} onClick={() => window.print()}>In lại</Button>
      </div>
    </div>
  );
}
