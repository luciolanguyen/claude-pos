/* ====================================================================
   GIẤY TỜ BẢNG LƯƠNG (plan 28, §7)

   - Phiếu tạm ứng / phiếu thưởng khổ K80: in ra cho nhân viên ký, rồi chụp
     tờ giấy có chữ ký lưu kèm phiếu để cuối tháng đối chiếu.
   - Phiếu lương: xem trên màn hình, xuất ảnh PNG gửi Zalo.
   ==================================================================== */
import { useState, useEffect } from 'react';
import { Printer, Trash2, ImageDown, Share2, Camera } from 'lucide-react';
import { api, payrollPhotoUrl } from '../lib/api';
import { useApp } from '../lib/store';
import { money, n, datetime, readMoney } from '../lib/format';
import { payslipModel, exportPayslip, signedMoney } from '../lib/payslip';
import { Button, IconButton, Modal, Confirm, Badge } from './ui';
import PhotoPicker from './PhotoPicker';

const vn = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

/* ------------------------------------------------------------------ */
/* Phiếu tạm ứng / phiếu thưởng K80 (§7.1)                             */
/* ------------------------------------------------------------------ */

function ReceiptK80({ entry, store }) {
  const isAdvance = entry.type === 'advance';
  const amount = Math.abs(entry.amount);
  return (
    <div className="print-k80 text-black bg-white">
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{store?.name || 'CỬA HÀNG'}</div>
        {store?.address && <div>{store.address}</div>}
        {store?.phone && <div>ĐT: {store.phone}</div>}
      </div>
      <div className="dashed" />
      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14, letterSpacing: 1 }}>
        {isAdvance ? 'PHIẾU TẠM ỨNG LƯƠNG' : 'PHIẾU THƯỞNG'}
      </div>
      <div style={{ textAlign: 'center' }}>
        {entry.cash_code ? <>Số: {entry.cash_code}<br /></> : null}
        Ngày {vn(entry.work_date)} · Âm lịch {entry.lunar_date}
      </div>
      <div className="dashed" />
      <table>
        <tbody>
          <tr>
            <td style={{ verticalAlign: 'top', paddingBottom: 2 }}>Nhân viên</td>
            <td style={{ textAlign: 'right', fontWeight: 700, paddingBottom: 2 }}>{entry.employee_name}</td>
          </tr>
          <tr>
            <td style={{ verticalAlign: 'top', paddingBottom: 2 }}>{isAdvance ? 'Lý do ứng' : 'Lý do thưởng'}</td>
            <td style={{ textAlign: 'right', paddingBottom: 2 }}>{entry.reason || '—'}</td>
          </tr>
          {entry.cycle_label && (
            <tr>
              <td style={{ verticalAlign: 'top', paddingBottom: 2 }}>{isAdvance ? 'Trừ vào lương' : 'Kỳ lương'}</td>
              <td style={{ textAlign: 'right', paddingBottom: 2 }}>
                {entry.pay_mode === 'daily' ? 'lần trả lương ngày kế tiếp' : (
                  <>Kỳ {entry.cycle_label}<br />{entry.cycle_lunar_from?.slice(0, 5)} – {entry.cycle_lunar_to?.slice(0, 5)} Âm</>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="dashed" />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 10 }}>{isAdvance ? 'SỐ TIỀN TẠM ỨNG' : 'SỐ TIỀN THƯỞNG'}</div>
        <div style={{ fontWeight: 700, fontSize: 19, lineHeight: 1.2 }}>{money(amount)}</div>
        <div style={{ fontStyle: 'italic', fontSize: 10 }}>{readMoney(amount)}</div>
        {!isAdvance && (
          <div style={{ fontSize: 10, marginTop: 2 }}>
            {entry.merged ? 'Cộng vào lương cuối kỳ' : 'Đã đưa tiền mặt — không cộng vào lương cuối kỳ'}
          </div>
        )}
      </div>
      <div className="dashed" />
      <div style={{ display: 'flex', justifyContent: 'space-between', textAlign: 'center', marginTop: 4 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>Chủ cửa hàng</div>
          <div style={{ fontSize: 9, fontStyle: 'italic' }}>(ký, ghi rõ họ tên)</div>
          <div style={{ height: 40 }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>Nhân viên nhận</div>
          <div style={{ fontSize: 9, fontStyle: 'italic' }}>(ký, ghi rõ họ tên)</div>
          <div style={{ height: 40 }} />
          <div>{entry.employee_name}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Một dòng sổ lương: xem, in phiếu K80 (ứng / thưởng), chụp ảnh tờ phiếu đã ký.
 * Vừa lưu phiếu ứng xong là mở hộp này luôn — in, ký, chụp trong một lượt.
 */
export function EntryModal({ entryId, onClose, onChanged }) {
  const { store, toast } = useApp();
  const [entry, setEntry] = useState(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState([]);
  const [busy, setBusy] = useState(false);
  const [delPhoto, setDelPhoto] = useState(null);

  const load = () => api.get(`/payroll/entries/${entryId}`).then(setEntry).catch((e) => setErr(e.message));
  useEffect(() => { if (entryId) { setEntry(null); setAdding([]); load(); } }, [entryId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!entryId) return null;
  const printable = entry && (entry.type === 'advance' || entry.type === 'bonus');

  const upload = async () => {
    setBusy(true);
    try {
      setEntry(await api.post(`/payroll/entries/${entryId}/photos`, { photos: adding.map((p) => p.data) }));
      setAdding([]);
      toast('Đã lưu ảnh phiếu có chữ ký', 'ok');
      onChanged?.();
    } catch (e) {
      toast(e.message, 'bad', 6000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="lg"
        title={entry ? `${entry.label} — ${entry.employee_name}` : 'Đang tải...'}
        subtitle={entry ? `${vn(entry.work_date)} (Âm ${entry.lunar_date}) · ${signedMoney(entry.amount)} đ${entry.cash_code ? ` · phiếu chi ${entry.cash_code}` : ''}` : ''}
        footer={<>
          <Button onClick={onClose}>Đóng</Button>
          {printable && <Button variant="primary" icon={Printer} onClick={() => window.print()}>In phiếu K80</Button>}
        </>}
      >
        {err && <p role="alert" className="text-danger text-[13px] font-semibold">{err}</p>}
        {entry && (
          <div className="grid gap-4 md:grid-cols-[auto,1fr]">
            {printable ? (
              <div className="border border-line rounded-lg bg-slate-100 p-3 overflow-auto max-h-[55vh] justify-self-center">
                <div className="bg-white shadow-sm" style={{ width: 'fit-content' }}><ReceiptK80 entry={entry} store={store} /></div>
              </div>
            ) : (
              <div className="card p-3 text-[13px] space-y-1 min-w-[240px]">
                <div>Ngày: <b>{vn(entry.work_date)}</b> (Âm {entry.lunar_date})</div>
                {entry.hours ? <div>Số giờ: <b>{String(entry.hours).replace('.', ',')}</b>{entry.counted ? '' : ' — chủ cho qua'}</div> : null}
                <div>Số tiền: <b className="tabular">{signedMoney(entry.amount)} đ</b></div>
                {entry.reason && <div>Ghi chú: {entry.reason}</div>}
                {entry.ref_code && <div>Chứng từ: {entry.ref_code}</div>}
                {entry.cycle_label && <div>Kỳ lương: {entry.cycle_label}</div>}
              </div>
            )}
            <div className="space-y-3 min-w-0">
              <div className="text-[13px] text-muted-ink">
                Người ghi: {entry.user_name || '—'} · {datetime(entry.ts)}
                {entry.settlement_id ? <Badge tone="mute" className="ml-2">Đã chốt lương</Badge> : null}
              </div>
              {entry.type === 'advance' && (
                <>
                  <div>
                    <div className="label">Ảnh phiếu ứng có chữ ký ({entry.photos.length})</div>
                    {entry.photos.length === 0 ? (
                      <p className="text-2xs text-muted-ink">
                        In phiếu, đưa nhân viên ký, rồi bấm <b>Chụp ảnh</b> bên dưới để lưu lại tờ giấy — cuối tháng đối chiếu
                        khỏi ai quên.
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {entry.photos.map((p) => (
                          <div key={p.id} className="relative card overflow-hidden">
                            <a href={payrollPhotoUrl(p.file)} target="_blank" rel="noreferrer">
                              <img src={payrollPhotoUrl(p.file)} alt="Phiếu ứng có chữ ký" className="w-full aspect-square object-cover" />
                            </a>
                            <IconButton icon={Trash2} size={14} label="Xoá ảnh" variant="danger"
                              className="!absolute top-1 right-1 bg-white/90" onClick={() => setDelPhoto(p)} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <PhotoPicker photos={adding} onChange={setAdding} max={3} label="Thêm ảnh"
                    emptyHint="Chụp tờ phiếu tạm ứng đã có chữ ký nhân viên." />
                  {adding.length > 0 && (
                    <Button variant="primary" icon={Camera} loading={busy} onClick={upload}>Lưu {adding.length} ảnh</Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </Modal>
      {printable && <div className="print-area size-k80"><ReceiptK80 entry={entry} store={store} /></div>}
      <Confirm
        open={!!delPhoto}
        onClose={() => setDelPhoto(null)}
        title="Xoá ảnh này?"
        message="Ảnh xoá rồi không lấy lại được. Số tiền ứng vẫn giữ nguyên trong sổ lương."
        confirmText="Xoá ảnh"
        onConfirm={async () => {
          try {
            await api.del(`/payroll/photos/${delPhoto.id}`);
            setDelPhoto(null);
            load();
          } catch (e) { toast(e.message, 'bad'); }
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Phiếu lương (§7.4, §9)                                              */
/* ------------------------------------------------------------------ */

export function PayslipView({ model }) {
  return (
    <div className="bg-white text-slate-900 rounded-lg border border-line p-4 space-y-3 text-[14px]">
      <div className="text-center">
        <div className="font-display font-bold text-lg tracking-wide">{model.heading}</div>
        <div className="text-2xs text-muted-ink">Số {model.code} · ngày {model.date}</div>
        <div className="font-bold text-base mt-1">{model.employee.full_name} <span className="text-muted-ink font-normal">({model.employee.code})</span></div>
      </div>
      {model.blocks.map((b, i) => (
        <section key={i} className="border-t border-line pt-2">
          <h3 className="font-bold text-emerald-800">{b.title}</h3>
          {b.subtitle && <p className="text-2xs text-muted-ink">{b.subtitle}</p>}
          <ul className="mt-1.5 space-y-1">
            {b.rows.map((r, j) => (
              <li key={j} className={`flex items-start justify-between gap-3
                ${r.kind === 'gift' ? 'bg-emerald-50 border-l-4 border-emerald-600 px-2 py-1.5 rounded-r font-semibold text-emerald-900' : ''}
                ${r.kind === 'note' ? 'italic text-muted-ink text-[13px]' : ''}`}>
                <span className="min-w-0">{r.label}</span>
                {r.amount !== null && r.amount !== undefined && (
                  <span className={`tabular whitespace-nowrap font-semibold ${r.amount < 0 ? 'text-danger' : ''}`}>{signedMoney(r.amount)}</span>
                )}
              </li>
            ))}
          </ul>
          {b.total && (
            <div className="flex justify-between font-bold border-t border-line/70 mt-1.5 pt-1">
              <span>{b.total.label}</span><span className="tabular">{n(b.total.amount)}</span>
            </div>
          )}
        </section>
      ))}
      {model.tail.map((r, i) => (
        <div key={i} className="flex justify-between border-t border-line pt-2">
          <span>{r.label}</span><span className="tabular text-danger font-semibold">{signedMoney(r.amount)}</span>
        </div>
      ))}
      <div className="flex items-center justify-between rounded-lg bg-emerald-900 text-white px-3 py-2.5">
        <span className="font-bold">THỰC NHẬN</span>
        <span className="font-display font-bold text-xl tabular">{money(model.pay)}</span>
      </div>
      {model.carry_out < 0 && (
        <p className="text-warn font-semibold text-[13px]">Còn nợ chuyển sang kỳ sau: {money(-model.carry_out)}</p>
      )}
    </div>
  );
}

export function PayslipModal({ settlementId, onClose, onUndone }) {
  const { store, toast } = useApp();
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState(false);

  useEffect(() => {
    if (!settlementId) return;
    setS(null);
    setErr('');
    api.get(`/payroll/settlements/${settlementId}`).then(setS).catch((e) => setErr(e.message));
  }, [settlementId]);
  if (!settlementId) return null;
  const model = s ? payslipModel(s) : null;
  const share = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

  const exportImg = async () => {
    setBusy(true);
    try {
      const how = await exportPayslip(model, store);
      if (how === 'downloaded') toast('Đã tải ảnh phiếu lương về máy — mở Zalo gửi cho nhân viên', 'ok', 5000);
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="md"
        title={s ? `Phiếu lương ${s.code}` : 'Phiếu lương'}
        subtitle={s ? `${s.employee_name} · trả ${money(s.pay_amount)}${s.cash_code ? ` · phiếu chi ${s.cash_code}` : ''} · ${datetime(s.ts)}` : ''}
        footer={<>
          {s?.is_latest && (
            <Button variant="ghost" className="mr-auto text-danger" onClick={() => setUndo(true)}>Huỷ phiếu lương</Button>
          )}
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" icon={share ? Share2 : ImageDown} loading={busy} disabled={!model} onClick={exportImg}>
            {share ? 'Gửi ảnh phiếu lương' : 'Xuất ảnh phiếu lương'}
          </Button>
        </>}
      >
        {err && <p role="alert" className="text-danger text-[13px] font-semibold">{err}</p>}
        {model && <PayslipView model={model} />}
        {s?.detail?.warn_carry && (
          <p role="alert" className="mt-3 text-[13px] rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-amber-900">
            Nợ mang sang đã vượt một tháng lương — nhân viên đang ứng quá tay.
          </p>
        )}
      </Modal>
      <Confirm
        open={undo}
        onClose={() => setUndo(false)}
        title="Huỷ phiếu lương này?"
        message="Kỳ lương mở lại để sửa, phiếu chi trả lương bị xoá khỏi sổ quỹ. Chỉ làm khi bấm chốt nhầm — tiền đã đưa thì phải thu lại."
        confirmText="Huỷ phiếu lương"
        onConfirm={async () => {
          try {
            await api.del(`/payroll/settlements/${settlementId}`);
            toast('Đã huỷ phiếu lương, kỳ lương mở lại', 'ok');
            setUndo(false);
            onUndone?.();
          } catch (e) { toast(e.message, 'bad', 6000); }
        }}
      />
    </>
  );
}
