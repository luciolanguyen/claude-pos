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

/**
 * Tự đoán cột nào ứng với trường nào, cho một danh sách trường bất kỳ (hàng hoá,
 * khách hàng, nhà cung cấp). Khớp khít trước, rồi mới "bắt đầu bằng", "có chứa".
 * `order`: trường cụ thể ghép trước để từ khoá chung khỏi giành cột.
 */
export function autoMapFields(fields, header, order = fields) {
  const map = {};
  const used = new Set();
  const heads = header.map((h) => noAccent(String(h ?? '')).replace(/\*/g, '').trim());
  const tiers = [(h, t) => h === t, (h, t) => h.startsWith(t), (h, t) => h.includes(t)];
  for (const f of order) {
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

/** Dò 5 dòng đầu, chọn dòng nhận ra nhiều cột nhất làm dòng tiêu đề. */
export function detectHeaderFields(fields, table, order = fields) {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(5, table.length); i += 1) {
    const m = autoMapFields(fields, table[i], order);
    const score = Object.keys(m).length + (m.name != null ? 3 : 0);
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}

/** Hàng hoá: giữ nguyên hai hàm cũ cho màn hình nhập hàng hoá. */
export const autoMap = (header) => autoMapFields(FIELDS, header, MAP_ORDER);
export const detectHeader = (table) => detectHeaderFields(FIELDS, table, MAP_ORDER);

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


/* ====================================================================
   NHẬP KHÁCH HÀNG / NHÀ CUNG CẤP (10/10/2026)

   Cố ý KHÔNG có cột nợ đầu kỳ: nợ là tiền, đi đường "Điều chỉnh công nợ"
   có PIN. File có cột nợ thì màn hình báo là cột đó bị bỏ qua.
   Thứ tự ghép: cột cụ thể ("SĐT 2", "tên công ty") trước cột chung ("SĐT", "tên").
   ==================================================================== */
export const CUSTOMER_FIELDS = [
  { key: 'code', label: 'Mã khách hàng', hints: ['ma khach hang', 'ma kh', 'ma'] },
  { key: 'company_name', label: 'Tên công ty', hints: ['ten cong ty', 'cong ty', 'don vi'] },
  { key: 'name', label: 'Tên khách hàng', hints: ['ten khach hang', 'ten khach', 'ho ten', 'ho va ten', 'khach hang', 'ten'], required: true },
  { key: 'phone2', label: 'SĐT 2', hints: ['sdt 2', 'so dien thoai 2', 'dien thoai 2', 'sdt phu'] },
  { key: 'phone3', label: 'SĐT 3', hints: ['sdt 3', 'so dien thoai 3', 'dien thoai 3'] },
  { key: 'phone', label: 'SĐT 1', hints: ['sdt 1', 'so dien thoai', 'dien thoai', 'sdt', 'dt', 'phone'] },
  { key: 'email', label: 'Email', hints: ['email', 'thu dien tu'] },
  { key: 'address', label: 'Địa chỉ', hints: ['dia chi', 'address'] },
  { key: 'tax_code', label: 'Mã số thuế', hints: ['ma so thue', 'mst'] },
  { key: 'birthday', label: 'Ngày sinh', hints: ['ngay sinh', 'sinh nhat'] },
  { key: 'customer_type', label: 'Loại khách', hints: ['loai khach', 'nhom khach', 'loai'] },
  { key: 'debt_limit', label: 'Hạn mức nợ', hints: ['han muc no', 'han muc'] },
  { key: 'max_debt_days', label: 'Số ngày nợ tối đa', hints: ['so ngay no', 'ngay no toi da'] },
  { key: 'note', label: 'Ghi chú', hints: ['ghi chu', 'note'] },
];

export const SUPPLIER_FIELDS = [
  { key: 'code', label: 'Mã NCC', hints: ['ma nha cung cap', 'ma ncc', 'ma'] },
  { key: 'contact_name', label: 'Người liên hệ', hints: ['nguoi lien he', 'lien he'] },
  { key: 'name', label: 'Tên nhà cung cấp', hints: ['ten nha cung cap', 'ten ncc', 'nha cung cap', 'ten'], required: true },
  { key: 'phone', label: 'Điện thoại', hints: ['so dien thoai', 'dien thoai', 'sdt', 'dt', 'phone'] },
  { key: 'email', label: 'Email', hints: ['email'] },
  { key: 'address', label: 'Địa chỉ', hints: ['dia chi'] },
  { key: 'tax_code', label: 'Mã số thuế', hints: ['ma so thue', 'mst'] },
  { key: 'account_no', label: 'Số tài khoản', hints: ['so tai khoan', 'so tk', 'stk', 'tai khoan'] },
  { key: 'bank_name', label: 'Ngân hàng', hints: ['ngan hang', 'bank'] },
  { key: 'term_days', label: 'Số ngày được nợ', hints: ['so ngay duoc no', 'ngay duoc no', 'han tra', 'so ngay no'] },
  { key: 'note', label: 'Ghi chú', hints: ['ghi chu'] },
];

/** Cột nợ đầu kỳ có mặt trong file không — để báo là cột đó bị bỏ qua. */
export function hasDebtColumn(header) {
  return header.some((h) => /(^|\s)no (dau ky|cu|ton)|cong no|so no/.test(noAccent(String(h ?? ''))));
}
