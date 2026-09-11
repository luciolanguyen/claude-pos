/* ====================================================================
   PHIẾU ĐỔI HÀNG

   Khách trả hàng mà tiệm không muốn chi tiền mặt ra — cuối ca két hụt,
   người đứng quầy phải bù — thì cấp một phiếu có mã. Lần sau khách mua,
   đọc mã phiếu là trừ vào tiền hàng.

   Phiếu là giấy tờ có giá như tiền mặt: ai cầm mã thì dùng được. Riêng
   phiếu ghi đích danh một khách thì chỉ khách đó dùng.
   ==================================================================== */
import crypto from 'node:crypto';
import { get, run, getSettings } from './db.js';

/* Bỏ chữ dễ nhìn nhầm (0/O, 1/I/L) — mã đọc qua điện thoại hay chép tay */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomPart(len) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

const badRequest = (message, code) => Object.assign(new Error(message), { status: 400, code });

/** Phiếu còn dùng được trong bao nhiêu ngày. 0 = không hết hạn. */
function voucherDays() {
  const v = Number(getSettings().pos?.voucher_days);
  return Number.isFinite(v) && v >= 0 ? Math.round(v) : 90;
}

export function createVoucher({
  amount, customerId = null, sourceType = null, sourceId = null, sourceCode = null,
  userId = null, note = null,
}) {
  const value = Math.round(Number(amount) || 0);
  if (value <= 0) throw badRequest('Giá trị phiếu đổi hàng phải lớn hơn 0');

  const d = new Date();
  const stamp = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  let code;
  do { code = `PDH${stamp}-${randomPart(5)}`; }
  while (get('SELECT id FROM vouchers WHERE code = ?', [code]));

  const days = voucherDays();
  const info = run(`
    INSERT INTO vouchers(code, customer_id, amount, balance, source_type, source_id, source_code,
                         expires_at, status, user_id, note)
    VALUES(?, ?, ?, ?, ?, ?, ?,
           ${days > 0 ? `date('now','localtime','+${days} days')` : 'NULL'},
           'active', ?, ?)`,
  [code, customerId, value, value, sourceType, sourceId, sourceCode, userId, note]);
  return get('SELECT * FROM vouchers WHERE id = ?', [Number(info.lastInsertRowid)]);
}

/** Tra phiếu theo mã, kèm lý do không dùng được (nếu có). */
export function lookupVoucher(code) {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c) return null;
  const v = get(`
    SELECT v.*, cu.name AS customer_name
    FROM vouchers v LEFT JOIN customers cu ON cu.id = v.customer_id
    WHERE UPPER(v.code) = ?`, [c]);
  if (!v) return null;
  const today = get("SELECT date('now','localtime') AS d").d;
  v.usable = v.status === 'active' && v.balance > 0 && !(v.expires_at && v.expires_at < today);
  v.why_not = v.usable ? null
    : v.status === 'void' ? 'Phiếu đã bị huỷ'
      : v.balance <= 0 || v.status === 'used' ? 'Phiếu đã dùng hết'
        : 'Phiếu đã hết hạn';
  return v;
}

/**
 * Trừ phiếu vào một hoá đơn. Trả về số tiền thực trừ.
 * Gọi trong tx() của hoá đơn — hoá đơn hỏng thì phiếu cũng không bị trừ.
 */
export function redeemVoucher({ code, amount, saleId, customerId }) {
  const v = lookupVoucher(code);
  if (!v) throw badRequest(`Không tìm thấy phiếu đổi hàng "${code}"`, 'VOUCHER_NOT_FOUND');
  if (!v.usable) throw badRequest(`Phiếu ${v.code}: ${v.why_not}`, 'VOUCHER_UNUSABLE');
  if (v.customer_id && Number(customerId) !== v.customer_id) {
    throw badRequest(
      `Phiếu ${v.code} ghi đích danh khách "${v.customer_name}". Chọn đúng khách đó mới dùng được.`,
      'VOUCHER_WRONG_CUSTOMER');
  }
  const use = Math.min(Math.round(Number(amount) || 0), v.balance);
  if (use <= 0) return 0;
  const left = v.balance - use;
  run(`UPDATE vouchers SET balance = ?, status = ? WHERE id = ?`,
    [left, left > 0 ? 'active' : 'used', v.id]);
  run('INSERT INTO voucher_uses(voucher_id, sale_id, amount) VALUES(?, ?, ?)', [v.id, saleId, use]);
  return use;
}
