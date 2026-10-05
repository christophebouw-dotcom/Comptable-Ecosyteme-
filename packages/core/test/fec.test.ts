import { describe, expect, it } from "vitest";
import { type FecLigne, controlerFec, encodeLatin9, fecFileName, generateFec } from "../src/index.js";

const lignes: FecLigne[] = [
  { journalCode: "VE", journalLib: "Ventes", ecritureNum: "1", ecritureDate: "2026-02-10", compteNum: "411", compteLib: "Clients",
    compAuxNum: "CDUPONT", compAuxLib: "Dupont SARL", pieceRef: "F1", pieceDate: "2026-02-10", ecritureLib: "Facture F1",
    debit: 120_000, credit: 0, validDate: "2026-02-11" },
  { journalCode: "VE", journalLib: "Ventes", ecritureNum: "1", ecritureDate: "2026-02-10", compteNum: "706", compteLib: "Prestations",
    pieceRef: "F1", pieceDate: "2026-02-10", ecritureLib: "Facture F1 | test\tsep", debit: 0, credit: 100_000, validDate: "2026-02-11" },
  { journalCode: "VE", journalLib: "Ventes", ecritureNum: "1", ecritureDate: "2026-02-10", compteNum: "44571", compteLib: "TVA collectée",
    pieceRef: "F1", pieceDate: "2026-02-10", ecritureLib: "Facture F1", debit: 0, credit: 20_000, validDate: "2026-02-11" },
];

describe("FEC", () => {
  it("nomme le fichier selon l'art. A47 A-1", () => {
    expect(fecFileName("404833048", "2026-12-31")).toBe("404833048FEC20261231.txt");
    expect(() => fecFileName("123", "2026-12-31")).toThrow();
  });
  it("génère 18 zones, des dates AAAAMMJJ et des montants à virgule", () => {
    const out = generateFec(lignes);
    const rows = out.trim().split("\r\n");
    expect(rows).toHaveLength(4);
    expect(rows[0]!.split("\t")).toHaveLength(18);
    const first = rows[1]!.split("\t");
    expect(first[3]).toBe("20260210");
    expect(first[11]).toBe("1200,00");
    expect(rows[2]!.split("\t")).toHaveLength(18); // séparateurs neutralisés
  });
  it("un FEC généré passe le contrôle", () => {
    for (const sep of ["\t", "|"] as const) {
      const c = controlerFec(generateFec(lignes, sep));
      expect(c.anomalies).toEqual([]);
      expect(c.valide).toBe(true);
      expect(c.nbEcritures).toBe(1);
      expect(c.totalDebit).toBe(120_000);
    }
  });
  it("détecte une écriture déséquilibrée et un en-tête invalide", () => {
    const bad = generateFec([lignes[0]!, lignes[1]!]);
    expect(controlerFec(bad).anomalies.some((a) => a.message.includes("déséquilibrée"))).toBe(true);
    expect(controlerFec("a\tb\n1\t2").valide).toBe(false);
  });
  it("encode en ISO 8859-15 (€ = 0xA4)", () => {
    expect([...encodeLatin9("é€œ✓")]).toEqual([0xe9, 0xa4, 0xbd, 0x3f]);
  });
});
