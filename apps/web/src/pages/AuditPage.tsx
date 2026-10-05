import { useState } from "react";
import { Alert, Badge, DateFr, Empty, ErrorBox, Hash, Loading, PageHeader } from "../components/ui";
import { api, qs } from "../lib/api";
import { useAction, useApi } from "../lib/hooks";

interface AuditEntry {
  id: number;
  at: string;
  user_email: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  dossier_id: number | null;
  ip: string | null;
  details: Record<string, unknown> | null;
  hash: string;
}

export function AuditPage() {
  const [action, setAction] = useState("");
  const { data, error, loading } = useApi<AuditEntry[]>(`/api/audit${qs({ action, limit: 300 })}`);
  const verif = useAction();
  const [result, setResult] = useState<{ ok: boolean; count: number; brokenAt?: number } | null>(null);

  return (
    <div className="page">
      <PageHeader
        title="Journal d'audit"
        subtitle="Traçabilité des opérations (RGPD art. 32, piste d'audit fiable). Journal en ajout seul, chaîné par empreintes SHA-256, conservé 10 ans."
        actions={
          <>
            <select value={action} onChange={(e) => setAction(e.target.value)} style={{ width: "auto" }} aria-label="Filtrer par type">
              <option value="">Toutes les opérations</option>
              <option value="auth">Authentification</option>
              <option value="ecriture">Écritures</option>
              <option value="facture">Factures</option>
              <option value="exercice">Clôtures</option>
              <option value="fec">Exports FEC</option>
              <option value="rgpd">RGPD</option>
              <option value="utilisateur">Utilisateurs</option>
            </select>
            <button className="btn primary" disabled={verif.pending} onClick={() => verif.run(async () => setResult(await api.get("/api/audit/verification")))}>
              Vérifier l'intégrité de la chaîne
            </button>
          </>
        }
      />
      <div className="stack">
        <ErrorBox error={error ?? verif.error} />
        {result && (result.ok
          ? <Alert tone="ok" title="Chaîne intègre">{result.count} événement(s) vérifié(s) : aucune altération, suppression ni insertion a posteriori.</Alert>
          : <Alert tone="danger" title="Altération détectée">La chaîne est rompue à l'événement n° {result.brokenAt}. Préservez les preuves et déclenchez la procédure de gestion d'incident.</Alert>)}
        <div className="card">
          {loading && !data ? <Loading /> : !data?.length ? <Empty title="Aucun événement" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Date</th><th>Utilisateur</th><th>Action</th><th>Objet</th><th>Détails</th><th>Empreinte</th></tr></thead>
                <tbody>
                  {data.map((e) => (
                    <tr key={e.id}>
                      <td className="mono">{e.id}</td>
                      <td><DateFr iso={e.at} withTime /></td>
                      <td>{e.user_email ?? <span className="subtle">système</span>}<div className="subtle">{e.ip}</div></td>
                      <td><Badge tone={e.action.startsWith("rgpd") ? "info" : e.action.includes("verrou") ? "danger" : undefined}>{e.action}</Badge></td>
                      <td className="subtle">{e.entity}{e.entity_id ? ` #${e.entity_id}` : ""}{e.dossier_id ? ` · dossier ${e.dossier_id}` : ""}</td>
                      <td className="subtle" style={{ maxWidth: 320 }}>{e.details ? <code style={{ wordBreak: "break-all" }}>{JSON.stringify(e.details).slice(0, 160)}</code> : ""}</td>
                      <td><Hash value={e.hash} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
