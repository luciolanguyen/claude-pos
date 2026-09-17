/* ====================================================================
   BÁO CÁO & ĐỐI SOÁT ĐỐI TÁC VÃNG LAI (tài liệu 24, mục 5.3)

   Ngoài quầy bán giùm hàng của anh ruột, cô Hà, chú Tư. Cuối tuần hoặc
   cuối tháng kế toán ngồi chốt: mỗi người bán được bao nhiêu, tiệm giữ
   bao nhiêu hoa hồng, còn phải trả lại bao nhiêu.

   Ba việc trên một màn hình:
     1. Tích chọn MỘT người, NHIỀU người, hoặc TẤT CẢ để chốt gộp một đợt.
     2. Gom theo ngày, theo tuần, theo tháng — hoặc chốt từng dòng lẻ.
     3. Chốt xong khoá cứng: dòng đã chốt không vào đợt sau được nữa,
        hoa hồng vào doanh thu tiệm, và in phiếu chi riêng cho từng người.

   Đợt 4 plan 31 (hạng mục 4b): đợt chốt "trả sau" chi tiền được về sau,
   in lại phiếu đối soát từng đợt, và in phiếu đối chiếu công nợ theo kỳ
   cho chủ hàng ký xác nhận.
   ==================================================================== */
import { useState, useMemo, useEffect } from 'react';
import {
  Handshake, Users, Wallet, Check, Printer, Lock, CalendarRange, Plus, Pencil, FileText, Banknote,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch } from '../lib/store';
import { money, n, date, datetime, match } from '../lib/format';
import {
  Button, IconButton, Input, Select, Modal, Field, Empty, Spinner, Badge, Stat,
  Tabs, SearchInput, MoneyInput, ErrorBox, Confirm, Pager,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import CashVoucherPrint from '../components/CashVoucherPrint';
import ConsignStatementPrint from '../components/ConsignStatementPrint';

/* Khoảng ngày dựng sẵn: gom theo ngày, theo tuần, theo tháng (mục 5.3) */
const iso = (d) => d.toLocaleDateString('sv-SE');
const RANGES = [
  { key: 'all', label: 'Tất cả chưa chốt', range: () => ({ from: '', to: '' }) },
  {
    key: 'today',
    label: 'Trong ngày',
    range: () => ({ from: iso(new Date()), to: iso(new Date()) }),
  },
  {
    key: 'week',
    label: '7 ngày gần đây',
    range: () => {
      const to = new Date();
      const from = new Date(Date.now() - 6 * 86400000);
      return { from: iso(from), to: iso(to) };
    },
  },
  {
    key: 'month',
    label: 'Tháng này',
    range: () => {
      const now = new Date();
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
    },
  },
];

export default function Consign() {
  const { toast, user } = useApp();
  const [tab, setTab] = useState('open');
  return (
    <Page>
      <PageHeader
        title="Đối tác vãng lai"
        subtitle="Hàng người khác gửi bán qua tiệm — theo dõi công nợ và chốt đối soát"
        icon={Handshake}
      />
      <div className="card">
        <Tabs
          value={tab}
          onChange={setTab}
          className="px-2 pt-1"
          tabs={[
            { key: 'open', label: 'Chờ đối soát' },
            { key: 'done', label: 'Đã chốt' },
            { key: 'partners', label: 'Hồ sơ chủ hàng' },
          ]}
        />
        {tab === 'open' && <OpenTab toast={toast} user={user} />}
        {tab === 'done' && <DoneTab />}
        {tab === 'partners' && <PartnersTab toast={toast} />}
      </div>
    </Page>
  );
}

/* ==================== 1. CHỜ ĐỐI SOÁT ============================= */

function OpenTab({ toast, user }) {
  const [rangeKey, setRangeKey] = useState('all');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const preset = RANGES.find((x) => x.key === rangeKey) || RANGES[0];
  const range = rangeKey === 'custom' ? custom : preset.range();

  const { data, busy, error, reload } = useFetch(
    () => api.consignSummary(range), [rangeKey, range.from, range.to]);
  const rows = Array.isArray(data) ? data : [];

  /* Tích chọn: một người, nhiều người, hoặc tất cả (tài liệu 24, mục 5.3) */
  const [picked, setPicked] = useState([]);
  const [detailOf, setDetailOf] = useState(null);
  const [settling, setSettling] = useState(false);
  const [made, setMade] = useState(null);         // kết quả vừa chốt, để in

  const chosen = rows.filter((x) => picked.includes(x.partner_id));
  const sums = chosen.reduce((a, x) => ({
    gross: a.gross + x.gross,
    commission: a.commission + x.commission,
    payable: a.payable + x.payable,
    items: a.items + x.item_count,
  }), { gross: 0, commission: 0, payable: 0, items: 0 });
  const allSums = rows.reduce((a, x) => ({
    gross: a.gross + x.gross, commission: a.commission + x.commission,
    payable: a.payable + x.payable, items: a.items + x.item_count,
  }), { gross: 0, commission: 0, payable: 0, items: 0 });

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const allOn = rows.length > 0 && picked.length === rows.length;

  return (
    <div className="p-3 space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Chủ hàng còn nợ" value={n(rows.length)} icon={Users} />
        <Stat label="Tổng tiền bán hộ" value={money(allSums.gross)} icon={Handshake} />
        <Stat label="Hoa hồng tiệm giữ" value={money(allSums.commission)} icon={Wallet} tone="good" />
        <Stat label="Còn phải trả chủ hàng" value={money(allSums.payable)} icon={Wallet}
          tone={allSums.payable > 0 ? 'warn' : 'default'} />
      </div>

      {/* Gom ngày linh hoạt */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <CalendarRange size={14} className="text-muted-ink" aria-hidden="true" />
        <span className="text-2xs text-muted-ink">Gom theo:</span>
        {RANGES.map((x) => (
          <button key={x.key} type="button" onClick={() => { setRangeKey(x.key); setPicked([]); }}
            aria-pressed={rangeKey === x.key}
            className={`btn btn-sm ${rangeKey === x.key ? 'btn-secondary' : 'btn-outline'}`}>
            {x.label}
          </button>
        ))}
        <button type="button" onClick={() => setRangeKey('custom')}
          aria-pressed={rangeKey === 'custom'}
          className={`btn btn-sm ${rangeKey === 'custom' ? 'btn-secondary' : 'btn-outline'}`}>
          Chọn ngày
        </button>
        {rangeKey === 'custom' && (
          <>
            <Input type="date" size="sm" className="!w-36" aria-label="Từ ngày"
              value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <span className="text-2xs text-muted-ink">đến</span>
            <Input type="date" size="sm" className="!w-36" aria-label="Đến ngày"
              value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </>
        )}
      </div>

      {busy && !data ? <Spinner />
        : error ? <ErrorBox error={error} onRetry={reload} />
          : rows.length === 0 ? (
            <Empty icon={Check} title="Không còn gì để đối soát"
              message="Mọi khoản bán hộ trong khoảng đang xem đều đã chốt và trả tiền xong." />
          ) : (
            <>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-emerald-700 cursor-pointer"
                          checked={allOn}
                          onChange={() => setPicked(allOn ? [] : rows.map((x) => x.partner_id))}
                          aria-label="Chọn tất cả chủ hàng"
                        />
                      </th>
                      <th>Chủ hàng</th>
                      <th className="text-right">Số món</th>
                      <th className="text-right">Tiền bán hộ</th>
                      <th className="text-right">Hoa hồng tiệm</th>
                      <th className="text-right">Phải trả chủ</th>
                      <th>Khoảng ngày</th>
                      <th style={{ width: 70 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((x) => (
                      <tr key={x.partner_id} className="hoverable">
                        <td className="text-center">
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-emerald-700 cursor-pointer"
                            checked={picked.includes(x.partner_id)}
                            onChange={() => toggle(x.partner_id)}
                            aria-label={`Chọn ${x.partner_name} để chốt đối soát`}
                          />
                        </td>
                        <td>
                          <div className="font-medium">{x.partner_name}</div>
                          {x.partner_phone && (
                            <div className="text-2xs text-muted-ink tabular">{x.partner_phone}</div>
                          )}
                        </td>
                        <td className="num">{n(x.item_count)}</td>
                        <td className="num">{money(x.gross)}</td>
                        <td className="num text-emerald-700 font-semibold">{money(x.commission)}</td>
                        <td className="num font-bold">{money(x.payable)}</td>
                        <td className="text-2xs text-muted-ink whitespace-nowrap">
                          {x.from_date === x.to_date ? date(x.from_date) : `${date(x.from_date)} – ${date(x.to_date)}`}
                        </td>
                        <td className="text-center">
                          <Button size="sm" variant="outline" onClick={() => setDetailOf(x)}>
                            Chi tiết
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Thanh chốt gộp — chỉ hiện khi đã tích ai đó */}
              {picked.length > 0 && (
                <div className="card p-3 bg-accent-soft/40 border-accent/40 flex flex-wrap items-center gap-3">
                  <div className="text-[13px]">
                    Đang chọn <b>{n(picked.length)}</b> chủ hàng · <b>{n(sums.items)}</b> món ·
                    còn phải trả <b className="text-accent">{money(sums.payable)}</b>
                  </div>
                  <div className="flex-1" />
                  <Button onClick={() => setPicked([])}>Bỏ chọn</Button>
                  <Button variant="primary" icon={Lock} onClick={() => setSettling(true)}>
                    Chốt đối soát {n(picked.length)} chủ hàng
                  </Button>
                </div>
              )}
            </>
          )}

      <SettleModal
        open={settling}
        rows={chosen}
        range={range}
        user={user}
        onClose={() => setSettling(false)}
        onDone={(res) => {
          setSettling(false);
          setPicked([]);
          reload();
          setMade(res.settlements);
          toast(`Đã chốt ${res.count} phiếu đối soát`, 'ok', 6000);
        }}
      />

      <PartnerItemsModal
        partner={detailOf}
        range={range}
        onClose={() => setDetailOf(null)}
      />

      {made && <SettleResult list={made} onClose={() => setMade(null)} />}
    </div>
  );
}

/* ==================== HỘP CHỐT ĐỐI SOÁT =========================== */

function SettleModal({ open, rows, range, user, onClose, onDone }) {
  const [discount, setDiscount] = useState(0);
  const [pay, setPay] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const payable = rows.reduce((a, x) => a + x.payable, 0);
  const gross = rows.reduce((a, x) => a + x.gross, 0);
  const commission = rows.reduce((a, x) => a + x.commission, 0);
  const finalPay = Math.max(0, payable - Math.min(discount, payable));

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await api.settleConsign({
        partner_ids: rows.map((x) => x.partner_id),
        from: range.from || undefined,
        to: range.to || undefined,
        discount: Math.round(Number(discount) || 0),
        pay,
        note: note.trim() || null,
        user_id: user?.id || null,
      });
      onDone(res);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Chốt đối soát hàng gửi bán"
      subtitle={`${rows.length} chủ hàng — chốt xong là khoá cứng, không chốt lại được`}
      size="md"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" icon={Lock} onClick={submit} disabled={busy || !rows.length}>
          Chốt và {pay ? 'chi tiền' : 'ghi sổ'}
        </Button>
      </>}
    >
      <div className="space-y-3">
        {err && <ErrorBox error={err} />}

        <ul className="divide-y divide-line text-[13px]">
          {rows.map((x) => (
            <li key={x.partner_id} className="py-1.5 flex justify-between gap-2">
              <span>{x.partner_name} <span className="text-2xs text-muted-ink">({n(x.item_count)} món)</span></span>
              <span className="tabular font-semibold">{money(x.payable)}</span>
            </li>
          ))}
        </ul>

        <div className="space-y-1 text-[13px] border-t border-line pt-2">
          <div className="flex justify-between">
            <span className="text-muted-ink">Tổng tiền bán hộ</span>
            <span className="tabular">{money(gross)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-ink">Hoa hồng tiệm giữ</span>
            <span className="tabular text-emerald-700 font-semibold">{money(commission)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-ink">Phải trả chủ hàng</span>
            <span className="tabular font-semibold">{money(payable)}</span>
          </div>
        </div>

        <Field
          label="Chiết khấu gộp thêm"
          hint="Chia theo tỉ lệ tiền của từng chủ hàng, không chia đều đầu người. Để 0 nếu không thoả thuận gì thêm."
        >
          <MoneyInput value={discount} onChange={setDiscount} />
        </Field>

        <div className="flex items-baseline justify-between border-t border-line pt-2">
          <span className="font-semibold">Thực trả</span>
          <span className="text-xl font-bold text-accent tabular">{money(finalPay)}</span>
        </div>

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 accent-emerald-700 cursor-pointer mt-0.5"
            checked={pay} onChange={(e) => setPay(e.target.checked)} />
          <span className="text-[13px]">
            Lập phiếu chi tiền mặt luôn cho từng chủ hàng
            <span className="block text-2xs text-muted-ink">
              Mỗi người một phiếu riêng, không gộp chung — để sau này biết đã đưa ai bao nhiêu.
              Bỏ tích nếu chỉ chốt sổ, trả tiền sau.
            </span>
          </span>
        </label>

        <Field label="Ghi chú" htmlFor="st-note">
          <Input id="st-note" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Chốt hàng gửi tháng 9" />
        </Field>
      </div>
    </Modal>
  );
}

/** Danh sách phiếu vừa chốt, bấm in từng phiếu chi. */
function SettleResult({ list, onClose }) {
  const [printing, setPrinting] = useState(null);
  const { toast } = useApp();
  return (
    <>
      <Modal
        open
        onClose={onClose}
        title="Đã chốt đối soát"
        subtitle="Bấm In để lấy phiếu chi tiền mặt của từng chủ hàng"
        size="md"
        footer={<Button variant="primary" onClick={onClose}>Xong</Button>}
      >
        <ul className="divide-y divide-line">
          {list.map((x) => (
            <li key={x.id} className="py-2 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{x.partner_name}</div>
                <div className="text-2xs text-muted-ink">
                  {x.code} · {n(x.item_count)} món · hoa hồng {money(x.commission)}
                  {x.discount > 0 && ` · chiết khấu ${money(x.discount)}`}
                </div>
              </div>
              <span className="tabular font-bold">{money(x.payout)}</span>
              {x.cash_code && (
                <Button size="sm" variant="outline" icon={Printer}
                  onClick={async () => {
                    /* Lấy đúng chứng từ quỹ rồi mới in, để phiếu mang số dư
                       và người lập y như mọi phiếu chi khác của tiệm. */
                    try {
                      const full = await api.consignSettlement(x.id);
                      if (!full.cash_tx_id) throw new Error('chưa có phiếu chi');
                      setPrinting(await api.get(`/cash/transactions/${full.cash_tx_id}`));
                    } catch (e) { toast(`Chưa in được phiếu chi: ${e.message}. Vào Quỹ tiền in lại được.`, 'warn', 7000); }
                  }}>
                  In
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Modal>

      {printing && (
        <CashVoucherPrint voucher={printing} onClose={() => setPrinting(null)} />
      )}
    </>
  );
}

/** Bung từng dòng hàng của một chủ hàng trong khoảng đang xem. */
function PartnerItemsModal({ partner, range, onClose }) {
  const { data, busy, error, reload } = useFetch(
    () => api.consignItems({ partner_id: partner?.partner_id, status: 'open', ...range, page_size: 200 }),
    [partner?.partner_id, range.from, range.to], { skip: !partner });
  const rows = data?.rows || [];
  return (
    <Modal
      open={!!partner}
      onClose={onClose}
      title={`Hàng gửi bán — ${partner?.partner_name || ''}`}
      subtitle="Các món đã bán ra nhưng chưa chốt đối soát"
      size="lg"
      footer={<Button onClick={onClose}>Đóng</Button>}
    >
      {busy && !data ? <Spinner />
        : error ? <ErrorBox error={error} onRetry={reload} />
          : rows.length === 0 ? <Empty icon={Check} title="Không còn món nào chờ chốt" />
            : (
              <div className="table-wrap max-h-[56vh]">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Ngày</th>
                      <th>Hoá đơn</th>
                      <th>Tên món</th>
                      <th className="text-right">SL</th>
                      <th className="text-right">Giá bán</th>
                      <th className="text-right">Hoa hồng</th>
                      <th className="text-right">Trả chủ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((x) => (
                      <tr key={x.id} className="hoverable">
                        <td className="whitespace-nowrap text-2xs">{date(x.sale_ts)}</td>
                        <td className="font-mono text-2xs">{x.sale_code}</td>
                        <td>{x.name}</td>
                        <td className="num">{n(x.qty)} {x.unit_name || ''}</td>
                        <td className="num">{money(x.amount)}</td>
                        <td className="num text-emerald-700">{money(x.commission)}</td>
                        <td className="num font-semibold">{money(x.payable)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
    </Modal>
  );
}

/* ==================== 2. ĐÃ CHỐT ================================== */

function DoneTab() {
  const [page, setPage] = useState(1);
  const { data, busy, error, reload } = useFetch(
    () => api.consignSettlements({ page, page_size: 20 }), [page]);
  const rows = data?.rows || [];
  const [detailOf, setDetailOf] = useState(null);
  const [paying, setPaying] = useState(null);       // đợt chốt "trả sau" đang chi tiền

  return (
    <div className="p-3 space-y-3">
      {busy && !data ? <Spinner />
        : error ? <ErrorBox error={error} onRetry={reload} />
          : rows.length === 0 ? (
            <Empty icon={Lock} title="Chưa chốt đợt nào"
              message="Các đợt đối soát đã chốt sẽ nằm ở đây, kèm phiếu chi tiền đã lập." />
          ) : (
            <>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Phiếu</th>
                      <th>Chủ hàng</th>
                      <th>Khoảng ngày</th>
                      <th className="text-right">Số món</th>
                      <th className="text-right">Tiền bán hộ</th>
                      <th className="text-right">Hoa hồng</th>
                      <th className="text-right">Chiết khấu</th>
                      {/* Số phải trả sau chiết khấu — đã trả hay chưa xem cột Phiếu chi */}
                      <th className="text-right">Thực trả</th>
                      <th>Phiếu chi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((x) => (
                      <tr key={x.id} className="hoverable clickable" onClick={() => setDetailOf(x)}>
                        <td>
                          <div className="font-mono text-2xs font-semibold">{x.code}</div>
                          <div className="text-2xs text-muted-ink">{datetime(x.ts)}</div>
                        </td>
                        <td className="font-medium">{x.partner_name}</td>
                        <td className="text-2xs whitespace-nowrap">
                          {x.from_date === x.to_date ? date(x.from_date) : `${date(x.from_date)} – ${date(x.to_date)}`}
                        </td>
                        <td className="num">{n(x.item_count)}</td>
                        <td className="num">{money(x.gross)}</td>
                        <td className="num text-emerald-700">{money(x.commission)}</td>
                        <td className="num">{x.discount > 0 ? money(x.discount) : '—'}</td>
                        <td className="num font-bold">{money(x.payout)}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {x.cash_code
                            ? <Badge tone="ok">{x.cash_code}</Badge>
                            : x.payout > 0 ? (
                              <Button size="sm" variant="primary" icon={Banknote} onClick={() => setPaying(x)}
                                title="Đợt này chốt sổ mà chưa trả tiền — bấm để lập phiếu chi">
                                Chi tiền
                              </Button>
                            ) : <Badge tone="mute">Không phải trả</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
            </>
          )}

      <SettlementDetail
        id={detailOf?.id}
        onClose={() => setDetailOf(null)}
        onPay={(st) => { setDetailOf(null); setPaying(st); }}
      />
      <PaySettlementModal
        settlement={paying}
        onClose={() => setPaying(null)}
        onDone={() => reload()}
      />
    </div>
  );
}

/**
 * Chi tiền cho một đợt đã chốt mà lúc chốt chọn "chỉ ghi sổ, trả sau".
 * Chi xong in được phiếu chi ngay.
 */
function PaySettlementModal({ settlement, onClose, onDone }) {
  const { meta, toast, user } = useApp();
  const accounts = meta.accounts || [];
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [voucher, setVoucher] = useState(null);
  const [paid, setPaid] = useState(null);

  useEffect(() => {
    if (settlement) {
      setAccountId((accounts.find((a) => a.type === 'cash') || accounts[0])?.id || '');
      setErr(''); setPaid(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settlement?.id]);

  const pay = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await api.payConsignSettlement(settlement.id, { account_id: accountId || undefined, user_id: user?.id });
      setPaid(res);
      onDone?.();
      toast(`Đã chi ${money(res.payout)} cho ${settlement.partner_name} — phiếu ${res.cash_code}`, 'ok', 6000);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const printVoucher = async () => {
    try { setVoucher(await api.get(`/cash/transactions/${paid.cash_tx_id}`)); }
    catch (e) { toast(`Chưa in được phiếu chi: ${e.message}. Vào Quỹ tiền in lại được.`, 'warn', 7000); }
  };

  return (
    <>
      <Modal
        open={!!settlement && !voucher}
        onClose={onClose}
        title={paid ? 'Đã chi tiền' : `Chi tiền đợt ${settlement?.code || ''}`}
        subtitle={settlement ? `${settlement.partner_name} · ${n(settlement.item_count)} món` : ''}
        size="sm"
        footer={paid ? <>
          <Button onClick={onClose}>Xong</Button>
          <Button variant="primary" icon={Printer} onClick={printVoucher}>In phiếu chi</Button>
        </> : <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" icon={Banknote} onClick={pay} loading={busy}>
            Chi {money(settlement?.payout)}
          </Button>
        </>}
      >
        {settlement && (paid ? (
          <p className="text-[13px]">
            Đã lập phiếu chi <b className="font-mono">{paid.cash_code}</b> trả{' '}
            <b>{money(paid.payout)}</b> cho <b>{settlement.partner_name}</b>.
          </p>
        ) : (
          <div className="space-y-3">
            {err && <ErrorBox error={err} />}
            <div className="text-[13px] space-y-1">
              <div className="flex justify-between"><span className="text-muted-ink">Tiền bán hộ</span><span className="tabular">{money(settlement.gross)}</span></div>
              <div className="flex justify-between"><span className="text-muted-ink">Hoa hồng tiệm giữ</span><span className="tabular">− {money(settlement.commission)}</span></div>
              {settlement.discount > 0 && (
                <div className="flex justify-between"><span className="text-muted-ink">Chiết khấu</span><span className="tabular">− {money(settlement.discount)}</span></div>
              )}
              <div className="flex justify-between border-t border-line pt-1 font-bold">
                <span>Thực trả</span><span className="tabular text-accent">{money(settlement.payout)}</span>
              </div>
            </div>
            <Field label="Chi từ quỹ" htmlFor="csp-acc">
              <Select id="csp-acc" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
          </div>
        ))}
      </Modal>
      {voucher && <CashVoucherPrint voucher={voucher} onClose={() => { setVoucher(null); onClose(); }} />}
    </>
  );
}

function SettlementDetail({ id, onClose, onPay }) {
  const { data, busy } = useFetch(() => api.consignSettlement(id), [id], { skip: !id });
  const [printing, setPrinting] = useState(false);
  return (
    <>
    <Modal
      open={!!id && !printing}
      onClose={onClose}
      title={`Phiếu đối soát ${data?.code || ''}`}
      subtitle={data ? `${data.partner_name} · ${n(data.item_count)} món` : ''}
      size="lg"
      footer={<>
        {data && !data.cash_tx_id && data.payout > 0 && (
          <Button variant="primary" icon={Banknote} onClick={() => onPay?.(data)}>Chi tiền {money(data.payout)}</Button>
        )}
        <div className="flex-1" />
        <Button onClick={onClose}>Đóng</Button>
        <Button icon={Printer} onClick={() => setPrinting(true)} disabled={!data}>In phiếu đối soát</Button>
      </>}
    >
      {busy || !data ? <Spinner /> : (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-4 text-[13px]">
            <div><div className="text-2xs text-muted-ink">Tiền bán hộ</div><b className="tabular">{money(data.gross)}</b></div>
            <div><div className="text-2xs text-muted-ink">Hoa hồng tiệm</div><b className="tabular text-emerald-700">{money(data.commission)}</b></div>
            <div><div className="text-2xs text-muted-ink">Chiết khấu</div><b className="tabular">{money(data.discount)}</b></div>
            <div><div className="text-2xs text-muted-ink">Thực trả</div><b className="tabular text-accent">{money(data.payout)}</b></div>
          </div>
          <div className="table-wrap max-h-[50vh]">
            <table className="data">
              <thead>
                <tr>
                  <th>Ngày</th><th>Hoá đơn</th><th>Tên món</th>
                  <th className="text-right">SL</th><th className="text-right">Tiền bán</th>
                  <th className="text-right">Hoa hồng</th><th className="text-right">Trả chủ</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((x) => (
                  <tr key={x.id}>
                    <td className="text-2xs whitespace-nowrap">{date(x.sale_ts)}</td>
                    <td className="font-mono text-2xs">{x.sale_code}</td>
                    <td>{x.name}</td>
                    <td className="num">{n(x.qty)} {x.unit_name || ''}</td>
                    <td className="num">{money(x.amount)}</td>
                    <td className="num text-emerald-700">{money(x.commission)}</td>
                    <td className="num font-semibold">{money(x.payable)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[13px]">
            {data.cash_code
              ? <>Đã chi tiền — phiếu chi <b className="font-mono">{data.cash_code}</b>{data.paid_at ? ` ngày ${date(data.paid_at)}` : ''}.</>
              : <span className="text-warn font-semibold">Chưa chi tiền cho chủ hàng.</span>}
          </p>
        </div>
      )}
    </Modal>
    {printing && data && <ConsignStatementPrint settlement={data} onClose={() => setPrinting(false)} />}
    </>
  );
}

/* ==================== 3. HỒ SƠ CHỦ HÀNG =========================== */

function PartnersTab({ toast }) {
  const [q, setQ] = useState('');
  const { data, busy, error, reload } = useFetch(() => api.consignPartners(), []);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [stmtOf, setStmtOf] = useState(null);       // chủ hàng đang lập phiếu đối chiếu
  const rows = useMemo(() => {
    const list = Array.isArray(data) ? data : [];
    return q.trim() ? list.filter((x) => match(x.name, q) || (x.phone || '').includes(q.trim())) : list;
  }, [data, q]);

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <SearchInput value={q} onChange={setQ} className="flex-1"
          placeholder="Gõ tên hoặc số điện thoại chủ hàng..." />
        <Button variant="primary" icon={Plus} onClick={() => setEditing({})}>Thêm chủ hàng</Button>
      </div>

      {busy && !data ? <Spinner />
        : error ? <ErrorBox error={error} onRetry={reload} />
          : rows.length === 0 ? (
            <Empty icon={Users} title="Chưa có chủ hàng nào"
              message="Thêm hồ sơ ở đây, hoặc thêm nhanh ngay lúc bán ngoài màn hình bán hàng." />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Tên chủ hàng</th>
                    <th>Điện thoại</th>
                    <th>Ghi chú</th>
                    <th className="text-right">Món chờ chốt</th>
                    <th className="text-right">Đang nợ chủ hàng</th>
                    <th style={{ width: 120 }} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((x) => (
                    <tr key={x.id} className={`hoverable ${x.active ? '' : 'opacity-55'}`}>
                      <td className="font-medium">
                        {x.name}
                        {!x.active && <Badge tone="mute" className="ml-1">Ngừng</Badge>}
                      </td>
                      <td className="tabular">{x.phone || '—'}</td>
                      <td className="text-2xs text-muted-ink">{x.note || '—'}</td>
                      <td className="num">{n(x.open_items)}</td>
                      <td className="num">
                        <div className="font-semibold">{x.owed > 0 ? money(x.owed) : '—'}</div>
                        {x.unpaid_settled > 0 && (
                          <div className="text-2xs text-warn">gồm {money(x.unpaid_settled)} đã chốt chưa trả</div>
                        )}
                      </td>
                      <td className="text-center whitespace-nowrap">
                        <IconButton icon={FileText} size={14} label={`Đối chiếu công nợ với ${x.name}`}
                          onClick={() => setStmtOf(x)} />
                        <IconButton icon={Pencil} size={14} label={`Sửa ${x.name}`}
                          onClick={() => setEditing(x)} />
                        <IconButton icon={Lock} size={14} label={`Ngừng dùng ${x.name}`}
                          className="!text-danger" onClick={() => setRemoving(x)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

      <StatementModal partner={stmtOf} onClose={() => setStmtOf(null)} />

      <PartnerForm
        value={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); reload(); }}
        toast={toast}
      />

      <Confirm
        open={!!removing}
        title={`Ngừng dùng "${removing?.name}"?`}
        message="Đã từng gửi bán thì hồ sơ không xoá hẳn được — hệ thống chuyển sang Ngừng hoạt động để hoá đơn cũ vẫn tra ra đúng người."
        confirmText="Ngừng dùng"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          try {
            const res = await api.deleteConsignPartner(removing.id);
            toast(res.deleted ? 'Đã xoá chủ hàng' : 'Đã chuyển sang ngừng hoạt động', 'ok');
            reload();
          } catch (e) { toast(e.message, 'bad'); } finally { setRemoving(null); }
        }}
      />
    </div>
  );
}

/* ==================== PHIẾU ĐỐI CHIẾU CÔNG NỢ ===================== */

const monthRange = (offset = 0) => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = offset === 0 ? now : new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: iso(first), to: iso(last) };
};

/**
 * Đối chiếu công nợ với một chủ hàng theo kỳ (plan 31, hạng mục 4b): xem
 * ngay trên màn hình rồi in cho chủ hàng ký.
 */
function StatementModal({ partner, onClose }) {
  const [range, setRange] = useState(monthRange(0));
  const [printing, setPrinting] = useState(false);
  useEffect(() => { if (partner) { setRange(monthRange(0)); setPrinting(false); } }, [partner?.id]);
  const { data, busy, error, reload } = useFetch(
    () => api.consignStatement({ partner_id: partner?.id, from: range.from, to: range.to }),
    [partner?.id, range.from, range.to], { skip: !partner || !range.from || !range.to });

  const presets = [
    ['Tháng này', monthRange(0)],
    ['Tháng trước', monthRange(-1)],
    ['Từ đầu năm', { from: `${new Date().getFullYear()}-01-01`, to: iso(new Date()) }],
  ];

  return (
    <>
      <Modal
        open={!!partner && !printing}
        onClose={onClose}
        title={`Đối chiếu công nợ — ${partner?.name || ''}`}
        subtitle="Xem trước số liệu, rồi in cho chủ hàng ký xác nhận"
        size="lg"
        footer={<>
          <div className="flex-1" />
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" icon={Printer} disabled={!data || busy} onClick={() => setPrinting(true)}>
            In phiếu đối chiếu
          </Button>
        </>}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {presets.map(([label, r]) => (
              <button key={label} type="button" onClick={() => setRange(r)}
                aria-pressed={range.from === r.from && range.to === r.to}
                className={`btn btn-sm ${range.from === r.from && range.to === r.to ? 'btn-secondary' : 'btn-outline'}`}>
                {label}
              </button>
            ))}
            <Input type="date" size="sm" className="!w-36" aria-label="Từ ngày"
              value={range.from} onChange={(e) => setRange((x) => ({ ...x, from: e.target.value }))} />
            <span className="text-2xs text-muted-ink">đến</span>
            <Input type="date" size="sm" className="!w-36" aria-label="Đến ngày"
              value={range.to} onChange={(e) => setRange((x) => ({ ...x, to: e.target.value }))} />
          </div>

          {busy && !data ? <Spinner />
            : error ? <ErrorBox error={error} onRetry={reload} />
              : data && (
                <>
                  <div className="grid gap-2 sm:grid-cols-4">
                    <Stat label="Nợ đầu kỳ" value={money(data.opening)} icon={Wallet} />
                    <Stat label={`Phải trả thêm (${n(data.sold_totals.count)} món)`} value={money(data.sold_totals.payable)} icon={Handshake} />
                    <Stat label="Đã trả + chiết khấu" value={money(data.paid + data.discount)} icon={Banknote} />
                    <Stat label={data.closing >= 0 ? 'Còn nợ cuối kỳ' : 'Chủ hàng nợ tiệm'} value={money(Math.abs(data.closing))}
                      icon={Wallet} tone={data.closing > 0 ? 'warn' : 'default'} />
                  </div>
                  <div className="table-wrap max-h-[40vh]">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Ngày</th><th>Hoá đơn</th><th>Tên món</th>
                          <th className="text-right">Tiền bán</th><th className="text-right">Hoa hồng</th>
                          <th className="text-right">Phải trả</th><th>Đợt chốt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.sold.map((x) => (
                          <tr key={x.id}>
                            <td className="text-2xs whitespace-nowrap">{date(x.sale_ts)}</td>
                            <td className="font-mono text-2xs">{x.sale_code}</td>
                            <td>{x.name} <span className="text-2xs text-muted-ink">· {n(x.qty)} {x.unit_name || ''}</span></td>
                            <td className="num">{money(x.amount)}</td>
                            <td className="num text-emerald-700">{money(x.commission)}</td>
                            <td className="num font-semibold">{money(x.payable)}</td>
                            <td className="text-2xs">{x.settlement_code || <Badge tone="warn">Chưa chốt</Badge>}</td>
                          </tr>
                        ))}
                        {!data.sold.length && (
                          <tr><td colSpan={7} className="text-center text-2xs text-muted-ink">Không bán món nào của chủ hàng này trong kỳ</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {data.payments.length > 0 && (
                    <p className="text-[13px]">
                      Đã trả trong kỳ:{' '}
                      {data.payments.map((p) => `${p.code} (${date(p.ts)}) ${money(p.amount)}`).join(' · ')}
                    </p>
                  )}
                </>
              )}
        </div>
      </Modal>
      {printing && data && <ConsignStatementPrint statement={data} onClose={() => setPrinting(false)} />}
    </>
  );
}

function PartnerForm({ value, onClose, onSaved, toast }) {
  const [f, setF] = useState({ name: '', phone: '', note: '', active: 1 });
  const [busy, setBusy] = useState(false);
  const open = !!value;

  useMemo(() => {
    if (value) {
      setF({
        name: value.name || '', phone: value.phone || '',
        note: value.note || '', active: value.active === 0 ? 0 : 1,
      });
    }
  }, [value]);

  const save = async () => {
    if (!f.name.trim()) { toast('Bắt buộc nhập tên chủ hàng.', 'warn'); return; }
    setBusy(true);
    try {
      if (value?.id) await api.updateConsignPartner(value.id, f);
      else await api.addConsignPartner(f);
      onSaved();
      toast('Đã lưu hồ sơ chủ hàng', 'ok');
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={value?.id ? `Sửa chủ hàng: ${value.name}` : 'Thêm chủ hàng vãng lai'}
      size="sm"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={save} disabled={busy}>Lưu</Button>
      </>}
    >
      <div className="space-y-3">
        <Field label="Tên chủ hàng" required htmlFor="cp-name">
          <Input id="cp-name" value={f.name} autoFocus
            onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))}
            placeholder="Anh Ruột, Cô Hà..." />
        </Field>
        <Field label="Điện thoại" htmlFor="cp-phone">
          <Input id="cp-phone" value={f.phone}
            onChange={(e) => setF((x) => ({ ...x, phone: e.target.value }))} />
        </Field>
        <Field label="Ghi chú" htmlFor="cp-note">
          <Input id="cp-note" value={f.note}
            onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))}
            placeholder="Chuyên mô tơ bơm, hoa hồng thoả thuận 10%" />
        </Field>
        {value?.id && (
          <label className="flex items-center gap-2 text-[13px] cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-emerald-700 cursor-pointer"
              checked={f.active === 1}
              onChange={(e) => setF((x) => ({ ...x, active: e.target.checked ? 1 : 0 }))} />
            Còn gửi bán
          </label>
        )}
      </div>
    </Modal>
  );
}
