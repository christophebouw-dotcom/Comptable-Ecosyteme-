/**
 * Écritures d'inventaire : régularisations de fin d'exercice (cut-off),
 * suggestions automatiques et extournes à l'ouverture de l'exercice suivant.
 */
import {
  LIBELLES_REGULARISATIONS,
  type Regularisation,
  type TypeRegularisation,
  ajouterJours,
  contrepartieParDefaut,
  controlerRegularisation,
  ecritureRegularisation,
  extournable,
  isIsoDate,
  montantRegularisation,
  suggererRegularisations,
} from "@compta/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { conflict, notFound, unprocessable } from "../http/errors.js";
import { intParam, requireDossier } from "../http/guards.js";

interface RegRow {
  id: number;
  exercice_id: number;
  type: TypeRegularisation;
  cle: string | null;
  data: string;
  montant: number;
  ecriture_id: number | null;
  created_at: string;
}

const isoDate = z.string().refine(isIsoDate, "Date invalide");
const compte = z.string().trim().toUpperCase().regex(/^[1-8][0-9]{1,7}[0-9A-Z]{0,12}$/, "Numéro de compte invalide");

const regSchema = z.object({
  exerciceId: z.number().int().positive(),
  type: z.enum(Object.keys(LIBELLES_REGULARISATIONS) as [TypeRegularisation, ...TypeRegularisation[]]),
  libelle: z.string().trim().min(1).max(150),
  compte: z.union([compte, z.literal("")]).default(""),
  compteAux: z.string().trim().toUpperCase().max(17).nullish(),
  montantHT: z.number().int().positive().max(1e12),
  tauxTvaBp: z.number().int().nullish(),
  periode: z.object({ debut: isoDate, fin: isoDate }).nullish(),
  tauxDepreciationBp: z.number().int().nullish(),
  compteContrepartie: z.union([compte, z.literal("")]).nullish(),
  cle: z.string().max(120).nullish(),
});

export async function regularisationRoutes(app: FastifyInstance) {
  const { db, compta, audit } = app.ctx;
  const log = (req: FastifyRequest, action: string, dossierId: number, entityId: number | null, details?: Record<string, unknown>) =>
    audit.record({ userId: req.user!.id, userEmail: req.user!.email, action, entity: "regularisation", entityId, dossierId, ip: req.ip, details });

  const exercicePrecedent = (dossierId: number, debut: string) =>
    compta.exercices(dossierId).find((e) => e.fin === ajouterJours(debut, -1));

  /** Régularisations extournables de l'exercice précédent, pas encore extournées. */
  const aExtourner = (dossierId: number, exerciceDebut: string) => {
    const prec = exercicePrecedent(dossierId, exerciceDebut);
    if (!prec) return [];
    return db
      .all<RegRow & { ecriture_statut: string | null; libelle_ecriture: string | null }>(
        `SELECT r.*, e.statut AS ecriture_statut, e.libelle AS libelle_ecriture FROM regularisations r
         LEFT JOIN ecritures e ON e.id = r.ecriture_id
         WHERE r.dossier_id = ? AND r.exercice_id = ? AND r.ecriture_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM ecritures x WHERE x.extourne_de = r.ecriture_id)`,
        dossierId, prec.id,
      )
      .filter((r) => extournable(r.type))
      .map((r) => ({ id: r.id, type: r.type, libelle: r.libelle_ecriture, montant: r.montant, ecritureId: r.ecriture_id, valide: r.ecriture_statut === "validee" }));
  };

  app.get("/api/dossiers/:dossierId/regularisations", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    const { exerciceId } = z.object({ exerciceId: z.coerce.number().int().positive() }).parse(req.query);
    const ex = compta.exercice(dossier.id, exerciceId);
    const rows = db.all<RegRow & { ecriture_statut: string | null; extourne_id: number | null }>(
      `SELECT r.*, e.statut AS ecriture_statut, (SELECT x.id FROM ecritures x WHERE x.extourne_de = r.ecriture_id) AS extourne_id
       FROM regularisations r LEFT JOIN ecritures e ON e.id = r.ecriture_id
       WHERE r.dossier_id = ? AND r.exercice_id = ? ORDER BY r.type, r.id`,
      dossier.id, ex.id,
    );
    const regularisations = rows.map((r) => ({
      id: r.id,
      ...(JSON.parse(r.data) as Regularisation),
      montant: r.montant,
      ecritureId: r.ecriture_id,
      ecritureStatut: r.ecriture_statut,
      extourneId: r.extourne_id,
      extournable: extournable(r.type),
      createdAt: r.created_at,
    }));
    const cles = new Set(rows.map((r) => r.cle).filter(Boolean));
    const suggestions =
      ex.statut === "ouvert"
        ? suggererRegularisations(compta.ecritures(dossier.id, { exerciceId: ex.id }), ex)
            .filter((s) => !cles.has(s.cle))
            .map((s) => ({ ...s, montant: montantRegularisation(s, ex.fin), compteContrepartie: contrepartieParDefaut(s.type, s.compte) }))
        : [];
    const total = (types: TypeRegularisation[]) => regularisations.filter((r) => types.includes(r.type)).reduce((a, r) => a + r.montant, 0);
    return {
      exercice: ex,
      types: LIBELLES_REGULARISATIONS,
      regularisations,
      suggestions,
      // Impact sur le résultat : les charges constatées d'avance et PCA réduisent respectivement charges et produits.
      impactResultat: regularisations.reduce((a, r) => {
        const signe = r.type === "cca" || r.type === "fae" || r.type === "par" ? 1 : -1;
        return a + signe * r.montant;
      }, 0),
      totaux: {
        chargesRattachees: total(["fnp", "cap", "depreciation_client", "provision_risque"]),
        produitsRattaches: total(["fae", "par"]),
        chargesConstateesAvance: total(["cca"]),
        produitsConstatesAvance: total(["pca"]),
      },
      aExtourner: aExtourner(dossier.id, ex.debut),
    };
  });

  app.post("/api/dossiers/:dossierId/regularisations/apercu", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    const b = regSchema.parse(req.body);
    const ex = compta.exercice(dossier.id, b.exerciceId);
    const controles = controlerRegularisation(b, ex.fin);
    return { controles, montant: controles.length ? 0 : montantRegularisation(b, ex.fin), ecriture: controles.length ? null : ecritureRegularisation(b, ex.fin, "APERCU") };
  });

  app.post("/api/dossiers/:dossierId/regularisations", async (req, reply) => {
    const { user, dossier } = requireDossier(req, "compta:write");
    const { exerciceId, cle, ...r } = regSchema.parse(req.body);
    const ex = compta.exercice(dossier.id, exerciceId);
    if (ex.statut === "cloture") throw unprocessable("Exercice clôturé");
    const reg: Regularisation = { ...r, compteAux: r.compteAux || null, compteContrepartie: r.compteContrepartie || null };
    const controles = controlerRegularisation(reg, ex.fin);
    if (controles.length) throw unprocessable("Régularisation invalide", controles.map((c) => ({ champ: c.champ, message: c.message })));
    const montant = montantRegularisation(reg, ex.fin);
    const res = db.transaction(() => {
      const id = db.run(
        "INSERT INTO regularisations (dossier_id, exercice_id, type, cle, data, montant, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
        dossier.id, ex.id, reg.type, cle ?? null, JSON.stringify(reg), montant, user.id,
      ).lastInsertRowid;
      const e = ecritureRegularisation(reg, ex.fin, `REG-${ex.fin.replace(/-/g, "")}-${id}`);
      if (!e) throw unprocessable("Montant nul après prorata : rien à comptabiliser");
      const ecritureId = compta.create(dossier.id, e, user.id);
      db.run("UPDATE regularisations SET ecriture_id = ? WHERE id = ?", ecritureId, id);
      return { id, ecritureId };
    });
    log(req, "regularisation.creee", dossier.id, res.id, { type: reg.type, montant, ecriture: res.ecritureId });
    reply.code(201);
    return { ...res, montant };
  });

  app.delete("/api/dossiers/:dossierId/regularisations/:id", async (req) => {
    const { dossier } = requireDossier(req, "compta:write");
    const id = intParam(req, "id");
    const r = db.get<RegRow>("SELECT * FROM regularisations WHERE id = ? AND dossier_id = ?", id, dossier.id);
    if (!r) throw notFound("Régularisation introuvable");
    db.transaction(() => {
      if (r.ecriture_id) {
        const e = compta.ecriture(dossier.id, r.ecriture_id);
        if (e.statut === "validee") throw conflict("Écriture validée : extournez-la depuis la liste des écritures");
        compta.delete(dossier.id, r.ecriture_id);
      }
      db.run("DELETE FROM regularisations WHERE id = ?", id);
    });
    log(req, "regularisation.supprimee", dossier.id, id);
    return { ok: true };
  });

  /** Extourne, au premier jour de l'exercice, des régularisations validées de l'exercice précédent. */
  app.post("/api/dossiers/:dossierId/regularisations/extournes", async (req, reply) => {
    const { user, dossier } = requireDossier(req, "compta:write");
    const { exerciceId } = z.object({ exerciceId: z.number().int().positive() }).parse(req.body);
    const ex = compta.exercice(dossier.id, exerciceId);
    if (ex.statut === "cloture") throw unprocessable("Exercice clôturé");
    const liste = aExtourner(dossier.id, ex.debut);
    const nonValidees = liste.filter((r) => !r.valide).length;
    const creees = db.transaction(() =>
      liste.filter((r) => r.valide).map((r) => compta.extourner(dossier.id, r.ecritureId!, ex.debut, "extourne à l'ouverture", user.id)),
    );
    if (creees.length === 0 && liste.length > 0) throw unprocessable("Validez d'abord les écritures de régularisation de l'exercice précédent");
    log(req, "regularisation.extournes", dossier.id, null, { exercice: ex.id, nombre: creees.length });
    reply.code(201);
    return { extournes: creees.length, nonValidees };
  });
}
