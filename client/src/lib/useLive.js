import { useEffect, useRef } from 'react';

/**
 * Tự tải lại dữ liệu khi màn hình được nhìn tới: bấm vào cửa sổ, quay lại
 * thẻ trình duyệt, và định kỳ trong lúc đang mở. Thu ngân bán nợ ở quầy xong
 * thì máy quản trị đang mở hồ sơ khách thấy ngay số nợ mới (tài liệu 08),
 * không phải bấm tải lại trang.
 *
 * Thẻ đang ẩn thì không gọi máy chủ. Focus và visibilitychange hay bắn liền
 * nhau nên gộp lại, cách nhau dưới 1,5 giây thì chỉ tải một lần.
 */
/**
 * Nghe thay đổi do chính máy này vừa gây ra: lưu đơn đặt, giao hàng, huỷ đơn...
 * `match` là mảng chuỗi con của đường dẫn API cần theo dõi.
 */
export function useChangeReload(reload, match = [], { enabled = true } = {}) {
  const ref = useRef(reload);
  ref.current = reload;
  const keys = match.join('|');
  useEffect(() => {
    if (!enabled) return undefined;
    const on = (e) => {
      const p = e.detail?.path || '';
      if (!keys || keys.split('|').some((k) => k && p.includes(k))) ref.current?.();
    };
    window.addEventListener('thpos:changed', on);
    return () => window.removeEventListener('thpos:changed', on);
  }, [keys, enabled]);
}

/**
 * Tới giờ thì nhắc một lần trong ngày (yêu cầu 28/09, phần III.1).
 *
 * Dùng cho popup chấm công đầu ca 7h30 và bảng giờ tan làm buổi chiều. Nhắc rồi
 * mà tắt đi thì thôi, hôm sau mới nhắc lại — mốc "đã nhắc" ghi vào localStorage
 * theo ngày, y như cách chuông đơn đặt nhớ "đã xem tới đơn nào".
 *
 * Mở phần mềm sau giờ đó (mở quán muộn, mới bật máy) thì vẫn nhắc ngay, vì việc
 * cần làm là chấm công chứ không phải đúng khắc 7h30.
 *
 * @param hhmm   mốc giờ "07:30"
 * @param key    tên chỗ nhớ, ví dụ 'thpos.attendance.morning'
 * @param onFire gọi khi tới giờ mà hôm nay chưa nhắc
 */
export function useDailyPrompt(hhmm, key, onFire, { enabled = true } = {}) {
  const ref = useRef(onFire);
  ref.current = onFire;
  useEffect(() => {
    if (!enabled || !hhmm) return undefined;
    const today = () => new Date().toLocaleDateString('sv-SE');
    const seen = () => {
      try { return localStorage.getItem(key) === today(); } catch { return false; }
    };
    const check = () => {
      if (document.visibilityState !== 'visible' || seen()) return;
      const now = new Date();
      const [h, m] = String(hhmm).split(':').map(Number);
      if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;
      try { localStorage.setItem(key, today()); } catch { /* trình duyệt chặn thì nhắc lại lần sau */ }
      ref.current?.();
    };
    check();
    const timer = setInterval(check, 60000);
    window.addEventListener('focus', check);
    return () => { clearInterval(timer); window.removeEventListener('focus', check); };
  }, [hhmm, key, enabled]);
}

export function useLiveReload(reload, { interval = 30000, enabled = true } = {}) {
  const ref = useRef(reload);
  ref.current = reload;

  useEffect(() => {
    if (!enabled) return undefined;
    let last = Date.now();
    const fire = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - last < 1500) return;
      last = Date.now();
      ref.current?.();
    };
    window.addEventListener('focus', fire);
    document.addEventListener('visibilitychange', fire);
    const timer = interval > 0 ? setInterval(fire, interval) : null;
    return () => {
      window.removeEventListener('focus', fire);
      document.removeEventListener('visibilitychange', fire);
      if (timer) clearInterval(timer);
    };
  }, [interval, enabled]);
}
