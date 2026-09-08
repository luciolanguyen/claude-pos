import { Router } from 'express';
import { all, get, run, tx, moveStock, costOf } from '../db.js';

const r = Router();

/* ----------------------------- Nhóm hàng ----------------------------- */

r.get('/categories', (req, res) => {
  res.json(all(`
    SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
    FROM categories c ORDER BY c.sort_order, c.name
  `));
});

r.post('/categories', (req, res) => {
  const { name, parent_id = null, sort_order = 0 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Thiếu tên nhóm hàng' });
  const info = run('INSERT INTO categories(name, parent_id, sort_order) VALUES(?, ?, ?)',
    [name.trim(), parent_id, sort_order]);
  res.json(get('SELECT * FROM categories WHERE id = ?', [Number(info.lastInsertRowid)]));
});

r.put('/categories/:id', (req, res) => {
  const { name, parent_id = null, sort_order = 0 } = req.body;
  run('UPDATE categories SET name = ?, parent_id = ?, sort_order = ? WHERE id = ?',
    [name, parent_id, sort_order, req.params.id]);
  res.json(get('SELECT * FROM categories WHERE id = ?', [req.params.id]));
});

r.delete('/categories/:id', (req, res) => {
  const used = get('SELECT COUNT(*) AS n FROM products WHERE category_id = ?', [req.params.id]).n;
  if (used > 0) return res.status(400).json({ error: `Nhóm này còn ${used} sản phẩm, không thể xoá.` });
  run('DELETE FROM categories WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

/* ----------------------------- Bảng giá ------------------------------ */

r.get('/price-lists', (req, res) => {
  res.json(all('SELECT * FROM price_lists ORDER BY sort_order, id'));
});

r.post('/price-lists', (req, res) => {
  const { code, name, is_default = 0, sort_order = 0 } = req.body;
  if (!code?.trim() || !name?.trim()) return res.status(400).json({ error: 'Thiếu mã hoặc tên bảng giá' });
  try {
    const info = tx(() => {
      if (is_default) run('UPDATE price_lists SET is_default = 0');
      return run('INSERT INTO price_lists(code, name, is_default, sort_order) VALUES(?, ?, ?, ?)',
        [code.trim().toUpperCase(), name.trim(), is_default ? 1 : 0, sort_order]);
    });
    res.json(get('SELECT * FROM price_lists WHERE id = ?', [Number(info.lastInsertRowid)]));
  } catch (e) {
    res.status(400).json({ error: 'Mã bảng giá đã tồn tại' });
  }
});

r.put('/price-lists/:id', (req, res) => {
  const { name, is_default = 0, sort_order = 0 } = req.body;
  tx(() => {
    if (is_default) run('UPDATE price_lists SET is_default = 0');
    run('UPDATE price_lists SET name = ?, is_default = ?, sort_order = ? WHERE id = ?',
      [name, is_default ? 1 : 0, sort_order, req.params.id]);
  });
  res.json(get('SELECT * FROM price_lists WHERE id = ?', [req.params.id]));
});

r.delete('/price-lists/:id', (req, res) => {
  const pl = get('SELECT * FROM price_lists WHERE id = ?', [req.params.id]);
  if (pl?.is_default) return res.status(400).json({ error: 'Không thể xoá bảng giá mặc định.' });
  run('DELETE FROM price_lists WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

/* ------------------------------- Kho --------------------------------- */

r.get('/warehouses', (req, res) => {
  res.json(all('SELECT * FROM warehouses WHERE active = 1 ORDER BY is_default DESC, id'));
});

r.post('/warehouses', (req, res) => {
  const { code, name, address = null, is_default = 0 } = req.body;
  if (!code?.trim() || !name?.trim()) return res.status(400).json({ error: 'Thiếu mã hoặc tên kho' });
  const info = tx(() => {
    if (is_default) run('UPDATE warehouses SET is_default = 0');
    return run('INSERT INTO warehouses(code, name, address, is_default) VALUES(?, ?, ?, ?)',
      [code.trim().toUpperCase(), name.trim(), address, is_default ? 1 : 0]);
  });
  res.json(get('SELECT * FROM warehouses WHERE id = ?', [Number(info.lastInsertRowid)]));
});

r.put('/warehouses/:id', (req, res) => {
  const { name, address = null, is_default = 0 } = req.body;
  tx(() => {
    if (is_default) run('UPDATE warehouses SET is_default = 0');
    run('UPDATE warehouses SET name = ?, address = ?, is_default = ? WHERE id = ?',
      [name, address, is_default ? 1 : 0, req.params.id]);
  });
  res.json(get('SELECT * FROM warehouses WHERE id = ?', [req.params.id]));
});

/* ----------------------------- Sản phẩm ------------------------------ */

/** Gắn đơn vị + giá bán vào một sản phẩm. */
function hydrate(p) {
  if (!p) return null;
  p.units = all('SELECT * FROM product_units WHERE product_id = ? ORDER BY factor', [p.id]);
  p.prices = all(`
    SELECT pp.*, pl.code AS price_list_code, pu.unit_name
    FROM product_prices pp
    JOIN price_lists pl ON pl.id = pp.price_list_id
    JOIN product_units pu ON pu.id = pp.unit_id
    WHERE pp.product_id = ?`, [p.id]);
  p.stock = all(`
    SELECT s.warehouse_id, w.name AS warehouse_name, s.qty
    FROM stock s JOIN warehouses w ON w.id = s.warehouse_id
    WHERE s.product_id = ?`, [p.id]);
  p.total_stock = p.stock.reduce((a, s) => a + s.qty, 0);
  return p;
}

r.get('/products', (req, res) => {
  const { q = '', category_id, active, low_stock, limit = 500 } = req.query;
  const where = [];
  const params = [];
  if (q.trim()) {
    where.push('(p.name LIKE ? OR p.alias LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.brand LIKE ?)');
    const like = `%${q.trim()}%`;
    params.push(like, like, like, like, like);
  }
  if (category_id) { where.push('p.category_id = ?'); params.push(category_id); }
  if (active !== undefined && active !== '') { where.push('p.active = ?'); params.push(Number(active)); }

  let sql = `
    SELECT p.*, c.name AS category_name,
           COALESCE((SELECT SUM(qty) FROM stock s WHERE s.product_id = p.id), 0) AS total_stock
    FROM products p LEFT JOIN categories c ON c.id = p.category_id`;
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  if (low_stock === '1') {
    sql = `SELECT * FROM (${sql}) t WHERE t.track_stock = 1 AND t.total_stock <= t.min_stock`;
  }
  sql += ` ORDER BY p.name LIMIT ${Number(limit)}`;
  res.json(all(sql, params));
});

/** Danh mục rút gọn cho màn hình POS: kèm đơn vị + giá theo mọi bảng giá. */
r.get('/products/pos', (req, res) => {
  const warehouseId = Number(req.query.warehouse_id) || 1;
  const products = all(`
    SELECT p.id, p.sku, p.barcode, p.name, p.alias, p.base_unit, p.cost_price, p.vat_rate,
           p.track_stock, p.min_stock, p.category_id, p.brand, p.location, p.is_manufactured,
           c.name AS category_name,
           COALESCE((SELECT qty FROM stock s WHERE s.product_id = p.id AND s.warehouse_id = ?), 0) AS stock
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1 ORDER BY p.name`, [warehouseId]);

  const units = all('SELECT * FROM product_units ORDER BY factor');
  const prices = all('SELECT * FROM product_prices');
  const byProduct = new Map();
  for (const u of units) {
    if (!byProduct.has(u.product_id)) byProduct.set(u.product_id, []);
    byProduct.get(u.product_id).push({ ...u, prices: {} });
  }
  const unitIndex = new Map();
  for (const list of byProduct.values()) for (const u of list) unitIndex.set(u.id, u);
  for (const pr of prices) {
    const u = unitIndex.get(pr.unit_id);
    if (u) u.prices[pr.price_list_id] = pr.price;
  }
  for (const p of products) p.units = byProduct.get(p.id) || [];
  res.json(products);
});

r.get('/products/:id', (req, res) => {
  const p = hydrate(get('SELECT * FROM products WHERE id = ?', [req.params.id]));
  if (!p) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
  res.json(p);
});

/** Lịch sử thẻ kho của một sản phẩm. */
r.get('/products/:id/moves', (req, res) => {
  res.json(all(`
    SELECT m.*, w.name AS warehouse_name
    FROM stock_moves m JOIN warehouses w ON w.id = m.warehouse_id
    WHERE m.product_id = ? ORDER BY m.id DESC LIMIT 300`, [req.params.id]));
});

function saveUnitsAndPrices(productId, units = [], baseUnit) {
  const keepIds = [];
  let hasBase = false;
  for (const u of units) {
    const factor = Number(u.factor) || 1;
    const isBase = factor === 1;
    if (isBase) hasBase = true;
    const existing = get('SELECT id FROM product_units WHERE product_id = ? AND unit_name = ?',
      [productId, u.unit_name]);
    let unitId;
    if (existing) {
      run('UPDATE product_units SET factor = ?, is_base = ?, barcode = ? WHERE id = ?',
        [factor, isBase ? 1 : 0, u.barcode || null, existing.id]);
      unitId = existing.id;
    } else {
      unitId = Number(run(
        'INSERT INTO product_units(product_id, unit_name, factor, is_base, barcode) VALUES(?, ?, ?, ?, ?)',
        [productId, u.unit_name, factor, isBase ? 1 : 0, u.barcode || null]
      ).lastInsertRowid);
    }
    keepIds.push(unitId);
    for (const [plId, price] of Object.entries(u.prices || {})) {
      run(`INSERT INTO product_prices(product_id, price_list_id, unit_id, price) VALUES(?, ?, ?, ?)
           ON CONFLICT(product_id, price_list_id, unit_id) DO UPDATE SET price = excluded.price`,
        [productId, Number(plId), unitId, Math.round(Number(price) || 0)]);
    }
  }
  if (!hasBase) {
    const unitId = Number(run(
      'INSERT INTO product_units(product_id, unit_name, factor, is_base) VALUES(?, ?, 1, 1) ' +
      'ON CONFLICT(product_id, unit_name) DO UPDATE SET factor = 1, is_base = 1',
      [productId, baseUnit]
    ).lastInsertRowid);
    if (unitId) keepIds.push(unitId);
  }
  if (keepIds.length) {
    run(`DELETE FROM product_units WHERE product_id = ? AND id NOT IN (${keepIds.map(() => '?').join(',')})`,
      [productId, ...keepIds]);
  }
}

r.post('/products', (req, res) => {
  const b = req.body;
  if (!b.name?.trim()) return res.status(400).json({ error: 'Thiếu tên sản phẩm' });
  let sku = b.sku?.trim();
  if (!sku) {
    const n = get('SELECT COUNT(*) AS n FROM products').n + 1;
    sku = 'SP' + String(n).padStart(5, '0');
  }
  if (get('SELECT id FROM products WHERE sku = ?', [sku])) {
    return res.status(400).json({ error: `Mã hàng "${sku}" đã tồn tại` });
  }
  try {
    const id = tx(() => {
      const info = run(`
        INSERT INTO products(sku, barcode, name, alias, category_id, base_unit, cost_price, vat_rate,
                             track_stock, min_stock, max_stock, brand, location, note, active)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sku, b.barcode || null, b.name.trim(), b.alias?.trim() || null, b.category_id || null, b.base_unit || 'Cái',
          Math.round(b.cost_price || 0), b.vat_rate ?? 8, b.track_stock === 0 ? 0 : 1,
          Number(b.min_stock) || 0, Number(b.max_stock) || 0,
          b.brand || null, b.location || null, b.note || null, b.active === 0 ? 0 : 1]);
      const pid = Number(info.lastInsertRowid);
      saveUnitsAndPrices(pid, b.units, b.base_unit || 'Cái');

      // Tồn kho đầu kỳ (nếu khai báo)
      const openingQty = Number(b.opening_qty) || 0;
      if (openingQty > 0) {
        const wid = Number(b.opening_warehouse_id) ||
          get('SELECT id FROM warehouses WHERE is_default = 1').id;
        moveStock({
          productId: pid, warehouseId: wid, qtyChange: openingQty,
          unitCost: Math.round(b.cost_price || 0), refType: 'opening',
          note: 'Tồn kho đầu kỳ',
        });
      }
      return pid;
    });
    res.json(hydrate(get('SELECT * FROM products WHERE id = ?', [id])));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

r.put('/products/:id', (req, res) => {
  const b = req.body;
  const id = req.params.id;
  if (!get('SELECT id FROM products WHERE id = ?', [id])) {
    return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
  }
  try {
    tx(() => {
      run(`UPDATE products SET barcode = ?, name = ?, alias = ?, category_id = ?, base_unit = ?,
             vat_rate = ?, track_stock = ?, min_stock = ?, max_stock = ?,
             brand = ?, location = ?, note = ?, active = ?
           WHERE id = ?`,
        [b.barcode || null, b.name, b.alias?.trim() || null, b.category_id || null, b.base_unit || 'Cái',
          b.vat_rate ?? 8, b.track_stock === 0 ? 0 : 1,
          Number(b.min_stock) || 0, Number(b.max_stock) || 0,
          b.brand || null, b.location || null, b.note || null, b.active === 0 ? 0 : 1, id]);
      saveUnitsAndPrices(Number(id), b.units, b.base_unit || 'Cái');
    });
    res.json(hydrate(get('SELECT * FROM products WHERE id = ?', [id])));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

r.delete('/products/:id', (req, res) => {
  const id = req.params.id;
  const used = get(
    `SELECT (SELECT COUNT(*) FROM sale_items WHERE product_id = ?) +
            (SELECT COUNT(*) FROM purchase_items WHERE product_id = ?) AS n`, [id, id]).n;
  if (used > 0) {
    run('UPDATE products SET active = 0 WHERE id = ?', [id]);
    return res.json({ ok: true, deactivated: true, message: 'Sản phẩm đã phát sinh giao dịch nên được chuyển sang trạng thái Ngừng kinh doanh.' });
  }
  run('DELETE FROM products WHERE id = ?', [id]);
  res.json({ ok: true, deactivated: false });
});

/** Điều chỉnh giá vốn thủ công. */
r.put('/products/:id/cost', (req, res) => {
  run('UPDATE products SET cost_price = ? WHERE id = ?',
    [Math.round(Number(req.body.cost_price) || 0), req.params.id]);
  res.json({ ok: true, cost_price: costOf(Number(req.params.id)) });
});

/* -------------------------------------------------------------------- */
/* Nhập hàng hoá hàng loạt từ file Excel / CSV                            */
/* -------------------------------------------------------------------- */

/**
 * rows: [{ sku, name, category, base_unit, cost_price, price_retail,
 *          price_wholesale, price_dealer, min_stock, opening_qty,
 *          barcode, brand, location, vat_rate,
 *          big_unit, big_factor, big_price }]
 * mode: 'create' (bỏ qua mã trùng) | 'update' (cập nhật mã trùng)
 * Trả về số dòng thêm mới / cập nhật / bỏ qua, kèm danh sách lỗi từng dòng.
 */
r.post('/products/import', (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const mode = req.body?.mode === 'update' ? 'update' : 'create';
  const warehouseId = Number(req.body?.warehouse_id) ||
    get('SELECT id FROM warehouses WHERE is_default = 1')?.id;
  if (!rows.length) return res.status(400).json({ error: 'Không có dòng dữ liệu nào để nhập.' });

  const priceLists = all('SELECT id, code FROM price_lists ORDER BY sort_order, id');
  const plByCode = Object.fromEntries(priceLists.map((p) => [p.code, p.id]));
  // Nếu cửa hàng đổi tên mã bảng giá thì vẫn dùng được theo thứ tự
  const plRetail = plByCode.LE ?? priceLists[0]?.id;
  const plWholesale = plByCode.SI ?? priceLists[1]?.id;
  const plDealer = plByCode.THO ?? priceLists[2]?.id;

  const errors = [];
  let created = 0, updated = 0, skipped = 0;

  const num = (v) => {
    if (v === undefined || v === null || v === '') return 0;
    // Chấp nhận "1.250.000", "1,250,000", "1250000"
    const s = String(v).replace(/[^\d.,-]/g, '').replace(/[.,](?=\d{3}\b)/g, '');
    const x = Number(s.replace(',', '.'));
    return Number.isFinite(x) ? x : 0;
  };

  try {
    tx(() => {
      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i];
        const line = i + 2; // dòng 1 là tiêu đề trong file gốc
        const name = String(raw.name || '').trim();
        if (!name) { errors.push({ line, error: 'Thiếu tên hàng hoá' }); continue; }

        // Nhóm hàng: khớp theo tên, chưa có thì tạo mới
        let categoryId = null;
        const catName = String(raw.category || '').trim();
        if (catName) {
          const found = get('SELECT id FROM categories WHERE name = ? COLLATE NOCASE', [catName]);
          categoryId = found
            ? found.id
            : Number(run('INSERT INTO categories(name, sort_order) VALUES(?, ?)',
                [catName, get('SELECT COUNT(*) AS n FROM categories').n]).lastInsertRowid);
        }

        const baseUnit = String(raw.base_unit || '').trim() || 'Cái';
        let sku = String(raw.sku || '').trim();
        // Có mã thì khớp theo mã; không có mã thì khớp theo tên, để nhập lại
        // file đã sửa không tạo ra bản trùng.
        const existing = sku
          ? get('SELECT id FROM products WHERE sku = ?', [sku])
          : get('SELECT id FROM products WHERE name = ? COLLATE NOCASE', [name]);

        if (existing && mode === 'create') { skipped++; continue; }

        if (!sku) {
          const n = get('SELECT COUNT(*) AS n FROM products').n + 1;
          sku = 'SP' + String(n).padStart(5, '0');
          let k = n;
          while (get('SELECT id FROM products WHERE sku = ?', [sku])) {
            sku = 'SP' + String(++k).padStart(5, '0');
          }
        }

        const cost = Math.round(num(raw.cost_price));
        const fields = [
          raw.barcode ? String(raw.barcode).trim() : null,
          name, categoryId, baseUnit,
          Number(raw.vat_rate) >= 0 && raw.vat_rate !== '' ? Number(raw.vat_rate) : 8,
          num(raw.min_stock),
          raw.brand ? String(raw.brand).trim() : null,
          raw.location ? String(raw.location).trim() : null,
        ];

        let productId;
        if (existing) {
          run(`UPDATE products SET barcode = ?, name = ?, alias = ?, category_id = ?, base_unit = ?,
                 vat_rate = ?, min_stock = ?, brand = ?, location = ? WHERE id = ?`,
            [fields[0], fields[1], raw.alias ? String(raw.alias).trim() : null,
              fields[2], fields[3], fields[4], fields[5], fields[6], fields[7], existing.id]);
          productId = existing.id;
          updated++;
        } else {
          productId = Number(run(`
            INSERT INTO products(sku, barcode, name, alias, category_id, base_unit, cost_price,
                                 vat_rate, min_stock, brand, location, track_stock, active)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
            [sku, fields[0], fields[1], raw.alias ? String(raw.alias).trim() : null,
              fields[2], fields[3], cost, fields[4], fields[5], fields[6], fields[7]]).lastInsertRowid);
          created++;
        }

        // Đơn vị cơ bản + giá bán 3 bảng giá
        const units = [{
          unit_name: baseUnit,
          factor: 1,
          prices: {
            [plRetail]: Math.round(num(raw.price_retail)),
            ...(plWholesale ? { [plWholesale]: Math.round(num(raw.price_wholesale) || num(raw.price_retail)) } : {}),
            ...(plDealer ? { [plDealer]: Math.round(num(raw.price_dealer) || num(raw.price_retail)) } : {}),
          },
        }];

        // Đơn vị lớn tuỳ chọn (Cuộn 100m, Thùng 50 cái...)
        const bigName = String(raw.big_unit || '').trim();
        const bigFactor = num(raw.big_factor);
        if (bigName && bigFactor > 1) {
          const bigPrice = Math.round(num(raw.big_price)) ||
            Math.round(num(raw.price_retail) * bigFactor);
          units.push({
            unit_name: bigName,
            factor: bigFactor,
            prices: {
              [plRetail]: bigPrice,
              ...(plWholesale ? { [plWholesale]: Math.round((num(raw.price_wholesale) || num(raw.price_retail)) * bigFactor) } : {}),
              ...(plDealer ? { [plDealer]: Math.round((num(raw.price_dealer) || num(raw.price_retail)) * bigFactor) } : {}),
            },
          });
        }
        saveUnitsAndPrices(productId, units, baseUnit);

        // Tồn kho đầu kỳ chỉ ghi cho hàng mới, tránh cộng trùng khi nhập lại file
        const openingQty = num(raw.opening_qty);
        if (!existing && openingQty > 0 && warehouseId) {
          moveStock({
            productId, warehouseId, qtyChange: openingQty, unitCost: cost,
            refType: 'opening', note: 'Tồn đầu kỳ (nhập từ file)',
          });
        }
      }
    });
    res.json({ ok: true, created, updated, skipped, errors });
  } catch (e) {
    res.status(400).json({ error: e.message, errors });
  }
});

export default r;
