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
