/* ====================================================================
   CHỌN KỲ XEM — dùng chung cho Tổng quan và Báo cáo (11/10/2026)

   Nút nhanh cho các kỳ hay xem, cộng "Tuỳ chọn" để chọn từ ngày – đến ngày
   (xem mùa Tết, một đợt khuyến mãi…). Kỳ đang chọn:
     - nằm trên địa chỉ trang (?from=…&to=…) — bấm từ Tổng quan sang Báo cáo
       vẫn giữ đúng kỳ, gửi đường dẫn cho người khác cũng mở đúng kỳ;
     - nhớ theo máy (localStorage) — mở lại trang không phải chọn lại.
   ==================================================================== */
import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarRange } from 'lucide-react';
import { range, date, isoDate } from '../lib/format';

export const QUICK = [
  ['today', 'Hôm nay'], ['yesterday', 'Hôm qua'], ['week7', '7 ngày'],
  ['month', 'Tháng này'], ['lastMonth', 'Tháng trước'], ['year', 'Năm nay'],
];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Nhận ra một khoảng ngày có trùng nút nhanh nào không. */
function keyOf(from, to) {
  return QUICK.find(([k]) => { const r = range(k); return r.from === from && r.to === to; })?.[0] || 'custom';
}

/**
 * Kỳ đang xem của một trang.
 * @param store khoá nhớ theo máy, ví dụ 'dashboard'
 * @returns { from, to, key, label, set(from, to) }
 */
export function usePeriod(store, fallback = 'month') {
  const [params, setParams] = useSearchParams();
  const lsKey = `thpos.period.${store}`;
  const initial = () => {
    const f = params.get('from');
    const t = params.get('to');
    if (ISO.test(f || '') && ISO.test(t || '')) return { from: f, to: t };
    try {
      const saved = JSON.parse(localStorage.getItem(lsKey) || 'null');
      /* Nhớ "Tháng này" chứ không nhớ cứng 01–11/10: sang tháng sau mở ra vẫn là tháng mới */
      if (saved?.key && saved.key !== 'custom') return range(saved.key);
      if (ISO.test(saved?.from || '') && ISO.test(saved?.to || '')) return saved;
    } catch { /* trình duyệt chặn bộ nhớ: dùng mặc định */ }
    return range(fallback);
  };
  const [p, setP] = useState(initial);

  const key = keyOf(p.from, p.to);
  const label = key === 'custom'
    ? `${date(p.from)} – ${date(p.to)}`
    : QUICK.find(([k]) => k === key)[1];

  /* Đổi kỳ thì ghi lên địa chỉ trang (giữ các tham số khác, ví dụ ?tab=) */
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (next.get('from') === p.from && next.get('to') === p.to) return;
    next.set('from', p.from);
    next.set('to', p.to);
    setParams(next, { replace: true });
    try { localStorage.setItem(lsKey, JSON.stringify({ key, from: p.from, to: p.to })); } catch { /* bỏ qua */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.from, p.to]);

  return useMemo(() => ({
    from: p.from, to: p.to, key, label,
    set: (from, to) => setP(from <= to ? { from, to } : { from: to, to: from }),
  }), [p.from, p.to, key, label]);
}

export default function PeriodPicker({ period, compare = null }) {
  const [custom, setCustom] = useState(period.key === 'custom');
  const [draft, setDraft] = useState({ from: period.from, to: period.to });
  useEffect(() => { setDraft({ from: period.from, to: period.to }); }, [period.from, period.to]);
  const today = isoDate(new Date());

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Chọn kỳ xem">
        {QUICK.map(([k, l]) => (
          <button
            key={k}
            type="button"
            aria-pressed={period.key === k && !custom}
            onClick={() => { setCustom(false); const r = range(k); period.set(r.from, r.to); }}
            className={`btn btn-sm ${period.key === k && !custom ? 'btn-secondary' : 'btn-outline'}`}
          >
            {l}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={custom || period.key === 'custom'}
          onClick={() => setCustom((v) => !v)}
          className={`btn btn-sm ${custom || period.key === 'custom' ? 'btn-secondary' : 'btn-outline'}`}
        >
          <CalendarRange size={14} aria-hidden="true" /> Tuỳ chọn…
        </button>
      </div>

      {(custom || period.key === 'custom') && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); if (draft.from && draft.to) period.set(draft.from, draft.to); }}
        >
          <label className="text-2xs text-muted-ink">
            Từ ngày
            <input type="date" className="field field-sm block" max={today} value={draft.from}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
          </label>
          <label className="text-2xs text-muted-ink">
            Đến ngày
            <input type="date" className="field field-sm block" max={today} value={draft.to}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
          </label>
          <button type="submit" className="btn btn-sm btn-primary">Xem</button>
        </form>
      )}

      {/* Luôn nói rõ đang xem kỳ nào và so với kỳ nào */}
      <p className="text-2xs text-muted-ink">
        Đang xem <b className="text-ink">{date(period.from)} – {date(period.to)}</b>
        {compare && <> · so với <b className="text-ink">{date(compare.from)} – {date(compare.to)}</b>
          {compare.sameTime && ' (tới cùng giờ)'}</>}
      </p>
    </div>
  );
}
