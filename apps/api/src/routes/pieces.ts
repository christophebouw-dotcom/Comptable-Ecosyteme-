/**
 * Pièces justificatives : dépôt, lecture automatique (facture électronique ou
 * IA), contrôle, comptabilisation assistée et archivage chiffré.
 */
import {
  type ControlePiece,
  type ExtractionPiece,
  LIBELLES_TYPES_PIECE,
  type TiersConnu,
  controlerExtraction,
  isIsoDate,
  propositionEcriture,
  rapprocherTiers,
  validateIban,
  validateSiren,
} from "@compta/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { conflict, notFound, unprocessable } from "../http/errors.js";
import { type DossierRow, intParam, requireDossier } from "../http/guards.js";
import { ErreurIA } from "../services/ia.js";
import { type PieceRow, deposerPiece, depotSchema, habitudesDossier, lirePiece } from "../services/pieces.js";

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
      deposeeParClient: !!p.deposee_par_client,
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

  const lire = (req: FastifyRequest, dossier: DossierRow, p: PieceRow) => lirePiece(ctx, req, dossier, p);

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
    const { dossier } = requireDossier(req, "compta:write");
    const p = await deposerPiece(ctx, req, dossier, depotSchema.parse(req.body));
    reply.code(201);
    return present(dossier, p);
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
