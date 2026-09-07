import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Plus, Minus, Trash2, X, UserPlus, Printer, Percent, Package,
  ShoppingCart, ArrowLeft, Wallet, CreditCard, HandCoins, FileText, Tag, Grid3x3,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, useLocal } from '../lib/store';
import { money, n, qty as fq, match, PAYMENT_LABEL } from '../lib/format';
import {
  Button, IconButton, Input, Select, Modal, Field, MoneyInput, Empty,
  Spinner, Badge, Combo, Textarea,
} from '../components/ui';
import InvoicePrint from '../components/InvoicePrint';
import CustomerForm from '../components/CustomerForm';

/* Ô hiển thị 1 sản phẩm trong lưới chọn hàng. */
function ProductTile({ p, priceListId, onPick }) {
  const baseUnit = p.units.find((u) => u.factor === 1) || p.units[0];
  const price = baseUnit?.prices?.[priceListId] ?? 0;
  const out = p.track_stock && p.stock <= 0;
  const low = p.track_stock && p.min_stock > 0 && p.stock > 0 && p.stock <= p.min_stock;

  return (
    <button
      onClick={() => onPick(p)}
      disabled={out}
      className={`card p-2 text-left transition-colors duration-150 cursor-pointer
                  hover:border-accent hover:bg-accent-soft/40 disabled:opacity-45
                  disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:bg-card
                  flex flex-col gap-1 min-h-[92px]`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-2xs font-mono text-muted-ink">{p.sku}</span>
        {out
          ? <Badge tone="bad">Hết</Badge>
          : low ? <Badge tone="warn">Sắp hết</Badge> : null}
      </div>
      <div className="text-[13px] font-semibold leading-snug line-clamp-2 flex-1">{p.name}</div>
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[13px] font-bold text-accent tabular font-mono">{n(price)}</span>
        <span className="text-2xs text-muted-ink tabular">
          {p.track_stock ? `${fq(p.stock)} ${p.base_unit}` : 'Dịch vụ'}
        </span>
      </div>
    </button>
  );
}

export default function POS() {
  const { meta, defaultWarehouse, defaultPriceList, user, store, settings, toast, loadMeta } = useApp();

  const [warehouseId, setWarehouseId] = useState(null);
  const [priceListId, setPriceListId] = useState(null);
  const [cart, setCart] = useLocal('thpos.cart', []);
  const [customerId, setCustomerId] = useState(null);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [orderDiscount, setOrderDiscount] = useState(0);
  const [note, setNote] = useState('');
  const [isVat, setIsVat] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [lastSale, setLastSale] = useState(null);
  const [showGrid, setShowGrid] = useState(true);
  const searchRef = useRef(null);

  useEffect(() => { if (defaultWarehouse && !warehouseId) setWarehouseId(defaultWarehouse); }, [defaultWarehouse, warehouseId]);
  useEffect(() => { if (defaultPriceList && !priceListId) setPriceListId(defaultPriceList); }, [defaultPriceList, priceListId]);

  const { data: products, busy, reload } = useFetch(
    () => api.posProducts({ warehouse_id: warehouseId }),
    [warehouseId], { skip: !warehouseId }
  );
  const { data: customers, reload: reloadCustomers } = useFetch(() => api.customers({ active: 1 }), []);

  /* Khách hàng có bảng giá riêng -> tự đổi bảng giá khi chọn khách */
  useEffect(() => {
    if (!customerId || !customers) return;
    const c = customers.find((x) => x.id === customerId);
    if (c?.price_list_id) setPriceListId(c.price_list_id);
  }, [customerId, customers]);

  const customer = customers?.find((c) => c.id === customerId) || null;

  /* ------------------------------ Giỏ hàng ------------------------------ */

  const priceFor = useCallback((product, unit) =>
    unit?.prices?.[priceListId] ?? unit?.prices?.[defaultPriceList] ?? 0,
  [priceListId, defaultPriceList]);

  const addToCart = useCallback((product, unitId) => {
    const unit = unitId
      ? product.units.find((u) => u.id === unitId)
      : (product.units.find((u) => u.factor === 1) || product.units[0]);
    if (!unit) return;

    setCart((prev) => {
      const key = `${product.id}:${unit.id}`;
      const found = prev.find((l) => l.key === key);
      if (found) {
        return prev.map((l) => l.key === key ? { ...l, qty: l.qty + 1 } : l);
      }
      return [...prev, {
        key,
        product_id: product.id,
        sku: product.sku,
        name: product.name,
        unit_id: unit.id,
        unit_name: unit.unit_name,
        factor: unit.factor,
        base_unit: product.base_unit,
        units: product.units,
        qty: 1,
        price: priceFor(product, unit),
        discount: 0,
        vat_rate: product.vat_rate,
        track_stock: product.track_stock,
        stock: product.stock,
      }];
    });
  }, [priceFor, setCart]);

  /* Đổi bảng giá -> áp lại giá cho các dòng chưa sửa tay */
  useEffect(() => {
    setCart((prev) => prev.map((l) => {
      if (l.priceEdited) return l;
      const u = l.units?.find((x) => x.id === l.unit_id);
      const p = u?.prices?.[priceListId];
      return p != null ? { ...l, price: p } : l;
    }));
  }, [priceListId, setCart]);

  const updateLine = (key, patch) =>
    setCart((prev) => prev.map((l) => l.key === key ? { ...l, ...patch } : l));

  const removeLine = (key) => setCart((prev) => prev.filter((l) => l.key !== key));

  const changeUnit = (line, unitId) => {
    const u = line.units.find((x) => x.id === Number(unitId));
    if (!u) return;
    setCart((prev) => {
      const newKey = `${line.product_id}:${u.id}`;
      if (prev.some((l) => l.key === newKey && l.key !== line.key)) {
        // Đã có dòng cùng sản phẩm & đơn vị -> gộp lại
        return prev
          .map((l) => l.key === newKey ? { ...l, qty: l.qty + line.qty } : l)
          .filter((l) => l.key !== line.key);
      }
      return prev.map((l) => l.key === line.key
        ? {
            ...l, key: newKey, unit_id: u.id, unit_name: u.unit_name, factor: u.factor,
            price: l.priceEdited ? l.price : (u.prices?.[priceListId] ?? l.price),
          }
        : l);
    });
  };

  const clearCart = () => {
    setCart([]);
    setOrderDiscount(0);
    setNote('');
    setCustomerId(null);
    setIsVat(false);
  };

  /* ------------------------------- Tính tiền ------------------------------ */

  const totals = useMemo(() => {
    let subtotal = 0;
    let vat = 0;
    for (const l of cart) {
      const amt = Math.round(l.qty * l.price - (l.discount || 0));
      subtotal += amt;
      if (isVat) vat += Math.round(amt * (l.vat_rate || 0) / 100);
    }
    const total = subtotal - orderDiscount + vat;
    return { subtotal, vat, total: Math.max(0, total), count: cart.length };
  }, [cart, orderDiscount, isVat]);

  /* ---------------------------- Lọc danh sách hàng ---------------------- */

  const filtered = useMemo(() => {
    if (!products) return [];
    let list = products;
    if (categoryId) list = list.filter((p) => p.category_id === Number(categoryId));
    if (search.trim()) {
      list = list.filter((p) =>
        match(p.name, search) || match(p.sku, search) ||
        (p.barcode || '').includes(search.trim()) || match(p.brand || '', search));
    }
    return list;
  }, [products, categoryId, search]);

  /* Quét mã vạch: máy quét gõ nhanh rồi Enter -> thêm thẳng vào giỏ */
  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return;
    const term = search.trim();
    if (!term) return;
    const exact = products?.find((p) => p.barcode === term || p.sku.toLowerCase() === term.toLowerCase());
    if (exact) {
      if (exact.track_stock && exact.stock <= 0) {
        toast(`"${exact.name}" đã hết hàng trong kho`, 'warn');
      } else {
        addToCart(exact);
        setSearch('');
      }
      return;
    }
    if (filtered.length === 1) {
      addToCart(filtered[0]);
      setSearch('');
    } else if (filtered.length === 0) {
      toast(`Không tìm thấy hàng nào khớp "${term}"`, 'warn');
    }
  };

  /* ------------------------------ Phím tắt ------------------------------- */

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === 'F4') { e.preventDefault(); if (cart.length) setPayOpen(true); }
      else if (e.key === 'F8') { e.preventDefault(); setCustOpen(true); }
      else if (e.key === 'Escape' && !payOpen && !custOpen) { setSearch(''); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cart.length, payOpen, custOpen]);

  /* ------------------------------ Thanh toán ----------------------------- */

  const submit = async (payload) => {
    const body = {
      items: cart.map((l) => ({
        product_id: l.product_id,
        name_snapshot: l.name,
        unit_name: l.unit_name,
        factor: l.factor,
        qty: l.qty,
        price: l.price,
        discount: l.discount || 0,
        vat_rate: l.vat_rate,
      })),
      customer_id: customerId,
      warehouse_id: warehouseId,
      user_id: user?.id,
      price_list_id: priceListId,
      discount: orderDiscount,
      is_vat_invoice: isVat ? 1 : 0,
      note,
      ...payload,
    };
    const res = await api.post('/sales', body);
    const full = await api.sale(res.id);
    setLastSale(full);
    clearCart();
    setPayOpen(false);
    reload();
    toast(`Đã lưu hoá đơn ${res.code}`, 'ok');
    return res;
  };

  if (!warehouseId) return <Spinner />;

  return (
    <div className="h-screen flex flex-col bg-surface">
      {/* ---------------------------- Thanh trên ---------------------------- */}
      <header className="h-14 bg-primary flex items-center gap-2 px-3 shrink-0 no-print">
        <Link
          to="/"
          className="text-slate-300 hover:text-white p-1.5 rounded hover:bg-white/10 transition-colors duration-150"
          aria-label="Quay lại trang tổng quan"
        >
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
        <ShoppingCart size={18} className="text-emerald-400 shrink-0" aria-hidden="true" />
        <span className="text-white font-display font-bold text-sm hidden sm:block">Bán hàng</span>

        <div className="flex-1 max-w-xl mx-2">
          <div className="relative">
            <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              ref={searchRef}
              className="w-full h-9 rounded bg-white/10 text-white placeholder:text-slate-400 pl-8 pr-16
                         border border-white/15 focus:bg-white focus:text-ink focus:placeholder:text-slate-400
                         focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40
                         transition-colors duration-150 text-[13px]"
              placeholder="Quét mã vạch hoặc gõ tên hàng..."
              aria-label="Tìm hàng hoá hoặc quét mã vạch"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKey}
              autoFocus
            />
            <span className="kbd absolute right-2 top-1/2 -translate-y-1/2 !bg-white/15 !text-slate-300 !border-white/20">
              F2
            </span>
          </div>
        </div>

        <select
          className="h-9 rounded bg-white/10 text-white border border-white/15 px-2 text-[13px]
                     cursor-pointer hidden md:block focus:outline-none focus:ring-2 focus:ring-accent/40"
          value={priceListId || ''}
          onChange={(e) => setPriceListId(Number(e.target.value))}
          aria-label="Bảng giá đang áp dụng"
        >
          {meta.priceLists.map((p) => (
            <option key={p.id} value={p.id} className="text-ink">{p.name}</option>
          ))}
        </select>

        <button
          onClick={() => setShowGrid((v) => !v)}
          className="text-slate-300 hover:text-white p-1.5 rounded hover:bg-white/10 lg:hidden"
          aria-label={showGrid ? 'Xem giỏ hàng' : 'Xem danh sách hàng'}
        >
          {showGrid ? <ShoppingCart size={18} aria-hidden="true" /> : <Grid3x3 size={18} aria-hidden="true" />}
        </button>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* ------------------------- Lưới chọn hàng ------------------------ */}
        <section className={`flex-1 min-w-0 flex flex-col ${showGrid ? '' : 'hidden lg:flex'}`}>
          <div className="px-3 py-2 border-b border-line bg-card flex items-center gap-2 overflow-x-auto shrink-0">
            <button
              onClick={() => setCategoryId('')}
              className={`btn btn-sm shrink-0 ${categoryId === '' ? 'btn-secondary' : 'btn-outline'}`}
            >
              Tất cả
              <span className="text-2xs opacity-70">({products?.length || 0})</span>
            </button>
            {meta.categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategoryId(String(c.id))}
                className={`btn btn-sm shrink-0 ${categoryId === String(c.id) ? 'btn-secondary' : 'btn-outline'}`}
              >
                {c.name}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {busy ? <Spinner label="Đang tải hàng hoá..." />
              : filtered.length === 0 ? (
                <Empty
                  icon={Package}
                  title="Không có hàng nào khớp"
                  message={search ? `Không tìm thấy "${search}". Thử gõ tên khác hoặc bỏ bớt bộ lọc nhóm hàng.` : 'Nhóm hàng này chưa có sản phẩm.'}
                  action={search && <Button onClick={() => setSearch('')}>Xoá từ khoá</Button>}
                />
              ) : (
                <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {filtered.map((p) => (
                    <ProductTile key={p.id} p={p} priceListId={priceListId} onPick={addToCart} />
                  ))}
                </div>
              )}
          </div>
        </section>

        {/* ---------------------------- Giỏ hàng --------------------------- */}
        <aside className={`w-full lg:w-[420px] xl:w-[460px] shrink-0 bg-card border-l border-line
                           flex flex-col ${showGrid ? 'hidden lg:flex' : 'flex'}`}>
          {/* Khách hàng */}
          <div className="p-2.5 border-b border-line shrink-0">
            <div className="flex items-center gap-1.5">
              <div className="flex-1 min-w-0">
                <Combo
                  size="sm"
                  items={customers || []}
                  value={customerId}
                  onChange={setCustomerId}
                  placeholder="Khách lẻ (không ghi tên)"
                  filter={(c, q) => match(c.name, q) || (c.phone || '').includes(q) || match(c.code, q)}
                  render={(c) => ({
                    label: c.name,
                    sub: [c.phone, c.debt > 0 ? `Đang nợ ${money(c.debt)}` : null]
                      .filter(Boolean).join(' · '),
                  })}
                />
              </div>
              <IconButton
                icon={UserPlus}
                label="Thêm khách hàng mới (F8)"
                variant="outline"
                onClick={() => setCustOpen(true)}
              />
            </div>
            {customer && (
              <div className="flex items-center gap-2 mt-1.5 text-2xs">
                {customer.phone && <span className="text-muted-ink">{customer.phone}</span>}
                {customer.debt > 0 && (
                  <Badge tone={customer.over_limit ? 'bad' : 'warn'}>
                    Nợ cũ {money(customer.debt)}
                  </Badge>
                )}
                {customer.price_list_name && <Badge tone="info">{customer.price_list_name}</Badge>}
              </div>
            )}
          </div>

          {/* Các dòng hàng */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {cart.length === 0 ? (
              <Empty
                icon={ShoppingCart}
                title="Chưa chọn hàng"
                message="Quét mã vạch, gõ tên hàng ở ô tìm kiếm, hoặc bấm vào ô hàng bên trái."
              />
            ) : (
              <ul className="divide-y divide-line">
                {cart.map((l) => {
                  const amount = Math.round(l.qty * l.price - (l.discount || 0));
                  const overStock = l.track_stock && l.qty * l.factor > l.stock;
                  return (
                    <li key={l.key} className="p-2.5 hover:bg-muted/40 transition-colors duration-100">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold leading-snug">{l.name}</div>
                          <div className="text-2xs text-muted-ink font-mono">{l.sku}</div>
                        </div>
                        <IconButton
                          icon={Trash2}
                          label={`Bỏ ${l.name} khỏi giỏ`}
                          variant="ghost"
                          size={14}
                          className="!text-danger hover:!bg-red-50"
                          onClick={() => removeLine(l.key)}
                        />
                      </div>

                      <div className="flex items-center gap-1.5 mt-1.5">
                        {/* Số lượng */}
                        <div className="flex items-center border border-line rounded overflow-hidden shrink-0">
                          <button
                            className="w-7 h-7 flex items-center justify-center hover:bg-muted
                                       transition-colors duration-100 cursor-pointer"
                            aria-label="Giảm số lượng"
                            onClick={() => updateLine(l.key, { qty: Math.max(0.01, l.qty - 1) })}
                          >
                            <Minus size={13} aria-hidden="true" />
                          </button>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            className="w-14 h-7 text-center text-[13px] tabular font-mono border-x border-line
                                       focus:outline-none focus:bg-accent-soft/50"
                            aria-label={`Số lượng ${l.name}`}
                            value={l.qty}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => updateLine(l.key, { qty: e.target.value === '' ? '' : Number(e.target.value) })}
                            onBlur={(e) => { if (!Number(e.target.value)) updateLine(l.key, { qty: 1 }); }}
                          />
                          <button
                            className="w-7 h-7 flex items-center justify-center hover:bg-muted
                                       transition-colors duration-100 cursor-pointer"
                            aria-label="Tăng số lượng"
                            onClick={() => updateLine(l.key, { qty: l.qty + 1 })}
                          >
                            <Plus size={13} aria-hidden="true" />
                          </button>
                        </div>

                        {/* Đơn vị tính */}
                        {l.units.length > 1 ? (
                          <select
                            className="field field-sm !w-auto shrink-0 text-2xs"
                            value={l.unit_id}
                            onChange={(e) => changeUnit(l, e.target.value)}
                            aria-label={`Đơn vị tính của ${l.name}`}
                          >
                            {l.units.map((u) => (
                              <option key={u.id} value={u.id}>{u.unit_name}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-2xs text-muted-ink px-1 shrink-0">{l.unit_name}</span>
                        )}

                        {/* Đơn giá sửa được tại chỗ */}
                        <input
                          className="field field-sm num flex-1 min-w-0"
                          inputMode="numeric"
                          aria-label={`Đơn giá ${l.name}`}
                          value={n(l.price)}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const v = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0;
                            updateLine(l.key, { price: v, priceEdited: true });
                          }}
                        />
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-1.5">
                        <div className="flex items-center gap-1.5">
                          {l.factor > 1 && (
                            <span className="text-2xs text-muted-ink tabular">
                              = {fq(l.qty * l.factor)} {l.base_unit}
                            </span>
                          )}
                          {overStock && (
                            <Badge tone="bad">Vượt tồn ({fq(l.stock)} {l.base_unit})</Badge>
                          )}
                        </div>
                        <span className="text-sm font-bold tabular font-mono">{money(amount)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Tổng tiền + nút thanh toán */}
          <div className="border-t border-line p-2.5 shrink-0 bg-card">
            <div className="space-y-1 mb-2.5">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-muted-ink">Tạm tính ({totals.count} mặt hàng)</span>
                <span className="tabular font-mono font-semibold">{money(totals.subtotal)}</span>
              </div>

              <div className="flex items-center justify-between gap-2 text-[13px]">
                <label htmlFor="pos-discount" className="text-muted-ink flex items-center gap-1">
                  <Percent size={12} aria-hidden="true" /> Giảm giá đơn
                </label>
                <MoneyInput
                  id="pos-discount"
                  size="sm"
                  className="!w-28"
                  value={orderDiscount}
                  onChange={setOrderDiscount}
                />
              </div>

              <label className="flex items-center justify-between gap-2 text-[13px] cursor-pointer py-0.5">
                <span className="text-muted-ink flex items-center gap-1">
                  <FileText size={12} aria-hidden="true" /> Xuất hoá đơn GTGT
                </span>
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-emerald-700 cursor-pointer"
                  checked={isVat}
                  onChange={(e) => setIsVat(e.target.checked)}
                />
              </label>

              {isVat && totals.vat > 0 && (
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-muted-ink">Thuế GTGT</span>
                  <span className="tabular font-mono">{money(totals.vat)}</span>
                </div>
              )}

              <div className="flex items-baseline justify-between pt-1.5 border-t border-line">
                <span className="font-semibold">Khách phải trả</span>
                <span className="text-2xl font-display font-bold text-accent tabular">
                  {money(totals.total)}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="btn-touch"
                disabled={!cart.length}
                onClick={clearCart}
                icon={X}
              >
                Huỷ
              </Button>
              <Button
                variant="primary"
                size="lg"
                className="flex-1"
                disabled={!cart.length}
                onClick={() => setPayOpen(true)}
              >
                Thanh toán
                <span className="kbd !bg-white/20 !text-white !border-white/25 ml-1">F4</span>
              </Button>
            </div>
          </div>
        </aside>
      </div>

      {/* --------------------------- Hộp thanh toán --------------------------- */}
      <PaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        totals={totals}
        customer={customer}
        note={note}
        setNote={setNote}
        onSubmit={submit}
        accounts={meta.accounts}
      />

      {/* --------------------------- Khách hàng mới -------------------------- */}
      <CustomerForm
        open={custOpen}
        onClose={() => setCustOpen(false)}
        onSaved={async (c) => {
          await reloadCustomers();
          setCustomerId(c.id);
          setCustOpen(false);
          toast(`Đã thêm khách hàng ${c.name}`, 'ok');
        }}
      />

      {/* --------------------------- In hoá đơn vừa xong --------------------- */}
      {lastSale && (
        <InvoicePrint
          sale={lastSale}
          store={store}
          invoice={settings?.invoice || {}}
          onClose={() => setLastSale(null)}
        />
      )}
    </div>
  );
}

/* ==================================================================== */
/* Hộp thanh toán                                                        */
/* ==================================================================== */

function PaymentModal({ open, onClose, totals, customer, note, setNote, onSubmit, accounts }) {
  const [method, setMethod] = useState('cash');
  const [received, setReceived] = useState(0);
  const [transferAmount, setTransferAmount] = useState(0);
  const [debtAmount, setDebtAmount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setMethod('cash');
    setReceived(totals.total);
    setTransferAmount(0);
    setDebtAmount(0);
    setErr('');
  }, [open, totals.total]);

  /* Số tiền thực thu theo từng hình thức */
  const paid = method === 'cash' ? Math.min(received, totals.total)
    : method === 'transfer' ? totals.total
      : method === 'debt' ? Math.max(0, totals.total - debtAmount)
        : Math.min(received + transferAmount, totals.total);

  const change = method === 'cash' ? Math.max(0, received - totals.total) : 0;
  const remaining = Math.max(0, totals.total - paid);

  const QUICK = [
    totals.total,
    Math.ceil(totals.total / 10000) * 10000,
    Math.ceil(totals.total / 50000) * 50000,
    Math.ceil(totals.total / 100000) * 100000,
    Math.ceil(totals.total / 500000) * 500000,
  ].filter((v, i, a) => v > 0 && a.indexOf(v) === i).slice(0, 5);

  const submit = async () => {
    setErr('');
    if (remaining > 0 && !customer) {
      setErr('Đơn còn nợ lại nên bắt buộc phải chọn khách hàng để theo dõi công nợ.');
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        payment_method: remaining > 0 ? 'debt' : method === 'mixed' ? 'mixed' : method,
        paid,
        received: method === 'cash' ? received : paid,
        cash_amount: method === 'cash' ? Math.min(received, totals.total)
          : method === 'mixed' ? Math.min(received, totals.total - transferAmount)
            : method === 'debt' ? Math.max(0, totals.total - debtAmount) : 0,
        transfer_amount: method === 'transfer' ? totals.total
          : method === 'mixed' ? transferAmount : 0,
      });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  /* Enter để hoàn tất nhanh */
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, paid, method, received, transferAmount, debtAmount, customer]);

  const METHODS = [
    { key: 'cash', label: 'Tiền mặt', icon: Wallet },
    { key: 'transfer', label: 'Chuyển khoản', icon: CreditCard },
    { key: 'debt', label: 'Ghi nợ', icon: HandCoins },
    { key: 'mixed', label: 'Kết hợp', icon: Tag },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Thanh toán"
      subtitle={customer ? `Khách hàng: ${customer.name}` : 'Khách lẻ'}
      size="md"
      footer={<>
        <Button onClick={onClose}>Quay lại</Button>
        <Button variant="primary" size="lg" onClick={submit} loading={busy} icon={Printer}>
          Hoàn tất &amp; In hoá đơn
        </Button>
      </>}
    >
      <div className="space-y-4">
        <div className="bg-accent-soft/60 rounded-lg p-3 text-center">
          <div className="text-2xs font-bold text-emerald-900/70 uppercase tracking-wide">Khách phải trả</div>
          <div className="text-3xl font-display font-bold text-emerald-900 tabular mt-0.5">
            {money(totals.total)}
          </div>
        </div>

        <div>
          <span className="label">Hình thức thanh toán</span>
          <div className="grid grid-cols-4 gap-1.5">
            {METHODS.map((m) => (
              <button
                key={m.key}
                onClick={() => setMethod(m.key)}
                className={`btn btn-touch flex-col !gap-0.5 !py-2 text-2xs
                            ${method === m.key ? 'btn-secondary' : 'btn-outline'}`}
              >
                <m.icon size={16} aria-hidden="true" />
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {(method === 'cash' || method === 'mixed') && (
          <Field label="Tiền khách đưa" htmlFor="pay-received">
            <MoneyInput id="pay-received" size="lg" value={received} onChange={setReceived} autoFocus />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {QUICK.map((v) => (
                <button
                  key={v}
                  onClick={() => setReceived(v)}
                  className={`btn btn-sm ${received === v ? 'btn-soft' : 'btn-outline'}`}
                >
                  {n(v)}
                </button>
              ))}
            </div>
          </Field>
        )}

        {method === 'mixed' && (
          <Field label="Trong đó chuyển khoản" htmlFor="pay-transfer">
            <MoneyInput id="pay-transfer" value={transferAmount} onChange={setTransferAmount} />
          </Field>
        )}

        {method === 'debt' && (
          <Field
            label="Khách trả trước bao nhiêu"
            hint="Để 0 nếu khách nợ toàn bộ. Phần còn lại ghi vào công nợ."
            htmlFor="pay-partial"
          >
            <MoneyInput
              id="pay-partial"
              size="lg"
              value={totals.total - debtAmount}
              onChange={(v) => setDebtAmount(Math.max(0, totals.total - v))}
              autoFocus
            />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="card p-2.5">
            <div className="text-2xs font-bold text-muted-ink uppercase">Tiền thối lại</div>
            <div className="text-lg font-display font-bold tabular mt-0.5">{money(change)}</div>
          </div>
          <div className="card p-2.5">
            <div className="text-2xs font-bold text-muted-ink uppercase">Còn nợ lại</div>
            <div className={`text-lg font-display font-bold tabular mt-0.5 ${remaining > 0 ? 'text-danger' : ''}`}>
              {money(remaining)}
            </div>
          </div>
        </div>

        {remaining > 0 && customer?.debt_limit > 0 && (
          <p className="text-2xs text-warn font-semibold">
            Nợ hiện tại của khách: {money(customer.debt)} / hạn mức {money(customer.debt_limit)}
          </p>
        )}

        <Field label="Ghi chú hoá đơn" htmlFor="pay-note">
          <Textarea
            id="pay-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ví dụ: giao hàng chiều mai, lắp đặt tại nhà..."
          />
        </Field>

        {err && (
          <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">
            {err}
          </p>
        )}
      </div>
    </Modal>
  );
}
