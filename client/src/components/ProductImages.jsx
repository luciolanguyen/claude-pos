/* ====================================================================
   ẢNH VÀ MÔ TẢ HÀNG HOÁ (tài liệu 13, mục 1.4 và 3.1)

   Mỗi mặt hàng tối đa 4 ảnh, một ảnh làm ẢNH CHÍNH — ảnh chính là ảnh hiện
   ngoài danh mục và trên ô hàng ở màn hình bán hàng.

   Ảnh chụp bằng điện thoại thường 3-5MB. Thu nhỏ ngay trên trình duyệt
   trước khi gửi lên, để ổ cứng máy tính trong tiệm không đầy sau một năm.
   ==================================================================== */
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  ImagePlus, Star, Trash2, ImageOff, ChevronLeft, ChevronRight, Image as ImageIcon, Info,
} from 'lucide-react';
import { api } from '../lib/api';
import { money, n, qty as fq } from '../lib/format';
import { Button, IconButton, Modal, Spinner, Badge } from './ui';

export const MAX_IMAGES = 4;
const MAX_SIDE = 1200;
const QUALITY = 0.82;

/** Đọc file ảnh, thu nhỏ còn tối đa 1200px rồi trả về chuỗi base64. */
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
  if (scale === 1 && file.size < 300 * 1024) return dataUrl;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', QUALITY);
}

/* ==================================================================== */
/* Ảnh nhỏ dùng chung                                                    */
/* ==================================================================== */

/**
 * Ô ảnh nhỏ. `file` là tên file máy chủ đã lưu, `data` là ảnh mới chọn còn
 * nằm trên máy (chưa gửi lên) — dùng chung một ô cho cả hai.
 */
export function Thumb({ file, data, alt = '', size = 40, className = '' }) {
  const src = data || api.imageUrl(file);
  if (!src) {
    return (
      <div
        className={`grid place-items-center rounded border border-line bg-muted text-muted-ink ${className}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <ImageOff size={Math.round(size * 0.45)} />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={`rounded border border-line object-cover bg-white ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/* ==================================================================== */
/* Bảng quản lý ảnh trong thẻ hàng hoá                                   */
/* ==================================================================== */

/**
 * @param productId  có id thì lưu thẳng lên máy chủ mỗi lần thêm / xoá.
 *                   Chưa có id (đang khai hàng mới) thì giữ tạm trong
 *                   `staged` và biểu mẫu gửi kèm lúc lưu mặt hàng.
 */
export function ProductImageManager({ productId, images = [], staged = [], onChange, onStage }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);
  const total = images.length + staged.length;
  const room = MAX_IMAGES - total;

  const addFiles = useCallback(async (fileList) => {
    const files = [...fileList].filter((f) => f.type.startsWith('image/'));
    if (!files.length) { setErr('Chỉ chọn được file ảnh (JPG, PNG, WEBP).'); return; }
    if (room <= 0) {
      setErr(`Mỗi mặt hàng lưu tối đa ${MAX_IMAGES} ảnh. Xoá một ảnh cũ trước khi thêm ảnh mới.`);
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const shrunk = [];
      for (const f of files.slice(0, room)) {
        try { shrunk.push(await shrink(f)); }
        catch { setErr(`Không đọc được ảnh "${f.name}".`); }
      }
      if (!shrunk.length) return;
      if (productId) {
        const res = await api.productImages(productId, shrunk);
        onChange?.(res.images);
        if (res.skipped > 0) setErr(`${res.skipped} file không phải ảnh nên bị bỏ qua.`);
      } else {
        onStage?.([...staged, ...shrunk]);
      }
      if (files.length > room) {
        setErr(`Chỉ thêm được ${room} ảnh nữa cho đủ ${MAX_IMAGES}.`);
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }, [productId, room, staged, onChange, onStage]);

  const setMain = async (imgId) => {
    try { onChange?.((await api.setMainImage(productId, imgId)).images); }
    catch (e) { setErr(e.message); }
  };
  const drop = async (imgId) => {
    try { onChange?.((await api.deleteImage(productId, imgId)).images); }
    catch (e) { setErr(e.message); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div>
          <span className="label !mb-0">
            Hình ảnh <span className="font-normal text-2xs">({total}/{MAX_IMAGES})</span>
          </span>
          <p className="text-2xs text-muted-ink">
            Ảnh có dấu <Star size={10} className="inline -mt-0.5" aria-hidden="true" /> là ảnh chính,
            hiện ngoài danh mục và ô hàng khi bán.
          </p>
        </div>
        <Button size="sm" icon={ImagePlus} loading={busy} disabled={room <= 0}
          onClick={() => fileRef.current?.click()}>
          Thêm ảnh
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {total === 0 ? (
        <p className="text-[13px] text-muted-ink py-2">
          Chưa có ảnh. Có ảnh thì thu ngân nhìn ô hàng là nhận ra món, khỏi đọc tên.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {images.map((im) => (
            <div key={im.id} className="relative">
              <Thumb file={im.file} alt="Ảnh hàng hoá" size={76} />
              {im.is_main === 1 && (
                <span className="absolute -top-1 -left-1 rounded-full bg-amber-500 text-white p-0.5"
                  title="Ảnh chính">
                  <Star size={11} aria-hidden="true" />
                </span>
              )}
              <div className="absolute -bottom-1 -right-1 flex gap-0.5">
                {im.is_main !== 1 && (
                  <IconButton icon={Star} size={12} label="Chọn làm ảnh chính"
                    className="!bg-card !border !border-line" onClick={() => setMain(im.id)} />
                )}
                <IconButton icon={Trash2} size={12} label="Xoá ảnh này"
                  className="!bg-card !border !border-line !text-danger" onClick={() => drop(im.id)} />
              </div>
            </div>
          ))}
          {staged.map((data, i) => (
            <div key={`s${i}`} className="relative">
              <Thumb data={data} alt="Ảnh mới chọn" size={76} />
              <Badge tone="info" className="absolute -top-1 -left-1">Mới</Badge>
              <div className="absolute -bottom-1 -right-1">
                <IconButton icon={Trash2} size={12} label="Bỏ ảnh mới chọn"
                  className="!bg-card !border !border-line !text-danger"
                  onClick={() => onStage?.(staged.filter((_, j) => j !== i))} />
              </div>
            </div>
          ))}
        </div>
      )}

      {!productId && staged.length > 0 && (
        <p className="text-2xs text-muted-ink mt-1.5">
          Ảnh sẽ được lưu cùng lúc với mặt hàng. Ảnh đầu tiên thành ảnh chính.
        </p>
      )}
      {err && (
        <p role="alert" className="text-2xs text-danger font-semibold mt-1.5">{err}</p>
      )}
    </div>
  );
}

/* ==================================================================== */
/* Xem ảnh và mô tả ngoài màn hình bán hàng (tài liệu 13, mục 3.1)       */
/* ==================================================================== */

/**
 * Icon ảnh nhỏ ở góc ô hàng trên lưới POS.
 * Rê chuột vào: hiện ảnh chính phóng to. Bấm vào: mở hộp chi tiết.
 */
export function TileImageButton({ product, onOpen }) {
  const [hover, setHover] = useState(false);
  const has = !!product.image;
  return (
    <span
      className="absolute top-1 right-1 z-10"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpen(product); }}
        aria-label={`Xem ảnh và mô tả ${product.name}`}
        title={has ? 'Xem ảnh và mô tả' : 'Xem mô tả (chưa có ảnh)'}
        className={`grid place-items-center w-6 h-6 rounded border cursor-pointer
                    transition-colors duration-100
                    ${has
                      ? 'bg-white/90 border-line text-accent hover:bg-accent hover:text-white'
                      : 'bg-white/70 border-line text-muted-ink hover:text-ink'}`}
      >
        {has ? <ImageIcon size={13} aria-hidden="true" /> : <Info size={13} aria-hidden="true" />}
      </button>

      {/* Ảnh phóng to khi rê chuột — nổi lên trên, không đẩy lưới hàng */}
      {hover && has && (
        <span className="absolute top-7 right-0 z-30 pointer-events-none block
                         rounded-lg border border-line bg-white shadow-lg p-1">
          <img
            src={api.imageUrl(product.image)}
            alt=""
            className="block w-40 h-40 object-contain"
          />
          <span className="block text-2xs text-muted-ink text-center pt-0.5 max-w-[10rem] truncate">
            {product.name}
          </span>
        </span>
      )}
    </span>
  );
}

/** Hộp chi tiết: bên trái trình chiếu ảnh, bên phải bảng mô tả. */
export function ProductInfoModal({ product, onClose, priceListId }) {
  const [i, setI] = useState(0);
  const imgs = product?.images || [];

  useEffect(() => { setI(0); }, [product?.id]);

  useEffect(() => {
    if (!product) return;
    const onKey = (e) => {
      if (e.key === 'ArrowRight') setI((x) => (imgs.length ? (x + 1) % imgs.length : 0));
      if (e.key === 'ArrowLeft') setI((x) => (imgs.length ? (x - 1 + imgs.length) % imgs.length : 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [product, imgs.length]);

  if (!product) return null;

  const unit = product.units?.find((u) => u.factor === 1) || product.units?.[0];
  const price = Number(unit?.prices?.[priceListId] ?? Object.values(unit?.prices || {})[0]) || 0;
  const rows = [
    ['Mã hàng', product.sku],
    ['Nhóm hàng', product.category_name],
    ['Hãng sản xuất', product.brand],
    ['Đơn vị cơ bản', product.base_unit],
    ['Quy cách đóng gói', product.pack_spec],
    ['Vị trí trên kệ', product.location],
    ['Bảo hành', product.warranty_months > 0 ? `${product.warranty_months} tháng` : null],
    ['Điều kiện bảo hành', product.warranty_note],
  ].filter(([, v]) => v);

  return (
    <Modal
      open
      onClose={onClose}
      title={product.name}
      subtitle={[product.sku, product.alias].filter(Boolean).join(' · ')}
      size="lg"
      footer={<Button variant="primary" onClick={onClose}>Đóng</Button>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {/* ---------------------- Trình chiếu ảnh --------------------- */}
        <div>
          {imgs.length === 0 ? (
            <div className="grid place-items-center h-56 rounded-lg border border-line bg-muted text-muted-ink">
              <div className="text-center">
                <ImageOff size={28} className="mx-auto mb-1" aria-hidden="true" />
                <p className="text-[13px]">Mặt hàng này chưa có ảnh</p>
              </div>
            </div>
          ) : (
            <>
              <div className="relative rounded-lg border border-line bg-white overflow-hidden">
                <img
                  src={api.imageUrl(imgs[i]?.file)}
                  alt={`${product.name} — ảnh ${i + 1}`}
                  className="block w-full h-56 object-contain"
                />
                {imgs.length > 1 && (
                  <>
                    <button type="button" aria-label="Ảnh trước"
                      onClick={() => setI((x) => (x - 1 + imgs.length) % imgs.length)}
                      className="absolute left-1 top-1/2 -translate-y-1/2 grid place-items-center w-8 h-8
                                 rounded-full bg-white/85 border border-line hover:bg-white cursor-pointer">
                      <ChevronLeft size={17} aria-hidden="true" />
                    </button>
                    <button type="button" aria-label="Ảnh sau"
                      onClick={() => setI((x) => (x + 1) % imgs.length)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 grid place-items-center w-8 h-8
                                 rounded-full bg-white/85 border border-line hover:bg-white cursor-pointer">
                      <ChevronRight size={17} aria-hidden="true" />
                    </button>
                    <span className="absolute bottom-1 right-1 text-2xs bg-black/55 text-white rounded px-1.5 py-0.5 tabular">
                      {i + 1}/{imgs.length}
                    </span>
                  </>
                )}
              </div>
              {imgs.length > 1 && (
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {imgs.map((im, j) => (
                    <button key={im.id ?? j} type="button" onClick={() => setI(j)}
                      aria-label={`Xem ảnh ${j + 1}`} aria-current={j === i}
                      className={`rounded border cursor-pointer p-0.5
                                  ${j === i ? 'border-accent' : 'border-line hover:border-accent/60'}`}>
                      <Thumb file={im.file} size={44} className="!border-0" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* ------------------------- Mô tả --------------------------- */}
        <div className="space-y-2.5 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-lg font-display font-bold text-accent tabular">{money(price)}</span>
            <span className="text-[13px] text-muted-ink">
              {product.track_stock ? `Còn ${fq(product.stock)} ${product.base_unit}` : 'Dịch vụ'}
            </span>
          </div>

          {product.description ? (
            <div>
              <h3 className="text-[13px] font-bold mb-1">Thông tin mô tả</h3>
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{product.description}</p>
            </div>
          ) : (
            <p className="text-[13px] text-muted-ink">
              Chưa khai mô tả cho mặt hàng này. Khai ở <b>Hàng hoá &amp; tồn kho → sửa mặt hàng</b> thì
              lúc khách hỏi thông số là có ngay ở đây.
            </p>
          )}

          {rows.length > 0 && (
            <div className="table-wrap">
              <table className="data">
                <tbody>
                  {rows.map(([k, v]) => (
                    <tr key={k}>
                      <td className="text-muted-ink whitespace-nowrap">{k}</td>
                      <td className="font-medium">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {product.units?.length > 1 && (
            <div>
              <h3 className="text-[13px] font-bold mb-1">Các đơn vị bán</h3>
              <ul className="text-[13px] space-y-0.5">
                {product.units.map((u) => (
                  <li key={u.id} className="flex items-baseline justify-between gap-2">
                    <span>
                      {u.unit_name}
                      {u.factor > 1 && (
                        <span className="text-2xs text-muted-ink"> = {fq(u.factor)} {product.base_unit}</span>
                      )}
                    </span>
                    <span className="tabular font-semibold">
                      {money(Number(u.prices?.[priceListId] ?? Object.values(u.prices || {})[0]) || 0)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
