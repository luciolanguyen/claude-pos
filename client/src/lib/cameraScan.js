/* ====================================================================
   QUÉT MÃ VẠCH BẰNG CAMERA ĐIỆN THOẠI (plan 31, hạng mục 2b)

   Điện thoại là MỘT MÁY BÁN HÀNG ĐỘC LẬP: quét ra hàng nào thì vào giỏ
   của chính điện thoại đó, không đẩy mã sang máy tính thu ngân.

   Bộ đọc mã:
   - Chrome trên Android có sẵn BarcodeDetector (nhờ Google Play) — nhanh,
     không tải thêm gì.
   - iPhone, máy Android không có dịch vụ Google: nạp bộ đọc ZXing chạy
     bằng WebAssembly. Tệp .wasm (~1 MB) đóng gói cùng phần mềm, tải từ
     chính máy chủ tiệm — không gọi ra Internet, và chỉ tải khi mở camera
     lần đầu trên máy thiếu bộ đọc sẵn.
   ==================================================================== */

/* Mã một chiều trên bao bì + tem tiệm tự in (Code 128) + QR */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93',
  'codabar', 'itf', 'qr_code', 'data_matrix'];

/* Các loại mã có số kiểm tra bắt buộc: đọc một khung là tin được. Loại
   còn lại (Code 39, Codabar, ITF) dễ đọc sai một vạch, đòi hai khung liền
   nhau ra cùng một chuỗi mới nhận. */
const CHECKSUMMED = new Set(['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_93', 'qr_code', 'data_matrix']);

/**
 * Bộ lọc quyết định khung hình nào thì NHẬN một mã. Tách khỏi phần camera
 * để soát được bằng kiểm thử, khỏi cần camera thật.
 *
 * Luật:
 * - Mã vừa nhận mà vẫn nằm trong khung thì bỏ qua. Phải rời khung quá
 *   `holdGap` mili giây rồi quay lại mới tính thêm một món — cầm máy yên
 *   trên một món không bị cộng dồn.
 * - Nhớ TỪNG mã đã nhận, không chỉ mã mới nhất: khung có hai mã cùng lúc
 *   (hộp in hai mã, hai món sát nhau) mà chỉ nhớ một thì hai món thay phiên
 *   nhau được cộng mãi.
 * - Mỗi khung nhận tối đa một mã; mã thứ hai (nếu có) được nhận ở khung sau.
 *
 * @returns (codes: [{ value, format }], now: ms) => chuỗi mã được nhận | null
 */
export function createScanGate({ holdGap = 900, confirmGap = 800 } = {}) {
  const held = new Map();                    // mã đã nhận → lần cuối còn thấy
  const pending = { code: '', at: 0 };       // mã không số kiểm tra, chờ khung sau
  return (codes, now) => {
    for (const [code, seenAt] of held) {
      if (now - seenAt > holdGap) held.delete(code);
    }
    let next = null;
    for (const c of codes) {
      if (!c?.value) continue;
      if (held.has(c.value)) held.set(c.value, now);
      else if (!next) next = c;
    }
    if (!next) return null;
    const confirmed = CHECKSUMMED.has(next.format)
      || (pending.code === next.value && now - pending.at < confirmGap);
    if (!confirmed) {
      pending.code = next.value;
      pending.at = now;
      return null;
    }
    pending.code = '';
    held.set(next.value, now);
    return next.value;
  };
}

/**
 * Vì sao camera không mở được trên máy này, hoặc '' nếu mở được.
 * - 'insecure':    vào bằng http://192.168.x.x — trình duyệt cấm camera
 * - 'unsupported': trình duyệt quá cũ, không có getUserMedia
 */
export function cameraBlockedReason() {
  if (typeof window === 'undefined') return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  return '';
}

/** Máy cảm ứng (điện thoại, máy tính bảng) — nơi nút camera có ích. */
export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  return (window.matchMedia?.('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
}

let pending = null;

/** Bộ đọc mã dùng chung cho cả phiên, tạo một lần. */
export function getDetector() {
  if (!pending) {
    pending = loadDetector().catch((e) => { pending = null; throw e; });
  }
  return pending;
}

async function loadDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const have = await window.BarcodeDetector.getSupportedFormats();
      const formats = FORMATS.filter((f) => have.includes(f));
      /* Có dịch vụ nhưng thiếu Code 128 thì không đọc được tem tiệm tự in */
      if (formats.includes('code_128')) {
        return { detector: new window.BarcodeDetector({ formats }), engine: 'native' };
      }
    } catch { /* rơi xuống bộ đọc dự phòng */ }
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]);
  /* Mặc định thư viện tải .wasm từ CDN ngoài Internet — chỉ về máy chủ tiệm */
  prepareZXingModule({
    overrides: { locateFile: (file, prefix) => (file.endsWith('.wasm') ? wasmUrl : prefix + file) },
    fireImmediately: true,
  });
  return { detector: new BarcodeDetector({ formats: FORMATS }), engine: 'zxing' };
}

/** Câu báo lỗi dễ hiểu cho từng kiểu lỗi mở camera. */
export function cameraErrorText(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Chưa cho phép dùng camera. Bấm biểu tượng bên trái thanh địa chỉ → Quyền → Camera → Cho phép, rồi bấm Thử lại.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Không tìm thấy camera trên máy này.';
    case 'NotReadableError':
    case 'AbortError':
      return 'Camera đang bị ứng dụng khác dùng. Tắt ứng dụng đó rồi bấm Thử lại.';
    default:
      return `Không mở được camera${err?.message ? `: ${err.message}` : ''}.`;
  }
}

/* --------------------------- Tiếng bíp và rung --------------------------- */

let audio = null;
/** Tiếng bíp ngắn: cao là khớp, trầm là không có hàng. */
export function beep(good = true) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'square';
    o.frequency.value = good ? 1750 : 320;
    g.gain.setValueAtTime(0.06, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + (good ? 0.09 : 0.22));
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + (good ? 0.1 : 0.24));
  } catch { /* máy không phát được tiếng thì thôi */ }
}

export function buzz(good = true) {
  try { navigator.vibrate?.(good ? 40 : [70, 50, 70]); } catch { /* không rung được */ }
}

/**
 * Trình duyệt chỉ cho phát tiếng sau một cú chạm của người dùng. Gọi hàm
 * này ngay trong lúc bấm nút camera để tiếng bíp về sau kêu được.
 */
export function primeAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { /* máy không có loa thì thôi */ }
}
