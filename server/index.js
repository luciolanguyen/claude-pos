import express from 'express';
import https from 'node:https';
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
import consign from './routes/consign.js';
import phone from './phone.js';
import { ensureTls, lanChoices } from './tls.js';
import { DB_FILE } from './db.js';
import { permFor } from './access-map.js';
import { whoami, isLoginRequired } from './guard.js';
import { permsOf, PERMISSIONS, ROLE_LABEL } from './permissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 5175;
/* Cổng HTTPS cho điện thoại quét mã bằng camera: mặc định cổng thường +1000
   (5175 → 6175), để máy chủ thử ở 5176, 5177 không giành cổng của tiệm.
   HTTPS_PORT=0 là tắt hẳn. */
const HTTPS_PORT = process.env.HTTPS_PORT !== undefined && process.env.HTTPS_PORT !== ''
  ? Number(process.env.HTTPS_PORT) : PORT + 1000;
/* Chứng chỉ nằm cạnh file dữ liệu, tức trong data/ — không bao giờ lên git */
const TLS_DIR = process.env.POS_TLS_DIR || path.join(path.dirname(DB_FILE), 'tls');
const tlsState = { enabled: false, port: HTTPS_PORT, info: null, error: '' };

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

/* Trang cài chứng chỉ cho điện thoại — đứng TRƯỚC phép chặn quyền, vì điện
   thoại phải cài được chứng chỉ rồi mới vào https để đăng nhập. */
app.use(phone(tlsState));

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
  'last_purchase_price',
  /* Cột tên trơn "cost": giá tiệm bốc hàng mua hộ vãng lai (tài liệu 24),
     chi phí lắp ráp, tiền linh kiện thay khi sửa bảo hành. Ba chỗ đó đều
     là giá vốn thật, trước đây lọt ra ngoài vì tên cột không có hậu tố. */
  'cost'];

/* Cắt cả ở phản hồi của lệnh ghi, không chỉ lệnh đọc: lưu giỏ linh kiện sửa
   chữa hay sửa giá xong, máy chủ trả lại nguyên phiếu kèm giá vốn từng dòng. */
app.use('/api', (req, res, next) => {
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
  consign, inventory, production, warranty, cash, reports, system);

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

/* ------------------------------ HTTPS nội bộ ------------------------------ */
let httpsServer = null;
if (HTTPS_PORT > 0) {
  try {
    tlsState.info = ensureTls(TLS_DIR);
    httpsServer = https.createServer({ key: tlsState.info.key, cert: tlsState.info.cert }, app);
    httpsServer.on('error', (e) => {
      /* Lỗi HTTPS không được kéo sập máy chủ chính: máy tính trong tiệm vẫn
         bán bình thường qua http, chỉ điện thoại mất camera quét mã. */
      tlsState.enabled = false;
      tlsState.error = e.code === 'EADDRINUSE'
        ? `Cổng ${HTTPS_PORT} đang có chương trình khác dùng.` : e.message;
      console.error('[HTTPS] không mở được:', tlsState.error);
    });
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => { tlsState.enabled = true; });

    /* Máy chủ đổi IP (cắm mạng khác, modem cấp lại) thì cấp lại chứng chỉ
       máy chủ bằng CÙNG chứng chỉ gốc và nạp nóng — không phải khởi động lại,
       điện thoại cũng không phải cài lại. */
    setInterval(() => {
      try {
        const next = ensureTls(TLS_DIR);
        if (next.reissued) {
          httpsServer.setSecureContext({ key: next.key, cert: next.cert });
          console.log(`[HTTPS] đã cấp lại chứng chỉ máy chủ (${next.reissued})`);
        }
        tlsState.info = next;
      } catch (e) {
        console.error('[HTTPS] soát chứng chỉ lỗi:', e.message);
      }
    }, 5 * 60 * 1000).unref();
  } catch (e) {
    tlsState.error = `Không tạo được chứng chỉ: ${e.message}`;
    console.error('[HTTPS]', tlsState.error);
  }
} else {
  tlsState.error = 'HTTPS đang tắt (HTTPS_PORT=0).';
}

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
  if (tlsState.info) {
    const phoneIp = lanChoices().find((a) => !a.virtual)?.ip;
    console.log('');
    if (tlsState.info.createdCA) console.log('  Đã tạo chứng chỉ nội bộ mới của tiệm.');
    if (phoneIp) {
      console.log(`  Điện thoại quét mã bằng camera: https://${phoneIp}:${HTTPS_PORT}`);
      console.log(`  Cài chứng chỉ lần đầu tại:       http://${phoneIp}:${PORT}/dien-thoai`);
    }
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
