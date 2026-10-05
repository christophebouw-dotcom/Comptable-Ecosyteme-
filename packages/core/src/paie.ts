/**
 * Moteur de paie (secteur privé, régime général, France métropolitaine).
 *
 * Calcul mensuel d'un bulletin à partir d'un barème PARAMÉTRABLE : les taux,
 * plafonds et seuils évoluent chaque année (LFSS, accords AGIRC-ARRCO, arrêtés
 * PMSS / SMIC). Le barème fourni (BAREME_2026) est indicatif ; il doit être
 * vérifié par le cabinet avant toute utilisation réelle, de même que les taux
 * conventionnels (prévoyance, mutuelle, AT/MP notifié par la CARSAT).
 *
 * Simplifications assumées, signalées sur le bulletin :
 *  - pas de régularisation progressive annuelle des plafonds ni de la réduction générale ;
 *  - réduction générale imputée en totalité sur les cotisations URSSAF ;
 *  - exonération d'impôt des heures supplémentaires sans suivi du plafond annuel de 7 500 € ;
 *  - pas de régime local Alsace-Moselle, d'apprentis, de temps partiel thérapeutique, etc.
 *
 * Références : CSS art. L241-2 et s. (cotisations), L241-13 (réduction générale),
 * L241-17 (heures supplémentaires) ; CGI art. 204 A et s. (prélèvement à la source) ;
 * C. trav. art. R3243-1 (mentions du bulletin) ; décret 2023-1301 (montant net social).
 */
import type { Ecriture, LigneEcriture } from "./ledger.js";
import type { Cents } from "./money.js";

export interface Bareme {
  annee: number;
  /** SMIC horaire brut, en centimes. */
  smicHoraire: Cents;
  /** Plafond mensuel de la sécurité sociale, en centimes. */
  pmss: Cents;
  /** Taux en pourcentage (6.9 = 6,90 %). */
  taux: {
    maladiePlein: number;
    maladieReduit: number;
    /** Seuil du taux réduit maladie, en nombre de SMIC. */
    seuilMaladieSmic: number;
    vieillessePlafSal: number;
    vieillessePlafPat: number;
    vieillesseDeplafSal: number;
    vieillesseDeplafPat: number;
    allocFamPlein: number;
    allocFamReduit: number;
    seuilAllocFamSmic: number;
    chomagePat: number;
    ags: number;
    csa: number;
    fnalMoins50: number;
    fnal50Plus: number;
    dialogueSocial: number;
    formationMoins11: number;
    formation11Plus: number;
    taxeApprentissage: number;
    retraiteT1Sal: number;
    retraiteT1Pat: number;
    retraiteT2Sal: number;
    retraiteT2Pat: number;
    cegT1Sal: number;
    cegT1Pat: number;
    cegT2Sal: number;
    cegT2Pat: number;
    cetSal: number;
    cetPat: number;
    apecSal: number;
    apecPat: number;
    prevoyanceCadresPat: number;
    csgDeductible: number;
    csgNonDeductible: number;
    crds: number;
    /** Abattement pour frais professionnels sur l'assiette CSG/CRDS (98,25 %). */
    assietteCsg: number;
    reductionHsSal: number;
  };
  reductionGenerale: { tMin: number; tDeltaMoins50: number; tDelta50Plus: number; puissance: number; plafondSmic: number };
  /** Déduction forfaitaire patronale par heure supplémentaire, en centimes. */
  deductionHsParHeure: { moins20: Cents; de20a249: Cents };
  /** Grille du taux neutre du prélèvement à la source (métropole) : [plafond mensuel en centimes, taux %]. */
  grilleTauxNeutre: [Cents, number][];
}

/** Barème indicatif 2026 — à vérifier avant usage (voir en-tête du module). */
export const BAREME_2026: Bareme = {
  annee: 2026,
  smicHoraire: 1202,
  pmss: 400_500,
  taux: {
    maladiePlein: 13,
    maladieReduit: 7,
    seuilMaladieSmic: 2.25,
    vieillessePlafSal: 6.9,
    vieillessePlafPat: 8.55,
    vieillesseDeplafSal: 0.4,
    vieillesseDeplafPat: 2.11,
    allocFamPlein: 5.25,
    allocFamReduit: 3.45,
    seuilAllocFamSmic: 3.3,
    chomagePat: 4,
    ags: 0.25,
    csa: 0.3,
    fnalMoins50: 0.1,
    fnal50Plus: 0.5,
    dialogueSocial: 0.016,
    formationMoins11: 0.55,
    formation11Plus: 1,
    taxeApprentissage: 0.68,
    retraiteT1Sal: 3.15,
    retraiteT1Pat: 4.72,
    retraiteT2Sal: 8.64,
    retraiteT2Pat: 12.95,
    cegT1Sal: 0.86,
    cegT1Pat: 1.29,
    cegT2Sal: 1.08,
    cegT2Pat: 1.62,
    cetSal: 0.14,
    cetPat: 0.21,
    apecSal: 0.024,
    apecPat: 0.036,
    prevoyanceCadresPat: 1.5,
    csgDeductible: 6.8,
    csgNonDeductible: 2.4,
    crds: 0.5,
    assietteCsg: 98.25,
    reductionHsSal: 11.31,
  },
  reductionGenerale: { tMin: 0.02, tDeltaMoins50: 0.3773, tDelta50Plus: 0.3813, puissance: 1.75, plafondSmic: 3 },
  deductionHsParHeure: { moins20: 150, de20a249: 50 },
  grilleTauxNeutre: [
    [162_000, 0], [168_300, 0.5], [179_100, 1.3], [191_100, 2.1], [204_200, 2.9], [215_100, 3.5], [229_400, 4.1],
    [271_400, 5.3], [310_700, 7.5], [353_900, 9.9], [398_300, 11.9], [464_800, 13.8], [557_400, 15.8], [709_600, 17.9],
    [825_300, 20], [1_273_000, 24], [1_661_000, 28], [2_494_200, 33], [5_288_700, 38], [Number.MAX_SAFE_INTEGER, 43],
  ],
};

export type StatutSalarie = "non_cadre" | "cadre";

export interface ProfilPaie {
  statut: StatutSalarie;
  /** Salaire de base mensuel brut, en centimes. */
  salaireBase: Cents;
  /** Durée mensuelle contractuelle (151,67 h pour 35 h hebdomadaires). */
  heuresMensuelles: number;
  /** Taux personnalisé de prélèvement à la source transmis par la DGFiP (en %), null = taux neutre. */
  tauxPas: number | null;
  /** Complémentaire santé obligatoire : parts mensuelles salarié et employeur, en centimes. */
  mutuelleSalarie: Cents;
  mutuelleEmployeur: Cents;
}

export interface ElementsVariables {
  heuresSup25: number;
  heuresSup50: number;
  /** Primes soumises à cotisations, en centimes. */
  primes: Cents;
  /** Heures d'absence non rémunérées. */
  heuresAbsence: number;
  /** Indemnités non soumises (remboursements de frais), ajoutées au net. */
  indemnitesNonSoumises: Cents;
}

export interface ParametresEmployeur {
  effectif: number;
  /** Taux accidents du travail notifié, en %. */
  tauxAtMp: number;
  /** Versement mobilité (entreprises d'au moins 11 salariés), en %. */
  tauxVersementMobilite: number;
}

export type Organisme = "urssaf" | "retraite" | "prevoyance" | "mutuelle";
export type Rubrique = "sante" | "atmp" | "retraite" | "famille" | "chomage" | "autres" | "csg" | "exoneration";

export interface LigneBulletin {
  code: string;
  libelle: string;
  rubrique: Rubrique;
  organisme: Organisme;
  base: Cents;
  tauxSal: number | null;
  montantSal: Cents;
  tauxPat: number | null;
  montantPat: Cents;
  /** Cotisation salariale non déductible du revenu imposable (CSG non déductible, CRDS). */
  nonDeductible?: boolean;
  /** Imputation comptable particulière des charges patronales. */
  comptePat?: string;
}

export interface Bulletin {
  bareme: number;
  tauxHoraire: Cents;
  remuneration: { code: string; libelle: string; base: number | null; taux: Cents | null; montant: Cents }[];
  brut: Cents;
  montantHs: Cents;
  lignes: LigneBulletin[];
  totalSalarial: Cents;
  totalPatronal: Cents;
  netAvantImpot: Cents;
  netImposable: Cents;
  netSocial: Cents;
  pas: { base: Cents; taux: number; montant: Cents; tauxNeutre: boolean };
  netAPayer: Cents;
  coutEmployeur: Cents;
  allegements: { reductionGenerale: Cents; deductionHs: Cents; reductionHsSalariale: Cents };
  congesAcquis: number;
  avertissements: string[];
}

const pct = (base: Cents, taux: number) => Math.round((base * taux) / 100);

export function tauxNeutrePas(netImposable: Cents, bareme: Bareme = BAREME_2026): number {
  for (const [plafond, taux] of bareme.grilleTauxNeutre) if (netImposable < plafond) return taux;
  return bareme.grilleTauxNeutre.at(-1)![1];
}

/** Coefficient de la réduction générale dégressive (zéro au-delà du plafond en SMIC). */
export function coefficientReductionGenerale(brut: Cents, smicReference: Cents, effectif: number, bareme: Bareme = BAREME_2026): number {
  const rg = bareme.reductionGenerale;
  if (brut <= 0 || brut >= rg.plafondSmic * smicReference) return 0;
  const tDelta = effectif < 50 ? rg.tDeltaMoins50 : rg.tDelta50Plus;
  const ratio = Math.max(0, 0.5 * ((rg.plafondSmic * smicReference) / brut - 1));
  const c = rg.tMin + tDelta * Math.min(1, ratio) ** rg.puissance;
  return Math.round(Math.min(rg.tMin + tDelta, c) * 10_000) / 10_000;
}

export function calculerBulletin(profil: ProfilPaie, variables: ElementsVariables, employeur: ParametresEmployeur, bareme: Bareme = BAREME_2026): Bulletin {
  const t = bareme.taux;
  const avertissements: string[] = [];
  if (profil.heuresMensuelles <= 0 || profil.heuresMensuelles > 220) throw new Error("Durée mensuelle invalide");
  const tauxHoraire = Math.round(profil.salaireBase / profil.heuresMensuelles);
  const smicMensuel = Math.round(bareme.smicHoraire * profil.heuresMensuelles);
  if (profil.salaireBase < smicMensuel) avertissements.push(`Salaire de base inférieur au SMIC (${(smicMensuel / 100).toFixed(2)} € pour ${profil.heuresMensuelles} h) : vérifiez le minimum conventionnel.`);

  const absence = Math.min(profil.salaireBase, Math.round((profil.salaireBase * variables.heuresAbsence) / profil.heuresMensuelles));
  const hs25 = Math.round(tauxHoraire * 1.25 * variables.heuresSup25);
  const hs50 = Math.round(tauxHoraire * 1.5 * variables.heuresSup50);
  const montantHs = hs25 + hs50;
  const remuneration: Bulletin["remuneration"] = [{ code: "BASE", libelle: "Salaire de base", base: profil.heuresMensuelles, taux: tauxHoraire, montant: profil.salaireBase }];
  if (absence) remuneration.push({ code: "ABS", libelle: "Absence non rémunérée", base: variables.heuresAbsence, taux: tauxHoraire, montant: -absence });
  if (hs25) remuneration.push({ code: "HS25", libelle: "Heures supplémentaires à 25 %", base: variables.heuresSup25, taux: Math.round(tauxHoraire * 1.25), montant: hs25 });
  if (hs50) remuneration.push({ code: "HS50", libelle: "Heures supplémentaires à 50 %", base: variables.heuresSup50, taux: Math.round(tauxHoraire * 1.5), montant: hs50 });
  if (variables.primes) remuneration.push({ code: "PRIME", libelle: "Primes et gratifications", base: null, taux: null, montant: variables.primes });
  const brut = profil.salaireBase - absence + montantHs + variables.primes;
  if (brut <= 0) throw new Error("Salaire brut nul ou négatif");

  const pmss = bareme.pmss;
  const ta = Math.min(brut, pmss);
  const t2 = Math.max(0, Math.min(brut, 8 * pmss) - pmss);
  const plaf4 = Math.min(brut, 4 * pmss);
  const cadre = profil.statut === "cadre";
  const L: LigneBulletin[] = [];
  const add = (l: Omit<LigneBulletin, "montantSal" | "montantPat"> & { montantSal?: Cents; montantPat?: Cents }) => {
    const montantSal = l.montantSal ?? (l.tauxSal != null ? pct(l.base, l.tauxSal) : 0);
    const montantPat = l.montantPat ?? (l.tauxPat != null ? pct(l.base, l.tauxPat) : 0);
    if (l.base > 0 || montantSal || montantPat) L.push({ ...l, montantSal, montantPat });
  };

  // Santé
  const maladie = brut <= t.seuilMaladieSmic * smicMensuel ? t.maladieReduit : t.maladiePlein;
  add({ code: "MAL", libelle: "Sécurité sociale maladie, maternité, invalidité, décès", rubrique: "sante", organisme: "urssaf", base: brut, tauxSal: null, tauxPat: maladie });
  if (profil.mutuelleSalarie || profil.mutuelleEmployeur) {
    add({ code: "MUT", libelle: "Complémentaire santé", rubrique: "sante", organisme: "mutuelle", base: 0, tauxSal: null, tauxPat: null, montantSal: profil.mutuelleSalarie, montantPat: profil.mutuelleEmployeur, comptePat: "6452" });
  }
  if (cadre) add({ code: "PREV", libelle: "Prévoyance cadres (tranche 1)", rubrique: "sante", organisme: "prevoyance", base: ta, tauxSal: null, tauxPat: t.prevoyanceCadresPat, comptePat: "6458" });
  // Accidents du travail
  add({ code: "ATMP", libelle: "Accidents du travail, maladies professionnelles", rubrique: "atmp", organisme: "urssaf", base: brut, tauxSal: null, tauxPat: employeur.tauxAtMp });
  // Retraite
  add({ code: "VPLAF", libelle: "Sécurité sociale vieillesse plafonnée", rubrique: "retraite", organisme: "urssaf", base: ta, tauxSal: t.vieillessePlafSal, tauxPat: t.vieillessePlafPat });
  add({ code: "VDEPLAF", libelle: "Sécurité sociale vieillesse déplafonnée", rubrique: "retraite", organisme: "urssaf", base: brut, tauxSal: t.vieillesseDeplafSal, tauxPat: t.vieillesseDeplafPat });
  add({ code: "RCT1", libelle: "Retraite complémentaire tranche 1", rubrique: "retraite", organisme: "retraite", base: ta, tauxSal: t.retraiteT1Sal, tauxPat: t.retraiteT1Pat, comptePat: "6453" });
  add({ code: "CEGT1", libelle: "Contribution d'équilibre général tranche 1", rubrique: "retraite", organisme: "retraite", base: ta, tauxSal: t.cegT1Sal, tauxPat: t.cegT1Pat, comptePat: "6453" });
  if (t2 > 0) {
    add({ code: "RCT2", libelle: "Retraite complémentaire tranche 2", rubrique: "retraite", organisme: "retraite", base: t2, tauxSal: t.retraiteT2Sal, tauxPat: t.retraiteT2Pat, comptePat: "6453" });
    add({ code: "CEGT2", libelle: "Contribution d'équilibre général tranche 2", rubrique: "retraite", organisme: "retraite", base: t2, tauxSal: t.cegT2Sal, tauxPat: t.cegT2Pat, comptePat: "6453" });
    add({ code: "CET", libelle: "Contribution d'équilibre technique", rubrique: "retraite", organisme: "retraite", base: ta + t2, tauxSal: t.cetSal, tauxPat: t.cetPat, comptePat: "6453" });
  }
  if (cadre) add({ code: "APEC", libelle: "APEC", rubrique: "retraite", organisme: "retraite", base: plaf4, tauxSal: t.apecSal, tauxPat: t.apecPat, comptePat: "6453" });
  // Famille
  const af = brut <= t.seuilAllocFamSmic * smicMensuel ? t.allocFamReduit : t.allocFamPlein;
  add({ code: "AF", libelle: "Allocations familiales", rubrique: "famille", organisme: "urssaf", base: brut, tauxSal: null, tauxPat: af });
  // Assurance chômage
  add({ code: "CHOM", libelle: "Assurance chômage", rubrique: "chomage", organisme: "urssaf", base: plaf4, tauxSal: null, tauxPat: t.chomagePat });
  add({ code: "AGS", libelle: "Garantie des salaires (AGS)", rubrique: "chomage", organisme: "urssaf", base: plaf4, tauxSal: null, tauxPat: t.ags });
  // Autres contributions employeur
  if (employeur.effectif < 50) add({ code: "FNAL", libelle: "FNAL", rubrique: "autres", organisme: "urssaf", base: ta, tauxSal: null, tauxPat: t.fnalMoins50 });
  else add({ code: "FNAL", libelle: "FNAL", rubrique: "autres", organisme: "urssaf", base: brut, tauxSal: null, tauxPat: t.fnal50Plus });
  add({ code: "CSA", libelle: "Contribution solidarité autonomie", rubrique: "autres", organisme: "urssaf", base: brut, tauxSal: null, tauxPat: t.csa });
  add({ code: "DIAL", libelle: "Contribution au dialogue social", rubrique: "autres", organisme: "urssaf", base: brut, tauxSal: null, tauxPat: t.dialogueSocial });
  if (employeur.tauxVersementMobilite > 0 && employeur.effectif >= 11) {
    add({ code: "VM", libelle: "Versement mobilité", rubrique: "autres", organisme: "urssaf", base: brut, tauxSal: null, tauxPat: employeur.tauxVersementMobilite, comptePat: "6334" });
  }
  add({ code: "FPC", libelle: "Contribution à la formation professionnelle", rubrique: "autres", organisme: "urssaf", base: brut, tauxSal: null, tauxPat: employeur.effectif < 11 ? t.formationMoins11 : t.formation11Plus, comptePat: "6333" });
  add({ code: "TA", libelle: "Taxe d'apprentissage", rubrique: "autres", organisme: "urssaf", base: brut, tauxSal: null, tauxPat: t.taxeApprentissage, comptePat: "6312" });

  // CSG / CRDS : 98,25 % du brut dans la limite de 4 PMSS, plus les contributions patronales de prévoyance et santé.
  const patPrevSante = L.filter((l) => l.code === "MUT" || l.code === "PREV").reduce((a, l) => a + l.montantPat, 0);
  const assietteCsg = Math.round((plaf4 * t.assietteCsg) / 100) + (brut - plaf4) + patPrevSante;
  add({ code: "CSGD", libelle: "CSG déductible de l'impôt sur le revenu", rubrique: "csg", organisme: "urssaf", base: assietteCsg, tauxSal: t.csgDeductible, tauxPat: null });
  add({ code: "CSGND", libelle: "CSG non déductible de l'impôt sur le revenu", rubrique: "csg", organisme: "urssaf", base: assietteCsg, tauxSal: t.csgNonDeductible, tauxPat: null, nonDeductible: true });
  add({ code: "CRDS", libelle: "CRDS non déductible de l'impôt sur le revenu", rubrique: "csg", organisme: "urssaf", base: assietteCsg, tauxSal: t.crds, tauxPat: null, nonDeductible: true });

  // Allègements
  const reductionHsSalariale = montantHs ? pct(montantHs, t.reductionHsSal) : 0;
  if (reductionHsSalariale) {
    add({ code: "RHS", libelle: "Réduction de cotisations salariales sur heures supplémentaires", rubrique: "exoneration", organisme: "urssaf", base: montantHs, tauxSal: -t.reductionHsSal, tauxPat: null, montantSal: -reductionHsSalariale });
  }
  const heuresSup = variables.heuresSup25 + variables.heuresSup50;
  const deductionHs =
    heuresSup > 0 && employeur.effectif < 250
      ? Math.round(heuresSup * (employeur.effectif < 20 ? bareme.deductionHsParHeure.moins20 : bareme.deductionHsParHeure.de20a249))
      : 0;
  if (deductionHs) add({ code: "DHS", libelle: "Déduction forfaitaire patronale sur heures supplémentaires", rubrique: "exoneration", organisme: "urssaf", base: 0, tauxSal: null, tauxPat: null, montantPat: -deductionHs });
  const coef = coefficientReductionGenerale(brut, smicMensuel, employeur.effectif, bareme);
  const urssafPatAvant = L.filter((l) => l.organisme === "urssaf" && l.montantPat > 0 && !l.comptePat).reduce((a, l) => a + l.montantPat, 0);
  const reductionGenerale = Math.min(Math.round(brut * coef), urssafPatAvant);
  if (reductionGenerale) {
    add({ code: "RG", libelle: "Réduction générale des cotisations patronales", rubrique: "exoneration", organisme: "urssaf", base: brut, tauxSal: null, tauxPat: -Math.round(coef * 1_000_000) / 10_000, montantPat: -reductionGenerale });
  }

  const totalSalarial = L.reduce((a, l) => a + l.montantSal, 0);
  const totalPatronal = L.reduce((a, l) => a + l.montantPat, 0);
  const nonDeductibles = L.filter((l) => l.nonDeductible).reduce((a, l) => a + l.montantSal, 0);
  const netAvantImpot = brut - totalSalarial + variables.indemnitesNonSoumises;
  // Net imposable : part patronale santé réintégrée (CGI art. 83), heures supplémentaires exonérées (CGI art. 81 quater).
  const netImposable = Math.max(0, brut - (totalSalarial - nonDeductibles) + profil.mutuelleEmployeur - (montantHs - reductionHsSalariale));
  const tauxNeutre = profil.tauxPas == null;
  const tauxPas = profil.tauxPas ?? tauxNeutrePas(netImposable, bareme);
  const pas = pct(netImposable, tauxPas);
  const netSocial = brut - totalSalarial + profil.mutuelleEmployeur;
  if (montantHs) avertissements.push("Exonération d'impôt des heures supplémentaires appliquée sans suivi du plafond annuel de 7 500 €.");
  if (reductionGenerale) avertissements.push("Réduction générale calculée sur le mois, sans régularisation annuelle ; imputation simplifiée sur l'URSSAF.");

  return {
    bareme: bareme.annee,
    tauxHoraire,
    remuneration,
    brut,
    montantHs,
    lignes: L,
    totalSalarial,
    totalPatronal,
    netAvantImpot,
    netImposable,
    netSocial,
    pas: { base: netImposable, taux: tauxPas, montant: pas, tauxNeutre },
    netAPayer: netAvantImpot - pas,
    coutEmployeur: brut + totalPatronal + variables.indemnitesNonSoumises,
    allegements: { reductionGenerale, deductionHs, reductionHsSalariale },
    congesAcquis: variables.heuresAbsence > 0 && variables.heuresAbsence >= profil.heuresMensuelles ? 0 : 2.5,
    avertissements,
  };
}

/** Écriture de paie d'un bulletin (journal de paie, date de fin de période). */
export function ecriturePaie(b: Bulletin, opts: { journal: string; date: string; pieceRef: string; nomSalarie: string; periode: string }): Ecriture {
  const lib = (s: string) => `${s} ${opts.periode} — ${opts.nomSalarie}`.slice(0, 200);
  const primes = b.remuneration.filter((r) => r.code === "PRIME").reduce((a, r) => a + r.montant, 0);
  const salaires = b.brut - primes;
  const lignes: LigneEcriture[] = [];
  const debit = (compte: string, montant: Cents, libelle: string) => {
    if (montant > 0) lignes.push({ compte, libelle: lib(libelle), debit: montant, credit: 0 });
    else if (montant < 0) lignes.push({ compte, libelle: lib(libelle), debit: 0, credit: -montant });
  };
  const credit = (compte: string, montant: Cents, libelle: string) => debit(compte, -montant, libelle);

  debit("6411", salaires, "Salaires");
  debit("6413", primes, "Primes");
  const indemnites = b.netAvantImpot - (b.brut - b.totalSalarial);
  debit("6414", indemnites, "Indemnités non soumises");
  // Charges patronales par compte.
  const parCompte = new Map<string, Cents>();
  for (const l of b.lignes) {
    if (!l.montantPat) continue;
    const compte = l.comptePat ?? (l.organisme === "retraite" ? "6453" : l.organisme === "mutuelle" ? "6452" : l.organisme === "prevoyance" ? "6458" : "6451");
    parCompte.set(compte, (parCompte.get(compte) ?? 0) + l.montantPat);
  }
  for (const [compte, montant] of [...parCompte.entries()].sort()) debit(compte, montant, "Charges patronales");
  // Dettes par organisme (parts salariales et patronales).
  const dette = (pred: (l: LigneBulletin) => boolean) => b.lignes.filter(pred).reduce((a, l) => a + l.montantSal + l.montantPat, 0);
  credit("421", b.netAPayer, "Net à payer");
  credit("4421", b.pas.montant, "Prélèvement à la source");
  credit("431", dette((l) => l.organisme === "urssaf"), "URSSAF");
  credit("437", dette((l) => l.organisme !== "urssaf"), "Retraite, prévoyance, santé");
  return { journal: opts.journal, date: opts.date, libelle: lib("Paie"), pieceRef: opts.pieceRef, pieceDate: opts.date, lignes };
}

/** Récapitulatif des charges par organisme (aide à la DSN et aux règlements). */
export function recapitulatifCharges(bulletins: Bulletin[]): { organisme: Organisme; salarial: Cents; patronal: Cents; total: Cents }[] {
  const map = new Map<Organisme, { salarial: Cents; patronal: Cents }>();
  for (const b of bulletins)
    for (const l of b.lignes) {
      const m = map.get(l.organisme) ?? { salarial: 0, patronal: 0 };
      m.salarial += l.montantSal;
      m.patronal += l.montantPat;
      map.set(l.organisme, m);
    }
  return [...map.entries()].map(([organisme, m]) => ({ organisme, ...m, total: m.salarial + m.patronal }));
}

export const LIBELLES_ORGANISMES: Record<Organisme, string> = {
  urssaf: "URSSAF",
  retraite: "Retraite complémentaire (AGIRC-ARRCO)",
  prevoyance: "Prévoyance",
  mutuelle: "Complémentaire santé",
};

/**
 * Contrôle d'un numéro de sécurité sociale (NIR) : 13 caractères + clé de 2
 * chiffres égale à 97 − (NIR mod 97), la Corse (2A / 2B) étant convertie en 19 / 18.
 */
export function validateNir(input: string): { valid: boolean; message?: string } {
  const v = input.replace(/\s/g, "").toUpperCase();
  if (!/^[12][0-9]{2}(0[1-9]|1[0-2]|[2-9][0-9])(2A|2B|[0-9]{2})[0-9]{6}[0-9]{2}$/.test(v)) return { valid: false, message: "Format de NIR invalide (15 caractères)" };
  const corps = v.slice(0, 13).replace("2A", "19").replace("2B", "18");
  const cle = 97 - Number(BigInt(corps) % 97n);
  return cle === Number(v.slice(13)) ? { valid: true } : { valid: false, message: "Clé de contrôle du NIR incorrecte" };
}

export function maskNir(nir: string): string {
  const v = nir.replace(/\s/g, "");
  return `${v.slice(0, 1)} ${v.slice(1, 3)} •• •• ••• ••• ${v.slice(13)}`;
}
