/* ====================================================================
   PHÂN QUYỀN THEO VAI TRÒ

   Chủ cửa hàng và Quản lý: toàn quyền.
   Thu ngân: chỉ lo bán hàng — bán, đặt hàng, khách trả hàng, khách hàng,
             bảo hành, và xem tồn kho để biết còn hàng hay không.
   Kho: chỉ lo hàng hoá và kho, không đụng tới tiền và giá vốn bán.

   Máy chủ nhận ra người gọi bằng mã đăng nhập có chữ ký (auth-token.js),
   nhưng mật khẩu vẫn lưu dạng chữ thường trong file dữ liệu. Đừng mở cổng
   5175 ra Internet.
   ==================================================================== */

/** Tất cả quyền đang có. Mô tả để hiện ở màn hình Thiết lập → Người dùng. */
export const PERMISSIONS = {
  'sale.pos':        'Bán hàng tại quầy',
  'sale.view':       'Xem hoá đơn đã xuất',
  'sale.void':       'Sửa, huỷ hoá đơn đã xuất',
  'sale.return':     'Nhận khách trả hàng',
  'order.manage':    'Đơn đặt hàng của khách',
  'customer.manage': 'Khách hàng, công nợ khách',
  /* Bảo hành & sửa chữa tách bốn quyền (vai trò Thợ, 25/10/2026): thợ nhận
     máy và sửa nhưng không thấy giá; báo giá là việc của chủ / quản lý; thu
     ngân trả máy, thu tiền, chỉ thấy tổng tiền chứ không thấy đơn giá */
  'warranty.receive': 'Nhận máy bảo hành / sửa chữa, tra hạn bảo hành',
  'warranty.work':    'Báo bệnh, vật tư thay, báo sửa xong',
  'warranty.quote':   'Báo giá sửa chữa, giá vật tư, in hoá đơn chi tiết',
  'warranty.deliver': 'Trả máy cho khách, thu tiền sửa chữa',
  'product.view':    'Xem hàng hoá, giá bán, tồn kho',
  'product.manage':  'Thêm sửa hàng hoá, đổi giá bán',
  'stock.manage':    'Kiểm kê, chuyển kho, sản xuất',
  'purchase.manage': 'Nhập hàng, nhà cung cấp, công nợ NCC',
  /* Thủ kho nhận hàng "mù giá" (24/10/2026): đếm hàng cộng kho, chọn mối
     theo tên — không thấy giá nhập, tổng tiền, hồ sơ hay công nợ NCC.
     Chủ / quản lý chốt giá sau theo hoá đơn của mối. */
  'purchase.receive': 'Nhận hàng về kho (không thấy giá nhập)',
  'cash.manage':     'Quỹ tiền, thu chi',
  'cash.voucher':    'In lại phiếu thu, phiếu chi đã lập',
  'cost.view':       'Xem giá vốn và lãi lỗ',
  /* Sửa số công nợ và chốt sổ công nợ (plan 31, 6b / 6c): chủ tiệm chốt cho
     cả chủ và quản lý, nhưng mỗi lần sửa vẫn bắt gõ PIN, ghi lý do, lưu vết */
  'debt.adjust':     'Sửa công nợ, chốt sổ công nợ',
  /* Bảng lương (plan 28): chủ tiệm chốt quản lý xem được y như chủ (28-1).
     Mở bảng lương còn phải gõ mã PIN mỗi phiên — xem routes/payroll.js */
  'payroll.manage':  'Bảng lương nhân viên',
  'report.view':     'Xem báo cáo',
  /* Nhập / xuất hàng loạt tách riêng khỏi quyền sửa hàng hoá: một lần nhập
     file sai là hỏng cả danh mục, mà xuất file là mang dữ liệu tiệm ra
     ngoài — hai việc đó nặng hơn hẳn việc sửa giá một mặt hàng. */
  'data.import':     'Nhập danh mục từ file Excel',
  'data.export':     'Xuất dữ liệu ra file Excel',
  'settings.manage': 'Thiết lập, người dùng, sao lưu',
};

const ALL = Object.keys(PERMISSIONS);

/**
 * Quyền của từng vai trò.
 *
 * owner và manager giống hệt nhau: toàn quyền — chủ tiệm đã chốt như vậy,
 * quản lý ở đây là người nhà chứ không phải người làm thuê.
 */
export const ROLE_PERMISSIONS = {
  owner: ALL,
  manager: ALL,
  cashier: [
    'sale.pos', 'sale.view', 'sale.return',
    'order.manage', 'customer.manage', 'warranty.receive', 'warranty.deliver',
    'product.view',
    /* Thu nợ tại quầy xong thì in tờ phiếu thu đưa khách. Chỉ xem lại
       được đúng phiếu theo số, không mở được cả sổ quỹ. */
    'cash.voucher',
    /* Xuất được danh sách hoá đơn, khách hàng trong ca mình — nhưng KHÔNG
       nhập được file: nhập sai một file là hỏng cả danh mục hàng hoá. */
    'data.export',
  ],
  stock: [
    /* Không có purchase.manage: người nhận hàng không đồng thời quyết giá và
       trả tiền mối (24/10/2026) — xem routes/purchases.js, /purchases/receive */
    'product.view', 'product.manage', 'stock.manage', 'purchase.receive',
    /* Người dựng danh mục hàng hoá chính là người cần nhập file Excel */
    'data.import', 'data.export',
  ],
  /* Thợ (25/10/2026, thay vai "Nhân viên bảo hành"): nhận máy, báo bệnh, báo
     vật tư thay, báo sửa xong. KHÔNG thấy giá vật tư, tiền công, báo giá —
     máy chủ cắt hết tiền khỏi phiếu (routes/warranty.js, shapeTicket). Không
     có sale.view: tra hạn bảo hành đi qua /warranty-lookup, không lộ tiền hoá
     đơn. Vẫn mở hồ sơ khách để gọi điện báo máy đã sửa xong. */
  technician: [
    'warranty.receive', 'warranty.work', 'product.view', 'customer.manage',
  ],
};

export const ROLE_LABEL = {
  owner: 'Chủ cửa hàng',
  manager: 'Quản lý',
  cashier: 'Thu ngân',
  stock: 'Nhân viên kho',
  technician: 'Thợ',
};

/** Danh sách quyền của một vai trò. Vai trò lạ thì không có quyền nào. */
export function permsOf(role) {
  return ROLE_PERMISSIONS[role] || [];
}

export function roleCan(role, perm) {
  return permsOf(role).includes(perm);
}

/* ------------------------------------------------------------------ *
 * Chặn ở phía máy chủ
 *
 * Giao diện đã ẩn những mục thu ngân không được vào, nhưng ẩn menu chỉ
 * là cho gọn mắt. Chặn thật phải nằm ở đây, nếu không thì gõ thẳng địa
 * chỉ API là qua mặt được.
 * ------------------------------------------------------------------ */

/**
 * Sinh middleware đòi một quyền cụ thể.
 * Chưa đăng nhập thì cho qua — tiệm có thể bật "bỏ qua đăng nhập" ở
 * Thiết lập, lúc đó cả nhà dùng chung một máy và không có ai để phân quyền.
 */
export function makeRequire(currentUser, isLoginRequired) {
  return function require(perm) {
    return (req, res, next) => {
      if (!isLoginRequired()) return next();
      const u = currentUser(req);
      if (!u) {
        return res.status(401).json({
          error: 'Chưa đăng nhập. Hãy đăng nhập lại.', code: 'NO_AUTH',
        });
      }
      if (!u.active) {
        return res.status(403).json({
          error: 'Tài khoản đã bị khoá.', code: 'INACTIVE',
        });
      }
      if (!roleCan(u.role, perm)) {
        return res.status(403).json({
          error: `Bạn không có quyền "${PERMISSIONS[perm] || perm}". `
               + 'Việc này cần chủ cửa hàng hoặc quản lý.',
          code: 'NO_PERM',
          need: perm,
        });
      }
      req.user = u;
      return next();
    };
  };
}
