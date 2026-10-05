/**
 * Sauvegardes chiffrées de la base (RGPD art. 32.1.c : capacité à rétablir la
 * disponibilité des données ; art. 32.1.a : chiffrement).
 *
 * La copie est cohérente (VACUUM INTO, sans interrompre l'application), puis
 * chiffrée en AES-256-GCM par flux avec une clé dérivée de la clé maîtresse :
 * une sauvegarde volée est inexploitable sans APP_MASTER_KEY. Les fichiers
 * peuvent donc être copiés hors site (stockage objet européen, NAS…).
 *
 * Format : « CESAUV01 » (8 octets) | IV (12) | données chiffrées | tag GCM (16).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, linkSync, mkdirSync, openSync, readSync, closeSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";
import type { Database } from "../db/index.js";

const MAGIC = Buffer.from("CESAUV01");
const TAG = 16;
const PREFIXE = "compta-";
const SUFFIXE = ".db.enc";

function cle(masterKey: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey, Buffer.alloc(0), "compta/sauvegarde/v1", 32));
}

const horodatage = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

export interface ResultatSauvegarde {
  fichier: string;
  taille: number;
  supprimees: string[];
}

/** Crée une sauvegarde chiffrée et applique la rotation (conservation en jours). */
export async function sauvegarder(db: Database, masterKey: Buffer, dossier: string, retentionJours = 30, now = new Date()): Promise<ResultatSauvegarde> {
  mkdirSync(dossier, { recursive: true, mode: 0o700 });
  // Noms uniques : deux sauvegardes simultanées (automatique et manuelle) ne se gênent pas.
  const unique = randomBytes(4).toString("hex");
  const base = join(dossier, `${PREFIXE}${horodatage(now)}`);
  const copie = `${base}-${unique}.tmp.db`;
  const partiel = `${base}-${unique}.partiel`;
  let cible = `${base}${SUFFIXE}`;
  db.raw.exec(`VACUUM INTO '${copie.replaceAll("'", "''")}'`);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", cle(masterKey), iv);
    const sortie = createWriteStream(partiel, { mode: 0o600 });
    sortie.write(Buffer.concat([MAGIC, iv]));
    await pipeline(createReadStream(copie), cipher, sortie, { end: false });
    await new Promise<void>((resolve, reject) => sortie.end(cipher.getAuthTag(), (err?: Error | null) => (err ? reject(err) : resolve())));
    // Publication atomique sans écrasement (linkSync échoue si le nom est déjà pris).
    try {
      linkSync(partiel, cible);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      cible = `${base}-${unique}${SUFFIXE}`;
      linkSync(partiel, cible);
    }
  } finally {
    rmSync(copie, { force: true });
    rmSync(partiel, { force: true });
  }
  const limite = now.getTime() - retentionJours * 86_400_000;
  const supprimees = listerSauvegardes(dossier)
    .filter((s) => s.date.getTime() < limite && s.fichier !== cible)
    .map((s) => (rmSync(s.fichier), s.fichier));
  return { fichier: cible, taille: statSync(cible).size, supprimees };
}

export function listerSauvegardes(dossier: string): { fichier: string; date: Date; taille: number }[] {
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier)
    .filter((f) => f.startsWith(PREFIXE) && f.endsWith(SUFFIXE))
    .map((f) => {
      const m = /^compta-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(f);
      const date = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`) : statSync(join(dossier, f)).mtime;
      return { fichier: join(dossier, f), date, taille: statSync(join(dossier, f)).size };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Déchiffre une sauvegarde vers `destination` et vérifie l'intégrité de la base
 * obtenue. Le tag GCM garantit qu'elle n'a été ni altérée ni tronquée.
 */
export async function restaurer(fichier: string, masterKey: Buffer, destination: string): Promise<{ tables: number; integrite: string }> {
  const taille = statSync(fichier).size;
  if (taille < MAGIC.length + 12 + TAG) throw new Error("Fichier de sauvegarde trop court");
  const fd = openSync(fichier, "r");
  const entete = Buffer.alloc(MAGIC.length + 12);
  const tag = Buffer.alloc(TAG);
  readSync(fd, entete, 0, entete.length, 0);
  readSync(fd, tag, 0, TAG, taille - TAG);
  closeSync(fd);
  if (!entete.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Ce fichier n'est pas une sauvegarde Compta Écosystème");
  const decipher = createDecipheriv("aes-256-gcm", cle(masterKey), entete.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  const temporaire = `${destination}.restauration`;
  rmSync(temporaire, { force: true });
  try {
    await pipeline(
      createReadStream(fichier, { start: entete.length, end: taille - TAG - 1 }),
      decipher,
      createWriteStream(temporaire, { mode: 0o600 }),
    );
  } catch (err) {
    rmSync(temporaire, { force: true });
    throw new Error(
      (err as Error).message.includes("authenticate")
        ? "Déchiffrement impossible : clé maîtresse différente ou fichier altéré"
        : `Restauration impossible : ${(err as Error).message}`,
    );
  }
  const verif = new DatabaseSync(temporaire);
  const integrite = (verif.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
  const tables = (verif.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n;
  verif.close();
  if (integrite !== "ok") {
    rmSync(temporaire, { force: true });
    throw new Error(`Base restaurée corrompue : ${integrite}`);
  }
  for (const suffixe of ["-wal", "-shm"]) rmSync(`${destination}${suffixe}`, { force: true });
  renameSync(temporaire, destination);
  return { tables, integrite };
}
