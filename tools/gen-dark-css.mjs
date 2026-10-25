/**
 * DỰNG LỚP MÀU CHO CHẾ ĐỘ TỐI — client/src/theme-dark.css
 *
 *   node tools/gen-dark-css.mjs          dựng lại file
 *   node tools/gen-dark-css.mjs --check  chỉ soát: có lớp màu nào đang dùng mà chưa có bản tối không
 *
 * Phần mềm có cả nghìn chỗ viết màu thẳng kiểu `bg-red-50`, `text-emerald-700`
 * — nền nhạt, chữ đậm, hợp nền trắng. Sang nền tối mà để nguyên thì thành khối
 * trắng chói và chữ tối đè lên nền tối, không đọc được.
 *
 * Sửa tay từng chỗ thì sót. Ở đây dò mọi lớp màu THẬT SỰ đang dùng trong mã,
 * rồi sinh cho mỗi lớp một bản tối:
 *   nền nhạt (-50 … -300)   → cùng sắc, trong suốt trên nền tối
 *   chữ đậm (-600 … -950)   → cùng sắc, bản sáng (-300) cho đọc được
 *   viền nhạt               → cùng sắc, trong suốt
 *   nền đặc (-400 trở lên)  → giữ nguyên (nút màu, chữ trắng trên đó vẫn đủ tương phản)
 *
 * Tất cả nằm trong `@media screen` và né `.paper` (bản xem trước tờ in) — tờ in
 * và bản xem trước LUÔN là giấy trắng chữ đen, dù máy đang để chế độ nào.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'client', 'src');
const OUT = path.join(SRC, 'theme-dark.css');

/* Bảng màu Tailwind 3 — chỉ cần mức 300 (chữ sáng) và 500 (sắc gốc để pha trong suốt) */
const PALETTE = {
  slate: { 300: '203 213 225', 500: '100 116 139' },
  gray: { 300: '209 213 219', 500: '107 114 128' },
  zinc: { 300: '212 212 216', 500: '113 113 122' },
  stone: { 300: '214 211 209', 500: '120 113 108' },
  red: { 300: '252 165 165', 500: '239 68 68' },
  rose: { 300: '253 164 175', 500: '244 63 94' },
  orange: { 300: '253 186 116', 500: '249 115 22' },
  amber: { 300: '252 211 77', 500: '245 158 11' },
  yellow: { 300: '253 224 71', 500: '234 179 8' },
  lime: { 300: '190 242 100', 500: '132 204 22' },
  green: { 300: '134 239 172', 500: '34 197 94' },
  emerald: { 300: '110 231 183', 500: '16 185 129' },
  teal: { 300: '94 234 212', 500: '20 184 166' },
  cyan: { 300: '103 232 249', 500: '6 182 212' },
  sky: { 300: '125 211 252', 500: '14 165 233' },
  blue: { 300: '147 197 253', 500: '59 130 246' },
  indigo: { 300: '165 180 252', 500: '99 102 241' },
  violet: { 300: '196 181 253', 500: '139 92 246' },
  purple: { 300: '216 180 254', 500: '168 85 247' },
  fuchsia: { 300: '240 171 252', 500: '217 70 239' },
  pink: { 300: '249 168 212', 500: '236 72 153' },
};
const NEUTRAL = new Set(['slate', 'gray', 'zinc', 'stone']);
/* Màu theo token: nền giữ nguyên (chữ trắng trên đó), CHỮ thì đổi sang bản sáng */
const TOKEN_TEXT = { accent: 'accent-ink', danger: 'danger-ink', warn: 'warn-ink', info: 'info-ink' };

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(jsx?|css)$/.test(e.name) && e.name !== 'theme-dark.css') out.push(p);
  }
  return out;
}

const COLOR_RE = new RegExp(
  String.raw`(?<![\w-])((?:hover|focus|group-hover|disabled):)?(!)?(bg|text|border|divide)-`
  + String.raw`(white|black|${Object.keys(PALETTE).join('|')}|${Object.keys(TOKEN_TEXT).join('|')})`
  + String.raw`(?:-(\d{2,3}))?(?:\/(\d{1,3}))?(?![\w-])`, 'g');

/** Bản tối của một lớp màu, hoặc null nếu giữ nguyên. */
function darkRule(prop, color, shade, opacity) {
  const op = opacity ? Number(opacity) / 100 : 1;
  const s = shade ? Number(shade) : null;
  if (TOKEN_TEXT[color]) {
    return prop === 'text' && !s ? `color: rgb(var(--${TOKEN_TEXT[color]}) / ${op})` : null;
  }
  if (color === 'white') {
    if (prop === 'bg' && !opacity) return 'background-color: rgb(var(--card))';
    return null;                                   // bg-white/10… là lớp phủ trên nền tối sẵn, để nguyên
  }
  if (color === 'black') {
    if (prop === 'text') return 'color: rgb(var(--ink))';
    if (prop === 'border') return 'border-color: rgb(var(--line))';
    return null;
  }
  const c = PALETTE[color];
  if (!c || !s) return null;
  if (prop === 'bg') {
    if (s > 300) return null;                      // nền đặc: nút màu, chấm trạng thái
    if (NEUTRAL.has(color)) return `background-color: rgb(var(--muted) / ${op})`;
    const a = (s <= 50 ? 0.12 : s <= 100 ? 0.16 : 0.24) * Math.max(op, 0.5);
    return `background-color: rgb(${c[500]} / ${a.toFixed(3)})`;
  }
  if (prop === 'text') {
    if (s < 600) return null;                      // chữ sáng sẵn (icon, chữ trên nền tối)
    if (NEUTRAL.has(color)) return s >= 700 ? 'color: rgb(var(--ink))' : 'color: rgb(var(--muted-ink))';
    return `color: rgb(${c[300]} / ${op})`;
  }
  if (prop === 'border' || prop === 'divide') {
    if (s > 400) return null;
    if (NEUTRAL.has(color)) return 'border-color: rgb(var(--line))';
    return `border-color: rgb(${c[500]} / ${(0.4 * op).toFixed(3)})`;
  }
  return null;
}

const esc = (cls) => cls.replace(/([:/!.])/g, '\\$1');

const used = new Map();   // tên lớp -> [prop, color, shade, opacity, variant, important]
for (const file of walk(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(COLOR_RE)) {
    const [whole, variant, bang, prop, color, shade, opacity] = m;
    if (!used.has(whole)) used.set(whole, { variant, bang, prop, color, shade, opacity });
  }
}

const rules = [];
for (const [cls, u] of [...used.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const decl = darkRule(u.prop, u.color, u.shade, u.opacity);
  if (!decl) continue;
  const pseudo = u.variant === 'hover:' ? ':hover' : u.variant === 'focus:' ? ':focus'
    : u.variant === 'disabled:' ? ':disabled' : u.variant === 'group-hover:' ? '' : '';
  if (u.variant === 'group-hover:') {
    rules.push(`  html[data-mode="dark"] .group:hover .${esc(cls)}:not(.paper *) { ${decl}${u.bang ? ' !important' : ''}; }`);
    continue;
  }
  const target = u.prop === 'divide' ? ` > :not([hidden]) ~ :not([hidden])` : '';
  rules.push(`  html[data-mode="dark"] .${esc(cls)}${pseudo}:not(.paper *)${target} { ${decl}${u.bang ? ' !important' : ''}; }`);
}

const css = `/* ==================================================================
   CHẾ ĐỘ TỐI — LỚP MÀU VIẾT THẲNG (tự sinh, ĐỪNG SỬA TAY)

   Dựng lại bằng: node tools/gen-dark-css.mjs
   Nguồn: mọi lớp màu kiểu bg-red-50, text-emerald-700 đang dùng trong
   client/src. Xem chú thích đầu tools/gen-dark-css.mjs để biết quy tắc đổi.
   Không áp lên tờ in và bản xem trước (.paper): giấy luôn trắng.
   ================================================================== */
@media screen {
${rules.join('\n')}
}
`;

if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== css) {
    console.log('  LỖI  theme-dark.css cũ rồi — có lớp màu mới chưa có bản tối. Chạy: node tools/gen-dark-css.mjs');
    process.exit(1);
  }
  console.log(`  OK   theme-dark.css khớp ${rules.length} lớp màu đang dùng`);
} else {
  fs.writeFileSync(OUT, css);
  console.log(`Đã dựng ${path.relative(ROOT, OUT)}: ${rules.length} lớp màu có bản tối (dò ${used.size} lớp).`);
}
