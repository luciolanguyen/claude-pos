/* ====================================================================
   DUYỆT BẰNG MÃ PIN QUẢN LÝ TẠI QUẦY (tài liệu 05, 06)

   Thu ngân giảm giá quá hạn mức, hoặc bán nợ vượt hạn mức của khách: phần
   mềm khoá lại, quản lý đứng cạnh gõ mã PIN của mình là mở — không phải
   đăng xuất rồi đăng nhập tài khoản quản lý giữa lúc khách đang chờ.

   Máy khách KHÔNG giữ mã PIN. Gõ đúng thì máy chủ cấp một phiếu duyệt
   ngắn hạn; hoá đơn gửi kèm phiếu đó và máy chủ soát lại lần nữa. Mọi
   phép tính ở đây chỉ để khoá nút SỚM cho thu ngân đỡ bấm hụt — chặn thật
   vẫn nằm ở máy chủ.
   ==================================================================== */
import { useState, useEffect } from 'react';
import { KeyRound, Lock } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Modal } from './ui';

export const DEFAULT_POLICY = {
  maxTabs: 10,
  cashierMaxDiscountPercent: 10,
  returnDays: 7,
  returnFeeType: 'amount',
  returnFeeValue: 0,
  maxDebtDays: 0,
};

/** Chính sách bán hàng đọc từ máy chủ. Chưa tải xong thì dùng mặc định. */
export function usePosPolicy() {
  const [policy, setPolicy] = useState(DEFAULT_POLICY);
  useEffect(() => {
    let alive = true;
    api.posPolicy()
      .then((p) => { if (alive) setPolicy({ ...DEFAULT_POLICY, ...p }); })
      .catch(() => { /* giữ mặc định — máy chủ vẫn soát khi lưu */ });
    return () => { alive = false; };
  }, []);
  return policy;
}

/**
 * Người đang đứng quầy có tự quyết được mức giảm giá không.
 * Tiệm tắt đăng nhập thì một máy dùng chung — máy chủ coi như toàn quyền.
 */
export const canSelfApprove = (user, access) =>
  access?.login_required === false || ['owner', 'manager'].includes(user?.role);

/**
 * Mức giảm của cả giỏ so với BẢNG GIÁ — tính y như máy chủ (policy.js):
 * lấy mức cao hơn giữa dòng giảm sâu nhất và tổng giảm cả đơn. Sửa tay đơn
 * giá xuống cũng tính là giảm.
 */
export function cartDiscountPercent(cart, priceListId, order = {}) {
  let listTotal = 0;
  let subtotal = 0;
  let worst = 0;
  for (const l of cart || []) {
    const qty = Number(l.qty) || 0;
    const price = Math.round(Number(l.price) || 0);
    const gross = Math.round(qty * price);
    const disc = l.discountType === 'percent'
      ? Math.round(gross * (Number(l.discountValue) || 0) / 100)
      : Math.round(Number(l.discountValue) || 0);
    const amount = gross - Math.min(disc, gross);
    const unit = l.units?.find((u) => u.id === l.unit_id);
    const list = unit?.prices?.[priceListId];
    const listGross = Math.round(qty * (list ?? price));
    const pct = listGross > 0 ? Math.max(0, (listGross - amount) / listGross * 100) : 0;
    listTotal += listGross;
    subtotal += amount;
    if (pct > worst) worst = pct;
  }
  const orderDisc = order.discountType === 'percent'
    ? Math.round(subtotal * (Number(order.discountValue) || 0) / 100)
    : Math.round(Number(order.discountValue) || 0);
  const finalGoods = subtotal - Math.min(orderDisc, subtotal);
  const total = listTotal > 0 ? Math.max(0, (listTotal - finalGoods) / listTotal * 100) : 0;
  return Math.round(Math.max(total, worst) * 100) / 100;
}

/**
 * Hộp gõ mã PIN. Đúng thì trả về phiếu duyệt { token, approver, expires_in }.
 * Ô nhập để dạng chấm tròn: thu ngân đứng cạnh không nhìn thấy mã.
 */
export function PinApprovalModal({ open, reason, detail, onClose, onApproved }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) { setPin(''); setErr(''); }
  }, [open]);

  const submit = async () => {
    if (!/^\d{4,8}$/.test(pin)) { setErr('Mã PIN gồm 4 đến 8 chữ số.'); return; }
    setBusy(true);
    setErr('');
    try {
      const res = await api.approve(pin, reason);
      setPin('');
      onApproved?.(res);
    } catch (e) {
      setPin('');
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Cần quản lý duyệt"
      subtitle="Chủ cửa hàng hoặc quản lý nhập mã PIN của mình"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" icon={KeyRound} onClick={submit} loading={busy} disabled={pin.length < 4}>
          Duyệt
        </Button>
      </>}
    >
      <div className="space-y-3">
        {detail && (
          <div className="rounded-lg border border-warn/30 bg-amber-50 p-2.5 text-[13px] text-amber-900 flex gap-2">
            <Lock size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
            <div>{detail}</div>
          </div>
        )}
        <div>
          <label htmlFor="approve-pin" className="label">Mã PIN quản lý</label>
          <input
            id="approve-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            autoFocus
            className="field field-lg text-center font-mono tracking-[0.5em]"
            value={pin}
            onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setErr(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); } }}
            aria-describedby="approve-pin-hint"
          />
        </div>
        {err && (
          <p role="alert" className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2">
            {err}
          </p>
        )}
        <p id="approve-pin-hint" className="text-2xs text-muted-ink leading-relaxed">
          Mã PIN không lưu lại trên máy này. Máy chủ chỉ cấp một phiếu duyệt dùng cho đúng một
          hoá đơn, tự hết hạn sau 30 phút. Gõ sai 5 lần liên tiếp thì khoá tạm 1 phút.
        </p>
      </div>
    </Modal>
  );
}
