/**
 * SOÁT MÃ GIAO DIỆN — năm phép soát bắt đúng những lỗi đã từng làm trắng màn hình.
 *
 * Chạy:  node tools/check-client.mjs            (chạy cả năm)
 *        node tools/check-client.mjs undefined  (chạy một phép)
 *
 * Vì sao có file này: `npm run build` của Vite KHÔNG bắt được mấy lỗi dưới đây —
 * mã vẫn dịch xong, chỉ nổ lúc người dùng mở đúng màn hình đó. Mỗi phép soát ở
 * đây tương ứng với một lần thật sự làm hỏng màn hình:
 *
 *   undefined  Dùng <SearchInput> mà quên import → màn hình bán hàng trắng xoá.
 *   imports    Gọi money() / api.xxx mà quên import → nổ lúc vẽ.
 *   hooks      Dùng can() / toast() mà quên lấy từ useApp() → nổ lúc bấm nút.
 *   focus      useEffect phụ thuộc hàm của cha (onClose...) → con trỏ nhảy khỏi ô
 *              đang gõ mỗi lần cha vẽ lại.
 *   paged      Endpoint trả { rows } mà dùng như mảng → "x.map is not a function".
 *
 * Soát bằng cách đọc chữ, không dựng cây cú pháp: cốt bắt lỗi hay gặp chứ không
 * cầu toàn. Thà báo thừa một hai chỗ còn hơn bỏ lọt màn hình trắng.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'client', 'src');

/* ---------------------------------------------------------------- */
/* Đọc file                                                          */
/* ---------------------------------------------------------------- */

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.jsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const FILES = walk(SRC).map((file) => ({
  file,
  rel: path.relative(ROOT, file).replace(/\\/g, '/'),
  text: fs.readFileSync(file, 'utf8'),
}));

/** Bỏ chú thích và chuỗi để khỏi soát nhầm chữ nằm trong câu tiếng Việt. */
function stripNoise(s) {
  /* Chuỗi KHÔNG được bắc qua dòng. Một dấu nháy lẻ nằm trong biểu thức chính quy
     — kiểu `.replace(/"/g, '""')` ở chỗ xuất Excel — từng làm phép bỏ chuỗi nuốt
     luôn phần còn lại của tệp: bộ soát mù từ dòng đó xuống mà vẫn báo "không thấy
     chỗ nào" (đã để lọt một biểu tượng dùng mà chưa import). Chặn ở ranh giới
     dòng thì hỏng một dòng cũng chỉ mất đúng dòng đó. */
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + m.slice(p1.length).replace(/./g, ' '))
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

/** Số dòng của một vị trí ký tự. */
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

/* ---------------------------------------------------------------- */
/* Tên được khai trong một file                                      */
/* ---------------------------------------------------------------- */

function declaredNames(text) {
  const names = new Set();
  const add = (s) => { if (s) names.add(s); };

  /* import A, { B as C, D } from '...' */
  for (const m of text.matchAll(/import\s+([^;]+?)\s+from\s+['"][^'"]+['"]/g)) {
    const clause = m[1];
    for (const part of clause.split(/[,{}]/)) {
      const t = part.trim();
      if (!t || t === '*') continue;
      const as = t.match(/(?:\*\s+as\s+|\s+as\s+)([A-Za-z_$][\w$]*)$/);
      add(as ? as[1] : t.match(/^[A-Za-z_$][\w$]*/)?.[0]);
    }
  }
  /* khai báo thường */
  for (const m of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of text.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of text.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  /* phá cấu trúc: const { a, b: c } = ... và ({ a, b }) => */
  for (const m of text.matchAll(/[{[]([^{}[\]]*)[}\]]\s*(?:=[^=>]|=>|\))/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const name = t.includes(':') ? t.split(':').pop().trim() : t;
      add(name.replace(/^\.\.\./, '').match(/^[A-Za-z_$][\w$]*/)?.[0]);
    }
  }
  /* tham số hàm đơn giản: (a, b) => và function f(a, b) */
  for (const m of text.matchAll(/\(([^()]*)\)\s*=>/g)) {
    for (const part of m[1].split(',')) add(part.trim().match(/^[A-Za-z_$][\w$]*/)?.[0]);
  }
  return names;
}

const GLOBALS = new Set([
  'window', 'document', 'console', 'localStorage', 'sessionStorage', 'navigator', 'location',
  'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'Math', 'Date', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Promise', 'Set', 'Map',
  'Intl', 'Error', 'URL', 'URLSearchParams', 'FormData', 'Blob', 'File', 'FileReader', 'Image',
  'IntersectionObserver', 'ResizeObserver', 'AbortController', 'CustomEvent', 'Event',
  'KeyboardEvent', 'MouseEvent', 'HTMLInputElement', 'HTMLSelectElement', 'React', 'Fragment',
  'isNaN', 'parseInt', 'parseFloat', 'structuredClone', 'crypto', 'alert', 'confirm', 'print',
]);

/* ---------------------------------------------------------------- */
/* 1. Thẻ JSX viết hoa mà chưa khai / chưa import                    */
/* ---------------------------------------------------------------- */

function checkUndefined() {
  const hits = [];
  for (const { rel, text } of FILES) {
    const code = stripNoise(text);
    const known = declaredNames(text);
    for (const m of code.matchAll(/<([A-Z][\w$]*)(?:\.[\w$]+)?[\s/>]/g)) {
      const name = m[1];
      if (known.has(name) || GLOBALS.has(name)) continue;
      hits.push({ rel, line: lineOf(code, m.index), msg: `<${name}> dùng mà chưa khai báo hay import` });
    }
    /* Biểu tượng truyền qua prop chứ không viết thành thẻ: icon={Truck},
       icon: RefreshCcw — build vẫn chạy, mở đúng màn hình mới nổ. */
    for (const m of code.matchAll(/\bicon\s*[:=]\s*\{?\s*([A-Z][\w$]*)\b/g)) {
      const name = m[1];
      if (known.has(name) || GLOBALS.has(name)) continue;
      hits.push({ rel, line: lineOf(code, m.index), msg: `biểu tượng ${name} dùng mà chưa import` });
    }
  }
  return hits;
}

/* ---------------------------------------------------------------- */
/* 2. Hàm dùng chung gọi mà quên import                              */
/* ---------------------------------------------------------------- */

/** Tên xuất khẩu của một file thư viện. */
function exportsOf(rel) {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const out = new Set();
  for (const m of text.matchAll(/export\s+(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  return out;
}

function checkImports() {
  const shared = new Set([
    ...exportsOf('client/src/lib/format.js'),
    ...exportsOf('client/src/lib/api.js'),
    ...exportsOf('client/src/lib/store.jsx'),
    ...exportsOf('client/src/components/ui.jsx'),
  ]);
  /* Mấy tên quá ngắn hoặc hay trùng biến cục bộ thì bỏ qua cho đỡ báo nhảm */
  for (const skip of ['n', 'date', 'time', 'range', 'match', 'api', 'short', 'qty', 'pct']) shared.delete(skip);

  /* Hook của React cũng phải import mới dùng được. Quên `useMemo` thì build vẫn
     chạy, mở đúng màn hình mới nổ "useMemo is not defined" — đã dính một lần. */
  const REACT_HOOKS = ['useState', 'useEffect', 'useMemo', 'useRef', 'useCallback',
    'useLayoutEffect', 'useReducer', 'useContext'];

  const hits = [];
  for (const { rel, text } of FILES) {
    if (/client\/src\/(lib|components\/ui)/.test(rel)) continue;
    const code = stripNoise(text);
    const known = declaredNames(text);
    for (const name of REACT_HOOKS) {
      if (known.has(name)) continue;
      const m = new RegExp(`(?<![\\w$.])${name}\\s*\\(`, 'g').exec(code);
      if (m) hits.push({ rel, line: lineOf(code, m.index), msg: `gọi ${name}() mà thiếu import từ react` });
    }
    for (const name of shared) {
      if (known.has(name)) continue;
      const re = new RegExp(`(?<![\\w$.])${name}\\s*\\(`, 'g');
      const m = re.exec(code);
      if (m) hits.push({ rel, line: lineOf(code, m.index), msg: `gọi ${name}() mà thiếu import` });
    }
  }
  return hits;
}

/* ---------------------------------------------------------------- */
/* 3. Dùng đồ của useApp() mà quên lấy ra                            */
/* ---------------------------------------------------------------- */

const APP_KEYS = ['toast', 'can', 'meta', 'settings', 'store', 'access', 'user',
  'defaultWarehouse', 'defaultPriceList', 'login', 'logout'];

function checkHooks() {
  const hits = [];
  for (const { rel, text } of FILES) {
    if (rel.endsWith('client/src/lib/store.jsx')) continue;
    const code = stripNoise(text);
    if (!/\buseApp\s*\(/.test(code)) continue;
    /* Gom mọi tên đã lấy ra từ useApp() trong file */
    const taken = new Set();
    for (const m of code.matchAll(/(?:const|let)\s*{([^}]*)}\s*=\s*useApp\s*\(\)/g)) {
      for (const part of m[1].split(',')) {
        const t = part.trim();
        if (t) taken.add(t.includes(':') ? t.split(':').pop().trim() : t);
      }
    }
    const known = declaredNames(text);
    for (const key of APP_KEYS) {
      if (taken.has(key) || known.has(key)) continue;
      const re = key === 'toast' || key === 'can' || key === 'login' || key === 'logout'
        ? new RegExp(`(?<![\\w$.])${key}\\s*\\(`, 'g')
        : new RegExp(`(?<![\\w$.])${key}\\s*[.?]`, 'g');
      const m = re.exec(code);
      if (m) hits.push({ rel, line: lineOf(code, m.index), msg: `dùng ${key} mà quên lấy từ useApp()` });
    }
  }
  return hits;
}

/* ---------------------------------------------------------------- */
/* 4. useEffect phụ thuộc hàm của cha → mất con trỏ khi gõ           */
/* ---------------------------------------------------------------- */

function checkFocus() {
  const hits = [];
  for (const { rel, text } of FILES) {
    const code = stripNoise(text);
    for (const m of code.matchAll(/useEffect\s*\([\s\S]*?\}\s*,\s*\[([^\]]*)\]\s*\)/g)) {
      const deps = m[1].split(',').map((s) => s.trim()).filter(Boolean);
      const bad = deps.filter((d) => /^on[A-Z]/.test(d));
      /* Chỉ kêu khi effect thật sự đụng tới con trỏ. Hộp in bắt phím Escape cũng
         phụ thuộc onClose nhưng không kéo con trỏ đi đâu — kêu là kêu nhảm. */
      const touchesFocus = /\.focus\s*\(|\.select\s*\(|focusFirst|setFocus/.test(m[0]);
      if (bad.length && touchesFocus) {
        hits.push({
          rel,
          line: lineOf(code, m.index),
          msg: `useEffect phụ thuộc ${bad.join(', ')} — cha vẽ lại là effect chạy lại, kéo con trỏ đi chỗ khác`,
        });
      }
    }
  }
  return hits;
}

/* ---------------------------------------------------------------- */
/* 5. Endpoint trả { rows } mà dùng như mảng                         */
/* ---------------------------------------------------------------- */

/* Những hàm api trả về { rows, total, page, page_size } — đối chiếu với các route
   `res.json({ rows, total, page, page_size })` bên máy chủ. Khách hàng và nhà cung
   cấp KHÔNG nằm đây: hai endpoint đó trả thẳng một mảng. */
const PAGED = ['products', 'sales', 'saleLookup', 'saleReturns', 'purchases', 'purchaseReturns',
  'orders', 'requisitions', 'consignSettlements', 'consignItems', 'warrantyTickets',
  'stock', 'stockMoves', 'cashTransactions'];

function checkPaged() {
  const hits = [];
  for (const { rel, text } of FILES) {
    const code = stripNoise(text);
    for (const name of PAGED) {
      const re = new RegExp(`(?:const|let)\\s*{\\s*data\\s*:\\s*([A-Za-z_$][\\w$]*)[^}]*}\\s*=\\s*use(?:Fetch|Paged)\\s*\\(\\s*\\(\\)\\s*=>\\s*api\\.${name}\\b`, 'g');
      for (const m of code.matchAll(re)) {
        const v = m[1];
        const used = new RegExp(`(?<![\\w$.])${v}\\s*\\.(map|filter|find|some|every|length|slice)\\b`).exec(code);
        if (used) {
          hits.push({
            rel,
            line: lineOf(code, used.index),
            msg: `api.${name}() trả { rows, ... } mà dùng như mảng (biến "${v}")`,
          });
        }
      }
    }
  }
  return hits;
}

/* ---------------------------------------------------------------- */

const CHECKS = {
  undefined: { run: checkUndefined, ok: 'Không có tên nào dùng mà chưa khai báo' },
  imports: { run: checkImports, ok: 'Không có chỗ nào gọi hàm dùng chung mà thiếu import' },
  hooks: { run: checkHooks, ok: 'Không có chỗ nào quên lấy từ useApp()' },
  focus: { run: checkFocus, ok: 'Không có useEffect nào phụ thuộc hàm của cha' },
  paged: { run: checkPaged, ok: 'Không có chỗ nào dùng { rows } như mảng' },
};

const only = process.argv[2];
const names = only ? [only] : Object.keys(CHECKS);
let bad = 0;
for (const name of names) {
  const c = CHECKS[name];
  if (!c) { console.error(`Không có phép soát tên "${name}". Có: ${Object.keys(CHECKS).join(', ')}`); process.exit(2); }
  const hits = c.run();
  if (!hits.length) { console.log(`  OK   ${c.ok}`); continue; }
  bad += hits.length;
  console.log(`  LỖI  ${name}: ${hits.length} chỗ`);
  for (const h of hits) console.log(`         ${h.rel}:${h.line}  ${h.msg}`);
}
if (bad) { console.log(`\n${bad} chỗ cần xem lại`); process.exit(1); }
console.log('\nSoát xong, không thấy chỗ nào');
