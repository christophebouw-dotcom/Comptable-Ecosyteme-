/**
 * Primitives cryptographiques (RGPD art. 32.1.a — chiffrement et pseudonymisation).
 *
 *  - Chiffrement des champs sensibles : AES-256-GCM (authentifié), IV aléatoire
 *    de 96 bits, format versionné « v1.<iv>.<tag>.<ciphertext> » en base64url.
 *  - Index aveugle (blind index) : HMAC-SHA-256 pour rechercher une valeur
 *    chiffrée (ex. e-mail) sans la stocker en clair.
 *  - Mots de passe : scrypt (N=2^15, r=8, p=1), sel de 16 octets, comparaison
 *    en temps constant.
 *  - Jetons de session : 256 bits aléatoires, seul leur empreinte SHA-256 est stockée.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pwd: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

export class FieldCipher {
  private readonly encKey: Buffer;
  private readonly hmacKey: Buffer;

  constructor(masterKey: Buffer) {
    this.encKey = Buffer.from(hkdfSync("sha256", masterKey, Buffer.alloc(0), "compta/field-encryption/v1", 32));
    this.hmacKey = Buffer.from(hkdfSync("sha256", masterKey, Buffer.alloc(0), "compta/blind-index/v1", 32));
  }

  encrypt(plaintext: string): string;
  encrypt(plaintext: string | null | undefined): string | null;
  encrypt(plaintext: string | null | undefined): string | null {
    if (plaintext == null || plaintext === "") return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encKey, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
  }

  decrypt(payload: string | null | undefined): string | null {
    if (!payload) return null;
    const [version, iv, tag, ct] = payload.split(".");
    if (version !== "v1" || !iv || !tag || ct === undefined) throw new Error("Format de donnée chiffrée inconnu");
    const decipher = createDecipheriv("aes-256-gcm", this.encKey, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
  }

  /** Index aveugle normalisé (insensible à la casse et aux espaces). */
  blindIndex(value: string | null | undefined): string | null {
    if (!value) return null;
    return createHmac("sha256", this.hmacKey).update(value.trim().toLowerCase()).digest("hex");
  }
}

export function sha256(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, 64, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT_PARAMS.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Sérialisation JSON canonique (clés triées) pour le calcul d'empreintes stables. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}
