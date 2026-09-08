import { useState, useMemo, useEffect } from 'react';
import {
  Boxes, Plus, Pencil, Trash2, Download, Package, History, Tag, Layers, Upload,
  Wrench, CheckSquare, Square, ChevronDown,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, useDebounced } from '../lib/store';
import { money, n, short, qty as fq, datetime, MOVE_LABEL } from '../lib/format';
import {
  Button, IconButton, SearchInput, Select, Modal, Spinner, Empty, ErrorBox, Badge,
  Confirm, Field, MoneyInput, Textarea, Stat, Input, QtyInput, Tabs,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import ImportProducts from '../components/ImportProducts';
import PrintLabels from '../components/PrintLabels';
import { ProductPicker } from './Purchases';

export default function Products() {
  const { toast, meta, loadMeta } = useApp();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [categoryId, setCategoryId] = useState('');
  const [active, setActive] = useState('1');

  const { data, busy, error, reload } = useFetch(
    () => api.products({ q: dq, category_id: categoryId, active }), [dq, categoryId, active]
  );

  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [historyOf, setHistoryOf] = useState(null);
  const [catOpen, setCatOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [busyAction, setBusyAction] = useState(false);

  const totals = useMemo(() => {
    if (!data) return null;
    return {
      count: data.length,
      value: data.reduce((a, p) => a + Math.round(p.total_stock * p.cost_price), 0),
      out: data.filter((p) => p.track_stock && p.total_stock <= 0).length,
      low: data.filter((p) => p.track_stock && p.min_stock > 0 && p.total_stock > 0 && p.total_stock <= p.min_stock).length,
    };
  }, [data]);

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

  const exportCsv = () => {
    if (!data?.length) return;
    const head = ['Mã hàng', 'Mã vạch', 'Tên hàng', 'Nhóm', 'ĐVT', 'Giá vốn', 'Tồn kho', 'Tồn tối thiểu', 'Giá trị tồn', 'Hãng', 'Vị trí'];
    const rows = data.map((p) => [
      p.sku, p.barcode || '', p.name, p.category_name || '', p.base_unit,
      p.cost_price, p.total_stock, p.min_stock,
      Math.round(p.total_stock * p.cost_price), p.brand || '', p.location || '',
    ]);
    const csv = '﻿' + [head, ...rows]
      .map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'hanghoa.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Hàng hoá"
        subtitle={totals ? `${n(totals.count)} mặt hàng · giá trị tồn ${money(totals.value)}` : ''}
        actions={<>
          <Button icon={Layers} onClick={() => setCatOpen(true)}>Nhóm hàng</Button>
          <Button icon={Upload} onClick={() => setImportOpen(true)}>Nhập từ Excel</Button>
          <Button
            icon={Tag}
            onClick={() => setLabelOpen(true)}
            disabled={selected.size === 0}
            title={selected.size === 0 ? 'Tích chọn hàng ở danh sách bên dưới trước' : ''}
          >
            In tem{selected.size > 0 ? ` (${selected.size})` : ''}
          </Button>
          <Button icon={Download} onClick={exportCsv} disabled={!data?.length}>Xuất Excel</Button>
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
              <div className="table-wrap">
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
/* Form thêm / sửa hàng hoá — gồm đơn vị quy đổi và 3 bảng giá           */
/* ==================================================================== */

const EMPTY = {
  sku: '', barcode: '', name: '', alias: '', category_id: '', base_unit: 'Cái',
  cost_price: 0, vat_rate: 8, track_stock: 1, min_stock: 0, max_stock: 0,
  brand: '', location: '', note: '', active: 1,
  opening_qty: 0, opening_warehouse_id: '',
};

function ProductForm({ open, product, onClose, onSaved }) {
  const { meta, defaultWarehouse } = useApp();
  const [form, setForm] = useState(EMPTY);
  const [units, setUnits] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setErr('');
    if (product) {
      setForm({ ...EMPTY, ...product, category_id: product.category_id || '' });
      // Dựng lại danh sách đơn vị kèm giá của từng bảng giá
      const list = (product.units || []).map((u) => {
        const prices = {};
        for (const pr of product.prices || []) {
          if (pr.unit_id === u.id) prices[pr.price_list_id] = pr.price;
        }
        return { unit_name: u.unit_name, factor: u.factor, barcode: u.barcode || '', prices };
      });
      setUnits(list.length ? list : [{ unit_name: product.base_unit, factor: 1, prices: {} }]);
    } else {
      setForm({ ...EMPTY, opening_warehouse_id: defaultWarehouse || '' });
      setUnits([{ unit_name: 'Cái', factor: 1, prices: {} }]);
    }
  }, [open, product, defaultWarehouse]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  /* Đơn vị cơ bản luôn là dòng có hệ số 1 */
  const setUnit = (i, patch) => setUnits((prev) => prev.map((u, j) => j === i ? { ...u, ...patch } : u));
  const setUnitPrice = (i, plId, price) => setUnits((prev) =>
    prev.map((u, j) => j === i ? { ...u, prices: { ...u.prices, [plId]: price } } : u));
  const addUnit = () => setUnits((prev) => [...prev, { unit_name: '', factor: 10, prices: {} }]);
  const removeUnit = (i) => setUnits((prev) => prev.filter((_, j) => j !== i));

  /* Đổi tên đơn vị cơ bản ở phần thông tin chung -> đồng bộ xuống bảng đơn vị */
  useEffect(() => {
    setUnits((prev) => prev.map((u) => u.factor === 1 ? { ...u, unit_name: form.base_unit } : u));
  }, [form.base_unit]);

  const save = async () => {
    if (!form.name.trim()) { setErr('Bắt buộc nhập tên hàng hoá.'); return; }
    if (units.some((u) => !u.unit_name.trim())) { setErr('Mỗi đơn vị tính phải có tên.'); return; }
    if (!units.some((u) => Number(u.factor) === 1)) { setErr('Phải có một đơn vị cơ bản với hệ số quy đổi bằng 1.'); return; }

    setBusy(true);
    setErr('');
    try {
      const body = {
        ...form,
        category_id: form.category_id ? Number(form.category_id) : null,
        units: units.map((u) => ({ ...u, factor: Number(u.factor) || 1 })),
      };
      if (product) await api.put(`/products/${product.id}`, body);
      else await api.post('/products', body);
      onSaved?.();
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
      title={product ? `Sửa hàng hoá: ${product.name}` : 'Thêm hàng hoá mới'}
      size="xl"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={save} loading={busy}>
          {product ? 'Lưu thay đổi' : 'Thêm hàng hoá'}
        </Button>
      </>}
    >
      <div className="space-y-4">
        {/* Thông tin chung */}
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Tên hàng hoá" required className="sm:col-span-2" htmlFor="pf-name">
            <Input id="pf-name" value={form.name} onChange={set('name')}
              placeholder="Ví dụ: Dây điện Cadivi VCm 1x2.5" />
          </Field>

          <Field
            label="Tên phụ / tên thường gọi"
            className="sm:col-span-4"
            hint="Cách gọi quen ở tiệm, gõ không dấu cũng được. Tìm được ở kho và màn hình bán hàng, KHÔNG in lên hoá đơn của khách."
            htmlFor="pf-alias"
          >
            <Input id="pf-alias" value={form.alias || ''} onChange={set('alias')}
              placeholder="Ví dụ: day do 2.5, day cadivi do, day 2 ly ruoi" />
          </Field>
          <Field label="Mã hàng" hint={product ? 'Không đổi được' : 'Bỏ trống để tự đặt'} htmlFor="pf-sku">
            <Input id="pf-sku" value={form.sku} onChange={set('sku')} disabled={!!product} />
          </Field>
          <Field label="Mã vạch" htmlFor="pf-barcode">
            <Input id="pf-barcode" value={form.barcode || ''} onChange={set('barcode')}
              placeholder="Quét mã vạch vào đây" />
          </Field>

          <Field label="Nhóm hàng" htmlFor="pf-cat">
            <Select id="pf-cat" value={form.category_id} onChange={set('category_id')}>
              <option value="">— Chưa phân nhóm —</option>
              {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Đơn vị cơ bản" required hint="Đơn vị nhỏ nhất khi bán" htmlFor="pf-unit">
            <Input id="pf-unit" value={form.base_unit} onChange={set('base_unit')} placeholder="Cái, Mét, Cuộn..." />
          </Field>
          <Field label="Hãng sản xuất" htmlFor="pf-brand">
            <Input id="pf-brand" value={form.brand || ''} onChange={set('brand')} placeholder="CADIVI, Panasonic..." />
          </Field>
          <Field label="Vị trí trên kệ" htmlFor="pf-loc">
            <Input id="pf-loc" value={form.location || ''} onChange={set('location')} placeholder="Kệ A1" />
          </Field>
        </div>

        {/* Đơn vị quy đổi + giá bán */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="label !mb-0">Đơn vị tính &amp; giá bán</span>
              <p className="text-2xs text-muted-ink">
                Thêm đơn vị lớn để bán nguyên cuộn/thùng. Ví dụ: 1 Cuộn 100m = hệ số 100.
              </p>
            </div>
            <Button size="sm" icon={Plus} onClick={addUnit}>Thêm đơn vị</Button>
          </div>

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Tên đơn vị</th>
                  <th style={{ width: 110 }} className="text-right">Hệ số quy đổi</th>
                  {meta.priceLists.map((pl) => (
                    <th key={pl.id} className="text-right">{pl.name}</th>
                  ))}
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {units.map((u, i) => {
                  const isBase = Number(u.factor) === 1;
                  return (
                    <tr key={i} className={isBase ? 'bg-accent-soft/25' : ''}>
                      <td>
                        <Input
                          size="sm"
                          value={u.unit_name}
                          onChange={(e) => setUnit(i, { unit_name: e.target.value })}
                          disabled={isBase}
                          aria-label={`Tên đơn vị dòng ${i + 1}`}
                        />
                        {isBase && <span className="text-2xs text-emerald-800 font-semibold">Đơn vị cơ bản</span>}
                      </td>
                      <td>
                        <QtyInput
                          value={u.factor}
                          onChange={(v) => setUnit(i, { factor: v })}
                          disabled={isBase}
                          min={1}
                          aria-label={`Hệ số quy đổi dòng ${i + 1}`}
                        />
                        {!isBase && u.factor > 1 && (
                          <div className="text-2xs text-muted-ink text-right">
                            = {fq(u.factor)} {form.base_unit}
                          </div>
                        )}
                      </td>
                      {meta.priceLists.map((pl) => (
                        <td key={pl.id}>
                          <MoneyInput
                            size="sm"
                            value={u.prices?.[pl.id] || 0}
                            onChange={(v) => setUnitPrice(i, pl.id, v)}
                            aria-label={`${pl.name} cho ${u.unit_name || 'đơn vị'}`}
                          />
                        </td>
                      ))}
                      <td>
                        {!isBase && (
                          <IconButton icon={Trash2} label={`Xoá đơn vị ${u.unit_name}`} size={14}
                            className="!text-danger hover:!bg-red-50" onClick={() => removeUnit(i)} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Kho & thuế */}
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Giá vốn / đơn vị cơ bản" hint={product ? 'Tự cập nhật khi nhập hàng' : 'Giá nhập ban đầu'} htmlFor="pf-cost">
            <MoneyInput id="pf-cost" value={form.cost_price} onChange={(v) => setForm((f) => ({ ...f, cost_price: v }))} disabled={!!product} />
          </Field>
          <Field label="Thuế GTGT (%)" htmlFor="pf-vat">
            <Select id="pf-vat" value={form.vat_rate} onChange={(e) => setForm((f) => ({ ...f, vat_rate: Number(e.target.value) }))}>
              <option value={0}>0% — không chịu thuế</option>
              <option value={5}>5%</option>
              <option value={8}>8%</option>
              <option value={10}>10%</option>
            </Select>
          </Field>
          <Field label="Tồn tối thiểu" hint="Dưới mức này sẽ cảnh báo" htmlFor="pf-min">
            <QtyInput size="md" value={form.min_stock} onChange={(v) => setForm((f) => ({ ...f, min_stock: v }))} />
          </Field>
          <Field label="Tồn tối đa" hint="0 = không giới hạn" htmlFor="pf-max">
            <QtyInput size="md" value={form.max_stock} onChange={(v) => setForm((f) => ({ ...f, max_stock: v }))} />
          </Field>
        </div>

        {!product && (
          <div className="grid gap-3 sm:grid-cols-2 card p-3 bg-muted/40">
            <Field label="Tồn kho hiện có" hint="Số lượng đang có sẵn tại tiệm (theo đơn vị cơ bản)" htmlFor="pf-open">
              <QtyInput size="md" value={form.opening_qty} onChange={(v) => setForm((f) => ({ ...f, opening_qty: v }))} />
            </Field>
            <Field label="Nhập vào kho" htmlFor="pf-openwh">
              <Select id="pf-openwh" value={form.opening_warehouse_id}
                onChange={(e) => setForm((f) => ({ ...f, opening_warehouse_id: Number(e.target.value) }))}>
                {meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </Select>
            </Field>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ghi chú" htmlFor="pf-note">
            <Textarea id="pf-note" rows={2} value={form.note || ''} onChange={set('note')} />
          </Field>
          <div className="space-y-2 pt-6">
            <label className="flex items-center gap-2 text-[13px] cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-emerald-700 cursor-pointer"
                checked={form.track_stock !== 0}
                onChange={(e) => setForm((f) => ({ ...f, track_stock: e.target.checked ? 1 : 0 }))} />
              Quản lý tồn kho
              <span className="text-2xs text-muted-ink">(bỏ chọn nếu là dịch vụ, tiền công)</span>
            </label>
            <label className="flex items-center gap-2 text-[13px] cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-emerald-700 cursor-pointer"
                checked={form.active !== 0}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked ? 1 : 0 }))} />
              Đang kinh doanh
            </label>
          </div>
        </div>

        {/* Định mức nguyên vật liệu — chỉ hiện khi sửa mặt hàng đã có */}
        {product && <BomEditor product={product} />}

        {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
      </div>
    </Modal>
  );
}

/* ==================================================================== */
/* Khai định mức nguyên vật liệu cho hàng tự lắp ráp                     */
/* ==================================================================== */

function BomEditor({ product }) {
  const { toast, defaultWarehouse } = useApp();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const { data: allProducts } = useFetch(
    () => api.posProducts({ warehouse_id: defaultWarehouse }), [defaultWarehouse], { skip: !open }
  );

  useEffect(() => {
    if (!open || loaded) return;
    api.get(`/products/${product.id}/bom`)
      .then((d) => { setRows(d.rows); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [open, loaded, product.id]);

  const materialCost = rows.reduce((a, x) => a + Math.round(x.qty * x.cost_price), 0);

  const add = (p) => {
    if (p.id === product.id) {
      toast('Không thể lấy chính mặt hàng này làm linh kiện.', 'warn');
      return;
    }
    setRows((prev) => prev.some((x) => x.component_id === p.id)
      ? prev
      : [...prev, {
          component_id: p.id, component_name: p.name, sku: p.sku,
          base_unit: p.base_unit, cost_price: p.cost_price, stock: p.stock, qty: 1,
        }]);
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/products/${product.id}/bom`, {
        items: rows.map((r) => ({ component_id: r.component_id, qty: Number(r.qty) || 0 })),
      });
      toast(rows.length ? `Đã lưu định mức ${rows.length} linh kiện` : 'Đã xoá định mức', 'ok');
    } catch (e) {
      toast(e.message, 'bad', 6000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sm:col-span-4 card p-3">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 text-left cursor-pointer"
      >
        <Wrench size={15} className="text-muted-ink shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[13px]">Định mức nguyên vật liệu</div>
          <div className="text-2xs text-muted-ink">
            Khai nếu mặt hàng này do tiệm tự lắp ráp. Khi lập phiếu sản xuất, hệ thống
            tự trừ kho linh kiện và tính giá vốn thành phẩm.
          </div>
        </div>
        {product.is_manufactured === 1 && <Badge tone="info">Đã khai</Badge>}
        <ChevronDown
          size={15}
          aria-hidden="true"
          className={`shrink-0 text-muted-ink transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-2xs text-muted-ink">
              Khai số lượng cần cho <b>1 {product.base_unit}</b> thành phẩm
            </span>
            <Button size="sm" icon={Plus} onClick={() => setPickerOpen(true)}>Thêm linh kiện</Button>
          </div>

          {rows.length === 0 ? (
            <p className="text-[13px] text-muted-ink py-3 text-center">Chưa khai linh kiện nào.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Linh kiện</th>
                    <th className="text-right">Tồn kho</th>
                    <th style={{ width: 100 }} className="text-right">Cần dùng</th>
                    <th className="text-right">Giá vốn</th>
                    <th className="text-right">Thành tiền</th>
                    <th style={{ width: 36 }} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.component_id}>
                      <td>
                        <div className="font-semibold">{r.component_name}</div>
                        <div className="text-2xs text-muted-ink font-mono">{r.sku}</div>
                      </td>
                      <td className="num text-muted-ink">{fq(r.stock ?? 0)} {r.base_unit}</td>
                      <td>
                        <QtyInput
                          value={r.qty}
                          onChange={(v) => setRows((prev) => prev.map((x) =>
                            x.component_id === r.component_id ? { ...x, qty: v } : x))}
                          aria-label={`Số lượng ${r.component_name}`}
                        />
                      </td>
                      <td className="num">{money(r.cost_price)}</td>
                      <td className="num font-semibold">{money(Math.round(r.qty * r.cost_price))}</td>
                      <td>
                        <IconButton
                          icon={Trash2}
                          label={`Bỏ ${r.component_name}`}
                          size={13}
                          className="!text-danger hover:!bg-red-50"
                          onClick={() => setRows((prev) => prev.filter((x) => x.component_id !== r.component_id))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="text-right">GIÁ VỐN NVL CHO 1 THÀNH PHẨM</td>
                    <td className="num">{money(materialCost)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <Button variant="primary" size="sm" onClick={save} loading={busy}>Lưu định mức</Button>
        </div>
      )}

      <ProductPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        products={(allProducts || []).filter((p) => p.id !== product.id)}
        onPick={add}
        title="Chọn linh kiện"
      />
    </div>
  );
}

/* ==================================================================== */
/* Thẻ kho của một mặt hàng                                              */
/* ==================================================================== */

export function StockHistory({ product, onClose }) {
  const { data, busy } = useFetch(
    () => api.productMoves(product.id), [product?.id], { skip: !product }
  );

  return (
    <Modal
      open={!!product}
      onClose={onClose}
      title={product ? `Thẻ kho: ${product.name}` : ''}
      subtitle="Toàn bộ biến động nhập xuất theo thời gian"
      size="lg"
      footer={<Button onClick={onClose}>Đóng</Button>}
    >
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
    </Modal>
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
