/* ====================================================================
   VAI TRÒ THỢ VÀ BƯỚC BÁO GIÁ (25/10/2026)

   Phiếu sửa đi thêm một bước song song với trạng thái xử lý:
     chờ báo giá → chờ khách đồng ý → được sửa (hoặc khách từ chối)
   Bảo hành miễn phí thì chủ bấm "Miễn phí — sửa luôn", bỏ qua khách.

   Thợ báo vật tư chỉ có tên và số lượng — máy chủ cắt hết tiền khỏi phiếu
   trước khi gửi cho thợ (routes/warranty.js, shapeTicket), ở đây chỉ là
   không vẽ ô tiền nào.
   ==================================================================== */
import { useState, useEffect, useMemo } from 'react';
import { Wrench, CheckCircle2, XCircle, Send, Gift, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch } from '../lib/store';
import { money, qty as fq } from '../lib/format';
import { Button, IconButton, Modal, Badge, Field, MoneyInput, QtyInput, Input, Textarea } from './ui';
import PhotoPicker from './PhotoPicker';
import CartPickerModal from './CartPickerModal';

export const QUOTE_STATE = {
  waiting_quote: { label: 'Chờ báo giá', tone: 'warn' },
  waiting_approval: { label: 'Chờ khách đồng ý', tone: 'info' },
  approved: { label: 'Khách đã đồng ý — được sửa', tone: 'ok' },
  declined: { label: 'Khách không sửa', tone: 'bad' },
  free: { label: 'Miễn phí — sửa luôn', tone: 'ok' },
};

export function QuoteBadge({ state }) {
  const q = QUOTE_STATE[state];
  return q ? <Badge tone={q.tone}>{q.label}</Badge> : null;
}

/** Thợ được sửa chưa — phiếu cũ (chưa có bước báo giá) thì như trước */
export const mayRepair = (t) => !['waiting_quote', 'waiting_approval', 'declined'].includes(t?.quote_state);

/**
 * Thanh báo giá trong chi tiết phiếu: hiện bước đang ở đâu và đúng nút của
 * người đang xem. beforeQuote: lưu bảng chi phí đang sửa dở trước khi báo giá.
 */
export function QuoteBar({ t, onChanged, onPropose, onDone, beforeQuote }) {
  const { can, toast } = useApp();
  const [busy, setBusy] = useState('');
  const closed = ['delivered', 'cancelled'].includes(t.status);
  if (closed && !t.quote_state) return null;

  const call = async (key, fn, okText) => {
    setBusy(key);
    try {
      if (key.startsWith('quote') && beforeQuote && !(await beforeQuote())) return;
      await fn();
      toast(okText, 'ok');
      onChanged();
    } catch (e) {
      toast(e.message, 'bad', 7000);
    } finally {
      setBusy('');
    }
  };
  const quote = (free) => call(free ? 'quote-free' : 'quote', () => api.post(`/warranty/${t.id}/quote`, { free }),
    free ? 'Đã đánh dấu miễn phí — thợ sửa luôn' : 'Đã chốt báo giá — chờ khách trả lời');
  const answer = (approved) => call(approved ? 'yes' : 'no', () => api.post(`/warranty/${t.id}/approval`, { approved }),
    approved ? 'Đã ghi khách đồng ý — thợ được sửa' : 'Đã ghi khách không sửa');

  const st = t.quote_state;
  return (
    <section aria-label="Báo giá sửa chữa" className="card p-2.5 flex flex-wrap items-center gap-2 text-[13px]">
      <span className="font-semibold">Báo giá:</span>
      {st ? <QuoteBadge state={st} /> : <span className="text-muted-ink">phiếu cũ, không qua bước báo giá</span>}
      {st === 'waiting_approval' && t.quote_total != null && (
        <span className="tabular">· đã báo <b>{money(t.quote_total)}</b></span>
      )}
      {st === 'waiting_quote' && !can('warranty.quote') && (
        <span className="text-muted-ink">— chủ / quản lý xem vật tư thợ báo rồi báo giá cho khách</span>
      )}
      <div className="flex-1" />
      {!closed && can('warranty.work') && (
        <Button size="sm" icon={Wrench} onClick={onPropose}>Báo vật tư</Button>
      )}
      {!closed && can('warranty.quote') && ['waiting_quote', 'declined', 'approved', 'free', null, undefined].includes(st) && (
        <>
          <Button size="sm" icon={Gift} loading={busy === 'quote-free'} onClick={() => quote(true)}>Miễn phí — sửa luôn</Button>
          <Button size="sm" variant="primary" icon={Send} loading={busy === 'quote'} onClick={() => quote(false)}>
            {st === 'waiting_quote' || !st ? 'Chốt báo giá' : 'Báo giá lại'}
          </Button>
        </>
      )}
      {!closed && st === 'waiting_approval' && (can('warranty.quote') || can('warranty.deliver')) && (
        <>
          <Button size="sm" icon={XCircle} loading={busy === 'no'} onClick={() => answer(false)}>Khách không sửa</Button>
          <Button size="sm" variant="primary" icon={CheckCircle2} loading={busy === 'yes'} onClick={() => answer(true)}>Khách đồng ý</Button>
        </>
      )}
      {!closed && can('warranty.work') && mayRepair(t) && t.status !== 'ready' && (
        <Button size="sm" variant="primary" icon={CheckCircle2} onClick={onDone}>Báo sửa xong</Button>
      )}
    </section>
  );
}

/**
 * Vật tư trên phiếu cho người không thấy giá: thợ thấy tên, số lượng và tiền
 * mình bỏ ra mua ngoài; thu ngân thấy thêm tổng tiền phải thu.
 */
export function PartsPlain({ t }) {
  const parts = t.parts || [];
  const custom = t.custom_parts || [];
  return (
    <section aria-labelledby="wt-plain-h" className="space-y-2">
      <h3 id="wt-plain-h" className="font-bold text-sm">Vật tư thay</h3>
      {!parts.length && !custom.length ? (
        <p className="text-[13px] text-muted-ink">Chưa báo vật tư nào.</p>
      ) : (
        <ul className="card divide-y divide-line text-[13px]">
          {parts.map((p) => (
            <li key={`p${p.id}`} className="flex justify-between gap-2 p-2">
              <span>{p.product_name} <span className="text-2xs text-muted-ink font-mono">{p.sku}</span></span>
              <span className="tabular whitespace-nowrap">{fq(p.qty)} {p.base_unit}</span>
            </li>
          ))}
          {custom.map((c) => (
            <li key={`c${c.id}`} className="flex justify-between gap-2 p-2">
              <span>{c.name} <Badge tone="mute">mua ngoài</Badge></span>
              <span className="tabular whitespace-nowrap">
                {fq(c.qty)}
                {c.outlay != null && <span className="block text-2xs text-muted-ink">bạn bỏ ra {money(c.outlay)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {t.totals?.total != null && (
        <div className="flex justify-between items-baseline card p-2.5">
          <span className="font-bold text-[13px]">Tổng khách phải trả</span>
          <span className="text-lg font-display font-bold tabular">{money(t.totals.total)}</span>
        </div>
      )}
    </section>
  );
}

/* ----------------------- Thợ báo vật tư ----------------------- */

export function ProposalModal({ t, onClose, onDone }) {
  const { toast, defaultWarehouse } = useApp();
  const [lines, setLines] = useState([]);
  const [custom, setCustom] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { data: products } = useFetch(() => api.posProducts({ warehouse_id: defaultWarehouse }), [defaultWarehouse]);
  const trackable = useMemo(() => (products || []).filter((p) => p.track_stock), [products]);

  useEffect(() => {
    /* Dòng đã trừ kho của phiếu cũ không đổi được ở đây */
    setLines((t.parts || []).filter((p) => !p.stock_applied).map((p) => ({
      key: `p${p.product_id}`, product_id: p.product_id, name: p.product_name, sku: p.sku,
      base_unit: p.base_unit, unit_name: p.base_unit, qty: p.qty,
    })));
    setCustom((t.custom_parts || []).map((c) => ({ key: `c${c.id}`, name: c.name, qty: c.qty, outlay: c.outlay || 0, note: c.note || '' })));
    setErr('');
  }, [t]);

  const add = (p, qty = 1) => setLines((prev) => {
    const key = `p${p.id}`;
    const n = Number(qty) > 0 ? Number(qty) : 1;
    return prev.some((l) => l.key === key)
      ? prev.map((l) => (l.key === key ? { ...l, qty: Number(l.qty) + n } : l))
      : [...prev, { key, product_id: p.id, name: p.name, sku: p.sku, base_unit: p.base_unit, unit_name: p.base_unit, qty: n }];
  });
  const patch = (key, x) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...x } : l)));
  const remove = (key) => setLines((prev) => prev.filter((l) => l.key !== key));
  const patchC = (key, x) => setCustom((prev) => prev.map((c) => (c.key === key ? { ...c, ...x } : c)));

  const save = async () => {
    setErr('');
    if (custom.some((c) => !String(c.name).trim())) { setErr('Linh kiện mua ngoài phải có tên.'); return; }
    setBusy(true);
    try {
      const res = await api.put(`/warranty/${t.id}/proposal`, {
        parts: lines.map((l) => ({ product_id: l.product_id, qty: Number(l.qty) || 0 })),
        custom: custom.map((c) => ({ name: c.name, qty: Number(c.qty) || 0, outlay: c.outlay, note: c.note })),
      });
      toast(res.quote_state === 'waiting_quote' && t.quote_state !== 'waiting_quote'
        ? 'Đã lưu vật tư — đổi so với báo giá nên phiếu chờ chủ báo giá lại' : 'Đã lưu vật tư', 'ok', 6000);
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal open onClose={onClose} size="lg" title="Báo vật tư thay"
        subtitle={`${t.code} · ${t.product_name} — chỉ ghi tên và số lượng, giá do chủ báo cho khách`}
        footer={<>
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" loading={busy} onClick={save}>Lưu vật tư</Button>
        </>}>
        <div className="space-y-3">
          {['waiting_approval', 'approved'].includes(t.quote_state) && (
            <p role="note" className="rounded-lg border border-warn/30 bg-amber-50 p-2.5 text-[13px] text-amber-900">
              Phiếu đã báo giá cho khách. Thêm, bớt hay đổi vật tư thì phiếu quay lại <b>chờ báo giá</b> —
              chủ báo lại, khách đồng ý rồi mới sửa tiếp.
            </p>
          )}
          <div className="flex items-center justify-between">
            <span className="label !mb-0">Linh kiện trong kho ({lines.length})</span>
            <Button size="sm" icon={Plus} onClick={() => setPickerOpen(true)}>Chọn linh kiện</Button>
          </div>
          {lines.length > 0 && (
            <ul className="card divide-y divide-line text-[13px]">
              {lines.map((l) => (
                <li key={l.key} className="flex items-center gap-2 p-2">
                  <span className="flex-1 min-w-0">{l.name} <span className="text-2xs text-muted-ink font-mono">{l.sku}</span></span>
                  <QtyInput value={l.qty} min={0} className="!w-20" onChange={(v) => patch(l.key, { qty: Number(v) || 0 })}
                    aria-label={`Số lượng ${l.name}`} />
                  <span className="text-muted-ink w-10">{l.base_unit}</span>
                  <IconButton icon={Trash2} label={`Bỏ ${l.name}`} onClick={() => remove(l.key)} />
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between">
            <span className="label !mb-0">Linh kiện mua ngoài ({custom.length})</span>
            <Button size="sm" icon={Plus}
              onClick={() => setCustom((c) => [...c, { key: `n${Date.now()}`, name: '', qty: 1, outlay: 0, note: '' }])}>
              Thêm món mua ngoài
            </Button>
          </div>
          {custom.map((c) => (
            <div key={c.key} className="grid gap-2 sm:grid-cols-[1fr_80px_150px_auto] items-end">
              <Field label="Tên linh kiện" htmlFor={`wc-n-${c.key}`}>
                <Input id={`wc-n-${c.key}`} value={c.name} onChange={(e) => patchC(c.key, { name: e.target.value })} />
              </Field>
              <Field label="Số lượng" htmlFor={`wc-q-${c.key}`}>
                <QtyInput id={`wc-q-${c.key}`} size="md" value={c.qty} min={0} onChange={(v) => patchC(c.key, { qty: Number(v) || 0 })} />
              </Field>
              <Field label="Tiền bạn bỏ ra" hint="để tiệm hoàn lại" htmlFor={`wc-o-${c.key}`}>
                <MoneyInput id={`wc-o-${c.key}`} value={c.outlay} onChange={(v) => patchC(c.key, { outlay: v })} />
              </Field>
              <IconButton icon={Trash2} label={`Bỏ ${c.name || 'món này'}`} onClick={() => setCustom((x) => x.filter((y) => y.key !== c.key))} />
            </div>
          ))}
          {err && <p role="alert" className="error-text">{err}</p>}
        </div>
      </Modal>
      <CartPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} kind="warranty_parts" wide qtyEntry
        title="Chọn linh kiện thay"
        products={trackable} lines={lines} onAdd={add} onPatch={patch} onRemove={remove}
        showPrice={false} editPrice={false} footerNote="Linh kiện trên phiếu" />
    </>
  );
}

/* ----------------------- Thợ báo sửa xong ----------------------- */

export function DoneModal({ t, onClose, onDone }) {
  const { toast } = useApp();
  const [photos, setPhotos] = useState([]);
  const [returned, setReturned] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const hasParts = (t.parts?.length || 0) + (t.custom_parts?.length || 0) > 0;
  const haveDone = (t.photos || []).some((p) => p.kind === 'done');

  const save = async () => {
    setErr('');
    if (!photos.length && !haveDone) { setErr('Chụp ít nhất một ảnh máy sau khi sửa.'); return; }
    if (hasParts && !returned) { setErr('Nộp linh kiện hỏng cho chủ rồi tích ô "Đã nộp xác cũ".'); return; }
    setBusy(true);
    try {
      await api.post(`/warranty/${t.id}/done`, { photos, old_parts_returned: returned, note });
      toast(`Đã báo sửa xong ${t.code} — chờ khách lấy`, 'ok');
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="md" title="Báo sửa xong" subtitle={`${t.code} · ${t.product_name}`}
      footer={<>
        <Button onClick={onClose}>Đóng</Button>
        <Button variant="primary" icon={CheckCircle2} loading={busy} onClick={save}>Báo sửa xong</Button>
      </>}>
      <div className="space-y-3">
        <PhotoPicker photos={photos} onChange={setPhotos} max={6}
          label={haveDone ? 'Ảnh sau khi sửa (đã có ảnh, chụp thêm nếu cần)' : 'Ảnh máy sau khi sửa (bắt buộc)'} />
        {hasParts && (
          <label className="flex items-start gap-2 rounded-lg border border-line p-2.5 text-[13px] cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={returned} onChange={(e) => setReturned(e.target.checked)} />
            <span>
              <b>Đã nộp xác cũ</b> — linh kiện hỏng tháo ra đã giao chủ / quản lý
              <span className="block text-2xs text-muted-ink">
                Vật tư đã thay: {[...(t.parts || []).map((p) => `${p.product_name} × ${fq(p.qty)}`),
                  ...(t.custom_parts || []).map((c) => `${c.name} × ${fq(c.qty)}`)].join(', ')}
              </span>
            </span>
          </label>
        )}
        <Field label="Ghi chú" htmlFor="wd-done-note">
          <Textarea id="wd-done-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Ví dụ: thay phốt, chạy thử 15 phút êm" />
        </Field>
        {err && <p role="alert" className="error-text">{err}</p>}
      </div>
    </Modal>
  );
}

