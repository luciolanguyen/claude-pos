/* ====================================================================
   LƯƠNG NHÂN VIÊN THEO LỊCH ÂM (plan 28)

   Mở ra là thấy ngay ai đang ứng nhiều, ai có kỳ chưa chốt. Trên máy tính
   là bảng đủ cột; trên điện thoại là thẻ cuộn dọc với ba nút to Báo nghỉ ·
   Ứng tiền · Thưởng (§8.1).

   Mọi con số hiện ở đây đều do máy chủ tính — màn hình chỉ bày ra. Trang
   khoá thêm bằng mã PIN, và đóng hẳn khi tiệm tắt đăng nhập (§2.4).
   ==================================================================== */
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  IdCard, UserRoundPlus, CalendarOff, Settings as Cog, Lock, CalendarX, HandCoins, Gift, CirclePlus,
  ChevronLeft, Pencil, AlertTriangle, Wallet, ChevronDown, ChevronRight, Trash2, Receipt, Camera, Clock,
} from 'lucide-react';
import { api, setPayrollToken } from '../lib/api';
import { useApp } from '../lib/store';
import { money, n, datetime } from '../lib/format';
import { signedMoney } from '../lib/payslip';
import { Button, Badge, Stat, Spinner, ErrorBox, Empty, Confirm } from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import {
  UnlockScreen, EmployeeForm, AbsenceModal, AdvanceModal, BonusModal, AdjustModal, SettleModal, DailyPayModal,
  ClosedDaysModal, PayrollSettingsModal,
} from '../components/PayrollForms';
import { EntryModal, PayslipModal } from '../components/PayrollDocs';

const vn = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const dm = (iso) => vn(iso).slice(0, 5);
const hoursText = (h) => String(Math.round(Number(h) * 100) / 100).replace('.', ',');

export default function Payroll() {
  const { access } = useApp();
  const [state, setState] = useState('checking');     // checking | locked | open | nologin

  const check = useCallback(() => {
    api.get('/payroll/session')
      .then((s) => setState(!s.login_required ? 'nologin' : s.unlocked ? 'open' : 'locked'))
      .catch(() => setState('locked'));
  }, []);
  useEffect(() => { check(); }, [check]);

  if (access?.login_required === false || state === 'nologin') {
    return (
      <Page>
        <div className="card-pad max-w-lg mx-auto mt-8 text-center">
          <Lock size={22} className="text-muted-ink mx-auto mb-2" aria-hidden="true" />
          <h1 className="font-display font-bold text-base">Bảng lương đang đóng</h1>
          <p className="text-[13px] text-muted-ink mt-1 leading-relaxed">
            Tiệm đang tắt đăng nhập nên phần mềm không biết ai đang xem. Bảng lương chỉ mở khi bật lại bắt buộc
            đăng nhập ở <b>Thiết lập → Bán hàng</b>.
          </p>
        </div>
      </Page>
    );
  }
  if (state === 'checking') return <Spinner />;
  if (state === 'locked') return <UnlockScreen onUnlocked={() => setState('open')} />;
  return <PayrollHome onLocked={() => { setPayrollToken(''); setState('locked'); }} />;
}

/** Lỗi phiên hết hạn giữa chừng → quay về màn hình PIN thay vì báo lỗi khó hiểu. */
function useLockedGuard(error, onLocked) {
  useEffect(() => {
    if (error?.code === 'PAYROLL_LOCKED') onLocked();
  }, [error, onLocked]);
}

function useLoad(fn, deps) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(true);
  const reload = useCallback(() => {
    setBusy(true);
    fn().then((d) => { setData(d); setError(null); }).catch(setError).finally(() => setBusy(false));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload]);
  return { data, error, busy, reload };
}

/* ==================================================================== */

function PayrollHome({ onLocked }) {
  const [params, setParams] = useSearchParams();
  const selected = Number(params.get('nv')) || null;
  const [showAll, setShowAll] = useState(false);
  const meta = useLoad(() => api.get('/payroll/meta'), []);
  const list = useLoad(() => api.get('/payroll/employees', { all: showAll ? 1 : '' }), [showAll]);
  const [modal, setModal] = useState(null);   // { kind, employee }
  const [entryId, setEntryId] = useState(null);
  const [slipId, setSlipId] = useState(null);
  useLockedGuard(list.error || meta.error, onLocked);

  const lock = async () => {
    try { await api.post('/payroll/lock'); } catch { /* đằng nào cũng khoá ở máy này */ }
    onLocked();
  };
  const open = (id) => setParams(id ? { nv: String(id) } : {});
  const after = (entry) => {
    setModal(null);
    list.reload();
    if (entry?.type === 'advance' || (entry?.type === 'bonus' && !entry.merged)) setEntryId(entry.id);
  };

  if (selected) {
    return (
      <EmployeeDetail id={selected} onBack={() => { open(null); list.reload(); }} onLocked={onLocked}
        payrollMeta={meta.data} />
    );
  }

  const rows = list.data || [];
  const monthly = rows.filter((e) => e.pay_mode === 'monthly' && e.active);
  const dueList = rows.filter((e) => e.overview?.due_cycles?.length);
  const dailyDue = rows.filter((e) => e.overview?.daily?.unpaid_days > 0);
  const m = meta.data;

  return (
    <>
      <PageHeader
        title="Lương nhân viên"
        subtitle={m ? `Hôm nay ${vn(m.today)} · Âm lịch ${m.today_lunar.slice(0, 5)} năm ${m.lunar_year_name}` : 'Theo lịch Âm, gối đầu theo ngày vào làm'}
        actions={<>
          <Button icon={CalendarOff} onClick={() => setModal({ kind: 'closed' })}>Ngày tiệm nghỉ</Button>
          <Button icon={Cog} onClick={() => setModal({ kind: 'settings' })} disabled={!m}>Thiết lập</Button>
          <Button icon={Lock} onClick={lock}>Khoá</Button>
          <Button variant="primary" icon={UserRoundPlus} onClick={() => setModal({ kind: 'employee' })}>Thêm nhân viên</Button>
        </>}
      />
      <Page className="space-y-3">
        {(dueList.length > 0 || dailyDue.length > 0) && (
          <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-1.5">
            {dueList.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2 text-[13px] text-amber-950">
                <AlertTriangle size={15} className="shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0">
                  <b>{e.full_name}</b> có {e.overview.due_cycles.length} kỳ đã hết chưa chốt lương
                  ({e.overview.due_cycles.map((c) => c.label.replace(/ năm \d+$/, '')).join(', ')})
                </span>
                <Button size="sm" onClick={() => open(e.id)}>
                  {e.overview.due_cycles.length > 1 ? `Chốt gộp ${e.overview.due_cycles.length} kỳ` : 'Chốt lương'}
                </Button>
              </div>
            ))}
            {dailyDue.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2 text-[13px] text-amber-950">
                <Clock size={15} className="shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0">
                  <b>{e.full_name}</b> chưa trả lương {e.overview.daily.unpaid_days} ngày — {money(e.overview.daily.pay)}
                </span>
                <Button size="sm" onClick={() => open(e.id)}>Trả lương ngày</Button>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
          <Stat label="Đang làm" value={n(rows.filter((e) => e.active).length)} icon={IdCard} />
          <Stat label="Tạm tính kỳ này" icon={Wallet}
            value={money(monthly.reduce((a, e) => a + (e.overview?.current?.net || 0), 0))} sub="lương tháng, đã trừ ứng / nghỉ" />
          <Stat label="Đã ứng + mua trong kỳ" icon={HandCoins} tone="warn"
            value={money(-monthly.reduce((a, e) => a + (e.overview?.current?.advance_purchase || 0), 0))} />
          <Stat label="Kỳ chưa chốt" icon={AlertTriangle} tone={dueList.length ? 'warn' : 'default'}
            value={n(rows.reduce((a, e) => a + (e.overview?.due_cycles?.length || 0), 0))} />
        </div>

        <div className="flex items-center justify-between">
          <h2 className="font-bold text-sm">Nhân viên</h2>
          <label className="flex items-center gap-2 text-[13px] cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-emerald-700" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Hiện cả người đã nghỉ việc
          </label>
        </div>

        {list.busy && !list.data ? <Spinner />
          : list.error ? <ErrorBox error={list.error} onRetry={list.reload} />
            : rows.length === 0 ? (
              <Empty icon={IdCard} title="Chưa có nhân viên nào"
                message="Thêm hồ sơ nhân viên: ngày vào làm, lương tháng, giờ làm. Phần mềm tự chia kỳ lương theo lịch Âm."
                action={<Button variant="primary" icon={UserRoundPlus} onClick={() => setModal({ kind: 'employee' })}>Thêm nhân viên</Button>} />
            ) : (
              <>
                {/* Máy tính: bảng đủ cột */}
                <div className="table-wrap hidden md:block">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Nhân viên</th>
                        <th>Kỳ lương hiện tại</th>
                        <th className="text-right">Lương</th>
                        <th className="text-right">Nghỉ</th>
                        <th className="text-right">Ứng + mua</th>
                        <th className="text-right">Tạm tính</th>
                        <th style={{ width: 260 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((e) => {
                        const o = e.overview || {};
                        const c = o.current;
                        return (
                          <tr key={e.id} className="hoverable clickable" onClick={() => open(e.id)}>
                            <td>
                              <div className="font-semibold">{e.full_name}</div>
                              <div className="text-2xs text-muted-ink">
                                {e.code}{e.phone ? ` · ${e.phone}` : ''} · {e.work_from}–{e.work_to}
                                {!e.active && <Badge tone="mute" className="ml-1">Đã nghỉ</Badge>}
                              </div>
                            </td>
                            <td>
                              {e.pay_mode === 'daily' ? (
                                <span className="text-[13px]">Trả theo ngày · chưa trả {n(o.daily?.unpaid_days || 0)} ngày</span>
                              ) : c ? (
                                <>
                                  <div className="text-[13px]">Kỳ {c.label.replace(/ năm \d+$/, '')}</div>
                                  <div className="text-2xs text-muted-ink">{c.lunar_from.slice(0, 5)} → {c.lunar_to.slice(0, 5)} Âm · {dm(c.date_from)} – {dm(c.date_to)}</div>
                                </>
                              ) : <span className="text-2xs text-muted-ink">{o.not_started ? `Tính lương từ ${vn(e.track_from)}` : '—'}</span>}
                              {o.due_cycles?.length > 0 && <Badge tone="warn" className="mt-0.5">{o.due_cycles.length} kỳ chờ chốt</Badge>}
                            </td>
                            <td className="text-right tabular">{e.pay_mode === 'daily' ? `${n(o.day_rate)}/ngày` : n(e.monthly_wage)}</td>
                            <td className="text-right tabular">{c ? n(c.absent_days) : '—'}</td>
                            <td className="text-right tabular text-danger">{c && c.advance_purchase ? n(-c.advance_purchase) : '—'}</td>
                            <td className="text-right tabular font-bold">
                              {e.pay_mode === 'daily' ? money(o.daily?.pay || 0) : c ? money(c.net) : '—'}
                            </td>
                            <td onClick={(ev) => ev.stopPropagation()}>
                              {e.active ? (
                                <div className="flex gap-1 justify-end">
                                  <Button size="sm" icon={CalendarX} onClick={() => setModal({ kind: 'absence', employee: e })}>Báo nghỉ</Button>
                                  <Button size="sm" icon={HandCoins} onClick={() => setModal({ kind: 'advance', employee: e })}>Ứng tiền</Button>
                                  <Button size="sm" icon={Gift} onClick={() => setModal({ kind: 'bonus', employee: e })}>Thưởng</Button>
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Điện thoại: thẻ cuộn dọc, nút to một ngón tay */}
                <ul className="space-y-2 md:hidden">
                  {rows.map((e) => {
                    const o = e.overview || {};
                    const c = o.current;
                    return (
                      <li key={e.id} className="card">
                        <button type="button" onClick={() => open(e.id)} className="w-full text-left p-3 flex items-start gap-2">
                          <span className="flex-1 min-w-0">
                            <span className="font-bold block">{e.full_name}{!e.active && <Badge tone="mute" className="ml-1">Đã nghỉ</Badge>}</span>
                            <span className="text-2xs text-muted-ink block">
                              {e.pay_mode === 'daily' ? `Trả theo ngày · ${n(o.day_rate)} đ/ngày`
                                : c ? `Kỳ ${c.label.replace(/ năm \d+$/, '')} · ${c.lunar_from.slice(0, 5)} → ${c.lunar_to.slice(0, 5)} Âm` : e.code}
                            </span>
                            {c?.advance_purchase ? <span className="text-2xs text-danger block">Đã ứng + mua {money(-c.advance_purchase)}</span> : null}
                            {o.due_cycles?.length > 0 && <Badge tone="warn" className="mt-1">{o.due_cycles.length} kỳ chờ chốt</Badge>}
                          </span>
                          <span className="text-right">
                            <span className="text-2xs text-muted-ink block">{e.pay_mode === 'daily' ? 'Chưa trả' : 'Tạm tính'}</span>
                            <span className="font-display font-bold text-lg tabular">
                              {e.pay_mode === 'daily' ? money(o.daily?.pay || 0) : c ? money(c.net) : '—'}
                            </span>
                          </span>
                        </button>
                        {e.active ? (
                          <div className="grid grid-cols-3 gap-1.5 px-3 pb-3">
                            <Button className="btn-touch !flex-col !gap-0.5 text-2xs" icon={CalendarX} onClick={() => setModal({ kind: 'absence', employee: e })}>Báo nghỉ</Button>
                            <Button className="btn-touch !flex-col !gap-0.5 text-2xs" icon={HandCoins} onClick={() => setModal({ kind: 'advance', employee: e })}>Ứng tiền</Button>
                            <Button className="btn-touch !flex-col !gap-0.5 text-2xs" icon={Gift} onClick={() => setModal({ kind: 'bonus', employee: e })}>Thưởng</Button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
      </Page>

      {modal?.kind === 'employee' && (
        <EmployeeForm onClose={() => setModal(null)} onSaved={(e) => { setModal(null); list.reload(); open(e.id); }} />
      )}
      {modal?.kind === 'absence' && <AbsenceModal employee={modal.employee} onClose={() => setModal(null)} onSaved={after} />}
      {modal?.kind === 'advance' && <AdvanceModal employee={modal.employee} onClose={() => setModal(null)} onSaved={after} />}
      {modal?.kind === 'bonus' && <BonusModal employee={modal.employee} onClose={() => setModal(null)} onSaved={after} />}
      {modal?.kind === 'closed' && (
        <ClosedDaysModal lunarYear={m?.lunar_year || new Date().getFullYear()} onClose={() => setModal(null)} onChanged={list.reload} />
      )}
      {modal?.kind === 'settings' && m && (
        <PayrollSettingsModal meta={m} onClose={() => setModal(null)} onSaved={() => { meta.reload(); setModal(null); }} />
      )}
      <EntryModal entryId={entryId} onClose={() => setEntryId(null)} onChanged={list.reload} />
      <PayslipModal settlementId={slipId} onClose={() => setSlipId(null)} onUndone={() => { setSlipId(null); list.reload(); }} />
    </>
  );
}

/* ==================================================================== */
/* Hồ sơ lương một người                                                 */
/* ==================================================================== */

const STATUS = {
  running: { label: 'Đang chạy', tone: 'info' },
  due: { label: 'Đã hết — chờ chốt', tone: 'warn' },
  closed: { label: 'Đã chốt', tone: 'mute' },
};

function EmployeeDetail({ id, onBack, onLocked, payrollMeta }) {
  const { toast } = useApp();
  const d = useLoad(() => api.get(`/payroll/employees/${id}`), [id]);
  const [modal, setModal] = useState(null);
  const [entryId, setEntryId] = useState(null);
  const [slipId, setSlipId] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [delEntry, setDelEntry] = useState(null);
  useLockedGuard(d.error, onLocked);

  const e = d.data;
  if (d.busy && !e) return <Spinner />;
  if (d.error) return <Page><ErrorBox error={d.error} onRetry={d.reload} /></Page>;
  if (!e) return null;

  const done = (entry) => {
    setModal(null);
    d.reload();
    if (entry?.type === 'advance' || (entry?.type === 'bonus' && !entry.merged)) setEntryId(entry.id);
  };
  const settled = (s) => { setModal(null); d.reload(); setSlipId(s.id); toast(`Đã chốt lương ${s.code}`, 'ok'); };
  const daily = e.pay_mode === 'daily';
  const o = e.overview || {};
  const openCycles = (e.cycles || []).filter((c) => c.status === 'open');
  const due = o.due_cycles || [];
  const isOpen = (c) => expanded[c.id] ?? (c.status === 'open' && (!c.ended || due.length > 0));

  const toggleCounted = async (entry) => {
    try {
      await api.put(`/payroll/entries/${entry.id}`, { counted: !entry.counted });
      d.reload();
    } catch (err) { toast(err.message, 'bad'); }
  };

  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={ChevronLeft} onClick={onBack} aria-label="Về danh sách nhân viên" />
          {e.full_name}
          {!e.active && <Badge tone="mute">Đã nghỉ</Badge>}
        </span>}
        subtitle={`${e.code} · ${daily ? 'Trả lương theo ngày' : 'Trả lương theo tháng, gối đầu'} · ${e.work_from}–${e.work_to} (${hoursText(e.hours_per_day)} giờ)`}
        actions={<Button icon={Pencil} onClick={() => setModal({ kind: 'edit' })}>Sửa hồ sơ</Button>}
      />
      <Page className="space-y-3">
        <div className="card p-3 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
          <div>Vào làm: <b>{vn(e.start_date)}</b> <span className="text-muted-ink">(Âm {e.start_lunar})</span></div>
          <div>{daily ? 'Lương ngày' : 'Lương tháng'}: <b className="tabular">{daily ? money(o.day_rate) : money(e.monthly_wage)}</b></div>
          <div>1 ngày {money(o.day_rate)} · 1 giờ {money(o.hour_rate)}</div>
          <div>{daily ? 'Tính lương từ' : `Gối đầu ${e.cycle_day <= 10 ? 'mùng' : 'ngày'} ${e.cycle_day} Âm · tính từ`} <b>{vn(e.track_from)}</b></div>
          {e.end_date && <div className="text-danger">Nghỉ việc sau ngày {vn(e.end_date)}</div>}
          {e.phone && <div>ĐT: <a className="underline" href={`tel:${e.phone}`}>{e.phone}</a></div>}
        </div>

        {e.active && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Button className="btn-touch" icon={CalendarX} onClick={() => setModal({ kind: 'absence' })}>Báo nghỉ</Button>
            <Button className="btn-touch" icon={HandCoins} onClick={() => setModal({ kind: 'advance' })}>Ứng tiền</Button>
            <Button className="btn-touch" icon={Gift} onClick={() => setModal({ kind: 'bonus' })}>Thưởng</Button>
            <Button className="btn-touch" icon={CirclePlus} onClick={() => setModal({ kind: 'adjust' })}>Cộng / trừ khác</Button>
          </div>
        )}

        {e.carry_in < 0 && (
          <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[13px] text-amber-900">
            Còn nợ từ phiếu lương trước: <b className="tabular">{money(-e.carry_in)}</b> — tự cấn trừ vào lần trả lương tới.
          </p>
        )}

        {daily ? (
          <DailyPanel e={e} onPay={() => setModal({ kind: 'daily' })} onEntry={setEntryId}
            onDelete={setDelEntry} onToggle={toggleCounted} />
        ) : (
          <>
            {openCycles.length > 0 && (
              <div className={`rounded-lg border p-3 flex flex-wrap items-center gap-2 ${due.length ? 'border-amber-300 bg-amber-50' : 'border-line bg-card'}`}>
                <span className="flex-1 min-w-0 text-[13px]">
                  {due.length
                    ? <><b>{due.length} kỳ đã hết chưa chốt lương.</b> Chốt gộp ra một phiếu lương liệt kê riêng từng kỳ.</>
                    : 'Kỳ đang chạy chưa hết. Chốt sớm được nếu cần trả lương trước (ví dụ trước Tết).'}
                </span>
                <Button variant={due.length ? 'primary' : 'outline'} icon={Wallet} onClick={() => setModal({ kind: 'settle' })}>
                  {due.length > 1 ? `Chốt gộp ${due.length} kỳ` : due.length ? 'Chốt lương' : 'Chốt sớm'}
                </Button>
              </div>
            )}
            <section aria-label="Các kỳ lương" className="space-y-2">
              {(e.cycles || []).map((c) => {
                const st = c.status === 'closed' ? 'closed' : c.ended ? 'due' : 'running';
                const shown = isOpen(c);
                return (
                  <div key={c.id} className="card">
                    <button type="button" className="w-full text-left p-3 flex items-center gap-2"
                      aria-expanded={shown} onClick={() => setExpanded((x) => ({ ...x, [c.id]: !shown }))}>
                      {shown ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                      <span className="flex-1 min-w-0">
                        <span className="font-bold">Kỳ {c.label}</span>
                        <Badge tone={STATUS[st].tone} className="ml-2">{STATUS[st].label}</Badge>
                        {c.is_partial ? <Badge tone="mute" className="ml-1">Kỳ lẻ {c.work_days}/{c.days} ngày</Badge> : null}
                        <span className="block text-2xs text-muted-ink">
                          {c.lunar_from.slice(0, 5)} → {c.lunar_to.slice(0, 5)} Âm · {vn(c.date_from)} – {vn(c.date_to)} · tháng {c.days === 29 ? 'thiếu' : 'đủ'}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="text-2xs text-muted-ink block">{c.status === 'closed' ? 'Thực nhận' : 'Tạm tính'}</span>
                        <b className={`tabular ${c.net < 0 ? 'text-danger' : ''}`}>{money(c.net)}</b>
                      </span>
                    </button>
                    {shown && (
                      <div className="px-3 pb-3 border-t border-line pt-2">
                        <CycleLines c={c} onEntry={setEntryId} onDelete={setDelEntry} onToggle={toggleCounted} />
                        {c.settlement_id && (
                          <Button size="sm" className="mt-2" icon={Receipt} onClick={() => setSlipId(c.settlement_id)}>Xem phiếu lương</Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          </>
        )}

        <AttendanceCard e={e} payrollMeta={payrollMeta} onChanged={d.reload} />

        {e.settlements?.length > 0 && (
          <section className="card p-3">
            <h2 className="font-bold text-sm mb-2">Phiếu lương đã trả</h2>
            <ul className="divide-y divide-line">
              {e.settlements.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => setSlipId(s.id)}
                    className="w-full text-left flex items-center gap-2 py-2 min-h-[44px] hover:bg-muted/50 rounded px-1">
                    <Receipt size={15} className="text-muted-ink shrink-0" aria-hidden="true" />
                    <span className="flex-1 min-w-0 text-[13px]">
                      <b className="font-mono">{s.code}</b> · {datetime(s.ts)}
                      <span className="block text-2xs text-muted-ink">
                        {s.kind === 'daily' ? 'Lương ngày' : 'Lương kỳ'} {s.date_from ? `${vn(s.date_from)} – ${vn(s.date_to)}` : ''}
                        {s.carry_out < 0 ? ` · còn nợ ${money(-s.carry_out)}` : ''}
                      </span>
                    </span>
                    <b className="tabular">{money(s.pay_amount)}</b>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </Page>

      {modal?.kind === 'edit' && (
        <EmployeeForm employee={e} onClose={() => setModal(null)} onSaved={() => { setModal(null); d.reload(); }} />
      )}
      {modal?.kind === 'absence' && <AbsenceModal employee={e} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === 'advance' && <AdvanceModal employee={e} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === 'bonus' && <BonusModal employee={e} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === 'adjust' && <AdjustModal employee={e} onClose={() => setModal(null)} onSaved={done} />}
      {modal?.kind === 'settle' && (
        <SettleModal employee={e} cycles={e.cycles} carryIn={e.carry_in} onClose={() => setModal(null)} onDone={settled} />
      )}
      {modal?.kind === 'daily' && e.daily && (
        <DailyPayModal employee={e} due={e.daily} onClose={() => setModal(null)} onDone={settled} />
      )}
      <EntryModal entryId={entryId} onClose={() => setEntryId(null)} onChanged={d.reload} />
      <PayslipModal settlementId={slipId} onClose={() => setSlipId(null)} onUndone={() => { setSlipId(null); d.reload(); }} />
      <Confirm
        open={!!delEntry}
        onClose={() => setDelEntry(null)}
        title={delEntry ? `Xoá "${delEntry.label}" ngày ${vn(delEntry.work_date)}?` : ''}
        message={delEntry?.cash_tx_id
          ? 'Phiếu chi quỹ đi kèm cũng bị xoá, tiền trong sổ quỹ về như chưa chi. Chỉ xoá khi ghi nhầm.'
          : delEntry?.type === 'closed_day' ? 'Người này vẫn đi làm ngày tiệm nghỉ — tính lương ngày đó bình thường.'
            : 'Xoá khỏi sổ lương. Chỉ xoá khi ghi nhầm.'}
        confirmText="Xoá"
        onConfirm={async () => {
          try {
            await api.del(`/payroll/entries/${delEntry.id}`);
            setDelEntry(null);
            d.reload();
          } catch (err) { toast(err.message, 'bad', 6000); }
        }}
      />
    </>
  );
}

/** Các dòng tiền của một kỳ, xếp như phiếu lương — dòng chưa chốt thì xoá / cho qua được. */
function CycleLines({ c, onEntry, onDelete, onToggle }) {
  const s = c.summary || {};
  return (
    <div className="text-[13px] space-y-1">
      <Line label={c.is_partial ? `Lương ${n(c.work_days)} ngày (kỳ lẻ)` : 'Lương tháng'} amount={c.base} />
      {c.gift_day && (
        <div className="bg-emerald-50 border-l-4 border-emerald-600 px-2 py-1 rounded-r font-semibold text-emerald-900">
          Số ngày chủ tặng thêm: +1 ngày công (Tháng thiếu)
        </div>
      )}
      <EntryList entries={c.entries} locked={c.status === 'closed'} onEntry={onEntry} onDelete={onDelete} onToggle={onToggle} />
      {s.bonus_separate > 0 && (
        <p className="text-2xs text-muted-ink italic">Thưởng đưa tiền mặt ngay {money(s.bonus_separate)} — đã chi, không cộng vào thực nhận.</p>
      )}
      <div className="flex justify-between border-t border-line pt-1 font-bold">
        <span>{c.status === 'closed' ? 'Thực nhận kỳ này' : c.ended ? 'Cộng kỳ này (chờ chốt)' : 'Tạm tính cả kỳ'}</span>
        <span className={`tabular ${c.net < 0 ? 'text-danger' : ''}`}>{money(c.net)}</span>
      </div>
    </div>
  );
}

function Line({ label, amount, muted }) {
  return (
    <div className={`flex justify-between gap-2 ${muted ? 'text-muted-ink' : ''}`}>
      <span className="min-w-0">{label}</span>
      <span className={`tabular whitespace-nowrap ${amount < 0 ? 'text-danger' : ''}`}>{signedMoney(amount)}</span>
    </div>
  );
}

function EntryList({ entries, locked, onEntry, onDelete, onToggle }) {
  if (!entries?.length) return <p className="text-2xs text-muted-ink">Không có biến động nào — đi làm đủ.</p>;
  return (
    <ul className="divide-y divide-line/70">
      {entries.map((x) => {
        const canDelete = !locked && !x.settlement_id && x.type !== 'purchase' && x.type !== 'wage';
        const label = x.type === 'absent_hour' ? `Nghỉ ${hoursText(x.hours)} giờ${x.counted ? '' : ' — chủ cho qua'}`
          : x.type === 'purchase' ? (x.amount < 0 ? `Mua hàng ghi sổ ${x.ref_code || ''}` : `Hoàn tiền hàng ${x.ref_code || ''}`)
            : x.type === 'bonus' ? `Thưởng${x.merged ? '' : ' (đưa tiền ngay)'}`
              : x.label;
        return (
          <li key={x.id} className="flex items-center gap-2 py-1.5">
            <span className="text-2xs text-muted-ink w-11 shrink-0 tabular">{dm(x.work_date)}</span>
            <button type="button" className="flex-1 min-w-0 text-left hover:underline" onClick={() => onEntry(x.id)}>
              <span className={x.type === 'absent_hour' && !x.counted ? 'text-muted-ink' : ''}>{label}</span>
              {x.reason && <span className="text-2xs text-muted-ink block truncate">{x.reason}</span>}
            </button>
            {x.photo_count > 0 && <Camera size={13} className="text-emerald-700 shrink-0" aria-label={`${x.photo_count} ảnh`} />}
            {x.type === 'absent_hour' && !x.settlement_id && !locked && (
              <Button size="sm" variant="ghost" onClick={() => onToggle(x)}>{x.counted ? 'Cho qua' : 'Tính trừ'}</Button>
            )}
            <span className={`tabular whitespace-nowrap ${x.type === 'bonus' && !x.merged ? 'text-muted-ink line-through' : x.amount < 0 ? 'text-danger' : ''}`}>
              {signedMoney(x.amount)}
            </span>
            {canDelete && (
              <Button size="sm" variant="ghost" icon={Trash2} aria-label={`Xoá ${label} ngày ${dm(x.work_date)}`} onClick={() => onDelete(x)} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function DailyPanel({ e, onPay, onEntry, onDelete, onToggle }) {
  const dd = e.daily;
  if (!dd) return null;
  return (
    <section className="card p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-sm">Chưa trả lương</h2>
          <p className="text-2xs text-muted-ink">Đã trả tới hết ngày {vn(dd.paid_through)}</p>
        </div>
        <div className="text-right">
          <div className="text-2xs text-muted-ink">Cần trả</div>
          <div className="font-display font-bold text-xl tabular">{money(dd.pay)}</div>
        </div>
        <Button variant="primary" size="lg" icon={Wallet} onClick={onPay} disabled={!dd.days.length && !dd.entries.length}>
          Đã trả lương ngày
        </Button>
      </div>
      {dd.days.length > 0 && (
        <ul className="grid gap-1 sm:grid-cols-2 text-[13px]">
          {dd.days.map((x) => (
            <li key={x.date} className="flex justify-between rounded border border-line px-2 py-1">
              <span>{vn(x.date)} <span className="text-2xs text-muted-ink">(Âm {x.lunar})</span></span>
              <span className={x.status === 'work' ? 'tabular' : 'text-muted-ink'}>
                {x.status === 'work' ? money(x.wage) : x.status === 'closed' ? 'Tiệm nghỉ' : 'Nghỉ'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <EntryList entries={dd.entries} locked={false} onEntry={onEntry} onDelete={onDelete} onToggle={onToggle} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Thưởng chuyên cần theo năm Âm lịch (28-3)                           */
/* ------------------------------------------------------------------ */

function AttendanceCard({ e, payrollMeta, onChanged }) {
  const { toast } = useApp();
  const year = payrollMeta?.lunar_year;
  const [st, setSt] = useState(null);
  const [amount, setAmount] = useState(0);
  const [merged, setMerged] = useState(true);
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    if (!year) return;
    api.get(`/payroll/employees/${e.id}/attendance`, { year }).then((s) => { setSt(s); setAmount(s.suggest_amount); }).catch(() => setSt(null));
  }, [e.id, year]);
  useEffect(() => { load(); }, [load]);
  if (!st) return null;

  const decide = async (decision) => {
    setBusy(decision);
    try {
      await api.post(`/payroll/employees/${e.id}/attendance`, { year: st.year, decision, amount, merged });
      toast(decision === 'approve' ? 'Đã ghi thưởng chuyên cần' : 'Đã ghi: không thưởng năm nay', 'ok');
      load();
      onChanged?.();
    } catch (err) {
      toast(err.message, 'bad', 6000);
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="card p-3 space-y-2 text-[13px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold text-sm">Chuyên cần năm Âm lịch {st.year}</h2>
        <span className="text-2xs text-muted-ink">{vn(st.from)} – {vn(st.to)} · {st.months} tháng</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span>Nghỉ cả ngày: <b>{n(st.absent_days)}</b></span>
        <span>Tiệm nghỉ: <b>{n(st.closed_days)}</b>{st.count_closed_days ? ' (có tính)' : ' (không tính)'}</span>
        <span>Nghỉ theo giờ: <b>{hoursText(st.absent_hours)}</b> giờ (không tính)</span>
        <span>Ngưỡng: <b>{n(st.threshold)}</b> ngày</span>
      </div>
      {st.award ? (
        <p className={st.award.decision === 'approve' ? 'text-emerald-800 font-semibold' : 'text-muted-ink'}>
          {st.award.decision === 'approve'
            ? `Đã thưởng ${money(st.award.amount)}${st.award.note ? ` — ${st.award.note}` : ''}`
            : 'Đã quyết định không thưởng năm này.'}
          {' '}<span className="text-2xs font-normal text-muted-ink">({st.award.user_name || ''} · {datetime(st.award.ts)})</span>
        </p>
      ) : !st.is_open ? (
        <p className="text-muted-ink">Tới tháng cuối năm Âm lịch ({vn(st.open_from)}) sẽ mở xét thưởng. Đang tính {n(st.counted_days)}/{n(st.threshold)} ngày.</p>
      ) : (
        <div className="space-y-2">
          {st.eligible ? (
            <p className="text-emerald-800 font-semibold">Nghỉ {n(st.counted_days)} ngày, không quá {n(st.threshold)} — gợi ý thưởng một tháng lương.</p>
          ) : (
            <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
              <AlertTriangle size={14} className="inline mr-1" aria-hidden="true" />
              Nghỉ {n(st.counted_days)} ngày, quá ngưỡng {n(st.threshold)}. Chủ vẫn quyết được.
            </p>
          )}
          {(st.joined_mid_year || st.started_tracking_mid_year) && (
            <p className="text-2xs text-muted-ink">Vào làm hoặc bắt đầu tính lương giữa năm — số ngày nghỉ chỉ đếm từ ngày đó, chủ cân nhắc mức thưởng.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5">
              Thưởng
              <input className="field field-sm num !w-32" inputMode="numeric" value={n(amount)}
                onChange={(ev) => setAmount(Number(ev.target.value.replace(/\D/g, '')) || 0)} aria-label="Số tiền thưởng chuyên cần" />
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-emerald-700" checked={merged} onChange={(ev) => setMerged(ev.target.checked)} />
              Gộp vào lương
            </label>
            <Button variant="primary" loading={busy === 'approve'} disabled={!(amount > 0)} onClick={() => decide('approve')}>
              {st.eligible ? 'Duyệt thưởng' : 'Vẫn duyệt thưởng (Chủ cho qua)'}
            </Button>
            <Button loading={busy === 'reject'} onClick={() => decide('reject')}>Không thưởng</Button>
          </div>
        </div>
      )}
    </section>
  );
}
