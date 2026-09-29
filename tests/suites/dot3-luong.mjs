/**
 * ĐỢT 3 — lương và chấm công (tài liệu "Yêu cầu Cập nhật Phần mềm 2", phần III).
 *
 * Chốt của chủ tiệm 28/09: chấm công CHỈ ĐỂ THEO DÕI, không đụng tiền lương;
 * phụ cấp tính y như lương cứng; thưởng Tết chỉ tính trên lương cứng.
 */
import { section, ok, get, post, put, code, money, today } from '../lib.mjs';

const stamp = String(Date.now()).slice(-5);
/* Bảng lương khoá bằng PIN — bài kiểm thử tự đặt PIN cho chủ tiệm rồi mở phiên */
const PIN = '2468';

export default async function run() {
  /* ---- mở khoá bảng lương ---- */
  const owner = (await get('/users')).find((u) => u.id === 1);
  await put('/users/1', {
    full_name: owner.full_name, role: owner.role, phone: owner.phone, active: 1, pin: PIN,
  });
  const ses = await post('/payroll/unlock', { pin: PIN });
  const P = { 'x-payroll-token': ses.token };

  section('ĐỢT 3 — phụ cấp tính y như lương cứng (mục III.2)');
  let emp;
  {
    emp = await post('/payroll/employees', {
      full_name: `ZZĐ3 Nguyễn Văn Công ${stamp}`,
      start_date: '2026-01-05', monthly_wage: 6000000, allowance: 600000,
      work_from: '07:00', work_to: '17:00',
    }, P);
    ok('hồ sơ lưu được phụ cấp', emp.allowance === 600000, money(emp.allowance));

    const d = await get(`/payroll/employees/${emp.id}`, P);
    const cur = d.cycles.find((c) => c.status === 'open' && c.date_from <= today() && c.date_to >= today())
      || d.cycles.find((c) => c.status === 'open');
    ok('kỳ lương chụp lại cả lương cứng lẫn phụ cấp',
      cur.monthly_wage === 6000000 && cur.allowance === 600000);
    ok('tiền nền của kỳ tròn = lương cứng + phụ cấp', cur.base === 6600000, money(cur.base));
    ok('một ngày công tính trên tổng (6.600.000 / 30)', cur.day_rate === 220000, money(cur.day_rate));

    /* Nghỉ một ngày thì trừ cả phụ cấp */
    const day = cur.date_from > today() ? cur.date_from : today();
    await post(`/payroll/employees/${emp.id}/absences`, { date: day, kind: 'day', reason: 'Về quê' }, P);
    const d2 = await get(`/payroll/employees/${emp.id}`, P);
    const cur2 = d2.cycles.find((c) => c.id === cur.id);
    ok('nghỉ một ngày trừ 220.000 (gồm cả phụ cấp)', cur2.net === 6600000 - 220000, money(cur2.net));
  }

  section('ĐỢT 3 — chấm công chỉ để theo dõi, không đụng tiền (mục III.1)');
  {
    const day = today();
    /* Người mới, chưa chấm gì hôm nay — để xem mục "còn phải chấm" có đếm không */
    const fresh = await post('/payroll/employees', {
      full_name: `ZZĐ3 Lê Văn Mới ${stamp}`,
      start_date: '2026-01-05', monthly_wage: 6000000, work_from: '07:00', work_to: '17:00',
    }, P);

    const board = await get('/attendance/today');
    ok('bảng chấm công liệt kê cả tiệm', board.staff.some((x) => x.employee_id === fresh.id),
      `${board.staff.length} người`);
    ok('người chưa chấm thì đếm vào mục còn phải chấm',
      board.pending > 0 && board.staff.find((x) => x.employee_id === fresh.id).done === false,
      String(board.pending));

    const before = (await get(`/payroll/employees/${fresh.id}`, P)).cycles
      .find((c) => c.date_from <= day && c.date_to >= day).net;

    const saved = await post('/attendance/today', {
      date: day,
      rows: [{ employee_id: fresh.id, in_at: '07:15', out_at: '17:05' }],
    });
    const me = saved.staff.find((x) => x.employee_id === fresh.id);
    ok('ghi được giờ vào và giờ ra', me.in_at === '07:15' && me.out_at === '17:05');
    ok('chấm công xong thì hết nằm trong mục chờ chấm', me.done === true);

    const after = (await get(`/payroll/employees/${fresh.id}`, P)).cycles
      .find((c) => c.date_from <= day && c.date_to >= day).net;
    ok('chấm công KHÔNG làm đổi tiền lương', after === before, `${money(before)} → ${money(after)}`);

    /* Chấm lại lần nữa thì sửa, không đẻ dòng thứ hai */
    const again = await post('/attendance/today', {
      date: day, rows: [{ employee_id: fresh.id, in_at: '06:50' }],
    });
    const me2 = again.staff.find((x) => x.employee_id === fresh.id);
    ok('chấm lại thì sửa dòng cũ, giờ ra giữ nguyên', me2.in_at === '06:50' && me2.out_at === '17:05');

    ok('chấm công ngày mai bị chặn',
      (await code(() => post('/attendance/today', {
        date: '2099-01-01', rows: [{ employee_id: fresh.id, in_at: '07:00' }],
      }))) !== 'KHÔNG_BÁO_LỖI');
  }

  section('ĐỢT 3 — báo nghỉ ngay trên bảng chấm công');
  {
    const emp2 = await post('/payroll/employees', {
      full_name: `ZZĐ3 Trần Thị Nghỉ ${stamp}`,
      start_date: '2026-01-05', monthly_wage: 6000000, work_from: '07:00', work_to: '17:00',
    }, P);
    const day = today();
    const beforeNet = (await get(`/payroll/employees/${emp2.id}`, P)).cycles
      .find((c) => c.date_from <= day && c.date_to >= day).net;

    const saved = await post('/attendance/today', {
      date: day, rows: [{ employee_id: emp2.id, off: true, reason: 'Ốm' }],
    });
    const row = saved.staff.find((x) => x.employee_id === emp2.id);
    ok('tích báo nghỉ thì bảng chấm công ghi nghỉ', row.status === 'off');

    const d = await get(`/payroll/employees/${emp2.id}`, P);
    const cyc = d.cycles.find((c) => c.date_from <= day && c.date_to >= day);
    ok('báo nghỉ ở bảng chấm công sinh đúng một dòng nghỉ trong sổ lương',
      cyc.entries.filter((e) => e.type === 'absent_day' && e.work_date === day).length === 1);
    ok('tiền lương trừ đúng một ngày', cyc.net === beforeNet - 200000, money(cyc.net));

    /* Bấm nhầm hai lần cũng chỉ trừ một ngày */
    await post('/attendance/today', { date: day, rows: [{ employee_id: emp2.id, off: true }] });
    const d2 = await get(`/payroll/employees/${emp2.id}`, P);
    const cyc2 = d2.cycles.find((c) => c.id === cyc.id);
    ok('tích báo nghỉ lần nữa không trừ thêm lần nào', cyc2.net === cyc.net, money(cyc2.net));
  }

  section('ĐỢT 3 — thưởng Tết tính trên lương cứng (mục III.2)');
  {
    const st = await get(`/payroll/employees/${emp.id}/tet`, P);
    ok('gợi ý thưởng Tết KHÔNG cộng phụ cấp',
      st.suggest_amount === 6000000 && st.allowance === 600000, money(st.suggest_amount));
    ok('chưa thưởng thì chưa có dấu vết', st.given === null);

    const done = await post(`/payroll/employees/${emp.id}/tet`, { merged: true }, P);
    ok('thưởng Tết ghi vào sổ lương', done.given && done.given.amount === 6000000, money(done.given?.amount));
    ok('thưởng lần thứ hai trong cùng năm bị chặn',
      (await code(() => post(`/payroll/employees/${emp.id}/tet`, {}, P))) === 'ALREADY_DECIDED');

    const chuyenCan = await get(`/payroll/employees/${emp.id}/attendance`, P);
    ok('thưởng chuyên cần vẫn là khoản riêng, chưa xét',
      chuyenCan.award === null || chuyenCan.award === undefined);
  }

  section('ĐỢT 3 — lưới chấm công theo tháng');
  {
    const grid = await get(`/payroll/attendance?month=${today().slice(0, 7)}`, P);
    ok('lưới tháng có danh sách nhân viên và các dòng đã chấm',
      Array.isArray(grid.staff) && Array.isArray(grid.rows) && grid.rows.length > 0,
      `${grid.staff.length} người · ${grid.rows.length} dòng`);
    ok('lưới tháng kèm cả ngày tiệm nghỉ', Array.isArray(grid.closed_days));
  }

  section('ĐỢT 3 — chặn hỏng');
  {
    ok('gọi bảng chấm công của trang lương mà không có phiên PIN thì bị chặn',
      (await code(() => get('/payroll/attendance'))) === 'PAYROLL_LOCKED');
    ok('bảng chấm công ngoài quầy không kèm đồng lương nào',
      (await get('/attendance/today')).staff.every((x) => !('monthly_wage' in x) && !('allowance' in x)));
  }
}
