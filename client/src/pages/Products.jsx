import { useState, useMemo, useEffect } from 'react';
import {
  Boxes, Plus, Pencil, Trash2, Download, Package, History, Tag, Layers, Upload,
  Wrench, CheckSquare, Square, ChevronDown, FileText, AlertTriangle, X,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, usePaged, useDebounced, fetchAllPages } from '../lib/store';
import { money, n, short, qty as fq, datetime, date, MOVE_LABEL, COST_METHOD_LABEL } from '../lib/format';
import {
  Button, IconButton, SearchInput, Select, Modal, Spinner, Empty, ErrorBox, Badge,
  Confirm, Field, MoneyInput, Textarea, Stat, Input, QtyInput, Tabs, Pager,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import ImportProducts from '../components/ImportProducts';
import PrintLabels from '../components/PrintLabels';
import { ProductPicker } from '../components/ProductPicker';
import { ProductForm } from '../components/ProductForm';

/* Nhãn hiện trên chip bộ lọc */
const FILTER_LABEL = {
  name: 'Tên hàng', sku: 'Mã hàng', barcode: 'Mã vạch',
  brand: 'Hãng', location: 'Vị trí', stock_status: 'Tồn kho',
};
const STOCK_LABEL = { in: 'Còn hàng', low: 'Dưới tồn tối thiểu', out: 'Đã hết hàng' };

export default function Products() {
  const { toast, meta, loadMeta } = useApp();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [categoryId, setCategoryId] = useState('');
  const [active, setActive] = useState('1');

  /* Bộ lọc gõ ngay dưới tên cột. Gộp thành một đối tượng để truyền cho
     máy chủ và để đếm xem đang bật mấy điều kiện. */
  const [col, setCol] = useState({ name: '', sku: '', barcode: '', brand: '', location: '', stock_status: '' });
  const dcol = useDebounced(JSON.stringify(col), 300);
  const setColField = (k) => (v) => setCol((c) => ({ ...c, [k]: v }));
  const clearCols = () => setCol({ name: '', sku: '', barcode: '', brand: '', location: '', stock_status: '' });
  const activeFilters = Object.entries(col).filter(([, v]) => v);

  const { data: filterOpts } = useFetch(() => api.get('/products/filters'), []);

  const filters = useMemo(
    () => ({ q: dq, category_id: categoryId, active, ...JSON.parse(dcol) }),
    [dq, categoryId, active, dcol]);

  const {
    rows: data, extra, total: rowCount, busy, error, reload,
    page, setPage, pageSize, setPageSize,
  } = usePaged((pg) => api.products({ ...filters, ...pg }), [filters], { key: 'products' });

  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [historyOf, setHistoryOf] = useState(null);
  const [catOpen, setCatOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [busyAction, setBusyAction] = useState(false);

  /* Số tổng do máy chủ tính trên CẢ bộ lọc. Cộng từ data thì phân trang
     xong thẻ "giá trị tồn kho" chỉ còn cộng 20 dòng, mà sai rất khó thấy. */
  const totals = extra?.totals || null;

  const doDelete = async () => {
    setBusyAction(true);
    try {
      const res = await api.del(`/products/${deleting.id}`);
      toast(res.message || `Đã xoá ${deleting.name}`, res.deactivated ? 'warn' : 'ok', 5000);
      setDeleting(null);
      reload();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusyAction(false);
    }
  };

  /**
   * Xuất danh sách hàng hoá ra file mở được bằng Excel.
   * Truyền onlySelected để chỉ xuất những dòng đã tích; không truyền thì
   * xuất toàn bộ danh sách đang lọc.
   */
  const exportCsv = async (onlySelected = false) => {
    /* Chọn dòng nào thì xuất dòng đó; không chọn thì kéo hết mọi trang của
       bộ lọc hiện tại — chứ không phải chỉ trang đang xem. */
    const list = onlySelected
      ? (data || []).filter((p) => selected.has(p.id))
      : await fetchAllPages((pg) => api.products({ ...filters, ...pg }));
    if (!list.length) return;
    const head = ['Mã hàng', 'Mã vạch', 'Tên hàng', 'Tên phụ', 'Nhóm', 'ĐVT', 'Giá vốn',
      'Tồn kho', 'Tồn tối thiểu', 'Giá trị tồn', 'Hãng', 'Vị trí'];
    const rows = list.map((p) => [
      p.sku, p.barcode || '', p.name, p.alias || '', p.category_name || '', p.base_unit,
      p.cost_price ?? '', p.total_stock, p.min_stock,
      Math.round(p.total_stock * (p.cost_price || 0)), p.brand || '', p.location || '',
    ]);
    // Dấu BOM ở đầu để Excel nhận ra UTF-8, không thì tiếng Việt ra ký tự lạ
    const csv = '﻿' + [head, ...rows]
      .map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = onlySelected ? `hanghoa-da-chon-${list.length}.csv` : 'hanghoa.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast(`Đã tải file ${n(list.length)} mặt hàng`, 'ok');
  };

  return (
    <>
      <PageHeader
        title="Hàng hoá"
        subtitle={totals ? `${n(totals.count)} mặt hàng · giá trị tồn ${money(totals.value)}` : ''}
        actions={<>
          <Button icon={Layers} onClick={() => setCatOpen(true)}>Nhóm hàng</Button>
          <Button icon={Upload} onClick={() => setImportOpen(true)}>Nhập từ Excel</Button>
          <Button icon={Download} onClick={() => exportCsv(false)} disabled={!rowCount}>
            Xuất Excel
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Thêm hàng hoá</Button>
        </>}
      >
        <div className="flex flex-wrap gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Tìm tên hàng, mã hàng, mã vạch, hãng..." className="w-full sm:w-80" />
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} size="sm" className="!w-auto">
            <option value="">Mọi nhóm hàng</option>
            {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select value={active} onChange={(e) => setActive(e.target.value)} size="sm" className="!w-auto">
            <option value="1">Đang kinh doanh</option>
            <option value="0">Ngừng kinh doanh</option>
            <option value="">Tất cả</option>
          </Select>
        </div>
      </PageHeader>

      <Page className="space-y-3">
        {/* Thanh thao tác: chỉ hiện khi có dòng được tích, để lúc bình thường
            màn hình không bị thêm một hàng nút không dùng tới */}
        {selected.size > 0 && (
          <div className="card p-2.5 flex flex-wrap items-center gap-2 border-accent bg-accent-soft/25"
            role="region" aria-label="Thao tác với hàng đã chọn">
            <span className="text-[13px] font-semibold">
              Đã chọn {n(selected.size)} mặt hàng
            </span>
            <div className="flex-1" />
            <Button size="sm" icon={Tag} onClick={() => setLabelOpen(true)}>
              In tem ({n(selected.size)})
            </Button>
            <Button size="sm" icon={Download} onClick={() => exportCsv(true)}>
              Xuất Excel ({n(selected.size)})
            </Button>
            <Button size="sm" onClick={() => setSelected(new Set())}>Bỏ chọn</Button>
          </div>
        )}

        {/* Chip cho biết đang lọc những gì. Cho xuống dòng chứ không ép
            vào một hàng rồi cắt cụt — mất nhãn là mất luôn ý nghĩa. */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
            <span className="text-muted-ink">Đang lọc:</span>
            {activeFilters.map(([k, v]) => (
              <span key={k}
                className="inline-flex items-center gap-1 rounded-full border border-accent/40
                           bg-accent-soft/40 pl-2 pr-1 py-0.5 max-w-full">
                <span className="truncate">
                  {FILTER_LABEL[k]}: <b>{STOCK_LABEL[v] || v}</b>
                </span>
                <button
                  onClick={() => setColField(k)('')}
                  aria-label={`Bỏ lọc ${FILTER_LABEL[k]}`}
                  className="shrink-0 rounded-full hover:bg-accent/20 p-0.5 cursor-pointer"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
            <button onClick={clearCols} className="text-accent font-semibold hover:underline cursor-pointer">
              Bỏ hết bộ lọc
            </button>
          </div>
        )}

        {totals && (
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
            <Stat label="Số mặt hàng" value={n(totals.count)} icon={Boxes} />
            <Stat label="Giá trị tồn kho" value={short(totals.value)} icon={Package} />
            <Stat label="Sắp hết hàng" value={n(totals.low)} tone={totals.low > 0 ? 'warn' : 'default'} />
            <Stat label="Đã hết hàng" value={n(totals.out)} tone={totals.out > 0 ? 'bad' : 'default'} />
          </div>
        )}

        {busy && !data ? <Spinner />
          : error ? <ErrorBox error={error} onRetry={reload} />
            : !data?.length ? (
              <Empty
                icon={Boxes}
                title="Chưa có hàng hoá nào"
                message={q ? `Không tìm thấy hàng khớp "${q}".` : 'Thêm mặt hàng đầu tiên để bắt đầu bán.'}
                action={<Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Thêm hàng hoá</Button>}
              />
            ) : (
              <div className="card">
              <div className="table-wrap table-scroll !border-0 !rounded-none">
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}>
                        <button
                          onClick={() => setSelected(
                            selected.size === data.length ? new Set() : new Set(data.map((x) => x.id))
                          )}
                          aria-label={selected.size === data.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                          className="flex items-center justify-center w-full cursor-pointer"
                        >
                          {selected.size === data.length && data.length > 0
                            ? <CheckSquare size={15} className="text-accent" aria-hidden="true" />
                            : <Square size={15} className="text-muted-ink" aria-hidden="true" />}
                        </button>
                      </th>
                      <th>Mã hàng</th><th>Tên hàng</th><th>Nhóm</th><th>ĐVT</th>
                      <th className="text-right">Giá vốn</th>
                      <th className="text-right">Tồn kho</th>
                      <th className="text-right">Tối thiểu</th>
                      <th className="text-right">Giá trị tồn</th>
                      <th>Vị trí</th>
                      <th className="text-right">Thao tác</th>
                    </tr>
                    {/* Hàng ô lọc: gõ hoặc chọn ngay dưới tên cột, khỏi phải
                        nhớ bộ lọc nằm ở đâu trên đầu trang */}
                    <tr className="filter-row">
                      <th />
                      <th>
                        <Input size="sm" value={col.sku} onChange={(e) => setColField('sku')(e.target.value)}
                          placeholder="Lọc mã..." aria-label="Lọc theo mã hàng" />
                      </th>
                      <th>
                        <Input size="sm" value={col.name} onChange={(e) => setColField('name')(e.target.value)}
                          placeholder="Lọc tên hoặc tên phụ..." aria-label="Lọc theo tên hàng" />
                      </th>
                      <th>
                        <Select size="sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                          aria-label="Lọc theo nhóm hàng">
                          <option value="">Mọi nhóm</option>
                          {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </Select>
                      </th>
                      <th>
                        <Input size="sm" value={col.barcode} onChange={(e) => setColField('barcode')(e.target.value)}
                          placeholder="Mã vạch..." aria-label="Lọc theo mã vạch" />
                      </th>
                      <th />
                      <th>
                        <Select size="sm" value={col.stock_status}
                          onChange={(e) => setColField('stock_status')(e.target.value)}
                          aria-label="Lọc theo tình trạng tồn kho">
                          <option value="">Mọi tình trạng</option>
                          <option value="in">Còn hàng</option>
                          <option value="low">Dưới tồn tối thiểu</option>
                          <option value="out">Đã hết hàng</option>
                        </Select>
                      </th>
                      <th />
                      <th>
                        <Select size="sm" value={col.brand} onChange={(e) => setColField('brand')(e.target.value)}
                          aria-label="Lọc theo hãng">
                          <option value="">Mọi hãng</option>
                          {(filterOpts?.brands || []).map((b) => <option key={b} value={b}>{b}</option>)}
                        </Select>
                      </th>
                      <th>
                        <Select size="sm" value={col.location} onChange={(e) => setColField('location')(e.target.value)}
                          aria-label="Lọc theo vị trí để hàng">
                          <option value="">Mọi vị trí</option>
                          {(filterOpts?.locations || []).map((l) => <option key={l} value={l}>{l}</option>)}
                        </Select>
                      </th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((p) => {
                      const out = p.track_stock && p.total_stock <= 0;
                      const low = p.track_stock && p.min_stock > 0 && p.total_stock > 0 && p.total_stock <= p.min_stock;
                      return (
                        <tr key={p.id} className={`hoverable ${p.active === 0 ? 'opacity-55' : ''} ${selected.has(p.id) ? 'bg-accent-soft/30' : ''}`}>
                          <td>
                            <button
                              onClick={() => setSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                                return next;
                              })}
                              aria-label={`${selected.has(p.id) ? 'Bỏ chọn' : 'Chọn'} ${p.name}`}
                              className="flex items-center justify-center w-full cursor-pointer"
                            >
                              {selected.has(p.id)
                                ? <CheckSquare size={15} className="text-accent" aria-hidden="true" />
                                : <Square size={15} className="text-muted-ink" aria-hidden="true" />}
                            </button>
                          </td>
                          <td className="font-mono text-muted-ink">{p.sku}</td>
                          <td>
                            <button
                              onClick={async () => setEditing(await api.product(p.id))}
                              className="font-semibold text-accent hover:underline cursor-pointer text-left"
                            >
                              {p.name}
                            </button>
                            {p.alias && (
                              <div className="text-2xs text-muted-ink italic truncate max-w-[240px]">
                                {p.alias}
                              </div>
                            )}
                            {p.brand && <div className="text-2xs text-muted-ink">{p.brand}</div>}
                            {p.is_manufactured === 1 && (
                              <Badge tone="info" className="ml-1">
                                <Wrench size={9} aria-hidden="true" /> Tự sản xuất
                              </Badge>
                            )}
                            {p.active === 0 && <Badge tone="mute" className="ml-1">Ngừng KD</Badge>}
                          </td>
                          <td className="text-muted-ink">{p.category_name || '—'}</td>
                          <td>{p.base_unit}</td>
                          <td className="num">{money(p.cost_price)}</td>
                          <td className="num">
                            {p.track_stock
                              ? <span className={out ? 'text-danger font-bold' : low ? 'text-warn font-semibold' : ''}>
                                  {fq(p.total_stock)}
                                </span>
                              : <span className="text-muted-ink text-2xs">Dịch vụ</span>}
                          </td>
                          <td className="num text-muted-ink">{p.min_stock > 0 ? fq(p.min_stock) : '—'}</td>
                          <td className="num">{money(Math.round(p.total_stock * p.cost_price))}</td>
                          <td className="text-muted-ink text-2xs">{p.location || '—'}</td>
                          <td>
                            <div className="flex items-center justify-end gap-0.5">
                              <IconButton icon={History} label={`Thẻ kho ${p.name}`} size={14}
                                onClick={() => setHistoryOf(p)} />
                              <IconButton icon={Pencil} label={`Sửa ${p.name}`} size={14}
                                onClick={async () => setEditing(await api.product(p.id))} />
                              <IconButton icon={Trash2} label={`Xoá ${p.name}`} size={14}
                                className="!text-danger hover:!bg-red-50" onClick={() => setDeleting(p)} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
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

      <ProductForm
        open={!!editing}
        product={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null); reload();
          toast(editing === 'new' ? 'Đã thêm hàng hoá' : 'Đã lưu thay đổi', 'ok');
        }}
      />

      <StockHistory product={historyOf} onClose={() => setHistoryOf(null)} />

      <PrintLabels
        open={labelOpen}
        onClose={() => setLabelOpen(false)}
        products={(data || []).filter((x) => selected.has(x.id))}
      />

      <ImportProducts
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => { reload(); loadMeta(); }}
      />

      <CategoryManager
        open={catOpen}
        onClose={() => { setCatOpen(false); loadMeta(); reload(); }}
      />

      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={doDelete}
        busy={busyAction}
        title="Xoá mặt hàng?"
        confirmText="Xoá hàng hoá"
        message={deleting && (
          <>
            Xoá <b>{deleting.name}</b> khỏi danh mục hàng hoá?
            <br /><br />
            Nếu mặt hàng đã từng bán hoặc nhập, hệ thống sẽ giữ lại và chỉ chuyển sang
            trạng thái <b>Ngừng kinh doanh</b> để không làm hỏng lịch sử chứng từ.
          </>
        )}
      />
    </>
  );
}

/* ==================================================================== */
/* Thẻ kho của một mặt hàng                                              */
/* ==================================================================== */

export function StockHistory({ product, onClose }) {
  const { can } = useApp();
  const [tab, setTab] = useState('moves');

  // Người không được xem giá vốn thì không có tab lịch sử nhập, vì bảng đó
  // hiện giá nhập của từng mối — máy chủ cũng chặn, đây chỉ là cho gọn mắt.
  const maySeeCost = can('cost.view');

  useEffect(() => { if (product) setTab('moves'); }, [product]);

  return (
    <Modal
      open={!!product}
      onClose={onClose}
      title={product ? product.name : ''}
      subtitle={product ? `${product.sku} · ${product.base_unit}` : ''}
      size="lg"
      footer={<Button onClick={onClose}>Đóng</Button>}
    >
      {maySeeCost && (
        <Tabs
          value={tab}
          onChange={setTab}
          className="mb-3"
          tabs={[
            { key: 'moves', label: 'Thẻ kho' },
            { key: 'purchases', label: 'Lịch sử nhập hàng' },
          ]}
        />
      )}
      {tab === 'purchases' && maySeeCost
        ? <PurchaseHistoryTab product={product} />
        : <StockMovesTab product={product} />}
    </Modal>
  );
}

/* Thẻ kho — toàn bộ biến động nhập xuất theo thời gian. */
function StockMovesTab({ product }) {
  const { data, busy } = useFetch(
    () => api.productMoves(product.id), [product?.id], { skip: !product }
  );

  return (
    <>
      {busy ? <Spinner />
        : !data?.length ? <Empty icon={History} title="Chưa có biến động nào" />
          : (
            <div className="table-wrap max-h-[55vh] overflow-y-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>Thời gian</th><th>Loại</th><th>Chứng từ</th><th>Kho</th>
                    <th className="text-right">Thay đổi</th>
                    <th className="text-right">Tồn sau</th>
                    <th>Diễn giải</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((m) => (
                    <tr key={m.id} className="hoverable">
                      <td className="text-muted-ink whitespace-nowrap">{datetime(m.ts)}</td>
                      <td><Badge tone={m.qty_change > 0 ? 'ok' : 'bad'}>{MOVE_LABEL[m.ref_type] || m.ref_type}</Badge></td>
                      <td className="font-mono text-muted-ink">{m.ref_code || '—'}</td>
                      <td className="text-muted-ink">{m.warehouse_name}</td>
                      <td className={`num font-semibold ${m.qty_change > 0 ? 'text-emerald-700' : 'text-danger'}`}>
                        {m.qty_change > 0 ? '+' : ''}{fq(m.qty_change)}
                      </td>
                      <td className="num font-semibold">{fq(m.balance)}</td>
                      <td className="text-muted-ink text-2xs">{m.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </>
  );
}

/* ==================================================================== *
 * Lịch sử nhập hàng của mặt hàng
 *
 * Trả lời câu chủ tiệm hay hỏi: "lần trước lấy của ai, bao nhiêu một cái".
 * Giá quy về đơn vị cơ bản để so được giữa lần lấy nguyên thùng và lần
 * lấy lẻ từng cái.
 * ==================================================================== */

function PurchaseHistoryTab({ product }) {
  const { data, busy, error, reload } = useFetch(
    () => api.productPurchaseHistory(product.id), [product?.id], { skip: !product }
  );

  if (busy) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.rows?.length) {
    return (
      <Empty
        icon={FileText}
        title="Chưa nhập món này lần nào"
        message="Khi có phiếu nhập hàng cho mặt hàng này, lịch sử sẽ hiện ở đây."
      />
    );
  }

  const sm = data.summary;
  const unit = data.product?.base_unit || '';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Stat label={`Giá thấp nhất / ${unit}`} value={money(sm.min)} tone="good" />
        <Stat label={`Giá cao nhất / ${unit}`} value={money(sm.max)} tone={sm.max > sm.min ? 'warn' : 'default'} />
        <Stat label={`Bình quân / ${unit}`} value={money(sm.avg)} sub="theo số lượng đã nhập" />
        <Stat
          label={`Lần cuối / ${unit}`}
          value={money(sm.last)}
          sub={sm.last_supplier ? `${sm.last_supplier} · ${date(sm.last_ts)}` : null}
          tone={sm.last > sm.avg ? 'bad' : 'default'}
        />
      </div>

      {sm.max > sm.min && sm.last >= sm.max && sm.count > 1 && (
        <div className="card-pad bg-amber-50 border-warn/30 text-[13px] flex gap-2.5">
          <AlertTriangle size={15} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
          <span className="text-amber-900">
            Lần nhập gần nhất là <b>giá cao nhất từ trước tới giờ</b>. Cân nhắc hỏi lại mối
            hoặc tìm mối khác trước khi lấy tiếp.
          </span>
        </div>
      )}

      <div className="table-wrap max-h-[45vh]">
        <table className="data">
          <thead>
            <tr>
              <th>Phiếu nhập</th>
              <th>Ngày nhập</th>
              <th>Nhà cung cấp</th>
              <th className="text-right">Số lượng</th>
              <th>ĐVT</th>
              <th className="text-right">Đơn giá</th>
              <th className="text-right">Quy về {unit}</th>
              <th className="text-right">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((x, i) => (
              <tr key={`${x.purchase_id}-${i}`}
                className={`hoverable ${x.status !== 'done' ? 'opacity-55' : ''}`}>
                <td className="font-mono font-semibold">
                  {x.code}
                  {x.status !== 'done' && <Badge tone="mute" className="ml-1">Đã huỷ</Badge>}
                </td>
                <td className="whitespace-nowrap text-muted-ink">{datetime(x.ts)}</td>
                <td>
                  <div className="truncate max-w-[12rem]">{x.supplier_name || '—'}</div>
                  {x.supplier_phone && (
                    <div className="text-2xs text-muted-ink tabular">{x.supplier_phone}</div>
                  )}
                </td>
                <td className="num">{fq(x.qty)}</td>
                <td className="text-muted-ink">{x.unit_name}</td>
                <td className="num">{money(x.price)}</td>
                <td className={`num font-semibold ${
                  x.status === 'done' && x.unit_price_base === sm.max && sm.max > sm.min ? 'text-danger'
                    : x.status === 'done' && x.unit_price_base === sm.min && sm.max > sm.min ? 'text-emerald-700'
                      : ''}`}>
                  {money(x.unit_price_base)}
                </td>
                <td className="num">{money(x.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-2xs text-muted-ink">
        Cột <b>Quy về {unit}</b> chia đơn giá cho hệ số đơn vị, để so sánh được giữa lần lấy
        nguyên thùng và lần lấy lẻ. Phiếu đã huỷ vẫn hiện nhưng mờ đi và không tính vào số tổng.
      </p>
    </div>
  );
}

/* ==================================================================== */
/* Quản lý nhóm hàng                                                     */
/* ==================================================================== */

function CategoryManager({ open, onClose }) {
  const { toast } = useApp();
  const { data, busy, reload } = useFetch(() => api.categories(), [], { skip: !open });
  const [name, setName] = useState('');
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');

  const add = async () => {
    if (!name.trim()) return;
    try {
      await api.post('/categories', { name: name.trim(), sort_order: (data?.length || 0) });
      setName('');
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const save = async (c) => {
    try {
      await api.put(`/categories/${c.id}`, { name: editName, sort_order: c.sort_order });
      setEditId(null);
      reload();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const remove = async (c) => {
    try {
      await api.del(`/categories/${c.id}`);
      reload();
      toast(`Đã xoá nhóm ${c.name}`, 'ok');
    } catch (e) { toast(e.message, 'bad', 5000); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nhóm hàng hoá"
      subtitle="Phân nhóm để lọc nhanh khi bán và xem báo cáo theo nhóm"
      size="sm"
      footer={<Button variant="primary" onClick={onClose}>Xong</Button>}
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Tên nhóm hàng mới..."
            aria-label="Tên nhóm hàng mới"
          />
          <Button variant="primary" icon={Plus} onClick={add} disabled={!name.trim()}>Thêm</Button>
        </div>

        {busy ? <Spinner />
          : !data?.length ? <Empty icon={Layers} title="Chưa có nhóm hàng nào" />
            : (
              <ul className="divide-y divide-line border border-line rounded-lg">
                {data.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 px-2.5 py-1.5">
                    {editId === c.id ? (
                      <>
                        <Input size="sm" value={editName} onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && save(c)} autoFocus aria-label="Sửa tên nhóm" />
                        <Button size="sm" variant="primary" onClick={() => save(c)}>Lưu</Button>
                        <Button size="sm" onClick={() => setEditId(null)}>Huỷ</Button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-[13px] font-semibold">{c.name}</span>
                        <span className="text-2xs text-muted-ink">{c.product_count} mặt hàng</span>
                        <IconButton icon={Pencil} label={`Sửa nhóm ${c.name}`} size={13}
                          onClick={() => { setEditId(c.id); setEditName(c.name); }} />
                        <IconButton icon={Trash2} label={`Xoá nhóm ${c.name}`} size={13}
                          className="!text-danger hover:!bg-red-50" onClick={() => remove(c)} />
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
      </div>
    </Modal>
  );
}
