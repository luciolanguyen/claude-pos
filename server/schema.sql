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

-- ============================================================
-- MO RONG v13: thu no theo hoa don, phieu doi hang, ma PIN duyet
-- ============================================================

-- ---------- Tien tra no gan vao hoa don nao ----------
-- Khach tra no thi tien ve mot phieu thu chung, bang nay ghi ro phieu
-- thu do tru vao nhung hoa don nao. Tong no KHONG doi vi bang nay chi
-- chia nho khoan da thu, khong sinh them tien.
CREATE TABLE IF NOT EXISTS debt_allocations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cash_tx_id INTEGER NOT NULL REFERENCES cash_transactions(id) ON DELETE CASCADE,
  sale_id    INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dalloc_sale ON debt_allocations(sale_id);
CREATE INDEX IF NOT EXISTS idx_dalloc_tx ON debt_allocations(cash_tx_id);

-- ---------- Phieu doi hang (store credit cho khach le) ----------
-- Khach tra hang ma tiem khong muon chi tien mat ra (tranh hut quy ca
-- truc) thi cap mot ma phieu, lan sau mua tru vao.
CREATE TABLE IF NOT EXISTS vouchers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  ts          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  amount      INTEGER NOT NULL,          -- gia tri luc cap
  balance     INTEGER NOT NULL,          -- con lai chua dung
  source_type TEXT,
  source_id   INTEGER,
  source_code TEXT,
  expires_at  TEXT,
  status      TEXT NOT NULL DEFAULT 'active',   -- active | used | void
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_vouchers_customer ON vouchers(customer_id);

CREATE TABLE IF NOT EXISTS voucher_uses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  sale_id    INTEGER REFERENCES sales(id) ON DELETE SET NULL,
  ts         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  amount     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vuses_voucher ON voucher_uses(voucher_id);

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

-- ============================================================
-- MO RONG v14: ho so NCC nhieu so dien thoai / tai khoan, hang giao
--              sai tren phieu nhap, tra hang NCC, sua chua dich vu
-- ============================================================

-- Mot NCC nhieu so dien thoai, moi so gan nhan: kinh doanh, ke toan cong
-- no, giao nhan kho, giam doc... Cot suppliers.phone giu so dau tien de
-- cac man hinh cu van hien duoc.
CREATE TABLE IF NOT EXISTS supplier_phones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  phone       TEXT NOT NULL,
  label       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sphone_supplier ON supplier_phones(supplier_id);
CREATE INDEX IF NOT EXISTS idx_sphone_phone ON supplier_phones(phone);

-- Tai khoan ngan hang cua NCC, de phieu chi tra no chon dung tai khoan nhan
CREATE TABLE IF NOT EXISTS supplier_bank_accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  bank_name   TEXT NOT NULL,
  account_no  TEXT NOT NULL,
  holder      TEXT,
  label       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sbank_supplier ON supplier_bank_accounts(supplier_id);

-- Hang giao sai / ngoai danh muc: tinh vao tien phieu nhap va cong no NCC,
-- KHONG vao kho, khong co ma hang. Cho tra lai NCC.
CREATE TABLE IF NOT EXISTS purchase_custom_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  unit_name   TEXT,
  qty         REAL NOT NULL,
  price       INTEGER NOT NULL DEFAULT 0,
  amount      INTEGER NOT NULL DEFAULT 0,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_pci_purchase ON purchase_custom_items(purchase_id);

-- Dong hang ngoai he thong tren phieu tra NCC (khong tru kho)
CREATE TABLE IF NOT EXISTS purchase_return_custom_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id      INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  custom_item_id INTEGER REFERENCES purchase_custom_items(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  unit_name      TEXT,
  qty            REAL NOT NULL,
  price          INTEGER NOT NULL DEFAULT 0,
  amount         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_prci_return ON purchase_return_custom_items(return_id);
CREATE INDEX IF NOT EXISTS idx_prci_custom ON purchase_return_custom_items(custom_item_id);

-- Linh kien mua ngoai khi sua, go tay: khong dung kho, doanh thu gom rieng
CREATE TABLE IF NOT EXISTS warranty_custom_parts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES warranty_tickets(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  qty       REAL NOT NULL DEFAULT 1,
  price     INTEGER NOT NULL DEFAULT 0,
  amount    INTEGER NOT NULL DEFAULT 0,
  note      TEXT
);
CREATE INDEX IF NOT EXISTS idx_wcp_ticket ON warranty_custom_parts(ticket_id);

-- Phi phat sinh khac cua phieu sua: gui hang, van chuyen...
CREATE TABLE IF NOT EXISTS warranty_fees (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES warranty_tickets(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  amount    INTEGER NOT NULL DEFAULT 0,
  note      TEXT
);
CREATE INDEX IF NOT EXISTS idx_wfee_ticket ON warranty_fees(ticket_id);
CREATE INDEX IF NOT EXISTS idx_wt_sale ON warranty_tickets(sale_id);

-- ============================================================
-- MO RONG v15: anh hang hoa, hang uu tien dau luoi POS, bao gia
--              cua tung NCC cho tung ma hang
-- ============================================================

-- Toi da 4 anh moi mat hang, 1 anh chinh hien ngoai danh muc va luoi POS.
-- File anh nam trong data/products/, khong nhet base64 vao CSDL.
CREATE TABLE IF NOT EXISTS product_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  file       TEXT NOT NULL,
  is_main    INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_pimg_product ON product_images(product_id);

-- Hang / nhom hang ghim len dau luoi POS theo mua ban. Thu tu do chu tiem
-- sap; kind = 'product' hoac 'category'.
CREATE TABLE IF NOT EXISTS pos_featured (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  ref_id     INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  set_id     INTEGER,                        -- NULL = danh sach ghim dang dung
  UNIQUE(kind, ref_id, set_id)
);

-- ============================================================
-- MO RONG v16: bo hang ghim theo mua
-- ============================================================

-- Moi bo la mot danh sach hang ghim dung lai duoc: "Hang Ghim Mua He",
-- "Hang Ghim Mua Tet". Bat bo nao thi luoi POS day hang cua bo do len dau.
-- Dong pos_featured co set_id = NULL la danh sach ghim dang dung truc tiep.
CREATE TABLE IF NOT EXISTS pos_featured_sets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_pfs_active ON pos_featured_sets(active);

-- ============================================================
-- MO RONG v17: ma tran gia si theo nac so luong (tai lieu 22)
-- ============================================================

-- Mua cang nhieu cang re: moi nac ghi so luong toi thieu va don gia cua
-- nac do, tinh theo TUNG DON VI TINH (nac cua Cai khac nac cua Thung).
--   min_qty 1  -> 10000   : mua 1-9 cai
--   min_qty 10 -> 9000    : mua 10-19 cai
--   min_qty 20 -> 8500    : mua tu 20 cai tro len
-- Khong khai nac nao thi mat hang ban theo bang gia nhu cu, khong doi gi.
-- Gia nac la gia TUYET DOI, khong phu thuoc bang gia dang chon.
CREATE TABLE IF NOT EXISTS product_price_tiers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_id    INTEGER NOT NULL REFERENCES product_units(id) ON DELETE CASCADE,
  min_qty    REAL NOT NULL DEFAULT 1,
  price      INTEGER NOT NULL DEFAULT 0,
  UNIQUE(product_id, unit_id, min_qty)
);
CREATE INDEX IF NOT EXISTS idx_ppt_product ON product_price_tiers(product_id);
CREATE INDEX IF NOT EXISTS idx_ppt_unit ON product_price_tiers(unit_id);

-- ============================================================
-- MO RONG v18: ghi chu hang dac thu, doi tac vang lai (tai lieu 24)
-- ============================================================

-- Khach goi mot mon hang bang ten rieng cua ho ("day gan", "ong nho").
-- Noi ten khach goi voi mat hang that trong kho, kem loi nhac cho thu ngan.
CREATE TABLE IF NOT EXISTS customer_product_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  alias       TEXT NOT NULL,                      -- ten khach goi (Mon X)
  product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
  note        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_cpn_customer ON customer_product_notes(customer_id);

-- Chu hang vang lai gui ban qua tiem (anh ruot, co Ha...). Khac han
-- nha cung cap: khong nhap kho, khong cong no mua hang.
CREATE TABLE IF NOT EXISTS consign_partners (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT,
  note       TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_cp_active ON consign_partners(active);

-- Mot dot chot doi soat cho mot chu hang vang lai.
CREATE TABLE IF NOT EXISTS consign_settlements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  ts           TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  partner_id   INTEGER REFERENCES consign_partners(id) ON DELETE SET NULL,
  partner_name TEXT,
  gross        INTEGER NOT NULL DEFAULT 0,   -- tong tien ban ho
  commission   INTEGER NOT NULL DEFAULT 0,   -- hoa hong tiem giu lai
  discount     INTEGER NOT NULL DEFAULT 0,   -- chiet khau gop them
  payout       INTEGER NOT NULL DEFAULT 0,   -- tien thuc tra chu hang
  from_date    TEXT,
  to_date      TEXT,
  item_count   INTEGER NOT NULL DEFAULT 0,
  cash_tx_id   INTEGER REFERENCES cash_transactions(id) ON DELETE SET NULL,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_cs_partner ON consign_settlements(partner_id);

-- Dong hang mua ho vang lai tren hoa don. KHONG tru kho, khong tao ma hang.
--   partner_id NULL  = kich ban A: tiem tu di boc hang, tra tien ngay, an chenh lech
--   partner_id co    = kich ban B: hang cua chu khac gui, treo doi soat
CREATE TABLE IF NOT EXISTS sale_consign_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id         INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  partner_id      INTEGER REFERENCES consign_partners(id) ON DELETE SET NULL,
  partner_name    TEXT,
  name            TEXT NOT NULL,
  unit_name       TEXT,
  qty             REAL NOT NULL DEFAULT 1,
  price           INTEGER NOT NULL DEFAULT 0,   -- gia ban cho khach
  cost            INTEGER NOT NULL DEFAULT 0,   -- gia tiem boc ngoai (kich ban A)
  commission_type TEXT NOT NULL DEFAULT 'amount',
  commission_value REAL NOT NULL DEFAULT 0,
  commission      INTEGER NOT NULL DEFAULT 0,   -- hoa hong da tinh ra tien
  amount          INTEGER NOT NULL DEFAULT 0,   -- qty * price
  note            TEXT,
  settlement_id   INTEGER REFERENCES consign_settlements(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_sci_sale ON sale_consign_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sci_partner ON sale_consign_items(partner_id, settlement_id);

-- ================= Plan 31 dot 6: bao hanh =================
-- Phieu tiep nhan gom nhieu mon (hang muc 3a). Moi mon van la mot dong
-- warranty_tickets rieng: tu di luong kiem tra / gui hang / sua / tra khach
-- va tinh tien rieng. Phieu gom chi de in chung mot bien nhan va biet khi nao
-- khach da lay du. Phieu tiep nhan mot mon (va moi phieu cu) khong co phieu gom.
CREATE TABLE IF NOT EXISTS warranty_batches (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT NOT NULL UNIQUE,
  ts             TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  customer_id    INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name  TEXT,
  customer_phone TEXT,
  received_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note           TEXT
);

-- Bao hanh rieng tung bo phan cua mot mat hang (hang muc 3e):
-- "May khoan: Pin 7 ngay, Than may 6 thang, Cu sac 3 thang"
CREATE TABLE IF NOT EXISTS product_warranty_parts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  duration   INTEGER NOT NULL,
  unit       TEXT NOT NULL DEFAULT 'month',   -- day | month
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pwp_product ON product_warranty_parts(product_id);

-- Chot vao hoa don luc ban: sua khai bao mat hang ve sau khong doi han cua
-- hang da ban
CREATE TABLE IF NOT EXISTS sale_item_warranty_parts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  duration     INTEGER NOT NULL,
  unit         TEXT NOT NULL DEFAULT 'month',
  until        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_siwp_item ON sale_item_warranty_parts(sale_item_id);

-- ================= Plan 31 dot 7: cong no =================
-- Dieu chinh cong no (hang muc 6c): khong sua chung tu cu, khong sua thang o
-- "No dau ky" nua. Moi lan sua la mot phieu rieng: tu bao nhieu sang bao nhieu,
-- ly do, ai lap, ai go PIN duyet.
CREATE TABLE IF NOT EXISTS debt_adjustments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  ts           TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  partner_type TEXT NOT NULL,              -- customer | supplier
  partner_id   INTEGER NOT NULL,
  partner_name TEXT,
  debt_before  INTEGER NOT NULL,
  debt_after   INTEGER NOT NULL,
  amount       INTEGER NOT NULL,           -- debt_after - debt_before
  reason       TEXT NOT NULL,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_da_partner ON debt_adjustments(partner_type, partner_id);

-- Moc chot cong no (hang muc 6b): chi la lop hien thi. Chung tu goc giu
-- nguyen; xoa dong moc la moi thu ve nhu cu.
CREATE TABLE IF NOT EXISTS debt_closings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_type   TEXT NOT NULL,
  partner_id     INTEGER NOT NULL,
  close_date     TEXT NOT NULL,            -- YYYY-MM-DD
  amount         INTEGER NOT NULL,         -- tong no den het ngay chot, luc bam chot
  debt_at_action INTEGER NOT NULL,         -- cong no hien tai luc bam chot
  ts             TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note           TEXT,
  UNIQUE(partner_type, partner_id, close_date)
);

-- ================= Plan 30: ma vach tu sinh =================
-- Bo dem chi tien, khong bao gio doc nguoc tu du lieu (plan 30, 5.1). Hai dong:
--   product  ma vach tu sinh: tien to 828 + 7 chu so = 10 ky tu (do dai chan
--            thi Code 128 nen duoc hai chu so vao mot ky hieu, tem hep nhat)
--   sku      ma hang tu dat SP00001... — thay cho COUNT(*)+1 bi cap lai sau khi xoa
CREATE TABLE IF NOT EXISTS barcode_counter (
  name       TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL,
  prefix     TEXT NOT NULL,
  width      INTEGER NOT NULL
);

-- So dang ky ma vach (plan 30, 5.2): moi ma da tung cap nam o mot cho, code
-- la khoa chinh nen trung ma bac qua hai bang products / product_units cung
-- bi chan. Xoa hang thi dong chuyen 'retired' chu khong xoa — ma tu sinh da
-- cap khong bao gio duoc cap lai. KHONG noi cascade tu products: cascade chinh
-- la con duong tai su dung ma.
CREATE TABLE IF NOT EXISTS barcodes (
  code          TEXT PRIMARY KEY,
  owner_type    TEXT NOT NULL,                 -- product | product_unit
  owner_id      INTEGER,                       -- NULL khi da thu hoi
  last_owner_id INTEGER,                       -- ai giu ma lan cuoi, de chinh hang do lay lai duoc
  source        TEXT NOT NULL,                 -- auto | manual | import
  status        TEXT NOT NULL DEFAULT 'active',-- active | retired
  ts            TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_barcodes_owner ON barcodes(owner_type, owner_id);

-- Moi lan tra tien cho chu hang vang lai (BRD nang cap, muc 4): tra lam nhieu lan
-- thi moi lan mot dong, tong lai la so da tra cua dot chot do.
CREATE TABLE IF NOT EXISTS consign_payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  settlement_id INTEGER NOT NULL REFERENCES consign_settlements(id) ON DELETE CASCADE,
  ts            TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  amount        INTEGER NOT NULL,
  account_id    INTEGER REFERENCES cash_accounts(id) ON DELETE SET NULL,
  cash_tx_id    INTEGER REFERENCES cash_transactions(id) ON DELETE SET NULL,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_consign_pay ON consign_payments(settlement_id);

-- ================= Plan 28: luong nhan vien theo lich Am =================
-- Nhan vien an luong la bang rieng, KHONG dung users: nguoi phu ban co the
-- khong bao gio dang nhap, con tai khoan quan ly co the chinh la chu tiem.
CREATE TABLE IF NOT EXISTS employees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,                 -- NV001
  full_name     TEXT NOT NULL,
  phone         TEXT,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  start_date    TEXT NOT NULL,                        -- ngay Duong vao lam
  start_lunar   TEXT NOT NULL,                        -- ngay Am vao lam, chot luc tao, khong tinh lai
  cycle_day     INTEGER NOT NULL,                     -- ngay Am goi dau ky luong 1..30
  track_from    TEXT NOT NULL,                        -- tinh luong tren phan mem tu ngay nay
  monthly_wage  INTEGER NOT NULL DEFAULT 0,
  work_from     TEXT NOT NULL DEFAULT '07:00',
  work_to       TEXT NOT NULL DEFAULT '17:00',
  pay_mode      TEXT NOT NULL DEFAULT 'monthly',      -- monthly | daily
  active        INTEGER NOT NULL DEFAULT 1,
  end_date      TEXT,                                 -- ngay nghi viec (lam het ngay nay)
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Phieu luong: moi lan tra luong (chot mot ky, chot gop nhieu ky, tra luong ngay).
-- Luong thuc nhan am thi tra 0, phan am chuyen sang phieu sau (carry).
CREATE TABLE IF NOT EXISTS payroll_settlements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,                   -- PL260917-0001
  ts          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  kind        TEXT NOT NULL DEFAULT 'cycle',          -- cycle | daily
  date_from   TEXT,
  date_to     TEXT,
  carry_in    INTEGER NOT NULL DEFAULT 0,             -- am = nhan vien con no tu phieu truoc
  earned      INTEGER NOT NULL DEFAULT 0,             -- tong cac ky / cac ngay
  pay_amount  INTEGER NOT NULL DEFAULT 0,
  carry_out   INTEGER NOT NULL DEFAULT 0,             -- am = con no chuyen sang phieu sau
  account_id  INTEGER REFERENCES cash_accounts(id) ON DELETE SET NULL,
  cash_tx_id  INTEGER REFERENCES cash_transactions(id) ON DELETE SET NULL,
  detail      TEXT,                                   -- JSON anh chup phieu luong luc chot
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_payroll_settle_emp ON payroll_settlements(employee_id, id);

-- Ky luong goi dau. Moc Duong chot cung luc tao, khong tinh lai moi lan mo man
-- hinh: sau nay sua ham doi lich thi ky da co (tien da tra) khong xe dich.
CREATE TABLE IF NOT EXISTS payroll_cycles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  label         TEXT NOT NULL,                        -- thang 4 nhuan nam 2020
  lunar_month   INTEGER NOT NULL,
  lunar_year    INTEGER NOT NULL,
  lunar_leap    INTEGER NOT NULL DEFAULT 0,
  lunar_from    TEXT NOT NULL,
  lunar_to      TEXT NOT NULL,
  date_from     TEXT NOT NULL,
  date_to       TEXT NOT NULL,
  days          INTEGER NOT NULL,                     -- 29 thang thieu | 30 thang du
  monthly_wage  INTEGER NOT NULL,                     -- anh chup, sua ho so chi ap cho ky chua chot
  hours_per_day REAL NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',         -- open | closed
  settlement_id INTEGER REFERENCES payroll_settlements(id) ON DELETE SET NULL,
  work_days     INTEGER,                              -- anh chup luc chot
  is_partial    INTEGER NOT NULL DEFAULT 0,
  base_amount   INTEGER,
  net_amount    INTEGER,
  closed_at     TEXT,
  closed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_cycle ON payroll_cycles(employee_id, date_from);

-- So luong: moi bien dong la mot dong, so du la tong cua so — cung khuon mau
-- stock + stock_moves. Khong co dong nao nghia la di lam du.
CREATE TABLE IF NOT EXISTS payroll_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  work_date     TEXT NOT NULL,                        -- ngay Duong phat sinh
  employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  cycle_id      INTEGER REFERENCES payroll_cycles(id) ON DELETE SET NULL,
  settlement_id INTEGER REFERENCES payroll_settlements(id) ON DELETE SET NULL,
  type          TEXT NOT NULL,
  -- absent_day | absent_hour | closed_day | wage | advance | purchase | bonus | adjust
  amount        INTEGER NOT NULL DEFAULT 0,           -- duong = nhan vien duoc nhan, am = tru
  hours         REAL,
  counted       INTEGER NOT NULL DEFAULT 1,           -- 0 = chu cho qua, van giu dau vet
  merged        INTEGER NOT NULL DEFAULT 1,           -- thuong: 1 gop vao luong, 0 dua tien ngay
  ref_type      TEXT,                                 -- sale | sale_return | closed_day | attendance
  ref_id        INTEGER,
  ref_code      TEXT,
  cash_tx_id    INTEGER REFERENCES cash_transactions(id) ON DELETE SET NULL,
  day_rate      INTEGER,
  hour_rate     INTEGER,
  reason        TEXT,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_payroll_emp ON payroll_entries(employee_id, work_date);
CREATE INDEX IF NOT EXISTS idx_payroll_cycle ON payroll_entries(cycle_id);
CREATE INDEX IF NOT EXISTS idx_payroll_settle ON payroll_entries(settlement_id);
-- Mot ngay chi bao nghi ca ngay mot lan (ke ca ngay tiem nghi), va tra luong ngay mot lan
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_absent_day
  ON payroll_entries(employee_id, work_date) WHERE type IN ('absent_day', 'closed_day');
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_wage_day
  ON payroll_entries(employee_id, work_date) WHERE type = 'wage';

-- Anh chup phieu ung co chu ky — file nam trong data/payroll/
CREATE TABLE IF NOT EXISTS payroll_photos (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id  INTEGER NOT NULL REFERENCES payroll_entries(id) ON DELETE CASCADE,
  file      TEXT NOT NULL,
  ts        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Ngay tiem dong cua (Tet...): chu tiem chot (28-4) nhung ngay nay KHONG tinh luong
CREATE TABLE IF NOT EXISTS payroll_closed_days (
  date     TEXT PRIMARY KEY,
  note     TEXT,
  ts       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Thuong chuyen can theo nam Am lich (28-3): moi nhan vien moi nam mot quyet dinh
CREATE TABLE IF NOT EXISTS payroll_awards (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  lunar_year   INTEGER NOT NULL,
  absent_days  INTEGER NOT NULL,
  threshold    INTEGER NOT NULL,
  decision     TEXT NOT NULL,                         -- approve | reject
  amount       INTEGER NOT NULL DEFAULT 0,
  entry_id     INTEGER REFERENCES payroll_entries(id) ON DELETE SET NULL,
  ts           TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note         TEXT,
  UNIQUE(employee_id, lunar_year)
);
