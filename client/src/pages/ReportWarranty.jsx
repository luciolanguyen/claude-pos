import { useState, useMemo } from 'react';
import {
  Download, PhoneCall, Clock, AlertTriangle, Wrench, ShieldCheck, Truck, PackageCheck,
} from 'lucide-react';
import { api } from '../lib/api';
import { useFetch } from '../lib/store';
import { money, n, short, date, datetime, pct } from '../lib/format';
import { Button, Spinner, Empty, ErrorBox, Stat, Badge, Tabs } from '../components/ui';

const STATUS_LABEL = {
  received: 'Mới nhận', checking: 'Đang kiểm tra', repairing: 'Đang sửa',
  sent_supplier: 'Đã gửi hãng', ready: 'Xong, chờ lấy',
  delivered: 'Đã trả khách', cancelled: 'Đã huỷ',
};
const RESOLUTION_LABEL = {
  repair: 'Tiệm tự sửa', supplier: 'Hãng/NCC sửa', exchange: 'Đổi cái mới',
  refund: 'Hoàn tiền', reject: 'Từ chối bảo hành', chua_quyet: 'Chưa quyết',
};

function downloadCsv(name, head, rows) {
  const csv = '﻿' + [head, ...rows]
    .map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function ReportWarranty({ r }) {
  const [view, setView] = useState('waiting');
  const { data, busy, error, reload } = useFetch(
    () => api.get('/reports/warranty', { from: r.from, to: r.to }), [r.from, r.to]
  );

  if (busy && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const t = data.totals;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-5">
        <Stat label="Chờ khách tới lấy" value={n(t.waiting)} icon={PhoneCall}
          tone={t.waiting > 0 ? 'warn' : 'default'} sub="Cần gọi báo khách" />
        <Stat label="Đang xử lý" value={n(t.open)} icon={Wrench} />
        <Stat label="Quá hẹn trả" value={n(t.late)} icon={AlertTriangle}
          tone={t.late > 0 ? 'bad' : 'default'} />
        <Stat label="Đã trả trong kỳ" value={n(t.done)} icon={PackageCheck}
          sub={t.avg_days > 0 ? `Trung bình ${t.avg_days} ngày/ca` : ''} />
        <Stat label="Thu tiền sửa" value={short(t.paid)}
          sub={`Vốn linh kiện ${short(t.parts)}`} tone="good" />
      </div>

      {/* Danh sách cần gọi khách — thay cho việc nhắn tin tự động */}
      {data.waiting.length > 0 && (
        <div className="card p-3 bg-accent-soft/40 border-accent/25">
          <div className="flex gap-2.5">
            <PhoneCall size={17} className="text-emerald-800 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-emerald-900 text-[13px]">
                {data.waiting.length} món đã sửa xong, gọi báo khách tới lấy
              </p>
              <p className="text-2xs text-emerald-900/75 mt-0.5">
                Bấm vào số điện thoại để gọi luôn nếu mở trên điện thoại.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          value={view}
          onChange={setView}
          className="!border-b-0 flex-1"
          tabs={[
            { key: 'waiting', label: 'Chờ khách lấy', count: data.waiting.length },
            { key: 'open', label: 'Đang xử lý', count: data.open.length },
            { key: 'done', label: 'Đã trả khách', count: data.done.length },
            { key: 'product', label: 'Hàng hay hỏng', count: data.by_product.length },
          ]}
        />
        <Button size="sm" icon={Download}
          onClick={() => {
            if (view === 'waiting') {
              downloadCsv(`bao-hanh-cho-lay-${r.to}.csv`,
                ['Mã phiếu', 'Ngày nhận', 'Khách hàng', 'Điện thoại', 'Hàng hoá', 'Serial', 'Hẹn trả', 'Tiền thu', 'Đã thu', 'Số ngày'],
                data.waiting.map((x) => [x.code, date(x.ts), x.customer_display, x.phone_display,
                  x.product_name, x.serial || '', x.promised_at ? date(x.promised_at) : '',
                  x.charge, x.paid, x.days_open]));
            } else if (view === 'open') {
              downloadCsv(`bao-hanh-dang-xu-ly-${r.to}.csv`,
                ['Mã phiếu', 'Ngày nhận', 'Khách hàng', 'Điện thoại', 'Hàng hoá', 'Trạng thái', 'Hẹn trả', 'Trễ (ngày)', 'Đã nhận (ngày)'],
                data.open.map((x) => [x.code, date(x.ts), x.customer_display, x.phone_display,
                  x.product_name, STATUS_LABEL[x.status], x.promised_at ? date(x.promised_at) : '',
                  x.days_late > 0 ? x.days_late : '', x.days_open]));
            } else if (view === 'done') {
              downloadCsv(`bao-hanh-da-tra-${r.from}-${r.to}.csv`,
                ['Mã phiếu', 'Ngày nhận', 'Ngày trả', 'Khách hàng', 'Hàng hoá', 'Xử lý', 'Còn BH', 'Tiền công', 'Vốn linh kiện', 'Thu khách', 'Lãi', 'Số ngày'],
                data.done.map((x) => [x.code, date(x.ts), date(x.delivered_at), x.customer_display,
                  x.product_name, RESOLUTION_LABEL[x.resolution] || '', x.in_warranty ? 'Có' : 'Không',
                  x.labor_fee, x.parts_cost, x.charge, x.profit, x.days_taken]));
            } else {
              downloadCsv(`bao-hanh-theo-mat-hang-${r.from}-${r.to}.csv`,
                ['Tên hàng', 'Số lần hỏng', 'Trong đó còn BH', 'Vốn linh kiện', 'Thu khách'],
                data.by_product.map((x) => [x.product_name, x.n, x.in_warranty_count, x.parts_cost, x.charge]));
            }
          }}>
          Xuất Excel
        </Button>
      </div>

      {view === 'waiting' && (
        data.waiting.length === 0
          ? <Empty icon={PackageCheck} title="Không có món nào chờ khách lấy"
              message="Khi sửa xong và chuyển trạng thái sang Xong chờ khách lấy, phiếu sẽ hiện ở đây." />
          : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Mã phiếu</th><th>Khách hàng</th><th>Điện thoại</th><th>Hàng hoá</th>
                    <th>Nhận ngày</th><th>Hẹn trả</th>
                    <th className="text-right">Tiền thu</th>
                    <th className="text-right">Đã ở tiệm</th>
                  </tr>
                </thead>
                <tbody>
                  {data.waiting.map((x) => (
                    <tr key={x.id} className="hoverable">
                      <td className="font-mono font-semibold">{x.code}</td>
                      <td>{x.customer_display || '—'}</td>
                      <td>
                        {x.phone_display
                          ? <a href={`tel:${x.phone_display}`}
                              className="text-accent hover:underline tabular inline-flex items-center gap-1">
                              <PhoneCall size={11} aria-hidden="true" />{x.phone_display}
                            </a>
                          : <span className="text-muted-ink">—</span>}
                      </td>
                      <td>
                        <div className="font-semibold">{x.product_name}</div>
                        {x.serial && <div className="text-2xs text-muted-ink font-mono">SN {x.serial}</div>}
                      </td>
                      <td className="text-muted-ink whitespace-nowrap">{date(x.ts)}</td>
                      <td className="text-muted-ink whitespace-nowrap">
                        {x.promised_at ? date(x.promised_at) : '—'}
                      </td>
                      <td className="num">{x.charge > 0 ? money(x.charge) : 'Miễn phí'}</td>
                      <td className={`num ${x.days_open > 30 ? 'text-danger font-semibold' : ''}`}>
                        {x.days_open} ngày
                        {x.days_open > 30 && <div className="text-2xs">quá 30 ngày</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      )}

      {view === 'open' && (
        data.open.length === 0
          ? <Empty icon={ShieldCheck} title="Không có phiếu nào đang xử lý" />
          : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Mã phiếu</th><th>Khách hàng</th><th>Hàng hoá</th><th>Trạng thái</th>
                    <th>Nơi gửi</th><th>Hẹn trả</th>
                    <th className="text-right">Đã nhận</th>
                  </tr>
                </thead>
                <tbody>
                  {data.open.map((x) => (
                    <tr key={x.id} className={`hoverable ${x.days_late > 0 ? 'bg-red-50' : ''}`}>
                      <td className="font-mono font-semibold">{x.code}</td>
                      <td>
                        <div>{x.customer_display || '—'}</div>
                        {x.phone_display && (
                          <div className="text-2xs text-muted-ink tabular">{x.phone_display}</div>
                        )}
                      </td>
                      <td className="font-semibold">{x.product_name}</td>
                      <td><Badge tone={x.status === 'ready' ? 'ok' : 'info'}>{STATUS_LABEL[x.status]}</Badge></td>
                      <td className="text-muted-ink">
                        {x.supplier_name
                          ? <><Truck size={10} className="inline mr-1" aria-hidden="true" />{x.supplier_name}
                              {x.sent_at && <div className="text-2xs">gửi {date(x.sent_at)}</div>}</>
                          : '—'}
                      </td>
                      <td className={x.days_late > 0 ? 'text-danger font-semibold' : 'text-muted-ink'}>
                        {x.promised_at ? date(x.promised_at) : '—'}
                        {x.days_late > 0 && <div className="text-2xs">trễ {x.days_late} ngày</div>}
                      </td>
                      <td className="num">{x.days_open} ngày</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
      )}

      {view === 'done' && (
        data.done.length === 0
          ? <Empty icon={PackageCheck} title="Chưa trả phiếu nào trong kỳ này" />
          : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Mã phiếu</th><th>Ngày trả</th><th>Khách hàng</th><th>Hàng hoá</th>
                    <th>Cách xử lý</th><th>Bảo hành</th>
                    <th className="text-right">Vốn linh kiện</th>
                    <th className="text-right">Thu khách</th>
                    <th className="text-right">Lãi</th>
                    <th className="text-right">Số ngày</th>
                  </tr>
                </thead>
                <tbody>
                  {data.done.map((x) => (
                    <tr key={x.id} className="hoverable">
                      <td className="font-mono font-semibold">{x.code}</td>
                      <td className="text-muted-ink whitespace-nowrap">{date(x.delivered_at)}</td>
                      <td className="truncate max-w-[150px]">{x.customer_display || '—'}</td>
                      <td className="font-semibold truncate max-w-[180px]">{x.product_name}</td>
                      <td className="text-muted-ink">{RESOLUTION_LABEL[x.resolution] || '—'}</td>
                      <td>
                        {x.in_warranty === 1
                          ? <Badge tone="ok">Còn BH</Badge>
                          : <span className="text-muted-ink text-2xs">Hết hạn</span>}
                      </td>
                      <td className="num text-muted-ink">{x.parts_cost > 0 ? money(x.parts_cost) : '—'}</td>
                      <td className="num">{x.charge > 0 ? money(x.charge) : 'Miễn phí'}</td>
                      <td className={`num font-semibold ${x.profit < 0 ? 'text-danger' : 'text-emerald-700'}`}>
                        {money(x.profit)}
                      </td>
                      <td className="num">{x.days_taken ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={6} className="text-right">TỔNG CỘNG</td>
                    <td className="num">{money(t.parts)}</td>
                    <td className="num">{money(t.charge)}</td>
                    <td className="num text-emerald-700">{money(t.charge - t.parts)}</td>
                    <td className="num">{t.avg_days} TB</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )
      )}

      {view === 'product' && (
        data.by_product.length === 0
          ? <Empty icon={Wrench} title="Chưa có dữ liệu bảo hành trong kỳ" />
          : (
            <>
              <p className="text-[13px] text-muted-ink">
                Mặt hàng hỏng nhiều lần thì nên xem lại có nên tiếp tục nhập hay không,
                hoặc đổi mối lấy hàng.
              </p>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Tên hàng</th>
                      <th className="text-right">Số lần hỏng</th>
                      <th className="text-right">Trong đó còn BH</th>
                      <th className="text-right">Vốn linh kiện đã thay</th>
                      <th className="text-right">Thu của khách</th>
                      <th className="text-right">Tiệm chịu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_product.map((x, i) => (
                      <tr key={i} className="hoverable">
                        <td className="font-semibold">{x.product_name}</td>
                        <td className="num">
                          {x.n}
                          {x.n >= 3 && <Badge tone="warn" className="ml-1">hay hỏng</Badge>}
                        </td>
                        <td className="num text-muted-ink">{x.in_warranty_count}</td>
                        <td className="num">{money(x.parts_cost)}</td>
                        <td className="num">{money(x.charge)}</td>
                        <td className={`num ${x.parts_cost - x.charge > 0 ? 'text-danger font-semibold' : 'text-muted-ink'}`}>
                          {x.parts_cost - x.charge > 0 ? money(x.parts_cost - x.charge) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
      )}
    </div>
  );
}
