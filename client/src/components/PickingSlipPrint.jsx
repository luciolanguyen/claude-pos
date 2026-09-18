/* ====================================================================
   PHIẾU SOẠN HÀNG CHO NHÂN VIÊN (BRD nâng cấp, mục 3)

   Tờ giấy đưa người đi lấy hàng trong kho. Cố tình KHÔNG có một con số
   tiền nào: phiếu này nằm trong tay người soạn hàng, đưa qua đưa lại
   trong kho, khách đứng cạnh cũng nhìn thấy.

   Có ba thứ người soạn cần: tên hàng, VỊ TRÍ KỆ, và số lượng — cùng một ô
   vuông để tích khi đã lấy xong món đó.

   Khổ K80 in ở máy in nhiệt ngay quầy; khổ A5 khi đơn dài hoặc muốn kẹp
   vào sổ.
   ==================================================================== */
import { useState, useEffect } from 'react';
import { Printer } from 'lucide-react';
import { qty as fq, datetime } from '../lib/format';
import { Button, Modal } from './ui';

export default function PickingSlipPrint({ sale, store, onClose }) {
  const [format, setFormat] = useState('k80');

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); window.print(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!sale) return null;
  const items = sale.items || [];
  const consign = sale.consign_items || [];
  const isA5 = format === 'a5';

  const head = (
    <>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: isA5 ? 14 : 13 }}>{store?.name || 'CỬA HÀNG'}</div>
        <div style={{ fontWeight: 700, fontSize: isA5 ? 17 : 14, letterSpacing: 1, marginTop: 2 }}>
          PHIẾU SOẠN HÀNG
        </div>
        <div>
          {sale.code} · {datetime(sale.ts)}
        </div>
        <div>
          Khách: <b>{sale.customer_name || 'Khách lẻ'}</b>
          {sale.delivery_address ? ' · GIAO TẬN NƠI' : ''}
        </div>
      </div>
      <div className={isA5 ? '' : 'dashed'} style={isA5 ? { borderTop: '1px solid #000', margin: '6px 0' } : undefined} />
    </>
  );

  const rows = (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left', width: 18 }}>✓</th>
          <th style={{ textAlign: 'left' }}>Tên hàng</th>
          <th style={{ textAlign: 'left', width: isA5 ? 90 : 62 }}>Vị trí kệ</th>
          <th style={{ textAlign: 'right', width: isA5 ? 90 : 62 }}>Số lượng</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <tr key={`i${it.id}`} style={{ borderTop: '1px dotted #999' }}>
            <td style={{ verticalAlign: 'top', paddingTop: 3 }}>
              <span style={{ display: 'inline-block', width: 11, height: 11, border: '1px solid #000' }} />
            </td>
            <td style={{ paddingTop: 3, paddingBottom: 3 }}>
              <div style={{ fontWeight: 700 }}>{it.name_snapshot}</div>
              <div style={{ fontSize: isA5 ? 10 : 9 }}>{it.sku}{it.note ? ` · ${it.note}` : ''}</div>
            </td>
            <td style={{ verticalAlign: 'top', paddingTop: 3, fontWeight: 700 }}>
              {it.location || '—'}
            </td>
            <td style={{ textAlign: 'right', verticalAlign: 'top', paddingTop: 3, fontWeight: 700, whiteSpace: 'nowrap' }}>
              {fq(it.qty)} {it.unit_name}
            </td>
          </tr>
        ))}
        {consign.map((c) => (
          <tr key={`c${c.id}`} style={{ borderTop: '1px dotted #999' }}>
            <td style={{ verticalAlign: 'top', paddingTop: 3 }}>
              <span style={{ display: 'inline-block', width: 11, height: 11, border: '1px solid #000' }} />
            </td>
            <td style={{ paddingTop: 3, paddingBottom: 3 }}>
              <div style={{ fontWeight: 700 }}>{c.name}</div>
              <div style={{ fontSize: isA5 ? 10 : 9 }}>Hàng mua hộ — lấy ngoài, không có trong kho</div>
            </td>
            <td style={{ verticalAlign: 'top', paddingTop: 3 }}>—</td>
            <td style={{ textAlign: 'right', verticalAlign: 'top', paddingTop: 3, fontWeight: 700, whiteSpace: 'nowrap' }}>
              {fq(c.qty)} {c.unit_name || ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const foot = (
    <>
      <div className={isA5 ? '' : 'dashed'} style={isA5 ? { borderTop: '1px solid #000', margin: '6px 0' } : undefined} />
      <div style={{ display: 'flex', justifyContent: 'space-between', textAlign: 'center', marginTop: 4 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>Người soạn hàng</div>
          <div style={{ fontSize: 9, fontStyle: 'italic' }}>(ký, ghi rõ họ tên)</div>
          <div style={{ height: isA5 ? 44 : 34 }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>Người kiểm lại</div>
          <div style={{ fontSize: 9, fontStyle: 'italic' }}>(ký, ghi rõ họ tên)</div>
          <div style={{ height: isA5 ? 44 : 34 }} />
        </div>
      </div>
      {sale.note && <div style={{ marginTop: 4 }}>Ghi chú: {sale.note}</div>}
    </>
  );

  const sheet = (
    <div className={`${isA5 ? 'print-a5' : 'print-k80'} text-black bg-white`}>
      {head}
      {rows}
      {foot}
    </div>
  );

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={`Phiếu soạn hàng — ${sale.code}`}
        subtitle="Không có giá tiền. Có vị trí kệ và số lượng để nhân viên đi lấy hàng."
        size="md"
        footer={<>
          <div className="flex items-center gap-1 mr-auto">
            {[['k80', 'Khổ K80'], ['a5', 'Khổ A5']].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFormat(k)} aria-pressed={format === k}
                className={`btn btn-sm ${format === k ? 'btn-primary' : 'btn-outline'}`}>{label}</button>
            ))}
          </div>
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" icon={Printer} onClick={() => window.print()}>In phiếu</Button>
        </>}
      >
        <div className="border border-line rounded-lg bg-slate-100 p-4 overflow-auto max-h-[55vh]">
          <div className="bg-white mx-auto shadow-sm" style={{ width: 'fit-content' }}>{sheet}</div>
        </div>
      </Modal>
      <div className={`print-area size-${format}`}>{sheet}</div>
    </>
  );
}
