import {
  CONTEXTES,
  LIBELLES_BASES_LEGALES,
  LIBELLES_DEMANDES,
  REGISTRE_PAR_DEFAUT,
  REGLES_CONSERVATION,
  type Traitement,
  type TypeDemande,
  delaiReponse,
  echeanceNotification,
  evaluerViolation,
  heuresRestantes,
  isIsoDate,
  joursRestants,
  modeleReponse,
  urgence,
} from "@compta/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { conflict, notFound, unprocessable } from "../http/errors.js";
import { intParam, requirePerm } from "../http/guards.js";
import { RgpdService } from "../services/rgpd.js";

const isoDate = z.string().refine(isIsoDate, "Date invalide");
const TYPES = Object.keys(LIBELLES_DEMANDES) as [TypeDemande, ...TypeDemande[]];

const traitementSchema = z.object({
  reference: z.string().trim().regex(/^[A-Z0-9-]{2,12}$/),
  nom: z.string().trim().min(3).max(200),
  role: z.enum(["responsable", "sous_traitant"]),
  finalites: z.array(z.string().trim().min(1)).min(1),
  baseLegale: z.enum(Object.keys(LIBELLES_BASES_LEGALES) as [string, ...string[]]),
  precisionBaseLegale: z.string().trim().max(300).optional(),
  personnesConcernees: z.array(z.string().trim().min(1)).min(1),
  categoriesDonnees: z.array(z.string().trim().min(1)).min(1),
  donneesSensibles: z.boolean(),
  destinataires: z.array(z.string().trim()),
  transfertsHorsUE: z.string().trim(),
  conservation: z.array(z.enum(Object.keys(REGLES_CONSERVATION) as [string, ...string[]])).min(1),
  mesuresSecurite: z.array(z.string().trim()),
  aipdRequise: z.boolean(),
});

interface DemandeRow {
  id: number;
  type: TypeDemande;
  statut: string;
  demandeur_nom_enc: string;
  demandeur_email_enc: string | null;
  canal: string | null;
  recue_le: string;
  echeance: string;
  prolongee: number;
  identite_verifiee: number;
  analyse: string | null;
  reponse: string | null;
  cloturee_le: string | null;
  created_at: string;
}

interface ViolationRow {
  id: number;
  titre: string;
  description: string;
  connue_le: string;
  dpc: number;
  ei: number;
  circonstances: string;
  score: number;
  niveau: string;
  notification_cnil_requise: number;
  notifiee_cnil_le: string | null;
  information_personnes_requise: number;
  personnes_informees_le: string | null;
  nb_personnes: number | null;
  categories_donnees: string | null;
  mesures: string | null;
  statut: string;
  created_at: string;
}

export async function rgpdRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  const { db, cipher, audit } = ctx;
  const service = new RgpdService(ctx);
  const today = () => ctx.now().toISOString().slice(0, 10);
  const log = (req: Parameters<typeof requirePerm>[0], action: string, entity: string, entityId: number | string | null, details?: Record<string, unknown>) =>
    audit.record({ userId: req.user!.id, userEmail: req.user!.email, action, entity, entityId, ip: req.ip, details });

  // -- Registre des traitements (art. 30) -------------------------------------

  const ensureRegistre = () => {
    if (db.get<{ n: number }>("SELECT COUNT(*) AS n FROM registre_traitements")!.n === 0) {
      for (const t of REGISTRE_PAR_DEFAUT) db.run("INSERT INTO registre_traitements (reference, data) VALUES (?, ?)", t.reference, JSON.stringify(t));
    }
  };

  app.get("/api/rgpd/registre", async (req) => {
    requirePerm(req, "rgpd:manage");
    ensureRegistre();
    return {
      traitements: db.all<{ data: string; updated_at: string }>("SELECT data, updated_at FROM registre_traitements ORDER BY reference").map((r) => ({
        ...(JSON.parse(r.data) as Traitement),
        updatedAt: r.updated_at,
      })),
      basesLegales: LIBELLES_BASES_LEGALES,
      conservation: REGLES_CONSERVATION,
    };
  });

  app.put("/api/rgpd/registre/:reference", async (req) => {
    const user = requirePerm(req, "rgpd:manage");
    const ref = (req.params as { reference: string }).reference;
    const body = traitementSchema.parse(req.body);
    if (body.reference !== ref) throw unprocessable("La référence ne peut être modifiée");
    const r = db.run("UPDATE registre_traitements SET data = ?, updated_at = ?, updated_by = ? WHERE reference = ?", JSON.stringify(body), ctx.now().toISOString(), user.id, ref);
    if (!r.changes) throw notFound("Traitement introuvable");
    log(req, "rgpd.registre_modifie", "traitement", ref);
    return { ok: true };
  });

  app.post("/api/rgpd/registre", async (req, reply) => {
    const user = requirePerm(req, "rgpd:manage");
    ensureRegistre();
    const body = traitementSchema.parse(req.body);
    if (db.get("SELECT 1 FROM registre_traitements WHERE reference = ?", body.reference)) throw conflict("Référence déjà utilisée");
    db.run("INSERT INTO registre_traitements (reference, data, updated_by) VALUES (?, ?, ?)", body.reference, JSON.stringify(body), user.id);
    log(req, "rgpd.registre_ajout", "traitement", body.reference);
    reply.code(201);
    return { ok: true };
  });

  // -- Demandes d'exercice des droits (art. 12 à 22) ---------------------------------

  const presentDemande = (d: DemandeRow) => ({
    id: d.id,
    type: d.type,
    typeLibelle: LIBELLES_DEMANDES[d.type].libelle,
    article: LIBELLES_DEMANDES[d.type].article,
    statut: d.statut,
    demandeur: cipher.decrypt(d.demandeur_nom_enc),
    email: cipher.decrypt(d.demandeur_email_enc),
    canal: d.canal,
    recueLe: d.recue_le,
    echeance: d.echeance,
    prolongee: !!d.prolongee,
    identiteVerifiee: !!d.identite_verifiee,
    joursRestants: d.cloturee_le ? null : joursRestants(d.echeance, today()),
    urgence: d.cloturee_le ? null : urgence(d.echeance, today()),
    analyse: d.analyse ? JSON.parse(d.analyse) : null,
    reponse: d.reponse,
    clotureeLe: d.cloturee_le,
  });

  const getDemande = (id: number) => {
    const d = db.get<DemandeRow>("SELECT * FROM demandes_droits WHERE id = ?", id);
    if (!d) throw notFound("Demande introuvable");
    return d;
  };

  app.get("/api/rgpd/demandes", async (req) => {
    requirePerm(req, "rgpd:manage");
    return db.all<DemandeRow>("SELECT * FROM demandes_droits ORDER BY cloturee_le IS NOT NULL, echeance").map(presentDemande);
  });

  app.post("/api/rgpd/demandes", async (req, reply) => {
    const user = requirePerm(req, "rgpd:manage");
    const body = z
      .object({ type: z.enum(TYPES), nom: z.string().trim().min(2).max(200), email: z.email(), canal: z.string().trim().max(60).default("e-mail"), recueLe: isoDate.optional() })
      .parse(req.body);
    const recue = body.recueLe ?? today();
    const id = db.run(
      `INSERT INTO demandes_droits (type, statut, demandeur_nom_enc, demandeur_email_enc, demandeur_email_hash, canal, recue_le, echeance, created_by)
       VALUES (?, 'identite_a_verifier', ?, ?, ?, ?, ?, ?, ?)`,
      body.type, cipher.encrypt(body.nom), cipher.encrypt(body.email), cipher.blindIndex(body.email), body.canal, recue, delaiReponse(recue), user.id,
    ).lastInsertRowid;
    log(req, "rgpd.demande_recue", "demande", id, { type: body.type });
    reply.code(201);
    return presentDemande(getDemande(id));
  });

  app.patch("/api/rgpd/demandes/:id", async (req) => {
    requirePerm(req, "rgpd:manage");
    const d = getDemande(intParam(req, "id"));
    if (d.cloturee_le) throw conflict("Demande clôturée");
    const body = z
      .object({ identiteVerifiee: z.boolean().optional(), prolonger: z.literal(true).optional(), refuser: z.string().trim().min(10).max(2000).optional() })
      .parse(req.body);
    db.transaction(() => {
      if (body.identiteVerifiee) db.run("UPDATE demandes_droits SET identite_verifiee = 1, statut = 'en_cours' WHERE id = ?", d.id);
      if (body.prolonger) {
        if (d.prolongee) throw conflict("Délai déjà prolongé");
        db.run("UPDATE demandes_droits SET prolongee = 1, statut = 'prolongee', echeance = ? WHERE id = ?", delaiReponse(d.recue_le, true), d.id);
      }
      if (body.refuser) {
        db.run("UPDATE demandes_droits SET statut = 'refusee', reponse = ?, cloturee_le = ? WHERE id = ?", body.refuser, today(), d.id);
      }
    });
    log(req, "rgpd.demande_maj", "demande", d.id, body);
    return presentDemande(getDemande(d.id));
  });

  app.get("/api/rgpd/demandes/:id/analyse", async (req) => {
    requirePerm(req, "rgpd:manage");
    const d = getDemande(intParam(req, "id"));
    const email = cipher.decrypt(d.demandeur_email_enc);
    if (!email) throw unprocessable("Adresse e-mail du demandeur manquante");
    return {
      inventaire: service.inventaire(email),
      decisions: d.type === "effacement" ? service.analyserEffacement(email) : null,
      apercu: d.type === "acces" || d.type === "portabilite" ? service.exportPersonne(email) : null,
    };
  });

  /** Traite la demande : exécute l'effacement ou produit l'export, puis clôture avec la réponse. */
  app.post("/api/rgpd/demandes/:id/traiter", async (req) => {
    requirePerm(req, "rgpd:manage");
    const d = getDemande(intParam(req, "id"));
    if (d.cloturee_le) throw conflict("Demande déjà clôturée");
    if (!d.identite_verifiee) throw unprocessable("Vérifiez l'identité du demandeur avant de traiter la demande (art. 12.6)");
    const email = cipher.decrypt(d.demandeur_email_enc)!;
    const nom = cipher.decrypt(d.demandeur_nom_enc)!;
    let analyse: unknown = null;
    let reponse: string;
    if (d.type === "effacement") {
      const res = service.executerEffacement(email);
      analyse = res;
      reponse = modeleReponse("effacement", nom, res.decisions);
    } else if (d.type === "acces" || d.type === "portabilite") {
      analyse = { export: service.exportPersonne(email) };
      reponse = modeleReponse(d.type, nom);
    } else if (d.type === "retrait_consentement" || d.type === "opposition") {
      const h = cipher.blindIndex(email)!;
      const finalites = db.all<{ finalite: string }>("SELECT DISTINCT finalite FROM consentements WHERE email_hash = ?", h);
      for (const f of finalites) {
        db.run("INSERT INTO consentements (email_hash, finalite, accorde, source, texte_version) VALUES (?, ?, 0, ?, 'retrait')", h, f.finalite, `demande-${d.id}`);
      }
      analyse = { finalitesRetirees: finalites.map((f) => f.finalite) };
      reponse = modeleReponse(d.type, nom);
    } else {
      reponse = modeleReponse(d.type, nom);
    }
    db.run("UPDATE demandes_droits SET statut = 'traitee', analyse = ?, reponse = ?, cloturee_le = ? WHERE id = ?", JSON.stringify(analyse), reponse, today(), d.id);
    log(req, "rgpd.demande_traitee", "demande", d.id, { type: d.type });
    return presentDemande(getDemande(d.id));
  });

  app.get("/api/rgpd/demandes/:id/export", async (req, reply) => {
    requirePerm(req, "rgpd:manage");
    const d = getDemande(intParam(req, "id"));
    if (d.type !== "acces" && d.type !== "portabilite") throw unprocessable("Export disponible pour les demandes d'accès et de portabilité");
    if (!d.identite_verifiee) throw unprocessable("Identité du demandeur non vérifiée");
    const email = cipher.decrypt(d.demandeur_email_enc)!;
    log(req, "rgpd.export_donnees", "demande", d.id);
    reply.header("Content-Type", "application/json; charset=utf-8").header("Content-Disposition", `attachment; filename="donnees-personnelles-demande-${d.id}.json"`);
    return JSON.stringify(service.exportPersonne(email), null, 2);
  });

  // -- Violations de données (art. 33 et 34) -------------------------------------

  const presentViolation = (v: ViolationRow) => ({
    id: v.id,
    titre: v.titre,
    description: v.description,
    connueLe: v.connue_le,
    echeanceNotification: echeanceNotification(v.connue_le),
    heuresRestantes: v.notifiee_cnil_le || !v.notification_cnil_requise ? null : heuresRestantes(v.connue_le, ctx.now().toISOString()),
    dpc: v.dpc,
    ei: v.ei,
    circonstances: JSON.parse(v.circonstances),
    score: v.score,
    niveau: v.niveau,
    notificationCnilRequise: !!v.notification_cnil_requise,
    notifieeCnilLe: v.notifiee_cnil_le,
    informationPersonnesRequise: !!v.information_personnes_requise,
    personnesInformeesLe: v.personnes_informees_le,
    nbPersonnes: v.nb_personnes,
    categoriesDonnees: v.categories_donnees,
    mesures: v.mesures,
    statut: v.statut,
  });

  app.get("/api/rgpd/violations", async (req) => {
    requirePerm(req, "rgpd:manage");
    return { violations: db.all<ViolationRow>("SELECT * FROM violations ORDER BY connue_le DESC").map(presentViolation), contextes: CONTEXTES };
  });

  const circonstancesSchema = z.object({
    confidentialite: z.enum(["aucune", "limitee", "large"]),
    integrite: z.enum(["aucune", "recuperable", "irrecuperable"]),
    disponibilite: z.enum(["aucune", "temporaire", "definitive"]),
    malveillance: z.boolean(),
  });

  app.post("/api/rgpd/violations/evaluer", async (req) => {
    requirePerm(req, "rgpd:manage");
    const b = z.object({ dpc: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), ei: z.union([z.literal(0.25), z.literal(0.5), z.literal(0.75), z.literal(1)]), circonstances: circonstancesSchema }).parse(req.body);
    return evaluerViolation(b.dpc, b.ei, b.circonstances);
  });

  app.post("/api/rgpd/violations", async (req, reply) => {
    const user = requirePerm(req, "rgpd:manage");
    const b = z
      .object({
        titre: z.string().trim().min(3).max(200),
        description: z.string().trim().min(10).max(5000),
        connueLe: z.iso.datetime(),
        dpc: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
        ei: z.union([z.literal(0.25), z.literal(0.5), z.literal(0.75), z.literal(1)]),
        circonstances: circonstancesSchema,
        nbPersonnes: z.number().int().min(0).optional(),
        categoriesDonnees: z.string().trim().max(500).optional(),
        mesures: z.string().trim().max(5000).optional(),
      })
      .parse(req.body);
    const ev = evaluerViolation(b.dpc, b.ei, b.circonstances);
    const id = db.run(
      `INSERT INTO violations (titre, description, connue_le, dpc, ei, circonstances, score, niveau, notification_cnil_requise, information_personnes_requise,
         nb_personnes, categories_donnees, mesures, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.titre, b.description, b.connueLe, b.dpc, b.ei, JSON.stringify(b.circonstances), ev.score, ev.niveau, ev.notificationCnil ? 1 : 0,
      ev.informationPersonnes ? 1 : 0, b.nbPersonnes ?? null, b.categoriesDonnees ?? null, b.mesures ?? null, user.id,
    ).lastInsertRowid;
    log(req, "rgpd.violation_declaree", "violation", id, { niveau: ev.niveau });
    reply.code(201);
    return { ...presentViolation(db.get<ViolationRow>("SELECT * FROM violations WHERE id = ?", id)!), evaluation: ev };
  });

  app.patch("/api/rgpd/violations/:id", async (req) => {
    requirePerm(req, "rgpd:manage");
    const id = intParam(req, "id");
    const v = db.get<ViolationRow>("SELECT * FROM violations WHERE id = ?", id);
    if (!v) throw notFound();
    const b = z
      .object({ notifieeCnilLe: z.iso.datetime().optional(), personnesInformeesLe: z.iso.datetime().optional(), mesures: z.string().trim().max(5000).optional(), cloturer: z.boolean().optional() })
      .parse(req.body);
    db.run(
      `UPDATE violations SET notifiee_cnil_le = COALESCE(?, notifiee_cnil_le), personnes_informees_le = COALESCE(?, personnes_informees_le),
         mesures = COALESCE(?, mesures), statut = CASE WHEN ? THEN 'cloturee' ELSE statut END WHERE id = ?`,
      b.notifieeCnilLe ?? null, b.personnesInformeesLe ?? null, b.mesures ?? null, b.cloturer ? 1 : 0, id,
    );
    log(req, "rgpd.violation_maj", "violation", id, b);
    return presentViolation(db.get<ViolationRow>("SELECT * FROM violations WHERE id = ?", id)!);
  });

  // -- Consentements (art. 7) ---------------------------------------------------

  app.post("/api/rgpd/consentements", async (req, reply) => {
    requirePerm(req, "rgpd:manage");
    const b = z
      .object({ email: z.email(), finalite: z.string().trim().min(3).max(100), accorde: z.boolean(), source: z.string().trim().max(100), texteVersion: z.string().trim().max(40) })
      .parse(req.body);
    db.run(
      "INSERT INTO consentements (email_hash, finalite, accorde, source, texte_version) VALUES (?, ?, ?, ?, ?)",
      cipher.blindIndex(b.email)!, b.finalite, b.accorde ? 1 : 0, b.source, b.texteVersion,
    );
    reply.code(201);
    return { ok: true };
  });

  app.get("/api/rgpd/consentements", async (req) => {
    requirePerm(req, "rgpd:manage");
    const { email } = z.object({ email: z.email() }).parse(req.query);
    return db.all("SELECT finalite, accorde, source, texte_version, at FROM consentements WHERE email_hash = ? ORDER BY at", cipher.blindIndex(email)!);
  });

  // -- Conservation & purge (art. 5.1.e) ---------------------------------------

  app.post("/api/rgpd/purge", async (req) => {
    requirePerm(req, "rgpd:manage");
    const { dryRun } = z.object({ dryRun: z.boolean().default(true) }).parse(req.body ?? {});
    const res = service.purger(dryRun);
    if (!dryRun) log(req, "rgpd.purge", "conservation", null, { rapport: res.rapport.filter((r) => r.nombre > 0) });
    return res;
  });

  app.get("/api/rgpd/tableau-de-bord", async (req) => {
    requirePerm(req, "rgpd:manage");
    ensureRegistre();
    const demandes = db.all<DemandeRow>("SELECT * FROM demandes_droits WHERE cloturee_le IS NULL").map(presentDemande);
    const violations = db.all<ViolationRow>("SELECT * FROM violations WHERE statut = 'ouverte'").map(presentViolation);
    const registre = db.all<{ data: string }>("SELECT data FROM registre_traitements").map((r) => JSON.parse(r.data) as Traitement);
    return {
      demandesEnCours: demandes.length,
      demandesUrgentes: demandes.filter((d) => d.urgence === "urgent" || d.urgence === "depassee").length,
      prochainesDemandes: demandes.sort((a, b) => a.echeance.localeCompare(b.echeance)).slice(0, 5),
      violationsOuvertes: violations.length,
      notificationsEnAttente: violations.filter((v) => v.notificationCnilRequise && !v.notifieeCnilLe),
      traitements: registre.length,
      aipdRequises: registre.filter((t) => t.aipdRequise).map((t) => ({ reference: t.reference, nom: t.nom })),
      simulationPurge: service.purger(true).rapport.filter((r) => r.nombre > 0),
    };
  });
}
