/* ====================================================================
   HỘP "THÔNG TIN GIAO HÀNG" TRÊN MÀN HÌNH BÁN HÀNG (tài liệu 04)

   Ai nhận, ai chở, phí ship bao nhiêu, người giao phải thu của khách bao
   nhiêu. Tiền thu hộ (COD) KHÔNG phải nợ của khách: khách lẻ vẫn giao COD
   được. Khoản đó treo ở "Phải thu từ đối tác vận chuyển" tới khi người giao
   nộp tiền về và quầy bấm Xác nhận đối soát.

   Ba nút:
     - Lưu thông tin giao: ghi vào đơn đang bán, đóng hộp. Nút Thanh toán
       ngoài màn hình dùng luôn lựa chọn in đã chọn ở đây.
     - Thanh toán & In: lưu rồi mở ngay bước thanh toán, kèm lựa chọn in
       hoá đơn đầy đủ / phiếu giao cho shipper / cả hai.
     - Hủy thông tin giao: xoá sạch, đơn trở lại thành bán tại quầy.
   ==================================================================== */
import { useState, useEffect, useMemo } from 'react';
import { Truck, Printer, X, RotateCcw, Wallet, CreditCard } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch } from '../lib/store';
import { money, ROLE_LABEL } from '../lib/format';
import { Button, Input, Select, Modal, Field, MoneyInput, Textarea } from './ui';

export const EMPTY_DELIVERY = {
  name: '', phone: '', address: '',
  /* Hai lối vận chuyển (tài liệu 14, mục 5): gửi qua hãng, hay tự chở / book
     tài xế ngoài. Đơn cũ lưu trên máy chưa có ô này thì tự suy ra ở
     normalizeDelivery bên dưới. */
  shipMode: 'self',                  // partner | self
  carrierId: null, carrierName: '', trackingCode: '',
  weight: '', size: '',              // khối lượng (kg) và số đo đóng gói
  shipperMode: 'none',               // none | staff | free
  shipperUserId: null, shipperUserName: '',
  shipperName: '', shipperPhone: '',
  shipFee: 0, shopPaysShip: false,
  shipperFee: 0,                     // tiền tiệm trả cho tài xế (chi phí của tiệm)
  prepaid: 0, prepaidMethod: 'cash',
  codMode: true,                     // false = phần còn lại ghi nợ khách, không thu hộ
  note: '',
  print: { invoice: true, note: true },
};

/** Đọc thông tin giao lưu trên máy — kể cả dạng cũ trước đợt 13 (shipPayer, codAmount). */
export function normalizeDelivery(v) {
  if (!v) return null;
  return {
    ...EMPTY_DELIVERY,
    ...v,
    shopPaysShip: v.shopPaysShip ?? v.shipPayer === 'shop',
    shipperMode: v.shipperMode || (v.shipperName ? 'free' : 'none'),
    /* Đơn lưu từ bản cũ: có chọn hãng vận chuyển thì coi như đi đường đối tác */
    shipMode: v.shipMode || (v.carrierId ? 'partner' : 'self'),
    print: { ...EMPTY_DELIVERY.print, ...(v.print || {}) },
  };
}

/** Phí ship cộng vào tiền khách phải trả (cửa hàng chịu thì 0). */
export function deliveryShipCharged(v) {
  const d = normalizeDelivery(v);
  return d && !d.shopPaysShip ? Math.max(0, Math.round(Number(d.shipFee) || 0)) : 0;
}

/** Các trường giao hàng gửi kèm hoá đơn lên máy chủ. */
export function deliveryBody(v) {
  const d = normalizeDelivery(v);
  if (!d) return {};
  const partner = d.shipMode === 'partner';
  const staff = !partner && d.shipperMode === 'staff';
  const free = !partner && d.shipperMode === 'free';
  return {
    delivery_name: d.name || null,
    delivery_phone: d.phone || null,
    delivery_address: d.address || null,
    /* Đi hãng thì lưu hãng và mã vận đơn; tự chở thì lưu người giao */
    carrier_id: partner ? d.carrierId || null : null,
    tracking_code: partner ? d.trackingCode || null : null,
    ship_weight: partner ? Math.max(0, Number(d.weight) || 0) : 0,
    ship_size: partner ? (String(d.size || '').trim() || null) : null,
    shipper_user_id: staff ? d.shipperUserId || null : null,
    shipper_name: staff ? d.shipperUserName || null : free ? d.shipperName || null : null,
    shipper_phone: free ? d.shipperPhone || null : null,
    ship_fee: Math.max(0, Math.round(Number(d.shipFee) || 0)),
    ship_payer: d.shopPaysShip ? 'shop' : 'customer',
    /* Tiền trả cho tài xế là CHI PHÍ của tiệm, khác phí ship thu của khách.
       Ghi lại trên đơn để cuối ngày đối chiếu, không tự ghi phiếu chi —
       tiệm thường trả gộp cuối ca, ghi ở đây nữa là đếm tiền hai lần. */
    shipper_fee: Math.max(0, Math.round(Number(d.shipperFee) || 0)),
    cod_mode: d.codMode !== false,
    delivery_note: d.note || null,
  };
}

/**
 * Chọn in gì sau khi thanh toán. Ba ô như tài liệu: hoá đơn đầy đủ, phiếu
 * giao hàng, cả hai. Tích "cả hai" là tích luôn hai ô trên.
 */
export function PrintChoice({ value, onChange, idPrefix = 'pc' }) {
  const v = { ...EMPTY_DELIVERY.print, ...(value || {}) };
  const rows = [
    { key: 'invoice', label: 'In hoá đơn đầy đủ', hint: 'Hàng hoá, đơn giá, tiền khách trả',
      checked: v.invoice, set: (c) => onChange({ ...v, invoice: c }) },
    { key: 'note', label: 'In phiếu giao hàng', hint: 'Chỉ tên hàng, số lượng, tiền thu hộ — đưa cho shipper',
      checked: v.note, set: (c) => onChange({ ...v, note: c }) },
    { key: 'both', label: 'In cả hai', hint: 'In lần lượt hoá đơn rồi phiếu giao',
      checked: v.invoice && v.note, set: (c) => onChange({ invoice: c, note: c }) },
  ];
  return (
    <fieldset className="rounded-lg border border-line p-2.5">
      <legend className="px-1 text-[13px] font-semibold">Khi thanh toán sẽ in</legend>
      <div className="space-y-1">
        {rows.map((r) => (
          <label key={r.key} htmlFor={`${idPrefix}-${r.key}`} className="flex items-start gap-2 cursor-pointer py-0.5">
            <input
              id={`${idPrefix}-${r.key}`}
              type="checkbox"
              className="w-4 h-4 mt-0.5 accent-emerald-700 cursor-pointer"
              checked={r.checked}
              onChange={(e) => r.set(e.target.checked)}
            />
            <span className="text-[13px] leading-tight">
              {r.label}
              <span className="block text-2xs text-muted-ink">{r.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const fromCustomer = (c) => ({
  ...EMPTY_DELIVERY,
  name: c?.name || '',
  phone: c?.phone || '',
  address: c?.address || '',
});

export default function DeliveryInfoModal({
  open, onClose, value, customer, carriers, goodsTotal, canPay, onSave, onPayPrint, onClear,
}) {
  const [d, setD] = useState(EMPTY_DELIVERY);
  const [err, setErr] = useState('');
  const { data: users } = useFetch(() => api.users(), [], { skip: !open });
  const staff = useMemo(() => (Array.isArray(users) ? users : []).filter((u) => u.active), [users]);

  /* Chỉ nạp lúc mở hộp. Nạp lại theo từng lần đổi của đơn thì đang gõ dở
     địa chỉ mà thu ngân ở tab khác thêm hàng là mất chữ. */
  useEffect(() => {
    if (!open) return;
    setErr('');
    setD(value ? normalizeDelivery(value) : fromCustomer(customer));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (k, v) => { setErr(''); setD((p) => ({ ...p, [k]: v })); };

  const fee = Math.max(0, Math.round(Number(d.shipFee) || 0));
  const total = Math.max(0, goodsTotal) + (d.shopPaysShip ? 0 : fee);
  const prepaid = Math.min(Math.max(0, Math.round(Number(d.prepaid) || 0)), total);
  const codOn = d.codMode !== false || !customer;
  const rest = total - prepaid;

  const check = () => {
    if (d.shipMode === 'partner') {
      if (!d.carrierId) return 'Chọn hãng vận chuyển, hoặc đổi sang thẻ Tự vận chuyển nội bộ.';
      if (!d.address.trim()) return 'Nhập địa chỉ giao để hãng vận chuyển lấy hàng.';
      return '';
    }
    if (!d.address.trim() && d.shipperMode === 'none') {
      return 'Nhập địa chỉ giao, hoặc chọn người giao hàng.';
    }
    if (d.shipperMode === 'staff' && !d.shipperUserId) return 'Chọn nhân viên đi giao.';
    if (d.shipperMode === 'free' && !d.shipperName.trim() && !d.shipperPhone.trim()) {
      return 'Nhập tên hoặc số điện thoại của tài xế.';
    }
    return '';
  };

  const result = () => ({ ...d, shipFee: fee, prepaid, codMode: codOn });

  const save = () => {
    const m = check();
    if (m) { setErr(m); return; }
    onSave(result());
  };

  const payPrint = () => {
    const m = check();
    if (m) { setErr(m); return; }
    onPayPrint(result());
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Thông tin giao hàng"
      subtitle={customer
        ? `Lấy sẵn từ hồ sơ ${customer.name} — sửa được`
        : 'Khách lẻ — nhập tay người nhận và địa chỉ'}
      size="lg"
      footer={<>
        <Button variant="danger" icon={X} onClick={onClear} className="mr-auto">Hủy thông tin giao</Button>
        <Button icon={Truck} onClick={save}>Lưu thông tin giao</Button>
        <Button variant="primary" icon={Printer} onClick={payPrint} disabled={!canPay}
          title={canPay ? undefined : 'Giỏ hàng đang trống'}>
          Thanh toán &amp; In
        </Button>
      </>}
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          {/* ---------------- Người nhận ---------------- */}
          <section className="space-y-2.5" aria-labelledby="dv-h-recv">
            <div className="flex items-center justify-between">
              <h3 id="dv-h-recv" className="text-[13px] font-bold">Người nhận</h3>
              {customer && (
                <button
                  type="button"
                  onClick={() => setD((p) => ({ ...p, name: customer.name || '', phone: customer.phone || '', address: customer.address || '' }))}
                  className="text-2xs font-semibold text-accent hover:underline inline-flex items-center gap-1 cursor-pointer min-h-[24px]"
                >
                  <RotateCcw size={11} aria-hidden="true" /> Lấy lại từ hồ sơ khách
                </button>
              )}
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field label="Tên người nhận" htmlFor="dv-name">
                <Input id="dv-name" value={d.name} onChange={(e) => set('name', e.target.value)}
                  placeholder="Tên người nhận hàng" />
              </Field>
              <Field label="Số điện thoại người nhận" htmlFor="dv-phone">
                <Input id="dv-phone" value={d.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" />
              </Field>
            </div>
            <Field label="Địa chỉ giao hàng" htmlFor="dv-addr">
              <Textarea id="dv-addr" rows={2} value={d.address} onChange={(e) => set('address', e.target.value)}
                placeholder="Số nhà, ấp/khu phố, xã/phường, huyện/tỉnh" />
            </Field>
          </section>

          {/* ---------------- Vận chuyển: hai phân vùng (tài liệu 14, mục 5) ---------------- */}
          <section className="space-y-2.5 border-t border-line pt-3" aria-labelledby="dv-h-ship">
            <h3 id="dv-h-ship" className="text-[13px] font-bold">Vận chuyển</h3>

            <div className="grid grid-cols-2 rounded-lg border border-line overflow-hidden" role="tablist"
              aria-label="Cách vận chuyển">
              {[
                ['self', 'Tự vận chuyển nội bộ', 'Tiệm tự chở, hoặc book tài xế ngoài'],
                ['partner', 'Đối tác vận chuyển', 'Gửi qua GHTK, GHN, Viettel Post, nhà xe...'],
              ].map(([k, label, hint]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={d.shipMode === k}
                  onClick={() => set('shipMode', k)}
                  className={`px-2.5 py-2 text-left transition-colors duration-100 cursor-pointer
                              ${d.shipMode === k ? 'bg-primary text-white' : 'bg-card hover:bg-muted'}`}
                >
                  <span className="block text-[13px] font-semibold">{label}</span>
                  <span className={`block text-2xs ${d.shipMode === k ? 'text-slate-300' : 'text-muted-ink'}`}>
                    {hint}
                  </span>
                </button>
              ))}
            </div>

            {/* ---- Phân vùng 1: gửi qua đối tác ---- */}
            {d.shipMode === 'partner' && (
              <div className="space-y-2.5">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Field label="Hãng vận chuyển" required hint="Thêm đối tác ở Thiết lập → Vận chuyển" htmlFor="dv-carrier">
                    <Select
                      id="dv-carrier"
                      value={d.carrierId || ''}
                      onChange={(e) => {
                        const id = e.target.value ? Number(e.target.value) : null;
                        setErr('');
                        setD((p) => ({ ...p, carrierId: id, carrierName: carriers.find((c) => c.id === id)?.name || '' }));
                      }}
                    >
                      <option value="">— Chọn hãng —</option>
                      {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Mã vận đơn" hint="Hãng cấp lúc nhận hàng" htmlFor="dv-track">
                    <Input id="dv-track" value={d.trackingCode} onChange={(e) => set('trackingCode', e.target.value)}
                      placeholder="Số vận đơn đối tác cấp" />
                  </Field>
                  <Field label="Khối lượng đóng gói (kg)" htmlFor="dv-weight">
                    <Input id="dv-weight" type="number" step="0.1" min="0" inputMode="decimal"
                      value={d.weight} onChange={(e) => set('weight', e.target.value)}
                      placeholder="VD: 4.5" />
                  </Field>
                  <Field label="Kích thước gói (cm)" hint="Dài × Rộng × Cao" htmlFor="dv-size">
                    <Input id="dv-size" value={d.size} onChange={(e) => set('size', e.target.value)}
                      placeholder="VD: 40x30x20" />
                  </Field>
                </div>
                <p className="text-2xs text-muted-ink leading-relaxed bg-muted/60 border border-line rounded p-2">
                  Máy chủ của tiệm chỉ chạy trong mạng nội bộ nên <b>chưa nối API của hãng</b>: phí ship
                  và mã vận đơn nhập tay theo phiếu hãng đưa. Khối lượng và kích thước ghi ở đây để đối
                  chiếu với phiếu cân của hãng khi có sai lệch.
                </p>
              </div>
            )}

            {/* ---- Phân vùng 2: tự chở hoặc book tài xế ngoài ---- */}
            {d.shipMode === 'self' && (
              <div className="space-y-2.5">
                <div>
                  <span className="label">Người giao hàng</span>
                  <div className="grid grid-cols-3 rounded border border-line overflow-hidden" role="radiogroup"
                    aria-label="Người giao hàng">
                    {[['none', 'Chưa phân công'], ['staff', 'Nhân viên tiệm'], ['free', 'Tài xế ngoài']].map(([k, lb]) => (
                      <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={d.shipperMode === k}
                        onClick={() => set('shipperMode', k)}
                        className={`h-9 px-2 text-[13px] font-semibold transition-colors duration-100 cursor-pointer
                                    ${d.shipperMode === k ? 'bg-primary text-white' : 'bg-card hover:bg-muted'}`}
                      >
                        {lb}
                      </button>
                    ))}
                  </div>
                </div>

                {d.shipperMode === 'staff' && (
                  <Field label="Nhân viên đi giao" htmlFor="dv-staff">
                    <Select
                      id="dv-staff"
                      value={d.shipperUserId || ''}
                      onChange={(e) => {
                        const id = e.target.value ? Number(e.target.value) : null;
                        setErr('');
                        setD((p) => ({ ...p, shipperUserId: id, shipperUserName: staff.find((u) => u.id === id)?.full_name || '' }));
                      }}
                    >
                      <option value="">— Chọn nhân viên —</option>
                      {staff.map((u) => (
                        <option key={u.id} value={u.id}>{u.full_name}{ROLE_LABEL[u.role] ? ` · ${ROLE_LABEL[u.role]}` : ''}</option>
                      ))}
                    </Select>
                  </Field>
                )}
                {d.shipperMode === 'free' && (
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <Field label="Tên tài xế" hint="Grab, Ahamove, Be, hoặc xe ôm quen" htmlFor="dv-sname">
                      <Input id="dv-sname" value={d.shipperName} onChange={(e) => set('shipperName', e.target.value)}
                        placeholder="VD: anh Hùng xe ôm" />
                    </Field>
                    <Field label="Số điện thoại tài xế" htmlFor="dv-sphone">
                      <Input id="dv-sphone" value={d.shipperPhone} onChange={(e) => set('shipperPhone', e.target.value)}
                        inputMode="tel" />
                    </Field>
                  </div>
                )}

                <Field
                  label="Tiền trả cho tài xế"
                  hint="Chi phí của tiệm, không phải phí thu của khách. Ghi để cuối ngày đối chiếu."
                  htmlFor="dv-shipperfee"
                >
                  <MoneyInput id="dv-shipperfee" value={d.shipperFee}
                    onChange={(v) => set('shipperFee', Math.max(0, v))} />
                </Field>
              </div>
            )}
          </section>

          <Field label="Ghi chú giao hàng" htmlFor="dv-note">
            <Textarea id="dv-note" rows={2} value={d.note} onChange={(e) => set('note', e.target.value)}
              placeholder="VD: gọi trước khi giao, giao giờ hành chính" />
          </Field>
        </div>

        {/* ---------------- Tiền ---------------- */}
        <div className="space-y-3">
          <section className="rounded-lg border border-line bg-muted/40 p-3 space-y-2.5" aria-labelledby="dv-h-money">
            <h3 id="dv-h-money" className="text-[13px] font-bold">Tiền của đơn</h3>
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="text-muted-ink">Tiền hàng</span>
              <span className="tabular font-semibold">{money(goodsTotal)}</span>
            </div>

            <Field label="Phí vận chuyển" htmlFor="dv-fee">
              <MoneyInput id="dv-fee" value={d.shipFee} onChange={(v) => set('shipFee', Math.max(0, v))} />
              <label className="flex items-center gap-1.5 mt-1.5 text-2xs cursor-pointer">
                <input type="checkbox" className="w-3.5 h-3.5 accent-emerald-700 cursor-pointer"
                  checked={d.shopPaysShip} onChange={(e) => set('shopPaysShip', e.target.checked)} />
                Cửa hàng chịu phí (không cộng vào đơn)
              </label>
            </Field>

            <div className="flex items-baseline justify-between border-t border-line pt-2">
              <span className="text-[13px] font-semibold">Tổng tiền đơn hàng</span>
              <span className="tabular font-bold text-lg">{money(total)}</span>
            </div>

            <Field label="Khách trả trước (đặt cọc)" htmlFor="dv-prepaid">
              <MoneyInput id="dv-prepaid" value={d.prepaid} onChange={(v) => set('prepaid', Math.max(0, v))} />
              <div className="grid grid-cols-2 gap-1 mt-1.5" role="radiogroup" aria-label="Khách trả trước bằng">
                {[['cash', 'Tiền mặt', Wallet], ['transfer', 'Chuyển khoản', CreditCard]].map(([k, lb, Icon]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={d.prepaidMethod === k}
                    onClick={() => set('prepaidMethod', k)}
                    className={`btn btn-sm ${d.prepaidMethod === k ? 'btn-secondary' : 'btn-outline'}`}
                  >
                    <Icon size={13} aria-hidden="true" />{lb}
                  </button>
                ))}
              </div>
            </Field>

            <div className={`rounded-lg border p-2.5 ${codOn ? 'border-amber-300 bg-amber-50' : 'border-danger/30 bg-red-50'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className={`text-[13px] font-semibold ${codOn ? 'text-amber-900' : 'text-red-900'}`}>
                  {codOn ? 'Thu hộ (COD)' : 'Ghi nợ khách'}
                </span>
                <span className={`text-xl font-display font-bold tabular ${codOn ? 'text-amber-900' : 'text-red-900'}`}>
                  {money(rest)}
                </span>
              </div>
              <p className={`text-2xs mt-0.5 leading-relaxed ${codOn ? 'text-amber-900/80' : 'text-red-900/80'}`}>
                {codOn
                  ? 'Người giao thu của khách. Không tính vào công nợ — chờ đối soát với người giao.'
                  : `Phần còn lại vào công nợ của ${customer?.name}.`}
              </p>
            </div>

            {customer && (
              <label className="flex items-start gap-1.5 text-2xs cursor-pointer">
                <input type="checkbox" className="w-3.5 h-3.5 mt-0.5 accent-emerald-700 cursor-pointer"
                  checked={d.codMode === false} onChange={(e) => set('codMode', !e.target.checked)} />
                <span>Không thu hộ — phần còn lại ghi nợ cho {customer.name} (khách quen, trả sau)</span>
              </label>
            )}
          </section>

          <PrintChoice value={d.print} onChange={(p) => set('print', p)} idPrefix="dv-print" />

          {err && (
            <p role="alert" className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">
              {err}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
