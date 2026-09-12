/* ====================================================================
   LỌC NHÓM HÀNG NHIỀU CẤP VÀ LƯỚI HÀNG TẢI DẦN (tài liệu 06)

   Đường dẫn (breadcrumb) cho biết đang đứng ở cấp nào và bấm về cấp trên
   một phát. Tích chọn được nhiều nhóm cùng lúc:

     - Các nhóm KHÔNG lồng nhau: lấy hàng thuộc nhóm này HOẶC nhóm kia.
     - Chọn cả nhóm cha lẫn nhóm con của nó: hàng phải thuộc nhánh cha VÀ
       thuộc nhóm con — tức là chỉ còn hàng của nhóm con. Chọn cha rồi tích
       thêm con là để thu hẹp, không phải để mở rộng.

   Lưới hàng không vẽ hết một lượt: tiệm hơn hai nghìn món, máy tính tiền
   cũ vẽ hai nghìn ô là khựng. Vẽ trước một khúc, cuộn gần tới đâu vẽ thêm.
   ==================================================================== */
import { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronRight, Check, X } from 'lucide-react';
import { n } from '../lib/format';
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

export function CategoryFilter({
  categories, browseId, onBrowse, selected, onToggle, onClear, shown, total, extra = null,
}) {
  const cats = categories || [];
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

  const path = useMemo(() => {
    const out = [];
    let c = byId.get(Number(browseId));
    let guard = 0;
    while (c && guard++ < 50) {
      out.unshift(c);
      c = c.parent_id ? byId.get(c.parent_id) : null;
    }
    return out;
  }, [byId, browseId]);

  const level = kidsOf.get(Number(browseId) || 0) || [];
  const filtering = selected.length > 0 || !!browseId;
  const crumb = (active) => `px-1.5 h-8 rounded font-semibold whitespace-nowrap cursor-pointer
    transition-colors duration-100 ${active ? 'text-ink' : 'text-accent hover:underline'}`;

  return (
    <div className="px-3 py-2 border-b border-line bg-card shrink-0 space-y-1.5">
      <div className="flex items-center gap-1.5 overflow-x-auto">
        <nav aria-label="Vị trí nhóm hàng" className="flex items-center gap-0.5 shrink-0 text-[13px]">
          <button type="button" onClick={() => onBrowse(null)} className={crumb(!browseId)}
            aria-current={!browseId ? 'page' : undefined}>
            Tất cả nhóm
          </button>
          {path.map((c) => {
            const here = c.id === Number(browseId);
            return (
              <span key={c.id} className="flex items-center gap-0.5">
                <ChevronRight size={13} className="text-muted-ink" aria-hidden="true" />
                <button type="button" onClick={() => onBrowse(c.id)} className={crumb(here)}
                  aria-current={here ? 'page' : undefined}>
                  {c.name}
                </button>
              </span>
            );
          })}
        </nav>

        <span className="w-px h-5 bg-line shrink-0" aria-hidden="true" />

        <div className="flex items-center gap-1.5" role="group"
          aria-label="Tích chọn nhóm để lọc — chọn được nhiều nhóm">
          {level.map((c) => {
            const on = selected.includes(c.id);
            const kids = kidsOf.has(c.id);
            return (
              <div key={c.id} className="flex items-stretch shrink-0">
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggle(c.id)}
                  className={`btn btn-sm ${on ? 'btn-secondary' : 'btn-outline'} ${kids ? '!rounded-r-none' : ''}`}
                >
                  <span className="w-3.5 h-3.5 rounded-sm border border-current flex items-center justify-center shrink-0"
                    aria-hidden="true">
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                  {c.name}
                </button>
                {kids && (
                  <button
                    type="button"
                    onClick={() => onBrowse(c.id)}
                    aria-label={`Mở các nhóm con của ${c.name}`}
                    title={`Xem nhóm con của ${c.name}`}
                    className={`btn btn-sm !px-1.5 !rounded-l-none !border-l-0 ${on ? 'btn-secondary' : 'btn-outline'}`}
                  >
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
          {!level.length && (
            <span className="text-2xs text-muted-ink whitespace-nowrap">Nhóm này không còn nhóm con.</span>
          )}
        </div>

        <div className="flex-1" />
        {/* Chỗ cho công tắc phụ của màn hình bán hàng, ví dụ nút hàng ghim */}
        {extra}
        <span className="text-2xs text-muted-ink whitespace-nowrap shrink-0 tabular">
          {filtering ? `${n(shown)}/${n(total)} món` : `${n(total)} món`}
        </span>
      </div>

      {selected.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap text-2xs">
          <span className="text-muted-ink">
            Đang lọc{selected.length > 1 ? ' — hàng thuộc một trong các nhóm' : ''}:
          </span>
          {selected.map((id) => byId.get(id)).filter(Boolean).map((c) => (
            <span key={c.id} className="inline-flex items-center gap-0.5 rounded-full bg-slate-800 text-white pl-2 pr-0.5 py-0.5">
              {c.name}
              <button type="button" onClick={() => onToggle(c.id)} aria-label={`Bỏ lọc ${c.name}`}
                className="rounded-full hover:bg-white/20 p-0.5 cursor-pointer">
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ))}
          <button type="button" onClick={onClear} className="text-accent font-semibold hover:underline cursor-pointer px-1 min-h-[24px]">
            Bỏ lọc
          </button>
        </div>
      )}
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
