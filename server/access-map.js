/* ====================================================================
   BẢNG CHẶN QUYỀN THEO ĐƯỜNG DẪN API

   Gom hết vào một chỗ để soát cho dễ: nhìn bảng này là biết ai vào được
   cái gì, khỏi phải lục từng file route.

   Luật đọc từ trên xuống, gặp cái khớp đầu tiên là dừng — nên đường dẫn
   hẹp phải đặt trước đường dẫn rộng. Quyền ghi `null` nghĩa là ai đăng
   nhập cũng gọi được; đường dẫn không có trong bảng cũng vậy.
   ==================================================================== */

/** [phương thức, biểu thức đường dẫn, quyền cần có hoặc null] */
export const ACCESS_RULES = [
  /* --- Danh mục nền: máy khách nạp lúc mở phần mềm, ai cũng cần --- */
  ['GET',  /^\/price-lists/,              null],
  ['GET',  /^\/warehouses/,               null],
  ['GET',  /^\/categories/,               null],
  ['GET',  /^\/cash\/accounts/,           null],
  ['GET',  /^\/settings/,                 null],
  ['GET',  /^\/system-info/,              null],
  ['GET',  /^\/carriers/,                 null],
  ['GET',  /^\/users$/,                   null],   // màn hình đăng nhập cần

  /* --- Bán hàng: phần việc của thu ngân --- */
  ['POST', /^\/sales\/\d+\/cancel$/,      'sale.void'],
  ['POST', /^\/sales$/,                   'sale.pos'],
  ['POST', /^\/sales\/\d+\/pay$/,         'sale.pos'],
  ['PUT',  /^\/sales\/\d+\/delivery$/,    'sale.pos'],
  /* Đối soát COD: người giao nộp tiền về quầy — việc của thu ngân */
  ['PUT',  /^\/sales\/\d+\/cod$/,         'sale.pos'],
  ['GET',  /^\/cod-receivables/,          'sale.view'],
  /* Gõ PIN quản lý: thu ngân gọi được, vì chính thu ngân là người cần
     duyệt. Khoá theo quyền bán hàng để biết ai đang thử, chặn gõ mò. */
  ['POST', /^\/auth\/approve$/,            'sale.pos'],
  ['GET',  /^\/pos\/policy$/,              null],
  ['GET',  /^\/vouchers/,                  'sale.pos'],
  ['GET',  /^\/deliveries/,                'sale.view'],
  ['GET',  /^\/sales/,                    'sale.view'],
  ['*',    /^\/drafts/,                   'sale.pos'],
  ['*',    /^\/price-history/,            'sale.pos'],
  ['*',    /^\/sale-returns/,             'sale.return'],
  ['POST', /^\/sale-exchanges$/,           'sale.return'],
  ['*',    /^\/orders/,                   'order.manage'],

  /* --- Phiếu tạm: ai lập được phiếu loại nào thì lưu tạm được loại đó.
     Một tờ nháp không đụng kho, không đụng tiền, nên để chung một quyền
     rộng là được — nhưng vẫn phải đăng nhập. --- */
  ['*',    /^\/doc-drafts/,               'product.view'],

  /* --- Phiếu báo hết hàng --- */
  /* Lập phiếu và đếm hàng là việc của nhân viên kho và thu ngân đứng quầy.
     Nhưng CÂN BẰNG KHO và TÁCH PHIẾU NHẬP thì phải người quản: một cái sửa
     thẳng tồn kho, một cái mở đường cho việc chi tiền mua hàng. */
  ['POST', /^\/requisitions\/\d+\/adjust$/, 'stock.manage'],
  ['POST', /^\/requisitions\/\d+\/split$/,  'purchase.manage'],
  ['*',    /^\/requisition/,               'product.view'],

  /* Danh sách mối của một mặt hàng: xem thì cần biết giá nhập lần trước,
     nên khoá theo quyền mua hàng. */
  ['*',    /^\/products\/\d+\/suppliers$/, 'purchase.manage'],
  ['*',    /^\/customer-debts/,           'customer.manage'],
  ['*',    /^\/customers/,                'customer.manage'],
  ['*',    /^\/warranty/,                 'warranty.manage'],

  /* --- Hàng hoá: xem được, sửa thì không --- */
  /* Lịch sử nhập hàng hiện giá nhập của từng mối — đó là giá vốn, phải
     khoá riêng chứ không cho lọt qua quyền xem hàng hoá thông thường. */
  ['GET',  /^\/products\/\d+\/purchase-history$/, 'cost.view'],
  ['GET',  /^\/products/,                 'product.view'],
  ['PUT',  /^\/products\/\d+\/cost$/,     'cost.view'],
  ['*',    /^\/products/,                 'product.manage'],
  ['*',    /^\/categories/,               'product.manage'],
  ['GET',  /^\/stock$/,                   'product.view'],
  ['*',    /^\/stock/,                    'stock.manage'],
  ['*',    /^\/productions/,              'stock.manage'],

  /* --- Mua hàng --- */
  ['*',    /^\/purchases/,                'purchase.manage'],
  ['*',    /^\/purchase-returns/,         'purchase.manage'],
  ['*',    /^\/suppliers/,                'purchase.manage'],
  ['*',    /^\/supplier-debts/,           'purchase.manage'],

  /* --- Tiền và số liệu --- */
  /* Xem lại MỘT phiếu theo số thì thu ngân cũng được, để in đưa khách.
     Còn danh sách sổ quỹ vẫn phải là người quản tiền. */
  ['GET',  /^\/cash\/transactions\/\d+$/, 'cash.voucher'],
  ['*',    /^\/cash/,                     'cash.manage'],
  ['*',    /^\/reports/,                  'report.view'],
  ['GET',  /^\/dashboard/,                'report.view'],
  ['GET',  /^\/activity/,                 'settings.manage'],

  /* --- Thiết lập --- */
  ['PUT',  /^\/settings/,                 'settings.manage'],
  ['*',    /^\/users/,                    'settings.manage'],
  ['*',    /^\/price-lists/,              'settings.manage'],
  ['*',    /^\/warehouses/,               'settings.manage'],
  ['*',    /^\/carriers/,                 'settings.manage'],
  ['GET',  /^\/backup/,                   'settings.manage'],
  ['POST', /^\/restore/,                  'settings.manage'],
  ['POST', /^\/clear-transactions/,       'settings.manage'],
  ['POST', /^\/reset-all/,                'settings.manage'],

  /* Đăng nhập phải mở, vì lúc đó chưa có ai để kiểm quyền */
  ['POST', /^\/login$/,                   null],
];

/**
 * Route GHI mà quên khai trong bảng trên thì đòi quyền cao nhất.
 *
 * Trước đây quên khai là mặc định MỞ — và đúng là đã lọt: /reset-all cho
 * xoá sạch cơ sở dữ liệu, /sale-exchanges cho đổi trả hàng, ai gọi cũng
 * được. Giờ quên khai thì bị khoá chặt, người viết route mới sẽ thấy ngay
 * và phải khai tử tế. Thà chặn nhầm còn hơn mở nhầm.
 */
export const DEFAULT_WRITE_PERM = 'settings.manage';

/** Quyền cần có cho một lời gọi, hoặc null nếu ai đăng nhập cũng gọi được. */
export function permFor(method, urlPath) {
  const p = urlPath.split('?')[0].replace(/\/+$/, '') || '/';
  for (const [m, re, perm] of ACCESS_RULES) {
    if ((m === '*' || m === method) && re.test(p)) return perm;
  }
  // Đọc thì cho qua; ghi mà quên khai thì khoá lại
  return method === 'GET' ? null : DEFAULT_WRITE_PERM;
}
