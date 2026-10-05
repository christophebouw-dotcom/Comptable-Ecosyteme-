/**
 * Outils de l'expert-comptable : immobilisations, banque, révision, IS,
 * mission / LCB-FT et reprise de FEC.
 */
import {
  type Immobilisation,
  LIBELLES_CYCLES,
  LIBELLES_MISSIONS,
  type Mission,
  PROGRAMME_REVISION,
  calculerIs,
  cleReleve,
  computeCaf,
  computeRatios,
  computeSig,
  controlerFec,
  controlerMission,
  controlesRevision,
  dotationPeriode,
  ecritureDotations,
  ecritureIs,
  estAmortissable,
  isCollectifTiers,
  isIsoDate,
  motifDepuisLibelle,
  parseFec,
  parseOfx,
  parseReleveCsv,
  planAmortissement,
  prochaineRevueLcbft,
  rapprocher,
  suggererImputation,
} from "@compta/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { conflict, forbidden, notFound, unprocessable } from "../http/errors.js";
import { intParam, requireDossier } from "../http/guards.js";
import type { ExerciceRow } from "../services/compta.js";

const isoDate = z.string().refine(isIsoDate, "Date invalide");
const compteSchema = z.string().trim().toUpperCase().regex(/^[1-8][0-9]{1,7}[0-9A-Z]{0,12}$/, "Numéro de compte invalide");

interface ImmoRow {
  id: number;
  dossier_id: number;
  compte: string;
  libelle: string;
  date_mise_en_service: string;
  valeur_ht: number;
  duree_annees: number;
  mode: Immobilisation["mode"];
  amortissements_anterieurs: number;
  date_sortie: string | null;
}

interface LigneBancaireRow {
  id: number;
  compte: string;
  date: string;
  libelle: string;
  montant: number;
  statut: "a_traiter" | "rapprochee" | "ignoree";
  ecriture_ligne_id: number | null;
}

const toImmo = (r: ImmoRow): Immobilisation => ({
  id: r.id, compte: r.compte, libelle: r.libelle, dateMiseEnService: r.date_mise_en_service, valeurHT: r.valeur_ht,
  dureeAnnees: r.duree_annees, mode: r.mode, dateSortie: r.date_sortie,
});

export async function expertiseRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  const { db, compta, audit } = ctx;
  const log = (req: FastifyRequest, action: string, dossierId: number, entityId: number | string | null, details?: Record<string, unknown>) =>
    audit.record({ userId: req.user!.id, userEmail: req.user!.email, action, entity: action.split(".")[0], entityId, dossierId, ip: req.ip, details });

  const exercicesAsc = (dossierId: number) => [...compta.exercices(dossierId)].sort((a, b) => a.debut.localeCompare(b.debut));
  const exerciceCible = (dossierId: number, exerciceId?: number): ExerciceRow => {
    if (exerciceId) return compta.exercice(dossierId, exerciceId);
    const all = exercicesAsc(dossierId);
    const ex = all.find((e) => e.statut === "ouvert") ?? all.at(-1);
    if (!ex) throw unprocessable("Aucun exercice");
    return ex;
  };
  const pieceExiste = (exerciceId: number, pieceRef: string) =>
    !!db.get("SELECT 1 FROM ecritures WHERE exercice_id = ? AND piece_ref = ?", exerciceId, pieceRef);

  // ===========================================================================
  // Immobilisations
  // ===========================================================================

  /** Dotation de l'exercice et cumul, en déroulant les exercices réels du dossier. */
  const situationImmo = (dossierId: number, immo: ImmoRow, ex: ExerciceRow) => {
    let cumul = immo.amortissements_anterieurs;
    let dotation = 0;
    for (const e of exercicesAsc(dossierId)) {
      if (e.debut > ex.debut) break;
      const d = dotationPeriode(toImmo(immo), e, cumul);
      if (e.id === ex.id) dotation = d;
      else cumul += d;
    }
    return { cumulDebut: cumul, dotation, cumulFin: cumul + dotation, vncFin: immo.valeur_ht - cumul - dotation };
  };

  app.get("/api/dossiers/:dossierId/immobilisations", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    const { exerciceId } = z.object({ exerciceId: z.coerce.number().int().optional() }).parse(req.query);
    const ex = exerciceCible(dossier.id, exerciceId);
    const premier = exercicesAsc(dossier.id)[0]!;
    const rows = db.all<ImmoRow>("SELECT * FROM immobilisations WHERE dossier_id = ? ORDER BY compte, date_mise_en_service", dossier.id);
    const immos = rows.map((r) => ({
      ...toImmo(r),
      amortissementsAnterieurs: r.amortissements_anterieurs,
      compteAmortissement: `28${r.compte.slice(1)}`,
      ...situationImmo(dossier.id, r, ex),
      plan: planAmortissement(toImmo(r), { debut: premier.debut, fin: premier.fin }).map((p) => ({ ...p })),
    }));
    return {
      exercice: ex,
      immobilisations: immos,
      totaux: {
        valeurBrute: immos.reduce((a, i) => a + i.valeurHT, 0),
        dotation: immos.reduce((a, i) => a + i.dotation, 0),
        cumulFin: immos.reduce((a, i) => a + i.cumulFin, 0),
        vncFin: immos.reduce((a, i) => a + i.vncFin, 0),
      },
      dotationsComptabilisees: pieceExiste(ex.id, `DOT-${ex.fin.replace(/-/g, "")}`),
    };
  });

  const immoSchema = z.object({
    compte: compteSchema.refine((c) => c.startsWith("2") && !/^2[89]/.test(c), "Compte d'immobilisation (classe 2, hors 28/29) attendu"),
    libelle: z.string().trim().min(1).max(200),
    dateMiseEnService: isoDate,
    valeurHT: z.number().int().positive(),
    dureeAnnees: z.number().int().min(1).max(100),
    mode: z.enum(["lineaire", "degressif", "non_amortissable"]),
    amortissementsAnterieurs: z.number().int().min(0).default(0),
    dateSortie: isoDate.nullish(),
  });

  app.post("/api/dossiers/:dossierId/immobilisations", async (req, reply) => {
    const { dossier } = requireDossier(req, "compta:write");
    const b = immoSchema.parse(req.body);
    if (b.mode === "degressif" && b.dureeAnnees < 3) throw unprocessable("Le dégressif n'est ouvert qu'aux biens d'une durée d'au moins 3 ans (CGI art. 39 A)");
    if (b.mode !== "non_amortissable" && !estAmortissable(b.compte)) throw unprocessable("Ce compte (terrain, fonds commercial, titres) n'est pas amortissable");
    if (b.amortissementsAnterieurs >= b.valeurHT && b.mode !== "non_amortissable") throw unprocessable("Les amortissements antérieurs doivent être inférieurs à la valeur d'origine");
    const id = db.run(
      `INSERT INTO immobilisations (dossier_id, compte, libelle, date_mise_en_service, valeur_ht, duree_annees, mode, amortissements_anterieurs, date_sortie)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      dossier.id, b.compte, b.libelle, b.dateMiseEnService, b.valeurHT, b.dureeAnnees, b.mode, b.amortissementsAnterieurs, b.dateSortie ?? null,
    ).lastInsertRowid;
    log(req, "immobilisation.creee", dossier.id, id, { compte: b.compte, valeur: b.valeurHT });
    reply.code(201);
    return { id };
  });

  app.patch("/api/dossiers/:dossierId/immobilisations/:id", async (req) => {
    const { dossier } = requireDossier(req, "compta:write");
    const id = intParam(req, "id");
    const { dateSortie } = z.object({ dateSortie: isoDate.nullable() }).parse(req.body);
    const r = db.run("UPDATE immobilisations SET date_sortie = ? WHERE id = ? AND dossier_id = ?", dateSortie, id, dossier.id);
    if (!r.changes) throw notFound();
    log(req, "immobilisation.sortie", dossier.id, id, { dateSortie });
    return { ok: true };
  });

  app.delete("/api/dossiers/:dossierId/immobilisations/:id", async (req) => {
    const { dossier } = requireDossier(req, "compta:write");
    const id = intParam(req, "id");
    const r = db.run("DELETE FROM immobilisations WHERE id = ? AND dossier_id = ?", id, dossier.id);
    if (!r.changes) throw notFound();
    log(req, "immobilisation.supprimee", dossier.id, id);
    return { ok: true };
  });

  app.post("/api/dossiers/:dossierId/immobilisations/dotations", async (req, reply) => {
    const { user, dossier } = requireDossier(req, "compta:write");
    const { exerciceId } = z.object({ exerciceId: z.number().int().positive() }).parse(req.body);
    const ex = compta.exercice(dossier.id, exerciceId);
    if (ex.statut === "cloture") throw unprocessable("Exercice clôturé");
    const pieceRef = `DOT-${ex.fin.replace(/-/g, "")}`;
    if (pieceExiste(ex.id, pieceRef)) throw conflict("Les dotations de cet exercice ont déjà été générées (supprimez le brouillard pour les recalculer)");
    const rows = db.all<ImmoRow>("SELECT * FROM immobilisations WHERE dossier_id = ?", dossier.id);
    const e = ecritureDotations(rows.map((r) => ({ immo: toImmo(r), dotation: situationImmo(dossier.id, r, ex).dotation })), ex.fin);
    if (!e) throw unprocessable("Aucune dotation à comptabiliser sur l'exercice");
    const id = compta.create(dossier.id, e, user.id);
    log(req, "immobilisation.dotations", dossier.id, id, { exercice: ex.id });
    reply.code(201);
    return compta.ecriture(dossier.id, id);
  });

  // ===========================================================================
  // Banque : import, rapprochement, affectation
  // ===========================================================================

  app.post("/api/dossiers/:dossierId/banque/import", async (req) => {
    const { user, dossier } = requireDossier(req, "compta:write");
    const b = z
      .object({ format: z.enum(["csv", "ofx"]), content: z.string().min(1).max(20_000_000), compte: compteSchema.refine((c) => c.startsWith("512"), "Compte 512x attendu").default("512"), fichier: z.string().max(200).optional() })
      .parse(req.body);
    const parsed = b.format === "csv" ? parseReleveCsv(b.content) : parseOfx(b.content);
    if (parsed.lignes.length === 0) throw unprocessable("Aucune opération lisible dans le fichier", parsed.erreurs.map((e) => ({ ligne: e.ligne, message: e.message })));
    const res = db.transaction(() => {
      const releveId = db.run(
        "INSERT INTO releves_bancaires (dossier_id, compte, fichier, format, nb_lignes, imported_by) VALUES (?, ?, ?, ?, ?, ?)",
        dossier.id, b.compte, b.fichier ?? null, b.format, parsed.lignes.length, user.id,
      ).lastInsertRowid;
      let importees = 0;
      for (const l of parsed.lignes) {
        importees += db.run(
          "INSERT OR IGNORE INTO lignes_bancaires (dossier_id, releve_id, compte, date, libelle, montant, cle) VALUES (?, ?, ?, ?, ?, ?, ?)",
          dossier.id, releveId, b.compte, l.date, l.libelle, l.montant, cleReleve(l),
        ).changes;
      }
      return { importees, doublons: parsed.lignes.length - importees, erreurs: parsed.erreurs };
    });
    log(req, "banque.import", dossier.id, null, { fichier: b.fichier, importees: res.importees, doublons: res.doublons });
    return res;
  });

  /** Mouvements 512 non encore rapprochés (montant signé vu de la banque). */
  const mouvementsLibres = (dossierId: number, compte: string) =>
    db.all<{ id: number; date: string; montant: number; libelle: string; piece_ref: string; statut: string }>(
      `SELECT l.id, e.date, (l.debit - l.credit) AS montant, COALESCE(l.libelle, e.libelle) AS libelle, e.piece_ref, e.statut
       FROM ecriture_lignes l JOIN ecritures e ON e.id = l.ecriture_id
       WHERE e.dossier_id = ? AND l.compte = ?
         AND l.id NOT IN (SELECT ecriture_ligne_id FROM lignes_bancaires WHERE ecriture_ligne_id IS NOT NULL)
       ORDER BY e.date`,
      dossierId, compte,
    );

  app.get("/api/dossiers/:dossierId/banque", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    const { compte } = z.object({ compte: z.string().default("512") }).parse(req.query);
    const regles = db.all<{ motif: string; compte: string; compte_aux: string | null }>("SELECT motif, compte, compte_aux FROM regles_imputation WHERE dossier_id = ?", dossier.id)
      .map((r) => ({ motif: r.motif, compte: r.compte, compteAux: r.compte_aux }));
    const lignes = db.all<LigneBancaireRow>("SELECT * FROM lignes_bancaires WHERE dossier_id = ? AND compte = ? ORDER BY date DESC, id DESC", dossier.id, compte);
    const soldeComptable = db.get<{ s: number | null }>(
      "SELECT SUM(l.debit - l.credit) AS s FROM ecriture_lignes l JOIN ecritures e ON e.id = l.ecriture_id WHERE e.dossier_id = ? AND l.compte = ?",
      dossier.id, compte,
    )?.s ?? 0;
    const mouvements = mouvementsLibres(dossier.id, compte);
    const aTraiter = lignes.filter((l) => l.statut === "a_traiter");
    // Justificatifs demandés au client (portail) pour ces opérations.
    const demandes = new Map(
      db.all<{ ligne_bancaire_id: number; id: number; statut: string; piece_id: number | null }>(
        "SELECT ligne_bancaire_id, id, statut, piece_id FROM demandes_pieces WHERE dossier_id = ? AND ligne_bancaire_id IS NOT NULL ORDER BY id",
        dossier.id,
      ).map((d) => [d.ligne_bancaire_id, { id: d.id, statut: d.statut, pieceId: d.piece_id }]),
    );
    return {
      compte,
      lignes: lignes.map((l) => ({
        ...l,
        suggestion: l.statut === "a_traiter" ? suggererImputation(l.libelle, regles) : null,
        demande: demandes.get(l.id) ?? null,
      })),
      mouvementsNonRapproches: mouvements,
      etat: {
        soldeComptable,
        totalReleve: lignes.filter((l) => l.statut !== "ignoree").reduce((a, l) => a + l.montant, 0),
        releveNonComptabilise: aTraiter.reduce((a, l) => a + l.montant, 0),
        comptabiliseNonReleve: mouvements.reduce((a, m) => a + m.montant, 0),
        nbATraiter: aTraiter.length,
      },
      regles,
    };
  });

  app.post("/api/dossiers/:dossierId/banque/rapprochement-auto", async (req) => {
    const { dossier } = requireDossier(req, "compta:write");
    const { compte, tolerance } = z.object({ compte: z.string().default("512"), tolerance: z.number().int().min(0).max(60).default(10) }).parse(req.body ?? {});
    const releve = db.all<LigneBancaireRow>("SELECT * FROM lignes_bancaires WHERE dossier_id = ? AND compte = ? AND statut = 'a_traiter'", dossier.id, compte);
    const paires = rapprocher(releve, mouvementsLibres(dossier.id, compte), tolerance);
    db.transaction(() => {
      for (const p of paires) db.run("UPDATE lignes_bancaires SET statut = 'rapprochee', ecriture_ligne_id = ? WHERE id = ?", p.mouvementId, releve[p.releveIndex]!.id);
    });
    log(req, "banque.rapprochement_auto", dossier.id, null, { rapprochees: paires.length });
    return { rapprochees: paires.length, restantes: releve.length - paires.length };
  });

  const getLigne = (dossierId: number, id: number) => {
    const l = db.get<LigneBancaireRow>("SELECT * FROM lignes_bancaires WHERE id = ? AND dossier_id = ?", id, dossierId);
    if (!l) throw notFound("Ligne de relevé introuvable");
    return l;
  };

  /** Comptabilise une ligne de relevé : écriture BQ en brouillard, liée à la ligne. */
  app.post("/api/dossiers/:dossierId/banque/lignes/:id/affecter", async (req, reply) => {
    const { user, dossier } = requireDossier(req, "compta:write");
    const l = getLigne(dossier.id, intParam(req, "id"));
    if (l.statut !== "a_traiter") throw conflict("Ligne déjà traitée");
    const b = z
      .object({ compte: compteSchema, compteAux: z.string().trim().toUpperCase().max(17).nullish(), libelle: z.string().trim().max(200).optional(), memoriser: z.boolean().default(false) })
      .parse(req.body);
    if (isCollectifTiers(b.compte) && !b.compteAux) throw unprocessable("Précisez le compte auxiliaire du tiers");
    const montant = Math.abs(l.montant);
    const entree = l.montant > 0;
    const id = db.transaction(() => {
      const ecritureId = compta.create(
        dossier.id,
        {
          journal: "BQ",
          date: l.date,
          libelle: (b.libelle || l.libelle).slice(0, 200),
          pieceRef: `REL-${l.id}`,
          pieceDate: l.date,
          lignes: [
            { compte: l.compte, debit: entree ? montant : 0, credit: entree ? 0 : montant },
            { compte: b.compte, compteAux: b.compteAux ?? null, debit: entree ? 0 : montant, credit: entree ? montant : 0 },
          ],
        },
        user.id,
      );
      const ligne512 = db.get<{ id: number }>("SELECT id FROM ecriture_lignes WHERE ecriture_id = ? AND ordre = 1", ecritureId)!;
      db.run("UPDATE lignes_bancaires SET statut = 'rapprochee', ecriture_ligne_id = ? WHERE id = ?", ligne512.id, l.id);
      if (b.memoriser) {
        const motif = motifDepuisLibelle(l.libelle);
        if (motif) {
          db.run(
            "INSERT INTO regles_imputation (dossier_id, motif, compte, compte_aux) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET compte = excluded.compte, compte_aux = excluded.compte_aux",
            dossier.id, motif, b.compte, b.compteAux ?? null,
          );
        }
      }
      return ecritureId;
    });
    log(req, "banque.affectation", dossier.id, l.id, { compte: b.compte, ecriture: id });
    reply.code(201);
    return compta.ecriture(dossier.id, id);
  });

  app.post("/api/dossiers/:dossierId/banque/lignes/:id/rapprocher", async (req) => {
    const { dossier } = requireDossier(req, "compta:write");
    const l = getLigne(dossier.id, intParam(req, "id"));
    const { ligneEcritureId } = z.object({ ligneEcritureId: z.number().int().positive() }).parse(req.body);
    const m = mouvementsLibres(dossier.id, l.compte).find((x) => x.id === ligneEcritureId);
    if (!m) throw unprocessable("Mouvement comptable introuvable ou déjà rapproché");
    if (m.montant !== l.montant) throw unprocessable("Les montants diffèrent : rapprochement impossible");
    db.run("UPDATE lignes_bancaires SET statut = 'rapprochee', ecriture_ligne_id = ? WHERE id = ?", m.id, l.id);
    return { ok: true };
  });

  app.post("/api/dossiers/:dossierId/banque/lignes/:id/statut", async (req) => {
    const { dossier } = requireDossier(req, "compta:write");
    const l = getLigne(dossier.id, intParam(req, "id"));
    const { statut } = z.object({ statut: z.enum(["a_traiter", "ignoree"]) }).parse(req.body);
    db.run("UPDATE lignes_bancaires SET statut = ?, ecriture_ligne_id = NULL WHERE id = ?", statut, l.id);
    return { ok: true };
  });

  // ===========================================================================
  // Révision : contrôles, SIG, CAF, ratios, programme de travail
  // ===========================================================================

  app.get("/api/dossiers/:dossierId/revision", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    const { exerciceId } = z.object({ exerciceId: z.coerce.number().int().optional() }).parse(req.query);
    const ex = exerciceCible(dossier.id, exerciceId);
    const ecritures = compta.ecritures(dossier.id, { exerciceId: ex.id, statut: "validee" });
    const brouillards = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ecritures WHERE exercice_id = ? AND statut = 'brouillard'", ex.id)!.n;
    const comptesImmos = new Set(db.all<{ compte: string }>("SELECT DISTINCT compte FROM immobilisations WHERE dossier_id = ?", dossier.id).map((r) => r.compte));
    const soldes2 = new Map<string, number>();
    for (const e of ecritures) for (const l of e.lignes) if (/^2[0-7]/.test(l.compte)) soldes2.set(l.compte, (soldes2.get(l.compte) ?? 0) + l.debit - l.credit);
    const sansPlan = [...soldes2.entries()].filter(([c, s]) => s > 0 && estAmortissable(c) && !comptesImmos.has(c)).map(([c]) => c);
    const points = new Map(
      db.all<{ code: string; statut: string; commentaire: string | null; updated_at: string }>("SELECT code, statut, commentaire, updated_at FROM revision_points WHERE exercice_id = ?", ex.id).map((p) => [p.code, p]),
    );
    const jours = Math.round((Date.parse(ex.fin) - Date.parse(ex.debut)) / 86_400_000) + 1;
    return {
      exercice: ex,
      anomalies: controlesRevision(ecritures, { dateArrete: ex.fin, brouillards, immobilisationsSansPlan: sansPlan }),
      sig: computeSig(ecritures),
      caf: computeCaf(ecritures),
      ratios: computeRatios(ecritures, Math.round((jours * 360) / 365)),
      cycles: LIBELLES_CYCLES,
      programme: PROGRAMME_REVISION.map((p) => ({ ...p, statut: points.get(p.code)?.statut ?? "a_faire", commentaire: points.get(p.code)?.commentaire ?? null, majLe: points.get(p.code)?.updated_at ?? null })),
    };
  });

  app.put("/api/dossiers/:dossierId/revision/points/:code", async (req) => {
    const { user, dossier } = requireDossier(req, "compta:write");
    const code = (req.params as { code: string }).code;
    if (!PROGRAMME_REVISION.some((p) => p.code === code)) throw notFound("Point de révision inconnu");
    const b = z.object({ exerciceId: z.number().int().positive(), statut: z.enum(["a_faire", "fait", "na", "anomalie"]), commentaire: z.string().max(2000).nullish() }).parse(req.body);
    compta.exercice(dossier.id, b.exerciceId);
    db.run(
      `INSERT INTO revision_points (exercice_id, code, statut, commentaire, user_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (exercice_id, code) DO UPDATE SET statut = excluded.statut, commentaire = excluded.commentaire, user_id = excluded.user_id, updated_at = excluded.updated_at`,
      b.exerciceId, code, b.statut, b.commentaire ?? null, user.id, ctx.now().toISOString(),
    );
    return { ok: true };
  });

  // ===========================================================================
  // Impôt sur les sociétés
  // ===========================================================================

  const isSchema = z.object({
    exerciceId: z.number().int().positive(),
    reintegrations: z.number().int().min(0).default(0),
    deductions: z.number().int().min(0).default(0),
    deficitsAnterieurs: z.number().int().min(0).default(0),
    eligibleTauxReduit: z.boolean().default(true),
  });

  const calculIs = (dossierId: number, b: z.infer<typeof isSchema>) => {
    const ex = compta.exercice(dossierId, b.exerciceId);
    const ecritures = compta.ecritures(dossierId, { exerciceId: ex.id, statut: "validee" }).filter((e) => e.journal !== "AN");
    const sig = computeSig(ecritures);
    // Résultat avant IS : on neutralise l'IS déjà comptabilisé (695 à 698).
    const isComptabilise = ecritures.flatMap((e) => e.lignes).filter((l) => /^69[5-8]/.test(l.compte)).reduce((a, l) => a + l.debit - l.credit, 0);
    const acomptes = ecritures.flatMap((e) => e.lignes).filter((l) => l.compte.startsWith("444")).reduce((a, l) => a + l.debit, 0);
    const mois = Math.round((Date.parse(ex.fin) - Date.parse(ex.debut)) / (30.4375 * 86_400_000));
    return {
      ex,
      calc: calculerIs({
        resultatComptableAvantIs: sig.resultatNet + isComptabilise,
        reintegrations: b.reintegrations,
        deductions: b.deductions,
        deficitsAnterieurs: b.deficitsAnterieurs,
        eligibleTauxReduit: b.eligibleTauxReduit,
        acomptesVerses: acomptes,
        dureeMois: mois,
      }),
      isComptabilise,
    };
  };

  app.post("/api/dossiers/:dossierId/is/calcul", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    if (dossier.impot !== "IS") throw unprocessable("Ce dossier relève de l'impôt sur le revenu");
    const { calc, isComptabilise } = calculIs(dossier.id, isSchema.parse(req.body));
    return { ...calc, isDejaComptabilise: isComptabilise };
  });

  app.post("/api/dossiers/:dossierId/is/ecriture", async (req, reply) => {
    const { user, dossier } = requireDossier(req, "compta:write");
    if (dossier.impot !== "IS") throw unprocessable("Ce dossier relève de l'impôt sur le revenu");
    const { ex, calc, isComptabilise } = calculIs(dossier.id, isSchema.parse(req.body));
    if (isComptabilise) throw conflict("Un impôt sur les sociétés est déjà comptabilisé sur cet exercice");
    if (pieceExiste(ex.id, `IS-${ex.fin.replace(/-/g, "")}`)) throw conflict("L'écriture d'IS existe déjà en brouillard");
    const e = ecritureIs(calc, ex.fin);
    if (!e) throw unprocessable("Aucun impôt dû");
    const id = compta.create(dossier.id, e, user.id);
    log(req, "is.ecriture", dossier.id, id, { impot: calc.impotTotal });
    reply.code(201);
    return compta.ecriture(dossier.id, id);
  });

  // ===========================================================================
  // Mission et LCB-FT
  // ===========================================================================

  const missionSchema = z.object({
    types: z.array(z.enum(Object.keys(LIBELLES_MISSIONS) as [string, ...string[]])),
    lettreSigneeLe: isoDate.nullable(),
    honorairesAnnuelsHT: z.number().int().min(0).nullable(),
    risqueLcbft: z.enum(["faible", "standard", "eleve"]),
    identiteVerifieeLe: isoDate.nullable(),
    beneficiairesEffectifs: z.string().trim().max(2000).nullable(),
    revueLcbftLe: isoDate.nullable(),
    ppe: z.boolean(),
  });

  const lireMission = (dossierId: number): Mission | null => {
    const r = db.get<{ data: string }>("SELECT data FROM missions WHERE dossier_id = ?", dossierId);
    return r ? (JSON.parse(r.data) as Mission) : null;
  };

  app.get("/api/dossiers/:dossierId/mission", async (req) => {
    const { user, dossier } = requireDossier(req, "dossiers:read");
    // Vigilance LCB-FT : jamais communiquée au client (interdiction de divulgation, CMF art. L561-18).
    if (user.role === "client") throw forbidden();
    const m = lireMission(dossier.id);
    return {
      mission: m,
      alertes: controlerMission(m, ctx.now().toISOString().slice(0, 10)),
      prochaineRevue: m ? prochaineRevueLcbft(m) : null,
      typesMission: LIBELLES_MISSIONS,
    };
  });

  app.put("/api/dossiers/:dossierId/mission", async (req) => {
    const { user, dossier } = requireDossier(req, "dossiers:write");
    const m = missionSchema.parse(req.body);
    db.run(
      "INSERT INTO missions (dossier_id, data, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT (dossier_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
      dossier.id, JSON.stringify(m), ctx.now().toISOString(), user.id,
    );
    log(req, "mission.maj", dossier.id, dossier.id, { risque: m.risqueLcbft, lettre: !!m.lettreSigneeLe });
    return { ok: true };
  });

  // ===========================================================================
  // Reprise de dossier : import d'un FEC
  // ===========================================================================

  app.post("/api/dossiers/:dossierId/fec/import", async (req) => {
    const { user, dossier } = requireDossier(req, "compta:write");
    const { content } = z.object({ content: z.string().min(1).max(50_000_000) }).parse(req.body);
    const ctrl = controlerFec(content);
    if (!ctrl.valide) throw unprocessable("Le FEC comporte des anomalies : corrigez-les avant import", ctrl.anomalies.slice(0, 50).map((a) => ({ ligne: a.ligne, message: a.message })));
    const ecritures = parseFec(content);
    const res = db.transaction(() => {
      const erreurs: { ligne?: number; message: string }[] = [];
      let creees = 0;
      let tiersCrees = 0;
      for (const e of ecritures) {
        const journal = e.journalCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "OD";
        db.run("INSERT OR IGNORE INTO journaux (dossier_id, code, libelle, type) VALUES (?, ?, ?, 'od')", dossier.id, journal, e.journalLib || journal);
        const lignes = e.lignes.map((l) => {
          const compte = l.compte.toUpperCase().replace(/[^0-9A-Z]/g, "");
          if (l.compteLib) db.run("INSERT OR IGNORE INTO comptes (dossier_id, numero, libelle) VALUES (?, ?, ?)", dossier.id, compte, l.compteLib.slice(0, 120));
          const aux = l.compteAux ? l.compteAux.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 17) : null;
          if (aux && !db.get("SELECT 1 FROM tiers WHERE dossier_id = ? AND compte_aux = ?", dossier.id, aux)) {
            db.run("INSERT INTO tiers (dossier_id, type, compte_aux, nom) VALUES (?, ?, ?, ?)", dossier.id, isCollectifTiers(compte) === "fournisseur" ? "fournisseur" : "client", aux, l.compteAuxLib || aux);
            tiersCrees++;
          }
          return { compte, compteAux: aux, libelle: l.libelle.slice(0, 200), debit: l.debit, credit: l.credit };
        });
        try {
          compta.create(dossier.id, { journal, date: e.date, libelle: (e.libelle || `Reprise ${e.ecritureNum}`).slice(0, 200), pieceRef: (e.pieceRef || e.ecritureNum).slice(0, 60), pieceDate: e.pieceDate, lignes }, user.id);
          creees++;
        } catch (err) {
          const details = (err as { details?: { message: string }[] }).details;
          erreurs.push({ message: `Écriture ${e.journalCode}-${e.ecritureNum} du ${e.date} : ${details?.map((d) => d.message).join(" ; ") ?? (err as Error).message}` });
        }
      }
      if (erreurs.length) throw unprocessable(`${erreurs.length} écriture(s) ne peuvent être reprises : import annulé`, erreurs.slice(0, 50));
      return { ecritures: creees, tiersCrees };
    });
    log(req, "fec.import", dossier.id, null, res);
    return res;
  });
}
