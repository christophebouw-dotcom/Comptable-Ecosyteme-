import { describe, expect, it } from "vitest";
import {
  type Ecriture,
  calculerIs,
  cleReleve,
  coefficientDegressif,
  compteAmortissement,
  computeCaf,
  computeRatios,
  computeSig,
  controlerMission,
  controlesRevision,
  dotationPeriode,
  ecritureDotations,
  ecritureIs,
  generateFec,
  jours360,
  motifDepuisLibelle,
  parseFec,
  parseOfx,
  parseReleveCsv,
  planAmortissement,
  prochaineRevueLcbft,
  rapprocher,
  suggererImputation,
  validateEcriture,
} from "../src/index.js";

const ex2026 = { debut: "2026-01-01", fin: "2026-12-31" };

describe("immobilisations", () => {
  it("compte les jours en 30/360", () => {
    expect(jours360("2026-01-01", "2026-12-31")).toBe(360);
    expect(jours360("2026-04-01", "2026-12-31")).toBe(270);
    expect(jours360("2026-02-01", "2026-02-28")).toBe(30);
  });

  it("amortit en linéaire avec prorata temporis", () => {
    const immo = { compte: "2183", libelle: "Ordinateur", dateMiseEnService: "2026-04-01", valeurHT: 300_000, dureeAnnees: 3, mode: "lineaire" as const };
    // 3 000 € / 3 ans = 1 000 €/an ; 9 mois la 1re année = 750 €
    expect(dotationPeriode(immo, ex2026, 0)).toBe(75_000);
    const plan = planAmortissement(immo, ex2026);
    expect(plan.map((p) => p.dotation)).toEqual([75_000, 100_000, 100_000, 25_000]);
    expect(plan.at(-1)!.vnc).toBe(0);
  });

  it("amortit en dégressif avec bascule en linéaire", () => {
    expect(coefficientDegressif(5)).toBe(1.75);
    const immo = { compte: "2154", libelle: "Machine", dateMiseEnService: "2026-01-15", valeurHT: 1_000_000, dureeAnnees: 5, mode: "degressif" as const };
    const plan = planAmortissement(immo, ex2026);
    // Taux 35 % : 3 500 ; 2 275 ; 1 478,75 ; puis linéaire sur 2 ans : 1 373,13 x 2
    expect(plan.map((p) => p.dotation)).toEqual([350_000, 227_500, 147_875, 137_313, 137_312]);
    expect(plan.reduce((a, p) => a + p.dotation, 0)).toBe(1_000_000);
  });

  it("n'amortit pas les terrains et génère une écriture de dotation équilibrée", () => {
    expect(dotationPeriode({ compte: "211", libelle: "Terrain", dateMiseEnService: "2026-01-01", valeurHT: 1, dureeAnnees: 1, mode: "lineaire" }, ex2026, 0)).toBe(0);
    expect(compteAmortissement("2183")).toBe("28183");
    const e = ecritureDotations(
      [
        { immo: { compte: "2183", libelle: "PC", dateMiseEnService: "2026-01-01", valeurHT: 0, dureeAnnees: 3, mode: "lineaire" }, dotation: 10_000 },
        { immo: { compte: "205", libelle: "Logiciel", dateMiseEnService: "2026-01-01", valeurHT: 0, dureeAnnees: 1, mode: "lineaire" }, dotation: 5_000 },
      ],
      "2026-12-31",
    )!;
    expect(validateEcriture(e)).toEqual([]);
    expect(e.lignes.find((l) => l.compte === "2805")?.credit).toBe(5_000);
  });
});

const ventes: Ecriture[] = [
  { journal: "VE", date: "2026-03-01", libelle: "Ventes", pieceRef: "1", lignes: [
    { compte: "411", debit: 1_200_000, credit: 0 }, { compte: "707", debit: 0, credit: 600_000 }, { compte: "706", debit: 0, credit: 400_000 }, { compte: "44571", debit: 0, credit: 200_000 }] },
  { journal: "AC", date: "2026-03-02", libelle: "Achats", pieceRef: "2", lignes: [
    { compte: "607", debit: 300_000, credit: 0 }, { compte: "6132", debit: 100_000, credit: 0 }, { compte: "401", debit: 0, credit: 400_000 }] },
  { journal: "OD", date: "2026-03-31", libelle: "Paie", pieceRef: "3", lignes: [
    { compte: "641", debit: 200_000, credit: 0 }, { compte: "421", debit: 0, credit: 200_000 }] },
  { journal: "OD", date: "2026-12-31", libelle: "Dotation", pieceRef: "4", lignes: [
    { compte: "6811", debit: 50_000, credit: 0 }, { compte: "28183", debit: 0, credit: 50_000 }] },
];

describe("soldes intermédiaires de gestion", () => {
  it("calcule marge, VA, EBE, résultat et CAF", () => {
    const s = computeSig(ventes);
    expect(s.margeCommerciale).toBe(300_000);
    expect(s.productionExercice).toBe(400_000);
    expect(s.valeurAjoutee).toBe(600_000);
    expect(s.excedentBrutExploitation).toBe(400_000);
    expect(s.resultatExploitation).toBe(350_000);
    expect(s.resultatNet).toBe(350_000);
    expect(s.chiffreAffaires).toBe(1_000_000);
    expect(computeCaf(ventes).caf).toBe(400_000);
  });
});

describe("ratios", () => {
  it("exclut les fournisseurs d'immobilisations du délai fournisseurs", () => {
    const e: Ecriture[] = [
      ...ventes,
      { journal: "AC", date: "2026-04-01", libelle: "Four", pieceRef: "I1", lignes: [{ compte: "2154", debit: 5_000_000, credit: 0 }, { compte: "404", debit: 0, credit: 5_000_000 }] },
    ];
    const dpo = computeRatios(e).find((r) => r.code === "DPO")!;
    // 4 000 € dus sur 4 800 € d'achats TTC estimés → 300 jours, sans la dette d'immobilisation
    expect(dpo.valeur).toBe(300);
  });
});

describe("impôt sur les sociétés", () => {
  it("applique 15 % jusqu'à 42 500 € puis 25 %", () => {
    const r = calculerIs({ resultatComptableAvantIs: 10_000_000, eligibleTauxReduit: true, acomptesVerses: 1_000_000 });
    // 42 500 × 15 % = 6 375 ; 57 500 × 25 % = 14 375
    expect(r.impotTauxReduit).toBe(637_500);
    expect(r.impotTauxNormal).toBe(1_437_500);
    expect(r.impotTotal).toBe(2_075_000);
    expect(r.solde).toBe(1_075_000);
    expect(validateEcriture(ecritureIs(r, "2026-12-31")!)).toEqual([]);
  });
  it("intègre réintégrations, déductions et plafonne les déficits", () => {
    const r = calculerIs({ resultatComptableAvantIs: 1_000_000, reintegrations: 200_000, deductions: 100_000, deficitsAnterieurs: 5_000_000, eligibleTauxReduit: false });
    expect(r.resultatFiscal).toBe(0);
    expect(r.impotTotal).toBe(0);
    expect(r.deficitsReportes).toBe(1_100_000);
  });
});

describe("révision", () => {
  it("détecte les soldes anormaux", () => {
    const anomalies: Ecriture[] = [
      ...ventes,
      { journal: "CA", date: "2026-04-01", libelle: "Caisse", pieceRef: "5", lignes: [{ compte: "6064", debit: 5_000, credit: 0 }, { compte: "530", debit: 0, credit: 5_000 }] },
      { journal: "OD", date: "2026-04-02", libelle: "Attente", pieceRef: "6", lignes: [{ compte: "471", debit: 1_000, credit: 0 }, { compte: "512", debit: 0, credit: 1_000 }] },
      { journal: "BQ", date: "2026-04-03", libelle: "Double paiement", pieceRef: "7", lignes: [{ compte: "401", compteAux: "FX", debit: 900_000, credit: 0 }, { compte: "512", debit: 0, credit: 900_000 }] },
    ];
    const codes = controlesRevision(anomalies, { dateArrete: "2026-12-31", brouillards: 2 }).map((a) => a.code);
    expect(codes).toEqual(expect.arrayContaining(["CAISSE_CREDITRICE", "ATTENTE", "FOURNISSEUR_DEBITEUR", "BANQUE_CREDITRICE", "BROUILLARD", "CREANCE_ANCIENNE"]));
    expect(controlesRevision(anomalies, { dateArrete: "2026-12-31" })[0]!.niveau).toBe("bloquant");
  });
});

describe("banque", () => {
  it("lit un CSV de banque française (débit/crédit séparés)", () => {
    const csv = `Compte courant n° 123\nDate;Libellé;Débit;Crédit\n05/01/2026;PRLV SEPA URSSAF;1 234,56;\n06/01/2026;"VIR SEPA CLIENT; DUPONT";;500,00\n`;
    const r = parseReleveCsv(csv);
    expect(r.erreurs).toEqual([]);
    expect(r.lignes).toEqual([
      { date: "2026-01-05", libelle: "PRLV SEPA URSSAF", montant: -123_456 },
      { date: "2026-01-06", libelle: "VIR SEPA CLIENT; DUPONT", montant: 50_000 },
    ]);
  });
  it("lit un OFX", () => {
    const ofx = "<OFX><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260110<TRNAMT>-45.90<FITID>A1<NAME>EDF ENTREPRISES</STMTTRN></OFX>";
    const r = parseOfx(ofx);
    expect(r.lignes[0]).toEqual({ date: "2026-01-10", libelle: "EDF ENTREPRISES", montant: -4_590, ref: "A1" });
    expect(cleReleve(r.lignes[0]!)).toBe("ref:A1");
  });
  it("rapproche par montant et proximité de date", () => {
    const releve = [
      { date: "2026-01-10", libelle: "a", montant: -10_000 },
      { date: "2026-01-12", libelle: "b", montant: -10_000 },
      { date: "2026-01-15", libelle: "c", montant: 5_000 },
    ];
    const mvts = [
      { id: 1, date: "2026-01-11", montant: -10_000, libelle: "" },
      { id: 2, date: "2026-01-09", montant: -10_000, libelle: "" },
      { id: 3, date: "2026-03-01", montant: 5_000, libelle: "" },
    ];
    const r = rapprocher(releve, mvts);
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.releveIndex === 0)?.mouvementId).toBe(2);
    expect(r.find((x) => x.releveIndex === 1)?.mouvementId).toBe(1);
  });
  it("suggère une imputation et apprend un motif", () => {
    expect(suggererImputation("PRLV SEPA URSSAF IDF", [])?.compte).toBe("431");
    expect(suggererImputation("CB BOULANGERIE DU COIN 12/01", [{ motif: "boulangerie coin", compte: "625" }])?.compte).toBe("625");
    expect(motifDepuisLibelle("PRLV SEPA EDF ENTREPRISES REF 4589 12/01/26")).toBe("edf entreprises");
  });
});

describe("reprise de FEC", () => {
  it("relit un FEC généré et regroupe les écritures", () => {
    const fec = generateFec([
      { journalCode: "VE", journalLib: "Ventes", ecritureNum: "12", ecritureDate: "2026-02-01", compteNum: "411", compteLib: "Clients", compAuxNum: "CDUP", compAuxLib: "Dupont", pieceRef: "F1", pieceDate: "2026-02-01", ecritureLib: "Vente", debit: 1200, credit: 0, validDate: "2026-02-02" },
      { journalCode: "VE", journalLib: "Ventes", ecritureNum: "12", ecritureDate: "2026-02-01", compteNum: "706", compteLib: "Prestations", pieceRef: "F1", pieceDate: "2026-02-01", ecritureLib: "Vente", debit: 0, credit: 1200, validDate: "2026-02-02" },
    ]);
    const e = parseFec(fec);
    expect(e).toHaveLength(1);
    expect(e[0]!.lignes).toHaveLength(2);
    expect(e[0]!.lignes[0]).toMatchObject({ compte: "411", compteAux: "CDUP", compteAuxLib: "Dupont", debit: 1200 });
  });
});

describe("mission et LCB-FT", () => {
  it("exige lettre de mission, identification et bénéficiaires effectifs", () => {
    expect(controlerMission(null, "2026-10-05")[0]!.code).toBe("MISSION_ABSENTE");
    const codes = controlerMission(
      { types: ["tenue_presentation"], lettreSigneeLe: null, honorairesAnnuelsHT: null, risqueLcbft: "standard", identiteVerifieeLe: null, beneficiairesEffectifs: "", revueLcbftLe: "2023-01-01", ppe: false },
      "2026-10-05",
    ).map((a) => a.code);
    expect(codes).toEqual(expect.arrayContaining(["LETTRE_MISSION", "KYC_IDENTITE", "KYC_BE", "KYC_REVUE"]));
  });
  it("adapte la périodicité de revue au risque", () => {
    expect(prochaineRevueLcbft({ revueLcbftLe: "2026-01-01", risqueLcbft: "faible", ppe: false })).toBe("2029-01-01");
    expect(prochaineRevueLcbft({ revueLcbftLe: "2026-01-01", risqueLcbft: "faible", ppe: true })).toBe("2027-01-01");
  });
});
