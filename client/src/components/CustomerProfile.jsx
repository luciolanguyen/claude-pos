import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Phone, MapPin, Receipt, HandCoins, AlertTriangle, Save, Package, Building2, Mail, Cake,
  Clock, Users, Info, Tag, Wallet, KeyRound, FileText,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch } from '../lib/store';
import { useLiveReload } from '../lib/useLive';
import { money, n, short, date, datetime, smartTime, qty as fq, PAYMENT_LABEL } from '../lib/format';
import { Button, Badge, Stat, Tabs, Spinner, ErrorBox, Empty, Field, MoneyInput, Input, Pager } from './ui';
import { StepBadge, CodBadge } from './PosDelivery';
import { DebtCollectModal } from './PosDebt';
import { PinApprovalModal, canSelfApprove } from './PosApproval';
import { WarrantyFlag, WarrantyHistoryModal } from './WarrantyHistory';
import { customerTypeOf } from './CustomerForm';

/* ====================================================================
   HỒ SƠ KHÁCH HÀNG THỐNG NHẤT (tài liệu 08)

   Một hồ sơ ba tab dùng chung cho trang quản trị và màn hình bán hàng:
     1. Thông tin: hành chính, loại khách, người mua hộ liên kết
     2. Lịch sử mua hàng: mọi hoá đơn tiền mặt lẫn ghi nợ, kèm trạng thái
     3. Sổ công nợ: tổng nợ, hạn mức, số ngày nợ tối đa, nút Thu nợ dùng
        chung sổ phụ của tài liệu 05
   Tự tải lại khi màn hình được nhìn tới, nên bán ở quầy xong thì máy quản
   trị đang mở hồ sơ thấy ngay.
   ==================================================================== */

export function CustomerTypeBadge({ type, className = '' }) {
  const t = customerTypeOf(type);
  const Icon = t.icon;
  return (
    <Badge tone={t.tone} className={className}>
      <Icon size={10} aria-hidden="true" /> {t.label}
    </Badge>
  );
}

/** Tình trạng tiền của một hoá đơn. Số còn nợ lấy từ sổ công nợ, vì khách
    trả nợ sau không sửa lại cột "đã trả" của hoá đơn gốc. */
function payState(s, inv) {
  if (s.status === 'cancelled') return { label: 'Đã huỷ', tone: 'bad' };
  if (s.delivery_status === 'failed') return { label: 'Giao không thành công', tone: 'mute' };
  if (s.cod_status === 'pending') return { label: 'Chờ thu hộ COD', tone: 'info' };
  if (inv) {
    if (inv.remaining > 0) return { label: `Còn nợ ${money(inv.remaining)}`, tone: 'warn' };
    if (inv.owed > 0 || inv.allocated > 0) return { label: 'Đã trả hết nợ', tone: 'ok' };
  }
  const owe = s.total - s.paid;
  return owe > 0 ? { label: `Còn nợ ${money(owe)}`, tone: 'warn' } : { label: 'Đã thanh toán', tone: 'ok' };
}

const TABS = ['info', 'history', 'debt'];
const pickTab = (t) => (TABS.includes(t) ? t : 'info');

export default function CustomerProfile({
  customerId, initialTab = 'info', reloadKey = 0, onLoaded, onChanged, compact = false,
}) {
  const { data: c, busy, error, reload } = useFetch(
    () => api.customer(customerId), [customerId, reloadKey], { skip: !customerId });
  const { data: ledger, reload: reloadLedger } = useFetch(
    () => api.customerLedger(customerId), [customerId, reloadKey], { skip: !customerId });
  const refresh = useCallback(() => { reload(); reloadLedger(); }, [reload, reloadLedger]);
  useLiveReload(refresh, { enabled: !!customerId });

  const [tab, setTab] = useState(pickTab(initialTab));
  const [collecting, setCollecting] = useState(false);
  const [history, setHistory] = useState(null);

  useEffect(() => { setTab(pickTab(initialTab)); }, [customerId, initialTab]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (c) onLoaded?.(c); }, [c]);

  const ledgerById = useMemo(() => new Map((ledger?.invoices || []).map((i) => [i.id, i])), [ledger]);
  const changed = () => { refresh(); onChanged?.(); };

  if (!customerId) return null;
  if (busy && !c) return <Spinner />;
  if (error && !c) return <ErrorBox error={error} onRetry={reload} />;
  if (!c) return null;

  const maxDays = c.max_debt_days_effective || 0;
  const limitLeft = c.debt_limit > 0 ? Math.max(0, c.debt_limit - c.debt) : null;

  return (
    <div className="space-y-3">
      <section className="card-pad" aria-label="Tóm tắt khách hàng">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="font-display font-bold text-lg leading-tight">{c.name}</h2>
              <CustomerTypeBadge type={c.customer_type} />
              {c.active === 0 && <Badge tone="mute">Ngừng theo dõi</Badge>}
              {c.over_limit && <Badge tone="bad"><AlertTriangle size={10} aria-hidden="true" /> Vượt hạn mức</Badge>}
              {c.overdue_count > 0 && (
                <Badge tone="bad"><Clock size={10} aria-hidden="true" /> {c.overdue_count} HĐ nợ quá hạn</Badge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-muted-ink">
              <span className="font-mono">{c.code}</span>
              {c.phone && (
                <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 text-accent hover:underline tabular">
                  <Phone size={12} aria-hidden="true" />{c.phone}
                </a>
              )}
              {c.address && (
                <span className="inline-flex items-center gap-1"><MapPin size={12} aria-hidden="true" />{c.address}</span>
              )}
            </div>
          </div>
          {c.debt > 0 && (
            <Button variant="primary" icon={HandCoins} onClick={() => setCollecting(true)}>
              Thu nợ {money(c.debt)}
            </Button>
          )}
        </div>

        <div className="grid gap-2 grid-cols-2 lg:grid-cols-4 mt-3">
          <Stat label="Tổng đã mua" value={short(c.total_spent)} tone="good" icon={Receipt}
            sub={`${n(c.order_count)} hoá đơn`} onClick={() => setTab('history')} />
          <Stat label="Đang nợ" value={money(c.debt)} icon={HandCoins}
            tone={c.over_limit ? 'bad' : c.debt > 0 ? 'warn' : 'default'}
            sub={c.debt_limit > 0 ? `Hạn mức ${short(c.debt_limit)} · còn ${short(limitLeft)}` : 'Không giới hạn hạn mức'}
            onClick={() => setTab('debt')} />
          <Stat label="Nợ lâu nhất" value={c.unpaid_bills > 0 ? `${n(c.oldest_days)} ngày` : '—'} icon={Clock}
            tone={c.overdue_count > 0 ? 'bad' : 'default'}
            sub={maxDays > 0
              ? `Tối đa ${maxDays} ngày${c.max_debt_days === null ? ' (theo tiệm)' : ''}`
              : 'Không giới hạn số ngày'}
            onClick={() => setTab('debt')} />
          <Stat label="Mua gần nhất" value={c.last_order ? smartTime(c.last_order) : 'Chưa mua'} icon={Package} />
        </div>
      </section>

      <div className="card">
        <Tabs
          value={tab}
          onChange={setTab}
          className="px-2 pt-1"
          tabs={[
            { key: 'info', label: 'Thông tin khách hàng' },
            { key: 'history', label: 'Lịch sử mua hàng', count: c.order_count || null },
            { key: 'debt', label: 'Sổ công nợ', count: c.unpaid_bills || null },
          ]}
        />
        {tab === 'info' && <InfoTab c={c} compact={compact} />}
        {tab === 'history' && (
          <HistoryTab
            c={c}
            ledgerById={ledgerById}
            compact={compact}
            onWarranty={(s) => setHistory({ query: { sale_id: s.id }, subtitle: `Hoá đơn ${s.code}` })}
          />
        )}
        {tab === 'debt' && (
          <DebtTab c={c} ledger={ledger} onCollect={() => setCollecting(true)} onSaved={changed} />
        )}
      </div>

      {/* Gắn khi mở: hộp thu nợ chỉ đọc mã khách lúc vừa gắn vào */}
      {collecting && (
        <DebtCollectModal
          open
          customerId={c.id}
          onClose={() => setCollecting(false)}
          onDone={changed}
        />
      )}

      <WarrantyHistoryModal
        open={!!history}
        onClose={() => setHistory(null)}
        query={history?.query}
        subtitle={history?.subtitle}
      />
    </div>
  );
}

/* ============================ Tab 1: Thông tin ======================= */

function InfoRow({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-line/60 last:border-0">
      <Icon size={14} className="text-muted-ink mt-0.5 shrink-0" aria-hidden="true" />
      <div className="w-36 shrink-0 text-muted-ink">{label}</div>
      <div className="min-w-0 flex-1 font-medium break-words">
        {children || <span className="text-muted-ink font-normal">—</span>}
      </div>
    </div>
  );
}

const SectionTitle = ({ id, children }) => (
  <h3 id={id} className="text-2xs font-bold uppercase tracking-wide text-muted-ink mb-1">{children}</h3>
);

function InfoTab({ c, compact }) {
  return (
    <div className="p-3 grid gap-4 lg:grid-cols-2 text-[13px]">
      <section aria-labelledby="cp-info-h">
        <SectionTitle id="cp-info-h">Thông tin hành chính</SectionTitle>
        <InfoRow icon={Tag} label="Loại khách"><CustomerTypeBadge type={c.customer_type} /></InfoRow>
        <InfoRow icon={Phone} label="Số điện thoại">{c.phone}</InfoRow>
        <InfoRow icon={MapPin} label="Địa chỉ">{c.address}</InfoRow>
        <InfoRow icon={FileText} label="Bảng giá">{c.price_list_name || 'Giá lẻ'}</InfoRow>
        <InfoRow icon={Cake} label="Ngày sinh / thành lập">{c.birthday ? date(c.birthday) : null}</InfoRow>
        {(c.company_name || c.tax_code || c.email) && (
          <>
            <InfoRow icon={Building2} label="Tên công ty">{c.company_name}</InfoRow>
            <InfoRow icon={Info} label="Mã số thuế">{c.tax_code}</InfoRow>
            <InfoRow icon={Mail} label="Email">{c.email}</InfoRow>
          </>
        )}
        {c.note && <InfoRow icon={Info} label="Ghi chú">{c.note}</InfoRow>}
      </section>

      <section className="space-y-4">
        <div aria-labelledby="cp-buyers-h">
          <SectionTitle id="cp-buyers-h">Người mua hộ liên kết</SectionTitle>
          {c.buyers?.length ? (
            <div className="overflow-x-auto border border-line rounded">
              <table className="data">
                <thead>
                  <tr>
                    <th>Người mua hộ</th><th>Điện thoại</th>
                    <th className="text-right">Số lần</th><th className="text-right">Tổng tiền</th><th>Gần nhất</th>
                  </tr>
                </thead>
                <tbody>
                  {c.buyers.map((b, i) => (
                    <tr key={b.buyer_id || `x${i}`}>
                      <td className="font-semibold">
                        {b.buyer_id && !compact
                          ? <Link to={`/customers/${b.buyer_id}`} className="text-accent hover:underline">{b.name}</Link>
                          : (b.name || '—')}
                      </td>
                      <td className="tabular">{b.phone || '—'}</td>
                      <td className="num">{n(b.times)}</td>
                      <td className="num">{money(b.total)}</td>
                      <td className="text-muted-ink whitespace-nowrap">{smartTime(b.last_ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-muted-ink">Chưa ai đi mua hộ cho khách này.</p>}
        </div>

        {c.proxy?.times > 0 && (
          <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Users size={15} className="text-violet-700" aria-hidden="true" />
            <span className="text-violet-950">
              Người này đã <b>đi mua hộ {n(c.proxy.times)} lần</b> cho {n(c.proxy.for_customers)} khách,
              tổng <b>{money(c.proxy.total)}</b>
            </span>
            {c.proxy.last_ts && <span className="text-2xs text-muted-ink">gần nhất {smartTime(c.proxy.last_ts)}</span>}
          </div>
        )}

        <div aria-labelledby="cp-top-h">
          <SectionTitle id="cp-top-h">Hàng hay mua</SectionTitle>
          {c.top_products?.length ? (
            <ul className="divide-y divide-line border border-line rounded">
              {c.top_products.map((p, i) => (
                <li key={i} className="flex items-center gap-2 px-2 py-1.5">
                  <span className="flex-1 min-w-0 truncate font-medium">{p.name}</span>
                  <span className="tabular text-muted-ink whitespace-nowrap">{fq(p.qty)} {p.unit_name}</span>
                  <span className="tabular w-28 text-right">{money(p.amount)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-muted-ink">Chưa có dữ liệu.</p>}
        </div>
      </section>
    </div>
  );
}

/* ========================= Tab 2: Lịch sử mua hàng ==================== */

function HistoryTab({ c, ledgerById, compact, onWarranty }) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(compact ? 10 : 20);
  const { data, busy, error, reload } = useFetch(
    () => api.get('/sales', { customer_id: c.id, page, page_size: size }), [c.id, page, size]);
  useLiveReload(reload);

  /* Không có quyền xem danh sách hoá đơn thì dùng 100 hoá đơn gần nhất kèm hồ sơ */
  const rows = data?.rows || (error ? c.sales : null);
  const total = data?.total ?? (error ? c.sales.length : 0);

  if (!rows) return busy ? <Spinner /> : null;
  if (!rows.length) return <Empty icon={Receipt} title="Khách chưa mua lần nào" />;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="data">
          <thead>
            <tr>
              <th>Mã hoá đơn</th><th>Ngày</th>
              <th className="text-right">Tổng tiền</th>
              <th className="text-right">Đã trả</th>
              <th>Trạng thái</th>
              <th>Giao hàng</th>
              <th>Thanh toán</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const st = payState(s, ledgerById.get(s.id));
              return (
                <tr key={s.id} className={`hoverable ${s.status === 'cancelled' ? 'opacity-55' : ''}`}>
                  <td>
                    <div className="flex flex-wrap items-center gap-1">
                      {compact
                        ? <span className="font-mono font-semibold">{s.code}</span>
                        : <Link to={`/sales?q=${encodeURIComponent(s.code)}`} className="font-mono font-semibold text-accent hover:underline">{s.code}</Link>}
                      {s.is_vat_invoice === 1 && <Badge tone="info">GTGT</Badge>}
                      <WarrantyFlag count={s.warranty_count} onClick={() => onWarranty(s)} />
                    </div>
                    {s.buyer_name && <div className="text-2xs text-muted-ink">Người mua hộ: {s.buyer_name}</div>}
                  </td>
                  <td className="text-muted-ink whitespace-nowrap">{datetime(s.ts)}</td>
                  <td className="num font-semibold">{money(s.total)}</td>
                  <td className="num">{money(s.paid)}</td>
                  <td><Badge tone={st.tone}>{st.label}</Badge></td>
                  <td>
                    {s.delivery_status
                      ? (
                        <div className="flex flex-col items-start gap-0.5">
                          <StepBadge status={s.delivery_status} size="sm" />
                          {s.cod_status && <CodBadge status={s.cod_status} size="sm" />}
                        </div>
                      )
                      : <span className="text-muted-ink">Tại quầy</span>}
                  </td>
                  <td className="text-muted-ink whitespace-nowrap">{PAYMENT_LABEL[s.payment_method] || s.payment_method}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {data && (
        <Pager
          page={page}
          pageSize={size}
          total={total}
          onPage={setPage}
          onPageSize={(v) => { setSize(v); setPage(1); }}
        />
      )}
    </>
  );
}

/* =========================== Tab 3: Sổ công nợ ======================== */

const Alert = ({ children }) => (
  <div role="status" className="rounded-lg border border-danger/30 bg-red-50 p-2.5 text-[13px] text-red-900 flex gap-2">
    <AlertTriangle size={15} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
    <div>{children}</div>
  </div>
);

function DebtTab({ c, ledger, onCollect, onSaved }) {
  const { user, access, toast } = useApp();
  const [limit, setLimit] = useState(c.debt_limit || 0);
  const [days, setDays] = useState(c.max_debt_days ?? '');
  const [saving, setSaving] = useState(false);
  const [needPin, setNeedPin] = useState(null);
  const [err, setErr] = useState('');

  /* Chỉ nạp lại ô nhập khi đổi sang khách khác: hồ sơ tự tải lại định kỳ,
     nạp theo mỗi lần tải thì đè mất số đang gõ dở */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setLimit(c.debt_limit || 0); setDays(c.max_debt_days ?? ''); setErr(''); }, [c.id]);

  const selfApprove = !user || canSelfApprove(user, access);
  const shopDays = c.shop_max_debt_days || 0;
  const maxDays = c.max_debt_days_effective || 0;
  const dirty = Math.round(Number(limit) || 0) !== (c.debt_limit || 0)
    || String(days ?? '') !== String(c.max_debt_days ?? '');

  const save = async (token) => {
    setSaving(true);
    setErr('');
    try {
      const res = await api.put(`/customers/${c.id}/credit`, {
        debt_limit: Math.max(0, Math.round(Number(limit) || 0)),
        max_debt_days: days === '' ? null : Number(days),
        ...(token ? { approval_token: token } : {}),
      });
      setNeedPin(null);
      setLimit(res.debt_limit || 0);
      setDays(res.max_debt_days ?? '');
      toast('Đã lưu hạn mức và số ngày nợ. Áp dụng ngay cho lần bán tiếp theo.', 'ok');
      onSaved?.();
    } catch (e) {
      if (e.needsApproval && !token) setNeedPin(e.message);
      else setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const invoices = (ledger?.invoices || []).filter((i) => i.remaining > 0);
  const receipts = (ledger?.rows || [])
    .filter((r) => ['receipt', 'refund', 'return_offset'].includes(r.kind))
    .slice(0, 15);
  const tone = c.over_limit || c.overdue_count > 0
    ? 'border-danger/30 bg-red-50'
    : c.debt > 0 ? 'border-amber-200 bg-amber-50/60' : 'border-line bg-muted/40';

  return (
    <div className="p-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-3">
        <div className={`rounded-lg border p-3 flex flex-wrap items-center gap-3 ${tone}`}>
          <div className="flex-1 min-w-[12rem]">
            <div className="text-2xs font-bold uppercase text-muted-ink">Tổng nợ hiện tại</div>
            <div className={`font-display font-bold text-3xl tabular ${c.debt > 0 ? 'text-warn' : ''}`} aria-live="polite">
              {money(c.debt)}
            </div>
            <div className="text-[13px] text-muted-ink mt-0.5">
              {c.unpaid_bills > 0 ? `${n(c.unpaid_bills)} hoá đơn chưa trả` : 'Không còn hoá đơn nào nợ'}
              {ledger?.opening_left > 0 && ` · nợ đầu kỳ còn ${money(ledger.opening_left)}`}
            </div>
          </div>
          <Button variant="primary" size="lg" icon={HandCoins} onClick={onCollect} disabled={!(c.debt > 0)}>
            Thu nợ
          </Button>
        </div>

        {c.over_limit && (
          <Alert>
            Khách đang nợ vượt hạn mức <b>{money(c.debt_limit)}</b>. Bán nợ thêm phải có mã PIN của quản lý.
          </Alert>
        )}
        {c.overdue_count > 0 && (
          <Alert>
            <b>{c.overdue_count} hoá đơn nợ quá {maxDays} ngày.</b> Khách mua tiếp phải trả đủ tiền, không bán nợ
            thêm cho tới khi trả xong hoá đơn quá hạn.
          </Alert>
        )}

        <div>
          <h3 className="text-[13px] font-bold mb-1.5">Hoá đơn còn nợ — cũ nhất trước</h3>
          {!ledger ? <Spinner /> : invoices.length === 0 ? (
            <p className="text-[13px] text-muted-ink">Không còn hoá đơn nào nợ.</p>
          ) : (
            <div className="overflow-x-auto border border-line rounded">
              <table className="data">
                <thead>
                  <tr>
                    <th>Mã HĐ</th><th>Ngày mua</th>
                    <th className="text-right">Tổng tiền</th>
                    <th className="text-right">Còn nợ</th>
                    <th className="text-right">Đã nợ</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => {
                    const late = maxDays > 0 && i.age_days > maxDays;
                    return (
                      <tr key={i.id} className={late ? 'bg-red-50/70' : ''}>
                        <td className="font-mono font-semibold">{i.code}</td>
                        <td className="text-muted-ink whitespace-nowrap">{date(i.ts)}</td>
                        <td className="num">{money(i.total)}</td>
                        <td className="num font-semibold text-warn">{money(i.remaining)}</td>
                        <td className="num whitespace-nowrap">
                          {late ? <Badge tone="bad">{i.age_days} ngày · quá hạn</Badge> : `${i.age_days} ngày`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h3 className="text-[13px] font-bold mb-1.5">Phiếu thu nợ gần đây</h3>
          {receipts.length === 0 ? (
            <p className="text-[13px] text-muted-ink">Chưa có phiếu thu nợ nào.</p>
          ) : (
            <div className="overflow-x-auto border border-line rounded">
              <table className="data">
                <thead>
                  <tr><th>Mã phiếu</th><th>Ngày</th><th>Hình thức</th><th className="text-right">Số tiền</th><th>Trừ vào</th></tr>
                </thead>
                <tbody>
                  {receipts.map((r) => (
                    <tr key={`${r.kind}${r.id}`}>
                      <td className="font-mono">{r.code}</td>
                      <td className="text-muted-ink whitespace-nowrap">{datetime(r.ts)}</td>
                      <td>{r.kind === 'return_offset' ? 'Trả hàng cấn trừ' : r.method || '—'}</td>
                      <td className={`num font-semibold ${r.kind === 'refund' ? 'text-danger' : 'text-emerald-700'}`}>
                        {r.kind === 'refund' ? '-' : '+'}{money(r.amount ?? r.total)}
                      </td>
                      <td className="text-muted-ink text-2xs">
                        {r.applied_to?.length ? r.applied_to.map((a) => `${a.code}: ${money(a.amount)}`).join(' · ') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <aside>
        <form
          className="card-pad space-y-3"
          onSubmit={(e) => { e.preventDefault(); if (dirty) save(); }}
          aria-labelledby="cp-credit-h"
        >
          <h3 id="cp-credit-h" className="text-[13px] font-bold flex items-center gap-1.5">
            <Wallet size={14} aria-hidden="true" /> Cấu hình công nợ
          </h3>
          <Field label="Hạn mức nợ tối đa" hint="0 = không giới hạn" htmlFor="cp-limit">
            <MoneyInput id="cp-limit" value={limit} onChange={setLimit} />
          </Field>
          <Field
            label="Số ngày nợ tối đa"
            hint={`Để trống = theo tiệm (${shopDays > 0 ? `${shopDays} ngày` : 'tiệm chưa giới hạn'}). Ghi 0 = khách này không giới hạn.`}
            htmlFor="cp-days"
          >
            <Input
              id="cp-days"
              type="number"
              min="0"
              inputMode="numeric"
              value={days}
              placeholder={shopDays > 0 ? `Theo tiệm: ${shopDays}` : 'Theo tiệm'}
              onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          {err && (
            <p role="alert" className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2">{err}</p>
          )}
          <Button type="submit" variant="primary" icon={selfApprove ? Save : KeyRound} className="w-full"
            loading={saving} disabled={!dirty}>
            {selfApprove ? 'Lưu cấu hình' : 'Lưu (cần PIN quản lý)'}
          </Button>
          <p className="text-2xs text-muted-ink leading-relaxed">
            Áp dụng ngay cho lần bán tiếp theo ở quầy. Thu ngân đổi hạn mức phải có mã PIN của chủ tiệm hoặc quản lý.
          </p>
        </form>
      </aside>

      <PinApprovalModal
        open={!!needPin}
        reason="Đổi hạn mức nợ / số ngày nợ của khách"
        detail={needPin}
        onClose={() => setNeedPin(null)}
        onApproved={(res) => save(res.token)}
      />
    </div>
  );
}
