import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import {
  all, get, run, tx, moveStock, costOf, costMethodOf, pageParams,
  categoryTree, categoryTreeIds, categoryFilter,
  searchWhere, searchMode, orderBy, PRODUCT_DIR } from '../db.js';

const r = Router();

/** Chỉ nhận 'average' hoặc 'fixed'; còn lại là theo thiết lập chung của tiệm. */
const normCostMethod = (v) => (v === 'average' || v === 'fixed' ? v : null);

const badRequest = (message, code) => Object.assign(new Error(message), { status: 400, code });

/* ==================================================================== */
/* Ảnh hàng hoá (tài liệu 13, mục 1.4)                                   */
/*                                                                      */
/* Tối đa 4 ảnh một mặt hàng, một ảnh làm ảnh chính. File nằm cạnh CSDL  */
/* trong data/products/ — nhét base64 vào CSDL thì file sao lưu phình to */
/* và mỗi lần đọc danh mục là kéo về cả chục MB ảnh.                     */
/* ==================================================================== */

export const MAX_IMAGES = 4;

const EXT_BY_MIME = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
};

function saveImageFile(dataUrl, productId) {
  const m = String(dataUrl || '').match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!m) return null;
  const ext = EXT_BY_MIME[m[1].toLowerCase()];
  if (!ext) return null;                          // chỉ nhận ảnh, không nhận file khác
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 4 * 1024 * 1024) return null;  // 4MB một ảnh là quá đủ cho ảnh hàng
  const name = `sp${productId}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(PRODUCT_DIR, name), buf);
  return name;
}

function deleteImageFile(file) {
  try { fs.unlinkSync(path.join(PRODUCT_DIR, path.basename(String(file)))); }
  catch { /* ảnh mất rồi thì thôi, dòng trong CSDL vẫn phải xoá */ }
}

const imagesOf = (productId) =>
  all('SELECT id, file, is_main, sort_order FROM product_images WHERE product_id = ? ORDER BY is_main DESC, sort_order, id',
    [productId]);

/** Luôn có đúng một ảnh chính, miễn là mặt hàng còn ảnh. */
function fixMainImage(productId, preferId = null) {
  const list = imagesOf(productId);
  if (!list.length) return;
  const keep = list.find((x) => x.id === Number(preferId))
    || list.find((x) => x.is_main) || list[0];
  run('UPDATE product_images SET is_main = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE product_id = ?',
    [keep.id, productId]);
}

/** Trả ảnh về trình duyệt. Chặn đường dẫn lạ để không đọc được file ngoài thư mục. */
r.get('/product-image/:file', (req, res) => {
  const name = path.basename(req.params.file);
  const full = path.join(PRODUCT_DIR, name);
  if (!full.startsWith(PRODUCT_DIR) || !fs.existsSync(full)) {
    return res.status(404).json({ error: 'Không tìm thấy ảnh' });
  }
  res.sendFile(full);
});


/* ----------------------------- Nhóm hàng ----------------------------- */

/**
 * Cả cây nhóm hàng, phẳng ra thành danh sách kèm cấp và đường dẫn.
 *
 * Số hàng hoá đếm theo hai kiểu:
 *   product_count       chỉ hàng gán thẳng vào nhóm này
 *   product_count_tree  gồm cả hàng nằm ở nhóm con cháu
 * Nhóm cha thường không có hàng gán thẳng — chỉ hiện số 0 thì chủ tiệm
 * tưởng cả ngành hàng trống rỗng.
 */
r.get('/categories', (req, res) => {
  const { flat } = categoryTree();
  const counts = new Map(all(`SELECT category_id AS id, COUNT(*) AS n FROM products
                              WHERE category_id IS NOT NULL GROUP BY category_id`)
    .map((x) => [x.id, x.n]));

  const out = flat.map((c) => {
    const ids = categoryTreeIds(c.id);
    return {
      id: c.id, name: c.name, parent_id: c.parent_id, sort_order: c.sort_order,
      no_return: c.no_return ? 1 : 0,
      level: c.level, path: c.path, has_children: c.has_children,
      product_count: counts.get(c.id) || 0,
      product_count_tree: ids.reduce((a, id) => a + (counts.get(id) || 0), 0),
    };
  });
  res.json(out);
});

r.post('/categories', (req, res) => {
  const { name, parent_id = null, sort_order = 0 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Thiếu tên nhóm hàng' });
  if (parent_id) {
    const p = get('SELECT id FROM categories WHERE id = ?', [parent_id]);
    if (!p) return res.status(400).json({ error: 'Không tìm thấy nhóm hàng cha' });
  }
  const info = run('INSERT INTO categories(name, parent_id, sort_order) VALUES(?, ?, ?)',
    [name.trim(), parent_id || null, sort_order]);
  res.json(get('SELECT * FROM categories WHERE id = ?', [Number(info.lastInsertRowid)]));
});

r.put('/categories/:id', (req, res) => {
  const id = Number(req.params.id);
  const { name, parent_id = null, sort_order = 0 } = req.body;
  const cur = get('SELECT * FROM categories WHERE id = ?', [id]);
  if (!cur) return res.status(404).json({ error: 'Không tìm thấy nhóm hàng' });
  if (!name?.trim()) return res.status(400).json({ error: 'Thiếu tên nhóm hàng' });

  const parent = parent_id ? Number(parent_id) : null;
  /* Không cho đưa một nhóm vào chính nó hoặc vào nhánh con của nó — làm
     vậy là cắt rời cả nhánh khỏi cây, và mọi hàm duyệt cây sẽ chạy vòng. */
  if (parent) {
    if (parent === id) {
      return res.status(400).json({ error: 'Không thể đặt một nhóm làm cha của chính nó.' });
    }
    if (categoryTreeIds(id).includes(parent)) {
      return res.status(400).json({
        error: 'Không thể chuyển nhóm này vào bên trong nhóm con của nó.' });
    }
  }

  /* Cờ "không nhận đổi trả" không gửi lên thì giữ nguyên — đổi tên nhóm
     không được vô tình bật tắt cờ này */
  const noReturn = req.body.no_return === undefined ? cur.no_return : (req.body.no_return ? 1 : 0);
  run('UPDATE categories SET name = ?, parent_id = ?, sort_order = ?, no_return = ? WHERE id = ?',
    [name.trim(), parent, sort_order, noReturn, id]);
  res.json(get('SELECT * FROM categories WHERE id = ?', [id]));
});

/**
 * Xoá nhóm hàng.
 *
 * Chặn khi còn nhóm con hoặc còn hàng bên trong, và nói rõ còn bao nhiêu
 * cái gì — báo "không xoá được" trống không thì người dùng không biết
 * phải đi dọn ở đâu. Kèm sẵn danh sách nhóm con để giao diện chỉ chỗ.
 */
r.delete('/categories/:id', (req, res) => {
  const id = Number(req.params.id);
  const cur = get('SELECT * FROM categories WHERE id = ?', [id]);
  if (!cur) return res.status(404).json({ error: 'Không tìm thấy nhóm hàng' });

  const kids = all('SELECT id, name FROM categories WHERE parent_id = ?', [id]);
  const ids = categoryTreeIds(id);
  const here = get(`SELECT COUNT(*) AS n FROM products WHERE category_id = ?`, [id]).n;
  const inTree = get(`SELECT COUNT(*) AS n FROM products
                      WHERE category_id IN (${ids.map(() => '?').join(',')})`, ids).n;

  if (kids.length || inTree > 0) {
    const parts = [];
    if (kids.length) parts.push(`${kids.length} nhóm con`);
    if (inTree > 0) {
      parts.push(here === inTree
        ? `${inTree} mặt hàng`
        : `${inTree} mặt hàng (${here} nằm thẳng ở nhóm này)`);
    }
    return res.status(400).json({
      error: `Nhóm "${cur.name}" còn ${parts.join(" và ")}. Hãy chuyển sang nhóm khác rồi mới xoá.`,
      code: 'CATEGORY_NOT_EMPTY',
      children: kids,
      product_count: inTree,
    });
  }
  run('DELETE FROM categories WHERE id = ?', [id]);
  res.json({ ok: true });
});

/**
 * Chuyển hàng loạt hàng hoá và nhóm con sang nhóm khác — để dọn trước
 * khi xoá một nhóm mà không phải sửa từng mặt hàng một.
 */
r.post('/categories/:id/move-contents', (req, res) => {
  const id = Number(req.params.id);
  const to = req.body.to_category_id ? Number(req.body.to_category_id) : null;
  const cur = get('SELECT * FROM categories WHERE id = ?', [id]);
  if (!cur) return res.status(404).json({ error: 'Không tìm thấy nhóm hàng' });
  if (to) {
    const dest = get('SELECT id FROM categories WHERE id = ?', [to]);
    if (!dest) return res.status(400).json({ error: 'Không tìm thấy nhóm hàng đích' });
    if (categoryTreeIds(id).includes(to)) {
      return res.status(400).json({ error: 'Không thể chuyển vào chính nhánh con của nhóm này.' });
    }
  }
  const out = tx(() => {
    const moved = run('UPDATE products SET category_id = ? WHERE category_id = ?', [to, id]).changes;
    let movedKids = 0;
    if (req.body.move_children !== false) {
      movedKids = run('UPDATE categories SET parent_id = ? WHERE parent_id = ?', [to, id]).changes;
    }
    return { ok: true, moved_products: moved, moved_children: movedKids };
  });
  res.json(out);
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
  /* Đơn vị đã ngừng hoạt động vẫn trả về cho bảng khai báo và hoá đơn cũ,
     kèm cờ used để màn hình biết món nào xoá vĩnh viễn được. */
  p.units = all('SELECT * FROM product_units WHERE product_id = ? ORDER BY active DESC, factor', [p.id])
    .map((u) => ({ ...u, used: unitUsage(u.id) > 0 }));
  p.images = imagesOf(p.id);
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

/* ==================================================================== *
 * DANH SÁCH HÀNG HOÁ & TỒN KHO (tài liệu 15, mục 1)
 *
 * Một màn hình duy nhất thay cho hai trang Hàng hoá và Tồn kho tách rời.
 * Mỗi dòng có đủ thông tin hành chính, tồn kho, giá vốn, giá bán và tình
 * trạng tồn — sửa nhanh tại chỗ được.
 *
 * Phân trang phía máy chủ, không chặn cứng 500 dòng — tiệm nhập cả nghìn
 * mã hàng thì 500 dòng là mất hàng mà không ai biết.
 *
 * Bộ lọc nằm trên thanh công cụ (tài liệu 13, mục 1.1 bỏ hàng ô lọc dưới
 * tiêu đề cột). Sắp xếp theo cột nào thì gửi sort + dir. Số tổng tính trên
 * CẢ bộ lọc chứ không phải trang đang xem, để thẻ "giá trị tồn kho" không
 * đổi theo số trang.
 * ==================================================================== */

/** Cột được phép sắp xếp. Khoá danh sách lại để không ghép chuỗi lạ vào SQL. */
const PRODUCT_SORTS = {
  sku: 't.sku', name: 't.name', category: 't.category_name', unit: 't.base_unit',
  cost_price: 't.cost_price', sale_price: 't.sale_price', stock: 't.total_stock',
  min_stock: 't.min_stock', value: '(t.total_stock * t.cost_price)', location: 't.location',
};

r.get('/products', (req, res) => {
  const {
    q = '', category_id, active, low_stock, warehouse_id,
    name = '', sku = '', barcode = '', brand = '', location = '', stock_status = '',
    sort = '', dir = 'asc', match = 'contains',
  } = req.query;
  const where = [];
  const params = [];
  const mode = searchMode(match);
  const push = (cols, v) => {
    const c = searchWhere(cols, v, mode);
    if (c.sql) { where.push(c.sql); params.push(...c.params); }
  };

  push(['p.name', 'p.alias', 'p.sku', 'p.barcode', 'p.brand'], q);
  /* Bộ lọc theo từng cột vẫn nhận được từ đường dẫn cũ và từ thanh công cụ */
  push(['p.name', 'p.alias'], name);
  push('p.sku', sku);
  push('p.barcode', barcode);
  if (brand.trim()) { where.push('p.brand = ?'); params.push(brand.trim()); }
  if (location.trim()) { where.push('p.location = ?'); params.push(location.trim()); }
  /* Lấy cả nhóm con cháu, không chỉ đúng nhóm được chọn */
  if (category_id) {
    const cf = categoryFilter(category_id);
    if (cf) { where.push(cf.sql); params.push(...cf.params); }
  }
  if (active !== undefined && active !== '') { where.push('p.active = ?'); params.push(Number(active)); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';

  /* Chọn một kho thì cột tồn là tồn của kho đó; không chọn thì cộng mọi kho */
  const wid = Number(warehouse_id) || 0;
  const stockExpr = wid
    ? 'COALESCE((SELECT qty FROM stock s WHERE s.product_id = p.id AND s.warehouse_id = ?), 0)'
    : 'COALESCE((SELECT SUM(qty) FROM stock s WHERE s.product_id = p.id), 0)';
  const head = wid ? [wid] : [];

  /* Tồn kho là tổng của nhiều kho nên phải lọc ở lớp ngoài, sau khi cộng */
  const base = `
    SELECT p.*, c.name AS category_name,
           ${stockExpr} AS total_stock,
           (SELECT file FROM product_images pi WHERE pi.product_id = p.id
             ORDER BY pi.is_main DESC, pi.sort_order, pi.id LIMIT 1) AS image,
           (SELECT COUNT(*) FROM product_images pi WHERE pi.product_id = p.id) AS image_count,
           /* Giá bán của đơn vị bán chính theo bảng giá mặc định — để sửa
              nhanh ngay trên lưới, khỏi mở cả thẻ hàng hoá (tài liệu 15) */
           (SELECT pp.price FROM product_prices pp
             WHERE pp.product_id = p.id
               AND pp.unit_id = COALESCE(p.sell_unit_id, (SELECT id FROM product_units u
                                  WHERE u.product_id = p.id AND u.factor = 1 LIMIT 1))
             ORDER BY pp.price_list_id LIMIT 1) AS sale_price,
           COALESCE(p.pack_spec, '') AS pack_spec
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    ${w}`;

  const outer = [];
  if (low_stock === '1' || stock_status === 'low') {
    outer.push('t.track_stock = 1 AND t.total_stock <= t.min_stock');
  }
  if (stock_status === 'out') outer.push('t.track_stock = 1 AND t.total_stock <= 0');
  if (stock_status === 'in') outer.push('t.track_stock = 1 AND t.total_stock > 0');
  if (stock_status === 'over') outer.push('t.track_stock = 1 AND t.max_stock > 0 AND t.total_stock > t.max_stock');
  const ow = outer.length ? 'WHERE ' + outer.join(' AND ') : '';
  const wrapped = `SELECT * FROM (${base}) t ${ow}`;

  const { page, size, offset } = pageParams(req.query, 20);
  const agg = get(`
    SELECT COUNT(*) AS count,
           COALESCE(SUM(t.total_stock * t.cost_price), 0) AS value,
           COALESCE(SUM(CASE WHEN t.track_stock = 1 AND t.total_stock <= t.min_stock
                              AND t.total_stock > 0 THEN 1 ELSE 0 END), 0) AS low,
           COALESCE(SUM(CASE WHEN t.track_stock = 1 AND t.total_stock <= 0
                             THEN 1 ELSE 0 END), 0) AS out
    FROM (${wrapped}) t`, [...head, ...params]);

  const order = orderBy(PRODUCT_SORTS, sort, dir, 't.name ASC');
  const rows = all(`${wrapped} ORDER BY ${order} LIMIT ${size} OFFSET ${offset}`,
    [...head, ...params]);
  /* Tình trạng tồn tính một lần ở đây, để mọi màn hình dùng chung một luật */
  for (const row of rows) {
    row.stock_status = !row.track_stock ? 'service'
      : row.total_stock <= 0 ? 'out'
        : (row.min_stock > 0 && row.total_stock <= row.min_stock) ? 'low'
          : (row.max_stock > 0 && row.total_stock > row.max_stock) ? 'over' : 'ok';
    row.stock_value = Math.round(row.total_stock * row.cost_price);
  }
  res.json({ rows, total: agg.count, page, page_size: size, totals: agg, warehouse_id: wid || null });
});

/** Các giá trị có thật của hãng và vị trí, để đổ vào ô lọc. */
r.get('/products/filters', (req, res) => {
  res.json({
    brands: all("SELECT DISTINCT brand AS v FROM products WHERE brand IS NOT NULL AND brand <> '' ORDER BY brand")
      .map((x) => x.v),
    locations: all("SELECT DISTINCT location AS v FROM products WHERE location IS NOT NULL AND location <> '' ORDER BY location")
      .map((x) => x.v),
  });
});

/** Danh mục rút gọn cho màn hình POS: kèm đơn vị + giá theo mọi bảng giá. */
r.get('/products/pos', (req, res) => {
  const warehouseId = Number(req.query.warehouse_id) || 1;
  const products = all(`
    SELECT p.id, p.sku, p.barcode, p.name, p.alias, p.base_unit, p.cost_price, p.vat_rate,
           p.track_stock, p.min_stock, p.category_id, p.brand, p.location, p.is_manufactured,
           p.warranty_months, p.warranty_note, p.description, p.pack_spec, p.purchase_note,
           p.sell_unit_id, p.buy_unit_id,
           c.name AS category_name,
           /* Giá nhập gần nhất quy về đơn vị cơ bản — cho quản lý thấy biên lãi
              thật khi sửa giá (tài liệu 06). Người không có quyền giá vốn thì
              lớp chặn trong index.js cắt trường này đi. */
           (SELECT CAST(ROUND(pi.price * 1.0 / COALESCE(NULLIF(pi.factor, 0), 1)) AS INTEGER)
              FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
             WHERE pi.product_id = p.id AND pu.status = 'done'
             ORDER BY pu.ts DESC, pi.id DESC LIMIT 1) AS last_purchase_price,
           COALESCE((SELECT qty FROM stock s WHERE s.product_id = p.id AND s.warehouse_id = ?), 0) AS stock
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1 ORDER BY p.name`, [warehouseId]);

  /* Đơn vị ĐÃ NGỪNG HOẠT ĐỘNG không hiện ở màn hình bán hàng: không cho bán
     mới nữa, nhưng hoá đơn cũ vẫn đọc được đơn vị đó (tài liệu 13, mục 1.3) */
  /* Kèm cờ đơn vị bán chính / mua chính và quy cách riêng của từng đơn vị:
     lưới bán hàng dựng mỗi đơn vị bán chính thành một ô riêng (tài liệu 16) */
  const units = all('SELECT * FROM product_units WHERE active = 1 ORDER BY factor');
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

  /* Ảnh: ảnh chính để vẽ ô hàng, cả bộ để mở hộp xem chi tiết */
  const imgs = all('SELECT product_id, id, file, is_main FROM product_images ORDER BY is_main DESC, sort_order, id');
  const imgByProduct = new Map();
  for (const im of imgs) {
    if (!imgByProduct.has(im.product_id)) imgByProduct.set(im.product_id, []);
    imgByProduct.get(im.product_id).push(im);
  }

  /* Hàng / nhóm hàng ghim đầu lưới theo mùa (tài liệu 14, mục 2). Số nhỏ hơn
     là ưu tiên cao hơn; món không ghim để null để máy khách khỏi đoán. */
  const featured = featuredRanks();

  for (const p of products) {
    p.units = byProduct.get(p.id) || [];
    p.images = imgByProduct.get(p.id) || [];
    p.image = p.images[0]?.file || null;
    const rank = featured.product.get(p.id);
    const catRank = featured.category.get(p.category_id);
    const best = [rank, catRank].filter((x) => x !== undefined);
    p.featured_rank = best.length ? Math.min(...best) : null;
  }
  res.json(products);
});

/* ==================================================================== *
 * HÀNG / NHÓM HÀNG GHIM ĐẦU LƯỚI POS (tài liệu 14, mục 2)
 *
 * Mùa nào bán chạy món nào thì ghim món đó lên đầu, thu ngân khỏi gõ tìm.
 * Ghim được cả một NHÓM hàng: mùa mưa ghim nhóm "Đèn pin & pin", cả nhóm
 * nhảy lên đầu mà không phải ghim từng mã.
 * ==================================================================== */

/** Thứ tự ưu tiên theo mã hàng và theo nhóm hàng (kèm nhóm con cháu). */
function featuredRanks() {
  /* CHỈ đọc danh sách đang dùng. Hàng nằm trong các BỘ đã cất (set_id khác
     null) là hàng để dành cho mùa sau, chưa ghim (tài liệu 16, mục 4). */
  const rows = all(`SELECT kind, ref_id, sort_order FROM pos_featured
                    WHERE set_id IS NULL ORDER BY sort_order, id`);
  const product = new Map();
  const category = new Map();
  rows.forEach((x, i) => {
    const rank = Number(x.sort_order) || i;
    if (x.kind === 'product') {
      if (!product.has(x.ref_id)) product.set(x.ref_id, rank);
    } else if (x.kind === 'category') {
      /* Ghim nhóm cha thì cả nhánh con cháu ăn theo */
      for (const cid of [x.ref_id, ...categoryTreeIds(x.ref_id)]) {
        if (!category.has(cid)) category.set(cid, rank);
      }
    }
  });
  return { product, category };
}

r.get('/pos-featured', (req, res) => {
  /* set_id NULL = danh sách đang dùng; truyền set_id để xem nội dung một bộ */
  const setId = req.query.set_id ? Number(req.query.set_id) : null;
  res.json(all(`
    SELECT f.*,
           CASE WHEN f.kind = 'product' THEN p.name ELSE c.name END AS label,
           p.sku, p.active AS product_active
    FROM pos_featured f
    LEFT JOIN products p ON f.kind = 'product' AND p.id = f.ref_id
    LEFT JOIN categories c ON f.kind = 'category' AND c.id = f.ref_id
    WHERE f.set_id IS ?
    ORDER BY f.sort_order, f.id`, [setId]));
});

/** Ghi một danh sách ghim (bộ nào đó, hoặc danh sách đang dùng). */
function writeFeatured(list, setId = null) {
  run('DELETE FROM pos_featured WHERE set_id IS ?', [setId]);
  /* Xoá sạch rồi ghi lại, nên không cần ON CONFLICT — chỉ phải tự loại trùng
     trong chính danh sách gửi lên. Làm vậy để chạy được cả trên cơ sở dữ liệu
     đời trước, nơi bảng còn khoá UNIQUE kiểu cũ. */
  const seen = new Set();
  let i = 0;
  for (const it of list) {
    const kind = it.kind === 'category' ? 'category' : 'product';
    const refId = Number(it.ref_id) || 0;
    if (!refId) continue;
    const key = `${kind}:${refId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    run('INSERT INTO pos_featured(kind, ref_id, sort_order, note, set_id) VALUES(?, ?, ?, ?, ?)',
      [kind, refId, i++, it.note || null, setId]);
  }
}

/** Lưu lại CẢ danh sách theo đúng thứ tự màn hình đang hiện. */
r.put('/pos-featured', (req, res) => {
  const list = Array.isArray(req.body?.items) ? req.body.items : [];
  const setId = req.body?.set_id ? Number(req.body.set_id) : null;
  try {
    tx(() => {
      if (setId && !get('SELECT id FROM pos_featured_sets WHERE id = ?', [setId])) {
        throw badRequest('Không tìm thấy bộ hàng ghim', 'SET_NOT_FOUND');
      }
      writeFeatured(list, setId);
      /* Sửa nội dung bộ đang bật thì danh sách dùng thật đổi theo luôn */
      if (setId && get('SELECT active FROM pos_featured_sets WHERE id = ?', [setId])?.active) {
        writeFeatured(list, null);
      }
    });
    res.json({
      ok: true,
      count: get('SELECT COUNT(*) AS n FROM pos_featured WHERE set_id IS ?', [setId]).n,
    });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

/* ==================================================================== *
 * BỘ HÀNG GHIM THEO MÙA (tài liệu 16, mục 4)
 *
 * Mùa hè ghim quạt, mùa Tết ghim đèn nháy. Lưu sẵn mỗi mùa một bộ rồi bật
 * lại khi tới mùa — khỏi phải đi chọn lại từng món.
 *
 * Bật một bộ là CHÉP nội dung bộ đó sang danh sách đang dùng; bộ vẫn nằm
 * nguyên để mùa sau bật lại. Tắt hết thì lưới bán hàng về thứ tự thường,
 * KHÔNG ẩn món nào (tài liệu 16, mục 4).
 * ==================================================================== */

r.get('/pos-featured-sets', (req, res) => {
  res.json(all(`
    SELECT s.*,
           (SELECT COUNT(*) FROM pos_featured f WHERE f.set_id = s.id) AS item_count
    FROM pos_featured_sets s ORDER BY s.sort_order, s.id`));
});

r.post('/pos-featured-sets', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Đặt tên cho bộ hàng ghim, ví dụ "Hàng ghim mùa hè"' });
  try {
    const out = tx(() => {
      const n = get('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM pos_featured_sets').n;
      const info = run('INSERT INTO pos_featured_sets(name, sort_order, note) VALUES(?, ?, ?)',
        [name, n, String(req.body?.note ?? '').trim() || null]);
      const id = Number(info.lastInsertRowid);
      /* Lưu bộ từ danh sách đang dùng: "cất lại mùa này để sang năm bật" */
      const items = Array.isArray(req.body?.items) ? req.body.items
        : (req.body?.from_current
          ? all('SELECT kind, ref_id FROM pos_featured WHERE set_id IS NULL ORDER BY sort_order, id')
          : []);
      writeFeatured(items, id);
      return get('SELECT * FROM pos_featured_sets WHERE id = ?', [id]);
    });
    res.json(out);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

r.put('/pos-featured-sets/:id', (req, res) => {
  const set = get('SELECT * FROM pos_featured_sets WHERE id = ?', [req.params.id]);
  if (!set) return res.status(404).json({ error: 'Không tìm thấy bộ hàng ghim' });
  const name = req.body?.name === undefined ? set.name : String(req.body.name).trim();
  if (!name) return res.status(400).json({ error: 'Bộ hàng ghim phải có tên' });
  run('UPDATE pos_featured_sets SET name = ?, note = ? WHERE id = ?',
    [name, req.body?.note === undefined ? set.note : (String(req.body.note).trim() || null), set.id]);
  res.json(get('SELECT * FROM pos_featured_sets WHERE id = ?', [set.id]));
});

r.delete('/pos-featured-sets/:id', (req, res) => {
  const set = get('SELECT * FROM pos_featured_sets WHERE id = ?', [req.params.id]);
  if (!set) return res.status(404).json({ error: 'Không tìm thấy bộ hàng ghim' });
  tx(() => {
    run('DELETE FROM pos_featured WHERE set_id = ?', [set.id]);
    run('DELETE FROM pos_featured_sets WHERE id = ?', [set.id]);
  });
  res.json({ ok: true });
});

/**
 * Bật một bộ (chép sang danh sách đang dùng), hoặc tắt hết ghim.
 * Tắt thì XẢ GHIM chứ không ẩn hàng: lưới về thứ tự thường (tài liệu 16).
 */
r.post('/pos-featured-sets/:id/activate', (req, res) => {
  const off = req.params.id === 'off' || req.body?.active === false;
  try {
    const out = tx(() => {
      if (off) {
        run('UPDATE pos_featured_sets SET active = 0');
        writeFeatured([], null);
        return { ok: true, active: null, count: 0 };
      }
      const set = get('SELECT * FROM pos_featured_sets WHERE id = ?', [req.params.id]);
      if (!set) throw badRequest('Không tìm thấy bộ hàng ghim', 'SET_NOT_FOUND');
      const items = all('SELECT kind, ref_id, note FROM pos_featured WHERE set_id = ? ORDER BY sort_order, id',
        [set.id]);
      run('UPDATE pos_featured_sets SET active = 0');
      run('UPDATE pos_featured_sets SET active = 1 WHERE id = ?', [set.id]);
      writeFeatured(items, null);
      return { ok: true, active: set, count: items.length };
    });
    res.json(out);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
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

/* ==================================================================== *
 * LỊCH SỬ NHẬP HÀNG CỦA MỘT MẶT HÀNG
 *
 * Chủ tiệm hay hỏi "lần trước lấy của ai, bao nhiêu một cái". Bảng này
 * trả lời thẳng: phiếu nhập nào, ngày nào, mối nào, giá bao nhiêu.
 *
 * Giá quy về đơn vị cơ bản (price / factor) để so sánh được giữa lần lấy
 * nguyên thùng và lần lấy lẻ từng cái — nếu không thì nhìn cột giá sẽ
 * tưởng mối tăng giá gấp mười.
 * ==================================================================== */

r.get('/products/:id/purchase-history', (req, res) => {
  const id = Number(req.params.id);
  const p = get('SELECT id, name, base_unit FROM products WHERE id = ?', [id]);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });

  const rows = all(`
    SELECT pu.id AS purchase_id, pu.code, pu.ts, pu.status,
           s.id AS supplier_id, s.name AS supplier_name, s.phone AS supplier_phone,
           pi.unit_name, pi.factor, pi.qty, pi.price, pi.amount,
           (pi.qty * pi.factor) AS qty_base,
           CAST(ROUND(pi.price / pi.factor) AS INTEGER) AS unit_price_base
    FROM purchase_items pi
    JOIN purchases pu ON pu.id = pi.purchase_id
    LEFT JOIN suppliers s ON s.id = pu.supplier_id
    WHERE pi.product_id = ?
    ORDER BY pu.ts DESC, pu.id DESC
    LIMIT 200`, [id]);

  const done = rows.filter((x) => x.status === 'done');
  const prices = done.map((x) => x.unit_price_base).filter((v) => v > 0);
  const totalQty = done.reduce((a, x) => a + x.qty_base, 0);
  const totalAmount = done.reduce((a, x) => a + x.amount, 0);

  res.json({
    product: p,
    rows,
    summary: {
      count: done.length,
      qty: totalQty,
      amount: totalAmount,
      min: prices.length ? Math.min(...prices) : 0,
      max: prices.length ? Math.max(...prices) : 0,
      // Bình quân theo số lượng, không phải bình quân cộng các mức giá —
      // lấy 1000 cái giá rẻ và 1 cái giá đắt thì giá bình quân phải gần giá rẻ
      avg: totalQty > 0 ? Math.round(totalAmount / totalQty) : 0,
      last: done[0]?.unit_price_base || 0,
      last_ts: done[0]?.ts || null,
      last_supplier: done[0]?.supplier_name || null,
    },
  });
});

/* ==================================================================== *
 * ĐƠN VỊ TÍNH (tài liệu 13 mục 1.3, tài liệu 15 mục 2.1)
 *
 * Mỗi đơn vị có MÃ RIÊNG. Chứng từ nối vào mã đó, nên đổi tên đơn vị không
 * làm hoá đơn cũ đọc sai — hoá đơn cũ còn giữ thêm bản chụp tên và hệ số
 * tại thời điểm bán, nên vẫn in lại đúng y như lúc xuất.
 *
 * Hệ số quy đổi bắt buộc là SỐ NGUYÊN DƯƠNG. Cho gõ 0.5 thì tồn kho lẻ ra
 * số thập phân, và không ai đếm được nửa cái trong kho.
 * ==================================================================== */

/** Số chứng từ đã dùng một đơn vị. Còn dùng thì không xoá vĩnh viễn được. */
function unitUsage(unitId) {
  const id = Number(unitId) || 0;
  if (!id) return 0;
  return get(`
    SELECT (SELECT COUNT(*) FROM sale_items WHERE unit_id = ?)
         + (SELECT COUNT(*) FROM purchase_items WHERE unit_id = ?)
         + (SELECT COUNT(*) FROM sale_order_items WHERE unit_id = ?)
         + (SELECT COUNT(*) FROM sale_return_items WHERE unit_id = ?)
         + (SELECT COUNT(*) FROM purchase_return_items WHERE unit_id = ?) AS n`,
  [id, id, id, id, id]).n;
}

/** Hệ số quy đổi: số nguyên dương lớn hơn 0, không nhận số âm hay thập phân. */
function checkFactor(value, unitName) {
  const v = Number(value);
  if (!Number.isFinite(v) || !Number.isInteger(v) || v <= 0) {
    throw badRequest(
      `Hệ số quy đổi của "${unitName || 'đơn vị'}" phải là số nguyên dương lớn hơn 0`
      + ' (ví dụ 12, 100). Không nhận số âm hay số thập phân.',
      'BAD_FACTOR');
  }
  return v;
}

function saveUnitsAndPrices(productId, units = [], baseUnit, fallbackPack) {
  const keepIds = [];
  let hasBase = false;
  for (const u of units) {
    const name = String(u.unit_name ?? '').trim();
    if (!name) throw badRequest('Mỗi đơn vị tính phải có tên');
    const factor = checkFactor(u.factor, name);
    const isBase = factor === 1;
    if (isBase) hasBase = true;
    /* Có mã thì sửa đúng dòng đó (đổi tên vẫn là cùng một đơn vị). Không có
       mã thì mới tra theo tên — trường hợp màn hình cũ hoặc phiếu tạm cũ. */
    const existing = u.id
      ? get('SELECT id FROM product_units WHERE id = ? AND product_id = ?', [Number(u.id), productId])
      : get('SELECT id FROM product_units WHERE product_id = ? AND unit_name = ?', [productId, name]);
    const refUnit = Number(u.ref_unit_id) || null;
    const refQty = Number(u.ref_qty) > 0 ? Number(u.ref_qty) : null;
    /* Quy cách đóng gói ghi theo TỪNG đơn vị (tài liệu 18, vùng 3).
       Màn hình cũ chỉ gửi một quy cách cho cả mặt hàng: gán cho đơn vị cơ bản. */
    const pack = String(u.pack_spec ?? (isBase ? fallbackPack : '') ?? '').trim() || null;
    /* Nhiều đơn vị cùng làm đơn vị bán chính / mua chính (tài liệu 16, mục 2.1).
       Biểu mẫu cũ không gửi hai cờ này thì để saveDefaultUnits lo như trước. */
    const sellMain = u.is_sell_main === 1 || u.is_sell_main === true ? 1 : 0;
    const buyMain = u.is_buy_main === 1 || u.is_buy_main === true ? 1 : 0;
    let unitId;
    if (existing) {
      run(`UPDATE product_units SET unit_name = ?, factor = ?, is_base = ?, barcode = ?,
             active = ?, ref_unit_id = ?, ref_qty = ?, pack_spec = ?,
             is_sell_main = ?, is_buy_main = ? WHERE id = ?`,
        [name, factor, isBase ? 1 : 0, u.barcode || null,
          u.active === 0 ? 0 : 1, refUnit, refQty, pack,
          sellMain, buyMain, existing.id]);
      unitId = existing.id;
    } else {
      unitId = Number(run(
        `INSERT INTO product_units(product_id, unit_name, factor, is_base, barcode,
                                   active, ref_unit_id, ref_qty, pack_spec,
                                   is_sell_main, is_buy_main)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [productId, name, factor, isBase ? 1 : 0, u.barcode || null,
          u.active === 0 ? 0 : 1, refUnit, refQty, pack, sellMain, buyMain]
      ).lastInsertRowid);
    }
    keepIds.push(unitId);
    u._id = unitId;
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

  /* Đơn vị bị bỏ khỏi bảng khai báo: từng bán hoặc từng nhập thì KHÔNG xoá
     khỏi CSDL, chỉ chuyển sang ngừng hoạt động — xoá là hoá đơn cũ mất đơn
     vị, đổi trả hàng cũ không biết quy đổi ra sao. */
  const dropped = all(
    `SELECT id, unit_name FROM product_units WHERE product_id = ?
       ${keepIds.length ? `AND id NOT IN (${keepIds.map(() => '?').join(',')})` : ''}`,
    [productId, ...keepIds]);
  for (const d of dropped) {
    if (unitUsage(d.id) > 0) run('UPDATE product_units SET active = 0 WHERE id = ?', [d.id]);
    else run('DELETE FROM product_units WHERE id = ?', [d.id]);
  }

  /* Quy cách của đơn vị cơ bản giữ luôn ở cột cũ products.pack_spec, để các
     màn hình chỉ đọc một quy cách (lưới hàng hoá, phiếu nhập) vẫn chạy. */
  const basePack = get(`SELECT pack_spec FROM product_units
                        WHERE product_id = ? AND factor = 1 LIMIT 1`, [productId])?.pack_spec ?? null;
  run('UPDATE products SET pack_spec = ? WHERE id = ?', [basePack, productId]);

  /* Hai cột cũ trỏ vào đơn vị ĐẦU TIÊN được tích, để chỗ nào chỉ cần một
     đơn vị (phiếu nhập, giỏ POS) vẫn đọc như cũ. Không tích ô nào thì giữ
     nguyên giá trị đang có — saveDefaultUnits xử lý tiếp. */
  const firstSell = get(`SELECT id FROM product_units
                         WHERE product_id = ? AND is_sell_main = 1 AND active = 1
                         ORDER BY factor LIMIT 1`, [productId])?.id;
  const firstBuy = get(`SELECT id FROM product_units
                        WHERE product_id = ? AND is_buy_main = 1 AND active = 1
                        ORDER BY factor DESC LIMIT 1`, [productId])?.id;
  if (firstSell) run('UPDATE products SET sell_unit_id = ? WHERE id = ?', [firstSell, productId]);
  if (firstBuy) run('UPDATE products SET buy_unit_id = ? WHERE id = ?', [firstBuy, productId]);
}

/**
 * Hai đơn vị mặc định của mặt hàng: bán thì nhảy đơn vị nào vào giỏ POS,
 * nhập thì nhảy đơn vị nào vào phiếu nhập. Khai sai (đơn vị của mặt hàng
 * khác, hoặc đơn vị đã ngừng) thì rơi về đơn vị cơ bản.
 */
function saveDefaultUnits(productId, body, units) {
  /* Biểu mẫu đợt 16 tích ô ngay trên từng dòng đơn vị; lúc đó saveUnitsAndPrices
     đã chốt hai cột rồi, không đè lên nữa (tài liệu 16, mục 2.1). */
  if (Array.isArray(units) && units.some((u) => u?.is_sell_main || u?.is_buy_main)) return;
  const pick = (v, key) => {
    /* Biểu mẫu gửi mã đơn vị cũ, hoặc gửi vị trí dòng trong bảng vừa lưu */
    const byIndex = Number.isInteger(Number(body[`${key}_index`]))
      ? units?.[Number(body[`${key}_index`])]?._id : null;
    const id = Number(v) || byIndex || 0;
    const row = id
      ? get('SELECT id FROM product_units WHERE id = ? AND product_id = ? AND active = 1', [id, productId])
      : null;
    return row?.id
      || get('SELECT id FROM product_units WHERE product_id = ? AND factor = 1 AND active = 1',
        [productId])?.id
      || null;
  };
  run('UPDATE products SET sell_unit_id = ?, buy_unit_id = ? WHERE id = ?',
    [pick(body.sell_unit_id, 'sell_unit'), pick(body.buy_unit_id, 'buy_unit'), productId]);
}

/**
 * Xoá một đơn vị tính (tài liệu 13, mục 1.3).
 * Chưa phát sinh chứng từ thì xoá vĩnh viễn; đã từng nằm trong hoá đơn thì
 * chuyển sang [Ngừng hoạt động] và ẩn khỏi màn hình bán hàng.
 */
r.delete('/products/:id/units/:unitId', (req, res) => {
  const pid = Number(req.params.id);
  const u = get('SELECT * FROM product_units WHERE id = ? AND product_id = ?',
    [Number(req.params.unitId), pid]);
  if (!u) return res.status(404).json({ error: 'Không tìm thấy đơn vị tính' });
  if (u.factor === 1) {
    return res.status(400).json({
      error: 'Không xoá được đơn vị cơ bản. Mặt hàng luôn phải có một đơn vị hệ số 1.',
      code: 'BASE_UNIT' });
  }
  const used = unitUsage(u.id);
  tx(() => {
    if (used > 0) {
      run('UPDATE product_units SET active = 0 WHERE id = ?', [u.id]);
    } else {
      run('DELETE FROM product_prices WHERE unit_id = ?', [u.id]);
      run('DELETE FROM product_units WHERE id = ?', [u.id]);
    }
    /* Đơn vị vừa bỏ đang là đơn vị bán / mua chính thì trả về đơn vị cơ bản */
    const base = get('SELECT id FROM product_units WHERE product_id = ? AND factor = 1', [pid])?.id || null;
    run(`UPDATE products
           SET sell_unit_id = CASE WHEN sell_unit_id = ? THEN ? ELSE sell_unit_id END,
               buy_unit_id  = CASE WHEN buy_unit_id  = ? THEN ? ELSE buy_unit_id  END
         WHERE id = ?`, [u.id, base, u.id, base, pid]);
  });
  res.json({
    ok: true, archived: used > 0, used,
    message: used > 0
      ? `Đơn vị "${u.unit_name}" đã nằm trong ${used} chứng từ nên được chuyển sang `
        + 'Ngừng hoạt động: không bán mới được nữa, nhưng hoá đơn cũ vẫn đọc đúng.'
      : `Đã xoá hẳn đơn vị "${u.unit_name}".`,
  });
});

/** Mở lại một đơn vị đã ngừng hoạt động. */
r.put('/products/:id/units/:unitId/restore', (req, res) => {
  const u = get('SELECT * FROM product_units WHERE id = ? AND product_id = ?',
    [Number(req.params.unitId), Number(req.params.id)]);
  if (!u) return res.status(404).json({ error: 'Không tìm thấy đơn vị tính' });
  run('UPDATE product_units SET active = 1 WHERE id = ?', [u.id]);
  res.json({ ok: true });
});

/* ==================================================================== *
 * ẢNH HÀNG HOÁ
 * ==================================================================== */

r.post('/products/:id/images', (req, res) => {
  const pid = Number(req.params.id);
  if (!get('SELECT id FROM products WHERE id = ?', [pid])) {
    return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
  }
  const incoming = Array.isArray(req.body?.images) ? req.body.images : [];
  const have = get('SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?', [pid]).n;
  const room = MAX_IMAGES - have;
  if (room <= 0) {
    return res.status(400).json({
      error: `Mỗi mặt hàng lưu tối đa ${MAX_IMAGES} ảnh. Xoá một ảnh cũ trước khi thêm ảnh mới.`,
      code: 'IMAGE_LIMIT' });
  }
  let added = 0;
  let skipped = 0;
  tx(() => {
    for (const src of incoming.slice(0, room)) {
      const file = saveImageFile(src, pid);
      if (!file) { skipped++; continue; }
      run('INSERT INTO product_images(product_id, file, is_main, sort_order) VALUES(?, ?, 0, ?)',
        [pid, file, have + added]);
      added++;
    }
    fixMainImage(pid);
  });
  res.json({
    ok: true, added, skipped, images: imagesOf(pid),
    over_limit: incoming.length > room,
  });
});

r.put('/products/:id/images/:imgId/main', (req, res) => {
  const pid = Number(req.params.id);
  const img = get('SELECT * FROM product_images WHERE id = ? AND product_id = ?',
    [Number(req.params.imgId), pid]);
  if (!img) return res.status(404).json({ error: 'Không tìm thấy ảnh' });
  fixMainImage(pid, img.id);
  res.json({ ok: true, images: imagesOf(pid) });
});

r.delete('/products/:id/images/:imgId', (req, res) => {
  const pid = Number(req.params.id);
  const img = get('SELECT * FROM product_images WHERE id = ? AND product_id = ?',
    [Number(req.params.imgId), pid]);
  if (!img) return res.status(404).json({ error: 'Không tìm thấy ảnh' });
  run('DELETE FROM product_images WHERE id = ?', [img.id]);
  deleteImageFile(img.file);
  fixMainImage(pid);
  res.json({ ok: true, images: imagesOf(pid) });
});

r.post('/products', (req, res) => {
  const b = req.body;
  if (!b.name?.trim()) return res.status(400).json({ error: 'Thiếu tên sản phẩm' });
  /* Giá vốn ban đầu là con số BẮT BUỘC KHAI (tài liệu 13, mục 1.2): từ nay
     phiếu nhập không tự chốt giá vốn giúp nữa, nên không khai ở đây thì
     mặt hàng chạy với giá vốn 0 và mọi báo cáo lãi lỗ đều sai. Hàng dịch vụ
     khai 0 vẫn được — nhưng phải tự tay khai 0. */
  const costGiven = b.cost_price !== undefined && b.cost_price !== null && b.cost_price !== '';
  if (!costGiven) {
    return res.status(400).json({
      error: 'Bắt buộc khai giá vốn ban đầu. Hàng dịch vụ / tiền công thì ghi 0.',
      code: 'COST_REQUIRED' });
  }
  if (!(Number(b.cost_price) >= 0)) {
    return res.status(400).json({ error: 'Giá vốn ban đầu không được là số âm', code: 'COST_REQUIRED' });
  }
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
                             track_stock, min_stock, max_stock, brand, location, note, active,
                             cost_method, cost_fixed, warranty_months, warranty_note,
                             description, pack_spec, purchase_note)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sku, b.barcode || null, b.name.trim(), b.alias?.trim() || null, b.category_id || null, b.base_unit || 'Cái',
          Math.round(b.cost_price || 0), b.vat_rate ?? 8, b.track_stock === 0 ? 0 : 1,
          Number(b.min_stock) || 0, Number(b.max_stock) || 0,
          b.brand || null, b.location || null, b.note || null, b.active === 0 ? 0 : 1,
          normCostMethod(b.cost_method),
          /* Giá vốn khai lúc tạo hàng là con số đã chốt: phiếu nhập chỉ ghi đè
             khi người lập phiếu tự tích ô "Ghi đè giá vốn" (tài liệu 13) */
          1,
          Math.max(0, Math.round(Number(b.warranty_months) || 0)),
          String(b.warranty_note ?? '').trim() || null,
          String(b.description ?? '').trim() || null,
          String(b.pack_spec ?? '').trim() || null,
          /* Ưu đãi mặc định của mối, ví dụ "Mua 50 tặng 5" (tài liệu 18, vùng 1) */
          String(b.purchase_note ?? '').trim() || null]);
      const pid = Number(info.lastInsertRowid);
      saveUnitsAndPrices(pid, b.units, b.base_unit || 'Cái', b.pack_spec);
      saveDefaultUnits(pid, b, b.units);
      for (const src of (Array.isArray(b.images) ? b.images : []).slice(0, MAX_IMAGES)) {
        const file = saveImageFile(src, pid);
        if (file) run('INSERT INTO product_images(product_id, file, is_main, sort_order) VALUES(?, ?, 0, 0)', [pid, file]);
      }
      fixMainImage(pid);

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
    res.status(e.status || 400).json({ error: e.message, code: e.code });
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
             brand = ?, location = ?, note = ?, active = ?, cost_method = ?,
             warranty_months = COALESCE(?, warranty_months),
             warranty_note = CASE WHEN ? = 1 THEN ? ELSE warranty_note END,
             description = CASE WHEN ? = 1 THEN ? ELSE description END,
             pack_spec = CASE WHEN ? = 1 THEN ? ELSE pack_spec END,
             purchase_note = CASE WHEN ? = 1 THEN ? ELSE purchase_note END
           WHERE id = ?`,
        [b.barcode || null, b.name, b.alias?.trim() || null, b.category_id || null, b.base_unit || 'Cái',
          b.vat_rate ?? 8, b.track_stock === 0 ? 0 : 1,
          Number(b.min_stock) || 0, Number(b.max_stock) || 0,
          b.brand || null, b.location || null, b.note || null, b.active === 0 ? 0 : 1,
          normCostMethod(b.cost_method),
          /* Màn hình cũ không gửi hai ô bảo hành thì giữ nguyên giá trị đang có */
          b.warranty_months === undefined ? null : Math.max(0, Math.round(Number(b.warranty_months) || 0)),
          b.warranty_note === undefined ? 0 : 1, String(b.warranty_note ?? '').trim() || null,
          b.description === undefined ? 0 : 1, String(b.description ?? '').trim() || null,
          b.pack_spec === undefined ? 0 : 1, String(b.pack_spec ?? '').trim() || null,
          b.purchase_note === undefined ? 0 : 1, String(b.purchase_note ?? '').trim() || null,
          id]);
      saveUnitsAndPrices(Number(id), b.units, b.base_unit || 'Cái', b.pack_spec);
      if (b.sell_unit_id !== undefined || b.buy_unit_id !== undefined
        || b.sell_unit_index !== undefined || b.buy_unit_index !== undefined) {
        saveDefaultUnits(Number(id), b, b.units);
      }
    });
    res.json(hydrate(get('SELECT * FROM products WHERE id = ?', [id])));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
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
/* Sửa giá vốn bằng tay. Với hàng dùng giá vốn cố định thì đây là cách duy
   nhất để đổi con số đó, nên đánh dấu đã chốt luôn — lần nhập sau không
   được ghi đè lên con số chủ tiệm vừa gõ. */
r.put('/products/:id/cost', (req, res) => {
  const id = Number(req.params.id);
  const p = get('SELECT id, cost_method FROM products WHERE id = ?', [id]);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
  run('UPDATE products SET cost_price = ?, cost_fixed = 1 WHERE id = ?',
    [Math.round(Number(req.body.cost_price) || 0), id]);
  res.json({ ok: true, cost_price: costOf(id), method: costMethodOf(p) });
});

/**
 * Sửa nhanh giá bán ngay trên lưới Hàng hoá & Tồn kho (tài liệu 15, mục 1.2).
 * Không gửi bảng giá thì sửa bảng giá đầu tiên (giá lẻ); không gửi đơn vị thì
 * sửa giá của ĐƠN VỊ BÁN CHÍNH — đúng con số thu ngân nhìn thấy ngoài POS.
 */
r.put('/products/:id/price', (req, res) => {
  const id = Number(req.params.id);
  if (!get('SELECT id FROM products WHERE id = ?', [id])) {
    return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
  }
  const price = Math.round(Number(req.body.price) || 0);
  if (price < 0) return res.status(400).json({ error: 'Giá bán không được là số âm' });

  const unitId = Number(req.body.unit_id)
    || get(`SELECT COALESCE(p.sell_unit_id,
                   (SELECT id FROM product_units u WHERE u.product_id = p.id AND u.factor = 1 LIMIT 1)) AS id
            FROM products p WHERE p.id = ?`, [id])?.id;
  if (!unitId) return res.status(400).json({ error: 'Mặt hàng chưa có đơn vị tính nào' });
  const plId = Number(req.body.price_list_id)
    || get('SELECT id FROM price_lists ORDER BY id LIMIT 1')?.id;
  if (!plId) return res.status(400).json({ error: 'Chưa thiết lập bảng giá' });

  run(`INSERT INTO product_prices(product_id, price_list_id, unit_id, price) VALUES(?, ?, ?, ?)
       ON CONFLICT(product_id, price_list_id, unit_id) DO UPDATE SET price = excluded.price`,
    [id, plId, unitId, price]);
  res.json({ ok: true, price, unit_id: unitId, price_list_id: plId });
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
