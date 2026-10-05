import {
  type Facture,
  computeTotaux,
  controlerMentions,
  ecritureDeVente,
  echeance,
  frenchVatNumber,
  generateFacturX,
  isIsoDate,
  mentionsLegales,
  nextNumeroFacture,
} from "@compta/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { conflict, notFound, unprocessable } from "../http/errors.js";
import { type DossierRow, intParam, requireDossier } from "../http/guards.js";
import { canonicalJson, sha256 } from "../security/crypto.js";
import type { TiersRow } from "./tiers.js";

const isoDate = z.string().refine(isIsoDate, "Date invalide");

const brouillonSchema = z.object({
  tiersId: z.number().int().positive(),
  type: z.enum(["facture", "avoir"]).default("facture"),
  dateEmission: isoDate.optional(),
  delaiPaiementJours: z.number().int().min(0).max(60).default(30),
  dateLivraison: isoDate.nullish(),
  adresseLivraison: z.string().trim().max(300).nullish(),
  categorie: z.enum(["biens", "services", "mixte"]),
  tvaSurDebits: z.boolean().default(false),
  mentionExoneration: z.string().trim().max(300).nullish(),
  tauxPenalitesRetard: z.string().trim().max(120).default("3 fois le taux d'intérêt légal"),
  conditionsEscompte: z.string().trim().max(200).nullish(),
  factureOrigineId: z.number().int().positive().nullish(),
  compteProduit: z.string().regex(/^7[0-9]{2,9}$/).nullish(),
  lignes: z
    .array(
      z.object({
        designation: z.string().trim().min(1).max(300),
        quantite: z.number().positive().max(1e7),
        unite: z.string().trim().max(5).optional(),
        prixUnitaireHT: z.number().int().min(0).max(1e12),
        tauxTvaBp: z.union([z.literal(2000), z.literal(1000), z.literal(550), z.literal(210), z.literal(0)]),
        remisePct: z.number().min(0).max(100).optional(),
      }),
    )
    .min(1)
    .max(200),
});

type Brouillon = z.infer<typeof brouillonSchema>;

interface FactureRow {
  id: number;
  dossier_id: number;
  tiers_id: number;
  type: "facture" | "avoir";
  numero: string | null;
  statut: "brouillon" | "emise" | "payee";
  date_emission: string | null;
  date_echeance: string | null;
  facture_origine_id: number | null;
  data: string;
  total_ht: number;
  total_tva: number;
  total_ttc: number;
  ecriture_id: number | null;
  hash: string | null;
  created_at: string;
  emitted_at: string | null;
  paid_at: string | null;
}

/** Construit la facture complète à partir du dossier (vendeur), du tiers (client) et du brouillon. */
function buildFacture(ctx: AppContext, dossier: DossierRow, tiers: TiersRow, b: Brouillon, numero: string, origine: string | null): Facture {
  const dateEmission = b.dateEmission ?? ctx.now().toISOString().slice(0, 10);
  return {
    type: b.type,
    numero,
    dateEmission,
    dateEcheance: echeance(dateEmission, b.delaiPaiementJours),
    dateLivraison: b.dateLivraison ?? null,
    adresseLivraison: b.adresseLivraison ?? null,
    categorie: b.categorie,
    tvaSurDebits: b.tvaSurDebits,
    mentionExoneration: b.mentionExoneration ?? (dossier.regime_tva === "franchise" ? "TVA non applicable, art. 293 B du CGI" : null),
    tauxPenalitesRetard: b.tauxPenalitesRetard,
    conditionsEscompte: b.conditionsEscompte ?? null,
    factureOrigine: origine,
    vendeur: {
      nom: dossier.raison_sociale,
      adresse: dossier.adresse,
      codePostal: dossier.code_postal,
      ville: dossier.ville,
      pays: dossier.pays,
      siren: dossier.siren,
      tvaIntra: dossier.regime_tva === "franchise" ? null : frenchVatNumber(dossier.siren),
      formeJuridique: dossier.forme_juridique,
      capital: dossier.capital,
      rcs: dossier.rcs,
      email: dossier.email_contact,
    },
    acheteur: {
      nom: tiers.nom,
      adresse: tiers.adresse ?? "",
      codePostal: tiers.code_postal ?? "",
      ville: tiers.ville ?? "",
      pays: tiers.pays,
      siren: tiers.siren,
      tvaIntra: tiers.tva_intra,
      professionnel: !!tiers.professionnel,
    },
    lignes: b.lignes,
  };
}

export async function factureRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  const { db, audit, compta, cipher } = ctx;

  const getFacture = (dossierId: number, id: number) => {
    const f = db.get<FactureRow>("SELECT * FROM factures WHERE id = ? AND dossier_id = ?", id, dossierId);
    if (!f) throw notFound("Facture introuvable");
    return f;
  };
  const getTiers = (dossierId: number, id: number) => {
    const t = db.get<TiersRow>("SELECT * FROM tiers WHERE id = ? AND dossier_id = ?", id, dossierId);
    if (!t) throw unprocessable("Client introuvable dans ce dossier");
    if (t.type !== "client") throw unprocessable("Le tiers sélectionné n'est pas un client");
    return t;
  };
  const origineNumero = (dossierId: number, id?: number | null) =>
    id ? (getFacture(dossierId, id).numero ?? null) : null;

  const present = (dossier: DossierRow, f: FactureRow) => {
    const tiers = db.get<TiersRow>("SELECT * FROM tiers WHERE id = ?", f.tiers_id)!;
    let facture: Facture;
    if (f.statut === "brouillon") {
      const b = JSON.parse(f.data) as Brouillon;
      facture = buildFacture(ctx, dossier, tiers, b, "(brouillon)", origineNumero(dossier.id, b.factureOrigineId));
    } else {
      facture = JSON.parse(f.data) as Facture;
    }
    const controles = controlerMentions({ ...facture, numero: facture.numero === "(brouillon)" ? "PROVISOIRE" : facture.numero });
    return {
      id: f.id,
      statut: f.statut,
      type: f.type,
      numero: f.numero,
      tiersId: f.tiers_id,
      client: tiers.nom,
      dateEmission: facture.dateEmission,
      dateEcheance: facture.dateEcheance,
      totaux: computeTotaux(facture),
      facture,
      brouillon: f.statut === "brouillon" ? JSON.parse(f.data) : null,
      controles,
      mentions: mentionsLegales(facture),
      ecritureId: f.ecriture_id,
      hash: f.hash,
      emittedAt: f.emitted_at,
      paidAt: f.paid_at,
    };
  };

  app.get("/api/dossiers/:dossierId/factures", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    return db
      .all<FactureRow & { client: string }>(
        `SELECT f.*, t.nom AS client FROM factures f JOIN tiers t ON t.id = f.tiers_id WHERE f.dossier_id = ? ORDER BY f.created_at DESC`,
        dossier.id,
      )
      .map((f) => {
        const totaux = f.statut === "brouillon" ? computeTotaux(JSON.parse(f.data) as Brouillon) : { totalHT: f.total_ht, totalTVA: f.total_tva, totalTTC: f.total_ttc };
        return {
          id: f.id, type: f.type, numero: f.numero, statut: f.statut, client: f.client, dateEmission: f.date_emission,
          dateEcheance: f.date_echeance, totalHT: totaux.totalHT, totalTVA: totaux.totalTVA, totalTTC: totaux.totalTTC,
          enRetard: f.statut === "emise" && !!f.date_echeance && f.date_echeance < ctx.now().toISOString().slice(0, 10),
        };
      });
  });

  app.get("/api/dossiers/:dossierId/factures/:id", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    return present(dossier, getFacture(dossier.id, intParam(req, "id")));
  });

  app.post("/api/dossiers/:dossierId/factures", async (req, reply) => {
    const { user, dossier } = requireDossier(req, "factures:write");
    const b = brouillonSchema.parse(req.body);
    getTiers(dossier.id, b.tiersId);
    if (b.type === "avoir" && !b.factureOrigineId) throw unprocessable("Un avoir doit référencer une facture d'origine");
    if (b.factureOrigineId && getFacture(dossier.id, b.factureOrigineId).statut === "brouillon") throw unprocessable("La facture d'origine n'est pas émise");
    const id = db.run(
      "INSERT INTO factures (dossier_id, tiers_id, type, facture_origine_id, data, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      dossier.id, b.tiersId, b.type, b.factureOrigineId ?? null, JSON.stringify(b), user.id,
    ).lastInsertRowid;
    audit.record({ userId: user.id, userEmail: user.email, action: "facture.brouillon_cree", entity: "facture", entityId: id, dossierId: dossier.id, ip: req.ip });
    reply.code(201);
    return present(dossier, getFacture(dossier.id, id));
  });

  app.put("/api/dossiers/:dossierId/factures/:id", async (req) => {
    const { dossier } = requireDossier(req, "factures:write");
    const f = getFacture(dossier.id, intParam(req, "id"));
    if (f.statut !== "brouillon") throw conflict("Facture émise : modification interdite (émettez un avoir)");
    const b = brouillonSchema.parse(req.body);
    getTiers(dossier.id, b.tiersId);
    db.run("UPDATE factures SET tiers_id = ?, type = ?, facture_origine_id = ?, data = ? WHERE id = ?", b.tiersId, b.type, b.factureOrigineId ?? null, JSON.stringify(b), f.id);
    return present(dossier, getFacture(dossier.id, f.id));
  });

  app.delete("/api/dossiers/:dossierId/factures/:id", async (req) => {
    const { user, dossier } = requireDossier(req, "factures:write");
    const f = getFacture(dossier.id, intParam(req, "id"));
    if (f.statut !== "brouillon") throw conflict("Facture émise : suppression interdite");
    db.run("DELETE FROM factures WHERE id = ?", f.id);
    audit.record({ userId: user.id, userEmail: user.email, action: "facture.brouillon_supprime", entity: "facture", entityId: f.id, dossierId: dossier.id, ip: req.ip });
    return { ok: true };
  });

  /**
   * Émission : attribution du numéro dans la séquence continue, contrôle des
   * mentions, figement de la facture (empreinte SHA-256) et génération de
   * l'écriture de vente en brouillard pour validation par l'expert.
   */
  app.post("/api/dossiers/:dossierId/factures/:id/emettre", async (req) => {
    const { user, dossier } = requireDossier(req, "factures:write");
    const f = getFacture(dossier.id, intParam(req, "id"));
    if (f.statut !== "brouillon") throw conflict("Facture déjà émise");
    const b = JSON.parse(f.data) as Brouillon;
    const tiers = getTiers(dossier.id, b.tiersId);
    const prefixe = b.type === "avoir" ? "AV" : dossier.prefixe_facture;

    const result = db.transaction(() => {
      const preview = buildFacture(ctx, dossier, tiers, b, "PROVISOIRE", origineNumero(dossier.id, b.factureOrigineId));
      const bloquants = controlerMentions(preview).filter((c) => c.bloquant);
      if (bloquants.length) throw unprocessable("Mentions obligatoires manquantes ou invalides", bloquants);

      const annee = Number(preview.dateEmission.slice(0, 4));
      const derniere = db.get<{ d: string | null }>(
        "SELECT MAX(date_emission) AS d FROM factures WHERE dossier_id = ? AND statut <> 'brouillon' AND numero LIKE ?",
        dossier.id, `${prefixe}${annee}-%`,
      )?.d;
      if (derniere && preview.dateEmission < derniere) {
        throw unprocessable(`Numérotation chronologique : la date d'émission ne peut être antérieure au ${derniere} (CGI ann. II art. 242 nonies A)`);
      }
      db.run("INSERT OR IGNORE INTO facture_sequences (dossier_id, prefixe, annee, dernier) VALUES (?, ?, ?, 0)", dossier.id, prefixe, annee);
      const seq = db.get<{ dernier: number }>("SELECT dernier FROM facture_sequences WHERE dossier_id = ? AND prefixe = ? AND annee = ?", dossier.id, prefixe, annee)!;
      const numero = nextNumeroFacture(prefixe, annee, seq.dernier);
      db.run("UPDATE facture_sequences SET dernier = dernier + 1 WHERE dossier_id = ? AND prefixe = ? AND annee = ?", dossier.id, prefixe, annee);

      const facture: Facture = { ...preview, numero };
      const totaux = computeTotaux(facture);
      const hash = sha256(canonicalJson(facture));
      const ecritureId = compta.create(dossier.id, ecritureDeVente(facture, tiers.compte_aux, b.compteProduit ?? undefined), user.id, { factureId: f.id });
      db.run(
        `UPDATE factures SET statut = 'emise', numero = ?, date_emission = ?, date_echeance = ?, data = ?, total_ht = ?, total_tva = ?, total_ttc = ?,
           ecriture_id = ?, hash = ?, emitted_at = ? WHERE id = ?`,
        numero, facture.dateEmission, facture.dateEcheance, JSON.stringify(facture), totaux.totalHT, totaux.totalTVA, totaux.totalTTC,
        ecritureId, hash, ctx.now().toISOString(), f.id,
      );
      return { numero, hash, ecritureId };
    });
    audit.record({ userId: user.id, userEmail: user.email, action: "facture.emise", entity: "facture", entityId: f.id, dossierId: dossier.id, ip: req.ip, details: result });
    return present(dossier, getFacture(dossier.id, f.id));
  });

  app.post("/api/dossiers/:dossierId/factures/:id/payer", async (req) => {
    const { user, dossier } = requireDossier(req, "factures:write");
    const f = getFacture(dossier.id, intParam(req, "id"));
    const { date } = z.object({ date: isoDate }).parse(req.body);
    if (f.statut !== "emise") throw conflict("Seule une facture émise non réglée peut être marquée payée");
    db.run("UPDATE factures SET statut = 'payee', paid_at = ? WHERE id = ?", date, f.id);
    audit.record({ userId: user.id, userEmail: user.email, action: "facture.payee", entity: "facture", entityId: f.id, dossierId: dossier.id, ip: req.ip, details: { date } });
    return present(dossier, getFacture(dossier.id, f.id));
  });

  app.post("/api/dossiers/:dossierId/factures/:id/avoir", async (req, reply) => {
    const { user, dossier } = requireDossier(req, "factures:write");
    const f = getFacture(dossier.id, intParam(req, "id"));
    if (f.statut === "brouillon" || f.type === "avoir") throw unprocessable("Un avoir se crée à partir d'une facture émise");
    const origine = JSON.parse(f.data) as Facture;
    const b: Brouillon = {
      tiersId: f.tiers_id, type: "avoir", delaiPaiementJours: 0, categorie: origine.categorie, tvaSurDebits: !!origine.tvaSurDebits,
      tauxPenalitesRetard: origine.tauxPenalitesRetard ?? "3 fois le taux d'intérêt légal", mentionExoneration: origine.mentionExoneration,
      factureOrigineId: f.id, lignes: origine.lignes.map((l) => ({ ...l, tauxTvaBp: l.tauxTvaBp as Brouillon["lignes"][number]["tauxTvaBp"] })),
    };
    const id = db.run(
      "INSERT INTO factures (dossier_id, tiers_id, type, facture_origine_id, data, created_by) VALUES (?, ?, 'avoir', ?, ?, ?)",
      dossier.id, f.tiers_id, f.id, JSON.stringify(b), user.id,
    ).lastInsertRowid;
    audit.record({ userId: user.id, userEmail: user.email, action: "facture.avoir_cree", entity: "facture", entityId: id, dossierId: dossier.id, ip: req.ip, details: { origine: f.numero } });
    reply.code(201);
    return present(dossier, getFacture(dossier.id, id));
  });

  app.get("/api/dossiers/:dossierId/factures/:id/facturx", async (req, reply) => {
    const { user, dossier } = requireDossier(req, "dossiers:read");
    const f = getFacture(dossier.id, intParam(req, "id"));
    if (f.statut === "brouillon") throw unprocessable("Le XML Factur-X n'est disponible qu'après émission");
    const xml = generateFacturX(JSON.parse(f.data) as Facture, { iban: cipher.decrypt(dossier.iban_enc), bic: dossier.bic });
    audit.record({ userId: user.id, userEmail: user.email, action: "facture.facturx_export", entity: "facture", entityId: f.id, dossierId: dossier.id, ip: req.ip });
    reply.header("Content-Type", "application/xml; charset=utf-8").header("Content-Disposition", `attachment; filename="factur-x-${f.numero}.xml"`);
    return xml;
  });
}
