/* ====================================================================
   PHIẾU GIAO HÀNG — tờ giấy đưa cho người đi giao

   Cố ý làm gọn: chỉ TÊN HÀNG, SỐ LƯỢNG và SỐ TIỀN CẦN THU. Không có
   đơn giá, không có giá vốn, không có thành tiền từng dòng.

   Lý do: tờ này qua tay người ngoài tiệm (shipper, xe ôm, có khi là
   khách của khách). Đơn giá từng món là chuyện làm ăn của tiệm, in ra
   là cho không đối thủ bảng giá. Người giao hàng chỉ cần biết giao cái
   gì, bao nhiêu cái, và cầm về bao nhiêu tiền.

   Ba khổ: K80 cho máy in nhiệt ở quầy, A5 cho tờ phiếu có chỗ ký,
   A4 khi đơn nhiều dòng hàng.
   ==================================================================== */
import { useState, useEffect } from 'react';
import { Printer } from 'lucide-react';
import { useApp } from '../lib/store';
import { money, n, qty as fq, date, datetime, readMoney } from '../lib/format';
import { Button, Modal } from './ui';

export default function DeliveryNotePrint({ note, onClose }) {
  const { store, settings } = useApp();
  const [format, setFormat] = useState(
    settings?.invoice?.default_format === 'k80' ? 'k80' : 'a5');
  const k80Width = Number(settings?.invoice?.k80_width) || 72;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); window.print(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!note) return null;

  const items = note.items || [];
  const totalQty = items.reduce((a, it) => a + Number(it.qty || 0), 0);
  /* Số tiền người giao phải cầm về. Đơn đã trả trước thì bằng 0 — và phải
     nói rõ "KHÔNG THU TIỀN", chứ để trống thì shipper dễ đòi tiền lần nữa. */
  const collect = Math.max(0, Number(note.owed ?? (note.total - note.paid)) || 0);
  const receiver = note.delivery_name || note.customer_name || 'Khách lẻ';
  const phone = note.delivery_phone || note.customer_phone || '';

  /* ------------------------------ K80 ------------------------------ */
  const k80 = (
    <div className="print-k80 text-black bg-white" style={{ width: `${k80Width}mm`, padding: '3mm 2mm' }}>
      <div style={{ textAlign: 'center', marginBottom: 6 }}>
        <div style={{ fontWeight: 800, fontSize: 13 }}>{store?.name}</div>
        {store?.phone && <div style={{ fontSize: 9, fontWeight: 400 }}>ĐT: {store.phone}</div>}
      </div>
      <div style={{
        textAlign: 'center', borderTop: '1px dashed #000', borderBottom: '1px dashed #000',
        padding: '4px 0', marginBottom: 5,
      }}>
        <div style={{ fontWeight: 800, fontSize: 12 }}>PHIẾU GIAO HÀNG</div>
        <div style={{ fontSize: 9, fontWeight: 400 }}>{note.code} · {date(note.ts)}</div>
      </div>

      <div style={{ fontSize: 10, textAlign: 'left', fontWeight: 400, marginBottom: 5 }}>
        <div>Người nhận: <b>{receiver}</b></div>
        {phone && <div>ĐT: <b>{phone}</b></div>}
        {note.delivery_address && <div>Địa chỉ: {note.delivery_address}</div>}
        {note.shipper_name && <div>Người giao: {note.shipper_name}</div>}
      </div>

      <div style={{ borderTop: '1px dashed #000', paddingTop: 4 }}>
        {items.map((it, i) => (
          <div key={it.id || i} style={{ fontSize: 10.5, fontWeight: 400, textAlign: 'left', marginTop: 3 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
              <span>{i + 1}. {it.name_snapshot}</span>
              <b style={{ whiteSpace: 'nowrap' }}>{fq(it.qty)} {it.unit_name}</b>
            </div>
          </div>
        ))}
      </div>

      <div style={{ borderTop: '1px dashed #000', marginTop: 5, paddingTop: 4, fontSize: 11 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Số món</span><span>{items.length} · {fq(totalQty)} đơn vị</span>
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontWeight: 800, fontSize: 13, marginTop: 4,
          borderTop: '1px solid #000', paddingTop: 4,
        }}>
          <span>{collect > 0 ? 'CẦN THU' : 'KHÔNG THU TIỀN'}</span>
          <span>{collect > 0 ? n(collect) : '0'}</span>
        </div>
        {collect === 0 && (
          <div style={{ fontSize: 9.5, fontWeight: 400, textAlign: 'center', marginTop: 2 }}>
            (khách đã thanh toán tại cửa hàng)
          </div>
        )}
      </div>

      <div style={{
        textAlign: 'center', fontSize: 9, fontWeight: 400, marginTop: 10,
        borderTop: '1px dashed #000', paddingTop: 4,
      }}>
        Người nhận ký tên
        <div style={{ height: 34 }} />
        ..............................
      </div>
    </div>
  );

  /* --------------------------- A5 và A4 ---------------------------- */
  const isA4 = format === 'a4';
  const px = (a5, a4) => (isA4 ? a4 : a5);
  const paper = (
    <div className={isA4 ? 'print-a4 text-black bg-white' : 'print-a5 text-black bg-white'}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: px(14, 16) }}>{store?.name}</div>
          {store?.address && <div style={{ fontSize: px(10, 11) }}>{store.address}</div>}
          {store?.phone && <div style={{ fontSize: px(10, 11) }}>ĐT: {store.phone}</div>}
        </div>
        <div style={{ textAlign: 'right', fontSize: px(10, 11) }}>
          <div>Số phiếu: <b>{note.code}</b></div>
          <div>Ngày {date(note.ts)}</div>
          {note.tracking_code && <div>Mã vận đơn: <b>{note.tracking_code}</b></div>}
        </div>
      </div>

      <div style={{ textAlign: 'center', margin: px('12px 0 10px', '18px 0 14px') }}>
        <div style={{ fontWeight: 800, fontSize: px(16, 19), letterSpacing: 1.5 }}>PHIẾU GIAO HÀNG</div>
      </div>

      <table style={{ width: '100%', fontSize: px(11, 12.5), marginBottom: px(8, 12) }}>
        <tbody>
          <tr>
            <td style={{ width: px(92, 110), padding: '3px 0' }}>Người nhận</td>
            <td style={{ fontWeight: 700 }}>{receiver}</td>
            <td style={{ width: px(70, 84) }}>Điện thoại</td>
            <td style={{ fontWeight: 700 }}>{phone || '—'}</td>
          </tr>
          <tr>
            <td style={{ padding: '3px 0', verticalAlign: 'top' }}>Địa chỉ giao</td>
            <td colSpan={3} style={{ fontWeight: 700 }}>{note.delivery_address || '—'}</td>
          </tr>
          <tr>
            <td style={{ padding: '3px 0' }}>Người giao</td>
            <td>{note.shipper_name || note.carrier_name || '—'}</td>
            <td>Ngày hẹn</td>
            <td>{note.promised_at ? date(note.promised_at) : '—'}</td>
          </tr>
        </tbody>
      </table>

      {/* Cố ý KHÔNG có cột đơn giá và thành tiền: tờ này qua tay người
          ngoài tiệm, bảng giá của tiệm không nên đi theo. */}
      <table className="lines" style={{ width: '100%', fontSize: px(11, 12.5), borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ width: px(30, 36) }}>TT</th>
            <th style={{ textAlign: 'left' }}>TÊN HÀNG</th>
            <th style={{ width: px(60, 74) }}>SỐ LƯỢNG</th>
            <th style={{ width: px(54, 66) }}>ĐVT</th>
            <th style={{ width: px(70, 90) }}>GHI CHÚ</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id || i}>
              <td style={{ textAlign: 'center' }}>{i + 1}</td>
              <td>{it.name_snapshot}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{fq(it.qty)}</td>
              <td style={{ textAlign: 'center' }}>{it.unit_name}</td>
              <td />
            </tr>
          ))}
          <tr>
            <td colSpan={2} style={{ textAlign: 'right', fontWeight: 700 }}>Tổng cộng</td>
            <td style={{ textAlign: 'right', fontWeight: 800 }}>{fq(totalQty)}</td>
            <td colSpan={2} style={{ textAlign: 'left' }}>{items.length} mặt hàng</td>
          </tr>
        </tbody>
      </table>

      <div style={{
        marginTop: px(10, 14), padding: px('7px 10px', '10px 14px'),
        border: '2px solid #000', display: 'flex',
        justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ fontWeight: 800, fontSize: px(13, 15) }}>
          {collect > 0 ? 'SỐ TIỀN CẦN THU' : 'KHÔNG THU TIỀN'}
        </div>
        <div style={{ fontWeight: 800, fontSize: px(16, 19) }}>{money(collect)}</div>
      </div>
      <div style={{ fontSize: px(10, 11), fontStyle: 'italic', marginTop: 4 }}>
        {collect > 0
          ? `Bằng chữ: ${readMoney(collect)}`
          : 'Khách đã thanh toán tại cửa hàng, người giao không thu thêm khoản nào.'}
      </div>

      {note.delivery_note && (
        <div style={{ fontSize: px(10, 11), marginTop: 8 }}>Ghi chú: {note.delivery_note}</div>
      )}

      <div style={{
        display: 'flex', justifyContent: 'space-between', textAlign: 'center',
        fontSize: px(10.5, 12), marginTop: px(20, 30),
      }}>
        {['Người lập phiếu', 'Người giao hàng', 'Người nhận hàng'].map((role) => (
          <div key={role} style={{ flex: 1 }}>
            <div style={{ fontWeight: 700 }}>{role}</div>
            <div style={{ fontSize: px(9, 10), fontStyle: 'italic' }}>(ký, ghi rõ họ tên)</div>
            <div style={{ height: px(40, 54) }} />
          </div>
        ))}
      </div>
    </div>
  );

  const body = format === 'k80' ? k80 : paper;

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={`Phiếu giao hàng ${note.code}`}
        subtitle={`${receiver} · ${items.length} mặt hàng · ${collect > 0 ? `cần thu ${money(collect)}` : 'không thu tiền'}`}
        size="lg"
        footer={
          <>
            <div className="flex gap-1 mr-auto">
              {[['k80', 'Máy in nhiệt K80'], ['a5', 'Khổ A5'], ['a4', 'Khổ A4']].map(([k, label]) => (
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
              In phiếu giao
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
