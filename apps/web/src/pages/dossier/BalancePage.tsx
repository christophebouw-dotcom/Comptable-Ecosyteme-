import type { Balance } from "@compta/core";
import { useState } from "react";
import { Badge, Empty, ErrorBox, Loading, Money } from "../../components/ui";
import { qs } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { useDossier } from "./DossierLayout";

export function BalancePage() {
  const { dossier, exercice } = useDossier();
  const [niveau, setNiveau] = useState("");
  const [brouillard, setBrouillard] = useState(false);
  const { data, error, loading } = useApi<Balance>(`/api/dossiers/${dossier.id}/balance${qs({ exerciceId: exercice.id, niveau, inclureBrouillard: brouillard ? "1" : undefined })}`);

  return (
    <div className="stack">
      <div className="row between">
        <div className="row">
          <select value={niveau} onChange={(e) => setNiveau(e.target.value)} style={{ width: "auto" }} aria-label="Niveau de détail">
            <option value="">Comptes détaillés</option>
            <option value="1">Par classe</option>
            <option value="2">Comptes à 2 chiffres</option>
            <option value="3">Comptes à 3 chiffres</option>
          </select>
          <label className="check"><input type="checkbox" checked={brouillard} onChange={(e) => setBrouillard(e.target.checked)} /> Inclure le brouillard (provisoire)</label>
        </div>
        <div className="row">
          {data && (data.equilibree ? <Badge tone="ok" dot>Balance équilibrée</Badge> : <Badge tone="danger" dot>Déséquilibre</Badge>)}
          <button className="btn sm" onClick={() => window.print()}>Imprimer</button>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        {loading && !data ? <Loading /> : !data?.lignes.length ? <Empty title="Balance vide">Aucune écriture validée sur l'exercice.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Compte</th>
                  <th>Libellé</th>
                  <th className="num">Total débit</th>
                  <th className="num">Total crédit</th>
                  <th className="num">Solde débiteur</th>
                  <th className="num">Solde créditeur</th>
                </tr>
              </thead>
              <tbody>
                {data.lignes.map((l) => (
                  <tr key={l.compte}>
                    <td className="mono">{l.compte}</td>
                    <td>{l.libelle}</td>
                    <td><Money cents={l.debit} hideZero /></td>
                    <td><Money cents={l.credit} hideZero /></td>
                    <td><Money cents={l.soldeDebiteur} hideZero /></td>
                    <td><Money cents={l.soldeCrediteur} hideZero /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Totaux</td>
                  <td><Money cents={data.totalDebit} /></td>
                  <td><Money cents={data.totalCredit} /></td>
                  <td><Money cents={data.totalSoldeDebiteur} /></td>
                  <td><Money cents={data.totalSoldeCrediteur} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
