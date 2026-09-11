/* ====================================================================
   DÒNG GIỎ HÀNG VÀ GHI CHÚ HOÁ ĐƠN (tài liệu 06)

   Giỏ hàng trên màn hình bán hàng chật: ô giảm giá từng dòng ẩn đi, chỉ
   hiện khi thật sự có giảm. Hai cách giảm:

     A. Sửa thẳng ô THÀNH TIỀN: gõ số thấp hơn, phần mềm tự tính ngược
        ra tiền giảm và % giảm, rồi hiện dòng phụ "Giảm giá: Xđ (Y%)".
     B. Bấm icon thẻ giảm giá: chọn giảm theo số tiền hoặc theo %.

   Ô tiền chỉ ghi nhận khi rời ô (hoặc Enter) chứ không ghi từng phím gõ:
   giảm vượt hạn mức phải hỏi PIN quản lý, hỏi giữa lúc đang gõ dở "1" của
   "150.000" là sai.
   ==================================================================== */
import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Minus, Trash2, History, StickyNote, Tag, X } from 'lucide-react';
import { n, qty as fq } from '../lib/format';
import { IconButton, Badge } from './ui';

/** Tiền một dòng: giảm theo % tiền hàng dòng, hoặc số tiền cố định; không giảm quá tiền hàng. */
export const lineAmount = (l) => {
  const gross = Math.round(l.qty * l.price);
  const disc = l.discountType === 'percent'
    ? Math.round(gross * (Number(l.discountValue) || 0) / 100)
    : Math.round(Number(l.discountValue) || 0);
  return { gross, disc: Math.min(disc, gross), amount: gross - Math.min(disc, gross) };
};

/** % giảm hiển thị, một chữ số lẻ, dấu phẩy kiểu Việt. */
export const pctText = (disc, gross) => {
  const p = gross > 0 ? disc / gross * 100 : 0;
  return (Math.round(p * 10) / 10).toLocaleString('vi-VN');
};

/**
 * Ô tiền ghi nhận khi rời ô hoặc Enter; Esc thì bỏ số đang gõ.
 * Hiện số có dấu chấm ngăn nghìn cả lúc đang gõ.
 */
export function MoneyCell({ value, onCommit, label, className = '', size = 'sm', title }) {
  const [text, setText] = useState(null);         // null = không đang sửa
  const cancel = useRef(false);

  const commit = () => {
    if (cancel.current) { cancel.current = false; setText(null); return; }
    if (text === null) return;
    const v = parseInt(String(text).replace(/\D/g, ''), 10) || 0;
    setText(null);
    if (v !== Math.round(Number(value) || 0)) onCommit(v);
  };

  return (
    <input
      className={`field ${size === 'sm' ? 'field-sm' : ''} num ${className}`}
      inputMode="numeric"
      aria-label={label}
      title={title}
      value={text ?? n(value)}
      onFocus={(e) => {
        setText(n(value));
        const el = e.target;
        requestAnimationFrame(() => el.select());
      }}
      onChange={(e) => {
        const raw = e.target.value.replace(/\D/g, '');
        setText(raw === '' ? '' : n(parseInt(raw, 10)));
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.stopPropagation(); cancel.current = true; e.currentTarget.blur(); }
      }}
    />
  );
}

/** Ô phần trăm ghi nhận khi rời ô — dùng cho giảm cả đơn theo %. */
export function PercentCell({ value, onCommit, label, className = '' }) {
  const [text, setText] = useState(null);
  const cancel = useRef(false);

  const commit = () => {
    if (cancel.current) { cancel.current = false; setText(null); return; }
    if (text === null) return;
    const v = Math.min(100, Math.max(0, Number(String(text).replace(',', '.')) || 0));
    setText(null);
    if (v !== (Number(value) || 0)) onCommit(v);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      className={`field field-sm num ${className}`}
      aria-label={label}
      value={text ?? String(Number(value) || 0)}
      onFocus={(e) => {
        setText(String(Number(value) || 0));
        const el = e.target;
        requestAnimationFrame(() => el.select());
      }}
      onChange={(e) => setText(e.target.value.replace(/[^\d.,]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.stopPropagation(); cancel.current = true; e.currentTarget.blur(); }
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Bảng nhỏ giảm giá dòng — cơ chế B                                   */
/* ------------------------------------------------------------------ */

/**
 * Nổi lên cạnh icon thẻ giảm giá. Gắn vào body chứ không nằm trong danh
 * sách giỏ hàng: danh sách có thanh cuộn riêng, đặt bên trong thì dòng cuối
 * giỏ bấm ra bảng bị cắt mất nửa dưới.
 */
function DiscountPopover({ anchor, l, gross, showCost, onApply, onClose }) {
  const [type, setType] = useState(l.discountType === 'percent' ? 'percent' : 'amount');
  const [val, setVal] = useState(String(Number(l.discountValue) || 0));
  const [pos, setPos] = useState(null);
  const box = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const h = box.current?.offsetHeight || 300;
    const w = 280;
    const below = window.innerHeight - r.bottom > h + 8;
    setPos({
      top: below ? r.bottom + 4 : Math.max(8, r.top - h - 4),
      left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)),
    });
  }, [anchor]);

  useEffect(() => {
    const close = () => closeRef.current();
    const onDown = (e) => {
      if (!box.current?.contains(e.target) && !anchor.contains(e.target)) close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    };
    const onScroll = (e) => {
      if (!box.current?.contains(e.target)) close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      anchor.focus?.();
    };
  }, [anchor]);

  const v = Math.max(0, Number(String(val).replace(',', '.')) || 0);
  const disc = type === 'percent'
    ? Math.round(gross * Math.min(100, v) / 100)
    : Math.min(Math.round(v), gross);
  const after = gross - disc;
  const cost = Math.round(l.qty * (l.factor || 1) * (l.cost_price || 0));
  const lastIn = l.last_purchase_price > 0
    ? Math.round(l.qty * (l.factor || 1) * l.last_purchase_price) : null;

  const apply = () => onApply(type, type === 'percent' ? Math.min(100, v) : Math.min(Math.round(v), gross));

  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label={`Giảm giá cho ${l.name}`}
      className="fixed z-[55] card shadow-pop p-3 space-y-2.5"
      style={pos ? { top: pos.top, left: pos.left, width: 280 } : { top: -9999, left: -9999, width: 280 }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold">Giảm giá dòng</span>
        <IconButton icon={X} size={14} label="Đóng bảng giảm giá" onClick={onClose} />
      </div>
      <div className="text-2xs text-muted-ink truncate -mt-1.5">
        {l.name} · {fq(l.qty)} {l.unit_name} × {n(l.price)}
      </div>

      <div className="grid grid-cols-2 rounded border border-line overflow-hidden" role="radiogroup" aria-label="Kiểu giảm giá">
        {[['amount', 'Số tiền (đ)'], ['percent', 'Phần trăm (%)']].map(([k, lb]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={type === k}
            onClick={() => { if (type !== k) { setType(k); setVal('0'); } }}
            className={`h-8 text-[13px] font-semibold cursor-pointer transition-colors duration-100
                        ${type === k ? 'bg-primary text-white' : 'bg-card hover:bg-muted'}`}
          >
            {lb}
          </button>
        ))}
      </div>

      <input
        autoFocus
        className="field num"
        inputMode={type === 'percent' ? 'decimal' : 'numeric'}
        aria-label={type === 'percent' ? 'Phần trăm giảm' : 'Số tiền giảm'}
        value={type === 'percent' ? val : (v ? n(v) : '')}
        placeholder="0"
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const raw = e.target.value;
          setVal(type === 'percent' ? raw.replace(/[^\d.,]/g, '') : String(parseInt(raw.replace(/\D/g, ''), 10) || 0));
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
      />

      {type === 'percent' && (
        <div className="flex gap-1">
          {[5, 10, 15, 20].map((p) => (
            <button
              key={p}
              type="button"
              className={`btn btn-sm flex-1 ${v === p ? 'btn-soft' : 'btn-outline'}`}
              onClick={() => setVal(String(p))}
            >
              {p}%
            </button>
          ))}
        </div>
      )}

      <div className="rounded bg-muted/60 p-2 text-[13px] space-y-0.5">
        <div className="flex justify-between">
          <span className="text-muted-ink">Tiền hàng</span>
          <span className="tabular">{n(gross)}</span>
        </div>
        <div className="flex justify-between text-danger">
          <span>Giảm</span>
          <span className="tabular">−{n(disc)} ({pctText(disc, gross)}%)</span>
        </div>
        <div className="flex justify-between font-bold border-t border-line pt-0.5">
          <span>Thành tiền</span>
          <span className="tabular">{n(after)}</span>
        </div>
        {/* Thấy luôn biên lãi ngay lúc quyết mức giảm — tránh giảm quá tay thành bán lỗ */}
        {showCost && (
          <div className="border-t border-line pt-0.5 text-2xs text-muted-ink space-y-0.5">
            <div className="flex justify-between"><span>Giá vốn</span><span className="tabular">{n(cost)}</span></div>
            {lastIn !== null && (
              <div className="flex justify-between">
                <span>Theo giá nhập gần nhất</span><span className="tabular">{n(lastIn)}</span>
              </div>
            )}
            <div className={`flex justify-between font-semibold ${after - cost < 0 ? 'text-danger' : 'text-emerald-700'}`}>
              <span>Lãi sau giảm</span><span className="tabular">{n(after - cost)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-1.5">
        <button
          type="button"
          className="btn btn-sm btn-outline flex-1"
          onClick={() => onApply('amount', 0)}
          disabled={!(Number(l.discountValue) > 0)}
        >
          Bỏ giảm
        </button>
        <button type="button" className="btn btn-sm btn-primary flex-1" onClick={apply}>Áp dụng</button>
      </div>
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ */
/* Một dòng giỏ hàng                                                   */
/* ------------------------------------------------------------------ */

export function CartLine({
  l, hist, showCost, onQty, onUnit, onPrice, onAmount, onDiscount, onRemove, onHistory, onNote,
}) {
  const { gross, disc, amount } = lineAmount(l);
  const [tagAnchor, setTagAnchor] = useState(null);
  const overStock = l.track_stock && l.qty * l.factor > l.stock;
  const cost = Math.round(l.qty * (l.factor || 1) * (l.cost_price || 0));
  const profit = amount - cost;

  return (
    <li className="p-2.5 hover:bg-muted/40 transition-colors duration-100">
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-snug">{l.name}</div>
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <span className="text-2xs text-muted-ink font-mono">{l.sku}</span>
            {/* Dòng phụ chỉ hiện khi thật sự có giảm — không giảm thì giỏ gọn */}
            {disc > 0 && (
              <button
                type="button"
                onClick={(e) => setTagAnchor(e.currentTarget)}
                className="text-2xs font-semibold text-danger bg-red-50 border border-danger/25 rounded px-1
                           leading-5 tabular cursor-pointer hover:bg-red-100 transition-colors duration-100"
                aria-label={`Giảm giá ${n(disc)} đồng (${pctText(disc, gross)}%) — bấm để sửa mức giảm`}
              >
                Giảm giá: {n(disc)}đ ({pctText(disc, gross)}%)
              </button>
            )}
          </div>
        </div>

        {hist?.length > 0 && (
          <button
            type="button"
            onClick={onHistory}
            className="btn btn-sm !min-h-[28px] !px-1.5 btn-outline shrink-0"
            title={`Giá đã bán cho khách này: ${hist.map((h) => n(h.price)).join(' · ')}`}
          >
            <History size={12} aria-hidden="true" />
            <span className="text-2xs tabular">{n(hist[0].price)}</span>
          </button>
        )}
        <IconButton
          icon={Tag}
          size={14}
          label={disc > 0 ? `Sửa giảm giá ${l.name}` : `Giảm giá ${l.name}`}
          className={disc > 0 ? '!text-danger' : ''}
          aria-expanded={!!tagAnchor}
          aria-haspopup="dialog"
          onClick={(e) => setTagAnchor(tagAnchor ? null : e.currentTarget)}
        />
        <IconButton
          icon={StickyNote}
          size={14}
          label={`Ghi chú và bảo hành cho ${l.name}`}
          className={l.note || l.warrantyMonths > 0 ? '!text-info' : ''}
          onClick={onNote}
        />
        <IconButton icon={Trash2} size={14} label={`Bỏ ${l.name} khỏi giỏ`}
          className="!text-danger hover:!bg-red-50" onClick={onRemove} />
      </div>

      <div className="flex items-center gap-1.5 mt-1.5">
        <div className="flex items-center border border-line rounded overflow-hidden shrink-0">
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center hover:bg-muted transition-colors duration-100 cursor-pointer"
            aria-label={`Giảm số lượng ${l.name}`}
            onClick={() => onQty(Math.max(0.01, l.qty - 1))}
          >
            <Minus size={13} aria-hidden="true" />
          </button>
          <input
            type="number" step="any" min="0"
            className="w-12 h-7 text-center text-[13px] tabular font-mono border-x border-line
                       focus:outline-none focus:bg-accent-soft/50"
            aria-label={`Số lượng ${l.name}`}
            value={l.qty}
            onFocus={(e) => e.target.select()}
            onChange={(e) => onQty(e.target.value === '' ? '' : Number(e.target.value))}
            onBlur={(e) => { if (!Number(e.target.value)) onQty(1); }}
          />
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center hover:bg-muted transition-colors duration-100 cursor-pointer"
            aria-label={`Tăng số lượng ${l.name}`}
            onClick={() => onQty(l.qty + 1)}
          >
            <Plus size={13} aria-hidden="true" />
          </button>
        </div>

        {l.units?.length > 1 ? (
          <select
            className="field field-sm !w-auto shrink-0 text-2xs"
            value={l.unit_id}
            onChange={(e) => onUnit(e.target.value)}
            aria-label={`Đơn vị tính của ${l.name}`}
          >
            {l.units.map((u) => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
          </select>
        ) : (
          <span className="text-2xs text-muted-ink px-0.5 shrink-0">{l.unit_name}</span>
        )}

        <MoneyCell
          value={l.price}
          onCommit={onPrice}
          label={`Đơn giá ${l.name}`}
          title="Đơn giá"
          className="flex-1 min-w-0"
        />
        <MoneyCell
          value={amount}
          onCommit={onAmount}
          label={`Thành tiền ${l.name} — gõ số thấp hơn để giảm giá`}
          title="Thành tiền — gõ số thấp hơn để giảm giá"
          className="!w-[104px] shrink-0 font-bold bg-accent-soft/25"
        />
      </div>

      <div className="flex items-start justify-between gap-2 mt-1">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {l.factor > 1 && (
            <span className="text-2xs text-muted-ink tabular">= {fq(l.qty * l.factor)} {l.base_unit}</span>
          )}
          {overStock && <Badge tone="bad">Vượt tồn ({fq(l.stock)} {l.base_unit})</Badge>}
          {l.note && <span className="text-2xs text-info truncate max-w-[180px]">Ghi chú: {l.note}</span>}
          {l.warrantyMonths > 0 && <Badge tone="ok">BH {l.warrantyMonths} tháng</Badge>}
          {l.serial && <span className="text-2xs text-muted-ink font-mono">SN {l.serial}</span>}
        </div>
        {/* Giá vốn và giá nhập gần nhất đặt song song: vốn bình quân có khi
            còn thấp trong khi lô vừa nhập đã lên giá — nhìn một số dễ giảm lố */}
        {showCost && (
          <span className={`text-2xs tabular shrink-0 text-right leading-tight
                            ${profit < 0 ? 'text-danger font-bold' : 'text-muted-ink'}`}>
            Vốn {n(l.cost_price)}
            {l.last_purchase_price > 0 && <> · nhập gần nhất {n(l.last_purchase_price)}</>}
            <span className="block">lãi {n(profit)}</span>
          </span>
        )}
      </div>

      {tagAnchor && (
        <DiscountPopover
          anchor={tagAnchor}
          l={l}
          gross={gross}
          showCost={showCost}
          onClose={() => setTagAnchor(null)}
          onApply={(type, value) => { setTagAnchor(null); onDiscount(type, value); }}
        />
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Ghi chú hoá đơn                                                     */
/* ------------------------------------------------------------------ */

/** Ghi chú cả đơn, in trên hoá đơn. Tối đa 255 ký tự — máy chủ cũng cắt đúng chừng đó. */
export function OrderNote({ value, onChange }) {
  const [focus, setFocus] = useState(false);
  const len = (value || '').length;
  return (
    <div className="relative mb-2">
      <StickyNote size={13} className="absolute left-2 top-[9px] text-muted-ink pointer-events-none" aria-hidden="true" />
      <textarea
        className="field !h-auto pl-7 pr-14 py-1.5 text-[13px] leading-snug resize-none"
        rows={focus || len > 45 ? 2 : 1}
        maxLength={255}
        value={value || ''}
        onChange={(e) => onChange(e.target.value.slice(0, 255))}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        placeholder="Ghi chú hoá đơn (in trên hoá đơn) — VD: giao gấp trước 17h"
        aria-label="Ghi chú hoá đơn, tối đa 255 ký tự"
      />
      {(focus || len > 200) && (
        <span
          className={`absolute right-2 bottom-1.5 text-2xs tabular ${len >= 255 ? 'text-danger font-semibold' : 'text-muted-ink'}`}
          aria-live="polite"
        >
          {len}/255
        </span>
      )}
    </div>
  );
}
