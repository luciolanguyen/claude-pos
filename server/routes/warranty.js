import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  all, get, run, tx, nextCode, moveStock, costOf,
  addCashTx, defaultCashAccount, WARRANTY_DIR, getSettings,
} from '../db.js';

const r = Router();

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

r.get('/warranty/meta', (req, res) =>
  res.json({ statuses: WARRANTY_STATUS, resolutions: RESOLUTIONS }));

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
/* Danh sách và chi tiết phiếu bảo hành                                  */
/* ==================================================================== */

r.get('/warranty', (req, res) => {
  const { q = '', status, resolution, from, to, open_only, limit = 300 } = req.query;
  const where = [];
  const params = [];
  if (q.trim()) {
    where.push(`(t.code LIKE ? OR t.product_name LIKE ? OR t.serial LIKE ?
                 OR t.customer_name LIKE ? OR t.customer_phone LIKE ? OR c.name LIKE ?)`);
    const like = `%${q.trim()}%`;
    params.push(like, like, like, like, like, like);
  }
  if (status) { where.push('t.status = ?'); params.push(status); }
  if (resolution) { where.push('t.resolution = ?'); params.push(resolution); }
  if (from) { where.push('date(t.ts) >= date(?)'); params.push(from); }
  if (to) { where.push('date(t.ts) <= date(?)'); params.push(to); }
  // Đang còn ở tiệm hoặc đang ở hãng — cái cần theo dõi hằng ngày
  if (open_only === '1') where.push("t.status NOT IN ('delivered','cancelled')");

  res.json(all(`
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
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.id DESC LIMIT ${Number(limit)}`, params));
});

/* Đặt trước /warranty/:id, nếu không Express hiểu "photo-usage" là mã phiếu. */
r.get('/warranty/photo-usage', (req, res) => {
  const days = keepPhotoDays();
  const pending = get(
    "SELECT COUNT(*) AS n FROM warranty_photos p " +
    "JOIN warranty_tickets t ON t.id = p.ticket_id " +
    "WHERE t.status IN ('delivered','cancelled') " +
    "  AND date(COALESCE(t.delivered_at, t.ts)) < date('now','localtime', '-' || ? || ' days')",
    [days]).n;
  res.json({ ...photoDiskUsage(), keep_days: days, pending_cleanup: pending });
});

r.get('/warranty/:id', (req, res) => {
  const t = get(`
    SELECT t.*,
           COALESCE(c.name, t.customer_name) AS customer_display,
           COALESCE(c.phone, t.customer_phone) AS phone_display,
           c.address AS customer_address,
           s.name AS supplier_name, s.phone AS supplier_phone,
           u.full_name AS received_by_name,
           sa.code AS sale_code, sa.ts AS sale_ts,
           p.sku AS product_sku, p.base_unit,
           ep.name AS exchange_product_name, ep.sku AS exchange_product_sku
    FROM warranty_tickets t
    LEFT JOIN customers c ON c.id = t.customer_id
    LEFT JOIN suppliers s ON s.id = t.supplier_id
    LEFT JOIN users u ON u.id = t.received_by
    LEFT JOIN sales sa ON sa.id = t.sale_id
    LEFT JOIN products p ON p.id = t.product_id
    LEFT JOIN products ep ON ep.id = t.exchange_product_id
    WHERE t.id = ?`, [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy phiếu bảo hành' });

  t.photos = all('SELECT * FROM warranty_photos WHERE ticket_id = ? ORDER BY id', [t.id]);
  t.logs = all(`
    SELECT l.*, u.full_name AS user_name
    FROM warranty_logs l LEFT JOIN users u ON u.id = l.user_id
    WHERE l.ticket_id = ? ORDER BY l.id`, [t.id]);
  t.parts = all(`
    SELECT wp.*, p.name AS product_name, p.sku, p.base_unit
    FROM warranty_parts wp JOIN products p ON p.id = wp.product_id
    WHERE wp.ticket_id = ?`, [t.id]);
  res.json(t);
});

/* ==================================================================== */
/* Tra cứu hạn bảo hành hàng đã bán                                      */
/* ==================================================================== */

/**
 * Tra theo số điện thoại khách, mã hoá đơn, hoặc serial.
 * Trả về các dòng hàng đã bán kèm hạn bảo hành và còn hạn hay không.
 */
r.get('/warranty-lookup', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Nhập số điện thoại, mã hoá đơn hoặc số serial để tra.' });

  const like = `%${q}%`;
  const rows = all(`
    SELECT si.id AS item_id, si.sale_id, si.product_id, si.name_snapshot AS product_name,
           si.unit_name, si.qty, si.price, si.serial,
           si.warranty_months, si.warranty_until,
           s.code AS sale_code, s.ts AS sale_ts,
           COALESCE(c.name, 'Khách lẻ') AS customer_name, c.phone AS customer_phone,
           c.id AS customer_id, p.sku,
           CASE
             WHEN si.warranty_until IS NULL THEN NULL
             WHEN date(si.warranty_until) >= date('now','localtime') THEN 1
             ELSE 0
           END AS in_warranty,
           CAST(julianday(si.warranty_until) - julianday('now','localtime') AS INTEGER) AS days_left
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN products p ON p.id = si.product_id
    WHERE s.status = 'done'
      AND (c.phone LIKE ? OR s.code LIKE ? OR si.serial LIKE ?
           OR c.name LIKE ? OR si.name_snapshot LIKE ?)
    ORDER BY s.id DESC LIMIT 200`, [like, like, like, like, like]);

  res.json(rows);
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
      const info = run(`
        INSERT INTO warranty_tickets
          (code, ts, customer_id, customer_name, customer_phone, sale_id, product_id,
           product_name, serial, qty, issue, condition_note, accessories,
           in_warranty, warranty_until, status, promised_at, received_by, note)
        VALUES(?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?, ?)`,
        [code, b.ts || null, b.customer_id || null,
          b.customer_name?.trim() || null, b.customer_phone?.trim() || null,
          b.sale_id || null, b.product_id || null, b.product_name.trim(),
          b.serial?.trim() || null, Number(b.qty) || 1,
          b.issue?.trim() || null, b.condition_note?.trim() || null,
          b.accessories?.trim() || null,
          b.in_warranty ? 1 : 0, b.warranty_until || null,
          b.promised_at || null, b.received_by || null, b.note?.trim() || null]);
      const id = Number(info.lastInsertRowid);

      run('INSERT INTO warranty_logs(ticket_id, status, user_id, note) VALUES(?, ?, ?, ?)',
        [id, 'received', b.received_by || null, 'Tiếp nhận từ khách']);

      // Ảnh chụp lúc nhận — bằng chứng tình trạng máy
      for (const ph of (Array.isArray(b.photos) ? b.photos : []).slice(0, 12)) {
        const file = savePhoto(ph.data ?? ph, id);
        if (file) {
          run('INSERT INTO warranty_photos(ticket_id, kind, file, caption) VALUES(?, ?, ?, ?)',
            [id, 'received', file, ph.caption || null]);
        }
      }
      return { id, code };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

r.put('/warranty/:id', (req, res) => {
  const b = req.body;
  const t = get('SELECT id FROM warranty_tickets WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy phiếu bảo hành' });

  run(`UPDATE warranty_tickets SET
         customer_id = ?, customer_name = ?, customer_phone = ?,
         product_name = ?, serial = ?, qty = ?, issue = ?, condition_note = ?,
         accessories = ?, in_warranty = ?, warranty_until = ?, promised_at = ?, note = ?
       WHERE id = ?`,
    [b.customer_id || null, b.customer_name?.trim() || null, b.customer_phone?.trim() || null,
      b.product_name, b.serial?.trim() || null, Number(b.qty) || 1,
      b.issue?.trim() || null, b.condition_note?.trim() || null, b.accessories?.trim() || null,
      b.in_warranty ? 1 : 0, b.warranty_until || null, b.promised_at || null,
      b.note?.trim() || null, req.params.id]);
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
/* Linh kiện thay khi tiệm tự sửa — trừ kho thật                         */
/* ==================================================================== */

r.post('/warranty/:id/parts', (req, res) => {
  const t = get('SELECT * FROM warranty_tickets WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy phiếu bảo hành' });
  const items = Array.isArray(req.body?.items) ? req.body.items.filter((i) => Number(i.qty) > 0) : [];
  if (!items.length) return res.status(400).json({ error: 'Chưa chọn linh kiện nào.' });

  const warehouseId = Number(req.body.warehouse_id) ||
    get('SELECT id FROM warehouses WHERE is_default = 1')?.id;

  // Kiểm tra đủ hàng trước khi trừ
  for (const it of items) {
    const p = get('SELECT name, track_stock FROM products WHERE id = ?', [it.product_id]);
    if (!p?.track_stock) continue;
    const st = get('SELECT qty FROM stock WHERE product_id = ? AND warehouse_id = ?',
      [it.product_id, warehouseId])?.qty ?? 0;
    if (st < Number(it.qty)) {
      return res.status(400).json({ error: `"${p.name}" chỉ còn ${st} trong kho, không đủ ${it.qty}.` });
    }
  }

  try {
    tx(() => {
      for (const it of items) {
        const cost = costOf(it.product_id);
        const qty = Number(it.qty);
        run('INSERT INTO warranty_parts(ticket_id, product_id, qty, unit_cost, amount) VALUES(?, ?, ?, ?, ?)',
          [t.id, it.product_id, qty, cost, Math.round(qty * cost)]);
        moveStock({
          productId: it.product_id, warehouseId, qtyChange: -qty, unitCost: cost,
          refType: 'warranty', refId: t.id, refCode: t.code,
          note: `Thay linh kiện bảo hành ${t.code}`,
        });
      }
      const total = get('SELECT COALESCE(SUM(amount), 0) AS s FROM warranty_parts WHERE ticket_id = ?', [t.id]).s;
      run('UPDATE warranty_tickets SET parts_cost = ? WHERE id = ?', [total, t.id]);
      run('INSERT INTO warranty_logs(ticket_id, status, user_id, note) VALUES(?, ?, ?, ?)',
        [t.id, t.status, req.body.user_id || null,
          `Thay ${items.length} loại linh kiện, giá vốn ${total.toLocaleString('vi-VN')} đ`]);
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

r.delete('/warranty/:id/parts/:partId', (req, res) => {
  const part = get('SELECT * FROM warranty_parts WHERE id = ? AND ticket_id = ?',
    [req.params.partId, req.params.id]);
  if (!part) return res.status(404).json({ error: 'Không tìm thấy dòng linh kiện' });
  const t = get('SELECT * FROM warranty_tickets WHERE id = ?', [req.params.id]);
  const warehouseId = get('SELECT id FROM warehouses WHERE is_default = 1')?.id;

  tx(() => {
    moveStock({
      productId: part.product_id, warehouseId, qtyChange: part.qty, unitCost: part.unit_cost,
      refType: 'warranty', refId: t.id, refCode: t.code, note: `Bỏ linh kiện khỏi phiếu ${t.code}`,
    });
    run('DELETE FROM warranty_parts WHERE id = ?', [part.id]);
    const total = get('SELECT COALESCE(SUM(amount), 0) AS s FROM warranty_parts WHERE ticket_id = ?', [t.id]).s;
    run('UPDATE warranty_tickets SET parts_cost = ? WHERE id = ?', [total, t.id]);
  });
  res.json({ ok: true });
});

/* ==================================================================== */
/* Đổi cái mới cho khách — trừ kho hàng mới                              */
/* ==================================================================== */

r.post('/warranty/:id/exchange', (req, res) => {
  const t = get('SELECT * FROM warranty_tickets WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy phiếu bảo hành' });
  if (t.exchange_product_id) return res.status(400).json({ error: 'Phiếu này đã đổi hàng rồi.' });

  const productId = Number(req.body.product_id);
  const qty = Number(req.body.qty) || t.qty || 1;
  const warehouseId = Number(req.body.warehouse_id) ||
    get('SELECT id FROM warehouses WHERE is_default = 1')?.id;

  const p = get('SELECT name, track_stock FROM products WHERE id = ?', [productId]);
  if (!p) return res.status(400).json({ error: 'Chọn mặt hàng để đổi cho khách.' });
  if (p.track_stock) {
    const st = get('SELECT qty FROM stock WHERE product_id = ? AND warehouse_id = ?',
      [productId, warehouseId])?.qty ?? 0;
    if (st < qty) return res.status(400).json({ error: `"${p.name}" chỉ còn ${st} trong kho.` });
  }

  tx(() => {
    moveStock({
      productId, warehouseId, qtyChange: -qty, unitCost: costOf(productId),
      refType: 'warranty', refId: t.id, refCode: t.code,
      note: `Đổi mới cho khách theo phiếu bảo hành ${t.code}`,
    });
    run(`UPDATE warranty_tickets SET exchange_product_id = ?, resolution = 'exchange' WHERE id = ?`,
      [productId, t.id]);
    run('INSERT INTO warranty_logs(ticket_id, status, user_id, note) VALUES(?, ?, ?, ?)',
      [t.id, t.status, req.body.user_id || null, `Đổi mới: ${p.name} (${qty})`]);
  });
  res.json({ ok: true });
});

/* ==================================================================== */
/* Trả khách — chốt tiền công, thu tiền hoặc hoàn tiền                    */
/* ==================================================================== */

r.post('/warranty/:id/deliver', (req, res) => {
  const b = req.body;
  const t = get('SELECT * FROM warranty_tickets WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy phiếu bảo hành' });
  if (t.status === 'delivered') return res.status(400).json({ error: 'Phiếu này đã trả khách rồi.' });

  const laborFee = Math.round(Number(b.labor_fee) || 0);
  const charge = Math.round(Number(b.charge) || 0);
  const paid = Math.min(Math.round(Number(b.paid) || 0), charge);
  const refund = Math.round(Number(b.refund_amount) || 0);
  const accountId = Number(b.account_id) || defaultCashAccount();
  const partner = t.customer_name || get('SELECT name FROM customers WHERE id = ?', [t.customer_id])?.name;

  try {
    tx(() => {
      run(`UPDATE warranty_tickets SET status = 'delivered', resolution = COALESCE(?, resolution),
             labor_fee = ?, charge = ?, paid = ?, refund_amount = ?,
             delivered_at = COALESCE(?, datetime('now','localtime')), note = COALESCE(?, note)
           WHERE id = ?`,
        [b.resolution || null, laborFee, charge, paid, refund,
          b.delivered_at || null, b.note || null, t.id]);

      run('INSERT INTO warranty_logs(ticket_id, status, user_id, note) VALUES(?, ?, ?, ?)',
        [t.id, 'delivered', b.user_id || null, b.note || 'Đã trả hàng cho khách']);

      if (paid > 0 && accountId) {
        addCashTx({
          accountId, direction: 'in', amount: paid, category: 'other_in',
          partnerType: 'customer', partnerId: t.customer_id || null, partnerName: partner,
          refType: 'warranty', refId: t.id, refCode: t.code, userId: b.user_id || null,
          note: `Thu tiền sửa chữa phiếu ${t.code}`,
        });
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
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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
/* Huỷ phiếu — hoàn linh kiện đã thay về kho                             */
/* ==================================================================== */

r.post('/warranty/:id/cancel', (req, res) => {
  const t = get('SELECT * FROM warranty_tickets WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy phiếu bảo hành' });
  if (t.status === 'delivered') {
    return res.status(400).json({ error: 'Phiếu đã trả khách, không huỷ được.' });
  }
  const warehouseId = get('SELECT id FROM warehouses WHERE is_default = 1')?.id;

  tx(() => {
    for (const p of all('SELECT * FROM warranty_parts WHERE ticket_id = ?', [t.id])) {
      moveStock({
        productId: p.product_id, warehouseId, qtyChange: p.qty, unitCost: p.unit_cost,
        refType: 'warranty', refId: t.id, refCode: t.code,
        note: `Huỷ phiếu ${t.code}, hoàn linh kiện`,
      });
    }
    run('DELETE FROM warranty_parts WHERE ticket_id = ?', [t.id]);
    run("UPDATE warranty_tickets SET status = 'cancelled', parts_cost = 0 WHERE id = ?", [t.id]);
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

  res.json({ counts, open, overdue, at_supplier: atSupplier, last30: money30 });
});

/* ==================================================================== */
/* Tự dọn ảnh cũ cho đỡ đầy ổ cứng                                       */
/*                                                                       */
/* Chỉ xoá ảnh của phiếu ĐÃ ĐÓNG (trả khách hoặc huỷ) quá số ngày quy    */
/* định. Ảnh của phiếu đang xử lý giữ nguyên dù để lâu bao nhiêu — ảnh   */
/* là bằng chứng tình trạng máy, xoá lúc còn đang sửa thì mất căn cứ khi */
/* khách thắc mắc.                                                       */
/* ==================================================================== */

const DEFAULT_KEEP_PHOTO_DAYS = 37;

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
    "WHERE t.status IN ('delivered','cancelled') " +
    "  AND date(COALESCE(t.delivered_at, t.ts)) < date('now','localtime', '-' || ? || ' days')",
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
    console.log('  [dọn ảnh] xoá ' + deleted + ' ảnh của phiếu đã đóng quá ' + days +
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
    "SELECT t.id, t.code, t.ts, t.product_name, t.serial, t.promised_at, t.charge, t.paid, " +
    "       COALESCE(c.name, t.customer_name) AS customer_display, " +
    "       COALESCE(c.phone, t.customer_phone) AS phone_display, " +
    "       CAST(julianday('now','localtime') - julianday(t.ts) AS INTEGER) AS days_open " +
    "FROM warranty_tickets t LEFT JOIN customers c ON c.id = t.customer_id " +
    "WHERE t.status = 'ready' ORDER BY t.promised_at, t.ts");

  // Toàn bộ phiếu chưa đóng, kèm số ngày trễ hẹn
  const open = all(
    "SELECT t.id, t.code, t.ts, t.status, t.product_name, t.promised_at, " +
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
    "SELECT t.id, t.code, t.ts, t.delivered_at, t.product_name, t.resolution, " +
    "       t.labor_fee, t.parts_cost, t.charge, t.paid, t.refund_amount, t.in_warranty, " +
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
    refund: done.reduce((a, x) => a + x.refund_amount, 0),
    avg_days: done.length
      ? Math.round(done.reduce((a, x) => a + (x.days_taken || 0), 0) / done.length)
      : 0,
  };

  res.json({ from, to, waiting, open, done, by_product: byProduct, by_resolution: byResolution, totals });
});

export default r;
