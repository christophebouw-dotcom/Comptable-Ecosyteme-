import type { AppConfig } from "./config.js";
import { Database } from "./db/index.js";
import { FieldCipher } from "./security/crypto.js";
import { AuditLog } from "./services/audit.js";
import { ComptaService } from "./services/compta.js";
import type { Role } from "./security/rbac.js";

export interface AppContext {
  config: AppConfig;
  db: Database;
  cipher: FieldCipher;
  audit: AuditLog;
  compta: ComptaService;
  /** Horloge injectable (tests). */
  now: () => Date;
}

export function createContext(config: AppConfig, db = new Database(config.databasePath)): AppContext {
  return {
    config,
    db,
    cipher: new FieldCipher(config.masterKey),
    audit: new AuditLog(db),
    compta: new ComptaService(db),
    now: () => new Date(),
  };
}

export interface SessionUser {
  id: number;
  email: string;
  nom: string;
  role: Role;
  totpEnabled: boolean;
  mfaOk: boolean;
}
