/**
 * Mots de passe à usage unique basés sur le temps (TOTP, RFC 6238), compatibles
 * avec les applications d'authentification usuelles (FreeOTP, Aegis, Google
 * Authenticator…). Second facteur recommandé par la CNIL et l'ANSSI pour les
 * accès à des données financières.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error("Caractère base32 invalide");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: string, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, "0");
}

export function totp(secret: string, timeMs = Date.now(), step = 30): string {
  return hotp(secret, Math.floor(timeMs / 1000 / step));
}

/** Vérifie un code en tolérant une dérive d'horloge de ± 1 pas (30 s). */
export function verifyTotp(secret: string, code: string, timeMs = Date.now(), window = 1): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(timeMs / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    const expected = Buffer.from(hotp(secret, counter + w));
    if (timingSafeEqual(expected, Buffer.from(code))) return true;
  }
  return false;
}

export function otpauthUri(secret: string, account: string, issuer = "Compta Écosystème"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
