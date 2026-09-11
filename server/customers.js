/* ====================================================================
   SỐ LIỆU PHỤ CỦA HỒ SƠ KHÁCH HÀNG

   Người mua hộ quen của một khách chủ, và thống kê một người đã đi mua hộ
   cho người khác. Dùng chung cho hồ sơ khách ở trang quản lý (tài liệu 08)
   và ô người mua hộ trên màn hình bán hàng (tài liệu 03), để hai chỗ luôn
   ra cùng một con số.
   ==================================================================== */
import { all, get } from './db.js';

/** Những người từng đi mua hộ cho khách chủ này, hay đi nhất lên đầu. */
export function customerBuyers(customerId, limit = 10) {
  return all(`
    SELECT s.buyer_id,
           COALESCE(b.name, s.buyer_name) AS name,
           COALESCE(b.phone, s.buyer_phone) AS phone,
           COUNT(*) AS times,
           COALESCE(SUM(s.total), 0) AS total,
           MAX(s.ts) AS last_ts
    FROM sales s
    LEFT JOIN customers b ON b.id = s.buyer_id
    WHERE s.customer_id = ? AND s.status = 'done'
      AND (s.buyer_id IS NOT NULL
           OR COALESCE(s.buyer_name, '') <> '' OR COALESCE(s.buyer_phone, '') <> '')
    GROUP BY COALESCE(CAST(s.buyer_id AS TEXT),
                      'x:' || COALESCE(s.buyer_phone, '') || ':' || COALESCE(s.buyer_name, ''))
    ORDER BY times DESC, last_ts DESC
    LIMIT ${Math.max(1, Math.min(Number(limit) || 10, 100))}`, [customerId]);
}

/**
 * Một người đã đi mua hộ bao nhiêu lần, cho bao nhiêu khách, tổng bao
 * nhiêu tiền. Doanh số vẫn tính cho khách chủ — đây chỉ là thống kê riêng.
 */
export function proxyStats(customerId) {
  const id = Number(customerId);
  return get(`
    SELECT COUNT(*) AS times,
           COALESCE(SUM(total), 0) AS total,
           COUNT(DISTINCT customer_id) AS for_customers,
           MAX(ts) AS last_ts
    FROM sales
    WHERE buyer_id = ? AND status = 'done'
      AND (customer_id IS NULL OR customer_id <> ?)`, [id, id]);
}
