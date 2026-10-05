import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ApiError, api, onUnauthorized } from "./api";
import type { Permission, User } from "./types";

// -- Authentification ----------------------------------------------------------

interface AuthState {
  user: User | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
  can: (p: Permission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ user: User | null }>("/api/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    return onUnauthorized(() => setUser(null));
  }, []);

  const logout = useCallback(async () => {
    await api.post("/api/auth/logout").catch(() => undefined);
    setUser(null);
  }, []);

  const can = useCallback((p: Permission) => !!user?.permissions.includes(p), [user]);

  return <AuthContext.Provider value={{ user, loading, setUser, logout, can }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider manquant");
  return ctx;
}

// -- Chargement de données --------------------------------------------------------

export interface AsyncState<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
  setData: (d: T) => void;
}

/** Charge une ressource ; se recharge quand l'URL change. url = null pour ne rien charger. */
export function useApi<T>(url: string | null): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!url);
  const [tick, setTick] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    if (!url) return;
    const id = ++current.current;
    setLoading(true);
    api
      .get<T>(url)
      .then((d) => {
        if (id === current.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (id === current.current) setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
      })
      .finally(() => {
        if (id === current.current) setLoading(false);
      });
  }, [url, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

// -- Notifications ---------------------------------------------------------------

interface Toast {
  id: number;
  message: string;
  kind: "ok" | "error";
}
const ToastContext = createContext<(message: string, kind?: "ok" | "error") => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, kind: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-zone" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === "error" ? "error" : ""}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** Exécute une action asynchrone avec gestion de l'état « en cours » et de l'erreur. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setPending(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, String(e)));
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);
  return { pending, error, run, setError };
}
