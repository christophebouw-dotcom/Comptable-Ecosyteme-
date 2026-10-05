/**
 * Paie : salariés, paramètres employeur, bulletins et écritures de paie.
 *
 * Données personnelles sensibles (NIR, rémunération, taux de prélèvement à la
 * source) : chiffrées au repos, NIR masqué à l'affichage, consultation
 * journalisée, bulletin validé figé et conservé 5 ans (C. trav. art. L3243-4).
 */
import {
  BAREME_2026,
  type Bulletin,
  type ElementsVariables,
  LIBELLES_ORGANISMES,
  type ProfilPaie,
  calculerBulletin,
  ecriturePaie,
  isIsoDate,
  maskIban,
  maskNir,
  recapitulatifCharges,
  validateIban,
  validateNir,
} from "@compta/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { canonicalJson, sha256 } from "../security/crypto.js";
import { conflict, notFound, unprocessable } from "../http/errors.js";
import { type DossierRow, intParam, requireDossier } from "../http/guards.js";

interface SalarieRow {
  id: number;
  dossier_id: number;
  matricule: string;
  nom_enc: string;
  prenom_enc: string;
  nir_enc: string | null;
  email_enc: string | null;
  iban_enc: string | null;
  emploi: string;
  statut: "non_cadre" | "cadre";
  date_entree: string;
  date_sortie: string | null;
  profil: string;
  anonymized_at: string | null;
}

interface BulletinRow {
  id: number;
  salarie_id: number;
  periode: string;
  statut: "brouillon" | "valide";
  variables: string;
  resultat_enc: string;
  net_a_payer: number;
  cout_employeur: number;
  ecriture_id: number | null;
  hash: string | null;
  validated_at: string | null;
}

const isoDate = z.string().refine(isIsoDate, "Date invalide");
const periodeSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Période AAAA-MM attendue");
const cents = z.number().int().min(0).max(1e10);

const variablesSchema = z.object({
  heuresSup25: z.number().min(0).max(100).default(0),
  heuresSup50: z.number().min(0).max(100).default(0),
  primes: cents.default(0),
  heuresAbsence: z.number().min(0).max(220).default(0),
  indemnitesNonSoumises: cents.default(0),
});

const salarieSchema = z.object({
  matricule: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,20}$/),
  nom: z.string().trim().min(1).max(100),
  prenom: z.string().trim().min(1).max(100),
  nir: z.string().trim().max(21).nullish(),
  email: z.string().trim().email().max(200).nullish().or(z.literal("")),
  iban: z.string().trim().max(40).nullish().or(z.literal("")),
  emploi: z.string().trim().min(1).max(120),
  statut: z.enum(["non_cadre", "cadre"]),
  dateEntree: isoDate,
  dateSortie: isoDate.nullish(),
  salaireBase: cents.refine((v) => v > 0, "Salaire de base requis"),
  heuresMensuelles: z.number().min(1).max(220).default(151.67),
  tauxPas: z.number().min(0).max(43).nullable(),
  mutuelleSalarie: cents.default(0),
  mutuelleEmployeur: cents.default(0),
});

const finDeMois = (periode: string) => {
  const [a, m] = periode.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};

export async function paieRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  const { db, cipher, compta, audit } = ctx;
  const log = (req: FastifyRequest, action: string, dossierId: number, entityId: number | null, details?: Record<string, unknown>) =>
    audit.record({ userId: req.user!.id, userEmail: req.user!.email, action, entity: action.split(".")[0], entityId, dossierId, ip: req.ip, details });

  const parametres = (dossierId: number) => {
    const p = db.get<{ effectif: number; taux_at_mp: number; taux_versement_mobilite: number; convention: string | null }>(
      "SELECT * FROM paie_parametres WHERE dossier_id = ?", dossierId,
    );
    return { effectif: p?.effectif ?? 1, tauxAtMp: p?.taux_at_mp ?? 2.08, tauxVersementMobilite: p?.taux_versement_mobilite ?? 0, convention: p?.convention ?? null, configure: !!p };
  };

  const profilDe = (s: SalarieRow): ProfilPaie => ({ statut: s.statut, ...(JSON.parse(cipher.decrypt(s.profil)!) as Omit<ProfilPaie, "statut">) });

  const presentSalarie = (s: SalarieRow) => {
    const nir = cipher.decrypt(s.nir_enc);
    const iban = cipher.decrypt(s.iban_enc);
    return {
      id: s.id,
      matricule: s.matricule,
      nom: cipher.decrypt(s.nom_enc),
      prenom: cipher.decrypt(s.prenom_enc),
      nirMasque: nir ? maskNir(nir) : null,
      email: cipher.decrypt(s.email_enc),
      ibanMasque: iban ? maskIban(iban) : null,
      emploi: s.emploi,
      dateEntree: s.date_entree,
      dateSortie: s.date_sortie,
      anonymise: !!s.anonymized_at,
      ...profilDe(s),
    };
  };

  const getSalarie = (dossierId: number, id: number) => {
    const s = db.get<SalarieRow>("SELECT * FROM salaries WHERE id = ? AND dossier_id = ?", id, dossierId);
    if (!s) throw notFound("Salarié introuvable");
    return s;
  };

  const calculer = (dossier: DossierRow, s: SalarieRow, periode: string, variables: ElementsVariables): Bulletin => {
    if (s.anonymized_at) throw unprocessable("Salarié anonymisé");
    if (periode < s.date_entree.slice(0, 7)) throw unprocessable(`Le salarié est entré le ${s.date_entree}`);
    if (s.date_sortie && periode > s.date_sortie.slice(0, 7)) throw unprocessable(`Le salarié est sorti le ${s.date_sortie}`);
    try {
      return calculerBulletin(profilDe(s), variables, parametres(dossier.id), BAREME_2026);
    } catch (err) {
      throw unprocessable((err as Error).message);
    }
  };

  app.get("/api/dossiers/:dossierId/paie", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    const { periode } = z.object({ periode: periodeSchema }).parse(req.query);
    const salaries = db.all<SalarieRow>("SELECT * FROM salaries WHERE dossier_id = ? ORDER BY matricule", dossier.id).map(presentSalarie);
    const bulletins = db.all<BulletinRow>("SELECT * FROM bulletins WHERE dossier_id = ? AND periode = ?", dossier.id, periode);
    const resultats = bulletins.map((b) => JSON.parse(cipher.decrypt(b.resultat_enc)!) as Bulletin);
    return {
      periode,
      parametres: parametres(dossier.id),
      bareme: { annee: BAREME_2026.annee, smicHoraire: BAREME_2026.smicHoraire, pmss: BAREME_2026.pmss },
      salaries,
      bulletins: bulletins.map((b, i) => ({
        id: b.id, salarieId: b.salarie_id, statut: b.statut, brut: resultats[i]!.brut, netAPayer: b.net_a_payer, coutEmployeur: b.cout_employeur,
        ecritureId: b.ecriture_id, validatedAt: b.validated_at, variables: JSON.parse(b.variables) as ElementsVariables,
      })),
      recapitulatif: recapitulatifCharges(resultats).map((r) => ({ ...r, libelle: LIBELLES_ORGANISMES[r.organisme] })),
      totaux: {
        brut: resultats.reduce((a, r) => a + r.brut, 0),
        netAPayer: resultats.reduce((a, r) => a + r.netAPayer, 0),
        pas: resultats.reduce((a, r) => a + r.pas.montant, 0),
        coutEmployeur: resultats.reduce((a, r) => a + r.coutEmployeur, 0),
      },
    };
  });

  app.put("/api/dossiers/:dossierId/paie/parametres", async (req) => {
    const { dossier } = requireDossier(req, "paie:manage");
    const b = z
      .object({ effectif: z.number().int().min(0).max(100_000), tauxAtMp: z.number().min(0).max(20), tauxVersementMobilite: z.number().min(0).max(5), convention: z.string().trim().max(120).nullish() })
      .parse(req.body);
    db.run(
      `INSERT INTO paie_parametres (dossier_id, effectif, taux_at_mp, taux_versement_mobilite, convention, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (dossier_id) DO UPDATE SET effectif = excluded.effectif, taux_at_mp = excluded.taux_at_mp,
         taux_versement_mobilite = excluded.taux_versement_mobilite, convention = excluded.convention, updated_at = excluded.updated_at`,
      dossier.id, b.effectif, b.tauxAtMp, b.tauxVersementMobilite, b.convention ?? null, ctx.now().toISOString(),
    );
    log(req, "paie.parametres", dossier.id, dossier.id, b);
    return { ok: true };
  });

  const enregistrerSalarie = (dossierId: number, b: z.infer<typeof salarieSchema>, id?: number) => {
    if (b.nir && !validateNir(b.nir).valid) throw unprocessable(validateNir(b.nir).message!);
    if (b.iban && !validateIban(b.iban).valid) throw unprocessable("IBAN invalide");
    if (b.dateSortie && b.dateSortie < b.dateEntree) throw unprocessable("La date de sortie précède la date d'entrée");
    const profil = cipher.encrypt(
      JSON.stringify({ salaireBase: b.salaireBase, heuresMensuelles: b.heuresMensuelles, tauxPas: b.tauxPas, mutuelleSalarie: b.mutuelleSalarie, mutuelleEmployeur: b.mutuelleEmployeur }),
    );
    const vals = [
      b.matricule, cipher.encrypt(b.nom), cipher.encrypt(b.prenom), cipher.encrypt(b.email || null), cipher.blindIndex(b.email || null),
      b.emploi, b.statut, b.dateEntree, b.dateSortie ?? null, profil,
    ] as const;
    if (id) {
      db.run(
        `UPDATE salaries SET matricule = ?, nom_enc = ?, prenom_enc = ?, email_enc = ?, email_hash = ?, emploi = ?, statut = ?, date_entree = ?, date_sortie = ?, profil = ?,
           nir_enc = COALESCE(?, nir_enc), iban_enc = COALESCE(?, iban_enc) WHERE id = ? AND dossier_id = ?`,
        ...vals, cipher.encrypt(b.nir ? b.nir.replace(/\s/g, "") : null), cipher.encrypt(b.iban ? b.iban.replace(/\s/g, "") : null), id, dossierId,
      );
      return id;
    }
    if (db.get("SELECT 1 FROM salaries WHERE dossier_id = ? AND matricule = ?", dossierId, b.matricule)) throw conflict("Matricule déjà utilisé");
    return db.run(
      `INSERT INTO salaries (matricule, nom_enc, prenom_enc, email_enc, email_hash, emploi, statut, date_entree, date_sortie, profil, nir_enc, iban_enc, dossier_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ...vals, cipher.encrypt(b.nir ? b.nir.replace(/\s/g, "") : null), cipher.encrypt(b.iban ? b.iban.replace(/\s/g, "") : null), dossierId,
    ).lastInsertRowid;
  };

  app.post("/api/dossiers/:dossierId/paie/salaries", async (req, reply) => {
    const { dossier } = requireDossier(req, "paie:manage");
    const id = enregistrerSalarie(dossier.id, salarieSchema.parse(req.body));
    log(req, "paie.salarie_cree", dossier.id, id);
    reply.code(201);
    return { id };
  });

  app.put("/api/dossiers/:dossierId/paie/salaries/:id", async (req) => {
    const { dossier } = requireDossier(req, "paie:manage");
    const s = getSalarie(dossier.id, intParam(req, "id"));
    if (s.anonymized_at) throw conflict("Salarié anonymisé");
    enregistrerSalarie(dossier.id, salarieSchema.parse(req.body), s.id);
    log(req, "paie.salarie_modifie", dossier.id, s.id);
    return { ok: true };
  });

  const bulletinSchema = z.object({ salarieId: z.number().int().positive(), periode: periodeSchema, variables: variablesSchema });

  app.post("/api/dossiers/:dossierId/paie/calcul", async (req) => {
    const { dossier } = requireDossier(req, "paie:manage");
    const b = bulletinSchema.parse(req.body);
    return calculer(dossier, getSalarie(dossier.id, b.salarieId), b.periode, b.variables);
  });

  /** Enregistre (ou recalcule) le brouillon de bulletin d'un salarié pour une période. */
  app.post("/api/dossiers/:dossierId/paie/bulletins", async (req, reply) => {
    const { user, dossier } = requireDossier(req, "paie:manage");
    const b = bulletinSchema.parse(req.body);
    const s = getSalarie(dossier.id, b.salarieId);
    const r = calculer(dossier, s, b.periode, b.variables);
    const existant = db.get<BulletinRow>("SELECT * FROM bulletins WHERE salarie_id = ? AND periode = ?", s.id, b.periode);
    if (existant?.statut === "valide") throw conflict("Bulletin déjà validé pour cette période");
    const id = existant
      ? (db.run("UPDATE bulletins SET variables = ?, resultat_enc = ?, net_a_payer = ?, cout_employeur = ? WHERE id = ?",
          JSON.stringify(b.variables), cipher.encrypt(JSON.stringify(r)), r.netAPayer, r.coutEmployeur, existant.id), existant.id)
      : db.run(
          "INSERT INTO bulletins (dossier_id, salarie_id, periode, variables, resultat_enc, net_a_payer, cout_employeur, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          dossier.id, s.id, b.periode, JSON.stringify(b.variables), cipher.encrypt(JSON.stringify(r)), r.netAPayer, r.coutEmployeur, user.id,
        ).lastInsertRowid;
    log(req, "paie.bulletin_prepare", dossier.id, id, { periode: b.periode });
    reply.code(existant ? 200 : 201);
    return { id, bulletin: r };
  });

  const getBulletin = (dossierId: number, id: number) => {
    const b = db.get<BulletinRow>("SELECT * FROM bulletins WHERE id = ? AND dossier_id = ?", id, dossierId);
    if (!b) throw notFound("Bulletin introuvable");
    return b;
  };

  app.get("/api/dossiers/:dossierId/paie/bulletins/:id", async (req) => {
    const { dossier } = requireDossier(req, "dossiers:read");
    const b = getBulletin(dossier.id, intParam(req, "id"));
    const s = getSalarie(dossier.id, b.salarie_id);
    const p = parametres(dossier.id);
    log(req, "paie.bulletin_consulte", dossier.id, b.id);
    const sal = presentSalarie(s);
    return {
      id: b.id,
      periode: b.periode,
      statut: b.statut,
      hash: b.hash,
      validatedAt: b.validated_at,
      ecritureId: b.ecriture_id,
      employeur: { raisonSociale: dossier.raison_sociale, siren: dossier.siren, adresse: `${dossier.adresse}, ${dossier.code_postal} ${dossier.ville}`, convention: p.convention },
      salarie: { matricule: sal.matricule, nom: sal.nom, prenom: sal.prenom, emploi: sal.emploi, statut: sal.statut, dateEntree: sal.dateEntree, nirMasque: sal.nirMasque },
      variables: JSON.parse(b.variables) as ElementsVariables,
      bulletin: JSON.parse(cipher.decrypt(b.resultat_enc)!) as Bulletin,
    };
  });

  app.delete("/api/dossiers/:dossierId/paie/bulletins/:id", async (req) => {
    const { dossier } = requireDossier(req, "paie:manage");
    const b = getBulletin(dossier.id, intParam(req, "id"));
    if (b.statut === "valide") throw conflict("Bulletin validé : suppression interdite");
    db.run("DELETE FROM bulletins WHERE id = ?", b.id);
    log(req, "paie.bulletin_supprime", dossier.id, b.id);
    return { ok: true };
  });

  /**
   * Validation : le bulletin est figé (empreinte SHA-256) et l'écriture de paie
   * est générée en brouillard au journal PA, pour validation par l'expert-comptable.
   */
  app.post("/api/dossiers/:dossierId/paie/bulletins/:id/valider", async (req) => {
    const { user, dossier } = requireDossier(req, "paie:manage");
    const b = getBulletin(dossier.id, intParam(req, "id"));
    if (b.statut === "valide") throw conflict("Bulletin déjà validé");
    const s = getSalarie(dossier.id, b.salarie_id);
    const r = JSON.parse(cipher.decrypt(b.resultat_enc)!) as Bulletin;
    const date = finDeMois(b.periode);
    const res = db.transaction(() => {
      db.run("INSERT OR IGNORE INTO journaux (dossier_id, code, libelle, type) VALUES (?, 'PA', 'Paie', 'od')", dossier.id);
      const e = ecriturePaie(r, {
        journal: "PA", date, pieceRef: `PAIE-${b.periode.replace("-", "")}-${s.matricule}`.slice(0, 60), nomSalarie: s.matricule, periode: b.periode,
      });
      const ecritureId = compta.create(dossier.id, e, user.id);
      const validatedAt = ctx.now().toISOString();
      const hash = sha256(canonicalJson({ dossier: dossier.id, salarie: s.id, periode: b.periode, variables: b.variables, resultat: r, validatedAt }));
      db.run("UPDATE bulletins SET statut = 'valide', hash = ?, validated_at = ?, validated_by = ?, ecriture_id = ? WHERE id = ?", hash, validatedAt, user.id, ecritureId, b.id);
      return { ecritureId, hash };
    });
    log(req, "paie.bulletin_valide", dossier.id, b.id, { periode: b.periode, ecriture: res.ecritureId });
    return res;
  });
}
