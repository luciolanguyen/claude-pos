/**
 * CHẠY THỬ NÂNG CẤP TRÊN BẢN SAO DỮ LIỆU THẬT — không đụng một chữ vào data/pos.db.
 *
 *   node tools/dryrun-upgrade.mjs [commit-cũ] [file-csdl-nguồn]
 *
 * Mặc định so với `7011dc6` (mã máy thật đang chạy). Cách làm:
 *   1. chép nguyên bộ pos.db + -wal + -shm sang thư mục tạm (máy thật phải TẮT, để
 *      bộ ba file đứng yên), rồi mới mở bản chép — không bao giờ mở file gốc;
 *   2. gộp WAL trên bản chép, tách ra hai bản A và B;
 *   3. mã CŨ (rút bằng git archive) chạy trên A, mã MỚI (thư mục làm việc) chạy trên B,
 *      mỗi bên một cổng riêng; mã mới tự nâng cấp CSDL lúc khởi động;
 *   4. so công nợ, quỹ, số chứng từ qua API, rồi so TỪNG DÒNG của mọi bảng cũ.
 *
 * Bảng mới sinh ra thì phải trống (trừ sổ mã vạch điền từ mã sẵn có).
 */
import { DatabaseSync } from 'node:sqlite';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD_COMMIT = process.argv[2] || '7011dc6';
/* Nguồn mặc định là CSDL thật. Truyền đường dẫn khác để chạy thử trên một bản sao
   lưu CŨ — cách duy nhất còn đo được "nâng cấp thêm bảng gì" sau khi CSDL thật đã
   được nâng cấp rồi. */
const LIVE = path.resolve(ROOT, process.argv[3] || path.join(ROOT, 'data', 'pos.db'));
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'thpos-dryrun-'));
/* Mã cũ để trong thư mục dự án cho nó thấy node_modules; xoá ngay sau khi chạy */
const OLDDIR = path.join(ROOT, '.dryrun-old');
const SNAP = path.join(WORK, 'snap.db');
const A = path.join(WORK, 'cu.db');
const B = path.join(WORK, 'moi.db');
const H = { headers: { 'x-user-id': '1' } };

const clean = () => {
  fs.rmSync(OLDDIR, { recursive: true, force: true });
  fs.rmSync(WORK, { recursive: true, force: true });
  for (const d of ['products-cu', 'warranty-cu', 'payroll-cu', 'products-moi', 'warranty-moi', 'payroll-moi']) {
    fs.rmSync(path.join(ROOT, 'data', d), { recursive: true, force: true });
  }
};

if (!fs.existsSync(LIVE)) {
  console.log('Không thấy data/pos.db — chưa có dữ liệu thật để chạy thử.');
  process.exit(0);
}
const up = await fetch('http://localhost:5175/api/system-info').then(() => true).catch(() => false);
if (up) {
  console.log('Máy thật đang CHẠY. Tắt máy thật rồi chạy lại, kẻo chép nhằm lúc nó đang ghi.');
  process.exit(2);
}

/* --- 1 & 2: chép bộ file rồi tách hai bản --- */
const stat = () => ['', '-wal', '-shm']
  .map((s) => (fs.existsSync(LIVE + s) ? `${s}:${fs.statSync(LIVE + s).mtimeMs}` : `${s}:—`)).join(' ');
const before = stat();
for (const s of ['', '-wal', '-shm']) {
  if (fs.existsSync(LIVE + s)) fs.copyFileSync(LIVE + s, SNAP + s);
}
const snap = new DatabaseSync(SNAP);
snap.exec('PRAGMA wal_checkpoint(TRUNCATE)');
snap.exec(`VACUUM INTO '${A.replace(/'/g, "''")}'`);
snap.exec(`VACUUM INTO '${B.replace(/'/g, "''")}'`);
snap.close();

/* --- 3: dựng hai máy chủ --- */
fs.rmSync(OLDDIR, { recursive: true, force: true });
fs.mkdirSync(OLDDIR, { recursive: true });
execSync(`git archive ${OLD_COMMIT} server package.json client/src/lib | tar -x -C "${OLDDIR}"`,
  { cwd: ROOT, shell: 'bash' });

const start = (cwd, db, port) => {
  const p = spawn(process.execPath, ['server/index.js'], {
    cwd,
    env: { ...process.env, POS_DB: db, PORT: String(port), HTTPS_PORT: '0', POS_TLS_DIR: path.join(WORK, `tls${port}`) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.log = '';
  p.stdout.on('data', (c) => { p.log += c; });
  p.stderr.on('data', (c) => { p.log += c; });
  return p;
};
const read = async (base) => {
  const g = (p) => fetch(base + p, H).then((r) => r.json());
  const rows = (x) => (Array.isArray(x) ? x : x.rows);
  return {
    customers: rows(await g('/customers?page_size=500')).map((c) => `${c.id}:${c.debt}`).sort().join(';'),
    suppliers: rows(await g('/suppliers?page_size=500')).map((c) => `${c.id}:${c.debt}`).sort().join(';'),
    accounts: (await g('/cash/accounts')).map((a) => `${a.id}:${a.balance}`).join(';'),
    info: await g('/system-info'),
  };
};

const oldSrv = start(OLDDIR, A, 5180);
const newSrv = start(ROOT, B, 5179);
await new Promise((r) => setTimeout(r, 4500));

let cu; let moi;
try {
  cu = await read('http://localhost:5180/api');
  moi = await read('http://localhost:5179/api');
} catch (e) {
  oldSrv.kill(); newSrv.kill();
  console.log('Không đọc được số liệu:', e.message);
  console.log(`--- máy cũ ---\n${oldSrv.log.slice(-800)}\n--- máy mới ---\n${newSrv.log.slice(-800)}`);
  clean();
  process.exit(1);
}
oldSrv.kill(); newSrv.kill();
await new Promise((r) => setTimeout(r, 1200));

/* --- 4: so sánh --- */
let bad = 0;
const line = (ok, s) => { if (!ok) bad += 1; console.log(`${ok ? '  OK  ' : '  LỆCH'} ${s}`); };

line(/cu\.db$/.test(cu.info.db_file) && /moi\.db$/.test(moi.info.db_file), 'mỗi bên chạy đúng bản sao của nó');
line(cu.customers === moi.customers, `công nợ ${cu.customers.split(';').length} khách hàng không đổi một đồng`);
line(cu.suppliers === moi.suppliers, `công nợ ${cu.suppliers.split(';').length} nhà cung cấp không đổi`);
line(cu.accounts === moi.accounts, `số dư các quỹ không đổi (${moi.accounts})`);
line(cu.info.counts.sales === moi.info.counts.sales
  && cu.info.counts.cash_transactions === moi.info.counts.cash_transactions,
`hoá đơn ${moi.info.counts.sales}, phiếu quỹ ${moi.info.counts.cash_transactions} không đổi`);

const da = new DatabaseSync(A, { readOnly: true });
const db = new DatabaseSync(B, { readOnly: true });
const tablesOf = (d) => d.prepare(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name);
const oldTables = tablesOf(da);
const diffs = [];
for (const t of oldTables) {
  const cols = da.prepare(`PRAGMA table_info(${t})`).all().map((c) => `"${c.name}"`).join(',');
  const q = `SELECT ${cols} FROM "${t}" ORDER BY rowid`;
  if (JSON.stringify(da.prepare(q).all()) !== JSON.stringify(db.prepare(q).all())) diffs.push(t);
}
line(diffs.length === 0, `${oldTables.length} bảng cũ: từng dòng, từng cột cũ giống hệt${diffs.length ? ' — lệch: ' + diffs.join(', ') : ''}`);

const newTables = tablesOf(db).filter((t) => !oldTables.includes(t));
const cnt = (t) => db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n;
/* Hai bảng này cố tình điền sẵn, không phải dữ liệu lạ:
     - sổ mã vạch (plan 30) điền từ mã đã có;
     - danh mục loại thu chi (soát quỹ 30/09) nạp đúng danh sách trước nay nằm
       cứng trong mã nguồn, để chủ tiệm khai thêm được. */
const SEEDED = ['barcodes', 'barcode_counter', 'cash_categories'];
line(newTables.every((t) => cnt(t) === 0 || SEEDED.includes(t)),
  `${newTables.length} bảng mới đều trống (${newTables.map((t) => `${t}: ${cnt(t)}`).join(', ') || 'không có'})`);

/* Cột mới trên bảng cũ: không được tự điền số vào dữ liệu đã có */
const colsOf = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const newCols = [];
for (const t of oldTables) {
  const old = new Set(da.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
  for (const c of colsOf(t)) if (!old.has(c)) newCols.push(`${t}.${c}`);
}
console.log(`       cột mới: ${newCols.join(', ') || 'không có'}`);
da.close();
db.close();

line(before === stat(), 'bộ file pos.db của máy thật không bị đụng (giờ sửa file y như cũ)');

for (const [n, p] of [['cũ', oldSrv], ['mới', newSrv]]) {
  if (/error|Error/.test(p.log)) console.log(`--- nhật ký máy ${n} ---\n${p.log.slice(-900)}`);
}
clean();
console.log(bad ? `\n${bad} chỗ lệch — XEM LẠI trước khi giao cho máy thật` : '\nKhông lệch chỗ nào');
process.exit(bad ? 1 : 0);
