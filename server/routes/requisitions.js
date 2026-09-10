/* ====================================================================
   PHIẾU BÁO HẾT HÀNG

   Nhân viên đi kiểm quầy, ghi lại món nào cạn hoặc sắp cạn. Mỗi dòng ghi
   ba con số: tồn máy đang ghi, tồn đếm được thật, và số dự mua.

   Hai việc quản lý làm trên phiếu này, CỐ Ý TÁCH RỜI NHAU:

     1. Cân bằng kho theo số đếm thật — chỉ cho những dòng được tích chọn.
        Dòng không tích thì giữ nguyên tồn cũ để đếm lại, vì đếm sai một
        lần rồi ghi đè vào sổ là mất dấu luôn số cũ.

     2. Tách phiếu nhập tạm theo từng mối.

   Tách rời vì hai việc này sai theo hai kiểu khác nhau: cân bằng kho sai
   thì tồn kho sai, tách phiếu sai thì chỉ mất công xoá phiếu tạm.
   ==================================================================== */
import { Router } from 'express';
import {
  all, get, run, tx, nextCode, moveStock, costOf, pageParams, getSettings,
} from '../db.js';

const r = Router();

const badRequest = (msg, code) => Object.assign(new Error(msg), { status: 400, code });

/* ------------------------------ Danh sách ---------------------------- */

r.get('/requisitions', (req, res) => {
  const { q = '', status, from, to } = req.query;
  const where = [];
  const params = [];
  if (status) { where.push('rq.status = ?'); params.push(status); }
  if (from) { where.push('date(rq.ts) >= date(?)'); params.push(from); }
  if (to) { where.push('date(rq.ts) <= date(?)'); params.push(to); }
  if (q.trim()) {
    where.push('(rq.code LIKE ? OR rq.note LIKE ? OR u.full_name LIKE ?)');
    const like = `%${q.trim()}%`;
    params.push(like, like, like);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { page, size, offset } = pageParams(req.query, 20);

  const total = get(`
    SELECT COUNT(*) AS n FROM requisitions rq
    LEFT JOIN users u ON u.id = rq.user_id ${w}`, params).n;

  const rows = all(`
    SELECT rq.*, u.full_name AS user_name, w.name AS warehouse_name,
           (SELECT COUNT(*) FROM requisition_items i WHERE i.requisition_id = rq.id) AS line_count,
           (SELECT COUNT(*) FROM requisition_items i
             WHERE i.requisition_id = rq.id AND i.adjusted = 1) AS adjusted_count
    FROM requisitions rq
    LEFT JOIN users u ON u.id = rq.user_id
    LEFT JOIN warehouses w ON w.id = rq.warehouse_id
    ${w}
    ORDER BY rq.id DESC LIMIT ${size} OFFSET ${offset}`, params);

  res.json({ rows, total, page, page_size: size });
});

/** Số phiếu còn đang mở — cho cái chuông trên thanh đầu. */
r.get('/requisitions-summary', (req, res) => {
  res.json(get(`
    SELECT COUNT(*) AS open_count,
           COALESCE(SUM((SELECT COUNT(*) FROM requisition_items i
                          WHERE i.requisition_id = rq.id)), 0) AS open_lines
    FROM requisitions rq WHERE rq.status = 'open'`));
});

/* ------------------------------ Chi tiết ----------------------------- */

function detail(id) {
  const rq = get(`
    SELECT rq.*, u.full_name AS user_name, w.name AS warehouse_name
    FROM requisitions rq
    LEFT JOIN users u ON u.id = rq.user_id
    LEFT JOIN warehouses w ON w.id = rq.warehouse_id
    WHERE rq.id = ?`, [id]);
  if (!rq) return null;

  rq.items = all(`
    SELECT i.*, p.sku, p.base_unit, p.barcode, p.cost_price,
           c.name AS category_name,
           COALESCE((SELECT SUM(s.qty) FROM stock s
                      WHERE s.product_id = i.product_id AND s.warehouse_id = ?), 0) AS stock_now
    FROM requisition_items i
    LEFT JOIN products p ON p.id = i.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE i.requisition_id = ? ORDER BY i.id`, [rq.warehouse_id, id]);

  /* Mối nào bán món này, và mối nào đang được chọn trên phiếu */
  for (const it of rq.items) {
    it.suppliers = all(`
      SELECT ps.supplier_id, s.name, ps.is_primary, ps.last_price, ps.supplier_sku
      FROM product_suppliers ps
      JOIN suppliers s ON s.id = ps.supplier_id
      WHERE ps.product_id = ? AND s.active = 1
      ORDER BY ps.is_primary DESC, s.name`, [it.product_id]);
    it.chosen = all('SELECT supplier_id FROM requisition_item_suppliers WHERE item_id = ?',
      [it.id]).map((x) => x.supplier_id);
  }

  /* Phiếu nhập tạm đã sinh ra từ phiếu này */
  rq.drafts = all(`
    SELECT id, code, kind, title, partner_name, item_count, total, updated_at
    FROM doc_drafts WHERE source = ? ORDER BY id`, [`req:${id}`]);
  return rq;
}

r.get('/requisitions/:id', (req, res) => {
  const rq = detail(Number(req.params.id));
  if (!rq) return res.status(404).json({ error: 'Không tìm thấy phiếu báo hết hàng' });
  res.json(rq);
});

/* ------------------------------ Lập phiếu ---------------------------- */

r.post('/requisitions', (req, res) => {
  try {
    const b = req.body;
    const items = Array.isArray(b.items) ? b.items.filter((i) => i.product_id) : [];
    if (!items.length) throw badRequest('Phiếu báo hết hàng phải có ít nhất 1 mặt hàng');
    const warehouseId = Number(b.warehouse_id)
      || get('SELECT id FROM warehouses WHERE is_default = 1')?.id;
    if (!warehouseId) throw badRequest('Chưa thiết lập kho hàng');

    const out = tx(() => {
      const code = nextCode('requisitions', 'BH');
      const info = run(`
        INSERT INTO requisitions(code, ts, warehouse_id, user_id, status, note)
        VALUES(?, COALESCE(?, datetime('now','localtime')), ?, ?, 'open', ?)`,
        [code, b.ts || null, warehouseId, b.user_id || null, b.note || null]);
      const id = Number(info.lastInsertRowid);

      for (const it of items) {
        const p = get('SELECT name, base_unit FROM products WHERE id = ?', [it.product_id]);
        if (!p) throw badRequest(`Không tìm thấy mặt hàng #${it.product_id}`);
        /* Tồn máy chốt lại ngay lúc lập phiếu. Không đọc lại lúc duyệt: giữa
           lúc lập và lúc duyệt tiệm vẫn bán hàng, đọc lại thì con số nhân
           viên nhìn thấy lúc đếm không còn khớp với con số quản lý thấy. */
        const sys = get(`SELECT COALESCE(SUM(qty), 0) AS q FROM stock
                         WHERE product_id = ? AND warehouse_id = ?`,
          [it.product_id, warehouseId]).q;
        const actual = it.actual_qty === undefined || it.actual_qty === null || it.actual_qty === ''
          ? null : Number(it.actual_qty);
        const line = run(`
          INSERT INTO requisition_items(requisition_id, product_id, name_snapshot, unit_name,
                                        system_qty, actual_qty, buy_qty, note)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, it.product_id, it.name_snapshot || p.name, it.unit_name || p.base_unit,
            sys, Number.isNaN(actual) ? null : actual,
            Number(it.buy_qty) || 0, it.note || null]);
        const itemId = Number(line.lastInsertRowid);

        /* Mối được chọn sẵn: lấy theo phiếu gửi lên, không có thì lấy mối
           ưu tiên chính của mặt hàng đó. */
        let chosen = Array.isArray(it.supplier_ids) ? it.supplier_ids.map(Number).filter(Boolean) : [];
        if (!chosen.length) {
          chosen = all('SELECT supplier_id FROM product_suppliers WHERE product_id = ? AND is_primary = 1',
            [it.product_id]).map((x) => x.supplier_id);
        }
        for (const sid of [...new Set(chosen)]) {
          run('INSERT OR IGNORE INTO requisition_item_suppliers(item_id, supplier_id) VALUES(?, ?)',
            [itemId, sid]);
        }
      }
      return detail(id);
    });
    res.json(out);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

/** Sửa một dòng: số đếm thật, số dự mua, mối được chọn. */
r.put('/requisitions/:id/items/:itemId', (req, res) => {
  try {
    const b = req.body;
    const it = get(`SELECT i.* FROM requisition_items i WHERE i.id = ? AND i.requisition_id = ?`,
      [req.params.itemId, req.params.id]);
    if (!it) throw badRequest('Không tìm thấy dòng hàng trên phiếu');

    const out = tx(() => {
      const num = (v, old) => {
        if (v === undefined) return old;
        if (v === null || v === '') return null;
        const x = Number(v);
        return Number.isNaN(x) ? old : x;
      };
      run(`UPDATE requisition_items SET actual_qty = ?, buy_qty = ?, note = ? WHERE id = ?`,
        [num(b.actual_qty, it.actual_qty),
          Math.max(0, num(b.buy_qty, it.buy_qty) ?? 0),
          b.note === undefined ? it.note : (b.note || null),
          it.id]);

      if (Array.isArray(b.supplier_ids)) {
        run('DELETE FROM requisition_item_suppliers WHERE item_id = ?', [it.id]);
        for (const sid of [...new Set(b.supplier_ids.map(Number).filter(Boolean))]) {
          run('INSERT OR IGNORE INTO requisition_item_suppliers(item_id, supplier_id) VALUES(?, ?)',
            [it.id, sid]);
        }
      }
      return detail(Number(req.params.id));
    });
    res.json(out);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

r.delete('/requisitions/:id/items/:itemId', (req, res) => {
  const it = get('SELECT * FROM requisition_items WHERE id = ? AND requisition_id = ?',
    [req.params.itemId, req.params.id]);
  if (!it) return res.status(404).json({ error: 'Không tìm thấy dòng hàng' });
  if (it.adjusted) {
    return res.status(400).json({
      error: 'Dòng này đã cân bằng kho rồi, xoá đi thì mất dấu lần chỉnh tồn. Hãy giữ lại để đối chiếu.' });
  }
  run('DELETE FROM requisition_items WHERE id = ?', [it.id]);
  res.json(detail(Number(req.params.id)));
});

/* ------------------- Cân bằng kho theo số đếm thật ------------------- */

/**
 * Ghi tồn kho thật cho những dòng được tích chọn.
 *
 * Đây là thao tác SỬA TỒN KHO thật, nên:
 *   - chỉ làm cho đúng dòng được gửi lên, không làm cả phiếu;
 *   - dòng chưa đếm (actual_qty rỗng) thì bỏ qua, không coi là 0 — chưa
 *     đếm khác hẳn với đếm được 0, gộp lại là xoá sạch tồn của món đó;
 *   - đi qua moveStock để có thẻ kho, truy lại được ai sửa và sửa lúc nào.
 */
r.post('/requisitions/:id/adjust', (req, res) => {
  try {
    const id = Number(req.params.id);
    const rq = get('SELECT * FROM requisitions WHERE id = ?', [id]);
    if (!rq) throw badRequest('Không tìm thấy phiếu báo hết hàng');

    const wanted = Array.isArray(req.body.item_ids)
      ? req.body.item_ids.map(Number).filter(Boolean) : [];
    if (!wanted.length) throw badRequest('Chưa chọn dòng nào để cập nhật kho');

    const out = tx(() => {
      const done = [];
      const skipped = [];
      for (const itemId of wanted) {
        const it = get('SELECT * FROM requisition_items WHERE id = ? AND requisition_id = ?',
          [itemId, id]);
        if (!it) continue;
        if (it.actual_qty === null || it.actual_qty === undefined) {
          skipped.push({ id: it.id, name: it.name_snapshot, why: 'chưa nhập tồn thực tế' });
          continue;
        }
        const cur = get(`SELECT COALESCE(SUM(qty), 0) AS q FROM stock
                         WHERE product_id = ? AND warehouse_id = ?`,
          [it.product_id, rq.warehouse_id]).q;
        const diff = Number(it.actual_qty) - cur;
        if (diff === 0) {
          run('UPDATE requisition_items SET adjusted = 1 WHERE id = ?', [it.id]);
          done.push({ id: it.id, name: it.name_snapshot, diff: 0 });
          continue;
        }
        const move = moveStock({
          productId: it.product_id,
          warehouseId: rq.warehouse_id,
          qtyChange: diff,
          unitCost: costOf(it.product_id),
          refType: 'requisition',
          refId: id,
          refCode: rq.code,
          note: `Cân bằng theo phiếu báo hết hàng ${rq.code}: máy ${cur} → đếm thật ${it.actual_qty}`,
        });
        run('UPDATE requisition_items SET adjusted = 1, adjust_move_id = ? WHERE id = ?',
          [move?.moveId || null, it.id]);
        done.push({ id: it.id, name: it.name_snapshot, from: cur, to: Number(it.actual_qty), diff });
      }
      run("UPDATE requisitions SET adjusted_at = datetime('now','localtime') WHERE id = ?", [id]);
      return { ok: true, adjusted: done, skipped, requisition: detail(id) };
    });
    res.json(out);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

/* ------------- Tách phiếu nhập tạm theo từng nhà cung cấp ------------ */

/**
 * Gom hàng theo mối rồi sinh ra mỗi mối một phiếu nhập tạm.
 *
 * LƯU Ý VỀ SỐ LƯỢNG: một mặt hàng chọn hai mối thì nó xuất hiện ở CẢ HAI
 * phiếu, mỗi phiếu đủ số lượng dự mua — đúng như tài liệu mô tả. Ý là để
 * hỏi giá hai nơi rồi chọn một, KHÔNG phải đặt cả hai. Nếu duyệt cả hai
 * phiếu thì tiệm mua gấp đôi, nên chỗ nào sinh ra tình huống đó phải nói
 * rõ ra cho người dùng thấy — xem trường `duplicated` trả về dưới đây và
 * lời cảnh báo trên giao diện.
 */
r.post('/requisitions/:id/split', (req, res) => {
  try {
    const id = Number(req.params.id);
    const rq = detail(id);
    if (!rq) throw badRequest('Không tìm thấy phiếu báo hết hàng');

    /* Chỉ tách những dòng được chọn; không gửi gì thì lấy hết dòng có số mua */
    const only = Array.isArray(req.body.item_ids) && req.body.item_ids.length
      ? new Set(req.body.item_ids.map(Number)) : null;

    const bySupplier = new Map();
    const noSupplier = [];
    const duplicated = [];

    for (const it of rq.items) {
      if (only && !only.has(it.id)) continue;
      if (!(Number(it.buy_qty) > 0)) continue;
      if (!it.chosen.length) { noSupplier.push(it.name_snapshot); continue; }
      if (it.chosen.length > 1) {
        duplicated.push({ name: it.name_snapshot, qty: it.buy_qty, suppliers: it.chosen.length });
      }
      for (const sid of it.chosen) {
        if (!bySupplier.has(sid)) bySupplier.set(sid, []);
        bySupplier.get(sid).push(it);
      }
    }

    if (!bySupplier.size) {
      throw badRequest(noSupplier.length
        ? `Chưa chọn nhà cung cấp cho: ${noSupplier.slice(0, 3).join(', ')}`
          + (noSupplier.length > 3 ? `... và ${noSupplier.length - 3} món nữa` : '')
        : 'Không có dòng nào có số lượng dự mua để tách phiếu.');
    }

    const out = tx(() => {
      const drafts = [];
      for (const [supplierId, items] of bySupplier) {
        const sup = get('SELECT * FROM suppliers WHERE id = ?', [supplierId]);
        if (!sup) continue;

        const lines = items.map((it) => {
          const link = get(`SELECT last_price FROM product_suppliers
                            WHERE product_id = ? AND supplier_id = ?`, [it.product_id, supplierId]);
          /* Giá gợi ý: giá mối này báo lần trước, không có thì lấy giá vốn.
             Chỉ là gợi ý — người lập phiếu nhập vẫn sửa lại được. */
          const price = Number(link?.last_price) || Number(it.cost_price) || 0;
          /* Kèm luôn danh sách đơn vị: biểu mẫu phiếu nhập cần nó để vẽ
             ô chọn cái / hộp / thùng. Thiếu là biểu mẫu nổ khi mở lại. */
          const units = all(`SELECT * FROM product_units WHERE product_id = ?
                             ORDER BY factor`, [it.product_id]);
          const baseUnit = units.find((u) => u.factor === 1) || units[0] || null;
          return {
            key: `req-${it.id}-${supplierId}`,
            product_id: it.product_id,
            name: it.name_snapshot,
            sku: it.sku,
            base_unit: it.base_unit,
            units,
            unit_id: baseUnit?.id ?? null,
            unit_name: baseUnit?.unit_name || it.unit_name,
            factor: baseUnit?.factor || 1,
            current_stock: it.stock_now,
            discount: 0,
            qty: Number(it.buy_qty),
            price,
            list_price: price,
            discount_percent: 0,
            vat_rate: 0,
            note: `Theo phiếu báo hết hàng ${rq.code}`,
          };
        });

        const total = lines.reduce((a, l) => a + Math.round(l.qty * l.price), 0);
        const code = nextCode('doc_drafts', 'PT');
        const info = run(`
          INSERT INTO doc_drafts(code, kind, title, user_id, partner_name,
                                 total, item_count, source, payload)
          VALUES(?, 'purchase', ?, ?, ?, ?, ?, ?, ?)`,
          [code, `Nhập của ${sup.name} — theo ${rq.code}`,
            req.body.user_id || null, sup.name, total, lines.length, `req:${id}`,
            JSON.stringify({
              supplier_id: supplierId,
              warehouse_id: rq.warehouse_id,
              lines,
              note: `Sinh tự động từ phiếu báo hết hàng ${rq.code}`,
              from_requisition: { id, code: rq.code },
            })]);
        drafts.push({
          id: Number(info.lastInsertRowid), code, supplier_id: supplierId,
          supplier_name: sup.name, item_count: lines.length, total,
        });
      }
      run("UPDATE requisitions SET split_at = datetime('now','localtime') WHERE id = ?", [id]);
      return { ok: true, drafts, no_supplier: noSupplier, duplicated, requisition: detail(id) };
    });
    res.json(out);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

/* ------------------------------ Đóng phiếu --------------------------- */

r.post('/requisitions/:id/close', (req, res) => {
  const rq = get('SELECT * FROM requisitions WHERE id = ?', [req.params.id]);
  if (!rq) return res.status(404).json({ error: 'Không tìm thấy phiếu' });
  const status = req.body.status === 'cancelled' ? 'cancelled' : 'done';
  run(`UPDATE requisitions SET status = ?, closed_at = datetime('now','localtime') WHERE id = ?`,
    [status, rq.id]);
  res.json(detail(rq.id));
});

r.post('/requisitions/:id/reopen', (req, res) => {
  const rq = get('SELECT * FROM requisitions WHERE id = ?', [req.params.id]);
  if (!rq) return res.status(404).json({ error: 'Không tìm thấy phiếu' });
  run("UPDATE requisitions SET status = 'open', closed_at = NULL WHERE id = ?", [rq.id]);
  res.json(detail(rq.id));
});

r.delete('/requisitions/:id', (req, res) => {
  const rq = get('SELECT * FROM requisitions WHERE id = ?', [req.params.id]);
  if (!rq) return res.status(404).json({ error: 'Không tìm thấy phiếu' });
  const adjusted = get(`SELECT COUNT(*) AS n FROM requisition_items
                        WHERE requisition_id = ? AND adjusted = 1`, [rq.id]).n;
  if (adjusted > 0) {
    return res.status(400).json({
      error: `Phiếu này đã cân bằng kho cho ${adjusted} mặt hàng. `
        + 'Xoá đi là mất dấu lần chỉnh tồn đó — hãy huỷ phiếu thay vì xoá.' });
  }
  run('DELETE FROM requisitions WHERE id = ?', [rq.id]);
  res.json({ ok: true });
});

/* ----------- Gợi ý hàng cần báo: sắp hết hoặc đã hết ----------------- */

/**
 * Danh sách gợi ý để nhân viên khỏi phải tự nhớ món nào sắp cạn.
 * Lấy hàng dưới định mức tồn tối thiểu, xếp món hết trước.
 */
r.get('/requisition-suggestions', (req, res) => {
  const warehouseId = Number(req.query.warehouse_id)
    || get('SELECT id FROM warehouses WHERE is_default = 1')?.id;
  const rows = all(`
    SELECT p.id AS product_id, p.name AS name_snapshot, p.sku, p.base_unit,
           p.min_stock, p.max_stock, p.cost_price, c.name AS category_name,
           COALESCE((SELECT SUM(s.qty) FROM stock s
                      WHERE s.product_id = p.id AND s.warehouse_id = ?), 0) AS system_qty
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1 AND p.track_stock = 1
    ORDER BY p.name`, [warehouseId]);

  const low = rows.filter((p) => p.system_qty <= 0 || (p.min_stock > 0 && p.system_qty <= p.min_stock));
  for (const p of low) {
    /* Số gợi ý mua: kéo lên tồn tối đa nếu có khai, không thì gấp đôi định
       mức tối thiểu — đủ để bán tiếp mà không ôm hàng. */
    const target = p.max_stock > 0 ? p.max_stock : (p.min_stock > 0 ? p.min_stock * 2 : 0);
    p.buy_qty = Math.max(0, Math.round(target - p.system_qty));
    p.suppliers = all(`
      SELECT ps.supplier_id, s.name, ps.is_primary, ps.last_price
      FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id
      WHERE ps.product_id = ? AND s.active = 1
      ORDER BY ps.is_primary DESC, s.name`, [p.product_id]);
  }
  res.json({ rows: low, warehouse_id: warehouseId });
});

export default r;
