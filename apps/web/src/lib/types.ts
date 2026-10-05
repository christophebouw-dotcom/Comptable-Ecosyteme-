import type { Echeance, LigneEcriture, Facture, TotauxFacture, ControleMention } from "@compta/core";

export type Role = "admin" | "expert" | "collaborateur" | "client" | "dpo";
export type Permission =
  | "dossiers:read" | "dossiers:write" | "compta:write" | "compta:validate" | "compta:cloture"
  | "factures:write" | "tiers:write" | "rgpd:manage" | "audit:read" | "users:manage";

export interface User {
  id: number;
  email: string;
  nom: string;
  role: Role;
  roleLabel: string;
  totpEnabled: boolean;
  permissions: Permission[];
}

export interface Exercice {
  id: number;
  dossier_id: number;
  debut: string;
  fin: string;
  statut: "ouvert" | "cloture";
  cloture_at: string | null;
  empreinte_cloture: string | null;
}

export interface Dossier {
  id: number;
  raisonSociale: string;
  formeJuridique: string;
  siren: string;
  adresse: string;
  codePostal: string;
  ville: string;
  pays: string;
  capital: string | null;
  rcs: string | null;
  regimeTva: string;
  impot: "IS" | "IR";
  emailContact: string | null;
  ibanMasque: string | null;
  bic: string | null;
  prefixeFacture: string;
  iaAutorisee?: boolean;
  exerciceCourant?: { id: number; debut: string; fin: string } | null;
  brouillards?: number;
  validees?: number;
  prochainesEcheances?: Echeance[];
  alertesMission?: { code: string; niveau: "bloquant" | "avertissement"; message: string }[];
  lignesBancairesATraiter?: number;
  exercices?: Exercice[];
  journaux?: { code: string; libelle: string; type: string }[];
}

export interface Ecriture {
  id: number;
  dossierId: number;
  exerciceId: number;
  journal: string;
  numero: number | null;
  date: string;
  libelle: string;
  pieceRef: string;
  pieceDate: string;
  statut: "brouillard" | "validee";
  extourneDe: number | null;
  factureId: number | null;
  validatedAt: string | null;
  hash: string | null;
  lignes: (LigneEcriture & { id: number; dateLettrage: string | null })[];
}

export interface Tiers {
  id: number;
  type: "client" | "fournisseur";
  compteAux: string;
  nom: string;
  personnePhysique: boolean;
  professionnel: boolean;
  siren: string | null;
  tvaIntra: string | null;
  adresse: string | null;
  codePostal: string | null;
  ville: string | null;
  pays: string;
  email: string | null;
  telephone: string | null;
  ibanMasque: string | null;
  finRelation: string | null;
  restricted: boolean;
  anonymized: boolean;
}

export interface FactureResume {
  id: number;
  type: "facture" | "avoir";
  numero: string | null;
  statut: "brouillon" | "emise" | "payee";
  client: string;
  dateEmission: string | null;
  dateEcheance: string | null;
  totalHT: number;
  totalTVA: number;
  totalTTC: number;
  enRetard: boolean;
}

export interface FactureDetail {
  id: number;
  statut: "brouillon" | "emise" | "payee";
  type: "facture" | "avoir";
  numero: string | null;
  tiersId: number;
  client: string;
  dateEmission: string;
  dateEcheance: string;
  totaux: TotauxFacture;
  facture: Facture;
  brouillon: unknown;
  controles: ControleMention[];
  mentions: string[];
  ecritureId: number | null;
  hash: string | null;
  emittedAt: string | null;
  paidAt: string | null;
}
