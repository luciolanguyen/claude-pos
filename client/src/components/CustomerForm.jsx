import { useState, useEffect } from 'react';
import { Plus, Trash2, Crown, Users, Store } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Modal, Button, IconButton, Input, Select, Field, MoneyInput, Textarea } from './ui';
import { PinApprovalModal } from './PosApproval';

/* Loại khách (tài liệu 08). Dùng chung cho form, danh sách và hồ sơ. */
export const CUSTOMER_TYPES = [
  { key: 'member', label: 'Thành viên', tone: 'mute', icon: Users },
  { key: 'vip', label: 'VIP', tone: 'warn', icon: Crown },
  { key: 'wholesale', label: 'Khách sỉ', tone: 'info', icon: Store },
];
export const customerTypeOf = (key) => CUSTOMER_TYPES.find((t) => t.key === key) || CUSTOMER_TYPES[0];

const EMPTY = {
  code: '', name: '', phone: '', phone2: '', phone3: '', email: '', address: '', tax_code: '',
  company_name: '', price_list_id: '', opening_debt: 0, debt_limit: 0,
  birthday: '', note: '', active: 1, customer_type: 'member', max_debt_days: '',
};

/* Ba ô số điện thoại (tài liệu 14, mục 4.1). Số 1 là số chính, bắt buộc —
   nhà thầu hay đưa thêm số của vợ và của thợ, gõ số nào cũng phải ra đúng
   hồ sơ này. Một số không được thuộc hai hồ sơ khác nhau; máy chủ soát lại. */
const PHONE_FIELDS = [
  ['phone', 'Số điện thoại chính', true, 'Số hay gọi nhất — dùng để tra khách'],
  ['phone2', 'Số điện thoại phụ 1', false, 'Ví dụ: số của vợ / chồng'],
  ['phone3', 'Số điện thoại phụ 2', false, 'Ví dụ: số của thợ đi lấy hàng'],
];

const ErrorLine = ({ children, className = '' }) => (
  <p role="alert" className={`text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5 ${className}`}>
    {children}
  </p>
);

/** Thêm / sửa khách hàng. Truyền `customer` để sửa, bỏ trống để thêm mới. */
export default function CustomerForm({ open, onClose, onSaved, customer }) {
  const { meta, settings } = useApp();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  /* Đổi hạn mức nợ / số ngày nợ mà không phải chủ, quản lý: xin PIN rồi lưu lại */
  const [needPin, setNeedPin] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(customer
      ? {
        ...EMPTY, ...customer,
        max_debt_days: customer.max_debt_days ?? '',
        phone: customer.phone || '', phone2: customer.phone2 || '', phone3: customer.phone3 || '',
      }
      : EMPTY);
    setErr('');
    setNeedPin(null);
  }, [open, customer]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const shopDays = Number(settings?.pos?.max_debt_days) || 0;

  const save = async (approvalToken) => {
    if (!form.name.trim()) { setErr('Bắt buộc nhập tên khách hàng.'); return; }
    /* Số chính là cách tra ra khách; thiếu nó thì mọi ô tìm kiếm đều mù */
    if (!String(form.phone || '').trim()) {
      setErr('Bắt buộc nhập số điện thoại chính. Đây là số dùng để tra ra khách khi bán hàng.');
      return;
    }
    const nums = [form.phone, form.phone2, form.phone3].map((x) => String(x || '').trim()).filter(Boolean);
    if (new Set(nums).size !== nums.length) {
      setErr('Ba số điện thoại của cùng một khách phải khác nhau.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const body = {
        ...form,
        price_list_id: form.price_list_id ? Number(form.price_list_id) : null,
        max_debt_days: form.max_debt_days === '' || form.max_debt_days === null ? null : Number(form.max_debt_days),
        ...(approvalToken ? { approval_token: approvalToken } : {}),
      };
      const saved = customer
        ? await api.put(`/customers/${customer.id}`, body)
        : await api.post('/customers', body);
      setNeedPin(null);
      onSaved?.(saved);
    } catch (e) {
      if (e.needsApproval && !approvalToken) setNeedPin(e.message);
      else setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={customer ? `Sửa khách hàng: ${customer.name}` : 'Thêm khách hàng mới'}
        size="md"
        footer={<>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" onClick={() => save()} loading={busy}>
            {customer ? 'Lưu thay đổi' : 'Thêm khách hàng'}
          </Button>
        </>}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tên khách hàng" required className="sm:col-span-2" htmlFor="cf-name">
            <Input id="cf-name" value={form.name} onChange={set('name')} placeholder="Ví dụ: Anh Tuấn - Thợ điện" />
          </Field>

          <Field label="Mã khách" hint={customer ? 'Không đổi được sau khi tạo' : 'Bỏ trống để hệ thống tự đặt'} htmlFor="cf-code">
            <Input id="cf-code" value={form.code || ''} onChange={set('code')} disabled={!!customer} placeholder="KH0001" />
          </Field>

          <div className="sm:col-span-1" />

          {/* Ba số điện thoại — tìm bằng số nào cũng ra hồ sơ này */}
          <fieldset className="sm:col-span-2 rounded-lg border border-line p-2.5">
            <legend className="px-1 text-[13px] font-bold">Số điện thoại</legend>
            <div className="grid gap-2.5 sm:grid-cols-3">
              {PHONE_FIELDS.map(([key, label, required, hint]) => (
                <Field key={key} label={label} required={required} hint={hint} htmlFor={`cf-${key}`}>
                  <Input
                    id={`cf-${key}`}
                    value={form[key] || ''}
                    onChange={set(key)}
                    inputMode="tel"
                    className="tabular"
                    placeholder="09xx xxx xxx"
                  />
                </Field>
              ))}
            </div>
            <p className="text-2xs text-muted-ink mt-1.5">
              Gõ bất kỳ số nào trong ba số ở ô tìm khách (cả màn hình bán hàng) đều ra hồ sơ này.
              Một số điện thoại chỉ thuộc về một khách.
            </p>
          </fieldset>

          <div className="sm:col-span-2">
            <span className="label" id="cf-type-label">Loại khách</span>
            <div role="radiogroup" aria-labelledby="cf-type-label" className="grid grid-cols-3 gap-1.5">
              {CUSTOMER_TYPES.map((t) => {
                const on = (form.customer_type || 'member') === t.key;
                const Icon = t.icon;
                return (
                  <label
                    key={t.key}
                    className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[13px] font-semibold
                                cursor-pointer transition-colors duration-150 focus-within:ring-2 focus-within:ring-accent/40
                                ${on ? 'border-accent bg-accent-soft text-emerald-900' : 'border-line hover:bg-muted'}`}
                  >
                    <input
                      type="radio"
                      name="cf-type"
                      value={t.key}
                      checked={on}
                      onChange={() => setForm((f) => ({ ...f, customer_type: t.key }))}
                      className="sr-only"
                    />
                    <Icon size={14} aria-hidden="true" />
                    {t.label}
                  </label>
                );
              })}
            </div>
          </div>

          <Field label="Địa chỉ" className="sm:col-span-2" htmlFor="cf-addr">
            <Input id="cf-addr" value={form.address || ''} onChange={set('address')} />
          </Field>

          <Field label="Bảng giá áp dụng" hint="Chọn giá sỉ hoặc giá thợ để tự áp khi bán" htmlFor="cf-pl">
            <Select id="cf-pl" value={form.price_list_id || ''} onChange={set('price_list_id')}>
              <option value="">Giá lẻ (mặc định)</option>
              {meta.priceLists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>

          <Field label="Nợ cũ đầu kỳ" hint="Số tiền khách đang nợ trước khi dùng phần mềm" htmlFor="cf-debt">
            <MoneyInput id="cf-debt" value={form.opening_debt} onChange={(v) => setForm((f) => ({ ...f, opening_debt: v }))} />
          </Field>

          <Field label="Hạn mức nợ tối đa" hint="0 = không giới hạn. Vượt hạn mức phải có PIN quản lý mới bán nợ." htmlFor="cf-limit">
            <MoneyInput id="cf-limit" value={form.debt_limit} onChange={(v) => setForm((f) => ({ ...f, debt_limit: v }))} />
          </Field>

          <Field
            label="Số ngày nợ tối đa"
            hint={`Để trống = theo tiệm (${shopDays > 0 ? `${shopDays} ngày` : 'tiệm chưa giới hạn'}). Ghi 0 = khách này không giới hạn.`}
            htmlFor="cf-days"
          >
            <Input
              id="cf-days"
              type="number"
              min="0"
              inputMode="numeric"
              value={form.max_debt_days ?? ''}
              placeholder={shopDays > 0 ? `Theo tiệm: ${shopDays}` : 'Theo tiệm'}
              onChange={(e) => setForm((f) => ({ ...f, max_debt_days: e.target.value.replace(/\D/g, '') }))}
            />
          </Field>

          <Field label="Ngày sinh / ngày thành lập" htmlFor="cf-bd">
            <Input id="cf-bd" type="date" value={form.birthday || ''} onChange={set('birthday')} />
          </Field>

          <details className="sm:col-span-2">
            <summary className="text-[13px] font-semibold text-muted-ink cursor-pointer hover:text-ink py-1">
              Thông tin xuất hoá đơn GTGT (nếu khách là công ty)
            </summary>
            <div className="grid gap-3 sm:grid-cols-2 mt-2">
              <Field label="Tên công ty" htmlFor="cf-company">
                <Input id="cf-company" value={form.company_name || ''} onChange={set('company_name')} />
              </Field>
              <Field label="Mã số thuế" htmlFor="cf-tax">
                <Input id="cf-tax" value={form.tax_code || ''} onChange={set('tax_code')} inputMode="numeric" />
              </Field>
              <Field label="Email" className="sm:col-span-2" htmlFor="cf-email">
                <Input id="cf-email" type="email" value={form.email || ''} onChange={set('email')} />
              </Field>
            </div>
          </details>

          <Field label="Ghi chú" className="sm:col-span-2" htmlFor="cf-note">
            <Textarea id="cf-note" rows={2} value={form.note || ''} onChange={set('note')} />
          </Field>

          {customer && (
            <label className="sm:col-span-2 flex items-center gap-2 text-[13px] cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 accent-emerald-700 cursor-pointer"
                checked={form.active !== 0}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked ? 1 : 0 }))}
              />
              Còn giao dịch (bỏ chọn để ẩn khỏi danh sách bán hàng)
            </label>
          )}

          {err && <ErrorLine className="sm:col-span-2">{err}</ErrorLine>}
        </div>
      </Modal>

      <PinApprovalModal
        open={!!needPin}
        reason="Đổi hạn mức nợ / số ngày nợ của khách"
        detail={needPin}
        onClose={() => setNeedPin(null)}
        onApproved={(res) => save(res.token)}
      />
    </>
  );
}

/* ==================================================================== */
/* Nhà cung cấp (tài liệu 10): nhiều số điện thoại, nhiều tài khoản       */
/* ==================================================================== */

export const PHONE_LABELS = ['SĐT Kinh doanh', 'SĐT Kế toán công nợ', 'SĐT Giao nhận kho', 'SĐT Giám đốc'];
export const BANK_NAMES = [
  'Vietcombank', 'VietinBank', 'BIDV', 'Agribank', 'Techcombank', 'MB Bank', 'ACB', 'Sacombank',
  'VPBank', 'TPBank', 'SHB', 'HDBank', 'VIB', 'OCB', 'Eximbank', 'SeABank', 'MSB', 'LPBank',
  'Nam A Bank', 'Kienlongbank',
];

const SUP_EMPTY = {
  code: '', name: '', contact_name: '', email: '', address: '',
  tax_code: '', opening_debt: 0, term_days: 0, note: '', active: 1,
  phones: [{ phone: '', label: PHONE_LABELS[0] }],
  bank_accounts: [],
};
const blankBank = () => ({ bank_name: '', account_no: '', holder: '', label: '' });

/** Thêm / sửa nhà cung cấp. */
export function SupplierForm({ open, onClose, onSaved, supplier }) {
  const [form, setForm] = useState(SUP_EMPTY);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setErr('');
    if (!supplier) { setForm(SUP_EMPTY); return; }
    const fill = (s) => setForm({
      ...SUP_EMPTY,
      ...s,
      phones: s.phones?.length ? s.phones.map((p) => ({ phone: p.phone, label: p.label || '' }))
        : (s.phone ? [{ phone: s.phone, label: '' }] : SUP_EMPTY.phones),
      bank_accounts: (s.bank_accounts || []).map((a) => ({
        bank_name: a.bank_name, account_no: a.account_no, holder: a.holder || '', label: a.label || '',
      })),
    });
    fill(supplier);
    /* Dòng ở danh sách chỉ có số lượng tài khoản — mở form thì lấy đủ hồ sơ */
    if (!Array.isArray(supplier.bank_accounts)) {
      setLoading(true);
      api.supplier(supplier.id)
        .then(fill)
        .catch((e) => setErr(e.message))
        .finally(() => setLoading(false));
    }
  }, [open, supplier]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const setRow = (list, i, patch) => setForm((f) => ({
    ...f, [list]: f[list].map((r, j) => (j === i ? { ...r, ...patch } : r)),
  }));
  const addRow = (list, row) => setForm((f) => ({ ...f, [list]: [...f[list], row] }));
  const dropRow = (list, i) => setForm((f) => ({ ...f, [list]: f[list].filter((_, j) => j !== i) }));

  const save = async () => {
    if (!form.name.trim()) { setErr('Bắt buộc nhập tên nhà cung cấp.'); return; }
    const badBank = form.bank_accounts.findIndex((a) =>
      (a.bank_name.trim() || a.account_no.trim() || a.holder.trim() || a.label.trim())
      && !(a.bank_name.trim() && a.account_no.trim()));
    if (badBank >= 0) {
      setErr(`Tài khoản thứ ${badBank + 1} cần đủ tên ngân hàng và số tài khoản.`);
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const { phone, bank_account, ...rest } = form;   // máy chủ tự điền hai cột cũ từ danh sách
      const body = {
        ...rest,
        phones: form.phones.filter((p) => p.phone.trim()),
        bank_accounts: form.bank_accounts.filter((a) => a.bank_name.trim() && a.account_no.trim()),
      };
      const saved = supplier
        ? await api.put(`/suppliers/${supplier.id}`, body)
        : await api.post('/suppliers', body);
      onSaved?.(saved);
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
      title={supplier ? `Sửa nhà cung cấp: ${supplier.name}` : 'Thêm nhà cung cấp mới'}
      size="lg"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={save} loading={busy} disabled={loading}>
          {supplier ? 'Lưu thay đổi' : 'Thêm nhà cung cấp'}
        </Button>
      </>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tên nhà cung cấp" required className="sm:col-span-2" htmlFor="sf-name">
          <Input id="sf-name" value={form.name} onChange={set('name')} placeholder="Ví dụ: Công ty CADIVI - CN Miền Tây" />
        </Field>

        <Field label="Người liên hệ" htmlFor="sf-contact">
          <Input id="sf-contact" value={form.contact_name || ''} onChange={set('contact_name')} placeholder="Anh Dũng" />
        </Field>

        <Field label="Mã NCC" hint={supplier ? 'Không đổi được' : 'Bỏ trống để tự đặt'} htmlFor="sf-code">
          <Input id="sf-code" value={form.code || ''} onChange={set('code')} disabled={!!supplier} placeholder="NCC0001" />
        </Field>

        {/* ---------- Nhiều số điện thoại ---------- */}
        <fieldset className="sm:col-span-2 rounded-lg border border-line p-2.5">
          <legend className="px-1 text-[13px] font-bold">Số điện thoại liên hệ</legend>
          <datalist id="sf-phone-labels">
            {PHONE_LABELS.map((l) => <option key={l} value={l} />)}
          </datalist>
          <div className="space-y-1.5">
            {form.phones.map((p, i) => (
              <div key={i} className="flex flex-wrap sm:flex-nowrap gap-1.5 items-center">
                <Input
                  aria-label={`Số điện thoại ${i + 1}`}
                  value={p.phone}
                  inputMode="tel"
                  placeholder="0xxx xxx xxx"
                  className="sm:!w-44 tabular"
                  onChange={(e) => setRow('phones', i, { phone: e.target.value })}
                />
                <Input
                  aria-label={`Nhãn của số điện thoại ${i + 1}`}
                  list="sf-phone-labels"
                  value={p.label}
                  placeholder="Nhãn, ví dụ SĐT Kế toán công nợ"
                  className="flex-1 min-w-[10rem]"
                  onChange={(e) => setRow('phones', i, { label: e.target.value })}
                />
                <IconButton icon={Trash2} label={`Bỏ số điện thoại ${i + 1}`} size={15}
                  className="!text-danger hover:!bg-red-50" onClick={() => dropRow('phones', i)} />
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <Button size="sm" variant="soft" icon={Plus}
                onClick={() => addRow('phones', { phone: '', label: PHONE_LABELS.find((l) => !form.phones.some((p) => p.label === l)) || '' })}>
                Thêm số điện thoại
              </Button>
              <span className="text-2xs text-muted-ink">Số đầu tiên là số chính, hiện ở phiếu nhập.</span>
            </div>
          </div>
        </fieldset>

        {/* ---------- Nhiều tài khoản ngân hàng ---------- */}
        <fieldset className="sm:col-span-2 rounded-lg border border-line p-2.5">
          <legend className="px-1 text-[13px] font-bold">Tài khoản ngân hàng</legend>
          <datalist id="sf-bank-names">
            {BANK_NAMES.map((b) => <option key={b} value={b} />)}
          </datalist>
          {form.bank_accounts.length === 0 && (
            <p className="text-[13px] text-muted-ink mb-1.5">Chưa lưu tài khoản nào. Lưu sẵn thì lúc trả nợ chỉ cần chọn.</p>
          )}
          <div className="space-y-2">
            {form.bank_accounts.map((a, i) => (
              <div key={i} className="grid gap-1.5 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] items-center rounded border border-line/70 p-1.5">
                <Input aria-label={`Ngân hàng của tài khoản ${i + 1}`} list="sf-bank-names" value={a.bank_name}
                  placeholder="Ngân hàng" onChange={(e) => setRow('bank_accounts', i, { bank_name: e.target.value })} />
                <Input aria-label={`Số tài khoản ${i + 1}`} value={a.account_no} inputMode="numeric" className="font-mono"
                  placeholder="Số tài khoản" onChange={(e) => setRow('bank_accounts', i, { account_no: e.target.value })} />
                <Input aria-label={`Chủ tài khoản ${i + 1}`} value={a.holder}
                  placeholder="Chủ tài khoản" onChange={(e) => setRow('bank_accounts', i, { holder: e.target.value.toUpperCase() })} />
                <Input aria-label={`Nhãn tài khoản ${i + 1}`} value={a.label}
                  placeholder="Nhãn: TK công ty..." onChange={(e) => setRow('bank_accounts', i, { label: e.target.value })} />
                <IconButton icon={Trash2} label={`Bỏ tài khoản ${i + 1}`} size={15}
                  className="!text-danger hover:!bg-red-50 justify-self-end" onClick={() => dropRow('bank_accounts', i)} />
              </div>
            ))}
            <Button size="sm" variant="soft" icon={Plus} onClick={() => addRow('bank_accounts', blankBank())}>
              Thêm tài khoản ngân hàng
            </Button>
          </div>
        </fieldset>

        <Field label="Hạn thanh toán (ngày)" hint="Số ngày được nợ sau khi nhập hàng" htmlFor="sf-term">
          <Input
            id="sf-term"
            type="number"
            min="0"
            value={form.term_days}
            onChange={(e) => setForm((f) => ({ ...f, term_days: Number(e.target.value) || 0 }))}
          />
        </Field>

        <Field label="Mã số thuế" htmlFor="sf-tax">
          <Input id="sf-tax" value={form.tax_code || ''} onChange={set('tax_code')} inputMode="numeric" />
        </Field>

        <Field label="Địa chỉ" className="sm:col-span-2" htmlFor="sf-addr">
          <Input id="sf-addr" value={form.address || ''} onChange={set('address')} />
        </Field>

        <Field label="Nợ cũ đầu kỳ" hint="Số tiền mình đang nợ NCC trước khi dùng phần mềm" htmlFor="sf-debt">
          <MoneyInput id="sf-debt" value={form.opening_debt} onChange={(v) => setForm((f) => ({ ...f, opening_debt: v }))} />
        </Field>

        <Field label="Email" htmlFor="sf-email">
          <Input id="sf-email" type="email" value={form.email || ''} onChange={set('email')} />
        </Field>

        <Field label="Ghi chú" className="sm:col-span-2" htmlFor="sf-note">
          <Textarea id="sf-note" rows={2} value={form.note || ''} onChange={set('note')} />
        </Field>

        {supplier && (
          <label className="sm:col-span-2 flex items-center gap-2 text-[13px] cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 accent-emerald-700 cursor-pointer"
              checked={form.active !== 0}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked ? 1 : 0 }))}
            />
            Còn hợp tác
          </label>
        )}

        {err && <ErrorLine className="sm:col-span-2">{err}</ErrorLine>}
      </div>
    </Modal>
  );
}
