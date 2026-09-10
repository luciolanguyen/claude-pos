import { useState, useEffect, useMemo } from 'react';
import { Undo2 } from 'lucide-react';
import { api } from '../lib/api';
import { money, qty as fq, datetime } from '../lib/format';
import { Modal, Button, Field, Select, MoneyInput, Textarea, QtyInput, Badge } from './ui';
import SaveDraftButton from './DraftButtons';

/**
 * Nhận hàng khách trả — chọn từ chính các dòng của hoá đơn gốc
 * nên số lượng trả không bao giờ vượt số đã bán.
 */
export default function SaleReturnForm({ sale, user, accounts, onClose, onDone }) {
  const [lines, setLines] = useState([]);
  const [fee, setFee] = useState(0);
  const [refunded, setRefunded] = useState(0);
  const [accountId, setAccountId] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [draftId, setDraftId] = useState(null);

  useEffect(() => {
    if (!sale) return;
    setLines(sale.items.map((it) => ({
      ...it, returnQty: 0, maxQty: it.qty,
    })));
    setFee(0);
    setReason('');
    setNote('');
    setErr('');
    setAccountId(accounts?.[0]?.id || '');
  }, [sale, accounts]);

  const subtotal = useMemo(
    () => lines.reduce((a, l) => a + Math.round(l.returnQty * l.price), 0),
    [lines]
  );
  const total = Math.max(0, subtotal - fee);

  useEffect(() => { setRefunded(total); }, [total]);

  const setQty = (id, v) => setLines((prev) => prev.map((l) =>
    l.id === id ? { ...l, returnQty: Math.max(0, Math.min(Number(v) || 0, l.maxQty)) } : l));

  const submit = async () => {
    const items = lines.filter((l) => l.returnQty > 0);
    if (!items.length) { setErr('Chọn ít nhất một mặt hàng và nhập số lượng trả.'); return; }
    setBusy(true);
    setErr('');
    try {
      const res = await api.post('/sale-returns', {
        sale_id: sale.id,
        customer_id: sale.customer_id,
        warehouse_id: sale.warehouse_id,
        user_id: user?.id,
        fee,
        refunded,
        reason,
        note,
        account_id: accountId,
        items: items.map((l) => ({
          product_id: l.product_id,
          unit_name: l.unit_name,
          factor: l.factor,
          qty: l.returnQty,
          price: l.price,
          unit_cost: l.unit_cost,
        })),
      });
      onDone?.(res.code);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!sale) return null;

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
                .map((l) => ({ id: l.id, returnQty: l.returnQty })),
              fee, refunded, reason, note, account_id: accountId,
            },
          })}
        />
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" icon={Undo2} onClick={submit} loading={busy} disabled={total <= 0 && subtotal <= 0}>
          Lập phiếu trả hàng
        </Button>
      </>}
    >
      <div className="space-y-3">
        <p className="text-[13px] text-muted-ink">
          Nhập số lượng khách trả cho từng dòng. Hàng trả sẽ được <b>nhập lại kho</b> và
          tiền hoàn sẽ ghi <b>phiếu chi</b> từ quỹ.
        </p>

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Tên hàng</th>
                <th>ĐVT</th>
                <th className="text-right">Đã mua</th>
                <th className="text-right">Số lượng trả</th>
                <th className="text-right">Đơn giá</th>
                <th className="text-right">Tiền trả</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className={l.returnQty > 0 ? 'bg-accent-soft/30' : ''}>
                  <td className="font-semibold">{l.name_snapshot}</td>
                  <td>{l.unit_name}</td>
                  <td className="num text-muted-ink">{fq(l.maxQty)}</td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <QtyInput
                        value={l.returnQty}
                        onChange={(v) => setQty(l.id, v)}
                        max={l.maxQty}
                        className="!w-20"
                        aria-label={`Số lượng trả của ${l.name_snapshot}`}
                      />
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => setQty(l.id, l.maxQty)}
                        title="Trả hết dòng này"
                      >
                        Hết
                      </button>
                    </div>
                  </td>
                  <td className="num">{money(l.price)}</td>
                  <td className="num font-semibold">{money(Math.round(l.returnQty * l.price))}</td>
                </tr>
              ))}
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
            <Field label="Ghi chú" htmlFor="sr-note">
              <Textarea id="sr-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>

          <div className="space-y-3">
            <Field
              label="Phí trả hàng (nếu thu)"
              hint="Trừ vào tiền hoàn cho khách"
              htmlFor="sr-fee"
            >
              <MoneyInput id="sr-fee" value={fee} onChange={setFee} />
            </Field>

            <Field
              label="Số tiền hoàn cho khách"
              hint="Để 0 nếu trừ vào công nợ thay vì trả tiền mặt"
              htmlFor="sr-refund"
            >
              <MoneyInput id="sr-refund" value={refunded} onChange={setRefunded} />
            </Field>

            {refunded > 0 && (
              <Field label="Chi từ quỹ" htmlFor="sr-acc">
                <Select id="sr-acc" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
                  {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              </Field>
            )}

            <div className="card p-2.5 space-y-1 text-[13px]">
              <div className="flex justify-between">
                <span className="text-muted-ink">Tiền hàng trả</span>
                <span className="tabular font-mono">{money(subtotal)}</span>
              </div>
              {fee > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-ink">Phí trả hàng</span>
                  <span className="tabular font-mono">-{money(fee)}</span>
                </div>
              )}
              <div className="flex justify-between pt-1.5 border-t border-line font-bold">
                <span>Khách được nhận</span>
                <span className="tabular font-mono text-accent">{money(total)}</span>
              </div>
            </div>
          </div>
        </div>

        {err && (
          <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">
            {err}
          </p>
        )}
      </div>
    </Modal>
  );
}
