import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { Modal, Button, Input, Select, Field, MoneyInput, Textarea } from './ui';

const EMPTY = {
  code: '', name: '', phone: '', email: '', address: '', tax_code: '',
  company_name: '', price_list_id: '', opening_debt: 0, debt_limit: 0,
  birthday: '', note: '', active: 1,
};

/** Thêm / sửa khách hàng. Truyền `customer` để sửa, bỏ trống để thêm mới. */
export default function CustomerForm({ open, onClose, onSaved, customer }) {
  const { meta } = useApp();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(customer ? { ...EMPTY, ...customer } : EMPTY);
    setErr('');
  }, [open, customer]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const save = async () => {
    if (!form.name.trim()) { setErr('Bắt buộc nhập tên khách hàng.'); return; }
    setBusy(true);
    setErr('');
    try {
      const body = {
        ...form,
        price_list_id: form.price_list_id ? Number(form.price_list_id) : null,
      };
      const saved = customer
        ? await api.put(`/customers/${customer.id}`, body)
        : await api.post('/customers', body);
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
      title={customer ? `Sửa khách hàng: ${customer.name}` : 'Thêm khách hàng mới'}
      size="md"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={save} loading={busy}>
          {customer ? 'Lưu thay đổi' : 'Thêm khách hàng'}
        </Button>
      </>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tên khách hàng" required className="sm:col-span-2" htmlFor="cf-name">
          <Input id="cf-name" value={form.name} onChange={set('name')} placeholder="Ví dụ: Anh Tuấn - Thợ điện" />
        </Field>

        <Field label="Số điện thoại" htmlFor="cf-phone">
          <Input id="cf-phone" value={form.phone || ''} onChange={set('phone')} inputMode="tel" placeholder="09xx xxx xxx" />
        </Field>

        <Field label="Mã khách" hint={customer ? 'Không đổi được sau khi tạo' : 'Bỏ trống để hệ thống tự đặt'} htmlFor="cf-code">
          <Input id="cf-code" value={form.code || ''} onChange={set('code')} disabled={!!customer} placeholder="KH0001" />
        </Field>

        <Field label="Địa chỉ" className="sm:col-span-2" htmlFor="cf-addr">
          <Input id="cf-addr" value={form.address || ''} onChange={set('address')} />
        </Field>

        <Field
          label="Bảng giá áp dụng"
          hint="Chọn giá sỉ hoặc giá thợ để tự áp khi bán"
          htmlFor="cf-pl"
        >
          <Select id="cf-pl" value={form.price_list_id || ''} onChange={set('price_list_id')}>
            <option value="">Giá lẻ (mặc định)</option>
            {meta.priceLists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>

        <Field
          label="Hạn mức công nợ"
          hint="0 = không giới hạn. Vượt hạn mức sẽ chặn bán nợ."
          htmlFor="cf-limit"
        >
          <MoneyInput id="cf-limit" value={form.debt_limit} onChange={(v) => setForm((f) => ({ ...f, debt_limit: v }))} />
        </Field>

        <Field
          label="Nợ cũ đầu kỳ"
          hint="Số tiền khách đang nợ trước khi dùng phần mềm"
          htmlFor="cf-debt"
        >
          <MoneyInput id="cf-debt" value={form.opening_debt} onChange={(v) => setForm((f) => ({ ...f, opening_debt: v }))} />
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

        {err && (
          <p className="sm:col-span-2 text-[13px] text-danger font-semibold bg-red-50
                        border border-danger/25 rounded p-2.5">{err}</p>
        )}
      </div>
    </Modal>
  );
}

/* ==================================================================== */

const SUP_EMPTY = {
  code: '', name: '', contact_name: '', phone: '', email: '', address: '',
  tax_code: '', bank_account: '', opening_debt: 0, term_days: 0, note: '', active: 1,
};

/** Thêm / sửa nhà cung cấp. */
export function SupplierForm({ open, onClose, onSaved, supplier }) {
  const [form, setForm] = useState(SUP_EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(supplier ? { ...SUP_EMPTY, ...supplier } : SUP_EMPTY);
    setErr('');
  }, [open, supplier]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const save = async () => {
    if (!form.name.trim()) { setErr('Bắt buộc nhập tên nhà cung cấp.'); return; }
    setBusy(true);
    setErr('');
    try {
      const saved = supplier
        ? await api.put(`/suppliers/${supplier.id}`, form)
        : await api.post('/suppliers', form);
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
      size="md"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={save} loading={busy}>
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

        <Field label="Số điện thoại" htmlFor="sf-phone">
          <Input id="sf-phone" value={form.phone || ''} onChange={set('phone')} inputMode="tel" />
        </Field>

        <Field label="Mã NCC" hint={supplier ? 'Không đổi được' : 'Bỏ trống để tự đặt'} htmlFor="sf-code">
          <Input id="sf-code" value={form.code || ''} onChange={set('code')} disabled={!!supplier} placeholder="NCC0001" />
        </Field>

        <Field
          label="Hạn thanh toán (ngày)"
          hint="Số ngày được nợ sau khi nhập hàng"
          htmlFor="sf-term"
        >
          <Input
            id="sf-term"
            type="number"
            min="0"
            value={form.term_days}
            onChange={(e) => setForm((f) => ({ ...f, term_days: Number(e.target.value) || 0 }))}
          />
        </Field>

        <Field label="Địa chỉ" className="sm:col-span-2" htmlFor="sf-addr">
          <Input id="sf-addr" value={form.address || ''} onChange={set('address')} />
        </Field>

        <Field label="Mã số thuế" htmlFor="sf-tax">
          <Input id="sf-tax" value={form.tax_code || ''} onChange={set('tax_code')} inputMode="numeric" />
        </Field>

        <Field label="Số tài khoản ngân hàng" htmlFor="sf-bank">
          <Input id="sf-bank" value={form.bank_account || ''} onChange={set('bank_account')} />
        </Field>

        <Field
          label="Nợ cũ đầu kỳ"
          hint="Số tiền mình đang nợ NCC trước khi dùng phần mềm"
          className="sm:col-span-2"
          htmlFor="sf-debt"
        >
          <MoneyInput id="sf-debt" value={form.opening_debt} onChange={(v) => setForm((f) => ({ ...f, opening_debt: v }))} />
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

        {err && (
          <p className="sm:col-span-2 text-[13px] text-danger font-semibold bg-red-50
                        border border-danger/25 rounded p-2.5">{err}</p>
        )}
      </div>
    </Modal>
  );
}
