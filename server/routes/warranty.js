/* ====================================================================
   BẢO HÀNH VÀ SỬA CHỮA DỊCH VỤ

   Hai luồng tiếp nhận thiết bị lỗi (tài liệu 09):
     warranty  bảo hành — hàng mua ở tiệm, còn hạn, đủ điều kiện
     repair    sửa chữa dịch vụ — hết hạn, lỗi người dùng, hoặc hàng mang
               từ ngoài vào (tính phí 100%)

   Tiền trên phiếu chia ba nhóm độc lập:
     1. Linh kiện: hàng có mã trong kho (trừ kho KHI HOÀN THÀNH phiếu) và
        linh kiện mua ngoài gõ tay (không bao giờ đụng kho, doanh thu gom
        riêng mục "linh kiện ngoài hệ thống")
     2. Tiền công kỹ thuật
     3. Phí phát sinh khác (gửi hãng, vận chuyển...)
   Tổng khách trả = linh kiện kho + linh kiện ngoài + tiền công + phí − miễn giảm.

   Linh kiện kho giữ trên phiếu ở trạng thái "chờ trừ kho" cho tới lúc hoàn
   thành, để hộp chọn linh kiện đồng bộ hai chiều tăng / giảm tuỳ ý mà không
   đẻ ra hàng loạt phiếu kho nhập xuất lặt vặt. Dòng của phiếu cũ (trước đợt
   14) đã trừ kho từ lúc thêm thì giữ nguyên, không trừ lần nữa.
   ==================================================================== */
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  all, get, run, tx, nextCode, moveStock, costOf, searchWhere,
  addCashTx, defaultCashAccount, WARRANTY_DIR, getSettings, pageParams } from '../db.js';
import { isApproverRole, peekApproval, consumeApproval } from '../policy.js';
import { ensureDefectWarehouse } from './sales.js';

const r = Router();

const money = (v) => Math.round(Number(v) || 0);
const fmt = (v) => Math.round(Number(v) || 0).toLocaleString('vi-VN');
const httpError = (message, code, extra = {}) =>
  Object.assign(new Error(message), { status: 400, code, ...extra });
const fail = (res, e) => res.status(e.status || 400).json({
  error: e.message, code: e.code, needs_approval: e.needs_approval === true,
});

/**
 * Giá bán lẻ của một mặt hàng theo đơn vị cơ bản.
 * Dùng khi thay linh kiện mà thợ không gõ giá — lấy đúng giá niêm yết
 * đang bán, chứ không lấy giá vốn.
 */
function retailPriceOf(productId) {
  const row = get(`
    SELECT pp.price
    FROM product_prices pp
    JOIN product_units pu ON pu.id = pp.unit_id
    JOIN price_lists pl ON pl.id = pp.price_list_id
    WHERE pp.product_id = ? AND pu.is_base = 1
    ORDER BY pl.is_default DESC, pl.id
    LIMIT 1`, [productId]);
  return row?.price ?? 0;
}

/* Các trạng thái theo đúng thứ tự việc thật ở tiệm. */
export const WARRANTY_STATUS = [
  { key: 'received', label: 'Mới nhận' },
  { key: 'checking', label: 'Đang kiểm tra' },
  { key: 'repairing', label: 'Đang sửa' },
  { key: 'sent_supplier', label: 'Đã gửi hãng' },
  { key: 'ready', label: 'Xong, chờ khách lấy' },
  { key: 'delivered', label: 'Đã trả khách' },
  { key: 'cancelled', label: 'Huỷ' },
];

export const RESOLUTIONS = [
  { key: 'repair', label: 'Tiệm tự sửa' },
  { key: 'supplier', label: 'Hãng/NCC sửa' },
  { key: 'exchange', label: 'Đổi cái mới' },
  { key: 'refund', label: 'Hoàn tiền' },
  { key: 'reject', label: 'Từ chối bảo hành' },
];

export const TICKET_TYPES = [
  { key: 'warranty', label: 'Bảo hành', hint: 'Hàng mua ở tiệm, còn hạn và đủ điều kiện bảo hành' },
  { key: 'repair', label: 'Sửa chữa dịch vụ', hint: 'Hết hạn, lỗi người dùng hoặc hàng mang từ ngoài vào — tính phí' },
];
const normType = (v) => (v === 'repair' ? 'repair' : 'warranty');

/** Bảng giá tiền công cài sẵn ở Thiết lập > Bảo hành. */
function laborPresets() {
  const list = getSettings()?.warranty?.labor_presets;
  return Array.isArray(list)
    ? list.map((x) => ({ name: String(x?.name || '').trim(), price: money(x?.price) })).filter((x) => x.name)
    : [];
}

r.get('/warranty/meta', (req, res) =>
  res.json({ statuses: WARRANTY_STATUS, resolutions: RESOLUTIONS, types: TICKET_TYPES, labor_presets: laborPresets() }));

/* ==================================================================== */
/* Ảnh: nhận base64 từ trình duyệt, ghi ra file trong data/warranty/     */
/* ==================================================================== */

const EXT_BY_MIME = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
};

function savePhoto(dataUrl, ticketId) {
  const m = String(dataUrl || '').match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!m) return null;
  const ext = EXT_BY_MIME[m[1].toLowerCase()];
  if (!ext) return null;                       // chỉ nhận ảnh, không nhận file khác
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 6 * 1024 * 1024) return null;  // giới hạn 6MB một ảnh
  const name = `bh${ticketId}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(WARRANTY_DIR, name), buf);
  return name;
}

/** Trả ảnh về trình duyệt. Chặn đường dẫn lạ để không đọc được file ngoài thư mục. */
r.get('/warranty/photo/:file', (req, res) => {
  const name = path.basename(req.params.file);
  const full = path.join(WARRANTY_DIR, name);
  if (!full.startsWith(WARRANTY_DIR) || !fs.existsSync(full)) {
    return res.status(404).json({ error: 'Không tìm thấy ảnh' });
  }
  res.sendFile(full);
});

/* ==================================================================== */
/* Tiền trên phiếu                                                       */
/* ==================================================================== */

/** Cộng lại các nhóm tiền của phiếu từ các dòng chi tiết. */
function recalcTicket(ticketId) {
  const p = get(`SELECT COALESCE(SUM(amount), 0) AS cost, COALESCE(SUM(amount_sale), 0) AS sale
                 FROM warranty_parts WHERE ticket_id = ?`, [ticketId]);
  const custom = get('SELECT COALESCE(SUM(amount), 0) AS s FROM warranty_custom_parts WHERE ticket_id = ?', [ticketId]).s;
  const fees = get('SELECT COALESCE(SUM(amount), 0) AS s FROM warranty_fees WHERE ticket_id = ?', [ticketId]).s;
  run(`UPDATE warranty_tickets SET parts_cost = ?, parts_price = ?, custom_parts_price = ?, fees_total = ?
       WHERE id = ?`, [p.cost, p.sale, custom, fees, ticketId]);
}

/** Tổng tiền theo công thức tài liệu 09, mục 2.4. */
function totalsOf(t) {
  const gross = (t.parts_price || 0) + (t.custom_parts_price || 0) + (t.labor_fee || 0) + (t.fees_total || 0);
  const discount = Math.min(Math.max(0, t.discount || 0), gross);
  return {
    parts: t.parts_price || 0,
    custom_parts: t.custom_parts_price || 0,
    labor: t.labor_fee || 0,
    fees: t.fees_total || 0,
    gross,
    discount,
    total: gross - discount,
  };
}

/**
 * Chốt chặn giá linh kiện thấp hơn giá vốn (tài liệu 09, mục 2.1A).
 * Chủ / quản lý tự quyết; thu ngân phải có phiếu duyệt PIN của quản lý.
 * Tiệm tắt đăng nhập thì một máy dùng chung, coi như toàn quyền.
 */
function belowCostGate(req, lines) {
  const low = lines.filter((l) => l.price < l.unit_cost);
  if (!low.length) return { approvedBy: null, token: null };
  const actor = req.user;
  if (actor === undefined || isApproverRole(actor?.role)) return { approvedBy: actor?.id || null, token: null };
  const approval = peekApproval(req.body?.approval_token);
  if (!approval) {
    const x = low[0];
    throw httpError(
      `"${x.name}" sửa giá ${fmt(x.price)} đ, thấp hơn giá vốn. Cần quản lý nhập mã PIN để duyệt.`,
      'BELOW_COST', { needs_approval: true });
  }
  return { approvedBy: approval.approver.id, token: req.body.approval_token };
}

/** Chi tiết đầy đủ một phiếu — dùng cho màn hình và để trả lại sau mỗi lần sửa. */
function ticketDetail(id) {
  const t = get(`
    SELECT t.*,
           COALESCE(c.name, t.customer_name) AS customer_display,
           COALESCE(c.phone, t.customer_phone) AS phone_display,
           c.address AS customer_address,
           s.name AS supplier_name, s.phone AS supplier_phone,
           u.full_name AS received_by_name, tech.full_name AS technician_name,
           sa.code AS sale_code, sa.ts AS sale_ts,
           p.sku AS product_sku, p.base_unit,
           ep.name AS exchange_product_name, ep.sku AS exchange_product_sku
    FROM warranty_tickets t
    LEFT JOIN customers c ON c.id = t.customer_id
    LEFT JOIN suppliers s ON s.id = t.supplier_id
    LEFT JOIN users u ON u.id = t.received_by
    LEFT JOIN users tech ON tech.id = t.technician_id
    LEFT JOIN sales sa ON sa.id = t.sale_id
    LEFT JOIN products p ON p.id = t.product_id
    LEFT JOIN products ep ON ep.id = t.exchange_product_id
    WHERE t.id = ?`, [id]);
  if (!t) return null;

  t.photos = all('SELECT * FROM warranty_photos WHERE ticket_id = ? ORDER BY id', [t.id]);
  t.logs = all(`
    SELECT l.*, u.full_name AS user_name
    FROM warranty_logs l LEFT JOIN users u ON u.id = l.user_id
    WHERE l.ticket_id = ? ORDER BY l.id`, [t.id]);
  t.parts = all(`
    SELECT wp.*, p.name AS product_name, p.sku, p.base_unit,
           (SELECT CAST(ROUND(pi.price * 1.0 / COALESCE(NULLIF(pi.factor, 0), 1)) AS INTEGER)
              FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
             WHERE pi.product_id = wp.product_id AND pu.status = 'done'
             ORDER BY pu.ts DESC, pi.id DESC LIMIT 1) AS last_purchase_price
    FROM warranty_parts wp JOIN products p ON p.id = wp.product_id
    WHERE wp.ticket_id = ? ORDER BY wp.id`, [t.id]);
  for (const p of t.parts) {
    const list = p.list_price || p.price;
    /* "Giảm giá hỗ trợ": bớt so với giá niêm yết, in rõ trên phiếu cho khách thấy */
    p.support_discount = Math.max(0, Math.round((list - p.price) * p.qty));
    p.support_percent = list > 0 ? Math.round(Math.max(0, (list - p.price) / list) * 1000) / 10 : 0;
  }
  t.custom_parts = all('SELECT * FROM warranty_custom_parts WHERE ticket_id = ? ORDER BY id', [t.id]);
  t.fees = all('SELECT * FROM warranty_fees WHERE ticket_id = ? ORDER BY id', [t.id]);
  t.totals = totalsOf(t);
  t.support_discount_total = t.parts.reduce((a, p) => a + p.support_discount, 0);

  /* Máy này từng vào tiệm mấy lần — chống bảo hành vòng lặp */
  t.prior_tickets = all(`
    SELECT id, code, ts, status, ticket_type, issue FROM warranty_tickets
    WHERE id <> ? AND (
      (sale_id IS NOT NULL AND sale_id = ? AND COALESCE(product_id, 0) = COALESCE(?, 0))
      OR (serial IS NOT NULL AND serial <> '' AND serial = ?)
      OR (exchange_serial IS NOT NULL AND exchange_serial <> '' AND exchange_serial = ?)
    ) ORDER BY id DESC LIMIT 20`, [t.id, t.sale_id, t.product_id, t.serial, t.serial]);
  return t;
}

/* ==================================================================== */
/* Danh sách và chi tiết phiếu                                           */
/* ==================================================================== */

r.get('/warranty', (req, res) => {
  const { q = '', status, resolution, from, to, open_only, type } = req.query;
  const where = [];
  const params = [];
  if (q.trim()) {
    /* Số máy (serial) là chỗ hay cần tìm chính xác nhất: gõ "12" kiểu có
       chứa thì ra mọi máy có số 12 ở giữa (tài liệu 13, mục 2.1) */
    const c = searchWhere(
      ['t.code', 't.product_name', 't.serial', 't.customer_name', 't.customer_phone', 'c.name'],
      q, req.query.match);
    where.push(c.sql);
    params.push(...c.params);
  }
  if (status) { where.push('t.status = ?'); params.push(status); }
  if (resolution) { where.push('t.resolution = ?'); params.push(resolution); }
  if (type === 'warranty' || type === 'repair') { where.push('t.ticket_type = ?'); params.push(type); }
  if (from) { where.push('date(t.ts) >= date(?)'); params.push(from); }
  if (to) { where.push('date(t.ts) <= date(?)'); params.push(to); }
  // Đang còn ở tiệm hoặc đang ở hãng — cái cần theo dõi hằng ngày
  if (open_only === '1') where.push("t.status NOT IN ('delivered','cancelled')");

  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { page, size, offset } = pageParams(req.query);
  const total = get(`
    SELECT COUNT(*) AS n
    FROM warranty_tickets t
    LEFT JOIN customers c ON c.id = t.customer_id
    LEFT JOIN suppliers s ON s.id = t.supplier_id
    LEFT JOIN users u ON u.id = t.received_by
    LEFT JOIN sales sa ON sa.id = t.sale_id
    ${w}`, params).n;

  const rows = all(`
    SELECT t.*,
           COALESCE(c.name, t.customer_name) AS customer_display,
           COALESCE(c.phone, t.customer_phone) AS phone_display,
           s.name AS supplier_name, u.full_name AS received_by_name,
           sa.code AS sale_code,
           (SELECT COUNT(*) FROM warranty_photos p WHERE p.ticket_id = t.id) AS photo_count,
           CAST(julianday('now','localtime') - julianday(t.ts) AS INTEGER) AS days_open
    FROM warranty_tickets t
    LEFT JOIN customers c ON c.id = t.customer_id
    LEFT JOIN suppliers s ON s.id = t.supplier_id
    LEFT JOIN users u ON u.id = t.received_by
    LEFT JOIN sales sa ON sa.id = t.sale_id
    ${w}
    ORDER BY t.id DESC LIMIT ${size} OFFSET ${offset}`, params);
  res.json({ rows, total, page, page_size: size });
});

/* Đặt trước /warranty/:id, nếu không Express hiểu "photo-usage" là mã phiếu. */
r.get('/warranty/photo-usage', (req, res) => {
  const days = keepPhotoDays();
  const pending = get(
    "SELECT COUNT(*) AS n FROM warranty_photos p " +
    "JOIN warranty_tickets t ON t.id = p.ticket_id " +
    "WHERE date(t.ts) < date('now','localtime', '-' || ? || ' days')",
    [days]).n;
  res.json({ ...photoDiskUsage(), keep_days: days, pending_cleanup: pending });
});

r.get('/warranty/:id', (req, res) => {
  const t = ticketDetail(req.params.id);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy phiếu bảo hành' });
  res.json(t);
});

/* ==================================================================== */
/* Tra cứu hạn bảo hành hàng đã bán                                      */
/* ==================================================================== */

/**
 * Tra theo số điện thoại khách, mã hoá đơn, hoặc serial.
 * Trả về các dòng hàng đã bán kèm hạn bảo hành và còn hạn hay không — gồm
 * cả máy ĐỔI MỚI từ bảo hành, có ghi rõ đổi từ phiếu nào và truy ngược về
 * hoá đơn mua ban đầu (tài liệu 09, mục 6.2).
 */
r.get('/warranty-lookup', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Nhập số điện thoại, mã hoá đơn hoặc số serial để tra.' });

  const like = `%${q}%`;
  const sold = all(`
    SELECT si.id AS item_id, si.sale_id, si.product_id, si.name_snapshot AS product_name,
           si.unit_name, si.qty, si.price, si.serial,
           si.warranty_months, si.warranty_until, si.warranty_note,
           s.code AS sale_code, s.ts AS sale_ts,
           COALESCE(c.name, 'Khách lẻ') AS customer_name, c.phone AS customer_phone,
           c.id AS customer_id, p.sku,
           CASE
             WHEN si.warranty_until IS NULL THEN NULL
             WHEN date(si.warranty_until) >= date('now','localtime') THEN 1
             ELSE 0
           END AS in_warranty,
           CAST(julianday(si.warranty_until) - julianday('now','localtime') AS INTEGER) AS days_left,
           (SELECT COUNT(*) FROM warranty_tickets wt
             WHERE wt.sale_id = si.sale_id AND wt.product_id = si.product_id AND wt.status <> 'cancelled') AS ticket_count,
           NULL AS exchanged_from_code, NULL AS exchanged_ticket_id
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN products p ON p.id = si.product_id
    WHERE s.status = 'done'
      AND (c.phone LIKE ? OR s.code LIKE ? OR si.serial LIKE ?
           OR c.name LIKE ? OR si.name_snapshot LIKE ?)
    ORDER BY s.id DESC LIMIT 200`, [like, like, like, like, like]);

  const exchanged = all(`
    SELECT NULL AS item_id, t.sale_id, t.exchange_product_id AS product_id,
           ep.name AS product_name, ep.base_unit AS unit_name,
           COALESCE(t.exchange_qty, t.qty) AS qty, 0 AS price, t.exchange_serial AS serial,
           NULL AS warranty_months, t.exchange_warranty_until AS warranty_until, NULL AS warranty_note,
           s.code AS sale_code, s.ts AS sale_ts,
           COALESCE(c.name, t.customer_name, 'Khách lẻ') AS customer_name,
           COALESCE(c.phone, t.customer_phone) AS customer_phone,
           t.customer_id, ep.sku,
           CASE
             WHEN t.exchange_warranty_until IS NULL THEN NULL
             WHEN date(t.exchange_warranty_until) >= date('now','localtime') THEN 1
             ELSE 0
           END AS in_warranty,
           CAST(julianday(t.exchange_warranty_until) - julianday('now','localtime') AS INTEGER) AS days_left,
           0 AS ticket_count,
           t.code AS exchanged_from_code, t.id AS exchanged_ticket_id
    FROM warranty_tickets t
    JOIN products ep ON ep.id = t.exchange_product_id
    LEFT JOIN sales s ON s.id = t.sale_id
    LEFT JOIN customers c ON c.id = t.customer_id
    WHERE t.exchange_product_id IS NOT NULL
      AND (c.phone LIKE ? OR t.customer_phone LIKE ? OR s.code LIKE ? OR t.code LIKE ?
           OR t.exchange_serial LIKE ? OR c.name LIKE ? OR t.customer_name LIKE ? OR ep.name LIKE ?)
    ORDER BY t.id DESC LIMIT 100`, [like, like, like, like, like, like, like, like]);

  res.json([...exchanged, ...sold]);
});

/**
 * Dòng thời gian bảo hành / sửa chữa (tài liệu 09, mục 6.1): ngày nhận, lỗi,
 * kỹ thuật viên, linh kiện đã thay. Lọc theo hoá đơn (và mặt hàng), theo
 * khách, hoặc theo serial.
 */
r.get('/warranty-history', (req, res) => {
  const { sale_id, product_id, customer_id, serial } = req.query;
  const where = [];
  const params = [];
  if (sale_id) { where.push('t.sale_id = ?'); params.push(sale_id); }
  if (product_id) { where.push('t.product_id = ?'); params.push(product_id); }
  if (customer_id) { where.push('t.customer_id = ?'); params.push(customer_id); }
  if (serial) { where.push('(t.serial = ? OR t.exchange_serial = ?)'); params.push(serial, serial); }
  if (!where.length) return res.status(400).json({ error: 'Cần hoá đơn, khách hàng hoặc serial để tra lịch sử.' });

  const tickets = all(`
    SELECT t.id, t.code, t.ts, t.ticket_type, t.status, t.resolution, t.product_name, t.serial,
           t.issue, t.condition_note, t.delivered_at, t.labor_fee, t.fees_total, t.discount, t.charge,
           t.in_warranty, t.exchange_mode, t.exchange_warranty_until, t.exchange_serial,
           ep.name AS exchange_product_name, sa.code AS sale_code,
           COALESCE(tech.full_name, rb.full_name) AS technician_name
    FROM warranty_tickets t
    LEFT JOIN users tech ON tech.id = t.technician_id
    LEFT JOIN users rb ON rb.id = t.received_by
    LEFT JOIN products ep ON ep.id = t.exchange_product_id
    LEFT JOIN sales sa ON sa.id = t.sale_id
    WHERE ${where.join(' AND ')}
    ORDER BY t.ts DESC, t.id DESC LIMIT 50`, params);
  for (const t of tickets) {
    t.parts = all(`
      SELECT p.name, wp.qty, wp.price, wp.amount_sale FROM warranty_parts wp
      JOIN products p ON p.id = wp.product_id WHERE wp.ticket_id = ? ORDER BY wp.id`, [t.id]);
    t.custom_parts = all('SELECT name, qty, price, amount FROM warranty_custom_parts WHERE ticket_id = ? ORDER BY id', [t.id]);
    t.logs = all(`
      SELECT l.ts, l.status, l.note, u.full_name AS user_name
      FROM warranty_logs l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.ticket_id = ? ORDER BY l.id`, [t.id]);
  }
  res.json(tickets);
});

/* ==================================================================== */
/* Lập phiếu tiếp nhận                                                   */
/* ==================================================================== */

r.post('/warranty', (req, res) => {
  const b = req.body;
  if (!String(b.product_name || '').trim()) {
    return res.status(400).json({ error: 'Bắt buộc ghi tên hàng khách mang tới.' });
  }
  if (!b.customer_id && !String(b.customer_name || '').trim() && !String(b.customer_phone || '').trim()) {
    return res.status(400).json({ error: 'Ghi ít nhất tên hoặc số điện thoại của khách để còn gọi khi xong.' });
  }

  try {
    const result = tx(() => {
      const code = nextCode('warranty_tickets', 'BH');
      const type = normType(b.ticket_type);
      const info = run(`
        INSERT INTO warranty_tickets
          (code, ts, customer_id, customer_name, customer_phone, sale_id, product_id,
           product_name, serial, qty, issue, condition_note, accessories,
           in_warranty, warranty_until, status, promised_at, received_by, note,
           ticket_type, technician_id)
        VALUES(?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?, ?, ?, ?)`,
        [code, b.ts || null, b.customer_id || null,
          b.customer_name?.trim() || null, b.customer_phone?.trim() || null,
          b.sale_id || null, b.product_id || null, b.product_name.trim(),
          b.serial?.trim() || null, Number(b.qty) || 1,
          b.issue?.trim() || null, b.condition_note?.trim() || null,
          b.accessories?.trim() || null,
          b.in_warranty ? 1 : 0, b.warranty_until || null,
          b.promised_at || null, b.received_by || null, b.note?.trim() || null,
          type, Number(b.technician_id) || null]);
      const id = Number(info.lastInsertRowid);

      run('INSERT INTO warranty_logs(ticket_id, status, user_id, note) VALUES(?, ?, ?, ?)',
        [id, 'received', b.received_by || null,
          type === 'repair' ? 'Tiếp nhận sửa chữa dịch vụ' : 'Tiếp nhận bảo hành']);

      // Ảnh chụp lúc nhận — bằng chứng tình trạng máy
      for (const ph of (Array.isArray(b.photos) ? b.photos : []).slice(0, 12)) {
        const file = savePhoto(ph.data ?? ph, id);
        if (file) {
          run('INSERT INTO warranty_photos(ticket_id, kind, file, caption) VALUES(?, ?, ?, ?)',
            [id, 'received', file, ph.caption || null]);
        }
      }
      return { id, code, ticket_type: type };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

r.put('/warranty/:id', (req, res) => {
  const b = req.body;
  const t = get('SELECT * FROM warranty_tickets WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy phiếu bảo hành' });

  run(`UPDATE warranty_tickets SET
         customer_id = ?, customer_name = ?, customer_phone = ?,
         product_name = ?, serial = ?, qty = ?, issue = ?, condition_note = ?,
         accessories = ?, in_warranty = ?, warranty_until = ?, promised_at = ?, note = ?,
         ticket_type = ?, technician_id = ?
       WHERE id = ?`,
    [b.customer_id || null, b.customer_name?.trim() || null, b.customer_phone?.trim() || null,
      b.product_name ?? t.product_name, b.serial?.trim() || null, Number(b.qty) || 1,
      b.issue?.trim() || null, b.condition_note?.trim() || null, b.accessories?.trim() || null,
      b.in_warranty ? 1 : 0, b.warranty_until || null, b.promised_at || null,
      b.note?.trim() || null,
      b.ticket_type === undefined ? t.ticket_type : normType(b.ticket_type),
      b.technician_id === undefined ? t.technician_id : (Number(b.technician_id) || null),
      t.id]);
  res.json({ ok: true });
});

/* ==================================================================== */
/* Chuyển trạng thái                                                     */
/* ==================================================================== */

const VALID_STATUS = new Set(WARRANTY_STATUS.map((s) => s.key));

r.post('/warranty/:id/status', (req, res) => {
  const b = req.body;
  const t = get('SELECT * FROM warranty_tickets WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy phiếu bảo hành' });
  if (!VALID_STATUS.has(b.status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
  if (t.status === 'delivered') {
    return res.status(400).json({ error: 'Phiếu đã trả khách rồi, không đổi trạng thái được nữa.' });
  }

  if (b.status === 'sent_supplier' && !b.supplier_id && !t.supplier_id) {
    return res.status(400).json({ error: 'Chọn hãng/nhà cung cấp trước khi chuyển sang Đã gửi hãng.' });
  }

  try {
    tx(() => {
      const fields = ['status = ?'];
      const params = [b.status];

      if (b.resolution) { fields.push('resolution = ?'); params.push(b.resolution); }
      if (b.supplier_id !== undefined) { fields.push('supplier_id = ?'); params.push(b.supplier_id || null); }
      if (b.expected_at !== undefined) { fields.push('expected_at = ?'); params.push(b.expected_at || null); }
      if (b.promised_at !== undefined) { fields.push('promised_at = ?'); params.push(b.promised_at || null); }
      if (b.technician_id !== undefined) { fields.push('technician_id = ?'); params.push(Number(b.technician_id) || null); }

      if (b.status === 'sent_supplier') {
        fields.push("sent_at = COALESCE(?, datetime('now','localtime'))");
        params.push(b.sent_at || null);
      }
      // Từ "đã gửi hãng" chuyển sang trạng thái khác nghĩa là hàng đã về
      if (t.status === 'sent_supplier' && b.status !== 'sent_supplier' && !t.back_at) {
        fields.push("back_at = datetime('now','localtime')");
      }

      run(`UPDATE warranty_tickets SET ${fields.join(', ')} WHERE id = ?`, [...params, req.params.id]);
      run('INSERT INTO warranty_logs(ticket_id, status, user_id, note) VALUES(?, ?, ?, ?)',
        [t.id, b.status, b.user_id || null, b.note || null]);
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ==================================================================== */
/* Linh kiện, tiền công, phí phát sinh                                   */
/* ==================================================================== */

const openTicket = (id) => {
  const t = get('SELECT * FROM warranty_tickets WHERE id = ?', [id]);
  if (!t) throw Object.assign(new Error('Không tìm thấy phiếu bảo hành'), { status: 404 });
  if (t.status === 'delivered' || t.status === 'cancelled') {
    throw httpError('Phiếu đã đóng, không sửa linh kiện hay tiền được nữa.', 'TICKET_CLOSED');
  }
  return t;
};

/** Đọc một dòng linh kiện kho gửi lên. prev = dòng đang có (giữ giá niêm yết, giá vốn lúc thêm). */
function partLine(it, prev) {
  const productId = Number(it.product_id) || prev?.product_id;
  const p = get('SELECT id, name FROM products WHERE id = ?', [productId]);
  if (!p) throw httpError('Dòng linh kiện chưa chọn mặt hàng.', 'MISSING_PRODUCT');
  const qty = Number(it.qty);
  const listPrice = prev?.list_price || retailPriceOf(productId);
  const price = it.price === undefined || it.price === null || it.price === ''
    ? (prev ? prev.price : listPrice)
    : Math.round(Number(it.price) || 0);
  if (price < 0) throw httpError('Giá bán không được âm', 'NEGATIVE_PRICE');
  return {
    product_id: productId, name: p.name, qty, price, list_price: listPrice,
    unit_cost: prev ? prev.unit_cost : costOf(productId),
  };
}

function insertPendingPart(ticketId, l, approvedBy) {
  run(`INSERT INTO warranty_parts(ticket_id, product_id, qty, unit_cost, amount, price, amount_sale,
                                  list_price, stock_applied, approved_by)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [ticketId, l.product_id, l.qty, l.unit_cost, Math.round(l.qty * l.unit_cost),
      l.price, Math.round(l.qty * l.price), l.list_price, approvedBy]);
}

/**
 * Lưu cả giỏ linh kiện của phiếu một lần — hộp chọn linh kiện đồng bộ hai
 * chiều gọi cái này mỗi khi thêm, bớt, đổi số lượng hay đổi giá.
 *
 *   parts:  [{ id?, product_id, qty, price }]   linh kiện có mã trong kho
 *   custom: [{ id?, name, qty, price, note }]   linh kiện mua ngoài, gõ tay
 *
 * Chỉ thay các dòng CHƯA trừ kho. Dòng đã trừ kho (phiếu cũ) giữ nguyên số
 * lượng, chỉ đổi được giá; muốn bỏ thì xoá riêng để hoàn kho đàng hoàng.
 */
r.put('/warranty/:id/cart', (req, res) => {
  try {
    const t = openTicket(req.params.id);
    const b = req.body || {};
    const existing = all('SELECT * FROM warranty_parts WHERE ticket_id = ?', [t.id]);
    const byId = new Map(existing.map((x) => [x.id, x]));

    const pending = [];
    const appliedPrices = [];
    for (const it of Array.isArray(b.parts) ? b.parts : []) {
      const prev = it.id ? byId.get(Number(it.id)) : null;
      if (prev?.stock_applied) {
        const l = partLine({ ...it, qty: prev.qty }, prev);
        appliedPrices.push({ ...l, id: prev.id });
        continue;
      }
      if (!(Number(it.qty) > 0)) continue;
      pending.push(partLine(it, prev));
    }
    const custom = (Array.isArray(b.custom) ? b.custom : [])
      .map((c) => ({
        name: String(c?.name ?? '').trim(),
        qty: Number(c?.qty) || 0,
        price: Math.max(0, Math.round(Number(c?.price) || 0)),
        note: String(c?.note ?? '').trim() || null,
      }))
      .filter((c) => c.qty > 0);
    if (custom.some((c) => !c.name)) throw httpError('Linh kiện ngoài hệ thống phải có tên.', 'CUSTOM_NAME_REQUIRED');

    const gate = belowCostGate(req, [...pending, ...appliedPrices]);

    tx(() => {
      run('DELETE FROM warranty_parts WHERE ticket_id = ? AND stock_applied = 0', [t.id]);
      for (const l of pending) insertPendingPart(t.id, l, gate.approvedBy);
      for (const l of appliedPrices) {
        run('UPDATE warranty_parts SET price = ?, amount_sale = ? WHERE id = ?',
          [l.price, Math.round(l.qty * l.price), l.id]);
      }
      run('DELETE FROM warranty_custom_parts WHERE ticket_id = ?', [t.id]);
      for (const c of custom) {
        run(`INSERT INTO warranty_custom_parts(ticket_id, name, qty, price, amount, note)
             VALUES(?, ?, ?, ?, ?, ?)`, [t.id, c.name, c.qty, c.price, Math.round(c.qty * c.price), c.note]);
      }
      recalcTicket(t.id);
    });
    if (gate.token) consumeApproval(gate.token);
    res.json(ticketDetail(t.id));
  } catch (e) { fail(res, e); }
});

/** Thêm linh kiện kho vào phiếu (giữ cho màn hình cũ). Chờ trừ kho tới lúc hoàn thành. */
r.post('/warranty/:id/parts', (req, res) => {
  try {
    const t = openTicket(req.params.id);
    const items = Array.isArray(req.body?.items) ? req.body.items.filter((i) => Number(i.qty) > 0) : [];
    if (!items.length) throw httpError('Chưa chọn linh kiện nào.');
    const lines = items.map((it) => partLine(it, null));
    const gate = belowCostGate(req, lines);
    tx(() => {
      for (const l of lines) insertPendingPart(t.id, l, gate.approvedBy);
      recalcTicket(t.id);
      const sale = get('SELECT parts_price AS s FROM warranty_tickets WHERE id = ?', [t.id]).s;
      run('INSERT INTO warranty_logs(ticket_id, status, user_id, note) VALUES(?, ?, ?, ?)',
        [t.id, t.status, req.body.user_id || null,
          `Thêm ${lines.length} loại linh kiện, tiền linh kiện ${fmt(sale)} đ (trừ kho khi hoàn thành phiếu)`]);
    });
    if (gate.token) consumeApproval(gate.token);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

/**
 * Sửa giá bán của một dòng linh kiện. Chỉ đổi con số tính cho khách; giá
 * niêm yết của mặt hàng trong danh mục không đổi (tài liệu 09, mục 2.1A).
 */
r.put('/warranty/:id/parts/:partId', (req, res) => {
  try {
    const part = get(`SELECT wp.*, p.name FROM warranty_parts wp JOIN products p ON p.id = wp.product_id
                      WHERE wp.id = ? AND wp.ticket_id = ?`, [req.params.partId, req.params.id]);
    if (!part) return res.status(404).json({ error: 'Không tìm thấy dòng linh kiện' });
    const price = Math.round(Number(req.body.price) || 0);
    if (price < 0) return res.status(400).json({ error: 'Giá bán không được âm' });
    const gate = belowCostGate(req, [{ name: part.name, price, unit_cost: part.unit_cost }]);

    tx(() => {
      run('UPDATE warranty_parts SET price = ?, amount_sale = ?, approved_by = COALESCE(?, approved_by) WHERE id = ?',
        [price, Math.round(part.qty * price), gate.approvedBy, part.id]);
      recalcTicket(Number(req.params.id));
    });
    if (gate.token) consumeApproval(gate.token);
    res.json({ ok: true, parts_price: get('SELECT parts_price AS p FROM warranty_tickets WHERE id = ?',
      [req.params.id]).p });
  } catch (e) { fail(res, e); }
});

r.delete('/warranty/:id/parts/:partId', (req, res) => {
  const part = get('SELECT * FROM warranty_parts WHERE id = ? AND ticket_id = ?',
    [req.params.partId, req.params.id]);
  if (!part) return res.status(404).json({ error: 'Không tìm thấy dòng linh kiện' });
  const t = get('SELECT * FROM warranty_tickets WHERE id = ?', [req.params.id]);
  if (t.status === 'delivered') return res.status(400).json({ error: 'Phiếu đã trả khách, không bỏ linh kiện được.' });
  const warehouseId = get('SELECT id FROM warehouses WHERE is_default = 1')?.id;

  tx(() => {
    /* Chỉ dòng đã trừ kho mới phải hoàn kho */
    if (part.stock_applied) {
      moveStock({
        productId: part.product_id, warehouseId, qtyChange: part.qty, unitCost: part.unit_cost,
        refType: 'warranty', refId: t.id, refCode: t.code, note: `Bỏ linh kiện khỏi phiếu ${t.code}`,
      });
    }
    run('DELETE FROM warranty_parts WHERE id = ?', [part.id]);
    recalcTicket(t.id);
  });
  res.json({ ok: true });
});

/**
 * Tiền công, phí phát sinh và miễn giảm.
 *   labor_fee  tiền công kỹ thuật (gõ tự do hoặc chọn từ bảng giá cài sẵn)
 *   fees       [{ name, amount, note }] — gửi hãng, vận chuyển...
 *   discount   giá trị miễn giảm cho khách
 */
r.put('/warranty/:id/fees', (req, res) => {
  try {
    const t = openTicket(req.params.id);
    const b = req.body || {};
    const fees = (Array.isArray(b.fees) ? b.fees : [])
      .map((f) => ({ name: String(f?.name ?? '').trim(), amount: money(f?.amount), note: String(f?.note ?? '').trim() || null }))
      .filter((f) => f.name || f.amount);
    if (fees.some((f) => f.amount < 0)) throw httpError('Phí phát sinh không được âm.');
    if (fees.some((f) => !f.name)) throw httpError('Phí phát sinh phải ghi tên khoản phí.', 'FEE_NAME_REQUIRED');
    tx(() => {
      if (b.labor_fee !== undefined) run('UPDATE warranty_tickets SET labor_fee = ? WHERE id = ?', [Math.max(0, money(b.labor_fee)), t.id]);
      if (Array.isArray(b.fees)) {
        run('DELETE FROM warranty_fees WHERE ticket_id = ?', [t.id]);
        for (const f of fees) {
          run('INSERT INTO warranty_fees(ticket_id, name, amount, note) VALUES(?, ?, ?, ?)', [t.id, f.name, f.amount, f.note]);
        }
      }
      recalcTicket(t.id);
      if (b.discount !== undefined) {
        const cur = get('SELECT * FROM warranty_tickets WHERE id = ?', [t.id]);
        const gross = totalsOf({ ...cur, discount: 0 }).gross;
        run('UPDATE warranty_tickets SET discount = ? WHERE id = ?', [Math.min(Math.max(0, money(b.discount)), gross), t.id]);
      }
    });
    res.json(ticketDetail(t.id));
  } catch (e) { fail(res, e); }
});

/* ==================================================================== */
/* Đổi cái mới cho khách                                                 */
/* ==================================================================== */

/**
 * Đổi sản phẩm mới tinh (tài liệu 09, mục 6.2):
 *   - xuất máy mới khỏi kho bán (trừ tồn);
 *   - nhập máy lỗi của khách vào kho hàng lỗi chờ tiêu huỷ / trả hãng;
 *   - hạn bảo hành máy mới: kế thừa ngày còn lại của máy cũ (inherit),
 *     hoặc tính lại từ đầu N tháng (reset);
 *   - ghi liên kết để tra cứu máy mới truy ngược được về hoá đơn gốc.
 */
r.post('/warranty/:id/exchange', (req, res) => {
  const t = get('SELECT * FROM warranty_tickets WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy phiếu bảo hành' });
  if (t.exchange_product_id) return res.status(400).json({ error: 'Phiếu này đã đổi hàng rồi.' });

  const b = req.body;
  const productId = Number(b.product_id);
  const qty = Number(b.qty) || t.qty || 1;
  const warehouseId = Number(b.warehouse_id) ||
    get('SELECT id FROM warehouses WHERE is_default = 1')?.id;
  const mode = b.warranty_mode === 'reset' ? 'reset' : 'inherit';
  const months = Math.max(0, Math.round(Number(b.warranty_months) || 0));

  const p = get('SELECT name, track_stock FROM products WHERE id = ?', [productId]);
  if (!p) return res.status(400).json({ error: 'Chọn mặt hàng để đổi cho khách.' });
  if (mode === 'reset' && !(months > 0)) {
    return res.status(400).json({ error: 'Chọn số tháng bảo hành mới cho máy đổi.', code: 'MONTHS_REQUIRED' });
  }
  if (p.track_stock) {
    const st = get('SELECT qty FROM stock WHERE product_id = ? AND warehouse_id = ?',
      [productId, warehouseId])?.qty ?? 0;
    if (st < qty) return res.status(400).json({ error: `"${p.name}" chỉ còn ${st} trong kho.` });
  }

  try {
    const out = tx(() => {
      moveStock({
        productId, warehouseId, qtyChange: -qty, unitCost: costOf(productId),
        refType: 'warranty', refId: t.id, refCode: t.code,
        note: `Đổi mới cho khách theo phiếu bảo hành ${t.code}`,
      });

      /* Máy lỗi khách mang trả vào kho hàng lỗi — chỉ khi máy đó có mã trong
         danh mục; hàng mang từ ngoài vào không có mã thì không có gì để nhập */
      let defectWh = null;
      if (t.product_id && b.receive_defect !== false) {
        defectWh = ensureDefectWarehouse();
        moveStock({
          productId: t.product_id, warehouseId: defectWh, qtyChange: t.qty || 1, unitCost: costOf(t.product_id),
          refType: 'warranty', refId: t.id, refCode: t.code,
          note: `Nhận máy lỗi đổi mới theo phiếu ${t.code} — chờ tiêu huỷ / trả hãng`,
        });
      }

      let until;
      if (mode === 'reset') {
        until = get("SELECT date('now','localtime', '+' || ? || ' months') AS d", [months]).d;
      } else {
        until = t.warranty_until
          || (t.sale_id
            ? get('SELECT warranty_until FROM sale_items WHERE sale_id = ? AND COALESCE(product_id, 0) = COALESCE(?, 0) ORDER BY id LIMIT 1',
              [t.sale_id, t.product_id])?.warranty_until
            : null)
          || null;
      }

      run(`UPDATE warranty_tickets SET exchange_product_id = ?, resolution = 'exchange',
             exchange_mode = ?, exchange_warranty_until = ?, exchange_serial = ?, exchange_qty = ?
           WHERE id = ?`,
        [productId, mode, until, String(b.serial ?? '').trim() || null, qty, t.id]);
      run('INSERT INTO warranty_logs(ticket_id, status, user_id, note) VALUES(?, ?, ?, ?)',
        [t.id, t.status, b.user_id || null,
          `Đổi mới: ${p.name} (${qty}) — bảo hành ${mode === 'reset'
            ? `mới ${months} tháng, tới ${until}`
            : `kế thừa máy cũ, tới ${until || 'không rõ hạn'}`}${defectWh ? '; máy lỗi đã nhập kho hàng lỗi' : ''}`]);
      return { ok: true, warranty_until: until, warranty_mode: mode, defect_warehouse_id: defectWh };
    });
    res.json(out);
  } catch (e) { fail(res, e); }
});

/* ==================================================================== */
/* Hoàn thành & trả khách — trừ kho linh kiện, thu tiền                  */
/* ==================================================================== */

r.post('/warranty/:id/deliver', (req, res) => {
  const b = req.body;
  const t = get('SELECT * FROM warranty_tickets WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy phiếu bảo hành' });
  if (t.status === 'delivered') return res.status(400).json({ error: 'Phiếu này đã trả khách rồi.' });
  if (t.status === 'cancelled') return res.status(400).json({ error: 'Phiếu đã huỷ.' });

  const accountId = Number(b.account_id) || defaultCashAccount();
  const partner = t.customer_name || get('SELECT name FROM customers WHERE id = ?', [t.customer_id])?.name;
  const warehouseId = Number(b.warehouse_id) || get('SELECT id FROM warehouses WHERE is_default = 1')?.id;
  const allowNegative = getSettings().allow_negative_stock === true;

  try {
    const out = tx(() => {
      /* Chốt tiền công và phí gửi kèm (màn hình cũ gửi thẳng labor_fee lúc trả) */
      if (b.labor_fee !== undefined) {
        run('UPDATE warranty_tickets SET labor_fee = ? WHERE id = ?', [Math.max(0, money(b.labor_fee)), t.id]);
      }
      if (Array.isArray(b.fees)) {
        run('DELETE FROM warranty_fees WHERE ticket_id = ?', [t.id]);
        for (const f of b.fees) {
          const name = String(f?.name ?? '').trim();
          if (!name) continue;
          run('INSERT INTO warranty_fees(ticket_id, name, amount, note) VALUES(?, ?, ?, ?)',
            [t.id, name, Math.max(0, money(f.amount)), String(f?.note ?? '').trim() || null]);
        }
      }

      /* Trừ kho linh kiện đang chờ — đúng lúc hoàn thành phiếu (tài liệu 09, mục 2.1A) */
      const pending = all(`SELECT wp.*, p.name, p.track_stock FROM warranty_parts wp
                           JOIN products p ON p.id = wp.product_id
                           WHERE wp.ticket_id = ? AND wp.stock_applied = 0`, [t.id]);
      if (!allowNegative) {
        const need = new Map();
        for (const x of pending) {
          if (!x.track_stock) continue;
          need.set(x.product_id, { name: x.name, qty: (need.get(x.product_id)?.qty || 0) + x.qty });
        }
        for (const [pid, n] of need) {
          const st = get('SELECT qty FROM stock WHERE product_id = ? AND warehouse_id = ?', [pid, warehouseId])?.qty ?? 0;
          if (st < n.qty - 1e-9) {
            throw httpError(`"${n.name}" chỉ còn ${st} trong kho, không đủ ${n.qty} để hoàn thành phiếu.`, 'INSUFFICIENT_STOCK');
          }
        }
      }
      for (const x of pending) {
        const cost = costOf(x.product_id);
        moveStock({
          productId: x.product_id, warehouseId, qtyChange: -x.qty, unitCost: cost,
          refType: 'warranty', refId: t.id, refCode: t.code,
          note: `Thay linh kiện ${t.ticket_type === 'repair' ? 'sửa chữa' : 'bảo hành'} ${t.code}`,
        });
        run('UPDATE warranty_parts SET stock_applied = 1, unit_cost = ?, amount = ? WHERE id = ?',
          [cost, Math.round(x.qty * cost), x.id]);
      }
      recalcTicket(t.id);

      const cur = get('SELECT * FROM warranty_tickets WHERE id = ?', [t.id]);
      const gross = totalsOf({ ...cur, discount: 0 }).gross;
      let discount = cur.discount || 0;
      if (b.discount !== undefined && b.discount !== null && b.discount !== '') {
        discount = money(b.discount);
      } else if (b.charge !== undefined && b.charge !== null && b.charge !== '') {
        /* Màn hình cũ gửi thẳng số tiền thu: phần chênh so với tổng coi là miễn giảm */
        discount = Math.max(0, gross - money(b.charge));
      }
      discount = Math.min(Math.max(0, discount), gross);
      const charge = gross - discount;
      const paid = Math.min(Math.max(0, money(b.paid)), charge);
      const refund = Math.max(0, money(b.refund_amount));

      run(`UPDATE warranty_tickets SET status = 'delivered', resolution = COALESCE(?, resolution),
             discount = ?, charge = ?, paid = ?, refund_amount = ?,
             technician_id = COALESCE(?, technician_id),
             delivered_at = COALESCE(?, datetime('now','localtime')), note = COALESCE(?, note)
           WHERE id = ?`,
        [b.resolution || null, discount, charge, paid, refund,
          Number(b.technician_id) || null, b.delivered_at || null, b.note || null, t.id]);

      run('INSERT INTO warranty_logs(ticket_id, status, user_id, note) VALUES(?, ?, ?, ?)',
        [t.id, 'delivered', b.user_id || null,
          b.note || `Hoàn thành, trả khách — thu ${fmt(paid)} / ${fmt(charge)} đ`
            + (pending.length ? `; trừ kho ${pending.length} dòng linh kiện` : '')]);

      /* Tiền linh kiện mua ngoài gom riêng một mục thu, để kế toán đối soát
         dòng tiền vãng lai (tài liệu 09, mục 2.1B) */
      if (paid > 0 && accountId) {
        const customPart = Math.min(cur.custom_parts_price || 0, paid);
        const rest = paid - customPart;
        if (customPart > 0) {
          addCashTx({
            accountId, direction: 'in', amount: customPart, category: 'custom_parts_in',
            partnerType: 'customer', partnerId: t.customer_id || null, partnerName: partner,
            refType: 'warranty', refId: t.id, refCode: t.code, userId: b.user_id || null,
            note: `Linh kiện ngoài hệ thống phiếu ${t.code}`,
          });
        }
        if (rest > 0) {
          addCashTx({
            accountId, direction: 'in', amount: rest, category: 'warranty_in',
            partnerType: 'customer', partnerId: t.customer_id || null, partnerName: partner,
            refType: 'warranty', refId: t.id, refCode: t.code, userId: b.user_id || null,
            note: `Thu tiền ${t.ticket_type === 'repair' ? 'sửa chữa' : 'bảo hành'} phiếu ${t.code}`,
          });
        }
      }
      if (refund > 0 && accountId) {
        addCashTx({
          accountId, direction: 'out', amount: refund, category: 'other_out',
          partnerType: 'customer', partnerId: t.customer_id || null, partnerName: partner,
          refType: 'warranty', refId: t.id, refCode: t.code, userId: b.user_id || null,
          note: `Hoàn tiền bảo hành phiếu ${t.code}`,
        });
      }

      // Ảnh lúc trả — bằng chứng đã sửa xong
      for (const ph of (Array.isArray(b.photos) ? b.photos : []).slice(0, 12)) {
        const file = savePhoto(ph.data ?? ph, t.id);
        if (file) {
          run('INSERT INTO warranty_photos(ticket_id, kind, file, caption) VALUES(?, ?, ?, ?)',
            [t.id, 'done', file, ph.caption || null]);
        }
      }
      return { ok: true, charge, discount, paid, stock_applied: pending.length };
    });
    res.json(out);
  } catch (e) { fail(res, e); }
});

/* ==================================================================== */
/* Thêm / xoá ảnh sau khi đã lập phiếu                                   */
/* ==================================================================== */

r.post('/warranty/:id/photos', (req, res) => {
  const t = get('SELECT id FROM warranty_tickets WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy phiếu bảo hành' });
  const photos = Array.isArray(req.body?.photos) ? req.body.photos.slice(0, 12) : [];
  let saved = 0;
  for (const ph of photos) {
    const file = savePhoto(ph.data ?? ph, t.id);
    if (file) {
      run('INSERT INTO warranty_photos(ticket_id, kind, file, caption) VALUES(?, ?, ?, ?)',
        [t.id, req.body.kind === 'done' ? 'done' : 'received', file, ph.caption || null]);
      saved++;
    }
  }
  if (!saved) return res.status(400).json({ error: 'Không lưu được ảnh nào. Chỉ nhận ảnh JPG, PNG hoặc WebP dưới 6MB.' });
  res.json({ ok: true, saved });
});

r.delete('/warranty/photos/:photoId', (req, res) => {
  const ph = get('SELECT * FROM warranty_photos WHERE id = ?', [req.params.photoId]);
  if (!ph) return res.status(404).json({ error: 'Không tìm thấy ảnh' });
  try { fs.unlinkSync(path.join(WARRANTY_DIR, path.basename(ph.file))); } catch { /* file đã mất */ }
  run('DELETE FROM warranty_photos WHERE id = ?', [ph.id]);
  res.json({ ok: true });
});

/* ==================================================================== */
/* Huỷ phiếu — hoàn linh kiện đã trừ kho                                 */
/* ==================================================================== */

r.post('/warranty/:id/cancel', (req, res) => {
  const t = get('SELECT * FROM warranty_tickets WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy phiếu bảo hành' });
  if (t.status === 'delivered') {
    return res.status(400).json({ error: 'Phiếu đã trả khách, không huỷ được.' });
  }
  const warehouseId = get('SELECT id FROM warehouses WHERE is_default = 1')?.id;

  tx(() => {
    for (const p of all('SELECT * FROM warranty_parts WHERE ticket_id = ? AND stock_applied = 1', [t.id])) {
      moveStock({
        productId: p.product_id, warehouseId, qtyChange: p.qty, unitCost: p.unit_cost,
        refType: 'warranty', refId: t.id, refCode: t.code,
        note: `Huỷ phiếu ${t.code}, hoàn linh kiện`,
      });
    }
    run('DELETE FROM warranty_parts WHERE ticket_id = ?', [t.id]);
    run('DELETE FROM warranty_custom_parts WHERE ticket_id = ?', [t.id]);
    run("UPDATE warranty_tickets SET status = 'cancelled', parts_cost = 0, parts_price = 0, custom_parts_price = 0 WHERE id = ?", [t.id]);
    run('INSERT INTO warranty_logs(ticket_id, status, user_id, note) VALUES(?, ?, ?, ?)',
      [t.id, 'cancelled', req.body?.user_id || null, req.body?.note || 'Huỷ phiếu']);
  });
  res.json({ ok: true });
});

/* ==================================================================== */
/* Bảng tổng hợp cho trang bảo hành                                      */
/* ==================================================================== */

r.get('/warranty-summary', (req, res) => {
  const byStatus = all(`
    SELECT status, COUNT(*) AS n FROM warranty_tickets GROUP BY status`);
  const counts = Object.fromEntries(byStatus.map((x) => [x.status, x.n]));

  const open = get(`
    SELECT COUNT(*) AS n FROM warranty_tickets
    WHERE status NOT IN ('delivered','cancelled')`).n;

  // Quá hẹn trả khách mà chưa xong — cái dễ mất lòng khách nhất
  const overdue = all(`
    SELECT t.id, t.code, t.product_name, t.promised_at, t.status,
           COALESCE(c.name, t.customer_name) AS customer_display,
           COALESCE(c.phone, t.customer_phone) AS phone_display,
           CAST(julianday('now','localtime') - julianday(t.promised_at) AS INTEGER) AS days_late
    FROM warranty_tickets t LEFT JOIN customers c ON c.id = t.customer_id
    WHERE t.status NOT IN ('delivered','cancelled')
      AND t.promised_at IS NOT NULL AND date(t.promised_at) < date('now','localtime')
    ORDER BY t.promised_at LIMIT 30`);

  // Gửi hãng lâu chưa thấy về
  const atSupplier = all(`
    SELECT t.id, t.code, t.product_name, t.sent_at, t.expected_at,
           s.name AS supplier_name,
           CAST(julianday('now','localtime') - julianday(t.sent_at) AS INTEGER) AS days_sent
    FROM warranty_tickets t LEFT JOIN suppliers s ON s.id = t.supplier_id
    WHERE t.status = 'sent_supplier'
    ORDER BY t.sent_at LIMIT 30`);

  const money30 = get(`
    SELECT COALESCE(SUM(charge), 0) AS charge,
           COALESCE(SUM(paid), 0) AS paid,
           COALESCE(SUM(parts_cost), 0) AS parts,
           COALESCE(SUM(refund_amount), 0) AS refund,
           COUNT(*) AS n
    FROM warranty_tickets
    WHERE status = 'delivered' AND date(delivered_at) >= date('now','localtime','-29 days')`);

  const byType = Object.fromEntries(all(`
    SELECT ticket_type, COUNT(*) AS n FROM warranty_tickets
    WHERE status NOT IN ('delivered','cancelled') GROUP BY ticket_type`).map((x) => [x.ticket_type, x.n]));

  res.json({ counts, open, overdue, at_supplier: atSupplier, last30: money30, open_by_type: byType });
});

/* ==================================================================== */
/* Tự dọn ảnh cũ cho đỡ đầy ổ cứng                                       */
/*                                                                       */
/* Đếm từ NGÀY NHẬN MÁY của phiếu, không phải ngày trả khách. Quá số     */
/* ngày quy định thì xoá ảnh, dù phiếu đã đóng hay còn đang xử lý.       */
/* Đặt 0 ở Thiết lập nếu muốn giữ ảnh vĩnh viễn.                         */
/* ==================================================================== */

const DEFAULT_KEEP_PHOTO_DAYS = 60;

/** Đọc số ngày giữ ảnh. Dùng ?? chứ không dùng ||, vì 0 là giá trị hợp lệ
    (0 = giữ ảnh vĩnh viễn) mà || lại coi 0 là rỗng rồi rơi về mặc định. */
function keepPhotoDays() {
  const v = getSettings()?.warranty?.photo_keep_days;
  const n = Number(v);
  return v === undefined || v === null || v === '' || Number.isNaN(n)
    ? DEFAULT_KEEP_PHOTO_DAYS
    : n;
}

export function cleanupOldPhotos() {
  const days = keepPhotoDays();
  if (days <= 0) return { deleted: 0, freed: 0, days };   // 0 = giữ mãi

  const rows = all(
    "SELECT p.id, p.file FROM warranty_photos p " +
    "JOIN warranty_tickets t ON t.id = p.ticket_id " +
    "WHERE date(t.ts) < date('now','localtime', '-' || ? || ' days')",
    [days]);

  let deleted = 0;
  let freed = 0;
  for (const row of rows) {
    const full = path.join(WARRANTY_DIR, path.basename(row.file));
    try {
      if (fs.existsSync(full)) { freed += fs.statSync(full).size; fs.unlinkSync(full); }
      run('DELETE FROM warranty_photos WHERE id = ?', [row.id]);
      deleted++;
    } catch { /* file đang bị khoá, lần sau dọn tiếp */ }
  }
  if (deleted) {
    console.log('  [dọn ảnh] xoá ' + deleted + ' ảnh của phiếu nhận quá ' + days +
      ' ngày, giải phóng ' + (freed / 1024 / 1024).toFixed(1) + ' MB');
  }
  return { deleted, freed, days };
}

/** Dung lượng ảnh đang chiếm, để hiện ở màn hình Thiết lập. */
export function photoDiskUsage() {
  let bytes = 0;
  let files = 0;
  try {
    for (const name of fs.readdirSync(WARRANTY_DIR)) {
      try { bytes += fs.statSync(path.join(WARRANTY_DIR, name)).size; files++; }
      catch { /* file vừa bị xoá */ }
    }
  } catch { /* chưa có thư mục */ }
  return { files, bytes, text: (bytes / 1024 / 1024).toFixed(1) + ' MB' };
}

/** Dọn ngay theo yêu cầu, không đợi tới lịch. */
r.post('/warranty/cleanup-photos', (req, res) => {
  const result = cleanupOldPhotos();
  res.json({
    ok: true,
    ...result,
    message: result.deleted
      ? 'Đã xoá ' + result.deleted + ' ảnh, giải phóng ' +
        (result.freed / 1024 / 1024).toFixed(1) + ' MB.'
      : 'Không có ảnh nào quá hạn cần dọn.',
  });
});

/* ==================================================================== */
/* Báo cáo bảo hành — chủ tiệm mở ra là biết ai đang chờ lấy hàng         */
/* ==================================================================== */

r.get('/reports/warranty', (req, res) => {
  const today = new Date().toLocaleDateString('sv-SE');
  const from = req.query.from || today.slice(0, 8) + '01';
  const to = req.query.to || today;

  // Đang chờ khách tới lấy — danh sách cần gọi điện
  const waiting = all(
    "SELECT t.id, t.code, t.ts, t.product_name, t.serial, t.promised_at, t.charge, t.paid, t.ticket_type, " +
    "       COALESCE(c.name, t.customer_name) AS customer_display, " +
    "       COALESCE(c.phone, t.customer_phone) AS phone_display, " +
    "       CAST(julianday('now','localtime') - julianday(t.ts) AS INTEGER) AS days_open " +
    "FROM warranty_tickets t LEFT JOIN customers c ON c.id = t.customer_id " +
    "WHERE t.status = 'ready' ORDER BY t.promised_at, t.ts");

  // Toàn bộ phiếu chưa đóng, kèm số ngày trễ hẹn
  const open = all(
    "SELECT t.id, t.code, t.ts, t.status, t.product_name, t.promised_at, t.ticket_type, " +
    "       COALESCE(c.name, t.customer_name) AS customer_display, " +
    "       COALESCE(c.phone, t.customer_phone) AS phone_display, " +
    "       s.name AS supplier_name, t.sent_at, t.expected_at, " +
    "       CAST(julianday('now','localtime') - julianday(t.ts) AS INTEGER) AS days_open, " +
    "       CASE WHEN t.promised_at IS NOT NULL " +
    "            THEN CAST(julianday('now','localtime') - julianday(t.promised_at) AS INTEGER) " +
    "            ELSE NULL END AS days_late " +
    "FROM warranty_tickets t " +
    "LEFT JOIN customers c ON c.id = t.customer_id " +
    "LEFT JOIN suppliers s ON s.id = t.supplier_id " +
    "WHERE t.status NOT IN ('delivered','cancelled') ORDER BY t.ts");

  // Đã xong trong kỳ — xem tiền và thời gian sửa
  const done = all(
    "SELECT t.id, t.code, t.ts, t.delivered_at, t.product_name, t.resolution, t.ticket_type, " +
    "       t.labor_fee, t.parts_cost, t.charge, t.paid, t.refund_amount, t.in_warranty, " +
    "       t.custom_parts_price, t.fees_total, t.discount, " +
    "       COALESCE(c.name, t.customer_name) AS customer_display, " +
    "       (t.charge - t.parts_cost) AS profit, " +
    "       CAST(julianday(t.delivered_at) - julianday(t.ts) AS INTEGER) AS days_taken " +
    "FROM warranty_tickets t LEFT JOIN customers c ON c.id = t.customer_id " +
    "WHERE t.status = 'delivered' AND date(t.delivered_at) BETWEEN date(?) AND date(?) " +
    "ORDER BY t.delivered_at DESC", [from, to]);

  // Mặt hàng hay hỏng — biết nên ngưng nhập hàng nào
  const byProduct = all(
    "SELECT t.product_name, COUNT(*) AS n, " +
    "       SUM(CASE WHEN t.in_warranty = 1 THEN 1 ELSE 0 END) AS in_warranty_count, " +
    "       COALESCE(SUM(t.parts_cost), 0) AS parts_cost, " +
    "       COALESCE(SUM(t.charge), 0) AS charge " +
    "FROM warranty_tickets t " +
    "WHERE t.status != 'cancelled' AND date(t.ts) BETWEEN date(?) AND date(?) " +
    "GROUP BY t.product_name ORDER BY n DESC, parts_cost DESC LIMIT 30", [from, to]);

  const byResolution = all(
    "SELECT COALESCE(t.resolution, 'chua_quyet') AS resolution, COUNT(*) AS n " +
    "FROM warranty_tickets t " +
    "WHERE t.status = 'delivered' AND date(t.delivered_at) BETWEEN date(?) AND date(?) " +
    "GROUP BY t.resolution ORDER BY n DESC", [from, to]);

  const totals = {
    received: get("SELECT COUNT(*) AS n FROM warranty_tickets " +
      "WHERE date(ts) BETWEEN date(?) AND date(?)", [from, to]).n,
    done: done.length,
    waiting: waiting.length,
    open: open.length,
    late: open.filter((x) => x.days_late > 0).length,
    charge: done.reduce((a, x) => a + x.charge, 0),
    paid: done.reduce((a, x) => a + x.paid, 0),
    parts: done.reduce((a, x) => a + x.parts_cost, 0),
    custom_parts: done.reduce((a, x) => a + (x.custom_parts_price || 0), 0),
    refund: done.reduce((a, x) => a + x.refund_amount, 0),
    avg_days: done.length
      ? Math.round(done.reduce((a, x) => a + (x.days_taken || 0), 0) / done.length)
      : 0,
  };

  res.json({ from, to, waiting, open, done, by_product: byProduct, by_resolution: byResolution, totals });
});

export default r;
