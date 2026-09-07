import { useState, useMemo, useEffect } from 'react';
import { Undo2, Eye, Plus, Trash2, Search } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch } from '../lib/store';
import { money, n, short, qty as fq, datetime, date, range, RANGES, match } from '../lib/format';
import {
  Button, IconButton, Select, Modal, Spinner, Empty, ErrorBox, Badge, Stat,
  Field, MoneyInput, Textarea, Combo, QtyInput,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import { ProductPicker } from './Purchases';

/* ==================================================================== */
/* Khách trả hàng — danh sách                                            */
/* ==================================================================== */

export function SaleReturns() {
  const [rangeKey, setRangeKey] = useState('day30');
  const r = useMemo(() => range(rangeKey), [rangeKey]);
  const { data, busy, error, reload } = useFetch(
    () => api.saleReturns({ from: r.from, to: r.to }), [r.from, r.to]
  );
  const [detail, setDetail] = useState(null);

  const totals = useMemo(() => {
    if (!data) return null;
    return {
      count: data.length,
      total: data.reduce((a, x) => a + x.total, 0),
      refunded: data.reduce((a, x) => a + x.refunded, 0),
    };
  }, [data]);

  return (
    <>
      <PageHeader
        title="Khách trả hàng"
        subtitle={`${r.label} · Lập phiếu trả hàng từ màn hình Hoá đơn`}
      >
        <Select value={rangeKey} onChange={(e) => setRangeKey(e.target.value)} size="sm" className="!w-auto">
          {RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </PageHeader>

      <Page className="space-y-3">
        {totals && (
          <div className="grid gap-2 grid-cols-3">
            <Stat label="Số phiếu trả" value={n(totals.count)} icon={Undo2} />
            <Stat label="Giá trị hàng trả" value={short(totals.total)} tone="warn" />
            <Stat label="Đã hoàn tiền" value={short(totals.refunded)} />
          </div>
        )}

        {busy && !data ? <Spinner />
          : error ? <ErrorBox error={error} onRetry={reload} />
            : !data?.length ? (
              <Empty
                icon={Undo2}
                title="Không có phiếu trả hàng"
                message="Khi khách mang hàng đến trả, vào màn hình Hoá đơn, tìm hoá đơn gốc rồi bấm nút Trả hàng."
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Mã phiếu</th><th>Ngày</th><th>Khách hàng</th><th>Hoá đơn gốc</th>
                      <th className="text-right">Giá trị</th>
                      <th className="text-right">Phí</th>
                      <th className="text-right">Đã hoàn</th>
                      <th>Lý do</th>
                      <th className="text-right">Xem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((x) => (
                      <tr key={x.id} className="hoverable">
                        <td className="font-mono font-semibold">{x.code}</td>
                        <td className="text-muted-ink whitespace-nowrap">{datetime(x.ts)}</td>
                        <td>{x.customer_name || 'Khách lẻ'}</td>
                        <td className="font-mono text-muted-ink">{x.sale_code || '—'}</td>
                        <td className="num font-semibold">{money(x.total)}</td>
                        <td className="num text-muted-ink">{x.fee > 0 ? money(x.fee) : '—'}</td>
                        <td className="num">{money(x.refunded)}</td>
                        <td className="text-muted-ink truncate max-w-[200px]">{x.reason || '—'}</td>
                        <td className="text-right">
                          <IconButton icon={Eye} label={`Xem ${x.code}`} size={14}
                            onClick={async () => setDetail(await api.get(`/sale-returns/${x.id}`))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </Page>

      <ReturnDetail detail={detail} onClose={() => setDetail(null)} kind="sale" />
    </>
  );
}

/* ==================================================================== */
/* Trả hàng nhà cung cấp — danh sách + form lập phiếu                    */
/* ==================================================================== */

export function PurchaseReturns() {
  const { toast } = useApp();
  const [rangeKey, setRangeKey] = useState('day30');
  const r = useMemo(() => range(rangeKey), [rangeKey]);
  const { data, busy, error, reload } = useFetch(
    () => api.purchaseReturns({ from: r.from, to: r.to }), [r.from, r.to]
  );
  const [detail, setDetail] = useState(null);
  const [creating, setCreating] = useState(false);

  const totals = useMemo(() => {
    if (!data) return null;
    return {
      count: data.length,
      total: data.reduce((a, x) => a + x.total, 0),
      refunded: data.reduce((a, x) => a + x.refunded, 0),
    };
  }, [data]);

  return (
    <>
      <PageHeader
        title="Trả hàng nhà cung cấp"
        subtitle={`${r.label} · Hàng lỗi, sai quy cách trả lại cho mối`}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            Lập phiếu trả hàng
          </Button>
        }
      >
        <Select value={rangeKey} onChange={(e) => setRangeKey(e.target.value)} size="sm" className="!w-auto">
          {RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </PageHeader>

      <Page className="space-y-3">
        {totals && (
          <div className="grid gap-2 grid-cols-3">
            <Stat label="Số phiếu trả" value={n(totals.count)} icon={Undo2} />
            <Stat label="Giá trị hàng trả" value={short(totals.total)} />
            <Stat label="NCC đã hoàn tiền" value={short(totals.refunded)} tone="good" />
          </div>
        )}

        {busy && !data ? <Spinner />
          : error ? <ErrorBox error={error} onRetry={reload} />
            : !data?.length ? (
              <Empty
                icon={Undo2}
                title="Chưa có phiếu trả hàng NCC"
                message="Khi nhận hàng lỗi hoặc sai quy cách, lập phiếu trả để trừ tồn kho và giảm công nợ."
                action={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Lập phiếu trả hàng</Button>}
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Mã phiếu</th><th>Ngày</th><th>Nhà cung cấp</th><th>Phiếu nhập gốc</th>
                      <th className="text-right">Giá trị</th>
                      <th className="text-right">NCC hoàn</th>
                      <th>Lý do</th>
                      <th className="text-right">Xem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((x) => (
                      <tr key={x.id} className="hoverable">
                        <td className="font-mono font-semibold">{x.code}</td>
                        <td className="text-muted-ink whitespace-nowrap">{datetime(x.ts)}</td>
                        <td>{x.supplier_name || '—'}</td>
                        <td className="font-mono text-muted-ink">{x.purchase_code || '—'}</td>
                        <td className="num font-semibold">{money(x.total)}</td>
                        <td className="num">{money(x.refunded)}</td>
                        <td className="text-muted-ink truncate max-w-[200px]">{x.reason || '—'}</td>
                        <td className="text-right">
                          <IconButton icon={Eye} label={`Xem ${x.code}`} size={14}
                            onClick={async () => setDetail(await api.get(`/purchase-returns/${x.id}`))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </Page>

      <ReturnDetail detail={detail} onClose={() => setDetail(null)} kind="purchase" />

      <PurchaseReturnForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(code) => { setCreating(false); reload(); toast(`Đã lập phiếu trả hàng ${code}`, 'ok'); }}
      />
    </>
  );
}

/* -------------------------------------------------------------------- */

function ReturnDetail({ detail, onClose, kind }) {
  return (
    <Modal
      open={!!detail}
      onClose={onClose}
      title={detail ? `Phiếu trả hàng ${detail.code}` : ''}
      subtitle={detail ? `${datetime(detail.ts)} · ${detail.customer_name || detail.supplier_name || ''}` : ''}
      size="lg"
      footer={<Button onClick={onClose}>Đóng</Button>}
    >
      {detail && (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3 text-[13px]">
            <div className="card p-2.5">
              <div className="text-2xs font-bold text-muted-ink uppercase">Chứng từ gốc</div>
              <div className="font-mono font-semibold">{detail.sale_code || detail.purchase_code || '—'}</div>
            </div>
            <div className="card p-2.5">
              <div className="text-2xs font-bold text-muted-ink uppercase">Kho</div>
              <div className="font-semibold">{detail.warehouse_name}</div>
            </div>
            <div className="card p-2.5">
              <div className="text-2xs font-bold text-muted-ink uppercase">Lý do</div>
              <div>{detail.reason || '—'}</div>
            </div>
          </div>

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Tên hàng</th><th>ĐVT</th>
                  <th className="text-right">SL</th>
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
                    <td className="num">{money(it.price)}</td>
                    <td className="num font-semibold">{money(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <div className="w-full sm:w-64 space-y-1 text-[13px]">
              <div className="flex justify-between">
                <span className="text-muted-ink">Giá trị hàng trả</span>
                <span className="tabular font-mono">{money(detail.subtotal)}</span>
              </div>
              {detail.fee > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-ink">Phí trả hàng</span>
                  <span className="tabular font-mono">-{money(detail.fee)}</span>
                </div>
              )}
              <div className="flex justify-between pt-1.5 border-t border-line font-bold">
                <span>Tổng cộng</span><span className="tabular font-mono">{money(detail.total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-ink">{kind === 'sale' ? 'Đã hoàn khách' : 'NCC đã hoàn'}</span>
                <span className="tabular font-mono">{money(detail.refunded)}</span>
              </div>
            </div>
          </div>

          {detail.note && <div className="card p-2.5 text-[13px]"><b>Ghi chú: </b>{detail.note}</div>}
        </div>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------------- */

function PurchaseReturnForm({ open, onClose, onSaved }) {
  const { meta, user, defaultWarehouse } = useApp();
  const [supplierId, setSupplierId] = useState(null);
  const [warehouseId, setWarehouseId] = useState(defaultWarehouse);
  const [lines, setLines] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [refunded, setRefunded] = useState(0);
  const [accountId, setAccountId] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const { data: suppliers } = useFetch(() => api.suppliers({ active: 1 }), [], { skip: !open });
  const { data: products } = useFetch(
    () => api.posProducts({ warehouse_id: warehouseId }), [warehouseId], { skip: !open }
  );

  useEffect(() => {
    if (!open) return;
    setSupplierId(null); setLines([]); setRefunded(0);
    setReason(''); setNote(''); setErr('');
    setWarehouseId(defaultWarehouse);
    setAccountId(meta.accounts?.[0]?.id || '');
  }, [open, defaultWarehouse, meta.accounts]);

  const addProduct = (p) => {
    const unit = p.units.find((u) => u.factor === 1) || p.units[0];
    const key = `${p.id}:${unit.id}`;
    setLines((prev) => prev.some((l) => l.key === key)
      ? prev.map((l) => l.key === key ? { ...l, qty: l.qty + 1 } : l)
      : [...prev, {
          key, product_id: p.id, sku: p.sku, name: p.name, base_unit: p.base_unit,
          units: p.units, unit_id: unit.id, unit_name: unit.unit_name, factor: unit.factor,
          qty: 1, price: Math.round(p.cost_price * unit.factor), stock: p.stock,
        }]);
  };

  const updateLine = (key, patch) => setLines((prev) => prev.map((l) => l.key === key ? { ...l, ...patch } : l));
  const removeLine = (key) => setLines((prev) => prev.filter((l) => l.key !== key));

  const subtotal = useMemo(
    () => lines.reduce((a, l) => a + Math.round(l.qty * l.price), 0), [lines]
  );
  useEffect(() => { setRefunded(subtotal); }, [subtotal]);

  const submit = async () => {
    if (!lines.length) { setErr('Phải chọn ít nhất 1 mặt hàng để trả.'); return; }
    setBusy(true);
    setErr('');
    try {
      const res = await api.post('/purchase-returns', {
        supplier_id: supplierId,
        warehouse_id: warehouseId,
        user_id: user?.id,
        refunded, account_id: accountId, reason, note,
        items: lines.map((l) => ({
          product_id: l.product_id, unit_name: l.unit_name,
          factor: l.factor, qty: l.qty, price: l.price,
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
        title="Lập phiếu trả hàng nhà cung cấp"
        subtitle="Hàng trả sẽ bị trừ khỏi tồn kho"
        size="lg"
        footer={<>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!lines.length}>
            Lưu phiếu trả hàng
          </Button>
        </>}
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nhà cung cấp" required>
              <Combo
                items={suppliers || []}
                value={supplierId}
                onChange={setSupplierId}
                placeholder="Chọn nhà cung cấp..."
                filter={(s, q) => match(s.name, q) || (s.phone || '').includes(q)}
                render={(s) => ({ label: s.name, sub: s.phone })}
              />
            </Field>
            <Field label="Trả từ kho">
              <Select value={warehouseId || ''} onChange={(e) => setWarehouseId(Number(e.target.value))}>
                {meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </Field>
          </div>

          <div className="flex items-center justify-between">
            <span className="label !mb-0">Hàng trả lại ({lines.length})</span>
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setPickerOpen(true)}>Chọn hàng</Button>
          </div>

          {lines.length === 0 ? (
            <Empty icon={Undo2} title="Chưa chọn hàng" message="Bấm Chọn hàng để thêm mặt hàng cần trả." />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Tên hàng</th><th style={{ width: 130 }}>Đơn vị</th>
                    <th style={{ width: 90 }} className="text-right">SL trả</th>
                    <th style={{ width: 130 }} className="text-right">Đơn giá</th>
                    <th className="text-right">Thành tiền</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const over = l.qty * l.factor > l.stock;
                    return (
                      <tr key={l.key}>
                        <td>
                          <div className="font-semibold">{l.name}</div>
                          <div className="text-2xs text-muted-ink">
                            Tồn {fq(l.stock)} {l.base_unit}
                            {over && <Badge tone="bad" className="ml-1">Không đủ tồn</Badge>}
                          </div>
                        </td>
                        <td>
                          {l.units.length > 1 ? (
                            <Select size="sm" value={l.unit_id}
                              onChange={(e) => {
                                const u = l.units.find((x) => x.id === Number(e.target.value));
                                const perBase = l.price / (l.factor || 1);
                                updateLine(l.key, {
                                  key: `${l.product_id}:${u.id}`, unit_id: u.id,
                                  unit_name: u.unit_name, factor: u.factor,
                                  price: Math.round(perBase * u.factor),
                                });
                              }}
                              aria-label={`Đơn vị của ${l.name}`}>
                              {l.units.map((u) => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                            </Select>
                          ) : <span className="text-muted-ink">{l.unit_name}</span>}
                        </td>
                        <td><QtyInput value={l.qty} onChange={(v) => updateLine(l.key, { qty: v })} aria-label={`Số lượng trả ${l.name}`} /></td>
                        <td><MoneyInput size="sm" value={l.price} onChange={(v) => updateLine(l.key, { price: v })} aria-label={`Đơn giá ${l.name}`} /></td>
                        <td className="num font-semibold">{money(Math.round(l.qty * l.price))}</td>
                        <td>
                          <IconButton icon={Trash2} label={`Bỏ ${l.name}`} size={14}
                            className="!text-danger hover:!bg-red-50" onClick={() => removeLine(l.key)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-3">
              <Field label="Lý do trả hàng">
                <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="">— Chọn lý do —</option>
                  <option>Hàng giao bị lỗi</option>
                  <option>Sai quy cách đặt hàng</option>
                  <option>Bao bì hư hỏng</option>
                  <option>Giao thừa so với đơn đặt</option>
                  <option>Lý do khác</option>
                </Select>
              </Field>
              <Field label="Ghi chú">
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>

            <div className="space-y-3">
              <div className="card p-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold">Tổng giá trị trả</span>
                  <span className="text-xl font-display font-bold tabular">{money(subtotal)}</span>
                </div>
              </div>
              <Field label="NCC hoàn tiền mặt" hint="Để 0 nếu trừ vào công nợ đang nợ NCC">
                <MoneyInput value={refunded} onChange={setRefunded} />
              </Field>
              {refunded > 0 && (
                <Field label="Nộp vào quỹ">
                  <Select value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
                    {meta.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                </Field>
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
        title="Chọn hàng cần trả lại NCC"
      />
    </>
  );
}
