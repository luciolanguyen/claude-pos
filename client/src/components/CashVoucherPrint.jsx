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

export default function CashVoucherPrint({ voucher, onClose, defaultFormat }) {
  const { store, settings } = useApp();
  /* Phiếu thu nợ in ở quầy thì khổ K80 là mặc định (tài liệu 14, mục 1.1):
     máy in nhiệt sẵn ngay đó, khỏi bật máy in giấy A4. */
  const isDebt = voucher?.category === 'debt_in' || voucher?.category === 'debt_out';
  const [format, setFormat] = useState(defaultFormat || (isDebt ? 'k80' : 'a5'));
  /* Có in số nợ còn lại lên phiếu hay không — mặc định theo thiết lập tiệm,
     đổi ngay tại đây cho từng lần in (tài liệu 14, mục 1.2) */
  const [showDebt, setShowDebt] = useState(true);

  useEffect(() => {
    setFormat(defaultFormat || (isDebt ? 'k80' : 'a5'));
  }, [defaultFormat, isDebt, voucher?.id]);

  useEffect(() => {
    setShowDebt(settings?.print?.debt_show_remaining !== false);
  }, [settings, voucher?.id]);

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
  /* Chỉ phiếu thu / trả nợ mới có hai con số này; phiếu chi tiền điện thì không */
  const hasDebt = voucher.debt_before !== null && voucher.debt_before !== undefined;

  /* ------------------------------------------------------------------ */
  /* Mẫu in K80 — máy in nhiệt 80mm ngay tại quầy (tài liệu 14, mục 1.1)  */
  /*                                                                     */
  /* Giấy hẹp nên bỏ hết khung viền, chỉ dùng đường gạch đứt chia khối.   */
  /* Dòng công nợ chỉ in khi được tích chọn — quầy đông người, số nợ của  */
  /* khách là chuyện riêng của khách (mục 1.2).                           */
  /* ------------------------------------------------------------------ */
  const k80 = (
    <div className="print-k80 text-black bg-white">
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{store?.name || 'CỬA HÀNG'}</div>
        {store?.address && <div>{store.address}</div>}
        {store?.phone && <div>ĐT: {store.phone}</div>}
      </div>

      <div className="dashed" />

      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14, letterSpacing: 1 }}>
        {t.title}
      </div>
      <div style={{ textAlign: 'center' }}>
        Số: {voucher.code}<br />
        {datetime(voucher.ts)}
      </div>

      <div className="dashed" />

      <table>
        <tbody>
          <tr>
            <td style={{ verticalAlign: 'top', paddingBottom: 2 }}>{t.who}</td>
            <td style={{ textAlign: 'right', fontWeight: 700, paddingBottom: 2 }}>
              {voucher.partner_name || '—'}
            </td>
          </tr>
          {voucher.partner_phone && (
            <tr>
              <td style={{ verticalAlign: 'top', paddingBottom: 2 }}>Điện thoại</td>
              <td style={{ textAlign: 'right', paddingBottom: 2 }}>{voucher.partner_phone}</td>
            </tr>
          )}
          <tr>
            <td style={{ verticalAlign: 'top', paddingBottom: 2 }}>{t.reason}</td>
            <td style={{ textAlign: 'right', paddingBottom: 2 }}>
              {voucher.note || voucher.category_label || '—'}
            </td>
          </tr>
          <tr>
            <td style={{ verticalAlign: 'top' }}>Hình thức</td>
            <td style={{ textAlign: 'right' }}>
              {voucher.account_type === 'bank' ? 'Chuyển khoản' : 'Tiền mặt'}
            </td>
          </tr>
          {voucher.counterparty_account && (
            <tr>
              <td style={{ verticalAlign: 'top' }}>Tài khoản nhận</td>
              <td style={{ textAlign: 'right' }}>{voucher.counterparty_account}</td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="dashed" />

      {/* Số tiền khách vừa nộp — to và rõ nhất trên tờ phiếu */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 10 }}>
          {voucher.direction === 'out' ? 'SỐ TIỀN ĐÃ CHI' : 'SỐ TIỀN ĐÃ THU'}
        </div>
        <div style={{ fontWeight: 700, fontSize: 19, lineHeight: 1.2 }}>{money(voucher.amount)}</div>
        <div style={{ fontStyle: 'italic', fontSize: 10 }}>{readMoney(voucher.amount)}</div>
      </div>

      {hasDebt && showDebt && (
        <>
          <div className="dashed" />
          <table>
            <tbody>
              <tr>
                <td>Nợ trước khi trả</td>
                <td style={{ textAlign: 'right' }}>{money(voucher.debt_before)}</td>
              </tr>
              <tr>
                <td>Vừa trả</td>
                <td style={{ textAlign: 'right' }}>−{money(voucher.amount)}</td>
              </tr>
              <tr style={{ fontWeight: 700 }}>
                <td>CÒN NỢ LẠI</td>
                <td style={{ textAlign: 'right' }}>{money(voucher.debt_after)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      <div className="dashed" />

      <div style={{ display: 'flex', justifyContent: 'space-between', textAlign: 'center', marginTop: 4 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>Người nộp</div>
          <div style={{ fontSize: 9, fontStyle: 'italic' }}>(ký, ghi rõ họ tên)</div>
          <div style={{ height: 34 }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>Người thu</div>
          <div style={{ fontSize: 9, fontStyle: 'italic' }}>(ký, ghi rõ họ tên)</div>
          <div style={{ height: 34 }} />
          <div>{voucher.user_name || ''}</div>
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: 4 }}>
        Cảm ơn quý khách!<br />
        <span style={{ fontSize: 9 }}>Xin giữ phiếu để đối chiếu công nợ</span>
      </div>
    </div>
  );

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
          {hasDebt && showDebt && (
            <>
              <tr>
                <td style={{ padding: '4px 0', verticalAlign: 'top' }}>Nợ trước khi trả</td>
                <td style={{ borderBottom: '1px dotted #666' }}>{money(voucher.debt_before)}</td>
              </tr>
              <tr>
                <td style={{ padding: '4px 0', verticalAlign: 'top' }}>Còn nợ lại</td>
                <td style={{ fontWeight: 800, borderBottom: '1px dotted #666' }}>
                  {money(voucher.debt_after)}
                </td>
              </tr>
            </>
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
            <div className="flex flex-wrap items-center gap-1 mr-auto">
              {[['k80', 'Khổ K80'], ['a5', 'Khổ A5'], ['a4', 'Khổ A4']].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setFormat(k)}
                  className={`btn btn-sm ${format === k ? 'btn-primary' : 'btn-outline'}`}
                >
                  {label}
                </button>
              ))}
              {/* Giấu số nợ khi quầy đông người (tài liệu 14, mục 1.2) */}
              {hasDebt && (
                <label className="flex items-center gap-1.5 text-[13px] cursor-pointer ml-2">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-emerald-700 cursor-pointer"
                    checked={showDebt}
                    onChange={(e) => setShowDebt(e.target.checked)}
                  />
                  Hiển thị số nợ còn lại trên phiếu
                </label>
              )}
            </div>
            <Button onClick={onClose}>Đóng</Button>
            <Button variant="primary" icon={Printer} onClick={() => window.print()}>
              In phiếu
            </Button>
          </>
        }
      >
        <div className="border border-line rounded-lg bg-slate-100 p-4 overflow-auto max-h-[55vh]">
          <div className="bg-white mx-auto shadow-sm" style={{ width: 'fit-content' }}>
            {format === 'k80' ? k80 : body}
          </div>
        </div>
      </Modal>
      <div className={`print-area size-${format}`}>{format === 'k80' ? k80 : body}</div>
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
