import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import catalog from './routes/catalog.js';
import partners from './routes/partners.js';
import purchases from './routes/purchases.js';
import sales from './routes/sales.js';
import inventory from './routes/inventory.js';
import production from './routes/production.js';
import warranty, { cleanupOldPhotos } from './routes/warranty.js';
import cash from './routes/cash.js';
import reports from './routes/reports.js';
import system from './routes/system.js';
import orders from './routes/orders.js';
import requisitions from './routes/requisitions.js';
import drafts from './routes/drafts.js';
import posExtras from './routes/pos-extras.js';
import { permFor } from './access-map.js';
import { whoami, isLoginRequired } from './guard.js';
import { permsOf, PERMISSIONS, ROLE_LABEL } from './permissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 5175;

const app = express();
app.use(express.json({ limit: '80mb' }));

// Cho phép các máy khác trong LAN gọi API khi chạy dev (Vite ở cổng khác)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-user-id');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/* Ai đang gọi + làm được những gì. Máy khách hỏi cái này sau khi đăng nhập
   để biết nên hiện những mục nào trên menu. */
app.get('/api/me', (req, res) => {
  const u = whoami(req);
  const login_required = isLoginRequired();
  if (!login_required) {
    // Tiệm tắt đăng nhập: một máy dùng chung, không phân quyền được.
    return res.json({
      login_required: false, user: null,
      can: Object.keys(PERMISSIONS), permissions: PERMISSIONS, role_labels: ROLE_LABEL,
    });
  }
  res.json({
    login_required: true,
    user: u ? { id: u.id, username: u.username, full_name: u.full_name, role: u.role } : null,
    can: u && u.active ? permsOf(u.role) : [],
    permissions: PERMISSIONS,
    role_labels: ROLE_LABEL,
  });
});

/* Chặn quyền cho toàn bộ API. Giao diện đã ẩn menu, nhưng ẩn menu chỉ cho
   gọn mắt — chặn thật phải nằm ở đây, không thì gõ thẳng địa chỉ là qua. */
app.use('/api', (req, res, next) => {
  if (!isLoginRequired()) return next();
  const perm = permFor(req.method, req.path);
  if (!perm) return next();

  const u = whoami(req);
  if (!u) {
    return res.status(401).json({ error: 'Chưa đăng nhập. Hãy đăng nhập lại.', code: 'NO_AUTH' });
  }
  if (!u.active) {
    return res.status(403).json({ error: 'Tài khoản đã bị khoá.', code: 'INACTIVE' });
  }
  if (!permsOf(u.role).includes(perm)) {
    return res.status(403).json({
      error: `Bạn không có quyền "${PERMISSIONS[perm] || perm}". `
           + 'Việc này cần chủ cửa hàng hoặc quản lý.',
      code: 'NO_PERM', need: perm,
    });
  }
  req.user = u;
  next();
});

/* Giá vốn: ai không có quyền xem thì cắt hẳn khỏi dữ liệu trả về, chứ không
   chỉ ẩn trên màn hình. Ẩn ở giao diện thì mở công cụ nhà phát triển ra là
   thấy, mà thợ phụ biết giá vốn thì chủ tiệm mất thế khi trả giá với mối. */
/* Giá nhập gần nhất cũng là giá vốn — lộ ra thì thu ngân biết tiệm lời bao nhiêu */
const COST_FIELDS = ['cost_price', 'unit_cost', 'cogs', 'avg_cost', 'profit', 'margin',
  'last_purchase_price'];

app.use('/api', (req, res, next) => {
  if (req.method !== 'GET') return next();
  if (!isLoginRequired()) return next();
  const u = whoami(req);
  if (u && u.active && permsOf(u.role).includes('cost.view')) return next();

  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        if (COST_FIELDS.includes(k)) continue;
        out[k] = strip(val);
      }
      return out;
    }
    return v;
  };
  const json = res.json.bind(res);
  res.json = (payload) => json(strip(payload));
  next();
});

app.use('/api', catalog, partners, purchases, sales, posExtras, orders, requisitions, drafts,
  inventory, production, warranty, cash, reports, system);

app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy API: ' + req.path }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[LỖI]', err);
  res.status(500).json({ error: err.message || 'Lỗi máy chủ' });
});

// Phục vụ giao diện đã build (chế độ chạy thật trong tiệm)
const DIST = path.join(ROOT, 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('*', (req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

// Dọn ảnh bảo hành quá hạn: chạy lúc khởi động rồi mỗi 24 giờ một lần.
// Máy chủ trong tiệm thường bật cả ngày nên không cần lịch phức tạp.
try { cleanupOldPhotos(); } catch (e) { console.error('[dọn ảnh] lỗi:', e.message); }
setInterval(() => {
  try { cleanupOldPhotos(); } catch (e) { console.error('[dọn ảnh] lỗi:', e.message); }
}, 24 * 60 * 60 * 1000).unref();

app.listen(PORT, '0.0.0.0', () => {
  const hasUI = fs.existsSync(DIST);
  console.log('');
  console.log('  ┌────────────────────────────────────────────────┐');
  console.log('  │   TIỆM ĐIỆN THẠNH HOÀ - Phần mềm bán hàng      │');
  console.log('  └────────────────────────────────────────────────┘');
  console.log('');
  console.log(`  Máy này:      http://localhost:${PORT}`);
  for (const ip of lanAddresses()) {
    console.log(`  Máy trong tiệm: http://${ip}:${PORT}`);
  }
  if (!hasUI) {
    console.log('');
    console.log('  (Chưa build giao diện — đang ở chế độ phát triển.');
    console.log('   Mở địa chỉ Vite hiện ở dòng bên dưới để dùng.)');
  }
  console.log('');
  console.log('  Nhấn Ctrl+C để tắt máy chủ.');
  console.log('');
});
