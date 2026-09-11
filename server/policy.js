/* ====================================================================
   CHÍNH SÁCH BÁN HÀNG VÀ DUYỆT BẰNG MÃ PIN

   Vài việc thu ngân không được tự quyết: giảm giá quá hạn mức, bán nợ
   vượt hạn mức của khách. Quản lý đứng cạnh thì gõ mã PIN của mình để
   duyệt, không phải đăng xuất rồi đăng nhập lại tài khoản quản lý.

   Máy khách KHÔNG giữ mã PIN. Gõ đúng PIN thì máy chủ phát một phiếu duyệt
   ngắn hạn; hoá đơn gửi kèm phiếu duyệt đó, máy chủ soát lại lần nữa rồi
   mới lưu. Nếu để máy khách tự báo "đã duyệt rồi" thì ai sửa được trình
   duyệt cũng tự duyệt cho mình được.

   Như mật khẩu đăng nhập, đây là hàng rào chống làm nhầm giữa người trong
   tiệm chứ không phải lớp bảo mật: PIN lưu dạng chữ thường, 4 chữ số thì
   thử hết cũng chỉ mười nghìn lần. Chặn gõ sai liên tiếp là để khỏi thử
   mò, không phải để chống người rành máy tính.
   ==================================================================== */
import crypto from 'node:crypto';
import { get, getSettings } from './db.js';

/* --------------------------- Chính sách chung ----------------------- */

/** Số đọc từ thiết lập, thiếu hoặc hỏng thì lấy mặc định. */
function num(v, fallback) {
  if (v === undefined || v === null || v === '' || Number.isNaN(Number(v))) return fallback;
  return Number(v);
}

/** Toàn bộ chính sách bán hàng, kèm giá trị mặc định hợp lý. */
export function posPolicy() {
  const p = getSettings().pos || {};
  return {
    /* Số tab đơn hàng mở cùng lúc. Máy tính tiền cũ mở quá nhiều tab là ì. */
    maxTabs: Math.max(1, Math.round(num(p.max_tabs, 10))),
    /* Thu ngân tự giảm tới bao nhiêu %, quá thì cần quản lý duyệt. */
    cashierMaxDiscountPercent: Math.max(0, num(p.cashier_max_discount_percent, 10)),
    /* Nhận đổi trả trong bao nhiêu ngày kể từ ngày mua. 0 = không giới hạn. */
    returnDays: Math.max(0, Math.round(num(p.return_days, 7))),
    returnFeeType: p.return_fee_type === 'percent' ? 'percent' : 'amount',
    returnFeeValue: Math.max(0, num(p.return_fee_value, 0)),
    /* Có hoá đơn nợ quá bao nhiêu ngày thì không cho mua nợ tiếp. 0 = tắt.

       MẶC ĐỊNH TẮT, chủ tiệm tự bật ở Thiết lập. Bật sẵn 30 ngày thì ngay hôm
       cập nhật phần mềm, khách thầu quen đang nợ dồn từ tháng trước bị chặn
       mua nợ giữa lúc đứng quầy — dữ liệu mẫu có đúng một khách như vậy (5
       hoá đơn nợ quá hạn, cũ nhất 59 ngày) và bị chặn ngay lần bán đầu tiên. */
    maxDebtDays: Math.max(0, Math.round(num(p.max_debt_days, 0))),
  };
}

/**
 * Số ngày nợ tối đa áp cho một khách (tài liệu 08). Khách có cài riêng thì
 * theo khách — kể cả 0, nghĩa là khách này không giới hạn số ngày; để trống
 * thì theo chính sách chung của tiệm.
 */
export function maxDebtDaysFor(customerId) {
  const c = customerId ? get('SELECT max_debt_days FROM customers WHERE id = ?', [customerId]) : null;
  if (c && c.max_debt_days !== null && c.max_debt_days !== undefined) {
    return Math.max(0, Math.round(Number(c.max_debt_days) || 0));
  }
  return posPolicy().maxDebtDays;
}

/* ------------------------------- Mã PIN ------------------------------ */

const APPROVER_ROLES = ['owner', 'manager'];

/** Vai trò này có tự làm được việc cần duyệt không (khỏi phải gõ PIN). */
export const isApproverRole = (role) => APPROVER_ROLES.includes(role);

const failures = new Map();          // khoá -> { n, until }
const MAX_FAILS = 5;
const LOCK_MS = 60 * 1000;

const httpError = (message, status, code) =>
  Object.assign(new Error(message), { status, code });

/**
 * Soát mã PIN. Đúng thì trả về người duyệt, sai thì ném lỗi.
 * @param key  ai đang thử — dùng để khoá riêng người gõ sai nhiều lần
 */
export function verifyPin(pin, key = 'anon') {
  const now = Date.now();
  const f = failures.get(key);
  if (f && f.until > now) {
    throw httpError(
      `Gõ sai mã PIN quá ${MAX_FAILS} lần. Thử lại sau ${Math.ceil((f.until - now) / 1000)} giây.`,
      429, 'PIN_LOCKED');
  }

  const fail = (message) => {
    const cur = failures.get(key) || { n: 0, until: 0 };
    cur.n += 1;
    if (cur.n >= MAX_FAILS) { cur.until = now + LOCK_MS; cur.n = 0; }
    failures.set(key, cur);
    return httpError(message, 403, 'PIN_WRONG');
  };

  const s = String(pin ?? '').trim();
  if (!/^\d{4,8}$/.test(s)) throw fail('Mã PIN phải là từ 4 đến 8 chữ số.');

  const u = get(
    `SELECT id, full_name, role FROM users
     WHERE pin = ? AND active = 1 AND role IN ('owner', 'manager')`, [s]);
  if (!u) throw fail('Mã PIN không đúng, hoặc không phải mã của chủ cửa hàng / quản lý.');

  failures.delete(key);
  return u;
}

/* ---------------------------- Phiếu duyệt ---------------------------- */

const approvals = new Map();         // mã phiếu -> { approver, reason, expires }
const APPROVAL_MS = 30 * 60 * 1000;

/** Phát phiếu duyệt sau khi PIN đúng. */
export function issueApproval(approver, reason) {
  /* Dọn phiếu hết hạn để bảng khỏi phình theo ngày */
  const now = Date.now();
  for (const [k, v] of approvals) if (v.expires < now) approvals.delete(k);

  const token = crypto.randomBytes(18).toString('hex');
  approvals.set(token, {
    approver: { id: approver.id, full_name: approver.full_name, role: approver.role },
    reason: reason || '',
    expires: now + APPROVAL_MS,
  });
  return { token, approver: approvals.get(token).approver, expires_in: APPROVAL_MS / 1000 };
}

/** Xem phiếu duyệt còn hiệu lực không (không xoá). */
export function peekApproval(token) {
  if (!token) return null;
  const a = approvals.get(String(token));
  if (!a || a.expires < Date.now()) return null;
  return a;
}

/** Dùng xong thì huỷ phiếu, để một lần duyệt không xài được cho hoá đơn khác. */
export function consumeApproval(token) {
  const a = peekApproval(token);
  if (a) approvals.delete(String(token));
  return a;
}

/* ------------------------- Giảm giá so với bảng giá ------------------ */

/** Giá niêm yết của một đơn vị hàng theo bảng giá. Không tìm được thì null. */
export function listPriceOf(productId, unitName, priceListId) {
  const unit = get('SELECT id FROM product_units WHERE product_id = ? AND unit_name = ?',
    [productId, unitName]);
  if (!unit) return null;
  const plId = Number(priceListId)
    || get('SELECT id FROM price_lists WHERE is_default = 1')?.id;
  if (!plId) return null;
  const row = get('SELECT price FROM product_prices WHERE unit_id = ? AND price_list_id = ?',
    [unit.id, plId]);
  return row ? Math.round(Number(row.price) || 0) : null;
}

/**
 * Mức giảm giá THẬT của một hoá đơn, tính so với bảng giá.
 *
 * So với bảng giá chứ không so với đơn giá gửi lên: thu ngân sửa tay đơn
 * giá từ 100.000 xuống 50.000 rồi để ô giảm giá bằng 0 thì vẫn là giảm 50%.
 * Soát ô giảm giá không thôi thì lách được ngay.
 *
 * So theo đúng bảng giá của hoá đơn: bán giá thợ điện thấp hơn giá lẻ là
 * chính sách của tiệm, không phải thu ngân tự giảm.
 */
export function discountExposure(items, priceListId, order = {}) {
  let listTotal = 0;
  let subtotal = 0;
  let worstLine = null;

  for (const it of items) {
    const qty = Number(it.qty) || 0;
    const price = Math.round(Number(it.price) || 0);
    const gross = Math.round(qty * price);
    const disc = it.discount_type === 'percent'
      ? Math.round(gross * (Number(it.discount_percent) || 0) / 100)
      : Math.round(Number(it.discount) || 0);
    const amount = gross - Math.min(disc, gross);

    const list = listPriceOf(it.product_id, it.unit_name, priceListId);
    const listGross = Math.round(qty * (list ?? price));
    const pct = listGross > 0 ? Math.max(0, (listGross - amount) / listGross * 100) : 0;

    listTotal += listGross;
    subtotal += amount;
    if (!worstLine || pct > worstLine.percent) {
      worstLine = { product_id: it.product_id, name: it.name_snapshot || '', percent: pct };
    }
  }

  const orderDisc = order.discount_type === 'percent'
    ? Math.round(subtotal * (Number(order.discount_percent) || 0) / 100)
    : Math.round(Number(order.discount) || 0);
  const finalGoods = subtotal - Math.min(orderDisc, subtotal);
  /* Tổng giảm cả đơn: giảm ở dòng cộng giảm cả đơn. Tách riêng từng mức thì
     giảm 9% dòng rồi thêm 9% cả đơn là lọt hạn mức 10% mà thực chất gần 17%. */
  const totalPercent = listTotal > 0 ? Math.max(0, (listTotal - finalGoods) / listTotal * 100) : 0;

  return {
    list_total: listTotal,
    final_goods: finalGoods,
    total_percent: Math.round(totalPercent * 100) / 100,
    worst_line: worstLine && { ...worstLine, percent: Math.round(worstLine.percent * 100) / 100 },
    max_percent: Math.round(Math.max(totalPercent, worstLine?.percent || 0) * 100) / 100,
  };
}
