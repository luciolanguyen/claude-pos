/* ====================================================================
   ĐIỆN THOẠI LÀM MÁY BÁN HÀNG (plan 31, hạng mục 2b)

   Ba đường dẫn, đều KHÔNG cần đăng nhập — điện thoại phải cài được chứng
   chỉ trước đã, rồi mới vào https để đăng nhập:

     /dien-thoai            trang hướng dẫn cài, máy chủ trả thẳng HTML
                            (không qua giao diện React, vì giao diện đòi
                            đăng nhập trước)
     /chung-chi-tiem.crt    chứng chỉ gốc của tiệm (chỉ phần công khai)
     /api/tls-info          địa chỉ https, tên và vân tay chứng chỉ

   Không có gì bí mật đi ra ở đây: chứng chỉ gốc là phần công khai, khoá
   riêng không bao giờ rời data/tls.
   ==================================================================== */
import express from 'express';
import { lanChoices } from './tls.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

/** Tách vân tay 64 ký tự thành từng cụm 4 cặp cho dễ dò bằng mắt. */
const fingerprintGroups = (fp) => {
  const pairs = String(fp || '').split(':');
  const out = [];
  for (let i = 0; i < pairs.length; i += 4) out.push(pairs.slice(i, i + 4).join(''));
  return out;
};

function platformOf(ua) {
  if (/iPhone|iPad|iPod/i.test(ua)) return /CriOS|FxiOS|EdgiOS/i.test(ua) ? 'ios-other' : 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export default function phone(state) {
  const r = express.Router();

  r.get('/api/tls-info', (req, res) => {
    const info = state.info;
    res.json({
      enabled: state.enabled,
      https_port: state.enabled ? state.port : null,
      error: state.error || null,
      addresses: lanChoices(),
      ca_name: info?.caName || null,
      ca_fingerprint: info?.caFingerprint || null,
      ca_valid_to: info?.caValidTo || null,
      server_valid_to: info?.serverValidTo || null,
      secure: Boolean(req.socket.encrypted),
    });
  });

  r.get('/chung-chi-tiem.crt', (req, res) => {
    if (!state.info) return res.status(404).type('text/plain; charset=utf-8').send('Máy chủ chưa bật HTTPS.');
    /* DER + kiểu x-x509-ca-cert: iPhone mở Safari là hiện "Đã tải về hồ sơ",
       Android lưu vào Tải xuống để chọn trong Cài đặt → Chứng chỉ CA. */
    res.set({
      'Content-Type': 'application/x-x509-ca-cert',
      'Content-Disposition': 'attachment; filename="chung-chi-tiem-thanh-hoa.crt"',
      'Cache-Control': 'no-store',
    });
    res.send(state.info.caDer);
  });

  r.get('/dien-thoai', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.type('html').send(page(req, state));
  });

  return r;
}

/* ------------------------------------------------------------------ */

function page(req, state) {
  const secure = Boolean(req.socket.encrypted);
  const plat = platformOf(req.get('user-agent') || '');
  const info = state.info;
  const addrs = lanChoices();
  const host = req.hostname;
  /* Điện thoại gõ địa chỉ nào để tới được trang này thì dùng đúng địa chỉ
     đó cho https — chắc chắn là địa chỉ nó với tới được. */
  const phoneHost = addrs.some((a) => a.ip === host) ? host : null;
  const httpsUrl = (ip) => `https://${ip}:${state.port}`;
  const primary = phoneHost || addrs.find((a) => !a.virtual)?.ip || addrs[0]?.ip || null;

  const android = `
    <ol class="steps">
      <li>Bấm <b>Tải chứng chỉ</b> ở trên. Tệp <code>chung-chi-tiem-thanh-hoa.crt</code> nằm trong mục Tải xuống.</li>
      <li>Mở <b>Cài đặt</b> của điện thoại, gõ <b>chứng chỉ</b> vào ô tìm kiếm của Cài đặt.</li>
      <li>Chọn <b>Cài đặt chứng chỉ</b> → <b>Chứng chỉ CA</b>. Máy cảnh báo thì bấm <b>Vẫn cài đặt</b>.
        <div class="hint">Samsung: Sinh trắc học và bảo mật → Cài đặt bảo mật khác → Cài đặt từ bộ nhớ thiết bị → Chứng chỉ CA.</div></li>
      <li>Chọn tệp vừa tải. Điện thoại chưa đặt khoá màn hình thì Android bắt đặt mã PIN trước — đó là quy định của Android.</li>
      <li>Tắt hẳn Chrome rồi mở lại, bấm nút <b>Mở màn hình bán hàng</b> ở dưới.</li>
    </ol>`;
  const ios = `
    <ol class="steps">
      <li>Mở trang này bằng <b>Safari</b> (Chrome trên iPhone không tải chứng chỉ được), bấm <b>Tải chứng chỉ</b> → <b>Cho phép</b>.</li>
      <li>Mở <b>Cài đặt</b> → dòng <b>Đã tải về hồ sơ</b> ngay dưới tên máy → <b>Cài đặt</b>, nhập mật mã máy.</li>
      <li><b>Bước hay quên:</b> Cài đặt → Cài đặt chung → Giới thiệu → kéo xuống cuối →
        <b>Cài đặt tin cậy chứng nhận</b> → bật công tắc chứng chỉ Thạnh Hoà.</li>
      <li>Quay lại Chrome hay Safari, bấm <b>Mở màn hình bán hàng</b> ở dưới.</li>
    </ol>`;

  const guideAndroid = `<details ${plat === 'android' || plat === 'desktop' ? 'open' : ''}>
      <summary>Điện thoại Android</summary>${android}</details>`;
  const guideIos = `<details ${plat.startsWith('ios') ? 'open' : ''}>
      <summary>iPhone, iPad</summary>${ios}</details>`;
  const guides = plat.startsWith('ios') ? guideIos + guideAndroid : guideAndroid + guideIos;

  const fp = fingerprintGroups(info?.caFingerprint);

  const body = !state.enabled ? `
    <section class="card bad">
      <h2>Máy chủ chưa bật HTTPS</h2>
      <p>${esc(state.error || 'HTTPS đang tắt trong cấu hình máy chủ.')}</p>
      <p class="muted">Không có HTTPS thì điện thoại vẫn bán hàng được, chỉ không mở được camera quét mã.</p>
    </section>` : secure ? `
    <section class="card ok">
      <h2>${icon('check')} Điện thoại này đã sẵn sàng</h2>
      <p>Đang vào bằng địa chỉ bảo mật, camera quét mã dùng được.</p>
      <a class="btn" href="/pos">${icon('cart')} Mở màn hình bán hàng</a>
    </section>` : `
    ${plat === 'ios-other' ? `<section class="card warn"><p><b>Đang mở bằng Chrome trên iPhone.</b>
      Chép địa chỉ này sang <b>Safari</b> để tải chứng chỉ — iPhone chỉ cho cài từ Safari.</p></section>` : ''}

    <section class="card" id="status" data-probe="${primary ? esc(httpsUrl(primary)) : ''}">
      <p class="status wait">${icon('dot')} Đang kiểm tra điện thoại này đã cài chứng chỉ chưa…</p>
    </section>

    <section class="card">
      <h2><span class="num">1</span> Tải chứng chỉ của tiệm</h2>
      <p>Chỉ làm một lần cho mỗi điện thoại. Đổi mạng, đổi IP cũng không phải cài lại.</p>
      <a class="btn" href="/chung-chi-tiem.crt" download>${icon('download')} Tải chứng chỉ</a>
      <div class="meta">
        <div><span class="muted">Tên hiện trên điện thoại</span><b>${esc(info?.caName)}</b></div>
        <div><span class="muted">Vân tay SHA-256 (để đối chiếu)</span>
          <code class="fp">${fp.map(esc).join(' ')}</code></div>
      </div>
    </section>

    <section class="card">
      <h2><span class="num">2</span> Cài vào điện thoại</h2>
      ${guides}
    </section>

    <section class="card">
      <h2><span class="num">3</span> Mở phần mềm bằng địa chỉ bảo mật</h2>
      ${primary ? `<a class="btn" href="${esc(httpsUrl(primary))}/pos">${icon('cart')} Mở màn hình bán hàng</a>
        <p class="addr">${esc(httpsUrl(primary))}</p>` : '<p>Máy chủ không có địa chỉ mạng nội bộ nào.</p>'}
      ${addrs.length > 1 && !phoneHost ? `<p class="muted">Máy chủ có nhiều địa chỉ. Địa chỉ trên không mở được thì thử:</p>
        <ul class="alts">${addrs.filter((a) => a.ip !== primary).map((a) => `<li><a href="${esc(httpsUrl(a.ip))}/pos">${esc(httpsUrl(a.ip))}</a>
          <span class="muted">${esc(a.iface)}${a.virtual ? ' · card mạng ảo' : ''}</span></li>`).join('')}</ul>` : ''}
      <p class="muted">Mở được rồi thì bấm menu Chrome → <b>Thêm vào màn hình chính</b>, lần sau bấm biểu tượng là vào thẳng.</p>
    </section>`;

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#334155">
<title>Bán hàng trên điện thoại</title>
<style>
  :root { --ink:#0F172A; --muted:#475569; --line:#E2E8F0; --surface:#F8FAFC; --card:#fff;
          --accent:#047857; --accent-soft:#D1FAE5; --bad:#B91C1C; --warn:#92400E; --primary:#334155; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--surface); color:var(--ink); font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  header { background:var(--primary); color:#fff; padding:16px; }
  header h1 { margin:0; font-size:19px; font-weight:700; display:flex; align-items:center; gap:8px; }
  header p { margin:4px 0 0; color:#CBD5E1; font-size:14px; }
  main { max-width:560px; margin:0 auto; padding:12px 16px 32px; display:grid; gap:12px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; }
  .card.ok { border-color:#6EE7B7; background:#ECFDF5; }
  .card.bad { border-color:#FCA5A5; background:#FEF2F2; }
  .card.warn { border-color:#FCD34D; background:#FFFBEB; color:var(--warn); }
  h2 { margin:0 0 6px; font-size:17px; display:flex; align-items:center; gap:8px; }
  p { margin:6px 0; }
  .muted { color:var(--muted); font-size:14px; }
  .num { width:26px; height:26px; border-radius:50%; background:var(--accent); color:#fff; font-size:14px;
         display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; }
  .btn { display:flex; align-items:center; justify-content:center; gap:8px; min-height:48px; margin-top:10px;
         background:var(--accent); color:#fff; text-decoration:none; font-weight:700; border-radius:8px; padding:0 16px; }
  .btn:active { background:#065F46; }
  .btn.ghost { background:#fff; color:var(--accent); border:1px solid var(--accent); }
  .meta { margin-top:12px; display:grid; gap:8px; font-size:14px; }
  .meta div { display:grid; gap:2px; }
  code { font-family:ui-monospace,Consolas,monospace; font-size:13px; background:var(--surface); padding:1px 4px; border-radius:4px; }
  .fp { display:block; line-height:1.7; word-spacing:4px; padding:6px 8px; }
  details { border-top:1px solid var(--line); padding:10px 0 2px; }
  details:first-of-type { border-top:0; }
  summary { font-weight:700; cursor:pointer; min-height:44px; display:flex; align-items:center; list-style:none; }
  summary::-webkit-details-marker { display:none; }
  /* display:flex làm mất tam giác mặc định — vẽ lại mũi tên để biết bấm mở được */
  summary::after { content:''; width:8px; height:8px; margin:0 6px 4px auto; border-right:2px solid var(--muted);
                   border-bottom:2px solid var(--muted); transform:rotate(45deg); transition:transform .15s; }
  details[open] > summary::after { transform:rotate(-135deg); margin-bottom:-4px; }
  .steps { margin:6px 0 0; padding-left:22px; display:grid; gap:8px; }
  .hint { color:var(--muted); font-size:14px; margin-top:2px; }
  .addr { font-family:ui-monospace,Consolas,monospace; text-align:center; color:var(--muted); font-size:14px; }
  .alts { padding-left:18px; margin:4px 0; display:grid; gap:4px; font-size:14px; }
  .alts a { color:var(--accent); font-weight:600; word-break:break-all; }
  .status { display:flex; align-items:center; gap:8px; margin:0; font-weight:600; }
  .status.wait { color:var(--muted); }
  .status.good { color:var(--accent); }
  .status.no { color:var(--warn); }
  svg { width:20px; height:20px; flex-shrink:0; }
  footer { max-width:560px; margin:0 auto; padding:0 16px 24px; color:var(--muted); font-size:13px; }
</style>
</head>
<body>
<header>
  <h1>${icon('phone')} Bán hàng trên điện thoại</h1>
  <p>Cài một lần để điện thoại quét mã vạch bằng camera và bán hàng như một máy thu ngân riêng.</p>
</header>
<main>${body}</main>
<footer>
  Chứng chỉ này chỉ có hiệu lực với địa chỉ mạng trong tiệm (192.168.x, 10.x, 172.16–31.x).
  Nó không thể dùng để giả trang web nào khác trên Internet. Đừng mở cổng máy chủ ra Internet.
</footer>
<script>
(function () {
  var box = document.getElementById('status');
  if (!box || !box.dataset.probe) return;
  var url = box.dataset.probe;
  function show(ok) {
    box.className = 'card' + (ok ? ' ok' : '');
    box.innerHTML = ok
      ? '<p class="status good">${icon('check')} Điện thoại này đã tin chứng chỉ của tiệm.</p>'
        + '<a class="btn" href="' + url + '/pos">${icon('cart')} Mở màn hình bán hàng</a>'
      : '<p class="status no">${icon('info')} Điện thoại này chưa cài chứng chỉ, hoặc cài chưa xong.</p>'
        + '<p class="muted">Làm theo 3 bước dưới đây. Cài xong thì quay lại trang này, bấm Kiểm tra lại.</p>'
        + '<a class="btn ghost" href="" onclick="location.reload();return false;">Kiểm tra lại</a>';
  }
  var done = false;
  var timer = setTimeout(function () { if (!done) { done = true; show(false); } }, 6000);
  fetch(url + '/api/tls-info', { cache: 'no-store' })
    .then(function (r) { if (!done) { done = true; clearTimeout(timer); show(r.ok); } })
    .catch(function () { if (!done) { done = true; clearTimeout(timer); show(false); } });
})();
</script>
</body>
</html>`;
}

/* Biểu tượng nét mảnh kiểu lucide, nhúng thẳng — trang này không tải gì từ ngoài */
function icon(name) {
  const paths = {
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2.5 3h2.6l2.4 12h11l2-8H6.3"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M11 12h1v5h1"/>',
    dot: '<circle cx="12" cy="12" r="4"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}
