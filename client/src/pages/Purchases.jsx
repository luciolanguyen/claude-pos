import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  FileText, Plus, Eye, XCircle, Truck, Download, Trash2, Search, Undo2, Wallet,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, useDebounced } from '../lib/store';
import { money, n, short, qty as fq, datetime, date, isoDate, range, RANGES, match } from '../lib/format';
import {
  Button, IconButton, SearchInput, Select, Modal, Spinner, Empty, ErrorBox, Badge,
  Confirm, Field, MoneyInput, Textarea, Stat, Combo, QtyInput, Input,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import { SupplierForm } from '../components/CustomerForm';

export default function Purchases() {
  const { toast, meta, user } = useApp();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [rangeKey, setRangeKey] = useState('day30');
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);
  const r = useMemo(() => range(rangeKey), [rangeKey]);

  const { data, busy, error, reload } = useFetch(
    () => api.purchases({ q: dq, from: r.from, to: r.to, unpaid: onlyUnpaid ? 1 : '' }),
    [dq, r.from, r.to, onlyUnpaid]
  );

  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [paying, setPaying] = useState(null);
  const [busyAction, setBusyAction] = useState(false);

  const totals = useMemo(() => {
    if (!data) return null;
    const done = data.filter((p) => p.status === 'done');
    return {
      count: done.length,
      total: done.reduce((a, p) => a + p.total, 0),
      paid: done.reduce((a, p) => a + p.paid, 0),
      unpaid: done.reduce((a, p) => a + Math.max(0, p.remaining), 0),
    };
  }, [data]);

  const doCancel = async () => {
    setBusyAction(true);
    try {
      await api.post(`/purchases/${cancelling.id}/cancel`);
      toast(`Đã huỷ phiếu nhập ${cancelling.code}`, 'ok');
      setCancelling(null);
      setDetail(null);
      reload();
    } catch (e) {
      toast(e.message, 'bad', 7000);
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Phiếu nhập hàng"
        subtitle={`${r.label} · ${date(r.from)} — ${date(r.to)}`}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            Tạo phiếu nhập
          </Button>
        }
      >
        <div className="flex flex-wrap gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Tìm mã phiếu, tên NCC, số hoá đơn..." className="w-full sm:w-80" />
          <Select value={rangeKey} onChange={(e) => setRangeKey(e.target.value)} size="sm" className="!w-auto">
            {RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <button onClick={() => setOnlyUnpaid((v) => !v)} className={`btn btn-sm ${onlyUnpaid ? 'btn-secondary' : 'btn-outline'}`}>
            Chỉ phiếu còn nợ
          </button>
        </div>
      </PageHeader>

      <Page className="space-y-3">
        {totals && (
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
            <Stat label="Số phiếu nhập" value={n(totals.count)} icon={FileText} />
            <Stat label="Tổng tiền nhập" value={short(totals.total)} />
            <Stat label="Đã thanh toán" value={short(totals.paid)} tone="good" />
            <Stat label="Còn nợ NCC" value={short(totals.unpaid)} tone={totals.unpaid > 0 ? 'bad' : 'default'} />
          </div>
        )}

        {busy && !data ? <Spinner />
          : error ? <ErrorBox error={error} onRetry={reload} />
            : !data?.length ? (
              <Empty
                icon={FileText}
                title="Chưa có phiếu nhập nào"
                message="Tạo phiếu nhập mỗi khi lấy hàng về để hệ thống tự cộng tồn kho và tính giá vốn."
                action={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Tạo phiếu nhập</Button>}
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Mã phiếu</th><th>Ngày nhập</th><th>Nhà cung cấp</th>
                      <th>Số HĐ của NCC</th>
                      <th className="text-right">Số mặt</th>
                      <th className="text-right">Tổng tiền</th>
                      <th className="text-right">Đã trả</th>
                      <th className="text-right">Còn nợ</th>
                      <th>Hạn trả</th>
                      <th className="text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((p) => {
                      const overdue = p.remaining > 0 && p.due_date && p.due_date < isoDate();
                      return (
                        <tr key={p.id} className={`hoverable ${p.status === 'cancelled' ? 'opacity-55' : ''}`}>
                          <td>
                            <button
                              onClick={async () => setDetail(await api.purchase(p.id))}
                              className="font-mono font-semibold text-accent hover:underline cursor-pointer"
                            >
                              {p.code}
                            </button>
                            {p.status === 'cancelled' && <Badge tone="bad" className="ml-1">Đã huỷ</Badge>}
                          </td>
                          <td className="text-muted-ink whitespace-nowrap">{datetime(p.ts)}</td>
                          <td className="truncate max-w-[200px]">{p.supplier_name || '—'}</td>
                          <td className="font-mono text-muted-ink">{p.supplier_invoice || '—'}</td>
                          <td className="num">{p.item_count}</td>
                          <td className="num font-semibold">{money(p.total)}</td>
                          <td className="num">{money(p.paid)}</td>
                          <td className={`num ${p.remaining > 0 ? 'text-danger font-semibold' : 'text-muted-ink'}`}>
                            {p.remaining > 0 ? money(p.remaining) : '—'}
                          </td>
                          <td>
                            {p.due_date
                              ? <span className={overdue ? 'text-danger font-semibold' : 'text-muted-ink'}>
                                  {date(p.due_date)}{overdue && ' (quá hạn)'}
                                </span>
                              : <span className="text-muted-ink">—</span>}
                          </td>
                          <td>
                            <div className="flex items-center justify-end gap-0.5">
                              <IconButton icon={Eye} label={`Xem ${p.code}`} size={14}
                                onClick={async () => setDetail(await api.purchase(p.id))} />
                              {p.status === 'done' && p.remaining > 0 && (
                                <IconButton icon={Wallet} label={`Trả tiền ${p.code}`} size={14}
                                  className="!text-warn" onClick={() => setPaying(p)} />
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
      </Page>

      <PurchaseForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(code) => { setCreating(false); reload(); toast(`Đã lưu phiếu nhập ${code}`, 'ok'); }}
      />

      {/* Chi tiết phiếu nhập */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `Phiếu nhập ${detail.code}` : ''}
        subtitle={detail ? `${datetime(detail.ts)} · ${detail.supplier_name || 'Không rõ NCC'}` : ''}
        size="lg"
        footer={detail && <>
          {detail.status === 'done' && (
            <Button variant="danger" icon={XCircle} onClick={() => setCancelling(detail)}>Huỷ phiếu</Button>
          )}
          <div className="flex-1" />
          <Button onClick={() => setDetail(null)}>Đóng</Button>
        </>}
      >
        {detail && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 text-[13px]">
              <div className="card p-2.5">
                <div className="text-2xs font-bold text-muted-ink uppercase mb-1">Nhà cung cấp</div>
                <div className="font-semibold">{detail.supplier_name || '—'}</div>
                {detail.supplier_phone && <div className="text-muted-ink">{detail.supplier_phone}</div>}
                {detail.supplier_address && <div className="text-muted-ink">{detail.supplier_address}</div>}
              </div>
              <div className="card p-2.5">
                <div className="text-2xs font-bold text-muted-ink uppercase mb-1">Chứng từ</div>
                <div>Kho nhận: {detail.warehouse_name}</div>
                <div>Số HĐ của NCC: {detail.supplier_invoice || '—'}</div>
                <div>Hạn thanh toán: {detail.due_date ? date(detail.due_date) : '—'}</div>
                <div>Người lập: {detail.user_name || '—'}</div>
              </div>
            </div>

            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Tên hàng</th><th>ĐVT</th>
                    <th className="text-right">SL</th>
                    <th className="text-right">Quy đổi</th>
                    <th className="text-right">Đơn giá</th>
                    <th className="text-right">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((it) => (
                    <tr key={it.id}>
                      <td>
                        <div className="font-semibold">{it.product_name}</div>
                        <div className="text-2xs text-muted-ink font-mono">{it.sku}</div>
                      </td>
                      <td>{it.unit_name}</td>
                      <td className="num">{fq(it.qty)}</td>
                      <td className="num text-muted-ink">
                        {it.factor > 1 ? `${fq(it.qty * it.factor)} ${it.base_unit}` : '—'}
                      </td>
                      <td className="num">{money(it.price)}</td>
                      <td className="num font-semibold">{money(it.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <div className="w-full sm:w-72 space-y-1 text-[13px]">
                <div className="flex justify-between"><span className="text-muted-ink">Tiền hàng</span><span className="tabular font-mono">{money(detail.subtotal)}</span></div>
                {detail.discount > 0 && <div className="flex justify-between"><span className="text-muted-ink">Chiết khấu</span><span className="tabular font-mono">-{money(detail.discount)}</span></div>}
                {detail.vat_amount > 0 && <div className="flex justify-between"><span className="text-muted-ink">Thuế GTGT</span><span className="tabular font-mono">{money(detail.vat_amount)}</span></div>}
                {detail.other_cost > 0 && <div className="flex justify-between"><span className="text-muted-ink">Chi phí khác</span><span className="tabular font-mono">{money(detail.other_cost)}</span></div>}
                <div className="flex justify-between pt-1.5 border-t border-line font-bold text-base">
                  <span>Tổng cộng</span><span className="tabular font-mono">{money(detail.total)}</span>
                </div>
                <div className="flex justify-between"><span className="text-muted-ink">Đã thanh toán</span><span className="tabular font-mono">{money(detail.paid)}</span></div>
                {detail.total - detail.paid > 0 && (
                  <div className="flex justify-between font-semibold text-danger">
                    <span>Còn nợ NCC</span><span className="tabular font-mono">{money(detail.total - detail.paid)}</span>
                  </div>
                )}
              </div>
            </div>

            {detail.note && <div className="card p-2.5 text-[13px]"><b>Ghi chú:</b> {detail.note}</div>}
          </div>
        )}
      </Modal>

      <PurchasePayModal
        purchase={paying}
        accounts={meta.accounts}
        onClose={() => setPaying(null)}
        onDone={() => { setPaying(null); reload(); toast('Đã lập phiếu chi trả NCC', 'ok'); }}
      />

      <Confirm
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        onConfirm={doCancel}
        busy={busyAction}
        title="Huỷ phiếu nhập này?"
        confirmText="Huỷ phiếu nhập"
        message={cancelling && (
          <>
            Phiếu <b className="font-mono">{cancelling.code}</b> trị giá <b>{money(cancelling.total)}</b> sẽ bị huỷ.
            <br /><br />
            Toàn bộ hàng trên phiếu sẽ bị <b>trừ khỏi tồn kho</b>. Nếu hàng đã bán ra rồi thì
            hệ thống sẽ từ chối huỷ để tránh làm tồn kho bị âm.
          </>
        )}
      />
    </>
  );
}

/* ==================================================================== */
/* Form tạo phiếu nhập hàng                                              */
/* ==================================================================== */

export function PurchaseForm({ open, onClose, onSaved }) {
  const { meta, user, defaultWarehouse, toast } = useApp();
  const [supplierId, setSupplierId] = useState(null);
  const [warehouseId, setWarehouseId] = useState(defaultWarehouse);
  const [lines, setLines] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [otherCost, setOtherCost] = useState(0);
  const [applyVat, setApplyVat] = useState(true);
  const [paid, setPaid] = useState(0);
  const [accountId, setAccountId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const { data: suppliers } = useFetch(() => api.suppliers({ active: 1 }), [], { skip: !open });
  const { data: products } = useFetch(() => api.posProducts({ warehouse_id: warehouseId }), [warehouseId], { skip: !open });

  useEffect(() => {
    if (!open) return;
    setSupplierId(null);
    setLines([]);
    setDiscount(0);
    setOtherCost(0);
    setPaid(0);
    setInvoiceNo('');
    setDueDate('');
    setNote('');
    setErr('');
    setWarehouseId(defaultWarehouse);
    setAccountId(meta.accounts?.[0]?.id || '');
  }, [open, defaultWarehouse, meta.accounts]);

  /* Chọn NCC -> tự tính hạn thanh toán theo số ngày công nợ đã khai */
  useEffect(() => {
    if (!supplierId || !suppliers) return;
    const s = suppliers.find((x) => x.id === supplierId);
    if (s?.term_days > 0) {
      const d = new Date();
      d.setDate(d.getDate() + s.term_days);
      setDueDate(isoDate(d));
    }
  }, [supplierId, suppliers]);

  const addProduct = (p) => {
    const unit = p.units.find((u) => u.factor === 1) || p.units[0];
    const key = `${p.id}:${unit.id}`;
    setLines((prev) => {
      if (prev.some((l) => l.key === key)) {
        return prev.map((l) => l.key === key ? { ...l, qty: l.qty + 1 } : l);
      }
      return [...prev, {
        key, product_id: p.id, sku: p.sku, name: p.name, base_unit: p.base_unit,
        units: p.units, unit_id: unit.id, unit_name: unit.unit_name, factor: unit.factor,
        qty: 1, price: Math.round(p.cost_price * unit.factor), discount: 0,
        vat_rate: p.vat_rate, current_stock: p.stock,
      }];
    });
  };

  const updateLine = (key, patch) => setLines((prev) => prev.map((l) => l.key === key ? { ...l, ...patch } : l));
  const removeLine = (key) => setLines((prev) => prev.filter((l) => l.key !== key));

  const changeUnit = (line, unitId) => {
    const u = line.units.find((x) => x.id === Number(unitId));
    if (!u) return;
    // Đổi đơn vị -> quy đổi lại đơn giá theo hệ số để không phải gõ lại
    const perBase = line.price / (line.factor || 1);
    updateLine(line.key, {
      key: `${line.product_id}:${u.id}`,
      unit_id: u.id, unit_name: u.unit_name, factor: u.factor,
      price: Math.round(perBase * u.factor),
    });
  };

  const totals = useMemo(() => {
    let subtotal = 0, vat = 0;
    for (const l of lines) {
      const amt = Math.round(l.qty * l.price - (l.discount || 0));
      subtotal += amt;
      if (applyVat) vat += Math.round(amt * (l.vat_rate || 0) / 100);
    }
    return { subtotal, vat, total: subtotal - discount + vat + otherCost };
  }, [lines, discount, otherCost, applyVat]);

  useEffect(() => { setPaid(totals.total); }, [totals.total]);

  const submit = async () => {
    if (!lines.length) { setErr('Phiếu nhập phải có ít nhất 1 mặt hàng.'); return; }
    setBusy(true);
    setErr('');
    try {
      const res = await api.post('/purchases', {
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        user_id: user?.id,
        discount, other_cost: otherCost, paid,
        account_id: accountId,
        supplier_invoice: invoiceNo || null,
        due_date: dueDate || null,
        note,
        items: lines.map((l) => ({
          product_id: l.product_id, unit_name: l.unit_name, factor: l.factor,
          qty: l.qty, price: l.price, discount: l.discount || 0,
          vat_rate: applyVat ? l.vat_rate : 0,
        })),
      });
      onSaved?.(res.code);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Tạo phiếu nhập hàng"
        subtitle="Hàng sẽ được cộng vào tồn kho và cập nhật giá vốn bình quân"
        size="xl"
        footer={<>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!lines.length}>
            Lưu phiếu nhập
          </Button>
        </>}
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Nhà cung cấp" className="sm:col-span-2">
              <Combo
                items={suppliers || []}
                value={supplierId}
                onChange={setSupplierId}
                placeholder="Chọn nhà cung cấp..."
                filter={(s, q) => match(s.name, q) || (s.phone || '').includes(q) || match(s.code, q)}
                render={(s) => ({
                  label: s.name,
                  sub: [s.phone, s.debt > 0 ? `Đang nợ ${money(s.debt)}` : null].filter(Boolean).join(' · '),
                })}
              />
            </Field>
            <Field label="Nhập vào kho">
              <Select value={warehouseId || ''} onChange={(e) => setWarehouseId(Number(e.target.value))}>
                {meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </Field>
            <Field label="Số hoá đơn của NCC">
              <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="HDGTGT-12345" />
            </Field>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="label !mb-0">Danh sách hàng nhập ({lines.length})</span>
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setPickerOpen(true)}>
              Chọn hàng
            </Button>
          </div>

          {lines.length === 0 ? (
            <Empty
              icon={FileText}
              title="Chưa chọn hàng nào"
              message="Bấm Chọn hàng để thêm các mặt hàng lấy về từ nhà cung cấp."
              action={<Button variant="primary" icon={Plus} onClick={() => setPickerOpen(true)}>Chọn hàng</Button>}
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Tên hàng</th>
                    <th style={{ width: 130 }}>Đơn vị nhập</th>
                    <th style={{ width: 90 }} className="text-right">Số lượng</th>
                    <th style={{ width: 130 }} className="text-right">Đơn giá nhập</th>
                    <th className="text-right">Quy đổi</th>
                    <th className="text-right">Thành tiền</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.key}>
                      <td>
                        <div className="font-semibold">{l.name}</div>
                        <div className="text-2xs text-muted-ink font-mono">
                          {l.sku} · tồn hiện tại {fq(l.current_stock)} {l.base_unit}
                        </div>
                      </td>
                      <td>
                        {l.units.length > 1 ? (
                          <Select size="sm" value={l.unit_id} onChange={(e) => changeUnit(l, e.target.value)}
                            aria-label={`Đơn vị nhập của ${l.name}`}>
                            {l.units.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.unit_name}{u.factor > 1 ? ` (=${fq(u.factor)} ${l.base_unit})` : ''}
                              </option>
                            ))}
                          </Select>
                        ) : <span className="text-muted-ink">{l.unit_name}</span>}
                      </td>
                      <td>
                        <QtyInput value={l.qty} onChange={(v) => updateLine(l.key, { qty: v })}
                          aria-label={`Số lượng nhập ${l.name}`} />
                      </td>
                      <td>
                        <MoneyInput size="sm" value={l.price} onChange={(v) => updateLine(l.key, { price: v })}
                          aria-label={`Đơn giá nhập ${l.name}`} />
                      </td>
                      <td className="num text-muted-ink">
                        {l.factor > 1
                          ? <>{fq(l.qty * l.factor)} {l.base_unit}<br />
                              <span className="text-2xs">{money(Math.round(l.price / l.factor))}/{l.base_unit}</span></>
                          : '—'}
                      </td>
                      <td className="num font-semibold">{money(Math.round(l.qty * l.price - (l.discount || 0)))}</td>
                      <td>
                        <IconButton icon={Trash2} label={`Bỏ ${l.name}`} size={14}
                          className="!text-danger hover:!bg-red-50" onClick={() => removeLine(l.key)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-3">
              <Field label="Hạn thanh toán" hint="Tự điền theo số ngày công nợ của NCC">
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
              <Field label="Ghi chú">
                <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Ví dụ: hàng giao thiếu 2 cuộn, hẹn bù tuần sau" />
              </Field>
            </div>

            <div className="space-y-2">
              <div className="card p-3 space-y-2">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-muted-ink">Tiền hàng</span>
                  <span className="tabular font-mono font-semibold">{money(totals.subtotal)}</span>
                </div>

                <div className="flex items-center justify-between gap-2 text-[13px]">
                  <label htmlFor="pf-disc" className="text-muted-ink">Chiết khấu NCC cho</label>
                  <MoneyInput id="pf-disc" size="sm" className="!w-32" value={discount} onChange={setDiscount} />
                </div>

                <div className="flex items-center justify-between gap-2 text-[13px]">
                  <label htmlFor="pf-other" className="text-muted-ink">
                    Chi phí khác
                    <span className="block text-2xs">Phân bổ vào giá vốn</span>
                  </label>
                  <MoneyInput id="pf-other" size="sm" className="!w-32" value={otherCost} onChange={setOtherCost} />
                </div>

                <label className="flex items-center justify-between gap-2 text-[13px] cursor-pointer">
                  <span className="text-muted-ink">Tính thuế GTGT</span>
                  <input type="checkbox" className="w-4 h-4 accent-emerald-700 cursor-pointer"
                    checked={applyVat} onChange={(e) => setApplyVat(e.target.checked)} />
                </label>

                {applyVat && totals.vat > 0 && (
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-muted-ink">Thuế GTGT</span>
                    <span className="tabular font-mono">{money(totals.vat)}</span>
                  </div>
                )}

                <div className="flex items-baseline justify-between pt-2 border-t border-line">
                  <span className="font-semibold">Tổng phải trả</span>
                  <span className="text-xl font-display font-bold tabular">{money(totals.total)}</span>
                </div>
              </div>

              <Field label="Trả ngay cho NCC" hint="Để 0 nếu ghi nợ toàn bộ">
                <MoneyInput size="lg" value={paid} onChange={setPaid} />
                <div className="flex gap-1.5 mt-2">
                  <button className="btn btn-sm btn-outline" onClick={() => setPaid(totals.total)}>Trả hết</button>
                  <button className="btn btn-sm btn-outline" onClick={() => setPaid(0)}>Nợ hết</button>
                </div>
              </Field>

              {paid > 0 && (
                <Field label="Chi từ quỹ">
                  <Select value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
                    {meta.accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name} — số dư {money(a.balance)}</option>
                    ))}
                  </Select>
                </Field>
              )}

              {totals.total - paid > 0 && (
                <p className="text-[13px] text-warn font-semibold">
                  Còn nợ NCC: {money(totals.total - paid)}
                </p>
              )}
            </div>
          </div>

          {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
        </div>
      </Modal>

      <ProductPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        products={products || []}
        onPick={addProduct}
      />
    </>
  );
}

/* ==================================================================== */
/* Hộp chọn sản phẩm dùng chung cho nhập hàng / kiểm kê / chuyển kho     */
/* ==================================================================== */

export function ProductPicker({ open, onClose, products, onPick, title = 'Chọn hàng hoá' }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const { meta } = useApp();

  useEffect(() => { if (open) setQ(''); }, [open]);

  const list = useMemo(() => {
    let l = products;
    if (cat) l = l.filter((p) => p.category_id === Number(cat));
    if (q.trim()) l = l.filter((p) => match(p.name, q) || match(p.sku, q) || (p.barcode || '').includes(q.trim()));
    return l.slice(0, 300);
  }, [products, q, cat]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle="Bấm vào dòng để thêm. Có thể chọn nhiều mặt hàng liên tiếp."
      size="lg"
      footer={<Button variant="primary" onClick={onClose}>Xong</Button>}
    >
      <div className="space-y-2">
        <div className="flex gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Gõ tên hàng hoặc quét mã vạch..." className="flex-1" autoFocus />
          <Select value={cat} onChange={(e) => setCat(e.target.value)} className="!w-auto">
            <option value="">Mọi nhóm hàng</option>
            {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>

        {list.length === 0 ? (
          <Empty icon={Search} title="Không tìm thấy hàng nào" message={`Không có mặt hàng khớp "${q}".`} />
        ) : (
          <div className="table-wrap max-h-[50vh] overflow-y-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Mã hàng</th><th>Tên hàng</th><th>Nhóm</th>
                  <th className="text-right">Tồn kho</th>
                  <th className="text-right">Giá vốn</th>
                  <th style={{ width: 60 }} />
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className="hoverable clickable" onClick={() => onPick(p)}>
                    <td className="font-mono text-muted-ink">{p.sku}</td>
                    <td className="font-semibold">{p.name}</td>
                    <td className="text-muted-ink">{p.category_name || '—'}</td>
                    <td className="num">
                      {p.track_stock
                        ? <span className={p.stock <= 0 ? 'text-danger font-semibold' : ''}>
                            {fq(p.stock)} {p.base_unit}
                          </span>
                        : <span className="text-muted-ink">Dịch vụ</span>}
                    </td>
                    <td className="num">{money(p.cost_price)}</td>
                    <td>
                      <Button size="sm" variant="soft" onClick={(e) => { e.stopPropagation(); onPick(p); }}>
                        Thêm
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

/* -------------------------------------------------------------------- */

function PurchasePayModal({ purchase, accounts, onClose, onDone }) {
  const [amount, setAmount] = useState(0);
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!purchase) return;
    setAmount(purchase.remaining);
    setAccountId(accounts?.[0]?.id || '');
    setNote('');
    setErr('');
  }, [purchase, accounts]);

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.post(`/purchases/${purchase.id}/pay`, { amount, account_id: accountId, note });
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!purchase}
      onClose={onClose}
      title="Thanh toán cho nhà cung cấp"
      subtitle={purchase ? `${purchase.code} · ${purchase.supplier_name || ''}` : ''}
      size="sm"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={submit} loading={busy}>Lập phiếu chi</Button>
      </>}
    >
      {purchase && (
        <div className="space-y-3">
          <div className="card p-2.5 text-[13px] space-y-0.5">
            <div className="flex justify-between"><span className="text-muted-ink">Tổng phiếu nhập</span><span className="tabular font-mono">{money(purchase.total)}</span></div>
            <div className="flex justify-between"><span className="text-muted-ink">Đã trả</span><span className="tabular font-mono">{money(purchase.paid)}</span></div>
            <div className="flex justify-between font-bold text-danger"><span>Còn nợ</span><span className="tabular font-mono">{money(purchase.remaining)}</span></div>
          </div>
          <Field label="Số tiền trả" required>
            <MoneyInput size="lg" value={amount} onChange={setAmount} autoFocus />
          </Field>
          <Field label="Chi từ quỹ">
            <Select value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
              {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name} — số dư {money(a.balance)}</option>)}
            </Select>
          </Field>
          <Field label="Ghi chú">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
        </div>
      )}
    </Modal>
  );
}
