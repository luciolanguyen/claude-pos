/* ====================================================================
   THEO DÕI GIAO HÀNG VÀ ĐỐI SOÁT THU HỘ (tài liệu 04)

   Hai chuyện tách riêng, vì hàng tới tay khách chưa có nghĩa là tiền đã
   về két:

   Chặng giao hàng
     Chờ lấy hàng → Đang giao hàng → Giao thành công
                                   ↘ Thất bại / Chuyển hoàn

   Tiền thu hộ (COD)
     Chờ đối soát COD → Đã thu tiền thành công

   Tiền COD KHÔNG phải nợ của khách: khách đã trả tận tay người giao. Nó
   nằm ở "Phải thu từ đối tác vận chuyển" cho tới khi người giao nộp về và
   quầy bấm Xác nhận đối soát — lúc đó mới ghi phiếu thu vào quỹ.

   Giao thất bại thì khoản thu hộ tự huỷ. Hàng quay về KHÔNG tự cộng lại
   kho: người có quyền huỷ hoá đơn phải huỷ hoá đơn đó để nhập lại kho —
   việc đó sinh chứng từ riêng, không để một cú đổi trạng thái âm thầm làm.
   ==================================================================== */
import { useState, useEffect } from 'react';
import {
  Truck, Package, CheckCircle2, Banknote, Undo2, Printer, Clock, AlertTriangle,
  MapPin, Phone, X, Wallet,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, useDebounced } from '../lib/store';
import { money, n, date, smartTime, ROLE_LABEL } from '../lib/format';
import {
  Button, IconButton, Input, Select, Modal, Field, MoneyInput, Empty,
  Spinner, Textarea, SearchInput, ErrorBox, Confirm,
} from './ui';
import DeliveryNotePrint from './DeliveryNotePrint';

/** Chặng giao hàng: nhãn, màu, icon, chữ trên nút chuyển sang chặng đó. */
export const DELIVERY_STEPS = {
  pending: { label: 'Chờ lấy hàng', tone: 'slate', icon: Package, action: 'Chờ lấy hàng',
    hint: 'Hàng còn ở tiệm, chưa có ai cầm đi' },
  shipping: { label: 'Đang giao hàng', tone: 'amber', icon: Truck, action: 'Bắt đầu giao',
    hint: 'Người giao đã cầm hàng đi' },
  delivered: { label: 'Giao thành công', tone: 'emerald', icon: CheckCircle2, action: 'Giao thành công',
    hint: 'Khách đã nhận được hàng' },
  failed: { label: 'Thất bại / Chuyển hoàn', tone: 'red', icon: Undo2, action: 'Thất bại',
    hint: 'Khách không nhận, hàng quay về tiệm' },
};

/** Trạng thái tiền thu hộ, đi riêng với chặng giao hàng. */
export const COD_STEPS = {
  pending: { label: 'Chờ đối soát COD', tone: 'amber', icon: Clock,
    hint: 'Tiền còn ở người giao / đối tác vận chuyển' },
  collected: { label: 'Đã thu tiền thành công', tone: 'emerald', icon: Banknote,
    hint: 'Tiền thu hộ đã về quỹ' },
  cancelled: { label: 'Huỷ thu hộ', tone: 'slate', icon: X,
    hint: 'Giao thất bại nên không có tiền để thu' },
};

const TONE_CLASS = {
  slate: 'bg-slate-100 text-slate-700 border-slate-300',
  amber: 'bg-amber-100 text-amber-900 border-amber-300',
  emerald: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  red: 'bg-red-100 text-red-700 border-red-300',
};

/** Chặng kế tiếp gợi ý — để có nút bấm một phát. */
const NEXT_STEP = { pending: 'shipping', shipping: 'delivered' };

function Pill({ s, size }) {
  if (!s) return null;
  const Icon = s.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-semibold whitespace-nowrap
                  ${size === 'sm' ? 'text-2xs' : 'text-xs'} ${TONE_CLASS[s.tone]}`}
      title={s.hint}
    >
      <Icon size={size === 'sm' ? 11 : 12} aria-hidden="true" />
      {s.label}
    </span>
  );
}

export const StepBadge = ({ status, size = 'md' }) => <Pill s={DELIVERY_STEPS[status]} size={size} />;
export const CodBadge = ({ status, size = 'md' }) => <Pill s={COD_STEPS[status]} size={size} />;

/* ==================== NÚT ĐƠN ĐANG GIAO ============================ */

/** Chỉ hiện khi có đơn chưa xong — hàng chưa tới tay khách, hoặc tiền thu hộ chưa về. */
export function DeliveryBell({ onOpen }) {
  const { data, reload } = useFetch(() => api.get('/deliveries', { active: '1', page_size: 1 }), []);

  useEffect(() => {
    const t = setInterval(reload, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [reload]);

  const active = data?.total || 0;
  const pendingMoney = data?.pending_money || 0;
  if (!active) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative h-9 px-2.5 rounded border text-[13px] font-semibold hidden md:flex items-center gap-1.5
                 transition-colors duration-150 cursor-pointer
                 bg-white/10 border-white/15 text-slate-300 hover:text-white"
      title={pendingMoney > 0
        ? `${active} đơn chưa xong, ${money(pendingMoney)} thu hộ đang chờ đối soát`
        : `${active} đơn đang giao`}
      aria-label={`${active} đơn giao hàng chưa xong`}
    >
      <Truck size={14} aria-hidden="true" />
      {n(active)} đơn giao
    </button>
  );
}

/* ====================== BẢNG THEO DÕI ============================= */

export function DeliveryBoard({ open, onClose }) {
  const { user, toast } = useApp();
  const [filter, setFilter] = useState('');     // '' | chặng | 'cod:pending' | 'cod:collected'
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [onlyActive, setOnlyActive] = useState(true);
  const [printing, setPrinting] = useState(null);
  const [collecting, setCollecting] = useState(null);
  const [failing, setFailing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [showRecv, setShowRecv] = useState(false);

  const status = filter.startsWith('cod:') ? '' : filter;
  const cod = filter.startsWith('cod:') ? filter.slice(4) : '';

  const { data, busy, error, reload } = useFetch(
    () => api.get('/deliveries', {
      status, cod, q: dq, active: onlyActive && !filter ? '1' : '', page_size: 100,
    }),
    [status, cod, dq, onlyActive, open], { skip: !open });
  const { data: recv, reload: reloadRecv } = useFetch(() => api.codReceivables(), [open], { skip: !open });

  if (!open) return null;

  const rows = data?.rows || [];
  const counts = data?.counts || {};
  const codCounts = data?.cod_counts || {};
  const refresh = () => { reload(); reloadRecv(); };

  const step = async (row, next) => {
    if (next === 'failed') { setFailing(row); return; }
    try {
      await api.put(`/sales/${row.id}/delivery`, { delivery_status: next, user_id: user?.id });
      toast(`${row.code}: ${DELIVERY_STEPS[next].label.toLowerCase()}`, 'ok');
      refresh();
    } catch (e) {
      toast(e.message, 'bad', 6000);
    }
  };

  const markFailed = async () => {
    const row = failing;
    try {
      await api.put(`/sales/${row.id}/delivery`, { delivery_status: 'failed', user_id: user?.id });
      setFailing(null);
      toast(`${row.code}: giao thất bại — đã huỷ khoản thu hộ. Nhớ huỷ hoá đơn để nhập hàng lại kho.`, 'warn', 9000);
      refresh();
    } catch (e) {
      toast(e.message, 'bad', 7000);
    }
  };

  const openNote = async (row) => {
    try {
      setPrinting(await api.get(`/deliveries/${row.id}`));
    } catch (e) {
      toast(e.message, 'bad', 6000);
    }
  };

  const chip = (key, label, count, Icon, hint) => (
    <button
      key={key}
      type="button"
      onClick={() => setFilter(filter === key ? '' : key)}
      title={hint}
      aria-pressed={filter === key}
      className={`btn btn-sm ${filter === key ? 'btn-secondary' : 'btn-outline'}`}
    >
      {Icon && <Icon size={13} aria-hidden="true" />}
      {label}
      {count > 0 && <span className="ml-0.5 font-bold tabular">{n(count)}</span>}
    </button>
  );

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title="Theo dõi giao hàng"
        subtitle={data
          ? `${n(data.total)} đơn${data.pending_money > 0 ? ` · ${money(data.pending_money)} thu hộ chờ đối soát` : ''}`
          : ''}
        size="xl"
        footer={<Button onClick={onClose}>Đóng</Button>}
      >
        <div className="space-y-2.5">
          {recv?.total > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50">
              <button
                type="button"
                onClick={() => setShowRecv((v) => !v)}
                aria-expanded={showRecv}
                className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer min-h-[40px]"
              >
                <Wallet size={15} className="text-amber-800 shrink-0" aria-hidden="true" />
                <span className="text-[13px] text-amber-950 flex-1">
                  Phải thu từ đối tác vận chuyển: <b className="tabular">{money(recv.total)}</b>
                  <span className="text-amber-900/80"> · {n(recv.rows.length)} người / đối tác đang giữ tiền</span>
                </span>
                <span className="text-2xs font-semibold text-amber-900">{showRecv ? 'Thu gọn' : 'Xem ai đang giữ'}</span>
              </button>
              {showRecv && (
                <div className="border-t border-amber-200 px-3 py-2 overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-2xs text-amber-900/80 text-left">
                        <th className="py-1 font-semibold">Đang giữ tiền</th>
                        <th className="py-1 font-semibold text-right">Số đơn</th>
                        <th className="py-1 font-semibold text-right">Số tiền</th>
                        <th className="py-1 font-semibold text-right">Đơn cũ nhất</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recv.rows.map((r) => (
                        <tr key={r.partner} className="border-t border-amber-200/70">
                          <td className="py-1">{r.partner}</td>
                          <td className="py-1 text-right tabular">{n(r.orders)}</td>
                          <td className="py-1 text-right tabular font-semibold">{money(r.amount)}</td>
                          <td className="py-1 text-right text-amber-900/80 whitespace-nowrap">{date(r.oldest_ts)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={q} onChange={setQ}
              placeholder="Tìm mã hoá đơn, người nhận, địa chỉ, mã vận đơn, người giao..."
              className="w-full sm:w-96" />
            <div className="flex-1" />
            <label className="flex items-center gap-1.5 text-[13px] cursor-pointer select-none">
              <input type="checkbox" className="w-4 h-4 accent-emerald-700" checked={onlyActive}
                disabled={!!filter} onChange={(e) => setOnlyActive(e.target.checked)} />
              Chỉ đơn chưa xong
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setFilter('')} aria-pressed={filter === ''}
              className={`btn btn-sm ${filter === '' ? 'btn-secondary' : 'btn-outline'}`}>
              Tất cả
            </button>
            {Object.entries(DELIVERY_STEPS).map(([k, s]) => chip(k, s.label, counts[k], s.icon, s.hint))}
            <span className="w-px h-5 bg-line mx-0.5" aria-hidden="true" />
            {chip('cod:pending', COD_STEPS.pending.label, codCounts.pending, COD_STEPS.pending.icon, COD_STEPS.pending.hint)}
            {chip('cod:collected', COD_STEPS.collected.label, codCounts.collected, COD_STEPS.collected.icon, COD_STEPS.collected.hint)}
          </div>

          {error && <ErrorBox error={error} onRetry={reload} />}
          {busy && !data && <Spinner />}

          {data && rows.length === 0 && (
            <Empty
              icon={Truck}
              title="Không có đơn giao hàng nào"
              message={onlyActive && !filter
                ? 'Mọi đơn đã giao xong và tiền thu hộ đã đối soát.'
                : 'Hoá đơn có thông tin giao hàng sẽ hiện ở đây.'}
            />
          )}

          {rows.length > 0 && (
            <div className="table-wrap max-h-[50vh] overflow-y-auto">
              <table className="data">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th>Hoá đơn</th>
                    <th>Người nhận</th>
                    <th>Giao hàng</th>
                    <th className="text-right">Thu hộ (COD)</th>
                    <th>Người giao</th>
                    <th style={{ width: 250 }}>Việc tiếp theo</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const next = NEXT_STEP[row.delivery_status];
                    const codPending = row.cod_status === 'pending' && row.cod_left > 0 && row.delivery_status !== 'failed';
                    const late = row.days_out >= 3 && ['pending', 'shipping'].includes(row.delivery_status);
                    const shipper = row.shipper_user_name || row.shipper_name;
                    return (
                      <tr key={row.id} className="hoverable">
                        <td>
                          <button type="button" className="text-accent hover:underline font-semibold cursor-pointer"
                            onClick={() => setDetail(row)}>
                            {row.code}
                          </button>
                          <div className="text-2xs text-muted-ink whitespace-nowrap">
                            {date(row.ts)}
                            {late && <span className="ml-1 text-danger font-semibold">· {n(row.days_out)} ngày rồi</span>}
                          </div>
                        </td>
                        <td>
                          <div className="font-medium">{row.delivery_name || row.customer_name || 'Khách lẻ'}</div>
                          <div className="text-2xs text-muted-ink truncate" style={{ maxWidth: 220 }}>
                            {row.delivery_phone || row.customer_phone || ''}
                            {row.delivery_address ? ` · ${row.delivery_address}` : ''}
                          </div>
                        </td>
                        <td><StepBadge status={row.delivery_status} /></td>
                        <td className="text-right">
                          {row.cod_amount > 0 ? (
                            <>
                              <div className={`font-semibold tabular ${codPending ? 'text-amber-800' : ''}`}>
                                {money(codPending ? row.cod_left : row.cod_amount)}
                              </div>
                              <CodBadge status={row.cod_status} size="sm" />
                            </>
                          ) : (
                            <span className="text-2xs text-muted-ink">Không thu hộ</span>
                          )}
                        </td>
                        <td className="text-[13px]">
                          {shipper || row.carrier_name || <span className="text-muted-ink">—</span>}
                          {shipper && row.carrier_name && <div className="text-2xs text-muted-ink">{row.carrier_name}</div>}
                        </td>
                        <td>
                          <div className="flex items-center gap-1 flex-wrap">
                            {next && (
                              <Button size="sm" variant="secondary" icon={DELIVERY_STEPS[next].icon}
                                onClick={() => step(row, next)}>
                                {DELIVERY_STEPS[next].action}
                              </Button>
                            )}
                            {row.delivery_status === 'shipping' && (
                              <Button size="sm" variant="ghost" className="!text-danger" onClick={() => step(row, 'failed')}>
                                Thất bại
                              </Button>
                            )}
                            {codPending && (
                              <Button size="sm" variant="primary" icon={Banknote} onClick={() => setCollecting(row)}>
                                Xác nhận đối soát
                              </Button>
                            )}
                            <IconButton icon={Printer} label={`In phiếu giao ${row.code}`} onClick={() => openNote(row)} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      {printing && <DeliveryNotePrint note={printing} onClose={() => setPrinting(null)} />}

      {collecting && (
        <CollectFromShipper
          row={collecting}
          onClose={() => setCollecting(null)}
          onDone={() => { setCollecting(null); refresh(); }}
        />
      )}

      <Confirm
        open={!!failing}
        onClose={() => setFailing(null)}
        onConfirm={markFailed}
        title="Đánh dấu giao thất bại?"
        confirmText="Giao thất bại"
        message={failing && (
          <>
            Đơn <b>{failing.code}</b> sẽ chuyển sang <b>Thất bại / Chuyển hoàn</b>
            {failing.cod_left > 0 && <> và huỷ khoản thu hộ <b>{money(failing.cod_left)}</b></>}.
            {' '}Hàng quay về tiệm <b>không tự cộng lại kho</b> — người có quyền huỷ hoá đơn cần vào
            màn hình Hoá đơn huỷ {failing.code} để nhập lại kho.
          </>
        )}
      />

      {detail && (
        <DeliveryDetail
          row={detail}
          onClose={() => setDetail(null)}
          onChanged={refresh}
          onPrint={() => { openNote(detail); setDetail(null); }}
        />
      )}
    </>
  );
}

/* ================= NGƯỜI GIAO NỘP TIỀN THU HỘ ====================== */

/**
 * Xác nhận đối soát: người giao / đối tác nộp tiền thu hộ về. Việc này ghi
 * phiếu thu thật vào quỹ, nên hỏi lại rõ số tiền chứ không chỉ đổi một chữ
 * trạng thái — bấm nhầm là sổ quỹ sai mà không ai biết.
 */
function CollectFromShipper({ row, onClose, onDone }) {
  const { user, toast, meta } = useApp();
  const left = row.cod_left;
  const [amount, setAmount] = useState(left);
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const short = left - amount;
  const partner = row.carrier_name || row.shipper_user_name || row.shipper_name || 'người giao';

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await api.reconcileCod(row.id, {
        amount, account_id: accountId || null, user_id: user?.id, note: note.trim() || undefined,
      });
      const still = res.still_owed_by_partner || 0;
      toast(still > 0
        ? `Đã thu ${money(amount)} — ${partner} còn giữ ${money(still)}, đơn vẫn chờ đối soát`
        : `Đã thu đủ tiền thu hộ ${money(amount)}${res.receipt?.code ? ` — phiếu thu ${res.receipt.code}` : ''}`,
      still > 0 ? 'warn' : 'ok', 6000);
      onDone();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Xác nhận đối soát tiền thu hộ"
      subtitle={`${row.code} · ${partner}`}
      footer={<>
        <Button onClick={onClose} disabled={busy}>Huỷ</Button>
        <Button variant="primary" icon={Banknote} loading={busy} onClick={submit} disabled={busy || amount <= 0}>
          Thu {money(amount)} vào quỹ
        </Button>
      </>}
    >
      <div className="space-y-3">
        {err && <ErrorBox error={err} title="Chưa lưu được" />}

        <div className="rounded-lg bg-muted p-2.5 text-[13px] space-y-0.5">
          <div className="flex justify-between">
            <span className="text-muted-ink">Tổng tiền đơn hàng</span>
            <span className="font-semibold tabular">{money(row.total)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-ink">Tiền thu hộ của đơn</span>
            <span className="tabular">{money(row.cod_amount)}</span>
          </div>
          {row.cod_collected > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-ink">Đã nộp về trước đó</span>
              <span className="tabular">{money(row.cod_collected)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-line pt-1 mt-1">
            <span className="font-semibold">Còn phải nộp về</span>
            <span className="font-bold text-amber-800 tabular">{money(left)}</span>
          </div>
        </div>

        <Field label="Số tiền thực nhận" htmlFor="cod-amount">
          <MoneyInput id="cod-amount" value={amount} autoFocus
            onChange={(v) => setAmount(Math.max(0, Math.min(v, left)))} />
          <div className="flex gap-1 mt-1.5">
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setAmount(left)}>
              Đủ {money(left)}
            </button>
          </div>
        </Field>

        {short > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[13px] text-amber-900 flex items-start gap-1.5">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              Nộp thiếu <b>{money(short)}</b>. Phần thiếu vẫn là tiền {partner} đang giữ, đơn giữ
              trạng thái <b>Chờ đối soát COD</b>. Khách <b>không</b> bị ghi nợ — khách đã trả đủ cho người giao.
            </div>
          </div>
        )}

        <Field label="Nộp vào quỹ" htmlFor="cod-account">
          <Select id="cod-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Quỹ mặc định</option>
            {meta.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>

        <Field label="Ghi chú" hint="không bắt buộc" htmlFor="cod-note">
          <Input id="cod-note" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="VD: anh Hùng nộp lúc 5 giờ chiều" />
        </Field>
      </div>
    </Modal>
  );
}

/* ==================== XEM VÀ SỬA MỘT ĐƠN GIAO ===================== */

function DeliveryDetail({ row, onClose, onChanged, onPrint }) {
  const { user, toast } = useApp();
  const { data: carriers } = useFetch(() => api.carriers(), []);
  const { data: users } = useFetch(() => api.users(), []);
  const staff = (Array.isArray(users) ? users : []).filter((u) => u.active);

  const [mode, setMode] = useState(row.shipper_user_id ? 'staff' : (row.shipper_name || row.shipper_phone) ? 'free' : 'none');
  const [staffId, setStaffId] = useState(row.shipper_user_id || '');
  const [shipperName, setShipperName] = useState(row.shipper_user_id ? '' : (row.shipper_name || ''));
  const [shipperPhone, setShipperPhone] = useState(row.shipper_phone || '');
  const [tracking, setTracking] = useState(row.tracking_code || '');
  const [carrierId, setCarrierId] = useState(row.carrier_id || '');
  const [note, setNote] = useState(row.delivery_note || '');
  const [status, setStatus] = useState(row.delivery_status);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setBusy(true);
    setErr('');
    const staffUser = staff.find((u) => u.id === Number(staffId));
    try {
      await api.put(`/sales/${row.id}/delivery`, {
        delivery_status: status,
        shipper_user_id: mode === 'staff' ? Number(staffId) || null : null,
        shipper_name: mode === 'staff' ? staffUser?.full_name || null
          : mode === 'free' ? shipperName.trim() || null : null,
        shipper_phone: mode === 'free' ? shipperPhone.trim() || null : null,
        tracking_code: tracking,
        carrier_id: carrierId || null,
        delivery_note: note,
        user_id: user?.id,
      });
      toast('Đã lưu thông tin giao hàng', 'ok');
      onChanged?.();
      onClose();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  const steps = ['pending', 'shipping', row.delivery_status === 'failed' ? 'failed' : 'delivered'];
  const at = { shipping: row.shipped_at, delivered: row.delivered_at };
  const reached = row.delivery_status === 'failed' ? 2 : steps.indexOf(row.delivery_status);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Đơn giao ${row.code}`}
      subtitle={`${row.delivery_name || row.customer_name || 'Khách lẻ'} · ${date(row.ts)}`}
      footer={<>
        <Button icon={Printer} onClick={onPrint} className="mr-auto">In phiếu giao</Button>
        <Button onClick={onClose} disabled={busy}>Đóng</Button>
        <Button variant="primary" loading={busy} onClick={save} disabled={busy}>Lưu</Button>
      </>}
    >
      <div className="space-y-3">
        {err && <ErrorBox error={err} title="Chưa lưu được" />}

        <div className="flex items-center gap-1 overflow-x-auto pb-1" aria-label="Đường đi của đơn">
          {steps.map((k, i) => {
            const s = DELIVERY_STEPS[k];
            const Icon = s.icon;
            const done = reached >= i;
            const failedStep = k === 'failed';
            return (
              <div key={k} className="flex items-center gap-1 shrink-0">
                {i > 0 && <div className={`h-px w-5 ${done ? (failedStep ? 'bg-danger' : 'bg-accent') : 'bg-line'}`} />}
                <div className={`flex flex-col items-center gap-0.5 px-1.5 py-1 rounded
                                 ${done ? (failedStep ? 'text-danger' : 'text-accent') : 'text-muted-ink'}`}>
                  <Icon size={16} aria-hidden="true" />
                  <span className="text-2xs font-semibold whitespace-nowrap">{s.label}</span>
                  <span className="text-2xs whitespace-nowrap">
                    {at[k] ? smartTime(at[k]) : k === 'pending' ? smartTime(row.ts) : '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-lg bg-muted p-2.5 text-[13px] space-y-1">
          {row.delivery_address && (
            <div className="flex items-start gap-1.5">
              <MapPin size={14} className="shrink-0 mt-0.5 text-muted-ink" aria-hidden="true" />
              {row.delivery_address}
            </div>
          )}
          {(row.delivery_phone || row.customer_phone) && (
            <div className="flex items-center gap-1.5">
              <Phone size={14} className="shrink-0 text-muted-ink" aria-hidden="true" />
              {row.delivery_phone || row.customer_phone}
            </div>
          )}
          <div className="flex justify-between border-t border-line pt-1 mt-1">
            <span className="text-muted-ink">Tổng tiền đơn</span>
            <span className="font-semibold tabular">{money(row.total)}</span>
          </div>
          {row.cod_amount > 0 && (
            <div className="flex justify-between items-center gap-2">
              <span className="text-muted-ink">Thu hộ {money(row.cod_amount)}</span>
              <span className="flex items-center gap-1.5">
                {row.cod_left > 0 && <span className="font-bold text-amber-800 tabular">còn {money(row.cod_left)}</span>}
                <CodBadge status={row.cod_status} size="sm" />
              </span>
            </div>
          )}
        </div>

        <Field label="Chặng giao hàng" htmlFor="dd-status">
          <Select id="dd-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(DELIVERY_STEPS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </Select>
          {status === 'failed' && row.delivery_status !== 'failed' && (
            <p className="text-xs text-amber-800 mt-1 leading-relaxed">
              Khoản thu hộ sẽ huỷ. Hàng quay về tiệm không tự cộng lại kho — huỷ hoá đơn {row.code} ở
              màn hình Hoá đơn để nhập lại kho.
            </p>
          )}
        </Field>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="Đơn vị vận chuyển" htmlFor="dd-carrier">
            <Select id="dd-carrier" value={carrierId} onChange={(e) => setCarrierId(e.target.value)}>
              <option value="">— Không qua đối tác —</option>
              {(carriers || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Mã vận đơn" hint="không bắt buộc" htmlFor="dd-track">
            <Input id="dd-track" value={tracking} onChange={(e) => setTracking(e.target.value)} />
          </Field>
        </div>

        <div>
          <span className="label">Người giao trực tiếp</span>
          <div className="grid grid-cols-3 rounded border border-line overflow-hidden" role="radiogroup" aria-label="Người giao trực tiếp">
            {[['none', 'Không có'], ['staff', 'Nhân viên cửa hàng'], ['free', 'Shipper tự do']].map(([k, lb]) => (
              <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}
                className={`h-9 px-2 text-[13px] font-semibold transition-colors duration-100 cursor-pointer
                            ${mode === k ? 'bg-primary text-white' : 'bg-card hover:bg-muted'}`}>
                {lb}
              </button>
            ))}
          </div>
        </div>

        {mode === 'staff' && (
          <Field label="Nhân viên đi giao" htmlFor="dd-staff">
            <Select id="dd-staff" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">— Chọn nhân viên —</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name}{ROLE_LABEL[u.role] ? ` · ${ROLE_LABEL[u.role]}` : ''}</option>
              ))}
            </Select>
          </Field>
        )}
        {mode === 'free' && (
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Tên shipper" htmlFor="dd-sname">
              <Input id="dd-sname" value={shipperName} onChange={(e) => setShipperName(e.target.value)} />
            </Field>
            <Field label="Số điện thoại shipper" htmlFor="dd-sphone">
              <Input id="dd-sphone" value={shipperPhone} onChange={(e) => setShipperPhone(e.target.value)} inputMode="tel" />
            </Field>
          </div>
        )}

        <Field label="Ghi chú giao hàng" htmlFor="dd-note">
          <Textarea id="dd-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="VD: gọi trước khi tới, nhà có chó" />
        </Field>
      </div>
    </Modal>
  );
}
