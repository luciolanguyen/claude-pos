/* ====================================================================
   PHIẾU ĐỐI CHIẾU CÔNG NỢ MUA HỘ (plan 31, hạng mục 4b)

   Hai loại giấy, cùng một khuôn:

   1. Phiếu đối chiếu theo kỳ — đưa chủ hàng xem và ký: nợ đầu kỳ, từng
      món bán giùm trong kỳ, hoa hồng tiệm giữ, chiết khấu, tiền đã trả,
      còn nợ cuối kỳ. Hai bên ký là chốt con số, khỏi cãi nhau về sau.
   2. Phiếu đối soát của MỘT đợt đã chốt — in lại bất cứ lúc nào.

   Khổ A4 mặc định (bảng chi tiết dài), A5 khi chỉ vài món.
   ==================================================================== */
import { useState, useEffect } from 'react';
import { Printer } from 'lucide-react';
import { useApp } from '../lib/store';
import { money, n, qty as fq, date, datetime, readMoney } from '../lib/format';
import { Button, Modal } from './ui';

export default function ConsignStatementPrint({ statement = null, settlement = null, onClose }) {
  const { store, user } = useApp();
  const [format, setFormat] = useState('a4');

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); window.print(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!statement && !settlement) return null;
  const isA4 = format === 'a4';
  const px = (a5, a4) => (isA4 ? a4 : a5);
  const cell = { padding: px('3px 4px', '4px 6px') };
  const right = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' };

  /* ---------------------------- Đầu phiếu ---------------------------- */
  const head = (title, sub, code) => (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ maxWidth: '62%' }}>
          <div style={{ fontWeight: 800, fontSize: px(13, 15) }}>{store?.name || 'CỬA HÀNG'}</div>
          {store?.address && <div style={{ fontSize: px(10, 11) }}>{store.address}</div>}
          {store?.phone && <div style={{ fontSize: px(10, 11) }}>ĐT: {store.phone}</div>}
        </div>
        <div style={{ textAlign: 'right', fontSize: px(10, 11) }}>
          {code && <div>Số: <b>{code}</b></div>}
          <div>Ngày in: {datetime(new Date())}</div>
        </div>
      </div>
      <div style={{ textAlign: 'center', margin: px('12px 0 8px', '18px 0 12px') }}>
        <div style={{ fontWeight: 800, fontSize: px(15, 18), letterSpacing: 1 }}>{title}</div>
        <div style={{ fontSize: px(10.5, 12), fontStyle: 'italic' }}>{sub}</div>
      </div>
    </>
  );

  const partnerBlock = (name, phone) => (
    <table style={{ fontSize: px(11, 12.5), marginBottom: px(8, 12) }}>
      <tbody>
        <tr>
          <td style={{ width: px(110, 140), padding: '2px 0' }}>Chủ hàng gửi bán</td>
          <td style={{ fontWeight: 700 }}>{name || '—'}{phone ? ` · ĐT: ${phone}` : ''}</td>
        </tr>
        <tr>
          <td style={{ padding: '2px 0' }}>Bên bán giùm</td>
          <td>{store?.name || 'Cửa hàng'}</td>
        </tr>
      </tbody>
    </table>
  );

  const signatures = (roles) => (
    <div style={{
      display: 'flex', justifyContent: 'space-between', textAlign: 'center',
      fontSize: px(10.5, 12), marginTop: px(16, 24), gap: 8, breakInside: 'avoid',
    }}>
      {roles.map(([role, name]) => (
        <div key={role} style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>{role}</div>
          <div style={{ fontSize: px(9, 10), fontStyle: 'italic' }}>(ký, ghi rõ họ tên)</div>
          <div style={{ height: px(40, 56) }} />
          <div>{name || ''}</div>
        </div>
      ))}
    </div>
  );

  const itemsTable = (items, withSettlement) => (
    <table className="lines" style={{ fontSize: px(10, 11.5) }}>
      <thead>
        <tr>
          <th style={cell}>STT</th>
          <th style={cell}>Ngày</th>
          <th style={cell}>Hoá đơn</th>
          <th style={cell}>Tên món</th>
          <th style={cell}>SL</th>
          <th style={cell}>Thành tiền</th>
          <th style={cell}>Hoa hồng</th>
          <th style={cell}>Phải trả</th>
          {withSettlement && <th style={cell}>Đợt chốt</th>}
        </tr>
      </thead>
      <tbody>
        {items.map((x, i) => (
          <tr key={x.id}>
            <td style={{ ...cell, textAlign: 'center' }}>{i + 1}</td>
            <td style={{ ...cell, whiteSpace: 'nowrap' }}>{date(x.sale_ts)}</td>
            <td style={{ ...cell, whiteSpace: 'nowrap' }}>{x.sale_code}</td>
            <td style={cell}>{x.name}</td>
            <td style={right}>{fq(x.qty)} {x.unit_name || ''}</td>
            <td style={right}>{money(x.amount)}</td>
            <td style={right}>{money(x.commission)}</td>
            <td style={{ ...right, fontWeight: 700 }}>{money(x.payable ?? x.amount - x.commission)}</td>
            {withSettlement && <td style={{ ...cell, whiteSpace: 'nowrap' }}>{x.settlement_code || 'Chưa chốt'}</td>}
          </tr>
        ))}
        {!items.length && (
          <tr><td colSpan={withSettlement ? 9 : 8} style={{ ...cell, textAlign: 'center', fontStyle: 'italic' }}>
            Không bán món nào trong kỳ
          </td></tr>
        )}
      </tbody>
    </table>
  );

  /* ------------------------- 1. Đối chiếu theo kỳ ------------------------- */
  let body;
  let title;
  let subtitle;
  if (statement) {
    const s = statement;
    const owe = s.closing;
    title = `Đối chiếu công nợ — ${s.partner.name}`;
    subtitle = `${date(s.from)} – ${date(s.to)} · còn nợ cuối kỳ ${money(owe)}`;
    const rows = [
      ['Nợ đầu kỳ (ngày ' + date(s.from) + ')', s.opening, false],
      [`Tiền hàng bán giùm trong kỳ (${n(s.sold_totals.count)} món)`, s.sold_totals.gross, '+'],
      ['Trừ hoa hồng tiệm giữ lại', s.sold_totals.commission, '−'],
      ['Trừ chiết khấu hai bên thoả thuận', s.discount, '−'],
      [`Tiệm đã trả trong kỳ${s.payments.length ? ` (${s.payments.map((p) => p.code).join(', ')})` : ''}`, s.paid, '−'],
    ];
    body = (
      <div className={isA4 ? 'print-a4 text-black bg-white' : 'print-a5 text-black bg-white'}>
        {head('PHIẾU ĐỐI CHIẾU CÔNG NỢ MUA HỘ', `Từ ngày ${date(s.from)} đến ngày ${date(s.to)}`)}
        {partnerBlock(s.partner.name, s.partner.phone)}

        <table className="lines" style={{ fontSize: px(11, 12.5), marginBottom: px(10, 14) }}>
          <tbody>
            {rows.map(([label, value, sign]) => (
              <tr key={label}>
                <td style={cell}>{label}</td>
                <td style={right}>{sign && value ? `${sign} ` : ''}{money(value)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...cell, fontWeight: 800 }}>
                {owe >= 0 ? 'TIỆM CÒN NỢ CHỦ HÀNG CUỐI KỲ' : 'CHỦ HÀNG CÒN NỢ TIỆM CUỐI KỲ'}
                {' '}(ngày {date(s.to)})
              </td>
              <td style={{ ...right, fontWeight: 800, fontSize: px(13, 15) }}>{money(Math.abs(owe))}</td>
            </tr>
          </tbody>
        </table>
        <div style={{ fontSize: px(10.5, 12), marginBottom: px(10, 14) }}>
          Bằng chữ: <i>{readMoney(Math.abs(owe))}</i>
        </div>

        <div style={{ fontWeight: 700, fontSize: px(11, 12.5), margin: '4px 0' }}>Chi tiết hàng bán giùm trong kỳ</div>
        {itemsTable(s.sold, true)}

        {s.payments.length > 0 && (
          <>
            <div style={{ fontWeight: 700, fontSize: px(11, 12.5), margin: px('10px 0 4px', '14px 0 4px') }}>
              Tiền tiệm đã trả trong kỳ
            </div>
            <table className="lines" style={{ fontSize: px(10, 11.5) }}>
              <thead>
                <tr><th style={cell}>Ngày</th><th style={cell}>Phiếu chi</th><th style={cell}>Đợt chốt</th><th style={cell}>Số tiền</th></tr>
              </thead>
              <tbody>
                {s.payments.map((p) => (
                  <tr key={p.id}>
                    <td style={cell}>{date(p.ts)}</td>
                    <td style={cell}>{p.code}</td>
                    <td style={cell}>{p.settlement_code}</td>
                    <td style={{ ...right, fontWeight: 700 }}>{money(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <p style={{ fontSize: px(10.5, 12), marginTop: px(12, 16), breakInside: 'avoid' }}>
          Hai bên đã cùng đối chiếu và thống nhất các số liệu trên. Tính đến hết ngày {date(s.to)},
          {owe >= 0 ? ' tiệm còn nợ chủ hàng ' : ' chủ hàng còn nợ tiệm '}
          <b>{money(Math.abs(owe))}</b>.
        </p>
        {signatures([['Chủ hàng', s.partner.name], ['Người lập phiếu', user?.full_name], ['Chủ cửa hàng', '']])}
      </div>
    );
  } else {
    /* ------------------------ 2. Phiếu một đợt đã chốt ------------------------ */
    const st = settlement;
    const payable = st.gross - st.commission;
    title = `Phiếu đối soát ${st.code}`;
    subtitle = `${st.partner_name} · thực trả ${money(st.payout)}`;
    body = (
      <div className={isA4 ? 'print-a4 text-black bg-white' : 'print-a5 text-black bg-white'}>
        {head('PHIẾU ĐỐI SOÁT HÀNG GỬI BÁN',
          `Chốt ngày ${date(st.ts)} · hàng bán từ ${date(st.from_date)} đến ${date(st.to_date)}`, st.code)}
        {partnerBlock(st.partner_name, st.partner_phone)}

        {itemsTable(st.items || [], false)}

        <table className="lines" style={{ fontSize: px(11, 12.5), marginTop: px(10, 14), width: px('70%', '55%'), marginLeft: 'auto' }}>
          <tbody>
            <tr><td style={cell}>Tiền hàng bán giùm ({n(st.item_count)} món)</td><td style={right}>{money(st.gross)}</td></tr>
            <tr><td style={cell}>Trừ hoa hồng tiệm giữ</td><td style={right}>− {money(st.commission)}</td></tr>
            <tr><td style={cell}>Phải trả chủ hàng</td><td style={right}>{money(payable)}</td></tr>
            {st.discount > 0 && <tr><td style={cell}>Trừ chiết khấu thoả thuận</td><td style={right}>− {money(st.discount)}</td></tr>}
            <tr>
              <td style={{ ...cell, fontWeight: 800 }}>THỰC TRẢ</td>
              <td style={{ ...right, fontWeight: 800, fontSize: px(13, 15) }}>{money(st.payout)}</td>
            </tr>
          </tbody>
        </table>
        <div style={{ fontSize: px(10.5, 12), marginTop: 6, textAlign: 'right' }}>
          Bằng chữ: <i>{readMoney(st.payout)}</i>
        </div>
        <div style={{ fontSize: px(10.5, 12), marginTop: 6 }}>
          Tình trạng: <b>{st.cash_code ? `Đã chi tiền — phiếu chi ${st.cash_code}${st.paid_at ? ` ngày ${date(st.paid_at)}` : ''}` : 'Chưa chi tiền'}</b>
          {st.note ? ` · Ghi chú: ${st.note}` : ''}
        </div>
        {signatures([['Chủ hàng', st.partner_name], ['Người lập phiếu', st.user_name], ['Chủ cửa hàng', '']])}
      </div>
    );
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={title}
        subtitle={subtitle}
        size="lg"
        footer={<>
          <div className="flex flex-wrap items-center gap-1 mr-auto">
            {[['a4', 'Khổ A4'], ['a5', 'Khổ A5']].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFormat(k)}
                className={`btn btn-sm ${format === k ? 'btn-primary' : 'btn-outline'}`}>
                {label}
              </button>
            ))}
          </div>
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" icon={Printer} onClick={() => window.print()}>In phiếu</Button>
        </>}
      >
        <div className="border border-line rounded-lg bg-slate-100 p-4 overflow-auto max-h-[60vh]">
          <div className="bg-white mx-auto shadow-sm" style={{ width: 'fit-content' }}>{body}</div>
        </div>
      </Modal>
      <div className={`print-area size-${format}`}>{body}</div>
    </>
  );
}
