/**
 * Contrôle d'accès par rôle (RGPD art. 25 et 32 — protection des données dès
 * la conception, habilitations au strict besoin d'en connaître).
 *
 * Séparation des tâches : un collaborateur saisit, seul un expert-comptable
 * valide les écritures et clôture un exercice. Le DPO accède au module RGPD et
 * au journal d'audit, mais pas aux données comptables.
 */
export type Role = "admin" | "expert" | "collaborateur" | "client" | "dpo";

export const ROLES: Role[] = ["admin", "expert", "collaborateur", "client", "dpo"];

export type Permission =
  | "dossiers:read"
  | "dossiers:write"
  | "compta:write"
  | "compta:validate"
  | "compta:cloture"
  | "factures:write"
  | "tiers:write"
  | "rgpd:manage"
  | "audit:read"
  | "users:manage"
  | "paie:manage"
  | "portail:client";

const MATRIX: Record<Role, Permission[]> = {
  admin: [
    "dossiers:read", "dossiers:write", "compta:write", "compta:validate", "compta:cloture",
    "factures:write", "tiers:write", "rgpd:manage", "audit:read", "users:manage", "paie:manage",
  ],
  expert: ["dossiers:read", "dossiers:write", "compta:write", "compta:validate", "compta:cloture", "factures:write", "tiers:write", "audit:read", "paie:manage"],
  collaborateur: ["dossiers:read", "compta:write", "factures:write", "tiers:write", "paie:manage"],
  // Le client dirigeant consulte son dossier et utilise le portail (dépôt de pièces, échanges).
  client: ["dossiers:read", "portail:client"],
  dpo: ["rgpd:manage", "audit:read"],
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrateur",
  expert: "Expert-comptable",
  collaborateur: "Collaborateur comptable",
  client: "Client (portail)",
  dpo: "Délégué à la protection des données",
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function permissionsOf(role: Role): Permission[] {
  return [...MATRIX[role]];
}

/** Les administrateurs et experts voient tous les dossiers ; les autres, ceux qui leur sont affectés. */
export function seesAllDossiers(role: Role): boolean {
  return role === "admin" || role === "expert";
}
