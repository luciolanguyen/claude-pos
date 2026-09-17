/* ====================================================================
   IN BIÊN NHẬN VÀ TEM DÁN MÁY BẢO HÀNH / SỬA CHỮA (plan 31, 3a–3d)

   Hai thứ in lúc tiếp nhận, in lại được bất cứ lúc nào:
     - Biên nhận: tờ khách giữ để lấy lại hàng. Phiếu gom nhiều món thì một
       tờ liệt kê đủ các món. Khổ A5 hoặc giấy nhiệt K80.
     - Tem dán máy: dán lên thân máy khách, trên tem có mã vạch số phiếu để
       thợ quét là mở ra đúng món, kèm tên + số điện thoại khách để khỏi lẫn
       máy. In bằng máy in tem khổ nhỏ hoặc giấy K80 rồi cắt dán.

   Khổ giấy và khổ tem nhớ theo từng máy (localStorage) vì mỗi máy tính ở
   tiệm cắm một loại máy in khác nhau.
   ==================================================================== */
import { useState, useEffect, useMemo } from 'react';
import { Printer, Tag, FileText, Minus, Plus } from 'lucide-react';
import { useApp, useLocal } from '../lib/store';
import { qty as fq, date } from '../lib/format';
import { barcodeSvg, fitModuleWidth, LABEL_SIZES, getLabelSize } from '../lib/barcode';
import { Button, Modal, Select, IconButton, Field } from './ui';

const TYPE_LABEL = { warranty: 'Bảo hành', repair: 'Sửa chữa' };

/**
 * Mã vạch trên tem chỉ mang phần số của số phiếu: "BH260917-0001" lẫn chữ và
 * gạch cần ~38 mm mới đủ nét cho máy in nhiệt 203 dpi, tem 35×22 mm in ra
 * không quét nổi; "2609170001" toàn số chỉ cần ~21 mm. Ô tìm trang bảo hành
 * nhận chuỗi số này và đổi lại đúng số phiếu.
 */
export const tagScanCode = (code) => {
  const m = String(code || '').match(/^BH(\d{6})-(\d{4})$/);
  return m ? `${m[1]}${m[2]}` : code;
};

/** Mã vạch Code 128 vừa khít bề ngang cho trước (mm). */
function Barcode({ code, widthMm, heightPx = 30, fontSize = 9, maxModule = 0.4, showText = true }) {
  const fit = fitModuleWidth(code, widthMm, maxModule);
  const modPx = fit ? (fit.mm / 25.4) * 96 : 1.1;
  const svg = barcodeSvg(code, { width: modPx, height: heightPx, showText, fontSize });
  return <div style={{ lineHeight: 0, display: 'flex', justifyContent: 'center' }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

const typeText = (t) => (t.ticket_type === 'repair'
  ? 'Sửa chữa dịch vụ — có tính phí'
  : t.in_warranty === 1
    ? `Bảo hành — còn hạn${t.warranty_until ? ` tới ${date(t.warranty_until)}` : ''}`
    : 'Bảo hành');

/* ------------------------------------------------------------------ */
/* Biên nhận                                                           */
/* ------------------------------------------------------------------ */

function ReceiptA5({ head, tickets, store, keepDays }) {
  const allRepair = tickets.every((t) => t.ticket_type === 'repair');
  const allWarranty = tickets.every((t) => t.ticket_type !== 'repair');
  const title = allRepair ? 'BIÊN NHẬN HÀNG SỬA CHỮA'
    : allWarranty ? 'BIÊN NHẬN HÀNG BẢO HÀNH' : 'BIÊN NHẬN HÀNG BẢO HÀNH – SỬA CHỮA';
  const one = tickets.length === 1 ? tickets[0] : null;
  const promised = [...new Set(tickets.map((t) => t.promised_at).filter(Boolean))];
  const td = { paddingBottom: 3, verticalAlign: 'top' };

  return (
    <div className="print-a5 text-black bg-white">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{store.name}</div>
          {store.address && <div style={{ fontSize: 10 }}>{store.address}</div>}
          {store.phone && <div style={{ fontSize: 10 }}>ĐT: {store.phone}</div>}
        </div>
        <div style={{ textAlign: 'right', fontSize: 10 }}>
          <Barcode code={head.code} widthMm={45} heightPx={26} fontSize={8} />
          <div>Ngày {date(head.ts)}</div>
        </div>
      </div>

      <div style={{ textAlign: 'center', margin: '10px 0 3px' }}>
        <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: 1 }}>{title}</div>
        <div style={{ fontSize: 10, fontStyle: 'italic' }}>Quý khách vui lòng giữ phiếu này để nhận lại hàng</div>
      </div>

      <table style={{ fontSize: 11, width: '100%', marginTop: 8 }}>
        <tbody>
          <tr><td style={{ ...td, width: '28%' }}>Khách hàng:</td><td style={{ fontWeight: 600 }}>{head.customer_display || '—'}</td></tr>
          <tr><td style={td}>Điện thoại:</td><td>{head.phone_display || '—'}</td></tr>
          {one && <>
            <tr><td style={td}>Tên hàng:</td><td style={{ fontWeight: 600 }}>{one.product_name}</td></tr>
            {one.serial && <tr><td style={td}>Số serial:</td><td>{one.serial}</td></tr>}
            {one.component_name && <tr><td style={td}>Bộ phận báo hư:</td><td>{one.component_name}</td></tr>}
            <tr><td style={td}>Số lượng:</td><td>{fq(one.qty)}</td></tr>
            <tr><td style={td}>Lỗi khách báo:</td><td>{one.issue || '—'}</td></tr>
            <tr><td style={td}>Tình trạng khi nhận:</td><td>{one.condition_note || '—'}</td></tr>
            <tr><td style={td}>Phụ kiện kèm theo:</td><td>{one.accessories || 'Không'}</td></tr>
            <tr><td style={td}>Loại phiếu:</td><td>{typeText(one)}</td></tr>
          </>}
          {head.technician_name && <tr><td style={td}>Kỹ thuật viên:</td><td>{head.technician_name}</td></tr>}
          {one && (
            <tr><td>Hẹn trả khách:</td>
              <td style={{ fontWeight: 700 }}>{one.promised_at ? date(one.promised_at) : 'Sẽ báo sau'}</td></tr>
          )}
          {!one && (
            <tr><td>Hẹn trả khách:</td>
              <td style={{ fontWeight: 700 }}>{promised.length === 1 ? date(promised[0]) : promised.length ? 'Theo từng món bên dưới' : 'Sẽ báo sau'}</td></tr>
          )}
        </tbody>
      </table>

      {!one && (
        <table className="lines" style={{ fontSize: 10, marginTop: 8 }}>
          <thead>
            <tr>
              <th style={{ width: 18 }}>TT</th>
              <th>Hàng khách gửi</th>
              <th>Lỗi · tình trạng · phụ kiện</th>
              <th style={{ width: 70 }}>Loại · hẹn</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t, i) => (
              <tr key={t.id} style={{ verticalAlign: 'top' }}>
                <td style={{ textAlign: 'center' }}>{i + 1}</td>
                <td>
                  <div style={{ fontWeight: 700 }}>{t.product_name}{Number(t.qty) !== 1 ? ` × ${fq(t.qty)}` : ''}</div>
                  <div style={{ fontFamily: 'monospace' }}>{t.code}</div>
                  {t.serial && <div>SN: {t.serial}</div>}
                  {t.component_name && <div>Bộ phận: {t.component_name}</div>}
                </td>
                <td>
                  <div>{t.issue || '—'}</div>
                  {t.condition_note && <div style={{ fontStyle: 'italic' }}>{t.condition_note}</div>}
                  <div>Phụ kiện: {t.accessories || 'Không'}</div>
                </td>
                <td>
                  <div>{t.ticket_type === 'repair' ? 'Sửa chữa' : t.in_warranty === 1 ? 'BH còn hạn' : 'Bảo hành'}</div>
                  {t.promised_at && promised.length > 1 && <div style={{ fontWeight: 700 }}>{date(t.promised_at)}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ fontSize: 10, marginTop: 10, border: '1px solid #000', padding: '5px 7px', lineHeight: 1.5 }}>
        <b>Lưu ý</b>
        <div>1. Quý khách vui lòng mang theo phiếu này khi tới nhận hàng.</div>
        <div>2. Cửa hàng chỉ nhận đúng phụ kiện đã ghi ở trên.</div>
        <div>3. {allRepair ? 'Cửa hàng báo giá linh kiện, tiền công trước khi sửa.' : 'Hàng hết hạn hoặc không đủ điều kiện bảo hành sẽ báo giá trước khi sửa.'}</div>
        {!one && <div>4. Món nào sửa xong trước thì cửa hàng báo quý khách tới lấy trước.</div>}
        <div>{one ? 4 : 5}. Quá {keepDays} ngày kể từ ngày hẹn mà không tới nhận, cửa hàng không giữ hàng nữa.</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 11 }}>KHÁCH HÀNG</div>
          <div style={{ fontSize: 9, fontStyle: 'italic' }}>(Ký, ghi rõ họ tên)</div>
          <div style={{ height: 40 }} />
        </div>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 11 }}>NGƯỜI NHẬN HÀNG</div>
          <div style={{ fontSize: 9, fontStyle: 'italic' }}>(Ký, ghi rõ họ tên)</div>
          <div style={{ height: 26 }} />
          <div style={{ fontSize: 10 }}>{head.received_by_name}</div>
        </div>
      </div>
    </div>
  );
}

function ReceiptK80({ head, tickets, store, keepDays, widthMm }) {
  return (
    <div className="print-k80 text-black bg-white" style={{ width: `${widthMm}mm`, padding: '3mm 2mm' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{store.name}</div>
        {store.address && <div>{store.address}</div>}
        {store.phone && <div>ĐT: {store.phone}</div>}
      </div>
      <div className="dashed" />
      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, letterSpacing: 0.5 }}>
        BIÊN NHẬN {tickets.every((t) => t.ticket_type === 'repair') ? 'SỬA CHỮA' : 'BẢO HÀNH'}
      </div>
      <Barcode code={head.code} widthMm={widthMm - 10} heightPx={32} />
      <div style={{ textAlign: 'center' }}>Ngày nhận {date(head.ts)}</div>
      <div className="dashed" />
      <div>Khách: <b>{head.customer_display || '—'}</b></div>
      {head.phone_display && <div>ĐT: <b>{head.phone_display}</b></div>}
      {head.technician_name && <div>KTV: {head.technician_name}</div>}
      <div className="dashed" />
      {tickets.map((t, i) => (
        <div key={t.id} style={{ marginBottom: 5 }}>
          <div style={{ fontWeight: 700 }}>
            {tickets.length > 1 ? `${i + 1}. ` : ''}{t.product_name}{Number(t.qty) !== 1 ? ` × ${fq(t.qty)}` : ''}
          </div>
          {tickets.length > 1 && <div style={{ fontSize: 10 }}>Mã: {t.code}</div>}
          {t.serial && <div>SN: {t.serial}</div>}
          {t.component_name && <div>Bộ phận: {t.component_name}</div>}
          <div>Lỗi: {t.issue || '—'}</div>
          {t.condition_note && <div>Tình trạng: {t.condition_note}</div>}
          <div>Phụ kiện: {t.accessories || 'Không'}</div>
          <div>{typeText(t)}</div>
          <div>Hẹn trả: <b>{t.promised_at ? date(t.promised_at) : 'Sẽ báo sau'}</b></div>
        </div>
      ))}
      <div className="dashed" />
      <div style={{ fontSize: 9, lineHeight: 1.45 }}>
        Mang theo phiếu này khi tới nhận hàng. Cửa hàng chỉ nhận đúng phụ kiện đã ghi.
        Quá {keepDays} ngày kể từ ngày hẹn mà không tới nhận, cửa hàng không giữ hàng nữa.
      </div>
      <div style={{ marginTop: 6, fontSize: 10 }}>Người nhận: {head.received_by_name || '—'}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tem dán máy                                                         */
/* ------------------------------------------------------------------ */

function TagLabel({ t, head, size, store, forPrint, pos }) {
  const small = size.h < 30;
  const big = size.h >= 40;
  const line = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' };
  return (
    <div
      className="label-box"
      style={{
        width: `${size.w}mm`, height: `${size.h}mm`, padding: '0.8mm 1.5mm',
        border: forPrint ? 'none' : '1px dashed #cbd5e1', background: '#fff', color: '#000',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden',
        boxSizing: 'border-box', breakInside: 'avoid', fontSize: small ? '5.5pt' : '6.5pt', lineHeight: 1.15,
      }}
    >
      {!small && store?.name && <div style={{ ...line, fontWeight: 700, fontSize: '5.5pt', textAlign: 'center' }}>{store.name}</div>}
      <Barcode code={tagScanCode(t.code)} widthMm={size.w - 3} heightPx={small ? 16 : big ? 28 : 22}
        maxModule={size.w >= 50 ? 0.4 : 0.34} showText={false} />
      <div style={{ ...line, fontFamily: 'monospace', fontWeight: 700, textAlign: 'center' }}>{t.code}</div>
      <div style={{ ...line, fontWeight: 800 }}>
        {head.customer_display || 'Khách lẻ'}{head.phone_display ? ` · ${head.phone_display}` : ''}
      </div>
      <div style={{ ...line, fontWeight: 600 }}>{t.product_name}{t.serial && !small ? ` · SN ${t.serial}` : ''}</div>
      {!small && (
        <div style={line}>
          {TYPE_LABEL[t.ticket_type] || 'Bảo hành'} · nhận {date(head.ts).slice(0, 5)}
          {t.promised_at ? ` · hẹn ${date(t.promised_at).slice(0, 5)}` : ''}{pos ? ` · ${pos}` : ''}
        </div>
      )}
      {big && t.issue && <div style={line}>Lỗi: {t.issue}</div>}
      {big && t.component_name && <div style={line}>Bộ phận: {t.component_name}</div>}
    </div>
  );
}

function TagK80({ t, head, store, widthMm, pos, last }) {
  return (
    <div className="print-k80 text-black bg-white"
      style={{ width: `${widthMm}mm`, padding: '2mm', borderBottom: last ? 'none' : '1px dashed #000' }}>
      <div style={{ textAlign: 'center', fontWeight: 700 }}>{store.name}</div>
      <Barcode code={tagScanCode(t.code)} widthMm={widthMm - 10} heightPx={34} showText={false} />
      <div style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: 700 }}>{t.code}</div>
      <div style={{ fontWeight: 800, fontSize: 13 }}>{head.customer_display || 'Khách lẻ'}</div>
      {head.phone_display && <div style={{ fontWeight: 700, fontSize: 13 }}>{head.phone_display}</div>}
      <div style={{ fontWeight: 700 }}>{t.product_name}</div>
      {t.serial && <div>SN: {t.serial}</div>}
      {t.component_name && <div>Bộ phận: {t.component_name}</div>}
      <div>Lỗi: {t.issue || '—'}</div>
      <div>
        {TYPE_LABEL[t.ticket_type] || 'Bảo hành'} · nhận {date(head.ts)}
        {t.promised_at ? ` · hẹn ${date(t.promised_at)}` : ''}
      </div>
      {pos && <div>Phiếu {head.batch_code} · món {pos}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * @param tickets   các món cần in (chi tiết đầy đủ từ máy chủ)
 * @param batch     đầu phiếu gom nếu các món cùng một lần tiếp nhận
 * @param focusId   in lại tem từ một món: chỉ đề sẵn tem cho món đó
 * @param mode      'receipt' | 'tag'
 */
export default function WarrantyPrint({ tickets, batch = null, focusId = null, mode: initialMode = 'receipt', onClose }) {
  const { store, settings } = useApp();
  const keepDays = Number(settings?.warranty?.keep_days) || 30;
  const k80Width = Number(settings?.invoice?.k80_width) || 72;
  const [mode, setMode] = useState(initialMode);
  const [receiptFormat, setReceiptFormat] = useLocal('thpos.warranty.receiptFormat', 'a5');
  const [tagFormat, setTagFormat] = useLocal('thpos.warranty.tagFormat', 'label');
  const [tagSize, setTagSize] = useLocal('thpos.warranty.tagSize', '50x30');
  const [copies, setCopies] = useState({});

  useEffect(() => {
    setCopies(Object.fromEntries(tickets.map((t) => [t.id, focusId && focusId !== t.id ? 0 : 1])));
  }, [tickets, focusId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); window.print(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const first = tickets[0];
  const head = {
    code: batch?.code || first?.code,
    batch_code: batch?.code || null,
    ts: batch?.ts || first?.ts,
    customer_display: batch?.customer_display || first?.customer_display,
    phone_display: batch?.phone_display || first?.phone_display,
    received_by_name: batch?.received_by_name || first?.received_by_name,
    technician_name: [...new Set(tickets.map((t) => t.technician_name).filter(Boolean))].join(', ') || null,
  };
  const size = getLabelSize(tagSize);

  /* Dàn tem thành mảng phẳng theo số bản của từng món */
  const tags = useMemo(() => {
    const out = [];
    tickets.forEach((t, i) => {
      for (let k = 0; k < (Number(copies[t.id]) || 0); k += 1) {
        out.push({ t, pos: tickets.length > 1 ? `${i + 1}/${tickets.length}` : null });
      }
    });
    return out;
  }, [tickets, copies]);

  if (!first) return null;

  const receiptBody = receiptFormat === 'k80'
    ? <ReceiptK80 head={head} tickets={tickets} store={store} keepDays={keepDays} widthMm={k80Width} />
    : <ReceiptA5 head={head} tickets={tickets} store={store} keepDays={keepDays} />;

  const tagBody = (forPrint) => (tagFormat === 'k80'
    ? (
      <div className="text-black bg-white">
        {tags.map((x, i) => (
          <TagK80 key={i} t={x.t} head={head} store={store} widthMm={k80Width} pos={x.pos} last={i === tags.length - 1} />
        ))}
      </div>
    ) : (
      <div className={forPrint ? '' : 'flex flex-wrap gap-1'}>
        {tags.map((x, i) => (
          <TagLabel key={i} t={x.t} head={head} size={size} store={store} forPrint={forPrint} pos={x.pos} />
        ))}
      </div>
    ));

  const printClass = mode === 'receipt'
    ? `print-area size-${receiptFormat}`
    : tagFormat === 'k80' ? 'print-area size-k80' : 'print-area print-labels';

  const Seg = ({ value, onChange, options, label }) => (
    <div className="flex gap-1" role="radiogroup" aria-label={label}>
      {options.map(([k, lb]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)}
          className={`btn btn-sm ${value === k ? 'btn-secondary' : 'btn-outline'}`}>{lb}</button>
      ))}
    </div>
  );

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={mode === 'receipt' ? `Biên nhận ${head.code}` : `Tem dán máy — ${head.code}`}
        subtitle={mode === 'receipt'
          ? (tickets.length > 1 ? `${tickets.length} món trên một tờ · in hai bản: khách giữ một, tiệm giữ một` : 'In hai bản: khách giữ một, tiệm giữ một')
          : `${tags.length} tem · dán lên thân máy, quét mã trên tem là mở đúng phiếu`}
        size="lg"
        footer={<>
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" icon={Printer} onClick={() => window.print()} disabled={mode === 'tag' && !tags.length}>
            {mode === 'receipt' ? 'In biên nhận' : `In ${tags.length} tem`}
          </Button>
        </>}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-line overflow-hidden" role="tablist" aria-label="In gì">
              {[['receipt', 'Biên nhận', FileText], ['tag', 'Tem dán máy', Tag]].map(([k, lb, Icon]) => (
                <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                  className={`px-3 h-8 text-[13px] font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors duration-150
                              ${mode === k ? 'bg-primary text-white' : 'bg-card hover:bg-muted'}`}>
                  <Icon size={14} aria-hidden="true" />{lb}
                </button>
              ))}
            </div>
            {mode === 'receipt' ? (
              <Seg label="Khổ giấy biên nhận" value={receiptFormat} onChange={setReceiptFormat}
                options={[['a5', 'Khổ A5'], ['k80', 'Máy in nhiệt K80']]} />
            ) : (
              <>
                <Seg label="Máy in tem" value={tagFormat} onChange={setTagFormat}
                  options={[['label', 'Máy in tem'], ['k80', 'Giấy K80']]} />
                {tagFormat === 'label' && (
                  <Select size="sm" className="!w-auto" value={tagSize} onChange={(e) => setTagSize(e.target.value)} aria-label="Khổ tem">
                    {LABEL_SIZES.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
                  </Select>
                )}
              </>
            )}
          </div>

          {mode === 'tag' && tickets.length > 0 && (
            <Field label="Số tem mỗi món" hint="Máy lớn, nhiều bộ phận rời thì in thêm tem dán từng bộ phận">
              <ul className="divide-y divide-line border border-line rounded-lg">
                {tickets.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[13px]">
                    <span className="font-mono text-2xs text-muted-ink">{t.code}</span>
                    <span className="flex-1 min-w-0 truncate font-semibold">{t.product_name}</span>
                    <IconButton icon={Minus} size={12} variant="outline" label={`Bớt tem ${t.product_name}`}
                      onClick={() => setCopies((c) => ({ ...c, [t.id]: Math.max(0, (Number(c[t.id]) || 0) - 1) }))} />
                    <span className="w-6 text-center tabular font-bold" aria-live="polite">{copies[t.id] || 0}</span>
                    <IconButton icon={Plus} size={12} variant="outline" label={`Thêm tem ${t.product_name}`}
                      onClick={() => setCopies((c) => ({ ...c, [t.id]: Math.min(20, (Number(c[t.id]) || 0) + 1) }))} />
                  </li>
                ))}
              </ul>
            </Field>
          )}

          <div className="border border-line rounded-lg bg-slate-100 p-4 overflow-auto max-h-[50vh]">
            {mode === 'receipt'
              ? <div className="bg-white mx-auto shadow-sm" style={{ width: 'fit-content' }}>{receiptBody}</div>
              : tags.length
                ? <div className="mx-auto" style={{ width: 'fit-content' }}>{tagBody(false)}</div>
                : <p className="text-[13px] text-muted-ink text-center">Chưa chọn tem nào để in.</p>}
          </div>
        </div>
      </Modal>
      <div className={printClass}>{mode === 'receipt' ? receiptBody : tagBody(true)}</div>
    </>
  );
}
