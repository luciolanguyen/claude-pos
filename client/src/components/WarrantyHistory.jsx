import { AlertTriangle, Wrench, ShieldCheck, User, Package, ArrowLeftRight, ClipboardList } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch } from '../lib/store';
import { money, datetime, date, qty as fq } from '../lib/format';
import { Modal, Button, Spinner, Empty, ErrorBox, Badge } from './ui';

/* Truy xuất bảo hành / sửa chữa (tài liệu 09, mục 6.1): hoá đơn hay mặt hàng
   nào từng vào tiệm thì gắn dấu, bấm vào ra dòng thời gian từng lần — ngày
   nhận, lỗi khách báo, kỹ thuật viên, linh kiện đã thay. Dùng chung cho màn
   hình hoá đơn, hồ sơ khách và bán hàng. */

export const WARRANTY_STATUS_LABEL = {
  received: 'Mới nhận', checking: 'Đang kiểm tra', repairing: 'Đang sửa',
  sent_supplier: 'Đã gửi hãng', ready: 'Xong, chờ khách lấy', delivered: 'Đã trả khách', cancelled: 'Huỷ',
};
export const RESOLUTION_LABEL = {
  repair: 'Tiệm tự sửa', supplier: 'Hãng/NCC sửa', exchange: 'Đổi cái mới',
  refund: 'Hoàn tiền', reject: 'Từ chối bảo hành',
};
export const TICKET_TYPE_LABEL = { warranty: 'Bảo hành', repair: 'Sửa chữa dịch vụ' };

/** Dấu "Đã từng BH/Sửa chữa". Không có lần nào thì không hiện gì. */
export function WarrantyFlag({ count, onClick, compact = false, className = '' }) {
  if (!(count > 0)) return null;
  const label = compact ? `BH/SC ${count}` : `Đã từng BH/Sửa chữa${count > 1 ? ` (${count})` : ''}`;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      aria-label={`Đã từng bảo hành hoặc sửa chữa ${count} lần, bấm để xem lịch sử`}
      className={`inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5
                  text-2xs font-semibold text-amber-900 whitespace-nowrap cursor-pointer
                  transition-colors duration-150 hover:bg-amber-100
                  focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-600 ${className}`}
    >
      <AlertTriangle size={11} aria-hidden="true" />
      {label}
    </button>
  );
}

/**
 * Dòng thời gian bảo hành / sửa chữa.
 * query: { sale_id, product_id } | { customer_id } | { serial }
 */
export function WarrantyHistoryModal({ open, onClose, query, title = 'Lịch sử bảo hành / sửa chữa', subtitle }) {
  const key = JSON.stringify(query || {});
  const { data, busy, error, reload } = useFetch(
    () => api.get('/warranty-history', query), [key], { skip: !open || !query });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      size="lg"
      footer={<Button onClick={onClose}>Đóng</Button>}
    >
      {busy && !data ? <Spinner />
        : error ? <ErrorBox error={error} onRetry={reload} />
          : !data?.length ? <Empty icon={ShieldCheck} title="Chưa từng bảo hành hay sửa chữa" />
            : (
              <ol className="relative border-l-2 border-line ml-2 space-y-4">
                {data.map((t) => <TimelineItem key={t.id} t={t} />)}
              </ol>
            )}
    </Modal>
  );
}

function TimelineItem({ t }) {
  const repair = t.ticket_type === 'repair';
  const parts = [
    ...(t.parts || []).map((p) => ({ ...p, custom: false })),
    ...(t.custom_parts || []).map((p) => ({ ...p, custom: true })),
  ];
  return (
    <li className="ml-4">
      <span
        className={`absolute -left-[9px] mt-1 w-4 h-4 rounded-full border-2 border-white
                    ${t.status === 'cancelled' ? 'bg-slate-300' : repair ? 'bg-sky-600' : 'bg-emerald-600'}`}
        aria-hidden="true"
      />
      <div className="card p-2.5 space-y-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold tabular text-[13px]">{datetime(t.ts)}</span>
          <span className="font-mono text-2xs text-muted-ink">{t.code}</span>
          <Badge tone={repair ? 'info' : 'ok'}>
            {repair ? <Wrench size={10} aria-hidden="true" /> : <ShieldCheck size={10} aria-hidden="true" />}
            {TICKET_TYPE_LABEL[t.ticket_type] || 'Bảo hành'}
          </Badge>
          <Badge tone={t.status === 'delivered' ? 'mute' : t.status === 'cancelled' ? 'bad' : 'warn'}>
            {WARRANTY_STATUS_LABEL[t.status] || t.status}
          </Badge>
          {t.sale_code && <span className="text-2xs text-muted-ink">HĐ {t.sale_code}</span>}
        </div>

        <div className="grid gap-1 sm:grid-cols-2 text-[13px]">
          <div className="sm:col-span-2">
            <span className="text-muted-ink">Lỗi khách báo: </span>
            <span className="font-semibold">{t.issue || '—'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <User size={13} className="text-muted-ink" aria-hidden="true" />
            <span className="text-muted-ink">Kỹ thuật viên:</span> {t.technician_name || '—'}
          </div>
          <div>
            <span className="text-muted-ink">Xử lý: </span>
            {RESOLUTION_LABEL[t.resolution] || 'Chưa quyết'}
            {t.delivered_at && <span className="text-muted-ink"> · trả khách {date(t.delivered_at)}</span>}
          </div>
        </div>

        {parts.length > 0 && (
          <div>
            <div className="text-2xs font-bold uppercase text-muted-ink mb-1 flex items-center gap-1">
              <Package size={11} aria-hidden="true" /> Linh kiện đã thay
            </div>
            <ul className="text-[13px] divide-y divide-line border border-line rounded">
              {parts.map((p, i) => (
                <li key={i} className="flex items-center gap-2 px-2 py-1">
                  <span className="flex-1 min-w-0 truncate">{p.name}</span>
                  {p.custom && <Badge tone="mute">Ngoài hệ thống</Badge>}
                  <span className="tabular text-muted-ink">× {fq(p.qty)}</span>
                  <span className="tabular w-24 text-right">{money(p.custom ? p.amount : p.amount_sale)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {t.exchange_product_name && (
          <div className="text-[13px] flex items-start gap-1.5 rounded bg-sky-50 border border-sky-200 p-2 text-sky-950">
            <ArrowLeftRight size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Đổi mới sang <b>{t.exchange_product_name}</b>
              {t.exchange_serial && <> (serial {t.exchange_serial})</>}
              {' — '}bảo hành {t.exchange_mode === 'reset' ? 'tính lại từ đầu' : 'kế thừa máy cũ'}
              {t.exchange_warranty_until && <> tới {date(t.exchange_warranty_until)}</>}
            </span>
          </div>
        )}

        {t.logs?.length > 0 && (
          <details className="text-[13px]">
            <summary className="cursor-pointer text-muted-ink hover:text-ink inline-flex items-center gap-1">
              <ClipboardList size={12} aria-hidden="true" /> Nhật ký {t.logs.length} bước
            </summary>
            <ul className="mt-1 space-y-0.5 pl-4 list-disc text-muted-ink">
              {t.logs.map((l, i) => (
                <li key={i}>
                  <span className="tabular">{datetime(l.ts)}</span> · {WARRANTY_STATUS_LABEL[l.status] || l.status}
                  {l.user_name && <> · {l.user_name}</>}
                  {l.note && <> — <span className="text-ink">{l.note}</span></>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </li>
  );
}
