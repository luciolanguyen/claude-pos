import { Router } from 'express';
import {
  all, get, run, tx, nextCode, moveStock, updateAvgCost,
  addCashTx, defaultCashAccount, supplierDebt, costOf,
} from '../db.js';

const r = Router();

/* =========================== PHIẾU NHẬP HÀNG ======================== */

r.get('/purchases', (req, res) => {
  const { q = '', supplier_id, from, to, status, unpaid, limit = 200 } = req.query;
  const where = [];
  const params = [];
  if (q.trim()) {
    where.push('(p.code LIKE ? OR s.name LIKE ? OR p.supplier_invoice LIKE ?)');
    const like = `%${q.trim()}%`;
    params.push(like, like, like);
  }
  if (supplier_id) { where.push('p.supplier_id = ?'); params.push(supplier_id); }
  if (from) { where.push('date(p.ts) >= date(?)'); params.push(from); }
  if (to) { where.push('date(p.ts) <= date(?)'); params.push(to); }
  if (status) { where.push('p.status = ?'); params.push(status); }
  if (unpaid === '1') where.push('p.total > p.paid');

  res.json(all(`
    SELECT p.*, s.name AS supplier_name, s.code AS supplier_code,
           w.name AS warehouse_name, u.full_name AS user_name,
           (p.total - p.paid) AS remaining,
           (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS item_count
    FROM purchases p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN warehouses w ON w.id = p.warehouse_id
    LEFT JOIN users u ON u.id = p.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY p.id DESC LIMIT ${Number(limit)}`, params));
});

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
    SELECT pi.*, pr.name AS product_name, pr.sku, pr.base_unit, pr.barcode
    FROM purchase_items pi JOIN products pr ON pr.id = pi.product_id
    WHERE pi.purchase_id = ?`, [p.id]);
  p.returns = all('SELECT id, code, ts, total FROM purchase_returns WHERE purchase_id = ?', [p.id]);
  res.json(p);
});

/**
 * Tạo phiếu nhập.
 * items: [{ product_id, unit_name, factor, qty, price, discount, vat_rate }]
 * qty & price tính theo unit_name; tồn kho ghi theo qty * factor.
 */
r.post('/purchases', (req, res) => {
  const b = req.body;
  const items = Array.isArray(b.items) ? b.items.filter((i) => Number(i.qty) > 0) : [];
  if (!items.length) return res.status(400).json({ error: 'Phiếu nhập phải có ít nhất 1 mặt hàng' });

  const warehouseId = Number(b.warehouse_id) || get('SELECT id FROM warehouses WHERE is_default = 1')?.id;
  if (!warehouseId) return res.status(400).json({ error: 'Chưa thiết lập kho' });

  try {
    const result = tx(() => {
      let subtotal = 0;
      let vatAmount = 0;
      for (const it of items) {
        const qty = Number(it.qty);
        const price = Math.round(Number(it.price) || 0);
        const disc = Math.round(Number(it.discount) || 0);
        const amount = Math.round(qty * price - disc);
        it._amount = amount;
        subtotal += amount;
        vatAmount += Math.round(amount * (Number(it.vat_rate) || 0) / 100);
      }
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

      // Phân bổ chi phí khác vào giá vốn theo tỉ trọng giá trị dòng
      for (const it of items) {
        const qty = Number(it.qty);
        const factor = Number(it.factor) || 1;
        const qtyBase = qty * factor;
        const share = subtotal > 0 ? (it._amount / subtotal) * otherCost : 0;
        const unitCostBase = qtyBase > 0 ? Math.round((it._amount + share) / qtyBase) : 0;

        run(`INSERT INTO purchase_items(purchase_id, product_id, unit_name, factor, qty, price,
                                        discount, vat_rate, amount)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [purchaseId, it.product_id, it.unit_name, factor, qty,
            Math.round(Number(it.price) || 0), Math.round(Number(it.discount) || 0),
            Number(it.vat_rate) || 0, it._amount]);

        moveStock({
          productId: it.product_id, warehouseId, qtyChange: qtyBase,
          unitCost: unitCostBase, refType: 'purchase', refId: purchaseId, refCode: code,
          note: `Nhập ${qty} ${it.unit_name}`, ts: b.ts || null,
        });
        updateAvgCost(it.product_id, qtyBase, unitCostBase);
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
      return { id: purchaseId, code };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
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
  const { from, to, supplier_id, limit = 200 } = req.query;
  const where = [];
  const params = [];
  if (supplier_id) { where.push('pr.supplier_id = ?'); params.push(supplier_id); }
  if (from) { where.push('date(pr.ts) >= date(?)'); params.push(from); }
  if (to) { where.push('date(pr.ts) <= date(?)'); params.push(to); }
  res.json(all(`
    SELECT pr.*, s.name AS supplier_name, p.code AS purchase_code, w.name AS warehouse_name
    FROM purchase_returns pr
    LEFT JOIN suppliers s ON s.id = pr.supplier_id
    LEFT JOIN purchases p ON p.id = pr.purchase_id
    LEFT JOIN warehouses w ON w.id = pr.warehouse_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY pr.id DESC LIMIT ${Number(limit)}`, params));
});

r.get('/purchase-returns/:id', (req, res) => {
  const pr = get(`
    SELECT pr.*, s.name AS supplier_name, p.code AS purchase_code, w.name AS warehouse_name
    FROM purchase_returns pr
    LEFT JOIN suppliers s ON s.id = pr.supplier_id
    LEFT JOIN purchases p ON p.id = pr.purchase_id
    LEFT JOIN warehouses w ON w.id = pr.warehouse_id
    WHERE pr.id = ?`, [req.params.id]);
  if (!pr) return res.status(404).json({ error: 'Không tìm thấy phiếu trả hàng' });
  pr.items = all(`
    SELECT i.*, p.name AS product_name, p.sku
    FROM purchase_return_items i JOIN products p ON p.id = i.product_id
    WHERE i.return_id = ?`, [pr.id]);
  res.json(pr);
});

r.post('/purchase-returns', (req, res) => {
  const b = req.body;
  const items = Array.isArray(b.items) ? b.items.filter((i) => Number(i.qty) > 0) : [];
  if (!items.length) return res.status(400).json({ error: 'Phiếu trả hàng phải có ít nhất 1 mặt hàng' });
  const warehouseId = Number(b.warehouse_id) || get('SELECT id FROM warehouses WHERE is_default = 1')?.id;

  // Kiểm tra tồn trước khi trả
  for (const it of items) {
    const qtyBase = Number(it.qty) * (Number(it.factor) || 1);
    const p = get('SELECT track_stock, name FROM products WHERE id = ?', [it.product_id]);
    if (!p?.track_stock) continue;
    const st = get('SELECT qty FROM stock WHERE product_id = ? AND warehouse_id = ?',
      [it.product_id, warehouseId]);
    if ((st?.qty ?? 0) < qtyBase) {
      return res.status(400).json({ error: `"${p.name}" chỉ còn ${st?.qty ?? 0} trong kho, không đủ để trả ${qtyBase}.` });
    }
  }

  try {
    const result = tx(() => {
      let subtotal = 0;
      for (const it of items) {
        it._amount = Math.round(Number(it.qty) * Math.round(Number(it.price) || 0));
        subtotal += it._amount;
      }
      const total = subtotal;
      const refunded = Math.min(Math.round(Number(b.refunded) || 0), total);
      const code = nextCode('purchase_returns', 'TNCC');

      const info = run(`
        INSERT INTO purchase_returns(code, ts, purchase_id, supplier_id, warehouse_id, user_id,
                                     subtotal, total, refunded, reason, note)
        VALUES(?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [code, b.ts || null, b.purchase_id || null, b.supplier_id || null, warehouseId,
          b.user_id || null, subtotal, total, refunded, b.reason || null, b.note || null]);
      const returnId = Number(info.lastInsertRowid);

      for (const it of items) {
        const factor = Number(it.factor) || 1;
        run(`INSERT INTO purchase_return_items(return_id, product_id, unit_name, factor, qty, price, amount)
             VALUES(?, ?, ?, ?, ?, ?, ?)`,
          [returnId, it.product_id, it.unit_name, factor, Number(it.qty),
            Math.round(Number(it.price) || 0), it._amount]);
        moveStock({
          productId: it.product_id, warehouseId, qtyChange: -(Number(it.qty) * factor),
          unitCost: costOf(it.product_id), refType: 'purchase_return', refId: returnId,
          refCode: code, note: `Trả NCC ${it.qty} ${it.unit_name}`, ts: b.ts || null,
        });
      }

      if (refunded > 0) {
        const accountId = Number(b.account_id) || defaultCashAccount();
        const sup = b.supplier_id ? get('SELECT name FROM suppliers WHERE id = ?', [b.supplier_id]) : null;
        if (accountId) {
          addCashTx({
            accountId, direction: 'in', amount: refunded, category: 'purchase_return',
            partnerType: 'supplier', partnerId: b.supplier_id || null, partnerName: sup?.name,
            refType: 'purchase_return', refId: returnId, refCode: code,
            note: `NCC hoàn tiền phiếu trả ${code}`, ts: b.ts || null,
          });
        }
      }
      return { id: returnId, code };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
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
