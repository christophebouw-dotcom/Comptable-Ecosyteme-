import { isIsoDate, maskIban, prochainesEcheances, type RegimeTva, validateBic, validateIban, validateSiren } from "@compta/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { conflict, unprocessable } from "../http/errors.js";
import { type DossierRow, requireDossier, requirePerm } from "../http/guards.js";
import { seesAllDossiers } from "../security/rbac.js";

const REGIMES = ["franchise", "reel_simplifie", "reel_normal_mensuel", "reel_normal_trimestriel"] as const;

export const dossierSchema = z.object({
  raisonSociale: z.string().trim().min(1).max(200),
  formeJuridique: z.string().trim().min(1).max(40),
  siren: z.string().trim().refine((v) => validateSiren(v).valid, "SIREN invalide"),
  adresse: z.string().trim().min(1).max(300),
  codePostal: z.string().trim().regex(/^[0-9A-Z -]{3,10}$/, "Code postal invalide"),
  ville: z.string().trim().min(1).max(100),
  capital: z.string().trim().max(40).nullish(),
  rcs: z.string().trim().max(60).nullish(),
  regimeTva: z.enum(REGIMES),
  impot: z.enum(["IS", "IR"]),
  emailContact: z.email().nullish().or(z.literal("")),
  iban: z.string().trim().nullish().refine((v) => !v || validateIban(v).valid, "IBAN invalide"),
  bic: z.string().trim().nullish().refine((v) => !v || validateBic(v).valid, "BIC invalide"),
  prefixeFacture: z.string().trim().regex(/^[A-Z]{1,4}$/).default("F"),
});

export function presentDossier(d: DossierRow, decryptIban: (v: string | null) => string | null) {
  const iban = decryptIban(d.iban_enc);
  return {
    id: d.id,
    raisonSociale: d.raison_sociale,
    formeJuridique: d.forme_juridique,
    siren: d.siren,
    adresse: d.adresse,
    codePostal: d.code_postal,
    ville: d.ville,
    pays: d.pays,
    capital: d.capital,
    rcs: d.rcs,
    regimeTva: d.regime_tva,
    impot: d.impot,
    emailContact: d.email_contact,
    ibanMasque: iban ? maskIban(iban) : null,
    bic: d.bic,
    prefixeFacture: d.prefixe_facture,
    createdAt: d.created_at,
    archivedAt: d.archived_at,
  };
}

export async function dossierRoutes(app: FastifyInstance) {
  const { db, cipher, audit, compta, now } = app.ctx;
  const decrypt = (v: string | null) => cipher.decrypt(v);

  app.get("/api/dossiers", async (req) => {
    const user = requirePerm(req, "dossiers:read");
    const rows = seesAllDossiers(user.role)
      ? db.all<DossierRow>("SELECT * FROM dossiers WHERE archived_at IS NULL ORDER BY raison_sociale")
      : db.all<DossierRow>(
          "SELECT d.* FROM dossiers d JOIN dossier_access a ON a.dossier_id = d.id WHERE a.user_id = ? AND d.archived_at IS NULL ORDER BY raison_sociale",
          user.id,
        );
    return rows.map((d) => {
      const stats = db.get<{ brouillards: number; validees: number }>(
        `SELECT SUM(statut = 'brouillard') AS brouillards, SUM(statut = 'validee') AS validees FROM ecritures WHERE dossier_id = ?`,
        d.id,
      );
      const ex = db.get<{ id: number; debut: string; fin: string }>("SELECT id, debut, fin FROM exercices WHERE dossier_id = ? AND statut = 'ouvert' ORDER BY debut LIMIT 1", d.id);
      return {
        ...presentDossier(d, decrypt),
        exerciceCourant: ex ?? null,
        brouillards: stats?.brouillards ?? 0,
        validees: stats?.validees ?? 0,
        prochainesEcheances: ex
          ? prochainesEcheances({ regimeTva: d.regime_tva as RegimeTva, impot: d.impot, dateCloture: ex.fin }, now().toISOString(), 3)
          : [],
      };
    });
  });

  app.post("/api/dossiers", async (req) => {
    const user = requirePerm(req, "dossiers:write");
    const body = dossierSchema
      .extend({ exerciceDebut: z.string().refine(isIsoDate), exerciceFin: z.string().refine(isIsoDate) })
      .parse(req.body);
    if (body.exerciceFin <= body.exerciceDebut) throw unprocessable("La fin d'exercice doit suivre son début");
    const siren = body.siren.replace(/\s/g, "");
    if (db.get("SELECT 1 FROM dossiers WHERE siren = ?", siren)) throw conflict("Un dossier existe déjà pour ce SIREN");
    const id = db.transaction(() => {
      const id = db.run(
        `INSERT INTO dossiers (raison_sociale, forme_juridique, siren, adresse, code_postal, ville, capital, rcs, regime_tva, impot, email_contact, iban_enc, bic, prefixe_facture)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        body.raisonSociale, body.formeJuridique, siren, body.adresse, body.codePostal, body.ville, body.capital ?? null, body.rcs ?? null,
        body.regimeTva, body.impot, body.emailContact || null, cipher.encrypt(body.iban?.replace(/\s/g, "")), body.bic ?? null, body.prefixeFacture,
      ).lastInsertRowid;
      compta.initDossier(id, body.exerciceDebut, body.exerciceFin);
      return id;
    });
    audit.record({ userId: user.id, userEmail: user.email, action: "dossier.cree", entity: "dossier", entityId: id, dossierId: id, ip: req.ip, details: { siren } });
    return { id };
  });

  app.get("/api/dossiers/:dossierId", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    return {
      ...presentDossier(dossier, decrypt),
      exercices: compta.exercices(dossier.id),
      journaux: compta.journaux(dossier.id),
    };
  });

  app.put("/api/dossiers/:dossierId", async (req) => {
    const { user, dossier } = requireDossier(req, "dossiers:write");
    const body = dossierSchema.parse(req.body);
    const siren = body.siren.replace(/\s/g, "");
    const hasValidated = db.get("SELECT 1 FROM ecritures WHERE dossier_id = ? AND statut = 'validee'", dossier.id);
    if (siren !== dossier.siren && hasValidated) throw unprocessable("Le SIREN ne peut plus être modifié après la validation d'écritures");
    db.run(
      `UPDATE dossiers SET raison_sociale = ?, forme_juridique = ?, siren = ?, adresse = ?, code_postal = ?, ville = ?, capital = ?, rcs = ?,
         regime_tva = ?, impot = ?, email_contact = ?, iban_enc = COALESCE(?, iban_enc), bic = ?, prefixe_facture = ? WHERE id = ?`,
      body.raisonSociale, body.formeJuridique, siren, body.adresse, body.codePostal, body.ville, body.capital ?? null, body.rcs ?? null,
      body.regimeTva, body.impot, body.emailContact || null, cipher.encrypt(body.iban?.replace(/\s/g, "")), body.bic ?? null, body.prefixeFacture, dossier.id,
    );
    audit.record({ userId: user.id, userEmail: user.email, action: "dossier.modifie", entity: "dossier", entityId: dossier.id, dossierId: dossier.id, ip: req.ip });
    return { ok: true };
  });

  app.get("/api/dossiers/:dossierId/comptes", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    const custom = db.all<{ numero: string; libelle: string }>("SELECT numero, libelle FROM comptes WHERE dossier_id = ? ORDER BY numero", dossier.id);
    const used = db.all<{ compte: string }>(
      "SELECT DISTINCT l.compte FROM ecriture_lignes l JOIN ecritures e ON e.id = l.ecriture_id WHERE e.dossier_id = ? ORDER BY l.compte",
      dossier.id,
    );
    const label = compta.libelleCompte(dossier.id);
    return { personnalises: custom, utilises: used.map((u) => ({ numero: u.compte, libelle: label(u.compte) })) };
  });

  app.post("/api/dossiers/:dossierId/comptes", async (req) => {
    const { dossier } = requireDossier(req, "compta:write");
    const body = z.object({ numero: z.string().regex(/^[1-8][0-9]{1,7}[0-9A-Z]{0,12}$/), libelle: z.string().trim().min(1).max(120) }).parse(req.body);
    db.run("INSERT INTO comptes (dossier_id, numero, libelle) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET libelle = excluded.libelle", dossier.id, body.numero, body.libelle);
    return { ok: true };
  });
}
