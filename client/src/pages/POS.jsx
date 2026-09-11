import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Plus, X, UserPlus, Printer, Percent, Package, ShoppingCart, ArrowLeft,
  FileText, Grid3x3, Truck, Save, History, Eye, EyeOff, FolderOpen, AlertTriangle,
  ClipboardList, RefreshCcw, MapPin, ShieldCheck, Trash2,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, useLocal } from '../lib/store';
import { money, n, qty as fq, match, datetime, date, smartTime } from '../lib/format';
import {
  Button, IconButton, Input, Modal, Field, Empty, Spinner, Badge, Combo, Textarea, QtyInput, Confirm,
} from '../components/ui';
import InvoicePrint from '../components/InvoicePrint';
import DeliveryNotePrint from '../components/DeliveryNotePrint';
import WarrantyCardPrint, { warrantyItemsOf } from '../components/WarrantyCardPrint';
import { DeliveryBell, DeliveryBoard } from '../components/PosDelivery';
import DeliveryInfoModal, {
  normalizeDelivery, deliveryShipCharged, deliveryBody,
} from '../components/PosDeliveryForm';
import QuickReturnModal from '../components/PosQuickReturn';
import ExchangeModal from '../components/PosExchange';
import CashVoucherPrint from '../components/CashVoucherPrint';
import CustomerForm from '../components/CustomerForm';
import CustomerProfile from '../components/CustomerProfile';
import { OrderBell, SaveAsOrderModal, PickOrderModal } from '../components/PosOrders';
import { DebtButton, DebtCollectModal, CustomerDebtBanner } from '../components/PosDebt';
import PaymentModal from '../components/PosPayment';
import ProxyBuyer from '../components/PosBuyer';
import { CartLine, OrderNote, MoneyCell, PercentCell, lineAmount } from '../components/PosCart';
import { CategoryFilter, categoryFilterSet, LazyGrid } from '../components/PosCatalog';
import {
  usePosPolicy, PinApprovalModal, cartDiscountPercent, canSelfApprove,
} from '../components/PosApproval';
import { tabTitle, tabNoOf, smallestFree, normalizeTabs } from '../lib/posTabs';

/* Người có quyền xem giá vốn mới thấy giá vốn và giá nhập gần nhất khi bán.
   Máy chủ cũng gỡ hẳn các cột này khỏi dữ liệu trả cho người không có quyền. */
const canSeeCost = (user, can) => !!can?.('cost.view') || user?.role === 'owner' || user?.role === 'manager';

const newTab = (no, priceListId) => ({
  id: 'tab' + Date.now() + Math.random().toString(36).slice(2, 6),
  tabNo: no,
  title: tabTitle(no),
  draftId: null,
  cart: [],
  customerId: null,
  buyer: null,             // người mua hộ (tài liệu 03)
  priceListId,
  discountType: 'amount',
  discountValue: 0,
  note: '',
  isVat: false,
  delivery: null,
  approval: null,          // phiếu duyệt giảm giá của quản lý — không bao giờ giữ mã PIN
});

/**
 * Một ô hàng hoá trên lưới chọn.
 * inCart là tổng số lượng món này đang nằm trong giỏ (cộng cả các dòng có
 * đơn vị khác nhau). Có số thì ô đổi màu và hiện icon giỏ — nhìn lướt là
 * biết đã thêm chưa, khỏi bấm trùng lúc đông khách.
 */
function ProductTile({ p, priceListId, showCost, onPick, inCart = 0, bought = null }) {
  const baseUnit = p.units.find((u) => u.factor === 1) || p.units[0];
  const price = baseUnit?.prices?.[priceListId] ?? 0;
  const out = p.track_stock && p.stock <= 0;
  const low = p.track_stock && p.min_stock > 0 && p.stock > 0 && p.stock <= p.min_stock;
  const added = inCart > 0;

  return (
    <button
      onClick={() => onPick(p)}
      disabled={out}
      aria-label={added
        ? `${p.name} — đang có ${fq(inCart)} trong giỏ, bấm để thêm nữa`
        : `Thêm ${p.name} vào giỏ`}
      className={`card p-2 text-left transition-colors duration-150 cursor-pointer relative
                 hover:border-accent hover:bg-accent-soft/40 disabled:opacity-45
                 disabled:cursor-not-allowed disabled:hover:border-line disabled:hover:bg-card
                 flex flex-col gap-1 min-h-[92px]
                 ${added ? 'border-accent bg-accent-soft/30' : ''}`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-2xs font-mono text-muted-ink">{p.sku}</span>
        {out ? <Badge tone="bad">Hết</Badge> : low ? <Badge tone="warn">Sắp hết</Badge> : null}
      </div>

      {/* Món khách này từng mua: hiện luôn giá lần trước, vì câu hỏi ngay
          sau đó bao giờ cũng là "lần trước tôi mua bao nhiêu?" */}
      {bought && (
        <div className="text-2xs font-semibold text-violet-700 flex items-center gap-0.5 leading-tight">
          <History size={10} aria-hidden="true" />
          Lần trước {n(bought.price)}
        </div>
      )}

      {added && (
        <span
          className="absolute -top-1.5 -right-1.5 flex items-center gap-0.5 rounded-full
                     bg-accent text-white text-2xs font-bold px-1.5 py-0.5 shadow-sm"
          aria-hidden="true"
        >
          <ShoppingCart size={11} />
          {fq(inCart)}
        </span>
      )}
      <div className="text-[13px] font-semibold leading-snug line-clamp-2 flex-1">{p.name}</div>
      {p.alias && (
        <div className="text-2xs text-muted-ink italic truncate leading-tight">{p.alias}</div>
      )}
      {/* Bảo hành mặc định của mặt hàng (tài liệu 09, mục 4) */}
      {p.warranty_months > 0 && (
        <div className="text-2xs font-semibold text-emerald-800 flex items-center gap-0.5 leading-tight">
          <ShieldCheck size={10} aria-hidden="true" />
          BH: {p.warranty_months} Tháng
        </div>
      )}
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[13px] font-bold text-accent tabular font-mono">{n(price)}</span>
        <span className="text-2xs text-muted-ink tabular">
          {p.track_stock ? `${fq(p.stock)} ${p.base_unit}` : 'Dịch vụ'}
        </span>
      </div>
      {showCost && (
        <div className="text-2xs text-muted-ink tabular border-t border-line pt-0.5 leading-snug">
          Vốn {n(p.cost_price)}
          {price > 0 && p.cost_price > 0 && (
            <span className="ml-1 text-emerald-700 font-semibold">
              +{Math.round((price - p.cost_price) / p.cost_price * 100)}%
            </span>
          )}
          {p.last_purchase_price > 0 && <div>Nhập gần nhất {n(p.last_purchase_price)}</div>}
        </div>
      )}
    </button>
  );
}

export default function POS() {
  const {
    meta, defaultWarehouse, defaultPriceList, user, store, settings, toast, access, can,
  } = useApp();
  const policy = usePosPolicy();
  const selfApprove = canSelfApprove(user, access);

  const [warehouseId, setWarehouseId] = useState(null);
  const [tabs, setTabs] = useLocal('thpos.tabs', []);
  const [activeId, setActiveId] = useLocal('thpos.activeTab', null);
  const [search, setSearch] = useState('');
  const [browseCat, setBrowseCat] = useState(null);         // nhóm đang đứng trên đường dẫn
  const [pickedCats, setPickedCats] = useState([]);         // các nhóm đang tích chọn để lọc
  const [payOpen, setPayOpen] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);        // bảng theo dõi giao hàng
  const [quickReturn, setQuickReturn] = useState(false);    // trả hàng không hoá đơn
  const [voucher, setVoucher] = useState(null);             // phiếu thu vừa lập, để in
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);        // giỏ hàng -> đơn đặt
  const [pickOrderOpen, setPickOrderOpen] = useState(false); // mở đơn đặt để giao
  const [exchangeOpen, setExchangeOpen] = useState(false);  // đổi trả hàng
  const [debtOpen, setDebtOpen] = useState(false);          // thu nợ khách đang chọn
  const [quickOpen, setQuickOpen] = useState(false);
  const [priceHistOf, setPriceHistOf] = useState(null);
  const [noteOf, setNoteOf] = useState(null);
  const [printQueue, setPrintQueue] = useState([]);         // hoá đơn / phiếu giao chờ in lần lượt
  const [provisional, setProvisional] = useState(null);
  const [closing, setClosing] = useState(null);             // tab còn hàng, hỏi lại trước khi đóng
  const [pinAsk, setPinAsk] = useState(null);               // đang hỏi PIN quản lý cho mức giảm giá
  const [showCost, setShowCost] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const searchRef = useRef(null);
  const gridRef = useRef(null);

  const maySeeCost = canSeeCost(user, can);

  /* Lấy tờ phiếu thu vừa lập rồi mở hộp in. Không in được cũng không
     sao — tiền đã thu và đã ghi sổ rồi, chỉ là thiếu tờ giấy. */
  const showVoucher = async (id) => {
    if (!id) return;
    try {
      setVoucher(await api.get(`/cash/transactions/${id}`));
    } catch {
      toast('Đã thu tiền xong, nhưng chưa lấy được phiếu để in. Vào Sổ quỹ in lại được.', 'warn', 7000);
    }
  };

  useEffect(() => { if (defaultWarehouse && !warehouseId) setWarehouseId(defaultWarehouse); }, [defaultWarehouse, warehouseId]);

  /* Số "Đơn Hàng X" đang nằm trong danh sách lưu tạm (tài liệu 01) — tab mới
     không được lấy trùng những số này */
  const {
    data: drafts, error: draftsError, reload: reloadDrafts, setData: setDrafts,
  } = useFetch(() => api.drafts(), []);
  const draftList = Array.isArray(drafts) ? drafts : [];
  const draftNos = useMemo(
    () => (Array.isArray(drafts) ? drafts : []).map((d) => Number(d.tab_no) || 0).filter(Boolean),
    [drafts]);
  const draftsReady = drafts !== null || !!draftsError;

  /* Luôn có ít nhất một tab. Tab lưu trên máy từ trước (tên "Hoá đơn N")
     thì đổi sang "Đơn Hàng N" và soát trùng số. */
  useEffect(() => {
    if (!defaultPriceList || !draftsReady) return;
    if (!tabs.length) {
      const t = newTab(smallestFree(draftNos), defaultPriceList);
      setTabs([t]);
      setActiveId(t.id);
      return;
    }
    const fixed = normalizeTabs(tabs);
    if (fixed !== tabs) { setTabs(fixed); return; }
    if (!tabs.some((t) => t.id === activeId)) setActiveId(tabs[0].id);
  }, [tabs, activeId, defaultPriceList, draftsReady, draftNos, setTabs, setActiveId]);

  const tab = tabs.find((t) => t.id === activeId) || tabs[0] || null;

  /** Sửa tab đang mở. */
  const patchTab = useCallback((patch) => {
    setTabs((prev) => prev.map((t) => (t.id === activeId
      ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) }
      : t)));
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

  /* Chọn khách chủ trùng đúng người đang ghi là người mua hộ thì bỏ ô mua
     hộ: tự mua cho mình thì không phải mua hộ */
  useEffect(() => {
    if (tab?.buyer?.id && tab.buyer.id === tab.customerId) patchTab({ buyer: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.customerId]);

  const customer = customers?.find((c) => c.id === tab?.customerId) || null;

  /* Bao nhiêu món trong danh sách đang xem là món khách này từng mua */
  const boughtCount = useMemo(() => {
    if (!priceHist || !products) return 0;
    return products.reduce((a, p) => a + (priceHist[p.id] ? 1 : 0), 0);
  }, [priceHist, products]);

  /* Mỗi mặt hàng đang có bao nhiêu trong giỏ. Cộng gộp các dòng khác đơn vị
     và quy về đơn vị cơ bản, để số trên ô khớp với con số tồn kho bên dưới. */
  const inCartQty = useMemo(() => {
    const m = new Map();
    for (const l of tab?.cart || []) {
      m.set(l.product_id, (m.get(l.product_id) || 0) + l.qty * (l.factor || 1));
    }
    return m;
  }, [tab?.cart]);

  /* ------------------------------ Giỏ hàng ------------------------------ */

  const addToCart = useCallback((product, unitId) => {
    const unit = unitId
      ? product.units.find((u) => u.id === unitId)
      : (product.units.find((u) => u.factor === 1) || product.units[0]);
    if (!unit) return;

    patchTab((t) => {
      const key = `${product.id}:${unit.id}`;
      if (t.cart.some((l) => l.key === key)) {
        return { cart: t.cart.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l)) };
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
          /* Bảo hành mặc định lấy từ mặt hàng; sửa hay huỷ chỉ áp cho hoá đơn này */
          warrantyMonths: Number(product.warranty_months) || 0,
          warrantyNote: product.warranty_note || '',
          warrantyDefault: Number(product.warranty_months) || 0,
          serial: '',
          vat_rate: product.vat_rate,
          track_stock: product.track_stock,
          stock: product.stock,
          cost_price: product.cost_price,
          last_purchase_price: product.last_purchase_price,
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
    patchTab((t) => ({ cart: t.cart.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

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
            .map((l) => (l.key === newKey ? { ...l, qty: l.qty + line.qty } : l))
            .filter((l) => l.key !== line.key),
        };
      }
      return {
        cart: t.cart.map((l) => (l.key === line.key
          ? {
              ...l, key: newKey, unit_id: u.id, unit_name: u.unit_name, factor: u.factor,
              price: l.priceEdited ? l.price : (u.prices?.[t.priceListId] ?? l.price),
            }
          : l)),
      };
    });
  };

  /* ------------------ Giảm giá vượt hạn mức: hỏi PIN quản lý ------------------ */

  /**
   * Áp một thay đổi giá / giảm giá (tài liệu 06). Thu ngân giảm vượt hạn mức
   * — so với bảng giá, gộp cả giảm dòng và giảm cả đơn — thì CHƯA áp, mở hộp
   * PIN; quản lý duyệt xong mới áp. Phiếu duyệt giữ trên tab để gửi kèm hoá
   * đơn, không bao giờ giữ mã PIN. Máy chủ soát lại lần nữa khi lưu.
   */
  const guardDiscount = (next, apply) => {
    if (selfApprove) { apply(); return; }
    const pct = cartDiscountPercent(next.cart || tab.cart, tab.priceListId, {
      discountType: next.discountType ?? tab.discountType,
      discountValue: next.discountValue ?? tab.discountValue,
    });
    const limit = policy.cashierMaxDiscountPercent;
    const covered = tab.approval && tab.approval.expires > Date.now() && pct <= tab.approval.percent + 0.001;
    if (pct <= limit + 0.001 || covered) { apply(); return; }
    setPinAsk({
      reason: `giảm giá ${pct}%`,
      detail: (
        <>
          Đơn này sẽ giảm <b>{pct}%</b> so với bảng giá, vượt hạn mức <b>{limit}%</b> thu ngân được
          tự giảm. Quản lý nhập mã PIN thì giá mới mới được áp.
        </>
      ),
      onOk: (res) => {
        apply();
        patchTab({
          approval: {
            token: res.token,
            approver: res.approver?.full_name || '',
            percent: pct,
            expires: Date.now() + (Number(res.expires_in) || 1800) * 1000 - 60 * 1000,
          },
        });
      },
    });
  };

  const commitLine = (key, patch) => {
    const cart = tab.cart.map((l) => (l.key === key ? { ...l, ...patch } : l));
    guardDiscount({ cart }, () => updateLine(key, patch));
  };

  const commitOrder = (patch) => guardDiscount(patch, () => patchTab(patch));

  /** Cơ chế A: sửa Thành tiền thấp hơn thì tự tính ngược ra tiền giảm. */
  const setLineAmount = (l, value) => {
    const gross = Math.round(l.qty * l.price);
    const v = Math.max(0, Math.round(Number(value) || 0));
    if (v > gross) {
      toast('Thành tiền không cao hơn số lượng × đơn giá được. Muốn bán giá cao hơn thì sửa ô đơn giá.', 'warn', 6000);
    }
    commitLine(l.key, { discountType: 'amount', discountValue: v >= gross ? 0 : gross - v });
  };

  const clearTab = () => patchTab({
    cart: [], discountType: 'amount', discountValue: 0,
    note: '', customerId: null, buyer: null, isVat: false, delivery: null, approval: null,
  });

  /* ------------------------------- Tính tiền ------------------------------ */

  const totals = useMemo(() => {
    if (!tab) {
      return { subtotal: 0, vat: 0, total: 0, count: 0, discount: 0, cogs: 0, lineDiscount: 0, shipCharged: 0 };
    }
    let subtotal = 0;
    let vat = 0;
    let cogs = 0;
    let lineDiscount = 0;
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
    const shipCharged = deliveryShipCharged(tab.delivery);
    return {
      subtotal, vat, discount, lineDiscount, cogs, shipCharged,
      total: Math.max(0, subtotal - discount + vat + shipCharged),
      count: tab.cart.length,
    };
  }, [tab]);

  /* Mức giảm hiện tại so với bảng giá — để nhắc thu ngân trước khi tới bước
     thanh toán (đổi số lượng cũng làm % giảm thay đổi) */
  const cartPct = useMemo(
    () => (tab ? cartDiscountPercent(tab.cart, tab.priceListId, tab) : 0), [tab]);

  /* ---------------------------- Lọc danh sách hàng ---------------------- */

  const catSet = useMemo(
    () => categoryFilterSet(meta.categories, pickedCats, browseCat),
    [meta.categories, pickedCats, browseCat]);

  const filtered = useMemo(() => {
    if (!products) return [];
    let list = products;
    /* Chọn nhóm cha thì lấy cả hàng của nhóm con cháu; chọn nhiều nhóm thì
       lấy hàng thuộc một trong các nhóm (xem PosCatalog.jsx) */
    if (catSet) list = list.filter((p) => catSet.has(p.category_id));
    if (search.trim()) {
      list = list.filter((p) =>
        match(p.name, search) || match(p.alias || '', search) || match(p.sku, search) ||
        (p.barcode || '').includes(search.trim()) || match(p.brand || '', search));
    }

    /* Chọn khách rồi thì ĐƯA HÀNG KHÁCH TỪNG MUA LÊN ĐẦU. Chỉ đổi THỨ TỰ,
       không lọc bớt: món chưa mua bao giờ vẫn còn nguyên ở dưới. */
    if (priceHist && Object.keys(priceHist).length) {
      const seen = (p) => (priceHist[p.id] ? 1 : 0);
      list = [...list].sort((a, b) => seen(b) - seen(a));
    }
    return list;
  }, [products, catSet, search, priceHist]);

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

  const limitMsg = `Đã đạt giới hạn số lượng tab tối đa (${policy.maxTabs} tab). Vui lòng xử lý hoặc lưu tạm các tab cũ trước khi mở tab mới!`;

  /** Mở tab "Đơn Hàng X" — X nhỏ nhất chưa dùng ở tab đang mở lẫn đơn lưu tạm. */
  const addTab = () => {
    if (tabs.length >= policy.maxTabs) { toast(limitMsg, 'warn', 7000); return; }
    const t = newTab(smallestFree([...tabs.map(tabNoOf), ...draftNos]), defaultPriceList);
    setTabs((prev) => [...prev, t]);
    setActiveId(t.id);
    setSearch('');
  };

  /**
   * Bỏ một tab khỏi màn hình. Hết sạch tab thì mở ngay tab mới mang số nhỏ
   * nhất còn trống.
   * @param reserved  số vừa đưa vào lưu tạm mà danh sách chưa kịp tải lại
   */
  const dropTab = (id, reserved = []) => {
    const next = tabs.filter((x) => x.id !== id);
    if (!next.length) {
      const t = newTab(smallestFree([...draftNos, ...reserved]), defaultPriceList);
      setTabs([t]);
      setActiveId(t.id);
      return;
    }
    setTabs(next);
    if (id === activeId) setActiveId(next[0].id);
  };

  const closeTab = (id) => {
    const t = tabs.find((x) => x.id === id);
    if (t?.cart.length) { setClosing(t); return; }
    dropTab(id);
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
  }, [tab, payOpen, custOpen, tabs, policy.maxTabs, draftNos]);

  /* ------------------------------ Lưu tạm -------------------------------- */

  /**
   * Lưu tạm rồi ĐÓNG tab ngay (tài liệu 01) cho gọn màn hình. Đơn mang theo
   * số "Đơn Hàng X" của nó; tab mới mở sau đó không lấy trùng số này.
   */
  const saveDraft = async () => {
    if (!tab?.cart.length) { toast('Giỏ hàng đang trống, chưa có gì để lưu.', 'warn'); return; }
    const no = tabNoOf(tab);
    try {
      const res = await api.post('/drafts', {
        id: tab.draftId || undefined,
        title: tab.title,
        tab_no: no,
        customer_id: tab.customerId,
        user_id: user?.id,
        warehouse_id: warehouseId,
        price_list_id: tab.priceListId,
        total: totals.total,
        item_count: tab.cart.length,
        payload: {
          cart: tab.cart, discountType: tab.discountType, discountValue: tab.discountValue,
          note: tab.note, isVat: tab.isVat, delivery: tab.delivery, buyer: tab.buyer,
        },
      });
      /* Giữ ngay số của đơn vừa lưu, đừng đợi tải lại danh sách: tab mới mở
         liền sau đây mà chưa biết số này thì lấy trùng */
      setDrafts((prev) => [
        ...(Array.isArray(prev) ? prev : []).filter((d) => d.id !== res.id),
        { ...res, tab_no: no },
      ]);
      dropTab(tab.id, [no]);
      reloadDrafts();
      toast(`Đã lưu tạm "${tab.title}" — mọi máy trong tiệm đều mở tiếp được.`, 'ok', 5000);
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  /**
   * Mở lại một đơn lưu tạm (tài liệu 01, mục 4):
   *   1. đủ số tab tối đa thì từ chối;
   *   2. số của đơn đang bị một tab khác chiếm thì đổi tab đó sang số nhỏ
   *      nhất còn trống, đơn mở ra giữ nguyên số cũ;
   *   3. đơn rời khỏi danh sách lưu tạm, tiêu điểm chuyển sang tab vừa mở.
   */
  const openDraft = async (d) => {
    if (tabs.length >= policy.maxTabs) { toast(limitMsg, 'warn', 7000); return; }
    let full;
    try {
      full = await api.draft(d.id);
    } catch (e) {
      toast('Không mở được đơn lưu tạm: ' + e.message, 'bad', 6000);
      return;
    }
    const p = full.payload || {};
    if (!p.cart?.length) {
      toast('Đơn lưu tạm này không còn dòng hàng nào.', 'bad', 6000);
      return;
    }

    /* Xoá khỏi danh sách TRƯỚC khi mở: xoá hỏng mà vẫn mở thì hai máy có thể
       cùng bán một đơn */
    try {
      await api.del(`/drafts/${full.id}`);
    } catch (e) {
      toast('Chưa mở được đơn lưu tạm: ' + e.message, 'bad', 6000);
      return;
    }

    const otherDraftNos = draftList
      .filter((x) => x.id !== full.id)
      .map((x) => Number(x.tab_no) || 0)
      .filter(Boolean);
    const want = Number(full.tab_no) > 0
      ? Number(full.tab_no)
      : smallestFree([...tabs.map(tabNoOf), ...otherDraftNos]);

    let next = tabs;
    const clash = tabs.find((t) => tabNoOf(t) === want);
    if (clash) {
      const moved = smallestFree([...tabs.map(tabNoOf), ...otherDraftNos, want]);
      next = tabs.map((t) => (t.id === clash.id ? { ...t, tabNo: moved, title: tabTitle(moved) } : t));
      toast(`Tab "${tabTitle(want)}" trên màn hình đổi thành "${tabTitle(moved)}" để nhường số cho đơn lưu tạm.`,
        'info', 6000);
    }

    const t = {
      ...newTab(want, full.price_list_id || defaultPriceList),
      cart: p.cart,
      customerId: full.customer_id,
      buyer: p.buyer || null,
      discountType: p.discountType || 'amount',
      discountValue: p.discountValue || 0,
      note: p.note || '',
      isVat: !!p.isVat,
      delivery: p.delivery || null,
    };
    setTabs([...next, t]);
    setActiveId(t.id);
    setDrafts((prev) => (Array.isArray(prev) ? prev : []).filter((x) => x.id !== full.id));
    setDraftsOpen(false);
    toast(`Đã mở lại "${t.title}"`, 'ok');
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
      warranty_note: Number(l.warrantyMonths) > 0 ? (l.warrantyNote || null) : null,
      serial: l.serial || null,
    })),
    customer_id: tab.customerId,
    buyer_id: tab.buyer?.id || null,
    buyer_name: tab.buyer?.name || null,
    buyer_phone: tab.buyer?.phone || null,
    warehouse_id: warehouseId,
    user_id: user?.id,
    price_list_id: tab.priceListId,
    discount_type: tab.discountType,
    discount: tab.discountType === 'amount' ? tab.discountValue : 0,
    discount_percent: tab.discountType === 'percent' ? tab.discountValue : 0,
    is_vat_invoice: tab.isVat ? 1 : 0,
    note: String(tab.note || '').slice(0, 255),
    ...(tab.approval?.token ? { approval_token: tab.approval.token } : {}),
    ...(tab.delivery ? deliveryBody(tab.delivery) : {}),
    ...extra,
  });

  const submit = async (payload) => {
    const { collect_debt: collectDebt = 0, _print: printPref = null, ...rest } = payload;
    /* Lỗi ở bước này (thiếu hàng, cần PIN...) thì ném ra cho hộp thanh toán
       báo. Qua được bước này là hoá đơn ĐÃ LƯU — mọi việc sau đó hỏng cũng
       không được ném lỗi, kẻo thu ngân tưởng chưa lưu mà bấm lại lần nữa. */
    const res = await api.post('/sales', buildBody(rest));

    /* Nợ cũ thu thành phiếu thu riêng, chạy SAU khi hoá đơn đã lưu chắc */
    if (collectDebt > 0 && tab.customerId) {
      try {
        await api.post(`/customers/${tab.customerId}/pay`, {
          amount: collectDebt,
          user_id: user?.id || null,
          account_id: payload.cash_account_id || null,
          note: `Trả nợ cũ khi mua hàng ${res.code}`,
        });
        toast(`Đã thu thêm ${money(collectDebt)} tiền nợ cũ`, 'ok', 6000);
      } catch (e) {
        toast(`Hoá đơn ${res.code} đã lưu, nhưng chưa thu được nợ cũ: ${e.message}. `
          + 'Dùng nút Thu nợ để thu lại.', 'bad', 12000);
      }
    }

    /* In theo lựa chọn: hoá đơn đầy đủ, phiếu giao cho shipper, hoặc cả hai.
       In LẦN LƯỢT từng tờ — hai vùng in cùng lúc sẽ in chồng lên nhau. */
    const queue = [];
    try {
      if (!printPref || printPref.invoice) {
        queue.push({ kind: 'invoice', key: `i${res.id}`, sale: await api.sale(res.id) });
      }
      if (printPref?.note) {
        queue.push({ kind: 'note', key: `n${res.id}`, note: await api.get(`/deliveries/${res.id}`) });
      }
    } catch {
      toast(`Hoá đơn ${res.code} đã lưu nhưng chưa tải được để in — vào Hoá đơn hoặc Theo dõi giao để in lại.`,
        'warn', 8000);
    }
    /* Món có bảo hành: in phiếu bảo hành sau hoá đơn, chọn gộp hay tách (tài liệu 09, mục 5) */
    if (tab.cart.some((l) => Number(l.warrantyMonths) > 0)) {
      try {
        const sale = queue.find((x) => x.kind === 'invoice')?.sale || await api.sale(res.id);
        if (warrantyItemsOf(sale).length) queue.push({ kind: 'warranty', key: `w${res.id}`, sale });
      } catch { /* in lại được từ màn hình Hoá đơn */ }
    }
    setPrintQueue(queue);

    if (tab.draftId) { try { await api.del(`/drafts/${tab.draftId}`); } catch { /* đã xoá */ } }
    dropTab(tab.id);
    setPayOpen(false);
    reload();
    reloadCustomers();          // để dòng cảnh báo nợ cập nhật ngay
    toast(res.cod_amount > 0
      ? `Đã lưu hoá đơn ${res.code} — thu hộ ${money(res.cod_amount)} chờ đối soát`
      : `Đã lưu hoá đơn ${res.code}`, 'ok', 5000);
    return res;
  };

  /* Hoá đơn tạm tính: dựng đối tượng giống hoá đơn thật để dùng chung mẫu in */
  const buildProvisional = () => ({
    code: 'TẠM TÍNH',
    ts: new Date().toISOString().slice(0, 19).replace('T', ' '),
    customer_name: customer?.name || 'Khách lẻ',
    customer_phone: customer?.phone,
    customer_address: customer?.address,
    buyer_name: tab.buyer?.name,
    buyer_phone: tab.buyer?.phone,
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
  const printing = printQueue[0] || null;
  const nextPrint = () => setPrintQueue((q) => q.slice(1));
  const approvalLive = tab.approval && tab.approval.expires > Date.now() ? tab.approval : null;
  const discountOver = !selfApprove && tab.cart.length > 0
    && cartPct > policy.cashierMaxDiscountPercent + 0.001
    && !(approvalLive && cartPct <= approvalLive.percent + 0.001);
  const barBtn = `px-2.5 h-9 text-slate-300 hover:text-white hover:bg-white/10 rounded-t
                  transition-colors duration-150 cursor-pointer shrink-0 flex items-center gap-1.5 text-[13px]`;

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
        <DeliveryBell onOpen={() => setBoardOpen(true)} />
        <DebtButton customer={customer} onOpen={() => setDebtOpen(true)} />

        {maySeeCost && (
          <button
            onClick={() => setShowCost((v) => !v)}
            className={`h-9 px-2.5 rounded border text-[13px] font-semibold hidden md:flex items-center gap-1.5
                        transition-colors duration-150 cursor-pointer
                        ${showCost
                          ? 'bg-amber-500/20 border-amber-400/40 text-amber-200'
                          : 'bg-white/10 border-white/15 text-slate-300 hover:text-white'}`}
            title="Hiện giá vốn và giá nhập gần nhất — chỉ người có quyền xem giá vốn thấy nút này"
            aria-pressed={showCost}
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

      {/* ---------------------------- Thanh tab đơn hàng --------------------- */}
      <div className="bg-slate-800 flex items-stretch gap-0.5 px-2 shrink-0 overflow-x-auto no-print"
        role="tablist" aria-label="Các đơn hàng đang mở">
        {tabs.map((t) => {
          const active = t.id === activeId;
          const count = t.cart.length;
          const closable = tabs.length > 1 || count > 0;
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
                {t.delivery && (
                  <Truck size={12} className={`shrink-0 ${active ? 'text-amber-600' : 'text-amber-300'}`}
                    aria-label="Đơn giao hàng" />
                )}
                {t.title}
                {count > 0 && (
                  <span className={`text-2xs px-1 rounded tabular ${active ? 'bg-accent-soft text-emerald-900' : 'bg-white/20'}`}>
                    {count}
                  </span>
                )}
              </button>
              {closable && (
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
          className={`px-2.5 h-9 hover:text-white hover:bg-white/10 rounded-t transition-colors duration-150
                      cursor-pointer shrink-0 flex items-center gap-1
                      ${tabs.length >= policy.maxTabs ? 'text-slate-500' : 'text-slate-300'}`}
          aria-label={`Mở thêm đơn hàng mới (F7) — đang mở ${tabs.length}/${policy.maxTabs} tab`}
          title={`Mở thêm đơn hàng mới (F7) — đang mở ${tabs.length}/${policy.maxTabs} tab`}
        >
          <Plus size={15} aria-hidden="true" />
          {tabs.length >= policy.maxTabs - 2 && (
            <span className="text-2xs tabular">{tabs.length}/{policy.maxTabs}</span>
          )}
          <span className="kbd !bg-white/15 !text-slate-300 !border-white/20 hidden sm:inline">F7</span>
        </button>
        <div className="flex-1" />
        <button onClick={() => setExchangeOpen(true)} className={barBtn} aria-label="Đổi trả hàng"
          title="Khách đổi hoặc trả hàng — có hoá đơn thì quét hoá đơn, không có thì chọn Trả hàng nhanh">
          <RefreshCcw size={14} aria-hidden="true" />
          <span className="hidden sm:inline">Đổi trả hàng</span>
        </button>
        <button onClick={() => setBoardOpen(true)} className={barBtn} aria-label="Theo dõi giao hàng"
          title="Theo dõi đơn giao và đối soát tiền thu hộ">
          <MapPin size={14} aria-hidden="true" />
          <span className="hidden sm:inline">Theo dõi giao</span>
        </button>
        <button onClick={() => setPickOrderOpen(true)} className={barBtn} aria-label="Giao đơn đặt hàng">
          <Truck size={14} aria-hidden="true" />
          <span className="hidden sm:inline">Giao đơn đặt</span>
        </button>
        <button onClick={() => setDraftsOpen(true)} className={barBtn} aria-label={`Đơn lưu tạm — ${draftList.length} đơn`}>
          <FolderOpen size={14} aria-hidden="true" />
          <span className="hidden sm:inline">Đơn lưu tạm</span>
          {draftList.length > 0 && <span className="text-2xs px-1 rounded bg-white/20 tabular">{draftList.length}</span>}
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* ------------------------- Lưới chọn hàng ------------------------ */}
        <section className={`flex-1 min-w-0 flex flex-col ${showGrid ? '' : 'hidden lg:flex'}`}>
          <CategoryFilter
            categories={meta.categories}
            browseId={browseCat}
            onBrowse={setBrowseCat}
            selected={pickedCats}
            onToggle={(id) => setPickedCats((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
            onClear={() => { setPickedCats([]); setBrowseCat(null); }}
            shown={filtered.length}
            total={products?.length || 0}
          />

          <div ref={gridRef} className="flex-1 overflow-y-auto p-3">
            {busy ? <Spinner label="Đang tải hàng hoá..." />
              : filtered.length === 0 ? (
                <Empty
                  icon={Package}
                  title="Không có hàng nào khớp"
                  message={search
                    ? `Không tìm thấy "${search}". Thử gõ tên khác, tên phụ, hoặc bỏ bớt bộ lọc nhóm hàng.`
                    : 'Nhóm hàng đang chọn chưa có sản phẩm.'}
                  action={search
                    ? <Button onClick={() => setSearch('')}>Xoá từ khoá</Button>
                    : catSet ? <Button onClick={() => { setPickedCats([]); setBrowseCat(null); }}>Bỏ lọc nhóm</Button> : null}
                />
              ) : (
                <>
                  {/* Đổi thứ tự mà không nói gì thì thu ngân tưởng phần mềm
                      loạn — nên nói thẳng ra một dòng. */}
                  {customer && boughtCount > 0 && !search && (
                    <div className="mb-2 flex items-center gap-1.5 text-xs text-violet-700
                                    bg-violet-50 border border-violet-200 rounded px-2 py-1.5">
                      <History size={13} aria-hidden="true" />
                      <span>
                        <b>{n(boughtCount)} món {customer.name} từng mua</b> được đưa lên đầu.
                      </span>
                    </div>
                  )}
                  <LazyGrid
                    items={filtered}
                    rootRef={gridRef}
                    resetKey={`${tab.id}|${search}|${pickedCats.join(',')}|${browseCat || ''}|${tab.customerId || ''}`}
                    className="grid gap-2 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
                    renderItem={(p) => (
                      <ProductTile key={p.id} p={p} priceListId={tab.priceListId}
                        showCost={maySeeCost && showCost} onPick={addToCart}
                        inCart={inCartQty.get(p.id) || 0}
                        bought={priceHist?.[p.id]?.[0] || null} />
                    )}
                  />
                </>
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
                {priceListName && <Badge tone="info">{priceListName}</Badge>}
              </div>
            )}
            <ProxyBuyer
              customer={customer}
              customers={customers || []}
              value={tab.buyer}
              onChange={(b) => patchTab({ buyer: b })}
              onCreated={reloadCustomers}
            />
            {/* Nhắc đòi nợ ngay lúc còn gặp mặt khách, không đợi tới lúc thanh toán */}
            <CustomerDebtBanner customer={customer} onCollect={() => setDebtOpen(true)} />
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
                {tab.cart.map((l) => (
                  <CartLine
                    key={l.key}
                    l={l}
                    hist={priceHist[l.product_id]}
                    showCost={maySeeCost && showCost}
                    onQty={(q) => updateLine(l.key, { qty: q })}
                    onUnit={(unitId) => changeUnit(l, unitId)}
                    onPrice={(v) => commitLine(l.key, { price: v, priceEdited: true })}
                    onAmount={(v) => setLineAmount(l, v)}
                    onDiscount={(type, value) => commitLine(l.key, { discountType: type, discountValue: value })}
                    onRemove={() => removeLine(l.key)}
                    onHistory={() => setPriceHistOf(l)}
                    onNote={() => setNoteOf(l)}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Tổng tiền + nút */}
          <div className="border-t border-line p-2.5 shrink-0 bg-card">
            <OrderNote value={tab.note} onChange={(v) => patchTab({ note: v })} />

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

              {/* Giảm giá toàn đơn: % hoặc số tiền — ghi nhận khi rời ô */}
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
                    <PercentCell value={tab.discountValue} className="!w-20"
                      label="Phần trăm giảm cả đơn"
                      onCommit={(v) => commitOrder({ discountValue: v })} />
                  ) : (
                    <MoneyCell value={tab.discountValue} className="!w-28"
                      label="Số tiền giảm cả đơn"
                      onCommit={(v) => commitOrder({ discountValue: v })} />
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
                    <Truck size={12} aria-hidden="true" /> Phí vận chuyển
                  </span>
                  <span className="tabular font-mono">{money(totals.shipCharged)}</span>
                </div>
              )}

              {approvalLive && (
                <div className="flex items-center gap-1.5 text-2xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-1">
                  <ShieldCheck size={12} className="shrink-0" aria-hidden="true" />
                  <span>{approvalLive.approver || 'Quản lý'} đã duyệt giảm tới {approvalLive.percent}%</span>
                </div>
              )}
              {discountOver && (
                <div className="flex items-start gap-1.5 text-2xs text-amber-900 bg-amber-50 border border-warn/30 rounded px-1.5 py-1" role="status">
                  <AlertTriangle size={12} className="shrink-0 mt-px" aria-hidden="true" />
                  <span>
                    Đơn đang giảm {cartPct}% so với bảng giá, vượt hạn mức {policy.cashierMaxDiscountPercent}% —
                    lúc thanh toán cần quản lý nhập PIN.
                  </span>
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
                className={`btn btn-sm flex-col !gap-0.5 !py-1.5 text-2xs ${tab.delivery ? 'btn-soft' : 'btn-outline'}`}
                aria-pressed={!!tab.delivery}
                title={tab.delivery ? 'Đơn này đang giao hàng — bấm để sửa' : 'Giao hàng cho khách'}>
                <Truck size={14} aria-hidden="true" />
                {tab.delivery ? 'Đang giao' : 'Giao hàng'}
              </button>
              <button onClick={saveDraft} disabled={!tab.cart.length}
                className="btn btn-sm btn-outline flex-col !gap-0.5 !py-1.5 text-2xs"
                title="Lưu đơn này vào danh sách lưu tạm và đóng tab">
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
              {tab.delivery ? 'Thanh toán đơn giao' : 'Thanh toán'}
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
        onSubmit={submit}
        delivery={tab.delivery ? normalizeDelivery(tab.delivery) : null}
        onEditDelivery={() => { setPayOpen(false); setDeliveryOpen(true); }}
      />

      <DeliveryInfoModal
        open={deliveryOpen}
        onClose={() => setDeliveryOpen(false)}
        value={tab.delivery}
        customer={customer}
        carriers={carriers || []}
        goodsTotal={totals.total - totals.shipCharged}
        canPay={tab.cart.length > 0}
        onSave={(d) => {
          patchTab({ delivery: d });
          setDeliveryOpen(false);
          toast('Đã lưu thông tin giao — nút Thanh toán sẽ in theo lựa chọn vừa chọn.', 'ok', 5000);
        }}
        onPayPrint={(d) => { patchTab({ delivery: d }); setDeliveryOpen(false); setPayOpen(true); }}
        onClear={() => {
          patchTab({ delivery: null });
          setDeliveryOpen(false);
          toast('Đã huỷ thông tin giao — đơn trở lại thành bán tại quầy.', 'ok');
        }}
      />

      <DraftsModal
        open={draftsOpen}
        onClose={() => setDraftsOpen(false)}
        onOpen={openDraft}
        onChanged={reloadDrafts}
        openIds={tabs.map((t) => t.draftId).filter(Boolean)}
      />

      {/* --- Đặt hàng, đổi trả, thu nợ ngay tại quầy --- */}

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

      <DebtCollectModal
        open={debtOpen && !!tab.customerId}
        customerId={tab.customerId}
        onClose={() => setDebtOpen(false)}
        onDone={(res) => { reloadCustomers(); showVoucher(res?.transaction?.id); }}
      />

      <ExchangeModal
        open={exchangeOpen}
        onClose={() => setExchangeOpen(false)}
        products={products || []}
        policy={policy}
        onQuickReturn={() => { setExchangeOpen(false); setQuickReturn(true); }}
        onDone={() => { reload(); reloadCustomers(); }}
      />

      <DeliveryBoard open={boardOpen} onClose={() => setBoardOpen(false)} />

      <QuickReturnModal
        open={quickReturn}
        onClose={() => setQuickReturn(false)}
        products={products || []}
        priceListId={tab.priceListId}
        warehouseId={warehouseId}
        customerId={tab.customerId}
        customers={customers || []}
        policy={policy}
        onDone={() => { reload(); reloadCustomers(); }}
      />

      <PinApprovalModal
        open={!!pinAsk}
        reason={pinAsk?.reason}
        detail={pinAsk?.detail}
        onClose={() => setPinAsk(null)}
        onApproved={(res) => {
          const ask = pinAsk;
          setPinAsk(null);
          ask?.onOk?.(res);
          toast(`${res.approver?.full_name || 'Quản lý'} đã duyệt`, 'ok');
        }}
      />

      <Confirm
        open={!!closing}
        onClose={() => setClosing(null)}
        onConfirm={() => { dropTab(closing.id); setClosing(null); }}
        title="Đóng tab đang có hàng?"
        confirmText="Đóng tab, bỏ giỏ hàng"
        message={closing && (
          <>
            "{closing.title}" đang có <b>{closing.cart.length} mặt hàng</b> chưa thanh toán. Đóng tab là mất
            giỏ hàng này — muốn giữ lại thì bấm Huỷ rồi dùng nút <b>Lưu tạm</b>.
          </>
        )}
      />

      {voucher && <CashVoucherPrint voucher={voucher} onClose={() => setVoucher(null)} />}

      <PriceHistoryModal
        line={priceHistOf}
        customer={customer}
        onClose={() => setPriceHistOf(null)}
        onApply={(price) => {
          const key = priceHistOf.key;
          setPriceHistOf(null);
          commitLine(key, { price, priceEdited: true });
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
        onChanged={reloadCustomers}
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

      {printing?.kind === 'invoice' && (
        <InvoicePrint key={printing.key} sale={printing.sale} store={store}
          invoice={settings?.invoice || {}} onClose={nextPrint} />
      )}
      {printing?.kind === 'note' && (
        <DeliveryNotePrint key={printing.key} note={printing.note} onClose={nextPrint} />
      )}
      {printing?.kind === 'warranty' && (
        <WarrantyCardPrint key={printing.key} sale={printing.sale} store={store}
          mode={settings?.pos?.warranty_card_mode === 'separate' ? 'separate' : 'combined'}
          onClose={nextPrint} />
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
  const [wNote, setWNote] = useState('');
  const [serial, setSerial] = useState('');

  useEffect(() => {
    if (!line) return;
    setText(line.note || '');
    setMonths(Number(line.warrantyMonths) || 0);
    setWNote(line.warrantyNote || '');
    setSerial(line.serial || '');
  }, [line]);

  const def = Number(line?.warrantyDefault) || 0;
  /* Hạn bảo hành xem trước cho khách biết ngay */
  const until = months > 0
    ? new Date(new Date().setMonth(new Date().getMonth() + Number(months)))
    : null;
  const save = (patch = {}) => onSave({
    note: text.trim(),
    warrantyMonths: Number(months) || 0,
    warrantyNote: wNote.trim(),
    serial: serial.trim(),
    ...patch,
  });

  return (
    <Modal
      open={!!line}
      onClose={onClose}
      title="Ghi chú & bảo hành"
      subtitle={line?.name}
      size="sm"
      footer={<>
        {Number(months) > 0 && (
          <Button variant="danger" className="mr-auto" onClick={() => save({ warrantyMonths: 0 })}>
            Hủy bảo hành
          </Button>
        )}
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={() => save()}>Lưu</Button>
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

        <p className="text-2xs text-muted-ink leading-relaxed">
          {def > 0
            ? `Mặt hàng này mặc định bảo hành ${def} tháng. Sửa hay huỷ ở đây chỉ áp dụng cho hoá đơn này.`
            : 'Mặt hàng này không có bảo hành mặc định — thêm bảo hành riêng cho hoá đơn này nếu cần.'}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bảo hành (tháng)" hint="Để 0 nếu hàng không bảo hành" htmlFor="ln-warranty">
            <div className="flex items-center gap-1.5">
              <QtyInput id="ln-warranty" size="md" value={months} onChange={setMonths} min={0} className="flex-1" />
              <div className="flex gap-1">
                {[6, 12, 24].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMonths(m)}
                    className={`btn btn-sm ${Number(months) === m ? 'btn-soft' : 'btn-outline'}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            {until && <p className="hint">Hết hạn ngày <b>{date(until)}</b></p>}
            {def > 0 && Number(months) !== def && (
              <button type="button" onClick={() => { setMonths(def); setWNote(line?.warrantyNote || wNote); }}
                className="text-2xs text-accent font-semibold hover:underline cursor-pointer mt-0.5">
                Theo mặt hàng: {def} tháng
              </button>
            )}
          </Field>

          <Field label="Số serial / số máy" hint="Ghi để sau này tra ra ai mua" htmlFor="ln-serial">
            <Input id="ln-serial" value={serial} onChange={(e) => setSerial(e.target.value)}
              placeholder="PNS-2026-0099" />
          </Field>
        </div>

        <Field label="Điều kiện bảo hành" hint="In lên phiếu bảo hành" htmlFor="ln-wnote">
          <Input id="ln-wnote" value={wNote} onChange={(e) => setWNote(e.target.value)}
            disabled={!(Number(months) > 0)} placeholder="VD: không bảo hành cháy nổ do điện áp" />
        </Field>
      </div>
    </Modal>
  );
}

/* ==================================================================== */

/* Cùng một hồ sơ ba tab với trang Khách hàng (tài liệu 08): thu nợ hay chỉnh
   hạn mức ở quầy thì trang quản trị thấy ngay, và ngược lại. */
function CustomerQuickModal({ open, customerId, onClose, onChanged }) {
  return (
    <Modal
      open={open && !!customerId}
      onClose={onClose}
      title="Hồ sơ khách hàng"
      size="xl"
      footer={<Button onClick={onClose}>Đóng</Button>}
    >
      {open && customerId && (
        <CustomerProfile customerId={customerId} compact onChanged={onChanged} />
      )}
    </Modal>
  );
}

/* ==================================================================== */

function DraftsModal({ open, onClose, onOpen, openIds, onChanged }) {
  const { toast } = useApp();
  const { data, busy, reload } = useFetch(() => api.get('/drafts'), [], { skip: !open });
  const [deleting, setDeleting] = useState(null);
  const [busyDel, setBusyDel] = useState(false);

  /* Dùng hộp xác nhận của phần mềm, không dùng window.confirm — trình duyệt
     nhúng trong ứng dụng chặn hộp đó, bấm xoá xong không có gì xảy ra. */
  const remove = async () => {
    setBusyDel(true);
    try {
      await api.del(`/drafts/${deleting.id}`);
      setDeleting(null);
      reload();
      onChanged?.();
      toast('Đã xoá đơn lưu tạm', 'ok');
    } catch (e) {
      toast(e.message, 'bad', 6000);
    } finally {
      setBusyDel(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Đơn lưu tạm"
      subtitle="Đơn đang bán dở, lưu trên máy chủ nên máy nào trong tiệm cũng mở tiếp được. Mở lại thì đơn rời khỏi danh sách này."
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
                      <td className="font-semibold">{d.tab_no ? tabTitle(d.tab_no) : (d.title || '(chưa đặt tên)')}</td>
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
                            className="!text-danger hover:!bg-red-50" onClick={() => setDeleting(d)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        busy={busyDel}
        title="Xoá hoá đơn tạm?"
        confirmText="Xoá"
        message={deleting && (
          <>Xoá hoá đơn tạm <b>{deleting.title || deleting.code}</b>?
            {deleting.item_count > 0 && <> Đang có {deleting.item_count} mặt hàng trong giỏ.</>}
            {' '}Không lấy lại được.</>
        )}
      />
    </Modal>
  );
}
