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
import { useState } from 'react';
import { Save, FolderOpen, Trash2, Clock, FileText } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useFetch } from '../lib/store';
import { money, n, smartTime } from '../lib/format';
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

function DraftsModal({ kind, onClose, onOpen }) {
  const { toast } = useApp();
  const [q, setQ] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data, busy: loading, error, reload } = useFetch(
    () => api.get('/doc-drafts', { kind, q, page_size: 100 }), [kind, q]);

  const rows = data?.rows || [];

  const open = async (row) => {
    try {
      onOpen(await api.get(`/doc-drafts/${row.id}`));
    } catch (e) { toast(e.message, 'bad', 6000); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/doc-drafts/${deleting.id}`);
      toast(`Đã xoá phiếu tạm ${deleting.code}`, 'ok');
      setDeleting(null);
      reload();
    } catch (e) {
      toast(e.message, 'bad', 6000);
    } finally { setBusy(false); }
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title="Phiếu tạm"
        subtitle="Phiếu đang làm dở, cất trên máy chủ nên máy nào trong tiệm cũng mở tiếp được"
        size="lg"
        footer={<Button onClick={onClose}>Đóng</Button>}
      >
        <div className="space-y-2.5">
          {error && <ErrorBox error={error} onRetry={reload} />}

          <SearchInput value={q} onChange={setQ}
            placeholder="Tìm theo mã phiếu, tên phiếu, tên đối tác..." />

          {loading && !data ? <Spinner />
            : !rows.length ? (
              <Empty icon={FileText} title="Không có phiếu tạm nào"
                message="Bấm “Lưu tạm” khi đang lập phiếu dở dang, phiếu sẽ hiện ở đây." />
            ) : (
              <div className="table-wrap max-h-[52vh] overflow-y-auto border border-line rounded-lg">
                <table className="data">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th>Mã</th>
                      <th>Tên phiếu</th>
                      <th>Đối tác</th>
                      <th className="text-right">Số món</th>
                      <th className="text-right">Tạm tính</th>
                      <th>Lưu lúc</th>
                      <th>Người lưu</th>
                      <th style={{ width: 96 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => (
                      <tr key={d.id} className="hoverable">
                        <td className="font-mono text-muted-ink">{d.code}</td>
                        <td className="font-medium">{d.title}</td>
                        <td className="text-muted-ink">{d.partner_name || '—'}</td>
                        <td className="num">{d.item_count ? n(d.item_count) : '—'}</td>
                        <td className="num">{d.total ? money(d.total) : '—'}</td>
                        <td className="text-muted-ink whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <Clock size={11} aria-hidden="true" />{smartTime(d.updated_at)}
                          </span>
                        </td>
                        <td className="text-muted-ink">{d.user_name || '—'}</td>
                        <td>
                          <div className="flex items-center gap-1 justify-end">
                            <Button size="sm" variant="primary" onClick={() => open(d)}>
                              Mở tiếp
                            </Button>
                            <IconButton icon={Trash2} label={`Xoá phiếu tạm ${d.code}`} size={14}
                              className="!text-danger hover:!bg-red-50"
                              onClick={() => setDeleting(d)} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
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
