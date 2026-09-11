/* ====================================================================
   TRẢ HÀNG NHANH — KHÔNG CÓ HOÁ ĐƠN (tài liệu 02)

   Khách xách món hàng tới, bảo mua ở đây tuần trước, không giữ hoá đơn.
   Chuyện thường ngày ở tiệm điện — không thể bắt khách về tìm giấy.

   Khác với trả theo hoá đơn ở một điểm quan trọng: ở đây KHÔNG CÓ GÌ KIỂM
   CHỨNG. Phần mềm không biết món này có bán ở tiệm không, bán giá bao
   nhiêu, bán bao lâu rồi. Nên:

     - giá trả mặc định lấy GIÁ BÁN ĐANG NIÊM YẾT, sửa được;
     - bắt buộc ghi lý do, tránh lập phiếu khống rồi rút tiền két;
     - vẫn chặn món thuộc nhóm "không nhận đổi trả".

   Trả lại khách được bằng tiền mặt, chuyển khoản, phiếu đổi hàng hoặc cấn
   trừ nợ — hai cách sau không đụng tới két. Hàng lỗi vào kho hàng lỗi.
   ==================================================================== */
import { useState, useMemo, useEffect } from 'react';
import { Undo2, Plus, Trash2, AlertTriangle, Search } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { money } from '../lib/format';
import {
  Button, IconButton, Input, Select, Modal, Field, MoneyInput, Empty, Badge, Textarea, QtyInput,
  ErrorBox, TotalRow,
} from './ui';
import { ProductPicker } from './ProductPicker';
import {
  ConditionToggle, FeeField, RefundMethodPicker, REFUND_METHODS, VoucherPrint, feeOf,
} from './ReturnParts';

/** Giá bán đang niêm yết của một món, theo bảng giá đang dùng. */
function listedPrice(p, priceListId) {
  const u = p.units?.find((x) => x.factor === 1) || p.units?.[0];
  if (!u) return 0;
  return Number(u.prices?.[priceListId]) || Number(Object.values(u.prices || {})[0]) || 0;
}

/** Tên nhóm (chính nó hoặc nhóm cha gần nhất) đang đặt "không nhận đổi trả". */
function blockedCategory(categories, categoryId) {
  const byId = new Map((categories || []).map((c) => [c.id, c]));
  let c = byId.get(Number(categoryId));
  let guard = 0;
  while (c && guard++ < 50) {
    if (c.no_return) return c.name;
    c = c.parent_id ? byId.get(c.parent_id) : null;
  }
  return null;
}

export default function QuickReturnModal({
  open, onClose, onDone, products, priceListId, warehouseId, customerId, customers, policy,
}) {
  const { user, toast, meta } = useApp();
  const [lines, setLines] = useState([]);
  const [pickOpen, setPickOpen] = useState(false);
  const [feeType, setFeeType] = useState('amount');
  const [feeValue, setFeeValue] = useState(0);
  const [method, setMethod] = useState('cash');
  const [refunded, setRefunded] = useState(0);
  const [touchedRefund, setTouchedRefund] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [custId, setCustId] = useState(customerId || '');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [issued, setIssued] = useState(null);

  useEffect(() => {
    if (!open) return;
    setLines([]); setReason(''); setNote(''); setErr(''); setIssued(null);
    setFeeType(policy?.returnFeeType === 'percent' ? 'percent' : 'amount');
    setFeeValue(Number(policy?.returnFeeValue) || 0);
    setMethod('cash'); setAccountId('');
    setTouchedRefund(false);
    setCustId(customerId || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customerId]);

  const subtotal = useMemo(() => lines.reduce((a, l) => a + Math.round(l.qty * l.price), 0), [lines]);
  const fee = feeOf(feeType, feeValue, subtotal);
  const total = Math.max(0, subtotal - fee);
  const paysMoney = method === 'cash' || method === 'transfer';

  /* Tiền hoàn bám theo tổng cho tới khi người dùng tự sửa */
  useEffect(() => {
    if (!touchedRefund) setRefunded(total);
  }, [total, touchedRefund]);

  useEffect(() => {
    if (method === 'debt' && !custId) setMethod('cash');
  }, [custId, method]);

  const add = (p, qty = 1) => {
    const more = Number(qty) > 0 ? Number(qty) : 1;
    setPickOpen(false);
    setLines((prev) => {
      const at = prev.findIndex((l) => l.product_id === p.id);
      if (at >= 0) {
        const copy = [...prev];
        copy[at] = { ...copy[at], qty: copy[at].qty + more };
        return copy;
      }
      const price = listedPrice(p, priceListId);
      return [...prev, {
        key: `${p.id}-${Date.now()}`,
        product_id: p.id,
        name: p.name,
        unit_name: p.base_unit,
        factor: 1,
        qty: more,
        price,
        listed: price,
        condition: 'good',
        blocked: blockedCategory(meta.categories, p.category_id),
      }];
    });
  };

  const patch = (key, v) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...v } : l)));
  const drop = (key) => setLines((prev) => prev.filter((l) => l.key !== key));

  const bank = meta.accounts.filter((a) => a.type === 'bank');
  const cashAcc = meta.accounts.filter((a) => a.type !== 'bank');
  const usableAccounts = method === 'transfer' && bank.length ? bank : cashAcc;
  const blocked = lines.filter((l) => l.blocked);
  const methodLabel = REFUND_METHODS.find((m) => m.key === method)?.label || '';

  const submit = async () => {
    if (!lines.length) { setErr('Chọn ít nhất một mặt hàng khách mang trả.'); return; }
    if (blocked.length) {
      setErr(`"${blocked[0].name}" thuộc nhóm "${blocked[0].blocked}" — nhóm này không nhận đổi trả. Bỏ dòng đó ra trước.`);
      return;
    }
    if (!reason.trim()) {
      setErr('Ghi lý do khách trả hàng — phiếu không có hoá đơn gốc thì lý do là chỗ duy nhất giải thích được.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const res = await api.post('/sale-returns', {
        sale_id: null,
        customer_id: custId || null,
        warehouse_id: warehouseId,
        user_id: user?.id,
        fee_type: feeType,
        fee: feeType === 'amount' ? fee : 0,
        fee_percent: feeType === 'percent' ? Number(feeValue) || 0 : 0,
        refund_method: method,
        refunded: paysMoney ? refunded : 0,
        reason: reason.trim(),
        note: [note.trim(), 'Trả hàng không có hoá đơn gốc'].filter(Boolean).join(' · '),
        account_id: accountId || (method === 'transfer' ? bank[0]?.id : null) || null,
        items: lines.map((l) => ({
          product_id: l.product_id, unit_name: l.unit_name, factor: l.factor,
          qty: l.qty, price: l.price, condition: l.condition,
        })),
      });
      onDone?.(res);
      if (res.voucher) {
        toast(`Đã nhận trả hàng ${res.code} — cấp phiếu đổi hàng ${res.voucher.code}`, 'ok', 6000);
        setIssued(res);
      } else {
        toast(res.refund_method === 'debt'
          ? `Đã nhận trả hàng ${res.code} — cấn trừ ${money(res.total)} vào công nợ`
          : `Đã nhận trả hàng ${res.code} — hoàn khách ${money(res.refunded)}`, 'ok', 5000);
        onClose();
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  if (issued?.voucher) {
    const cname = (customers || []).find((c) => String(c.id) === String(custId))?.name;
    return <VoucherPrint voucher={issued.voucher} customerName={cname} onClose={onClose} />;
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title="Trả hàng nhanh (Không hóa đơn)"
        subtitle="Khách mang hàng tới trả nhưng không giữ hoá đơn"
        size="lg"
        footer={
          <>
            <Button onClick={onClose} disabled={busy}>Huỷ</Button>
            <Button variant="primary" icon={Undo2} loading={busy} onClick={submit} disabled={busy || !lines.length}>
              Nhận trả · {methodLabel.toLowerCase()} {money(paysMoney ? refunded : total)}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {err && <ErrorBox error={err} title="Chưa lưu được" />}

          <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[13px] text-amber-900">
            <div className="flex items-start gap-1.5">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                Phiếu này <b>không có hoá đơn gốc để đối chiếu</b>. Giá dưới đây là giá đang niêm yết —
                người đứng quầy tự xem hàng rồi quyết. Nhớ kiểm tra hàng trước khi nhận lại.
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="font-semibold text-[13px]">Hàng khách mang trả</div>
            <Button size="sm" icon={Plus} onClick={() => setPickOpen(true)}>Chọn hàng</Button>
          </div>

          {lines.length === 0 ? (
            <Empty icon={Search} title="Chưa chọn hàng nào" message="Bấm “Chọn hàng” để tìm món khách mang tới." />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Mặt hàng</th>
                    <th style={{ width: 90 }} className="text-right">Số lượng</th>
                    <th style={{ width: 130 }} className="text-right">Giá trả lại</th>
                    <th>Tình trạng</th>
                    <th className="text-right">Thành tiền</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.key} className={l.blocked ? 'bg-red-50/60' : ''}>
                      <td>
                        <div className="font-medium">{l.name}</div>
                        <div className="text-2xs text-muted-ink">
                          Đang niêm yết {money(l.listed)}
                          {l.price !== l.listed && <span className="text-amber-700 font-semibold"> · đã sửa</span>}
                        </div>
                        {l.blocked && <Badge tone="bad">Nhóm "{l.blocked}" không nhận đổi trả</Badge>}
                      </td>
                      <td>
                        <QtyInput value={l.qty} onChange={(v) => patch(l.key, { qty: Math.max(0, Number(v) || 0) })}
                          aria-label={`Số lượng trả ${l.name}`} />
                      </td>
                      <td>
                        <MoneyInput size="sm" value={l.price} onChange={(v) => patch(l.key, { price: Math.max(0, v) })}
                          aria-label={`Giá trả lại ${l.name}`} />
                      </td>
                      <td>
                        <ConditionToggle value={l.condition} label={`Tình trạng ${l.name}`}
                          onChange={(c) => patch(l.key, { condition: c })} />
                      </td>
                      <td className="num font-semibold">{money(Math.round(l.qty * l.price))}</td>
                      <td>
                        <IconButton icon={Trash2} size={14} label={`Bỏ ${l.name}`} onClick={() => drop(l.key)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Khách hàng" hint="Chọn khách để cấn trừ vào công nợ hoặc ghi đích danh phiếu đổi hàng" htmlFor="qr-cust">
              <Select id="qr-cust" value={custId} onChange={(e) => setCustId(e.target.value)}>
                <option value="">— Khách lẻ —</option>
                {(customers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Phí đổi trả" hint="Hàng đã dùng, mất hộp..." htmlFor="qr-fee">
              <FeeField id="qr-fee" type={feeType} value={feeValue} onType={setFeeType} onValue={setFeeValue} base={subtotal} />
            </Field>
          </div>

          <Field label="Trả lại khách bằng">
            <RefundMethodPicker value={method} hasCustomer={!!custId} name="qr-refund"
              onChange={(m) => { setMethod(m); setAccountId(''); }} />
          </Field>

          {paysMoney && (
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field label="Tiền hoàn khách" htmlFor="qr-refunded">
                <MoneyInput id="qr-refunded" value={refunded}
                  onChange={(v) => { setTouchedRefund(true); setRefunded(Math.max(0, Math.min(v, total))); }} />
                {refunded < total && (
                  <div className="text-xs text-muted-ink mt-1">Hoàn thiếu {money(total - refunded)} so với giá trị hàng trả.</div>
                )}
              </Field>
              <Field label="Chi từ quỹ" htmlFor="qr-account">
                <Select id="qr-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">{method === 'transfer' && bank.length ? bank[0].name : 'Quỹ mặc định'}</option>
                  {usableAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </Field>
            </div>
          )}

          <Field label="Lý do khách trả" hint="bắt buộc" htmlFor="qr-reason">
            <Input id="qr-reason" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Ví dụ: hàng lỗi không lên nguồn, khách mua nhầm loại" />
          </Field>

          <Field label="Ghi chú thêm" htmlFor="qr-note">
            <Textarea id="qr-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Ví dụ: khách quen, mua khoảng tuần trước" />
          </Field>

          <div className="border-t border-line pt-2 space-y-0.5">
            <TotalRow label="Giá trị hàng trả" value={money(subtotal)} />
            {fee > 0 && <TotalRow label="Trừ phí đổi trả" value={`− ${money(fee)}`} />}
            {paysMoney
              ? <TotalRow label="Tiền hoàn khách" value={money(refunded)} big />
              : <TotalRow label={method === 'voucher' ? 'Cấp phiếu đổi hàng' : 'Cấn trừ vào công nợ'} value={money(total)} big tone="good" />}
          </div>
        </div>
      </Modal>

      <ProductPicker
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        products={products || []}
        onPick={add}
        title="Chọn hàng khách mang trả"
      />
    </>
  );
}
