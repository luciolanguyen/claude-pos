/**
 * Nạp dữ liệu mẫu cho Tiệm điện Thạnh Hoà.
 *   node server/seed.js          -> chỉ nạp khi CSDL còn trống
 *   node server/seed.js --reset  -> xoá sạch rồi nạp lại
 */
import { db, all, get, run, tx, setSetting, nextCode, moveStock, addCashTx } from './db.js';

const RESET = process.argv.includes('--reset');

const TABLES = [
  'activity_log', 'stock_transfer_items', 'stock_transfers', 'stock_take_items', 'stock_takes',
  'warranty_parts', 'warranty_logs', 'warranty_photos', 'warranty_tickets',
  'draft_sales', 'production_items', 'productions', 'product_boms', 'carriers',
  'cash_transactions', 'cash_accounts', 'sale_return_items', 'sale_returns', 'sale_items', 'sales',
  'purchase_return_items', 'purchase_returns', 'purchase_items', 'purchases',
  'stock_moves', 'stock', 'product_prices', 'product_units', 'products',
  'customers', 'suppliers', 'warehouses', 'price_lists', 'categories', 'users', 'settings',
];

if (RESET) {
  db.exec('PRAGMA foreign_keys = OFF');
  for (const t of TABLES) run(`DELETE FROM ${t}`);
  run("DELETE FROM sqlite_sequence");
  db.exec('PRAGMA foreign_keys = ON');
  console.log('Đã xoá dữ liệu cũ.');
} else if (get('SELECT COUNT(*) AS n FROM products').n > 0) {
  console.log('CSDL đã có dữ liệu. Dùng "npm run reset" nếu muốn nạp lại từ đầu.');
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* Tiện ích                                                            */
/* ------------------------------------------------------------------ */
const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rnd(0, arr.length - 1)];
const chance = (p) => Math.random() < p;

/** Ngày cách hôm nay n ngày, kèm giờ mở cửa 7h-19h. */
function daysAgo(n, hour) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour ?? rnd(7, 19), rnd(0, 59), rnd(0, 59), 0);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

console.log('Đang nạp dữ liệu mẫu...');

tx(() => {
  /* ---------------------------- Thiết lập --------------------------- */
  setSetting('store', {
    name: 'TIỆM ĐIỆN THẠNH HOÀ',
    slogan: 'Chuyên thiết bị điện - nước - dân dụng',
    owner: 'Nguyễn Văn Thạnh',
    phone: '0918 456 789',
    hotline: '0918 456 789',
    address: '245 Quốc lộ 1A, Thị trấn Cái Bè, Tiền Giang',
    tax_code: '1201234567',
    bank_name: 'MB Bank - CN Tiền Giang',
    bank_account: '0918456789',
    bank_owner: 'NGUYEN VAN THANH',
    footer_note: 'Cảm ơn Quý khách! Hàng mua rồi vui lòng kiểm tra kỹ trước khi ra khỏi cửa hàng.',
    warranty_note: 'Bảo hành theo quy định của nhà sản xuất.',
  });
  setSetting('invoice', {
    default_format: 'k80',
    show_logo: true,
    show_barcode: true,
    show_qr_bank: true,
    show_cost: false,
    k80_width: 72,   // vùng in thực của giấy 80mm
    copies: 1,
    auto_print: false,
    prefix: 'HD',
  });
  setSetting('pos', {
    default_price_list: 1,
    default_warehouse: 1,
    quick_cash: [10000, 20000, 50000, 100000, 200000, 500000],
    barcode_enter_adds: true,
    ask_customer: false,
    round_to: 1000,
  });
  setSetting('warranty', {
    keep_days: 30,        // quá 30 ngày không tới lấy thì tiệm không giữ nữa
    photo_keep_days: 37,  // ảnh của phiếu đã đóng giữ 37 ngày rồi tự xoá
  });
  setSetting('allow_negative_stock', false);
  setSetting('vat_enabled', true);
  setSetting('theme', { accent: 'emerald', density: 'compact' });

  /* ---------------------------- Người dùng -------------------------- */
  const users = [
    ['chu', '1234', 'Nguyễn Văn Thạnh', 'owner', '0918456789'],
    ['hoa', '1234', 'Trần Thị Hoà', 'manager', '0918456780'],
    ['thungan', '1234', 'Lê Thị Mai', 'cashier', '0912345678'],
    ['kho', '1234', 'Phạm Văn Tùng', 'stock', '0987654321'],
  ];
  for (const u of users) {
    run('INSERT INTO users(username, password, full_name, role, phone) VALUES(?,?,?,?,?)', u);
  }

  /* ---------------------------- Nhóm hàng --------------------------- */
  const cats = [
    'Dây & cáp điện', 'Thiết bị đóng cắt', 'Ổ cắm - Công tắc', 'Đèn chiếu sáng',
    'Quạt điện', 'Thiết bị nước', 'Phụ kiện điện', 'Dụng cụ - Vật tư',
  ];
  cats.forEach((n, i) => run('INSERT INTO categories(name, sort_order) VALUES(?,?)', [n, i]));
  const C = {};
  all('SELECT id, name FROM categories').forEach((c) => { C[c.name] = c.id; });

  /* ---------------------------- Bảng giá ---------------------------- */
  run("INSERT INTO price_lists(code, name, is_default, sort_order) VALUES('LE','Giá lẻ',1,0)");
  run("INSERT INTO price_lists(code, name, is_default, sort_order) VALUES('SI','Giá sỉ',0,1)");
  run("INSERT INTO price_lists(code, name, is_default, sort_order) VALUES('THO','Giá thợ điện',0,2)");
  const PL = { LE: 1, SI: 2, THO: 3 };

  /* ------------------------------ Kho ------------------------------- */
  run("INSERT INTO warehouses(code, name, address, is_default) VALUES('KC','Kho cửa hàng','245 QL1A, Cái Bè',1)");
  run("INSERT INTO warehouses(code, name, address, is_default) VALUES('KP','Kho phụ (nhà sau)','245 QL1A, Cái Bè',0)");
  const WH = 1;

  /* ---------------------------- Quỹ tiền ---------------------------- */
  run(`INSERT INTO cash_accounts(code, name, type, opening_balance, sort_order)
       VALUES('QTM','Tiền mặt tại quầy','cash',15000000,0)`);
  run(`INSERT INTO cash_accounts(code, name, type, bank_name, account_no, opening_balance, sort_order)
       VALUES('QNH','Tài khoản MB Bank','bank','MB Bank - CN Tiền Giang','0918456789',48000000,1)`);
  const ACC_CASH = 1, ACC_BANK = 2;

  /* -------------------------- Nhà cung cấp -------------------------- */
  const suppliers = [
    ['NCC0001', 'Công ty CADIVI - CN Miền Tây', 'Anh Dũng', '02733812345', 'KCN Mỹ Tho, Tiền Giang', '1200112233', 30, 0],
    ['NCC0002', 'Đại lý Điện Quang Tiền Giang', 'Chị Lan', '0918223344', '12 Ấp Bắc, TP Mỹ Tho', '1200223344', 15, 8500000],
    ['NCC0003', 'Panasonic - NPP Sáng Tạo', 'Anh Khoa', '0908334455', '88 Nguyễn Trãi, Q5, TP.HCM', '0301334455', 30, 0],
    ['NCC0004', 'Cửa hàng VLXD Tân Phát', 'Chú Bảy', '0913445566', 'Chợ Cái Bè, Tiền Giang', null, 0, 0],
    ['NCC0005', 'Công ty TNHH Sino - Vanlock', 'Chị Thu', '02838556677', 'Bình Tân, TP.HCM', '0302556677', 45, 12300000],
    ['NCC0006', 'Đại lý Schneider Miền Tây', 'Anh Hải', '02923667788', 'Ninh Kiều, Cần Thơ', '1800667788', 30, 0],
  ];
  for (const s of suppliers) {
    run(`INSERT INTO suppliers(code, name, contact_name, phone, address, tax_code, term_days, opening_debt)
         VALUES(?,?,?,?,?,?,?,?)`, s);
  }

  /* ---------------------------- Khách hàng -------------------------- */
  const customers = [
    ['KH0001', 'Anh Tuấn - Thợ điện', '0913111222', 'Ấp 4, Hoà Khánh, Cái Bè', PL.THO, 0, 20000000, null, null],
    ['KH0002', 'Chị Hạnh - Tạp hoá Hạnh', '0918222333', 'Chợ Cái Bè', PL.SI, 2450000, 15000000, null, null],
    ['KH0003', 'Công ty TNHH Xây dựng Đại Phát', '02733999888', '15 QL1A, Cai Lậy', PL.SI, 18500000, 60000000, '0301999888', 'Công ty TNHH Xây dựng Đại Phát'],
    ['KH0004', 'Anh Nam - Thợ điện nước', '0987333444', 'Ấp 2, An Hữu', PL.THO, 0, 10000000, null, null],
    ['KH0005', 'Cô Bảy Lan', '0916444555', 'Ấp 1, Hoà Hưng', null, 0, 0, null, null],
    ['KH0006', 'Trường TH Hoà Khánh', '02733777666', 'Xã Hoà Khánh, Cái Bè', PL.SI, 0, 30000000, '1201777666', 'Trường Tiểu học Hoà Khánh'],
    ['KH0007', 'Anh Dũng - Nhà thầu', '0909555666', 'TT Cái Bè', PL.THO, 5600000, 25000000, null, null],
    ['KH0008', 'Chị Thảo', '0977666777', 'Ấp 3, Mỹ Lợi', null, 0, 0, null, null],
    ['KH0009', 'Quán cà phê Sân Vườn', '0918777888', 'QL1A, Cái Bè', null, 0, 5000000, null, null],
    ['KH0010', 'Anh Hoàng - Điện lạnh Hoàng', '0913888999', 'TT Cái Bè', PL.THO, 0, 15000000, null, null],
  ];
  for (const c of customers) {
    run(`INSERT INTO customers(code, name, phone, address, price_list_id, opening_debt, debt_limit, tax_code, company_name)
         VALUES(?,?,?,?,?,?,?,?,?)`, c);
  }

  /* ----------------------------- Sản phẩm --------------------------- */
  // [sku, tên, nhóm, đvcb, giá vốn, min, vị trí, hãng, units[[tên,hệ số]], giá [lẻ, sỉ, thợ] theo đvcb]
  /* Tên phụ: cách gọi dân dã ở tiệm, gõ không dấu vẫn tìm ra.
     Không in lên hoá đơn của khách. */
  const ALIASES = {
    DC001: 'day den 1.5, day cadivi den, day 1 ly ruoi',
    DC002: 'day do 2.5, day cadivi do, day 2 ly ruoi',
    DC003: 'day doi 1.5, day doi nho',
    DC004: 'day doi 2.5, day doi lon',
    DC005: 'cap 3 pha, cap 4 loi',
    CB001: 'cb 16, aptomat 16, cb 1 pha 16a',
    CB002: 'cb 32, aptomat 32',
    CB004: 'cb chong giat, aptomat chong giat, rcbo',
    CB006: 'tu am 8, hop dien am tuong',
    CB007: 'tu noi 4, hop dien noi',
    OC001: 'o cam doi, o dien doi',
    OC002: 'cong tac don, cong tac 1',
    DE001: 'bong 9w, den tron 9w, bong tron nho',
    DE002: 'bong 15w, den tron 15w',
    DE003: 'tuyp 1m2, den tuyp dai',
    DE006: 'den pha 50, den roi san',
    QU001: 'quat tran, quat 5 canh',
    TN006: 'may bom, bom nuoc panasonic',
    PK001: 'bang keo dien, keo den',
    PK002: 'ong ruot ga, ong mem',
    DU003: 'but thu dien, but do dien',
  };

  const P = [
    ['DC001', 'Dây điện Cadivi VCm 1x1.5 (đen)', 'Dây & cáp điện', 'Mét', 6800, 200, 'Kệ A1', 'CADIVI', [['Mét', 1], ['Cuộn 100m', 100]], [9000, 8200, 8500]],
    ['DC002', 'Dây điện Cadivi VCm 1x2.5 (đỏ)', 'Dây & cáp điện', 'Mét', 10500, 200, 'Kệ A1', 'CADIVI', [['Mét', 1], ['Cuộn 100m', 100]], [14000, 12800, 13200]],
    ['DC003', 'Dây điện Cadivi VCmd 2x1.5 (đôi)', 'Dây & cáp điện', 'Mét', 14200, 100, 'Kệ A2', 'CADIVI', [['Mét', 1], ['Cuộn 100m', 100]], [19000, 17500, 18000]],
    ['DC004', 'Dây điện Cadivi VCmd 2x2.5', 'Dây & cáp điện', 'Mét', 22500, 100, 'Kệ A2', 'CADIVI', [['Mét', 1], ['Cuộn 100m', 100]], [30000, 27500, 28500]],
    ['DC005', 'Cáp điện Cadivi CVV 3x2.5+1x1.5', 'Dây & cáp điện', 'Mét', 48000, 50, 'Kệ A3', 'CADIVI', [['Mét', 1], ['Cuộn 50m', 50]], [63000, 58000, 60000]],
    ['DC006', 'Dây mạng Cat5e UTP (cuộn 305m)', 'Dây & cáp điện', 'Mét', 3200, 100, 'Kệ A4', 'AMP', [['Mét', 1], ['Cuộn 305m', 305]], [5000, 4300, 4500]],
    ['DC007', 'Dây điện thoại 2 lõi', 'Dây & cáp điện', 'Mét', 1800, 100, 'Kệ A4', 'Sino', [['Mét', 1], ['Cuộn 100m', 100]], [3000, 2500, 2700]],

    ['CB001', 'Aptomat MCB 1P 16A Panasonic', 'Thiết bị đóng cắt', 'Cái', 68000, 10, 'Tủ B1', 'Panasonic', [['Cái', 1], ['Hộp 12 cái', 12]], [95000, 86000, 89000]],
    ['CB002', 'Aptomat MCB 1P 32A Panasonic', 'Thiết bị đóng cắt', 'Cái', 78000, 10, 'Tủ B1', 'Panasonic', [['Cái', 1], ['Hộp 12 cái', 12]], [110000, 99000, 102000]],
    ['CB003', 'Aptomat MCB 2P 40A Schneider', 'Thiết bị đóng cắt', 'Cái', 185000, 6, 'Tủ B1', 'Schneider', [['Cái', 1]], [260000, 238000, 245000]],
    ['CB004', 'Aptomat chống giật RCBO 2P 25A', 'Thiết bị đóng cắt', 'Cái', 420000, 4, 'Tủ B2', 'Panasonic', [['Cái', 1]], [580000, 535000, 550000]],
    ['CB005', 'Cầu dao đảo chiều 2P 63A', 'Thiết bị đóng cắt', 'Cái', 165000, 3, 'Tủ B2', 'Sino', [['Cái', 1]], [230000, 210000, 218000]],
    ['CB006', 'Tủ điện âm tường 8 đường', 'Thiết bị đóng cắt', 'Cái', 145000, 5, 'Kệ B3', 'Sino', [['Cái', 1]], [205000, 188000, 194000]],
    ['CB007', 'Tủ điện nổi 4 đường', 'Thiết bị đóng cắt', 'Cái', 72000, 5, 'Kệ B3', 'Sino', [['Cái', 1]], [105000, 95000, 98000]],

    ['OC001', 'Ổ cắm đôi 3 chấu Panasonic WEV', 'Ổ cắm - Công tắc', 'Cái', 58000, 15, 'Kệ C1', 'Panasonic', [['Cái', 1], ['Hộp 10 cái', 10]], [82000, 74000, 77000]],
    ['OC002', 'Công tắc đơn 1 chiều Panasonic', 'Ổ cắm - Công tắc', 'Cái', 32000, 20, 'Kệ C1', 'Panasonic', [['Cái', 1], ['Hộp 10 cái', 10]], [46000, 41000, 43000]],
    ['OC003', 'Công tắc đôi 2 chiều Panasonic', 'Ổ cắm - Công tắc', 'Cái', 52000, 15, 'Kệ C1', 'Panasonic', [['Cái', 1], ['Hộp 10 cái', 10]], [74000, 67000, 69000]],
    ['OC004', 'Mặt nạ 1 lỗ Panasonic WEV', 'Ổ cắm - Công tắc', 'Cái', 14000, 30, 'Kệ C2', 'Panasonic', [['Cái', 1], ['Hộp 20 cái', 20]], [22000, 19000, 20000]],
    ['OC005', 'Đế âm tường nhựa vuông', 'Ổ cắm - Công tắc', 'Cái', 6500, 50, 'Kệ C2', 'Sino', [['Cái', 1], ['Bịch 50 cái', 50]], [11000, 9000, 9500]],
    ['OC006', 'Ổ cắm kéo dài 5m 6 lỗ Lioa', 'Ổ cắm - Công tắc', 'Cái', 118000, 8, 'Kệ C3', 'Lioa', [['Cái', 1]], [165000, 150000, 155000]],
    ['OC007', 'Ổ cắm âm sàn inox 3 module', 'Ổ cắm - Công tắc', 'Cái', 285000, 3, 'Kệ C3', 'Sino', [['Cái', 1]], [395000, 360000, 372000]],

    ['DE001', 'Bóng LED bulb 9W Điện Quang', 'Đèn chiếu sáng', 'Cái', 26000, 30, 'Kệ D1', 'Điện Quang', [['Cái', 1], ['Thùng 50 cái', 50]], [38000, 33000, 35000]],
    ['DE002', 'Bóng LED bulb 15W Điện Quang', 'Đèn chiếu sáng', 'Cái', 42000, 25, 'Kệ D1', 'Điện Quang', [['Cái', 1], ['Thùng 50 cái', 50]], [60000, 53000, 55000]],
    ['DE003', 'Đèn tuýp LED 1m2 18W Rạng Đông', 'Đèn chiếu sáng', 'Cái', 68000, 20, 'Kệ D2', 'Rạng Đông', [['Cái', 1], ['Thùng 25 cái', 25]], [95000, 86000, 89000]],
    ['DE004', 'Máng đèn tuýp LED 1m2 đôi', 'Đèn chiếu sáng', 'Cái', 52000, 15, 'Kệ D2', 'Rạng Đông', [['Cái', 1]], [75000, 68000, 70000]],
    ['DE005', 'Đèn LED âm trần 9W tròn', 'Đèn chiếu sáng', 'Cái', 48000, 20, 'Kệ D3', 'Điện Quang', [['Cái', 1], ['Thùng 30 cái', 30]], [68000, 61000, 63000]],
    ['DE006', 'Đèn pha LED 50W ngoài trời', 'Đèn chiếu sáng', 'Cái', 168000, 8, 'Kệ D3', 'Rạng Đông', [['Cái', 1]], [235000, 215000, 222000]],
    ['DE007', 'Đèn cảm ứng hồng ngoại 12W', 'Đèn chiếu sáng', 'Cái', 132000, 6, 'Kệ D4', 'Kawa', [['Cái', 1]], [185000, 168000, 174000]],
    ['DE008', 'Đèn năng lượng mặt trời 100W', 'Đèn chiếu sáng', 'Cái', 420000, 4, 'Kệ D4', 'Jindian', [['Cái', 1]], [590000, 540000, 558000]],

    ['QU001', 'Quạt trần Panasonic 5 cánh', 'Quạt điện', 'Cái', 1450000, 2, 'Kho phụ', 'Panasonic', [['Cái', 1]], [1980000, 1830000, 1880000]],
    ['QU002', 'Quạt treo tường Asia 40cm', 'Quạt điện', 'Cái', 485000, 3, 'Kho phụ', 'Asia', [['Cái', 1]], [670000, 615000, 635000]],
    ['QU003', 'Quạt hút mùi âm trần 25cm', 'Quạt điện', 'Cái', 265000, 4, 'Kệ E1', 'Asia', [['Cái', 1]], [370000, 338000, 350000]],
    ['QU004', 'Quạt đứng Senko lửng', 'Quạt điện', 'Cái', 425000, 3, 'Kho phụ', 'Senko', [['Cái', 1]], [590000, 540000, 558000]],

    ['TN001', 'Ống nhựa PVC phi 21 Bình Minh', 'Thiết bị nước', 'Cây 4m', 28000, 20, 'Ngoài hiên', 'Bình Minh', [['Cây 4m', 1], ['Bó 10 cây', 10]], [40000, 36000, 37000]],
    ['TN002', 'Ống nhựa PVC phi 27 Bình Minh', 'Thiết bị nước', 'Cây 4m', 38000, 20, 'Ngoài hiên', 'Bình Minh', [['Cây 4m', 1], ['Bó 10 cây', 10]], [54000, 49000, 50000]],
    ['TN003', 'Co nối PVC phi 21', 'Thiết bị nước', 'Cái', 2200, 100, 'Kệ F1', 'Bình Minh', [['Cái', 1], ['Bịch 100 cái', 100]], [4000, 3200, 3500]],
    ['TN004', 'Van khoá nước đồng phi 21', 'Thiết bị nước', 'Cái', 42000, 10, 'Kệ F1', 'Việt Nam', [['Cái', 1]], [62000, 55000, 57000]],
    ['TN005', 'Vòi rửa chén inox gắn tường', 'Thiết bị nước', 'Cái', 145000, 5, 'Kệ F2', 'Inax', [['Cái', 1]], [205000, 188000, 194000]],
    ['TN006', 'Máy bơm nước Panasonic 125W', 'Thiết bị nước', 'Cái', 1280000, 2, 'Kho phụ', 'Panasonic', [['Cái', 1]], [1750000, 1620000, 1670000]],

    ['PK001', 'Băng keo điện Nano đen', 'Phụ kiện điện', 'Cuộn', 4200, 50, 'Kệ G1', 'Nano', [['Cuộn', 1], ['Hộp 10 cuộn', 10]], [7000, 5800, 6000]],
    ['PK002', 'Ống ruột gà phi 20 (cuộn 50m)', 'Phụ kiện điện', 'Mét', 3800, 100, 'Kệ G1', 'Sino', [['Mét', 1], ['Cuộn 50m', 50]], [6000, 5000, 5300]],
    ['PK003', 'Ống luồn dây cứng phi 20', 'Phụ kiện điện', 'Cây 3m', 14500, 30, 'Ngoài hiên', 'Sino', [['Cây 3m', 1], ['Bó 10 cây', 10]], [21000, 18500, 19500]],
    ['PK004', 'Kẹp giữ dây điện (bịch 100)', 'Phụ kiện điện', 'Bịch', 12000, 20, 'Kệ G2', 'Sino', [['Bịch', 1]], [20000, 17000, 18000]],
    ['PK005', 'Domino nối dây 10A', 'Phụ kiện điện', 'Cái', 8500, 30, 'Kệ G2', 'Sino', [['Cái', 1], ['Hộp 12 cái', 12]], [14000, 12000, 12500]],
    ['PK006', 'Đầu cos SC 16-8 (túi 20)', 'Phụ kiện điện', 'Túi', 22000, 15, 'Kệ G2', 'KST', [['Túi', 1]], [34000, 30000, 31000]],
    ['PK007', 'Dây rút nhựa 20cm (bịch 100)', 'Phụ kiện điện', 'Bịch', 15000, 20, 'Kệ G3', 'Việt Nam', [['Bịch', 1]], [25000, 21000, 22000]],

    ['DU001', 'Kìm điện cách điện 8 inch', 'Dụng cụ - Vật tư', 'Cái', 78000, 5, 'Kệ H1', 'Asaki', [['Cái', 1]], [115000, 103000, 107000]],
    ['DU002', 'Tua vít 2 đầu cách điện', 'Dụng cụ - Vật tư', 'Cái', 32000, 10, 'Kệ H1', 'Asaki', [['Cái', 1]], [50000, 44000, 46000]],
    ['DU003', 'Bút thử điện', 'Dụng cụ - Vật tư', 'Cái', 12000, 20, 'Kệ H1', 'Việt Nam', [['Cái', 1], ['Hộp 12 cái', 12]], [22000, 18000, 19000]],
    ['DU004', 'Đồng hồ đo điện vạn năng', 'Dụng cụ - Vật tư', 'Cái', 195000, 3, 'Kệ H2', 'Sunwa', [['Cái', 1]], [280000, 255000, 264000]],
    ['DU005', 'Thang nhôm rút 3.8m', 'Dụng cụ - Vật tư', 'Cái', 1150000, 2, 'Kho phụ', 'Nikawa', [['Cái', 1]], [1580000, 1460000, 1500000]],
    ['DU006', 'Máy khoan bê tông Bosch 13mm', 'Dụng cụ - Vật tư', 'Cái', 1420000, 2, 'Kho phụ', 'Bosch', [['Cái', 1]], [1950000, 1800000, 1860000]],
    ['DU007', 'Công lắp đặt điện dân dụng', 'Dụng cụ - Vật tư', 'Công', 0, 0, null, null, [['Công', 1]], [350000, 350000, 320000]],
  ];

  const productIds = [];
  for (const [sku, name, cat, unit, cost, min, loc, brand, units, prices] of P) {
    const isService = sku === 'DU007';
    const info = run(`
      INSERT INTO products(sku, barcode, name, alias, category_id, base_unit, cost_price, vat_rate,
                           track_stock, min_stock, brand, location)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [sku, '893' + String(rnd(1000000, 9999999)), name, ALIASES[sku] || null,
        C[cat], unit, cost, 8,
        isService ? 0 : 1, min, brand, loc]);
    const pid = Number(info.lastInsertRowid);
    productIds.push({ id: pid, sku, name, cost, units, prices, track: !isService });

    for (const [uname, factor] of units) {
      const uid = Number(run(
        'INSERT INTO product_units(product_id, unit_name, factor, is_base) VALUES(?,?,?,?)',
        [pid, uname, factor, factor === 1 ? 1 : 0]).lastInsertRowid);
      // Giá đơn vị lớn = giá đvcb * hệ số, giảm thêm ~3% khi mua nguyên cuộn/thùng
      const bulk = factor > 1 ? 0.97 : 1;
      run('INSERT INTO product_prices(product_id, price_list_id, unit_id, price) VALUES(?,?,?,?)',
        [pid, PL.LE, uid, Math.round(prices[0] * factor * bulk / 500) * 500]);
      run('INSERT INTO product_prices(product_id, price_list_id, unit_id, price) VALUES(?,?,?,?)',
        [pid, PL.SI, uid, Math.round(prices[1] * factor * bulk / 500) * 500]);
      run('INSERT INTO product_prices(product_id, price_list_id, unit_id, price) VALUES(?,?,?,?)',
        [pid, PL.THO, uid, Math.round(prices[2] * factor * bulk / 500) * 500]);
    }
  }
  console.log(`  - ${productIds.length} sản phẩm`);

  /* ------------------- Nhập kho đầu kỳ (75 ngày trước) -------------- */
  for (const p of productIds) {
    if (!p.track) continue;
    const isWire = ['Mét'].includes(p.units[0][0]);
    const qty = isWire ? rnd(500, 1300) : (p.cost > 500000 ? rnd(3, 7) : rnd(60, 160));
    moveStock({
      productId: p.id, warehouseId: WH, qtyChange: qty, unitCost: p.cost,
      refType: 'opening', note: 'Tồn kho đầu kỳ', ts: daysAgo(75, 8),
    });
  }

  /* ============ MÔ PHỎNG 70 NGÀY: nhập & bán xen kẽ theo thời gian ============ */
  const supplierIds = all('SELECT id, name FROM suppliers');
  const customerIds = all('SELECT id, name, price_list_id FROM customers');
  const cashierIds = [1, 2, 3];
  let purchaseCount = 0;
  let saleCount = 0;

  /**
   * Rổ chọn hàng có trọng số: hàng rẻ bán chạy hơn hàng giá trị cao.
   * Không có trọng số thì quạt trần 2 triệu sẽ bán ngang bóng đèn 38k.
   */
  const salesPool = [];
  for (const p of productIds) {
    const w = p.cost < 20000 ? 10
      : p.cost < 60000 ? 7
        : p.cost < 150000 ? 4
          : p.cost < 400000 ? 2
            : p.cost < 900000 ? 1 : 0;
    for (let i = 0; i < w; i++) salesPool.push(p);
    // Hàng giá trị cao vẫn bán, nhưng thưa
    if (w === 0) salesPool.push(p);
  }

  /** Tồn hiện tại (đơn vị cơ bản) của một sản phẩm tại kho chính. */
  const stockOf = (pid) =>
    get('SELECT qty FROM stock WHERE product_id = ? AND warehouse_id = ?', [pid, WH])?.qty ?? 0;

  /** Mức tồn mục tiêu: đủ bán khoảng 3-4 tuần. */
  const targetStock = (p) => {
    if (!p.track) return 0;
    const isWire = p.units[0][0] === 'Mét';
    if (isWire) return 900;
    if (p.cost > 500000) return 6;
    if (p.cost > 100000) return 40;
    return 120;
  };

  for (let d = 70; d >= 0; d--) {
    /* ---------- Nhập hàng: 2-3 ngày một lần, bù những mặt xuống thấp ---------- */
    if (d >= 1 && d % rnd(2, 3) === 0) {
      const need = productIds
        .filter((p) => p.track && stockOf(p.id) < targetStock(p) * 0.55)
        .sort(() => Math.random() - 0.5)
        .slice(0, rnd(4, 9));

      if (need.length) {
        const sup = pick(supplierIds);
        const ts = daysAgo(d, rnd(8, 16));
        let subtotal = 0;
        const rows = [];

        for (const p of need) {
          const gap = Math.max(1, targetStock(p) - stockOf(p.id));
          // Ưu tiên nhập nguyên cuộn / thùng khi lượng cần đủ lớn
          const bulk = p.units.length > 1 ? p.units[1] : null;
          let unit, factor, qty;
          if (bulk && gap >= bulk[1]) {
            unit = bulk[0]; factor = bulk[1];
            qty = Math.max(1, Math.round(gap / factor));
          } else {
            unit = p.units[0][0]; factor = 1;
            qty = Math.ceil(gap);
          }
          const price = Math.round(p.cost * factor * (1 + rnd(-3, 2) / 100) / 500) * 500;
          const amount = qty * price;
          subtotal += amount;
          rows.push({ p, unit, factor, qty, price, amount });
        }

        const vat = Math.round(subtotal * 0.08);
        const other = chance(0.4) ? rnd(50, 300) * 1000 : 0;
        const total = subtotal + vat + other;
        const paid = chance(0.65) ? total : Math.round(total * rnd(0, 60) / 100 / 1000) * 1000;
        const code = `PN${ts.slice(2, 4)}${ts.slice(5, 7)}${ts.slice(8, 10)}-${String(++purchaseCount).padStart(4, '0')}`;

        const pid = Number(run(`
          INSERT INTO purchases(code, ts, supplier_id, warehouse_id, user_id, subtotal, discount,
                                vat_amount, other_cost, total, paid, status, supplier_invoice, due_date, note)
          VALUES(?,?,?,?,?,?,0,?,?,?,?,'done',?,date(?, '+30 day'),NULL)`,
          [code, ts, sup.id, WH, 1, subtotal, vat, other, total, paid,
            chance(0.5) ? 'HDGTGT-' + rnd(10000, 99999) : null, ts]).lastInsertRowid);

        for (const row of rows) {
          const qtyBase = row.qty * row.factor;
          const share = subtotal > 0 ? (row.amount / subtotal) * other : 0;
          const unitCost = Math.round((row.amount + share) / qtyBase);
          run(`INSERT INTO purchase_items(purchase_id, product_id, unit_name, factor, qty, price, discount, vat_rate, amount)
               VALUES(?,?,?,?,?,?,0,8,?)`,
            [pid, row.p.id, row.unit, row.factor, row.qty, row.price, row.amount]);
          moveStock({
            productId: row.p.id, warehouseId: WH, qtyChange: qtyBase, unitCost,
            refType: 'purchase', refId: pid, refCode: code,
            note: `Nhập ${row.qty} ${row.unit}`, ts,
          });
        }
        if (paid > 0) {
          addCashTx({
            accountId: chance(0.6) ? ACC_BANK : ACC_CASH, direction: 'out', amount: paid,
            category: 'purchase', partnerType: 'supplier', partnerId: sup.id, partnerName: sup.name,
            refType: 'purchase', refId: pid, refCode: code, userId: 1,
            note: `Thanh toán phiếu nhập ${code}`, ts,
          });
        }
      }
    }

    /* ------------------------- Bán hàng (60 ngày gần nhất) ------------------- */
    if (d > 60) continue;
    const dow = new Date(Date.now() - d * 86400000).getDay();
    const base = dow === 0 ? rnd(4, 9) : dow === 6 ? rnd(12, 22) : rnd(8, 17);

    for (let i = 0; i < base; i++) {
      const hour = chance(0.55) ? rnd(7, 10) : chance(0.7) ? rnd(14, 17) : rnd(11, 19);
      const ts = daysAgo(d, hour);
      const isWalkIn = chance(0.45);
      const cust = isWalkIn ? null : pick(customerIds);
      const plId = cust?.price_list_id || PL.LE;

      const n = rnd(1, 6);
      const rows = [];
      let subtotal = 0, cogs = 0;
      for (let k = 0; k < n; k++) {
        const p = pick(salesPool);
        if (rows.find((x) => x.p.id === p.id)) continue;
        const u = p.units.length > 1 && chance(0.07) ? p.units[1] : p.units[0];
        const avail = p.track ? stockOf(p.id) : 9999;
        const isWire = u[0] === 'Mét';
        let qty = u[1] > 1 ? 1
          : isWire ? rnd(2, 15)
            : p.cost > 400000 ? 1
              : p.cost > 100000 ? rnd(1, 3) : rnd(1, 6);
        if (p.track && qty * u[1] > avail) qty = Math.floor(avail / u[1]);
        if (qty <= 0) continue;

        const priceRow = get(`
          SELECT pp.price FROM product_prices pp
          JOIN product_units pu ON pu.id = pp.unit_id
          WHERE pp.product_id = ? AND pp.price_list_id = ? AND pu.unit_name = ?`,
          [p.id, plId, u[0]]);
        const price = priceRow?.price || Math.round(p.prices[0] * u[1]);
        const amount = qty * price;
        subtotal += amount;
        const unitCost = get('SELECT cost_price FROM products WHERE id = ?', [p.id]).cost_price;
        cogs += Math.round(qty * u[1] * unitCost);
        rows.push({ p, unit: u[0], factor: u[1], qty, price, amount, unitCost });
      }
      if (!rows.length) continue;

      const discount = chance(0.18) ? Math.round(subtotal * rnd(1, 5) / 100 / 1000) * 1000 : 0;
      const isVat = !isWalkIn && chance(0.12);
      const vat = isVat ? Math.round((subtotal - discount) * 0.08) : 0;
      const total = subtotal - discount + vat;

      const onDebt = !isWalkIn && chance(0.22);
      const paid = onDebt ? Math.round(total * rnd(0, 50) / 100 / 1000) * 1000 : total;
      const method = onDebt ? 'debt' : (total > 500000 && chance(0.45)) ? 'transfer' : 'cash';
      const cashAmt = method === 'cash' ? paid : (method === 'debt' && chance(0.7) ? paid : 0);
      const transferAmt = paid - cashAmt;
      const code = `HD${ts.slice(2, 4)}${ts.slice(5, 7)}${ts.slice(8, 10)}-${String(++saleCount).padStart(4, '0')}`;

      const sid = Number(run(`
        INSERT INTO sales(code, ts, customer_id, warehouse_id, user_id, price_list_id, subtotal,
                          discount, vat_amount, total, cogs, paid, change_given, payment_method,
                          cash_amount, transfer_amount, status, is_vat_invoice)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,'done',?)`,
        [code, ts, cust?.id ?? null, WH, pick(cashierIds), plId, subtotal, discount, vat,
          total, cogs, paid, method, cashAmt, transferAmt, isVat ? 1 : 0]).lastInsertRowid);

      for (const row of rows) {
        run(`INSERT INTO sale_items(sale_id, product_id, name_snapshot, unit_name, factor, qty,
                                    price, discount, vat_rate, unit_cost, amount)
             VALUES(?,?,?,?,?,?,?,0,?,?,?)`,
          [sid, row.p.id, row.p.name, row.unit, row.factor, row.qty, row.price,
            isVat ? 8 : 0, row.unitCost, row.amount]);
        if (row.p.track) {
          moveStock({
            productId: row.p.id, warehouseId: WH, qtyChange: -(row.qty * row.factor),
            unitCost: row.unitCost, refType: 'sale', refId: sid, refCode: code,
            note: `Bán ${row.qty} ${row.unit}`, ts,
          });
        }
      }
      if (cashAmt > 0) {
        addCashTx({
          accountId: ACC_CASH, direction: 'in', amount: cashAmt, category: 'sale',
          partnerType: 'customer', partnerId: cust?.id ?? null, partnerName: cust?.name || 'Khách lẻ',
          refType: 'sale', refId: sid, refCode: code, note: `Thu tiền mặt hoá đơn ${code}`, ts,
        });
      }
      if (transferAmt > 0) {
        addCashTx({
          accountId: ACC_BANK, direction: 'in', amount: transferAmt, category: 'sale',
          partnerType: 'customer', partnerId: cust?.id ?? null, partnerName: cust?.name || 'Khách lẻ',
          refType: 'sale', refId: sid, refCode: code, note: `Thu chuyển khoản hoá đơn ${code}`, ts,
        });
      }
    }
  }
  console.log(`  - ${purchaseCount} phiếu nhập hàng`);
  console.log(`  - ${saleCount} hoá đơn bán hàng (60 ngày)`);

  /* -------------------------- Trả hàng khách ------------------------ */
  const recentSales = all("SELECT * FROM sales WHERE status = 'done' ORDER BY RANDOM() LIMIT 6");
  let retCount = 0;
  for (const s of recentSales) {
    const items = all('SELECT * FROM sale_items WHERE sale_id = ?', [s.id]);
    if (!items.length) continue;
    const it = pick(items);
    const qty = Math.max(1, Math.floor(it.qty / 2));
    const amount = qty * it.price;
    const ts = daysAgo(rnd(1, 20), rnd(8, 17));
    const code = `TH${ts.slice(2, 4)}${ts.slice(5, 7)}${ts.slice(8, 10)}-${String(++retCount).padStart(4, '0')}`;
    const rid = Number(run(`
      INSERT INTO sale_returns(code, ts, sale_id, customer_id, warehouse_id, user_id,
                               subtotal, fee, total, refunded, reason)
      VALUES(?,?,?,?,?,1,?,0,?,?,?)`,
      [code, ts, s.id, s.customer_id, WH, amount, amount, amount,
        pick(['Hàng lỗi không dùng được', 'Khách mua nhầm quy cách', 'Dư hàng sau khi thi công'])
      ]).lastInsertRowid);
    run(`INSERT INTO sale_return_items(return_id, product_id, unit_name, factor, qty, price, unit_cost, amount)
         VALUES(?,?,?,?,?,?,?,?)`,
      [rid, it.product_id, it.unit_name, it.factor, qty, it.price, it.unit_cost, amount]);
    moveStock({
      productId: it.product_id, warehouseId: WH, qtyChange: qty * it.factor,
      unitCost: it.unit_cost, refType: 'sale_return', refId: rid, refCode: code,
      note: `Khách trả ${qty} ${it.unit_name}`, ts,
    });
    addCashTx({
      accountId: ACC_CASH, direction: 'out', amount, category: 'sale_return',
      partnerType: 'customer', partnerId: s.customer_id, refType: 'sale_return', refId: rid,
      refCode: code, note: `Hoàn tiền trả hàng ${code}`, ts,
    });
  }
  console.log(`  - ${retCount} phiếu khách trả hàng`);

  /* ------------------------ Trả hàng cho NCC ------------------------ */
  for (let i = 0; i < 3; i++) {
    const pur = get("SELECT * FROM purchases WHERE status = 'done' ORDER BY RANDOM() LIMIT 1");
    if (!pur) break;
    const it = get('SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY RANDOM() LIMIT 1', [pur.id]);
    if (!it) continue;
    const st = get('SELECT qty FROM stock WHERE product_id = ? AND warehouse_id = ?', [it.product_id, WH]);
    const qty = 1;
    if ((st?.qty ?? 0) < qty * it.factor) continue;
    const ts = daysAgo(rnd(2, 30), rnd(8, 16));
    const amount = qty * it.price;
    const code = `TNCC${ts.slice(2, 4)}${ts.slice(5, 7)}${ts.slice(8, 10)}-000${i + 1}`;
    const rid = Number(run(`
      INSERT INTO purchase_returns(code, ts, purchase_id, supplier_id, warehouse_id, user_id,
                                   subtotal, total, refunded, reason)
      VALUES(?,?,?,?,?,1,?,?,?,?)`,
      [code, ts, pur.id, pur.supplier_id, WH, amount, amount, amount,
        pick(['Hàng giao bị lỗi', 'Sai quy cách đặt hàng', 'Bao bì hư hỏng'])]).lastInsertRowid);
    run(`INSERT INTO purchase_return_items(return_id, product_id, unit_name, factor, qty, price, amount)
         VALUES(?,?,?,?,?,?,?)`, [rid, it.product_id, it.unit_name, it.factor, qty, it.price, amount]);
    moveStock({
      productId: it.product_id, warehouseId: WH, qtyChange: -(qty * it.factor),
      unitCost: it.price / it.factor, refType: 'purchase_return', refId: rid, refCode: code,
      note: `Trả NCC ${qty} ${it.unit_name}`, ts,
    });
  }

  /* ---------------------- Chi phí vận hành -------------------------- */
  for (let m = 2; m >= 0; m--) {
    const day = daysAgo(m * 30 + 3, 9);
    addCashTx({ accountId: ACC_CASH, direction: 'out', amount: 6000000, category: 'rent',
      note: 'Tiền thuê mặt bằng', ts: day, userId: 1 });
    addCashTx({ accountId: ACC_CASH, direction: 'out', amount: rnd(850, 1400) * 1000,
      category: 'utility', note: 'Tiền điện, nước, internet', ts: daysAgo(m * 30 + 5, 10), userId: 1 });
    addCashTx({ accountId: ACC_BANK, direction: 'out', amount: 13000000, category: 'salary',
      note: 'Lương nhân viên', ts: daysAgo(m * 30 + 2, 17), userId: 1 });
    addCashTx({ accountId: ACC_CASH, direction: 'out', amount: rnd(300, 800) * 1000,
      category: 'transport', note: 'Xăng xe giao hàng', ts: daysAgo(m * 30 + 12, 15), userId: 1 });
  }
  addCashTx({ accountId: ACC_CASH, direction: 'out', amount: 1500000, category: 'tax',
    note: 'Thuế khoán hộ kinh doanh quý', ts: daysAgo(20, 9), userId: 1 });

  // Chủ rút lãi về chi tiêu gia đình -> quỹ không phình vô lý
  for (let m = 2; m >= 0; m--) {
    addCashTx({ accountId: ACC_CASH, direction: 'out', amount: rnd(10, 16) * 1000000,
      category: 'capital_out', note: 'Chủ rút lãi về chi tiêu gia đình',
      ts: daysAgo(m * 30 + 1, 18), userId: 1 });
    addCashTx({ accountId: ACC_BANK, direction: 'out', amount: rnd(15, 25) * 1000000,
      category: 'capital_out', note: 'Chuyển lợi nhuận về tài khoản cá nhân',
      ts: daysAgo(m * 30 + 8, 16), userId: 1 });
  }

  /* ---------------------- Khách trả nợ ------------------------------ */
  for (const c of all('SELECT id, name FROM customers ORDER BY RANDOM() LIMIT 4')) {
    addCashTx({
      accountId: chance(0.5) ? ACC_CASH : ACC_BANK, direction: 'in',
      amount: rnd(500, 4000) * 1000, category: 'debt_in',
      partnerType: 'customer', partnerId: c.id, partnerName: c.name,
      note: `Khách ${c.name} trả nợ`, ts: daysAgo(rnd(1, 25), rnd(8, 17)), userId: 1,
    });
  }

  /* ---------------------- Đơn vị vận chuyển ------------------------- */
  const carriers = [
    ['VC001', 'Nhà xe Thành Bưởi', 'Anh Sáu', '02838300100', 'Tuyến Cái Bè - Sài Gòn, 2 chuyến/ngày'],
    ['VC002', 'Viettel Post Cái Bè', 'Chị Nhung', '02733823456', 'Nhận tại bưu cục, giao toàn quốc'],
    ['VC003', 'Shipper Tí (xe máy)', 'Em Tí', '0919888777', 'Giao trong huyện, dưới 20km'],
  ];
  carriers.forEach((c, i) =>
    run('INSERT INTO carriers(code, name, contact_name, phone, note, sort_order) VALUES(?,?,?,?,?,?)',
      [c[0], c[1], c[2], c[3], c[4], i]));

  /* ------- Thành phẩm tự lắp ráp: định mức + hai phiếu sản xuất ------- */
  const findId = (sku) => get('SELECT id FROM products WHERE sku = ?', [sku])?.id;

  const tuDien = Number(run(`
    INSERT INTO products(sku, barcode, name, alias, category_id, base_unit, cost_price,
                         vat_rate, track_stock, min_stock, brand, location, is_manufactured)
    VALUES('TP001', ?, 'Tủ điện 8 đường lắp sẵn', 'tu dien lap san, tu 8 duong, tu dien 8',
           ?, 'Bộ', 0, 8, 1, 2, 'Tiệm tự lắp', 'Kệ B3', 1)`,
    ['893' + rnd(1000000, 9999999), C['Thiết bị đóng cắt']]).lastInsertRowid);

  const tuUnit = Number(run(
    "INSERT INTO product_units(product_id, unit_name, factor, is_base) VALUES(?,'Bộ',1,1)",
    [tuDien]).lastInsertRowid);
  [[PL.LE, 1450000], [PL.SI, 1350000], [PL.THO, 1390000]].forEach(([pl, price]) =>
    run('INSERT INTO product_prices(product_id, price_list_id, unit_id, price) VALUES(?,?,?,?)',
      [tuDien, pl, tuUnit, price]));

  // 1 tủ = 1 vỏ tủ âm 8 đường + 8 aptomat 16A + 5m dây 2.5 + 2 domino
  const bomLines = [
    [findId('CB006'), 1],
    [findId('CB001'), 8],
    [findId('DC002'), 5],
    [findId('PK005'), 2],
  ].filter((x) => x[0]);
  for (const [cid, q] of bomLines) {
    run('INSERT INTO product_boms(product_id, component_id, qty) VALUES(?,?,?)', [tuDien, cid, q]);
  }

  let sxSeq = 0;
  for (const [daysBack, wantQty, labor] of [[18, 3, 450000], [6, 2, 300000]]) {
    const ts = daysAgo(daysBack, rnd(9, 15));
    // Kho sau 60 ngày bán có thể thiếu linh kiện — làm bớt lại thay vì bỏ hẳn phiếu,
    // để dữ liệu mẫu luôn có ví dụ về sản xuất cho chủ tiệm xem.
    const canMake = Math.min(...bomLines.map(([cid, per]) =>
      Math.floor((get('SELECT qty FROM stock WHERE product_id = ? AND warehouse_id = ?', [cid, WH])?.qty ?? 0) / per)));
    const madeQty = Math.min(wantQty, canMake);
    if (madeQty < 1) continue;

    const lines = bomLines.map(([cid, per]) => {
      const cost = get('SELECT cost_price FROM products WHERE id = ?', [cid]).cost_price;
      const need = per * madeQty;
      return { cid, need, cost, amount: Math.round(need * cost) };
    });

    const materialCost = lines.reduce((a, l) => a + l.amount, 0);
    const totalCost = materialCost + labor;
    const unitCost = Math.round(totalCost / madeQty);
    const code = 'SX' + ts.slice(2, 4) + ts.slice(5, 7) + ts.slice(8, 10) +
      '-' + String(++sxSeq).padStart(4, '0');

    const prodId = Number(run(`
      INSERT INTO productions(code, ts, kind, warehouse_id, user_id, product_id, qty,
                              material_cost, labor_cost, total_cost, unit_cost, note)
      VALUES(?,?,'assemble',?,4,?,?,?,?,?,?,'Lắp theo đơn đặt của nhà thầu')`,
      [code, ts, WH, tuDien, madeQty, materialCost, labor, totalCost, unitCost]).lastInsertRowid);

    for (const l of lines) {
      run(`INSERT INTO production_items(production_id, component_id, qty, unit_cost, amount)
           VALUES(?,?,?,?,?)`, [prodId, l.cid, l.need, l.cost, l.amount]);
      moveStock({
        productId: l.cid, warehouseId: WH, qtyChange: -l.need, unitCost: l.cost,
        refType: 'production', refId: prodId, refCode: code,
        note: 'Dùng lắp tủ điện 8 đường', ts,
      });
    }
    moveStock({
      productId: tuDien, warehouseId: WH, qtyChange: madeQty, unitCost,
      refType: 'production', refId: prodId, refCode: code,
      note: 'Sản xuất ' + madeQty + ' bộ', ts,
    });
    run('UPDATE products SET cost_price = ? WHERE id = ?', [unitCost, tuDien]);
  }

  /* ---------------------- Phiếu kiểm kê mẫu ------------------------- */
  const takeTs = daysAgo(10, 18);
  const takeId = Number(run(`
    INSERT INTO stock_takes(code, ts, warehouse_id, user_id, status, note)
    VALUES('KK' || ?, ?, ?, 4, 'balanced', 'Kiểm kê định kỳ cuối tháng')`,
    [takeTs.slice(2, 4) + takeTs.slice(5, 7) + takeTs.slice(8, 10) + '-0001', takeTs, WH]
  ).lastInsertRowid);
  for (const p of all('SELECT id, cost_price FROM products WHERE track_stock = 1 ORDER BY RANDOM() LIMIT 12')) {
    const sys = get('SELECT qty FROM stock WHERE product_id = ? AND warehouse_id = ?', [p.id, WH])?.qty ?? 0;
    const diff = chance(0.35) ? rnd(-3, 2) : 0;
    run(`INSERT INTO stock_take_items(take_id, product_id, system_qty, actual_qty, diff_qty, unit_cost)
         VALUES(?,?,?,?,?,?)`, [takeId, p.id, sys, sys + diff, diff, p.cost_price]);
  }
});

const n = (t) => get(`SELECT COUNT(*) AS n FROM ${t}`).n;
console.log('');
console.log('Hoàn tất. Tổng kết:');
console.log(`  sản phẩm ${n('products')} | khách hàng ${n('customers')} | NCC ${n('suppliers')}`);
console.log(`  hoá đơn ${n('sales')} | phiếu nhập ${n('purchases')} | phiếu quỹ ${n('cash_transactions')}`);
console.log(`  biến động kho ${n('stock_moves')} | phiếu sản xuất ${n('productions')} | nhà xe ${n('carriers')}`);
console.log('');
console.log('  Đăng nhập: chu / 1234  (Chủ cửa hàng)');
console.log('             thungan / 1234  (Thu ngân)');
console.log('');
