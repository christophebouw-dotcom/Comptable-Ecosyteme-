import { useState } from "react";
import { Link, NavLink, Outlet, useOutletContext, useParams } from "react-router";
import { ErrorBox, Loading, PageHeader } from "../../components/ui";
import { useApi, useAuth } from "../../lib/hooks";
import type { Dossier, Exercice } from "../../lib/types";

export interface DossierCtx {
  dossier: Dossier & { exercices: Exercice[]; journaux: { code: string; libelle: string; type: string }[] };
  exercice: Exercice;
  setExerciceId: (id: number) => void;
  reload: () => void;
  base: string;
}

export const useDossier = () => useOutletContext<DossierCtx>();

export function DossierLayout() {
  const { dossierId } = useParams();
  const { can } = useAuth();
  const { data, error, loading, reload } = useApi<DossierCtx["dossier"]>(`/api/dossiers/${dossierId}`);
  const [exerciceId, setExerciceId] = useState<number | null>(null);

  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const exercices = data.exercices;
  const exercice =
    exercices.find((e) => e.id === exerciceId) ?? [...exercices].reverse().find((e) => e.statut === "ouvert") ?? exercices[0]!;
  const base = `/dossiers/${data.id}`;
  const tab = ({ isActive }: { isActive: boolean }) => `tab ${isActive ? "active" : ""}`;

  return (
    <div className="page">
      <PageHeader
        breadcrumb={<><Link to="/dossiers">Dossiers</Link> / {data.raisonSociale}</>}
        title={data.raisonSociale}
        subtitle={`${data.formeJuridique} · SIREN ${data.siren} · ${data.ville}`}
        actions={
          <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            Exercice
            <select value={exercice.id} onChange={(e) => setExerciceId(Number(e.target.value))} style={{ width: "auto" }}>
              {exercices.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.debut.slice(0, 4) === e.fin.slice(0, 4) ? e.debut.slice(0, 4) : `${e.debut} → ${e.fin}`} {e.statut === "cloture" ? "(clôturé)" : ""}
                </option>
              ))}
            </select>
          </label>
        }
      />
      <nav className="tabs" aria-label="Sections du dossier">
        <NavLink to={base} end className={tab}>Synthèse</NavLink>
        {can("compta:write") && <NavLink to={`${base}/saisie`} className={tab}>Saisie</NavLink>}
        <NavLink to={`${base}/ecritures`} className={tab}>Écritures</NavLink>
        <NavLink to={`${base}/balance`} className={tab}>Balance</NavLink>
        <NavLink to={`${base}/grand-livre`} className={tab}>Grand livre</NavLink>
        <NavLink to={`${base}/etats`} className={tab}>États financiers</NavLink>
        <NavLink to={`${base}/tva`} className={tab}>TVA</NavLink>
        <NavLink to={`${base}/factures`} className={tab}>Factures</NavLink>
        <NavLink to={`${base}/tiers`} className={tab}>Tiers</NavLink>
        <NavLink to={`${base}/cloture`} className={tab}>Clôture & FEC</NavLink>
      </nav>
      <Outlet context={{ dossier: data, exercice, setExerciceId, reload, base } satisfies DossierCtx} />
    </div>
  );
}
