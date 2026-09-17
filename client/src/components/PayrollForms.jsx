/* ====================================================================
   CÁC HỘP NHẬP CỦA BẢNG LƯƠNG (plan 28)

   Chủ tiệm hay thao tác trên điện thoại, đứng giữa cửa hàng: nút to, ô
   nhập ít, và luôn hiện sẵn số tiền sẽ trừ / sẽ trả TRƯỚC khi bấm lưu.

   Ô "lý do", "ghi chú" là <textarea> / <input> thường: bàn phím iOS, Android
   có sẵn nút micro để nói thay gõ (§8.2). Đừng thay bằng ô tự vẽ hay chặn
   sự kiện bàn phím — mất nút micro là chủ tiệm phải gõ tay.
   ==================================================================== */
import { useState, useEffect, useMemo } from 'react';
import { Lock, KeyRound, AlertTriangle, CalendarOff, Trash2 } from 'lucide-react';
import { api, setPayrollToken } from '../lib/api';
import { useApp } from '../lib/store';
import { money, n } from '../lib/format';
import { Button, Modal, Field, Input, Select, Textarea, MoneyInput, Confirm, Spinner } from './ui';
import PhotoPicker from './PhotoPicker';

const today = () => new Date().toLocaleDateString('sv-SE');
const vn = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const minutes = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; };
const hoursOf = (from, to) => Math.max(0, (minutes(to) - minutes(from)) / 60);
const hoursText = (h) => String(Math.round(h * 100) / 100).replace('.', ',');

function ErrorLine({ text }) {
  if (!text) return null;
  return (
    <p role="alert" className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{text}</p>
  );
}

/** Chọn quỹ chi tiền — mặc định quỹ tiền mặt đầu tiên. */
function AccountSelect({ id, value, onChange }) {
  const { meta } = useApp();
  const list = (meta.accounts || []).filter((a) => a.active !== 0);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {/* Để trống = quỹ tiền mặt đầu tiên, máy chủ tự chọn — không lặp lại tên quỹ đó bên dưới */}
      <option value="">{list.find((a) => a.type === 'cash')?.name || 'Quỹ tiền mặt mặc định'}</option>
      {list.filter((a) => a !== list.find((x) => x.type === 'cash')).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </Select>
  );
}

/* ------------------------------------------------------------------ */
/* Mở khoá bằng PIN (§2.4 lớp 3)                                       */
/* ------------------------------------------------------------------ */

export function UnlockScreen({ onUnlocked }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const s = await api.post('/payroll/unlock', { pin });
      setPayrollToken(s.token);
      onUnlocked?.(s);
    } catch (e2) {
      setErr(e2.message);
      setPin('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="p-4 flex justify-center">
      <form onSubmit={submit} className="card-pad w-full max-w-sm mt-6 text-center space-y-3">
        <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto">
          <Lock size={22} className="text-emerald-800" aria-hidden="true" />
        </div>
        <div>
          <h1 className="font-display font-bold text-lg">Bảng lương đang khoá</h1>
          <p className="text-[13px] text-muted-ink mt-1 leading-relaxed">
            Nhập mã PIN của chủ cửa hàng hoặc quản lý. Mở một lần dùng tới khi đóng trình duyệt, hoặc để yên 60 phút.
          </p>
        </div>
        <label htmlFor="payroll-pin" className="sr-only">Mã PIN</label>
        <input
          id="payroll-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          className="field field-lg text-center tracking-[0.5em] font-mono"
          value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setErr(''); }}
          autoFocus
        />
        <ErrorLine text={err} />
        <Button type="submit" variant="primary" size="lg" className="w-full" icon={KeyRound} loading={busy} disabled={pin.length < 4}>
          Mở bảng lương
        </Button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hồ sơ nhân viên (§4.1)                                              */
/* ------------------------------------------------------------------ */

const EMPTY = {
  full_name: '', phone: '', start_date: today(), cycle_day: '', track_from: '', monthly_wage: 0,
  work_from: '07:00', work_to: '17:00', pay_mode: 'monthly', note: '', active: 1, end_date: '',
};

export function EmployeeForm({ employee, onClose, onSaved }) {
  const { toast } = useApp();
  const editing = !!employee;
  const [f, setF] = useState(EMPTY);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));

  useEffect(() => {
    setF(employee ? {
      ...EMPTY, ...employee, phone: employee.phone || '', note: employee.note || '', end_date: employee.end_date || '',
    } : EMPTY);
    setErr('');
  }, [employee]);

  /* Xem trước ngày Âm và kỳ lương ngay khi chọn ngày vào làm */
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.start_date)) { setPreview(null); return undefined; }
    let alive = true;
    const t = setTimeout(() => {
      api.get('/payroll/cycle-preview', { start_date: f.start_date, cycle_day: f.cycle_day || '' })
        .then((p) => { if (alive) setPreview(p); })
        .catch(() => { if (alive) setPreview(null); });
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [f.start_date, f.cycle_day]);

  const hpd = hoursOf(f.work_from, f.work_to);
  const daily = f.pay_mode === 'daily';
  const dayRate = Math.round((Number(f.monthly_wage) || 0) / 30);
  const hourRate = hpd > 0 ? (Number(f.monthly_wage) || 0) / 30 / hpd : 0;
  const trackFrom = f.track_from || f.start_date;
  const oldStaff = preview && preview.current.date_from > f.start_date;

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      const body = {
        full_name: f.full_name, phone: f.phone, start_date: f.start_date,
        cycle_day: Number(f.cycle_day) || preview?.cycle_day || undefined,
        track_from: trackFrom, monthly_wage: Number(f.monthly_wage) || 0, work_from: f.work_from, work_to: f.work_to,
        pay_mode: f.pay_mode, note: f.note,
        ...(editing ? { active: f.active ? 1 : 0, end_date: f.end_date || null } : {}),
      };
      const out = editing
        ? await api.put(`/payroll/employees/${employee.id}`, body)
        : await api.post('/payroll/employees', body);
      toast(editing ? 'Đã lưu hồ sơ' : `Đã thêm nhân viên ${out.code}`, 'ok');
      onSaved?.(out);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={editing ? `Sửa hồ sơ ${employee.code}` : 'Thêm nhân viên'}
      subtitle="Lương tháng chia 30 ra lương ngày; lương ngày chia số giờ làm ra lương giờ"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" loading={busy} onClick={save} disabled={!f.full_name.trim() || !(Number(f.monthly_wage) > 0)}>
          {editing ? 'Lưu hồ sơ' : 'Thêm nhân viên'}
        </Button>
      </>}
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Họ tên" required htmlFor="ef-name">
            <Input id="ef-name" value={f.full_name} onChange={set('full_name')} autoFocus={!editing} />
          </Field>
          <Field label="Số điện thoại" htmlFor="ef-phone">
            <Input id="ef-phone" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} />
          </Field>
        </div>

        <fieldset className="grid grid-cols-2 gap-1.5" aria-label="Hình thức trả lương">
          {[['monthly', 'Theo tháng (gối đầu)', 'Chốt lương mỗi kỳ Âm lịch'], ['daily', 'Theo ngày (trả liền)', 'Làm ngày nào trả ngày đó']]
            .map(([k, label, hint]) => (
              <label key={k} className={`rounded-lg border p-2.5 text-[13px] cursor-pointer
                ${f.pay_mode === k ? 'border-accent bg-accent-soft/40' : 'border-line hover:bg-muted/60'}`}>
                <input type="radio" name="ef-mode" className="sr-only" checked={f.pay_mode === k} onChange={() => set('pay_mode')(k)} />
                <span className="font-semibold block">{label}</span>
                <span className="text-2xs text-muted-ink">{hint}</span>
              </label>
            ))}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={daily ? 'Lương 1 ngày' : 'Lương tháng cố định'} required htmlFor="ef-wage"
            hint={Number(f.monthly_wage) > 0
              ? (daily ? `Tương đương ${n(f.monthly_wage)} đ/30 ngày` : `1 ngày ${n(dayRate)} đ · 1 giờ ${n(Math.round(hourRate))} đ`)
              : ''}>
            <MoneyInput id="ef-wage" size="lg" value={daily ? dayRate : f.monthly_wage}
              onChange={(v) => set('monthly_wage')(daily ? Math.max(0, v) * 30 : Math.max(0, v))} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Giờ vào" htmlFor="ef-from">
              <Input id="ef-from" type="time" value={f.work_from} onChange={set('work_from')} />
            </Field>
            <Field label="Giờ về" htmlFor="ef-to">
              <Input id="ef-to" type="time" value={f.work_to} onChange={set('work_to')} />
            </Field>
            <p className="col-span-2 text-2xs text-muted-ink -mt-1">
              {hpd > 0 ? `${hoursText(hpd)} giờ một ngày — không trừ giờ nghỉ trưa` : 'Giờ về phải sau giờ vào'}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ngày vào làm (Dương lịch)" required htmlFor="ef-start"
            hint={preview ? `Âm lịch: ${preview.start_lunar}` : ''}>
            <Input id="ef-start" type="date" value={f.start_date} disabled={editing && employee.has_history}
              onChange={(e) => setF((x) => ({ ...x, start_date: e.target.value, cycle_day: '', track_from: '' }))} />
          </Field>
          <Field label="Ngày gối đầu kỳ lương (ngày Âm)" htmlFor="ef-anchor"
            hint={preview ? `Kỳ hiện tại: ${preview.current.lunar_from.slice(0, 5)} → ${preview.current.lunar_to.slice(0, 5)} Âm` : ''}>
            <Select id="ef-anchor" value={f.cycle_day || preview?.cycle_day || ''} onChange={set('cycle_day')}>
              {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d <= 10 ? 'Mùng' : 'Ngày'} {d}{preview && d === Number(preview.start_lunar.slice(0, 2)) ? ' (ngày vào làm)' : ''}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Bắt đầu tính lương trên phần mềm từ" htmlFor="ef-track"
          hint="Người mới vào: để bằng ngày vào làm. Người làm lâu rồi: tính từ đầu kỳ hiện tại, các kỳ trước đã trả ngoài sổ.">
          <div className="flex flex-wrap gap-2 items-center">
            <Input id="ef-track" type="date" className="!w-44" value={trackFrom} onChange={set('track_from')} />
            {oldStaff && trackFrom !== preview.current.date_from && (
              <Button size="sm" onClick={() => set('track_from')(preview.current.date_from)}>
                Tính từ kỳ hiện tại ({vn(preview.current.date_from)})
              </Button>
            )}
          </div>
        </Field>

        {editing && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ngày nghỉ việc" hint="Làm hết ngày này. Kỳ cuối tính theo ngày thực tế." htmlFor="ef-end">
              <Input id="ef-end" type="date" value={f.end_date} onChange={set('end_date')} />
            </Field>
            <label className="flex items-center gap-2 text-[13px] cursor-pointer self-end pb-2">
              <input type="checkbox" className="w-4 h-4 accent-emerald-700" checked={!!f.active}
                onChange={(e) => set('active')(e.target.checked ? 1 : 0)} />
              Đang làm (bỏ chọn để ẩn khỏi danh sách)
            </label>
          </div>
        )}

        <Field label="Ghi chú" htmlFor="ef-note">
          <Textarea id="ef-note" rows={2} value={f.note} onChange={set('note')} />
        </Field>
        <ErrorLine text={err} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Báo nghỉ (§5.1)                                                     */
/* ------------------------------------------------------------------ */

export function AbsenceModal({ employee, onClose, onSaved }) {
  const { toast } = useApp();
  const [kind, setKind] = useState('day');
  const [date, setDate] = useState(today());
  const [hours, setHours] = useState('');
  const [counted, setCounted] = useState(true);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const wage = Number(employee.monthly_wage) || 0;
  const hpd = hoursOf(employee.work_from, employee.work_to);
  const dayRate = Math.round(wage / 30);
  const hourRate = hpd > 0 ? wage / 30 / hpd : 0;
  const h = Math.min(Number(String(hours).replace(',', '.')) || 0, hpd);
  const hourMoney = Math.round(h * hourRate);
  const daily = employee.pay_mode === 'daily';

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.post(`/payroll/employees/${employee.id}/absences`, {
        date, kind, hours: kind === 'hour' ? h : undefined, counted, reason,
      });
      toast(kind === 'day' ? `Đã báo ${employee.full_name} nghỉ ngày ${vn(date)}` : `Đã ghi nghỉ ${hoursText(h)} giờ`, 'ok');
      onSaved?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="sm" title={`Báo nghỉ — ${employee.full_name}`}
      subtitle="Không báo gì nghĩa là đi làm đủ"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" size="lg" loading={busy} onClick={save} disabled={kind === 'hour' && !(h > 0)}>Lưu</Button>
      </>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Nghỉ cả ngày hay theo giờ">
          {[['day', 'Nghỉ cả ngày'], ['hour', 'Nghỉ theo giờ']].map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
              className={`btn btn-touch ${kind === k ? 'btn-secondary' : 'btn-outline'}`}>{label}</button>
          ))}
        </div>
        <Field label="Ngày nghỉ" htmlFor="ab-date">
          <Input id="ab-date" type="date" size="lg" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {kind === 'day' ? (
          <div className="card p-2.5 text-[13px]">
            {daily ? <>Ngày này không tính lương ngày ({money(dayRate)}).</>
              : <>Trừ <b className="tabular text-danger">{money(dayRate)}</b> (lương tháng ÷ 30).</>}
          </div>
        ) : (
          <>
            <Field label={`Số giờ nghỉ (tối đa ${hoursText(hpd)} giờ)`} htmlFor="ab-hours">
              <Input id="ab-hours" size="lg" inputMode="decimal" value={hours} placeholder="VD: 2 hoặc 1,5"
                onChange={(e) => setHours(e.target.value.replace(/[^\d.,]/g, ''))} />
            </Field>
            {/* Hiện sẵn số tiền sẽ trừ trước khi lưu (§5.1) — bỏ tích thì con số mờ đi, gạch ngang */}
            <div className="card p-2.5 text-[13px] flex items-baseline justify-between gap-2">
              <span>Nghỉ {hoursText(h)} giờ × {money(Math.round(hourRate))}/giờ</span>
              <b className={`tabular ${counted ? 'text-danger' : 'line-through text-muted-ink opacity-60'}`}>{money(hourMoney)}</b>
            </div>
            <label className="flex items-center gap-2 text-[14px] cursor-pointer min-h-[44px]">
              <input type="checkbox" className="w-5 h-5 accent-emerald-700" checked={counted} onChange={(e) => setCounted(e.target.checked)} />
              Tính vào giảm trừ lương
            </label>
            {!counted && <p className="text-2xs text-muted-ink -mt-2">Vẫn lưu lại để theo dõi, nhưng không trừ tiền — chủ cho qua.</p>}
          </>
        )}
        <Field label="Lý do" htmlFor="ab-reason">
          <Textarea id="ab-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorLine text={err} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Ứng tiền (§5.2)                                                     */
/* ------------------------------------------------------------------ */

export function AdvanceModal({ employee, onClose, onSaved }) {
  const { toast } = useApp();
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState('');
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      const e = await api.post(`/payroll/employees/${employee.id}/advances`, {
        amount, reason, date, account_id: accountId || null, photos: photos.map((p) => p.data),
      });
      toast(`Đã ghi ứng ${money(amount)} và lập phiếu chi ${e.cash_code}`, 'ok', 5000);
      onSaved?.(e);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="sm" title={`Ứng tiền — ${employee.full_name}`}
      subtitle="Tiền ra khỏi két: phần mềm tự lập phiếu chi quỹ"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" size="lg" loading={busy} onClick={save} disabled={!(amount > 0)}>Lưu và in phiếu</Button>
      </>}>
      <div className="space-y-3">
        <Field label="Số tiền ứng" required htmlFor="adv-amount">
          <MoneyInput id="adv-amount" size="lg" value={amount} onChange={(v) => setAmount(Math.max(0, v))} autoFocus />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {[200000, 500000, 1000000, 2000000].map((v) => (
              <button key={v} type="button" onClick={() => setAmount(v)}
                className={`btn btn-sm ${amount === v ? 'btn-soft' : 'btn-outline'}`}>{n(v)}</button>
            ))}
          </div>
        </Field>
        <Field label="Lý do ứng" hint="Cuối tháng in nhắc lại trên phiếu lương" htmlFor="adv-reason">
          <Textarea id="adv-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Ngày ứng" htmlFor="adv-date">
            <Input id="adv-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Chi từ quỹ" htmlFor="adv-acc">
            <AccountSelect id="adv-acc" value={accountId} onChange={setAccountId} />
          </Field>
        </div>
        <PhotoPicker photos={photos} onChange={setPhotos} max={3} label="Ảnh phiếu đã ký (chụp sau cũng được)"
          emptyHint="Thường in phiếu ra cho nhân viên ký trước, lưu xong mới chụp — hộp in phiếu có sẵn nút chụp." />
        <ErrorLine text={err} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Thưởng gộp / tách (§5.3) và cộng / trừ khác                          */
/* ------------------------------------------------------------------ */

export function BonusModal({ employee, onClose, onSaved }) {
  const { toast } = useApp();
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [merged, setMerged] = useState(true);
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      const e = await api.post(`/payroll/employees/${employee.id}/bonuses`, {
        amount, reason, merged, account_id: accountId || null,
      });
      toast(merged ? `Đã ghi thưởng ${money(amount)} — cộng vào lương cuối kỳ` : `Đã ghi thưởng và lập phiếu chi ${e.cash_code}`, 'ok', 5000);
      onSaved?.(e);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="sm" title={`Thưởng — ${employee.full_name}`}
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" size="lg" loading={busy} onClick={save} disabled={!(amount > 0) || !reason.trim()}>Lưu</Button>
      </>}>
      <div className="space-y-3">
        <Field label="Số tiền thưởng" required htmlFor="bn-amount">
          <MoneyInput id="bn-amount" size="lg" value={amount} onChange={(v) => setAmount(Math.max(0, v))} autoFocus />
        </Field>
        <Field label="Lý do thưởng" required htmlFor="bn-reason" hint="Thưởng lễ, thưởng nóng... — cuối năm còn tổng kết">
          <Textarea id="bn-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2 text-[14px] cursor-pointer min-h-[44px] card p-2.5">
          <input type="checkbox" className="w-5 h-5 mt-0.5 accent-emerald-700" checked={merged} onChange={(e) => setMerged(e.target.checked)} />
          <span>
            <b>Gộp vào bảng lương cuối kỳ</b>
            <span className="block text-2xs text-muted-ink">
              {merged ? 'Treo lại, tới lúc chốt lương cộng vào tiền trả một thể.'
                : 'Đưa tiền mặt ngay bây giờ: lập phiếu chi, KHÔNG cộng vào lương cuối kỳ nữa để khỏi trả trùng.'}
            </span>
          </span>
        </label>
        {!merged && (
          <Field label="Chi từ quỹ" htmlFor="bn-acc">
            <AccountSelect id="bn-acc" value={accountId} onChange={setAccountId} />
          </Field>
        )}
        <ErrorLine text={err} />
      </div>
    </Modal>
  );
}

export function AdjustModal({ employee, onClose, onSaved }) {
  const { toast } = useApp();
  const [sign, setSign] = useState(1);
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.post(`/payroll/employees/${employee.id}/adjustments`, { amount: sign * amount, reason });
      toast('Đã ghi vào sổ lương', 'ok');
      onSaved?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={`Cộng / trừ khác — ${employee.full_name}`}
      subtitle="Phụ cấp xăng xe, làm thêm giờ, đền hàng làm vỡ..."
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" size="lg" loading={busy} onClick={save} disabled={!(amount > 0) || !reason.trim()}>Lưu</Button>
      </>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Cộng hay trừ">
          {[[1, 'Cộng thêm'], [-1, 'Trừ lương']].map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={sign === k} onClick={() => setSign(k)}
              className={`btn btn-touch ${sign === k ? 'btn-secondary' : 'btn-outline'}`}>{label}</button>
          ))}
        </div>
        <Field label="Số tiền" htmlFor="adj-amount">
          <MoneyInput id="adj-amount" size="lg" value={amount} onChange={(v) => setAmount(Math.abs(v))} />
        </Field>
        <Field label="Lý do" required htmlFor="adj-reason">
          <Textarea id="adj-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorLine text={err} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Chốt lương (§5.4, §8.3) và trả lương ngày (§5.6)                     */
/* ------------------------------------------------------------------ */

export function SettleModal({ employee, cycles, carryIn, onClose, onDone }) {
  const open = useMemo(() => (cycles || []).filter((c) => c.status === 'open')
    .sort((a, b) => (a.date_from < b.date_from ? -1 : 1)), [cycles]);
  const dueCount = open.filter((c) => c.ended).length;
  const [count, setCount] = useState(Math.max(1, dueCount));
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [early, setEarly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const chosen = open.slice(0, count);
  const earned = chosen.reduce((a, c) => a + c.net, 0);
  const total = (carryIn || 0) + earned;
  const hasEarly = chosen.some((c) => !c.ended);

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      const s = await api.post(`/payroll/employees/${employee.id}/settle`, {
        cycle_ids: chosen.map((c) => c.id), account_id: accountId || null, note, allow_early: early,
      });
      onDone?.(s);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="md" title={`Chốt lương — ${employee.full_name}`}
      subtitle="Chốt lần lượt từ kỳ cũ nhất. Chốt nhiều kỳ một lúc ra một phiếu lương liệt kê riêng từng kỳ."
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" size="lg" loading={busy} onClick={save} disabled={!chosen.length || (hasEarly && !early)}>
          Xác nhận đã trả {money(Math.max(0, total))}
        </Button>
      </>}>
      <div className="space-y-3">
        {open.length === 0 ? <p className="text-[13px] text-muted-ink">Không còn kỳ nào chưa chốt.</p> : (
          <ul className="space-y-1.5" aria-label="Các kỳ chưa chốt">
            {open.map((c, i) => {
              const on = i < count;
              return (
                <li key={c.id}>
                  <label className={`flex items-center gap-2.5 rounded-lg border p-2.5 cursor-pointer text-[13px]
                    ${on ? 'border-accent bg-accent-soft/30' : 'border-line hover:bg-muted/60'}`}>
                    <input type="checkbox" className="w-5 h-5 accent-emerald-700" checked={on}
                      onChange={() => setCount(on ? i : i + 1)} aria-label={`Chốt kỳ ${c.label}`} />
                    <span className="flex-1 min-w-0">
                      <b>Kỳ {c.label}</b>{!c.ended && <span className="ml-1.5 text-warn font-semibold">chưa hết kỳ</span>}
                      <span className="block text-2xs text-muted-ink">
                        {c.lunar_from.slice(0, 5)} → {c.lunar_to.slice(0, 5)} Âm · {vn(c.date_from)} – {vn(c.date_to)}
                      </span>
                    </span>
                    <b className={`tabular ${c.net < 0 ? 'text-danger' : ''}`}>{money(c.net)}</b>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <div className="card p-2.5 text-[13px] space-y-1">
          <div className="flex justify-between"><span>Cộng {chosen.length} kỳ</span><b className="tabular">{money(earned)}</b></div>
          {carryIn < 0 && (
            <div className="flex justify-between text-danger"><span>Còn nợ từ phiếu lương trước</span><b className="tabular">{money(carryIn)}</b></div>
          )}
          <div className="flex justify-between border-t border-line pt-1 text-[15px]">
            <span className="font-bold">Thực nhận</span><b className="tabular text-emerald-800">{money(Math.max(0, total))}</b>
          </div>
          {total < 0 && (
            <p className="text-warn font-semibold">
              Tiền ứng nhiều hơn lương: trả 0 đ, còn nợ {money(-total)} chuyển sang kỳ sau.
              {-total > employee.monthly_wage ? ' Nợ đã vượt một tháng lương.' : ''}
            </p>
          )}
        </div>
        {hasEarly && (
          <label className="flex items-start gap-2 text-[13px] cursor-pointer rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-amber-900">
            <input type="checkbox" className="w-5 h-5 mt-0.5 accent-amber-600" checked={early} onChange={(e) => setEarly(e.target.checked)} />
            <span>
              <b>Chốt sớm khi kỳ chưa hết.</b> Sau khi chốt, không báo nghỉ được vào những ngày còn lại của kỳ; tiền ứng,
              mua hàng phát sinh thêm sẽ tính vào kỳ sau.
            </span>
          </label>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Chi từ quỹ" htmlFor="st-acc">
            <AccountSelect id="st-acc" value={accountId} onChange={setAccountId} />
          </Field>
          <Field label="Ghi chú" htmlFor="st-note">
            <Input id="st-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <ErrorLine text={err} />
      </div>
    </Modal>
  );
}

export function DailyPayModal({ employee, due, onClose, onDone }) {
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      onDone?.(await api.post(`/payroll/employees/${employee.id}/pay-daily`, { to: due.to || today(), account_id: accountId || null }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const moneyEntries = (due.entries || []).filter((e) => !(e.type === 'bonus' && !e.merged) && e.amount);
  return (
    <Modal open onClose={onClose} size="sm" title={`Trả lương ngày — ${employee.full_name}`}
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" size="lg" loading={busy} onClick={save}>Đã trả {money(due.pay)}</Button>
      </>}>
      <div className="space-y-3 text-[13px]">
        <div className="card p-2.5 space-y-1">
          <div className="flex justify-between">
            <span>{n(due.work_days)} ngày công × {money(due.day_rate)}</span><b className="tabular">{money(due.wage)}</b>
          </div>
          {moneyEntries.map((e) => (
            <div key={e.id} className="flex justify-between gap-2">
              <span className="min-w-0 truncate">{e.label} {vn(e.work_date).slice(0, 5)}{e.reason ? ` — ${e.reason}` : ''}</span>
              <b className={`tabular ${e.amount < 0 ? 'text-danger' : ''}`}>{money(e.amount)}</b>
            </div>
          ))}
          {due.carry_in < 0 && (
            <div className="flex justify-between text-danger"><span>Còn nợ từ lần trước</span><b className="tabular">{money(due.carry_in)}</b></div>
          )}
          <div className="flex justify-between border-t border-line pt-1 text-[15px]">
            <span className="font-bold">Trả tiền mặt</span><b className="tabular text-emerald-800">{money(due.pay)}</b>
          </div>
          {due.carry_out < 0 && <p className="text-warn font-semibold">Còn nợ {money(-due.carry_out)} chuyển sang lần sau.</p>}
        </div>
        <p className="text-2xs text-muted-ink">
          Bấm "Đã trả" không xoá gì cả: phần mềm ghi thêm dòng lương ngày và phiếu chi, số dư tự về 0 — cuối tháng vẫn xem lại
          được từng ngày.
        </p>
        <Field label="Chi từ quỹ" htmlFor="dp-acc">
          <AccountSelect id="dp-acc" value={accountId} onChange={setAccountId} />
        </Field>
        <ErrorLine text={err} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Ngày tiệm nghỉ (28-4) và thiết lập                                   */
/* ------------------------------------------------------------------ */

export function ClosedDaysModal({ onClose, onChanged, lunarYear }) {
  const { toast } = useApp();
  const [year, setYear] = useState(lunarYear);
  const [data, setData] = useState(null);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [note, setNote] = useState('Nghỉ Tết');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const [del, setDel] = useState(null);

  const load = () => api.get('/payroll/closed-days', { year }).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { setData(null); load(); }, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await api.post('/payroll/closed-days', { from, to: to < from ? from : to, note });
      setResult(r);
      toast(`Đã khai ${r.days} ngày tiệm nghỉ`, 'ok');
      load();
      onChanged?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal open onClose={onClose} size="md" title="Ngày tiệm nghỉ"
        subtitle="Tiệm đóng cửa (nghỉ Tết...) thì những ngày này KHÔNG tính lương cho ai"
        footer={<Button onClick={onClose}>Đóng</Button>}>
        <div className="space-y-4">
          <div className="card p-3 space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Từ ngày" htmlFor="cd-from">
                <Input id="cd-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} />
              </Field>
              <Field label="Đến hết ngày" htmlFor="cd-to">
                <Input id="cd-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
            <Field label="Ghi chú" htmlFor="cd-note">
              <Input id="cd-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <Button variant="primary" icon={CalendarOff} loading={busy} onClick={add}>Khai ngày tiệm nghỉ</Button>
            {result?.skipped?.length > 0 && (
              <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[13px] text-amber-900">
                <div className="font-semibold flex items-center gap-1.5"><AlertTriangle size={14} aria-hidden="true" /> Không ghi được cho:</div>
                <ul className="list-disc pl-5 mt-1">
                  {result.skipped.map((x, i) => <li key={i}>{x.full_name} ngày {vn(x.date)} — {x.reason}</li>)}
                </ul>
              </div>
            )}
            <ErrorLine text={err} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="font-bold text-sm">Năm Âm lịch {year}</h3>
              <div className="flex gap-1">
                <Button size="sm" onClick={() => setYear((y) => y - 1)}>Năm trước</Button>
                <Button size="sm" onClick={() => setYear((y) => y + 1)}>Năm sau</Button>
              </div>
            </div>
            {!data ? <Spinner /> : data.rows.length === 0 ? (
              <p className="text-[13px] text-muted-ink">Năm này chưa khai ngày tiệm nghỉ nào.</p>
            ) : (
              <ul className="divide-y divide-line border border-line rounded-lg">
                {data.rows.map((d) => (
                  <li key={d.date} className="flex items-center gap-2 px-2.5 py-1.5 text-[13px]">
                    <span className="flex-1 min-w-0">
                      <b>{vn(d.date)}</b> <span className="text-muted-ink">(Âm {d.lunar})</span>
                      {d.note ? ` · ${d.note}` : ''}
                      <span className="block text-2xs text-muted-ink">{n(d.applied)} người không tính lương ngày này</span>
                    </span>
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDel(d)} aria-label={`Bỏ ngày ${vn(d.date)}`}>Bỏ</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Modal>
      <Confirm
        open={!!del}
        onClose={() => setDel(null)}
        title={`Bỏ ngày tiệm nghỉ ${del ? vn(del.date) : ''}?`}
        message="Ngày này tính lương lại bình thường cho những kỳ chưa chốt. Kỳ đã chốt giữ nguyên."
        confirmText="Bỏ ngày nghỉ"
        onConfirm={async () => {
          try {
            const r = await api.del(`/payroll/closed-days/${del.date}`);
            toast(r.locked?.length ? `Đã bỏ. Kỳ đã chốt của ${r.locked.join(', ')} giữ nguyên.` : 'Đã bỏ ngày tiệm nghỉ', 'ok', 5000);
            setDel(null);
            load();
            onChanged?.();
          } catch (e) { toast(e.message, 'bad'); }
        }}
      />
    </>
  );
}

export function PayrollSettingsModal({ meta, onClose, onSaved }) {
  const { toast } = useApp();
  const [f, setF] = useState(meta.settings);
  const [months, setMonths] = useState(meta.settings.photo_keep_months || 3);
  const [busy, setBusy] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [confirmClean, setConfirmClean] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.put('/payroll/settings', f);
      toast('Đã lưu thiết lập lương', 'ok');
      onSaved?.();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Modal open onClose={onClose} size="sm" title="Thiết lập lương"
        footer={<>
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" loading={busy} onClick={save}>Lưu thiết lập</Button>
        </>}>
        <div className="space-y-3">
          <Field label="Thưởng chuyên cần: nghỉ không quá (ngày / năm Âm lịch)" htmlFor="ps-th"
            hint="Nghỉ theo giờ không cộng dồn vào đây">
            <Input id="ps-th" inputMode="numeric" value={f.absent_threshold}
              onChange={(e) => setF((x) => ({ ...x, absent_threshold: Number(e.target.value.replace(/\D/g, '')) || 0 }))} />
          </Field>
          <label className="flex items-start gap-2 text-[13px] cursor-pointer">
            <input type="checkbox" className="w-5 h-5 mt-0.5 accent-emerald-700" checked={!!f.count_closed_days}
              onChange={(e) => setF((x) => ({ ...x, count_closed_days: e.target.checked }))} />
            <span>Tính cả <b>ngày tiệm nghỉ</b> vào số ngày nghỉ của thưởng chuyên cần
              <span className="block text-2xs text-muted-ink">Mặc định không tính — nhân viên nghỉ vì tiệm đóng cửa, không phải tự nghỉ.</span>
            </span>
          </label>
          <Field label="Tự xoá ảnh phiếu ứng của kỳ đã chốt sau (tháng)" htmlFor="ps-keep" hint="0 = giữ mãi. Số liệu chữ trong sổ lương không bao giờ bị xoá.">
            <Input id="ps-keep" inputMode="numeric" value={f.photo_keep_months}
              onChange={(e) => setF((x) => ({ ...x, photo_keep_months: Number(e.target.value.replace(/\D/g, '')) || 0 }))} />
          </Field>
          <div className="card p-2.5 text-[13px] space-y-2">
            <div>Ảnh phiếu ứng đang chiếm <b>{meta.photo_usage.text}</b> ({n(meta.photo_usage.files)} ảnh)</div>
            <div className="flex items-end gap-2">
              <Field label="Xoá ảnh cũ hơn (tháng)" htmlFor="ps-clean" className="flex-1">
                <Input id="ps-clean" inputMode="numeric" value={months} onChange={(e) => setMonths(Number(e.target.value.replace(/\D/g, '')) || 0)} />
              </Field>
              <Button variant="danger" icon={Trash2} loading={cleaning} onClick={() => setConfirmClean(true)}>Xoá ảnh cũ</Button>
            </div>
            <p className="text-2xs text-muted-ink">Chỉ xoá ảnh của kỳ đã chốt lương — kỳ chưa chốt còn phải đối chiếu.</p>
          </div>
        </div>
      </Modal>
      <Confirm
        open={confirmClean}
        onClose={() => setConfirmClean(false)}
        title="Xoá ảnh phiếu ứng cũ?"
        message={`Xoá vĩnh viễn ảnh chữ ký của các kỳ đã chốt, chụp cách đây hơn ${months} tháng. Không lấy lại được.`}
        confirmText="Xoá ảnh"
        busy={cleaning}
        onConfirm={async () => {
          setCleaning(true);
          try {
            const r = await api.post('/payroll/photos/cleanup', { months });
            toast(r.message, 'ok', 5000);
            setConfirmClean(false);
            onSaved?.();
          } catch (e) {
            toast(e.message, 'bad');
          } finally {
            setCleaning(false);
          }
        }}
      />
    </>
  );
}
