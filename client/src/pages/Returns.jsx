import { useState, useMemo, useEffect } from 'react';
import {
  Undo2, Eye, Plus, Trash2, AlertTriangle, PackagePlus, FileSearch, ArrowLeftRight, Wallet, Banknote,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, usePaged, useDebounced } from '../lib/store';
import { money, n, short, qty as fq, datetime, date, range, RANGES, match } from '../lib/format';
import {
  Button, IconButton, Select, Modal, Spinner, Empty, ErrorBox, Badge, Stat,
  Field, MoneyInput, Textarea, Combo, QtyInput, Pager, Input, SearchInput,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import SaveDraftButton, { OpenDraftsButton } from '../components/DraftButtons';
import CartPickerModal, { CartPickerButton } from '../components/CartPickerModal';

/* ==================================================================== */
/* Khách trả hàng — danh sách                                            */
/* ==================================================================== */

export function SaleReturns() {
  const [rangeKey, setRangeKey] = useState('day30');
  const r = useMemo(() => range(rangeKey), [rangeKey]);
  const {
    rows: data, extra, total: rowCount, busy, error, reload,
    page, setPage, pageSize, setPageSize,
  } = usePaged((pg) => api.saleReturns({ from: r.from, to: r.to, ...pg }), [r.from, r.to],
    { key: 'sale-returns' });
  const [detail, setDetail] = useState(null);

  const totals = extra?.totals || null;

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
              <div className="card">
              <div className="table-wrap table-scroll !border-0 !rounded-none">
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
              <Pager
                page={page}
                pageSize={pageSize}
                total={rowCount}
                onPage={setPage}
                onPageSize={setPageSize}
              />
              </div>
            )}
      </Page>

      <ReturnDetail detail={detail} onClose={() => setDetail(null)} kind="sale" />
    </>
  );
}

/* ==================================================================== */
/* Trả hàng nhà cung cấp — danh sách + form lập phiếu (tài liệu 11)      */
/* ==================================================================== */

export function PurchaseReturns() {
  const { toast } = useApp();
  const [rangeKey, setRangeKey] = useState('day30');
  const r = useMemo(() => range(rangeKey), [rangeKey]);
  const {
    rows: data, extra, total: rowCount, busy, error, reload,
    page, setPage, pageSize, setPageSize,
  } = usePaged((pg) => api.purchaseReturns({ from: r.from, to: r.to, ...pg }), [r.from, r.to],
    { key: 'purchase-returns' });
  const [detail, setDetail] = useState(null);
  const [creating, setCreating] = useState(false);

  const totals = extra?.totals || null;

  return (
    <>
      <PageHeader
        title="Trả hàng nhà cung cấp"
        subtitle={`${r.label} · Hàng lỗi, sai quy cách, giao nhầm trả lại cho mối`}
        actions={
          <>
            <OpenDraftsButton kind="purchase_return" onOpen={(d) => setCreating(d)} />
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
              Lập phiếu trả hàng
            </Button>
          </>
        }
      >
        <Select value={rangeKey} onChange={(e) => setRangeKey(e.target.value)} size="sm" className="!w-auto">
          {RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </PageHeader>

      <Page className="space-y-3">
        {totals && (
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
            <Stat label="Số phiếu trả" value={n(totals.count)} icon={Undo2} />
            <Stat label="Tiền NCC trừ nợ / hoàn" value={short(totals.total)} />
            <Stat label="Chi phí trả hàng" value={short(totals.expense || 0)} tone={totals.expense > 0 ? 'warn' : 'default'} />
            <Stat label="NCC đã hoàn tiền" value={short(totals.refunded)} tone="good" />
          </div>
        )}

        {busy && !data ? <Spinner />
          : error ? <ErrorBox error={error} onRetry={reload} />
            : !data?.length ? (
              <Empty
                icon={Undo2}
                title="Chưa có phiếu trả hàng NCC"
                message="Khi nhận hàng lỗi, sai quy cách hoặc giao nhầm, lập phiếu trả để trừ tồn kho và giảm công nợ."
                action={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Lập phiếu trả hàng</Button>}
              />
            ) : (
              <div className="card">
              <div className="table-wrap table-scroll !border-0 !rounded-none">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Mã phiếu</th><th>Ngày</th><th>Nhà cung cấp</th><th>Cách trả</th>
                      <th className="text-right">Giá trị hàng</th>
                      <th className="text-right">Chi phí</th>
                      <th className="text-right">NCC trừ nợ / hoàn</th>
                      <th className="text-right">NCC hoàn tiền</th>
                      <th className="text-right">Xem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((x) => (
                      <tr key={x.id} className="hoverable">
                        <td className="font-mono font-semibold">
                          {x.code}
                          {x.custom_count > 0 && <Badge tone="bad" className="ml-1">Có hàng ngoài hệ thống</Badge>}
                        </td>
                        <td className="text-muted-ink whitespace-nowrap">{datetime(x.ts)}</td>
                        <td>{x.supplier_name || '—'}</td>
                        <td className="text-muted-ink">
                          {x.purchase_code ? <>Theo phiếu <span className="font-mono">{x.purchase_code}</span></> : 'Trả tự do'}
                        </td>
                        <td className="num">{money(x.subtotal ?? x.total)}</td>
                        <td className="num text-muted-ink">{x.expense > 0 ? `-${money(x.expense)}` : '—'}</td>
                        <td className="num font-semibold">{money(x.total)}</td>
                        <td className="num">{money(x.refunded)}</td>
                        <td className="text-right">
                          <IconButton icon={Eye} label={`Xem ${x.code}`} size={14}
                            onClick={async () => setDetail(await api.get(`/purchase-returns/${x.id}`))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager
                page={page}
                pageSize={pageSize}
                total={rowCount}
                onPage={setPage}
                onPageSize={setPageSize}
              />
              </div>
            )}
      </Page>

      <ReturnDetail detail={detail} onClose={() => setDetail(null)} kind="purchase" />

      <PurchaseReturnForm
        open={!!creating}
        draft={typeof creating === 'object' ? creating : null}
        onClose={() => setCreating(false)}
        onSaved={(code) => { setCreating(false); reload(); toast(`Đã lập phiếu trả hàng ${code}`, 'ok'); }}
      />
    </>
  );
}

/* -------------------------------------------------------------------- */

function ReturnDetail({ detail, onClose, kind }) {
  const purchase = kind === 'purchase';
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
              <div className="text-2xs font-bold text-muted-ink uppercase">{purchase ? 'Cách trả' : 'Chứng từ gốc'}</div>
              <div className="font-mono font-semibold">
                {purchase
                  ? (detail.purchase_code ? `Theo phiếu ${detail.purchase_code}` : 'Trả tự do')
                  : (detail.sale_code || '—')}
              </div>
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
                {(detail.custom_items || []).map((c) => (
                  <tr key={`c${c.id}`} className="bg-red-50/40">
                    <td>
                      <div className="font-semibold">{c.name}</div>
                      <Badge tone="bad">{c.custom_item_id ? 'Hàng giao sai' : 'Ngoài hệ thống'} · không trừ kho</Badge>
                    </td>
                    <td>{c.unit_name || '—'}</td>
                    <td className="num">{fq(c.qty)}</td>
                    <td className="num">{money(c.price)}</td>
                    <td className="num font-semibold">{money(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <div className="w-full sm:w-72 space-y-1 text-[13px]">
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
              {detail.expense > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-ink">
                    Chi phí trả hàng{detail.expense_note && <span className="block text-2xs">{detail.expense_note}</span>}
                  </span>
                  <span className="tabular font-mono">-{money(detail.expense)}</span>
                </div>
              )}
              <div className="flex justify-between pt-1.5 border-t border-line font-bold">
                <span>{purchase ? 'NCC trừ nợ / hoàn' : 'Tổng cộng'}</span>
                <span className="tabular font-mono">{money(detail.total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-ink">{kind === 'sale' ? 'Đã hoàn khách' : 'NCC hoàn tiền mặt'}</span>
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

const REASONS = ['Hàng giao bị lỗi', 'Sai quy cách đặt hàng', 'NCC giao nhầm hàng', 'Bao bì hư hỏng', 'Giao thừa so với đơn đặt', 'Lý do khác'];
const MODES = [
  { key: 'by_purchase', label: 'Trả theo phiếu nhập gốc', icon: FileSearch, hint: 'Khoá số lượng và đơn giá theo phiếu đã nhập' },
  { key: 'free', label: 'Trả tự do', icon: ArrowLeftRight, hint: 'Hàng gom nhiều đợt, giá thoả thuận với NCC' },
];
const lineValue = (qty, price) => Math.round((Number(qty) || 0) * (Number(price) || 0));

/**
 * Lập phiếu trả hàng NCC.
 * @param purchaseId  mở thẳng luồng "theo phiếu nhập gốc" với phiếu này
 * @param draft       phiếu tạm mở lại
 */
export function PurchaseReturnForm({ open, onClose, onSaved, draft = null, purchaseId = null }) {
  const { meta, user, defaultWarehouse } = useApp();
  const [mode, setMode] = useState('by_purchase');
  const [supplierId, setSupplierId] = useState(null);
  const [warehouseId, setWarehouseId] = useState(defaultWarehouse);
  /* Theo phiếu nhập gốc */
  const [purchase, setPurchase] = useState(null);
  const [loadingPurchase, setLoadingPurchase] = useState(false);
  const [pq, setPq] = useState('');
  const dpq = useDebounced(pq, 250);
  const [qtys, setQtys] = useState({});             // purchase_item_id -> số trả
  const [customQtys, setCustomQtys] = useState({}); // custom_item_id -> số trả
  /* Trả tự do */
  const [lines, setLines] = useState([]);
  const [freeCustom, setFreeCustom] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  /* Tiền */
  const [expense, setExpense] = useState(0);
  const [expenseNote, setExpenseNote] = useState('');
  const [settle, setSettle] = useState('debt');      // debt | cash
  const [refunded, setRefunded] = useState(0);
  const [accountId, setAccountId] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [draftId, setDraftId] = useState(null);

  const loadPurchase = async (id, prefill = true) => {
    setLoadingPurchase(true);
    setErr('');
    try {
      const d = await api.purchase(id);
      if (d.status !== 'done') { setErr(`Phiếu ${d.code} đã huỷ, không trả hàng theo phiếu này được.`); return; }
      setPurchase(d);
      setSupplierId(d.supplier_id);
      setWarehouseId(d.warehouse_id);
      if (prefill) {
        setQtys({});
        /* Hàng giao sai của phiếu gốc hiện sẵn đủ số còn phải trả (tài liệu 11) */
        setCustomQtys(Object.fromEntries(
          (d.custom_items || []).filter((c) => c.returnable_qty > 0).map((c) => [c.id, c.returnable_qty])));
        if (d.custom_items?.some((c) => c.returnable_qty > 0)) setReason((r) => r || 'NCC giao nhầm hàng');
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoadingPurchase(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const p = draft?.payload;
    setDraftId(draft?.id || null);
    setErr('');
    /* Phiếu tạm của bản cũ chỉ có dòng hàng tự do */
    setMode(p?.mode || (p?.lines?.length ? 'free' : 'by_purchase'));
    setSupplierId(p?.supplier_id ?? null);
    setWarehouseId(p?.warehouse_id || defaultWarehouse);
    setPurchase(null);
    setPq('');
    setQtys(p?.qtys || {});
    setCustomQtys(p?.custom_qtys || {});
    setLines(p?.lines || []);
    setFreeCustom(p?.custom || []);
    setExpense(p?.expense || 0);
    setExpenseNote(p?.expense_note || '');
    setSettle(p?.refunded > 0 ? 'cash' : 'debt');
    setRefunded(p?.refunded || 0);
    setReason(p?.reason || '');
    setNote(p?.note || '');
    setAccountId(meta.accounts?.[0]?.id || '');
    const pid = purchaseId || p?.purchase_id;
    if (pid) loadPurchase(pid, !p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft, purchaseId]);

  const { data: suppliers } = useFetch(() => api.suppliers({ active: 1 }), [], { skip: !open });
  const { data: products } = useFetch(
    () => api.posProducts({ warehouse_id: warehouseId }), [warehouseId], { skip: !open || mode !== 'free' });
  const { data: found, busy: finding } = useFetch(
    () => api.purchases({ q: dpq, supplier_id: supplierId || '', status: 'done', page_size: 30 }),
    [dpq, supplierId], { skip: !open || mode !== 'by_purchase' || !!purchase });

  const addProduct = (p, qty = 1) => {
    const add = Number(qty) > 0 ? Number(qty) : 1;
    const unit = p.units.find((u) => u.factor === 1) || p.units[0];
    const key = `${p.id}:${unit.id}`;
    setLines((prev) => prev.some((l) => l.key === key)
      ? prev.map((l) => l.key === key ? { ...l, qty: l.qty + add } : l)
      : [...prev, {
          key, product_id: p.id, sku: p.sku, name: p.name, base_unit: p.base_unit,
          units: p.units, unit_id: unit.id, unit_name: unit.unit_name, factor: unit.factor,
          qty: add, price: Math.round((p.cost_price || 0) * unit.factor), stock: p.stock,
        }]);
  };
  const updateLine = (key, patch) => setLines((prev) => prev.map((l) => l.key === key ? { ...l, ...patch } : l));
  const removeLine = (key) => setLines((prev) => prev.filter((l) => l.key !== key));
  const patchCustom = (i, patch) => setFreeCustom((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  /* ---------------------------- Tính tiền ---------------------------- */
  const byItems = purchase ? purchase.items.map((it) => ({ ...it, rqty: Number(qtys[it.id]) || 0 })) : [];
  const byCustom = purchase ? (purchase.custom_items || []).map((c) => ({ ...c, rqty: Number(customQtys[c.id]) || 0 })) : [];
  const stockValue = mode === 'by_purchase'
    ? byItems.reduce((a, l) => a + lineValue(l.rqty, l.net_price), 0)
    : lines.reduce((a, l) => a + lineValue(l.qty, l.price), 0);
  const customValue = mode === 'by_purchase'
    ? byCustom.reduce((a, c) => a + lineValue(c.rqty, c.price), 0)
    : freeCustom.reduce((a, c) => a + lineValue(c.qty, c.price), 0);
  const subtotal = stockValue + customValue;
  const exp = Math.max(0, Math.round(Number(expense) || 0));
  const total = subtotal - exp;
  const lineCount = mode === 'by_purchase'
    ? byItems.filter((l) => l.rqty > 0).length + byCustom.filter((c) => c.rqty > 0).length
    : lines.length + freeCustom.length;

  useEffect(() => { if (settle === 'cash') setRefunded(Math.max(0, total)); }, [settle, total]);

  const submit = async () => {
    setErr('');
    if (mode === 'by_purchase') {
      if (!purchase) { setErr('Chọn phiếu nhập gốc cần trả hàng.'); return; }
      if (!lineCount) { setErr('Ghi số lượng trả cho ít nhất một dòng hàng.'); return; }
    } else {
      if (!supplierId) { setErr('Chọn nhà cung cấp nhận hàng trả.'); return; }
      if (!lineCount) { setErr('Chọn ít nhất một mặt hàng để trả.'); return; }
      if (freeCustom.some((c) => !String(c.name || '').trim() || !(Number(c.qty) > 0))) {
        setErr('Hàng ngoài hệ thống phải có tên và số lượng lớn hơn 0.'); return;
      }
    }
    if (exp > subtotal) { setErr('Chi phí trả hàng không được lớn hơn giá trị hàng trả.'); return; }

    const body = mode === 'by_purchase' ? {
      purchase_id: purchase.id,
      items: byItems.filter((l) => l.rqty > 0).map((l) => ({ purchase_item_id: l.id, qty: l.rqty })),
      custom_items: byCustom.filter((c) => c.rqty > 0).map((c) => ({ custom_item_id: c.id, qty: c.rqty })),
    } : {
      supplier_id: supplierId,
      items: lines.map((l) => ({
        product_id: l.product_id, unit_name: l.unit_name, factor: l.factor, qty: l.qty, price: l.price,
      })),
      custom_items: freeCustom.map((c) => ({
        name: c.name.trim(), unit_name: c.unit_name || null, qty: Number(c.qty), price: Math.round(Number(c.price) || 0),
      })),
    };

    setBusy(true);
    try {
      const res = await api.post('/purchase-returns', {
        ...body,
        warehouse_id: warehouseId,
        user_id: user?.id,
        expense: exp,
        expense_note: expenseNote.trim() || null,
        refunded: settle === 'cash' ? Math.min(refunded, Math.max(0, total)) : 0,
        account_id: accountId,
        reason, note,
      });
      /* Lưu chính thức xong thì bỏ bản nháp đi, để lần sau khỏi mở nhầm
         một phiếu đã lập rồi mà lập thêm lần nữa. */
      if (draftId) {
        try { await api.del(`/doc-drafts/${draftId}`); }
        catch { /* nháp mất rồi thì thôi, phiếu chính đã lưu xong */ }
      }
      onSaved?.(res.code, res);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const supplierName = suppliers?.find((x) => x.id === supplierId)?.name || purchase?.supplier_name;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Lập phiếu trả hàng nhà cung cấp"
        subtitle="Hàng chuẩn trừ tồn kho · hàng giao sai và hàng ngoài hệ thống không đụng kho · công nợ NCC giảm ngay"
        size="xl"
        footer={<>
          <SaveDraftButton
            className="mr-auto"
            disabled={!lineCount && !purchase}
            onSaved={(d) => setDraftId(d.id)}
            build={() => ({
              kind: 'purchase_return',
              id: draftId,
              title: supplierName ? `Trả hàng ${supplierName}` : 'Trả hàng nhà cung cấp',
              partner_name: supplierName || null,
              total,
              item_count: lineCount,
              payload: {
                mode, purchase_id: purchase?.id || null, supplier_id: supplierId, warehouse_id: warehouseId,
                qtys, custom_qtys: customQtys, lines, custom: freeCustom,
                expense: exp, expense_note: expenseNote, refunded: settle === 'cash' ? refunded : 0, reason, note,
              },
            })}
          />
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!lineCount}>
            Hoàn tất trả hàng
          </Button>
        </>}
      >
        <div className="space-y-3">
          {/* ---------------- Chọn luồng ---------------- */}
          <div role="radiogroup" aria-label="Cách trả hàng" className="grid gap-1.5 sm:grid-cols-2">
            {MODES.map((m) => {
              const on = mode === m.key;
              const Icon = m.icon;
              return (
                <label key={m.key}
                  className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer transition-colors duration-150
                              focus-within:ring-2 focus-within:ring-accent/40
                              ${on ? 'border-accent bg-accent-soft' : 'border-line hover:bg-muted'}`}>
                  <input type="radio" name="prf-mode" value={m.key} checked={on} className="sr-only"
                    onChange={() => { setMode(m.key); setErr(''); }} />
                  <Icon size={18} className={on ? 'text-emerald-800 mt-0.5' : 'text-muted-ink mt-0.5'} aria-hidden="true" />
                  <span>
                    <span className="block text-[13px] font-bold">{m.label}</span>
                    <span className="block text-2xs text-muted-ink">{m.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>

          {mode === 'by_purchase' ? (
            !purchase ? (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Lọc theo nhà cung cấp">
                    <Combo
                      items={suppliers || []}
                      value={supplierId}
                      onChange={setSupplierId}
                      placeholder="Tất cả nhà cung cấp"
                      filter={(s, q) => match(s.name, q) || (s.phone || '').includes(q)}
                      render={(s) => ({ label: s.name, sub: s.phone })}
                    />
                  </Field>
                  <Field label="Tìm phiếu nhập">
                    <SearchInput value={pq} onChange={setPq} placeholder="Mã phiếu, tên NCC, số hoá đơn..." />
                  </Field>
                </div>
                {loadingPurchase ? <Spinner label="Đang mở phiếu nhập..." />
                  : finding && !found ? <Spinner />
                    : !(found?.rows || []).length ? (
                      <Empty icon={FileSearch} title="Không tìm thấy phiếu nhập" message="Gõ mã phiếu hoặc chọn nhà cung cấp khác." />
                    ) : (
                      <ul className="divide-y divide-line border border-line rounded max-h-72 overflow-y-auto">
                        {found.rows.map((p) => (
                          <li key={p.id}>
                            <button type="button" onClick={() => loadPurchase(p.id)}
                              className="w-full text-left px-2.5 py-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 hover:bg-muted
                                         cursor-pointer transition-colors duration-100 focus-visible:bg-muted focus-visible:outline-none">
                              <span className="font-mono font-semibold">{p.code}</span>
                              <span className="text-[13px] text-muted-ink">{date(p.ts)}</span>
                              <span className="text-[13px] flex-1 min-w-0 truncate">{p.supplier_name || '—'}</span>
                              {p.custom_count > 0 && <Badge tone="bad">Có hàng giao sai</Badge>}
                              <span className="tabular font-semibold text-[13px]">{money(p.total)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="card p-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                  <span>Phiếu nhập <b className="font-mono">{purchase.code}</b></span>
                  <span className="text-muted-ink">{datetime(purchase.ts)}</span>
                  <span>NCC: <b>{purchase.supplier_name || '—'}</b></span>
                  <span className="text-muted-ink">Kho: {purchase.warehouse_name}</span>
                  <span className="flex-1" />
                  <Button size="sm" onClick={() => { setPurchase(null); setQtys({}); setCustomQtys({}); }}>Chọn phiếu khác</Button>
                </div>

                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Tên hàng</th><th>ĐVT</th>
                        <th className="text-right">Đã nhập</th>
                        <th className="text-right">Đã trả</th>
                        <th className="text-right">Đơn giá nhập</th>
                        <th style={{ width: 100 }} className="text-right">SL trả</th>
                        <th className="text-right">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byItems.map((it) => (
                        <tr key={it.id} className={it.returnable_qty <= 0 ? 'opacity-55' : ''}>
                          <td>
                            <div className="font-semibold">{it.product_name}</div>
                            <div className="text-2xs text-muted-ink font-mono">{it.sku}</div>
                          </td>
                          <td>{it.unit_name}</td>
                          <td className="num">{fq(it.qty)}</td>
                          <td className="num text-muted-ink">{it.returned_qty > 0 ? fq(it.returned_qty) : '—'}</td>
                          <td className="num">{money(it.net_price)}</td>
                          <td>
                            {it.returnable_qty > 0 ? (
                              <QtyInput
                                value={qtys[it.id] || 0}
                                max={it.returnable_qty}
                                onChange={(v) => setQtys((q) => ({ ...q, [it.id]: Math.min(it.returnable_qty, Math.max(0, v)) }))}
                                aria-label={`Số lượng trả ${it.product_name}, tối đa ${fq(it.returnable_qty)}`}
                              />
                            ) : <span className="text-2xs text-muted-ink">Đã trả hết</span>}
                          </td>
                          <td className="num font-semibold">{it.rqty > 0 ? money(lineValue(it.rqty, it.net_price)) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {byCustom.length > 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50/40 p-2.5">
                    <div className="text-[13px] font-bold mb-1.5 flex items-center gap-1.5">
                      <AlertTriangle size={14} className="text-danger" aria-hidden="true" />
                      Hàng giao sai của phiếu này — không trừ kho
                    </div>
                    <div className="table-wrap bg-white">
                      <table className="data">
                        <thead>
                          <tr>
                            <th>Tên hàng</th><th>ĐVT</th>
                            <th className="text-right">Giao sai</th>
                            <th className="text-right">Đã trả</th>
                            <th className="text-right">Giá NCC</th>
                            <th style={{ width: 100 }} className="text-right">SL trả</th>
                            <th className="text-right">Thành tiền</th>
                          </tr>
                        </thead>
                        <tbody>
                          {byCustom.map((c) => (
                            <tr key={c.id} className={c.returnable_qty <= 0 ? 'opacity-55' : ''}>
                              <td>
                                <div className="font-semibold">{c.name}</div>
                                {c.returnable_qty > 0 && <Badge tone="bad">Hàng giao sai - Chờ trả</Badge>}
                              </td>
                              <td>{c.unit_name || '—'}</td>
                              <td className="num">{fq(c.qty)}</td>
                              <td className="num text-muted-ink">{c.returned_qty > 0 ? fq(c.returned_qty) : '—'}</td>
                              <td className="num">{money(c.price)}</td>
                              <td>
                                {c.returnable_qty > 0 ? (
                                  <QtyInput
                                    value={customQtys[c.id] || 0}
                                    max={c.returnable_qty}
                                    onChange={(v) => setCustomQtys((q) => ({ ...q, [c.id]: Math.min(c.returnable_qty, Math.max(0, v)) }))}
                                    aria-label={`Số lượng trả hàng giao sai ${c.name}`}
                                  />
                                ) : <span className="text-2xs text-muted-ink">Đã trả hết</span>}
                              </td>
                              <td className="num font-semibold">{c.rqty > 0 ? money(lineValue(c.rqty, c.price)) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nhà cung cấp" required>
                  <Combo
                    items={suppliers || []}
                    value={supplierId}
                    onChange={setSupplierId}
                    placeholder="Chọn nhà cung cấp..."
                    filter={(s, q) => match(s.name, q) || (s.phone || '').includes(q)}
                    render={(s) => ({ label: s.name, sub: [s.phone, s.debt > 0 ? `Đang nợ ${money(s.debt)}` : null].filter(Boolean).join(' · ') })}
                  />
                </Field>
                <Field label="Trả từ kho">
                  <Select value={warehouseId || ''} onChange={(e) => setWarehouseId(Number(e.target.value))}>
                    {meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </Select>
                </Field>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="label !mb-0">Hàng trả lại ({lines.length})</span>
                <CartPickerButton kind="purchase_return" count={lines.length}
                  onClick={() => setPickerOpen(true)} />
              </div>

              {lines.length === 0 ? (
                <p className="text-[13px] text-muted-ink">Chưa chọn hàng có mã. Bấm Chọn hàng, hoặc thêm hàng ngoài hệ thống bên dưới.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Tên hàng</th><th style={{ width: 130 }}>Đơn vị</th>
                        <th style={{ width: 90 }} className="text-right">SL trả</th>
                        <th style={{ width: 130 }} className="text-right">Giá thoả thuận</th>
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
                              {l.units?.length > 1 ? (
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
                            <td><MoneyInput size="sm" value={l.price} onChange={(v) => updateLine(l.key, { price: v })} aria-label={`Giá thoả thuận ${l.name}`} /></td>
                            <td className="num font-semibold">{money(lineValue(l.qty, l.price))}</td>
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

              <div className="rounded-lg border border-red-200 bg-red-50/40 p-2.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[13px]">
                    <span className="font-bold">Hàng ngoài hệ thống</span>
                    <span className="text-muted-ink"> — không có mã, không trừ kho</span>
                  </div>
                  <Button size="sm" variant="soft" icon={PackagePlus}
                    onClick={() => setFreeCustom((cs) => [...cs, { key: `c${Date.now()}`, name: '', unit_name: '', qty: 1, price: 0 }])}>
                    Thêm hàng ngoài hệ thống
                  </Button>
                </div>
                {freeCustom.length > 0 && (
                  <div className="table-wrap bg-white">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Tên hàng</th><th style={{ width: 90 }}>ĐVT</th>
                          <th style={{ width: 90 }} className="text-right">SL trả</th>
                          <th style={{ width: 130 }} className="text-right">Giá thoả thuận</th>
                          <th className="text-right">Thành tiền</th><th style={{ width: 40 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {freeCustom.map((c, i) => (
                          <tr key={c.key || i}>
                            <td><Input size="sm" value={c.name} placeholder="Tên hàng trả" aria-label={`Tên hàng ngoài hệ thống ${i + 1}`}
                              onChange={(e) => patchCustom(i, { name: e.target.value })} /></td>
                            <td><Input size="sm" value={c.unit_name} placeholder="Cái" aria-label={`Đơn vị hàng ngoài hệ thống ${i + 1}`}
                              onChange={(e) => patchCustom(i, { unit_name: e.target.value })} /></td>
                            <td><QtyInput value={c.qty} onChange={(v) => patchCustom(i, { qty: v })} aria-label={`Số lượng hàng ngoài hệ thống ${i + 1}`} /></td>
                            <td><MoneyInput size="sm" value={c.price} onChange={(v) => patchCustom(i, { price: v })} aria-label={`Giá hàng ngoài hệ thống ${i + 1}`} /></td>
                            <td className="num font-semibold">{money(lineValue(c.qty, c.price))}</td>
                            <td><IconButton icon={Trash2} label={`Bỏ hàng ngoài hệ thống ${i + 1}`} size={14}
                              className="!text-danger hover:!bg-red-50" onClick={() => setFreeCustom((cs) => cs.filter((_, j) => j !== i))} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ---------------- Tiền và ghi chú ---------------- */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-3">
              <Field label="Lý do trả hàng">
                <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="">— Chọn lý do —</option>
                  {REASONS.map((r) => <option key={r}>{r}</option>)}
                </Select>
              </Field>
              <Field label="Ghi chú">
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>

            <div className="space-y-3">
              <div className="card p-3 space-y-1.5 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-muted-ink">Hàng chuẩn (trừ kho)</span>
                  <span className="tabular font-mono">{money(stockValue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-ink">Hàng giao sai / ngoài hệ thống</span>
                  <span className="tabular font-mono">{money(customValue)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="prf-exp" className="text-muted-ink">
                    Chi phí trả hàng
                    <span className="block text-2xs">Tiệm chịu, trừ vào tiền NCC trả</span>
                  </label>
                  <MoneyInput id="prf-exp" size="sm" className="!w-32" value={expense} onChange={setExpense} />
                </div>
                {exp > 0 && (
                  <Input size="sm" value={expenseNote} onChange={(e) => setExpenseNote(e.target.value)}
                    placeholder="Ghi chú chi phí: xe chở, phí gửi..." aria-label="Ghi chú chi phí trả hàng" />
                )}
                <div className="flex items-baseline justify-between pt-2 border-t border-line">
                  <span className="font-semibold">Tiền NCC phải trả / trừ nợ</span>
                  <span className={`text-xl font-display font-bold tabular ${total < 0 ? 'text-danger' : ''}`}>{money(total)}</span>
                </div>
              </div>

              <div role="radiogroup" aria-label="Cách NCC trả tiền" className="grid grid-cols-2 gap-1.5">
                {[['debt', 'Trừ vào công nợ', Wallet], ['cash', 'NCC hoàn tiền', Banknote]].map(([k, label, Icon]) => (
                  <label key={k}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[13px] font-semibold cursor-pointer
                                transition-colors duration-150 focus-within:ring-2 focus-within:ring-accent/40
                                ${settle === k ? 'border-accent bg-accent-soft text-emerald-900' : 'border-line hover:bg-muted'}`}>
                    <input type="radio" name="prf-settle" value={k} checked={settle === k} className="sr-only"
                      onChange={() => { setSettle(k); if (k === 'debt') setRefunded(0); }} />
                    <Icon size={15} aria-hidden="true" />{label}
                  </label>
                ))}
              </div>
              {settle === 'cash' && (
                <div className="grid gap-2 grid-cols-2">
                  <Field label="NCC hoàn">
                    <MoneyInput value={refunded} onChange={setRefunded} />
                  </Field>
                  <Field label="Nộp vào quỹ">
                    <Select value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
                      {meta.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </Select>
                  </Field>
                </div>
              )}
            </div>
          </div>

          {err && <p role="alert" className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
        </div>
      </Modal>

      {/* Hộp chọn hàng đồng bộ hai chiều, màu cam của luồng hàng đi ra
          (tài liệu 15, mục 3) */}
      <CartPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        kind="purchase_return"
        title="Chọn hàng cần trả lại NCC"
        products={products || []}
        lines={lines}
        onAdd={addProduct}
        onPatch={updateLine}
        onRemove={removeLine}
        amountOf={(l) => Math.round((Number(l.qty) || 0) * (Number(l.price) || 0))}
        priceOf={(p) => p.cost_price}
        priceLabel="Giá trả"
        footerNote="Giá trị hàng trả"
      />
    </>
  );
}
