import { useState, useEffect, useMemo } from 'react';
import { Printer, X, Check } from 'lucide-react';
import { money, n, qty as fq, datetime, date, readMoney, PAYMENT_LABEL } from '../lib/format';
import { Button, Modal } from './ui';

/**
 * In hoá đơn 3 khổ giấy:
 *   K80 — máy in nhiệt 80mm ở quầy (phiếu tính tiền)
 *   A5  — nửa tờ A4, phiếu giao hàng
 *   A4  — hoá đơn GTGT / bán hàng đầy đủ
 * Chỉ vùng .print-area được in, phần còn lại bị ẩn bằng CSS @media print.
 */

const FORMATS = [
  { key: 'k80', label: 'K80 (máy in nhiệt)', hint: 'Phiếu tính tiền tại quầy' },
  { key: 'a5', label: 'A5', hint: 'Phiếu giao hàng' },
  { key: 'a4', label: 'A4', hint: 'Hoá đơn đầy đủ / GTGT' },
];

/** Mã QR chuyển khoản theo chuẩn VietQR, dựng bằng URL ảnh nên không cần thư viện. */
function bankQr(store, amount, content) {
  if (!store?.bank_account) return null;
  const BANKS = {
    'MB Bank': 'MB', 'Vietcombank': 'VCB', 'Techcombank': 'TCB', 'BIDV': 'BIDV',
    'VietinBank': 'ICB', 'Agribank': 'VBA', 'ACB': 'ACB', 'VPBank': 'VPB',
    'Sacombank': 'STB', 'TPBank': 'TPB', 'MSB': 'MSB', 'OCB': 'OCB', 'SHB': 'SHB',
  };
  const name = store.bank_name || '';
  const code = Object.entries(BANKS).find(([k]) => name.includes(k))?.[1];
  if (!code) return null;
  const params = new URLSearchParams({
    amount: String(Math.round(amount || 0)),
    addInfo: content || '',
    accountName: store.bank_owner || store.name || '',
  });
  return `https://img.vietqr.io/image/${code}-${store.bank_account}-compact.png?${params}`;
}

export default function InvoicePrint({ sale, store, invoice = {}, onClose, defaultFormat }) {
  // Khổ giấy mặc định lấy từ Thiết lập, cho phép ghi đè khi gọi
  const [format, setFormat] = useState(defaultFormat || invoice.default_format || 'k80');
  // Bề rộng vùng in K80 tính bằng mm — chỉnh được khi máy in lệch mép
  const k80Width = Number(invoice.k80_width) || 72;
  const [showCost, setShowCost] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); window.print(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const qrUrl = useMemo(() => {
    if (!sale) return null;
    const due = sale.total - sale.paid > 0 ? sale.total - sale.paid : sale.total;
    return bankQr(store, due, sale.code);
  }, [store, sale]);

  if (!sale) return null;

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={`Hoá đơn ${sale.code}`}
        subtitle={`${datetime(sale.ts)} · ${money(sale.total)}`}
        size="lg"
        footer={<>
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" icon={Printer} onClick={() => window.print()}>
            In hoá đơn
          </Button>
        </>}
      >
        <div className="space-y-3">
          <div>
            <span className="label">Chọn khổ giấy</span>
            <div className="grid grid-cols-3 gap-2">
              {FORMATS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFormat(f.key)}
                  className={`card p-2.5 text-left transition-colors duration-150 cursor-pointer
                              ${format === f.key
                                ? 'border-accent bg-accent-soft/50 ring-1 ring-accent'
                                : 'hover:border-accent hover:bg-muted/50'}`}
                >
                  <div className="flex items-center gap-1.5">
                    {format === f.key && <Check size={13} className="text-accent shrink-0" aria-hidden="true" />}
                    <span className="text-[13px] font-semibold">{f.label}</span>
                  </div>
                  <div className="text-2xs text-muted-ink mt-0.5">{f.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-[13px] cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 accent-emerald-700 cursor-pointer"
              checked={showCost}
              onChange={(e) => setShowCost(e.target.checked)}
            />
            Hiện giá vốn và lãi (chỉ để chủ xem, đừng đưa khách)
          </label>

          {/* Xem trước */}
          <div>
            <span className="label">Xem trước</span>
            <div className="border border-line rounded-lg bg-slate-100 p-4 overflow-auto max-h-[45vh]">
              <div className="bg-white mx-auto shadow-sm" style={{ width: 'fit-content' }}>
                <InvoiceBody sale={sale} store={store} format={format} showCost={showCost} qrUrl={qrUrl} k80Width={k80Width} />
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* Vùng in thật — ẩn trên màn hình, chỉ hiện khi in */}
      <div className={`print-area size-${format}`}>
        <InvoiceBody sale={sale} store={store} format={format} showCost={showCost} qrUrl={qrUrl} k80Width={k80Width} />
      </div>
    </>
  );
}

/* ==================================================================== */

function InvoiceBody({ sale, store, format, showCost, qrUrl, k80Width }) {
  if (format === 'k80') return <K80 sale={sale} store={store} showCost={showCost} qrUrl={qrUrl} width={k80Width} />;
  if (format === 'a5') return <Sheet sale={sale} store={store} showCost={showCost} qrUrl={qrUrl} size="a5" />;
  return <Sheet sale={sale} store={store} showCost={showCost} qrUrl={qrUrl} size="a4" />;
}

/* ------------------------- Khổ K80 (máy in nhiệt) ------------------- */

function K80({ sale, store, showCost, qrUrl, width = 72 }) {
  const remaining = sale.total - sale.paid;
  return (
    <div className="print-k80 mx-auto text-black" style={{ width: `${width}mm` }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.2 }}>{store.name}</div>
        {store.address && <div style={{ fontSize: 10 }}>{store.address}</div>}
        {store.phone && <div style={{ fontSize: 10 }}>ĐT: {store.phone}</div>}
        {store.tax_code && <div style={{ fontSize: 10 }}>MST: {store.tax_code}</div>}
      </div>

      <div className="dashed" />
      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 12, letterSpacing: 1 }}>
        {sale.provisional ? 'PHIẾU TẠM TÍNH'
          : sale.is_vat_invoice ? 'HOÁ ĐƠN GTGT' : 'PHIẾU TÍNH TIỀN'}
      </div>
      <div style={{ textAlign: 'center', fontSize: 10 }}>Số: {sale.code}</div>
      <div className="dashed" />

      <table style={{ fontSize: 10 }}>
        <tbody>
          <tr><td>Ngày:</td><td style={{ textAlign: 'right' }}>{datetime(sale.ts)}</td></tr>
          <tr><td>Khách:</td><td style={{ textAlign: 'right' }}>{sale.customer_name || 'Khách lẻ'}</td></tr>
          {sale.customer_phone && (
            <tr><td>ĐT:</td><td style={{ textAlign: 'right' }}>{sale.customer_phone}</td></tr>
          )}
          <tr><td>Thu ngân:</td><td style={{ textAlign: 'right' }}>{sale.user_name || '—'}</td></tr>
        </tbody>
      </table>

      <div className="dashed" />

      <table style={{ fontSize: 10 }}>
        <tbody>
          {sale.items.map((it, i) => (
            <tr key={it.id ?? i}>
              <td colSpan={2} style={{ paddingBottom: 3 }}>
                <div style={{ fontWeight: 600 }}>{i + 1}. {it.name_snapshot}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{fq(it.qty)} {it.unit_name} x {n(it.price)}</span>
                  <span style={{ fontWeight: 700 }}>{n(it.amount)}</span>
                </div>
                {it.discount > 0 && (
                  <div style={{ fontSize: 9, fontStyle: 'italic' }}>Giảm: -{n(it.discount)}</div>
                )}
                {it.note && (
                  <div style={{ fontSize: 9, fontStyle: 'italic' }}>({it.note})</div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="dashed" />

      <table style={{ fontSize: 11 }}>
        <tbody>
          <tr><td>Tổng tiền hàng:</td><td style={{ textAlign: 'right' }}>{n(sale.subtotal)}</td></tr>
          {sale.discount > 0 && (
            <tr><td>Giảm giá:</td><td style={{ textAlign: 'right' }}>-{n(sale.discount)}</td></tr>
          )}
          {sale.vat_amount > 0 && (
            <tr><td>Thuế GTGT:</td><td style={{ textAlign: 'right' }}>{n(sale.vat_amount)}</td></tr>
          )}
          <tr style={{ fontWeight: 700, fontSize: 13 }}>
            <td style={{ paddingTop: 3 }}>THÀNH TIỀN:</td>
            <td style={{ textAlign: 'right', paddingTop: 3 }}>{n(sale.total)}</td>
          </tr>
          <tr><td>Đã thanh toán ({PAYMENT_LABEL[sale.payment_method] || ''}):</td>
            <td style={{ textAlign: 'right' }}>{n(sale.paid)}</td></tr>
          {sale.change_given > 0 && (
            <tr><td>Tiền thối:</td><td style={{ textAlign: 'right' }}>{n(sale.change_given)}</td></tr>
          )}
          {remaining > 0 && (
            <tr style={{ fontWeight: 700 }}>
              <td>CÒN NỢ:</td><td style={{ textAlign: 'right' }}>{n(remaining)}</td>
            </tr>
          )}
          {showCost && (
            <tr style={{ fontSize: 9, fontStyle: 'italic' }}>
              <td>[Vốn {n(sale.cogs)} — Lãi {n(sale.total - sale.vat_amount - sale.cogs)}]</td><td />
            </tr>
          )}
        </tbody>
      </table>

      {sale.delivery_address && (
        <>
          <div className="dashed" />
          <div style={{ fontSize: 10 }}>
            <b>GIAO HÀNG</b><br />
            {sale.delivery_name} {sale.delivery_phone ? `- ${sale.delivery_phone}` : ''}<br />
            {sale.delivery_address}
            {sale.tracking_code && <><br />Vận đơn: {sale.tracking_code}</>}
            {sale.cod_amount > 0 && <><br />Thu hộ: {n(sale.cod_amount)}</>}
          </div>
        </>
      )}

      {sale.note && (
        <>
          <div className="dashed" />
          <div style={{ fontSize: 10 }}>Ghi chú: {sale.note}</div>
        </>
      )}

      {qrUrl && remaining > 0 && (
        <>
          <div className="dashed" />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, fontWeight: 700 }}>QUÉT MÃ ĐỂ CHUYỂN KHOẢN</div>
            <img src={qrUrl} alt="Mã QR chuyển khoản" style={{ width: '38mm', margin: '2px auto' }} />
            <div style={{ fontSize: 9 }}>{store.bank_name}</div>
            <div style={{ fontSize: 9 }}>{store.bank_account} — {store.bank_owner}</div>
          </div>
        </>
      )}

      <div className="dashed" />
      {sale.provisional && (
        <div style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, padding: '3px 0' }}>
          *** PHIẾU TẠM TÍNH — CHƯA THANH TOÁN ***
        </div>
      )}
      <div style={{ textAlign: 'center', fontSize: 9, lineHeight: 1.4 }}>
        {store.footer_note || 'Cảm ơn Quý khách!'}
        {store.warranty_note && <div>{store.warranty_note}</div>}
      </div>
      <div style={{ height: '8mm' }} />
    </div>
  );
}

/* ------------------------- Khổ A5 / A4 ------------------------------ */

function Sheet({ sale, store, showCost, qrUrl, size }) {
  const remaining = sale.total - sale.paid;
  const isA4 = size === 'a4';
  const title = sale.provisional ? 'PHIẾU TẠM TÍNH'
    : sale.is_vat_invoice ? 'HOÁ ĐƠN GIÁ TRỊ GIA TĂNG' : 'HOÁ ĐƠN BÁN HÀNG';

  return (
    <div className={`print-${size} text-black bg-white`}>
      {/* Đầu trang */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: isA4 ? 17 : 14, lineHeight: 1.2 }}>{store.name}</div>
          {store.slogan && <div style={{ fontSize: isA4 ? 11 : 10, fontStyle: 'italic' }}>{store.slogan}</div>}
          <div style={{ fontSize: isA4 ? 11 : 10, marginTop: 3, lineHeight: 1.5 }}>
            {store.address && <div>Địa chỉ: {store.address}</div>}
            {store.phone && <div>Điện thoại: {store.phone}</div>}
            {store.tax_code && <div>Mã số thuế: {store.tax_code}</div>}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: isA4 ? 11 : 10 }}>
          <div>Số hoá đơn: <b>{sale.code}</b></div>
          <div>Ngày {date(sale.ts)}</div>
        </div>
      </div>

      <div style={{ textAlign: 'center', margin: isA4 ? '18px 0 4px' : '12px 0 3px' }}>
        <div style={{ fontWeight: 800, fontSize: isA4 ? 19 : 15, letterSpacing: 1 }}>{title}</div>
        <div style={{ fontSize: isA4 ? 11 : 10 }}>
          {sale.provisional ? 'Phiếu báo giá tạm tính — chưa thanh toán' : 'Liên 2: Giao khách hàng'}
        </div>
      </div>

      {/* Thông tin khách */}
      <table style={{ fontSize: isA4 ? 12 : 11, marginTop: isA4 ? 12 : 8, width: '100%' }}>
        <tbody>
          <tr>
            <td style={{ width: '18%', paddingBottom: 3 }}>Khách hàng:</td>
            <td style={{ paddingBottom: 3, fontWeight: 600 }}>
              {sale.customer_company || sale.customer_name || 'Khách lẻ'}
            </td>
          </tr>
          {sale.customer_tax_code && (
            <tr><td style={{ paddingBottom: 3 }}>Mã số thuế:</td><td>{sale.customer_tax_code}</td></tr>
          )}
          <tr>
            <td style={{ paddingBottom: 3 }}>Địa chỉ:</td>
            <td>{sale.customer_address || '..............................................................'}</td>
          </tr>
          <tr>
            <td style={{ paddingBottom: 3 }}>Điện thoại:</td>
            <td>{sale.customer_phone || '..........................'}</td>
          </tr>
          <tr>
            <td>Hình thức TT:</td>
            <td>{PAYMENT_LABEL[sale.payment_method] || sale.payment_method}</td>
          </tr>
        </tbody>
      </table>

      {/* Bảng hàng hoá */}
      <table className="lines" style={{ marginTop: isA4 ? 12 : 8, fontSize: isA4 ? 12 : 10 }}>
        <thead>
          <tr>
            <th style={{ width: '5%' }}>STT</th>
            <th>Tên hàng hoá, dịch vụ</th>
            <th style={{ width: '9%' }}>ĐVT</th>
            <th style={{ width: '10%' }}>SL</th>
            <th style={{ width: '15%' }}>Đơn giá</th>
            <th style={{ width: '17%' }}>Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((it, i) => (
            <tr key={it.id ?? i}>
              <td style={{ textAlign: 'center' }}>{i + 1}</td>
              <td>
                {it.name_snapshot}
                {it.sku && <span style={{ fontSize: 9, color: '#555' }}> ({it.sku})</span>}
                {it.note && (
                  <div style={{ fontSize: 9, fontStyle: 'italic', color: '#333' }}>{it.note}</div>
                )}
              </td>
              <td style={{ textAlign: 'center' }}>{it.unit_name}</td>
              <td style={{ textAlign: 'right' }}>{fq(it.qty)}</td>
              <td style={{ textAlign: 'right' }}>{n(it.price)}</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{n(it.amount)}</td>
            </tr>
          ))}
          {/* Dòng trống cho đủ khung khi in giấy */}
          {isA4 && sale.items.length < 10 &&
            Array.from({ length: 10 - sale.items.length }).map((_, i) => (
              <tr key={'blank' + i}><td>&nbsp;</td><td /><td /><td /><td /><td /></tr>
            ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5} style={{ textAlign: 'right', fontWeight: 600 }}>Cộng tiền hàng</td>
            <td style={{ textAlign: 'right', fontWeight: 600 }}>{n(sale.subtotal)}</td>
          </tr>
          {sale.discount > 0 && (
            <tr>
              <td colSpan={5} style={{ textAlign: 'right' }}>Giảm giá</td>
              <td style={{ textAlign: 'right' }}>-{n(sale.discount)}</td>
            </tr>
          )}
          {sale.vat_amount > 0 && (
            <tr>
              <td colSpan={5} style={{ textAlign: 'right' }}>Thuế GTGT</td>
              <td style={{ textAlign: 'right' }}>{n(sale.vat_amount)}</td>
            </tr>
          )}
          <tr>
            <td colSpan={5} style={{ textAlign: 'right', fontWeight: 800, fontSize: isA4 ? 13 : 11 }}>
              TỔNG THANH TOÁN
            </td>
            <td style={{ textAlign: 'right', fontWeight: 800, fontSize: isA4 ? 13 : 11 }}>
              {n(sale.total)}
            </td>
          </tr>
          <tr>
            <td colSpan={5} style={{ textAlign: 'right' }}>Đã thanh toán</td>
            <td style={{ textAlign: 'right' }}>{n(sale.paid)}</td>
          </tr>
          {remaining > 0 && (
            <tr>
              <td colSpan={5} style={{ textAlign: 'right', fontWeight: 700 }}>Còn nợ lại</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{n(remaining)}</td>
            </tr>
          )}
        </tfoot>
      </table>

      <div style={{ fontSize: isA4 ? 12 : 10, marginTop: 6, fontStyle: 'italic' }}>
        Số tiền bằng chữ: <b>{readMoney(sale.total)}</b>
      </div>

      {showCost && (
        <div style={{ fontSize: 10, marginTop: 4, color: '#666' }}>
          [Nội bộ] Giá vốn: {n(sale.cogs)} — Lợi nhuận: {n(sale.total - sale.vat_amount - sale.cogs)}
        </div>
      )}

      {sale.delivery_address && (
        <div style={{ fontSize: isA4 ? 12 : 10, marginTop: 6, border: '1px solid #000', padding: '4px 6px' }}>
          <b>GIAO HÀNG:</b> {sale.delivery_name}
          {sale.delivery_phone ? ` — ${sale.delivery_phone}` : ''}
          <br />
          Địa chỉ: {sale.delivery_address}
          {sale.tracking_code && <><br />Mã vận đơn: <b>{sale.tracking_code}</b></>}
          {sale.cod_amount > 0 && <><br />Thu hộ (COD): <b>{n(sale.cod_amount)}</b></>}
        </div>
      )}

      {sale.note && (
        <div style={{ fontSize: isA4 ? 12 : 10, marginTop: 6 }}>
          <b>Ghi chú:</b> {sale.note}
        </div>
      )}

      {/* Chữ ký + QR */}
      {sale.provisional && (
        <div style={{ textAlign: 'center', fontSize: isA4 ? 12 : 10, fontWeight: 700,
          marginTop: 10, padding: '4px 0', border: '1px dashed #000' }}>
          PHIẾU TẠM TÍNH — CHƯA THANH TOÁN, KHÔNG CÓ GIÁ TRỊ THAY HOÁ ĐƠN
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: isA4 ? 26 : 16, gap: 12 }}>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: isA4 ? 12 : 10 }}>NGƯỜI MUA HÀNG</div>
          <div style={{ fontSize: 9, fontStyle: 'italic' }}>(Ký, ghi rõ họ tên)</div>
          <div style={{ height: isA4 ? 52 : 34 }} />
        </div>

        {qrUrl && (
          <div style={{ textAlign: 'center', width: isA4 ? 110 : 82 }}>
            <img src={qrUrl} alt="Mã QR chuyển khoản" style={{ width: '100%' }} />
            <div style={{ fontSize: 8, lineHeight: 1.3 }}>
              {store.bank_name}<br />{store.bank_account}
            </div>
          </div>
        )}

        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: isA4 ? 12 : 10 }}>NGƯỜI BÁN HÀNG</div>
          <div style={{ fontSize: 9, fontStyle: 'italic' }}>(Ký, ghi rõ họ tên)</div>
          <div style={{ height: isA4 ? 34 : 20 }} />
          <div style={{ fontSize: isA4 ? 11 : 9 }}>{sale.user_name}</div>
        </div>
      </div>

      <div style={{ textAlign: 'center', fontSize: 9, marginTop: 10, fontStyle: 'italic' }}>
        {store.footer_note}
      </div>
    </div>
  );
}
