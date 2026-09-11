import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, tx, getSettings, setSetting, DB_FILE, db, WARRANTY_DIR } from '../db.js';

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

/**
 * Soát mã PIN gửi lên khi thêm / sửa người dùng.
 *   undefined -> không đổi;  rỗng -> xoá PIN;  còn lại -> 4-8 chữ số, không trùng.
 *
 * Không cho trùng PIN giữa hai người: mã PIN còn dùng để biết AI là người
 * duyệt. Hai người chung một mã thì sổ ghi "đã duyệt" mà không biết ai.
 */
function normPin(pin, userId) {
  if (pin === undefined) return undefined;
  const p = String(pin ?? '').trim();
  if (!p) return null;
  if (!/^\d{4,8}$/.test(p)) {
    throw Object.assign(new Error('Mã PIN phải là từ 4 đến 8 chữ số.'), { status: 400 });
  }
  if (get('SELECT id FROM users WHERE pin = ? AND id <> ?', [p, Number(userId) || 0])) {
    throw Object.assign(new Error(
      'Mã PIN này đã có người khác dùng. Mỗi người một mã, để còn biết ai là người duyệt.'),
    { status: 400 });
  }
  return p;
}

/* Không bao giờ trả mã PIN ra ngoài, chỉ báo có hay chưa có. */
r.get('/users', (req, res) => {
  res.json(all(`SELECT id, username, full_name, role, phone, active, created_at,
                      (pin IS NOT NULL AND pin <> '') AS has_pin
               FROM users ORDER BY id`));
});

r.post('/users', (req, res) => {
  const b = req.body;
  if (!b.username?.trim() || !b.full_name?.trim()) {
    return res.status(400).json({ error: 'Thiếu tên đăng nhập hoặc họ tên' });
  }
  if (get('SELECT id FROM users WHERE username = ?', [b.username.trim()])) {
    return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
  }
  let pin;
  try { pin = normPin(b.pin, 0); } catch (e) { return res.status(400).json({ error: e.message }); }
  const info = run(
    'INSERT INTO users(username, password, full_name, role, phone, pin) VALUES(?, ?, ?, ?, ?, ?)',
    [b.username.trim(), b.password || '1234', b.full_name.trim(), b.role || 'cashier', b.phone || null,
      pin ?? null]);
  res.json(get(`SELECT id, username, full_name, role, phone, active,
                       (pin IS NOT NULL AND pin <> '') AS has_pin FROM users WHERE id = ?`,
    [Number(info.lastInsertRowid)]));
});

r.put('/users/:id', (req, res) => {
  const b = req.body;
  let pin;
  try { pin = normPin(b.pin, req.params.id); } catch (e) { return res.status(400).json({ error: e.message }); }
  if (pin !== undefined) run('UPDATE users SET pin = ? WHERE id = ?', [pin, req.params.id]);
  if (b.password) {
    run('UPDATE users SET full_name = ?, role = ?, phone = ?, active = ?, password = ? WHERE id = ?',
      [b.full_name, b.role, b.phone || null, b.active === 0 ? 0 : 1, b.password, req.params.id]);
  } else {
    run('UPDATE users SET full_name = ?, role = ?, phone = ?, active = ? WHERE id = ?',
      [b.full_name, b.role, b.phone || null, b.active === 0 ? 0 : 1, req.params.id]);
  }
  res.json(get(`SELECT id, username, full_name, role, phone, active,
                       (pin IS NOT NULL AND pin <> '') AS has_pin FROM users WHERE id = ?`,
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
  'warranty_tickets', 'warranty_photos', 'warranty_logs', 'warranty_parts',
  'sale_orders', 'sale_order_items', 'sale_order_deliveries', 'sale_order_deposits',
  /* Đợt 12 — trước đây quên khai nên sao lưu rồi phục hồi là mất sạch */
  'product_suppliers', 'requisitions', 'requisition_items', 'requisition_item_suppliers',
  'doc_drafts',
  /* Đợt 13 */
  'debt_allocations', 'vouchers', 'voucher_uses',
  /* Đợt 14 */
  'supplier_phones', 'supplier_bank_accounts', 'purchase_custom_items', 'purchase_return_custom_items',
  'warranty_custom_parts', 'warranty_fees',
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
    /* Gán tiền thu nợ và phiếu đổi hàng là chứng từ, xoá trước bảng cha */
    for (const t of ['voucher_uses', 'vouchers', 'debt_allocations',
      'sale_return_items', 'sale_returns', 'sale_items', 'sales',
      'purchase_return_custom_items', 'purchase_custom_items',
      'purchase_return_items', 'purchase_returns', 'purchase_items', 'purchases',
      'stock_take_items', 'stock_takes', 'stock_transfer_items', 'stock_transfers',
      'production_items', 'productions', 'draft_sales', 'doc_drafts',
      /* Phiếu báo hết hàng là chứng từ nên xoá. Riêng product_suppliers là
         DANH MỤC (khai mối nào bán món nào) nên giữ lại, như định mức. */
      'requisition_item_suppliers', 'requisition_items', 'requisitions',
      'warranty_custom_parts', 'warranty_fees',
      'warranty_parts', 'warranty_logs', 'warranty_photos', 'warranty_tickets',
      'sale_order_deposits', 'sale_order_deliveries', 'sale_order_items', 'sale_orders',
      'cash_transactions', 'stock_moves', 'stock', 'activity_log']) {
      run(`DELETE FROM ${t}`);
    }
  });
  res.json({ ok: true, message: 'Đã xoá dữ liệu giao dịch. Danh mục hàng hoá, định mức, khách hàng, NCC và nhà xe được giữ nguyên.' });
});

/* ==================================================================== *
 * XOÁ SẠCH TOÀN BỘ — VỀ NHƯ MÁY MỚI CÀI
 *
 * Khác với "xoá dữ liệu giao dịch" ở trên: cái này xoá luôn cả danh mục.
 * Dùng khi giao phần mềm cho tiệm khác, hoặc khi muốn nhập lại từ đầu.
 *
 * Giữ đúng hai thứ để còn đăng nhập vào được:
 *   - bảng users (tài khoản)
 *   - thiết lập cửa hàng, in ấn, bán hàng, bảo hành
 *
 * KHÔNG lấy lại được. Đòi gõ đúng chuỗi xác nhận, và giao diện bắt tải
 * file sao lưu trước khi cho bấm.
 * ==================================================================== */

r.post('/reset-all', (req, res) => {
  if (req.body?.confirm !== 'XOA-TAT-CA') {
    return res.status(400).json({ error: 'Cần gõ đúng chuỗi xác nhận để thực hiện.' });
  }

  /* Thứ tự xoá đi từ bảng con lên bảng cha, để khoá ngoại không chặn */
  const ORDER = [
    'voucher_uses', 'vouchers', 'debt_allocations',
    'activity_log', 'draft_sales', 'doc_drafts',
    /* Phiếu báo hết hàng: dòng -> mối được chọn -> phiếu */
    'requisition_item_suppliers', 'requisition_items', 'requisitions',
    'product_suppliers',
    'sale_order_deposits', 'sale_order_deliveries', 'sale_order_items', 'sale_orders',
    'warranty_custom_parts', 'warranty_fees',
    'warranty_parts', 'warranty_logs', 'warranty_photos', 'warranty_tickets',
    'production_items', 'productions', 'product_boms',
    'stock_transfer_items', 'stock_transfers', 'stock_take_items', 'stock_takes',
    'sale_return_items', 'sale_returns', 'sale_items', 'sales',
    'purchase_return_custom_items', 'purchase_custom_items',
    'purchase_return_items', 'purchase_returns', 'purchase_items', 'purchases',
    'cash_transactions', 'cash_accounts',
    'stock_moves', 'stock', 'product_prices', 'product_units', 'products',
    'supplier_phones', 'supplier_bank_accounts',
    'customers', 'suppliers', 'carriers', 'categories', 'price_lists', 'warehouses',
  ];

  /* Đếm trước để báo lại cho người dùng biết đã xoá những gì */
  const before = {};
  for (const t of ['products', 'customers', 'suppliers', 'sales', 'purchases', 'warranty_tickets']) {
    before[t] = get(`SELECT COUNT(*) AS n FROM ${t}`).n;
  }

  let photosDeleted = 0;
  try {
    tx(() => {
      db.exec('PRAGMA foreign_keys = OFF');
      for (const t of ORDER) run(`DELETE FROM ${t}`);
      run("DELETE FROM sqlite_sequence WHERE name NOT IN ('users')");
      db.exec('PRAGMA foreign_keys = ON');
    });
  } catch (e) {
    db.exec('PRAGMA foreign_keys = ON');
    return res.status(500).json({ error: 'Không xoá được: ' + e.message });
  }

  /* Ảnh bảo hành nằm ngoài cơ sở dữ liệu, phải xoá riêng */
  try {
    for (const name of fs.readdirSync(WARRANTY_DIR)) {
      fs.unlinkSync(path.join(WARRANTY_DIR, name));
      photosDeleted++;
    }
  } catch { /* thư mục trống hoặc chưa có */ }

  /* Dựng lại những thứ tối thiểu để phần mềm chạy được ngay */
  run("INSERT INTO warehouses(code, name, is_default, active) VALUES('KHO', 'Kho cửa hàng', 1, 1)");
  run("INSERT INTO price_lists(code, name, is_default, sort_order) VALUES('LE', 'Giá lẻ', 1, 1)");
  run(`INSERT INTO cash_accounts(code, name, type, opening_balance, active, sort_order)
       VALUES('QTM', 'Tiền mặt tại quầy', 'cash', 0, 1, 1)`);

  res.json({
    ok: true,
    deleted: before,
    photos_deleted: photosDeleted,
    message: 'Đã xoá sạch dữ liệu. Tài khoản đăng nhập và thông tin cửa hàng được giữ lại. '
      + 'Đã dựng lại kho mặc định, bảng giá lẻ và quỹ tiền mặt để phần mềm chạy được ngay.',
  });
});

export default r;
