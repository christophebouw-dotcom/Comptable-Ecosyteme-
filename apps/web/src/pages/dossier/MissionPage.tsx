import { type AlerteMission, type Mission, toCents } from "@compta/core";
import { useEffect, useState } from "react";
import { Alert, Badge, Card, DateFr, ErrorBox, Field, Loading } from "../../components/ui";
import { api } from "../../lib/api";
import { useAction, useApi, useAuth, useToast } from "../../lib/hooks";
import { useDossier } from "./DossierLayout";

interface MissionData {
  mission: Mission | null;
  alertes: AlerteMission[];
  prochaineRevue: string | null;
  typesMission: Record<string, string>;
}

const vide: Mission = {
  types: ["tenue_presentation"], lettreSigneeLe: null, honorairesAnnuelsHT: null, risqueLcbft: "standard",
  identiteVerifieeLe: null, beneficiairesEffectifs: "", revueLcbftLe: null, ppe: false,
};

export function MissionPage() {
  const { dossier } = useDossier();
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<MissionData>(`/api/dossiers/${dossier.id}/mission`);
  const [m, setM] = useState<Mission>(vide);
  const [honoraires, setHonoraires] = useState("");
  const { pending, error: saveError, run } = useAction();
  const lecture = !can("dossiers:write");

  useEffect(() => {
    if (!data) return;
    setM(data.mission ?? vide);
    setHonoraires(data.mission?.honorairesAnnuelsHT ? (data.mission.honorairesAnnuelsHT / 100).toFixed(2).replace(".", ",") : "");
  }, [data]);

  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const set = <K extends keyof Mission>(k: K, v: Mission[K]) => setM({ ...m, [k]: v });
  const date = (k: "lettreSigneeLe" | "identiteVerifieeLe" | "revueLcbftLe") => (
    <input type="date" value={m[k] ?? ""} onChange={(e) => set(k, e.target.value || null)} disabled={lecture} />
  );

  return (
    <div className="stack">
      {data.alertes.length > 0 ? (
        <Alert tone={data.alertes.some((a) => a.niveau === "bloquant") ? "danger" : "warn"} title="Obligations professionnelles à régulariser">
          <ul>{data.alertes.map((a) => <li key={a.code}>{a.message} <span className="subtle">({a.reference})</span></li>)}</ul>
        </Alert>
      ) : (
        <Alert tone="ok" title="Dossier en règle">Lettre de mission signée et vigilance LCB-FT à jour{data.prochaineRevue && <> — prochaine revue avant le <DateFr iso={data.prochaineRevue} /></>}.</Alert>
      )}
      <ErrorBox error={saveError} />
      <div className="grid grid-2">
        <Card title="Lettre de mission" subtitle="Code de déontologie des experts-comptables, art. 151">
          <div className="stack">
            <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={lecture}>
              <legend className="subtle" style={{ marginBottom: 6 }}>Missions confiées</legend>
              {Object.entries(data.typesMission).map(([k, v]) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={m.types.includes(k as Mission["types"][number])} onChange={(e) => set("types", e.target.checked ? [...m.types, k as Mission["types"][number]] : m.types.filter((t) => t !== k))} />
                  {v}
                </label>
              ))}
            </fieldset>
            <div className="form-grid">
              <Field label="Lettre signée le">{date("lettreSigneeLe")}</Field>
              <Field label="Honoraires annuels HT (€)"><input className="num" inputMode="decimal" value={honoraires} onChange={(e) => setHonoraires(e.target.value)} disabled={lecture} /></Field>
            </div>
          </div>
        </Card>
        <Card title="Vigilance LCB-FT" subtitle="Code monétaire et financier, art. L561-5 et suivants">
          <div className="stack">
            <div className="form-grid">
              <Field label="Niveau de risque">
                <select value={m.risqueLcbft} onChange={(e) => set("risqueLcbft", e.target.value as Mission["risqueLcbft"])} disabled={lecture}>
                  <option value="faible">Faible (vigilance allégée)</option>
                  <option value="standard">Standard</option>
                  <option value="eleve">Élevé (vigilance renforcée)</option>
                </select>
              </Field>
              <Field label="Identité vérifiée le">{date("identiteVerifieeLe")}</Field>
              <Field label="Dernière revue de vigilance">{date("revueLcbftLe")}</Field>
              <Field label="Prochaine revue">{data.prochaineRevue ? <span style={{ padding: "8px 0" }}><DateFr iso={data.prochaineRevue} /> {data.prochaineRevue < new Date().toISOString().slice(0, 10) && <Badge tone="danger">Échue</Badge>}</span> : <span className="subtle" style={{ padding: "8px 0" }}>—</span>}</Field>
            </div>
            <Field label="Bénéficiaires effectifs" hint="Personnes physiques détenant plus de 25 % du capital ou des droits de vote, ou exerçant le contrôle (CMF R561-1)">
              <textarea value={m.beneficiairesEffectifs ?? ""} onChange={(e) => set("beneficiairesEffectifs", e.target.value)} disabled={lecture} />
            </Field>
            <label className="check"><input type="checkbox" checked={m.ppe} onChange={(e) => set("ppe", e.target.checked)} disabled={lecture} /> Personne politiquement exposée (PPE) parmi les dirigeants ou bénéficiaires</label>
            <p className="subtle">Les pièces d'identification sont conservées 5 ans après la fin de la relation d'affaires (CMF L561-12). En cas de soupçon, la déclaration à Tracfin est effectuée par le déclarant désigné du cabinet, sans en informer le client.</p>
          </div>
        </Card>
      </div>
      <IaCard />
      {!lecture && (
        <div className="form-actions">
          <button className="btn primary" disabled={pending} onClick={() => run(async () => {
            await api.put(`/api/dossiers/${dossier.id}/mission`, { ...m, beneficiairesEffectifs: m.beneficiairesEffectifs || null, honorairesAnnuelsHT: honoraires ? toCents(honoraires) : null });
            toast("Mission enregistrée");
            reload();
          })}>Enregistrer</button>
        </div>
      )}
    </div>
  );
}

function IaCard() {
  const { dossier, reload } = useDossier();
  const { can } = useAuth();
  const toast = useToast();
  const statut = useApi<{ active: boolean; modele: string | null }>("/api/ia/statut");
  const { pending, error, run } = useAction();
  const autorisee = !!dossier.iaAutorisee;
  return (
    <Card title="Assistance par intelligence artificielle" subtitle="Lecture automatique des pièces et suggestions d'imputation" actions={autorisee ? <Badge tone="ok">Autorisée</Badge> : <Badge>Non autorisée</Badge>}>
      <div className="stack">
        <p className="muted">
          Lorsque l'assistance est autorisée, les pièces déposées (factures, tickets) et les libellés bancaires de ce dossier sont transmis au service d'IA Claude
          (Anthropic, sous-traitant au sens de l'art. 28 du RGPD) pour en extraire les données. Aucune écriture n'est validée automatiquement : chaque proposition est contrôlée puis validée par le cabinet.
          Recueillez l'accord du client (clause de la lettre de mission) avant d'activer.
        </p>
        {statut.data && !statut.data.active && <Alert tone="info">Aucun service d'IA n'est configuré sur ce serveur : l'autorisation sera effective dès sa mise en service.</Alert>}
        <ErrorBox error={error} />
        {can("dossiers:write") && (
          <div>
            <button className={`btn ${autorisee ? "danger" : "primary"}`} disabled={pending} onClick={() => run(async () => {
              await api.put(`/api/dossiers/${dossier.id}/ia`, { autorisee: !autorisee });
              toast(autorisee ? "Assistance IA retirée pour ce dossier" : "Assistance IA autorisée pour ce dossier");
              reload();
            })}>{autorisee ? "Retirer l'autorisation" : "Autoriser l'assistance IA"}</button>
          </div>
        )}
      </div>
    </Card>
  );
}
