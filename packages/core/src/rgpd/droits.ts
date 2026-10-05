/**
 * Exercice des droits des personnes concernées (RGPD, chapitre III).
 */
import { addMonths, obligationLegaleEnCours, type CategorieDonnees } from "./conservation.js";

export type TypeDemande =
  | "acces" // art. 15
  | "rectification" // art. 16
  | "effacement" // art. 17
  | "limitation" // art. 18
  | "portabilite" // art. 20
  | "opposition" // art. 21
  | "retrait_consentement"; // art. 7.3

export const LIBELLES_DEMANDES: Record<TypeDemande, { libelle: string; article: string }> = {
  acces: { libelle: "Droit d'accès", article: "RGPD art. 15" },
  rectification: { libelle: "Droit de rectification", article: "RGPD art. 16" },
  effacement: { libelle: "Droit à l'effacement", article: "RGPD art. 17" },
  limitation: { libelle: "Droit à la limitation du traitement", article: "RGPD art. 18" },
  portabilite: { libelle: "Droit à la portabilité", article: "RGPD art. 20" },
  opposition: { libelle: "Droit d'opposition", article: "RGPD art. 21" },
  retrait_consentement: { libelle: "Retrait du consentement", article: "RGPD art. 7.3" },
};

export type StatutDemande = "recue" | "identite_a_verifier" | "en_cours" | "prolongee" | "traitee" | "refusee";

/**
 * Délai de réponse : un mois à compter de la réception, prolongeable de deux
 * mois compte tenu de la complexité et du nombre de demandes, à condition
 * d'en informer la personne dans le premier mois (RGPD art. 12.3).
 */
export function delaiReponse(dateReception: string, prolongee = false): string {
  return addMonths(dateReception, prolongee ? 3 : 1);
}

export function joursRestants(echeance: string, aujourdHui: string): number {
  const ms = Date.parse(`${echeance}T00:00:00Z`) - Date.parse(`${aujourdHui.slice(0, 10)}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export type Urgence = "ok" | "attention" | "urgent" | "depassee";

export function urgence(echeance: string, aujourdHui: string): Urgence {
  const j = joursRestants(echeance, aujourdHui);
  if (j < 0) return "depassee";
  if (j <= 5) return "urgent";
  if (j <= 12) return "attention";
  return "ok";
}

/** Données détenues sur une personne, par catégorie, pour l'analyse d'une demande. */
export interface DonneeDetenue {
  categorie: CategorieDonnees;
  description: string;
  /** Date de départ du délai de conservation. */
  dateDepart: string;
  /** Traitement fondé sur le consentement ? */
  fondeSurConsentement?: boolean;
}

export interface DecisionEffacement {
  categorie: CategorieDonnees;
  description: string;
  decision: "effacer" | "conserver_limiter";
  motif: string;
  effacementPrevuLe?: string;
}

/**
 * Analyse une demande d'effacement : les données soumises à une obligation
 * légale de conservation (ex. pièces comptables, 10 ans) ne peuvent être
 * effacées (art. 17.3.b). Elles sont alors limitées (art. 18) : accès
 * restreint, aucune autre utilisation, effacement automatique à l'échéance.
 */
export function analyserEffacement(donnees: DonneeDetenue[], aujourdHui: string): DecisionEffacement[] {
  return donnees.map((d) => {
    const ob = obligationLegaleEnCours(d.categorie, d.dateDepart, aujourdHui);
    if (ob.bloquant && !d.fondeSurConsentement) {
      return {
        categorie: d.categorie,
        description: d.description,
        decision: "conserver_limiter",
        motif: `Obligation légale de conservation (${ob.baseLegale}) — RGPD art. 17.3.b. Données placées en accès restreint.`,
        effacementPrevuLe: ob.jusquAu,
      };
    }
    return {
      categorie: d.categorie,
      description: d.description,
      decision: "effacer",
      motif: d.fondeSurConsentement
        ? "Traitement fondé sur le consentement : effacement de droit (art. 17.1.b)."
        : "Aucune obligation de conservation en cours (art. 17.1.a).",
    };
  });
}

/** Modèle de réponse à une demande, à personnaliser par le DPO. */
export function modeleReponse(type: TypeDemande, nom: string, decisions?: DecisionEffacement[]): string {
  const { libelle, article } = LIBELLES_DEMANDES[type];
  const intro = `Madame, Monsieur ${nom},\n\nNous accusons réception de votre demande relative à l'exercice de votre ${libelle.toLowerCase()} (${article}).`;
  const fin =
    "\n\nSi vous estimez, après nous avoir contactés, que vos droits ne sont pas respectés, vous pouvez adresser une réclamation à la CNIL (www.cnil.fr, 3 place de Fontenoy, TSA 80715, 75334 Paris Cedex 07).\n\nVeuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.\n\nLe Délégué à la protection des données";
  let corps = "";
  switch (type) {
    case "acces":
      corps = "\n\nVous trouverez ci-joint une copie des données vous concernant, ainsi que les informations relatives aux finalités, destinataires, durées de conservation et à vos droits.";
      break;
    case "portabilite":
      corps = "\n\nVous trouverez ci-joint vos données dans un format structuré, couramment utilisé et lisible par machine (JSON).";
      break;
    case "effacement": {
      const eff = decisions?.filter((d) => d.decision === "effacer") ?? [];
      const cons = decisions?.filter((d) => d.decision === "conserver_limiter") ?? [];
      corps =
        (eff.length ? `\n\nLes données suivantes ont été effacées :\n${eff.map((d) => `  • ${d.description}`).join("\n")}` : "") +
        (cons.length
          ? `\n\nLes données suivantes ne peuvent être effacées immédiatement car nous sommes tenus de les conserver en vertu d'une obligation légale (RGPD art. 17.3.b). Leur accès est désormais restreint et elles seront supprimées à l'échéance indiquée :\n${cons
              .map((d) => `  • ${d.description} — jusqu'au ${d.effacementPrevuLe} (${d.motif.split(" — ")[0]})`)
              .join("\n")}`
          : "");
      break;
    }
    default:
      corps = "\n\nVotre demande a été prise en compte et traitée.";
  }
  return intro + corps + fin;
}
