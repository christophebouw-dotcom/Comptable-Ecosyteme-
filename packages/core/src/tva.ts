/**
 * Taxe sur la valeur ajoutée.
 *
 * Taux en vigueur en France métropolitaine (CGI, art. 278 à 281 nonies) :
 * 20 % (normal), 10 % (intermédiaire), 5,5 % (réduit), 2,1 % (particulier).
 * Les taux sont exprimés en points de base (1 % = 100).
 */
import { type Cents, applyRate } from "./money.js";
import type { Ecriture } from "./ledger.js";

export const TAUX_TVA = {
  NORMAL: 2000,
  INTERMEDIAIRE: 1000,
  REDUIT: 550,
  PARTICULIER: 210,
  EXONERE: 0,
} as const;

export const TAUX_TVA_LIST = [2000, 1000, 550, 210, 0] as const;

export type RegimeTva =
  | "franchise" // franchise en base (CGI art. 293 B)
  | "reel_simplifie" // CA12 annuelle + 2 acomptes
  | "reel_normal_mensuel" // CA3 mensuelle
  | "reel_normal_trimestriel"; // CA3 trimestrielle si TVA annuelle < 4 000 €

export function formatTaux(bp: number): string {
  return `${(bp / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
}

export function htToTtc(ht: Cents, tauxBp: number): { ht: Cents; tva: Cents; ttc: Cents } {
  const tva = applyRate(ht, tauxBp);
  return { ht, tva, ttc: ht + tva };
}

/** Décompose un TTC : la TVA est arrondie et le HT obtenu par différence. */
export function ttcToHt(ttc: Cents, tauxBp: number): { ht: Cents; tva: Cents; ttc: Cents } {
  const ht = Math.round((ttc * 10000) / (10000 + tauxBp));
  return { ht, tva: ttc - ht, ttc };
}

export interface LigneDeclarationTva {
  tauxBp: number;
  base: Cents;
  taxe: Cents;
}

export interface DeclarationTva {
  periode: { debut: string; fin: string };
  collectee: LigneDeclarationTva[];
  totalCollectee: Cents;
  deductibleBiensServices: Cents;
  deductibleImmobilisations: Cents;
  creditAnterieur: Cents;
  totalDeductible: Cents;
  /** Montant positif : TVA nette due. */
  tvaNetteDue: Cents;
  /** Montant positif : crédit de TVA à reporter ou à rembourser. */
  creditTva: Cents;
}

/**
 * Prépare une déclaration de TVA (type CA3) à partir des écritures de la
 * période : TVA collectée (4457x), déductible sur ABS (44566) et sur
 * immobilisations (44562), crédit antérieur (44567).
 */
export function computeDeclarationTva(
  ecritures: Ecriture[],
  periode: { debut: string; fin: string },
  creditAnterieur: Cents = 0,
): DeclarationTva {
  const parTaux = new Map<number, Cents>();
  let deductibleBS = 0;
  let deductibleImmo = 0;
  for (const e of ecritures) {
    if (e.date < periode.debut || e.date > periode.fin || e.journal === "AN") continue;
    for (const l of e.lignes) {
      if (l.compte.startsWith("4457")) {
        const taux = l.tauxTva ?? TAUX_TVA.NORMAL;
        parTaux.set(taux, (parTaux.get(taux) ?? 0) + l.credit - l.debit);
      } else if (l.compte.startsWith("44562")) {
        deductibleImmo += l.debit - l.credit;
      } else if (l.compte.startsWith("44566") || l.compte.startsWith("44586")) {
        deductibleBS += l.debit - l.credit;
      }
    }
  }
  const collectee = [...parTaux.entries()]
    .sort(([a], [b]) => b - a)
    .map(([tauxBp, taxe]) => ({ tauxBp, taxe, base: tauxBp > 0 ? Math.round((taxe * 10000) / tauxBp) : 0 }));
  const totalCollectee = collectee.reduce((a, l) => a + l.taxe, 0);
  const totalDeductible = deductibleBS + deductibleImmo + creditAnterieur;
  const net = totalCollectee - totalDeductible;
  return {
    periode,
    collectee,
    totalCollectee,
    deductibleBiensServices: deductibleBS,
    deductibleImmobilisations: deductibleImmo,
    creditAnterieur,
    totalDeductible,
    tvaNetteDue: net > 0 ? net : 0,
    creditTva: net < 0 ? -net : 0,
  };
}

/**
 * Écriture de liquidation de la TVA en fin de période : solde les comptes de
 * TVA collectée et déductible vers 44551 (TVA à décaisser) ou 44567 (crédit).
 */
export function ecritureLiquidationTva(d: DeclarationTva, date: string): Ecriture | null {
  const lignes: Ecriture["lignes"] = [];
  for (const c of d.collectee) {
    if (c.taxe !== 0) lignes.push({ compte: "44571", debit: c.taxe, credit: 0, tauxTva: c.tauxBp, libelle: "Liquidation TVA collectée" });
  }
  if (d.deductibleBiensServices) lignes.push({ compte: "44566", debit: 0, credit: d.deductibleBiensServices, libelle: "Liquidation TVA déductible" });
  if (d.deductibleImmobilisations) lignes.push({ compte: "44562", debit: 0, credit: d.deductibleImmobilisations, libelle: "Liquidation TVA sur immobilisations" });
  if (d.creditAnterieur) lignes.push({ compte: "44567", debit: 0, credit: d.creditAnterieur, libelle: "Imputation crédit antérieur" });
  if (d.tvaNetteDue) lignes.push({ compte: "44551", debit: 0, credit: d.tvaNetteDue, libelle: "TVA à décaisser" });
  if (d.creditTva) lignes.push({ compte: "44567", debit: d.creditTva, credit: 0, libelle: "Crédit de TVA à reporter" });
  if (lignes.length < 2) return null;
  return {
    journal: "OD",
    date,
    libelle: `Liquidation TVA ${d.periode.debut} → ${d.periode.fin}`,
    pieceRef: `TVA-${d.periode.fin.replace(/-/g, "")}`,
    pieceDate: date,
    lignes,
  };
}
