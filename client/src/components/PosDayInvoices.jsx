/* ====================================================================
   HOÁ ĐƠN TRONG NGÀY (plan 31, hạng mục 1.1 + 1.2b)

   Một nút trên màn hình bán hàng mở ra hai khung:
     trái  — hoá đơn bán ra trong ngày (mặc định hôm nay, đổi ngày được)
     phải  — chi tiết hoá đơn đang chọn, kèm In lại và Đổi - Trả hàng

   Nút "Đổi trả hàng" cũ trên thanh POS bỏ hẳn (1.1c): khách mang hàng
   quay lại thì thu ngân mở danh sách này, tìm đúng hoá đơn, đổi trả ngay
   trong đó. Hoá đơn ngày khác hoặc khách không giữ hoá đơn thì dùng nút
   "Đổi trả nhanh" (1.1g) — chính hộp đổi trả sẵn có, tìm hoá đơn mọi ngày
   và có đường Trả hàng không hoá đơn.

   Giá vốn, lãi, hoa hồng mua hộ chỉ hiện với người có quyền xem giá vốn
   (1.1d). Máy chủ đã cắt hẳn các trường đó khỏi dữ liệu trả về — ở đây
   không hiện dòng trống "Giá vốn: 0 đ" cho nhân viên.

   Tách thành tệp riêng, không viết vào POS.jsx (plan 31, §3.1).
   ==================================================================== */
import { useState, useEffect, useMemo, useRef } from 'react';
import {
  ChevronLeft, ChevronRight, Printer, RefreshCcw, ReceiptText, Undo2, Handshake, ArrowLeft,
  CalendarDays,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, useDebounced } from '../lib/store';
import { money, n, qty as fq, date, datetime, time, isoDate, PAYMENT_LABEL } from '../lib/format';
import { Modal, Button, Badge, Empty, Spinner, SearchInput, ErrorBox } from './ui';
import InvoicePrint from './InvoicePrint';

const PAGE = 50;

const shiftDay = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + days));
};

const dayLabel = (iso) => {
  const today = isoDate();
  if (iso === today) return 'Hôm nay';
  if (iso === shiftDay(today, -1)) return 'Hôm qua';
  return date(iso);
};

/**
 * @param onExchange      (sale) => void — mở hộp đổi trả với đúng hoá đơn này
 * @param onQuickExchange () => void — mở hộp đổi trả trống (hoá đơn ngày khác / không hoá đơn)
 */
export default function PosDayInvoices({ open, onClose, onExchange, onQuickExchange }) {
  const { can, store, settings } = useApp();
  const seeCost = can('cost.view');
  const mayReturn = can('sale.return');

  const [day, setDay] = useState(isoDate());
  const [q, setQ] = useState('');
  const [size, setSize] = useState(PAGE);
  const [selId, setSelId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailErr, setDetailErr] = useState(null);
  const [printing, setPrinting] = useState(null);
  const [detailTick, setDetailTick] = useState(0);   // bấm Thử lại khi mở chi tiết lỗi mạng
  const dq = useDebounced(q, 300);
  const listRef = useRef(null);
  const wide = typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches;

  /* Mở lại là về hôm nay, danh sách mới — hoá đơn vừa chốt phải có mặt */
  useEffect(() => {
    if (!open) return;
    setDay(isoDate()); setQ(''); setSize(PAGE); setSelId(null); setDetail(null); setDetailErr(null);
  }, [open]);

  const { data, busy, error, reload } = useFetch(
    () => api.sales({ from: day, to: day, q: dq, page_size: size }),
    [day, dq, size], { skip: !open },
  );
  const rows = data?.rows || [];
  const totals = data?.totals || {};

  /* Màn hình rộng: tự chọn hoá đơn mới nhất cho khung bên phải khỏi trống */
  useEffect(() => {
    if (!open || !wide || busy) return;
    if (rows.length && !rows.some((r) => r.id === selId)) setSelId(rows[0].id);
    if (!rows.length) { setSelId(null); setDetail(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, busy, open]);

  useEffect(() => {
    if (!selId) return undefined;
    let alive = true;
    setLoadingDetail(true);
    setDetailErr(null);
    api.sale(selId)
      .then((s) => { if (alive) setDetail(s); })
      .catch((e) => { if (alive) setDetailErr(e); })
      .finally(() => { if (alive) setLoadingDetail(false); });
    return () => { alive = false; };
  }, [selId, detailTick]);

  /* ↑ ↓ chuyển hoá đơn khi con trỏ đang ở danh sách */
  const onListKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = rows.findIndex((r) => r.id === selId);
    const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      setSelId(next.id);
      listRef.current?.querySelector(`[data-sale="${next.id}"]`)?.focus();
    }
  };

  const showDetailOnly = !wide && !!selId;

  return (
    <>
      <Modal
        open={open}
        /* Đang mở hộp in thì Esc chỉ đóng hộp in, không đóng luôn danh sách */
        onClose={printing ? () => {} : onClose}
        title="Hoá đơn trong ngày"
        subtitle={`${dayLabel(day)}${day !== isoDate() ? ` · ${date(day)}` : ''} · bấm một hoá đơn để xem chi tiết, in lại hoặc đổi trả`}
        size="full"
        footer={<>
          {mayReturn && (
            <Button icon={RefreshCcw} onClick={onQuickExchange}
              title="Khách không giữ hoá đơn, hoặc hoá đơn thuộc ngày khác">
              Đổi trả nhanh
            </Button>
          )}
          <div className="flex-1" />
          <Button onClick={onClose}>Đóng</Button>
        </>}
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(320px,400px)_1fr] lg:h-[calc(100vh-15.5rem)]">
          {/* ============================ Khung trái ============================ */}
          <section className={`flex flex-col min-h-0 gap-2 ${showDetailOnly ? 'hidden' : ''}`} aria-label="Danh sách hoá đơn">
            <div className="flex items-center gap-1">
              <Button size="sm" icon={ChevronLeft} aria-label="Ngày trước" onClick={() => { setDay((d) => shiftDay(d, -1)); setSelId(null); }} />
              <label className="relative flex-1">
                <span className="sr-only">Chọn ngày</span>
                <CalendarDays size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-ink pointer-events-none" aria-hidden="true" />
                <input
                  type="date"
                  className="field field-sm pl-7 w-full"
                  value={day}
                  max={isoDate()}
                  onChange={(e) => { if (e.target.value) { setDay(e.target.value); setSelId(null); } }}
                />
              </label>
              <Button size="sm" icon={ChevronRight} aria-label="Ngày sau" disabled={day >= isoDate()}
                onClick={() => { setDay((d) => shiftDay(d, 1)); setSelId(null); }} />
              {day !== isoDate() && (
                <Button size="sm" onClick={() => { setDay(isoDate()); setSelId(null); }}>Hôm nay</Button>
              )}
            </div>
            <SearchInput size="sm" value={q} onChange={(v) => { setQ(v); setSize(PAGE); }}
              placeholder="Tìm số hoá đơn, khách, SĐT, người mua hộ" />

            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-muted-ink px-0.5" aria-live="polite">
              <span><b className="text-ink tabular">{n(totals.count || 0)}</b> hoá đơn</span>
              <span>Doanh thu <b className="text-ink tabular">{money(totals.revenue || 0)}</b></span>
              {totals.unpaid > 0 && <span className="text-danger">Còn nợ <b className="tabular">{money(totals.unpaid)}</b></span>}
              {seeCost && totals.profit !== undefined && (
                <span className="text-emerald-700">Lãi <b className="tabular">{money(totals.profit)}</b></span>
              )}
            </div>

            <div ref={listRef} onKeyDown={onListKey}
              className="flex-1 min-h-0 overflow-y-auto rounded border border-line bg-card divide-y divide-line max-h-[60vh] lg:max-h-none">
              {error ? <ErrorBox error={error} onRetry={reload} />
                : busy && !rows.length ? <Spinner />
                  : !rows.length ? (
                    <Empty icon={ReceiptText}
                      title={dq ? 'Không có hoá đơn nào khớp' : `${dayLabel(day)} chưa bán hoá đơn nào`}
                      message={dq ? 'Thử từ khoá khác, hoặc đổi sang ngày khác.' : 'Đổi sang ngày khác bằng hai nút mũi tên hoặc ô chọn ngày.'} />
                  ) : (
                    <>
                      {rows.map((s) => (
                        <InvoiceRow key={s.id} s={s} active={s.id === selId} onPick={() => setSelId(s.id)} />
                      ))}
                      {rows.length < (data?.total || 0) && (
                        <div className="p-2 text-center">
                          <Button size="sm" loading={busy} onClick={() => setSize((x) => x + PAGE)}>
                            Xem thêm ({n(data.total - rows.length)} hoá đơn nữa)
                          </Button>
                        </div>
                      )}
                    </>
                  )}
            </div>
          </section>

          {/* ============================ Khung phải ============================ */}
          <section className={`min-h-0 flex flex-col ${!wide && !selId ? 'hidden' : ''}`} aria-label="Chi tiết hoá đơn">
            {!wide && selId && (
              <Button size="sm" icon={ArrowLeft} className="self-start mb-2" onClick={() => { setSelId(null); setDetail(null); }}>
                Về danh sách
              </Button>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto lg:rounded lg:border lg:border-line bg-card">
              {detailErr ? <ErrorBox error={detailErr} onRetry={() => setDetailTick((t) => t + 1)} />
                : !selId ? (
                  <Empty icon={ReceiptText} title="Chưa chọn hoá đơn" message="Bấm một hoá đơn bên trái để xem chi tiết." />
                ) : !detail || (loadingDetail && detail.id !== selId) ? <Spinner label="Đang mở hoá đơn..." />
                  : (
                    <InvoiceDetail
                      s={detail}
                      seeCost={seeCost}
                      mayReturn={mayReturn}
                      dim={loadingDetail}
                      onPrint={() => setPrinting(detail)}
                      onExchange={() => onExchange(detail)}
                    />
                  )}
            </div>
          </section>
        </div>
      </Modal>

      {printing && (
        <InvoicePrint
          sale={printing}
          store={store}
          invoice={settings?.invoice || {}}
          onClose={() => setPrinting(null)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function InvoiceRow({ s, active, onPick }) {
  const cancelled = s.status === 'cancelled';
  const owes = !cancelled && s.total - s.paid > 0;
  return (
    <button
      type="button"
      data-sale={s.id}
      onClick={onPick}
      aria-pressed={active}
      className={`w-full text-left px-3 py-2 flex flex-col gap-0.5 cursor-pointer transition-colors duration-100
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent
                  ${active ? 'bg-accent-soft/60 shadow-[inset_3px_0_0] shadow-accent' : 'hover:bg-muted/60'}
                  ${cancelled ? 'opacity-60' : ''}`}
    >
      {/* Số hoá đơn là thứ phải đọc được — không bao giờ cắt cụt */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="font-mono text-[13px] font-semibold shrink-0">{s.code}</span>
        <span className="text-2xs text-muted-ink tabular shrink-0">{time(s.ts)}</span>
        <span className={`ml-auto font-mono tabular text-[13px] font-bold shrink-0 ${cancelled ? 'line-through' : ''}`}>
          {money(s.total)}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-2xs text-muted-ink min-w-0">
        <span className="truncate">{s.customer_name || 'Khách lẻ'}</span>
        <span className="shrink-0 tabular">· {n(s.item_count)} món</span>
        {s.consign_count > 0 && (
          <span className="shrink-0 text-violet-700 inline-flex items-center gap-0.5">
            · <Handshake size={11} aria-hidden="true" /> {n(s.consign_count)} mua hộ
          </span>
        )}
        {(cancelled || owes) && (
          <span className="ml-auto shrink-0">
            {cancelled ? <Badge tone="bad">Đã huỷ</Badge> : <Badge tone="warn">Nợ {money(s.total - s.paid)}</Badge>}
          </span>
        )}
      </div>
      {/* Người mua hộ (1.2b): thợ lấy hàng cho chủ nhà — nhìn danh sách là biết ai cầm hàng đi */}
      {s.buyer_name && (
        <div className="text-2xs text-violet-800 truncate">
          Người mua hộ: <b>{s.buyer_name}</b>{s.buyer_phone ? ` · ${s.buyer_phone}` : ''}
        </div>
      )}
    </button>
  );
}

function InvoiceDetail({ s, seeCost, mayReturn, dim, onPrint, onExchange }) {
  const cancelled = s.status === 'cancelled';
  const returnable = (s.items || []).some((it) => (it.returnable_qty ?? it.qty) > 0);
  const consign = s.consign_items || [];
  const costKnown = seeCost && s.cogs !== undefined;
  const lineCount = (s.items?.length || 0) + consign.length;

  const summary = useMemo(() => ([
    ['Tiền hàng', money(s.subtotal)],
    s.discount > 0 && ['Giảm giá', `-${money(s.discount)}`],
    s.vat_amount > 0 && ['Thuế GTGT', money(s.vat_amount)],
    s.voucher_amount > 0 && ['Trừ phiếu đổi hàng', `-${money(s.voucher_amount)}`],
  ].filter(Boolean)), [s]);

  return (
    <div className={`lg:p-3 space-y-3 transition-opacity ${dim ? 'opacity-60' : ''}`}>
      {/* --------- Đầu hoá đơn + hai nút xử lý --------- */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="font-mono font-bold text-base">{s.code}</h3>
            {cancelled && <Badge tone="bad">Đã huỷ</Badge>}
            {s.is_vat_invoice === 1 && <Badge tone="info">Có HĐ GTGT</Badge>}
            {s.returns?.length > 0 && <Badge tone="warn">Đã có {s.returns.length} phiếu trả</Badge>}
          </div>
          <p className="text-2xs text-muted-ink">
            {datetime(s.ts)} · {s.user_name || '—'} · {PAYMENT_LABEL[s.payment_method] || s.payment_method}
          </p>
        </div>
        <div className="grid grid-cols-2 sm:flex gap-1.5 shrink-0">
          <Button size="sm" icon={Printer} onClick={onPrint}>In lại hoá đơn</Button>
          {mayReturn && !cancelled && (
            <Button size="sm" variant="primary" icon={Undo2} onClick={onExchange} disabled={!returnable}
              title={returnable ? 'Đổi hoặc trả các món trong hoá đơn này' : 'Các món trong hoá đơn đã trả hết'}>
              Đổi - Trả hàng
            </Button>
          )}
        </div>
      </div>

      {/* --------- Khách + người mua hộ --------- */}
      <div className="grid gap-2 sm:grid-cols-2 text-[13px]">
        <div className="rounded border border-line p-2.5">
          <div className="text-2xs font-bold text-muted-ink uppercase mb-0.5">Khách hàng</div>
          <div className="font-semibold">{s.customer_name || 'Khách lẻ'}</div>
          {s.customer_phone && <div className="text-muted-ink">{s.customer_phone}</div>}
          {s.buyer_name && (
            <div className="text-violet-800 mt-0.5">
              Người mua hộ: <b>{s.buyer_name}</b>{s.buyer_phone ? ` · ${s.buyer_phone}` : ''}
            </div>
          )}
        </div>
        <div className="rounded border border-line p-2.5">
          <div className="text-2xs font-bold text-muted-ink uppercase mb-0.5">Thông tin đơn</div>
          <div>Kho xuất: {s.warehouse_name || '—'}</div>
          <div>Bảng giá: {s.price_list_name || 'Giá lẻ'}</div>
          {s.cod_amount > 0 && <div>Thu hộ COD: {money(s.cod_amount)}</div>}
        </div>
      </div>

      {/* --------- Hàng của tiệm --------- */}
      <ul className="sm:hidden divide-y divide-line rounded border border-line text-[13px]">
        {(s.items || []).map((it) => (
          <li key={it.id} className="px-2.5 py-2">
            <div className="font-semibold leading-snug">{it.name_snapshot}</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xs text-muted-ink tabular">
                {fq(it.qty)} {it.unit_name} × {money(it.price)}
              </span>
              <span className="ml-auto font-mono tabular font-semibold">{money(it.amount)}</span>
            </div>
            {(it.returned_qty > 0 || it.warranty_months > 0) && (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {it.returned_qty > 0 && <Badge tone="warn">Đã trả {fq(it.returned_qty)}</Badge>}
                {it.warranty_months > 0 && <Badge tone="ok">BH {it.warranty_months} tháng</Badge>}
              </div>
            )}
          </li>
        ))}
        {!s.items?.length && <li className="px-2.5 py-2 text-2xs text-muted-ink">Hoá đơn chỉ có hàng mua hộ</li>}
      </ul>
      <div className="table-wrap hidden sm:block">
        <table className="data">
          <thead>
            <tr>
              <th>Tên hàng</th>
              <th>ĐVT</th>
              <th className="text-right">SL</th>
              <th className="text-right">Đơn giá</th>
              <th className="text-right">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {(s.items || []).map((it) => (
              <tr key={it.id}>
                <td>
                  <div className="font-semibold">{it.name_snapshot}</div>
                  <div className="flex flex-wrap items-center gap-1 text-2xs text-muted-ink">
                    <span className="font-mono">{it.sku}</span>
                    {it.returned_qty > 0 && <Badge tone="warn">Đã trả {fq(it.returned_qty)}</Badge>}
                    {it.warranty_months > 0 && <Badge tone="ok">BH {it.warranty_months} tháng</Badge>}
                    {it.serial && <span className="font-mono">SN {it.serial}</span>}
                  </div>
                </td>
                <td>{it.unit_name}</td>
                <td className="num">{fq(it.qty)}</td>
                <td className="num">{money(it.price)}</td>
                <td className="num font-semibold">{money(it.amount)}</td>
              </tr>
            ))}
            {!s.items?.length && (
              <tr><td colSpan={5} className="text-center text-muted-ink text-2xs">Hoá đơn chỉ có hàng mua hộ</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* --------- Hàng mua hộ vãng lai --------- */}
      {consign.length > 0 && (
        <div className="rounded border border-violet-200 bg-violet-50/40">
          <div className="px-2.5 py-1.5 text-2xs font-bold text-violet-900 uppercase flex items-center gap-1">
            <Handshake size={12} aria-hidden="true" /> Hàng mua hộ ({n(consign.length)} món)
          </div>
          <ul className="divide-y divide-violet-100 text-[13px]">
            {consign.map((c) => (
              <li key={c.id} className="px-2.5 py-1.5 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{c.name}</div>
                  <div className="text-2xs text-muted-ink">
                    {fq(c.qty)} {c.unit_name} × {money(c.price)}
                    {c.partner_name && <> · của {c.partner_name}</>}
                    {seeCost && c.commission > 0 && <> · hoa hồng {money(c.commission)}</>}
                  </div>
                </div>
                <span className="font-mono tabular font-semibold">{money(c.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* --------- Cộng tiền --------- */}
      <div className="flex justify-end">
        <div className="w-full sm:w-72 space-y-1 text-[13px]">
          {summary.map(([label, value]) => (
            <div key={label} className="flex justify-between">
              <span className="text-muted-ink">{label}</span><span className="tabular font-mono">{value}</span>
            </div>
          ))}
          <div className="flex justify-between pt-1.5 border-t border-line font-bold text-base">
            <span>Tổng cộng</span><span className="tabular font-mono text-accent">{money(s.total)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-ink">Đã thanh toán</span><span className="tabular font-mono">{money(s.paid)}</span>
          </div>
          {!cancelled && s.total - s.paid > 0 && (
            <div className="flex justify-between font-semibold text-danger">
              <span>Còn nợ</span><span className="tabular font-mono">{money(s.total - s.paid)}</span>
            </div>
          )}
          {/* Giá vốn + lãi: chỉ người có quyền xem (1.1d) */}
          {costKnown && (
            <>
              <div className="flex justify-between pt-1.5 border-t border-line text-muted-ink">
                <span>Giá vốn</span><span className="tabular font-mono">{money(s.cogs)}</span>
              </div>
              <div className="flex justify-between font-semibold text-emerald-700">
                <span>Lợi nhuận</span>
                <span className="tabular font-mono">{money(s.total - s.vat_amount - s.cogs)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {s.note && (
        <div className="rounded border border-line p-2.5 text-[13px]">
          <span className="font-semibold">Ghi chú: </span>{s.note}
        </div>
      )}

      {s.returns?.length > 0 && (
        <div className="rounded border border-line p-2.5">
          <div className="text-2xs font-bold text-muted-ink uppercase mb-1">Phiếu trả hàng của hoá đơn này</div>
          {s.returns.map((rt) => (
            <div key={rt.id} className="flex justify-between text-[13px] py-0.5">
              <span className="font-mono">{rt.code} · {datetime(rt.ts)}</span>
              <span className="tabular font-mono">{money(rt.total)}</span>
            </div>
          ))}
        </div>
      )}

      <p className="text-2xs text-muted-ink">{n(lineCount)} dòng hàng</p>
    </div>
  );
}
