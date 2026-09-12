/* ====================================================================
   ĐƠN ĐẶT HÀNG CỦA KHÁCH

   Khách hỏi mua món tiệm chưa có, hoặc mua số lượng lớn cần gom hàng.
   Ghi đơn lại, nhận cọc, hẹn ngày giao. Hàng về thì giao — có thể giao
   làm nhiều đợt, mỗi đợt xuất một hoá đơn riêng và tự trừ dần tiền cọc.

   Đơn đặt hàng KHÔNG trừ kho. Kho chỉ trừ lúc xuất hoá đơn giao hàng,
   vì hàng chưa chắc đã có trong tiệm lúc nhận đơn.

   Đợt 14 (tài liệu 12): mỗi lần nhận cọc ghi rõ AI đưa tiền; mỗi đợt giao
   chọn khách tự lấy hay giao tận nơi; và chi tiết đơn trả kèm khối tổng kết
   (hàng đặt, các lần giao, các lần cọc, còn nợ) để in phiếu tổng kết theo
   thời gian thực.
   ==================================================================== */
import { Router } from 'express';
import {
  all, get, run, tx, nextCode, addCashTx, defaultCashAccount, getSettings, resolveUnitId,
} from '../db.js';
import { createSale } from './sales.js';

const r = Router();

const money = (v) => Math.round(Number(v) || 0);
const num = (v, d = 0) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

/** Tiền một dòng sau giảm giá. Dùng chung cách tính với hoá đơn bán. */
function lineAmount(it) {
  const gross = Math.round(num(it.qty) * money(it.price));
  const disc = it.discount_type === 'percent'
    ? Math.round(gross * num(it.discount_percent) / 100)
    : money(it.discount);
  return { gross, discount: Math.min(disc, gross), amount: gross - Math.min(disc, gross) };
}

/** Tính lại tổng tiền của đơn từ các dòng hàng. */
function totalsOf(items, b) {
  let subtotal = 0;
  for (const it of items) subtotal += lineAmount(it).amount;
  const type = b.discount_type === 'percent' ? 'percent' : 'amount';
  const percent = type === 'percent' ? num(b.discount_percent) : 0;
  const discount = Math.min(
    type === 'percent' ? Math.round(subtotal * percent / 100) : money(b.discount),
    subtotal
  );
  return { subtotal, discount, discountType: type, discountPercent: percent, total: subtotal - discount };
}

/** Đơn đã giao hết chưa. So sánh có nới 0.0001 vì số lượng là số thực. */
function statusFromItems(orderId, current) {
  if (current === 'cancelled') return 'cancelled';
  const rows = all('SELECT qty, delivered_qty FROM sale_order_items WHERE order_id = ?', [orderId]);
  if (!rows.length) return 'open';
  const anyDone = rows.some((x) => x.delivered_qty > 0.0001);
  const allDone = rows.every((x) => x.delivered_qty >= x.qty - 0.0001);
  if (allDone) return 'done';
  return anyDone ? 'partial' : 'open';
}

/** Cập nhật trạng thái đơn sau khi giao. */
function refreshStatus(orderId) {
  const o = get('SELECT status FROM sale_orders WHERE id = ?', [orderId]);
  if (!o) return;
  const next = statusFromItems(orderId, o.status);
  run("UPDATE sale_orders SET status = ?, closed_at = CASE WHEN ? = 'done' THEN datetime('now','localtime') ELSE NULL END WHERE id = ?",
    [next, next, orderId]);
}

/** Tên khách đứng trên đơn — dùng làm người đưa cọc mặc định. */
function orderCustomerName(o) {
  if (o?.customer_id) {
    const c = get('SELECT name FROM customers WHERE id = ?', [o.customer_id]);
    if (c?.name) return c.name;
  }
  return o?.customer_name || 'Khách lẻ';
}

/* =========================== DANH SÁCH ============================= */

r.get('/orders', (req, res) => {
  const {
    q = '', customer_id, status, from, to, late, page = 1, page_size = 20,
  } = req.query;
  const where = [];
  const params = [];
  if (q.trim()) {
    const like = `%${q.trim()}%`;
    where.push('(o.code LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)');
    params.push(like, like, like, like, like);
  }
  if (customer_id) { where.push('o.customer_id = ?'); params.push(customer_id); }
  if (status) { where.push('o.status = ?'); params.push(status); }
  if (from) { where.push('date(o.ts) >= date(?)'); params.push(from); }
  if (to) { where.push('date(o.ts) <= date(?)'); params.push(to); }
  // Trễ hẹn: quá ngày hẹn mà chưa giao xong
  if (late === '1') {
    where.push("o.status IN ('open','partial') AND o.promised_at IS NOT NULL AND date(o.promised_at) < date('now','localtime')");
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = get(`SELECT COUNT(*) AS n FROM sale_orders o
    LEFT JOIN customers c ON c.id = o.customer_id ${w}`, params).n;

  const size = Math.min(Math.max(Number(page_size) || 20, 1), 200);
  const p = Math.max(Number(page) || 1, 1);

  const rows = all(`
    SELECT o.*,
           COALESCE(c.name, o.customer_name, 'Khách lẻ') AS customer_display,
           COALESCE(c.phone, o.customer_phone) AS phone_display,
           u.full_name AS user_name,
           (o.deposit - o.deposit_used) AS deposit_left,
           (SELECT COUNT(*) FROM sale_order_items i WHERE i.order_id = o.id) AS item_count,
           (SELECT COUNT(*) FROM sale_order_items i
             WHERE i.order_id = o.id AND i.delivered_qty < i.qty - 0.0001) AS pending_lines,
           (SELECT COUNT(*) FROM sale_order_deliveries d WHERE d.order_id = o.id) AS delivery_count,
           CASE WHEN o.status IN ('open','partial') AND o.promised_at IS NOT NULL
                     AND date(o.promised_at) < date('now','localtime')
                THEN 1 ELSE 0 END AS is_late
    FROM sale_orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN users u ON u.id = o.user_id
    ${w}
    ORDER BY o.id DESC
    LIMIT ${size} OFFSET ${(p - 1) * size}`, params);

  res.json({ rows, total, page: p, page_size: size });
});

/** Số liệu nhanh cho thẻ tóm tắt phía trên danh sách. */
r.get('/orders-summary', (req, res) => {
  const s = get(`
    SELECT
      SUM(CASE WHEN status IN ('open','partial') THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE WHEN status IN ('open','partial') THEN total - deposit_used ELSE 0 END) AS open_value,
      SUM(CASE WHEN status IN ('open','partial') THEN deposit - deposit_used ELSE 0 END) AS deposit_held,
      SUM(CASE WHEN status IN ('open','partial') AND promised_at IS NOT NULL
                    AND date(promised_at) < date('now','localtime') THEN 1 ELSE 0 END) AS late_count
    FROM sale_orders`);
  res.json({
    open_count: s?.open_count || 0,
    open_value: s?.open_value || 0,
    deposit_held: s?.deposit_held || 0,
    late_count: s?.late_count || 0,
  });
});

/* ================= GỢI Ý MUA HÀNG ĐỂ GIAO ĐƠN ====================== *
 * Gom những mặt hàng đã nhận đơn nhưng chưa giao, trừ đi tồn kho hiện
 * có, ra số còn thiếu. Gộp thêm hàng dưới tồn tối thiểu để chủ tiệm gọi
 * cho mối một lần là mua đủ.                                          */

r.get('/orders-shortage', (req, res) => {
  const rows = all(`
    SELECT
      p.id AS product_id, p.sku, p.name, p.base_unit, p.min_stock,
      s.supplier_id, sup.name AS supplier_name, sup.phone AS supplier_phone,
      COALESCE(st.qty, 0) AS stock_qty,
      COALESCE(pend.qty_base, 0) AS ordered_qty,
      p.cost_price
    FROM products p
    LEFT JOIN (
      SELECT i.product_id, SUM((i.qty - i.delivered_qty) * i.factor) AS qty_base
      FROM sale_order_items i
      JOIN sale_orders o ON o.id = i.order_id
      WHERE o.status IN ('open','partial') AND i.qty - i.delivered_qty > 0.0001
      GROUP BY i.product_id
    ) pend ON pend.product_id = p.id
    LEFT JOIN (
      SELECT product_id, SUM(qty) AS qty FROM stock GROUP BY product_id
    ) st ON st.product_id = p.id
    LEFT JOIN (
      SELECT pi.product_id, MAX(pu.id) AS last_purchase, pu.supplier_id
      FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
      WHERE pu.status = 'done'
      GROUP BY pi.product_id
    ) s ON s.product_id = p.id
    LEFT JOIN suppliers sup ON sup.id = s.supplier_id
    WHERE p.active = 1 AND p.track_stock = 1
      AND (COALESCE(pend.qty_base, 0) > 0 OR COALESCE(st.qty, 0) <= p.min_stock)
    ORDER BY sup.name, p.name`);

  // Thiếu bao nhiêu = (đã nhận đơn + tồn tối thiểu) - đang có
  const out = [];
  for (const x of rows) {
    const need = x.ordered_qty + (x.min_stock || 0);
    const short = Math.round((need - x.stock_qty) * 1000) / 1000;
    if (short <= 0) continue;
    out.push({
      ...x,
      need,
      shortage: short,
      est_cost: Math.round(short * (x.cost_price || 0)),
      reason: x.ordered_qty > 0 ? 'order' : 'min_stock',
    });
  }
  const bySupplier = [];
  for (const it of out) {
    const key = it.supplier_id || 0;
    let g = bySupplier.find((x) => x.supplier_id === key);
    if (!g) {
      g = {
        supplier_id: key || null,
        supplier_name: it.supplier_name || 'Chưa rõ mối nhập',
        supplier_phone: it.supplier_phone || null,
        items: [], est_cost: 0,
      };
      bySupplier.push(g);
    }
    g.items.push(it);
    g.est_cost += it.est_cost;
  }
  res.json({
    groups: bySupplier,
    total_items: out.length,
    est_cost: out.reduce((a, x) => a + x.est_cost, 0),
  });
});

/* ============================ CHI TIẾT ============================= */

r.get('/orders/:id', (req, res) => {
  const o = get(`
    SELECT o.*,
           COALESCE(c.name, o.customer_name, 'Khách lẻ') AS customer_display,
           COALESCE(c.phone, o.customer_phone) AS phone_display,
           c.address AS customer_address, c.code AS customer_code,
           u.full_name AS user_name, w.name AS warehouse_name,
           pl.name AS price_list_name, ca.name AS carrier_name,
           (o.deposit - o.deposit_used) AS deposit_left
    FROM sale_orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN warehouses w ON w.id = o.warehouse_id
    LEFT JOIN price_lists pl ON pl.id = o.price_list_id
    LEFT JOIN carriers ca ON ca.id = o.carrier_id
    WHERE o.id = ?`, [req.params.id]);
  if (!o) return res.status(404).json({ error: 'Không tìm thấy đơn đặt hàng' });

  o.items = all(`
    SELECT i.*, p.sku, p.base_unit, p.barcode,
           (i.qty - i.delivered_qty) AS remaining_qty,
           COALESCE(st.qty, 0) AS stock_qty
    FROM sale_order_items i
    LEFT JOIN products p ON p.id = i.product_id
    LEFT JOIN (SELECT product_id, SUM(qty) AS qty FROM stock GROUP BY product_id) st
           ON st.product_id = i.product_id
    WHERE i.order_id = ?
    ORDER BY i.id`, [o.id]);

  o.deliveries = all(`
    SELECT d.*, s.code AS sale_code, s.total AS sale_total, s.paid AS sale_paid,
           s.vat_amount AS sale_vat, s.ship_fee, s.ship_payer, s.status AS sale_status,
           s.delivery_status, s.cod_status, s.cod_amount, s.delivery_name, s.delivery_phone,
           s.delivery_address, ca.name AS carrier_name, s.shipper_name,
           u.full_name AS user_name
    FROM sale_order_deliveries d
    LEFT JOIN sales s ON s.id = d.sale_id
    LEFT JOIN carriers ca ON ca.id = s.carrier_id
    LEFT JOIN users u ON u.id = d.user_id
    WHERE d.order_id = ? ORDER BY d.id`, [o.id]);
  o.deliveries.forEach((d, i) => {
    d.seq = i + 1;
    d.items = d.sale_id
      ? all('SELECT name_snapshot, unit_name, qty, amount FROM sale_items WHERE sale_id = ? ORDER BY id', [d.sale_id])
      : [];
  });

  o.deposits = all(`
    SELECT dp.*, a.name AS account_name, u.full_name AS user_name
    FROM sale_order_deposits dp
    LEFT JOIN cash_accounts a ON a.id = dp.account_id
    LEFT JOIN users u ON u.id = dp.user_id
    WHERE dp.order_id = ? ORDER BY dp.id`, [o.id]);
  const customerName = orderCustomerName(o);
  let seq = 0;
  for (const dp of o.deposits) {
    dp.seq = dp.amount > 0 ? ++seq : null;            // hoàn cọc không đánh số lần
    dp.payer_display = dp.payer_name || customerName;
  }

  /* Khối tổng kết cho phiếu in (tài liệu 12, mục 3.2). "Đã giao" tính theo
     tiền hàng của các hoá đơn giao, không kể phí ship. Khách trả thêm lúc
     nhận hàng cũng trừ vào nợ còn lại — nếu không, khách đã trả đủ khi lấy
     hàng vẫn thấy mình còn nợ trên phiếu. */
  const delivered = o.deliveries.filter((d) => d.sale_status !== 'cancelled');
  const deliveredValue = delivered.reduce((a, d) =>
    a + (d.sale_total || 0) - (d.sale_vat || 0) - (d.ship_payer === 'customer' ? (d.ship_fee || 0) : 0), 0);
  const paidAtDelivery = delivered.reduce((a, d) => a + Math.max(0, (d.sale_paid || 0) - (d.deposit_applied || 0)), 0);
  o.summary = {
    total: o.total,
    deposit_total: o.deposit,
    deposit_count: seq,
    delivered_value: deliveredValue,
    paid_at_delivery: paidAtDelivery,
    remaining: Math.max(0, o.total - o.deposit - paidAtDelivery),
    delivery_count: o.deliveries.length,
  };

  o.store = getSettings().store || {};
  res.json(o);
});

/* ============================ TẠO / SỬA ============================ */

function saveItems(orderId, items) {
  run('DELETE FROM sale_order_items WHERE order_id = ?', [orderId]);
  for (const it of items) {
    const { discount, amount } = lineAmount(it);
    run(`INSERT INTO sale_order_items(order_id, product_id, name_snapshot, unit_id, unit_name, factor,
                                      qty, delivered_qty, price, discount, discount_type,
                                      discount_percent, amount, note)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, it.product_id, it.name_snapshot || '',
        resolveUnitId(it.product_id, it.unit_id, it.unit_name),
        it.unit_name, num(it.factor, 1),
        num(it.qty), num(it.delivered_qty), money(it.price), discount,
        it.discount_type === 'percent' ? 'percent' : 'amount', num(it.discount_percent),
        amount, it.note || null]);
  }
}

r.post('/orders', (req, res) => {
  const b = req.body;
  const items = Array.isArray(b.items) ? b.items.filter((i) => num(i.qty) > 0) : [];
  if (!items.length) return res.status(400).json({ error: 'Đơn đặt hàng phải có ít nhất 1 mặt hàng' });

  const warehouseId = Number(b.warehouse_id) || get('SELECT id FROM warehouses WHERE is_default = 1')?.id;
  if (!warehouseId) return res.status(400).json({ error: 'Chưa thiết lập kho' });

  try {
    const out = tx(() => {
      const t = totalsOf(items, b);
      const code = b.code?.trim() || nextCode('sale_orders', 'DH');
      const info = run(`
        INSERT INTO sale_orders(code, ts, customer_id, customer_name, customer_phone,
                                warehouse_id, price_list_id, user_id, promised_at, status,
                                subtotal, discount, discount_type, discount_percent, total,
                                delivery_name, delivery_phone, delivery_address, carrier_id, note)
        VALUES(?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?, ?, ?, ?, 'open',
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [code, b.ts || null, b.customer_id || null,
          b.customer_id ? null : (b.customer_name?.trim() || null),
          b.customer_id ? null : (b.customer_phone?.trim() || null),
          warehouseId, b.price_list_id || null, b.user_id || null, b.promised_at || null,
          t.subtotal, t.discount, t.discountType, t.discountPercent, t.total,
          b.delivery_name || null, b.delivery_phone || null, b.delivery_address || null,
          b.carrier_id || null, b.note || null]);
      const id = Number(info.lastInsertRowid);
      saveItems(id, items);

      // Tiền cọc nhận ngay lúc lập đơn
      const dep = money(b.deposit);
      if (dep > 0) {
        if (dep > t.total) {
          throw Object.assign(new Error('Tiền cọc không được lớn hơn tổng tiền đơn hàng.'), { status: 400 });
        }
        addDeposit(id, code, dep, { ...b, note: b.deposit_note ?? null });
      }
      return { id, code, total: t.total, deposit: dep };
    });
    res.json(out);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

r.put('/orders/:id', (req, res) => {
  const o = get('SELECT * FROM sale_orders WHERE id = ?', [req.params.id]);
  if (!o) return res.status(404).json({ error: 'Không tìm thấy đơn đặt hàng' });
  if (o.status === 'cancelled') return res.status(400).json({ error: 'Đơn đã huỷ, không sửa được.' });
  if (o.status === 'done') return res.status(400).json({ error: 'Đơn đã giao xong, không sửa được.' });

  const b = req.body;
  const items = Array.isArray(b.items) ? b.items.filter((i) => num(i.qty) > 0) : [];
  if (!items.length) return res.status(400).json({ error: 'Đơn đặt hàng phải có ít nhất 1 mặt hàng' });

  // Không cho hạ số lượng xuống dưới phần đã giao
  const delivered = new Map(
    all('SELECT product_id, unit_name, delivered_qty FROM sale_order_items WHERE order_id = ?', [o.id])
      .map((x) => [`${x.product_id}|${x.unit_name}`, x.delivered_qty]));
  for (const it of items) {
    const done = delivered.get(`${it.product_id}|${it.unit_name}`) || 0;
    if (num(it.qty) < done - 0.0001) {
      return res.status(400).json({
        error: `"${it.name_snapshot}" đã giao ${done} ${it.unit_name}, không hạ số lượng đặt xuống ${it.qty} được.`,
      });
    }
    it.delivered_qty = done;
  }
  // Mặt hàng bị bỏ khỏi đơn mà đã giao rồi thì không cho bỏ
  for (const [key, done] of delivered) {
    if (done <= 0.0001) continue;
    const [pid, unit] = key.split('|');
    if (!items.some((it) => String(it.product_id) === pid && it.unit_name === unit)) {
      return res.status(400).json({ error: 'Không bỏ được mặt hàng đã giao một phần khỏi đơn.' });
    }
  }

  try {
    tx(() => {
      const t = totalsOf(items, b);
      run(`UPDATE sale_orders SET customer_id = ?, customer_name = ?, customer_phone = ?,
             price_list_id = ?, promised_at = ?, subtotal = ?, discount = ?, discount_type = ?,
             discount_percent = ?, total = ?, delivery_name = ?, delivery_phone = ?,
             delivery_address = ?, carrier_id = ?, note = ?
           WHERE id = ?`,
        [b.customer_id || null,
          b.customer_id ? null : (b.customer_name?.trim() || null),
          b.customer_id ? null : (b.customer_phone?.trim() || null),
          b.price_list_id || null, b.promised_at || null,
          t.subtotal, t.discount, t.discountType, t.discountPercent, t.total,
          b.delivery_name || null, b.delivery_phone || null, b.delivery_address || null,
          b.carrier_id || null, b.note || null, o.id]);
      saveItems(o.id, items);
      refreshStatus(o.id);
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ============================= TIỀN CỌC ============================ */

/**
 * Ghi một lần khách đưa cọc. Phải gọi bên trong tx().
 * Người đưa cọc bỏ trống thì lấy tên khách đứng trên đơn (tài liệu 12, mục 2.1).
 * Trả về số thứ tự lần cọc (lần 1, lần 2...) để in đúng "phiếu thu cọc lần X".
 */
function addDeposit(orderId, orderCode, amount, b) {
  const o = get('SELECT customer_id, customer_name FROM sale_orders WHERE id = ?', [orderId]);
  const customerName = orderCustomerName(o);
  const payer = String(b.payer_name ?? '').trim() || customerName;
  const accountId = Number(b.account_id) || defaultCashAccount('cash');
  let cashTxId = null;
  if (accountId) {
    const t = addCashTx({
      accountId, direction: 'in', amount, category: 'deposit_in',
      partnerType: 'customer', partnerId: o?.customer_id || null,
      partnerName: customerName,
      refType: 'sale_order', refId: orderId, refCode: orderCode, userId: b.user_id || null,
      note: b.note || (payer !== customerName
        ? `Đặt cọc đơn ${orderCode} — ${payer} nộp thay ${customerName}`
        : `Khách đặt cọc đơn ${orderCode}`),
      ts: b.ts || null,
    });
    cashTxId = t?.id ?? t ?? null;
  }
  const info = run(`INSERT INTO sale_order_deposits(order_id, ts, amount, account_id, cash_tx_id, user_id, note, payer_name)
       VALUES(?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?, ?, ?)`,
    [orderId, b.ts || null, amount, accountId || null, cashTxId, b.user_id || null, b.note || null, payer]);
  run('UPDATE sale_orders SET deposit = deposit + ? WHERE id = ?', [amount, orderId]);
  const seq = get('SELECT COUNT(*) AS n FROM sale_order_deposits WHERE order_id = ? AND amount > 0 AND id <= ?',
    [orderId, Number(info.lastInsertRowid)]).n;
  return { id: Number(info.lastInsertRowid), seq, payer_name: payer, cash_tx_id: cashTxId };
}

r.post('/orders/:id/deposit', (req, res) => {
  const o = get('SELECT * FROM sale_orders WHERE id = ?', [req.params.id]);
  if (!o) return res.status(404).json({ error: 'Không tìm thấy đơn đặt hàng' });
  if (o.status === 'cancelled') return res.status(400).json({ error: 'Đơn đã huỷ.' });
  const amount = money(req.body.amount);
  if (amount <= 0) return res.status(400).json({ error: 'Số tiền cọc phải lớn hơn 0' });
  const left = o.total - o.deposit;
  if (amount > left) {
    return res.status(400).json({
      error: `Đơn còn ${left.toLocaleString('vi-VN')} đ chưa cọc, không nhận cọc ${amount.toLocaleString('vi-VN')} đ được.`,
    });
  }
  try {
    const dep = tx(() => addDeposit(o.id, o.code, amount, req.body));
    res.json({ ok: true, deposit_id: dep.id, deposit_no: dep.seq, payer_name: dep.payer_name, cash_tx_id: dep.cash_tx_id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ============================ GIAO HÀNG ============================ *
 * Mỗi đợt giao xuất một hoá đơn bán riêng. Tiền cọc còn lại được trừ
 * vào hoá đơn đó, ghi thành khoản đã trả — không tạo thêm phiếu thu,
 * vì tiền đã vào quỹ từ lúc nhận cọc rồi.
 *
 * Hai hình thức (tài liệu 12, mục 2.2):
 *   pickup  khách tự lấy tại quầy — xuất kho, xong ngay
 *   ship    giao tận nơi — hoá đơn mang thông tin giao, đi vào bảng theo
 *           dõi giao hàng; phần khách chưa trả là tiền thu hộ (COD)     */

r.post('/orders/:id/deliver', (req, res) => {
  const o = get('SELECT * FROM sale_orders WHERE id = ?', [req.params.id]);
  if (!o) return res.status(404).json({ error: 'Không tìm thấy đơn đặt hàng' });
  if (o.status === 'cancelled') return res.status(400).json({ error: 'Đơn đã huỷ, không giao được.' });
  if (o.status === 'done') return res.status(400).json({ error: 'Đơn đã giao xong.' });

  const b = req.body;
  const want = Array.isArray(b.items) ? b.items : [];
  const lines = all('SELECT * FROM sale_order_items WHERE order_id = ?', [o.id]);

  // Ghép số lượng giao đợt này với từng dòng của đơn
  const toDeliver = [];
  for (const w of want) {
    const line = lines.find((l) => l.id === Number(w.item_id));
    if (!line) continue;
    const qty = num(w.qty);
    if (qty <= 0) continue;
    const remaining = line.qty - line.delivered_qty;
    if (qty > remaining + 0.0001) {
      return res.status(400).json({
        error: `"${line.name_snapshot}" chỉ còn ${remaining} ${line.unit_name} chưa giao.`,
      });
    }
    toDeliver.push({ line, qty });
  }
  if (!toDeliver.length) return res.status(400).json({ error: 'Chưa chọn mặt hàng nào để giao' });

  /* Không nói rõ hình thức thì theo đơn: đơn có địa chỉ giao là giao tận nơi
     (giữ đúng cách làm trước đợt 14) */
  const mode = b.mode === 'ship' || b.mode === 'pickup' ? b.mode : (o.delivery_address ? 'ship' : 'pickup');
  const ship = mode === 'ship' ? {
    delivery_name: b.delivery_name ?? o.delivery_name,
    delivery_phone: b.delivery_phone ?? o.delivery_phone,
    delivery_address: b.delivery_address ?? o.delivery_address,
    carrier_id: b.carrier_id ?? o.carrier_id,
    tracking_code: b.tracking_code || null,
    shipper_name: b.shipper_name || null,
    shipper_user_id: b.shipper_user_id || null,
    shipper_phone: b.shipper_phone || null,
    ship_fee: money(b.ship_fee),
    ship_payer: b.ship_payer === 'shop' ? 'shop' : 'customer',
    cod_mode: b.cod_mode,
    delivery_note: b.delivery_note || null,
  } : {};
  if (mode === 'ship' && !ship.delivery_address && !ship.carrier_id && !ship.shipper_name && !ship.shipper_user_id) {
    return res.status(400).json({
      error: 'Giao tận nơi thì cần địa chỉ giao, hoặc đơn vị vận chuyển / người giao hàng.',
      code: 'SHIP_INFO_REQUIRED',
    });
  }

  try {
    const out = tx(() => {
      // Tiền cọc còn lại, trừ tối đa bằng tổng tiền hoá đơn đợt này
      const depositLeft = o.deposit - o.deposit_used;

      const saleItems = toDeliver.map(({ line, qty }) => ({
        product_id: line.product_id,
        name_snapshot: line.name_snapshot,
        unit_name: line.unit_name,
        factor: line.factor,
        qty,
        price: line.price,
        // Giảm giá dòng giữ nguyên tỉ lệ: giao một nửa thì giảm một nửa
        discount_type: line.discount_type,
        discount_percent: line.discount_percent,
        discount: line.discount_type === 'percent'
          ? 0
          : Math.round(line.discount * (qty / line.qty)),
        vat_rate: 0,
        note: line.note,
      }));

      const gross = saleItems.reduce((a, it) => a + lineAmount(it).amount, 0);
      // Giảm giá toàn đơn chia theo tỉ lệ tiền hàng của đợt giao này
      const orderDisc = o.subtotal > 0
        ? Math.round(o.discount * (gross / o.subtotal))
        : 0;
      const saleTotal = gross - Math.min(orderDisc, gross);
      const useDeposit = Math.min(depositLeft, saleTotal);
      const paidNow = money(b.paid);

      const sale = createSale({
        ts: b.ts || null,
        customer_id: o.customer_id || null,
        warehouse_id: o.warehouse_id,
        price_list_id: o.price_list_id,
        user_id: b.user_id || null,
        items: saleItems,
        discount_type: 'amount',
        discount: Math.min(orderDisc, gross),
        // Cọc đã thu trước, cộng với tiền khách trả thêm lúc nhận hàng
        paid: useDeposit + paidNow,
        received: useDeposit + money(b.received || b.paid),
        payment_method: b.payment_method || 'cash',
        // Phần cọc không sinh phiếu thu mới, chỉ phần khách trả thêm mới ghi quỹ
        cash_amount: b.payment_method === 'transfer' ? 0 : paidNow,
        transfer_amount: b.payment_method === 'transfer' ? paidNow : 0,
        cash_account_id: b.account_id || null,
        transfer_account_id: b.account_id || null,
        ...ship,
        note: `Giao đơn đặt hàng ${o.code}${b.note ? ' — ' + b.note : ''}`,
      });

      for (const { line, qty } of toDeliver) {
        run('UPDATE sale_order_items SET delivered_qty = delivered_qty + ? WHERE id = ?', [qty, line.id]);
      }
      run('UPDATE sale_orders SET deposit_used = deposit_used + ? WHERE id = ?', [useDeposit, o.id]);
      const d = run(`INSERT INTO sale_order_deliveries(order_id, sale_id, ts, user_id, deposit_applied, note, mode)
           VALUES(?, ?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?)`,
        [o.id, sale.id, b.ts || null, b.user_id || null, useDeposit, b.note || null, mode]);
      refreshStatus(o.id);

      return {
        sale_id: sale.id, sale_code: sale.code, sale_total: sale.total,
        deposit_applied: useDeposit, paid: sale.paid,
        remaining: sale.total - sale.paid,
        cod_amount: sale.cod_amount || 0,
        mode,
        delivery_id: Number(d.lastInsertRowid),
        delivery_no: get('SELECT COUNT(*) AS n FROM sale_order_deliveries WHERE order_id = ?', [o.id]).n,
        status: get('SELECT status FROM sale_orders WHERE id = ?', [o.id]).status,
      };
    });
    res.json(out);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

/* ============================== HUỶ ĐƠN ============================ */

r.post('/orders/:id/cancel', (req, res) => {
  const o = get('SELECT * FROM sale_orders WHERE id = ?', [req.params.id]);
  if (!o) return res.status(404).json({ error: 'Không tìm thấy đơn đặt hàng' });
  if (o.status === 'cancelled') return res.status(400).json({ error: 'Đơn đã huỷ rồi.' });

  const depositLeft = o.deposit - o.deposit_used;
  const refund = money(req.body.refund);
  if (refund > depositLeft) {
    return res.status(400).json({
      error: `Cọc còn lại chỉ ${depositLeft.toLocaleString('vi-VN')} đ, không hoàn ${refund.toLocaleString('vi-VN')} đ được.`,
    });
  }

  try {
    tx(() => {
      if (refund > 0) {
        const cust = o.customer_id ? get('SELECT name FROM customers WHERE id = ?', [o.customer_id]) : null;
        const accountId = Number(req.body.account_id) || defaultCashAccount('cash');
        let cashTxId = null;
        if (accountId) {
          const t = addCashTx({
            accountId, direction: 'out', amount: refund, category: 'deposit_out',
            partnerType: 'customer', partnerId: o.customer_id || null,
            partnerName: cust?.name || o.customer_name || 'Khách lẻ',
            refType: 'sale_order', refId: o.id, refCode: o.code, userId: req.body.user_id || null,
            note: `Hoàn cọc đơn ${o.code}`,
          });
          cashTxId = t?.id ?? t ?? null;
        }
        run(`INSERT INTO sale_order_deposits(order_id, amount, account_id, cash_tx_id, user_id, note)
             VALUES(?, ?, ?, ?, ?, ?)`,
          [o.id, -refund, accountId || null, cashTxId, req.body.user_id || null, 'Hoàn cọc khi huỷ đơn']);
        run('UPDATE sale_orders SET deposit = deposit - ? WHERE id = ?', [refund, o.id]);
      }
      run(`UPDATE sale_orders SET status = 'cancelled', closed_at = datetime('now','localtime'),
             note = COALESCE(note || ' | ', '') || ? WHERE id = ?`,
        [`Huỷ: ${req.body.reason || 'không ghi lý do'}`, o.id]);
    });
    res.json({ ok: true, refunded: refund });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default r;
