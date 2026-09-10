/* ====================================================================
   PHIẾU THU — PHIẾU CHI

   Tờ giấy đi kèm mỗi lần tiền vào hoặc ra khỏi két. Khách trả nợ xong
   cầm về một tờ làm bằng chứng; tiệm giữ lại một tờ để cuối ngày đối
   chiếu với két.

   Trên phiếu có dòng "số tiền bằng chữ": đây là dòng bắt buộc của chứng
   từ tiền mặt ở Việt Nam, vì chữ số viết tay dễ sửa còn chữ thì không.

   Hai khổ giấy: A5 cho tờ phiếu thường ngày (một tờ A4 cắt đôi được hai
   phiếu, đỡ tốn giấy), A4 khi cần tờ phiếu to cho khoản tiền lớn.
   ==================================================================== */
import { useState, useEffect } from 'react';
import { Printer } from 'lucide-react';
import { useApp } from '../lib/store';
import { money, n, date, datetime, readMoney } from '../lib/format';
import { Button, Modal } from './ui';

/** Tiêu đề và cách xưng hô đổi theo chiều tiền đi. */
const SIDE = {
  in: {
    title: 'PHIẾU THU',
    who: 'Họ tên người nộp tiền',
    reason: 'Lý do nộp',
    signer: 'Người nộp tiền',
    got: 'Đã nhận đủ số tiền (viết bằng chữ)',
  },
  out: {
    title: 'PHIẾU CHI',
    who: 'Họ tên người nhận tiền',
    reason: 'Lý do chi',
    signer: 'Người nhận tiền',
    got: 'Đã nhận đủ số tiền (viết bằng chữ)',
  },
};

export default function CashVoucherPrint({ voucher, onClose, defaultFormat = 'a5' }) {
  const { store, settings } = useApp();
  const [format, setFormat] = useState(defaultFormat);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); window.print(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!voucher) return null;

  const t = SIDE[voucher.direction] || SIDE.in;
  const isA4 = format === 'a4';
  const px = (a5, a4) => (isA4 ? a4 : a5);

  /* Số quyển / số phiếu: dùng luôn mã chứng từ của phần mềm (PT…, PC…),
     khỏi phải đánh số tay và không bao giờ trùng. */
  const body = (
    <div className={isA4 ? 'print-a4 text-black bg-white' : 'print-a5 text-black bg-white'}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ maxWidth: '60%' }}>
          <div style={{ fontWeight: 800, fontSize: px(13, 15) }}>{store?.name || 'CỬA HÀNG'}</div>
          {store?.address && <div style={{ fontSize: px(10, 11) }}>{store.address}</div>}
          {store?.phone && <div style={{ fontSize: px(10, 11) }}>ĐT: {store.phone}</div>}
          {store?.tax_code && <div style={{ fontSize: px(10, 11) }}>MST: {store.tax_code}</div>}
        </div>
        <div style={{ textAlign: 'right', fontSize: px(10, 11) }}>
          <div>Số phiếu: <b>{voucher.code}</b></div>
          <div>Ngày {date(voucher.ts)}</div>
        </div>
      </div>

      <div style={{ textAlign: 'center', margin: px('14px 0 4px', '20px 0 6px') }}>
        <div style={{ fontWeight: 800, fontSize: px(17, 20), letterSpacing: 2 }}>{t.title}</div>
        <div style={{ fontSize: px(10, 11), fontStyle: 'italic' }}>Ngày {date(voucher.ts)}</div>
      </div>

      <table style={{ width: '100%', fontSize: px(11.5, 13), marginTop: px(8, 12) }}>
        <tbody>
          <tr>
            <td style={{ width: px(150, 180), padding: '4px 0', verticalAlign: 'top' }}>{t.who}</td>
            <td style={{ fontWeight: 700, borderBottom: '1px dotted #666' }}>
              {voucher.partner_name || '.....................................'}
            </td>
          </tr>
          {voucher.partner_address && (
            <tr>
              <td style={{ padding: '4px 0', verticalAlign: 'top' }}>Địa chỉ</td>
              <td style={{ borderBottom: '1px dotted #666' }}>{voucher.partner_address}</td>
            </tr>
          )}
          {voucher.partner_phone && (
            <tr>
              <td style={{ padding: '4px 0', verticalAlign: 'top' }}>Điện thoại</td>
              <td style={{ borderBottom: '1px dotted #666' }}>{voucher.partner_phone}</td>
            </tr>
          )}
          <tr>
            <td style={{ padding: '4px 0', verticalAlign: 'top' }}>{t.reason}</td>
            <td style={{ borderBottom: '1px dotted #666' }}>
              {voucher.note || voucher.category_label || '—'}
            </td>
          </tr>
          <tr>
            <td style={{ padding: '4px 0', verticalAlign: 'top' }}>Số tiền</td>
            <td style={{ fontWeight: 800, fontSize: px(14, 16), borderBottom: '1px dotted #666' }}>
              {money(voucher.amount)}
            </td>
          </tr>
          <tr>
            {/* Dòng bắt buộc của chứng từ tiền mặt: chữ số sửa được, chữ thì không */}
            <td style={{ padding: '4px 0', verticalAlign: 'top' }}>Bằng chữ</td>
            <td style={{ fontStyle: 'italic', borderBottom: '1px dotted #666' }}>
              {readMoney(voucher.amount)}
            </td>
          </tr>
          <tr>
            <td style={{ padding: '4px 0', verticalAlign: 'top' }}>Hình thức</td>
            <td style={{ borderBottom: '1px dotted #666' }}>
              {voucher.account_type === 'bank' ? 'Chuyển khoản' : 'Tiền mặt'}
              {voucher.account_name ? ` · ${voucher.account_name}` : ''}
            </td>
          </tr>
          {voucher.ref_code && (
            <tr>
              <td style={{ padding: '4px 0', verticalAlign: 'top' }}>Kèm chứng từ</td>
              <td style={{ borderBottom: '1px dotted #666' }}>{voucher.ref_code}</td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={{ fontSize: px(10.5, 12), marginTop: px(10, 14) }}>
        {t.got}: <i>{readMoney(voucher.amount)}</i>
      </div>

      <div style={{
        display: 'flex', justifyContent: 'space-between', textAlign: 'center',
        fontSize: px(10.5, 12), marginTop: px(18, 26), gap: 8,
      }}>
        {[
          ['Người lập phiếu', voucher.user_name || ''],
          [t.signer, ''],
          ['Thủ quỹ', ''],
          ['Chủ cửa hàng', ''],
        ].map(([role, name]) => (
          <div key={role} style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>{role}</div>
            <div style={{ fontSize: px(9, 10), fontStyle: 'italic' }}>(ký, ghi rõ họ tên)</div>
            <div style={{ height: px(38, 52) }} />
            <div>{name}</div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={`${t.title} ${voucher.code}`}
        subtitle={`${voucher.partner_name || 'Không ghi tên'} · ${money(voucher.amount)} · ${datetime(voucher.ts)}`}
        size="lg"
        footer={
          <>
            <div className="flex gap-1 mr-auto">
              {[['a5', 'Khổ A5'], ['a4', 'Khổ A4']].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setFormat(k)}
                  className={`btn btn-sm ${format === k ? 'btn-primary' : 'btn-outline'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button onClick={onClose}>Đóng</Button>
            <Button variant="primary" icon={Printer} onClick={() => window.print()}>
              In phiếu
            </Button>
          </>
        }
      >
        <div className="border border-line rounded-lg bg-slate-100 p-4 overflow-auto max-h-[55vh]">
          <div className="bg-white mx-auto shadow-sm" style={{ width: 'fit-content' }}>{body}</div>
        </div>
      </Modal>
      <div className={`print-area size-${format}`}>{body}</div>
    </>
  );
}

/**
 * Nút in một phiếu thu/chi theo số phiếu.
 *
 * Tự đi lấy nội dung phiếu khi bấm, nên chỗ gọi chỉ cần biết mỗi cái id —
 * khỏi phải nạp sẵn cả tờ phiếu cho mỗi dòng trong sổ quỹ.
 */
export function useCashVoucher() {
  const [voucher, setVoucher] = useState(null);
  return {
    voucher,
    open: setVoucher,
    close: () => setVoucher(null),
  };
}
