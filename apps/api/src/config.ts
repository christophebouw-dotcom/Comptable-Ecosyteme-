import { randomBytes } from "node:crypto";

export interface AppConfig {
  env: "development" | "production" | "test";
  port: number;
  host: string;
  /** Chemin du fichier SQLite, ou « :memory: ». */
  databasePath: string;
  /** Clé maîtresse de 32 octets (base64) dont dérivent les clés de chiffrement et d'indexation. */
  masterKey: Buffer;
  /** Origine publique de l'application (contrôle CSRF). */
  publicOrigin: string;
  /** Durée d'inactivité maximale d'une session, en minutes. */
  sessionIdleMinutes: number;
  /** Durée de vie absolue d'une session, en heures. */
  sessionMaxHours: number;
  /** Répertoire du front-end compilé à servir (production). */
  webDist?: string;
  logLevel: string;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const env = (process.env.NODE_ENV as AppConfig["env"]) ?? "development";
  let masterKey: Buffer;
  if (process.env.APP_MASTER_KEY) {
    masterKey = Buffer.from(process.env.APP_MASTER_KEY, "base64");
    if (masterKey.length !== 32) throw new Error("APP_MASTER_KEY doit encoder exactement 32 octets en base64");
  } else if (env === "production") {
    throw new Error("APP_MASTER_KEY est obligatoire en production (générez-la avec : openssl rand -base64 32)");
  } else {
    masterKey = overrides.masterKey ?? randomBytes(32);
    if (env === "development" && !overrides.masterKey) {
      console.warn("⚠️  APP_MASTER_KEY absente : clé éphémère générée. Les données chiffrées seront illisibles au redémarrage.");
    }
  }
  return {
    env,
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? "127.0.0.1",
    databasePath: process.env.DATABASE_PATH ?? "data/compta.db",
    masterKey,
    publicOrigin: process.env.PUBLIC_ORIGIN ?? "http://localhost:5173",
    sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES ?? 30),
    sessionMaxHours: Number(process.env.SESSION_MAX_HOURS ?? 12),
    webDist: process.env.WEB_DIST,
    logLevel: process.env.LOG_LEVEL ?? (env === "test" ? "silent" : "info"),
    ...overrides,
  };
}
