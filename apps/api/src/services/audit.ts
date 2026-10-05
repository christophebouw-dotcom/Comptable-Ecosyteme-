/**
 * Journal d'audit chaîné.
 *
 * Chaque événement contient l'empreinte SHA-256 de l'événement précédent : toute
 * altération, suppression ou insertion a posteriori rompt la chaîne et est
 * détectée par verifyChain(). Ce mécanisme contribue à la « piste d'audit
 * fiable » (BOI-CF-IOR-60-40-10) et à la traçabilité exigée par l'art. 32 RGPD.
 */
import type { Database } from "../db/index.js";
import { canonicalJson, sha256 } from "../security/crypto.js";

export const GENESIS_HASH = "0".repeat(64);

export interface AuditEvent {
  userId?: number | null;
  userEmail?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | number | null;
  dossierId?: number | null;
  ip?: string | null;
  details?: Record<string, unknown> | null;
}

interface AuditRow {
  id: number;
  at: string;
  user_id: number | null;
  user_email: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  dossier_id: number | null;
  ip: string | null;
  details: string | null;
  prev_hash: string;
  hash: string;
}

function computeHash(prevHash: string, r: Omit<AuditRow, "id" | "hash" | "prev_hash">): string {
  return sha256(
    prevHash +
      canonicalJson({
        at: r.at,
        user_id: r.user_id,
        user_email: r.user_email,
        action: r.action,
        entity: r.entity,
        entity_id: r.entity_id,
        dossier_id: r.dossier_id,
        ip: r.ip,
        details: r.details,
      }),
  );
}

export class AuditLog {
  constructor(private readonly db: Database) {}

  record(e: AuditEvent): void {
    this.db.transaction(() => {
      const last = this.db.get<{ hash: string }>("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1");
      const prevHash = last?.hash ?? GENESIS_HASH;
      const row = {
        at: new Date().toISOString(),
        user_id: e.userId ?? null,
        user_email: e.userEmail ?? null,
        action: e.action,
        entity: e.entity ?? null,
        entity_id: e.entityId != null ? String(e.entityId) : null,
        dossier_id: e.dossierId ?? null,
        ip: e.ip ?? null,
        details: e.details ? JSON.stringify(e.details) : null,
      };
      const hash = computeHash(prevHash, row);
      this.db.run(
        `INSERT INTO audit_log (at, user_id, user_email, action, entity, entity_id, dossier_id, ip, details, prev_hash, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.at, row.user_id, row.user_email, row.action, row.entity, row.entity_id, row.dossier_id, row.ip, row.details,
        prevHash, hash,
      );
    });
  }

  list(filter: { dossierId?: number; action?: string; limit?: number; beforeId?: number } = {}) {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.dossierId) {
      where.push("dossier_id = ?");
      params.push(filter.dossierId);
    }
    if (filter.action) {
      where.push("action LIKE ?");
      params.push(`${filter.action}%`);
    }
    if (filter.beforeId) {
      where.push("id < ?");
      params.push(filter.beforeId);
    }
    const sql = `SELECT * FROM audit_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`;
    return this.db
      .all<AuditRow>(sql, ...params, Math.min(filter.limit ?? 100, 500))
      .map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
  }

  /**
   * Vérifie l'intégrité de toute la chaîne. Le premier maillon restant sert
   * d'ancre (les événements de plus de 10 ans peuvent avoir été purgés).
   */
  verifyChain(): { ok: boolean; count: number; brokenAt?: number; lastHash?: string } {
    const rows = this.db.all<AuditRow>("SELECT * FROM audit_log ORDER BY id ASC");
    let prev = rows[0]?.prev_hash ?? GENESIS_HASH;
    for (const r of rows) {
      if (r.prev_hash !== prev || computeHash(r.prev_hash, r) !== r.hash) {
        return { ok: false, count: rows.length, brokenAt: r.id };
      }
      prev = r.hash;
    }
    return { ok: true, count: rows.length, lastHash: rows.at(-1)?.hash };
  }
}
