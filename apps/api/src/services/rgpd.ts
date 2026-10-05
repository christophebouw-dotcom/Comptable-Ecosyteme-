import {
  ANONYME,
  type DecisionEffacement,
  type DonneeDetenue,
  REGLES_CONSERVATION,
  addMonths,
  analyserEffacement,
} from "@compta/core";
import type { AppContext } from "../context.js";
import type { TiersRow } from "../routes/tiers.js";

/**
 * Service de conformité RGPD : recherche des données d'une personne (droit
 * d'accès et de portabilité), effacement articulé avec les obligations
 * légales, et purge automatique selon les durées de conservation.
 */
export class RgpdService {
  constructor(private readonly ctx: AppContext) {}

  private today() {
    return this.ctx.now().toISOString().slice(0, 10);
  }

  /** Tiers rattachés à une adresse e-mail (recherche par index aveugle). */
  tiersParEmail(email: string): TiersRow[] {
    const h = this.ctx.cipher.blindIndex(email);
    return this.ctx.db.all<TiersRow>("SELECT * FROM tiers WHERE email_hash = ?", h);
  }

  /**
   * Rassemble l'ensemble des données détenues sur une personne, dans un format
   * structuré et lisible par machine (art. 15 et 20).
   */
  exportPersonne(email: string) {
    const { db, cipher } = this.ctx;
    const h = cipher.blindIndex(email);
    const user = db.get<{ id: number; email: string; nom: string; role: string; created_at: string; last_login_at: string | null; totp_enabled: number }>(
      "SELECT id, email, nom, role, created_at, last_login_at, totp_enabled FROM users WHERE email = ? AND anonymized_at IS NULL",
      email,
    );
    const tiers = this.tiersParEmail(email).map((t) => {
      const dossier = db.get<{ raison_sociale: string }>("SELECT raison_sociale FROM dossiers WHERE id = ?", t.dossier_id);
      const factures = db.all<{ numero: string; date_emission: string; total_ttc: number; statut: string }>(
        "SELECT numero, date_emission, total_ttc, statut FROM factures WHERE tiers_id = ? AND statut <> 'brouillon' ORDER BY date_emission",
        t.id,
      );
      return {
        responsableTraitement: dossier?.raison_sociale,
        qualite: t.type,
        nom: t.nom,
        adresse: [t.adresse, t.code_postal, t.ville, t.pays].filter(Boolean).join(", "),
        email: cipher.decrypt(t.email_enc),
        telephone: cipher.decrypt(t.telephone_enc),
        iban: cipher.decrypt(t.iban_enc),
        siren: t.siren,
        limitationTraitement: !!t.restricted,
        factures: factures.map((f) => ({ ...f, total_ttc: f.total_ttc / 100 })),
      };
    });
    const consentements = db.all<{ finalite: string; accorde: number; source: string; texte_version: string; at: string }>(
      "SELECT finalite, accorde, source, texte_version, at FROM consentements WHERE email_hash = ? ORDER BY at",
      h!,
    );
    const connexions = user
      ? db.all<{ at: string; event: string; ip: string }>("SELECT at, event, ip FROM access_log WHERE user_id = ? ORDER BY at DESC LIMIT 500", user.id)
      : [];
    return {
      genereLe: this.ctx.now().toISOString(),
      personne: email,
      compteUtilisateur: user
        ? { nom: user.nom, email: user.email, role: user.role, creeLe: user.created_at, derniereConnexion: user.last_login_at, doubleAuthentification: !!user.totp_enabled }
        : null,
      fichesTiers: tiers,
      consentements: consentements.map((c) => ({ ...c, accorde: !!c.accorde })),
      journalConnexions: connexions,
      informations: {
        finalites: "Voir le registre des traitements (art. 30) communiqué sur demande.",
        durees: Object.values(REGLES_CONSERVATION).map((r) => `${r.libelle} : ${r.dureeMois / 12} an(s) — ${r.baseLegale}`),
        droits: "Accès, rectification, effacement, limitation, portabilité, opposition ; réclamation auprès de la CNIL.",
      },
    };
  }

  /** Inventaire des données d'une personne, par catégorie de conservation. */
  inventaire(email: string): (DonneeDetenue & { tiersId?: number })[] {
    const { db } = this.ctx;
    const out: (DonneeDetenue & { tiersId?: number })[] = [];
    const today = this.today();
    for (const t of this.tiersParEmail(email)) {
      const derniereFin = db.get<{ fin: string | null }>(
        `SELECT MAX(x.fin) AS fin FROM exercices x WHERE x.id IN (
           SELECT e.exercice_id FROM ecritures e JOIN ecriture_lignes l ON l.ecriture_id = e.id
           WHERE e.dossier_id = ? AND l.compte_aux = ?)`,
        t.dossier_id, t.compte_aux,
      )?.fin;
      const factureMax = db.get<{ d: string | null }>("SELECT MAX(date_emission) AS d FROM factures WHERE tiers_id = ? AND statut <> 'brouillon'", t.id)?.d;
      const depart = [derniereFin, factureMax ? `${factureMax.slice(0, 4)}-12-31` : null].filter(Boolean).sort().at(-1);
      if (depart) {
        out.push({ categorie: "pieces_comptables", description: `Écritures et factures (fiche tiers ${t.compte_aux}, nom et adresse)`, dateDepart: depart, tiersId: t.id });
      }
      out.push({
        categorie: "donnees_clients_commercial",
        description: `Coordonnées de contact et bancaires (fiche tiers ${t.compte_aux})`,
        dateDepart: t.fin_relation ?? today,
        tiersId: t.id,
      });
    }
    const h = this.ctx.cipher.blindIndex(email)!;
    const consent = db.get<{ at: string }>("SELECT MAX(at) AS at FROM consentements WHERE email_hash = ? AND accorde = 1", h);
    if (consent?.at) {
      out.push({ categorie: "donnees_prospects", description: "Inscription à la lettre d'information", dateDepart: consent.at.slice(0, 10), fondeSurConsentement: true });
    }
    if (db.get("SELECT 1 FROM users WHERE email = ? AND anonymized_at IS NULL", email)) {
      out.push({ categorie: "comptes_utilisateurs_inactifs", description: "Compte utilisateur de la plateforme", dateDepart: today });
    }
    return out;
  }

  analyserEffacement(email: string): DecisionEffacement[] {
    return analyserEffacement(this.inventaire(email), this.today());
  }

  /** Décisions associées à leur élément d'inventaire (analyserEffacement préserve l'ordre). */
  private decisionsDetaillees(email: string) {
    const inventaire = this.inventaire(email);
    const decisions = analyserEffacement(inventaire, this.today());
    return { decisions, lies: inventaire.map((item, i) => ({ item, decision: decisions[i]! })) };
  }

  /**
   * Exécute un effacement : les données sans obligation de conservation sont
   * supprimées ; les autres sont placées en limitation (art. 18).
   */
  executerEffacement(email: string): { decisions: DecisionEffacement[]; actions: string[] } {
    const { db } = this.ctx;
    const { decisions, lies } = this.decisionsDetaillees(email);
    const actions: string[] = [];
    const now = this.ctx.now().toISOString();
    db.transaction(() => {
      for (const t of this.tiersParEmail(email)) {
        const comptable = lies.some(
          ({ item, decision }) => item.tiersId === t.id && item.categorie === "pieces_comptables" && decision.decision === "conserver_limiter",
        );
        if (comptable) {
          db.run("UPDATE tiers SET email_enc = NULL, email_hash = NULL, telephone_enc = NULL, iban_enc = NULL, restricted = 1 WHERE id = ?", t.id);
          actions.push(`Tiers ${t.compte_aux} : coordonnées effacées, nom et adresse conservés en accès restreint (obligation comptable)`);
        } else {
          db.run(
            `UPDATE tiers SET nom = ?, adresse = NULL, code_postal = NULL, ville = NULL, siren = NULL, tva_intra = NULL, email_enc = NULL,
               email_hash = NULL, telephone_enc = NULL, iban_enc = NULL, restricted = 1, anonymized_at = ? WHERE id = ?`,
            ANONYME, now, t.id,
          );
          actions.push(`Tiers ${t.compte_aux} : anonymisé intégralement`);
        }
      }
      const h = this.ctx.cipher.blindIndex(email)!;
      const nbConsent = db.run("DELETE FROM consentements WHERE email_hash = ?", h).changes;
      if (nbConsent) actions.push(`${nbConsent} consentement(s) supprimé(s)`);
      const user = db.get<{ id: number; role: string }>("SELECT id, role FROM users WHERE email = ? AND anonymized_at IS NULL", email);
      if (user) {
        this.anonymiserUtilisateur(user.id);
        actions.push("Compte utilisateur désactivé et anonymisé");
      }
    });
    return { decisions, actions };
  }

  anonymiserUtilisateur(userId: number) {
    const { db } = this.ctx;
    db.run(
      "UPDATE users SET email = ?, nom = ?, password_hash = '!', totp_secret_enc = NULL, totp_enabled = 0, active = 0, anonymized_at = ? WHERE id = ?",
      `anonyme-${userId}@invalid.local`, ANONYME, this.ctx.now().toISOString(), userId,
    );
    db.run("DELETE FROM sessions WHERE user_id = ?", userId);
    db.run("DELETE FROM dossier_access WHERE user_id = ?", userId);
  }

  /**
   * Purge selon les durées de conservation. En mode simulation (dryRun), aucune
   * donnée n'est modifiée : le rapport liste ce qui serait purgé.
   */
  purger(dryRun: boolean) {
    const { db } = this.ctx;
    const now = this.ctx.now();
    const today = now.toISOString().slice(0, 10);
    const iso = (months: number) => `${addMonths(today, -months)}T00:00:00.000Z`;
    const rapport: { categorie: string; libelle: string; baseLegale: string; nombre: number; action: string }[] = [];
    const add = (cat: keyof typeof REGLES_CONSERVATION, nombre: number, action: string) => {
      const r = REGLES_CONSERVATION[cat];
      rapport.push({ categorie: cat, libelle: r.libelle, baseLegale: r.baseLegale, nombre, action });
    };

    db.transaction(() => {
      const logsLimit = iso(REGLES_CONSERVATION.logs_connexion.dureeMois);
      const nLogs = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM access_log WHERE at < ?", logsLimit)!.n;
      if (!dryRun) db.run("DELETE FROM access_log WHERE at < ?", logsLimit);
      add("logs_connexion", nLogs, "suppression");

      const nSessions = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM sessions WHERE expires_at < ?", now.toISOString())!.n;
      if (!dryRun) db.run("DELETE FROM sessions WHERE expires_at < ?", now.toISOString());
      rapport.push({ categorie: "sessions", libelle: "Sessions expirées", baseLegale: "RGPD art. 5.1.e", nombre: nSessions, action: "suppression" });

      const demLimit = addMonths(today, -REGLES_CONSERVATION.demandes_droits.dureeMois);
      const nDem = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM demandes_droits WHERE cloturee_le IS NOT NULL AND cloturee_le < ?", demLimit)!.n;
      if (!dryRun) db.run("DELETE FROM demandes_droits WHERE cloturee_le IS NOT NULL AND cloturee_le < ?", demLimit);
      add("demandes_droits", nDem, "suppression");

      // Tiers personnes physiques dont la relation est terminée depuis plus de 3 ans.
      const tiersLimit = addMonths(today, -REGLES_CONSERVATION.donnees_clients_commercial.dureeMois);
      const tiers = db.all<{ id: number }>(
        `SELECT id FROM tiers WHERE personne_physique = 1 AND anonymized_at IS NULL AND fin_relation IS NOT NULL AND fin_relation < ?
           AND (email_enc IS NOT NULL OR telephone_enc IS NOT NULL OR iban_enc IS NOT NULL)`,
        tiersLimit,
      );
      if (!dryRun) {
        for (const t of tiers) db.run("UPDATE tiers SET email_enc = NULL, email_hash = NULL, telephone_enc = NULL, iban_enc = NULL WHERE id = ?", t.id);
      }
      add("donnees_clients_commercial", tiers.length, "anonymisation des coordonnées");

      // Comptes utilisateurs inactifs depuis 2 ans (hors administrateurs).
      const userLimit = iso(REGLES_CONSERVATION.comptes_utilisateurs_inactifs.dureeMois);
      const users = db.all<{ id: number }>(
        "SELECT id FROM users WHERE anonymized_at IS NULL AND role <> 'admin' AND COALESCE(last_login_at, created_at) < ?",
        userLimit,
      );
      if (!dryRun) for (const u of users) this.anonymiserUtilisateur(u.id);
      add("comptes_utilisateurs_inactifs", users.length, "désactivation et anonymisation");

      // Journal d'audit au-delà de 10 ans.
      const auditLimit = iso(REGLES_CONSERVATION.logs_audit.dureeMois);
      const nAudit = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE at < ?", auditLimit)!.n;
      if (!dryRun) db.run("DELETE FROM audit_log WHERE at < ?", auditLimit);
      add("logs_audit", nAudit, "suppression");

      // Exercices clôturés depuis plus de 10 ans : signalés pour archivage/destruction contrôlée.
      const exLimit = addMonths(today, -REGLES_CONSERVATION.livres_comptables.dureeMois);
      const nEx = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM exercices WHERE statut = 'cloture' AND fin < ?", exLimit)!.n;
      add("livres_comptables", nEx, "à détruire après export d'archive (action manuelle de l'expert-comptable)");
    });
    return { dryRun, executeLe: now.toISOString(), rapport };
  }
}
