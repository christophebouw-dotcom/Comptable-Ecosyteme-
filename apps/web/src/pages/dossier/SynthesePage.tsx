import type { Bilan, CompteResultat, Echeance } from "@compta/core";
import { useState } from "react";
import { Link } from "react-router";
import { Badge, Card, DateFr, Hash, Money, Stat } from "../../components/ui";
import { qs } from "../../lib/api";
import { useApi, useAuth } from "../../lib/hooks";
import { DossierForm, REGIMES_TVA } from "../DossiersPage";
import { useDossier } from "./DossierLayout";

export function SynthesePage() {
  const { dossier, exercice, reload, base } = useDossier();
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const etats = useApi<{ bilan: Bilan; compteResultat: CompteResultat }>(`/api/dossiers/${dossier.id}/etats${qs({ exerciceId: exercice.id })}`);
  const integrite = useApi<{ ok: boolean; count: number; brokenAt?: number }>(`/api/dossiers/${dossier.id}/integrite`);
  const echeances = useApi<Echeance[]>(`/api/dossiers/${dossier.id}/echeances`);
  const brouillards = useApi<unknown[]>(`/api/dossiers/${dossier.id}/ecritures${qs({ exerciceId: exercice.id, statut: "brouillard" })}`);
  const today = new Date().toISOString().slice(0, 10);
  const cr = etats.data?.compteResultat;
  const bilan = etats.data?.bilan;

  return (
    <div className="stack">
      <div className="grid grid-4">
        <Stat label="Chiffre d'affaires" value={cr ? <Money cents={cr.produitsExploitation} /> : "…"} hint="Produits d'exploitation validés" />
        <Stat label="Résultat net" value={cr ? <Money cents={cr.resultatNet} signed /> : "…"} tone={cr && cr.resultatNet < 0 ? "danger" : "ok"} />
        <Stat label="Trésorerie" value={bilan ? <Money cents={bilan.actif.disponibilites} /> : "…"} />
        <Stat
          label="En attente de validation"
          value={brouillards.data?.length ?? "…"}
          hint={<Link to={`${base}/ecritures`}>Voir les brouillards</Link>}
          tone={brouillards.data?.length ? "danger" : undefined}
        />
      </div>
      <div className="grid grid-2">
        <Card title="Identité de l'entreprise" actions={can("dossiers:write") && <button className="btn sm" onClick={() => setEditing(true)}>Modifier</button>}>
          <dl className="kv">
            <dt>Raison sociale</dt><dd>{dossier.raisonSociale}</dd>
            <dt>Forme · capital</dt><dd>{dossier.formeJuridique}{dossier.capital ? ` · ${dossier.capital}` : ""}</dd>
            <dt>SIREN</dt><dd className="mono">{dossier.siren}</dd>
            <dt>Adresse</dt><dd>{dossier.adresse}, {dossier.codePostal} {dossier.ville}</dd>
            <dt>Régime de TVA</dt><dd>{REGIMES_TVA[dossier.regimeTva]}</dd>
            <dt>Imposition</dt><dd>{dossier.impot === "IS" ? "Impôt sur les sociétés" : "Impôt sur le revenu"}</dd>
            <dt>IBAN</dt><dd className="mono">{dossier.ibanMasque ?? "—"} <span className="subtle">(chiffré)</span></dd>
            <dt>Exercice affiché</dt>
            <dd>
              <DateFr iso={exercice.debut} /> → <DateFr iso={exercice.fin} />{" "}
              {exercice.statut === "cloture" ? <Badge tone="info">Clôturé</Badge> : <Badge tone="ok">Ouvert</Badge>}
            </dd>
          </dl>
        </Card>
        <Card title="Intégrité de la comptabilité" subtitle="Chaînage SHA-256 des écritures validées (piste d'audit fiable)">
          {integrite.data ? (
            <div className="stack">
              {integrite.data.ok ? (
                <div className="alert ok"><div><strong>Chaîne intègre.</strong> {integrite.data.count} écriture(s) validée(s), aucune altération détectée.</div></div>
              ) : (
                <div className="alert danger"><div><strong>Rupture détectée</strong> à l'écriture n° {integrite.data.brokenAt}. Contactez immédiatement l'administrateur.</div></div>
              )}
              {exercice.empreinte_cloture && (
                <div>
                  <div className="subtle">Empreinte de clôture de l'exercice</div>
                  <Hash value={exercice.empreinte_cloture} />
                </div>
              )}
              <p className="subtle">
                Les écritures validées sont protégées par des déclencheurs en base de données : aucune modification ni suppression n'est possible, y compris par un administrateur. Les corrections passent par une contre-passation.
              </p>
            </div>
          ) : (
            "…"
          )}
        </Card>
      </div>
      <Card title="Échéancier fiscal de l'année" subtitle="Dates indicatives">
        <ul className="timeline">
          {(echeances.data ?? []).map((e, i) => (
            <li key={i} style={{ opacity: e.date < today ? 0.5 : 1 }}>
              <span className="date"><DateFr iso={e.date} /></span>
              <Badge tone={e.categorie === "tva" ? "info" : e.categorie === "is" ? "warn" : undefined}>{e.code}</Badge>
              <span>{e.libelle}</span>
            </li>
          ))}
        </ul>
      </Card>
      {editing && <DossierForm initial={dossier} onClose={() => setEditing(false)} onSaved={reload} />}
    </div>
  );
}
