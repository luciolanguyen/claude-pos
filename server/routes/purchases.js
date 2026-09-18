import { Router } from 'express';
import { purchaseMath } from '../../client/src/lib/purchaseMath.js';
import {
  all, get, run, tx, nextCode, moveStock, updateAvgCost, reverseAvgCost, overwriteCost,
  addCashTx, defaultCashAccount, supplierDebt, costOf, pageParams, resolveUnitId,
  searchWhere } from '../db.js';

const r = Router();

const badRequest = (message, code) => Object.assign(new Error(message), { status: 400, code });

/* =========================== PHIẾU NHẬP HÀNG ======================== */

r.get('/purchases', (req, res) => {
  const { q = '', supplier_id, from, to, status, unpaid, match = 'contains' } = req.query;
  const where = [];
  const params = [];
  if (q.trim()) {
    const c = searchWhere(['p.code', 's.name', 'p.supplier_invoice'], q, match);
    where.push(c.sql);
    params.push(...c.params);
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

  /* Tiền và giá vốn từng dòng: một công thức dùng chung với màn hình xem trước (plan 31, 5.1d) */
  const math = purchaseMath(b, items, custom);
  if (math.vatInCost && math.lines.some((l) => l.unitCost < 0)) {
    return res.status(400).json({ error: 'Chiết khấu NCC lớn hơn tiền hàng — giá vốn ra số âm. Xem lại số chiết khấu.', code: 'DISCOUNT_TOO_HIGH' });
  }

  try {
    const result = tx(() => {
      items.forEach((it, i) => { it._amount = math.lines[i].amount; it._m = math.lines[i]; });
      for (const c of custom) c.amount = Math.round(c.qty * c.price);
      const { customTotal, subtotal, discount, vatAmount, total } = math;
      const paid = Math.min(Math.round(Number(b.paid) || 0), total);
      const code = b.code?.trim() || nextCode('purchases', 'PN');

      const info = run(`
        INSERT INTO purchases(code, ts, supplier_id, warehouse_id, user_id, subtotal, discount,
                              vat_amount, other_cost, total, paid, status, supplier_invoice, due_date, note,
                              vat_in_cost, discount_mode)
        VALUES(?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?, ?, ?, ?, ?, ?, 'done', ?, ?, ?, ?, ?)`,
        [code, b.ts || null, b.supplier_id || null, warehouseId, b.user_id || null,
          subtotal, discount, vatAmount, math.otherCost, total, paid,
          b.supplier_invoice || null, b.due_date || null, b.note || null,
          math.vatInCost ? 1 : 0, math.discountMode]);
      const purchaseId = Number(info.lastInsertRowid);
      /* Nhớ lựa chọn cho lần nhập sau của mối này */
      if (b.supplier_id && b.vat_in_cost !== undefined) {
        run('UPDATE suppliers SET vat_in_cost = ?, vat_discount_mode = ? WHERE id = ?',
          [math.vatInCost ? 1 : 0, math.discountMode, b.supplier_id]);
      }

      /* Chi phí khác chỉ phân bổ vào hàng thật sự vào kho — hàng giao sai
         không nằm trong kho thì không có giá vốn để gánh phần chi phí đó */
      for (const it of items) {
        const qty = Number(it.qty);
        const factor = Number(it.factor) || 1;
        const qtyBase = qty * factor;
        const unitCostBase = it._m.unitCost;

        /* price là giá SAU chiết khấu — chính nó đi vào giá vốn.
           list_price giữ giá mối báo, để mở lại phiếu còn đối chiếu được. */
        /* Ghi đè giá vốn: người lập phiếu tích ô ở dòng này, hoặc tích ô
           "Ghi đè giá vốn toàn bộ" trên thanh tiêu đề (tài liệu 13, mục 1.2) */
        const overwrite = b.overwrite_cost_all === true || it.overwrite_cost === true
          || it.overwrite_cost === 1;

        run(`INSERT INTO purchase_items(purchase_id, product_id, unit_id, unit_name, factor, qty, price,
                                        discount, vat_rate, amount, list_price, discount_percent,
                                        overwrite_cost, line_vat, discount_share, cost_unit)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [purchaseId, it.product_id, resolveUnitId(it.product_id, it.unit_id, it.unit_name),
            it.unit_name, factor, qty,
            Math.round(Number(it.price) || 0), Math.round(Number(it.discount) || 0),
            Number(it.vat_rate) || 0, it._amount,
            Math.round(Number(it.list_price) || Number(it.price) || 0),
            Number(it.discount_percent) || 0,
            overwrite ? 1 : 0, it._m.vat, it._m.discountShare, unitCostBase]);

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

/**
 * Trạng thái một phiếu trả NCC (plan 31, hạng mục 5.2d), tính từ các mốc đã ghi:
 *   draft           chưa gửi hàng đi
 *   sent            đã gửi, chờ NCC nhận — CHƯA trừ công nợ
 *   offset          NCC đã nhận, đã cấn trừ vào công nợ
 *   awaiting_refund NCC đã nhận, chờ NCC hoàn tiền mặt
 *   refunded        NCC đã hoàn đủ tiền
 */
export function returnStatus(pr) {
  if (!pr.sent_at) return 'draft';
  if (!pr.received_at) return 'sent';
  if (pr.settle_method === 'refund') return pr.refunded >= pr.total ? 'refunded' : 'awaiting_refund';
  return 'offset';
}
export const RETURN_STATUS_LABEL = {
  draft: 'Chưa gửi hàng',
  sent: 'Đã gửi, chờ NCC nhận',
  offset: 'Đã cấn trừ công nợ',
  awaiting_refund: 'Chờ NCC hoàn tiền',
  refunded: 'Đã hoàn tiền',
};
const withStatus = (pr) => {
  const status = returnStatus(pr);
  return {
    ...pr, status, status_label: RETURN_STATUS_LABEL[status],
    has_issue: !!pr.issue_note && !pr.issue_resolved_at ? 1 : 0,
    expense_supplier: Math.max(0, (pr.expense || 0) - (pr.expense_shop || 0)),
  };
};
const STATUS_WHERE = {
  draft: 'pr.sent_at IS NULL',
  sent: 'pr.sent_at IS NOT NULL AND pr.received_at IS NULL',
  offset: "pr.received_at IS NOT NULL AND pr.settle_method = 'offset'",
  awaiting_refund: "pr.received_at IS NOT NULL AND pr.settle_method = 'refund' AND pr.refunded < pr.total",
  refunded: "pr.received_at IS NOT NULL AND pr.settle_method = 'refund' AND pr.refunded >= pr.total",
  pending: 'pr.received_at IS NULL',
  issue: 'pr.issue_note IS NOT NULL AND pr.issue_resolved_at IS NULL',
};

r.get('/purchase-returns', (req, res) => {
  const { from, to, supplier_id: supplierId, q = '', match: mode = 'contains', status = '' } = req.query;
  const where = [];
  const params = [];
  if (supplierId) { where.push('pr.supplier_id = ?'); params.push(supplierId); }
  if (STATUS_WHERE[status]) where.push(STATUS_WHERE[status]);
  if (from) { where.push('date(pr.ts) >= date(?)'); params.push(from); }
  if (to) { where.push('date(pr.ts) <= date(?)'); params.push(to); }
  /* Gõ tìm theo số phiếu, số phiếu nhập gốc hoặc tên mối (plan 31, 5.2a) */
  if (String(q).trim()) {
    const c = searchWhere(['pr.code', 'p.code', 's.name', 'pr.reason'], q, mode);
    where.push(c.sql);
    params.push(...c.params);
  }
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
    ORDER BY pr.id DESC LIMIT ${size} OFFSET ${offset}`, params).map(withStatus);
  const sums = get(`
    SELECT COUNT(*) AS count,
           COALESCE(SUM(pr.total), 0) AS total,
           COALESCE(SUM(pr.refunded), 0) AS refunded,
           COALESCE(SUM(pr.expense), 0) AS expense
    FROM purchase_returns pr
    LEFT JOIN suppliers s ON s.id = pr.supplier_id
    /* Phải nối luôn bảng phiếu nhập: bộ lọc gõ tìm có tra cả số phiếu nhập
       gốc (p.code), thiếu chỗ nối này là câu tổng vỡ ngay. */
    LEFT JOIN purchases p ON p.id = pr.purchase_id
    ${w}`, params);
  /* Việc còn tồn đọng (5.2d): chỉ lọc theo NCC, KHÔNG theo khoảng ngày hay
     trạng thái — phiếu gửi từ hai tháng trước mà NCC chưa nhận vẫn phải hiện,
     và bấm lọc "Có trục trặc" không được làm thẻ "Chờ NCC nhận" về 0. */
  const open = get(`
    SELECT /* Hàng đã trả đi mà NCC chưa nhận: tiền này CHƯA trừ vào công nợ */
           COALESCE(SUM(CASE WHEN received_at IS NULL THEN total ELSE 0 END), 0) AS pending_value,
           COALESCE(SUM(CASE WHEN received_at IS NULL THEN 1 ELSE 0 END), 0) AS pending_count,
           COALESCE(SUM(CASE WHEN received_at IS NOT NULL AND settle_method = 'refund' AND refunded < total
                             THEN total - refunded ELSE 0 END), 0) AS awaiting_refund,
           COALESCE(SUM(CASE WHEN received_at IS NOT NULL AND settle_method = 'refund' AND refunded < total
                             THEN 1 ELSE 0 END), 0) AS awaiting_count,
           COALESCE(SUM(CASE WHEN issue_note IS NOT NULL AND issue_resolved_at IS NULL
                             THEN 1 ELSE 0 END), 0) AS issue_count
    FROM purchase_returns ${supplierId ? 'WHERE supplier_id = ?' : ''}`, supplierId ? [supplierId] : []);
  res.json({ rows, total, page, page_size: size, totals: { ...sums, ...open } });
});

/** Chi tiết một phiếu trả NCC, kèm trạng thái và các phiếu quỹ liên quan. */
function returnDetail(id) {
  const pr = get(`
    SELECT pr.*, s.name AS supplier_name, s.phone AS supplier_phone, s.address AS supplier_address,
           p.code AS purchase_code, p.ts AS purchase_ts, w.name AS warehouse_name, u.full_name AS user_name,
           ec.code AS expense_cash_code
    FROM purchase_returns pr
    LEFT JOIN suppliers s ON s.id = pr.supplier_id
    LEFT JOIN purchases p ON p.id = pr.purchase_id
    LEFT JOIN warehouses w ON w.id = pr.warehouse_id
    LEFT JOIN users u ON u.id = pr.user_id
    LEFT JOIN cash_transactions ec ON ec.id = pr.expense_cash_tx_id
    WHERE pr.id = ?`, [id]);
  if (!pr) return null;
  pr.items = all(`
    SELECT i.*, p.name AS product_name, p.sku
    FROM purchase_return_items i JOIN products p ON p.id = i.product_id
    WHERE i.return_id = ? ORDER BY i.id`, [pr.id]);
  pr.custom_items = all('SELECT * FROM purchase_return_custom_items WHERE return_id = ? ORDER BY id', [pr.id]);
  /* Các lần NCC hoàn tiền mặt */
  pr.refunds = all(`
    SELECT t.id, t.code, t.ts, t.amount, a.name AS account_name
    FROM cash_transactions t LEFT JOIN cash_accounts a ON a.id = t.account_id
    WHERE t.ref_type = 'purchase_return' AND t.ref_id = ? AND t.direction = 'in'
    ORDER BY t.ts, t.id`, [pr.id]);
  return withStatus(pr);
}

r.get('/purchase-returns/:id', (req, res) => {
  const pr = returnDetail(Number(req.params.id));
  if (!pr) return res.status(404).json({ error: 'Không tìm thấy phiếu trả hàng' });
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
      /* Chi phí trả hàng (plan 31, hạng mục 5.2c): hai câu hỏi tách bạch —
         ai đưa tiền trước, ai chịu. Không gửi gì thì như bản cũ: NCC thu phí
         và trừ vào tiền hoàn, tức tiệm chịu. */
      const expense = Math.max(0, Math.round(Number(b.expense) || 0));
      const payer = b.expense_payer === 'shop' ? 'shop' : 'supplier';
      const bearer = ['shop', 'supplier', 'split'].includes(b.expense_bearer) ? b.expense_bearer : 'shop';
      const expenseShop = bearer === 'shop' ? expense
        : bearer === 'supplier' ? 0
          : Math.min(expense, Math.max(0, Math.round(Number(b.expense_shop) || 0)));
      const expenseSupplier = expense - expenseShop;
      /*   Tiệm trả trước mà NCC chịu phần nào → NCC trả thêm phần đó cho tiệm.
           NCC trả trước mà tiệm chịu phần nào  → NCC trừ phần đó vào tiền hoàn. */
      const adjust = payer === 'shop' ? expenseSupplier : -expenseShop;
      if (-adjust > subtotal) {
        throw badRequest('Phần chi phí tiệm chịu không được lớn hơn giá trị hàng trả.', 'EXPENSE_TOO_HIGH');
      }
      const total = subtotal + adjust;
      const refunded = Math.min(Math.max(0, Math.round(Number(b.refunded) || 0)), total);
      /* Trạng thái (plan 31, hạng mục 5.2d). NCC hoàn tiền ngay tức là đã cầm
         hàng rồi — tự đánh dấu đã gửi, đã nhận. */
      const received = b.received === true || refunded > 0;
      const sent = received || b.sent === true;
      const settleMethod = refunded > 0 || b.settle_method === 'refund' ? 'refund' : 'offset';
      const code = nextCode('purchase_returns', 'TNCC');

      const info = run(`
        INSERT INTO purchase_returns(code, ts, purchase_id, supplier_id, warehouse_id, user_id,
                                     subtotal, total, refunded, reason, note, expense, expense_note, mode,
                                     expense_payer, expense_bearer, expense_shop, settle_method,
                                     sent_at, received_at, issue_note)
        VALUES(?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?,
               CASE WHEN ? THEN COALESCE(?, datetime('now','localtime')) END,
               CASE WHEN ? THEN COALESCE(?, datetime('now','localtime')) END, ?)`,
        [code, b.ts || null, purchase?.id || null, supplierId, warehouseId,
          b.user_id || null, subtotal, total, refunded, b.reason || null, b.note || null,
          expense, String(b.expense_note ?? '').trim() || null, purchase ? 'by_purchase' : 'free',
          payer, bearer, expenseShop, settleMethod,
          sent ? 1 : 0, b.ts || null, received ? 1 : 0, b.ts || null,
          String(b.issue_note ?? '').trim() || null]);
      const returnId = Number(info.lastInsertRowid);

      /* Tiệm đưa tiền xe trước thì lập phiếu chi — trừ khi đã chi ở chỗ khác */
      if (payer === 'shop' && expense > 0 && b.expense_cash !== false) {
        const accountId = Number(b.expense_account_id) || defaultCashAccount();
        if (accountId) {
          const tx1 = addCashTx({
            accountId, direction: 'out', amount: expense, category: 'transport',
            partnerName: String(b.expense_note ?? '').trim() || 'Chi phí trả hàng NCC',
            refType: 'purchase_return', refId: returnId, refCode: code,
            userId: b.user_id || null,
            note: `Chi phí trả hàng ${code}`
              + (expenseSupplier > 0 ? ` — NCC chịu ${expenseSupplier.toLocaleString('vi-VN')}đ, trả lại qua phiếu` : ''),
            ts: b.ts || null,
          });
          if (tx1) run('UPDATE purchase_returns SET expense_cash_tx_id = ? WHERE id = ?', [tx1.id, returnId]);
        }
      }

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
        expense, expense_shop: expenseShop, expense_supplier: expenseSupplier,
        total, refunded, sent, received, settle_method: settleMethod,
        debt: supplierId ? supplierDebt(supplierId) : null,
      };
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

/**
 * Cập nhật trạng thái phiếu trả NCC (plan 31, hạng mục 5.2d).
 *   sent / received      true | false — kèm `at` nếu ghi lùi ngày
 *   settle_method        offset | refund
 *   issue_note           ghi trục trặc (chuỗi rỗng = xoá)
 *   issue_resolved       true — đánh dấu đã xử lý xong trục trặc
 *
 * Bấm "NCC đã nhận" là LÚC công nợ NCC giảm. Bỏ đánh dấu đã nhận thì nợ trở
 * lại như cũ — nhưng không cho bỏ khi đã ghi NCC hoàn tiền.
 */
r.post('/purchase-returns/:id/status', (req, res) => {
  const b = req.body || {};
  try {
    const out = tx(() => {
      const pr = get('SELECT * FROM purchase_returns WHERE id = ?', [req.params.id]);
      if (!pr) throw Object.assign(new Error('Không tìm thấy phiếu trả hàng'), { status: 404 });
      const at = b.at ? String(b.at) : null;
      if (b.received === true && !pr.received_at) {
        run(`UPDATE purchase_returns SET received_at = COALESCE(?, datetime('now','localtime')),
               sent_at = COALESCE(sent_at, ?, datetime('now','localtime')) WHERE id = ?`, [at, at, pr.id]);
      } else if (b.received === false && pr.received_at) {
        if (pr.refunded > 0) {
          throw badRequest(`Phiếu ${pr.code} đã ghi NCC hoàn ${pr.refunded.toLocaleString('vi-VN')}đ — không bỏ đánh dấu đã nhận được.`, 'HAS_REFUND');
        }
        run('UPDATE purchase_returns SET received_at = NULL WHERE id = ?', [pr.id]);
      }
      if (b.sent === true && !pr.sent_at) {
        run("UPDATE purchase_returns SET sent_at = COALESCE(?, datetime('now','localtime')) WHERE id = ?", [at, pr.id]);
      } else if (b.sent === false && pr.sent_at) {
        const cur = get('SELECT received_at FROM purchase_returns WHERE id = ?', [pr.id]);
        if (cur.received_at) throw badRequest('NCC đã nhận hàng thì không bỏ đánh dấu đã gửi được.', 'ALREADY_RECEIVED');
        run('UPDATE purchase_returns SET sent_at = NULL WHERE id = ?', [pr.id]);
      }
      if (b.settle_method === 'offset' || b.settle_method === 'refund') {
        run('UPDATE purchase_returns SET settle_method = ? WHERE id = ?', [b.settle_method, pr.id]);
      }
      if (typeof b.issue_note === 'string') {
        const note = b.issue_note.trim() || null;
        run('UPDATE purchase_returns SET issue_note = ?, issue_resolved_at = NULL WHERE id = ?', [note, pr.id]);
      }
      if (b.issue_resolved === true) {
        run("UPDATE purchase_returns SET issue_resolved_at = datetime('now','localtime') WHERE id = ? AND issue_note IS NOT NULL", [pr.id]);
      }
      return returnDetail(pr.id);
    });
    res.json({ ...out, debt: out.supplier_id ? supplierDebt(out.supplier_id) : null });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

/** Ghi NCC hoàn tiền mặt cho phiếu trả — hoàn một lần hay nhiều đợt đều được. */
r.post('/purchase-returns/:id/refund', (req, res) => {
  const b = req.body || {};
  try {
    const out = tx(() => {
      const pr = get('SELECT * FROM purchase_returns WHERE id = ?', [req.params.id]);
      if (!pr) throw Object.assign(new Error('Không tìm thấy phiếu trả hàng'), { status: 404 });
      if (!pr.received_at) {
        throw badRequest('NCC chưa nhận hàng trả thì chưa ghi hoàn tiền được — bấm "NCC đã nhận" trước.', 'NOT_RECEIVED');
      }
      const left = pr.total - pr.refunded;
      const amount = Math.round(Number(b.amount) || 0);
      if (!(amount > 0)) throw badRequest('Số tiền hoàn phải lớn hơn 0.');
      if (amount > left) {
        throw badRequest(`NCC chỉ còn phải hoàn ${left.toLocaleString('vi-VN')}đ cho phiếu ${pr.code}.`, 'REFUND_TOO_HIGH');
      }
      const accountId = Number(b.account_id) || defaultCashAccount();
      if (!accountId) throw badRequest('Chưa thiết lập quỹ tiền.');
      const sup = pr.supplier_id ? get('SELECT name FROM suppliers WHERE id = ?', [pr.supplier_id]) : null;
      addCashTx({
        accountId, direction: 'in', amount, category: 'purchase_return',
        partnerType: 'supplier', partnerId: pr.supplier_id, partnerName: sup?.name,
        refType: 'purchase_return', refId: pr.id, refCode: pr.code,
        userId: b.user_id || req.user?.id || null,
        note: `NCC hoàn tiền phiếu trả ${pr.code}`,
      });
      run("UPDATE purchase_returns SET refunded = refunded + ?, settle_method = 'refund' WHERE id = ?", [amount, pr.id]);
      return returnDetail(pr.id);
    });
    res.json({ ...out, debt: out.supplier_id ? supplierDebt(out.supplier_id) : null });
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

/* ==================================================================== *
 * LỌC NHANH HÀNG TỪNG MUA CỦA MỘT MỐI (tài liệu 24, mục 5.2)
 *
 * Lập phiếu nhập cho mối nào thì chín phần mười là lấy lại đúng những món
 * đã từng lấy của mối đó. Bắt người lập phiếu gõ tìm trong hai nghìn mã
 * hàng chung vừa chậm vừa dễ chọn nhầm mã na ná.
 *
 * Trả kèm GIÁ NHẬP và NGÀY NHẬP gần nhất của đúng mối này, để bấm một cái
 * là món nhảy sang giỏ với giá cũ điền sẵn.
 * ==================================================================== */

r.get('/suppliers/:id/bought-products', (req, res) => {
  const supplierId = Number(req.params.id);
  if (!get('SELECT id FROM suppliers WHERE id = ?', [supplierId])) {
    return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp' });
  }

  /* Gom theo mặt hàng. MAX(pu.ts) đi kèm các cột trần là cách SQLite lấy
     đúng DÒNG của lần nhập gần nhất, không phải trộn cột của nhiều dòng. */
  const hist = all(`
    SELECT pi.product_id,
           COUNT(*) AS times,
           SUM(pi.qty * pi.factor) AS qty_base,
           MAX(pu.ts) AS last_ts,
           pu.code AS last_code,
           pi.unit_name AS last_unit_name,
           pi.factor AS last_factor,
           pi.price AS last_price
    FROM purchase_items pi
    JOIN purchases pu ON pu.id = pi.purchase_id
    WHERE pu.supplier_id = ? AND pu.status = 'done'
    GROUP BY pi.product_id`, [supplierId]);
  if (!hist.length) return res.json([]);

  const byId = new Map(hist.map((h) => [h.product_id, h]));
  const ids = [...byId.keys()];

  const q = String(req.query.q || '').trim();
  const where = [`p.id IN (${ids.map(() => '?').join(',')})`, 'p.active = 1'];
  const params = [...ids];
  if (q) {
    /* Gõ không cần đúng thứ tự từ (tài liệu 24, mục 5.2) */
    const c = searchWhere(['p.name', 'p.sku', 'p.alias', 'p.barcode', 'p.brand'], q);
    where.push(c.sql);
    params.push(...c.params);
  }
  const rows = all(`
    SELECT p.id, p.sku, p.name, p.alias, p.base_unit, p.track_stock, p.cost_price,
           p.category_id, p.pack_spec, p.purchase_note, c.name AS category_name,
           COALESCE((SELECT SUM(st.qty) FROM stock st WHERE st.product_id = p.id), 0) AS stock,
           /* Giá mối này BÁO cho món đó (tài liệu 15, mục 4.3) — khác giá đã
              nhập lần trước: báo giá là giá mối hứa cho lần tới. */
           ps.quote_price, ps.quote_at, ps.quote_note, ps.supplier_sku
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN product_suppliers ps ON ps.product_id = p.id AND ps.supplier_id = ?
    WHERE ${where.join(' AND ')}
    ORDER BY p.name
    LIMIT 400`, [supplierId, ...params]);

  for (const row of rows) Object.assign(row, byId.get(row.id));
  /* Lần lấy gần đây nhất lên đầu — món đang lấy đều đặn bao giờ cũng là
     món sắp lấy tiếp. */
  rows.sort((a, b) => String(b.last_ts || '').localeCompare(String(a.last_ts || '')));
  res.json(rows);
});

/* ==================================================================== *
 * MA TRẬN GIÁ NHẬP CỦA MỌI MỐI CHO MỘT MẶT HÀNG (tài liệu 24, mục 5.2)
 *
 * Đang gõ phiếu, kế toán cần biết ngay "món này mấy mối kia bán bao nhiêu"
 * để ép giá tại chỗ. Trả 3 lần gần nhất của TỪNG mối, giá quy về đơn vị cơ
 * bản để so được giữa lần lấy nguyên thùng và lần lấy lẻ từng cái.
 * ==================================================================== */

r.get('/products/:id/supplier-prices', (req, res) => {
  const id = Number(req.params.id);
  const p = get('SELECT id, sku, name, base_unit FROM products WHERE id = ?', [id]);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });

  const rows = all(`
    SELECT pu.id AS purchase_id, pu.code, pu.ts,
           s.id AS supplier_id, COALESCE(s.name, 'Không ghi mối') AS supplier_name,
           s.phone AS supplier_phone,
           pi.unit_name, pi.factor, pi.qty, pi.price,
           CAST(ROUND(pi.price * 1.0 / COALESCE(NULLIF(pi.factor, 0), 1)) AS INTEGER) AS unit_price_base
    FROM purchase_items pi
    JOIN purchases pu ON pu.id = pi.purchase_id
    LEFT JOIN suppliers s ON s.id = pu.supplier_id
    WHERE pi.product_id = ? AND pu.status = 'done'
    ORDER BY pu.ts DESC, pi.id DESC
    LIMIT 300`, [id]);

  const bySupplier = new Map();
  for (const row of rows) {
    const key = row.supplier_id || 0;
    if (!bySupplier.has(key)) {
      bySupplier.set(key, {
        supplier_id: row.supplier_id,
        supplier_name: row.supplier_name,
        supplier_phone: row.supplier_phone,
        rows: [],
      });
    }
    const g = bySupplier.get(key);
    if (g.rows.length < 3) g.rows.push(row);      // 3 lần gần nhất của mối đó
  }
  const groups = [...bySupplier.values()].map((g) => ({
    ...g,
    last_price: g.rows[0]?.unit_price_base || 0,
    last_ts: g.rows[0]?.ts || null,
  })).sort((a, b) => String(b.last_ts || '').localeCompare(String(a.last_ts || '')));

  const prices = groups.map((g) => g.last_price).filter((v) => v > 0);
  res.json({
    product: p,
    groups,
    /* Mối nào đang rẻ nhất / đắt nhất trong các lần gần nhất — để tô một phát */
    best: prices.length ? Math.min(...prices) : 0,
    worst: prices.length ? Math.max(...prices) : 0,
  });
});

export default r;
