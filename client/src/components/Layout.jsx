import { useState, useEffect } from 'react';
import { NavLink, useLocation, Link } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, Receipt, Users, Undo2, Wallet, Package,
  Truck, FileText, Boxes, ClipboardCheck, ArrowLeftRight, Settings as Cog,
  BarChart3, LogOut, Menu, X, ChevronDown, Zap, HandCoins, UserCog, Landmark, Wrench,
  ShieldCheck, ClipboardList, PackageX,
} from 'lucide-react';
import { useApp } from '../lib/store';
import { ROLE_LABEL } from '../lib/format';

/* Cấu trúc menu theo nghiệp vụ, không theo bảng dữ liệu.
   Mỗi mục ghi kèm quyền cần có; ai không có quyền thì mục đó biến mất
   khỏi menu. Nhóm nào rỗng hết con thì cũng ẩn luôn cả nhóm. */
export const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Tổng quan', end: true, perm: 'report.view' },
  { to: '/pos', icon: ShoppingCart, label: 'Bán hàng', highlight: true, perm: 'sale.pos' },
  {
    label: 'Quản lý bán hàng', icon: Receipt, key: 'sale',
    children: [
      { to: '/orders', icon: ClipboardList, label: 'Đặt hàng', perm: 'order.manage' },
      { to: '/sales', icon: Receipt, label: 'Hoá đơn', perm: 'sale.view' },
      { to: '/sale-returns', icon: Undo2, label: 'Khách trả hàng', perm: 'sale.return' },
      { to: '/customers', icon: Users, label: 'Khách hàng', perm: 'customer.manage' },
      { to: '/customer-debts', icon: HandCoins, label: 'Công nợ khách', perm: 'customer.manage' },
      { to: '/warranty', icon: ShieldCheck, label: 'Bảo hành', perm: 'warranty.manage' },
    ],
  },
  {
    label: 'Mua hàng', icon: Truck, key: 'buy',
    children: [
      { to: '/purchases', icon: FileText, label: 'Phiếu nhập hàng', perm: 'purchase.manage' },
      { to: '/purchase-returns', icon: Undo2, label: 'Trả hàng NCC', perm: 'purchase.manage' },
      { to: '/suppliers', icon: Truck, label: 'Nhà cung cấp', perm: 'purchase.manage' },
      { to: '/supplier-debts', icon: Landmark, label: 'Công nợ NCC', perm: 'purchase.manage' },
    ],
  },
  {
    label: 'Kho hàng', icon: Package, key: 'stock',
    children: [
      { to: '/products', icon: Boxes, label: 'Hàng hoá', perm: 'product.view' },
      { to: '/stock', icon: Package, label: 'Tồn kho', perm: 'product.view' },
      { to: '/requisitions', icon: PackageX, label: 'Báo hết hàng', perm: 'product.view' },
      { to: '/stock-takes', icon: ClipboardCheck, label: 'Kiểm kê', perm: 'stock.manage' },
      { to: '/stock-transfers', icon: ArrowLeftRight, label: 'Chuyển kho', perm: 'stock.manage' },
      { to: '/production', icon: Wrench, label: 'Sản xuất', perm: 'stock.manage' },
    ],
  },
  { to: '/cash', icon: Wallet, label: 'Quỹ tiền', perm: 'cash.manage' },
  { to: '/reports', icon: BarChart3, label: 'Báo cáo', perm: 'report.view' },
  { to: '/settings', icon: Cog, label: 'Thiết lập', perm: 'settings.manage' },
];

/** Lọc menu theo quyền. Nhóm mất hết con thì bỏ luôn nhóm. */
export function visibleNav(can) {
  const out = [];
  for (const item of NAV) {
    if (item.children) {
      const kids = item.children.filter((c) => !c.perm || can(c.perm));
      if (kids.length) out.push({ ...item, children: kids });
    } else if (!item.perm || can(item.perm)) {
      out.push(item);
    }
  }
  return out;
}

function NavItem({ item, onNavigate }) {
  const loc = useLocation();
  const childActive = item.children?.some((c) => loc.pathname.startsWith(c.to));
  const [open, setOpen] = useState(childActive);

  useEffect(() => { if (childActive) setOpen(true); }, [childActive]);

  if (item.children) {
    return (
      <li>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-[13px] font-semibold
                      transition-colors duration-150 cursor-pointer
                      ${childActive ? 'text-white' : 'text-slate-300 hover:text-white hover:bg-white/10'}`}
        >
          <item.icon size={17} className="shrink-0" aria-hidden="true" />
          <span className="flex-1 text-left">{item.label}</span>
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={`shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          />
        </button>
        {open && (
          <ul className="mt-0.5 ml-3 pl-3 border-l border-white/15 space-y-0.5">
            {item.children.map((c) => (
              <li key={c.to}>
                <NavLink
                  to={c.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-2.5 py-1.5 rounded text-[13px] transition-colors duration-150
                     ${isActive
                       ? 'bg-accent text-white font-semibold'
                       : 'text-slate-300 hover:text-white hover:bg-white/10'}`}
                >
                  <c.icon size={15} className="shrink-0" aria-hidden="true" />
                  <span className="truncate">{c.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li>
      <NavLink
        to={item.to}
        end={item.end}
        onClick={onNavigate}
        className={({ isActive }) =>
          `flex items-center gap-2.5 px-2.5 py-2 rounded text-[13px] font-semibold
           transition-colors duration-150
           ${isActive
             ? 'bg-accent text-white'
             : item.highlight
               ? 'text-emerald-300 hover:bg-white/10 hover:text-emerald-200'
               : 'text-slate-300 hover:text-white hover:bg-white/10'}`}
      >
        <item.icon size={17} className="shrink-0" aria-hidden="true" />
        <span className="truncate">{item.label}</span>
        {item.highlight && <span className="kbd ml-auto !bg-white/15 !text-white !border-white/20">F1</span>}
      </NavLink>
    </li>
  );
}

export default function Layout({ children }) {
  const { store, user, logout, can } = useApp();
  const nav = visibleNav(can);
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();

  useEffect(() => { setMobileOpen(false); }, [loc.pathname]);

  const sidebar = (
    <div className="flex flex-col h-full bg-primary">
      <div className="flex items-center gap-2.5 px-3 h-14 border-b border-white/10 shrink-0">
        <div className="w-8 h-8 rounded bg-accent flex items-center justify-center shrink-0">
          <Zap size={17} className="text-white" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-white font-display font-bold text-[13px] leading-tight truncate">
            {store.name || 'CỬA HÀNG'}
          </div>
          <div className="text-2xs text-slate-400 truncate">{store.slogan || 'Phần mềm bán hàng'}</div>
        </div>
        <button
          className="lg:hidden text-slate-300 hover:text-white p-1 rounded"
          onClick={() => setMobileOpen(false)}
          aria-label="Đóng menu"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Điều hướng chính">
        <ul className="space-y-0.5">
          {nav.map((item, i) => <NavItem key={item.to || item.key || i} item={item} />)}
        </ul>
      </nav>

      <div className="border-t border-white/10 p-2 shrink-0">
        <div className="flex items-center gap-2 px-1.5 py-1.5">
          <div className="w-7 h-7 rounded-full bg-accent/25 text-emerald-300 flex items-center justify-center
                          text-2xs font-bold shrink-0" aria-hidden="true">
            {(user?.full_name || 'K').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-white font-semibold truncate">{user?.full_name || 'Khách'}</div>
            <div className="text-2xs text-slate-400 truncate">{ROLE_LABEL[user?.role] || 'Chưa đăng nhập'}</div>
          </div>
          <button
            onClick={logout}
            aria-label="Đăng xuất"
            title="Đăng xuất"
            className="text-slate-400 hover:text-white p-1.5 rounded hover:bg-white/10 transition-colors duration-150"
          >
            <LogOut size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex">
      {/* Thanh bên cố định trên máy tính */}
      <aside className="hidden lg:block w-56 shrink-0 no-print">
        <div className="fixed inset-y-0 left-0 w-56">{sidebar}</div>
      </aside>

      {/* Thanh bên trượt trên máy tính bảng / điện thoại */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 no-print">
          <div
            className="absolute inset-0 bg-slate-900/50 animate-fade-in"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 w-60 animate-slide-in-right">{sidebar}</div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Thanh trên chỉ hiện ở màn hình nhỏ */}
        <header className="lg:hidden sticky top-0 z-30 h-14 bg-primary flex items-center gap-2 px-3 no-print">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Mở menu"
            className="text-white p-1.5 rounded hover:bg-white/10"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <Link to={can('report.view') ? '/' : '/pos'}
                className="text-white font-display font-bold text-sm truncate flex-1">
            {store.name || 'CỬA HÀNG'}
          </Link>
          {can('sale.pos') && (
            <Link to="/pos" className="btn btn-primary btn-sm btn-touch">
              <ShoppingCart size={15} aria-hidden="true" />
              Bán hàng
            </Link>
          )}
        </header>

        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}

/** Tiêu đề trang dùng chung cho mọi màn hình quản lý. */
export function PageHeader({ title, subtitle, actions, children }) {
  return (
    <div className="border-b border-line bg-card no-print">
      <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        {/* Trên điện thoại tiêu đề xuống dòng thay vì bị cắt cụt */}
        <div className="min-w-0 sm:flex-1">
          <h1 className="text-lg font-display font-bold leading-tight sm:truncate">{title}</h1>
          {subtitle && <p className="text-[13px] text-muted-ink mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      {children && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

/** Bọc nội dung trang, đảm bảo khoảng cách nhất quán. */
export function Page({ children, className = '' }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}
