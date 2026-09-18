import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Receipt, Printer, Undo2, XCircle, Filter, Download, ShoppingCart, HandCoins,
  ShieldCheck, Handshake, ArrowLeft, ClipboardList, Pencil,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, usePaged, useDebounced, fetchAllPages, useSearchMode } from '../lib/store';
import { money, n, short, qty as fq, datetime, date, isoDate, range, RANGES, PAYMENT_LABEL } from '../lib/format';
import {
  Button, IconButton, SearchInput, Select, Modal, Spinner, Empty, ErrorBox,
  Badge, Confirm, Field, MoneyInput, Textarea, Stat, Pager, PermGate,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import InvoicePrint from '../components/InvoicePrint';
import SaleReturnForm from '../components/SaleReturnForm';
import { WarrantyFlag, WarrantyHistoryModal } from '../components/WarrantyHistory';
import WarrantyCardPrint, { warrantyItemsOf } from '../components/WarrantyCardPrint';
import PickingSlipPrint from '../components/PickingSlipPrint';
import ConsignFixModal from '../components/ConsignFixModal';

export default function Sales() {
  const { store, settings, toast, meta, user } = useApp();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const dq = useDebounced(q, 300);
  const [rangeKey, setRangeKey] = useState('day30');
  const [method, setMethod] = useState('');
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);

  const r = useMemo(() => range(rangeKey), [rangeKey]);
  const [mode, setMode] = useSearchMode();
  const filters = useMemo(() => ({
    q: dq, match: mode, from: r.from, to: r.to, payment_method: method, unpaid: onlyUnpaid ? 1 : '',
  }), [dq, mode, r.from, r.to, method, onlyUnpaid]);

  const {
    rows: data, extra, total: rowCount, busy, error, reload,
    page, setPage, pageSize, setPageSize,
  } = usePaged((pg) => api.sales({ ...filters, ...pg }), [filters], { key: 'sales' });

  const [detail, setDetail] = useState(null);
  const [selId, setSelId] = useState(null);       // hoá đơn đang xem ở khung phải
  const [wHistory, setWHistory] = useState(null);   // dòng thời gian bảo hành đang xem
  const [printing, setPrinting] = useState(null);
  const [warrantyCard, setWarrantyCard] = useState(null);   // in lại phiếu bảo hành
  const [pickSlip, setPickSlip] = useState(null);           // phiếu soạn hàng cho nhân viên
  const [fixConsign, setFixConsign] = useState(null);       // khai lại hoa hồng / giá bốc
  const [returning, setReturning] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [paying, setPaying] = useState(null);
  const [busyAction, setBusyAction] = useState(false);

  /* Số tổng do máy chủ tính trên CẢ bộ lọc. Nếu cộng từ data thì phân trang
     xong chỉ còn cộng đúng một trang, mà sai kiểu đó rất khó nhận ra. */
  const totals = extra?.totals || null;

  const openDetail = async (id) => {
    setSelId(id);
    try { setDetail(await api.sale(id)); }
    catch (e) { toast(e.message, 'bad'); }
  };
  const closeDetail = () => { setSelId(null); setDetail(null); };

  const doCancel = async () => {
    setBusyAction(true);
    try {
      await api.post(`/sales/${cancelling.id}/cancel`);
      toast(`Đã huỷ hoá đơn ${cancelling.code}, hàng đã nhập lại kho.`, 'ok');
      setCancelling(null);
      closeDetail();
      reload();
    } catch (e) {
      toast(e.message, 'bad', 6000);
    } finally {
      setBusyAction(false);
    }
  };

  const exportCsv = async () => {
    if (!rowCount) return;
    // Xuất toàn bộ kết quả lọc, không phải mỗi trang đang xem
    const allRows = await fetchAllPages((pg) => api.sales({ ...filters, ...pg }));
    const head = ['Mã HĐ', 'Ngày', 'Khách hàng', 'Số ĐT', 'Thu ngân', 'Tổng tiền', 'Đã trả', 'Còn nợ', 'Thanh toán', 'Trạng thái'];
    const rows = allRows.map((s) => [
      s.code, datetime(s.ts), s.customer_name || 'Khách lẻ', s.customer_phone || '',
      s.user_name || '', s.total, s.paid, s.remaining,
      PAYMENT_LABEL[s.payment_method] || s.payment_method,
      s.status === 'done' ? 'Hoàn tất' : 'Đã huỷ',
    ]);
    const csv = '﻿' + [head, ...rows]
      .map((r2) => r2.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `hoadon-${r.from}-${r.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Đã tải file ${allRows.length} hoá đơn`, 'ok');
  };

  return (
    <>
      <PageHeader
        title="Hoá đơn bán hàng"
        subtitle={`${r.label} · ${date(r.from)} — ${date(r.to)}`}
        actions={<>
          <PermGate perm="data.export">
            <Button icon={Download} onClick={exportCsv} disabled={!rowCount}>Xuất Excel</Button>
          </PermGate>
          <Link to="/pos" className="btn btn-primary btn-touch">
            <ShoppingCart size={16} aria-hidden="true" />
            Bán hàng
          </Link>
        </>}
      >
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={q}
            onChange={(v) => { setQ(v); setParams(v ? { q: v } : {}); }}
            mode={mode}
            onMode={setMode}
            placeholder="Tìm mã hoá đơn, tên / SĐT khách hoặc người mua hộ..."
            className="w-full sm:w-80"
          />
          <Select value={rangeKey} onChange={(e) => setRangeKey(e.target.value)} size="sm" className="!w-auto">
            {RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <Select value={method} onChange={(e) => setMethod(e.target.value)} size="sm" className="!w-auto">
            <option value="">Mọi hình thức TT</option>
            {Object.entries(PAYMENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          <button
            onClick={() => setOnlyUnpaid((v) => !v)}
            className={`btn btn-sm ${onlyUnpaid ? 'btn-secondary' : 'btn-outline'}`}
          >
            <Filter size={13} aria-hidden="true" />
            Chỉ đơn còn nợ
          </button>
        </div>
      </PageHeader>

      <Page className="space-y-3">
        {totals && (
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
            <Stat label="Số hoá đơn" value={n(totals.count)} />
            <Stat label="Doanh thu" value={short(totals.revenue)} tone="good" />
            <Stat label="Lợi nhuận gộp" value={short(totals.profit)} />
            <Stat label="Khách còn nợ" value={short(totals.unpaid)} tone={totals.unpaid > 0 ? 'warn' : 'default'} />
          </div>
        )}

        {busy && !data ? <Spinner />
          : error ? <ErrorBox error={error} onRetry={reload} />
            : !data?.length ? (
              <Empty
                icon={Receipt}
                title="Không có hoá đơn nào"
                message={q ? `Không tìm thấy hoá đơn khớp "${q}" trong khoảng thời gian này.` : 'Chưa phát sinh hoá đơn trong khoảng thời gian đã chọn.'}
              />
            ) : (
              /* Hai khung: danh sách bên trái, chi tiết hoá đơn bên phải (BRD mục 3) —
                 cùng một mẫu với màn hình "Hoá đơn trong ngày" ở quầy. */
              <div className="grid gap-3 lg:grid-cols-[minmax(340px,520px)_1fr] lg:items-start">
              <div className={`card ${selId ? 'hidden lg:block' : ''}`}>
              <div className="table-wrap table-scroll !border-0 !rounded-none">
                <table className="data">
                  <thead>
                    <tr>
                      {/* Giờ bán nằm ngay dưới mã: khung danh sách hẹp, bớt một cột là đủ chỗ cho tiền */}
                      <th>Mã hoá đơn · giờ</th>
                      <th>Khách hàng</th>
                      <th className="text-right">Tổng tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((s) => (
                      <tr key={s.id}
                        onClick={() => openDetail(s.id)}
                        aria-current={selId === s.id}
                        className={`hoverable clickable ${s.status === 'cancelled' ? 'opacity-55' : ''}
                                    ${selId === s.id ? 'bg-accent-soft/60' : ''}`}>
                        <td>
                          <span className="font-mono font-semibold text-accent whitespace-nowrap">{s.code}</span>
                          {s.is_vat_invoice === 1 && <Badge tone="info" className="ml-1">GTGT</Badge>}
                          {s.status === 'cancelled' && <Badge tone="bad" className="ml-1">Đã huỷ</Badge>}
                          <WarrantyFlag count={s.warranty_count} compact className="ml-1"
                            onClick={() => setWHistory({ query: { sale_id: s.id }, subtitle: `Hoá đơn ${s.code}` })} />
                          {/* Hoá đơn có hàng bán giùm chủ vãng lai (plan 31,
                              hạng mục 4d): tiền gộp chung vào tổng nhưng lãi
                              chỉ là phần hoa hồng — phải phân biệt được. */}
                          {s.consign_count > 0 && (
                            <span
                              title={`${s.consign_count} món mua hộ · ${money(s.consign_amount)}`
                                /* Hoa hồng là lãi của tiệm: máy chủ không gửi cho người không xem được giá vốn */
                                + (s.consign_commission !== undefined ? ` · hoa hồng ${money(s.consign_commission)}` : '')}
                              className="ml-1 inline-flex items-center gap-0.5 rounded border
                                         border-violet-300 bg-violet-50 px-1 text-2xs
                                         font-semibold text-violet-800"
                            >
                              <Handshake size={10} aria-hidden="true" />
                              Mua hộ {s.consign_count}
                            </span>
                          )}
                          <span className="block text-2xs text-muted-ink">
                            <span className="whitespace-nowrap">{datetime(s.ts)}</span>{s.user_name ? ` · ${s.user_name}` : ''}
                          </span>
                        </td>
                        <td>
                          <div className="truncate max-w-[180px]">{s.customer_name || 'Khách lẻ'}</div>
                          {s.customer_phone && <div className="text-2xs text-muted-ink">{s.customer_phone}</div>}
                          {s.buyer_name && (
                            <div className="text-2xs text-violet-700 truncate max-w-[180px]">
                              Mua hộ: {s.buyer_name}{s.buyer_phone ? ` · ${s.buyer_phone}` : ''}
                            </div>
                          )}
                        </td>
                        <td className="num font-semibold whitespace-nowrap">
                          {money(s.total)}
                          <span className="block text-2xs font-normal text-muted-ink">
                            {s.item_count + (s.consign_count || 0)} món · {PAYMENT_LABEL[s.payment_method] || s.payment_method}
                          </span>
                          {/* Còn nợ gộp vào đây (chữ đỏ) thay cho một cột riêng */}
                          {s.remaining > 0 && (
                            <span className="block text-2xs text-danger">Nợ {money(s.remaining)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
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

              {/* --------------------- Chi tiết hoá đơn đang chọn -------------------- */}
              <div className={`card p-3 ${selId ? '' : 'hidden lg:block'}`}>
                {!selId ? (
                  <Empty icon={Receipt} title="Chưa chọn hoá đơn"
                    message="Bấm một hoá đơn bên trái để xem chi tiết, in lại, thu tiền hay nhận trả hàng." />
                ) : !detail ? <Spinner label="Đang mở hoá đơn..." /> : (
                  <SaleDetail
                    detail={detail}
                    onBack={closeDetail}
                    onPrint={() => setPrinting(detail)}
                    onPay={() => setPaying(detail)}
                    onReturn={() => setReturning(detail)}
                    onCancel={() => setCancelling(detail)}
                    onPickSlip={() => setPickSlip(detail)}
                    onFixConsign={(item) => setFixConsign({ sale: detail, item })}
                    onWarrantyCard={() => {
                      if (!warrantyItemsOf(detail).length) {
                        toast(`Hoá đơn ${detail.code} không có món nào bảo hành.`, 'warn');
                        return;
                      }
                      setWarrantyCard(detail);
                    }}
                    onHistory={(query, subtitle) => setWHistory({ query, subtitle })}
                  />
                )}
              </div>
              </div>
            )}
      </Page>

      {/* --------------------------- Thu tiền nợ --------------------------- */}
      <PayModal
        sale={paying}
        accounts={meta.accounts}
        onClose={() => setPaying(null)}
        onDone={() => { setPaying(null); reload(); }}
      />

      <Confirm
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        onConfirm={doCancel}
        busy={busyAction}
        title="Huỷ hoá đơn này?"
        confirmText="Huỷ hoá đơn"
        message={cancelling && (
          <>
            Hoá đơn <b className="font-mono">{cancelling.code}</b> trị giá{' '}
            <b>{money(cancelling.total)}</b> sẽ bị huỷ.
            <br /><br />
            Toàn bộ hàng trên hoá đơn sẽ được <b>nhập trả lại kho</b>, và số tiền đã thu{' '}
            <b>{money(cancelling.paid)}</b> sẽ được ghi phiếu chi hoàn lại quỹ.
            <br /><br />
            Thao tác này không hoàn tác được.
          </>
        )}
      />

      <WarrantyHistoryModal
        open={!!wHistory}
        onClose={() => setWHistory(null)}
        query={wHistory?.query}
        subtitle={wHistory?.subtitle}
      />

      {printing && (
        <InvoicePrint
          sale={printing}
          store={store}
          invoice={settings?.invoice || {}}
          onClose={() => setPrinting(null)}
        />
      )}

      {warrantyCard && (
        <WarrantyCardPrint
          sale={warrantyCard}
          store={store}
          onClose={() => setWarrantyCard(null)}
        />
      )}

      {/* Phiếu soạn hàng in lại: không giá tiền, có vị trí kệ (BRD nâng cấp, mục 3) */}
      {pickSlip && (
        <PickingSlipPrint sale={pickSlip} store={store} onClose={() => setPickSlip(null)} />
      )}

      {/* Quản lý khai lại hoa hồng / giá bốc sau khi hoá đơn xong (BRD mục 5) */}
      {fixConsign && (
        <ConsignFixModal
          sale={fixConsign.sale}
          item={fixConsign.item}
          onClose={() => setFixConsign(null)}
          onSaved={async () => {
            setFixConsign(null);
            try { setDetail(await api.sale(selId)); } catch { /* mở lại sau */ }
            reload();
          }}
        />
      )}

      {returning && (
        <SaleReturnForm
          sale={returning}
          user={user}
          accounts={meta.accounts}
          onClose={() => setReturning(null)}
          onDone={(code) => {
            setReturning(null);
            reload();
            toast(`Đã lập phiếu trả hàng ${code}`, 'ok');
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------- */

function PayModal({ sale, accounts, onClose, onDone }) {
  const [amount, setAmount] = useState(0);
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (sale) {
      setAmount(sale.remaining);
      setAccountId(accounts[0]?.id || '');
      setNote('');
      setErr('');
    }
  }, [sale, accounts]);

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.post(`/sales/${sale.id}/pay`, { amount, account_id: accountId, note });
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!sale}
      onClose={onClose}
      title="Thu tiền nợ hoá đơn"
      subtitle={sale ? `${sale.code} · ${sale.customer_name || 'Khách lẻ'}` : ''}
      size="sm"
      footer={<>
        <Button onClick={onClose}>Huỷ</Button>
        <Button variant="primary" onClick={submit} loading={busy}>Lập phiếu thu</Button>
      </>}
    >
      {sale && (
        <div className="space-y-3">
          <div className="card p-2.5 text-[13px] space-y-0.5">
            <div className="flex justify-between"><span className="text-muted-ink">Tổng hoá đơn</span><span className="tabular font-mono">{money(sale.total)}</span></div>
            <div className="flex justify-between"><span className="text-muted-ink">Đã trả</span><span className="tabular font-mono">{money(sale.paid)}</span></div>
            <div className="flex justify-between font-bold text-danger"><span>Còn nợ</span><span className="tabular font-mono">{money(sale.remaining)}</span></div>
          </div>

          <Field label="Số tiền thu" required htmlFor="pay-amt">
            <MoneyInput id="pay-amt" size="lg" value={amount} onChange={setAmount} autoFocus />
          </Field>

          <Field label="Nộp vào quỹ" htmlFor="pay-acc">
            <Select id="pay-acc" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>

          <Field label="Ghi chú" htmlFor="pay-note">
            <Textarea id="pay-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          {err && <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">{err}</p>}
        </div>
      )}
    </Modal>
  );
}

/* ==================================================================== *
 * CHI TIẾT MỘT HOÁ ĐƠN — khung bên phải (BRD nâng cấp, mục 3)
 *
 * Trước đây là hộp thoại che cả bảng; giờ nằm cạnh danh sách để vừa dò
 * hoá đơn vừa xem nội dung. Hàng mua hộ tách thành khối riêng: tiền gộp
 * chung vào tổng, nhưng phải nhìn ra món nào của tiệm, món nào mua giùm.
 * ==================================================================== */
function SaleDetail({
  detail, onBack, onPrint, onPay, onReturn, onCancel, onWarrantyCard, onPickSlip, onFixConsign, onHistory,
}) {
  const { can } = useApp();
  const consign = detail.consign_items || [];
  const owed = detail.total - detail.paid;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <Button size="sm" className="lg:hidden" icon={ArrowLeft} onClick={onBack}>Danh sách</Button>
        {/* Khung chi tiết hẹp thì hàng nút rớt xuống dòng dưới, đừng ép mã hoá đơn gãy chữ */}
        <div className="min-w-[14rem] flex-1">
          <div className="font-bold">
            Hoá đơn <span className="font-mono whitespace-nowrap">{detail.code}</span>
            {detail.is_vat_invoice === 1 && <Badge tone="info" className="ml-1">GTGT</Badge>}
            {detail.status === 'cancelled' && <Badge tone="bad" className="ml-1">Đã huỷ</Badge>}
          </div>
          <div className="text-2xs text-muted-ink">{datetime(detail.ts)} · {detail.user_name || ''}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" icon={Printer} onClick={onPrint}>In hoá đơn</Button>
          <Button size="sm" icon={ClipboardList} onClick={onPickSlip}>Phiếu soạn hàng</Button>
          <Button size="sm" icon={ShieldCheck} className="!text-emerald-700" onClick={onWarrantyCard}>Phiếu bảo hành</Button>
          {detail.status === 'done' && owed > 0 && (
            <Button size="sm" icon={HandCoins} onClick={onPay}>Thu tiền</Button>
          )}
          {detail.status === 'done' && <Button size="sm" icon={Undo2} onClick={onReturn}>Trả hàng</Button>}
          {detail.status === 'done' && (
            <Button size="sm" variant="danger" icon={XCircle} onClick={onCancel}>Huỷ</Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 text-[13px]">
        <div className="card p-2.5">
          <div className="text-2xs font-bold text-muted-ink uppercase mb-1">Khách hàng</div>
          <div className="font-semibold">{detail.customer_name || 'Khách lẻ'}</div>
          {detail.customer_phone && <div className="text-muted-ink">{detail.customer_phone}</div>}
          {detail.buyer_name && (
            <div className="text-violet-700 mt-0.5">
              Người mua hộ: <b>{detail.buyer_name}</b>{detail.buyer_phone ? ` · ${detail.buyer_phone}` : ''}
            </div>
          )}
          {detail.customer_address && <div className="text-muted-ink">{detail.customer_address}</div>}
          {detail.customer_tax_code && <div className="text-muted-ink">MST: {detail.customer_tax_code}</div>}
        </div>
        <div className="card p-2.5">
          <div className="text-2xs font-bold text-muted-ink uppercase mb-1">Thông tin đơn</div>
          <div>Kho xuất: {detail.warehouse_name}</div>
          <div>Bảng giá: {detail.price_list_name || 'Giá lẻ'}</div>
          <div>Thanh toán: {PAYMENT_LABEL[detail.payment_method]}</div>
          {detail.cod_amount > 0 && (
            <div>
              Thu hộ COD: {money(detail.cod_amount)}
              {detail.cod_status === 'collected' ? ' — đã đối soát' : detail.cod_status === 'pending' ? ' — chờ đối soát' : ''}
            </div>
          )}
          {detail.voucher_amount > 0 && <div>Trừ phiếu đổi hàng: {money(detail.voucher_amount)}</div>}
          {detail.salary_amount > 0 && (
            <div>
              Trừ vào lương <b>{detail.salary_employee_name || 'nhân viên'}</b>: {money(detail.salary_amount)}
              {detail.salary_refunded > 0 ? ` (đã hoàn vào lương ${money(detail.salary_refunded)})` : ''}
            </div>
          )}
          {detail.approval_note && (
            <div className="text-2xs text-muted-ink">Quản lý đã duyệt: {detail.approval_note}</div>
          )}
        </div>
      </div>

      {/* Hoá đơn chỉ có hàng mua hộ thì khỏi hiện bảng hàng tiệm trống trơn */}
      {(detail.items.length > 0 || consign.length === 0) && (
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Tên hàng</th>
              <th>ĐVT</th>
              <th className="text-right">SL</th>
              <th className="text-right">Đơn giá</th>
              <th className="text-right">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {detail.items.map((it) => (
              <tr key={it.id}>
                <td>
                  <div className="font-semibold">{it.name_snapshot}</div>
                  <div className="text-2xs text-muted-ink font-mono">{it.sku}</div>
                  {(it.warranty_months > 0 || it.serial || it.warranty_count > 0) && (
                    <div className="flex flex-wrap items-center gap-1 mt-0.5">
                      {it.warranty_months > 0 && (
                        <Badge tone="ok">BH {it.warranty_months} tháng{it.warranty_until ? ` · tới ${date(it.warranty_until)}` : ''}</Badge>
                      )}
                      {it.serial && <span className="text-2xs text-muted-ink font-mono">SN {it.serial}</span>}
                      <WarrantyFlag count={it.warranty_count}
                        onClick={() => onHistory({ sale_id: detail.id, product_id: it.product_id }, `${it.name_snapshot} · ${detail.code}`)} />
                    </div>
                  )}
                </td>
                <td>{it.unit_name}</td>
                <td className="num">{fq(it.qty)}</td>
                <td className="num">{money(it.price)}</td>
                <td className="num font-semibold">{money(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {/* Hàng mua hộ trong hoá đơn (BRD nâng cấp, mục 3) */}
      {consign.length > 0 && (
        <div className="table-wrap border-violet-200">
          <div className="px-2.5 py-1.5 bg-violet-50 border-b border-violet-200 text-2xs font-bold text-violet-900
                          flex items-center gap-1.5">
            <Handshake size={12} aria-hidden="true" /> Hàng mua hộ ({n(consign.length)} món)
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Tên món</th>
                <th>ĐVT</th>
                <th className="text-right">SL</th>
                <th className="text-right">Đơn giá</th>
                <th className="text-right">Thành tiền</th>
              </tr>
            </thead>
            <tbody>
              {consign.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="font-semibold flex items-center gap-1.5">
                      {c.name}
                      {/* Thu ngân bán xong mà chưa ai khai hoa hồng / giá bốc (BRD mục 5) */}
                      {c.needs_review === 1 && <Badge tone="warn">Chờ khai hoa hồng</Badge>}
                    </div>
                    <div className="text-2xs text-violet-800">
                      {c.partner_name ? `Hàng gửi của ${c.partner_name}` : 'Tiệm tự bốc ngoài'}
                      {c.settlement_code ? ` · đã đối soát ${c.settlement_code}` : c.partner_name ? ' · chờ đối soát' : ''}
                      {/* Hoa hồng và tiền phải trả chủ hàng chỉ hiện với người xem được giá vốn */}
                      {c.commission !== undefined && ` · hoa hồng ${money(c.commission)}`}
                      {c.payable !== undefined && ` · trả chủ ${money(c.payable)}`}
                    </div>
                    {c.note && <div className="text-2xs text-muted-ink italic">{c.note}</div>}
                    {can('cost.view') && !c.settlement_code && detail.status === 'done' && (
                      <Button size="sm" variant="ghost" className="!px-1 mt-0.5" icon={Pencil}
                        onClick={() => onFixConsign(c)}>
                        {c.partner_name ? 'Khai lại hoa hồng' : 'Khai giá tiệm bốc'}
                      </Button>
                    )}
                  </td>
                  <td>{c.unit_name || '—'}</td>
                  <td className="num">{fq(c.qty)}</td>
                  <td className="num">{money(c.price)}</td>
                  <td className="num font-semibold">{money(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-end">
        <div className="w-full sm:w-72 space-y-1 text-[13px]">
          <div className="flex justify-between"><span className="text-muted-ink">Tiền hàng</span><span className="tabular font-mono">{money(detail.subtotal)}</span></div>
          {detail.discount > 0 && <div className="flex justify-between"><span className="text-muted-ink">Giảm giá</span><span className="tabular font-mono">-{money(detail.discount)}</span></div>}
          {detail.vat_amount > 0 && <div className="flex justify-between"><span className="text-muted-ink">Thuế GTGT</span><span className="tabular font-mono">{money(detail.vat_amount)}</span></div>}
          <div className="flex justify-between pt-1.5 border-t border-line font-bold text-base">
            <span>Tổng cộng</span><span className="tabular font-mono text-accent">{money(detail.total)}</span>
          </div>
          <div className="flex justify-between"><span className="text-muted-ink">Đã thanh toán</span><span className="tabular font-mono">{money(detail.paid)}</span></div>
          {owed > 0 && (
            <div className="flex justify-between font-semibold text-danger">
              <span>Còn nợ</span><span className="tabular font-mono">{money(owed)}</span>
            </div>
          )}
          {/* Không có quyền xem giá vốn thì máy chủ không gửi cogs — đừng hiện
              "Giá vốn 0 đ" và "Lợi nhuận NaN" cho nhân viên (plan 31, 1.1d) */}
          {detail.cogs !== undefined && (
            <>
              <div className="flex justify-between pt-1.5 border-t border-line text-muted-ink">
                <span>Giá vốn</span><span className="tabular font-mono">{money(detail.cogs)}</span>
              </div>
              <div className="flex justify-between font-semibold text-emerald-700">
                <span>Lợi nhuận</span>
                <span className="tabular font-mono">{money(detail.total - detail.vat_amount - detail.cogs)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {detail.note && (
        <div className="card p-2.5 text-[13px]">
          <span className="font-semibold">Ghi chú: </span>{detail.note}
        </div>
      )}

      {detail.returns?.length > 0 && (
        <div className="card p-2.5">
          <div className="text-2xs font-bold text-muted-ink uppercase mb-1.5">Phiếu trả hàng liên quan</div>
          {detail.returns.map((rt) => (
            <div key={rt.id} className="flex justify-between text-[13px] py-0.5">
              <span className="font-mono">{rt.code} · {date(rt.ts)}</span>
              <span className="tabular font-mono">{money(rt.total)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
