/* ====================================================================
   PHIẾU BÁO HẾT HÀNG

   Nhân viên cầm điện thoại đi dọc quầy, thấy món nào cạn thì thêm vào
   phiếu và gõ ba con số: máy đang ghi bao nhiêu, đếm thật được bao
   nhiêu, cần nhập thêm bao nhiêu.

   Quản lý mở phiếu ra làm hai việc RIÊNG BIỆT:

     - Tích chọn dòng nào tin được rồi bấm "Cập nhật kho" — chỉ những
       dòng đó mới bị ghi đè tồn. Dòng nào nghi ngờ thì để đó đếm lại.

     - Chọn mối cho từng dòng rồi bấm "Tạo phiếu nhập tạm" — phần mềm
       gom theo mối và sinh ra mỗi mối một phiếu.

   Chỗ dễ mất tiền nhất: một món chọn hai mối thì nó nằm ở CẢ HAI phiếu,
   mỗi phiếu đủ số lượng. Ý là hỏi giá hai nơi rồi chọn một. Duyệt cả
   hai là mua gấp đôi — nên chỗ đó phải cảnh báo thật rõ.
   ==================================================================== */
import { useState, useMemo, useEffect } from 'react';
import {
  ClipboardList, Plus, Trash2, Search, PackageX, AlertTriangle, Truck,
  CheckCircle2, RefreshCcw, FileText, Warehouse, Wand2, X, Eye,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, usePaged, useDebounced } from '../lib/store';
import { money, n, qty as fq, date, datetime } from '../lib/format';
import {
  Button, IconButton, Input, Select, Modal, Field, Empty, Spinner, Badge,
  Textarea, QtyInput, SearchInput, ErrorBox, Confirm, Pager,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import { ProductPicker } from '../components/ProductPicker';
import SaveDraftButton, { OpenDraftsButton } from '../components/DraftButtons';

const STATUS = {
  open: { label: 'Đang mở', tone: 'warn' },
  done: { label: 'Đã xong', tone: 'good' },
  cancelled: { label: 'Đã huỷ', tone: 'default' },
};

export default function Requisitions() {
  const { can } = useApp();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);

  const filters = useMemo(() => ({ q: dq, status }), [dq, status]);
  const {
    rows, total, busy, error, reload, page, setPage, pageSize, setPageSize,
  } = usePaged((pg) => api.get('/requisitions', { ...filters, ...pg }), [filters],
    { key: 'requisitions' });

  return (
    <>
      <PageHeader
        title="Phiếu báo hết hàng"
        subtitle={total ? `${n(total)} phiếu` : 'Nhân viên báo món cạn hàng để đề xuất nhập thêm'}
        actions={
          <>
            <OpenDraftsButton kind="requisition" onOpen={(d) => setCreating(d)} />
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
              Lập phiếu báo hết
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap gap-2">
          <SearchInput value={q} onChange={setQ}
            placeholder="Tìm mã phiếu, người lập, ghi chú..." className="w-full sm:w-80" />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} size="sm" className="!w-auto">
            <option value="">Mọi trạng thái</option>
            {Object.entries(STATUS).map(([k, s]) => (
              <option key={k} value={k}>{s.label}</option>
            ))}
          </Select>
        </div>
      </PageHeader>

      <Page>
        {error ? <ErrorBox error={error} onRetry={reload} />
          : busy && !rows.length ? <Spinner />
            : !rows.length ? (
              <Empty
                icon={PackageX}
                title="Chưa có phiếu báo hết hàng nào"
                message="Đi một vòng quầy, thấy món nào cạn thì lập phiếu — phần mềm sẽ gom theo mối và làm sẵn phiếu nhập."
                action={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                  Lập phiếu báo hết
                </Button>}
              />
            ) : (
              <div className="card">
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Mã phiếu</th>
                        <th>Ngày lập</th>
                        <th>Người lập</th>
                        <th>Kho</th>
                        <th className="text-right">Số dòng</th>
                        <th className="text-right">Đã cập nhật kho</th>
                        <th>Trạng thái</th>
                        <th style={{ width: 60 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="hoverable clickable" onClick={() => setOpenId(r.id)}>
                          <td className="font-mono font-semibold text-accent">{r.code}</td>
                          <td className="text-muted-ink whitespace-nowrap">{datetime(r.ts)}</td>
                          <td>{r.user_name || '—'}</td>
                          <td className="text-muted-ink">{r.warehouse_name}</td>
                          <td className="num">{n(r.line_count)}</td>
                          <td className="num">
                            {r.adjusted_count > 0
                              ? <span className="text-emerald-700 font-semibold">
                                  {n(r.adjusted_count)}/{n(r.line_count)}
                                </span>
                              : <span className="text-muted-ink">—</span>}
                          </td>
                          <td><Badge tone={STATUS[r.status]?.tone}>{STATUS[r.status]?.label}</Badge></td>
                          <td>
                            <IconButton icon={Eye} label={`Xem phiếu ${r.code}`} size={14}
                              onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager page={page} pageSize={pageSize} total={total}
                  onPage={setPage} onPageSize={setPageSize} />
              </div>
            )}
      </Page>

      {creating && (
        <RequisitionForm
          draft={typeof creating === 'object' ? creating : null}
          onClose={() => setCreating(false)}
          onSaved={(rq) => { setCreating(false); reload(); setOpenId(rq.id); }}
        />
      )}

      {openId && (
        <RequisitionDetail
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={reload}
        />
      )}
    </>
  );
}

/* ==================== LẬP PHIẾU ==================================== */

function RequisitionForm({ draft, onClose, onSaved }) {
  const { user, defaultWarehouse, meta, toast } = useApp();
  const { data: products } = useFetch(() => api.posProducts(), []);
  const [warehouseId, setWarehouseId] = useState(draft?.payload?.warehouse_id || defaultWarehouse || '');
  const [lines, setLines] = useState(draft?.payload?.lines || []);
  const [note, setNote] = useState(draft?.payload?.note || '');
  const [pickOpen, setPickOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [draftId, setDraftId] = useState(draft?.id || null);

  /* Gợi ý những món đang dưới định mức — đỡ phải tự nhớ */
  const { data: suggest, busy: loadingSuggest } = useFetch(
    () => api.get('/requisition-suggestions', { warehouse_id: warehouseId }),
    [warehouseId], { skip: !warehouseId });

  const add = (p, qty = 1) => {
    setPickOpen(false);
    setLines((prev) => {
      if (prev.some((l) => l.product_id === p.id)) return prev;
      return [...prev, {
        key: `${p.id}-${Date.now()}`,
        product_id: p.id, name_snapshot: p.name, sku: p.sku,
        unit_name: p.base_unit, system_qty: p.stock,
        actual_qty: '', buy_qty: Number(qty) > 0 ? Number(qty) : 0,
        supplier_ids: [],
      }];
    });
  };

  const addSuggested = () => {
    if (!suggest?.rows?.length) return;
    setLines((prev) => {
      const have = new Set(prev.map((l) => l.product_id));
      const more = suggest.rows.filter((s) => !have.has(s.product_id)).map((s) => ({
        key: `${s.product_id}-${Date.now()}`,
        product_id: s.product_id, name_snapshot: s.name_snapshot, sku: s.sku,
        unit_name: s.base_unit, system_qty: s.system_qty,
        actual_qty: '', buy_qty: s.buy_qty,
        supplier_ids: (s.suppliers || []).filter((x) => x.is_primary).map((x) => x.supplier_id),
      }));
      return [...prev, ...more];
    });
    toast(`Đã thêm ${suggest.rows.length} món đang dưới định mức`, 'ok');
  };

  const patch = (key, v) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...v } : l)));
  const drop = (key) => setLines((prev) => prev.filter((l) => l.key !== key));

  const draftPayload = () => ({
    kind: 'requisition',
    id: draftId,
    title: `Báo hết hàng · ${lines.length} món`,
    user_id: user?.id,
    item_count: lines.length,
    payload: { warehouse_id: warehouseId, lines, note },
  });

  const submit = async () => {
    if (!lines.length) { setErr('Phiếu phải có ít nhất một mặt hàng.'); return; }
    setBusy(true); setErr('');
    try {
      const rq = await api.post('/requisitions', {
        warehouse_id: warehouseId, user_id: user?.id, note,
        items: lines.map((l) => ({
          product_id: l.product_id,
          name_snapshot: l.name_snapshot,
          unit_name: l.unit_name,
          actual_qty: l.actual_qty,
          buy_qty: l.buy_qty,
          supplier_ids: l.supplier_ids,
        })),
      });
      /* Lập phiếu thật xong thì bỏ bản nháp đi, để khỏi mở nhầm lần sau */
      if (draftId) { try { await api.del(`/doc-drafts/${draftId}`); } catch { /* nháp mất rồi thì thôi */ } }
      toast(`Đã lập phiếu ${rq.code}`, 'ok');
      onSaved(rq);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title="Lập phiếu báo hết hàng"
        subtitle="Đi một vòng quầy, ghi lại món nào cạn và cần nhập thêm bao nhiêu"
        size="xl"
        footer={
          <>
            <SaveDraftButton
              build={draftPayload}
              disabled={!lines.length}
              onSaved={(d) => setDraftId(d.id)}
              className="mr-auto"
            />
            <Button onClick={onClose} disabled={busy}>Huỷ</Button>
            <Button variant="primary" icon={ClipboardList} loading={busy}
              onClick={submit} disabled={busy || !lines.length}>
              Lập phiếu ({lines.length} món)
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {err && <ErrorBox error={err} title="Chưa lập được phiếu" />}

          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Kho kiểm" required>
              <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                {meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </Field>
            <Field label="Ghi chú">
              <Input value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Ví dụ: kiểm quầy chiều thứ 7" />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon={Plus} onClick={() => setPickOpen(true)}>Chọn hàng</Button>
            {!loadingSuggest && suggest?.rows?.length > 0 && (
              <Button size="sm" variant="soft" icon={Wand2} onClick={addSuggested}>
                Thêm {n(suggest.rows.length)} món đang dưới định mức
              </Button>
            )}
            <div className="flex-1" />
            {lines.length > 0 && (
              <span className="text-2xs text-muted-ink">{lines.length} dòng</span>
            )}
          </div>

          {lines.length === 0 ? (
            <Empty icon={Search} title="Chưa chọn món nào"
              message="Bấm “Chọn hàng”, hoặc để phần mềm tự thêm những món đang dưới định mức tồn." />
          ) : (
            <div className="table-wrap max-h-[46vh] overflow-y-auto border border-line rounded-lg">
              <table className="data">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th>Mặt hàng</th>
                    <th className="text-right" style={{ width: 96 }}>Tồn máy</th>
                    <th className="text-right" style={{ width: 110 }}>Tồn thực tế</th>
                    <th className="text-right" style={{ width: 110 }}>Dự mua</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.key}>
                      <td>
                        <div className="font-medium">{l.name_snapshot}</div>
                        <div className="text-2xs text-muted-ink font-mono">{l.sku}</div>
                      </td>
                      <td className="num text-muted-ink">{fq(l.system_qty)} {l.unit_name}</td>
                      <td>
                        {/* Để TRỐNG nghĩa là chưa đếm — khác hẳn đếm được 0.
                            Quản lý sẽ không cân bằng kho cho dòng còn trống. */}
                        <QtyInput
                          value={l.actual_qty}
                          onChange={(v) => patch(l.key, { actual_qty: v })}
                          placeholder="chưa đếm"
                          aria-label={`Tồn thực tế ${l.name_snapshot}`}
                        />
                      </td>
                      <td>
                        <QtyInput value={l.buy_qty} min={0}
                          onChange={(v) => patch(l.key, { buy_qty: v })}
                          aria-label={`Số lượng dự mua ${l.name_snapshot}`} />
                      </td>
                      <td>
                        <IconButton icon={Trash2} label={`Bỏ ${l.name_snapshot}`}
                          className="!text-danger hover:!bg-red-50" onClick={() => drop(l.key)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="text-xs text-muted-ink">
            Ô <b>Tồn thực tế</b> để trống nghĩa là chưa đếm. Quản lý sẽ không cân bằng
            kho cho dòng còn trống — đếm sai rồi ghi đè vào sổ thì mất luôn số cũ.
          </div>
        </div>
      </Modal>

      <ProductPicker
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        products={products || []}
        onPick={add}
        title="Chọn hàng cần báo hết"
      />
    </>
  );
}

/* ==================== XEM VÀ DUYỆT PHIẾU ============================ */

function RequisitionDetail({ id, onClose, onChanged }) {
  const { user, can, toast } = useApp();
  const { data: rq, busy, error, reload } = useFetch(() => api.get(`/requisitions/${id}`), [id]);
  const { data: suppliers } = useFetch(() => api.suppliers({ active: 1 }), []);
  const [picked, setPicked] = useState(() => new Set());
  const [working, setWorking] = useState(false);
  const [splitResult, setSplitResult] = useState(null);

  const items = rq?.items || [];
  const allPicked = items.length > 0 && items.every((i) => picked.has(i.id));

  const toggle = (itemId) => setPicked((s) => {
    const next = new Set(s);
    if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
    return next;
  });
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(items.map((i) => i.id)));

  const patchItem = async (item, body) => {
    try {
      await api.put(`/requisitions/${id}/items/${item.id}`, body);
      reload();
      onChanged?.();
    } catch (e) { toast(e.message, 'bad', 6000); }
  };

  const adjust = async () => {
    if (!picked.size) return;
    setWorking(true);
    try {
      const res = await api.post(`/requisitions/${id}/adjust`, {
        item_ids: [...picked], user_id: user?.id,
      });
      const done = res.adjusted.filter((x) => x.diff !== 0).length;
      const same = res.adjusted.length - done;
      toast(
        `Đã cập nhật kho cho ${n(res.adjusted.length)} món`
        + (same ? ` (${n(same)} món vốn đã khớp)` : '')
        + (res.skipped.length ? ` · bỏ qua ${n(res.skipped.length)} món chưa đếm` : ''),
        res.skipped.length ? 'warn' : 'ok', 7000);
      setPicked(new Set());
      reload();
      onChanged?.();
    } catch (e) {
      toast(e.message, 'bad', 7000);
    } finally { setWorking(false); }
  };

  const split = async () => {
    setWorking(true);
    try {
      const res = await api.post(`/requisitions/${id}/split`, {
        item_ids: picked.size ? [...picked] : undefined,
        user_id: user?.id,
      });
      setSplitResult(res);
      reload();
      onChanged?.();
    } catch (e) {
      toast(e.message, 'bad', 8000);
    } finally { setWorking(false); }
  };

  const chosenCount = items.reduce((a, i) => a + (i.chosen?.length ? 1 : 0), 0);
  const buyable = items.filter((i) => Number(i.buy_qty) > 0);

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={rq ? `Phiếu báo hết hàng ${rq.code}` : 'Phiếu báo hết hàng'}
        subtitle={rq ? `${datetime(rq.ts)} · ${rq.user_name || 'không rõ người lập'} · ${rq.warehouse_name}` : ''}
        size="xl"
        footer={
          <>
            {rq && can('stock.manage') && (
              <Button
                icon={Warehouse}
                loading={working}
                onClick={adjust}
                disabled={working || !picked.size}
                title="Ghi tồn thực tế của các dòng đã tích chọn vào kho"
              >
                Cập nhật kho ({picked.size})
              </Button>
            )}
            {rq && can('purchase.manage') && (
              <Button
                variant="primary"
                icon={Truck}
                loading={working}
                onClick={split}
                disabled={working || !buyable.length}
              >
                Tạo phiếu nhập tạm
              </Button>
            )}
            <div className="flex-1" />
            <Button onClick={onClose}>Đóng</Button>
          </>
        }
      >
        {error ? <ErrorBox error={error} onRetry={reload} />
          : busy && !rq ? <Spinner />
            : rq && (
              <div className="space-y-3">
                {/* Việc cần làm, nói thẳng ra */}
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-line bg-muted p-2.5 text-[13px]">
                    <div className="font-semibold mb-0.5 flex items-center gap-1.5">
                      <Warehouse size={14} aria-hidden="true" /> Cập nhật kho
                    </div>
                    Tích chọn dòng nào tin được rồi bấm nút. <b>Chỉ những dòng được tích</b> mới
                    bị ghi đè tồn — dòng nghi ngờ cứ để đó đếm lại.
                  </div>
                  <div className="rounded-lg border border-line bg-muted p-2.5 text-[13px]">
                    <div className="font-semibold mb-0.5 flex items-center gap-1.5">
                      <Truck size={14} aria-hidden="true" /> Tạo phiếu nhập tạm
                    </div>
                    Gom hàng theo mối, mỗi mối một phiếu nhập tạm.
                    {chosenCount < buyable.length && (
                      <span className="text-danger font-semibold">
                        {' '}Còn {n(buyable.length - chosenCount)} món chưa chọn mối.
                      </span>
                    )}
                  </div>
                </div>

                {rq.adjusted_at && (
                  <div className="text-2xs text-muted-ink">
                    Lần cập nhật kho gần nhất: {datetime(rq.adjusted_at)}
                    {rq.split_at && ` · Lần tách phiếu gần nhất: ${datetime(rq.split_at)}`}
                  </div>
                )}

                <div className="table-wrap max-h-[48vh] overflow-y-auto border border-line rounded-lg">
                  <table className="data">
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <th style={{ width: 38 }}>
                          <input
                            type="checkbox"
                            checked={allPicked}
                            onChange={toggleAll}
                            aria-label="Chọn tất cả các dòng"
                          />
                        </th>
                        <th>Tên hàng hoá</th>
                        <th className="text-right" style={{ width: 88 }}>Tồn hệ thống</th>
                        <th className="text-right" style={{ width: 104 }}>Tồn thực tế</th>
                        <th className="text-right" style={{ width: 96 }}>Dự mua</th>
                        <th style={{ width: 260 }}>Nhà cung cấp có thể mua</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => {
                        const counted = it.actual_qty !== null && it.actual_qty !== undefined;
                        const diff = counted ? Number(it.actual_qty) - Number(it.system_qty) : null;
                        return (
                          <tr key={it.id} className={picked.has(it.id) ? 'bg-accent-soft/40' : ''}>
                            <td>
                              <input
                                type="checkbox"
                                checked={picked.has(it.id)}
                                onChange={() => toggle(it.id)}
                                aria-label={`Chọn ${it.name_snapshot}`}
                              />
                            </td>
                            <td>
                              <div className="font-medium">{it.name_snapshot}</div>
                              <div className="text-2xs text-muted-ink font-mono">
                                {it.sku}
                                {it.adjusted === 1 && (
                                  <span className="ml-1.5 text-emerald-700 font-sans font-semibold">
                                    · đã cập nhật kho
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="num text-muted-ink">
                              {fq(it.system_qty)}
                              {/* Tồn máy chốt lúc lập phiếu; giữa chừng tiệm vẫn bán
                                  nên số hiện giờ có thể đã khác — nói ra cho rõ. */}
                              {Number(it.stock_now) !== Number(it.system_qty) && (
                                <div className="text-2xs text-warn">nay còn {fq(it.stock_now)}</div>
                              )}
                            </td>
                            <td>
                              {rq.status === 'open' && it.adjusted !== 1 ? (
                                <QtyInput
                                  value={it.actual_qty ?? ''}
                                  placeholder="chưa đếm"
                                  onChange={(v) => patchItem(it, { actual_qty: v })}
                                  aria-label={`Tồn thực tế ${it.name_snapshot}`}
                                />
                              ) : (
                                <div className="num">{counted ? fq(it.actual_qty) : '—'}</div>
                              )}
                              {counted && diff !== 0 && (
                                <div className={`text-2xs ${diff < 0 ? 'text-danger' : 'text-emerald-700'}`}>
                                  {diff > 0 ? '+' : ''}{fq(diff)} so với máy
                                </div>
                              )}
                            </td>
                            <td>
                              {rq.status === 'open' ? (
                                <QtyInput value={it.buy_qty} min={0}
                                  onChange={(v) => patchItem(it, { buy_qty: v })}
                                  aria-label={`Dự mua ${it.name_snapshot}`} />
                              ) : <div className="num">{fq(it.buy_qty)}</div>}
                            </td>
                            <td>
                              <SupplierTags
                                item={it}
                                suppliers={suppliers || []}
                                readOnly={rq.status !== 'open'}
                                onChange={(ids) => patchItem(it, { supplier_ids: ids })}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {rq.drafts?.length > 0 && (
                  <div className="rounded-lg border border-line p-2.5">
                    <div className="font-semibold text-[13px] mb-1.5 flex items-center gap-1.5">
                      <FileText size={14} aria-hidden="true" />
                      Phiếu nhập tạm đã tạo từ phiếu này
                    </div>
                    <ul className="space-y-1">
                      {rq.drafts.map((d) => (
                        <li key={d.id} className="flex items-center gap-2 text-[13px]">
                          <span className="font-mono text-muted-ink">{d.code}</span>
                          <span className="font-medium">{d.partner_name}</span>
                          <span className="text-muted-ink">{n(d.item_count)} món</span>
                          <span className="num font-semibold ml-auto">{money(d.total)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="text-2xs text-muted-ink mt-1.5">
                      Mở ở <b>Mua hàng → Phiếu nhập hàng → Mở phiếu tạm</b> để xem lại giá rồi nhập chính thức.
                    </div>
                  </div>
                )}
              </div>
            )}
      </Modal>

      {splitResult && (
        <SplitResult result={splitResult} onClose={() => setSplitResult(null)} />
      )}
    </>
  );
}

/* ==================== CHỌN MỐI CHO TỪNG DÒNG ======================== */

/**
 * Các mối bán món này, tích chọn được nhiều.
 * Mối đã khai sẵn cho mặt hàng hiện thành nút bấm nhanh; muốn mối khác
 * thì chọn trong danh sách đầy đủ.
 */
function SupplierTags({ item, suppliers, readOnly, onChange }) {
  const chosen = new Set(item.chosen || []);
  const known = item.suppliers || [];
  const knownIds = new Set(known.map((s) => s.supplier_id));
  /* Mối được chọn nhưng chưa khai cho mặt hàng này — vẫn phải hiện ra,
     nếu không thì nhìn vào tưởng chưa chọn mối nào. */
  const extra = (item.chosen || []).filter((id) => !knownIds.has(id))
    .map((id) => suppliers.find((s) => s.id === id))
    .filter(Boolean)
    .map((s) => ({ supplier_id: s.id, name: s.name, is_primary: 0 }));

  const list = [...known, ...extra];

  const toggle = (sid) => {
    const next = new Set(chosen);
    if (next.has(sid)) next.delete(sid); else next.add(sid);
    onChange([...next]);
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {list.length === 0 && (
          <span className="text-2xs text-muted-ink italic">Chưa khai mối cho món này</span>
        )}
        {list.map((s) => (
          <button
            key={s.supplier_id}
            type="button"
            disabled={readOnly}
            onClick={() => toggle(s.supplier_id)}
            title={s.is_primary ? 'Mối ưu tiên chính' : ''}
            className={`text-2xs px-1.5 py-0.5 rounded border transition-colors duration-100
                        ${chosen.has(s.supplier_id)
                          ? 'bg-accent text-white border-accent font-semibold'
                          : 'bg-card text-muted-ink border-line hover:border-accent'}
                        ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}
          >
            {chosen.has(s.supplier_id) ? '✓ ' : ''}{s.name}
            {s.is_primary ? ' ★' : ''}
          </button>
        ))}
      </div>
      {!readOnly && (
        <Select
          size="sm"
          value=""
          onChange={(e) => e.target.value && toggle(Number(e.target.value))}
          aria-label={`Thêm nhà cung cấp cho ${item.name_snapshot}`}
        >
          <option value="">+ Mối khác...</option>
          {suppliers.filter((s) => !chosen.has(s.id)).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
      )}
    </div>
  );
}

/* ==================== KẾT QUẢ TÁCH PHIẾU ============================ */

function SplitResult({ result, onClose }) {
  return (
    <Modal
      open
      onClose={onClose}
      title="Đã tạo phiếu nhập tạm"
      subtitle={`${result.drafts.length} phiếu, gom theo từng nhà cung cấp`}
      footer={<Button variant="primary" onClick={onClose}>Xong</Button>}
    >
      <div className="space-y-3">
        <ul className="border border-line rounded-lg divide-y divide-line">
          {result.drafts.map((d) => (
            <li key={d.id} className="flex items-center gap-2 px-2.5 py-2">
              <CheckCircle2 size={15} className="text-emerald-600 shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[13px] truncate">{d.supplier_name}</div>
                <div className="text-2xs text-muted-ink font-mono">{d.code}</div>
              </div>
              <div className="text-right">
                <div className="text-[13px] font-semibold">{money(d.total)}</div>
                <div className="text-2xs text-muted-ink">{n(d.item_count)} món</div>
              </div>
            </li>
          ))}
        </ul>

        {/* Chỗ dễ mất tiền nhất, phải nói to */}
        {result.duplicated?.length > 0 && (
          <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-2.5 text-[13px] text-amber-900">
            <div className="flex items-start gap-1.5">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <b>Cẩn thận mua trùng.</b> Có {n(result.duplicated.length)} món được đưa vào
                nhiều phiếu cùng lúc, mỗi phiếu <b>đủ số lượng</b>:
                <ul className="mt-1 space-y-0.5">
                  {result.duplicated.map((d, i) => (
                    <li key={i}>
                      · {d.name} — {fq(d.qty)} ở cả {n(d.suppliers)} phiếu
                    </li>
                  ))}
                </ul>
                <div className="mt-1.5">
                  Đây là để <b>hỏi giá nhiều nơi rồi chọn một</b>. Nhập cả hai phiếu là
                  tiệm ôm gấp đôi số hàng.
                </div>
              </div>
            </div>
          </div>
        )}

        {result.no_supplier?.length > 0 && (
          <div className="rounded-lg border border-line bg-muted p-2.5 text-[13px]">
            <b>{n(result.no_supplier.length)} món chưa chọn mối</b> nên không nằm trong phiếu nào:
            <div className="text-muted-ink mt-0.5">{result.no_supplier.join(', ')}</div>
          </div>
        )}

        <div className="text-xs text-muted-ink">
          Phiếu tạm chưa đụng gì tới kho và tiền. Mở ở <b>Mua hàng → Phiếu nhập hàng →
          Mở phiếu tạm</b>, xem lại giá mối báo rồi mới lưu chính thức.
        </div>
      </div>
    </Modal>
  );
}
