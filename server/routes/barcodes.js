/* ====================================================================
   MÃ VẠCH: THIẾT LẬP, TRA MÃ, XỬ LÝ MÃ TRÙNG CÓ TỪ TRƯỚC (plan 30)
   ==================================================================== */
import { Router } from 'express';
import { get, run, tx } from '../db.js';
import {
  barcodeCounter, barcodeLookup, barcodeConflicts, barcodeInvariants, setOwnerBarcode,
} from '../barcodes.js';

const r = Router();

function settingsView() {
  const c = barcodeCounter();
  const total = c.prefix.length + c.width;
  return {
    prefix: c.prefix,
    width: c.width,
    next_value: c.next_value,
    next_code: c.prefix + String(c.next_value).padStart(c.width, '0'),
    total_length: total,
    /* Code 128 chỉ nén được hai chữ số vào một ký hiệu khi độ dài CHẴN: mã lẻ
       làm tem rộng thêm khoảng 40% (plan 30, §4.1). Không chặn — chỉ báo. */
    odd_length: total % 2 === 1,
    remaining: Math.max(0, 10 ** c.width - c.next_value),
    conflicts: barcodeConflicts(),
    invariants: barcodeInvariants(),
  };
}

r.get('/barcode-settings', (req, res) => res.json(settingsView()));

/**
 * Đổi tiền tố / số chữ số của mã tự sinh. Bộ đếm KHÔNG lùi: đổi tiền tố thì
 * dải mới bắt đầu từ số đang đếm; giảm số chữ số tới mức số đang đếm không
 * còn chứa vừa thì từ chối.
 */
r.put('/barcode-settings', (req, res) => {
  const prefix = String(req.body?.prefix ?? '').trim();
  const width = Math.round(Number(req.body?.width));
  if (!/^\d{1,6}$/.test(prefix)) {
    return res.status(400).json({ error: 'Tiền tố phải là 1 đến 6 chữ số — máy quét và tem gọn nhất khi mã toàn số.', code: 'BAD_PREFIX' });
  }
  if (!(width >= 4 && width <= 10)) {
    return res.status(400).json({ error: 'Phần số chạy phải dài 4 đến 10 chữ số.', code: 'BAD_WIDTH' });
  }
  const c = barcodeCounter();
  if (c.next_value >= 10 ** width) {
    return res.status(400).json({
      error: `Bộ đếm đã tới ${c.next_value.toLocaleString('vi-VN')} — ${width} chữ số không chứa đủ. Chọn từ ${String(c.next_value).length} chữ số trở lên.`,
      code: 'WIDTH_TOO_SMALL',
    });
  }
  run("UPDATE barcode_counter SET prefix = ?, width = ? WHERE name = 'product'", [prefix, width]);
  res.json(settingsView());
});

/** Mã này đang thuộc ai — màn hình khai hàng hỏi lúc quét / gõ mã. */
r.get('/barcodes/lookup', (req, res) => res.json(barcodeLookup(req.query.code)));

/**
 * Chủ tiệm quyết một mã đang trùng: giữ ở chỗ nào, các chỗ còn lại bỏ mã
 * hoặc cấp mã tự sinh mới. Xử lý xong mọi mã trùng thì bật luôn chỉ mục
 * UNIQUE ở cơ sở dữ liệu.
 */
r.post('/barcode-conflicts/resolve', (req, res) => {
  const b = req.body || {};
  const code = String(b.code ?? '').trim();
  const keep = b.keep || {};
  const conflict = barcodeConflicts().find((x) => x.code === code);
  if (!conflict) return res.status(404).json({ error: `Mã "${code}" không còn trùng.`, code: 'NO_CONFLICT' });
  const kept = conflict.holders.find((h) => h.owner_type === keep.owner_type && Number(h.owner_id) === Number(keep.owner_id));
  if (!kept) return res.status(400).json({ error: 'Chọn một chỗ đang giữ mã này để giữ lại.', code: 'KEEP_REQUIRED' });
  const regenerate = b.others === 'regenerate';
  try {
    tx(() => {
      const table = { product: 'products', product_unit: 'product_units' };
      /* Gỡ mã khỏi mọi chỗ khác trước, rồi mới ghi sổ cho chỗ được giữ */
      for (const h of conflict.holders) {
        if (h === kept) continue;
        run(`UPDATE ${table[h.owner_type]} SET barcode = NULL WHERE id = ?`, [h.owner_id]);
        if (regenerate) setOwnerBarcode(h.owner_type, h.owner_id, null, { auto: true, userId: req.user?.id || null });
      }
      setOwnerBarcode(kept.owner_type, kept.owner_id, code, { userId: req.user?.id || null, note: 'chủ tiệm chọn giữ khi xử lý mã trùng' });
    });
    for (const [t, ix] of [['products', 'ux_products_barcode'], ['product_units', 'ux_units_barcode']]) {
      const dup = get(`SELECT COUNT(*) AS n FROM (SELECT barcode FROM ${t} WHERE barcode IS NOT NULL
                       GROUP BY barcode HAVING COUNT(*) > 1)`).n;
      if (!dup) run(`CREATE UNIQUE INDEX IF NOT EXISTS ${ix} ON ${t}(barcode) WHERE barcode IS NOT NULL`);
    }
    res.json(settingsView());
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

export default r;
