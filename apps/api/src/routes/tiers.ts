import { maskIban, masquerEmail, validateIban, validateSiren, validateVatNumber } from "@compta/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { conflict, notFound } from "../http/errors.js";
import { intParam, requireDossier } from "../http/guards.js";
import { can } from "../security/rbac.js";

export interface TiersRow {
  id: number;
  dossier_id: number;
  type: "client" | "fournisseur";
  compte_aux: string;
  nom: string;
  personne_physique: number;
  professionnel: number;
  siren: string | null;
  tva_intra: string | null;
  adresse: string | null;
  code_postal: string | null;
  ville: string | null;
  pays: string;
  email_enc: string | null;
  email_hash: string | null;
  telephone_enc: string | null;
  iban_enc: string | null;
  fin_relation: string | null;
  restricted: number;
  anonymized_at: string | null;
  created_at: string;
}

export const tiersSchema = z.object({
  type: z.enum(["client", "fournisseur"]),
  compteAux: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,17}$/, "Code auxiliaire : 2 à 17 lettres ou chiffres"),
  nom: z.string().trim().min(1).max(200),
  personnePhysique: z.boolean().default(false),
  professionnel: z.boolean().default(true),
  siren: z.string().trim().nullish().refine((v) => !v || validateSiren(v).valid, "SIREN invalide"),
  tvaIntra: z.string().trim().nullish().refine((v) => !v || validateVatNumber(v).valid, "N° de TVA invalide"),
  adresse: z.string().trim().max(300).nullish(),
  codePostal: z.string().trim().max(10).nullish(),
  ville: z.string().trim().max(100).nullish(),
  pays: z.string().trim().toUpperCase().length(2).default("FR"),
  email: z.email().nullish().or(z.literal("")),
  telephone: z.string().trim().max(30).nullish(),
  iban: z.string().trim().nullish().refine((v) => !v || validateIban(v).valid, "IBAN invalide"),
  finRelation: z.string().nullish(),
});

/**
 * Présentation d'un tiers. Les données de contact sont déchiffrées uniquement
 * pour les utilisateurs habilités à modifier les tiers ; les autres reçoivent
 * des valeurs masquées (minimisation, art. 5.1.c). Un tiers en limitation de
 * traitement (art. 18) n'expose plus ses coordonnées.
 */
export function presentTiers(ctx: AppContext, t: TiersRow, full: boolean) {
  const email = ctx.cipher.decrypt(t.email_enc);
  const tel = ctx.cipher.decrypt(t.telephone_enc);
  const iban = ctx.cipher.decrypt(t.iban_enc);
  const reveal = full && !t.restricted;
  return {
    id: t.id,
    type: t.type,
    compteAux: t.compte_aux,
    nom: t.nom,
    personnePhysique: !!t.personne_physique,
    professionnel: !!t.professionnel,
    siren: t.siren,
    tvaIntra: t.tva_intra,
    adresse: t.adresse,
    codePostal: t.code_postal,
    ville: t.ville,
    pays: t.pays,
    email: email ? (reveal ? email : masquerEmail(email)) : null,
    telephone: tel ? (reveal ? tel : "•••• ••") : null,
    ibanMasque: iban ? maskIban(iban) : null,
    finRelation: t.fin_relation,
    restricted: !!t.restricted,
    anonymized: !!t.anonymized_at,
  };
}

export async function tiersRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  const { db, cipher, audit } = ctx;

  app.get("/api/dossiers/:dossierId/tiers", async (req) => {
    const { user, dossier } = requireDossier(req, "dossiers:read");
    const { type } = z.object({ type: z.enum(["client", "fournisseur"]).optional() }).parse(req.query);
    const rows = type
      ? db.all<TiersRow>("SELECT * FROM tiers WHERE dossier_id = ? AND type = ? ORDER BY nom", dossier.id, type)
      : db.all<TiersRow>("SELECT * FROM tiers WHERE dossier_id = ? ORDER BY nom", dossier.id);
    return rows.map((t) => presentTiers(ctx, t, can(user.role, "tiers:write")));
  });

  const save = (dossierId: number, body: z.infer<typeof tiersSchema>, id?: number) => {
    const params = [
      body.type, body.compteAux, body.nom, body.personnePhysique ? 1 : 0, body.professionnel ? 1 : 0,
      body.siren?.replace(/\s/g, "") || null, body.tvaIntra?.replace(/\s/g, "").toUpperCase() || null,
      body.adresse ?? null, body.codePostal ?? null, body.ville ?? null, body.pays,
      cipher.encrypt(body.email || null), cipher.blindIndex(body.email || null), cipher.encrypt(body.telephone || null),
      cipher.encrypt(body.iban?.replace(/\s/g, "") || null), body.finRelation || null,
    ] as const;
    if (id) {
      db.run(
        `UPDATE tiers SET type = ?, compte_aux = ?, nom = ?, personne_physique = ?, professionnel = ?, siren = ?, tva_intra = ?, adresse = ?,
           code_postal = ?, ville = ?, pays = ?, email_enc = ?, email_hash = ?, telephone_enc = ?, iban_enc = COALESCE(?, iban_enc), fin_relation = ?
         WHERE id = ? AND dossier_id = ?`,
        ...params, id, dossierId,
      );
      return id;
    }
    return db.run(
      `INSERT INTO tiers (type, compte_aux, nom, personne_physique, professionnel, siren, tva_intra, adresse, code_postal, ville, pays,
         email_enc, email_hash, telephone_enc, iban_enc, fin_relation, dossier_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ...params, dossierId,
    ).lastInsertRowid;
  };

  app.post("/api/dossiers/:dossierId/tiers", async (req, reply) => {
    const { user, dossier } = requireDossier(req, "tiers:write");
    const body = tiersSchema.parse(req.body);
    if (db.get("SELECT 1 FROM tiers WHERE dossier_id = ? AND compte_aux = ?", dossier.id, body.compteAux)) {
      throw conflict(`Le compte auxiliaire ${body.compteAux} existe déjà`);
    }
    const id = save(dossier.id, body);
    audit.record({ userId: user.id, userEmail: user.email, action: "tiers.cree", entity: "tiers", entityId: id, dossierId: dossier.id, ip: req.ip });
    reply.code(201);
    return presentTiers(ctx, db.get<TiersRow>("SELECT * FROM tiers WHERE id = ?", id)!, true);
  });

  app.put("/api/dossiers/:dossierId/tiers/:id", async (req) => {
    const { user, dossier } = requireDossier(req, "tiers:write");
    const id = intParam(req, "id");
    const cur = db.get<TiersRow>("SELECT * FROM tiers WHERE id = ? AND dossier_id = ?", id, dossier.id);
    if (!cur) throw notFound("Tiers introuvable");
    if (cur.anonymized_at) throw conflict("Tiers anonymisé : modification impossible");
    const body = tiersSchema.parse(req.body);
    const used = db.get("SELECT 1 FROM ecriture_lignes l JOIN ecritures e ON e.id = l.ecriture_id WHERE e.dossier_id = ? AND l.compte_aux = ?", dossier.id, cur.compte_aux);
    if (used && body.compteAux !== cur.compte_aux) throw conflict("Le code auxiliaire est utilisé en comptabilité et ne peut être modifié");
    save(dossier.id, body, id);
    audit.record({ userId: user.id, userEmail: user.email, action: "tiers.modifie", entity: "tiers", entityId: id, dossierId: dossier.id, ip: req.ip });
    return presentTiers(ctx, db.get<TiersRow>("SELECT * FROM tiers WHERE id = ?", id)!, true);
  });
}
