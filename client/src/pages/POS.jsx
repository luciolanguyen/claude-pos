import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Plus, X, UserPlus, Printer, Percent, Package, ShoppingCart, ArrowLeft,
  FileText, Grid3x3, Truck, Save, History, Eye, EyeOff, FolderOpen, AlertTriangle,
  ClipboardList, MapPin, ShieldCheck, Trash2, Star, ReceiptText,
  FolderTree, Layers, Zap, Check, Handshake, Lightbulb, GripVertical,
  Maximize2, Wallet, Camera,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, useLocal, useSearchMode, useDebounced } from '../lib/store';
import {
  money, n, qty as fq, match, matchMode, matchCustomer, customerPhones,
  datetime, date, smartTime, tierRows, tierIndexFor, tierPriceFor,
  blindCode, DEFAULT_BLIND_KEY,
} from '../lib/format';
import {
  Button, IconButton, Input, Modal, Field, Empty, Spinner, Badge, Combo, Textarea, QtyInput, Confirm,
  Select, MoneyInput, ErrorBox,
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
import { TileImageButton, ProductInfoModal } from '../components/ProductImages';
import { OrderBell, SaveAsOrderModal, PickOrderModal } from '../components/PosOrders';
import {
  DebtCollectModal, CustomerDebtBanner,
  OverdueDebtsButton, OverdueDebtsModal,
} from '../components/PosDebt';
import PaymentModal from '../components/PosPayment';
import ProxyBuyer from '../components/PosBuyer';
import { CartLine, OrderNote, MoneyCell, PercentCell, lineAmount } from '../components/PosCart';
import {
  GridToolbar, GridSortPanel, CategoryDrawer, categoryFilterSet, LazyGrid,
} from '../components/PosCatalog';
import {
  usePosPolicy, PinApprovalModal, cartDiscountPercent, canSelfApprove,
} from '../components/PosApproval';
import { tabTitle, tabNoOf, smallestFree, normalizeTabs } from '../lib/posTabs';
import PosCameraScan from '../components/PosCameraScan';
import PosDayInvoices from '../components/PosDayInvoices';
import { isTouchDevice, primeAudio } from '../lib/cameraScan';

/* Người có quyền xem giá vốn mới thấy giá vốn và giá nhập gần nhất khi bán.
   Máy chủ cũng gỡ hẳn các cột này khỏi dữ liệu trả cho người không có quyền. */
const canSeeCost = (user, can) => !!can?.('cost.view') || user?.role === 'owner' || user?.role === 'manager';

/**
 * Hoa hồng của một dòng hàng mua hộ (tài liệu 24, phần 5.1). Chỉ có nghĩa
 * khi hàng của người khác gửi — tự bốc ngoài thì tiệm ăn chênh lệch chứ
 * không "trích hoa hồng của chính mình".
 */
/**
 * Số dòng trong một tab, TÍNH CẢ hàng mua hộ vãng lai. Hoá đơn chỉ có hàng
 * mua hộ là hợp lệ (tài liệu 24), nên mọi chỗ hỏi "tab có gì chưa" — lưu tạm,
 * mở lại đơn tạm, đóng tab, phím F4 — phải đếm bằng hàm này, không đếm riêng
 * giỏ hàng của tiệm. Trước đây tab chỉ có hàng mua hộ đóng là mất không hỏi.
 */
const lineCount = (t) => (t?.cart?.length || 0) + (t?.consign?.length || 0);

const consignCommission = (c, amount) => {
  if (!c?.partner_id) return 0;
  const v = Number(c.commission_value) || 0;
  const raw = c.commission_type === 'percent' ? Math.round(amount * v / 100) : Math.round(v);
  return Math.max(0, Math.min(amount, raw));
};

/* Bốn cấp co giãn lưới | giỏ (tài liệu 24, phần 6). Số là % của LƯỚI. */
/* Các cấp co giãn lưới | giỏ (tài liệu 24, phần 6), XẾP THEO LƯỚI TO DẦN:
   bấm liên tục vào vạch là lưới cứ rộng dần ra rồi quay vòng, nên đoán được
   ngay bước kế tiếp. Kéo chuột thì nhảy về cấp gần nhất, không phụ thuộc
   thứ tự này. */
const SPLIT_LEVELS = [
  { grid: 0, label: 'Toàn giỏ 0/100', hint: 'Ẩn hẳn lưới hàng, rà soát hoá đơn trước khi đóng đơn' },
  { grid: 40, label: 'Rộng giỏ 40/60', hint: 'Giỏ rộng ra để xem rõ nhãn mua hộ và sửa giá sỉ' },
  { grid: 60, label: 'Cân bằng 60/40', hint: 'Tỷ lệ tiêu chuẩn khi bán hàng thông thường' },
  { grid: 75, label: 'Rộng lưới 75/25', hint: 'Lưới rộng hơn mà giỏ vẫn đọc được từng dòng' },
  { grid: 85, label: 'Rộng lưới 85/15', hint: 'Lưới bung tối đa, giỏ thu thành thanh dọc' },
];

/* Cấp mặc định lúc mở máy: vẫn là 60/40 như trước */
const SPLIT_DEFAULT = SPLIT_LEVELS.findIndex((x) => x.grid === 60);

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
  consign: [],             // hàng mua hộ vãng lai (tài liệu 24, phần 5.1)
});

/**
 * Một ô hàng hoá trên lưới chọn.
 * inCart là tổng số lượng món này đang nằm trong giỏ (cộng cả các dòng có
 * đơn vị khác nhau). Có số thì ô đổi màu và hiện icon giỏ — nhìn lướt là
 * biết đã thêm chưa, khỏi bấm trùng lúc đông khách.
 *
 * Đợt 15: góc ô có icon ảnh (rê chuột xem ảnh to, bấm mở hộp chi tiết —
 * tài liệu 13 mục 3.1), có nút chọn nhanh đơn vị tính (mục 3.4), và hàng
 * ghim đầu lưới theo mùa mang dấu ★ (tài liệu 14 mục 2.3).
 */
/**
 * Đơn vị mà một ô hàng đang bán. Ô nào khai rõ đơn vị thì lấy đúng đơn vị
 * đó (mỗi đơn vị bán chính là một ô riêng — tài liệu 16, mục 2.1).
 */
const sellUnitOf = (p, unit = null) => unit
  || p.units?.find((u) => u.is_sell_main) || p.units?.find((u) => u.id === p.sell_unit_id)
  || p.units?.find((u) => u.factor === 1) || p.units?.[0];

function ProductTile({
  p, priceListId, showCost, onPick, inCart = 0, bought = null,
  showUnits = false, showConverted = false, unit = null, onInfo, onHover,
  showTiers = false, line = null, blindKeys = null, alias = null,
}) {
  const [unitsOpen, setUnitsOpen] = useState(false);
  /* Menu ĐVT đang bung mà bấm ra chỗ khác thì tự thu về — bắt người đứng
     quầy bấm đúng lại cái nút vừa mở mới đóng được là phiền. */
  const unitsRef = useRef(null);
  useEffect(() => {
    if (!unitsOpen) return undefined;
    const away = (e) => { if (!unitsRef.current?.contains(e.target)) setUnitsOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setUnitsOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [unitsOpen]);
  /* Mỗi đơn vị bán chính được vẽ thành MỘT ô riêng ngoài lưới (tài liệu 16,
     mục 2.1) — ô nào thì bán theo đơn vị đó. */
  const sellUnit = sellUnitOf(p, unit);
  const price = sellUnit?.prices?.[priceListId] ?? 0;
  /* Đơn vị cơ bản, để quy đổi giá cho dễ so (tài liệu 16, mục 5) */
  const baseUnit = p.units.find((u) => u.factor === 1) || p.units[0];
  const basePrice = Number(baseUnit?.prices?.[priceListId]) || 0;
  const perBase = (u) => {
    const f = Number(u?.factor) || 1;
    return f > 1 ? Math.round((Number(u?.prices?.[priceListId]) || 0) / f) : 0;
  };
  /* Ma trận nấc giá sỉ của chính đơn vị ô này đang bán (tài liệu 22, mục 3).
     Mặt hàng không khai nấc nào thì mảng rỗng, ô hàng gọn y như cũ. */
  const tiers = showTiers ? tierRows(sellUnit, price) : [];
  /* Nấc dòng này đang ăn trong giỏ — để tô cùng màu với dòng bên giỏ hàng */
  const activeIdx = line && !line.priceEdited ? tierIndexFor(tiers, line.qty) : -1;
  /* Nấc khách quen lấy lần gần nhất, gợi ý sẵn (tài liệu 22, mục 4.2) */
  const lastIdx = bought && bought.unit_name === sellUnit?.unit_name
    ? tierIndexFor(tiers, bought.qty) : -1;
  const out = p.track_stock && p.stock <= 0;
  const low = p.track_stock && p.min_stock > 0 && p.stock > 0 && p.stock <= p.min_stock;
  const added = inCart > 0;
  const featured = p.featured_rank !== null && p.featured_rank !== undefined;
  const priceOfUnit = (u) => Number(u?.prices?.[priceListId] ?? 0) || 0;

  /* Bấm vào vùng chung của ô: lấy ĐƠN VỊ BÁN CHÍNH. Bấm vào một đơn vị cụ
     thể trong menu: lấy đúng đơn vị đó (tài liệu 13, mục 3.4). */
  const pickMain = () => { if (!out) onPick(p, sellUnit?.id); };
  /* Ô của đơn vị lớn thì nói rõ đang bán theo đơn vị nào, khỏi nhìn nhầm giá */
  const unitLabel = sellUnit && Number(sellUnit.factor) > 1
    ? `${sellUnit.unit_name} (=${fq(sellUnit.factor)} ${p.base_unit})` : null;

  return (
    <div
      className={`card p-2 text-left transition-colors duration-150 relative
                 flex flex-col gap-1 min-h-[92px]
                 ${out ? 'opacity-45' : 'hover:border-accent hover:bg-accent-soft/40'}
                 ${added ? 'border-accent bg-accent-soft/30' : ''}
                 ${featured ? 'ring-1 ring-amber-400/70' : ''}`}
      onMouseEnter={() => onHover?.(p.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      {/* Icon ảnh + mô tả ở góc ô */}
      <TileImageButton product={p} onOpen={onInfo} />

      <button
        type="button"
        onClick={pickMain}
        disabled={out}
        aria-label={added
          ? `${p.name} — đang có ${fq(inCart)} trong giỏ, bấm để thêm nữa`
          : `Thêm ${p.name} vào giỏ`}
        className="text-left flex flex-col gap-1 flex-1 cursor-pointer disabled:cursor-not-allowed"
      >
        <div className="flex items-start justify-between gap-1 pr-7">
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

        <div className="text-[13px] font-semibold leading-snug line-clamp-2 flex-1">
          {featured && (
            <Star size={11} className="inline -mt-0.5 mr-0.5 text-amber-500 fill-amber-400"
              aria-label="Hàng bán chạy, ghim đầu lưới" />
          )}
          {p.name}
        </div>
        {unitLabel && (
          <div className="text-2xs font-semibold text-blue-800 leading-tight">
            Bán theo {unitLabel}
            {sellUnit.pack_spec && <span className="font-normal"> · {sellUnit.pack_spec}</span>}
          </div>
        )}
        {p.alias && !unitLabel && (
          <div className="text-2xs text-muted-ink italic truncate leading-tight">{p.alias}</div>
        )}
        {/* Khách này gọi món đó bằng tên riêng (tài liệu 24, phần 3) */}
        {alias && (
          <div className="text-2xs font-semibold text-amber-900 bg-amber-100 border border-amber-300
                          rounded px-1 py-0.5 leading-snug flex items-start gap-1">
            <Lightbulb size={10} className="shrink-0 mt-px" aria-hidden="true" />
            <span>
              Khách gọi: <b>{alias.alias}</b>
              {alias.note && <span className="block font-normal">{alias.note}</span>}
            </span>
          </div>
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
      </button>

      {added && (
        <span
          className="absolute -top-1.5 -left-1.5 flex items-center gap-0.5 rounded-full
                     bg-accent text-white text-2xs font-bold px-1.5 py-0.5 shadow-sm"
          aria-hidden="true"
        >
          <ShoppingCart size={11} />
          {fq(inCart)}
        </span>
      )}

      {/* Ma trận nấc giá sỉ: bấm thẳng vào nấc là hàng bay vào giỏ với đúng
          số lượng và đơn giá của nấc đó (tài liệu 22, mục 3.2). Các nấc phải
          XUỐNG DÒNG được, không cắt cụt — cắt là mất luôn nấc cuối. */}
      {tiers.length > 0 && !out && (
        <div className="flex flex-wrap gap-1" role="group"
          aria-label={`Nấc giá sỉ của ${p.name} theo ${sellUnit?.unit_name}`}>
          {tiers.map((t, i) => {
            const on = i === activeIdx;
            const last = i === lastIdx && !on;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => onPick(p, sellUnit?.id, t)}
                aria-pressed={on}
                title={on
                  ? `Đang bán theo nấc này: mua ${t.label} ${sellUnit?.unit_name} giá ${n(t.price)}`
                  : `Bấm để lấy ${t.min_qty} ${sellUnit?.unit_name} với giá ${n(t.price)}`
                    + (last ? ' — lần trước khách này lấy nấc này' : '')}
                className={`text-2xs font-semibold rounded px-1.5 py-0.5 border tabular
                            cursor-pointer transition-colors duration-100 whitespace-nowrap
                            ${on
                              ? 'bg-indigo-600 border-indigo-700 text-white'
                              : last
                                ? 'bg-violet-50 border-violet-400 text-violet-900 font-bold'
                                : 'bg-muted/70 border-line text-ink hover:border-accent hover:bg-accent-soft/60'}`}
              >
                {on && <Check size={9} strokeWidth={3} className="inline -mt-0.5 mr-0.5" aria-hidden="true" />}
                {last && <History size={9} className="inline -mt-0.5 mr-0.5" aria-hidden="true" />}
                {t.label}: {n(t.price)}
              </button>
            );
          })}
        </div>
      )}

      {/* Chọn nhanh đơn vị tính (tài liệu 13, mục 3.4) */}
      {showUnits && p.units.length > 1 && !out && (
        <div className="relative" ref={unitsRef}>
          <button
            type="button"
            onClick={() => setUnitsOpen((o) => !o)}
            aria-expanded={unitsOpen}
            aria-label={`Chọn đơn vị tính khác cho ${p.name}`}
            className="w-full flex items-center justify-between gap-1 rounded border border-line
                       bg-muted/60 px-1.5 py-0.5 text-2xs font-semibold cursor-pointer
                       hover:border-accent hover:bg-accent-soft/50 transition-colors duration-100"
          >
            <span>{sellUnit?.unit_name} ▼</span>
            <span className="text-muted-ink">{n(p.units.length)} ĐVT</span>
          </button>
          {unitsOpen && (
            <ul className="absolute left-0 right-0 top-full mt-0.5 z-20 rounded border border-line
                           bg-card shadow-lg overflow-hidden">
              {p.units.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => { onPick(p, u.id); setUnitsOpen(false); }}
                    className="w-full flex items-baseline justify-between gap-2 px-2 py-1 text-2xs
                               hover:bg-accent-soft/60 cursor-pointer text-left"
                  >
                    <span className="font-semibold">
                      {u.unit_name}
                      {u.factor > 1 && (
                        <span className="text-muted-ink font-normal"> = {fq(u.factor)} {p.base_unit}</span>
                      )}
                    </span>
                    <span className="tabular font-bold text-accent whitespace-nowrap">
                      {n(priceOfUnit(u))}
                      {/* Quy đổi về đơn vị cơ bản để so nhanh (tài liệu 16, mục 5) */}
                      {showConverted && perBase(u) > 0 && (
                        <span className="ml-1 font-normal text-muted-ink">
                          | {n(perBase(u))}/{p.base_unit}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showCost && (
        /* Mã hoá giá vốn (tài liệu 24, phần 4): bật thì hiện chuỗi chữ thay vì
           con số, để khách đứng cạnh quầy không đọc trộm được. Phần trăm lãi
           vẫn hiện — biết lãi bao nhiêu phần trăm không suy ra được giá vốn. */
        <div className="text-2xs text-muted-ink tabular border-t border-line pt-0.5 leading-snug">
          <span className="whitespace-nowrap">
            Vốn{' '}
            {blindKeys
              ? <b className="font-mono tracking-wider text-ink">{blindCode(p.cost_price, blindKeys.cost)}</b>
              : n(p.cost_price)}
          </span>
          {price > 0 && p.cost_price > 0 && (
            <span className="ml-1 text-emerald-700 font-semibold whitespace-nowrap">
              +{Math.round((price - p.cost_price) / p.cost_price * 100)}%
            </span>
          )}
          {p.last_purchase_price > 0 && (
            <div className="whitespace-nowrap">
              Nhập gần nhất{' '}
              {blindKeys
                ? <b className="font-mono tracking-wider text-ink">{blindCode(p.last_purchase_price, blindKeys.purchase)}</b>
                : n(p.last_purchase_price)}
            </div>
          )}
        </div>
      )}
    </div>
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
  const [exchangeOpen, setExchangeOpen] = useState(false);  // đổi trả hàng: true | { sale } mở sẵn hoá đơn
  const [dayOpen, setDayOpen] = useState(false);            // hoá đơn trong ngày (plan 31, hạng mục 1.1)
  const [debtOpen, setDebtOpen] = useState(false);          // thu nợ khách đang chọn
  const [debtFor, setDebtFor] = useState(null);             // thu nợ của một khách khác tab
  const [overdueOpen, setOverdueOpen] = useState(false);    // bảng nợ quá hạn cả tiệm
  const [infoOf, setInfoOf] = useState(null);               // hộp xem ảnh + mô tả hàng hoá
  const [hoverPid, setHoverPid] = useState(null);           // ô hàng đang rê chuột tới
  /* Kiểu tìm kiếm: nhớ chung với mọi ô tìm khác (tài liệu 13, mục 2.1) */
  const [searchMode, setSearchMode] = useSearchMode();
  /* Công tắc hàng ghim (tài liệu 16, mục 4). Tắt thì KHÔNG ẩn món nào, chỉ
     xả ghim: lưới về thứ tự thường. Nhớ theo từng máy đứng quầy. */
  const [pinOn, setPinOn] = useLocal('thpos.featured_on', true);
  /* Ba quy tắc xếp lưới còn lại, gộp vào bảng [Sắp xếp lưới] (plan 31, mục
     3.2). Nhớ theo từng máy đứng quầy — quầy 1 và quầy 2 quen khác nhau. */
  const [boughtTop, setBoughtTop] = useLocal('thpos.sort_bought_top', true);
  const [cartTop, setCartTop] = useLocal('thpos.sort_cart_top', true);
  /* Quầy quen gõ tìm / quét mã thì lưới hàng chỉ tổ chật màn hình */
  const [hideGrid, setHideGrid] = useLocal('thpos.grid_on_search', false);
  /* Ba công tắc của tài liệu 22, mục 1 — nhớ theo từng máy đứng quầy:
       1. bảng lọc nhóm hàng đẩy ra / thu vào ở cạnh trái
       2. hiện ma trận nấc giá sỉ dưới mỗi ô hàng
       3. tự áp giá nấc khi số lượng trong giỏ đổi — CHỈ hiện khi công tắc 2
          đang bật, để quầy bán lẻ không phải nhìn nút thừa. */
  const [catDrawer, setCatDrawer] = useLocal('thpos.cat_drawer', false);
  /* Bốn cấp co giãn giữa lưới hàng và giỏ (tài liệu 24, phần 6). Số là % bề
     ngang dành cho LƯỚI; phần còn lại là của giỏ hàng. */
  /* Khoá nhớ ĐỔI TÊN từ đợt trước: số cấp lưu trong máy là THỨ TỰ, mà thứ
     tự vừa xếp lại — đọc số cũ thì máy nào đang để 85/15 tự nhảy sang cấp
     khác, nên cho nhớ lại từ đầu bằng khoá mới. */
  const [splitLevel, setSplitLevel] = useLocal('thpos.split_lv2', SPLIT_DEFAULT);
  const [dragging, setDragging] = useState(false);
  const [consignOpen, setConsignOpen] = useState(false);   // hộp thêm món mua hộ
  const [notesOpen, setNotesOpen] = useState(false);       // xem ghi chú đặc thù của khách
  const [tierOn, setTierOn] = useLocal('thpos.tier_on', false);
  const [tierAuto, setTierAuto] = useLocal('thpos.tier_auto', true);
  const [quickOpen, setQuickOpen] = useState(false);
  const [priceHistOf, setPriceHistOf] = useState(null);
  const [noteOf, setNoteOf] = useState(null);
  const [warrantyOf, setWarrantyOf] = useState(null);      // hộp sửa bảo hành của một dòng
  const [printQueue, setPrintQueue] = useState([]);         // hoá đơn / phiếu giao chờ in lần lượt
  const [provisional, setProvisional] = useState(null);
  const [closing, setClosing] = useState(null);             // tab còn hàng, hỏi lại trước khi đóng
  const [pinAsk, setPinAsk] = useState(null);               // đang hỏi PIN quản lý cho mức giảm giá
  const [showCost, setShowCost] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const searchRef = useRef(null);
  /* Quét bằng camera điện thoại (plan 31, hạng mục 2b). Nút camera chỉ hiện
     trên máy cảm ứng — máy tính ở quầy đã có máy quét cầm tay. */
  const [camOpen, setCamOpen] = useState(false);
  const touch = useMemo(() => isTouchDevice(), []);
  const gridRef = useRef(null);
  /* Dòng giỏ hàng đang được tô sáng, để cuộn tới cho thấy (tài liệu 14, mục 3) */
  const hoverLineRef = useRef(null);

  /* Bật nút chọn nhanh đơn vị tính ngoài lưới hay không (tài liệu 13, mục 2.2) */
  const showUnitPicker = settings?.pos?.show_unit_picker === true;
  /* Hiện thêm giá quy đổi về đơn vị cơ bản trong menu ĐVT (tài liệu 16, mục 5) */
  const showConvertedPrice = settings?.pos?.show_converted_price === true;
  /* Ba phân hệ mở rộng của tài liệu 24, phần 1 — tắt thì màn hình gọn như cũ */
  const notesOn = settings?.pos?.customer_notes === true;
  const blindOn = settings?.pos?.blind_cost === true;
  const consignOn = settings?.pos?.consign === true;
  const blindKeys = {
    cost: settings?.pos?.blind_key_cost || DEFAULT_BLIND_KEY,
    purchase: settings?.pos?.blind_key_purchase || 'SOBMANTỆIV',
  };

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

  /* Rê chuột vào ô hàng đã có trong giỏ: cuộn giỏ tới đúng dòng đó, để thu
     ngân khỏi phải dò mắt khi giỏ dài (tài liệu 14, mục 3.2). */
  useEffect(() => {
    if (!hoverPid || !hoverLineRef.current) return;
    hoverLineRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [hoverPid]);

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
  /* Chủ hàng vãng lai để chọn lúc thêm món mua hộ (tài liệu 24, phần 5.1) */
  const { data: partners, reload: reloadPartners } = useFetch(
    () => api.consignPartners({ active: 1 }), [],
    { skip: settings?.pos?.consign !== true });
  /* Nợ quá hạn cả tiệm — nút cạnh ô tìm hàng (thay nút Thu nợ trùng cũ) */
  const {
    data: overdue, busy: overdueBusy, error: overdueErr, reload: reloadOverdue,
  } = useFetch(() => api.get('/pos/overdue-debts'), []);

  /* Giá đã bán cho khách này trước đây — nạp 1 lần khi đổi khách */
  const [priceHist, setPriceHist] = useState({});
  useEffect(() => {
    if (!tab?.customerId) { setPriceHist({}); return; }
    api.get(`/price-history/${tab.customerId}/all`)
      .then(setPriceHist)
      .catch(() => setPriceHist({}));
  }, [tab?.customerId]);

  /**
   * Khách đang chọn có đơn LƯU TẠM nào chưa xử không (plan 31, hạng mục 7b).
   * Lập đơn mới cho người đang có đơn treo là hay quên mất đơn cũ, tới lúc
   * khách hỏi lại thì đã bán trùng.
   */
  const draftsOfCustomer = useMemo(() => {
    if (!tab?.customerId) return [];
    /* Đơn tạm đang mở sẵn ở một tab khác thì không phải "bỏ quên" — người
       đứng quầy nhìn thấy nó ngay trên thanh tab rồi. */
    const openIds = new Set(tabs.map((t) => t.draftId).filter(Boolean));
    return (draftList || [])
      .filter((d) => d.customer_id === tab.customerId && !openIds.has(d.id));
  }, [draftList, tab?.customerId, tabs]);

  /* Ghi chú hàng đặc thù của khách đang chọn (tài liệu 24, phần 3) */
  const [custNotes, setCustNotes] = useState([]);
  const loadNotes = useCallback(() => {
    if (!notesOn || !tab?.customerId) { setCustNotes([]); return; }
    api.customerProductNotes(tab.customerId)
      .then((rows) => setCustNotes(Array.isArray(rows) ? rows : []))
      .catch(() => setCustNotes([]));
  }, [notesOn, tab?.customerId]);
  useEffect(() => { loadNotes(); }, [loadNotes]);

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

  /* Dòng giỏ của đúng một Ô hàng (mặt hàng + đơn vị), để ô ngoài lưới biết
     đang ăn nấc giá nào mà tô cùng màu với giỏ (tài liệu 22, mục 4.1) */
  const lineByKey = useMemo(
    () => new Map((tab?.cart || []).map((l) => [l.key, l])), [tab?.cart]);

  /**
   * Nấc giá mà một dòng giỏ hàng đang ăn — để dòng bên giỏ và tag ngoài lưới
   * đổi màu song song với nhau (tài liệu 22, mục 4.1). Mặt hàng không khai
   * nấc nào thì trả null, dòng giỏ gọn y như cũ.
   */
  const tierOf = (l) => {
    const u = l.units?.find((x) => x.id === l.unit_id);
    const listed = Number(u?.prices?.[tab?.priceListId] ?? 0) || 0;
    const rows = tierRows(u, listed);
    if (rows.length < 2) return null;
    const i = tierIndexFor(rows, l.qty);
    if (i < 0) return null;
    /* Thu ngân mặc cả rồi sửa tay đơn giá thì dòng đó KHÔNG còn ăn giá nấc
       nữa — vẫn nói cho biết nấc đó lẽ ra bao nhiêu, nhưng không tô màu như
       đang ăn nấc, kẻo nhìn thấy hai con số khác nhau lại tưởng máy sai. */
    const edited = !!l.priceEdited && Math.round(Number(l.price) || 0) !== rows[i].price;
    return { ...rows[i], index: i, count: rows.length, edited };
  };

  /* ------------------------------ Giỏ hàng ------------------------------ */

  /**
   * Thêm hàng vào giỏ.
   *
   * `pick` là nấc giá sỉ vừa bấm ngoài lưới (tài liệu 22, mục 3.2): bấm
   * thẳng vào tag [10-19: 9.000] thì SỐ LƯỢNG và ĐƠN GIÁ điền luôn theo
   * nấc đó, một cú bấm là xong. Không bấm nấc nào thì y như cũ: cộng thêm
   * một đơn vị, giá lấy theo bảng giá (hoặc theo nấc đang ăn nếu có khai).
   */
  const addToCart = useCallback((product, unitId, pick = null) => {
    const unit = unitId
      ? product.units.find((u) => u.id === unitId)
      : (product.units.find((u) => u.factor === 1) || product.units[0]);
    if (!unit) return;

    patchTab((t) => {
      const key = `${product.id}:${unit.id}`;
      const listed = Number(unit.prices?.[t.priceListId] ?? unit.prices?.[defaultPriceList] ?? 0) || 0;
      if (t.cart.some((l) => l.key === key)) {
        return {
          cart: t.cart.map((l) => {
            if (l.key !== key) return l;
            const q = pick ? Number(pick.min_qty) || 1 : l.qty + 1;
            /* Sửa tay đơn giá rồi thì giữ nguyên, trừ khi bấm thẳng vào nấc */
            const price = pick ? Math.round(pick.price)
              : (l.priceEdited ? l.price : tierPriceFor(unit, q, listed) || l.price);
            return { ...l, qty: q, price, priceEdited: pick ? false : l.priceEdited };
          }),
        };
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
          qty: pick ? Number(pick.min_qty) || 1 : 1,
          price: pick ? Math.round(pick.price) : (tierPriceFor(unit, 1, listed) || listed),
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

  /* ---------------- Dòng hàng mua hộ vãng lai (tài liệu 24) ------------- */
  const addConsign = (row) => patchTab((t) => ({
    consign: [...(t.consign || []), { ...row, key: `cs${Date.now()}${Math.random().toString(36).slice(2, 5)}` }],
  }));
  const updateConsign = (key, patch) => patchTab((t) => ({
    consign: (t.consign || []).map((c) => (c.key === key ? { ...c, ...patch } : c)),
  }));
  const removeConsign = (key) => patchTab((t) => ({
    consign: (t.consign || []).filter((c) => c.key !== key),
  }));

  /* Đổi bảng giá -> áp lại giá cho dòng chưa sửa tay */
  const applyPriceList = (plId) => {
    patchTab((t) => ({
      priceListId: plId,
      cart: t.cart.map((l) => {
        if (l.priceEdited) return l;
        const u = l.units?.find((x) => x.id === l.unit_id);
        const p = u?.prices?.[plId];
        /* Giá mới vẫn phải soi lại bảng nấc: đang mua 20 cái thì đổi bảng giá
           xong vẫn phải ăn giá nấc ≥20 của bảng giá mới (tài liệu 22). */
        return p != null ? { ...l, price: tierPriceFor(u, l.qty, p) || p } : l;
      }),
    }));
  };

  const updateLine = (key, patch) =>
    patchTab((t) => ({ cart: t.cart.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  const removeLine = (key) =>
    patchTab((t) => ({ cart: t.cart.filter((l) => l.key !== key) }));

  /**
   * Sửa số lượng ở giỏ. Công tắc [Tự áp giá nấc] bật thì đơn giá tự tụt/nhảy
   * về nấc tương ứng theo thời gian thực (tài liệu 22, mục 3.2); tắt thì số
   * lượng tăng nhưng đơn giá giữ nguyên. Dòng đã sửa giá tay coi như đóng
   * băng — thu ngân mặc cả xong không muốn máy tự sửa lại.
   */
  const setQty = (l, q) => {
    const patch = { qty: q };
    if (tierAuto && !l.priceEdited && Number(q) > 0) {
      const u = l.units?.find((x) => x.id === l.unit_id);
      const listed = Number(u?.prices?.[tab.priceListId] ?? 0) || 0;
      const next = tierPriceFor(u, q, listed);
      if (next > 0 && next !== l.price) patch.price = next;
    }
    updateLine(l.key, patch);
  };

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
              /* Nấc của Thùng khác nấc của Cái — đổi đơn vị là phải tính lại */
              price: l.priceEdited ? l.price
                : tierPriceFor(u, l.qty, u.prices?.[t.priceListId] ?? l.price)
                  || (u.prices?.[t.priceListId] ?? l.price),
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
    cart: [], consign: [], discountType: 'amount', discountValue: 0,
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
    /* Hàng mua hộ vãng lai cũng là tiền khách phải trả. Không chịu thuế GTGT
       vì không có hoá đơn đầu vào (tài liệu 24, phần 5.1). Giá vốn:
         - có chủ hàng: phần phải trả lại chủ, đã trừ hoa hồng tiệm giữ;
         - tự bốc ngoài: tiền tiệm bỏ ra bốc hàng. */
    const consignRows = Array.isArray(tab.consign) ? tab.consign : [];
    let consignSub = 0;
    for (const c of consignRows) {
      const amount = Math.round((Number(c.qty) || 0) * (Number(c.price) || 0));
      consignSub += amount;
      subtotal += amount;
      cogs += c.partner_id
        ? amount - consignCommission(c, amount)
        : Math.round((Number(c.qty) || 0) * (Number(c.cost) || 0));
    }
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
      count: tab.cart.length + consignRows.length,
      consign: consignSub,
      consignCount: consignRows.length,
    };
  }, [tab]);

  /* Mức giảm hiện tại so với bảng giá — để nhắc thu ngân trước khi tới bước
     thanh toán (đổi số lượng cũng làm % giảm thay đổi) */
  const cartPct = useMemo(
    () => (tab ? cartDiscountPercent(tab.cart, tab.priceListId, tab) : 0), [tab]);

  /* ---------------------------- Lọc danh sách hàng ---------------------- */

  /* Chỉ còn MỘT chỗ lọc nhóm hàng: thanh trượt cạnh trái. Dải duyệt nhóm
     nằm ngang đã bỏ, nên không còn "nhóm đang đứng trên đường dẫn" nữa. */
  const catSet = useMemo(
    () => categoryFilterSet(meta.categories, pickedCats),
    [meta.categories, pickedCats]);

  /* Ghi chú đặc thù tra theo mã hàng, để ô hàng biết khách gọi nó là gì */
  const noteByProduct = useMemo(() => {
    const m = new Map();
    for (const nt of custNotes) if (nt.product_id) m.set(nt.product_id, nt);
    return m;
  }, [custNotes]);

  /* Gõ đúng TÊN KHÁCH GỌI thì lôi món thật ra, dù tên thật chẳng dính chữ
     nào với từ khoá (tài liệu 24, phần 3). */
  const aliasHits = useMemo(() => {
    const out = new Set();
    if (!search.trim()) return out;
    for (const nt of custNotes) {
      if (nt.product_id && match(nt.alias, search)) out.add(nt.product_id);
    }
    return out;
  }, [custNotes, search]);

  const filtered = useMemo(() => {
    if (!products) return [];
    let list = products;
    /* Chọn nhóm cha thì lấy cả hàng của nhóm con cháu; chọn nhiều nhóm thì
       lấy hàng thuộc một trong các nhóm (xem PosCatalog.jsx) */
    if (catSet) list = list.filter((p) => catSet.has(p.category_id));
    if (search.trim()) {
      /* Kiểu tìm do thu ngân chọn: "chính xác" khi quét mã, "có chứa" khi
         gõ một khúc tên (tài liệu 13, mục 2.1) */
      list = list.filter((p) =>
        aliasHits.has(p.id)
        || matchMode(p.name, search, searchMode) || matchMode(p.alias || '', search, searchMode)
        || matchMode(p.sku, search, searchMode) || matchMode(p.brand || '', search, searchMode)
        || (searchMode === 'exact'
          ? (p.barcode || '') === search.trim()
          : (p.barcode || '').includes(search.trim())));
    }

    /* Thứ tự lưới, xếp theo mức ưu tiên giảm dần:
         1. món ĐANG NẰM TRONG GIỎ — bốc thẳng lên đầu, thắng cả hàng ghim
            (tài liệu 22, mục 4.2): thợ nhìn ngay lên đầu màn hình đối chiếu
            thông số rồi đi cắt hàng, khỏi cuộn tìm lại. Bỏ khỏi giỏ thì món
            tự trả về chỗ cũ.
         2. hàng / nhóm hàng chủ tiệm GHIM đầu lưới theo mùa (tài liệu 14)
         3. món khách đang chọn TỪNG MUA — câu hỏi kế tiếp bao giờ cũng là
            "lần trước tôi lấy cái nào"
       Chỉ đổi THỨ TỰ, không lọc bớt: món khác vẫn còn nguyên ở dưới. */
    const rank = (p) => {
      /* Món khách vừa gọi bằng tên riêng của họ lên trên cùng, đè cả hàng
         ghim mùa vụ lẫn món đang trong giỏ (tài liệu 24, phần 3). Quy tắc
         này CỐ Ý không có công tắc: nó chỉ bật khi khách đó có ghi chú
         riêng, và đó đúng là lúc nó hữu ích nhất (plan 31, mục 3.2). */
      if (aliasHits.has(p.id)) return -2;
      if (cartTop && inCartQty.get(p.id)) return -1;
      return pinOn ? (p.featured_rank ?? 9999) : 9999;
    };
    const seen = (p) => (boughtTop && priceHist?.[p.id] ? 0 : 1);
    const hasFeatured = pinOn
      && list.some((p) => p.featured_rank !== null && p.featured_rank !== undefined);
    if (hasFeatured || aliasHits.size > 0 || (cartTop && inCartQty.size > 0)
        || (boughtTop && priceHist && Object.keys(priceHist).length)) {
      list = [...list].sort((a, b) => rank(a) - rank(b) || seen(a) - seen(b));
    }
    return list;
  }, [products, catSet, search, searchMode, priceHist, pinOn, inCartQty, aliasHits,
    cartTop, boughtTop]);

  /**
   * Lưới vẽ theo Ô, không theo mặt hàng: một mặt hàng khai nhiều ĐƠN VỊ BÁN
   * CHÍNH thì có bấy nhiêu ô, mỗi ô bán theo một đơn vị (tài liệu 16, mục 2.1).
   * Mặt hàng chỉ có một đơn vị bán chính thì vẫn đúng một ô như trước.
   */
  /* Có bao nhiêu món đang nằm trong danh sách ghim — để vẽ công tắc */
  const pinnedCount = useMemo(
    () => (products || []).filter((x) => x.featured_rank !== null && x.featured_rank !== undefined).length,
    [products]);

  const tiles = useMemo(() => {
    const out = [];
    for (const p of filtered) {
      const mains = (p.units || []).filter((u) => u.is_sell_main);
      if (mains.length > 1) {
        for (const u of mains) out.push({ key: `${p.id}:${u.id}`, p, unit: u });
      } else {
        out.push({ key: `${p.id}`, p, unit: null });
      }
    }
    return out;
  }, [filtered]);

  /**
   * Phân biệt QUÉT với GÕ TAY bằng tốc độ (plan 31, mục 3.3).
   *
   * Máy quét bắn cả chuỗi trong vài chục mili giây rồi Enter. Trước đây quét
   * trượt thì ô tìm KHÔNG được xoá, nên lần quét sau nối vào chuỗi cũ thành
   * chuỗi rác — lại không khớp, lại không xoá, cứ thế dồn lại.
   */
  const typing = useRef({ startedAt: 0, chars: 0 });
  const onSearchType = (v) => {
    const now = Date.now();
    /* Ô đang trống mà có chữ vào là bắt đầu một lượt mới */
    if (!search) typing.current = { startedAt: now, chars: 0 };
    typing.current.chars += 1;
    setSearch(v);
  };
  const looksScanned = (term) => {
    const t = typing.current;
    if (term.length < 4 || !t.startedAt) return false;
    /* Trung bình dưới 50ms một ký tự thì tay người không gõ kịp */
    return (Date.now() - t.startedAt) / term.length < 50;
  };

  /** Món mang ĐÚNG mã này — mã vạch hoặc mã hàng, không tìm gần đúng. */
  const findByCode = (term) => products?.find(
    (p) => p.barcode === term || p.sku.toLowerCase() === term.toLowerCase(),
  );

  /**
   * Camera điện thoại đọc được một mã. Cùng luật với máy quét cầm tay: khớp
   * trọn mã thì vào giỏ của CHÍNH máy này, không vơ món gần đúng. Trả kết
   * quả về cho màn hình quét tự báo — không bắn toast, vì toast nằm dưới
   * lớp camera, người quét không thấy.
   */
  const scanCode = (code) => {
    const term = String(code || '').trim();
    const exact = term ? findByCode(term) : null;
    if (!exact) return { kind: 'missing', code: term };
    if (exact.track_stock && exact.stock <= 0) return { kind: 'out', code: term, product: exact };
    addToCart(exact);
    return { kind: 'added', code: term, product: exact };
  };

  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return;
    const term = search.trim();
    if (!term) return;
    const scanned = looksScanned(term);
    const exact = findByCode(term);
    /* Quét mã vạch luôn khớp trọn, không phụ thuộc kiểu tìm đang chọn */
    if (exact) {
      if (exact.track_stock && exact.stock <= 0) toast(`"${exact.name}" đã hết hàng trong kho`, 'warn');
      else addToCart(exact);
      setSearch('');              // hết hàng cũng phải xoá, để quét tiếp được
      return;
    }
    if (scanned) {
      /* Đã là quét thì phải khớp trọn mã — không được vơ đại món đầu lưới */
      toast(`Không có hàng nào mang mã "${term}"`, 'warn', 5000);
      setSearch('');
      return;
    }
    /* Gõ tay: Enter lấy MÓN ĐẦU LƯỚI, không đòi phải còn đúng một kết quả */
    if (filtered.length) {
      const first = filtered[0];
      addToCart(first);
      setSearch('');
      if (filtered.length > 1) toast(`Đã thêm "${first.name}"`, 'ok', 3000);
      return;
    }
    toast(`Không tìm thấy hàng nào khớp "${term}"`, 'warn');
    setSearch('');
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
    if (lineCount(t)) { setClosing(t); return; }
    dropTab(id);
  };

  /* ------------------------------ Phím tắt ------------------------------- */

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === 'F4') { e.preventDefault(); if (lineCount(tab)) setPayOpen(true); }
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
    if (!lineCount(tab)) { toast('Giỏ hàng đang trống, chưa có gì để lưu.', 'warn'); return; }
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
        item_count: lineCount(tab),
        payload: {
          cart: tab.cart, discountType: tab.discountType, discountValue: tab.discountValue,
          note: tab.note, isVat: tab.isVat, delivery: tab.delivery, buyer: tab.buyer,
          /* Hàng mua hộ vãng lai: trước đây KHÔNG lưu, mở lại đơn tạm là mất
             sạch. Giá bốc hàng ghi dưới tên "pickup_cost" — máy chủ cắt mọi
             khoá tên "cost" khỏi dữ liệu trả cho người không xem được giá vốn,
             mà thu ngân mở lại đơn vẫn cần đúng giá mình đã bốc để chốt đơn. */
          consign: (tab.consign || []).map(({ cost, ...c }) => ({ ...c, pickup_cost: Number(cost) || 0 })),
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
    if (!p.cart?.length && !p.consign?.length) {
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
      cart: p.cart || [],
      customerId: full.customer_id,
      buyer: p.buyer || null,
      discountType: p.discountType || 'amount',
      discountValue: p.discountValue || 0,
      note: p.note || '',
      isVat: !!p.isVat,
      delivery: p.delivery || null,
      consign: Array.isArray(p.consign)
        ? p.consign.map(({ pickup_cost: pickup, ...c }) => ({ ...c, cost: Number(pickup ?? c.cost) || 0 }))
        : [],
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
    /* Hàng mua hộ vãng lai (tài liệu 24, phần 5.1) */
    consign_items: (tab.consign || []).map((c) => ({
      partner_id: c.partner_id || null,
      name: c.name,
      unit_name: c.unit_name || null,
      qty: c.qty,
      price: c.price,
      cost: c.partner_id ? 0 : (c.cost || 0),
      commission_type: c.commission_type || 'amount',
      commission_value: c.commission_value || 0,
      note: c.note || null,
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
    /* Đếm lại nợ quá hạn: bán nợ xong mà khách vừa chạm mốc trễ hạn thì nút
       phải hiện ra ngay, không đợi tải lại trang. */
    reloadOverdue();
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
    /* Hoá đơn tạm tính cũng phải có hàng mua hộ, không thì khách nhìn thiếu tiền */
    consign_items: (tab.consign || []).map((c, i) => ({
      id: i, name: c.name, unit_name: c.unit_name, qty: c.qty, price: c.price,
      amount: Math.round((Number(c.qty) || 0) * (Number(c.price) || 0)),
    })),
    returns: [],
  });

  /* ---------------- Thanh vạch co giãn lưới | giỏ (tài liệu 24, phần 6) ----
     Kéo tới đâu thì NHẢY VỀ CẤP GẦN NHẤT ngay, không để tỉ lệ tự do: bốn cấp
     là bốn tư thế làm việc, kéo trúng 63% hay 58% chẳng khác gì nhau mà lần
     sau mở máy lại ra một con số lạ. */
  const splitRowRef = useRef(null);
  const split = SPLIT_LEVELS[splitLevel] || SPLIT_LEVELS[0];
  const cartTiny = split.grid >= 85;          // giỏ thu thành thanh dọc
  const gridHidden = split.grid <= 0;

  const nearestLevel = (pct) => {
    let best = 0;
    for (let i = 1; i < SPLIT_LEVELS.length; i += 1) {
      if (Math.abs(SPLIT_LEVELS[i].grid - pct) < Math.abs(SPLIT_LEVELS[best].grid - pct)) best = i;
    }
    return best;
  };

  useEffect(() => {
    if (!dragging) return undefined;
    const move = (e) => {
      const box = splitRowRef.current?.getBoundingClientRect();
      if (!box || box.width <= 0) return;
      const x = (e.touches?.[0]?.clientX ?? e.clientX) - box.left;
      setSplitLevel(nearestLevel(Math.max(0, Math.min(100, x / box.width * 100))));
    };
    const stop = () => setDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('mouseup', stop);
    window.addEventListener('touchend', stop);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('touchend', stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

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

        {/* Đẩy ra / thu vào bảng lọc nhóm hàng cạnh trái (tài liệu 22, mục 1) */}
        <button
          type="button"
          onClick={() => setCatDrawer((v) => !v)}
          aria-pressed={catDrawer}
          title={catDrawer
            ? 'Thu bảng lọc nhóm hàng lại, lưới hàng rộng ra tối đa'
            : 'Đẩy bảng lọc nhóm hàng ra, lưới hàng hẹp lại một phần'}
          className={`h-9 px-2.5 rounded border text-[13px] font-semibold hidden md:flex items-center gap-1.5
                      transition-colors duration-150 cursor-pointer shrink-0
                      ${catDrawer
                        ? 'bg-emerald-500/25 border-emerald-400/50 text-emerald-100'
                        : 'bg-white/10 border-white/15 text-slate-300 hover:text-white'}`}
        >
          <FolderTree size={14} aria-hidden="true" />
          Nhóm hàng
          {pickedCats.length > 0 && <span className="tabular">({n(pickedCats.length)})</span>}
        </button>

        <div className="flex-1 max-w-xl mx-2">
          <div className="relative">
            <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              ref={searchRef}
              className={`w-full h-9 rounded bg-white/10 text-white placeholder:text-slate-400 pl-8 ${touch ? 'pr-[108px]' : 'pr-16'}
                         border border-white/15 focus:bg-white focus:text-ink focus:placeholder:text-slate-400
                         focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40
                         transition-colors duration-150 text-[13px]`}
              placeholder={touch ? 'Tìm hàng...' : 'Quét mã vạch, gõ tên hàng hoặc tên phụ...'}
              aria-label="Tìm hàng hoá hoặc quét mã vạch"
              value={search}
              onChange={(e) => onSearchType(e.target.value)}
              onKeyDown={onSearchKey}
              autoFocus
            />
            {/* Chọn kiểu tìm ngay cạnh ô (tài liệu 13, mục 2.1) */}
            <button
              type="button"
              onClick={() => setSearchMode(searchMode === 'exact' ? 'contains' : 'exact')}
              aria-pressed={searchMode === 'exact'}
              title={searchMode === 'exact'
                ? 'Đang tìm CHÍNH XÁC — chỉ ra món khớp trọn từ khoá. Bấm để đổi sang tìm có chứa.'
                : 'Đang tìm CÓ CHỨA — ra mọi món chứa từ khoá. Bấm để đổi sang tìm chính xác.'}
              className={`absolute ${touch ? 'right-11' : 'right-10'} top-1/2 -translate-y-1/2 text-2xs font-semibold rounded
                          px-1.5 py-0.5 border cursor-pointer transition-colors duration-100
                          ${searchMode === 'exact'
                            ? 'bg-emerald-500/25 border-emerald-400/50 text-emerald-100'
                            : 'bg-white/10 border-white/20 text-slate-300 hover:text-white'}`}
            >
              {searchMode === 'exact' ? 'Chính xác' : 'Có chứa'}
            </button>
            {touch ? (
              <button
                type="button"
                onClick={() => { primeAudio(); setCamOpen(true); }}
                className="absolute right-0.5 top-1/2 -translate-y-1/2 w-10 h-8 rounded flex items-center justify-center
                           bg-emerald-500/25 border border-emerald-400/50 text-emerald-100
                           active:bg-emerald-500/40 cursor-pointer"
                aria-label="Quét mã vạch bằng camera điện thoại"
                title="Quét mã vạch bằng camera"
              >
                <Camera size={18} aria-hidden="true" />
              </button>
            ) : (
              <span className="kbd absolute right-2 top-1/2 -translate-y-1/2 !bg-white/15 !text-slate-300 !border-white/20">F2</span>
            )}
          </div>
        </div>

        <OrderBell onOpen={() => setPickOrderOpen(true)} />
        <DeliveryBell onOpen={() => setBoardOpen(true)} />
        {/* Chỗ sát ô tìm hàng: nút NỢ QUÁ HẠN của cả tiệm.
            Nút Thu nợ trên thanh này đã bỏ hẳn: chưa chọn khách thì nó mờ,
            mà chọn khách có nợ rồi thì dòng nhắc nợ trong giỏ đã có sẵn nút
            thu — để thêm một nút nữa chỉ tổ bấm nhầm. */}
        <OverdueDebtsButton rows={overdue} onOpen={() => setOverdueOpen(true)} />

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

      <PosCameraScan
        open={camOpen}
        onClose={() => setCamOpen(false)}
        onDone={() => { setCamOpen(false); setShowGrid(false); }}
        onCode={scanCode}
        onAddMore={(p) => addToCart(p)}
        cart={tab.cart}
      />

      {/* ---------------------------- Thanh tab đơn hàng --------------------- */}
      <div className="bg-slate-800 flex items-stretch gap-0.5 px-2 shrink-0 overflow-x-auto no-print"
        role="tablist" aria-label="Các đơn hàng đang mở">
        {tabs.map((t) => {
          const active = t.id === activeId;
          const count = lineCount(t);
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
        {/* Nút "Đổi trả hàng" cũ đã dời vào trong danh sách này (plan 31, 1.1c):
            tìm đúng hoá đơn rồi đổi trả ngay trong khung chi tiết */}
        {can('sale.view') && (
          <button onClick={() => setDayOpen(true)} className={barBtn} aria-label="Hoá đơn trong ngày"
            title="Hoá đơn bán trong ngày — xem chi tiết, in lại, đổi trả hàng">
            <ReceiptText size={14} aria-hidden="true" />
            <span className="hidden sm:inline">HĐ trong ngày</span>
          </button>
        )}
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

      <div className="flex-1 flex min-h-0" ref={splitRowRef}>
        {/* ------------- Bảng lọc nhóm hàng trượt cạnh trái (tài liệu 22) --- */}
        <CategoryDrawer
          open={catDrawer}
          onToggle={() => setCatDrawer((v) => !v)}
          categories={meta.categories}
          selected={pickedCats}
          onToggleCat={(id) => setPickedCats((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))}
          onClear={() => setPickedCats([])}
          shown={filtered.length}
          total={products?.length || 0}
          className={showGrid ? '' : 'hidden lg:flex'}
        />

        {/* ------------------------- Lưới chọn hàng ------------------------ */}
        <section
          /* Bề ngang theo cấp co giãn đang chọn; màn hình nhỏ thì vẫn một cột
             một màn như cũ, không chia đôi. */
          style={{ flexBasis: `${split.grid}%` }}
          className={`min-w-0 flex flex-col grow shrink basis-0
                      ${gridHidden ? 'hidden' : ''} ${showGrid ? '' : 'hidden lg:flex'}`}
        >
          <GridToolbar
            shown={filtered.length}
            total={products?.length || 0}
            filtering={pickedCats.length > 0}
            extra={<>
              {/* Công tắc ma trận nấc giá sỉ (tài liệu 22, mục 1). Nút [Tự áp
                  giá nấc] chỉ hiện khi đang bật ma trận — quầy bán lẻ thuần
                  thì không phải nhìn nút thừa. */}
              <button
                type="button"
                onClick={() => setTierOn((v) => !v)}
                aria-pressed={tierOn}
                title={tierOn
                  ? 'Đang hiện nấc giá sỉ dưới mỗi ô hàng. Bấm để thu gọn, ô hàng về một giá bán lẻ.'
                  : 'Ô hàng đang hiện một giá bán lẻ. Bấm để bung ma trận nấc giá sỉ theo số lượng.'}
                className={`h-8 px-2 rounded border text-2xs font-semibold inline-flex items-center gap-1
                            cursor-pointer transition-colors duration-100 shrink-0
                            ${tierOn
                              ? 'bg-indigo-100 border-indigo-400 text-indigo-900'
                              : 'bg-card border-line text-muted-ink hover:text-ink'}`}
              >
                <Layers size={12} aria-hidden="true" />
                Nấc giá sỉ {tierOn ? 'đang hiện' : 'đang ẩn'}
              </button>
              {tierOn && (
                <button
                  type="button"
                  onClick={() => setTierAuto((v) => !v)}
                  aria-pressed={tierAuto}
                  title={tierAuto
                    ? 'Sửa số lượng trong giỏ thì đơn giá tự nhảy về nấc tương ứng. Bấm để khoá lại.'
                    : 'Đơn giá đang giữ nguyên khi đổi số lượng. Bấm để cho giá tự nhảy theo nấc.'}
                  className={`h-8 px-2 rounded border text-2xs font-semibold inline-flex items-center gap-1
                              cursor-pointer transition-colors duration-100 shrink-0
                              ${tierAuto
                                ? 'bg-indigo-600 border-indigo-700 text-white'
                                : 'bg-card border-line text-muted-ink hover:text-ink'}`}
                >
                  <Zap size={12} aria-hidden="true" className={tierAuto ? 'fill-white' : ''} />
                  Tự áp giá nấc {tierAuto ? 'bật' : 'tắt'}
                </button>
              )}
              {/* Bốn quy tắc xếp lưới gộp vào một bảng (plan 31, mục 3.2) */}
              <GridSortPanel
                boughtTop={boughtTop}
                onBoughtTop={setBoughtTop}
                cartTop={cartTop}
                onCartTop={setCartTop}
                pinOn={pinOn}
                onPinOn={setPinOn}
                pinnedCount={pinnedCount}
                hideUntilSearch={hideGrid}
                onHideUntilSearch={setHideGrid}
                hasCustomer={!!customer}
              />
            </>}
          />

          <div ref={gridRef} className="flex-1 overflow-y-auto p-3">
            {busy ? <Spinner label="Đang tải hàng hoá..." />
              /* Chế độ ẩn lưới: chỉ vẽ khi đã gõ tìm hoặc đã lọc nhóm hàng.
                 Chọn nhóm cũng là một ý muốn xem hàng, nên tính luôn. */
              : hideGrid && !search.trim() && !catSet ? (
                <Empty
                  icon={Search}
                  title="Lưới hàng đang ẩn"
                  message="Quét mã vạch hoặc gõ tên hàng ở ô tìm kiếm để hiện hàng ra.
                           Mở bảng Sắp xếp lưới để bỏ chế độ này."
                  action={<Button onClick={() => searchRef.current?.focus()}>Gõ tìm hàng</Button>}
                />
              )
              : filtered.length === 0 ? (
                <Empty
                  icon={Package}
                  title="Không có hàng nào khớp"
                  message={search
                    ? `Không tìm thấy "${search}". Thử gõ tên khác, tên phụ, hoặc bỏ bớt bộ lọc nhóm hàng.`
                    : 'Nhóm hàng đang chọn chưa có sản phẩm.'}
                  action={search
                    ? <Button onClick={() => setSearch('')}>Xoá từ khoá</Button>
                    : catSet ? <Button onClick={() => setPickedCats([])}>Bỏ lọc nhóm</Button> : null}
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
                    items={tiles}
                    rootRef={gridRef}
                    resetKey={`${tab.id}|${search}|${pickedCats.join(',')}|${tab.customerId || ''}|${pinOn}`}
                    /* Số cột tự nhảy theo BỀ RỘNG CÒN LẠI của lưới, không theo
                       bề rộng màn hình: đẩy bảng lọc ra thì lưới hẹp lại và bớt
                       cột ngay, không bị tràn ngang (tài liệu 22, mục 2.1). */
                    /* Ô rộng tối thiểu 220px rồi tự nở đều kín hàng (tài liệu 24,
                       phần 2): bật thêm nấc giá sỉ hay giá quy đổi thì ô cao
                       lên chứ chữ không bị gãy dòng hay đè lên nhau. */
                    className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(13.75rem,1fr))]"
                    renderItem={(t) => (
                      <ProductTile key={t.key} p={t.p} unit={t.unit} priceListId={tab.priceListId}
                        showCost={maySeeCost && showCost} onPick={addToCart}
                        inCart={inCartQty.get(t.p.id) || 0}
                        bought={priceHist?.[t.p.id]?.[0] || null}
                        showUnits={showUnitPicker}
                        showConverted={showConvertedPrice}
                        showTiers={tierOn}
                        blindKeys={blindOn ? blindKeys : null}
                        alias={noteByProduct.get(t.p.id) || null}
                        line={lineByKey.get(`${t.p.id}:${sellUnitOf(t.p, t.unit)?.id}`) || null}
                        onInfo={setInfoOf}
                        onHover={setHoverPid} />
                    )}
                  />
                </>
              )}
          </div>
        </section>

        {/* --------- Thanh vạch kéo co giãn lưới | giỏ (tài liệu 24, phần 6) --- */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`Cấp co giãn giỏ hàng: ${split.label}`}
          aria-valuenow={splitLevel + 1}
          aria-valuemin={1}
          aria-valuemax={SPLIT_LEVELS.length}
          tabIndex={0}
          title={`${split.label} — ${split.hint}. Kéo ngang hoặc bấm để đổi cấp; mũi tên trái/phải cũng được.`}
          onMouseDown={() => setDragging(true)}
          onTouchStart={() => setDragging(true)}
          onClick={() => setSplitLevel((v) => (v + 1) % SPLIT_LEVELS.length)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); setSplitLevel((v) => (v + SPLIT_LEVELS.length - 1) % SPLIT_LEVELS.length); }
            if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
              e.preventDefault(); setSplitLevel((v) => (v + 1) % SPLIT_LEVELS.length);
            }
          }}
          className={`hidden lg:flex w-3 shrink-0 items-center justify-center cursor-col-resize
                      border-l border-line select-none touch-none
                      focus:outline-none focus:ring-2 focus:ring-accent/60
                      transition-colors duration-100
                      ${dragging ? 'bg-accent/30' : 'bg-muted hover:bg-accent-soft'}`}
        >
          <GripVertical size={12} className="text-muted-ink" aria-hidden="true" />
        </div>

        {/* ---------------------------- Giỏ hàng --------------------------- */}
        <aside
          style={{ flexBasis: `${100 - split.grid}%` }}
          className={`w-full grow shrink basis-0 lg:w-auto lg:min-w-0 bg-card border-l border-line
                      flex flex-col ${showGrid && !gridHidden ? 'hidden lg:flex' : 'flex'}`}>
          {cartTiny ? (
            /* Cấp 4: giỏ thu thành thanh dọc — chỉ số liệu tổng và ba nút cốt
               lõi, vẫn chốt được đơn ngay tại chỗ (tài liệu 24, phần 6). */
            <div className="flex-1 min-h-0 flex flex-col p-1.5 gap-2 overflow-y-auto text-center">
              <button
                type="button"
                onClick={() => setSplitLevel(0)}
                className="btn btn-sm btn-outline !px-1 w-full"
                title="Mở rộng giỏ hàng trở lại"
              >
                <Maximize2 size={13} aria-hidden="true" />
              </button>
              <div className="rounded border border-line bg-muted/50 py-1.5">
                <div className="text-2xs text-muted-ink">Số món</div>
                <div className="text-lg font-bold tabular">{n(totals.count)}</div>
              </div>
              <div className="rounded border border-line bg-muted/50 py-1.5">
                <div className="text-2xs text-muted-ink">Tổng tiền</div>
                <div className="text-[13px] font-bold tabular text-accent break-words leading-tight">
                  {money(totals.total)}
                </div>
              </div>
              <div className="rounded border border-line bg-muted/50 py-1.5">
                <div className="text-2xs text-muted-ink">Khách trả</div>
                <div className="text-[13px] font-semibold tabular break-words leading-tight">
                  {money(totals.total)}
                </div>
              </div>
              {customer && (
                <div className="text-2xs text-muted-ink break-words leading-tight">{customer.name}</div>
              )}
              <div className="flex-1" />
              <button onClick={() => setPayOpen(true)} disabled={!totals.count}
                className="btn btn-primary btn-sm w-full flex-col !gap-0 !py-2 !px-1"
                title="Thanh toán và in nhanh (F4)">
                <Wallet size={15} aria-hidden="true" />
                <span className="text-2xs font-bold">TT</span>
              </button>
              <button onClick={saveDraft} disabled={!lineCount(tab)}
                className="btn btn-outline btn-sm w-full flex-col !gap-0 !py-2 !px-1"
                title="Lưu tạm đơn đang chờ">
                <Save size={15} aria-hidden="true" />
                <span className="text-2xs">Lưu</span>
              </button>
              <button onClick={clearTab} disabled={!totals.count}
                className="btn btn-outline btn-sm w-full flex-col !gap-0 !py-2 !px-1 !text-danger"
                title="Xoá trắng đơn đang lập">
                <X size={15} aria-hidden="true" />
                <span className="text-2xs">Huỷ</span>
              </button>
            </div>
          ) : (
          <>
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
                  filter={matchCustomer}
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
              {/* Ghi chú hàng đặc thù của khách này (tài liệu 24, phần 3) */}
              {notesOn && customer && custNotes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setNotesOpen(true)}
                  title={`${customer.name} có ${custNotes.length} ghi chú hàng đặc thù — bấm để xem`}
                  aria-label={`Xem ${custNotes.length} ghi chú hàng đặc thù của ${customer.name}`}
                  className="btn btn-sm btn-outline !px-1.5 !text-amber-800 !border-amber-400 shrink-0"
                >
                  <ClipboardList size={14} aria-hidden="true" />
                  <span className="tabular text-2xs">{n(custNotes.length)}</span>
                </button>
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
              aside={consignOn && (
                /* Nút món mua hộ thu nhỏ thành dòng chữ (plan 31, 1.2a) — trước là
                   một thanh tím to lúc nào cũng chiếm chỗ trong giỏ hàng */
                <button
                  type="button"
                  onClick={() => setConsignOpen(true)}
                  className="inline-flex items-center gap-1 text-[13px] font-semibold text-violet-700
                             hover:text-violet-900 hover:underline cursor-pointer min-h-[28px] rounded
                             focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500"
                  title="Khách hỏi món tiệm không có sẵn: bốc ngoài bán chênh lệch, hoặc bán giùm hàng người khác gửi"
                >
                  <Plus size={14} aria-hidden="true" /> Món mua hộ
                  {(tab.consign || []).length > 0 && (
                    <span className="tabular text-2xs rounded bg-violet-100 px-1">{n(tab.consign.length)}</span>
                  )}
                </button>
              )}
            />
            {/* Nhắc đòi nợ ngay lúc còn gặp mặt khách, không đợi tới lúc thanh toán */}
            <CustomerDebtBanner customer={customer} onCollect={() => setDebtOpen(true)} />

            {/* Khách này còn đơn lưu tạm chưa xử (plan 31, hạng mục 7b) */}
            {draftsOfCustomer.length > 0 && (
              <button
                type="button"
                onClick={() => setDraftsOpen(true)}
                className="mt-1.5 w-full flex items-start gap-1.5 text-left rounded border
                           border-warn/40 bg-amber-50 px-2 py-1.5 text-2xs text-amber-900
                           cursor-pointer hover:bg-amber-100 transition-colors duration-150"
              >
                <AlertTriangle size={12} className="shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  <b>{customer?.name}</b> còn {n(draftsOfCustomer.length)} đơn lưu tạm chưa xử
                  {draftsOfCustomer[0]?.code ? ` (${draftsOfCustomer[0].code})` : ''} — bấm để mở ra xem
                  trước khi lập đơn mới.
                </span>
              </button>
            )}
          </div>

          {/* Các dòng hàng */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {/* Hàng mua hộ vãng lai — nằm trên cùng cho dễ soát (tài liệu 24) */}
            {/* Có dòng mua hộ là hiện, kể cả khi tiệm đã tắt tính năng — không để
                món bị tính tiền mà người đứng quầy không nhìn thấy */}
            {(tab.consign || []).length > 0 && (
              <ul className="divide-y divide-line bg-violet-50/40">
                {tab.consign.map((c) => (
                  <ConsignLine
                    key={c.key}
                    c={c}
                    partners={partners || []}
                    onChange={(patch) => updateConsign(c.key, patch)}
                    onRemove={() => removeConsign(c.key)}
                  />
                ))}
              </ul>
            )}
            {tab.cart.length === 0 && (tab.consign || []).length === 0 ? (
              <Empty
                icon={ShoppingCart}
                title="Chưa chọn hàng"
                message="Quét mã vạch, gõ tên hàng ở ô tìm kiếm, hoặc bấm vào ô hàng bên trái."
              />
            ) : tab.cart.length === 0 ? null : (
              <ul className="divide-y divide-line">
                {tab.cart.map((l) => (
                  <CartLine
                    key={l.key}
                    l={l}
                    highlight={hoverPid === l.product_id}
                    lineRef={hoverPid === l.product_id ? hoverLineRef : null}
                    hist={priceHist[l.product_id]}
                    showCost={maySeeCost && showCost}
                    onQty={(q) => setQty(l, q)}
                    tier={tierOn ? tierOf(l) : null}
                    alias={notesOn ? (noteByProduct.get(l.product_id) || null) : null}
                    onWarranty={() => setWarrantyOf(l)}
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
              {totals.consignCount > 0 && (
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-violet-800 flex items-center gap-1">
                    <Handshake size={12} aria-hidden="true" />
                    Hàng mua hộ ({n(totals.consignCount)} món)
                  </span>
                  <span className="tabular font-mono font-semibold">{money(totals.consign)}</span>
                </div>
              )}
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
              <button onClick={saveDraft} disabled={!lineCount(tab)}
                className="btn btn-sm btn-outline flex-col !gap-0.5 !py-1.5 text-2xs"
                title="Lưu đơn này vào danh sách lưu tạm và đóng tab">
                <Save size={14} aria-hidden="true" />
                Lưu tạm
              </button>
              <button onClick={() => setProvisional(buildProvisional())} disabled={!totals.count}
                className="btn btn-sm btn-outline flex-col !gap-0.5 !py-1.5 text-2xs">
                <Printer size={14} aria-hidden="true" />
                Tạm tính
              </button>
              <button onClick={clearTab} disabled={!totals.count}
                className="btn btn-sm btn-outline flex-col !gap-0.5 !py-1.5 text-2xs !text-danger">
                <X size={14} aria-hidden="true" />
                Xoá hết
              </button>
            </div>

            <Button variant="primary" size="lg" className="w-full"
              disabled={!totals.count} onClick={() => setPayOpen(true)}>
              {tab.delivery ? 'Thanh toán đơn giao' : 'Thanh toán'}
              <span className="kbd !bg-white/20 !text-white !border-white/25 ml-1">F4</span>
            </Button>
          </div>
          </>
          )}
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
        canPay={lineCount(tab) > 0}
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
        onDone={(res) => { reloadCustomers(); reloadOverdue(); showVoucher(res?.transaction?.id); }}
      />

      {/* Thêm một món mua hộ vãng lai vào giỏ (tài liệu 24, phần 5.1) */}
      <ConsignItemModal
        open={consignOpen}
        customer={customer}
        partners={partners || []}
        onClose={() => setConsignOpen(false)}
        onPartnerAdded={reloadPartners}
        onSave={(row) => { addConsign(row); setConsignOpen(false); }}
      />

      {/* Ghi chú hàng đặc thù của khách đang chọn (tài liệu 24, phần 3) */}
      <CustomerNotesModal
        open={notesOpen}
        customer={customer}
        notes={custNotes}
        onClose={() => setNotesOpen(false)}
        onPick={(nt) => {
          const p = products?.find((x) => x.id === nt.product_id);
          if (p) { addToCart(p); setNotesOpen(false); }
          else toast('Ghi chú này chưa nối với mặt hàng nào trong kho.', 'warn');
        }}
      />

      {/* Bảng nợ quá hạn cả tiệm, mở từ nút cạnh ô tìm hàng */}
      <OverdueDebtsModal
        open={overdueOpen}
        rows={overdue}
        busy={overdueBusy}
        error={overdueErr}
        onReload={reloadOverdue}
        onClose={() => setOverdueOpen(false)}
        onCollect={(id) => { setOverdueOpen(false); setDebtFor(id); }}
      />

      {/* Thu nợ của một khách chọn từ bảng nợ quá hạn — không đụng tới khách
          của tab đang bán dở */}
      <DebtCollectModal
        open={!!debtFor}
        customerId={debtFor}
        onClose={() => setDebtFor(null)}
        onDone={(res) => { reloadCustomers(); reloadOverdue(); showVoucher(res?.transaction?.id); }}
      />

      {/* Ảnh và mô tả hàng hoá để tư vấn nhanh (tài liệu 13, mục 3.1) */}
      {infoOf && (
        <ProductInfoModal
          product={infoOf}
          priceListId={tab.priceListId}
          onClose={() => setInfoOf(null)}
        />
      )}

      <PosDayInvoices
        open={dayOpen}
        onClose={() => setDayOpen(false)}
        onExchange={(sale) => { setDayOpen(false); setExchangeOpen({ sale }); }}
        onQuickExchange={() => { setDayOpen(false); setExchangeOpen(true); }}
      />

      <ExchangeModal
        open={!!exchangeOpen}
        sale={exchangeOpen?.sale || null}
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
            "{closing.title}" đang có <b>{lineCount(closing)} mặt hàng</b> chưa thanh toán. Đóng tab là mất
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
        customer={notesOn ? customer : null}
        alias={noteOf ? (noteByProduct.get(noteOf.product_id) || null) : null}
        onClose={() => setNoteOf(null)}
        onSave={(patch) => { updateLine(noteOf.key, patch); setNoteOf(null); }}
        onNotesChanged={loadNotes}
      />

      <LineWarrantyModal
        line={warrantyOf}
        onClose={() => setWarrantyOf(null)}
        onSave={(patch) => { updateLine(warrantyOf.key, patch); setWarrantyOf(null); }}
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

/* ==================================================================== *
 * MỘT DÒNG HÀNG MUA HỘ VÃNG LAI TRONG GIỎ (tài liệu 24, phần 5.1)
 *
 * Nhìn là biết ngay hàng của ai: có tên chủ hàng thì nhãn tím kèm số tiền
 * phải trả lại chủ; không có tên thì tiệm tự bốc ngoài, hiện luôn phần
 * chênh lệch ăn được.
 *
 * Hoá đơn in cho khách KHÔNG có mấy dòng này — xem mẫu in.
 * ==================================================================== */
function ConsignLine({ c, partners, onChange, onRemove }) {
  const amount = Math.round((Number(c.qty) || 0) * (Number(c.price) || 0));
  const commission = consignCommission(c, amount);
  const payable = amount - commission;
  const margin = amount - Math.round((Number(c.qty) || 0) * (Number(c.cost) || 0));
  const partner = c.partner_id ? partners.find((x) => x.id === c.partner_id) : null;

  return (
    <li className="p-2.5 border-l-4 border-violet-500">
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-snug">{c.name}</div>
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <span className="text-2xs font-semibold text-violet-800 bg-violet-100 border border-violet-300
                             rounded px-1 leading-5 inline-flex items-center gap-0.5">
              <Handshake size={10} aria-hidden="true" />
              {partner || c.partner_id
                ? `Hàng gửi: ${partner?.name || c.partner_name || 'chủ hàng'}`
                : 'Tiệm tự bốc ngoài'}
            </span>
            {c.partner_id ? (
              <span className="text-2xs text-muted-ink tabular">
                Trả chủ {n(payable)}
                {commission > 0 && <span className="text-emerald-700 font-semibold"> · hoa hồng {n(commission)}</span>}
              </span>
            ) : (
              <span className="text-2xs tabular">
                Bốc {n(c.cost)}/{c.unit_name || 'đv'}
                <span className={`ml-1 font-semibold ${margin < 0 ? 'text-danger' : 'text-emerald-700'}`}>
                  chênh {n(margin)}
                </span>
              </span>
            )}
          </div>
          {c.note && <div className="text-2xs text-muted-ink italic mt-0.5">{c.note}</div>}
        </div>
        <IconButton icon={Trash2} size={14} label={`Bỏ ${c.name} khỏi giỏ`}
          className="!text-danger hover:!bg-red-50" onClick={onRemove} />
      </div>

      <div className="flex items-center gap-1.5 mt-1.5">
        <input
          type="number" step="any" min="0"
          className="w-16 h-7 text-center text-[13px] tabular font-mono border border-line rounded
                     focus:outline-none focus:bg-accent-soft/50"
          aria-label={`Số lượng ${c.name}`}
          value={c.qty}
          onFocus={(e) => e.target.select()}
          onChange={(e) => onChange({ qty: e.target.value === '' ? '' : Number(e.target.value) })}
          onBlur={(e) => { if (e.target.value === '' || Number(e.target.value) <= 0) onChange({ qty: 1 }); }}
        />
        <span className="text-2xs text-muted-ink shrink-0">{c.unit_name || 'đơn vị'}</span>
        <MoneyCell
          value={c.price}
          onCommit={(v) => onChange({ price: v })}
          label={`Giá bán hộ ${c.name}`}
          title="Giá bán cho khách"
          className="flex-1 min-w-0"
        />
        <span className="text-[13px] font-bold tabular font-mono w-24 text-right shrink-0">
          {n(amount)}
        </span>
      </div>
    </li>
  );
}

/* ==================================================================== *
 * HỘP THÊM MỘT MÓN MUA HỘ VÃNG LAI (tài liệu 24, phần 5.1)
 *
 * Để trống tên chủ hàng = tiệm tự chạy đi bốc, trả đứt tiền mặt tại chỗ,
 * ăn chênh lệch — không treo công nợ với ai.
 * Chọn đích danh chủ hàng = hàng người ta gửi, tiệm giữ hoa hồng, phần còn
 * lại treo chờ đối soát.
 * ==================================================================== */
function ConsignItemModal({ open, customer, partners, onClose, onSave, onPartnerAdded }) {
  const { toast } = useApp();
  const EMPTY = {
    name: '', unit_name: '', qty: 1, price: 0, cost: 0,
    partner_id: null, commission_type: 'percent', commission_value: 10, note: '',
  };
  const [f, setF] = useState(EMPTY);
  const [newPartner, setNewPartner] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (open) { setF(EMPTY); setNewPartner(''); setErr(''); setPickedNote(''); setHidden(false); } }, [open]);

  /* ---- Ghi nhớ món mua hộ (plan 31, hạng mục 4f) ----
     Gõ vài chữ là ra món khách này từng nhờ mua và món hay bán của tiệm;
     chọn là điền sẵn đơn vị, giá bán, chủ hàng, hoa hồng như lần trước. */
  const [nameFocus, setNameFocus] = useState(false);
  const [hidden, setHidden] = useState(false);       // vừa chọn xong thì cất danh sách đi
  const [hi, setHi] = useState(-1);
  const [pickedNote, setPickedNote] = useState('');
  const dq = useDebounced(f.name, 200);
  const { data: sug } = useFetch(
    () => api.consignSuggest({ customer_id: customer?.id || '', q: dq }),
    [dq, customer?.id, open], { skip: !open });
  const sugList = useMemo(() => [
    ...(sug?.customer || []).map((x) => ({ ...x, group: 'customer' })),
    ...(sug?.common || []).map((x) => ({ ...x, group: 'common' })),
  ], [sug]);
  const showSug = open && nameFocus && !hidden && sugList.length > 0;
  useEffect(() => { setHi(-1); }, [sugList]);

  const pick = (x) => {
    const partnerOk = !!x.partner_id && partners.some((p) => p.id === x.partner_id);
    setF((cur) => ({
      ...cur,
      name: x.name,
      unit_name: x.unit_name || '',
      price: Math.round(Number(x.price) || 0),
      partner_id: partnerOk ? x.partner_id : null,
      commission_type: partnerOk ? (x.commission_type || 'percent') : cur.commission_type,
      commission_value: partnerOk ? (x.commission_value ?? cur.commission_value) : cur.commission_value,
      /* Giá bốc chỉ có khi người đứng quầy được xem giá vốn — máy chủ cắt trường
         "cost" với người khác, lúc đó để trống cho tự điền */
      cost: !x.partner_id && x.cost !== undefined ? Math.round(Number(x.cost) || 0) : 0,
    }));
    setPickedNote(x.partner_id && !partnerOk
      ? `Lần trước lấy hàng của ${x.partner_name || 'một chủ hàng'} — chủ hàng này đã ngừng, chọn lại chủ hàng bên dưới.`
      : '');
    setHidden(true);
  };

  const onNameKey = (e) => {
    if (!showSug) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => Math.min(sugList.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(-1, i - 1)); }
    else if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); pick(sugList[hi]); }
  };

  const amount = Math.round((Number(f.qty) || 0) * (Number(f.price) || 0));
  const commission = consignCommission(f, amount);
  const payable = amount - commission;
  const margin = amount - Math.round((Number(f.qty) || 0) * (Number(f.cost) || 0));

  const addPartner = async () => {
    const name = newPartner.trim();
    if (!name) return;
    setBusy(true);
    try {
      const p = await api.addConsignPartner({ name });
      onPartnerAdded?.();
      setF((x) => ({ ...x, partner_id: p.id }));
      setNewPartner('');
      toast(`Đã thêm chủ hàng ${p.name}`, 'ok');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const save = () => {
    if (!f.name.trim()) { setErr('Bắt buộc nhập tên món.'); return; }
    if (!(Number(f.qty) > 0)) { setErr('Số lượng phải lớn hơn 0.'); return; }
    if (!(Number(f.price) > 0)) { setErr('Bắt buộc nhập giá bán cho khách.'); return; }
    onSave({
      ...f,
      name: f.name.trim(),
      unit_name: f.unit_name.trim() || null,
      qty: Number(f.qty),
      price: Math.round(Number(f.price) || 0),
      cost: f.partner_id ? 0 : Math.round(Number(f.cost) || 0),
      partner_name: partners.find((x) => x.id === f.partner_id)?.name || null,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Thêm món mua hộ vãng lai"
      subtitle="Món tiệm không có sẵn — bốc ngoài bán chênh lệch, hoặc bán giùm hàng người khác gửi"
      size="md"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={save} disabled={busy}>Thêm vào giỏ</Button>
      </>}
    >
      <div className="space-y-3">
        {err && <ErrorBox error={err} />}
        {pickedNote && (
          <p className="text-2xs text-amber-900 bg-amber-50 border border-warn/30 rounded px-2 py-1.5">{pickedNote}</p>
        )}

        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Tên món" required className="sm:col-span-3" htmlFor="cs-name">
            <Input id="cs-name" value={f.name} autoFocus autoComplete="off"
              onChange={(e) => { setF((x) => ({ ...x, name: e.target.value })); setHidden(false); setPickedNote(''); }}
              onFocus={() => setNameFocus(true)}
              /* Trễ một nhịp để cú bấm vào gợi ý kịp ăn trước khi danh sách đóng */
              onBlur={() => setTimeout(() => setNameFocus(false), 150)}
              onKeyDown={onNameKey}
              role="combobox"
              aria-expanded={showSug}
              aria-controls="cs-suggest"
              placeholder="Gõ tên món — có gợi ý món từng mua hộ" />
          </Field>
          {showSug && (
            <ul id="cs-suggest" role="listbox" aria-label="Gợi ý món mua hộ"
              className="sm:col-span-4 -mt-1.5 max-h-60 overflow-y-auto rounded border border-violet-200 bg-card shadow-pop divide-y divide-line">
              {sugList.map((x, i) => (
                <li key={`${x.group}:${x.name}`} role="option" aria-selected={i === hi}>
                  {(i === 0 || sugList[i - 1].group !== x.group) && (
                    <div className="px-2.5 pt-1.5 pb-0.5 text-2xs font-bold uppercase text-violet-800 bg-violet-50/70">
                      {x.group === 'customer' ? `${customer?.name || 'Khách này'} từng nhờ mua` : 'Món mua hộ hay bán'}
                    </div>
                  )}
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(x)}
                    className={`w-full text-left px-2.5 py-1.5 flex items-center gap-2 cursor-pointer
                                ${i === hi ? 'bg-accent-soft/60' : 'hover:bg-muted/60'}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold truncate">{x.name}</span>
                      <span className="block text-2xs text-muted-ink truncate">
                        {x.unit_name ? `${x.unit_name} · ` : ''}
                        {x.partner_id ? `của ${x.partner_name || 'chủ hàng'}${x.commission_value ? ` · hoa hồng ${n(x.commission_value)}${x.commission_type === 'percent' ? '%' : 'đ'}` : ''}` : 'tiệm tự bốc'}
                        {` · ${n(x.times)} lần · gần nhất ${date(x.last_ts)}`}
                      </span>
                    </span>
                    <span className="tabular text-[13px] font-semibold shrink-0">{money(x.price)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Field label="Đơn vị" htmlFor="cs-unit">
            <Input id="cs-unit" value={f.unit_name}
              onChange={(e) => setF((x) => ({ ...x, unit_name: e.target.value }))}
              placeholder="Cái" />
          </Field>
          <Field label="Số lượng" required htmlFor="cs-qty">
            <QtyInput id="cs-qty" size="md" value={f.qty}
              onChange={(v) => setF((x) => ({ ...x, qty: v }))} />
          </Field>
          <Field label="Giá bán cho khách" required className="sm:col-span-3" htmlFor="cs-price">
            <MoneyInput id="cs-price" value={f.price}
              onChange={(v) => setF((x) => ({ ...x, price: v }))} />
          </Field>
        </div>

        <Field
          label="Chủ hàng gửi bán"
          hint="Để trống nếu tiệm tự chạy đi bốc và trả đứt tiền mặt tại chỗ"
        >
          <Combo
            items={[...partners]}
            value={f.partner_id}
            onChange={(id) => setF((x) => ({ ...x, partner_id: id || null }))}
            placeholder="Không chọn ai — tiệm tự bốc ngoài"
            filter={(x, q) => match(x.name, q) || (x.phone || '').includes(q.trim())}
            render={(x) => ({ label: x.name, sub: x.phone || '' })}
          />
        </Field>

        <div className="flex items-end gap-1.5">
          <Field label="Thêm nhanh chủ hàng mới" className="flex-1" htmlFor="cs-newp">
            <Input id="cs-newp" value={newPartner}
              onChange={(e) => setNewPartner(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPartner(); } }}
              placeholder="Tên chủ hàng, ví dụ: Anh Ruột" />
          </Field>
          <Button icon={Plus} onClick={addPartner} disabled={!newPartner.trim() || busy}>Thêm</Button>
        </div>

        {/* Hai kịch bản rẽ nhánh rõ ràng, không để người đứng quầy đoán */}
        {f.partner_id ? (
          <div className="card p-3 bg-violet-50 border-violet-200 space-y-2">
            <h4 className="text-[13px] font-bold text-violet-900 flex items-center gap-1.5">
              <Handshake size={14} aria-hidden="true" />
              Hàng của chủ khác gửi — treo đối soát
            </h4>
            <div className="flex items-end gap-2">
              <Field label="Hoa hồng tiệm giữ" className="flex-1">
                <div className="flex gap-1.5">
                  <Select className="!w-20" aria-label="Cách tính hoa hồng"
                    value={f.commission_type}
                    onChange={(e) => setF((x) => ({ ...x, commission_type: e.target.value }))}>
                    <option value="percent">%</option>
                    <option value="amount">đồng</option>
                  </Select>
                  <Input type="number" min="0" step="any" className="flex-1"
                    aria-label="Mức hoa hồng"
                    value={f.commission_value}
                    onChange={(e) => setF((x) => ({ ...x, commission_value: e.target.value }))} />
                </div>
              </Field>
            </div>
            <div className="text-2xs space-y-0.5">
              <div className="flex justify-between">
                <span className="text-muted-ink">Khách trả</span>
                <span className="tabular font-semibold">{money(amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-ink">Hoa hồng tiệm giữ</span>
                <span className="tabular font-semibold text-emerald-700">{money(commission)}</span>
              </div>
              <div className="flex justify-between border-t border-violet-200 pt-0.5">
                <span className="font-semibold text-violet-900">Còn nợ chủ hàng</span>
                <span className="tabular font-bold text-violet-900">{money(payable)}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="card p-3 bg-amber-50 border-warn/30 space-y-2">
            <h4 className="text-[13px] font-bold text-amber-900 flex items-center gap-1.5">
              <Wallet size={14} aria-hidden="true" />
              Tiệm tự bốc ngoài — ăn chênh lệch, không treo nợ ai
            </h4>
            <Field
              label="Giá tiệm bốc (một đơn vị)"
              hint="Tiền trả đứt tại chỗ. Vào giá vốn của đơn để tính đúng lãi — không tự sinh phiếu chi, muốn ghi quỹ thì lập phiếu bên Quỹ tiền."
            >
              <MoneyInput value={f.cost} onChange={(v) => setF((x) => ({ ...x, cost: v }))} />
            </Field>
            <div className="text-2xs space-y-0.5">
              <div className="flex justify-between">
                <span className="text-muted-ink">Khách trả</span>
                <span className="tabular font-semibold">{money(amount)}</span>
              </div>
              <div className="flex justify-between border-t border-warn/30 pt-0.5">
                <span className="font-semibold text-amber-900">Tiệm ăn chênh</span>
                <span className={`tabular font-bold ${margin < 0 ? 'text-danger' : 'text-emerald-700'}`}>
                  {money(margin)}
                </span>
              </div>
            </div>
          </div>
        )}

        <Field label="Ghi chú" htmlFor="cs-note">
          <Input id="cs-note" value={f.note}
            onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))}
            placeholder="Lấy ở tiệm anh Tư chợ Cái Bè" />
        </Field>

        <p className="text-2xs text-muted-ink flex items-start gap-1.5">
          <ShieldCheck size={12} className="shrink-0 mt-0.5" aria-hidden="true" />
          Hoá đơn in cho khách <b className="mx-1">không hiện</b> tên chủ hàng hay giá bốc — món
          này in phẳng như hàng của tiệm.
        </p>
      </div>
    </Modal>
  );
}

/* ==================================================================== *
 * GHI CHÚ HÀNG ĐẶC THÙ CỦA MỘT KHÁCH (tài liệu 24, phần 3)
 * ==================================================================== */
function CustomerNotesModal({ open, customer, notes, onClose, onPick }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Ghi chú hàng đặc thù — ${customer?.name || ''}`}
      subtitle="Khách này quen gọi món theo tên riêng của họ"
      size="md"
      footer={<Button onClick={onClose}>Đóng</Button>}
    >
      {!notes?.length ? (
        <Empty icon={ClipboardList} title="Chưa khai ghi chú nào"
          message="Khai trong hồ sơ khách hàng, thẻ Ghi chú hàng đặc thù." />
      ) : (
        <ul className="divide-y divide-line">
          {notes.map((nt) => (
            <li key={nt.id} className="py-2 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[13px]">
                  Khách gọi <b className="text-amber-900">{nt.alias}</b>
                  {nt.product_name && <> ➔ <b>{nt.product_name}</b></>}
                </div>
                {nt.sku && <div className="text-2xs font-mono text-muted-ink">{nt.sku}</div>}
                {nt.note && <div className="text-2xs text-muted-ink mt-0.5">{nt.note}</div>}
              </div>
              {nt.product_id && (
                <Button size="sm" variant="soft" icon={Plus} onClick={() => onPick(nt)}>
                  Thêm
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/* ==================================================================== *
 * HỘP GHI CHÚ CỦA MỘT DÒNG GIỎ HÀNG
 *
 * Hai thứ khác nhau, để chung một chỗ vì thu ngân mở ra là để "ghi lại
 * điều gì đó về món này":
 *   1. GHI CHÚ DÒNG HÀNG — in trên hoá đơn, chỉ sống trong hoá đơn này.
 *      Ví dụ: cắt 12,5m; màu đỏ; giao đợt 2.
 *   2. GHI CHÚ ĐẶC THÙ CỦA KHÁCH (tài liệu 24, phần 3) — tên khách quen
 *      gọi món này và câu nhắc, lưu thẳng vào HỒ SƠ KHÁCH nên lần sau bán
 *      cho đúng người đó là hiện lại.
 *
 * Bảo hành tách hẳn sang hộp riêng: nhét chung thì muốn sửa một câu ghi
 * chú cũng phải lướt qua bốn ô bảo hành.
 * ==================================================================== */
function LineNoteModal({ line, customer, alias, onClose, onSave, onNotesChanged }) {
  const { toast } = useApp();
  const [text, setText] = useState('');
  const [aliasName, setAliasName] = useState('');
  const [aliasNote, setAliasNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!line) return;
    setText(line.note || '');
    setAliasName(alias?.alias || '');
    setAliasNote(alias?.note || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line]);

  const aliasChanged = !!customer
    && (aliasName.trim() !== (alias?.alias || '') || aliasNote.trim() !== (alias?.note || ''));

  /**
   * Lưu. Ghi chú đặc thù ghi TRƯỚC rồi mới đóng hộp: ghi hỏng thì báo ngay
   * chứ không đóng cái rụp để rồi tưởng đã lưu.
   */
  const save = async () => {
    if (aliasChanged) {
      setBusy(true);
      try {
        const name = aliasName.trim();
        if (!name && alias?.id) {
          await api.deleteProductNote(alias.id);
        } else if (name && alias?.id) {
          await api.updateProductNote(alias.id, { alias: name, note: aliasNote.trim() || null });
        } else if (name) {
          await api.addCustomerProductNote(customer.id, {
            alias: name, product_id: line.product_id, note: aliasNote.trim() || null,
          });
        }
        onNotesChanged?.();
      } catch (e) {
        setBusy(false);
        toast(`Chưa lưu được ghi chú đặc thù: ${e.message}`, 'bad', 8000);
        return;
      }
      setBusy(false);
    }
    onSave({ note: text.trim() });
  };

  return (
    <Modal
      open={!!line}
      onClose={onClose}
      title="Ghi chú"
      subtitle={line?.name}
      size="sm"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={save} disabled={busy}>Lưu</Button>
      </>}
    >
      <div className="space-y-3">
        <Field
          label="Ghi chú cho dòng hàng này"
          hint="In trên hoá đơn ngay dưới tên hàng. Ví dụ: cắt 12,5m; màu đỏ; giao đợt 2."
          htmlFor="ln-note"
        >
          <Textarea id="ln-note" rows={2} value={text} autoFocus
            onChange={(e) => setText(e.target.value)}
            placeholder="Cắt đúng 12,5 mét, bó riêng" />
        </Field>

        {/* -------- Ghi chú đặc thù của khách (tài liệu 24, phần 3) -------- */}
        <div className={`card p-3 space-y-2.5 ${customer ? 'bg-amber-50/60 border-warn/30' : 'bg-muted/40'}`}>
          <h4 className="text-[13px] font-bold flex items-center gap-1.5">
            <Lightbulb size={13} aria-hidden="true" />
            Ghi chú đặc thù của khách
          </h4>
          {!customer ? (
            <p className="text-2xs text-muted-ink">
              Chọn khách hàng đã lưu trước thì mới ghi được — đây là ghi chú riêng của
              từng khách, không phải của hoá đơn.
            </p>
          ) : (
            <>
              <p className="text-2xs text-muted-ink">
                Lưu thẳng vào hồ sơ <b>{customer.name}</b>. Lần sau bán cho khách này, gõ đúng tên
                họ quen gọi là món thật nhảy lên đầu lưới kèm câu nhắc.
              </p>
              <Field label="Khách quen gọi món này là" htmlFor="ln-alias">
                <Input id="ln-alias" value={aliasName}
                  onChange={(e) => setAliasName(e.target.value)}
                  placeholder="dây gân, cái cùi chỏ..." />
              </Field>
              <Field label="Câu nhắc cho thu ngân" htmlFor="ln-anote">
                <Input id="ln-anote" value={aliasNote}
                  onChange={(e) => setAliasNote(e.target.value)}
                  placeholder="Khách này chỉ lấy loại lõi đồng" />
              </Field>
              {alias?.id && !aliasName.trim() && (
                <p className="text-2xs text-danger">
                  Để trống tên khách gọi là <b>xoá</b> ghi chú đặc thù này khỏi hồ sơ khách.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ==================================================================== *
 * HỘP BẢO HÀNH CỦA MỘT DÒNG GIỎ HÀNG
 *
 * Chỉ làm đúng một việc: số tháng, điều kiện, số serial. Sửa ở đây chỉ áp
 * cho hoá đơn đang lập — bảo hành mặc định của mặt hàng vẫn nguyên.
 * ==================================================================== */
function LineWarrantyModal({ line, onClose, onSave }) {
  const [months, setMonths] = useState(0);
  const [wNote, setWNote] = useState('');
  const [serial, setSerial] = useState('');

  useEffect(() => {
    if (!line) return;
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
    warrantyMonths: Number(months) || 0,
    warrantyNote: wNote.trim(),
    serial: serial.trim(),
    ...patch,
  });

  return (
    <Modal
      open={!!line}
      onClose={onClose}
      title="Bảo hành"
      subtitle={line?.name}
      size="sm"
      footer={<>
        {Number(months) > 0 && (
          <Button variant="danger" className="mr-auto" onClick={() => save({ warrantyMonths: 0 })}>
            Huỷ bảo hành
          </Button>
        )}
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={() => save()}>Lưu</Button>
      </>}
    >
      <div className="space-y-3">
        <p className="text-2xs text-muted-ink leading-relaxed">
          {def > 0
            ? `Mặt hàng này mặc định bảo hành ${def} tháng. Sửa hay huỷ ở đây chỉ áp dụng cho hoá đơn này.`
            : 'Mặt hàng này không có bảo hành mặc định — thêm bảo hành riêng cho hoá đơn này nếu cần.'}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Bảo hành (tháng)" hint="Để 0 nếu hàng không bảo hành" htmlFor="lw-warranty">
            <div className="flex items-center gap-1.5">
              <QtyInput id="lw-warranty" size="md" value={months} onChange={setMonths} min={0} className="flex-1" />
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

          <Field label="Số serial / số máy" hint="Ghi để sau này tra ra ai mua" htmlFor="lw-serial">
            <Input id="lw-serial" value={serial} onChange={(e) => setSerial(e.target.value)}
              placeholder="PNS-2026-0099" />
          </Field>
        </div>

        <Field label="Điều kiện bảo hành" hint="In lên phiếu bảo hành" htmlFor="lw-wnote">
          <Input id="lw-wnote" value={wNote} onChange={(e) => setWNote(e.target.value)}
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
      size="xl"
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
                  <th>Tên</th><th>Mã</th><th>Khách hàng</th><th>Người mua hộ</th>
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
                      {/* Người mua hộ (plan 31, 1.2b) — thợ lấy hàng cho chủ nhà */}
                      <td className={d.buyer_name ? 'text-violet-800' : 'text-muted-ink'}>
                        {d.buyer_name
                          ? <>{d.buyer_name}{d.buyer_phone && <div className="text-2xs text-muted-ink">{d.buyer_phone}</div>}</>
                          : '—'}
                      </td>
                      <td className="num">
                        {d.item_count}
                        {d.consign_count > 0 && <div className="text-2xs text-violet-700">+{d.consign_count} mua hộ</div>}
                      </td>
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
