import { useState, useEffect, useRef } from 'react';
import {
  Store, Printer, Users as UsersIcon, Warehouse, Tag, Database, Save,
  Download, Upload, Plus, Pencil, Trash2, AlertTriangle, Check, Info, Truck,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch } from '../lib/store';
import { money, n, date, datetime, ROLE_LABEL } from '../lib/format';
import {
  Button, IconButton, Input, Select, Textarea, Field, Modal, Spinner, Empty,
  Badge, Confirm, Tabs, MoneyInput,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';

const TABS = [
  { key: 'store', label: 'Thông tin cửa hàng' },
  { key: 'invoice', label: 'Hoá đơn & in ấn' },
  { key: 'pos', label: 'Màn hình bán hàng' },
  { key: 'prices', label: 'Bảng giá' },
  { key: 'warehouses', label: 'Kho hàng' },
  { key: 'carriers', label: 'Vận chuyển' },
  { key: 'warranty', label: 'Bảo hành' },
  { key: 'users', label: 'Người dùng' },
  { key: 'data', label: 'Dữ liệu & sao lưu' },
];

export default function Settings() {
  const [tab, setTab] = useState('store');

  return (
    <>
      <PageHeader
        title="Thiết lập"
        subtitle="Tuỳ chỉnh phần mềm theo cửa hàng của bạn"
      />
      <div className="bg-card border-b border-line px-4">
        <Tabs tabs={TABS} value={tab} onChange={setTab} className="!border-b-0" />
      </div>
      <Page>
        {tab === 'store' && <StoreSettings />}
        {tab === 'invoice' && <InvoiceSettings />}
        {tab === 'pos' && <PosSettings />}
        {tab === 'prices' && <PriceLists />}
        {tab === 'warehouses' && <Warehouses />}
        {tab === 'carriers' && <Carriers />}
        {tab === 'warranty' && <WarrantySettings />}
        {tab === 'users' && <UsersTab />}
        {tab === 'data' && <DataTab />}
      </Page>
    </>
  );
}

/* ==================================================================== */

function StoreSettings() {
  const { settings, saveSettings, toast } = useApp();
  const [form, setForm] = useState(settings?.store || {});
  const [busy, setBusy] = useState(false);

  useEffect(() => { setForm(settings?.store || {}); }, [settings]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    try {
      await saveSettings({ store: form });
      toast('Đã lưu thông tin cửa hàng', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="card-pad bg-accent-soft/40 border-accent/25 text-[13px] flex gap-2.5">
        <Info size={16} className="text-emerald-800 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-emerald-950">
          Đây là nơi biến phần mềm thành cửa hàng của bạn. Tên và thông tin ở đây sẽ hiện
          trên thanh menu, trên mọi mẫu hoá đơn in ra và trên mã QR chuyển khoản.
        </p>
      </div>

      <div className="card p-4 grid gap-3 sm:grid-cols-2">
        <Field label="Tên cửa hàng" required className="sm:col-span-2" htmlFor="st-name">
          <Input id="st-name" value={form.name || ''} onChange={set('name')} placeholder="TIỆM ĐIỆN THẠNH HOÀ" />
        </Field>
        <Field label="Khẩu hiệu / ngành hàng" className="sm:col-span-2" htmlFor="st-slogan">
          <Input id="st-slogan" value={form.slogan || ''} onChange={set('slogan')}
            placeholder="Chuyên thiết bị điện - nước - dân dụng" />
        </Field>
        <Field label="Chủ cửa hàng" htmlFor="st-owner">
          <Input id="st-owner" value={form.owner || ''} onChange={set('owner')} />
        </Field>
        <Field label="Số điện thoại" htmlFor="st-phone">
          <Input id="st-phone" value={form.phone || ''} onChange={set('phone')} inputMode="tel" />
        </Field>
        <Field label="Địa chỉ" className="sm:col-span-2" htmlFor="st-addr">
          <Input id="st-addr" value={form.address || ''} onChange={set('address')} />
        </Field>
        <Field label="Mã số thuế / mã hộ kinh doanh" htmlFor="st-tax">
          <Input id="st-tax" value={form.tax_code || ''} onChange={set('tax_code')} inputMode="numeric" />
        </Field>
      </div>

      <div className="card p-4">
        <h2 className="font-bold text-sm mb-1">Tài khoản nhận chuyển khoản</h2>
        <p className="text-2xs text-muted-ink mb-3">
          Điền đủ 3 ô dưới đây thì hoá đơn in ra sẽ tự có mã QR để khách quét chuyển tiền.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Ngân hàng" htmlFor="st-bank">
            <Input id="st-bank" value={form.bank_name || ''} onChange={set('bank_name')}
              placeholder="MB Bank - CN Tiền Giang" />
          </Field>
          <Field label="Số tài khoản" htmlFor="st-acc">
            <Input id="st-acc" value={form.bank_account || ''} onChange={set('bank_account')} inputMode="numeric" />
          </Field>
          <Field label="Tên chủ tài khoản" hint="Viết in hoa không dấu" htmlFor="st-owner-bank">
            <Input id="st-owner-bank" value={form.bank_owner || ''} onChange={set('bank_owner')}
              placeholder="NGUYEN VAN THANH" />
          </Field>
        </div>
      </div>

      <div className="card p-4 grid gap-3">
        <Field label="Lời cảm ơn cuối hoá đơn" htmlFor="st-footer">
          <Textarea id="st-footer" rows={2} value={form.footer_note || ''} onChange={set('footer_note')}
            placeholder="Cảm ơn Quý khách! Hàng mua rồi vui lòng kiểm tra kỹ trước khi ra khỏi cửa hàng." />
        </Field>
        <Field label="Điều khoản bảo hành" htmlFor="st-warranty">
          <Input id="st-warranty" value={form.warranty_note || ''} onChange={set('warranty_note')}
            placeholder="Bảo hành theo quy định của nhà sản xuất." />
        </Field>
      </div>

      <Button variant="primary" icon={Save} onClick={save} loading={busy}>Lưu thông tin cửa hàng</Button>
    </div>
  );
}

/* ==================================================================== */

function InvoiceSettings() {
  const { settings, saveSettings, toast } = useApp();
  const [form, setForm] = useState(settings?.invoice || {});
  const [vatEnabled, setVatEnabled] = useState(settings?.vat_enabled !== false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(settings?.invoice || {});
    setVatEnabled(settings?.vat_enabled !== false);
  }, [settings]);

  const save = async () => {
    setBusy(true);
    try {
      await saveSettings({ invoice: form, vat_enabled: vatEnabled });
      toast('Đã lưu thiết lập hoá đơn', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const Check2 = ({ k, label, hint }) => (
    <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
      <input
        type="checkbox"
        className="w-4 h-4 accent-emerald-700 cursor-pointer mt-0.5"
        checked={!!form[k]}
        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.checked }))}
      />
      <span className="text-[13px]">
        {label}
        {hint && <span className="block text-2xs text-muted-ink">{hint}</span>}
      </span>
    </label>
  );

  return (
    <div className="max-w-3xl space-y-4">
      <div className="card p-4">
        <h2 className="font-bold text-sm mb-3">Khổ giấy mặc định</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ['k80', 'K80 — máy in nhiệt', 'Phiếu tính tiền tại quầy, khổ 80mm'],
            ['a5', 'A5', 'Phiếu giao hàng, nửa tờ A4'],
            ['a4', 'A4', 'Hoá đơn đầy đủ, hoá đơn GTGT'],
          ].map(([k, label, hint]) => (
            <button
              key={k}
              onClick={() => setForm((f) => ({ ...f, default_format: k }))}
              className={`card p-3 text-left transition-colors duration-150 cursor-pointer
                          ${form.default_format === k
                            ? 'border-accent bg-accent-soft/50 ring-1 ring-accent'
                            : 'hover:border-accent hover:bg-muted/50'}`}
            >
              <div className="flex items-center gap-1.5">
                {form.default_format === k && <Check size={14} className="text-accent shrink-0" aria-hidden="true" />}
                <span className="font-semibold text-[13px]">{label}</span>
              </div>
              <p className="text-2xs text-muted-ink mt-0.5">{hint}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="card p-4">
        <h2 className="font-bold text-sm mb-1">Căn khổ giấy máy in nhiệt</h2>
        <p className="text-2xs text-muted-ink mb-3">
          In thử một hoá đơn. Nếu chữ bị cắt mép phải thì giảm số này xuống,
          nếu lề trắng hai bên quá rộng thì tăng lên.
        </p>
        <div className="grid gap-2 sm:grid-cols-4">
          {[[48, 'Giấy 58mm'], [70, 'Giấy 80mm — lề rộng'], [72, 'Giấy 80mm — thường'], [76, 'Giấy 80mm — sát mép']].map(([w, hint]) => (
            <button
              key={w}
              onClick={() => setForm((f2) => ({ ...f2, k80_width: w }))}
              className={`card p-2.5 text-left transition-colors duration-150 cursor-pointer
                          ${Number(form.k80_width || 72) === w
                            ? 'border-accent bg-accent-soft/50 ring-1 ring-accent'
                            : 'hover:border-accent hover:bg-muted/50'}`}
            >
              <div className="font-semibold text-[13px] tabular">{w} mm</div>
              <div className="text-2xs text-muted-ink">{hint}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="card p-4">
        <h2 className="font-bold text-sm mb-2">Nội dung in trên hoá đơn</h2>
        <Check2 k="show_qr_bank" label="In mã QR chuyển khoản"
          hint="Cần điền đủ thông tin ngân hàng ở tab Thông tin cửa hàng" />
        <Check2 k="show_barcode" label="In mã vạch hoá đơn" />
        <Check2 k="show_cost" label="Hiện giá vốn và lãi trên bản in"
          hint="Chỉ bật khi in bản lưu nội bộ, đừng đưa cho khách" />
        <Check2 k="auto_print" label="Tự mở hộp thoại in ngay sau khi thanh toán" />
      </div>

      <div className="card p-4">
        <h2 className="font-bold text-sm mb-2">Thuế giá trị gia tăng</h2>
        <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 accent-emerald-700 cursor-pointer mt-0.5"
            checked={vatEnabled}
            onChange={(e) => setVatEnabled(e.target.checked)}
          />
          <span className="text-[13px]">
            Cho phép xuất hoá đơn GTGT
            <span className="block text-2xs text-muted-ink">
              Bật thì màn hình bán hàng có ô tích &quot;Xuất hoá đơn GTGT&quot;. Hộ khoán thường không cần.
            </span>
          </span>
        </label>
        <Field label="Tiền tố mã hoá đơn" className="max-w-xs mt-2" htmlFor="inv-prefix">
          <Input
            id="inv-prefix"
            value={form.prefix || 'HD'}
            onChange={(e) => setForm((f) => ({ ...f, prefix: e.target.value.toUpperCase() }))}
            maxLength={5}
          />
        </Field>
      </div>

      <Button variant="primary" icon={Save} onClick={save} loading={busy}>Lưu thiết lập hoá đơn</Button>
    </div>
  );
}

/* ==================================================================== */

function PosSettings() {
  const { settings, saveSettings, meta, toast } = useApp();
  const [form, setForm] = useState(settings?.pos || {});
  const [allowNeg, setAllowNeg] = useState(settings?.allow_negative_stock === true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(settings?.pos || {});
    setAllowNeg(settings?.allow_negative_stock === true);
  }, [settings]);

  const save = async () => {
    setBusy(true);
    try {
      await saveSettings({ pos: form, allow_negative_stock: allowNeg });
      toast('Đã lưu thiết lập bán hàng', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="card p-4 grid gap-3 sm:grid-cols-2">
        <Field label="Bảng giá mặc định khi bán" hint="Áp dụng cho khách lẻ chưa gắn bảng giá riêng" htmlFor="pos-pl">
          <Select id="pos-pl" value={form.default_price_list || ''}
            onChange={(e) => setForm((f) => ({ ...f, default_price_list: Number(e.target.value) }))}>
            {meta.priceLists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Kho xuất hàng mặc định" htmlFor="pos-wh">
          <Select id="pos-wh" value={form.default_warehouse || ''}
            onChange={(e) => setForm((f) => ({ ...f, default_warehouse: Number(e.target.value) }))}>
            {meta.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
      </div>

      <div className="card p-4">
        <h2 className="font-bold text-sm mb-2">Cách xử lý khi hết hàng</h2>
        <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 accent-emerald-700 cursor-pointer mt-0.5"
            checked={allowNeg}
            onChange={(e) => setAllowNeg(e.target.checked)}
          />
          <span className="text-[13px]">
            Cho phép bán khi tồn kho không đủ (tồn âm)
            <span className="block text-2xs text-muted-ink">
              Bật khi hay bán hàng chưa kịp nhập phiếu. Tắt thì hệ thống chặn bán quá tồn — an toàn hơn.
            </span>
          </span>
        </label>
        {allowNeg && (
          <div className="mt-2 p-2.5 bg-amber-50 border border-warn/30 rounded text-[13px] flex gap-2">
            <AlertTriangle size={15} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
            <span className="text-amber-900">
              Đang cho phép tồn âm. Số liệu tồn kho có thể bị lệch nếu quên nhập phiếu mua hàng.
            </span>
          </div>
        )}
      </div>

      <div className="card p-4">
        <h2 className="font-bold text-sm mb-2">Đăng nhập</h2>
        <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 accent-emerald-700 cursor-pointer mt-0.5"
            checked={!!form.skip_login}
            onChange={(e) => setForm((f2) => ({ ...f2, skip_login: e.target.checked }))}
          />
          <span className="text-[13px]">
            Bỏ qua màn hình đăng nhập
            <span className="block text-2xs text-muted-ink">
              Hợp với tiệm chỉ 1-2 người bán. Mở phần mềm là vào thẳng, tự dùng tài khoản Chủ cửa hàng.
              Mọi hoá đơn sẽ ghi tên người đó.
            </span>
          </span>
        </label>
      </div>

      <div className="card p-4">
        <h2 className="font-bold text-sm mb-1">Phím tắt màn hình bán hàng</h2>
        <p className="text-2xs text-muted-ink mb-3">Cố định sẵn, không cần thiết lập.</p>
        <div className="grid gap-2 sm:grid-cols-2 text-[13px]">
          {[
            ['F2', 'Nhảy tới ô tìm hàng / quét mã vạch'],
            ['F4', 'Mở hộp thanh toán'],
            ['F8', 'Thêm khách hàng mới'],
            ['Enter', 'Thêm hàng vừa quét vào giỏ · hoàn tất thanh toán'],
            ['Esc', 'Xoá ô tìm kiếm · đóng hộp thoại'],
          ].map(([k, d]) => (
            <div key={k} className="flex items-center gap-2">
              <span className="kbd w-14 justify-center">{k}</span>
              <span className="text-muted-ink">{d}</span>
            </div>
          ))}
        </div>
      </div>

      <Button variant="primary" icon={Save} onClick={save} loading={busy}>Lưu thiết lập bán hàng</Button>
    </div>
  );
}

/* ==================================================================== */

function PriceLists() {
  const { toast, loadMeta } = useApp();
  const { data, busy, reload } = useFetch(() => api.priceLists(), []);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const refresh = () => { reload(); loadMeta(); };

  const doDelete = async () => {
    try {
      await api.del(`/price-lists/${deleting.id}`);
      toast('Đã xoá bảng giá', 'ok');
      setDeleting(null);
      refresh();
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  return (
    <div className="max-w-3xl space-y-3">
      <div className="card-pad bg-accent-soft/40 border-accent/25 text-[13px] flex gap-2.5">
        <Info size={16} className="text-emerald-800 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-emerald-950">
          Mỗi bảng giá là một mức giá bán cho từng nhóm khách. Gán bảng giá cho khách hàng ở
          màn hình Khách hàng, khi bán hệ thống sẽ tự áp đúng giá.
        </p>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Thêm bảng giá</Button>
      </div>

      {busy ? <Spinner />
        : !data?.length ? <Empty icon={Tag} title="Chưa có bảng giá nào" />
          : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Mã</th><th>Tên bảng giá</th><th>Mặc định</th><th className="text-right">Thao tác</th></tr>
                </thead>
                <tbody>
                  {data.map((p) => (
                    <tr key={p.id} className="hoverable">
                      <td className="font-mono text-muted-ink">{p.code}</td>
                      <td className="font-semibold">{p.name}</td>
                      <td>{p.is_default ? <Badge tone="ok">Mặc định</Badge> : <span className="text-muted-ink">—</span>}</td>
                      <td>
                        <div className="flex items-center justify-end gap-0.5">
                          <IconButton icon={Pencil} label={`Sửa ${p.name}`} size={14} onClick={() => setEditing(p)} />
                          {!p.is_default && (
                            <IconButton icon={Trash2} label={`Xoá ${p.name}`} size={14}
                              className="!text-danger hover:!bg-red-50" onClick={() => setDeleting(p)} />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

      <SimpleForm
        open={!!editing}
        item={editing === 'new' ? null : editing}
        title="bảng giá"
        fields={[
          { key: 'code', label: 'Mã bảng giá', placeholder: 'SI', required: true, disabledOnEdit: true },
          { key: 'name', label: 'Tên bảng giá', placeholder: 'Giá sỉ', required: true },
        ]}
        extra={(form, setForm) => (
          <label className="flex items-center gap-2 text-[13px] cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-emerald-700 cursor-pointer"
              checked={!!form.is_default}
              onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked ? 1 : 0 }))} />
            Đặt làm bảng giá mặc định
          </label>
        )}
        onClose={() => setEditing(null)}
        onSave={async (form) => {
          if (editing === 'new') await api.post('/price-lists', form);
          else await api.put(`/price-lists/${editing.id}`, form);
          setEditing(null);
          refresh();
          toast('Đã lưu bảng giá', 'ok');
        }}
      />

      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={doDelete}
        title="Xoá bảng giá?"
        confirmText="Xoá bảng giá"
        message={deleting && <>Xoá bảng giá <b>{deleting.name}</b>? Giá bán đã đặt theo bảng này sẽ mất.</>}
      />
    </div>
  );
}

/* ==================================================================== */

function Warehouses() {
  const { toast, loadMeta } = useApp();
  const { data, busy, reload } = useFetch(() => api.warehouses(), []);
  const [editing, setEditing] = useState(null);
  const refresh = () => { reload(); loadMeta(); };

  return (
    <div className="max-w-3xl space-y-3">
      <div className="flex justify-end">
        <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Thêm kho</Button>
      </div>

      {busy ? <Spinner />
        : !data?.length ? <Empty icon={Warehouse} title="Chưa có kho nào" />
          : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Mã kho</th><th>Tên kho</th><th>Địa chỉ</th><th>Mặc định</th><th className="text-right">Sửa</th></tr>
                </thead>
                <tbody>
                  {data.map((w) => (
                    <tr key={w.id} className="hoverable">
                      <td className="font-mono text-muted-ink">{w.code}</td>
                      <td className="font-semibold">{w.name}</td>
                      <td className="text-muted-ink">{w.address || '—'}</td>
                      <td>{w.is_default ? <Badge tone="ok">Mặc định</Badge> : <span className="text-muted-ink">—</span>}</td>
                      <td className="text-right">
                        <IconButton icon={Pencil} label={`Sửa ${w.name}`} size={14} onClick={() => setEditing(w)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

      <SimpleForm
        open={!!editing}
        item={editing === 'new' ? null : editing}
        title="kho hàng"
        fields={[
          { key: 'code', label: 'Mã kho', placeholder: 'KP', required: true, disabledOnEdit: true },
          { key: 'name', label: 'Tên kho', placeholder: 'Kho phụ (nhà sau)', required: true },
          { key: 'address', label: 'Địa chỉ' },
        ]}
        extra={(form, setForm) => (
          <label className="flex items-center gap-2 text-[13px] cursor-pointer">
            <input type="checkbox" className="w-4 h-4 accent-emerald-700 cursor-pointer"
              checked={!!form.is_default}
              onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked ? 1 : 0 }))} />
            Đặt làm kho mặc định
          </label>
        )}
        onClose={() => setEditing(null)}
        onSave={async (form) => {
          if (editing === 'new') await api.post('/warehouses', form);
          else await api.put(`/warehouses/${editing.id}`, form);
          setEditing(null);
          refresh();
          toast('Đã lưu kho hàng', 'ok');
        }}
      />
    </div>
  );
}

/* ==================================================================== */

function WarrantySettings() {
  const { settings, saveSettings, toast } = useApp();
  const [form, setForm] = useState({ keep_days: 30, photo_keep_days: 60 });
  const [busy, setBusy] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const { data: usage, reload: reloadUsage } = useFetch(() => api.photoUsage(), []);

  useEffect(() => {
    setForm({
      keep_days: Number(settings?.warranty?.keep_days) || 30,
      photo_keep_days: Number(settings?.warranty?.photo_keep_days) ?? 60,
    });
  }, [settings]);

  const save = async () => {
    setBusy(true);
    try {
      await saveSettings({ warranty: form });
      toast('Đã lưu thiết lập bảo hành', 'ok');
      reloadUsage();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const cleanNow = async () => {
    setCleaning(true);
    try {
      const res = await api.post('/warranty/cleanup-photos');
      toast(res.message, 'ok', 6000);
      reloadUsage();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="card p-4">
        <h2 className="font-bold text-sm mb-1">Giữ hàng khách gửi bảo hành</h2>
        <p className="text-2xs text-muted-ink mb-3">
          Số ngày này in lên biên nhận khách giữ, ở dòng &quot;quá ... ngày không tới nhận,
          cửa hàng không giữ hàng nữa&quot;.
        </p>
        <Field label="Số ngày giữ hàng" className="max-w-xs" htmlFor="wa-keep">
          <div className="flex items-center gap-2">
            <Input
              id="wa-keep"
              type="number"
              min="1"
              value={form.keep_days}
              onChange={(e) => setForm((x) => ({ ...x, keep_days: Number(e.target.value) || 0 }))}
            />
            <span className="text-[13px] text-muted-ink whitespace-nowrap">ngày</span>
          </div>
        </Field>
      </div>

      <div className="card p-4">
        <h2 className="font-bold text-sm mb-1">Tự dọn ảnh cũ</h2>
        <p className="text-[13px] text-muted-ink mb-3 leading-relaxed">
          Ảnh chụp hiện trạng máy chiếm nhiều ổ cứng nhất. Phần mềm tự xoá ảnh của phiếu
          đã nhận quá số ngày dưới đây, tính từ <b>ngày nhận máy</b>.
        </p>

        <Field
          label="Giữ ảnh kể từ ngày nhận máy"
          hint="Đặt 0 nếu muốn giữ ảnh vĩnh viễn"
          className="max-w-xs"
          htmlFor="wa-photo"
        >
          <div className="flex items-center gap-2">
            <Input
              id="wa-photo"
              type="number"
              min="0"
              value={form.photo_keep_days}
              onChange={(e) => setForm((x) => ({ ...x, photo_keep_days: Number(e.target.value) || 0 }))}
            />
            <span className="text-[13px] text-muted-ink whitespace-nowrap">ngày</span>
          </div>
        </Field>

        {usage && (
          <div className="card p-2.5 mt-3 bg-muted/50 text-[13px] space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-ink">Ảnh đang lưu</span>
              <span className="tabular font-semibold">{n(usage.files)} tấm · {usage.text}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-ink">Đang chờ dọn</span>
              <span className={`tabular font-semibold ${usage.pending_cleanup > 0 ? 'text-warn' : ''}`}>
                {n(usage.pending_cleanup)} tấm
              </span>
            </div>
            <p className="text-2xs text-muted-ink pt-1">
              Phần mềm tự dọn khi khởi động và mỗi 24 giờ một lần. Bấm nút dưới để dọn ngay.
            </p>
          </div>
        )}

        <Button className="mt-3" icon={Trash2} onClick={cleanNow} loading={cleaning}
          disabled={!usage?.pending_cleanup}>
          Dọn ảnh quá hạn ngay
        </Button>
      </div>

      <div className="card-pad bg-amber-50 border-warn/30 text-[13px] flex gap-2.5">
        <AlertTriangle size={16} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-amber-900">
          Ảnh nằm ngoài file sao lưu JSON vì quá nặng. Muốn sao lưu cả ảnh thì chép nguyên
          thư mục <b>data/</b> sang USB.
        </p>
      </div>

      <Button variant="primary" icon={Save} onClick={save} loading={busy}>
        Lưu thiết lập bảo hành
      </Button>
    </div>
  );
}

/* ==================================================================== */

function Carriers() {
  const { toast } = useApp();
  const { data, busy, reload } = useFetch(() => api.get('/carriers'), []);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const doDelete = async () => {
    try {
      const res = await api.del(`/carriers/${deleting.id}`);
      toast(res.message || `Đã xoá ${deleting.name}`, res.deactivated ? 'warn' : 'ok', 5000);
      setDeleting(null);
      reload();
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  return (
    <div className="max-w-3xl space-y-3">
      <div className="card-pad bg-accent-soft/40 border-accent/25 text-[13px] flex gap-2.5">
        <Info size={16} className="text-emerald-800 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-emerald-950">
          Khai các nhà xe, hãng chuyển phát hay shipper ruột mà tiệm hay gửi hàng. Khi bán,
          chọn đơn vị ở mục Giao hàng để lưu mã vận đơn và tra lại khi khách hỏi.
        </p>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
          Thêm đơn vị vận chuyển
        </Button>
      </div>

      {busy ? <Spinner />
        : !data?.length ? (
          <Empty
            icon={Truck}
            title="Chưa khai đơn vị vận chuyển nào"
            message="Ví dụ: nhà xe Thành Bưởi, Viettel Post, GHTK, hoặc shipper quen của tiệm."
            action={<Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Thêm đơn vị vận chuyển</Button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Mã</th><th>Tên đơn vị</th><th>Người liên hệ</th><th>Điện thoại</th>
                  <th>Ghi chú</th><th className="text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id} className="hoverable">
                    <td className="font-mono text-muted-ink">{c.code}</td>
                    <td className="font-semibold">{c.name}</td>
                    <td>{c.contact_name || '—'}</td>
                    <td className="tabular">{c.phone || '—'}</td>
                    <td className="text-muted-ink truncate max-w-[200px]">{c.note || '—'}</td>
                    <td>
                      <div className="flex items-center justify-end gap-0.5">
                        <IconButton icon={Pencil} label={`Sửa ${c.name}`} size={14}
                          onClick={() => setEditing(c)} />
                        <IconButton icon={Trash2} label={`Xoá ${c.name}`} size={14}
                          className="!text-danger hover:!bg-red-50" onClick={() => setDeleting(c)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      <SimpleForm
        open={!!editing}
        item={editing === 'new' ? null : editing}
        title="đơn vị vận chuyển"
        fields={[
          { key: 'name', label: 'Tên đơn vị', placeholder: 'Nhà xe Thành Bưởi', required: true },
          { key: 'contact_name', label: 'Người liên hệ', placeholder: 'Anh Sáu' },
          { key: 'phone', label: 'Số điện thoại', placeholder: '0918 xxx xxx' },
          { key: 'note', label: 'Ghi chú', placeholder: 'Xe chạy tuyến Cái Bè - Sài Gòn, 2 chuyến/ngày' },
        ]}
        onClose={() => setEditing(null)}
        onSave={async (form) => {
          if (editing === 'new') await api.post('/carriers', form);
          else await api.put(`/carriers/${editing.id}`, form);
          setEditing(null);
          reload();
          toast('Đã lưu đơn vị vận chuyển', 'ok');
        }}
      />

      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={doDelete}
        title="Xoá đơn vị vận chuyển?"
        confirmText="Xoá"
        message={deleting && (
          <>Xoá <b>{deleting.name}</b>? Nếu đã có hoá đơn gắn với đơn vị này thì chỉ ẩn đi,
            không xoá hẳn, để lịch sử giao hàng còn tra được.</>
        )}
      />
    </div>
  );
}

/* ==================================================================== */

function UsersTab() {
  const { toast, user: me } = useApp();
  const { data, busy, reload } = useFetch(() => api.users(), []);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const doDelete = async () => {
    try {
      await api.del(`/users/${deleting.id}`);
      toast(`Đã khoá tài khoản ${deleting.full_name}`, 'ok');
      setDeleting(null);
      reload();
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  return (
    <div className="max-w-3xl space-y-3">
      <div className="card-pad bg-amber-50 border-warn/30 text-[13px] flex gap-2.5">
        <AlertTriangle size={16} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-amber-900">
          Đăng nhập ở đây chỉ để phân biệt người bán trên hoá đơn và nhật ký thao tác, không phải
          lớp bảo mật mạnh. Phần mềm chạy trong mạng nội bộ của tiệm — đừng mở cổng ra Internet.
        </p>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>Thêm người dùng</Button>
      </div>

      {busy ? <Spinner />
        : !data?.length ? <Empty icon={UsersIcon} title="Chưa có người dùng" />
          : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Tên đăng nhập</th><th>Họ tên</th><th>Vai trò</th><th>Điện thoại</th>
                    <th>Trạng thái</th><th className="text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((u) => (
                    <tr key={u.id} className={`hoverable ${u.active === 0 ? 'opacity-55' : ''}`}>
                      <td className="font-mono font-semibold">{u.username}</td>
                      <td>
                        {u.full_name}
                        {u.id === me?.id && <Badge tone="info" className="ml-1.5">Bạn</Badge>}
                      </td>
                      <td><Badge tone={u.role === 'owner' ? 'ok' : 'mute'}>{ROLE_LABEL[u.role] || u.role}</Badge></td>
                      <td className="tabular text-muted-ink">{u.phone || '—'}</td>
                      <td>{u.active ? <Badge tone="ok">Đang dùng</Badge> : <Badge tone="mute">Đã khoá</Badge>}</td>
                      <td>
                        <div className="flex items-center justify-end gap-0.5">
                          <IconButton icon={Pencil} label={`Sửa ${u.full_name}`} size={14} onClick={() => setEditing(u)} />
                          {u.active === 1 && (
                            <IconButton icon={Trash2} label={`Khoá ${u.full_name}`} size={14}
                              className="!text-danger hover:!bg-red-50" onClick={() => setDeleting(u)} />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

      <UserForm
        open={!!editing}
        user={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); reload(); toast('Đã lưu người dùng', 'ok'); }}
      />

      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={doDelete}
        title="Khoá tài khoản?"
        confirmText="Khoá tài khoản"
        message={deleting && (
          <>Khoá tài khoản <b>{deleting.full_name}</b>? Người này sẽ không đăng nhập được nữa,
            nhưng lịch sử bán hàng vẫn giữ nguyên.</>
        )}
      />
    </div>
  );
}

function UserForm({ open, user, onClose, onSaved }) {
  const [form, setForm] = useState({ username: '', password: '', full_name: '', role: 'cashier', phone: '', active: 1 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(user
      ? { ...user, password: '' }
      : { username: '', password: '1234', full_name: '', role: 'cashier', phone: '', active: 1 });
    setErr('');
  }, [open, user]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.full_name.trim()) { setErr('Bắt buộc nhập họ tên.'); return; }
    if (!user && !form.username.trim()) { setErr('Bắt buộc nhập tên đăng nhập.'); return; }
    setBusy(true);
    setErr('');
    try {
      if (user) await api.put(`/users/${user.id}`, form);
      else await api.post('/users', form);
      onSaved?.();
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
      title={user ? `Sửa người dùng: ${user.full_name}` : 'Thêm người dùng'}
      size="sm"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={save} loading={busy}>Lưu</Button>
      </>}
    >
      <div className="space-y-3">
        <Field label="Họ tên" required>
          <Input value={form.full_name} onChange={set('full_name')} placeholder="Lê Thị Mai" />
        </Field>
        <Field label="Tên đăng nhập" required hint={user ? 'Không đổi được' : 'Viết liền không dấu'}>
          <Input value={form.username} onChange={set('username')} disabled={!!user} placeholder="thungan" />
        </Field>
        <Field label={user ? 'Mật khẩu mới' : 'Mật khẩu'} hint={user ? 'Để trống nếu không đổi' : ''}>
          <Input type="text" value={form.password} onChange={set('password')} placeholder="1234" />
        </Field>
        <Field label="Vai trò">
          <Select value={form.role} onChange={set('role')}>
            {Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Số điện thoại">
          <Input value={form.phone || ''} onChange={set('phone')} inputMode="tel" />
        </Field>
        {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
      </div>
    </Modal>
  );
}

/* ==================================================================== */

function DataTab() {
  const { toast } = useApp();
  const { data: info, reload } = useFetch(() => api.systemInfo(), []);
  const [restoring, setRestoring] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const fileRef = useRef(null);

  const backup = () => {
    window.location.href = '/api/backup';
    toast('Đang tải file sao lưu...', 'ok');
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoring(true);
    try {
      const text = await file.text();
      const dump = JSON.parse(text);
      const res = await api.post('/restore', dump);
      toast(res.message, 'ok', 8000);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      toast('Khôi phục thất bại: ' + err.message, 'bad', 8000);
    } finally {
      setRestoring(false);
      e.target.value = '';
    }
  };

  const doClear = async () => {
    try {
      const res = await api.post('/clear-transactions', { confirm: confirmText });
      toast(res.message, 'ok', 8000);
      setClearing(false);
      setConfirmText('');
      reload();
    } catch (e) {
      toast(e.message, 'bad', 6000);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="card p-4">
        <h2 className="font-bold text-sm mb-1">Sao lưu dữ liệu</h2>
        <p className="text-[13px] text-muted-ink mb-3">
          Tải toàn bộ dữ liệu về một file. Nên làm mỗi tuần một lần và cất file
          vào USB hoặc Google Drive. Mất máy mà có file này thì khôi phục được hết.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={Download} onClick={backup}>Tải file sao lưu</Button>
          <Button icon={Upload} onClick={() => fileRef.current?.click()} loading={restoring}>
            Khôi phục từ file
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onFile}
            aria-label="Chọn file sao lưu để khôi phục"
          />
        </div>
        <div className="mt-3 p-2.5 bg-amber-50 border border-warn/30 rounded text-[13px] flex gap-2">
          <AlertTriangle size={15} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
          <span className="text-amber-900">
            Khôi phục sẽ <b>ghi đè toàn bộ</b> dữ liệu hiện có. Nên tải file sao lưu mới nhất trước khi khôi phục.
          </span>
        </div>
      </div>

      {info && (
        <div className="card p-4">
          <h2 className="font-bold text-sm mb-3">Tình trạng cơ sở dữ liệu</h2>
          <div className="grid gap-2 sm:grid-cols-2 text-[13px]">
            <div className="flex justify-between border-b border-line pb-1.5">
              <span className="text-muted-ink">Dung lượng</span>
              <span className="font-semibold tabular">{info.db_size_text}</span>
            </div>
            <div className="flex justify-between border-b border-line pb-1.5">
              <span className="text-muted-ink">Phiên bản Node</span>
              <span className="font-semibold tabular">{info.node_version}</span>
            </div>
            {[
              ['products', 'Mặt hàng'], ['customers', 'Khách hàng'], ['suppliers', 'Nhà cung cấp'],
              ['sales', 'Hoá đơn bán'], ['purchases', 'Phiếu nhập'], ['cash_transactions', 'Phiếu thu chi'],
              ['stock_moves', 'Biến động kho'],
            ].map(([k, label]) => (
              <div key={k} className="flex justify-between border-b border-line pb-1.5">
                <span className="text-muted-ink">{label}</span>
                <span className="font-semibold tabular">{n(info.counts[k] || 0)}</span>
              </div>
            ))}
          </div>
          <p className="text-2xs text-muted-ink mt-3 font-mono break-all">
            File dữ liệu: {info.db_file}
          </p>
        </div>
      )}

      <div className="card p-4 border-danger/30">
        <h2 className="font-bold text-sm text-danger mb-1">Xoá dữ liệu giao dịch</h2>
        <p className="text-[13px] text-muted-ink mb-3">
          Xoá sạch hoá đơn, phiếu nhập, phiếu thu chi và toàn bộ tồn kho — giữ lại danh mục
          hàng hoá, khách hàng, nhà cung cấp. Dùng khi muốn bỏ dữ liệu mẫu để bắt đầu nhập số liệu thật.
        </p>
        <Button variant="danger" icon={Trash2} onClick={() => setClearing(true)}>
          Xoá dữ liệu giao dịch
        </Button>
      </div>

      <Modal
        open={clearing}
        onClose={() => { setClearing(false); setConfirmText(''); }}
        title="Xoá toàn bộ dữ liệu giao dịch?"
        size="sm"
        footer={<>
          <Button onClick={() => { setClearing(false); setConfirmText(''); }}>Huỷ bỏ</Button>
          <Button variant="danger" onClick={doClear} disabled={confirmText !== 'XOA-DU-LIEU'}>
            Xoá vĩnh viễn
          </Button>
        </>}
      >
        <div className="space-y-3">
          <div className="flex gap-2.5">
            <AlertTriangle size={20} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-[13px] leading-relaxed">
              Sẽ xoá vĩnh viễn: <b>tất cả hoá đơn bán, phiếu nhập, phiếu trả hàng, phiếu thu chi,
              phiếu kiểm kê và toàn bộ số liệu tồn kho</b>.
              <br /><br />
              Giữ lại: danh mục hàng hoá, khách hàng, nhà cung cấp, bảng giá, kho, người dùng.
              <br /><br />
              <span className="font-semibold text-danger">Không thể hoàn tác.</span> Hãy tải file
              sao lưu trước nếu chưa chắc.
            </div>
          </div>
          <Field label="Gõ chính xác XOA-DU-LIEU để xác nhận" htmlFor="clear-confirm">
            <Input
              id="clear-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
              placeholder="XOA-DU-LIEU"
              autoComplete="off"
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

/* ==================================================================== */
/* Form đơn giản dùng lại cho bảng giá và kho                            */
/* ==================================================================== */

function SimpleForm({ open, item, title, fields, extra, onClose, onSave }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(item ? { ...item } : {});
    setErr('');
  }, [open, item]);

  const save = async () => {
    for (const f of fields) {
      if (f.required && !String(form[f.key] || '').trim()) {
        setErr(`Bắt buộc nhập ${f.label.toLowerCase()}.`);
        return;
      }
    }
    setBusy(true);
    setErr('');
    try {
      await onSave(form);
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
      title={item ? `Sửa ${title}` : `Thêm ${title}`}
      size="sm"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={save} loading={busy}>Lưu</Button>
      </>}
    >
      <div className="space-y-3">
        {fields.map((f) => (
          <Field key={f.key} label={f.label} required={f.required} htmlFor={`sf-${f.key}`}>
            <Input
              id={`sf-${f.key}`}
              value={form[f.key] || ''}
              onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              disabled={f.disabledOnEdit && !!item}
            />
          </Field>
        ))}
        {extra?.(form, setForm)}
        {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
      </div>
    </Modal>
  );
}
