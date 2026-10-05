/**
 * Écritures d'inventaire (régularisations de fin d'exercice).
 *
 * Principe d'indépendance des exercices (C. com. art. L123-21 ; PCG art. 513-4) :
 * seuls les produits réalisés à la clôture sont inscrits au résultat, et toutes
 * les charges qui s'y rattachent doivent y figurer, même connues après.
 *
 *  - FNP : charge de l'exercice, facture non encore reçue (408 / 44586) ;
 *  - FAE : produit de l'exercice, facture non encore émise (418 / 44587) ;
 *  - CCA / PCA : quote-part d'une facture qui concerne l'exercice suivant
 *    (486 / 487), calculée prorata temporis ;
 *  - charges à payer / produits à recevoir sans facture (428x, 438x, 448x, 468x) ;
 *  - dépréciation des créances douteuses (6817 / 491), sur le montant HT
 *    (PCG art. 214-25 ; la TVA est récupérable en cas de perte) ;
 *  - provisions pour risques (6815 / 151).
 *
 * Les régularisations sont extournées au premier jour de l'exercice suivant,
 * sauf les dépréciations et provisions, qui sont reprises ou ajustées à la
 * clôture suivante.
 */
import type { Ecriture, LigneEcriture } from "./ledger.js";
import { type Cents, applyRate } from "./money.js";

export type TypeRegularisation = "fnp" | "fae" | "cca" | "pca" | "cap" | "par" | "depreciation_client" | "provision_risque";

export const LIBELLES_REGULARISATIONS: Record<TypeRegularisation, { libelle: string; aide: string; sens: "charge" | "produit" }> = {
  fnp: { libelle: "Facture non parvenue", aide: "Achat ou service consommé avant la clôture, facture reçue après", sens: "charge" },
  fae: { libelle: "Facture à établir", aide: "Vente livrée ou prestation réalisée avant la clôture, facture émise après", sens: "produit" },
  cca: { libelle: "Charge constatée d'avance", aide: "Partie d'une charge déjà facturée qui concerne l'exercice suivant (loyer, assurance, abonnement)", sens: "charge" },
  pca: { libelle: "Produit constaté d'avance", aide: "Partie d'une vente déjà facturée qui concerne l'exercice suivant", sens: "produit" },
  cap: { libelle: "Charge à payer", aide: "Charge certaine sans facture : congés payés, primes, intérêts courus, taxes", sens: "charge" },
  par: { libelle: "Produit à recevoir", aide: "Produit acquis sans facture : intérêts, subventions, avoirs à recevoir", sens: "produit" },
  depreciation_client: { libelle: "Dépréciation de créance", aide: "Créance client douteuse : dépréciation du montant HT selon le risque de perte", sens: "charge" },
  provision_risque: { libelle: "Provision pour risque", aide: "Litige, garantie, amende probable à la clôture", sens: "charge" },
};

export interface Regularisation {
  type: TypeRegularisation;
  libelle: string;
  /** Compte de charge (6) ou de produit (7) concerné. Ignoré pour les dépréciations et provisions. */
  compte: string;
  /** Compte auxiliaire du tiers, conservé dans le libellé et pour le suivi (non porté par 408/418). */
  compteAux?: string | null;
  /**
   * Montant HT. Pour une CCA ou un PCA avec période : montant total de la facture,
   * dont seule la part postérieure à la clôture est retenue.
   * Pour une dépréciation : montant HT de la créance.
   */
  montantHT: Cents;
  /** Taux de TVA en points de base (FNP, FAE). */
  tauxTvaBp?: number | null;
  /** Période couverte par la facture (CCA, PCA). */
  periode?: { debut: string; fin: string } | null;
  /** Taux de dépréciation en points de base (10 000 = 100 %). */
  tauxDepreciationBp?: number | null;
  /** Compte de contrepartie choisi, sinon déduit du type et du compte. */
  compteContrepartie?: string | null;
}

const MS_JOUR = 86_400_000;
const jour = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / MS_JOUR;

/** Nombre de jours de a à b inclus. */
export function joursInclus(a: string, b: string): number {
  return jour(b) - jour(a) + 1;
}

export function ajouterJours(iso: string, n: number): string {
  return new Date((jour(iso) + n) * MS_JOUR).toISOString().slice(0, 10);
}

/**
 * Part d'un montant couvrant la période postérieure à la clôture, au prorata
 * des jours (méthode usuelle des CCA et PCA).
 */
export function prorataApresCloture(montant: Cents, periode: { debut: string; fin: string }, dateCloture: string): Cents {
  if (periode.fin < periode.debut) throw new Error("Période couverte invalide : la fin précède le début");
  if (periode.fin <= dateCloture) return 0;
  if (periode.debut > dateCloture) return montant;
  const total = joursInclus(periode.debut, periode.fin);
  const apres = joursInclus(ajouterJours(dateCloture, 1), periode.fin);
  return Math.round((montant * apres) / total);
}

export function extournable(type: TypeRegularisation): boolean {
  return type !== "depreciation_client" && type !== "provision_risque";
}

/** Montant comptabilisé (HT) de la régularisation. */
export function montantRegularisation(r: Regularisation, dateCloture: string): Cents {
  if ((r.type === "cca" || r.type === "pca") && r.periode) return prorataApresCloture(r.montantHT, r.periode, dateCloture);
  if (r.type === "depreciation_client") return applyRate(r.montantHT, r.tauxDepreciationBp ?? 10_000);
  return r.montantHT;
}

/** Compte de contrepartie par défaut, selon la nature de la charge ou du produit. */
export function contrepartieParDefaut(type: TypeRegularisation, compte: string): string {
  switch (type) {
    case "fnp":
      return "408";
    case "fae":
      return "418";
    case "cca":
      return "486";
    case "pca":
      return "487";
    case "depreciation_client":
      return "491";
    case "provision_risque":
      return "1511";
    case "cap":
      if (compte.startsWith("6412")) return "4282";
      if (compte.startsWith("641")) return "4286";
      if (compte.startsWith("645")) return "4386";
      if (compte.startsWith("63")) return "4486";
      return "4686";
    case "par":
      if (compte.startsWith("74")) return "4487";
      return "4687";
  }
}

export interface ControleRegularisation {
  champ: string;
  message: string;
}

export function controlerRegularisation(r: Regularisation, dateCloture: string): ControleRegularisation[] {
  const out: ControleRegularisation[] = [];
  const sens = LIBELLES_REGULARISATIONS[r.type].sens;
  const compteRequis = r.type !== "depreciation_client" && r.type !== "provision_risque";
  if (compteRequis && sens === "charge" && !/^6[0-9]/.test(r.compte)) out.push({ champ: "compte", message: "Compte de charge (classe 6) attendu" });
  if (compteRequis && sens === "produit" && !/^7[0-9]/.test(r.compte)) out.push({ champ: "compte", message: "Compte de produit (classe 7) attendu" });
  if (!Number.isSafeInteger(r.montantHT) || r.montantHT <= 0) out.push({ champ: "montantHT", message: "Montant positif attendu" });
  if (!r.libelle.trim()) out.push({ champ: "libelle", message: "Libellé obligatoire" });
  if ((r.type === "cca" || r.type === "pca") && r.periode) {
    if (r.periode.fin < r.periode.debut) out.push({ champ: "periode", message: "La fin de période précède le début" });
    else if (r.periode.fin <= dateCloture) out.push({ champ: "periode", message: "La période se termine avant la clôture : rien à constater d'avance" });
  }
  if (r.type === "depreciation_client" && (r.tauxDepreciationBp == null || r.tauxDepreciationBp <= 0 || r.tauxDepreciationBp > 10_000)) {
    out.push({ champ: "tauxDepreciationBp", message: "Taux de dépréciation entre 0 et 100 % attendu" });
  }
  if ((r.type === "fnp" || r.type === "fae") && r.tauxTvaBp != null && ![0, 210, 550, 1000, 2000].includes(r.tauxTvaBp)) {
    out.push({ champ: "tauxTvaBp", message: "Taux de TVA français attendu (0 ; 2,1 ; 5,5 ; 10 ou 20 %)" });
  }
  return out;
}

/** Écriture d'inventaire, datée du jour de clôture, au journal des opérations diverses. */
export function ecritureRegularisation(r: Regularisation, dateCloture: string, pieceRef: string): Ecriture | null {
  const montant = montantRegularisation(r, dateCloture);
  if (montant <= 0) return null;
  const contre = r.compteContrepartie || contrepartieParDefaut(r.type, r.compte);
  const lib = r.libelle.trim().slice(0, 150);
  const tva = r.tauxTvaBp ? applyRate(montant, r.tauxTvaBp) : 0;
  let lignes: LigneEcriture[];
  switch (r.type) {
    case "fnp":
      lignes = [
        { compte: r.compte, libelle: lib, debit: montant, credit: 0 },
        ...(tva ? [{ compte: "44586", libelle: "TVA sur factures non parvenues", debit: tva, credit: 0, tauxTva: r.tauxTvaBp }] : []),
        { compte: contre, libelle: lib, debit: 0, credit: montant + tva },
      ];
      break;
    case "fae":
      lignes = [
        { compte: contre, libelle: lib, debit: montant + tva, credit: 0 },
        { compte: r.compte, libelle: lib, debit: 0, credit: montant },
        ...(tva ? [{ compte: "44587", libelle: "TVA sur factures à établir", debit: 0, credit: tva, tauxTva: r.tauxTvaBp }] : []),
      ];
      break;
    case "cca":
      lignes = [
        { compte: contre, libelle: lib, debit: montant, credit: 0 },
        { compte: r.compte, libelle: lib, debit: 0, credit: montant },
      ];
      break;
    case "pca":
      lignes = [
        { compte: r.compte, libelle: lib, debit: montant, credit: 0 },
        { compte: contre, libelle: lib, debit: 0, credit: montant },
      ];
      break;
    case "cap":
      lignes = [
        { compte: r.compte, libelle: lib, debit: montant, credit: 0 },
        { compte: contre, libelle: lib, debit: 0, credit: montant },
      ];
      break;
    case "par":
      lignes = [
        { compte: contre, libelle: lib, debit: montant, credit: 0 },
        { compte: r.compte, libelle: lib, debit: 0, credit: montant },
      ];
      break;
    case "depreciation_client":
      lignes = [
        { compte: "6817", libelle: lib, debit: montant, credit: 0 },
        { compte: contre, compteAux: null, libelle: lib, debit: 0, credit: montant },
      ];
      break;
    case "provision_risque":
      lignes = [
        { compte: "6815", libelle: lib, debit: montant, credit: 0 },
        { compte: contre, libelle: lib, debit: 0, credit: montant },
      ];
      break;
  }
  return {
    journal: "OD",
    date: dateCloture,
    libelle: `${LIBELLES_REGULARISATIONS[r.type].libelle} — ${lib}`.slice(0, 200),
    pieceRef,
    pieceDate: dateCloture,
    lignes,
  };
}

// -- Suggestions (contrôles de cut-off) ------------------------------------------------

export interface SuggestionRegularisation extends Regularisation {
  /** Clé stable pour ne pas proposer deux fois la même régularisation. */
  cle: string;
  motif: string;
}

const TAUX_CONNUS = [2000, 1000, 550, 210, 0];
const tauxProche = (ht: number, tva: number) => {
  if (ht <= 0) return 0;
  const r = (tva * 10_000) / ht;
  return TAUX_CONNUS.reduce((best, t) => (Math.abs(t - r) < Math.abs(best - r) ? t : best), 2000);
};
const mois = (iso: string) => iso.slice(0, 7);

/** Comptes de charges souvent payées d'avance (loyers, assurances, maintenance, abonnements). */
const CHARGES_PAYEES_D_AVANCE = /^(613|616|6156|6181|651)/;

/**
 * Propose des régularisations à partir des écritures de l'exercice :
 *  - fournisseurs facturés chaque mois dont la facture du dernier mois manque (FNP) ;
 *  - charges habituellement payées d'avance comptabilisées en fin d'exercice (CCA à vérifier).
 * Il s'agit d'indices à valider, jamais d'écritures automatiques.
 */
export function suggererRegularisations(ecritures: Ecriture[], exercice: { debut: string; fin: string }): SuggestionRegularisation[] {
  const out: SuggestionRegularisation[] = [];
  const dernierMois = mois(exercice.fin);

  // 1. Factures non parvenues des fournisseurs récurrents.
  const parFournisseur = new Map<string, { mois: Set<string>; ht: number[]; tva: number; htTotal: number; comptes: Map<string, number> }>();
  for (const e of ecritures) {
    if (e.date < exercice.debut || e.date > exercice.fin) continue;
    const fournisseur = e.lignes.find((l) => l.compte.startsWith("401") && l.compteAux && l.credit > 0);
    if (!fournisseur) continue;
    const charges = e.lignes.filter((l) => l.compte.startsWith("6") && l.debit > 0);
    if (charges.length === 0) continue;
    const ht = charges.reduce((a, l) => a + l.debit, 0);
    const tva = e.lignes.filter((l) => l.compte.startsWith("4456")).reduce((a, l) => a + l.debit, 0);
    const s = parFournisseur.get(fournisseur.compteAux!) ?? { mois: new Set<string>(), ht: [] as number[], tva: 0, htTotal: 0, comptes: new Map<string, number>() };
    s.mois.add(mois(e.date));
    s.ht.push(ht);
    s.tva += tva;
    s.htTotal += ht;
    for (const c of charges) s.comptes.set(c.compte, (s.comptes.get(c.compte) ?? 0) + c.debit);
    parFournisseur.set(fournisseur.compteAux!, s);
  }
  for (const [aux, s] of parFournisseur) {
    if (s.mois.size < 3 || s.mois.has(dernierMois)) continue;
    // Récurrence mensuelle : au moins 3 mois distincts, dont l'un des deux derniers mois de l'exercice.
    const avantDernier = mois(ajouterJours(`${dernierMois}-01`, -1));
    if (!s.mois.has(avantDernier)) continue;
    const compte = [...s.comptes.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const moyenne = Math.round(s.ht.reduce((a, b) => a + b, 0) / s.ht.length);
    out.push({
      cle: `fnp:${aux}:${dernierMois}`,
      type: "fnp",
      libelle: `${aux} — facture de ${dernierMois} non reçue`,
      compte,
      compteAux: aux,
      montantHT: moyenne,
      tauxTvaBp: tauxProche(s.htTotal, s.tva),
      motif: `Fournisseur facturé ${s.mois.size} mois sur l'exercice, aucune facture pour ${dernierMois}. Montant estimé : moyenne des factures.`,
    });
  }

  // 2. Charges payées d'avance enregistrées dans les trois derniers mois.
  const debutFenetre = ajouterJours(exercice.fin, -91);
  for (const e of ecritures) {
    if (e.date < debutFenetre || e.date > exercice.fin) continue;
    for (const l of e.lignes) {
      if (!CHARGES_PAYEES_D_AVANCE.test(l.compte) || l.debit < 30_000) continue;
      const periode = { debut: e.date, fin: ajouterJours(e.date, 364) };
      out.push({
        cle: `cca:${e.pieceRef}:${l.compte}`,
        type: "cca",
        libelle: `${e.libelle}`.slice(0, 150),
        compte: l.compte,
        montantHT: l.debit,
        periode,
        motif: `Charge de nature souvent annuelle comptabilisée le ${e.date} (pièce ${e.pieceRef}). Vérifiez la période couverte sur la facture.`,
      });
    }
  }
  return out;
}
