/* ====================================================================
   NHẬN HÀNG MÙ GIÁ (24/10/2026)

   Thủ kho đếm hàng mối giao, cộng kho ngay — không thấy giá nhập, tổng
   tiền, hồ sơ hay công nợ của mối. Chủ / quản lý chốt giá sau, theo hoá
   đơn của mối (PricingModal bên dưới, mở từ trang Phiếu nhập hàng).

   Máy chủ mới là chỗ chặn thật: thủ kho gọi API phiếu nhập chỉ nhận bản
   rút gọn không có khoá tiền nào (server/routes/purchases.js).
   ==================================================================== */
import { useState, useMemo, useEffect } from 'react';
import { PackageCheck, Plus, Trash2, ArrowLeft, ClipboardCheck, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, usePaged } from '../lib/store';
import { money, qty as fq, datetime, match } from '../lib/format';
import {
  Button, IconButton, Select, Modal, Spinner, Empty, ErrorBox, Badge, Field, MoneyInput,
  Textarea, Combo, QtyInput, Input, Pager,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import CartPickerModal, { CartPickerButton } from '../components/CartPickerModal';
import { purchaseMath } from '../lib/purchaseMath';

/** Nhãn trạng thái phiếu nhập — dùng chung cho trang thủ kho và trang chủ */
export function PurchaseStatusBadge({ status, className = '' }) {
  if (status === 'pending_price') return <Badge tone="warn" className={className}>Chờ chốt giá</Badge>;
  if (status === 'cancelled') return <Badge tone="bad" className={className}>Đã huỷ</Badge>;
  return null;
}

/* =================== TRANG CỦA THỦ KHO: NHẬN HÀNG =================== */

export default function ReceivingPage() {
  const { toast } = useApp();
  const {
    rows: data, total: rowCount, busy, error, reload, page, setPage, pageSize, setPageSize,
  } = usePaged((pg) => api.purchases({ ...pg }), [], { key: 'receiving' });
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const openDetail = async (id) => {
    setDetail(null);
    setDetailBusy(true);
    try { setDetail(await api.purchase(id)); }
    catch (e) { toast(e.message, 'bad', 6000); }
    finally { setDetailBusy(false); }
  };

  return (
    <>
      <PageHeader
        title="Nhận hàng"
        subtitle="Đếm hàng mối giao rồi ghi vào đây — hàng cộng kho ngay, chủ tiệm chốt giá sau"
        actions={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Nhận hàng</Button>}
      />
      <Page className="space-y-3">
        {busy && !data ? <Spinner />
          : error ? <ErrorBox error={error} onRetry={reload} />
            : !data?.length ? (
              <Empty icon={PackageCheck} title="Chưa có phiếu nhận hàng nào"
                message="Mối giao hàng tới thì bấm Nhận hàng, chọn mối, quét từng món và gõ số đếm được."
                action={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Nhận hàng</Button>} />
            ) : (
              <div className="grid gap-3 lg:grid-cols-[minmax(300px,420px)_1fr] lg:items-start">
                <div className={`card ${detail ? 'hidden lg:block' : ''}`}>
                  <div className="table-wrap table-scroll !border-0 !rounded-none">
                    <table className="data">
                      <thead><tr><th>Mã phiếu · ngày</th><th>Nhà cung cấp</th><th className="text-right">Số món</th></tr></thead>
                      <tbody>
                        {data.map((p) => (
                          <tr key={p.id} onClick={() => openDetail(p.id)} aria-current={detail?.id === p.id}
                            className={`hoverable clickable ${p.status === 'cancelled' ? 'opacity-55' : ''}
                                        ${detail?.id === p.id ? 'bg-accent-soft/60' : ''}`}>
                            <td>
                              <div className="font-mono font-semibold text-accent whitespace-nowrap">{p.code}</div>
                              <div className="text-2xs text-muted-ink">{datetime(p.ts)}</div>
                              <PurchaseStatusBadge status={p.status} className="mt-0.5" />
                            </td>
                            <td><div className="truncate max-w-[160px]">{p.supplier_name || '—'}</div></td>
                            <td className="num">{p.item_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pager page={page} pageSize={pageSize} total={rowCount} onPage={setPage} onPageSize={setPageSize} />
                </div>

                <div className="card p-3">
                  {detailBusy ? <Spinner /> : !detail ? (
                    <Empty icon={PackageCheck} title="Chọn một phiếu" message="Bấm một phiếu bên trái để xem hàng đã nhận." />
                  ) : (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-start gap-2">
                        <Button size="sm" className="lg:hidden" icon={ArrowLeft} onClick={() => setDetail(null)}>Danh sách</Button>
                        <div className="flex-1 min-w-[12rem]">
                          <div className="font-bold">
                            Phiếu <span className="font-mono">{detail.code}</span>{' '}
                            <PurchaseStatusBadge status={detail.status} />
                          </div>
                          <div className="text-2xs text-muted-ink">
                            {datetime(detail.ts)} · {detail.supplier_name || 'Không rõ mối'} · {detail.warehouse_name}
                          </div>
                        </div>
                      </div>
                      {detail.note && <p className="text-[13px] text-muted-ink">Ghi chú: {detail.note}</p>}
                      <div className="table-wrap">
                        <table className="data">
                          <thead><tr><th>Tên hàng</th><th>ĐVT</th><th className="text-right">Số lượng</th></tr></thead>
                          <tbody>
                            {detail.items.map((it) => (
                              <tr key={it.id}>
                                <td>
                                  <div className="font-semibold">{it.product_name}</div>
                                  <div className="text-2xs text-muted-ink font-mono">{it.sku}</div>
                                  {it.recv_note && <div className="text-2xs text-warn">{it.recv_note}</div>}
                                </td>
                                <td>{it.unit_name}</td>
                                <td className="num">
                                  {fq(it.qty)}
                                  {it.received_qty != null && it.received_qty !== it.qty && (
                                    <span className="block text-2xs text-warn">bạn đếm {fq(it.received_qty)}</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
      </Page>

      <ReceiveForm open={!!creating} onClose={() => setCreating(false)}
        onSaved={(res) => { setCreating(false); reload(); openDetail(res.id); }} />
    </>
  );
}

/* ===================== HỘP NHẬN HÀNG (KHÔNG CÓ GIÁ) ================== */

function ReceiveForm({ open, onClose, onSaved }) {
  const { toast, meta, defaultWarehouse } = useApp();
  const [supplierId, setSupplierId] = useState(null);
  const [warehouseId, setWarehouseId] = useState(defaultWarehouse);
  const [lines, setLines] = useState([]);
  const [note, setNote] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  /* Chỉ mã và tên mối — đường này không trả SĐT, tài khoản hay công nợ */
  const { data: suppliers } = useFetch(() => api.get('/supplier-names'), [], { skip: !open });
  const { data: products } = useFetch(
    () => api.posProducts({ warehouse_id: warehouseId }), [warehouseId], { skip: !open });

  useEffect(() => {
    if (!open) return;
    setSupplierId(null); setLines([]); setNote(''); setErr('');
    setWarehouseId(defaultWarehouse);
  }, [open, defaultWarehouse]);

  const addProduct = (p, qty = 1) => {
    const add = Number(qty) > 0 ? Number(qty) : 1;
    const unit = p.units.find((u) => u.id === p.buy_unit_id) || p.units.find((u) => u.factor === 1) || p.units[0];
    const key = `${p.id}:${unit.id}`;
    setLines((prev) => (prev.some((l) => l.key === key)
      ? prev.map((l) => (l.key === key ? { ...l, qty: l.qty + add } : l))
      : [...prev, {
        key, product_id: p.id, sku: p.sku, name: p.name, base_unit: p.base_unit,
        units: p.units, unit_id: unit.id, unit_name: unit.unit_name, factor: unit.factor, qty: add, note: '',
      }]));
  };
  const patch = (key, x) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...x } : l)));
  const remove = (key) => setLines((prev) => prev.filter((l) => l.key !== key));
  const changeUnit = (l, unitId) => {
    const u = l.units.find((x) => x.id === Number(unitId));
    if (u) patch(l.key, { unit_id: u.id, unit_name: u.unit_name, factor: u.factor });
  };

  const save = async () => {
    setErr('');
    if (!supplierId) { setErr('Chọn mối giao hàng.'); return; }
    if (!lines.length) { setErr('Chưa có món nào.'); return; }
    setBusy(true);
    try {
      const res = await api.post('/purchases/receive', {
        supplier_id: supplierId, warehouse_id: warehouseId, note,
        items: lines.map((l) => ({
          product_id: l.product_id, unit_id: l.unit_id, unit_name: l.unit_name, factor: l.factor,
          qty: l.qty, note: l.note,
        })),
      });
      toast(`Đã nhận hàng — phiếu ${res.code}, chờ chủ tiệm chốt giá`, 'ok');
      onSaved(res);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} size="lg" title="Nhận hàng"
        subtitle="Ghi đúng số đếm được. Thiếu, móp, hỏng thì ghi chú ở từng món."
        footer={(
          <>
            <Button onClick={onClose}>Đóng</Button>
            <Button variant="primary" icon={ClipboardCheck} loading={busy} onClick={save}>Lưu phiếu nhận hàng</Button>
          </>
        )}>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mối giao hàng" htmlFor="rf-supplier">
              <Combo id="rf-supplier" autoFocus items={suppliers || []} value={supplierId} onChange={setSupplierId}
                placeholder="Chọn mối..." filter={(s, q) => match(s.name, q) || match(s.code, q)}
                render={(s) => ({ label: s.name, sub: s.code })} />
            </Field>
            <Field label="Nhận vào kho">
              <Select value={warehouseId || ''} onChange={(e) => setWarehouseId(Number(e.target.value))}>
                {meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </Field>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="text-[13px] font-semibold">{lines.length} món</div>
            <CartPickerButton kind="purchase" count={lines.length} onClick={() => setPickerOpen(true)} />
          </div>

          {!lines.length ? (
            <Empty icon={PackageCheck} title="Chưa có món nào"
              message="Bấm nút chọn hàng để tìm hoặc quét mã vạch từng món."
              action={<CartPickerButton kind="purchase" size="md" onClick={() => setPickerOpen(true)} />} />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Tên hàng</th><th>ĐVT</th><th className="text-right">Số đếm được</th><th>Ghi chú</th><th /></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.key}>
                      <td><div className="font-semibold">{l.name}</div><div className="text-2xs text-muted-ink font-mono">{l.sku}</div></td>
                      <td>
                        {l.units.length > 1 ? (
                          <Select size="sm" value={l.unit_id} onChange={(e) => changeUnit(l, e.target.value)}
                            aria-label={`Đơn vị của ${l.name}`}>
                            {l.units.map((u) => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                          </Select>
                        ) : l.unit_name}
                      </td>
                      <td className="num">
                        <QtyInput value={l.qty} min={0} className="!w-20 ml-auto"
                          onChange={(v) => patch(l.key, { qty: Number(v) || 0 })} aria-label={`Số đếm được của ${l.name}`} />
                      </td>
                      <td>
                        <Input size="sm" value={l.note} placeholder="thiếu / móp / hỏng..."
                          onChange={(e) => patch(l.key, { note: e.target.value })} aria-label={`Ghi chú ${l.name}`} />
                      </td>
                      <td><IconButton icon={Trash2} label={`Bỏ ${l.name}`} onClick={() => remove(l.key)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Field label="Ghi chú cả phiếu">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ví dụ: mối hẹn giao bù 1 thùng" />
          </Field>
          {err && <p className="error-text">{err}</p>}
        </div>
      </Modal>

      <CartPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} kind="purchase" wide qtyEntry
        title="Chọn hàng nhận về" products={products || []} lines={lines}
        onAdd={addProduct} onPatch={patch} onRemove={remove}
        showPrice={false} editPrice={false} footerNote="Số món trên phiếu" />
    </>
  );
}

/* ============ CHỐT GIÁ PHIẾU NHẬN HÀNG (CHỦ / QUẢN LÝ) ================ */

/**
 * Điền sẵn số thủ kho đếm và giá tạm (giá nhập lần trước), chủ sửa theo hoá
 * đơn của mối. Sửa được số lượng nếu thủ kho đếm sai; về 0 là bỏ dòng.
 */
export function PricingModal({ purchase, onClose, onDone }) {
  const { toast, meta } = useApp();
  const [lines, setLines] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [otherCost, setOtherCost] = useState(0);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [paid, setPaid] = useState(0);
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!purchase) return;
    setLines(purchase.items.map((it) => ({
      id: it.id, name: it.product_name, sku: it.sku, unit_name: it.unit_name, factor: it.factor,
      counted: it.received_qty ?? it.qty, qty: it.qty, temp: it.price, price: it.price, vat_rate: 0,
    })));
    setDiscount(0); setOtherCost(0); setInvoiceNo(''); setDueDate(''); setPaid(0); setErr('');
    setAccountId(meta.accounts?.[0]?.id || '');
  }, [purchase, meta.accounts]);

  const math = useMemo(
    () => purchaseMath({ discount, other_cost: otherCost }, lines.filter((l) => l.qty > 0)),
    [lines, discount, otherCost]);
  const patch = (id, x) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...x } : l)));

  const save = async () => {
    setErr('');
    setBusy(true);
    try {
      await api.post(`/purchases/${purchase.id}/price`, {
        items: lines.map((l) => ({ purchase_item_id: l.id, qty: l.qty, price: l.price, vat_rate: l.vat_rate })),
        discount, other_cost: otherCost, supplier_invoice: invoiceNo, due_date: dueDate || null,
        paid, account_id: accountId,
      });
      toast(`Đã chốt giá phiếu ${purchase.code}`, 'ok');
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!purchase} onClose={onClose} size="xl" title={`Chốt giá phiếu ${purchase?.code || ''}`}
      subtitle="Giá điền sẵn là giá nhập lần trước — sửa theo hoá đơn của mối"
      footer={(
        <>
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" loading={busy} onClick={save}>Chốt giá · {money(math.total)}</Button>
        </>
      )}>
      {purchase && (
        <div className="space-y-3">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Tên hàng</th><th>ĐVT</th>
                  <th className="text-right">Thủ kho đếm</th>
                  <th className="text-right">Số lượng</th>
                  <th className="text-right">Đơn giá</th>
                  <th className="text-right">VAT %</th>
                  <th className="text-right">Thành tiền</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.id}>
                    <td>
                      <div className="font-semibold">{l.name}</div>
                      <div className="text-2xs text-muted-ink font-mono">{l.sku}</div>
                      {purchase.items[i]?.recv_note && <div className="text-2xs text-warn">{purchase.items[i].recv_note}</div>}
                    </td>
                    <td>{l.unit_name}</td>
                    <td className="num text-muted-ink">{fq(l.counted)}</td>
                    <td className="num">
                      <QtyInput value={l.qty} min={0} className="!w-20 ml-auto"
                        onChange={(v) => patch(l.id, { qty: Math.max(0, Number(v) || 0) })} aria-label={`Số lượng ${l.name}`} />
                      {l.qty !== l.counted && (
                        <span className="flex items-center justify-end gap-1 text-2xs text-warn mt-0.5">
                          <AlertTriangle size={12} aria-hidden="true" />khác số đếm
                        </span>
                      )}
                    </td>
                    <td className="num">
                      <MoneyInput size="sm" value={l.price} className="!w-28 ml-auto"
                        onChange={(v) => patch(l.id, { price: v })} aria-label={`Đơn giá ${l.name}`} />
                      {l.price !== l.temp && <span className="block text-2xs text-muted-ink">tạm {money(l.temp)}</span>}
                    </td>
                    <td className="num">
                      <QtyInput value={l.vat_rate} min={0} className="!w-14 ml-auto"
                        onChange={(v) => patch(l.id, { vat_rate: Math.max(0, Number(v) || 0) })} aria-label={`Thuế GTGT ${l.name}`} />
                    </td>
                    <td className="num font-semibold">{money(Math.round(l.qty * l.price))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Số hoá đơn của mối"><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></Field>
            <Field label="Giảm giá cả phiếu"><MoneyInput value={discount} onChange={setDiscount} /></Field>
            <Field label="Chi phí vận chuyển"><MoneyInput value={otherCost} onChange={setOtherCost} /></Field>
            <Field label="Hạn thanh toán"><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
            <Field label="Trả ngay">
              <MoneyInput value={paid} onChange={(v) => setPaid(Math.min(v, math.total))} />
            </Field>
            {paid > 0 && (
              <Field label="Chi từ quỹ">
                <Select value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
                  {meta.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </Field>
            )}
          </div>

          <div className="card p-2.5 text-[13px] space-y-0.5 max-w-sm ml-auto">
            <div className="flex justify-between"><span>Tiền hàng</span><span className="tabular">{money(math.subtotal)}</span></div>
            {math.vatAmount > 0 && <div className="flex justify-between"><span>Thuế GTGT</span><span className="tabular">{money(math.vatAmount)}</span></div>}
            {discount > 0 && <div className="flex justify-between"><span>Giảm giá</span><span className="tabular">−{money(discount)}</span></div>}
            {otherCost > 0 && <div className="flex justify-between"><span>Chi phí vận chuyển</span><span className="tabular">{money(otherCost)}</span></div>}
            <div className="flex justify-between font-bold border-t border-line pt-1"><span>Tổng phiếu</span><span className="tabular">{money(math.total)}</span></div>
            <div className="flex justify-between text-muted-ink"><span>Ghi nợ mối</span><span className="tabular">{money(math.total - paid)}</span></div>
          </div>
          {err && <p className="error-text">{err}</p>}
        </div>
      )}
    </Modal>
  );
}
