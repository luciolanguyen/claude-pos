/* ====================================================================
   LỌC NHÓM HÀNG NHIỀU CẤP VÀ LƯỚI HÀNG TẢI DẦN (tài liệu 06, 22)

   Chỉ còn MỘT chỗ lọc nhóm hàng: thanh trượt cạnh trái màn hình bán hàng.
   Dải duyệt nhóm nằm ngang trên đầu lưới đã bỏ — hai chỗ cùng lọc một thứ
   thì người đứng quầy phải nhớ hai cách làm, mà chọn ở chỗ này rồi nhìn
   sang chỗ kia lại tưởng máy quên mất.

   Tích chọn được nhiều nhóm cùng lúc:

     - Các nhóm KHÔNG lồng nhau: lấy hàng thuộc nhóm này HOẶC nhóm kia.
     - Chọn cả nhóm cha lẫn nhóm con của nó: hàng phải thuộc nhánh cha VÀ
       thuộc nhóm con — tức là chỉ còn hàng của nhóm con. Chọn cha rồi tích
       thêm con là để thu hẹp, không phải để mở rộng.

   Lưới hàng không vẽ hết một lượt: tiệm hơn hai nghìn món, máy tính tiền
   cũ vẽ hai nghìn ô là khựng. Vẽ trước một khúc, cuộn gần tới đâu vẽ thêm.
   ==================================================================== */
import { useState, useEffect, useMemo, useRef } from 'react';
import {
  ChevronRight, ChevronLeft, X, FolderTree, RotateCcw, ArrowDownUp,
} from 'lucide-react';
import { n, match } from '../lib/format';
import { SearchInput } from './ui';
import { categoryBranch } from './CategoryTree';

/**
 * Tập id nhóm được phép hiện, hoặc null nếu không lọc.
 * @param selected  mảng id đang tích chọn
 * @param browseId  nhóm đang đứng trên đường dẫn — chưa tích gì thì lọc theo nhóm này
 */
export function categoryFilterSet(categories, selected, browseId) {
  const ids = (selected || []).map(Number).filter(Boolean);
  if (!ids.length) return browseId ? categoryBranch(categories, browseId) : null;

  const parentOf = new Map((categories || []).map((c) => [c.id, c.parent_id || null]));
  const isAncestor = (a, b) => {
    let p = parentOf.get(b);
    let guard = 0;
    while (p && guard++ < 50) {
      if (p === a) return true;
      p = parentOf.get(p);
    }
    return false;
  };
  /* Nhóm cha có con cháu cũng đang được chọn thì nhường cho con cháu (VÀ) */
  const effective = ids.filter((a) => !ids.some((b) => b !== a && isAncestor(a, b)));
  const out = new Set();
  for (const id of effective) {
    for (const x of categoryBranch(categories, id) || []) out.add(x);
  }
  return out;
}

/* ==================================================================== *
 * THANH BÊN TRƯỢT LỌC NHÓM HÀNG (tài liệu 22, mục 2)
 *
 * Hộp thoại bật lên che mất lưới hàng: chọn nhóm xong đóng hộp mới thấy
 * kết quả, không ưng lại mở ra. Thanh bên thì ĐẨY lưới hẹp lại chứ không
 * che — vừa tích nhóm vừa nhìn hàng đổi ngay bên cạnh.
 *
 * Thu vào thì còn một vệt dọc hẹp bên mép trái, bấm là đẩy ra lại.
 * ==================================================================== */

/** Nhánh cha - con - cháu nào có nhóm khớp từ khoá thì bung ra hết. */
function matchingBranch(cats, term) {
  if (!term.trim()) return null;
  const parentOf = new Map(cats.map((c) => [c.id, c.parent_id || null]));
  const keep = new Set();
  const open = new Set();
  for (const c of cats) {
    if (!match(c.name, term)) continue;
    keep.add(c.id);
    /* Mọi nhóm cha bên trên phải còn lại, không thì nhóm khớp mất chỗ đứng */
    let p = parentOf.get(c.id);
    let guard = 0;
    while (p && guard++ < 50) { keep.add(p); open.add(p); p = parentOf.get(p); }
  }
  /* Nhóm khớp mà còn con cháu thì cũng cho hiện cả nhánh dưới nó */
  let grew = true;
  let guard = 0;
  while (grew && guard++ < 50) {
    grew = false;
    for (const c of cats) {
      if (!keep.has(c.id) && c.parent_id && keep.has(c.parent_id)) { keep.add(c.id); grew = true; }
    }
  }
  return { keep, open };
}

export function CategoryDrawer({
  open, onToggle, categories, selected, onToggleCat, onClear, shown, total, className = '',
}) {
  const cats = categories || [];
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState(() => new Set());

  const byId = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const kidsOf = useMemo(() => {
    const m = new Map();
    for (const c of cats) {
      const k = c.parent_id || 0;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(c);
    }
    for (const list of m.values()) {
      list.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name, 'vi'));
    }
    return m;
  }, [cats]);

  /* Gõ từ khoá: ẩn nhánh không liên quan, tự bung nhánh còn lại. Ô tìm dùng
     match() nên gõ không dấu và đảo thứ tự từ đều ra ("lực dây thuỷ" ->
     "Dây thuỷ lực" — tài liệu 22, mục 2.2). */
  const hit = useMemo(() => matchingBranch(cats, q), [cats, q]);

  const rows = useMemo(() => {
    const out = [];
    const walk = (parentId, depth) => {
      for (const c of kidsOf.get(parentId) || []) {
        if (hit && !hit.keep.has(c.id)) continue;
        const kids = (kidsOf.get(c.id) || []).filter((k) => !hit || hit.keep.has(k.id));
        /* Đang tìm thì mở sẵn nhánh khớp; không tìm thì theo nút bấm của người dùng */
        const isOpen = hit ? hit.open.has(c.id) || kids.length > 0 : !collapsed.has(c.id);
        out.push({ c, depth, kids: kids.length, isOpen });
        if (kids.length && isOpen) walk(c.id, depth + 1);
      }
    };
    walk(0, 0);
    return out;
  }, [kidsOf, hit, collapsed]);

  const picked = selected.map((id) => byId.get(id)).filter(Boolean);

  if (!open) {
    /* Thu vào: còn một vệt dọc, bấm là đẩy ra */
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={false}
        title="Mở bảng lọc nhóm hàng"
        className={`hidden md:flex w-8 shrink-0 border-r border-line bg-card hover:bg-muted
                   flex-col items-center gap-2 py-3 cursor-pointer transition-colors duration-150
                   ${className}`}
      >
        <FolderTree size={16} className={selected.length ? 'text-accent' : 'text-muted-ink'} aria-hidden="true" />
        <span className="text-2xs font-semibold tracking-wide text-muted-ink"
          style={{ writingMode: 'vertical-rl' }}>
          Nhóm hàng{selected.length ? ` (${n(selected.length)})` : ''}
        </span>
      </button>
    );
  }

  return (
    <aside
      className={`hidden md:flex w-[26%] min-w-[210px] max-w-[340px] shrink-0 flex-col
                 border-r border-line bg-card min-h-0 ${className}`}
      aria-label="Bảng lọc nhóm hàng"
    >
      <div className="p-2 border-b border-line space-y-1.5 shrink-0">
        <SearchInput value={q} onChange={setQ} size="sm" placeholder="Nhập từ khoá tìm nhóm..." />
        {picked.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            {picked.map((c) => (
              <span key={c.id}
                className="inline-flex items-center gap-0.5 rounded-full bg-slate-800 text-white
                           text-2xs pl-2 pr-0.5 py-0.5 max-w-full">
                <span className="truncate">{c.name}</span>
                <button type="button" onClick={() => onToggleCat(c.id)} aria-label={`Bỏ lọc ${c.name}`}
                  className="rounded-full hover:bg-white/20 p-0.5 cursor-pointer shrink-0">
                  <X size={11} aria-hidden="true" />
                </button>
              </span>
            ))}
            <button type="button" onClick={onClear}
              className="btn btn-sm btn-outline !text-2xs !min-h-[24px] !px-1.5">
              <RotateCcw size={11} aria-hidden="true" />
              Xoá tất cả
            </button>
          </div>
        ) : (
          <p className="text-2xs text-muted-ink">
            Chưa lọc nhóm nào — lưới đang hiện tất cả {n(total)} món.
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-1">
        {rows.length === 0 ? (
          <p className="text-2xs text-muted-ink p-2">
            {q ? `Không có nhóm nào khớp "${q}".` : 'Chưa khai nhóm hàng nào.'}
          </p>
        ) : rows.map(({ c, depth, kids, isOpen }) => {
          const on = selected.includes(c.id);
          return (
            <div key={c.id} className="flex items-stretch" style={{ paddingLeft: depth * 12 }}>
              {kids > 0 ? (
                <button
                  type="button"
                  onClick={() => setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                    return next;
                  })}
                  aria-expanded={isOpen}
                  aria-label={isOpen ? `Thu nhánh ${c.name}` : `Bung nhánh ${c.name}`}
                  className="w-5 shrink-0 flex items-center justify-center text-muted-ink
                             hover:text-ink cursor-pointer rounded"
                >
                  <ChevronRight size={13} aria-hidden="true"
                    className={`transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`} />
                </button>
              ) : <span className="w-5 shrink-0" aria-hidden="true" />}
              <label
                className={`flex-1 min-w-0 flex items-center gap-1.5 px-1.5 py-1 rounded cursor-pointer
                            text-[13px] transition-colors duration-100
                            ${on ? 'bg-accent-soft text-emerald-900 font-semibold' : 'hover:bg-muted'}`}
              >
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 accent-emerald-700 cursor-pointer shrink-0"
                  checked={on}
                  onChange={() => onToggleCat(c.id)}
                />
                <span className="truncate">{c.name}</span>
              </label>
            </div>
          );
        })}
      </div>

      <div className="p-1.5 border-t border-line shrink-0 flex items-center gap-1.5">
        <button type="button" onClick={onToggle}
          className="btn btn-sm btn-outline flex-1" aria-expanded>
          <ChevronLeft size={13} aria-hidden="true" />
          Thu gọn bảng lọc
        </button>
        <span className="text-2xs text-muted-ink tabular shrink-0 pr-1">
          {selected.length ? `${n(shown)}/${n(total)}` : n(total)} món
        </span>
      </div>
    </aside>
  );
}

/**
 * Thanh công tắc trên đầu lưới hàng.
 *
 * Dải duyệt nhóm hàng nằm ngang (đường dẫn "Tất cả nhóm" và các ô tích
 * nhóm) ĐÃ BỎ: thanh trượt [Nhóm hàng] cạnh trái làm đúng việc đó mà
 * không che lưới, lại còn tìm và bung được cây nhiều tầng. Để hai chỗ
 * cùng lọc một thứ thì người đứng quầy phải nhớ hai cách làm, và chọn ở
 * chỗ này rồi nhìn sang chỗ kia lại tưởng máy quên.
 *
 * Thanh này giờ chỉ mang mấy công tắc của lưới và số đếm mặt hàng.
 */
/* ==================================================================== *
 * BẢNG SẮP XẾP LƯỚI HÀNG (plan 31, mục 3.2)
 *
 * Lưới có bốn quy tắc xếp thứ tự. Mỗi quy tắc một nút riêng thì thanh công
 * cụ thành một hàng công tắc và người đứng quầy không đoán nổi bật cái nào
 * ra kết quả gì. Gộp vào MỘT nút mở ra bảng nhỏ, kèm một dòng nói đang áp
 * dụng những gì.
 *
 * Quy tắc "món khách gọi bằng tên riêng" CỐ Ý không có công tắc: nó chỉ bật
 * khi khách đó có ghi chú riêng, và đó đúng là lúc nó hữu ích nhất.
 * ==================================================================== */
export function GridSortPanel({
  boughtTop, onBoughtTop, cartTop, onCartTop, pinOn, onPinOn, pinnedCount = 0,
  hideUntilSearch, onHideUntilSearch, hasCustomer = false,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  /* Bấm ra ngoài hoặc Esc thì thu bảng lại */
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  /* Một dòng tóm tắt, để nhìn nút là biết lưới đang xếp kiểu gì */
  const parts = [];
  if (boughtTop && hasCustomer) parts.push('khách hay mua');
  if (cartTop) parts.push('đang trong giỏ');
  if (pinOn && pinnedCount > 0) parts.push(`hàng ghim (${n(pinnedCount)})`);
  const summary = parts.length ? `Lên trước: ${parts.join(' · ')}` : 'Xếp theo tên hàng';


  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={summary}
        className={`h-8 px-2 rounded border text-2xs font-semibold inline-flex items-center gap-1
                    cursor-pointer transition-colors duration-100
                    ${open ? 'bg-accent-soft border-accent text-emerald-900'
                           : 'bg-card border-line text-muted-ink hover:text-ink'}`}
      >
        <ArrowDownUp size={12} aria-hidden="true" />
        Sắp xếp lưới
        {parts.length > 0 && <span className="tabular">({n(parts.length)})</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-72 rounded border border-line
                        bg-card shadow-lg overflow-hidden">
          <div className="px-2.5 py-1.5 border-b border-line text-2xs font-bold text-muted-ink">
            Món nào lên đầu lưới
          </div>
          <Row
            on={boughtTop}
            onChange={onBoughtTop}
            disabled={!hasCustomer}
            label="Món khách này hay mua lên trước"
            hint={hasCustomer ? null : 'Chọn khách hàng trước thì mới dùng được'}
          />
          <Row
            on={cartTop}
            onChange={onCartTop}
            label="Món đang trong giỏ lên trước"
            hint="Thợ nhìn ngay lên đầu để đối chiếu thông số rồi đi cắt hàng"
          />
          <Row
            on={pinOn}
            onChange={onPinOn}
            disabled={pinnedCount === 0}
            label={`Hàng ghim theo mùa lên trước${pinnedCount ? ` (${n(pinnedCount)})` : ''}`}
            hint={pinnedCount ? null : 'Chưa ghim món nào — ghim ở Thiết lập'}
          />
          <div className="border-t border-line">
            <Row
              on={hideUntilSearch}
              onChange={onHideUntilSearch}
              label="Ẩn lưới, chỉ hiện khi tìm kiếm"
              hint="Quầy quen gõ tìm hoặc quét mã thì lưới hàng chỉ tổ chật màn hình"
            />
          </div>
          <p className="px-2.5 py-1.5 border-t border-line text-2xs text-muted-ink">
            {summary}. Mỗi máy đứng quầy nhớ riêng cài đặt này.
          </p>
        </div>
      )}
    </div>
  );
}

export function GridToolbar({ shown, total, filtering = false, extra = null }) {
  return (
    <div className="px-3 py-2 border-b border-line bg-card shrink-0 flex items-center gap-1.5">
      {extra}
      <div className="flex-1 min-w-0" />
      <span className="text-2xs text-muted-ink whitespace-nowrap shrink-0 tabular">
        {filtering ? `${n(shown)}/${n(total)} món` : `${n(total)} món`}
      </span>
    </div>
  );
}

/**
 * Lưới vẽ dần: hiện `step` ô đầu, cuộn gần tới cuối thì vẽ thêm một khúc.
 * @param rootRef   khung có thanh cuộn chứa lưới
 * @param resetKey  đổi bộ lọc / từ khoá thì về lại khúc đầu và cuộn lên trên
 */
export function LazyGrid({ items, renderItem, rootRef, resetKey, step = 60, className = '' }) {
  const [limit, setLimit] = useState(step);
  const sentinel = useRef(null);

  useEffect(() => {
    setLimit(step);
    rootRef?.current?.scrollTo?.({ top: 0 });
  }, [resetKey, step, rootRef]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || limit >= items.length || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setLimit((x) => Math.min(x + step, items.length));
      }
    }, { root: rootRef?.current || null, rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, items.length, step, rootRef]);

  const more = items.length - limit;
  return (
    <>
      <div className={className}>{items.slice(0, limit).map(renderItem)}</div>
      {more > 0 && (
        <div ref={sentinel} className="py-3 text-center text-2xs text-muted-ink">
          Đang hiện {n(limit)}/{n(items.length)} món — cuộn xuống để xem thêm
          {typeof IntersectionObserver === 'undefined' && (
            <button type="button" className="btn btn-sm btn-outline ml-2"
              onClick={() => setLimit((x) => x + step)}>
              Hiện thêm
            </button>
          )}
        </div>
      )}
    </>
  );
}

/* Một dòng tích chọn của bảng "Sắp xếp lưới". Khai ngoài thân component cha (BRD mục 8):
   khai bên trong thì mỗi lần vẽ lại là React thay cả khối, ô tích mất con trỏ. */
function Row({ on, onChange, label, hint, disabled = false }) {
  return (
    <label className={`flex items-start gap-2 px-2.5 py-1.5 text-[13px]
                       ${disabled ? 'opacity-55' : 'cursor-pointer hover:bg-muted/60'}`}>
      <input
        type="checkbox"
        className="w-4 h-4 accent-emerald-700 cursor-pointer mt-0.5 shrink-0"
        checked={on}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        {label}
        {hint && <span className="block text-2xs text-muted-ink leading-snug">{hint}</span>}
      </span>
    </label>
  );
}
