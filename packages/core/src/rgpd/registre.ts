/**
 * Registre des activités de traitement (RGPD art. 30.1 — responsable de
 * traitement, et art. 30.2 — sous-traitant).
 *
 * Un cabinet d'expertise comptable est à la fois :
 *  - responsable de traitement pour ses propres traitements (gestion des
 *    clients du cabinet, RH, prospection, LCB-FT) ;
 *  - sous-traitant de ses clients pour la tenue de leur comptabilité et de
 *    leur paie (art. 28 : un contrat ou une clause de lettre de mission doit
 *    encadrer cette sous-traitance).
 */
import type { CategorieDonnees } from "./conservation.js";

export type BaseLegale =
  | "consentement" // art. 6.1.a
  | "contrat" // art. 6.1.b
  | "obligation_legale" // art. 6.1.c
  | "interets_vitaux" // art. 6.1.d
  | "mission_interet_public" // art. 6.1.e
  | "interet_legitime"; // art. 6.1.f

export const LIBELLES_BASES_LEGALES: Record<BaseLegale, string> = {
  consentement: "Consentement (art. 6.1.a)",
  contrat: "Exécution d'un contrat (art. 6.1.b)",
  obligation_legale: "Obligation légale (art. 6.1.c)",
  interets_vitaux: "Sauvegarde des intérêts vitaux (art. 6.1.d)",
  mission_interet_public: "Mission d'intérêt public (art. 6.1.e)",
  interet_legitime: "Intérêt légitime (art. 6.1.f)",
};

export interface Traitement {
  reference: string;
  nom: string;
  role: "responsable" | "sous_traitant";
  finalites: string[];
  baseLegale: BaseLegale;
  precisionBaseLegale?: string;
  personnesConcernees: string[];
  categoriesDonnees: string[];
  donneesSensibles: boolean;
  destinataires: string[];
  transfertsHorsUE: string;
  conservation: CategorieDonnees[];
  mesuresSecurite: string[];
  /** Analyse d'impact (AIPD) requise ? (art. 35, liste CNIL des traitements). */
  aipdRequise: boolean;
}

const SECURITE_COMMUNE = [
  "Authentification forte (mot de passe conforme CNIL + TOTP)",
  "Contrôle d'accès par rôle et par dossier",
  "Chiffrement AES-256-GCM des données bancaires au repos",
  "Chiffrement TLS 1.2+ en transit",
  "Journalisation chaînée (SHA-256) des accès et opérations",
  "Sauvegardes chiffrées et testées",
];

export const REGISTRE_PAR_DEFAUT: Traitement[] = [
  {
    reference: "T-01",
    nom: "Tenue de la comptabilité des clients",
    role: "sous_traitant",
    finalites: ["Saisie et révision comptable", "Établissement des comptes annuels", "Production du FEC"],
    baseLegale: "contrat",
    precisionBaseLegale: "Lettre de mission ; obligations comptables du client (C. com. art. L123-12)",
    personnesConcernees: ["Clients et fournisseurs des entreprises clientes", "Dirigeants et associés"],
    categoriesDonnees: ["Identité", "Coordonnées", "Données bancaires (IBAN)", "Données de facturation"],
    donneesSensibles: false,
    destinataires: ["Collaborateurs habilités du cabinet", "Administration fiscale (sur demande)", "Commissaire aux comptes"],
    transfertsHorsUE: "Aucun",
    conservation: ["pieces_comptables", "livres_comptables"],
    mesuresSecurite: SECURITE_COMMUNE,
    aipdRequise: false,
  },
  {
    reference: "T-02",
    nom: "Établissement des bulletins de paie et déclarations sociales",
    role: "sous_traitant",
    finalites: ["Calcul de la paie", "Déclaration sociale nominative (DSN)", "Prélèvement à la source"],
    baseLegale: "obligation_legale",
    precisionBaseLegale: "Code du travail, art. L3243-1 et s. ; CSS art. L133-5-3 (DSN) ; CGI art. 204 A (PAS)",
    personnesConcernees: ["Salariés des entreprises clientes"],
    categoriesDonnees: ["Identité", "NIR", "Rémunération", "Taux de prélèvement à la source", "Absences"],
    donneesSensibles: true,
    destinataires: ["URSSAF", "DGFiP", "Caisses de retraite et prévoyance", "Employeur client"],
    transfertsHorsUE: "Aucun",
    conservation: ["bulletins_paie"],
    mesuresSecurite: [...SECURITE_COMMUNE, "Cloisonnement des données de paie", "Habilitations nominatives limitées"],
    aipdRequise: true,
  },
  {
    reference: "T-03",
    nom: "Gestion de la relation avec les clients du cabinet",
    role: "responsable",
    finalites: ["Gestion des lettres de mission", "Facturation des honoraires", "Recouvrement", "Portail client : dépôt de justificatifs, demandes de pièces et messagerie"],
    baseLegale: "contrat",
    personnesConcernees: ["Clients du cabinet", "Interlocuteurs des entreprises clientes"],
    categoriesDonnees: ["Identité", "Coordonnées", "Données de facturation", "Contenu des échanges (chiffré)"],
    donneesSensibles: false,
    destinataires: ["Associés et collaborateurs du cabinet"],
    transfertsHorsUE: "Aucun",
    conservation: ["contrats", "factures", "donnees_clients_commercial"],
    mesuresSecurite: SECURITE_COMMUNE,
    aipdRequise: false,
  },
  {
    reference: "T-04",
    nom: "Lutte contre le blanchiment et le financement du terrorisme",
    role: "responsable",
    finalites: ["Identification et vérification de l'identité des clients", "Vigilance sur la relation d'affaires", "Déclarations de soupçon"],
    baseLegale: "obligation_legale",
    precisionBaseLegale: "Code monétaire et financier, art. L561-2 12° et L561-5 et s.",
    personnesConcernees: ["Clients", "Bénéficiaires effectifs"],
    categoriesDonnees: ["Identité", "Pièce d'identité", "Bénéficiaires effectifs", "Origine des fonds"],
    donneesSensibles: true,
    destinataires: ["Tracfin", "Conseil régional de l'Ordre (contrôle qualité)"],
    transfertsHorsUE: "Aucun",
    conservation: ["lab_ft_kyc"],
    mesuresSecurite: [...SECURITE_COMMUNE, "Accès restreint au référent LCB-FT"],
    aipdRequise: true,
  },
  {
    reference: "T-05",
    nom: "Gestion des ressources humaines du cabinet",
    role: "responsable",
    finalites: ["Gestion administrative du personnel", "Paie du cabinet"],
    baseLegale: "obligation_legale",
    personnesConcernees: ["Salariés", "Stagiaires"],
    categoriesDonnees: ["Identité", "NIR", "Rémunération", "Évaluation"],
    donneesSensibles: true,
    destinataires: ["Service RH", "Organismes sociaux"],
    transfertsHorsUE: "Aucun",
    conservation: ["dossiers_personnel", "bulletins_paie"],
    mesuresSecurite: SECURITE_COMMUNE,
    aipdRequise: false,
  },
  {
    reference: "T-06",
    nom: "Prospection commerciale",
    role: "responsable",
    finalites: ["Envoi de newsletters et d'informations fiscales", "Suivi des prospects"],
    baseLegale: "consentement",
    precisionBaseLegale: "CPCE art. L34-5 (prospection électronique B2C : consentement préalable)",
    personnesConcernees: ["Prospects", "Abonnés à la lettre d'information"],
    categoriesDonnees: ["Identité", "Coordonnées professionnelles"],
    donneesSensibles: false,
    destinataires: ["Service communication"],
    transfertsHorsUE: "Aucun",
    conservation: ["donnees_prospects", "preuves_consentement"],
    mesuresSecurite: SECURITE_COMMUNE,
    aipdRequise: false,
  },
  {
    reference: "T-07",
    nom: "Sécurité du système d'information et journalisation",
    role: "responsable",
    finalites: ["Détection des accès frauduleux", "Piste d'audit fiable", "Preuve des opérations"],
    baseLegale: "interet_legitime",
    precisionBaseLegale: "Sécurité du SI (art. 32) ; considérant 49",
    personnesConcernees: ["Utilisateurs de la plateforme"],
    categoriesDonnees: ["Identifiant", "Adresse IP", "Horodatage", "Actions réalisées"],
    donneesSensibles: false,
    destinataires: ["Administrateurs habilités", "DPO"],
    transfertsHorsUE: "Aucun",
    conservation: ["logs_connexion", "logs_audit"],
    mesuresSecurite: [...SECURITE_COMMUNE, "Journal en ajout seul (triggers SQL)"],
    aipdRequise: false,
  },
  {
    reference: "T-08",
    nom: "Lecture assistée des pièces par intelligence artificielle",
    role: "sous_traitant",
    finalites: ["Extraction des données des factures et tickets", "Suggestion d'imputation comptable et bancaire"],
    baseLegale: "contrat",
    precisionBaseLegale: "Lettre de mission (accord du client requis, activation dossier par dossier) ; sous-traitance ultérieure autorisée (art. 28.2)",
    personnesConcernees: ["Fournisseurs et clients des entreprises clientes", "Salariés (notes de frais)"],
    categoriesDonnees: ["Identité et coordonnées figurant sur les pièces", "Données de facturation", "IBAN figurant sur les factures", "Libellés bancaires"],
    donneesSensibles: false,
    destinataires: ["Anthropic (fournisseur du modèle Claude), sous-traitant ultérieur"],
    transfertsHorsUE: "États-Unis : encadré par le Data Privacy Framework et/ou les clauses contractuelles types de la Commission (art. 45 et 46) ; option de conservation nulle des données (zero data retention) à contractualiser",
    conservation: ["pieces_comptables"],
    mesuresSecurite: [
      ...SECURITE_COMMUNE,
      "Désactivé par défaut, autorisation par dossier tracée",
      "Aucune validation automatique : contrôle déterministe puis validation humaine",
      "Journal d'audit de chaque appel (modèle, volume) sans contenu",
    ],
    aipdRequise: false,
  },
];
