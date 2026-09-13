/* ====================================================================
   HÀNG MUA HỘ VÃNG LAI VÀ ĐỐI SOÁT VỚI CHỦ HÀNG (tài liệu 24, phần 5)

   Khách hỏi một món tiệm không có sẵn. Hai cách xử:

     A. Tiệm tự chạy đi bốc ngoài, trả đứt tiền mặt tại chỗ, mua 30 bán 32
        rồi ăn chênh lệch. KHÔNG treo công nợ với ai — dòng hàng chỉ mang
        giá bốc để tính đúng lãi của đơn.

     B. Hàng của người khác gửi bán (anh ruột, cô Hà...). Tiệm bán giùm,
        giữ lại hoa hồng, phần còn lại là TIỀN NỢ CHỦ HÀNG. Một hoá đơn
        chứa được hàng của nhiều chủ khác nhau.

   Chủ hàng vãng lai KHÔNG phải nhà cung cấp: không nhập kho, không sinh
   mã hàng, không dính vào công nợ mua hàng. Để chung một chỗ là báo cáo
   tồn kho và giá vốn bình quân sai ngay.

   Hoá đơn in cho khách KHÔNG bao giờ lộ hàng lấy của ai — chỗ ẩn nằm ở
   mẫu in, còn ở đây chỉ cần đừng nhét tên chủ hàng vào tên món.
   ==================================================================== */
import { Router } from 'express';
import {
  all, get, run, tx, pageParams, addCashTx, defaultCashAccount, nextCode, searchWhere,
} from '../db.js';

const r = Router();
const fail = (res, e) => res.status(e.status || 400).json({ error: e.message, code: e.code });
const badRequest = (message, code) => Object.assign(new Error(message), { status: 400, code });

/* ==================== HỒ SƠ CHỦ HÀNG VÃNG LAI ===================== */

r.get('/consign-partners', (req, res) => {
  const { q = '', active } = req.query;
  const where = [];
  const params = [];
  if (String(q).trim()) {
    const c = searchWhere(['p.name', 'p.phone', 'p.note'], q);
    where.push(c.sql);
    params.push(...c.params);
  }
  if (active !== undefined && active !== '') { where.push('p.active = ?'); params.push(Number(active)); }
  const rows = all(`
    SELECT p.*,
           /* Còn nợ chủ hàng bao nhiêu: tiền bán hộ chưa chốt đối soát,
              trừ đi phần hoa hồng tiệm giữ lại */
           COALESCE((SELECT SUM(ci.amount - ci.commission) FROM sale_consign_items ci
                      WHERE ci.partner_id = p.id AND ci.settlement_id IS NULL), 0) AS owed,
           COALESCE((SELECT COUNT(*) FROM sale_consign_items ci
                      WHERE ci.partner_id = p.id AND ci.settlement_id IS NULL), 0) AS open_items
    FROM consign_partners p
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY p.active DESC, p.name`, params);
  res.json(rows);
});

r.post('/consign-partners', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Bắt buộc nhập tên chủ hàng.' });
  const info = run('INSERT INTO consign_partners(name, phone, note) VALUES(?, ?, ?)',
    [name, String(req.body.phone || '').trim() || null, req.body.note || null]);
  res.json(get('SELECT * FROM consign_partners WHERE id = ?', [Number(info.lastInsertRowid)]));
});

r.put('/consign-partners/:id', (req, res) => {
  const p = get('SELECT * FROM consign_partners WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy chủ hàng' });
  const name = String(req.body?.name ?? p.name).trim();
  if (!name) return res.status(400).json({ error: 'Bắt buộc nhập tên chủ hàng.' });
  run('UPDATE consign_partners SET name = ?, phone = ?, note = ?, active = ? WHERE id = ?',
    [name, String(req.body.phone ?? p.phone ?? '').trim() || null,
      req.body.note ?? p.note, req.body.active === 0 ? 0 : 1, p.id]);
  res.json(get('SELECT * FROM consign_partners WHERE id = ?', [p.id]));
});

/**
 * Xoá chủ hàng. Đã từng gửi bán thì KHÔNG xoá — hoá đơn cũ mất tên người
 * gửi là không tra lại được nữa; chuyển sang ngừng hoạt động.
 */
r.delete('/consign-partners/:id', (req, res) => {
  const p = get('SELECT * FROM consign_partners WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'Không tìm thấy chủ hàng' });
  const used = get('SELECT COUNT(*) AS n FROM sale_consign_items WHERE partner_id = ?', [p.id]).n;
  if (used > 0) {
    run('UPDATE consign_partners SET active = 0 WHERE id = ?', [p.id]);
    return res.json({ ok: true, deactivated: true, used });
  }
  run('DELETE FROM consign_partners WHERE id = ?', [p.id]);
  res.json({ ok: true, deleted: true });
});

/* ==================== BÁO CÁO & ĐỐI SOÁT ========================== */

/**
 * Từng dòng hàng mua hộ, lọc theo chủ hàng / khoảng ngày / đã chốt chưa.
 * Kế toán tích chọn ở đây rồi chốt gộp một đợt.
 */
r.get('/consign-items', (req, res) => {
  const {
    partner_id: partnerId = '', from = '', to = '', status = 'open', q = '',
  } = req.query;
  const where = [];
  const params = [];
  if (partnerId) { where.push('ci.partner_id = ?'); params.push(Number(partnerId)); }
  /* Kịch bản A không có chủ hàng nên không nằm trong danh sách đối soát */
  if (!partnerId) where.push('ci.partner_id IS NOT NULL');
  if (status === 'open') where.push('ci.settlement_id IS NULL');
  if (status === 'settled') where.push('ci.settlement_id IS NOT NULL');
  if (from) { where.push('date(s.ts) >= date(?)'); params.push(from); }
  if (to) { where.push('date(s.ts) <= date(?)'); params.push(to); }
  if (String(q).trim()) {
    const c = searchWhere(['ci.name', 'ci.partner_name', 's.code'], q);
    where.push(c.sql);
    params.push(...c.params);
  }
  const { page, size, offset } = pageParams(req.query);
  const sql = `
    FROM sale_consign_items ci
    JOIN sales s ON s.id = ci.sale_id
    LEFT JOIN consign_partners p ON p.id = ci.partner_id
    LEFT JOIN consign_settlements st ON st.id = ci.settlement_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const total = get(`SELECT COUNT(*) AS n ${sql}`, params).n;
  const rows = all(`
    SELECT ci.*, s.code AS sale_code, s.ts AS sale_ts, s.customer_id,
           COALESCE(p.name, ci.partner_name) AS partner_label,
           st.code AS settlement_code, st.ts AS settled_at,
           (ci.amount - ci.commission) AS payable
    ${sql}
    ORDER BY s.ts DESC, ci.id DESC
    LIMIT ? OFFSET ?`, [...params, size, offset]);
  const sums = get(`
    SELECT COALESCE(SUM(ci.amount), 0) AS gross,
           COALESCE(SUM(ci.commission), 0) AS commission,
           COALESCE(SUM(ci.amount - ci.commission), 0) AS payable
    ${sql}`, params);
  res.json({ rows, total, page, page_size: size, sums });
});

/** Gom theo chủ hàng: mỗi dòng một người, để tích chọn chốt gộp hàng loạt. */
r.get('/consign-summary', (req, res) => {
  const { from = '', to = '' } = req.query;
  const where = ['ci.partner_id IS NOT NULL', 'ci.settlement_id IS NULL'];
  const params = [];
  if (from) { where.push('date(s.ts) >= date(?)'); params.push(from); }
  if (to) { where.push('date(s.ts) <= date(?)'); params.push(to); }
  res.json(all(`
    SELECT ci.partner_id,
           COALESCE(p.name, ci.partner_name) AS partner_name,
           p.phone AS partner_phone,
           COUNT(*) AS item_count,
           COALESCE(SUM(ci.amount), 0) AS gross,
           COALESCE(SUM(ci.commission), 0) AS commission,
           COALESCE(SUM(ci.amount - ci.commission), 0) AS payable,
           MIN(date(s.ts)) AS from_date,
           MAX(date(s.ts)) AS to_date
    FROM sale_consign_items ci
    JOIN sales s ON s.id = ci.sale_id
    LEFT JOIN consign_partners p ON p.id = ci.partner_id
    WHERE ${where.join(' AND ')}
    GROUP BY ci.partner_id
    ORDER BY payable DESC`, params));
});

/**
 * Chốt đối soát. Nhận:
 *   partner_ids: [..]    chốt gộp cho những chủ hàng này
 *   item_ids:    [..]    hoặc chỉ đích danh từng dòng
 *   from / to            giới hạn khoảng ngày (gom theo ngày, tuần, tháng)
 *   discount             chiết khấu gộp, chia đều theo tỉ lệ từng chủ hàng
 *   pay                  có chi tiền mặt luôn hay chỉ chốt sổ
 *
 * Mỗi chủ hàng một phiếu riêng — tiền trả cho từng người, không gộp chung
 * một phiếu chi rồi không biết đưa ai bao nhiêu.
 */
r.post('/consign-settlements', (req, res) => {
  try {
    const b = req.body || {};
    const partnerIds = (Array.isArray(b.partner_ids) ? b.partner_ids : []).map(Number).filter(Boolean);
    const itemIds = (Array.isArray(b.item_ids) ? b.item_ids : []).map(Number).filter(Boolean);
    if (!partnerIds.length && !itemIds.length) {
      throw badRequest('Chưa chọn chủ hàng hay dòng hàng nào để chốt.');
    }
    const where = ['ci.settlement_id IS NULL', 'ci.partner_id IS NOT NULL'];
    const params = [];
    if (itemIds.length) {
      where.push(`ci.id IN (${itemIds.map(() => '?').join(',')})`);
      params.push(...itemIds);
    } else {
      where.push(`ci.partner_id IN (${partnerIds.map(() => '?').join(',')})`);
      params.push(...partnerIds);
      if (b.from) { where.push('date(s.ts) >= date(?)'); params.push(b.from); }
      if (b.to) { where.push('date(s.ts) <= date(?)'); params.push(b.to); }
    }
    const rows = all(`
      SELECT ci.*, s.ts AS sale_ts, COALESCE(p.name, ci.partner_name) AS partner_label
      FROM sale_consign_items ci
      JOIN sales s ON s.id = ci.sale_id
      LEFT JOIN consign_partners p ON p.id = ci.partner_id
      WHERE ${where.join(' AND ')}
      ORDER BY ci.partner_id, s.ts`, params);
    if (!rows.length) throw badRequest('Không còn dòng hàng nào chưa chốt trong phạm vi đã chọn.');

    /* Chiết khấu gộp chia theo tỉ lệ tiền của từng chủ hàng — chia đều đầu
       người thì người bán 10 triệu và người bán 200 nghìn chịu như nhau. */
    const askDiscount = Math.max(0, Math.round(Number(b.discount) || 0));
    const grandPayable = rows.reduce((a, x) => a + (x.amount - x.commission), 0);
    const pay = b.pay !== false;
    const accountId = Number(b.account_id) || defaultCashAccount();
    if (pay && !accountId) throw badRequest('Chưa thiết lập quỹ tiền để chi trả.');

    const byPartner = new Map();
    for (const x of rows) {
      if (!byPartner.has(x.partner_id)) byPartner.set(x.partner_id, []);
      byPartner.get(x.partner_id).push(x);
    }

    const out = tx(() => {
      const made = [];
      let discountLeft = Math.min(askDiscount, grandPayable);
      const partners = [...byPartner.entries()];
      partners.forEach(([pid, list], idx) => {
        const gross = list.reduce((a, x) => a + x.amount, 0);
        const commission = list.reduce((a, x) => a + x.commission, 0);
        const payable = gross - commission;
        /* Người cuối nhận hết phần lẻ, để tổng chiết khấu khớp tuyệt đối */
        const share = idx === partners.length - 1
          ? discountLeft
          : Math.min(discountLeft,
            Math.round(Math.min(askDiscount, grandPayable) * payable / (grandPayable || 1)));
        discountLeft -= share;
        const payout = Math.max(0, payable - share);
        const name = list[0].partner_label || list[0].partner_name || '';
        const code = nextCode('consign_settlements', 'DS');
        const dates = list.map((x) => String(x.sale_ts).slice(0, 10)).sort();

        const info = run(`
          INSERT INTO consign_settlements(code, ts, partner_id, partner_name, gross, commission,
                                          discount, payout, from_date, to_date, item_count,
                                          user_id, note)
          VALUES(?, COALESCE(?, datetime('now','localtime')), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [code, b.ts || null, pid, name, gross, commission, share, payout,
            dates[0], dates[dates.length - 1], list.length,
            b.user_id || req.user?.id || null, b.note || null]);
        const settlementId = Number(info.lastInsertRowid);

        /* Khoá cứng: dòng đã gắn đợt chốt thì không vào đợt sau được nữa */
        for (const x of list) {
          run('UPDATE sale_consign_items SET settlement_id = ? WHERE id = ?', [settlementId, x.id]);
        }

        let cashTx = null;
        if (pay && payout > 0) {
          cashTx = addCashTx({
            accountId,
            direction: 'out',
            amount: payout,
            category: 'consign_out',
            partnerType: 'consign',
            partnerId: pid,
            partnerName: name,
            refType: 'consign_settlement',
            refId: settlementId,
            refCode: code,
            userId: b.user_id || req.user?.id || null,
            note: `Trả tiền hàng gửi bán ${code} — ${list.length} món`,
          });
          if (cashTx) {
            run('UPDATE consign_settlements SET cash_tx_id = ? WHERE id = ?', [cashTx.id, settlementId]);
          }
        }
        made.push({ id: settlementId, code, partner_id: pid, partner_name: name,
          gross, commission, discount: share, payout, item_count: list.length,
          cash_code: cashTx?.code || null });
      });
      return made;
    });
    res.json({ settlements: out, count: out.length });
  } catch (e) { fail(res, e); }
});

r.get('/consign-settlements', (req, res) => {
  const { partner_id: partnerId = '', from = '', to = '' } = req.query;
  const where = [];
  const params = [];
  if (partnerId) { where.push('st.partner_id = ?'); params.push(Number(partnerId)); }
  if (from) { where.push('date(st.ts) >= date(?)'); params.push(from); }
  if (to) { where.push('date(st.ts) <= date(?)'); params.push(to); }
  const { page, size, offset } = pageParams(req.query);
  const sql = `FROM consign_settlements st ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const total = get(`SELECT COUNT(*) AS n ${sql}`, params).n;
  const rows = all(`
    SELECT st.*, ct.code AS cash_code, u.full_name AS user_name
    ${sql.replace('FROM consign_settlements st', `FROM consign_settlements st
      LEFT JOIN cash_transactions ct ON ct.id = st.cash_tx_id
      LEFT JOIN users u ON u.id = st.user_id`)}
    ORDER BY st.ts DESC, st.id DESC LIMIT ? OFFSET ?`, [...params, size, offset]);
  res.json({ rows, total, page, page_size: size });
});

r.get('/consign-settlements/:id', (req, res) => {
  const st = get(`
    SELECT st.*, ct.code AS cash_code, u.full_name AS user_name
    FROM consign_settlements st
    LEFT JOIN cash_transactions ct ON ct.id = st.cash_tx_id
    LEFT JOIN users u ON u.id = st.user_id
    WHERE st.id = ?`, [req.params.id]);
  if (!st) return res.status(404).json({ error: 'Không tìm thấy phiếu đối soát' });
  st.items = all(`
    SELECT ci.*, s.code AS sale_code, s.ts AS sale_ts, (ci.amount - ci.commission) AS payable
    FROM sale_consign_items ci JOIN sales s ON s.id = ci.sale_id
    WHERE ci.settlement_id = ? ORDER BY s.ts, ci.id`, [st.id]);
  res.json(st);
});

export default r;
