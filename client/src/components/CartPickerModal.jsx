/* ====================================================================
   HỘP CHỌN HÀNG ĐỒNG BỘ HAI CHIỀU (tài liệu 15, mục 3)

   Dùng chung cho MỌI loại phiếu bên trang quản lý: nhập hàng NCC, trả hàng
   NCC, đơn đặt hàng của khách, và phiếu mua hàng tạm sinh từ phiếu báo hết
   hàng.

   Bên trái tìm hàng / quét mã vạch, bên phải là giỏ thu nhỏ của đúng phiếu
   đang làm. Giỏ KHÔNG giữ bản sao dữ liệu: nó đọc và sửa thẳng danh sách
   dòng của phiếu chính, nên sửa ở đâu cũng thấy ngay ở chỗ kia — khỏi lo
   hai bên lệch nhau.

   Mỗi loại phiếu một màu và một biểu tượng riêng (mục 3.4), để nhân viên
   kho không nhầm đang nhập hàng vào với đang trả hàng đi.
   ==================================================================== */
import { useState, useMemo, useEffect } from 'react';
import {
  Search, Plus, Minus, Trash2, PackagePlus, Undo2, ClipboardList, ShoppingCart,
} from 'lucide-react';
import { useApp } from '../lib/store';
import { money, n, qty as fq, matchMode } from '../lib/format';
import {
  Button, IconButton, SearchInput, Modal, Empty, Spinner, Badge, QtyInput, MoneyInput,
} from './ui';
import { CategorySelect, categoryBranch } from './CategoryTree';

/**
 * Màu và biểu tượng theo loại phiếu. `ring` dùng cho khung hộp thoại,
 * `btn` cho nút mở hộp — cùng một màu thì nhìn nút là biết sẽ mở hộp nào.
 */
export const DOC_THEMES = {
  purchase: {
    icon: PackagePlus, label: 'Phiếu nhập hàng NCC', flow: 'Hàng đi vào kho',
    btn: '!bg-blue-600 !border-blue-600 !text-white hover:!bg-blue-700',
    head: 'bg-blue-50 border-blue-200 text-blue-900',
    chip: 'bg-blue-600 text-white',
  },
  purchase_return: {
    icon: Undo2, label: 'Phiếu trả hàng NCC', flow: 'Hàng xuất kho trả lại mối',
    btn: '!bg-orange-600 !border-orange-600 !text-white hover:!bg-orange-700',
    head: 'bg-orange-50 border-orange-200 text-orange-900',
    chip: 'bg-orange-600 text-white',
  },
  sale_order: {
    icon: ClipboardList, label: 'Phiếu đặt hàng của khách', flow: 'Đơn chờ xuất giao',
    btn: '!bg-violet-600 !border-violet-600 !text-white hover:!bg-violet-700',
    head: 'bg-violet-50 border-violet-200 text-violet-900',
    chip: 'bg-violet-600 text-white',
  },
  temp_purchase: {
    icon: ShoppingCart, label: 'Phiếu mua hàng tạm', flow: 'Hàng chuẩn bị mua bổ sung',
    btn: '!bg-emerald-600 !border-emerald-600 !text-white hover:!bg-emerald-700',
    head: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    chip: 'bg-emerald-600 text-white',
  },
};
export const themeOf = (kind) => DOC_THEMES[kind] || DOC_THEMES.purchase;

/** Nút mở hộp chọn hàng, mang màu và biểu tượng của loại phiếu. */
export function CartPickerButton({ kind, count = 0, onClick, size = 'sm', className = '' }) {
  const t = themeOf(kind);
  const Icon = t.icon;
  return (
    <Button
      size={size}
      icon={Icon}
      onClick={onClick}
      className={`${t.btn} ${className}`}
      title={`${t.label} — ${t.flow}`}
    >
      Chọn hàng
      {count > 0 && (
        <span className="ml-1 rounded-full bg-white/25 px-1.5 text-2xs font-bold tabular">
          {n(count)}
        </span>
      )}
    </Button>
  );
}

/**
 * @param lines     danh sách dòng của PHIẾU CHÍNH (không phải bản sao)
 * @param onAdd     (product, qty) — nơi gọi tự lo gộp dòng trùng
 * @param onPatch   (key, patch) — sửa số lượng, đơn giá
 * @param onRemove  (key)
 * @param amountOf  (line) — tiền một dòng, tính đúng theo luật của phiếu đó
 * @param priceOf   (product) — giá đổ sẵn khi thêm, để hiện ở cột giá bên trái
 * @param priceLabel nhãn cột giá: "Giá nhập", "Giá bán"...
 */
export default function CartPickerModal({
  open, onClose, kind = 'purchase', products, busy = false,
  lines = [], onAdd, onPatch, onRemove, amountOf, priceOf, priceLabel = 'Đơn giá',
  editPrice = true, title, subtitle, onCreateRequest, footerNote,
}) {
  const { meta } = useApp();
  const [q, setQ] = useState('');
  const [mode, setMode] = useState('contains');
  const [cat, setCat] = useState('');
  const t = themeOf(kind);
  const Icon = t.icon;

  useEffect(() => { if (open) setQ(''); }, [open]);

  const branch = useMemo(
    () => (cat ? categoryBranch(meta.categories, cat) : null), [meta.categories, cat]);

  const list = useMemo(() => {
    let l = products || [];
    if (branch) l = l.filter((p) => branch.has(p.category_id));
    const k = q.trim();
    if (k) {
      l = l.filter((p) => matchMode(p.name, k, mode) || matchMode(p.alias || '', k, mode)
        || matchMode(p.sku, k, mode) || (p.barcode || '') === k);
    }
    return l.slice(0, 200);
  }, [products, q, mode, branch]);

  /* Mỗi mặt hàng đang có bao nhiêu trong giỏ — để ô bên trái đổi màu */
  const inCart = useMemo(() => {
    const m = new Map();
    for (const l of lines) m.set(l.product_id, (m.get(l.product_id) || 0) + Number(l.qty || 0));
    return m;
  }, [lines]);

  const total = lines.reduce((a, l) => a + (amountOf ? amountOf(l) : Math.round((l.qty || 0) * (l.price || 0))), 0);

  /* Quét mã vạch: khớp đúng mã, hoặc lọc còn đúng một món, thì cho vào giỏ luôn */
  const onScanKey = (e) => {
    if (e.key !== 'Enter') return;
    const code = q.trim();
    if (!code) return;
    const exact = (products || []).find((p) => p.barcode === code || p.sku === code);
    const hit = exact || (list.length === 1 ? list[0] : null);
    if (hit) { e.preventDefault(); onAdd(hit, 1); setQ(''); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title || `Chọn hàng — ${t.label}`}
      subtitle={subtitle || `${t.flow}. Sửa ở đây là phiếu bên dưới đổi theo ngay.`}
      size="xl"
      footer={<>
        <span className="mr-auto text-[13px]">
          {footerNote || 'Tổng tiền hàng'}: <b className="tabular">{money(total)}</b>
        </span>
        {onCreateRequest && (
          <Button icon={Plus} onClick={() => onCreateRequest(q)}>Thêm hàng mới</Button>
        )}
        <Button variant="primary" onClick={onClose}>Xong</Button>
      </>}
    >
      <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 mb-2.5 ${t.head}`}>
        <Icon size={16} aria-hidden="true" />
        <span className="text-[13px] font-bold">{t.label}</span>
        <span className="text-2xs">· {t.flow}</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ------------------------- Tìm hàng ------------------------- */}
        <div className="space-y-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={q}
              onChange={setQ}
              mode={mode}
              onMode={setMode}
              onKeyDown={onScanKey}
              placeholder="Gõ tên, mã hàng hoặc quét mã vạch..."
              className="flex-1 min-w-[14rem]"
              autoFocus
            />
            <CategorySelect value={cat} onChange={setCat} categories={meta.categories}
              className="!w-auto" ariaLabel="Lọc theo nhóm hàng" />
            <Badge tone={lines.length ? 'ok' : 'mute'}>Đã thêm: {n(lines.length)} món</Badge>
          </div>

          {busy && !products ? <Spinner /> : list.length === 0 ? (
            <Empty
              icon={Search}
              title="Không tìm thấy hàng nào"
              message={q
                ? `Không có mặt hàng khớp "${q}"${mode === 'exact' ? ' (đang tìm chính xác)' : ''}.`
                : 'Nhóm hàng này chưa có mặt hàng nào.'}
              action={onCreateRequest && q
                ? <Button variant="primary" icon={Plus} onClick={() => onCreateRequest(q)}>
                    Thêm "{q.trim().slice(0, 24)}" vào danh mục
                  </Button>
                : null}
            />
          ) : (
            <div className="table-wrap max-h-[52vh]">
              <table className="data">
                <thead>
                  <tr>
                    <th>Tên hàng</th>
                    <th className="text-right">Tồn kho</th>
                    <th className="text-right">{priceLabel}</th>
                    <th style={{ width: 96 }} />
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => {
                    const c = inCart.get(p.id) || 0;
                    return (
                      <tr key={p.id} className={c ? 'bg-accent-soft/40' : 'hoverable'}>
                        <td>
                          <div className="font-semibold">{p.name}</div>
                          <div className="text-2xs text-muted-ink">
                            <span className="font-mono">{p.sku}</span>
                            {p.pack_spec && <span> · {p.pack_spec}</span>}
                          </div>
                        </td>
                        <td className={`num ${p.track_stock && p.stock <= 0 ? 'text-danger' : 'text-muted-ink'}`}>
                          {p.track_stock ? `${fq(p.stock)} ${p.base_unit}` : 'Dịch vụ'}
                        </td>
                        <td className="num">{money(priceOf ? priceOf(p) : p.cost_price)}</td>
                        <td className="text-right">
                          <Button size="sm" variant={c ? 'primary' : 'soft'} icon={Plus}
                            onClick={() => onAdd(p, 1)}
                            aria-label={c ? `Thêm 1 ${p.name}, đang có ${fq(c)} trong giỏ` : `Thêm ${p.name}`}>
                            {c ? fq(c) : 'Thêm'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ------------------------ Giỏ thu nhỏ ----------------------- */}
        <aside className="card p-2.5 h-fit" aria-label="Hàng đã chọn trên phiếu">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[13px] font-bold">Giỏ của phiếu</span>
            <span className={`text-2xs font-bold rounded-full px-2 py-0.5 ${t.chip}`}>
              {n(lines.length)} món
            </span>
          </div>
          {lines.length === 0 ? (
            <p className="text-[13px] text-muted-ink py-4 text-center">
              Chưa chọn hàng nào. Bấm <b>Thêm</b> ở danh sách bên trái.
            </p>
          ) : (
            <ul className="divide-y divide-line max-h-[52vh] overflow-y-auto">
              {lines.map((l) => (
                <li key={l.key} className="py-2">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold leading-snug">{l.name}</div>
                      <div className="text-2xs text-muted-ink">
                        {l.unit_name || l.base_unit}
                        {Number(l.factor) > 1 && ` (=${fq(l.factor)} ${l.base_unit})`}
                        {l.pack_spec && ` · ${l.pack_spec}`}
                      </div>
                    </div>
                    <IconButton icon={Trash2} size={14} label={`Bỏ ${l.name} khỏi phiếu`}
                      className="!text-danger hover:!bg-red-50" onClick={() => onRemove(l.key)} />
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    <IconButton icon={Minus} size={14} variant="outline" label={`Bớt 1 ${l.name}`}
                      disabled={Number(l.qty) <= 1}
                      onClick={() => onPatch(l.key, { qty: Math.max(1, Number(l.qty) - 1) })} />
                    <QtyInput value={l.qty} min={1} className="!w-16"
                      onChange={(v) => onPatch(l.key, { qty: Math.max(1, Number(v) || 1) })}
                      aria-label={`Số lượng ${l.name}`} />
                    <IconButton icon={Plus} size={14} variant="outline" label={`Thêm 1 ${l.name}`}
                      onClick={() => onPatch(l.key, { qty: Number(l.qty) + 1 })} />
                    {editPrice ? (
                      <MoneyInput size="sm" value={l.price} className="!w-28 ml-auto"
                        onChange={(v) => onPatch(l.key, { price: v, priceEdited: true })}
                        aria-label={`${priceLabel} ${l.name}`} />
                    ) : (
                      <span className="ml-auto tabular text-[13px]">{money(l.price)}</span>
                    )}
                  </div>
                  <div className="text-right text-[13px] font-semibold tabular mt-0.5">
                    {money(amountOf ? amountOf(l) : Math.round((l.qty || 0) * (l.price || 0)))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </Modal>
  );
}
