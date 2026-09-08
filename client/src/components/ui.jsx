import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Search, ChevronLeft, ChevronRight, Loader2, Inbox, AlertTriangle,
  CheckCircle2, Info, XCircle, ChevronDown,
} from 'lucide-react';
import { n, money } from '../lib/format';

/* ============================== Nút ============================== */

export function Button({
  variant = 'outline', size = 'md', icon: Icon, children, className = '',
  loading = false, disabled, ...rest
}) {
  const v = {
    primary: 'btn-primary', secondary: 'btn-secondary', outline: 'btn-outline',
    ghost: 'btn-ghost', danger: 'btn-danger', soft: 'btn-soft',
  }[variant] || 'btn-outline';
  const s = { sm: 'btn-sm', md: '', lg: 'btn-lg' }[size] || '';
  return (
    <button className={`${v} ${s} ${className}`} disabled={disabled || loading} {...rest}>
      {loading
        ? <Loader2 size={size === 'sm' ? 14 : 16} className="animate-spin" aria-hidden="true" />
        : Icon && <Icon size={size === 'sm' ? 14 : 16} aria-hidden="true" />}
      {children}
    </button>
  );
}

/** Nút chỉ có biểu tượng — bắt buộc có nhãn cho trình đọc màn hình. */
export function IconButton({ icon: Icon, label, variant = 'ghost', size = 16, className = '', ...rest }) {
  const v = {
    primary: 'btn-primary', outline: 'btn-outline', ghost: 'btn-ghost', danger: 'btn-danger',
  }[variant] || 'btn-ghost';
  return (
    <button
      className={`${v} !px-2 ${className}`}
      title={label}
      aria-label={label}
      {...rest}
    >
      <Icon size={size} aria-hidden="true" />
    </button>
  );
}

/* ============================ Ô nhập ============================= */

export function Field({ label, hint, error, required, className = '', children, htmlFor }) {
  return (
    <div className={className}>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}{required && <span className="text-danger ml-0.5" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {error ? <p className="error-text">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function Input({ size = 'md', className = '', ...rest }) {
  const s = { sm: 'field-sm', md: '', lg: 'field-lg' }[size] || '';
  return <input className={`field ${s} ${className}`} {...rest} />;
}

export function Select({ size = 'md', className = '', children, ...rest }) {
  const s = { sm: 'field-sm', md: '', lg: 'field-lg' }[size] || '';
  return <select className={`field ${s} ${className}`} {...rest}>{children}</select>;
}

export function Textarea({ className = '', rows = 3, ...rest }) {
  return <textarea className={`field ${className}`} rows={rows} {...rest} />;
}

/**
 * Ô nhập tiền: hiển thị có dấu chấm ngăn nghìn, trả ra số nguyên.
 * Người dùng gõ "50000" thấy ngay "50.000" nên đỡ nhầm số 0.
 */
export function MoneyInput({ value, onChange, size = 'md', className = '', ...rest }) {
  const [text, setText] = useState(() => (value ? n(value) : ''));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value ? n(value) : '');
  }, [value]);

  const handle = (e) => {
    const raw = e.target.value.replace(/[^\d-]/g, '');
    const num = raw === '' || raw === '-' ? 0 : parseInt(raw, 10);
    setText(raw === '' ? '' : n(num));
    onChange?.(num);
  };

  const s = { sm: 'field-sm', md: '', lg: 'field-lg' }[size] || '';
  return (
    <input
      className={`field ${s} num ${className}`}
      inputMode="numeric"
      value={text}
      onChange={handle}
      onFocus={(e) => { focused.current = true; e.target.select(); }}
      onBlur={() => { focused.current = false; setText(value ? n(value) : ''); }}
      {...rest}
    />
  );
}

/** Ô nhập số lượng, cho phép số lẻ (12,5 mét dây). */
export function QtyInput({ value, onChange, size = 'sm', className = '', min = 0, ...rest }) {
  const s = { sm: 'field-sm', md: '', lg: 'field-lg' }[size] || '';
  return (
    <input
      type="number"
      step="any"
      min={min}
      className={`field ${s} num ${className}`}
      value={value}
      onChange={(e) => onChange?.(e.target.value === '' ? '' : Number(e.target.value))}
      onFocus={(e) => e.target.select()}
      {...rest}
    />
  );
}

export function SearchInput({ value, onChange, placeholder = 'Tìm kiếm...', size = 'md', className = '', autoFocus }) {
  const s = { sm: 'field-sm', md: '', lg: 'field-lg' }[size] || '';
  return (
    <div className={`relative ${className}`}>
      <Search
        size={size === 'lg' ? 18 : 15}
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-ink pointer-events-none"
        aria-hidden="true"
      />
      <input
        type="search"
        className={`field ${s} pl-8`}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Xoá từ khoá tìm kiếm"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-ink hover:text-ink p-0.5 rounded"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/* ============================ Nhãn ============================== */

export function Badge({ tone = 'mute', children, className = '' }) {
  const t = {
    ok: 'badge-ok', warn: 'badge-warn', bad: 'badge-bad',
    info: 'badge-info', mute: 'badge-mute',
  }[tone] || 'badge-mute';
  return <span className={`${t} ${className}`}>{children}</span>;
}

/* ============================ Hộp thoại ========================= */

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', closeOnOverlay = true }) {
  const ref = useRef(null);
  const lastFocused = useRef(null);

  useEffect(() => {
    if (!open) return;
    lastFocused.current = document.activeElement;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Đưa tiêu điểm vào hộp thoại, giữ Tab quẩn trong hộp thoại
    const focusFirst = () => {
      const el = ref.current?.querySelector(
        'input:not([type=hidden]):not([disabled]), select, textarea, button:not([disabled]), [href]'
      );
      (el || ref.current)?.focus();
    };
    const t = setTimeout(focusFirst, 30);

    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return; }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = [...ref.current.querySelectorAll(
        'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prev;
      lastFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  const w = {
    sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl',
    xl: 'max-w-6xl', full: 'max-w-[95vw]',
  }[size] || 'max-w-2xl';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 overflow-y-auto">
      <div
        className="fixed inset-0 bg-slate-900/45 animate-fade-in"
        onClick={closeOnOverlay ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative w-full ${w} bg-card rounded-lg shadow-pop animate-slide-up my-auto outline-none`}
      >
        <div className="flex items-start gap-3 px-4 py-3 border-b border-line">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-muted-ink mt-0.5">{subtitle}</p>}
          </div>
          <IconButton icon={X} label="Đóng" onClick={onClose} />
        </div>
        <div className="px-4 py-4 max-h-[calc(100vh-14rem)] overflow-y-auto">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-line bg-muted/50 rounded-b-lg">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/** Hộp xác nhận cho thao tác khó hoàn tác. */
export function Confirm({ open, onClose, onConfirm, title, message, confirmText = 'Xác nhận', danger = true, busy }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={<>
        <Button onClick={onClose}>Huỷ bỏ</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
          {confirmText}
        </Button>
      </>}
    >
      <div className="flex gap-3">
        <AlertTriangle
          size={20}
          className={danger ? 'text-danger shrink-0 mt-0.5' : 'text-warn shrink-0 mt-0.5'}
          aria-hidden="true"
        />
        <div className="text-sm leading-relaxed">{message}</div>
      </div>
    </Modal>
  );
}

/* =========================== Thông báo ========================== */

export function Toasts({ items, onDismiss }) {
  if (!items.length) return null;
  const icon = { ok: CheckCircle2, bad: XCircle, warn: AlertTriangle, info: Info };
  const tone = {
    ok: 'bg-emerald-600', bad: 'bg-danger', warn: 'bg-warn', info: 'bg-info',
  };
  return createPortal(
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm no-print" role="status" aria-live="polite">
      {items.map((t) => {
        const Icon = icon[t.kind] || Info;
        return (
          <div
            key={t.id}
            className={`${tone[t.kind] || 'bg-primary'} text-white rounded-lg shadow-pop
                        px-3 py-2.5 flex items-start gap-2 animate-slide-in-right`}
          >
            <Icon size={17} className="shrink-0 mt-0.5" aria-hidden="true" />
            <span className="text-[13px] leading-snug flex-1">{t.message}</span>
            <button
              onClick={() => onDismiss(t.id)}
              aria-label="Đóng thông báo"
              className="shrink-0 opacity-70 hover:opacity-100 rounded"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}

/* ======================== Trạng thái rỗng ======================= */

export function Empty({ icon: Icon = Inbox, title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
        <Icon size={22} className="text-muted-ink" aria-hidden="true" />
      </div>
      <p className="font-semibold text-ink">{title}</p>
      {message && <p className="text-[13px] text-muted-ink mt-1 max-w-sm leading-relaxed">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ label = 'Đang tải dữ liệu...' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-14 text-muted-ink" role="status">
      <Loader2 size={18} className="animate-spin" aria-hidden="true" />
      <span className="text-[13px]">{label}</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  return (
    <div className="card-pad border-danger/30 bg-red-50">
      <div className="flex gap-3">
        <XCircle size={18} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1">
          <p className="font-semibold text-danger text-sm">Không tải được dữ liệu</p>
          <p className="text-[13px] text-red-900/80 mt-0.5">{error?.message}</p>
          {onRetry && <Button size="sm" className="mt-2.5" onClick={onRetry}>Thử lại</Button>}
        </div>
      </div>
    </div>
  );
}

/* ========================= Thẻ số liệu ========================== */

export function Stat({ label, value, sub, icon: Icon, tone = 'default', trend, onClick }) {
  const tones = {
    default: 'text-ink',
    good: 'text-emerald-700',
    bad: 'text-danger',
    warn: 'text-warn',
    info: 'text-info',
  };
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      className={`card p-3 text-left w-full ${onClick ? 'hover:border-accent hover:bg-muted/40 transition-colors duration-150 cursor-pointer' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xs font-bold text-muted-ink uppercase tracking-wide leading-tight">
          {label}
        </span>
        {Icon && <Icon size={15} className="text-muted-ink shrink-0" aria-hidden="true" />}
      </div>
      <div className={`font-display text-xl font-bold mt-1.5 tabular ${tones[tone]}`}>{value}</div>
      {(sub || trend) && (
        <div className="flex items-center gap-1.5 mt-1">
          {trend != null && (
            <span className={`text-2xs font-bold ${trend >= 0 ? 'text-emerald-700' : 'text-danger'}`}>
              {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(0)}%
            </span>
          )}
          {sub && <span className="text-2xs text-muted-ink">{sub}</span>}
        </div>
      )}
    </Wrapper>
  );
}

/* ========================== Thanh tab =========================== */

export function Tabs({ tabs, value, onChange, className = '' }) {
  return (
    <div className={`flex gap-1 border-b border-line overflow-x-auto ${className}`} role="tablist">
      {tabs.map((t) => {
        const active = value === t.key;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={`px-3 py-2 text-[13px] font-semibold whitespace-nowrap border-b-2 -mb-px
                        transition-colors duration-150 cursor-pointer
                        ${active
                          ? 'border-accent text-accent'
                          : 'border-transparent text-muted-ink hover:text-ink hover:border-line'}`}
          >
            {t.label}
            {t.count != null && (
              <span className={`ml-1.5 text-2xs px-1 py-0.5 rounded ${active ? 'bg-accent-soft text-emerald-900' : 'bg-muted'}`}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ========================== Phân trang ========================== */

export const PAGE_SIZES = [10, 20, 50, 100];

/**
 * Thanh phân trang dưới mỗi bảng.
 * Luôn hiện ô "mỗi trang" kể cả khi chỉ có một trang, để người dùng đổi
 * được sang 100 dòng mà không phải đợi dữ liệu nhiều lên mới thấy ô chọn.
 */
export function Pager({ page, pageSize, total, onPage, onPageSize, sizes = PAGE_SIZES }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2
                    px-3 py-2 border-t border-line text-[13px]">
      <div className="flex items-center gap-2">
        <label htmlFor="pager-size" className="text-muted-ink">Mỗi trang</label>
        <select
          id="pager-size"
          className="input !w-auto !py-1 !px-2 tabular"
          value={pageSize}
          onChange={(e) => onPageSize?.(Number(e.target.value))}
          disabled={!onPageSize}
        >
          {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-muted-ink tabular">
          {total === 0 ? 'chưa có dòng nào' : `${n(from)}–${n(to)} trên ${n(total)}`}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <IconButton
          icon={ChevronLeft}
          label="Trang trước"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        />
        <span className="px-2 tabular font-semibold whitespace-nowrap">{page} / {pages}</span>
        <IconButton
          icon={ChevronRight}
          label="Trang sau"
          variant="outline"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        />
      </div>
    </div>
  );
}

/* ===================== Ô chọn có tìm kiếm ======================= */

/**
 * Danh sách chọn có ô tìm — dùng cho chọn khách hàng, NCC, sản phẩm.
 * Hỗ trợ phím Lên/Xuống/Enter/Esc.
 */
export function Combo({
  items, value, onChange, placeholder = 'Chọn...', render, filter,
  size = 'md', emptyText = 'Không tìm thấy', allowClear = true, className = '',
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const box = useRef(null);
  const listRef = useRef(null);

  const selected = items.find((i) => i.id === value);
  const list = q ? items.filter((i) => filter(i, q)) : items;

  useEffect(() => {
    const onDoc = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-hi="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  const choose = useCallback((item) => {
    onChange(item ? item.id : null);
    setOpen(false);
    setQ('');
  }, [onChange]);

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (list[hi]) choose(list[hi]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  const s = { sm: 'field-sm', md: '', lg: 'field-lg' }[size] || '';

  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        type="button"
        className={`field ${s} flex items-center justify-between gap-2 text-left cursor-pointer`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`truncate ${selected ? '' : 'text-slate-400'}`}>
          {selected ? render(selected).label : placeholder}
        </span>
        <ChevronDown size={15} className="shrink-0 text-muted-ink" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-card border border-line rounded-lg shadow-pop overflow-hidden">
          <div className="p-1.5 border-b border-line">
            <input
              className="field field-sm"
              autoFocus
              value={q}
              placeholder="Gõ để tìm..."
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKey}
              aria-label="Tìm trong danh sách"
            />
          </div>
          <ul ref={listRef} className="max-h-60 overflow-y-auto py-1" role="listbox">
            {allowClear && !q && (
              <li>
                <button
                  type="button"
                  className="w-full text-left px-2.5 py-1.5 text-[13px] text-muted-ink hover:bg-muted"
                  onClick={() => choose(null)}
                >
                  — Bỏ chọn —
                </button>
              </li>
            )}
            {list.length === 0 && (
              <li className="px-2.5 py-3 text-[13px] text-muted-ink text-center">{emptyText}</li>
            )}
            {list.slice(0, 200).map((item, i) => {
              const r = render(item);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    data-hi={i === hi ? '1' : '0'}
                    role="option"
                    aria-selected={item.id === value}
                    className={`w-full text-left px-2.5 py-1.5 transition-colors duration-100
                                ${i === hi ? 'bg-accent-soft' : 'hover:bg-muted'}
                                ${item.id === value ? 'font-semibold' : ''}`}
                    onMouseEnter={() => setHi(i)}
                    onClick={() => choose(item)}
                  >
                    <div className="text-[13px] truncate">{r.label}</div>
                    {r.sub && <div className="text-2xs text-muted-ink truncate">{r.sub}</div>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ======================= Dòng tổng cộng ========================= */

export function TotalRow({ label, value, big, tone, hint }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${big ? 'py-1.5' : 'py-0.5'}`}>
      <span className={big ? 'font-semibold text-sm' : 'text-[13px] text-muted-ink'}>
        {label}
        {hint && <span className="text-2xs text-muted-ink ml-1">({hint})</span>}
      </span>
      <span className={`tabular font-mono ${
        big ? 'text-lg font-bold' : 'text-[13px] font-semibold'
      } ${tone === 'bad' ? 'text-danger' : tone === 'good' ? 'text-emerald-700' : ''}`}>
        {typeof value === 'number' ? money(value) : value}
      </span>
    </div>
  );
}
