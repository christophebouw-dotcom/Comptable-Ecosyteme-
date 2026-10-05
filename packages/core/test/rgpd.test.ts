import { describe, expect, it } from "vitest";
import {
  REGISTRE_PAR_DEFAUT, REGLES_CONSERVATION, addMonths, analyserEffacement, anonymiserChamps, calendrierFiscal,
  delaiReponse, echeanceNotification, evaluerViolation, masquerEmail, modeleReponse, urgence,
} from "../src/index.js";

describe("conservation", () => {
  it("ajoute des mois en bornant au dernier jour", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-03-15", 120)).toBe("2036-03-15");
  });
  it("conserve les pièces comptables 10 ans (C. com. L123-22)", () => {
    expect(REGLES_CONSERVATION.pieces_comptables.dureeMois).toBe(120);
    expect(REGLES_CONSERVATION.pieces_comptables.baseLegale).toContain("L123-22");
  });
});

describe("droits des personnes", () => {
  it("calcule le délai d'un mois prolongeable de deux (art. 12.3)", () => {
    expect(delaiReponse("2026-01-31")).toBe("2026-02-28");
    expect(delaiReponse("2026-01-15", true)).toBe("2026-04-15");
    expect(urgence("2026-02-01", "2026-02-03")).toBe("depassee");
    expect(urgence("2026-02-10", "2026-02-07")).toBe("urgent");
  });
  it("refuse l'effacement des pièces comptables sous obligation légale (art. 17.3.b)", () => {
    const decisions = analyserEffacement(
      [
        { categorie: "factures", description: "Factures 2024", dateDepart: "2024-12-31" },
        { categorie: "donnees_prospects", description: "Newsletter", dateDepart: "2025-01-01", fondeSurConsentement: true },
        { categorie: "donnees_prospects", description: "Ancien prospect", dateDepart: "2020-01-01" },
      ],
      "2026-10-05",
    );
    expect(decisions.map((d) => d.decision)).toEqual(["conserver_limiter", "effacer", "effacer"]);
    expect(decisions[0]!.effacementPrevuLe).toBe("2034-12-31");
    expect(modeleReponse("effacement", "Durand", decisions)).toContain("2034-12-31");
  });
});

describe("violations", () => {
  it("évalue la gravité selon la méthode ENISA", () => {
    const faible = evaluerViolation(1, 0.25, { confidentialite: "limitee", integrite: "aucune", disponibilite: "aucune", malveillance: false });
    expect(faible.niveau).toBe("faible");
    expect(faible.notificationCnil).toBe(false);
    const grave = evaluerViolation(3, 1, { confidentialite: "large", integrite: "aucune", disponibilite: "aucune", malveillance: true });
    expect(grave.niveau).toBe("tres_eleve");
    expect(grave.informationPersonnes).toBe(true);
  });
  it("fixe l'échéance de notification à 72 h", () => {
    expect(echeanceNotification("2026-10-05T10:00:00.000Z")).toBe("2026-10-08T10:00:00.000Z");
  });
});

describe("registre & minimisation", () => {
  it("documente les traitements du cabinet avec une base légale", () => {
    expect(REGISTRE_PAR_DEFAUT.length).toBeGreaterThanOrEqual(5);
    for (const t of REGISTRE_PAR_DEFAUT) {
      expect(t.finalites.length).toBeGreaterThan(0);
      expect(t.conservation.length).toBeGreaterThan(0);
    }
  });
  it("masque et anonymise", () => {
    expect(masquerEmail("jean.dupont@exemple.fr")).toBe("je*********@exemple.fr");
    expect(anonymiserChamps({ nom: "Dupont", ville: "Lyon" }, ["nom"])).toEqual({ nom: "[anonymisé]", ville: "Lyon" });
  });
});

describe("calendrier fiscal", () => {
  it("génère les échéances d'une SAS au réel normal", () => {
    const cal = calendrierFiscal({ regimeTva: "reel_normal_mensuel", impot: "IS", dateCloture: "2026-12-31" }, 2026);
    expect(cal.filter((e) => e.code === "CA3")).toHaveLength(12);
    expect(cal.filter((e) => e.code === "IS_ACOMPTE")).toHaveLength(4);
    expect(cal.find((e) => e.code === "LIASSE")?.date).toBe("2026-05-20");
  });
  it("décale la liasse pour un exercice non civil", () => {
    const cal = calendrierFiscal({ regimeTva: "franchise", impot: "IS", dateCloture: "2026-09-30" }, 2026);
    expect(cal.find((e) => e.code === "LIASSE")?.date).toBe("2026-12-15");
  });
});
