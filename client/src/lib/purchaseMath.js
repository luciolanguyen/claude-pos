/* ====================================================================
   TIỀN VÀ GIÁ VỐN CỦA MỘT PHIẾU NHẬP (plan 31, hạng mục 5.1d)

   Dùng chung một file cho máy chủ (lúc lưu phiếu) và màn hình (xem trước giá
   vốn từng dòng trước khi lưu) — hai nơi tính một công thức thì không bao giờ
   vênh nhau. File thuần, không import gì.

   Hai cách NCC tính chiết khấu cả phiếu:
     after_vat   (như xưa nay) thuế tính trên tiền hàng, rồi mới trừ chiết khấu
     before_vat  trừ chiết khấu trước, thuế tính trên phần còn lại

   Tính VAT vào giá vốn (hộ kinh doanh không khấu trừ thuế, giá vốn là tiền
   thật bỏ ra): giá vốn mỗi dòng = tiền hàng − phần chiết khấu + thuế của dòng
   + phần chi phí khác. Không tích thì giá vốn như xưa: tiền hàng + chi phí khác.
   ==================================================================== */

const r = (v) => Math.round(Number(v) || 0);

/**
 * @param head    { discount, other_cost, vat_in_cost, discount_mode }
 * @param items   [{ qty, factor, price, discount, vat_rate }] — price là giá sau chiết khấu %
 * @param custom  [{ qty, price }] — hàng giao sai: tính tiền, không thuế, không vào kho
 */
export function purchaseMath(head, items, custom = []) {
  const vatInCost = head?.vat_in_cost === true || head?.vat_in_cost === 1;
  const discountMode = head?.discount_mode === 'before_vat' ? 'before_vat' : 'after_vat';
  const discount = r(head?.discount);
  const otherCost = r(head?.other_cost);

  const lines = items.map((it) => {
    const qty = Number(it.qty) || 0;
    const factor = Number(it.factor) || 1;
    return {
      qty, factor, qtyBase: qty * factor,
      amount: Math.round(qty * r(it.price) - r(it.discount)),
      rate: Number(it.vat_rate) || 0,
    };
  });
  const customTotal = custom.reduce((a, c) => a + Math.round((Number(c.qty) || 0) * r(c.price)), 0);
  const stockSubtotal = lines.reduce((a, l) => a + l.amount, 0);
  const subtotal = stockSubtotal + customTotal;

  if (discountMode === 'before_vat') {
    /* Chiết khấu chia theo tiền hàng (kể cả hàng giao sai), thuế tính trên phần còn lại */
    for (const l of lines) {
      l.discountShare = subtotal > 0 ? discount * l.amount / subtotal : 0;
      l.vat = Math.round((l.amount - l.discountShare) * l.rate / 100);
    }
  } else {
    for (const l of lines) l.vat = Math.round(l.amount * l.rate / 100);
    /* Chiết khấu trừ sau thuế: chia theo tiền đã gồm thuế */
    const gross = lines.reduce((a, l) => a + l.amount + l.vat, 0) + customTotal;
    for (const l of lines) l.discountShare = gross > 0 ? discount * (l.amount + l.vat) / gross : 0;
  }
  const vatAmount = lines.reduce((a, l) => a + l.vat, 0);
  const total = subtotal - discount + vatAmount + otherCost;

  for (const l of lines) {
    /* Chi phí khác chỉ phân bổ vào hàng thật sự vào kho */
    l.otherShare = stockSubtotal > 0 ? (l.amount / stockSubtotal) * otherCost : 0;
    const costTotal = vatInCost
      ? l.amount - l.discountShare + l.vat + l.otherShare
      : l.amount + l.otherShare;
    l.unitCost = l.qtyBase > 0 ? Math.round(costTotal / l.qtyBase) : 0;
    l.discountShare = Math.round(l.discountShare);
    l.otherShare = Math.round(l.otherShare);
  }

  return { vatInCost, discountMode, discount, otherCost, lines, stockSubtotal, customTotal, subtotal, vatAmount, total };
}
