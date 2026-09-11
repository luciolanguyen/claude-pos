/* ====================================================================
   NHÓM HÀNG NHIỀU CẤP

   Xếp hàng hoá theo hình cây: Ngành hàng › Nhóm › Phân nhóm. Không bắt
   mọi ngành phải đủ ba cấp — dịch vụ thì một cấp là xong, quần áo thì
   ba cấp mới đủ.

   Hàng hoá luôn gán vào nhóm NHỎ NHẤT của nhánh. Nhưng lọc theo nhóm
   cha thì vẫn phải ra hết hàng nằm ở nhóm con cháu, nếu không thì chọn
   "Điện tử" mà thấy trống trơn, người ta tưởng tiệm không bán món nào.
   Việc gộp đó làm ở máy chủ.

   Xoá nhóm còn con hoặc còn hàng thì chặn lại và mở sẵn hộp dọn dẹp —
   xoá xong mới phát hiện mất cả nhánh thì không lấy lại được.
   ==================================================================== */
import { useState, useMemo } from 'react';
import {
  Layers, Plus, Pencil, Trash2, ChevronRight, ChevronDown, CornerDownRight,
  AlertTriangle, FolderTree, PackageSearch, Ban,
} from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch } from '../lib/store';
import { n } from '../lib/format';
import {
  Button, IconButton, Input, Select, Modal, Spinner, Empty, ErrorBox, Badge,
} from './ui';

/** Cấp sâu nhất cho phép thêm nữa. Tài liệu yêu cầu tối thiểu 3 cấp. */
const MAX_LEVEL = 4;

/**
 * Id của một nhóm và mọi nhóm con cháu của nó.
 *
 * Máy chủ đã gộp cây khi lọc, nhưng màn hình bán hàng và hộp chọn hàng
 * lọc ngay trên danh sách tải sẵn nên cần gộp lại ở đây. Trả về Set để
 * chỗ gọi chỉ việc hỏi .has(p.category_id).
 */
export function categoryBranch(categories, rootId) {
  const id = Number(rootId);
  if (!id) return null;                 // không lọc thì khỏi gom
  const kids = new Map();
  for (const c of categories || []) {
    const k = c.parent_id || 0;
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(c.id);
  }
  const out = new Set([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const ch of kids.get(cur) || []) {
      if (out.has(ch)) continue;        // chặn vòng lặp nếu dữ liệu hỏng
      out.add(ch);
      stack.push(ch);
    }
  }
  return out;
}

/** Dựng cây từ danh sách phẳng máy chủ trả về. */
export function buildTree(flat) {
  const byId = new Map((flat || []).map((c) => [c.id, { ...c, children: [] }]));
  const roots = [];
  for (const c of byId.values()) {
    const p = c.parent_id ? byId.get(c.parent_id) : null;
    if (p && p.id !== c.id) p.children.push(c);
    else roots.push(c);
  }
  return roots;
}

export default function CategoryTree({ open, onClose, onChanged }) {
  const { toast } = useApp();
  const { data, busy, error, reload } = useFetch(() => api.categories(), [], { skip: !open });
  const [addingTo, setAddingTo] = useState(undefined);  // undefined = không mở ô nào; null = thêm cấp 1
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [blocked, setBlocked] = useState(null);   // nhóm không xoá được + lý do

  const roots = useMemo(() => buildTree(data), [data]);
  const byId = useMemo(() => new Map((data || []).map((x) => [x.id, x])), [data]);

  /** Nhóm cha gần nhất đang đặt "không nhận đổi trả" — nhóm con thừa hưởng cờ đó. */
  const inheritedNoReturn = (c) => {
    let p = c.parent_id ? byId.get(c.parent_id) : null;
    let guard = 0;
    while (p && guard++ < 50) {
      if (p.no_return) return p.name;
      p = p.parent_id ? byId.get(p.parent_id) : null;
    }
    return null;
  };

  const done = () => { reload(); onChanged?.(); };

  const add = async (parentId) => {
    if (!newName.trim()) return;
    try {
      await api.post('/categories', {
        name: newName.trim(), parent_id: parentId,
        sort_order: (data?.filter((c) => (c.parent_id || null) === parentId).length || 0),
      });
      setNewName('');
      setAddingTo(undefined);
      done();
    } catch (e) { toast(e.message, 'bad', 6000); }
  };

  const save = async (c) => {
    if (!editName.trim()) return;
    try {
      await api.put(`/categories/${c.id}`, {
        name: editName.trim(), parent_id: c.parent_id, sort_order: c.sort_order,
      });
      setEditId(null);
      done();
    } catch (e) { toast(e.message, 'bad', 6000); }
  };

  const remove = async (c) => {
    try {
      await api.del(`/categories/${c.id}`);
      toast(`Đã xoá nhóm "${c.name}"`, 'ok');
      done();
    } catch (e) {
      /* Máy chủ chặn vì còn con hoặc còn hàng — mở luôn hộp dọn dẹp thay
         vì chỉ báo lỗi rồi để người dùng tự mò đi tìm chỗ dọn. */
      if (e.code === 'CATEGORY_NOT_EMPTY') setBlocked({ category: c, message: e.message });
      else toast(e.message, 'bad', 6000);
    }
  };

  /* Bật / tắt "không nhận đổi trả" (tài liệu 02). Đặt ở nhóm cha thì mọi
     nhóm con cháu cũng không nhận — hàng tặng, hàng cắt theo mét, hàng đặt riêng. */
  const toggleNoReturn = async (c) => {
    try {
      await api.put(`/categories/${c.id}`, {
        name: c.name, parent_id: c.parent_id, sort_order: c.sort_order, no_return: c.no_return ? 0 : 1,
      });
      toast(c.no_return ? `Nhóm "${c.name}" nhận đổi trả trở lại` : `Nhóm "${c.name}" không nhận đổi trả nữa`, 'ok');
      done();
    } catch (e) { toast(e.message, 'bad', 6000); }
  };

  const toggle = (id) => setCollapsed((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const renderNode = (c) => {
    const isOpen = !collapsed.has(c.id);
    const kids = c.children || [];
    return (
      <li key={c.id}>
        <div
          className="flex items-center gap-1.5 px-1.5 py-1 rounded hover:bg-muted group"
          style={{ paddingLeft: `${(c.level - 1) * 18 + 6}px` }}
        >
          {kids.length > 0 ? (
            <button
              onClick={() => toggle(c.id)}
              className="shrink-0 text-muted-ink hover:text-ink cursor-pointer"
              aria-label={isOpen ? `Thu gọn ${c.name}` : `Mở rộng ${c.name}`}
              aria-expanded={isOpen}
            >
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="w-[14px] shrink-0" aria-hidden="true" />
          )}

          {editId === c.id ? (
            <>
              <Input size="sm" value={editName} onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save(c);
                  if (e.key === 'Escape') setEditId(null);
                }}
                autoFocus aria-label="Sửa tên nhóm hàng" />
              <Button size="sm" variant="primary" onClick={() => save(c)}>Lưu</Button>
              <Button size="sm" onClick={() => setEditId(null)}>Huỷ</Button>
            </>
          ) : (
            <>
              <span className={`flex-1 min-w-0 text-[13px] truncate ${c.level === 1 ? 'font-bold' : 'font-medium'}`}>
                {c.name}
                {c.no_return ? (
                  <Badge tone="warn" className="ml-1.5">Không nhận đổi trả</Badge>
                ) : inheritedNoReturn(c) ? (
                  <span className="ml-1.5 text-2xs font-normal text-amber-700">không đổi trả (theo nhóm cha)</span>
                ) : null}
              </span>

              {/* Số hàng: nhóm cha hiện số gộp cả nhánh, vì hàng thường nằm
                  ở nhóm lá — hiện 0 thì tưởng cả ngành hàng trống. */}
              <span className="text-2xs text-muted-ink whitespace-nowrap">
                {kids.length > 0 && c.product_count_tree !== c.product_count
                  ? `${n(c.product_count_tree)} cả nhánh`
                  : `${n(c.product_count)} mặt hàng`}
              </span>

              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                {c.level < MAX_LEVEL && (
                  <IconButton icon={CornerDownRight} size={13}
                    label={`Thêm nhóm con trong ${c.name}`}
                    onClick={() => { setAddingTo(c.id); setNewName(''); setCollapsed((s) => { const x = new Set(s); x.delete(c.id); return x; }); }} />
                )}
                <IconButton icon={Ban} size={13}
                  label={c.no_return ? `Cho nhóm ${c.name} nhận đổi trả trở lại` : `Đặt nhóm ${c.name} không nhận đổi trả`}
                  className={c.no_return ? '!text-warn' : ''}
                  onClick={() => toggleNoReturn(c)} />
                <IconButton icon={Pencil} size={13} label={`Đổi tên ${c.name}`}
                  onClick={() => { setEditId(c.id); setEditName(c.name); }} />
                <IconButton icon={Trash2} size={13} label={`Xoá nhóm ${c.name}`}
                  className="!text-danger hover:!bg-red-50" onClick={() => remove(c)} />
              </div>
            </>
          )}
        </div>

        {/* Ô thêm nhóm con, hiện ngay dưới nhóm cha cho khỏi lạc chỗ */}
        {addingTo === c.id && (
          <div className="flex items-center gap-1.5 py-1"
            style={{ paddingLeft: `${c.level * 18 + 20}px` }}>
            <CornerDownRight size={13} className="text-muted-ink shrink-0" aria-hidden="true" />
            <Input size="sm" value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add(c.id);
                if (e.key === 'Escape') setAddingTo(undefined);
              }}
              placeholder={`Nhóm con của "${c.name}"...`} autoFocus
              aria-label={`Tên nhóm con của ${c.name}`} />
            <Button size="sm" variant="primary" onClick={() => add(c.id)} disabled={!newName.trim()}>
              Thêm
            </Button>
            <Button size="sm" onClick={() => setAddingTo(undefined)}>Huỷ</Button>
          </div>
        )}

        {isOpen && kids.length > 0 && <ul>{kids.map(renderNode)}</ul>}
      </li>
    );
  };

  if (!open) return null;

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title="Nhóm hàng hoá"
        subtitle="Xếp theo cấp: Ngành hàng › Nhóm › Phân nhóm. Không bắt buộc đủ ba cấp."
        size="lg"
        footer={
          <>
            <span className="mr-auto text-2xs text-muted-ink hidden sm:block">
              Hàng hoá gán vào nhóm nhỏ nhất; lọc theo nhóm cha vẫn ra đủ hàng của nhóm con.
            </span>
            <Button variant="primary" onClick={onClose}>Xong</Button>
          </>
        }
      >
        <div className="space-y-2.5">
          {error && <ErrorBox error={error} onRetry={reload} />}

          <div className="flex gap-2">
            <Input
              value={addingTo === null ? newName : ''}
              onChange={(e) => { setAddingTo(null); setNewName(e.target.value); }}
              onKeyDown={(e) => e.key === 'Enter' && add(null)}
              placeholder="Tên ngành hàng mới (cấp 1)..."
              aria-label="Tên ngành hàng mới"
            />
            <Button variant="primary" icon={Plus}
              onClick={() => add(null)} disabled={addingTo !== null || !newName.trim()}>
              Thêm ngành hàng
            </Button>
          </div>

          {busy && !data ? <Spinner />
            : !roots.length ? (
              <Empty icon={FolderTree} title="Chưa có nhóm hàng nào"
                message="Thêm ngành hàng ở ô trên, rồi bấm mũi tên bên phải mỗi dòng để thêm nhóm con." />
            ) : (
              <div className="border border-line rounded-lg py-1 max-h-[52vh] overflow-y-auto">
                <ul>{roots.map(renderNode)}</ul>
              </div>
            )}
        </div>
      </Modal>

      {blocked && (
        <MoveContents
          category={blocked.category}
          message={blocked.message}
          all={data || []}
          onClose={() => setBlocked(null)}
          onDone={() => { setBlocked(null); done(); }}
        />
      )}
    </>
  );
}

/* ==================================================================== */

/**
 * Dọn nhóm trước khi xoá.
 *
 * Không tự động xoá theo kiểu "xoá luôn cả nhánh": mất cả trăm mặt hàng
 * khỏi nhóm chỉ vì một cú bấm là không sửa lại được. Bắt chọn chỗ chuyển
 * tới, rồi mới cho xoá.
 */
function MoveContents({ category, message, all, onClose, onDone }) {
  const { toast } = useApp();
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  /* Không cho chọn chính nó hoặc con cháu của nó làm chỗ chuyển tới —
     chuyển vào nhánh sắp xoá thì dọn xong vẫn không xoá được. */
  const descendants = useMemo(() => {
    const kids = new Map();
    for (const c of all) {
      const k = c.parent_id || 0;
      if (!kids.has(k)) kids.set(k, []);
      kids.get(k).push(c.id);
    }
    const out = new Set([category.id]);
    const stack = [category.id];
    while (stack.length) {
      const cur = stack.pop();
      for (const ch of kids.get(cur) || []) {
        if (out.has(ch)) continue;
        out.add(ch);
        stack.push(ch);
      }
    }
    return out;
  }, [all, category.id]);

  const options = all.filter((c) => !descendants.has(c.id));

  const run = async () => {
    setBusy(true); setErr('');
    try {
      const res = await api.post(`/categories/${category.id}/move-contents`, {
        to_category_id: to || null, move_children: true,
      });
      await api.del(`/categories/${category.id}`);
      toast(
        `Đã chuyển ${n(res.moved_products)} mặt hàng`
        + (res.moved_children ? ` và ${n(res.moved_children)} nhóm con` : '')
        + ` rồi xoá nhóm "${category.name}"`,
        'ok', 6000);
      onDone();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Dọn nhóm "${category.name}" trước khi xoá`}
      size="md"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Để nguyên</Button>
          <Button variant="danger" icon={Trash2} loading={busy} onClick={run} disabled={busy}>
            Chuyển rồi xoá nhóm
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {err && <ErrorBox error={err} title="Chưa dọn được" />}

        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[13px] text-amber-900">
          <div className="flex items-start gap-1.5">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
            <div>{message}</div>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="move-to">Chuyển hàng hoá và nhóm con sang</label>
          <Select id="move-to" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">— Không thuộc nhóm nào —</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>{c.path || c.name}</option>
            ))}
          </Select>
          <div className="text-xs text-muted-ink mt-1 flex items-start gap-1">
            <PackageSearch size={13} className="shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              Để trống thì hàng hoá thành &ldquo;chưa phân nhóm&rdquo; — vẫn bán và tìm
              được bình thường, chỉ là không lọc theo nhóm được nữa.
            </span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ==================================================================== */

/**
 * Ô chọn nhóm hàng dạng cây, dùng cho bộ lọc và cho thẻ hàng hoá.
 *
 * Thụt đầu dòng theo cấp để nhìn ra ngay quan hệ cha con. Dùng thẻ
 * <select> thường chứ không dựng cây bấm mở — ở bộ lọc thì người dùng
 * cần chọn nhanh một cái rồi thôi.
 */
export function CategorySelect({
  value, onChange, categories, placeholder = 'Mọi nhóm hàng',
  size = 'md', className = '', leafOnly = false, id, ariaLabel,
}) {
  const list = categories || [];
  return (
    <Select
      id={id}
      size={size}
      className={className}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
    >
      <option value="">{placeholder}</option>
      {list.map((c) => (
        <option
          key={c.id}
          value={c.id}
          /* Gán hàng thì chỉ cho chọn nhóm lá, theo đúng quy tắc "sản phẩm
             nằm ở nhóm nhỏ nhất". Lọc thì chọn cấp nào cũng được. */
          disabled={leafOnly && c.has_children}
        >
          {'   '.repeat(Math.max(0, (c.level || 1) - 1))}
          {(c.level || 1) > 1 ? '└ ' : ''}{c.name}
          {leafOnly && c.has_children ? ' (có nhóm con)' : ''}
        </option>
      ))}
    </Select>
  );
}
