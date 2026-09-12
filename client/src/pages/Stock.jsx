import { useState, useMemo, useEffect } from 'react';
import {
  Package, Download, Pencil, ClipboardCheck, Plus, ArrowLeftRight, Check,
  AlertTriangle, History, Trash2, Eye,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch } from '../lib/store';
import { money, n, qty as fq, datetime, date, MOVE_LABEL, match } from '../lib/format';
import {
  Button, IconButton, Select, Modal, Spinner, Empty, ErrorBox, Badge,
  Confirm, Field, QtyInput, Textarea, Input,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import SaveDraftButton, { OpenDraftsButton } from '../components/DraftButtons';
import { CategorySelect } from '../components/CategoryTree';
import { StockHistory } from './Products';
import { ProductPicker } from '../components/ProductPicker';

/* ==================================================================== */
/* Sửa tồn kho và kiểm kê                                                */
/*                                                                      */
/* Trang "Tồn kho" riêng đã gộp vào trang Hàng hoá & tồn kho (tài liệu   */
/* 15, mục 1). File này còn giữ hộp sửa tồn nhanh — trang gộp gọi tới —  */
/* cùng hai màn hình Kiểm kê và Chuyển kho.                              */
/* ==================================================================== */

export function AdjustModal({ product, warehouseId, warehouses, onClose, onDone }) {
  const [newQty, setNewQty] = useState(0);
  const [whId, setWhId] = useState(warehouseId);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!product) return;
    setNewQty(product.qty);
    setWhId(warehouseId);
    setNote('');
    setErr('');
  }, [product, warehouseId]);

  const diff = product ? Number(newQty) - product.qty : 0;

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.post('/stock/adjust', {
        product_id: product.id, warehouse_id: whId, new_qty: newQty, note,
      });
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!product}
      onClose={onClose}
      title="Điều chỉnh tồn kho"
      subtitle={product?.name}
      size="sm"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={submit} loading={busy} disabled={diff === 0}>
          Lưu điều chỉnh
        </Button>
      </>}
    >
      {product && (
        <div className="space-y-3">
          <p className="text-[13px] text-muted-ink">
            Dùng khi phát hiện lệch tồn do hao hụt, vỡ hỏng hoặc sai sót nhập liệu.
            Nếu kiểm đếm toàn bộ kho thì nên dùng chức năng <b>Kiểm kê</b> để có phiếu lưu lại.
          </p>

          <div className="card p-2.5 text-center">
            <div className="text-2xs font-bold text-muted-ink uppercase">Tồn hiện tại trên hệ thống</div>
            <div className="text-2xl font-display font-bold tabular mt-0.5">
              {fq(product.qty)} <span className="text-base font-normal text-muted-ink">{product.base_unit}</span>
            </div>
          </div>

          {warehouses.length > 1 && (
            <Field label="Kho" htmlFor="adj-wh">
              <Select id="adj-wh" value={whId || ''} onChange={(e) => setWhId(Number(e.target.value))}>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </Field>
          )}

          <Field label="Số lượng thực tế đếm được" required htmlFor="adj-qty">
            <QtyInput size="lg" value={newQty} onChange={setNewQty} autoFocus />
          </Field>

          {diff !== 0 && (
            <div className={`card p-2.5 text-center ${diff > 0 ? 'bg-emerald-50 border-emerald-300' : 'bg-red-50 border-danger/30'}`}>
              <div className="text-2xs font-bold uppercase text-muted-ink">Chênh lệch</div>
              <div className={`text-lg font-display font-bold tabular ${diff > 0 ? 'text-emerald-700' : 'text-danger'}`}>
                {diff > 0 ? '+' : ''}{fq(diff)} {product.base_unit}
              </div>
              <div className="text-2xs text-muted-ink">
                Giá trị {money(Math.abs(Math.round(diff * product.cost_price)))}
              </div>
            </div>
          )}

          <Field label="Lý do điều chỉnh" required htmlFor="adj-note">
            <Textarea id="adj-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Ví dụ: hàng vỡ khi vận chuyển, đếm lại phát hiện thiếu..." />
          </Field>

          {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
        </div>
      )}
    </Modal>
  );
}

/* ==================================================================== */
/* Kiểm kê kho                                                           */
/* ==================================================================== */

export function StockTakes() {
  const { toast } = useApp();
  const { data, busy, error, reload } = useFetch(() => api.stockTakes(), []);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState(null);
  const [balancing, setBalancing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busyAction, setBusyAction] = useState(false);

  const doBalance = async () => {
    setBusyAction(true);
    try {
      await api.post(`/stock-takes/${balancing.id}/balance`);
      toast(`Đã cân bằng kho theo phiếu ${balancing.code}`, 'ok');
      setBalancing(null);
      setDetail(null);
      reload();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusyAction(false);
    }
  };

  const doDelete = async () => {
    setBusyAction(true);
    try {
      await api.del(`/stock-takes/${deleting.id}`);
      toast('Đã xoá phiếu kiểm kê', 'ok');
      setDeleting(null);
      reload();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Kiểm kê kho"
        subtitle="Đếm hàng thực tế rồi cân bằng lại tồn trên hệ thống"
        actions={<>
          <OpenDraftsButton kind="stock_take" onOpen={(d) => setCreating(d)} />
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Tạo phiếu kiểm kê</Button>
        </>}
      />

      <Page>
        {busy && !data ? <Spinner />
          : error ? <ErrorBox error={error} onRetry={reload} />
            : !data?.length ? (
              <Empty
                icon={ClipboardCheck}
                title="Chưa có phiếu kiểm kê nào"
                message="Định kỳ kiểm kê để phát hiện hao hụt và giữ số liệu tồn kho đúng thực tế."
                action={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Tạo phiếu kiểm kê</Button>}
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Mã phiếu</th><th>Ngày kiểm</th><th>Kho</th><th>Người kiểm</th>
                      <th className="text-right">Số mặt hàng</th>
                      <th className="text-right">Số mặt lệch</th>
                      <th className="text-right">Giá trị lệch</th>
                      <th>Trạng thái</th>
                      <th className="text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((t) => (
                      <tr key={t.id} className="hoverable">
                        <td className="font-mono font-semibold">{t.code}</td>
                        <td className="text-muted-ink whitespace-nowrap">{datetime(t.ts)}</td>
                        <td>{t.warehouse_name}</td>
                        <td className="text-muted-ink">{t.user_name || '—'}</td>
                        <td className="num">{t.item_count}</td>
                        <td className="num">
                          {t.diff_count > 0 ? <Badge tone="warn">{t.diff_count}</Badge> : <span className="text-muted-ink">0</span>}
                        </td>
                        <td className={`num font-semibold ${t.total_diff_value < 0 ? 'text-danger' : t.total_diff_value > 0 ? 'text-emerald-700' : 'text-muted-ink'}`}>
                          {t.total_diff_value !== 0 ? money(t.total_diff_value) : '—'}
                        </td>
                        <td>
                          {t.status === 'balanced'
                            ? <Badge tone="ok"><Check size={10} aria-hidden="true" /> Đã cân bằng</Badge>
                            : <Badge tone="warn">Nháp</Badge>}
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-0.5">
                            <IconButton icon={Eye} label={`Xem ${t.code}`} size={14}
                              onClick={async () => setDetail(await api.stockTake(t.id))} />
                            {t.status !== 'balanced' && (
                              <IconButton icon={Trash2} label={`Xoá ${t.code}`} size={14}
                                className="!text-danger hover:!bg-red-50" onClick={() => setDeleting(t)} />
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </Page>

      <StockTakeForm
        open={!!creating}
        draft={typeof creating === 'object' ? creating : null}
        onClose={() => setCreating(false)}
        onSaved={(code) => { setCreating(false); reload(); toast(`Đã tạo phiếu kiểm kê ${code}`, 'ok'); }}
      />

      {/* Chi tiết phiếu kiểm kê */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `Phiếu kiểm kê ${detail.code}` : ''}
        subtitle={detail ? `${datetime(detail.ts)} · ${detail.warehouse_name}` : ''}
        size="lg"
        footer={detail && <>
          {detail.status !== 'balanced' && (
            <Button variant="primary" icon={Check} onClick={() => setBalancing(detail)}>
              Cân bằng kho theo phiếu này
            </Button>
          )}
          <div className="flex-1" />
          <Button onClick={() => setDetail(null)}>Đóng</Button>
        </>}
      >
        {detail && (
          <div className="space-y-3">
            {detail.status === 'balanced' && (
              <div className="card p-2.5 bg-emerald-50 border-emerald-300 text-[13px] flex items-center gap-2">
                <Check size={15} className="text-emerald-700" aria-hidden="true" />
                Phiếu này đã cân bằng kho. Tồn kho hệ thống đã khớp với số đếm thực tế.
              </div>
            )}
            <div className="table-wrap max-h-[50vh] overflow-y-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>Tên hàng</th><th>ĐVT</th>
                    <th className="text-right">Hệ thống</th>
                    <th className="text-right">Thực tế</th>
                    <th className="text-right">Chênh lệch</th>
                    <th className="text-right">Giá trị lệch</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((it) => (
                    <tr key={it.id} className={it.diff_qty !== 0 ? 'bg-amber-50/60' : ''}>
                      <td>
                        <div className="font-semibold">{it.product_name}</div>
                        <div className="text-2xs text-muted-ink font-mono">{it.sku}</div>
                      </td>
                      <td>{it.base_unit}</td>
                      <td className="num text-muted-ink">{fq(it.system_qty)}</td>
                      <td className="num font-semibold">{fq(it.actual_qty)}</td>
                      <td className={`num font-bold ${it.diff_qty < 0 ? 'text-danger' : it.diff_qty > 0 ? 'text-emerald-700' : 'text-muted-ink'}`}>
                        {it.diff_qty > 0 ? '+' : ''}{it.diff_qty !== 0 ? fq(it.diff_qty) : '—'}
                      </td>
                      <td className={`num ${it.diff_qty < 0 ? 'text-danger' : ''}`}>
                        {it.diff_qty !== 0 ? money(Math.round(it.diff_qty * it.unit_cost)) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} className="text-right">TỔNG GIÁ TRỊ CHÊNH LỆCH</td>
                    <td className={`num ${detail.total_diff_value < 0 ? 'text-danger' : 'text-emerald-700'}`}>
                      {money(detail.total_diff_value)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {detail.note && <div className="card p-2.5 text-[13px]"><b>Ghi chú: </b>{detail.note}</div>}
          </div>
        )}
      </Modal>

      <Confirm
        open={!!balancing}
        onClose={() => setBalancing(null)}
        onConfirm={doBalance}
        busy={busyAction}
        danger={false}
        title="Cân bằng kho theo phiếu kiểm kê?"
        confirmText="Cân bằng kho"
        message={balancing && (
          <>
            Tồn kho trên hệ thống sẽ được sửa lại đúng bằng <b>số lượng thực tế</b> đã đếm
            trong phiếu <b className="font-mono">{balancing.code}</b>.
            <br /><br />
            Mỗi mặt hàng lệch sẽ sinh một bút toán điều chỉnh trong thẻ kho.
            Thao tác này không hoàn tác được.
          </>
        )}
      />

      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={doDelete}
        busy={busyAction}
        title="Xoá phiếu kiểm kê?"
        confirmText="Xoá phiếu"
        message={deleting && <>Xoá phiếu <b className="font-mono">{deleting.code}</b>? Phiếu chưa cân bằng nên tồn kho không bị ảnh hưởng.</>}
      />
    </>
  );
}

/* -------------------------------------------------------------------- */

function StockTakeForm({ open, onClose, onSaved, draft = null }) {
  const { meta, user, defaultWarehouse } = useApp();
  const [warehouseId, setWarehouseId] = useState(defaultWarehouse);
  const [lines, setLines] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [draftId, setDraftId] = useState(null);

  useEffect(() => {
    if (!open) return;
    const p = draft?.payload;
    setDraftId(draft?.id || null);
    if (!p) return;
    setWarehouseId(p.warehouse_id || defaultWarehouse);
    setLines(p.lines || []);
    setNote(p.note || '');
  }, [open, draft, defaultWarehouse]);

  const { data: products } = useFetch(
    () => api.posProducts({ warehouse_id: warehouseId }), [warehouseId], { skip: !open }
  );

  useEffect(() => {
    if (!open) return;
    setLines([]); setNote(''); setErr('');
    setWarehouseId(defaultWarehouse);
  }, [open, defaultWarehouse]);

  /* Kiểm kê: con số gõ ở hộp chọn là TỒN ĐẾM ĐƯỢC, không phải "thêm bao
     nhiêu dòng". Đếm được bao nhiêu thì điền thẳng vào luôn cho nhanh. */
  const addProduct = (p, counted) => {
    const actual = counted === undefined || counted === null || counted === ''
      ? p.stock : Number(counted);
    setLines((prev) => prev.some((l) => l.product_id === p.id)
      ? prev
      : [...prev, {
          product_id: p.id, sku: p.sku, name: p.name, base_unit: p.base_unit,
          system_qty: p.stock, actual_qty: Number.isNaN(actual) ? p.stock : actual,
          cost_price: p.cost_price,
        }]);
  };

  const addAll = () => {
    if (!products) return;
    setLines(products.filter((p) => p.track_stock).map((p) => ({
      product_id: p.id, sku: p.sku, name: p.name, base_unit: p.base_unit,
      system_qty: p.stock, actual_qty: p.stock, cost_price: p.cost_price,
    })));
  };

  const setActual = (id, v) => setLines((prev) =>
    prev.map((l) => l.product_id === id ? { ...l, actual_qty: v } : l));

  const diffValue = useMemo(() => lines.reduce(
    (a, l) => a + Math.round(((Number(l.actual_qty) || 0) - l.system_qty) * l.cost_price), 0), [lines]);
  const diffCount = useMemo(() => lines.filter(
    (l) => (Number(l.actual_qty) || 0) !== l.system_qty).length, [lines]);

  const submit = async () => {
    if (!lines.length) { setErr('Phải chọn ít nhất 1 mặt hàng để kiểm kê.'); return; }
    setBusy(true);
    setErr('');
    try {
      const res = await api.post('/stock-takes', {
        warehouse_id: warehouseId, user_id: user?.id, note,
        items: lines.map((l) => ({ product_id: l.product_id, actual_qty: Number(l.actual_qty) || 0 })),
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
        title="Tạo phiếu kiểm kê"
        subtitle="Nhập số lượng đếm được thực tế. Phiếu lưu ở dạng nháp, cân bằng kho sau."
        size="xl"
        footer={<>
          <SaveDraftButton
            className="mr-auto"
            disabled={!lines.length}
            onSaved={(d) => setDraftId(d.id)}
            build={() => ({
              kind: 'stock_take',
              id: draftId,
              title: `Kiểm kê · ${lines.length} món`,
              total: 0,
              item_count: lines.length,
              payload: { warehouse_id: warehouseId, lines, note },
            })}
          />
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!lines.length}>
            Lưu phiếu kiểm kê
          </Button>
        </>}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Kho kiểm kê" className="w-48">
              <Select value={warehouseId || ''} onChange={(e) => setWarehouseId(Number(e.target.value))}>
                {meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </Field>
            <Button icon={Plus} onClick={() => setPickerOpen(true)}>Chọn từng mặt hàng</Button>
            <Button icon={ClipboardCheck} onClick={addAll}>Kiểm kê toàn bộ kho</Button>
            <div className="flex-1" />
            {lines.length > 0 && (
              <div className="text-[13px] text-right">
                <div><b>{lines.length}</b> mặt hàng · <b>{diffCount}</b> mặt lệch</div>
                <div className={diffValue < 0 ? 'text-danger font-semibold' : diffValue > 0 ? 'text-emerald-700 font-semibold' : 'text-muted-ink'}>
                  Giá trị lệch: {money(diffValue)}
                </div>
              </div>
            )}
          </div>

          {lines.length === 0 ? (
            <Empty
              icon={ClipboardCheck}
              title="Chưa chọn hàng để kiểm"
              message="Bấm Kiểm kê toàn bộ kho để nạp hết danh mục, hoặc chọn từng mặt hàng cần đếm."
            />
          ) : (
            <div className="table-wrap max-h-[45vh] overflow-y-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>Mã hàng</th><th>Tên hàng</th><th>ĐVT</th>
                    <th className="text-right">Hệ thống</th>
                    <th style={{ width: 110 }} className="text-right">Thực tế đếm</th>
                    <th className="text-right">Lệch</th>
                    <th className="text-right">Giá trị lệch</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const diff = (Number(l.actual_qty) || 0) - l.system_qty;
                    return (
                      <tr key={l.product_id} className={diff !== 0 ? 'bg-amber-50/60' : ''}>
                        <td className="font-mono text-muted-ink">{l.sku}</td>
                        <td className="font-semibold">{l.name}</td>
                        <td>{l.base_unit}</td>
                        <td className="num text-muted-ink">{fq(l.system_qty)}</td>
                        <td>
                          <QtyInput value={l.actual_qty} onChange={(v) => setActual(l.product_id, v)}
                            aria-label={`Số lượng thực tế của ${l.name}`} />
                        </td>
                        <td className={`num font-bold ${diff < 0 ? 'text-danger' : diff > 0 ? 'text-emerald-700' : 'text-muted-ink'}`}>
                          {diff > 0 ? '+' : ''}{diff !== 0 ? fq(diff) : '—'}
                        </td>
                        <td className={`num ${diff < 0 ? 'text-danger' : ''}`}>
                          {diff !== 0 ? money(Math.round(diff * l.cost_price)) : '—'}
                        </td>
                        <td>
                          <IconButton icon={Trash2} label={`Bỏ ${l.name}`} size={14}
                            className="!text-danger hover:!bg-red-50"
                            onClick={() => setLines((p) => p.filter((x) => x.product_id !== l.product_id))} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <Field label="Ghi chú">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Ví dụ: kiểm kê định kỳ cuối tháng 9" />
          </Field>

          {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
        </div>
      </Modal>

      <ProductPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        products={(products || []).filter((p) => p.track_stock)}
        onPick={addProduct}
        title="Chọn hàng cần kiểm kê"
      />
    </>
  );
}

/* ==================================================================== */
/* Chuyển kho                                                            */
/* ==================================================================== */

export function StockTransfers() {
  const { toast, meta, user } = useApp();
  const { data, busy, error, reload } = useFetch(() => api.stockTransfers(), []);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState(null);

  return (
    <>
      <PageHeader
        title="Chuyển kho"
        subtitle="Điều chuyển hàng giữa kho cửa hàng và kho phụ"
        actions={
          <>
            <OpenDraftsButton kind="stock_transfer" onOpen={(d) => setCreating(d)} />
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}
              disabled={meta.warehouses.length < 2}>
              Tạo phiếu chuyển kho
            </Button>
          </>
        }
      />

      <Page>
        {meta.warehouses.length < 2 && (
          <div className="card-pad mb-3 bg-amber-50 border-warn/30 text-[13px] flex gap-2.5">
            <AlertTriangle size={16} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-semibold text-warn">Cần ít nhất 2 kho</p>
              <p className="text-amber-900/80 mt-0.5">
                Vào <b>Thiết lập → Kho hàng</b> để thêm kho thứ hai trước khi chuyển kho.
              </p>
            </div>
          </div>
        )}

        {busy && !data ? <Spinner />
          : error ? <ErrorBox error={error} onRetry={reload} />
            : !data?.length ? (
              <Empty
                icon={ArrowLeftRight}
                title="Chưa có phiếu chuyển kho"
                message="Dùng khi lấy hàng từ kho phụ ra trưng bày, hoặc cất bớt hàng vào kho."
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Mã phiếu</th><th>Ngày</th><th>Từ kho</th><th>Đến kho</th>
                      <th className="text-right">Số mặt hàng</th><th>Người lập</th><th>Ghi chú</th>
                      <th className="text-right">Xem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((t) => (
                      <tr key={t.id} className="hoverable">
                        <td className="font-mono font-semibold">{t.code}</td>
                        <td className="text-muted-ink whitespace-nowrap">{datetime(t.ts)}</td>
                        <td>{t.from_name}</td>
                        <td>{t.to_name}</td>
                        <td className="num">{t.item_count}</td>
                        <td className="text-muted-ink">{t.user_name || '—'}</td>
                        <td className="text-muted-ink truncate max-w-[200px]">{t.note || '—'}</td>
                        <td className="text-right">
                          <IconButton icon={Eye} label={`Xem ${t.code}`} size={14}
                            onClick={async () => setDetail(await api.get(`/stock-transfers/${t.id}`))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </Page>

      <TransferForm
        open={!!creating}
        draft={typeof creating === 'object' ? creating : null}
        onClose={() => setCreating(false)}
        onSaved={(code) => { setCreating(false); reload(); toast(`Đã tạo phiếu chuyển kho ${code}`, 'ok'); }}
      />

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `Phiếu chuyển kho ${detail.code}` : ''}
        subtitle={detail ? `${detail.from_name} → ${detail.to_name} · ${datetime(detail.ts)}` : ''}
        size="md"
        footer={<Button onClick={() => setDetail(null)}>Đóng</Button>}
      >
        {detail && (
          <table className="data">
            <thead>
              <tr><th>Mã hàng</th><th>Tên hàng</th><th>ĐVT</th><th className="text-right">Số lượng</th></tr>
            </thead>
            <tbody>
              {detail.items.map((it) => (
                <tr key={it.id}>
                  <td className="font-mono text-muted-ink">{it.sku}</td>
                  <td className="font-semibold">{it.product_name}</td>
                  <td>{it.base_unit}</td>
                  <td className="num font-semibold">{fq(it.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>
    </>
  );
}

/* -------------------------------------------------------------------- */

function TransferForm({ open, onClose, onSaved, draft = null }) {
  const { meta, user, defaultWarehouse } = useApp();
  const [fromId, setFromId] = useState(defaultWarehouse);
  const [toId, setToId] = useState(null);
  const [lines, setLines] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [draftId, setDraftId] = useState(null);

  useEffect(() => {
    if (!open) return;
    const p = draft?.payload;
    setDraftId(draft?.id || null);
    if (!p) return;
    setFromId(p.from_id || defaultWarehouse);
    setToId(p.to_id ?? null);
    setLines(p.lines || []);
    setNote(p.note || '');
  }, [open, draft, defaultWarehouse]);

  const { data: products } = useFetch(
    () => api.posProducts({ warehouse_id: fromId }), [fromId], { skip: !open }
  );

  useEffect(() => {
    if (!open) return;
    setLines([]); setNote(''); setErr('');
    setFromId(defaultWarehouse);
    setToId(meta.warehouses.find((w) => w.id !== defaultWarehouse)?.id || null);
  }, [open, defaultWarehouse, meta.warehouses]);

  const addProduct = (p, qty = 1) => {
    const add = Number(qty) > 0 ? Number(qty) : 1;
    setLines((prev) => prev.some((l) => l.product_id === p.id)
      ? prev.map((l) => l.product_id === p.id ? { ...l, qty: l.qty + add } : l)
      : [...prev, {
          product_id: p.id, sku: p.sku, name: p.name,
          base_unit: p.base_unit, qty: add, stock: p.stock,
        }]);
  };

  const submit = async () => {
    if (!lines.length) { setErr('Phải chọn ít nhất 1 mặt hàng.'); return; }
    if (fromId === toId) { setErr('Kho nguồn và kho đích phải khác nhau.'); return; }
    setBusy(true);
    setErr('');
    try {
      const res = await api.post('/stock-transfers', {
        from_warehouse_id: fromId, to_warehouse_id: toId, user_id: user?.id, note,
        items: lines.map((l) => ({ product_id: l.product_id, qty: l.qty })),
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
        title="Tạo phiếu chuyển kho"
        size="lg"
        footer={<>
          <SaveDraftButton
            className="mr-auto"
            disabled={!lines.length}
            onSaved={(d) => setDraftId(d.id)}
            build={() => ({
              kind: 'stock_transfer',
              id: draftId,
              title: `Chuyển kho · ${lines.length} món`,
              total: 0,
              item_count: lines.length,
              payload: { from_id: fromId, to_id: toId, lines, note },
            })}
          />
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!lines.length}>
            Lưu phiếu chuyển kho
          </Button>
        </>}
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Chuyển từ kho" required>
              <Select value={fromId || ''} onChange={(e) => setFromId(Number(e.target.value))}>
                {meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </Field>
            <Field label="Chuyển đến kho" required>
              <Select value={toId || ''} onChange={(e) => setToId(Number(e.target.value))}>
                {meta.warehouses.filter((w) => w.id !== fromId).map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="flex items-center justify-between">
            <span className="label !mb-0">Hàng chuyển ({lines.length})</span>
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setPickerOpen(true)}>Chọn hàng</Button>
          </div>

          {lines.length === 0 ? (
            <Empty icon={ArrowLeftRight} title="Chưa chọn hàng" message="Bấm Chọn hàng để thêm mặt hàng cần chuyển." />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Mã hàng</th><th>Tên hàng</th><th>ĐVT</th>
                    <th className="text-right">Tồn kho nguồn</th>
                    <th style={{ width: 110 }} className="text-right">Số lượng chuyển</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.product_id}>
                      <td className="font-mono text-muted-ink">{l.sku}</td>
                      <td className="font-semibold">{l.name}</td>
                      <td>{l.base_unit}</td>
                      <td className="num text-muted-ink">{fq(l.stock)}</td>
                      <td>
                        <QtyInput
                          value={l.qty}
                          onChange={(v) => setLines((p) => p.map((x) =>
                            x.product_id === l.product_id ? { ...x, qty: v } : x))}
                          max={l.stock}
                          aria-label={`Số lượng chuyển ${l.name}`}
                        />
                        {l.qty > l.stock && <div className="text-2xs text-danger font-semibold">Vượt tồn</div>}
                      </td>
                      <td>
                        <IconButton icon={Trash2} label={`Bỏ ${l.name}`} size={14}
                          className="!text-danger hover:!bg-red-50"
                          onClick={() => setLines((p) => p.filter((x) => x.product_id !== l.product_id))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Field label="Ghi chú">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
        </div>
      </Modal>

      <ProductPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        products={(products || []).filter((p) => p.track_stock && p.stock > 0)}
        onPick={addProduct}
        title="Chọn hàng cần chuyển kho"
      />
    </>
  );
}
