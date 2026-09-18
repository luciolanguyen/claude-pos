/* ====================================================================
   GHÉP CỘT FILE NHẬP HÀNG HOÁ (plan 26)

   Tách khỏi màn hình để soát được bằng kiểm thử: tiêu đề cột có dấu hay
   không, viết hoa hay thường, nằm ở dòng 1 hay dòng 3 đều phải nhận ra.
   ==================================================================== */
import { noAccent } from './format.js';

/* Từ khoá xếp từ CỤ THỂ tới CHUNG: "Tên gọi khác" không được bị cột Tên
   hàng hoá giành mất chỉ vì cùng bắt đầu bằng chữ "tên". */
export const FIELDS = [
  { key: 'sku', label: 'Mã hàng', hints: ['ma hang', 'ma sp', 'sku', 'ma'] },
  { key: 'name', label: 'Tên hàng hoá', hints: ['ten hang', 'ten san pham', 'ten sp', 'name', 'ten'], required: true },
  { key: 'alias', label: 'Tên gọi khác', hints: ['ten goi khac', 'ten phu', 'ten tat', 'alias'] },
  { key: 'category', label: 'Nhóm hàng', hints: ['nhom hang', 'nhom', 'loai', 'danh muc'] },
  { key: 'base_unit', label: 'Đơn vị tính', hints: ['don vi tinh', 'dvt', 'dv tinh', 'don vi', 'unit'] },
  { key: 'cost_price', label: 'Giá vốn / giá nhập', hints: ['gia von', 'gia nhap', 'gia mua', 'cost'] },
  { key: 'price_retail', label: 'Giá bán lẻ', hints: ['gia ban le', 'gia le', 'gia ban', 'don gia', 'gia'] },
  { key: 'price_wholesale', label: 'Giá sỉ', hints: ['gia si', 'gia buon'] },
  { key: 'price_dealer', label: 'Giá thợ / đại lý', hints: ['gia tho', 'gia dai ly', 'gia dl'] },
  { key: 'opening_qty', label: 'Tồn kho hiện có', hints: ['ton kho', 'ton hien co', 'so luong', 'sl', 'ton'] },
  { key: 'min_stock', label: 'Tồn tối thiểu', hints: ['ton toi thieu', 'ton min', 'dinh muc'] },
  { key: 'barcode', label: 'Mã vạch', hints: ['ma vach', 'barcode'] },
  { key: 'brand', label: 'Hãng', hints: ['hang', 'thuong hieu', 'brand', 'nsx'] },
  { key: 'location', label: 'Vị trí kệ', hints: ['vi tri', 'ke', 'location'] },
  { key: 'vat_rate', label: 'Thuế GTGT (%)', hints: ['thue gtgt', 'thue', 'vat', 'gtgt'] },
  { key: 'big_unit', label: 'Đơn vị lớn', hints: ['don vi lon', 'dv lon', 'quy cach'] },
  { key: 'big_factor', label: 'Hệ số quy đổi', hints: ['he so', 'quy doi', 'factor'] },
  { key: 'big_price', label: 'Giá đơn vị lớn', hints: ['gia don vi lon', 'gia lon', 'gia cuon', 'gia thung'] },
];

/* Trường có tên CỤ THỂ được ghép trước, để từ khoá chung như "mã", "giá",
   "tên" chỉ nhận những cột còn lại: file có "Mã vạch" mà không có "Mã hàng"
   thì Mã hàng không được giành mất cột mã vạch. */
const MAP_ORDER = ['barcode', 'big_price', 'big_unit', 'big_factor', 'alias', 'min_stock',
  'price_wholesale', 'price_dealer', 'cost_price', ...FIELDS.map((f) => f.key)]
  .filter((k, i, a) => a.indexOf(k) === i)
  .map((k) => FIELDS.find((f) => f.key === k));

/** Tự đoán cột nào ứng với trường nào. Khớp khít trước, rồi mới "bắt đầu bằng", "có chứa". */
export function autoMap(header) {
  const map = {};
  const used = new Set();
  const heads = header.map((h) => noAccent(String(h ?? '')).replace(/\*/g, '').trim());
  const tiers = [(h, t) => h === t, (h, t) => h.startsWith(t), (h, t) => h.includes(t)];
  for (const f of MAP_ORDER) {
    let found = -1;
    for (const test of tiers) {
      for (const hint of f.hints) {
        found = heads.findIndex((h, i) => h && !used.has(i) && test(h, hint));
        if (found >= 0) break;
      }
      if (found >= 0) break;
    }
    if (found >= 0) { map[f.key] = found; used.add(found); }
  }
  return map;
}

/** Tiêu đề không phải lúc nào cũng ở dòng 1: dò 5 dòng đầu, chọn dòng nhận ra nhiều cột nhất. */
export function detectHeader(table) {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(5, table.length); i += 1) {
    const m = autoMap(table[i]);
    const score = Object.keys(m).length + (m.name != null ? 3 : 0);
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}

/** Dòng gửi lên máy chủ: chỉ mang các cột đã ghép, kèm số dòng thật trong file. */
export function buildRows(table, headerRow, map) {
  return table.slice(headerRow + 1).map((r, i) => {
    const o = { _line: headerRow + 2 + i };
    for (const [key, idx] of Object.entries(map)) {
      if (idx !== '' && idx != null) o[key] = r[idx] ?? '';
    }
    return o;
  });
}

