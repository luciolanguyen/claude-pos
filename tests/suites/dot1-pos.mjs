/**
 * ĐỢT 1 — màn hình bán hàng (tài liệu "Yêu cầu Cập nhật Phần mềm 2", phần I).
 * Kiểm phía máy chủ: tiền xe tài xế, dấu nhận biết đơn giao hàng / đơn đặt,
 * nợ cũ – nợ mới trên hoá đơn.
 */
import { section, ok, get, post, put, code, money } from '../lib.mjs';

const stamp = String(Date.now()).slice(-5);

export default async function run() {
  const whs = await get('/warehouses');
  const wh = (whs.find((w) => w.is_default) || whs[0]).id;
  const prods = await get('/products?page_size=5');
  const p = prods.rows.find((x) => x.track_stock) || prods.rows[0];
  const accounts = await get('/cash/accounts');
  const cash = accounts.find((a) => a.type === 'cash') || accounts[0];
  const unit = (await get(`/products/${p.id}`)).units.find((u) => u.factor === 1);

  const bal = async () => (await get('/cash/accounts')).find((a) => a.id === cash.id).balance;
  const sell = (extra = {}) => post('/sales', {
    warehouse_id: wh, user_id: 1, payment_method: 'cash', paid: 100000, received: 100000,
    items: [{ product_id: p.id, unit_id: unit.id, unit_name: unit.unit_name, factor: 1, qty: 1, price: 100000 }],
    ...extra,
  });

  section('ĐỢT 1 — tiền xe trả tài xế (mục I.2)');
  {
    const before = await bal();
    const s = await sell({
      delivery_name: `Khách giao ${stamp}`, delivery_phone: '0909000111',
      delivery_address: 'Ấp 1, Cái Bè', ship_fee: 0, shipper_name: 'Anh Tư xe ôm',
      shipper_fee: 30000, delivery_status: 'pending',
    });
    const after1 = await bal();
    ok('chưa giao thì chưa chi tiền xe', after1 === before + 100000, `quỹ ${money(after1)}`);

    await put(`/sales/${s.id}/delivery`, { delivery_status: 'shipping' });
    ok('đang giao cũng chưa chi', (await bal()) === after1);

    await put(`/sales/${s.id}/delivery`, { delivery_status: 'delivered' });
    const afterPaid = await bal();
    ok('giao xong là chi tiền xe ngay', afterPaid === after1 - 30000, `quỹ ${money(afterPaid)}`);

    const txs = await get('/cash/transactions?page_size=50');
    const voucher = txs.rows.find((t) => t.ref_type === 'sale_delivery' && t.ref_id === s.id && t.direction === 'out');
    ok('phiếu chi ghi đúng loại và người nhận',
      !!voucher && voucher.category === 'shipper_out' && /Anh Tư xe ôm/.test(voucher.partner_name || voucher.note),
      voucher?.code);

    await put(`/sales/${s.id}/delivery`, { delivery_status: 'delivered' });
    ok('bấm giao xong lần nữa không chi trùng', (await bal()) === afterPaid);

    await put(`/sales/${s.id}/delivery`, { delivery_status: 'shipping' });
    ok('bỏ đánh dấu đã giao thì hoàn lại tiền xe', (await bal()) === after1);

    await put(`/sales/${s.id}/delivery`, { delivery_status: 'delivered' });
    ok('đánh dấu giao lại thì chi lại đúng một lần', (await bal()) === afterPaid);

    const d = await get(`/sales/${s.id}`);
    ok('hoá đơn lưu đủ địa chỉ, phí giao, tiền xe',
      d.delivery_address === 'Ấp 1, Cái Bè' && d.shipper_fee === 30000 && d.ship_fee === 0);
  }

  section('ĐỢT 1 — không có tiền xe thì không sinh phiếu chi');
  {
    const before = await bal();
    const s = await sell({ delivery_address: 'Ấp 2', shipper_fee: 0, delivery_status: 'pending' });
    await put(`/sales/${s.id}/delivery`, { delivery_status: 'delivered' });
    ok('tiền xe bằng 0 thì quỹ chỉ tăng tiền bán', (await bal()) === before + 100000);
  }

  section('ĐỢT 1 — dấu nhận biết đơn giao hàng và đơn đặt (mục I.1)');
  {
    const list = await get('/sales?page_size=20');
    const shipped = list.rows.find((r) => r.delivery_status);
    ok('danh sách hoá đơn trả về chặng giao hàng', !!shipped, shipped?.delivery_status);
    ok('danh sách trả về tên người giao / nhà xe',
      shipped && ('carrier_name' in shipped) && ('shipper_name' in shipped));

    const order = await post('/orders', {
      user_id: 1, warehouse_id: wh,
      items: [{ product_id: p.id, name_snapshot: p.name, unit_name: unit.unit_name, factor: 1, qty: 1, price: 100000 }],
    });
    const od = await get(`/orders/${order.id}`);
    const res = await post(`/orders/${order.id}/deliver`, {
      user_id: 1, warehouse_id: wh, payment_method: 'cash', paid: 100000,
      items: [{ item_id: od.items[0].id, qty: 1 }],
    });
    const saleId = res.sale?.id || res.sale_id;
    const d = await get(`/sales/${saleId}`);
    ok('hoá đơn xuất từ đơn đặt có mã đơn đặt', d.order_code === order.code, d.order_code);
    const l2 = await get('/sales?page_size=20');
    ok('danh sách hoá đơn cũng có mã đơn đặt',
      (l2.rows.find((r) => r.id === saleId) || {}).order_code === order.code);
  }

  section('ĐỢT 1 — nợ cũ / nợ mới để in lên hoá đơn (mục I.4)');
  {
    const cus = await post('/customers', { name: `ZZĐ1 Khách nợ ${stamp}`, phone: `09990${stamp}` });
    const s1 = await post('/sales', {
      warehouse_id: wh, user_id: 1, customer_id: cus.id, payment_method: 'debt', paid: 0,
      items: [{ product_id: p.id, unit_id: unit.id, unit_name: unit.unit_name, factor: 1, qty: 1, price: 100000 }],
    });
    const d1 = await get(`/sales/${s1.id}`);
    ok('hoá đơn nợ đầu tiên: nợ cũ 0, nợ mới 100.000',
      d1.customer_debt_before === 0 && d1.customer_debt_after === 100000,
      `${money(d1.customer_debt_before)} → ${money(d1.customer_debt_after)}`);

    const s2 = await post('/sales', {
      warehouse_id: wh, user_id: 1, customer_id: cus.id, payment_method: 'debt', paid: 0,
      items: [{ product_id: p.id, unit_id: unit.id, unit_name: unit.unit_name, factor: 1, qty: 2, price: 100000 }],
    });
    const d2 = await get(`/sales/${s2.id}`);
    ok('hoá đơn nợ thứ hai: nợ cũ 100.000, nợ mới 300.000',
      d2.customer_debt_before === 100000 && d2.customer_debt_after === 300000,
      `${money(d2.customer_debt_before)} → ${money(d2.customer_debt_after)}`);

    const d0 = await get(`/sales/${s1.id}`);
    ok('in lại hoá đơn cũ thì số nợ vẫn của chính hoá đơn đó',
      d0.customer_debt_after === 100000, money(d0.customer_debt_after));

    const khachLe = await get(`/sales/${(await sell()).id}`);
    ok('khách lẻ thì không có dòng nợ',
      khachLe.customer_debt_before === null && khachLe.customer_debt_after === null);

    /* Đơn thu hộ COD: tiền nằm chỗ người giao, sổ nợ chưa tính khách nợ — hoá đơn
       phải in đúng con số của sổ nợ, không phải tự cộng total − paid. */
    const debtNow = (await get(`/customers/${cus.id}/ledger`)).debt;
    const s3 = await post('/sales', {
      warehouse_id: wh, user_id: 1, customer_id: cus.id, payment_method: 'debt', paid: 0,
      items: [{ product_id: p.id, unit_id: unit.id, unit_name: unit.unit_name, factor: 1, qty: 1, price: 100000 }],
      delivery_address: 'Ấp 4', delivery_status: 'pending', cod_amount: 100000,
    });
    const d3 = await get(`/sales/${s3.id}`);
    ok('đơn đang thu hộ COD: tổng nợ in ra khớp sổ nợ, không cộng thêm tiền COD',
      d3.customer_debt_after === debtNow,
      `hoá đơn ${money(d3.customer_debt_after)} · sổ nợ ${money(debtNow)}`
      + ` · COD ${money(d3.cod_amount)} (${d3.cod_status})`);
  }

  section('ĐỢT 1 — chặn hỏng');
  {
    const s = await sell({ delivery_address: 'Ấp 3', shipper_fee: 20000, delivery_status: 'pending' });
    ok('chặng giao bậy bị chặn',
      (await code(() => put(`/sales/${s.id}/delivery`, { delivery_status: 'xyz' }))) !== 'KHÔNG_BÁO_LỖI');
  }
}
