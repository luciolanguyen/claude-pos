import { Router } from 'express';
import { all, get, run, tx, nextCode, moveStock, costOf } from '../db.js';

const r = Router();

/* ==================================================================== */
/* Định mức nguyên vật liệu (BOM)                                        */
/* 1 tủ điện 8 đường = 1 vỏ tủ + 8 aptomat + 3m dây + 1 domino           */
/* ==================================================================== */

/** Định mức của một thành phẩm, kèm giá vốn và tồn kho từng linh kiện. */
r.get('/products/:id/bom', (req, res) => {
  const rows = all(`
    SELECT b.*, p.name AS component_name, p.sku, p.base_unit, p.cost_price,
           COALESCE((SELECT SUM(qty) FROM stock s WHERE s.product_id = b.component_id), 0) AS stock
    FROM product_boms b
    JOIN products p ON p.id = b.component_id
    WHERE b.product_id = ?
    ORDER BY p.name`, [req.params.id]);
  const materialCost = rows.reduce((a, x) => a + Math.round(x.qty * x.cost_price), 0);
  res.json({ rows, material_cost: materialCost });
});

/** Lưu lại toàn bộ định mức (ghi đè danh sách cũ). */
r.put('/products/:id/bom', (req, res) => {
  const productId = Number(req.params.id);
  const items = Array.isArray(req.body?.items) ? req.body.items.filter((i) => Number(i.qty) > 0) : [];

  if (items.some((i) => Number(i.component_id) === productId)) {
    return res.status(400).json({ error: 'Thành phẩm không thể là linh kiện của chính nó.' });
  }
  // Chặn vòng lặp: A cần B mà B lại cần A
  for (const it of items) {
    const back = get('SELECT 1 AS x FROM product_boms WHERE product_id = ? AND component_id = ?',
      [it.component_id, productId]);
    if (back) {
      const p = get('SELECT name FROM products WHERE id = ?', [it.component_id]);
      return res.status(400).json({
        error: `"${p?.name}" đã khai cần chính mặt hàng này làm linh kiện. Không thể lồng vòng.`,
      });
    }
  }

  tx(() => {
    run('DELETE FROM product_boms WHERE product_id = ?', [productId]);
    for (const it of items) {
      run('INSERT INTO product_boms(product_id, component_id, qty, note) VALUES(?, ?, ?, ?)',
        [productId, it.component_id, Number(it.qty), it.note || null]);
    }
    run('UPDATE products SET is_manufactured = ? WHERE id = ?', [items.length ? 1 : 0, productId]);
  });
  res.json({ ok: true, count: items.length });
});

/* ==================================================================== */
/* Phiếu sản xuất                                                        */
/* ==================================================================== */

r.get('/productions', (req, res) => {
  const { kind, from, to, limit = 200 } = req.query;
  const where = [];
  const params = [];
  if (kind) { where.push('pr.kind = ?'); params.push(kind); }
  if (from) { where.push('date(pr.ts) >= date(?)'); params.push(from); }
  if (to) { where.push('date(pr.ts) <= date(?)'); params.push(to); }
  res.json(all(`
    SELECT pr.*, p.name AS product_name, p.sku, p.base_unit,
           w.name AS warehouse_name, u.full_name AS user_name,
           (SELECT COUNT(*) FROM production_items i WHERE i.production_id = pr.id) AS item_count
    FROM productions pr
    JOIN products p ON p.id = pr.product_id
    JOIN warehouses w ON w.id = pr.warehouse_id
    LEFT JOIN users u ON u.id = pr.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY pr.id DESC LIMIT ${Number(limit)}`, params));
});

r.get('/productions/:id', (req, res) => {
  const pr = get(`
    SELECT pr.*, p.name AS product_name, p.sku, p.base_unit,
           w.name AS warehouse_name, u.full_name AS user_name
    FROM productions pr
    JOIN products p ON p.id = pr.product_id
    JOIN warehouses w ON w.id = pr.warehouse_id
    LEFT JOIN users u ON u.id = pr.user_id
    WHERE pr.id = ?`, [req.params.id]);
  if (!pr) return res.status(404).json({ error: 'Không tìm thấy phiếu sản xuất' });
  pr.items = all(`
    SELECT i.*, p.name AS component_name, p.sku, p.base_unit
    FROM production_items i JOIN products p ON p.id = i.component_id
    WHERE i.production_id = ?`, [pr.id]);
  res.json(pr);
});

/**
 * Lập phiếu lắp ráp: trừ kho linh kiện, cộng kho thành phẩm.
 * body: { product_id, qty, warehouse_id, labor_cost, note, items?[{component_id, qty}] }
 * Bỏ trống items thì tự lấy theo định mức đã khai.
 */
r.post('/productions/assemble', (req, res) => {
  const b = req.body;
  const qty = Number(b.qty) || 0;
  if (qty <= 0) return res.status(400).json({ error: 'Số lượng thành phẩm phải lớn hơn 0.' });

  const product = get('SELECT * FROM products WHERE id = ?', [b.product_id]);
  if (!product) return res.status(404).json({ error: 'Không tìm thấy thành phẩm.' });

  const warehouseId = Number(b.warehouse_id) || get('SELECT id FROM warehouses WHERE is_default = 1')?.id;
  if (!warehouseId) return res.status(400).json({ error: 'Chưa thiết lập kho.' });

  // Lấy định mức: ưu tiên danh sách gửi lên (cho phép sửa tại chỗ), không có thì dùng BOM
  let lines = Array.isArray(b.items) && b.items.length
    ? b.items.map((i) => ({ component_id: Number(i.component_id), qty: Number(i.qty) }))
    : all('SELECT component_id, qty FROM product_boms WHERE product_id = ?', [product.id])
        .map((i) => ({ component_id: i.component_id, qty: i.qty * qty }));

  lines = lines.filter((l) => l.qty > 0);
  if (!lines.length) {
    return res.status(400).json({
      error: `"${product.name}" chưa khai định mức nguyên vật liệu. Vào Hàng hoá → sửa mặt hàng → tab Định mức để khai trước.`,
    });
  }

  // Kiểm tra đủ linh kiện trước khi trừ kho
  for (const l of lines) {
    const c = get('SELECT name, track_stock FROM products WHERE id = ?', [l.component_id]);
    if (!c) return res.status(400).json({ error: 'Linh kiện không tồn tại.' });
    if (!c.track_stock) continue;
    const st = get('SELECT qty FROM stock WHERE product_id = ? AND warehouse_id = ?',
      [l.component_id, warehouseId])?.qty ?? 0;
    if (st < l.qty) {
      return res.status(400).json({
        error: `Không đủ "${c.name}": cần ${l.qty}, kho chỉ còn ${st}.`,
        code: 'INSUFFICIENT_COMPONENT',
      });
    }
  }

  try {
    const result = tx(() => {
      const code = nextCode('productions', 'SX');
      let materialCost = 0;
      for (const l of lines) {
        l.unit_cost = costOf(l.component_id);
        l.amount = Math.round(l.qty * l.unit_cost);
        materialCost += l.amount;
      }
      const laborCost = Math.round(Number(b.labor_cost) || 0);
      const totalCost = materialCost + laborCost;
      const unitCost = Math.round(totalCost / qty);

      const info = run(`
        INSERT INTO productions(code, ts, kind, warehouse_id, user_id, product_id, qty,
                                material_cost, labor_cost, total_cost, unit_cost, note)
        VALUES(?, COALESCE(?, datetime('now','localtime')), 'assemble', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [code, b.ts || null, warehouseId, b.user_id || null, product.id, qty,
          materialCost, laborCost, totalCost, unitCost, b.note || null]);
      const prodId = Number(info.lastInsertRowid);

      // Trừ kho từng linh kiện
      for (const l of lines) {
        run(`INSERT INTO production_items(production_id, component_id, qty, unit_cost, amount)
             VALUES(?, ?, ?, ?, ?)`, [prodId, l.component_id, l.qty, l.unit_cost, l.amount]);
        moveStock({
          productId: l.component_id, warehouseId, qtyChange: -l.qty, unitCost: l.unit_cost,
          refType: 'production', refId: prodId, refCode: code,
          note: `Dùng làm ${product.name}`, ts: b.ts || null,
        });
      }

      // Cộng kho thành phẩm + cập nhật giá vốn bình quân
      moveStock({
        productId: product.id, warehouseId, qtyChange: qty, unitCost,
        refType: 'production', refId: prodId, refCode: code,
        note: `Sản xuất ${qty} ${product.base_unit}`, ts: b.ts || null,
      });
      updateCostAfterProduction(product.id, qty, unitCost);
      run('UPDATE products SET is_manufactured = 1 WHERE id = ?', [product.id]);

      return { id: prodId, code, unit_cost: unitCost, total_cost: totalCost };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * Phiếu chia nhỏ: từ 1 mặt hàng lớn tách ra mặt hàng nhỏ hơn.
 * VD: 1 Cuộn dây 100m (mã A) -> 100 Mét dây lẻ (mã B),
 *     hoặc 1 Thùng bóng đèn -> 50 bóng lẻ.
 * body: { from_product_id, from_qty, to_product_id, to_qty, warehouse_id, labor_cost, note }
 */
r.post('/productions/split', (req, res) => {
  const b = req.body;
  const fromQty = Number(b.from_qty) || 0;
  const toQty = Number(b.to_qty) || 0;
  if (fromQty <= 0 || toQty <= 0) {
    return res.status(400).json({ error: 'Số lượng tách ra và số lượng nhận về đều phải lớn hơn 0.' });
  }
  const from = get('SELECT * FROM products WHERE id = ?', [b.from_product_id]);
  const to = get('SELECT * FROM products WHERE id = ?', [b.to_product_id]);
  if (!from || !to) return res.status(400).json({ error: 'Mặt hàng không tồn tại.' });
  if (from.id === to.id) {
    return res.status(400).json({ error: 'Hàng gốc và hàng tách ra phải là hai mặt hàng khác nhau.' });
  }

  const warehouseId = Number(b.warehouse_id) || get('SELECT id FROM warehouses WHERE is_default = 1')?.id;
  const st = get('SELECT qty FROM stock WHERE product_id = ? AND warehouse_id = ?',
    [from.id, warehouseId])?.qty ?? 0;
  if (from.track_stock && st < fromQty) {
    return res.status(400).json({ error: `Không đủ "${from.name}": cần ${fromQty}, kho chỉ còn ${st}.` });
  }

  try {
    const result = tx(() => {
      const code = nextCode('productions', 'CN');
      const fromCost = costOf(from.id);
      const materialCost = Math.round(fromQty * fromCost);
      const laborCost = Math.round(Number(b.labor_cost) || 0);
      const totalCost = materialCost + laborCost;
      const unitCost = Math.round(totalCost / toQty);

      const info = run(`
        INSERT INTO productions(code, ts, kind, warehouse_id, user_id, product_id, qty,
                                material_cost, labor_cost, total_cost, unit_cost, note)
        VALUES(?, COALESCE(?, datetime('now','localtime')), 'split', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [code, b.ts || null, warehouseId, b.user_id || null, to.id, toQty,
          materialCost, laborCost, totalCost, unitCost, b.note || null]);
      const prodId = Number(info.lastInsertRowid);

      run(`INSERT INTO production_items(production_id, component_id, qty, unit_cost, amount)
           VALUES(?, ?, ?, ?, ?)`, [prodId, from.id, fromQty, fromCost, materialCost]);

      moveStock({
        productId: from.id, warehouseId, qtyChange: -fromQty, unitCost: fromCost,
        refType: 'production', refId: prodId, refCode: code,
        note: `Tách ra ${toQty} ${to.base_unit} ${to.name}`, ts: b.ts || null,
      });
      moveStock({
        productId: to.id, warehouseId, qtyChange: toQty, unitCost,
        refType: 'production', refId: prodId, refCode: code,
        note: `Tách từ ${fromQty} ${from.base_unit} ${from.name}`, ts: b.ts || null,
      });
      updateCostAfterProduction(to.id, toQty, unitCost);

      return { id: prodId, code, unit_cost: unitCost };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Huỷ phiếu sản xuất: hoàn linh kiện về kho, trừ lại thành phẩm. */
r.post('/productions/:id/cancel', (req, res) => {
  const pr = get('SELECT * FROM productions WHERE id = ?', [req.params.id]);
  if (!pr) return res.status(404).json({ error: 'Không tìm thấy phiếu sản xuất' });

  const st = get('SELECT qty FROM stock WHERE product_id = ? AND warehouse_id = ?',
    [pr.product_id, pr.warehouse_id])?.qty ?? 0;
  const p = get('SELECT name, track_stock FROM products WHERE id = ?', [pr.product_id]);
  if (p?.track_stock && st < pr.qty) {
    return res.status(400).json({
      error: `Không thể huỷ: "${p.name}" chỉ còn ${st} trong kho, cần thu hồi ${pr.qty}. Thành phẩm đã bán ra rồi.`,
    });
  }

  tx(() => {
    const items = all('SELECT * FROM production_items WHERE production_id = ?', [pr.id]);
    for (const it of items) {
      moveStock({
        productId: it.component_id, warehouseId: pr.warehouse_id, qtyChange: it.qty,
        unitCost: it.unit_cost, refType: 'production', refId: pr.id, refCode: pr.code,
        note: `Huỷ phiếu ${pr.code}, hoàn linh kiện`,
      });
    }
    moveStock({
      productId: pr.product_id, warehouseId: pr.warehouse_id, qtyChange: -pr.qty,
      unitCost: pr.unit_cost, refType: 'production', refId: pr.id, refCode: pr.code,
      note: `Huỷ phiếu ${pr.code}, thu hồi thành phẩm`,
    });
    run('DELETE FROM productions WHERE id = ?', [pr.id]);
  });
  res.json({ ok: true });
});

/** Giá vốn bình quân của thành phẩm sau khi sản xuất thêm. */
function updateCostAfterProduction(productId, addedQty, newUnitCost) {
  const p = get('SELECT cost_price FROM products WHERE id = ?', [productId]);
  if (!p) return;
  const totalQty = get('SELECT COALESCE(SUM(qty), 0) AS q FROM stock WHERE product_id = ?',
    [productId]).q;
  const oldQty = totalQty - addedQty;
  const avg = oldQty > 0
    ? (oldQty * p.cost_price + addedQty * newUnitCost) / totalQty
    : newUnitCost;
  run('UPDATE products SET cost_price = ? WHERE id = ?', [Math.round(avg), productId]);
}

/* ==================================================================== */
/* Đối tác vận chuyển                                                    */
/* ==================================================================== */

r.get('/carriers', (req, res) => {
  res.json(all('SELECT * FROM carriers WHERE active = 1 ORDER BY sort_order, name'));
});

r.post('/carriers', (req, res) => {
  const b = req.body;
  if (!b.name?.trim()) return res.status(400).json({ error: 'Thiếu tên đơn vị vận chuyển' });
  const code = b.code?.trim() ||
    'VC' + String(get('SELECT COUNT(*) AS n FROM carriers').n + 1).padStart(3, '0');
  if (get('SELECT id FROM carriers WHERE code = ?', [code])) {
    return res.status(400).json({ error: `Mã "${code}" đã tồn tại` });
  }
  const info = run(`
    INSERT INTO carriers(code, name, phone, contact_name, note, sort_order)
    VALUES(?, ?, ?, ?, ?, ?)`,
    [code, b.name.trim(), b.phone || null, b.contact_name || null,
      b.note || null, Number(b.sort_order) || 0]);
  res.json(get('SELECT * FROM carriers WHERE id = ?', [Number(info.lastInsertRowid)]));
});

r.put('/carriers/:id', (req, res) => {
  const b = req.body;
  run(`UPDATE carriers SET name = ?, phone = ?, contact_name = ?, note = ?,
         sort_order = ?, active = ? WHERE id = ?`,
    [b.name, b.phone || null, b.contact_name || null, b.note || null,
      Number(b.sort_order) || 0, b.active === 0 ? 0 : 1, req.params.id]);
  res.json(get('SELECT * FROM carriers WHERE id = ?', [req.params.id]));
});

r.delete('/carriers/:id', (req, res) => {
  const n = get('SELECT COUNT(*) AS n FROM sales WHERE carrier_id = ?', [req.params.id]).n;
  if (n > 0) {
    run('UPDATE carriers SET active = 0 WHERE id = ?', [req.params.id]);
    return res.json({ ok: true, deactivated: true, message: `Đơn vị này đã gắn với ${n} hoá đơn nên chỉ được ẩn đi.` });
  }
  run('DELETE FROM carriers WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

export default r;
