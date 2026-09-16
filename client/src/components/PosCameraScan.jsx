import { useEffect, useRef, useState } from 'react';
import {
  X, Flashlight, FlashlightOff, Volume2, VolumeX, Check, AlertTriangle, SearchX,
  Plus, ShieldCheck, RotateCcw, Loader2, ShoppingCart,
} from 'lucide-react';
import { api } from '../lib/api';
import { useLocal } from '../lib/store';
import { money, n } from '../lib/format';
import {
  cameraBlockedReason, cameraErrorText, getDetector, beep, buzz, createScanGate,
} from '../lib/cameraScan';

const SCAN_EVERY = 110;

/**
 * Màn hình quét mã vạch bằng camera điện thoại (plan 31, hạng mục 2b).
 *
 * Quét LIÊN TỤC: quét món nào vào giỏ món đó, camera vẫn mở cho món sau,
 * y như máy quét cầm tay ở quầy. Giỏ là giỏ của chính điện thoại này.
 *
 * @param onCode    (mã) => { kind: 'added' | 'out' | 'missing', product?, code }
 * @param onAddMore (product) => void — nút +1 cho món vừa quét
 * @param cart      các dòng trong giỏ đang mở, để hiện số lượng đã có
 * @param onDone    bấm "Xong, xem giỏ hàng" — đóng camera và chuyển sang giỏ
 */
export default function PosCameraScan({ open, onClose, onDone, onCode, onAddMore, cart = [] }) {
  const videoRef = useRef(null);
  const trackRef = useRef(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const [sound, setSound] = useLocal('thpos.scan_sound', true);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const [phase, setPhase] = useState('starting');   // starting | running | error | blocked
  const [error, setError] = useState('');
  const [torch, setTorch] = useState(null);         // null = máy không có đèn
  const [last, setLast] = useState(null);
  const [scans, setScans] = useState(0);
  const [restart, setRestart] = useState(0);
  const [blockedWhy, setBlockedWhy] = useState('');
  /* Chuyển sang ứng dụng khác thì TẮT camera cho đỡ pin, quay lại mới mở */
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onVisible = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [open]);

  /* ------------------------ Mở camera + vòng đọc mã ------------------------ */
  useEffect(() => {
    if (!open || hidden) return undefined;
    const blocked = cameraBlockedReason();
    setBlockedWhy(blocked);
    if (blocked) { setPhase('blocked'); return undefined; }

    let stopped = false;
    let timer = 0;
    let stream = null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const gate = createScanGate();

    setPhase('starting');
    setError('');

    const accept = (code) => {
      const res = onCodeRef.current(code) || { kind: 'missing', code };
      const good = res.kind === 'added';
      if (soundRef.current) beep(good);
      buzz(good);
      setLast({ ...res, at: Date.now() });
      setScans((s) => s + 1);
    };

    const tick = async (detector) => {
      if (stopped) return;
      const v = videoRef.current;
      if (v && v.readyState >= 2 && v.videoWidth) {
        /* Chỉ đọc dải giữa khung hình, chỗ có khung ngắm: nhanh hơn đọc cả
           ảnh, và không vô tình vớ mã của món nằm cạnh trên kệ. */
        const vw = v.videoWidth;
        const vh = v.videoHeight;
        const cw = Math.round(vw * 0.9);
        const ch = Math.round(vh * 0.5);
        const scale = Math.min(1, 960 / cw);
        canvas.width = Math.round(cw * scale);
        canvas.height = Math.round(ch * scale);
        ctx.drawImage(v, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height);
        try {
          const found = await detector.detect(canvas);
          if (stopped) return;
          const code = gate(
            found.map((c) => ({ value: String(c.rawValue || '').trim(), format: c.format })),
            Date.now(),
          );
          if (code) accept(code);
        } catch { /* khung hỏng thì đọc khung sau */ }
      }
      if (!stopped) timer = setTimeout(() => tick(detector), SCAN_EVERY);
    };

    (async () => {
      try {
        const [{ detector }, media] = await Promise.all([
          getDetector(),
          navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          }),
        ]);
        if (stopped) { media.getTracks().forEach((t) => t.stop()); return; }
        stream = media;
        const track = media.getVideoTracks()[0];
        trackRef.current = track;
        const caps = track.getCapabilities?.() || {};
        if (caps.focusMode?.includes?.('continuous')) {
          track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        }
        setTorch(caps.torch ? false : null);
        const v = videoRef.current;
        v.srcObject = media;
        await v.play().catch(() => {});
        setPhase('running');
        tick(detector);
      } catch (e) {
        if (stopped) return;
        setError(cameraErrorText(e));
        setPhase('error');
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [open, restart, hidden]);

  /* Esc đóng (máy tính bảng có bàn phím) */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /* Mở lại màn hình quét thì bắt đầu lượt mới */
  useEffect(() => {
    if (open) { setLast(null); setScans(0); }
  }, [open]);

  const toggleTorch = async () => {
    const t = trackRef.current;
    if (!t || torch === null) return;
    try {
      await t.applyConstraints({ advanced: [{ torch: !torch }] });
      setTorch(!torch);
    } catch { setTorch(null); }
  };

  if (!open) return null;

  const lines = last?.product ? cart.filter((l) => l.product_id === last.product.id) : [];
  const inCart = lines.reduce((s, l) => s + Number(l.qty || 0), 0);
  const cartCount = cart.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quét mã vạch bằng camera"
      className="fixed inset-0 z-[70] bg-black text-white flex flex-col no-print"
    >
      {/* ------------------------------ Thanh trên ------------------------------ */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-center gap-1 px-1.5
                      pt-[max(6px,env(safe-area-inset-top))] pb-1.5 bg-gradient-to-b from-black/80 to-transparent">
        <button
          type="button"
          onClick={onClose}
          className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-white/15
                     active:bg-white/25 cursor-pointer"
          aria-label="Đóng màn hình quét"
        >
          <X size={24} aria-hidden="true" />
        </button>
        <h2 className="flex-1 text-base font-semibold text-white">Quét mã vạch</h2>
        <button
          type="button"
          onClick={() => setSound((v) => !v)}
          aria-pressed={sound}
          className="w-11 h-11 rounded-full flex items-center justify-center hover:bg-white/15
                     active:bg-white/25 cursor-pointer"
          aria-label={sound ? 'Tắt tiếng bíp' : 'Bật tiếng bíp'}
        >
          {sound ? <Volume2 size={22} aria-hidden="true" /> : <VolumeX size={22} aria-hidden="true" />}
        </button>
        {torch !== null && (
          <button
            type="button"
            onClick={toggleTorch}
            aria-pressed={torch}
            className={`w-11 h-11 rounded-full flex items-center justify-center cursor-pointer
                        ${torch ? 'bg-amber-300 text-black' : 'hover:bg-white/15 active:bg-white/25'}`}
            aria-label={torch ? 'Tắt đèn pin' : 'Bật đèn pin — quầy tối, mã khó đọc'}
          >
            {torch ? <Flashlight size={22} aria-hidden="true" /> : <FlashlightOff size={22} aria-hidden="true" />}
          </button>
        )}
      </div>

      {/* ------------------------------ Khung camera ----------------------------- */}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          muted
          autoPlay
          aria-hidden="true"
        />

        {phase === 'running' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {/* Khung ngắm: tối phần ngoài bằng bóng đổ, khỏi phải ghép bốn mảng */}
            <div className="relative w-[86%] max-w-md aspect-[16/9] rounded-lg
                            shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] overflow-hidden">
              {['top-0 left-0 border-t-4 border-l-4 rounded-tl-lg',
                'top-0 right-0 border-t-4 border-r-4 rounded-tr-lg',
                'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-lg',
                'bottom-0 right-0 border-b-4 border-r-4 rounded-br-lg'].map((c) => (
                <span key={c} className={`absolute w-8 h-8 border-emerald-400 ${c}`} />
              ))}
              <div className="absolute inset-x-3 top-[6%] h-[88%] scan-sweep">
                <div className="h-0.5 bg-emerald-400/90 shadow-[0_0_8px_2px_rgba(52,211,153,0.6)]" />
              </div>
            </div>
          </div>
        )}

        {phase === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-200">
            <Loader2 size={32} className="animate-spin" aria-hidden="true" />
            <p className="text-sm">Đang mở camera…</p>
          </div>
        )}

        {phase === 'error' && (
          <CenterCard>
            <AlertTriangle size={28} className="text-amber-500 mx-auto" aria-hidden="true" />
            <p className="mt-2 text-[15px]">{error}</p>
            <div className="mt-4 grid gap-2">
              <button type="button" onClick={() => setRestart((x) => x + 1)} className="btn-primary h-11 w-full">
                <RotateCcw size={16} aria-hidden="true" /> Thử lại
              </button>
              <button type="button" onClick={onClose} className="btn-ghost h-11 w-full">Đóng</button>
            </div>
          </CenterCard>
        )}

        {phase === 'blocked' && blockedWhy === 'insecure' && <InsecureHelp onClose={onClose} />}
        {phase === 'blocked' && blockedWhy !== 'insecure' && (
          <CenterCard>
            <AlertTriangle size={28} className="text-amber-500 mx-auto" aria-hidden="true" />
            <p className="mt-2 text-[15px]">
              Trình duyệt trên máy này quá cũ, không mở được camera. Cập nhật Chrome rồi thử lại.
            </p>
            <button type="button" onClick={onClose} className="btn-ghost h-11 w-full mt-4">Đóng</button>
          </CenterCard>
        )}
      </div>

      {/* ------------------------------ Kết quả ------------------------------ */}
      {phase === 'running' && (
        <div className="absolute bottom-0 inset-x-0 z-20 px-3 pt-8
                        pb-[max(12px,env(safe-area-inset-bottom))] bg-gradient-to-t from-black/90 via-black/70 to-transparent">
          <div aria-live="polite" className="mb-2">
            {!last ? (
              <p className="text-center text-sm text-slate-200 pb-1">
                Đưa mã vạch vào giữa khung, cách chừng một gang tay
              </p>
            ) : (
              <ResultCard
                key={last.at}
                last={last}
                inCart={inCart}
                unit={lines[0]?.unit_name || last.product?.base_unit}
                price={lines[0]?.price}
                onAddMore={() => { onAddMore(last.product); if (soundRef.current) beep(true); buzz(true); }}
              />
            )}
          </div>
          <button
            type="button"
            onClick={onDone || onClose}
            className="w-full h-12 rounded-lg bg-accent hover:bg-emerald-800 active:bg-emerald-900
                       font-bold text-[15px] flex items-center justify-center gap-2 cursor-pointer"
          >
            <ShoppingCart size={18} aria-hidden="true" />
            Xong, xem giỏ hàng
            <span className="font-normal text-emerald-100 tabular">
              ({n(cartCount)} món{scans ? ` · quét ${n(scans)} lần` : ''})
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function CenterCard({ children }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-card text-ink rounded-xl p-5 text-center shadow-pop">
        {children}
      </div>
    </div>
  );
}

function ResultCard({ last, inCart, unit, price, onAddMore }) {
  if (last.kind === 'missing') {
    return (
      <div className="bg-card text-ink rounded-lg border-l-4 border-danger p-3 flex items-center gap-3 animate-slide-up">
        <SearchX size={22} className="text-danger shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold text-[15px]">Không có hàng nào mang mã này</p>
          <p className="font-mono text-sm text-muted-ink break-all">{last.code}</p>
        </div>
      </div>
    );
  }
  if (last.kind === 'out') {
    return (
      <div className="bg-card text-ink rounded-lg border-l-4 border-warn p-3 flex items-center gap-3 animate-slide-up">
        <AlertTriangle size={22} className="text-amber-600 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold text-[15px] line-clamp-2">{last.product.name}</p>
          <p className="text-sm text-amber-800">Đã hết hàng trong kho — chưa thêm vào giỏ</p>
        </div>
      </div>
    );
  }
  return (
    <div className="bg-card text-ink rounded-lg border-l-4 border-accent p-3 flex items-center gap-3 animate-slide-up">
      <Check size={22} className="text-accent shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-[15px] leading-snug line-clamp-2">{last.product.name}</p>
        <p className="text-sm text-muted-ink tabular">
          Trong giỏ: <b className="text-ink">{n(inCart)} {unit}</b>
          {price > 0 && <> · {money(price)}</>}
        </p>
      </div>
      <button
        type="button"
        onClick={onAddMore}
        className="shrink-0 w-14 h-12 rounded-lg border-2 border-accent text-accent font-bold
                   flex items-center justify-center gap-0.5 hover:bg-accent-soft active:bg-accent-soft cursor-pointer"
        aria-label={`Thêm 1 ${unit || ''} ${last.product.name}`}
      >
        <Plus size={16} aria-hidden="true" />1
      </button>
    </div>
  );
}

/**
 * Vào bằng http:// thì trình duyệt cấm camera. Chỉ đường sang địa chỉ
 * https của chính máy chủ tiệm, và trang cài chứng chỉ cho điện thoại.
 */
function InsecureHelp({ onClose }) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    api.get('/tls-info').then(setInfo).catch(() => setInfo({ enabled: false }));
  }, []);
  const host = window.location.hostname;
  const httpsUrl = info?.enabled ? `https://${host}:${info.https_port}/pos` : null;

  return (
    <CenterCard>
      <ShieldCheck size={30} className="text-accent mx-auto" aria-hidden="true" />
      <h3 className="mt-2 font-bold text-base">Camera cần địa chỉ bảo mật</h3>
      <p className="mt-1.5 text-sm text-muted-ink text-left">
        Trình duyệt chỉ cho mở camera khi vào phần mềm bằng <b className="text-ink">https://</b>.
        Điện thoại này đang vào bằng <span className="font-mono">http://</span>.
      </p>
      <p className="mt-1.5 text-sm text-muted-ink text-left">
        Mỗi điện thoại cài chứng chỉ của tiệm <b className="text-ink">một lần</b> là dùng được mãi.
      </p>
      <div className="mt-4 grid gap-2">
        <a href="/dien-thoai" className="btn-primary h-11 w-full">Cách cài cho điện thoại này</a>
        {httpsUrl && (
          <a href={httpsUrl} className="btn-ghost h-11 w-full border border-line">
            Đã cài rồi — mở địa chỉ bảo mật
          </a>
        )}
        {info && !info.enabled && (
          <p className="text-xs text-danger">Máy chủ chưa bật HTTPS{info.error ? `: ${info.error}` : ''}.</p>
        )}
        <button type="button" onClick={onClose} className="btn-ghost h-11 w-full">Đóng</button>
      </div>
    </CenterCard>
  );
}
