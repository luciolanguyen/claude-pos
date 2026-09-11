import { useState, useEffect, useMemo, useRef } from 'react';
import { Undo2, Ban } from 'lucide-react';
import { api } from '../lib/api';
import { money, qty as fq, datetime } from '../lib/format';
import { Modal, Button, Field, Select, MoneyInput, Textarea, QtyInput, Badge } from './ui';
import SaveDraftButton from './DraftButtons';
import { usePosPolicy } from './PosApproval';
import { ConditionToggle, FeeField, RefundMethodPicker, VoucherPrint, feeOf } from './ReturnParts';

/**
 * Nhận hàng khách trả — chọn từ chính các dòng của hoá đơn gốc.
 *
 * Tiền trả lại tính theo GIÁ KHÁCH THỰC TRẢ của từng dòng (đã chia giảm giá
 * cả đơn, cộng thuế), không theo đơn giá niêm yết: hoá đơn giảm 20% mà hoàn
 * theo giá gốc là tiệm mất tiền. Số lượng trả không vượt số đã mua trừ số
 * đã trả ở các lần trước. Máy chủ tính lại y như vậy khi lưu.
 */
export default function SaleReturnForm({ sale, user, accounts, onClose, onDone }) {
  const policy = usePosPolicy();
  const [lines, setLines] = useState([]);
  const [feeType, setFeeType] = useState('amount');
  const [feeValue, setFeeValue] = useState(0);
  const [method, setMethod] = useState('cash');
  const [refunded, setRefunded] = useState(0);
  const [touchedRefund, setTouchedRefund] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [draftId, setDraftId] = useState(null);
  const [issued, setIssued] = useState(null);
  const feeTouched = useRef(false);

  useEffect(() => {
    if (!sale) return;
    setLines(sale.items.map((it) => ({
      ...it,
      returnQty: 0,
      maxQty: it.returnable_qty ?? it.qty,
      netPrice: it.net_unit_price ?? it.price,
      condition: 'good',
      blocked: it.no_return_category || null,
    })));
    setReason('');
    setNote('');
    setErr('');
    setMethod('cash');
    setTouchedRefund(false);
    setAccountId('');
    feeTouched.current = false;
  }, [sale]);

  /* Phí mặc định lấy từ thiết lập — chỉ điền khi thu ngân chưa tự sửa */
  useEffect(() => {
    if (feeTouched.current) return;
    setFeeType(policy.returnFeeType === 'percent' ? 'percent' : 'amount');
    setFeeValue(Number(policy.returnFeeValue) || 0);
  }, [policy.returnFeeType, policy.returnFeeValue, sale]);

  const subtotal = useMemo(
    () => lines.reduce((a, l) => a + Math.round(l.returnQty * l.netPrice), 0),
    [lines]);
  const fee = feeOf(feeType, feeValue, subtotal);
  const total = Math.max(0, subtotal - fee);
  const paysMoney = method === 'cash' || method === 'transfer';

  useEffect(() => {
    if (!touchedRefund) setRefunded(total);
  }, [total, touchedRefund]);

  const setLine = (id, patch) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const setQty = (id, v) => setLines((prev) => prev.map((l) => (
    l.id === id ? { ...l, returnQty: Math.max(0, Math.min(Number(v) || 0, l.maxQty)) } : l)));

  const bank = (accounts || []).filter((a) => a.type === 'bank');
  const cashAcc = (accounts || []).filter((a) => a.type !== 'bank');
  const usableAccounts = method === 'transfer' && bank.length ? bank : cashAcc;
  const expired = !!sale?.return_expired;

  const submit = async () => {
    const items = lines.filter((l) => l.returnQty > 0);
    if (!items.length) { setErr('Chọn ít nhất một mặt hàng và nhập số lượng trả.'); return; }
    if (expired) { setErr(`Hoá đơn đã quá hạn đổi trả ${sale.return_days} ngày.`); return; }
    setBusy(true);
    setErr('');
    try {
      const res = await api.post('/sale-returns', {
        sale_id: sale.id,
        customer_id: sale.customer_id,
        warehouse_id: sale.warehouse_id,
        user_id: user?.id,
        fee_type: feeType,
        fee: feeType === 'amount' ? fee : 0,
        fee_percent: feeType === 'percent' ? Number(feeValue) || 0 : 0,
        refund_method: method,
        refunded: paysMoney ? refunded : 0,
        reason,
        note,
        account_id: accountId || (method === 'transfer' ? bank[0]?.id : null) || null,
        items: items.map((l) => ({ sale_item_id: l.id, qty: l.returnQty, condition: l.condition })),
      });
      if (res.voucher) setIssued(res);
      else onDone?.(res.code);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!sale) return null;

  if (issued?.voucher) {
    return (
      <VoucherPrint
        voucher={issued.voucher}
        customerName={sale.customer_name}
        onClose={() => onDone?.(issued.code)}
      />
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Nhận hàng khách trả lại"
      subtitle={`Hoá đơn gốc ${sale.code} · ${datetime(sale.ts)} · ${sale.customer_name || 'Khách lẻ'}`}
      size="lg"
      footer={<>
        <SaveDraftButton
          className="mr-auto"
          disabled={subtotal <= 0}
          onSaved={(d) => setDraftId(d.id)}
          build={() => ({
            kind: 'sale_return',
            id: draftId,
            title: `Khách trả hàng · ${sale?.code || ''}`.trim(),
            partner_name: sale?.customer_name || null,
            total,
            item_count: lines.filter((l) => l.returnQty > 0).length,
            payload: {
              sale_id: sale?.id,
              lines: lines.filter((l) => l.returnQty > 0)
                .map((l) => ({ id: l.id, returnQty: l.returnQty, condition: l.condition })),
              fee, fee_type: feeType, fee_value: feeValue, refund_method: method,
              refunded, reason, note, account_id: accountId,
            },
          })}
        />
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" icon={Undo2} onClick={submit} loading={busy} disabled={subtotal <= 0 || expired}>
          Lập phiếu trả hàng
        </Button>
      </>}
    >
      <div className="space-y-3">
        {expired ? (
          <div className="rounded-lg border border-danger/30 bg-red-50 p-2.5 text-[13px] text-red-900 flex gap-2" role="alert">
            <Ban size={16} className="shrink-0 mt-0.5 text-danger" aria-hidden="true" />
            <div>
              Hoá đơn mua cách đây <b>{sale.age_days} ngày</b>, đã quá hạn đổi trả <b>{sale.return_days} ngày</b>.
              Không nhận trả được.
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-muted-ink">
            Tiền trả tính theo <b>giá khách thực trả</b> (đã chia giảm giá cả đơn và thuế). Hàng đạt chuẩn
            nhập lại kho bán; hàng lỗi vào kho hàng lỗi.
          </p>
        )}

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Tên hàng</th>
                <th className="text-right">Còn trả được</th>
                <th className="text-right">Số lượng trả</th>
                <th>Tình trạng</th>
                <th className="text-right">Giá khách trả</th>
                <th className="text-right">Tiền trả</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const off = !!l.blocked || l.maxQty <= 0 || expired;
                return (
                  <tr key={l.id} className={l.returnQty > 0 ? 'bg-accent-soft/30' : ''}>
                    <td>
                      <div className={off ? 'text-muted-ink' : 'font-semibold'}>{l.name_snapshot}</div>
                      <div className="text-2xs text-muted-ink">
                        {l.unit_name} · đã mua {fq(l.qty)}{l.returned_qty > 0 && <> · đã trả {fq(l.returned_qty)}</>}
                      </div>
                      {l.blocked && <Badge tone="bad">Nhóm "{l.blocked}" không nhận đổi trả</Badge>}
                    </td>
                    <td className="num text-muted-ink">{fq(l.maxQty)}</td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <QtyInput
                          value={l.returnQty}
                          onChange={(v) => setQty(l.id, v)}
                          max={l.maxQty}
                          disabled={off}
                          className="!w-20"
                          aria-label={`Số lượng trả của ${l.name_snapshot}`}
                        />
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() => setQty(l.id, l.maxQty)}
                          disabled={off}
                          title="Trả hết phần còn trả được"
                        >
                          Hết
                        </button>
                      </div>
                    </td>
                    <td>
                      <ConditionToggle value={l.condition} disabled={off || !(l.returnQty > 0)}
                        label={`Tình trạng ${l.name_snapshot}`} onChange={(c) => setLine(l.id, { condition: c })} />
                    </td>
                    <td className="num">
                      {money(l.netPrice)}
                      {l.price > l.netPrice && <div className="text-2xs text-muted-ink line-through">{money(l.price)}</div>}
                    </td>
                    <td className="num font-semibold">{money(Math.round(l.returnQty * l.netPrice))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-3">
            <Field label="Lý do trả hàng" htmlFor="sr-reason">
              <Select id="sr-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">— Chọn lý do —</option>
                <option>Hàng lỗi không dùng được</option>
                <option>Khách mua nhầm quy cách</option>
                <option>Dư hàng sau khi thi công</option>
                <option>Không đúng mẫu khách cần</option>
                <option>Lý do khác</option>
              </Select>
            </Field>
            <Field label="Phí đổi trả" hint="Trả muộn, mất nhãn mác... Để 0 nếu không thu" htmlFor="sr-fee">
              <FeeField
                id="sr-fee"
                type={feeType}
                value={feeValue}
                onType={(t) => { feeTouched.current = true; setFeeType(t); }}
                onValue={(v) => { feeTouched.current = true; setFeeValue(v); }}
                base={subtotal}
              />
            </Field>
            <Field label="Ghi chú" htmlFor="sr-note">
              <Textarea id="sr-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>

          <div className="space-y-3">
            <Field label="Trả lại khách bằng">
              <RefundMethodPicker value={method} hasCustomer={!!sale.customer_id} name="sr-refund"
                onChange={(m) => { setMethod(m); setAccountId(''); }} />
            </Field>

            {paysMoney && (
              <>
                <Field label="Số tiền hoàn cho khách" htmlFor="sr-refund-amount">
                  <MoneyInput id="sr-refund-amount" value={refunded}
                    onChange={(v) => { setTouchedRefund(true); setRefunded(Math.max(0, Math.min(v, total))); }} />
                </Field>
                {refunded > 0 && (
                  <Field label="Chi từ quỹ" htmlFor="sr-acc">
                    <Select id="sr-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                      <option value="">{method === 'transfer' && bank.length ? bank[0].name : 'Quỹ mặc định'}</option>
                      {usableAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </Select>
                  </Field>
                )}
              </>
            )}

            <div className="card p-2.5 space-y-1 text-[13px]">
              <div className="flex justify-between">
                <span className="text-muted-ink">Tiền hàng trả</span>
                <span className="tabular font-mono">{money(subtotal)}</span>
              </div>
              {fee > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-ink">Phí đổi trả</span>
                  <span className="tabular font-mono">-{money(fee)}</span>
                </div>
              )}
              <div className="flex justify-between pt-1.5 border-t border-line font-bold">
                <span>
                  {method === 'voucher' ? 'Cấp phiếu đổi hàng' : method === 'debt' ? 'Cấn trừ vào công nợ' : 'Khách được nhận'}
                </span>
                <span className="tabular font-mono text-accent">{money(total)}</span>
              </div>
            </div>
          </div>
        </div>

        {err && (
          <p role="alert" className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">
            {err}
          </p>
        )}
      </div>
    </Modal>
  );
}
