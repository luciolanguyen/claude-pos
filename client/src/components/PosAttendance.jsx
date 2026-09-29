/* ====================================================================
   CHẤM CÔNG NGOÀI QUẦY (yêu cầu 28/09, phần III.1)

   Chủ tiệm chốt: QUẢN LÝ CHẤM HỘ CẢ TIỆM. Nên đây là một bảng liệt kê
   mọi người đang làm, tích một lượt rồi xác nhận — không phải mỗi người
   tự bấm trên máy của mình.

   Ba đường vào:
     - 7h30 sáng tự bật bảng "giờ vào làm", giờ điền sẵn theo hồ sơ;
     - chiều tới giờ tan làm tự bật bảng "giờ ra", kèm ai sáng chưa chấm;
     - nút trên thanh POS, bấm lúc nào cũng được.

   Tắt bảng đi thì thu nhỏ thành BONG BÓNG NHẮC ở góc, chỉ biến mất khi
   hôm đó chấm xong.

   Chấm công CHỈ ĐỂ THEO DÕI giờ giấc, không đụng tới tiền lương: hôm nào
   quên chấm cũng không ai mất công. Riêng ô "báo nghỉ" thì có trừ lương,
   vì nó ghi thẳng một dòng nghỉ vào sổ lương như báo nghỉ bình thường.
   ==================================================================== */
import { useState, useEffect, useMemo } from 'react';
import { CalendarCheck, X, Clock } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch } from '../lib/store';
import { useDailyPrompt } from '../lib/useLive';
import { date as vnDate } from '../lib/format';
import { Modal, Button, Input, Spinner, ErrorBox, Badge, Empty } from './ui';

const todayIso = () => new Date().toLocaleDateString('sv-SE');
const nowHHMM = () => new Date().toTimeString().slice(0, 5);

/** Giờ tan làm muộn nhất của cả tiệm — mốc bật bảng giờ ra buổi chiều. */
function lastWorkTo(staff) {
  return (staff || []).map((x) => x.work_to).filter(Boolean).sort().slice(-1)[0] || '17:00';
}

/**
 * Nút chấm công trên thanh POS + bong bóng nhắc + hai mốc giờ tự bật.
 * Đặt cạnh chuông đơn đặt và chuông giao hàng.
 */
export default function PosAttendance() {
  const { can } = useApp();
  const mayUse = can('sale.pos');
  const { data, busy, error, reload } = useFetch(() => api.get('/attendance/today'), [], { skip: !mayUse });
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('in');       // in = giờ vào, out = giờ ra
  const [nagging, setNagging] = useState(false);

  const staff = data?.staff || [];
  const pending = data?.pending || 0;
  const noOut = staff.filter((x) => x.status === 'work' && x.in_at && !x.out_at).length;

  /* 7h30: bảng giờ vào. Chiều tan làm: bảng giờ ra. */
  useDailyPrompt('07:30', `thpos.attendance.in.${todayIso()}`,
    () => { setMode('in'); setOpen(true); }, { enabled: mayUse && pending > 0 });
  useDailyPrompt(lastWorkTo(staff), `thpos.attendance.out.${todayIso()}`,
    () => { setMode('out'); setOpen(true); }, { enabled: mayUse && (pending > 0 || noOut > 0) });

  /* Tắt bảng mà chưa chấm xong thì thu nhỏ thành bong bóng nhắc */
  const close = () => {
    setOpen(false);
    setNagging(pending > 0 || noOut > 0);
  };

  useEffect(() => {
    if (pending === 0 && noOut === 0) setNagging(false);
  }, [pending, noOut]);

  if (!mayUse || (!data && !busy)) return null;

  const label = pending > 0 ? `Chấm công (${pending})` : 'Chấm công';

  return (
    <>
      <button
        type="button"
        onClick={() => { setMode(pending > 0 ? 'in' : 'out'); setOpen(true); }}
        title={pending > 0
          ? `${pending} người chưa chấm công hôm nay`
          : 'Bảng chấm công hôm nay — cả tiệm đã chấm xong'}
        className={`relative inline-flex items-center gap-1.5 rounded-lg border px-2.5 h-9 text-[13px]
                    font-semibold cursor-pointer transition-colors duration-150 whitespace-nowrap
                    focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent
                    ${pending > 0
                      ? 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100'
                      : 'bg-white/10 border-white/20 text-slate-200 hover:bg-white/15'}`}
      >
        <CalendarCheck size={15} aria-hidden="true" />
        {label}
        {pending > 0 && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping" aria-hidden="true" />
        )}
      </button>

      {/* Bong bóng nhắc: tắt bảng rồi vẫn còn nằm góc màn hình cho tới khi chấm xong */}
      {nagging && !open && (
        <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-amber-300
                        bg-amber-50 pl-3 pr-1.5 py-1.5 shadow-pop text-[13px] text-amber-900">
          <Clock size={15} aria-hidden="true" />
          <button type="button" className="font-semibold cursor-pointer hover:underline"
            onClick={() => setOpen(true)}>
            {pending > 0 ? `Còn ${pending} người chưa chấm công` : 'Chưa chốt giờ tan làm'}
          </button>
          <button type="button" aria-label="Ẩn nhắc chấm công" title="Ẩn tới lần mở phần mềm sau"
            onClick={() => setNagging(false)}
            className="p-1 rounded-full hover:bg-amber-200/70 cursor-pointer">
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      )}

      {open && (
        <AttendanceBoard
          mode={mode}
          onMode={setMode}
          data={data}
          busy={busy}
          error={error}
          onReload={reload}
          onClose={close}
        />
      )}
    </>
  );
}

/** Bảng chấm công của cả tiệm trong một ngày. */
function AttendanceBoard({ mode, onMode, data, busy, error, onReload, onClose }) {
  const { toast, user } = useApp();
  const [rows, setRows] = useState({});          // employee_id -> { in_at, out_at, off, reason }
  const [saving, setSaving] = useState(false);
  const staff = useMemo(() => data?.staff || [], [data]);

  /* Điền sẵn: giờ vào theo hồ sơ, giờ ra theo hồ sơ — sửa tay được nếu đi sớm về muộn */
  useEffect(() => {
    const init = {};
    for (const s of staff) {
      init[s.employee_id] = {
        in_at: s.in_at || s.work_from || '07:00',
        out_at: s.out_at || (mode === 'out' ? (s.work_to || '17:00') : ''),
        off: s.status === 'off',
        reason: '',
      };
    }
    setRows(init);
  }, [staff, mode]);

  const set = (id, patch) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  const pendingIds = staff.filter((s) => !s.done).map((s) => s.employee_id);

  const markAll = (off) => {
    setRows((r) => {
      const c = { ...r };
      for (const s of staff) {
        if (s.status === 'off') continue;               // đã nghỉ rồi thì thôi
        c[s.employee_id] = { ...c[s.employee_id], off };
      }
      return c;
    });
  };

  const save = async (only) => {
    const list = (only || staff.map((s) => s.employee_id))
      .filter((id) => !staff.find((s) => s.employee_id === id)?.locked);
    if (!list.length) { toast('Không có ai để chấm', 'warn'); return; }
    setSaving(true);
    try {
      const res = await api.post('/attendance/today', {
        date: data.date,
        user_id: user?.id,
        rows: list.map((id) => ({
          employee_id: id,
          in_at: rows[id]?.off ? null : rows[id]?.in_at || null,
          out_at: rows[id]?.off ? null : rows[id]?.out_at || null,
          off: !!rows[id]?.off,
          reason: rows[id]?.reason || '',
        })),
      });
      onReload();
      const skipped = (res.skipped || []).length;
      toast(`Đã chấm công cho ${res.saved} người${skipped ? `, ${skipped} người bỏ qua` : ''}`,
        skipped ? 'warn' : 'ok', skipped ? 7000 : 4000);
      if (res.pending === 0) onClose();
    } catch (e) {
      toast(e.message, 'bad', 7000);
    } finally { setSaving(false); }
  };

  const title = mode === 'in' ? 'Chấm công đầu ca' : 'Chốt giờ tan làm';

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      subtitle={`Hôm nay ${vnDate(data?.date)} · tích ai đi làm, ai nghỉ rồi bấm xác nhận một lượt`}
      size="lg"
      footer={<>
        <span className="mr-auto text-[13px] text-muted-ink">
          {data?.pending > 0 ? `${data.pending} người chưa chấm` : 'Cả tiệm đã chấm xong'}
        </span>
        <Button onClick={onClose}>Để lát nữa</Button>
        {pendingIds.length > 0 && pendingIds.length < staff.length && (
          <Button onClick={() => save(pendingIds)} loading={saving}>
            Chỉ xác nhận {pendingIds.length} người chưa chấm
          </Button>
        )}
        <Button variant="primary" onClick={() => save()} loading={saving}>
          Xác nhận cả tiệm
        </Button>
      </>}
    >
      {error ? <ErrorBox error={error} onRetry={onReload} />
        : busy && !data ? <Spinner />
          : staff.length === 0 ? (
            <Empty icon={CalendarCheck} title="Chưa có nhân viên nào"
              message="Khai hồ sơ nhân viên ở mục Lương nhân viên thì bảng chấm công mới có người." />
          ) : (
            <div className="space-y-2.5">
              {data.shop_closed && (
                <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[13px] text-amber-900">
                  Hôm nay đã khai là <b>ngày tiệm nghỉ</b>
                  {data.shop_closed_note ? ` (${data.shop_closed_note})` : ''} — cả tiệm không tính lương ngày này.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                <div className="flex rounded-lg border border-line overflow-hidden text-[13px]">
                  {[['in', 'Giờ vào làm'], ['out', 'Giờ tan làm']].map(([k, lb]) => (
                    <button key={k} type="button" onClick={() => onMode(k)}
                      aria-pressed={mode === k}
                      className={`px-2.5 py-1 cursor-pointer ${mode === k ? 'bg-accent text-white font-semibold' : 'hover:bg-muted'}`}>
                      {lb}
                    </button>
                  ))}
                </div>
                <div className="flex-1" />
                <Button size="sm" onClick={() => markAll(false)}>Cả tiệm đi làm</Button>
                <Button size="sm" onClick={() => markAll(true)}>Cả tiệm nghỉ</Button>
              </div>

              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Nhân viên</th>
                      <th style={{ width: 120 }}>Giờ vào</th>
                      <th style={{ width: 120 }}>Giờ ra</th>
                      <th style={{ width: 150 }}>Nghỉ cả ngày</th>
                      <th style={{ width: 96 }}>Hôm nay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map((s) => {
                      const r = rows[s.employee_id] || {};
                      const off = !!r.off;
                      return (
                        <tr key={s.employee_id} className={off ? 'bg-muted/50' : ''}>
                          <td>
                            <div className="font-medium">{s.full_name}</div>
                            <div className="text-2xs text-muted-ink">
                              {s.code} · giờ làm {s.work_from}–{s.work_to}
                              {s.pay_mode === 'daily' ? ' · trả theo ngày' : ''}
                            </div>
                          </td>
                          <td>
                            <Input type="time" size="sm" value={r.in_at || ''} disabled={off}
                              aria-label={`Giờ vào của ${s.full_name}`}
                              onChange={(e) => set(s.employee_id, { in_at: e.target.value })} />
                          </td>
                          <td>
                            <Input type="time" size="sm" value={r.out_at || ''} disabled={off}
                              aria-label={`Giờ ra của ${s.full_name}`}
                              onChange={(e) => set(s.employee_id, { out_at: e.target.value })} />
                          </td>
                          <td>
                            <label className="flex items-center gap-1.5 text-[13px] cursor-pointer">
                              <input type="checkbox" className="w-4 h-4 accent-amber-600"
                                checked={off}
                                disabled={s.status === 'off' && s.off_type === 'closed_day'}
                                onChange={(e) => set(s.employee_id, { off: e.target.checked })} />
                              <span>{off ? 'Nghỉ — có trừ lương' : 'Đi làm'}</span>
                            </label>
                            {off && s.status !== 'off' && (
                              <Input size="sm" className="mt-1" placeholder="Lý do (không bắt buộc)"
                                aria-label={`Lý do nghỉ của ${s.full_name}`}
                                value={r.reason || ''}
                                onChange={(e) => set(s.employee_id, { reason: e.target.value })} />
                            )}
                          </td>
                          <td>
                            {s.status === 'off'
                              ? <Badge tone="warn">{s.off_type === 'closed_day' ? 'Tiệm nghỉ' : 'Đã báo nghỉ'}</Badge>
                              : s.done
                                ? <Badge tone="ok">Đã chấm{s.out_at ? ' đủ' : ''}</Badge>
                                : <Badge tone="mute">Chưa chấm</Badge>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="text-2xs text-muted-ink">
                Chấm công để theo dõi giờ giấc, <b>không trừ lương</b> — hôm nào quên chấm cũng không ai
                mất công. Chỉ ô <b>Nghỉ cả ngày</b> là ghi vào sổ lương và có trừ tiền.
              </p>
            </div>
          )}
    </Modal>
  );
}
