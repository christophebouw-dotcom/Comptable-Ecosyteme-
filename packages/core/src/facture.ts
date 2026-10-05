/**
 * Facturation conforme.
 *
 * Références :
 *  - CGI, art. 242 nonies A de l'annexe II (mentions obligatoires) ;
 *  - CGI, art. 289 (émission, numérotation chronologique et continue) ;
 *  - Code de commerce, art. L441-9 et D441-5 (pénalités, indemnité forfaitaire
 *    de 40 € pour frais de recouvrement entre professionnels) ;
 *  - Ordonnance n° 2021-1190 et loi de finances 2024 : facturation électronique
 *    B2B obligatoire (réception au 1er sept. 2026, émission au 1er sept. 2026
 *    pour GE/ETI et au 1er sept. 2027 pour PME/micro), nouvelles mentions :
 *    SIREN du client, adresse de livraison si différente, catégorie de
 *    l'opération (biens / services / mixte), option pour la TVA sur les débits.
 */
import { type Cents, applyRate } from "./money.js";
import type { Ecriture, LigneEcriture } from "./ledger.js";
import { validateSiren, validateVatNumber } from "./validators.js";

export interface Partie {
  nom: string;
  adresse: string;
  codePostal: string;
  ville: string;
  pays: string; // ISO 3166-1 alpha-2
  siren?: string | null;
  tvaIntra?: string | null;
  formeJuridique?: string | null;
  capital?: string | null;
  rcs?: string | null;
  email?: string | null;
  /** Le client est-il un professionnel (B2B) ? */
  professionnel?: boolean;
}

export interface LigneFacture {
  designation: string;
  quantite: number; // peut être décimale (heures, kg…)
  unite?: string; // code UN/ECE rec. 20 : C62 (unité), HUR (heure), DAY…
  prixUnitaireHT: Cents;
  tauxTvaBp: number;
  remisePct?: number; // 0-100
}

export type CategorieOperation = "biens" | "services" | "mixte";

export interface Facture {
  type: "facture" | "avoir";
  numero: string;
  dateEmission: string;
  dateEcheance: string;
  dateLivraison?: string | null;
  vendeur: Partie;
  acheteur: Partie;
  adresseLivraison?: string | null;
  categorie: CategorieOperation;
  tvaSurDebits?: boolean;
  lignes: LigneFacture[];
  /** Facture d'origine pour un avoir. */
  factureOrigine?: string | null;
  mentionExoneration?: string | null;
  conditionsEscompte?: string | null;
  tauxPenalitesRetard?: string;
  devise?: "EUR";
}

export interface TotauxFacture {
  lignes: { montantHT: Cents; tva: Cents }[];
  ventilation: { tauxBp: number; baseHT: Cents; tva: Cents }[];
  totalHT: Cents;
  totalTVA: Cents;
  totalTTC: Cents;
}

export function montantLigneHT(l: LigneFacture): Cents {
  const brut = Math.round(l.prixUnitaireHT * l.quantite);
  const remise = l.remisePct ? Math.round((brut * l.remisePct) / 100) : 0;
  return brut - remise;
}

/**
 * Calcule les totaux. La TVA est calculée par taux sur la base cumulée
 * (méthode recommandée par la norme EN 16931, règle BR-CO-17), et non ligne
 * à ligne, pour éviter les écarts d'arrondi.
 */
export function computeTotaux(f: Pick<Facture, "lignes">): TotauxFacture {
  const lignes = f.lignes.map((l) => {
    const montantHT = montantLigneHT(l);
    return { montantHT, tva: applyRate(montantHT, l.tauxTvaBp) };
  });
  const bases = new Map<number, Cents>();
  f.lignes.forEach((l, i) => bases.set(l.tauxTvaBp, (bases.get(l.tauxTvaBp) ?? 0) + lignes[i]!.montantHT));
  const ventilation = [...bases.entries()]
    .sort(([a], [b]) => b - a)
    .map(([tauxBp, baseHT]) => ({ tauxBp, baseHT, tva: applyRate(baseHT, tauxBp) }));
  const totalHT = ventilation.reduce((a, v) => a + v.baseHT, 0);
  const totalTVA = ventilation.reduce((a, v) => a + v.tva, 0);
  return { lignes, ventilation, totalHT, totalTVA, totalTTC: totalHT + totalTVA };
}

export interface ControleMention {
  code: string;
  message: string;
  reference: string;
  bloquant: boolean;
}

/** Vérifie la présence des mentions obligatoires avant émission. */
export function controlerMentions(f: Facture): ControleMention[] {
  const out: ControleMention[] = [];
  const add = (code: string, message: string, reference: string, bloquant = true) =>
    out.push({ code, message, reference, bloquant });
  const CGI = "CGI ann. II, art. 242 nonies A";

  if (!f.numero.trim()) add("NUMERO", "Numéro de facture manquant", "CGI art. 242 nonies A, I-2°");
  if (!f.dateEmission) add("DATE", "Date d'émission manquante", CGI);
  if (!f.vendeur.nom || !f.vendeur.adresse) add("VENDEUR", "Nom et adresse du vendeur obligatoires", CGI);
  if (!f.acheteur.nom || !f.acheteur.adresse) add("ACHETEUR", "Nom et adresse du client obligatoires", CGI);

  if (!f.vendeur.siren) add("SIREN_VENDEUR", "SIREN du vendeur obligatoire", "C. com. art. R123-237");
  else if (!validateSiren(f.vendeur.siren).valid) add("SIREN_VENDEUR", "SIREN du vendeur invalide", "C. com. art. R123-237");

  const franchise = !!f.mentionExoneration?.includes("293 B");
  if (!f.vendeur.tvaIntra && !franchise) {
    add("TVA_VENDEUR", "Numéro de TVA intracommunautaire du vendeur obligatoire", CGI);
  } else if (f.vendeur.tvaIntra && !validateVatNumber(f.vendeur.tvaIntra).valid) {
    add("TVA_VENDEUR", "Numéro de TVA du vendeur invalide", CGI);
  }

  if (f.acheteur.professionnel) {
    if (f.acheteur.pays === "FR" && !f.acheteur.siren) {
      add("SIREN_CLIENT", "SIREN du client professionnel obligatoire (réforme e-invoicing)", "CGI ann. II art. 242 nonies A, mod. décret n° 2022-1299");
    } else if (f.acheteur.siren && !validateSiren(f.acheteur.siren).valid) {
      add("SIREN_CLIENT", "SIREN du client invalide", "CGI art. 242 nonies A");
    }
    if (f.acheteur.pays !== "FR" && !f.acheteur.tvaIntra) {
      add("TVA_CLIENT", "N° de TVA du client UE requis pour une opération intracommunautaire", "CGI art. 242 nonies A, I-4°");
    }
    if (!f.tauxPenalitesRetard) {
      add("PENALITES", "Taux des pénalités de retard obligatoire entre professionnels", "C. com. art. L441-9");
    }
  }

  if (f.lignes.length === 0) add("LIGNES", "La facture ne comporte aucune ligne", CGI);
  f.lignes.forEach((l, i) => {
    if (!l.designation.trim()) add("DESIGNATION", `Ligne ${i + 1} : désignation manquante`, CGI);
    if (!(l.quantite > 0)) add("QUANTITE", `Ligne ${i + 1} : quantité invalide`, CGI);
    if (l.prixUnitaireHT < 0 && f.type === "facture") add("PRIX", `Ligne ${i + 1} : prix négatif`, CGI);
    if (l.tauxTvaBp === 0 && !f.mentionExoneration) {
      add("EXONERATION", `Ligne ${i + 1} : taux 0 % sans mention d'exonération (ex. « TVA non applicable, art. 293 B du CGI »)`, "CGI ann. II, art. 242 nonies A, I-11°");
    }
  });
  if (!f.dateEcheance) add("ECHEANCE", "Date d'échéance du paiement obligatoire", "C. com. art. L441-9");
  if (f.dateEcheance && f.dateEmission && f.dateEcheance < f.dateEmission) {
    add("ECHEANCE", "La date d'échéance est antérieure à la date d'émission", "C. com. art. L441-10");
  }
  if (f.type === "avoir" && !f.factureOrigine) {
    add("AVOIR", "Un avoir doit référencer la facture d'origine", "CGI art. 272 ; BOI-TVA-DECLA-30-20-20");
  }
  if (!f.categorie) {
    add("CATEGORIE", "Catégorie de l'opération (biens / services / mixte) obligatoire", "Décret n° 2022-1299 (réforme facturation électronique)", false);
  }
  return out;
}

/** Mentions légales de pied de facture à imprimer. */
export function mentionsLegales(f: Facture): string[] {
  const m: string[] = [];
  if (f.mentionExoneration) m.push(f.mentionExoneration);
  if (f.tvaSurDebits) m.push("Option pour le paiement de la taxe d'après les débits");
  if (f.acheteur.professionnel) {
    m.push(
      `En cas de retard de paiement, pénalités au taux de ${f.tauxPenalitesRetard ?? "trois fois le taux d'intérêt légal"} ` +
        "et indemnité forfaitaire pour frais de recouvrement de 40 € (C. com. art. L441-10 et D441-5).",
    );
  }
  m.push(f.conditionsEscompte ?? "Pas d'escompte pour paiement anticipé.");
  const v = f.vendeur;
  const legal = [v.formeJuridique, v.capital ? `au capital de ${v.capital}` : null, v.rcs ? `RCS ${v.rcs}` : null, v.siren ? `SIREN ${v.siren}` : null]
    .filter(Boolean)
    .join(" — ");
  if (legal) m.push(`${v.nom} — ${legal}`);
  return m;
}

/**
 * Numéro de facture suivant dans une séquence chronologique et continue
 * (CGI art. 242 nonies A, I-2°). Format : <préfixe><année>-<6 chiffres>.
 */
export function nextNumeroFacture(prefix: string, annee: number, dernierSequentiel: number): string {
  return `${prefix}${annee}-${String(dernierSequentiel + 1).padStart(6, "0")}`;
}

/** Comptes de produits par défaut selon la catégorie. */
const COMPTE_PRODUIT: Record<CategorieOperation, string> = {
  biens: "707",
  services: "706",
  mixte: "706",
};

/**
 * Génère l'écriture comptable de vente (journal VE) correspondant à la facture :
 * débit du client (411) au TTC, crédit des produits (70x) au HT, crédit de la
 * TVA collectée (44571) par taux. Un avoir génère l'écriture inverse.
 */
export function ecritureDeVente(f: Facture, compteClientAux: string, compteProduit?: string): Ecriture {
  const t = computeTotaux(f);
  const avoir = f.type === "avoir";
  const sens = (montant: Cents, cote: "debit" | "credit"): Pick<LigneEcriture, "debit" | "credit"> => {
    const c = avoir ? (cote === "debit" ? "credit" : "debit") : cote;
    return c === "debit" ? { debit: montant, credit: 0 } : { debit: 0, credit: montant };
  };
  const lignes: LigneEcriture[] = [
    { compte: "411", compteAux: compteClientAux, libelle: f.acheteur.nom, ...sens(t.totalTTC, "debit") },
  ];
  for (const v of t.ventilation) {
    lignes.push({ compte: compteProduit ?? COMPTE_PRODUIT[f.categorie], libelle: `Ventes ${v.tauxBp / 100} %`, ...sens(v.baseHT, "credit") });
    if (v.tva) lignes.push({ compte: "44571", libelle: `TVA collectée ${v.tauxBp / 100} %`, tauxTva: v.tauxBp, ...sens(v.tva, "credit") });
  }
  return {
    journal: "VE",
    date: f.dateEmission,
    libelle: `${avoir ? "Avoir" : "Facture"} ${f.numero} — ${f.acheteur.nom}`.slice(0, 200),
    pieceRef: f.numero,
    pieceDate: f.dateEmission,
    lignes,
  };
}

/** Date d'échéance à N jours (délai légal maximal : 60 jours, C. com. L441-10). */
export function echeance(dateEmission: string, jours = 30): string {
  if (jours > 60) throw new Error("Le délai de paiement ne peut excéder 60 jours (C. com. art. L441-10)");
  const d = new Date(`${dateEmission}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}
