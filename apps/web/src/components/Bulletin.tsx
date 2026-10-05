import type { Bulletin, ElementsVariables } from "@compta/core";
import { formatEUR } from "@compta/core";
import { Hash } from "./ui";

export interface BulletinDetail {
  id: number;
  periode: string;
  statut: "brouillon" | "valide";
  hash: string | null;
  validatedAt: string | null;
  employeur: { raisonSociale: string; siren: string; adresse: string; convention: string | null };
  salarie: { matricule: string; nom: string; prenom: string; emploi: string; statut: "cadre" | "non_cadre"; dateEntree: string; nirMasque: string | null };
  variables: ElementsVariables;
  bulletin: Bulletin;
  /** Cumuls de l'année civile, mois du bulletin inclus (bulletins validés uniquement). */
  cumuls: { bulletins: number; brut: number; netImposable: number; pas: number; heuresSup: number; hsExonerees: number; congesAcquis: number } | null;
}

const RUBRIQUES: Record<string, string> = {
  sante: "Santé",
  atmp: "Accidents du travail - maladies professionnelles",
  retraite: "Retraite",
  famille: "Famille",
  chomage: "Assurance chômage",
  autres: "Autres contributions dues par l'employeur",
  csg: "CSG / CRDS",
  exoneration: "Exonérations, écrêtements et allègements",
};

const eur = (c: number) => formatEUR(c).replace(" €", "");
const taux = (t: number | null) => (t == null ? "" : `${t.toLocaleString("fr-FR", { maximumFractionDigits: 4 })} %`);
const moisFr = (p: string) => new Date(`${p}-01T00:00:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

/** Bulletin de paie au format simplifié (arrêté du 25 février 2016, C. trav. art. R3243-1). */
export function BulletinView({ d }: { d: BulletinDetail }) {
  const b = d.bulletin;
  const rubriques = Object.keys(RUBRIQUES).filter((r) => b.lignes.some((l) => l.rubrique === r));
  const fin = new Date(Number(d.periode.slice(0, 4)), Number(d.periode.slice(5, 7)), 0);
  return (
    <article className="bulletin">
      <header className="bulletin-entete">
        <div>
          <strong>{d.employeur.raisonSociale}</strong>
          <div>{d.employeur.adresse}</div>
          <div>SIREN {d.employeur.siren}</div>
          {d.employeur.convention && <div>Convention collective : {d.employeur.convention}</div>}
        </div>
        <div className="bulletin-titre">
          <h2>Bulletin de paie</h2>
          <div>Période du 01/{d.periode.slice(5, 7)}/{d.periode.slice(0, 4)} au {fin.toLocaleDateString("fr-FR")}</div>
          <div className="subtle">{moisFr(d.periode)}</div>
        </div>
        <div>
          <strong>{d.salarie.prenom} {d.salarie.nom}</strong>
          <div>Matricule {d.salarie.matricule}</div>
          <div>{d.salarie.emploi} — {d.salarie.statut === "cadre" ? "Cadre" : "Non-cadre"}</div>
          <div>Entré(e) le {new Date(`${d.salarie.dateEntree}T00:00:00`).toLocaleDateString("fr-FR")}</div>
          {d.salarie.nirMasque && <div>N° SS {d.salarie.nirMasque}</div>}
        </div>
      </header>

      <table className="bulletin-table">
        <thead>
          <tr><th>Éléments de paie</th><th className="num">Base</th><th className="num">Taux sal. · pat.</th><th className="num">À déduire</th><th className="num">À payer</th><th className="num">Charges patronales</th></tr>
        </thead>
        <tbody>
          {b.remuneration.map((r) => (
            <tr key={r.code}>
              <td>{r.libelle}</td>
              <td className="num">{r.base != null ? r.base.toLocaleString("fr-FR") : ""}</td>
              <td className="num">{r.taux != null ? eur(r.taux) : ""}</td>
              <td className="num">{r.montant < 0 ? eur(-r.montant) : ""}</td>
              <td className="num">{r.montant > 0 ? eur(r.montant) : ""}</td>
              <td />
            </tr>
          ))}
          <tr className="bulletin-total"><td>Salaire brut</td><td /><td /><td /><td className="num">{eur(b.brut)}</td><td /></tr>
          {rubriques.map((r) => (
            <RubriqueRows key={r} titre={RUBRIQUES[r]!} lignes={b.lignes.filter((l) => l.rubrique === r)} />
          ))}
          <tr className="bulletin-total"><td>Total des cotisations et contributions</td><td /><td /><td className="num">{eur(b.totalSalarial)}</td><td /><td className="num">{eur(b.totalPatronal)}</td></tr>
          {d.variables.indemnitesNonSoumises > 0 && <tr><td>Indemnités non soumises (remboursements de frais)</td><td /><td /><td /><td className="num">{eur(d.variables.indemnitesNonSoumises)}</td><td /></tr>}
          <tr className="bulletin-total"><td>Net à payer avant impôt sur le revenu</td><td /><td /><td /><td className="num">{eur(b.netAvantImpot)}</td><td /></tr>
          <tr><td>Impôt sur le revenu prélevé à la source{b.pas.tauxNeutre ? " (taux non personnalisé)" : ""}</td><td className="num">{eur(b.pas.base)}</td><td className="num">{taux(b.pas.taux)}</td><td className="num">{eur(b.pas.montant)}</td><td /><td /></tr>
        </tbody>
      </table>

      <div className="bulletin-net">
        <div>
          <div>Net à payer au salarié</div>
          <strong>{formatEUR(b.netAPayer)}</strong>
        </div>
        <dl>
          <dt>Montant net social</dt><dd>{formatEUR(b.netSocial)}</dd>
          <dt>Net imposable</dt><dd>{formatEUR(b.netImposable)}</dd>
          <dt>Coût total employeur</dt><dd>{formatEUR(b.coutEmployeur)}</dd>
          <dt>Allègements de cotisations</dt><dd>{formatEUR(b.allegements.reductionGenerale + b.allegements.deductionHs)}</dd>
          <dt>Congés acquis ce mois</dt><dd>{b.congesAcquis.toLocaleString("fr-FR")} jours ouvrables</dd>
        </dl>
      </div>
      {d.cumuls && (
        <table className="bulletin-cumuls">
          <caption>Cumuls {d.periode.slice(0, 4)} ({d.cumuls.bulletins} bulletin{d.cumuls.bulletins > 1 ? "s" : ""})</caption>
          <thead><tr><th className="num">Salaire brut</th><th className="num">Net imposable</th><th className="num">Impôt prélevé</th><th className="num">Heures sup.</th><th className="num">HS exonérées</th><th className="num">Congés acquis</th></tr></thead>
          <tbody>
            <tr>
              <td className="num">{eur(d.cumuls.brut)}</td>
              <td className="num">{eur(d.cumuls.netImposable)}</td>
              <td className="num">{eur(d.cumuls.pas)}</td>
              <td className="num">{d.cumuls.heuresSup.toLocaleString("fr-FR")} h</td>
              <td className="num">{eur(d.cumuls.hsExonerees)}</td>
              <td className="num">{d.cumuls.congesAcquis.toLocaleString("fr-FR")} j</td>
            </tr>
          </tbody>
        </table>
      )}
      <footer className="subtle bulletin-pied">
        Dans votre intérêt et pour vous aider à faire valoir vos droits, conservez ce bulletin de paie sans limitation de durée. Pour en savoir plus : www.service-public.fr.
        {d.statut === "valide" && d.hash && <div>Bulletin validé le {new Date(d.validatedAt!).toLocaleDateString("fr-FR")} — empreinte <Hash value={d.hash} /></div>}
        {d.statut === "brouillon" && <div><strong>Brouillon — non valable comme bulletin de paie.</strong></div>}
        <div>Barème {b.bareme}. {b.avertissements.join(" ")}</div>
      </footer>
    </article>
  );
}

function RubriqueRows({ titre, lignes }: { titre: string; lignes: Bulletin["lignes"] }) {
  return (
    <>
      <tr className="bulletin-rubrique"><td colSpan={6}>{titre}</td></tr>
      {lignes.map((l) => (
        <tr key={l.code}>
          <td className="bulletin-indent">{l.libelle}</td>
          <td className="num">{l.base ? eur(l.base) : ""}</td>
          <td className="num">{[l.tauxSal, l.tauxPat].filter((t) => t != null).map(taux).join(" · ")}</td>
          <td className="num">{l.montantSal ? eur(l.montantSal) : ""}</td>
          <td />
          <td className="num">{l.montantPat ? eur(l.montantPat) : ""}</td>
        </tr>
      ))}
    </>
  );
}
