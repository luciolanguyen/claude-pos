/* ====================================================================
   ĐIỂM TÍCH LUỸ — "VÍ THÀNH VIÊN" (yêu cầu 28/09, mục IV.1)

   Khách mua hàng thì được cộng điểm; lần sau mua, điểm trừ thẳng vào tiền
   phải trả — thành một kênh trả tiền nữa, cạnh tiền mặt, phiếu đổi hàng và
   trừ lương.

   Ví thành viên ở đây KHÔNG giữ tiền khách nạp (chủ tiệm đã chốt): ví chính
   là sổ điểm, nên không phát sinh khoản tiệm nợ khách và quỹ không đụng tới.

   Sổ điểm ghi mỗi lần cộng / trừ một dòng, số dư là tổng của sổ. Không giữ
   cột tổng ở hồ sơ khách — một nguồn chân lý thì không bao giờ lệch, đúng
   lối `payroll_entries` của bảng lương.
   ==================================================================== */
import { get, all, run, getSettings } from './db.js';

const badRequest = (message, code) => Object.assign(new Error(message), { status: 400, code });
const vnd = (v) => Math.round(Number(v) || 0).toLocaleString('vi-VN');

/** Thiết lập của phân hệ, đọc từ mục "Chính sách bán hàng tại quầy". */
export function loyaltyConfig() {
  const p = getSettings().pos || {};
  // Number(undefined) là NaN, mà ?? không bắt NaN — phải kiểm tra trước khi ép kiểu
  const num = (v, fallback) =>
    v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v);
  return {
    enabled: !!p.points_enabled,
    /* Bao nhiêu đồng tiền hàng thì được 1 điểm */
    earn_per: Math.max(0, Math.round(num(p.points_earn_per, 10000))),
    /* 1 điểm trừ được bao nhiêu đồng */
    value: Math.max(0, Math.round(num(p.points_value, 1000))),
    min_redeem: Math.max(0, Math.round(num(p.points_min_redeem, 10))),
    /* Điểm trừ tối đa bao nhiêu phần trăm tiền hoá đơn */
    max_percent: Math.min(100, Math.max(0, num(p.points_max_percent, 50))),
  };
}

/** Số điểm khách đang có. Khách lẻ (không có hồ sơ) thì không có điểm. */
export function pointsBalance(customerId) {
  const id = Number(customerId) || 0;
  if (!id) return 0;
  return get('SELECT COALESCE(SUM(points), 0) AS n FROM loyalty_entries WHERE customer_id = ?', [id]).n;
}

function addEntry({
  customerId, points, kind, money = 0, baseAmount = 0,
  refType = null, refId = null, refCode = null, userId = null, note = null, ts = null,
}) {
  const p = Math.round(Number(points) || 0);
  if (!p) return null;
  const info = run(`
    INSERT INTO loyalty_entries(ts, customer_id, points, kind, money, base_amount,
                                ref_type, ref_id, ref_code, user_id, note)
    VALUES(COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [ts, Number(customerId), p, kind, Math.round(Number(money) || 0), Math.round(Number(baseAmount) || 0),
    refType, refId, refCode, userId, note]);
  return Number(info.lastInsertRowid);
}

/**
 * Tiền hàng của một hoá đơn được tính điểm.
 *
 * Chủ tiệm chốt: KHÔNG tích cho món mua hộ (tiệm chỉ ăn hoa hồng), phí giao
 * hàng (tiền trả hãng xe) và thuế VAT (tiền của nhà nước).
 */
export function earnBase({ subtotal, discount, consignTotal = 0 }) {
  return Math.max(0, Math.round(Number(subtotal) || 0)
    - Math.round(Number(discount) || 0)
    - Math.round(Number(consignTotal) || 0));
}

/** Cộng điểm cho một hoá đơn. Trả về số điểm đã cộng (0 nếu không tích). */
export function earnPoints({ customerId, base, saleId, saleCode, userId = null, ts = null }) {
  const cfg = loyaltyConfig();
  if (!cfg.enabled || !customerId || cfg.earn_per <= 0) return 0;
  const money = Math.max(0, Math.round(Number(base) || 0));
  const points = Math.floor(money / cfg.earn_per);
  if (points <= 0) return 0;
  addEntry({
    customerId, points, kind: 'earn', baseAmount: money,
    refType: 'sale', refId: saleId, refCode: saleCode, userId, ts,
    note: `Mua hàng ${saleCode}`,
  });
  return points;
}

/**
 * Soát yêu cầu dùng điểm TRƯỚC khi ghi hoá đơn. Trả về { points, money }.
 *
 * Báo lỗi rõ ràng thay vì lặng lẽ hạ số điểm xuống: quầy phải biết vì sao
 * khách không trừ được đủ như đã hứa với khách.
 */
export function redeemPlan({ customerId, points, total, due }) {
  const cfg = loyaltyConfig();
  const asked = Math.max(0, Math.round(Number(points) || 0));
  if (!asked) return { points: 0, money: 0 };
  if (!cfg.enabled) throw badRequest('Phân hệ điểm tích luỹ đang tắt — bật ở Thiết lập trước đã.', 'POINTS_OFF');
  if (!customerId) throw badRequest('Phải chọn khách hàng mới dùng điểm được.', 'POINTS_NO_CUSTOMER');
  if (cfg.value <= 0) throw badRequest('Chưa khai 1 điểm đổi được bao nhiêu tiền.', 'POINTS_NO_VALUE');

  const balance = pointsBalance(customerId);
  if (asked > balance) {
    throw badRequest(`Khách chỉ còn ${balance} điểm, không trừ được ${asked} điểm.`, 'POINTS_NOT_ENOUGH');
  }
  if (asked < cfg.min_redeem) {
    throw badRequest(`Mỗi lần dùng tối thiểu ${cfg.min_redeem} điểm.`, 'POINTS_MIN');
  }
  const money = asked * cfg.value;
  const cap = Math.floor(Math.round(Number(total) || 0) * cfg.max_percent / 100);
  if (money > cap) {
    throw badRequest(`Điểm chỉ trừ được tối đa ${cfg.max_percent}% hoá đơn (${vnd(cap)} đ).`, 'POINTS_CAP');
  }
  if (money > Math.max(0, Math.round(Number(due) || 0))) {
    throw badRequest(`Điểm trừ ${vnd(money)} đ, nhiều hơn số tiền còn thiếu của hoá đơn.`, 'POINTS_OVER_DUE');
  }
  return { points: asked, money };
}

/** Trừ điểm vào một hoá đơn. Gọi trong tx() của hoá đơn. */
export function redeemPoints({ customerId, points, money, saleId, saleCode, userId = null, ts = null }) {
  if (!points) return 0;
  addEntry({
    customerId, points: -Math.abs(Math.round(points)), kind: 'redeem', money,
    refType: 'sale', refId: saleId, refCode: saleCode, userId, ts,
    note: `Trừ vào hoá đơn ${saleCode}`,
  });
  return points;
}

/** Thu hồi điểm đã tích (trả hàng, huỷ đơn). */
export function revokePoints({
  customerId, points, refType, refId, refCode, userId = null, note = null, ts = null,
}) {
  const p = Math.abs(Math.round(Number(points) || 0));
  if (!customerId || !p) return 0;
  addEntry({
    customerId, points: -p, kind: 'revoke', refType, refId, refCode, userId, ts,
    note: note || 'Thu hồi điểm',
  });
  return p;
}

/** Trả lại điểm khách đã dùng (hoá đơn bị huỷ, hoặc trả hàng chọn hoàn vào điểm). */
export function refundPoints({
  customerId, points, money = 0, refType, refId, refCode, userId = null, note = null, ts = null,
}) {
  const p = Math.abs(Math.round(Number(points) || 0));
  if (!customerId || !p) return 0;
  addEntry({
    customerId, points: p, kind: 'refund', money, refType, refId, refCode, userId, ts,
    note: note || 'Hoàn lại điểm đã dùng',
  });
  return p;
}

/**
 * Chủ tiệm / quản lý cộng trừ điểm bằng tay. BẮT BUỘC có lý do: điểm là tiền,
 * sổ không có đường xoá dòng nên mỗi lần chỉnh phải nói rõ vì sao.
 */
export function adjustPoints({ customerId, points, userId = null, note }) {
  const id = Number(customerId) || 0;
  const p = Math.round(Number(points) || 0);
  if (!id) throw badRequest('Chưa chọn khách hàng.');
  if (!p) throw badRequest('Số điểm phải khác 0.');
  const reason = String(note || '').trim();
  if (!reason) throw badRequest('Phải ghi lý do cộng / trừ điểm.', 'POINTS_NO_REASON');
  const balance = pointsBalance(id);
  if (p < 0 && balance + p < 0) {
    throw badRequest(`Khách chỉ còn ${balance} điểm, không trừ được ${Math.abs(p)} điểm.`, 'POINTS_NOT_ENOUGH');
  }
  addEntry({ customerId: id, points: p, kind: 'adjust', refType: 'manual', userId, note: reason });
  return pointsBalance(id);
}

/** Sổ điểm của một khách, mới nhất trên cùng. */
export function pointsLedger(customerId, { limit = 20, offset = 0 } = {}) {
  const id = Number(customerId) || 0;
  const total = get('SELECT COUNT(*) AS n FROM loyalty_entries WHERE customer_id = ?', [id]).n;
  const rows = all(`
    SELECT e.*, u.full_name AS user_name
    FROM loyalty_entries e LEFT JOIN users u ON u.id = e.user_id
    WHERE e.customer_id = ?
    ORDER BY e.id DESC LIMIT ? OFFSET ?`, [id, limit, offset]);
  return { balance: pointsBalance(id), rows, total };
}
