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
  all, get, run, tx, nextCode, moveStock, costOf, pageParams, getSettings, searchWhere,
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
    const c = searchWhere(['rq.code', 'rq.note', 'u.full_name'], q, req.query.match);
    where.push(c.sql);
    params.push(...c.params);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { page, size, offset } = pageParams(req.query, 20);

  const total = get(`
    SELECT COUNT(*) AS n FROM requisitions rq
    LEFT JOIN users u ON u.id = rq.user_id ${w}`, params).n;

  const rows = all(`
    SELECT rq.*, u.full_name AS user_name, w.name AS warehouse_name,
           m.code AS merged_into_code,
           (SELECT COUNT(*) FROM requisition_items i WHERE i.requisition_id = rq.id) AS line_count,
           (SELECT COUNT(*) FROM requisition_items i
             WHERE i.requisition_id = rq.id AND i.adjusted = 1) AS adjusted_count,
           (SELECT COUNT(*) FROM requisition_items i
             WHERE i.requisition_id = rq.id AND i.buy_qty > 0) AS buy_count,
           (SELECT COUNT(*) FROM requisition_items i
             WHERE i.requisition_id = rq.id AND i.buy_qty > 0 AND i.split_at IS NOT NULL) AS split_count
    FROM requisitions rq
    LEFT JOIN users u ON u.id = rq.user_id
    LEFT JOIN warehouses w ON w.id = rq.warehouse_id
    LEFT JOIN requisitions m ON m.id = rq.merged_into
    ${w}
    ORDER BY rq.id DESC LIMIT ${size} OFFSET ${offset}`, params);

  /* Chặng vòng đời lập phiếu mua tạm — nhìn danh sách là biết phiếu nào còn
     dở dang, khỏi phải mở từng phiếu ra soát (tài liệu 15, mục 4.1) */
  for (const x of rows) {
    x.split_state = x.buy_count === 0 || x.split_count === 0 ? 'none'
      : x.split_count >= x.buy_count ? 'all' : 'partial';
    x.split_state_label = SPLIT_STATES[x.split_state];
  }
  const wantState = String(req.query.split_state || '');
  const out = SPLIT_STATES[wantState] ? rows.filter((x) => x.split_state === wantState) : rows;

  res.json({ rows: out, total, page, page_size: size });
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

/* ==================================================================== *
 * VÒNG ĐỜI PHIẾU (tài liệu 15, mục 4.1)
 *
 *   Chưa lập phiếu tạm  →  Đã lập một phần  →  Đã lập hết
 *
 * Tính trên những dòng CÓ SỐ DỰ MUA: dòng số mua 0 là dòng chỉ ghi nhận để
 * đếm lại, không có gì để chuyển sang phiếu mua.
 * ==================================================================== */

export const SPLIT_STATES = {
  none: 'Chưa lập phiếu tạm',
  partial: 'Đã lập một phần',
  all: 'Đã lập hết',
};

function splitStateOf(items) {
  const wanted = items.filter((x) => Number(x.buy_qty) > 0);
  if (!wanted.length) return 'none';
  const done = wanted.filter((x) => x.split_at).length;
  if (done === 0) return 'none';
  return done >= wanted.length ? 'all' : 'partial';
}

/**
 * Mối gợi ý cho một mặt hàng (tài liệu 15, mục 4.2).
 *
 * Ưu tiên 1 là mối ĐÃ TỪNG GIAO món này — đọc thẳng từ lịch sử phiếu nhập,
 * không chỉ dựa vào danh sách mối đã khai trong thẻ hàng hoá, vì mối giao
 * một lần rồi thường không ai khai vào thẻ.
 *
 * Giá gợi ý xếp theo: báo giá của mối > giá mối bán lần trước > giá nhập
 * gần nhất trên hệ thống > giá vốn.
 */
export function supplierOptions(productId) {
  const rows = all(`
    SELECT s.id AS supplier_id, s.name, s.phone, s.active,
           ps.is_primary, ps.last_price, ps.supplier_sku, ps.quote_price, ps.quote_at,
           (SELECT COUNT(*) FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
             WHERE pi.product_id = ? AND pu.supplier_id = s.id AND pu.status = 'done') AS times,
           (SELECT CAST(ROUND(pi.price * 1.0 / COALESCE(NULLIF(pi.factor, 0), 1)) AS INTEGER)
              FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
             WHERE pi.product_id = ? AND pu.supplier_id = s.id AND pu.status = 'done'
             ORDER BY pu.ts DESC, pi.id DESC LIMIT 1) AS last_purchase_price,
           (SELECT MAX(pu.ts) FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
             WHERE pi.product_id = ? AND pu.supplier_id = s.id AND pu.status = 'done') AS last_ts
    FROM suppliers s
    LEFT JOIN product_suppliers ps ON ps.supplier_id = s.id AND ps.product_id = ?
    WHERE s.active = 1
      AND (ps.id IS NOT NULL
           OR EXISTS (SELECT 1 FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
                       WHERE pi.product_id = ? AND pu.supplier_id = s.id AND pu.status = 'done'))
    ORDER BY times DESC, ps.is_primary DESC, s.name`,
  [productId, productId, productId, productId, productId]);
  for (const x of rows) x.supplied_before = Number(x.times) > 0;
  return rows;
}

/**
 * Giá đổ vào phiếu mua tạm (tài liệu 15, mục 4.3).
 * Có báo giá của mối thì LẤY ĐÚNG con số đó; chưa có thì rơi về giá mua gần
 * nhất của mối, rồi giá nhập gần nhất của hệ thống, cuối cùng là giá vốn.
 */
export function injectedPrice(productId, supplierId, costPrice = 0, itemId = null) {
  /* Kế toán vừa gõ báo giá ngay trên phiếu thì lấy ĐÚNG con số đó — đó là
     giá mối báo hôm nay, mới hơn mọi thứ đang lưu (tài liệu 17, mục 2.2). */
  if (itemId) {
    const typed = get(`SELECT quote_price FROM requisition_item_suppliers
                       WHERE item_id = ? AND supplier_id = ?`, [itemId, supplierId])?.quote_price;
    if (Number(typed) > 0) return { price: Number(typed), source: 'typed_quote' };
  }
  const link = get(`SELECT quote_price, last_price FROM product_suppliers
                    WHERE product_id = ? AND supplier_id = ?`, [productId, supplierId]);
  if (Number(link?.quote_price) > 0) {
    return { price: Number(link.quote_price), source: 'quote' };
  }
  if (Number(link?.last_price) > 0) {
    return { price: Number(link.last_price), source: 'last_supplier_price' };
  }
  const last = get(`
    SELECT CAST(ROUND(pi.price * 1.0 / COALESCE(NULLIF(pi.factor, 0), 1)) AS INTEGER) AS p
    FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
    WHERE pi.product_id = ? AND pu.status = 'done'
    ORDER BY pu.ts DESC, pi.id DESC LIMIT 1`, [productId])?.p;
  if (Number(last) > 0) return { price: Number(last), source: 'last_purchase' };
  return { price: Math.max(0, Math.round(Number(costPrice) || 0)), source: 'cost' };
}

function detail(id) {
  const rq = get(`
    SELECT rq.*, u.full_name AS user_name, w.name AS warehouse_name,
           m.code AS merged_into_code
    FROM requisitions rq
    LEFT JOIN users u ON u.id = rq.user_id
    LEFT JOIN warehouses w ON w.id = rq.warehouse_id
    LEFT JOIN requisitions m ON m.id = rq.merged_into
    WHERE rq.id = ?`, [id]);
  if (!rq) return null;

  rq.items = all(`
    SELECT i.*, p.sku, p.base_unit, p.barcode, p.cost_price, p.pack_spec,
           c.name AS category_name,
           d.code AS split_draft_code,
           COALESCE((SELECT SUM(s.qty) FROM stock s
                      WHERE s.product_id = i.product_id AND s.warehouse_id = ?), 0) AS stock_now
    FROM requisition_items i
    LEFT JOIN products p ON p.id = i.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN doc_drafts d ON d.id = i.split_draft_id
    WHERE i.requisition_id = ? ORDER BY i.id`, [rq.warehouse_id, id]);

  /* Mối nào bán món này, và mối nào đang được chọn trên phiếu */
  for (const it of rq.items) {
    it.suppliers = supplierOptions(it.product_id);
    const picked = all(`SELECT supplier_id, quote_price FROM requisition_item_suppliers
                        WHERE item_id = ?`, [it.id]);
    it.chosen = picked.map((x) => x.supplier_id);
    /* Báo giá kế toán gõ thẳng trên phiếu cho từng mối (tài liệu 17, mục 2.2) */
    it.quotes = Object.fromEntries(picked
      .filter((x) => Number(x.quote_price) > 0)
      .map((x) => [x.supplier_id, x.quote_price]));
    /* Đã chuyển sang phiếu mua tạm thì KHOÁ: không sửa số, không lập lại */
    it.locked = !!it.split_at;
  }
  rq.split_state = splitStateOf(rq.items);
  rq.split_state_label = SPLIT_STATES[rq.split_state];

  /* Phiếu nhập tạm đã sinh ra từ phiếu này */
  rq.drafts = all(`
    SELECT id, code, kind, title, partner_name, item_count, total, updated_at
    FROM doc_drafts WHERE source = ? ORDER BY id`, [`req:${id}`]);
  /* Phiếu lẻ đã gộp vào phiếu này */
  rq.merged_from = all('SELECT id, code, ts FROM requisitions WHERE merged_into = ? ORDER BY id', [id]);
  return rq;
}

/** Danh sách mối gợi ý cho một mặt hàng — hộp chọn NCC hàng loạt gọi tới. */
r.get('/requisition-supplier-options', (req, res) => {
  const pid = Number(req.query.product_id) || 0;
  if (!pid) return res.status(400).json({ error: 'Thiếu mã mặt hàng' });
  res.json({ rows: supplierOptions(pid) });
});

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
    /* Đã chuyển sang phiếu mua tạm thì khoá cứng (tài liệu 15, mục 4.4): sửa
       số hay lập lại lần nữa là tiệm đặt mua trùng, mà không ai thấy. */
    if (it.split_at) {
      throw badRequest(
        `"${it.name_snapshot}" đã chuyển sang phiếu mua tạm nên không sửa được nữa.`
        + ' Muốn đổi số lượng thì sửa ngay trên phiếu mua tạm đó.',
        'ITEM_LOCKED');
    }

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
        /* Giữ lại báo giá đã gõ cho những mối vẫn còn được chọn */
        const keep = new Map(all(`SELECT supplier_id, quote_price FROM requisition_item_suppliers
                                  WHERE item_id = ?`, [it.id]).map((x) => [x.supplier_id, x.quote_price]));
        run('DELETE FROM requisition_item_suppliers WHERE item_id = ?', [it.id]);
        for (const sid of [...new Set(b.supplier_ids.map(Number).filter(Boolean))]) {
          run(`INSERT OR IGNORE INTO requisition_item_suppliers(item_id, supplier_id, quote_price)
               VALUES(?, ?, ?)`, [it.id, sid, keep.get(sid) ?? null]);
        }
      }
      /* Gõ báo giá mới cho một mối: { supplier_id, quote_price }.
         Gõ 0 hoặc để trống là xoá báo giá, quay về giá nhập mặc định. */
      if (b.quote && Number(b.quote.supplier_id)) {
        const sid = Number(b.quote.supplier_id);
        const price = Math.max(0, Math.round(Number(b.quote.quote_price) || 0));
        run('INSERT OR IGNORE INTO requisition_item_suppliers(item_id, supplier_id) VALUES(?, ?)',
          [it.id, sid]);
        run(`UPDATE requisition_item_suppliers SET quote_price = ?
             WHERE item_id = ? AND supplier_id = ?`, [price > 0 ? price : null, it.id, sid]);
      }
      return detail(Number(req.params.id));
    });
    res.json(out);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

/**
 * Gán một nhà cung cấp cho NHIỀU dòng cùng lúc (tài liệu 15, mục 4.2).
 * Tích chọn cả trang rồi gán một mối — nhanh hơn mở từng dòng.
 * replace = true thì thay hẳn danh sách mối của dòng đó.
 */
r.post('/requisitions/:id/assign-supplier', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!get('SELECT id FROM requisitions WHERE id = ?', [id])) {
      throw badRequest('Không tìm thấy phiếu báo hết hàng');
    }
    const supplierId = Number(req.body.supplier_id) || 0;
    const sup = supplierId ? get('SELECT id, name FROM suppliers WHERE id = ?', [supplierId]) : null;
    if (!sup) throw badRequest('Chưa chọn nhà cung cấp');
    const wanted = Array.isArray(req.body.item_ids)
      ? req.body.item_ids.map(Number).filter(Boolean) : [];
    if (!wanted.length) throw badRequest('Chưa chọn dòng hàng nào để gán nhà cung cấp');
    const quote = Math.max(0, Math.round(Number(req.body.quote_price) || 0));

    const out = tx(() => {
      const assigned = [];
      const locked = [];
      for (const itemId of wanted) {
        const it = get('SELECT * FROM requisition_items WHERE id = ? AND requisition_id = ?',
          [itemId, id]);
        if (!it) continue;
        if (it.split_at) { locked.push(it.name_snapshot); continue; }
        if (req.body.replace === true) {
          run('DELETE FROM requisition_item_suppliers WHERE item_id = ?', [it.id]);
        }
        run('INSERT OR IGNORE INTO requisition_item_suppliers(item_id, supplier_id) VALUES(?, ?)',
          [it.id, sup.id]);
        /* Gán hàng loạt kèm luôn một mức báo giá chung, nếu kế toán có gõ */
        if (quote > 0) {
          run(`UPDATE requisition_item_suppliers SET quote_price = ?
               WHERE item_id = ? AND supplier_id = ?`, [quote, it.id, sup.id]);
        }
        assigned.push(it.name_snapshot);
      }
      return {
        ok: true, supplier: sup, assigned: assigned.length, locked,
        requisition: detail(id),
      };
    });
    res.json(out);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

/**
 * Gộp nhiều phiếu báo hết hàng lẻ thành một phiếu tổng (tài liệu 15, mục 4.4).
 *
 * Cùng một mặt hàng xuất hiện ở hai phiếu thì CỘNG số dự mua lại — hai lần
 * báo thiếu trong tuần là thiếu thật hai lần đó. Dòng đã chuyển sang phiếu
 * mua tạm thì không gộp: đã đặt mua rồi, gộp vào là đặt lần nữa.
 */
r.post('/requisitions/merge', (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (ids.length < 2) throw badRequest('Chọn ít nhất 2 phiếu để gộp');
    const sources = ids.map((id) => get('SELECT * FROM requisitions WHERE id = ?', [id])).filter(Boolean);
    if (sources.length < 2) throw badRequest('Không tìm thấy đủ phiếu để gộp');
    const already = sources.find((x) => x.merged_into);
    if (already) throw badRequest(`Phiếu ${already.code} đã được gộp vào phiếu khác rồi.`, 'ALREADY_MERGED');
    const warehouses = [...new Set(sources.map((x) => x.warehouse_id))];
    if (warehouses.length > 1) {
      throw badRequest('Chỉ gộp được các phiếu của cùng một kho.', 'MIXED_WAREHOUSE');
    }

    const out = tx(() => {
      const code = nextCode('requisitions', 'BH');
      const info = run(`
        INSERT INTO requisitions(code, warehouse_id, user_id, status, note)
        VALUES(?, ?, ?, 'open', ?)`,
        [code, warehouses[0], req.body.user_id || null,
          `Gộp từ ${sources.map((x) => x.code).join(', ')}`]);
      const newId = Number(info.lastInsertRowid);

      const byProduct = new Map();
      const skipped = [];
      for (const src of sources) {
        const items = all('SELECT * FROM requisition_items WHERE requisition_id = ? ORDER BY id', [src.id]);
        for (const it of items) {
          if (it.split_at) { skipped.push(`${it.name_snapshot} (${src.code})`); continue; }
          const cur = byProduct.get(it.product_id);
          const chosen = all('SELECT supplier_id FROM requisition_item_suppliers WHERE item_id = ?',
            [it.id]).map((x) => x.supplier_id);
          if (cur) {
            cur.buy_qty += Number(it.buy_qty) || 0;
            /* Số đếm thật: lần đếm SAU đè lên lần trước, vì đó là số mới nhất */
            if (it.actual_qty !== null && it.actual_qty !== undefined) cur.actual_qty = it.actual_qty;
            cur.notes.push(...(it.note ? [it.note] : []));
            for (const s of chosen) cur.chosen.add(s);
          } else {
            byProduct.set(it.product_id, {
              product_id: it.product_id, name: it.name_snapshot, unit_name: it.unit_name,
              system_qty: it.system_qty, actual_qty: it.actual_qty,
              buy_qty: Number(it.buy_qty) || 0,
              notes: it.note ? [it.note] : [], chosen: new Set(chosen),
            });
          }
        }
      }
      if (!byProduct.size) throw badRequest('Các phiếu đã chọn không còn dòng nào để gộp.');

      for (const x of byProduct.values()) {
        const line = run(`
          INSERT INTO requisition_items(requisition_id, product_id, name_snapshot, unit_name,
                                        system_qty, actual_qty, buy_qty, note)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
          [newId, x.product_id, x.name, x.unit_name, x.system_qty, x.actual_qty, x.buy_qty,
            x.notes.length ? [...new Set(x.notes)].join(' · ') : null]);
        const itemId = Number(line.lastInsertRowid);
        for (const sid of x.chosen) {
          run('INSERT OR IGNORE INTO requisition_item_suppliers(item_id, supplier_id) VALUES(?, ?)',
            [itemId, sid]);
        }
      }

      /* Phiếu lẻ đóng lại và trỏ về phiếu tổng: còn tra lại được, nhưng không
         ai lập phiếu mua từ nó lần nữa. */
      for (const src of sources) {
        run(`UPDATE requisitions SET status = 'done', merged_into = ?,
               closed_at = datetime('now','localtime'),
               note = TRIM(COALESCE(note, '') || ' · Đã gộp vào ' || ?)
             WHERE id = ?`, [newId, code, src.id]);
      }
      return {
        ok: true, requisition: detail(newId),
        merged: sources.map((x) => x.code), skipped, line_count: byProduct.size,
      };
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
  if (it.split_at) {
    return res.status(400).json({
      error: `"${it.name_snapshot}" đã chuyển sang phiếu mua tạm nên không xoá được khỏi phiếu này.`,
      code: 'ITEM_LOCKED' });
  }
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
    const locked = [];
    const takenIds = new Set();

    for (const it of rq.items) {
      if (only && !only.has(it.id)) continue;
      if (!(Number(it.buy_qty) > 0)) continue;
      /* Đã lập phiếu mua tạm rồi thì BỎ QUA, không lập lần thứ hai — chốt
         chống trùng của tài liệu 15, mục 4.4 */
      if (it.split_at) { locked.push(it.name_snapshot); continue; }
      if (!it.chosen.length) { noSupplier.push(it.name_snapshot); continue; }
      if (it.chosen.length > 1) {
        duplicated.push({ name: it.name_snapshot, qty: it.buy_qty, suppliers: it.chosen.length });
      }
      takenIds.add(it.id);
      for (const sid of it.chosen) {
        if (!bySupplier.has(sid)) bySupplier.set(sid, []);
        bySupplier.get(sid).push(it);
      }
    }

    if (!bySupplier.size) {
      throw badRequest(noSupplier.length
        ? `Chưa chọn nhà cung cấp cho: ${noSupplier.slice(0, 3).join(', ')}`
          + (noSupplier.length > 3 ? `... và ${noSupplier.length - 3} món nữa` : '')
        : locked.length
          ? `Những món đã chọn đều đã chuyển sang phiếu mua tạm: ${locked.slice(0, 3).join(', ')}`
            + (locked.length > 3 ? `... và ${locked.length - 3} món nữa` : '')
          : 'Không có dòng nào có số lượng dự mua để tách phiếu.');
    }

    const out = tx(() => {
      const drafts = [];
      for (const [supplierId, items] of bySupplier) {
        const sup = get('SELECT * FROM suppliers WHERE id = ?', [supplierId]);
        if (!sup) continue;

        const lines = items.map((it) => {
          /* Đổ giá tự động (tài liệu 15, mục 4.3): ưu tiên báo giá của mối,
             rồi giá mối bán lần trước, rồi giá nhập gần nhất, rồi giá vốn.
             Chỉ là con số đổ sẵn — người lập phiếu nhập vẫn sửa lại được. */
          const inj = injectedPrice(it.product_id, supplierId, it.cost_price, it.id);
          /* Kèm luôn danh sách đơn vị: biểu mẫu phiếu nhập cần nó để vẽ
             ô chọn cái / hộp / thùng. Thiếu là biểu mẫu nổ khi mở lại.
             Đơn vị đã ngừng hoạt động không đưa vào — không nhập mới bằng nó. */
          const units = all(`SELECT * FROM product_units WHERE product_id = ? AND active = 1
                             ORDER BY factor`, [it.product_id]);
          /* Nhảy sẵn ĐƠN VỊ MUA CHÍNH của mặt hàng (tài liệu 13, mục 1.3) */
          const buyId = get('SELECT buy_unit_id FROM products WHERE id = ?', [it.product_id])?.buy_unit_id;
          const buyUnit = units.find((u) => u.id === buyId)
            || units.find((u) => u.factor === 1) || units[0] || null;
          const factor = buyUnit?.factor || 1;
          /* Giá báo tính theo đơn vị cơ bản; nhảy sang đơn vị lớn thì nhân lên */
          const price = Math.round(inj.price * factor);
          return {
            key: `req-${it.id}-${supplierId}`,
            product_id: it.product_id,
            name: it.name_snapshot,
            sku: it.sku,
            base_unit: it.base_unit,
            pack_spec: it.pack_spec || null,
            units,
            unit_id: buyUnit?.id ?? null,
            unit_name: buyUnit?.unit_name || it.unit_name,
            factor,
            current_stock: it.stock_now,
            discount: 0,
            qty: Number(it.buy_qty),
            price,
            list_price: price,
            price_source: inj.source,
            discount_percent: 0,
            vat_rate: 0,
            overwrite_cost: false,
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
        const draftId = Number(info.lastInsertRowid);
        drafts.push({
          id: draftId, code, supplier_id: supplierId,
          supplier_name: sup.name, item_count: lines.length, total,
        });
        /* Khoá từng dòng vừa chuyển đi, ghi luôn số phiếu tạm nó rơi vào.
           Một món chọn hai mối thì nhớ phiếu đầu — dòng nào cũng khoá. */
        for (const it of items) {
          run(`UPDATE requisition_items
                 SET split_at = datetime('now','localtime'),
                     split_draft_id = COALESCE(split_draft_id, ?)
               WHERE id = ? AND split_at IS NULL`, [draftId, it.id]);
        }
      }
      run("UPDATE requisitions SET split_at = datetime('now','localtime') WHERE id = ?", [id]);
      const after = detail(id);
      return {
        ok: true, drafts, no_supplier: noSupplier, duplicated, locked,
        split_state: after.split_state, requisition: after,
      };
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
