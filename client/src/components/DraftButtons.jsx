/* ====================================================================
   LƯU TẠM — dùng chung cho mọi loại phiếu

   Hai cái nút:
     <SaveDraftButton>  cất phiếu đang làm dở
     <OpenDraftsButton> mở lại phiếu đã cất

   Vì sao cần: lập một phiếu nhập ba chục dòng, giữa chừng khách vào hoặc
   mối gọi hỏi lại giá, thì phải bỏ dở. Không có chỗ cất, người ta sẽ lưu
   bừa một phiếu sai rồi định bụng sửa sau — mà phiếu nhập đã lưu là đã
   cộng kho và đổi giá vốn, sửa lại không đơn giản.

   Phiếu tạm KHÔNG đụng kho, không đụng tiền, không sinh giá vốn. Cất trên
   máy chủ nên máy nào trong tiệm cũng mở tiếp được.
   ==================================================================== */
import { useState, useEffect } from 'react';
import { Save, FolderOpen, Trash2, Clock, FileText } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch } from '../lib/store';
import { money, n, qty as fq, smartTime } from '../lib/format';
import { Button, IconButton, Modal, Empty, Spinner, ErrorBox, Confirm, SearchInput } from './ui';

/**
 * Nút "Lưu tạm".
 *
 * @param build     () => { kind, id?, title, payload, ... } — gọi lúc bấm,
 *                  không phải lúc dựng nút, để lấy đúng nội dung mới nhất.
 * @param onSaved   nhận lại phiếu tạm vừa lưu; nhớ id để lần sau GHI ĐÈ
 *                  chứ không đẻ thêm bản nháp.
 */
export default function SaveDraftButton({
  build, onSaved, disabled, className = '', label = 'Lưu tạm', size = 'md',
}) {
  const { user, toast } = useApp();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const body = build();
      const saved = await api.post('/doc-drafts', { user_id: user?.id, ...body });
      toast(`Đã lưu tạm ${saved.code}. Mở lại ở nút "Phiếu tạm".`, 'ok', 5000);
      onSaved?.(saved);
    } catch (e) {
      toast(e.message, 'bad', 6000);
    } finally { setBusy(false); }
  };

  return (
    <Button
      size={size}
      icon={Save}
      loading={busy}
      onClick={save}
      disabled={disabled || busy}
      className={className}
      title="Cất phiếu đang làm dở, chưa ghi vào kho và sổ sách"
    >
      {label}
    </Button>
  );
}

/**
 * Nút "Phiếu tạm" kèm số lượng đang cất, mở ra danh sách để làm tiếp.
 * Không có phiếu tạm nào thì ẩn hẳn cho đỡ chật thanh công cụ.
 */
export function OpenDraftsButton({ kind, onOpen, label = 'Phiếu tạm', size = 'md' }) {
  const [open, setOpen] = useState(false);
  const { data, reload } = useFetch(() => api.get('/doc-drafts-count'), []);
  const count = data?.counts?.[kind] || 0;

  if (!count && !open) return null;

  return (
    <>
      <Button size={size} icon={FolderOpen} onClick={() => setOpen(true)}>
        {label} {count > 0 && <span className="font-bold">({n(count)})</span>}
      </Button>
      {open && (
        <DraftsModal
          kind={kind}
          onClose={() => { setOpen(false); reload(); }}
          onOpen={(d) => { setOpen(false); reload(); onOpen(d); }}
        />
      )}
    </>
  );
}

/* ==================================================================== */

/**
 * Xem trước nội dung một phiếu tạm.
 *
 * Mỗi loại phiếu lưu một kiểu payload khác nhau (phiếu nhập có `lines`, phiếu kiểm
 * kê cũng `lines` nhưng ô số khác tên...). Ở đây chỉ đọc những khoá hay gặp và hiện
 * cái gì có — cốt để nhìn biết "phiếu này của mối nào, có mấy món" trước khi mở.
 */
function DraftPreview({ draft }) {
  const p = draft?.payload;
  if (!p) return <p className="text-[13px] text-muted-ink">Phiếu này không đọc được nội dung đã lưu.</p>;
  const lines = [p.lines, p.items, p.cart, p.custom_lines].find((x) => Array.isArray(x) && x.length) || [];
  const note = p.note || p.ghi_chu || '';
  const money0 = (v) => (v ? money(v) : '—');

  return (
    <div className="space-y-2">
      {lines.length === 0 ? (
        <p className="text-[13px] text-muted-ink">Phiếu chưa có món nào, mới lưu phần đầu phiếu.</p>
      ) : (
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
              {lines.map((l, i) => {
                const qty = Number(l.qty ?? l.quantity ?? l.counted ?? 0);
                const price = Number(l.price ?? l.cost ?? 0);
                return (
                  <tr key={l.key || l.product_id || i}>
                    <td>
                      <div className="font-medium">{l.name || l.name_snapshot || l.product_name || '—'}</div>
                      {l.sku && <div className="text-2xs text-muted-ink font-mono">{l.sku}</div>}
                    </td>
                    <td className="text-muted-ink">{l.unit_name || l.base_unit || '—'}</td>
                    <td className="num">{qty ? fq(qty) : '—'}</td>
                    <td className="num">{money0(price)}</td>
                    <td className="num font-semibold">{qty && price ? money(Math.round(qty * price)) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {note && <div className="card p-2.5 text-[13px]"><b>Ghi chú:</b> {note}</div>}
    </div>
  );
}

function DraftsModal({ kind, onClose, onOpen }) {
  const { toast } = useApp();
  const [q, setQ] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selId, setSelId] = useState(null);
  const [preview, setPreview] = useState(null);      // nội dung phiếu đang xem
  const [previewBusy, setPreviewBusy] = useState(false);
  const { data, busy: loading, error, reload } = useFetch(
    () => api.get('/doc-drafts', { kind, q, page_size: 100 }), [kind, q]);

  const rows = data?.rows || [];

  /* Chọn sẵn phiếu đầu tiên: mở hộp ra là thấy ngay nội dung, khỏi bấm thêm một
     nhát nữa mới biết trong phiếu có gì (yêu cầu 28/09, mục II.2) */
  useEffect(() => {
    if (!rows.length) { setSelId(null); return; }
    if (!rows.some((r) => r.id === selId)) setSelId(rows[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  /* Nạp nội dung phiếu đang chọn. Cờ alive chặn chuyện bấm nhanh hai phiếu mà
     phiếu tải xong trước lại đè lên phiếu bấm sau. */
  useEffect(() => {
    if (!selId) { setPreview(null); return undefined; }
    let alive = true;
    setPreviewBusy(true);
    api.get(`/doc-drafts/${selId}`)
      .then((d) => { if (alive) setPreview(d); })
      .catch((e) => { if (alive) toast(e.message, 'bad', 6000); })
      .finally(() => { if (alive) setPreviewBusy(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId]);

  const openDraft = async (row) => {
    try {
      onOpen(row.id === preview?.id && preview ? preview : await api.get(`/doc-drafts/${row.id}`));
    } catch (e) { toast(e.message, 'bad', 6000); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/doc-drafts/${deleting.id}`);
      toast(`Đã xoá phiếu tạm ${deleting.code}`, 'ok');
      setDeleting(null);
      if (deleting.id === selId) setSelId(null);
      reload();
    } catch (e) {
      toast(e.message, 'bad', 6000);
    } finally { setBusy(false); }
  };

  const sel = rows.find((r) => r.id === selId) || null;

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title="Phiếu tạm"
        subtitle="Phiếu đang làm dở, cất trên máy chủ nên máy nào trong tiệm cũng mở tiếp được"
        size="full"
        footer={<>
          {sel && (
            <span className="mr-auto text-[13px] text-muted-ink">
              Đang xem <b className="font-mono">{sel.code}</b>
            </span>
          )}
          <Button onClick={onClose}>Đóng</Button>
        </>}
      >
        {error && <ErrorBox error={error} onRetry={reload} />}
        {loading && !data ? <Spinner />
          : !rows.length && !q ? (
            <Empty icon={FileText} title="Không có phiếu tạm nào"
              message="Bấm “Lưu tạm” khi đang lập phiếu dở dang, phiếu sẽ hiện ở đây." />
          ) : (
            <div className="grid gap-3 lg:grid-cols-[minmax(260px,340px)_1fr] lg:h-[calc(100vh-18rem)]">
              {/* ---- danh sách bên trái ---- */}
              <div className="space-y-2 min-w-0 lg:overflow-y-auto">
                <SearchInput value={q} onChange={setQ}
                  placeholder="Tìm mã phiếu, tên phiếu, đối tác..." />
                {!rows.length ? (
                  <p className="text-[13px] text-muted-ink px-1">Không có phiếu tạm nào khớp “{q}”.</p>
                ) : rows.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setSelId(d.id)}
                    aria-pressed={selId === d.id}
                    className={`w-full text-left rounded-lg border p-2 cursor-pointer transition-colors duration-100
                                ${selId === d.id ? 'border-accent bg-accent-soft/50' : 'border-line hover:bg-muted/60'}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-2xs font-semibold text-accent">{d.code}</span>
                      <span className="ml-auto text-2xs text-muted-ink inline-flex items-center gap-1">
                        <Clock size={11} aria-hidden="true" />{smartTime(d.updated_at)}
                      </span>
                    </div>
                    <div className="text-[13px] font-medium truncate">{d.title}</div>
                    <div className="text-2xs text-muted-ink truncate">
                      {d.partner_name || 'Chưa chọn đối tác'}
                      {d.item_count ? ` · ${n(d.item_count)} món` : ''}
                      {d.total ? ` · ${money(d.total)}` : ''}
                    </div>
                  </button>
                ))}
              </div>

              {/* ---- xem trước bên phải ---- */}
              <div className="card p-3 min-w-0 lg:overflow-y-auto">
                {!sel ? (
                  <Empty icon={FileText} title="Chọn một phiếu tạm"
                    message="Bấm một phiếu bên trái để xem trong đó có gì trước khi mở tiếp." />
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="min-w-[12rem] flex-1">
                        <div className="font-bold">{sel.title}</div>
                        <div className="text-2xs text-muted-ink">
                          <span className="font-mono">{sel.code}</span>
                          {sel.partner_name ? ` · ${sel.partner_name}` : ''}
                          {sel.user_name ? ` · ${sel.user_name} lưu` : ''}
                          {` · ${smartTime(sel.updated_at)}`}
                        </div>
                      </div>
                      <Button variant="primary" onClick={() => openDraft(sel)}>Mở tiếp phiếu này</Button>
                      <IconButton icon={Trash2} label={`Xoá phiếu tạm ${sel.code}`} size={16}
                        className="!text-danger hover:!bg-red-50" onClick={() => setDeleting(sel)} />
                    </div>
                    {previewBusy && !preview ? <Spinner /> : <DraftPreview draft={preview} />}
                  </div>
                )}
              </div>
            </div>
          )}
      </Modal>

      {/* Hộp xác nhận của phần mềm, KHÔNG dùng window.confirm — trình duyệt
          nhúng chặn hộp đó nên bấm xong không có gì xảy ra. */}
      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        busy={busy}
        title="Xoá phiếu tạm?"
        confirmText="Xoá phiếu tạm"
        message={deleting && (
          <>Xoá <b className="font-mono">{deleting.code}</b>
            {deleting.title ? <> — {deleting.title}</> : null}?
            Phiếu tạm chưa ghi vào kho hay sổ sách nên xoá đi không ảnh hưởng gì,
            nhưng nội dung đang gõ dở sẽ mất.</>
        )}
      />
    </>
  );
}
