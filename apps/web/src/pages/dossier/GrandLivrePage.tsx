import type { CompteGrandLivre } from "@compta/core";
import { useState } from "react";
import { Badge, DateFr, Empty, ErrorBox, Loading, Money } from "../../components/ui";
import { qs } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { useDossier } from "./DossierLayout";

export function GrandLivrePage() {
  const { dossier, exercice } = useDossier();
  const [compte, setCompte] = useState("");
  const [filtre, setFiltre] = useState("");
  const { data, error, loading } = useApi<{ comptes: CompteGrandLivre[] }>(`/api/dossiers/${dossier.id}/grand-livre${qs({ exerciceId: exercice.id, compte: filtre })}`);

  return (
    <div className="stack">
      <form className="row" onSubmit={(e) => { e.preventDefault(); setFiltre(compte); }}>
        <input placeholder="Compte ou préfixe (ex. 411, 6)" value={compte} onChange={(e) => setCompte(e.target.value)} style={{ width: 240 }} aria-label="Compte" />
        <button className="btn">Filtrer</button>
        {filtre && <button type="button" className="btn ghost" onClick={() => { setCompte(""); setFiltre(""); }}>Réinitialiser</button>}
      </form>
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : !data?.comptes.length ? <div className="card"><Empty title="Aucun mouvement" /></div> : data.comptes.map((c) => (
        <div className="card" key={c.compte}>
          <div className="card-header">
            <h3><span className="mono">{c.compte}</span> — {c.libelle}</h3>
            <span>Solde : <strong><Money cents={Math.abs(c.solde)} /></strong> {c.solde > 0 ? "débiteur" : c.solde < 0 ? "créditeur" : ""}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Date</th><th>Jnl</th><th>Pièce</th><th>Libellé</th><th>Let.</th><th className="num">Débit</th><th className="num">Crédit</th><th className="num">Solde</th></tr>
              </thead>
              <tbody>
                {c.mouvements.map((m, i) => (
                  <tr key={i}>
                    <td><DateFr iso={m.date} /></td>
                    <td><Badge>{m.journal}</Badge></td>
                    <td className="mono">{m.pieceRef}</td>
                    <td>{m.libelle}</td>
                    <td>{m.lettrage && <Badge tone="info">{m.lettrage}</Badge>}</td>
                    <td><Money cents={m.debit} hideZero /></td>
                    <td><Money cents={m.credit} hideZero /></td>
                    <td><Money cents={m.solde} signed /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={5}>Total du compte</td><td><Money cents={c.totalDebit} /></td><td><Money cents={c.totalCredit} /></td><td><Money cents={c.solde} signed /></td></tr>
              </tfoot>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
