import type { Bilan, CompteResultat } from "@compta/core";
import { Badge, Card, ErrorBox, Loading, Money } from "../../components/ui";
import { qs } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { useDossier } from "./DossierLayout";

export function EtatsPage() {
  const { dossier, exercice } = useDossier();
  const { data, error, loading } = useApi<{ bilan: Bilan; compteResultat: CompteResultat }>(`/api/dossiers/${dossier.id}/etats${qs({ exerciceId: exercice.id })}`);
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const { bilan: b, compteResultat: r } = data;

  return (
    <div className="stack">
      <div className="alert info"><div>États de synthèse <strong>simplifiés</strong> établis à partir des seules écritures validées. Ils ne se substituent pas aux comptes annuels et à la liasse fiscale.</div></div>
      <div className="grid grid-2">
        <Card title="Bilan — Actif" padded={false}>
          <table className="statement">
            <tbody>
              <tr className="section"><td colSpan={2}>Actif immobilisé</td></tr>
              <tr><td>Immobilisations brutes</td><td><Money cents={b.actif.immobilisationsBrutes} /></td></tr>
              <tr><td>Amortissements et dépréciations</td><td><Money cents={-b.actif.amortissementsEtDepreciations} signed /></td></tr>
              <tr className="subtotal"><td>Actif immobilisé net</td><td><Money cents={b.actif.actifImmobiliseNet} /></td></tr>
              <tr className="section"><td colSpan={2}>Actif circulant</td></tr>
              <tr><td>Stocks et en-cours</td><td><Money cents={b.actif.stocks} /></td></tr>
              <tr><td>Créances</td><td><Money cents={b.actif.creances} /></td></tr>
              <tr><td>Disponibilités</td><td><Money cents={b.actif.disponibilites} /></td></tr>
              <tr><td>Charges constatées d'avance</td><td><Money cents={b.actif.chargesConstateesAvance} /></td></tr>
              <tr className="total"><td>Total actif</td><td><Money cents={b.actif.total} /></td></tr>
            </tbody>
          </table>
        </Card>
        <Card title="Bilan — Passif" actions={b.equilibre ? <Badge tone="ok" dot>Équilibré</Badge> : <Badge tone="danger" dot>Déséquilibré</Badge>} padded={false}>
          <table className="statement">
            <tbody>
              <tr className="section"><td colSpan={2}>Capitaux propres</td></tr>
              <tr><td>Capital, réserves, report à nouveau</td><td><Money cents={b.passif.capitauxPropres} signed /></td></tr>
              <tr><td>Résultat de l'exercice</td><td><Money cents={b.passif.resultat} signed /></td></tr>
              <tr className="section"><td colSpan={2}>Provisions et dettes</td></tr>
              <tr><td>Provisions pour risques et charges</td><td><Money cents={b.passif.provisions} /></td></tr>
              <tr><td>Emprunts et dettes financières</td><td><Money cents={b.passif.emprunts} /></td></tr>
              <tr><td>Dettes fournisseurs, fiscales et sociales</td><td><Money cents={b.passif.dettes} /></td></tr>
              <tr><td>Produits constatés d'avance</td><td><Money cents={b.passif.produitsConstatesAvance} /></td></tr>
              <tr className="total"><td>Total passif</td><td><Money cents={b.passif.total} /></td></tr>
            </tbody>
          </table>
        </Card>
      </div>
      <Card title="Compte de résultat" padded={false}>
        <table className="statement">
          <tbody>
            <tr><td>Produits d'exploitation</td><td><Money cents={r.produitsExploitation} /></td></tr>
            <tr><td>Charges d'exploitation</td><td><Money cents={-r.chargesExploitation} signed /></td></tr>
            <tr className="subtotal"><td>Résultat d'exploitation</td><td><Money cents={r.resultatExploitation} signed /></td></tr>
            <tr><td>Produits financiers</td><td><Money cents={r.produitsFinanciers} /></td></tr>
            <tr><td>Charges financières</td><td><Money cents={-r.chargesFinancieres} signed /></td></tr>
            <tr className="subtotal"><td>Résultat financier</td><td><Money cents={r.resultatFinancier} signed /></td></tr>
            <tr><td>Produits exceptionnels</td><td><Money cents={r.produitsExceptionnels} /></td></tr>
            <tr><td>Charges exceptionnelles</td><td><Money cents={-r.chargesExceptionnelles} signed /></td></tr>
            <tr className="subtotal"><td>Résultat exceptionnel</td><td><Money cents={r.resultatExceptionnel} signed /></td></tr>
            <tr><td>Participation et impôts sur les bénéfices</td><td><Money cents={-r.participationEtImpots} signed /></td></tr>
            <tr className="total"><td>Résultat net</td><td><Money cents={r.resultatNet} signed /></td></tr>
          </tbody>
        </table>
        {r.detail.length > 0 && (
          <details style={{ padding: "12px 20px" }}>
            <summary className="muted" style={{ cursor: "pointer" }}>Détail par compte à 2 chiffres</summary>
            <table style={{ marginTop: 10 }}>
              <tbody>
                {r.detail.map((d) => (
                  <tr key={d.code}><td className="mono">{d.code}</td><td>{d.libelle}</td><td><Money cents={d.montant} /></td></tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </Card>
    </div>
  );
}
