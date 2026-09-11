/* ====================================================================
   ĐỔI TRẢ HÀNG TẠI QUẦY (tài liệu 02)

   Một nút [Đổi trả hàng] cho cả hai việc. Mở ra là con trỏ đã nằm sẵn
   trong ô tìm hoá đơn — quét mã vạch trên hoá đơn là vào luôn, không cần
   bấm chuột. Khách không giữ hoá đơn thì có đường riêng "Trả hàng nhanh".

   Hai giỏ trên cùng một màn hình:
     A — hàng khách mang trả, lấy từ đúng hoá đơn gốc, theo GIÁ KHÁCH THỰC
         TRẢ (đã chia giảm giá cả đơn, cộng thuế) chứ không theo giá niêm yết;
     B — hàng khách lấy mới.

   Chênh lệch = B − A + Phí đổi trả.
     > 0  khách nộp thêm
     = 0  đổi ngang giá
     < 0  tiệm trả lại: tiền mặt, chuyển khoản, phiếu đổi hàng (không hụt
          két), hoặc cấn trừ vào công nợ cũ của khách.

   Hàng trả chọn tình trạng: đạt chuẩn về kho bán, lỗi/hỏng vào kho lỗi.
   Hoá đơn quá hạn đổi trả, hoặc món thuộc nhóm "không nhận đổi trả" thì
   chặn ngay trên màn hình — máy chủ cũng chặn lại lần nữa.

   Tiệm chưa có chương trình tích điểm, nên không có điểm thưởng để thu hồi.
   ==================================================================== */
import { useState, useMemo, useEffect, useRef } from 'react';
import {
  RefreshCcw, Search, Plus, Trash2, AlertTriangle, Undo2, Printer, ScanLine, CheckCircle2, Ban,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, useDebounced } from '../lib/store';
import { money, n, qty as fq, date, datetime, match } from '../lib/format';
import {
  Button, IconButton, Input, Select, Modal, Field, MoneyInput, Empty, Spinner, Badge,
  QtyInput, SearchInput, TotalRow,
} from './ui';
import { CategorySelect, categoryBranch } from './CategoryTree';
import InvoicePrint from './InvoicePrint';
import { PinApprovalModal } from './PosApproval';
import {
  ConditionToggle, FeeField, RefundMethodPicker, VoucherCard, VoucherPrint, feeOf,
} from './ReturnParts';

export default function ExchangeModal({ open, onClose, products, policy, onQuickReturn, onDone }) {
  const { user, meta, toast, defaultWarehouse, defaultPriceList, store, settings } = useApp();
  const [q, setQ] = useState('');
  const [sale, setSale] = useState(null);
  const [loadingSale, setLoadingSale] = useState(false);
  const [back, setBack] = useState([]);        // giỏ A — hàng khách trả
  const [swap, setSwap] = useState([]);        // giỏ B — hàng khách lấy mới
  const [feeType, setFeeType] = useState('amount');
  const [feeValue, setFeeValue] = useState(0);
  const [refundMethod, setRefundMethod] = useState('cash');
  const [payMethod, setPayMethod] = useState('cash');
  const [paid, setPaid] = useState(0);
  const [paidTouched, setPaidTouched] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [reason, setReason] = useState('');
  const [picking, setPicking] = useState(false);  // false | từ khoá mở sẵn
  const [scanA, setScanA] = useState('');
  const [scanB, setScanB] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pinAsk, setPinAsk] = useState(null);
  const [done, setDone] = useState(null);
  const [printVoucher, setPrintVoucher] = useState(null);
  const [printSale, setPrintSale] = useState(null);
  const searchRef = useRef(null);
  const dq = useDebounced(q, 300);

  const { data: found, busy: searching } = useFetch(
    () => api.sales({ q: dq, status: 'done', page_size: 20 }),
    [dq], { skip: !open || !dq.trim() || !!sale });

  useEffect(() => {
    if (!open) return;
    setQ(''); setSale(null); setBack([]); setSwap([]);
    setFeeType(policy?.returnFeeType === 'percent' ? 'percent' : 'amount');
    setFeeValue(Number(policy?.returnFeeValue) || 0);
    setRefundMethod('cash'); setPayMethod('cash');
    setPaid(0); setPaidTouched(false); setAccountId('');
    setReason(''); setErr(''); setDone(null); setScanA(''); setScanB('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const priceListId = sale?.price_list_id || defaultPriceList;
  const hasCustomer = !!sale?.customer_id;

  /* -------------------------- Chọn hoá đơn gốc -------------------------- */

  const openSale = async (id) => {
    setLoadingSale(true);
    setErr('');
    try {
      const s = await api.sale(id);
      setSale(s);
      setBack(s.items.map((i) => ({
        sale_item_id: i.id,
        product_id: i.product_id,
        name: i.name_snapshot,
        sku: i.sku,
        barcode: i.barcode,
        unit_name: i.unit_name,
        sold: i.qty,
        returned: i.returned_qty || 0,
        max: i.returnable_qty ?? i.qty,
        price: i.net_unit_price ?? i.price,
        listPrice: i.price,
        blocked: i.no_return_category || null,
        qty: 0,
        condition: 'good',
      })));
      if (s.customer_id) setRefundMethod('cash');
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setLoadingSale(false);
    }
  };

  /* Quét mã hoá đơn rồi Enter: tìm thẳng, khỏi đợi danh sách gợi ý */
  const onSearchKey = async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    try {
      const res = await api.sales({ q: term, status: 'done', page_size: 5 });
      const rows = res?.rows || [];
      const exact = rows.find((s) => s.code.toLowerCase() === term.toLowerCase());
      if (exact) openSale(exact.id);
      else if (rows.length === 1) openSale(rows[0].id);
      else if (!rows.length) toast(`Không tìm thấy hoá đơn nào khớp "${term}"`, 'warn');
    } catch (e2) {
      toast(e2.message, 'bad');
    }
  };

  const chooseAnother = () => {
    setSale(null); setBack([]); setSwap([]); setErr('');
    setTimeout(() => searchRef.current?.focus(), 30);
  };

  /* ------------------------------ Hai giỏ ------------------------------ */

  const setBackLine = (i, patch) => setBack((ls) => ls.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const onScanA = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const raw = scanA.trim();
    if (!raw) return;
    const i = back.findIndex((l) => (l.barcode || '') === raw || (l.sku || '').toLowerCase() === raw.toLowerCase());
    if (i < 0) { toast(`Món này không có trong hoá đơn ${sale.code}`, 'warn'); return; }
    const l = back[i];
    if (l.blocked) { toast(`"${l.name}" thuộc nhóm "${l.blocked}" — không nhận đổi trả`, 'bad', 6000); return; }
    if (l.qty >= l.max) { toast(`"${l.name}" chỉ còn trả được ${fq(l.max)} ${l.unit_name}`, 'warn'); return; }
    setBackLine(i, { qty: l.qty + 1 });
    setScanA('');
  };

  const addSwap = (p, qty = 1) => {
    const u = p.units?.find((x) => x.factor === 1) || p.units?.[0];
    if (!u) return;
    const more = Number(qty) > 0 ? Number(qty) : 1;
    setSwap((ls) => {
      const i = ls.findIndex((l) => l.product_id === p.id && l.unit_name === u.unit_name);
      if (i >= 0) {
        const c = [...ls];
        c[i] = { ...c[i], qty: c[i].qty + more };
        return c;
      }
      return [...ls, {
        key: `${p.id}-${u.id}`,
        product_id: p.id, name: p.name, sku: p.sku,
        unit_name: u.unit_name, factor: u.factor, base_unit: p.base_unit,
        qty: more,
        price: u.prices?.[priceListId] ?? u.prices?.[defaultPriceList] ?? 0,
        stock: p.stock, track_stock: p.track_stock,
      }];
    });
  };

  const onScanB = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const term = scanB.trim();
    if (!term) return;
    const exact = products.find((p) => p.barcode === term || (p.sku || '').toLowerCase() === term.toLowerCase());
    const list = exact ? [exact] : products.filter((p) => match(p.name, term) || match(p.alias || '', term));
    if (list.length === 1) { addSwap(list[0]); setScanB(''); }
    else if (!list.length) toast(`Không tìm thấy hàng nào khớp "${term}"`, 'warn');
    else { setPicking(term); setScanB(''); }
  };

  /* ------------------------------ Tính tiền ----------------------------- */

  const backItems = back.filter((l) => l.qty > 0);
  const swapItems = swap.filter((l) => l.qty > 0);
  const A = backItems.reduce((a, l) => a + Math.round(l.qty * l.price), 0);
  const B = swapItems.reduce((a, l) => a + Math.round(l.qty * l.price), 0);
  const fee = feeOf(feeType, feeValue, A);
  /* Máy chủ không thu phí vượt quá tiền hàng trả: phần được trừ thấp nhất là 0 */
  const credit = Math.max(0, A - fee);
  const diff = B - credit;                    // = B − A + Phí khi phí không vượt A
  const customerPays = Math.max(0, diff);
  const shopOwes = Math.max(0, -diff);

  useEffect(() => {
    if (!paidTouched) setPaid(customerPays);
  }, [customerPays, paidTouched]);

  const paidNow = Math.min(Math.max(0, Number(paid) || 0), customerPays);
  const willOwe = customerPays - paidNow;
  const usesMoney = (shopOwes > 0 && ['cash', 'transfer'].includes(refundMethod)) || (customerPays > 0 && paidNow > 0);
  const accountType = shopOwes > 0 ? refundMethod : payMethod;
  const bank = meta.accounts.filter((a) => a.type === 'bank');
  const cashAcc = meta.accounts.filter((a) => a.type !== 'bank');
  const usableAccounts = accountType === 'transfer' && bank.length ? bank : cashAcc;

  /* ------------------------------ Lưu phiếu ----------------------------- */

  const submit = async (approvalToken) => {
    setErr('');
    if (!backItems.length) { setErr('Chưa chọn món khách trả lại — nhập số lượng trả ở giỏ A.'); return; }
    if (sale?.return_expired) {
      setErr(`Hoá đơn ${sale.code} mua cách đây ${sale.age_days} ngày, đã quá hạn đổi trả ${sale.return_days} ngày.`);
      return;
    }
    if (willOwe > 0 && !hasCustomer) {
      setErr('Khách lẻ phải nộp đủ phần chênh lệch — không ghi nợ được cho khách không có hồ sơ.');
      return;
    }
    if (shopOwes > 0 && refundMethod === 'debt' && !hasCustomer) {
      setErr('Cấn trừ vào công nợ thì hoá đơn gốc phải có khách hàng.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.saleExchange({
        sale_id: sale.id,
        customer_id: sale.customer_id || null,
        warehouse_id: defaultWarehouse,
        price_list_id: priceListId,
        user_id: user?.id || null,
        fee_type: feeType,
        fee: feeType === 'amount' ? fee : 0,
        fee_percent: feeType === 'percent' ? Number(feeValue) || 0 : 0,
        reason: reason.trim() || (swapItems.length ? 'Đổi hàng' : 'Khách trả hàng'),
        return_items: backItems.map((l) => ({
          sale_item_id: l.sale_item_id, qty: l.qty, condition: l.condition,
        })),
        new_items: swapItems.map((l) => ({
          product_id: l.product_id, name_snapshot: l.name, unit_name: l.unit_name,
          factor: l.factor, qty: l.qty, price: l.price,
        })),
        paid: paidNow,
        payment_method: payMethod,
        refund_method: refundMethod,
        account_id: accountId || (accountType === 'transfer' ? bank[0]?.id : null) || null,
        approval_token: approvalToken || undefined,
      });
      setDone(res);
      onDone?.(res);
      toast(res.sale_code
        ? `Đổi hàng xong: phiếu trả ${res.return_code}, hoá đơn mới ${res.sale_code}`
        : `Đã lập phiếu trả hàng ${res.return_code}`, 'ok', 6000);
    } catch (e) {
      if (e.needsApproval) setPinAsk({ detail: e.message, reason: 'đổi hàng vượt hạn mức' });
      else setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const printNewSale = async () => {
    try {
      setPrintSale(await api.sale(done.sale_id));
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  /* ------------------------------- Giao diện ---------------------------- */

  const footer = done ? (
    <>
      {done.voucher && <Button icon={Printer} onClick={() => setPrintVoucher(done.voucher)}>In phiếu đổi hàng</Button>}
      {done.sale_id && <Button icon={Printer} onClick={printNewSale}>In hoá đơn mới</Button>}
      <div className="flex-1" />
      <Button variant="primary" onClick={onClose}>Xong</Button>
    </>
  ) : sale ? (
    <>
      <Button onClick={chooseAnother}>Chọn hoá đơn khác</Button>
      <div className="flex-1" />
      <Button onClick={onClose}>Đóng</Button>
      <Button variant="primary" icon={RefreshCcw} onClick={() => submit()} loading={busy}
        disabled={!backItems.length || !!sale.return_expired}>
        {swapItems.length ? 'Xác nhận đổi hàng' : 'Xác nhận trả hàng'}
      </Button>
    </>
  ) : (
    <Button onClick={onClose}>Đóng</Button>
  );

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={done ? 'Đổi trả xong' : 'Đổi trả hàng'}
        subtitle={sale
          ? `Hoá đơn ${sale.code} · ${datetime(sale.ts)} · ${sale.customer_name || 'Khách lẻ'}`
          : 'Quét hoặc gõ mã hoá đơn gốc của khách'}
        size="xl"
        footer={footer}
      >
        {done ? (
          <div className="space-y-3 max-w-2xl mx-auto">
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 flex gap-2 text-[13px] text-emerald-950">
              <CheckCircle2 size={18} className="shrink-0 text-emerald-700" aria-hidden="true" />
              <div>
                Đã lập phiếu trả hàng <b>{done.return_code}</b>
                {done.sale_code && <> và hoá đơn mới <b>{done.sale_code}</b></>}. Hàng trả đã nhập lại kho theo tình trạng.
              </div>
            </div>
            <div className="card p-3 space-y-0.5">
              <TotalRow label="Tiền hàng trả sau phí (khách được trừ)" value={money(done.credit)} />
              {done.sale_code && <TotalRow label="Tiền hàng mới" value={money(done.sale_total)} />}
              {done.paid_now > 0 && <TotalRow label="Khách nộp thêm" value={money(done.paid_now)} />}
              {done.still_owed > 0 && <TotalRow label="Ghi vào công nợ" value={money(done.still_owed)} tone="bad" />}
              {done.shop_refunds > 0 && (
                <TotalRow label={done.refund_method === 'transfer' ? 'Đã chuyển khoản trả khách' : 'Đã hoàn tiền mặt'}
                  value={money(done.shop_refunds)} tone="good" big />
              )}
              {done.debt_offset > 0 && <TotalRow label="Đã cấn trừ vào công nợ cũ" value={money(done.debt_offset)} tone="good" big />}
              {done.voucher && <TotalRow label="Cấp phiếu đổi hàng" value={money(done.voucher.amount)} tone="good" big />}
            </div>
            {done.voucher && <VoucherCard voucher={done.voucher} onPrint={() => setPrintVoucher(done.voucher)} />}
          </div>
        ) : !sale ? (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[16rem]">
                <Search size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-ink" aria-hidden="true" />
                <input
                  ref={searchRef}
                  className="field field-lg pl-9"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={onSearchKey}
                  placeholder="Quét mã vạch hoá đơn, gõ mã hoá đơn, tên hoặc SĐT khách..."
                  aria-label="Tìm hoá đơn gốc"
                  autoFocus
                />
              </div>
              <button
                type="button"
                onClick={onQuickReturn}
                className="text-[13px] font-semibold text-accent hover:underline inline-flex items-center gap-1 cursor-pointer min-h-[36px] px-1"
              >
                <Undo2 size={14} aria-hidden="true" />
                Trả hàng nhanh (Không hóa đơn)
              </button>
            </div>

            {loadingSale ? <Spinner label="Đang mở hoá đơn..." />
              : !dq.trim() ? (
                <Empty
                  icon={ScanLine}
                  title="Quét hoá đơn khách cầm theo"
                  message={`Hoặc gõ số điện thoại khách để tìm. Nhận đổi trả trong ${policy?.returnDays > 0 ? `${policy.returnDays} ngày` : 'mọi thời hạn'} kể từ ngày mua.`}
                />
              ) : searching ? <Spinner />
                : !found?.rows?.length ? (
                  <Empty icon={Search} title="Không tìm thấy hoá đơn nào" message={`Không có hoá đơn khớp "${q}".`} />
                ) : (
                  <div className="table-wrap max-h-[50vh]">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Mã hoá đơn</th><th>Thời gian</th><th>Khách hàng</th>
                          <th className="text-right">Tổng tiền</th><th style={{ width: 80 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {found.rows.map((s) => (
                          <tr key={s.id} className="hoverable clickable" onClick={() => openSale(s.id)}>
                            <td className="font-semibold tabular">{s.code}</td>
                            <td className="whitespace-nowrap text-muted-ink">{datetime(s.ts)}</td>
                            <td>
                              <div className="truncate max-w-[14rem]">{s.customer_name || 'Khách lẻ'}</div>
                              {s.buyer_name && <div className="text-2xs text-violet-700 truncate max-w-[14rem]">Mua hộ: {s.buyer_name}</div>}
                            </td>
                            <td className="num font-semibold">{money(s.total)}</td>
                            <td className="text-center">
                              <Button size="sm" variant="soft" onClick={(e) => { e.stopPropagation(); openSale(s.id); }}>Chọn</Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
          </div>
        ) : (
          <div className="space-y-3">
            {sale.return_expired && (
              <div className="rounded-lg border border-danger/30 bg-red-50 p-2.5 text-[13px] text-red-900 flex gap-2" role="alert">
                <Ban size={16} className="shrink-0 mt-0.5 text-danger" aria-hidden="true" />
                <div>
                  Hoá đơn này mua cách đây <b>{sale.age_days} ngày</b>, đã quá hạn đổi trả <b>{sale.return_days} ngày</b>.
                  Không nhận đổi trả được.
                </div>
              </div>
            )}

            {/* ------------------------ Giỏ A ------------------------ */}
            <section className="rounded-lg border border-line" aria-labelledby="ex-a">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line bg-muted/40">
                <h3 id="ex-a" className="font-bold text-sm">1. Hàng khách trả (A)</h3>
                <span className="text-2xs text-muted-ink">theo giá khách thực trả trên hoá đơn</span>
                <div className="flex-1" />
                <div className="relative w-56">
                  <ScanLine size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-ink" aria-hidden="true" />
                  <input className="field field-sm pl-7" value={scanA} onChange={(e) => setScanA(e.target.value)}
                    onKeyDown={onScanA} placeholder="Quét mã hàng trả..." aria-label="Quét mã hàng khách trả"
                    disabled={!!sale.return_expired} />
                </div>
              </div>
              <div className="table-wrap !border-0 !rounded-none">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Tên hàng</th>
                      <th className="text-right">Đã mua</th>
                      <th className="text-right">Giá khách trả</th>
                      <th style={{ width: 96 }} className="text-right">Trả lại</th>
                      <th>Tình trạng</th>
                      <th className="text-right">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {back.map((l, i) => {
                      const off = !!l.blocked || l.max <= 0 || !!sale.return_expired;
                      return (
                        <tr key={l.sale_item_id} className={l.qty > 0 ? 'bg-emerald-50/60' : ''}>
                          <td>
                            <div className={off ? 'text-muted-ink' : 'font-medium'}>{l.name}</div>
                            <div className="text-2xs text-muted-ink">
                              {l.unit_name}
                              {l.returned > 0 && <> · đã trả {fq(l.returned)}</>}
                            </div>
                            {l.blocked && <Badge tone="bad">Nhóm "{l.blocked}" không nhận đổi trả</Badge>}
                            {!l.blocked && l.max <= 0 && <Badge tone="mute">Đã trả hết</Badge>}
                          </td>
                          <td className="num text-muted-ink">{fq(l.sold)}</td>
                          <td className="num">
                            <span className="font-semibold">{money(l.price)}</span>
                            {l.listPrice > l.price && (
                              <div className="text-2xs text-muted-ink line-through">{money(l.listPrice)}</div>
                            )}
                          </td>
                          <td>
                            <QtyInput value={l.qty} min={0} max={l.max} disabled={off}
                              aria-label={`Số lượng trả ${l.name}`}
                              onChange={(v) => setBackLine(i, { qty: Math.max(0, Math.min(Number(v) || 0, l.max)) })} />
                          </td>
                          <td>
                            <ConditionToggle value={l.condition} disabled={off || !(l.qty > 0)}
                              label={`Tình trạng ${l.name}`} onChange={(c) => setBackLine(i, { condition: c })} />
                          </td>
                          <td className="num font-semibold">{money(Math.round(l.qty * l.price))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-1.5 px-3 py-2 border-t border-line">
                <Button size="sm" disabled={!!sale.return_expired}
                  onClick={() => setBack((ls) => ls.map((x) => (x.blocked ? x : { ...x, qty: x.max })))}>
                  Trả hết phần còn trả được
                </Button>
                <Button size="sm" onClick={() => setBack((ls) => ls.map((x) => ({ ...x, qty: 0 })))}>Bỏ chọn hết</Button>
                <div className="flex-1" />
                <span className="text-[13px] font-semibold self-center">A = <span className="tabular">{money(A)}</span></span>
              </div>
            </section>

            {/* ------------------------ Giỏ B ------------------------ */}
            <section className="rounded-lg border border-line" aria-labelledby="ex-b">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line bg-muted/40">
                <h3 id="ex-b" className="font-bold text-sm">2. Hàng khách lấy mới (B)</h3>
                <span className="text-2xs text-muted-ink">bỏ trống nếu chỉ trả hàng</span>
                <div className="flex-1" />
                <div className="relative w-56">
                  <ScanLine size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-ink" aria-hidden="true" />
                  <input className="field field-sm pl-7" value={scanB} onChange={(e) => setScanB(e.target.value)}
                    onKeyDown={onScanB} placeholder="Quét mã / gõ tên hàng mới..." aria-label="Quét hoặc gõ hàng khách lấy mới" />
                </div>
                <Button size="sm" icon={Plus} onClick={() => setPicking('')}>Chọn hàng</Button>
              </div>
              {swap.length === 0 ? (
                <div className="px-3 py-4 text-center text-[13px] text-muted-ink">
                  Chưa có hàng mới. Để trống thì đây là phiếu trả hàng, tiệm trả lại khách.
                </div>
              ) : (
                <div className="table-wrap !border-0 !rounded-none">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Tên hàng</th>
                        <th className="text-right">Tồn kho</th>
                        <th style={{ width: 96 }} className="text-right">Số lượng</th>
                        <th style={{ width: 130 }} className="text-right">Đơn giá</th>
                        <th className="text-right">Thành tiền</th>
                        <th style={{ width: 44 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {swap.map((l, i) => (
                        <tr key={l.key}>
                          <td>
                            <div className="font-medium">{l.name}</div>
                            <div className="text-2xs text-muted-ink">{l.unit_name}</div>
                          </td>
                          <td className={`num ${l.track_stock && l.stock < l.qty * l.factor ? 'text-danger font-semibold' : 'text-muted-ink'}`}>
                            {l.track_stock ? `${fq(l.stock)} ${l.base_unit || ''}` : '—'}
                          </td>
                          <td>
                            <QtyInput value={l.qty} min={0} aria-label={`Số lượng ${l.name}`}
                              onChange={(v) => setSwap((ls) => ls.map((x, j) => (j === i ? { ...x, qty: v } : x)))} />
                          </td>
                          <td>
                            <MoneyInput size="sm" value={l.price} aria-label={`Đơn giá ${l.name}`}
                              onChange={(v) => setSwap((ls) => ls.map((x, j) => (j === i ? { ...x, price: v } : x)))} />
                          </td>
                          <td className="num font-semibold">{money(Math.round((Number(l.qty) || 0) * l.price))}</td>
                          <td className="text-center">
                            <IconButton icon={Trash2} label={`Bỏ ${l.name}`} size={14}
                              onClick={() => setSwap((ls) => ls.filter((_, j) => j !== i))} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {swap.length > 0 && (
                <div className="flex justify-end px-3 py-2 border-t border-line">
                  <span className="text-[13px] font-semibold">B = <span className="tabular">{money(B)}</span></span>
                </div>
              )}
            </section>

            {/* ---------------------- Tiền chênh lệch ---------------------- */}
            <div className="grid lg:grid-cols-2 gap-3">
              <div className="space-y-2.5">
                <Field label="Phí đổi trả" hint="Trả muộn, mất nhãn mác, hộp móp... Để 0 nếu không thu." htmlFor="ex-fee">
                  <FeeField id="ex-fee" type={feeType} value={feeValue} onType={setFeeType} onValue={setFeeValue} base={A} />
                  {fee > A && A > 0 && <p className="hint !text-warn">Phí không trừ quá tiền hàng trả — chỉ tính tối đa {money(A)}.</p>}
                </Field>
                <Field label="Lý do" htmlFor="ex-reason">
                  <Input id="ex-reason" value={reason} onChange={(e) => setReason(e.target.value)}
                    placeholder="VD: hàng lỗi, khách lấy nhầm quy cách" />
                </Field>

                {customerPays > 0 && (
                  <>
                    <Field label="Khách nộp thêm bây giờ" htmlFor="ex-paid"
                      hint={hasCustomer ? 'Nộp thiếu thì phần còn lại ghi vào công nợ của khách' : 'Khách lẻ phải nộp đủ'}>
                      <MoneyInput id="ex-paid" value={paid}
                        onChange={(v) => { setPaidTouched(true); setPaid(Math.max(0, v)); }} />
                    </Field>
                    <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Khách nộp bằng">
                      {[['cash', 'Tiền mặt'], ['transfer', 'Chuyển khoản']].map(([k, lb]) => (
                        <button key={k} type="button" role="radio" aria-checked={payMethod === k}
                          onClick={() => { setPayMethod(k); setAccountId(''); }}
                          className={`btn btn-sm ${payMethod === k ? 'btn-secondary' : 'btn-outline'}`}>
                          {lb}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {shopOwes > 0 && (
                  <Field label={`Trả lại khách ${money(shopOwes)} bằng`}>
                    <RefundMethodPicker value={refundMethod} hasCustomer={hasCustomer} name="ex-refund"
                      onChange={(m) => { setRefundMethod(m); setAccountId(''); }} />
                  </Field>
                )}

                {usesMoney && (
                  <Field label={shopOwes > 0 ? 'Chi từ quỹ' : 'Vào quỹ'} htmlFor="ex-account">
                    <Select id="ex-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                      <option value="">{accountType === 'transfer' && bank.length ? bank[0].name : 'Quỹ mặc định'}</option>
                      {usableAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </Select>
                  </Field>
                )}
              </div>

              <div className="card p-3 space-y-0.5 h-fit">
                <TotalRow label="Tổng tiền hàng trả (A)" value={money(A)} />
                <TotalRow label="Tổng tiền mua mới (B)" value={money(B)} />
                <TotalRow label="Phí đổi trả" value={fee > 0 ? `+ ${money(Math.min(fee, A))}` : '0 đ'} />
                <div className="border-t border-line my-1" />
                {customerPays > 0 ? (
                  <>
                    <TotalRow label="Khách nộp thêm" value={money(customerPays)} big tone="bad" />
                    {willOwe > 0 && <TotalRow label="Ghi vào công nợ" value={money(willOwe)} tone="bad" />}
                  </>
                ) : shopOwes > 0 ? (
                  <TotalRow label="Tiệm trả lại khách" value={money(shopOwes)} big tone="good" />
                ) : (
                  <TotalRow label="Đổi ngang giá" value="0 đ" big />
                )}
                <p className="text-2xs text-muted-ink pt-1.5 leading-relaxed">
                  Chênh lệch = B − A + Phí. Phần bù trừ giữa hai giỏ không chạy qua két —
                  chỉ phần chênh thật mới ghi thu hoặc chi.
                </p>
                {sale.customer_name && (
                  <p className="text-2xs text-muted-ink">Khách: <b>{sale.customer_name}</b> · mua {date(sale.ts)}</p>
                )}
              </div>
            </div>

            {err && (
              <p role="alert" className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5 flex gap-2">
                <AlertTriangle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
                {err}
              </p>
            )}
          </div>
        )}
      </Modal>

      <SwapProductPicker
        open={picking !== false}
        initialQuery={typeof picking === 'string' ? picking : ''}
        onClose={() => setPicking(false)}
        products={products || []}
        priceListId={priceListId}
        onPick={addSwap}
      />

      <PinApprovalModal
        open={!!pinAsk}
        reason={pinAsk?.reason}
        detail={pinAsk?.detail}
        onClose={() => setPinAsk(null)}
        onApproved={(res) => { setPinAsk(null); submit(res.token); }}
      />

      {printVoucher && (
        <VoucherPrint voucher={printVoucher} customerName={sale?.customer_name} onClose={() => setPrintVoucher(null)} />
      )}
      {printSale && (
        <InvoicePrint sale={printSale} store={store} invoice={settings?.invoice || {}} onClose={() => setPrintSale(null)} />
      )}
    </>
  );
}

/** Bảng chọn hàng khách lấy mới — hiện giá bán và tồn, không hiện giá vốn. */
function SwapProductPicker({ open, onClose, products, onPick, priceListId, initialQuery }) {
  const { meta } = useApp();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');

  useEffect(() => { if (open) setQ(initialQuery || ''); }, [open, initialQuery]);

  const list = useMemo(() => {
    let l = products;
    if (cat) {
      const branch = categoryBranch(meta.categories, cat);
      if (branch) l = l.filter((p) => branch.has(p.category_id));
    }
    if (q.trim()) {
      l = l.filter((p) => match(p.name, q) || match(p.alias || '', q) || match(p.sku, q)
        || (p.barcode || '').includes(q.trim()));
    }
    return l.slice(0, 300);
  }, [products, q, cat, meta.categories]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Chọn hàng khách lấy mới"
      size="lg"
      footer={<Button variant="primary" onClick={onClose}>Xong</Button>}
    >
      <div className="space-y-2">
        <div className="flex gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Gõ tên hàng hoặc quét mã vạch..." className="flex-1" autoFocus />
          <CategorySelect value={cat} onChange={setCat} categories={meta.categories} className="!w-auto"
            ariaLabel="Lọc theo nhóm hàng" />
        </div>
        {list.length === 0 ? (
          <Empty icon={Search} title="Không tìm thấy hàng nào" message={`Không có mặt hàng khớp "${q}".`} />
        ) : (
          <div className="table-wrap max-h-[50vh]">
            <table className="data">
              <thead>
                <tr>
                  <th>Mã hàng</th><th>Tên hàng</th>
                  <th className="text-right">Tồn kho</th>
                  <th className="text-right">Giá bán</th>
                  <th style={{ width: 60 }} />
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const u = p.units?.find((x) => x.factor === 1) || p.units?.[0];
                  const price = u?.prices?.[priceListId] ?? Object.values(u?.prices || {})[0] ?? 0;
                  return (
                    <tr key={p.id} className="hoverable clickable" onClick={() => onPick(p)}>
                      <td className="tabular text-muted-ink">{p.sku}</td>
                      <td>
                        <div>{p.name}</div>
                        {p.alias && <div className="text-2xs text-muted-ink truncate">{p.alias}</div>}
                      </td>
                      <td className={`num ${p.track_stock && p.stock <= 0 ? 'text-danger' : ''}`}>
                        {p.track_stock ? `${fq(p.stock)} ${p.base_unit}` : '—'}
                      </td>
                      <td className="num font-semibold">{money(price)}</td>
                      <td className="text-center">
                        <IconButton icon={Plus} label={`Chọn ${p.name}`}
                          onClick={(e) => { e.stopPropagation(); onPick(p); }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
