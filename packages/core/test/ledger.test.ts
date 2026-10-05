import { describe, expect, it } from "vitest";
import {
  type Ecriture, canLettrer, computeANouveaux, computeBalance, computeBilan, computeCompteResultat,
  computeGrandLivre, contrePassation, nextLettrage, validateEcriture,
} from "../src/index.js";

const exercice = { debut: "2026-01-01", fin: "2026-12-31" };

const capital: Ecriture = {
  journal: "BQ", date: "2026-01-02", libelle: "Apport en capital", pieceRef: "STATUTS",
  lignes: [{ compte: "512", debit: 1_000_000, credit: 0 }, { compte: "1013", debit: 0, credit: 1_000_000 }],
};
const vente: Ecriture = {
  journal: "VE", date: "2026-02-10", libelle: "Facture F1", pieceRef: "F1",
  lignes: [
    { compte: "411", compteAux: "CDUPONT", debit: 120_000, credit: 0 },
    { compte: "706", debit: 0, credit: 100_000 },
    { compte: "44571", debit: 0, credit: 20_000, tauxTva: 2000 },
  ],
};
const achat: Ecriture = {
  journal: "AC", date: "2026-03-01", libelle: "Loyer mars", pieceRef: "L03",
  lignes: [
    { compte: "6132", debit: 50_000, credit: 0 },
    { compte: "44566", debit: 10_000, credit: 0 },
    { compte: "401", compteAux: "FBAILLEUR", debit: 0, credit: 60_000 },
  ],
};
const ordi: Ecriture = {
  journal: "AC", date: "2026-04-01", libelle: "Ordinateur", pieceRef: "A04",
  lignes: [
    { compte: "2183", debit: 200_000, credit: 0 },
    { compte: "44562", debit: 40_000, credit: 0 },
    { compte: "512", debit: 0, credit: 240_000 },
  ],
};
const amort: Ecriture = {
  journal: "OD", date: "2026-12-31", libelle: "Dotation", pieceRef: "INV",
  lignes: [{ compte: "6811", debit: 50_000, credit: 0 }, { compte: "28183", debit: 0, credit: 50_000 }],
};
const all = [capital, vente, achat, ordi, amort];

describe("validation des écritures", () => {
  it("accepte une écriture équilibrée", () => {
    expect(validateEcriture(vente, exercice)).toEqual([]);
  });
  it("détecte déséquilibre, pièce manquante, date hors exercice et double sens", () => {
    const bad: Ecriture = {
      journal: "VE", date: "2027-01-05", libelle: "x", pieceRef: " ",
      lignes: [{ compte: "411", debit: 100, credit: 100 }, { compte: "706", debit: 0, credit: 50 }],
    };
    const codes = validateEcriture(bad, exercice).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["DESEQUILIBRE", "PIECE", "HORS_EXERCICE", "DOUBLE_SENS"]));
  });
  it("refuse les montants non entiers et les comptes invalides", () => {
    const bad: Ecriture = {
      journal: "OD", date: "2026-05-01", libelle: "x", pieceRef: "p",
      lignes: [{ compte: "9XX", debit: 10.5, credit: 0 }, { compte: "706", debit: 0, credit: 10.5 }],
    };
    const codes = validateEcriture(bad).map((i) => i.code);
    expect(codes).toContain("COMPTE");
    expect(codes).toContain("MONTANT");
  });
  it("génère une contre-passation qui annule l'écriture", () => {
    const ext = contrePassation(vente, "2026-02-11", "erreur");
    expect(validateEcriture(ext)).toEqual([]);
    expect(computeBalance([vente, ext]).lignes.every((l) => l.soldeDebiteur === 0 && l.soldeCrediteur === 0)).toBe(true);
  });
});

describe("états", () => {
  it("produit une balance équilibrée", () => {
    const b = computeBalance(all);
    expect(b.equilibree).toBe(true);
    expect(b.totalSoldeDebiteur).toBe(b.totalSoldeCrediteur);
    expect(b.lignes.find((l) => l.compte === "512")?.soldeDebiteur).toBe(760_000);
  });
  it("calcule un grand livre avec solde progressif", () => {
    const gl = computeGrandLivre(all, { compte: "512" });
    expect(gl).toHaveLength(1);
    expect(gl[0]!.mouvements.map((m) => m.solde)).toEqual([1_000_000, 760_000]);
  });
  it("calcule le résultat", () => {
    const r = computeCompteResultat(all);
    expect(r.produitsExploitation).toBe(100_000);
    expect(r.chargesExploitation).toBe(100_000);
    expect(r.resultatNet).toBe(0);
  });
  it("produit un bilan équilibré avec amortissements en déduction", () => {
    const b = computeBilan(all);
    expect(b.equilibre).toBe(true);
    expect(b.actif.actifImmobiliseNet).toBe(150_000);
    expect(b.passif.dettes).toBe(80_000); // fournisseur 60 000 + TVA collectée 20 000
  });
  it("génère des à-nouveaux équilibrés avec le résultat en 120/129", () => {
    const profit: Ecriture = {
      journal: "VE", date: "2026-06-01", libelle: "Vente", pieceRef: "F2",
      lignes: [{ compte: "512", debit: 30_000, credit: 0 }, { compte: "706", debit: 0, credit: 30_000 }],
    };
    const an = computeANouveaux([...all, profit], "2027-01-01")!;
    expect(validateEcriture(an)).toEqual([]);
    expect(an.lignes.find((l) => l.compte === "120")?.credit).toBe(30_000);
    expect(an.lignes.some((l) => l.compte.startsWith("6") || l.compte.startsWith("7"))).toBe(false);
    expect(an.lignes.find((l) => l.compte === "411")?.compteAux).toBe("CDUPONT");
  });
});

describe("lettrage", () => {
  it("vérifie que les lignes sont soldées", () => {
    expect(canLettrer([{ compte: "411", debit: 100, credit: 0 }, { compte: "411", debit: 0, credit: 100 }])).toEqual([]);
    expect(canLettrer([{ compte: "411", debit: 100, credit: 0 }, { compte: "411", debit: 0, credit: 90 }])).toHaveLength(1);
  });
  it("incrémente les codes", () => {
    expect(nextLettrage(null)).toBe("A");
    expect(nextLettrage("A")).toBe("B");
    expect(nextLettrage("Z")).toBe("AA");
    expect(nextLettrage("AZ")).toBe("BA");
  });
});
