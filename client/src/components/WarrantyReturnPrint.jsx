/* ====================================================================
   PHIẾU TRẢ HÀNG BẢO HÀNH / SỬA CHỮA

   In lúc trả máy cho khách. Liệt kê ba nhóm tiền (tài liệu 09, mục 2):
     1. linh kiện — hàng trong kho (kèm "giảm giá hỗ trợ" nếu tính rẻ hơn
        giá niêm yết) và linh kiện mua ngoài
     2. tiền công kỹ thuật
     3. phí phát sinh khác
   rồi miễn giảm, tổng phải trả và phần khách đã trả.

   Linh kiện hiện GIÁ BÁN, không hiện giá vốn: đây là tờ giấy đưa cho
   khách, giá vốn là chuyện riêng của tiệm.

   Hai khổ giấy: A5 in máy in thường cho tờ phiếu đàng hoàng, K80 in máy
   in nhiệt ở quầy cho nhanh.
   ==================================================================== */
import { useState, useEffect } from 'react';
import { Printer } from 'lucide-react';
import { useApp } from '../lib/store';
import { n, qty as fq, date, datetime } from '../lib/format';
import { Button, Modal } from './ui';

const RESOLUTION_LABEL = {
  repair: 'Tiệm sửa',
  supplier: 'Gửi hãng / nhà cung cấp sửa',
  exchange: 'Đổi máy mới',
  refund: 'Hoàn tiền',
  reject: 'Từ chối bảo hành',
};

export default function WarrantyReturnPrint({ ticket, store, onClose }) {
  const { settings } = useApp();
  const [format, setFormat] = useState(settings?.invoice?.default_format === 'k80' ? 'k80' : 'a5');
  const k80Width = Number(settings?.invoice?.k80_width) || 72;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); window.print(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!ticket) return null;

  const repair = ticket.ticket_type === 'repair';
  const title = repair ? 'PHIẾU TRẢ HÀNG SỬA CHỮA' : 'PHIẾU TRẢ HÀNG BẢO HÀNH';
  const parts = ticket.parts || [];
  const custom = ticket.custom_parts || [];
  const fees = ticket.fees || [];
  /* Phiếu cũ chưa có cột giá bán thì lùi về giá vốn, còn hơn hiện 0 đồng */
  const partLine = (p) => (p.amount_sale > 0 ? p.amount_sale : p.amount);
  const partUnit = (p) => (p.price > 0 ? p.price : p.unit_cost);
  const partsTotal = parts.reduce((a, p) => a + partLine(p), 0);
  const customTotal = custom.reduce((a, c) => a + (c.amount || 0), 0);
  const feesTotal = fees.reduce((a, f) => a + (f.amount || 0), 0);
  const labor = ticket.labor_fee || 0;
  const discount = ticket.discount || 0;
  const charge = ticket.charge || 0;
  const owed = Math.max(0, charge - (ticket.paid || 0));
  const support = (p) => p.support_discount || 0;
  const supportTotal = parts.reduce((a, p) => a + support(p), 0);
  const exchangeLine = ticket.exchange_product_name
    ? `${ticket.exchange_product_name}${ticket.exchange_serial ? ` · SN ${ticket.exchange_serial}` : ''}`
      + `${ticket.exchange_warranty_until ? ` · BH tới ${date(ticket.exchange_warranty_until)}` : ''}`
      + ` — Đổi mới từ sản phẩm cũ có mã BH: ${ticket.code}`
    : null;

  /* ------------------------------ K80 ------------------------------ */
  const k80 = (
    <div className="print-k80 text-black bg-white" style={{ width: `${k80Width}mm`, padding: '3mm 2mm' }}>
      <div style={{ textAlign: 'center', marginBottom: 6 }}>
        <div style={{ fontWeight: 800, fontSize: 13 }}>{store.name}</div>
        {store.address && <div style={{ fontSize: 9, fontWeight: 400 }}>{store.address}</div>}
        {store.phone && <div style={{ fontSize: 9, fontWeight: 400 }}>ĐT: {store.phone}</div>}
      </div>
      <div style={{ textAlign: 'center', borderTop: '1px dashed #000', borderBottom: '1px dashed #000', padding: '4px 0', marginBottom: 5 }}>
        <div style={{ fontWeight: 800, fontSize: 12 }}>{title}</div>
        <div style={{ fontSize: 9, fontWeight: 400 }}>{ticket.code} · {date(ticket.delivered_at || ticket.ts)}</div>
      </div>

      <div style={{ fontSize: 10, textAlign: 'left', fontWeight: 400, marginBottom: 5 }}>
        <div>Khách: <b>{ticket.customer_display || ticket.customer_name || 'Khách lẻ'}</b></div>
        {ticket.phone_display && <div>ĐT: {ticket.phone_display}</div>}
        <div>Hàng: <b>{ticket.product_name}</b>{ticket.serial ? ` · SN ${ticket.serial}` : ''}</div>
        {ticket.issue && <div>Lỗi: {ticket.issue}</div>}
        <div>Xử lý: {RESOLUTION_LABEL[ticket.resolution] || '—'}</div>
        {ticket.technician_name && <div>Kỹ thuật: {ticket.technician_name}</div>}
        {exchangeLine && <div>Đổi mới: {exchangeLine}</div>}
      </div>

      {(parts.length > 0 || custom.length > 0) && (
        <>
          <div style={{ borderTop: '1px dashed #000', paddingTop: 4, fontSize: 10, fontWeight: 700, textAlign: 'left' }}>
            VẬT TƯ, LINH KIỆN THAY THẾ
          </div>
          {parts.map((p) => (
            <div key={`p${p.id}`} style={{ fontSize: 10, fontWeight: 400, textAlign: 'left', marginTop: 2 }}>
              <div>{p.product_name}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{fq(p.qty)} {p.base_unit} × {n(partUnit(p))}</span>
                <b>{n(partLine(p))}</b>
              </div>
              {support(p) > 0 && <div style={{ fontStyle: 'italic' }}>Giảm giá hỗ trợ: {n(support(p))}đ ({p.support_percent}%)</div>}
            </div>
          ))}
          {custom.map((c) => (
            <div key={`c${c.id}`} style={{ fontSize: 10, fontWeight: 400, textAlign: 'left', marginTop: 2 }}>
              <div>{c.name}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{fq(c.qty)} × {n(c.price)}</span><b>{n(c.amount)}</b>
              </div>
            </div>
          ))}
        </>
      )}

      <div style={{ borderTop: '1px dashed #000', marginTop: 5, paddingTop: 4, fontSize: 11 }}>
        {(parts.length > 0 || custom.length > 0) && <Row label="Tiền linh kiện" value={n(partsTotal + customTotal)} />}
        <Row label="Tiền công" value={n(labor)} />
        {fees.map((f) => <Row key={`f${f.id}`} label={f.name} value={n(f.amount)} />)}
        {discount > 0 && <Row label="Miễn giảm" value={`-${n(discount)}`} />}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 13, marginTop: 3 }}>
          <span>TỔNG CỘNG</span><span>{n(charge)}</span>
        </div>
        <Row label="Khách đã trả" value={n(ticket.paid || 0)} />
        {owed > 0 && <Row label="Còn nợ" value={n(owed)} bold />}
      </div>

      <div style={{ textAlign: 'center', fontSize: 9, fontWeight: 400, marginTop: 8, borderTop: '1px dashed #000', paddingTop: 4 }}>
        Cảm ơn quý khách. Giữ phiếu để đối chiếu khi cần.
      </div>
    </div>
  );

  /* ------------------------------- A5 ------------------------------ */
  const th = { textAlign: 'left', padding: '3px 0' };
  const a5 = (
    <div className="print-a5 text-black bg-white">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{store.name}</div>
          {store.address && <div style={{ fontSize: 10 }}>{store.address}</div>}
          {store.phone && <div style={{ fontSize: 10 }}>ĐT: {store.phone}</div>}
        </div>
        <div style={{ textAlign: 'right', fontSize: 10 }}>
          <div>Số phiếu: <b>{ticket.code}</b></div>
          <div>Ngày trả {date(ticket.delivered_at || ticket.ts)}</div>
          <div>Nhận ngày {date(ticket.ts)}</div>
        </div>
      </div>

      <div style={{ textAlign: 'center', margin: '12px 0 8px' }}>
        <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: 1 }}>{title}</div>
      </div>

      <table style={{ width: '100%', fontSize: 11, marginBottom: 8 }}>
        <tbody>
          <tr>
            <td style={{ width: 88, padding: '2px 0' }}>Khách hàng</td>
            <td style={{ fontWeight: 700 }}>{ticket.customer_display || ticket.customer_name || 'Khách lẻ'}</td>
            <td style={{ width: 70 }}>Điện thoại</td>
            <td>{ticket.phone_display || '—'}</td>
          </tr>
          <tr>
            <td style={{ padding: '2px 0' }}>{repair ? 'Hàng sửa chữa' : 'Hàng bảo hành'}</td>
            <td style={{ fontWeight: 700 }}>{ticket.product_name}</td>
            <td>Số serial</td>
            <td>{ticket.serial || '—'}</td>
          </tr>
          <tr>
            <td style={{ padding: '2px 0' }}>Tình trạng</td>
            <td colSpan={3}>{ticket.issue || '—'}</td>
          </tr>
          <tr>
            <td style={{ padding: '2px 0' }}>Hướng xử lý</td>
            <td colSpan={3} style={{ fontWeight: 700 }}>
              {RESOLUTION_LABEL[ticket.resolution] || '—'}
              {ticket.in_warranty ? ' · Còn hạn bảo hành' : ''}
              {ticket.technician_name ? ` · Kỹ thuật viên: ${ticket.technician_name}` : ''}
            </td>
          </tr>
          {exchangeLine && (
            <tr>
              <td style={{ padding: '2px 0' }}>Đổi mới</td>
              <td colSpan={3} style={{ fontWeight: 700 }}>{exchangeLine}</td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 3 }}>1. VẬT TƯ, LINH KIỆN THAY THẾ</div>
      {parts.length === 0 && custom.length === 0 ? (
        <div style={{ fontSize: 11, fontStyle: 'italic', marginBottom: 6 }}>Không thay linh kiện nào.</div>
      ) : (
        <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', marginBottom: 6 }}>
          <thead>
            <tr style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000' }}>
              <th style={{ ...th, width: 26 }}>TT</th>
              <th style={th}>Tên vật tư</th>
              <th style={{ textAlign: 'right', width: 40 }}>SL</th>
              <th style={{ textAlign: 'left', width: 40 }}>ĐVT</th>
              <th style={{ textAlign: 'right', width: 76 }}>Đơn giá</th>
              <th style={{ textAlign: 'right', width: 84 }}>Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p, i) => (
              <tr key={`p${p.id}`} style={{ borderBottom: '1px solid #ddd', verticalAlign: 'top' }}>
                <td style={{ padding: '3px 0' }}>{i + 1}</td>
                <td>
                  {p.product_name}
                  {support(p) > 0 && (
                    <div style={{ fontSize: 9.5, fontStyle: 'italic' }}>
                      Giá niêm yết {n(p.list_price)} · Giảm giá hỗ trợ: {n(support(p))}đ ({p.support_percent}%)
                    </div>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>{fq(p.qty)}</td>
                <td>{p.base_unit}</td>
                <td style={{ textAlign: 'right' }}>{n(partUnit(p))}</td>
                <td style={{ textAlign: 'right' }}>{n(partLine(p))}</td>
              </tr>
            ))}
            {custom.map((c, i) => (
              <tr key={`c${c.id}`} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: '3px 0' }}>{parts.length + i + 1}</td>
                <td>{c.name}</td>
                <td style={{ textAlign: 'right' }}>{fq(c.qty)}</td>
                <td />
                <td style={{ textAlign: 'right' }}>{n(c.price)}</td>
                <td style={{ textAlign: 'right' }}>{n(c.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <table style={{ marginLeft: 'auto', fontSize: 11, minWidth: 230 }}>
        <tbody>
          {(parts.length > 0 || custom.length > 0) && (
            <tr><td style={{ padding: '2px 0' }}>1. Tiền vật tư, linh kiện</td>
              <td style={{ textAlign: 'right' }}>{n(partsTotal + customTotal)}</td></tr>
          )}
          {supportTotal > 0 && (
            <tr style={{ fontStyle: 'italic' }}><td style={{ padding: '2px 0' }}>(đã giảm giá hỗ trợ linh kiện)</td>
              <td style={{ textAlign: 'right' }}>{n(supportTotal)}</td></tr>
          )}
          <tr><td style={{ padding: '2px 0' }}>2. Tiền công kỹ thuật</td>
            <td style={{ textAlign: 'right' }}>{n(labor)}</td></tr>
          {fees.map((f, i) => (
            <tr key={`f${f.id}`}><td style={{ padding: '2px 0' }}>{i === 0 ? '3. ' : ''}{f.name}{f.note ? ` (${f.note})` : ''}</td>
              <td style={{ textAlign: 'right' }}>{n(f.amount)}</td></tr>
          ))}
          {fees.length > 1 && (
            <tr><td style={{ padding: '2px 0' }}>Cộng phí phát sinh</td><td style={{ textAlign: 'right' }}>{n(feesTotal)}</td></tr>
          )}
          {discount > 0 && (
            <tr><td style={{ padding: '2px 0' }}>Miễn giảm</td><td style={{ textAlign: 'right' }}>-{n(discount)}</td></tr>
          )}
          <tr style={{ borderTop: '1px solid #000', fontWeight: 800, fontSize: 12 }}>
            <td style={{ padding: '4px 0' }}>TỔNG CỘNG</td>
            <td style={{ textAlign: 'right', padding: '4px 0' }}>{n(charge)} đ</td></tr>
          <tr><td style={{ padding: '2px 0' }}>Khách đã trả</td>
            <td style={{ textAlign: 'right' }}>{n(ticket.paid || 0)}</td></tr>
          {owed > 0 && (
            <tr style={{ fontWeight: 700 }}>
              <td style={{ padding: '2px 0' }}>Còn nợ lại</td>
              <td style={{ textAlign: 'right' }}>{n(owed)} đ</td></tr>
          )}
          {ticket.refund_amount > 0 && (
            <tr style={{ fontWeight: 700 }}>
              <td style={{ padding: '2px 0' }}>Tiệm hoàn khách</td>
              <td style={{ textAlign: 'right' }}>{n(ticket.refund_amount)} đ</td></tr>
          )}
        </tbody>
      </table>

      {ticket.note && <div style={{ fontSize: 10, marginTop: 8 }}>Ghi chú: {ticket.note}</div>}

      <div style={{ fontSize: 9, marginTop: 10, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 700 }}>Lưu ý</div>
        <div>1. Quý khách kiểm tra hàng trước khi rời cửa hàng.</div>
        <div>2. Linh kiện thay mới được bảo hành theo quy định của hãng.</div>
        <div>3. Giữ phiếu này để đối chiếu khi cần.</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', textAlign: 'center', fontSize: 10, marginTop: 18 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>Khách hàng nhận hàng</div>
          <div style={{ fontSize: 9 }}>(ký, ghi rõ họ tên)</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>Người giao hàng</div>
          <div style={{ fontSize: 9 }}>{ticket.technician_name || ticket.received_by_name || ''}</div>
        </div>
      </div>
    </div>
  );

  const body = format === 'k80' ? k80 : a5;

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={`${repair ? 'Phiếu trả hàng sửa chữa' : 'Phiếu trả hàng bảo hành'} ${ticket.code}`}
        subtitle={`${ticket.customer_display || 'Khách lẻ'} · ${datetime(ticket.delivered_at || ticket.ts)}`}
        size="lg"
        footer={
          <>
            <div className="flex gap-1 mr-auto">
              {[['a5', 'Khổ A5'], ['k80', 'Máy in nhiệt K80']].map(([k, label]) => (
                <button
                  key={k}
                  type="button"
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

/** Một dòng số tiền trên phiếu K80. */
function Row({ label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: bold ? 700 : 400 }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}
