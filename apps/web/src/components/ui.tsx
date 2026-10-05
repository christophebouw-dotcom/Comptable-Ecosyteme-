import { formatEUR } from "@compta/core";
import { type ReactNode, useEffect } from "react";
import type { ApiError } from "../lib/api";

export function Money({ cents, hideZero = false, signed = false }: { cents: number; hideZero?: boolean; signed?: boolean }) {
  if (hideZero && cents === 0) return <span className="subtle">—</span>;
  const s = formatEUR(cents);
  return <span className={`num ${signed && cents < 0 ? "danger-text" : ""}`}>{s}</span>;
}

export function DateFr({ iso, withTime = false }: { iso: string | null | undefined; withTime?: boolean }) {
  if (!iso) return <span className="subtle">—</span>;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return (
    <time dateTime={iso}>
      {withTime
        ? d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })
        : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })}
    </time>
  );
}

export function Card({ title, subtitle, actions, children, padded = true }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; padded?: boolean }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-header">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="subtle">{subtitle}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      {padded ? <div className="card-body">{children}</div> : children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "ok" | "warn" | "danger" }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={`value ${tone === "danger" ? "danger-text" : tone === "ok" ? "ok-text" : ""}`}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Badge({ tone, children, dot }: { tone?: "ok" | "warn" | "danger" | "info"; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`badge ${tone ?? ""}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

export function Alert({ tone = "info", title, children }: { tone?: "info" | "warn" | "danger" | "ok"; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`alert ${tone}`} role={tone === "danger" ? "alert" : undefined}>
      <div>
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

export function ErrorBox({ error }: { error: ApiError | null | undefined }) {
  if (!error) return null;
  const details = error.detailMessages;
  return (
    <Alert tone="danger" title={error.message}>
      {details.length > 0 && (
        <ul>
          {details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

export function Loading({ label = "Chargement…" }: { label?: string }) {
  return <div className="empty subtle">{label}</div>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, hint, children, span2 }: { label: string; hint?: ReactNode; children: ReactNode; span2?: boolean }) {
  return (
    <label className={`field ${span2 ? "span-2" : ""}`}>
      {label}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function PageHeader({ title, subtitle, breadcrumb, actions }: { title: ReactNode; subtitle?: ReactNode; breadcrumb?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        {breadcrumb && <div className="breadcrumb">{breadcrumb}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Hash({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="subtle">—</span>;
  return (
    <span className="hash" title={value}>
      {value.slice(0, 16)}…{value.slice(-8)}
    </span>
  );
}

export const STATUT_FACTURE: Record<string, { label: string; tone: "ok" | "warn" | "info" | undefined }> = {
  brouillon: { label: "Brouillon", tone: undefined },
  emise: { label: "Émise", tone: "info" },
  payee: { label: "Payée", tone: "ok" },
};
