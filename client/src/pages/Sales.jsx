import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Receipt, Printer, Undo2, XCircle, Eye, Filter, Download, ShoppingCart, HandCoins,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, usePaged, useDebounced, fetchAllPages } from '../lib/store';
import { money, n, short, qty as fq, datetime, date, isoDate, range, RANGES, PAYMENT_LABEL } from '../lib/format';
import {
  Button, IconButton, SearchInput, Select, Modal, Spinner, Empty, ErrorBox,
  Badge, Confirm, Field, MoneyInput, Textarea, Stat, Pager,
} from '../components/ui';
import { PageHeader, Page } from '../components/Layout';
import InvoicePrint from '../components/InvoicePrint';
import SaleReturnForm from '../components/SaleReturnForm';

export default function Sales() {
  const { store, settings, toast, meta, user } = useApp();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const dq = useDebounced(q, 300);
  const [rangeKey, setRangeKey] = useState('day30');
  const [method, setMethod] = useState('');
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);

  const r = useMemo(() => range(rangeKey), [rangeKey]);
  const filters = useMemo(() => ({
    q: dq, from: r.from, to: r.to, payment_method: method, unpaid: onlyUnpaid ? 1 : '',
  }), [dq, r.from, r.to, method, onlyUnpaid]);

  const {
    rows: data, extra, total: rowCount, busy, error, reload,
    page, setPage, pageSize, setPageSize,
  } = usePaged((pg) => api.sales({ ...filters, ...pg }), [filters], { key: 'sales' });

  const [detail, setDetail] = useState(null);
  const [printing, setPrinting] = useState(null);
  const [returning, setReturning] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [paying, setPaying] = useState(null);
  const [busyAction, setBusyAction] = useState(false);

  /* Số tổng do máy chủ tính trên CẢ bộ lọc. Nếu cộng từ data thì phân trang
     xong chỉ còn cộng đúng một trang, mà sai kiểu đó rất khó nhận ra. */
  const totals = extra?.totals || null;

  const openDetail = async (id) => {
    try { setDetail(await api.sale(id)); }
    catch (e) { toast(e.message, 'bad'); }
  };

  const doCancel = async () => {
    setBusyAction(true);
    try {
      await api.post(`/sales/${cancelling.id}/cancel`);
      toast(`Đã huỷ hoá đơn ${cancelling.code}, hàng đã nhập lại kho.`, 'ok');
      setCancelling(null);
      setDetail(null);
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
          <Button icon={Download} onClick={exportCsv} disabled={!rowCount}>Xuất Excel</Button>
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
            placeholder="Tìm mã hoá đơn, tên khách, số điện thoại..."
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
              <div className="card">
              <div className="table-wrap table-scroll !border-0 !rounded-none">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Mã hoá đơn</th>
                      <th>Thời gian</th>
                      <th>Khách hàng</th>
                      <th className="text-right">Số mặt</th>
                      <th className="text-right">Tổng tiền</th>
                      <th className="text-right">Đã trả</th>
                      <th className="text-right">Còn nợ</th>
                      <th>Thanh toán</th>
                      <th>Thu ngân</th>
                      <th className="text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((s) => (
                      <tr key={s.id} className={`hoverable ${s.status === 'cancelled' ? 'opacity-55' : ''}`}>
                        <td>
                          <button
                            onClick={() => openDetail(s.id)}
                            className="font-mono font-semibold text-accent hover:underline cursor-pointer"
                          >
                            {s.code}
                          </button>
                          {s.is_vat_invoice === 1 && <Badge tone="info" className="ml-1">GTGT</Badge>}
                          {s.status === 'cancelled' && <Badge tone="bad" className="ml-1">Đã huỷ</Badge>}
                        </td>
                        <td className="whitespace-nowrap text-muted-ink">{datetime(s.ts)}</td>
                        <td>
                          <div className="truncate max-w-[180px]">{s.customer_name || 'Khách lẻ'}</div>
                          {s.customer_phone && <div className="text-2xs text-muted-ink">{s.customer_phone}</div>}
                        </td>
                        <td className="num">{s.item_count}</td>
                        <td className="num font-semibold">{money(s.total)}</td>
                        <td className="num">{money(s.paid)}</td>
                        <td className={`num ${s.remaining > 0 ? 'text-danger font-semibold' : 'text-muted-ink'}`}>
                          {s.remaining > 0 ? money(s.remaining) : '—'}
                        </td>
                        <td>
                          <Badge tone={s.payment_method === 'debt' ? 'warn' : 'mute'}>
                            {PAYMENT_LABEL[s.payment_method] || s.payment_method}
                          </Badge>
                        </td>
                        <td className="text-muted-ink truncate max-w-[110px]">{s.user_name || '—'}</td>
                        <td>
                          <div className="flex items-center justify-end gap-0.5">
                            <IconButton icon={Eye} label={`Xem chi tiết ${s.code}`} onClick={() => openDetail(s.id)} size={14} />
                            <IconButton
                              icon={Printer}
                              label={`In hoá đơn ${s.code}`}
                              onClick={async () => setPrinting(await api.sale(s.id))}
                              size={14}
                            />
                            {s.status === 'done' && s.remaining > 0 && (
                              <IconButton
                                icon={HandCoins}
                                label={`Thu tiền hoá đơn ${s.code}`}
                                onClick={() => setPaying(s)}
                                size={14}
                                className="!text-warn"
                              />
                            )}
                            {s.status === 'done' && (
                              <IconButton
                                icon={Undo2}
                                label={`Nhận trả hàng cho ${s.code}`}
                                onClick={async () => setReturning(await api.sale(s.id))}
                                size={14}
                              />
                            )}
                          </div>
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
            )}
      </Page>

      {/* -------------------------- Chi tiết hoá đơn ------------------------- */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `Hoá đơn ${detail.code}` : ''}
        subtitle={detail ? `${datetime(detail.ts)} · ${detail.user_name || ''}` : ''}
        size="lg"
        footer={detail && <>
          {detail.status === 'done' && (
            <Button variant="danger" icon={XCircle} onClick={() => setCancelling(detail)}>
              Huỷ hoá đơn
            </Button>
          )}
          <div className="flex-1" />
          <Button onClick={() => setDetail(null)}>Đóng</Button>
          <Button variant="primary" icon={Printer} onClick={() => { setPrinting(detail); setDetail(null); }}>
            In hoá đơn
          </Button>
        </>}
      >
        {detail && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 text-[13px]">
              <div className="card p-2.5">
                <div className="text-2xs font-bold text-muted-ink uppercase mb-1">Khách hàng</div>
                <div className="font-semibold">{detail.customer_name || 'Khách lẻ'}</div>
                {detail.customer_phone && <div className="text-muted-ink">{detail.customer_phone}</div>}
                {detail.customer_address && <div className="text-muted-ink">{detail.customer_address}</div>}
                {detail.customer_tax_code && <div className="text-muted-ink">MST: {detail.customer_tax_code}</div>}
              </div>
              <div className="card p-2.5">
                <div className="text-2xs font-bold text-muted-ink uppercase mb-1">Thông tin đơn</div>
                <div>Kho xuất: {detail.warehouse_name}</div>
                <div>Bảng giá: {detail.price_list_name || 'Giá lẻ'}</div>
                <div>Thanh toán: {PAYMENT_LABEL[detail.payment_method]}</div>
                {detail.is_vat_invoice === 1 && <Badge tone="info">Có hoá đơn GTGT</Badge>}
              </div>
            </div>

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

            <div className="flex justify-end">
              <div className="w-full sm:w-72 space-y-1 text-[13px]">
                <div className="flex justify-between"><span className="text-muted-ink">Tiền hàng</span><span className="tabular font-mono">{money(detail.subtotal)}</span></div>
                {detail.discount > 0 && <div className="flex justify-between"><span className="text-muted-ink">Giảm giá</span><span className="tabular font-mono">-{money(detail.discount)}</span></div>}
                {detail.vat_amount > 0 && <div className="flex justify-between"><span className="text-muted-ink">Thuế GTGT</span><span className="tabular font-mono">{money(detail.vat_amount)}</span></div>}
                <div className="flex justify-between pt-1.5 border-t border-line font-bold text-base">
                  <span>Tổng cộng</span><span className="tabular font-mono text-accent">{money(detail.total)}</span>
                </div>
                <div className="flex justify-between"><span className="text-muted-ink">Đã thanh toán</span><span className="tabular font-mono">{money(detail.paid)}</span></div>
                {detail.total - detail.paid > 0 && (
                  <div className="flex justify-between font-semibold text-danger">
                    <span>Còn nợ</span><span className="tabular font-mono">{money(detail.total - detail.paid)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1.5 border-t border-line text-muted-ink">
                  <span>Giá vốn</span><span className="tabular font-mono">{money(detail.cogs)}</span>
                </div>
                <div className="flex justify-between font-semibold text-emerald-700">
                  <span>Lợi nhuận</span>
                  <span className="tabular font-mono">{money(detail.total - detail.vat_amount - detail.cogs)}</span>
                </div>
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
        )}
      </Modal>

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

      {printing && (
        <InvoicePrint
          sale={printing}
          store={store}
          invoice={settings?.invoice || {}}
          onClose={() => setPrinting(null)}
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
