/* ====================================================================
   BẢO HÀNH VÀ SỬA CHỮA

   Hai luồng (tài liệu 09):
     Bảo hành          hàng mua ở tiệm, còn hạn, đủ điều kiện
     Sửa chữa dịch vụ  hết hạn, lỗi người dùng, hàng mang từ ngoài vào

   Bảng chi phí ba nhóm: linh kiện (trong kho + mua ngoài), tiền công, phí
   phát sinh; trừ miễn giảm. Linh kiện trong kho chỉ trừ kho khi HOÀN THÀNH
   phiếu, nên hộp chọn linh kiện tăng giảm tuỳ ý, phiếu cập nhật theo ngay.
   ==================================================================== */
import { useState, useMemo, useEffect, useRef } from 'react';
import {
  ShieldCheck, Plus, Eye, Search, Clock, AlertTriangle, Truck, Wrench,
  PackageCheck, Printer, XCircle, Trash2, RefreshCw, CheckCircle2, ArrowRight,
  ShoppingCart, Minus, Save, Info, ArrowLeftRight, PackagePlus, User,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, usePaged, useDebounced } from '../lib/store';
import { money, n, short, qty as fq, datetime, date, isoDate, match } from '../lib/format';
import {
  Button, IconButton, SearchInput, Select, Modal, Spinner, Empty, Badge,
  Confirm, Field, MoneyInput, Textarea, Stat, Combo, QtyInput, Input, Tabs, Pager, ErrorBox,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import SaveDraftButton, { OpenDraftsButton } from '../components/DraftButtons';
import PhotoPicker, { PhotoGallery } from '../components/PhotoPicker';
import WarrantyReturnPrint from '../components/WarrantyReturnPrint';
import { ProductPicker } from '../components/ProductPicker';
import { CategorySelect } from '../components/CategoryTree';
import { PinApprovalModal } from '../components/PosApproval';
import { WarrantyFlag, WarrantyHistoryModal } from '../components/WarrantyHistory';

/* Trạng thái theo đúng thứ tự việc thật, kèm màu để liếc là biết. */
const STATUS = {
  received: { label: 'Mới nhận', tone: 'info', icon: PackageCheck },
  checking: { label: 'Đang kiểm tra', tone: 'info', icon: Search },
  repairing: { label: 'Đang sửa', tone: 'warn', icon: Wrench },
  sent_supplier: { label: 'Đã gửi hãng', tone: 'warn', icon: Truck },
  ready: { label: 'Xong, chờ lấy', tone: 'ok', icon: CheckCircle2 },
  delivered: { label: 'Đã trả khách', tone: 'mute', icon: CheckCircle2 },
  cancelled: { label: 'Đã huỷ', tone: 'mute', icon: XCircle },
};

const RESOLUTION = {
  repair: 'Tiệm tự sửa', supplier: 'Hãng/NCC sửa', exchange: 'Đổi cái mới',
  refund: 'Hoàn tiền', reject: 'Từ chối bảo hành',
};

const TYPES = {
  warranty: { label: 'Bảo hành', tone: 'ok', icon: ShieldCheck,
    hint: 'Hàng mua ở tiệm, còn hạn và đủ điều kiện bảo hành' },
  repair: { label: 'Sửa chữa dịch vụ', tone: 'info', icon: Wrench,
    hint: 'Hết hạn, lỗi người dùng hoặc hàng mang từ ngoài vào — tính phí 100%' },
};

const StatusBadge = ({ s }) => {
  const st = STATUS[s] || { label: s, tone: 'mute', icon: Clock };
  const Icon = st.icon;
  return <Badge tone={st.tone}><Icon size={10} aria-hidden="true" />{st.label}</Badge>;
};

const TypeBadge = ({ type }) => {
  const tp = TYPES[type] || TYPES.warranty;
  const Icon = tp.icon;
  return <Badge tone={tp.tone}><Icon size={10} aria-hidden="true" />{tp.label}</Badge>;
};

const ErrLine = ({ children }) => (
  <p role="alert" className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{children}</p>
);

/** Mọi nhóm con cháu của một nhóm hàng — lọc nhóm cha thì ra cả nhánh. */
function branchIds(categories, rootId) {
  if (!rootId) return null;
  const kids = new Map();
  for (const c of categories || []) {
    const p = c.parent_id || 0;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(c.id);
  }
  const out = new Set([Number(rootId)]);
  const stack = [Number(rootId)];
  while (stack.length) {
    const cur = stack.pop();
    for (const k of kids.get(cur) || []) if (!out.has(k)) { out.add(k); stack.push(k); }
  }
  return out;
}

export default function Warranty() {
  const [tab, setTab] = useState('tickets');

  return (
    <>
      <PageHeader
        title="Bảo hành & sửa chữa"
        subtitle="Tiếp nhận bảo hành, sửa chữa dịch vụ, và tra hạn bảo hành hàng đã bán"
      />
      <div className="bg-card border-b border-line px-4">
        <Tabs
          value={tab}
          onChange={setTab}
          className="!border-b-0"
          tabs={[
            { key: 'tickets', label: 'Phiếu bảo hành / sửa chữa' },
            { key: 'lookup', label: 'Tra hạn bảo hành' },
          ]}
        />
      </div>
      <Page>
        {tab === 'tickets' && <Tickets />}
        {tab === 'lookup' && <Lookup />}
      </Page>
    </>
  );
}

/* ==================================================================== */
/* Danh sách phiếu                                                       */
/* ==================================================================== */

function Tickets() {
  const { toast, store } = useApp();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [openOnly, setOpenOnly] = useState(true);

  const {
    rows: data, total: rowCount, busy, error, reload,
    page, setPage, pageSize, setPageSize,
  } = usePaged(
    (pg) => api.warranty({ q: dq, status, type, open_only: openOnly ? 1 : '', ...pg }),
    [dq, status, type, openOnly],
    { key: 'warranty' }
  );
  const { data: summary, reload: reloadSummary } = useFetch(() => api.warrantySummary(), []);

  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [printing, setPrinting] = useState(null);          // biên nhận lúc nhận máy
  const [returnPrint, setReturnPrint] = useState(null);    // phiếu trả hàng lúc trả máy

  const refresh = () => { reload(); reloadSummary(); };

  return (
    <div className="space-y-3">
      {summary && (
        <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
          <Stat label="Đang xử lý" value={n(summary.open)} icon={Wrench}
            sub={`BH ${n(summary.open_by_type?.warranty || 0)} · Sửa chữa ${n(summary.open_by_type?.repair || 0)}`}
            tone={summary.open > 0 ? 'warn' : 'default'} />
          <Stat label="Quá hẹn trả khách" value={n(summary.overdue.length)}
            tone={summary.overdue.length > 0 ? 'bad' : 'default'} icon={AlertTriangle} />
          <Stat label="Đang ở hãng" value={n(summary.at_supplier.length)} icon={Truck} />
          <Stat label="Thu tiền sửa 30 ngày" value={short(summary.last30.paid)}
            sub={`${summary.last30.n} phiếu · vốn linh kiện ${short(summary.last30.parts)}`} />
        </div>
      )}

      {/* Cảnh báo quá hẹn — thứ dễ mất lòng khách nhất */}
      {summary?.overdue.length > 0 && (
        <div className="card p-3 bg-red-50 border-danger/30">
          <div className="flex gap-2.5">
            <AlertTriangle size={17} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-danger text-[13px]">
                {summary.overdue.length} phiếu đã quá ngày hẹn trả khách
              </p>
              <ul className="text-[13px] text-red-900/85 mt-1 space-y-0.5">
                {summary.overdue.slice(0, 4).map((x) => (
                  <li key={x.id}>
                    <button onClick={() => setDetailId(x.id)} className="hover:underline cursor-pointer text-left">
                      <b className="font-mono">{x.code}</b> — {x.product_name} ·{' '}
                      {x.customer_display} {x.phone_display ? `(${x.phone_display})` : ''} ·{' '}
                      <b>trễ {x.days_late} ngày</b>
                    </button>
                  </li>
                ))}
              </ul>
              {summary.overdue.length > 4 && (
                <p className="text-2xs text-red-900/70 mt-1">và {summary.overdue.length - 4} phiếu khác</p>
              )}
            </div>
          </div>
        </div>
      )}

      {summary?.at_supplier.length > 0 && (
        <div className="card p-3 bg-amber-50 border-warn/30">
          <div className="flex gap-2.5">
            <Truck size={17} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-warn text-[13px]">{summary.at_supplier.length} món đang ở hãng</p>
              <ul className="text-[13px] text-amber-900/85 mt-1 space-y-0.5">
                {summary.at_supplier.slice(0, 4).map((x) => (
                  <li key={x.id}>
                    <b className="font-mono">{x.code}</b> — {x.product_name} · gửi{' '}
                    {x.supplier_name || 'hãng'} đã <b>{x.days_sent} ngày</b>
                    {x.expected_at && ` · hẹn trả ${date(x.expected_at)}`}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ}
          placeholder="Tìm mã phiếu, tên hàng, serial, tên hoặc SĐT khách..."
          className="w-full sm:w-80" />
        <div className="flex rounded-lg border border-line overflow-hidden" role="radiogroup" aria-label="Loại phiếu">
          {[['', 'Tất cả'], ['warranty', 'Bảo hành'], ['repair', 'Sửa chữa']].map(([k, lb]) => (
            <button key={k || 'all'} type="button" role="radio" aria-checked={type === k} onClick={() => setType(k)}
              className={`px-2.5 h-8 text-[13px] font-semibold cursor-pointer transition-colors duration-150
                          ${type === k ? 'bg-primary text-white' : 'bg-card hover:bg-muted'}`}>
              {lb}
            </button>
          ))}
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} size="sm" className="!w-auto" aria-label="Lọc trạng thái">
          <option value="">Mọi trạng thái</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <button onClick={() => setOpenOnly((v) => !v)}
          className={`btn btn-sm ${openOnly ? 'btn-secondary' : 'btn-outline'}`}>
          Chỉ phiếu chưa trả khách
        </button>
        <div className="flex-1" />
        <OpenDraftsButton kind="warranty" onOpen={(d) => setCreating(d)} />
        <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
          Tiếp nhận máy
        </Button>
      </div>

      {busy && !data ? <Spinner />
        : error ? <ErrorBox error={error} onRetry={reload} />
          : !data?.length ? (
            <Empty
              icon={ShieldCheck}
              title={openOnly ? 'Không có phiếu nào đang xử lý' : 'Chưa có phiếu nào'}
              message="Khách mang máy hư tới thì bấm Tiếp nhận máy để lập phiếu bảo hành hoặc sửa chữa và in biên nhận."
              action={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Tiếp nhận máy</Button>}
            />
          ) : (
            <div className="card">
            <div className="table-wrap table-scroll !border-0 !rounded-none">
              <table className="data">
                <thead>
                  <tr>
                    <th>Mã phiếu</th><th>Loại</th><th>Ngày nhận</th><th>Khách hàng</th><th>Hàng hoá</th>
                    <th>Lỗi</th><th>Trạng thái</th><th>Hẹn trả</th>
                    <th className="text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((t) => {
                    const late = t.promised_at && t.promised_at < isoDate() &&
                      !['delivered', 'cancelled'].includes(t.status);
                    return (
                      <tr key={t.id} className={`hoverable ${t.status === 'cancelled' ? 'opacity-55' : ''}`}>
                        <td>
                          <button onClick={() => setDetailId(t.id)}
                            className="font-mono font-semibold text-accent hover:underline cursor-pointer">
                            {t.code}
                          </button>
                          {t.in_warranty === 1 && <Badge tone="ok" className="ml-1">Còn BH</Badge>}
                        </td>
                        <td><TypeBadge type={t.ticket_type} /></td>
                        <td className="text-muted-ink whitespace-nowrap">
                          {date(t.ts)}
                          {!['delivered', 'cancelled'].includes(t.status) && (
                            <div className="text-2xs">đã {t.days_open} ngày</div>
                          )}
                        </td>
                        <td>
                          <div className="truncate max-w-[150px]">{t.customer_display || '—'}</div>
                          {t.phone_display && (
                            <a href={`tel:${t.phone_display}`} className="text-2xs text-accent hover:underline tabular">
                              {t.phone_display}
                            </a>
                          )}
                        </td>
                        <td>
                          <div className="font-semibold truncate max-w-[190px]">{t.product_name}</div>
                          {t.serial && <div className="text-2xs text-muted-ink font-mono">SN: {t.serial}</div>}
                        </td>
                        <td className="text-muted-ink truncate max-w-[190px]">{t.issue || '—'}</td>
                        <td>
                          <StatusBadge s={t.status} />
                          {t.resolution && <div className="text-2xs text-muted-ink mt-0.5">{RESOLUTION[t.resolution]}</div>}
                        </td>
                        <td className={late ? 'text-danger font-semibold' : 'text-muted-ink'}>
                          {t.promised_at ? date(t.promised_at) : '—'}
                          {late && <div className="text-2xs">quá hẹn</div>}
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-0.5">
                            <IconButton icon={Eye} label={`Xem phiếu ${t.code}`} size={14}
                              onClick={() => setDetailId(t.id)} />
                            <IconButton icon={Printer} label={`In biên nhận ${t.code}`} size={14}
                              onClick={async () => setPrinting(await api.warrantyTicket(t.id))} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={pageSize} total={rowCount} onPage={setPage} onPageSize={setPageSize} />
            </div>
          )}

      <TicketForm
        open={!!creating}
        draft={typeof creating === 'object' ? creating : null}
        onClose={() => setCreating(false)}
        onSaved={async (res) => {
          setCreating(false);
          refresh();
          toast(`Đã lập phiếu ${res.ticket_type === 'repair' ? 'sửa chữa' : 'bảo hành'} ${res.code}`, 'ok');
          setPrinting(await api.warrantyTicket(res.id));
        }}
      />

      {detailId && (
        <TicketDetail
          id={detailId}
          onClose={() => setDetailId(null)}
          onChanged={refresh}
          onPrint={setPrinting}
          onPrintReturn={setReturnPrint}
        />
      )}

      {printing && <ReceiptPrint ticket={printing} store={store} onClose={() => setPrinting(null)} />}
      {returnPrint && <WarrantyReturnPrint ticket={returnPrint} store={store} onClose={() => setReturnPrint(null)} />}
    </div>
  );
}

/* ==================================================================== */
/* Lập phiếu tiếp nhận                                                   */
/* ==================================================================== */

const EMPTY = {
  ticket_type: 'warranty', technician_id: null,
  customer_id: null, customer_name: '', customer_phone: '',
  sale_id: null, product_id: null, product_name: '', serial: '', qty: 1,
  issue: '', condition_note: '', accessories: '',
  in_warranty: false, warranty_until: '', promised_at: '', note: '',
};

function TicketForm({ open, onClose, onSaved, draft = null }) {
  const { user, toast } = useApp();
  const [form, setForm] = useState(EMPTY);
  const [photos, setPhotos] = useState([]);
  const [lookupQ, setLookupQ] = useState('');
  const [found, setFound] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [draftId, setDraftId] = useState(null);

  /* Một chỗ nạp duy nhất: mở phiếu tạm thì đổ nội dung cũ đè lên phiếu trắng */
  useEffect(() => {
    if (!open) return;
    setDraftId(draft?.id || null);
    setForm({ ...EMPTY, promised_at: isoDate(new Date(Date.now() + 5 * 86400000)), ...(draft?.payload?.form || {}) });
    setPhotos([]); setLookupQ(''); setFound(null); setErr('');
  }, [open, draft]);

  const { data: customers } = useFetch(() => api.customers({ active: 1 }), [], { skip: !open });
  const { data: products } = useFetch(() => api.posProducts(), [], { skip: !open });
  const { data: users } = useFetch(() => api.users(), [], { skip: !open });
  const staff = (Array.isArray(users) ? users : []).filter((u) => u.active);

  /* Tra hoá đơn cũ để lấy sẵn hàng, khách và hạn bảo hành */
  const doLookup = async () => {
    if (!lookupQ.trim()) return;
    try {
      const rows = await api.warrantyLookup(lookupQ.trim());
      setFound(rows);
      if (!rows.length) toast('Không tìm thấy hàng đã bán khớp thông tin này', 'warn');
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  const pickSold = (row) => {
    const inW = row.in_warranty === 1;
    setForm((f) => ({
      ...f,
      ticket_type: inW ? 'warranty' : 'repair',
      customer_id: row.customer_id || null,
      customer_name: row.customer_id ? '' : row.customer_name,
      customer_phone: row.customer_phone || '',
      sale_id: row.sale_id,
      product_id: row.product_id,
      product_name: row.product_name,
      serial: row.serial || '',
      in_warranty: inW,
      warranty_until: row.warranty_until || '',
    }));
    setFound(null);
    toast(inW
      ? `Còn bảo hành, hết hạn ${date(row.warranty_until)} — lập phiếu Bảo hành`
      : 'Hàng đã hết hạn bảo hành — chuyển sang Sửa chữa dịch vụ', inW ? 'ok' : 'warn', 5000);
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const save = async () => {
    if (!form.product_name.trim()) { setErr('Bắt buộc ghi tên hàng khách mang tới.'); return; }
    if (!form.customer_id && !form.customer_name.trim() && !form.customer_phone.trim()) {
      setErr('Ghi ít nhất tên hoặc số điện thoại của khách để còn gọi khi sửa xong.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const res = await api.post('/warranty', {
        ...form, qty: Number(form.qty) || 1,
        in_warranty: form.ticket_type === 'warranty' && form.in_warranty ? 1 : 0,
        received_by: user?.id,
        photos,
      });
      if (draftId) { try { await api.del(`/doc-drafts/${draftId}`); } catch { /* nháp mất rồi */ } }
      onSaved?.(res);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Tiếp nhận máy bảo hành / sửa chữa"
        subtitle="Lập phiếu và in biên nhận cho khách giữ"
        size="xl"
        footer={<>
          {/* Phiếu tạm KHÔNG mang theo ảnh: ảnh base64 vài megabyte nhét vào
              một ô văn bản chỉ làm phình cơ sở dữ liệu. */}
          <SaveDraftButton
            className="mr-auto"
            disabled={!form.product_name?.trim()}
            onSaved={(d) => setDraftId(d.id)}
            build={() => ({
              kind: 'warranty',
              id: draftId,
              title: `${TYPES[form.ticket_type]?.label || 'Bảo hành'} ${form.product_name || ''}`.trim(),
              partner_name: form.customer_name || null,
              item_count: 1,
              payload: { form },
            })}
          />
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" icon={Printer} onClick={save} loading={busy}>
            Lưu &amp; in biên nhận
          </Button>
        </>}
      >
        <div className="space-y-4">
          <div role="radiogroup" aria-label="Loại phiếu" className="grid gap-1.5 sm:grid-cols-2">
            {Object.entries(TYPES).map(([k, v]) => {
              const Icon = v.icon;
              const on = form.ticket_type === k;
              return (
                <label key={k}
                  className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer transition-colors duration-150
                              focus-within:ring-2 focus-within:ring-accent/40
                              ${on ? 'border-accent bg-accent-soft' : 'border-line hover:bg-muted'}`}>
                  <input type="radio" name="wt-type" value={k} checked={on} className="sr-only"
                    onChange={() => setForm((f) => ({ ...f, ticket_type: k, in_warranty: k === 'warranty' ? f.in_warranty : false }))} />
                  <Icon size={18} className={on ? 'text-emerald-800 mt-0.5' : 'text-muted-ink mt-0.5'} aria-hidden="true" />
                  <span>
                    <span className="block text-[13px] font-bold">{v.label}</span>
                    <span className="block text-2xs text-muted-ink">{v.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>

          {/* Tra hoá đơn cũ */}
          <div className="card p-3 bg-accent-soft/30 border-accent/25">
            <span className="label">Tra hàng đã bán (không bắt buộc)</span>
            <p className="text-2xs text-muted-ink mb-2">
              Nhập số điện thoại khách, mã hoá đơn hoặc số serial để lấy sẵn thông tin
              và biết còn hạn bảo hành hay không.
            </p>
            <div className="flex gap-2">
              <Input
                value={lookupQ}
                onChange={(e) => setLookupQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), doLookup())}
                placeholder="0913111222 hoặc HD260908-0001 hoặc số serial"
                aria-label="Tra hàng đã bán"
              />
              <Button icon={Search} onClick={doLookup} disabled={!lookupQ.trim()}>Tra</Button>
            </div>

            {found?.length > 0 && (
              <div className="table-wrap mt-2 max-h-52 overflow-y-auto">
                <table className="data">
                  <thead>
                    <tr><th>Hàng đã bán</th><th>Khách</th><th>Ngày mua</th><th>Bảo hành</th><th /></tr>
                  </thead>
                  <tbody>
                    {found.map((row, i) => (
                      <tr key={row.item_id ?? `x${row.exchanged_ticket_id}-${i}`} className="hoverable">
                        <td>
                          <div className="font-semibold">{row.product_name}</div>
                          <div className="text-2xs text-muted-ink font-mono">
                            {row.sale_code}{row.serial ? ` · SN ${row.serial}` : ''}
                          </div>
                          {row.exchanged_from_code && (
                            <div className="text-2xs text-sky-800">Đổi mới từ sản phẩm cũ có mã BH: {row.exchanged_from_code}</div>
                          )}
                        </td>
                        <td className="truncate max-w-[130px]">{row.customer_name}</td>
                        <td className="text-muted-ink whitespace-nowrap">{row.sale_ts ? date(row.sale_ts) : '—'}</td>
                        <td>
                          {row.in_warranty === 1
                            ? <Badge tone="ok">Còn {row.days_left} ngày</Badge>
                            : row.warranty_until
                              ? <Badge tone="bad">Hết hạn {date(row.warranty_until)}</Badge>
                              : <span className="text-muted-ink text-2xs">Không khai BH</span>}
                        </td>
                        <td className="text-right">
                          <Button size="sm" variant="soft" icon={ArrowRight} onClick={() => pickSold(row)}>Chọn</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Khách hàng */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Khách hàng có hồ sơ">
              <Combo
                items={customers || []}
                value={form.customer_id}
                onChange={(cid) => setForm((f) => ({ ...f, customer_id: cid }))}
                placeholder="Chọn khách quen..."
                filter={(c, q2) => match(c.name, q2) || (c.phone || '').includes(q2)}
                render={(c) => ({ label: c.name, sub: c.phone })}
              />
            </Field>
            <Field label="Hoặc ghi tên khách" hint="Khách lẻ chưa có hồ sơ" htmlFor="wt-cname">
              <Input id="wt-cname" value={form.customer_name} onChange={set('customer_name')}
                disabled={!!form.customer_id} placeholder="Chú Tám" />
            </Field>
            <Field label="Số điện thoại" required htmlFor="wt-cphone">
              <Input id="wt-cphone" value={form.customer_phone} onChange={set('customer_phone')}
                inputMode="tel" placeholder="09xx xxx xxx" />
            </Field>
          </div>

          {/* Hàng hoá */}
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Tên hàng khách mang tới" required className="sm:col-span-2" htmlFor="wt-pname">
              <div className="flex gap-1.5">
                <Input id="wt-pname" value={form.product_name} onChange={set('product_name')}
                  placeholder="Máy bơm Panasonic 125W" />
                <Button onClick={() => setPickerOpen(true)}>Chọn</Button>
              </div>
              <p className="hint">Hàng mua nơi khác thì cứ gõ tay, không cần có trong danh mục.</p>
            </Field>
            <Field label="Số serial / số máy" htmlFor="wt-serial">
              <Input id="wt-serial" value={form.serial} onChange={set('serial')} />
            </Field>
            <Field label="Số lượng" htmlFor="wt-qty">
              <QtyInput size="md" value={form.qty} onChange={(v) => setForm((f) => ({ ...f, qty: v }))} min={1} />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Lỗi khách báo" required htmlFor="wt-issue">
              <Textarea id="wt-issue" rows={2} value={form.issue} onChange={set('issue')}
                placeholder="Bơm không lên nước, có tiếng kêu lạ" />
            </Field>
            <Field label="Tình trạng máy lúc nhận" hint="Ghi rõ trầy xước, móp, thiếu ốc — tránh tranh cãi lúc trả" htmlFor="wt-cond">
              <Textarea id="wt-cond" rows={2} value={form.condition_note} onChange={set('condition_note')}
                placeholder="Vỏ trầy nhẹ góc phải, đủ ốc, không móp" />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Phụ kiện kèm theo" htmlFor="wt-acc">
              <Input id="wt-acc" value={form.accessories} onChange={set('accessories')} placeholder="Dây điện, phích cắm, hộp" />
            </Field>
            <Field label="Kỹ thuật viên phụ trách" htmlFor="wt-tech">
              <Select id="wt-tech" value={form.technician_id || ''}
                onChange={(e) => setForm((f) => ({ ...f, technician_id: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">— Chưa phân công —</option>
                {staff.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </Select>
            </Field>
            <Field label="Hạn bảo hành" hint="Để trống nếu không rõ" htmlFor="wt-until">
              <Input id="wt-until" type="date" value={form.warranty_until} onChange={set('warranty_until')} />
            </Field>
            <Field label="Hẹn trả khách" htmlFor="wt-promise">
              <Input id="wt-promise" type="date" value={form.promised_at} onChange={set('promised_at')} />
            </Field>
          </div>

          {form.ticket_type === 'warranty' && (
            <label className="flex items-center gap-2 text-[13px] cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-emerald-700 cursor-pointer"
                checked={form.in_warranty}
                onChange={(e) => setForm((f) => ({ ...f, in_warranty: e.target.checked }))} />
              Còn trong hạn bảo hành — thường sửa miễn phí cho khách
            </label>
          )}

          <PhotoPicker photos={photos} onChange={setPhotos} max={8} label="Ảnh chụp lúc nhận hàng" />

          <Field label="Ghi chú thêm" htmlFor="wt-note">
            <Textarea id="wt-note" rows={2} value={form.note} onChange={set('note')} />
          </Field>

          {err && <ErrLine>{err}</ErrLine>}
        </div>
      </Modal>

      <ProductPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        products={products || []}
        withQty={false}
        onPick={(p) => {
          setForm((f) => ({ ...f, product_id: p.id, product_name: p.name }));
          setPickerOpen(false);
        }}
        title="Chọn hàng trong danh mục"
      />
    </>
  );
}

/* ==================================================================== */
/* Bảng chi phí                                                          */
/* ==================================================================== */

/** Đổi phiếu từ máy chủ thành bảng chi phí sửa được trên màn hình. */
function toSheet(t) {
  return {
    parts: (t.parts || []).map((p) => ({
      key: `s${p.id}`, id: p.id, applied: p.stock_applied === 1,
      product_id: p.product_id, name: p.product_name, sku: p.sku, base_unit: p.base_unit,
      qty: p.qty, price: p.price, list_price: p.list_price || p.price,
      unit_cost: p.unit_cost, last_purchase_price: p.last_purchase_price,
    })),
    custom: (t.custom_parts || []).map((c) => ({
      key: `c${c.id}`, name: c.name, qty: c.qty, price: c.price, note: c.note || '',
    })),
    labor: t.labor_fee || 0,
    fees: (t.fees || []).map((f) => ({ key: `f${f.id}`, name: f.name, amount: f.amount, note: f.note || '' })),
    discount: t.discount || 0,
  };
}

const num = (v) => Math.round(Number(v) || 0);

/** Tổng tiền theo công thức tài liệu 09: kho + ngoài + công + phí − miễn giảm. */
function sheetTotals(s) {
  if (!s) return null;
  const parts = s.parts.reduce((a, p) => a + Math.round((Number(p.qty) || 0) * num(p.price)), 0);
  const custom = s.custom.reduce((a, c) => a + Math.round((Number(c.qty) || 0) * num(c.price)), 0);
  const labor = Math.max(0, num(s.labor));
  const fees = s.fees.reduce((a, f) => a + Math.max(0, num(f.amount)), 0);
  const gross = parts + custom + labor + fees;
  const discount = Math.min(Math.max(0, num(s.discount)), gross);
  const support = s.parts.reduce((a, p) => a + Math.max(0, Math.round((num(p.list_price) - num(p.price)) * p.qty)), 0);
  return { parts, custom, labor, fees, gross, discount, total: gross - discount, support };
}

/* ==================================================================== */
/* Chi tiết phiếu                                                        */
/* ==================================================================== */

function TicketDetail({ id, onClose, onChanged, onPrint, onPrintReturn }) {
  const { toast, user, can } = useApp();
  const { data: t, busy, reload } = useFetch(() => api.warrantyTicket(id), [id]);
  const { data: wmeta } = useFetch(() => api.warrantyMeta(), []);
  const [statusOpen, setStatusOpen] = useState(false);
  const [partsOpen, setPartsOpen] = useState(false);
  const [deliverTicket, setDeliverTicket] = useState(null);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [addingPhotos, setAddingPhotos] = useState(null);
  const [history, setHistory] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef({ cart: false, fees: false });
  const [saving, setSaving] = useState(false);
  const [pinFor, setPinFor] = useState(null);

  const markDirty = (which) => { dirtyRef.current = { ...dirtyRef.current, [which]: true }; setDirty(true); };
  const clearDirty = () => { dirtyRef.current = { cart: false, fees: false }; setDirty(false); };

  /* Nạp bảng chi phí từ phiếu. Đang sửa dở thì không đè — phiếu tự tải lại
     sau các thao tác khác như đổi trạng thái hay thêm ảnh. */
  useEffect(() => {
    if (!t) return;
    if (dirtyRef.current.cart || dirtyRef.current.fees) return;
    setSheet(toSheet(t));
  }, [t]);

  const refresh = () => { reload(); onChanged?.(); };
  const closed = t && ['delivered', 'cancelled'].includes(t.status);
  const maySeeCost = can('cost.view');
  const totals = useMemo(() => sheetTotals(sheet), [sheet]);

  const setParts = (fn) => { setSheet((s) => ({ ...s, parts: typeof fn === 'function' ? fn(s.parts) : fn })); markDirty('cart'); };
  const setCustom = (fn) => { setSheet((s) => ({ ...s, custom: fn(s.custom) })); markDirty('cart'); };
  const setFees = (patch) => { setSheet((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) })); markDirty('fees'); };

  /** Lưu bảng chi phí. Thu ngân để giá dưới giá vốn thì máy chủ đòi PIN. */
  const saveSheet = async (token) => {
    if (!sheet || closed) return true;
    setSaving(true);
    try {
      if (dirtyRef.current.cart || token) {
        await api.put(`/warranty/${t.id}/cart`, {
          parts: sheet.parts.map((p) => ({
            id: p.applied ? p.id : undefined, product_id: p.product_id, qty: Number(p.qty) || 0, price: num(p.price),
          })),
          custom: sheet.custom
            .filter((c) => String(c.name || '').trim() || num(c.price) > 0)
            .map((c) => ({ name: c.name, qty: Number(c.qty) || 0, price: num(c.price), note: c.note })),
          ...(token ? { approval_token: token } : {}),
        });
        dirtyRef.current = { ...dirtyRef.current, cart: false };
      }
      if (dirtyRef.current.fees) {
        await api.put(`/warranty/${t.id}/fees`, {
          labor_fee: num(sheet.labor),
          fees: sheet.fees.map((f) => ({ name: f.name, amount: num(f.amount), note: f.note })),
          discount: num(sheet.discount),
        });
      }
      clearDirty();
      setPinFor(null);
      refresh();
      toast('Đã lưu bảng chi phí', 'ok');
      return true;
    } catch (e) {
      if (e.needsApproval && !token) { setPinFor(e.message); return false; }
      toast(e.message, 'bad', 7000);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const removePart = async (p) => {
    if (!p.applied) { setParts((ps) => ps.filter((x) => x.key !== p.key)); return; }
    /* Dòng của phiếu cũ đã trừ kho từ lúc thêm: bỏ thì hoàn kho ngay */
    if (!window.confirm(`Bỏ "${p.name}" và hoàn ${fq(p.qty)} ${p.base_unit} về kho?`)) return;
    try {
      await api.del(`/warranty/${t.id}/parts/${p.id}`);
      setSheet((s) => ({ ...s, parts: s.parts.filter((x) => x.key !== p.key) }));
      toast('Đã bỏ linh kiện và hoàn về kho', 'ok');
      onChanged?.();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const removePhoto = async (p) => {
    if (!window.confirm('Xoá ảnh này?')) return;
    try { await api.del(`/warranty/photos/${p.id}`); refresh(); }
    catch (e) { toast(e.message, 'bad'); }
  };

  const doCancel = async () => {
    try {
      await api.post(`/warranty/${t.id}/cancel`, { user_id: user?.id });
      toast('Đã huỷ phiếu', 'ok');
      setCancelling(false);
      clearDirty();
      onChanged?.();
      onClose();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const openDeliver = async () => {
    if (dirty && !(await saveSheet())) return;
    try { setDeliverTicket(await api.warrantyTicket(t.id)); }
    catch (e) { toast(e.message, 'bad'); }
  };

  const tryClose = () => {
    if (dirty && !window.confirm('Bảng chi phí có thay đổi chưa lưu. Đóng mà không lưu?')) return;
    onClose();
  };

  const historyQuery = t && (t.sale_id
    ? { sale_id: t.sale_id, ...(t.product_id ? { product_id: t.product_id } : {}) }
    : t.serial ? { serial: t.serial } : t.customer_id ? { customer_id: t.customer_id } : null);

  return (
    <>
      <Modal
        open
        onClose={tryClose}
        title={t ? `${TYPES[t.ticket_type]?.label || 'Phiếu'} ${t.code}` : 'Phiếu bảo hành'}
        subtitle={t ? `${datetime(t.ts)} · nhận bởi ${t.received_by_name || '—'}` : ''}
        size="xl"
        footer={t && <>
          {!closed && (
            <Button variant="danger" icon={XCircle} onClick={() => setCancelling(true)}>Huỷ phiếu</Button>
          )}
          <div className="flex-1" />
          <Button icon={Printer} onClick={() => { onPrint(t); onClose(); }}>In biên nhận</Button>
          {t.status === 'delivered' && (
            <Button icon={Printer} onClick={() => { onPrintReturn(t); onClose(); }}>In phiếu trả hàng</Button>
          )}
          {!closed && (
            <Button variant="primary" icon={PackageCheck} onClick={openDeliver} loading={saving}>
              Hoàn thành &amp; trả khách
            </Button>
          )}
          <Button onClick={tryClose}>Đóng</Button>
        </>}
      >
        {busy && !t ? <Spinner /> : !t ? null : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <TypeBadge type={t.ticket_type} />
              <StatusBadge s={t.status} />
              {t.prior_tickets?.length > 0 && historyQuery && (
                <WarrantyFlag count={t.prior_tickets.length} onClick={() => setHistory(true)} />
              )}
              {t.technician_name && (
                <span className="text-[13px] text-muted-ink inline-flex items-center gap-1">
                  <User size={13} aria-hidden="true" /> Kỹ thuật viên: <b className="text-ink">{t.technician_name}</b>
                </span>
              )}
            </div>

            {/* Tóm tắt */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="card p-2.5 text-[13px]">
                <div className="text-2xs font-bold text-muted-ink uppercase mb-1">Khách hàng</div>
                <div className="font-semibold">{t.customer_display || '—'}</div>
                {t.phone_display && (
                  <a href={`tel:${t.phone_display}`} className="text-accent hover:underline tabular">{t.phone_display}</a>
                )}
                {t.customer_address && <div className="text-muted-ink">{t.customer_address}</div>}
                {t.sale_code && (
                  <div className="text-2xs text-muted-ink mt-1">
                    Hoá đơn gốc: <span className="font-mono">{t.sale_code}</span> ({date(t.sale_ts)})
                  </div>
                )}
              </div>

              <div className="card p-2.5 text-[13px]">
                <div className="text-2xs font-bold text-muted-ink uppercase mb-1">Hàng hoá</div>
                <div className="font-semibold">{t.product_name}</div>
                {t.serial && <div className="font-mono text-2xs">SN: {t.serial}</div>}
                <div className="text-muted-ink">Số lượng: {fq(t.qty)}</div>
                <div className="mt-1">
                  {t.in_warranty === 1
                    ? <Badge tone="ok">Còn bảo hành{t.warranty_until ? ` tới ${date(t.warranty_until)}` : ''}</Badge>
                    : <Badge tone="mute">Hết hạn / không bảo hành</Badge>}
                </div>
              </div>

              <div className="card p-2.5 text-[13px]">
                <div className="text-2xs font-bold text-muted-ink uppercase mb-1">Tình trạng</div>
                <StatusBadge s={t.status} />
                {t.resolution && <div className="mt-1">Xử lý: <b>{RESOLUTION[t.resolution]}</b></div>}
                {t.promised_at && <div className="text-muted-ink mt-0.5">Hẹn trả: {date(t.promised_at)}</div>}
                {t.supplier_name && (
                  <div className="text-muted-ink">Gửi {t.supplier_name}{t.sent_at ? ` ngày ${date(t.sent_at)}` : ''}</div>
                )}
                {!closed && (
                  <Button size="sm" icon={RefreshCw} className="mt-2" onClick={() => setStatusOpen(true)}>
                    Đổi trạng thái / kỹ thuật viên
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 text-[13px]">
              <div className="card p-2.5">
                <div className="text-2xs font-bold text-muted-ink uppercase mb-1">Lỗi khách báo</div>
                <p>{t.issue || '—'}</p>
              </div>
              <div className="card p-2.5">
                <div className="text-2xs font-bold text-muted-ink uppercase mb-1">Tình trạng lúc nhận</div>
                <p>{t.condition_note || '—'}</p>
                {t.accessories && <p className="text-muted-ink mt-1">Phụ kiện: {t.accessories}</p>}
              </div>
            </div>

            {/* Ảnh */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="label !mb-0">Ảnh lúc nhận ({t.photos.filter((p) => p.kind === 'received').length})</span>
                <Button size="sm" onClick={() => setAddingPhotos('received')}>Thêm ảnh</Button>
              </div>
              <PhotoGallery
                photos={t.photos.filter((p) => p.kind === 'received')}
                onDelete={removePhoto}
                emptyText="Không có ảnh lúc nhận — lần sau nên chụp để tránh tranh cãi."
              />
            </div>
            {t.photos.some((p) => p.kind === 'done') && (
              <div>
                <span className="label">Ảnh lúc trả khách</span>
                <PhotoGallery photos={t.photos.filter((p) => p.kind === 'done')} onDelete={removePhoto} />
              </div>
            )}

            {/* Bảng chi phí */}
            {sheet && totals ? (
              <CostSheet
                sheet={sheet}
                totals={totals}
                closed={closed}
                dirty={dirty}
                saving={saving}
                maySeeCost={maySeeCost}
                presets={wmeta?.labor_presets || []}
                onSave={() => saveSheet()}
                onOpenParts={() => setPartsOpen(true)}
                setParts={setParts}
                setCustom={setCustom}
                setFees={setFees}
                onRemovePart={removePart}
              />
            ) : <Spinner />}

            {/* Đổi mới */}
            {t.exchange_product_name ? (
              <div className="card p-3 bg-sky-50 border-sky-200 text-[13px] flex gap-2">
                <ArrowLeftRight size={16} className="text-sky-700 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  Đã đổi mới: <b>{t.exchange_product_name}</b>
                  {t.exchange_qty ? ` × ${fq(t.exchange_qty)}` : ''}{t.exchange_serial ? ` · SN ${t.exchange_serial}` : ''}
                  <div className="text-sky-900/80">
                    Bảo hành {t.exchange_mode === 'reset' ? 'tính lại từ đầu' : 'kế thừa hạn còn lại của máy cũ'}
                    {t.exchange_warranty_until ? ` — tới ${date(t.exchange_warranty_until)}` : ''}.
                    {t.product_id ? ' Máy lỗi đã vào kho hàng lỗi chờ tiêu huỷ / trả hãng.' : ''}
                  </div>
                  <div className="text-2xs text-sky-900/70 mt-0.5">Đổi mới từ sản phẩm cũ có mã BH: {t.code}</div>
                </div>
              </div>
            ) : !closed && (
              <Button size="sm" icon={ArrowLeftRight} onClick={() => setExchangeOpen(true)}>Đổi cái mới cho khách</Button>
            )}

            {/* Tiền đã chốt */}
            {t.status === 'delivered' && (
              <div className="card p-3 space-y-1 text-[13px]">
                <div className="flex justify-between font-bold">
                  <span>Thu của khách</span><span className="tabular font-mono">{money(t.charge)}</span>
                </div>
                <div className="flex justify-between"><span className="text-muted-ink">Khách đã trả</span><span className="tabular font-mono">{money(t.paid)}</span></div>
                {t.refund_amount > 0 && (
                  <div className="flex justify-between text-danger font-semibold">
                    <span>Hoàn tiền khách</span><span className="tabular font-mono">{money(t.refund_amount)}</span>
                  </div>
                )}
                {maySeeCost && (
                  <div className="flex justify-between text-muted-ink">
                    <span>Lãi ca sửa (trừ vốn linh kiện kho)</span>
                    <span className="tabular font-mono">{money(t.charge - t.parts_cost)}</span>
                  </div>
                )}
                <div className="flex justify-between text-2xs text-muted-ink pt-1">
                  <span>Trả khách lúc</span><span>{datetime(t.delivered_at)}</span>
                </div>
              </div>
            )}

            {/* Nhật ký */}
            <div>
              <span className="label">Nhật ký xử lý</span>
              <ol className="border-l-2 border-line ml-2 space-y-2">
                {t.logs.map((l) => (
                  <li key={l.id} className="relative pl-4">
                    <span className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-accent" aria-hidden="true" />
                    <div className="text-[13px] font-semibold">{STATUS[l.status]?.label || l.status}</div>
                    <div className="text-2xs text-muted-ink">{datetime(l.ts)}{l.user_name ? ` · ${l.user_name}` : ''}</div>
                    {l.note && <div className="text-[13px] text-muted-ink mt-0.5">{l.note}</div>}
                  </li>
                ))}
              </ol>
            </div>

            {t.note && <div className="card p-2.5 text-[13px]"><b>Ghi chú: </b>{t.note}</div>}
          </div>
        )}
      </Modal>

      {t && (
        <>
          <StatusModal open={statusOpen} ticket={t} onClose={() => setStatusOpen(false)}
            onDone={() => { setStatusOpen(false); refresh(); }} />
          {partsOpen && sheet && (
            <PartsCartModal
              parts={sheet.parts}
              setParts={setParts}
              total={totals?.parts || 0}
              onClose={async () => { setPartsOpen(false); if (dirtyRef.current.cart) await saveSheet(); }}
            />
          )}
          {exchangeOpen && (
            <ExchangeModal ticket={t} onClose={() => setExchangeOpen(false)}
              onDone={() => { setExchangeOpen(false); refresh(); }} />
          )}
          {deliverTicket && (
            <DeliverModal
              ticket={deliverTicket}
              onClose={() => setDeliverTicket(null)}
              onDone={async () => {
                setDeliverTicket(null);
                clearDirty();
                onChanged?.();
                try { onPrintReturn(await api.warrantyTicket(t.id)); } catch { /* in lại được từ phiếu */ }
                onClose();
              }}
            />
          )}
          <AddPhotosModal kind={addingPhotos} ticket={t} onClose={() => setAddingPhotos(null)}
            onDone={() => { setAddingPhotos(null); refresh(); }} />
          <Confirm
            open={cancelling}
            onClose={() => setCancelling(false)}
            onConfirm={doCancel}
            title="Huỷ phiếu?"
            confirmText="Huỷ phiếu"
            message={<>Huỷ phiếu <b className="font-mono">{t.code}</b>? Linh kiện chưa trừ kho sẽ bỏ khỏi phiếu; linh kiện đã trừ kho được hoàn về kho.</>}
          />
          <PinApprovalModal
            open={!!pinFor}
            reason="Giá linh kiện sửa chữa thấp hơn giá vốn"
            detail={pinFor}
            onClose={() => setPinFor(null)}
            onApproved={(res) => saveSheet(res.token)}
          />
          <WarrantyHistoryModal
            open={history}
            onClose={() => setHistory(false)}
            query={historyQuery}
            subtitle={`${t.product_name}${t.sale_code ? ` · ${t.sale_code}` : ''}`}
          />
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------- */

function CostSheet({
  sheet, totals, closed, dirty, saving, maySeeCost, presets,
  onSave, onOpenParts, setParts, setCustom, setFees, onRemovePart,
}) {
  const [costOf, setCostOf] = useState(null);   // dòng đang mở giá vốn

  return (
    <section aria-labelledby="wt-cost-h" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="wt-cost-h" className="font-bold text-sm">Bảng chi phí</h3>
        {dirty && !closed && <Badge tone="warn">Chưa lưu thay đổi</Badge>}
        <div className="flex-1" />
        {!closed && (
          <Button size="sm" variant="primary" icon={Save} onClick={onSave} loading={saving} disabled={!dirty}>
            Lưu bảng chi phí
          </Button>
        )}
      </div>

      {/* ---------- 1A. Linh kiện trong kho ---------- */}
      <div className="card p-2.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[13px]">
            <b>1A. Linh kiện trong kho</b>
            <span className="text-muted-ink"> — trừ kho khi hoàn thành phiếu, không đổi giá niêm yết</span>
          </div>
          {!closed && (
            <Button size="sm" icon={ShoppingCart} onClick={onOpenParts}>Chọn linh kiện ({sheet.parts.length})</Button>
          )}
        </div>
        {sheet.parts.length === 0 ? (
          <p className="text-[13px] text-muted-ink">Chưa dùng linh kiện nào trong kho.</p>
        ) : (
          <div className="overflow-x-auto border border-line rounded">
            <table className="data">
              <thead>
                <tr>
                  <th>Linh kiện</th>
                  <th className="text-right">SL</th>
                  <th className="text-right">Giá niêm yết</th>
                  <th className="text-right" style={{ minWidth: 190 }}>Giá sửa</th>
                  <th className="text-right">Thành tiền</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {sheet.parts.map((p) => {
                  const list = num(p.list_price);
                  const price = num(p.price);
                  const support = Math.max(0, Math.round((list - price) * p.qty));
                  const pct = list > 0 && price < list ? Math.round(((list - price) / list) * 1000) / 10 : 0;
                  const below = maySeeCost && Number(p.unit_cost) > 0 && price < Number(p.unit_cost);
                  return (
                    <tr key={p.key} className={below ? 'bg-red-50/70' : ''}>
                      <td>
                        <div className="font-semibold">{p.name}</div>
                        <div className="text-2xs text-muted-ink font-mono">
                          {p.sku} · {p.applied ? 'đã trừ kho' : 'chờ trừ kho'}
                        </div>
                      </td>
                      <td className="num whitespace-nowrap">{fq(p.qty)} {p.base_unit}</td>
                      <td className="num text-muted-ink">{money(list)}</td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          {closed
                            ? <span className="num">{money(price)}</span>
                            : (
                              <MoneyInput size="sm" className="!w-28" value={p.price}
                                onChange={(v) => setParts((ps) => ps.map((x) => (x.key === p.key ? { ...x, price: v } : x)))}
                                aria-label={`Giá sửa ${p.name}`} />
                            )}
                          {maySeeCost && (
                            <IconButton icon={Info} size={14} label={`Xem giá vốn và giá nhập gần nhất của ${p.name}`}
                              aria-expanded={costOf === p.key}
                              onClick={() => setCostOf(costOf === p.key ? null : p.key)} />
                          )}
                        </div>
                        {maySeeCost && costOf === p.key && (
                          <div className="mt-1 rounded border border-line bg-muted/60 px-2 py-1 text-2xs text-right tabular">
                            Giá vốn <b>{money(p.unit_cost)}</b> · Nhập gần nhất <b>{p.last_purchase_price ? money(p.last_purchase_price) : '—'}</b>
                          </div>
                        )}
                        {support > 0 && (
                          <div className="text-right mt-0.5"><Badge tone="info">Giảm giá hỗ trợ: {money(support)} ({pct}%)</Badge></div>
                        )}
                        {below && (
                          <div className="text-right mt-0.5">
                            <Badge tone="bad"><AlertTriangle size={10} aria-hidden="true" /> Giá sửa thấp hơn giá vốn</Badge>
                          </div>
                        )}
                      </td>
                      <td className="num font-semibold">{money(Math.round(p.qty * price))}</td>
                      <td>
                        {!closed && (
                          <IconButton icon={Trash2} label={`Bỏ ${p.name}`} size={13}
                            className="!text-danger hover:!bg-red-50" onClick={() => onRemovePart(p)} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------- 1B. Linh kiện ngoài hệ thống ---------- */}
      <div className="card p-2.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[13px]">
            <b>1B. Linh kiện ngoài hệ thống</b>
            <span className="text-muted-ink"> — mua ngoài, không trừ kho, doanh thu ghi riêng</span>
          </div>
          {!closed && (
            <Button size="sm" icon={PackagePlus}
              onClick={() => setCustom((cs) => [...cs, { key: `c${Date.now()}`, name: '', qty: 1, price: 0, note: '' }])}>
              Thêm linh kiện ngoài hệ thống
            </Button>
          )}
        </div>
        {sheet.custom.length > 0 && (
          <div className="overflow-x-auto border border-line rounded">
            <table className="data">
              <thead>
                <tr>
                  <th>Tên linh kiện</th>
                  <th style={{ width: 90 }} className="text-right">SL</th>
                  <th style={{ width: 130 }} className="text-right">Giá</th>
                  <th className="text-right">Thành tiền</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {sheet.custom.map((c, i) => {
                  const patch = (pt) => setCustom((cs) => cs.map((x, j) => (j === i ? { ...x, ...pt } : x)));
                  return (
                    <tr key={c.key}>
                      <td>
                        {closed ? <div className="font-semibold">{c.name}</div> : (
                          <>
                            <Input size="sm" value={c.name} placeholder="VD: Bạc đạn 6202 mua ngoài"
                              aria-label={`Tên linh kiện ngoài ${i + 1}`} onChange={(e) => patch({ name: e.target.value })} />
                            <Input size="sm" className="mt-1 !text-2xs" value={c.note} placeholder="Ghi chú: mua ở đâu..."
                              aria-label={`Ghi chú linh kiện ngoài ${i + 1}`} onChange={(e) => patch({ note: e.target.value })} />
                          </>
                        )}
                        {closed && c.note && <div className="text-2xs text-muted-ink">{c.note}</div>}
                      </td>
                      <td>{closed ? <span className="num">{fq(c.qty)}</span>
                        : <QtyInput value={c.qty} onChange={(v) => patch({ qty: v })} aria-label={`Số lượng linh kiện ngoài ${i + 1}`} />}</td>
                      <td>{closed ? <span className="num">{money(c.price)}</span>
                        : <MoneyInput size="sm" value={c.price} onChange={(v) => patch({ price: v })} aria-label={`Giá linh kiện ngoài ${i + 1}`} />}</td>
                      <td className="num font-semibold">{money(Math.round((Number(c.qty) || 0) * num(c.price)))}</td>
                      <td>
                        {!closed && (
                          <IconButton icon={Trash2} label={`Bỏ linh kiện ngoài ${i + 1}`} size={13}
                            className="!text-danger hover:!bg-red-50" onClick={() => setCustom((cs) => cs.filter((_, j) => j !== i))} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          {/* ---------- 2. Tiền công ---------- */}
          <div className="card p-2.5">
            <div className="text-[13px] font-bold mb-1.5">2. Tiền công kỹ thuật</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <MoneyInput value={sheet.labor} disabled={closed} aria-label="Tiền công kỹ thuật"
                onChange={(v) => setFees({ labor: v })} />
              {presets.length > 0 && !closed && (
                <Select value="" aria-label="Chọn tiền công từ bảng giá"
                  onChange={(e) => { const p = presets[Number(e.target.value)]; if (p) setFees({ labor: p.price }); }}>
                  <option value="">— Chọn từ bảng giá tiền công —</option>
                  {presets.map((p, i) => <option key={i} value={i}>{p.name} — {money(p.price)}</option>)}
                </Select>
              )}
            </div>
          </div>

          {/* ---------- 3. Phí phát sinh ---------- */}
          <div className="card p-2.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] font-bold">3. Phí phát sinh khác</span>
              {!closed && (
                <Button size="sm" icon={Plus}
                  onClick={() => setFees((s) => ({ fees: [...s.fees, { key: `f${Date.now()}`, name: '', amount: 0, note: '' }] }))}>
                  Thêm phí
                </Button>
              )}
            </div>
            {sheet.fees.length === 0 ? (
              <p className="text-[13px] text-muted-ink">Không có phí gửi hãng, vận chuyển hay phí khác.</p>
            ) : sheet.fees.map((f, i) => {
              const patch = (pt) => setFees((s) => ({ fees: s.fees.map((x, j) => (j === i ? { ...x, ...pt } : x)) }));
              return closed ? (
                <div key={f.key} className="flex justify-between text-[13px]">
                  <span>{f.name}{f.note ? <span className="text-muted-ink"> · {f.note}</span> : ''}</span>
                  <span className="tabular">{money(f.amount)}</span>
                </div>
              ) : (
                <div key={f.key} className="grid gap-1.5 sm:grid-cols-[1fr_130px_1fr_auto] items-center">
                  <Input size="sm" value={f.name} placeholder="Tên khoản phí" aria-label={`Tên phí ${i + 1}`}
                    onChange={(e) => patch({ name: e.target.value })} />
                  <MoneyInput size="sm" value={f.amount} aria-label={`Số tiền phí ${i + 1}`} onChange={(v) => patch({ amount: v })} />
                  <Input size="sm" value={f.note} placeholder="Ghi chú" aria-label={`Ghi chú phí ${i + 1}`}
                    onChange={(e) => patch({ note: e.target.value })} />
                  <IconButton icon={Trash2} label={`Bỏ phí ${i + 1}`} size={13} className="!text-danger hover:!bg-red-50"
                    onClick={() => setFees((s) => ({ fees: s.fees.filter((_, j) => j !== i) }))} />
                </div>
              );
            })}
          </div>
        </div>

        {/* ---------- Tổng ---------- */}
        <div className="card p-3 space-y-1 text-[13px] h-fit">
          <div className="flex justify-between"><span className="text-muted-ink">Linh kiện trong kho</span><span className="tabular">{money(totals.parts)}</span></div>
          <div className="flex justify-between"><span className="text-muted-ink">Linh kiện ngoài hệ thống</span><span className="tabular">{money(totals.custom)}</span></div>
          <div className="flex justify-between"><span className="text-muted-ink">Tiền công</span><span className="tabular">{money(totals.labor)}</span></div>
          <div className="flex justify-between"><span className="text-muted-ink">Phí phát sinh</span><span className="tabular">{money(totals.fees)}</span></div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <label htmlFor="wt-discount" className="text-muted-ink">Miễn giảm cho khách</label>
            {closed ? <span className="tabular">−{money(totals.discount)}</span> : (
              <MoneyInput id="wt-discount" size="sm" className="!w-32" value={sheet.discount}
                onChange={(v) => setFees({ discount: v })} />
            )}
          </div>
          {totals.support > 0 && (
            <div className="flex justify-between text-2xs text-muted-ink"><span>(đã giảm giá hỗ trợ linh kiện)</span><span className="tabular">{money(totals.support)}</span></div>
          )}
          <div className="flex items-baseline justify-between pt-2 border-t border-line">
            <span className="font-bold">Tổng khách trả</span>
            <span className="text-xl font-display font-bold tabular">{money(totals.total)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ==================================================================== */
/* Hộp chọn linh kiện — đồng bộ hai chiều với phiếu                       */
/* ==================================================================== */

function PartsCartModal({ parts, setParts, total, onClose }) {
  const { meta, defaultWarehouse, defaultPriceList } = useApp();
  const { data: products, busy } = useFetch(
    () => api.posProducts({ warehouse_id: defaultWarehouse }), [defaultWarehouse]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');

  const branch = useMemo(() => branchIds(meta.categories, cat), [meta.categories, cat]);
  const byId = useMemo(() => new Map((products || []).map((p) => [p.id, p])), [products]);
  const list = useMemo(() => {
    let l = (products || []).filter((p) => p.track_stock);
    if (branch) l = l.filter((p) => branch.has(p.category_id));
    const k = q.trim();
    if (k) l = l.filter((p) => match(p.name, k) || match(p.alias || '', k) || match(p.sku, k) || (p.barcode || '') === k);
    return l.slice(0, 200);
  }, [products, q, branch]);
  const inCart = useMemo(() => {
    const m = new Map();
    for (const x of parts) m.set(x.product_id, (m.get(x.product_id) || 0) + Number(x.qty));
    return m;
  }, [parts]);

  const retailOf = (p) => {
    const u = p.units?.find((x) => x.is_base) || p.units?.[0];
    return Number(u?.prices?.[defaultPriceList] ?? Object.values(u?.prices || {})[0]) || 0;
  };
  const add = (p, qty = 1) => setParts((ps) => {
    const i = ps.findIndex((x) => x.product_id === p.id && !x.applied);
    if (i >= 0) return ps.map((x, j) => (j === i ? { ...x, qty: Number(x.qty) + qty } : x));
    const listPrice = retailOf(p);
    return [...ps, {
      key: `n${p.id}-${Date.now()}`, id: null, applied: false,
      product_id: p.id, name: p.name, sku: p.sku, base_unit: p.base_unit,
      qty, price: listPrice, list_price: listPrice,
      unit_cost: p.cost_price, last_purchase_price: p.last_purchase_price,
    }];
  });
  const setQty = (key, qty) => setParts((ps) => ps.map((x) => (x.key === key ? { ...x, qty: Math.max(1, Number(qty) || 1) } : x)));
  const remove = (key) => setParts((ps) => ps.filter((x) => x.key !== key));

  /* Quét mã vạch: khớp đúng mã vạch / mã hàng, hoặc lọc còn một món, thì cho vào giỏ luôn */
  const onScanKey = (e) => {
    if (e.key !== 'Enter') return;
    const code = q.trim();
    const exact = (products || []).find((p) => p.track_stock && code && (p.barcode === code || p.sku === code));
    const hit = exact || (list.length === 1 ? list[0] : null);
    if (hit) { e.preventDefault(); add(hit); setQ(''); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Chọn linh kiện trong kho"
      subtitle="Thêm, bớt ở đây là bảng chi phí trên phiếu cập nhật ngay. Trừ kho lúc hoàn thành phiếu."
      size="xl"
      footer={<>
        <span className="mr-auto text-[13px]">Tiền linh kiện: <b className="tabular">{money(total)}</b></span>
        <Button variant="primary" onClick={onClose}>Xong</Button>
      </>}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2" onKeyDown={onScanKey}>
            <SearchInput value={q} onChange={setQ} placeholder="Gõ tên, mã hàng hoặc quét mã vạch..." className="flex-1 min-w-[12rem]" autoFocus />
            <CategorySelect value={cat} onChange={setCat} categories={meta.categories} className="!w-auto" ariaLabel="Lọc theo nhóm hàng" />
            <Badge tone={parts.length ? 'ok' : 'mute'}>Đã thêm: {n(parts.length)} món</Badge>
          </div>
          {busy && !products ? <Spinner /> : list.length === 0 ? (
            <Empty icon={Search} title="Không tìm thấy linh kiện" message={q ? `Không có hàng khớp "${q}".` : 'Nhóm này chưa có hàng quản lý tồn kho.'} />
          ) : (
            <div className="table-wrap max-h-[52vh]">
              <table className="data">
                <thead>
                  <tr><th>Linh kiện</th><th className="text-right">Tồn</th><th className="text-right">Giá</th><th style={{ width: 96 }} /></tr>
                </thead>
                <tbody>
                  {list.map((p) => {
                    const c = inCart.get(p.id) || 0;
                    return (
                      <tr key={p.id} className={c ? 'bg-accent-soft/40' : ''}>
                        <td>
                          <div className="font-semibold">{p.name}</div>
                          <div className="text-2xs text-muted-ink font-mono">{p.sku}</div>
                        </td>
                        <td className={`num ${p.stock <= 0 ? 'text-danger' : 'text-muted-ink'}`}>{fq(p.stock)} {p.base_unit}</td>
                        <td className="num">{money(retailOf(p))}</td>
                        <td className="text-right">
                          <Button size="sm" variant={c ? 'primary' : 'soft'} icon={Plus} onClick={() => add(p)}
                            aria-label={c ? `Thêm 1 ${p.name}, đang có ${fq(c)}` : `Thêm ${p.name}`}>
                            {c ? fq(c) : 'Thêm'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside className="card p-2.5 h-fit" aria-label="Linh kiện đã chọn">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[13px] font-bold">Giỏ linh kiện</span>
            <span className="text-2xs text-muted-ink">{n(parts.length)} món</span>
          </div>
          {parts.length === 0 ? (
            <p className="text-[13px] text-muted-ink py-3 text-center">Chưa chọn linh kiện nào.</p>
          ) : (
            <ul className="divide-y divide-line">
              {parts.map((x) => {
                const stock = byId.get(x.product_id)?.stock;
                const over = !x.applied && stock !== undefined && Number(x.qty) > stock;
                return (
                  <li key={x.key} className="py-2">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold leading-snug">{x.name}</div>
                        <div className="text-2xs text-muted-ink tabular">
                          {money(x.price)} / {x.base_unit}
                          {x.applied && ' · đã trừ kho'}
                          {over && <span className="text-danger font-semibold"> · vượt tồn ({fq(stock)})</span>}
                        </div>
                      </div>
                      {!x.applied && (
                        <IconButton icon={Trash2} size={14} label={`Bỏ ${x.name}`} className="!text-danger hover:!bg-red-50"
                          onClick={() => remove(x.key)} />
                      )}
                    </div>
                    {x.applied ? (
                      <div className="text-[13px] tabular mt-1">SL {fq(x.qty)}</div>
                    ) : (
                      <div className="flex items-center gap-1 mt-1">
                        <IconButton icon={Minus} size={14} variant="outline" label={`Bớt 1 ${x.name}`}
                          disabled={Number(x.qty) <= 1} onClick={() => setQty(x.key, Number(x.qty) - 1)} />
                        <QtyInput value={x.qty} min={1} onChange={(v) => setQty(x.key, v)} className="!w-20"
                          aria-label={`Số lượng ${x.name}`} />
                        <IconButton icon={Plus} size={14} variant="outline" label={`Thêm 1 ${x.name}`}
                          onClick={() => setQty(x.key, Number(x.qty) + 1)} />
                        <span className="ml-auto tabular font-semibold text-[13px]">{money(Math.round(x.qty * num(x.price)))}</span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>
    </Modal>
  );
}

/* ==================================================================== */

function StatusModal({ open, ticket, onClose, onDone }) {
  const { toast, user } = useApp();
  const [status, setStatus] = useState('checking');
  const [resolution, setResolution] = useState('');
  const [supplierId, setSupplierId] = useState(null);
  const [technicianId, setTechnicianId] = useState(null);
  const [expectedAt, setExpectedAt] = useState('');
  const [promisedAt, setPromisedAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const { data: suppliers } = useFetch(() => api.suppliers({ active: 1 }), [], { skip: !open });
  const { data: users } = useFetch(() => api.users(), [], { skip: !open });
  const staff = (Array.isArray(users) ? users : []).filter((u) => u.active);

  useEffect(() => {
    if (!open || !ticket) return;
    const order = ['received', 'checking', 'repairing', 'ready'];
    const i = order.indexOf(ticket.status);
    setStatus(i >= 0 && i < order.length - 1 ? order[i + 1] : 'ready');
    setResolution(ticket.resolution || '');
    setSupplierId(ticket.supplier_id || null);
    setTechnicianId(ticket.technician_id || null);
    setExpectedAt(ticket.expected_at || '');
    setPromisedAt(ticket.promised_at || '');
    setNote(''); setErr('');
  }, [open, ticket]);

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.post(`/warranty/${ticket.id}/status`, {
        status, resolution: resolution || undefined,
        supplier_id: supplierId, technician_id: technicianId, expected_at: expectedAt || null,
        promised_at: promisedAt || null, note, user_id: user?.id,
      });
      toast('Đã cập nhật trạng thái', 'ok');
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Đổi trạng thái xử lý"
      subtitle={ticket ? `${ticket.code} · ${ticket.product_name}` : ''}
      size="sm"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={submit} loading={busy}>Lưu</Button>
      </>}
    >
      <div className="space-y-3">
        <Field label="Trạng thái mới" required htmlFor="ws-status">
          <Select id="ws-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(STATUS)
              .filter(([k]) => !['delivered', 'cancelled'].includes(k))
              .map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>

        <Field label="Kỹ thuật viên phụ trách" htmlFor="ws-tech">
          <Select id="ws-tech" value={technicianId || ''} onChange={(e) => setTechnicianId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— Chưa phân công —</option>
            {staff.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </Select>
        </Field>

        <Field label="Cách xử lý" htmlFor="ws-res">
          <Select id="ws-res" value={resolution} onChange={(e) => setResolution(e.target.value)}>
            <option value="">— Chưa quyết —</option>
            {Object.entries(RESOLUTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>

        {status === 'sent_supplier' && (
          <>
            <Field label="Gửi cho hãng / nhà cung cấp" required>
              <Combo
                items={suppliers || []}
                value={supplierId}
                onChange={setSupplierId}
                placeholder="Chọn nơi gửi..."
                filter={(s, q) => match(s.name, q) || (s.phone || '').includes(q)}
                render={(s) => ({ label: s.name, sub: s.phone })}
              />
            </Field>
            <Field label="Hãng hẹn trả" htmlFor="ws-exp">
              <Input id="ws-exp" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
            </Field>
          </>
        )}

        <Field label="Hẹn trả khách" htmlFor="ws-promise">
          <Input id="ws-promise" type="date" value={promisedAt} onChange={(e) => setPromisedAt(e.target.value)} />
        </Field>

        <Field label="Ghi chú" htmlFor="ws-note">
          <Textarea id="ws-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Ví dụ: đã thay tụ, chạy thử ổn" />
        </Field>

        {err && <ErrLine>{err}</ErrLine>}
      </div>
    </Modal>
  );
}

/* ==================================================================== */
/* Đổi cái mới — kho hàng lỗi và hạn bảo hành (tài liệu 09, mục 6.2)      */
/* ==================================================================== */

function ExchangeModal({ ticket, onClose, onDone }) {
  const { toast, user, defaultWarehouse } = useApp();
  const [productId, setProductId] = useState(ticket.product_id || null);
  const [qty, setQty] = useState(ticket.qty || 1);
  const [mode, setMode] = useState('inherit');
  const [months, setMonths] = useState(12);
  const [serial, setSerial] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const { data: products } = useFetch(
    () => api.posProducts({ warehouse_id: defaultWarehouse }), [defaultWarehouse]);
  const p = products?.find((x) => x.id === productId);

  useEffect(() => {
    if (p?.warranty_months > 0) setMonths(p.warranty_months);
  }, [p?.id, p?.warranty_months]);

  const submit = async () => {
    if (!productId) { setErr('Chọn mặt hàng để đổi cho khách.'); return; }
    if (mode === 'reset' && !(Number(months) > 0)) { setErr('Chọn số tháng bảo hành mới.'); return; }
    setBusy(true);
    setErr('');
    try {
      const res = await api.post(`/warranty/${ticket.id}/exchange`, {
        product_id: productId, qty: Number(qty), warehouse_id: defaultWarehouse, user_id: user?.id,
        warranty_mode: mode, warranty_months: Number(months) || 0, serial: serial.trim() || null,
      });
      toast(`Đã đổi hàng mới${res.warranty_until ? `, bảo hành tới ${date(res.warranty_until)}` : ''}`, 'ok', 6000);
      onDone();
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
      title="Đổi cái mới cho khách"
      subtitle={`${ticket.code} · ${ticket.product_name}`}
      size="md"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" icon={ArrowLeftRight} onClick={submit} loading={busy}>Xác nhận đổi</Button>
      </>}
    >
      <div className="space-y-3">
        <Field label="Hàng mới đổi cho khách" required>
          <Combo
            items={(products || []).filter((x) => x.track_stock)}
            value={productId}
            onChange={setProductId}
            placeholder="Chọn hàng trong kho..."
            filter={(x, q) => match(x.name, q) || match(x.alias || '', q) || match(x.sku, q)}
            render={(x) => ({ label: x.name, sub: `${x.sku} · tồn ${fq(x.stock)} ${x.base_unit}` })}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Số lượng" required hint={p ? `Tồn kho: ${fq(p.stock)} ${p.base_unit}` : ''}>
            <QtyInput size="md" value={qty} onChange={setQty} min={1} max={p?.stock} />
            {p && qty > p.stock && <p className="error-text">Kho chỉ còn {fq(p.stock)}.</p>}
          </Field>
          <Field label="Serial máy mới" htmlFor="ex-serial">
            <Input id="ex-serial" value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Để tra cứu bảo hành về sau" />
          </Field>
        </div>

        <div>
          <span className="label" id="ex-mode">Bảo hành cho máy mới</span>
          <div role="radiogroup" aria-labelledby="ex-mode" className="grid gap-1.5 sm:grid-cols-2">
            {[['inherit', 'Kế thừa hạn còn lại', `Theo máy cũ${ticket.warranty_until ? `: tới ${date(ticket.warranty_until)}` : ' (tra theo hoá đơn gốc)'}`],
              ['reset', 'Tính lại từ đầu', 'Bảo hành mới N tháng kể từ hôm nay']].map(([k, label, hint]) => (
              <label key={k}
                className={`rounded-lg border p-2.5 cursor-pointer transition-colors duration-150 focus-within:ring-2 focus-within:ring-accent/40
                            ${mode === k ? 'border-accent bg-accent-soft' : 'border-line hover:bg-muted'}`}>
                <input type="radio" name="ex-mode" value={k} checked={mode === k} onChange={() => setMode(k)} className="sr-only" />
                <span className="block text-[13px] font-bold">{label}</span>
                <span className="block text-2xs text-muted-ink">{hint}</span>
              </label>
            ))}
          </div>
          {mode === 'reset' && (
            <div className="flex items-center gap-1.5 mt-2">
              <QtyInput size="md" value={months} onChange={setMonths} min={1} className="!w-24" aria-label="Số tháng bảo hành mới" />
              <span className="text-[13px] text-muted-ink">tháng</span>
              {[6, 12, 24].map((m) => (
                <button key={m} type="button" onClick={() => setMonths(m)}
                  className={`btn btn-sm ${Number(months) === m ? 'btn-soft' : 'btn-outline'}`}>{m}</button>
              ))}
            </div>
          )}
        </div>

        {ticket.product_id ? (
          <p className="rounded-lg border border-warn/30 bg-amber-50 p-2.5 text-[13px] text-amber-900">
            Máy lỗi khách trả lại sẽ nhập vào <b>Kho hàng lỗi chờ tiêu huỷ / trả hãng</b>, không vào kho bán.
          </p>
        ) : (
          <p className="text-2xs text-muted-ink">Máy khách mang tới không có mã trong danh mục nên không nhập kho hàng lỗi.</p>
        )}
        {err && <ErrLine>{err}</ErrLine>}
      </div>
    </Modal>
  );
}

/* ==================================================================== */
/* Hoàn thành phiếu và trả khách                                         */
/* ==================================================================== */

function DeliverModal({ ticket, onClose, onDone }) {
  const { toast, meta, user } = useApp();
  const tt = ticket.totals || {};
  const gross = tt.gross || 0;
  const [resolution, setResolution] = useState(ticket.resolution || 'repair');
  const [discount, setDiscount] = useState(tt.discount || 0);
  const disc = Math.min(Math.max(0, num(discount)), gross);
  const total = gross - disc;
  const [paid, setPaid] = useState(total);
  const [paidEdited, setPaidEdited] = useState(false);
  const [refund, setRefund] = useState(0);
  const [accountId, setAccountId] = useState(meta.accounts?.[0]?.id || '');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pending = (ticket.parts || []).filter((p) => p.stock_applied === 0);

  useEffect(() => { if (!paidEdited) setPaid(total); }, [total, paidEdited]);

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await api.post(`/warranty/${ticket.id}/deliver`, {
        resolution, discount: disc, paid: Math.min(num(paid), total),
        refund_amount: resolution === 'refund' ? num(refund) : 0, account_id: accountId,
        user_id: user?.id, note, photos,
      });
      toast(`Đã hoàn thành phiếu ${ticket.code}${res.stock_applied ? `, trừ kho ${res.stock_applied} dòng linh kiện` : ''}`, 'ok', 6000);
      onDone();
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
      title="Hoàn thành phiếu & trả khách"
      subtitle={`${ticket.code} · ${ticket.product_name}`}
      size="lg"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" icon={PackageCheck} onClick={submit} loading={busy}>Xác nhận hoàn thành</Button>
      </>}
    >
      <div className="space-y-3">
        {ticket.in_warranty === 1 && (
          <div className="card p-2.5 bg-accent-soft/40 border-accent/25 text-[13px]">
            Hàng này <b>còn trong hạn bảo hành</b> — thường sửa miễn phí; miễn giảm phần khách không phải trả.
          </div>
        )}
        {pending.length > 0 && (
          <div className="card p-2.5 text-[13px] flex gap-2">
            <Info size={15} className="text-info shrink-0 mt-0.5" aria-hidden="true" />
            <span>Hoàn thành sẽ <b>trừ kho {pending.length} dòng linh kiện</b>: {pending.map((p) => `${p.product_name} × ${fq(p.qty)}`).join(', ')}.</span>
          </div>
        )}

        <Field label="Cách xử lý cuối cùng" required htmlFor="wd-res">
          <Select id="wd-res" value={resolution} onChange={(e) => setResolution(e.target.value)}>
            {Object.entries(RESOLUTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-[1fr_260px]">
          <div className="card p-2.5 text-[13px] space-y-0.5">
            <div className="flex justify-between"><span className="text-muted-ink">Linh kiện trong kho</span><span className="tabular">{money(tt.parts)}</span></div>
            <div className="flex justify-between"><span className="text-muted-ink">Linh kiện ngoài hệ thống</span><span className="tabular">{money(tt.custom_parts)}</span></div>
            <div className="flex justify-between"><span className="text-muted-ink">Tiền công</span><span className="tabular">{money(tt.labor)}</span></div>
            <div className="flex justify-between"><span className="text-muted-ink">Phí phát sinh</span><span className="tabular">{money(tt.fees)}</span></div>
            <div className="flex justify-between pt-1 border-t border-line font-semibold"><span>Cộng</span><span className="tabular">{money(gross)}</span></div>
          </div>
          <div className="space-y-2">
            <Field label="Miễn giảm" htmlFor="wd-disc">
              <MoneyInput id="wd-disc" value={discount} onChange={setDiscount} />
              <div className="flex gap-1.5 mt-1">
                <button type="button" className="btn btn-sm btn-outline" onClick={() => setDiscount(gross)}>Miễn phí</button>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => setDiscount(0)}>Không giảm</button>
              </div>
            </Field>
            <div className="flex items-baseline justify-between">
              <span className="font-bold text-[13px]">Tổng khách trả</span>
              <span className="text-xl font-display font-bold tabular">{money(total)}</span>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Khách trả ngay" hint={total - num(paid) > 0 ? `Còn nợ ${money(total - num(paid))}` : ''} htmlFor="wd-paid">
            <MoneyInput id="wd-paid" value={paid} onChange={(v) => { setPaid(v); setPaidEdited(true); }} />
          </Field>
          {resolution === 'refund' && (
            <Field label="Số tiền hoàn cho khách" required htmlFor="wd-refund">
              <MoneyInput id="wd-refund" value={refund} onChange={setRefund} />
            </Field>
          )}
          {(num(paid) > 0 || num(refund) > 0) && (
            <Field label={num(paid) > 0 ? 'Nộp vào quỹ' : 'Chi từ quỹ'} htmlFor="wd-acc">
              <Select id="wd-acc" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
                {meta.accounts.map((a) => <option key={a.id} value={a.id}>{a.name} — số dư {money(a.balance)}</option>)}
              </Select>
            </Field>
          )}
        </div>

        <PhotoPicker photos={photos} onChange={setPhotos} max={6} label="Ảnh lúc trả khách (không bắt buộc)" />

        <Field label="Ghi chú" htmlFor="wd-note">
          <Textarea id="wd-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Đã thay tụ, chạy thử ổn, bảo hành công 1 tháng" />
        </Field>

        {err && <ErrLine>{err}</ErrLine>}
      </div>
    </Modal>
  );
}

/* ==================================================================== */

function AddPhotosModal({ kind, ticket, onClose, onDone }) {
  const { toast } = useApp();
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (kind) setPhotos([]); }, [kind]);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/warranty/${ticket.id}/photos`, { photos, kind });
      toast('Đã thêm ảnh', 'ok');
      onDone();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!kind}
      onClose={onClose}
      title="Thêm ảnh vào phiếu"
      size="md"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={submit} loading={busy} disabled={!photos.length}>Lưu {photos.length} ảnh</Button>
      </>}
    >
      <PhotoPicker photos={photos} onChange={setPhotos} max={8} />
    </Modal>
  );
}

/* ==================================================================== */
/* Tra hạn bảo hành hàng đã bán                                          */
/* ==================================================================== */

function Lookup() {
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [history, setHistory] = useState(null);
  const { data, busy, error } = useFetch(
    () => api.warrantyLookup(submitted), [submitted], { skip: !submitted });

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <span className="label">Tra hạn bảo hành hàng đã bán</span>
        <p className="text-[13px] text-muted-ink mb-2">
          Nhập số điện thoại khách, mã hoá đơn, số serial hoặc tên hàng. Máy đổi mới từ bảo hành cũng tra được,
          kèm liên kết về hoá đơn mua ban đầu.
        </p>
        <div className="flex gap-2 max-w-xl">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setSubmitted(q.trim())}
            placeholder="0913111222 · HD260908-0001 · PNS-2026-0099"
            aria-label="Tra hạn bảo hành"
            autoFocus
          />
          <Button variant="primary" icon={Search} onClick={() => setSubmitted(q.trim())} disabled={!q.trim()}>Tra cứu</Button>
        </div>
      </div>

      {!submitted ? null
        : busy ? <Spinner />
          : error ? <ErrorBox error={error} />
            : !data?.length ? (
              <Empty icon={Search} title="Không tìm thấy"
                message={`Không có hàng đã bán nào khớp "${submitted}". Thử số điện thoại khác hoặc mã hoá đơn.`} />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Hàng hoá</th><th>Khách hàng</th><th>Hoá đơn</th><th>Ngày mua</th>
                      <th className="text-right">SL</th>
                      <th>Bảo hành</th><th>Tình trạng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row, i) => (
                      <tr key={row.item_id ?? `x${row.exchanged_ticket_id}-${i}`} className="hoverable">
                        <td>
                          <div className="font-semibold flex flex-wrap items-center gap-1">
                            {row.product_name}
                            <WarrantyFlag count={row.ticket_count}
                              onClick={() => setHistory({ query: { sale_id: row.sale_id, product_id: row.product_id }, subtitle: `${row.product_name} · ${row.sale_code}` })} />
                          </div>
                          <div className="text-2xs text-muted-ink font-mono">
                            {row.sku}{row.serial ? ` · SN ${row.serial}` : ''}
                          </div>
                          {row.exchanged_from_code && (
                            <div className="text-2xs text-sky-800 font-semibold">
                              Đổi mới từ sản phẩm cũ có mã BH: {row.exchanged_from_code}
                            </div>
                          )}
                        </td>
                        <td>
                          <div>{row.customer_name}</div>
                          {row.customer_phone && <div className="text-2xs text-muted-ink tabular">{row.customer_phone}</div>}
                        </td>
                        <td className="font-mono">{row.sale_code || '—'}</td>
                        <td className="text-muted-ink whitespace-nowrap">{row.sale_ts ? date(row.sale_ts) : '—'}</td>
                        <td className="num">{fq(row.qty)} {row.unit_name}</td>
                        <td className="text-muted-ink">
                          {row.warranty_months > 0
                            ? `${row.warranty_months} tháng — tới ${date(row.warranty_until)}`
                            : row.warranty_until ? `tới ${date(row.warranty_until)}` : '—'}
                          {row.warranty_note && <div className="text-2xs">Điều kiện: {row.warranty_note}</div>}
                        </td>
                        <td>
                          {row.in_warranty === 1
                            ? <Badge tone="ok">Còn {row.days_left} ngày</Badge>
                            : row.warranty_until
                              ? <Badge tone="bad">Hết hạn</Badge>
                              : <span className="text-muted-ink text-2xs">Không khai BH</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

      <WarrantyHistoryModal open={!!history} onClose={() => setHistory(null)} query={history?.query} subtitle={history?.subtitle} />
    </div>
  );
}

/* ==================================================================== */
/* In biên nhận cho khách giữ                                            */
/* ==================================================================== */

function ReceiptPrint({ ticket, store, onClose }) {
  const { settings } = useApp();
  const keepDays = Number(settings?.warranty?.keep_days) || 30;
  const repair = ticket.ticket_type === 'repair';
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); window.print(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const body = (
    <div className="print-a5 text-black bg-white">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{store.name}</div>
          {store.address && <div style={{ fontSize: 10 }}>{store.address}</div>}
          {store.phone && <div style={{ fontSize: 10 }}>ĐT: {store.phone}</div>}
        </div>
        <div style={{ textAlign: 'right', fontSize: 10 }}>
          <div>Số phiếu: <b>{ticket.code}</b></div>
          <div>Ngày {date(ticket.ts)}</div>
        </div>
      </div>

      <div style={{ textAlign: 'center', margin: '12px 0 3px' }}>
        <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: 1 }}>
          {repair ? 'BIÊN NHẬN HÀNG SỬA CHỮA' : 'BIÊN NHẬN HÀNG BẢO HÀNH'}
        </div>
        <div style={{ fontSize: 10, fontStyle: 'italic' }}>Quý khách vui lòng giữ phiếu này để nhận lại hàng</div>
      </div>

      <table style={{ fontSize: 11, width: '100%', marginTop: 10 }}>
        <tbody>
          <tr><td style={{ width: '28%', paddingBottom: 3 }}>Khách hàng:</td>
            <td style={{ fontWeight: 600 }}>{ticket.customer_display || '—'}</td></tr>
          <tr><td style={{ paddingBottom: 3 }}>Điện thoại:</td><td>{ticket.phone_display || '—'}</td></tr>
          <tr><td style={{ paddingBottom: 3 }}>Tên hàng:</td><td style={{ fontWeight: 600 }}>{ticket.product_name}</td></tr>
          {ticket.serial && <tr><td style={{ paddingBottom: 3 }}>Số serial:</td><td>{ticket.serial}</td></tr>}
          <tr><td style={{ paddingBottom: 3 }}>Số lượng:</td><td>{fq(ticket.qty)}</td></tr>
          <tr><td style={{ paddingBottom: 3 }}>Lỗi khách báo:</td><td>{ticket.issue || '—'}</td></tr>
          <tr><td style={{ paddingBottom: 3 }}>Tình trạng khi nhận:</td><td>{ticket.condition_note || '—'}</td></tr>
          <tr><td style={{ paddingBottom: 3 }}>Phụ kiện kèm theo:</td><td>{ticket.accessories || 'Không'}</td></tr>
          <tr><td style={{ paddingBottom: 3 }}>Loại phiếu:</td>
            <td>{repair
              ? 'Sửa chữa dịch vụ — có tính phí'
              : ticket.in_warranty === 1
                ? `Bảo hành — còn hạn${ticket.warranty_until ? ` tới ${date(ticket.warranty_until)}` : ''}`
                : 'Bảo hành'}</td></tr>
          {ticket.technician_name && <tr><td style={{ paddingBottom: 3 }}>Kỹ thuật viên:</td><td>{ticket.technician_name}</td></tr>}
          <tr><td>Hẹn trả khách:</td>
            <td style={{ fontWeight: 700 }}>{ticket.promised_at ? date(ticket.promised_at) : 'Sẽ báo sau'}</td></tr>
        </tbody>
      </table>

      <div style={{ fontSize: 10, marginTop: 10, border: '1px solid #000', padding: '5px 7px', lineHeight: 1.5 }}>
        <b>Lưu ý</b>
        <div>1. Quý khách vui lòng mang theo phiếu này khi tới nhận hàng.</div>
        <div>2. Cửa hàng chỉ nhận đúng phụ kiện đã ghi ở trên.</div>
        <div>3. {repair ? 'Cửa hàng báo giá linh kiện, tiền công trước khi sửa.' : 'Hàng hết hạn hoặc không đủ điều kiện bảo hành sẽ báo giá trước khi sửa.'}</div>
        <div>4. Quá {keepDays} ngày kể từ ngày hẹn mà không tới nhận, cửa hàng không giữ hàng nữa.</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 22 }}>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 11 }}>KHÁCH HÀNG</div>
          <div style={{ fontSize: 9, fontStyle: 'italic' }}>(Ký, ghi rõ họ tên)</div>
          <div style={{ height: 40 }} />
        </div>
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 11 }}>NGƯỜI NHẬN HÀNG</div>
          <div style={{ fontSize: 9, fontStyle: 'italic' }}>(Ký, ghi rõ họ tên)</div>
          <div style={{ height: 26 }} />
          <div style={{ fontSize: 10 }}>{ticket.received_by_name}</div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={`Biên nhận ${ticket.code}`}
        subtitle="In hai bản: khách giữ một, tiệm giữ một"
        size="lg"
        footer={<>
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" icon={Printer} onClick={() => window.print()}>In biên nhận</Button>
        </>}
      >
        <div className="border border-line rounded-lg bg-slate-100 p-4 overflow-auto max-h-[55vh]">
          <div className="bg-white mx-auto shadow-sm" style={{ width: 'fit-content' }}>{body}</div>
        </div>
      </Modal>
      <div className="print-area size-a5">{body}</div>
    </>
  );
}
