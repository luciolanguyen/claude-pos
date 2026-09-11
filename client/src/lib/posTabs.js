/* ====================================================================
   ĐÁNH SỐ TAB ĐƠN HÀNG TRÊN MÀN HÌNH BÁN HÀNG (tài liệu 01)

   Tab tên "Đơn Hàng X". X là số tự nhiên NHỎ NHẤT chưa ai dùng — tính cả
   tab đang mở lẫn đơn đang nằm trong danh sách lưu tạm. Nhờ vậy số tab
   không phình lên 37, 38 sau một ngày bán, và thu ngân nói "đơn 3 của chị
   đang lưu tạm" thì không có hai đơn cùng số 3.

   Mấy hàm ở đây thuần tính toán, không đụng React, để soát cho dễ.
   ==================================================================== */

export const tabTitle = (no) => `Đơn Hàng ${no}`;

/**
 * Số của một tab. Tab lưu trên máy từ trước đợt 13 chưa có tabNo (tên kiểu
 * "Hoá đơn 2") thì đọc số ở cuối tên.
 */
export function tabNoOf(t) {
  if (Number(t?.tabNo) > 0) return Number(t.tabNo);
  const m = String(t?.title || '').match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

/** Số tự nhiên nhỏ nhất (bắt đầu từ 1) chưa nằm trong danh sách đã dùng. */
export function smallestFree(used) {
  const taken = new Set((used || []).map(Number).filter((x) => x > 0));
  let x = 1;
  while (taken.has(x)) x += 1;
  return x;
}

/**
 * Sửa lại số của các tab đọc từ máy: tab cũ chưa có số, hai tab trùng số.
 * Tab nào đang giữ số hợp lệ và không trùng thì giữ nguyên số đó; còn lại
 * cấp số nhỏ nhất còn trống.
 *
 * Không soát trùng với đơn lưu tạm: tab đang mở trùng số với một đơn lưu
 * tạm là chuyện được phép — tới lúc mở lại đơn đó mới xử lý (bước 2.2).
 *
 * Không có gì phải sửa thì trả về ĐÚNG mảng cũ, để chỗ gọi so sánh bằng ===
 * mà biết khỏi ghi lại.
 */
export function normalizeTabs(tabs) {
  const kept = new Set();
  const nos = tabs.map((t) => {
    const no = tabNoOf(t);
    if (no > 0 && !kept.has(no)) { kept.add(no); return no; }
    return 0;
  });

  let changed = false;
  const out = tabs.map((t, i) => {
    let no = nos[i];
    if (!no) { no = smallestFree([...kept]); kept.add(no); }
    const title = tabTitle(no);
    if (t.tabNo === no && t.title === title) return t;
    changed = true;
    return { ...t, tabNo: no, title };
  });
  return changed ? out : tabs;
}
