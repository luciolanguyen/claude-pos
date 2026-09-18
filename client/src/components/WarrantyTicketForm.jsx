/* ====================================================================
   TIẾP NHẬN MÁY BẢO HÀNH / SỬA CHỮA — NHIỀU MÓN MỘT PHIẾU (plan 31, 3a)

   Khách mang tới cùng lúc máy khoan, máy mài, quạt: ghi một lần thông tin
   khách, mỗi món một thẻ riêng (loại phiếu, lỗi, tình trạng, phụ kiện, ảnh).
   Lưu xong máy chủ sinh một phiếu gom TN… và mỗi món một phiếu BH… — mỗi món
   vẫn tự đi luồng kiểm tra / sửa / tính tiền / trả khách như trước.

   Hàng bảo hành riêng từng bộ phận (3e): tra hoá đơn ra hạn từng bộ phận,
   chọn đúng bộ phận khách báo hư thì biết còn bảo hành hay phải tính phí.
   ==================================================================== */
import { useState, useEffect } from 'react';
import { Printer, Search, ArrowRight, Plus, Trash2, ShieldCheck, Wrench } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch } from '../lib/store';
import { date, isoDate, match } from '../lib/format';
import {
  Button, IconButton, Modal, Badge, Field, Textarea, Combo, QtyInput, Input, Select,
} from './ui';
import SaveDraftButton from './DraftButtons';
import PhotoPicker from './PhotoPicker';
import { ProductPicker } from './ProductPicker';
import { WarrantyPartsList, partDuration } from './WarrantyParts';

const TYPES = {
  warranty: { label: 'Bảo hành', icon: ShieldCheck, hint: 'Hàng mua ở tiệm, còn hạn và đủ điều kiện' },
  repair: { label: 'Sửa chữa', icon: Wrench, hint: 'Hết hạn, lỗi người dùng, hàng ngoài — tính phí' },
};

const HEAD = { customer_id: null, customer_name: '', customer_phone: '', promised_at: '', technician_id: null };

let seq = 0;
const blankItem = (p = {}) => ({
  key: `i${Date.now()}-${seq++}`,
  ticket_type: 'warranty', sale_id: null, product_id: null, product_name: '', serial: '', qty: 1,
  issue: '', condition_note: '', accessories: '', in_warranty: false, warranty_until: '',
  component_name: '', parts: [], whole: null, photos: [], note: '',
  ...p,
});

/** Phiếu tạm đời cũ lưu một món trong payload.form — đổi sang dạng nhiều món. */
function fromDraft(payload) {
  if (Array.isArray(payload?.items)) {
    return { head: { ...HEAD, ...(payload.head || {}) }, items: payload.items.map((x) => blankItem({ ...x, photos: [] })) };
  }
  const f = payload?.form || {};
  return {
    head: {
      ...HEAD, customer_id: f.customer_id || null, customer_name: f.customer_name || '',
      customer_phone: f.customer_phone || '', promised_at: f.promised_at || '', technician_id: f.technician_id || null,
    },
    items: [blankItem({
      ticket_type: f.ticket_type || 'warranty', sale_id: f.sale_id || null, product_id: f.product_id || null,
      product_name: f.product_name || '', serial: f.serial || '', qty: f.qty || 1, issue: f.issue || '',
      condition_note: f.condition_note || '', accessories: f.accessories || '', in_warranty: !!f.in_warranty,
      warranty_until: f.warranty_until || '', note: f.note || '',
    })],
  };
}

export default function WarrantyTicketForm({ open, onClose, onSaved, draft = null }) {
  const { user, toast } = useApp();
  const [head, setHead] = useState(HEAD);
  const [items, setItems] = useState([blankItem()]);
  const [lookupQ, setLookupQ] = useState('');
  const [found, setFound] = useState(null);
  const [pickerFor, setPickerFor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [draftId, setDraftId] = useState(null);

  /* Một chỗ nạp duy nhất: mở phiếu tạm thì đổ nội dung cũ đè lên phiếu trắng */
  useEffect(() => {
    if (!open) return;
    setDraftId(draft?.id || null);
    const base = { ...HEAD, promised_at: isoDate(new Date(Date.now() + 5 * 86400000)) };
    if (draft?.payload) {
      const d = fromDraft(draft.payload);
      setHead({ ...base, ...d.head });
      setItems(d.items.length ? d.items : [blankItem()]);
    } else {
      setHead(base);
      setItems([blankItem()]);
    }
    setLookupQ(''); setFound(null); setErr('');
  }, [open, draft]);

  const { data: customers } = useFetch(() => api.customers({ active: 1 }), [], { skip: !open });
  const { data: products } = useFetch(() => api.posProducts(), [], { skip: !open });
  const { data: users } = useFetch(() => api.users(), [], { skip: !open });
  const staff = (Array.isArray(users) ? users : []).filter((u) => u.active);

  const patchItem = (key, p) => setItems((list) => list.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const removeItem = (key) => setItems((list) => (list.length > 1 ? list.filter((x) => x.key !== key) : list));
  const setH = (k) => (e) => setHead((h) => ({ ...h, [k]: e?.target ? e.target.value : e }));

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

  /** Chọn một món đã bán: điền vào thẻ trống cuối cùng, hoặc thêm thẻ mới. */
  const pickSold = (row) => {
    const inW = row.in_warranty === 1;
    const fill = {
      ticket_type: inW ? 'warranty' : 'repair',
      sale_id: row.sale_id, product_id: row.product_id, product_name: row.product_name,
      serial: row.serial || '', in_warranty: inW, warranty_until: row.warranty_until || '',
      parts: row.warranty_parts || [], component_name: '',
      whole: { in_warranty: inW, warranty_until: row.warranty_until || '' },
    };
    setItems((list) => {
      const last = list[list.length - 1];
      if (last && !last.product_name.trim()) return list.map((x) => (x.key === last.key ? { ...x, ...fill } : x));
      return [...list, blankItem(fill)];
    });
    setHead((h) => (h.customer_id || h.customer_name.trim() || h.customer_phone.trim() ? h : {
      ...h,
      customer_id: row.customer_id || null,
      customer_name: row.customer_id ? '' : (row.customer_name || ''),
      customer_phone: row.customer_phone || '',
    }));
    setFound(null);
    if (row.warranty_parts?.length) {
      toast('Hàng này bảo hành theo từng bộ phận — chọn bộ phận khách báo hư để biết còn hạn không', 'info', 6000);
    } else {
      toast(inW
        ? `Còn bảo hành, hết hạn ${date(row.warranty_until)} — lập phiếu Bảo hành`
        : 'Hàng đã hết hạn bảo hành — chuyển sang Sửa chữa dịch vụ', inW ? 'ok' : 'warn', 5000);
    }
  };

  /** Chọn bộ phận hư: hạn bảo hành của món lấy theo đúng bộ phận đó. */
  const pickComponent = (it, part) => {
    if (!part) {
      const w = it.whole || { in_warranty: it.in_warranty, warranty_until: it.warranty_until };
      patchItem(it.key, { component_name: '', in_warranty: !!w.in_warranty, warranty_until: w.warranty_until || '',
        ticket_type: w.in_warranty ? 'warranty' : 'repair' });
      return;
    }
    const inW = part.in_warranty === 1;
    patchItem(it.key, { component_name: part.name, in_warranty: inW, warranty_until: part.until,
      ticket_type: inW ? 'warranty' : 'repair' });
  };

  const save = async () => {
    const unnamed = items.findIndex((x) => !x.product_name.trim());
    if (unnamed >= 0) {
      setErr(items.length > 1 ? `Món thứ ${unnamed + 1} chưa ghi tên hàng.` : 'Bắt buộc ghi tên hàng khách mang tới.');
      return;
    }
    if (!head.customer_id && !head.customer_name.trim() && !head.customer_phone.trim()) {
      setErr('Ghi ít nhất tên hoặc số điện thoại của khách để còn gọi khi sửa xong.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const res = await api.post('/warranty', {
        ...head,
        received_by: user?.id,
        items: items.map((x) => ({
          ticket_type: x.ticket_type, sale_id: x.sale_id, product_id: x.product_id,
          product_name: x.product_name, serial: x.serial, qty: Number(x.qty) || 1,
          issue: x.issue, condition_note: x.condition_note, accessories: x.accessories,
          in_warranty: x.ticket_type === 'warranty' && x.in_warranty ? 1 : 0,
          warranty_until: x.warranty_until || null, component_name: x.component_name || null,
          note: x.note, photos: x.photos,
        })),
      });
      if (draftId) { try { await api.del(`/doc-drafts/${draftId}`); } catch { /* nháp mất rồi */ } }
      onSaved?.(res);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const named = items.filter((x) => x.product_name.trim());

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Tiếp nhận máy bảo hành / sửa chữa"
        subtitle="Khách mang nhiều món thì thêm từng món vào cùng một phiếu, in chung một biên nhận"
        size="xl"
        footer={<>
          {/* Phiếu tạm KHÔNG mang theo ảnh: ảnh base64 vài megabyte nhét vào
              một ô văn bản chỉ làm phình cơ sở dữ liệu. */}
          <SaveDraftButton
            className="mr-auto"
            disabled={!named.length}
            onSaved={(d) => setDraftId(d.id)}
            build={() => ({
              kind: 'warranty',
              id: draftId,
              title: named.length > 1
                ? `Tiếp nhận ${named.length} món: ${named.map((x) => x.product_name).join(', ')}`
                : `${TYPES[named[0]?.ticket_type]?.label || 'Bảo hành'} ${named[0]?.product_name || ''}`.trim(),
              partner_name: head.customer_name || null,
              item_count: named.length,
              payload: { head, items: items.map(({ photos: _p, ...x }) => x) },
            })}
          />
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" icon={Printer} onClick={save} loading={busy}>
            {items.length > 1 ? `Lưu ${items.length} món & in biên nhận` : 'Lưu & in biên nhận'}
          </Button>
        </>}
      >
        <div className="space-y-4">
          {/* Tra hoá đơn cũ */}
          <div className="card p-3 bg-accent-soft/30 border-accent/25">
            <span className="label">Tra hàng đã bán (không bắt buộc)</span>
            <p className="text-2xs text-muted-ink mb-2">
              Nhập số điện thoại khách, mã hoá đơn hoặc số serial để lấy sẵn thông tin và biết còn hạn bảo hành
              hay không. Bấm Chọn nhiều lần để thêm nhiều món.
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
              <div className="table-wrap mt-2 max-h-60 overflow-y-auto">
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
                          {row.warranty_parts?.length > 0
                            ? <WarrantyPartsList parts={row.warranty_parts} />
                            : row.in_warranty === 1
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

          {/* Khách hàng — chung cho mọi món */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Khách hàng có hồ sơ">
              <Combo
                items={customers || []}
                value={head.customer_id}
                onChange={(cid) => setHead((h) => ({ ...h, customer_id: cid }))}
                placeholder="Chọn khách quen..."
                filter={(c, q2) => match(c.name, q2) || (c.phone || '').includes(q2)}
                render={(c) => ({ label: c.name, sub: c.phone })}
              />
            </Field>
            <Field label="Hoặc ghi tên khách" hint="Khách lẻ chưa có hồ sơ" htmlFor="wt-cname">
              <Input id="wt-cname" value={head.customer_name} onChange={setH('customer_name')}
                disabled={!!head.customer_id} placeholder="Chú Tám" />
            </Field>
            <Field label="Số điện thoại" required htmlFor="wt-cphone">
              <Input id="wt-cphone" value={head.customer_phone} onChange={setH('customer_phone')}
                inputMode="tel" placeholder="09xx xxx xxx" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Kỹ thuật viên phụ trách" htmlFor="wt-tech">
              <Select id="wt-tech" value={head.technician_id || ''}
                onChange={(e) => setHead((h) => ({ ...h, technician_id: e.target.value ? Number(e.target.value) : null }))}>
                <option value="">— Chưa phân công —</option>
                {staff.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
              </Select>
            </Field>
            <Field label="Hẹn trả khách" htmlFor="wt-promise">
              <Input id="wt-promise" type="date" value={head.promised_at} onChange={setH('promised_at')} />
            </Field>
          </div>

          {/* Từng món */}
          <ol className="space-y-3" aria-label="Các món khách gửi">
            {items.map((it, idx) => (
              <li key={it.key} className="card p-3 space-y-3 border-l-4 border-l-accent/60">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-bold">Món {idx + 1}</span>
                  <div role="radiogroup" aria-label={`Loại phiếu món ${idx + 1}`} className="inline-flex rounded border border-line overflow-hidden">
                    {Object.entries(TYPES).map(([k, v]) => {
                      const Icon = v.icon;
                      const on = it.ticket_type === k;
                      return (
                        <button key={k} type="button" role="radio" aria-checked={on} title={v.hint}
                          onClick={() => patchItem(it.key, { ticket_type: k, in_warranty: k === 'warranty' ? it.in_warranty : false })}
                          className={`px-2.5 h-8 text-[13px] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors duration-150
                                      ${on ? 'bg-accent text-white' : 'bg-card hover:bg-muted'}`}>
                          <Icon size={13} aria-hidden="true" />{v.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex-1" />
                  {items.length > 1 && (
                    <IconButton icon={Trash2} size={15} label={`Bỏ món ${idx + 1}${it.product_name ? ` ${it.product_name}` : ''}`}
                      onClick={() => removeItem(it.key)} />
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="Tên hàng khách mang tới" required className="sm:col-span-2" htmlFor={`wt-pname-${it.key}`}>
                    <div className="flex gap-1.5">
                      <Input id={`wt-pname-${it.key}`} value={it.product_name}
                        onChange={(e) => patchItem(it.key, { product_name: e.target.value })}
                        placeholder="Máy bơm Panasonic 125W" />
                      <Button onClick={() => setPickerFor(it.key)}>Chọn</Button>
                    </div>
                  </Field>
                  <Field label="Số serial / số máy" htmlFor={`wt-serial-${it.key}`}>
                    <Input id={`wt-serial-${it.key}`} value={it.serial} onChange={(e) => patchItem(it.key, { serial: e.target.value })} />
                  </Field>
                  <Field label="Số lượng" htmlFor={`wt-qty-${it.key}`}>
                    <QtyInput id={`wt-qty-${it.key}`} size="md" value={it.qty} min={1}
                      onChange={(v) => patchItem(it.key, { qty: v })} />
                  </Field>
                </div>

                {/* Bảo hành riêng từng bộ phận (3e) */}
                {it.parts?.length > 0 && (
                  <fieldset className="rounded border border-violet-200 bg-violet-50/50 p-2.5">
                    <legend className="px-1 text-2xs font-bold text-violet-900">Bộ phận khách báo hư</legend>
                    <div className="flex flex-wrap gap-1.5">
                      {it.parts.map((p) => {
                        const on = it.component_name === p.name;
                        return (
                          <button key={p.name} type="button" role="radio" aria-checked={on} onClick={() => pickComponent(it, p)}
                            className={`rounded border px-2.5 py-1 text-left text-[13px] cursor-pointer transition-colors duration-150
                                        ${on ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-line bg-card hover:bg-muted'}`}>
                            <span className="block font-semibold">{p.name}</span>
                            <span className="block text-2xs text-muted-ink">
                              {partDuration(p)} · tới {date(p.until)} ·{' '}
                              {p.in_warranty === 1
                                ? <b className="text-emerald-800">còn {p.days_left} ngày</b>
                                : <b className="text-danger">hết hạn</b>}
                            </span>
                          </button>
                        );
                      })}
                      <button type="button" role="radio" aria-checked={!it.component_name} onClick={() => pickComponent(it, null)}
                        className={`rounded border px-2.5 py-1 text-[13px] cursor-pointer transition-colors duration-150
                                    ${!it.component_name ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-line bg-card hover:bg-muted'}`}>
                        Cả máy / chưa rõ
                      </button>
                    </div>
                  </fieldset>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Lỗi khách báo" required htmlFor={`wt-issue-${it.key}`}>
                    <Textarea id={`wt-issue-${it.key}`} rows={2} value={it.issue}
                      onChange={(e) => patchItem(it.key, { issue: e.target.value })}
                      placeholder="Bơm không lên nước, có tiếng kêu lạ" />
                  </Field>
                  <Field label="Tình trạng máy lúc nhận" hint="Trầy xước, móp, thiếu ốc — tránh tranh cãi lúc trả" htmlFor={`wt-cond-${it.key}`}>
                    <Textarea id={`wt-cond-${it.key}`} rows={2} value={it.condition_note}
                      onChange={(e) => patchItem(it.key, { condition_note: e.target.value })}
                      placeholder="Vỏ trầy nhẹ góc phải, đủ ốc, không móp" />
                  </Field>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 items-end">
                  <Field label="Phụ kiện kèm theo" htmlFor={`wt-acc-${it.key}`}>
                    <Input id={`wt-acc-${it.key}`} value={it.accessories}
                      onChange={(e) => patchItem(it.key, { accessories: e.target.value })} placeholder="Dây điện, phích cắm, hộp" />
                  </Field>
                  <Field label={it.component_name ? `Hạn bảo hành ${it.component_name}` : 'Hạn bảo hành'} hint="Để trống nếu không rõ" htmlFor={`wt-until-${it.key}`}>
                    <Input id={`wt-until-${it.key}`} type="date" value={it.warranty_until}
                      onChange={(e) => patchItem(it.key, { warranty_until: e.target.value })} />
                  </Field>
                  {it.ticket_type === 'warranty' && (
                    <label className="flex items-center gap-2 text-[13px] cursor-pointer pb-2">
                      <input type="checkbox" className="w-4 h-4 accent-emerald-700 cursor-pointer"
                        checked={it.in_warranty} onChange={(e) => patchItem(it.key, { in_warranty: e.target.checked })} />
                      Còn trong hạn bảo hành
                    </label>
                  )}
                </div>

                <PhotoPicker photos={it.photos} onChange={(ph) => patchItem(it.key, { photos: ph })} max={8}
                  label={`Ảnh chụp lúc nhận${items.length > 1 ? ` — món ${idx + 1}` : ''}`} />
              </li>
            ))}
          </ol>

          <Button icon={Plus} onClick={() => setItems((list) => [...list, blankItem({ ticket_type: list[list.length - 1]?.ticket_type || 'warranty' })])}>
            Thêm món khác
          </Button>

          {err && (
            <p role="alert" className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>
          )}
        </div>
      </Modal>

      <ProductPicker
        open={!!pickerFor}
        onClose={() => setPickerFor(null)}
        products={products || []}
        withQty={false}
        onPick={(p) => {
          patchItem(pickerFor, { product_id: p.id, product_name: p.name });
          setPickerFor(null);
        }}
        title="Chọn hàng trong danh mục"
      />
    </>
  );
}
