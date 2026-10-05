/**
 * Calendrier fiscal indicatif d'un dossier.
 *
 * Les dates exactes dépendent du département, de la forme juridique et du
 * SIREN (CA3 entre le 15 et le 24 du mois) : elles sont données à titre
 * indicatif et doivent être confirmées dans l'espace professionnel
 * impots.gouv.fr.
 */
import type { RegimeTva } from "./tva.js";

export interface Echeance {
  date: string;
  code: string;
  libelle: string;
  categorie: "tva" | "is" | "liasse" | "cfe" | "social" | "autre";
}

export interface ProfilFiscal {
  regimeTva: RegimeTva;
  impot: "IS" | "IR";
  /** Date de clôture de l'exercice (ISO). */
  dateCloture: string;
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Échéances de l'année civile donnée. */
export function calendrierFiscal(profil: ProfilFiscal, annee: number): Echeance[] {
  const out: Echeance[] = [];
  switch (profil.regimeTva) {
    case "reel_normal_mensuel":
      for (let m = 1; m <= 12; m++) {
        out.push({ date: iso(annee, m, 19), code: "CA3", libelle: `Déclaration CA3 (opérations de ${m === 1 ? 12 : m - 1}/${m === 1 ? annee - 1 : annee})`, categorie: "tva" });
      }
      break;
    case "reel_normal_trimestriel":
      for (const m of [1, 4, 7, 10]) {
        out.push({ date: iso(annee, m, 19), code: "CA3", libelle: "Déclaration CA3 trimestrielle", categorie: "tva" });
      }
      break;
    case "reel_simplifie":
      out.push({ date: iso(annee, 5, 5), code: "CA12", libelle: `Déclaration annuelle CA12 (exercice ${annee - 1})`, categorie: "tva" });
      out.push({ date: iso(annee, 7, 15), code: "ACOMPTE_TVA", libelle: "1er acompte de TVA (55 %)", categorie: "tva" });
      out.push({ date: iso(annee, 12, 15), code: "ACOMPTE_TVA", libelle: "2e acompte de TVA (40 %)", categorie: "tva" });
      break;
    case "franchise":
      break;
  }

  const clotureCivile = profil.dateCloture.slice(5) === "12-31";
  const moisCloture = Number(profil.dateCloture.slice(5, 7));
  /** Mois situé n mois après la clôture (1-12). */
  const apresCloture = (n: number) => ((moisCloture - 1 + n) % 12) + 1;
  if (profil.impot === "IS") {
    for (const m of [3, 6, 9, 12]) {
      out.push({ date: iso(annee, m, 15), code: "IS_ACOMPTE", libelle: "Acompte d'impôt sur les sociétés", categorie: "is" });
    }
    out.push({
      date: clotureCivile ? iso(annee, 5, 15) : iso(annee, apresCloture(4), 15),
      code: "IS_SOLDE",
      libelle: "Relevé de solde d'IS (2572)",
      categorie: "is",
    });
  }
  if (clotureCivile) {
    out.push({
      date: iso(annee, 5, 20),
      code: "LIASSE",
      libelle: `Liasse fiscale ${profil.impot === "IS" ? "2065" : "2031/2035"} (télédéclaration, exercice ${annee - 1})`,
      categorie: "liasse",
    });
  } else {
    // Exercice non calé sur l'année civile : 3 mois après la clôture (+15 jours en EDI).
    out.push({ date: iso(annee, apresCloture(3), 15), code: "LIASSE", libelle: "Liasse fiscale (3 mois après la clôture)", categorie: "liasse" });
  }
  out.push({ date: iso(annee, 12, 15), code: "CFE", libelle: "Cotisation foncière des entreprises (CFE)", categorie: "cfe" });
  out.push({ date: iso(annee, 5, 5), code: "DAS2", libelle: "Déclaration des honoraires (DAS2)", categorie: "autre" });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function prochainesEcheances(profil: ProfilFiscal, aujourdHui: string, nb = 5): Echeance[] {
  const y = Number(aujourdHui.slice(0, 4));
  return [...calendrierFiscal(profil, y), ...calendrierFiscal(profil, y + 1)]
    .filter((e) => e.date >= aujourdHui.slice(0, 10))
    .slice(0, nb);
}
