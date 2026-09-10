/* ====================================================================
   ĐỔI TRẢ NHANH — KHÔNG CẦN HOÁ ĐƠN

   Khách xách món hàng tới, bảo mua ở đây tuần trước, không giữ hoá đơn.
   Chuyện thường ngày ở tiệm tạp hoá — không thể bắt khách về tìm giấy.

   Khác với trả hàng theo hoá đơn ở một điểm quan trọng: ở đây KHÔNG CÓ
   GÌ KIỂM CHỨNG. Phần mềm không biết món này có phải bán ở tiệm không,
   bán giá bao nhiêu, đã bán bao lâu rồi. Nên:

     - giá trả mặc định lấy GIÁ BÁN ĐANG NIÊM YẾT, sửa được;
     - phiếu ghi rõ là trả không hoá đơn, để chủ tiệm soát lại được;
     - bắt buộc ghi lý do, tránh người đứng quầy tự lập phiếu khống rồi
       rút tiền két.

   Hàng vẫn nhập lại kho như phiếu trả thường, và tiền hoàn vẫn ghi chi
   quỹ đàng hoàng.
   ==================================================================== */
import { useState, useMemo, useEffect } from 'react';
import { Undo2, Plus, Trash2, AlertTriangle, Search } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch } from '../lib/store';
import { money, n, qty as fq } from '../lib/format';
import {
  Button, IconButton, Input, Select, Modal, Field, MoneyInput, Empty,
  Badge, Textarea, QtyInput, ErrorBox, TotalRow,
} from './ui';
import { ProductPicker } from './ProductPicker';

/** Giá bán đang niêm yết của một món, theo bảng giá đang dùng. */
function listedPrice(p, priceListId) {
  const u = p.units?.find((x) => x.is_base) || p.units?.[0];
  if (!u) return 0;
  const byList = u.prices?.[priceListId];
  return Number(byList) || Number(Object.values(u.prices || {})[0]) || 0;
}

export default function QuickReturnModal({
  open, onClose, onDone, products, priceListId, warehouseId, customerId, customers,
}) {
  const { user, toast } = useApp();
  const { data: accounts } = useFetch(() => api.get('/cash/accounts'), []);
  const [lines, setLines] = useState([]);
  const [pickOpen, setPickOpen] = useState(false);
  const [fee, setFee] = useState(0);
  const [refunded, setRefunded] = useState(0);
  const [touchedRefund, setTouchedRefund] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [custId, setCustId] = useState(customerId || '');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setLines([]); setFee(0); setReason(''); setNote(''); setErr('');
    setTouchedRefund(false);
    setCustId(customerId || '');
  }, [open, customerId]);

  useEffect(() => {
    if (accounts?.length && !accountId) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  const subtotal = useMemo(
    () => lines.reduce((a, l) => a + Math.round(l.qty * l.price), 0),
    [lines]
  );
  const total = Math.max(0, subtotal - fee);

  /* Tiền hoàn bám theo tổng cho tới khi người dùng tự sửa — sửa rồi thì
     giữ nguyên con số của họ, đừng tự ghi đè. */
  useEffect(() => {
    if (!touchedRefund) setRefunded(total);
  }, [total, touchedRefund]);

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
      return [...prev, {
        key: `${p.id}-${Date.now()}`,
        product_id: p.id,
        name: p.name,
        unit_name: p.base_unit,
        factor: 1,
        qty: more,
        price: listedPrice(p, priceListId),
        listed: listedPrice(p, priceListId),
      }];
    });
  };

  const patch = (key, v) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...v } : l)));
  const drop = (key) => setLines((prev) => prev.filter((l) => l.key !== key));

  const submit = async () => {
    if (!lines.length) { setErr('Chọn ít nhất một mặt hàng khách mang trả.'); return; }
    if (!reason.trim()) { setErr('Ghi lý do khách trả hàng — phiếu không có hoá đơn gốc thì lý do là chỗ duy nhất giải thích được.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await api.post('/sale-returns', {
        sale_id: null,                          // không có hoá đơn gốc
        customer_id: custId || null,
        warehouse_id: warehouseId,
        user_id: user?.id,
        fee, refunded,
        reason: reason.trim(),
        note: [note.trim(), 'Trả hàng không có hoá đơn gốc'].filter(Boolean).join(' · '),
        account_id: accountId,
        items: lines.map((l) => ({
          product_id: l.product_id, unit_name: l.unit_name, factor: l.factor,
          qty: l.qty, price: l.price,
        })),
      });
      toast(`Đã nhận trả hàng ${res.code} — hoàn khách ${money(res.refunded)}`, 'ok', 5000);
      onDone?.(res);
      onClose();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title="Đổi trả nhanh — không cần hoá đơn"
        subtitle="Khách mang hàng tới trả nhưng không giữ hoá đơn"
        size="lg"
        footer={
          <>
            <Button onClick={onClose} disabled={busy}>Huỷ</Button>
            <Button variant="primary" icon={Undo2} loading={busy}
              onClick={submit} disabled={busy || !lines.length}>
              Nhận trả · hoàn {money(refunded)}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {err && <ErrorBox error={err} title="Chưa lưu được" />}

          {/* Nói thẳng cái phần mềm không kiểm chứng được */}
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[13px] text-amber-900">
            <div className="flex items-start gap-1.5">
              <AlertTriangle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                Phiếu này <b>không có hoá đơn gốc để đối chiếu</b>. Phần mềm không biết
                món hàng có bán ở tiệm không và bán giá bao nhiêu — giá dưới đây là
                giá đang niêm yết, người đứng quầy tự xem hàng rồi quyết.
                Nhớ kiểm tra hàng trước khi nhận lại.
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="font-semibold text-[13px]">Hàng khách mang trả</div>
            <Button size="sm" icon={Plus} onClick={() => setPickOpen(true)}>Chọn hàng</Button>
          </div>

          {lines.length === 0 ? (
            <Empty icon={Search} title="Chưa chọn hàng nào"
              sub="Bấm “Chọn hàng” để tìm món khách mang tới." />
          ) : (
            <div className="border border-line rounded-lg overflow-hidden">
              <table className="table">
                <thead>
                  <tr>
                    <th>Mặt hàng</th>
                    <th style={{ width: 96 }} className="text-right">Số lượng</th>
                    <th style={{ width: 140 }} className="text-right">Giá trả lại</th>
                    <th style={{ width: 110 }} className="text-right">Thành tiền</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.key}>
                      <td>
                        <div className="font-medium">{l.name}</div>
                        <div className="text-2xs text-muted-ink">
                          Đang niêm yết {money(l.listed)}
                          {l.price !== l.listed && (
                            <span className="text-amber-700 font-semibold"> · đã sửa</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <QtyInput value={l.qty}
                          onChange={(v) => patch(l.key, { qty: Math.max(0, v) })}
                          aria-label={`Số lượng trả ${l.name}`} />
                      </td>
                      <td>
                        <MoneyInput size="sm" value={l.price}
                          onChange={(v) => patch(l.key, { price: Math.max(0, v) })}
                          aria-label={`Giá trả lại ${l.name}`} />
                      </td>
                      <td className="num font-semibold">{money(Math.round(l.qty * l.price))}</td>
                      <td>
                        <IconButton icon={Trash2} label={`Bỏ ${l.name}`}
                          onClick={() => drop(l.key)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Khách hàng" hint="để trừ vào công nợ nếu khách đang nợ">
              <Select value={custId} onChange={(e) => setCustId(e.target.value)}>
                <option value="">— Khách lẻ —</option>
                {(customers || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Chi tiền từ quỹ">
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {(accounts || []).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Trừ phí" hint="hàng đã dùng, mất hộp...">
              <MoneyInput value={fee} onChange={(v) => setFee(Math.max(0, v))} />
            </Field>
            <Field label="Tiền hoàn khách">
              <MoneyInput
                value={refunded}
                onChange={(v) => { setTouchedRefund(true); setRefunded(Math.max(0, Math.min(v, total))); }}
              />
              {refunded < total && (
                <div className="text-xs text-muted-ink mt-1">
                  Hoàn thiếu {money(total - refunded)} so với giá trị hàng trả.
                </div>
              )}
            </Field>
          </div>

          <Field label="Lý do khách trả" hint="bắt buộc">
            <Input value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Ví dụ: hàng lỗi không lên nguồn, khách mua nhầm loại" />
          </Field>

          <Field label="Ghi chú thêm">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Ví dụ: khách quen, mua khoảng tuần trước" />
          </Field>

          <div className="border-t border-line pt-2 space-y-0.5">
            <TotalRow label="Giá trị hàng trả" value={money(subtotal)} />
            {fee > 0 && <TotalRow label="Trừ phí" value={`- ${money(fee)}`} />}
            <TotalRow label="Tiền hoàn khách" value={money(refunded)} strong />
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
