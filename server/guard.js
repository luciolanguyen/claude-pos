/* Nối bảng phân quyền với cơ sở dữ liệu và thiết lập của tiệm. */
import { get, getSettings } from './db.js';
import { makeRequire, permsOf, currentUser } from './permissions.js';

const getUserById = (id) =>
  get('SELECT id, username, full_name, role, active FROM users WHERE id = ?', [id]);

/** Tiệm bật "bỏ qua đăng nhập" thì không phân quyền được, cho qua hết. */
const isLoginRequired = () => getSettings()?.pos?.skip_login !== true;

/** need('cash.manage') — dùng làm middleware trước tay xử lý của route. */
export const need = makeRequire(getUserById, isLoginRequired);

/** Người đang gọi API, hoặc null nếu chưa đăng nhập. */
export const whoami = (req) => currentUser(req, getUserById);

/** Kiểm tra quyền ngay trong thân route, không qua middleware. */
export function can(req, perm) {
  if (!isLoginRequired()) return true;
  const u = whoami(req);
  return !!u && !!u.active && permsOf(u.role).includes(perm);
}

export { isLoginRequired };
