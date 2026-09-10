-- ============================================================
-- THANH HOA POS - Luoc do CSDL (SQLite)
-- Ton kho LUON luu theo don vi co ban cua san pham.
-- Tien te: luu so nguyen VND (khong phan thap phan).
-- ============================================================

PRAGMA foreign_keys = ON;

-- ---------- Thiet lap chung (key/value) ----------
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ---------- Nguoi dung & phan quyen ----------
CREATE TABLE IF NOT EXISTS users (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  username  TEXT NOT NULL UNIQUE,
  password  TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role      TEXT NOT NULL DEFAULT 'cashier', -- owner | manager | cashier | stock
  phone     TEXT,
  active    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------- Nhom hang ----------
CREATE TABLE IF NOT EXISTS categories (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ---------- Bang gia (le / si / tho dien) ----------
CREATE TABLE IF NOT EXISTS price_lists (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ---------- Kho ----------
CREATE TABLE IF NOT EXISTS warehouses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  address    TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1
);

-- ---------- San pham ----------
CREATE TABLE IF NOT EXISTS products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sku          TEXT NOT NULL UNIQUE,
  barcode      TEXT,
  name         TEXT NOT NULL,
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  base_unit    TEXT NOT NULL DEFAULT 'Cai',
  cost_price   INTEGER NOT NULL DEFAULT 0,
  vat_rate     INTEGER NOT NULL DEFAULT 8,
  track_stock  INTEGER NOT NULL DEFAULT 1,
  min_stock    REAL NOT NULL DEFAULT 0,
  max_stock    REAL NOT NULL DEFAULT 0,
  brand        TEXT,
  location     TEXT,
  note         TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);

-- ---------- Don vi quy doi (1 Cuon = 100 Met) ----------
CREATE TABLE IF NOT EXISTS product_units (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_name  TEXT NOT NULL,
  factor     REAL NOT NULL DEFAULT 1,
  is_base    INTEGER NOT NULL DEFAULT 0,
  barcode    TEXT,
  UNIQUE(product_id, unit_name)
);

-- ---------- Gia ban theo bang gia + don vi ----------
CREATE TABLE IF NOT EXISTS product_prices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price_list_id INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  unit_id       INTEGER NOT NULL REFERENCES product_units(id) ON DELETE CASCADE,
  price         INTEGER NOT NULL DEFAULT 0,
  UNIQUE(product_id, price_list_id, unit_id)
);

-- ---------- Nha cung cap ----------
CREATE TABLE IF NOT EXISTS suppliers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  contact_name TEXT,
  phone        TEXT,
  email        TEXT,
  address      TEXT,
  tax_code     TEXT,
  bank_account TEXT,
  opening_debt INTEGER NOT NULL DEFAULT 0,
  term_days    INTEGER NOT NULL DEFAULT 0,
  note         TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------- Khach hang ----------
CREATE TABLE IF NOT EXISTS customers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  tax_code      TEXT,
  company_name  TEXT,
  price_list_id INTEGER REFERENCES price_lists(id) ON DELETE SET NULL,
  opening_debt  INTEGER NOT NULL DEFAULT 0,
  debt_limit    INTEGER NOT NULL DEFAULT 0,
  birthday      TEXT,
  note          TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

-- ---------- Ton kho hien tai ----------
CREATE TABLE IF NOT EXISTS stock (
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  qty          REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, warehouse_id)
);

-- ---------- So the kho (moi bien dong) ----------
CREATE TABLE IF NOT EXISTS stock_moves (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  qty_change   REAL NOT NULL,
  balance      REAL NOT NULL DEFAULT 0,
  unit_cost    INTEGER NOT NULL DEFAULT 0,
  ref_type     TEXT NOT NULL,
  ref_id       INTEGER,
  ref_code     TEXT,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_moves_product ON stock_moves(product_id, ts);
CREATE INDEX IF NOT EXISTS idx_moves_ref ON stock_moves(ref_type, ref_id);

-- ---------- Phieu nhap hang ----------
CREATE TABLE IF NOT EXISTS purchases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  ts           TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  supplier_id  INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  subtotal     INTEGER NOT NULL DEFAULT 0,
  discount     INTEGER NOT NULL DEFAULT 0,
  vat_amount   INTEGER NOT NULL DEFAULT 0,
  other_cost   INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0,
  paid         INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'done',
  supplier_invoice TEXT,
  due_date     TEXT,
  note         TEXT
);
CREATE TABLE IF NOT EXISTS purchase_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  unit_name   TEXT NOT NULL,
  factor      REAL NOT NULL DEFAULT 1,
  qty         REAL NOT NULL,
  price       INTEGER NOT NULL,
  discount    INTEGER NOT NULL DEFAULT 0,
  vat_rate    INTEGER NOT NULL DEFAULT 0,
  amount      INTEGER NOT NULL DEFAULT 0
);

-- ---------- Phieu tra hang nha cung cap ----------
CREATE TABLE IF NOT EXISTS purchase_returns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  ts           TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  purchase_id  INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
  supplier_id  INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  subtotal     INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0,
  refunded     INTEGER NOT NULL DEFAULT 0,
  reason       TEXT,
  note         TEXT
);
CREATE TABLE IF NOT EXISTS purchase_return_items (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  unit_name TEXT NOT NULL,
  factor    REAL NOT NULL DEFAULT 1,
  qty       REAL NOT NULL,
  price     INTEGER NOT NULL,
  amount    INTEGER NOT NULL DEFAULT 0
);

-- ---------- Hoa don ban hang ----------
CREATE TABLE IF NOT EXISTS sales (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  ts            TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  customer_id   INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id),
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  price_list_id INTEGER REFERENCES price_lists(id) ON DELETE SET NULL,
  subtotal      INTEGER NOT NULL DEFAULT 0,
  discount      INTEGER NOT NULL DEFAULT 0,
  vat_amount    INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,
  cogs          INTEGER NOT NULL DEFAULT 0,
  paid          INTEGER NOT NULL DEFAULT 0,
  change_given  INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  cash_amount   INTEGER NOT NULL DEFAULT 0,
  transfer_amount INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'done',
  is_vat_invoice INTEGER NOT NULL DEFAULT 0,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_sales_ts ON sales(ts);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);

CREATE TABLE IF NOT EXISTS sale_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id    INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  name_snapshot TEXT NOT NULL,
  unit_name  TEXT NOT NULL,
  factor     REAL NOT NULL DEFAULT 1,
  qty        REAL NOT NULL,
  price      INTEGER NOT NULL,
  discount   INTEGER NOT NULL DEFAULT 0,
  vat_rate   INTEGER NOT NULL DEFAULT 0,
  unit_cost  INTEGER NOT NULL DEFAULT 0,
  amount     INTEGER NOT NULL DEFAULT 0
);

-- ---------- Tra hang cua khach ----------
CREATE TABLE IF NOT EXISTS sale_returns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  ts           TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  sale_id      INTEGER REFERENCES sales(id) ON DELETE SET NULL,
  customer_id  INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  subtotal     INTEGER NOT NULL DEFAULT 0,
  fee          INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0,
  refunded     INTEGER NOT NULL DEFAULT 0,
  reason       TEXT,
  note         TEXT
);
CREATE TABLE IF NOT EXISTS sale_return_items (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  unit_name TEXT NOT NULL,
  factor    REAL NOT NULL DEFAULT 1,
  qty       REAL NOT NULL,
  price     INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  amount    INTEGER NOT NULL DEFAULT 0
);

-- ---------- Quy tien ----------
CREATE TABLE IF NOT EXISTS cash_accounts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  code     TEXT NOT NULL UNIQUE,
  name     TEXT NOT NULL,
  type     TEXT NOT NULL DEFAULT 'cash',
  bank_name TEXT,
  account_no TEXT,
  opening_balance INTEGER NOT NULL DEFAULT 0,
  active   INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cash_transactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  ts         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  account_id INTEGER NOT NULL REFERENCES cash_accounts(id),
  direction  TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  category   TEXT NOT NULL,
  partner_type TEXT,
  partner_id INTEGER,
  partner_name TEXT,
  ref_type   TEXT,
  ref_id     INTEGER,
  ref_code   TEXT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_cash_ts ON cash_transactions(ts);

-- ---------- Kiem ke kho ----------
CREATE TABLE IF NOT EXISTS stock_takes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  ts           TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'draft',
  total_diff_value INTEGER NOT NULL DEFAULT 0,
  note         TEXT
);
CREATE TABLE IF NOT EXISTS stock_take_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  take_id    INTEGER NOT NULL REFERENCES stock_takes(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  system_qty REAL NOT NULL DEFAULT 0,
  actual_qty REAL NOT NULL DEFAULT 0,
  diff_qty   REAL NOT NULL DEFAULT 0,
  unit_cost  INTEGER NOT NULL DEFAULT 0,
  note       TEXT
);

-- ---------- Chuyen kho ----------
CREATE TABLE IF NOT EXISTS stock_transfers (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  code      TEXT NOT NULL UNIQUE,
  ts        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  from_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  to_warehouse_id   INTEGER NOT NULL REFERENCES warehouses(id),
  user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note      TEXT
);
CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  qty         REAL NOT NULL
);

-- ---------- Nhat ky hoat dong ----------
CREATE TABLE IF NOT EXISTS activity_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  user_id INTEGER,
  user_name TEXT,
  action  TEXT NOT NULL,
  entity  TEXT,
  entity_id INTEGER,
  detail  TEXT
);

-- ============================================================
-- MỞ RỘNG v2: sản xuất, giao hàng, hoá đơn tạm, tem mã vạch
-- ============================================================

-- ---------- Đối tác vận chuyển ----------
CREATE TABLE IF NOT EXISTS carriers (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  code     TEXT NOT NULL UNIQUE,
  name     TEXT NOT NULL,
  phone    TEXT,
  contact_name TEXT,
  note     TEXT,
  active   INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ---------- Định mức nguyên vật liệu (BOM) ----------
-- 1 tủ điện 8 đường = 1 vỏ tủ + 8 aptomat + 3m dây + 1 domino
CREATE TABLE IF NOT EXISTS product_boms (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty          REAL NOT NULL DEFAULT 1,   -- số lượng theo đơn vị cơ bản của linh kiện
  note         TEXT,
  UNIQUE(product_id, component_id)
);

-- ---------- Phiếu sản xuất ----------
-- kind = 'assemble' (lắp ráp theo định mức) | 'split' (chia nhỏ / cắt lẻ)
CREATE TABLE IF NOT EXISTS productions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  ts           TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  kind         TEXT NOT NULL DEFAULT 'assemble',
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  product_id   INTEGER NOT NULL REFERENCES products(id),  -- thành phẩm
  qty          REAL NOT NULL DEFAULT 1,                   -- số thành phẩm làm ra
  material_cost INTEGER NOT NULL DEFAULT 0,               -- tổng giá vốn nguyên liệu
  labor_cost   INTEGER NOT NULL DEFAULT 0,                -- chi phí nhân công
  total_cost   INTEGER NOT NULL DEFAULT 0,
  unit_cost    INTEGER NOT NULL DEFAULT 0,                -- giá vốn 1 thành phẩm
  note         TEXT
);
CREATE TABLE IF NOT EXISTS production_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  production_id INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  component_id  INTEGER NOT NULL REFERENCES products(id),
  qty           REAL NOT NULL,        -- tổng số dùng, theo đơn vị cơ bản
  unit_cost     INTEGER NOT NULL DEFAULT 0,
  amount        INTEGER NOT NULL DEFAULT 0
);

-- ---------- Hoá đơn tạm (lưu dở, dùng chung mọi máy) ----------
CREATE TABLE IF NOT EXISTS draft_sales (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  ts          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  title       TEXT,                  -- tên tab: "Hoá đơn 1", "Anh Tuấn đặt"
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  warehouse_id  INTEGER,
  price_list_id INTEGER,
  total       INTEGER NOT NULL DEFAULT 0,
  item_count  INTEGER NOT NULL DEFAULT 0,
  payload     TEXT NOT NULL          -- toàn bộ giỏ hàng dạng JSON
);
CREATE INDEX IF NOT EXISTS idx_drafts_updated ON draft_sales(updated_at);

-- ============================================================
-- MỞ RỘNG v3: quản lý hàng bảo hành
-- ============================================================

-- ---------- Phiếu tiếp nhận bảo hành ----------
-- Khách mang máy hư tới, tiệm lập phiếu này và in biên nhận cho khách giữ.
CREATE TABLE IF NOT EXISTS warranty_tickets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  ts            TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  customer_id   INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT,                 -- khách lẻ không có hồ sơ thì ghi tay
  customer_phone TEXT,
  sale_id       INTEGER REFERENCES sales(id) ON DELETE SET NULL,   -- hoá đơn gốc nếu tra được
  product_id    INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name  TEXT NOT NULL,        -- ghi tay được, phòng hàng mua nơi khác
  serial        TEXT,
  qty           REAL NOT NULL DEFAULT 1,
  issue         TEXT,                 -- lỗi khách báo
  condition_note TEXT,                -- tình trạng máy lúc nhận (trầy, thiếu ốc...)
  accessories   TEXT,                 -- phụ kiện kèm theo: dây, phích, hộp
  in_warranty   INTEGER NOT NULL DEFAULT 0,   -- còn hạn bảo hành hay không
  warranty_until TEXT,
  status        TEXT NOT NULL DEFAULT 'received',
    -- received: đã nhận | checking: đang kiểm tra | repairing: đang sửa
    -- sent_supplier: đã gửi hãng | ready: sửa xong chờ khách lấy
    -- delivered: đã trả khách | cancelled: huỷ
  resolution    TEXT,
    -- repair: tiệm sửa | supplier: hãng sửa | exchange: đổi mới
    -- refund: hoàn tiền | reject: từ chối bảo hành
  supplier_id   INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  sent_at       TEXT,                 -- ngày gửi hãng
  expected_at   TEXT,                 -- hãng hẹn trả
  back_at       TEXT,                 -- ngày nhận lại từ hãng
  promised_at   TEXT,                 -- hẹn trả khách
  delivered_at  TEXT,                 -- đã trả khách
  exchange_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  labor_fee     INTEGER NOT NULL DEFAULT 0,   -- tiền công sửa
  parts_cost    INTEGER NOT NULL DEFAULT 0,   -- giá vốn linh kiện đã thay
  charge        INTEGER NOT NULL DEFAULT 0,   -- tiền thu của khách (hết hạn BH)
  paid          INTEGER NOT NULL DEFAULT 0,
  refund_amount INTEGER NOT NULL DEFAULT 0,
  received_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_wt_status ON warranty_tickets(status);
CREATE INDEX IF NOT EXISTS idx_wt_phone ON warranty_tickets(customer_phone);
CREATE INDEX IF NOT EXISTS idx_wt_ts ON warranty_tickets(ts);

-- ---------- Ảnh chụp lúc nhận và lúc trả ----------
-- Lưu tên file, ảnh nằm trong data/warranty/ để CSDL không phình to.
CREATE TABLE IF NOT EXISTS warranty_photos (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES warranty_tickets(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL DEFAULT 'received',  -- received | done
  file      TEXT NOT NULL,
  caption   TEXT,
  ts        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_wp_ticket ON warranty_photos(ticket_id);

-- ---------- Nhật ký chuyển trạng thái ----------
CREATE TABLE IF NOT EXISTS warranty_logs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES warranty_tickets(id) ON DELETE CASCADE,
  ts        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  status    TEXT NOT NULL,
  user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note      TEXT
);
CREATE INDEX IF NOT EXISTS idx_wl_ticket ON warranty_logs(ticket_id);

-- ---------- Linh kiện đã thay khi sửa (trừ kho) ----------
CREATE TABLE IF NOT EXISTS warranty_parts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id  INTEGER NOT NULL REFERENCES warranty_tickets(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty        REAL NOT NULL,
  unit_cost  INTEGER NOT NULL DEFAULT 0,
  amount     INTEGER NOT NULL DEFAULT 0
);

-- ================= DAT HANG CUA KHACH =================
-- Khach dat truoc, tiem giao sau. Mot don co the giao nhieu dot,
-- moi dot sinh ra mot hoa don ban hang rieng.
CREATE TABLE IF NOT EXISTS sale_orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  ts            TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  customer_id   INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT,                      -- khach vang lai, chua tao ho so
  customer_phone TEXT,
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id),
  price_list_id INTEGER REFERENCES price_lists(id) ON DELETE SET NULL,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  promised_at   TEXT,                      -- ngay hen giao
  status        TEXT NOT NULL DEFAULT 'open',  -- open | partial | done | cancelled
  subtotal      INTEGER NOT NULL DEFAULT 0,
  discount      INTEGER NOT NULL DEFAULT 0,
  discount_type TEXT NOT NULL DEFAULT 'amount',
  discount_percent REAL NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,
  deposit       INTEGER NOT NULL DEFAULT 0,  -- tong da coc, cong don qua cac lan
  deposit_used  INTEGER NOT NULL DEFAULT 0,  -- da tru vao hoa don giao hang
  delivery_name TEXT,
  delivery_phone TEXT,
  delivery_address TEXT,
  carrier_id    INTEGER REFERENCES carriers(id) ON DELETE SET NULL,
  note          TEXT,
  closed_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_so_ts ON sale_orders(ts);
CREATE INDEX IF NOT EXISTS idx_so_customer ON sale_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_so_status ON sale_orders(status);

CREATE TABLE IF NOT EXISTS sale_order_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES sale_orders(id) ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  name_snapshot TEXT NOT NULL,
  unit_name     TEXT NOT NULL,
  factor        REAL NOT NULL DEFAULT 1,
  qty           REAL NOT NULL,             -- so luong dat, theo don vi tren
  delivered_qty REAL NOT NULL DEFAULT 0,   -- da giao bao nhieu, cung don vi
  price         INTEGER NOT NULL,
  discount      INTEGER NOT NULL DEFAULT 0,
  discount_type TEXT NOT NULL DEFAULT 'amount',
  discount_percent REAL NOT NULL DEFAULT 0,
  amount        INTEGER NOT NULL DEFAULT 0,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_soi_order ON sale_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_soi_product ON sale_order_items(product_id);

-- Moi dot giao: noi don dat voi hoa don da xuat
CREATE TABLE IF NOT EXISTS sale_order_deliveries (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id  INTEGER NOT NULL REFERENCES sale_orders(id) ON DELETE CASCADE,
  sale_id   INTEGER REFERENCES sales(id) ON DELETE SET NULL,
  ts        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deposit_applied INTEGER NOT NULL DEFAULT 0,
  note      TEXT
);
CREATE INDEX IF NOT EXISTS idx_sod_order ON sale_order_deliveries(order_id);

-- ============================================================
-- MO RONG v12: nhieu moi cho mot mat hang, phieu bao het hang,
--              phieu tam dung chung
-- ============================================================

-- ---------- Mot mat hang mua duoc cua nhieu moi ----------
-- Cung mot cai aptomat, cho nay 68k cho kia 71k nhung giao nhanh hon.
-- Danh dau mot moi la "uu tien chinh" de phieu bao het hang tu chon san.
CREATE TABLE IF NOT EXISTS product_suppliers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  supplier_sku TEXT,                        -- ma hang ben moi, de doc don cho nhanh
  last_price  INTEGER NOT NULL DEFAULT 0,   -- gia nhap gan nhat cua moi nay
  note        TEXT,
  UNIQUE(product_id, supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_ps_product ON product_suppliers(product_id);
CREATE INDEX IF NOT EXISTS idx_ps_supplier ON product_suppliers(supplier_id);

-- ---------- Phieu bao het hang ----------
-- Nhan vien di kiem quay, ghi lai mon nao can nhap them.
CREATE TABLE IF NOT EXISTS requisitions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  ts           TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'open',   -- open | done | cancelled
  note         TEXT,
  adjusted_at  TEXT,                            -- lan cuoi can bang kho tu phieu nay
  split_at     TEXT,                            -- lan cuoi tach phieu nhap tam
  closed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_req_ts ON requisitions(ts);
CREATE INDEX IF NOT EXISTS idx_req_status ON requisitions(status);

CREATE TABLE IF NOT EXISTS requisition_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  requisition_id INTEGER NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
  product_id     INTEGER NOT NULL REFERENCES products(id),
  name_snapshot  TEXT NOT NULL,
  unit_name      TEXT NOT NULL,
  system_qty     REAL NOT NULL DEFAULT 0,       -- ton kho may ghi luc lap phieu
  actual_qty     REAL,                          -- ton dem duoc ngoai quay; NULL = chua dem
  buy_qty        REAL NOT NULL DEFAULT 0,       -- so luong du mua
  adjusted       INTEGER NOT NULL DEFAULT 0,    -- da can bang kho theo dong nay chua
  adjust_move_id INTEGER,                       -- the kho sinh ra khi can bang
  note           TEXT
);
CREATE INDEX IF NOT EXISTS idx_reqi_req ON requisition_items(requisition_id);

-- Moi nao duoc chon cho tung dong hang (co the chon nhieu moi)
CREATE TABLE IF NOT EXISTS requisition_item_suppliers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     INTEGER NOT NULL REFERENCES requisition_items(id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  UNIQUE(item_id, supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_reqis_item ON requisition_item_suppliers(item_id);

-- ---------- Phieu tam dung chung cho moi loai chung tu ----------
-- draft_sales chi luu duoc gio hang cua man hinh ban. Bang nay luu duoc
-- moi loai phieu dang lam do: nhap hang, tra hang, lap rap, kiem ke...
CREATE TABLE IF NOT EXISTS doc_drafts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL,                     -- purchase | purchase_return | ...
  ts         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  title      TEXT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  partner_name TEXT,                            -- ten moi / ten khach, de nhin danh sach cho biet
  total      INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  source     TEXT,                              -- vd: "req:12" neu sinh tu phieu bao het hang
  payload    TEXT NOT NULL                      -- toan bo phieu dang lam do, dang JSON
);
CREATE INDEX IF NOT EXISTS idx_docdraft_kind ON doc_drafts(kind, updated_at);

-- Cac lan khach dua tien coc
CREATE TABLE IF NOT EXISTS sale_order_deposits (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id  INTEGER NOT NULL REFERENCES sale_orders(id) ON DELETE CASCADE,
  ts        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  amount    INTEGER NOT NULL,              -- am = hoan coc khi huy don
  account_id INTEGER REFERENCES cash_accounts(id) ON DELETE SET NULL,
  cash_tx_id INTEGER,
  user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note      TEXT
);
CREATE INDEX IF NOT EXISTS idx_sodep_order ON sale_order_deposits(order_id);
