/* ====================================================================
   MẢNH DÙNG CHUNG CHO CÁC HỘP NHẬN HÀNG KHÁCH TRẢ (tài liệu 02, 05)

   Ba chỗ nhận hàng trả — đổi trả tại quầy, trả không hoá đơn, trả theo
   hoá đơn ở màn hình Hoá đơn — phải hỏi cùng mấy câu như nhau: hàng còn
   bán được không, thu phí bao nhiêu, trả lại khách bằng cách nào. Gom về
   một chỗ để ba hộp nói cùng một giọng, tính cùng một cách.
   ==================================================================== */
import { useEffect } from 'react';
import { Printer, Ticket, PackageCheck, PackageX } from 'lucide-react';
import { useApp } from '../lib/store';
import { money, n, date } from '../lib/format';
import { Button, Modal, MoneyInput } from './ui';

/** Phí đổi trả: cố định, hoặc % giá trị hàng trả. Làm tròn giống máy chủ. */
export const feeOf = (type, value, base) => (type === 'percent'
  ? Math.round(Math.max(0, base) * Math.max(0, Number(value) || 0) / 100)
  : Math.max(0, Math.round(Number(value) || 0)));

/**
 * Tình trạng hàng trả. Đạt chuẩn thì cộng lại kho đang bán; lỗi/hỏng thì
 * vào kho hàng lỗi, không hiện trên màn hình bán hàng nữa.
 */
export function ConditionToggle({ value, onChange, label, disabled }) {
  const opts = [
    { key: 'good', text: 'Đạt chuẩn', icon: PackageCheck, on: 'bg-emerald-600 text-white' },
    { key: 'defect', text: 'Lỗi/Hỏng', icon: PackageX, on: 'bg-danger text-white' },
  ];
  return (
    <div className="inline-flex rounded border border-line overflow-hidden" role="radiogroup" aria-label={label}>
      {opts.map((o) => {
        const active = (value || 'good') === o.key;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.key)}
            className={`flex items-center gap-1 px-1.5 h-7 text-2xs font-semibold whitespace-nowrap
                        transition-colors duration-100 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50
                        ${active ? o.on : 'bg-card text-muted-ink hover:bg-muted'}`}
          >
            <o.icon size={12} aria-hidden="true" />
            {o.text}
          </button>
        );
      })}
    </div>
  );
}

/** Ô phí đổi trả: chọn đ hoặc %, nhập số, thấy ngay số tiền phí thật. */
export function FeeField({ type, value, onType, onValue, base, id }) {
  const fee = feeOf(type, value, base);
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <div className="flex rounded border border-line overflow-hidden shrink-0" role="radiogroup"
          aria-label="Cách tính phí đổi trả">
          {[['amount', 'đ', 'Phí cố định bằng tiền'], ['percent', '%', 'Phí theo phần trăm giá trị hàng trả']]
            .map(([k, lb, aria]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={type === k}
                aria-label={aria}
                onClick={() => { if (type !== k) { onType(k); onValue(0); } }}
                className={`w-9 h-9 text-[13px] font-bold transition-colors duration-100 cursor-pointer
                            ${type === k ? 'bg-primary text-white' : 'bg-card hover:bg-muted'}`}
              >
                {lb}
              </button>
            ))}
        </div>
        {type === 'percent' ? (
          <input
            id={id}
            type="number" min="0" max="100" step="0.5"
            className="field num flex-1 min-w-0"
            value={value}
            onFocus={(e) => e.target.select()}
            onChange={(e) => onValue(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
          />
        ) : (
          <MoneyInput id={id} value={value} onChange={(v) => onValue(Math.max(0, v))} className="flex-1 min-w-0" />
        )}
      </div>
      {type === 'percent' && base > 0 && (
        <p className="hint">= {money(fee)} trên {money(base)} tiền hàng trả</p>
      )}
    </div>
  );
}

export const REFUND_METHODS = [
  { key: 'cash', label: 'Tiền mặt', hint: 'Chi tiền từ két' },
  { key: 'transfer', label: 'Chuyển khoản', hint: 'Chuyển khoản trả lại khách' },
  { key: 'voucher', label: 'Phiếu đổi hàng', hint: 'Không chi tiền — khách dùng cho lần mua sau' },
  { key: 'debt', label: 'Cấn trừ vào công nợ cũ', hint: 'Không chi tiền — trừ thẳng vào số nợ của khách',
    needsCustomer: true },
];

/**
 * Tiệm trả lại khách bằng cách nào. Phiếu đổi hàng và cấn trừ nợ không
 * đụng tới két — ca đông khách mà hoàn tiền mặt liên tục là cuối ca hụt quỹ.
 */
export function RefundMethodPicker({ value, onChange, hasCustomer, name = 'refund-method' }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label="Trả lại khách bằng cách nào">
      {REFUND_METHODS.map((m) => {
        const off = m.needsCustomer && !hasCustomer;
        const on = value === m.key;
        return (
          <label
            key={m.key}
            className={`flex items-start gap-2 rounded border p-2 text-[13px] transition-colors duration-100
                        ${off ? 'opacity-55 cursor-not-allowed border-line'
                          : on ? 'border-accent bg-accent-soft/40 cursor-pointer'
                            : 'border-line hover:bg-muted/60 cursor-pointer'}`}
          >
            <input
              type="radio"
              name={name}
              value={m.key}
              aria-label={m.label}
              className="w-4 h-4 mt-0.5 accent-emerald-700 cursor-pointer disabled:cursor-not-allowed"
              checked={on}
              disabled={off}
              onChange={() => onChange(m.key)}
            />
            <span>
              <span className="font-semibold block leading-tight">{m.label}</span>
              <span className="text-2xs text-muted-ink">
                {off ? 'Chỉ dùng được khi đơn có khách hàng đã lưu' : m.hint}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** Thẻ phiếu đổi hàng vừa cấp — hiện to mã phiếu để đọc cho khách chép lại. */
export function VoucherCard({ voucher, onPrint }) {
  if (!voucher) return null;
  return (
    <div className="rounded-lg border-2 border-dashed border-accent bg-accent-soft/30 p-3 flex items-center gap-3">
      <Ticket size={28} className="text-emerald-800 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="text-2xs font-bold uppercase text-emerald-900/70">Phiếu đổi hàng</div>
        <div className="font-mono font-bold text-lg tracking-wide text-emerald-950 break-all">{voucher.code}</div>
        <div className="text-2xs text-emerald-900/80">
          {money(voucher.amount)}{voucher.expires_at ? ` · dùng tới ${date(voucher.expires_at)}` : ''}
        </div>
      </div>
      {onPrint && <Button size="sm" icon={Printer} onClick={onPrint}>In phiếu</Button>}
    </div>
  );
}

/** Tờ phiếu đổi hàng khổ K80, đưa khách giữ. */
export function VoucherPrint({ voucher, customerName, onClose }) {
  const { store } = useApp();

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); window.print(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!voucher) return null;
  const who = voucher.customer_name || customerName;

  const body = (
    <div className="print-k80 text-black bg-white" style={{ padding: '3mm 2mm' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 800, fontSize: 13 }}>{store?.name}</div>
        {store?.phone && <div style={{ fontSize: 9 }}>ĐT: {store.phone}</div>}
      </div>
      <div className="dashed" />
      <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 13, letterSpacing: 1 }}>PHIẾU ĐỔI HÀNG</div>
      <div style={{ textAlign: 'center', fontSize: 9 }}>Dùng trừ tiền cho lần mua sau</div>
      <div className="dashed" />
      <div style={{ textAlign: 'center', fontSize: 16, fontWeight: 800, margin: '4px 0', letterSpacing: 1 }}>
        {voucher.code}
      </div>
      <table style={{ fontSize: 10.5 }}>
        <tbody>
          <tr><td>Giá trị:</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{n(voucher.amount)} đ</td></tr>
          {voucher.balance != null && voucher.balance !== voucher.amount && (
            <tr><td>Còn dùng được:</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{n(voucher.balance)} đ</td></tr>
          )}
          <tr><td>Ngày cấp:</td><td style={{ textAlign: 'right' }}>{date(voucher.ts)}</td></tr>
          <tr>
            <td>Hạn dùng:</td>
            <td style={{ textAlign: 'right', fontWeight: 700 }}>
              {voucher.expires_at ? date(voucher.expires_at) : 'Không hạn'}
            </td>
          </tr>
          {voucher.source_code && (
            <tr><td>Từ phiếu trả:</td><td style={{ textAlign: 'right' }}>{voucher.source_code}</td></tr>
          )}
          <tr><td>Khách:</td><td style={{ textAlign: 'right' }}>{voucher.customer_id ? (who || 'Ghi đích danh') : 'Không ghi tên'}</td></tr>
        </tbody>
      </table>
      <div className="dashed" />
      <div style={{ fontSize: 9, textAlign: 'center' }}>
        {voucher.customer_id
          ? 'Phiếu ghi đích danh — chỉ khách này dùng được.'
          : 'Phiếu không ghi tên — ai cầm phiếu cũng dùng được, xin giữ cẩn thận.'}
        <br />Không quy đổi thành tiền mặt.
      </div>
    </div>
  );

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={`Phiếu đổi hàng ${voucher.code}`}
        subtitle={`Giá trị ${money(voucher.amount)}${voucher.expires_at ? ` · dùng tới ${date(voucher.expires_at)}` : ''}`}
        size="sm"
        footer={<>
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" icon={Printer} onClick={() => window.print()}>In phiếu</Button>
        </>}
      >
        <div className="border border-line rounded-lg bg-slate-100 p-4 overflow-auto max-h-[55vh]">
          <div className="bg-white mx-auto shadow-sm" style={{ width: 'fit-content' }}>{body}</div>
        </div>
      </Modal>
      <div className="print-area size-k80">{body}</div>
    </>
  );
}
