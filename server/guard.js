/* Nối bảng phân quyền với cơ sở dữ liệu và thiết lập của tiệm. */
import { get, getSettings, DB_FILE } from './db.js';
import { makeRequire, permsOf } from './permissions.js';
import { keyFileOf, loadKey, signToken, verifyToken, tokenFromReq } from './auth-token.js';

const getUserById = (id) =>
  get('SELECT id, username, full_name, role, active, token_ver FROM users WHERE id = ?', [id]);

/* Khoá ký mã đăng nhập — tạo một lần cạnh file dữ liệu, giữ nguyên qua các lần khởi động */
const KEY = loadKey(keyFileOf(DB_FILE));

/** Tiệm bật "bỏ qua đăng nhập" thì không phân quyền được, cho qua hết. */
const isLoginRequired = () => getSettings()?.pos?.skip_login !== true;

/** Cấp mã đăng nhập cho một người (sau khi đã soát đúng mật khẩu). */
export const issueToken = (user) => signToken(KEY, user);

/**
 * Người đang gọi API, hoặc null nếu chưa đăng nhập.
 * Chỉ tin mã có chữ ký đúng, còn hạn, và đúng đời mã hiện tại của người đó —
 * đổi mật khẩu hay đổi vai trò là mã cũ trên mọi máy hết dùng được.
 */
export function whoami(req) {
  if (req._who !== undefined) return req._who;
  const p = verifyToken(KEY, tokenFromReq(req));
  const u = p ? getUserById(p.u) : null;
  const who = u && (Number(u.token_ver) || 0) === p.v ? u : null;
  /* Mỗi lời gọi đi qua 2–3 lớp chặn, nhớ lại để khỏi soát chữ ký và đọc CSDL nhiều lần */
  Object.defineProperty(req, '_who', { value: who, enumerable: false });
  return who;
}

/** need('cash.manage') — dùng làm middleware trước tay xử lý của route. */
export const need = makeRequire(whoami, isLoginRequired);

/** Kiểm tra quyền ngay trong thân route, không qua middleware. */
export function can(req, perm) {
  if (!isLoginRequired()) return true;
  const u = whoami(req);
  return !!u && !!u.active && permsOf(u.role).includes(perm);
}

export { isLoginRequired };
