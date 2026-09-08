import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, tx, getSettings, setSetting, DB_FILE, db } from '../db.js';

const r = Router();

/* =========================== THIẾT LẬP ============================= */

r.get('/settings', (req, res) => res.json(getSettings()));

r.put('/settings', (req, res) => {
  const body = req.body || {};
  tx(() => {
    for (const [k, v] of Object.entries(body)) setSetting(k, v);
  });
  res.json(getSettings());
});

/* ========================== NGƯỜI DÙNG ============================= */

r.get('/users', (req, res) => {
  res.json(all('SELECT id, username, full_name, role, phone, active, created_at FROM users ORDER BY id'));
});

r.post('/users', (req, res) => {
  const b = req.body;
  if (!b.username?.trim() || !b.full_name?.trim()) {
    return res.status(400).json({ error: 'Thiếu tên đăng nhập hoặc họ tên' });
  }
  if (get('SELECT id FROM users WHERE username = ?', [b.username.trim()])) {
    return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
  }
  const info = run(
    'INSERT INTO users(username, password, full_name, role, phone) VALUES(?, ?, ?, ?, ?)',
    [b.username.trim(), b.password || '1234', b.full_name.trim(), b.role || 'cashier', b.phone || null]);
  res.json(get('SELECT id, username, full_name, role, phone, active FROM users WHERE id = ?',
    [Number(info.lastInsertRowid)]));
});

r.put('/users/:id', (req, res) => {
  const b = req.body;
  if (b.password) {
    run('UPDATE users SET full_name = ?, role = ?, phone = ?, active = ?, password = ? WHERE id = ?',
      [b.full_name, b.role, b.phone || null, b.active === 0 ? 0 : 1, b.password, req.params.id]);
  } else {
    run('UPDATE users SET full_name = ?, role = ?, phone = ?, active = ? WHERE id = ?',
      [b.full_name, b.role, b.phone || null, b.active === 0 ? 0 : 1, req.params.id]);
  }
  res.json(get('SELECT id, username, full_name, role, phone, active FROM users WHERE id = ?',
    [req.params.id]));
});

r.delete('/users/:id', (req, res) => {
  const owners = get("SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND active = 1").n;
  const u = get('SELECT role FROM users WHERE id = ?', [req.params.id]);
  if (u?.role === 'owner' && owners <= 1) {
    return res.status(400).json({ error: 'Phải còn ít nhất một tài khoản Chủ cửa hàng.' });
  }
  run('UPDATE users SET active = 0 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

/** Đăng nhập đơn giản cho mạng LAN nội bộ trong tiệm. */
r.post('/login', (req, res) => {
  const { username, password } = req.body;
  const u = get('SELECT * FROM users WHERE username = ? AND active = 1', [username]);
  if (!u || u.password !== password) {
    return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
  }
  res.json({ id: u.id, username: u.username, full_name: u.full_name, role: u.role });
});

/* ======================= NHẬT KÝ HOẠT ĐỘNG ========================= */

r.get('/activity', (req, res) => {
  res.json(all('SELECT * FROM activity_log ORDER BY id DESC LIMIT 300'));
});

/* ==================== SAO LƯU / KHÔI PHỤC ========================== */

const TABLES = [
  'settings', 'users', 'categories', 'price_lists', 'warehouses', 'products', 'product_units',
  'product_prices', 'suppliers', 'customers', 'stock', 'stock_moves', 'purchases',
  'purchase_items', 'purchase_returns', 'purchase_return_items', 'sales', 'sale_items',
  'sale_returns', 'sale_return_items', 'cash_accounts', 'cash_transactions',
  'stock_takes', 'stock_take_items', 'stock_transfers', 'stock_transfer_items', 'activity_log',
  'carriers', 'product_boms', 'productions', 'production_items', 'draft_sales',
];

/** Xuất toàn bộ dữ liệu ra một file JSON. */
r.get('/backup', (req, res) => {
  const dump = { _meta: { app: 'thanh-hoa-pos', version: 1, exported_at: new Date().toISOString() } };
  for (const t of TABLES) dump[t] = all(`SELECT * FROM ${t}`);
  const stamp = new Date().toLocaleDateString('sv-SE').replace(/-/g, '');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="saoluu-pos-${stamp}.json"`);
  res.send(JSON.stringify(dump, null, 2));
});

/** Nhập lại dữ liệu từ file sao lưu (ghi đè toàn bộ). */
r.post('/restore', (req, res) => {
  const dump = req.body;
  if (!dump?._meta || dump._meta.app !== 'thanh-hoa-pos') {
    return res.status(400).json({ error: 'File sao lưu không hợp lệ (không phải bản sao lưu của phần mềm này).' });
  }
  try {
    db.exec('PRAGMA foreign_keys = OFF');
    tx(() => {
      for (const t of [...TABLES].reverse()) run(`DELETE FROM ${t}`);
      for (const t of TABLES) {
        const rows = dump[t];
        if (!Array.isArray(rows) || !rows.length) continue;
        const cols = Object.keys(rows[0]);
        const sql = `INSERT INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`;
        const stmt = db.prepare(sql);
        for (const row of rows) stmt.run(...cols.map((c) => row[c] ?? null));
      }
    });
    db.exec('PRAGMA foreign_keys = ON');
    res.json({ ok: true, message: 'Khôi phục dữ liệu thành công. Hãy tải lại trang.' });
  } catch (e) {
    db.exec('PRAGMA foreign_keys = ON');
    res.status(400).json({ error: 'Khôi phục thất bại: ' + e.message });
  }
});

/** Thông tin hệ thống + kích thước CSDL. */
r.get('/system-info', (req, res) => {
  let size = 0;
  try { size = fs.statSync(DB_FILE).size; } catch { /* chưa có file */ }
  const counts = {};
  for (const t of TABLES) counts[t] = get(`SELECT COUNT(*) AS n FROM ${t}`).n;
  res.json({
    db_file: DB_FILE,
    db_size: size,
    db_size_text: (size / 1024 / 1024).toFixed(2) + ' MB',
    node_version: process.version,
    counts,
  });
});

/** Xoá toàn bộ dữ liệu giao dịch, giữ lại danh mục. */
r.post('/clear-transactions', (req, res) => {
  if (req.body?.confirm !== 'XOA-DU-LIEU') {
    return res.status(400).json({ error: 'Cần gõ đúng chuỗi xác nhận để thực hiện.' });
  }
  tx(() => {
    // Chỉ xoá chứng từ. Giữ lại danh mục: hàng hoá, định mức, khách, NCC, nhà xe.
    for (const t of ['sale_return_items', 'sale_returns', 'sale_items', 'sales',
      'purchase_return_items', 'purchase_returns', 'purchase_items', 'purchases',
      'stock_take_items', 'stock_takes', 'stock_transfer_items', 'stock_transfers',
      'production_items', 'productions', 'draft_sales',
      'cash_transactions', 'stock_moves', 'stock', 'activity_log']) {
      run(`DELETE FROM ${t}`);
    }
  });
  res.json({ ok: true, message: 'Đã xoá dữ liệu giao dịch. Danh mục hàng hoá, định mức, khách hàng, NCC và nhà xe được giữ nguyên.' });
});

export default r;
