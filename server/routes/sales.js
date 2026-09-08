import { Router } from 'express';
import {
  all, get, run, tx, nextCode, moveStock, costOf,
  addCashTx, defaultCashAccount, customerDebt, getSettings,
} from '../db.js';

const r = Router();

/* ============================ HOÁ ĐƠN BÁN ========================== */

r.get('/sales', (req, res) => {
  const { q = '', customer_id, from, to, status, payment_method, unpaid, user_id, limit = 200 } = req.query;
  const where = [];
  const params = [];
  if (q.trim()) {
    where.push('(s.code LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)');
    const like = `%${q.trim()}%`;
    params.push(like, like, like);
  }
  if (customer_id) { where.push('s.customer_id = ?'); params.push(customer_id); }
  if (from) { where.push('date(s.ts) >= date(?)'); params.push(from); }
  if (to) { where.push('date(s.ts) <= date(?)'); params.push(to); }
  if (status) { where.push('s.status = ?'); params.push(status); }
  if (payment_method) { where.push('s.payment_method = ?'); params.push(payment_method); }
  if (user_id) { where.push('s.user_id = ?'); params.push(user_id); }
  if (unpaid === '1') where.push("s.total > s.paid AND s.status = 'done'");

  res.json(all(`
    SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, c.code AS customer_code,
           u.full_name AS user_name, w.name AS warehouse_name,
           (s.total - s.paid) AS remaining,
           (s.total - s.vat_amount - s.cogs) AS profit,
           (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.id DESC LIMIT ${Number(limit)}`, params));
});

r.get('/sales/:id', (req, res) => {
  const s = get(`
    SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address,
           c.code AS customer_code, c.tax_code AS customer_tax_code, c.company_name AS customer_company,
           u.full_name AS user_name, w.name AS warehouse_name, pl.name AS price_list_name
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
    LEFT JOIN price_lists pl ON pl.id = s.price_list_id
    WHERE s.id = ?`, [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Không tìm thấy hoá đơn' });
  s.items = all(`
    SELECT si.*, p.sku, p.base_unit, p.barcode
    FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
    WHERE si.sale_id = ?`, [s.id]);
  s.returns = all('SELECT id, code, ts, total FROM sale_returns WHERE sale_id = ?', [s.id]);
  s.store = getSettings().store || {};
  res.json(s);
});

/**
 * Tạo hoá đơn bán hàng.
 * items: [{ product_id, name_snapshot, unit_name, factor, qty, price, discount, vat_rate }]
 */
r.post('/sales', (req, res) => {
  const b = req.body;
  const items = Array.isArray(b.items) ? b.items.filter((i) => Number(i.qty) > 0) : [];
  if (!items.length) return res.status(400).json({ error: 'Hoá đơn phải có ít nhất 1 mặt hàng' });

  const warehouseId = Number(b.warehouse_id) || get('SELECT id FROM warehouses WHERE is_default = 1')?.id;
  if (!warehouseId) return res.status(400).json({ error: 'Chưa thiết lập kho' });

  const settings = getSettings();
  const allowNegative = settings.allow_negative_stock === true;

  // Kiểm tra tồn kho
  if (!allowNegative) {
    for (const it of items) {
      const p = get('SELECT track_stock, name FROM products WHERE id = ?', [it.product_id]);
      if (!p || !p.track_stock) continue;
      const qtyBase = Number(it.qty) * (Number(it.factor) || 1);
      const st = get('SELECT qty FROM stock WHERE product_id = ? AND warehouse_id = ?',
        [it.product_id, warehouseId]);
      if ((st?.qty ?? 0) < qtyBase) {
        return res.status(400).json({
          error: `"${p.name}" chỉ còn ${st?.qty ?? 0} trong kho, không đủ bán ${qtyBase}.`,
          code: 'INSUFFICIENT_STOCK',
        });
      }
    }
  }

  // Kiểm tra hạn mức công nợ
  // Ước tính tổng để kiểm tra hạn mức nợ — phải tính cùng cách với lúc lưu,
  // nếu không đơn giảm giá theo % sẽ bị chặn oan.
  const lineTotal = (it) => {
    const gross = Math.round(Number(it.qty) * Math.round(Number(it.price) || 0));
    const disc = it.discount_type === 'percent'
      ? Math.round(gross * (Number(it.discount_percent) || 0) / 100)
      : Math.round(Number(it.discount) || 0);
    return gross - Math.min(disc, gross);
  };
  const sub0 = items.reduce((a, it) => a + lineTotal(it), 0);
  const orderDisc0 = b.discount_type === 'percent'
    ? Math.round(sub0 * (Number(b.discount_percent) || 0) / 100)
    : Math.round(Number(b.discount) || 0);
  const total0 = sub0 - Math.min(orderDisc0, sub0) +
    (b.ship_payer === 'customer' ? Math.round(Number(b.ship_fee) || 0) : 0);
  if (b.customer_id) {
    const c = get('SELECT name, debt_limit FROM customers WHERE id = ?', [b.customer_id]);
    if (c?.debt_limit > 0) {
      const willOwe = customerDebt(b.customer_id) + (total0 - Math.round(Number(b.paid) || 0));
      if (willOwe > c.debt_limit) {
        return res.status(400).json({
          error: `Công nợ của "${c.name}" sẽ là ${willOwe.toLocaleString('vi-VN')} đ, vượt hạn mức ${c.debt_limit.toLocaleString('vi-VN')} đ.`,
          code: 'DEBT_LIMIT',
        });
      }
    }
  }

  try {
    const result = tx(() => {
      let subtotal = 0;
      let vatAmount = 0;
      let cogs = 0;
      for (const it of items) {
        const qty = Number(it.qty);
        const price = Math.round(Number(it.price) || 0);
        const gross = Math.round(qty * price);
        // Giảm giá dòng: theo % của tiền hàng dòng đó, hoặc số tiền cố định
        const disc = it.discount_type === 'percent'
          ? Math.round(gross * (Number(it.discount_percent) || 0) / 100)
          : Math.round(Number(it.discount) || 0);
        it._discount = Math.min(disc, gross);   // không giảm quá tiền hàng
        const amount = gross - it._discount;
        it._amount = amount;
        it._unitCost = costOf(it.product_id);
        subtotal += amount;
        if (b.is_vat_invoice) vatAmount += Math.round(amount * (Number(it.vat_rate) || 0) / 100);
        cogs += Math.round(qty * (Number(it.factor) || 1) * it._unitCost);
      }
      // Giảm giá toàn hoá đơn: theo % của tạm tính, hoặc số tiền cố định
      const discountType = b.discount_type === 'percent' ? 'percent' : 'amount';
      const discountPercent = discountType === 'percent' ? (Number(b.discount_percent) || 0) : 0;
      const discount = Math.min(
        discountType === 'percent'
          ? Math.round(subtotal * discountPercent / 100)
          : Math.round(Number(b.discount) || 0),
        subtotal
      );
      const shipFee = Math.round(Number(b.ship_fee) || 0);
      // Phí ship khách chịu thì cộng vào tiền khách phải trả
      const shipCharged = b.ship_payer === 'customer' ? shipFee : 0;
      const total = subtotal - discount + vatAmount + shipCharged;
      const paid = Math.max(0, Math.min(Math.round(Number(b.paid) || 0), total));
      const changeGiven = Math.max(0, Math.round(Number(b.received) || 0) - paid);
      const code = b.code?.trim() || nextCode('sales', 'HD');

      // Number(undefined) là NaN, mà ?? không bắt NaN — phải kiểm tra trước khi ép kiểu
      const num = (v, fallback) =>
        v === undefined || v === null || v === '' || Number.isNaN(Number(v))
          ? fallback
          : Math.round(Number(v));
      const cashAmount = num(b.cash_amount, b.payment_method === 'cash' ? paid : 0);
      const transferAmount = num(b.transfer_amount, b.payment_method === 'transfer' ? paid : 0);

      const hasDelivery = !!(b.delivery_address || b.carrier_id || b.tracking_code);

      const info = run(`
        INSERT INTO sales(code, ts, customer_id, warehouse_id, user_id, price_list_id,
                          subtotal, discount, discount_type, discount_percent,
                          vat_amount, total, cogs, paid, change_given,
                          payment_method, cash_amount, transfer_amount, status, is_vat_invoice, note,
                          delivery_name, delivery_phone, delivery_address, carrier_id, tracking_code,
                          ship_fee, ship_payer, cod_amount, delivery_status, delivery_note)
        VALUES(?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'done', ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [code, b.ts || null, b.customer_id || null, warehouseId, b.user_id || null,
          b.price_list_id || null, subtotal, discount, discountType, discountPercent,
          vatAmount, total, cogs, paid, changeGiven,
          b.payment_method || 'cash', cashAmount, transferAmount,
          b.is_vat_invoice ? 1 : 0, b.note || null,
          b.delivery_name || null, b.delivery_phone || null, b.delivery_address || null,
          b.carrier_id || null, b.tracking_code || null,
          shipFee, b.ship_payer || 'shop', Math.round(Number(b.cod_amount) || 0),
          hasDelivery ? (b.delivery_status || 'pending') : null, b.delivery_note || null]);
      const saleId = Number(info.lastInsertRowid);

      for (const it of items) {
        const factor = Number(it.factor) || 1;
        // Hạn bảo hành tính sẵn từ số tháng nhập tay, để tra cứu cho nhanh
        const wm = Number(it.warranty_months) || 0;
        const wUntil = wm > 0
          ? get("SELECT date(COALESCE(?, datetime('now','localtime')), '+' || ? || ' months') AS d",
              [b.ts || null, wm]).d
          : null;

        run(`INSERT INTO sale_items(sale_id, product_id, name_snapshot, unit_name, factor, qty,
                                    price, discount, discount_type, discount_percent,
                                    vat_rate, unit_cost, amount, note,
                                    warranty_months, warranty_until, serial)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [saleId, it.product_id, it.name_snapshot || '', it.unit_name, factor, Number(it.qty),
            Math.round(Number(it.price) || 0), it._discount,
            it.discount_type === 'percent' ? 'percent' : 'amount',
            Number(it.discount_percent) || 0,
            Number(it.vat_rate) || 0, it._unitCost, it._amount, it.note || null,
            wm, wUntil, it.serial?.trim() || null]);
        moveStock({
          productId: it.product_id, warehouseId, qtyChange: -(Number(it.qty) * factor),
          unitCost: it._unitCost, refType: 'sale', refId: saleId, refCode: code,
          note: `Bán ${it.qty} ${it.unit_name}`, ts: b.ts || null,
        });
      }

      // Ghi quỹ: tiền mặt và chuyển khoản vào 2 tài khoản khác nhau
      const cust = b.customer_id ? get('SELECT name FROM customers WHERE id = ?', [b.customer_id]) : null;
      const partnerName = cust?.name || 'Khách lẻ';
      if (cashAmount > 0) {
        const acc = Number(b.cash_account_id) || defaultCashAccount('cash');
        if (acc) addCashTx({
          accountId: acc, direction: 'in', amount: cashAmount, category: 'sale',
          partnerType: 'customer', partnerId: b.customer_id || null, partnerName,
          refType: 'sale', refId: saleId, refCode: code, userId: b.user_id || null,
          note: `Thu tiền mặt hoá đơn ${code}`, ts: b.ts || null,
        });
      }
      if (transferAmount > 0) {
        const acc = Number(b.transfer_account_id) || defaultCashAccount('bank') || defaultCashAccount('cash');
        if (acc) addCashTx({
          accountId: acc, direction: 'in', amount: transferAmount, category: 'sale',
          partnerType: 'customer', partnerId: b.customer_id || null, partnerName,
          refType: 'sale', refId: saleId, refCode: code, userId: b.user_id || null,
          note: `Thu chuyển khoản hoá đơn ${code}`, ts: b.ts || null,
        });
      }
      return { id: saleId, code, total, paid, change_given: changeGiven };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Khách trả thêm tiền cho hoá đơn nợ. */
r.post('/sales/:id/pay', (req, res) => {
  const s = get('SELECT * FROM sales WHERE id = ?', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Không tìm thấy hoá đơn' });
  const amount = Math.round(Number(req.body.amount) || 0);
  const remaining = s.total - s.paid;
  if (amount <= 0) return res.status(400).json({ error: 'Số tiền phải lớn hơn 0' });
  if (amount > remaining) return res.status(400).json({ error: `Hoá đơn chỉ còn nợ ${remaining.toLocaleString('vi-VN')} đ.` });

  const accountId = Number(req.body.account_id) || defaultCashAccount();
  const cust = s.customer_id ? get('SELECT name FROM customers WHERE id = ?', [s.customer_id]) : null;
  tx(() => {
    run('UPDATE sales SET paid = paid + ? WHERE id = ?', [amount, s.id]);
    if (accountId) addCashTx({
      accountId, direction: 'in', amount, category: 'sale',
      partnerType: 'customer', partnerId: s.customer_id, partnerName: cust?.name || 'Khách lẻ',
      refType: 'sale', refId: s.id, refCode: s.code,
      note: req.body.note || `Thu nợ hoá đơn ${s.code}`,
    });
  });
  res.json({ ok: true, sale: get('SELECT * FROM sales WHERE id = ?', [s.id]) });
});

/** Huỷ hoá đơn: nhập lại kho, hoàn tiền. */
r.post('/sales/:id/cancel', (req, res) => {
  const s = get('SELECT * FROM sales WHERE id = ?', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Không tìm thấy hoá đơn' });
  if (s.status === 'cancelled') return res.status(400).json({ error: 'Hoá đơn này đã bị huỷ' });

  tx(() => {
    const items = all('SELECT * FROM sale_items WHERE sale_id = ?', [s.id]);
    for (const it of items) {
      moveStock({
        productId: it.product_id, warehouseId: s.warehouse_id,
        qtyChange: it.qty * it.factor, unitCost: it.unit_cost,
        refType: 'sale', refId: s.id, refCode: s.code, note: `Huỷ hoá đơn ${s.code}`,
      });
    }
    if (s.paid > 0) {
      const accountId = defaultCashAccount();
      const cust = s.customer_id ? get('SELECT name FROM customers WHERE id = ?', [s.customer_id]) : null;
      if (accountId) addCashTx({
        accountId, direction: 'out', amount: s.paid, category: 'sale_return',
        partnerType: 'customer', partnerId: s.customer_id, partnerName: cust?.name || 'Khách lẻ',
        refType: 'sale', refId: s.id, refCode: s.code,
        note: `Hoàn tiền do huỷ hoá đơn ${s.code}`,
      });
    }
    run("UPDATE sales SET status = 'cancelled', paid = 0 WHERE id = ?", [s.id]);
  });
  res.json({ ok: true });
});

/* ========================== TRẢ HÀNG KHÁCH ========================= */

r.get('/sale-returns', (req, res) => {
  const { from, to, customer_id, limit = 200 } = req.query;
  const where = [];
  const params = [];
  if (customer_id) { where.push('sr.customer_id = ?'); params.push(customer_id); }
  if (from) { where.push('date(sr.ts) >= date(?)'); params.push(from); }
  if (to) { where.push('date(sr.ts) <= date(?)'); params.push(to); }
  res.json(all(`
    SELECT sr.*, c.name AS customer_name, s.code AS sale_code, w.name AS warehouse_name
    FROM sale_returns sr
    LEFT JOIN customers c ON c.id = sr.customer_id
    LEFT JOIN sales s ON s.id = sr.sale_id
    LEFT JOIN warehouses w ON w.id = sr.warehouse_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY sr.id DESC LIMIT ${Number(limit)}`, params));
});

r.get('/sale-returns/:id', (req, res) => {
  const sr = get(`
    SELECT sr.*, c.name AS customer_name, c.phone AS customer_phone,
           s.code AS sale_code, w.name AS warehouse_name
    FROM sale_returns sr
    LEFT JOIN customers c ON c.id = sr.customer_id
    LEFT JOIN sales s ON s.id = sr.sale_id
    LEFT JOIN warehouses w ON w.id = sr.warehouse_id
    WHERE sr.id = ?`, [req.params.id]);
  if (!sr) return res.status(404).json({ error: 'Không tìm thấy phiếu trả hàng' });
  sr.items = all(`
    SELECT i.*, p.name AS product_name, p.sku
    FROM sale_return_items i JOIN products p ON p.id = i.product_id
    WHERE i.return_id = ?`, [sr.id]);
  res.json(sr);
});

r.post('/sale-returns', (req, res) => {
  const b = req.body;
  const items = Array.isArray(b.items) ? b.items.filter((i) => Number(i.qty) > 0) : [];
  if (!items.length) return res.status(400).json({ error: 'Phiếu trả hàng phải có ít nhất 1 mặt hàng' });
  const warehouseId = Number(b.warehouse_id) || get('SELECT id FROM warehouses WHERE is_default = 1')?.id;

  try {
    const result = tx(() => {
      let subtotal = 0;
      for (const it of items) {
        it._amount = Math.round(Number(it.qty) * Math.round(Number(it.price) || 0));
        subtotal += it._amount;
      }
      const fee = Math.round(Number(b.fee) || 0);
      const total = subtotal - fee;
      const refunded = Math.min(Math.round(Number(b.refunded) || 0), Math.max(total, 0));
      const code = nextCode('sale_returns', 'TH');

      const info = run(`
        INSERT INTO sale_returns(code, ts, sale_id, customer_id, warehouse_id, user_id,
                                 subtotal, fee, total, refunded, reason, note)
        VALUES(?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [code, b.ts || null, b.sale_id || null, b.customer_id || null, warehouseId,
          b.user_id || null, subtotal, fee, total, refunded, b.reason || null, b.note || null]);
      const returnId = Number(info.lastInsertRowid);

      for (const it of items) {
        const factor = Number(it.factor) || 1;
        const unitCost = Number(it.unit_cost) || costOf(it.product_id);
        run(`INSERT INTO sale_return_items(return_id, product_id, unit_name, factor, qty, price, unit_cost, amount)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
          [returnId, it.product_id, it.unit_name, factor, Number(it.qty),
            Math.round(Number(it.price) || 0), unitCost, it._amount]);
        moveStock({
          productId: it.product_id, warehouseId, qtyChange: Number(it.qty) * factor,
          unitCost, refType: 'sale_return', refId: returnId, refCode: code,
          note: `Khách trả ${it.qty} ${it.unit_name}`, ts: b.ts || null,
        });
      }

      if (refunded > 0) {
        const accountId = Number(b.account_id) || defaultCashAccount();
        const cust = b.customer_id ? get('SELECT name FROM customers WHERE id = ?', [b.customer_id]) : null;
        if (accountId) addCashTx({
          accountId, direction: 'out', amount: refunded, category: 'sale_return',
          partnerType: 'customer', partnerId: b.customer_id || null,
          partnerName: cust?.name || 'Khách lẻ',
          refType: 'sale_return', refId: returnId, refCode: code,
          note: `Hoàn tiền trả hàng ${code}`, ts: b.ts || null,
        });
      }
      return { id: returnId, code };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ==================================================================== */
/* Hoá đơn tạm — lưu dở trên máy chủ, mọi máy trong tiệm mở tiếp được    */
/* ==================================================================== */

r.get('/drafts', (req, res) => {
  res.json(all(`
    SELECT d.id, d.code, d.ts, d.updated_at, d.title, d.customer_id, d.total, d.item_count,
           d.warehouse_id, d.price_list_id,
           c.name AS customer_name, u.full_name AS user_name
    FROM draft_sales d
    LEFT JOIN customers c ON c.id = d.customer_id
    LEFT JOIN users u ON u.id = d.user_id
    ORDER BY d.updated_at DESC LIMIT 100`));
});

r.get('/drafts/:id', (req, res) => {
  const d = get('SELECT * FROM draft_sales WHERE id = ?', [req.params.id]);
  if (!d) return res.status(404).json({ error: 'Không tìm thấy hoá đơn tạm' });
  try { d.payload = JSON.parse(d.payload); } catch { d.payload = null; }
  res.json(d);
});

/** Lưu mới hoặc ghi đè hoá đơn tạm (truyền id để ghi đè). */
r.post('/drafts', (req, res) => {
  const b = req.body;
  const payload = JSON.stringify(b.payload ?? {});
  const total = Math.round(Number(b.total) || 0);
  const itemCount = Number(b.item_count) || 0;

  if (b.id) {
    const exists = get('SELECT id FROM draft_sales WHERE id = ?', [b.id]);
    if (exists) {
      run(`UPDATE draft_sales SET title = ?, customer_id = ?, user_id = ?, warehouse_id = ?,
             price_list_id = ?, total = ?, item_count = ?, payload = ?,
             updated_at = datetime('now','localtime')
           WHERE id = ?`,
        [b.title || null, b.customer_id || null, b.user_id || null, b.warehouse_id || null,
          b.price_list_id || null, total, itemCount, payload, b.id]);
      return res.json(get('SELECT id, code, title, updated_at FROM draft_sales WHERE id = ?', [b.id]));
    }
  }
  const code = nextCode('draft_sales', 'HDT');
  const info = run(`
    INSERT INTO draft_sales(code, title, customer_id, user_id, warehouse_id, price_list_id,
                            total, item_count, payload)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [code, b.title || null, b.customer_id || null, b.user_id || null, b.warehouse_id || null,
      b.price_list_id || null, total, itemCount, payload]);
  res.json(get('SELECT id, code, title, updated_at FROM draft_sales WHERE id = ?',
    [Number(info.lastInsertRowid)]));
});

r.delete('/drafts/:id', (req, res) => {
  run('DELETE FROM draft_sales WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

/* ==================================================================== */
/* Giá bán 3 lần gần nhất cho một khách — để khỏi báo lệch giá lần trước */
/* ==================================================================== */

r.get('/price-history', (req, res) => {
  const { customer_id, product_id, limit = 3 } = req.query;
  if (!customer_id || !product_id) {
    return res.status(400).json({ error: 'Thiếu khách hàng hoặc mặt hàng.' });
  }
  res.json(all(`
    SELECT s.code, s.ts, si.unit_name, si.qty, si.price, si.discount,
           si.discount_type, si.discount_percent, si.amount
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE s.customer_id = ? AND si.product_id = ? AND s.status = 'done'
    ORDER BY s.id DESC LIMIT ${Number(limit)}`, [customer_id, product_id]));
});

/** Giá gần nhất của TẤT CẢ mặt hàng cho một khách — gọi 1 lần khi chọn khách. */
r.get('/price-history/:customerId/all', (req, res) => {
  const rows = all(`
    SELECT si.product_id, si.unit_name, si.price, s.ts, s.code
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE s.customer_id = ? AND s.status = 'done'
    ORDER BY s.id DESC LIMIT 900`, [req.params.customerId]);
  // Gom tối đa 3 lần gần nhất cho mỗi mặt hàng
  const byProduct = {};
  for (const r2 of rows) {
    const list = byProduct[r2.product_id] || (byProduct[r2.product_id] = []);
    if (list.length < 3) list.push(r2);
  }
  res.json(byProduct);
});

/* ==================================================================== */
/* Thông tin nhanh của khách khi chọn ở màn hình bán hàng                */
/* ==================================================================== */

r.get('/customers/:id/quick', (req, res) => {
  const c = get(`
    SELECT c.id, c.code, c.name, c.phone, c.address, c.debt_limit, c.opening_debt,
           c.note, pl.name AS price_list_name
    FROM customers c LEFT JOIN price_lists pl ON pl.id = c.price_list_id
    WHERE c.id = ?`, [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });

  c.debt = customerDebt(c.id);
  c.over_limit = c.debt_limit > 0 && c.debt > c.debt_limit;
  c.recent_sales = all(`
    SELECT s.id, s.code, s.ts, s.total, s.paid, s.payment_method,
           (s.total - s.paid) AS remaining,
           (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count
    FROM sales s
    WHERE s.customer_id = ? AND s.status = 'done'
    ORDER BY s.id DESC LIMIT 10`, [c.id]);
  c.unpaid_bills = all(`
    SELECT s.id, s.code, s.ts, s.total, s.paid, (s.total - s.paid) AS remaining
    FROM sales s
    WHERE s.customer_id = ? AND s.status = 'done' AND s.total > s.paid
    ORDER BY s.ts LIMIT 20`, [c.id]);
  c.top_products = all(`
    SELECT si.product_id, si.name_snapshot AS name, si.unit_name,
           SUM(si.qty) AS qty, MAX(s.ts) AS last_ts
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.customer_id = ? AND s.status = 'done'
    GROUP BY si.product_id, si.unit_name
    ORDER BY qty DESC LIMIT 8`, [c.id]);
  const agg = get(`
    SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS n, MAX(ts) AS last_ts
    FROM sales WHERE customer_id = ? AND status = 'done'`, [c.id]);
  c.total_spent = agg.total;
  c.order_count = agg.n;
  c.last_order = agg.last_ts;
  res.json(c);
});

/* ==================================================================== */
/* Cập nhật trạng thái giao hàng                                        */
/* ==================================================================== */

r.put('/sales/:id/delivery', (req, res) => {
  const b = req.body;
  const s2 = get('SELECT id FROM sales WHERE id = ?', [req.params.id]);
  if (!s2) return res.status(404).json({ error: 'Không tìm thấy hoá đơn' });
  run(`UPDATE sales SET delivery_status = ?, tracking_code = ?, carrier_id = ?,
         delivery_note = ? WHERE id = ?`,
    [b.delivery_status || null, b.tracking_code || null, b.carrier_id || null,
      b.delivery_note || null, req.params.id]);
  res.json({ ok: true });
});

/* ========================== CÔNG NỢ KHÁCH ========================== */

r.get('/customer-debts', (req, res) => {
  const rows = all('SELECT * FROM customers WHERE active = 1 ORDER BY name');
  const out = [];
  for (const c of rows) {
    const debt = customerDebt(c.id);
    if (debt === 0 && req.query.all !== '1') continue;
    out.push({
      id: c.id, code: c.code, name: c.name, phone: c.phone,
      opening_debt: c.opening_debt, debt_limit: c.debt_limit, debt,
      over_limit: c.debt_limit > 0 && debt > c.debt_limit,
      unpaid_bills: get(
        "SELECT COUNT(*) AS n FROM sales WHERE customer_id = ? AND status = 'done' AND total > paid",
        [c.id]).n,
      oldest_unpaid: get(
        "SELECT MIN(ts) AS ts FROM sales WHERE customer_id = ? AND status = 'done' AND total > paid",
        [c.id]).ts,
    });
  }
  res.json(out);
});

export default r;
