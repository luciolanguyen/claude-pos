/* ====================================================================
   SỐ TIỀN VỐN / LÃI CÓ MÃ HOÁ (tài liệu 24, phần 4)

   Bật "mã hoá giá vốn" ở Thiết lập thì mọi con số nói lên giá vốn trên màn
   hình bán hàng phải hiện bằng chữ cái: giá vốn, giá nhập gần nhất, và cả
   TIỀN LÃI — vì giá bán nằm ngay bên cạnh, khách lấy giá bán trừ tiền lãi là
   ra đúng giá vốn.

   Tiền lãi mã hoá bằng bộ mã giá vốn; giá nhập gần nhất dùng bộ mã riêng.
   ==================================================================== */
import { n, blindCode, DEFAULT_BLIND_KEY } from '../lib/format';

/** Bộ mã đang dùng, hoặc null nếu tiệm không bật mã hoá. */
export function blindKeysOf(settings) {
  if (settings?.pos?.blind_cost !== true) return null;
  return {
    cost: settings?.pos?.blind_key_cost || DEFAULT_BLIND_KEY,
    purchase: settings?.pos?.blind_key_purchase || 'SOBMANTỆIV',
  };
}

/**
 * Một số tiền liên quan giá vốn: mã hoá nếu có bộ mã, không thì số thường.
 * @param keyStr  chuỗi 10 ký tự, hoặc null để hiện số
 * @param format  cách in số khi không mã hoá (mặc định n: 1.234.000)
 */
export default function BlindCost({ value, keyStr = null, format = n }) {
  if (!keyStr) return <>{format(value)}</>;
  const v = Math.round(Number(value) || 0);
  /* Số 0 cũng mã hoá: hiện "0" thì đoán ra ngay là hoà vốn */
  const code = blindCode(v, keyStr) || [...keyStr][0];
  return <b className="font-mono tracking-wider">{code}</b>;
}
