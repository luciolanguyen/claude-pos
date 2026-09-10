import { useState, useEffect, useMemo } from 'react';
import { Printer, Tag, Plus, Minus, Trash2, AlertTriangle } from 'lucide-react';
import {
  barcodeSvg, LABEL_SIZES, getLabelSize, fitModuleWidth, checkBarcode,
} from '../lib/barcode';
import { useApp, useFetch } from '../lib/store';
import { api } from '../lib/api';
import { money, n } from '../lib/format';
import { Modal, Button, Select, Field, Input, Empty, Badge, IconButton } from './ui';

/**
 * In tem mã vạch dán lên hàng hoá.
 * Mã vạch sinh tại chỗ bằng Code 128 nên không cần Internet.
 */
export default function PrintLabels({ open, onClose, products = [] }) {
  const { store, settings, saveSettings, toast } = useApp();
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
  const { meta, defaultWarehouse } = useApp();

  // Danh sách hàng hoá không kèm giá bán, nên lấy thêm từ API bán hàng
  const { data: priced } = useFetch(
    () => api.posProducts({ warehouse_id: defaultWarehouse }),
    [defaultWarehouse], { skip: !open }
  );

  useEffect(() => {
    if (!open) return;
    const byId = new Map((priced || []).map((p) => [p.id, p]));
    setItems(products.map((p) => {
      const full = byId.get(p.id);
      return {
        ...p,
        units: full?.units?.length ? full.units : [{ unit_name: p.base_unit, factor: 1, prices: {} }],
        // Gọi từ phiếu nhập thì đề sẵn đúng số lượng vừa nhập về
        count: p.defaultCount ?? 1,
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

  /* Mã vạch: ưu tiên mã vạch của hàng, không có thì dùng mã hàng */
  const codeOf = (p) => (p.barcode?.trim() || p.sku || '').trim();
  const priceOf = (p) => {
    const base = p.units?.find((u) => u.factor === 1) || p.units?.[0];
    return base?.prices?.[priceListId] ?? 0;
  };

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

  const setCount = (id, v) =>
    setItems((prev) => prev.map((x) => x.id === id ? { ...x, count: Math.max(0, Number(v) || 0) } : x));

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
          <div className="flex-1" />
          <Button variant="primary" icon={Printer} onClick={() => window.print()} disabled={!totalLabels}>
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
            <div className="table-wrap max-h-56 overflow-y-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>Mã hàng</th><th>Tên hàng</th><th>Mã vạch</th>
                    <th className="text-right">Giá in</th>
                    <th style={{ width: 130 }} className="text-right">Số tem</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} className={!codeOf(p) ? 'bg-red-50' : ''}>
                      <td className="font-mono text-muted-ink">{p.sku}</td>
                      <td className="font-semibold">{p.name}</td>
                      <td className="font-mono text-2xs">
                        {codeOf(p) || <span className="text-danger">chưa có</span>}
                      </td>
                      <td className="num">{money(priceOf(p))}</td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          <IconButton icon={Minus} label={`Bớt tem ${p.name}`} variant="outline" size={12}
                            onClick={() => setCount(p.id, (p.count || 0) - 1)} />
                          <input
                            type="number" min="0"
                            className="field field-sm num !w-14"
                            value={p.count}
                            aria-label={`Số tem của ${p.name}`}
                            onChange={(e) => setCount(p.id, e.target.value)}
                          />
                          <IconButton icon={Plus} label={`Thêm tem ${p.name}`} variant="outline" size={12}
                            onClick={() => setCount(p.id, (p.count || 0) + 1)} />
                        </div>
                      </td>
                      <td>
                        <IconButton icon={Trash2} label={`Bỏ ${p.name}`} size={14}
                          className="!text-danger hover:!bg-red-50"
                          onClick={() => setItems((prev) => prev.filter((x) => x.id !== p.id))} />
                      </td>
                    </tr>
                  ))}
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
                  <LabelBox key={i} p={p} size={size} show={show} store={store}
                    code={codeOf(p)} price={priceOf(p)} />
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

      {/* Vùng in thật */}
      <div className="print-area print-labels">
        {labels.map((p, i) => (
          <LabelBox key={i} p={p} size={size} show={show} store={store}
            code={codeOf(p)} price={priceOf(p)} forPrint />
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function LabelBox({ p, size, show, store, code, price, forPrint }) {
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
          <span style={{ fontSize: '6pt', whiteSpace: 'nowrap' }}>/{p.base_unit}</span>
        )}
      </div>
      {show.sku && (
        <div style={{ fontSize: '5.5pt', fontFamily: 'monospace' }}>{p.sku}</div>
      )}
    </div>
  );
}
