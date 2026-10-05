export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  /** Messages détaillés lisibles (anomalies d'écriture, champs invalides, mentions manquantes…). */
  get detailMessages(): string[] {
    if (!Array.isArray(this.details)) return [];
    return this.details.map((d) => {
      if (typeof d === "string") return d;
      const o = d as { message?: string; champ?: string; ligne?: number; reference?: string };
      const prefix = o.ligne ? `Ligne ${o.ligne} : ` : o.champ ? `${o.champ} : ` : "";
      return `${prefix}${o.message ?? JSON.stringify(d)}${o.reference ? ` (${o.reference})` : ""}`;
    });
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export function onUnauthorized(fn: Listener) {
  unauthorizedListeners.add(fn);
  return () => {
    unauthorizedListeners.delete(fn);
  };
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith("/api/auth/")) unauthorizedListeners.forEach((l) => l());
    const err = data as { error?: string; details?: unknown } | null;
    throw new ApiError(res.status, err?.error ?? `Erreur ${res.status}`, err?.details);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body: unknown = {}) => request<T>("POST", url, body),
  put: <T>(url: string, body: unknown) => request<T>("PUT", url, body),
  patch: <T>(url: string, body: unknown) => request<T>("PATCH", url, body),
  del: <T>(url: string, body?: unknown) => request<T>("DELETE", url, body),
};

export function qs(params: Record<string, string | number | undefined | null | false>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== false && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
