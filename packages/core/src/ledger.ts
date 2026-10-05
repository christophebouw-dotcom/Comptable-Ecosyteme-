/**
 * Moteur de comptabilité en partie double.
 *
 * Références :
 *  - Code de commerce, art. L123-12 à L123-28 (obligations comptables) ;
 *  - Règlement ANC n° 2014-03, art. 911-1 et s. (organisation de la comptabilité) ;
 *  - art. 921-3 : chaque écriture s'appuie sur une pièce justificative datée ;
 *  - art. 921-4 : caractère définitif des enregistrements (procédure de validation).
 */
import { type Cents, assertCents } from "./money.js";
import {
  accountClass,
  defaultLabel,
  isBalanceSheetAccount,
  isContraAsset,
  isValidAccountNumber,
} from "./pcg.js";

export interface LigneEcriture {
  compte: string;
  /** Compte auxiliaire (tiers), ex. « CDUPONT » rattaché à 411. */
  compteAux?: string | null;
  libelle?: string;
  debit: Cents;
  credit: Cents;
  /** Taux de TVA en points de base, renseigné sur les lignes de TVA (2000 = 20 %). */
  tauxTva?: number | null;
  lettrage?: string | null;
}

export interface Ecriture {
  journal: string;
  /** Date comptable au format ISO AAAA-MM-JJ. */
  date: string;
  libelle: string;
  pieceRef: string;
  pieceDate?: string;
  lignes: LigneEcriture[];
}

export interface EcritureValidee extends Ecriture {
  id: number;
  numero: number;
  validatedAt: string;
}

export interface Exercice {
  debut: string;
  fin: string;
}

export interface LedgerIssue {
  code: string;
  message: string;
  ligne?: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Contrôle une écriture avant enregistrement. Retourne la liste des anomalies
 * (vide si l'écriture est valide).
 */
export function validateEcriture(e: Ecriture, exercice?: Exercice): LedgerIssue[] {
  const issues: LedgerIssue[] = [];
  if (!/^[A-Z0-9]{1,6}$/.test(e.journal)) {
    issues.push({ code: "JOURNAL", message: "Code journal invalide (1 à 6 caractères alphanumériques)" });
  }
  if (!isIsoDate(e.date)) {
    issues.push({ code: "DATE", message: "Date comptable invalide" });
  } else if (exercice && (e.date < exercice.debut || e.date > exercice.fin)) {
    issues.push({
      code: "HORS_EXERCICE",
      message: `La date ${e.date} est hors de l'exercice (${exercice.debut} → ${exercice.fin})`,
    });
  }
  if (e.pieceDate && !isIsoDate(e.pieceDate)) {
    issues.push({ code: "PIECE_DATE", message: "Date de pièce invalide" });
  }
  if (!e.libelle.trim()) issues.push({ code: "LIBELLE", message: "Le libellé est obligatoire" });
  if (!e.pieceRef.trim()) {
    issues.push({
      code: "PIECE",
      message: "La référence de pièce justificative est obligatoire (ANC 2014-03, art. 921-3)",
    });
  }
  if (e.lignes.length < 2) {
    issues.push({ code: "LIGNES", message: "Une écriture comporte au moins deux lignes" });
  }

  let totalDebit = 0;
  let totalCredit = 0;
  e.lignes.forEach((l, i) => {
    const n = i + 1;
    if (!isValidAccountNumber(l.compte)) {
      issues.push({ code: "COMPTE", message: `Numéro de compte invalide : « ${l.compte} »`, ligne: n });
    }
    try {
      assertCents(l.debit, "débit");
      assertCents(l.credit, "crédit");
    } catch (err) {
      issues.push({ code: "MONTANT", message: (err as Error).message, ligne: n });
      return;
    }
    if (l.debit < 0 || l.credit < 0) {
      issues.push({ code: "NEGATIF", message: "Les montants doivent être positifs", ligne: n });
    }
    if (l.debit !== 0 && l.credit !== 0) {
      issues.push({ code: "DOUBLE_SENS", message: "Une ligne est soit au débit, soit au crédit", ligne: n });
    }
    if (l.debit === 0 && l.credit === 0) {
      issues.push({ code: "LIGNE_VIDE", message: "Ligne sans montant", ligne: n });
    }
    totalDebit += l.debit;
    totalCredit += l.credit;
  });

  if (totalDebit !== totalCredit) {
    issues.push({
      code: "DESEQUILIBRE",
      message: `Écriture déséquilibrée : débit ${totalDebit / 100} ≠ crédit ${totalCredit / 100}`,
    });
  }
  return issues;
}

export function totals(lignes: LigneEcriture[]): { debit: Cents; credit: Cents } {
  return lignes.reduce(
    (acc, l) => ({ debit: acc.debit + l.debit, credit: acc.credit + l.credit }),
    { debit: 0, credit: 0 },
  );
}

/**
 * Contre-passation : génère l'écriture inverse d'une écriture validée. C'est la
 * seule façon de corriger une écriture définitive (principe d'intangibilité).
 */
export function contrePassation(e: Ecriture, date: string, motif: string): Ecriture {
  return {
    journal: e.journal,
    date,
    libelle: `Extourne : ${e.libelle} — ${motif}`.slice(0, 200),
    pieceRef: e.pieceRef,
    pieceDate: e.pieceDate,
    lignes: e.lignes.map((l) => ({ ...l, debit: l.credit, credit: l.debit, lettrage: null })),
  };
}

// ---------------------------------------------------------------------------
// Balance & grand livre
// ---------------------------------------------------------------------------

export interface LigneBalance {
  compte: string;
  libelle: string;
  debit: Cents;
  credit: Cents;
  soldeDebiteur: Cents;
  soldeCrediteur: Cents;
}

export interface Balance {
  lignes: LigneBalance[];
  totalDebit: Cents;
  totalCredit: Cents;
  totalSoldeDebiteur: Cents;
  totalSoldeCrediteur: Cents;
  equilibree: boolean;
}

export type LibelleResolver = (compte: string) => string;

/** Balance générale des comptes (ou à un niveau de regroupement donné). */
export function computeBalance(
  ecritures: Ecriture[],
  options: { niveau?: number; libelle?: LibelleResolver } = {},
): Balance {
  const resolve = options.libelle ?? defaultLabel;
  const map = new Map<string, { debit: Cents; credit: Cents }>();
  for (const e of ecritures) {
    for (const l of e.lignes) {
      const key = options.niveau ? l.compte.slice(0, options.niveau) : l.compte;
      const cur = map.get(key) ?? { debit: 0, credit: 0 };
      cur.debit += l.debit;
      cur.credit += l.credit;
      map.set(key, cur);
    }
  }
  const lignes = [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([compte, { debit, credit }]) => {
      const solde = debit - credit;
      return {
        compte,
        libelle: resolve(compte),
        debit,
        credit,
        soldeDebiteur: solde > 0 ? solde : 0,
        soldeCrediteur: solde < 0 ? -solde : 0,
      };
    });
  const sumOf = (k: keyof Omit<LigneBalance, "compte" | "libelle">) =>
    lignes.reduce((a, l) => a + l[k], 0);
  const totalDebit = sumOf("debit");
  const totalCredit = sumOf("credit");
  return {
    lignes,
    totalDebit,
    totalCredit,
    totalSoldeDebiteur: sumOf("soldeDebiteur"),
    totalSoldeCrediteur: sumOf("soldeCrediteur"),
    equilibree: totalDebit === totalCredit,
  };
}

export interface MouvementGrandLivre {
  date: string;
  journal: string;
  pieceRef: string;
  libelle: string;
  debit: Cents;
  credit: Cents;
  solde: Cents;
  lettrage: string | null;
}

export interface CompteGrandLivre {
  compte: string;
  libelle: string;
  mouvements: MouvementGrandLivre[];
  totalDebit: Cents;
  totalCredit: Cents;
  solde: Cents;
}

/** Grand livre : détail chronologique des mouvements par compte, avec solde progressif. */
export function computeGrandLivre(
  ecritures: Ecriture[],
  options: { compte?: string; libelle?: LibelleResolver } = {},
): CompteGrandLivre[] {
  const resolve = options.libelle ?? defaultLabel;
  const sorted = [...ecritures].sort((a, b) => a.date.localeCompare(b.date));
  const map = new Map<string, CompteGrandLivre>();
  for (const e of sorted) {
    for (const l of e.lignes) {
      if (options.compte && !l.compte.startsWith(options.compte)) continue;
      let c = map.get(l.compte);
      if (!c) {
        c = { compte: l.compte, libelle: resolve(l.compte), mouvements: [], totalDebit: 0, totalCredit: 0, solde: 0 };
        map.set(l.compte, c);
      }
      c.totalDebit += l.debit;
      c.totalCredit += l.credit;
      c.solde += l.debit - l.credit;
      c.mouvements.push({
        date: e.date,
        journal: e.journal,
        pieceRef: e.pieceRef,
        libelle: l.libelle || e.libelle,
        debit: l.debit,
        credit: l.credit,
        solde: c.solde,
        lettrage: l.lettrage ?? null,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.compte.localeCompare(b.compte));
}

// ---------------------------------------------------------------------------
// États financiers simplifiés
// ---------------------------------------------------------------------------

export interface PosteEtat {
  code: string;
  libelle: string;
  montant: Cents;
}

export interface CompteResultat {
  produitsExploitation: Cents;
  chargesExploitation: Cents;
  resultatExploitation: Cents;
  produitsFinanciers: Cents;
  chargesFinancieres: Cents;
  resultatFinancier: Cents;
  produitsExceptionnels: Cents;
  chargesExceptionnelles: Cents;
  resultatExceptionnel: Cents;
  participationEtImpots: Cents;
  resultatNet: Cents;
  detail: PosteEtat[];
}

function soldesParCompte(ecritures: Ecriture[]): Map<string, Cents> {
  const m = new Map<string, Cents>();
  for (const e of ecritures) {
    for (const l of e.lignes) m.set(l.compte, (m.get(l.compte) ?? 0) + l.debit - l.credit);
  }
  return m;
}

/** Compte de résultat (présentation simplifiée par nature, PCG art. 821-1 et s.). */
export function computeCompteResultat(ecritures: Ecriture[]): CompteResultat {
  const soldes = soldesParCompte(ecritures);
  const r = {
    produitsExploitation: 0,
    chargesExploitation: 0,
    produitsFinanciers: 0,
    chargesFinancieres: 0,
    produitsExceptionnels: 0,
    chargesExceptionnelles: 0,
    participationEtImpots: 0,
  };
  const detail = new Map<string, Cents>();
  for (const [compte, solde] of soldes) {
    const cls = accountClass(compte);
    if (cls !== 6 && cls !== 7) continue;
    const sub = compte[1];
    const montant = cls === 6 ? solde : -solde;
    const key = compte.slice(0, 2);
    detail.set(key, (detail.get(key) ?? 0) + montant);
    if (cls === 6) {
      if (sub === "6") r.chargesFinancieres += montant;
      else if (sub === "7") r.chargesExceptionnelles += montant;
      else if (sub === "9") r.participationEtImpots += montant;
      else if (compte.startsWith("686")) r.chargesFinancieres += montant;
      else if (compte.startsWith("687")) r.chargesExceptionnelles += montant;
      else r.chargesExploitation += montant;
    } else {
      if (sub === "6" || compte.startsWith("786")) r.produitsFinanciers += montant;
      else if (sub === "7" || compte.startsWith("787")) r.produitsExceptionnels += montant;
      else r.produitsExploitation += montant;
    }
  }
  // 68x/78x : seules les dotations/reprises d'exploitation restent en exploitation.
  const resultatExploitation = r.produitsExploitation - r.chargesExploitation;
  const resultatFinancier = r.produitsFinanciers - r.chargesFinancieres;
  const resultatExceptionnel = r.produitsExceptionnels - r.chargesExceptionnelles;
  return {
    ...r,
    resultatExploitation,
    resultatFinancier,
    resultatExceptionnel,
    resultatNet: resultatExploitation + resultatFinancier + resultatExceptionnel - r.participationEtImpots,
    detail: [...detail.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, montant]) => ({ code, libelle: defaultLabel(code), montant })),
  };
}

export interface Bilan {
  actif: {
    immobilisationsBrutes: Cents;
    amortissementsEtDepreciations: Cents;
    actifImmobiliseNet: Cents;
    stocks: Cents;
    creances: Cents;
    disponibilites: Cents;
    chargesConstateesAvance: Cents;
    total: Cents;
  };
  passif: {
    capitauxPropres: Cents;
    resultat: Cents;
    provisions: Cents;
    emprunts: Cents;
    dettes: Cents;
    produitsConstatesAvance: Cents;
    total: Cents;
  };
  equilibre: boolean;
}

/**
 * Bilan simplifié. Les comptes de tiers et de trésorerie sont classés à l'actif
 * ou au passif selon le sens de leur solde (principe de non-compensation).
 */
export function computeBilan(ecritures: Ecriture[]): Bilan {
  const soldes = soldesParCompte(ecritures);
  const a = {
    immobilisationsBrutes: 0,
    amortissementsEtDepreciations: 0,
    stocks: 0,
    creances: 0,
    disponibilites: 0,
    chargesConstateesAvance: 0,
  };
  const p = { capitauxPropres: 0, provisions: 0, emprunts: 0, dettes: 0, produitsConstatesAvance: 0 };

  for (const [compte, solde] of soldes) {
    if (!isBalanceSheetAccount(compte)) continue;
    const cls = accountClass(compte);
    if (isContraAsset(compte)) {
      // Dépréciations portées en diminution du poste d'actif concerné.
      if (cls === 2) a.amortissementsEtDepreciations += -solde;
      else if (cls === 3) a.stocks += solde;
      else if (cls === 4) a.creances += solde;
      else a.disponibilites += solde;
      continue;
    }
    switch (cls) {
      case 1:
        if (compte.startsWith("15")) p.provisions += -solde;
        else if (compte.startsWith("16") || compte.startsWith("17")) p.emprunts += -solde;
        else p.capitauxPropres += -solde;
        break;
      case 2:
        a.immobilisationsBrutes += solde;
        break;
      case 3:
        a.stocks += solde;
        break;
      case 4:
        if (compte.startsWith("486")) a.chargesConstateesAvance += solde;
        else if (compte.startsWith("487")) p.produitsConstatesAvance += -solde;
        else if (solde > 0) a.creances += solde;
        else p.dettes += -solde;
        break;
      case 5:
        if (compte.startsWith("519")) p.emprunts += -solde;
        else if (solde > 0) a.disponibilites += solde;
        else p.emprunts += -solde;
        break;
    }
  }
  const actifImmobiliseNet = a.immobilisationsBrutes - a.amortissementsEtDepreciations;
  const resultat = computeCompteResultat(ecritures).resultatNet;
  const totalActif = actifImmobiliseNet + a.stocks + a.creances + a.disponibilites + a.chargesConstateesAvance;
  const totalPassif = p.capitauxPropres + resultat + p.provisions + p.emprunts + p.dettes + p.produitsConstatesAvance;
  return {
    actif: { ...a, actifImmobiliseNet, total: totalActif },
    passif: { ...p, resultat, total: totalPassif },
    equilibre: totalActif === totalPassif,
  };
}

/**
 * Écriture d'à-nouveaux pour l'ouverture de l'exercice suivant : reprise des
 * soldes des comptes de bilan (classes 1 à 5) et affectation du résultat en
 * attente (120 bénéfice / 129 perte), avant décision d'affectation en AG.
 */
export function computeANouveaux(ecritures: Ecriture[], dateOuverture: string): Ecriture | null {
  const parCompte = new Map<string, Cents>();
  for (const e of ecritures) {
    for (const l of e.lignes) {
      const key = `${l.compte}\u0000${l.compteAux ?? ""}`;
      parCompte.set(key, (parCompte.get(key) ?? 0) + l.debit - l.credit);
    }
  }
  const lignes: LigneEcriture[] = [];
  for (const [key, solde] of [...parCompte.entries()].sort(([x], [y]) => x.localeCompare(y))) {
    const [compte, aux] = key.split("\u0000") as [string, string];
    if (!isBalanceSheetAccount(compte) || solde === 0) continue;
    lignes.push({
      compte,
      compteAux: aux || null,
      libelle: "Report à nouveau",
      debit: solde > 0 ? solde : 0,
      credit: solde < 0 ? -solde : 0,
    });
  }
  const resultat = computeCompteResultat(ecritures).resultatNet;
  if (resultat > 0) lignes.push({ compte: "120", libelle: "Résultat en instance d'affectation", debit: 0, credit: resultat });
  if (resultat < 0) lignes.push({ compte: "129", libelle: "Résultat en instance d'affectation", debit: -resultat, credit: 0 });
  if (lignes.length === 0) return null;
  return {
    journal: "AN",
    date: dateOuverture,
    libelle: "À-nouveaux d'ouverture",
    pieceRef: `AN-${dateOuverture.slice(0, 4)}`,
    pieceDate: dateOuverture,
    lignes,
  };
}

/**
 * Lettrage : vérifie qu'un ensemble de lignes d'un même compte est soldé
 * (débits = crédits) et peut donc recevoir un code de lettrage commun.
 */
export function canLettrer(lignes: Pick<LigneEcriture, "compte" | "debit" | "credit">[]): LedgerIssue[] {
  if (lignes.length < 2) return [{ code: "LETTRAGE", message: "Sélectionnez au moins deux lignes" }];
  const comptes = new Set(lignes.map((l) => l.compte));
  if (comptes.size > 1) return [{ code: "LETTRAGE", message: "Les lignes doivent concerner le même compte" }];
  const t = totals(lignes as LigneEcriture[]);
  if (t.debit !== t.credit) {
    return [{ code: "LETTRAGE", message: "Les lignes sélectionnées ne sont pas soldées" }];
  }
  return [];
}

/** Code de lettrage suivant : A, B, …, Z, AA, AB, … */
export function nextLettrage(previous: string | null): string {
  if (!previous) return "A";
  const chars = [...previous];
  let i = chars.length - 1;
  while (i >= 0) {
    if (chars[i] !== "Z") {
      chars[i] = String.fromCharCode(chars[i]!.charCodeAt(0) + 1);
      return chars.join("");
    }
    chars[i] = "A";
    i--;
  }
  return "A" + chars.join("");
}
