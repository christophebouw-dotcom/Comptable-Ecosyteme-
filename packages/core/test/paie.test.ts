import { describe, expect, it } from "vitest";
import {
  BAREME_2026,
  ajouterJours,
  calculerBulletin,
  coefficientReductionGenerale,
  contrepartieParDefaut,
  controlerRegularisation,
  ecriturePaie,
  ecritureRegularisation,
  joursInclus,
  montantRegularisation,
  prorataApresCloture,
  recapitulatifCharges,
  suggererRegularisations,
  tauxNeutrePas,
  totals,
  validateEcriture,
  type Ecriture,
  type ElementsVariables,
  type ProfilPaie,
} from "../src/index.js";

const SANS_VARIABLES: ElementsVariables = { heuresSup25: 0, heuresSup50: 0, primes: 0, heuresAbsence: 0, indemnitesNonSoumises: 0 };
const EMPLOYEUR = { effectif: 5, tauxAtMp: 2.08, tauxVersementMobilite: 0 };
const profil = (p: Partial<ProfilPaie> = {}): ProfilPaie => ({
  statut: "non_cadre", salaireBase: 250_000, heuresMensuelles: 151.67, tauxPas: 4.5, mutuelleSalarie: 2_500, mutuelleEmployeur: 2_500, ...p,
});

describe("régularisations de fin d'exercice", () => {
  it("calcule le prorata d'une charge constatée d'avance au jour près", () => {
    expect(joursInclus("2026-01-01", "2026-12-31")).toBe(365);
    expect(ajouterJours("2026-12-31", 1)).toBe("2027-01-01");
    // Assurance annuelle de 1 200 € payée pour la période du 1er octobre au 30 septembre : 273 jours sur 365 après la clôture.
    expect(prorataApresCloture(120_000, { debut: "2026-10-01", fin: "2027-09-30" }, "2026-12-31")).toBe(Math.round((120_000 * 273) / 365));
    expect(prorataApresCloture(120_000, { debut: "2026-01-01", fin: "2026-12-31" }, "2026-12-31")).toBe(0);
    expect(prorataApresCloture(120_000, { debut: "2027-01-01", fin: "2027-03-31" }, "2026-12-31")).toBe(120_000);
  });

  it("génère une facture non parvenue équilibrée avec TVA sur FNP", () => {
    const e = ecritureRegularisation({ type: "fnp", libelle: "Électricité décembre", compte: "6061", montantHT: 45_000, tauxTvaBp: 2000 }, "2026-12-31", "REG-1")!;
    expect(e.lignes).toEqual([
      expect.objectContaining({ compte: "6061", debit: 45_000 }),
      expect.objectContaining({ compte: "44586", debit: 9_000 }),
      expect.objectContaining({ compte: "408", credit: 54_000 }),
    ]);
    expect(validateEcriture(e, { debut: "2026-01-01", fin: "2026-12-31" })).toEqual([]);
  });

  it("génère FAE, PCA, charge à payer, produit à recevoir et dépréciation avec les bons comptes", () => {
    const fae = ecritureRegularisation({ type: "fae", libelle: "Livraison 28/12", compte: "706", montantHT: 10_000, tauxTvaBp: 2000 }, "2026-12-31", "R")!;
    expect(fae.lignes.map((l) => [l.compte, l.debit, l.credit])).toEqual([["418", 12_000, 0], ["706", 0, 10_000], ["44587", 0, 2_000]]);
    const pca = ecritureRegularisation({ type: "pca", libelle: "Abonnement", compte: "706", montantHT: 36_500, periode: { debut: "2026-12-01", fin: "2027-11-30" } }, "2026-12-31", "R")!;
    expect(pca.lignes.map((l) => [l.compte, l.debit, l.credit])).toEqual([["706", 33_400, 0], ["487", 0, 33_400]]);
    expect(contrepartieParDefaut("cap", "6412")).toBe("4282");
    expect(contrepartieParDefaut("cap", "6451")).toBe("4386");
    expect(contrepartieParDefaut("cap", "6351")).toBe("4486");
    expect(contrepartieParDefaut("par", "768")).toBe("4687");
    expect(montantRegularisation({ type: "depreciation_client", libelle: "Client X", compte: "", montantHT: 100_000, tauxDepreciationBp: 5_000 }, "2026-12-31")).toBe(50_000);
    const dep = ecritureRegularisation({ type: "depreciation_client", libelle: "Client X", compte: "", montantHT: 100_000, tauxDepreciationBp: 5_000 }, "2026-12-31", "R")!;
    expect(dep.lignes.map((l) => [l.compte, l.debit, l.credit])).toEqual([["6817", 50_000, 0], ["491", 0, 50_000]]);
  });

  it("refuse les régularisations incohérentes", () => {
    expect(controlerRegularisation({ type: "fnp", libelle: "x", compte: "706", montantHT: 100 }, "2026-12-31")).toContainEqual(expect.objectContaining({ champ: "compte" }));
    expect(controlerRegularisation({ type: "cca", libelle: "x", compte: "616", montantHT: 100, periode: { debut: "2026-01-01", fin: "2026-06-30" } }, "2026-12-31")).toContainEqual(expect.objectContaining({ champ: "periode" }));
    expect(controlerRegularisation({ type: "fae", libelle: "x", compte: "706", montantHT: 100, tauxTvaBp: 1900 }, "2026-12-31")).toContainEqual(expect.objectContaining({ champ: "tauxTvaBp" }));
  });

  it("repère un fournisseur mensuel sans facture de décembre et une assurance payée en fin d'année", () => {
    const facture = (m: string, ht: number): Ecriture => ({
      journal: "AC", date: `2026-${m}-28`, libelle: `EDF ${m}`, pieceRef: `EDF-${m}`,
      lignes: [{ compte: "6061", debit: ht, credit: 0 }, { compte: "44566", debit: ht / 5, credit: 0 }, { compte: "401", compteAux: "FEDF", debit: 0, credit: ht * 1.2 }],
    });
    const assurance: Ecriture = {
      journal: "AC", date: "2026-10-01", libelle: "Assurance multirisque", pieceRef: "AXA-26",
      lignes: [{ compte: "616", debit: 120_000, credit: 0 }, { compte: "401", compteAux: "FAXA", debit: 0, credit: 120_000 }],
    };
    const s = suggererRegularisations([facture("09", 40_000), facture("10", 50_000), facture("11", 60_000), assurance], { debut: "2026-01-01", fin: "2026-12-31" });
    const fnp = s.find((x) => x.type === "fnp")!;
    expect(fnp).toMatchObject({ compte: "6061", compteAux: "FEDF", montantHT: 50_000, tauxTvaBp: 2000, cle: "fnp:FEDF:2026-12" });
    const cca = s.find((x) => x.type === "cca")!;
    expect(cca).toMatchObject({ compte: "616", periode: { debut: "2026-10-01", fin: "2027-09-30" } });
    // Fournisseur déjà facturé en décembre : rien à proposer.
    expect(suggererRegularisations([facture("10", 1), facture("11", 1), facture("12", 1)], { debut: "2026-01-01", fin: "2026-12-31" }).filter((x) => x.type === "fnp")).toEqual([]);
  });
});

describe("paie", () => {
  it("calcule un bulletin non-cadre cohérent (brut, tranches, CSG, net, coût)", () => {
    const b = calculerBulletin(profil(), SANS_VARIABLES, EMPLOYEUR);
    expect(b.brut).toBe(250_000);
    const ligne = (code: string) => b.lignes.find((l) => l.code === code)!;
    expect(ligne("VPLAF")).toMatchObject({ base: 250_000, montantSal: 17_250, montantPat: 21_375 });
    expect(ligne("RCT1")).toMatchObject({ montantSal: 7_875, montantPat: 11_800 });
    expect(b.lignes.find((l) => l.code === "RCT2")).toBeUndefined();
    // 2 500 € ≤ 2,25 SMIC : taux réduit maladie ; ≤ 3,3 SMIC : taux réduit allocations familiales.
    expect(ligne("MAL").tauxPat).toBe(7);
    expect(ligne("AF").tauxPat).toBe(3.45);
    // Assiette CSG : 98,25 % du brut + part patronale de la complémentaire santé.
    expect(ligne("CSGD").base).toBe(245_625 + 2_500);
    expect(b.netAvantImpot).toBe(b.brut - b.totalSalarial);
    expect(b.netAPayer).toBe(b.netAvantImpot - b.pas.montant);
    expect(b.pas.montant).toBe(Math.round((b.netImposable * 4.5) / 100));
    expect(b.coutEmployeur).toBe(b.brut + b.totalPatronal);
    expect(b.netAvantImpot).toBeGreaterThan(190_000);
    expect(b.netAvantImpot).toBeLessThan(200_000);
    expect(b.allegements.reductionGenerale).toBeGreaterThan(0);
  });

  it("applique les tranches 2, CET et APEC pour un cadre au-dessus du plafond", () => {
    const b = calculerBulletin(profil({ statut: "cadre", salaireBase: 600_000 }), SANS_VARIABLES, EMPLOYEUR);
    const ligne = (code: string) => b.lignes.find((l) => l.code === code)!;
    expect(ligne("VPLAF").base).toBe(BAREME_2026.pmss);
    expect(ligne("RCT2").base).toBe(600_000 - BAREME_2026.pmss);
    expect(ligne("CET").base).toBe(600_000);
    expect(ligne("APEC")).toBeDefined();
    expect(ligne("PREV").montantPat).toBe(Math.round(BAREME_2026.pmss * 0.015));
    expect(ligne("MAL").tauxPat).toBe(13);
    expect(b.allegements.reductionGenerale).toBe(0);
  });

  it("majore les heures supplémentaires et applique réduction salariale et exonération d'impôt", () => {
    const b = calculerBulletin(profil(), { ...SANS_VARIABLES, heuresSup25: 8, heuresSup50: 2 }, EMPLOYEUR);
    const th = Math.round(250_000 / 151.67);
    expect(b.montantHs).toBe(Math.round(th * 1.25 * 8) + Math.round(th * 1.5 * 2));
    expect(b.allegements.reductionHsSalariale).toBe(Math.round((b.montantHs * 11.31) / 100));
    expect(b.allegements.deductionHs).toBe(10 * 150);
    const sansHs = calculerBulletin(profil(), SANS_VARIABLES, EMPLOYEUR);
    expect(Math.abs(b.netImposable - sansHs.netImposable)).toBeLessThan(b.montantHs * 0.15);
  });

  it("retient les absences et ajoute les indemnités non soumises au net", () => {
    const b = calculerBulletin(profil(), { ...SANS_VARIABLES, heuresAbsence: 7, indemnitesNonSoumises: 3_000 }, EMPLOYEUR);
    expect(b.brut).toBe(250_000 - Math.round((250_000 * 7) / 151.67));
    expect(b.netAvantImpot).toBe(b.brut - b.totalSalarial + 3_000);
  });

  it("réduction générale maximale au SMIC, nulle à 3 SMIC", () => {
    const smic = Math.round(BAREME_2026.smicHoraire * 151.67);
    expect(coefficientReductionGenerale(smic, smic, 5)).toBeCloseTo(0.3973, 4);
    expect(coefficientReductionGenerale(smic, smic, 60)).toBeCloseTo(0.4013, 4);
    expect(coefficientReductionGenerale(3 * smic, smic, 5)).toBe(0);
    expect(coefficientReductionGenerale(2 * smic, smic, 5)).toBeLessThan(0.1);
  });

  it("applique le taux neutre quand aucun taux personnalisé n'est connu", () => {
    expect(tauxNeutrePas(150_000)).toBe(0);
    expect(tauxNeutrePas(200_000)).toBe(2.9);
    const b = calculerBulletin(profil({ tauxPas: null }), SANS_VARIABLES, EMPLOYEUR);
    expect(b.pas.tauxNeutre).toBe(true);
    expect(b.pas.taux).toBe(tauxNeutrePas(b.netImposable));
  });

  it("produit une écriture de paie équilibrée et un récapitulatif par organisme", () => {
    const b = calculerBulletin(profil({ statut: "cadre", salaireBase: 450_000 }), { ...SANS_VARIABLES, primes: 50_000, heuresSup25: 4, indemnitesNonSoumises: 2_000 }, EMPLOYEUR);
    const e = ecriturePaie(b, { journal: "PA", date: "2026-03-31", pieceRef: "PAIE-202603-001", nomSalarie: "A. Durand", periode: "2026-03" });
    expect(validateEcriture(e, { debut: "2026-01-01", fin: "2026-12-31" })).toEqual([]);
    const t = totals(e.lignes);
    expect(t.debit).toBe(b.coutEmployeur);
    expect(e.lignes.find((l) => l.compte === "421")!.credit).toBe(b.netAPayer);
    expect(e.lignes.find((l) => l.compte === "6413")!.debit).toBe(50_000);
    const recap = recapitulatifCharges([b]);
    expect(recap.reduce((a, r) => a + r.total, 0)).toBe(b.totalSalarial + b.totalPatronal);
  });
});

describe("NIR", () => {
  it("contrôle la clé et masque le numéro", async () => {
    const { validateNir, maskNir } = await import("../src/index.js");
    const corps = "1850775123456";
    const cle = String(97 - Number(BigInt(corps) % 97n)).padStart(2, "0");
    expect(validateNir(`${corps}${cle}`).valid).toBe(true);
    expect(validateNir(`${corps}00`).valid).toBe(cle === "00");
    expect(validateNir("12345").valid).toBe(false);
    const corse = "285072A123456";
    const cleCorse = String(97 - Number(BigInt("2850719123456") % 97n)).padStart(2, "0");
    expect(validateNir(`${corse}${cleCorse}`).valid).toBe(true);
    expect(maskNir(`${corps}${cle}`)).toBe(`1 85 •• •• ••• ••• ${cle}`);
  });
});
