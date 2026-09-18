/* ====================================================================
   API LƯƠNG NHÂN VIÊN (plan 28)

   Ba lớp chặn (§2.4):
     1. access-map: mọi /payroll/* cần quyền payroll.manage (chủ + quản lý,
        chủ tiệm chốt 28-1). Riêng danh sách TÊN nhân viên cho màn hình bán
        hàng thì theo quyền bán hàng, và chỉ trả id + tên.
     2. Tiệm tắt đăng nhập thì cả module đóng: không có ai để phân quyền.
     3. Mở bảng lương phải gõ mã PIN chủ / quản lý, mỗi phiên một lần.
   ==================================================================== */
import { Router } from 'express';
import { all, get, setSetting, getSettings } from '../db.js';
import { isLoginRequired } from '../guard.js';
import { verifyPin } from '../policy.js';
import {
  openSession, touchSession, closeSession, payrollSettings, getEmployee, createEmployee, updateEmployee,
  deleteEmployee, employeeOverview, computeCycle, addAbsence, setCounted, addAdvance, addBonus, addAdjustment,
  entryDetail, deleteEntry, savePhotos, deletePhoto, photoFilePath, payrollPhotoUsage, cleanupPayrollPhotos,
  settleCycles, dailyDue, payDaily, settlementDetail, undoSettlement, addClosedDays, removeClosedDay,
  attendanceStatus, decideAward, undoAward, ensureCycles, today, lastCarry, paidThrough,
} from '../payroll.js';
import { solarToLunar, lunarText, cycleContaining, canChi, lunarYearRange } from '../../client/src/lib/lunar.js';

const r = Router();

const fail = (res, e) => {
  if (!e.status) console.error('[lương]', e);
  res.status(e.status || 500).json({ error: e.message, code: e.code });
};
const wrap = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (e) { fail(res, e); }
};

/* ---------------------------- Lớp 2 + mở khoá ---------------------------- */

const needLogin = (res) => res.status(403).json({
  error: 'Bảng lương chỉ mở khi tiệm bật bắt buộc đăng nhập (Thiết lập → Bán hàng). Tắt đăng nhập thì không '
    + 'phân biệt được ai đang xem.',
  code: 'PAYROLL_NEEDS_LOGIN',
});

r.get('/payroll/session', (req, res) => {
  if (!isLoginRequired()) return res.json({ login_required: false, unlocked: false });
  const s = touchSession(req.get('x-payroll-token'), req.user?.id);
  res.json({ login_required: true, unlocked: !!s, approver: s?.approver || null });
});

r.post('/payroll/unlock', (req, res) => {
  if (!isLoginRequired()) return needLogin(res);
  if (!req.user) return res.status(401).json({ error: 'Chưa đăng nhập', code: 'NO_AUTH' });
  try {
    const approver = verifyPin(req.body?.pin, `payroll:u${req.user.id}@${req.ip || ''}`);
    res.json(openSession(req.user.id, { id: approver.id, full_name: approver.full_name, role: approver.role }));
  } catch (e) { fail(res, e); }
});

r.post('/payroll/lock', (req, res) => {
  closeSession(req.get('x-payroll-token'));
  res.json({ ok: true });
});

/** Màn hình bán hàng chọn người mua trừ lương: CHỈ id và tên — không lương, không số dư (§9). */
r.get('/payroll/employee-names', (req, res) => {
  if (!isLoginRequired()) return res.json([]);
  res.json(all(`SELECT id, full_name FROM employees WHERE active = 1
                AND (end_date IS NULL OR end_date >= date('now','localtime')) ORDER BY full_name`));
});

/* Mọi đường còn lại: phải có phiên mở bằng PIN, đúng người đã mở */
r.use('/payroll', (req, res, next) => {
  if (!isLoginRequired()) return needLogin(res);
  const token = req.get('x-payroll-token') || req.query.pt;
  if (!req.user || !touchSession(token, req.user.id)) {
    return res.status(403).json({ error: 'Bảng lương đang khoá. Nhập mã PIN để mở.', code: 'PAYROLL_LOCKED' });
  }
  next();
});

/* ------------------------------- Thiết lập ------------------------------- */

r.get('/payroll/meta', wrap(() => {
  const t = today();
  const l = solarToLunar(t);
  return {
    today: t, today_lunar: lunarText(l, true), lunar_year: l.year, lunar_year_name: canChi(l.year),
    settings: payrollSettings(), photo_usage: payrollPhotoUsage(),
  };
}));

r.put('/payroll/settings', wrap((req) => {
  const b = req.body || {};
  const cur = getSettings().payroll || {};
  const next = { ...cur };
  if (b.absent_threshold !== undefined) next.absent_threshold = Math.max(0, Math.round(Number(b.absent_threshold) || 0));
  if (b.count_closed_days !== undefined) next.count_closed_days = b.count_closed_days === true;
  if (b.photo_keep_months !== undefined) next.photo_keep_months = Math.max(0, Math.round(Number(b.photo_keep_months) || 0));
  setSetting('payroll', next);
  return payrollSettings();
}));

/** Xem trước ngày Âm và kỳ lương khi đang điền hồ sơ. */
r.get('/payroll/cycle-preview', wrap((req) => {
  const start = String(req.query.start_date || today());
  const l = solarToLunar(start);
  const anchor = Math.round(Number(req.query.cycle_day)) || l.day;
  const first = cycleContaining(start, anchor);
  const current = cycleContaining(today(), anchor);
  return { start_lunar: lunarText(l, true), cycle_day: anchor, first, current };
}));

/* ------------------------------- Nhân viên ------------------------------- */

r.get('/payroll/employees', wrap((req) => {
  const rows = all(`SELECT * FROM employees ${req.query.all === '1' ? '' : 'WHERE active = 1'}
                    ORDER BY active DESC, full_name`);
  return rows.map((row) => {
    const emp = getEmployee(row.id);
    return { ...emp, overview: employeeOverview(emp) };
  });
}));

r.post('/payroll/employees', wrap((req) => createEmployee(req.body || {}, req.user)));

r.get('/payroll/employees/:id', wrap((req) => {
  const emp = getEmployee(req.params.id);
  const overview = employeeOverview(emp);
  if (emp.active && emp.track_from <= today()) ensureCycles(emp, today() < (emp.end_date || '9999') ? today() : emp.end_date);
  const cycles = all('SELECT * FROM payroll_cycles WHERE employee_id = ? ORDER BY date_from DESC LIMIT 36', [emp.id])
    .map((c) => computeCycle(c, emp));
  const settlements = all(`SELECT st.id, st.code, st.ts, st.kind, st.date_from, st.date_to, st.carry_in, st.earned,
                                  st.pay_amount, st.carry_out, u.full_name AS user_name
                           FROM payroll_settlements st LEFT JOIN users u ON u.id = st.user_id
                           WHERE st.employee_id = ? ORDER BY st.id DESC LIMIT 60`, [emp.id]);
  const user = emp.user_id ? get('SELECT id, full_name, username FROM users WHERE id = ?', [emp.user_id]) : null;
  return {
    ...emp, user, overview, cycles, settlements, carry_in: lastCarry(emp.id),
    /* Đã ghi gì vào sổ lương chưa — form sửa hồ sơ khoá ô ngày vào làm (máy chủ cũng chặn) */
    has_history: settlements.length > 0 || !!get('SELECT 1 FROM payroll_entries WHERE employee_id = ? LIMIT 1', [emp.id]),
    daily: emp.pay_mode === 'daily' ? { ...dailyDue(emp), paid_through: paidThrough(emp) } : null,
  };
}));

r.put('/payroll/employees/:id', wrap((req) => updateEmployee(Number(req.params.id), req.body || {}, req.user)));
r.delete('/payroll/employees/:id', wrap((req) => { deleteEmployee(Number(req.params.id), req.user); return { ok: true }; }));

r.get('/payroll/cycles/:id', wrap((req) => {
  const c = get('SELECT * FROM payroll_cycles WHERE id = ?', [req.params.id]);
  if (!c) throw Object.assign(new Error('Không tìm thấy kỳ lương'), { status: 404 });
  const emp = getEmployee(c.employee_id);
  return { employee: { id: emp.id, code: emp.code, full_name: emp.full_name, pay_mode: emp.pay_mode }, cycle: computeCycle(c, emp) };
}));

/* ----------------------------- Sổ lương ----------------------------- */

r.post('/payroll/employees/:id/absences', wrap((req) => addAbsence(Number(req.params.id), req.body || {}, req.user)));
r.post('/payroll/employees/:id/advances', wrap((req) => addAdvance(Number(req.params.id), req.body || {}, req.user)));
r.post('/payroll/employees/:id/bonuses', wrap((req) => addBonus(Number(req.params.id), req.body || {}, req.user)));
r.post('/payroll/employees/:id/adjustments', wrap((req) => addAdjustment(Number(req.params.id), req.body || {}, req.user)));

r.get('/payroll/entries/:id', wrap((req) => entryDetail(Number(req.params.id))));
r.put('/payroll/entries/:id', wrap((req) => setCounted(Number(req.params.id), req.body?.counted !== false, req.user)));
r.delete('/payroll/entries/:id', wrap((req) => deleteEntry(Number(req.params.id), req.user)));

r.post('/payroll/entries/:id/photos', wrap((req) => {
  const e = entryDetail(Number(req.params.id));
  const saved = savePhotos(e.id, req.body?.photos);
  if (!saved.length) throw Object.assign(new Error('Không lưu được ảnh nào (chỉ nhận ảnh JPG / PNG / WEBP dưới 6MB)'), { status: 400 });
  return entryDetail(e.id);
}));
r.delete('/payroll/photos/:id', wrap((req) => deletePhoto(Number(req.params.id))));
r.get('/payroll/photo/:file', (req, res) => {
  const full = photoFilePath(req.params.file);
  if (!full) return res.status(404).json({ error: 'Không tìm thấy ảnh' });
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(full);
});
r.get('/payroll/photo-usage', wrap(() => payrollPhotoUsage()));
r.post('/payroll/photos/cleanup', wrap((req) => {
  const out = cleanupPayrollPhotos(req.body?.months ?? 0);
  return {
    ...out,
    message: out.deleted
      ? `Đã xoá ${out.deleted} ảnh, giải phóng ${(out.freed / 1024 / 1024).toFixed(1)} MB.`
      : 'Không có ảnh nào của kỳ đã chốt cần dọn.',
  };
}));

/* ------------------------------ Trả lương ------------------------------ */

r.post('/payroll/employees/:id/settle', wrap((req) => settleCycles(Number(req.params.id), req.body || {}, req.user)));
r.get('/payroll/employees/:id/daily-due', wrap((req) => {
  const emp = getEmployee(req.params.id);
  return { ...dailyDue(emp, String(req.query.to || today())), paid_through: paidThrough(emp) };
}));
r.post('/payroll/employees/:id/pay-daily', wrap((req) => payDaily(Number(req.params.id), req.body || {}, req.user)));
r.get('/payroll/settlements/:id', wrap((req) => settlementDetail(Number(req.params.id))));
r.delete('/payroll/settlements/:id', wrap((req) => undoSettlement(Number(req.params.id), req.user)));

/* ---------------------------- Ngày tiệm nghỉ ---------------------------- */

r.get('/payroll/closed-days', wrap((req) => {
  const y = Math.round(Number(req.query.year)) || solarToLunar(today()).year;
  const range = lunarYearRange(y);
  const from = String(req.query.from || range.from);
  const to = String(req.query.to || range.to);
  return {
    year: y, from, to,
    rows: all(`SELECT d.date, d.note, d.ts, u.full_name AS user_name,
                      (SELECT COUNT(*) FROM payroll_entries x WHERE x.work_date = d.date AND x.type = 'closed_day') AS applied
               FROM payroll_closed_days d LEFT JOIN users u ON u.id = d.user_id
               WHERE d.date BETWEEN ? AND ? ORDER BY d.date`, [from, to])
      .map((d) => ({ ...d, lunar: lunarText(solarToLunar(d.date)) })),
  };
}));
r.post('/payroll/closed-days', wrap((req) => addClosedDays(req.body || {}, req.user)));
r.delete('/payroll/closed-days/:date', wrap((req) => removeClosedDay(String(req.params.date), req.user)));

/* ------------------------- Thưởng chuyên cần ------------------------- */

r.get('/payroll/employees/:id/attendance', wrap((req) =>
  attendanceStatus(getEmployee(req.params.id), req.query.year)));
r.post('/payroll/employees/:id/attendance', wrap((req) => decideAward(Number(req.params.id), req.body || {}, req.user)));
r.delete('/payroll/awards/:id', wrap((req) => undoAward(Number(req.params.id), req.user)));

export default r;
