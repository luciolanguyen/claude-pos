/**
 * KHUNG KIỂM THỬ MÁY CHỦ — chạy trên cơ sở dữ liệu riêng, không bao giờ đụng tiệm.
 *
 * Bộ kiểm thử của mấy đợt trước từng để trong thư mục tạm và đã mất sạch khi máy
 * dọn thư mục tạm. Lần này để hẳn trong repo.
 *
 * Quy tắc sống còn: chỉ chạy trên `data/test.db`. Hàm dựng máy chủ dưới đây tự
 * kiểm tra lại đường dẫn CSDL trước khi cho bài kiểm thử ghi một chữ nào.
 */
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(ROOT, 'data', 'test.db');
const PORT = Number(process.env.TEST_PORT) || 5178;
export const BASE = `http://localhost:${PORT}/api`;

/* --------------------------- đếm kết quả --------------------------- */

let pass = 0;
let fail = 0;
const failed = [];

export function ok(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  OK   ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail += 1; failed.push(name); console.log(`  LỖI  ${name}${detail ? ' — ' + detail : ''}`); }
}
export const section = (title) => console.log(`\n=== ${title} ===`);
export const results = () => ({ pass, fail, failed });

/* ----------------------------- gọi API ----------------------------- */

export async function raw(method, p, body, headers) {
  const r = await fetch(BASE + p, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'x-user-id': '1', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, body: data };
}

export async function req(method, p, body, headers) {
  const { status, body: data } = await raw(method, p, body, headers);
  if (status >= 400) {
    throw Object.assign(new Error(data?.error || `HTTP ${status} khi ${method} ${p}`), { status, body: data });
  }
  return data;
}

export const get = (p, h) => req('GET', p, null, h);
export const post = (p, b, h) => req('POST', p, b, h);
export const put = (p, b, h) => req('PUT', p, b, h);
export const del = (p, h) => req('DELETE', p, null, h);

/** Chạy một lời gọi hỏng và trả về mã lỗi máy chủ báo — để kiểm phần chặn. */
export const code = async (fn) => {
  try { await fn(); return 'KHÔNG_BÁO_LỖI'; } catch (e) { return e.body?.code || `HTTP${e.status}`; }
};

export const money = (v) => Number(v || 0).toLocaleString('vi-VN');
export const today = () => new Date().toLocaleDateString('sv-SE');

/* ------------------------- dựng máy chủ thử ------------------------ */

let child = null;

export async function startServer({ reset = true } = {}) {
  /* Cổng đã có người giữ thì DỪNG, đừng chạy tiếp: một máy chủ cũ còn sót lại từ
     lần chạy trước sẽ nuốt hết lời gọi của bài kiểm thử, và nó chạy mã CŨ — bài
     kiểm thử xanh đỏ theo mã cũ mà mình cứ tưởng mã mới. Đã mất một buổi vì chuyện
     này rồi. */
  const busy = await fetch(`${BASE}/system-info`).then(() => true).catch(() => false);
  if (busy) {
    throw new Error(`Cổng ${PORT} đang có máy chủ khác chạy. Tắt nó đi rồi chạy lại: `
      + `Get-NetTCPConnection -State Listen -LocalPort ${PORT} | %{ Stop-Process -Id $_.OwningProcess -Force }`);
  }
  if (reset) {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(DB + suffix); } catch { /* chưa có thì thôi */ }
    }
    execFileSync(process.execPath, ['server/seed.js', '--reset'], {
      cwd: ROOT,
      env: { ...process.env, POS_DB: DB },
      stdio: 'pipe',
    });
  }
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, POS_DB: DB, PORT: String(PORT), HTTPS_PORT: '0', POS_TLS_DIR: path.join(ROOT, 'data', 'tls-test') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.log = '';
  child.stdout.on('data', (c) => { child.log += c; });
  child.stderr.on('data', (c) => { child.log += c; });

  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      const info = await get('/system-info');
      /* Chốt chặn: tuyệt đối không cho bài kiểm thử chạy vào CSDL của tiệm */
      if (!/[\\/]test\.db$/.test(String(info.db_file))) {
        await stopServer();
        throw new Error(`Máy chủ thử đang mở nhầm CSDL: ${info.db_file}`);
      }
      return info;
    } catch (e) {
      if (String(e.message).startsWith('Máy chủ thử đang mở nhầm')) throw e;
      if (Date.now() > deadline) {
        await stopServer();
        throw new Error(`Máy chủ thử không lên sau 20 giây.\n${child?.log || ''}`);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

export async function stopServer() {
  if (!child) return;
  child.kill();
  child = null;
  await new Promise((r) => setTimeout(r, 500));
}

export const serverLog = () => child?.log || '';
