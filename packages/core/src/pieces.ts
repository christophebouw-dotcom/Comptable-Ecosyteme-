/**
 * Pièces justificatives : données extraites d'une facture (par l'IA ou par
 * lecture d'une facture électronique structurée), contrôles de cohérence et
 * proposition d'écriture comptable.
 *
 * Principe : l'IA LIT, le code VÉRIFIE, l'humain VALIDE. Aucun montant n'est
 * accepté sans contrôle arithmétique déterministe, et aucune écriture n'est
 * validée automatiquement.
 */
import { type Cents, applyRate } from "./money.js";
import type { Ecriture, LigneEcriture } from "./ledger.js";
import { isIsoDate } from "./ledger.js";
import { TAUX_TVA_LIST } from "./tva.js";
import { stripSpaces, validateIban, validateSiren, validateVatNumber } from "./validators.js";

export type TypePiece = "facture_achat" | "avoir_achat" | "facture_vente" | "avoir_vente" | "ticket" | "note_frais" | "autre";

export const LIBELLES_TYPES_PIECE: Record<TypePiece, string> = {
  facture_achat: "Facture fournisseur",
  avoir_achat: "Avoir fournisseur",
  facture_vente: "Facture client",
  avoir_vente: "Avoir client",
  ticket: "Ticket de caisse",
  note_frais: "Note de frais",
  autre: "Autre document",
};

export interface PartieExtraite {
  nom: string | null;
  siren: string | null;
  tvaIntra: string | null;
  adresse: string | null;
  iban: string | null;
}

export interface ExtractionPiece {
  typeDocument: TypePiece;
  emetteur: PartieExtraite;
  destinataire: PartieExtraite;
  numero: string | null;
  dateFacture: string | null;
  dateEcheance: string | null;
  devise: string;
  lignes: { designation: string; montantHT: Cents; tauxTvaBp: number }[];
  ventilationTva: { tauxBp: number; baseHT: Cents; tva: Cents }[];
  totalHT: Cents;
  totalTVA: Cents;
  totalTTC: Cents;
  /** Compte de charge ou de produit proposé (PCG). */
  compteSuggere: string | null;
  justificationCompte: string | null;
  /** Confiance globale de l'extraction, entre 0 et 1. */
  confiance: number;
  remarques: string[];
  /** Origine des données : lecture IA ou facture électronique structurée (exacte). */
  source: "ia" | "facturx";
}

export interface ControlePiece {
  code: string;
  niveau: "bloquant" | "avertissement" | "info";
  message: string;
}

/**
 * Contrôles déterministes de l'extraction. Un contrôle bloquant empêche la
 * comptabilisation tant que les données n'ont pas été corrigées.
 */
export function controlerExtraction(e: ExtractionPiece, exercice?: { debut: string; fin: string }): ControlePiece[] {
  const out: ControlePiece[] = [];
  const add = (code: string, niveau: ControlePiece["niveau"], message: string) => out.push({ code, niveau, message });

  if (e.typeDocument === "autre") add("TYPE", "bloquant", "Le document n'a pas été reconnu comme une pièce comptable");
  if (e.devise && e.devise !== "EUR") add("DEVISE", "bloquant", `Facture en ${e.devise} : conversion au cours du jour nécessaire`);
  if (!e.dateFacture || !isIsoDate(e.dateFacture)) add("DATE", "bloquant", "Date de facture absente ou illisible");
  else if (exercice && (e.dateFacture < exercice.debut || e.dateFacture > exercice.fin)) {
    add("HORS_EXERCICE", "bloquant", `La date ${e.dateFacture} est hors de l'exercice ${exercice.debut} → ${exercice.fin}`);
  }
  if (e.totalTTC <= 0) add("MONTANT", "bloquant", "Montant TTC nul ou illisible");
  if (Math.abs(e.totalHT + e.totalTVA - e.totalTTC) > 1) {
    add("TOTAUX", "bloquant", `Incohérence : HT ${e.totalHT / 100} + TVA ${e.totalTVA / 100} ≠ TTC ${e.totalTTC / 100}`);
  }
  if (e.ventilationTva.length) {
    const base = e.ventilationTva.reduce((a, v) => a + v.baseHT, 0);
    const tva = e.ventilationTva.reduce((a, v) => a + v.tva, 0);
    if (Math.abs(base - e.totalHT) > 1 || Math.abs(tva - e.totalTVA) > 1) {
      add("VENTILATION", "avertissement", "La ventilation par taux ne correspond pas aux totaux");
    }
    for (const v of e.ventilationTva) {
      if (!(TAUX_TVA_LIST as readonly number[]).includes(v.tauxBp)) add("TAUX", "avertissement", `Taux de TVA inhabituel en France : ${v.tauxBp / 100} %`);
      // Tolérance d'arrondi : 2 centimes par taux (calcul ligne à ligne côté émetteur).
      else if (Math.abs(applyRate(v.baseHT, v.tauxBp) - v.tva) > 2) {
        add("CALCUL_TVA", "avertissement", `TVA à ${v.tauxBp / 100} % : ${v.tva / 100} € au lieu de ${applyRate(v.baseHT, v.tauxBp) / 100} € attendus`);
      }
    }
  }
  if (!e.numero) add("NUMERO", "avertissement", "Numéro de facture absent (mention obligatoire, CGI ann. II art. 242 nonies A)");
  const fournisseur = e.typeDocument.endsWith("achat") ? e.emetteur : null;
  if (fournisseur) {
    if (fournisseur.siren && !validateSiren(fournisseur.siren).valid) add("SIREN", "avertissement", `SIREN du fournisseur invalide : ${fournisseur.siren}`);
    if (fournisseur.tvaIntra && !validateVatNumber(fournisseur.tvaIntra).valid) add("TVA_INTRA", "avertissement", `N° de TVA du fournisseur invalide : ${fournisseur.tvaIntra}`);
    if (fournisseur.iban && !validateIban(fournisseur.iban).valid) add("IBAN", "avertissement", "IBAN du fournisseur invalide : vérifiez-le avant tout paiement (risque de fraude au RIB)");
    if (e.totalTVA > 0 && !fournisseur.tvaIntra) add("TVA_DEDUCTIBLE", "avertissement", "Numéro de TVA du fournisseur absent : le droit à déduction peut être contesté (CGI art. 271)");
  }
  if (e.typeDocument === "ticket" && e.totalTTC > 15_000 && e.totalTVA > 0) {
    add("TICKET", "info", "Ticket de plus de 150 € TTC : une facture est nécessaire pour déduire la TVA (CGI ann. II art. 242 nonies A)");
  }
  if (e.compteSuggere && !/^[267][0-9]{1,7}$/.test(e.compteSuggere)) add("COMPTE", "avertissement", `Compte proposé inhabituel : ${e.compteSuggere}`);
  if (e.compteSuggere?.startsWith("2") && e.totalHT < 50_000) {
    add("IMMO_SEUIL", "info", "Bien de moins de 500 € HT : il peut être passé en charge (tolérance BOI-BIC-CHG-20-30-10)");
  }
  if (e.confiance < 0.7) add("CONFIANCE", "avertissement", `Lecture incertaine (confiance ${Math.round(e.confiance * 100)} %) : vérifiez chaque montant`);
  return out;
}

export interface ParametresProposition {
  compte: string;
  compteAux: string;
  journal?: string;
}

/**
 * Écriture proposée à partir d'une extraction contrôlée. Les montants
 * proviennent des totaux, ce qui garantit l'équilibre : tiers = HT + TVA.
 */
export function propositionEcriture(e: ExtractionPiece, p: ParametresProposition): Ecriture {
  const vente = e.typeDocument === "facture_vente" || e.typeDocument === "avoir_vente";
  const avoir = e.typeDocument.startsWith("avoir");
  const immobilisation = p.compte.startsWith("2");
  const compteTiers = vente ? "411" : immobilisation ? "404" : "401";
  const compteTva = vente ? "44571" : immobilisation ? "44562" : "44566";
  const nom = (vente ? e.destinataire.nom : e.emetteur.nom) ?? "Tiers";

  // Ventilation par taux si elle est cohérente avec les totaux, sinon une ligne unique.
  const ventilationOk =
    e.ventilationTva.length > 0 &&
    e.ventilationTva.reduce((a, v) => a + v.baseHT, 0) === e.totalHT &&
    e.ventilationTva.reduce((a, v) => a + v.tva, 0) === e.totalTVA;
  const ventilation = ventilationOk ? e.ventilationTva : [{ tauxBp: e.ventilationTva[0]?.tauxBp ?? 2000, baseHT: e.totalHT, tva: e.totalTVA }];

  // Sens « naturel » : achat = charge et TVA au débit, fournisseur au crédit.
  const debitNaturel = !vente;
  const sens = (montant: Cents, debit: boolean): Pick<LigneEcriture, "debit" | "credit"> => {
    const d = avoir ? !debit : debit;
    return d ? { debit: montant, credit: 0 } : { debit: 0, credit: montant };
  };
  const lignes: LigneEcriture[] = [];
  for (const v of ventilation) {
    if (v.baseHT) lignes.push({ compte: p.compte, libelle: `${nom}${ventilation.length > 1 ? ` (${v.tauxBp / 100} %)` : ""}`, ...sens(v.baseHT, debitNaturel) });
    if (v.tva) lignes.push({ compte: compteTva, libelle: `TVA ${v.tauxBp / 100} %`, tauxTva: v.tauxBp, ...sens(v.tva, debitNaturel) });
  }
  lignes.push({ compte: compteTiers, compteAux: p.compteAux, libelle: nom, ...sens(e.totalHT + e.totalTVA, !debitNaturel) });
  return {
    journal: p.journal ?? (vente ? "VE" : "AC"),
    date: e.dateFacture!,
    libelle: `${avoir ? "Avoir" : "Facture"} ${e.numero ?? ""} ${nom}`.replace(/\s+/g, " ").trim().slice(0, 200),
    pieceRef: (e.numero ?? `PIECE-${e.dateFacture}`).slice(0, 60),
    pieceDate: e.dateFacture!,
    lignes,
  };
}

// ---------------------------------------------------------------------------
// Rapprochement avec les tiers existants
// ---------------------------------------------------------------------------

export interface TiersConnu {
  id: number;
  compteAux: string;
  nom: string;
  siren: string | null;
  tvaIntra: string | null;
  type: "client" | "fournisseur";
}

const normNom = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/\b(SAS|SASU|SARL|EURL|SA|SCI|SNC|SELARL|ETS|STE|SOCIETE)\b/g, " ")
    .replace(/[^A-Z0-9]/g, "");

/** Retrouve le tiers correspondant (SIREN, puis TVA, puis nom) ou propose un code auxiliaire. */
export function rapprocherTiers(
  partie: PartieExtraite,
  type: "client" | "fournisseur",
  tiers: TiersConnu[],
): { tiers: TiersConnu | null; methode: "siren" | "tva" | "nom" | null; compteAuxPropose: string } {
  const candidats = tiers.filter((t) => t.type === type);
  const siren = partie.siren ? stripSpaces(partie.siren) : partie.tvaIntra?.startsWith("FR") ? stripSpaces(partie.tvaIntra).slice(4) : null;
  if (siren) {
    const t = candidats.find((x) => x.siren === siren);
    if (t) return { tiers: t, methode: "siren", compteAuxPropose: t.compteAux };
  }
  if (partie.tvaIntra) {
    const t = candidats.find((x) => x.tvaIntra && stripSpaces(x.tvaIntra) === stripSpaces(partie.tvaIntra!));
    if (t) return { tiers: t, methode: "tva", compteAuxPropose: t.compteAux };
  }
  const n = partie.nom ? normNom(partie.nom) : "";
  if (n.length >= 3) {
    const t = candidats.find((x) => {
      const m = normNom(x.nom);
      return m.length >= 3 && (m === n || m.includes(n) || n.includes(m));
    });
    if (t) return { tiers: t, methode: "nom", compteAuxPropose: t.compteAux };
  }
  const base = `${type === "client" ? "C" : "F"}${n.slice(0, 12) || "DIVERS"}`;
  let code = base;
  for (let i = 2; tiers.some((t) => t.compteAux === code); i++) code = `${base.slice(0, 15)}${i}`;
  return { tiers: null, methode: null, compteAuxPropose: code };
}

// ---------------------------------------------------------------------------
// Facture électronique Factur-X / CII : lecture exacte, sans IA
// ---------------------------------------------------------------------------

function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml);
  return m ? m[1]!.trim() : null;
}
function tagsAll(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "g"))].map((m) => m[1]!);
}
const unescape = (s: string | null) =>
  s?.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim() || null;
const montant = (s: string | null): Cents => (s ? Math.round(Number(unescape(s)) * 100) : 0);
const date102 = (s: string | null): string | null => {
  const v = unescape(s);
  return v && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null;
};

function partieCii(bloc: string | null): PartieExtraite {
  if (!bloc) return { nom: null, siren: null, tvaIntra: null, adresse: null, iban: null };
  const legal = tag(bloc, "SpecifiedLegalOrganization");
  const tax = tag(bloc, "SpecifiedTaxRegistration");
  const addr = tag(bloc, "PostalTradeAddress");
  return {
    nom: unescape(tag(bloc, "Name")),
    siren: legal ? unescape(tag(legal, "ID")) : null,
    tvaIntra: tax ? unescape(tag(tax, "ID")) : null,
    adresse: addr ? [tag(addr, "LineOne"), tag(addr, "PostcodeCode"), tag(addr, "CityName")].map(unescape).filter(Boolean).join(", ") : null,
    iban: null,
  };
}

/**
 * Lit une facture au format UN/CEFACT CII (Factur-X, ZUGFeRD, facture
 * électronique de la réforme 2026). Les données sont exactes : aucune
 * interprétation n'est nécessaire.
 */
export function parseFacturX(xml: string, sirenDossier: string): ExtractionPiece | null {
  if (!/CrossIndustryInvoice/.test(xml)) return null;
  const doc = tag(xml, "ExchangedDocument") ?? "";
  const typeCode = unescape(tag(doc, "TypeCode"));
  const vendeur = partieCii(tag(xml, "SellerTradeParty"));
  const acheteur = partieCii(tag(xml, "BuyerTradeParty"));
  const settlement = tag(xml, "ApplicableHeaderTradeSettlement") ?? "";
  vendeur.iban = unescape(tag(settlement, "IBANID"));
  const vente = !!vendeur.siren && stripSpaces(vendeur.siren) === stripSpaces(sirenDossier);
  const avoir = typeCode === "381";
  const somme = tag(settlement, "SpecifiedTradeSettlementHeaderMonetarySummation") ?? "";
  const lignes = tagsAll(xml, "IncludedSupplyChainTradeLineItem").map((l) => ({
    designation: unescape(tag(tag(l, "SpecifiedTradeProduct") ?? "", "Name")) ?? "",
    montantHT: montant(tag(l, "LineTotalAmount")),
    tauxTvaBp: Math.round(Number(unescape(tag(l, "RateApplicablePercent")) ?? 0) * 100),
  }));
  const ventilationTva = tagsAll(settlement, "ApplicableTradeTax").map((t) => ({
    tauxBp: Math.round(Number(unescape(tag(t, "RateApplicablePercent")) ?? 0) * 100),
    baseHT: montant(tag(t, "BasisAmount")),
    tva: montant(tag(t, "CalculatedAmount")),
  }));
  return {
    typeDocument: vente ? (avoir ? "avoir_vente" : "facture_vente") : avoir ? "avoir_achat" : "facture_achat",
    emetteur: vendeur,
    destinataire: acheteur,
    numero: unescape(tag(doc, "ID")),
    dateFacture: date102(tag(tag(doc, "IssueDateTime") ?? "", "DateTimeString")),
    dateEcheance: date102(tag(tag(settlement, "DueDateDateTime") ?? "", "DateTimeString")),
    devise: unescape(tag(settlement, "InvoiceCurrencyCode")) ?? "EUR",
    lignes,
    ventilationTva,
    totalHT: montant(tag(somme, "TaxBasisTotalAmount")),
    totalTVA: montant(tag(somme, "TaxTotalAmount")),
    totalTTC: montant(tag(somme, "GrandTotalAmount")),
    compteSuggere: null,
    justificationCompte: null,
    confiance: 1,
    remarques: ["Facture électronique structurée : données lues sans interprétation."],
    source: "facturx",
  };
}
