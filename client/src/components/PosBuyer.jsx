/* ====================================================================
   NGƯỜI MUA HỘ (tài liệu 03)

   Chị B là khách quen, hôm nay sai anh A ra lấy hàng. Doanh số và công nợ
   vẫn tính cho chị B; hoá đơn ghi thêm anh A là người đi mua, để hôm sau
   chị B hỏi "ai lấy hàng hôm đó" thì tra ra ngay.

   Người mua hộ nằm chung danh mục khách hàng, định danh bằng số điện
   thoại. Lưu nhanh mà trùng số điện thoại thì máy chủ trả lại hồ sơ cũ,
   không đẻ thêm một hồ sơ trùng.

   Khách lẻ không có hồ sơ vẫn ghi được tên, số điện thoại người đi mua
   cho riêng đơn đó — không bắt phải tạo hồ sơ.
   ==================================================================== */
import { useState, useMemo, useEffect } from 'react';
import { Plus, X, Pencil, Search, Users } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch } from '../lib/store';
import { n, match } from '../lib/format';
import { Button, IconButton } from './ui';

/**
 * @param customer  khách chủ đang chọn (null = khách lẻ)
 * @param customers danh mục khách đã tải sẵn trên màn hình bán hàng
 * @param value     { id?, name, phone } hoặc null
 */
export default function ProxyBuyer({ customer, customers, value, onChange, onCreated }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  /* Người từng mua hộ cho khách chủ này — hay đi nhất lên đầu */
  const { data: suggest, busy } = useFetch(
    () => api.customerBuyers(customer.id), [customer?.id], { skip: !open || !customer });

  useEffect(() => {
    if (!open) { setQ(''); setName(''); setPhone(''); }
  }, [open]);

  /* Gõ vào ô tìm: là số thì điền sẵn ô SĐT, là chữ thì điền sẵn ô tên — để
     không có trong danh mục thì bấm Lưu nhanh luôn, khỏi gõ lại lần nữa */
  const onSearch = (v) => {
    setQ(v);
    const t = v.trim();
    if (/^[\d\s.+-]+$/.test(t)) setPhone(t.replace(/[^\d+]/g, ''));
    else setName(t);
  };

  const matches = useMemo(() => {
    const t = q.trim();
    if (!t) return [];
    const digits = t.replace(/\D/g, '');
    return (customers || [])
      .filter((c) => c.id !== customer?.id)
      .filter((c) => match(c.name, t)
        || (digits.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(digits)))
      .slice(0, 6);
  }, [q, customers, customer?.id]);

  const choose = (b) => {
    if (b.id && b.id === customer?.id) {
      toast('Khách tự mua cho mình thì không cần ghi người mua hộ.', 'warn');
      return;
    }
    onChange({ id: b.id || null, name: b.name || '', phone: b.phone || '' });
    setOpen(false);
  };

  const quickSave = async () => {
    const nm = name.trim();
    const ph = phone.trim();
    if (!nm && !ph) { toast('Nhập tên hoặc số điện thoại người mua hộ.', 'warn'); return; }
    if (!nm) {
      toast('Nhập thêm tên để lưu hồ sơ — hoặc bấm "Chỉ ghi cho đơn này".', 'warn', 5000);
      return;
    }
    setSaving(true);
    try {
      const c = await api.post('/customers', {
        name: nm,
        phone: ph || null,
        dedupe_phone: true,
        note: customer ? `Người mua hộ cho ${customer.name}` : 'Tạo nhanh khi ghi người mua hộ',
      });
      if (c.existing) toast(`Số ${ph} đã có hồ sơ "${c.name}" — dùng lại hồ sơ đó.`, 'info', 5000);
      else toast(`Đã lưu hồ sơ ${c.name}`, 'ok');
      onCreated?.();
      choose(c);
    } catch (e) {
      toast(e.message, 'bad', 6000);
    } finally {
      setSaving(false);
    }
  };

  const onlyThisOrder = () => {
    const nm = name.trim();
    const ph = phone.trim();
    if (!nm && !ph) { toast('Nhập tên hoặc số điện thoại người mua hộ.', 'warn'); return; }
    choose({ id: null, name: nm, phone: ph });
  };

  /* ------------------------------ Đang đóng ------------------------------ */
  if (!open) {
    if (value) {
      return (
        <div className="mt-1.5 flex items-center gap-1.5 rounded border border-violet-200 bg-violet-50 px-2 py-0.5 text-[13px]">
          <Users size={13} className="text-violet-700 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-violet-950">
            Người mua hộ: <b>{value.name || 'Không tên'}</b>{value.phone ? ` · ${value.phone}` : ''}
          </span>
          {!value.id && <span className="text-2xs text-violet-700 shrink-0">chỉ ghi đơn này</span>}
          <IconButton icon={Pencil} size={13} label="Đổi người mua hộ" onClick={() => setOpen(true)} />
          <IconButton icon={X} size={13} label="Bỏ người mua hộ" onClick={() => onChange(null)} />
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 inline-flex items-center gap-1 text-[13px] font-semibold text-violet-700
                   hover:text-violet-900 hover:underline cursor-pointer min-h-[28px] rounded
                   focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500"
      >
        <Plus size={14} aria-hidden="true" /> Người mua hộ
      </button>
    );
  }

  /* ------------------------------- Đang mở ------------------------------- */
  return (
    <div className="mt-1.5 rounded-lg border border-violet-200 bg-violet-50/60 p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-violet-950 truncate">
          Người mua hộ{customer ? ` cho ${customer.name}` : ''}
        </span>
        <IconButton icon={X} size={14} label="Đóng ô người mua hộ" onClick={() => setOpen(false)} />
      </div>

      {customer && (busy
        ? <div className="text-2xs text-muted-ink">Đang tìm người từng mua hộ...</div>
        : suggest?.length > 0 && (
          <div>
            <div className="text-2xs font-semibold text-muted-ink mb-1">Từng mua hộ — bấm để chọn</div>
            <div className="flex flex-wrap gap-1.5">
              {suggest.map((s, i) => (
                <button
                  key={s.buyer_id || `x${i}`}
                  type="button"
                  onClick={() => choose({ id: s.buyer_id, name: s.name, phone: s.phone })}
                  className="rounded border border-line bg-card px-2 py-1 text-left hover:border-violet-400
                             hover:bg-violet-50 transition-colors duration-100 cursor-pointer"
                >
                  <span className="block text-[13px] font-semibold leading-tight">{s.name || s.phone}</span>
                  <span className="block text-2xs text-muted-ink">
                    {[s.phone, `${n(s.times)} lần`].filter(Boolean).join(' · ')}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}

      <div className="relative">
        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-ink" aria-hidden="true" />
        <input
          className="field field-sm pl-7"
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Gõ tên hoặc số điện thoại để tìm..."
          aria-label="Tìm người mua hộ trong danh mục khách hàng"
          autoFocus
        />
      </div>

      {matches.length > 0 && (
        <ul className="rounded border border-line bg-card divide-y divide-line max-h-40 overflow-y-auto">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => choose(c)}
                className="w-full text-left px-2 py-1.5 hover:bg-accent-soft/40 cursor-pointer"
              >
                <div className="text-[13px] font-semibold truncate">{c.name}</div>
                <div className="text-2xs text-muted-ink">
                  {c.phone || 'Chưa có số điện thoại'}{c.code ? ` · ${c.code}` : ''}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {q.trim() && (
        <div className="space-y-1.5">
          {matches.length === 0 && (
            <div className="text-2xs text-muted-ink">Không có trong danh mục. Điền tên, số điện thoại rồi lưu nhanh:</div>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            <input
              className="field field-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tên người mua hộ"
              aria-label="Tên người mua hộ"
            />
            <input
              className="field field-sm"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Số điện thoại"
              inputMode="tel"
              aria-label="Số điện thoại người mua hộ"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="primary" icon={Plus} loading={saving} onClick={quickSave}>
              Lưu nhanh
            </Button>
            <Button size="sm" onClick={onlyThisOrder}>Chỉ ghi cho đơn này</Button>
          </div>
        </div>
      )}
    </div>
  );
}
