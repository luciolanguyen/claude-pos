import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Zap, LogIn, AlertTriangle, Lock } from 'lucide-react';
import { AppProvider, useApp } from './lib/store';
import { api } from './lib/api';
import { Toasts, Spinner, Button, Input, Field } from './components/ui';
import Layout from './components/Layout';

import Dashboard from './pages/Dashboard';
import POS from './pages/POS';
import Sales from './pages/Sales';
import Customers, { CustomerDetail } from './pages/Customers';
import Suppliers, { SupplierDetail } from './pages/Suppliers';
import Purchases from './pages/Purchases';
import { SaleReturns, PurchaseReturns } from './pages/Returns';
import { CustomerDebts, SupplierDebts } from './pages/Debts';
import Products from './pages/Products';
import Stock, { StockTakes, StockTransfers } from './pages/Stock';
import Production from './pages/Production';
import Requisitions from './pages/Requisitions';
import Warranty from './pages/Warranty';
import Cash from './pages/Cash';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Orders from './pages/Orders';

/* ==================================================================== */
/* Đăng nhập — nhẹ nhàng, chỉ để ghi nhận ai đang bán                    */
/* ==================================================================== */

function Login() {
  const { login, store, toast } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { data: users } = useFetchUsers();

  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const u = await api.post('/login', { username, password });
      login(u);
      toast(`Xin chào ${u.full_name}`, 'ok');
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const quick = (u) => {
    setUsername(u.username);
    setPassword('');
    document.getElementById('login-password')?.focus();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-xl bg-accent flex items-center justify-center mx-auto mb-3">
            <Zap size={28} className="text-white" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-display font-bold">{store.name || 'PHẦN MỀM BÁN HÀNG'}</h1>
          {store.slogan && <p className="text-[13px] text-muted-ink mt-0.5">{store.slogan}</p>}
        </div>

        <form onSubmit={submit} className="card p-5 space-y-3">
          <Field label="Tên đăng nhập" htmlFor="login-user">
            <Input
              id="login-user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              placeholder="chu"
            />
          </Field>
          <Field label="Mật khẩu" htmlFor="login-password">
            <Input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>

          {err && (
            <p className="text-[13px] text-danger font-semibold bg-red-50 border border-danger/25 rounded p-2.5">
              {err}
            </p>
          )}

          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} icon={LogIn}>
            Đăng nhập
          </Button>
        </form>

        {users?.length > 0 && (
          <div className="mt-4">
            <p className="text-2xs text-muted-ink text-center mb-2">Chọn nhanh tài khoản</p>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {users.filter((u) => u.active).map((u) => (
                <button
                  key={u.id}
                  onClick={() => quick(u)}
                  className="btn btn-sm btn-outline"
                >
                  {u.full_name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Lấy danh sách người dùng cho nút chọn nhanh; lỗi thì bỏ qua im lặng. */
function useFetchUsers() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.users().then(setData).catch(() => setData([]));
  }, []);
  return { data };
}

/* ==================================================================== */
/* Chặn theo quyền ở phía giao diện                                      */
/*                                                                      */
/* Menu đã ẩn những mục không được vào, nhưng người dùng vẫn có thể gõ  */
/* thẳng địa chỉ hoặc mở lại thẻ cũ đã lưu. Lớp này bắt các trường hợp  */
/* đó. Chặn thật vẫn nằm ở máy chủ — đây chỉ để hiện lời giải thích tử  */
/* tế thay vì một màn hình lỗi trống.                                    */
/* ==================================================================== */

function Guard({ perm, children }) {
  const { can, access } = useApp();
  if (!perm || can(perm)) return children;
  const what = access?.permissions?.[perm];
  return (
    <div className="p-4 sm:p-6">
      <div className="card-pad max-w-lg mx-auto mt-8 text-center">
        <div className="w-11 h-11 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
          <Lock size={20} className="text-muted-ink" aria-hidden="true" />
        </div>
        <h1 className="font-display font-bold text-base mb-1">Mục này không dành cho bạn</h1>
        <p className="text-[13px] text-muted-ink leading-relaxed">
          {what ? <>Cần quyền <b>{what}</b>. </> : null}
          Chỉ chủ cửa hàng và quản lý mới vào được. Nếu bạn cần dùng, nhờ chủ tiệm
          mở quyền ở <b>Thiết lập → Người dùng</b>.
        </p>
      </div>
    </div>
  );
}

/** Trang chủ của mỗi người khác nhau: ai không xem được Tổng quan thì về bán hàng. */
function Home() {
  const { can } = useApp();
  if (can('report.view')) return <Dashboard />;
  if (can('sale.pos')) return <Navigate to="/pos" replace />;
  return <Guard perm="report.view" />;
}

/* ==================================================================== */

function Shell() {
  const { loading, user, login, settings, toasts, dismissToast } = useApp();
  const [autoTried, setAutoTried] = useState(false);

  /* Tiệm 1-2 người có thể tắt đăng nhập: tự vào bằng tài khoản chủ. */
  const skipLogin = settings?.pos?.skip_login === true;
  useEffect(() => {
    if (loading || user || !skipLogin || autoTried) return;
    setAutoTried(true);
    api.users()
      .then((us) => {
        const owner = us.find((u) => u.active && u.role === 'owner') || us.find((u) => u.active);
        if (owner) login({ id: owner.id, username: owner.username, full_name: owner.full_name, role: owner.role });
      })
      .catch(() => { /* không lấy được thì hiện màn hình đăng nhập như thường */ });
  }, [loading, user, skipLogin, autoTried, login]);

  if (loading || (skipLogin && !user && !autoTried)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner label="Đang kết nối máy chủ..." />
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <Login />
        <Toasts items={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  return (
    <>
      <Routes>
        {/* Màn hình bán hàng chiếm trọn màn hình, không dùng layout chung */}
        <Route path="/pos" element={<Guard perm="sale.pos"><POS /></Guard>} />

        <Route path="/*" element={
          <Layout>
            <Routes>
              <Route index element={<Home />} />
              <Route path="orders" element={<Guard perm="order.manage"><Orders /></Guard>} />
              <Route path="sales" element={<Guard perm="sale.view"><Sales /></Guard>} />
              <Route path="sale-returns" element={<Guard perm="sale.return"><SaleReturns /></Guard>} />
              <Route path="customers" element={<Guard perm="customer.manage"><Customers /></Guard>} />
              <Route path="customers/:id" element={<Guard perm="customer.manage"><CustomerDetail /></Guard>} />
              <Route path="customer-debts" element={<Guard perm="customer.manage"><CustomerDebts /></Guard>} />

              <Route path="purchases" element={<Guard perm="purchase.manage"><Purchases /></Guard>} />
              <Route path="purchase-returns" element={<Guard perm="purchase.manage"><PurchaseReturns /></Guard>} />
              <Route path="suppliers" element={<Guard perm="purchase.manage"><Suppliers /></Guard>} />
              <Route path="suppliers/:id" element={<Guard perm="purchase.manage"><SupplierDetail /></Guard>} />
              <Route path="supplier-debts" element={<Guard perm="purchase.manage"><SupplierDebts /></Guard>} />

              <Route path="products" element={<Guard perm="product.view"><Products /></Guard>} />
              <Route path="stock" element={<Guard perm="product.view"><Stock /></Guard>} />
              <Route path="stock-takes" element={<Guard perm="stock.manage"><StockTakes /></Guard>} />
              <Route path="stock-transfers" element={<Guard perm="stock.manage"><StockTransfers /></Guard>} />
              <Route path="production" element={<Guard perm="stock.manage"><Production /></Guard>} />
              <Route path="requisitions" element={<Guard perm="product.view"><Requisitions /></Guard>} />
              <Route path="warranty" element={<Guard perm="warranty.manage"><Warranty /></Guard>} />

              <Route path="cash" element={<Guard perm="cash.manage"><Cash /></Guard>} />
              <Route path="reports" element={<Guard perm="report.view"><Reports /></Guard>} />
              <Route path="settings" element={<Guard perm="settings.manage"><Settings /></Guard>} />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Layout>
        } />
      </Routes>
      <Toasts items={toasts} onDismiss={dismissToast} />
      <GlobalShortcuts />
    </>
  );
}

/** F1 mở nhanh màn hình bán hàng từ bất kỳ đâu. */
function GlobalShortcuts() {
  const nav = useNavigate();
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F1') { e.preventDefault(); nav('/pos'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);
  return null;
}

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
      <AlertTriangle size={28} className="text-muted-ink mb-3" aria-hidden="true" />
      <h1 className="text-lg font-display font-bold">Không tìm thấy trang này</h1>
      <p className="text-[13px] text-muted-ink mt-1">Đường dẫn có thể đã thay đổi.</p>
      <Button className="mt-4" onClick={() => window.location.assign('/')}>Về trang tổng quan</Button>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Shell />
      </AppProvider>
    </BrowserRouter>
  );
}
