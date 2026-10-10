/* ====================================================================
   CHỌN GIAO DIỆN (10/10/2026)

   ThemeQuickToggle — nút nhỏ ở chân thanh bên: bấm là đổi Sáng → Tối →
   Theo máy, ai đăng nhập cũng dùng được (thu ngân cũng cần, không riêng
   người vào được Thiết lập).
   ThemePicker      — thẻ đầy đủ trong Thiết lập: chế độ + bảng màu, có ô
   mẫu, áp ngay khi bấm không cần nút Lưu.

   Cả hai chỉ đổi giao diện CỦA MÁY NÀY (xem lib/theme.js).
   ==================================================================== */
import { useEffect, useState } from 'react';
import { Sun, Moon, Monitor, Check } from 'lucide-react';
import { MODES, PALETTES, getTheme, setTheme } from '../lib/theme';

/** Lựa chọn hiện tại, cập nhật khi chỗ khác trong trang vừa đổi. */
function useTheme() {
  const [t, setT] = useState(getTheme);
  useEffect(() => {
    const on = (e) => setT(e.detail || getTheme());
    window.addEventListener('thpos:theme', on);
    return () => window.removeEventListener('thpos:theme', on);
  }, []);
  return t;
}

const MODE_ICON = { light: Sun, dark: Moon, system: Monitor };

export function ThemeQuickToggle({ className = '' }) {
  const t = useTheme();
  const order = MODES.map((m) => m.key);
  const next = order[(order.indexOf(t.mode) + 1) % order.length];
  const Icon = MODE_ICON[t.mode] || Sun;
  const label = `Giao diện: ${MODES.find((m) => m.key === t.mode)?.label}. Bấm để đổi sang ${MODES.find((m) => m.key === next)?.label}`;
  return (
    <button
      type="button"
      onClick={() => setTheme({ mode: next })}
      aria-label={label}
      title={label}
      className={`p-1.5 rounded transition-colors duration-150 ${className}`}
    >
      <Icon size={15} aria-hidden="true" />
    </button>
  );
}

export function ThemePicker() {
  const t = useTheme();
  return (
    <div className="card p-4">
      <h2 className="font-bold text-sm mb-1">Giao diện của máy này</h2>
      <p className="text-2xs text-muted-ink mb-3">
        Chỉ đổi trên máy đang dùng — máy quầy, máy kho mỗi máy để một kiểu được. Tờ in ra
        luôn là giấy trắng chữ đen, không theo chế độ tối.
      </p>

      <span className="label">Sáng / tối</span>
      <div className="grid grid-cols-3 gap-2 max-w-md" role="radiogroup" aria-label="Chế độ sáng tối">
        {MODES.map((m) => {
          const Icon = MODE_ICON[m.key];
          const on = t.mode === m.key;
          return (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setTheme({ mode: m.key })}
              className={`card p-2.5 flex flex-col items-center gap-1 text-[13px] font-semibold cursor-pointer
                          transition-colors duration-150
                          ${on ? 'border-accent ring-1 ring-accent bg-accent-soft/50' : 'hover:border-accent'}`}
            >
              <Icon size={18} aria-hidden="true" />
              {m.label}
            </button>
          );
        })}
      </div>
      {t.mode === 'system' && (
        <p className="text-2xs text-muted-ink mt-1">Tự đổi theo cài đặt sáng / tối của Windows, điện thoại.</p>
      )}

      <span className="label mt-4">Bảng màu</span>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 max-w-xl" role="radiogroup" aria-label="Bảng màu">
        {PALETTES.map((p) => {
          const on = t.palette === p.key;
          return (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setTheme({ palette: p.key })}
              className={`card p-2.5 flex items-center gap-2.5 text-left cursor-pointer transition-colors duration-150
                          ${on ? 'border-accent ring-1 ring-accent' : 'hover:border-accent'}`}
            >
              {/* Ô mẫu: thanh bên + nút chính của bảng màu đó */}
              <span className="flex rounded overflow-hidden shrink-0 border border-line" aria-hidden="true">
                <span className="w-3 h-8" style={{ background: p.side }} />
                <span className="w-6 h-8" style={{ background: p.swatch }} />
              </span>
              <span className="text-[13px] font-semibold flex-1">{p.label}</span>
              {on && <Check size={15} className="text-accent shrink-0" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
