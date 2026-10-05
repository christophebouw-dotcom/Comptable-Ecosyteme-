import {
  type Ecriture,
  type FecLigne,
  type LigneEcriture,
  STANDARD_JOURNALS,
  canLettrer,
  computeANouveaux,
  computeBalance,
  contrePassation,
  defaultLabel,
  nextLettrage,
  validateEcriture,
} from "@compta/core";
import type { Database } from "../db/index.js";
import { badRequest, conflict, notFound, unprocessable } from "../http/errors.js";
import { canonicalJson, sha256 } from "../security/crypto.js";
import { GENESIS_HASH } from "./audit.js";

export interface ExerciceRow {
  id: number;
  dossier_id: number;
  debut: string;
  fin: string;
  statut: "ouvert" | "cloture";
  cloture_at: string | null;
  empreinte_cloture: string | null;
}

export interface EcritureRow {
  id: number;
  dossier_id: number;
  exercice_id: number;
  journal: string;
  numero: number | null;
  seq: number | null;
  date: string;
  libelle: string;
  piece_ref: string;
  piece_date: string | null;
  statut: "brouillard" | "validee";
  extourne_de: number | null;
  facture_id: number | null;
  created_at: string;
  validated_at: string | null;
  validated_by: number | null;
  prev_hash: string | null;
  hash: string | null;
}

interface LigneRow {
  id: number;
  ecriture_id: number;
  ordre: number;
  compte: string;
  compte_aux: string | null;
  libelle: string | null;
  debit: number;
  credit: number;
  taux_tva: number | null;
  lettrage: string | null;
  date_lettrage: string | null;
}

/** Écriture telle qu'exposée par l'API : conforme au type Ecriture du moteur comptable. */
export interface EcritureComplete extends Ecriture {
  id: number;
  dossierId: number;
  exerciceId: number;
  numero: number | null;
  seq: number | null;
  pieceDate: string;
  statut: "brouillard" | "validee";
  extourneDe: number | null;
  factureId: number | null;
  createdAt: string;
  validatedAt: string | null;
  validatedBy: number | null;
  prevHash: string | null;
  hash: string | null;
  lignes: (LigneEcriture & { id: number; dateLettrage: string | null })[];
}

export class ComptaService {
  constructor(private readonly db: Database) {}

  // -- Dossier & plan comptable -------------------------------------------------

  initDossier(dossierId: number, debut: string, fin: string): number {
    for (const j of STANDARD_JOURNALS) {
      this.db.run("INSERT OR IGNORE INTO journaux (dossier_id, code, libelle, type) VALUES (?, ?, ?, ?)", dossierId, j.code, j.libelle, j.type);
    }
    return this.db.run("INSERT INTO exercices (dossier_id, debut, fin) VALUES (?, ?, ?)", dossierId, debut, fin).lastInsertRowid;
  }

  libelleCompte(dossierId: number): (compte: string) => string {
    const custom = new Map(
      this.db.all<{ numero: string; libelle: string }>("SELECT numero, libelle FROM comptes WHERE dossier_id = ?", dossierId).map((c) => [c.numero, c.libelle]),
    );
    return (compte) => custom.get(compte) ?? defaultLabel(compte);
  }

  journaux(dossierId: number) {
    return this.db.all<{ code: string; libelle: string; type: string }>("SELECT code, libelle, type FROM journaux WHERE dossier_id = ? ORDER BY code", dossierId);
  }

  // -- Exercices -------------------------------------------------------------------

  exercices(dossierId: number): ExerciceRow[] {
    return this.db.all<ExerciceRow>("SELECT * FROM exercices WHERE dossier_id = ? ORDER BY debut DESC", dossierId);
  }

  exercice(dossierId: number, exerciceId: number): ExerciceRow {
    const ex = this.db.get<ExerciceRow>("SELECT * FROM exercices WHERE id = ? AND dossier_id = ?", exerciceId, dossierId);
    if (!ex) throw notFound("Exercice introuvable");
    return ex;
  }

  exerciceForDate(dossierId: number, date: string): ExerciceRow {
    const ex = this.db.get<ExerciceRow>("SELECT * FROM exercices WHERE dossier_id = ? AND debut <= ? AND fin >= ?", dossierId, date, date);
    if (!ex) throw unprocessable(`Aucun exercice ne couvre la date ${date}`);
    if (ex.statut === "cloture") throw unprocessable(`L'exercice ${ex.debut} → ${ex.fin} est clôturé`);
    return ex;
  }

  // -- Écritures ------------------------------------------------------------------

  private lignesOf(ids: number[]): Map<number, LigneRow[]> {
    const map = new Map<number, LigneRow[]>();
    if (ids.length === 0) return map;
    // Lecture par lots pour rester sous la limite de paramètres SQLite.
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const rows = this.db.all<LigneRow>(
        `SELECT * FROM ecriture_lignes WHERE ecriture_id IN (${chunk.map(() => "?").join(",")}) ORDER BY ecriture_id, ordre`,
        ...chunk,
      );
      for (const r of rows) {
        const list = map.get(r.ecriture_id) ?? [];
        list.push(r);
        map.set(r.ecriture_id, list);
      }
    }
    return map;
  }

  private hydrate(rows: EcritureRow[]): EcritureComplete[] {
    const lignes = this.lignesOf(rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id,
      dossierId: r.dossier_id,
      exerciceId: r.exercice_id,
      journal: r.journal,
      numero: r.numero,
      seq: r.seq,
      date: r.date,
      libelle: r.libelle,
      pieceRef: r.piece_ref,
      pieceDate: r.piece_date ?? r.date,
      statut: r.statut,
      extourneDe: r.extourne_de,
      factureId: r.facture_id,
      createdAt: r.created_at,
      validatedAt: r.validated_at,
      validatedBy: r.validated_by,
      prevHash: r.prev_hash,
      hash: r.hash,
      lignes: (lignes.get(r.id) ?? []).map((l) => ({
        id: l.id,
        compte: l.compte,
        compteAux: l.compte_aux,
        libelle: l.libelle ?? undefined,
        debit: l.debit,
        credit: l.credit,
        tauxTva: l.taux_tva,
        lettrage: l.lettrage,
        dateLettrage: l.date_lettrage,
      })),
    }));
  }

  ecritures(
    dossierId: number,
    filter: { exerciceId?: number; journal?: string; statut?: string; debut?: string; fin?: string; compte?: string } = {},
  ): EcritureComplete[] {
    const where = ["e.dossier_id = ?"];
    const params: (string | number)[] = [dossierId];
    if (filter.exerciceId) (where.push("e.exercice_id = ?"), params.push(filter.exerciceId));
    if (filter.journal) (where.push("e.journal = ?"), params.push(filter.journal));
    if (filter.statut) (where.push("e.statut = ?"), params.push(filter.statut));
    if (filter.debut) (where.push("e.date >= ?"), params.push(filter.debut));
    if (filter.fin) (where.push("e.date <= ?"), params.push(filter.fin));
    if (filter.compte) {
      where.push("EXISTS (SELECT 1 FROM ecriture_lignes l WHERE l.ecriture_id = e.id AND l.compte LIKE ?)");
      params.push(`${filter.compte}%`);
    }
    const rows = this.db.all<EcritureRow>(
      `SELECT e.* FROM ecritures e WHERE ${where.join(" AND ")} ORDER BY e.date, COALESCE(e.numero, 1e12), e.id`,
      ...params,
    );
    return this.hydrate(rows);
  }

  ecriture(dossierId: number, id: number): EcritureComplete {
    const row = this.db.get<EcritureRow>("SELECT * FROM ecritures WHERE id = ? AND dossier_id = ?", id, dossierId);
    if (!row) throw notFound("Écriture introuvable");
    return this.hydrate([row])[0]!;
  }

  private assertJournal(dossierId: number, code: string) {
    if (!this.db.get("SELECT 1 FROM journaux WHERE dossier_id = ? AND code = ?", dossierId, code)) {
      throw unprocessable(`Journal inconnu : ${code}`);
    }
  }

  private insertLignes(ecritureId: number, lignes: LigneEcriture[]) {
    lignes.forEach((l, i) =>
      this.db.run(
        `INSERT INTO ecriture_lignes (ecriture_id, ordre, compte, compte_aux, libelle, debit, credit, taux_tva, lettrage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ecritureId, i + 1, l.compte, l.compteAux || null, l.libelle || null, l.debit, l.credit, l.tauxTva ?? null, null,
      ),
    );
  }

  create(dossierId: number, e: Ecriture, userId: number | null, extra: { extourneDe?: number; factureId?: number } = {}): number {
    return this.db.transaction(() => {
      this.assertJournal(dossierId, e.journal);
      const ex = this.exerciceForDate(dossierId, e.date);
      const issues = validateEcriture(e, { debut: ex.debut, fin: ex.fin });
      if (issues.length) throw unprocessable("Écriture invalide", issues);
      const id = this.db.run(
        `INSERT INTO ecritures (dossier_id, exercice_id, journal, date, libelle, piece_ref, piece_date, extourne_de, facture_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        dossierId, ex.id, e.journal, e.date, e.libelle.trim(), e.pieceRef.trim(), e.pieceDate ?? e.date,
        extra.extourneDe ?? null, extra.factureId ?? null, userId,
      ).lastInsertRowid;
      this.insertLignes(id, e.lignes);
      return id;
    });
  }

  update(dossierId: number, id: number, e: Ecriture): void {
    this.db.transaction(() => {
      const cur = this.ecriture(dossierId, id);
      if (cur.statut === "validee") throw conflict("Écriture validée : modification interdite (utilisez une contre-passation)");
      this.assertJournal(dossierId, e.journal);
      const ex = this.exerciceForDate(dossierId, e.date);
      const issues = validateEcriture(e, { debut: ex.debut, fin: ex.fin });
      if (issues.length) throw unprocessable("Écriture invalide", issues);
      this.db.run(
        "UPDATE ecritures SET exercice_id = ?, journal = ?, date = ?, libelle = ?, piece_ref = ?, piece_date = ? WHERE id = ?",
        ex.id, e.journal, e.date, e.libelle.trim(), e.pieceRef.trim(), e.pieceDate ?? e.date, id,
      );
      this.db.run("DELETE FROM ecriture_lignes WHERE ecriture_id = ?", id);
      this.insertLignes(id, e.lignes);
    });
  }

  delete(dossierId: number, id: number): void {
    const cur = this.ecriture(dossierId, id);
    if (cur.statut === "validee") throw conflict("Écriture validée : suppression interdite");
    if (cur.factureId) throw conflict("Écriture générée par une facture émise : suppression interdite");
    this.db.run("DELETE FROM ecritures WHERE id = ?", id);
  }

  /** Données couvertes par l'empreinte d'une écriture validée. */
  private hashPayload(e: EcritureComplete, numero: number, validatedAt: string) {
    return canonicalJson({
      dossier: e.dossierId,
      exercice: e.exerciceId,
      numero,
      journal: e.journal,
      date: e.date,
      libelle: e.libelle,
      piece: e.pieceRef,
      pieceDate: e.pieceDate,
      validatedAt,
      lignes: e.lignes.map((l) => [l.compte, l.compteAux ?? null, l.libelle ?? null, l.debit, l.credit, l.tauxTva ?? null]),
    });
  }

  /**
   * Validation : l'écriture devient définitive, reçoit le numéro suivant de la
   * séquence continue de l'exercice et l'empreinte SHA-256 chaînée à la
   * précédente écriture validée du dossier.
   */
  validate(dossierId: number, ids: number[], userId: number): { id: number; numero: number; hash: string }[] {
    return this.db.transaction(() => {
      const out: { id: number; numero: number; hash: string }[] = [];
      const sorted = ids
        .map((id) => this.ecriture(dossierId, id))
        .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
      for (const e of sorted) {
        if (e.statut === "validee") continue;
        const ex = this.exercice(dossierId, e.exerciceId);
        if (ex.statut === "cloture") throw unprocessable("Exercice clôturé");
        const issues = validateEcriture(e, { debut: ex.debut, fin: ex.fin });
        if (issues.length) throw unprocessable(`Écriture ${e.pieceRef} invalide`, issues);
        const numero = (this.db.get<{ n: number | null }>("SELECT MAX(numero) AS n FROM ecritures WHERE exercice_id = ?", ex.id)?.n ?? 0) + 1;
        const prev = this.db.get<{ hash: string; seq: number }>(
          "SELECT hash, seq FROM ecritures WHERE dossier_id = ? AND statut = 'validee' ORDER BY seq DESC LIMIT 1",
          dossierId,
        );
        const prevHash = prev?.hash ?? GENESIS_HASH;
        const seq = (prev?.seq ?? 0) + 1;
        const validatedAt = new Date().toISOString();
        const hash = sha256(prevHash + this.hashPayload(e, numero, validatedAt));
        this.db.run(
          "UPDATE ecritures SET statut = 'validee', numero = ?, seq = ?, validated_at = ?, validated_by = ?, prev_hash = ?, hash = ? WHERE id = ? AND statut = 'brouillard'",
          numero, seq, validatedAt, userId, prevHash, hash, e.id,
        );
        out.push({ id: e.id, numero, hash });
      }
      return out;
    });
  }

  /** Vérifie la chaîne d'empreintes des écritures validées d'un dossier. */
  verifyChain(dossierId: number): { ok: boolean; count: number; brokenAt?: number } {
    const rows = this.db.all<EcritureRow>(
      "SELECT * FROM ecritures WHERE dossier_id = ? AND statut = 'validee' ORDER BY seq",
      dossierId,
    );
    const full = this.hydrate(rows);
    let prev = GENESIS_HASH;
    for (const e of full) {
      const expected = sha256(e.prevHash + this.hashPayload(e, e.numero!, e.validatedAt!));
      if (e.prevHash !== prev || expected !== e.hash) return { ok: false, count: full.length, brokenAt: e.id };
      prev = e.hash!;
    }
    return { ok: true, count: full.length };
  }

  extourner(dossierId: number, id: number, date: string, motif: string, userId: number): number {
    const e = this.ecriture(dossierId, id);
    if (e.statut !== "validee") throw conflict("Seule une écriture validée se corrige par contre-passation ; modifiez directement le brouillard");
    if (this.db.get("SELECT 1 FROM ecritures WHERE extourne_de = ?", id)) throw conflict("Cette écriture a déjà été extournée");
    const ext = contrePassation(
      { journal: e.journal, date: e.date, libelle: e.libelle, pieceRef: e.pieceRef, pieceDate: e.pieceDate, lignes: e.lignes },
      date,
      motif,
    );
    return this.create(dossierId, ext, userId, { extourneDe: id });
  }

  lettrer(dossierId: number, ligneIds: number[]): string {
    return this.db.transaction(() => {
      const rows = this.db.all<LigneRow & { dossier_id: number; statut: string }>(
        `SELECT l.*, e.dossier_id, e.statut FROM ecriture_lignes l JOIN ecritures e ON e.id = l.ecriture_id
         WHERE l.id IN (${ligneIds.map(() => "?").join(",")})`,
        ...ligneIds,
      );
      if (rows.length !== ligneIds.length || rows.some((r) => r.dossier_id !== dossierId)) throw notFound("Lignes introuvables");
      if (rows.some((r) => r.lettrage)) throw conflict("Certaines lignes sont déjà lettrées");
      const issues = canLettrer(rows.map((r) => ({ compte: r.compte, debit: r.debit, credit: r.credit })));
      if (issues.length) throw unprocessable(issues[0]!.message, issues);
      const last = this.db.get<{ l: string | null }>(
        `SELECT l.lettrage AS l FROM ecriture_lignes l JOIN ecritures e ON e.id = l.ecriture_id
         WHERE e.dossier_id = ? AND l.compte = ? AND l.lettrage IS NOT NULL
         ORDER BY length(l.lettrage) DESC, l.lettrage DESC LIMIT 1`,
        dossierId, rows[0]!.compte,
      );
      const code = nextLettrage(last?.l ?? null);
      const today = new Date().toISOString().slice(0, 10);
      for (const r of rows) this.db.run("UPDATE ecriture_lignes SET lettrage = ?, date_lettrage = ? WHERE id = ?", code, today, r.id);
      return code;
    });
  }

  delettrer(dossierId: number, compte: string, code: string): number {
    return this.db.run(
      `UPDATE ecriture_lignes SET lettrage = NULL, date_lettrage = NULL
       WHERE compte = ? AND lettrage = ? AND ecriture_id IN (SELECT id FROM ecritures WHERE dossier_id = ?)`,
      compte, code, dossierId,
    ).changes;
  }

  /**
   * Clôture : contrôle l'absence de brouillard et l'équilibre, calcule
   * l'empreinte de clôture, verrouille l'exercice et ouvre l'exercice suivant
   * avec ses à-nouveaux validés.
   */
  cloturer(dossierId: number, exerciceId: number, userId: number): { empreinte: string; nouvelExerciceId: number } {
    return this.db.transaction(() => {
      const ex = this.exercice(dossierId, exerciceId);
      if (ex.statut === "cloture") throw conflict("Exercice déjà clôturé");
      const brouillards = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ecritures WHERE exercice_id = ? AND statut = 'brouillard'", ex.id)!.n;
      if (brouillards > 0) throw unprocessable(`${brouillards} écriture(s) en brouillard : validez-les ou supprimez-les avant la clôture`);
      const ecritures = this.ecritures(dossierId, { exerciceId: ex.id });
      const balance = computeBalance(ecritures);
      if (!balance.equilibree) throw unprocessable("La balance n'est pas équilibrée");
      const chain = this.verifyChain(dossierId);
      if (!chain.ok) throw unprocessable(`Chaîne d'intégrité rompue (écriture ${chain.brokenAt}) : clôture impossible`);
      const empreinte = sha256(ecritures.map((e) => e.hash).join(""));
      this.db.run(
        "UPDATE exercices SET statut = 'cloture', cloture_at = ?, cloture_by = ?, empreinte_cloture = ? WHERE id = ?",
        new Date().toISOString(), userId, empreinte, ex.id,
      );

      const debutSuivant = addDays(ex.fin, 1);
      let suivant = this.db.get<ExerciceRow>("SELECT * FROM exercices WHERE dossier_id = ? AND debut = ?", dossierId, debutSuivant);
      if (!suivant) {
        const finSuivant = addDays(addYears(debutSuivant, 1), -1);
        const id = this.db.run("INSERT INTO exercices (dossier_id, debut, fin) VALUES (?, ?, ?)", dossierId, debutSuivant, finSuivant).lastInsertRowid;
        suivant = this.exercice(dossierId, id);
      }
      const an = computeANouveaux(ecritures, debutSuivant);
      if (an) {
        const anId = this.create(dossierId, an, userId);
        this.validate(dossierId, [anId], userId);
      }
      return { empreinte, nouvelExerciceId: suivant.id };
    });
  }

  /** Lignes du FEC d'un exercice, dans l'ordre chronologique de validation. */
  fecLignes(dossierId: number, exerciceId: number): FecLigne[] {
    const ex = this.exercice(dossierId, exerciceId);
    const libelle = this.libelleCompte(dossierId);
    const journaux = new Map(this.journaux(dossierId).map((j) => [j.code, j.libelle]));
    const tiers = new Map(
      this.db.all<{ compte_aux: string; nom: string }>("SELECT compte_aux, nom FROM tiers WHERE dossier_id = ?", dossierId).map((t) => [t.compte_aux, t.nom]),
    );
    const rows = this.db.all<EcritureRow>(
      "SELECT * FROM ecritures WHERE exercice_id = ? AND statut = 'validee' ORDER BY seq",
      ex.id,
    );
    const out: FecLigne[] = [];
    for (const e of this.hydrate(rows)) {
      for (const l of e.lignes) {
        out.push({
          journalCode: e.journal,
          journalLib: journaux.get(e.journal) ?? e.journal,
          ecritureNum: String(e.numero),
          ecritureDate: e.date,
          compteNum: l.compte,
          compteLib: libelle(l.compte),
          compAuxNum: l.compteAux ?? null,
          compAuxLib: l.compteAux ? (tiers.get(l.compteAux) ?? l.compteAux) : null,
          pieceRef: e.pieceRef,
          pieceDate: e.pieceDate,
          ecritureLib: l.libelle || e.libelle,
          debit: l.debit,
          credit: l.credit,
          ecritureLet: l.lettrage ?? null,
          dateLet: l.dateLettrage,
          validDate: e.validatedAt!.slice(0, 10),
        });
      }
    }
    return out;
  }
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addYears(iso: string, years: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

export function assertPeriod(debut?: string, fin?: string) {
  if (debut && fin && debut > fin) throw badRequest("Période invalide");
}
