import { Router } from 'express';
import {
  all, get, run, tx, nextCode, moveStock, updateAvgCost, reverseAvgCost, overwriteCost,
  addCashTx, defaultCashAccount, supplierDebt, costOf, pageParams, resolveUnitId,
  searchMode } from '../db.js';

const r = Router();

const badRequest = (message, code) => Object.assign(new Error(message), { status: 400, code });

/* =========================== PHIẾU NHẬP HÀNG ======================== */

r.get('/purchases', (req, res) => {
  const { q = '', supplier_id, from, to, status, unpaid, match = 'contains' } = req.query;
  const where = [];
  const params = [];
  if (q.trim()) {
    where.push('(p.code LIKE ? OR s.name LIKE ? OR p.supplier_invoice LIKE ?)');
    const like = searchMode(match) === 'exact' ? q.trim() : `%${q.trim()}%`;
    params.push(like, like, like);
  }
  if (supplier_id) { where.push('p.supplier_id = ?'); params.push(supplier_id); }
  if (from) { where.push('date(p.ts) >= date(?)'); params.push(from); }
  if (to) { where.push('date(p.ts) <= date(?)'); params.push(to); }
  if (status) { where.push('p.status = ?'); params.push(status); }
  if (unpaid === '1') where.push('p.total > p.paid');

  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { page, size, offset } = pageParams(req.query);
  const total = get(`
    SELECT COUNT(*) AS n
    FROM purchases p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN warehouses w ON w.id = p.warehouse_id
    LEFT JOIN users u ON u.id = p.user_id
    ${w}`, params).n;

  const rows = all(`
    SELECT p.*, s.name AS supplier_name, s.code AS supplier_code,
           w.name AS warehouse_name, u.full_name AS user_name,
           (p.total - p.paid) AS remaining,
           (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS item_count,
           (SELECT COUNT(*) FROM purchase_custom_items ci WHERE ci.purchase_id = p.id) AS custom_count
    FROM purchases p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN warehouses w ON w.id = p.warehouse_id
    LEFT JOIN users u ON u.id = p.user_id
    ${w}
    ORDER BY p.id DESC LIMIT ${size} OFFSET ${offset}`, params);
  /* Tổng của cả bộ lọc, chỉ tính phiếu còn hiệu lực (bỏ phiếu đã huỷ) */
  const sums = get(`
    SELECT COUNT(*) AS count,
           COALESCE(SUM(p.total), 0) AS total,
           COALESCE(SUM(p.paid), 0) AS paid,
           COALESCE(SUM(MAX(p.total - p.paid, 0)), 0) AS unpaid
    FROM purchases p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    ${w ? w + " AND p.status = 'done'" : "WHERE p.status = 'done'"}`, params);
  res.json({ rows, total, page, page_size: size, totals: sums });
});

/**
 * Số lượng đã trả NCC của từng dòng phiếu nhập. Phiếu trả cũ (trước đợt 14)
 * chưa ghi số dòng thì ghép theo mặt hàng + đơn vị.
 */
function returnedByPurchaseLine(purchaseId, lines) {
  const done = new Map(lines.map((l) => [l.id, 0]));
  const rows = all(`
    SELECT ri.purchase_item_id, ri.product_id, ri.unit_name, ri.qty
    FROM purchase_return_items ri JOIN purchase_returns pr ON pr.id = ri.return_id
    WHERE pr.purchase_id = ?`, [purchaseId]);
  for (const x of rows) {
    const line = x.purchase_item_id
      ? lines.find((l) => l.id === x.purchase_item_id)
      : lines.find((l) => l.product_id === x.product_id && l.unit_name === x.unit_name);
    if (line) done.set(line.id, (done.get(line.id) || 0) + x.qty);
  }
  return done;
}

/** Số lượng đã trả của từng món giao sai. */
function returnedByCustomItem(purchaseId) {
  return new Map(all(`
    SELECT rc.custom_item_id AS id, SUM(rc.qty) AS qty
    FROM purchase_return_custom_items rc
    JOIN purchase_custom_items ci ON ci.id = rc.custom_item_id
    WHERE ci.purchase_id = ? GROUP BY rc.custom_item_id`, [purchaseId]).map((x) => [x.id, x.qty]));
}

/** Đơn giá nhập thực tế của một dòng: sau chiết khấu dòng. */
const netPrice = (line) => (line.qty > 0 ? Math.round(line.amount / line.qty) : line.price);

r.get('/purchases/:id', (req, res) => {
  const p = get(`
    SELECT p.*, s.name AS supplier_name, s.code AS supplier_code, s.phone AS supplier_phone,
           s.address AS supplier_address, s.tax_code AS supplier_tax_code,
           w.name AS warehouse_name, u.full_name AS user_name
    FROM purchases p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN warehouses w ON w.id = p.warehouse_id
    LEFT JOIN users u ON u.id = p.user_id
    WHERE p.id = ?`, [req.params.id]);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy phiếu nhập' });
  p.items = all(`
    SELECT pi.*, pr.name AS product_name, pr.sku, pr.base_unit, pr.barcode, pr.track_stock
    FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id
    WHERE pi.purchase_id = ? ORDER BY pi.id`, [p.id]);
  const done = returnedByPurchaseLine(p.id, p.items);
  for (const it of p.items) {
    it.net_price = netPrice(it);
    it.returned_qty = done.get(it.id) || 0;
    it.returnable_qty = Math.max(0, it.qty - it.returned_qty);
  }
  /* Hàng giao sai / ngoài danh mục: không vào kho, chỉ để ghi đúng tiền và trả lại NCC */
  const cdone = returnedByCustomItem(p.id);
  p.custom_items = all('SELECT * FROM purchase_custom_items WHERE purchase_id = ? ORDER BY id', [p.id]);
  for (const ci of p.custom_items) {
    ci.returned_qty = cdone.get(ci.id) || 0;
    ci.returnable_qty = Math.max(0, ci.qty - ci.returned_qty);
  }
  p.returns = all('SELECT id, code, ts, subtotal, expense, total, refunded FROM purchase_returns WHERE purchase_id = ? ORDER BY id', [p.id]);
  res.json(p);
});

/**
 * Tạo phiếu nhập.
 * items:        [{ product_id, unit_name, factor, qty, price, discount, vat_rate }]
 * custom_items: [{ name, unit_name, qty, price, note }] — hàng giao sai / ngoài
 *               danh mục: KHÔNG cộng kho, không sinh mã hàng, nhưng tiền vẫn
 *               tính vào phiếu để ghi đúng công nợ với NCC (tài liệu 11).
 * qty & price tính theo unit_name; tồn kho ghi theo qty * factor.
 */
r.post('/purchases', (req, res) => {
  const b = req.body;
  const items = Array.isArray(b.items) ? b.items.filter((i) => Number(i.qty) > 0 && Number(i.product_id)) : [];
  const custom = (Array.isArray(b.custom_items) ? b.custom_items : [])
    .map((c) => ({
      name: String(c?.name ?? '').trim(),
      unit_name: String(c?.unit_name ?? '').trim() || null,
      qty: Number(c?.qty) || 0,
      price: Math.max(0, Math.round(Number(c?.price) || 0)),
      note: String(c?.note ?? '').trim() || null,
    }))
    .filter((c) => c.qty > 0);
  if (custom.some((c) => !c.name)) {
    return res.status(400).json({ error: 'Hàng giao sai phải ghi tên hàng để còn đối chiếu lúc trả lại NCC.', code: 'CUSTOM_NAME_REQUIRED' });
  }
  if (!items.length && !custom.length) return res.status(400).json({ error: 'Phiếu nhập phải có ít nhất 1 mặt hàng' });

  const warehouseId = Number(b.warehouse_id) || get('SELECT id FROM warehouses WHERE is_default = 1')?.id;
  if (!warehouseId) return res.status(400).json({ error: 'Chưa thiết lập kho' });

  try {
    const result = tx(() => {
      let stockSubtotal = 0;
      let vatAmount = 0;
      for (const it of items) {
        const qty = Number(it.qty);
        const price = Math.round(Number(it.price) || 0);
        const disc = Math.round(Number(it.discount) || 0);
        const amount = Math.round(qty * price - disc);
        it._amount = amount;
        stockSubtotal += amount;
        vatAmount += Math.round(amount * (Number(it.vat_rate) || 0) / 100);
      }
      for (const c of custom) c.amount = Math.round(c.qty * c.price);
      const customTotal = custom.reduce((a, c) => a + c.amount, 0);
      const subtotal = stockSubtotal + customTotal;
      const discount = Math.round(Number(b.discount) || 0);
      const otherCost = Math.round(Number(b.other_cost) || 0);
      const total = subtotal - discount + vatAmount + otherCost;
      const paid = Math.min(Math.round(Number(b.paid) || 0), total);
      const code = b.code?.trim() || nextCode('purchases', 'PN');

      const info = run(`
        INSERT INTO purchases(code, ts, supplier_id, warehouse_id, user_id, subtotal, discount,
                              vat_amount, other_cost, total, paid, status, supplier_invoice, due_date, note)
        VALUES(?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?, ?, ?, ?, ?, ?, 'done', ?, ?, ?)`,
        [code, b.ts || null, b.supplier_id || null, warehouseId, b.user_id || null,
          subtotal, discount, vatAmount, otherCost, total, paid,
          b.supplier_invoice || null, b.due_date || null, b.note || null]);
      const purchaseId = Number(info.lastInsertRowid);

      /* Chi phí khác chỉ phân bổ vào hàng thật sự vào kho — hàng giao sai
         không nằm trong kho thì không có giá vốn để gánh phần chi phí đó */
      for (const it of items) {
        const qty = Number(it.qty);
        const factor = Number(it.factor) || 1;
        const qtyBase = qty * factor;
        const share = stockSubtotal > 0 ? (it._amount / stockSubtotal) * otherCost : 0;
        const unitCostBase = qtyBase > 0 ? Math.round((it._amount + share) / qtyBase) : 0;

        /* price là giá SAU chiết khấu — chính nó đi vào giá vốn.
           list_price giữ giá mối báo, để mở lại phiếu còn đối chiếu được. */
        /* Ghi đè giá vốn: người lập phiếu tích ô ở dòng này, hoặc tích ô
           "Ghi đè giá vốn toàn bộ" trên thanh tiêu đề (tài liệu 13, mục 1.2) */
        const overwrite = b.overwrite_cost_all === true || it.overwrite_cost === true
          || it.overwrite_cost === 1;

        run(`INSERT INTO purchase_items(purchase_id, product_id, unit_id, unit_name, factor, qty, price,
                                        discount, vat_rate, amount, list_price, discount_percent,
                                        overwrite_cost)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [purchaseId, it.product_id, resolveUnitId(it.product_id, it.unit_id, it.unit_name),
            it.unit_name, factor, qty,
            Math.round(Number(it.price) || 0), Math.round(Number(it.discount) || 0),
            Number(it.vat_rate) || 0, it._amount,
            Math.round(Number(it.list_price) || Number(it.price) || 0),
            Number(it.discount_percent) || 0,
            overwrite ? 1 : 0]);

        moveStock({
          productId: it.product_id, warehouseId, qtyChange: qtyBase,
          unitCost: unitCostBase, refType: 'purchase', refId: purchaseId, refCode: code,
          note: `Nhập ${qty} ${it.unit_name}`, ts: b.ts || null,
        });
        /* Tích ô ghi đè thì lấy đúng đơn giá nhập lần này làm giá vốn; không
           tích thì để luật giá vốn của mặt hàng tự lo (bình quân gia quyền,
           hoặc giá cố định thì không đụng tới). */
        if (overwrite) overwriteCost(it.product_id, unitCostBase);
        else updateAvgCost(it.product_id, qtyBase, unitCostBase);
      }

      for (const c of custom) {
        run(`INSERT INTO purchase_custom_items(purchase_id, name, unit_name, qty, price, amount, note)
             VALUES(?, ?, ?, ?, ?, ?, ?)`,
          [purchaseId, c.name, c.unit_name, c.qty, c.price, c.amount, c.note]);
      }

      // Ghi phiếu chi nếu có thanh toán ngay
      if (paid > 0) {
        const accountId = Number(b.account_id) || defaultCashAccount();
        const sup = b.supplier_id ? get('SELECT name FROM suppliers WHERE id = ?', [b.supplier_id]) : null;
        if (accountId) {
          addCashTx({
            accountId, direction: 'out', amount: paid, category: 'purchase',
            partnerType: 'supplier', partnerId: b.supplier_id || null,
            partnerName: sup?.name || 'Khách lẻ',
            refType: 'purchase', refId: purchaseId, refCode: code,
            userId: b.user_id || null, note: `Thanh toán phiếu nhập ${code}`, ts: b.ts || null,
          });
        }
      }
      return { id: purchaseId, code, total, custom_total: customTotal };
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

/** Thanh toán thêm cho một phiếu nhập. */
r.post('/purchases/:id/pay', (req, res) => {
  const p = get('SELECT * FROM purchases WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy phiếu nhập' });
  const amount = Math.round(Number(req.body.amount) || 0);
  const remaining = p.total - p.paid;
  if (amount <= 0) return res.status(400).json({ error: 'Số tiền phải lớn hơn 0' });
  if (amount > remaining) return res.status(400).json({ error: `Còn nợ ${remaining.toLocaleString('vi-VN')} đ, không thể trả nhiều hơn.` });

  const accountId = Number(req.body.account_id) || defaultCashAccount();
  if (!accountId) return res.status(400).json({ error: 'Chưa thiết lập quỹ tiền' });
  const sup = p.supplier_id ? get('SELECT name FROM suppliers WHERE id = ?', [p.supplier_id]) : null;

  tx(() => {
    run('UPDATE purchases SET paid = paid + ? WHERE id = ?', [amount, p.id]);
    addCashTx({
      accountId, direction: 'out', amount, category: 'purchase',
      partnerType: 'supplier', partnerId: p.supplier_id, partnerName: sup?.name,
      refType: 'purchase', refId: p.id, refCode: p.code,
      note: req.body.note || `Thanh toán phiếu nhập ${p.code}`,
    });
  });
  res.json({ ok: true, purchase: get('SELECT * FROM purchases WHERE id = ?', [p.id]) });
});

/** Huỷ phiếu nhập: hoàn tồn kho, ghi bút toán ngược quỹ. */
r.post('/purchases/:id/cancel', (req, res) => {
  const p = get('SELECT * FROM purchases WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy phiếu nhập' });
  if (p.status === 'cancelled') return res.status(400).json({ error: 'Phiếu này đã bị huỷ' });

  const items = all('SELECT * FROM purchase_items WHERE purchase_id = ?', [p.id]);
  // Không cho huỷ nếu sẽ làm tồn kho âm
  for (const it of items) {
    const qtyBase = it.qty * it.factor;
    const st = get('SELECT qty FROM stock WHERE product_id = ? AND warehouse_id = ?',
      [it.product_id, p.warehouse_id]);
    const trackable = get('SELECT track_stock, name FROM products WHERE id = ?', [it.product_id]);
    if (trackable?.track_stock && (st?.qty ?? 0) < qtyBase) {
      return res.status(400).json({
        error: `Không thể huỷ: "${trackable.name}" chỉ còn ${st?.qty ?? 0} trong kho, cần trả lại ${qtyBase}. Hàng đã bán ra rồi.`,
      });
    }
  }

  tx(() => {
    for (const it of items) {
      moveStock({
        productId: it.product_id, warehouseId: p.warehouse_id,
        qtyChange: -(it.qty * it.factor), unitCost: costOf(it.product_id),
        refType: 'purchase', refId: p.id, refCode: p.code, note: `Huỷ phiếu nhập ${p.code}`,
      });
    }
    if (p.paid > 0) {
      const accountId = defaultCashAccount();
      const sup = p.supplier_id ? get('SELECT name FROM suppliers WHERE id = ?', [p.supplier_id]) : null;
      if (accountId) {
        addCashTx({
          accountId, direction: 'in', amount: p.paid, category: 'purchase',
          partnerType: 'supplier', partnerId: p.supplier_id, partnerName: sup?.name,
          refType: 'purchase', refId: p.id, refCode: p.code,
          note: `Hoàn tiền do huỷ phiếu nhập ${p.code}`,
        });
      }
    }
    run("UPDATE purchases SET status = 'cancelled', paid = 0 WHERE id = ?", [p.id]);
  });
  res.json({ ok: true });
});

/* ======================= TRẢ HÀNG NHÀ CUNG CẤP ====================== */

r.get('/purchase-returns', (req, res) => {
  const { from, to, supplier_id } = req.query;
  const where = [];
  const params = [];
  if (supplier_id) { where.push('pr.supplier_id = ?'); params.push(supplier_id); }
  if (from) { where.push('date(pr.ts) >= date(?)'); params.push(from); }
  if (to) { where.push('date(pr.ts) <= date(?)'); params.push(to); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { page, size, offset } = pageParams(req.query);
  const total = get(`
    SELECT COUNT(*) AS n
    FROM purchase_returns pr
    LEFT JOIN suppliers s ON s.id = pr.supplier_id
    LEFT JOIN purchases p ON p.id = pr.purchase_id
    LEFT JOIN warehouses w ON w.id = pr.warehouse_id
    ${w}`, params).n;

  const rows = all(`
    SELECT pr.*, s.name AS supplier_name, p.code AS purchase_code, w.name AS warehouse_name,
           (SELECT COUNT(*) FROM purchase_return_custom_items rc WHERE rc.return_id = pr.id) AS custom_count
    FROM purchase_returns pr
    LEFT JOIN suppliers s ON s.id = pr.supplier_id
    LEFT JOIN purchases p ON p.id = pr.purchase_id
    LEFT JOIN warehouses w ON w.id = pr.warehouse_id
    ${w}
    ORDER BY pr.id DESC LIMIT ${size} OFFSET ${offset}`, params);
  const sums = get(`
    SELECT COUNT(*) AS count,
           COALESCE(SUM(pr.total), 0) AS total,
           COALESCE(SUM(pr.refunded), 0) AS refunded,
           COALESCE(SUM(pr.expense), 0) AS expense
    FROM purchase_returns pr
    LEFT JOIN suppliers s ON s.id = pr.supplier_id
    ${w}`, params);
  res.json({ rows, total, page, page_size: size, totals: sums });
});

r.get('/purchase-returns/:id', (req, res) => {
  const pr = get(`
    SELECT pr.*, s.name AS supplier_name, s.phone AS supplier_phone, s.address AS supplier_address,
           p.code AS purchase_code, p.ts AS purchase_ts, w.name AS warehouse_name, u.full_name AS user_name
    FROM purchase_returns pr
    LEFT JOIN suppliers s ON s.id = pr.supplier_id
    LEFT JOIN purchases p ON p.id = pr.purchase_id
    LEFT JOIN warehouses w ON w.id = pr.warehouse_id
    LEFT JOIN users u ON u.id = pr.user_id
    WHERE pr.id = ?`, [req.params.id]);
  if (!pr) return res.status(404).json({ error: 'Không tìm thấy phiếu trả hàng' });
  pr.items = all(`
    SELECT i.*, p.name AS product_name, p.sku
    FROM purchase_return_items i JOIN products p ON p.id = i.product_id
    WHERE i.return_id = ? ORDER BY i.id`, [pr.id]);
  pr.custom_items = all('SELECT * FROM purchase_return_custom_items WHERE return_id = ? ORDER BY id', [pr.id]);
  res.json(pr);
});

/**
 * Lập phiếu trả hàng NCC (tài liệu 11). Hai luồng:
 *
 *   Theo phiếu nhập gốc (purchase_id): chọn dòng của phiếu, số lượng không
 *   vượt số đã nhập trừ số đã trả, đơn giá LẤY TỪ PHIẾU NHẬP — không tin giá
 *   gửi lên. Món giao sai của phiếu gốc hiện sẵn để chọn trả.
 *
 *   Trả tự do (không purchase_id): tự chọn hàng, tự gõ giá thoả thuận, và
 *   thêm được món ngoài hệ thống bằng tay.
 *
 * Tiền NCC phải hoàn / trừ nợ = hàng chuẩn + hàng giao sai − chi phí trả hàng
 * (cửa hàng chịu). Hàng chuẩn trừ kho; hàng giao sai lúc nhập không vào kho
 * nên lúc trả cũng không trừ kho.
 */
r.post('/purchase-returns', (req, res) => {
  const b = req.body;
  try {
    const purchase = b.purchase_id ? get('SELECT * FROM purchases WHERE id = ?', [b.purchase_id]) : null;
    if (b.purchase_id && !purchase) throw badRequest('Không tìm thấy phiếu nhập gốc', 'PURCHASE_NOT_FOUND');
    if (purchase && purchase.status !== 'done') {
      throw badRequest(`Phiếu nhập ${purchase.code} đã huỷ, không trả hàng theo phiếu này được.`, 'PURCHASE_CANCELLED');
    }

    const items = (Array.isArray(b.items) ? b.items : []).filter((i) => Number(i.qty) > 0);
    const custom = (Array.isArray(b.custom_items) ? b.custom_items : [])
      .map((c) => ({
        custom_item_id: Number(c?.custom_item_id) || null,
        name: String(c?.name ?? '').trim(),
        unit_name: String(c?.unit_name ?? '').trim() || null,
        qty: Number(c?.qty) || 0,
        price: Math.max(0, Math.round(Number(c?.price) || 0)),
      }))
      .filter((c) => c.qty > 0);
    if (!items.length && !custom.length) throw badRequest('Phiếu trả hàng phải có ít nhất 1 mặt hàng');

    const supplierId = Number(b.supplier_id) || purchase?.supplier_id || null;
    const warehouseId = Number(b.warehouse_id) || purchase?.warehouse_id
      || get('SELECT id FROM warehouses WHERE is_default = 1')?.id;

    if (purchase) {
      /* Luồng 1: khoá số lượng và đơn giá theo phiếu nhập gốc */
      const lines = all('SELECT pi.*, p.name FROM purchase_items pi JOIN products p ON p.id = pi.product_id WHERE pi.purchase_id = ?', [purchase.id]);
      const done = returnedByPurchaseLine(purchase.id, lines);
      for (const it of items) {
        const line = it.purchase_item_id
          ? lines.find((l) => l.id === Number(it.purchase_item_id))
          : lines.find((l) => l.product_id === Number(it.product_id) && l.unit_name === it.unit_name);
        if (!line) throw badRequest(`Mặt hàng trả không có trong phiếu nhập ${purchase.code}.`, 'NOT_IN_PURCHASE');
        const already = done.get(line.id) || 0;
        const left = line.qty - already;
        if (Number(it.qty) > left + 1e-9) {
          throw badRequest(`"${line.name}": phiếu ${purchase.code} nhập ${line.qty} ${line.unit_name}, `
            + `đã trả ${already}, chỉ còn trả được ${left}.`, 'RETURN_QTY_EXCEEDED');
        }
        it.purchase_item_id = line.id;
        it.product_id = line.product_id;
        it.unit_name = line.unit_name;
        it.factor = line.factor;
        it.price = netPrice(line);
        done.set(line.id, already + Number(it.qty));
      }
      const cis = all('SELECT * FROM purchase_custom_items WHERE purchase_id = ?', [purchase.id]);
      const cdone = returnedByCustomItem(purchase.id);
      for (const c of custom) {
        const ci = c.custom_item_id ? cis.find((x) => x.id === c.custom_item_id) : null;
        if (!ci) {
          throw badRequest(`Trả theo phiếu ${purchase.code} thì chọn món giao sai có sẵn trong phiếu. `
            + 'Hàng gom nhiều đợt thì dùng Trả tự do.', 'CUSTOM_NOT_IN_PURCHASE');
        }
        const already = cdone.get(ci.id) || 0;
        const left = ci.qty - already;
        if (c.qty > left + 1e-9) {
          throw badRequest(`"${ci.name}": phiếu ${purchase.code} ghi ${ci.qty}, đã trả ${already}, `
            + `chỉ còn trả được ${left}.`, 'RETURN_QTY_EXCEEDED');
        }
        c.name = ci.name;
        c.unit_name = ci.unit_name;
        c.price = ci.price;
        cdone.set(ci.id, already + c.qty);
      }
    } else {
      /* Luồng 2: trả tự do — hàng phải là mặt hàng có thật, món ngoài hệ thống phải có tên */
      for (const it of items) {
        if (!get('SELECT id FROM products WHERE id = ?', [it.product_id])) {
          throw badRequest('Dòng trả hàng chưa chọn mặt hàng.', 'MISSING_PRODUCT');
        }
      }
      if (custom.some((c) => !c.name)) throw badRequest('Hàng ngoài hệ thống phải ghi tên hàng.', 'CUSTOM_NAME_REQUIRED');
      for (const c of custom) c.custom_item_id = null;
    }

    // Kiểm tra tồn trước khi trả — chỉ hàng chuẩn, hàng giao sai không có trong kho
    for (const it of items) {
      const qtyBase = Number(it.qty) * (Number(it.factor) || 1);
      const p = get('SELECT track_stock, name FROM products WHERE id = ?', [it.product_id]);
      if (!p?.track_stock) continue;
      const st = get('SELECT qty FROM stock WHERE product_id = ? AND warehouse_id = ?',
        [it.product_id, warehouseId]);
      if ((st?.qty ?? 0) < qtyBase) {
        throw badRequest(`"${p.name}" chỉ còn ${st?.qty ?? 0} trong kho, không đủ để trả ${qtyBase}.`, 'INSUFFICIENT_STOCK');
      }
    }

    const result = tx(() => {
      let stockValue = 0;
      for (const it of items) {
        it._amount = Math.round(Number(it.qty) * Math.round(Number(it.price) || 0));
        stockValue += it._amount;
      }
      for (const c of custom) c.amount = Math.round(c.qty * c.price);
      const customValue = custom.reduce((a, c) => a + c.amount, 0);
      const subtotal = stockValue + customValue;
      const expense = Math.max(0, Math.round(Number(b.expense) || 0));
      if (expense > subtotal) {
        throw badRequest('Chi phí trả hàng không được lớn hơn giá trị hàng trả.', 'EXPENSE_TOO_HIGH');
      }
      const total = subtotal - expense;
      const refunded = Math.min(Math.max(0, Math.round(Number(b.refunded) || 0)), total);
      const code = nextCode('purchase_returns', 'TNCC');

      const info = run(`
        INSERT INTO purchase_returns(code, ts, purchase_id, supplier_id, warehouse_id, user_id,
                                     subtotal, total, refunded, reason, note, expense, expense_note, mode)
        VALUES(?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [code, b.ts || null, purchase?.id || null, supplierId, warehouseId,
          b.user_id || null, subtotal, total, refunded, b.reason || null, b.note || null,
          expense, String(b.expense_note ?? '').trim() || null, purchase ? 'by_purchase' : 'free']);
      const returnId = Number(info.lastInsertRowid);

      for (const it of items) {
        const factor = Number(it.factor) || 1;
        const qtyBase = Number(it.qty) * factor;
        run(`INSERT INTO purchase_return_items(return_id, product_id, unit_id, unit_name, factor,
                                               qty, price, amount, purchase_item_id)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [returnId, it.product_id, resolveUnitId(it.product_id, it.unit_id, it.unit_name),
            it.unit_name, factor, Number(it.qty),
            Math.round(Number(it.price) || 0), it._amount, it.purchase_item_id || null]);
        moveStock({
          productId: it.product_id, warehouseId, qtyChange: -qtyBase,
          unitCost: costOf(it.product_id), refType: 'purchase_return', refId: returnId,
          refCode: code, note: `Trả NCC ${it.qty} ${it.unit_name}`, ts: b.ts || null,
        });
        /* Rút lô hàng trả lại ra khỏi bình quân gia quyền. Trả theo đúng giá
           đã nhập (giá ghi trên phiếu trả), chứ không theo giá vốn hiện tại —
           nếu không, trả một lô hàng đắt sẽ kéo giá vốn đi sai hướng. */
        reverseAvgCost(it.product_id, qtyBase, Math.round(Number(it.price) || 0) / factor);
      }

      for (const c of custom) {
        run(`INSERT INTO purchase_return_custom_items(return_id, custom_item_id, name, unit_name, qty, price, amount)
             VALUES(?, ?, ?, ?, ?, ?, ?)`,
          [returnId, c.custom_item_id, c.name, c.unit_name, c.qty, c.price, c.amount]);
      }

      if (refunded > 0) {
        const accountId = Number(b.account_id) || defaultCashAccount();
        const sup = supplierId ? get('SELECT name FROM suppliers WHERE id = ?', [supplierId]) : null;
        if (accountId) {
          addCashTx({
            accountId, direction: 'in', amount: refunded, category: 'purchase_return',
            partnerType: 'supplier', partnerId: supplierId, partnerName: sup?.name,
            refType: 'purchase_return', refId: returnId, refCode: code,
            note: `NCC hoàn tiền phiếu trả ${code}`, ts: b.ts || null,
          });
        }
      }
      return {
        id: returnId, code, subtotal, stock_value: stockValue, custom_value: customValue,
        expense, total, refunded, debt: supplierId ? supplierDebt(supplierId) : null,
      };
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

/* ========================= CÔNG NỢ NCC ============================== */

r.get('/supplier-debts', (req, res) => {
  const rows = all("SELECT * FROM suppliers WHERE active = 1 ORDER BY name");
  const out = [];
  for (const s of rows) {
    const debt = supplierDebt(s.id);
    const overdue = get(`
      SELECT COALESCE(SUM(total - paid), 0) AS amt, COUNT(*) AS n FROM purchases
      WHERE supplier_id = ? AND status = 'done' AND total > paid
        AND due_date IS NOT NULL AND date(due_date) < date('now','localtime')`, [s.id]);
    out.push({
      id: s.id, code: s.code, name: s.name, phone: s.phone, term_days: s.term_days,
      opening_debt: s.opening_debt, debt,
      overdue_amount: overdue.amt, overdue_count: overdue.n,
      unpaid_bills: get(
        "SELECT COUNT(*) AS n FROM purchases WHERE supplier_id = ? AND status = 'done' AND total > paid",
        [s.id]).n,
    });
  }
  res.json(out.filter((s) => s.debt !== 0 || req.query.all === '1'));
});

export default r;
