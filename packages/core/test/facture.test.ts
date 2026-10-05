import { describe, expect, it } from "vitest";
import {
  type Facture, computeDeclarationTva, computeTotaux, controlerMentions, echeance, ecritureDeVente,
  ecritureLiquidationTva, generateFacturX, nextNumeroFacture, ttcToHt, validateEcriture,
} from "../src/index.js";

const facture: Facture = {
  type: "facture",
  numero: "F2026-000001",
  dateEmission: "2026-10-01",
  dateEcheance: "2026-10-31",
  categorie: "services",
  vendeur: { nom: "Cabinet Exemple", adresse: "1 rue de la Paix", codePostal: "75002", ville: "Paris", pays: "FR",
    siren: "404833048", tvaIntra: "FR83404833048", formeJuridique: "SAS", capital: "10 000 €", rcs: "Paris" },
  acheteur: { nom: "Client & Fils", adresse: "2 av. Foch", codePostal: "69006", ville: "Lyon", pays: "FR",
    siren: "552100554", professionnel: true },
  tauxPenalitesRetard: "3 fois le taux d'intérêt légal",
  lignes: [
    { designation: "Tenue comptable", quantite: 3, prixUnitaireHT: 33_333, tauxTvaBp: 2000 },
    { designation: "Livre", quantite: 1, prixUnitaireHT: 2_000, tauxTvaBp: 550, remisePct: 10 },
  ],
};

describe("factures", () => {
  it("calcule les totaux par taux", () => {
    const t = computeTotaux(facture);
    expect(t.totalHT).toBe(99_999 + 1_800);
    expect(t.ventilation).toEqual([
      { tauxBp: 2000, baseHT: 99_999, tva: 20_000 },
      { tauxBp: 550, baseHT: 1_800, tva: 99 },
    ]);
    expect(t.totalTTC).toBe(t.totalHT + 20_099);
  });
  it("contrôle les mentions obligatoires", () => {
    expect(controlerMentions(facture).filter((m) => m.bloquant)).toEqual([]);
    const sansSiren = { ...facture, acheteur: { ...facture.acheteur, siren: null } };
    expect(controlerMentions(sansSiren).map((m) => m.code)).toContain("SIREN_CLIENT");
    const avoir = { ...facture, type: "avoir" as const };
    expect(controlerMentions(avoir).map((m) => m.code)).toContain("AVOIR");
  });
  it("numérote de façon continue", () => {
    expect(nextNumeroFacture("F", 2026, 41)).toBe("F2026-000042");
  });
  it("génère une écriture de vente équilibrée, et son inverse pour un avoir", () => {
    const e = ecritureDeVente(facture, "CCLIENT");
    expect(validateEcriture(e)).toEqual([]);
    const a = ecritureDeVente({ ...facture, type: "avoir", factureOrigine: "F2026-000001" }, "CCLIENT");
    expect(a.lignes[0]!.credit).toBe(e.lignes[0]!.debit);
  });
  it("limite les délais de paiement à 60 jours", () => {
    expect(echeance("2026-01-31", 30)).toBe("2026-03-02");
    expect(() => echeance("2026-01-01", 90)).toThrow();
  });
  it("produit un XML Factur-X EN 16931 cohérent et échappé", () => {
    const xml = generateFacturX(facture, { iban: "FR76 3000 6000 0112 3456 7890 189" });
    expect(xml).toContain("urn:cen.eu:en16931:2017");
    expect(xml).toContain("<ram:TypeCode>380</ram:TypeCode>");
    expect(xml).toContain("Client &amp; Fils");
    expect(xml).toContain('<ram:ID schemeID="0002">552100554</ram:ID>');
    expect(xml).toContain("<ram:GrandTotalAmount>1218.98</ram:GrandTotalAmount>");
    expect(xml).toContain("<ram:IBANID>FR7630006000011234567890189</ram:IBANID>");
    expect(xml).toContain("<ram:ActualAmount>2.00</ram:ActualAmount>"); // remise ligne 2
  });
});

describe("TVA", () => {
  it("décompose un TTC", () => {
    expect(ttcToHt(12_000, 2000)).toEqual({ ht: 10_000, tva: 2_000, ttc: 12_000 });
  });
  it("prépare une CA3 et l'écriture de liquidation", () => {
    const vente = ecritureDeVente(facture, "C1");
    const achat = {
      journal: "AC", date: "2026-10-05", libelle: "achat", pieceRef: "A1",
      lignes: [
        { compte: "6064", debit: 10_000, credit: 0 },
        { compte: "44566", debit: 2_000, credit: 0 },
        { compte: "401", debit: 0, credit: 12_000 },
      ],
    };
    const d = computeDeclarationTva([vente, achat], { debut: "2026-10-01", fin: "2026-10-31" });
    expect(d.totalCollectee).toBe(20_099);
    expect(d.collectee[0]).toEqual({ tauxBp: 2000, base: 100_000, taxe: 20_000 });
    expect(d.tvaNetteDue).toBe(18_099);
    const liq = ecritureLiquidationTva(d, "2026-10-31")!;
    expect(validateEcriture(liq)).toEqual([]);
  });
});
