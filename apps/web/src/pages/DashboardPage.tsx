import type { Echeance } from "@compta/core";
import { Link } from "react-router";
import { Badge, Card, DateFr, Empty, ErrorBox, Loading, PageHeader, Stat } from "../components/ui";
import { useApi, useAuth } from "../lib/hooks";
import type { Dossier } from "../lib/types";

interface RgpdDashboard {
  demandesEnCours: number;
  demandesUrgentes: number;
  violationsOuvertes: number;
  notificationsEnAttente: { id: number; titre: string; heuresRestantes: number | null }[];
  traitements: number;
  prochainesDemandes: { id: number; typeLibelle: string; demandeur: string; echeance: string; joursRestants: number }[];
}

export function DashboardPage() {
  const { user, can } = useAuth();
  const dossiers = useApi<Dossier[]>(can("dossiers:read") ? "/api/dossiers" : null);
  const rgpd = useApi<RgpdDashboard>(can("rgpd:manage") ? "/api/rgpd/tableau-de-bord" : null);

  const echeances = (dossiers.data ?? [])
    .flatMap((d) => (d.prochainesEcheances ?? []).map((e) => ({ ...e, dossier: d })))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8);
  const brouillards = (dossiers.data ?? []).reduce((a, d) => a + (d.brouillards ?? 0), 0);
  const hour = new Date().getHours();

  return (
    <div className="page">
      <PageHeader title={`${hour < 18 ? "Bonjour" : "Bonsoir"}, ${user!.nom.split(" ")[0]}`} subtitle={`${user!.roleLabel} — ${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`} />

      {can("dossiers:read") && (
        <div className="grid grid-4" style={{ marginBottom: 16 }}>
          <Stat label="Dossiers actifs" value={dossiers.data?.length ?? "…"} />
          <Stat label="Écritures en brouillard" value={brouillards} hint="À valider par un expert-comptable" tone={brouillards > 0 ? "danger" : undefined} />
          <Stat label="Écritures validées" value={(dossiers.data ?? []).reduce((a, d) => a + (d.validees ?? 0), 0)} hint="Intangibles et chaînées" />
          <Stat label="Prochaine échéance" value={echeances[0] ? <DateFr iso={echeances[0].date} /> : "—"} hint={echeances[0]?.libelle} />
        </div>
      )}

      {can("rgpd:manage") && rgpd.data && (
        <div className="grid grid-4" style={{ marginBottom: 16 }}>
          <Stat label="Demandes de droits en cours" value={rgpd.data.demandesEnCours} hint={`${rgpd.data.demandesUrgentes} urgente(s)`} tone={rgpd.data.demandesUrgentes ? "danger" : undefined} />
          <Stat label="Violations ouvertes" value={rgpd.data.violationsOuvertes} tone={rgpd.data.violationsOuvertes ? "danger" : "ok"} />
          <Stat label="Notifications CNIL en attente" value={rgpd.data.notificationsEnAttente.length} hint="Délai légal : 72 heures" tone={rgpd.data.notificationsEnAttente.length ? "danger" : "ok"} />
          <Stat label="Traitements au registre" value={rgpd.data.traitements} hint="RGPD art. 30" />
        </div>
      )}

      <div className="grid grid-2">
        {can("dossiers:read") && (
          <Card title="Dossiers" actions={<Link className="btn sm" to="/dossiers">Tous les dossiers</Link>} padded={false}>
            <ErrorBox error={dossiers.error} />
            {dossiers.loading && !dossiers.data ? (
              <Loading />
            ) : dossiers.data?.length ? (
              <table>
                <tbody>
                  {dossiers.data.slice(0, 8).map((d) => (
                    <tr key={d.id}>
                      <td>
                        <Link to={`/dossiers/${d.id}`}><strong>{d.raisonSociale}</strong></Link>
                        <div className="subtle">SIREN {d.siren} · {d.formeJuridique} · {d.impot}</div>
                      </td>
                      <td className="actions">
                        {(d.brouillards ?? 0) > 0 ? <Badge tone="warn" dot>{d.brouillards} brouillard(s)</Badge> : <Badge tone="ok" dot>À jour</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty title="Aucun dossier">Aucun dossier ne vous est affecté.</Empty>
            )}
          </Card>
        )}

        {can("dossiers:read") && (
          <Card title="Échéancier fiscal" subtitle="Dates indicatives — à confirmer sur l'espace professionnel impots.gouv.fr">
            {echeances.length ? (
              <ul className="timeline">
                {echeances.map((e: Echeance & { dossier: Dossier }, i) => (
                  <li key={i}>
                    <span className="date"><DateFr iso={e.date} /></span>
                    <span>
                      <Badge tone={e.categorie === "tva" ? "info" : e.categorie === "is" ? "warn" : undefined}>{e.code}</Badge>{" "}
                      {e.libelle}
                      <div className="subtle">{e.dossier.raisonSociale}</div>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="Aucune échéance proche" />
            )}
          </Card>
        )}

        {can("rgpd:manage") && rgpd.data && (
          <Card title="Demandes de droits à traiter" actions={<Link className="btn sm" to="/rgpd/demandes">Centre RGPD</Link>}>
            {rgpd.data.prochainesDemandes.length ? (
              <ul className="timeline">
                {rgpd.data.prochainesDemandes.map((d) => (
                  <li key={d.id}>
                    <span className="date"><DateFr iso={d.echeance} /></span>
                    <span>
                      {d.typeLibelle} — {d.demandeur}{" "}
                      <Badge tone={d.joursRestants < 0 ? "danger" : d.joursRestants <= 5 ? "warn" : "info"}>
                        {d.joursRestants < 0 ? `${-d.joursRestants} j de retard` : `J-${d.joursRestants}`}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="Aucune demande en cours" />
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
