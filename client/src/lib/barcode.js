/**
 * Sinh mã vạch Code 128 dạng SVG, viết thuần JavaScript.
 *
 * Phần mềm chạy trong mạng nội bộ của tiệm, có thể không có Internet,
 * nên không dùng thư viện tải từ mạng. Code 128 là chuẩn phổ biến nhất
 * cho tem hàng hoá, mọi máy quét đều đọc được.
 */

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
function encode(text) {
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

/**
 * Trả về chuỗi SVG của mã vạch, hoặc null nếu chuỗi không mã hoá được.
 * @param {string} text     nội dung mã vạch
 * @param {object} opt      { width: bề rộng 1 mô-đun (px), height, showText, fontSize }
 */
export function barcodeSvg(text, opt = {}) {
  const codes = encode(text);
  if (!codes) return null;

  const mod = opt.width ?? 1.6;         // bề rộng 1 mô-đun
  const barHeight = opt.height ?? 40;
  const showText = opt.showText !== false;
  const fontSize = opt.fontSize ?? 10;
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
    ? `<text x="${(totalW / 2).toFixed(2)}" y="${totalH - 1}" text-anchor="middle" ` +
      `font-family="Roboto Mono, Consolas, monospace" font-size="${fontSize}" ` +
      `letter-spacing="0.5">${escapeXml(String(text))}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW.toFixed(2)}" height="${totalH}" ` +
    `viewBox="0 0 ${totalW.toFixed(2)} ${totalH}" shape-rendering="crispEdges">` +
    `<rect width="100%" height="100%" fill="#fff"/>` +
    `<g fill="#000">${bars.join('')}</g>${label}</svg>`;
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
