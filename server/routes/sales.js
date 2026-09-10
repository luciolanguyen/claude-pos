import { Router } from 'express';
import {
  all, get, run, tx, nextCode, moveStock, costOf,
  addCashTx, defaultCashAccount, customerDebt, getSettings, pageParams } from '../db.js';

const r = Router();

/* ============================ HOÁ ĐƠN BÁN ========================== */

r.get('/sales', (req, res) => {
  const { q = '', customer_id, from, to, status, payment_method, unpaid, user_id } = req.query;
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

  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { page, size, offset } = pageParams(req.query);
  const total = get(`
    SELECT COUNT(*) AS n
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
    ${w}`, params).n;

  const rows = all(`
    SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, c.code AS customer_code,
           u.full_name AS user_name, w.name AS warehouse_name,
           (s.total - s.paid) AS remaining,
           (s.total - s.vat_amount - s.cogs) AS profit,
           (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
    ${w}
    ORDER BY s.id DESC LIMIT ${size} OFFSET ${offset}`, params);
  /* Tổng của cả bộ lọc, để thẻ số liệu phía trên không phụ thuộc trang */
  const sums = get(`
    SELECT COUNT(*) AS count,
           COALESCE(SUM(s.total), 0) AS revenue,
           COALESCE(SUM(s.total - s.vat_amount - s.cogs), 0) AS profit,
           COALESCE(SUM(MAX(s.total - s.paid, 0)), 0) AS unpaid
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    ${w ? w + " AND s.status = 'done'" : "WHERE s.status = 'done'"}`, params);
  res.json({ rows, total, page, page_size: size, totals: sums });
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

/** Lỗi nghiệp vụ có mã, để tay xử lý route đổi thành HTTP 400. */
function badRequest(message, code) {
  const e = new Error(message);
  e.status = 400;
  if (code) e.code = code;
  return e;
}

/**
 * Lập một hoá đơn bán hàng. Dùng chung cho màn hình bán hàng và cho
 * việc giao hàng của đơn đặt hàng, nên tách khỏi tay xử lý HTTP.
 * Ném lỗi nếu thiếu hàng trong kho hoặc vượt hạn mức công nợ.
 */
export function createSale(b) {
  const items = Array.isArray(b.items) ? b.items.filter((i) => Number(i.qty) > 0) : [];
  if (!items.length) throw badRequest('Hoá đơn phải có ít nhất 1 mặt hàng');

  const warehouseId = Number(b.warehouse_id) || get('SELECT id FROM warehouses WHERE is_default = 1')?.id;
  if (!warehouseId) throw badRequest('Chưa thiết lập kho');

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
        throw badRequest(
          `"${p.name}" chỉ còn ${st?.qty ?? 0} trong kho, không đủ bán ${qtyBase}.`
          , 'INSUFFICIENT_STOCK');
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
        throw badRequest(
          `Công nợ của "${c.name}" sẽ là ${willOwe.toLocaleString('vi-VN')} đ, vượt hạn mức ${c.debt_limit.toLocaleString('vi-VN')} đ.`
          , 'DEBT_LIMIT');
      }
    }
  }

  return tx(() => {
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
}

r.post('/sales', (req, res) => {
  try {
    res.json(createSale(req.body));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
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
  const { from, to, customer_id } = req.query;
  const where = [];
  const params = [];
  if (customer_id) { where.push('sr.customer_id = ?'); params.push(customer_id); }
  if (from) { where.push('date(sr.ts) >= date(?)'); params.push(from); }
  if (to) { where.push('date(sr.ts) <= date(?)'); params.push(to); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const { page, size, offset } = pageParams(req.query);
  const total = get(`
    SELECT COUNT(*) AS n
    FROM sale_returns sr
    LEFT JOIN customers c ON c.id = sr.customer_id
    LEFT JOIN sales s ON s.id = sr.sale_id
    LEFT JOIN warehouses w ON w.id = sr.warehouse_id
    ${w}`, params).n;

  const rows = all(`
    SELECT sr.*, c.name AS customer_name, s.code AS sale_code, w.name AS warehouse_name
    FROM sale_returns sr
    LEFT JOIN customers c ON c.id = sr.customer_id
    LEFT JOIN sales s ON s.id = sr.sale_id
    LEFT JOIN warehouses w ON w.id = sr.warehouse_id
    ${w}
    ORDER BY sr.id DESC LIMIT ${size} OFFSET ${offset}`, params);
  const sums = get(`
    SELECT COUNT(*) AS count,
           COALESCE(SUM(sr.total), 0) AS total,
           COALESCE(SUM(sr.refunded), 0) AS refunded
    FROM sale_returns sr
    LEFT JOIN customers c ON c.id = sr.customer_id
    ${w}`, params);
  res.json({ rows, total, page, page_size: size, totals: sums });
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

/**
 * Lập phiếu khách trả hàng. Dùng chung cho màn hình Hoá đơn và cho việc
 * đổi hàng tại quầy, nên tách khỏi tay xử lý HTTP.
 *
 * Trả về { id, code, total } — total là tiền hàng trả lại sau khi trừ phí.
 */
export function createSaleReturn(b) {
  const items = Array.isArray(b.items) ? b.items.filter((i) => Number(i.qty) > 0) : [];
  if (!items.length) throw badRequest('Phiếu trả hàng phải có ít nhất 1 mặt hàng');
  const warehouseId = Number(b.warehouse_id) || get('SELECT id FROM warehouses WHERE is_default = 1')?.id;

  return tx(() => {
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
    return { id: returnId, code, total, subtotal, fee, refunded };
  });
}

r.post('/sale-returns', (req, res) => {
  try {
    res.json(createSaleReturn(req.body));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

/* ==================================================================== *
 * ĐỔI HÀNG TẠI QUẦY
 *
 * Khách trả món cũ rồi lấy món khác. Phần mềm làm hai chứng từ nối với
 * nhau — một phiếu trả hàng và một hoá đơn mới — rồi bù trừ tiền:
 *
 *   tiền hàng trả lại  >=  tiền hàng mới  ->  tiệm hoàn phần chênh
 *   tiền hàng trả lại  <   tiền hàng mới  ->  khách bù phần chênh
 *
 * Phần bù trừ KHÔNG chạy qua quỹ, vì tiền đó chưa từng ra vào két. Chỉ
 * phần chênh lệch thật sự mới ghi thu hoặc chi.
 * ==================================================================== */

r.post('/sale-exchanges', (req, res) => {
  const b = req.body;
  const backItems = Array.isArray(b.return_items) ? b.return_items.filter((i) => Number(i.qty) > 0) : [];
  const newItems = Array.isArray(b.new_items) ? b.new_items.filter((i) => Number(i.qty) > 0) : [];
  if (!backItems.length) {
    return res.status(400).json({ error: 'Chưa chọn món khách trả lại' });
  }

  try {
    const out = tx(() => {
      const ret = createSaleReturn({
        ts: b.ts || null,
        sale_id: b.sale_id || null,
        customer_id: b.customer_id || null,
        warehouse_id: b.warehouse_id,
        user_id: b.user_id || null,
        items: backItems,
        fee: b.fee || 0,
        refunded: 0,          // chưa hoàn tiền vội, còn chờ bù trừ bên dưới
        reason: b.reason || 'Đổi hàng',
        note: b.note || null,
      });
      const credit = Math.max(0, ret.total);   // tiền khách được trừ

      // Không lấy món mới nào: thành phiếu trả hàng thường, hoàn tiền luôn
      if (!newItems.length) {
        /* Không truyền refund thì hoàn hết. Phải kiểm tra trước khi ép kiểu:
           Number(undefined) ra NaN mà ?? không bắt NaN, nên viết
           "Number(b.refund) ?? credit" sẽ ra NaN và khách không được hoàn đồng nào. */
        const asked = b.refund === undefined || b.refund === null || b.refund === ''
          || Number.isNaN(Number(b.refund))
          ? credit
          : Math.round(Number(b.refund));
        const refund = Math.max(0, Math.min(asked, credit));
        if (refund > 0) {
          const accountId = Number(b.account_id) || defaultCashAccount();
          const cust = b.customer_id ? get('SELECT name FROM customers WHERE id = ?', [b.customer_id]) : null;
          if (accountId) addCashTx({
            accountId, direction: 'out', amount: refund, category: 'sale_return',
            partnerType: 'customer', partnerId: b.customer_id || null,
            partnerName: cust?.name || 'Khách lẻ',
            refType: 'sale_return', refId: ret.id, refCode: ret.code,
            userId: b.user_id || null, note: `Hoàn tiền trả hàng ${ret.code}`, ts: b.ts || null,
          });
          run('UPDATE sale_returns SET refunded = ? WHERE id = ?', [refund, ret.id]);
        }
        return {
          return_id: ret.id, return_code: ret.code, credit,
          sale_id: null, sale_code: null, sale_total: 0,
          customer_pays: 0, shop_refunds: refund,
        };
      }

      const paidExtra = Math.round(Number(b.paid) || 0);
      // Lập hoá đơn mới trước để biết tổng chính xác, rồi mới chia tiền
      const sale = createSale({
        ts: b.ts || null,
        customer_id: b.customer_id || null,
        warehouse_id: b.warehouse_id,
        price_list_id: b.price_list_id || null,
        user_id: b.user_id || null,
        items: newItems,
        discount_type: b.discount_type || 'amount',
        discount: b.discount || 0,
        discount_percent: b.discount_percent || 0,
        is_vat_invoice: b.is_vat_invoice ? 1 : 0,
        // Phần trừ từ hàng trả lại tính là đã trả, nhưng không ghi vào quỹ
        paid: 0,
        received: 0,
        payment_method: b.payment_method || 'cash',
        cash_amount: 0,
        transfer_amount: 0,
        note: `Đổi hàng theo phiếu ${ret.code}${b.note ? ' — ' + b.note : ''}`,
      });

      const used = Math.min(credit, sale.total);          // phần bù trừ
      const customerPays = Math.max(0, sale.total - credit);
      const shopRefunds = Math.max(0, credit - sale.total);

      // Ghi nhận phần bù trừ + phần khách trả thêm vào hoá đơn mới
      const cashIn = Math.min(paidExtra, customerPays);
      run('UPDATE sales SET paid = ? WHERE id = ?', [used + cashIn, sale.id]);

      const cust = b.customer_id ? get('SELECT name FROM customers WHERE id = ?', [b.customer_id]) : null;
      const partnerName = cust?.name || 'Khách lẻ';
      const accountId = Number(b.account_id) || defaultCashAccount();

      if (cashIn > 0 && accountId) {
        const isTransfer = b.payment_method === 'transfer';
        run('UPDATE sales SET cash_amount = ?, transfer_amount = ? WHERE id = ?',
          [isTransfer ? 0 : cashIn, isTransfer ? cashIn : 0, sale.id]);
        addCashTx({
          accountId, direction: 'in', amount: cashIn, category: 'sale',
          partnerType: 'customer', partnerId: b.customer_id || null, partnerName,
          refType: 'sale', refId: sale.id, refCode: sale.code, userId: b.user_id || null,
          note: `Khách bù thêm khi đổi hàng ${sale.code}`, ts: b.ts || null,
        });
      }
      if (shopRefunds > 0) {
        if (accountId) addCashTx({
          accountId, direction: 'out', amount: shopRefunds, category: 'sale_return',
          partnerType: 'customer', partnerId: b.customer_id || null, partnerName,
          refType: 'sale_return', refId: ret.id, refCode: ret.code, userId: b.user_id || null,
          note: `Hoàn phần chênh khi đổi hàng ${ret.code}`, ts: b.ts || null,
        });
        run('UPDATE sale_returns SET refunded = ? WHERE id = ?', [shopRefunds, ret.id]);
      }
      run('UPDATE sale_returns SET exchange_sale_id = ? WHERE id = ?', [sale.id, ret.id]);

      return {
        return_id: ret.id, return_code: ret.code, credit,
        sale_id: sale.id, sale_code: sale.code, sale_total: sale.total,
        applied: used,
        customer_pays: customerPays,
        paid_now: cashIn,
        still_owed: Math.max(0, customerPays - cashIn),
        shop_refunds: shopRefunds,
      };
    });
    res.json(out);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
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

/**
 * Các chặng của một đơn giao hàng, theo đúng thứ tự ngoài đời:
 *
 *   pending   hàng đã xuất hoá đơn, còn nằm ở tiệm chờ người tới lấy
 *   shipping  shipper đã cầm hàng đi
 *   delivered khách đã nhận được hàng
 *   collected tiền đã về tới tiệm            <- chặng cuối của đơn thu hộ
 *   returned  giao không được, hàng quay về tiệm
 *   cancelled bỏ giao
 *
 * Tách "đã giao" khỏi "đã thu tiền" là chuyện bắt buộc với đơn thu hộ:
 * khách cầm hàng rồi nhưng tiền còn nằm trong túi shipper, tiệm vẫn đang
 * bị nợ. Gộp hai chặng làm một là mất dấu khoản tiền đó.
 */
export const DELIVERY_STATUSES = ['pending', 'shipping', 'delivered', 'collected', 'returned', 'cancelled'];

/** Cột mốc thời gian tương ứng với từng chặng, để biết đơn đi mấy ngày rồi. */
const STAMP_OF = { shipping: 'shipped_at', delivered: 'delivered_at', collected: 'collected_at' };

/** Danh sách đơn đang giao — bảng theo dõi ở quầy. */
r.get('/deliveries', (req, res) => {
  const { status = '', q = '', carrier_id, from, to, active } = req.query;
  const where = ['s.delivery_status IS NOT NULL', "s.status = 'done'"];
  const params = [];
  if (status) { where.push('s.delivery_status = ?'); params.push(status); }
  /* Mặc định chỉ hiện đơn CHƯA xong: đơn đã thu tiền hoặc đã bỏ thì không
     còn phải trông nữa, để lẫn vào chỉ làm rối bảng theo dõi. */
  if (active === '1') where.push("s.delivery_status IN ('pending','shipping','delivered')");
  if (carrier_id) { where.push('s.carrier_id = ?'); params.push(carrier_id); }
  if (from) { where.push('date(s.ts) >= date(?)'); params.push(from); }
  if (to) { where.push('date(s.ts) <= date(?)'); params.push(to); }
  if (q.trim()) {
    where.push(`(s.code LIKE ? OR s.delivery_name LIKE ? OR s.delivery_phone LIKE ?
                 OR s.delivery_address LIKE ? OR s.tracking_code LIKE ? OR s.shipper_name LIKE ?)`);
    const like = `%${q.trim()}%`;
    params.push(like, like, like, like, like, like);
  }
  const w = 'WHERE ' + where.join(' AND ');
  const { page, size, offset } = pageParams(req.query, 20);

  const agg = get(`
    SELECT COUNT(*) AS n,
           COALESCE(SUM(CASE WHEN s.delivery_status IN ('pending','shipping','delivered')
                             THEN s.total - s.paid END), 0) AS pending_money
    FROM sales s ${w}`, params);

  const rows = all(`
    SELECT s.id, s.code, s.ts, s.total, s.paid, s.cod_amount, s.ship_fee, s.ship_payer,
           s.delivery_status, s.delivery_name, s.delivery_phone, s.delivery_address,
           s.tracking_code, s.delivery_note, s.shipper_name,
           s.shipped_at, s.delivered_at, s.collected_at,
           s.carrier_id, ca.name AS carrier_name,
           c.name AS customer_name, c.phone AS customer_phone,
           u.full_name AS user_name,
           s.total - s.paid AS owed,
           CAST(julianday('now','localtime') - julianday(s.ts) AS INTEGER) AS days_out
    FROM sales s
    LEFT JOIN carriers ca ON ca.id = s.carrier_id
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN users u ON u.id = s.user_id
    ${w}
    ORDER BY s.id DESC LIMIT ${size} OFFSET ${offset}`, params);

  /* Đếm theo từng chặng để hiện con số trên các thẻ lọc */
  const counts = {};
  for (const row of all(`
    SELECT s.delivery_status AS st, COUNT(*) AS n FROM sales s
    WHERE s.delivery_status IS NOT NULL AND s.status = 'done'
    GROUP BY s.delivery_status`)) counts[row.st] = row.n;

  res.json({ rows, total: agg.n, page, page_size: size, counts, pending_money: agg.pending_money });
});

/**
 * Chuyển chặng của một đơn giao.
 *
 * Chuyện tiền: sang chặng "đã thu tiền" mà hoá đơn còn thiếu thì shipper
 * vừa mang tiền về — phải ghi phiếu thu và trừ nợ ngay tại đây. Nếu chỉ
 * đổi chữ trạng thái, đơn coi như giao xong nhưng sổ vẫn treo nợ khách,
 * và cuối tháng chủ tiệm đi đòi một khoản đã thu rồi.
 */
r.put('/sales/:id/delivery', (req, res) => {
  const b = req.body;
  const sale = get('SELECT * FROM sales WHERE id = ?', [req.params.id]);
  if (!sale) return res.status(404).json({ error: 'Không tìm thấy hoá đơn' });

  const next = b.delivery_status === undefined ? sale.delivery_status : (b.delivery_status || null);
  if (next && !DELIVERY_STATUSES.includes(next)) {
    return res.status(400).json({ error: 'Trạng thái giao hàng không hợp lệ: ' + next });
  }

  try {
    const out = tx(() => {
      const changed = next !== sale.delivery_status;
      const stamp = changed && STAMP_OF[next] ? STAMP_OF[next] : null;

      /* Giữ nguyên trường nào không gửi lên — màn hình theo dõi chỉ đổi
         trạng thái, không nên xoá mất mã vận đơn đã nhập từ trước. */
      const keep = (v, old) => (v === undefined ? old : (v || null));

      run(`UPDATE sales SET delivery_status = ?, tracking_code = ?, carrier_id = ?,
             delivery_note = ?, shipper_name = ?
             ${stamp ? `, ${stamp} = COALESCE(${stamp}, datetime('now','localtime'))` : ''}
           WHERE id = ?`,
        [next, keep(b.tracking_code, sale.tracking_code), keep(b.carrier_id, sale.carrier_id),
          keep(b.delivery_note, sale.delivery_note), keep(b.shipper_name, sale.shipper_name),
          sale.id]);

      let receipt = null;
      const owed = sale.total - sale.paid;
      /* Tiền về tiệm: ghi phiếu thu và trừ nợ. Chỉ làm khi thật sự còn
         thiếu — đơn đã trả trước rồi thì chuyển chặng không sinh tiền. */
      if (changed && next === 'collected' && owed > 0 && b.skip_payment !== true) {
        const amount = Math.min(
          b.amount === undefined || b.amount === null || b.amount === ''
            || Number.isNaN(Number(b.amount))
            ? owed
            : Math.round(Number(b.amount)),
          owed);
        if (amount > 0) {
          const accountId = Number(b.account_id) || defaultCashAccount();
          if (!accountId) throw Object.assign(new Error('Chưa thiết lập quỹ tiền'), { status: 400 });
          const cust = sale.customer_id
            ? get('SELECT name FROM customers WHERE id = ?', [sale.customer_id]) : null;
          receipt = addCashTx({
            accountId, direction: 'in', amount, category: 'sale',
            partnerType: 'customer', partnerId: sale.customer_id || null,
            partnerName: cust?.name || sale.delivery_name || 'Khách lẻ',
            refType: 'sale', refId: sale.id, refCode: sale.code,
            userId: b.user_id || req.user?.id || null,
            note: `Shipper nộp tiền đơn giao ${sale.code}`,
          });
          run('UPDATE sales SET paid = paid + ? WHERE id = ?', [amount, sale.id]);
        }
      }
      return { ok: true, receipt, sale: get('SELECT * FROM sales WHERE id = ?', [sale.id]) };
    });
    res.json(out);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

/** Một đơn giao kèm danh sách hàng — để in phiếu giao cho shipper. */
r.get('/deliveries/:id', (req, res) => {
  const sale = get(`
    SELECT s.*, c.name AS customer_name, c.phone AS customer_phone,
           ca.name AS carrier_name, u.full_name AS user_name
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN carriers ca ON ca.id = s.carrier_id
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.id = ?`, [req.params.id]);
  if (!sale) return res.status(404).json({ error: 'Không tìm thấy hoá đơn' });
  sale.items = all(`
    SELECT si.*, p.base_unit
    FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
    WHERE si.sale_id = ? ORDER BY si.id`, [sale.id]);
  sale.owed = sale.total - sale.paid;
  res.json(sale);
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
      // Nợ lâu nhất bao nhiêu ngày — để màn hình bán hàng tô đỏ khoản nợ dai
      oldest_days: get(
        `SELECT CAST(julianday('now','localtime') - julianday(MIN(ts)) AS INTEGER) AS d
         FROM sales WHERE customer_id = ? AND status = 'done' AND total > paid`,
        [c.id]).d || 0,
    });
  }
  res.json(out);
});

export default r;
