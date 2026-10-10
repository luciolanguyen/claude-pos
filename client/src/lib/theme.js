/* ====================================================================
   GIAO DIỆN SÁNG / TỐI VÀ BẢNG MÀU (10/10/2026)

   Lưu THEO TỪNG MÁY (localStorage), không lưu vào thiết lập chung của tiệm:
   máy quầy đặt sáng cho dễ nhìn ban ngày, máy trong kho để tối — mỗi máy
   một kiểu, không giành nhau.

   Gắn lên <html data-mode="light|dark" data-palette="kho|xanh|nau">; mọi màu
   đều đọc biến CSS nên đổi hai thuộc tính này là cả phần mềm đổi theo.
   Gọi initTheme() TRƯỚC khi React vẽ trang (main.jsx) để khỏi nháy trắng.
   ==================================================================== */

const KEY = 'thpos.theme';

export const MODES = [
  { key: 'light', label: 'Sáng' },
  { key: 'dark', label: 'Tối' },
  { key: 'system', label: 'Theo máy' },
];

export const PALETTES = [
  { key: 'kho', label: 'Xanh kho hàng', swatch: '#047857', side: '#334155' },
  { key: 'xanh', label: 'Xanh dương', swatch: '#1D4ED8', side: '#1E3A8A' },
  { key: 'nau', label: 'Nâu gỗ', swatch: '#92400E', side: '#44403C' },
];

const DEFAULT = { mode: 'light', palette: 'kho' };

/** Lựa chọn đang lưu của máy này. Trình duyệt chặn bộ nhớ thì về mặc định. */
export function getTheme() {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      mode: MODES.some((m) => m.key === t.mode) ? t.mode : DEFAULT.mode,
      palette: PALETTES.some((p) => p.key === t.palette) ? t.palette : DEFAULT.palette,
    };
  } catch {
    return { ...DEFAULT };
  }
}

const media = () => (typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)') : null);

/** Chế độ thật sự đang hiện: "Theo máy" thì hỏi hệ điều hành. */
export function resolvedMode(mode = getTheme().mode) {
  if (mode !== 'system') return mode;
  return media()?.matches ? 'dark' : 'light';
}

export function applyTheme(theme = getTheme()) {
  const el = document.documentElement;
  el.dataset.mode = resolvedMode(theme.mode);
  el.dataset.palette = theme.palette;
}

/** Đổi và lưu lựa chọn của máy này, áp ngay không cần tải lại. */
export function setTheme(patch) {
  const next = { ...getTheme(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* chế độ riêng tư: chỉ áp tạm */ }
  applyTheme(next);
  window.dispatchEvent(new CustomEvent('thpos:theme', { detail: next }));
  return next;
}

/** Áp lần đầu và nghe hệ điều hành đổi sáng / tối khi đang để "Theo máy". */
export function initTheme() {
  applyTheme();
  media()?.addEventListener?.('change', () => {
    if (getTheme().mode === 'system') applyTheme();
  });
}
