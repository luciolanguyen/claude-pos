/* ====================================================================
   LƯƠNG NHÂN VIÊN THEO LỊCH ÂM (plan 28)

   Sổ lương giống sổ kho: mỗi biến động là một dòng payroll_entries, số dư
   là tổng của sổ. Không có dòng nào nghĩa là đi làm đủ — hệ thống không
   sinh 30 dòng "đi làm" mỗi tháng.

   Kỳ lương gối đầu theo ngày Âm vào làm của từng người (lib/lunar.js).
   Mốc Dương của kỳ chốt cứng lúc tạo dòng payroll_cycles.

   Tiền thật ra khỏi két (ứng, thưởng đưa ngay, trả lương) luôn sinh phiếu
   chi quỹ trong CÙNG giao dịch với dòng sổ lương — không thì cuối ngày đếm
   két lệch mà không ai biết vì sao (§5.2).
   ==================================================================== */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  db, all, get, run, tx, getSettings, nextCode, addCashTx, defaultCashAccount, logActivity, PAYROLL_DIR,
} from './db.js';
import {
  solarToLunar, lunarText, cycleContaining, cycleAfter, addDays, daysBetween, lunarYearRange,
} from '../client/src/lib/lunar.js';


const httpError = (message, status = 400, code) => Object.assign(new Error(message), { status, code });
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const today = () => new Date().toLocaleDateString('sv-SE');
const vn = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const money = (v) => Math.round(Number(v) || 0);
const fmt = (v) => Math.round(v).toLocaleString('vi-VN');
const minIso = (...xs) => xs.filter(Boolean).sort()[0];
const maxIso = (...xs) => xs.filter(Boolean).sort().slice(-1)[0];

export const ENTRY_LABEL = {
  absent_day: 'Nghỉ cả ngày',
  absent_hour: 'Nghỉ theo giờ',
  closed_day: 'Tiệm nghỉ',
  wage: 'Lương ngày',
  advance: 'Ứng tiền',
  purchase: 'Mua hàng ghi sổ',
  bonus: 'Thưởng',
  adjust: 'Cộng / trừ khác',
};
const ATTENDANCE = ['absent_day', 'absent_hour', 'closed_day'];

/* ------------------------------------------------------------------ */
/* Thiết lập                                                           */
/* ------------------------------------------------------------------ */

function num(v, fallback) {
  return v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v);
}

export function payrollSettings() {
  const p = getSettings().payroll || {};
  return {
    /* Ngưỡng ngày nghỉ của thưởng chuyên cần — chủ tiệm tự đặt (28-3) */
    absent_threshold: Math.max(0, Math.round(num(p.absent_threshold, 10))),
    /* Ngày tiệm đóng cửa có tính vào ngưỡng nghỉ không. Mặc định KHÔNG: nhân
       viên nghỉ vì tiệm đóng chứ không phải tự nghỉ. Chủ tiệm đổi được. */
    count_closed_days: p.count_closed_days === true,
    /* Tự xoá ảnh phiếu ứng của kỳ ĐÃ CHỐT sau N tháng. 0 = giữ mãi */
    photo_keep_months: Math.max(0, Math.round(num(p.photo_keep_months, 3))),
  };
}

/* ------------------------------------------------------------------ */
/* Phiên mở bảng lương bằng mã PIN (§2.4 lớp 3)                         */
/*                                                                     */
/* Danh tính trong phần mềm chỉ là dòng x-user-id tự khai — ai nối wifi */
/* tiệm cũng giả danh chủ được. PIN là lớp duy nhất không dựa vào dòng  */
/* đó: đặt x-user-id: 1 mà không biết PIN thì vẫn không mở được.        */
/* ------------------------------------------------------------------ */

const sessions = new Map();          // token -> { userId, approver, expires }
const IDLE_MS = 60 * 60 * 1000;

export function openSession(userId, approver) {
  const now = Date.now();
  for (const [k, v] of sessions) if (v.expires < now) sessions.delete(k);
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId, approver, expires: now + IDLE_MS });
  return { token, expires_in: IDLE_MS / 1000, approver };
}

/** Phiên còn hạn và đúng người đã mở thì gia hạn thêm, trả về phiên; sai thì null. */
export function touchSession(token, userId) {
  const s = token ? sessions.get(String(token)) : null;
  if (!s || s.expires < Date.now() || s.userId !== userId) return null;
  s.expires = Date.now() + IDLE_MS;
  return s;
}

export const closeSession = (token) => sessions.delete(String(token || ''));

/* ------------------------------------------------------------------ */
/* Hồ sơ nhân viên                                                     */
/* ------------------------------------------------------------------ */

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutesOf = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** Số giờ làm mặc định một ngày. Không trừ giờ nghỉ trưa — chủ tiệm chốt (28-6). */
export function hoursPerDay(from, to) {
  return (minutesOf(to) - minutesOf(from)) / 60;
}

export const dayRateOf = (wage) => Math.round(Number(wage) / 30);
/** Lương 1 giờ = lương tháng / 30 / số giờ làm mặc định — không làm tròn trước khi nhân */
export const hourRateOf = (wage, hpd) => (hpd > 0 ? Number(wage) / 30 / hpd : 0);

export function getEmployee(id) {
  const e = get('SELECT * FROM employees WHERE id = ?', [id]);
  if (!e) throw httpError('Không tìm thấy nhân viên', 404, 'NOT_FOUND');
  e.hours_per_day = hoursPerDay(e.work_from, e.work_to);
  return e;
}

function nextEmployeeCode() {
  const r = get(`SELECT MAX(CAST(SUBSTR(code, 3) AS INTEGER)) AS n FROM employees WHERE code GLOB 'NV[0-9]*'`);
  return 'NV' + String((r?.n || 0) + 1).padStart(3, '0');
}

const hasHistory = (id) => !!get(
  `SELECT 1 FROM payroll_entries WHERE employee_id = ?
   UNION ALL SELECT 1 FROM payroll_settlements WHERE employee_id = ? LIMIT 1`, [id, id]);

/** Soát và chuẩn hoá hồ sơ gửi lên. cur = hồ sơ đang có (sửa) hoặc null (tạo mới). */
function normEmployee(b, cur) {
  const pick = (k, fallback) => (b[k] === undefined ? fallback : b[k]);
  const act = pick('active', cur ? cur.active : 1);
  const out = {
    full_name: String(pick('full_name', cur?.full_name) || '').trim(),
    phone: String(pick('phone', cur?.phone) || '').trim() || null,
    note: String(pick('note', cur?.note) || '').trim() || null,
    user_id: Number(pick('user_id', cur?.user_id)) || null,
    monthly_wage: money(pick('monthly_wage', cur?.monthly_wage)),
    work_from: String(pick('work_from', cur?.work_from) || '07:00'),
    work_to: String(pick('work_to', cur?.work_to) || '17:00'),
    pay_mode: pick('pay_mode', cur?.pay_mode) === 'daily' ? 'daily' : 'monthly',
    start_date: String(pick('start_date', cur?.start_date) || ''),
    active: act === 0 || act === false || act === '0' ? 0 : 1,
    end_date: String(pick('end_date', cur?.end_date) || '') || null,
  };
  if (!out.full_name) throw httpError('Chưa nhập họ tên nhân viên', 400, 'NAME_REQUIRED');
  if (out.monthly_wage <= 0) throw httpError('Mức lương phải lớn hơn 0', 400, 'WAGE_REQUIRED');
  if (!HHMM.test(out.work_from) || !HHMM.test(out.work_to)) {
    throw httpError('Giờ vào / giờ về phải dạng giờ:phút, ví dụ 07:00', 400, 'BAD_HOURS');
  }
  if (minutesOf(out.work_to) <= minutesOf(out.work_from)) {
    throw httpError('Giờ về phải sau giờ vào', 400, 'BAD_HOURS');
  }
  if (!ISO.test(out.start_date)) throw httpError('Chưa chọn ngày vào làm', 400, 'START_REQUIRED');
  const lunar = solarToLunar(out.start_date);
  out.start_lunar = lunarText(lunar, true);
  /* Ngày gối đầu mặc định là ngày Âm vào làm; đổi ngày vào làm mà không gửi kèm thì tính lại */
  const anchorFallback = !cur || (b.start_date !== undefined && b.start_date !== cur.start_date) ? lunar.day : cur.cycle_day;
  out.cycle_day = Math.round(Number(pick('cycle_day', anchorFallback))) || lunar.day;
  if (out.cycle_day < 1 || out.cycle_day > 30) throw httpError('Ngày gối đầu kỳ lương phải từ 1 đến 30', 400, 'BAD_CYCLE_DAY');
  out.track_from = String(pick('track_from', cur?.track_from) || out.start_date);
  if (!ISO.test(out.track_from)) throw httpError('Ngày bắt đầu tính lương không hợp lệ', 400, 'BAD_TRACK');
  if (out.track_from < out.start_date) {
    throw httpError('Ngày bắt đầu tính lương trên phần mềm không được trước ngày vào làm', 400, 'BAD_TRACK');
  }
  if (out.end_date && (!ISO.test(out.end_date) || out.end_date < out.start_date)) {
    throw httpError('Ngày nghỉ việc phải sau ngày vào làm', 400, 'BAD_END');
  }
  if (out.user_id && !get('SELECT id FROM users WHERE id = ?', [out.user_id])) out.user_id = null;
  return out;
}

export function createEmployee(b, user) {
  const e = normEmployee(b, null);
  return tx(() => {
    const code = String(b.code || '').trim() || nextEmployeeCode();
    if (get('SELECT id FROM employees WHERE code = ?', [code])) {
      throw httpError(`Mã nhân viên "${code}" đã có`, 409, 'CODE_TAKEN');
    }
    const info = run(`
      INSERT INTO employees(code, full_name, phone, user_id, start_date, start_lunar, cycle_day, track_from,
                            monthly_wage, work_from, work_to, pay_mode, active, end_date, note)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [code, e.full_name, e.phone, e.user_id, e.start_date, e.start_lunar, e.cycle_day, e.track_from,
      e.monthly_wage, e.work_from, e.work_to, e.pay_mode, e.active, e.end_date, e.note]);
    const id = Number(info.lastInsertRowid);
    /* Ngày tiệm nghỉ đã khai sẵn (Tết sắp tới) cũng áp luôn cho người mới */
    const emp = getEmployee(id);
    for (const d of all('SELECT date FROM payroll_closed_days WHERE date >= ? ORDER BY date', [emp.track_from])) {
      try { applyClosedDay(emp, d.date, user); } catch { /* ngoài thời gian làm việc */ }
    }
    logActivity(user, 'create', 'employee', id, `Thêm nhân viên ${code} ${e.full_name}`);
    return getEmployee(id);
  });
}

export function updateEmployee(id, b, user) {
  const cur = getEmployee(id);
  const e = normEmployee(b, cur);
  return tx(() => {
    const anchorChanged = e.start_date !== cur.start_date || e.cycle_day !== cur.cycle_day
      || e.track_from !== cur.track_from || e.pay_mode !== cur.pay_mode;
    if (anchorChanged) {
      /* Mốc kỳ lương và hình thức trả chỉ đổi được khi chưa ghi gì vào sổ lương:
         đổi sau khi đã có ứng / nghỉ / chốt là xê dịch mốc của tiền đã tính. */
      if (hasHistory(id)) {
        throw httpError('Nhân viên đã có dữ liệu lương nên không đổi được ngày vào làm, ngày gối đầu, ngày '
          + 'bắt đầu tính lương hay hình thức trả lương. Muốn đổi: chốt hết lương, cho hồ sơ này nghỉ việc '
          + 'rồi tạo hồ sơ mới.', 409, 'HAS_HISTORY');
      }
      run('DELETE FROM payroll_cycles WHERE employee_id = ?', [id]);
    }
    if (e.end_date && e.end_date !== cur.end_date) {
      const closedPast = get(`SELECT label, date_to FROM payroll_cycles
                              WHERE employee_id = ? AND status = 'closed' AND date_from > ?
                              ORDER BY date_from LIMIT 1`, [id, e.end_date]);
      if (closedPast) {
        throw httpError(`Kỳ ${closedPast.label} sau ngày nghỉ việc đã chốt lương — không đặt ngày nghỉ việc trước đó được.`,
          409, 'END_BEFORE_CLOSED');
      }
      const busy = get(`SELECT c.label FROM payroll_cycles c
                        WHERE c.employee_id = ? AND c.date_from > ?
                          AND EXISTS (SELECT 1 FROM payroll_entries x WHERE x.cycle_id = c.id)`, [id, e.end_date]);
      if (busy) {
        throw httpError(`Kỳ ${busy.label} sau ngày nghỉ việc đã có ghi chép (ứng, nghỉ...). Xoá hoặc dời các khoản đó trước.`,
          409, 'END_HAS_ENTRIES');
      }
      run('DELETE FROM payroll_cycles WHERE employee_id = ? AND date_from > ? AND status = \'open\'', [id, e.end_date]);
    }
    run(`UPDATE employees SET full_name = ?, phone = ?, user_id = ?, start_date = ?, start_lunar = ?, cycle_day = ?,
           track_from = ?, monthly_wage = ?, work_from = ?, work_to = ?, pay_mode = ?, active = ?, end_date = ?, note = ?
         WHERE id = ?`,
    [e.full_name, e.phone, e.user_id, e.start_date, e.start_lunar, e.cycle_day, e.track_from,
      e.monthly_wage, e.work_from, e.work_to, e.pay_mode, e.active, e.end_date, e.note, id]);
    /* Sửa lương / giờ làm: KHÔNG hồi tố kỳ đã chốt (PAY-208), chỉ áp cho kỳ chưa chốt */
    if (e.monthly_wage !== cur.monthly_wage || e.work_from !== cur.work_from || e.work_to !== cur.work_to) {
      run(`UPDATE payroll_cycles SET monthly_wage = ?, hours_per_day = ? WHERE employee_id = ? AND status = 'open'`,
        [e.monthly_wage, hoursPerDay(e.work_from, e.work_to), id]);
      for (const c of all(`SELECT id FROM payroll_cycles WHERE employee_id = ? AND status = 'open'`, [id])) {
        recalcAttendance(c.id);
      }
    }
    logActivity(user, 'update', 'employee', id, `Sửa hồ sơ nhân viên ${cur.code} ${e.full_name}`);
    return getEmployee(id);
  });
}

export function deleteEmployee(id, user) {
  const emp = getEmployee(id);
  if (hasHistory(id)) {
    throw httpError('Nhân viên đã có dữ liệu lương nên không xoá được — sửa hồ sơ, bỏ chọn "Đang làm" để ẩn đi.',
      409, 'HAS_HISTORY');
  }
  tx(() => {
    run('DELETE FROM payroll_awards WHERE employee_id = ?', [id]);
    run('DELETE FROM payroll_cycles WHERE employee_id = ?', [id]);
    run('DELETE FROM employees WHERE id = ?', [id]);
    logActivity(user, 'delete', 'employee', id, `Xoá nhân viên ${emp.code} ${emp.full_name}`);
  });
}

/* ------------------------------------------------------------------ */
/* Kỳ lương                                                            */
/* ------------------------------------------------------------------ */

function insertCycle(emp, c) {
  const info = run(`
    INSERT INTO payroll_cycles(employee_id, label, lunar_month, lunar_year, lunar_leap, lunar_from, lunar_to,
                               date_from, date_to, days, monthly_wage, hours_per_day)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [emp.id, c.label, c.lunar_month, c.lunar_year, c.lunar_leap, c.lunar_from, c.lunar_to,
    c.date_from, c.date_to, c.days, emp.monthly_wage, hoursPerDay(emp.work_from, emp.work_to)]);
  return get('SELECT * FROM payroll_cycles WHERE id = ?', [Number(info.lastInsertRowid)]);
}

/** Sinh các kỳ còn thiếu, nối tiếp kỳ cuối, tới kỳ chứa ngày upto (không quá ngày nghỉ việc). */
export function ensureCycles(emp, upto) {
  let last = get('SELECT * FROM payroll_cycles WHERE employee_id = ? ORDER BY date_from DESC LIMIT 1', [emp.id]);
  if (!last) {
    if (upto < emp.track_from) return;
    last = insertCycle(emp, cycleContaining(emp.track_from, emp.cycle_day));
  }
  for (let guard = 0; last.date_to < upto && guard < 600; guard++) {
    if (emp.end_date && last.date_to >= emp.end_date) break;
    last = insertCycle(emp, cycleAfter(last.date_to, emp.cycle_day));
  }
}

const cycleAt = (empId, date) => get(
  'SELECT * FROM payroll_cycles WHERE employee_id = ? AND date_from <= ? AND date_to >= ?', [empId, date, date]);

/** Ngày cuối đã trả lương ngày (người trả theo ngày). Chưa trả lần nào thì là hôm trước ngày bắt đầu tính. */
export function paidThrough(emp) {
  const r = get(`SELECT MAX(date_to) AS d FROM payroll_settlements WHERE employee_id = ? AND kind = 'daily'`, [emp.id]);
  return r?.d || addDays(emp.track_from, -1);
}

/**
 * Kỳ lương nhận một khoản ghi vào ngày `date`.
 *
 * Khoản TIỀN (ứng, mua hàng, thưởng) ghi vào ngày thuộc kỳ đã chốt thì chuyển
 * sang kỳ mở kế tiếp: chủ chốt lương buổi sáng ngày cuối kỳ, chiều nhân viên
 * mua hàng ở quầy — màn hình bán hàng không bao giờ được chặn vì chuyện lương.
 * Khoản CHẤM CÔNG thì gắn chặt với ngày: kỳ đã chốt là không ghi thêm được.
 */
export function assignCycle(emp, date, { money: isMoney = false } = {}) {
  if (!ISO.test(String(date || ''))) throw httpError('Ngày không hợp lệ', 400, 'BAD_DATE');
  if (date < emp.track_from) {
    if (!isMoney) {
      throw httpError(`Ngày ${vn(date)} trước ngày bắt đầu tính lương trên phần mềm (${vn(emp.track_from)}).`,
        400, 'BEFORE_TRACK');
    }
    date = emp.track_from;
  }
  if (emp.end_date && date > emp.end_date) {
    if (!isMoney) throw httpError(`${emp.full_name} đã nghỉ việc từ sau ngày ${vn(emp.end_date)}.`, 400, 'AFTER_END');
    ensureCycles(emp, emp.end_date);
    const lastOpen = get(`SELECT * FROM payroll_cycles WHERE employee_id = ? AND status = 'open'
                          ORDER BY date_from DESC LIMIT 1`, [emp.id]);
    if (!lastOpen || emp.pay_mode === 'daily') {
      if (emp.pay_mode === 'daily') return cycleAt(emp.id, emp.end_date);
      throw httpError(`${emp.full_name} đã nghỉ việc và đã chốt hết lương — không ghi thêm vào sổ lương được.`,
        409, 'ALL_CLOSED');
    }
    return lastOpen;
  }
  ensureCycles(emp, date);
  const c = cycleAt(emp.id, date);
  if (!c) throw httpError('Không xác định được kỳ lương của ngày này', 400, 'NO_CYCLE');
  if (emp.pay_mode === 'daily' || c.status === 'open') return c;
  if (!isMoney) {
    throw httpError(`Kỳ lương ${c.label} (${vn(c.date_from)} – ${vn(c.date_to)}) đã chốt, không ghi thêm vào ngày này được.`,
      409, 'CYCLE_CLOSED');
  }
  let next = get(`SELECT * FROM payroll_cycles WHERE employee_id = ? AND status = 'open' AND date_from > ?
                  ORDER BY date_from LIMIT 1`, [emp.id, c.date_to]);
  if (!next) {
    if (emp.end_date && c.date_to >= emp.end_date) {
      throw httpError(`${emp.full_name} đã nghỉ việc và đã chốt hết lương — không ghi thêm vào sổ lương được.`,
        409, 'ALL_CLOSED');
    }
    ensureCycles(emp, addDays(c.date_to, 1));
    next = cycleAt(emp.id, addDays(c.date_to, 1));
  }
  return next;
}

/** Số tiền của dòng chấm công theo đơn giá của kỳ. */
function attendanceAmount(emp, cycle, type, hours, counted) {
  if (type === 'absent_hour') {
    return counted ? -Math.round(hours * hourRateOf(cycle.monthly_wage, cycle.hours_per_day)) : 0;
  }
  /* Người trả theo ngày: ngày nghỉ đơn giản là không có dòng lương ngày đó */
  if (emp.pay_mode === 'daily') return 0;
  return -dayRateOf(cycle.monthly_wage);
}

/** Tính lại tiền các dòng chấm công chưa chốt của một kỳ (sau khi sửa lương / giờ làm). */
function recalcAttendance(cycleId) {
  const c = get('SELECT * FROM payroll_cycles WHERE id = ?', [cycleId]);
  const emp = getEmployee(c.employee_id);
  for (const e of all(`SELECT * FROM payroll_entries WHERE cycle_id = ? AND settlement_id IS NULL
                       AND type IN ('absent_day', 'absent_hour', 'closed_day')`, [cycleId])) {
    run('UPDATE payroll_entries SET amount = ?, day_rate = ?, hour_rate = ? WHERE id = ?',
      [attendanceAmount(emp, c, e.type, Number(e.hours) || 0, e.counted),
        dayRateOf(c.monthly_wage), Math.round(hourRateOf(c.monthly_wage, c.hours_per_day)), e.id]);
  }
}

function insertEntry(emp, cycle, e) {
  const info = run(`
    INSERT INTO payroll_entries(work_date, employee_id, cycle_id, settlement_id, type, amount, hours, counted, merged,
                                ref_type, ref_id, ref_code, cash_tx_id, day_rate, hour_rate, reason, user_id, note)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [e.work_date, emp.id, cycle?.id || null, e.settlement_id || null, e.type, money(e.amount), e.hours ?? null,
    e.counted === 0 ? 0 : 1, e.merged === 0 ? 0 : 1, e.ref_type || null, e.ref_id || null, e.ref_code || null,
    e.cash_tx_id || null, cycle ? dayRateOf(cycle.monthly_wage) : null,
    cycle ? Math.round(hourRateOf(cycle.monthly_wage, cycle.hours_per_day)) : null,
    String(e.reason || '').trim().slice(0, 500) || null, e.user_id || null, e.note || null]);
  return Number(info.lastInsertRowid);
}

/** Người trả theo ngày: ngày đã trả lương thì không ghi chấm công vào được nữa. */
function assertDayOpen(emp, date) {
  if (emp.pay_mode !== 'daily') return;
  const pt = paidThrough(emp);
  if (date <= pt) {
    throw httpError(`Đã trả lương ngày cho ${emp.full_name} tới hết ngày ${vn(pt)} — không ghi nghỉ vào ngày đó được.`,
      409, 'DAY_PAID');
  }
}

/* ------------------------------------------------------------------ */
/* Chấm công: nghỉ cả ngày, nghỉ theo giờ, cho qua (§5.1)              */
/* ------------------------------------------------------------------ */

export function addAbsence(empId, b, user) {
  const emp = getEmployee(empId);
  const date = String(b.date || today());
  if (date > addDays(today(), 60)) throw httpError('Chỉ báo nghỉ trước tối đa 60 ngày', 400, 'TOO_FAR');
  const kind = b.kind === 'hour' ? 'hour' : 'day';
  return tx(() => {
    const cycle = assignCycle(emp, date);
    assertDayOpen(emp, date);
    const sameDay = all(`SELECT * FROM payroll_entries WHERE employee_id = ? AND work_date = ?
                         AND type IN ('absent_day', 'absent_hour', 'closed_day')`, [emp.id, date]);
    if (sameDay.some((x) => x.type === 'closed_day')) {
      throw httpError(`Ngày ${vn(date)} tiệm nghỉ — đã không tính lương ngày này rồi.`, 409, 'SHOP_CLOSED');
    }
    if (sameDay.some((x) => x.type === 'absent_day')) {
      throw httpError(`${emp.full_name} đã được báo nghỉ cả ngày ${vn(date)} rồi.`, 409, 'ALREADY_ABSENT');
    }
    if (kind === 'day') {
      if (sameDay.length) {
        throw httpError(`Ngày ${vn(date)} đã ghi nghỉ theo giờ — xoá dòng đó trước rồi mới báo nghỉ cả ngày.`, 409, 'HAS_HOURS');
      }
      const id = insertEntry(emp, cycle, {
        work_date: date, type: 'absent_day', amount: attendanceAmount(emp, cycle, 'absent_day'),
        reason: b.reason, user_id: user?.id,
      });
      return get('SELECT * FROM payroll_entries WHERE id = ?', [id]);
    }
    let hours = Math.round((Number(b.hours) || 0) * 100) / 100;
    if (hours <= 0) throw httpError('Số giờ nghỉ phải lớn hơn 0', 400, 'BAD_HOURS');
    /* Tổng giờ nghỉ một ngày không vượt số giờ làm mặc định: nghỉ 14 tiếng của
       người làm 12 tiếng thì trừ tối đa một ngày công (PAY-207) */
    const used = sameDay.reduce((a, x) => a + (Number(x.hours) || 0), 0);
    const room = Math.max(0, cycle.hours_per_day - used);
    if (room <= 0) throw httpError(`Ngày ${vn(date)} đã ghi nghỉ đủ ${cycle.hours_per_day} giờ.`, 409, 'HOURS_FULL');
    const capped = hours > room;
    hours = Math.min(hours, room);
    const counted = b.counted === false || b.counted === 0 ? 0 : 1;
    const id = insertEntry(emp, cycle, {
      work_date: date, type: 'absent_hour', hours, counted,
      amount: attendanceAmount(emp, cycle, 'absent_hour', hours, counted),
      reason: b.reason, user_id: user?.id,
      note: capped ? `Giới hạn tối đa ${fmt(cycle.hours_per_day)} giờ một ngày` : null,
    });
    return get('SELECT * FROM payroll_entries WHERE id = ?', [id]);
  });
}

/** Bật / tắt "tính vào giảm trừ lương" của dòng nghỉ theo giờ. */
export function setCounted(entryId, counted, user) {
  const e = get('SELECT * FROM payroll_entries WHERE id = ?', [entryId]);
  if (!e) throw httpError('Không tìm thấy dòng sổ lương', 404, 'NOT_FOUND');
  if (e.type !== 'absent_hour') throw httpError('Chỉ dòng nghỉ theo giờ mới cho qua được', 400, 'NOT_HOURLY');
  if (e.settlement_id) throw httpError('Dòng này thuộc kỳ đã chốt lương, không sửa được', 409, 'ENTRY_LOCKED');
  const emp = getEmployee(e.employee_id);
  const c = get('SELECT * FROM payroll_cycles WHERE id = ?', [e.cycle_id]);
  const flag = counted ? 1 : 0;
  run('UPDATE payroll_entries SET counted = ?, amount = ? WHERE id = ?',
    [flag, attendanceAmount(emp, c, 'absent_hour', Number(e.hours) || 0, flag), e.id]);
  logActivity(user, 'update', 'payroll_entry', e.id,
    `${flag ? 'Tính trừ lương' : 'Cho qua'} ${fmt(e.hours)} giờ nghỉ ngày ${vn(e.work_date)} — ${emp.full_name}`);
  return get('SELECT * FROM payroll_entries WHERE id = ?', [e.id]);
}

/* ------------------------------------------------------------------ */
/* Ngày tiệm nghỉ (28-4): KHÔNG tính lương những ngày này               */
/* ------------------------------------------------------------------ */

function worksOn(emp, date) {
  return date >= emp.track_from && (!emp.end_date || date <= emp.end_date);
}

/** Ghi ngày tiệm nghỉ cho một người. Ném lỗi nếu không ghi được (kỳ đã chốt, đã trả lương ngày...). */
function applyClosedDay(emp, date, user) {
  if (!worksOn(emp, date)) throw httpError('ngoài thời gian làm việc', 400, 'NOT_WORKING');
  const cycle = assignCycle(emp, date);
  assertDayOpen(emp, date);
  const same = all(`SELECT * FROM payroll_entries WHERE employee_id = ? AND work_date = ?
                    AND type IN ('absent_day', 'absent_hour', 'closed_day')`, [emp.id, date]);
  if (same.some((x) => x.type === 'closed_day')) return false;
  /* Đã báo nghỉ (cả ngày / theo giờ) đúng ngày tiệm đóng: tiệm nghỉ mới là lý do
     thật, thay dòng cũ để ngày này không bị đếm vào chuyên cần của nhân viên */
  for (const x of same) run('DELETE FROM payroll_entries WHERE id = ?', [x.id]);
  insertEntry(emp, cycle, {
    work_date: date, type: 'closed_day', amount: attendanceAmount(emp, cycle, 'closed_day'),
    ref_type: 'closed_day', reason: get('SELECT note FROM payroll_closed_days WHERE date = ?', [date])?.note || null,
    user_id: user?.id,
  });
  return true;
}

export function addClosedDays(b, user) {
  const from = String(b.from || '');
  const to = String(b.to || b.from || '');
  if (!ISO.test(from) || !ISO.test(to) || to < from) throw httpError('Khoảng ngày không hợp lệ', 400, 'BAD_DATE');
  const n = daysBetween(from, to) + 1;
  if (n > 31) throw httpError('Mỗi lần khai tối đa 31 ngày', 400, 'TOO_LONG');
  const note = String(b.note || '').trim().slice(0, 200) || null;
  return tx(() => {
    const applied = [];
    const skipped = [];
    const emps = all('SELECT id FROM employees ORDER BY id').map((x) => getEmployee(x.id));
    for (let i = 0; i < n; i++) {
      const date = addDays(from, i);
      run(`INSERT INTO payroll_closed_days(date, note, user_id) VALUES(?, ?, ?)
           ON CONFLICT(date) DO UPDATE SET note = COALESCE(excluded.note, payroll_closed_days.note)`,
      [date, note, user?.id || null]);
      for (const emp of emps) {
        if (!worksOn(emp, date)) continue;
        try {
          db.exec('SAVEPOINT closed_one');
          if (applyClosedDay(emp, date, user)) applied.push({ employee_id: emp.id, date });
          db.exec('RELEASE closed_one');
        } catch (e) {
          db.exec('ROLLBACK TO closed_one');
          db.exec('RELEASE closed_one');
          skipped.push({ employee_id: emp.id, full_name: emp.full_name, date, reason: e.message });
        }
      }
    }
    logActivity(user, 'create', 'payroll_closed_day', null,
      `Tiệm nghỉ ${vn(from)}${to !== from ? ` – ${vn(to)}` : ''}${note ? ` (${note})` : ''}`);
    return { from, to, days: n, applied: applied.length, skipped };
  });
}

export function removeClosedDay(date, user) {
  if (!get('SELECT date FROM payroll_closed_days WHERE date = ?', [date])) {
    throw httpError('Ngày này không có trong danh sách tiệm nghỉ', 404, 'NOT_FOUND');
  }
  return tx(() => {
    const locked = all(`SELECT e.full_name FROM payroll_entries x JOIN employees e ON e.id = x.employee_id
                        WHERE x.work_date = ? AND x.type = 'closed_day' AND x.settlement_id IS NOT NULL`, [date]);
    const del = run(`DELETE FROM payroll_entries WHERE work_date = ? AND type = 'closed_day' AND settlement_id IS NULL`, [date]);
    run('DELETE FROM payroll_closed_days WHERE date = ?', [date]);
    logActivity(user, 'delete', 'payroll_closed_day', null, `Bỏ ngày tiệm nghỉ ${vn(date)}`);
    return { removed: Number(del.changes), locked: locked.map((x) => x.full_name) };
  });
}

/* ------------------------------------------------------------------ */
/* Tiền: ứng, thưởng, cộng / trừ khác                                  */
/* ------------------------------------------------------------------ */

function cashAccountFor(accountId) {
  const id = Number(accountId) || defaultCashAccount('cash');
  if (!id || !get('SELECT id FROM cash_accounts WHERE id = ? AND active = 1', [id])) {
    throw httpError('Chưa có quỹ tiền để chi. Tạo quỹ ở màn hình Quỹ tiền trước.', 400, 'NO_ACCOUNT');
  }
  return id;
}

function moneyDate(b) {
  const date = String(b.date || today());
  if (!ISO.test(date)) throw httpError('Ngày không hợp lệ', 400, 'BAD_DATE');
  if (date > today()) throw httpError('Không ghi tiền vào ngày chưa tới', 400, 'FUTURE_DATE');
  return date;
}

/** Giờ của phiếu chi: ghi lùi ngày thì lấy ngày đó, giữ giờ hiện tại */
const cashTs = (date) => (date === today() ? null : `${date} ${new Date().toTimeString().slice(0, 8)}`);

export function addAdvance(empId, b, user) {
  const emp = getEmployee(empId);
  const amount = money(b.amount);
  if (amount <= 0) throw httpError('Số tiền ứng phải lớn hơn 0', 400, 'BAD_AMOUNT');
  const date = moneyDate(b);
  const reason = String(b.reason || '').trim();
  const accountId = cashAccountFor(b.account_id);
  return tx(() => {
    const cycle = assignCycle(emp, date, { money: true });
    const id = insertEntry(emp, cycle, {
      work_date: date, type: 'advance', amount: -amount, reason, user_id: user?.id,
    });
    const cash = addCashTx({
      accountId, direction: 'out', amount, category: 'salary_advance',
      partnerType: 'employee', partnerId: emp.id, partnerName: emp.full_name,
      refType: 'payroll_entry', refId: id, refCode: emp.code, userId: user?.id || null,
      note: `Ứng lương — ${emp.full_name}${reason ? `: ${reason}` : ''}`, ts: cashTs(date),
    });
    run('UPDATE payroll_entries SET cash_tx_id = ?, ref_code = ? WHERE id = ?', [cash.id, cash.code, id]);
    savePhotos(id, b.photos);
    return entryDetail(id);
  });
}

export function addBonus(empId, b, user, extra = {}) {
  const emp = getEmployee(empId);
  const amount = money(b.amount);
  if (amount <= 0) throw httpError('Số tiền thưởng phải lớn hơn 0', 400, 'BAD_AMOUNT');
  const date = moneyDate(b);
  const reason = String(b.reason || '').trim();
  if (!reason) throw httpError('Ghi lý do thưởng để cuối năm còn đối chiếu', 400, 'REASON_REQUIRED');
  const merged = b.merged === false || b.merged === 0 ? 0 : 1;
  const accountId = merged ? null : cashAccountFor(b.account_id);
  return tx(() => {
    const cycle = assignCycle(emp, date, { money: true });
    const id = insertEntry(emp, cycle, {
      work_date: date, type: 'bonus', amount, merged, reason, user_id: user?.id,
      ref_type: extra.ref_type, ref_id: extra.ref_id,
    });
    /* Thưởng đưa tiền mặt ngay cũng là tiền ra khỏi két (§5.3) — không cộng vào
       lương cuối kỳ nữa, nhưng phải có phiếu chi */
    if (!merged) {
      const cash = addCashTx({
        accountId, direction: 'out', amount, category: 'salary_bonus',
        partnerType: 'employee', partnerId: emp.id, partnerName: emp.full_name,
        refType: 'payroll_entry', refId: id, refCode: emp.code, userId: user?.id || null,
        note: `Thưởng — ${emp.full_name}: ${reason}`, ts: cashTs(date),
      });
      run('UPDATE payroll_entries SET cash_tx_id = ?, ref_code = ? WHERE id = ?', [cash.id, cash.code, id]);
    }
    return entryDetail(id);
  });
}

export function addAdjustment(empId, b, user) {
  const emp = getEmployee(empId);
  const amount = money(b.amount);
  if (!amount) throw httpError('Số tiền phải khác 0 (số âm là trừ lương)', 400, 'BAD_AMOUNT');
  const reason = String(b.reason || '').trim();
  if (!reason) throw httpError('Ghi lý do khoản cộng / trừ', 400, 'REASON_REQUIRED');
  const date = moneyDate(b);
  return tx(() => {
    const cycle = assignCycle(emp, date, { money: true });
    return entryDetail(insertEntry(emp, cycle, { work_date: date, type: 'adjust', amount, reason, user_id: user?.id }));
  });
}

export function entryDetail(id) {
  const e = get(`SELECT x.*, c.label AS cycle_label, c.date_from AS cycle_from, c.date_to AS cycle_to,
                        c.lunar_from AS cycle_lunar_from, c.lunar_to AS cycle_lunar_to,
                        emp.code AS employee_code, emp.full_name AS employee_name, emp.phone AS employee_phone,
                        emp.pay_mode, u.full_name AS user_name, t.code AS cash_code, a.name AS account_name
                 FROM payroll_entries x
                 JOIN employees emp ON emp.id = x.employee_id
                 LEFT JOIN payroll_cycles c ON c.id = x.cycle_id
                 LEFT JOIN users u ON u.id = x.user_id
                 LEFT JOIN cash_transactions t ON t.id = x.cash_tx_id
                 LEFT JOIN cash_accounts a ON a.id = t.account_id
                 WHERE x.id = ?`, [id]);
  if (!e) throw httpError('Không tìm thấy dòng sổ lương', 404, 'NOT_FOUND');
  e.label = ENTRY_LABEL[e.type] || e.type;
  e.lunar_date = lunarText(solarToLunar(e.work_date), true);
  e.photos = all('SELECT id, file, ts FROM payroll_photos WHERE entry_id = ? ORDER BY id', [id]);
  return e;
}

export function deleteEntry(id, user) {
  const e = get('SELECT * FROM payroll_entries WHERE id = ?', [id]);
  if (!e) throw httpError('Không tìm thấy dòng sổ lương', 404, 'NOT_FOUND');
  if (e.settlement_id) {
    throw httpError('Dòng này thuộc phiếu lương đã chốt — không xoá được. Muốn sửa thì huỷ phiếu lương gần nhất trước.',
      409, 'ENTRY_LOCKED');
  }
  if (e.type === 'purchase') {
    throw httpError(`Khoản mua hàng sinh từ hoá đơn ${e.ref_code || ''}. Huỷ hoá đơn hoặc lập phiếu trả hàng thay vì xoá ở đây.`,
      400, 'FROM_SALE');
  }
  if (e.type === 'wage') throw httpError('Dòng lương ngày chỉ bỏ được bằng cách huỷ phiếu trả lương', 400, 'FROM_SETTLEMENT');
  const emp = getEmployee(e.employee_id);
  const files = all('SELECT file FROM payroll_photos WHERE entry_id = ?', [id]).map((x) => x.file);
  tx(() => {
    /* Xoá phiếu ứng thì phiếu chi quỹ đi kèm cũng xoá theo (PAY-305) — không để quỹ lệch */
    if (e.cash_tx_id) run('DELETE FROM cash_transactions WHERE id = ?', [e.cash_tx_id]);
    if (e.ref_type === 'attendance') run('DELETE FROM payroll_awards WHERE id = ?', [e.ref_id]);
    run('DELETE FROM payroll_entries WHERE id = ?', [id]);
    logActivity(user, 'delete', 'payroll_entry', id,
      `Xoá "${ENTRY_LABEL[e.type] || e.type}" ngày ${vn(e.work_date)} ${e.amount ? fmt(e.amount) + ' đ ' : ''}— ${emp.full_name}`);
  });
  for (const f of files) removeFile(f);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Mua hàng trừ vào lương tại quầy (§6)                                */
/* ------------------------------------------------------------------ */

/** Nhân viên nhận khoản trừ lương của hoá đơn: phải còn làm và đang tính lương. */
export function salaryEmployee(empId) {
  const id = Number(empId);
  if (!id) throw httpError('Trừ vào lương thì phải chọn nhân viên nào mua.', 400, 'SALARY_NO_EMPLOYEE');
  const emp = get('SELECT * FROM employees WHERE id = ?', [id]);
  if (!emp || !emp.active) throw httpError('Nhân viên này không còn làm ở tiệm.', 400, 'SALARY_EMPLOYEE_INACTIVE');
  return getEmployee(id);
}

export function recordSalePurchase({ employeeId, amount, saleId, saleCode, date, userId }) {
  const emp = getEmployee(employeeId);
  const cycle = assignCycle(emp, date || today(), { money: true });
  return insertEntry(emp, cycle, {
    work_date: date || today(), type: 'purchase', amount: -money(amount),
    ref_type: 'sale', ref_id: saleId, ref_code: saleCode, user_id: userId,
    reason: `Mua hàng hoá đơn ${saleCode}`,
  });
}

/** Huỷ hoá đơn / trả hàng của hoá đơn trừ lương: ghi dòng đảo ngược, không xoá dòng cũ. */
export function reverseSalePurchase({ employeeId, amount, refType, refId, refCode, saleCode, userId, reason }) {
  if (!employeeId || money(amount) <= 0) return null;
  const emp = getEmployee(employeeId);
  const cycle = assignCycle(emp, today(), { money: true });
  return insertEntry(emp, cycle, {
    work_date: today(), type: 'purchase', amount: money(amount),
    ref_type: refType, ref_id: refId, ref_code: refCode, user_id: userId,
    reason: reason || `Hoàn lại tiền hàng hoá đơn ${saleCode}`,
  });
}

/* ------------------------------------------------------------------ */
/* Tính một kỳ lương                                                   */
/* ------------------------------------------------------------------ */

/** Dòng này có cộng vào số thực nhận không. Thưởng đưa tiền ngay thì chỉ liệt kê. */
export const countsInNet = (e) => !(e.type === 'bonus' && !e.merged);

function entriesOfCycle(cycleId) {
  return all(`SELECT x.*, (SELECT COUNT(*) FROM payroll_photos p WHERE p.entry_id = x.id) AS photo_count,
                     t.code AS cash_code
              FROM payroll_entries x LEFT JOIN cash_transactions t ON t.id = x.cash_tx_id
              WHERE x.cycle_id = ? ORDER BY x.work_date, x.id`, [cycleId]);
}

/** Tóm tắt các dòng sổ lương theo nhóm để in phiếu lương. */
function summarize(entries) {
  const s = {
    absent_days: 0, absent_amount: 0, closed_days: 0, closed_amount: 0,
    hours_counted: 0, hours_amount: 0, hours_waived: 0,
    advance: 0, purchase: 0, bonus_merged: 0, bonus_separate: 0, adjust: 0, wage: 0, wage_days: 0,
  };
  for (const e of entries) {
    if (e.type === 'absent_day') { s.absent_days += 1; s.absent_amount += e.amount; }
    else if (e.type === 'closed_day') { s.closed_days += 1; s.closed_amount += e.amount; }
    else if (e.type === 'absent_hour') {
      if (e.counted) { s.hours_counted += Number(e.hours) || 0; s.hours_amount += e.amount; }
      else s.hours_waived += Number(e.hours) || 0;
    } else if (e.type === 'advance') s.advance += e.amount;
    else if (e.type === 'purchase') s.purchase += e.amount;
    else if (e.type === 'bonus') { if (e.merged) s.bonus_merged += e.amount; else s.bonus_separate += e.amount; }
    else if (e.type === 'adjust') s.adjust += e.amount;
    else if (e.type === 'wage') { s.wage += e.amount; s.wage_days += 1; }
  }
  return s;
}

export function computeCycle(cycle, emp) {
  const entries = entriesOfCycle(cycle.id).map((e) => ({ ...e, label: ENTRY_LABEL[e.type] || e.type }));
  if (cycle.status === 'closed') {
    return {
      ...cycle, entries, summary: summarize(entries), base: cycle.base_amount, net: cycle.net_amount,
      gift_day: emp.pay_mode !== 'daily' && !cycle.is_partial && cycle.days === 29,
      day_rate: dayRateOf(cycle.monthly_wage),
      hour_rate: Math.round(hourRateOf(cycle.monthly_wage, cycle.hours_per_day)),
      ended: true,
    };
  }
  const start = maxIso(cycle.date_from, emp.track_from, emp.start_date);
  const end = minIso(cycle.date_to, emp.end_date);
  const workDays = end >= start ? daysBetween(start, end) + 1 : 0;
  const isPartial = workDays < cycle.days;
  /* Kỳ tròn luôn trả đủ 100% lương tháng, bất kể tháng Âm 29 hay 30 ngày.
     Kỳ lẻ (vào làm / nghỉ việc giữa kỳ) tính theo ngày thực tế, mẫu số 30. */
  /* base_override: phần còn lại của một kỳ đã chốt sớm theo ngày làm thực tế
     (BRD nâng cấp, mục 6) — trả nốt cho đủ lương tháng, không tính lại theo ngày. */
  const base = emp.pay_mode === 'daily' ? 0
    : cycle.base_override !== null && cycle.base_override !== undefined ? cycle.base_override
      : isPartial ? Math.round(cycle.monthly_wage * workDays / 30) : cycle.monthly_wage;
  const net = base + entries.filter(countsInNet).reduce((a, e) => a + e.amount, 0);
  return {
    ...cycle, entries, summary: summarize(entries),
    work_days: workDays, is_partial: isPartial ? 1 : 0, work_from_date: start, work_to_date: end,
    base, net,
    /* Dòng "chủ tặng thêm 1 ngày công" chỉ in cho kỳ tròn rơi vào tháng thiếu (§7.4) */
    /* Kỳ bị cắt đôi vì chốt sớm thì không in dòng "chủ tặng" ở cả hai nửa */
    gift_day: emp.pay_mode !== 'daily' && !isPartial && cycle.days === 29
      && cycle.base_override === null && !cycle.split_of,
    day_rate: dayRateOf(cycle.monthly_wage),
    hour_rate: Math.round(hourRateOf(cycle.monthly_wage, cycle.hours_per_day)),
    ended: cycle.date_to < today() || (!!emp.end_date && emp.end_date < today() && cycle.date_from <= emp.end_date),
  };
}

/** Nợ mang sang từ phiếu lương gần nhất (≤ 0). */
export function lastCarry(empId) {
  return get('SELECT carry_out FROM payroll_settlements WHERE employee_id = ? ORDER BY id DESC LIMIT 1', [empId])
    ?.carry_out || 0;
}

/* ------------------------------------------------------------------ */
/* Chốt lương (§5.4, §8.3)                                             */
/* ------------------------------------------------------------------ */

const payslipCycle = (c) => ({
  id: c.id, label: c.label, lunar_from: c.lunar_from, lunar_to: c.lunar_to, date_from: c.date_from,
  date_to: c.date_to, days: c.days, work_days: c.work_days, is_partial: c.is_partial, gift_day: c.gift_day,
  monthly_wage: c.monthly_wage, hours_per_day: c.hours_per_day, day_rate: c.day_rate, hour_rate: c.hour_rate,
  base: c.base, net: c.net, summary: c.summary,
  entries: c.entries.map((e) => ({
    id: e.id, type: e.type, label: e.label, work_date: e.work_date, amount: e.amount, hours: e.hours,
    counted: e.counted, merged: e.merged, reason: e.reason, ref_code: e.ref_code, ref_type: e.ref_type,
    cash_code: e.cash_code,
  })),
});

export function settleCycles(empId, b, user) {
  const emp = getEmployee(empId);
  if (emp.pay_mode !== 'monthly') throw httpError('Nhân viên trả lương theo ngày — dùng "Trả lương ngày".', 400, 'DAILY_MODE');
  const ids = (Array.isArray(b.cycle_ids) ? b.cycle_ids : []).map(Number).filter(Boolean);
  if (!ids.length) throw httpError('Chưa chọn kỳ lương nào để chốt', 400, 'NO_CYCLE');
  const accountId = cashAccountFor(b.account_id);
  return tx(() => {
    const open = all(`SELECT * FROM payroll_cycles WHERE employee_id = ? AND status = 'open' ORDER BY date_from`, [emp.id]);
    /* Chốt từ kỳ cũ nhất, liền nhau: nợ mang sang đi theo thứ tự, bỏ cách một kỳ là sai số */
    const chosen = open.slice(0, ids.length);
    if (chosen.length !== ids.length || chosen.some((c, i) => c.id !== ids[i])) {
      throw httpError('Phải chốt lần lượt từ kỳ cũ nhất chưa chốt, không bỏ cách kỳ nào.', 400, 'NOT_OLDEST');
    }
    const t = today();
    const early = chosen.filter((c) => c.date_to > t && !(emp.end_date && emp.end_date <= t && c.date_from <= emp.end_date));
    if (early.length && b.allow_early !== true) {
      throw httpError(`Kỳ ${early[0].label} chưa hết (tới ${vn(early[0].date_to)}). Chốt sớm thì bấm xác nhận chốt sớm.`,
        409, 'CYCLE_NOT_ENDED');
    }
    /* Chốt sớm theo NGÀY LÀM THỰC TẾ (BRD nâng cấp, mục 6): cắt kỳ đang chạy làm
       hai — phần đã làm trả bây giờ, phần còn lại thành một kỳ mới trả vào lần
       chốt sau, mang sẵn số tiền còn thiếu để cộng lại vẫn đủ lương tháng. */
    if (early.length && b.early_mode === 'worked') {
      const c = early[early.length - 1];
      if (early.length > 1) {
        throw httpError('Chỉ kỳ cuối cùng đang chọn mới được chốt theo ngày làm thực tế.', 400, 'EARLY_MANY');
      }
      const upTo = String(b.up_to || t).slice(0, 10);
      if (upTo < c.date_from || upTo >= c.date_to) {
        throw httpError(`Ngày chốt sớm phải nằm trong kỳ ${vn(c.date_from)} – ${vn(c.date_to)}.`, 400, 'BAD_UPTO');
      }
      const startWork = maxIso(c.date_from, emp.track_from, emp.start_date);
      const workDays = Math.max(0, daysBetween(startWork, upTo) + 1);
      const baseNow = Math.round(c.monthly_wage * workDays / 30);
      const rest = cycleAfter(upTo, emp.cycle_day);        // chỉ để lấy ngày Âm cho phần còn lại
      const restFrom = addDays(upTo, 1);
      const lunarRest = lunarText(solarToLunar(restFrom), true);
      void rest;
      const info = run(`
        INSERT INTO payroll_cycles(employee_id, label, lunar_month, lunar_year, lunar_leap, lunar_from, lunar_to,
                                   date_from, date_to, days, monthly_wage, hours_per_day, base_override, split_of)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [emp.id, `${c.label} (phần còn lại)`, c.lunar_month, c.lunar_year, c.lunar_leap,
        lunarRest, c.lunar_to, restFrom, c.date_to, c.days, c.monthly_wage, c.hours_per_day,
        Math.max(0, c.monthly_wage - baseNow), c.id]);
      const restId = Number(info.lastInsertRowid);
      /* Khoản đã ghi vào những ngày sau ngày chốt phải theo sang kỳ mới */
      run('UPDATE payroll_entries SET cycle_id = ? WHERE cycle_id = ? AND work_date > ?', [restId, c.id, upTo]);
      /* Kỳ đang chốt co lại tới ngày chốt; tiền nền tính theo ngày làm thực tế */
      run('UPDATE payroll_cycles SET date_to = ?, lunar_to = ?, base_override = ? WHERE id = ?',
        [upTo, lunarText(solarToLunar(upTo), true), baseNow, c.id]);
      chosen[chosen.length - 1] = get('SELECT * FROM payroll_cycles WHERE id = ?', [c.id]);
    }
    const comps = chosen.map((c) => computeCycle(c, emp));
    const carryIn = lastCarry(emp.id);
    const earned = comps.reduce((a, c) => a + c.net, 0);
    const total = carryIn + earned;
    const pay = Math.max(0, total);
    const carryOut = Math.min(0, total);
    const code = nextCode('payroll_settlements', 'PL');
    const info = run(`INSERT INTO payroll_settlements(code, employee_id, kind, date_from, date_to, carry_in, earned,
                                                     pay_amount, carry_out, account_id, user_id, note)
                      VALUES(?, ?, 'cycle', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [code, emp.id, chosen[0].date_from, chosen[chosen.length - 1].date_to, carryIn, earned, pay, carryOut,
      accountId, user?.id || null, String(b.note || '').trim() || null]);
    const sid = Number(info.lastInsertRowid);
    for (const c of comps) {
      run(`UPDATE payroll_cycles SET status = 'closed', settlement_id = ?, work_days = ?, is_partial = ?,
             base_amount = ?, net_amount = ?, closed_at = datetime('now','localtime'), closed_by = ? WHERE id = ?`,
      [sid, c.work_days, c.is_partial, c.base, c.net, user?.id || null, c.id]);
      run('UPDATE payroll_entries SET settlement_id = ? WHERE cycle_id = ?', [sid, c.id]);
    }
    let cash = null;
    if (pay > 0) {
      cash = addCashTx({
        accountId, direction: 'out', amount: pay, category: 'salary',
        partnerType: 'employee', partnerId: emp.id, partnerName: emp.full_name,
        refType: 'payroll_settlement', refId: sid, refCode: code, userId: user?.id || null,
        note: `Trả lương ${comps.map((c) => c.label).join(', ')} — ${emp.full_name}`,
      });
    }
    const detail = {
      employee: { id: emp.id, code: emp.code, full_name: emp.full_name, phone: emp.phone, pay_mode: emp.pay_mode },
      cycles: comps.map(payslipCycle), carry_in: carryIn, earned, pay, carry_out: carryOut,
      warn_carry: carryOut < 0 && -carryOut > emp.monthly_wage,
    };
    run('UPDATE payroll_settlements SET cash_tx_id = ?, detail = ? WHERE id = ?', [cash?.id || null, JSON.stringify(detail), sid]);
    logActivity(user, 'create', 'payroll_settlement', sid,
      `Chốt lương ${code} ${emp.full_name}: ${comps.map((c) => c.label).join(', ')} — trả ${fmt(pay)} đ`
      + (carryOut ? `, còn nợ chuyển sang ${fmt(-carryOut)} đ` : ''));
    return settlementDetail(sid);
  });
}

/* ------------------------------------------------------------------ */
/* Trả lương theo ngày (§5.6): ghi thêm bút toán, KHÔNG "reset về 0"   */
/* ------------------------------------------------------------------ */

export function dailyDue(emp, upto = today()) {
  const from = addDays(paidThrough(emp), 1);
  const to = minIso(upto, emp.end_date, today());
  const rate = dayRateOf(emp.monthly_wage);
  const days = [];
  if (from <= to) {
    const n = Math.min(daysBetween(from, to) + 1, 400);
    const att = new Map();
    for (const x of all(`SELECT work_date, type FROM payroll_entries WHERE employee_id = ? AND work_date BETWEEN ? AND ?
                         AND type IN ('absent_day', 'closed_day')`, [emp.id, from, to])) att.set(x.work_date, x.type);
    for (let i = 0; i < n; i++) {
      const d = addDays(from, i);
      const st = att.get(d);
      days.push({
        date: d, lunar: lunarText(solarToLunar(d)),
        status: st === 'closed_day' ? 'closed' : st === 'absent_day' ? 'absent' : 'work',
        wage: st ? 0 : rate,
      });
    }
  }
  const entries = all(`SELECT x.*, t.code AS cash_code FROM payroll_entries x
                       LEFT JOIN cash_transactions t ON t.id = x.cash_tx_id
                       WHERE x.employee_id = ? AND x.settlement_id IS NULL AND x.work_date <= ?
                       ORDER BY x.work_date, x.id`, [emp.id, to < from ? addDays(from, -1) : to])
    .map((e) => ({ ...e, label: ENTRY_LABEL[e.type] || e.type }));
  const wage = days.reduce((a, d) => a + d.wage, 0);
  const carryIn = lastCarry(emp.id);
  const earned = wage + entries.filter(countsInNet).reduce((a, e) => a + e.amount, 0);
  const total = carryIn + earned;
  return {
    from, to: to < from ? null : to, day_rate: rate, days, entries, summary: summarize(entries),
    wage, work_days: days.filter((d) => d.status === 'work').length,
    carry_in: carryIn, earned, pay: Math.max(0, total), carry_out: Math.min(0, total),
  };
}

export function payDaily(empId, b, user) {
  const emp = getEmployee(empId);
  if (emp.pay_mode !== 'daily') throw httpError('Nhân viên này trả lương theo tháng — dùng "Chốt lương".', 400, 'MONTHLY_MODE');
  const accountId = cashAccountFor(b.account_id);
  return tx(() => {
    const due = dailyDue(emp, String(b.to || today()));
    if (!due.days.length && !due.entries.length) {
      throw httpError('Không còn ngày công hay khoản nào chưa trả.', 400, 'NOTHING_DUE');
    }
    const code = nextCode('payroll_settlements', 'PL');
    const info = run(`INSERT INTO payroll_settlements(code, employee_id, kind, date_from, date_to, carry_in, earned,
                                                     pay_amount, carry_out, account_id, user_id, note)
                      VALUES(?, ?, 'daily', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [code, emp.id, due.days.length ? due.from : null, due.days.length ? due.to : paidThrough(emp),
      due.carry_in, due.earned, due.pay, due.carry_out, accountId, user?.id || null, String(b.note || '').trim() || null]);
    const sid = Number(info.lastInsertRowid);
    for (const d of due.days) {
      if (d.status !== 'work') continue;
      const cycle = assignCycle(emp, d.date);
      insertEntry(emp, cycle, {
        work_date: d.date, type: 'wage', amount: d.wage, settlement_id: sid, user_id: user?.id,
      });
    }
    if (due.entries.length) {
      run(`UPDATE payroll_entries SET settlement_id = ? WHERE id IN (${due.entries.map(() => '?').join(',')})`,
        [sid, ...due.entries.map((e) => e.id)]);
    }
    let cash = null;
    if (due.pay > 0) {
      cash = addCashTx({
        accountId, direction: 'out', amount: due.pay, category: 'salary',
        partnerType: 'employee', partnerId: emp.id, partnerName: emp.full_name,
        refType: 'payroll_settlement', refId: sid, refCode: code, userId: user?.id || null,
        note: `Trả lương ngày ${due.days.length ? `${vn(due.from)}${due.to !== due.from ? ` – ${vn(due.to)}` : ''}` : ''} — ${emp.full_name}`,
      });
    }
    const detail = {
      employee: { id: emp.id, code: emp.code, full_name: emp.full_name, phone: emp.phone, pay_mode: emp.pay_mode },
      daily: {
        from: due.from, to: due.to, day_rate: due.day_rate, days: due.days, work_days: due.work_days, wage: due.wage,
        summary: due.summary,
        entries: due.entries.map((e) => ({
          id: e.id, type: e.type, label: e.label, work_date: e.work_date, amount: e.amount, hours: e.hours,
          counted: e.counted, merged: e.merged, reason: e.reason, ref_code: e.ref_code, cash_code: e.cash_code,
        })),
      },
      carry_in: due.carry_in, earned: due.earned, pay: due.pay, carry_out: due.carry_out,
    };
    run('UPDATE payroll_settlements SET cash_tx_id = ?, detail = ? WHERE id = ?', [cash?.id || null, JSON.stringify(detail), sid]);
    logActivity(user, 'create', 'payroll_settlement', sid, `Trả lương ngày ${code} ${emp.full_name} — ${fmt(due.pay)} đ`);
    return settlementDetail(sid);
  });
}

export function settlementDetail(id) {
  const s = get(`SELECT st.*, e.code AS employee_code, e.full_name AS employee_name, u.full_name AS user_name,
                        t.code AS cash_code, a.name AS account_name
                 FROM payroll_settlements st
                 JOIN employees e ON e.id = st.employee_id
                 LEFT JOIN users u ON u.id = st.user_id
                 LEFT JOIN cash_transactions t ON t.id = st.cash_tx_id
                 LEFT JOIN cash_accounts a ON a.id = st.account_id
                 WHERE st.id = ?`, [id]);
  if (!s) throw httpError('Không tìm thấy phiếu lương', 404, 'NOT_FOUND');
  try { s.detail = JSON.parse(s.detail || 'null'); } catch { s.detail = null; }
  const last = get('SELECT id FROM payroll_settlements WHERE employee_id = ? ORDER BY id DESC LIMIT 1', [s.employee_id]);
  s.is_latest = last?.id === s.id;
  return s;
}

/** Huỷ phiếu lương GẦN NHẤT (bấm nhầm): mở lại kỳ, xoá phiếu chi, bỏ dòng lương ngày đã sinh. */
export function undoSettlement(id, user) {
  const s = get('SELECT * FROM payroll_settlements WHERE id = ?', [id]);
  if (!s) throw httpError('Không tìm thấy phiếu lương', 404, 'NOT_FOUND');
  const last = get('SELECT id FROM payroll_settlements WHERE employee_id = ? ORDER BY id DESC LIMIT 1', [s.employee_id]);
  if (last.id !== s.id) {
    throw httpError('Chỉ huỷ được phiếu lương gần nhất của nhân viên — nợ mang sang của các phiếu sau dựa vào phiếu này.',
      409, 'NOT_LATEST');
  }
  const emp = getEmployee(s.employee_id);
  tx(() => {
    if (s.cash_tx_id) run('DELETE FROM cash_transactions WHERE id = ?', [s.cash_tx_id]);
    run(`DELETE FROM payroll_entries WHERE settlement_id = ? AND type = 'wage'`, [id]);
    run('UPDATE payroll_entries SET settlement_id = NULL WHERE settlement_id = ?', [id]);
    run(`UPDATE payroll_cycles SET status = 'open', settlement_id = NULL, work_days = NULL, is_partial = 0,
           base_amount = NULL, net_amount = NULL, closed_at = NULL, closed_by = NULL WHERE settlement_id = ?`, [id]);
    run('DELETE FROM payroll_settlements WHERE id = ?', [id]);
    logActivity(user, 'delete', 'payroll_settlement', id, `Huỷ phiếu lương ${s.code} — ${emp.full_name}`);
  });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Thưởng chuyên cần theo năm Âm lịch (28-3, 28-5)                     */
/* ------------------------------------------------------------------ */

export function attendanceStatus(emp, year) {
  const y = Math.round(Number(year)) || solarToLunar(today()).year;
  const r = lunarYearRange(y);
  const cfg = payrollSettings();
  const cnt = get(`SELECT
      COALESCE(SUM(CASE WHEN type = 'absent_day' THEN 1 END), 0) AS absent,
      COALESCE(SUM(CASE WHEN type = 'closed_day' THEN 1 END), 0) AS closed,
      COALESCE(SUM(CASE WHEN type = 'absent_hour' THEN hours END), 0) AS hours
    FROM payroll_entries WHERE employee_id = ? AND work_date BETWEEN ? AND ?`, [emp.id, r.from, r.to]);
  /* Nghỉ theo giờ KHÔNG cộng dồn thành ngày (28-5) — chỉ đếm để hiện cho chủ xem */
  const counted = cnt.absent + (cfg.count_closed_days ? cnt.closed : 0);
  const award = get(`SELECT a.*, u.full_name AS user_name FROM payroll_awards a LEFT JOIN users u ON u.id = a.user_id
                     WHERE a.employee_id = ? AND a.lunar_year = ?`, [emp.id, y]);
  /* Mở xét từ mùng 1 tháng cuối năm (thường là tháng Chạp) — chủ hay thưởng trước Tết */
  const lastMonthStart = addDays(r.to, -(solarToLunar(r.to).day - 1));
  return {
    year: y, from: r.from, to: r.to, months: r.months,
    absent_days: cnt.absent, closed_days: cnt.closed, absent_hours: cnt.hours,
    count_closed_days: cfg.count_closed_days, counted_days: counted,
    threshold: cfg.absent_threshold, eligible: counted <= cfg.absent_threshold,
    joined_mid_year: emp.start_date > r.from, started_tracking_mid_year: emp.track_from > r.from,
    open_from: lastMonthStart, is_open: today() >= lastMonthStart,
    suggest_amount: emp.monthly_wage, award,
  };
}

export function decideAward(empId, b, user) {
  const emp = getEmployee(empId);
  const st = attendanceStatus(emp, b.year);
  if (st.award) throw httpError(`Năm ${st.year} đã quyết định thưởng chuyên cần rồi.`, 409, 'ALREADY_DECIDED');
  const decision = b.decision === 'approve' ? 'approve' : b.decision === 'reject' ? 'reject' : null;
  if (!decision) throw httpError('Chọn thưởng hoặc không thưởng', 400, 'BAD_DECISION');
  const note = String(b.note || '').trim() || null;
  return tx(() => {
    const info = run(`INSERT INTO payroll_awards(employee_id, lunar_year, absent_days, threshold, decision, amount, user_id, note)
                      VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [emp.id, st.year, st.counted_days, st.threshold, decision, 0, user?.id || null,
      note || (decision === 'approve' && !st.eligible ? 'Chủ cho qua' : null)]);
    const awardId = Number(info.lastInsertRowid);
    if (decision === 'approve') {
      const amount = money(b.amount ?? st.suggest_amount);
      const reason = `Thưởng chuyên cần năm ${st.year} (nghỉ ${st.counted_days}/${st.threshold} ngày`
        + `${st.eligible ? '' : ' — chủ cho qua'})`;
      const entry = addBonus(emp.id, { amount, reason, merged: b.merged, account_id: b.account_id }, user,
        { ref_type: 'attendance', ref_id: awardId });
      run('UPDATE payroll_awards SET amount = ?, entry_id = ? WHERE id = ?', [amount, entry.id, awardId]);
    }
    logActivity(user, 'create', 'payroll_award', awardId,
      `${decision === 'approve' ? 'Thưởng' : 'Không thưởng'} chuyên cần năm ${st.year} — ${emp.full_name}`);
    return attendanceStatus(emp, st.year);
  });
}

export function undoAward(awardId, user) {
  const a = get('SELECT * FROM payroll_awards WHERE id = ?', [awardId]);
  if (!a) throw httpError('Không tìm thấy quyết định thưởng', 404, 'NOT_FOUND');
  if (a.entry_id) return deleteEntry(a.entry_id, user);
  run('DELETE FROM payroll_awards WHERE id = ?', [awardId]);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Tổng quan nhân viên                                                 */
/* ------------------------------------------------------------------ */

export function employeeOverview(emp) {
  const t = today();
  const out = { hours_per_day: emp.hours_per_day, day_rate: dayRateOf(emp.monthly_wage),
    hour_rate: Math.round(hourRateOf(emp.monthly_wage, emp.hours_per_day)), carry_in: lastCarry(emp.id) };
  if (emp.track_from > t) return { ...out, not_started: true };
  const upto = minIso(t, emp.end_date);
  if (emp.active) ensureCycles(emp, upto);
  if (emp.pay_mode === 'daily') {
    const due = dailyDue(emp);
    return { ...out, daily: { from: due.from, to: due.to, unpaid_days: due.days.length, work_days: due.work_days,
      wage: due.wage, entries_total: due.entries.filter(countsInNet).reduce((a, e) => a + e.amount, 0),
      pay: due.pay, carry_out: due.carry_out } };
  }
  const open = all(`SELECT * FROM payroll_cycles WHERE employee_id = ? AND status = 'open' AND date_from <= ?
                    ORDER BY date_from`, [emp.id, upto]).map((c) => computeCycle(c, emp));
  const current = open.find((c) => c.date_from <= upto && c.date_to >= upto) || open[open.length - 1] || null;
  const due = open.filter((c) => c.ended);
  const spent = current ? current.summary.advance + current.summary.purchase : 0;
  return {
    ...out,
    current: current && { id: current.id, label: current.label, lunar_from: current.lunar_from, lunar_to: current.lunar_to,
      date_from: current.date_from, date_to: current.date_to, days: current.days, base: current.base, net: current.net,
      absent_days: current.summary.absent_days + current.summary.closed_days, advance_purchase: spent, ended: current.ended },
    due_cycles: due.map((c) => ({ id: c.id, label: c.label, date_from: c.date_from, date_to: c.date_to, net: c.net })),
    open_total: out.carry_in + open.reduce((a, c) => a + c.net, 0),
  };
}

/* ------------------------------------------------------------------ */
/* Ảnh phiếu ứng (§7.2, §7.3) — chép khuôn mẫu ảnh bảo hành             */
/* ------------------------------------------------------------------ */

const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

function removeFile(name) {
  try { fs.unlinkSync(path.join(PAYROLL_DIR, path.basename(name))); } catch { /* đã xoá */ }
}

export function savePhotos(entryId, photos) {
  const saved = [];
  for (const ph of (Array.isArray(photos) ? photos : []).slice(0, 6)) {
    const m = String(ph?.data || ph || '').match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
    if (!m) continue;
    const ext = EXT_BY_MIME[m[1].toLowerCase()];
    if (!ext) continue;
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 6 * 1024 * 1024) continue;
    const name = `ul${entryId}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(PAYROLL_DIR, name), buf);
    run('INSERT INTO payroll_photos(entry_id, file) VALUES(?, ?)', [entryId, name]);
    saved.push(name);
  }
  return saved;
}

export function deletePhoto(photoId) {
  const p = get('SELECT * FROM payroll_photos WHERE id = ?', [photoId]);
  if (!p) throw httpError('Không tìm thấy ảnh', 404, 'NOT_FOUND');
  run('DELETE FROM payroll_photos WHERE id = ?', [p.id]);
  removeFile(p.file);
  return { ok: true };
}

export function photoFilePath(file) {
  const name = path.basename(String(file || ''));
  const full = path.join(PAYROLL_DIR, name);
  return full.startsWith(PAYROLL_DIR) && fs.existsSync(full) ? full : null;
}

/**
 * Xoá ảnh phiếu ứng cũ. Chỉ ảnh thuộc dòng ĐÃ CHỐT lương — chưa chốt thì còn phải
 * đối chiếu (PAY-807). Số liệu chữ trong sổ lương giữ nguyên.
 * months: bỏ trống = theo thiết lập (0 trong thiết lập là giữ mãi);
 *         nút xoá tay truyền số tháng, 0 = xoá hết ảnh của các kỳ đã chốt.
 */
export function cleanupPayrollPhotos(months) {
  const keep = months === undefined || months === null || months === ''
    ? payrollSettings().photo_keep_months : Math.max(0, Math.round(Number(months) || 0));
  if ((months === undefined || months === null || months === '') && keep <= 0) return { deleted: 0, freed: 0, months: 0 };
  const rows = all(`SELECT p.id, p.file FROM payroll_photos p JOIN payroll_entries x ON x.id = p.entry_id
                    WHERE x.settlement_id IS NOT NULL
                      AND date(p.ts) < date('now', 'localtime', '-' || ? || ' months')`, [keep]);
  let deleted = 0;
  let freed = 0;
  for (const r of rows) {
    const full = path.join(PAYROLL_DIR, path.basename(r.file));
    try {
      if (fs.existsSync(full)) { freed += fs.statSync(full).size; fs.unlinkSync(full); }
      run('DELETE FROM payroll_photos WHERE id = ?', [r.id]);
      deleted++;
    } catch { /* file đang bị khoá, lần sau dọn tiếp */ }
  }
  if (deleted) console.log(`  [dọn ảnh lương] xoá ${deleted} ảnh phiếu ứng đã chốt quá ${keep} tháng`);
  return { deleted, freed, months: keep };
}

export function payrollPhotoUsage() {
  let bytes = 0;
  let files = 0;
  try {
    for (const name of fs.readdirSync(PAYROLL_DIR)) {
      try { bytes += fs.statSync(path.join(PAYROLL_DIR, name)).size; files++; } catch { /* vừa bị xoá */ }
    }
  } catch { /* chưa có thư mục */ }
  const pending = get(`SELECT COUNT(*) AS n FROM payroll_photos p JOIN payroll_entries x ON x.id = p.entry_id
                       WHERE x.settlement_id IS NULL`).n;
  return { files, bytes, text: (bytes / 1024 / 1024).toFixed(1) + ' MB', unsettled_photos: pending };
}
