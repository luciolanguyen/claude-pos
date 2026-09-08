import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Plus, Minus, Trash2, X, UserPlus, Printer, Percent, Package,
  ShoppingCart, ArrowLeft, Wallet, CreditCard, HandCoins, FileText, Tag, Grid3x3,
  Truck, Save, History, StickyNote, Eye, EyeOff, ChevronDown, FolderOpen, AlertTriangle,
  ClipboardList, RefreshCcw,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, useLocal } from '../lib/store';
import { money, n, qty as fq, match, datetime, date, smartTime, PAYMENT_LABEL } from '../lib/format';
import {
  Button, IconButton, Input, Select, Modal, Field, MoneyInput, Empty,
  Spinner, Badge, Combo, Textarea, QtyInput,
} from '../components/ui';
import InvoicePrint from '../components/InvoicePrint';
import CustomerForm from '../components/CustomerForm';
import {
  OrderBell, SaveAsOrderModal, PickOrderModal, ExchangeModal,
} from '../components/PosOrders';

/* Chỉ chủ và quản lý mới được xem giá vốn khi bán. */
const canSeeCost = (user) => user?.role === 'owner' || user?.role === 'manager';

const newTab = (i, priceListId) => ({
  id: 'tab' + Date.now() + Math.random().toString(36).slice(2, 6),
  title: `Hoá đơn ${i}`,
  draftId: null,
  cart: [],
  customerId: null,
  priceListId,
  discountType: 'amount',
  discountValue: 0,
  note: '',
  isVat: false,
  delivery: null,
});

const EMPTY_DELIVERY = {
  name: '', phone: '', address: '', carrierId: null,
  trackingCode: '', shipFee: 0, shipPayer: 'customer', codAmount: 0, note: '',
};

/* Ô hiển thị 1 sản phẩm trong lưới chọn hàng. */
function ProductTile({ p, priceListId, showCost, onPick }) {
  const baseUnit = p.units.find((u) => u.factor === 1) || p.units[0];
  const price = baseUnit?.prices?.[priceListId] ?? 0;
  const out = p.track_stock && p.stock <= 0;
  const low = p.track_stock && p.min_stock > 0 && p.stock > 0 && p.stock <= p.min_stock;

  return (
    <button
      onClick={() => onPick(p)}
      disabled={out}
      className="card p-2 text-left transition-colors duration-150 cursor-pointer
                 hover:border-accent hover:bg-accent-soft/40 disabled:opacity-45
                 disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:bg-card
                 flex flex-col gap-1 min-h-[92px]"
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-2xs font-mono text-muted-ink">{p.sku}</span>
        {out ? <Badge tone="bad">Hết</Badge> : low ? <Badge tone="warn">Sắp hết</Badge> : null}
      </div>
      <div className="text-[13px] font-semibold leading-snug line-clamp-2 flex-1">{p.name}</div>
      {p.alias && (
        <div className="text-2xs text-muted-ink italic truncate leading-tight">{p.alias}</div>
      )}
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[13px] font-bold text-accent tabular font-mono">{n(price)}</span>
        <span className="text-2xs text-muted-ink tabular">
          {p.track_stock ? `${fq(p.stock)} ${p.base_unit}` : 'Dịch vụ'}
        </span>
      </div>
      {showCost && (
        <div className="text-2xs text-muted-ink tabular border-t border-line pt-0.5">
          Vốn {n(p.cost_price)}
          {price > 0 && p.cost_price > 0 && (
            <span className="ml-1 text-emerald-700 font-semibold">
              +{Math.round((price - p.cost_price) / p.cost_price * 100)}%
            </span>
          )}
        </div>
      )}
    </button>
  );
}

export default function POS() {
  const {
    meta, defaultWarehouse, defaultPriceList, user, store, settings, toast, loadMeta,
  } = useApp();

  const [warehouseId, setWarehouseId] = useState(null);
  const [tabs, setTabs] = useLocal('thpos.tabs', []);
  const [activeId, setActiveId] = useLocal('thpos.activeTab', null);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  /* Ba việc mới làm ngay tại quầy: đặt hàng, giao đơn đã đặt, đổi trả */
  const [orderOpen, setOrderOpen] = useState(false);       // giỏ hàng -> đơn đặt
  const [pickOrderOpen, setPickOrderOpen] = useState(false); // mở đơn để giao
  const [exchangeOpen, setExchangeOpen] = useState(false);   // đổi trả hàng
  const [quickOpen, setQuickOpen] = useState(false);
  const [priceHistOf, setPriceHistOf] = useState(null);
  const [noteOf, setNoteOf] = useState(null);
  const [lastSale, setLastSale] = useState(null);
  const [provisional, setProvisional] = useState(null);
  const [showCost, setShowCost] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const searchRef = useRef(null);

  const maySeeCost = canSeeCost(user);

  useEffect(() => { if (defaultWarehouse && !warehouseId) setWarehouseId(defaultWarehouse); }, [defaultWarehouse, warehouseId]);

  /* Luôn có ít nhất một tab */
  useEffect(() => {
    if (!defaultPriceList) return;
    if (!tabs.length) {
      const t = newTab(1, defaultPriceList);
      setTabs([t]);
      setActiveId(t.id);
    } else if (!tabs.some((t) => t.id === activeId)) {
      setActiveId(tabs[0].id);
    }
  }, [tabs, activeId, defaultPriceList, setTabs, setActiveId]);

  const tab = tabs.find((t) => t.id === activeId) || tabs[0] || null;

  /** Sửa tab đang mở. */
  const patchTab = useCallback((patch) => {
    setTabs((prev) => prev.map((t) => t.id === activeId
      ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) }
      : t));
  }, [activeId, setTabs]);

  const { data: products, busy, reload } = useFetch(
    () => api.posProducts({ warehouse_id: warehouseId }),
    [warehouseId], { skip: !warehouseId }
  );
  const { data: customers, reload: reloadCustomers } = useFetch(() => api.customers({ active: 1 }), []);
  const { data: carriers } = useFetch(() => api.get('/carriers'), []);

  /* Giá đã bán cho khách này trước đây — nạp 1 lần khi đổi khách */
  const [priceHist, setPriceHist] = useState({});
  useEffect(() => {
    if (!tab?.customerId) { setPriceHist({}); return; }
    api.get(`/price-history/${tab.customerId}/all`)
      .then(setPriceHist)
      .catch(() => setPriceHist({}));
  }, [tab?.customerId]);

  /* Khách có bảng giá riêng -> tự đổi bảng giá */
  useEffect(() => {
    if (!tab?.customerId || !customers) return;
    const c = customers.find((x) => x.id === tab.customerId);
    if (c?.price_list_id && c.price_list_id !== tab.priceListId) {
      patchTab({ priceListId: c.price_list_id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.customerId, customers]);

  const customer = customers?.find((c) => c.id === tab?.customerId) || null;

  /* ------------------------------ Giỏ hàng ------------------------------ */

  const addToCart = useCallback((product, unitId) => {
    const unit = unitId
      ? product.units.find((u) => u.id === unitId)
      : (product.units.find((u) => u.factor === 1) || product.units[0]);
    if (!unit) return;

    patchTab((t) => {
      const key = `${product.id}:${unit.id}`;
      if (t.cart.some((l) => l.key === key)) {
        return { cart: t.cart.map((l) => l.key === key ? { ...l, qty: l.qty + 1 } : l) };
      }
      return {
        cart: [...t.cart, {
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
          price: unit.prices?.[t.priceListId] ?? unit.prices?.[defaultPriceList] ?? 0,
          discountType: 'amount',
          discountValue: 0,
          note: '',
          warrantyMonths: 0,
          serial: '',
          vat_rate: product.vat_rate,
          track_stock: product.track_stock,
          stock: product.stock,
          cost_price: product.cost_price,
        }],
      };
    });
  }, [patchTab, defaultPriceList]);

  /* Đổi bảng giá -> áp lại giá cho dòng chưa sửa tay */
  const applyPriceList = (plId) => {
    patchTab((t) => ({
      priceListId: plId,
      cart: t.cart.map((l) => {
        if (l.priceEdited) return l;
        const u = l.units?.find((x) => x.id === l.unit_id);
        const p = u?.prices?.[plId];
        return p != null ? { ...l, price: p } : l;
      }),
    }));
  };

  const updateLine = (key, patch) =>
    patchTab((t) => ({ cart: t.cart.map((l) => l.key === key ? { ...l, ...patch } : l) }));

  const removeLine = (key) =>
    patchTab((t) => ({ cart: t.cart.filter((l) => l.key !== key) }));

  const changeUnit = (line, unitId) => {
    const u = line.units.find((x) => x.id === Number(unitId));
    if (!u) return;
    patchTab((t) => {
      const newKey = `${line.product_id}:${u.id}`;
      if (t.cart.some((l) => l.key === newKey && l.key !== line.key)) {
        return {
          cart: t.cart
            .map((l) => l.key === newKey ? { ...l, qty: l.qty + line.qty } : l)
            .filter((l) => l.key !== line.key),
        };
      }
      return {
        cart: t.cart.map((l) => l.key === line.key
          ? {
              ...l, key: newKey, unit_id: u.id, unit_name: u.unit_name, factor: u.factor,
              price: l.priceEdited ? l.price : (u.prices?.[t.priceListId] ?? l.price),
            }
          : l),
      };
    });
  };

  const clearTab = () => patchTab({
    cart: [], discountType: 'amount', discountValue: 0,
    note: '', customerId: null, isVat: false, delivery: null,
  });

  /* ------------------------------- Tính tiền ------------------------------ */

  const lineAmount = (l) => {
    const gross = Math.round(l.qty * l.price);
    const disc = l.discountType === 'percent'
      ? Math.round(gross * (Number(l.discountValue) || 0) / 100)
      : Math.round(Number(l.discountValue) || 0);
    return { gross, disc: Math.min(disc, gross), amount: gross - Math.min(disc, gross) };
  };

  const totals = useMemo(() => {
    if (!tab) return { subtotal: 0, vat: 0, total: 0, count: 0, discount: 0, cogs: 0, lineDiscount: 0 };
    let subtotal = 0, vat = 0, cogs = 0, lineDiscount = 0;
    for (const l of tab.cart) {
      const { disc, amount } = lineAmount(l);
      lineDiscount += disc;
      subtotal += amount;
      if (tab.isVat) vat += Math.round(amount * (l.vat_rate || 0) / 100);
      cogs += Math.round(l.qty * (l.factor || 1) * (l.cost_price || 0));
    }
    const discount = Math.min(
      tab.discountType === 'percent'
        ? Math.round(subtotal * (Number(tab.discountValue) || 0) / 100)
        : Math.round(Number(tab.discountValue) || 0),
      subtotal
    );
    const shipCharged = tab.delivery?.shipPayer === 'customer'
      ? Math.round(Number(tab.delivery.shipFee) || 0) : 0;
    return {
      subtotal, vat, discount, lineDiscount, cogs, shipCharged,
      total: Math.max(0, subtotal - discount + vat + shipCharged),
      count: tab.cart.length,
    };
  }, [tab]);

  /* ---------------------------- Lọc danh sách hàng ---------------------- */

  const filtered = useMemo(() => {
    if (!products) return [];
    let list = products;
    if (categoryId) list = list.filter((p) => p.category_id === Number(categoryId));
    if (search.trim()) {
      list = list.filter((p) =>
        match(p.name, search) || match(p.alias || '', search) || match(p.sku, search) ||
        (p.barcode || '').includes(search.trim()) || match(p.brand || '', search));
    }
    return list;
  }, [products, categoryId, search]);

  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return;
    const term = search.trim();
    if (!term) return;
    const exact = products?.find((p) => p.barcode === term || p.sku.toLowerCase() === term.toLowerCase());
    if (exact) {
      if (exact.track_stock && exact.stock <= 0) toast(`"${exact.name}" đã hết hàng trong kho`, 'warn');
      else { addToCart(exact); setSearch(''); }
      return;
    }
    if (filtered.length === 1) { addToCart(filtered[0]); setSearch(''); }
    else if (filtered.length === 0) toast(`Không tìm thấy hàng nào khớp "${term}"`, 'warn');
  };

  /* ------------------------------ Quản lý tab ---------------------------- */

  const addTab = () => {
    const nums = tabs.map((t) => Number((t.title.match(/\d+/) || [])[0]) || 0);
    const next = Math.max(0, ...nums) + 1;
    const t = newTab(next, defaultPriceList);
    setTabs((prev) => [...prev, t]);
    setActiveId(t.id);
    setSearch('');
  };

  const closeTab = (id) => {
    const t = tabs.find((x) => x.id === id);
    if (t?.cart.length && !window.confirm(
      `"${t.title}" đang có ${t.cart.length} mặt hàng chưa thanh toán.\n\n` +
      'Đóng tab này sẽ mất giỏ hàng. Nếu muốn giữ lại, bấm Huỷ rồi dùng nút "Lưu tạm".'
    )) return;
    setTabs((prev) => {
      const next = prev.filter((x) => x.id !== id);
      if (id === activeId) setActiveId(next[0]?.id ?? null);
      return next;
    });
  };

  /* ------------------------------ Phím tắt ------------------------------- */

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === 'F4') { e.preventDefault(); if (tab?.cart.length) setPayOpen(true); }
      else if (e.key === 'F8') { e.preventDefault(); setCustOpen(true); }
      else if (e.key === 'F7') { e.preventDefault(); addTab(); }
      else if (e.key === 'Escape' && !payOpen && !custOpen) setSearch('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, payOpen, custOpen, tabs]);

  /* ------------------------------ Lưu tạm -------------------------------- */

  const saveDraft = async () => {
    if (!tab?.cart.length) { toast('Giỏ hàng đang trống, chưa có gì để lưu.', 'warn'); return; }
    try {
      const res = await api.post('/drafts', {
        id: tab.draftId || undefined,
        title: tab.title,
        customer_id: tab.customerId,
        user_id: user?.id,
        warehouse_id: warehouseId,
        price_list_id: tab.priceListId,
        total: totals.total,
        item_count: tab.cart.length,
        payload: {
          cart: tab.cart, discountType: tab.discountType, discountValue: tab.discountValue,
          note: tab.note, isVat: tab.isVat, delivery: tab.delivery,
        },
      });
      patchTab({ draftId: res.id });
      toast(`Đã lưu tạm "${tab.title}" — mọi máy trong tiệm đều mở tiếp được.`, 'ok', 5000);
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  const openDraft = (d) => {
    const p = d.payload || {};
    const t = {
      id: 'tab' + Date.now(),
      title: d.title || `Hoá đơn tạm ${d.code}`,
      draftId: d.id,
      cart: p.cart || [],
      customerId: d.customer_id,
      priceListId: d.price_list_id || defaultPriceList,
      discountType: p.discountType || 'amount',
      discountValue: p.discountValue || 0,
      note: p.note || '',
      isVat: !!p.isVat,
      delivery: p.delivery || null,
    };
    setTabs((prev) => [...prev, t]);
    setActiveId(t.id);
    setDraftsOpen(false);
    toast(`Đã mở "${t.title}"`, 'ok');
  };

  /* ------------------------------ Thanh toán ----------------------------- */

  const buildBody = (extra = {}) => ({
    items: tab.cart.map((l) => ({
      product_id: l.product_id,
      name_snapshot: l.name,
      unit_name: l.unit_name,
      factor: l.factor,
      qty: l.qty,
      price: l.price,
      discount_type: l.discountType,
      discount: l.discountType === 'amount' ? l.discountValue : 0,
      discount_percent: l.discountType === 'percent' ? l.discountValue : 0,
      vat_rate: l.vat_rate,
      note: l.note || null,
      warranty_months: Number(l.warrantyMonths) || 0,
      serial: l.serial || null,
    })),
    customer_id: tab.customerId,
    warehouse_id: warehouseId,
    user_id: user?.id,
    price_list_id: tab.priceListId,
    discount_type: tab.discountType,
    discount: tab.discountType === 'amount' ? tab.discountValue : 0,
    discount_percent: tab.discountType === 'percent' ? tab.discountValue : 0,
    is_vat_invoice: tab.isVat ? 1 : 0,
    note: tab.note,
    ...(tab.delivery ? {
      delivery_name: tab.delivery.name,
      delivery_phone: tab.delivery.phone,
      delivery_address: tab.delivery.address,
      carrier_id: tab.delivery.carrierId,
      tracking_code: tab.delivery.trackingCode,
      ship_fee: Number(tab.delivery.shipFee) || 0,
      ship_payer: tab.delivery.shipPayer,
      cod_amount: Number(tab.delivery.codAmount) || 0,
      delivery_note: tab.delivery.note,
    } : {}),
    ...extra,
  });

  const submit = async (payload) => {
    const res = await api.post('/sales', buildBody(payload));
    const full = await api.sale(res.id);
    setLastSale(full);
    if (tab.draftId) { try { await api.del(`/drafts/${tab.draftId}`); } catch { /* đã xoá */ } }
    // Đóng tab vừa thanh toán, còn 1 tab thì làm sạch thay vì đóng
    setTabs((prev) => {
      if (prev.length === 1) {
        return [{ ...newTab(1, defaultPriceList), id: prev[0].id, title: prev[0].title }];
      }
      const next = prev.filter((t) => t.id !== activeId);
      setActiveId(next[0]?.id ?? null);
      return next;
    });
    setPayOpen(false);
    reload();
    toast(`Đã lưu hoá đơn ${res.code}`, 'ok');
    return res;
  };

  /* Hoá đơn tạm tính: dựng đối tượng giống hoá đơn thật để dùng chung mẫu in */
  const buildProvisional = () => ({
    code: 'TẠM TÍNH',
    ts: new Date().toISOString().slice(0, 19).replace('T', ' '),
    customer_name: customer?.name || 'Khách lẻ',
    customer_phone: customer?.phone,
    customer_address: customer?.address,
    user_name: user?.full_name,
    warehouse_name: meta.warehouses.find((w) => w.id === warehouseId)?.name,
    subtotal: totals.subtotal,
    discount: totals.discount,
    vat_amount: totals.vat,
    total: totals.total,
    cogs: totals.cogs,
    paid: 0,
    change_given: 0,
    payment_method: 'cash',
    is_vat_invoice: tab.isVat ? 1 : 0,
    status: 'done',
    note: tab.note,
    provisional: true,
    items: tab.cart.map((l, i) => ({
      id: i, product_id: l.product_id, name_snapshot: l.name, sku: l.sku,
      unit_name: l.unit_name, factor: l.factor, qty: l.qty, price: l.price,
      discount: lineAmount(l).disc, amount: lineAmount(l).amount,
      unit_cost: l.cost_price, vat_rate: l.vat_rate, note: l.note,
    })),
    returns: [],
  });

  if (!warehouseId || !tab) return <Spinner />;

  const priceListName = meta.priceLists.find((p) => p.id === tab.priceListId)?.name;

  return (
    <div className="h-screen flex flex-col bg-surface">
      {/* ---------------------------- Thanh trên ---------------------------- */}
      <header className="h-14 bg-primary flex items-center gap-2 px-3 shrink-0 no-print">
        <Link to="/" className="text-slate-300 hover:text-white p-1.5 rounded hover:bg-white/10
                                transition-colors duration-150" aria-label="Quay lại trang tổng quan">
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
        <ShoppingCart size={18} className="text-emerald-400 shrink-0" aria-hidden="true" />

        <div className="flex-1 max-w-xl mx-2">
          <div className="relative">
            <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              ref={searchRef}
              className="w-full h-9 rounded bg-white/10 text-white placeholder:text-slate-400 pl-8 pr-16
                         border border-white/15 focus:bg-white focus:text-ink focus:placeholder:text-slate-400
                         focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40
                         transition-colors duration-150 text-[13px]"
              placeholder="Quét mã vạch, gõ tên hàng hoặc tên phụ..."
              aria-label="Tìm hàng hoá hoặc quét mã vạch"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKey}
              autoFocus
            />
            <span className="kbd absolute right-2 top-1/2 -translate-y-1/2 !bg-white/15 !text-slate-300 !border-white/20">F2</span>
          </div>
        </div>

        <OrderBell onOpen={() => setPickOrderOpen(true)} />

        {maySeeCost && (
          <button
            onClick={() => setShowCost((v) => !v)}
            className={`h-9 px-2.5 rounded border text-[13px] font-semibold hidden md:flex items-center gap-1.5
                        transition-colors duration-150 cursor-pointer
                        ${showCost
                          ? 'bg-amber-500/20 border-amber-400/40 text-amber-200'
                          : 'bg-white/10 border-white/15 text-slate-300 hover:text-white'}`}
            title="Chỉ chủ và quản lý thấy được nút này"
          >
            {showCost ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
            Giá vốn
          </button>
        )}

        <select
          className="h-9 rounded bg-white/10 text-white border border-white/15 px-2 text-[13px]
                     cursor-pointer hidden md:block focus:outline-none focus:ring-2 focus:ring-accent/40"
          value={tab.priceListId || ''}
          onChange={(e) => applyPriceList(Number(e.target.value))}
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

      {/* ---------------------------- Thanh tab hoá đơn ---------------------- */}
      <div className="bg-slate-800 flex items-stretch gap-0.5 px-2 shrink-0 overflow-x-auto no-print"
        role="tablist" aria-label="Các hoá đơn đang mở">
        {tabs.map((t) => {
          const active = t.id === activeId;
          const count = t.cart.length;
          return (
            <div key={t.id} className="flex items-stretch shrink-0">
              <button
                role="tab"
                aria-selected={active}
                onClick={() => { setActiveId(t.id); setSearch(''); }}
                className={`flex items-center gap-1.5 px-3 h-9 text-[13px] font-semibold
                            rounded-t transition-colors duration-150 cursor-pointer whitespace-nowrap
                            ${active
                              ? 'bg-surface text-ink'
                              : 'text-slate-300 hover:text-white hover:bg-white/10'}`}
              >
                {t.draftId && <Save size={11} className="text-emerald-500 shrink-0" aria-hidden="true" />}
                {t.title}
                {count > 0 && (
                  <span className={`text-2xs px-1 rounded tabular ${active ? 'bg-accent-soft text-emerald-900' : 'bg-white/20'}`}>
                    {count}
                  </span>
                )}
              </button>
              {tabs.length > 1 && (
                <button
                  onClick={() => closeTab(t.id)}
                  aria-label={`Đóng ${t.title}`}
                  className={`px-1.5 rounded-t transition-colors duration-150 cursor-pointer
                              ${active ? 'bg-surface text-muted-ink hover:text-danger' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
        <button
          onClick={addTab}
          className="px-2.5 h-9 text-slate-300 hover:text-white hover:bg-white/10 rounded-t
                     transition-colors duration-150 cursor-pointer shrink-0 flex items-center gap-1"
          aria-label="Mở thêm hoá đơn mới (F7)"
          title="Mở thêm hoá đơn mới (F7)"
        >
          <Plus size={15} aria-hidden="true" />
          <span className="kbd !bg-white/15 !text-slate-300 !border-white/20 hidden sm:inline">F7</span>
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setExchangeOpen(true)}
          className="px-2.5 h-9 text-slate-300 hover:text-white hover:bg-white/10 rounded-t
                     transition-colors duration-150 cursor-pointer shrink-0 flex items-center gap-1.5 text-[13px]"
        >
          <RefreshCcw size={14} aria-hidden="true" />
          <span className="hidden sm:inline">Đổi trả hàng</span>
        </button>
        <button
          onClick={() => setPickOrderOpen(true)}
          className="px-2.5 h-9 text-slate-300 hover:text-white hover:bg-white/10 rounded-t
                     transition-colors duration-150 cursor-pointer shrink-0 flex items-center gap-1.5 text-[13px]"
        >
          <Truck size={14} aria-hidden="true" />
          <span className="hidden sm:inline">Giao đơn đặt</span>
        </button>
        <button
          onClick={() => setDraftsOpen(true)}
          className="px-2.5 h-9 text-slate-300 hover:text-white hover:bg-white/10 rounded-t
                     transition-colors duration-150 cursor-pointer shrink-0 flex items-center gap-1.5 text-[13px]"
        >
          <FolderOpen size={14} aria-hidden="true" />
          <span className="hidden sm:inline">Hoá đơn tạm</span>
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* ------------------------- Lưới chọn hàng ------------------------ */}
        <section className={`flex-1 min-w-0 flex flex-col ${showGrid ? '' : 'hidden lg:flex'}`}>
          <div className="px-3 py-2 border-b border-line bg-card flex items-center gap-2 overflow-x-auto shrink-0">
            <button onClick={() => setCategoryId('')}
              className={`btn btn-sm shrink-0 ${categoryId === '' ? 'btn-secondary' : 'btn-outline'}`}>
              Tất cả <span className="text-2xs opacity-70">({products?.length || 0})</span>
            </button>
            {meta.categories.map((c) => (
              <button key={c.id} onClick={() => setCategoryId(String(c.id))}
                className={`btn btn-sm shrink-0 ${categoryId === String(c.id) ? 'btn-secondary' : 'btn-outline'}`}>
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
                  message={search
                    ? `Không tìm thấy "${search}". Thử gõ tên khác, tên phụ, hoặc bỏ bớt bộ lọc nhóm hàng.`
                    : 'Nhóm hàng này chưa có sản phẩm.'}
                  action={search && <Button onClick={() => setSearch('')}>Xoá từ khoá</Button>}
                />
              ) : (
                <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {filtered.map((p) => (
                    <ProductTile key={p.id} p={p} priceListId={tab.priceListId}
                      showCost={maySeeCost && showCost} onPick={addToCart} />
                  ))}
                </div>
              )}
          </div>
        </section>

        {/* ---------------------------- Giỏ hàng --------------------------- */}
        <aside className={`w-full lg:w-[440px] xl:w-[480px] shrink-0 bg-card border-l border-line
                           flex flex-col ${showGrid ? 'hidden lg:flex' : 'flex'}`}>
          {/* Khách hàng */}
          <div className="p-2.5 border-b border-line shrink-0">
            <div className="flex items-center gap-1.5">
              <div className="flex-1 min-w-0">
                <Combo
                  size="sm"
                  items={customers || []}
                  value={tab.customerId}
                  onChange={(id) => patchTab({ customerId: id })}
                  placeholder="Khách lẻ (không ghi tên)"
                  filter={(c, q) => match(c.name, q) || (c.phone || '').includes(q) || match(c.code, q)}
                  render={(c) => ({
                    label: c.name,
                    sub: [c.phone, c.debt > 0 ? `Đang nợ ${money(c.debt)}` : null].filter(Boolean).join(' · '),
                  })}
                />
              </div>
              {customer && (
                <IconButton icon={History} label={`Xem lịch sử mua của ${customer.name}`}
                  variant="outline" onClick={() => setQuickOpen(true)} />
              )}
              <IconButton icon={UserPlus} label="Thêm khách hàng mới (F8)"
                variant="outline" onClick={() => setCustOpen(true)} />
            </div>
            {customer && (
              <div className="flex items-center gap-2 mt-1.5 text-2xs flex-wrap">
                {customer.phone && <span className="text-muted-ink">{customer.phone}</span>}
                {customer.debt > 0 && (
                  <Badge tone={customer.over_limit ? 'bad' : 'warn'}>Nợ cũ {money(customer.debt)}</Badge>
                )}
                {priceListName && <Badge tone="info">{priceListName}</Badge>}
              </div>
            )}
          </div>

          {/* Các dòng hàng */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {tab.cart.length === 0 ? (
              <Empty
                icon={ShoppingCart}
                title="Chưa chọn hàng"
                message="Quét mã vạch, gõ tên hàng ở ô tìm kiếm, hoặc bấm vào ô hàng bên trái."
              />
            ) : (
              <ul className="divide-y divide-line">
                {tab.cart.map((l) => {
                  const { gross, disc, amount } = lineAmount(l);
                  const overStock = l.track_stock && l.qty * l.factor > l.stock;
                  const hist = priceHist[l.product_id];
                  const profit = amount - Math.round(l.qty * l.factor * (l.cost_price || 0));

                  return (
                    <li key={l.key} className="p-2.5 hover:bg-muted/40 transition-colors duration-100">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold leading-snug">{l.name}</div>
                          <div className="text-2xs text-muted-ink font-mono">{l.sku}</div>
                        </div>
                        {hist?.length > 0 && (
                          <button
                            onClick={() => setPriceHistOf(l)}
                            className="btn btn-sm !min-h-[26px] !px-1.5 btn-outline shrink-0"
                            title={`Giá đã bán cho khách này: ${hist.map((h) => n(h.price)).join(' · ')}`}
                          >
                            <History size={12} aria-hidden="true" />
                            <span className="text-2xs tabular">{n(hist[0].price)}</span>
                          </button>
                        )}
                        <IconButton
                          icon={StickyNote}
                          label={`Ghi chú và bảo hành cho ${l.name}`}
                          size={13}
                          className={l.note || l.warrantyMonths > 0 ? '!text-info' : ''}
                          onClick={() => setNoteOf(l)}
                        />
                        <IconButton icon={Trash2} label={`Bỏ ${l.name} khỏi giỏ`} size={14}
                          className="!text-danger hover:!bg-red-50" onClick={() => removeLine(l.key)} />
                      </div>

                      <div className="flex items-center gap-1.5 mt-1.5">
                        <div className="flex items-center border border-line rounded overflow-hidden shrink-0">
                          <button className="w-7 h-7 flex items-center justify-center hover:bg-muted
                                             transition-colors duration-100 cursor-pointer"
                            aria-label="Giảm số lượng"
                            onClick={() => updateLine(l.key, { qty: Math.max(0.01, l.qty - 1) })}>
                            <Minus size={13} aria-hidden="true" />
                          </button>
                          <input
                            type="number" step="any" min="0"
                            className="w-14 h-7 text-center text-[13px] tabular font-mono border-x border-line
                                       focus:outline-none focus:bg-accent-soft/50"
                            aria-label={`Số lượng ${l.name}`}
                            value={l.qty}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => updateLine(l.key, { qty: e.target.value === '' ? '' : Number(e.target.value) })}
                            onBlur={(e) => { if (!Number(e.target.value)) updateLine(l.key, { qty: 1 }); }}
                          />
                          <button className="w-7 h-7 flex items-center justify-center hover:bg-muted
                                             transition-colors duration-100 cursor-pointer"
                            aria-label="Tăng số lượng"
                            onClick={() => updateLine(l.key, { qty: l.qty + 1 })}>
                            <Plus size={13} aria-hidden="true" />
                          </button>
                        </div>

                        {l.units.length > 1 ? (
                          <select className="field field-sm !w-auto shrink-0 text-2xs"
                            value={l.unit_id}
                            onChange={(e) => changeUnit(l, e.target.value)}
                            aria-label={`Đơn vị tính của ${l.name}`}>
                            {l.units.map((u) => <option key={u.id} value={u.id}>{u.unit_name}</option>)}
                          </select>
                        ) : (
                          <span className="text-2xs text-muted-ink px-1 shrink-0">{l.unit_name}</span>
                        )}

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

                      {/* Giảm giá dòng: chọn % hoặc số tiền */}
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className="text-2xs text-muted-ink w-12 shrink-0">Giảm</span>
                        <div className="flex rounded border border-line overflow-hidden shrink-0">
                          {[['amount', 'đ'], ['percent', '%']].map(([k, lb]) => (
                            <button
                              key={k}
                              onClick={() => updateLine(l.key, { discountType: k, discountValue: 0 })}
                              className={`w-7 h-7 text-2xs font-bold transition-colors duration-100 cursor-pointer
                                          ${l.discountType === k ? 'bg-primary text-white' : 'hover:bg-muted'}`}
                              aria-label={k === 'amount' ? 'Giảm theo số tiền' : 'Giảm theo phần trăm'}
                              aria-pressed={l.discountType === k}
                            >
                              {lb}
                            </button>
                          ))}
                        </div>
                        {l.discountType === 'percent' ? (
                          <input
                            type="number" min="0" max="100" step="0.5"
                            className="field field-sm num !w-16"
                            aria-label={`Phần trăm giảm giá ${l.name}`}
                            value={l.discountValue}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => updateLine(l.key, { discountValue: Math.min(100, Number(e.target.value) || 0) })}
                          />
                        ) : (
                          <input
                            className="field field-sm num !w-24"
                            inputMode="numeric"
                            aria-label={`Số tiền giảm ${l.name}`}
                            value={n(l.discountValue)}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => updateLine(l.key, {
                              discountValue: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0,
                            })}
                          />
                        )}
                        {disc > 0 && (
                          <span className="text-2xs text-danger tabular">-{n(disc)}</span>
                        )}
                        <div className="flex-1" />
                        <span className="text-sm font-bold tabular font-mono">{money(amount)}</span>
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {l.factor > 1 && (
                            <span className="text-2xs text-muted-ink tabular">
                              = {fq(l.qty * l.factor)} {l.base_unit}
                            </span>
                          )}
                          {overStock && <Badge tone="bad">Vượt tồn ({fq(l.stock)} {l.base_unit})</Badge>}
                          {l.note && (
                            <span className="text-2xs text-info truncate max-w-[180px]">
                              Ghi chú: {l.note}
                            </span>
                          )}
                          {l.warrantyMonths > 0 && (
                            <Badge tone="ok">BH {l.warrantyMonths} tháng</Badge>
                          )}
                          {l.serial && (
                            <span className="text-2xs text-muted-ink font-mono">SN {l.serial}</span>
                          )}
                        </div>
                        {maySeeCost && showCost && (
                          <span className={`text-2xs tabular shrink-0 ${profit < 0 ? 'text-danger font-bold' : 'text-muted-ink'}`}>
                            Vốn {n(Math.round(l.qty * l.factor * (l.cost_price || 0)))} · lãi {n(profit)}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Tổng tiền + nút */}
          <div className="border-t border-line p-2.5 shrink-0 bg-card">
            <div className="space-y-1 mb-2.5">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-muted-ink">
                  Tạm tính ({totals.count} mặt hàng)
                  {totals.lineDiscount > 0 && (
                    <span className="text-2xs ml-1">đã giảm {n(totals.lineDiscount)} ở dòng</span>
                  )}
                </span>
                <span className="tabular font-mono font-semibold">{money(totals.subtotal)}</span>
              </div>

              {/* Giảm giá toàn đơn: % hoặc số tiền */}
              <div className="flex items-center justify-between gap-2 text-[13px]">
                <span className="text-muted-ink flex items-center gap-1">
                  <Percent size={12} aria-hidden="true" /> Giảm cả đơn
                </span>
                <div className="flex items-center gap-1.5">
                  <div className="flex rounded border border-line overflow-hidden">
                    {[['amount', 'đ'], ['percent', '%']].map(([k, lb]) => (
                      <button
                        key={k}
                        onClick={() => patchTab({ discountType: k, discountValue: 0 })}
                        className={`w-7 h-7 text-2xs font-bold transition-colors duration-100 cursor-pointer
                                    ${tab.discountType === k ? 'bg-primary text-white' : 'hover:bg-muted'}`}
                        aria-label={k === 'amount' ? 'Giảm cả đơn theo số tiền' : 'Giảm cả đơn theo phần trăm'}
                        aria-pressed={tab.discountType === k}
                      >
                        {lb}
                      </button>
                    ))}
                  </div>
                  {tab.discountType === 'percent' ? (
                    <input
                      type="number" min="0" max="100" step="0.5"
                      className="field field-sm num !w-20"
                      aria-label="Phần trăm giảm cả đơn"
                      value={tab.discountValue}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => patchTab({ discountValue: Math.min(100, Number(e.target.value) || 0) })}
                    />
                  ) : (
                    <MoneyInput size="sm" className="!w-28" value={tab.discountValue}
                      onChange={(v) => patchTab({ discountValue: v })} />
                  )}
                </div>
              </div>
              {totals.discount > 0 && (
                <div className="flex justify-between text-2xs text-danger">
                  <span />
                  <span className="tabular">-{money(totals.discount)}</span>
                </div>
              )}

              <label className="flex items-center justify-between gap-2 text-[13px] cursor-pointer py-0.5">
                <span className="text-muted-ink flex items-center gap-1">
                  <FileText size={12} aria-hidden="true" /> Xuất hoá đơn GTGT
                </span>
                <input type="checkbox" className="w-4 h-4 accent-emerald-700 cursor-pointer"
                  checked={tab.isVat} onChange={(e) => patchTab({ isVat: e.target.checked })} />
              </label>

              {tab.isVat && totals.vat > 0 && (
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-muted-ink">Thuế GTGT</span>
                  <span className="tabular font-mono">{money(totals.vat)}</span>
                </div>
              )}

              {totals.shipCharged > 0 && (
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-muted-ink flex items-center gap-1">
                    <Truck size={12} aria-hidden="true" /> Phí giao hàng
                  </span>
                  <span className="tabular font-mono">{money(totals.shipCharged)}</span>
                </div>
              )}

              <div className="flex items-baseline justify-between pt-1.5 border-t border-line">
                <span className="font-semibold">Khách phải trả</span>
                <span className="text-2xl font-display font-bold text-accent tabular">
                  {money(totals.total)}
                </span>
              </div>

              {maySeeCost && showCost && totals.count > 0 && (
                <div className="flex items-center justify-between text-2xs pt-1 border-t border-line">
                  <span className="text-muted-ink">Giá vốn {n(totals.cogs)}</span>
                  <span className={`font-bold tabular ${totals.subtotal - totals.discount - totals.cogs < 0 ? 'text-danger' : 'text-emerald-700'}`}>
                    Lãi {n(totals.subtotal - totals.discount - totals.cogs)}
                  </span>
                </div>
              )}
            </div>

            {/* Hàng nút phụ */}
            <div className="grid grid-cols-5 gap-1.5 mb-2">
              <button onClick={() => setOrderOpen(true)} disabled={!tab.cart.length}
                className="btn btn-sm btn-outline flex-col !gap-0.5 !py-1.5 text-2xs"
                title="Khách hỏi món hết hàng: biến giỏ này thành đơn đặt, nhận cọc luôn">
                <ClipboardList size={14} aria-hidden="true" />
                Đặt hàng
              </button>
              <button onClick={() => setDeliveryOpen(true)}
                className={`btn btn-sm flex-col !gap-0.5 !py-1.5 text-2xs ${tab.delivery ? 'btn-soft' : 'btn-outline'}`}>
                <Truck size={14} aria-hidden="true" />
                Giao hàng
              </button>
              <button onClick={saveDraft} disabled={!tab.cart.length}
                className="btn btn-sm btn-outline flex-col !gap-0.5 !py-1.5 text-2xs">
                <Save size={14} aria-hidden="true" />
                Lưu tạm
              </button>
              <button onClick={() => setProvisional(buildProvisional())} disabled={!tab.cart.length}
                className="btn btn-sm btn-outline flex-col !gap-0.5 !py-1.5 text-2xs">
                <Printer size={14} aria-hidden="true" />
                Tạm tính
              </button>
              <button onClick={clearTab} disabled={!tab.cart.length}
                className="btn btn-sm btn-outline flex-col !gap-0.5 !py-1.5 text-2xs !text-danger">
                <X size={14} aria-hidden="true" />
                Xoá hết
              </button>
            </div>

            <Button variant="primary" size="lg" className="w-full"
              disabled={!tab.cart.length} onClick={() => setPayOpen(true)}>
              Thanh toán
              <span className="kbd !bg-white/20 !text-white !border-white/25 ml-1">F4</span>
            </Button>
          </div>
        </aside>
      </div>

      {/* ------------------------------- Hộp thoại --------------------------- */}

      <PaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        totals={totals}
        customer={customer}
        note={tab.note}
        setNote={(v) => patchTab({ note: v })}
        onSubmit={submit}
        accounts={meta.accounts}
        delivery={tab.delivery}
      />

      <DeliveryModal
        open={deliveryOpen}
        onClose={() => setDeliveryOpen(false)}
        value={tab.delivery}
        customer={customer}
        carriers={carriers || []}
        total={totals.total}
        onSave={(d) => { patchTab({ delivery: d }); setDeliveryOpen(false); }}
        onClear={() => { patchTab({ delivery: null }); setDeliveryOpen(false); }}
      />

      <DraftsModal
        open={draftsOpen}
        onClose={() => setDraftsOpen(false)}
        onOpen={openDraft}
        openIds={tabs.map((t) => t.draftId).filter(Boolean)}
      />

      {/* --- Đặt hàng và đổi trả ngay tại quầy --- */}

      <SaveAsOrderModal
        open={orderOpen}
        onClose={() => setOrderOpen(false)}
        tab={tab}
        customer={customer}
        totals={totals}
        onSaved={clearTab}
      />

      <PickOrderModal
        open={pickOrderOpen}
        onClose={() => setPickOrderOpen(false)}
        onDelivered={reload}
      />

      <ExchangeModal
        open={exchangeOpen}
        onClose={() => setExchangeOpen(false)}
        products={products || []}
        onDone={reload}
      />

      <PriceHistoryModal
        line={priceHistOf}
        customer={customer}
        onClose={() => setPriceHistOf(null)}
        onApply={(price) => {
          updateLine(priceHistOf.key, { price, priceEdited: true });
          setPriceHistOf(null);
          toast('Đã áp giá lần trước', 'ok');
        }}
      />

      <LineNoteModal
        line={noteOf}
        onClose={() => setNoteOf(null)}
        onSave={(patch) => { updateLine(noteOf.key, patch); setNoteOf(null); }}
      />

      <CustomerQuickModal
        open={quickOpen}
        customerId={tab.customerId}
        onClose={() => setQuickOpen(false)}
      />

      <CustomerForm
        open={custOpen}
        onClose={() => setCustOpen(false)}
        onSaved={async (c) => {
          await reloadCustomers();
          patchTab({ customerId: c.id });
          setCustOpen(false);
          toast(`Đã thêm khách hàng ${c.name}`, 'ok');
        }}
      />

      {lastSale && (
        <InvoicePrint sale={lastSale} store={store} invoice={settings?.invoice || {}}
          onClose={() => setLastSale(null)} />
      )}
      {provisional && (
        <InvoicePrint sale={provisional} store={store} invoice={settings?.invoice || {}}
          onClose={() => setProvisional(null)} />
      )}
    </div>
  );
}

/* ==================================================================== */
/* Giá đã bán cho khách này 3 lần gần nhất                               */
/* ==================================================================== */

function PriceHistoryModal({ line, customer, onClose, onApply }) {
  const { data, busy } = useFetch(
    () => api.get('/price-history', { customer_id: customer.id, product_id: line.product_id }),
    [line?.product_id, customer?.id], { skip: !line || !customer }
  );

  return (
    <Modal
      open={!!line}
      onClose={onClose}
      title="Giá đã bán cho khách này"
      subtitle={line ? `${line.name} · ${customer?.name}` : ''}
      size="sm"
      footer={<Button onClick={onClose}>Đóng</Button>}
    >
      {busy ? <Spinner />
        : !data?.length ? <Empty icon={History} title="Khách chưa mua mặt hàng này lần nào" />
          : (
            <div className="space-y-2">
              <p className="text-[13px] text-muted-ink">
                Bấm vào một dòng để áp lại đúng giá lần đó, tránh báo lệch giá với khách quen.
              </p>
              <ul className="divide-y divide-line border border-line rounded-lg overflow-hidden">
                {data.map((h, i) => (
                  <li key={i}>
                    <button
                      onClick={() => onApply(h.price)}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left
                                 hover:bg-accent-soft/40 transition-colors duration-150 cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold tabular font-mono">{money(h.price)}</div>
                        <div className="text-2xs text-muted-ink">
                          {datetime(h.ts)} · {fq(h.qty)} {h.unit_name} · {h.code}
                        </div>
                      </div>
                      {i === 0 && <Badge tone="ok">Gần nhất</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
    </Modal>
  );
}

/* ==================================================================== */

function LineNoteModal({ line, onClose, onSave }) {
  const [text, setText] = useState('');
  const [months, setMonths] = useState(0);
  const [serial, setSerial] = useState('');

  useEffect(() => {
    if (!line) return;
    setText(line.note || '');
    setMonths(Number(line.warrantyMonths) || 0);
    setSerial(line.serial || '');
  }, [line]);

  /* Hạn bảo hành xem trước cho khách biết ngay */
  const until = months > 0
    ? new Date(new Date().setMonth(new Date().getMonth() + Number(months)))
    : null;

  return (
    <Modal
      open={!!line}
      onClose={onClose}
      title="Ghi chú & bảo hành"
      subtitle={line?.name}
      size="sm"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button
          variant="primary"
          onClick={() => onSave({
            note: text.trim(),
            warrantyMonths: Number(months) || 0,
            serial: serial.trim(),
          })}
        >
          Lưu
        </Button>
      </>}
    >
      <div className="space-y-3">
        <Field
          label="Ghi chú"
          hint="In trên hoá đơn ngay dưới tên hàng. Ví dụ: cắt 12,5m; màu đỏ; giao đợt 2."
          htmlFor="ln-note"
        >
          <Textarea id="ln-note" rows={2} value={text} autoFocus
            onChange={(e) => setText(e.target.value)}
            placeholder="Cắt đúng 12,5 mét, bó riêng" />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Bảo hành (tháng)"
            hint="Để 0 nếu hàng không bảo hành"
            htmlFor="ln-warranty"
          >
            <div className="flex items-center gap-1.5">
              <QtyInput size="md" value={months} onChange={setMonths} min={0} className="flex-1" />
              <div className="flex gap-1">
                {[6, 12, 24].map((m) => (
                  <button
                    key={m}
                    onClick={() => setMonths(m)}
                    className={`btn btn-sm ${Number(months) === m ? 'btn-soft' : 'btn-outline'}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            {until && (
              <p className="hint">Hết hạn ngày <b>{date(until)}</b></p>
            )}
          </Field>

          <Field
            label="Số serial / số máy"
            hint="Ghi để sau này tra ra ai mua"
            htmlFor="ln-serial"
          >
            <Input id="ln-serial" value={serial} onChange={(e) => setSerial(e.target.value)}
              placeholder="PNS-2026-0099" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/* ==================================================================== */

function CustomerQuickModal({ open, customerId, onClose }) {
  const { data, busy } = useFetch(
    () => api.get(`/customers/${customerId}/quick`), [customerId], { skip: !open || !customerId }
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={data ? data.name : 'Thông tin khách hàng'}
      subtitle={data ? [data.code, data.phone, data.address].filter(Boolean).join(' · ') : ''}
      size="lg"
      footer={<Button onClick={onClose}>Đóng</Button>}
    >
      {busy || !data ? <Spinner /> : (
        <div className="space-y-3">
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
            <div className="card p-2.5">
              <div className="text-2xs font-bold text-muted-ink uppercase">Đang nợ</div>
              <div className={`font-display font-bold text-lg tabular ${data.debt > 0 ? 'text-warn' : ''}`}>
                {money(data.debt)}
              </div>
              {data.debt_limit > 0 && (
                <div className="text-2xs text-muted-ink">Hạn mức {money(data.debt_limit)}</div>
              )}
            </div>
            <div className="card p-2.5">
              <div className="text-2xs font-bold text-muted-ink uppercase">Tổng đã mua</div>
              <div className="font-display font-bold text-lg tabular">{money(data.total_spent)}</div>
            </div>
            <div className="card p-2.5">
              <div className="text-2xs font-bold text-muted-ink uppercase">Số hoá đơn</div>
              <div className="font-display font-bold text-lg tabular">{n(data.order_count)}</div>
            </div>
            <div className="card p-2.5">
              <div className="text-2xs font-bold text-muted-ink uppercase">Mua gần nhất</div>
              <div className="font-semibold text-[13px] mt-1">
                {data.last_order ? smartTime(data.last_order) : 'Chưa mua'}
              </div>
            </div>
          </div>

          {data.over_limit && (
            <div className="card p-2.5 bg-red-50 border-danger/30 text-[13px] flex gap-2">
              <AlertTriangle size={15} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
              <span className="text-red-900">
                Khách đã <b>vượt hạn mức công nợ</b>. Bán thêm ghi nợ sẽ bị hệ thống chặn.
              </span>
            </div>
          )}

          {data.unpaid_bills.length > 0 && (
            <div>
              <h3 className="text-[13px] font-bold mb-1.5">
                Hoá đơn chưa trả đủ ({data.unpaid_bills.length})
              </h3>
              <div className="table-wrap max-h-40 overflow-y-auto">
                <table className="data">
                  <thead>
                    <tr><th>Mã HĐ</th><th>Ngày</th><th className="text-right">Tổng</th>
                      <th className="text-right">Đã trả</th><th className="text-right">Còn nợ</th></tr>
                  </thead>
                  <tbody>
                    {data.unpaid_bills.map((s) => (
                      <tr key={s.id} className="hoverable">
                        <td className="font-mono">{s.code}</td>
                        <td className="text-muted-ink">{date(s.ts)}</td>
                        <td className="num">{money(s.total)}</td>
                        <td className="num">{money(s.paid)}</td>
                        <td className="num text-danger font-semibold">{money(s.remaining)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <h3 className="text-[13px] font-bold mb-1.5">Mua gần đây</h3>
              {data.recent_sales.length === 0
                ? <Empty title="Chưa có hoá đơn" />
                : (
                  <div className="table-wrap max-h-52 overflow-y-auto">
                    <table className="data">
                      <thead>
                        <tr><th>Mã HĐ</th><th>Ngày</th><th className="text-right">Số mặt</th>
                          <th className="text-right">Tổng tiền</th></tr>
                      </thead>
                      <tbody>
                        {data.recent_sales.map((s) => (
                          <tr key={s.id} className="hoverable">
                            <td className="font-mono">{s.code}</td>
                            <td className="text-muted-ink whitespace-nowrap">{date(s.ts)}</td>
                            <td className="num">{s.item_count}</td>
                            <td className="num font-semibold">{money(s.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>

            <div>
              <h3 className="text-[13px] font-bold mb-1.5">Hàng khách hay mua</h3>
              {data.top_products.length === 0
                ? <Empty title="Chưa có dữ liệu" />
                : (
                  <div className="table-wrap max-h-52 overflow-y-auto">
                    <table className="data">
                      <thead>
                        <tr><th>Tên hàng</th><th className="text-right">Đã mua</th><th>Lần cuối</th></tr>
                      </thead>
                      <tbody>
                        {data.top_products.map((p, i) => (
                          <tr key={i} className="hoverable">
                            <td className="font-semibold">{p.name}</td>
                            <td className="num">{fq(p.qty)} {p.unit_name}</td>
                            <td className="text-muted-ink whitespace-nowrap">{date(p.last_ts)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>
          </div>

          {data.note && <div className="card p-2.5 text-[13px]"><b>Ghi chú: </b>{data.note}</div>}
        </div>
      )}
    </Modal>
  );
}

/* ==================================================================== */

function DraftsModal({ open, onClose, onOpen, openIds }) {
  const { toast } = useApp();
  const { data, busy, reload } = useFetch(() => api.get('/drafts'), [], { skip: !open });

  const remove = async (d) => {
    if (!window.confirm(`Xoá hoá đơn tạm "${d.title || d.code}"?`)) return;
    try {
      await api.del(`/drafts/${d.id}`);
      reload();
      toast('Đã xoá hoá đơn tạm', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Hoá đơn tạm"
      subtitle="Đơn đang bán dở, lưu trên máy chủ nên máy nào trong tiệm cũng mở tiếp được"
      size="lg"
      footer={<Button onClick={onClose}>Đóng</Button>}
    >
      {busy ? <Spinner />
        : !data?.length ? (
          <Empty
            icon={Save}
            title="Chưa có hoá đơn tạm nào"
            message="Đang bán dở mà khách hẹn quay lại? Bấm Lưu tạm ở màn hình bán hàng."
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Tên</th><th>Mã</th><th>Khách hàng</th>
                  <th className="text-right">Số mặt</th>
                  <th className="text-right">Tạm tính</th>
                  <th>Lưu lúc</th><th>Người lưu</th>
                  <th className="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => {
                  const isOpen = openIds.includes(d.id);
                  return (
                    <tr key={d.id} className="hoverable">
                      <td className="font-semibold">{d.title || '(chưa đặt tên)'}</td>
                      <td className="font-mono text-muted-ink">{d.code}</td>
                      <td>{d.customer_name || 'Khách lẻ'}</td>
                      <td className="num">{d.item_count}</td>
                      <td className="num font-semibold">{money(d.total)}</td>
                      <td className="text-muted-ink whitespace-nowrap">{smartTime(d.updated_at)}</td>
                      <td className="text-muted-ink">{d.user_name || '—'}</td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          {isOpen
                            ? <Badge tone="info">Đang mở</Badge>
                            : <Button size="sm" variant="soft" onClick={() => onOpen(d)}>Mở tiếp</Button>}
                          <IconButton icon={Trash2} label={`Xoá ${d.title || d.code}`} size={14}
                            className="!text-danger hover:!bg-red-50" onClick={() => remove(d)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </Modal>
  );
}

/* ==================================================================== */

function DeliveryModal({ open, onClose, value, customer, carriers, total, onSave, onClear }) {
  const [d, setD] = useState(EMPTY_DELIVERY);

  useEffect(() => {
    if (!open) return;
    setD(value || {
      ...EMPTY_DELIVERY,
      name: customer?.name || '',
      phone: customer?.phone || '',
      address: customer?.address || '',
      codAmount: total,
    });
  }, [open, value, customer, total]);

  const set = (k) => (e) => setD((p) => ({ ...p, [k]: e?.target ? e.target.value : e }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Thông tin giao hàng"
      subtitle="Ghi lại người nhận, nhà xe và mã vận đơn để tra khi khách hỏi"
      size="md"
      footer={<>
        {value && <Button variant="danger" onClick={onClear}>Bỏ giao hàng</Button>}
        <div className="flex-1" />
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={() => onSave(d)}>Lưu thông tin giao</Button>
      </>}
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Người nhận" htmlFor="dv-name">
            <Input id="dv-name" value={d.name} onChange={set('name')} placeholder="Tên người nhận hàng" />
          </Field>
          <Field label="Số điện thoại người nhận" htmlFor="dv-phone">
            <Input id="dv-phone" value={d.phone} onChange={set('phone')} inputMode="tel" />
          </Field>
        </div>

        <Field label="Địa chỉ giao" htmlFor="dv-addr">
          <Textarea id="dv-addr" rows={2} value={d.address} onChange={set('address')}
            placeholder="Số nhà, ấp/khu phố, xã/phường, huyện/tỉnh" />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Đơn vị vận chuyển" hint="Thêm nhà xe mới ở Thiết lập" htmlFor="dv-carrier">
            <Select id="dv-carrier" value={d.carrierId || ''}
              onChange={(e) => setD((p) => ({ ...p, carrierId: e.target.value ? Number(e.target.value) : null }))}>
              <option value="">— Tự giao / khách tự lấy —</option>
              {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Mã vận đơn" htmlFor="dv-track">
            <Input id="dv-track" value={d.trackingCode} onChange={set('trackingCode')}
              placeholder="Số vận đơn nhà xe cấp" />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phí giao hàng" htmlFor="dv-fee">
            <MoneyInput id="dv-fee" value={d.shipFee}
              onChange={(v) => setD((p) => ({ ...p, shipFee: v }))} />
          </Field>
          <Field label="Ai chịu phí" htmlFor="dv-payer">
            <Select id="dv-payer" value={d.shipPayer} onChange={set('shipPayer')}>
              <option value="customer">Khách trả (cộng vào hoá đơn)</option>
              <option value="shop">Cửa hàng chịu</option>
            </Select>
          </Field>
        </div>

        <Field label="Tiền thu hộ (COD)" hint="Số tiền nhà xe thu giúp khi giao hàng" htmlFor="dv-cod">
          <MoneyInput id="dv-cod" value={d.codAmount}
            onChange={(v) => setD((p) => ({ ...p, codAmount: v }))} />
        </Field>

        <Field label="Ghi chú giao hàng" htmlFor="dv-note">
          <Textarea id="dv-note" rows={2} value={d.note} onChange={set('note')}
            placeholder="Ví dụ: gọi trước khi giao, giao giờ hành chính" />
        </Field>
      </div>
    </Modal>
  );
}

/* ==================================================================== */
/* Hộp thanh toán                                                        */
/* ==================================================================== */

function PaymentModal({ open, onClose, totals, customer, note, setNote, onSubmit, accounts, delivery }) {
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
        transfer_amount: method === 'transfer' ? totals.total : method === 'mixed' ? transferAmount : 0,
      });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

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
          {totals.shipCharged > 0 && (
            <div className="text-2xs text-emerald-900/70 mt-0.5">
              đã gồm {money(totals.shipCharged)} phí giao hàng
            </div>
          )}
        </div>

        {delivery && (
          <div className="card p-2.5 text-[13px] flex gap-2">
            <Truck size={15} className="text-muted-ink shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
              <div className="font-semibold">Giao cho {delivery.name || 'khách'}</div>
              <div className="text-muted-ink truncate">{delivery.address}</div>
              {delivery.codAmount > 0 && (
                <div className="text-2xs text-muted-ink">Thu hộ COD {money(delivery.codAmount)}</div>
              )}
            </div>
          </div>
        )}

        <div>
          <span className="label">Hình thức thanh toán</span>
          <div className="grid grid-cols-4 gap-1.5">
            {METHODS.map((m) => (
              <button key={m.key} onClick={() => setMethod(m.key)}
                className={`btn btn-touch flex-col !gap-0.5 !py-2 text-2xs
                            ${method === m.key ? 'btn-secondary' : 'btn-outline'}`}>
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
                <button key={v} onClick={() => setReceived(v)}
                  className={`btn btn-sm ${received === v ? 'btn-soft' : 'btn-outline'}`}>
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
          <Field label="Khách trả trước bao nhiêu"
            hint="Để 0 nếu khách nợ toàn bộ. Phần còn lại ghi vào công nợ."
            htmlFor="pay-partial">
            <MoneyInput id="pay-partial" size="lg" value={totals.total - debtAmount}
              onChange={(v) => setDebtAmount(Math.max(0, totals.total - v))} autoFocus />
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
          <Textarea id="pay-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Ví dụ: giao hàng chiều mai, lắp đặt tại nhà..." />
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
