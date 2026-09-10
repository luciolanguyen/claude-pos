/* ====================================================================
   PHIẾU TẠM DÙNG CHUNG

   Màn hình bán hàng đã có "hoá đơn tạm" từ lâu. Bảng này làm việc đó cho
   MỌI loại phiếu còn lại: nhập hàng, trả hàng nhập, trả hàng bán, lắp
   ráp, chia nhỏ, kiểm kê, chuyển kho, bảo hành, báo hết hàng.

   Vì sao cần: lập một phiếu nhập ba chục dòng mà giữa chừng khách vào,
   hoặc mối gọi hỏi lại giá, thì phải bỏ dở. Không có chỗ cất, người ta
   sẽ lưu bừa một phiếu sai rồi sửa sau — mà phiếu nhập đã lưu là đã
   cộng kho và đổi giá vốn.

   Phiếu tạm KHÔNG đụng gì tới kho, tới tiền, tới giá vốn. Nó chỉ là tờ
   nháp cất trên máy chủ, nên mở lại được từ bất kỳ máy nào trong tiệm.
   ==================================================================== */
import { Router } from 'express';
import { all, get, run, nextCode, pageParams } from '../db.js';

const r = Router();

/** Các loại phiếu có thể lưu tạm, kèm tên hiển thị. */
export const DRAFT_KINDS = {
  purchase: 'Phiếu nhập hàng',
  purchase_return: 'Trả hàng nhà cung cấp',
  sale_return: 'Khách trả hàng',
  production: 'Lắp ráp thành phẩm',
  disassembly: 'Chia nhỏ thành phẩm',
  stock_take: 'Kiểm kê kho',
  stock_transfer: 'Chuyển kho',
  warranty: 'Phiếu bảo hành',
  requisition: 'Phiếu báo hết hàng',
  order: 'Đơn đặt hàng',
};

const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });

/**
 * Danh sách phiếu tạm.
 *
 * KHÔNG kèm payload: một phiếu nhập trăm dòng nặng cả trăm kilobyte, đổ
 * hết xuống chỉ để vẽ một bảng tóm tắt là phí. Mở phiếu nào thì gọi
 * /doc-drafts/:id lấy riêng phiếu đó.
 */
r.get('/doc-drafts', (req, res) => {
  const { kind = '', q = '', source = '' } = req.query;
  const where = [];
  const params = [];
  if (kind) { where.push('d.kind = ?'); params.push(kind); }
  if (source) { where.push('d.source = ?'); params.push(source); }
  if (q.trim()) {
    where.push('(d.code LIKE ? OR d.title LIKE ? OR d.partner_name LIKE ?)');
    const like = `%${q.trim()}%`;
    params.push(like, like, like);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { page, size, offset } = pageParams(req.query, 20);

  const total = get(`SELECT COUNT(*) AS n FROM doc_drafts d ${w}`, params).n;
  const rows = all(`
    SELECT d.id, d.code, d.kind, d.ts, d.updated_at, d.title, d.partner_name,
           d.total, d.item_count, d.source, u.full_name AS user_name
    FROM doc_drafts d
    LEFT JOIN users u ON u.id = d.user_id
    ${w}
    ORDER BY d.updated_at DESC, d.id DESC LIMIT ${size} OFFSET ${offset}`, params);

  res.json({ rows, total, page, page_size: size, kinds: DRAFT_KINDS });
});

/** Đếm phiếu tạm theo từng loại — để hiện con số trên nút "Mở phiếu tạm". */
r.get('/doc-drafts-count', (req, res) => {
  const rows = all('SELECT kind, COUNT(*) AS n FROM doc_drafts GROUP BY kind');
  const counts = {};
  for (const x of rows) counts[x.kind] = x.n;
  res.json({ counts, total: rows.reduce((a, x) => a + x.n, 0) });
});

r.get('/doc-drafts/:id', (req, res) => {
  const d = get('SELECT * FROM doc_drafts WHERE id = ?', [req.params.id]);
  if (!d) return res.status(404).json({ error: 'Không tìm thấy phiếu tạm' });
  try { d.payload = JSON.parse(d.payload); } catch { d.payload = null; }
  res.json(d);
});

/**
 * Lưu tạm. Gửi kèm id thì ghi đè lên phiếu tạm đang mở, không thì tạo mới.
 * Ghi đè để bấm "Lưu tạm" nhiều lần trên cùng một phiếu không đẻ ra một
 * đống bản nháp gần giống nhau.
 */
r.post('/doc-drafts', (req, res) => {
  try {
    const b = req.body;
    if (!b.kind || !DRAFT_KINDS[b.kind]) {
      throw badRequest(`Loại phiếu tạm không hợp lệ: ${b.kind}`);
    }
    if (!b.payload || typeof b.payload !== 'object') {
      throw badRequest('Phiếu tạm không có nội dung để lưu');
    }
    const payload = JSON.stringify(b.payload);
    const fields = [
      b.title || DRAFT_KINDS[b.kind],
      b.user_id || null,
      b.partner_name || null,
      Math.round(Number(b.total) || 0),
      Number(b.item_count) || 0,
      b.source || null,
      payload,
    ];

    if (b.id) {
      const cur = get('SELECT * FROM doc_drafts WHERE id = ?', [b.id]);
      if (!cur) throw badRequest('Phiếu tạm này không còn nữa, có thể máy khác đã xoá.');
      run(`UPDATE doc_drafts
             SET title = ?, user_id = ?, partner_name = ?, total = ?, item_count = ?,
                 source = ?, payload = ?, updated_at = datetime('now','localtime')
           WHERE id = ?`, [...fields, b.id]);
      return res.json(get('SELECT id, code, kind, title, updated_at FROM doc_drafts WHERE id = ?', [b.id]));
    }

    const code = nextCode('doc_drafts', 'PT');
    const info = run(`
      INSERT INTO doc_drafts(code, kind, title, user_id, partner_name, total, item_count, source, payload)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`, [code, b.kind, ...fields]);
    res.json(get('SELECT id, code, kind, title, updated_at FROM doc_drafts WHERE id = ?',
      [Number(info.lastInsertRowid)]));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

r.delete('/doc-drafts/:id', (req, res) => {
  const d = get('SELECT id FROM doc_drafts WHERE id = ?', [req.params.id]);
  if (!d) return res.status(404).json({ error: 'Không tìm thấy phiếu tạm' });
  run('DELETE FROM doc_drafts WHERE id = ?', [d.id]);
  res.json({ ok: true });
});

/* ==================================================================== */
/* MỘT MẶT HÀNG MUA ĐƯỢC CỦA NHIỀU MỐI                                  */
/* ==================================================================== */

/** Các mối bán một mặt hàng. */
r.get('/products/:id/suppliers', (req, res) => {
  res.json(all(`
    SELECT ps.*, s.name, s.phone, s.active
    FROM product_suppliers ps
    JOIN suppliers s ON s.id = ps.supplier_id
    WHERE ps.product_id = ?
    ORDER BY ps.is_primary DESC, s.name`, [req.params.id]));
});

/**
 * Ghi lại danh sách mối của một mặt hàng.
 *
 * Chỉ một mối được là "ưu tiên chính": phiếu báo hết hàng tự tích sẵn mối
 * đó, hai mối cùng ưu tiên thì tự tích cả hai và tiệm dễ đặt trùng hàng.
 */
r.put('/products/:id/suppliers', (req, res) => {
  const productId = Number(req.params.id);
  const p = get('SELECT id FROM products WHERE id = ?', [productId]);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy mặt hàng' });

  const list = Array.isArray(req.body.suppliers) ? req.body.suppliers : [];
  const seen = new Set();
  let primaryTaken = false;

  run('DELETE FROM product_suppliers WHERE product_id = ?', [productId]);
  for (const x of list) {
    const sid = Number(x.supplier_id);
    if (!sid || seen.has(sid)) continue;
    if (!get('SELECT id FROM suppliers WHERE id = ?', [sid])) continue;
    seen.add(sid);
    const primary = x.is_primary && !primaryTaken ? 1 : 0;
    if (primary) primaryTaken = true;
    run(`INSERT INTO product_suppliers(product_id, supplier_id, is_primary, supplier_sku, last_price, note)
         VALUES(?, ?, ?, ?, ?, ?)`,
      [productId, sid, primary, x.supplier_sku || null,
        Math.round(Number(x.last_price) || 0), x.note || null]);
  }
  res.json(all(`
    SELECT ps.*, s.name, s.phone FROM product_suppliers ps
    JOIN suppliers s ON s.id = ps.supplier_id
    WHERE ps.product_id = ? ORDER BY ps.is_primary DESC, s.name`, [productId]));
});

export default r;
