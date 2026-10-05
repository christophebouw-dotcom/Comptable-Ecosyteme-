/**
 * Pièces justificatives : dépôt, lecture automatique (facture électronique ou
 * IA), contrôle, comptabilisation assistée et archivage chiffré.
 */
import { createHash } from "node:crypto";
import {
  type ControlePiece,
  type ExtractionPiece,
  LIBELLES_TYPES_PIECE,
  type TiersConnu,
  controlerExtraction,
  isIsoDate,
  parseFacturX,
  propositionEcriture,
  rapprocherTiers,
  validateIban,
  validateSiren,
} from "@compta/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { conflict, notFound, unprocessable } from "../http/errors.js";
import { type DossierRow, intParam, requireDossier } from "../http/guards.js";
import { ErreurIA } from "../services/ia.js";

const MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "application/xml", "text/xml"] as const;
const TAILLE_MAX = 10 * 1024 * 1024;

interface PieceRow {
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

export async function pieceRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  const { db, cipher, audit, compta } = ctx;
  const log = (req: FastifyRequest, action: string, dossierId: number, entityId: number | null, details?: Record<string, unknown>) =>
    audit.record({ userId: req.user!.id, userEmail: req.user!.email, action, entity: "piece", entityId, dossierId, ip: req.ip, details });

  const tiersDossier = (dossierId: number): TiersConnu[] =>
    db.all<{ id: number; compte_aux: string; nom: string; siren: string | null; tva_intra: string | null; type: "client" | "fournisseur" }>(
      "SELECT id, compte_aux, nom, siren, tva_intra, type FROM tiers WHERE dossier_id = ? AND anonymized_at IS NULL", dossierId,
    ).map((t) => ({ id: t.id, compteAux: t.compte_aux, nom: t.nom, siren: t.siren, tvaIntra: t.tva_intra, type: t.type }));

  const exerciceOuvert = (dossierId: number) =>
    db.get<{ debut: string; fin: string }>("SELECT debut, fin FROM exercices WHERE dossier_id = ? AND statut = 'ouvert' ORDER BY debut LIMIT 1", dossierId);

  /** Analyse complète d'une pièce : contrôles, tiers rapproché, compte proposé, écriture proposée. */
  const analyser = (dossier: DossierRow, e: ExtractionPiece) => {
    const vente = e.typeDocument === "facture_vente" || e.typeDocument === "avoir_vente";
    const typeTiers = vente ? "client" : "fournisseur";
    const partie = vente ? e.destinataire : e.emetteur;
    const tiers = tiersDossier(dossier.id);
    const rapproche = rapprocherTiers(partie, typeTiers, tiers);
    const habitude = rapproche.tiers ? habitudesDossier(ctx, dossier.id).find((h) => h.aux === rapproche.tiers!.compteAux) : undefined;
    const compte = habitude?.compte ?? e.compteSuggere ?? (vente ? "706" : "606");
    const ex = exerciceOuvert(dossier.id);
    const controles: ControlePiece[] = controlerExtraction(e, ex ?? undefined);
    const bloquant = controles.some((c) => c.niveau === "bloquant");
    let ecriture = null;
    if (!bloquant && e.dateFacture) {
      try {
        ecriture = propositionEcriture(e, { compte, compteAux: rapproche.compteAuxPropose });
      } catch {
        ecriture = null;
      }
    }
    return {
      controles,
      tiers: { existant: rapproche.tiers, methode: rapproche.methode, compteAux: rapproche.compteAuxPropose, type: typeTiers, nom: partie.nom },
      compte: { numero: compte, origine: habitude ? "habitude" : e.compteSuggere ? e.source : "defaut", justification: habitude ? `Compte habituellement utilisé pour ${rapproche.tiers?.nom}` : e.justificationCompte },
      ecriture,
    };
  };

  const present = (dossier: DossierRow, p: PieceRow) => {
    const extraction = p.extraction ? (JSON.parse(p.extraction) as ExtractionPiece) : null;
    return {
      id: p.id,
      nomFichier: p.nom_fichier,
      mime: p.mime,
      taille: p.taille,
      statut: p.statut,
      source: p.source,
      erreur: p.erreur,
      ecritureId: p.ecriture_id,
      iaModele: p.ia_modele,
      createdAt: p.created_at,
      extraction,
      typeLibelle: extraction ? LIBELLES_TYPES_PIECE[extraction.typeDocument] : null,
      analyse: extraction && p.statut !== "comptabilisee" ? analyser(dossier, extraction) : null,
    };
  };

  const getPiece = (dossierId: number, id: number) => {
    const p = db.get<PieceRow>("SELECT * FROM pieces WHERE id = ? AND dossier_id = ?", id, dossierId);
    if (!p) throw notFound("Pièce introuvable");
    return p;
  };

  /** Lecture automatique : Factur-X exacte si possible, sinon IA si autorisée. */
  const lire = async (req: FastifyRequest, dossier: DossierRow, p: PieceRow) => {
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
      log(req, "ia.lecture_piece", dossier.id, p.id, { modele: usage.modele, tokensEntree: usage.tokensEntree, tokensSortie: usage.tokensSortie, confiance: extraction.confiance });
    } catch (err) {
      const message = err instanceof ErreurIA ? err.message : "Échec de la lecture automatique";
      if (!(err instanceof ErreurIA)) req.log.error(err);
      db.run("UPDATE pieces SET statut = 'erreur', erreur = ? WHERE id = ?", message, p.id);
    }
  };

  app.get("/api/ia/statut", async (req) => {
    if (!req.user) return { active: false };
    return { active: !!ctx.ia, modele: ctx.ia?.modele ?? null };
  });

  app.put("/api/dossiers/:dossierId/ia", async (req) => {
    const { user, dossier } = requireDossier(req, "dossiers:write");
    const { autorisee } = z.object({ autorisee: z.boolean() }).parse(req.body);
    db.run("UPDATE dossiers SET ia_autorisee = ? WHERE id = ?", autorisee ? 1 : 0, dossier.id);
    audit.record({ userId: user.id, userEmail: user.email, action: autorisee ? "ia.autorisee" : "ia.retiree", entity: "dossier", entityId: dossier.id, dossierId: dossier.id, ip: req.ip });
    return { ok: true };
  });

  app.get("/api/dossiers/:dossierId/pieces", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    const rows = db.all<PieceRow>("SELECT * FROM pieces WHERE dossier_id = ? ORDER BY created_at DESC, id DESC LIMIT 500", dossier.id);
    return {
      ia: { active: !!ctx.ia, autorisee: !!dossier.ia_autorisee, modele: ctx.ia?.modele ?? null },
      pieces: rows.map((p) => present(dossier, p)),
    };
  });

  app.get("/api/dossiers/:dossierId/pieces/:id", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    return present(dossier, getPiece(dossier.id, intParam(req, "id")));
  });

  app.get("/api/dossiers/:dossierId/pieces/:id/fichier", async (req, reply) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    const p = getPiece(dossier.id, intParam(req, "id"));
    log(req, "piece.consultee", dossier.id, p.id);
    reply
      .header("Content-Type", p.mime)
      .header("Content-Disposition", `inline; filename="${encodeURIComponent(p.nom_fichier)}"`)
      // La visionneuse PDF intégrée du navigateur a besoin d'une CSP permissive ;
      // les images et le XML restent sous une CSP fermée. Affichage limité à l'application.
      .header("Content-Security-Policy", p.mime === "application/pdf" ? "frame-ancestors 'self'" : "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'")
      .header("X-Frame-Options", "SAMEORIGIN")
      .header("Cache-Control", "private, no-store");
    return Buffer.from(cipher.decrypt(p.contenu_enc)!, "base64");
  });

  app.post("/api/dossiers/:dossierId/pieces", async (req, reply) => {
    const { user, dossier } = requireDossier(req, "compta:write");
    const b = z
      .object({ nomFichier: z.string().trim().min(1).max(200), mime: z.enum(MIMES), contenuBase64: z.string().min(1).max(Math.ceil((TAILLE_MAX * 4) / 3) + 4) })
      .parse(req.body);
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
      "INSERT INTO pieces (dossier_id, nom_fichier, mime, taille, sha256, contenu_enc, statut, created_by) VALUES (?, ?, ?, ?, ?, ?, 'a_traiter', ?)",
      dossier.id, b.nomFichier, b.mime, buf.length, sha256, cipher.encrypt(buf.toString("base64")), user.id,
    ).lastInsertRowid;
    log(req, "piece.deposee", dossier.id, id, { fichier: b.nomFichier, taille: buf.length, sha256 });
    await lire(req, dossier, getPiece(dossier.id, id));
    reply.code(201);
    return present(dossier, getPiece(dossier.id, id));
  });

  app.post("/api/dossiers/:dossierId/pieces/:id/relire", async (req) => {
    const { dossier } = requireDossier(req, "compta:write");
    const p = getPiece(dossier.id, intParam(req, "id"));
    if (p.statut === "comptabilisee") throw conflict("Pièce déjà comptabilisée");
    await lire(req, dossier, p);
    return present(dossier, getPiece(dossier.id, p.id));
  });

  const montant = z.number().int().min(0).max(1e12);
  const partie = z.object({ nom: z.string().nullable(), siren: z.string().nullable(), tvaIntra: z.string().nullable(), adresse: z.string().nullable(), iban: z.string().nullable() });
  const extractionSchema = z.object({
    typeDocument: z.enum(Object.keys(LIBELLES_TYPES_PIECE) as [ExtractionPiece["typeDocument"], ...ExtractionPiece["typeDocument"][]]),
    emetteur: partie,
    destinataire: partie,
    numero: z.string().nullable(),
    dateFacture: z.string().refine(isIsoDate).nullable(),
    dateEcheance: z.string().refine(isIsoDate).nullable(),
    devise: z.string(),
    lignes: z.array(z.object({ designation: z.string(), montantHT: montant, tauxTvaBp: z.number().int() })),
    ventilationTva: z.array(z.object({ tauxBp: z.number().int(), baseHT: montant, tva: montant })),
    totalHT: montant,
    totalTVA: montant,
    totalTTC: montant,
    compteSuggere: z.string().nullable(),
    justificationCompte: z.string().nullable(),
    confiance: z.number().min(0).max(1),
    remarques: z.array(z.string()),
    source: z.enum(["ia", "facturx"]),
  });

  /** Correction manuelle des données lues (ou saisie complète si la pièce n'a pas été lue). */
  app.put("/api/dossiers/:dossierId/pieces/:id/extraction", async (req) => {
    const { dossier } = requireDossier(req, "compta:write");
    const p = getPiece(dossier.id, intParam(req, "id"));
    if (p.statut === "comptabilisee") throw conflict("Pièce déjà comptabilisée");
    const e = extractionSchema.parse(req.body);
    db.run("UPDATE pieces SET extraction = ?, statut = 'a_valider', erreur = NULL WHERE id = ?", JSON.stringify(e), p.id);
    log(req, "piece.corrigee", dossier.id, p.id);
    return present(dossier, getPiece(dossier.id, p.id));
  });

  app.post("/api/dossiers/:dossierId/pieces/:id/comptabiliser", async (req, reply) => {
    const { user, dossier } = requireDossier(req, "compta:write");
    const p = getPiece(dossier.id, intParam(req, "id"));
    if (p.statut === "comptabilisee") throw conflict("Pièce déjà comptabilisée");
    if (!p.extraction) throw unprocessable("Aucune donnée : complétez la pièce avant de la comptabiliser");
    const b = z
      .object({ compte: z.string().trim().toUpperCase().regex(/^[267][0-9]{1,7}[0-9A-Z]{0,12}$/, "Compte de classe 2, 6 ou 7 attendu"), compteAux: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,17}$/) })
      .parse(req.body);
    const e = JSON.parse(p.extraction) as ExtractionPiece;
    const a = analyser(dossier, e);
    const bloquants = a.controles.filter((c) => c.niveau === "bloquant");
    if (bloquants.length) throw unprocessable("La pièce comporte des anomalies bloquantes", bloquants);
    const res = db.transaction(() => {
      // Création du tiers s'il n'existe pas (avec SIREN, TVA et IBAN chiffré).
      let tiersCree = false;
      if (!db.get("SELECT 1 FROM tiers WHERE dossier_id = ? AND compte_aux = ?", dossier.id, b.compteAux)) {
        const pt = a.tiers.type === "client" ? e.destinataire : e.emetteur;
        const siren = pt.siren && validateSiren(pt.siren).valid ? pt.siren.replace(/\s/g, "") : null;
        const iban = pt.iban && validateIban(pt.iban).valid ? pt.iban.replace(/\s/g, "") : null;
        db.run(
          "INSERT INTO tiers (dossier_id, type, compte_aux, nom, siren, tva_intra, adresse, iban_enc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          dossier.id, a.tiers.type, b.compteAux, (pt.nom ?? b.compteAux).slice(0, 200), siren, pt.tvaIntra?.replace(/\s/g, "").toUpperCase() ?? null,
          pt.adresse?.slice(0, 300) ?? null, cipher.encrypt(iban),
        );
        tiersCree = true;
      }
      const ecriture = propositionEcriture(e, { compte: b.compte, compteAux: b.compteAux });
      const ecritureId = compta.create(dossier.id, ecriture, user.id);
      db.run("UPDATE pieces SET statut = 'comptabilisee', ecriture_id = ?, traitee_at = ? WHERE id = ?", ecritureId, ctx.now().toISOString(), p.id);
      return { ecritureId, tiersCree };
    });
    log(req, "piece.comptabilisee", dossier.id, p.id, { ...res, compte: b.compte, source: p.source });
    reply.code(201);
    return { ...res, ecriture: compta.ecriture(dossier.id, res.ecritureId) };
  });

  app.post("/api/dossiers/:dossierId/pieces/:id/rejeter", async (req) => {
    const { dossier } = requireDossier(req, "compta:write");
    const p = getPiece(dossier.id, intParam(req, "id"));
    if (p.statut === "comptabilisee") throw conflict("Pièce déjà comptabilisée");
    db.run("UPDATE pieces SET statut = 'rejetee' WHERE id = ?", p.id);
    log(req, "piece.rejetee", dossier.id, p.id);
    return { ok: true };
  });

  app.delete("/api/dossiers/:dossierId/pieces/:id", async (req) => {
    const { dossier } = requireDossier(req, "compta:write");
    const p = getPiece(dossier.id, intParam(req, "id"));
    db.run("DELETE FROM pieces WHERE id = ?", p.id);
    log(req, "piece.supprimee", dossier.id, p.id, { fichier: p.nom_fichier });
    return { ok: true };
  });

  // -- Banque : suggestions d'imputation par l'IA ------------------------------------

  app.post("/api/dossiers/:dossierId/banque/suggestions-ia", async (req) => {
    const { dossier } = requireDossier(req, "compta:write");
    if (!ctx.ia) throw unprocessable("Assistance IA non configurée sur ce serveur");
    if (!dossier.ia_autorisee) throw unprocessable("L'assistance IA n'est pas autorisée pour ce dossier (onglet Mission)");
    const lignes = db.all<{ id: number; date: string; libelle: string; montant: number }>(
      "SELECT id, date, libelle, montant FROM lignes_bancaires WHERE dossier_id = ? AND statut = 'a_traiter' ORDER BY date LIMIT 100",
      dossier.id,
    );
    if (lignes.length === 0) return { suggestions: [] };
    try {
      const tiers = tiersDossier(dossier.id);
      const { suggestions: brutes, usage } = await ctx.ia.suggererImputations(lignes, {
        raisonSociale: dossier.raison_sociale,
        siren: dossier.siren,
        habitudes: habitudesDossier(ctx, dossier.id),
        tiers: tiers.map((t) => ({ compteAux: t.compteAux, nom: t.nom, type: t.type })),
      });
      // Garde-fou indépendant du modèle : opérations connues, comptes valides, tiers existants.
      const ids = new Set(lignes.map((l) => l.id));
      const auxConnus = new Set(tiers.map((t) => t.compteAux));
      const vus = new Set<number>();
      const suggestions = brutes
        .filter((s) => ids.has(s.id) && !vus.has(s.id) && vus.add(s.id) && /^[1-8][0-9]{1,7}[0-9A-Z]{0,12}$/.test(s.compte))
        .map((s) => ({ ...s, compteAux: s.compteAux && auxConnus.has(s.compteAux) ? s.compteAux : null, confiance: Math.min(1, Math.max(0, s.confiance)) }));
      log(req, "ia.suggestions_banque", dossier.id, null, { lignes: lignes.length, modele: usage.modele, tokensEntree: usage.tokensEntree, tokensSortie: usage.tokensSortie });
      return { suggestions };
    } catch (err) {
      if (err instanceof ErreurIA) throw unprocessable(err.message);
      throw err;
    }
  });
}
