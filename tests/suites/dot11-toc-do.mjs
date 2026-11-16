/**
 * ĐỢT 11 — màn hình bán hàng nhanh khi tiệm có rất nhiều mã hàng (16/11/2026).
 *
 * - Phản hồi JSON lớn được nén gzip, mà lớp cắt giá vốn vẫn chạy trước khi nén.
 * - Thanh toán xong máy khách chỉ hỏi tồn của món vừa bán: /products/pos/stock.
 * - Các bảng dòng chứng từ có chỉ mục theo mã hàng / mã chứng từ.
 */
import path from 'node:path';
import { section, ok, get, post, authAs, BASE, ROOT } from '../lib.mjs';
import { DatabaseSync } from 'node:sqlite';

export default async function run() {
  const chu = await authAs('chu');
  const tn = await authAs('thungan');
  const whs = await get('/warehouses');
  const wh = (whs.find((w) => w.is_default) || whs[0]).id;

  section('ĐỢT 11 — danh mục bán hàng nén gzip');
  {
    const r = await fetch(`${BASE}/products/pos?warehouse_id=${wh}`, {
      headers: { ...chu, 'Accept-Encoding': 'gzip' },
    });
    const list = await r.json();
    ok('trả về được, có hàng', r.ok && list.length > 0, String(list.length));
    ok('được nén gzip', r.headers.get('content-encoding') === 'gzip', r.headers.get('content-encoding'));
    ok('chủ vẫn thấy giá vốn sau khi nén', list.some((p) => 'cost_price' in p));

    const r2 = await fetch(`${BASE}/products/pos?warehouse_id=${wh}`, {
      headers: { ...tn, 'Accept-Encoding': 'gzip' },
    });
    const list2 = await r2.json();
    ok('thu ngân cũng nhận bản nén', r2.headers.get('content-encoding') === 'gzip');
    const lo = list2.filter((p) => 'cost_price' in p || 'last_purchase_price' in p || 'last_purchase_at' in p);
    ok('bản nén của thu ngân vẫn bị cắt giá vốn / giá nhập', lo.length === 0, lo.slice(0, 3).map((p) => p.sku).join());

    const r3 = await fetch(`${BASE}/products/pos?warehouse_id=${wh}`, {
      headers: { ...chu, 'Accept-Encoding': 'identity' },
    });
    ok('máy không nhận gzip thì gửi chữ thường', !r3.headers.get('content-encoding') && (await r3.json()).length === list.length);

    const r4 = await fetch(`${BASE}/warehouses`, { headers: { ...chu, 'Accept-Encoding': 'gzip' } });
    ok('phản hồi nhỏ gửi thẳng, khỏi nén', !r4.headers.get('content-encoding'));
  }

  section('ĐỢT 11 — hỏi tồn đúng món vừa bán');
  {
    /* Món riêng của bài này: đụng tồn hàng mẫu thì các bài sau (tính tồn
       sát nút) hụt hàng */
    const sups = await get('/suppliers?page_size=5');
    const sup = (sups.rows || sups)[0];
    const pr = await post('/products', {
      name: `Cầu chì thử tốc độ ${Date.now().toString().slice(-6)}`, base_unit: 'Cái',
      track_stock: 1, price: 2000, cost_price: 1000,
    });
    const unit = (await get(`/products/${pr.id}`)).units.find((u) => u.factor === 1);
    await post('/purchases', {
      supplier_id: sup.id, warehouse_id: wh,
      items: [{ product_id: pr.id, unit_id: unit.id, unit_name: unit.unit_name, factor: 1, qty: 5, price: 1000 }],
    });
    const p = (await get(`/products/pos?warehouse_id=${wh}`)).find((x) => x.id === pr.id);
    const before = (await get(`/products/pos/stock?warehouse_id=${wh}&ids=${p.id}`))[0].stock;
    ok('tồn trả về khớp danh mục', before === p.stock, `${before} / ${p.stock}`);
    await post('/sales', {
      warehouse_id: wh, user_id: 1,
      items: [{ product_id: p.id, unit_id: unit.id, unit_name: unit.unit_name, factor: unit.factor, qty: 1, price: 1000 }],
      payment_method: 'cash', paid: 1000, received: 1000,
    });
    const after = await get(`/products/pos/stock?warehouse_id=${wh}&ids=${p.id},abc,-3,${p.id}`, tn);
    ok('bán 1 thì tồn giảm đúng (thu ngân hỏi được)', after.length === 1 && after[0].stock === before - unit.factor,
      JSON.stringify(after));
    ok('không có mã nào thì trả mảng rỗng', (await get(`/products/pos/stock?warehouse_id=${wh}&ids=`)).length === 0);
    const vo = await get(`/products/pos/stock?warehouse_id=${wh}&ids=999999`);
    ok('mã không có thì bỏ qua', vo.length === 0);
  }

  section('ĐỢT 11 — chỉ mục cho bảng dòng chứng từ');
  {
    const db = new DatabaseSync(path.join(ROOT, 'data', 'test.db'), { readOnly: true });
    const idx = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((x) => x.name));
    db.close();
    const can = ['idx_pi_product', 'idx_pi_purchase', 'idx_si_sale', 'idx_si_product',
      'idx_sri_return', 'idx_pri_return', 'idx_sci_sale'];
    const thieu = can.filter((n) => !idx.has(n));
    ok('đủ chỉ mục', thieu.length === 0, thieu.join(', '));
  }
}
