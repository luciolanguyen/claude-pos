/**
 * Đo tốc độ nạp danh mục màn hình bán hàng khi tiệm có rất nhiều mã hàng.
 *
 *   node tools/bench-pos-products.mjs data/bench.db 20000
 *
 * Bước 1 (chỉ khi file chưa có đủ hàng): chép từ data/test-ui.db rồi đổ thêm
 * cho đủ N mã hàng, mỗi mã một đơn vị, giá bán, tồn kho và vài dòng nhập hàng.
 * Bước 2: chạy câu truy vấn "giá nhập gần nhất" của GET /products/pos và in thời gian
 * (16/11/2026: 42,7 giây khi thiếu chỉ mục purchase_items(product_id), 63 ms khi có).
 *
 * KHÔNG BAO GIỜ chạy trên pos.db — script từ chối.
 */
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const file = process.argv[2] || 'data/bench.db';
const want = Number(process.argv[3]) || 20000;
if (/(^|[\\/])pos\.db$/i.test(file)) { console.error('Không chạy trên pos.db'); process.exit(1); }
if (!existsSync(file)) copyFileSync('data/test-ui.db', file);

const db = new DatabaseSync(file);
const have = db.prepare('SELECT COUNT(*) n FROM products').get().n;
if (have < want) {
  console.log(`Đổ thêm ${want - have} mã hàng…`);
  const wh = db.prepare('SELECT id FROM warehouses ORDER BY id LIMIT 1').get().id;
  const pl = db.prepare('SELECT id FROM price_lists ORDER BY id LIMIT 1').get().id;
  const sup = db.prepare('SELECT id FROM suppliers ORDER BY id LIMIT 1').get()?.id ?? null;
  const insP = db.prepare(`INSERT INTO products (sku, name, base_unit, cost_price, location, active)
                           VALUES (?, ?, 'Cái', ?, ?, 1)`);
  const insU = db.prepare(`INSERT INTO product_units (product_id, unit_name, factor, is_base) VALUES (?, 'Cái', 1, 1)`);
  const insPr = db.prepare('INSERT INTO product_prices (product_id, price_list_id, unit_id, price) VALUES (?, ?, ?, ?)');
  const insS = db.prepare('INSERT OR REPLACE INTO stock (product_id, warehouse_id, qty) VALUES (?, ?, ?)');
  const insPu = db.prepare(`INSERT INTO purchases (code, ts, supplier_id, warehouse_id, status)
                            VALUES (?, datetime('now', ?), ?, ?, 'done')`);
  const insPi = db.prepare(`INSERT INTO purchase_items (purchase_id, product_id, unit_name, factor, qty, price)
                            VALUES (?, ?, 'Cái', 1, 10, ?)`);
  db.exec('BEGIN');
  let puId = null;
  for (let i = have; i < want; i += 1) {
    const cost = 1000 + (i % 500) * 100;
    const p = insP.run(`BENCH${i}`, `Hàng thử tốc độ số ${i}`, cost, `K${i % 40}-T${i % 6}`).lastInsertRowid;
    const u = insU.run(p).lastInsertRowid;
    insPr.run(p, pl, u, cost * 2);
    insS.run(p, wh, i % 37);
    /* 50 món một phiếu nhập, mỗi món có ở 2 phiếu */
    if (puId === null || i % 50 === 0) puId = insPu.run(`BPN${i}`, `-${i % 300} days`, sup, wh).lastInsertRowid;
    insPi.run(puId, p, cost);
    insPi.run(puId, p, cost + 100);
  }
  db.exec('COMMIT');
}

const old = `
    SELECT p.id,
           (SELECT CAST(ROUND(pi.price * 1.0 / COALESCE(NULLIF(pi.factor, 0), 1)) AS INTEGER)
              FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
             WHERE pi.product_id = p.id AND pu.status = 'done'
             ORDER BY pu.ts DESC, pi.id DESC LIMIT 1) AS last_purchase_price,
           (SELECT MAX(pu.ts) FROM purchase_items pi JOIN purchases pu ON pu.id = pi.purchase_id
             WHERE pi.product_id = p.id AND pu.status = 'done') AS last_purchase_at,
           COALESCE((SELECT qty FROM stock s WHERE s.product_id = p.id AND s.warehouse_id = ?), 0) AS stock
    FROM products p WHERE p.active = 1 ORDER BY p.name`;
const time = (label, sql) => {
  const t = performance.now();
  const rows = db.prepare(sql).all(1);
  console.log(`${label}: ${rows.length} dòng, ${Math.round(performance.now() - t)} ms`);
};
console.log('Số dòng nhập hàng:', db.prepare('SELECT COUNT(*) n FROM purchase_items').get().n);
time('Câu nạp danh mục', old);
