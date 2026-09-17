/* ====================================================================
   SỔ ĐĂNG KÝ MÃ VẠCH VÀ BỘ ĐẾM (plan 30)

   Ba nguyên tắc, thực thi bằng dữ liệu chứ không bằng lời hứa:
     1. Mã vạch duy nhất trong toàn hệ thống — kể cả BẮC QUA hai bảng
        products và product_units: máy quét chỉ đọc ra một chuỗi, chuỗi đó
        phải chỉ về đúng một thứ.
     2. Mã tự sinh không bao giờ được cấp lại, kể cả khi hàng đã xoá: tem cũ
        còn dán ngoài tiệm không được trỏ sang hàng khác.
     3. Mã người dùng gõ vào (mã nhà sản xuất) giữ nguyên, trùng thì báo lỗi
        chứ không lặng lẽ đổi.

   Mọi chỗ ghi mã vạch đều phải đi qua file này. Hai cột products.barcode và
   product_units.barcode vẫn giữ làm bản sao đọc nhanh — các truy vấn cũ chạy
   nguyên, và cơ sở dữ liệu có thêm chỉ mục UNIQUE làm lớp chặn thứ hai.
   ==================================================================== */
import { all, get, run } from './db.js';

const httpError = (message, code, status = 400, extra = {}) =>
  Object.assign(new Error(message), { status, code, ...extra });

/** Nhảy qua mã đã bị chiếm quá chừng này lần là có chuyện bất thường — dừng và báo (plan 30, §6). */
const MAX_SKIP = 5;

export const cleanCode = (v) => {
  const s = String(v ?? '').trim();
  return s || null;
};

const TABLE = { product: 'products', product_unit: 'product_units' };

/** Tên dễ đọc của chỗ đang giữ mã, để báo lỗi cho người dùng. */
function describe(ownerType, ownerId) {
  if (ownerType === 'product_unit') {
    const u = get(`SELECT u.unit_name, p.sku, p.name FROM product_units u JOIN products p ON p.id = u.product_id
                   WHERE u.id = ?`, [ownerId]);
    return u ? `${u.sku} · ${u.name} (đơn vị ${u.unit_name})` : 'một đơn vị tính khác';
  }
  const p = get('SELECT sku, name FROM products WHERE id = ?', [ownerId]);
  return p ? `${p.sku} · ${p.name}` : 'một mặt hàng khác';
}

/** Những chỗ đang thật sự mang mã này trên hai cột — gồm cả dữ liệu cũ chưa vào sổ. */
function columnHolders(code) {
  return [
    ...all('SELECT id FROM products WHERE barcode = ?', [code]).map((x) => ({ type: 'product', id: x.id })),
    ...all('SELECT id FROM product_units WHERE barcode = ?', [code]).map((x) => ({ type: 'product_unit', id: x.id })),
  ];
}

const sameOwner = (a, type, id) => a && a.type === type && Number(a.id) === Number(id);

/**
 * Mã có giao được cho owner không. Ném BARCODE_TAKEN nếu đang thuộc chỗ khác,
 * BARCODE_RETIRED nếu là mã TỰ SINH của hàng đã xoá (không cấp lại).
 */
export function assertBarcodeFree(code, owner) {
  const reg = get('SELECT * FROM barcodes WHERE code = ?', [code]);
  if (reg?.status === 'active' && !(reg.owner_type === owner.type && Number(reg.owner_id) === Number(owner.id))) {
    throw httpError(`Mã vạch "${code}" đang thuộc ${describe(reg.owner_type, reg.owner_id)}.`, 'BARCODE_TAKEN', 409,
      { holder: { owner_type: reg.owner_type, owner_id: reg.owner_id } });
  }
  if (reg?.status === 'retired' && reg.source === 'auto'
    && !(reg.owner_type === owner.type && Number(reg.last_owner_id) === Number(owner.id))) {
    throw httpError(`Mã vạch "${code}" là mã tự sinh của mặt hàng đã xoá — mã tự sinh không cấp lại cho hàng khác, kẻo tem cũ còn dán ngoài tiệm quét ra nhầm hàng.`,
      'BARCODE_RETIRED', 409);
  }
  const other = columnHolders(code).find((h) => !sameOwner(h, owner.type, owner.id));
  if (other) {
    throw httpError(`Mã vạch "${code}" đang thuộc ${describe(other.type, other.id)}.`, 'BARCODE_TAKEN', 409,
      { holder: { owner_type: other.type, owner_id: other.id } });
  }
  return reg;
}

/** Ghi mã vào sổ cho owner (đã soát trống). */
function register(code, owner, { source, userId, note }) {
  const reg = assertBarcodeFree(code, owner);
  if (reg) {
    run(`UPDATE barcodes SET owner_type = ?, owner_id = ?, last_owner_id = ?, status = 'active',
           source = CASE WHEN status = 'active' AND owner_id = ? THEN source ELSE ? END,
           user_id = COALESCE(?, user_id), note = COALESCE(?, note), ts = datetime('now','localtime')
         WHERE code = ?`,
      [owner.type, owner.id, owner.id, owner.id, source, userId || null, note || null, code]);
  } else {
    run(`INSERT INTO barcodes(code, owner_type, owner_id, last_owner_id, source, user_id, note)
         VALUES(?, ?, ?, ?, ?, ?, ?)`, [code, owner.type, owner.id, owner.id, source, userId || null, note || null]);
  }
}

/** Thu hồi mã khỏi owner: dòng ở lại sổ vĩnh viễn, trạng thái retired. */
export function releaseBarcode(code, owner, note = null) {
  if (!code) return;
  run(`UPDATE barcodes SET status = 'retired', owner_id = NULL, note = COALESCE(?, note), ts = datetime('now','localtime')
       WHERE code = ? AND owner_type = ? AND owner_id = ?`, [note, code, owner.type, owner.id]);
}

/** Cấu hình bộ đếm mã vạch tự sinh. */
export function barcodeCounter() {
  return get("SELECT * FROM barcode_counter WHERE name = 'product'");
}

/**
 * Sinh một mã vạch mới cho owner và ghi sổ. Bộ đếm luôn tiến, kể cả ở những lần
 * phải nhảy qua mã đã bị chiếm (mã nhà sản xuất tình cờ trùng dải 828…).
 * Gọi TRONG tx() của thao tác tạo hàng để hỏng là không cấp mã nào.
 */
export function generateBarcode(owner, userId = null) {
  const c = barcodeCounter();
  let v = c.next_value;
  const limit = 10 ** c.width;
  for (let i = 0; i < MAX_SKIP; i += 1) {
    if (v >= limit) {
      run("UPDATE barcode_counter SET next_value = ? WHERE name = 'product'", [v]);
      throw httpError(`Đã dùng hết ${limit.toLocaleString('vi-VN')} mã vạch tự sinh của dải ${c.prefix}. Vào Thiết lập → Mã vạch, tăng số chữ số rồi thử lại.`,
        'BARCODE_EXHAUSTED', 409);
    }
    const code = c.prefix + String(v).padStart(c.width, '0');
    v += 1;
    if (!get('SELECT 1 AS x FROM barcodes WHERE code = ?', [code]) && !columnHolders(code).length) {
      run("UPDATE barcode_counter SET next_value = ? WHERE name = 'product'", [v]);
      register(code, owner, { source: 'auto', userId, note: null });
      return code;
    }
  }
  run("UPDATE barcode_counter SET next_value = ? WHERE name = 'product'", [v]);
  throw httpError(`Phải nhảy qua hơn ${MAX_SKIP} mã đã bị chiếm liên tiếp — có mã nhập tay đang chiếm dải ${c.prefix}. Bấm cấp mã lại, hoặc kiểm tra ở Thiết lập → Mã vạch.`,
    'BARCODE_SKIP_LIMIT', 409);
}

/**
 * Đặt mã vạch cho một mặt hàng / một đơn vị tính.
 * @param code  mã người dùng gõ (rỗng = không có mã)
 * @param opts  { auto: rỗng thì tự sinh, source: manual | import, userId, note }
 * Mã cũ (nếu đổi) được thu hồi, không trả về kho mã.
 */
export function setOwnerBarcode(ownerType, ownerId, code, { auto = false, source = 'manual', userId = null, note = null } = {}) {
  const owner = { type: ownerType, id: Number(ownerId) };
  const table = TABLE[ownerType];
  const cur = cleanCode(get(`SELECT barcode FROM ${table} WHERE id = ?`, [owner.id])?.barcode);
  let next = cleanCode(code);
  if (next === cur && (next || !auto)) {
    /* Mã không đổi: ghi sổ nếu chưa có. Mã đang trùng từ dữ liệu cũ thì để yên
       — sửa tên, sửa giá không được bị chặn vì một chuyện chủ tiệm chưa kịp
       quyết ở Thiết lập → Mã vạch */
    if (next) {
      try { register(next, owner, { source, userId, note }); } catch (e) {
        if (!['BARCODE_TAKEN', 'BARCODE_RETIRED'].includes(e.code)) throw e;
      }
    }
    return next;
  }
  if (next) register(next, owner, { source, userId, note });
  if (cur) {
    releaseBarcode(cur, owner, next ? `đổi sang ${next}` : 'bỏ mã');
    /* Phải gỡ khỏi cột trước khi sinh mã mới, kẻo chỉ mục UNIQUE vướng chính mình */
    run(`UPDATE ${table} SET barcode = NULL WHERE id = ?`, [owner.id]);
  }
  if (!next && auto) next = generateBarcode(owner, userId);
  run(`UPDATE ${table} SET barcode = ? WHERE id = ?`, [next, owner.id]);
  return next;
}

/** Thu hồi mọi mã của một mặt hàng (mã hàng + mã các đơn vị) — gọi TRƯỚC khi xoá hẳn. */
export function retireProductCodes(productId, note = 'xoá mặt hàng') {
  const p = get('SELECT id, barcode FROM products WHERE id = ?', [productId]);
  if (p?.barcode) releaseBarcode(p.barcode, { type: 'product', id: p.id }, note);
  for (const u of all('SELECT id, barcode FROM product_units WHERE product_id = ? AND barcode IS NOT NULL', [productId])) {
    releaseBarcode(u.barcode, { type: 'product_unit', id: u.id }, note);
  }
}

/** Mã hàng SP00001… tự đặt: bộ đếm chỉ tiến, né mã đã có (kể cả mã gõ tay). */
export function nextSku(reserved = null) {
  const c = get("SELECT * FROM barcode_counter WHERE name = 'sku'");
  let v = c.next_value;
  const taken = (x) => reserved?.has(x.toLowerCase())
    || get('SELECT id FROM products WHERE sku = ? COLLATE NOCASE', [x]);
  let sku = c.prefix + String(v).padStart(c.width, '0');
  for (let i = 0; taken(sku) && i < 100000; i += 1) {
    v += 1;
    sku = c.prefix + String(v).padStart(c.width, '0');
  }
  run("UPDATE barcode_counter SET next_value = ? WHERE name = 'sku'", [v + 1]);
  reserved?.add(sku.toLowerCase());
  return sku;
}

/** Ai đang giữ một mã — để màn hình khai hàng báo sớm khi quét trúng mã đã có. */
export function barcodeLookup(code) {
  const c = cleanCode(code);
  if (!c) return null;
  const reg = get('SELECT * FROM barcodes WHERE code = ?', [c]);
  const holders = columnHolders(c).map((h) => ({
    owner_type: h.type, owner_id: h.id, label: describe(h.type, h.id),
    product_id: h.type === 'product' ? h.id : get('SELECT product_id FROM product_units WHERE id = ?', [h.id])?.product_id,
  }));
  const counter = barcodeCounter();
  return {
    code: c,
    status: reg?.status || null,
    source: reg?.source || null,
    holders,
    /* Mã gõ tay nằm trong dải tự sinh 828… — cho lưu nhưng nhắc (plan 30, §4.5) */
    in_auto_range: c.startsWith(counter.prefix) && c.length === counter.prefix.length + counter.width && /^\d+$/.test(c),
  };
}

/**
 * Mã đang bị nhiều chỗ cùng giữ (dữ liệu có từ trước khi có sổ đăng ký).
 * Không tự chọn giữ cái nào — chủ tiệm xem và quyết từng mã.
 */
export function barcodeConflicts() {
  const codes = all(`
    SELECT code FROM (
      SELECT barcode AS code FROM products WHERE barcode IS NOT NULL
      UNION ALL SELECT barcode FROM product_units WHERE barcode IS NOT NULL
    ) GROUP BY code HAVING COUNT(*) > 1 ORDER BY code`);
  return codes.map(({ code }) => ({
    code,
    holders: columnHolders(code).map((h) => ({
      owner_type: h.type, owner_id: h.id, label: describe(h.type, h.id),
    })),
  }));
}

/** Soát bất biến của sổ (plan 30, §5.2): I1 mọi mã trên hàng đều có trong sổ, I2 bộ đếm không lùi. */
export function barcodeInvariants() {
  const c = barcodeCounter();
  const missing = all(`
    SELECT 'product' AS owner_type, id, barcode FROM products
     WHERE barcode IS NOT NULL AND barcode NOT IN (SELECT code FROM barcodes WHERE status = 'active')
    UNION ALL
    SELECT 'product_unit', id, barcode FROM product_units
     WHERE barcode IS NOT NULL AND barcode NOT IN (SELECT code FROM barcodes WHERE status = 'active')`);
  const maxAuto = get(`
    SELECT COALESCE(MAX(CAST(SUBSTR(code, ?) AS INTEGER)), 0) AS m FROM barcodes
    WHERE source = 'auto' AND code LIKE ? || '%' AND LENGTH(code) = ?`,
  [c.prefix.length + 1, c.prefix, c.prefix.length + c.width]).m;
  return { i1_missing: missing, i2_ok: c.next_value > maxAuto, max_auto: maxAuto, next_value: c.next_value };
}
