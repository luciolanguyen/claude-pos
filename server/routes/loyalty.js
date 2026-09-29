/* ====================================================================
   ĐIỂM TÍCH LUỸ — API (yêu cầu 28/09, mục IV.1)

   Quầy chỉ cần đọc số dư và sổ điểm của khách. Cộng trừ điểm bằng tay là
   việc của chủ tiệm / quản lý, và bắt buộc có lý do.
   ==================================================================== */
import { Router } from 'express';
import { get, pageParams } from '../db.js';
import { loyaltyConfig, pointsLedger, adjustPoints } from '../loyalty.js';

const r = Router();

/** Thiết lập đang áp dụng — màn hình bán hàng cần biết 1 điểm bằng bao nhiêu tiền. */
r.get('/loyalty/config', (req, res) => res.json(loyaltyConfig()));

/** Số dư và sổ điểm của một khách. */
r.get('/customers/:id/points', (req, res) => {
  const c = get('SELECT id, code, name, phone FROM customers WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
  const { size, offset, page } = pageParams(req.query, 20);
  const led = pointsLedger(c.id, { limit: size, offset });
  res.json({ customer: c, config: loyaltyConfig(), page, page_size: size, ...led });
});

/** Chủ tiệm / quản lý cộng trừ điểm bằng tay. */
r.post('/loyalty/adjust', (req, res) => {
  try {
    const balance = adjustPoints({
      customerId: req.body?.customer_id,
      points: req.body?.points,
      note: req.body?.note,
      userId: req.user?.id || req.body?.user_id || null,
    });
    res.json({ ok: true, balance });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message, code: e.code });
  }
});

export default r;
