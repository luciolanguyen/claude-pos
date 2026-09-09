import { useState, useMemo, useEffect } from 'react';
import {
  ShieldCheck, Plus, Eye, Search, Clock, AlertTriangle, Truck, Wrench,
  PackageCheck, Printer, XCircle, Trash2, RefreshCw, CheckCircle2, ArrowRight,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch, usePaged, useDebounced } from '../lib/store';
import { money, n, short, qty as fq, datetime, date, smartTime, isoDate, match } from '../lib/format';
import {
  Button, IconButton, SearchInput, Select, Modal, Spinner, Empty, ErrorBox, Badge,
  Confirm, Field, MoneyInput, Textarea, Stat, Combo, QtyInput, Input, Tabs, Pager,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import PhotoPicker, { PhotoGallery } from '../components/PhotoPicker';
import WarrantyReturnPrint from '../components/WarrantyReturnPrint';
import { ProductPicker } from '../components/ProductPicker';

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

const StatusBadge = ({ s }) => {
  const st = STATUS[s] || { label: s, tone: 'mute', icon: Clock };
  const Icon = st.icon;
  return <Badge tone={st.tone}><Icon size={10} aria-hidden="true" />{st.label}</Badge>;
};

export default function Warranty() {
  const { toast } = useApp();
  const [tab, setTab] = useState('tickets');

  return (
    <>
      <PageHeader
        title="Bảo hành"
        subtitle="Nhận hàng khách mang tới sửa, và tra hạn bảo hành hàng đã bán"
      />
      <div className="bg-card border-b border-line px-4">
        <Tabs
          value={tab}
          onChange={setTab}
          className="!border-b-0"
          tabs={[
            { key: 'tickets', label: 'Phiếu bảo hành' },
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
/* Danh sách phiếu bảo hành                                              */
/* ==================================================================== */

function Tickets() {
  const { toast, store } = useApp();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [status, setStatus] = useState('');
  const [openOnly, setOpenOnly] = useState(true);

  const {
    rows: data, total: rowCount, busy, error, reload,
    page, setPage, pageSize, setPageSize,
  } = usePaged(
    (pg) => api.warranty({ q: dq, status, open_only: openOnly ? 1 : '', ...pg }),
    [dq, status, openOnly],
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
            sub="Chưa trả khách" tone={summary.open > 0 ? 'warn' : 'default'} />
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
                    <button onClick={() => setDetailId(x.id)}
                      className="hover:underline cursor-pointer text-left">
                      <b className="font-mono">{x.code}</b> — {x.product_name} ·{' '}
                      {x.customer_display} {x.phone_display ? `(${x.phone_display})` : ''} ·{' '}
                      <b>trễ {x.days_late} ngày</b>
                    </button>
                  </li>
                ))}
              </ul>
              {summary.overdue.length > 4 && (
                <p className="text-2xs text-red-900/70 mt-1">
                  và {summary.overdue.length - 4} phiếu khác
                </p>
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
              <p className="font-semibold text-warn text-[13px]">
                {summary.at_supplier.length} món đang ở hãng
              </p>
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
        <Select value={status} onChange={(e) => setStatus(e.target.value)} size="sm" className="!w-auto">
          <option value="">Mọi trạng thái</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <button onClick={() => setOpenOnly((v) => !v)}
          className={`btn btn-sm ${openOnly ? 'btn-secondary' : 'btn-outline'}`}>
          Chỉ phiếu chưa trả khách
        </button>
        <div className="flex-1" />
        <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
          Nhận hàng bảo hành
        </Button>
      </div>

      {busy && !data ? <Spinner />
        : error ? <ErrorBox error={error} onRetry={reload} />
          : !data?.length ? (
            <Empty
              icon={ShieldCheck}
              title={openOnly ? 'Không có phiếu nào đang xử lý' : 'Chưa có phiếu bảo hành nào'}
              message="Khi khách mang máy hư tới, bấm Nhận hàng bảo hành để lập phiếu và in biên nhận cho khách giữ."
              action={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Nhận hàng bảo hành</Button>}
            />
          ) : (
            <div className="card">
            <div className="table-wrap table-scroll !border-0 !rounded-none">
              <table className="data">
                <thead>
                  <tr>
                    <th>Mã phiếu</th><th>Ngày nhận</th><th>Khách hàng</th><th>Hàng hoá</th>
                    <th>Lỗi</th><th>Trạng thái</th><th>Hẹn trả</th>
                    <th className="text-right">Ảnh</th>
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
                        <td className="text-muted-ink whitespace-nowrap">
                          {date(t.ts)}
                          {!['delivered', 'cancelled'].includes(t.status) && (
                            <div className="text-2xs">đã {t.days_open} ngày</div>
                          )}
                        </td>
                        <td>
                          <div className="truncate max-w-[150px]">{t.customer_display || '—'}</div>
                          {t.phone_display && (
                            <a href={`tel:${t.phone_display}`}
                              className="text-2xs text-accent hover:underline tabular">
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
                          {t.resolution && (
                            <div className="text-2xs text-muted-ink mt-0.5">{RESOLUTION[t.resolution]}</div>
                          )}
                        </td>
                        <td className={late ? 'text-danger font-semibold' : 'text-muted-ink'}>
                          {t.promised_at ? date(t.promised_at) : '—'}
                          {late && <div className="text-2xs">quá hẹn</div>}
                        </td>
                        <td className="num text-muted-ink">{t.photo_count || '—'}</td>
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
            <Pager
              page={page}
              pageSize={pageSize}
              total={rowCount}
              onPage={setPage}
              onPageSize={setPageSize}
            />
            </div>
          )}

      <TicketForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={async (res) => {
          setCreating(false);
          refresh();
          toast(`Đã lập phiếu bảo hành ${res.code}`, 'ok');
          setPrinting(await api.warrantyTicket(res.id));
        }}
      />

      <TicketDetail
        id={detailId}
        onClose={() => setDetailId(null)}
        onChanged={refresh}
        onPrint={setPrinting}
        onPrintReturn={setReturnPrint}
      />

      {printing && (
        <ReceiptPrint ticket={printing} store={store} onClose={() => setPrinting(null)} />
      )}
      {returnPrint && (
        <WarrantyReturnPrint ticket={returnPrint} store={store} onClose={() => setReturnPrint(null)} />
      )}
    </div>
  );
}

/* ==================================================================== */
/* Lập phiếu tiếp nhận                                                   */
/* ==================================================================== */

const EMPTY = {
  customer_id: null, customer_name: '', customer_phone: '',
  sale_id: null, product_id: null, product_name: '', serial: '', qty: 1,
  issue: '', condition_note: '', accessories: '',
  in_warranty: false, warranty_until: '', promised_at: '', note: '',
};

function TicketForm({ open, onClose, onSaved }) {
  const { user, toast } = useApp();
  const [form, setForm] = useState(EMPTY);
  const [photos, setPhotos] = useState([]);
  const [lookupQ, setLookupQ] = useState('');
  const [found, setFound] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const { data: customers } = useFetch(() => api.customers({ active: 1 }), [], { skip: !open });
  const { data: products } = useFetch(() => api.posProducts(), [], { skip: !open });

  useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY, promised_at: isoDate(new Date(Date.now() + 5 * 86400000)) });
    setPhotos([]); setLookupQ(''); setFound(null); setErr('');
  }, [open]);

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
    setForm((f) => ({
      ...f,
      customer_id: row.customer_id || null,
      customer_name: row.customer_id ? '' : row.customer_name,
      customer_phone: row.customer_phone || '',
      sale_id: row.sale_id,
      product_id: row.product_id,
      product_name: row.product_name,
      serial: row.serial || '',
      in_warranty: row.in_warranty === 1,
      warranty_until: row.warranty_until || '',
    }));
    setFound(null);
    toast(row.in_warranty === 1
      ? `Còn bảo hành, hết hạn ${date(row.warranty_until)}`
      : 'Hàng này đã hết hạn bảo hành', row.in_warranty === 1 ? 'ok' : 'warn', 5000);
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
        in_warranty: form.in_warranty ? 1 : 0,
        received_by: user?.id,
        photos,
      });
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
        title="Nhận hàng bảo hành"
        subtitle="Lập phiếu và in biên nhận cho khách giữ"
        size="xl"
        footer={<>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" icon={Printer} onClick={save} loading={busy}>
            Lưu &amp; in biên nhận
          </Button>
        </>}
      >
        <div className="space-y-4">
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
                    {found.map((row) => (
                      <tr key={row.item_id} className="hoverable">
                        <td>
                          <div className="font-semibold">{row.product_name}</div>
                          <div className="text-2xs text-muted-ink font-mono">
                            {row.sale_code}{row.serial ? ` · SN ${row.serial}` : ''}
                          </div>
                        </td>
                        <td className="truncate max-w-[130px]">{row.customer_name}</td>
                        <td className="text-muted-ink whitespace-nowrap">{date(row.sale_ts)}</td>
                        <td>
                          {row.in_warranty === 1
                            ? <Badge tone="ok">Còn {row.days_left} ngày</Badge>
                            : row.warranty_until
                              ? <Badge tone="bad">Hết hạn {date(row.warranty_until)}</Badge>
                              : <span className="text-muted-ink text-2xs">Không khai BH</span>}
                        </td>
                        <td className="text-right">
                          <Button size="sm" variant="soft" icon={ArrowRight} onClick={() => pickSold(row)}>
                            Chọn
                          </Button>
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
            <Field label="Khách hàng có hồ sơ" className="sm:col-span-1">
              <Combo
                items={customers || []}
                value={form.customer_id}
                onChange={(id) => setForm((f) => ({ ...f, customer_id: id }))}
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
            <Field
              label="Tình trạng máy lúc nhận"
              hint="Ghi rõ trầy xước, móp, thiếu ốc — tránh tranh cãi lúc trả"
              htmlFor="wt-cond"
            >
              <Textarea id="wt-cond" rows={2} value={form.condition_note} onChange={set('condition_note')}
                placeholder="Vỏ trầy nhẹ góc phải, đủ ốc, không móp" />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Phụ kiện kèm theo" htmlFor="wt-acc">
              <Input id="wt-acc" value={form.accessories} onChange={set('accessories')}
                placeholder="Dây điện, phích cắm, hộp" />
            </Field>
            <Field label="Hạn bảo hành" hint="Để trống nếu không rõ" htmlFor="wt-until">
              <Input id="wt-until" type="date" value={form.warranty_until} onChange={set('warranty_until')} />
            </Field>
            <Field label="Hẹn trả khách" htmlFor="wt-promise">
              <Input id="wt-promise" type="date" value={form.promised_at} onChange={set('promised_at')} />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-[13px] cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-emerald-700 cursor-pointer"
              checked={form.in_warranty}
              onChange={(e) => setForm((f) => ({ ...f, in_warranty: e.target.checked }))} />
            Còn trong hạn bảo hành — sửa miễn phí cho khách
          </label>

          {/* Ảnh chụp lúc nhận */}
          <PhotoPicker photos={photos} onChange={setPhotos} max={8}
            label="Ảnh chụp lúc nhận hàng" />

          <Field label="Ghi chú thêm" htmlFor="wt-note">
            <Textarea id="wt-note" rows={2} value={form.note} onChange={set('note')} />
          </Field>

          {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
        </div>
      </Modal>

      <ProductPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        products={products || []}
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
/* Chi tiết phiếu — chuyển trạng thái, thay linh kiện, trả khách          */
/* ==================================================================== */

function TicketDetail({ id, onClose, onChanged, onPrint, onPrintReturn }) {
  const { toast, meta, user, can } = useApp();
  const { data: t, busy, reload } = useFetch(
    () => api.warrantyTicket(id), [id], { skip: !id }
  );
  const [statusOpen, setStatusOpen] = useState(false);
  const [partsOpen, setPartsOpen] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [addingPhotos, setAddingPhotos] = useState(null);

  const refresh = () => { reload(); onChanged?.(); };

  const removePhoto = async (p) => {
    if (!window.confirm('Xoá ảnh này?')) return;
    try { await api.del(`/warranty/photos/${p.id}`); refresh(); }
    catch (e) { toast(e.message, 'bad'); }
  };

  const removePart = async (p) => {
    try {
      await api.del(`/warranty/${t.id}/parts/${p.id}`);
      toast('Đã bỏ linh kiện và hoàn về kho', 'ok');
      refresh();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const doCancel = async () => {
    try {
      await api.post(`/warranty/${t.id}/cancel`, { user_id: user?.id });
      toast('Đã huỷ phiếu, linh kiện hoàn về kho', 'ok');
      setCancelling(false);
      refresh();
      onClose();
    } catch (e) { toast(e.message, 'bad'); }
  };

  const closed = t && ['delivered', 'cancelled'].includes(t.status);
  const maySeeCost = can('cost.view');

  /* Giá bán đang gõ dở của từng dòng. Lưu khi rời ô, không lưu mỗi lần gõ
     một chữ số — đỡ gọi máy chủ liên tục. */
  const [partPrice, setPartPrice] = useState({});
  const savePartPrice = async (p) => {
    const v = partPrice[p.id];
    if (v === undefined || v === p.price) return;
    try {
      await api.put(`/warranty/${t.id}/parts/${p.id}`, { price: v });
      onChanged?.();
      reload();
    } catch (e) {
      toast(e.message, 'bad', 6000);
      setPartPrice((m) => ({ ...m, [p.id]: p.price }));   // trả về số cũ
    }
  };

  return (
    <>
      <Modal
        open={!!id}
        onClose={onClose}
        title={t ? `Phiếu bảo hành ${t.code}` : 'Phiếu bảo hành'}
        subtitle={t ? `${datetime(t.ts)} · nhận bởi ${t.received_by_name || '—'}` : ''}
        size="xl"
        footer={t && <>
          {!closed && (
            <Button variant="danger" icon={XCircle} onClick={() => setCancelling(true)}>Huỷ phiếu</Button>
          )}
          <div className="flex-1" />
          <Button icon={Printer} onClick={() => { onPrint(t); onClose(); }}>In biên nhận</Button>
          {t.status === 'delivered' && (
            <Button icon={Printer} onClick={() => { onPrintReturn(t); onClose(); }}>
              In phiếu trả hàng
            </Button>
          )}
          {!closed && (
            <Button variant="primary" icon={PackageCheck} onClick={() => setDeliverOpen(true)}>
              Trả khách
            </Button>
          )}
          <Button onClick={onClose}>Đóng</Button>
        </>}
      >
        {busy || !t ? <Spinner /> : (
          <div className="space-y-4">
            {/* Tóm tắt */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="card p-2.5 text-[13px]">
                <div className="text-2xs font-bold text-muted-ink uppercase mb-1">Khách hàng</div>
                <div className="font-semibold">{t.customer_display || '—'}</div>
                {t.phone_display && (
                  <a href={`tel:${t.phone_display}`} className="text-accent hover:underline tabular">
                    {t.phone_display}
                  </a>
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
                    : <Badge tone="mute">Hết hạn bảo hành</Badge>}
                </div>
              </div>

              <div className="card p-2.5 text-[13px]">
                <div className="text-2xs font-bold text-muted-ink uppercase mb-1">Tình trạng</div>
                <StatusBadge s={t.status} />
                {t.resolution && <div className="mt-1">Xử lý: <b>{RESOLUTION[t.resolution]}</b></div>}
                {t.promised_at && (
                  <div className="text-muted-ink mt-0.5">Hẹn trả: {date(t.promised_at)}</div>
                )}
                {t.supplier_name && (
                  <div className="text-muted-ink">
                    Gửi {t.supplier_name}{t.sent_at ? ` ngày ${date(t.sent_at)}` : ''}
                  </div>
                )}
                {!closed && (
                  <Button size="sm" icon={RefreshCw} className="mt-2" onClick={() => setStatusOpen(true)}>
                    Đổi trạng thái
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
                {t.accessories && (
                  <p className="text-muted-ink mt-1">Phụ kiện: {t.accessories}</p>
                )}
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

            {/* Linh kiện đã thay */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="label !mb-0">Linh kiện đã thay</span>
                {!closed && (
                  <Button size="sm" icon={Plus} onClick={() => setPartsOpen(true)}>Thêm linh kiện</Button>
                )}
              </div>
              {t.parts.length === 0 ? (
                <p className="text-[13px] text-muted-ink py-2">Chưa thay linh kiện nào.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Linh kiện</th>
                        <th className="text-right">Số lượng</th>
                        {maySeeCost && <th className="text-right">Giá vốn</th>}
                        <th style={{ width: 150 }} className="text-right">Giá bán</th>
                        <th className="text-right">Thành tiền</th>
                        <th style={{ width: 40 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {t.parts.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <div className="font-semibold">{p.product_name}</div>
                            <div className="text-2xs text-muted-ink font-mono">{p.sku}</div>
                          </td>
                          <td className="num">{fq(p.qty)} {p.base_unit}</td>
                          {maySeeCost && <td className="num text-muted-ink">{money(p.unit_cost)}</td>}
                          <td>
                            {closed ? (
                              <div className="num">{money(p.price)}</div>
                            ) : (
                              <MoneyInput
                                size="sm"
                                value={partPrice[p.id] ?? p.price}
                                onChange={(v) => setPartPrice((m) => ({ ...m, [p.id]: v }))}
                                onBlur={() => savePartPrice(p)}
                                aria-label={`Giá bán ${p.product_name}`}
                              />
                            )}
                          </td>
                          <td className="num font-semibold">
                            {money(Math.round(p.qty * (partPrice[p.id] ?? p.price)))}
                          </td>
                          <td>
                            {!closed && (
                              <IconButton icon={Trash2} label={`Bỏ ${p.product_name}`} size={13}
                                className="!text-danger hover:!bg-red-50" onClick={() => removePart(p)} />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={maySeeCost ? 4 : 3} className="text-right font-semibold">
                          TIỀN LINH KIỆN TÍNH KHÁCH
                        </td>
                        <td className="num font-bold">{money(t.parts_price)}</td>
                        <td />
                      </tr>
                      {maySeeCost && (
                        <tr className="text-muted-ink">
                          <td colSpan={4} className="text-right">Vốn tiệm bỏ ra</td>
                          <td className="num">{money(t.parts_cost)}</td>
                          <td />
                        </tr>
                      )}
                    </tfoot>
                  </table>
                </div>
              )}
              {!closed && !t.exchange_product_id && (
                <Button size="sm" className="mt-2" onClick={() => setExchangeOpen(true)}>
                  Đổi cái mới cho khách
                </Button>
              )}
              {t.exchange_product_name && (
                <p className="text-[13px] mt-2">
                  Đã đổi mới: <b>{t.exchange_product_name}</b>
                </p>
              )}
            </div>

            {/* Tiền */}
            {t.status === 'delivered' && (
              <div className="card p-3 space-y-1 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-muted-ink">Tiền công sửa</span>
                  <span className="tabular font-mono">{money(t.labor_fee)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-ink">Giá vốn linh kiện</span>
                  <span className="tabular font-mono">{money(t.parts_cost)}</span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-line font-bold">
                  <span>Thu của khách</span>
                  <span className="tabular font-mono">{money(t.charge)}</span>
                </div>
                {t.refund_amount > 0 && (
                  <div className="flex justify-between text-danger font-semibold">
                    <span>Hoàn tiền khách</span>
                    <span className="tabular font-mono">{money(t.refund_amount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-2xs text-muted-ink pt-1">
                  <span>Trả khách lúc</span>
                  <span>{datetime(t.delivered_at)}</span>
                </div>
              </div>
            )}

            {/* Nhật ký */}
            <div>
              <span className="label">Nhật ký xử lý</span>
              <ol className="border-l-2 border-line ml-2 space-y-2">
                {t.logs.map((l) => (
                  <li key={l.id} className="relative pl-4">
                    <span className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-accent"
                      aria-hidden="true" />
                    <div className="text-[13px] font-semibold">
                      {STATUS[l.status]?.label || l.status}
                    </div>
                    <div className="text-2xs text-muted-ink">
                      {datetime(l.ts)}{l.user_name ? ` · ${l.user_name}` : ''}
                    </div>
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
          <PartsModal open={partsOpen} ticket={t} onClose={() => setPartsOpen(false)}
            onDone={() => { setPartsOpen(false); refresh(); }} />
          <ExchangeModal open={exchangeOpen} ticket={t} onClose={() => setExchangeOpen(false)}
            onDone={() => { setExchangeOpen(false); refresh(); }} />
          <DeliverModal open={deliverOpen} ticket={t} onClose={() => setDeliverOpen(false)}
            onDone={() => { setDeliverOpen(false); refresh(); onClose(); }} />
          <AddPhotosModal kind={addingPhotos} ticket={t} onClose={() => setAddingPhotos(null)}
            onDone={() => { setAddingPhotos(null); refresh(); }} />
          <Confirm
            open={cancelling}
            onClose={() => setCancelling(false)}
            onConfirm={doCancel}
            title="Huỷ phiếu bảo hành?"
            confirmText="Huỷ phiếu"
            message={<>Huỷ phiếu <b className="font-mono">{t.code}</b>? Linh kiện đã thay sẽ được hoàn về kho.</>}
          />
        </>
      )}
    </>
  );
}

/* ==================================================================== */

function StatusModal({ open, ticket, onClose, onDone }) {
  const { toast, user } = useApp();
  const [status, setStatus] = useState('checking');
  const [resolution, setResolution] = useState('');
  const [supplierId, setSupplierId] = useState(null);
  const [expectedAt, setExpectedAt] = useState('');
  const [promisedAt, setPromisedAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const { data: suppliers } = useFetch(() => api.suppliers({ active: 1 }), [], { skip: !open });

  useEffect(() => {
    if (!open || !ticket) return;
    const order = ['received', 'checking', 'repairing', 'ready'];
    const i = order.indexOf(ticket.status);
    setStatus(i >= 0 && i < order.length - 1 ? order[i + 1] : 'ready');
    setResolution(ticket.resolution || '');
    setSupplierId(ticket.supplier_id || null);
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
        supplier_id: supplierId, expected_at: expectedAt || null,
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

        {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
      </div>
    </Modal>
  );
}

/* ==================================================================== */

function PartsModal({ open, ticket, onClose, onDone }) {
  const { toast, meta, user, defaultWarehouse, defaultPriceList } = useApp();
  const [lines, setLines] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const { data: products } = useFetch(
    () => api.posProducts({ warehouse_id: defaultWarehouse }), [defaultWarehouse], { skip: !open }
  );

  useEffect(() => { if (open) { setLines([]); setErr(''); } }, [open]);

  /** Giá bán lẻ của đơn vị cơ bản — đây mới là giá báo cho khách. */
  const retailOf = (p) => {
    const u = p.units?.find((x) => x.is_base) || p.units?.[0];
    if (!u?.prices) return 0;
    return Number(u.prices[defaultPriceList] ?? Object.values(u.prices)[0]) || 0;
  };

  const add = (p) => setLines((prev) => prev.some((x) => x.product_id === p.id)
    ? prev
    : [...prev, { product_id: p.id, name: p.name, sku: p.sku, base_unit: p.base_unit,
        price: retailOf(p), stock: p.stock, qty: 1 }]);

  const total = lines.reduce((a, l) => a + Math.round(l.qty * l.price), 0);

  const submit = async () => {
    if (!lines.length) { setErr('Chưa chọn linh kiện nào.'); return; }
    setBusy(true);
    setErr('');
    try {
      await api.post(`/warranty/${ticket.id}/parts`, {
        warehouse_id: defaultWarehouse, user_id: user?.id,
        items: lines.map((l) => ({
          product_id: l.product_id, qty: Number(l.qty), price: Math.round(Number(l.price) || 0),
        })),
      });
      toast('Đã thay linh kiện và trừ kho', 'ok');
      onDone();
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
        title="Linh kiện thay khi sửa"
        subtitle="Linh kiện sẽ bị trừ khỏi kho như bán hàng"
        size="lg"
        footer={<>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!lines.length}>
            Lưu &amp; trừ kho
          </Button>
        </>}
      >
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button icon={Plus} onClick={() => setPickerOpen(true)}>Chọn linh kiện</Button>
          </div>

          {lines.length === 0 ? (
            <Empty icon={Wrench} title="Chưa chọn linh kiện"
              message="Bấm Chọn linh kiện để thêm những thứ đã thay cho khách." />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Linh kiện</th>
                    <th className="text-right">Tồn kho</th>
                    <th style={{ width: 100 }} className="text-right">Số lượng</th>
                    <th style={{ width: 140 }} className="text-right">Giá bán</th>
                    <th className="text-right">Thành tiền</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const over = l.qty > l.stock;
                    return (
                      <tr key={l.product_id} className={over ? 'bg-red-50' : ''}>
                        <td>
                          <div className="font-semibold">{l.name}</div>
                          <div className="text-2xs text-muted-ink font-mono">{l.sku}</div>
                        </td>
                        <td className={`num ${over ? 'text-danger font-bold' : 'text-muted-ink'}`}>
                          {fq(l.stock)} {l.base_unit}
                        </td>
                        <td>
                          <QtyInput value={l.qty} max={l.stock}
                            onChange={(v) => setLines((prev) => prev.map((x) =>
                              x.product_id === l.product_id ? { ...x, qty: v } : x))}
                            aria-label={`Số lượng ${l.name}`} />
                        </td>
                        <td>
                          <MoneyInput size="sm" value={l.price}
                            onChange={(v) => setLines((prev) => prev.map((x) =>
                              x.product_id === l.product_id ? { ...x, price: v } : x))}
                            aria-label={`Giá bán ${l.name}`} />
                        </td>
                        <td className="num font-semibold">{money(Math.round(l.qty * l.price))}</td>
                        <td>
                          <IconButton icon={Trash2} label={`Bỏ ${l.name}`} size={13}
                            className="!text-danger hover:!bg-red-50"
                            onClick={() => setLines((prev) => prev.filter((x) => x.product_id !== l.product_id))} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} className="text-right">TIỀN LINH KIỆN THU KHÁCH</td>
                    <td className="num">{money(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
        </div>
      </Modal>

      <ProductPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        products={(products || []).filter((p) => p.track_stock)}
        onPick={add}
        title="Chọn linh kiện thay thế"
      />
    </>
  );
}

/* ==================================================================== */

function ExchangeModal({ open, ticket, onClose, onDone }) {
  const { toast, user, defaultWarehouse } = useApp();
  const [productId, setProductId] = useState(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const { data: products } = useFetch(
    () => api.posProducts({ warehouse_id: defaultWarehouse }), [defaultWarehouse], { skip: !open }
  );

  useEffect(() => {
    if (!open || !ticket) return;
    setProductId(ticket.product_id || null);
    setQty(ticket.qty || 1);
    setErr('');
  }, [open, ticket]);

  const p = products?.find((x) => x.id === productId);

  const submit = async () => {
    if (!productId) { setErr('Chọn mặt hàng để đổi cho khách.'); return; }
    setBusy(true);
    setErr('');
    try {
      await api.post(`/warranty/${ticket.id}/exchange`, {
        product_id: productId, qty: Number(qty),
        warehouse_id: defaultWarehouse, user_id: user?.id,
      });
      toast('Đã đổi hàng mới và trừ kho', 'ok');
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
      title="Đổi cái mới cho khách"
      subtitle="Hàng mới sẽ bị trừ khỏi kho"
      size="sm"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={submit} loading={busy}>Xác nhận đổi</Button>
      </>}
    >
      <div className="space-y-3">
        <Field label="Hàng đổi cho khách" required>
          <Combo
            items={(products || []).filter((x) => x.track_stock)}
            value={productId}
            onChange={setProductId}
            placeholder="Chọn hàng trong kho..."
            filter={(x, q) => match(x.name, q) || match(x.alias || '', q) || match(x.sku, q)}
            render={(x) => ({ label: x.name, sub: `${x.sku} · tồn ${fq(x.stock)} ${x.base_unit}` })}
          />
        </Field>
        <Field label="Số lượng" required
          hint={p ? `Tồn kho: ${fq(p.stock)} ${p.base_unit}` : ''}>
          <QtyInput size="md" value={qty} onChange={setQty} min={1} max={p?.stock} />
          {p && qty > p.stock && <p className="error-text">Kho chỉ còn {fq(p.stock)}.</p>}
        </Field>
        {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
      </div>
    </Modal>
  );
}

/* ==================================================================== */

function DeliverModal({ open, ticket, onClose, onDone }) {
  const { toast, meta, user } = useApp();
  const [resolution, setResolution] = useState('repair');
  const [laborFee, setLaborFee] = useState(0);
  const [charge, setCharge] = useState(0);
  /* Đã sửa tay chưa. Chưa sửa thì tiền thu bám theo linh kiện + công;
     sửa rồi thì thôi, không tự ghi đè con số thợ vừa gõ. */
  const [chargeEdited, setChargeEdited] = useState(false);
  const [paid, setPaid] = useState(0);
  const [refund, setRefund] = useState(0);
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  /* Số phần mềm tự tính. Thợ chưa sửa tay thì tiền thu bám theo số này. */
  const suggested = Math.round((ticket?.parts_price || 0) + (Number(laborFee) || 0));
  useEffect(() => {
    if (!chargeEdited) setCharge(suggested);
  }, [suggested, chargeEdited]);

  useEffect(() => {
    if (!open || !ticket) return;
    setResolution(ticket.resolution || 'repair');
    setLaborFee(0); setPaid(0); setRefund(0);
    setCharge(ticket.parts_price || 0);   // linh kiện đã thay, tính theo giá bán
    setChargeEdited(false);
    setNote(''); setPhotos([]); setErr('');
    setAccountId(meta.accounts?.[0]?.id || '');
  }, [open, ticket, meta.accounts]);

  /* Còn bảo hành thì mặc định không thu tiền */
  useEffect(() => { setCharge(laborFee); setPaid(laborFee); }, [laborFee]);

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.post(`/warranty/${ticket.id}/deliver`, {
        resolution, labor_fee: laborFee, charge, paid,
        refund_amount: refund, account_id: accountId,
        user_id: user?.id, note, photos,
      });
      toast('Đã trả hàng cho khách', 'ok');
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
      title="Trả hàng cho khách"
      subtitle={ticket ? `${ticket.code} · ${ticket.product_name}` : ''}
      size="lg"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" icon={PackageCheck} onClick={submit} loading={busy}>
          Xác nhận đã trả khách
        </Button>
      </>}
    >
      {ticket && (
        <div className="space-y-3">
          {ticket.in_warranty === 1 && (
            <div className="card p-2.5 bg-accent-soft/40 border-accent/25 text-[13px]">
              Hàng này <b>còn trong hạn bảo hành</b> — thường sửa miễn phí, để tiền thu bằng 0.
            </div>
          )}

          <Field label="Cách xử lý cuối cùng" required htmlFor="wd-res">
            <Select id="wd-res" value={resolution} onChange={(e) => setResolution(e.target.value)}>
              {Object.entries(RESOLUTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Tiền công sửa" htmlFor="wd-labor">
              <MoneyInput id="wd-labor" value={laborFee} onChange={setLaborFee} />
            </Field>
            <Field
              label="Thu của khách"
              hint={chargeEdited ? 'Đã sửa tay' : 'Tự cộng: linh kiện + tiền công'}
              htmlFor="wd-charge"
            >
              <MoneyInput
                id="wd-charge"
                value={charge}
                onChange={(v) => { setCharge(v); setChargeEdited(true); }}
              />
              {chargeEdited && suggested !== charge && (
                <button
                  type="button"
                  className="text-2xs text-accent font-semibold hover:underline mt-1 cursor-pointer"
                  onClick={() => { setCharge(suggested); setChargeEdited(false); }}
                >
                  Quay lại số tự tính ({money(suggested)})
                </button>
              )}
            </Field>
            <Field label="Khách trả ngay" htmlFor="wd-paid">
              <MoneyInput id="wd-paid" value={paid} onChange={setPaid} />
            </Field>
          </div>

          {resolution === 'refund' && (
            <Field label="Số tiền hoàn cho khách" required htmlFor="wd-refund">
              <MoneyInput id="wd-refund" size="lg" value={refund} onChange={setRefund} />
            </Field>
          )}

          {(paid > 0 || refund > 0) && (
            <Field label={paid > 0 ? 'Nộp vào quỹ' : 'Chi từ quỹ'} htmlFor="wd-acc">
              <Select id="wd-acc" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
                {meta.accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} — số dư {money(a.balance)}</option>
                ))}
              </Select>
            </Field>
          )}

          <div className="card p-2.5 text-[13px] space-y-0.5">
            <div className="flex justify-between">
              <span className="text-muted-ink">Linh kiện — tính khách (giá bán)</span>
              <span className="tabular font-mono">{money(ticket.parts_price)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-ink">Linh kiện — vốn tiệm bỏ ra</span>
              <span className="tabular font-mono">{money(ticket.parts_cost)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-ink">Tiền công</span>
              <span className="tabular font-mono">{money(laborFee)}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-line font-semibold">
              <span>Lãi từ ca sửa này</span>
              <span className={`tabular font-mono ${charge - ticket.parts_cost < 0 ? 'text-danger' : 'text-emerald-700'}`}>
                {money(charge - ticket.parts_cost)}
              </span>
            </div>
          </div>

          <PhotoPicker photos={photos} onChange={setPhotos} max={6}
            label="Ảnh lúc trả khách (không bắt buộc)" />

          <Field label="Ghi chú" htmlFor="wd-note">
            <Textarea id="wd-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Đã thay tụ, chạy thử ổn, bảo hành công 1 tháng" />
          </Field>

          {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
        </div>
      )}
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
        <Button variant="primary" onClick={submit} loading={busy} disabled={!photos.length}>
          Lưu {photos.length} ảnh
        </Button>
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
  const { data, busy, error } = useFetch(
    () => api.warrantyLookup(submitted), [submitted], { skip: !submitted }
  );

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <span className="label">Tra hạn bảo hành hàng đã bán</span>
        <p className="text-[13px] text-muted-ink mb-2">
          Nhập số điện thoại khách, mã hoá đơn, số serial hoặc tên hàng.
          Khách quay lại mà không nhớ mua hồi nào thì tra bằng số điện thoại là ra.
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
          <Button variant="primary" icon={Search} onClick={() => setSubmitted(q.trim())} disabled={!q.trim()}>
            Tra cứu
          </Button>
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
                      <th className="text-right">Đơn giá</th>
                      <th>Bảo hành</th><th>Tình trạng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row) => (
                      <tr key={row.item_id} className="hoverable">
                        <td>
                          <div className="font-semibold">{row.product_name}</div>
                          <div className="text-2xs text-muted-ink font-mono">
                            {row.sku}{row.serial ? ` · SN ${row.serial}` : ''}
                          </div>
                        </td>
                        <td>
                          <div>{row.customer_name}</div>
                          {row.customer_phone && (
                            <div className="text-2xs text-muted-ink tabular">{row.customer_phone}</div>
                          )}
                        </td>
                        <td className="font-mono">{row.sale_code}</td>
                        <td className="text-muted-ink whitespace-nowrap">{date(row.sale_ts)}</td>
                        <td className="num">{fq(row.qty)} {row.unit_name}</td>
                        <td className="num">{money(row.price)}</td>
                        <td className="text-muted-ink whitespace-nowrap">
                          {row.warranty_months > 0
                            ? `${row.warranty_months} tháng — tới ${date(row.warranty_until)}`
                            : '—'}
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
    </div>
  );
}

/* ==================================================================== */
/* In biên nhận cho khách giữ                                            */
/* ==================================================================== */

function ReceiptPrint({ ticket, store, onClose }) {
  const { settings } = useApp();
  const keepDays = Number(settings?.warranty?.keep_days) || 30;
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
        <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: 1 }}>BIÊN NHẬN HÀNG BẢO HÀNH</div>
        <div style={{ fontSize: 10, fontStyle: 'italic' }}>Quý khách vui lòng giữ phiếu này để nhận lại hàng</div>
      </div>

      <table style={{ fontSize: 11, width: '100%', marginTop: 10 }}>
        <tbody>
          <tr><td style={{ width: '28%', paddingBottom: 3 }}>Khách hàng:</td>
            <td style={{ fontWeight: 600 }}>{ticket.customer_display || '—'}</td></tr>
          <tr><td style={{ paddingBottom: 3 }}>Điện thoại:</td><td>{ticket.phone_display || '—'}</td></tr>
          <tr><td style={{ paddingBottom: 3 }}>Tên hàng:</td>
            <td style={{ fontWeight: 600 }}>{ticket.product_name}</td></tr>
          {ticket.serial && (
            <tr><td style={{ paddingBottom: 3 }}>Số serial:</td><td>{ticket.serial}</td></tr>
          )}
          <tr><td style={{ paddingBottom: 3 }}>Số lượng:</td><td>{fq(ticket.qty)}</td></tr>
          <tr><td style={{ paddingBottom: 3 }}>Lỗi khách báo:</td><td>{ticket.issue || '—'}</td></tr>
          <tr><td style={{ paddingBottom: 3 }}>Tình trạng khi nhận:</td>
            <td>{ticket.condition_note || '—'}</td></tr>
          <tr><td style={{ paddingBottom: 3 }}>Phụ kiện kèm theo:</td>
            <td>{ticket.accessories || 'Không'}</td></tr>
          <tr><td style={{ paddingBottom: 3 }}>Bảo hành:</td>
            <td>{ticket.in_warranty === 1
              ? `Còn hạn${ticket.warranty_until ? ` tới ${date(ticket.warranty_until)}` : ''}`
              : 'Hết hạn / không xác định'}</td></tr>
          <tr><td>Hẹn trả khách:</td>
            <td style={{ fontWeight: 700 }}>{ticket.promised_at ? date(ticket.promised_at) : 'Sẽ báo sau'}</td></tr>
        </tbody>
      </table>

      <div style={{ fontSize: 10, marginTop: 10, border: '1px solid #000', padding: '5px 7px', lineHeight: 1.5 }}>
        <b>Lưu ý</b>
        <div>1. Quý khách vui lòng mang theo phiếu này khi tới nhận hàng.</div>
        <div>2. Cửa hàng chỉ nhận đúng phụ kiện đã ghi ở trên.</div>
        <div>3. Hàng hết hạn bảo hành sẽ báo giá trước khi sửa.</div>
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
