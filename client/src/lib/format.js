/* Định dạng số liệu theo thói quen đọc của người Việt. */

const nf = new Intl.NumberFormat('vi-VN');

/** 1250000 -> "1.250.000" */
export const n = (v) => nf.format(Math.round(Number(v) || 0));

/** 1250000 -> "1.250.000 đ" */
export const money = (v) => n(v) + ' đ';

/** Rút gọn cho thẻ số liệu: 1.250.000 -> "1,25 tr" ; 1.5 tỷ -> "1,50 tỷ" */
export function short(v) {
  const x = Number(v) || 0;
  const a = Math.abs(x);
  const sign = x < 0 ? '-' : '';
  if (a >= 1e9) return sign + (a / 1e9).toFixed(2).replace('.', ',') + ' tỷ';
  if (a >= 1e6) return sign + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace('.', ',') + ' tr';
  if (a >= 1e3) return sign + Math.round(a / 1e3) + 'k';
  return sign + n(a);
}

/** Số lượng: bỏ ".0" thừa, giữ tối đa 2 số lẻ (dây điện cắt 12,5 m). */
export function qty(v) {
  const x = Number(v) || 0;
  return Number.isInteger(x) ? nf.format(x) : nf.format(Math.round(x * 100) / 100);
}

export const pct = (v, digits = 1) =>
  (Number(v) || 0).toFixed(digits).replace('.', ',') + '%';

/* ------------------------------ Ngày giờ ------------------------------ */

const pad = (x) => String(x).padStart(2, '0');

/** Chuỗi "2026-09-05 14:30:00" từ SQLite -> Date (giờ địa phương, không lệch múi giờ). */
export function toDate(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  const m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})[T ]?(\d{2})?:?(\d{2})?:?(\d{2})?/);
  if (!m) return new Date(ts);
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

/** "05/09/2026" */
export function date(ts) {
  const d = toDate(ts);
  return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : '';
}

/** "05/09/2026 14:30" */
export function datetime(ts) {
  const d = toDate(ts);
  return d ? `${date(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
}

/** "14:30" */
export function time(ts) {
  const d = toDate(ts);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
}

/** "Hôm nay 14:30" / "Hôm qua 09:15" / "05/09 14:30" */
export function smartTime(ts) {
  const d = toDate(ts);
  if (!d) return '';
  const now = new Date();
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (sameDay(d, now)) return `Hôm nay ${time(d)}`;
  if (sameDay(d, y)) return `Hôm qua ${time(d)}`;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${time(d)}`;
}

/** Date/chuỗi -> "YYYY-MM-DD" dùng cho input[type=date] và tham số API. */
export function isoDate(d = new Date()) {
  const x = d instanceof Date ? d : toDate(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

/** Các khoảng thời gian dựng sẵn cho bộ lọc báo cáo. */
export function range(key) {
  const now = new Date();
  const d = (n) => { const x = new Date(now); x.setDate(x.getDate() + n); return x; };
  switch (key) {
    case 'today': return { from: isoDate(now), to: isoDate(now), label: 'Hôm nay' };
    case 'yesterday': return { from: isoDate(d(-1)), to: isoDate(d(-1)), label: 'Hôm qua' };
    case 'week7': return { from: isoDate(d(-6)), to: isoDate(now), label: '7 ngày qua' };
    case 'day30': return { from: isoDate(d(-29)), to: isoDate(now), label: '30 ngày qua' };
    case 'month': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: isoDate(s), to: isoDate(now), label: 'Tháng này' };
    }
    case 'lastMonth': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: isoDate(s), to: isoDate(e), label: 'Tháng trước' };
    }
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3);
      const s = new Date(now.getFullYear(), q * 3, 1);
      return { from: isoDate(s), to: isoDate(now), label: 'Quý này' };
    }
    case 'year': {
      const s = new Date(now.getFullYear(), 0, 1);
      return { from: isoDate(s), to: isoDate(now), label: 'Năm nay' };
    }
    default: return { from: isoDate(d(-29)), to: isoDate(now), label: '30 ngày qua' };
  }
}

export const RANGES = [
  ['today', 'Hôm nay'], ['yesterday', 'Hôm qua'], ['week7', '7 ngày'],
  ['day30', '30 ngày'], ['month', 'Tháng này'], ['lastMonth', 'Tháng trước'],
  ['quarter', 'Quý này'], ['year', 'Năm nay'],
];

/* --------------------------- Nhãn nghiệp vụ --------------------------- */

export const PAYMENT_LABEL = {
  cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Quẹt thẻ',
  debt: 'Ghi nợ', mixed: 'Kết hợp', cod: 'Thu hộ COD',
};

/* Hai cách tính giá vốn. Nói bằng lời người bán hàng hiểu, không dùng
   thuật ngữ kế toán. */
export const COST_METHOD_LABEL = {
  average: 'Bình quân gia quyền',
  fixed: 'Cố định',
};

export const COST_METHOD_HINT = {
  average: 'Mỗi lần nhập hàng thì tính bình quân lại theo số đang tồn. '
    + 'Trả hàng cho mối thì rút phần đó ra. Hợp với hàng hay đổi giá.',
  fixed: 'Chốt một lần rồi thôi: lần nhập đầu tiên lấy luôn giá nhập làm giá vốn, '
    + 'sau đó giá nhập lên xuống cũng không đổi. Muốn đổi thì sửa tay.',
};

export const ROLE_LABEL = {
  owner: 'Chủ cửa hàng', manager: 'Quản lý',
  cashier: 'Thu ngân', stock: 'Nhân viên kho',
};

export const MOVE_LABEL = {
  opening: 'Tồn đầu kỳ', purchase: 'Nhập hàng', purchase_return: 'Trả NCC',
  sale: 'Bán hàng', sale_return: 'Khách trả', adjust: 'Điều chỉnh', transfer: 'Chuyển kho',
};

export const CASH_LABEL = {
  sale: 'Bán hàng', debt_in: 'Thu nợ khách', purchase: 'Mua hàng',
  debt_out: 'Trả nợ NCC', sale_return: 'Hoàn tiền khách', purchase_return: 'NCC hoàn tiền',
  salary: 'Lương nhân viên', rent: 'Thuê mặt bằng', utility: 'Điện nước internet',
  transport: 'Vận chuyển', tax: 'Thuế, lệ phí', capital_in: 'Góp vốn',
  capital_out: 'Rút vốn', transfer_in: 'Nhận chuyển quỹ', transfer_out: 'Chuyển quỹ đi',
  warranty_in: 'Thu sửa chữa / bảo hành', custom_parts_in: 'Doanh thu linh kiện ngoài hệ thống',
  other_in: 'Thu khác', other_out: 'Chi khác',
};

/** Đọc số tiền thành chữ — bắt buộc trên hoá đơn GTGT. */
export function readMoney(num) {
  const x = Math.round(Number(num) || 0);
  if (x === 0) return 'Không đồng';
  const ones = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

  function group(n3, full) {
    const tr = Math.floor(n3 / 100);
    const ch = Math.floor((n3 % 100) / 10);
    const dv = n3 % 10;
    let s = '';
    if (tr > 0 || full) s += ones[tr] + ' trăm';
    if (ch === 0) {
      if (dv > 0) s += (tr > 0 || full) ? ' linh ' + ones[dv] : ones[dv];
    } else if (ch === 1) {
      s += ' mười';
      if (dv === 5) s += ' lăm';
      else if (dv > 0) s += ' ' + ones[dv];
    } else {
      s += ' ' + ones[ch] + ' mươi';
      if (dv === 1) s += ' mốt';
      else if (dv === 5) s += ' lăm';
      else if (dv > 0) s += ' ' + ones[dv];
    }
    return s.trim();
  }

  const units = ['', ' nghìn', ' triệu', ' tỷ'];
  const parts = [];
  let rest = x;
  const chunks = [];
  while (rest > 0) { chunks.push(rest % 1000); rest = Math.floor(rest / 1000); }
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (chunks[i] === 0) continue;
    parts.push(group(chunks[i], i < chunks.length - 1) + units[i]);
  }
  const s = parts.join(' ').replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1) + ' đồng';
}

/** Bỏ dấu tiếng Việt để tìm kiếm gõ không dấu vẫn ra ("day dien" -> "dây điện"). */
export function noAccent(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Tìm kiếm mềm: khớp cả khi gõ không dấu, không phân biệt hoa thường. */
export function match(haystack, needle) {
  if (!needle) return true;
  return noAccent(haystack).includes(noAccent(needle));
}
