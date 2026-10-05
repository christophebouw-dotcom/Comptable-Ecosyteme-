/**
 * Portail client et échanges cabinet ↔ client : tableau de bord du dirigeant,
 * dépôt de justificatifs, demandes de pièces manquantes et messagerie chiffrée.
 *
 * Cloisonnement : le client n'accède qu'aux dossiers qui lui sont affectés
 * (requireDossier), et seulement aux données utiles au pilotage. Les messages
 * sont chiffrés au repos ; leur contenu n'est jamais écrit au journal d'audit.
 */
import { type Mission, type RegimeTva, computeCompteResultat, controlerMission, prochainesEcheances } from "@compta/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { SessionUser } from "../context.js";
import { conflict, forbidden, notFound, unprocessable } from "../http/errors.js";
import { intParam, requireDossier, requirePerm } from "../http/guards.js";
import { can, seesAllDossiers } from "../security/rbac.js";
import { deposerPiece, depotSchema } from "../services/pieces.js";

interface DemandeRow {
  id: number;
  dossier_id: number;
  ligne_bancaire_id: number | null;
  objet: string;
  date_operation: string | null;
  montant: number | null;
  message: string | null;
  statut: "ouverte" | "repondue" | "close";
  reponse: string | null;
  piece_id: number | null;
  created_at: string;
  repondue_at: string | null;
}

const STATUT_PIECE_CLIENT: Record<string, string> = {
  a_traiter: "Reçue",
  a_valider: "En cours de traitement",
  erreur: "En cours de traitement",
  comptabilisee: "Comptabilisée",
  rejetee: "Écartée par le cabinet",
};

export async function portailRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  const { db, cipher, compta, audit } = ctx;
  const log = (req: FastifyRequest, action: string, dossierId: number, entityId: number | null, details?: Record<string, unknown>) =>
    audit.record({ userId: req.user!.id, userEmail: req.user!.email, action, entity: action.split(".")[0], entityId, dossierId, ip: req.ip, details });

  const cote = (u: SessionUser) => (u.role === "client" ? "client" : "cabinet");

  const presentDemande = (d: DemandeRow) => ({
    id: d.id,
    objet: d.objet,
    dateOperation: d.date_operation,
    montant: d.montant,
    message: d.message,
    statut: d.statut,
    reponse: d.reponse,
    pieceId: d.piece_id,
    ligneBancaireId: d.ligne_bancaire_id,
    createdAt: d.created_at,
    reponduAt: d.repondue_at,
  });

  const nonLus = (dossierId: number, pour: "client" | "cabinet") =>
    db.get<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE dossier_id = ? AND cote <> ? AND lu_at IS NULL", dossierId, pour)!.n;

  // ===========================================================================
  // Espace client
  // ===========================================================================

  app.get("/api/portail/dossiers", async (req) => {
    const user = requirePerm(req, "portail:client");
    const rows = db.all<{ id: number; raison_sociale: string; siren: string; ville: string }>(
      "SELECT d.id, d.raison_sociale, d.siren, d.ville FROM dossiers d JOIN dossier_access a ON a.dossier_id = d.id WHERE a.user_id = ? AND d.archived_at IS NULL ORDER BY d.raison_sociale",
      user.id,
    );
    return rows.map((d) => ({
      id: d.id,
      raisonSociale: d.raison_sociale,
      siren: d.siren,
      ville: d.ville,
      demandesOuvertes: db.get<{ n: number }>("SELECT COUNT(*) AS n FROM demandes_pieces WHERE dossier_id = ? AND statut = 'ouverte'", d.id)!.n,
      messagesNonLus: nonLus(d.id, "client"),
    }));
  });

  app.get("/api/portail/dossiers/:dossierId", async (req) => {
    const { dossier } = requireDossier(req, "portail:client");
    const exercices = compta.exercices(dossier.id).sort((a, b) => a.debut.localeCompare(b.debut));
    const ex = exercices.find((e) => e.statut === "ouvert") ?? exercices.at(-1)!;
    // Situation provisoire : écritures validées et en cours de saisie.
    const ecritures = compta.ecritures(dossier.id, { exerciceId: ex.id }).filter((e) => e.journal !== "AN");
    const toutes = compta.ecritures(dossier.id, { exerciceId: ex.id });
    const solde = (prefixes: RegExp) =>
      toutes.reduce((a, e) => a + e.lignes.filter((l) => prefixes.test(l.compte)).reduce((s, l) => s + l.debit - l.credit, 0), 0);
    const cr = computeCompteResultat(ecritures);
    const caMensuel = new Map<string, number>();
    for (const e of ecritures)
      for (const l of e.lignes)
        if (/^70/.test(l.compte)) caMensuel.set(e.date.slice(0, 7), (caMensuel.get(e.date.slice(0, 7)) ?? 0) + l.credit - l.debit);
    const mois: { mois: string; ca: number }[] = [];
    for (let d = new Date(`${ex.debut}T00:00:00Z`); d.toISOString().slice(0, 10) <= ex.fin && mois.length < 24; d.setUTCMonth(d.getUTCMonth() + 1)) {
      const m = d.toISOString().slice(0, 7);
      mois.push({ mois: m, ca: caMensuel.get(m) ?? 0 });
    }
    const pieces = db.all<{ statut: string; n: number }>("SELECT statut, COUNT(*) AS n FROM pieces WHERE dossier_id = ? GROUP BY statut", dossier.id);
    const mission = db.get<{ data: string }>("SELECT data FROM missions WHERE dossier_id = ?", dossier.id);
    const today = ctx.now().toISOString().slice(0, 10);
    const alertes = controlerMission(mission ? (JSON.parse(mission.data) as Mission) : null, today).filter((a) => a.code === "LETTRE_MISSION");
    return {
      dossier: { id: dossier.id, raisonSociale: dossier.raison_sociale, siren: dossier.siren },
      exercice: { debut: ex.debut, fin: ex.fin, statut: ex.statut },
      indicateurs: {
        chiffreAffaires: caMensuel.size ? [...caMensuel.values()].reduce((a, b) => a + b, 0) : 0,
        resultat: cr.resultatNet || 0,
        tresorerie: solde(/^(51|53)/),
        creancesClients: solde(/^(411|416|418)/),
        dettesFournisseurs: -solde(/^(401|403|404|408)/),
      },
      caMensuel: mois,
      pieces: {
        enCours: pieces.filter((p) => ["a_traiter", "a_valider", "erreur"].includes(p.statut)).reduce((a, p) => a + p.n, 0),
        comptabilisees: pieces.find((p) => p.statut === "comptabilisee")?.n ?? 0,
      },
      demandesOuvertes: db.get<{ n: number }>("SELECT COUNT(*) AS n FROM demandes_pieces WHERE dossier_id = ? AND statut = 'ouverte'", dossier.id)!.n,
      messagesNonLus: nonLus(dossier.id, "client"),
      echeances: prochainesEcheances({ regimeTva: dossier.regime_tva as RegimeTva, impot: dossier.impot, dateCloture: ex.fin }, ctx.now().toISOString(), 4),
      alertes: alertes.map((a) => a.message),
      provisoire: ex.statut === "ouvert",
    };
  });

  app.get("/api/portail/dossiers/:dossierId/documents", async (req) => {
    const { dossier } = requireDossier(req, "portail:client");
    const pieces = db.all<{ id: number; nom_fichier: string; mime: string; taille: number; statut: string; deposee_par_client: number; created_at: string }>(
      "SELECT id, nom_fichier, mime, taille, statut, deposee_par_client, created_at FROM pieces WHERE dossier_id = ? ORDER BY created_at DESC, id DESC LIMIT 300",
      dossier.id,
    );
    const factures = db.all<{ id: number; numero: string; type: string; date_emission: string; total_ttc: number; statut: string; nom: string }>(
      `SELECT f.id, f.numero, f.type, f.date_emission, f.total_ttc, f.statut, t.nom FROM factures f JOIN tiers t ON t.id = f.tiers_id
       WHERE f.dossier_id = ? AND f.statut <> 'brouillon' ORDER BY f.date_emission DESC, f.id DESC LIMIT 300`,
      dossier.id,
    );
    const bulletins = db.all<{ id: number; periode: string; nom_enc: string; prenom_enc: string; net_a_payer: number }>(
      `SELECT b.id, b.periode, s.nom_enc, s.prenom_enc, b.net_a_payer FROM bulletins b JOIN salaries s ON s.id = b.salarie_id
       WHERE b.dossier_id = ? AND b.statut = 'valide' ORDER BY b.periode DESC, s.matricule LIMIT 300`,
      dossier.id,
    );
    return {
      pieces: pieces.map((p) => ({
        id: p.id, nomFichier: p.nom_fichier, mime: p.mime, taille: p.taille, statut: p.statut, statutLibelle: STATUT_PIECE_CLIENT[p.statut] ?? p.statut,
        deposeeParClient: !!p.deposee_par_client, createdAt: p.created_at,
      })),
      factures: factures.map((f) => ({ id: f.id, numero: f.numero, type: f.type, dateEmission: f.date_emission, totalTtc: f.total_ttc, statut: f.statut, client: f.nom })),
      bulletins: bulletins.map((b) => ({ id: b.id, periode: b.periode, salarie: `${cipher.decrypt(b.prenom_enc)} ${cipher.decrypt(b.nom_enc)}`, netAPayer: b.net_a_payer })),
    };
  });

  app.post("/api/portail/dossiers/:dossierId/pieces", async (req, reply) => {
    const { dossier } = requireDossier(req, "portail:client");
    const b = depotSchema.extend({ demandeId: z.number().int().positive().optional(), commentaire: z.string().trim().max(1000).optional() }).parse(req.body);
    const demande = b.demandeId
      ? db.get<DemandeRow>("SELECT * FROM demandes_pieces WHERE id = ? AND dossier_id = ?", b.demandeId, dossier.id)
      : undefined;
    if (b.demandeId && !demande) throw notFound("Demande introuvable");
    if (demande && demande.statut === "close") throw conflict("Cette demande est close");
    const p = await deposerPiece(ctx, req, dossier, b, { parClient: true });
    if (demande) {
      db.run(
        "UPDATE demandes_pieces SET statut = 'repondue', piece_id = ?, reponse = COALESCE(?, reponse), repondue_par = ?, repondue_at = ? WHERE id = ?",
        p.id, b.commentaire || null, req.user!.id, ctx.now().toISOString(), demande.id,
      );
      log(req, "demande.repondue", dossier.id, demande.id, { piece: p.id });
    }
    reply.code(201);
    return { id: p.id, statut: p.statut, statutLibelle: STATUT_PIECE_CLIENT[p.statut] };
  });

  // ===========================================================================
  // Demandes de pièces (cabinet → client)
  // ===========================================================================

  app.get("/api/dossiers/:dossierId/demandes", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    const { statut } = z.object({ statut: z.enum(["ouverte", "repondue", "close"]).optional() }).parse(req.query);
    const rows = db.all<DemandeRow>(
      `SELECT * FROM demandes_pieces WHERE dossier_id = ? ${statut ? "AND statut = ?" : ""} ORDER BY CASE statut WHEN 'ouverte' THEN 0 WHEN 'repondue' THEN 1 ELSE 2 END, created_at DESC LIMIT 500`,
      ...(statut ? [dossier.id, statut] : [dossier.id]),
    );
    return rows.map(presentDemande);
  });

  app.post("/api/dossiers/:dossierId/demandes", async (req, reply) => {
    const { user, dossier } = requireDossier(req, "compta:write");
    const b = z
      .union([
        z.object({ lignesBancaires: z.array(z.number().int().positive()).min(1).max(200), message: z.string().trim().max(1000).optional() }),
        z.object({ objet: z.string().trim().min(3).max(200), message: z.string().trim().max(1000).optional() }),
      ])
      .parse(req.body);
    const ids = db.transaction(() => {
      if ("objet" in b) {
        return [db.run("INSERT INTO demandes_pieces (dossier_id, objet, message, created_by) VALUES (?, ?, ?, ?)", dossier.id, b.objet, b.message ?? null, user.id).lastInsertRowid];
      }
      return b.lignesBancaires.map((lid) => {
        const l = db.get<{ id: number; date: string; libelle: string; montant: number }>(
          "SELECT id, date, libelle, montant FROM lignes_bancaires WHERE id = ? AND dossier_id = ?", lid, dossier.id,
        );
        if (!l) throw notFound(`Opération bancaire ${lid} introuvable`);
        const existante = db.get<{ id: number }>("SELECT id FROM demandes_pieces WHERE ligne_bancaire_id = ? AND statut <> 'close'", l.id);
        if (existante) return existante.id;
        return db.run(
          "INSERT INTO demandes_pieces (dossier_id, ligne_bancaire_id, objet, date_operation, montant, message, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
          dossier.id, l.id, `Justificatif de l'opération « ${l.libelle} »`.slice(0, 200), l.date, l.montant, b.message ?? null, user.id,
        ).lastInsertRowid;
      });
    });
    log(req, "demande.creee", dossier.id, null, { nombre: ids.length });
    reply.code(201);
    return { ids };
  });

  app.post("/api/dossiers/:dossierId/demandes/:id/repondre", async (req) => {
    const { dossier } = requireDossier(req, "portail:client");
    const id = intParam(req, "id");
    const { reponse } = z.object({ reponse: z.string().trim().min(2).max(1000) }).parse(req.body);
    const d = db.get<DemandeRow>("SELECT * FROM demandes_pieces WHERE id = ? AND dossier_id = ?", id, dossier.id);
    if (!d) throw notFound("Demande introuvable");
    if (d.statut === "close") throw conflict("Cette demande est close");
    db.run("UPDATE demandes_pieces SET statut = 'repondue', reponse = ?, repondue_par = ?, repondue_at = ? WHERE id = ?", reponse, req.user!.id, ctx.now().toISOString(), id);
    log(req, "demande.repondue", dossier.id, id);
    return { ok: true };
  });

  app.post("/api/dossiers/:dossierId/demandes/:id/statut", async (req) => {
    const { dossier } = requireDossier(req, "compta:write");
    const id = intParam(req, "id");
    const { statut } = z.object({ statut: z.enum(["ouverte", "close"]) }).parse(req.body);
    const r = db.run(
      `UPDATE demandes_pieces SET statut = ?, close_at = ${statut === "close" ? "?" : "NULL"} WHERE id = ? AND dossier_id = ?`,
      ...(statut === "close" ? [statut, ctx.now().toISOString(), id, dossier.id] : [statut, id, dossier.id]),
    );
    if (!r.changes) throw notFound("Demande introuvable");
    log(req, statut === "close" ? "demande.close" : "demande.relancee", dossier.id, id);
    return { ok: true };
  });

  // ===========================================================================
  // Messagerie
  // ===========================================================================

  app.get("/api/dossiers/:dossierId/messages", async (req) => {
    const { user, dossier } = requireDossier(req, "dossiers:read");
    const rows = db.all<{ id: number; auteur_id: number; cote: string; contenu_enc: string; demande_id: number | null; created_at: string; lu_at: string | null; nom: string }>(
      `SELECT m.*, u.nom FROM messages m JOIN users u ON u.id = m.auteur_id WHERE m.dossier_id = ? ORDER BY m.created_at, m.id LIMIT 1000`,
      dossier.id,
    );
    // Lecture : les messages de l'autre partie sont marqués lus.
    const moi = cote(user);
    db.run("UPDATE messages SET lu_at = ? WHERE dossier_id = ? AND cote <> ? AND lu_at IS NULL", ctx.now().toISOString(), dossier.id, moi);
    return rows.map((m) => ({
      id: m.id,
      auteur: m.nom,
      cote: m.cote,
      moi: m.auteur_id === user.id,
      contenu: cipher.decrypt(m.contenu_enc),
      demandeId: m.demande_id,
      createdAt: m.created_at,
      lu: !!m.lu_at,
    }));
  });

  app.post("/api/dossiers/:dossierId/messages", async (req, reply) => {
    const { user, dossier } = requireDossier(req, "dossiers:read");
    // Côté cabinet, seuls les profils qui interviennent sur le dossier écrivent au client.
    if (user.role !== "client" && !can(user.role, "compta:write")) throw forbidden();
    const { contenu, demandeId } = z.object({ contenu: z.string().trim().min(1).max(5000), demandeId: z.number().int().positive().optional() }).parse(req.body);
    if (demandeId && !db.get("SELECT 1 FROM demandes_pieces WHERE id = ? AND dossier_id = ?", demandeId, dossier.id)) throw unprocessable("Demande inconnue");
    const id = db.run(
      "INSERT INTO messages (dossier_id, auteur_id, cote, contenu_enc, demande_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      dossier.id, user.id, cote(user), cipher.encrypt(contenu), demandeId ?? null, ctx.now().toISOString(),
    ).lastInsertRowid;
    log(req, "message.envoye", dossier.id, id, { cote: cote(user), longueur: contenu.length });
    reply.code(201);
    return { id };
  });

  /** Activité client à traiter, pour le tableau de bord du cabinet. */
  app.get("/api/echanges/a-traiter", async (req) => {
    const user = requirePerm(req, "compta:write");
    const dossiers = seesAllDossiers(user.role)
      ? db.all<{ id: number; raison_sociale: string }>("SELECT id, raison_sociale FROM dossiers WHERE archived_at IS NULL")
      : db.all<{ id: number; raison_sociale: string }>(
          "SELECT d.id, d.raison_sociale FROM dossiers d JOIN dossier_access a ON a.dossier_id = d.id WHERE a.user_id = ? AND d.archived_at IS NULL", user.id,
        );
    return dossiers
      .map((d) => ({
        dossierId: d.id,
        raisonSociale: d.raison_sociale,
        messagesNonLus: nonLus(d.id, "cabinet"),
        demandesRepondues: db.get<{ n: number }>("SELECT COUNT(*) AS n FROM demandes_pieces WHERE dossier_id = ? AND statut = 'repondue'", d.id)!.n,
        piecesClient: db.get<{ n: number }>("SELECT COUNT(*) AS n FROM pieces WHERE dossier_id = ? AND deposee_par_client = 1 AND statut IN ('a_traiter','a_valider','erreur')", d.id)!.n,
      }))
      .filter((d) => d.messagesNonLus + d.demandesRepondues + d.piecesClient > 0);
  });
}
