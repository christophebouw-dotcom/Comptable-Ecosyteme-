/**
 * Violations de données à caractère personnel (RGPD art. 33 et 34).
 *
 * L'évaluation de la gravité suit la méthode de l'ENISA (« Recommendations for
 * a methodology of the assessment of severity of personal data breaches »,
 * 2013) : Gravité = DPC × EI + CB.
 */

/** Contexte de traitement des données (Data Processing Context), 1 à 4. */
export type ContexteDonnees = 1 | 2 | 3 | 4;

export const CONTEXTES: Record<ContexteDonnees, string> = {
  1: "Données simples (identité, coordonnées professionnelles)",
  2: "Données comportementales ou de contact personnel",
  3: "Données financières (IBAN, revenus, situation fiscale)",
  4: "Données sensibles (santé, NIR, données art. 9 et 10)",
};

/** Facilité d'identification (Ease of Identification), 0,25 à 1. */
export type FaciliteIdentification = 0.25 | 0.5 | 0.75 | 1;

export interface CirconstancesViolation {
  /** Perte de confidentialité (accès / divulgation non autorisés). */
  confidentialite: "aucune" | "limitee" | "large";
  /** Perte d'intégrité (altération). */
  integrite: "aucune" | "recuperable" | "irrecuperable";
  /** Perte de disponibilité. */
  disponibilite: "aucune" | "temporaire" | "definitive";
  /** Intention malveillante (vol, piratage). */
  malveillance: boolean;
}

export type NiveauGravite = "faible" | "moyen" | "eleve" | "tres_eleve";

export interface EvaluationViolation {
  score: number;
  niveau: NiveauGravite;
  notificationCnil: boolean;
  informationPersonnes: boolean;
  justification: string;
}

function scoreCirconstances(c: CirconstancesViolation): number {
  let cb = 0;
  cb += { aucune: 0, limitee: 0.25, large: 0.5 }[c.confidentialite];
  cb += { aucune: 0, recuperable: 0.25, irrecuperable: 0.5 }[c.integrite];
  cb += { aucune: 0, temporaire: 0.25, definitive: 0.5 }[c.disponibilite];
  if (c.malveillance) cb += 0.5;
  return cb;
}

export function evaluerViolation(
  dpc: ContexteDonnees,
  ei: FaciliteIdentification,
  c: CirconstancesViolation,
): EvaluationViolation {
  const score = Math.round((dpc * ei + scoreCirconstances(c)) * 100) / 100;
  const niveau: NiveauGravite = score < 2 ? "faible" : score < 3 ? "moyen" : score < 4 ? "eleve" : "tres_eleve";
  // Art. 33 : notification à la CNIL sauf si la violation n'est pas
  // susceptible d'engendrer un risque pour les droits et libertés.
  const notificationCnil = niveau !== "faible";
  // Art. 34 : information des personnes si risque élevé.
  const informationPersonnes = niveau === "eleve" || niveau === "tres_eleve";
  const justification =
    `Gravité ENISA = ${dpc} × ${ei} + ${scoreCirconstances(c)} = ${score} (${niveau}). ` +
    (notificationCnil
      ? "Notification à la CNIL requise dans les 72 heures (art. 33.1). "
      : "Risque improbable : pas de notification à la CNIL, documentation interne obligatoire (art. 33.5). ") +
    (informationPersonnes
      ? "Risque élevé : information des personnes concernées dans les meilleurs délais (art. 34.1)."
      : "Information individuelle des personnes non requise (art. 34).");
  return { score, niveau, notificationCnil, informationPersonnes, justification };
}

/** Échéance de notification à la CNIL : 72 heures après la prise de connaissance. */
export function echeanceNotification(dateConnaissance: string): string {
  return new Date(Date.parse(dateConnaissance) + 72 * 3_600_000).toISOString();
}

export function heuresRestantes(dateConnaissance: string, maintenant: string): number {
  return Math.floor((Date.parse(echeanceNotification(dateConnaissance)) - Date.parse(maintenant)) / 3_600_000);
}
