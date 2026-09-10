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
import { Button, SearchInput, Select, Modal, Empty, QtyInput } from './ui';
import { CategorySelect, categoryBranch } from './CategoryTree';

/**
 * @param withQty  cho gõ số lượng ngay trên dòng (mặc định có). Chỗ nào
 *                 chỉ chọn đúng MỘT mặt hàng (ví dụ chọn máy để lập phiếu
 *                 bảo hành) thì truyền false — ở đó số lượng vô nghĩa.
 */
export function ProductPicker({
  open, onClose, products, onPick, title = 'Chọn hàng hoá', onCreateRequest,
  withQty = true,
}) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  /* Số lượng đang gõ cho từng dòng, theo id mặt hàng. Chưa gõ thì coi là 1. */
  const [qtys, setQtys] = useState({});
  const { meta } = useApp();

  useEffect(() => { if (open) { setQ(''); setQtys({}); } }, [open]);

  const qtyOf = (id) => {
    const v = qtys[id];
    return v === undefined || v === null || v === '' ? 1 : Number(v);
  };
  const take = (p) => {
    const n = qtyOf(p.id);
    onPick(p, n > 0 ? n : 1);
    /* Trả ô về 1 sau khi thêm: để nguyên số cũ thì bấm nhầm lần nữa là
       nhân đôi số lượng mà không ai để ý. */
    setQtys((m) => ({ ...m, [p.id]: 1 }));
  };

  const list = useMemo(() => {
    let l = products;
    if (cat) {
      const branch = categoryBranch(meta.categories, cat);
      if (branch) l = l.filter((p) => branch.has(p.category_id));
    }
    if (q.trim()) l = l.filter((p) => match(p.name, q) || match(p.sku, q) || (p.barcode || '').includes(q.trim()));
    return l.slice(0, 300);
  }, [products, q, cat, meta.categories]);

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
          <CategorySelect value={cat} onChange={setCat} categories={meta.categories}
            className="!w-auto" ariaLabel="Lọc theo nhóm hàng" />
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
                  {withQty && <th style={{ width: 104 }} className="text-right">Số lượng</th>}
                  <th style={{ width: 76 }} />
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className="hoverable clickable" onClick={() => take(p)}>
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
                    {withQty && (
                      /* Bấm vào ô số lượng KHÔNG được tính là bấm vào dòng,
                         nếu không thì vừa chạm vào ô đã thêm mất một dòng. */
                      <td onClick={(e) => e.stopPropagation()}>
                        <QtyInput
                          value={qtyOf(p.id)}
                          min={1}
                          onChange={(v) => setQtys((m) => ({ ...m, [p.id]: v }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); take(p); } }}
                          aria-label={`Số lượng ${p.name}`}
                        />
                      </td>
                    )}
                    <td>
                      <Button size="sm" variant="soft" onClick={(e) => { e.stopPropagation(); take(p); }}>
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
