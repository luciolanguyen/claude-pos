import { useState, useMemo, useEffect } from 'react';
import {
  Wrench, Plus, Eye, XCircle, Scissors, Package, AlertTriangle, Trash2,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch } from '../lib/store';
import { money, n, short, qty as fq, datetime, date, range, RANGES, match } from '../lib/format';
import {
  Button, IconButton, Select, Modal, Spinner, Empty, ErrorBox, Badge, Confirm,
  Field, MoneyInput, Textarea, Stat, Combo, QtyInput, Tabs,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';

export default function Production() {
  const { toast } = useApp();
  const [kind, setKind] = useState('');
  const [rangeKey, setRangeKey] = useState('day30');
  const r = useMemo(() => range(rangeKey), [rangeKey]);

  const { data, busy, error, reload } = useFetch(
    () => api.get('/productions', { kind, from: r.from, to: r.to }),
    [kind, r.from, r.to]
  );

  const [creating, setCreating] = useState(null);  // 'assemble' | 'split'
  const [detail, setDetail] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [busyAction, setBusyAction] = useState(false);

  const totals = useMemo(() => {
    if (!data) return null;
    return {
      count: data.length,
      assembled: data.filter((x) => x.kind === 'assemble').length,
      split: data.filter((x) => x.kind === 'split').length,
      cost: data.reduce((a, x) => a + x.total_cost, 0),
      labor: data.reduce((a, x) => a + x.labor_cost, 0),
    };
  }, [data]);

  const doCancel = async () => {
    setBusyAction(true);
    try {
      await api.post(`/productions/${cancelling.id}/cancel`);
      toast(`Đã huỷ phiếu ${cancelling.code}, linh kiện đã hoàn về kho.`, 'ok');
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
        title="Sản xuất"
        subtitle="Lắp ráp thành phẩm từ linh kiện, hoặc chia nhỏ hàng lớn ra bán lẻ"
        actions={<>
          <Button icon={Scissors} onClick={() => setCreating('split')}>Chia nhỏ hàng</Button>
          <Button variant="primary" icon={Wrench} onClick={() => setCreating('assemble')}>
            Lắp ráp thành phẩm
          </Button>
        </>}
      >
        <div className="flex flex-wrap gap-2">
          <Select value={rangeKey} onChange={(e) => setRangeKey(e.target.value)} size="sm" className="!w-auto">
            {RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <div className="flex gap-1">
            {[['', 'Tất cả'], ['assemble', 'Lắp ráp'], ['split', 'Chia nhỏ']].map(([k, l]) => (
              <button key={k} onClick={() => setKind(k)}
                className={`btn btn-sm ${kind === k ? 'btn-secondary' : 'btn-outline'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </PageHeader>

      <Page className="space-y-3">
        {totals && (
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
            <Stat label="Số phiếu" value={n(totals.count)} icon={Wrench} />
            <Stat label="Phiếu lắp ráp" value={n(totals.assembled)} />
            <Stat label="Phiếu chia nhỏ" value={n(totals.split)} />
            <Stat label="Tổng giá trị sản xuất" value={short(totals.cost)}
              sub={totals.labor > 0 ? `gồm ${short(totals.labor)} tiền công` : ''} />
          </div>
        )}

        {busy && !data ? <Spinner />
          : error ? <ErrorBox error={error} onRetry={reload} />
            : !data?.length ? (
              <Empty
                icon={Wrench}
                title="Chưa có phiếu sản xuất nào"
                message="Lắp ráp: gộp linh kiện thành thành phẩm (tủ điện lắp sẵn). Chia nhỏ: tách hàng lớn ra bán lẻ (cuộn dây thành mét)."
                action={<Button variant="primary" icon={Wrench} onClick={() => setCreating('assemble')}>Lắp ráp thành phẩm</Button>}
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Mã phiếu</th><th>Ngày</th><th>Loại</th><th>Thành phẩm</th>
                      <th className="text-right">Số lượng</th>
                      <th className="text-right">Giá vốn NVL</th>
                      <th className="text-right">Tiền công</th>
                      <th className="text-right">Giá vốn / đơn vị</th>
                      <th>Người làm</th>
                      <th className="text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((x) => (
                      <tr key={x.id} className="hoverable">
                        <td>
                          <button
                            onClick={async () => setDetail(await api.get(`/productions/${x.id}`))}
                            className="font-mono font-semibold text-accent hover:underline cursor-pointer"
                          >
                            {x.code}
                          </button>
                        </td>
                        <td className="text-muted-ink whitespace-nowrap">{datetime(x.ts)}</td>
                        <td>
                          <Badge tone={x.kind === 'assemble' ? 'info' : 'mute'}>
                            {x.kind === 'assemble'
                              ? <><Wrench size={9} aria-hidden="true" /> Lắp ráp</>
                              : <><Scissors size={9} aria-hidden="true" /> Chia nhỏ</>}
                          </Badge>
                        </td>
                        <td className="font-semibold">{x.product_name}</td>
                        <td className="num">{fq(x.qty)} {x.base_unit}</td>
                        <td className="num">{money(x.material_cost)}</td>
                        <td className="num text-muted-ink">{x.labor_cost > 0 ? money(x.labor_cost) : '—'}</td>
                        <td className="num font-semibold">{money(x.unit_cost)}</td>
                        <td className="text-muted-ink">{x.user_name || '—'}</td>
                        <td>
                          <div className="flex items-center justify-end gap-0.5">
                            <IconButton icon={Eye} label={`Xem ${x.code}`} size={14}
                              onClick={async () => setDetail(await api.get(`/productions/${x.id}`))} />
                            <IconButton icon={Trash2} label={`Huỷ ${x.code}`} size={14}
                              className="!text-danger hover:!bg-red-50"
                              onClick={() => setCancelling(x)} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </Page>

      <AssembleForm
        open={creating === 'assemble'}
        onClose={() => setCreating(null)}
        onSaved={(code) => { setCreating(null); reload(); toast(`Đã lập phiếu lắp ráp ${code}`, 'ok'); }}
      />
      <SplitForm
        open={creating === 'split'}
        onClose={() => setCreating(null)}
        onSaved={(code) => { setCreating(null); reload(); toast(`Đã lập phiếu chia nhỏ ${code}`, 'ok'); }}
      />

      {/* Chi tiết phiếu */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `Phiếu ${detail.kind === 'assemble' ? 'lắp ráp' : 'chia nhỏ'} ${detail.code}` : ''}
        subtitle={detail ? `${datetime(detail.ts)} · ${detail.warehouse_name}` : ''}
        size="lg"
        footer={detail && <>
          <Button variant="danger" icon={XCircle} onClick={() => setCancelling(detail)}>Huỷ phiếu</Button>
          <div className="flex-1" />
          <Button onClick={() => setDetail(null)}>Đóng</Button>
        </>}
      >
        {detail && (
          <div className="space-y-3">
            <div className="card p-3 bg-accent-soft/40 border-accent/25">
              <div className="text-2xs font-bold text-emerald-900/70 uppercase">Thành phẩm làm ra</div>
              <div className="flex items-baseline justify-between gap-3 mt-1">
                <span className="font-semibold">{detail.product_name}</span>
                <span className="font-display font-bold text-lg tabular">
                  {fq(detail.qty)} {detail.base_unit}
                </span>
              </div>
              <div className="text-2xs text-emerald-900/80 mt-0.5">
                Giá vốn {money(detail.unit_cost)} / {detail.base_unit}
              </div>
            </div>

            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>{detail.kind === 'assemble' ? 'Linh kiện đã dùng' : 'Hàng gốc đã tách'}</th>
                    <th className="text-right">Số lượng</th>
                    <th className="text-right">Giá vốn</th>
                    <th className="text-right">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((it) => (
                    <tr key={it.id}>
                      <td>
                        <div className="font-semibold">{it.component_name}</div>
                        <div className="text-2xs text-muted-ink font-mono">{it.sku}</div>
                      </td>
                      <td className="num">{fq(it.qty)} {it.base_unit}</td>
                      <td className="num">{money(it.unit_cost)}</td>
                      <td className="num font-semibold">{money(it.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="text-right">Giá vốn nguyên vật liệu</td>
                    <td className="num">{money(detail.material_cost)}</td>
                  </tr>
                  {detail.labor_cost > 0 && (
                    <tr>
                      <td colSpan={3} className="text-right">Tiền công</td>
                      <td className="num">{money(detail.labor_cost)}</td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={3} className="text-right">TỔNG GIÁ THÀNH</td>
                    <td className="num">{money(detail.total_cost)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {detail.note && <div className="card p-2.5 text-[13px]"><b>Ghi chú: </b>{detail.note}</div>}
          </div>
        )}
      </Modal>

      <Confirm
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        onConfirm={doCancel}
        busy={busyAction}
        title="Huỷ phiếu sản xuất?"
        confirmText="Huỷ phiếu"
        message={cancelling && (
          <>
            Huỷ phiếu <b className="font-mono">{cancelling.code}</b>?
            <br /><br />
            Toàn bộ linh kiện sẽ được <b>hoàn về kho</b>, và <b>{fq(cancelling.qty)} {cancelling.base_unit}</b>{' '}
            thành phẩm sẽ bị <b>trừ khỏi kho</b>.
            <br /><br />
            Nếu thành phẩm đã bán ra rồi thì hệ thống sẽ từ chối huỷ.
          </>
        )}
      />
    </>
  );
}

/* ==================================================================== */
/* Phiếu lắp ráp theo định mức                                           */
/* ==================================================================== */

function AssembleForm({ open, onClose, onSaved }) {
  const { meta, user, defaultWarehouse } = useApp();
  const [productId, setProductId] = useState(null);
  const [qty, setQty] = useState(1);
  const [warehouseId, setWarehouseId] = useState(defaultWarehouse);
  const [laborCost, setLaborCost] = useState(0);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const { data: products } = useFetch(
    () => api.posProducts({ warehouse_id: warehouseId }), [warehouseId], { skip: !open }
  );

  useEffect(() => {
    if (!open) return;
    setProductId(null); setQty(1); setLaborCost(0); setNote(''); setErr(''); setLines([]);
    setWarehouseId(defaultWarehouse);
  }, [open, defaultWarehouse]);

  /* Chọn thành phẩm -> nạp định mức và nhân theo số lượng */
  useEffect(() => {
    if (!productId) { setLines([]); return; }
    api.get(`/products/${productId}/bom`)
      .then((d) => setLines(d.rows.map((x) => ({ ...x, perUnit: x.qty }))))
      .catch(() => setLines([]));
  }, [productId]);

  const product = products?.find((p) => p.id === productId);
  const needed = lines.map((l) => ({ ...l, need: l.perUnit * (Number(qty) || 0) }));
  const materialCost = needed.reduce((a, l) => a + Math.round(l.need * l.cost_price), 0);
  const totalCost = materialCost + (Number(laborCost) || 0);
  const unitCost = Number(qty) > 0 ? Math.round(totalCost / Number(qty)) : 0;
  const shortage = needed.filter((l) => l.need > (l.stock ?? 0));
  const maxMakeable = needed.length
    ? Math.floor(Math.min(...needed.map((l) => l.perUnit > 0 ? (l.stock ?? 0) / l.perUnit : Infinity)))
    : 0;

  const submit = async () => {
    if (!productId) { setErr('Chọn thành phẩm cần lắp ráp.'); return; }
    if (!lines.length) { setErr('Mặt hàng này chưa khai định mức. Vào Kho hàng → Hàng hoá → sửa mặt hàng → Định mức nguyên vật liệu.'); return; }
    setBusy(true);
    setErr('');
    try {
      const res = await api.post('/productions/assemble', {
        product_id: productId, qty: Number(qty), warehouse_id: warehouseId,
        user_id: user?.id, labor_cost: Number(laborCost) || 0, note,
        items: needed.map((l) => ({ component_id: l.component_id, qty: l.need })),
      });
      onSaved?.(res.code);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Lắp ráp thành phẩm"
      subtitle="Trừ kho linh kiện, cộng kho thành phẩm và tính giá vốn tự động"
      size="lg"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" icon={Wrench} onClick={submit} loading={busy}
          disabled={!productId || !lines.length || shortage.length > 0}>
          Lập phiếu lắp ráp
        </Button>
      </>}
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Thành phẩm" required className="sm:col-span-2">
            <Combo
              items={(products || []).filter((p) => p.track_stock)}
              value={productId}
              onChange={setProductId}
              placeholder="Chọn mặt hàng cần lắp ráp..."
              filter={(p, q) => match(p.name, q) || match(p.alias || '', q) || match(p.sku, q)}
              render={(p) => ({
                label: p.name,
                sub: [p.sku, p.is_manufactured === 1 ? 'đã khai định mức' : 'chưa khai định mức']
                  .filter(Boolean).join(' · '),
              })}
            />
          </Field>
          <Field label="Làm ra bao nhiêu" required>
            <div className="flex items-center gap-2">
              <QtyInput size="md" value={qty} onChange={setQty} min={1} className="flex-1" />
              <span className="text-[13px] text-muted-ink whitespace-nowrap">
                {product?.base_unit || ''}
              </span>
            </div>
          </Field>
        </div>

        {productId && lines.length === 0 && (
          <div className="card p-3 bg-amber-50 border-warn/30 text-[13px] flex gap-2.5">
            <AlertTriangle size={16} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-amber-900">
              <b>{product?.name}</b> chưa khai định mức nguyên vật liệu.
              <br />
              Vào <b>Kho hàng → Hàng hoá</b>, bấm vào tên mặt hàng, mở mục{' '}
              <b>Định mức nguyên vật liệu</b> để khai cần những linh kiện gì.
            </div>
          </div>
        )}

        {lines.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <span className="label !mb-0">Linh kiện cần dùng</span>
              {maxMakeable > 0 && (
                <span className="text-2xs text-muted-ink">
                  Kho hiện đủ làm tối đa <b>{n(maxMakeable)}</b> {product?.base_unit}
                </span>
              )}
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Linh kiện</th>
                    <th className="text-right">Định mức / 1 SP</th>
                    <th className="text-right">Cần dùng</th>
                    <th className="text-right">Tồn kho</th>
                    <th className="text-right">Giá vốn</th>
                    <th className="text-right">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {needed.map((l) => {
                    const lack = l.need > (l.stock ?? 0);
                    return (
                      <tr key={l.component_id} className={lack ? 'bg-red-50' : ''}>
                        <td>
                          <div className="font-semibold">{l.component_name}</div>
                          <div className="text-2xs text-muted-ink font-mono">{l.sku}</div>
                        </td>
                        <td className="num text-muted-ink">{fq(l.perUnit)}</td>
                        <td className="num font-semibold">{fq(l.need)} {l.base_unit}</td>
                        <td className={`num ${lack ? 'text-danger font-bold' : 'text-muted-ink'}`}>
                          {fq(l.stock ?? 0)}
                          {lack && <div className="text-2xs">thiếu {fq(l.need - (l.stock ?? 0))}</div>}
                        </td>
                        <td className="num">{money(l.cost_price)}</td>
                        <td className="num font-semibold">{money(Math.round(l.need * l.cost_price))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {shortage.length > 0 && (
              <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">
                Thiếu {shortage.length} loại linh kiện. Giảm số lượng làm ra xuống{' '}
                {maxMakeable > 0 ? `tối đa ${n(maxMakeable)}` : '(kho chưa có linh kiện nào)'}, hoặc nhập thêm hàng.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-3">
                <Field label="Kho lấy linh kiện / nhận thành phẩm">
                  <Select value={warehouseId || ''} onChange={(e) => setWarehouseId(Number(e.target.value))}>
                    {meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </Select>
                </Field>
                <Field label="Tiền công lắp ráp" hint="Cộng vào giá vốn thành phẩm">
                  <MoneyInput value={laborCost} onChange={setLaborCost} />
                </Field>
                <Field label="Ghi chú">
                  <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
              </div>

              <div className="card p-3 space-y-1.5 text-[13px] h-fit">
                <div className="flex justify-between">
                  <span className="text-muted-ink">Giá vốn nguyên vật liệu</span>
                  <span className="tabular font-mono font-semibold">{money(materialCost)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-ink">Tiền công</span>
                  <span className="tabular font-mono">{money(laborCost)}</span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-line font-bold">
                  <span>Tổng giá thành</span>
                  <span className="tabular font-mono">{money(totalCost)}</span>
                </div>
                <div className="flex items-baseline justify-between pt-1.5 border-t border-line">
                  <span className="font-semibold">Giá vốn 1 {product?.base_unit}</span>
                  <span className="text-lg font-display font-bold text-accent tabular">
                    {money(unitCost)}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
      </div>
    </Modal>
  );
}

/* ==================================================================== */
/* Phiếu chia nhỏ / cắt lẻ                                               */
/* ==================================================================== */

function SplitForm({ open, onClose, onSaved }) {
  const { meta, user, defaultWarehouse } = useApp();
  const [fromId, setFromId] = useState(null);
  const [toId, setToId] = useState(null);
  const [fromQty, setFromQty] = useState(1);
  const [toQty, setToQty] = useState(1);
  const [warehouseId, setWarehouseId] = useState(defaultWarehouse);
  const [laborCost, setLaborCost] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const { data: products } = useFetch(
    () => api.posProducts({ warehouse_id: warehouseId }), [warehouseId], { skip: !open }
  );

  useEffect(() => {
    if (!open) return;
    setFromId(null); setToId(null); setFromQty(1); setToQty(1);
    setLaborCost(0); setNote(''); setErr('');
    setWarehouseId(defaultWarehouse);
  }, [open, defaultWarehouse]);

  const from = products?.find((p) => p.id === fromId);
  const to = products?.find((p) => p.id === toId);
  const materialCost = Math.round((Number(fromQty) || 0) * (from?.cost_price || 0));
  const totalCost = materialCost + (Number(laborCost) || 0);
  const unitCost = Number(toQty) > 0 ? Math.round(totalCost / Number(toQty)) : 0;
  const notEnough = from && Number(fromQty) > from.stock;

  const submit = async () => {
    if (!fromId || !toId) { setErr('Chọn cả hàng gốc và hàng tách ra.'); return; }
    setBusy(true);
    setErr('');
    try {
      const res = await api.post('/productions/split', {
        from_product_id: fromId, from_qty: Number(fromQty),
        to_product_id: toId, to_qty: Number(toQty),
        warehouse_id: warehouseId, user_id: user?.id,
        labor_cost: Number(laborCost) || 0, note,
      });
      onSaved?.(res.code);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Chia nhỏ hàng"
      subtitle="Tách hàng lớn ra thành hàng lẻ: cuộn dây thành mét, thùng bóng thành cái"
      size="md"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" icon={Scissors} onClick={submit} loading={busy}
          disabled={!fromId || !toId || notEnough}>
          Lập phiếu chia nhỏ
        </Button>
      </>}
    >
      <div className="space-y-3">
        <div className="card p-3 bg-muted/50 text-[13px] text-muted-ink">
          Dùng khi hàng gốc và hàng lẻ là <b>hai mã hàng khác nhau</b>. Nếu chỉ là hai
          đơn vị tính của cùng một mã hàng (Cuộn 100m và Mét) thì không cần phiếu này —
          hệ thống đã tự quy đổi khi bán.
        </div>

        <Field label="Hàng gốc — lấy ra để chia" required>
          <Combo
            items={(products || []).filter((p) => p.track_stock)}
            value={fromId}
            onChange={setFromId}
            placeholder="Chọn hàng gốc..."
            filter={(p, q) => match(p.name, q) || match(p.alias || '', q) || match(p.sku, q)}
            render={(p) => ({ label: p.name, sub: `${p.sku} · tồn ${fq(p.stock)} ${p.base_unit}` })}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Số lượng lấy ra" required
            hint={from ? `Tồn kho: ${fq(from.stock)} ${from.base_unit}` : ''}>
            <QtyInput size="md" value={fromQty} onChange={setFromQty} min={0} />
            {notEnough && <p className="error-text">Kho không đủ, chỉ còn {fq(from.stock)}.</p>}
          </Field>
          <Field label="Kho">
            <Select value={warehouseId || ''} onChange={(e) => setWarehouseId(Number(e.target.value))}>
              {meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="Hàng lẻ nhận về" required>
          <Combo
            items={(products || []).filter((p) => p.track_stock && p.id !== fromId)}
            value={toId}
            onChange={setToId}
            placeholder="Chọn hàng lẻ..."
            filter={(p, q) => match(p.name, q) || match(p.alias || '', q) || match(p.sku, q)}
            render={(p) => ({ label: p.name, sub: `${p.sku} · tồn ${fq(p.stock)} ${p.base_unit}` })}
          />
        </Field>

        <Field label="Số lượng nhận về" required
          hint="Trừ phần hao hụt khi cắt. Ví dụ cắt 1 cuộn 100m còn 98m thì ghi 98.">
          <div className="flex items-center gap-2">
            <QtyInput size="md" value={toQty} onChange={setToQty} min={0} className="flex-1" />
            <span className="text-[13px] text-muted-ink whitespace-nowrap">{to?.base_unit || ''}</span>
          </div>
        </Field>

        <Field label="Tiền công cắt / chia" hint="Cộng vào giá vốn hàng lẻ">
          <MoneyInput value={laborCost} onChange={setLaborCost} />
        </Field>

        <Field label="Ghi chú">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Ví dụ: cắt hao 2m" />
        </Field>

        {from && to && Number(toQty) > 0 && (
          <div className="card p-3 space-y-1.5 text-[13px]">
            <div className="flex justify-between">
              <span className="text-muted-ink">Giá vốn hàng gốc lấy ra</span>
              <span className="tabular font-mono">{money(materialCost)}</span>
            </div>
            {laborCost > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-ink">Tiền công</span>
                <span className="tabular font-mono">{money(laborCost)}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between pt-1.5 border-t border-line">
              <span className="font-semibold">Giá vốn 1 {to.base_unit} hàng lẻ</span>
              <span className="text-lg font-display font-bold text-accent tabular">{money(unitCost)}</span>
            </div>
          </div>
        )}

        {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
      </div>
    </Modal>
  );
}
