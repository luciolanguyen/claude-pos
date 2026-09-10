/**
 * Sinh mã vạch dạng SVG, viết thuần JavaScript.
 *
 * Phần mềm chạy trong mạng nội bộ của tiệm, có thể không có Internet, nên
 * không dùng thư viện tải từ mạng.
 *
 * Hai chuẩn:
 *   EAN-13   cho mã 13 chữ số hợp lệ — đây là mã in trên bao bì hàng hoá
 *            bán lẻ. Chỉ tốn 95 mô-đun.
 *   Code 128 cho mọi thứ còn lại (mã hàng có chữ, mã tự đặt).
 *            Mã 13 chữ số mà mã hoá Code 128 tốn tới 178 mô-đun — gần gấp
 *            đôi, và đó chính là lý do tem 35mm trước đây bị cắt cụt.
 */

/* ================== CODE 128 ================== */

/* 107 mẫu vạch của Code 128. Mỗi chuỗi 6 số là bề rộng lần lượt của
   vạch đen / vạch trắng, tổng luôn bằng 11 mô-đun. */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];

const START_B = 104;   // bộ ký tự B: chữ và số
const START_C = 105;   // bộ ký tự C: nén 2 chữ số vào 1 mã, tem gọn hơn
const STOP = 106;

/** Chuỗi toàn số và độ dài chẵn thì mã hoá Code C cho ngắn. */
function encode128(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;

  const useC = /^\d+$/.test(s) && s.length % 2 === 0 && s.length >= 4;
  const codes = [];

  if (useC) {
    codes.push(START_C);
    for (let i = 0; i < s.length; i += 2) codes.push(Number(s.slice(i, i + 2)));
  } else {
    codes.push(START_B);
    for (const ch of s) {
      const v = ch.charCodeAt(0);
      // Code 128B phủ ký tự ASCII in được từ dấu cách (32) tới ~ (126)
      if (v < 32 || v > 126) return null;
      codes.push(v - 32);
    }
  }

  // Ký tự kiểm tra: (mã bắt đầu + tổng mã × vị trí) chia dư 103
  let sum = codes[0];
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103);
  codes.push(STOP);

  return codes;
}

/** Số mô-đun của một mã Code 128 — để tính bề rộng trước khi vẽ. */
function modules128(text) {
  const codes = encode128(text);
  if (!codes) return null;
  // Mỗi ký tự 11 mô-đun, riêng mã STOP 13 mô-đun
  return (codes.length - 1) * 11 + 13;
}

/* ================== EAN-13 ================== */

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100'];

/* Chữ số đầu không có vạch riêng — nó nằm ở KIỂU đan xen L/G của 6 chữ
   số nửa trái. Đó là mẹo để nhét 13 chữ số vào chỗ của 12. */
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** Số kiểm tra đúng của 12 chữ số đầu. */
export function eanCheckDigit(first12) {
  const s = String(first12).slice(0, 12);
  if (!/^\d{12}$/.test(s)) return null;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** Chuỗi 13 chữ số này có phải EAN-13 hợp lệ không. */
export function isValidEan13(code) {
  const s = String(code ?? '').trim();
  if (!/^\d{13}$/.test(s)) return false;
  return eanCheckDigit(s) === Number(s[12]);
}

/**
 * Kiểm tra mã vạch và nói rõ vấn đề nếu có.
 * Dùng để cảnh báo trên màn hình in tem: mã 13 số mà sai số kiểm tra thì
 * máy quét ở siêu thị sẽ không đọc được, nhưng máy quét của tiệm thì có —
 * nên tiệm không tự phát hiện ra cho tới lúc bán buôn cho nơi khác.
 */
export function checkBarcode(code) {
  const s = String(code ?? '').trim();
  if (!s) return { ok: false, kind: null, reason: 'Chưa có mã vạch' };
  if (/^\d{13}$/.test(s)) {
    if (isValidEan13(s)) return { ok: true, kind: 'ean13' };
    return {
      ok: true,
      kind: 'code128',
      warn: 'sai_so_kiem_tra',
      suggest: s.slice(0, 12) + eanCheckDigit(s.slice(0, 12)),
      reason: 'Mã 13 chữ số nhưng số kiểm tra cuối không khớp, nên in theo chuẩn Code 128',
    };
  }
  return { ok: !!modules128(s), kind: 'code128' };
}

/** Vẽ nửa trái / nửa phải của EAN-13 thành chuỗi bit. */
function encodeEan13(code) {
  const s = String(code).trim();
  if (!isValidEan13(s)) return null;
  const parity = EAN_PARITY[Number(s[0])];
  let bits = '101';                                   // vạch bảo vệ đầu
  for (let i = 1; i <= 6; i++) {
    bits += (parity[i - 1] === 'L' ? EAN_L : EAN_G)[Number(s[i])];
  }
  bits += '01010';                                    // vạch bảo vệ giữa
  for (let i = 7; i <= 12; i++) bits += EAN_R[Number(s[i])];
  bits += '101';                                      // vạch bảo vệ cuối
  return bits;                                        // đúng 95 bit
}

/* ================== Vẽ SVG ================== */

/** Tổng số mô-đun (kể cả lề trắng) mà một mã cần. */
export function barcodeModules(text) {
  const s = String(text ?? '').trim();
  if (isValidEan13(s)) return 95 + 9 + 9;     // EAN-13 lề chuẩn 9 mô-đun mỗi bên
  const m = modules128(s);
  return m ? m + 10 + 10 : null;              // Code 128 lề chuẩn 10 mô-đun
}

/**
 * Bề rộng một mô-đun (mm) để mã vạch vừa đúng chỗ trống cho trước.
 *
 * Đây là chỗ đã hỏng trước đây: bề rộng mô-đun bị đặt cứng theo khổ tem,
 * không nhìn tới độ dài mã. Mã 13 chữ số vẽ ra rộng 218px trong khi tem
 * 35mm chỉ còn 121px, nên bị `overflow: hidden` cắt cụt — nhìn ra thì
 * tưởng phần mềm ghi thiếu số.
 *
 * @param maxModule  trần bề rộng mô-đun, để mã ngắn khỏi bị kéo giãn quá cỡ
 */
export function fitModuleWidth(text, availableMm, maxModule = 0.4) {
  const mods = barcodeModules(text);
  if (!mods || !(availableMm > 0)) return null;
  const w = availableMm / mods;
  /* 0.19mm là ngưỡng dưới thực dụng cho máy in nhiệt 203dpi: mảnh hơn nữa
     thì một mô-đun không đủ một chấm mực, in ra máy quét đọc không nổi. */
  return { mm: Math.min(w, maxModule), tooNarrow: w < 0.19, needMm: mods * 0.19 };
}

/**
 * Trả về chuỗi SVG của mã vạch, hoặc null nếu không mã hoá được.
 *
 * @param {string} text  nội dung mã vạch
 * @param {object} opt   { width: bề rộng 1 mô-đun (px), height, showText, fontSize }
 */
export function barcodeSvg(text, opt = {}) {
  const s = String(text ?? '').trim();
  const mod = opt.width ?? 1.6;
  const barHeight = opt.height ?? 40;
  const showText = opt.showText !== false;
  const fontSize = opt.fontSize ?? 10;

  return isValidEan13(s)
    ? ean13Svg(s, { mod, barHeight, showText, fontSize })
    : code128Svg(s, { mod, barHeight, showText, fontSize });
}

function code128Svg(text, { mod, barHeight, showText, fontSize }) {
  const codes = encode128(text);
  if (!codes) return null;

  const quiet = 10 * mod;               // lề trắng hai bên, chuẩn yêu cầu ≥10 mô-đun
  const textGap = showText ? fontSize + 2 : 0;

  let x = quiet;
  const bars = [];
  for (const code of codes) {
    const pattern = PATTERNS[code];
    let isBar = true;
    for (const ch of pattern) {
      const w = Number(ch) * mod;
      if (isBar) bars.push(`<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${barHeight}"/>`);
      x += w;
      isBar = !isBar;
    }
  }

  const totalW = x + quiet;
  const totalH = barHeight + textGap;
  const label = showText
    ? `<text x="${(totalW / 2).toFixed(2)}" y="${totalH - 1}" text-anchor="middle" `
      + `font-family="Roboto Mono, Consolas, monospace" font-size="${fontSize}" `
      + `letter-spacing="0.5">${escapeXml(String(text))}</text>`
    : '';

  return wrap(totalW, totalH, bars.join(''), label);
}

/**
 * EAN-13 vẽ theo đúng kiểu quen mắt: chữ số đầu nằm ngoài bên trái, sáu
 * số dưới nửa trái, sáu số dưới nửa phải, và ba cặp vạch bảo vệ thò dài
 * xuống dưới. Máy quét không cần mấy con số đó, nhưng người bán hàng thì
 * cần — mã trên bao bì cũng in như vậy nên nhìn là đối chiếu được ngay.
 */
function ean13Svg(code, { mod, barHeight, showText, fontSize }) {
  const bits = encodeEan13(code);
  if (!bits) return null;

  const quiet = 9 * mod;
  /* Chữ số đầu in ở lề trái nên lề đó phải rộng thêm cho đủ chỗ */
  const leadW = showText ? Math.max(quiet, fontSize * 0.75) : quiet;
  const guardDrop = showText ? fontSize * 0.8 : 0;   // vạch bảo vệ thò xuống
  const textGap = showText ? fontSize + 2 : 0;

  /* Vạch nào là vạch bảo vệ: 3 đầu, 5 giữa, 3 cuối */
  const isGuard = (i) => i < 3 || (i >= 45 && i < 50) || i >= 92;

  const bars = [];
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== '1') continue;
    const h = barHeight + (isGuard(i) ? guardDrop : 0);
    bars.push(`<rect x="${(leadW + i * mod).toFixed(2)}" y="0" `
      + `width="${mod.toFixed(2)}" height="${h.toFixed(2)}"/>`);
  }

  const totalW = leadW + 95 * mod + quiet;
  const totalH = barHeight + guardDrop + textGap;
  const baseY = totalH - 1;

  let label = '';
  if (showText) {
    const font = `font-family="Roboto Mono, Consolas, monospace" font-size="${fontSize}"`;
    const txt = (x, anchor, str) =>
      `<text x="${x.toFixed(2)}" y="${baseY}" text-anchor="${anchor}" ${font}>${str}</text>`;
    /* Nửa trái: 6 số nằm giữa mô-đun 3..45; nửa phải: giữa mô-đun 50..92 */
    label = txt(leadW - mod * 1.5, 'end', code[0])
      + txt(leadW + (3 + 42 / 2) * mod, 'middle', code.slice(1, 7))
      + txt(leadW + (50 + 42 / 2) * mod, 'middle', code.slice(7));
  }

  return wrap(totalW, totalH, bars.join(''), label);
}

function wrap(w, h, bars, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(2)}" height="${h.toFixed(2)}" `
    + `viewBox="0 0 ${w.toFixed(2)} ${h.toFixed(2)}" shape-rendering="crispEdges">`
    + '<rect width="100%" height="100%" fill="#fff"/>'
    + `<g fill="#000">${bars}</g>${label}</svg>`;
}

/** Nhúng thẳng vào thẻ img mà không cần gọi mạng. */
export function barcodeDataUri(text, opt) {
  const svg = barcodeSvg(text, opt);
  return svg ? 'data:image/svg+xml;utf8,' + encodeURIComponent(svg) : null;
}

function escapeXml(s) {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

/* ------------------------------------------------------------------ */
/* Khổ tem thông dụng của máy in nhiệt bán ở Việt Nam                  */
/* ------------------------------------------------------------------ */

export const LABEL_SIZES = [
  { key: '35x22', name: '35 × 22 mm', w: 35, h: 22, perRow: 2, hint: 'Tem 2 tem/hàng — phổ biến nhất' },
  { key: '50x30', name: '50 × 30 mm', w: 50, h: 30, perRow: 1, hint: 'Tem 1 tem/hàng, chữ to dễ đọc' },
  { key: '40x30', name: '40 × 30 mm', w: 40, h: 30, perRow: 1, hint: 'Tem vuông, hợp hàng nhỏ' },
  { key: '30x20', name: '30 × 20 mm', w: 30, h: 20, perRow: 3, hint: 'Tem nhỏ 3 tem/hàng' },
  { key: '50x40', name: '50 × 40 mm', w: 50, h: 40, perRow: 1, hint: 'Tem lớn, đủ chỗ ghi thêm' },
];

export const getLabelSize = (key) =>
  LABEL_SIZES.find((s) => s.key === key) || LABEL_SIZES[0];
