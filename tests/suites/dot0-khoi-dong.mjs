/** Bài mở màn: máy chủ lên, dữ liệu mẫu có, và đang chạy đúng CSDL thử. */
import { section, ok, get } from '../lib.mjs';

export default async function run() {
  section('ĐỢT 0 — máy chủ thử lên được');
  const info = await get('/system-info');
  ok('chạy trên data/test.db', /test\.db$/.test(info.db_file), info.db_file);
  const whs = await get('/warehouses');
  ok('có kho mặc định', whs.some((w) => w.is_default));
  const prods = await get('/products?page_size=5');
  ok('dữ liệu mẫu có hàng hoá', prods.rows.length > 0, `${prods.total} mặt hàng`);
}
