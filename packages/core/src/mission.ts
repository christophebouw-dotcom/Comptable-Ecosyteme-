/**
 * Mission du cabinet et obligations professionnelles.
 *
 * Références :
 *  - Code de déontologie des experts-comptables (décret n° 2012-432), art. 151 :
 *    lettre de mission préalable à toute mission ;
 *  - Code monétaire et financier, art. L561-2 12°, L561-5 à L561-14-2 :
 *    identification du client et du bénéficiaire effectif, vigilance adaptée
 *    au niveau de risque, conservation 5 ans (L561-12) ;
 *  - NPLAB (norme professionnelle anti-blanchiment) de l'Ordre.
 */
import { addMonths } from "./rgpd/conservation.js";

export type TypeMission =
  | "tenue_presentation" // tenue et présentation des comptes annuels
  | "presentation" // présentation des comptes (NP 2300)
  | "examen_limite"
  | "social" // paie et déclarations sociales
  | "juridique" // secrétariat juridique annuel
  | "conseil";

export const LIBELLES_MISSIONS: Record<TypeMission, string> = {
  tenue_presentation: "Tenue et présentation des comptes annuels",
  presentation: "Présentation des comptes annuels (NP 2300)",
  examen_limite: "Examen limité des comptes",
  social: "Établissement des bulletins de paie et déclarations sociales",
  juridique: "Secrétariat juridique annuel",
  conseil: "Mission de conseil",
};

export type NiveauRisque = "faible" | "standard" | "eleve";

/** Périodicité de mise à jour de la connaissance client selon le risque (politique du cabinet, modifiable). */
export const PERIODICITE_REVUE_MOIS: Record<NiveauRisque, number> = { faible: 36, standard: 24, eleve: 12 };

export interface Mission {
  types: TypeMission[];
  lettreSigneeLe: string | null;
  honorairesAnnuelsHT: number | null;
  risqueLcbft: NiveauRisque;
  identiteVerifieeLe: string | null;
  beneficiairesEffectifs: string | null;
  revueLcbftLe: string | null;
  /** Personne politiquement exposée (vigilance renforcée obligatoire, CMF L561-10). */
  ppe: boolean;
}

export interface AlerteMission {
  code: string;
  niveau: "bloquant" | "avertissement";
  message: string;
  reference: string;
}

export function prochaineRevueLcbft(m: Pick<Mission, "revueLcbftLe" | "risqueLcbft" | "ppe">): string | null {
  if (!m.revueLcbftLe) return null;
  return addMonths(m.revueLcbftLe, PERIODICITE_REVUE_MOIS[m.ppe ? "eleve" : m.risqueLcbft]);
}

export function controlerMission(m: Mission | null, aujourdHui: string): AlerteMission[] {
  const out: AlerteMission[] = [];
  if (!m) {
    return [{ code: "MISSION_ABSENTE", niveau: "bloquant", message: "Aucune mission enregistrée pour ce dossier", reference: "Code de déontologie, art. 151" }];
  }
  if (!m.lettreSigneeLe) out.push({ code: "LETTRE_MISSION", niveau: "bloquant", message: "Lettre de mission non signée", reference: "Code de déontologie, art. 151" });
  if (m.types.length === 0) out.push({ code: "TYPE_MISSION", niveau: "avertissement", message: "Nature de la mission non précisée", reference: "Code de déontologie, art. 151" });
  if (!m.identiteVerifieeLe) out.push({ code: "KYC_IDENTITE", niveau: "bloquant", message: "Identité du client non vérifiée", reference: "CMF, art. L561-5" });
  if (!m.beneficiairesEffectifs?.trim()) out.push({ code: "KYC_BE", niveau: "bloquant", message: "Bénéficiaires effectifs non identifiés", reference: "CMF, art. L561-5 et R561-1" });
  const prochaine = prochaineRevueLcbft(m);
  if (!prochaine) out.push({ code: "KYC_REVUE", niveau: "avertissement", message: "Aucune revue de vigilance LCB-FT enregistrée", reference: "CMF, art. L561-6" });
  else if (prochaine < aujourdHui) out.push({ code: "KYC_REVUE", niveau: "avertissement", message: `Revue de vigilance LCB-FT échue depuis le ${prochaine}`, reference: "CMF, art. L561-6" });
  if ((m.ppe || m.risqueLcbft === "eleve") && m.risqueLcbft !== "eleve") {
    out.push({ code: "PPE", niveau: "avertissement", message: "Client PPE : la vigilance doit être renforcée", reference: "CMF, art. L561-10" });
  }
  return out;
}
