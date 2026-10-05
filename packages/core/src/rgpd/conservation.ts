/**
 * Durées de conservation des données (RGPD art. 5.1.e — limitation de la
 * conservation) et articulation avec les obligations légales de conservation.
 *
 * Chaque catégorie précise sa base légale, la durée en base active, la durée
 * en archivage intermédiaire et l'action en fin de cycle.
 */

export type ActionFinDeVie = "suppression" | "anonymisation" | "archivage";

export interface RegleConservation {
  categorie: CategorieDonnees;
  libelle: string;
  /** Événement à partir duquel court le délai. */
  pointDeDepart: string;
  /** Durée totale de conservation, en mois. */
  dureeMois: number;
  action: ActionFinDeVie;
  baseLegale: string;
  /**
   * La conservation résulte-t-elle d'une obligation légale ou de la nécessité
   * de constater, exercer ou défendre des droits en justice (art. 17.3.b et
   * 17.3.e) ? Si non, la durée est un maximum et n'empêche pas l'effacement.
   */
  obligationLegale: boolean;
}

export type CategorieDonnees =
  | "pieces_comptables"
  | "livres_comptables"
  | "documents_fiscaux"
  | "factures"
  | "donnees_prospects"
  | "donnees_clients_commercial"
  | "contrats"
  | "bulletins_paie"
  | "dossiers_personnel"
  | "logs_connexion"
  | "logs_audit"
  | "comptes_utilisateurs_inactifs"
  | "demandes_droits"
  | "violations"
  | "preuves_consentement"
  | "lab_ft_kyc";

export const REGLES_CONSERVATION: Record<CategorieDonnees, RegleConservation> = {
  pieces_comptables: {
    categorie: "pieces_comptables",
    libelle: "Pièces justificatives comptables",
    pointDeDepart: "Clôture de l'exercice",
    dureeMois: 120,
    action: "suppression",
    baseLegale: "Code de commerce, art. L123-22 (10 ans)",
    obligationLegale: true,
  },
  livres_comptables: {
    categorie: "livres_comptables",
    libelle: "Livres, registres et écritures comptables (dont FEC)",
    pointDeDepart: "Clôture de l'exercice",
    dureeMois: 120,
    action: "suppression",
    baseLegale: "Code de commerce, art. L123-22 ; LPF art. L102 B",
    obligationLegale: true,
  },
  documents_fiscaux: {
    categorie: "documents_fiscaux",
    libelle: "Documents fiscaux (déclarations, justificatifs)",
    pointDeDepart: "Dernière opération mentionnée",
    dureeMois: 72,
    action: "suppression",
    baseLegale: "Livre des procédures fiscales, art. L102 B (6 ans)",
    obligationLegale: true,
  },
  factures: {
    categorie: "factures",
    libelle: "Factures émises et reçues",
    pointDeDepart: "Clôture de l'exercice",
    dureeMois: 120,
    action: "suppression",
    baseLegale: "Code de commerce, art. L123-22 ; CGI art. 289 et LPF art. L102 B",
    obligationLegale: true,
  },
  donnees_prospects: {
    categorie: "donnees_prospects",
    libelle: "Données de prospects",
    pointDeDepart: "Dernier contact émanant du prospect",
    dureeMois: 36,
    action: "suppression",
    baseLegale: "CNIL, référentiel « gestion commerciale » (3 ans)",
    obligationLegale: false,
  },
  donnees_clients_commercial: {
    categorie: "donnees_clients_commercial",
    libelle: "Données clients à des fins de gestion commerciale",
    pointDeDepart: "Fin de la relation commerciale",
    dureeMois: 36,
    action: "anonymisation",
    baseLegale: "CNIL, référentiel « gestion commerciale »",
    obligationLegale: false,
  },
  contrats: {
    categorie: "contrats",
    libelle: "Lettres de mission et contrats",
    pointDeDepart: "Fin du contrat",
    dureeMois: 60,
    action: "suppression",
    baseLegale: "Code civil, art. 2224 (prescription de droit commun, 5 ans)",
    obligationLegale: true,
  },
  bulletins_paie: {
    categorie: "bulletins_paie",
    libelle: "Doubles des bulletins de paie (employeur)",
    pointDeDepart: "Émission du bulletin",
    dureeMois: 60,
    action: "suppression",
    baseLegale: "Code du travail, art. L3243-4 (5 ans)",
    obligationLegale: true,
  },
  dossiers_personnel: {
    categorie: "dossiers_personnel",
    libelle: "Dossiers individuels du personnel",
    pointDeDepart: "Départ du salarié",
    dureeMois: 60,
    action: "suppression",
    baseLegale: "CNIL, référentiel « gestion du personnel » ; C. trav. art. L3245-1",
    obligationLegale: true,
  },
  logs_connexion: {
    categorie: "logs_connexion",
    libelle: "Journaux de connexion techniques",
    pointDeDepart: "Enregistrement",
    dureeMois: 12,
    action: "suppression",
    baseLegale: "CNIL, recommandation journalisation (6 mois à 1 an)",
    obligationLegale: false,
  },
  logs_audit: {
    categorie: "logs_audit",
    libelle: "Piste d'audit des opérations comptables",
    pointDeDepart: "Clôture de l'exercice",
    dureeMois: 120,
    action: "suppression",
    baseLegale: "Code de commerce, art. L123-22 ; BOI-CF-IOR-60-40-10 (piste d'audit fiable)",
    obligationLegale: true,
  },
  comptes_utilisateurs_inactifs: {
    categorie: "comptes_utilisateurs_inactifs",
    libelle: "Comptes utilisateurs inactifs",
    pointDeDepart: "Dernière connexion",
    dureeMois: 24,
    action: "anonymisation",
    baseLegale: "RGPD art. 5.1.e ; CNIL (inactivité de 2 ans)",
    obligationLegale: false,
  },
  demandes_droits: {
    categorie: "demandes_droits",
    libelle: "Demandes d'exercice des droits et réponses",
    pointDeDepart: "Clôture de la demande",
    dureeMois: 60,
    action: "suppression",
    baseLegale: "Code civil, art. 2224 (preuve de conformité, 5 ans)",
    obligationLegale: true,
  },
  violations: {
    categorie: "violations",
    libelle: "Registre des violations de données",
    pointDeDepart: "Clôture de l'incident",
    dureeMois: 60,
    action: "archivage",
    baseLegale: "RGPD art. 33.5 (documentation des violations)",
    obligationLegale: true,
  },
  preuves_consentement: {
    categorie: "preuves_consentement",
    libelle: "Preuves du recueil du consentement",
    pointDeDepart: "Retrait du consentement ou fin du traitement",
    dureeMois: 60,
    action: "suppression",
    baseLegale: "RGPD art. 7.1 (charge de la preuve) ; C. civ. art. 2224",
    obligationLegale: true,
  },
  lab_ft_kyc: {
    categorie: "lab_ft_kyc",
    libelle: "Documents d'identification client (LCB-FT)",
    pointDeDepart: "Fin de la relation d'affaires",
    dureeMois: 60,
    action: "suppression",
    baseLegale: "Code monétaire et financier, art. L561-12 (5 ans)",
    obligationLegale: true,
  },
};

/** Ajoute des mois à une date ISO, en bornant au dernier jour du mois. */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function dateFinConservation(categorie: CategorieDonnees, dateDepart: string): string {
  return addMonths(dateDepart, REGLES_CONSERVATION[categorie].dureeMois);
}

export function estExpiree(categorie: CategorieDonnees, dateDepart: string, aujourdHui: string): boolean {
  return dateFinConservation(categorie, dateDepart) <= aujourdHui.slice(0, 10);
}

/**
 * Une donnée est-elle soumise à une obligation légale de conservation qui fait
 * obstacle à son effacement (RGPD art. 17.3.b) à la date donnée ?
 */
export function obligationLegaleEnCours(
  categorie: CategorieDonnees,
  dateDepart: string,
  aujourdHui: string,
): { bloquant: boolean; jusquAu: string; baseLegale: string } {
  const r = REGLES_CONSERVATION[categorie];
  const jusquAu = dateFinConservation(categorie, dateDepart);
  return { bloquant: r.obligationLegale && jusquAu > aujourdHui.slice(0, 10), jusquAu, baseLegale: r.baseLegale };
}
