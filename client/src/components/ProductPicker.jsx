/* ====================================================================
   HỘP CHỌN HÀNG HOÁ

   Dùng chung cho nhập hàng, kiểm kê, chuyển kho, trả hàng, bảo hành và
   khai định mức. Nằm ở đây chứ không nằm trong một trang cụ thể, để các
   trang khỏi phải nhập vòng vào nhau.

   Truyền onCreateRequest nếu muốn cho phép khai hàng mới ngay tại chỗ.
   Hộp chọn KHÔNG tự dựng bảng khai báo — nó chỉ báo ra ngoài là "người
   dùng muốn thêm hàng mới, tên đang gõ là đây". Nơi gọi tự lo phần khai
   báo. Làm vậy để hộp chọn khỏi phụ thuộc ngược vào bảng khai báo, mà
   bảng khai báo thì lại cần chính hộp chọn này để khai định mức.
   ==================================================================== */
import { useState, useMemo, useEffect } from 'react';
import { Search, Plus } from 'lucide-react';
import { useApp } from '../lib/store';
import { money, qty as fq, match } from '../lib/format';
import { Button, SearchInput, Select, Modal, Empty } from './ui';

export function ProductPicker({
  open, onClose, products, onPick, title = 'Chọn hàng hoá', onCreateRequest,
}) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const { meta } = useApp();

  useEffect(() => { if (open) setQ(''); }, [open]);

  const list = useMemo(() => {
    let l = products;
    if (cat) l = l.filter((p) => p.category_id === Number(cat));
    if (q.trim()) l = l.filter((p) => match(p.name, q) || match(p.sku, q) || (p.barcode || '').includes(q.trim()));
    return l.slice(0, 300);
  }, [products, q, cat]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle="Bấm vào dòng để thêm. Có thể chọn nhiều mặt hàng liên tiếp."
      size="lg"
      footer={
        <>
          {onCreateRequest && (
            <Button icon={Plus} onClick={() => onCreateRequest(q)}>Thêm hàng mới</Button>
          )}
          <div className="flex-1" />
          <Button variant="primary" onClick={onClose}>Xong</Button>
        </>
      }
    >
      <div className="space-y-2">
        <div className="flex gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Gõ tên hàng hoặc quét mã vạch..." className="flex-1" autoFocus />
          <Select value={cat} onChange={(e) => setCat(e.target.value)} className="!w-auto">
            <option value="">Mọi nhóm hàng</option>
            {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>

        {list.length === 0 ? (
          <Empty
            icon={Search}
            title="Không tìm thấy hàng nào"
            message={`Không có mặt hàng khớp "${q}". Nếu đây là hàng mới thì khai báo luôn.`}
            action={onCreateRequest && (
              <Button variant="primary" icon={Plus} onClick={() => onCreateRequest(q)}>
                Thêm "{q.trim().slice(0, 30)}" vào danh mục
              </Button>
            )}
          />
        ) : (
          <div className="table-wrap max-h-[50vh] overflow-y-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Mã hàng</th><th>Tên hàng</th><th>Nhóm</th>
                  <th className="text-right">Tồn kho</th>
                  <th className="text-right">Giá vốn</th>
                  <th style={{ width: 60 }} />
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className="hoverable clickable" onClick={() => onPick(p)}>
                    <td className="font-mono text-muted-ink">{p.sku}</td>
                    <td className="font-semibold">{p.name}</td>
                    <td className="text-muted-ink">{p.category_name || '—'}</td>
                    <td className="num">
                      {p.track_stock
                        ? <span className={p.stock <= 0 ? 'text-danger font-semibold' : ''}>
                            {fq(p.stock)} {p.base_unit}
                          </span>
                        : <span className="text-muted-ink">Dịch vụ</span>}
                    </td>
                    <td className="num">{money(p.cost_price)}</td>
                    <td>
                      <Button size="sm" variant="soft" onClick={(e) => { e.stopPropagation(); onPick(p); }}>
                        Thêm
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
