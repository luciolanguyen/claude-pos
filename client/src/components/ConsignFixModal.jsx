/* ====================================================================
   KHAI LẠI HOA HỒNG / GIÁ TIỆM BỐC (BRD nâng cấp, mục 5)

   Thu ngân đứng quầy chỉ gõ giá bán cho khách — phần lãi của tiệm giấu
   hẳn. Chủ tiệm hoặc quản lý mở hoá đơn ra khai sau, lúc rảnh.

   Tiền khách đã trả KHÔNG đổi. Chỉ đổi phần lãi, nên máy chủ tính lại giá
   vốn của hoá đơn. Dòng đã vào đợt đối soát thì khoá — sửa nữa là lệch số
   tiền đã trả chủ hàng.
   ==================================================================== */
import { useState } from 'react';
import { Handshake, Wallet } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { money, n } from '../lib/format';
import { Button, Modal, Field, Input, Select, MoneyInput } from './ui';

export default function ConsignFixModal({ sale, item, onClose, onSaved }) {
  const { toast } = useApp();
  const gửi = !!item.partner_id;
  const [type, setType] = useState(item.commission_type === 'amount' ? 'amount' : 'percent');
  const [value, setValue] = useState(item.commission_value ?? 0);
  const [cost, setCost] = useState(item.cost || 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const amount = item.amount;
  const commission = gửi
    ? Math.min(amount, type === 'percent'
      ? Math.round(amount * (Number(value) || 0) / 100)
      : Math.round(Number(value) || 0))
    : 0;
  const payable = amount - commission;
  const margin = amount - Math.round((Number(item.qty) || 0) * (Number(cost) || 0));

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.put(`/sales/${sale.id}/consign-items/${item.id}`, {
        commission_type: type, commission_value: Number(value) || 0, cost: Number(cost) || 0,
      });
      toast(gửi ? 'Đã khai lại hoa hồng' : 'Đã khai giá tiệm bốc', 'ok');
      onSaved?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={gửi ? `Hoa hồng — ${item.name}` : `Giá tiệm bốc — ${item.name}`}
      subtitle={`Hoá đơn ${sale.code} · khách trả ${money(amount)} (${n(item.qty)} ${item.unit_name || 'đơn vị'} × ${money(item.price)})`}
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" loading={busy} onClick={save}>Lưu</Button>
      </>}
    >
      <div className="space-y-3">
        {gửi ? (
          <>
            <div className="card p-2.5 bg-violet-50 border-violet-200 text-[13px] flex items-center gap-2">
              <Handshake size={15} className="text-violet-800" aria-hidden="true" />
              Hàng gửi của <b>{item.partner_name || 'chủ hàng'}</b> — phần còn lại sau hoa hồng là nợ chủ hàng.
            </div>
            <Field label="Hoa hồng tiệm giữ">
              <div className="flex gap-1.5">
                <Select className="!w-24" aria-label="Cách tính hoa hồng" value={type}
                  onChange={(e) => setType(e.target.value)}>
                  <option value="percent">%</option>
                  <option value="amount">đồng</option>
                </Select>
                <Input type="number" min="0" step="any" className="flex-1" aria-label="Mức hoa hồng"
                  value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
              </div>
            </Field>
            <div className="card p-2.5 text-[13px] space-y-1">
              <div className="flex justify-between"><span className="text-muted-ink">Khách đã trả</span><span className="tabular">{money(amount)}</span></div>
              <div className="flex justify-between"><span className="text-muted-ink">Hoa hồng tiệm giữ</span><span className="tabular text-emerald-700 font-semibold">{money(commission)}</span></div>
              <div className="flex justify-between border-t border-line pt-1 font-bold">
                <span>Còn nợ chủ hàng</span><span className="tabular text-violet-900">{money(payable)}</span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="card p-2.5 bg-amber-50 border-warn/30 text-[13px] flex items-center gap-2">
              <Wallet size={15} className="text-amber-900" aria-hidden="true" />
              Tiệm tự bốc ngoài — khai giá bốc để tính đúng lãi của hoá đơn.
            </div>
            <Field label="Giá tiệm bốc (một đơn vị)" hint="Tiền tiệm trả cho chỗ bốc hàng, không sinh phiếu chi">
              <MoneyInput value={cost} onChange={(v) => setCost(Math.max(0, v))} autoFocus />
            </Field>
            <div className="card p-2.5 text-[13px] space-y-1">
              <div className="flex justify-between"><span className="text-muted-ink">Khách đã trả</span><span className="tabular">{money(amount)}</span></div>
              <div className="flex justify-between border-t border-line pt-1 font-bold">
                <span>Tiệm ăn chênh</span>
                <span className={`tabular ${margin < 0 ? 'text-danger' : 'text-emerald-700'}`}>{money(margin)}</span>
              </div>
            </div>
          </>
        )}
        {err && <p role="alert" className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
      </div>
    </Modal>
  );
}
