import { useState, useRef, useCallback } from 'react';
import { Camera, X, Upload, ImageOff } from 'lucide-react';
import { IconButton, Button } from './ui';

/**
 * Chọn và xem trước ảnh chụp hàng bảo hành.
 *
 * Ảnh chụp bằng điện thoại thường 3-5MB. Trước khi gửi lên máy chủ,
 * component này thu nhỏ còn tối đa 1400px và nén JPEG — vừa đủ nhìn rõ
 * vết hỏng mà không làm nặng ổ cứng máy chủ trong tiệm.
 */

const MAX_SIDE = 1400;
const QUALITY = 0.82;

async function shrink(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });

  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  if (scale === 1 && file.size < 400 * 1024) return dataUrl;   // đã nhỏ sẵn

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', QUALITY);
}

export default function PhotoPicker({ photos, onChange, max = 8, label = 'Ảnh chụp' }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);
  const camRef = useRef(null);

  const addFiles = useCallback(async (fileList) => {
    const files = [...fileList].filter((f) => f.type.startsWith('image/'));
    if (!files.length) { setErr('Chỉ chọn được file ảnh.'); return; }
    const room = max - photos.length;
    if (room <= 0) { setErr(`Tối đa ${max} ảnh.`); return; }

    setBusy(true);
    setErr('');
    try {
      const added = [];
      for (const file of files.slice(0, room)) {
        try { added.push({ data: await shrink(file), caption: '' }); }
        catch { setErr(`Không đọc được ảnh "${file.name}".`); }
      }
      if (added.length) onChange([...photos, ...added]);
    } finally {
      setBusy(false);
    }
  }, [photos, onChange, max]);

  const remove = (i) => onChange(photos.filter((_, j) => j !== i));
  const setCaption = (i, v) =>
    onChange(photos.map((p, j) => j === i ? { ...p, caption: v } : p));

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="label !mb-0">
          {label}
          <span className="font-normal text-2xs ml-1">({photos.length}/{max})</span>
        </span>
        <div className="flex gap-1.5">
          {/* capture mở thẳng camera trên điện thoại, máy tính thì mở hộp chọn file */}
          <Button size="sm" icon={Camera} onClick={() => camRef.current?.click()} loading={busy}>
            Chụp ảnh
          </Button>
          <Button size="sm" icon={Upload} onClick={() => fileRef.current?.click()} loading={busy}>
            Chọn file
          </Button>
        </div>
      </div>

      <input ref={camRef} type="file" accept="image/*" capture="environment" multiple
        className="hidden" aria-label="Chụp ảnh bằng camera"
        onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      <input ref={fileRef} type="file" accept="image/*" multiple
        className="hidden" aria-label="Chọn ảnh từ máy"
        onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />

      {photos.length === 0 ? (
        <button
          onClick={() => camRef.current?.click()}
          className="w-full border-2 border-dashed border-line rounded-lg py-6 px-3
                     text-center hover:border-accent hover:bg-accent-soft/20
                     transition-colors duration-150 cursor-pointer"
        >
          <ImageOff size={22} className="text-muted-ink mx-auto mb-1.5" aria-hidden="true" />
          <p className="text-[13px] font-semibold">Chưa có ảnh nào</p>
          <p className="text-2xs text-muted-ink mt-0.5 max-w-xs mx-auto leading-relaxed">
            Nên chụp vài tấm ghi lại tình trạng máy lúc nhận — sau này khách thắc mắc
            trầy xước thì có bằng chứng.
          </p>
        </button>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {photos.map((p, i) => (
            <div key={i} className="card overflow-hidden">
              <div className="relative bg-slate-100 aspect-square">
                <img
                  src={p.data || p.url}
                  alt={p.caption || `Ảnh ${i + 1}`}
                  className="w-full h-full object-cover"
                />
                <IconButton
                  icon={X}
                  label={`Bỏ ảnh ${i + 1}`}
                  size={13}
                  className="!absolute top-1 right-1 !bg-white/90 !text-danger hover:!bg-white shadow-sm"
                  onClick={() => remove(i)}
                />
              </div>
              <input
                className="w-full text-2xs px-1.5 py-1 border-t border-line focus:outline-none
                           focus:bg-accent-soft/30"
                placeholder="Ghi chú ảnh..."
                aria-label={`Ghi chú cho ảnh ${i + 1}`}
                value={p.caption || ''}
                onChange={(e) => setCaption(i, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}

      {err && <p className="error-text">{err}</p>}
      {photos.length > 0 && (
        <p className="hint">Ảnh tự thu nhỏ trước khi lưu để không làm đầy ổ cứng máy chủ.</p>
      )}
    </div>
  );
}

/** Xem ảnh đã lưu trên máy chủ, bấm vào để phóng to. */
/**
 * Đường dẫn ảnh bảo hành, kèm id người dùng ở dạng ?uid=.
 *
 * Thẻ <img> của trình duyệt không gửi được header tự đặt, nên nếu chỉ dựa
 * vào x-user-id thì máy chủ chặn 401 và ảnh hiện ra ô trống — trông hệt
 * như phần mềm quên lưu ảnh, dù ảnh vẫn nằm nguyên trong ổ cứng.
 */
export function photoUrl(file) {
  let uid = null;
  try { uid = JSON.parse(localStorage.getItem('thpos.user') || 'null')?.id || null; } catch { /* chưa đăng nhập */ }
  return `/api/warranty/photo/${file}` + (uid ? `?uid=${uid}` : '');
}

export function PhotoGallery({ photos, onDelete, emptyText = 'Chưa có ảnh' }) {
  const [zoom, setZoom] = useState(null);

  if (!photos?.length) {
    return <p className="text-[13px] text-muted-ink py-3 text-center">{emptyText}</p>;
  }

  return (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {photos.map((p) => (
          <div key={p.id} className="card overflow-hidden group">
            <button
              onClick={() => setZoom(p)}
              className="block w-full aspect-square bg-slate-100 cursor-zoom-in relative"
              aria-label={`Phóng to ảnh${p.caption ? ': ' + p.caption : ''}`}
            >
              <img
                src={photoUrl(p.file)}
                alt={p.caption || 'Ảnh hàng bảo hành'}
                className="w-full h-full object-cover"
                loading="lazy"
                /* File ảnh không còn trên ổ cứng thì nói thẳng, đừng để ô
                   vỡ — người dùng phải biết là ảnh mất chứ không phải mạng
                   chậm hay phần mềm đang tải. */
                onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.hidden = false; }}
              />
              <span hidden className="absolute inset-0 flex flex-col items-center justify-center
                                      gap-1 p-1.5 text-center text-2xs text-muted-ink">
                <ImageOff size={18} aria-hidden="true" />
                Ảnh không còn trên ổ cứng
              </span>
            </button>
            <div className="flex items-center gap-1 px-1.5 py-1 border-t border-line">
              <span className="text-2xs text-muted-ink truncate flex-1">
                {p.caption || (p.kind === 'done' ? 'Lúc trả' : 'Lúc nhận')}
              </span>
              {onDelete && (
                <IconButton icon={X} label="Xoá ảnh này" size={12}
                  className="!text-danger !px-1" onClick={() => onDelete(p)} />
              )}
            </div>
          </div>
        ))}
      </div>

      {zoom && (
        <div
          className="fixed inset-0 z-[70] bg-slate-900/85 flex items-center justify-center p-4 no-print"
          onClick={() => setZoom(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Xem ảnh phóng to"
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white p-2 rounded"
            onClick={() => setZoom(null)}
            aria-label="Đóng ảnh phóng to"
          >
            <X size={22} aria-hidden="true" />
          </button>
          <figure className="max-w-full max-h-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={photoUrl(zoom.file)}
              alt={zoom.caption || 'Ảnh hàng bảo hành'}
              className="max-w-full max-h-[80vh] object-contain rounded"
            />
            {zoom.caption && (
              <figcaption className="text-white text-center text-[13px] mt-2">{zoom.caption}</figcaption>
            )}
          </figure>
        </div>
      )}
    </>
  );
}
