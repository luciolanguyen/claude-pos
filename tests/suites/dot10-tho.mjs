/**
 * ĐỢT 10 — vai trò Thợ, báo giá sửa chữa, hai mức xem tiền (25/10/2026).
 *
 * Luồng đủ: thợ nhận máy (ảnh bắt buộc) → báo vật tư (không giá) → chủ báo giá
 * → thu ngân ghi khách đồng ý → thợ sửa, báo xong (ảnh + xác cũ) → thu ngân trả
 * máy chỉ thấy tổng tiền. Thợ không thấy đồng nào ở mọi đường đọc phiếu.
 */
import { section, ok, get, post, put, raw, authAs, money } from '../lib.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const MONEY_KEYS = ['price', 'amount', 'amount_sale', 'list_price', 'unit_cost', 'labor_fee', 'parts_price',
  'parts_cost', 'custom_parts_price', 'fees_total', 'discount', 'charge', 'paid', 'quote_total', 'totals',
  'support_discount', 'support_discount_total', 'last_purchase_price', 'refund_amount'];
function moneyKeys(v, path = '') {
  if (Array.isArray(v)) return v.flatMap((x, i) => moneyKeys(x, `${path}[${i}]`));
  if (v && typeof v === 'object') {
    return Object.entries(v).flatMap(([k, x]) => (MONEY_KEYS.includes(k) ? [`${path}.${k}`] : moneyKeys(x, `${path}.${k}`)));
  }
  return [];
}
const soTien = (v) => JSON.stringify(v).match(/\d[\d.]*\s*đ/g) || [];

export default async function run() {
  const tho = await authAs('tho');
  const tn = await authAs('thungan');
  const meTho = await get('/me', tho);

  section('ĐỢT 10 — vai trò Thợ có đúng quyền');
  ok('vai trò mới tên "Thợ"', meTho.user?.role === 'technician' && meTho.role_labels.technician === 'Thợ');
  ok('thợ nhận máy + sửa, không báo giá, không trả máy',
    meTho.can.includes('warranty.receive') && meTho.can.includes('warranty.work')
    && !meTho.can.includes('warranty.quote') && !meTho.can.includes('warranty.deliver'));
  ok('thợ không xem hoá đơn bán, không thấy giá vốn', !meTho.can.includes('sale.view') && !meTho.can.includes('cost.view'));
  ok('/me trả bảng quyền từng vai cho màn hình Thiết lập', Array.isArray(meTho.role_permissions?.technician));

  section('ĐỢT 10 — nhận máy: ảnh tình trạng bắt buộc');
  const kh = await post('/customers', { name: `Khách sửa máy ${Date.now()}`, phone: `09${String(Date.now()).slice(-8)}` });
  const nhan = { customer_id: kh.id, ticket_type: 'repair', product_name: 'Máy bơm Panasonic 200W', issue: 'Kêu to, không lên nước' };
  const r0 = await raw('POST', '/warranty', nhan, tho);
  ok('không ảnh → 400 PHOTO_REQUIRED', r0.status === 400 && r0.body?.code === 'PHOTO_REQUIRED', String(r0.status));
  const phieu = await post('/warranty', { ...nhan, photos: [PNG] }, tho);
  let t = await get(`/warranty/${phieu.id}`);
  ok('phiếu mới chờ báo giá', t.quote_state === 'waiting_quote', t.quote_state);
  ok('người nhận là thợ đang đăng nhập', t.received_by === meTho.user.id);

  section('ĐỢT 10 — chưa báo giá thì chưa sửa được');
  ok('thợ chuyển "đang sửa" khi chờ báo giá → 400',
    (await raw('POST', `/warranty/${t.id}/status`, { status: 'repairing' }, tho)).status === 400);
  ok('thợ chuyển "đang kiểm tra" được',
    (await raw('POST', `/warranty/${t.id}/status`, { status: 'checking' }, tho)).status === 200);
  ok('thợ không tự chuyển "xong" qua đổi trạng thái (403)',
    (await raw('POST', `/warranty/${t.id}/status`, { status: 'ready' }, tho)).status === 403);
  ok('thợ báo xong khi chờ báo giá → 400',
    (await raw('POST', `/warranty/${t.id}/done`, { photos: [PNG] }, tho)).status === 400);

  section('ĐỢT 10 — thợ báo vật tư, không có giá');
  const prods = await get('/products/pos');
  /* Lấy món tồn nhiều nhất: các đợt kiểm thử sau còn bán hàng mẫu, đừng giành món sắp hết */
  const lk = [...prods].filter((p) => p.track_stock).sort((a, b) => b.stock - a.stock)[0];
  const de = await put(`/warranty/${t.id}/proposal`, {
    parts: [{ product_id: lk.id, qty: 1, price: 1 }],
    custom: [{ name: 'Phốt bơm mua chợ', qty: 1, outlay: 35000 }],
  }, tho);
  ok('phiếu trả về cho thợ không có khoá tiền nào', moneyKeys(de).length === 0, moneyKeys(de).join(', '));
  ok('thợ thấy tiền chính mình bỏ ra mua ngoài', de.custom_parts[0]?.outlay === 35000);
  t = await get(`/warranty/${t.id}`);
  ok('giá thợ gửi lên bị bỏ qua — lấy giá niêm yết', t.parts[0].price > 1, money(t.parts[0].price));
  ok('linh kiện mua ngoài chờ chủ báo giá (giá khách 0)', t.custom_parts[0].price === 0 && t.custom_parts[0].outlay === 35000);
  ok('thợ không vào giỏ linh kiện có giá (403)',
    (await raw('PUT', `/warranty/${t.id}/cart`, { parts: [] }, tho)).status === 403);
  ok('thợ không sửa tiền công (403)',
    (await raw('PUT', `/warranty/${t.id}/fees`, { labor_fee: 1 }, tho)).status === 403);
  ok('thợ không huỷ phiếu (403)', (await raw('POST', `/warranty/${t.id}/cancel`, {}, tho)).status === 403);
  ok('thợ không trả máy (403)', (await raw('POST', `/warranty/${t.id}/deliver`, {}, tho)).status === 403);
  ok('thợ không báo giá (403)', (await raw('POST', `/warranty/${t.id}/quote`, {}, tho)).status === 403);

  section('ĐỢT 10 — chủ báo giá, thu ngân ghi khách đồng ý');
  await put(`/warranty/${t.id}/cart`, {
    parts: [{ product_id: lk.id, qty: 1, price: t.parts[0].price }],
    custom: [{ name: 'Phốt bơm mua chợ', qty: 1, price: 50000 }],
  });
  await put(`/warranty/${t.id}/fees`, { labor_fee: 100000 });
  t = await get(`/warranty/${t.id}`);
  ok('chủ sửa giá vẫn giữ tiền thợ bỏ ra', t.custom_parts[0].outlay === 35000 && t.custom_parts[0].price === 50000);
  const tong = t.totals.total;
  const bg = await post(`/warranty/${t.id}/quote`, {});
  ok('báo giá → chờ khách duyệt, ghi số tiền báo', bg.quote_state === 'waiting_approval' && bg.quote_total === tong, money(bg.quote_total));
  ok('chưa duyệt thì thu ngân chưa trả máy được',
    (await raw('POST', `/warranty/${t.id}/deliver`, { paid: tong }, tn)).status === 400);
  const xemTn = await get(`/warranty/${t.id}`, tn);
  ok('thu ngân thấy tổng tiền', xemTn.totals?.total === tong, money(xemTn.totals?.total));
  ok('thu ngân không thấy đơn giá, tiền công, giá niêm yết',
    xemTn.parts.every((p) => p.price === undefined && p.list_price === undefined) && xemTn.labor_fee === undefined
    && xemTn.custom_parts.every((c) => c.price === undefined && c.outlay === undefined));
  ok('thợ không trả lời báo giá thay khách (403)',
    (await raw('POST', `/warranty/${t.id}/approval`, { approved: true }, tho)).status === 403);
  const dy = await post(`/warranty/${t.id}/approval`, { approved: true, note: 'khách gọi lại đồng ý' }, tn);
  ok('thu ngân ghi khách đồng ý', dy.quote_state === 'approved');
  const nk = await get(`/warranty/${t.id}`, tho);
  ok('nhật ký thợ xem bị che số tiền', soTien(nk.logs).every((x) => x.startsWith('···')) && nk.logs.some((l) => /···/.test(l.note || '')));

  section('ĐỢT 10 — đổi vật tư sau báo giá thì phải báo giá lại');
  {
    const p2 = await post('/warranty', { ...nhan, product_name: 'Quạt đứng', photos: [PNG] }, tho);
    await put(`/warranty/${p2.id}/proposal`, { parts: [{ product_id: lk.id, qty: 1 }] }, tho);
    await post(`/warranty/${p2.id}/quote`, {});
    await post(`/warranty/${p2.id}/approval`, { approved: true }, tn);
    const lai = await put(`/warranty/${p2.id}/proposal`, { parts: [{ product_id: lk.id, qty: 2 }] }, tho);
    ok('thợ thêm vật tư sau khi khách duyệt → quay lại chờ báo giá', lai.quote_state === 'waiting_quote', lai.quote_state);
    const mien = await post(`/warranty/${p2.id}/quote`, { free: true });
    ok('chủ đánh dấu bảo hành miễn phí → thợ sửa luôn', mien.quote_state === 'free');
    ok('miễn phí thì thợ chuyển "đang sửa" được',
      (await raw('POST', `/warranty/${p2.id}/status`, { status: 'repairing' }, tho)).status === 200);
  }

  section('ĐỢT 10 — thợ báo sửa xong: ảnh + xác cũ');
  ok('đang sửa', (await raw('POST', `/warranty/${t.id}/status`, { status: 'repairing' }, tho)).status === 200);
  const r1 = await raw('POST', `/warranty/${t.id}/done`, { old_parts_returned: true }, tho);
  ok('không ảnh sau sửa → 400 PHOTO_REQUIRED', r1.status === 400 && r1.body?.code === 'PHOTO_REQUIRED');
  const r2 = await raw('POST', `/warranty/${t.id}/done`, { photos: [PNG] }, tho);
  ok('có thay linh kiện mà chưa nộp xác cũ → 400', r2.status === 400 && r2.body?.code === 'OLD_PARTS_REQUIRED');
  const xong = await post(`/warranty/${t.id}/done`, { photos: [PNG], old_parts_returned: true, note: 'Thay phốt, chạy êm' }, tho);
  ok('phiếu thành "Xong, chờ khách lấy", ghi đã nộp xác cũ',
    xong.status === 'ready' && xong.old_parts_returned === 1 && xong.photos.some((p) => p.kind === 'done'));

  section('ĐỢT 10 — thu ngân trả máy: không tự giảm giá');
  const tonTruoc = (await get(`/products/${lk.id}`)).total_stock;
  const giam = await raw('POST', `/warranty/${t.id}/deliver`, { extra_discount: 20000, paid: tong - 20000 }, tn);
  ok('thu ngân miễn giảm không có PIN → đòi duyệt', giam.status === 400 && giam.body?.needs_approval === true);
  const tra = await post(`/warranty/${t.id}/deliver`, { paid: tong, labor_fee: 1, charge: 1 }, tn);
  ok('thu ngân gửi tiền công / số thu khác cũng bị bỏ qua — thu đúng báo giá', tra.charge === tong, money(tra.charge));
  ok('trừ kho đúng 1 linh kiện thợ báo', (await get(`/products/${lk.id}`)).total_stock === tonTruoc - 1);
  const sau = await get(`/warranty/${t.id}`, tn);
  ok('thu ngân xem lại thấy số đã thu, không thấy cơ cấu', sau.charge === tong && sau.paid === tong && sau.labor_fee === undefined);

  section('ĐỢT 10 — thợ không thấy đồng nào ở mọi đường đọc');
  {
    const ds = await get('/warranty?page_size=50', tho);
    ok('danh sách phiếu', moneyKeys(ds.rows).length === 0, moneyKeys(ds.rows).slice(0, 3).join(', '));
    const ls = await get(`/warranty-history?customer_id=${kh.id}`, tho);
    ok('lịch sử sửa của khách', ls.length >= 1 && moneyKeys(ls).length === 0, moneyKeys(ls).slice(0, 3).join(', '));
    const tc = await get(`/warranty-lookup?q=${encodeURIComponent(kh.phone)}`, tho);
    ok('tra hạn bảo hành không lộ giá bán', moneyKeys(tc).length === 0);
    const ct = await get(`/warranty/${t.id}`, tho);
    ok('phiếu đã trả khách', moneyKeys(ct).length === 0, moneyKeys(ct).slice(0, 3).join(', '));
    ok('thợ không xem hoá đơn bán (403)', (await raw('GET', '/sales?page_size=1', null, tho)).status === 403);
  }

  section('ĐỢT 10 — phiếu chờ báo giá hiện ở Tổng quan');
  {
    const p3 = await post('/warranty', { ...nhan, product_name: 'Nồi cơm điện', photos: [PNG] }, tho);
    const a = (await get('/dashboard/actions')).items.find((x) => x.key === 'warranty_waiting_quote');
    ok('có dòng phiếu chờ báo giá', (a?.count || 0) >= 1, a?.label);
    const ds = await get('/warranty?quote=waiting_quote&page_size=200');
    ok('trang Bảo hành ?quote=waiting_quote ra đúng chừng ấy', ds.rows.length === a?.count && ds.rows.some((x) => x.id === p3.id));
  }
}
