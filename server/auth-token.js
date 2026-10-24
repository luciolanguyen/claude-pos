/* ====================================================================
   MÃ ĐĂNG NHẬP CÓ CHỮ KÝ

   Trước đây máy chủ nhận ra người gọi chỉ bằng dòng x-user-id do trình
   duyệt tự khai: ai nối wifi tiệm, đặt x-user-id: 1 là thành chủ tiệm,
   mọi chốt chặn quyền vô tác dụng. Giờ đăng nhập đúng mật khẩu mới được
   cấp một mã, mã có chữ ký bằng khoá bí mật chỉ máy chủ giữ — sửa một
   chữ trong mã là chữ ký sai, máy chủ không nhận.

   Không lưu mã nào trong CSDL: khởi động lại máy chủ thì không ai bị văng
   ra. Muốn thu hồi thì tăng users.token_ver (đổi mật khẩu, đổi vai trò,
   khoá tài khoản) — mọi mã cũ của người đó hết hiệu lực ngay.

   File này chỉ dùng crypto + fs, không đụng CSDL, để công cụ chạy thử
   (tools/dryrun-upgrade.mjs, tools/dev-token.mjs) ký được mã cho bản sao.
   ==================================================================== */
import crypto from 'node:crypto';
import fs from 'node:fs';

/** Mã sống 30 ngày; mỗi lần mở phần mềm, /api/me cấp mã mới nên máy dùng hằng ngày không bao giờ hết hạn */
export const TOKEN_DAYS = 30;

/**
 * Khoá ký nằm cạnh file dữ liệu, riêng từng CSDL (pos.db → pos.db.authkey):
 * mã cấp cho máy nháp test-ui không dùng được trên dữ liệu thật dù trùng id.
 * Nằm trong data/ nên không bao giờ lên git, và không nằm trong file sao lưu
 * JSON (sao lưu lộ ra thì khoá vẫn an toàn).
 */
export const keyFileOf = (dbFile) => `${dbFile}.authkey`;

export function loadKey(keyFile) {
  try {
    const k = fs.readFileSync(keyFile, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(k)) return Buffer.from(k, 'hex');
  } catch { /* chưa có thì tạo bên dưới */ }
  const k = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, k.toString('hex') + '\n', { mode: 0o600 });
  return k;
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const mac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/** user cần { id, token_ver } */
export function signToken(key, user, now = Date.now()) {
  const body = b64(JSON.stringify({
    u: user.id, v: Number(user.token_ver) || 0, exp: Math.floor(now / 1000) + TOKEN_DAYS * 86400,
  }));
  return `${body}.${b64(mac(key, body))}`;
}

/** Trả { u, v, exp } nếu chữ ký đúng và còn hạn, ngược lại null */
export function verifyToken(key, token, now = Date.now()) {
  const s = String(token || '');
  const dot = s.indexOf('.');
  if (dot <= 0 || s.length > 500) return null;
  const body = s.slice(0, dot);
  const sig = Buffer.from(s.slice(dot + 1), 'base64url');
  const want = mac(key, body);
  if (sig.length !== want.length || !crypto.timingSafeEqual(sig, want)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || !Number.isInteger(p.u) || !(p.exp * 1000 > now)) return null;
  return p;
}

/**
 * Lấy mã từ lời gọi: header Authorization: Bearer <mã>, hoặc ?t=<mã> trên
 * đường dẫn — thẻ <img> và tải file sao lưu bằng window.location không gửi
 * được header tự đặt.
 */
export function tokenFromReq(req) {
  const h = req.get?.('authorization') || '';
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  if (m) return m[1];
  return typeof req.query?.t === 'string' ? req.query.t : '';
}
