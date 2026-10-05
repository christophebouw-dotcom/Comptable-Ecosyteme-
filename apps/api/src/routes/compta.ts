import {
  type RegimeTva,
  calendrierFiscal,
  computeBalance,
  computeBilan,
  computeCompteResultat,
  computeDeclarationTva,
  computeGrandLivre,
  controlerFec,
  ecritureLiquidationTva,
  encodeLatin9,
  fecFileName,
  generateFec,
  isIsoDate,
} from "@compta/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { unprocessable } from "../http/errors.js";
import { intParam, requireDossier, requireUser } from "../http/guards.js";
import { assertPeriod } from "../services/compta.js";

const isoDate = z.string().refine(isIsoDate, "Date invalide (AAAA-MM-JJ)");
const cents = z.number().int().min(0).max(1e13);

export const ecritureSchema = z.object({
  journal: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/),
  date: isoDate,
  libelle: z.string().trim().min(1).max(200),
  pieceRef: z.string().trim().min(1).max(60),
  pieceDate: isoDate.optional(),
  lignes: z
    .array(
      z.object({
        compte: z.string().trim().toUpperCase().regex(/^[1-8][0-9]{1,7}[0-9A-Z]{0,12}$/, "Numéro de compte invalide"),
        compteAux: z.string().trim().toUpperCase().max(17).nullish(),
        libelle: z.string().trim().max(200).optional(),
        debit: cents.default(0),
        credit: cents.default(0),
        tauxTva: z.number().int().min(0).max(10000).nullish(),
      }),
    )
    .min(2)
    .max(500),
});

const filterSchema = z.object({
  exerciceId: z.coerce.number().int().positive().optional(),
  journal: z.string().max(6).optional(),
  statut: z.enum(["brouillard", "validee"]).optional(),
  compte: z.string().max(20).optional(),
  debut: isoDate.optional(),
  fin: isoDate.optional(),
});

export async function comptaRoutes(app: FastifyInstance) {
  const { compta, audit, db } = app.ctx;
  const log = (req: Parameters<typeof requireDossier>[0], action: string, dossierId: number, entityId: number | string | null, details?: Record<string, unknown>) => {
    const u = req.user!;
    audit.record({ userId: u.id, userEmail: u.email, action, entity: "ecriture", entityId, dossierId, ip: req.ip, details });
  };

  /** Exercice demandé, ou exercice ouvert le plus ancien par défaut. */
  const exerciceParDefaut = (dossierId: number, exerciceId?: number) => {
    if (exerciceId) return compta.exercice(dossierId, exerciceId);
    const all = compta.exercices(dossierId);
    const ex = [...all].reverse().find((e) => e.statut === "ouvert") ?? all[0];
    if (!ex) throw unprocessable("Aucun exercice pour ce dossier");
    return ex;
  };

  app.get("/api/dossiers/:dossierId/ecritures", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    const f = filterSchema.parse(req.query);
    assertPeriod(f.debut, f.fin);
    return compta.ecritures(dossier.id, f);
  });

  app.get("/api/dossiers/:dossierId/ecritures/:id", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    return compta.ecriture(dossier.id, intParam(req, "id"));
  });

  app.post("/api/dossiers/:dossierId/ecritures", async (req, reply) => {
    const { user, dossier } = requireDossier(req, "compta:write");
    const body = ecritureSchema.parse(req.body);
    const id = compta.create(dossier.id, body, user.id);
    log(req, "ecriture.creee", dossier.id, id, { piece: body.pieceRef, journal: body.journal });
    reply.code(201);
    return compta.ecriture(dossier.id, id);
  });

  app.put("/api/dossiers/:dossierId/ecritures/:id", async (req) => {
    const { dossier } = requireDossier(req, "compta:write");
    const id = intParam(req, "id");
    compta.update(dossier.id, id, ecritureSchema.parse(req.body));
    log(req, "ecriture.modifiee", dossier.id, id);
    return compta.ecriture(dossier.id, id);
  });

  app.delete("/api/dossiers/:dossierId/ecritures/:id", async (req) => {
    const { dossier } = requireDossier(req, "compta:write");
    const id = intParam(req, "id");
    compta.delete(dossier.id, id);
    log(req, "ecriture.supprimee", dossier.id, id);
    return { ok: true };
  });

  app.post("/api/dossiers/:dossierId/ecritures/valider", async (req) => {
    const { user, dossier } = requireDossier(req, "compta:validate");
    const { ids } = z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000) }).parse(req.body);
    const result = compta.validate(dossier.id, ids, user.id);
    log(req, "ecriture.validee", dossier.id, null, { ecritures: result.map((r) => ({ id: r.id, numero: r.numero })) });
    return result;
  });

  app.post("/api/dossiers/:dossierId/ecritures/:id/extourner", async (req, reply) => {
    const { user, dossier } = requireDossier(req, "compta:validate");
    const id = intParam(req, "id");
    const body = z.object({ date: isoDate, motif: z.string().trim().min(3).max(150) }).parse(req.body);
    const newId = compta.extourner(dossier.id, id, body.date, body.motif, user.id);
    log(req, "ecriture.extournee", dossier.id, id, { extourne: newId, motif: body.motif });
    reply.code(201);
    return compta.ecriture(dossier.id, newId);
  });

  app.post("/api/dossiers/:dossierId/lettrage", async (req) => {
    const { dossier } = requireDossier(req, "compta:write");
    const { ligneIds } = z.object({ ligneIds: z.array(z.number().int().positive()).min(2).max(500) }).parse(req.body);
    const code = compta.lettrer(dossier.id, ligneIds);
    log(req, "lettrage.cree", dossier.id, code, { lignes: ligneIds });
    return { code };
  });

  app.delete("/api/dossiers/:dossierId/lettrage", async (req) => {
    const { dossier } = requireDossier(req, "compta:write");
    const { compte, code } = z.object({ compte: z.string(), code: z.string() }).parse(req.body);
    const n = compta.delettrer(dossier.id, compte, code);
    log(req, "lettrage.supprime", dossier.id, code, { compte });
    return { lignes: n };
  });

  // -- États -------------------------------------------------------------------

  const etatQuery = z.object({
    exerciceId: z.coerce.number().int().positive().optional(),
    niveau: z.coerce.number().int().min(1).max(8).optional(),
    compte: z.string().max(20).optional(),
    inclureBrouillard: z.enum(["0", "1"]).optional(),
  });

  const ecrituresEtat = (dossierId: number, q: z.infer<typeof etatQuery>) => {
    const ex = exerciceParDefaut(dossierId, q.exerciceId);
    return { ex, ecritures: compta.ecritures(dossierId, { exerciceId: ex.id, statut: q.inclureBrouillard === "1" ? undefined : "validee" }) };
  };

  app.get("/api/dossiers/:dossierId/balance", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    const q = etatQuery.parse(req.query);
    const { ex, ecritures } = ecrituresEtat(dossier.id, q);
    return { exercice: ex, ...computeBalance(ecritures, { niveau: q.niveau, libelle: compta.libelleCompte(dossier.id) }) };
  });

  app.get("/api/dossiers/:dossierId/grand-livre", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    const q = etatQuery.parse(req.query);
    const { ex, ecritures } = ecrituresEtat(dossier.id, q);
    return { exercice: ex, comptes: computeGrandLivre(ecritures, { compte: q.compte, libelle: compta.libelleCompte(dossier.id) }) };
  });

  app.get("/api/dossiers/:dossierId/etats", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    const q = etatQuery.parse(req.query);
    const { ex, ecritures } = ecrituresEtat(dossier.id, q);
    // Les à-nouveaux sont exclus du compte de résultat mais inclus au bilan.
    return { exercice: ex, bilan: computeBilan(ecritures), compteResultat: computeCompteResultat(ecritures.filter((e) => e.journal !== "AN")) };
  });

  app.get("/api/dossiers/:dossierId/tva", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    const q = z.object({ debut: isoDate, fin: isoDate, creditAnterieur: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    assertPeriod(q.debut, q.fin);
    const ecritures = compta.ecritures(dossier.id, { debut: q.debut, fin: q.fin });
    const brouillards = ecritures.filter((e) => e.statut === "brouillard").length;
    return { ...computeDeclarationTva(ecritures.filter((e) => e.statut === "validee"), q, q.creditAnterieur), brouillardsExclus: brouillards };
  });

  app.post("/api/dossiers/:dossierId/tva/liquidation", async (req, reply) => {
    const { user, dossier } = requireDossier(req, "compta:write");
    const q = z.object({ debut: isoDate, fin: isoDate, creditAnterieur: z.number().int().min(0).default(0) }).parse(req.body);
    assertPeriod(q.debut, q.fin);
    const ecritures = compta.ecritures(dossier.id, { debut: q.debut, fin: q.fin, statut: "validee" });
    const ecr = ecritureLiquidationTva(computeDeclarationTva(ecritures, q, q.creditAnterieur), q.fin);
    if (!ecr) throw unprocessable("Aucune TVA à liquider sur la période");
    const id = compta.create(dossier.id, ecr, user.id);
    log(req, "tva.liquidation", dossier.id, id, q);
    reply.code(201);
    return compta.ecriture(dossier.id, id);
  });

  // -- Exercices, clôture, FEC ----------------------------------------------------

  app.post("/api/dossiers/:dossierId/exercices/:exerciceId/cloture", async (req) => {
    const { user, dossier } = requireDossier(req, "compta:cloture");
    const exerciceId = intParam(req, "exerciceId");
    const { confirmation } = z.object({ confirmation: z.literal("CLOTURER") }).parse(req.body);
    void confirmation;
    const res = compta.cloturer(dossier.id, exerciceId, user.id);
    audit.record({ userId: user.id, userEmail: user.email, action: "exercice.cloture", entity: "exercice", entityId: exerciceId, dossierId: dossier.id, ip: req.ip, details: res });
    return res;
  });

  app.get("/api/dossiers/:dossierId/exercices/:exerciceId/fec", async (req, reply) => {
    const { user, dossier } = requireDossier(req, "dossiers:read");
    const exerciceId = intParam(req, "exerciceId");
    const q = z.object({ sep: z.enum(["tab", "pipe"]).default("tab"), encoding: z.enum(["latin9", "utf8"]).default("latin9") }).parse(req.query);
    const ex = compta.exercice(dossier.id, exerciceId);
    const text = generateFec(compta.fecLignes(dossier.id, ex.id), q.sep === "tab" ? "\t" : "|");
    const body = q.encoding === "latin9" ? Buffer.from(encodeLatin9(text)) : Buffer.from(text, "utf8");
    audit.record({ userId: user.id, userEmail: user.email, action: "fec.export", entity: "exercice", entityId: ex.id, dossierId: dossier.id, ip: req.ip, details: q });
    reply
      .header("Content-Type", `text/plain; charset=${q.encoding === "latin9" ? "ISO-8859-15" : "utf-8"}`)
      .header("Content-Disposition", `attachment; filename="${fecFileName(dossier.siren, ex.fin)}"`);
    return body;
  });

  app.post("/api/fec/controle", async (req) => {
    requireUser(req);
    const { content } = z.object({ content: z.string().max(50_000_000) }).parse(req.body);
    return controlerFec(content);
  });

  app.get("/api/dossiers/:dossierId/integrite", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    const chain = compta.verifyChain(dossier.id);
    const exercices = compta.exercices(dossier.id).map((e) => ({ id: e.id, debut: e.debut, fin: e.fin, statut: e.statut, empreinte: e.empreinte_cloture }));
    return { ...chain, exercices };
  });

  app.get("/api/dossiers/:dossierId/echeances", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    const { annee } = z.object({ annee: z.coerce.number().int().min(2000).max(2100).optional() }).parse(req.query);
    const ex = db.get<{ fin: string }>("SELECT fin FROM exercices WHERE dossier_id = ? ORDER BY debut DESC LIMIT 1", dossier.id);
    return calendrierFiscal(
      { regimeTva: dossier.regime_tva as RegimeTva, impot: dossier.impot, dateCloture: ex?.fin ?? `${annee ?? new Date().getFullYear()}-12-31` },
      annee ?? app.ctx.now().getFullYear(),
    );
  });
}
