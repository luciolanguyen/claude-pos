import { useState, useEffect, useRef } from 'react';
import {
  Store, Printer, Users as UsersIcon, Warehouse, Tag, Database, Save,
  Download, Upload, Plus, Pencil, Trash2, AlertTriangle, Check, Info, Truck,
  ShieldCheck, Star, ChevronUp, ChevronDown,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch } from '../lib/store';
import { money, n, date, datetime, ROLE_LABEL, COST_METHOD_LABEL, COST_METHOD_HINT } from '../lib/format';
import {
  Button, IconButton, Input, Select, Textarea, Field, Modal, Spinner, Empty,
  Badge, Confirm, Tabs, MoneyInput,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import { CategorySelect } from '../components/CategoryTree';
import CartPickerModal from '../components/CartPickerModal';
import { ErrorBox } from '../components/ui';

const TABS = [
  { key: 'store', label: 'Thông tin cửa hàng' },
  { key: 'invoice', label: 'Hoá đơn & in ấn' },
  { key: 'pos', label: 'Màn hình bán hàng' },
  { key: 'featured', label: 'Hàng ưu tiên đầu lưới' },
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
      {tab === 'featured' && <FeaturedSettings />}
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
  const [printForm, setPrintForm] = useState(settings?.print || {});
  const [vatEnabled, setVatEnabled] = useState(settings?.vat_enabled !== false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(settings?.invoice || {});
    setPrintForm(settings?.print || {});
    setVatEnabled(settings?.vat_enabled !== false);
  }, [settings]);

  const save = async () => {
    setBusy(true);
    try {
      await saveSettings({ invoice: form, print: printForm, vat_enabled: vatEnabled });
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

      {/* Phiếu thu nợ khổ K80 (tài liệu 14, mục 1.2) */}
      <div className="card p-4">
        <h2 className="font-bold text-sm mb-1">Phiếu thu nợ khổ K80</h2>
        <p className="text-2xs text-muted-ink mb-2">
          Phiếu thu nợ mặc định in khổ K80 trên máy in nhiệt ngay tại quầy.
          Lúc in vẫn đổi được sang A5 / A4 và bật tắt dòng công nợ cho từng lần.
        </p>
        <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 accent-emerald-700 cursor-pointer mt-0.5"
            checked={printForm.debt_show_remaining !== false}
            onChange={(e) => setPrintForm((f) => ({ ...f, debt_show_remaining: e.target.checked }))}
          />
          <span className="text-[13px]">
            Hiển thị số nợ còn lại của khách trên phiếu in
            <span className="block text-2xs text-muted-ink">
              Tắt thì phiếu chỉ ghi số tiền vừa thu, không ghi tổng nợ cũ và nợ còn lại —
              quầy đông người, số nợ của khách là chuyện riêng của khách.
            </span>
          </span>
        </label>
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
  const [costMethod, setCostMethod] = useState(settings?.cost_method || 'average');
  const [busy, setBusy] = useState(false);
  /* Ô số: để trống thì lưu rỗng, máy chủ tự dùng giá trị mặc định */
  const numSet = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value === '' ? '' : Number(e.target.value) }));

  useEffect(() => {
    setForm(settings?.pos || {});
    setAllowNeg(settings?.allow_negative_stock === true);
    setCostMethod(settings?.cost_method || 'average');
  }, [settings]);

  const save = async () => {
    setBusy(true);
    try {
      await saveSettings({ pos: form, allow_negative_stock: allowNeg, cost_method: costMethod });
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
            {meta.warehouses.filter((w) => !w.is_defect).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
      </div>

      <div className="card p-4">
        <h2 className="font-bold text-sm mb-1">Chính sách bán hàng tại quầy</h2>
        <p className="text-2xs text-muted-ink mb-3">
          Máy chủ soát lại các quy tắc này mỗi lần lưu hoá đơn, nên sửa trình duyệt cũng không lách được.
          Vượt hạn mức thì quản lý gõ mã PIN để duyệt — đặt PIN cho chủ tiệm / quản lý ở mục Người dùng.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Số tab đơn hàng mở cùng lúc" hint="Mặc định 10. Máy tính tiền cũ nên để thấp cho đỡ ì." htmlFor="pos-maxtabs">
            <Input id="pos-maxtabs" type="number" min="1" max="50" value={form.max_tabs ?? 10} onChange={numSet('max_tabs')} />
          </Field>
          <Field label="Thu ngân tự giảm giá tối đa (%)" hint="So với bảng giá, gộp cả giảm từng dòng và giảm cả đơn. Mặc định 10%." htmlFor="pos-maxdisc">
            <Input id="pos-maxdisc" type="number" min="0" max="100" step="0.5"
              value={form.cashier_max_discount_percent ?? 10} onChange={numSet('cashier_max_discount_percent')} />
          </Field>
          <Field label="Nhận đổi trả trong (ngày)" hint="Tính từ ngày mua. 0 = không giới hạn. Mặc định 7 ngày." htmlFor="pos-retdays">
            <Input id="pos-retdays" type="number" min="0" value={form.return_days ?? 7} onChange={numSet('return_days')} />
          </Field>
          <Field label="Phí đổi trả mặc định" hint="Điền sẵn vào hộp đổi trả, thu ngân vẫn sửa được." htmlFor="pos-retfee">
            <div className="flex gap-1.5">
              <Select className="!w-24" aria-label="Cách tính phí đổi trả"
                value={form.return_fee_type === 'percent' ? 'percent' : 'amount'}
                onChange={(e) => setForm((f) => ({ ...f, return_fee_type: e.target.value }))}>
                <option value="amount">đồng</option>
                <option value="percent">%</option>
              </Select>
              <Input id="pos-retfee" type="number" min="0" className="flex-1"
                value={form.return_fee_value ?? 0} onChange={numSet('return_fee_value')} />
            </div>
          </Field>
          <Field label="Không bán nợ thêm khi có hoá đơn nợ quá (ngày)" hint="Đề xuất 30 ngày. Để 0 là tắt — mặc định đang tắt." htmlFor="pos-debtdays">
            <Input id="pos-debtdays" type="number" min="0" value={form.max_debt_days ?? 0} onChange={numSet('max_debt_days')} />
          </Field>
          <Field label="Hạn dùng phiếu đổi hàng (ngày)" hint="Tính từ ngày cấp phiếu. Mặc định 90 ngày." htmlFor="pos-vdays">
            <Input id="pos-vdays" type="number" min="1" value={form.voucher_days ?? 90} onChange={numSet('voucher_days')} />
          </Field>
        </div>
      </div>

      {/* Hiện nút chọn nhanh đơn vị tính trên lưới (tài liệu 13, mục 2.2) */}
      <div className="card p-4">
        <h2 className="font-bold text-sm mb-2">Đơn vị tính trên lưới bán hàng</h2>
        <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 accent-emerald-700 cursor-pointer mt-0.5"
            checked={form.show_unit_picker === true}
            onChange={(e) => setForm((f) => ({ ...f, show_unit_picker: e.target.checked }))}
          />
          <span className="text-[13px]">
            Hiển thị nút xem hàng cùng đơn vị tính ngoài màn hình bán hàng
            <span className="block text-2xs text-muted-ink">
              Mỗi ô hàng có thêm nút [ĐVT ▼] bung ra mọi đơn vị kèm giá. Bấm vào một đơn vị là
              vào giỏ với đúng đơn vị đó; bấm vùng khác của ô thì vào giỏ với đơn vị bán chính.
            </span>
          </span>
        </label>
        {/* Giá quy đổi trong menu ĐVT (tài liệu 16, mục 5) */}
        <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 accent-emerald-700 cursor-pointer mt-0.5"
            checked={form.show_converted_price === true}
            disabled={form.show_unit_picker !== true}
            onChange={(e) => setForm((f) => ({ ...f, show_converted_price: e.target.checked }))}
          />
          <span className="text-[13px]">
            Hiện thêm giá quy đổi về đơn vị nhỏ nhất trong menu đơn vị tính
            <span className="block text-2xs text-muted-ink">
              Ví dụ: &quot;Thùng — 1.200.000 đ | 10.000/Cái&quot;. Khách hỏi &quot;lấy nguyên thùng có rẻ hơn
              không&quot; thì nhìn là trả lời được ngay. Cần bật ô trên trước.
            </span>
          </span>
        </label>
        {/* Đa đơn vị bán chính / mua chính (tài liệu 16, mục 2.1) */}
        <label className="flex items-start gap-2.5 py-1.5 cursor-pointer">
          <input
            type="checkbox"
            className="w-4 h-4 accent-emerald-700 cursor-pointer mt-0.5"
            checked={form.multi_main_units === true}
            onChange={(e) => setForm((f) => ({ ...f, multi_main_units: e.target.checked }))}
          />
          <span className="text-[13px]">
            Cho phép thiết lập đa ĐVT mua / bán chính
            <span className="block text-2xs text-muted-ink">
              Bật thì một mặt hàng tích được nhiều đơn vị bán chính — mỗi đơn vị thành một ô riêng
              ngoài lưới bán hàng (bán lẻ theo Cái và bán nguyên Thùng nằm cạnh nhau). Tắt thì chỉ
              chọn được 1 đơn vị bán chính và 1 đơn vị mua chính. <b>Tắt hay bật đều không đụng tới
              dữ liệu đã lưu và hoá đơn cũ</b> — chỉ đổi cách ô tích hoạt động.
            </span>
          </span>
        </label>
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
        <h2 className="font-bold text-sm mb-1">Cách tính giá vốn</h2>
        <p className="text-2xs text-muted-ink mb-3">
          Áp dụng cho mọi mặt hàng. Món nào cần khác thì vào thẻ hàng hoá đổi riêng.
        </p>
        <div className="space-y-2">
          {['average', 'fixed'].map((m) => (
            <label
              key={m}
              className={`flex items-start gap-2.5 p-2.5 rounded border cursor-pointer transition-colors duration-150
                          ${costMethod === m ? 'border-accent bg-accent/5' : 'border-line hover:bg-muted/50'}`}
            >
              <input
                type="radio"
                name="cost-method"
                className="w-4 h-4 accent-emerald-700 cursor-pointer mt-0.5"
                checked={costMethod === m}
                onChange={() => setCostMethod(m)}
              />
              <span className="text-[13px]">
                <b>{COST_METHOD_LABEL[m]}</b>
                <span className="block text-2xs text-muted-ink leading-relaxed mt-0.5">
                  {COST_METHOD_HINT[m]}
                </span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-2.5 p-2.5 bg-muted/60 border border-line rounded text-[13px] flex gap-2">
          <AlertTriangle size={15} className="text-muted-ink shrink-0 mt-0.5" aria-hidden="true" />
          <span className="text-muted-ink">
            Đổi cách tính <b>không tính lại lịch sử</b>. Giá vốn đang có của từng món giữ nguyên,
            cách mới chỉ ăn từ lần nhập hàng kế tiếp. Nhờ vậy lãi lỗ của hoá đơn đã xuất
            không bị đổi số sau lưng.
          </span>
        </div>
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

/* ==================================================================== */
/* HÀNG / NHÓM HÀNG ƯU TIÊN ĐẦU LƯỚI POS (tài liệu 14, mục 2)            */
/*                                                                      */
/* Mùa nào bán chạy món nào thì ghim món đó lên đầu lưới, thu ngân khỏi   */
/* gõ tìm. Ghim được cả một NHÓM: mùa mưa ghim nhóm "Đèn pin & pin" là    */
/* cả nhóm nhảy lên đầu, không phải ghim từng mã.                        */
/* ==================================================================== */

function FeaturedSettings() {
  const { meta, toast, defaultWarehouse } = useApp();
  const { data, busy, error, reload } = useFetch(() => api.posFeatured(), []);
  const { data: products } = useFetch(
    () => api.posProducts({ warehouse_id: defaultWarehouse }), [defaultWarehouse]);
  const [list, setList] = useState([]);
  const [adding, setAdding] = useState(false);
  const [catPick, setCatPick] = useState('');
  const [saving, setSaving] = useState(false);
  /* Bộ hàng ghim theo mùa (tài liệu 16, mục 4) */
  const { data: sets, reload: reloadSets } = useFetch(() => api.get('/pos-featured-sets'), []);
  const [newSetName, setNewSetName] = useState('');
  const activeSet = (sets || []).find((x) => x.active);

  useEffect(() => {
    if (data) setList(data.map((x) => ({ kind: x.kind, ref_id: x.ref_id, label: x.label, sku: x.sku })));
  }, [data]);

  const move = (i, step) => setList((prev) => {
    const j = i + step;
    if (j < 0 || j >= prev.length) return prev;
    const copy = [...prev];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  });
  const drop = (i) => setList((prev) => prev.filter((_, j) => j !== i));
  const has = (kind, id) => list.some((x) => x.kind === kind && x.ref_id === id);

  const addProduct = (p) => {
    if (has('product', p.id)) { toast(`"${p.name}" đã có trong danh sách ưu tiên`, 'warn'); return; }
    setList((prev) => [...prev, { kind: 'product', ref_id: p.id, label: p.name, sku: p.sku }]);
  };

  /* Giỏ của hộp chọn đọc thẳng danh sách đang ghim, nên sửa bên nào cũng
     thấy ngay bên kia. Chỉ lấy phần MẶT HÀNG; nhóm hàng chọn ở ô riêng. */
  const pinnedLines = list
    .filter((x) => x.kind === 'product')
    .map((x) => ({
      key: `${x.kind}-${x.ref_id}`, product_id: x.ref_id, name: x.label, sku: x.sku,
    }));
  const addCategory = (id) => {
    const c = meta.categories.find((x) => String(x.id) === String(id));
    if (!c) return;
    if (has('category', c.id)) { toast(`Nhóm "${c.name}" đã có trong danh sách`, 'warn'); return; }
    setList((prev) => [...prev, { kind: 'category', ref_id: c.id, label: c.name }]);
    setCatPick('');
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.savePosFeatured(list.map((x) => ({ kind: x.kind, ref_id: x.ref_id })));
      reload();
      toast(list.length
        ? `Đã ghim ${n(list.length)} mục lên đầu lưới bán hàng`
        : 'Đã bỏ hết hàng ghim — lưới bán hàng về thứ tự thường', 'ok', 6000);
    } catch (e) {
      toast(e.message, 'bad', 6000);
    } finally { setSaving(false); }
  };

  if (busy && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="card p-4">
        <h2 className="font-bold text-sm mb-1">Hàng ghim đầu lưới bán hàng</h2>
        <p className="text-2xs text-muted-ink mb-3">
          Những mục ở đây được đẩy lên <b>các vị trí đầu tiên</b> của lưới hàng ngoài màn hình bán
          hàng và mang dấu ★. Xếp từ trên xuống là thứ tự ưu tiên. Đổi theo mùa bất cứ lúc nào:
          mùa nóng ghim quạt, mùa mưa ghim đèn pin và pin.
        </p>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>Thêm mặt hàng</Button>
          <div className="flex items-center gap-1.5">
            <CategorySelect
              value={catPick}
              onChange={(v) => { setCatPick(v); if (v) addCategory(v); }}
              categories={meta.categories}
              size="sm"
              className="!w-auto"
              placeholder="Thêm cả một nhóm hàng..."
              ariaLabel="Chọn nhóm hàng để ghim đầu lưới"
            />
          </div>
          <div className="flex-1" />
          <Button size="sm" variant="primary" icon={Save} loading={saving} onClick={save}>
            Lưu danh sách
          </Button>
        </div>

        {list.length === 0 ? (
          <Empty
            icon={Star}
            title="Chưa ghim mục nào"
            message="Lưới bán hàng đang xếp theo thứ tự thường. Thêm mặt hàng hoặc nhóm hàng bán chạy để đẩy lên đầu."
          />
        ) : (
          <ol className="space-y-1.5">
            {list.map((x, i) => (
              <li key={`${x.kind}-${x.ref_id}`}
                className="flex items-center gap-2 rounded border border-line px-2.5 py-1.5">
                <span className="w-6 text-center text-2xs font-bold text-muted-ink tabular">{i + 1}</span>
                <Star size={13} className="text-amber-500 fill-amber-400 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold truncate">
                    {x.label || `#${x.ref_id}`}
                  </div>
                  <div className="text-2xs text-muted-ink">
                    {x.kind === 'category'
                      ? 'Cả nhóm hàng — mọi mặt hàng trong nhóm và nhóm con đều lên đầu'
                      : `Mặt hàng · ${x.sku || ''}`}
                  </div>
                </div>
                <Badge tone={x.kind === 'category' ? 'info' : 'ok'}>
                  {x.kind === 'category' ? 'Nhóm hàng' : 'Mặt hàng'}
                </Badge>
                <IconButton icon={ChevronUp} size={14} label={`Đưa "${x.label}" lên trên`}
                  disabled={i === 0} onClick={() => move(i, -1)} />
                <IconButton icon={ChevronDown} size={14} label={`Đưa "${x.label}" xuống dưới`}
                  disabled={i === list.length - 1} onClick={() => move(i, 1)} />
                <IconButton icon={Trash2} size={14} label={`Bỏ ghim "${x.label}"`}
                  className="!text-danger hover:!bg-red-50" onClick={() => drop(i)} />
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* ---------- Bộ hàng ghim theo mùa (tài liệu 16, mục 4) ---------- */}
      <div className="card p-4">
        <h2 className="font-bold text-sm mb-1">Bộ hàng ghim theo mùa</h2>
        <p className="text-2xs text-muted-ink mb-3">
          Cất sẵn mỗi mùa một bộ rồi bật lại khi tới mùa, khỏi phải đi chọn lại từng món.
          Bật một bộ là chép nội dung bộ đó sang danh sách đang dùng ở trên.
          Tắt hết thì lưới bán hàng về thứ tự thường — <b>không ẩn món nào</b>.
        </p>

        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Input
            value={newSetName}
            onChange={(e) => setNewSetName(e.target.value)}
            placeholder="Tên bộ mới, ví dụ: Hàng ghim mùa hè"
            className="w-full sm:w-64"
            aria-label="Tên bộ hàng ghim mới"
          />
          <Button
            size="sm"
            icon={Plus}
            disabled={!newSetName.trim()}
            onClick={async () => {
              try {
                await api.post('/pos-featured-sets', {
                  name: newSetName.trim(), from_current: true,
                });
                setNewSetName('');
                reloadSets();
                toast(`Đã cất danh sách đang dùng thành bộ "${newSetName.trim()}"`, 'ok', 6000);
              } catch (e) { toast(e.message, 'bad', 6000); }
            }}
          >
            Cất danh sách hiện tại thành bộ
          </Button>
          {activeSet && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await api.post('/pos-featured-sets/off/activate', { active: false });
                  reloadSets();
                  reload();
                  toast('Đã xả ghim — lưới bán hàng về thứ tự thường', 'ok', 6000);
                } catch (e) { toast(e.message, 'bad', 6000); }
              }}
            >
              Tắt hết ghim
            </Button>
          )}
        </div>

        {(sets || []).length === 0 ? (
          <p className="text-[13px] text-muted-ink">
            Chưa cất bộ nào. Chọn xong danh sách ở trên rồi bấm <b>Cất danh sách hiện tại thành bộ</b>.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {sets.map((st) => (
              <li key={st.id}
                className={`flex flex-wrap items-center gap-2 rounded border px-2.5 py-1.5
                            ${st.active ? 'border-amber-400 bg-amber-50' : 'border-line'}`}>
                <Star size={13} aria-hidden="true"
                  className={st.active ? 'text-amber-500 fill-amber-400' : 'text-muted-ink'} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold">{st.name}</div>
                  <div className="text-2xs text-muted-ink">
                    {n(st.item_count)} mục{st.active ? ' · đang dùng' : ''}
                  </div>
                </div>
                {st.active
                  ? <Badge tone="warn">Đang bật</Badge>
                  : (
                    <Button size="sm" variant="soft" onClick={async () => {
                      try {
                        const res = await api.post(`/pos-featured-sets/${st.id}/activate`, {});
                        reloadSets();
                        reload();
                        toast(`Đã bật bộ "${st.name}" — ${n(res.count)} mục lên đầu lưới`, 'ok', 6000);
                      } catch (e) { toast(e.message, 'bad', 6000); }
                    }}>
                      Bật bộ này
                    </Button>
                  )}
                <IconButton icon={Trash2} size={14} label={`Xoá bộ ${st.name}`}
                  className="!text-danger hover:!bg-red-50"
                  onClick={async () => {
                    try {
                      await api.del(`/pos-featured-sets/${st.id}`);
                      reloadSets();
                      toast(`Đã xoá bộ "${st.name}"`, 'ok');
                    } catch (e) { toast(e.message, 'bad', 6000); }
                  }} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Hộp chọn đồng bộ hai chiều, KHÔNG có ô số lượng: đây là danh sách
          ưu tiên hiển thị, không phải phiếu xuất nhập (tài liệu 17, mục 1.2) */}
      <CartPickerModal
        open={adding}
        onClose={() => setAdding(false)}
        kind="featured"
        title="Chọn mặt hàng ghim lên đầu lưới"
        products={products || []}
        lines={pinnedLines}
        onAdd={addProduct}
        onPatch={() => {}}
        onRemove={(key) => setList((prev) => prev.filter((x) => `${x.kind}-${x.ref_id}` !== key))}
        noQty
        showPrice={false}
        footerNote="Đang ghim"
      />
    </div>
  );
}

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
                      <td className="font-semibold">
                        {w.name}
                        {w.is_defect ? <Badge tone="bad" className="ml-1.5">Kho hàng lỗi — không bán</Badge> : null}
                      </td>
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
  const [form, setForm] = useState({ keep_days: 30, photo_keep_days: 60, labor_presets: [] });
  const [busy, setBusy] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const { data: usage, reload: reloadUsage } = useFetch(() => api.photoUsage(), []);

  useEffect(() => {
    setForm({
      keep_days: Number(settings?.warranty?.keep_days) || 30,
      /* Không dùng Number(x) ?? 60: Number(undefined) là NaN chứ không rỗng */
      photo_keep_days: settings?.warranty?.photo_keep_days ?? 60,
      labor_presets: Array.isArray(settings?.warranty?.labor_presets) ? settings.warranty.labor_presets : [],
    });
  }, [settings]);

  const save = async () => {
    setBusy(true);
    try {
      await saveSettings({
        warranty: {
          ...(settings?.warranty || {}),
          ...form,
          labor_presets: form.labor_presets
            .filter((x) => String(x.name || '').trim())
            .map((x) => ({ name: String(x.name).trim(), price: Math.max(0, Math.round(Number(x.price) || 0)) })),
        },
      });
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
        <h2 className="font-bold text-sm mb-1">Bảng giá tiền công sửa chữa</h2>
        <p className="text-2xs text-muted-ink mb-3">
          Kỹ thuật viên chọn nhanh ở phiếu sửa chữa thay vì gõ tay. Vẫn gõ số khác được.
        </p>
        <div className="space-y-1.5">
          {form.labor_presets.map((p, i) => (
            <div key={i} className="flex gap-1.5 items-center">
              <Input aria-label={`Tên công việc ${i + 1}`} value={p.name} placeholder="VD: Quấn lại motor quạt"
                className="flex-1"
                onChange={(e) => setForm((x) => ({ ...x, labor_presets: x.labor_presets.map((q, j) => (j === i ? { ...q, name: e.target.value } : q)) }))} />
              <MoneyInput aria-label={`Tiền công ${i + 1}`} value={p.price} className="!w-36"
                onChange={(v) => setForm((x) => ({ ...x, labor_presets: x.labor_presets.map((q, j) => (j === i ? { ...q, price: v } : q)) }))} />
              <IconButton icon={Trash2} label={`Bỏ công việc ${i + 1}`} size={15} className="!text-danger hover:!bg-red-50"
                onClick={() => setForm((x) => ({ ...x, labor_presets: x.labor_presets.filter((_, j) => j !== i) }))} />
            </div>
          ))}
          <Button size="sm" variant="soft" icon={Plus}
            onClick={() => setForm((x) => ({ ...x, labor_presets: [...x.labor_presets, { name: '', price: 0 }] }))}>
            Thêm công việc
          </Button>
        </div>
      </div>

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
  const { toast, user: me, access } = useApp();
  const { data, busy, reload } = useFetch(() => api.users(), []);
  const [showPerms, setShowPerms] = useState(false);
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

      <div className="flex justify-end gap-2">
        <Button icon={ShieldCheck} onClick={() => setShowPerms(true)}>Ai làm được gì</Button>
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
                      <td>
                        <Badge tone={u.role === 'owner' ? 'ok' : 'mute'}>{ROLE_LABEL[u.role] || u.role}</Badge>
                        {u.has_pin ? <Badge tone="info" className="ml-1">Có PIN</Badge> : null}
                      </td>
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

      <PermissionMatrix
        open={showPerms}
        onClose={() => setShowPerms(false)}
        permissions={access?.permissions || {}}
      />

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

/* ==================================================================== */
/* Bảng ai làm được gì                                                   */
/*                                                                      */
/* Chủ tiệm hay hỏi "thu ngân có xem được lãi không". Thay vì giải thích */
/* bằng lời, cho nhìn thẳng vào bảng.                                    */
/* ==================================================================== */

const ROLE_PERMS = {
  owner: 'all',
  manager: 'all',
  cashier: [
    'sale.pos', 'sale.view', 'sale.return',
    'order.manage', 'customer.manage', 'warranty.manage', 'product.view',
  ],
  stock: ['product.view', 'product.manage', 'stock.manage', 'purchase.manage'],
};

function PermissionMatrix({ open, onClose, permissions }) {
  const roles = ['owner', 'manager', 'cashier', 'stock'];
  const keys = Object.keys(permissions);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ai làm được gì"
      subtitle="Chủ cửa hàng và quản lý toàn quyền. Thu ngân chỉ lo phần bán hàng."
      size="lg"
      footer={<Button variant="primary" onClick={onClose}>Đóng</Button>}
    >
      {keys.length === 0 ? (
        <p className="text-[13px] text-muted-ink">
          Không đọc được bảng quyền từ máy chủ. Thử tải lại trang.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Việc</th>
                  {roles.map((r2) => <th key={r2} className="text-center">{ROLE_LABEL[r2]}</th>)}
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k}>
                    <td>{permissions[k]}</td>
                    {roles.map((r2) => {
                      const list = ROLE_PERMS[r2];
                      const yes = list === 'all' || list.includes(k);
                      return (
                        <td key={r2} className="text-center">
                          {yes
                            ? <Check size={15} className="text-emerald-700 inline" aria-label="Được" />
                            : <span className="text-muted-ink" aria-label="Không được">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-2xs text-muted-ink leading-relaxed">
            Mục nào không được vào thì <b>ẩn hẳn khỏi menu</b> của người đó. Máy chủ cũng chặn,
            nên gõ thẳng địa chỉ cũng không vào được. Muốn đổi quyền cho ai thì đổi vai trò
            của họ ở bảng trên.
          </p>
        </div>
      )}
    </Modal>
  );
}

function UserForm({ open, user, onClose, onSaved }) {
  const [form, setForm] = useState({ username: '', password: '', full_name: '', role: 'cashier', phone: '', active: 1 });
  const [pin, setPin] = useState('');
  const [clearPin, setClearPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(user
      ? { ...user, password: '' }
      : { username: '', password: '1234', full_name: '', role: 'cashier', phone: '', active: 1 });
    setPin('');
    setClearPin(false);
    setErr('');
  }, [open, user]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const canApprove = form.role === 'owner' || form.role === 'manager';

  const save = async () => {
    if (!form.full_name.trim()) { setErr('Bắt buộc nhập họ tên.'); return; }
    if (!user && !form.username.trim()) { setErr('Bắt buộc nhập tên đăng nhập.'); return; }
    if (pin && !/^\d{4,8}$/.test(pin)) { setErr('Mã PIN phải là từ 4 đến 8 chữ số.'); return; }
    const body = { ...form };
    delete body.has_pin;
    /* Không gửi trường pin là giữ nguyên; gửi chuỗi rỗng là xoá PIN */
    if (clearPin) body.pin = '';
    else if (pin) body.pin = pin;
    setBusy(true);
    setErr('');
    try {
      if (user) await api.put(`/users/${user.id}`, body);
      else await api.post('/users', body);
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
        {canApprove && (
          <Field
            label="Mã PIN duyệt tại quầy"
            htmlFor="uf-pin"
            hint="4–8 chữ số, mỗi người một mã. Dùng để duyệt giảm giá quá hạn mức và bán nợ vượt hạn mức ngay trên màn hình bán hàng. Như mật khẩu, đây là hàng rào chống làm nhầm trong tiệm, không phải lớp bảo mật."
          >
            <Input
              id="uf-pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={8}
              value={pin}
              disabled={clearPin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder={user?.has_pin ? 'Đã có PIN — để trống nếu không đổi' : 'Chưa có PIN'}
            />
            {user?.has_pin && (
              <label className="flex items-center gap-1.5 mt-1.5 text-[13px] cursor-pointer">
                <input type="checkbox" className="w-4 h-4 accent-emerald-700 cursor-pointer" checked={clearPin}
                  onChange={(e) => { setClearPin(e.target.checked); if (e.target.checked) setPin(''); }} />
                Xoá mã PIN của người này
              </label>
            )}
          </Field>
        )}
        {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
      </div>
    </Modal>
  );
}

/* ==================================================================== */

function DataTab() {
  const { toast, user } = useApp();
  const { data: info, reload } = useFetch(() => api.systemInfo(), []);
  const [restoring, setRestoring] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const fileRef = useRef(null);

  /**
   * Tải file sao lưu.
   * Chuyển trang bằng window.location KHÔNG gửi được header x-user-id, nên
   * máy chủ chặn 401 và file tải về chỉ là một dòng báo lỗi. Gắn id người
   * dùng vào đường dẫn để máy chủ nhận ra.
   */
  const backup = () => {
    const uid = user?.id;
    window.location.href = '/api/backup' + (uid ? `?uid=${uid}` : '');
    toast('Đang tải file sao lưu...', 'ok');
  };

  /** Xoá sạch toàn bộ. Bắt tải sao lưu trước rồi mới cho gõ xác nhận. */
  const doResetAll = async () => {
    setResetting2(true);
    try {
      const res = await api.post('/reset-all', { confirm: resetText });
      toast(res.message, 'ok', 10000);
      setResetOpen(false);
      setResetText('');
      setBackedUp(false);
      setTimeout(() => window.location.reload(), 1800);
    } catch (e) {
      toast(e.message, 'bad', 8000);
    } finally {
      setResetting2(false);
    }
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

  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState('');
  const [backedUp, setBackedUp] = useState(false);   // đã tải sao lưu chưa
  const [resetting2, setResetting2] = useState(false);

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

      <div className="card p-4 border-danger/50 bg-red-50/40">
        <h2 className="font-bold text-sm text-danger mb-1">Xoá sạch tất cả — về như máy mới cài</h2>
        <p className="text-[13px] text-muted-ink mb-3 leading-relaxed">
          Xoá <b>toàn bộ</b>: hàng hoá, khách hàng, nhà cung cấp, mọi chứng từ, ảnh bảo hành.
          Chỉ giữ lại tài khoản đăng nhập và thông tin cửa hàng để còn vào được phần mềm.
          <br />
          Dùng khi giao phần mềm cho tiệm khác, hoặc muốn nhập lại danh mục từ đầu.
        </p>
        <Button variant="danger" icon={AlertTriangle} onClick={() => setResetOpen(true)}>
          Xoá sạch tất cả
        </Button>
      </div>

      <Modal
        open={resetOpen}
        onClose={() => { setResetOpen(false); setResetText(''); setBackedUp(false); }}
        title="Xoá sạch toàn bộ dữ liệu?"
        size="md"
        footer={<>
          <Button onClick={() => { setResetOpen(false); setResetText(''); setBackedUp(false); }}>
            Huỷ bỏ
          </Button>
          <Button
            variant="danger"
            onClick={doResetAll}
            loading={resetting2}
            disabled={!backedUp || resetText !== 'XOA-TAT-CA'}
          >
            Xoá sạch vĩnh viễn
          </Button>
        </>}
      >
        <div className="space-y-3">
          <div className="flex gap-2.5">
            <AlertTriangle size={20} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-[13px] leading-relaxed">
              Sẽ xoá vĩnh viễn <b>mọi thứ</b>: hàng hoá, bảng giá, khách hàng, nhà cung cấp,
              nhà xe, hoá đơn, phiếu nhập, đơn đặt hàng, phiếu bảo hành kèm ảnh, sổ quỹ, tồn kho.
              <br /><br />
              Giữ lại: <b>tài khoản đăng nhập</b> và <b>thông tin cửa hàng</b>. Phần mềm sẽ dựng
              lại kho mặc định, bảng giá lẻ và quỹ tiền mặt để chạy được ngay.
              <br /><br />
              <span className="font-semibold text-danger">Không có cách nào lấy lại.</span>
            </div>
          </div>

          {/* Bước 1: bắt tải sao lưu. Không cho bỏ qua — mất dữ liệu vì quên
              sao lưu là mất thật, không sửa được bằng bất cứ cách nào. */}
          <div className={`card p-2.5 ${backedUp ? 'border-accent bg-accent-soft/25' : 'border-warn/40 bg-amber-50'}`}>
            <div className="flex items-center gap-2">
              <span className="text-[13px] flex-1">
                <b>Bước 1.</b> Tải file sao lưu về máy trước đã.
                {backedUp && <span className="block text-2xs text-muted-ink">Đã tải. Nếu chưa thấy file, bấm lại.</span>}
              </span>
              <Button
                size="sm"
                icon={Download}
                variant={backedUp ? 'outline' : 'primary'}
                onClick={() => { backup(); setBackedUp(true); }}
              >
                {backedUp ? 'Tải lại' : 'Tải sao lưu'}
              </Button>
            </div>
          </div>

          <Field
            label="Bước 2. Gõ chính xác XOA-TAT-CA để xác nhận"
            hint={backedUp ? null : 'Tải sao lưu xong mới gõ được'}
            htmlFor="reset-confirm"
          >
            <Input
              id="reset-confirm"
              value={resetText}
              onChange={(e) => setResetText(e.target.value.toUpperCase())}
              placeholder="XOA-TAT-CA"
              autoComplete="off"
              disabled={!backedUp}
            />
          </Field>
        </div>
      </Modal>

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
