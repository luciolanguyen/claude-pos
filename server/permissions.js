/* ====================================================================
   PHÂN QUYỀN THEO VAI TRÒ

   Chủ cửa hàng và Quản lý: toàn quyền.
   Thu ngân: chỉ lo bán hàng — bán, đặt hàng, khách trả hàng, khách hàng,
             bảo hành, và xem tồn kho để biết còn hàng hay không.
   Kho: chỉ lo hàng hoá và kho, không đụng tới tiền và giá vốn bán.

   Đây là hàng rào chống thao tác nhầm giữa người trong tiệm, KHÔNG phải
   lớp bảo mật chống kẻ xấu: phần mềm chạy trong mạng LAN của tiệm, mật
   khẩu lưu dạng chữ thường, ai vào được mạng cũng có thể giả danh. Đừng
   mở cổng 5175 ra Internet.
   ==================================================================== */

/** Tất cả quyền đang có. Mô tả để hiện ở màn hình Thiết lập → Người dùng. */
export const PERMISSIONS = {
  'sale.pos':        'Bán hàng tại quầy',
  'sale.view':       'Xem hoá đơn đã xuất',
  'sale.void':       'Sửa, huỷ hoá đơn đã xuất',
  'sale.return':     'Nhận khách trả hàng',
  'order.manage':    'Đơn đặt hàng của khách',
  'customer.manage': 'Khách hàng, công nợ khách',
  'warranty.manage': 'Nhận và trả hàng bảo hành',
  'product.view':    'Xem hàng hoá, giá bán, tồn kho',
  'product.manage':  'Thêm sửa hàng hoá, đổi giá bán',
  'stock.manage':    'Kiểm kê, chuyển kho, sản xuất',
  'purchase.manage': 'Nhập hàng, nhà cung cấp, công nợ NCC',
  'cash.manage':     'Quỹ tiền, thu chi',
  'cash.voucher':    'In lại phiếu thu, phiếu chi đã lập',
  'cost.view':       'Xem giá vốn và lãi lỗ',
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
    'order.manage', 'customer.manage', 'warranty.manage',
    'product.view',
    /* Thu nợ tại quầy xong thì in tờ phiếu thu đưa khách. Chỉ xem lại
       được đúng phiếu theo số, không mở được cả sổ quỹ. */
    'cash.voucher',
    /* Xuất được danh sách hoá đơn, khách hàng trong ca mình — nhưng KHÔNG
       nhập được file: nhập sai một file là hỏng cả danh mục hàng hoá. */
    'data.export',
  ],
  stock: [
    'product.view', 'product.manage', 'stock.manage', 'purchase.manage',
    /* Người dựng danh mục hàng hoá chính là người cần nhập file Excel */
    'data.import', 'data.export',
  ],
  /* Người chỉ lo nhận và trả hàng bảo hành, không đụng quầy thu tiền.
     Vẫn cần tra hoá đơn cũ (máy này bán hồi nào, còn hạn không), tra
     hàng hoá, và mở hồ sơ khách để gọi điện báo máy đã sửa xong. */
  warranty: [
    'warranty.manage', 'sale.view', 'product.view', 'customer.manage',
  ],
};

export const ROLE_LABEL = {
  owner: 'Chủ cửa hàng',
  manager: 'Quản lý',
  cashier: 'Thu ngân',
  stock: 'Nhân viên kho',
  warranty: 'Nhân viên bảo hành',
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
 * Ai đang gọi. Máy khách gửi kèm id người dùng ở header x-user-id.
 *
 * Riêng ảnh thì nhận thêm ở dạng ?uid= trên đường dẫn: thẻ <img src="..."/>
 * của trình duyệt KHÔNG gửi được header tự đặt, nên ảnh bảo hành sẽ bị chặn
 * 401 và hiện ra ô trống — trông y như phần mềm quên lưu ảnh.
 */
export function currentUser(req, getUserById) {
  const id = Number(req.get('x-user-id')) || Number(req.query?.uid);
  if (!id) return null;
  return getUserById(id) || null;
}

/**
 * Sinh middleware đòi một quyền cụ thể.
 * Chưa đăng nhập thì cho qua — tiệm có thể bật "bỏ qua đăng nhập" ở
 * Thiết lập, lúc đó cả nhà dùng chung một máy và không có ai để phân quyền.
 */
export function makeRequire(getUserById, isLoginRequired) {
  return function require(perm) {
    return (req, res, next) => {
      if (!isLoginRequired()) return next();
      const u = currentUser(req, getUserById);
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
