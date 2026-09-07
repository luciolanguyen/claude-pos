import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
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

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadSettings(), loadMeta()]);
      } catch (e) {
        toast('Không kết nối được máy chủ: ' + e.message, 'bad', 8000);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadSettings, loadMeta, toast]);

  const login = useCallback((u) => {
    setUser(u);
    localStorage.setItem(LS_USER, JSON.stringify(u));
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem(LS_USER);
  }, []);

  const saveSettings = useCallback(async (patch) => {
    const next = await api.put('/settings', patch);
    setSettings(next);
    return next;
  }, []);

  const store = settings?.store || {};
  const defaultWarehouse = meta.warehouses.find((w) => w.is_default)?.id || meta.warehouses[0]?.id;
  const defaultPriceList = meta.priceLists.find((p) => p.is_default)?.id || meta.priceLists[0]?.id;

  return (
    <AppCtx.Provider value={{
      settings, store, saveSettings, loadSettings,
      user, login, logout,
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
