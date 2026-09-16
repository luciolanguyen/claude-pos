/* ====================================================================
   FILE EXCEL CHO NHẬP DANH MỤC HÀNG HOÁ (plan 26, lỗi D4)

   Bản cũ chỉ đọc CSV, buộc người dùng "Lưu thành CSV" trong Excel — và
   chính bước đó làm hỏng dữ liệu âm thầm:
     - mã vạch 0123456 thành 123456 (mất số 0 đầu)
     - mã dài 8280000001 thành 8.28E+09 (dạng khoa học)
     - CSV thường trên Windows tiếng Việt ra mã ANSI, vỡ hết chữ

   Ở đây:
     buildTemplate()  dựng file mẫu .xlsx: cột mã để sẵn dạng Văn bản,
                      danh sách xổ xuống lấy từ cây nhóm thật của tiệm
     readWorkbook()   đọc thẳng .xlsx, giữ đúng chữ số của ô
     decodeCsv()      đọc CSV, tự nhận ra file ANSI tiếng Việt
     parseTable()     tách CSV / dán từ Excel, ô có xuống dòng không làm
                      lệch các dòng sau (lỗi D3)

   Thư viện ExcelJS nặng ~1 MB nên chỉ nạp khi mở hộp nhập / tải file mẫu,
   đóng gói sẵn cùng phần mềm — không tải từ Internet.
   ==================================================================== */

async function excel() {
  const m = await import('exceljs');
  return m.default || m;
}

/* ------------------------------ Cột file mẫu ------------------------------ */

/**
 * Thứ tự cột + ghi chú hiện khi rê chuột vào tiêu đề.
 * tier: 1 bắt buộc (nền vàng) · 2 nên có (nền trắng) · 3 tuỳ chọn (nền xám)
 * Tiêu đề phải khớp từ khoá tự nhận cột ở ImportProducts.jsx.
 */
export const TEMPLATE_COLUMNS = [
  { key: 'sku', header: 'Mã hàng', width: 14, tier: 2, text: true,
    note: 'Bỏ trống thì phần mềm tự cấp mã.\nTrùng mã với hàng đã có thì coi là CÙNG một mặt hàng.' },
  { key: 'name', header: 'Tên hàng hoá', width: 38, tier: 1, text: true,
    note: 'BẮT BUỘC.\nKhông có mã hàng thì phần mềm khớp theo tên (không phân biệt hoa thường, có dấu hay không).' },
  { key: 'category', header: 'Nhóm hàng', width: 36, tier: 2, text: true, list: 'category',
    note: 'Chọn trong danh sách xổ xuống — đừng gõ tay.\nNhóm nhiều cấp ghi dạng: Nhóm cha > Nhóm con.\nNhóm chưa có thì tạo trong phần mềm trước, rồi tải lại file mẫu.' },
  { key: 'base_unit', header: 'Đơn vị tính', width: 12, tier: 2, text: true, list: 'unit',
    note: 'Cái, Mét, Bộ, Hộp… Bỏ trống thì lấy "Cái".' },
  { key: 'cost_price', header: 'Giá vốn', width: 12, tier: 2, num: 'money' },
  { key: 'price_retail', header: 'Giá bán lẻ', width: 12, tier: 2, num: 'money' },
  { key: 'price_wholesale', header: 'Giá sỉ', width: 12, tier: 2, num: 'money',
    note: 'Hàng mới mà bỏ trống thì lấy bằng giá lẻ.' },
  { key: 'price_dealer', header: 'Giá thợ', width: 12, tier: 2, num: 'money',
    note: 'Hàng mới mà bỏ trống thì lấy bằng giá lẻ.' },
  { key: 'opening_qty', header: 'Tồn kho hiện có', width: 15, tier: 2, num: 'qty',
    note: 'CHỈ ghi cho hàng MỚI.\nNhập lại file này thì tồn kho KHÔNG cộng dồn.' },
  { key: 'barcode', header: 'Mã vạch', width: 17, tier: 3, text: true,
    note: 'Cột đã đặt sẵn dạng Văn bản để giữ số 0 đầu.\nĐỪNG đổi sang dạng Số — Excel sẽ cắt số 0 và đổi mã dài thành 8.28E+09.' },
  { key: 'alias', header: 'Tên gọi khác', width: 20, tier: 3, text: true,
    note: 'Tên thợ hay gọi, để thu ngân gõ tắt. Ví dụ: ốc 8 ly, cb 32.' },
  { key: 'brand', header: 'Hãng', width: 12, tier: 3, text: true },
  { key: 'location', header: 'Vị trí kệ', width: 11, tier: 3, text: true },
  { key: 'min_stock', header: 'Tồn tối thiểu', width: 13, tier: 3, num: 'qty' },
  { key: 'vat_rate', header: 'Thuế GTGT (%)', width: 13, tier: 3, list: 'vat',
    note: '0, 5, 8 hoặc 10. Bỏ trống thì lấy 8%.' },
  { key: 'big_unit', header: 'Đơn vị lớn', width: 12, tier: 3, text: true, list: 'unit',
    note: 'Thùng, Cuộn, Hộp… Ghi đơn vị lớn thì BẮT BUỘC ghi Hệ số quy đổi.' },
  { key: 'big_factor', header: 'Hệ số quy đổi', width: 13, tier: 3, num: 'int',
    note: 'Một đơn vị lớn bằng bao nhiêu đơn vị tính. Ví dụ Cuộn 100 mét thì ghi 100.' },
  { key: 'big_price', header: 'Giá đơn vị lớn', width: 14, tier: 3, num: 'money',
    note: 'Bỏ trống thì lấy giá lẻ nhân hệ số.' },
];

export const SHEET_ITEMS = 'Hàng hoá';
const SHEET_CATS = 'Nhóm hàng';
const SHEET_UNITS = 'Đơn vị tính';
const SHEET_GUIDE = 'Hướng dẫn';
/* Đổ sẵn định dạng và danh sách xổ xuống tới dòng này */
const TEMPLATE_ROWS = 1000;

const FILL = { 1: 'FFFFF3C4', 2: 'FFFFFFFF', 3: 'FFF1F5F9' };
const colLetter = (i) => {
  let n = i + 1;
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

/**
 * Dựng file mẫu .xlsx bốn sheet.
 * @param meta { category_paths, units, samples } — từ GET /products/import-meta
 * @returns ArrayBuffer
 */
export async function buildTemplate(meta) {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Phần mềm bán hàng Thạnh Hoà';
  wb.created = new Date();

  const cats = meta.category_paths || [];
  const units = meta.units || [];

  /* ---------------- Sheet 1: nơi điền ---------------- */
  const ws = wb.addWorksheet(SHEET_ITEMS, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = TEMPLATE_COLUMNS.map((c) => ({ key: c.key, width: c.width }));

  const head = ws.getRow(1);
  head.height = 32;
  TEMPLATE_COLUMNS.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.tier === 1 ? `${c.header} *` : c.header;
    cell.font = { bold: true, color: { argb: 'FF0F172A' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.tier === 1 ? 'FFFDE68A' : c.tier === 2 ? 'FFE2E8F0' : 'FFCBD5E1' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF64748B' } } };
    const note = c.key === 'category' && !cats.length
      ? 'Tiệm CHƯA có nhóm hàng nào.\nDựng cây nhóm hàng trong phần mềm trước, rồi tải lại file mẫu này để có danh sách xổ xuống.'
      : c.note;
    if (note) cell.note = note;
  });

  /* Định dạng từng ô tới dòng 1000: ô mã để Văn bản (@) thì Excel không
     cắt số 0, không đổi sang 8.28E+09 — đây là lớp chặn D4 thứ nhất. */
  for (let r = 2; r <= TEMPLATE_ROWS; r += 1) {
    const row = ws.getRow(r);
    TEMPLATE_COLUMNS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.text) cell.numFmt = '@';
      else if (c.num === 'money' || c.num === 'int') cell.numFmt = '#,##0';
      else if (c.num === 'qty') cell.numFmt = '#,##0.###';
      if (c.tier === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[1] } };
      else if (c.tier === 3) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[3] } };
    });
  }

  /* Ba dòng mẫu là hàng thật của tiệm */
  (meta.samples || []).slice(0, 3).forEach((s, k) => {
    const row = ws.getRow(2 + k);
    const put = (key, v) => {
      const idx = TEMPLATE_COLUMNS.findIndex((c) => c.key === key);
      if (idx >= 0 && v !== null && v !== undefined && v !== '') {
        const c = TEMPLATE_COLUMNS[idx];
        row.getCell(idx + 1).value = c.text ? String(v) : v;
      }
    };
    put('sku', s.sku); put('name', s.name); put('category', s.category); put('base_unit', s.base_unit);
    put('cost_price', s.cost_price); put('price_retail', s.price_retail);
    put('price_wholesale', s.price_wholesale); put('price_dealer', s.price_dealer);
    put('barcode', s.barcode); put('alias', s.alias); put('brand', s.brand); put('vat_rate', s.vat_rate);
  });

  /* Danh sách xổ xuống — lớp chặn D2: không gõ tay thì không gõ sai nhóm */
  const range = (key) => {
    const i = TEMPLATE_COLUMNS.findIndex((c) => c.key === key);
    return `${colLetter(i)}2:${colLetter(i)}${TEMPLATE_ROWS}`;
  };
  if (cats.length) {
    ws.dataValidations.add(range('category'), {
      type: 'list', allowBlank: true,
      formulae: [`'${SHEET_CATS}'!$A$2:$A$${cats.length + 1}`],
      showErrorMessage: true, errorStyle: 'stop',
      errorTitle: 'Nhóm hàng không có trong danh sách',
      error: 'Chọn nhóm trong danh sách xổ xuống. Nhóm chưa có thì tạo trong phần mềm trước, rồi tải lại file mẫu.',
      showInputMessage: true, promptTitle: 'Nhóm hàng', prompt: 'Bấm mũi tên bên phải ô để chọn nhóm.',
    });
  }
  if (units.length) {
    for (const key of ['base_unit', 'big_unit']) {
      ws.dataValidations.add(range(key), {
        type: 'list', allowBlank: true,
        formulae: [`'${SHEET_UNITS}'!$A$2:$A$${units.length + 1}`],
        /* Đơn vị mới vẫn cho gõ — chỉ nhắc, không chặn */
        showErrorMessage: true, errorStyle: 'warning',
        errorTitle: 'Đơn vị chưa từng dùng', error: 'Đơn vị này chưa có trong tiệm. Vẫn dùng đơn vị mới này?',
      });
    }
  }
  ws.dataValidations.add(range('vat_rate'), {
    type: 'list', allowBlank: true, formulae: ['"0,5,8,10"'],
    showErrorMessage: true, errorStyle: 'warning', errorTitle: 'Thuế suất lạ', error: 'Thuế GTGT thường là 0, 5, 8 hoặc 10.',
  });
  for (const key of ['cost_price', 'price_retail', 'price_wholesale', 'price_dealer', 'big_price', 'opening_qty', 'min_stock']) {
    ws.dataValidations.add(range(key), {
      type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0],
      showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Phải là số không âm', error: 'Chỉ ghi con số từ 0 trở lên.',
    });
  }
  ws.dataValidations.add(range('big_factor'), {
    type: 'whole', operator: 'greaterThan', allowBlank: true, formulae: [1],
    showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Hệ số quy đổi', error: 'Hệ số là số nguyên lớn hơn 1, ví dụ 12, 50, 100.',
  });

  /* ---------------- Sheet 2: cây nhóm hàng ---------------- */
  const wc = wb.addWorksheet(SHEET_CATS, { views: [{ state: 'frozen', ySplit: 1 }] });
  wc.getColumn(1).width = 60;
  wc.getCell('A1').value = 'Đường dẫn nhóm hàng — chọn ở cột "Nhóm hàng" của sheet Hàng hoá';
  wc.getCell('A1').font = { bold: true };
  cats.forEach((p, i) => { wc.getCell(`A${i + 2}`).value = p; });
  if (!cats.length) wc.getCell('A2').value = '(Tiệm chưa có nhóm hàng nào — dựng cây nhóm trong phần mềm trước)';

  /* ---------------- Sheet 3: đơn vị tính ---------------- */
  const wu = wb.addWorksheet(SHEET_UNITS, { views: [{ state: 'frozen', ySplit: 1 }] });
  wu.getColumn(1).width = 24;
  wu.getCell('A1').value = 'Đơn vị tính đang dùng';
  wu.getCell('A1').font = { bold: true };
  units.forEach((u, i) => { wu.getCell(`A${i + 2}`).value = u; });

  /* ---------------- Sheet 4: hướng dẫn ---------------- */
  const wg = wb.addWorksheet(SHEET_GUIDE);
  wg.getColumn(1).width = 100;
  const guide = [
    ['CÁCH ĐIỀN FILE NHẬP HÀNG HOÁ', true],
    [''],
    ['1. Điền ở sheet "Hàng hoá". Chỉ cột Tên hàng hoá (nền vàng) là bắt buộc.'],
    ['2. Nhóm hàng: bấm mũi tên ở ô để CHỌN, đừng gõ tay. Nhóm nhiều cấp có dạng "Nhóm cha > Nhóm con".'],
    ['   Nhóm chưa có thì tạo trong phần mềm (Hàng hoá → Nhóm hàng) trước, rồi tải lại file mẫu.'],
    ['3. Bỏ trống Mã hàng thì phần mềm tự cấp mã.'],
    ['4. ĐỪNG đổi định dạng cột Mã hàng và Mã vạch sang dạng Số — Excel sẽ cắt số 0 ở đầu', true],
    ['   và đổi mã dài thành dạng 8.28E+09. Hai cột này đã để sẵn dạng Văn bản.'],
    ['5. Tồn kho hiện có chỉ tính cho hàng MỚI. Nhập lại file này thì tồn kho không cộng dồn.'],
    ['6. Giá sỉ, giá thợ bỏ trống thì lấy bằng giá lẻ (hàng mới).'],
    ['7. Ba dòng đầu là hàng thật của tiệm để xem mẫu. Xoá đi trước khi nhập (để nguyên thì bị bỏ qua vì trùng mã).'],
    [''],
    ['KHI NHẬP VÀO PHẦN MỀM', true],
    ['- Phần mềm kiểm TẤT CẢ các dòng trước. Còn một dòng lỗi là CHƯA nhập dòng nào — sửa hết lỗi rồi nhập lại.'],
    ['- Nhóm gõ sai thì phần mềm gợi ý nhóm gần giống, bấm "Dùng nhóm này" là sửa ngay, không phải mở lại Excel.'],
    ['- Chế độ "Cập nhật": ô nào để trống thì giữ nguyên thông tin đang có của mặt hàng.'],
  ];
  guide.forEach(([t, bold], i) => {
    const cell = wg.getCell(`A${i + 1}`);
    cell.value = t;
    if (bold) cell.font = { bold: true, size: i === 0 ? 14 : 11 };
  });

  return wb.xlsx.writeBuffer();
}

/* ------------------------------ Đọc .xlsx ------------------------------ */

/** Giá trị một ô: số giữ nguyên kiểu số, chữ giữ nguyên từng ký tự. */
function cellValue(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    /* Ô số có định dạng "0000000000000" (tự đặt để giữ số 0) → trả đúng như Excel hiển thị */
    const fmt = String(cell.numFmt || '');
    if (/^0+$/.test(fmt) && Number.isInteger(v)) return String(v).padStart(fmt.length, '0');
    return v;
  }
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return v.result ?? '';            // ô công thức: lấy kết quả
    if ('text' in v) return String(v.text ?? '');        // ô có liên kết
    if ('error' in v) return '';
  }
  return String(v);
}

/**
 * Đọc mọi sheet có dữ liệu.
 * @returns [{ name, rows: Array<Array<string|number>> }] — rows[0] là dòng 1 của sheet
 */
export async function readWorkbook(arrayBuffer) {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);
  const sheets = [];
  wb.eachSheet((ws) => {
    const rows = [];
    const lastRow = Math.min(ws.actualRowCount ? ws.rowCount : 0, 20001);
    const lastCol = Math.min(ws.columnCount || 0, 60);
    for (let r = 1; r <= lastRow; r += 1) {
      const row = ws.getRow(r);
      const out = [];
      for (let c = 1; c <= lastCol; c += 1) out.push(cellValue(row.getCell(c)));
      rows.push(out);
    }
    /* Bỏ các dòng trống ở đuôi */
    while (rows.length && rows[rows.length - 1].every((x) => x === '')) rows.pop();
    if (rows.length) sheets.push({ name: ws.name, rows });
  });
  return sheets;
}

/* ------------------------------ Đọc CSV ------------------------------ */

/**
 * Giải mã file CSV. Excel trên Windows tiếng Việt "Lưu thành CSV" ra bảng
 * mã Windows-1258 chứ không phải UTF-8 — đọc sai là vỡ hết chữ (lỗi D4c).
 * @returns { text, encoding: 'utf-8' | 'windows-1258' }
 */
export function decodeCsv(arrayBuffer) {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(arrayBuffer), encoding: 'utf-8' };
  } catch {
    /* Bảng mã 1258 ghi dấu thanh thành ký tự rời — gộp lại cho chuẩn */
    return { text: new TextDecoder('windows-1258').decode(arrayBuffer).normalize('NFC'), encoding: 'windows-1258' };
  }
}

/**
 * Tách bảng từ CSV hoặc từ nội dung dán từ Excel.
 * Tôn trọng dấu nháy TRƯỚC khi cắt dòng: ô ghi chú có xuống dòng bên trong
 * không làm lệch các dòng phía sau (lỗi D3 của bản cũ).
 * @returns Array<Array<string>> — mỗi phần tử là một dòng của bảng
 */
export function parseTable(text) {
  /* Bỏ dấu BOM đầu file, gộp xuống dòng kiểu Windows (\r\n) về \n — kể cả
     trong ô có nháy, để ô ghi chú nhiều dòng không mang ký tự \r thừa */
  const BOM = String.fromCharCode(0xfeff);
  const src = String(text || '').replace(/\r\n?/g, '\n').replace(new RegExp(`^${BOM}`), '');
  if (!src.trim()) return [];
  /* Đoán dấu phân cách ở dòng đầu (ngoài dấu nháy) */
  let firstLine = '';
  let q = false;
  for (const ch of src) {
    if (ch === '"') q = !q;
    else if (ch === '\n' && !q) break;
    firstLine += ch;
  }
  const sep = ['\t', ';', ','].reduce((best, s) => (firstLine.split(s).length > firstLine.split(best).length ? s : best), ',');

  const rows = [];
  let row = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuote) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cur += '"'; i += 1; } else inQuote = false;
      } else cur += ch;
    } else if (ch === '"' && cur.trim() === '') {
      inQuote = true;
      cur = '';
    } else if (ch === sep) {
      row.push(cur.trim()); cur = '';
    } else if (ch === '\n') {
      row.push(cur.trim()); cur = '';
      rows.push(row); row = [];
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur.trim()); rows.push(row); }
  return rows;
}

/* ------------------------------ Tải file về ------------------------------ */

export function saveBlob(data, filename, type) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
