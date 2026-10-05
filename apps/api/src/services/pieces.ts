/**
 * Dépôt et lecture automatique des pièces justificatives, partagés entre
 * l'espace du cabinet et le portail client.
 */
import { createHash } from "node:crypto";
import { parseFacturX } from "@compta/core";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { conflict, unprocessable } from "../http/errors.js";
import type { DossierRow } from "../http/guards.js";
import { ErreurIA } from "./ia.js";

export const MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "application/xml", "text/xml"] as const;
export const TAILLE_MAX = 10 * 1024 * 1024;

export const depotSchema = z.object({
  nomFichier: z.string().trim().min(1).max(200),
  mime: z.enum(MIMES),
  contenuBase64: z.string().min(1).max(Math.ceil((TAILLE_MAX * 4) / 3) + 4),
});

export interface PieceRow {
  id: number;
  dossier_id: number;
  nom_fichier: string;
  mime: string;
  taille: number;
  sha256: string;
  contenu_enc: string;
  statut: "a_traiter" | "a_valider" | "comptabilisee" | "rejetee" | "erreur";
  source: "ia" | "facturx" | null;
  extraction: string | null;
  erreur: string | null;
  ecriture_id: number | null;
  ia_modele: string | null;
  deposee_par_client: number;
  created_at: string;
  traitee_at: string | null;
}

/** Imputations habituelles : compte de charge/produit le plus utilisé avec chaque tiers. */
export function habitudesDossier(ctx: AppContext, dossierId: number) {
  return ctx.db.all<{ tiers: string; compte: string; aux: string }>(
    `WITH paires AS (
       SELECT t.compte_aux AS aux, c.compte, COUNT(*) AS n
       FROM ecriture_lignes t
       JOIN ecritures e ON e.id = t.ecriture_id
       JOIN ecriture_lignes c ON c.ecriture_id = e.id AND c.id <> t.id AND substr(c.compte, 1, 1) IN ('2', '6', '7')
       WHERE e.dossier_id = ? AND t.compte_aux IS NOT NULL
       GROUP BY t.compte_aux, c.compte
     )
     SELECT p.aux || ' (' || COALESCE(ti.nom, '') || ')' AS tiers, p.compte AS compte, p.aux AS aux
     FROM paires p LEFT JOIN tiers ti ON ti.dossier_id = ? AND ti.compte_aux = p.aux
     WHERE p.n = (SELECT MAX(n) FROM paires q WHERE q.aux = p.aux)
     ORDER BY p.aux LIMIT 200`,
    dossierId, dossierId,
  );
}

export function getPieceRow(ctx: AppContext, dossierId: number, id: number): PieceRow | undefined {
  return ctx.db.get<PieceRow>("SELECT * FROM pieces WHERE id = ? AND dossier_id = ?", id, dossierId);
}

/** Lecture automatique : Factur-X exacte si possible, sinon IA si autorisée. */
export async function lirePiece(ctx: AppContext, req: FastifyRequest, dossier: DossierRow, p: PieceRow): Promise<void> {
  const { db, cipher } = ctx;
  const contenu = cipher.decrypt(p.contenu_enc)!;
  if (p.mime.includes("xml")) {
    const xml = Buffer.from(contenu, "base64").toString("utf8");
    const e = parseFacturX(xml, dossier.siren);
    if (!e) {
      db.run("UPDATE pieces SET statut = 'erreur', erreur = ? WHERE id = ?", "Fichier XML non reconnu (format CII / Factur-X attendu)", p.id);
      return;
    }
    db.run("UPDATE pieces SET statut = 'a_valider', source = 'facturx', extraction = ?, erreur = NULL, traitee_at = ? WHERE id = ?", JSON.stringify(e), ctx.now().toISOString(), p.id);
    return;
  }
  if (!ctx.ia || !dossier.ia_autorisee) {
    db.run("UPDATE pieces SET statut = 'a_traiter', erreur = NULL WHERE id = ?", p.id);
    return;
  }
  try {
    const { extraction, usage } = await ctx.ia.extrairePiece(
      { nomFichier: p.nom_fichier, mime: p.mime, base64: contenu },
      { raisonSociale: dossier.raison_sociale, siren: dossier.siren, habitudes: habitudesDossier(ctx, dossier.id) },
    );
    db.run(
      "UPDATE pieces SET statut = 'a_valider', source = 'ia', extraction = ?, erreur = NULL, ia_modele = ?, ia_tokens_entree = ?, ia_tokens_sortie = ?, traitee_at = ? WHERE id = ?",
      JSON.stringify(extraction), usage.modele, usage.tokensEntree, usage.tokensSortie, ctx.now().toISOString(), p.id,
    );
    ctx.audit.record({
      userId: req.user!.id, userEmail: req.user!.email, action: "ia.lecture_piece", entity: "piece", entityId: p.id, dossierId: dossier.id, ip: req.ip,
      details: { modele: usage.modele, tokensEntree: usage.tokensEntree, tokensSortie: usage.tokensSortie, confiance: extraction.confiance },
    });
  } catch (err) {
    const message = err instanceof ErreurIA ? err.message : "Échec de la lecture automatique";
    if (!(err instanceof ErreurIA)) req.log.error(err);
    db.run("UPDATE pieces SET statut = 'erreur', erreur = ? WHERE id = ?", message, p.id);
  }
}

/**
 * Enregistre une pièce chiffrée après contrôle de sa signature et de son
 * unicité, puis lance sa lecture automatique.
 */
export async function deposerPiece(
  ctx: AppContext,
  req: FastifyRequest,
  dossier: DossierRow,
  b: z.infer<typeof depotSchema>,
  opts: { parClient?: boolean } = {},
): Promise<PieceRow> {
  const { db, cipher } = ctx;
  const buf = Buffer.from(b.contenuBase64, "base64");
  if (buf.length === 0 || buf.length > TAILLE_MAX) throw unprocessable("Fichier vide ou supérieur à 10 Mo");
  // Vérification de la signature du fichier (le type déclaré ne suffit pas).
  const signatureOk =
    (b.mime === "application/pdf" && buf.subarray(0, 4).toString() === "%PDF") ||
    (b.mime === "image/png" && buf[0] === 0x89 && buf.subarray(1, 4).toString() === "PNG") ||
    (b.mime === "image/jpeg" && buf[0] === 0xff && buf[1] === 0xd8) ||
    (b.mime === "image/gif" && buf.subarray(0, 3).toString() === "GIF") ||
    (b.mime === "image/webp" && buf.subarray(8, 12).toString() === "WEBP") ||
    (b.mime.includes("xml") && /^\s*(﻿)?</.test(buf.subarray(0, 64).toString("utf8")));
  if (!signatureOk) throw unprocessable("Le contenu du fichier ne correspond pas à son type");
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const doublon = db.get<{ id: number }>("SELECT id FROM pieces WHERE dossier_id = ? AND sha256 = ?", dossier.id, sha256);
  if (doublon) throw conflict("Cette pièce a déjà été déposée", { pieceId: doublon.id });
  const id = db.run(
    "INSERT INTO pieces (dossier_id, nom_fichier, mime, taille, sha256, contenu_enc, statut, created_by, deposee_par_client) VALUES (?, ?, ?, ?, ?, ?, 'a_traiter', ?, ?)",
    dossier.id, b.nomFichier, b.mime, buf.length, sha256, cipher.encrypt(buf.toString("base64")), req.user!.id, opts.parClient ? 1 : 0,
  ).lastInsertRowid;
  ctx.audit.record({
    userId: req.user!.id, userEmail: req.user!.email, action: "piece.deposee", entity: "piece", entityId: id, dossierId: dossier.id, ip: req.ip,
    details: { fichier: b.nomFichier, taille: buf.length, sha256, parClient: !!opts.parClient },
  });
  await lirePiece(ctx, req, dossier, getPieceRow(ctx, dossier.id, id)!);
  return getPieceRow(ctx, dossier.id, id)!;
}
