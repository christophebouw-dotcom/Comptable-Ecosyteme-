/**
 * Analyse financière : soldes intermédiaires de gestion (PCG, système
 * développé, art. 832-14), capacité d'autofinancement, ratios usuels et
 * calcul de l'impôt sur les sociétés.
 */
import type { Cents } from "./money.js";
import type { Ecriture } from "./ledger.js";

type Soldes = Map<string, Cents>;

function soldes(ecritures: Ecriture[]): Soldes {
  const m: Soldes = new Map();
  for (const e of ecritures) {
    if (e.journal === "AN") continue;
    for (const l of e.lignes) m.set(l.compte, (m.get(l.compte) ?? 0) + l.debit - l.credit);
  }
  return m;
}

/** Somme des soldes (débit - crédit) des comptes commençant par l'un des préfixes, hors exclusions. */
function somme(s: Soldes, prefixes: string[], exclus: string[] = []): Cents {
  let t = 0;
  for (const [c, v] of s) {
    if (prefixes.some((p) => c.startsWith(p)) && !exclus.some((x) => c.startsWith(x))) t += v;
  }
  return t;
}

/** Produits (solde créditeur positif) */
const produits = (s: Soldes, p: string[], ex: string[] = []) => -somme(s, p, ex);
/** Charges (solde débiteur positif) */
const charges = (s: Soldes, p: string[], ex: string[] = []) => somme(s, p, ex);

export interface Sig {
  ventesMarchandises: Cents;
  coutAchatMarchandisesVendues: Cents;
  margeCommerciale: Cents;
  productionVendue: Cents;
  productionStockeeImmobilisee: Cents;
  productionExercice: Cents;
  consommationsTiers: Cents;
  valeurAjoutee: Cents;
  subventionsExploitation: Cents;
  impotsTaxes: Cents;
  chargesPersonnel: Cents;
  excedentBrutExploitation: Cents;
  reprisesTransferts: Cents;
  autresProduits: Cents;
  dotationsExploitation: Cents;
  autresCharges: Cents;
  resultatExploitation: Cents;
  produitsFinanciers: Cents;
  chargesFinancieres: Cents;
  resultatCourantAvantImpots: Cents;
  produitsExceptionnels: Cents;
  chargesExceptionnelles: Cents;
  resultatExceptionnel: Cents;
  participation: Cents;
  impotsBenefices: Cents;
  resultatNet: Cents;
  chiffreAffaires: Cents;
}

export function computeSig(ecritures: Ecriture[]): Sig {
  const s = soldes(ecritures);
  const ventesMarchandises = produits(s, ["707", "7097"]);
  const coutAchatMarchandisesVendues = charges(s, ["607", "6037", "6087", "6097"]);
  const margeCommerciale = ventesMarchandises - coutAchatMarchandisesVendues;
  const productionVendue = produits(s, ["70"], ["707", "7097"]);
  const productionStockeeImmobilisee = produits(s, ["71", "72"]);
  const productionExercice = productionVendue + productionStockeeImmobilisee;
  const consommationsTiers = charges(s, ["60", "61", "62"], ["607", "6037", "6087", "6097"]);
  const valeurAjoutee = margeCommerciale + productionExercice - consommationsTiers;
  const subventionsExploitation = produits(s, ["74"]);
  const impotsTaxes = charges(s, ["63"]);
  const chargesPersonnel = charges(s, ["64"]);
  const excedentBrutExploitation = valeurAjoutee + subventionsExploitation - impotsTaxes - chargesPersonnel;
  const reprisesTransferts = produits(s, ["781", "791"]);
  const autresProduits = produits(s, ["75"]);
  const dotationsExploitation = charges(s, ["681"]);
  const autresCharges = charges(s, ["65"]);
  const resultatExploitation = excedentBrutExploitation + reprisesTransferts + autresProduits - dotationsExploitation - autresCharges;
  const produitsFinanciers = produits(s, ["76", "786", "796"]);
  const chargesFinancieres = charges(s, ["66", "686"]);
  const resultatCourantAvantImpots = resultatExploitation + produitsFinanciers - chargesFinancieres;
  const produitsExceptionnels = produits(s, ["77", "787", "797"]);
  const chargesExceptionnelles = charges(s, ["67", "687"]);
  const resultatExceptionnel = produitsExceptionnels - chargesExceptionnelles;
  const participation = charges(s, ["691"]);
  const impotsBenefices = charges(s, ["69"], ["691"]);
  return {
    ventesMarchandises, coutAchatMarchandisesVendues, margeCommerciale, productionVendue, productionStockeeImmobilisee,
    productionExercice, consommationsTiers, valeurAjoutee, subventionsExploitation, impotsTaxes, chargesPersonnel,
    excedentBrutExploitation, reprisesTransferts, autresProduits, dotationsExploitation, autresCharges, resultatExploitation,
    produitsFinanciers, chargesFinancieres, resultatCourantAvantImpots, produitsExceptionnels, chargesExceptionnelles,
    resultatExceptionnel, participation, impotsBenefices,
    resultatNet: resultatCourantAvantImpots + resultatExceptionnel - participation - impotsBenefices,
    chiffreAffaires: produits(s, ["70"]),
  };
}

/** Capacité d'autofinancement (méthode additive, à partir du résultat net). */
export function computeCaf(ecritures: Ecriture[]): { resultatNet: Cents; dotations: Cents; reprises: Cents; vncCedees: Cents; produitsCessions: Cents; quotePartSubventions: Cents; caf: Cents } {
  const s = soldes(ecritures);
  const sig = computeSig(ecritures);
  const dotations = charges(s, ["681", "686", "687"]);
  const reprises = produits(s, ["781", "786", "787"]);
  const vncCedees = charges(s, ["675"]);
  const produitsCessions = produits(s, ["775"]);
  const quotePartSubventions = produits(s, ["777"]);
  return {
    resultatNet: sig.resultatNet, dotations, reprises, vncCedees, produitsCessions, quotePartSubventions,
    caf: sig.resultatNet + dotations - reprises + vncCedees - produitsCessions - quotePartSubventions,
  };
}

export interface Ratio {
  code: string;
  libelle: string;
  valeur: number | null;
  unite: "%" | "jours" | "€" | "x";
  commentaire: string;
}

/** Ratios de gestion usuels. Les soldes de bilan incluent les à-nouveaux. */
export function computeRatios(ecritures: Ecriture[], dureeExerciceJours = 360): Ratio[] {
  const sig = computeSig(ecritures);
  const bilan = new Map<string, Cents>();
  for (const e of ecritures) for (const l of e.lignes) bilan.set(l.compte, (bilan.get(l.compte) ?? 0) + l.debit - l.credit);
  const ca = sig.chiffreAffaires;
  const pct = (n: Cents, d: Cents) => (d ? Math.round((n / d) * 1000) / 10 : null);
  const clients = somme(bilan, ["411", "413", "416"]);
  const fournisseurs = -somme(bilan, ["401", "403", "404", "408"]);
  const achats = charges(soldes(ecritures), ["60", "61", "62"]);
  const stocks = somme(bilan, ["3"], ["39"]);
  const tresorerie = somme(bilan, ["5"], ["59"]); // 519 (concours bancaires) vient en déduction
  const capitauxPropres = -somme(bilan, ["10", "11", "12", "13", "14"]) + sig.resultatNet;
  const dettesFinancieres = -somme(bilan, ["16", "17"]);
  const jours = (n: Cents, d: Cents) => (d > 0 ? Math.round((n / d) * dureeExerciceJours) : null);
  return [
    { code: "CA", libelle: "Chiffre d'affaires", valeur: ca / 100, unite: "€", commentaire: "Comptes 70" },
    { code: "TX_MARGE_COM", libelle: "Taux de marge commerciale", valeur: pct(sig.margeCommerciale, sig.ventesMarchandises), unite: "%", commentaire: "Marge commerciale / ventes de marchandises" },
    { code: "TX_VA", libelle: "Taux de valeur ajoutée", valeur: pct(sig.valeurAjoutee, ca), unite: "%", commentaire: "Valeur ajoutée / CA" },
    { code: "TX_EBE", libelle: "Taux de marge d'EBE", valeur: pct(sig.excedentBrutExploitation, ca), unite: "%", commentaire: "EBE / CA" },
    { code: "TX_RN", libelle: "Rentabilité nette", valeur: pct(sig.resultatNet, ca), unite: "%", commentaire: "Résultat net / CA" },
    { code: "POIDS_PERSONNEL", libelle: "Poids des charges de personnel", valeur: pct(sig.chargesPersonnel, sig.valeurAjoutee), unite: "%", commentaire: "Charges de personnel / valeur ajoutée" },
    { code: "DSO", libelle: "Délai de paiement clients", valeur: jours(clients, Math.round(ca * 1.2)), unite: "jours", commentaire: "Encours clients / CA TTC estimé (TVA 20 %) × 360" },
    { code: "DPO", libelle: "Délai de paiement fournisseurs", valeur: jours(fournisseurs, Math.round(achats * 1.2)), unite: "jours", commentaire: "Dettes fournisseurs / achats TTC estimés × 360 (plafond légal : 60 jours)" },
    { code: "ROTATION_STOCKS", libelle: "Rotation des stocks", valeur: jours(stocks, sig.coutAchatMarchandisesVendues || charges(soldes(ecritures), ["60"])), unite: "jours", commentaire: "Stocks / coût des achats consommés × 360" },
    { code: "TRESORERIE", libelle: "Trésorerie nette", valeur: tresorerie / 100, unite: "€", commentaire: "Disponibilités - concours bancaires" },
    { code: "ENDETTEMENT", libelle: "Taux d'endettement", valeur: capitauxPropres > 0 ? Math.round((dettesFinancieres / capitauxPropres) * 100) / 100 : null, unite: "x", commentaire: "Dettes financières / capitaux propres (vigilance au-delà de 1)" },
  ];
}

// ---------------------------------------------------------------------------
// Impôt sur les sociétés (CGI art. 219)
// ---------------------------------------------------------------------------

/** Seuil du taux réduit de 15 % (CGI art. 219-I-b), en centimes. */
export const SEUIL_TAUX_REDUIT_IS = 4_250_000;

export interface CalculIs {
  resultatComptable: Cents;
  reintegrations: Cents;
  deductions: Cents;
  deficitsReportes: Cents;
  resultatFiscal: Cents;
  baseTauxReduit: Cents;
  baseTauxNormal: Cents;
  impotTauxReduit: Cents;
  impotTauxNormal: Cents;
  impotTotal: Cents;
  acomptesVerses: Cents;
  solde: Cents;
  detail: string[];
}

/**
 * Calcule l'IS dû : 15 % jusqu'à 42 500 € de bénéfice pour les PME éligibles
 * (CA HT < 10 M€, capital entièrement libéré et détenu à 75 % au moins par des
 * personnes physiques), 25 % au-delà. Le résultat comptable s'entend AVANT IS.
 * L'imputation des déficits est plafonnée à 1 M€ + 50 % de l'excédent (CGI art. 209-I).
 */
export function calculerIs(p: {
  resultatComptableAvantIs: Cents;
  reintegrations?: Cents;
  deductions?: Cents;
  deficitsAnterieurs?: Cents;
  eligibleTauxReduit: boolean;
  acomptesVerses?: Cents;
  /** Durée de l'exercice en mois, pour proratiser le seuil du taux réduit. */
  dureeMois?: number;
}): CalculIs {
  const detail: string[] = [];
  const reintegrations = p.reintegrations ?? 0;
  const deductions = p.deductions ?? 0;
  const avantDeficits = p.resultatComptableAvantIs + reintegrations - deductions;
  let deficitsReportes = 0;
  if (avantDeficits > 0 && p.deficitsAnterieurs) {
    const plafond = avantDeficits <= 100_000_000 ? avantDeficits : 100_000_000 + Math.floor((avantDeficits - 100_000_000) / 2);
    deficitsReportes = Math.min(p.deficitsAnterieurs, plafond);
    detail.push(`Imputation de déficits antérieurs : ${deficitsReportes / 100} € (CGI art. 209-I)`);
  }
  const resultatFiscal = avantDeficits - deficitsReportes;
  if (resultatFiscal <= 0) {
    detail.push("Résultat fiscal nul ou déficitaire : aucun IS dû ; déficit reportable en avant.");
  }
  const base = Math.max(0, resultatFiscal);
  const seuil = Math.round((SEUIL_TAUX_REDUIT_IS * (p.dureeMois ?? 12)) / 12);
  const baseTauxReduit = p.eligibleTauxReduit ? Math.min(base, seuil) : 0;
  const baseTauxNormal = base - baseTauxReduit;
  // L'IS est arrondi à l'euro le plus proche (CGI art. 1724).
  const arrondiEuro = (c: Cents) => Math.round(c / 100) * 100;
  const impotTauxReduit = arrondiEuro(baseTauxReduit * 0.15);
  const impotTauxNormal = arrondiEuro(baseTauxNormal * 0.25);
  const impotTotal = impotTauxReduit + impotTauxNormal;
  if (p.eligibleTauxReduit) detail.push(`Taux réduit de 15 % sur ${baseTauxReduit / 100} € (CGI art. 219-I-b)`);
  detail.push(`Taux normal de 25 % sur ${baseTauxNormal / 100} €`);
  const acomptesVerses = p.acomptesVerses ?? 0;
  return {
    resultatComptable: p.resultatComptableAvantIs, reintegrations, deductions, deficitsReportes, resultatFiscal,
    baseTauxReduit, baseTauxNormal, impotTauxReduit, impotTauxNormal, impotTotal, acomptesVerses,
    solde: impotTotal - acomptesVerses, detail,
  };
}

/** Écriture de constatation de l'IS de l'exercice : 695 au débit, 444 au crédit. */
export function ecritureIs(calc: CalculIs, dateCloture: string): Ecriture | null {
  if (calc.impotTotal <= 0) return null;
  return {
    journal: "OD",
    date: dateCloture,
    libelle: `Impôt sur les sociétés de l'exercice ${dateCloture.slice(0, 4)}`,
    pieceRef: `IS-${dateCloture.replace(/-/g, "")}`,
    pieceDate: dateCloture,
    lignes: [
      { compte: "695", libelle: "Impôt sur les bénéfices", debit: calc.impotTotal, credit: 0 },
      { compte: "444", libelle: "État - Impôt sur les bénéfices", debit: 0, credit: calc.impotTotal },
    ],
  };
}
