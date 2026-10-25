/**
 * SOÁT ĐỘ TƯƠNG PHẢN MÀU — 2 chế độ × 3 bảng màu (10/10/2026)
 *
 *   node tools/check-contrast.mjs
 *
 * Đọc thẳng các biến màu trong client/src/index.css, dựng đủ sáu tổ hợp
 * (sáng/tối × kho/xanh/nau) rồi tính tỉ lệ tương phản WCAG cho những cặp
 * chữ–nền phần mềm dùng nhiều nhất. Dưới 4.5:1 là chữ thường khó đọc.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(ROOT, 'client', 'src', 'index.css'), 'utf8');

/** Biến màu trong khối có bộ chọn khớp `selector` (chỉ giá trị dạng "r g b"). */
function block(selector) {
  const i = css.indexOf(`${selector} {`);
  if (i < 0) throw new Error(`Không thấy khối ${selector} trong index.css`);
  const body = css.slice(i, css.indexOf('}', i));
  const out = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) out[m[1]] = [m[2], m[3], m[4]].map(Number);
  return out;
}

const base = block(':root');
const palettes = { kho: {}, xanh: block('html[data-palette="xanh"]'), nau: block('html[data-palette="nau"]') };
const dark = block('html[data-mode="dark"]');
const darkPal = { kho: {}, xanh: block('html[data-mode="dark"][data-palette="xanh"]'), nau: block('html[data-mode="dark"][data-palette="nau"]') };

const lum = ([r, g, b]) => {
  const f = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const WHITE = [255, 255, 255];

let bad = 0;
for (const mode of ['light', 'dark']) {
  for (const pal of ['kho', 'xanh', 'nau']) {
    const t = { ...base, ...palettes[pal], ...(mode === 'dark' ? { ...dark, ...darkPal[pal] } : {}) };
    /* Ở chế độ sáng, chữ màu trạng thái chính là màu gốc */
    for (const k of ['accent', 'danger', 'warn', 'info']) if (!t[`${k}-ink`]) t[`${k}-ink`] = t[k];
    const pairs = [
      ['chữ thường trên thẻ', t.ink, t.card],
      ['chữ thường trên nền trang', t.ink, t.surface],
      ['chữ phụ trên thẻ', t['muted-ink'], t.card],
      ['chữ phụ trên nền xám nhạt', t['muted-ink'], t.muted],
      ['chữ nhấn trên thẻ', t['accent-ink'], t.card],
      ['chữ đỏ (lỗi) trên thẻ', t['danger-ink'], t.card],
      ['chữ cam (cảnh báo) trên thẻ', t['warn-ink'], t.card],
      ['chữ xanh (thông tin) trên thẻ', t['info-ink'], t.card],
      ['chữ thường trên nền nhấn nhạt', t.ink, t['accent-soft']],
      ['chữ trắng trên nút chính', WHITE, t.accent],
      ['chữ trắng trên nút đỏ', WHITE, t.danger],
      ['chữ trắng trên thanh bên', WHITE, t.primary],
    ];
    for (const [name, fg, bg] of pairs) {
      const r = ratio(fg, bg);
      if (r < 4.5) {
        bad += 1;
        console.log(`  LỖI  ${mode}/${pal}: ${name} chỉ ${r.toFixed(2)}:1`);
      }
    }
  }
}
console.log(bad ? `\n${bad} cặp màu dưới 4.5:1` : '  OK   Cả 6 tổ hợp sáng/tối × bảng màu đều đạt từ 4.5:1');
process.exit(bad ? 1 : 0);
