import type { FastifyRequest } from "fastify";
import type { SessionUser } from "../context.js";
import { type Permission, can, seesAllDossiers } from "../security/rbac.js";
import { badRequest, forbidden, notFound, unauthorized } from "./errors.js";

export function requireUser(req: FastifyRequest): SessionUser {
  const u = req.user;
  if (!u) throw unauthorized();
  if (u.totpEnabled && !u.mfaOk) throw unauthorized("Second facteur d'authentification requis");
  return u;
}

export function requirePerm(req: FastifyRequest, permission: Permission): SessionUser {
  const u = requireUser(req);
  if (!can(u.role, permission)) throw forbidden(`Permission « ${permission} » requise`);
  return u;
}

export interface DossierRow {
  id: number;
  raison_sociale: string;
  forme_juridique: string;
  siren: string;
  adresse: string;
  code_postal: string;
  ville: string;
  pays: string;
  capital: string | null;
  rcs: string | null;
  regime_tva: string;
  impot: "IS" | "IR";
  email_contact: string | null;
  iban_enc: string | null;
  bic: string | null;
  prefixe_facture: string;
  ia_autorisee: number;
  created_at: string;
  archived_at: string | null;
}

/**
 * Vérifie la permission ET le cloisonnement : un utilisateur n'accède qu'aux
 * dossiers qui lui sont affectés (sauf administrateurs et experts).
 * Un dossier inaccessible est signalé comme introuvable (pas de fuite d'existence).
 */
export function requireDossier(req: FastifyRequest, permission: Permission): { user: SessionUser; dossier: DossierRow } {
  const user = requirePerm(req, permission);
  const id = Number((req.params as { dossierId?: string }).dossierId);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("Identifiant de dossier invalide");
  const { db } = req.server.ctx;
  const dossier = db.get<DossierRow>("SELECT * FROM dossiers WHERE id = ?", id);
  if (!dossier) throw notFound("Dossier introuvable");
  if (!seesAllDossiers(user.role) && !db.get("SELECT 1 FROM dossier_access WHERE user_id = ? AND dossier_id = ?", user.id, id)) {
    throw notFound("Dossier introuvable");
  }
  return { user, dossier };
}

export function clientIp(req: FastifyRequest): string {
  return req.ip;
}

export function intParam(req: FastifyRequest, name: string): number {
  const v = Number((req.params as Record<string, string>)[name]);
  if (!Number.isInteger(v) || v <= 0) throw badRequest(`Paramètre ${name} invalide`);
  return v;
}
