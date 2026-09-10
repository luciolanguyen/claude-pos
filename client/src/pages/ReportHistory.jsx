import { useState, useMemo } from 'react';
import { Download, Package, Truck, Users, Receipt, LayoutList, Table2 } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch, useDebounced } from '../lib/store';
import { money, n, short, qty as fq, datetime, date, pct, PAYMENT_LABEL } from '../lib/format';
import { Button, Spinner, Empty, ErrorBox, Stat, SearchInput, Combo, AsyncCombo, Select, Badge } from '../components/ui';

function downloadCsv(name, head, rows) {
  const csv = '﻿' + [head, ...rows]
    .map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

/* Tra hàng hoá trên máy chủ cho ô lọc. Danh mục của tiệm hơn hai nghìn
   món nên không đổ hết xuống được — gõ tới đâu hỏi tới đó. */
const searchProducts = (term) =>
  api.products({ q: term, active: '', page_size: 30 }).then((d) => d.rows || []);
const loadProduct = (id) => api.product(id);
const productRender = (p) => ({ label: p.name, sub: [p.sku, p.brand].filter(Boolean).join(" · ") });

/* Chênh lệch giá nhiều thì cảnh báo — dấu hiệu bán/nhập lệch giá. */
function spread(min, max) {
  if (!min || !max || min === max) return null;
  return ((max - min) / min) * 100;
}

/* ==================================================================== */
/* Lịch sử MUA HÀNG — theo mặt hàng hoặc nhà cung cấp                    */
/* ==================================================================== */

export function PurchaseHistory({ r }) {
  const [view, setView] = useState('product');   // product | detail
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [supplierId, setSupplierId] = useState(null);
  const [productId, setProductId] = useState(null);

  const { data: suppliers } = useFetch(() => api.suppliers({ active: 1 }), []);
  const { data, busy, error, reload } = useFetch(
    () => api.get('/reports/purchase-history', {
      from: r.from, to: r.to, q: dq,
      supplier_id: supplierId || '', product_id: productId || '',
    }),
    [r.from, r.to, dq, supplierId, productId]
  );

  if (busy && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        <Stat label="Số phiếu nhập" value={n(data.totals.bills)} icon={Truck} />
        <Stat label="Số dòng hàng" value={n(data.totals.lines)} />
        <Stat label="Tổng số lượng nhập" value={n(Math.round(data.totals.qty))} icon={Package} />
        <Stat label="Tổng tiền nhập" value={short(data.totals.amount)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Tìm mặt hàng, NCC, mã phiếu..." className="w-full sm:w-64" />
        <div className="w-full sm:w-56">
          <Combo
            size="md"
            items={suppliers || []}
            value={supplierId}
            onChange={setSupplierId}
            placeholder="Mọi nhà cung cấp"
            filter={(s, x) => s.name.toLowerCase().includes(x.toLowerCase())}
            render={(s) => ({ label: s.name, sub: s.phone })}
          />
        </div>
        <div className="w-full sm:w-56">
          <AsyncCombo
            size="md"
            search={searchProducts}
            loadOne={loadProduct}
            value={productId}
            onChange={setProductId}
            placeholder="Mọi mặt hàng"
            hint="Gõ tên, mã hàng, mã vạch..."
            render={productRender}
          />
        </div>
        <div className="flex gap-1">
          {[['product', 'Gom theo mặt hàng', LayoutList], ['detail', 'Chi tiết từng dòng', Table2]].map(([k, l, Icon]) => (
            <button key={k} onClick={() => setView(k)}
              className={`btn btn-sm ${view === k ? 'btn-secondary' : 'btn-outline'}`}>
              <Icon size={13} aria-hidden="true" />{l}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Button size="sm" icon={Download} disabled={!data.rows.length}
          onClick={() => view === 'product'
            ? downloadCsv(`lichsu-muahang-theo-mathang-${r.from}-${r.to}.csv`,
                ['Mã hàng', 'Tên hàng', 'ĐVT', 'Số lần nhập', 'Tổng SL', 'Tổng tiền', 'Giá thấp nhất', 'Giá cao nhất', 'Giá bình quân', 'Giá lần cuối', 'Lần cuối'],
                data.products.map((p) => [p.sku, p.name, p.base_unit, p.times, p.qty, p.amount,
                  p.min_price, p.max_price, p.avg_price, p.last_price, date(p.last_ts)]))
            : downloadCsv(`lichsu-muahang-chitiet-${r.from}-${r.to}.csv`,
                ['Ngày', 'Mã phiếu', 'Nhà cung cấp', 'Mã hàng', 'Tên hàng', 'ĐVT', 'SL', 'Đơn giá', 'Thành tiền', 'Số HĐ NCC'],
                data.rows.map((x) => [datetime(x.ts), x.code, x.supplier_name, x.sku, x.product_name,
                  x.unit_name, x.qty, x.price, x.amount, x.supplier_invoice || '']))}>
          Xuất Excel
        </Button>
      </div>

      {!data.rows.length ? (
        <Empty icon={Truck} title="Không có dữ liệu nhập hàng"
          message="Chưa phát sinh phiếu nhập nào khớp bộ lọc trong khoảng thời gian này." />
      ) : view === 'product' ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Mã hàng</th><th>Tên hàng</th><th>ĐVT</th>
                <th className="text-right">Số lần nhập</th>
                <th className="text-right">Tổng SL</th>
                <th className="text-right">Tổng tiền</th>
                <th className="text-right">Giá thấp nhất</th>
                <th className="text-right">Giá cao nhất</th>
                <th className="text-right">Giá bình quân</th>
                <th className="text-right">Giá lần cuối</th>
                <th>Nhập lần cuối</th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((p) => {
                const sp = spread(p.min_price, p.max_price);
                return (
                  <tr key={p.product_id} className="hoverable">
                    <td className="font-mono text-muted-ink">{p.sku}</td>
                    <td className="font-semibold">{p.name}</td>
                    <td>{p.base_unit}</td>
                    <td className="num">{p.times}</td>
                    <td className="num">{fq(p.qty)}</td>
                    <td className="num font-semibold">{money(p.amount)}</td>
                    <td className="num text-emerald-700">{money(p.min_price)}</td>
                    <td className="num">
                      {money(p.max_price)}
                      {sp > 15 && <Badge tone="warn" className="ml-1">+{Math.round(sp)}%</Badge>}
                    </td>
                    <td className="num">{money(p.avg_price)}</td>
                    <td className="num font-semibold">{money(p.last_price)}</td>
                    <td className="text-muted-ink whitespace-nowrap">{date(p.last_ts)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="text-right">TỔNG CỘNG</td>
                <td className="num">{money(data.totals.amount)}</td>
                <td colSpan={5} />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Ngày</th><th>Mã phiếu</th><th>Nhà cung cấp</th><th>Mã hàng</th><th>Tên hàng</th>
                <th>ĐVT</th>
                <th className="text-right">SL</th>
                <th className="text-right">Đơn giá</th>
                <th className="text-right">Thành tiền</th>
                <th>Số HĐ của NCC</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((x, i) => (
                <tr key={i} className="hoverable">
                  <td className="text-muted-ink whitespace-nowrap">{datetime(x.ts)}</td>
                  <td className="font-mono font-semibold">{x.code}</td>
                  <td className="truncate max-w-[180px]">{x.supplier_name}</td>
                  <td className="font-mono text-muted-ink">{x.sku}</td>
                  <td className="font-semibold">{x.product_name}</td>
                  <td>{x.unit_name}</td>
                  <td className="num">{fq(x.qty)}</td>
                  <td className="num">{money(x.price)}</td>
                  <td className="num font-semibold">{money(x.amount)}</td>
                  <td className="font-mono text-muted-ink">{x.supplier_invoice || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={8} className="text-right">TỔNG CỘNG</td>
                <td className="num">{money(data.totals.amount)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/* ==================================================================== */
/* Lịch sử BÁN HÀNG — theo mặt hàng hoặc khách hàng                      */
/* ==================================================================== */

export function SaleHistory({ r }) {
  const [view, setView] = useState('product');   // product | customer | detail
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [customerId, setCustomerId] = useState(null);
  const [productId, setProductId] = useState(null);

  const { data: customers } = useFetch(() => api.customers({ active: 1 }), []);
  const { data, busy, error, reload } = useFetch(
    () => api.get('/reports/sale-history', {
      from: r.from, to: r.to, q: dq,
      customer_id: customerId || '', product_id: productId || '',
    }),
    [r.from, r.to, dq, customerId, productId]
  );

  if (busy && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const VIEWS = [
    ['product', 'Theo mặt hàng', Package],
    ['customer', 'Theo khách hàng', Users],
    ['detail', 'Chi tiết từng dòng', Table2],
  ];

  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-5">
        <Stat label="Số hoá đơn" value={n(data.totals.bills)} icon={Receipt} />
        <Stat label="Số dòng hàng" value={n(data.totals.lines)} />
        <Stat label="Tổng SL bán" value={n(Math.round(data.totals.qty))} />
        <Stat label="Doanh thu" value={short(data.totals.amount)} tone="good" />
        <Stat label="Lợi nhuận gộp" value={short(data.totals.profit)}
          sub={data.totals.amount > 0 ? `Tỷ suất ${pct(data.totals.profit / data.totals.amount * 100)}` : ''} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Tìm mặt hàng, khách, mã hoá đơn..." className="w-full sm:w-64" />
        <div className="w-full sm:w-56">
          <Combo
            size="md"
            items={customers || []}
            value={customerId}
            onChange={setCustomerId}
            placeholder="Mọi khách hàng"
            filter={(c, x) => c.name.toLowerCase().includes(x.toLowerCase()) || (c.phone || '').includes(x)}
            render={(c) => ({ label: c.name, sub: c.phone })}
          />
        </div>
        <div className="w-full sm:w-56">
          <AsyncCombo
            size="md"
            search={searchProducts}
            loadOne={loadProduct}
            value={productId}
            onChange={setProductId}
            placeholder="Mọi mặt hàng"
            hint="Gõ tên, mã hàng, mã vạch..."
            render={productRender}
          />
        </div>
        <div className="flex gap-1">
          {VIEWS.map(([k, l, Icon]) => (
            <button key={k} onClick={() => setView(k)}
              className={`btn btn-sm ${view === k ? 'btn-secondary' : 'btn-outline'}`}>
              <Icon size={13} aria-hidden="true" />{l}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Button size="sm" icon={Download} disabled={!data.rows.length}
          onClick={() => {
            if (view === 'product') {
              downloadCsv(`lichsu-banhang-theo-mathang-${r.from}-${r.to}.csv`,
                ['Mã hàng', 'Tên hàng', 'ĐVT', 'Số lần bán', 'Tổng SL', 'Doanh thu', 'Lợi nhuận', 'Giá thấp nhất', 'Giá cao nhất', 'Giá bình quân', 'Giá lần cuối'],
                data.products.map((p) => [p.sku, p.name, p.base_unit, p.times, p.qty, p.amount,
                  p.profit, p.min_price, p.max_price, p.avg_price, p.last_price]));
            } else if (view === 'customer') {
              downloadCsv(`lichsu-banhang-theo-khach-${r.from}-${r.to}.csv`,
                ['Khách hàng', 'Điện thoại', 'Số hoá đơn', 'Tổng SL', 'Doanh thu', 'Lợi nhuận'],
                data.customers.map((c) => [c.name, c.phone || '', c.bills, c.qty, c.amount, c.profit]));
            } else {
              downloadCsv(`lichsu-banhang-chitiet-${r.from}-${r.to}.csv`,
                ['Ngày', 'Mã HĐ', 'Khách hàng', 'Mã hàng', 'Tên hàng', 'ĐVT', 'SL', 'Đơn giá', 'Giảm', 'Thành tiền', 'Lãi', 'Ghi chú'],
                data.rows.map((x) => [datetime(x.ts), x.code, x.customer_name, x.sku, x.product_name,
                  x.unit_name, x.qty, x.price, x.discount, x.amount, x.profit, x.note || '']));
            }
          }}>
          Xuất Excel
        </Button>
      </div>

      {!data.rows.length ? (
        <Empty icon={Receipt} title="Không có dữ liệu bán hàng"
          message="Chưa phát sinh hoá đơn nào khớp bộ lọc trong khoảng thời gian này." />
      ) : view === 'product' ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Mã hàng</th><th>Tên hàng</th><th>ĐVT</th>
                <th className="text-right">Số lần bán</th>
                <th className="text-right">Tổng SL</th>
                <th className="text-right">Doanh thu</th>
                <th className="text-right">Lợi nhuận</th>
                <th className="text-right">Giá thấp nhất</th>
                <th className="text-right">Giá cao nhất</th>
                <th className="text-right">Giá lần cuối</th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((p) => {
                const sp = spread(p.min_price, p.max_price);
                return (
                  <tr key={p.product_id} className="hoverable">
                    <td className="font-mono text-muted-ink">{p.sku}</td>
                    <td className="font-semibold">{p.name}</td>
                    <td>{p.base_unit}</td>
                    <td className="num">{p.times}</td>
                    <td className="num">{fq(p.qty)}</td>
                    <td className="num font-semibold">{money(p.amount)}</td>
                    <td className={`num font-semibold ${p.profit < 0 ? 'text-danger' : 'text-emerald-700'}`}>
                      {money(p.profit)}
                    </td>
                    <td className="num">
                      {money(p.min_price)}
                      {sp > 20 && <Badge tone="warn" className="ml-1" title="Giá bán chênh nhau nhiều">
                        lệch {Math.round(sp)}%
                      </Badge>}
                    </td>
                    <td className="num">{money(p.max_price)}</td>
                    <td className="num font-semibold">{money(p.last_price)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="text-right">TỔNG CỘNG</td>
                <td className="num">{money(data.totals.amount)}</td>
                <td className="num text-emerald-700">{money(data.totals.profit)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : view === 'customer' ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Khách hàng</th><th>Điện thoại</th>
                <th className="text-right">Số hoá đơn</th>
                <th className="text-right">Tổng SL</th>
                <th className="text-right">Doanh thu</th>
                <th className="text-right">Lợi nhuận</th>
                <th className="text-right">Tỷ suất</th>
                <th className="text-right">Tỷ trọng</th>
              </tr>
            </thead>
            <tbody>
              {data.customers.map((c, i) => (
                <tr key={i} className="hoverable">
                  <td className="font-semibold">{c.name}</td>
                  <td className="tabular text-muted-ink">{c.phone || '—'}</td>
                  <td className="num">{c.bills}</td>
                  <td className="num">{fq(c.qty)}</td>
                  <td className="num font-semibold">{money(c.amount)}</td>
                  <td className={`num font-semibold ${c.profit < 0 ? 'text-danger' : 'text-emerald-700'}`}>
                    {money(c.profit)}
                  </td>
                  <td className="num">{c.amount > 0 ? pct(c.profit / c.amount * 100) : '—'}</td>
                  <td className="num">{data.totals.amount > 0 ? pct(c.amount / data.totals.amount * 100) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="text-right">TỔNG CỘNG</td>
                <td className="num">{money(data.totals.amount)}</td>
                <td className="num text-emerald-700">{money(data.totals.profit)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Ngày</th><th>Mã HĐ</th><th>Khách hàng</th><th>Mã hàng</th><th>Tên hàng</th>
                <th>ĐVT</th>
                <th className="text-right">SL</th>
                <th className="text-right">Đơn giá</th>
                <th className="text-right">Giảm</th>
                <th className="text-right">Thành tiền</th>
                <th className="text-right">Lãi</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((x, i) => (
                <tr key={i} className="hoverable">
                  <td className="text-muted-ink whitespace-nowrap">{datetime(x.ts)}</td>
                  <td className="font-mono font-semibold">{x.code}</td>
                  <td className="truncate max-w-[160px]">{x.customer_name}</td>
                  <td className="font-mono text-muted-ink">{x.sku}</td>
                  <td>
                    <div className="font-semibold">{x.product_name}</div>
                    {x.note && <div className="text-2xs text-info italic">{x.note}</div>}
                  </td>
                  <td>{x.unit_name}</td>
                  <td className="num">{fq(x.qty)}</td>
                  <td className="num">{money(x.price)}</td>
                  <td className="num text-muted-ink">{x.discount > 0 ? money(x.discount) : '—'}</td>
                  <td className="num font-semibold">{money(x.amount)}</td>
                  <td className={`num ${x.profit < 0 ? 'text-danger font-semibold' : 'text-emerald-700'}`}>
                    {money(x.profit)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={9} className="text-right">TỔNG CỘNG</td>
                <td className="num">{money(data.totals.amount)}</td>
                <td className="num text-emerald-700">{money(data.totals.profit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
