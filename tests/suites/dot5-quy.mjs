/**
 * ĐỢT 5 — chấn chỉnh sổ quỹ (soát quỹ 30/09).
 *
 * Ba chỗ nặng nhất về sổ sách: chuyển quỹ phải là một cặp không tách rời, phiếu
 * huỷ phải biến mất khỏi MỌI phép cộng tiền (số dư, công nợ khách, công nợ NCC),
 * và tiền chuyển giữa hai quỹ của tiệm không được tính thành thu hay chi.
 */
import { section, ok, get, post, put, del, code, money } from '../lib.mjs';

const stamp = String(Date.now()).slice(-5);

export default async function run() {
  const accounts = await get('/cash/accounts');
  const cash = accounts.find((a) => a.type === 'cash') || accounts[0];
  const bank = accounts.find((a) => a.type === 'bank' && a.id !== cash.id)
    || accounts.find((a) => a.id !== cash.id);

  const bal = async (id) => (await get('/cash/accounts')).find((a) => a.id === id).balance;
  const tong = async () => (await get('/cash/accounts')).reduce((a, x) => a + x.balance, 0);
  const soquy = (params = '') => get(`/cash/transactions?page_size=100${params}`);

  section('ĐỢT 5 — chuyển quỹ là một cặp không tách rời');
  {
    const truoc = { cash: await bal(cash.id), bank: await bal(bank.id), tong: await tong() };
    const out = await post('/cash/transfer', {
      from_account_id: cash.id, to_account_id: bank.id, amount: 5000000,
      note: `Nộp tiền mặt vào ngân hàng ${stamp}`,
    });
    ok('chuyển quỹ sinh đúng hai phiếu', !!out.out?.code && !!out.in?.code,
      `${out.out?.code} / ${out.in?.code}`);
    ok('quỹ nguồn giảm, quỹ đích tăng đúng số',
      (await bal(cash.id)) === truoc.cash - 5000000 && (await bal(bank.id)) === truoc.bank + 5000000);
    ok('TỔNG tiền của tiệm không đổi một đồng', (await tong()) === truoc.tong, money(await tong()));

    const chi = await get(`/cash/transactions/${out.out.id}`);
    const thu = await get(`/cash/transactions/${out.in.id}`);
    ok('hai chân nối vào nhau',
      chi.ref_type === 'cash_transfer' && chi.ref_id === out.in.id
      && thu.ref_type === 'cash_transfer' && thu.ref_id === out.out.id);
    ok('mở phiếu nào cũng thấy phiếu đối ứng', chi.pair?.code === out.in.code);

    ok('chuyển sang chính quỹ đó thì chặn',
      (await code(() => post('/cash/transfer', {
        from_account_id: cash.id, to_account_id: cash.id, amount: 1000,
      }))) !== 'KHÔNG_BÁO_LỖI');
    ok('chuyển quá số dư thì chặn',
      (await code(() => post('/cash/transfer', {
        from_account_id: cash.id, to_account_id: bank.id, amount: 999999999999,
      }))) !== 'KHÔNG_BÁO_LỖI');

    /* Huỷ một chân thì chân kia phải huỷ theo, không thì hai quỹ lệch vĩnh viễn */
    const huy = await post(`/cash/transactions/${out.out.id}/cancel`, { reason: 'Nộp nhầm ngân hàng' });
    ok('huỷ một chân là huỷ cả cặp', huy.cancelled.length === 2, huy.cancelled.join(' + '));
    ok('số dư hai quỹ trở về y như trước khi chuyển',
      (await bal(cash.id)) === truoc.cash && (await bal(bank.id)) === truoc.bank);
    ok('tổng tiền vẫn không đổi', (await tong()) === truoc.tong);
  }

  section('ĐỢT 5 — chuyển quỹ không phải là thu, cũng không phải chi');
  {
    const from = new Date().toLocaleDateString('sv-SE');
    const tt = await get(`/cash/summary?from=${from}&to=${from}`);
    await post('/cash/transfer', {
      from_account_id: cash.id, to_account_id: bank.id, amount: 3000000, note: 'Nộp tiền cuối ngày',
    });
    const sau = await get(`/cash/summary?from=${from}&to=${from}`);
    ok('tổng thu trong ngày không nhúc nhích', sau.total_in === tt.total_in, money(sau.total_in));
    ok('tổng chi trong ngày không nhúc nhích', sau.total_out === tt.total_out, money(sau.total_out));
    ok('nhưng vẫn cho biết đã chuyển bao nhiêu',
      sau.total_transfer === tt.total_transfer + 3000000, money(sau.total_transfer));
  }

  section('ĐỢT 5 — huỷ phiếu: còn trong sổ, hết tính tiền');
  {
    const truoc = await bal(cash.id);
    const p = await post('/cash/transactions', {
      direction: 'out', amount: 250000, account_id: cash.id, category: 'transport',
      note: `Đổ xăng xe giao hàng ${stamp}`, user_id: 1,
    });
    ok('lập phiếu chi thì quỹ giảm', (await bal(cash.id)) === truoc - 250000);

    ok('huỷ mà không ghi lý do thì chặn',
      (await code(() => post(`/cash/transactions/${p.id}/cancel`, {}))) === 'NO_REASON');

    await post(`/cash/transactions/${p.id}/cancel`, { reason: 'Gõ nhầm số tiền' });
    ok('huỷ xong quỹ trở lại như cũ', (await bal(cash.id)) === truoc, money(await bal(cash.id)));

    const so = await soquy();
    const dong = so.rows.find((x) => x.id === p.id);
    ok('phiếu vẫn nằm trong sổ, có dấu đã huỷ và lý do',
      !!dong?.cancelled_at && dong.cancel_reason === 'Gõ nhầm số tiền');
    ok('huỷ lần nữa thì báo đã huỷ rồi',
      (await code(() => post(`/cash/transactions/${p.id}/cancel`, { reason: 'x' }))) !== 'KHÔNG_BÁO_LỖI');
    ok('phiếu đã huỷ thì không sửa được',
      (await code(() => put(`/cash/transactions/${p.id}`, { note: 'sửa thử' }))) !== 'KHÔNG_BÁO_LỖI');
  }

  section('ĐỢT 5 — phiếu huỷ phải biến khỏi công nợ khách và NCC');
  {
    const kh = await post('/customers', { name: `Khách sổ quỹ ${stamp}`, phone: `07${stamp}55`, opening_debt: 2000000 });
    const no0 = (await get(`/customers/${kh.id}`)).debt;
    const thu = await post('/cash/transactions', {
      direction: 'in', amount: 500000, account_id: cash.id, category: 'debt_in',
      partner_type: 'customer', partner_id: kh.id, user_id: 1,
    });
    ok('thu nợ thì nợ khách giảm', (await get(`/customers/${kh.id}`)).debt === no0 - 500000);
    await post(`/cash/transactions/${thu.id}/cancel`, { reason: 'Ghi nhầm sang khách khác' });
    ok('huỷ phiếu thu nợ thì nợ khách quay lại như cũ',
      (await get(`/customers/${kh.id}`)).debt === no0, money((await get(`/customers/${kh.id}`)).debt));

    const ncc = await post('/suppliers', { name: `NCC sổ quỹ ${stamp}`, opening_debt: 3000000 });
    const nno0 = (await get(`/suppliers/${ncc.id}`)).debt;
    const tra = await post('/cash/transactions', {
      direction: 'out', amount: 1000000, account_id: cash.id, category: 'debt_out',
      partner_type: 'supplier', partner_id: ncc.id, user_id: 1,
    });
    ok('trả nợ thì nợ NCC giảm', (await get(`/suppliers/${ncc.id}`)).debt === nno0 - 1000000);
    await post(`/cash/transactions/${tra.id}/cancel`, { reason: 'Chưa chuyển khoản thật' });
    ok('huỷ phiếu trả nợ thì nợ NCC quay lại như cũ',
      (await get(`/suppliers/${ncc.id}`)).debt === nno0, money((await get(`/suppliers/${ncc.id}`)).debt));
  }

  section('ĐỢT 5 — ghi phiếu cho ngày hôm trước');
  {
    const homqua = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE');
    const p = await post('/cash/transactions', {
      direction: 'out', amount: 120000, account_id: cash.id, category: 'utility',
      ts: homqua, note: 'Tiền nước tháng rồi', user_id: 1,
    });
    const d = await get(`/cash/transactions/${p.id}`);
    ok('phiếu nằm đúng ngày đã chọn', String(d.ts).slice(0, 10) === homqua, d.ts);
    ok('không cho ghi phiếu ngày mai',
      (await code(() => post('/cash/transactions', {
        direction: 'out', amount: 1000, account_id: cash.id, category: 'utility',
        ts: new Date(Date.now() + 86400000).toLocaleDateString('sv-SE'),
      }))) === 'FUTURE_DATE');

    /* Sửa phiếu: chỉ diễn giải, đối tượng, ngày */
    await put(`/cash/transactions/${p.id}`, { note: 'Tiền nước tháng 8' });
    ok('sửa được diễn giải', (await get(`/cash/transactions/${p.id}`)).note === 'Tiền nước tháng 8');
  }

  section('ĐỢT 5 — sổ quỹ: tồn đầu kỳ, số dư luỹ kế, tồn cuối kỳ');
  {
    const hom_nay = new Date().toLocaleDateString('sv-SE');
    const so = await get(`/cash/transactions?account_id=${cash.id}&from=${hom_nay}&to=${hom_nay}&page_size=100`);
    ok('sổ quỹ chạy ở chế độ sổ tay', so.ledger_mode === true);
    ok('tồn đầu kỳ + phát sinh = tồn cuối kỳ',
      so.closing === so.opening + so.rows.filter((x) => !x.cancelled_at)
        .reduce((a, x) => a + (x.direction === 'in' ? x.amount : -x.amount), 0),
      `${money(so.opening)} → ${money(so.closing)}`);
    ok('tồn cuối kỳ hôm nay đúng bằng số dư quỹ', so.closing === await bal(cash.id));
    const live = so.rows.filter((x) => !x.cancelled_at);
    ok('dòng mới nhất có số dư luỹ kế bằng tồn cuối kỳ',
      live.length === 0 || live[0].balance === so.closing, String(live[0]?.balance));
    ok('dòng đã huỷ không có số dư luỹ kế',
      so.rows.filter((x) => x.cancelled_at).every((x) => x.balance == null));

    const loc = await get(`/cash/transactions?account_id=${cash.id}&direction=out&page_size=20`);
    ok('lọc thêm thì tắt chế độ sổ tay cho khỏi hiểu lầm', loc.ledger_mode === false);
  }

  section('ĐỢT 5 — tự khai loại thu chi, và cờ tính vào chi phí');
  {
    const ds = await get('/cash/categories');
    ok('danh mục nạp sẵn đủ loại hệ thống',
      ds.out.some((c) => c.code === 'rent' && c.builtin === 1)
      && ds.in.some((c) => c.code === 'sale' && c.builtin === 1), `${ds.in.length} thu / ${ds.out.length} chi`);
    ok('mua hàng và chuyển quỹ KHÔNG tính là chi phí',
      ds.out.find((c) => c.code === 'purchase').is_expense === 0
      && ds.out.find((c) => c.code === 'transfer_out').is_expense === 0);

    const moi = await post('/cash/categories', { label: `Tiền chợ ${stamp}`, direction: 'out' });
    ok('khai thêm loại chi mới được', !!moi.code && moi.builtin === 0, moi.code);
    ok('loại tự khai mặc định tính vào chi phí', moi.is_expense === 1);

    const hom_nay = new Date().toLocaleDateString('sv-SE');
    const truoc = (await get(`/reports/pnl?from=${hom_nay}&to=${hom_nay}`)).expense_total;
    await post('/cash/transactions', {
      direction: 'out', amount: 400000, account_id: cash.id, category: moi.code,
      note: 'Mua nước ngọt đãi thợ', user_id: 1,
    });
    const sau = (await get(`/reports/pnl?from=${hom_nay}&to=${hom_nay}`)).expense_total;
    ok('báo cáo lãi lỗ tính luôn khoản mới khai', sau === truoc + 400000, money(sau));

    const rent = (await get('/cash/categories')).out.find((c) => c.code === 'rent');
    ok('loại hệ thống không xoá được',
      (await code(() => del(`/cash/categories/${rent.id}`))) !== 'KHÔNG_BÁO_LỖI');

    /* Loại đã có phiếu dùng tới thì chỉ ẩn đi, không xoá — phiếu cũ phải còn đọc được tên */
    const res = await del(`/cash/categories/${moi.id}`);
    ok('loại đã có phiếu dùng thì chỉ ẩn đi', res.deactivated === true, res.message);
    const an = (await get('/cash/categories?all=1')).out.find((c) => c.id === moi.id);
    ok('ẩn rồi vẫn tra ra được tên loại', an?.active === 0 && !!an.label);
  }
}
