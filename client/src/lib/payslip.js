/* ====================================================================
   PHIẾU LƯƠNG (plan 28, §7.4, §9)

   Dựng các dòng của phiếu lương MỘT lần, rồi dùng chung cho màn hình và
   cho ảnh PNG gửi Zalo — hai nơi không bao giờ lệch nhau một dòng.

   Nguồn là ảnh chụp chi tiết lưu lúc chốt (payroll_settlements.detail):
   sau này sửa hồ sơ, sửa đơn giá thì phiếu cũ in lại vẫn y như ngày trả.
   ==================================================================== */
import { n } from './format';

const vn = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const dm = (iso) => vn(iso).slice(0, 5);
const signed = (v) => (v > 0 ? `+${n(v)}` : v < 0 ? `−${n(-v)}` : '0');
const hoursText = (h) => String(Math.round(Number(h) * 100) / 100).replace('.', ',');

/**
 * Các dòng tiền của một kỳ (hoặc một đợt trả lương ngày).
 * kind: line | gift | note | sub
 */
function periodRows(p, daily) {
  const rows = [];
  const s = p.summary || {};
  const entries = p.entries || [];

  if (daily) {
    rows.push({ kind: 'line', label: `Lương ${n(p.work_days)} ngày công × ${n(p.day_rate)}`, amount: p.wage });
    for (const d of (p.days || []).filter((x) => x.status !== 'work')) {
      rows.push({
        kind: 'note',
        label: d.status === 'closed' ? `Tiệm nghỉ ngày ${dm(d.date)} — không tính lương` : `Nghỉ ngày ${dm(d.date)}`,
        amount: 0,
      });
    }
  } else {
    rows.push(p.is_partial
      ? { kind: 'line', label: `Lương ${n(p.work_days)} ngày (kỳ lẻ: ${n(p.monthly_wage)} ÷ 30 × ${n(p.work_days)})`, amount: p.base }
      : { kind: 'line', label: 'Lương tháng', amount: p.base });
    /* Dòng "khoe cái tâm của chủ": chỉ kỳ tròn rơi vào tháng Âm thiếu */
    if (p.gift_day) rows.push({ kind: 'gift', label: 'Số ngày chủ tặng thêm: +1 ngày công (Tháng thiếu)', amount: null });
    if (s.absent_days) {
      rows.push({ kind: 'line', label: `Nghỉ ${n(s.absent_days)} ngày × ${n(p.day_rate)}`, amount: s.absent_amount });
    }
    if (s.closed_days) {
      rows.push({ kind: 'line', label: `Tiệm nghỉ ${n(s.closed_days)} ngày — không tính lương`, amount: s.closed_amount });
    }
  }
  for (const e of entries.filter((x) => x.type === 'absent_hour')) {
    rows.push(e.counted
      ? { kind: 'line', label: `Nghỉ ${hoursText(e.hours)} giờ ngày ${dm(e.work_date)} × ${n(p.hour_rate)}/giờ`, amount: e.amount }
      : { kind: 'note', label: `Nghỉ ${hoursText(e.hours)} giờ ngày ${dm(e.work_date)} — chủ cho qua`, amount: 0 });
  }
  for (const e of entries.filter((x) => x.type === 'advance')) {
    rows.push({ kind: 'line', label: `Ứng ngày ${dm(e.work_date)}${e.reason ? `: ${e.reason}` : ''}`, amount: e.amount });
  }
  for (const e of entries.filter((x) => x.type === 'purchase')) {
    rows.push({
      kind: 'line',
      label: e.amount < 0 ? `Mua hàng ghi sổ ${e.ref_code || ''} (${dm(e.work_date)})` : `Hoàn lại tiền hàng ${e.ref_code || ''}`,
      amount: e.amount,
    });
  }
  for (const e of entries.filter((x) => x.type === 'bonus')) {
    rows.push(e.merged
      ? { kind: 'line', label: `Thưởng: ${e.reason || ''}`, amount: e.amount }
      : { kind: 'note', label: `Thưởng ${n(e.amount)}: ${e.reason || ''} — đã đưa tiền mặt ngày ${dm(e.work_date)}, không cộng vào bảng này`, amount: null });
  }
  for (const e of entries.filter((x) => x.type === 'adjust')) {
    rows.push({ kind: 'line', label: `${e.amount >= 0 ? 'Cộng thêm' : 'Trừ'}: ${e.reason || ''}`, amount: e.amount });
  }
  return rows;
}

/** Toàn bộ phiếu lương: tiêu đề, từng kỳ, tổng. */
export function payslipModel(settlement) {
  const d = settlement?.detail || {};
  const emp = d.employee || {};
  const blocks = [];
  if (d.daily) {
    const p = d.daily;
    blocks.push({
      title: p.from ? `Lương ngày ${vn(p.from)}${p.to && p.to !== p.from ? ` – ${vn(p.to)}` : ''}` : 'Cấn trừ các khoản phát sinh',
      subtitle: '',
      rows: periodRows(p, true),
      total: null,
    });
  }
  for (const c of d.cycles || []) {
    blocks.push({
      title: `Kỳ lương ${c.label}`,
      subtitle: `Từ ${c.lunar_from.slice(0, 5)} đến ${c.lunar_to.slice(0, 5)} Âm lịch (${vn(c.date_from)} – ${vn(c.date_to)})`,
      rows: periodRows(c, false),
      total: (d.cycles || []).length > 1 ? { label: 'Cộng kỳ này', amount: c.net } : null,
    });
  }
  const tail = [];
  if (d.carry_in) tail.push({ kind: 'line', label: 'Còn nợ từ phiếu lương trước', amount: d.carry_in });
  return {
    code: settlement.code,
    date: vn(settlement.ts),
    employee: emp,
    heading: d.daily ? 'PHIẾU LƯƠNG NGÀY' : (d.cycles || []).length > 1
      ? `PHIẾU LƯƠNG GỘP ${(d.cycles || []).length} KỲ` : 'PHIẾU LƯƠNG',
    blocks,
    tail,
    pay: d.pay ?? settlement.pay_amount,
    carry_out: d.carry_out ?? settlement.carry_out,
    earned: d.earned ?? settlement.earned,
  };
}

export { signed as signedMoney };

/* ------------------------------------------------------------------ */
/* Vẽ phiếu lương ra ảnh PNG (§7.4)                                     */
/*                                                                     */
/* Tự vẽ trên canvas, không kéo thư viện chụp màn hình: phiếu lương chỉ */
/* là chữ và đường kẻ. Cỡ chữ to để mở trên điện thoại đọc được ngay.  */
/* ------------------------------------------------------------------ */

const W = 760;
const PAD = 36;
const FONT = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export function drawPayslip(model, store = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const scale = 2;
  const amountW = 170;
  const labelW = W - PAD * 2 - amountW - 16;

  /* Lượt 1: đo chiều cao; lượt 2: vẽ thật */
  const ops = [];
  let y = PAD;
  const push = (h, fn) => { const top = y; ops.push(() => fn(top)); y += h; };

  push(34, (t) => { ctx.font = `700 22px ${FONT}`; ctx.fillStyle = '#064e3b'; ctx.fillText(store.name || 'CỬA HÀNG', PAD, t + 24); });
  if (store.address || store.phone) {
    push(22, (t) => {
      ctx.font = `14px ${FONT}`; ctx.fillStyle = '#475569';
      ctx.fillText([store.address, store.phone && `ĐT: ${store.phone}`].filter(Boolean).join(' · '), PAD, t + 16);
    });
  }
  push(18, () => {});
  push(40, (t) => {
    ctx.font = `800 28px ${FONT}`; ctx.fillStyle = '#0f172a'; ctx.textAlign = 'center';
    ctx.fillText(model.heading, W / 2, t + 30); ctx.textAlign = 'left';
  });
  push(26, (t) => {
    ctx.font = `15px ${FONT}`; ctx.fillStyle = '#475569'; ctx.textAlign = 'center';
    ctx.fillText(`Số ${model.code} · ngày ${model.date}`, W / 2, t + 18); ctx.textAlign = 'left';
  });
  push(12, () => {});
  push(34, (t) => {
    ctx.font = `700 21px ${FONT}`; ctx.fillStyle = '#0f172a';
    ctx.fillText(`${model.employee.full_name || ''}${model.employee.code ? `  (${model.employee.code})` : ''}`, PAD, t + 24);
  });

  const line = (t) => { ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(PAD, t); ctx.lineTo(W - PAD, t); ctx.stroke(); };

  for (const b of model.blocks) {
    push(16, (t) => line(t + 8));
    ctx.font = `700 18px ${FONT}`;
    push(30, (t) => { ctx.font = `700 18px ${FONT}`; ctx.fillStyle = '#065f46'; ctx.fillText(b.title, PAD, t + 22); });
    if (b.subtitle) {
      ctx.font = `14px ${FONT}`;
      for (const l of wrapText(ctx, b.subtitle, W - PAD * 2)) {
        push(22, (t) => { ctx.font = `14px ${FONT}`; ctx.fillStyle = '#475569'; ctx.fillText(l, PAD, t + 16); });
      }
    }
    push(6, () => {});
    for (const r of b.rows) {
      const gift = r.kind === 'gift';
      const note = r.kind === 'note';
      const font = gift ? `700 17px ${FONT}` : note ? `italic 15px ${FONT}` : `17px ${FONT}`;
      ctx.font = font;
      const lines = wrapText(ctx, r.label, gift ? W - PAD * 2 - 24 : labelW);
      const h = lines.length * 24 + (gift ? 14 : 6);
      push(h, (t) => {
        if (gift) {
          ctx.fillStyle = '#ecfdf5'; ctx.fillRect(PAD, t, W - PAD * 2, h - 4);
          ctx.fillStyle = '#047857'; ctx.fillRect(PAD, t, 4, h - 4);
        }
        ctx.font = font;
        ctx.fillStyle = gift ? '#065f46' : note ? '#64748b' : '#1e293b';
        lines.forEach((l, i) => ctx.fillText(l, PAD + (gift ? 14 : 0), t + 19 + i * 24 + (gift ? 5 : 0)));
        if (r.amount !== null && r.amount !== undefined) {
          ctx.font = `600 17px ${FONT}`; ctx.textAlign = 'right';
          ctx.fillStyle = r.amount < 0 ? '#b91c1c' : '#0f172a';
          ctx.fillText(signed(r.amount), W - PAD, t + 19);
          ctx.textAlign = 'left';
        }
      });
    }
    if (b.total) {
      push(34, (t) => {
        line(t + 4);
        ctx.font = `700 17px ${FONT}`; ctx.fillStyle = '#0f172a'; ctx.fillText(b.total.label, PAD, t + 26);
        ctx.textAlign = 'right'; ctx.fillText(n(b.total.amount), W - PAD, t + 26); ctx.textAlign = 'left';
      });
    }
  }
  for (const r of model.tail) {
    push(32, (t) => {
      line(t + 4);
      ctx.font = `17px ${FONT}`; ctx.fillStyle = '#1e293b'; ctx.fillText(r.label, PAD, t + 26);
      ctx.textAlign = 'right'; ctx.fillStyle = '#b91c1c'; ctx.fillText(signed(r.amount), W - PAD, t + 26); ctx.textAlign = 'left';
    });
  }
  push(20, () => {});
  push(64, (t) => {
    ctx.fillStyle = '#064e3b'; ctx.fillRect(PAD, t, W - PAD * 2, 56);
    ctx.fillStyle = '#ffffff'; ctx.font = `700 20px ${FONT}`; ctx.fillText('THỰC NHẬN', PAD + 18, t + 36);
    ctx.textAlign = 'right'; ctx.font = `800 26px ${FONT}`; ctx.fillText(`${n(model.pay)} đ`, W - PAD - 18, t + 38); ctx.textAlign = 'left';
  });
  if (model.carry_out < 0) {
    push(34, (t) => {
      ctx.font = `600 17px ${FONT}`; ctx.fillStyle = '#b45309';
      ctx.fillText(`Còn nợ chuyển sang kỳ sau: ${n(-model.carry_out)} đ`, PAD, t + 24);
    });
  }
  push(PAD, () => {});

  canvas.width = W * scale;
  canvas.height = y * scale;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, y);
  ctx.textBaseline = 'alphabetic';
  for (const op of ops) op();
  return canvas;
}

/** Xuất ảnh phiếu lương: điện thoại có "chia sẻ" thì mở thẳng hộp chia sẻ (Zalo), không thì tải về. */
export async function exportPayslip(model, store) {
  const canvas = drawPayslip(model, store);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Trình duyệt không tạo được ảnh');
  const safe = String(model.employee.full_name || 'nhan-vien').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^A-Za-z0-9]+/g, '-');
  const name = `phieu-luong-${safe}-${model.code}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `Phiếu lương ${model.employee.full_name || ''}` });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
