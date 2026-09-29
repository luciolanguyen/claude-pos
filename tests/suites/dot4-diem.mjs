/**
 * ĐỢT 4 — điểm tích luỹ / ví thành viên (yêu cầu 28/09, mục IV.1).
 *
 * Điểm là tiền, nên bài này soát kỹ ba chỗ dễ sai: tích đúng phần nào của hoá
 * đơn, dùng điểm KHÔNG được đụng tới quỹ, và trả hàng / huỷ đơn phải thu hồi
 * lại đúng số điểm đã cho.
 */
import { section, ok, get, post, put, code, money } from '../lib.mjs';

const stamp = String(Date.now()).slice(-5);

export default async function run() {
  const whs = await get('/warehouses');
  const wh = (whs.find((w) => w.is_default) || whs[0]).id;
  const prods = await get('/products?page_size=5');
  const p = prods.rows.find((x) => x.track_stock) || prods.rows[0];
  const unit = (await get(`/products/${p.id}`)).units.find((u) => u.factor === 1);
  const accounts = await get('/cash/accounts');
  const cash = accounts.find((a) => a.type === 'cash') || accounts[0];

  const bal = async () => (await get('/cash/accounts')).find((a) => a.id === cash.id).balance;
  const balance = async (id) => (await get(`/customers/${id}/points`)).balance;

  const kh = await post('/customers', { name: `Khách điểm ${stamp}`, phone: `09${stamp}77` });
  const le = null;   // khách lẻ: không chọn hồ sơ nào

  /* 10.000 đ hàng = 1 điểm; 1 điểm = 1.000 đ; tối thiểu 10 điểm; trần 50% */
  const setCfg = (extra = {}) => put('/settings', {
    pos: {
      points_enabled: true, points_earn_per: 10000, points_value: 1000,
      points_min_redeem: 10, points_max_percent: 50, ...extra,
    },
  });

  const sell = (extra = {}) => post('/sales', {
    warehouse_id: wh, user_id: 1, payment_method: 'cash',
    items: [{ product_id: p.id, unit_id: unit.id, unit_name: unit.unit_name, factor: 1, qty: 1, price: 500000 }],
    ...extra,
  });

  section('ĐỢT 4 — tích điểm khi bán (mục IV.1)');
  {
    await setCfg();
    const s = await sell({ customer_id: kh.id, paid: 500000, received: 500000 });
    ok('hoá đơn 500.000 đ được 50 điểm', s.points_earned === 50, `${s.points_earned} điểm`);
    ok('số dư sổ điểm bằng đúng số vừa tích', (await balance(kh.id)) === 50);

    const d = await get(`/sales/${s.id}`);
    ok('hoá đơn chụp lại số điểm đã cộng', d.points_earned === 50 && d.points_used === 0 && d.points_amount === 0);

    const sLe = await sell({ paid: 500000, received: 500000 });
    ok('khách lẻ không có hồ sơ thì không tích', sLe.points_earned === 0, `khách lẻ ${le === null ? '' : ''}`);
  }

  section('ĐỢT 4 — phí giao, thuế và hàng mua hộ KHÔNG được tích');
  {
    const before = await balance(kh.id);
    const s = await sell({
      customer_id: kh.id, paid: 0,
      delivery_address: 'Ấp 1, Cái Bè', cod_mode: false,
      ship_fee: 100000, ship_payer: 'customer',
    });
    ok('phí giao khách trả không sinh thêm điểm',
      (await balance(kh.id)) - before === 50, `thêm ${(await balance(kh.id)) - before} điểm`);
    ok('hoá đơn có phí giao vẫn chỉ tích trên tiền hàng', s.points_earned === 50);
  }

  section('ĐỢT 4 — dùng điểm trừ vào hoá đơn, quỹ không nhúc nhích');
  {
    const diem = await balance(kh.id);
    const quy = await bal();
    const s = await sell({ customer_id: kh.id, paid: 450000, received: 450000, points_used: 50 });
    ok('50 điểm trừ được 50.000 đ', s.points_amount === 50000 && s.points_used === 50, money(s.points_amount));
    ok('hoá đơn coi như đã trả đủ', s.paid === s.total, `trả ${money(s.paid)} / ${money(s.total)}`);
    ok('quỹ chỉ tăng đúng phần tiền mặt khách đưa', (await bal()) === quy + 450000, money(await bal()));

    const con = await balance(kh.id);
    ok('sổ điểm trừ 50, cộng lại 50 điểm của chính đơn này',
      con === diem - 50 + 50, `còn ${con} điểm`);

    const so = await get(`/customers/${kh.id}/points`);
    ok('sổ điểm ghi rõ dòng trừ và dòng cộng',
      so.rows.some((x) => x.kind === 'redeem' && x.points === -50 && x.money === 50000)
      && so.rows.some((x) => x.kind === 'earn' && x.points === 50));
  }

  section('ĐỢT 4 — các chốt chặn khi dùng điểm');
  {
    const diem = await balance(kh.id);
    ok('không đủ điểm thì chặn',
      (await code(() => sell({ customer_id: kh.id, paid: 0, points_used: diem + 1000 }))) === 'POINTS_NOT_ENOUGH');
    ok('dưới mức tối thiểu thì chặn',
      (await code(() => sell({ customer_id: kh.id, paid: 0, points_used: 5 }))) === 'POINTS_MIN');
    ok('khách lẻ không dùng được điểm',
      (await code(() => sell({ paid: 0, points_used: 10 }))) === 'POINTS_NO_CUSTOMER');

    /* Hoá đơn 500.000 đ, trần 50% là 250.000 đ = 250 điểm */
    await post('/loyalty/adjust', { customer_id: kh.id, points: 400, note: 'Nạp điểm để thử trần' });
    ok('vượt trần phần trăm hoá đơn thì chặn',
      (await code(() => sell({ customer_id: kh.id, paid: 0, points_used: 300 }))) === 'POINTS_CAP');
    ok('trừ nhiều hơn phần còn thiếu thì chặn',
      (await code(() => sell({ customer_id: kh.id, paid: 480000, received: 480000, points_used: 100 })))
        === 'POINTS_OVER_DUE');

    ok('cộng trừ tay mà không ghi lý do thì chặn',
      (await code(() => post('/loyalty/adjust', { customer_id: kh.id, points: 10 }))) === 'POINTS_NO_REASON');
    ok('trừ tay quá số điểm đang có thì chặn',
      (await code(() => post('/loyalty/adjust', { customer_id: kh.id, points: -999999, note: 'thử' })))
        === 'POINTS_NOT_ENOUGH');
  }

  section('ĐỢT 4 — trả hàng thì thu hồi điểm (tài liệu 02)');
  {
    const s = await sell({ customer_id: kh.id, paid: 500000, received: 500000 });
    const diem = await balance(kh.id);
    const line = (await get(`/sales/${s.id}`)).items[0];

    /* Trả nửa số tiền hàng: thu hồi một nửa số điểm đã tích */
    await post('/sale-returns', {
      sale_id: s.id, warehouse_id: wh, user_id: 1, refund_method: 'cash', refunded: 250000,
      items: [{ sale_item_id: line.id, product_id: p.id, unit_name: unit.unit_name, qty: 0.5, condition: 'good' }],
    });
    ok('trả nửa đơn thì thu hồi nửa số điểm',
      (await balance(kh.id)) === diem - 25, `còn ${await balance(kh.id)} điểm (trước ${diem})`);

    await post('/sale-returns', {
      sale_id: s.id, warehouse_id: wh, user_id: 1, refund_method: 'cash', refunded: 250000,
      items: [{ sale_item_id: line.id, product_id: p.id, unit_name: unit.unit_name, qty: 0.5, condition: 'good' }],
    });
    ok('trả nốt phần còn lại thì thu hồi hết 50 điểm của đơn',
      (await balance(kh.id)) === diem - 50, `còn ${await balance(kh.id)} điểm`);
  }

  section('ĐỢT 4 — hoàn lại điểm đã dùng khi trả hàng');
  {
    const s = await sell({ customer_id: kh.id, paid: 450000, received: 450000, points_used: 50 });
    const diem = await balance(kh.id);
    const line = (await get(`/sales/${s.id}`)).items[0];
    const quy = await bal();

    ok('hoá đơn không trừ điểm thì không hoàn vào điểm được',
      (await code(() => post('/sale-returns', {
        warehouse_id: wh, user_id: 1, refund_method: 'points',
        items: [{ product_id: p.id, unit_name: unit.unit_name, qty: 1, price: 10000, condition: 'good' }],
      }))) === 'POINTS_REFUND_NOT_ALLOWED');

    ok('đòi hoàn vào điểm nhiều hơn phần khách đã gán bằng điểm thì chặn',
      (await code(() => post('/sale-returns', {
        sale_id: s.id, warehouse_id: wh, user_id: 1, refund_method: 'points',
        items: [{ sale_item_id: line.id, product_id: p.id, unit_name: unit.unit_name, qty: 1, condition: 'good' }],
      }))) === 'POINTS_REFUND_EXCEEDED');

    /* Trả đúng phần khách đã gán bằng điểm: 0,1 đơn vị = 50.000 đ = 50 điểm */
    const th = await post('/sale-returns', {
      sale_id: s.id, warehouse_id: wh, user_id: 1, refund_method: 'points',
      items: [{ sale_item_id: line.id, product_id: p.id, unit_name: unit.unit_name, qty: 0.1, condition: 'good' }],
    });
    ok('hoàn vào điểm thì không chi tiền mặt', (await bal()) === quy, money(await bal()));
    ok('hoàn lại 50 điểm đã dùng, thu hồi 5 điểm đã tích cho phần hàng trả',
      (await balance(kh.id)) === diem + 50 - 5, `còn ${await balance(kh.id)} điểm, phiếu ${th.code}`);
  }

  section('ĐỢT 4 — huỷ hoá đơn');
  {
    const s = await sell({ customer_id: kh.id, paid: 450000, received: 450000, points_used: 50 });
    const diem = await balance(kh.id);
    const quy = await bal();
    await post(`/sales/${s.id}/cancel`, {});
    ok('huỷ đơn: thu hồi điểm đã tích, trả lại điểm đã dùng',
      (await balance(kh.id)) === diem - 50 + 50, `còn ${await balance(kh.id)} điểm (trước ${diem})`);
    ok('huỷ đơn chỉ hoàn phần tiền mặt, không hoàn phần gán bằng điểm',
      (await bal()) === quy - 450000, money(await bal()));
  }

  section('ĐỢT 4 — tắt phân hệ thì không tích, không dùng');
  {
    await setCfg({ points_enabled: false });
    const diem = await balance(kh.id);
    const s = await sell({ customer_id: kh.id, paid: 500000, received: 500000 });
    ok('tắt rồi thì bán không tích điểm', s.points_earned === 0 && (await balance(kh.id)) === diem);
    ok('tắt rồi thì không dùng điểm được',
      (await code(() => sell({ customer_id: kh.id, paid: 0, points_used: 10 }))) === 'POINTS_OFF');
    ok('điểm cũ vẫn còn nguyên trong sổ', (await balance(kh.id)) === diem, `${diem} điểm`);
    await setCfg();
  }

  section('ĐỢT 4 — sổ điểm và số dư luôn khớp nhau');
  {
    const so = await get(`/customers/${kh.id}/points?page_size=200`);
    const tong = so.rows.reduce((a, x) => a + x.points, 0);
    ok('cộng cả sổ đúng bằng số dư', tong === so.balance, `${tong} = ${so.balance}`);
    ok('mỗi dòng sổ đều có loại rõ ràng',
      so.rows.every((x) => ['earn', 'redeem', 'revoke', 'refund', 'adjust'].includes(x.kind)));

    const quick = await get(`/customers/${kh.id}/quick`);
    ok('màn hình bán hàng đọc được số dư điểm của khách', quick.points === so.balance);
  }
}
