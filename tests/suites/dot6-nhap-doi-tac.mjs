/**
 * ĐỢT 6 — nhập khách hàng và nhà cung cấp từ Excel (10/10/2026).
 *
 * Máy khách đã đọc file và ghép cột; ở đây soát phía máy chủ: có một lỗi là
 * không ghi dòng nào, cập nhật theo mã không xoá ô để trống, không nhận nợ
 * đầu kỳ, và số điện thoại rụng số 0 từ Excel được dọn lại cho đúng.
 */
import { section, ok, get, post, raw, code, authAs } from '../lib.mjs';

const stamp = String(Date.now()).slice(-5);
const ph = (n) => `09${stamp}${String(n).padStart(3, '0')}`;

export default async function run() {
  const rows = (list) => list.map((r, i) => ({ _line: i + 2, ...r }));

  section('ĐỢT 6 — nhập khách hàng: kiểm trước, có lỗi thì không ghi gì');
  {
    const truoc = (await get('/customers')).length;
    const file = rows([
      { code: `IMP${stamp}A`, name: 'Anh Ba thợ điện', phone: ph(1), address: 'Cái Bè', customer_type: 'Khách sỉ' },
      { code: `IMP${stamp}B`, name: 'Chị Tư', phone: ph(1) },           // trùng số với dòng trên
      { code: '', name: 'Khách không mã', phone: Number(ph(3)) },       // Excel làm rụng số 0
    ]);
    const kiem = await post('/customers/import', { rows: file, mode: 'create', dry_run: true });
    ok('kiểm thử bắt được số điện thoại trùng trong cùng file',
      kiem.ok === false && kiem.errors.some((e) => e.line === 3), JSON.stringify(kiem.errors[0]));
    ok('nhập thật khi còn lỗi thì bị chặn',
      (await code(() => post('/customers/import', { rows: file, mode: 'create' }))) === 'IMPORT_INVALID');
    ok('không dòng nào được ghi', (await get('/customers')).length === truoc);

    file[1].phone = ph(2);
    const xong = await post('/customers/import', { rows: file, mode: 'create' });
    ok('sửa lỗi rồi thì nhập được cả ba', xong.created === 3, `thêm ${xong.created}`);
    const ds = await get(`/customers?q=${ph(3)}`);
    ok('số rụng mất số 0 đầu được thêm lại', ds.length === 1 && ds[0].phone === ph(3), ds[0]?.phone);
    ok('dòng không có mã thì máy tự sinh mã', /^KH\d+/.test(ds[0]?.code || ''), ds[0]?.code);
    const ba = (await get(`/customers?q=IMP${stamp}A`))[0];
    ok('"Khách sỉ" hiểu thành loại khách sỉ', ba?.customer_type === 'wholesale');
  }

  section('ĐỢT 6 — cập nhật theo mã: ô trống giữ nguyên');
  {
    const file = rows([
      { code: `IMP${stamp}A`, name: 'Anh Ba thợ điện (Hoà Khánh)', phone: '', address: '' },
      { code: `IMP${stamp}C`, name: 'Khách mới trong lúc cập nhật' },
    ]);
    ok('chế độ thêm mới gặp mã đã có thì báo lỗi',
      (await post('/customers/import', { rows: file, mode: 'create', dry_run: true })).errors
        .some((e) => /đã có trong máy/.test(e.msg)));
    const kiem = await post('/customers/import', { rows: file, mode: 'update', dry_run: true });
    const doi = kiem.preview.find((p) => p.code === `IMP${stamp}A`);
    ok('bản xem trước cho thấy hồ sơ cũ đổi gì',
      doi?.action === 'update' && doi.changes.length === 1 && doi.changes[0].field === 'name',
      JSON.stringify(doi?.changes));
    const xong = await post('/customers/import', { rows: file, mode: 'update' });
    ok('cập nhật 1, thêm 1', xong.updated === 1 && xong.created === 1);
    const ba = (await get(`/customers?q=IMP${stamp}A`))[0];
    ok('tên đổi theo file', ba.name === 'Anh Ba thợ điện (Hoà Khánh)');
    ok('số điện thoại và địa chỉ để trống thì giữ nguyên', ba.phone === ph(1) && ba.address === 'Cái Bè');
  }

  section('ĐỢT 6 — không nhận nợ đầu kỳ qua file');
  {
    const kiem = await post('/customers/import', {
      rows: rows([{ code: `IMP${stamp}D`, name: 'Khách có nợ cũ', opening_debt: 5000000 }]),
      mode: 'create',
    });
    ok('có cảnh báo cột nợ bị bỏ qua', kiem.warnings.some((w) => /nợ đầu kỳ/i.test(w.msg)));
    const kh = (await get(`/customers?q=IMP${stamp}D`))[0];
    ok('hồ sơ tạo ra không có đồng nợ nào', kh && kh.debt === 0, String(kh?.debt));
  }

  section('ĐỢT 6 — quyền: thu ngân không nhập file được');
  {
    const users = await get('/users');
    const thuNgan = users.find((u) => u.role === 'cashier');
    if (thuNgan) {
      const r = await raw('POST', '/customers/import',
        { rows: rows([{ name: 'thử' }]), dry_run: true }, await authAs(thuNgan.username));
      ok('thu ngân bị chặn 403', r.status === 403, String(r.status));
    } else {
      ok('(không có tài khoản thu ngân mẫu — bỏ qua)', true);
    }
  }

  section('ĐỢT 6 — nhập nhà cung cấp');
  {
    const file = rows([
      { code: `NIMP${stamp}`, name: 'Công ty Điện Quang chi nhánh Tiền Giang', phone: ph(10),
        bank_name: 'Vietcombank', account_no: '0123 456 789', term_days: '30' },
      { code: `NIMP${stamp}X`, name: 'Mối thiếu số tài khoản', bank_name: 'ACB' },
    ]);
    const kiem = await post('/suppliers/import', { rows: file, mode: 'create', dry_run: true });
    ok('tài khoản thiếu số thì báo lỗi', kiem.errors.some((e) => e.line === 3));
    file.pop();
    const xong = await post('/suppliers/import', { rows: file, mode: 'create' });
    ok('nhập được nhà cung cấp', xong.created === 1);
    const ncc = (await get('/suppliers')).find((s) => s.code === `NIMP${stamp}`);
    const ct = await get(`/suppliers/${ncc.id}`);
    ok('số điện thoại và tài khoản vào đúng danh sách',
      ct.phones.some((p) => p.phone === ph(10)) && ct.bank_accounts.some((b) => b.account_no === '0123456789'),
      `${ct.phones.length} số, ${ct.bank_accounts.length} TK`);
    ok('số ngày được nợ ghi đúng', ct.term_days === 30);

    /* Cập nhật thêm số mới: số cũ phải còn */
    await post('/suppliers/import', {
      rows: rows([{ code: `NIMP${stamp}`, phone: ph(11) }]), mode: 'update',
    });
    const sau = await get(`/suppliers/${ncc.id}`);
    ok('cập nhật thêm số mới mà không xoá số cũ',
      sau.phones.some((p) => p.phone === ph(10)) && sau.phones.some((p) => p.phone === ph(11)),
      sau.phones.map((p) => p.phone).join(', '));
  }
}
