/**
 * Montants monétaires.
 *
 * Tous les montants sont manipulés en CENTIMES ENTIERS pour éviter les erreurs
 * d'arrondi des nombres flottants (0.1 + 0.2 !== 0.3). Un montant de 12,34 €
 * est représenté par l'entier 1234.
 */

export type Cents = number;

export class MoneyError extends Error {
  override name = "MoneyError";
}

export function assertCents(value: number, label = "montant"): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} doit être un nombre entier de centimes (reçu : ${value})`);
  }
}

/** Convertit des euros (nombre ou chaîne « 1 234,56 ») en centimes. */
export function toCents(input: number | string): Cents {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new MoneyError(`Montant invalide : ${input}`);
    return Math.round(input * 100);
  }
  const normalized = input
    .trim()
    .replace(/[\s  €]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new MoneyError(`Montant invalide : « ${input} »`);
  }
  const negative = normalized.startsWith("-");
  const [intPart, decPart = ""] = normalized.replace("-", "").split(".");
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, "0"));
  return negative ? -cents : cents;
}

/** Convertit des centimes en euros (nombre flottant, pour affichage uniquement). */
export function toEuros(cents: Cents): number {
  return cents / 100;
}

const eurFormatter = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

/** Formate des centimes au format français : « 1 234,56 € ». */
export function formatEUR(cents: Cents): string {
  return eurFormatter.format(cents / 100);
}

/**
 * Formate un montant avec une virgule décimale et sans séparateur de milliers,
 * format attendu par le FEC (ex. « 1234,56 »).
 */
export function formatDecimalComma(cents: Cents): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const s = `${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
  return negative ? `-${s}` : s;
}

/**
 * Applique un taux exprimé en points de base (1 % = 100 pb) à un montant,
 * avec arrondi commercial au centime (half away from zero).
 * Ex. : TVA 20 % → applyRate(10000, 2000) === 2000.
 */
export function applyRate(amount: Cents, rateBp: number): Cents {
  const raw = (amount * rateBp) / 10000;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

/**
 * Répartit un montant en parts proportionnelles aux poids donnés, sans perte
 * de centime (méthode du plus fort reste). La somme des parts est exactement
 * égale au montant initial.
 */
export function allocate(amount: Cents, weights: number[]): Cents[] {
  assertCents(amount);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) throw new MoneyError("La somme des poids doit être positive");
  const raw = weights.map((w) => (amount * w) / total);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = amount - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; remainder > 0; k = (k + 1) % order.length, remainder--) {
    floored[order[k]!.i]! += 1;
  }
  return floored;
}

export function sum(values: Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0);
}
