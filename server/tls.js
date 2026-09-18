/* ====================================================================
   HTTPS NỘI BỘ CHO ĐIỆN THOẠI BÁN HÀNG (plan 31, hạng mục 2b)

   Trình duyệt chỉ cho mở camera trong trang trên `https://` hoặc
   `localhost`. Điện thoại vào máy chủ tiệm bằng `http://192.168.x.x` thì
   camera bị chặn hẳn — quy tắc của trình duyệt, không phải cấu hình sai.

   Cách làm: máy chủ tự dựng MỘT chứng chỉ gốc của tiệm (CA nội bộ), dùng
   nó ký chứng chỉ cho địa chỉ LAN của chính máy chủ. Mỗi điện thoại cài
   chứng chỉ gốc một lần là từ đó mở https sạch, không cảnh báo đỏ.

   Hai chỗ phải giữ cho an toàn:
   - Chứng chỉ gốc bị KHOÁ PHẠM VI (Name Constraints): chỉ ký được cho địa
     chỉ mạng nội bộ 10.x, 172.16–31.x, 192.168.x, 127.x và "localhost".
     Lỡ ai lấy được khoá riêng của tiệm cũng không giả được ngân hàng hay
     Google trên điện thoại đã cài — trình duyệt từ chối.
   - Khoá riêng nằm trong data/tls, cùng chỗ với dữ liệu thật của tiệm,
     không bao giờ lên git.

   Đổi mạng, máy chủ nhận IP mới: chứng chỉ máy chủ tự cấp lại bằng CÙNG
   chứng chỉ gốc, nên điện thoại không phải cài lại gì.

   Không thêm thư viện: Node không có hàm dựng chứng chỉ X.509, nên ở đây
   tự mã hoá ASN.1 DER — chừng trăm dòng, soát được bằng X509Certificate
   của chính Node và bằng openssl.
   ==================================================================== */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DAY = 86400000;
/* iOS không nhận chứng chỉ máy chủ dài quá 825 ngày, kể cả của CA tự cài */
const SERVER_DAYS = 800;
const CA_YEARS = 20;
/* Còn chừng này ngày là cấp lại chứng chỉ máy chủ, khỏi đợi hết hạn mới hỏng */
const RENEW_BEFORE_DAYS = 45;

/* --------------------------- Mã hoá ASN.1 DER --------------------------- */

function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let x = n; x > 0; x >>= 8) bytes.unshift(x & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
};
const seq = (...p) => tlv(0x30, ...p);
const set = (...p) => tlv(0x31, ...p);
const octet = (b) => tlv(0x04, b);
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const NULL = Buffer.from([0x05, 0x00]);

function int(buf) {
  let b = Buffer.from(buf);
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);   // giữ số dương
  return tlv(0x02, b);
}

function oid(dotted) {
  const a = dotted.split('.').map(Number);
  const out = [40 * a[0] + a[1]];
  for (const v of a.slice(2)) {
    const chunk = [v & 0x7f];
    for (let x = Math.floor(v / 128); x > 0; x = Math.floor(x / 128)) chunk.unshift((x & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

/** BIT STRING của keyUsage: bit 0 là bit cao nhất, bỏ bit 0 thừa ở đuôi. */
function keyUsageBits(bits) {
  let v = 0;
  for (const b of bits) v |= 0x80 >> b;
  let unused = 0;
  while (unused < 7 && !(v & (1 << unused))) unused += 1;
  return tlv(0x03, Buffer.from([unused, v]));
}

/** Trước 2050 dùng UTCTime, từ 2050 dùng GeneralizedTime (RFC 5280). */
function derTime(d) {
  const iso = d.toISOString();            // 2026-09-16T10:11:12.345Z
  const full = iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10)
    + iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19) + 'Z';
  return d.getUTCFullYear() < 2050
    ? tlv(0x17, Buffer.from(full.slice(2), 'ascii'))
    : tlv(0x18, Buffer.from(full, 'ascii'));
}

const OID = {
  sha256WithRSA: '1.2.840.113549.1.1.11',
  org: '2.5.4.10',
  cn: '2.5.4.3',
  subjectKeyId: '2.5.29.14',
  keyUsage: '2.5.29.15',
  subjectAltName: '2.5.29.17',
  basicConstraints: '2.5.29.19',
  nameConstraints: '2.5.29.30',
  authorityKeyId: '2.5.29.35',
  extKeyUsage: '2.5.29.37',
  serverAuth: '1.3.6.1.5.5.7.3.1',
};

const nameDer = (org, cn) => seq(
  set(seq(oid(OID.org), utf8(org))),
  set(seq(oid(OID.cn), utf8(cn))),
);
const ext = (id, critical, value) => (critical
  ? seq(oid(id), bool(true), octet(value))
  : seq(oid(id), octet(value)));

const ipBytes = (ip) => Buffer.from(ip.split('.').map(Number));

/* ------------------------------ Đọc DER ------------------------------ */

/** Một phần tử DER tại vị trí `at`: thẻ, chỗ bắt đầu và kết thúc phần thân. */
function readTlv(buf, at) {
  let len = buf[at + 1];
  let hdr = 2;
  if (len & 0x80) {
    const nBytes = len & 0x7f;
    len = 0;
    for (let i = 0; i < nBytes; i += 1) len = len * 256 + buf[at + 2 + i];
    hdr += nBytes;
  }
  return { tag: buf[at], at, start: at + hdr, end: at + hdr + len };
}

/** Các phần tử con nằm trong thân của một SEQUENCE. */
function children(buf, node) {
  const out = [];
  for (let at = node.start; at < node.end;) {
    const c = readTlv(buf, at);
    out.push(c);
    at = c.end;
  }
  return out;
}

/** Mã khoá theo RFC 5280 §4.2.1.2: SHA-1 của phần khoá nằm trong BIT STRING. */
function keyId(publicKey) {
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const [, bits] = children(spki, readTlv(spki, 0));     // SEQ { thuật toán, BIT STRING }
  return crypto.createHash('sha1').update(spki.subarray(bits.start + 1, bits.end)).digest();
}

/**
 * Tên chủ thể của một chứng chỉ, lấy nguyên byte. Tên người cấp trong
 * chứng chỉ máy chủ phải trùng TỪNG BYTE với tên chứng chỉ gốc — dựng lại
 * từ chữ thì dễ lệch cách mã hoá tiếng Việt.
 */
function subjectDer(certDer) {
  const [tbs] = children(certDer, readTlv(certDer, 0));
  const f = children(certDer, tbs);   // [0]phiên bản, số seri, thuật toán, người cấp, hạn, chủ thể…
  const subject = f[0].tag === 0xa0 ? f[5] : f[4];
  return certDer.subarray(subject.at, subject.end);
}

function signCert({ subject, issuer, publicKey, signKey, days, extensions, notBefore }) {
  const serial = crypto.randomBytes(16);
  serial[0] &= 0x7f;
  serial[0] |= 0x01;                          // khác 0 để khỏi bị rút gọn
  const from = notBefore || new Date(Date.now() - DAY);  // lùi một ngày phòng đồng hồ lệch
  const to = new Date(from.getTime() + days * DAY);
  const tbs = seq(
    tlv(0xa0, int(Buffer.from([2]))),          // phiên bản v3
    int(serial),
    seq(oid(OID.sha256WithRSA), NULL),
    issuer,
    seq(derTime(from), derTime(to)),
    subject,
    publicKey.export({ type: 'spki', format: 'der' }),
    tlv(0xa3, seq(...extensions)),
  );
  const sig = crypto.sign('sha256', tbs, signKey);
  return seq(tbs, seq(oid(OID.sha256WithRSA), NULL), tlv(0x03, Buffer.from([0]), sig));
}

const pem = (der, label = 'CERTIFICATE') => `-----BEGIN ${label}-----\n`
  + der.toString('base64').match(/.{1,64}/g).join('\n')
  + `\n-----END ${label}-----\n`;

/* --------------------------- Địa chỉ nội bộ --------------------------- */

/** Chỉ các dải mạng nội bộ — cũng là phạm vi chứng chỉ gốc được phép ký. */
export const PRIVATE_RANGES = [
  ['10.0.0.0', '255.0.0.0'],
  ['172.16.0.0', '255.240.0.0'],
  ['192.168.0.0', '255.255.0.0'],
  ['127.0.0.0', '255.0.0.0'],
];

export function isPrivateIPv4(ip) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const a = ipBytes(ip);
  return PRIVATE_RANGES.some(([net, mask]) => {
    const n = ipBytes(net); const m = ipBytes(mask);
    return a.every((x, i) => (x & m[i]) === n[i]);
  });
}

/* Card mạng do phần mềm máy ảo, VPN dựng ra — điện thoại không với tới được */
const VIRTUAL_NIC = /vmware|virtualbox|vbox|vethernet|hyper-v|wsl|docker|loopback|tailscale|zerotier|hamachi|radmin/i;

/**
 * IPv4 nội bộ của máy chủ kèm tên card mạng, card thật xếp trước. Bỏ qua
 * địa chỉ công cộng và VPN kiểu 100.x — chứng chỉ gốc không ký được cho chúng.
 */
export function lanChoices() {
  const seen = new Map();
  for (const [iface, list] of Object.entries(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' || ni.internal || !isPrivateIPv4(ni.address) || seen.has(ni.address)) continue;
      seen.set(ni.address, { ip: ni.address, iface, virtual: VIRTUAL_NIC.test(iface) });
    }
  }
  return [...seen.values()].sort((a, b) => (a.virtual - b.virtual) || a.ip.localeCompare(b.ip));
}

/** IPv4 nội bộ của máy chủ, để ghi vào chứng chỉ. Ghi cả card ảo cho chắc. */
export function privateLanIPs() {
  return lanChoices().map((a) => a.ip).sort();
}

/* ------------------------------ Cấp chứng chỉ ------------------------------ */

const STORE = 'Tiệm điện Thạnh Hoà';

function newCA() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const tag = crypto.randomBytes(2).toString('hex').toUpperCase();
  const name = nameDer(STORE, `Chứng chỉ nội bộ Thạnh Hoà POS ${tag}`);
  const kid = keyId(publicKey);
  const permitted = [
    ...PRIVATE_RANGES.map(([net, mask]) => seq(tlv(0x87, ipBytes(net), ipBytes(mask)))),
    seq(tlv(0x82, Buffer.from('localhost', 'ascii'))),
  ];
  const der = signCert({
    subject: name, issuer: name, publicKey, signKey: privateKey, days: CA_YEARS * 365,
    extensions: [
      ext(OID.basicConstraints, true, seq(bool(true), int(Buffer.from([0])))),
      ext(OID.keyUsage, true, keyUsageBits([5, 6])),          // keyCertSign, cRLSign
      ext(OID.subjectKeyId, false, octet(kid)),
      ext(OID.nameConstraints, true, seq(tlv(0xa0, ...permitted))),
    ],
  });
  return { key: privateKey, der };
}

function newServerCert(ca, ips) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const caKid = keyId(new crypto.X509Certificate(ca.der).publicKey);
  const altNames = [
    tlv(0x82, Buffer.from('localhost', 'ascii')),
    ...['127.0.0.1', ...ips.filter((ip) => ip !== '127.0.0.1')].map((ip) => tlv(0x87, ipBytes(ip))),
  ];
  const der = signCert({
    subject: nameDer(STORE, 'Máy chủ bán hàng Thạnh Hoà'),
    issuer: subjectDer(ca.der),
    publicKey, signKey: ca.key, days: SERVER_DAYS,
    extensions: [
      ext(OID.basicConstraints, true, seq()),
      ext(OID.keyUsage, true, keyUsageBits([0, 2])),          // digitalSignature, keyEncipherment
      ext(OID.extKeyUsage, false, seq(oid(OID.serverAuth))),
      ext(OID.subjectAltName, false, seq(...altNames)),
      ext(OID.subjectKeyId, false, octet(keyId(publicKey))),
      ext(OID.authorityKeyId, false, seq(tlv(0x80, caKid))),
    ],
  });
  return { key: privateKey, der };
}

/** Tên thường gọi (CN) để hiện cho người xem, không dùng để ký. */
function commonName(x) {
  const line = x.subject.split('\n').find((l) => l.startsWith('CN='));
  return line ? line.slice(3) : '';
}

const writeAtomic = (file, data) => {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
};

function loadPair(dir, base) {
  try {
    const cert = fs.readFileSync(path.join(dir, `${base}.pem`), 'utf8');
    const key = fs.readFileSync(path.join(dir, `${base}-key.pem`), 'utf8');
    return { x: new crypto.X509Certificate(cert), certPem: cert, key: crypto.createPrivateKey(key), keyPem: key };
  } catch {
    return null;
  }
}

function savePair(dir, base, { key, der }) {
  const keyPem = key.export({ type: 'pkcs8', format: 'pem' });
  writeAtomic(path.join(dir, `${base}-key.pem`), keyPem);
  writeAtomic(path.join(dir, `${base}.pem`), pem(der));
  return { x: new crypto.X509Certificate(der), certPem: pem(der), key, keyPem };
}

/** Lý do phải cấp lại chứng chỉ máy chủ, hoặc rỗng nếu còn dùng được. */
function serverCertProblem(server, ca, ips, now) {
  if (!server) return 'chưa có';
  if (!server.x.checkIssued(ca.x) || !server.x.verify(ca.x.publicKey)) return 'không do chứng chỉ gốc hiện tại ký';
  if (new Date(server.x.validTo).getTime() - now < RENEW_BEFORE_DAYS * DAY) return 'sắp hết hạn';
  const missing = ips.filter((ip) => !server.x.checkIP(ip));
  if (missing.length) return `chưa có địa chỉ ${missing.join(', ')}`;
  return '';
}

/**
 * Bảo đảm có đủ chứng chỉ gốc + chứng chỉ máy chủ cho các địa chỉ hiện tại.
 * Thiếu gì cấp nấy; chứng chỉ gốc có sẵn thì KHÔNG BAO GIỜ tạo lại, vì tạo
 * lại là mọi điện thoại phải cài lại.
 */
export function ensureTls(dir, { ips = privateLanIPs(), now = Date.now() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  let ca = loadPair(dir, 'ca');
  let createdCA = false;
  if (!ca || new Date(ca.x.validTo).getTime() <= now) {
    ca = savePair(dir, 'ca', newCA());
    createdCA = true;
  }

  let server = loadPair(dir, 'server');
  const problem = createdCA ? 'có chứng chỉ gốc mới' : serverCertProblem(server, ca, ips, now);
  if (problem) server = savePair(dir, 'server', newServerCert({ key: ca.key, der: ca.x.raw }, ips));

  return {
    key: server.keyPem,
    cert: server.certPem,
    caDer: ca.x.raw,
    caPem: ca.certPem,
    caName: commonName(ca.x),
    caFingerprint: ca.x.fingerprint256,
    caValidTo: ca.x.validTo,
    serverValidTo: server.x.validTo,
    serverAltNames: server.x.subjectAltName,
    ips,
    createdCA,
    reissued: problem || '',
  };
}
