/**
 * ĐỢT 7 — số liệu Tổng quan đúng và khớp Báo cáo Lãi lỗ (11/10/2026).
 *
 * Dựng hoá đơn ở THÁNG 3/2020 — tháng không có dữ liệu nào khác — để soát được
 * từng đồng: giảm giá cả đơn, hoá đơn GTGT, phí giao khách trả, tiền xe tài xế,
 * hoá đơn huỷ, và hàng trả sang THÁNG SAU (trả tính vào ngày trả).
 */
import { section, ok, get, post, put, money } from '../lib.mjs';

export default async function run() {
  const whs = await get('/warehouses');
  const wh = (whs.find((w) => w.is_default) || whs[0]).id;
  const prods = await get('/products?page_size=20');
  const p = prods.rows.find((x) => x.track_stock) || prods.rows[0];
  const unit = (await get(`/products/${p.id}`)).units.find((u) => u.factor === 1);
  const line = (extra = {}) => ({
    product_id: p.id, unit_id: unit.id, unit_name: unit.unit_name, factor: 1, qty: 1, price: 100000, ...extra,
  });

  /* Hạn đổi trả mặc định 7 ngày sẽ chặn trả hàng của năm 2020 — tắt tạm */
  const st = await get('/settings');
  await put('/settings', { pos: { ...st.pos, return_days: 0 } });

  section('ĐỢT 7 — dựng số liệu tháng 3/2020');
  /* Hoá đơn A: 2 × 100.000, giảm 20.000 cả đơn, GTGT 10%, phí giao 30.000 khách trả,
     tiền xe tài xế 25.000. Tổng khách trả = 200.000 − 20.000 + 20.000 + 30.000 = 230.000 */
  const A = await post('/sales', {
    warehouse_id: wh, user_id: 1, ts: '2020-03-05 10:00:00',
    items: [line({ qty: 2, vat_rate: 10 })],
    discount: 20000, is_vat_invoice: true,
    delivery_address: 'Ấp 1, Cái Bè', cod_mode: false, ship_fee: 30000, ship_payer: 'customer',
    shipper_fee: 25000, payment_method: 'cash', paid: 230000, received: 230000,
  });
  ok('hoá đơn A tổng đúng 230.000', A.total === 230000, money(A.total));
  /* Hoá đơn B: bị huỷ — không được tính */
  const B = await post('/sales', {
    warehouse_id: wh, user_id: 1, ts: '2020-03-06 09:00:00', items: [line()],
    payment_method: 'cash', paid: 100000, received: 100000,
  });
  await post(`/sales/${B.id}/cancel`, {});
  /* Hoá đơn C: 1 × 100.000 không thuế */
  const C = await post('/sales', {
    warehouse_id: wh, user_id: 1, ts: '2020-03-07 15:30:00', items: [line()],
    payment_method: 'cash', paid: 100000, received: 100000,
  });
  const dA = await get(`/sales/${A.id}`);
  const dC = await get(`/sales/${C.id}`);
  const cost1 = dA.items[0].unit_cost;
  /* Khách trả 1 cái của hoá đơn A vào ngày 02/04/2020: hoàn 100.000 (đã gồm thuế
     9.091) → doanh thu tháng 4 giảm 90.909, giá vốn tháng 4 hoàn 1 cái */
  const R = await post('/sale-returns', {
    sale_id: A.id, warehouse_id: wh, user_id: 1, ts: '2020-04-02 08:00:00', refund_method: 'cash',
    refunded: 100000, items: [{ sale_item_id: dA.items[0].id, product_id: p.id, unit_name: unit.unit_name, qty: 1, condition: 'good' }],
  });
  ok('phiếu trả hoàn đúng 100.000', R.total === 100000, money(R.total));

  section('ĐỢT 7 — doanh thu thuần, lãi gộp tháng 3');
  const T3 = await get('/dashboard?from=2020-03-01&to=2020-03-31');
  const s3 = T3.summary;
  ok('hoá đơn huỷ không tính, đếm đúng 2 hoá đơn', s3.orders === 2, String(s3.orders));
  ok('doanh thu thuần không gồm thuế GTGT, gồm phí giao: 210.000 + 100.000',
    s3.revenue === 310000, money(s3.revenue));
  ok('thuế GTGT tách riêng 20.000', s3.vat === 20000);
  const cogs3 = dA.cogs + dC.cogs;
  ok('giá vốn đúng bằng giá vốn hai hoá đơn', s3.cogs === cogs3, money(s3.cogs));
  ok('lãi gộp = doanh thu − giá vốn − tiền xe 25.000',
    s3.profit === 310000 - cogs3 - 25000, money(s3.profit));
  ok('giá trị trung bình mỗi hoá đơn = 155.000', s3.avg_order === 155000, money(s3.avg_order));
  ok('hàng trả tháng sau KHÔNG làm đổi tháng 3', s3.returns === 0 && s3.returns_count === 0);

  section('ĐỢT 7 — hàng trả tính vào ngày trả (tháng 4)');
  const s4 = (await get('/dashboard?from=2020-04-01&to=2020-04-30')).summary;
  ok('doanh thu tháng 4 âm đúng phần hàng trả không thuế (−90.909)', s4.revenue === -90909, money(s4.revenue));
  ok('giá vốn hàng trả về kho được hoàn', s4.cogs === -cost1, money(s4.cogs));
  ok('lãi gộp tháng 4 = −90.909 + giá vốn hoàn', s4.profit === -90909 + cost1, money(s4.profit));
  ok('đếm 1 phiếu trả', s4.returns_count === 1);

  section('ĐỢT 7 — Tổng quan và Lãi lỗ khớp từng đồng');
  for (const [from, to] of [['2020-03-01', '2020-03-31'], ['2020-04-01', '2020-04-30'], ['2020-03-01', '2020-04-30']]) {
    const d = (await get(`/dashboard?from=${from}&to=${to}`)).summary;
    const l = await get(`/reports/pnl?from=${from}&to=${to}`);
    ok(`${from} → ${to}: doanh thu và lãi gộp hai trang như nhau`,
      d.revenue === l.net_revenue && d.profit === l.gross_profit,
      `${money(d.revenue)} / ${money(d.profit)}`);
  }
  const l3 = await get('/reports/pnl?from=2020-03-01&to=2020-03-31');
  ok('các dòng Lãi lỗ cộng lại ra doanh thu thuần',
    l3.gross_sales - l3.discount + l3.ship_charged - l3.returns === l3.net_revenue,
    `${money(l3.gross_sales)} − ${money(l3.discount)} + ${money(l3.ship_charged)} − ${money(l3.returns)}`);

  section('ĐỢT 7 — biểu đồ và kỳ so sánh theo đúng kỳ đang chọn');
  ok('cả tháng thì so với cả tháng trước',
    T3.compare_period.from === '2020-02-01' && T3.compare_period.to === '2020-02-29',
    `${T3.compare_period.from} → ${T3.compare_period.to}`);
  const k3 = await get('/dashboard?from=2020-03-05&to=2020-03-07');
  ok('3 ngày thì so với 3 ngày liền trước',
    k3.compare_period.from === '2020-03-02' && k3.compare_period.to === '2020-03-04');
  ok('kỳ ≤ 31 ngày vẽ theo ngày, đủ 31 mốc', T3.series.bucket === 'day' && T3.series.rows.length === 31);
  const n5 = T3.series.rows.find((x) => x.key === '2020-03-05');
  ok('mốc 05/03 đúng doanh thu hoá đơn A', n5.revenue === 210000, money(n5.revenue));
  ok('cộng các mốc ra đúng doanh thu cả kỳ',
    T3.series.rows.reduce((a, x) => a + (x.revenue || 0), 0) === s3.revenue);
  const d1 = await get('/dashboard?from=2020-03-05&to=2020-03-05');
  ok('một ngày thì vẽ theo giờ, đủ 24 giờ', d1.series.bucket === 'hour' && d1.series.rows.length === 24);
  ok('giờ bán chạy có đủ 24 giờ', T3.hours.length === 24 && T3.hours[15].orders === 1);
  /* Hôm nay so với hôm qua TỚI CÙNG GIỜ, không so với cả ngày hôm qua */
  const homNay = new Date().toLocaleDateString('sv-SE');
  const homQua = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE');
  const hn = await get(`/dashboard?from=${homNay}&to=${homNay}`);
  ok('hôm nay so với hôm qua', hn.compare_period.from === homQua && hn.compare_period.to === homQua);
  ok('kỳ chạy tới hôm nay thì cắt ở giờ hiện tại, không lấy hết ngày',
    hn.period.live === true && !hn.period.to_ts.endsWith('23:59:59'), hn.period.to_ts);
  const y = await get('/dashboard?from=2020-01-01&to=2020-12-31');
  ok('cả năm thì vẽ theo tháng', y.series.bucket === 'month' && y.series.rows.length === 12);

  section('ĐỢT 7 — nhóm hàng cộng đủ tổng, hàng bán chạy theo mặt hàng');
  const sumCat = T3.categories.reduce((a, c) => a + c.revenue, 0);
  ok('tỷ trọng nhóm hàng cộng lại đúng 100%', sumCat === T3.category_total, `${money(sumCat)} / ${money(T3.category_total)}`);
  ok('hàng bán chạy gom theo mặt hàng, số lượng theo đơn vị cơ bản',
    T3.top.revenue.length === 1 && T3.top.revenue[0].qty === 3, JSON.stringify(T3.top.revenue[0]));

  section('ĐỢT 7 — "hết hàng" chỉ đếm món có bán trong 90 ngày');
  const truoc = (await get('/dashboard')).out_of_stock;
  await post('/products', { name: `Hàng chưa nhập lần nào ${Date.now()}`, base_unit: 'Cái', track_stock: 1, price: 1000, cost_price: 500 });
  ok('thêm món chưa nhập, chưa bán không làm tăng số hết hàng',
    (await get('/dashboard')).out_of_stock === truoc, String(truoc));

  section('ĐỢT 7B — khối "Cần xử lý"');
  {
    const truoc = await get('/dashboard/actions');
    const dem = (k) => truoc.items.find((x) => x.key === k)?.count || 0;

    /* Phiếu bảo hành hẹn trả hôm qua mà chưa trả máy */
    const kh = await post('/customers', { name: `Khách cần xử lý ${Date.now()}` });
    const homQua2 = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE');
    await post('/warranty', {
      customer_id: kh.id, customer_name: kh.name, ticket_type: 'repair', promised_at: homQua2,
      items: [{ product_name: 'Máy khoan thử', issue: 'Không chạy', promised_at: homQua2,
        /* Ảnh lúc nhận bắt buộc từ 25/10/2026 — ảnh 1×1 điểm cho bài thử */
        photos: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='] }],
      product_name: 'Máy khoan thử', issue: 'Không chạy',
    }).catch(() => null);
    const sau = await get('/dashboard/actions');
    const w = sau.items.find((x) => x.key === 'warranty_late');
    ok('phiếu bảo hành quá hẹn hiện trong "Cần xử lý"', (w?.count || 0) >= dem('warranty_late') + 1, w?.label);
    ok('mỗi việc có đường dẫn mở đúng danh sách', sau.items.every((x) => x.to && x.action && x.label));
    ok('việc gấp xếp trước', sau.items.findIndex((x) => x.level !== 'high') === -1
      || sau.items.slice(sau.items.findIndex((x) => x.level !== 'high')).every((x) => x.level !== 'high'));
    ok('việc không có gì thì không hiện', sau.items.every((x) => x.count > 0));

    /* Trang đích lọc ra đúng chừng ấy */
    const ds = await get('/warranty?late=1&page_size=200');
    ok('trang Bảo hành ?late=1 ra đúng số phiếu quá hẹn', (ds.rows || ds).length === w?.count,
      `${(ds.rows || ds).length} / ${w?.count}`);
    const o = sau.items.find((x) => x.key === 'order_late');
    const dsO = await get('/orders?late=1&page_size=200');
    ok('trang Đặt hàng ?late=1 khớp số đơn quá hẹn', (dsO.rows || dsO).length === (o?.count || 0));
  }

  await put('/settings', { pos: st.pos });
}
