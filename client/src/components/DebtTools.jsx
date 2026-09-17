/* ====================================================================
   CÔNG CỤ CÔNG NỢ DÙNG CHUNG CHO KHÁCH HÀNG VÀ NHÀ CUNG CẤP (plan 31, nhóm 6)

     DebtStatementModal  sổ công nợ một người theo kỳ, ngày chốt, in A4/A5
     DebtAdjustModal     sửa công nợ: hai bước, bước sau bắt gõ PIN
     DebtSummaryModal    bảng tổng hợp công nợ mọi người theo kỳ, chốt hàng loạt

   Mọi con số tính ở máy chủ (server/ledger.js); màn hình chỉ hiển thị.
   ==================================================================== */
import { useState, useEffect } from 'react';
import {
  BookOpen, Printer, Lock, Unlock, PencilLine, KeyRound, AlertTriangle, ArrowRight, ListChecks,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, useDebounced } from '../lib/store';
import { money, n, date, datetime, isoDate, readMoney } from '../lib/format';
import {
  Button, Modal, Spinner, ErrorBox, Input, Field, Textarea, MoneyInput, Badge, Confirm, SearchInput,
} from './ui';

const PATH = { customer: 'customers', supplier: 'suppliers' };
const WHO = { customer: 'khách hàng', supplier: 'nhà cung cấp' };
const vn = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== '' && v !== undefined && v !== null && v !== false) p.set(k, v === true ? '1' : v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
const today = () => isoDate(new Date());

/* ------------------------------------------------------------------ */
/* Bản in                                                              */
/* ------------------------------------------------------------------ */

function PrintFrame({ title, onClose, children, defaultFormat = 'a4' }) {
  const [format, setFormat] = useState(defaultFormat);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); window.print(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const body = children(format);
  return (
    <>
      <Modal open onClose={onClose} title={title} size="lg"
        footer={<>
          <div className="flex gap-1 mr-auto" role="radiogroup" aria-label="Khổ giấy">
            {[['a4', 'Khổ A4'], ['a5', 'Khổ A5']].map(([k, lb]) => (
              <button key={k} type="button" role="radio" aria-checked={format === k} onClick={() => setFormat(k)}
                className={`btn btn-sm ${format === k ? 'btn-secondary' : 'btn-outline'}`}>{lb}</button>
            ))}
          </div>
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" icon={Printer} onClick={() => window.print()}>In</Button>
        </>}>
        <div className="border border-line rounded-lg bg-slate-100 p-4 overflow-auto max-h-[60vh]">
          <div className="bg-white mx-auto shadow-sm" style={{ width: 'fit-content' }}>{body}</div>
        </div>
      </Modal>
      <div className={`print-area size-${format}`}>{body}</div>
    </>
  );
}

function PrintHead({ store, title, sub, px }) {
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: px(13, 15) }}>{store?.name || 'CỬA HÀNG'}</div>
          {store?.address && <div style={{ fontSize: px(10, 11) }}>{store.address}</div>}
          {store?.phone && <div style={{ fontSize: px(10, 11) }}>ĐT: {store.phone}</div>}
        </div>
        <div style={{ textAlign: 'right', fontSize: px(10, 11) }}>Ngày in: {datetime(new Date())}</div>
      </div>
      <div style={{ textAlign: 'center', margin: px('10px 0 8px', '16px 0 12px') }}>
        <div style={{ fontWeight: 800, fontSize: px(15, 18), letterSpacing: 1 }}>{title}</div>
        <div style={{ fontSize: px(10.5, 12), fontStyle: 'italic' }}>{sub}</div>
      </div>
    </>
  );
}

function StatementPaper({ st, store, format }) {
  const isA4 = format === 'a4';
  const px = (a5, a4) => (isA4 ? a4 : a5);
  const cell = { padding: px('3px 4px', '4px 6px'), border: '1px solid #000' };
  const num = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' };
  const period = st.from ? `Từ ${vn(st.from)} đến ${vn(st.to)}` : `Đến ngày ${vn(st.to)}`;
  return (
    <div className={`print-${format} text-black bg-white`}>
      <PrintHead store={store} px={px} title={st.type === 'supplier' ? 'SỔ CHI TIẾT CÔNG NỢ NHÀ CUNG CẤP' : 'SỔ CHI TIẾT CÔNG NỢ KHÁCH HÀNG'} sub={period} />
      <div style={{ fontSize: px(11, 12.5), marginBottom: 8 }}>
        <div>{st.type === 'supplier' ? 'Nhà cung cấp' : 'Khách hàng'}: <b>{st.partner.name}</b> {st.partner.code ? `(${st.partner.code})` : ''}</div>
        {st.partner.phone && <div>Điện thoại: {st.partner.phone}</div>}
        {st.partner.address && <div>Địa chỉ: {st.partner.address}</div>}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: px(10, 11.5) }}>
        <thead>
          <tr style={{ background: '#f1f5f9' }}>
            <th style={cell}>Ngày</th><th style={cell}>Chứng từ</th><th style={cell}>Diễn giải</th>
            <th style={cell}>Tăng nợ</th><th style={cell}>Giảm nợ</th><th style={cell}>Còn nợ</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ fontWeight: 700 }}>
            <td style={cell} colSpan={5}>{st.opening.label}</td>
            <td style={num}>{money(st.opening.amount)}</td>
          </tr>
          {st.rows.map((r) => (
            <tr key={`${r.kind}${r.id}`}>
              <td style={{ ...cell, whiteSpace: 'nowrap' }}>{date(r.ts)}</td>
              <td style={{ ...cell, fontFamily: 'monospace' }}>{r.code}</td>
              <td style={cell}>{r.label}{r.note ? ` — ${r.note}` : ''}</td>
              <td style={num}>{r.increase ? money(r.increase) : ''}</td>
              <td style={num}>{r.decrease ? money(r.decrease) : ''}</td>
              <td style={num}>{money(r.balance)}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: 800 }}>
            <td style={cell} colSpan={3}>Cộng phát sinh · Còn nợ cuối kỳ</td>
            <td style={num}>{money(st.increase)}</td>
            <td style={num}>{money(st.decrease)}</td>
            <td style={num}>{money(st.closing_balance)}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: px(10.5, 12), marginTop: 6, fontStyle: 'italic' }}>
        Bằng chữ: {readMoney(Math.abs(st.closing_balance))}{st.closing_balance < 0 ? ' (tiệm còn giữ tiền trả trước)' : ''}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: px(18, 28), fontSize: px(11, 12) }}>
        <div style={{ textAlign: 'center' }}><b>{st.type === 'supplier' ? 'ĐẠI DIỆN NHÀ CUNG CẤP' : 'KHÁCH HÀNG'}</b><div style={{ fontStyle: 'italic', fontSize: 10 }}>(Ký, ghi rõ họ tên)</div></div>
        <div style={{ textAlign: 'center' }}><b>CỬA HÀNG</b><div style={{ fontStyle: 'italic', fontSize: 10 }}>(Ký, ghi rõ họ tên)</div></div>
      </div>
    </div>
  );
}

function SummaryPaper({ sum, store, format, type }) {
  const isA4 = format === 'a4';
  const px = (a5, a4) => (isA4 ? a4 : a5);
  const cell = { padding: px('2px 3px', '3px 5px'), border: '1px solid #000' };
  const num = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' };
  const period = sum.from ? `Từ ${vn(sum.from)} đến ${vn(sum.to)}` : `Đến ngày ${vn(sum.to)}`;
  return (
    <div className={`print-${format} text-black bg-white`}>
      <PrintHead store={store} px={px} title={type === 'supplier' ? 'BẢNG TỔNG HỢP CÔNG NỢ NHÀ CUNG CẤP' : 'BẢNG TỔNG HỢP CÔNG NỢ KHÁCH HÀNG'} sub={period} />
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: px(9.5, 11) }}>
        <thead>
          <tr style={{ background: '#f1f5f9' }}>
            <th style={cell}>TT</th><th style={cell}>{type === 'supplier' ? 'Nhà cung cấp' : 'Khách hàng'}</th>
            <th style={cell}>Nợ đầu kỳ</th><th style={cell}>Tăng</th><th style={cell}>Giảm</th><th style={cell}>Nợ cuối kỳ</th>
          </tr>
        </thead>
        <tbody>
          {sum.rows.map((r, i) => (
            <tr key={r.id}>
              <td style={{ ...cell, textAlign: 'center' }}>{i + 1}</td>
              <td style={cell}>{r.name}{r.phone ? ` · ${r.phone}` : ''}{r.close_date ? ` (chốt ${vn(r.close_date)})` : ''}</td>
              <td style={num}>{money(r.opening)}</td>
              <td style={num}>{r.increase ? money(r.increase) : ''}</td>
              <td style={num}>{r.decrease ? money(r.decrease) : ''}</td>
              <td style={{ ...num, fontWeight: 700 }}>{money(r.closing)}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: 800 }}>
            <td style={cell} colSpan={2}>Cộng {n(sum.totals.count)} {type === 'supplier' ? 'nhà cung cấp' : 'khách hàng'}</td>
            <td style={num}>{money(sum.totals.opening)}</td>
            <td style={num}>{money(sum.totals.increase)}</td>
            <td style={num}>{money(sum.totals.decrease)}</td>
            <td style={num}>{money(sum.totals.closing)}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: px(16, 24), fontSize: px(11, 12) }}>
        <div style={{ textAlign: 'center' }}><b>NGƯỜI LẬP BẢNG</b><div style={{ fontStyle: 'italic', fontSize: 10 }}>(Ký, ghi rõ họ tên)</div></div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sổ công nợ một người                                                */
/* ------------------------------------------------------------------ */

export function DebtStatementModal({ type, partner, onClose, onChanged }) {
  const { can, store, toast } = useApp();
  const mayAdjust = can('debt.adjust');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detail, setDetail] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [closeDate, setCloseDate] = useState(today());
  const [closing, setClosing] = useState(false);
  const [unclosing, setUnclosing] = useState(null);
  const base = `/${PATH[type]}/${partner.id}`;
  const { data: st, busy, error, reload } = useFetch(
    () => api.get(`${base}/debt-statement${qs({ from, to, detail })}`), [from, to, detail, partner.id]);
  const { data: closings, reload: reloadClosings } = useFetch(() => api.get(`${base}/debt-closings`), [partner.id]);

  const refresh = () => { reload(); reloadClosings(); onChanged?.(); };

  const doClose = async () => {
    setClosing(true);
    try {
      const res = await api.post(`${base}/debt-closings`, { close_date: closeDate });
      toast(`Đã chốt công nợ đến ${vn(res.close_date)}: ${money(res.amount)}`, 'ok', 6000);
      setDetail(false);
      refresh();
    } catch (e) {
      toast(e.message, 'bad', 8000);
    } finally {
      setClosing(false);
    }
  };
  const doUnclose = async () => {
    try {
      await api.del(`${base}/debt-closings/${unclosing.id}`);
      toast(`Đã bỏ mốc chốt ${vn(unclosing.close_date)} — sổ về như trước khi chốt`, 'ok');
      setUnclosing(null);
      refresh();
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  return (
    <>
      <Modal open onClose={onClose} size="xl"
        title={`Sổ công nợ — ${partner.name}`}
        subtitle={st ? `Còn nợ hiện tại ${money(st.current_debt)}` : WHO[type]}
        footer={<>
          {mayAdjust && (
            <Button icon={PencilLine} className="mr-auto" onClick={() => setAdjusting(true)}>Điều chỉnh công nợ</Button>
          )}
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" icon={Printer} onClick={() => setPrinting(true)} disabled={!st}>In sổ công nợ</Button>
        </>}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Từ ngày" htmlFor="ds-from"><Input id="ds-from" type="date" size="sm" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Đến ngày" htmlFor="ds-to"><Input id="ds-to" type="date" size="sm" value={to} max={today()} onChange={(e) => setTo(e.target.value)} /></Field>
            {(from || to) && <Button size="sm" onClick={() => { setFrom(''); setTo(''); }}>Tới hôm nay</Button>}
            {st?.closing && (
              <label className="flex items-center gap-2 text-[13px] cursor-pointer pb-1.5 ml-auto">
                <input type="checkbox" className="w-4 h-4 accent-emerald-700 cursor-pointer" checked={detail}
                  onChange={(e) => setDetail(e.target.checked)} />
                Xem cả chứng từ trước ngày chốt
              </label>
            )}
          </div>

          {busy && !st ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : st && (
            <>
              {st.used_closing && st.closing?.drift !== 0 && (
                <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[13px] text-amber-900 flex gap-2">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    Lúc chốt ngày {vn(st.closing.close_date)} tổng nợ là <b>{money(st.closing.amount)}</b>, nay tính lại là{' '}
                    <b>{money(st.opening.amount)}</b> (chênh {st.closing.drift > 0 ? '+' : ''}{money(st.closing.drift)}): có chứng từ
                    trước ngày chốt được thu / trả tiền thêm, sửa hoặc huỷ sau khi chốt. Tích "Xem cả chứng từ trước ngày chốt" để soát lại.
                  </span>
                </div>
              )}
              {st.check_ok === false && (
                <div role="alert" className="rounded-lg border border-danger/30 bg-red-50 p-2.5 text-[13px] text-red-900">
                  Sổ chi tiết cộng ra {money(st.closing_balance)} nhưng công nợ tổng là {money(st.current_debt)}. Báo lại cho người lập phần mềm.
                </div>
              )}
              <div className="table-wrap max-h-[46vh] overflow-y-auto">
                <table className="data">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th>Ngày</th><th>Chứng từ</th><th>Diễn giải</th>
                      <th className="text-right">Tăng nợ</th><th className="text-right">Giảm nợ</th><th className="text-right">Còn nợ</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className={st.used_closing ? 'bg-violet-50' : 'bg-muted/50'}>
                      <td colSpan={5} className="font-semibold">
                        {st.used_closing && <Lock size={12} className="inline mr-1 text-violet-800" aria-hidden="true" />}
                        {st.opening.label}
                      </td>
                      <td className="num font-bold">{money(st.opening.amount)}</td>
                    </tr>
                    {st.rows.length === 0 && (
                      <tr><td colSpan={6} className="text-center text-muted-ink">Không có chứng từ nào trong khoảng này.</td></tr>
                    )}
                    {st.rows.map((r) => (
                      <tr key={`${r.kind}${r.id}`}>
                        <td className="whitespace-nowrap text-muted-ink">{date(r.ts)}</td>
                        <td className="font-mono whitespace-nowrap">{r.code}</td>
                        <td>{r.label}{r.note && <div className="text-2xs text-muted-ink">{r.note}</div>}</td>
                        <td className="num text-warn">{r.increase ? money(r.increase) : ''}</td>
                        <td className="num text-emerald-700">{r.decrease ? money(r.decrease) : ''}</td>
                        <td className="num font-semibold">{money(r.balance)}</td>
                      </tr>
                    ))}
                    <tr className="font-bold border-t-2 border-line">
                      <td colSpan={3}>Cộng phát sinh · còn nợ cuối kỳ</td>
                      <td className="num">{money(st.increase)}</td>
                      <td className="num">{money(st.decrease)}</td>
                      <td className="num">{money(st.closing_balance)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Ngày chốt công nợ (6b) */}
          <section className="rounded-lg border border-line p-3 space-y-2" aria-labelledby="ds-close-h">
            <h3 id="ds-close-h" className="text-[13px] font-bold flex items-center gap-1.5">
              <Lock size={14} aria-hidden="true" /> Ngày chốt công nợ
            </h3>
            <p className="text-2xs text-muted-ink">
              Chốt rồi thì sổ công nợ từ ngày chốt gom mọi chứng từ trước đó thành một dòng "Tổng nợ đến ngày chốt".
              Chứng từ gốc giữ nguyên, xem lại hoặc bỏ chốt được bất cứ lúc nào.
            </p>
            {closings?.length > 0 ? (
              <ul className="text-[13px] divide-y divide-line border border-line rounded">
                {closings.map((c, i) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5">
                    <b>Đến {vn(c.close_date)}</b>
                    <span className="tabular">{money(c.amount)}</span>
                    {i === 0 && <Badge tone="info">đang áp dụng</Badge>}
                    <span className="text-2xs text-muted-ink">chốt lúc {datetime(c.ts)}{c.user_name ? ` · ${c.user_name}` : ''}</span>
                    {mayAdjust && (
                      <Button size="sm" variant="outline" icon={Unlock} className="ml-auto" onClick={() => setUnclosing(c)}>Bỏ chốt</Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="text-[13px] text-muted-ink">Chưa chốt lần nào.</p>}
            {mayAdjust && (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Chốt công nợ đến hết ngày" htmlFor="ds-close">
                  <Input id="ds-close" type="date" size="sm" value={closeDate} max={today()} onChange={(e) => setCloseDate(e.target.value)} />
                </Field>
                <Button size="sm" variant="primary" icon={Lock} onClick={doClose} loading={closing} disabled={!closeDate}>Chốt công nợ</Button>
              </div>
            )}
          </section>
        </div>
      </Modal>

      {printing && st && (
        <PrintFrame title={`In sổ công nợ — ${partner.name}`} onClose={() => setPrinting(false)}>
          {(format) => <StatementPaper st={st} store={store} format={format} />}
        </PrintFrame>
      )}
      {adjusting && (
        <DebtAdjustModal type={type} partner={partner} onClose={() => setAdjusting(false)}
          onDone={() => { setAdjusting(false); refresh(); }} />
      )}
      <Confirm open={!!unclosing} onClose={() => setUnclosing(null)} onConfirm={doUnclose} danger={false}
        title="Bỏ mốc chốt công nợ?" confirmText="Bỏ chốt"
        message={unclosing ? `Sổ công nợ sẽ hiện lại đủ chứng từ trước ngày ${vn(unclosing.close_date)}. Không chứng từ nào bị thay đổi.` : ''} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Điều chỉnh công nợ                                                  */
/* ------------------------------------------------------------------ */

export function DebtAdjustModal({ type, partner, onClose, onDone }) {
  const { toast } = useApp();
  const base = `/${PATH[type]}/${partner.id}`;
  const { data: st, busy, error, reload } = useFetch(() => api.get(`${base}/debt-statement`), [partner.id]);
  const { data: history } = useFetch(() => api.get(`${base}/debt-adjustments`), [partner.id]);
  const [mode, setMode] = useState('set');           // set | plus | minus
  const [value, setValue] = useState(0);
  const [reason, setReason] = useState('');
  const [step, setStep] = useState(1);
  const [checked, setChecked] = useState(false);
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const before = st?.current_debt ?? 0;
  const v = Math.round(Number(value) || 0);
  const after = mode === 'set' ? v : mode === 'plus' ? before + Math.abs(v) : before - Math.abs(v);
  const diff = after - before;

  const next = () => {
    if (reason.trim().length < 5) { setErr('Ghi rõ lý do sửa công nợ (ít nhất 5 ký tự).'); return; }
    if (diff === 0) { setErr('Số công nợ mới bằng đúng số đang có — không có gì để sửa.'); return; }
    setErr('');
    setStep(2);
  };

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      const res = await api.post(`${base}/debt-adjustments`, {
        new_debt: after, reason: reason.trim(), pin, expected_before: before,
      });
      toast(`Đã sửa công nợ ${partner.name}: ${money(res.debt_before)} → ${money(res.debt_after)} (${res.code})`, 'ok', 7000);
      onDone?.(res);
    } catch (e) {
      setErr(e.message);
      setPin('');
      if (e.code === 'DEBT_CHANGED') { setStep(1); reload(); }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg"
      title={`Điều chỉnh công nợ — ${partner.name}`}
      subtitle="Không sửa chứng từ cũ: ghi một phiếu điều chỉnh, lưu lại ai sửa, từ bao nhiêu sang bao nhiêu, lý do"
      footer={step === 1 ? <>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" icon={ArrowRight} onClick={next} disabled={!st}>Tiếp tục — xác nhận</Button>
      </> : <>
        <Button onClick={() => { setStep(1); setPin(''); setErr(''); }} className="mr-auto">Quay lại sửa</Button>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="danger" icon={KeyRound} onClick={save} loading={saving} disabled={!checked || pin.length < 4}>
          Lưu điều chỉnh
        </Button>
      </>}>
      {busy && !st ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : st && (
        <div className="space-y-3">
          {step === 1 ? (
            <>
              <div className="rounded-lg border border-line bg-muted/40 p-3">
                <div className="text-2xs font-bold uppercase text-muted-ink">Công nợ hiện tại</div>
                <div className="font-display font-bold text-2xl tabular">{money(before)}</div>
              </div>
              <div role="radiogroup" aria-label="Cách sửa" className="flex flex-wrap gap-1">
                {[['set', 'Nợ đúng phải là'], ['plus', 'Cộng thêm nợ'], ['minus', 'Trừ bớt nợ']].map(([k, lb]) => (
                  <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}
                    className={`btn btn-sm ${mode === k ? 'btn-secondary' : 'btn-outline'}`}>{lb}</button>
                ))}
              </div>
              <Field label={mode === 'set' ? 'Số nợ đúng' : 'Số tiền'} hint={mode === 'set' ? 'Âm nếu tiệm đang giữ tiền khách trả trước' : undefined} htmlFor="da-val">
                <MoneyInput id="da-val" size="lg" value={value} onChange={setValue} />
              </Field>
              <Field label="Lý do sửa" required hint="Ghi đủ để sau này đọc lại còn hiểu: đối chiếu với ai, sai ở đâu" htmlFor="da-reason">
                <Textarea id="da-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="Đối chiếu sổ tay với anh Bảy ngày 15/9: khách đã trả 200.000 tiền mặt chưa ghi phiếu" />
              </Field>
              <p className="text-[13px]">
                Sau khi sửa: <b className="tabular">{money(after)}</b>{' '}
                <span className={diff > 0 ? 'text-warn' : 'text-emerald-700'}>({diff > 0 ? '+' : ''}{money(diff)})</span>
              </p>
            </>
          ) : (
            <>
              <div className="rounded-lg border-2 border-danger/40 bg-red-50/60 p-3 space-y-1">
                <div className="text-[13px] font-bold text-red-900 flex items-center gap-1.5">
                  <AlertTriangle size={15} aria-hidden="true" /> Soát lại lần cuối trước khi lưu
                </div>
                <div className="flex flex-wrap items-baseline gap-2 text-lg">
                  <span className="tabular">{money(before)}</span>
                  <ArrowRight size={16} aria-hidden="true" />
                  <b className="tabular text-xl">{money(after)}</b>
                  <span className={`text-[13px] ${diff > 0 ? 'text-warn' : 'text-emerald-700'}`}>({diff > 0 ? 'tăng' : 'giảm'} {money(Math.abs(diff))})</span>
                </div>
                <div className="text-[13px]">{WHO[type][0].toUpperCase() + WHO[type].slice(1)}: <b>{partner.name}</b></div>
                <div className="text-[13px]">Lý do: {reason}</div>
              </div>
              <label className="flex items-start gap-2 text-[13px] cursor-pointer">
                <input type="checkbox" className="w-4 h-4 mt-0.5 accent-emerald-700 cursor-pointer" checked={checked}
                  onChange={(e) => setChecked(e.target.checked)} />
                Tôi đã đối chiếu kỹ số công nợ mới với {WHO[type]} và chịu trách nhiệm về lần sửa này.
              </label>
              <Field label="Mã PIN của chủ cửa hàng hoặc quản lý" htmlFor="da-pin">
                <Input id="da-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={8}
                  value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && checked && pin.length >= 4) save(); }} />
              </Field>
            </>
          )}
          {err && <p role="alert" className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}

          {history?.length > 0 && (
            <details className="text-[13px]">
              <summary className="cursor-pointer font-semibold">Lịch sử sửa công nợ ({history.length})</summary>
              <ul className="mt-1.5 divide-y divide-line border border-line rounded">
                {history.map((h) => (
                  <li key={h.id} className="px-2.5 py-1.5">
                    <div className="flex flex-wrap gap-x-2">
                      <span className="font-mono">{h.code}</span>
                      <span className="text-muted-ink">{datetime(h.ts)}</span>
                      <span className="tabular">{money(h.debt_before)} → <b>{money(h.debt_after)}</b></span>
                    </div>
                    <div className="text-2xs text-muted-ink">{h.reason} · lập: {h.user_name || '—'} · duyệt PIN: {h.approved_by_name || '—'}</div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Bảng tổng hợp công nợ                                               */
/* ------------------------------------------------------------------ */

export function DebtSummaryModal({ type, onClose, onOpen }) {
  const { can, store, toast } = useApp();
  const mayAdjust = can('debt.adjust');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [onlyOwing, setOnlyOwing] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [bulkDate, setBulkDate] = useState(today());
  const [bulkAsk, setBulkAsk] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const path = type === 'supplier' ? '/supplier-debts/summary' : '/customer-debts/summary';
  const { data: sum, busy, error, reload } = useFetch(
    () => api.get(`${path}${qs({ from, to, q: dq, only_owing: onlyOwing })}`), [from, to, dq, onlyOwing]);

  const bulkClose = async () => {
    setBulkBusy(true);
    try {
      const res = await api.post('/debt-closings/bulk', { partner_type: type, close_date: bulkDate });
      setBulkResult(res);
      toast(`Đã chốt công nợ ${n(res.closed)} ${WHO[type]} đến ${vn(res.close_date)}`, 'ok', 6000);
      setBulkAsk(false);
      reload();
    } catch (e) {
      toast(e.message, 'bad', 7000);
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <>
      <Modal open onClose={onClose} size="full"
        title={`Tổng hợp công nợ ${WHO[type]}`}
        subtitle="Nợ đầu kỳ, phát sinh tăng / giảm trong kỳ, nợ cuối kỳ của từng người"
        footer={<>
          <Button onClick={onClose} className="mr-auto">Đóng</Button>
          <Button variant="primary" icon={Printer} onClick={() => setPrinting(true)} disabled={!sum?.rows?.length}>In bảng tổng hợp</Button>
        </>}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Từ ngày" htmlFor="dsum-from"><Input id="dsum-from" type="date" size="sm" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Đến ngày" htmlFor="dsum-to"><Input id="dsum-to" type="date" size="sm" value={to} max={today()} onChange={(e) => setTo(e.target.value)} /></Field>
            <SearchInput value={q} onChange={setQ} size="sm" className="w-56" placeholder="Tên, mã, số điện thoại..." />
            <label className="flex items-center gap-2 text-[13px] cursor-pointer pb-1.5">
              <input type="checkbox" className="w-4 h-4 accent-emerald-700 cursor-pointer" checked={onlyOwing}
                onChange={(e) => setOnlyOwing(e.target.checked)} />
              Chỉ người có công nợ
            </label>
            {mayAdjust && (
              <div className="flex items-end gap-1.5 ml-auto">
                <Field label="Chốt hàng loạt đến ngày" htmlFor="dsum-bulk">
                  <Input id="dsum-bulk" type="date" size="sm" value={bulkDate} max={today()} onChange={(e) => setBulkDate(e.target.value)} />
                </Field>
                <Button size="sm" icon={ListChecks} onClick={() => setBulkAsk(true)} disabled={!bulkDate}>Chốt tất cả</Button>
              </div>
            )}
          </div>

          {bulkResult?.skipped?.length > 0 && (
            <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[13px] text-amber-900">
              Bỏ qua {bulkResult.skipped.length} người: {bulkResult.skipped.slice(0, 6).map((x) => `${x.name} (${x.error})`).join('; ')}
            </div>
          )}

          {busy && !sum ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : sum && (
            <div className="table-wrap max-h-[calc(100vh-18rem)] overflow-y-auto">
              <table className="data">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th>{type === 'supplier' ? 'Nhà cung cấp' : 'Khách hàng'}</th>
                    <th className="text-right">Nợ đầu kỳ</th><th className="text-right">Phát sinh tăng</th>
                    <th className="text-right">Phát sinh giảm</th><th className="text-right">Nợ cuối kỳ</th><th>Chốt gần nhất</th>
                  </tr>
                </thead>
                <tbody>
                  {sum.rows.length === 0 && <tr><td colSpan={6} className="text-center text-muted-ink">Không có ai.</td></tr>}
                  {sum.rows.map((r) => (
                    <tr key={r.id} className={onOpen ? 'hoverable clickable' : ''} onClick={onOpen ? () => onOpen(r) : undefined}>
                      <td>
                        <div className="font-semibold">{r.name}</div>
                        <div className="text-2xs text-muted-ink">{[r.code, r.phone].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="num">{money(r.opening)}</td>
                      <td className="num text-warn">{r.increase ? money(r.increase) : ''}</td>
                      <td className="num text-emerald-700">{r.decrease ? money(r.decrease) : ''}</td>
                      <td className="num font-bold">{money(r.closing)}</td>
                      <td className="text-muted-ink whitespace-nowrap">{r.close_date ? vn(r.close_date) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                {sum.rows.length > 0 && (
                  <tfoot>
                    <tr className="font-bold">
                      <td>Cộng {n(sum.totals.count)} người</td>
                      <td className="num">{money(sum.totals.opening)}</td>
                      <td className="num">{money(sum.totals.increase)}</td>
                      <td className="num">{money(sum.totals.decrease)}</td>
                      <td className="num">{money(sum.totals.closing)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      </Modal>

      {printing && sum && (
        <PrintFrame title={`In tổng hợp công nợ ${WHO[type]}`} onClose={() => setPrinting(false)}>
          {(format) => <SummaryPaper sum={sum} store={store} format={format} type={type} />}
        </PrintFrame>
      )}
      <Confirm open={bulkAsk} onClose={() => setBulkAsk(false)} onConfirm={bulkClose} busy={bulkBusy} danger={false}
        title={`Chốt công nợ đến ngày ${vn(bulkDate)}?`} confirmText="Chốt tất cả"
        message={`Chốt cho mọi ${WHO[type]} đang có phát sinh công nợ. Mỗi người được đối chiếu riêng — ai lệch số hoặc đã có mốc ngày này thì bỏ qua và báo lại. Không chứng từ nào bị thay đổi, bỏ chốt được từng người.`} />
    </>
  );
}

/** Nút mở sổ công nợ — gắn vào hồ sơ khách / NCC. */
export function DebtStatementButton({ type, partner, onChanged, className = '' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon={BookOpen} className={className} onClick={() => setOpen(true)}>Sổ công nợ · chốt · in</Button>
      {open && <DebtStatementModal type={type} partner={partner} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </>
  );
}

