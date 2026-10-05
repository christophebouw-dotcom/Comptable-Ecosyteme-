/**
 * Immobilisations et plans d'amortissement.
 *
 * Références :
 *  - PCG art. 214-13 et s. (amortissement selon le rythme de consommation des avantages) ;
 *  - CGI art. 39-1-2° (amortissement linéaire, prorata temporis) ;
 *  - CGI art. 39 A (amortissement dégressif : coefficients 1,25 / 1,75 / 2,25,
 *    point de départ au premier jour du mois d'acquisition, bascule en linéaire
 *    lorsque l'annuité linéaire sur la durée restante devient supérieure).
 *
 * Convention de calcul du linéaire : année commerciale de 360 jours (mois de 30 jours).
 */
import type { Cents } from "./money.js";
import type { Ecriture, LigneEcriture } from "./ledger.js";

export type ModeAmortissement = "lineaire" | "degressif" | "non_amortissable";

export interface Immobilisation {
  id?: number;
  compte: string;
  libelle: string;
  /** Date d'acquisition ou de mise en service (ISO). */
  dateMiseEnService: string;
  valeurHT: Cents;
  dureeAnnees: number;
  mode: ModeAmortissement;
  /** Date de sortie (cession, mise au rebut) ; l'amortissement s'arrête à cette date. */
  dateSortie?: string | null;
}

export interface AnnuitePlan {
  debut: string;
  fin: string;
  base: Cents;
  dotation: Cents;
  cumul: Cents;
  vnc: Cents;
}

/** Comptes non amortissables par nature (terrains, fonds commercial, titres, dépôts). */
export function estAmortissable(compte: string): boolean {
  return !/^(211|207|26|27)/.test(compte);
}

/** Compte d'amortissement correspondant : 2183 → 28183, 205 → 2805. */
export function compteAmortissement(compte: string): string {
  return `28${compte.slice(1)}`;
}

/** Coefficient dégressif fiscal selon la durée (CGI art. 39 A). */
export function coefficientDegressif(dureeAnnees: number): number {
  if (dureeAnnees < 3) return 0;
  if (dureeAnnees <= 4) return 1.25;
  if (dureeAnnees <= 6) return 1.75;
  return 2.25;
}

const parts = (iso: string) => iso.slice(0, 10).split("-").map(Number) as [number, number, number];

/**
 * Nombre de jours entre deux dates incluses, convention 30/360 : chaque mois
 * compte 30 jours, le dernier jour d'un mois est ramené au 30.
 */
export function jours360(debut: string, fin: string): number {
  const [y1, m1, d1] = parts(debut);
  const [y2, m2, d2] = parts(fin);
  const dernierJour = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const a = Math.min(d1, 30);
  const b = d2 === dernierJour(y2, m2) ? 30 : Math.min(d2, 30);
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (b - a) + 1;
}

/** Nombre de mois entiers ou commencés entre deux dates incluses. */
function moisCommences(debut: string, fin: string): number {
  const [y1, m1] = parts(debut);
  const [y2, m2] = parts(fin);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

/**
 * Dotation de l'immobilisation pour une période (exercice) donnée, compte
 * tenu des amortissements déjà pratiqués.
 */
export function dotationPeriode(immo: Immobilisation, periode: { debut: string; fin: string }, cumulAnterieur: Cents): Cents {
  if (immo.mode === "non_amortissable" || !estAmortissable(immo.compte)) return 0;
  const restant = immo.valeurHT - cumulAnterieur;
  if (restant <= 0) return 0;
  const finEffective = immo.dateSortie && immo.dateSortie < periode.fin ? immo.dateSortie : periode.fin;

  if (immo.mode === "lineaire") {
    const debut = immo.dateMiseEnService > periode.debut ? immo.dateMiseEnService : periode.debut;
    if (debut > finEffective) return 0;
    const annuite = immo.valeurHT / immo.dureeAnnees;
    const dot = Math.round((annuite * jours360(debut, finEffective)) / 360);
    return Math.min(dot, restant);
  }

  // Dégressif : point de départ au 1er jour du mois d'acquisition.
  const [y, m] = parts(immo.dateMiseEnService);
  const depart = `${y}-${String(m).padStart(2, "0")}-01`;
  const debut = depart > periode.debut ? depart : periode.debut;
  if (debut > finEffective) return 0;
  const mois = moisCommences(debut, finEffective);
  const moisEcoules = debut > depart ? moisCommences(depart, debut) - 1 : 0;
  const moisRestants = immo.dureeAnnees * 12 - moisEcoules;
  if (moisRestants <= mois) return restant;
  const taux = (coefficientDegressif(immo.dureeAnnees) / immo.dureeAnnees) * (mois / 12);
  const degressif = Math.round(restant * taux);
  const lineaireRestant = Math.round((restant * mois) / moisRestants);
  return Math.min(Math.max(degressif, lineaireRestant), restant);
}

/**
 * Plan d'amortissement complet sur des exercices successifs commençant à
 * l'exercice de mise en service (exercices de 12 mois à partir de la date de
 * début fournie).
 */
export function planAmortissement(immo: Immobilisation, premierExercice: { debut: string; fin: string }, maxExercices = 60): AnnuitePlan[] {
  const plan: AnnuitePlan[] = [];
  let cumul = 0;
  let periode = { ...premierExercice };
  while (periode.fin < immo.dateMiseEnService) periode = exerciceSuivant(periode);
  for (let i = 0; i < maxExercices && cumul < immo.valeurHT; i++) {
    const dotation = dotationPeriode(immo, periode, cumul);
    if (dotation === 0 && cumul > 0) break;
    cumul += dotation;
    plan.push({ debut: periode.debut, fin: periode.fin, base: immo.valeurHT, dotation, cumul, vnc: immo.valeurHT - cumul });
    if (immo.dateSortie && immo.dateSortie <= periode.fin) break;
    if (immo.mode === "non_amortissable") break;
    periode = exerciceSuivant(periode);
  }
  return plan;
}

function exerciceSuivant(p: { debut: string; fin: string }): { debut: string; fin: string } {
  const plusUnAn = (iso: string) => {
    const [y, m, d] = parts(iso);
    const dt = new Date(Date.UTC(y + 1, m - 1, d));
    // 29 février → 28 février
    if (dt.getUTCMonth() !== m - 1) dt.setUTCDate(0);
    return dt.toISOString().slice(0, 10);
  };
  return { debut: plusUnAn(p.debut), fin: plusUnAn(p.fin) };
}

/** Écriture de dotation (journal OD) pour un ensemble d'immobilisations. */
export function ecritureDotations(
  dotations: { immo: Immobilisation; dotation: Cents }[],
  dateCloture: string,
): Ecriture | null {
  const lignes: LigneEcriture[] = [];
  const total = dotations.reduce((a, d) => a + d.dotation, 0);
  if (total <= 0) return null;
  const parCompte = new Map<string, Cents>();
  for (const d of dotations) {
    if (d.dotation <= 0) continue;
    const c = compteAmortissement(d.immo.compte);
    parCompte.set(c, (parCompte.get(c) ?? 0) + d.dotation);
  }
  const incorporel = dotations.filter((d) => d.immo.compte.startsWith("20")).reduce((a, d) => a + d.dotation, 0);
  if (incorporel) lignes.push({ compte: "68111", libelle: "Dotations aux amortissements des immobilisations incorporelles", debit: incorporel, credit: 0 });
  if (total - incorporel) lignes.push({ compte: "68112", libelle: "Dotations aux amortissements des immobilisations corporelles", debit: total - incorporel, credit: 0 });
  for (const [compte, montant] of [...parCompte.entries()].sort()) {
    lignes.push({ compte, libelle: "Amortissements de l'exercice", debit: 0, credit: montant });
  }
  return {
    journal: "OD",
    date: dateCloture,
    libelle: `Dotations aux amortissements ${dateCloture.slice(0, 4)}`,
    pieceRef: `DOT-${dateCloture.replace(/-/g, "")}`,
    pieceDate: dateCloture,
    lignes,
  };
}
