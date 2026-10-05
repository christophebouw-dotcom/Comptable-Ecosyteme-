import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { MIGRATIONS } from "./schema.js";

export type Row = Record<string, SQLInputValue>;

/**
 * Accès à SQLite via le module natif de Node (node:sqlite). Mode WAL, clés
 * étrangères activées, migrations versionnées et transactions imbriquables.
 */
export class Database {
  readonly raw: DatabaseSync;
  private depth = 0;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA foreign_keys = ON;");
    this.raw.exec("PRAGMA busy_timeout = 5000;");
    if (path !== ":memory:") this.raw.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate() {
    this.raw.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)",
    );
    const applied = new Set(
      (this.raw.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version),
    );
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue;
      this.transaction(() => {
        this.raw.exec(m.sql);
        this.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)", m.version, m.name, new Date().toISOString());
      });
    }
  }

  get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  run(sql: string, ...params: SQLInputValue[]): { changes: number; lastInsertRowid: number } {
    const r = this.raw.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  /** Exécute fn dans une transaction (SAVEPOINT si déjà dans une transaction). */
  transaction<T>(fn: () => T): T {
    const sp = `sp_${this.depth}`;
    this.raw.exec(this.depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${sp}`);
    this.depth++;
    try {
      const result = fn();
      this.depth--;
      this.raw.exec(this.depth === 0 ? "COMMIT" : `RELEASE ${sp}`);
      return result;
    } catch (err) {
      this.depth--;
      this.raw.exec(this.depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw err;
    }
  }

  close() {
    this.raw.close();
  }
}
