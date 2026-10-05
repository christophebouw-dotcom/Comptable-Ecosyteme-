/**
 * Révision des comptes : contrôles automatiques de cohérence et programme de
 * travail par cycle, conformément à la démarche de la norme professionnelle
 * NP 2300 (présentation des comptes) et aux diligences de la NPMQ.
 */
import type { Cents } from "./money.js";
import type { Ecriture } from "./ledger.js";
import { defaultLabel } from "./pcg.js";

export type NiveauAnomalie = "bloquant" | "avertissement" | "info";

export type Cycle =
  | "tresorerie"
  | "ventes_clients"
  | "achats_fournisseurs"
  | "immobilisations"
  | "stocks"
  | "social"
  | "fiscal"
  | "capitaux"
  | "general";

export const LIBELLES_CYCLES: Record<Cycle, string> = {
  tresorerie: "Trésorerie",
  ventes_clients: "Ventes et clients",
  achats_fournisseurs: "Achats et fournisseurs",
  immobilisations: "Immobilisations",
  stocks: "Stocks",
  social: "Social (personnel et organismes)",
  fiscal: "État et TVA",
  capitaux: "Capitaux propres et emprunts",
  general: "Contrôles généraux",
};

export interface Anomalie {
  code: string;
  niveau: NiveauAnomalie;
  cycle: Cycle;
  compte?: string;
  compteAux?: string | null;
  montant?: Cents;
  message: string;
  suggestion: string;
}

interface SoldeCompte {
  compte: string;
  compteAux: string | null;
  solde: Cents;
}

function soldesDetail(ecritures: Ecriture[]): SoldeCompte[] {
  const m = new Map<string, SoldeCompte>();
  for (const e of ecritures) {
    for (const l of e.lignes) {
      const key = `${l.compte}|${l.compteAux ?? ""}`;
      const cur = m.get(key) ?? { compte: l.compte, compteAux: l.compteAux ?? null, solde: 0 };
      cur.solde += l.debit - l.credit;
      m.set(key, cur);
    }
  }
  return [...m.values()].filter((s) => s.solde !== 0);
}

const fmt = (c: Cents) => (Math.abs(c) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

/**
 * Contrôles de révision sur les écritures de l'exercice (à-nouveaux compris).
 * @param options.dateArrete date d'arrêté (fin d'exercice), pour l'ancienneté des créances.
 * @param options.brouillards nombre d'écritures non validées.
 * @param options.immobilisationsSansPlan comptes 2x sans fiche d'immobilisation.
 */
export function controlesRevision(
  ecritures: Ecriture[],
  options: { dateArrete: string; brouillards?: number; immobilisationsSansPlan?: string[] } = { dateArrete: "9999-12-31" },
): Anomalie[] {
  const out: Anomalie[] = [];
  const add = (a: Anomalie) => out.push(a);
  const soldes = soldesDetail(ecritures);
  const parCompte = (prefix: string) => soldes.filter((s) => s.compte.startsWith(prefix));
  const total = (prefix: string) => parCompte(prefix).reduce((a, s) => a + s.solde, 0);

  // -- Généraux
  let d = 0;
  let c = 0;
  for (const e of ecritures) for (const l of e.lignes) (d += l.debit), (c += l.credit);
  if (d !== c) add({ code: "BALANCE", niveau: "bloquant", cycle: "general", montant: d - c, message: `Balance déséquilibrée (écart ${fmt(d - c)})`, suggestion: "Rechercher l'écriture déséquilibrée avant toute autre diligence." });
  if (options.brouillards) {
    add({ code: "BROUILLARD", niveau: "avertissement", cycle: "general", message: `${options.brouillards} écriture(s) en brouillard non prises en compte`, suggestion: "Faire valider ou supprimer les brouillards avant l'arrêté des comptes." });
  }
  for (const pfx of ["471", "472", "473", "474", "475"]) {
    const t = total(pfx);
    if (t) add({ code: "ATTENTE", niveau: "bloquant", cycle: "general", compte: pfx, montant: t, message: `Compte d'attente ${pfx} non soldé (${fmt(t)})`, suggestion: "Les comptes d'attente doivent être soldés à la clôture : identifier et reclasser les opérations (PCG art. 944-47)." });
  }
  const virements = total("58");
  if (virements) add({ code: "VIREMENTS_INTERNES", niveau: "avertissement", cycle: "tresorerie", compte: "580", montant: virements, message: `Virements internes non soldés (${fmt(virements)})`, suggestion: "Vérifier que chaque virement de compte à compte a ses deux jambes comptabilisées." });

  // -- Trésorerie
  for (const s of parCompte("53")) {
    if (s.solde < 0) add({ code: "CAISSE_CREDITRICE", niveau: "bloquant", cycle: "tresorerie", compte: s.compte, montant: s.solde, message: `Caisse créditrice (${fmt(s.solde)}) : situation matériellement impossible`, suggestion: "Rechercher les recettes non comptabilisées ou les dépenses saisies en double. Une caisse créditrice peut entraîner le rejet de la comptabilité (BOI-CF-IOR-10-20)." });
  }
  for (const s of parCompte("512")) {
    if (s.solde < 0) add({ code: "BANQUE_CREDITRICE", niveau: "info", cycle: "tresorerie", compte: s.compte, montant: s.solde, message: `Banque ${s.compte} créditrice (${fmt(s.solde)})`, suggestion: "Reclasser le découvert en 519 « Concours bancaires courants » au passif, après rapprochement bancaire." });
  }

  // -- Tiers
  for (const s of parCompte("401")) {
    if (s.solde > 0) add({ code: "FOURNISSEUR_DEBITEUR", niveau: "avertissement", cycle: "achats_fournisseurs", compte: s.compte, compteAux: s.compteAux, montant: s.solde, message: `Fournisseur ${s.compteAux ?? s.compte} débiteur (${fmt(s.solde)})`, suggestion: "Vérifier l'absence de facture non saisie ou de double paiement ; reclasser en 4091 (avances) ou 4096 (avoirs à recevoir)." });
  }
  for (const s of parCompte("411")) {
    if (s.solde < 0) add({ code: "CLIENT_CREDITEUR", niveau: "avertissement", cycle: "ventes_clients", compte: s.compte, compteAux: s.compteAux, montant: s.solde, message: `Client ${s.compteAux ?? s.compte} créditeur (${fmt(s.solde)})`, suggestion: "Vérifier les encaissements en double ou les avoirs ; reclasser en 4191 (avances reçues) ou 4196." });
  }

  // Créances clients non lettrées anciennes (> 90 jours à la date d'arrêté).
  const limite = new Date(Date.parse(`${options.dateArrete}T00:00:00Z`) - 90 * 86_400_000).toISOString().slice(0, 10);
  const anciennes = new Map<string, Cents>();
  for (const e of ecritures) {
    if (e.date > limite) continue;
    for (const l of e.lignes) {
      if (l.compte.startsWith("411") && l.debit > 0 && !l.lettrage) {
        const k = l.compteAux ?? l.compte;
        anciennes.set(k, (anciennes.get(k) ?? 0) + l.debit);
      }
    }
  }
  for (const [aux, montant] of anciennes) {
    const soldeAux = soldes.find((s) => s.compte.startsWith("411") && (s.compteAux ?? s.compte) === aux)?.solde ?? 0;
    if (soldeAux > 0) {
      add({ code: "CREANCE_ANCIENNE", niveau: "avertissement", cycle: "ventes_clients", compte: "411", compteAux: aux, montant: Math.min(montant, soldeAux), message: `Créance de plus de 90 jours non lettrée sur ${aux}`, suggestion: "Apprécier le risque de non-recouvrement : reclassement en 416 et dépréciation (6817 / 491) si nécessaire, sur la base HT." });
    }
  }

  // -- Charges créditrices / produits débiteurs
  for (const s of soldes) {
    const cls = s.compte[0];
    if (cls === "6" && s.solde < 0 && !/^(603|609|6097)/.test(s.compte)) {
      add({ code: "CHARGE_CREDITRICE", niveau: "avertissement", cycle: "general", compte: s.compte, montant: s.solde, message: `Compte de charge ${s.compte} (${defaultLabel(s.compte)}) créditeur`, suggestion: "Vérifier le sens des écritures ou l'imputation d'un avoir." });
    }
    if (cls === "7" && s.solde > 0 && !/^(713|709|7097)/.test(s.compte)) {
      add({ code: "PRODUIT_DEBITEUR", niveau: "avertissement", cycle: "general", compte: s.compte, montant: s.solde, message: `Compte de produit ${s.compte} (${defaultLabel(s.compte)}) débiteur`, suggestion: "Vérifier le sens des écritures ou l'imputation d'un avoir client." });
    }
  }

  // -- Fiscal : cohérence TVA collectée / chiffre d'affaires
  const ca = -total("70");
  const tvaCollectee = -total("4457");
  if (ca > 0) {
    const ratio = tvaCollectee / ca;
    if (ratio > 0.205) {
      add({ code: "TVA_INCOHERENTE", niveau: "avertissement", cycle: "fiscal", compte: "44571", montant: tvaCollectee, message: `TVA collectée supérieure à 20 % du CA (${(ratio * 100).toFixed(1)} %)`, suggestion: "Rapprocher le CA comptabilisé et les déclarations de TVA (CA3/CA12) : possible erreur de taux ou CA non comptabilisé." });
    }
  }
  const credit44567 = total("44567");
  if (credit44567 > 0 && tvaCollectee > 0) {
    add({ code: "CREDIT_TVA", niveau: "info", cycle: "fiscal", compte: "44567", montant: credit44567, message: `Crédit de TVA reporté (${fmt(credit44567)})`, suggestion: "Envisager une demande de remboursement (formulaire 3519) si le crédit est significatif." });
  }

  // -- Immobilisations
  for (const compte of options.immobilisationsSansPlan ?? []) {
    add({ code: "IMMO_SANS_PLAN", niveau: "avertissement", cycle: "immobilisations", compte, message: `Immobilisation au compte ${compte} sans fiche ni plan d'amortissement`, suggestion: "Créer la fiche d'immobilisation pour calculer et comptabiliser les dotations." });
  }

  // -- Capitaux
  const capital = -total("101");
  if (capital <= 0 && soldes.length > 0) {
    add({ code: "CAPITAL_ABSENT", niveau: "info", cycle: "capitaux", compte: "101", message: "Aucun capital social comptabilisé", suggestion: "Vérifier la reprise des à-nouveaux ou la constitution de la société (sauf entreprise individuelle : compte 108)." });
  }
  return out.sort((a, b) => ["bloquant", "avertissement", "info"].indexOf(a.niveau) - ["bloquant", "avertissement", "info"].indexOf(b.niveau));
}

export interface PointRevision {
  cycle: Cycle;
  code: string;
  libelle: string;
}

/** Programme de travail type (diligences minimales par cycle). */
export const PROGRAMME_REVISION: PointRevision[] = [
  { cycle: "general", code: "G1", libelle: "Lettre de mission signée et à jour ; vigilance LCB-FT revue" },
  { cycle: "general", code: "G2", libelle: "Concordance des à-nouveaux avec le bilan de l'exercice précédent" },
  { cycle: "general", code: "G3", libelle: "Comptes d'attente soldés, balance équilibrée, brouillards validés" },
  { cycle: "tresorerie", code: "T1", libelle: "Rapprochements bancaires à la clôture, relevés de tous les comptes obtenus" },
  { cycle: "tresorerie", code: "T2", libelle: "Procès-verbal de caisse, absence de solde créditeur" },
  { cycle: "ventes_clients", code: "V1", libelle: "Séparation des exercices : factures à établir (418) et produits constatés d'avance (487)" },
  { cycle: "ventes_clients", code: "V2", libelle: "Analyse des créances anciennes et dépréciations (416 / 491)" },
  { cycle: "ventes_clients", code: "V3", libelle: "Rapprochement CA comptable / CA déclaré en TVA" },
  { cycle: "achats_fournisseurs", code: "A1", libelle: "Factures non parvenues (408) et charges constatées d'avance (486)" },
  { cycle: "achats_fournisseurs", code: "A2", libelle: "Analyse des soldes fournisseurs débiteurs et des retards de paiement" },
  { cycle: "immobilisations", code: "I1", libelle: "Justification des acquisitions et cessions (factures, actes)" },
  { cycle: "immobilisations", code: "I2", libelle: "Calcul et comptabilisation des dotations aux amortissements" },
  { cycle: "immobilisations", code: "I3", libelle: "Distinction charges / immobilisations (seuil de 500 € HT)" },
  { cycle: "stocks", code: "S1", libelle: "Inventaire physique à la clôture et valorisation (coût d'acquisition)" },
  { cycle: "stocks", code: "S2", libelle: "Variation de stock (603 / 713) et dépréciations (39)" },
  { cycle: "social", code: "P1", libelle: "Rapprochement livre de paie / comptabilité (641, 645, 421, 431)" },
  { cycle: "social", code: "P2", libelle: "Provision pour congés payés et charges sociales associées" },
  { cycle: "fiscal", code: "F1", libelle: "Rapprochement des déclarations de TVA avec les comptes 445" },
  { cycle: "fiscal", code: "F2", libelle: "Calcul de l'IS, des acomptes versés et du solde (444)" },
  { cycle: "fiscal", code: "F3", libelle: "CFE, CVAE, taxes diverses : charges à payer" },
  { cycle: "capitaux", code: "C1", libelle: "Affectation du résultat N-1 conforme au procès-verbal d'AG" },
  { cycle: "capitaux", code: "C2", libelle: "Tableaux d'amortissement des emprunts et intérêts courus (1688)" },
  { cycle: "capitaux", code: "C3", libelle: "Comptes courants d'associés : conventions, intérêts, plafond de déductibilité" },
];
