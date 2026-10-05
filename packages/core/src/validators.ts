/**
 * Validation des identifiants légaux et bancaires français et européens.
 */

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

const ok: ValidationResult = { valid: true };
const ko = (reason: string): ValidationResult => ({ valid: false, reason });

export function stripSpaces(value: string): string {
  return value.replace(/[\s .-]/g, "").toUpperCase();
}

/** Algorithme de Luhn (clé de contrôle des SIREN/SIRET). */
export function luhn(digits: string): boolean {
  let total = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    total += d;
  }
  return total % 10 === 0;
}

/** SIREN de La Poste : ses SIRET ne respectent pas Luhn (règle spécifique INSEE). */
const SIREN_LA_POSTE = "356000000";

/** Valide un numéro SIREN (9 chiffres, clé de Luhn). */
export function validateSiren(input: string): ValidationResult {
  const v = stripSpaces(input);
  if (!/^\d{9}$/.test(v)) return ko("Le SIREN doit comporter 9 chiffres");
  if (v === SIREN_LA_POSTE) return ok;
  return luhn(v) ? ok : ko("Clé de contrôle du SIREN invalide");
}

/** Valide un numéro SIRET (14 chiffres = SIREN + NIC, clé de Luhn). */
export function validateSiret(input: string): ValidationResult {
  const v = stripSpaces(input);
  if (!/^\d{14}$/.test(v)) return ko("Le SIRET doit comporter 14 chiffres");
  if (v.startsWith(SIREN_LA_POSTE)) {
    const digitSum = [...v].reduce((a, c) => a + Number(c), 0);
    return digitSum % 5 === 0 ? ok : ko("Clé de contrôle du SIRET (La Poste) invalide");
  }
  const siren = validateSiren(v.slice(0, 9));
  if (!siren.valid) return siren;
  return luhn(v) ? ok : ko("Clé de contrôle du SIRET invalide");
}

/** Calcule le numéro de TVA intracommunautaire français à partir du SIREN. */
export function frenchVatNumber(siren: string): string {
  const v = stripSpaces(siren);
  const check = validateSiren(v);
  if (!check.valid) throw new Error(check.reason);
  const key = (12 + 3 * (Number(v) % 97)) % 97;
  return `FR${String(key).padStart(2, "0")}${v}`;
}

/** Formats des numéros de TVA intracommunautaires des États membres de l'UE. */
const EU_VAT_FORMATS: Record<string, RegExp> = {
  AT: /^ATU\d{8}$/,
  BE: /^BE[01]\d{9}$/,
  BG: /^BG\d{9,10}$/,
  CY: /^CY\d{8}[A-Z]$/,
  CZ: /^CZ\d{8,10}$/,
  DE: /^DE\d{9}$/,
  DK: /^DK\d{8}$/,
  EE: /^EE\d{9}$/,
  EL: /^EL\d{9}$/,
  ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^FI\d{8}$/,
  FR: /^FR[A-HJ-NP-Z0-9]{2}\d{9}$/,
  HR: /^HR\d{11}$/,
  HU: /^HU\d{8}$/,
  IE: /^IE\d[A-Z0-9+*]\d{5}[A-Z]{1,2}$/,
  IT: /^IT\d{11}$/,
  LT: /^LT(\d{9}|\d{12})$/,
  LU: /^LU\d{8}$/,
  LV: /^LV\d{11}$/,
  MT: /^MT\d{8}$/,
  NL: /^NL\d{9}B\d{2}$/,
  PL: /^PL\d{10}$/,
  PT: /^PT\d{9}$/,
  RO: /^RO\d{2,10}$/,
  SE: /^SE\d{12}$/,
  SI: /^SI\d{8}$/,
  SK: /^SK\d{10}$/,
  XI: /^XI(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
};

/**
 * Valide un numéro de TVA intracommunautaire. Pour la France, la clé est
 * recalculée à partir du SIREN. Pour les autres pays, seul le format est
 * contrôlé (la vérification d'existence se fait via le service VIES).
 */
export function validateVatNumber(input: string): ValidationResult {
  const v = stripSpaces(input);
  const country = v.slice(0, 2);
  const format = EU_VAT_FORMATS[country];
  if (!format) return ko(`Préfixe pays de TVA inconnu : ${country}`);
  if (!format.test(v)) return ko(`Format de numéro de TVA invalide pour ${country}`);
  if (country === "FR" && /^\d{2}$/.test(v.slice(2, 4))) {
    const siren = v.slice(4);
    const sirenCheck = validateSiren(siren);
    if (!sirenCheck.valid) return sirenCheck;
    if (frenchVatNumber(siren) !== v) return ko("Clé du numéro de TVA français invalide");
  }
  return ok;
}

/** Longueur des IBAN par pays (registre SWIFT, sélection SEPA). */
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18,
  EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GI: 23, GR: 27, HR: 21, HU: 28,
  IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31,
  NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27,
  VA: 22,
};

/** Calcule (chaîne numérique) mod 97 par blocs, sans dépasser la précision. */
function mod97(numeric: string): number {
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    remainder = Number(String(remainder) + numeric.slice(i, i + 7)) % 97;
  }
  return remainder;
}

/** Valide un IBAN (longueur par pays + clé ISO 7064 mod 97-10). */
export function validateIban(input: string): ValidationResult {
  const v = stripSpaces(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(v)) return ko("Format d'IBAN invalide");
  const country = v.slice(0, 2);
  const expected = IBAN_LENGTHS[country];
  if (!expected) return ko(`Pays d'IBAN non pris en charge : ${country}`);
  if (v.length !== expected) return ko(`Un IBAN ${country} doit comporter ${expected} caractères`);
  const rearranged = v.slice(4) + v.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return mod97(numeric) === 1 ? ok : ko("Clé de contrôle de l'IBAN invalide");
}

/** Formate un IBAN par groupes de 4 caractères. */
export function formatIban(input: string): string {
  return stripSpaces(input).replace(/(.{4})/g, "$1 ").trim();
}

/** Masque un IBAN pour l'affichage (minimisation des données, art. 5.1.c RGPD). */
export function maskIban(input: string): string {
  const v = stripSpaces(input);
  if (v.length < 8) return "****";
  return formatIban(v.slice(0, 4) + "*".repeat(v.length - 8) + v.slice(-4));
}

/** Valide un code BIC/SWIFT (8 ou 11 caractères). */
export function validateBic(input: string): ValidationResult {
  const v = stripSpaces(input);
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v) ? ok : ko("Format de BIC invalide");
}

export function validateEmail(input: string): ValidationResult {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.trim()) ? ok : ko("Adresse e-mail invalide");
}
