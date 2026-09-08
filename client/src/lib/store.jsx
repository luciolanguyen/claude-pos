import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { api } from './api';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const LS_USER = 'thpos.user';

export function AppProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_USER) || 'null'); } catch { return null; }
  });
  const [meta, setMeta] = useState({ priceLists: [], warehouses: [], categories: [], accounts: [] });
  /* Quyền do máy chủ trả về, không tự suy ra ở máy khách — để giao diện và
     máy chủ luôn hiểu giống nhau về việc ai được làm gì. */
  const [access, setAccess] = useState({ can: [], permissions: {}, login_required: true });
  const [toasts, setToasts] = useState([]);
  const [loading, setLoading] = useState(true);
  const toastId = useRef(0);

  const toast = useCallback((message, kind = 'ok', ms = 3200) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const loadMeta = useCallback(async () => {
    const [priceLists, warehouses, categories, accounts] = await Promise.all([
      api.priceLists(), api.warehouses(), api.categories(), api.cashAccounts(),
    ]);
    setMeta({ priceLists, warehouses, categories, accounts });
  }, []);

  const loadSettings = useCallback(async () => {
    setSettings(await api.settings());
  }, []);

  const loadAccess = useCallback(async () => {
    try {
      setAccess(await api.me());
    } catch {
      setAccess({ can: [], permissions: {}, login_required: true });
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadSettings(), loadMeta(), loadAccess()]);
      } catch (e) {
        toast('Không kết nối được máy chủ: ' + e.message, 'bad', 8000);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadSettings, loadMeta, loadAccess, toast]);

  const login = useCallback(async (u) => {
    setUser(u);
    localStorage.setItem(LS_USER, JSON.stringify(u));
    // Ghi vào localStorage trước rồi mới hỏi quyền, vì lớp gọi API đọc id
    // người dùng từ đó để gửi kèm mỗi lời gọi.
    await loadAccess();
  }, [loadAccess]);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem(LS_USER);
    setAccess({ can: [], permissions: {}, login_required: true });
  }, []);

  const saveSettings = useCallback(async (patch) => {
    const next = await api.put('/settings', patch);
    setSettings(next);
    return next;
  }, []);

  /* can('cash.manage') — dùng để ẩn menu và khoá nút. Chặn thật nằm ở máy chủ. */
  const canSet = useMemo(() => new Set(access.can || []), [access.can]);
  const can = useCallback((perm) => canSet.has(perm), [canSet]);

  const store = settings?.store || {};
  const defaultWarehouse = meta.warehouses.find((w) => w.is_default)?.id || meta.warehouses[0]?.id;
  const defaultPriceList = meta.priceLists.find((p) => p.is_default)?.id || meta.priceLists[0]?.id;

  return (
    <AppCtx.Provider value={{
      settings, store, saveSettings, loadSettings,
      user, login, logout, can, access, loadAccess,
      meta, loadMeta, defaultWarehouse, defaultPriceList,
      toast, toasts, dismissToast, loading,
    }}>
      {children}
    </AppCtx.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* Hook tải dữ liệu: tự huỷ kết quả cũ nếu tham số đổi giữa chừng.     */
/* ------------------------------------------------------------------ */
export function useFetch(fn, deps = [], { skip = false } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(!skip);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (skip) { setBusy(false); return; }
    let alive = true;
    setBusy(true);
    setError(null);
    Promise.resolve(fnRef.current())
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(e); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, skip]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, busy, reload, setData };
}

/** Trì hoãn giá trị — dùng cho ô tìm kiếm để không gọi API mỗi lần gõ. */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Lưu trạng thái nhỏ vào localStorage (giỏ hàng đang dở, bộ lọc...). */
export function useLocal(key, initial) {
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* hết dung lượng */ }
  }, [key, v]);
  return [v, setV];
}

/* ------------------------------------------------------------------ */
/* Hook cho danh sách có phân trang phía máy chủ                       */
/*                                                                     */
/* Máy chủ trả { rows, total }. Cỡ trang nhớ theo từng màn hình trong  */
/* localStorage, để thu ngân quen xem 50 dòng thì lần sau mở ra vẫn 50 */
/* mà không ảnh hưởng màn hình khác.                                   */
/* ------------------------------------------------------------------ */

export const PAGE_SIZES = [10, 20, 50, 100];

export function usePaged(fn, deps = [], { key = null, defaultSize = 20 } = {}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(() => {
    if (!key) return defaultSize;
    const v = Number(localStorage.getItem(`thpos.pagesize.${key}`));
    return PAGE_SIZES.includes(v) ? v : defaultSize;
  });

  const setPageSize = useCallback((v) => {
    setPageSizeRaw(v);
    setPage(1);                       // đổi cỡ trang thì về trang đầu
    if (key) {
      try { localStorage.setItem(`thpos.pagesize.${key}`, String(v)); } catch { /* trình duyệt chặn */ }
    }
  }, [key]);

  // Đổi bộ lọc thì quay về trang 1, nếu không sẽ rơi vào trang trống
  const depKey = JSON.stringify(deps);
  useEffect(() => { setPage(1); }, [depKey]);

  const res = useFetch(() => fn({ page, page_size: pageSize }), [depKey, page, pageSize]);
  const data = res.data;

  return {
    ...res,
    rows: Array.isArray(data) ? data : (data?.rows || []),
    total: Array.isArray(data) ? data.length : (data?.total || 0),
    extra: Array.isArray(data) ? {} : (data || {}),
    page, setPage, pageSize, setPageSize,
  };
}

/**
 * Kéo hết mọi trang của một danh sách có phân trang.
 * Dùng cho việc xuất Excel: người dùng lọc ra 700 hoá đơn thì file phải có
 * đủ 700 dòng, chứ không phải 20 dòng của trang đang mở.
 */
export async function fetchAllPages(fn, { pageSize = 200, maxPages = 200 } = {}) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fn({ page, page_size: pageSize });
    const rows = Array.isArray(res) ? res : (res?.rows || []);
    out.push(...rows);
    const total = Array.isArray(res) ? rows.length : (res?.total ?? out.length);
    if (out.length >= total || rows.length === 0) break;
  }
  return out;
}
