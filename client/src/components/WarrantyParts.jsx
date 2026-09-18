/* ====================================================================
   BẢO HÀNH RIÊNG TỪNG BỘ PHẬN (plan 31, hạng mục 3e)

   Một mặt hàng có thể bảo hành mỗi bộ phận một khác: máy khoan pin thì
   Pin 7 ngày, Thân máy 6 tháng, Củ sạc 3 tháng. Khai trên mặt hàng, chốt
   hạn từng bộ phận vào hoá đơn lúc bán, in lên phiếu bảo hành, và lúc
   khách mang máy tới thì chọn đúng bộ phận hư để biết còn hạn hay không.
   ==================================================================== */
import { Plus, Trash2 } from 'lucide-react';
import { date } from '../lib/format';
import { Button, IconButton, Input, QtyInput, Select, Badge } from './ui';

/** "7 ngày", "6 tháng" */
export const partDuration = (p) => `${p.duration} ${p.unit === 'day' ? 'ngày' : 'tháng'}`;

/** Bảng khai bộ phận trong form mặt hàng. */
export function WarrantyPartsEditor({ value, onChange }) {
  const rows = Array.isArray(value) ? value : [];
  const patch = (i, p) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const add = () => onChange([...rows, { name: '', duration: 1, unit: 'month' }]);
  const remove = (i) => onChange(rows.filter((_, j) => j !== i));
  const longest = rows
    .filter((r) => String(r.name || '').trim() && Number(r.duration) > 0)
    .reduce((m, r) => Math.max(m, r.unit === 'day' ? Math.ceil(Number(r.duration) / 30) : Number(r.duration)), 0);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="label !mb-0">Bảo hành riêng từng bộ phận</span>
        <Button size="sm" variant="outline" icon={Plus} onClick={add}>Thêm bộ phận</Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-2xs text-muted-ink">
          Không khai thì cả sản phẩm bảo hành chung một hạn. Khai khi các bộ phận có hạn khác nhau,
          ví dụ máy khoan: Pin 7 ngày, Thân máy 6 tháng, Củ sạc 3 tháng.
        </p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {rows.map((r, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <Input size="sm" value={r.name} placeholder="Tên bộ phận: Pin, Thân máy…"
                  onChange={(e) => patch(i, { name: e.target.value })}
                  aria-label={`Tên bộ phận thứ ${i + 1}`} className="flex-1 min-w-0" />
                <QtyInput size="sm" value={r.duration} min={1} className="!w-20"
                  onChange={(v) => patch(i, { duration: Math.max(0, Math.round(Number(v) || 0)) })}
                  aria-label={`Thời hạn bảo hành ${r.name || `bộ phận thứ ${i + 1}`}`} />
                <Select size="sm" value={r.unit === 'day' ? 'day' : 'month'} className="!w-24"
                  onChange={(e) => patch(i, { unit: e.target.value })}
                  aria-label={`Đơn vị thời hạn ${r.name || `bộ phận thứ ${i + 1}`}`}>
                  <option value="day">ngày</option>
                  <option value="month">tháng</option>
                </Select>
                <IconButton icon={Trash2} size={14} label={`Bỏ bộ phận ${r.name || `thứ ${i + 1}`}`} onClick={() => remove(i)} />
              </li>
            ))}
          </ul>
          {longest > 0 && (
            <p className="text-2xs text-muted-ink">
              Bảo hành chung của sản phẩm sẽ tự nâng lên ít nhất <b>{longest} tháng</b> cho đủ phủ bộ phận lâu nhất.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Hạn từng bộ phận của một món đã bán — dùng ở tra cứu và chọn bộ phận hư. */
export function WarrantyPartsList({ parts, className = '' }) {
  if (!parts?.length) return null;
  return (
    <ul className={`text-2xs space-y-0.5 ${className}`}>
      {parts.map((p, i) => (
        <li key={i} className="flex flex-wrap items-center gap-1">
          <b>{p.name}</b>
          <span className="text-muted-ink">{partDuration(p)} · tới {date(p.until)}</span>
          {p.in_warranty === 1
            ? <Badge tone="ok">còn {p.days_left} ngày</Badge>
            : p.in_warranty === 0 ? <Badge tone="bad">hết hạn</Badge> : null}
        </li>
      ))}
    </ul>
  );
}
