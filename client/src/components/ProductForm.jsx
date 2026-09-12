/* ====================================================================
   BẢNG KHAI BÁO HÀNG HOÁ

   Nằm riêng ở đây chứ không nằm trong trang Hàng hoá, vì màn hình Nhập
   hàng cũng dùng tới: gặp món chưa có trong danh mục thì khai ngay tại
   chỗ rồi thêm thẳng vào phiếu nhập.
   ==================================================================== */
import { useState, useEffect } from 'react';
import { Plus, Trash2, Wrench, ChevronDown, RotateCcw, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch } from '../lib/store';
import { money, n, qty as fq, COST_METHOD_LABEL } from '../lib/format';
import {
  Button, IconButton, Select, Modal, Spinner, Empty, Badge,
  Field, MoneyInput, Textarea, Input, QtyInput,
} from './ui';
import { ProductPicker } from './ProductPicker';
import { CategorySelect } from './CategoryTree';
import { ProductImageManager } from './ProductImages';

const EMPTY = {
  sku: '', barcode: '', name: '', alias: '', category_id: '', base_unit: 'Cái',
  cost_price: '', vat_rate: 8, track_stock: 1, min_stock: 0, max_stock: 0,
  brand: '', location: '', note: '', active: 1,
  warranty_months: 0, warranty_note: '',
  description: '', pack_spec: '',
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
  /* Ảnh: hàng đã có thì lưu thẳng lên máy chủ; hàng mới thì giữ tạm ở đây
     rồi gửi kèm lúc lưu mặt hàng (tài liệu 13, mục 1.4) */
  const [images, setImages] = useState([]);
  const [staged, setStaged] = useState([]);
  /* Đơn vị bán chính / mua chính, nhớ theo VỊ TRÍ dòng vì dòng mới chưa có mã */
  const [sellIdx, setSellIdx] = useState(0);
  const [buyIdx, setBuyIdx] = useState(0);
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
    setStaged([]);
    if (product) {
      setForm({
        ...EMPTY, ...product,
        category_id: product.category_id || '',
        cost_method: product.cost_method || '',
        description: product.description || '',
        pack_spec: product.pack_spec || '',
      });
      setImages(product.images || []);
      // Dựng lại danh sách đơn vị kèm giá của từng bảng giá
      const list = (product.units || []).map((u) => {
        const prices = {};
        for (const pr of product.prices || []) {
          if (pr.unit_id === u.id) prices[pr.price_list_id] = pr.price;
        }
        return {
          id: u.id, unit_name: u.unit_name, factor: u.factor, barcode: u.barcode || '',
          active: u.active === 0 ? 0 : 1, used: !!u.used,
          ref_unit_id: u.ref_unit_id || '', ref_qty: u.ref_qty || '',
          prices,
        };
      });
      const rows = list.length ? list : [{ unit_name: product.base_unit, factor: 1, prices: {} }];
      setUnits(rows);
      const idxOf = (unitId) => {
        const i = rows.findIndex((u) => u.id === unitId);
        return i >= 0 ? i : rows.findIndex((u) => Number(u.factor) === 1);
      };
      setSellIdx(Math.max(0, idxOf(product.sell_unit_id)));
      setBuyIdx(Math.max(0, idxOf(product.buy_unit_id)));
    } else {
      setForm({ ...EMPTY, opening_warehouse_id: defaultWarehouse || '' });
      setUnits([{ unit_name: 'Cái', factor: 1, prices: {} }]);
      setImages([]);
      setSellIdx(0);
      setBuyIdx(0);
    }
  }, [open, product, defaultWarehouse]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  /* Đơn vị cơ bản luôn là dòng có hệ số 1 */
  const setUnit = (i, patch) => setUnits((prev) => prev.map((u, j) => j === i ? { ...u, ...patch } : u));
  const setUnitPrice = (i, plId, price) => setUnits((prev) =>
    prev.map((u, j) => j === i ? { ...u, prices: { ...u.prices, [plId]: price } } : u));
  const addUnit = () => setUnits((prev) => [...prev, { unit_name: '', factor: 10, prices: {}, active: 1 }]);

  /**
   * Bỏ một đơn vị khỏi bảng.
   *
   * Đơn vị đã có mã và ĐÃ TỪNG nằm trong chứng từ thì gọi máy chủ để nó
   * chuyển sang "ngừng hoạt động" — xoá khỏi bảng ở đây rồi bấm Lưu cũng
   * ra kết quả ấy, nhưng gọi thẳng thì người dùng thấy ngay lời giải thích
   * thay vì tưởng đã xoá hẳn (tài liệu 13, mục 1.3).
   */
  const removeUnit = async (i) => {
    const u = units[i];
    if (u?.id && u.used && product) {
      try {
        const res = await api.deleteUnit(product.id, u.id);
        setUnits((prev) => prev.map((x, j) => (j === i ? { ...x, active: 0 } : x)));
        toast(res.message, res.archived ? 'warn' : 'ok', 7000);
        return;
      } catch (e) {
        toast(e.message, 'bad', 6000);
        return;
      }
    }
    setUnits((prev) => prev.filter((_, j) => j !== i));
    setSellIdx((x) => (x === i ? 0 : x > i ? x - 1 : x));
    setBuyIdx((x) => (x === i ? 0 : x > i ? x - 1 : x));
  };

  const restoreUnit = async (i) => {
    const u = units[i];
    if (!u?.id || !product) return;
    try {
      await api.restoreUnit(product.id, u.id);
      setUnits((prev) => prev.map((x, j) => (j === i ? { ...x, active: 1 } : x)));
      toast(`Đã mở lại đơn vị "${u.unit_name}"`, 'ok');
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  /**
   * Khai bắc cầu: "1 Thùng = 30 Lố" thì hệ số về đơn vị cơ bản tự nhân lên
   * theo hệ số của Lố (tài liệu 15, mục 2.1).
   */
  const setChain = (i, refIdx, refQty) => setUnits((prev) => prev.map((u, j) => {
    if (j !== i) return u;
    const ref = prev[refIdx];
    const q = Number(refQty) || 0;
    const factor = ref && q > 0 ? Math.round(Number(ref.factor) || 1) * Math.round(q) : u.factor;
    return { ...u, ref_unit_id: ref?.id || '', ref_idx: refIdx, ref_qty: q || '', factor };
  }));

  /* Đổi tên đơn vị cơ bản ở phần thông tin chung -> đồng bộ xuống bảng đơn vị */
  useEffect(() => {
    setUnits((prev) => prev.map((u) => u.factor === 1 ? { ...u, unit_name: form.base_unit } : u));
  }, [form.base_unit]);

  const save = async () => {
    if (!form.name.trim()) { setErr('Bắt buộc nhập tên hàng hoá.'); return; }
    if (units.some((u) => !u.unit_name.trim())) { setErr('Mỗi đơn vị tính phải có tên.'); return; }
    if (!units.some((u) => Number(u.factor) === 1)) { setErr('Phải có một đơn vị cơ bản với hệ số quy đổi bằng 1.'); return; }
    /* Hệ số phải là số nguyên dương (tài liệu 15, mục 2.1). Chặn ngay ở đây
       để người dùng thấy lỗi ở đúng dòng, khỏi phải đọc lời báo của máy chủ. */
    const badUnit = units.find((u) => {
      const v = Number(u.factor);
      return !Number.isInteger(v) || v <= 0;
    });
    if (badUnit) {
      setErr(`Hệ số quy đổi của "${badUnit.unit_name || 'đơn vị'}" phải là số nguyên dương lớn hơn 0.`
        + ' Không nhận số âm hay số thập phân.');
      return;
    }
    /* Giá vốn ban đầu là con số bắt buộc khai (tài liệu 13, mục 1.2) */
    if (!product && (form.cost_price === '' || form.cost_price === null || Number(form.cost_price) < 0)) {
      setErr('Bắt buộc khai giá vốn ban đầu. Hàng dịch vụ / tiền công thì ghi 0.');
      return;
    }

    setBusy(true);
    setErr('');
    try {
      const body = {
        ...form,
        cost_price: Math.round(Number(form.cost_price) || 0),
        category_id: form.category_id ? Number(form.category_id) : null,
        units: units.map((u) => ({ ...u, factor: Number(u.factor) || 1 })),
        /* Máy chủ nhận theo vị trí dòng: dòng mới chưa có mã đơn vị */
        sell_unit_index: sellIdx,
        buy_unit_index: buyIdx,
        ...(product ? {} : { images: staged }),
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
            {/* leafOnly: hàng hoá gán vào nhóm NHỎ NHẤT của nhánh. Gán vào
                nhóm còn con thì báo cáo theo nhóm đếm hai lần. */}
            <CategorySelect
              id="pf-cat"
              value={form.category_id}
              onChange={(v) => set('category_id')({ target: { value: v } })}
              categories={meta.categories}
              placeholder="— Chưa phân nhóm —"
              leafOnly
            />
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
          {/* Bảo hành mặc định (tài liệu 09, mục 4): tự điền khi bán, in lên phiếu bảo hành */}
          <Field label="Bảo hành mặc định (tháng)" hint="0 = không bảo hành" htmlFor="pf-wm">
            <div className="flex items-center gap-1.5">
              <QtyInput id="pf-wm" size="md" value={form.warranty_months || 0} min={0} className="flex-1"
                onChange={(v) => setForm((f) => ({ ...f, warranty_months: Math.max(0, Math.round(Number(v) || 0)) }))} />
              {[6, 12, 24].map((m) => (
                <button key={m} type="button" onClick={() => setForm((f) => ({ ...f, warranty_months: m }))}
                  className={`btn btn-sm ${Number(form.warranty_months) === m ? 'btn-soft' : 'btn-outline'}`}>
                  {m}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Điều kiện bảo hành" hint="In lên phiếu bảo hành khi bán" htmlFor="pf-wn">
            <Input id="pf-wn" value={form.warranty_note || ''} onChange={set('warranty_note')}
              disabled={!(Number(form.warranty_months) > 0)} placeholder="VD: không bảo hành cháy nổ do điện áp" />
          </Field>
        </div>

        {/* Đơn vị quy đổi + giá bán (tài liệu 13 mục 1.3, tài liệu 15 mục 2.1) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="label !mb-0">Đơn vị tính &amp; giá bán</span>
              <p className="text-2xs text-muted-ink">
                Thêm đơn vị lớn để bán nguyên cuộn/thùng. Hệ số phải là số nguyên dương.
                Khai bắc cầu được: 1 Thùng = 12 Lố thì hệ số về {form.base_unit || 'đơn vị cơ bản'} tự tính.
              </p>
            </div>
            <Button size="sm" icon={Plus} onClick={addUnit}>Thêm đơn vị</Button>
          </div>

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Tên đơn vị</th>
                  <th style={{ width: 190 }}>Quy đổi</th>
                  <th style={{ width: 100 }} className="text-right">
                    Hệ số về {form.base_unit || 'ĐVT gốc'}
                  </th>
                  {meta.priceLists.map((pl) => (
                    <th key={pl.id} className="text-right">{pl.name}</th>
                  ))}
                  <th style={{ width: 96 }} className="text-center">Bán / Mua</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {units.map((u, i) => {
                  const isBase = Number(u.factor) === 1;
                  const off = u.active === 0;
                  const refIdx = u.ref_idx ?? units.findIndex((x) => x.id && x.id === u.ref_unit_id);
                  return (
                    <tr key={u.id ?? `new${i}`}
                      className={`${isBase ? 'bg-accent-soft/25' : ''} ${off ? 'opacity-55' : ''}`}>
                      <td>
                        <Input
                          size="sm"
                          value={u.unit_name}
                          onChange={(e) => setUnit(i, { unit_name: e.target.value })}
                          disabled={isBase || off}
                          aria-label={`Tên đơn vị dòng ${i + 1}`}
                        />
                        {isBase && <span className="text-2xs text-emerald-800 font-semibold">Đơn vị cơ bản</span>}
                        {off && <Badge tone="mute" className="mt-0.5">Ngừng hoạt động</Badge>}
                        {!isBase && !off && u.used && (
                          <span className="block text-2xs text-muted-ink">đã có chứng từ dùng</span>
                        )}
                      </td>
                      <td>
                        {isBase ? (
                          <span className="text-2xs text-muted-ink">Đơn vị nhỏ nhất</span>
                        ) : (
                          <div className="flex items-center gap-1">
                            <span className="text-2xs text-muted-ink whitespace-nowrap">1 =</span>
                            <QtyInput
                              value={u.ref_qty || ''}
                              min={1}
                              className="!w-16"
                              disabled={off}
                              onChange={(v) => setChain(i, refIdx >= 0 ? refIdx : units.findIndex((x) => Number(x.factor) === 1), v)}
                              aria-label={`Số lượng quy đổi của dòng ${i + 1}`}
                            />
                            <Select
                              size="sm"
                              className="!w-auto min-w-[5.5rem]"
                              disabled={off}
                              value={refIdx >= 0 ? refIdx : units.findIndex((x) => Number(x.factor) === 1)}
                              onChange={(e) => setChain(i, Number(e.target.value), u.ref_qty)}
                              aria-label={`Quy đổi theo đơn vị nào, dòng ${i + 1}`}
                            >
                              {units.map((x, j) => (
                                j === i ? null : (
                                  <option key={j} value={j}>{x.unit_name || `ĐVT ${j + 1}`}</option>
                                )
                              ))}
                            </Select>
                          </div>
                        )}
                      </td>
                      <td>
                        <QtyInput
                          value={u.factor}
                          onChange={(v) => setUnit(i, { factor: v, ref_qty: '', ref_idx: undefined })}
                          disabled={isBase || off}
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
                            disabled={off}
                            aria-label={`${pl.name} cho ${u.unit_name || 'đơn vị'}`}
                          />
                        </td>
                      ))}
                      {/* Đơn vị nào tự nhảy vào giỏ khi BÁN, đơn vị nào khi NHẬP */}
                      <td>
                        <div className="flex items-center justify-center gap-2.5">
                          <label className="flex flex-col items-center gap-0.5 cursor-pointer"
                            title="Đơn vị bán chính — tự nhảy vào giỏ ở màn hình bán hàng">
                            <input
                              type="radio"
                              name="pf-sell-unit"
                              className="w-3.5 h-3.5 accent-emerald-700 cursor-pointer"
                              checked={sellIdx === i}
                              disabled={off}
                              onChange={() => setSellIdx(i)}
                            />
                            <span className="text-2xs text-muted-ink">Bán</span>
                          </label>
                          <label className="flex flex-col items-center gap-0.5 cursor-pointer"
                            title="Đơn vị mua chính — tự nhảy vào phiếu nhập hàng">
                            <input
                              type="radio"
                              name="pf-buy-unit"
                              className="w-3.5 h-3.5 accent-blue-700 cursor-pointer"
                              checked={buyIdx === i}
                              disabled={off}
                              onChange={() => setBuyIdx(i)}
                            />
                            <span className="text-2xs text-muted-ink">Mua</span>
                          </label>
                        </div>
                      </td>
                      <td>
                        {!isBase && (off
                          ? (
                            <IconButton icon={RotateCcw} label={`Mở lại đơn vị ${u.unit_name}`} size={14}
                              onClick={() => restoreUnit(i)} />
                          ) : (
                            <IconButton icon={Trash2} label={`Xoá đơn vị ${u.unit_name}`} size={14}
                              className="!text-danger hover:!bg-red-50" onClick={() => removeUnit(i)} />
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-2xs text-muted-ink mt-1 flex items-start gap-1.5">
            <AlertTriangle size={11} className="shrink-0 mt-0.5" aria-hidden="true" />
            Đơn vị đã từng nằm trong hoá đơn thì không xoá hẳn được: hệ thống chuyển sang
            <b className="mx-1">Ngừng hoạt động</b> — không bán mới được nữa nhưng hoá đơn cũ vẫn đọc đúng.
          </p>
        </div>

        {/* Ảnh và mô tả để thu ngân tư vấn (tài liệu 13, mục 1.4 và 3.1) */}
        <div className="card p-3 space-y-3">
          <ProductImageManager
            productId={product?.id || null}
            images={images}
            staged={staged}
            onChange={setImages}
            onStage={setStaged}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Quy cách đóng gói"
              hint="Hiện cạnh tên đơn vị lúc kiểm hàng, lập phiếu và in tem"
              htmlFor="pf-pack"
            >
              <Input id="pf-pack" value={form.pack_spec || ''} onChange={set('pack_spec')}
                placeholder="Ví dụ: Lố 12 cái, Thùng 360 cái, Bao 10 cuộn" />
            </Field>
            <Field
              label="Thông tin mô tả"
              hint="Thông số, chất liệu, cách dùng — thu ngân mở ra tư vấn cho khách"
              htmlFor="pf-desc"
            >
              <Textarea id="pf-desc" rows={2} value={form.description || ''} onChange={set('description')}
                placeholder="Ví dụ: 220V - 50Hz, vỏ nhựa ABS chống cháy, dùng trong nhà" />
            </Field>
          </div>
        </div>

        {/* Kho & thuế */}
        <div className="grid gap-3 sm:grid-cols-4">
          <Field
            label="Giá vốn / đơn vị cơ bản"
            required={!product}
            hint={product
              ? (effectiveCostMethod === 'fixed'
                ? 'Cố định — chỉ đổi khi gõ tay, hoặc khi phiếu nhập tích ô ghi đè'
                : 'Tự tính lại mỗi lần nhập hàng')
              : 'Bắt buộc khai. Hàng dịch vụ / tiền công thì ghi 0.'}
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

  const add = (p, qty = 1) => {
    if (p.id === product.id) {
      toast('Không thể lấy chính mặt hàng này làm linh kiện.', 'warn');
      return;
    }
    const add_ = Number(qty) > 0 ? Number(qty) : 1;
    setRows((prev) => prev.some((x) => x.component_id === p.id)
      ? prev.map((x) => (x.component_id === p.id ? { ...x, qty: add_ } : x))
      : [...prev, {
          component_id: p.id, component_name: p.name, sku: p.sku,
          base_unit: p.base_unit, cost_price: p.cost_price, stock: p.stock, qty: add_,
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
