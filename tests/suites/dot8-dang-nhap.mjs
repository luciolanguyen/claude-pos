/**
 * ĐỢT 8 — mã đăng nhập có chữ ký thay cho số id tự khai (24/10/2026).
 *
 * Trước đây đặt header x-user-id: 1 là thành chủ tiệm. Bài này soát: không có
 * mã thì bị chặn, mã sửa tay bị chặn, đổi mật khẩu / vai trò / khoá tài khoản
 * là mã cũ hết dùng, gõ sai mật khẩu nhiều lần thì bị khoá tạm.
 */
import { section, ok, get, post, put, del, raw, authAs, BASE } from '../lib.mjs';

const KHONG_MA = { Authorization: '' };

export default async function run() {
  section('ĐỢT 8 — không có mã đăng nhập thì không vào được');
  {
    const r = await raw('GET', '/cash/transactions', null, KHONG_MA);
    ok('không có mã → 401', r.status === 401, String(r.status));
    const gia = await raw('GET', '/cash/transactions', null, { ...KHONG_MA, 'x-user-id': '1' });
    ok('tự khai x-user-id: 1 không còn thành chủ tiệm', gia.status === 401, String(gia.status));
    const me = await raw('GET', '/me', null, { ...KHONG_MA, 'x-user-id': '1' });
    ok('/me không nhận ra ai', me.body?.user === null && !me.body?.token);
  }

  section('ĐỢT 8 — đăng nhập cấp mã, mã mang đúng người');
  const stamp = Date.now().toString().slice(-6);
  const tn = await post('/users', {
    username: `tn${stamp}`, password: 'mk-cu', full_name: 'Thu ngân thử mã', role: 'cashier',
  });
  {
    const sai = await raw('POST', '/login', { username: tn.username, password: 'sai' }, KHONG_MA);
    ok('sai mật khẩu → 401, không có mã', sai.status === 401 && !sai.body?.token);
    const H = await authAs(tn.username, 'mk-cu');
    const me = await get('/me', H);
    ok('/me nhận đúng người theo mã', me.user?.id === tn.id && me.user?.role === 'cashier');
    ok('/me cấp mã mới để gia hạn', typeof me.token === 'string' && me.token.length > 20);
    const r = await raw('GET', '/cash/transactions', null, H);
    ok('thu ngân không vào sổ quỹ (403)', r.status === 403, String(r.status));
    const banHang = await raw('GET', '/sales?page_size=1', null, H);
    ok('thu ngân vẫn xem được hoá đơn', banHang.status === 200);

    /* Sửa phần thân mã cho thành id chủ tiệm, giữ nguyên chữ ký */
    const token = H.Authorization.slice(7);
    const [body, sig] = token.split('.');
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    const gia = Buffer.from(JSON.stringify({ ...p, u: 1 })).toString('base64url');
    const r2 = await raw('GET', '/cash/transactions', null, { Authorization: `Bearer ${gia}.${sig}` });
    ok('sửa id trong mã → chữ ký sai, 401', r2.status === 401, String(r2.status));
    /* Kéo dài hạn mã cũng vậy */
    const lau = Buffer.from(JSON.stringify({ ...p, exp: p.exp + 999999 })).toString('base64url');
    const r3 = await raw('GET', '/sales?page_size=1', null, { Authorization: `Bearer ${lau}.${sig}` });
    ok('sửa hạn trong mã → 401', r3.status === 401);
    ok('mã ký đúng hạn 30 ngày', Math.abs(p.exp - (Date.now() / 1000 + 30 * 86400)) < 120);
  }

  section('ĐỢT 8 — mã trên đường dẫn ?t= (ảnh, tải sao lưu)');
  {
    const H = await authAs('chu');
    const t = encodeURIComponent(H.Authorization.slice(7));
    const r = await fetch(`${BASE}/backup?t=${t}`);
    ok('tải sao lưu bằng ?t= được', r.status === 200, String(r.status));
    const r2 = await fetch(`${BASE}/backup?uid=1`);
    ok('?uid=1 kiểu cũ không còn tải được sao lưu', r2.status === 401, String(r2.status));
  }

  section('ĐỢT 8 — đổi mật khẩu, đổi vai trò, khoá tài khoản là mã cũ hết dùng');
  {
    const H1 = await authAs(tn.username, 'mk-cu');
    await put(`/users/${tn.id}`, { full_name: 'Thu ngân thử mã (đổi tên)', role: 'cashier', active: 1 });
    ok('chỉ đổi tên thì mã vẫn dùng được', (await raw('GET', '/sales?page_size=1', null, H1)).status === 200);

    await put(`/users/${tn.id}`, { full_name: tn.full_name, role: 'cashier', active: 1, password: 'mk-moi' });
    ok('đổi mật khẩu → mã cũ 401', (await raw('GET', '/sales?page_size=1', null, H1)).status === 401);
    ok('mật khẩu cũ không đăng nhập được',
      (await raw('POST', '/login', { username: tn.username, password: 'mk-cu' }, KHONG_MA)).status === 401);

    const H2 = await authAs(tn.username, 'mk-moi');
    await put(`/users/${tn.id}`, { full_name: tn.full_name, role: 'stock', active: 1 });
    ok('đổi vai trò → mã cũ 401', (await raw('GET', '/sales?page_size=1', null, H2)).status === 401);

    const H3 = await authAs(tn.username, 'mk-moi');
    await del(`/users/${tn.id}`);
    ok('khoá tài khoản → mã cũ 401', (await raw('GET', '/products?page_size=1', null, H3)).status === 401);
    ok('tài khoản đã khoá không đăng nhập được',
      (await raw('POST', '/login', { username: tn.username, password: 'mk-moi' }, KHONG_MA)).status === 401);
  }

  section('ĐỢT 8 — gõ sai mật khẩu nhiều lần thì bị khoá tạm');
  {
    const u = await post('/users', {
      username: `do${stamp}`, password: 'dung', full_name: 'Tài khoản thử dò', role: 'cashier',
    });
    let last = 0;
    for (let i = 0; i < 8; i += 1) {
      last = (await raw('POST', '/login', { username: u.username, password: `sai${i}` }, KHONG_MA)).status;
    }
    ok('lần sai thứ 8 vẫn báo sai mật khẩu', last === 401, String(last));
    const khoa = await raw('POST', '/login', { username: u.username, password: 'dung' }, KHONG_MA);
    ok('bị khoá thì gõ đúng cũng chưa vào được (429)', khoa.status === 429 && khoa.body?.code === 'LOGIN_LOCKED');
    ok('tài khoản khác trên cùng máy vẫn đăng nhập bình thường', !!(await authAs('chu')).Authorization);
    await del(`/users/${u.id}`);
  }
}
