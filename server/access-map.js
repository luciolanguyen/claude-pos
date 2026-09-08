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
  ['GET',  /^\/sales/,                    'sale.view'],
  ['*',    /^\/drafts/,                   'sale.pos'],
  ['*',    /^\/price-history/,            'sale.pos'],
  ['*',    /^\/sale-returns/,             'sale.return'],
  ['*',    /^\/orders/,                   'order.manage'],
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
];

/** Quyền cần có cho một lời gọi, hoặc null nếu ai đăng nhập cũng gọi được. */
export function permFor(method, urlPath) {
  const p = urlPath.split('?')[0].replace(/\/+$/, '') || '/';
  for (const [m, re, perm] of ACCESS_RULES) {
    if ((m === '*' || m === method) && re.test(p)) return perm;
  }
  return null;
}
