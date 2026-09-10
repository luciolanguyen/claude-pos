import { Router } from 'express';
import { all, get, run, tx, nextCode, moveStock, costOf , pageParams, categoryFilter } from '../db.js';

const r = Router();

/* ============================ TỒN KHO ============================== */

r.get('/stock', (req, res) => {
  const { q = '', warehouse_id, category_id, filter = 'all' } = req.query;
  const where = ['p.active = 1', 'p.track_stock = 1'];
  const params = [];
  if (q.trim()) {
    where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)');
    const like = `%${q.trim()}%`;
    params.push(like, like, like);
  }
  /* Lấy cả nhóm con cháu (xem chú thích ở catalog.js) */
  if (category_id) {
    const cf = categoryFilter(category_id);
    if (cf) { where.push(cf.sql); params.push(...cf.params); }
  }

  const stockExpr = warehouse_id
    ? 'COALESCE((SELECT qty FROM stock s WHERE s.product_id = p.id AND s.warehouse_id = ?), 0)'
    : 'COALESCE((SELECT SUM(qty) FROM stock s WHERE s.product_id = p.id), 0)';
  const stockParams = warehouse_id ? [warehouse_id] : [];

  let rows = all(`
    SELECT p.id, p.sku, p.name, p.base_unit, p.cost_price, p.min_stock, p.max_stock,
           p.location, p.brand, c.name AS category_name,
           ${stockExpr} AS qty
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE ${where.join(' AND ')}
    ORDER BY p.name`, [...stockParams, ...params]);

  for (const row of rows) {
    row.value = Math.round(row.qty * row.cost_price);
    row.status = row.qty <= 0 ? 'out'
      : (row.min_stock > 0 && row.qty <= row.min_stock) ? 'low'
        : (row.max_stock > 0 && row.qty > row.max_stock) ? 'over' : 'ok';
  }
  if (filter !== 'all') rows = rows.filter((x) => x.status === filter);
  res.json(rows);
});

/** Sổ thẻ kho tổng hợp. */
r.get('/stock-moves', (req, res) => {
  const { product_id, warehouse_id, ref_type, from, to } = req.query;
  const where = [];
  const params = [];
  if (product_id) { where.push('m.product_id = ?'); params.push(product_id); }
  if (warehouse_id) { where.push('m.warehouse_id = ?'); params.push(warehouse_id); }
  if (ref_type) { where.push('m.ref_type = ?'); params.push(ref_type); }
  if (from) { where.push('date(m.ts) >= date(?)'); params.push(from); }
  if (to) { where.push('date(m.ts) <= date(?)'); params.push(to); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { page, size, offset } = pageParams(req.query);
  const total = get(`
    SELECT COUNT(*) AS n
    FROM stock_moves m
    JOIN products p ON p.id = m.product_id
    JOIN warehouses w ON w.id = m.warehouse_id
    ${w}`, params).n;

  const rows = all(`
    SELECT m.*, p.name AS product_name, p.sku, p.base_unit, w.name AS warehouse_name
    FROM stock_moves m
    JOIN products p ON p.id = m.product_id
    JOIN warehouses w ON w.id = m.warehouse_id
    ${w}
    ORDER BY m.id DESC LIMIT ${size} OFFSET ${offset}`, params);
  res.json({ rows, total, page, page_size: size });
});

/** Điều chỉnh tồn nhanh cho 1 sản phẩm. */
r.post('/stock/adjust', (req, res) => {
  const { product_id, warehouse_id, new_qty, note } = req.body;
  const wid = Number(warehouse_id) || get('SELECT id FROM warehouses WHERE is_default = 1')?.id;
  const p = get('SELECT name, track_stock FROM products WHERE id = ?', [product_id]);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
  if (!p.track_stock) return res.status(400).json({ error: 'Sản phẩm này không quản lý tồn kho' });

  const cur = get('SELECT qty FROM stock WHERE product_id = ? AND warehouse_id = ?',
    [product_id, wid])?.qty ?? 0;
  const diff = Number(new_qty) - cur;
  if (diff === 0) return res.json({ ok: true, unchanged: true, qty: cur });

  moveStock({
    productId: product_id, warehouseId: wid, qtyChange: diff,
    unitCost: costOf(product_id), refType: 'adjust',
    note: note || `Điều chỉnh tồn từ ${cur} thành ${new_qty}`,
  });
  res.json({ ok: true, qty: Number(new_qty), diff });
});

/* =========================== KIỂM KÊ KHO =========================== */

r.get('/stock-takes', (req, res) => {
  res.json(all(`
    SELECT st.*, w.name AS warehouse_name, u.full_name AS user_name,
           (SELECT COUNT(*) FROM stock_take_items i WHERE i.take_id = st.id) AS item_count,
           (SELECT COUNT(*) FROM stock_take_items i WHERE i.take_id = st.id AND i.diff_qty <> 0) AS diff_count
    FROM stock_takes st
    LEFT JOIN warehouses w ON w.id = st.warehouse_id
    LEFT JOIN users u ON u.id = st.user_id
    ORDER BY st.id DESC LIMIT 100`));
});

r.get('/stock-takes/:id', (req, res) => {
  const st = get(`
    SELECT st.*, w.name AS warehouse_name, u.full_name AS user_name
    FROM stock_takes st
    LEFT JOIN warehouses w ON w.id = st.warehouse_id
    LEFT JOIN users u ON u.id = st.user_id
    WHERE st.id = ?`, [req.params.id]);
  if (!st) return res.status(404).json({ error: 'Không tìm thấy phiếu kiểm kê' });
  st.items = all(`
    SELECT i.*, p.name AS product_name, p.sku, p.base_unit
    FROM stock_take_items i JOIN products p ON p.id = i.product_id
    WHERE i.take_id = ? ORDER BY p.name`, [st.id]);
  res.json(st);
});

/** Tạo phiếu kiểm kê (nháp). items: [{product_id, actual_qty}] */
r.post('/stock-takes', (req, res) => {
  const b = req.body;
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) return res.status(400).json({ error: 'Phiếu kiểm kê phải có ít nhất 1 sản phẩm' });
  const wid = Number(b.warehouse_id) || get('SELECT id FROM warehouses WHERE is_default = 1')?.id;

  const result = tx(() => {
    const code = nextCode('stock_takes', 'KK');
    const info = run(`
      INSERT INTO stock_takes(code, ts, warehouse_id, user_id, status, note)
      VALUES(?, COALESCE(?, datetime('now','localtime')), ?, ?, 'draft', ?)`,
      [code, b.ts || null, wid, b.user_id || null, b.note || null]);
    const takeId = Number(info.lastInsertRowid);
    let diffValue = 0;

    for (const it of items) {
      const sys = get('SELECT qty FROM stock WHERE product_id = ? AND warehouse_id = ?',
        [it.product_id, wid])?.qty ?? 0;
      const actual = Number(it.actual_qty) || 0;
      const diff = actual - sys;
      const cost = costOf(it.product_id);
      diffValue += Math.round(diff * cost);
      run(`INSERT INTO stock_take_items(take_id, product_id, system_qty, actual_qty, diff_qty, unit_cost, note)
           VALUES(?, ?, ?, ?, ?, ?, ?)`,
        [takeId, it.product_id, sys, actual, diff, cost, it.note || null]);
    }
    run('UPDATE stock_takes SET total_diff_value = ? WHERE id = ?', [diffValue, takeId]);
    return { id: takeId, code };
  });
  res.json(result);
});

/** Cân bằng kho theo phiếu kiểm kê. */
r.post('/stock-takes/:id/balance', (req, res) => {
  const st = get('SELECT * FROM stock_takes WHERE id = ?', [req.params.id]);
  if (!st) return res.status(404).json({ error: 'Không tìm thấy phiếu kiểm kê' });
  if (st.status === 'balanced') return res.status(400).json({ error: 'Phiếu này đã cân bằng kho rồi' });

  tx(() => {
    const items = all('SELECT * FROM stock_take_items WHERE take_id = ?', [st.id]);
    for (const it of items) {
      // Tính lại chênh lệch tại thời điểm cân bằng (tồn có thể đã đổi)
      const sys = get('SELECT qty FROM stock WHERE product_id = ? AND warehouse_id = ?',
        [it.product_id, st.warehouse_id])?.qty ?? 0;
      const diff = it.actual_qty - sys;
      if (diff === 0) continue;
      moveStock({
        productId: it.product_id, warehouseId: st.warehouse_id, qtyChange: diff,
        unitCost: it.unit_cost, refType: 'adjust', refId: st.id, refCode: st.code,
        note: `Cân bằng kiểm kê ${st.code}`,
      });
      run('UPDATE stock_take_items SET system_qty = ?, diff_qty = ? WHERE id = ?',
        [sys, diff, it.id]);
    }
    run("UPDATE stock_takes SET status = 'balanced' WHERE id = ?", [st.id]);
  });
  res.json({ ok: true });
});

r.delete('/stock-takes/:id', (req, res) => {
  const st = get('SELECT status FROM stock_takes WHERE id = ?', [req.params.id]);
  if (st?.status === 'balanced') return res.status(400).json({ error: 'Không thể xoá phiếu đã cân bằng kho' });
  run('DELETE FROM stock_takes WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

/* =========================== CHUYỂN KHO ============================ */

r.get('/stock-transfers', (req, res) => {
  res.json(all(`
    SELECT t.*, wf.name AS from_name, wt.name AS to_name, u.full_name AS user_name,
           (SELECT COUNT(*) FROM stock_transfer_items i WHERE i.transfer_id = t.id) AS item_count
    FROM stock_transfers t
    JOIN warehouses wf ON wf.id = t.from_warehouse_id
    JOIN warehouses wt ON wt.id = t.to_warehouse_id
    LEFT JOIN users u ON u.id = t.user_id
    ORDER BY t.id DESC LIMIT 100`));
});

r.get('/stock-transfers/:id', (req, res) => {
  const t = get(`
    SELECT t.*, wf.name AS from_name, wt.name AS to_name
    FROM stock_transfers t
    JOIN warehouses wf ON wf.id = t.from_warehouse_id
    JOIN warehouses wt ON wt.id = t.to_warehouse_id
    WHERE t.id = ?`, [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy phiếu chuyển kho' });
  t.items = all(`
    SELECT i.*, p.name AS product_name, p.sku, p.base_unit
    FROM stock_transfer_items i JOIN products p ON p.id = i.product_id
    WHERE i.transfer_id = ?`, [t.id]);
  res.json(t);
});

r.post('/stock-transfers', (req, res) => {
  const b = req.body;
  const items = Array.isArray(b.items) ? b.items.filter((i) => Number(i.qty) > 0) : [];
  if (!items.length) return res.status(400).json({ error: 'Phiếu chuyển kho phải có ít nhất 1 sản phẩm' });
  if (Number(b.from_warehouse_id) === Number(b.to_warehouse_id)) {
    return res.status(400).json({ error: 'Kho nguồn và kho đích phải khác nhau' });
  }
  for (const it of items) {
    const st = get('SELECT qty FROM stock WHERE product_id = ? AND warehouse_id = ?',
      [it.product_id, b.from_warehouse_id]);
    const p = get('SELECT name FROM products WHERE id = ?', [it.product_id]);
    if ((st?.qty ?? 0) < Number(it.qty)) {
      return res.status(400).json({ error: `"${p?.name}" chỉ còn ${st?.qty ?? 0} ở kho nguồn.` });
    }
  }

  const result = tx(() => {
    const code = nextCode('stock_transfers', 'CK');
    const info = run(`
      INSERT INTO stock_transfers(code, ts, from_warehouse_id, to_warehouse_id, user_id, note)
      VALUES(?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?)`,
      [code, b.ts || null, b.from_warehouse_id, b.to_warehouse_id, b.user_id || null, b.note || null]);
    const tid = Number(info.lastInsertRowid);
    for (const it of items) {
      run('INSERT INTO stock_transfer_items(transfer_id, product_id, qty) VALUES(?, ?, ?)',
        [tid, it.product_id, Number(it.qty)]);
      const cost = costOf(it.product_id);
      moveStock({
        productId: it.product_id, warehouseId: b.from_warehouse_id, qtyChange: -Number(it.qty),
        unitCost: cost, refType: 'transfer', refId: tid, refCode: code, note: `Chuyển đi (${code})`,
      });
      moveStock({
        productId: it.product_id, warehouseId: b.to_warehouse_id, qtyChange: Number(it.qty),
        unitCost: cost, refType: 'transfer', refId: tid, refCode: code, note: `Chuyển đến (${code})`,
      });
    }
    return { id: tid, code };
  });
  res.json(result);
});

export default r;
