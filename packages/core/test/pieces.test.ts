import { describe, expect, it } from "vitest";
import {
  type ExtractionPiece, type Facture, controlerExtraction, generateFacturX, parseFacturX, propositionEcriture, rapprocherTiers, validateEcriture,
} from "../src/index.js";

const base: ExtractionPiece = {
  typeDocument: "facture_achat",
  emetteur: { nom: "Moulins de Beauce SAS", siren: "775672272", tvaIntra: null, adresse: null, iban: null },
  destinataire: { nom: "Boulangerie Martin", siren: "404833048", tvaIntra: null, adresse: null, iban: null },
  numero: "FA-2290",
  dateFacture: "2026-03-10",
  dateEcheance: "2026-04-09",
  devise: "EUR",
  lignes: [{ designation: "Farine T65", montantHT: 100_000, tauxTvaBp: 550 }, { designation: "Transport", montantHT: 10_000, tauxTvaBp: 2000 }],
  ventilationTva: [{ tauxBp: 550, baseHT: 100_000, tva: 5_500 }, { tauxBp: 2000, baseHT: 10_000, tva: 2_000 }],
  totalHT: 110_000,
  totalTVA: 7_500,
  totalTTC: 117_500,
  compteSuggere: "601",
  justificationCompte: "Matières premières",
  confiance: 0.95,
  remarques: [],
  source: "ia",
};

describe("contrôle des pièces extraites", () => {
  it("accepte une facture cohérente (hors avertissement TVA intracom manquante)", () => {
    const c = controlerExtraction(base, { debut: "2026-01-01", fin: "2026-12-31" });
    expect(c.filter((x) => x.niveau === "bloquant")).toEqual([]);
    expect(c.map((x) => x.code)).toContain("TVA_DEDUCTIBLE");
  });
  it("bloque une incohérence arithmétique ou une date hors exercice", () => {
    const codes = controlerExtraction({ ...base, totalTTC: 120_000, dateFacture: "2025-12-31" }, { debut: "2026-01-01", fin: "2026-12-31" }).map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining(["TOTAUX", "HORS_EXERCICE"]));
  });
  it("détecte une TVA mal calculée et une lecture incertaine", () => {
    const codes = controlerExtraction({ ...base, ventilationTva: [{ tauxBp: 550, baseHT: 100_000, tva: 6_000 }, base.ventilationTva[1]!], totalTVA: 8_000, totalTTC: 118_000, confiance: 0.5 }).map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining(["CALCUL_TVA", "CONFIANCE"]));
  });
});

describe("proposition d'écriture", () => {
  it("ventile l'achat par taux et équilibre l'écriture", () => {
    const e = propositionEcriture(base, { compte: "601", compteAux: "FMOULIN" });
    expect(validateEcriture(e)).toEqual([]);
    expect(e.journal).toBe("AC");
    expect(e.lignes.filter((l) => l.compte === "44566").map((l) => l.debit)).toEqual([5_500, 2_000]);
    expect(e.lignes.at(-1)).toMatchObject({ compte: "401", compteAux: "FMOULIN", credit: 117_500 });
  });
  it("inverse un avoir et utilise 404 / 44562 pour une immobilisation", () => {
    const av = propositionEcriture({ ...base, typeDocument: "avoir_achat" }, { compte: "601", compteAux: "FMOULIN" });
    expect(av.lignes.at(-1)).toMatchObject({ debit: 117_500 });
    const immo = propositionEcriture(base, { compte: "2183", compteAux: "FMOULIN" });
    expect(immo.lignes.map((l) => l.compte)).toEqual(expect.arrayContaining(["44562", "404"]));
  });
  it("comptabilise une vente au journal VE", () => {
    const v = propositionEcriture({ ...base, typeDocument: "facture_vente" }, { compte: "706", compteAux: "CDUPONT" });
    expect(v.journal).toBe("VE");
    expect(v.lignes[0]).toMatchObject({ compte: "706", credit: 100_000 });
    expect(v.lignes.at(-1)).toMatchObject({ compte: "411", debit: 117_500 });
  });
});

describe("rapprochement des tiers", () => {
  const tiers = [
    { id: 1, compteAux: "FMOULIN", nom: "Moulins de Beauce", siren: "775672272", tvaIntra: null, type: "fournisseur" as const },
    { id: 2, compteAux: "FEDF", nom: "EDF Entreprises", siren: null, tvaIntra: null, type: "fournisseur" as const },
  ];
  it("retrouve par SIREN, par nom, ou propose un code", () => {
    expect(rapprocherTiers(base.emetteur, "fournisseur", tiers)).toMatchObject({ methode: "siren", compteAuxPropose: "FMOULIN" });
    expect(rapprocherTiers({ ...base.emetteur, siren: null, nom: "EDF ENTREPRISES SA" }, "fournisseur", tiers)).toMatchObject({ methode: "nom", compteAuxPropose: "FEDF" });
    expect(rapprocherTiers({ ...base.emetteur, siren: null, nom: "Électricité Générale Dupuis" }, "fournisseur", tiers)).toMatchObject({ tiers: null, compteAuxPropose: "FELECTRICITEG" });
  });
});

describe("facture électronique Factur-X", () => {
  it("relit exactement un XML CII et détermine le sens achat / vente", () => {
    const f: Facture = {
      type: "facture", numero: "F2026-000042", dateEmission: "2026-05-02", dateEcheance: "2026-06-01", categorie: "biens",
      vendeur: { nom: "Moulins & Fils", adresse: "1 rue", codePostal: "28000", ville: "Chartres", pays: "FR", siren: "775672272", tvaIntra: "FR20775672272" },
      acheteur: { nom: "Boulangerie Martin", adresse: "12 rue du Four", codePostal: "75006", ville: "Paris", pays: "FR", siren: "404833048", professionnel: true },
      tauxPenalitesRetard: "3 fois le taux légal",
      lignes: [{ designation: "Farine", quantite: 10, prixUnitaireHT: 4_000, tauxTvaBp: 550 }],
    };
    const xml = generateFacturX(f, { iban: "FR7630006000011234567890189" });
    const achat = parseFacturX(xml, "404833048")!;
    expect(achat).toMatchObject({ typeDocument: "facture_achat", numero: "F2026-000042", dateFacture: "2026-05-02", totalHT: 40_000, totalTVA: 2_200, totalTTC: 42_200, confiance: 1, source: "facturx" });
    expect(achat.emetteur).toMatchObject({ nom: "Moulins & Fils", siren: "775672272", iban: "FR7630006000011234567890189" });
    expect(achat.ventilationTva).toEqual([{ tauxBp: 550, baseHT: 40_000, tva: 2_200 }]);
    expect(controlerExtraction(achat).filter((c) => c.niveau !== "info")).toEqual([]);
    expect(parseFacturX(xml, "775672272")!.typeDocument).toBe("facture_vente");
    expect(parseFacturX("<html/>", "1")).toBeNull();
  });
});
