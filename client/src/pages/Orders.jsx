/* ====================================================================
   ĐẶT HÀNG CỦA KHÁCH

   Khách hỏi món tiệm chưa có, hoặc lấy số lượng lớn cần gom hàng. Ghi
   đơn, nhận cọc, hẹn ngày giao. Hàng về thì giao — giao được nhiều đợt,
   mỗi đợt ra một hoá đơn và tự trừ dần tiền cọc.
   ==================================================================== */
import { useState, useMemo, useEffect } from 'react';
import {
  ClipboardList, Plus, Eye, Search, Clock, AlertTriangle, Printer, XCircle,
  PackageCheck, HandCoins, Truck, ShoppingBag, Phone, CheckCircle2, Trash2,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, usePaged, useDebounced } from '../lib/store';
import { money, n, qty as fq, date, datetime, isoDate, match } from '../lib/format';
import {
  Button, IconButton, SearchInput, Select, Modal, Spinner, Empty, ErrorBox, Badge,
  Confirm, Field, MoneyInput, Textarea, Stat, Combo, QtyInput, Input, Tabs, Pager,
  TotalRow,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';

const STATUS = {
  open: { label: 'Đang chờ hàng', tone: 'info', icon: Clock },
  partial: { label: 'Giao một phần', tone: 'warn', icon: PackageCheck },
  done: { label: 'Đã giao xong', tone: 'ok', icon: CheckCircle2 },
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
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-auto">
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
                          </td>
                          <td><StatusBadge s={o.status} /></td>
                          <td className="text-center">
                            <IconButton icon={Eye} label="Xem đơn" onClick={(e) => { e.stopPropagation(); setOpenId(o.id); }} />
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

      {creating && <OrderForm onClose={() => setCreating(false)} onSaved={refresh} />}
      {openId && <OrderDetail id={openId} onClose={() => setOpenId(null)} onChanged={refresh} />}
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

  const addProduct = (p) => {
    const unit = p.units?.find((u) => u.is_base) || p.units?.[0];
    if (!unit) return;
    setLines((ls) => {
      const i = ls.findIndex((l) => l.product_id === p.id && l.unit_name === unit.unit_name);
      if (i >= 0) {
        const copy = [...ls];
        copy[i] = { ...copy[i], qty: copy[i].qty + 1 };
        return copy;
      }
      return [...ls, {
        product_id: p.id, name_snapshot: p.name, unit_name: unit.unit_name,
        factor: unit.factor, qty: 1,
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
      } else {
        const res = await api.post('/orders', { ...body, deposit: Number(deposit) || 0 });
        toast(`Đã lập đơn ${res.code}`, 'ok');
      }
      onSaved?.();
      onClose();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

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
            <Button variant="primary" onClick={save} loading={busy}>
              {editing ? 'Lưu thay đổi' : 'Lập đơn'}
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
            <h3 className="font-bold text-sm">Hàng khách đặt</h3>
            <Button icon={Plus} onClick={() => setPicking(true)}>Thêm hàng</Button>
          </div>

          {lines.length === 0 ? (
            <div className="card-pad text-center text-[13px] text-muted-ink">
              Chưa chọn mặt hàng nào. Bấm <b>Thêm hàng</b> để chọn.
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
                          />
                        </td>
                        <td>
                          <Select
                            size="sm"
                            value={l.unit_name}
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
                          <QtyInput value={l.qty} onChange={(v) => setLine(i, { qty: v })} min={l.delivered_qty || 0} />
                        </td>
                        <td><MoneyInput size="sm" value={l.price} onChange={(v) => setLine(i, { price: v })} /></td>
                        <td>
                          <div className="flex gap-1">
                            <Select
                              size="sm"
                              className="!w-16"
                              value={l.discount_type}
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
                          <IconButton icon={Trash2} label="Bỏ dòng này" onClick={() => delLine(i)}
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
                  <Select size="sm" className="!w-16" value={discType}
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
                <div className="pt-2 border-t border-line mt-2">
                  <Field label="Khách đặt cọc" hint="Tiền vào quỹ ngay, giao hàng sẽ tự trừ vào hoá đơn">
                    <MoneyInput value={deposit} onChange={setDeposit} />
                  </Field>
                  {deposit > 0 && (
                    <div className="text-[13px] text-muted-ink mt-1.5 tabular">
                      Còn lại khi nhận hàng: <b className="text-ink">{money(Math.max(0, total - deposit))}</b>
                    </div>
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
        onPick={addProduct}
      />
    </>
  );
}

/* Bảng chọn hàng riêng cho đặt hàng: hiện GIÁ BÁN và tồn kho, không hiện
   giá vốn — thu ngân cũng lập được đơn mà không thấy giá vốn. */
function OrderProductPicker({ open, onClose, products, priceListId, onPick }) {
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
      title="Chọn hàng khách đặt"
      subtitle="Bấm vào dòng để thêm. Hàng hết tồn vẫn đặt được — đó là chuyện thường của đơn đặt hàng."
      size="lg"
      footer={<Button variant="primary" onClick={onClose}>Xong</Button>}
    >
      <div className="space-y-2">
        <div className="flex gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Gõ tên hàng, tên phụ hoặc quét mã vạch..."
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
                      <td className="text-right tabular font-semibold">
                        {money(priceOfUnit(u, priceListId, defaultPriceList))}
                      </td>
                      <td className="text-center">
                        <IconButton icon={Plus} label={`Thêm ${p.name}`} />
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
  const { toast, can } = useApp();
  const { data: o, busy, error, reload } = useFetch(() => api.order(id), [id]);
  const [delivering, setDelivering] = useState(false);
  const [depositing, setDepositing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [printing, setPrinting] = useState(false);

  const changed = () => { reload(); onChanged?.(); };
  const openOrder = o && (o.status === 'open' || o.status === 'partial');

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
            {o && <Button icon={Printer} onClick={() => setPrinting(true)}>In phiếu đặt hàng</Button>}
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
        {busy ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : o && (
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
              <InfoBox label="Hẹn giao" value={o.promised_at ? date(o.promised_at) : 'Không hẹn'} />
              <InfoBox label="Tổng tiền đơn" value={money(o.total)} />
              <InfoBox
                label="Cọc còn giữ"
                value={money(o.deposit_left)}
                sub={o.deposit > 0 ? `đã nhận ${money(o.deposit)}, dùng ${money(o.deposit_used)}` : null}
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
                      <th className="text-right">Còn lại</th>
                      <th className="text-right">Tồn kho</th>
                      <th className="text-right">Đơn giá</th>
                      <th className="text-right">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.items.map((i) => {
                      const short = i.remaining_qty * i.factor > i.stock_qty;
                      return (
                        <tr key={i.id}>
                          <td>
                            <div>{i.name_snapshot}</div>
                            {i.note && <div className="text-2xs text-muted-ink">{i.note}</div>}
                          </td>
                          <td>{i.unit_name}</td>
                          <td className="text-right tabular">{fq(i.qty)}</td>
                          <td className="text-right tabular text-emerald-700">{fq(i.delivered_qty)}</td>
                          <td className="text-right tabular font-semibold">{fq(i.remaining_qty)}</td>
                          <td className={`text-right tabular ${short && i.remaining_qty > 0 ? 'text-danger font-semibold' : 'text-muted-ink'}`}>
                            {fq(i.stock_qty)}
                            {short && i.remaining_qty > 0 && <span className="ml-1 text-2xs">thiếu</span>}
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

            {o.deliveries.length > 0 && (
              <div>
                <h3 className="font-bold text-sm mb-1.5">Các đợt đã giao</h3>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Ngày giao</th><th>Hoá đơn</th>
                        <th className="text-right">Tiền hoá đơn</th>
                        <th className="text-right">Trừ từ cọc</th>
                        <th className="text-right">Khách còn nợ</th>
                        <th>Người giao</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.deliveries.map((d) => (
                        <tr key={d.id}>
                          <td className="whitespace-nowrap">{datetime(d.ts)}</td>
                          <td className="tabular font-semibold">{d.sale_code || '—'}</td>
                          <td className="text-right tabular">{money(d.sale_total)}</td>
                          <td className="text-right tabular">{d.deposit_applied > 0 ? money(d.deposit_applied) : '—'}</td>
                          <td className="text-right tabular">
                            {d.sale_total - d.sale_paid > 0
                              ? <span className="text-danger font-semibold">{money(d.sale_total - d.sale_paid)}</span>
                              : <span className="text-muted-ink">đã trả đủ</span>}
                          </td>
                          <td className="text-muted-ink">{d.user_name || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {o.deposits.length > 0 && (
              <div>
                <h3 className="font-bold text-sm mb-1.5">Tiền cọc</h3>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr><th>Ngày</th><th className="text-right">Số tiền</th><th>Quỹ</th><th>Ghi chú</th></tr>
                    </thead>
                    <tbody>
                      {o.deposits.map((d) => (
                        <tr key={d.id}>
                          <td className="whitespace-nowrap">{datetime(d.ts)}</td>
                          <td className={`text-right tabular font-semibold ${d.amount < 0 ? 'text-danger' : 'text-emerald-700'}`}>
                            {d.amount < 0 ? '− ' : '+ '}{money(Math.abs(d.amount))}
                          </td>
                          <td className="text-muted-ink">{d.account_name || '—'}</td>
                          <td className="text-muted-ink">{d.note || (d.amount < 0 ? 'Hoàn cọc' : 'Khách đặt cọc')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
        <DeliverModal order={o} onClose={() => setDelivering(false)} onDone={changed} />
      )}
      {depositing && o && (
        <DepositModal order={o} onClose={() => setDepositing(false)} onDone={changed} />
      )}
      {cancelling && o && (
        <CancelModal order={o} onClose={() => setCancelling(false)} onDone={() => { changed(); onClose(); }} />
      )}
      {editing && o && (
        <OrderForm order={o} onClose={() => setEditing(false)} onSaved={changed} />
      )}
      {printing && o && <OrderPrint order={o} onClose={() => setPrinting(false)} />}
    </>
  );
}

function InfoBox({ label, value, sub }) {
  return (
    <div className="card p-2.5">
      <div className="text-2xs text-muted-ink uppercase tracking-wide">{label}</div>
      <div className="font-semibold tabular truncate">{value}</div>
      {sub && <div className="text-2xs text-muted-ink truncate">{sub}</div>}
    </div>
  );
}

/* =========================== GIAO HÀNG ============================= */

function DeliverModal({ order, onClose, onDone }) {
  const { user, meta, toast } = useApp();
  const pending = order.items.filter((i) => i.remaining_qty > 0.0001);
  const [qtys, setQtys] = useState(() => {
    // Mặc định giao hết phần còn lại, nhưng không quá số đang có trong kho
    const m = {};
    for (const i of pending) {
      m[i.id] = Math.max(0, Math.min(i.remaining_qty, Math.floor((i.stock_qty / i.factor) * 1000) / 1000));
    }
    return m;
  });
  const [paid, setPaid] = useState(0);
  const [method, setMethod] = useState('cash');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const chosen = pending.filter((i) => (qtys[i.id] || 0) > 0);
  const gross = chosen.reduce((a, i) => {
    const q = qtys[i.id] || 0;
    const g = Math.round(q * i.price);
    const d = i.discount_type === 'percent'
      ? Math.round(g * (i.discount_percent || 0) / 100)
      : Math.round((i.discount || 0) * (q / i.qty));
    return a + g - Math.min(d, g);
  }, 0);
  const orderDisc = order.subtotal > 0 ? Math.round(order.discount * (gross / order.subtotal)) : 0;
  const saleTotal = gross - Math.min(orderDisc, gross);
  const useDeposit = Math.min(order.deposit_left, saleTotal);
  const stillOwed = Math.max(0, saleTotal - useDeposit - (Number(paid) || 0));

  const submit = async () => {
    if (!chosen.length) return toast('Chưa chọn món nào để giao', 'bad');
    setBusy(true);
    try {
      const res = await api.post(`/orders/${order.id}/deliver`, {
        items: chosen.map((i) => ({ item_id: i.id, qty: qtys[i.id] })),
        paid: Number(paid) || 0,
        received: Number(paid) || 0,
        payment_method: method,
        account_id: accountId || null,
        user_id: user?.id || null,
        note: note || null,
      });
      toast(`Đã xuất hoá đơn ${res.sale_code}${res.status === 'done' ? ' — đơn đã giao xong' : ''}`, 'ok', 6000);
      onDone?.();
      onClose();
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
      title={`Giao hàng cho đơn ${order.code}`}
      subtitle="Đợt giao này sẽ xuất một hoá đơn bán hàng riêng và trừ kho."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" icon={Truck} onClick={submit} loading={busy} disabled={!chosen.length}>
            Xuất hoá đơn giao hàng
          </Button>
        </>
      }
    >
      <div className="space-y-3">
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
            <Field label="Khách trả thêm bây giờ" hint="Ngoài phần đã cọc">
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
            <Field label="Ghi chú đợt giao" htmlFor="dl-note">
              <Input id="dl-note" value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="VD: giao đợt 1, còn thiếu dây" />
            </Field>
          </div>

          <div className="card p-3 space-y-1 h-fit">
            <TotalRow label="Tiền hàng đợt này" value={money(gross)} />
            {orderDisc > 0 && <TotalRow label="Giảm giá chia theo đợt" value={'− ' + money(orderDisc)} />}
            <TotalRow label="Tiền hoá đơn" value={money(saleTotal)} big />
            <TotalRow
              label="Trừ từ tiền cọc"
              value={useDeposit > 0 ? '− ' + money(useDeposit) : '—'}
              tone={useDeposit > 0 ? 'good' : undefined}
              hint={order.deposit_left > 0 ? `cọc còn ${money(order.deposit_left)}` : 'đơn không có cọc'}
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
    </Modal>
  );
}

/* ============================ NHẬN CỌC ============================= */

function DepositModal({ order, onClose, onDone }) {
  const { user, meta, toast } = useApp();
  const left = order.total - order.deposit;
  const [amount, setAmount] = useState(0);
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/orders/${order.id}/deposit`, {
        amount: Number(amount) || 0, account_id: accountId || null, user_id: user?.id || null,
      });
      toast('Đã ghi nhận tiền cọc', 'ok');
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
      title="Khách đưa thêm cọc"
      subtitle={`Đơn ${order.code} — đã cọc ${money(order.deposit)}, còn ${money(left)} chưa cọc`}
      footer={
        <>
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!(Number(amount) > 0)}>
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
        <Field label="Vào quỹ">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Quỹ mặc định</option>
            {meta.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
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

/* ====================== IN PHIẾU ĐẶT HÀNG (A5) ===================== */

function OrderPrint({ order: o, onClose }) {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 250);
    const after = () => onClose();
    window.addEventListener('afterprint', after);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', after); };
  }, [onClose]);

  const st = o.store || {};
  return (
    <div className="print-area size-a5">
      <div className="mx-auto p-6" style={{ width: '148mm' }}>
        <div className="text-center mb-3">
          <div className="font-bold text-base uppercase">{st.name || 'CỬA HÀNG'}</div>
          <div className="text-[11px]">{st.address}</div>
          <div className="text-[11px]">ĐT: {st.phone}</div>
        </div>
        <h1 className="text-center font-bold text-sm uppercase mb-0.5">Phiếu đặt hàng</h1>
        <div className="text-center text-[11px] mb-3">
          Số {o.code} — ngày {datetime(o.ts)}
        </div>

        <table className="w-full text-[11px] mb-2">
          <tbody>
            <tr><td className="py-0.5 w-24">Khách hàng</td><td className="font-semibold">{o.customer_display}</td></tr>
            {o.phone_display && <tr><td className="py-0.5">Điện thoại</td><td>{o.phone_display}</td></tr>}
            {o.promised_at && <tr><td className="py-0.5">Hẹn giao</td><td className="font-semibold">{date(o.promised_at)}</td></tr>}
            {o.delivery_address && <tr><td className="py-0.5">Giao tới</td><td>{o.delivery_address}</td></tr>}
          </tbody>
        </table>

        <table className="w-full text-[11px] border-collapse mb-2">
          <thead>
            <tr className="border-y border-black">
              <th className="text-left py-1">Tên hàng</th>
              <th className="text-right py-1 w-14">SL</th>
              <th className="text-left py-1 w-14">ĐVT</th>
              <th className="text-right py-1 w-20">Đơn giá</th>
              <th className="text-right py-1 w-24">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {o.items.map((i) => (
              <tr key={i.id} className="border-b border-slate-300">
                <td className="py-0.5">{i.name_snapshot}</td>
                <td className="text-right py-0.5">{fq(i.qty)}</td>
                <td className="py-0.5">{i.unit_name}</td>
                <td className="text-right py-0.5">{n(i.price)}</td>
                <td className="text-right py-0.5">{n(i.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="w-full text-[11px] ml-auto" style={{ maxWidth: '62mm' }}>
          <tbody>
            <tr><td className="py-0.5">Tiền hàng</td><td className="text-right">{n(o.subtotal)}</td></tr>
            {o.discount > 0 && (
              <tr><td className="py-0.5">Giảm giá</td><td className="text-right">− {n(o.discount)}</td></tr>
            )}
            <tr className="border-t border-black font-bold">
              <td className="py-1">Tổng cộng</td><td className="text-right py-1">{n(o.total)} đ</td>
            </tr>
            <tr><td className="py-0.5">Đã đặt cọc</td><td className="text-right">{n(o.deposit)}</td></tr>
            <tr className="font-bold">
              <td className="py-0.5">Còn phải trả</td>
              <td className="text-right">{n(Math.max(0, o.total - o.deposit))} đ</td>
            </tr>
          </tbody>
        </table>

        {o.note && <div className="text-[11px] mt-2">Ghi chú: {o.note}</div>}

        <div className="text-[10px] mt-4 leading-relaxed">
          <div className="font-semibold mb-0.5">Lưu ý</div>
          <div>1. Giữ phiếu này để đối chiếu khi nhận hàng.</div>
          <div>2. Tiền cọc được trừ vào tiền hàng khi giao.</div>
          <div>3. Hàng đặt riêng theo yêu cầu, cửa hàng không nhận đổi trả.</div>
        </div>

        <div className="flex justify-between text-[11px] mt-6 text-center">
          <div className="flex-1">
            <div className="font-semibold">Khách hàng</div>
            <div className="text-[10px]">(ký, ghi rõ họ tên)</div>
          </div>
          <div className="flex-1">
            <div className="font-semibold">Người nhận đơn</div>
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
