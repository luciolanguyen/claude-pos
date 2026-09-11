import { Router } from 'express';
import {
  all, get, run, tx, nextCode, moveStock, costOf,
  addCashTx, defaultCashAccount, customerDebt, getSettings, pageParams } from '../db.js';
import {
  posPolicy, isApproverRole, peekApproval, consumeApproval, discountExposure, listPriceOf,
} from '../policy.js';
import { debtBreakdown, overdueInvoices } from '../debt.js';
import { createVoucher, lookupVoucher, redeemVoucher } from '../vouchers.js';

const r = Router();

/* ============================ HOÁ ĐƠN BÁN ========================== */

r.get('/sales', (req, res) => {
  const { q = '', customer_id, from, to, status, payment_method, unpaid, user_id } = req.query;
  const where = [];
  const params = [];
  if (q.trim()) {
    /* Tìm song song ở khách chủ VÀ người mua hộ (tài liệu 03): khách gọi
       hỏi "hôm trước con tôi ra mua" thì phải ra được hoá đơn đó. */
    where.push(`(s.code LIKE ? OR c.name LIKE ? OR c.phone LIKE ?
                 OR s.buyer_name LIKE ? OR s.buyer_phone LIKE ?)`);
    const like = `%${q.trim()}%`;
    params.push(like, like, like, like, like);
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
  /* Giá khách THỰC TRẢ và số còn trả được của từng dòng — để hộp đổi trả
     tính tiền hoàn ngay trên màn hình, khớp đúng số máy chủ sẽ ghi */
  const returned = returnedByLine(s.id, s.items);
  const policy = posPolicy();
  for (const it of s.items) {
    it.net_unit_price = netUnitPrice(s, it);
    it.returned_qty = returned.get(it.id) || 0;
    it.returnable_qty = Math.max(0, it.qty - it.returned_qty);
    it.no_return_category = noReturnCategoryOf(it.product_id);
  }
  s.age_days = get(`SELECT CAST(julianday('now','localtime') - julianday(?) AS INTEGER) AS d`, [s.ts]).d;
  s.return_days = policy.returnDays;
  s.return_expired = policy.returnDays > 0 && s.age_days > policy.returnDays;
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
  /* Kho hàng lỗi chỉ để chứa hàng khách trả bị hỏng (tài liệu 02) — không bán ra */
  if (get('SELECT is_defect FROM warehouses WHERE id = ?', [warehouseId])?.is_defect) {
    throw badRequest('Kho hàng lỗi chỉ chứa hàng khách trả bị hỏng, không bán ra được. Chọn kho đang bán.',
      'DEFECT_WAREHOUSE');
  }

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

  /* ------------------------------------------------------------------ *
   * Các chặn cần duyệt — soát TRƯỚC khi mở tx, khỏi ghi dở rồi lùi.
   *
   * _actor do route gắn vào sau khi trải thân yêu cầu (máy khách không tự
   * khai được):
   *   undefined  gọi nội bộ, ví dụ giao đơn đặt hàng — không soát giảm giá
   *   null       tiệm tắt đăng nhập — một máy dùng chung, coi như toàn quyền
   *   {role}     người đang đăng nhập
   * ------------------------------------------------------------------ */
  const policy = posPolicy();
  const actor = b._actor;
  const fromRoute = actor !== undefined;
  const isApprover = actor === null || isApproverRole(actor?.role);
  const approval = peekApproval(b.approval_token);
  const approvalNotes = [];
  const needApproval = (message, code) =>
    Object.assign(badRequest(message, code), { needs_approval: true });
  const fmt = (v) => Math.round(v).toLocaleString('vi-VN');

  /* Ước tính tổng để soát — phải tính cùng cách với lúc lưu, nếu không đơn
     giảm giá theo % sẽ bị chặn oan. */
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
  const vat0 = b.is_vat_invoice
    ? items.reduce((a, it) => a + Math.round(lineTotal(it) * (Number(it.vat_rate) || 0) / 100), 0)
    : 0;
  const total0 = sub0 - Math.min(orderDisc0, sub0) + vat0 +
    (b.ship_payer === 'customer' ? Math.round(Number(b.ship_fee) || 0) : 0);

  /* Giao hàng: phần khách chưa trả ngay là tiền THU HỘ (COD), không phải nợ
     của khách (tài liệu 04). Chỉ khi quầy nói rõ đơn giao này ghi nợ
     (cod_mode = false) thì phần còn lại mới vào công nợ. */
  const hasDelivery = !!(b.delivery_address || b.carrier_id || b.tracking_code
    || b.shipper_name || b.shipper_user_id);
  const codMode = hasDelivery && b.cod_mode !== false;
  const paid0 = Math.max(0, Math.round(Number(b.paid) || 0));
  const voucherAsked = String(b.voucher_code || '').trim()
    ? Math.max(0, Math.round(Number(b.voucher_amount) || 0)) : 0;
  const newDebt = codMode ? 0 : Math.max(0, total0 - paid0 - voucherAsked);

  /* 1. Giảm giá quá hạn mức thu ngân tự quyết (tài liệu 06).
        So với BẢNG GIÁ, không so với ô giảm giá — sửa tay đơn giá xuống
        rồi để ô giảm giá bằng 0 cũng là giảm. */
  if (fromRoute && !isApprover) {
    const exp = discountExposure(items, b.price_list_id, b);
    if (exp.max_percent > policy.cashierMaxDiscountPercent + 0.001) {
      if (!approval) {
        throw needApproval(
          `Đơn này giảm ${exp.max_percent}% so với bảng giá, vượt hạn mức `
          + `${policy.cashierMaxDiscountPercent}% thu ngân được tự giảm. Cần quản lý nhập mã PIN để duyệt.`,
          'DISCOUNT_LIMIT');
      }
      approvalNotes.push(`giảm giá ${exp.max_percent}%`);
    }
  }

  if (b.customer_id && newDebt > 0) {
    const c = get('SELECT name, debt_limit FROM customers WHERE id = ?', [b.customer_id]);

    /* 2. Còn hoá đơn nợ quá hạn thì không bán nợ thêm, bắt trả đủ (tài liệu 05).
          Chặn cứng, không mở bằng PIN: muốn bán nợ tiếp thì thu nợ cũ trước. */
    if (fromRoute && policy.maxDebtDays > 0) {
      const od = overdueInvoices(b.customer_id, policy.maxDebtDays);
      if (od.length) {
        const oldest = od[0];
        throw badRequest(
          `"${c?.name}" còn ${od.length} hoá đơn nợ quá ${policy.maxDebtDays} ngày `
          + `(cũ nhất ${oldest.code}, ${oldest.age_days} ngày, còn nợ ${fmt(oldest.remaining)} đ). `
          + 'Đơn mới phải trả đủ tiền, không bán nợ thêm được.', 'OVERDUE_BLOCK');
      }
    }

    /* 3. Vượt hạn mức nợ: khoá lại, quản lý nhập PIN mới mở (tài liệu 05) */
    if (c?.debt_limit > 0) {
      const willOwe = customerDebt(b.customer_id) + newDebt;
      if (willOwe > c.debt_limit) {
        const message = `Công nợ của "${c.name}" sẽ là ${fmt(willOwe)} đ, vượt hạn mức ${fmt(c.debt_limit)} đ.`;
        if (!fromRoute) throw badRequest(message, 'DEBT_LIMIT');
        /* Kể cả chủ tiệm cũng phải gõ PIN: bán vượt hạn mức là một ngoại lệ
           có chủ đích, phải để lại dấu ai cho phép — không để lọt qua chỉ vì
           người đứng quầy lúc đó có vai trò cao. */
        if (!approval) {
          throw needApproval(`${message} Cần quản lý nhập mã PIN để cho bán nợ vượt hạn mức.`, 'DEBT_LIMIT');
        }
        approvalNotes.push(`bán nợ vượt hạn mức (${fmt(willOwe)}/${fmt(c.debt_limit)} đ)`);
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
      /* Tiền khách đưa (tiền mặt + chuyển khoản), chưa kể phiếu đổi hàng */
      const paidMoney = Math.max(0, Math.min(Math.round(Number(b.paid) || 0), total));

      /* Phiếu đổi hàng trả vào phần còn thiếu. Soát trước khi ghi hoá đơn;
         trừ phiếu thật sự ở dưới, sau khi hoá đơn đã có số. */
      const voucherCode = String(b.voucher_code || '').trim();
      let voucherUse = 0;
      if (voucherCode) {
        const v = lookupVoucher(voucherCode);
        if (!v) throw badRequest(`Không tìm thấy phiếu đổi hàng "${voucherCode}"`, 'VOUCHER_NOT_FOUND');
        if (!v.usable) throw badRequest(`Phiếu ${v.code}: ${v.why_not}`, 'VOUCHER_UNUSABLE');
        const asked = b.voucher_amount === undefined || b.voucher_amount === null || b.voucher_amount === ''
          || Number.isNaN(Number(b.voucher_amount)) ? v.balance : Math.round(Number(b.voucher_amount));
        voucherUse = Math.max(0, Math.min(asked, v.balance, total - paidMoney));
      }
      const paid = paidMoney + voucherUse;
      const changeGiven = Math.max(0, Math.round(Number(b.received) || 0) - paidMoney);
      const code = b.code?.trim() || nextCode('sales', 'HD');

      // Number(undefined) là NaN, mà ?? không bắt NaN — phải kiểm tra trước khi ép kiểu
      const num = (v, fallback) =>
        v === undefined || v === null || v === '' || Number.isNaN(Number(v))
          ? fallback
          : Math.round(Number(v));
      const cashAmount = num(b.cash_amount, b.payment_method === 'cash' ? paidMoney : 0);
      const transferAmount = num(b.transfer_amount, b.payment_method === 'transfer' ? paidMoney : 0);

      /* Thu hộ COD: phần còn lại của đơn giao. Treo ở đối tác vận chuyển tới
         lúc đối soát, không cộng vào nợ của khách. */
      const codAmount = codMode ? Math.max(0, total - paid) : 0;

      /* Người mua hộ. Chọn hồ sơ có sẵn thì chụp lại tên, số điện thoại lúc
         bán, để về sau người đó đổi số vẫn tra ra đúng ai đã đi mua. */
      let buyerId = Number(b.buyer_id) || null;
      let buyerName = String(b.buyer_name || '').trim() || null;
      let buyerPhone = String(b.buyer_phone || '').trim() || null;
      if (buyerId) {
        const bu = get('SELECT name, phone FROM customers WHERE id = ?', [buyerId]);
        if (bu) { buyerName = bu.name; buyerPhone = bu.phone || buyerPhone; } else buyerId = null;
      }
      if (buyerId && buyerId === Number(b.customer_id)) {
        buyerId = null; buyerName = null; buyerPhone = null;   // tự mua cho mình thì không phải mua hộ
      }

      const approvedBy = approvalNotes.length && approval ? approval.approver.id : null;

      const info = run(`
        INSERT INTO sales(code, ts, customer_id, warehouse_id, user_id, price_list_id,
                          subtotal, discount, discount_type, discount_percent,
                          vat_amount, total, cogs, paid, change_given,
                          payment_method, cash_amount, transfer_amount, status, is_vat_invoice, note,
                          delivery_name, delivery_phone, delivery_address, carrier_id, tracking_code,
                          ship_fee, ship_payer, cod_amount, delivery_status, delivery_note,
                          cod_status, shipper_name, shipper_user_id, shipper_phone,
                          buyer_id, buyer_name, buyer_phone, voucher_amount,
                          approved_by, approval_note)
        VALUES(?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'done', ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?,
               ?, ?, ?, ?,
               ?, ?)`,
        [code, b.ts || null, b.customer_id || null, warehouseId, b.user_id || null,
          b.price_list_id || null, subtotal, discount, discountType, discountPercent,
          vatAmount, total, cogs, paid, changeGiven,
          b.payment_method || 'cash', cashAmount, transferAmount,
          b.is_vat_invoice ? 1 : 0, String(b.note || '').slice(0, 255) || null,
          b.delivery_name || null, b.delivery_phone || null, b.delivery_address || null,
          b.carrier_id || null, b.tracking_code || null,
          shipFee, b.ship_payer || 'shop', codAmount,
          hasDelivery ? (b.delivery_status || 'pending') : null, b.delivery_note || null,
          codAmount > 0 ? 'pending' : null,
          String(b.shipper_name || '').trim() || null, Number(b.shipper_user_id) || null,
          String(b.shipper_phone || '').trim() || null,
          buyerId, buyerName, buyerPhone, voucherUse,
          approvedBy, approvedBy ? approvalNotes.join('; ') : null]);
      const saleId = Number(info.lastInsertRowid);

      if (voucherUse > 0) {
        redeemVoucher({ code: voucherCode, amount: voucherUse, saleId, customerId: b.customer_id });
      }

      for (const it of items) {
        const factor = Number(it.factor) || 1;
        // Hạn bảo hành tính sẵn từ số tháng nhập tay, để tra cứu cho nhanh
        const wm = Number(it.warranty_months) || 0;
        const wUntil = wm > 0
          ? get("SELECT date(COALESCE(?, datetime('now','localtime')), '+' || ? || ' months') AS d",
              [b.ts || null, wm]).d
          : null;

        /* Giá niêm yết lúc bán — để soát lại mức giảm thật so với bảng giá */
        const listPrice = listPriceOf(it.product_id, it.unit_name, b.price_list_id);
        run(`INSERT INTO sale_items(sale_id, product_id, name_snapshot, unit_name, factor, qty,
                                    price, discount, discount_type, discount_percent,
                                    vat_rate, unit_cost, amount, note,
                                    warranty_months, warranty_until, serial, list_price)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [saleId, it.product_id, it.name_snapshot || '', it.unit_name, factor, Number(it.qty),
            Math.round(Number(it.price) || 0), it._discount,
            it.discount_type === 'percent' ? 'percent' : 'amount',
            Number(it.discount_percent) || 0,
            Number(it.vat_rate) || 0, it._unitCost, it._amount, it.note || null,
            wm, wUntil, it.serial?.trim() || null,
            listPrice ?? Math.round(Number(it.price) || 0)]);
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
      return {
        id: saleId, code, total, paid, change_given: changeGiven,
        cod_amount: codAmount, voucher_used: voucherUse, approved_by: approvedBy,
      };
  });
}

r.post('/sales', (req, res) => {
  try {
    /* _actor lấy từ phiên đăng nhập và gắn SAU khi trải thân yêu cầu — để
       máy khách không tự khai mình là chủ tiệm được */
    const out = createSale({ ...req.body, _actor: req.user ?? null });
    if (out.approved_by) consumeApproval(req.body?.approval_token);
    res.json(out);
  } catch (e) {
    res.status(e.status || 400).json({
      error: e.message, code: e.code, needs_approval: e.needs_approval === true,
    });
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

/** Nhóm "không nhận đổi trả" của mặt hàng — dò cả nhóm cha, nhóm ông. */
function noReturnCategoryOf(productId) {
  let cat = get(`SELECT c.id, c.name, c.parent_id, c.no_return
                 FROM products p JOIN categories c ON c.id = p.category_id
                 WHERE p.id = ?`, [productId]);
  const seen = new Set();
  while (cat && !seen.has(cat.id)) {
    if (cat.no_return) return cat.name;
    seen.add(cat.id);
    cat = cat.parent_id
      ? get('SELECT id, name, parent_id, no_return FROM categories WHERE id = ?', [cat.parent_id])
      : null;
  }
  return null;
}

/**
 * Kho hàng lỗi. Chưa có thì tạo — hàng hỏng khách trả phải có chỗ để, và
 * chỗ đó không được là kho đang bán, nếu không màn hình bán hàng lại bán
 * món hỏng đó cho khách khác.
 */
export function ensureDefectWarehouse() {
  const w = get('SELECT id FROM warehouses WHERE is_defect = 1 AND active = 1 ORDER BY id LIMIT 1');
  if (w) return w.id;
  let code = 'LOI';
  for (let n = 2; get('SELECT id FROM warehouses WHERE code = ?', [code]); n++) code = `LOI${n}`;
  return Number(run(`INSERT INTO warehouses(code, name, is_default, active, is_defect)
                     VALUES(?, 'Kho hàng lỗi (không bán)', 0, 1, 1)`, [code]).lastInsertRowid);
}

/** Số tiền khách thực trả cho cả dòng hoá đơn (xem netUnitPrice). */
function netLineValue(sale, line) {
  const share = sale.subtotal > 0 ? Math.round(sale.discount * line.amount / sale.subtotal) : 0;
  const vat = sale.is_vat_invoice ? Math.round(line.amount * (Number(line.vat_rate) || 0) / 100) : 0;
  return line.amount - share + vat;
}

/**
 * Giá KHÁCH THỰC TRẢ cho một đơn vị trên dòng hoá đơn gốc.
 *
 * Không lấy đơn giá niêm yết: khách được giảm 10% thì trả hàng cũng chỉ
 * được hoàn 90%. Trước đây hoàn theo đơn giá gốc — khách mua giảm giá rồi
 * đem trả là lời ngay phần chênh, tiệm hoàn nhiều hơn số đã thu.
 *
 * Tính cả phần giảm giá toàn đơn chia theo tỷ lệ tiền của dòng, và thuế
 * GTGT nếu hoá đơn có xuất VAT. Phí giao hàng không hoàn.
 */
export function netUnitPrice(sale, line) {
  return line.qty > 0 ? Math.round(netLineValue(sale, line) / line.qty) : 0;
}

/** Mỗi dòng của hoá đơn đã được trả bao nhiêu (theo đơn vị của dòng). */
function returnedByLine(saleId, lines) {
  const done = new Map();
  for (const row of all(`
    SELECT sri.sale_item_id, sri.product_id, sri.unit_name, SUM(sri.qty) AS q
    FROM sale_return_items sri JOIN sale_returns sr ON sr.id = sri.return_id
    WHERE sr.sale_id = ?
    GROUP BY sri.sale_item_id, sri.product_id, sri.unit_name`, [saleId])) {
    /* Phiếu trả cũ (trước đợt 13) chưa ghi dòng gốc — gán vào dòng đầu tiên
       cùng mặt hàng, cùng đơn vị */
    const line = row.sale_item_id
      ? lines.find((l) => l.id === row.sale_item_id)
      : lines.find((l) => l.product_id === row.product_id && l.unit_name === row.unit_name);
    if (line) done.set(line.id, (done.get(line.id) || 0) + Number(row.q));
  }
  return done;
}

const REFUND_METHODS = ['cash', 'transfer', 'debt', 'voucher'];

/**
 * Lập phiếu khách trả hàng. Dùng chung cho màn hình Hoá đơn và cho việc
 * đổi hàng tại quầy, nên tách khỏi tay xử lý HTTP.
 *
 * Trả về { id, code, total } — total là tiền hàng trả lại sau khi trừ phí.
 */
export function createSaleReturn(b) {
  const items = Array.isArray(b.items) ? b.items.filter((i) => Number(i.qty) > 0) : [];
  if (!items.length) throw badRequest('Phiếu trả hàng phải có ít nhất 1 mặt hàng');
  const policy = posPolicy();

  const sale = b.sale_id ? get('SELECT * FROM sales WHERE id = ?', [b.sale_id]) : null;
  if (b.sale_id && !sale) throw badRequest('Không tìm thấy hoá đơn gốc', 'SALE_NOT_FOUND');
  if (sale && sale.status !== 'done') throw badRequest(`Hoá đơn ${sale.code} đã bị huỷ`, 'SALE_CANCELLED');

  /* Quá hạn đổi trả thì chặn (tài liệu 02). Trả không hoá đơn thì không biết
     ngày mua nên không soát được — chỗ đó dựa vào lý do bắt buộc phải ghi. */
  if (sale && policy.returnDays > 0) {
    const age = get(`SELECT CAST(julianday('now','localtime') - julianday(?) AS INTEGER) AS d`, [sale.ts]).d;
    if (age > policy.returnDays) {
      throw badRequest(
        `Hoá đơn ${sale.code} mua cách đây ${age} ngày, đã quá hạn đổi trả ${policy.returnDays} ngày.`,
        'RETURN_EXPIRED');
    }
  }

  /* Trả theo hoá đơn: giá lấy từ hoá đơn gốc, KHÔNG tin giá gửi lên */
  if (sale) {
    const lines = all('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id', [sale.id]);
    const done = returnedByLine(sale.id, lines);
    for (const it of items) {
      const line = it.sale_item_id
        ? lines.find((l) => l.id === Number(it.sale_item_id))
        : lines.find((l) => l.product_id === Number(it.product_id) && l.unit_name === it.unit_name);
      if (!line) {
        throw badRequest(`Mặt hàng khách trả không có trong hoá đơn ${sale.code}.`, 'NOT_IN_SALE');
      }
      const already = done.get(line.id) || 0;
      const left = line.qty - already;
      if (Number(it.qty) > left + 1e-9) {
        throw badRequest(
          `"${line.name_snapshot}": hoá đơn ${sale.code} bán ${line.qty} ${line.unit_name}, `
          + `đã trả ${already}, chỉ còn trả được ${left}.`, 'RETURN_QTY_EXCEEDED');
      }
      it.sale_item_id = line.id;
      it.product_id = line.product_id;
      it.unit_name = line.unit_name;
      it.factor = line.factor;
      it.unit_cost = line.unit_cost;
      it.price = netUnitPrice(sale, line);
      /* Trả trọn dòng một lần thì lấy đúng số tiền của dòng, khỏi lệch vài
         đồng do làm tròn đơn giá */
      it._exact = already === 0 && Math.abs(Number(it.qty) - line.qty) < 1e-9
        ? netLineValue(sale, line) : null;
      done.set(line.id, already + Number(it.qty));
    }
  }

  /* Nhóm hàng không nhận đổi trả. Soát SAU khi đã khớp dòng hoá đơn gốc: trả
     theo hoá đơn thì máy khách chỉ gửi số dòng (sale_item_id), còn mã mặt
     hàng phải lấy từ hoá đơn ra — soát trước là soát trên mã rỗng. */
  for (const it of items) {
    if (!Number(it.product_id)) {
      throw badRequest('Dòng trả hàng chưa chọn mặt hàng.', 'MISSING_PRODUCT');
    }
    const blocked = noReturnCategoryOf(it.product_id);
    if (blocked) {
      const p = get('SELECT name FROM products WHERE id = ?', [it.product_id]);
      throw badRequest(`"${p?.name || 'Mặt hàng'}" thuộc nhóm "${blocked}" — nhóm này không nhận đổi trả.`,
        'NO_RETURN_CATEGORY');
    }
  }

  const baseWarehouse = Number(b.warehouse_id) || sale?.warehouse_id
    || get('SELECT id FROM warehouses WHERE is_default = 1')?.id;
  const customerId = Number(b.customer_id) || sale?.customer_id || null;
  const method = REFUND_METHODS.includes(b.refund_method) ? b.refund_method : null;
  if (method === 'debt' && !customerId) {
    throw badRequest('Cấn trừ vào công nợ thì phải có khách hàng.', 'DEBT_NEEDS_CUSTOMER');
  }

  return tx(() => {
    const defectWh = items.some((i) => i.condition === 'defect') ? ensureDefectWarehouse() : null;

    let subtotal = 0;
    for (const it of items) {
      it._amount = it._exact ?? Math.round(Number(it.qty) * Math.round(Number(it.price) || 0));
      subtotal += it._amount;
    }
    /* Phí đổi trả: cố định hoặc theo % giá trị hàng trả */
    const feeType = b.fee_type === 'percent' ? 'percent' : 'amount';
    const feePercent = feeType === 'percent' ? Math.max(0, Number(b.fee_percent) || 0) : 0;
    const fee = feeType === 'percent'
      ? Math.round(subtotal * feePercent / 100)
      : Math.max(0, Math.round(Number(b.fee) || 0));
    const total = subtotal - fee;

    /* Tiền mặt / chuyển khoản mới chi ra quỹ. Cấn trừ nợ và phiếu đổi hàng
       thì không đụng tới quỹ. */
    const moneyBack = method === 'debt' || method === 'voucher'
      ? 0
      : Math.min(Math.max(0, Math.round(Number(b.refunded) || 0)), Math.max(total, 0));
    const code = nextCode('sale_returns', 'TH');

    const info = run(`
      INSERT INTO sale_returns(code, ts, sale_id, customer_id, warehouse_id, user_id,
                               subtotal, fee, total, refunded, reason, note,
                               refund_method, fee_type, fee_percent)
      VALUES(?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [code, b.ts || null, sale?.id || null, customerId, baseWarehouse,
      b.user_id || null, subtotal, fee, total, moneyBack, b.reason || null, b.note || null,
      method, feeType, feePercent]);
    const returnId = Number(info.lastInsertRowid);

    for (const it of items) {
      const factor = Number(it.factor) || 1;
      const unitCost = Number(it.unit_cost) || costOf(it.product_id);
      const condition = it.condition === 'defect' ? 'defect' : 'good';
      /* Hàng đạt chuẩn về kho đang bán; hàng lỗi vào kho hàng lỗi, không bán */
      const wh = condition === 'defect' ? defectWh : baseWarehouse;
      run(`INSERT INTO sale_return_items(return_id, product_id, unit_name, factor, qty, price,
                                         unit_cost, amount, sale_item_id, condition, warehouse_id)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [returnId, it.product_id, it.unit_name, factor, Number(it.qty),
        Math.round(Number(it.price) || 0), unitCost, it._amount,
        it.sale_item_id || null, condition, wh]);
      moveStock({
        productId: it.product_id, warehouseId: wh, qtyChange: Number(it.qty) * factor,
        unitCost, refType: 'sale_return', refId: returnId, refCode: code,
        note: condition === 'defect'
          ? `Khách trả ${it.qty} ${it.unit_name} — hàng lỗi, không bán`
          : `Khách trả ${it.qty} ${it.unit_name}`,
        ts: b.ts || null,
      });
    }

    const cust = customerId ? get('SELECT name FROM customers WHERE id = ?', [customerId]) : null;
    let voucher = null;
    if (moneyBack > 0) {
      const accountId = Number(b.account_id)
        || (method === 'transfer' ? (defaultCashAccount('bank') || defaultCashAccount('cash')) : defaultCashAccount());
      if (accountId) addCashTx({
        accountId, direction: 'out', amount: moneyBack, category: 'sale_return',
        partnerType: 'customer', partnerId: customerId,
        partnerName: cust?.name || 'Khách lẻ',
        refType: 'sale_return', refId: returnId, refCode: code,
        userId: b.user_id || null,
        note: `Hoàn tiền trả hàng ${code}`, ts: b.ts || null,
      });
    }
    if (method === 'voucher' && total > 0) {
      voucher = createVoucher({
        amount: total, customerId, sourceType: 'sale_return', sourceId: returnId, sourceCode: code,
        userId: b.user_id || null, note: `Cấp khi trả hàng ${code}`,
      });
      run('UPDATE sale_returns SET voucher_id = ? WHERE id = ?', [voucher.id, returnId]);
    }
    return {
      id: returnId, code, total, subtotal, fee, refunded: moneyBack,
      refund_method: method, voucher, defect_warehouse_id: defectWh,
    };
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
  /* _actor gắn sau khi trải thân yêu cầu — máy khách không tự khai quyền được */
  const b = { ...req.body, _actor: req.user ?? null };
  const backItems = Array.isArray(b.return_items) ? b.return_items.filter((i) => Number(i.qty) > 0) : [];
  const newItems = Array.isArray(b.new_items) ? b.new_items.filter((i) => Number(i.qty) > 0) : [];
  if (!backItems.length) {
    return res.status(400).json({ error: 'Chưa chọn món khách trả lại' });
  }
  const method = REFUND_METHODS.includes(b.refund_method) ? b.refund_method : 'cash';

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
        fee_type: b.fee_type,
        fee_percent: b.fee_percent,
        refunded: 0,          // chưa hoàn vội, còn chờ bù trừ bên dưới
        reason: b.reason || 'Đổi hàng',
        note: b.note || null,
      });
      const credit = Math.max(0, ret.total);   // A trừ phí: tiền khách được trừ
      const customerId = get('SELECT customer_id FROM sale_returns WHERE id = ?', [ret.id]).customer_id;
      const cust = customerId ? get('SELECT name FROM customers WHERE id = ?', [customerId]) : null;
      const partnerName = cust?.name || 'Khách lẻ';

      /**
       * Tiệm còn nợ khách một khoản sau bù trừ: trả bằng cách nào.
       *   cash / transfer  chi ra quỹ
       *   debt             trừ vào công nợ cũ của khách, không chi tiền
       *   voucher          cấp phiếu đổi hàng, không chi tiền — tránh hụt két
       */
      const settle = (amount, exchangeSaleId) => {
        if (amount <= 0) return { refunded: 0 };
        if (method === 'debt') {
          if (!customerId) throw badRequest('Cấn trừ vào công nợ thì phải có khách hàng.', 'DEBT_NEEDS_CUSTOMER');
          run('UPDATE sale_returns SET refund_method = ?, debt_offset = ? WHERE id = ?', ['debt', amount, ret.id]);
          return { refunded: 0, debt_offset: amount };
        }
        if (method === 'voucher') {
          const v = createVoucher({
            amount, customerId, sourceType: 'sale_return', sourceId: ret.id, sourceCode: ret.code,
            userId: b.user_id || null,
            note: exchangeSaleId ? `Tiền thừa khi đổi hàng ${ret.code}` : `Cấp khi trả hàng ${ret.code}`,
          });
          run('UPDATE sale_returns SET refund_method = ?, voucher_id = ? WHERE id = ?', ['voucher', v.id, ret.id]);
          return { refunded: 0, voucher: v };
        }
        const accountId = Number(b.account_id)
          || (method === 'transfer' ? (defaultCashAccount('bank') || defaultCashAccount('cash')) : defaultCashAccount());
        if (accountId) addCashTx({
          accountId, direction: 'out', amount, category: 'sale_return',
          partnerType: 'customer', partnerId: customerId, partnerName,
          refType: 'sale_return', refId: ret.id, refCode: ret.code, userId: b.user_id || null,
          note: exchangeSaleId ? `Hoàn phần chênh khi đổi hàng ${ret.code}` : `Hoàn tiền trả hàng ${ret.code}`,
          ts: b.ts || null,
        });
        run('UPDATE sale_returns SET refunded = ?, refund_method = ? WHERE id = ?', [amount, method, ret.id]);
        return { refunded: amount };
      };

      // Không lấy món mới nào: thành phiếu trả hàng thường
      if (!newItems.length) {
        /* Hoàn tiền mặt thì cho hoàn bớt (b.refund). Không truyền thì hoàn hết.
           Phải kiểm tra trước khi ép kiểu: Number(undefined) ra NaN mà ?? không
           bắt NaN, nên "Number(b.refund) ?? credit" ra NaN và khách không được
           hoàn đồng nào. */
        const asked = b.refund === undefined || b.refund === null || b.refund === ''
          || Number.isNaN(Number(b.refund))
          ? credit
          : Math.round(Number(b.refund));
        const amount = method === 'cash' || method === 'transfer'
          ? Math.max(0, Math.min(asked, credit)) : credit;
        const done = settle(amount, null);
        return {
          return_id: ret.id, return_code: ret.code, credit,
          sale_id: null, sale_code: null, sale_total: 0,
          customer_pays: 0, shop_refunds: done.refunded || 0,
          refund_method: method, voucher: done.voucher || null, debt_offset: done.debt_offset || 0,
        };
      }

      const paidExtra = Math.round(Number(b.paid) || 0);
      // Lập hoá đơn mới trước để biết tổng chính xác, rồi mới chia tiền
      const sale = createSale({
        ts: b.ts || null,
        customer_id: customerId,
        warehouse_id: b.warehouse_id,
        price_list_id: b.price_list_id || null,
        user_id: b.user_id || null,
        items: newItems,
        discount_type: b.discount_type || 'amount',
        discount: b.discount || 0,
        discount_percent: b.discount_percent || 0,
        is_vat_invoice: b.is_vat_invoice ? 1 : 0,
        /* Báo trước phần sẽ bù trừ để soát hạn mức nợ cho đúng. Tiền này
           không vào quỹ (cash_amount và transfer_amount đều 0); số đã trả
           của hoá đơn ghi lại chính xác ngay bên dưới. */
        paid: credit + paidExtra,
        received: 0,
        payment_method: b.payment_method || 'cash',
        cash_amount: 0,
        transfer_amount: 0,
        note: `Đổi hàng theo phiếu ${ret.code}${b.note ? ' — ' + b.note : ''}`,
        approval_token: b.approval_token,
        _actor: b._actor,
      });

      const used = Math.min(credit, sale.total);          // phần bù trừ
      const customerPays = Math.max(0, sale.total - credit);
      const shopOwes = Math.max(0, credit - sale.total);

      // Ghi nhận phần bù trừ + phần khách trả thêm vào hoá đơn mới
      const cashIn = Math.min(paidExtra, customerPays);
      run('UPDATE sales SET paid = ? WHERE id = ?', [used + cashIn, sale.id]);
      /* Nối phiếu trả với hoá đơn mới: công nợ dựa vào mối nối này để KHÔNG
         trừ nợ thêm lần nữa phần đã bù vào hoá đơn mới. Thiếu mối nối là
         khách vừa được trừ tiền hàng mới, vừa được trừ nợ — tính hai lần. */
      run('UPDATE sale_returns SET exchange_sale_id = ? WHERE id = ?', [sale.id, ret.id]);

      const accountId = Number(b.account_id) || defaultCashAccount();
      if (cashIn > 0 && accountId) {
        const isTransfer = b.payment_method === 'transfer';
        run('UPDATE sales SET cash_amount = ?, transfer_amount = ? WHERE id = ?',
          [isTransfer ? 0 : cashIn, isTransfer ? cashIn : 0, sale.id]);
        addCashTx({
          accountId, direction: 'in', amount: cashIn, category: 'sale',
          partnerType: 'customer', partnerId: customerId, partnerName,
          refType: 'sale', refId: sale.id, refCode: sale.code, userId: b.user_id || null,
          note: `Khách bù thêm khi đổi hàng ${sale.code}`, ts: b.ts || null,
        });
      }
      const done = settle(shopOwes, sale.id);

      return {
        return_id: ret.id, return_code: ret.code, credit,
        sale_id: sale.id, sale_code: sale.code, sale_total: sale.total,
        applied: used,
        customer_pays: customerPays,
        paid_now: cashIn,
        still_owed: Math.max(0, customerPays - cashIn),
        shop_refunds: done.refunded || 0,
        refund_method: shopOwes > 0 ? method : null,
        voucher: done.voucher || null,
        debt_offset: done.debt_offset || 0,
        approved_by: sale.approved_by || null,
      };
    });
    if (out.approved_by) consumeApproval(b.approval_token);
    res.json(out);
  } catch (e) {
    res.status(e.status || 400).json({
      error: e.message, code: e.code, needs_approval: e.needs_approval === true,
    });
  }
});

/* ==================================================================== */
/* Hoá đơn tạm — lưu dở trên máy chủ, mọi máy trong tiệm mở tiếp được    */
/* ==================================================================== */

r.get('/drafts', (req, res) => {
  res.json(all(`
    SELECT d.id, d.code, d.ts, d.updated_at, d.title, d.tab_no, d.customer_id, d.total, d.item_count,
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
  /* Số "Đơn Hàng X" — giữ lại để tab mới mở trên màn hình bán hàng không lấy
     trùng số với một đơn đang lưu tạm (tài liệu 01) */
  const tabNo = Number(b.tab_no) > 0 ? Math.round(Number(b.tab_no)) : null;

  if (b.id) {
    const exists = get('SELECT id FROM draft_sales WHERE id = ?', [b.id]);
    if (exists) {
      run(`UPDATE draft_sales SET title = ?, tab_no = ?, customer_id = ?, user_id = ?, warehouse_id = ?,
             price_list_id = ?, total = ?, item_count = ?, payload = ?,
             updated_at = datetime('now','localtime')
           WHERE id = ?`,
        [b.title || null, tabNo, b.customer_id || null, b.user_id || null, b.warehouse_id || null,
          b.price_list_id || null, total, itemCount, payload, b.id]);
      return res.json(get('SELECT id, code, title, tab_no, updated_at FROM draft_sales WHERE id = ?', [b.id]));
    }
  }
  const code = nextCode('draft_sales', 'HDT');
  const info = run(`
    INSERT INTO draft_sales(code, title, tab_no, customer_id, user_id, warehouse_id, price_list_id,
                            total, item_count, payload)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [code, b.title || null, tabNo, b.customer_id || null, b.user_id || null, b.warehouse_id || null,
      b.price_list_id || null, total, itemCount, payload]);
  res.json(get('SELECT id, code, title, tab_no, updated_at FROM draft_sales WHERE id = ?',
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
  /* Hoá đơn còn nợ theo từng hoá đơn, cũ nhất trước (FIFO) */
  c.unpaid_bills = (debtBreakdown(c.id)?.invoices || [])
    .filter((i) => i.remaining > 0)
    .slice(0, 20)
    .map((i) => ({
      id: i.id, code: i.code, ts: i.ts, total: i.total, paid: i.paid,
      remaining: i.remaining, age_days: i.age_days,
    }));
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
 * Hai vòng đời TÁCH RỜI của một đơn giao (tài liệu 04):
 *
 *   Chặng giao     pending    Chờ lấy hàng
 *   (delivery_     shipping   Đang giao hàng
 *    status)       delivered  Giao thành công
 *                  failed     Thất bại / chuyển hoàn
 *
 *   Tiền thu hộ    pending    Chờ đối soát COD
 *   (cod_status)   collected  Đã thu tiền thành công
 *                  cancelled  Giao thất bại, không thu
 *
 * Đợt 11 gộp tiền vào chặng giao ("đã thu tiền" là chặng cuối). Tách ra vì
 * hai việc xảy ra ở hai chỗ: hàng tới tay khách là việc của người giao,
 * tiền về két là việc đối soát — đơn giao thành công hôm nay có khi tuần
 * sau người giao mới nộp tiền. Tiền nộp về đi qua PUT /sales/:id/cod.
 */
export const DELIVERY_STATUSES = ['pending', 'shipping', 'delivered', 'failed'];

/** Cột mốc thời gian của từng chặng, để biết đơn đi mấy ngày rồi. */
const STAMP_OF = { shipping: 'shipped_at', delivered: 'delivered_at' };

/** Danh sách đơn giao — bảng theo dõi ở quầy. */
r.get('/deliveries', (req, res) => {
  const { status = '', cod = '', q = '', carrier_id, from, to, active } = req.query;
  const where = ['s.delivery_status IS NOT NULL', "s.status = 'done'"];
  const params = [];
  if (status) { where.push('s.delivery_status = ?'); params.push(status); }
  if (cod) { where.push('s.cod_status = ?'); params.push(cod); }
  /* "Chưa xong" = hàng chưa tới tay khách, HOẶC tới rồi mà tiền thu hộ chưa
     về. Đơn giao thành công mà còn chờ đối soát vẫn phải trông, không thì
     tiền nằm ở người giao cả tuần mà không ai nhắc. */
  if (active === '1') {
    where.push(`(s.delivery_status IN ('pending','shipping')
                 OR (s.cod_status = 'pending' AND s.delivery_status <> 'failed'))`);
  }
  if (carrier_id) { where.push('s.carrier_id = ?'); params.push(carrier_id); }
  if (from) { where.push('date(s.ts) >= date(?)'); params.push(from); }
  if (to) { where.push('date(s.ts) <= date(?)'); params.push(to); }
  if (q.trim()) {
    where.push(`(s.code LIKE ? OR s.delivery_name LIKE ? OR s.delivery_phone LIKE ?
                 OR s.delivery_address LIKE ? OR s.tracking_code LIKE ? OR s.shipper_name LIKE ?
                 OR s.shipper_phone LIKE ?)`);
    const like = `%${q.trim()}%`;
    params.push(like, like, like, like, like, like, like);
  }
  const w = 'WHERE ' + where.join(' AND ');
  const { page, size, offset } = pageParams(req.query, 20);

  const agg = get(`
    SELECT COUNT(*) AS n,
           COALESCE(SUM(CASE WHEN s.cod_status = 'pending' AND s.delivery_status <> 'failed'
                             THEN s.cod_amount - s.cod_collected END), 0) AS pending_money
    FROM sales s ${w}`, params);

  const rows = all(`
    SELECT s.id, s.code, s.ts, s.total, s.paid, s.ship_fee, s.ship_payer,
           s.delivery_status, s.delivery_name, s.delivery_phone, s.delivery_address,
           s.tracking_code, s.delivery_note,
           s.shipper_name, s.shipper_phone, s.shipper_user_id, su.full_name AS shipper_user_name,
           s.shipped_at, s.delivered_at, s.collected_at,
           s.cod_amount, s.cod_collected, s.cod_status,
           CASE WHEN s.cod_status = 'pending' THEN s.cod_amount - s.cod_collected ELSE 0 END AS cod_left,
           s.carrier_id, ca.name AS carrier_name,
           c.name AS customer_name, c.phone AS customer_phone,
           u.full_name AS user_name,
           CAST(julianday('now','localtime') - julianday(s.ts) AS INTEGER) AS days_out
    FROM sales s
    LEFT JOIN carriers ca ON ca.id = s.carrier_id
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN users su ON su.id = s.shipper_user_id
    ${w}
    ORDER BY s.id DESC LIMIT ${size} OFFSET ${offset}`, params);

  /* Đếm theo từng chặng và từng trạng thái tiền — con số trên các thẻ lọc */
  const counts = {};
  for (const row of all(`
    SELECT s.delivery_status AS st, COUNT(*) AS n FROM sales s
    WHERE s.delivery_status IS NOT NULL AND s.status = 'done'
    GROUP BY s.delivery_status`)) counts[row.st] = row.n;
  const codCounts = {};
  for (const row of all(`
    SELECT s.cod_status AS st, COUNT(*) AS n FROM sales s
    WHERE s.delivery_status IS NOT NULL AND s.status = 'done' AND s.cod_status IS NOT NULL
    GROUP BY s.cod_status`)) codCounts[row.st] = row.n;

  res.json({
    rows, total: agg.n, page, page_size: size,
    counts, cod_counts: codCounts, pending_money: agg.pending_money,
  });
});

/**
 * Đổi chặng giao hàng. KHÔNG đụng tới tiền — tiền đi qua PUT /sales/:id/cod.
 *
 * Giao thất bại thì huỷ khoản thu hộ (khách không nhận hàng thì không có gì
 * để thu). Hàng quay về KHÔNG tự cộng lại kho: hoá đơn vẫn còn đó, người có
 * quyền huỷ hoá đơn phải huỷ để nhập lại kho — việc đó sinh chứng từ riêng,
 * không để một cú đổi trạng thái âm thầm làm thay.
 */
r.put('/sales/:id/delivery', (req, res) => {
  const b = req.body;
  const sale = get('SELECT * FROM sales WHERE id = ?', [req.params.id]);
  if (!sale) return res.status(404).json({ error: 'Không tìm thấy hoá đơn' });
  if (sale.status !== 'done') return res.status(400).json({ error: `Hoá đơn ${sale.code} đã bị huỷ` });

  const next = b.delivery_status === undefined ? sale.delivery_status : (b.delivery_status || null);
  if (next && !DELIVERY_STATUSES.includes(next)) {
    return res.status(400).json({
      error: `Chặng giao hàng không hợp lệ: ${next}. `
        + 'Tiền thu hộ đối soát ở mục riêng, không còn là một chặng giao.',
    });
  }
  if (next === 'failed' && sale.cod_collected > 0) {
    return res.status(400).json({
      error: `Người giao đã nộp về ${sale.cod_collected.toLocaleString('vi-VN')} đ tiền thu hộ của đơn này. `
        + 'Hoàn lại số tiền đó trước rồi mới đánh dấu giao thất bại.',
    });
  }

  try {
    const out = tx(() => {
      const changed = next !== sale.delivery_status;
      const stamp = changed && STAMP_OF[next] ? STAMP_OF[next] : null;

      /* Giữ nguyên trường nào không gửi lên — màn hình theo dõi chỉ đổi
         chặng, không nên xoá mất mã vận đơn đã nhập từ trước. */
      const keep = (v, old) => (v === undefined ? old : (v || null));

      run(`UPDATE sales SET delivery_status = ?, tracking_code = ?, carrier_id = ?,
             delivery_note = ?, shipper_name = ?, shipper_user_id = ?, shipper_phone = ?
             ${stamp ? `, ${stamp} = COALESCE(${stamp}, datetime('now','localtime'))` : ''}
           WHERE id = ?`,
      [next, keep(b.tracking_code, sale.tracking_code), keep(b.carrier_id, sale.carrier_id),
        keep(b.delivery_note, sale.delivery_note), keep(b.shipper_name, sale.shipper_name),
        keep(b.shipper_user_id, sale.shipper_user_id), keep(b.shipper_phone, sale.shipper_phone),
        sale.id]);

      if (changed && next === 'failed' && sale.cod_status === 'pending') {
        run("UPDATE sales SET cod_status = 'cancelled' WHERE id = ?", [sale.id]);
      }
      /* Lỡ tay đánh thất bại rồi sửa lại: khôi phục khoản thu hộ */
      if (changed && sale.delivery_status === 'failed' && next !== 'failed'
          && sale.cod_status === 'cancelled' && sale.cod_amount > sale.cod_collected) {
        run("UPDATE sales SET cod_status = 'pending' WHERE id = ?", [sale.id]);
      }
      return { ok: true, sale: get('SELECT * FROM sales WHERE id = ?', [sale.id]) };
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
           ca.name AS carrier_name, u.full_name AS user_name, su.full_name AS shipper_user_name
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN carriers ca ON ca.id = s.carrier_id
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN users su ON su.id = s.shipper_user_id
    WHERE s.id = ?`, [req.params.id]);
  if (!sale) return res.status(404).json({ error: 'Không tìm thấy hoá đơn' });
  sale.items = all(`
    SELECT si.*, p.base_unit
    FROM sale_items si LEFT JOIN products p ON p.id = si.product_id
    WHERE si.sale_id = ? ORDER BY si.id`, [sale.id]);
  /* Số tiền người giao phải thu của khách = phần thu hộ còn lại. Đơn ghi nợ
     hoặc đã trả đủ tại quầy thì người giao không thu gì. */
  sale.cod_left = sale.cod_status === 'pending' ? sale.cod_amount - sale.cod_collected : 0;
  sale.owed = sale.cod_left;
  res.json(sale);
});

/* ========================== CÔNG NỢ KHÁCH ========================== */

r.get('/customer-debts', (req, res) => {
  const rows = all('SELECT * FROM customers WHERE active = 1 ORDER BY name');
  const out = [];
  for (const c of rows) {
    const debt = customerDebt(c.id);
    if (debt === 0 && req.query.all !== '1') continue;
    /* Hoá đơn còn nợ tính theo TỪNG hoá đơn (đã trừ tiền thu gán vào nó),
       không phải "total > paid" — hoá đơn khách trả nợ rồi mà vẫn đếm là
       còn nợ thì tuổi nợ cứ tăng mãi, khách bị chặn mua nợ oan. */
    const open = (debtBreakdown(c.id)?.invoices || []).filter((i) => i.remaining > 0);
    out.push({
      id: c.id, code: c.code, name: c.name, phone: c.phone,
      opening_debt: c.opening_debt, debt_limit: c.debt_limit, debt,
      over_limit: c.debt_limit > 0 && debt > c.debt_limit,
      unpaid_bills: open.length,
      oldest_unpaid: open[0]?.ts || null,
      // Nợ lâu nhất bao nhiêu ngày — để màn hình bán hàng tô đỏ khoản nợ dai
      oldest_days: open[0]?.age_days || 0,
    });
  }
  res.json(out);
});

export default r;
