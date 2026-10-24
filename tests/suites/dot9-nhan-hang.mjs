/**
 * ĐỢT 9 — thủ kho nhận hàng "mù giá", chủ / quản lý chốt giá sau (24/10/2026).
 *
 * Dựng một món riêng giá vốn 10.000 để soát được từng đồng giá vốn bình quân:
 * nhận hàng cộng tồn ngay theo giá tạm, chưa ghi nợ NCC; bán trong lúc chờ giữ
 * giá vốn tạm; chốt giá thì giá vốn tính lại theo phần chênh trên số còn tồn.
 */
import { section, ok, get, post, raw, authAs, money } from '../lib.mjs';
import { ACCESS_RULES } from '../../server/access-map.js';

/** Có khoá tiền nào lọt ra không — soát cả lồng trong */
const MONEY_KEYS = ['price', 'amount', 'total', 'subtotal', 'paid', 'remaining', 'discount', 'vat_amount',
  'other_cost', 'list_price', 'cost_unit', 'temp_cost', 'net_price', 'line_vat', 'unit_cost', 'cost_price'];
function moneyKeys(v, path = '') {
  if (Array.isArray(v)) return v.flatMap((x, i) => moneyKeys(x, `${path}[${i}]`));
  if (v && typeof v === 'object') {
    return Object.entries(v).flatMap(([k, x]) => (MONEY_KEYS.includes(k) ? [`${path}.${k}`] : moneyKeys(x, `${path}.${k}`)));
  }
  return [];
}

export default async function run() {
  const kho = await authAs('kho');
  const whs = await get('/warehouses');
  const wh = (whs.find((w) => w.is_default) || whs[0]).id;
  const sups = await get('/suppliers?page_size=50');
  const sup = (sups.rows || sups)[0];
  const list = (x) => (Array.isArray(x) ? x : x.rows);
  const debtOf = async () => list(await get('/suppliers?page_size=500')).find((s) => s.id === sup.id)?.debt;

  const stamp = Date.now().toString().slice(-6);
  const pr = await post('/products', {
    name: `Ổ cắm nhận mù giá ${stamp}`, base_unit: 'Cái', track_stock: 1, price: 20000, cost_price: 10000,
  });
  const unit = (await get(`/products/${pr.id}`)).units.find((u) => u.factor === 1);
  const line = (qty, extra = {}) => ({
    product_id: pr.id, unit_id: unit.id, unit_name: unit.unit_name, factor: 1, qty, ...extra,
  });
  const ton = async () => (await get(`/products/${pr.id}`)).total_stock;
  const giaVon = async () => (await get(`/products/${pr.id}`)).cost_price;

  /* Lần nhập đầu do chủ lập, có giá: 10 cái × 10.000 */
  await post('/purchases', { supplier_id: sup.id, warehouse_id: wh, items: [line(10, { price: 10000 })] });

  section('ĐỢT 9 — thủ kho nhận hàng: cộng tồn ngay, chưa ghi nợ NCC');
  const no0 = await debtOf();
  const nh = await post('/purchases/receive', {
    supplier_id: sup.id, warehouse_id: wh, note: 'Thiếu 1 thùng',
    items: [line(5, { price: 999999, note: 'móp hộp 1 cái' })],
  }, kho);
  ok('phiếu nhận ở trạng thái chờ chốt giá', nh.status === 'pending_price', nh.code);
  ok('tồn cộng ngay 5 cái (10 → 15)', (await ton()) === 15, String(await ton()));
  ok('giá vốn tạm = giá nhập lần trước, không đổi giá vốn (10.000)', (await giaVon()) === 10000);
  ok('công nợ NCC chưa đổi một đồng', (await debtOf()) === no0, `${money(no0)} → ${money(await debtOf())}`);
  const chu = await get(`/purchases/${nh.id}`);
  ok('giá thủ kho gửi lên bị bỏ qua — giá tạm 10.000', chu.items[0].price === 10000, money(chu.items[0].price));
  ok('ghi chú thiếu / hỏng của thủ kho được giữ', chu.items[0].recv_note === 'móp hộp 1 cái');

  section('ĐỢT 9 — thủ kho không thấy đồng nào');
  {
    const d = await get(`/purchases/${nh.id}`, kho);
    ok('phiếu chi tiết không có khoá tiền nào', moneyKeys(d).length === 0, moneyKeys(d).join(', '));
    ok('vẫn thấy mối, món, số lượng', d.supplier_name === sup.name && d.items[0].qty === 5 && d.items[0].product_name);
    const ds = await get('/purchases?page_size=20', kho);
    /* "total" ở ngoài cùng là số phiếu của trang, không phải tiền */
    const tien = moneyKeys({ rows: ds.rows, totals: ds.totals });
    ok('danh sách phiếu nhập không có khoá tiền nào', tien.length === 0, tien.slice(0, 4).join(', '));
    ok('danh sách vẫn có cả phiếu chủ lập (chỉ không có tiền)', ds.rows.length >= 2);
    const ten = await get('/supplier-names', kho);
    ok('ô chọn mối chỉ có mã và tên', ten.length > 0 && ten.every((s) => Object.keys(s).sort().join() === 'code,id,name'));
    for (const [m, p, b] of [
      ['GET', '/suppliers?page_size=5'], ['GET', `/suppliers/${sup.id}`], ['GET', '/supplier-debts'],
      ['POST', `/purchases/${nh.id}/price`, { items: [] }], ['POST', `/purchases/${nh.id}/pay`, { amount: 1000 }],
      ['POST', '/purchases', { items: [line(1, { price: 1 })] }], ['POST', `/purchases/${nh.id}/cancel`, {}],
      ['GET', '/purchase-returns'], ['GET', `/products/${pr.id}/supplier-prices`],
    ]) {
      const r = await raw(m, p, b, kho);
      ok(`thủ kho bị chặn ${m} ${p.split('?')[0]}`, r.status === 403, String(r.status));
    }
  }

  section('ĐỢT 9 — bán trong lúc chờ giữ giá vốn tạm');
  const ban = await post('/sales', {
    warehouse_id: wh, user_id: 1, items: [line(3, { price: 20000 })],
    payment_method: 'cash', paid: 60000, received: 60000,
  });
  const hd = await get(`/sales/${ban.id}`);
  ok('hoá đơn bán lúc chờ mang giá vốn 10.000', hd.items[0].unit_cost === 10000, money(hd.items[0].unit_cost));
  ok('tồn còn 12', (await ton()) === 12);

  section('ĐỢT 9 — chưa chốt giá thì chưa trả tiền, chưa trả hàng theo phiếu');
  ok('trả tiền phiếu chờ chốt → 400',
    (await raw('POST', `/purchases/${nh.id}/pay`, { amount: 1000 })).status === 400);
  ok('trả hàng NCC theo phiếu chờ chốt → 400',
    (await raw('POST', '/purchase-returns', { purchase_id: nh.id, items: [line(1)] })).status === 400);

  section('ĐỢT 9 — Cần xử lý ở Tổng quan nhắc chốt giá');
  {
    const a = (await get('/dashboard/actions')).items.find((x) => x.key === 'purchase_pending_price');
    ok('có dòng phiếu chờ chốt giá', (a?.count || 0) >= 1, a?.label);
    const ds = await get('/purchases?status=pending_price&page_size=200');
    ok('trang Phiếu nhập ?status=pending_price ra đúng chừng ấy', ds.rows.length === a?.count);
  }

  section('ĐỢT 9 — chủ chốt giá 13.000: giá vốn tính lại trên số còn tồn');
  {
    const no1 = await debtOf();
    const chot = await post(`/purchases/${nh.id}/price`, {
      supplier_invoice: `HD${stamp}`,
      items: [{ purchase_item_id: chu.items[0].id, qty: 5, price: 13000 }],
    });
    ok('phiếu thành hoàn tất, tổng 65.000', chot.status === 'done' && chot.total === 65000, money(chot.total));
    /* 12 cái đang tồn giá 10.000; lô 5 cái chênh +3.000 mỗi cái → +15.000 chia đều 12 cái */
    ok('giá vốn bình quân = (12 × 10.000 + 5 × 3.000) / 12 = 11.250', (await giaVon()) === 11250, money(await giaVon()));
    ok('công nợ NCC tăng đúng 65.000', (await debtOf()) - no1 === 65000, money((await debtOf()) - no1));
    ok('hoá đơn đã bán vẫn giữ giá vốn tạm', (await get(`/sales/${ban.id}`)).items[0].unit_cost === 10000);
    const d = await get(`/purchases/${nh.id}`);
    ok('số thủ kho đếm vẫn giữ để đối chiếu', d.items[0].received_qty === 5 && d.priced_by === 1 && d.priced_at);
    ok('chốt lần hai → 400', (await raw('POST', `/purchases/${nh.id}/price`, { items: [] })).status === 400);
    ok('chốt xong trả tiền được', (await raw('POST', `/purchases/${nh.id}/pay`, { amount: 5000 })).status === 200);
  }

  section('ĐỢT 9 — chủ sửa số thủ kho đếm sai');
  {
    const n2 = await post('/purchases/receive', { supplier_id: sup.id, warehouse_id: wh, items: [line(4)] }, kho);
    ok('tồn 12 → 16', (await ton()) === 16);
    const d = await get(`/purchases/${n2.id}`);
    ok('giá tạm = giá lần chốt gần nhất 13.000', d.items[0].price === 13000, money(d.items[0].price));
    await post(`/purchases/${n2.id}/price`, {
      items: [{ purchase_item_id: d.items[0].id, qty: 3, price: 13000 }],
    });
    ok('đếm dư 1 → chủ sửa 3, tồn 15', (await ton()) === 15, String(await ton()));
    const sau = await get(`/purchases/${n2.id}`);
    ok('phiếu ghi 3, số thủ kho đếm vẫn là 4', sau.items[0].qty === 3 && sau.items[0].received_qty === 4);
    /* 12 cái × 11.250 + 3 cái × 13.000 = 174.000 trên 15 cái — lệch tối đa 1 đồng do làm tròn từng bước */
    ok('giá vốn = (12 × 11.250 + 3 × 13.000) / 15 = 11.600', Math.abs((await giaVon()) - 11600) <= 1, money(await giaVon()));
  }

  section('ĐỢT 9 — bảng chặn quyền: không luật nào bị luật đứng trước che mất');
  {
    /* access-map đọc khớp đầu tiên: luật hẹp đặt sau luật rộng là luật chết */
    const che = [];
    ACCESS_RULES.forEach(([m, re, perm], i) => {
      const mau = re.source.replace(/^\^/, '').replace(/\$$/, '')
        .split('\\d+').join('1').split('\\/').join('/')
        .replace(/\(\/1\)\?/g, '').replace(/\(([^)|]+)\|[^)]*\)/g, '$1').replace(/\?/g, '');
      const pt = m === '*' ? 'POST' : m;
      const dau = ACCESS_RULES.findIndex(([m2, re2]) => (m2 === '*' || m2 === pt) && re2.test(mau));
      if (dau !== -1 && dau !== i && ACCESS_RULES[dau][2] !== perm) che.push(`${m} ${mau} (${perm})`);
    });
    ok('mọi luật hẹp đứng trước luật rộng', che.length === 0, che.join(' · '));
  }

  section('ĐỢT 9 — chủ vẫn lập phiếu nhập có giá như cũ');
  {
    const r = await post('/purchases', { supplier_id: sup.id, warehouse_id: wh, items: [line(1, { price: 11250 })] });
    ok('phiếu chủ lập hoàn tất ngay', (await get(`/purchases/${r.id}`)).status === 'done');
  }
}
