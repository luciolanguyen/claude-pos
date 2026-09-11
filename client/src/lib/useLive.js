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
