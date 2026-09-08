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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 5175;

const app = express();
app.use(express.json({ limit: '80mb' }));

// Cho phép các máy khác trong LAN gọi API khi chạy dev (Vite ở cổng khác)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use('/api', catalog, partners, purchases, sales, inventory, production, warranty, cash, reports, system);

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
