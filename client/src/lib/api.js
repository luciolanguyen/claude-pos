/** Lớp gọi API. Khi build chạy thật, server phục vụ luôn giao diện nên dùng đường dẫn tương đối. */
const BASE = '/api';

async function request(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) {
    const err = new Error(data?.error || `Lỗi ${res.status}`);
    err.status = res.status;
    err.code = data?.code;
    throw err;
  }
  return data;
}

/** Nối query string, bỏ qua giá trị rỗng. */
function qs(params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? '?' + s : '';
}

export const api = {
  get: (p, params) => request('GET', p + qs(params)),
  post: (p, b) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  del: (p) => request('DELETE', p),

  /* --- Danh mục --- */
  products: (params) => request('GET', '/products' + qs(params)),
  posProducts: (params) => request('GET', '/products/pos' + qs(params)),
  product: (id) => request('GET', `/products/${id}`),
  productMoves: (id) => request('GET', `/products/${id}/moves`),
  categories: () => request('GET', '/categories'),
  priceLists: () => request('GET', '/price-lists'),
  warehouses: () => request('GET', '/warehouses'),

  /* --- Đối tác --- */
  suppliers: (params) => request('GET', '/suppliers' + qs(params)),
  supplier: (id) => request('GET', `/suppliers/${id}`),
  customers: (params) => request('GET', '/customers' + qs(params)),
  customer: (id) => request('GET', `/customers/${id}`),

  /* --- Mua hàng --- */
  purchases: (params) => request('GET', '/purchases' + qs(params)),
  purchase: (id) => request('GET', `/purchases/${id}`),
  purchaseReturns: (params) => request('GET', '/purchase-returns' + qs(params)),
  supplierDebts: (params) => request('GET', '/supplier-debts' + qs(params)),

  /* --- Bán hàng --- */
  sales: (params) => request('GET', '/sales' + qs(params)),
  sale: (id) => request('GET', `/sales/${id}`),
  saleReturns: (params) => request('GET', '/sale-returns' + qs(params)),
  customerDebts: (params) => request('GET', '/customer-debts' + qs(params)),

  /* --- Kho --- */
  stock: (params) => request('GET', '/stock' + qs(params)),
  stockMoves: (params) => request('GET', '/stock-moves' + qs(params)),
  stockTakes: () => request('GET', '/stock-takes'),
  stockTake: (id) => request('GET', `/stock-takes/${id}`),
  stockTransfers: () => request('GET', '/stock-transfers'),

  /* --- Quỹ --- */
  cashAccounts: () => request('GET', '/cash/accounts'),
  cashTransactions: (params) => request('GET', '/cash/transactions' + qs(params)),
  cashSummary: (params) => request('GET', '/cash/summary' + qs(params)),
  cashCategories: () => request('GET', '/cash/categories'),

  /* --- Báo cáo --- */
  dashboard: (params) => request('GET', '/dashboard' + qs(params)),
  reportSales: (params) => request('GET', '/reports/sales' + qs(params)),
  reportProducts: (params) => request('GET', '/reports/products' + qs(params)),
  reportPurchases: (params) => request('GET', '/reports/purchases' + qs(params)),
  reportInventory: (params) => request('GET', '/reports/inventory' + qs(params)),
  reportPnl: (params) => request('GET', '/reports/pnl' + qs(params)),

  /* --- Sản xuất --- */
  productions: (params) => request('GET', '/productions' + qs(params)),
  production: (id) => request('GET', `/productions/${id}`),
  bom: (id) => request('GET', `/products/${id}/bom`),
  carriers: () => request('GET', '/carriers'),

  /* --- Hoá đơn tạm & lịch sử giá --- */
  drafts: () => request('GET', '/drafts'),
  draft: (id) => request('GET', `/drafts/${id}`),
  customerQuick: (id) => request('GET', `/customers/${id}/quick`),

  /* --- Báo cáo lịch sử --- */
  reportPurchaseHistory: (params) => request('GET', '/reports/purchase-history' + qs(params)),
  reportSaleHistory: (params) => request('GET', '/reports/sale-history' + qs(params)),

  /* --- Bảo hành --- */
  warranty: (params) => request('GET', '/warranty' + qs(params)),
  warrantyTicket: (id) => request('GET', `/warranty/${id}`),
  warrantyMeta: () => request('GET', '/warranty/meta'),
  warrantySummary: () => request('GET', '/warranty-summary'),
  warrantyLookup: (q) => request('GET', '/warranty-lookup' + qs({ q })),
  warrantyReport: (params) => request('GET', '/reports/warranty' + qs(params)),
  photoUsage: () => request('GET', '/warranty/photo-usage'),

  /* --- Hệ thống --- */
  settings: () => request('GET', '/settings'),
  users: () => request('GET', '/users'),
  systemInfo: () => request('GET', '/system-info'),
};
