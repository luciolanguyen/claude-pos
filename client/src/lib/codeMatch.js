/* ====================================================================
   TRA HÀNG THEO MÃ QUÉT (plan 30, H4)

   Một mặt hàng có thể mang nhiều mã: mã vạch của hàng, mã vạch riêng của
   từng đơn vị tính (tem dán cuộn, dán thùng), và mã hàng SKU (tem cũ in bằng
   SKU vẫn đang dán ngoài tiệm). Thứ tự tra giữ đúng như plan: mã hàng hoá →
   mã đơn vị → SKU — SKU xếp cuối để không phá tem SKU đang dùng.

   Dùng chung cho mọi ô quét / ô tìm: màn hình bán hàng, hộp chọn hàng phiếu
   nhập / đơn đặt, đổi trả, linh kiện bảo hành.
   ==================================================================== */

const units = (p) => (Array.isArray(p?.units) ? p.units : []);

/**
 * Món mang ĐÚNG mã này. Trả về { product, unit } — unit là đơn vị tính có mã
 * riêng trùng mã quét (null nếu khớp mã hàng / SKU, tức dùng đơn vị mặc định).
 */
export function findByCode(products, term) {
  const code = String(term ?? '').trim();
  if (!code || !Array.isArray(products)) return null;
  const byProduct = products.find((p) => p.barcode === code);
  if (byProduct) return { product: byProduct, unit: null };
  for (const p of products) {
    const u = units(p).find((x) => x.barcode === code && x.active !== 0);
    if (u) return { product: p, unit: u };
  }
  const lower = code.toLowerCase();
  const bySku = products.find((p) => String(p.sku || '').toLowerCase() === lower);
  return bySku ? { product: bySku, unit: null } : null;
}

/** Mã vạch của hàng hoặc của một đơn vị nào đó trùng khít chuỗi này. */
export const barcodeEquals = (p, term) => {
  const code = String(term ?? '').trim();
  if (!code) return false;
  return p?.barcode === code || units(p).some((u) => u.barcode === code);
};

/** Mã vạch của hàng hoặc của một đơn vị nào đó có chứa chuỗi này. */
export const barcodeIncludes = (p, term) => {
  const code = String(term ?? '').trim();
  if (!code) return false;
  return String(p?.barcode || '').includes(code) || units(p).some((u) => String(u.barcode || '').includes(code));
};

/** Mã in lên tem cho một đơn vị: mã riêng của đơn vị → mã hàng → SKU (plan 30, §8.1). */
export const labelCodeOf = (p, unit) => String(unit?.barcode || p?.barcode || p?.sku || '').trim();
