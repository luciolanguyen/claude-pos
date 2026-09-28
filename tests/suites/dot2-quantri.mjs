/**
 * ĐỢT 2 — trang quản trị (tài liệu "Yêu cầu Cập nhật Phần mềm 2", phần II).
 */
import { section, ok, get, post, put, money } from '../lib.mjs';

const stamp = String(Date.now()).slice(-5);

export default async function run() {
  const whs = await get('/warehouses');
  const wh = (whs.find((w) => w.is_default) || whs[0]).id;
  const prods = await get('/products?page_size=5');
  const p = prods.rows[0];
  const unit = (await get(`/products/${p.id}`)).units.find((u) => u.factor === 1);
  const line = { product_id: p.id, unit_id: unit.id, unit_name: unit.unit_name, factor: 1, qty: 1, price: 200000 };

  section('ĐỢT 2 — lãi của đơn giao hàng trừ tiền xe (mục II.1)');
  {
    const plain = await post('/sales', {
      warehouse_id: wh, user_id: 1, payment_method: 'cash', paid: 200000, received: 200000, items: [line],
    });
    const shipped = await post('/sales', {
      warehouse_id: wh, user_id: 1, payment_method: 'cash', paid: 200000, received: 200000, items: [line],
      delivery_address: 'Ấp 5, Cái Bè', shipper_name: 'Anh Chín', shipper_fee: 40000, delivery_status: 'pending',
    });
    const rows = (await get('/sales?page_size=20')).rows;
    const a = rows.find((r) => r.id === plain.id);
    const b = rows.find((r) => r.id === shipped.id);
    ok('hai đơn cùng tiền hàng, đơn có tiền xe lãi thấp hơn đúng 40.000',
      a.profit - b.profit === 40000, `${money(a.profit)} vs ${money(b.profit)}`);

    const d = await get(`/sales/${shipped.id}`);
    ok('chi tiết hoá đơn có đủ số để tách dòng tiền',
      d.shipper_fee === 40000 && d.ship_fee === 0 && d.paid === 200000);
  }

  section('ĐỢT 2 — báo hết hàng: mỗi mối một số lượng dự mua (mục II.3b)');
  {
    const sups = await get('/suppliers');
    const [s1, s2] = sups;
    const rq = await post('/requisitions', {
      warehouse_id: wh, user_id: 1,
      items: [{ product_id: p.id, name_snapshot: p.name, unit_name: unit.unit_name, system_qty: 0, buy_qty: 0 }],
    });
    const d0 = await get(`/requisitions/${rq.id}`);
    const item = d0.items[0];
    ok('dòng phiếu có ảnh sản phẩm và quy cách', 'image' in item && 'pack_spec' in item);
    ok('mối gợi ý kèm giá mua lần trước và số lần đã lấy',
      item.suppliers.every((x) => 'last_purchase_price' in x && 'last_ts' in x && 'times' in x));

    await put(`/requisitions/${rq.id}/items/${item.id}`, { supplier_ids: [s1.id, s2.id] });
    await put(`/requisitions/${rq.id}/items/${item.id}`, { supplier_qty: { supplier_id: s1.id, buy_qty: 60 } });
    const d1 = await put(`/requisitions/${rq.id}/items/${item.id}`, { supplier_qty: { supplier_id: s2.id, buy_qty: 40 } });
    const it1 = d1.items[0];
    ok('số dự mua ghi riêng cho từng mối', it1.buy_qtys[s1.id] === 60 && it1.buy_qtys[s2.id] === 40,
      JSON.stringify(it1.buy_qtys));
    ok('tổng dự mua của dòng bằng tổng các mối', it1.buy_qty === 100, String(it1.buy_qty));

    const split = await post(`/requisitions/${rq.id}/split`, { user_id: 1 });
    const drafts = split.drafts || split;
    ok('tách ra hai phiếu mua tạm, mỗi mối một phiếu', drafts.length === 2, `${drafts.length} phiếu`);
    const qtys = [];
    for (const dr of drafts) {
      const full = await get(`/doc-drafts/${dr.id}`);
      qtys.push(full.payload.lines.reduce((a, l) => a + Number(l.qty), 0));
    }
    ok('mỗi phiếu mang đúng phần của mối đó, không nhân đôi',
      qtys.sort((a, b) => a - b).join(',') === '40,60', qtys.join(','));
  }

  section('ĐỢT 2 — trả nợ tổng hợp cho chủ hàng vãng lai (mục II.4)');
  {
    const partner = await post('/consign-partners', { name: `ZZĐ2 Chủ hàng ${stamp}`, commission_type: 'percent', commission_value: 10 });
    const mk = async (price) => {
      const s = await post('/sales', {
        warehouse_id: wh, user_id: 1, payment_method: 'cash', paid: price, received: price, items: [],
        consign_items: [{ name: `ZZĐ2 Món ${stamp}-${price}`, qty: 1, price, partner_id: partner.id,
          commission_type: 'percent', commission_value: 10 }],
      });
      return s;
    };
    await mk(100000);
    await mk(200000);
    const st1 = await post('/consign-settlements', { partner_ids: [partner.id], pay: false, user_id: 1 });
    await mk(300000);
    const st2 = await post('/consign-settlements', { partner_ids: [partner.id], pay: false, user_id: 1 });
    const owingAll = st1.settlements[0].payout + st2.settlements[0].payout;
    ok('hai đợt chốt còn nợ chủ hàng', owingAll === 540000, money(owingAll));

    const accounts = await get('/cash/accounts');
    const cash = accounts.find((a) => a.type === 'cash') || accounts[0];
    const bal = async () => (await get('/cash/accounts')).find((a) => a.id === cash.id).balance;
    const before = await bal();

    /* Trả gộp một lần cho cả hai đợt, chỉ một phiếu chi */
    const res = await post(`/consign-partners/${partner.id}/pay`, {
      amount: 400000, account_id: cash.id, user_id: 1, note: 'trả gộp',
    });
    ok('một phiếu chi duy nhất cho nhiều đợt', !!res.cash_code && res.paid === 400000,
      `${res.cash_code} · ${money(res.paid)}`);
    ok('quỹ giảm đúng số đã trả', (await bal()) === before - 400000);
    ok('trả dần từ đợt cũ nhất', res.allocation?.[0]?.settlement_id === st1.settlements[0].id
      && res.allocation[0].amount === st1.settlements[0].payout,
    JSON.stringify(res.allocation));

    const list = await get('/consign-settlements?page_size=50');
    const a1 = list.rows.find((x) => x.id === st1.settlements[0].id);
    const a2 = list.rows.find((x) => x.id === st2.settlements[0].id);
    ok('đợt cũ trả đủ, đợt mới còn nợ phần còn lại',
      a1.owing === 0 && a2.owing === owingAll - 400000,
      `đợt 1 còn ${money(a1.owing)} · đợt 2 còn ${money(a2.owing)}`);

    const res2 = await post(`/consign-partners/${partner.id}/pay`, { user_id: 1 });
    ok('không ghi số tiền thì trả nốt phần còn nợ', res2.paid === owingAll - 400000, money(res2.paid));
    const after = await get('/consign-settlements?page_size=50');
    ok('trả xong thì cả hai đợt hết nợ',
      after.rows.filter((x) => [st1.settlements[0].id, st2.settlements[0].id].includes(x.id))
        .every((x) => x.owing === 0));
  }
}
