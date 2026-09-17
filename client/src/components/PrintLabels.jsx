import { useState, useEffect, useMemo } from 'react';
import { Printer, Tag, Plus, Minus, Trash2, AlertTriangle, FileDown } from 'lucide-react';
import {
  barcodeSvg, LABEL_SIZES, getLabelSize, fitModuleWidth, checkBarcode,
} from '../lib/barcode';
import { labelCodeOf } from '../lib/codeMatch';
import { useApp, useFetch } from '../lib/store';
import { api } from '../lib/api';
import { money, n, qty as fq } from '../lib/format';
import { Modal, Button, Select, Field, Empty, IconButton, Confirm } from './ui';

/**
 * In tem mã vạch dán lên hàng hoá.
 * Mã vạch sinh tại chỗ bằng Code 128 / EAN-13 nên không cần Internet.
 *
 * Tem theo ĐƠN VỊ TÍNH (plan 30, H5): mỗi dòng chọn in tem đơn vị nào — mã
 * riêng của đơn vị đó nếu có, không thì mã hàng, không thì mã hàng SKU; giá
 * in theo đơn vị đó. Gọi từ phiếu nhập với dòng "2 Hộp (1 Hộp = 12 Cái)" thì
 * hỏi in 2 tem hộp hay 24 tem lẻ, và luôn hỏi lại số tem trước khi in —
 * in nhầm 240 tem thay vì 24 là hỏng cả cuộn giấy.
 *
 * products: [{ id, sku, name, barcode, base_unit,
 *              defaultCount?, unit_id?, unit_name?, factor?, qty? }]
 *   unit_id / factor / qty có khi gọi từ phiếu nhập: đơn vị và số lượng vừa nhập.
 */
export default function PrintLabels({ open, onClose, products = [] }) {
  const { store, settings, saveSettings, toast, can } = useApp();
  const saved = settings?.labels || {};

  const [sizeKey, setSizeKey] = useState(saved.size || '35x22');
  const [show, setShow] = useState({
    store: saved.show_store !== false,
    name: saved.show_name !== false,
    price: saved.show_price !== false,
    unit: saved.show_unit !== false,
    sku: saved.show_sku === true,
  });
  const [priceListId, setPriceListId] = useState(saved.price_list_id || null);
  const [items, setItems] = useState([]);
  const [asking, setAsking] = useState(false);
  const { meta, defaultWarehouse } = useApp();

  // Danh sách hàng hoá không kèm giá bán, nên lấy thêm từ API bán hàng
  const { data: priced } = useFetch(
    () => api.posProducts({ warehouse_id: defaultWarehouse }),
    [defaultWarehouse], { skip: !open }
  );

  useEffect(() => {
    if (!open) return;
    const byId = new Map((priced || []).map((p) => [p.id, p]));
    setItems(products.map((p, i) => {
      const full = byId.get(p.id);
      const units = full?.units?.length ? full.units : [{ id: 0, unit_name: p.base_unit, factor: 1, prices: {} }];
      const base = units.find((u) => u.factor === 1) || units[0];
      const from = p.unit_id ? units.find((u) => u.id === p.unit_id)
        : p.unit_name ? units.find((u) => u.unit_name === p.unit_name) : null;
      const factor = Number(from?.factor ?? p.factor) || 1;
      const qty = Number(p.qty) || 0;
      /* Nhập đơn vị lớn (Hộp = 12 Cái): mặc định in tem lẻ dán từng cái bên trong */
      const bulk = from && factor > 1 && qty > 0;
      return {
        ...p,
        key: `${p.id}-${i}`,
        barcode: full?.barcode ?? p.barcode,
        units,
        bulk: bulk ? { unit: from, factor, qty } : null,
        unitId: bulk ? base.id : (from?.id ?? base.id),
        count: bulk ? Math.round(qty * factor) : (p.defaultCount ?? 1),
      };
    }));
  }, [open, products, priced]);

  useEffect(() => {
    if (!priceListId && meta.priceLists.length) {
      setPriceListId(meta.priceLists.find((p) => p.is_default)?.id || meta.priceLists[0].id);
    }
  }, [meta.priceLists, priceListId]);

  const size = getLabelSize(sizeKey);
  const totalLabels = items.reduce((a, x) => a + (Number(x.count) || 0), 0);

  const unitOf = (p) => p.units?.find((u) => u.id === p.unitId) || p.units?.[0];
  const codeOf = (p) => labelCodeOf(p, unitOf(p));
  const priceOf = (p) => unitOf(p)?.prices?.[priceListId] ?? 0;

  const noCode = items.filter((p) => !codeOf(p));

  /* Mã 13 chữ số nhưng số kiểm tra cuối sai.

     Máy quét của tiệm vẫn đọc được (nó đọc theo chuẩn Code 128), nên
     tiệm không tự phát hiện ra. Chỉ tới lúc bán buôn cho siêu thị hay
     nơi dùng máy quét chuẩn EAN mới vỡ ra là cả lô tem không quét được. */
  const badCheck = useMemo(() => items
    .map((p) => ({ p, chk: checkBarcode(codeOf(p)) }))
    .filter((x) => x.chk.warn === 'sai_so_kiem_tra'),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [items, priceListId]);

  /* Tem quá hẹp so với độ dài mã: vạch mảnh hơn ngưỡng máy in nhiệt in nổi */
  const tooNarrow = useMemo(() => items
    .map((p) => ({ p, fit: fitModuleWidth(codeOf(p), size.w - 3) }))
    .filter((x) => x.fit?.tooNarrow),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [items, size.w]);

  /* Dàn tem thành mảng phẳng để in */
  const labels = useMemo(() => {
    const out = [];
    for (const p of items) {
      const c = Number(p.count) || 0;
      for (let i = 0; i < c; i++) out.push(p);
    }
    return out;
  }, [items]);

  const patchItem = (key, patch) => setItems((prev) => prev.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const setCount = (key, v) => patchItem(key, { count: Math.max(0, Number(v) || 0) });

  /** Dòng nhập đơn vị lớn: đổi giữa tem đơn vị lớn và tem lẻ, số tem đổi theo. */
  const chooseBulk = (p, mode) => {
    const base = p.units.find((u) => u.factor === 1) || p.units[0];
    if (mode === 'unit') patchItem(p.key, { unitId: p.bulk.unit.id, count: Math.round(p.bulk.qty) });
    else patchItem(p.key, { unitId: base.id, count: Math.round(p.bulk.qty * p.bulk.factor) });
  };

  const saveDefaults = async () => {
    try {
      await saveSettings({
        labels: {
          size: sizeKey, price_list_id: priceListId,
          show_store: show.store, show_name: show.name,
          show_price: show.price, show_unit: show.unit, show_sku: show.sku,
        },
      });
      toast('Đã lưu thiết lập tem làm mặc định', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  /* Bộ cột cho phần mềm in tem ngoài (plan 30, §8.3): mỗi dòng một đơn vị */
  const exportCsv = () => {
    const head = ['Mã vạch', 'Tên sản phẩm', 'Đơn vị tính', 'Giá bán', 'Số lượng tem'];
    const rows = items.filter((p) => Number(p.count) > 0 && codeOf(p))
      .map((p) => [codeOf(p), p.name, unitOf(p)?.unit_name || p.base_unit, priceOf(p), Number(p.count)]);
    if (!rows.length) return;
    const csv = String.fromCharCode(0xfeff) + [head, ...rows]
      .map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `tem-ma-vach-${rows.length}-dong.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!open) return null;

  const Check = ({ k, label }) => (
    <label className="flex items-center gap-1.5 text-[13px] cursor-pointer">
      <input
        type="checkbox"
        className="w-4 h-4 accent-emerald-700 cursor-pointer"
        checked={show[k]}
        onChange={(e) => setShow((s) => ({ ...s, [k]: e.target.checked }))}
      />
      {label}
    </label>
  );

  const breakdown = items.filter((p) => Number(p.count) > 0)
    .map((p) => `${n(p.count)} tem ${p.name} (${unitOf(p)?.unit_name || p.base_unit})`);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="In tem mã vạch"
        subtitle={`${n(items.length)} mặt hàng · ${n(totalLabels)} tem sẽ in`}
        size="xl"
        footer={<>
          <Button onClick={onClose}>Đóng</Button>
          <Button onClick={saveDefaults}>Lưu làm mặc định</Button>
          {can('data.export') && (
            <Button icon={FileDown} onClick={exportCsv} disabled={!totalLabels}
              title="Mã vạch · Tên sản phẩm · Đơn vị tính · Giá bán · Số lượng tem — cho phần mềm in tem riêng">
              Xuất file in tem
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="primary" icon={Printer} onClick={() => setAsking(true)} disabled={!totalLabels}>
            In {n(totalLabels)} tem
          </Button>
        </>}
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Khổ tem" hint="Chọn đúng khổ giấy đang lắp trong máy in tem" htmlFor="lb-size">
              <Select id="lb-size" value={sizeKey} onChange={(e) => setSizeKey(e.target.value)}>
                {LABEL_SIZES.map((s) => (
                  <option key={s.key} value={s.key}>{s.name} — {s.hint}</option>
                ))}
              </Select>
            </Field>
            <Field label="Giá in trên tem" htmlFor="lb-pl">
              <Select id="lb-pl" value={priceListId || ''} onChange={(e) => setPriceListId(Number(e.target.value))}>
                {meta.priceLists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          </div>

          <div>
            <span className="label">Nội dung in trên tem</span>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              <Check k="store" label="Tên cửa hàng" />
              <Check k="name" label="Tên hàng" />
              <Check k="price" label="Giá bán" />
              <Check k="unit" label="Đơn vị tính" />
              <Check k="sku" label="Mã hàng" />
            </div>
          </div>

          {noCode.length > 0 && (
            <div className="card p-2.5 bg-amber-50 border-warn/30 text-[13px] flex gap-2">
              <AlertTriangle size={15} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
              <span className="text-amber-900">
                {noCode.length} mặt hàng chưa có mã vạch lẫn mã hàng nên không in tem được:{' '}
                <b>{noCode.slice(0, 3).map((p) => p.name).join(', ')}</b>
                {noCode.length > 3 && ` và ${noCode.length - 3} mặt khác`}.
              </span>
            </div>
          )}

          {tooNarrow.length > 0 && (
            <div className="card p-2.5 bg-amber-50 border-warn/30 text-[13px] flex gap-2">
              <AlertTriangle size={15} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
              <span className="text-amber-900">
                Mã của <b>{tooNarrow[0].p.name}</b>
                {tooNarrow.length > 1 && ` và ${tooNarrow.length - 1} mặt khác`} quá dài so với
                khổ tem {size.name}: vạch phải in mảnh tới mức máy quét khó đọc.
                {' '}Nên chọn khổ tem rộng hơn (cần ít nhất{' '}
                <b>{Math.ceil(tooNarrow[0].fit.needMm + 3)} mm</b> bề ngang).
              </span>
            </div>
          )}

          {badCheck.length > 0 && (
            <div className="card p-2.5 bg-amber-50 border-warn/30 text-[13px] flex gap-2">
              <AlertTriangle size={15} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
              <span className="text-amber-900">
                <b>{badCheck.length} mã vạch 13 chữ số có số kiểm tra sai.</b>{' '}
                Tem vẫn in và máy quét của tiệm vẫn đọc được, nhưng máy quét theo
                chuẩn siêu thị thì không. Ví dụ: <b>{badCheck[0].p.name}</b> đang là{' '}
                <span className="font-mono">{codeOf(badCheck[0].p)}</span>, đúng ra phải là{' '}
                <span className="font-mono font-bold">{badCheck[0].chk.suggest}</span>.
              </span>
            </div>
          )}

          {/* Số tem cho từng mặt hàng */}
          {items.length === 0 ? (
            <Empty icon={Tag} title="Chưa chọn hàng nào" message="Chọn hàng ở danh sách hàng hoá rồi bấm In tem." />
          ) : (
            <div className="table-wrap max-h-64 overflow-y-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>Mã hàng</th><th>Tên hàng</th><th style={{ width: 130 }}>Tem đơn vị</th><th>Mã vạch</th>
                    <th className="text-right">Giá in</th>
                    <th style={{ width: 130 }} className="text-right">Số tem</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => {
                    const unit = unitOf(p);
                    const base = p.units.find((u) => u.factor === 1) || p.units[0];
                    return (
                      <tr key={p.key} className={!codeOf(p) ? 'bg-red-50' : ''}>
                        <td className="font-mono text-muted-ink">{p.sku}</td>
                        <td>
                          <div className="font-semibold">{p.name}</div>
                          {/* Nhập đơn vị lớn: in tem dán hộp hay tem lẻ dán từng cái (plan 30, §8.2) */}
                          {p.bulk && (
                            <div role="radiogroup" aria-label={`Kiểu tem cho ${p.name}`} className="mt-1 space-y-0.5 text-2xs">
                              {[['base', `${n(Math.round(p.bulk.qty * p.bulk.factor))} tem lẻ — dán từng ${base.unit_name} (${fq(p.bulk.qty)} × ${fq(p.bulk.factor)})`],
                                ['unit', `${n(Math.round(p.bulk.qty))} tem ${p.bulk.unit.unit_name} — dán lên ${p.bulk.unit.unit_name}`]].map(([k, lb]) => (
                                <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                                  <input type="radio" name={`bulk-${p.key}`} className="accent-emerald-700 cursor-pointer"
                                    checked={k === 'unit' ? unit?.id === p.bulk.unit.id : unit?.id !== p.bulk.unit.id}
                                    onChange={() => chooseBulk(p, k)} />
                                  {lb}
                                </label>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>
                          {p.units.length > 1 ? (
                            <Select size="sm" value={p.unitId} aria-label={`Đơn vị in tem của ${p.name}`}
                              onChange={(e) => patchItem(p.key, { unitId: Number(e.target.value) })}>
                              {p.units.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.unit_name}{u.factor > 1 ? ` (${fq(u.factor)})` : ''}{u.barcode ? ' · có mã riêng' : ''}
                                </option>
                              ))}
                            </Select>
                          ) : <span className="text-muted-ink">{unit?.unit_name || p.base_unit}</span>}
                        </td>
                        <td className="font-mono text-2xs">
                          {codeOf(p) || <span className="text-danger">chưa có</span>}
                        </td>
                        <td className="num">{money(priceOf(p))}</td>
                        <td>
                          <div className="flex items-center justify-end gap-1">
                            <IconButton icon={Minus} label={`Bớt tem ${p.name}`} variant="outline" size={12}
                              onClick={() => setCount(p.key, (p.count || 0) - 1)} />
                            <input
                              type="number" min="0"
                              className="field field-sm num !w-14"
                              value={p.count}
                              aria-label={`Số tem của ${p.name}`}
                              onChange={(e) => setCount(p.key, e.target.value)}
                            />
                            <IconButton icon={Plus} label={`Thêm tem ${p.name}`} variant="outline" size={12}
                              onClick={() => setCount(p.key, (p.count || 0) + 1)} />
                          </div>
                        </td>
                        <td>
                          <IconButton icon={Trash2} label={`Bỏ ${p.name}`} size={14}
                            className="!text-danger hover:!bg-red-50"
                            onClick={() => setItems((prev) => prev.filter((x) => x.key !== p.key))} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Xem trước */}
          <div>
            <span className="label">Xem trước (kích thước thật)</span>
            <div className="border border-line rounded-lg bg-slate-100 p-3 overflow-auto max-h-56">
              <div className="flex flex-wrap gap-1">
                {labels.slice(0, 12).map((p, i) => (
                  <LabelBox key={i} p={p} unitName={unitOf(p)?.unit_name || p.base_unit} size={size} show={show}
                    store={store} code={codeOf(p)} price={priceOf(p)} />
                ))}
                {labels.length > 12 && (
                  <div className="flex items-center text-[13px] text-muted-ink px-2">
                    và {n(labels.length - 12)} tem nữa...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <Confirm
        open={asking}
        onClose={() => setAsking(false)}
        danger={false}
        title={`In ${n(totalLabels)} tem?`}
        confirmText={`In ${n(totalLabels)} tem`}
        message={`${breakdown.slice(0, 6).join(' · ')}${breakdown.length > 6 ? ` · và ${breakdown.length - 6} dòng nữa` : ''}. Soát lại số tem trước khi in — in nhầm là tốn cả cuộn giấy.`}
        onConfirm={() => { setAsking(false); setTimeout(() => window.print(), 50); }}
      />

      {/* Vùng in thật */}
      <div className="print-area print-labels">
        {labels.map((p, i) => (
          <LabelBox key={i} p={p} unitName={unitOf(p)?.unit_name || p.base_unit} size={size} show={show}
            store={store} code={codeOf(p)} price={priceOf(p)} forPrint />
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function LabelBox({ p, unitName, size, show, store, code, price, forPrint }) {
  if (!code) return null;

  /* Bề rộng vạch tính THEO ĐỘ DÀI MÃ và chỗ trống thật trên tem.

     Trước đây con số này đặt cứng theo khổ tem: mã ngắn thì thừa chỗ,
     mã 13 chữ số thì rộng gần gấp đôi bề ngang tem và bị cắt mất mấy số
     cuối — mà cắt xong trông vẫn như một mã vạch bình thường, nên không
     ai biết là tem hỏng cho tới lúc quét không ra. */
  const padMm = 1.5 * 2;                       // lề trái phải của ô tem
  const avail = size.w - padMm;
  const fit = fitModuleWidth(code, avail, size.w >= 50 ? 0.4 : 0.34);
  const barH = size.h <= 22 ? 26 : size.h <= 30 ? 34 : 44;

  /* mm -> px để vẽ SVG (96 chấm mỗi inch) */
  const modWidth = fit ? (fit.mm / 25.4) * 96 : 1.1;
  const svg = barcodeSvg(code, { width: modWidth, height: barH, showText: true, fontSize: 8 });

  return (
    <div
      className="label-box"
      style={{
        width: `${size.w}mm`,
        height: `${size.h}mm`,
        border: forPrint ? 'none' : '1px dashed #cbd5e1',
        background: '#fff',
        padding: '1mm 1.5mm',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        boxSizing: 'border-box',
        color: '#000',
        breakInside: 'avoid',
      }}
    >
      {show.store && store?.name && (
        <div style={{ fontSize: '5.5pt', fontWeight: 700, lineHeight: 1.1, textAlign: 'center',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
          {store.name}
        </div>
      )}
      {show.name && (
        <div style={{ fontSize: size.h >= 30 ? '7pt' : '6pt', fontWeight: 600, lineHeight: 1.15,
          textAlign: 'center', maxWidth: '100%',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {p.name}
        </div>
      )}
      <div
        style={{ lineHeight: 0, margin: '0.3mm 0', maxWidth: '100%' }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div style={{ display: 'flex', gap: '2mm', alignItems: 'baseline', maxWidth: '100%' }}>
        {show.price && (
          <span style={{ fontSize: size.h >= 30 ? '9pt' : '8pt', fontWeight: 800, whiteSpace: 'nowrap' }}>
            {n(price)} đ
          </span>
        )}
        {show.unit && (
          <span style={{ fontSize: '6pt', whiteSpace: 'nowrap' }}>/{unitName}</span>
        )}
      </div>
      {show.sku && (
        <div style={{ fontSize: '5.5pt', fontFamily: 'monospace' }}>{p.sku}</div>
      )}
    </div>
  );
}
