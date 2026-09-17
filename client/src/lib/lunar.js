/* ====================================================================
   LỊCH ÂM VIỆT NAM VÀ KỲ LƯƠNG GỐI ĐẦU (plan 28, §3)

   Thuật toán của Hồ Ngọc Đức (bản "amlich" quen thuộc ở Việt Nam), tính
   theo múi giờ +7. KHÔNG dùng thư viện lịch Âm Trung Quốc: Trung Quốc tính
   theo +8, khi điểm sóc rơi gần nửa đêm hai lịch lệch nhau một ngày — kéo
   theo tháng đủ / thiếu và cả ngày Tết lệch (Tết 2007: VN 17/2, TQ 18/2).
   Lệch một ngày là lệch đúng chỗ tiền lương.

   Dùng chung cho máy chủ và trình duyệt, không phụ thuộc gói ngoài.
   Ngày Dương đi vào / đi ra dạng chuỗi 'YYYY-MM-DD'.
   ==================================================================== */

const TZ = 7;
const INT = Math.floor;
const PI = Math.PI;

export function jdFromDate(dd, mm, yy) {
  const a = INT((14 - mm) / 12);
  const y = yy + 4800 - a;
  const m = mm + 12 * a - 3;
  let jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
  if (jd < 2299161) jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083;
  return jd;
}

export function jdToDate(jd) {
  let b;
  let c;
  if (jd > 2299160) {
    const a = jd + 32044;
    b = INT((4 * a + 3) / 146097);
    c = a - INT((b * 146097) / 4);
  } else {
    b = 0;
    c = jd + 32082;
  }
  const d = INT((4 * c + 3) / 1461);
  const e = c - INT((1461 * d) / 4);
  const m = INT((5 * e + 2) / 153);
  const day = e - INT((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * INT(m / 10);
  const year = b * 100 + d - 4800 + INT(m / 10);
  return [day, month, year];
}

function newMoon(k) {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const dr = PI / 180;
  let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  Jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
  C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
  C1 -= 0.0004 * Math.sin(dr * 3 * Mpr);
  C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
  C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
  C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
  C1 = C1 + 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  const deltat = T < -11
    ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3
    : -0.000278 + 0.000265 * T + 0.000262 * T2;
  return Jd1 + C1 - deltat;
}

function sunLongitude(jdn) {
  const T = (jdn - 2451545.0) / 36525;
  const T2 = T * T;
  const dr = PI / 180;
  const M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
  DL = DL + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
  let L = (L0 + DL) * dr;
  L -= PI * 2 * INT(L / (PI * 2));
  return L;
}

const sunLongSector = (dayNumber) => INT(sunLongitude(dayNumber - 0.5 - TZ / 24) / PI * 6);

/** Ngày (số Julius) của lần sóc thứ k — cũng là mùng 1 của một tháng Âm. */
const cacheNM = new Map();
export function newMoonDay(k) {
  let v = cacheNM.get(k);
  if (v === undefined) {
    v = INT(newMoon(k) + 0.5 + TZ / 24);
    cacheNM.set(k, v);
  }
  return v;
}

function lunarMonth11(yy) {
  const off = jdFromDate(31, 12, yy) - 2415021;
  const k = INT(off / 29.530588853);
  let nm = newMoonDay(k);
  if (sunLongSector(nm) >= 9) nm = newMoonDay(k - 1);
  return nm;
}

function leapMonthOffset(a11) {
  const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last;
  let i = 1;
  let arc = sunLongSector(newMoonDay(k + i));
  do {
    last = arc;
    i += 1;
    arc = sunLongSector(newMoonDay(k + i));
  } while (arc !== last && i < 14);
  return i - 1;
}

/* ------------------------------------------------------------------ */
/* Dương ⇄ Âm                                                          */
/* ------------------------------------------------------------------ */

export function isoToJd(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return jdFromDate(d, m, y);
}

export function jdToIso(jd) {
  const [d, m, y] = jdToDate(jd);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const addDays = (iso, n) => jdToIso(isoToJd(iso) + n);
export const daysBetween = (a, b) => isoToJd(b) - isoToJd(a);

/** Chỉ số k của tháng Âm chứa ngày jd: newMoonDay(k) ≤ jd < newMoonDay(k+1). */
export function monthIndexOf(jd) {
  const k = INT((jd - 2415021.076998695) / 29.530588853);
  return newMoonDay(k + 1) <= jd ? k + 1 : k;
}

/** Đổi ngày Dương sang Âm: { day, month, year, leap } */
export function solarToLunar(iso) {
  const [yy] = String(iso).slice(0, 10).split('-').map(Number);
  const dayNumber = isoToJd(iso);
  const monthStart = newMoonDay(monthIndexOf(dayNumber));
  let a11 = lunarMonth11(yy);
  let b11 = a11;
  let lunarYear;
  if (a11 >= monthStart) {
    lunarYear = yy;
    a11 = lunarMonth11(yy - 1);
  } else {
    lunarYear = yy + 1;
    b11 = lunarMonth11(yy + 1);
  }
  const day = dayNumber - monthStart + 1;
  const diff = INT((monthStart - a11) / 29);
  let leap = 0;
  let month = diff + 11;
  if (b11 - a11 > 365) {
    const leapDiff = leapMonthOffset(a11);
    if (diff >= leapDiff) {
      month = diff + 10;
      if (diff === leapDiff) leap = 1;
    }
  }
  if (month > 12) month -= 12;
  if (month >= 11 && diff < 4) lunarYear -= 1;
  return { day, month, year: lunarYear, leap };
}

/** Đổi ngày Âm sang Dương. Tháng nhuận không có trong năm đó thì trả null. */
export function lunarToSolar(day, month, year, leap = 0) {
  let a11;
  let b11;
  if (month < 11) {
    a11 = lunarMonth11(year - 1);
    b11 = lunarMonth11(year);
  } else {
    a11 = lunarMonth11(year);
    b11 = lunarMonth11(year + 1);
  }
  const k = INT(0.5 + (a11 - 2415021.076998695) / 29.530588853);
  let off = month - 11;
  if (off < 0) off += 12;
  if (b11 - a11 > 365) {
    const leapOff = leapMonthOffset(a11);
    let leapMonth = leapOff - 2;
    if (leapMonth < 0) leapMonth += 12;
    if (leap && month !== leapMonth) return null;
    if (leap || off >= leapOff) off += 1;
  } else if (leap) {
    return null;
  }
  const monthStart = newMoonDay(k + off);
  return jdToIso(monthStart + day - 1);
}

/** Số ngày của tháng Âm chứa ngày này: 29 (tháng thiếu) hoặc 30 (tháng đủ). */
export function lunarMonthLength(iso) {
  const k = monthIndexOf(isoToJd(iso));
  return newMoonDay(k + 1) - newMoonDay(k);
}

const pad2 = (v) => String(v).padStart(2, '0');

/** '06/07' hoặc '06/04N' (N = nhuận) — kèm năm nếu cần. */
export function lunarText(l, withYear = false) {
  if (!l) return '';
  return `${pad2(l.day)}/${pad2(l.month)}${l.leap ? 'N' : ''}${withYear ? `/${l.year}` : ''}`;
}

/** 'tháng 4 nhuận' / 'tháng Chạp' — tên tháng như người Việt vẫn gọi. */
export function lunarMonthName(month, leap) {
  const name = month === 1 ? 'Giêng' : month === 12 ? 'Chạp' : String(month);
  return `tháng ${name}${leap ? ' nhuận' : ''}`;
}

const CAN = ['Canh', 'Tân', 'Nhâm', 'Quý', 'Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ'];
const CHI = ['Thân', 'Dậu', 'Tuất', 'Hợi', 'Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi'];
/** Tên năm Âm lịch theo can chi: 2026 → 'Bính Ngọ'. */
export const canChi = (year) => `${CAN[year % 10]} ${CHI[year % 12]}`;

/** Ngày Tết (mùng 1 tháng Giêng) của năm Âm lịch. */
export const tetOf = (year) => lunarToSolar(1, 1, year, 0);

/** Một năm Âm lịch trọn vẹn: từ mùng 1 Tết tới hết ngày 30 (29) tháng Chạp. Có thể 13 tháng. */
export function lunarYearRange(year) {
  const from = tetOf(year);
  const to = addDays(tetOf(year + 1), -1);
  const months = monthIndexOf(isoToJd(tetOf(year + 1))) - monthIndexOf(isoToJd(from));
  return { year, from, to, months, days: daysBetween(from, to) + 1 };
}

/* ------------------------------------------------------------------ */
/* Kỳ lương gối đầu (plan 28, §3.2, §3.3)                               */
/*                                                                     */
/* Neo = ngày Âm vào làm (1..30). Kỳ lương của tháng Âm m bắt đầu ngày  */
/* neo của tháng m và kết thúc trước ngày neo của tháng sau.             */
/*                                                                     */
/* Tháng không có ngày neo (neo 30, tháng thiếu 29 ngày): mốc dời sang  */
/* mùng 1 tháng kế — chủ tiệm chốt (28-2): kỳ trước kết thúc ngày 29,    */
/* kỳ sau bắt đầu mùng 1. Không bao giờ mất ngày, không bao giờ chồng.   */
/*                                                                     */
/* Tháng nhuận là một tháng bình thường — một kỳ lương riêng (b1).      */
/* Kỳ tròn luôn dài 29 hoặc 30 ngày.                                   */
/* ------------------------------------------------------------------ */

/** Ngày bắt đầu (số Julius) kỳ lương của tháng Âm chỉ số k với ngày neo. */
export function cycleBoundary(k, anchor) {
  const start = newMoonDay(k);
  const len = newMoonDay(k + 1) - start;
  return anchor <= len ? start + anchor - 1 : newMoonDay(k + 1);
}

function describeCycle(k, anchor) {
  const fromJd = cycleBoundary(k, anchor);
  const toJd = cycleBoundary(k + 1, anchor) - 1;
  const nominal = solarToLunar(jdToIso(newMoonDay(k)));
  const from = jdToIso(fromJd);
  const to = jdToIso(toJd);
  return {
    month_index: k,
    lunar_month: nominal.month,
    lunar_year: nominal.year,
    lunar_leap: nominal.leap,
    label: `${lunarMonthName(nominal.month, nominal.leap)} năm ${nominal.year}`,
    date_from: from,
    date_to: to,
    lunar_from: lunarText(solarToLunar(from), true),
    lunar_to: lunarText(solarToLunar(to), true),
    days: toJd - fromJd + 1,
  };
}

/** Kỳ lương (theo ngày neo) chứa một ngày Dương. */
export function cycleContaining(iso, anchor) {
  const a = Math.min(30, Math.max(1, Math.round(Number(anchor) || 1)));
  const jd = isoToJd(iso);
  const m = monthIndexOf(jd);
  const k = cycleBoundary(m, a) <= jd ? m : m - 1;
  return describeCycle(k, a);
}

/** Kỳ lương liền sau kỳ đang có (nối tiếp từ ngày kết thúc, không tính lại mốc cũ). */
export function cycleAfter(dateTo, anchor) {
  return cycleContaining(addDays(dateTo, 1), anchor);
}
