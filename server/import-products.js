/* ====================================================================
   NHẬP DANH MỤC HÀNG HOÁ TỪ FILE (plan 26)

   Ba lỗi làm hỏng dữ liệu một cách âm thầm của bản cũ, sửa ở đây:

   D1  Nhóm hàng khớp theo tên PHẲNG, bỏ qua cấp cha. Hai nhánh cùng có
       nhóm "Ổ cắm" thì gán vào nhánh nào là tuỳ id nào nhỏ hơn.
       → Đọc đường dẫn "Thiết bị điện > Ổ cắm > Panasonic", dò từng cấp
         dưới đúng cấp cha. Tên trơn mà trùng ở hai nhánh thì báo lỗi, bắt
         ghi đủ đường dẫn — không bao giờ tự chọn bừa.
   D2  Gõ sai tên nhóm là TỰ TẠO nhóm mới, danh mục đầy nhóm rác.
       → Chủ tiệm chốt: KHÔNG cho tạo nhóm khi nhập. Nhóm lạ là lỗi, kèm
         gợi ý nhóm gần giống nhất để sửa ngay trên màn hình.
   D4  Chỉ đọc CSV nên Excel cắt số 0 đầu, đổi mã dài sang 8.28E+09.
       → Phía giao diện đọc thẳng .xlsx. Ở đây chặn nốt mã dạng khoa học
         và nhắc khi nghi mã vạch đã bị cắt số 0.

   Kèm theo, cùng một đoạn mã cũ:
   - Chủ tiệm chốt "một dòng hỏng thì KHÔNG nhập gì": kiểm hết mọi dòng
     trước, sạch lỗi mới ghi, và ghi trong một giao dịch.
   - Chế độ Cập nhật cũ xoá mất đơn vị không có trong file, xoá trắng mã
     vạch, ghi đè giá bằng 0 khi file thiếu cột. Giờ ô trống / cột không
     có trong file thì GIỮ NGUYÊN dữ liệu đang có.
   ==================================================================== */
import { all, get, run, vnFold, moveStock } from './db.js';
import { setOwnerBarcode, nextSku } from './barcodes.js';

const MAX_ROWS = 20000;
const VAT_OK = [0, 5, 8, 10];

/* ------------------------------ Đọc ô ------------------------------ */

const text = (v) => String(v ?? '').trim();
/** Cột có trong file VÀ ô có chữ. Cột không ghép thì khoá không có mặt. */
const has = (raw, key) => Object.prototype.hasOwnProperty.call(raw, key) && text(raw[key]) !== '';

/** Excel đổi số dài sang dạng khoa học: 8.28E+09, 8,93506E+12 */
const SCIENTIFIC = /^\d+([.,]\d+)?e[+-]?\d+$/i;

/**
 * Đọc số kiểu Việt: "1.250.000", "1,250,000", "1250000", "12,5", "125.000 đ".
 * Trả null nếu ô có chữ mà không phải số — để báo lỗi, không lặng lẽ thành 0.
 */
export function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = text(v).replace(/\s|đ|₫|vnd|vnđ/gi, '');
  if (!s) return null;
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const neg = s.startsWith('-');
  s = s.replace(/^-/, '');
  const dots = (s.match(/\./g) || []).length;
  const commas = (s.match(/,/g) || []).length;
  if (dots && commas) {
    /* Dấu đứng sau cùng là dấu thập phân: 1.250,5 hoặc 1,250.5 */
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    s = s.split(thou).join('').replace(dec, '.');
  } else if (dots > 1 || commas > 1) {
    s = s.replace(/[.,]/g, '');                         // 1.250.000
  } else if (dots === 1 || commas === 1) {
    const [a, b] = s.split(/[.,]/);
    /* Đúng 3 chữ số sau dấu và phần trước khác 0 → dấu nghìn (125.000);
       còn lại là dấu thập phân (12,5 · 0.25) */
    s = b.length === 3 && a !== '0' && a !== '' ? a + b : `${a || '0'}.${b}`;
  }
  const x = Number(s);
  return Number.isFinite(x) ? (neg ? -x : x) : null;
}

/* --------------------------- Nhóm hàng --------------------------- */

/** Khoảng cách sửa đổi Levenshtein — đủ nhanh cho vài trăm nhóm. */
function editDistance(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Cắt đường dẫn nhóm. Nhận cả "›" chép từ màn hình phần mềm. */
export const splitPath = (s) => text(s).split(/\s*[>›]\s*/);

/**
 * Chỉ mục nhóm hàng để phân giải đường dẫn trong file.
 * So khớp bỏ dấu + không phân biệt hoa thường ("day dien" = "Dây điện"),
 * nhưng hai nhóm cùng cấp khác nhau chỉ ở dấu thì ưu tiên nhóm gõ đúng dấu.
 */
export function categoryIndex() {
  const rows = all('SELECT id, name, parent_id FROM categories ORDER BY sort_order, name');
  const byId = new Map(rows.map((c) => [c.id, c]));
  const kids = new Map();
  for (const c of rows) {
    const p = c.parent_id && byId.has(c.parent_id) && c.parent_id !== c.id ? c.parent_id : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(c);
  }
  const pathOf = (c) => {
    const parts = [];
    const seen = new Set();
    for (let x = c; x && !seen.has(x.id); x = byId.get(x.parent_id)) {
      seen.add(x.id);
      parts.unshift(x.name);
    }
    return parts.join(' > ');
  };
  const paths = rows.map((c) => ({ id: c.id, path: pathOf(c), fold: vnFold(pathOf(c)), leaf: vnFold(c.name) }));
  const pathById = new Map(paths.map((p) => [p.id, p.path]));

  /** Trong một nhóm ứng viên, chọn đúng một: trùng khít chữ > trùng bỏ dấu. */
  const pick = (list, name) => {
    const f = vnFold(name);
    const loose = list.filter((c) => vnFold(c.name) === f);
    if (loose.length <= 1) return loose;
    const exact = loose.filter((c) => c.name.toLowerCase() === name.toLowerCase());
    return exact.length ? exact : loose;
  };

  /** Tối đa 3 đường dẫn gần giống để gợi ý sửa. */
  const suggest = (input) => {
    const parts = splitPath(input).filter(Boolean);
    const leaf = vnFold(parts[parts.length - 1] || '');
    const f = vnFold(parts.join(' > '));
    /* Tên nhóm cuối đúng, chỉ sai nhánh — gợi ý đúng những nhánh có nhóm đó */
    const sameLeaf = paths.filter((p) => p.leaf === leaf);
    if (sameLeaf.length) return sameLeaf.slice(0, 3).map((p) => p.path);
    const scored = paths
      .map((p) => ({ p, d: Math.min(editDistance(f, p.fold), editDistance(leaf, p.leaf) + 1) }))
      .sort((a, b) => a.d - b.d);
    const limit = Math.max(3, Math.round(f.length * 0.4));
    return scored.filter((x) => x.d <= limit).slice(0, 3).map((x) => x.p.path);
  };

  /* Đã dò tới đúng nhóm cha mà sai tên nhóm con: gợi ý trong đám con của
     nhóm cha đó trước — "Dây điện > Cadivy" thì gợi ý "Dây điện > Cadivi",
     không lôi "Quạt điện" ở nhánh khác vào. */
  const suggestUnder = (parentId, name, input) => {
    const f = vnFold(name);
    const limit = Math.max(2, Math.round(f.length * 0.4));
    const near = (kids.get(parentId) || [])
      .map((c) => ({ c, d: editDistance(f, vnFold(c.name)) }))
      .filter((x) => x.d <= limit)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map((x) => pathById.get(x.c.id));
    return near.length ? near : suggest(input);
  };

  const cache = new Map();
  const resolve = (input) => {
    const key = text(input);
    if (cache.has(key)) return cache.get(key);
    const out = resolveUncached(key);
    cache.set(key, out);
    return out;
  };

  const resolveUncached = (input) => {
    const parts = splitPath(input);
    if (parts.some((x) => !x)) {
      return { error: `Đường dẫn nhóm "${input}" có cấp bị bỏ trống`, fix: 'Ghi dạng "Nhóm cha > Nhóm con", không để hai dấu > liền nhau.', suggestions: suggest(input) };
    }
    if (parts.length === 1) {
      /* Tên trơn không có ">": tìm khắp cây. Trùng ở hai nhánh thì bắt ghi
         đủ đường dẫn — đây chính là chỗ bản cũ chọn bừa (D1). */
      const found = pick(rows, parts[0]);
      if (found.length === 1) return { id: found[0].id, path: pathById.get(found[0].id) };
      if (found.length > 1) {
        const options = found.map((c) => pathById.get(c.id));
        return {
          error: `Có ${found.length} nhóm cùng tên "${parts[0]}" ở các nhánh khác nhau`,
          fix: 'Ghi đủ đường dẫn để biết nhóm nào, ví dụ: ' + options[0],
          suggestions: options.slice(0, 3),
        };
      }
      return { error: `Không có nhóm "${parts[0]}" trong danh mục`, fix: 'Chọn nhóm có sẵn, hoặc tạo nhóm này trong màn hình Nhóm hàng trước rồi nhập lại.', suggestions: suggest(input) };
    }
    let parent = null;
    let trail = [];
    for (const part of parts) {
      const found = pick(kids.get(parent) || [], part);
      if (found.length !== 1) {
        const where = trail.length ? `nhóm "${trail.join(' > ')}" không có nhóm con "${part}"` : `không có nhóm cấp một "${part}"`;
        return {
          error: found.length > 1
            ? `Nhóm "${[...trail, part].join(' > ')}" bị trùng tên trong cùng một cấp`
            : `Không có nhóm "${parts.join(' > ')}" — ${where}`,
          fix: 'Chọn nhóm có sẵn, hoặc tạo nhóm này trong màn hình Nhóm hàng trước rồi nhập lại.',
          suggestions: suggestUnder(parent, part, input),
        };
      }
      parent = found[0].id;
      trail = [...trail, found[0].name];
    }
    return { id: parent, path: pathById.get(parent) };
  };

  return { resolve, pathOf: (id) => pathById.get(id) || '' };
}

/* ------------------------------ Kiểm tra ------------------------------ */

/**
 * PHA 1 — kiểm mọi dòng, KHÔNG ghi gì.
 *
 * @returns {{ plan, errors, warnings, summary }}
 *   plan: các dòng đã chuẩn hoá, sẵn sàng để pha 2 ghi (chỉ dùng khi errors rỗng)
 */
export function validateImport(rows, { mode = 'create' } = {}) {
  const errors = [];
  const warnings = [];
  const plan = [];
  const cats = categoryIndex();

  const lineOf = (raw, i) => Number(raw?._line) || i + 2;
  const err = (line, name, error, fix = '', extra = {}) => errors.push({ line, name, error, fix, ...extra });
  const warn = (line, name, warning) => warnings.push({ line, name, warning });

  if (rows.length > MAX_ROWS) {
    err(0, '', `File có ${rows.length.toLocaleString('vi-VN')} dòng, quá ${MAX_ROWS.toLocaleString('vi-VN')} dòng`,
      'Tách thành nhiều file nhỏ rồi nhập lần lượt.');
    return { plan, errors, warnings, summary: {} };
  }

  const seenSku = new Map();
  const seenBarcode = new Map();
  const seenName = new Map();
  /* Độ dài mã vạch toàn số hay gặp nhất trong file — để nhận ra dòng bị cắt số 0 */
  const digitLens = new Map();
  for (const raw of rows) {
    const b = text(raw?.barcode);
    if (/^\d{8,}$/.test(b)) digitLens.set(b.length, (digitLens.get(b.length) || 0) + 1);
  }
  const commonLen = [...digitLens.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;

  const summary = { total: 0, create: 0, update: 0, skip: 0, opening_ignored: 0 };

  /* Bảng tra dựng MỘT lần: dò từng dòng bằng câu truy vấn quét cả bảng hàng
     hoá thì file 500 dòng × 5.000 mặt hàng là đứng máy chủ vài giây. */
  const products = all('SELECT id, name, sku, barcode FROM products');
  const bySku = new Map(products.map((x) => [x.sku.toLowerCase(), x]));
  const byName = new Map();
  for (const x of products) {
    const k = vnFold(x.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(x);
  }
  const byBarcode = new Map();
  const retiredAuto = new Set(all("SELECT code FROM barcodes WHERE status = 'retired' AND source = 'auto'").map((x) => x.code));
  for (const x of products) if (x.barcode) byBarcode.set(x.barcode, x);
  for (const u of all(`SELECT u.barcode, p.id, p.name, p.sku FROM product_units u
                       JOIN products p ON p.id = u.product_id WHERE u.barcode IS NOT NULL AND u.barcode <> ''`)) {
    if (!byBarcode.has(u.barcode)) byBarcode.set(u.barcode, u);
  }

  rows.forEach((raw0, i) => {
    const raw = raw0 && typeof raw0 === 'object' ? raw0 : {};
    const line = lineOf(raw, i);
    /* Dòng trống hẳn thì bỏ qua im lặng (T-15) */
    const filled = Object.entries(raw).some(([k, v]) => k !== '_line' && text(v) !== '');
    if (!filled) return;
    summary.total += 1;

    const name = text(raw.name);
    const label = name || '(không tên)';
    let bad = false;
    const fail = (...a) => { bad = true; err(line, label, ...a); };

    if (!name) fail('Thiếu tên hàng hoá', 'Mỗi dòng phải có tên hàng. Dòng không dùng thì xoá hẳn khỏi file.');

    /* ---- Mã hàng ---- */
    const sku = text(raw.sku);
    if (sku && SCIENTIFIC.test(sku)) {
      fail(`Mã hàng "${sku}" đã bị Excel đổi sang dạng khoa học`,
        'Trong Excel chọn cột Mã hàng → Định dạng ô → Văn bản (Text), gõ lại mã rồi lưu. Dùng file mẫu .xlsx thì cột này đã đặt sẵn dạng Văn bản.',
        { field: 'sku' });
    } else if (sku) {
      const k = sku.toLowerCase();
      if (seenSku.has(k)) fail(`Trùng mã hàng "${sku}" với dòng ${seenSku.get(k)}`, 'Mỗi mã hàng chỉ ghi một dòng.', { field: 'sku' });
      else seenSku.set(k, line);
    }

    /* ---- Nhóm hàng (D1, D2) ---- */
    let categoryId;
    if (has(raw, 'category')) {
      const r = cats.resolve(raw.category);
      if (r.error) fail(r.error, r.fix, { field: 'category', value: text(raw.category), suggestions: r.suggestions });
      else categoryId = r.id;
    }

    /* ---- Số ---- */
    const numbers = {};
    const NUMS = [
      ['cost_price', 'Giá vốn'], ['price_retail', 'Giá bán lẻ'], ['price_wholesale', 'Giá sỉ'],
      ['price_dealer', 'Giá thợ'], ['opening_qty', 'Tồn kho hiện có'], ['min_stock', 'Tồn tối thiểu'],
      ['vat_rate', 'Thuế GTGT'], ['big_factor', 'Hệ số quy đổi'], ['big_price', 'Giá đơn vị lớn'],
    ];
    for (const [key, labelNum] of NUMS) {
      if (!has(raw, key)) continue;
      const v = parseNumber(raw[key]);
      if (v === null) {
        fail(`${labelNum} "${text(raw[key])}" không phải là số`, 'Chỉ ghi con số, ví dụ 125000 hoặc 125.000.', { field: key });
      } else if (v < 0) {
        fail(`${labelNum} không được âm (${text(raw[key])})`, '', { field: key });
      } else {
        numbers[key] = v;
      }
    }
    if (numbers.vat_rate !== undefined && !VAT_OK.includes(numbers.vat_rate)) {
      warn(line, label, `Thuế GTGT ${numbers.vat_rate}% khác các mức thường gặp 0, 5, 8, 10%`);
    }
    if (numbers.price_retail !== undefined && numbers.cost_price !== undefined
      && numbers.price_retail > 0 && numbers.price_retail < numbers.cost_price) {
      warn(line, label, `Giá bán lẻ ${numbers.price_retail.toLocaleString('vi-VN')} thấp hơn giá vốn ${numbers.cost_price.toLocaleString('vi-VN')}`);
    }
    if (has(raw, 'price_retail') && numbers.price_retail === 0) {
      warn(line, label, 'Giá bán lẻ bằng 0 — hàng khuyến mãi hay quên điền giá?');
    }

    /* ---- Đơn vị lớn: có tên thì phải có hệ số > 1 và ngược lại (T-21) ---- */
    const bigUnit = text(raw.big_unit);
    if (bigUnit && !(numbers.big_factor > 1)) {
      fail(`Đơn vị lớn "${bigUnit}" chưa có hệ số quy đổi lớn hơn 1`, 'Ghi số đơn vị cơ bản trong một đơn vị lớn, ví dụ Thùng = 50 Cái thì ghi 50.', { field: 'big_factor' });
    } else if (!bigUnit && has(raw, 'big_factor')) {
      fail('Có hệ số quy đổi nhưng thiếu tên đơn vị lớn', 'Ghi tên đơn vị lớn (Thùng, Cuộn…) hoặc xoá ô hệ số.', { field: 'big_unit' });
    } else if (bigUnit && !Number.isInteger(numbers.big_factor)) {
      fail(`Hệ số quy đổi của "${bigUnit}" phải là số nguyên`, 'Ví dụ 12, 50, 100 — không nhận số lẻ.', { field: 'big_factor' });
    }
    if (bigUnit && vnFold(bigUnit) === vnFold(text(raw.base_unit) || 'Cái')) {
      fail(`Đơn vị lớn "${bigUnit}" trùng tên đơn vị cơ bản`, 'Đặt tên khác cho đơn vị lớn.', { field: 'big_unit' });
    }

    /* ---- Mã vạch (D4, D9, T-37, T-38, T-39) ---- */
    const barcode = text(raw.barcode);
    let existing = null;
    if (sku) existing = bySku.get(sku.toLowerCase()) || null;
    else if (name) {
      /* Không mã thì khớp theo tên, bỏ dấu + không phân biệt hoa thường (D8) */
      const same = byName.get(vnFold(name)) || [];
      if (same.length === 1) existing = same[0];
      else if (same.length > 1 && mode === 'update') {
        fail(`Có ${same.length} mặt hàng tên giống "${name}" (mã ${same.map((x) => x.sku).join(', ')})`,
          'Ghi mã hàng để biết cập nhật mặt hàng nào.', { field: 'sku' });
      } else if (same.length > 1) existing = same[0];
    }

    if (barcode && SCIENTIFIC.test(barcode)) {
      fail(`Mã vạch "${barcode}" đã bị Excel đổi sang dạng khoa học`,
        'Trong Excel chọn cột Mã vạch → Định dạng ô → Văn bản (Text), gõ lại mã rồi lưu. Dùng file mẫu .xlsx thì cột này đã đặt sẵn dạng Văn bản.',
        { field: 'barcode' });
    } else if (barcode) {
      if (seenBarcode.has(barcode)) {
        fail(`Trùng mã vạch "${barcode}" với dòng ${seenBarcode.get(barcode)}`, 'Mỗi mã vạch chỉ thuộc một mặt hàng.', { field: 'barcode' });
      } else {
        seenBarcode.set(barcode, line);
        const holder = byBarcode.get(barcode);
        if (holder && holder.id !== existing?.id) {
          fail(`Mã vạch "${barcode}" đang thuộc mặt hàng khác: ${holder.sku} · ${holder.name}`,
            'Kiểm tra lại mã vạch, hoặc sửa mặt hàng đang giữ mã đó trước.', { field: 'barcode' });
        } else if (retiredAuto.has(barcode)) {
          fail(`Mã vạch "${barcode}" là mã tự sinh của mặt hàng đã xoá`,
            'Mã tự sinh không cấp lại cho hàng khác, kẻo tem cũ quét ra nhầm hàng. Bỏ trống ô này để phần mềm cấp mã mới.', { field: 'barcode' });
        }
      }
      if (/^\d+$/.test(barcode) && (barcode.length === 7 || barcode.length === 12
        || (commonLen >= 8 && barcode.length === commonLen - 1))) {
        warn(line, label, `Mã vạch "${barcode}" có ${barcode.length} chữ số — có thể Excel đã cắt mất số 0 ở đầu`);
      }
    }

    if (name) {
      const k = vnFold(name);
      const prev = seenName.get(k);
      if (prev && (!sku || !prev.sku)) {
        /* Không có mã để phân biệt thì thành HAI mặt hàng trùng tên */
        fail(`Trùng tên hàng với dòng ${prev.line}`,
          'Là hai mặt hàng khác nhau thì ghi mã hàng khác nhau cho từng dòng; là một thì xoá bớt một dòng.', { field: 'name' });
      } else if (prev) {
        warn(line, label, `Cùng tên với dòng ${prev.line} nhưng khác mã hàng — hai quy cách khác nhau?`);
      } else {
        seenName.set(k, { line, sku });
      }
    }

    if (bad) return;

    const action = existing ? (mode === 'update' ? 'update' : 'skip') : 'create';
    summary[action] += 1;
    if (existing && numbers.opening_qty > 0) summary.opening_ignored += 1;
    plan.push({ raw, line, name, sku, barcode, categoryId, numbers, bigUnit, existingId: existing?.id || null, action });
  });

  if (!summary.total) err(0, '', 'File không có dòng dữ liệu nào', 'Kiểm tra lại file, hoặc dòng tiêu đề có nằm đúng ở trên cùng không.');
  return { plan, errors, warnings, summary };
}

/* ------------------------------ Ghi ------------------------------ */

function priceLists() {
  const lists = all('SELECT id, code FROM price_lists ORDER BY sort_order, id');
  const byCode = Object.fromEntries(lists.map((p) => [p.code, p.id]));
  /* Tiệm đổi mã bảng giá thì vẫn dùng được theo thứ tự */
  return {
    retail: byCode.LE ?? lists[0]?.id,
    wholesale: byCode.SI ?? lists[1]?.id,
    dealer: byCode.THO ?? lists[2]?.id,
  };
}

const setPrice = (productId, plId, unitId, price) => {
  if (!plId || !unitId) return;
  run(`INSERT INTO product_prices(product_id, price_list_id, unit_id, price) VALUES(?, ?, ?, ?)
       ON CONFLICT(product_id, price_list_id, unit_id) DO UPDATE SET price = excluded.price`,
    [productId, plId, unitId, Math.round(price)]);
};

/** Mã tự cấp theo bộ đếm chỉ tiến (plan 30, H3), né cả mã ghi tay của các dòng khác trong file. */
const newSku = (reserved) => nextSku(reserved);

/**
 * PHA 2 — ghi. Chỉ gọi khi pha 1 sạch lỗi, và gọi TRONG một tx() để hỏng
 * giữa chừng thì không dòng nào vào.
 */
export function writeImport(plan, { warehouseId }) {
  const pl = priceLists();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const createdIds = [];
  const reserved = new Set(plan.filter((x) => x.sku).map((x) => x.sku.toLowerCase()));

  for (const it of plan) {
    if (it.action === 'skip') { skipped += 1; continue; }
    const { raw, numbers: nb } = it;
    const baseUnit = text(raw.base_unit) || null;

    let productId = it.existingId;
    if (it.action === 'create') {
      const vat = nb.vat_rate !== undefined ? nb.vat_rate : 8;
      productId = Number(run(`
        INSERT INTO products(sku, barcode, name, alias, category_id, base_unit, cost_price,
                             vat_rate, min_stock, brand, location, track_stock, active)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      [it.sku || newSku(reserved), null, it.name, text(raw.alias) || null,
        it.categoryId ?? null, baseUnit || 'Cái', Math.round(nb.cost_price || 0),
        vat, nb.min_stock || 0, text(raw.brand) || null, text(raw.location) || null]).lastInsertRowid);
      run('INSERT INTO product_units(product_id, unit_name, factor, is_base) VALUES(?, ?, 1, 1)', [productId, baseUnit || 'Cái']);
      /* Có mã trong file thì giữ nguyên; thiếu thì cấp mã 828… ngay trong giao
         dịch của cả lô (plan 30, L8, L9) */
      setOwnerBarcode('product', productId, it.barcode, { auto: true, source: 'import' });
      created += 1;
      createdIds.push(productId);
    } else {
      /* Cập nhật: CHỈ ghi những ô có chữ. Cột không có trong file, ô trống
         → giữ nguyên. Bản cũ xoá trắng mã vạch, hãng, vị trí kệ và đặt lại
         thuế về 8% mỗi khi file thiếu cột. */
      const sets = ['name = ?'];
      const vals = [it.name];
      const put = (col, val) => { sets.push(`${col} = ?`); vals.push(val); };
      if (it.barcode) setOwnerBarcode('product', productId, it.barcode, { source: 'import' });
      if (has(raw, 'alias')) put('alias', text(raw.alias));
      if (it.categoryId !== undefined) put('category_id', it.categoryId);
      if (nb.vat_rate !== undefined) put('vat_rate', nb.vat_rate);
      if (nb.min_stock !== undefined) put('min_stock', nb.min_stock);
      if (has(raw, 'brand')) put('brand', text(raw.brand));
      if (has(raw, 'location')) put('location', text(raw.location));
      run(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, [...vals, productId]);
      updated += 1;
    }

    /* ---- Đơn vị cơ bản: có sẵn thì giữ, đổi tên nếu file ghi tên khác ---- */
    let base = get('SELECT id, unit_name FROM product_units WHERE product_id = ? AND factor = 1 ORDER BY is_base DESC, id LIMIT 1', [productId]);
    if (!base) {
      const id = Number(run('INSERT INTO product_units(product_id, unit_name, factor, is_base) VALUES(?, ?, 1, 1)',
        [productId, baseUnit || 'Cái']).lastInsertRowid);
      base = { id, unit_name: baseUnit || 'Cái' };
    } else if (baseUnit && baseUnit !== base.unit_name
      && !get('SELECT id FROM product_units WHERE product_id = ? AND unit_name = ? AND id <> ?', [productId, baseUnit, base.id])) {
      run('UPDATE product_units SET unit_name = ? WHERE id = ?', [baseUnit, base.id]);
      run('UPDATE products SET base_unit = ? WHERE id = ?', [baseUnit, productId]);
    }

    /* ---- Giá: chỉ ghi bảng giá có ô điền. Hàng mới thì sỉ/thợ trống lấy theo lẻ ---- */
    const isNew = it.action === 'create';
    const retail = nb.price_retail;
    const wholesale = nb.price_wholesale ?? (isNew ? retail : undefined);
    const dealer = nb.price_dealer ?? (isNew ? retail : undefined);
    if (retail !== undefined || isNew) setPrice(productId, pl.retail, base.id, retail || 0);
    if (wholesale !== undefined) setPrice(productId, pl.wholesale, base.id, wholesale);
    if (dealer !== undefined) setPrice(productId, pl.dealer, base.id, dealer);

    /* ---- Đơn vị lớn: thêm hoặc sửa đúng đơn vị đó, KHÔNG đụng các đơn vị khác ---- */
    if (it.bigUnit) {
      const factor = nb.big_factor;
      const found = get('SELECT id, factor FROM product_units WHERE product_id = ? AND unit_name = ?', [productId, it.bigUnit]);
      let bigId = found?.id;
      if (found) {
        run('UPDATE product_units SET factor = ?, active = 1 WHERE id = ?', [factor, found.id]);
      } else {
        bigId = Number(run('INSERT INTO product_units(product_id, unit_name, factor, is_base) VALUES(?, ?, ?, 0)',
          [productId, it.bigUnit, factor]).lastInsertRowid);
      }
      const derive = !found || retail !== undefined;
      if (nb.big_price !== undefined) setPrice(productId, pl.retail, bigId, nb.big_price);
      else if (derive && retail !== undefined) setPrice(productId, pl.retail, bigId, retail * factor);
      if (wholesale !== undefined && (derive || nb.price_wholesale !== undefined)) setPrice(productId, pl.wholesale, bigId, wholesale * factor);
      if (dealer !== undefined && (derive || nb.price_dealer !== undefined)) setPrice(productId, pl.dealer, bigId, dealer * factor);
    }

    /* Hàng mới: đơn vị bán/nhập mặc định là đơn vị cơ bản */
    if (isNew) run('UPDATE products SET sell_unit_id = ?, buy_unit_id = ? WHERE id = ?', [base.id, base.id, productId]);

    /* Tồn đầu kỳ CHỈ cho hàng mới — nhập lại file không cộng dồn tồn */
    if (isNew && nb.opening_qty > 0 && warehouseId) {
      moveStock({
        productId, warehouseId, qtyChange: nb.opening_qty, unitCost: Math.round(nb.cost_price || 0),
        refType: 'opening', note: 'Tồn đầu kỳ (nhập từ file)',
      });
    }
  }
  return { created, updated, skipped, createdIds };
}

/* ------------------------------ File mẫu ------------------------------ */

/** Dữ liệu thật của tiệm để dựng file mẫu: đường dẫn nhóm, đơn vị, 3 dòng mẫu. */
export function importMeta() {
  const cats = categoryIndex();
  /* Đường dẫn xếp theo thứ tự cây (cha trước con), không theo chữ cái —
     người điền nhìn danh sách xổ xuống là thấy ngay nhánh nào nằm dưới nhánh nào */
  const tree = all('SELECT id, name, parent_id FROM categories ORDER BY sort_order, name');
  const ids = new Set(tree.map((c) => c.id));
  const byParent = new Map();
  for (const c of tree) {
    const p = c.parent_id && ids.has(c.parent_id) && c.parent_id !== c.id ? c.parent_id : null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(c);
  }
  const ordered = [];
  const seen = new Set();
  const walk = (parent) => {
    for (const c of byParent.get(parent) || []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      ordered.push(cats.pathOf(c.id));
      walk(c.id);
    }
  };
  walk(null);

  const units = all(`SELECT unit_name, COUNT(*) AS n FROM product_units
                     WHERE active = 1 GROUP BY unit_name ORDER BY n DESC, unit_name`).map((u) => u.unit_name);
  const pl = priceLists();
  const price = (listId) => `(SELECT pp.price FROM product_prices pp JOIN product_units u ON u.id = pp.unit_id
      WHERE pp.product_id = p.id AND u.factor = 1 AND pp.price_list_id = ${Number(listId) || 0} LIMIT 1)`;
  /* Ba dòng mẫu là HÀNG THẬT của tiệm, không phải "Sản phẩm A" — nhìn là
     biết điền thế nào. Để nguyên mà nhập thì trùng mã, bị bỏ qua, vô hại. */
  const samples = all(`
    SELECT p.sku, p.name, p.barcode, p.alias, p.cost_price, p.category_id, p.base_unit, p.vat_rate, p.brand,
           ${price(pl.retail)} AS price_retail, ${price(pl.wholesale)} AS price_wholesale,
           ${price(pl.dealer)} AS price_dealer
    FROM products p WHERE p.active = 1 AND p.category_id IS NOT NULL
    ORDER BY p.id LIMIT 3`);
  return {
    category_paths: ordered,
    units: units.length ? units : ['Cái', 'Mét', 'Bộ', 'Hộp', 'Cuộn'],
    samples: samples.map(({ category_id: cid, ...x }) => ({ ...x, category: cats.pathOf(cid) })),
  };
}
