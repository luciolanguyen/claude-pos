/* ====================================================================
   BẢNG KHAI BÁO HÀNG HOÁ

   Nằm riêng ở đây chứ không nằm trong trang Hàng hoá, vì màn hình Nhập
   hàng cũng dùng tới: gặp món chưa có trong danh mục thì khai ngay tại
   chỗ rồi thêm thẳng vào phiếu nhập.
   ==================================================================== */
import { useState, useEffect } from 'react';
import { Plus, Trash2, Wrench, ChevronDown } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch } from '../lib/store';
import { money, n, qty as fq, COST_METHOD_LABEL } from '../lib/format';
import {
  Button, IconButton, Select, Modal, Spinner, Empty, Badge,
  Field, MoneyInput, Textarea, Input, QtyInput,
} from './ui';
import { ProductPicker } from './ProductPicker';

const EMPTY = {
  sku: '', barcode: '', name: '', alias: '', category_id: '', base_unit: 'Cái',
  cost_price: 0, vat_rate: 8, track_stock: 1, min_stock: 0, max_stock: 0,
  brand: '', location: '', note: '', active: 1,
  opening_qty: 0, opening_warehouse_id: '',
  cost_method: '',        // rỗng = theo thiết lập chung của tiệm
};

/**
 * Bảng khai báo hàng hoá. Xuất ra để màn hình Nhập hàng dùng lại được khi
 * gặp món chưa có trong danh mục — khai ngay tại chỗ rồi thêm thẳng vào
 * phiếu, không phải bỏ dở phiếu nhập để đi tạo hàng.
 */
export function ProductForm({ open, product, onClose, onSaved }) {
  const { meta, defaultWarehouse, settings, can, toast } = useApp();
  const shopCostMethod = settings?.cost_method === 'fixed' ? 'fixed' : 'average';
  const canSeeCost = can('cost.view');
  const [form, setForm] = useState(EMPTY);
  const [units, setUnits] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [costOpen, setCostOpen] = useState(false);
  const [costInput, setCostInput] = useState(0);
  const [costBusy, setCostBusy] = useState(false);
  /* Cách tính thật sự áp cho món này: đặt riêng thì theo riêng, không thì theo tiệm */
  const effectiveCostMethod = form.cost_method || shopCostMethod;

  /**
   * Gõ tay giá vốn.
   * Với hàng dùng giá vốn cố định, đây là cách duy nhất đổi con số đó.
   * Với hàng bình quân gia quyền thì con số này chỉ đứng tới lần nhập kế
   * tiếp — nói rõ để chủ tiệm khỏi tưởng đã chốt cứng.
   */
  const saveCost = async () => {
    setCostBusy(true);
    try {
      const res = await api.put(`/products/${product.id}/cost`, { cost_price: Number(costInput) || 0 });
      setForm((f2) => ({ ...f2, cost_price: res.cost_price }));
      setCostOpen(false);
      toast(`Đã đổi giá vốn thành ${money(res.cost_price)}`, 'ok');
    } catch (e) {
      toast(e.message, 'bad', 6000);
    } finally {
      setCostBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setErr('');
    if (product) {
      setForm({
        ...EMPTY, ...product,
        category_id: product.category_id || '',
        cost_method: product.cost_method || '',
      });
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
      /* Trả lại bản ghi vừa lưu cho nơi gọi. Màn hình Nhập hàng cần nó để
         thêm thẳng món mới vào phiếu, khỏi bắt người dùng đi tìm lại. */
      const saved = product
        ? await api.put(`/products/${product.id}`, body)
        : await api.post('/products', body);
      onSaved?.(saved);
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
          <Field
            label="Giá vốn / đơn vị cơ bản"
            hint={product
              ? (effectiveCostMethod === 'fixed'
                ? 'Cố định — chốt từ lần nhập đầu'
                : 'Tự tính lại mỗi lần nhập hàng')
              : 'Giá nhập ban đầu'}
            htmlFor="pf-cost"
          >
            <MoneyInput id="pf-cost" value={form.cost_price} onChange={(v) => setForm((f) => ({ ...f, cost_price: v }))} disabled={!!product} />
            {product && canSeeCost && (
              <button
                type="button"
                className="text-2xs text-accent font-semibold hover:underline mt-1 cursor-pointer"
                onClick={() => { setCostInput(form.cost_price); setCostOpen(true); }}
              >
                Sửa giá vốn
              </button>
            )}
          </Field>
          <Field
            label="Cách tính giá vốn"
            hint={form.cost_method ? 'Riêng cho món này' : 'Theo thiết lập chung'}
            htmlFor="pf-costmethod"
          >
            <Select
              id="pf-costmethod"
              value={form.cost_method || ''}
              onChange={(e) => setForm((f) => ({ ...f, cost_method: e.target.value }))}
            >
              <option value="">
                Theo tiệm — {COST_METHOD_LABEL[shopCostMethod]}
              </option>
              <option value="average">{COST_METHOD_LABEL.average}</option>
              <option value="fixed">{COST_METHOD_LABEL.fixed}</option>
            </Select>
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

      <Modal
        open={costOpen}
        onClose={() => setCostOpen(false)}
        title={`Sửa giá vốn: ${product?.name || ''}`}
        size="sm"
        footer={
          <>
            <Button onClick={() => setCostOpen(false)}>Huỷ</Button>
            <Button variant="primary" onClick={saveCost} loading={costBusy}>Lưu giá vốn</Button>
          </>
        }
      >
        <div className="space-y-2.5">
          <Field label="Giá vốn mới / đơn vị cơ bản" htmlFor="pf-newcost">
            <MoneyInput id="pf-newcost" size="lg" value={costInput} onChange={setCostInput} autoFocus />
          </Field>
          <div className="card p-2.5 bg-muted/50 text-[13px] leading-relaxed">
            Đang là <b>{money(form.cost_price)}</b>.
            {effectiveCostMethod === 'fixed' ? (
              <> Món này dùng <b>giá vốn cố định</b>, nên con số gõ ở đây đứng luôn —
                lần nhập hàng sau không ghi đè.</>
            ) : (
              <> Món này dùng <b>bình quân gia quyền</b>, nên con số gõ ở đây chỉ đứng tới
                lần nhập hàng kế tiếp. Muốn chốt cứng thì đổi cách tính sang <b>Cố định</b>.</>
            )}
          </div>
          <p className="text-2xs text-muted-ink">
            Đổi giá vốn không tính lại lãi lỗ của hoá đơn đã xuất — những hoá đơn đó
            đã ghi giá vốn tại thời điểm bán.
          </p>
        </div>
      </Modal>
    </>
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
