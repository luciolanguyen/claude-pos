/**
 * KÝ MÃ ĐĂNG NHẬP CHO MÁY NHÁP — để soát giao diện mà không phải gõ mật khẩu.
 *
 *   node tools/dev-token.mjs data/test-ui.db 1
 *
 * In ra mã đăng nhập của người dùng số 1 trên CSDL đó, kèm dòng lệnh dán vào
 * bảng điều khiển trình duyệt để đặt localStorage `thpos.user`. Ký bằng khoá
 * nằm cạnh file CSDL (server/auth-token.js), nên chỉ ai đã vào được ổ cứng
 * máy chủ mới làm được — đúng như người đó tự mở file dữ liệu ra.
 *
 * Không chạy cho data/pos.db: dữ liệu thật thì đăng nhập bằng mật khẩu.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { keyFileOf, loadKey, signToken } from '../server/auth-token.js';

const [dbArg, idArg] = process.argv.slice(2);
if (!dbArg || !idArg) {
  console.log('Cách dùng: node tools/dev-token.mjs <file-csdl> <id-người-dùng>');
  process.exit(2);
}
const dbFile = path.resolve(dbArg);
if (path.basename(dbFile) === 'pos.db') {
  console.log('Không ký mã cho dữ liệu thật (pos.db). Đăng nhập bằng mật khẩu.');
  process.exit(2);
}
if (!fs.existsSync(keyFileOf(dbFile))) {
  console.log(`Chưa có khoá ${keyFileOf(dbFile)} — bật máy chủ trên CSDL này một lần cho nó tự tạo.`);
  process.exit(2);
}
const db = new DatabaseSync(dbFile, { readOnly: true });
const u = db.prepare('SELECT id, username, full_name, role, token_ver FROM users WHERE id = ?').get(Number(idArg));
db.close();
if (!u) {
  console.log(`Không có người dùng số ${idArg}.`);
  process.exit(2);
}
const token = signToken(loadKey(keyFileOf(dbFile)), u);
const user = { id: u.id, username: u.username, full_name: u.full_name, role: u.role, token };
console.log(token);
console.log(`\nlocalStorage.setItem('thpos.user', ${JSON.stringify(JSON.stringify(user))}); location.reload();`);
