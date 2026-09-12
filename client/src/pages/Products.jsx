/* ====================================================================
   HÀNG HOÁ & TỒN KHO — MỘT MÀN HÌNH DUY NHẤT (tài liệu 15, mục 1)

   Trước đây tách làm hai trang: "Hàng hoá" xem giá và danh mục, "Tồn kho"
   xem số lượng. Đi lại giữa hai trang chỉ để xem một mặt hàng còn mấy cái
   là mất công, nên gộp thành một lưới có đủ cả.

   Bộ lọc nằm hết trên thanh công cụ (tài liệu 13, mục 1.1) — hàng ô lọc
   dưới tên cột đã bỏ, lấy chỗ cho dữ liệu. Bấm tên cột để sắp xếp, bấm
   lần thứ ba thì về thứ tự mặc định.

   Sửa nhanh tại chỗ: giá vốn, giá bán, và kiểm kho nhanh từng dòng.
   ==================================================================== */
import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Boxes, Plus, Pencil, Trash2, Download, Package, History, Tag, Layers, Upload,
  Wrench, CheckSquare, Square, FileText, AlertTriangle, X, ClipboardCheck,
  ChevronUp, ChevronDown, PackageX, Check,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, usePaged, useDebounced, fetchAllPages, useSearchMode } from '../lib/store';
import { money, n, short, qty as fq, datetime, date, MOVE_LABEL } from '../lib/format';
import {
  Button, IconButton, SearchInput, Select, Modal, Spinner, Empty, ErrorBox, Badge,
  Confirm, Field, MoneyInput, Textarea, Stat, Input, QtyInput, Tabs, Pager,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import CategoryTree, { CategorySelect } from '../components/CategoryTree';
import ImportProducts from '../components/ImportProducts';
import PrintLabels from '../components/PrintLabels';
import { ProductForm } from '../components/ProductForm';
import { Thumb, ProductInfoModal } from '../components/ProductImages';
import { AdjustModal } from './Stock';

/* Nhãn hiện trên chip bộ lọc */
const FILTER_LABEL = {
  brand: 'Hãng', location: 'Vị trí', stock_status: 'Tồn kho',
};
const STOCK_LABEL = {
  in: 'Còn hàng', low: 'Dưới tồn tối thiểu', out: 'Đã hết hàng', over: 'Vượt định mức',
};
const STATUS_BADGE = {
  out: ['bad', 'Hết hàng'],
  low: ['warn', 'Sắp hết'],
  over: ['info', 'Vượt định mức'],
  ok: ['ok', 'Bình thường'],
  service: ['mute', 'Dịch vụ'],
};

/* Cột nào bấm được để sắp xếp — tên phải khớp với danh sách máy chủ cho phép */
const SORTABLE = {
  sku: 'Mã hàng', name: 'Tên hàng', category: 'Nhóm', unit: 'ĐVT',
  cost_price: 'Giá vốn', sale_price: 'Giá bán', stock: 'Tồn kho',
  min_stock: 'Tối thiểu', value: 'Giá trị tồn', location: 'Vị trí',
};

/**
 * Tiêu đề cột bấm được, xoay vòng ba trạng thái (tài liệu 13, mục 1.1):
 * tăng dần → giảm dần → về mặc định.
 */
function SortTh({ field, label, sort, onSort, className = '', style }) {
  const on = sort.field === field;
  const next = !on ? 'asc' : sort.dir === 'asc' ? 'desc' : '';
  return (
    <th style={style} className={className} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(next ? { field, dir: next } : { field: '', dir: 'asc' })}
        title={!on ? 'Bấm để sắp xếp tăng dần'
          : sort.dir === 'asc' ? 'Bấm để sắp xếp giảm dần' : 'Bấm để bỏ sắp xếp'}
        className={`inline-flex items-center gap-0.5 cursor-pointer hover:text-accent
                    ${className.includes('text-right') ? 'flex-row-reverse' : ''}
                    ${on ? 'text-accent font-bold' : ''}`}
      >
        {label}
        {on
          ? (sort.dir === 'asc'
            ? <ChevronUp size={13} aria-hidden="true" />
            : <ChevronDown size={13} aria-hidden="true" />)
          : <span className="w-[13px]" aria-hidden="true" />}
      </button>
    </th>
  );
}

/**
 * Ô sửa nhanh tại chỗ: bấm vào con số là thành ô nhập, Enter lưu, Esc bỏ.
 * Dùng cho giá vốn và giá bán — hai con số hay phải sửa lắt nhắt nhất.
 */
function QuickMoney({ value, onSave, label, disabled, tone = '' }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setV(value); }, [value]);

  if (disabled) return <span className={tone}>{money(value)}</span>;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setV(value); setEditing(true); }}
        title={`Bấm để sửa ${label}`}
        className={`tabular cursor-pointer rounded px-1 -mx-1 hover:bg-accent-soft/60
                    hover:ring-1 hover:ring-accent/40 ${tone}`}
      >
        {money(value)}
      </button>
    );
  }

  const commit = async () => {
    if (Math.round(Number(v) || 0) === value) { setEditing(false); return; }
    setBusy(true);
    try { await onSave(Math.round(Number(v) || 0)); setEditing(false); }
    finally { setBusy(false); }
  };

  return (
    <span className="flex items-center gap-0.5 justify-end">
      <MoneyInput
        size="sm"
        value={v}
        onChange={setV}
        autoFocus
        className="!w-28"
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
        }}
      />
      <IconButton icon={Check} size={13} label={`Lưu ${label}`} onClick={commit} disabled={busy} />
      <IconButton icon={X} size={13} label="Bỏ sửa" onClick={() => setEditing(false)} />
    </span>
  );
}

export default function Products() {
  const { toast, meta, loadMeta, can, defaultWarehouse } = useApp();
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  const [mode, setMode] = useSearchMode();
  const dq = useDebounced(q, 300);
  const [categoryId, setCategoryId] = useState('');
  const [active, setActive] = useState('1');
  const [warehouseId, setWarehouseId] = useState('');
  const [sort, setSort] = useState({ field: '', dir: 'asc' });
  const maySeeCost = can('cost.view');
  const mayManage = can('product.manage');

  /* Bộ lọc trên thanh công cụ. Đường dẫn cũ /stock?filter=low vẫn dùng được. */
  const startStatus = ['low', 'out', 'over'].includes(params.get('filter')) ? params.get('filter') : '';
  const [col, setCol] = useState({ brand: '', location: '', stock_status: startStatus });
  const setColField = (k) => (v) => setCol((c) => ({ ...c, [k]: v }));
  const clearCols = () => setCol({ brand: '', location: '', stock_status: '' });
  const activeFilters = Object.entries(col).filter(([, v]) => v);

  const { data: filterOpts } = useFetch(() => api.get('/products/filters'), []);

  const filters = useMemo(
    () => ({
      q: dq, match: mode, category_id: categoryId, active, warehouse_id: warehouseId,
      sort: sort.field, dir: sort.dir, ...col,
    }),
    [dq, mode, categoryId, active, warehouseId, sort, col]);

  const {
    rows: data, extra, total: rowCount, busy, error, reload,
    page, setPage, pageSize, setPageSize,
  } = usePaged((pg) => api.products({ ...filters, ...pg }), [filters], { key: 'products' });

  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [historyOf, setHistoryOf] = useState(null);
  const [adjusting, setAdjusting] = useState(null);
  const [catOpen, setCatOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [infoOf, setInfoOf] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [busyAction, setBusyAction] = useState(false);

  /* Số tổng do máy chủ tính trên CẢ bộ lọc. Cộng từ data thì phân trang
     xong thẻ "giá trị tồn kho" chỉ còn cộng 20 dòng, mà sai rất khó thấy. */
  const totals = extra?.totals || null;
  const whName = meta.warehouses.find((w) => String(w.id) === String(warehouseId))?.name;

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

  const saveCost = async (p, v) => {
    try {
      await api.put(`/products/${p.id}/cost`, { cost_price: v });
      toast(`${p.name}: giá vốn ${money(v)}`, 'ok');
      reload();
    } catch (e) { toast(e.message, 'bad', 6000); }
  };
  const savePrice = async (p, v) => {
    try {
      await api.quickPrice(p.id, { price: v });
      toast(`${p.name}: giá bán ${money(v)}`, 'ok');
      reload();
    } catch (e) { toast(e.message, 'bad', 6000); }
  };

  /**
   * Xuất danh sách ra file mở được bằng Excel.
   * Truyền onlySelected để chỉ xuất những dòng đã tích; không truyền thì
   * xuất toàn bộ danh sách đang lọc.
   */
  const exportCsv = async (onlySelected = false) => {
    const list = onlySelected
      ? (data || []).filter((p) => selected.has(p.id))
      : await fetchAllPages((pg) => api.products({ ...filters, ...pg }));
    if (!list.length) return;
    const head = ['Mã hàng', 'Mã vạch', 'Tên hàng', 'Tên phụ', 'Nhóm', 'ĐVT', 'Quy cách',
      'Giá vốn', 'Giá bán', 'Tồn kho', 'Tồn tối thiểu', 'Giá trị tồn', 'Hãng', 'Vị trí', 'Tình trạng'];
    const rows = list.map((p) => [
      p.sku, p.barcode || '', p.name, p.alias || '', p.category_name || '', p.base_unit,
      p.pack_spec || '', p.cost_price ?? '', p.sale_price ?? '', p.total_stock, p.min_stock,
      Math.round(p.total_stock * (p.cost_price || 0)), p.brand || '', p.location || '',
      (STATUS_BADGE[p.stock_status] || [])[1] || '',
    ]);
    // Dấu BOM ở đầu để Excel nhận ra UTF-8, không thì tiếng Việt ra ký tự lạ
    const csv = '﻿' + [head, ...rows]
      .map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = onlySelected ? `hanghoa-da-chon-${list.length}.csv` : 'hanghoa-tonkho.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast(`Đã tải file ${n(list.length)} mặt hàng`, 'ok');
  };

  const STATUS_TABS = [
    ['', 'Tất cả'], ['in', 'Còn hàng'], ['low', 'Sắp hết'], ['out', 'Hết hàng'], ['over', 'Vượt định mức'],
  ];

  return (
    <>
      <PageHeader
        title="Hàng hoá & tồn kho"
        subtitle={totals
          ? `${n(totals.count)} mặt hàng · giá trị tồn ${money(totals.value)}${whName ? ` · ${whName}` : ''}`
          : ''}
        actions={<>
          <Button icon={Layers} onClick={() => setCatOpen(true)}>Nhóm hàng</Button>
          <Button icon={Upload} onClick={() => setImportOpen(true)}>Nhập từ Excel</Button>
          <Button icon={Download} onClick={() => exportCsv(false)} disabled={!rowCount}>
            Xuất Excel
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Thêm hàng hoá</Button>
        </>}
      >
        {/* Toàn bộ bộ lọc nằm ở đây, không còn hàng ô lọc dưới tên cột */}
        <div className="flex flex-wrap gap-2 items-center">
          <SearchInput
            value={q}
            onChange={setQ}
            mode={mode}
            onMode={setMode}
            placeholder="Tìm tên hàng, mã hàng, mã vạch, hãng..."
            className="w-full sm:w-[22rem]"
          />
          <CategorySelect
            value={categoryId}
            onChange={setCategoryId}
            categories={meta.categories}
            size="sm"
            className="!w-auto"
            ariaLabel="Lọc theo nhóm hàng"
          />
          {meta.warehouses.length > 1 && (
            <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} size="sm"
              className="!w-auto" aria-label="Xem tồn của kho nào">
              <option value="">Tồn tất cả kho</option>
              {meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          )}
          <Select value={col.brand} onChange={(e) => setColField('brand')(e.target.value)} size="sm"
            className="!w-auto" aria-label="Lọc theo hãng">
            <option value="">Mọi hãng</option>
            {(filterOpts?.brands || []).map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
          <Select value={col.location} onChange={(e) => setColField('location')(e.target.value)} size="sm"
            className="!w-auto" aria-label="Lọc theo vị trí để hàng">
            <option value="">Mọi vị trí</option>
            {(filterOpts?.locations || []).map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
          <Select value={active} onChange={(e) => setActive(e.target.value)} size="sm" className="!w-auto"
            aria-label="Lọc theo trạng thái kinh doanh">
            <option value="1">Đang kinh doanh</option>
            <option value="0">Ngừng kinh doanh</option>
            <option value="">Tất cả</option>
          </Select>
          <div className="flex gap-1">
            {STATUS_TABS.map(([k, l]) => (
              <button key={k || 'all'} onClick={() => setColField('stock_status')(k)}
                className={`btn btn-sm ${col.stock_status === k ? 'btn-secondary' : 'btn-outline'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </PageHeader>

      <Page className="space-y-3">
        {/* Thanh thao tác: chỉ hiện khi có dòng được tích */}
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

        {/* Chip cho biết đang lọc những gì */}
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
            <Stat label="Sắp hết hàng" value={n(totals.low)} tone={totals.low > 0 ? 'warn' : 'default'}
              icon={AlertTriangle} />
            <Stat label="Đã hết hàng" value={n(totals.out)} tone={totals.out > 0 ? 'bad' : 'default'}
              icon={PackageX} />
          </div>
        )}

        {busy && !data ? <Spinner />
          : error ? <ErrorBox error={error} onRetry={reload} />
            : !data?.length ? (
              <Empty
                icon={Boxes}
                title={q || activeFilters.length ? 'Không có mặt hàng nào khớp' : 'Chưa có hàng hoá nào'}
                message={q
                  ? `Không tìm thấy hàng khớp "${q}"${mode === 'exact' ? ' (đang tìm chính xác)' : ''}.`
                  : activeFilters.length
                    ? 'Thử bỏ bớt bộ lọc trên thanh công cụ.'
                    : 'Thêm mặt hàng đầu tiên để bắt đầu bán.'}
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
                      <th style={{ width: 44 }}>Ảnh</th>
                      <SortTh field="sku" label="Mã hàng" sort={sort} onSort={setSort} />
                      <SortTh field="name" label="Tên hàng" sort={sort} onSort={setSort} />
                      <SortTh field="category" label="Nhóm" sort={sort} onSort={setSort} />
                      <SortTh field="unit" label="ĐVT" sort={sort} onSort={setSort} />
                      {maySeeCost && (
                        <SortTh field="cost_price" label="Giá vốn" sort={sort} onSort={setSort}
                          className="text-right" />
                      )}
                      <SortTh field="sale_price" label="Giá bán" sort={sort} onSort={setSort}
                        className="text-right" />
                      <SortTh field="stock" label="Tồn kho" sort={sort} onSort={setSort}
                        className="text-right" />
                      <SortTh field="min_stock" label="Tối thiểu" sort={sort} onSort={setSort}
                        className="text-right" />
                      {maySeeCost && (
                        <SortTh field="value" label="Giá trị tồn" sort={sort} onSort={setSort}
                          className="text-right" />
                      )}
                      <SortTh field="location" label="Vị trí" sort={sort} onSort={setSort} />
                      <th>Tình trạng</th>
                      <th className="text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((p) => {
                      const [tone, label] = STATUS_BADGE[p.stock_status] || STATUS_BADGE.ok;
                      const out = p.stock_status === 'out';
                      const low = p.stock_status === 'low';
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
                          <td>
                            <button type="button" onClick={async () => setInfoOf(await api.product(p.id))}
                              title={`Xem ảnh và mô tả ${p.name}`} className="cursor-pointer">
                              <Thumb file={p.image} alt="" size={34} />
                              {p.image_count > 1 && (
                                <span className="block text-2xs text-muted-ink text-center leading-none">
                                  {p.image_count} ảnh
                                </span>
                              )}
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
                          <td>
                            {p.base_unit}
                            {p.pack_spec && (
                              <div className="text-2xs text-muted-ink">{p.pack_spec}</div>
                            )}
                          </td>
                          {maySeeCost && (
                            <td className="num">
                              <QuickMoney value={p.cost_price} label={`giá vốn ${p.name}`}
                                disabled={!mayManage} onSave={(v) => saveCost(p, v)} />
                            </td>
                          )}
                          <td className="num">
                            <QuickMoney value={p.sale_price || 0} label={`giá bán ${p.name}`}
                              disabled={!mayManage} onSave={(v) => savePrice(p, v)} />
                          </td>
                          <td className="num">
                            {p.track_stock
                              ? (
                                <button
                                  type="button"
                                  onClick={() => setAdjusting({ ...p, qty: p.total_stock })}
                                  title={`Kiểm kho nhanh ${p.name}`}
                                  className={`tabular cursor-pointer rounded px-1 -mx-1 hover:bg-accent-soft/60
                                              hover:ring-1 hover:ring-accent/40
                                              ${out ? 'text-danger font-bold' : low ? 'text-warn font-semibold' : ''}`}
                                >
                                  {fq(p.total_stock)}
                                </button>
                              )
                              : <span className="text-muted-ink text-2xs">Dịch vụ</span>}
                          </td>
                          <td className="num text-muted-ink">{p.min_stock > 0 ? fq(p.min_stock) : '—'}</td>
                          {maySeeCost && (
                            <td className="num">{money(p.stock_value ?? Math.round(p.total_stock * p.cost_price))}</td>
                          )}
                          <td className="text-muted-ink text-2xs">{p.location || '—'}</td>
                          <td><Badge tone={tone}>{label}</Badge></td>
                          <td>
                            <div className="flex items-center justify-end gap-0.5">
                              {p.track_stock === 1 && (
                                <IconButton icon={ClipboardCheck} label={`Kiểm kho nhanh ${p.name}`} size={14}
                                  onClick={() => setAdjusting({ ...p, qty: p.total_stock })} />
                              )}
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

      {/* Kiểm kho nhanh ngay trên lưới (tài liệu 15, mục 1.2) */}
      <AdjustModal
        product={adjusting}
        warehouseId={warehouseId || defaultWarehouse}
        warehouses={meta.warehouses}
        onClose={() => setAdjusting(null)}
        onDone={() => { setAdjusting(null); reload(); toast('Đã cập nhật tồn kho', 'ok'); }}
      />

      {infoOf && (
        <ProductInfoModal product={infoOf} onClose={() => setInfoOf(null)} priceListId={1} />
      )}

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

      <CategoryTree
        open={catOpen}
        onClose={() => setCatOpen(false)}
        onChanged={() => { loadMeta(); reload(); }}
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
