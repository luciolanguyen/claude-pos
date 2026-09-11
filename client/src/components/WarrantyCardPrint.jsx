/* ====================================================================
   PHIẾU BẢO HÀNH SẢN PHẨM (tài liệu 09, mục 5)

   In lúc bán xong cho những món có bảo hành. Hai kiểu:
     - Gộp: một tờ liệt kê mọi món bảo hành của hoá đơn
     - Tách: mỗi món một phiếu riêng — khách mang từng món đi bảo hành
       khác nhau, hoặc dán kèm vào hộp sản phẩm
   Có serial, thời hạn, ngày hết hạn và điều kiện bảo hành của từng món.
   ==================================================================== */
import { useState, useEffect } from 'react';
import { Printer, ShieldCheck } from 'lucide-react';
import { qty as fq, date } from '../lib/format';
import { Button, Modal } from './ui';

export const WARRANTY_CARD_MODES = [
  { key: 'combined', label: 'Gộp 1 tờ', hint: 'Mọi món bảo hành trên một phiếu' },
  { key: 'separate', label: 'Tách từng sản phẩm', hint: 'Mỗi món một phiếu riêng' },
];

/** Món nào của hoá đơn có bảo hành. */
export const warrantyItemsOf = (sale) => (sale?.items || []).filter((i) => Number(i.warranty_months) > 0);

function Header({ store, sale }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 10 }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: 13 }}>{store?.name}</div>
        {store?.address && <div>{store.address}</div>}
        {store?.phone && <div>ĐT: {store.phone}</div>}
      </div>
      <div style={{ textAlign: 'right' }}>
        <div>Hoá đơn: <b>{sale.code}</b></div>
        <div>Ngày mua: {date(sale.ts)}</div>
      </div>
    </div>
  );
}

function Customer({ sale }) {
  return (
    <div style={{ fontSize: 11, margin: '6px 0' }}>
      Khách hàng: <b>{sale.customer_name || 'Khách lẻ'}</b>
      {sale.customer_phone ? ` · ĐT ${sale.customer_phone}` : ''}
    </div>
  );
}

const Footer = ({ store }) => (
  <div style={{ fontSize: 9, marginTop: 8, lineHeight: 1.5, borderTop: '1px solid #000', paddingTop: 4 }}>
    <div>Vui lòng giữ phiếu này và mang theo khi bảo hành. Phiếu không có giá trị khi tẩy xoá.</div>
    {store?.warranty_note && <div>{store.warranty_note}</div>}
  </div>
);

export default function WarrantyCardPrint({ sale, store, mode: initialMode = 'combined', onClose }) {
  const [mode, setMode] = useState(initialMode);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); window.print(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const items = warrantyItemsOf(sale);
  if (!sale || !items.length) return null;

  const combined = (
    <div className="print-a5 text-black bg-white">
      <Header store={store} sale={sale} />
      <div style={{ textAlign: 'center', margin: '10px 0 4px', fontWeight: 800, fontSize: 15, letterSpacing: 1 }}>
        PHIẾU BẢO HÀNH
      </div>
      <Customer sale={sale} />
      <table style={{ width: '100%', fontSize: 10.5, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000' }}>
            <th style={{ textAlign: 'left', width: 20, padding: '3px 0' }}>TT</th>
            <th style={{ textAlign: 'left' }}>Sản phẩm</th>
            <th style={{ textAlign: 'right', width: 34 }}>SL</th>
            <th style={{ textAlign: 'center', width: 56 }}>Thời hạn</th>
            <th style={{ textAlign: 'right', width: 70 }}>Hết hạn</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id || i} style={{ borderBottom: '1px solid #ccc', verticalAlign: 'top' }}>
              <td style={{ padding: '3px 0' }}>{i + 1}</td>
              <td>
                <div style={{ fontWeight: 700 }}>{it.name_snapshot}</div>
                {it.serial && <div>Serial: {it.serial}</div>}
                {it.warranty_note && <div style={{ fontStyle: 'italic' }}>Điều kiện: {it.warranty_note}</div>}
              </td>
              <td style={{ textAlign: 'right' }}>{fq(it.qty)}</td>
              <td style={{ textAlign: 'center' }}>{it.warranty_months} tháng</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{it.warranty_until ? date(it.warranty_until) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Footer store={store} />
    </div>
  );

  const separate = (
    <div className="text-black bg-white">
      {items.map((it, i) => (
        <div
          key={it.id || i}
          className="print-a5"
          style={{ breakAfter: i < items.length - 1 ? 'page' : 'auto', pageBreakAfter: i < items.length - 1 ? 'always' : 'auto' }}
        >
          <Header store={store} sale={sale} />
          <div style={{ textAlign: 'center', margin: '10px 0 4px', fontWeight: 800, fontSize: 15, letterSpacing: 1 }}>
            PHIẾU BẢO HÀNH SẢN PHẨM
          </div>
          <Customer sale={sale} />
          <table style={{ width: '100%', fontSize: 12, marginTop: 4 }}>
            <tbody>
              <tr><td style={{ width: 110, padding: '3px 0' }}>Sản phẩm</td><td style={{ fontWeight: 800 }}>{it.name_snapshot}</td></tr>
              <tr><td style={{ padding: '3px 0' }}>Số lượng</td><td>{fq(it.qty)} {it.unit_name}</td></tr>
              <tr><td style={{ padding: '3px 0' }}>Số serial</td><td style={{ fontFamily: 'monospace' }}>{it.serial || '................................'}</td></tr>
              <tr><td style={{ padding: '3px 0' }}>Thời hạn bảo hành</td><td style={{ fontWeight: 700 }}>{it.warranty_months} tháng</td></tr>
              <tr><td style={{ padding: '3px 0' }}>Bảo hành đến ngày</td><td style={{ fontWeight: 800 }}>{it.warranty_until ? date(it.warranty_until) : '—'}</td></tr>
              {it.warranty_note && (
                <tr><td style={{ padding: '3px 0', verticalAlign: 'top' }}>Điều kiện</td><td>{it.warranty_note}</td></tr>
              )}
            </tbody>
          </table>
          <Footer store={store} />
        </div>
      ))}
    </div>
  );

  const body = mode === 'separate' ? separate : combined;

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title="In phiếu bảo hành"
        subtitle={`Hoá đơn ${sale.code} · ${items.length} món có bảo hành`}
        size="lg"
        footer={<>
          <div className="flex gap-1 mr-auto" role="radiogroup" aria-label="Kiểu phiếu bảo hành">
            {WARRANTY_CARD_MODES.map((m) => (
              <button key={m.key} type="button" role="radio" aria-checked={mode === m.key}
                onClick={() => setMode(m.key)} title={m.hint}
                className={`btn btn-sm ${mode === m.key ? 'btn-primary' : 'btn-outline'}`}>
                {m.label}
              </button>
            ))}
          </div>
          <Button onClick={onClose}>Bỏ qua</Button>
          <Button variant="primary" icon={Printer} onClick={() => window.print()}>In phiếu bảo hành</Button>
        </>}
      >
        <div className="flex items-center gap-2 text-[13px] text-muted-ink mb-2">
          <ShieldCheck size={15} aria-hidden="true" />
          {mode === 'separate' ? `In ${items.length} phiếu, mỗi món một tờ.` : 'In một tờ gộp mọi món có bảo hành.'}
        </div>
        <div className="border border-line rounded-lg bg-slate-100 p-4 overflow-auto max-h-[55vh]">
          <div className="bg-white mx-auto shadow-sm" style={{ width: 'fit-content' }}>{body}</div>
        </div>
      </Modal>
      <div className="print-area size-a5">{body}</div>
    </>
  );
}
