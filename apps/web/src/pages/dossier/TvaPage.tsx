import { type DeclarationTva, formatTaux } from "@compta/core";
import { useState } from "react";
import { Alert, Card, ErrorBox, Field, Loading, Money } from "../../components/ui";
import { api, qs } from "../../lib/api";
import { useAction, useApi, useAuth, useToast } from "../../lib/hooks";
import { useDossier } from "./DossierLayout";

function moisPrecedent(): { debut: string; fin: string } {
  const d = new Date();
  const debut = new Date(Date.UTC(d.getFullYear(), d.getMonth() - 1, 1));
  const fin = new Date(Date.UTC(d.getFullYear(), d.getMonth(), 0));
  return { debut: debut.toISOString().slice(0, 10), fin: fin.toISOString().slice(0, 10) };
}

export function TvaPage() {
  const { dossier, exercice } = useDossier();
  const { can } = useAuth();
  const toast = useToast();
  const init = moisPrecedent();
  const [debut, setDebut] = useState(init.debut >= exercice.debut && init.fin <= exercice.fin ? init.debut : exercice.debut);
  const [fin, setFin] = useState(init.debut >= exercice.debut && init.fin <= exercice.fin ? init.fin : exercice.fin);
  const [credit, setCredit] = useState("0");
  const creditCents = Math.round(Number(credit.replace(",", ".")) * 100) || 0;
  const { data, error, loading } = useApi<DeclarationTva & { brouillardsExclus: number }>(`/api/dossiers/${dossier.id}/tva${qs({ debut, fin, creditAnterieur: creditCents })}`);
  const action = useAction();

  if (dossier.regimeTva === "franchise") {
    return <Alert tone="info" title="Franchise en base de TVA">Ce dossier bénéficie de la franchise en base (CGI art. 293 B) : aucune déclaration de TVA n'est due. Les factures portent la mention « TVA non applicable, art. 293 B du CGI ».</Alert>;
  }

  return (
    <div className="stack">
      <Card title="Période de déclaration" subtitle={dossier.regimeTva === "reel_simplifie" ? "Régime simplifié : déclaration annuelle CA12" : "Régime réel normal : déclaration CA3"}>
        <div className="form-grid">
          <Field label="Du"><input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} /></Field>
          <Field label="Au"><input type="date" value={fin} onChange={(e) => setFin(e.target.value)} /></Field>
          <Field label="Crédit de TVA antérieur (€)" hint="Ligne 22 de la CA3"><input className="num" inputMode="decimal" value={credit} onChange={(e) => setCredit(e.target.value)} /></Field>
        </div>
      </Card>
      <ErrorBox error={error ?? action.error} />
      {data && data.brouillardsExclus > 0 && <Alert tone="warn" title={`${data.brouillardsExclus} écriture(s) en brouillard exclue(s)`}>Seules les écritures validées sont prises en compte. Faites valider les brouillards de la période avant de déclarer.</Alert>}
      {loading && !data ? <Loading /> : data && (
        <div className="grid grid-2">
          <Card title="TVA brute (collectée)" padded={false}>
            <table>
              <thead><tr><th>Taux</th><th className="num">Base HT</th><th className="num">Taxe due</th></tr></thead>
              <tbody>
                {data.collectee.length === 0 && <tr><td colSpan={3} className="subtle">Aucune opération imposable</td></tr>}
                {data.collectee.map((c) => (
                  <tr key={c.tauxBp}><td>{formatTaux(c.tauxBp)}</td><td><Money cents={c.base} /></td><td><Money cents={c.taxe} /></td></tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={2}>Total TVA brute</td><td><Money cents={data.totalCollectee} /></td></tr></tfoot>
            </table>
          </Card>
          <Card title="TVA déductible" padded={false}>
            <table>
              <tbody>
                <tr><td>Biens et services (44566)</td><td><Money cents={data.deductibleBiensServices} /></td></tr>
                <tr><td>Immobilisations (44562)</td><td><Money cents={data.deductibleImmobilisations} /></td></tr>
                <tr><td>Crédit antérieur reporté</td><td><Money cents={data.creditAnterieur} /></td></tr>
              </tbody>
              <tfoot><tr><td>Total déductible</td><td><Money cents={data.totalDeductible} /></td></tr></tfoot>
            </table>
          </Card>
          <div className="card stat" style={{ gridColumn: "span 2" }}>
            <div className="row between">
              <div>
                <div className="label">{data.tvaNetteDue > 0 ? "TVA nette à payer" : "Crédit de TVA à reporter"}</div>
                <div className={`value ${data.tvaNetteDue > 0 ? "danger-text" : "ok-text"}`}><Money cents={data.tvaNetteDue || data.creditTva} /></div>
              </div>
              {can("compta:write") && exercice.statut === "ouvert" && (
                <button
                  className="btn primary"
                  disabled={action.pending || (data.totalCollectee === 0 && data.totalDeductible === 0)}
                  onClick={() =>
                    action.run(async () => {
                      await api.post(`/api/dossiers/${dossier.id}/tva/liquidation`, { debut, fin, creditAnterieur: creditCents });
                      toast("Écriture de liquidation créée en brouillard (journal OD)");
                    })
                  }
                >
                  Générer l'écriture de liquidation
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
