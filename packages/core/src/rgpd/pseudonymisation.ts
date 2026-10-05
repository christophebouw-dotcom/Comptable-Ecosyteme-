/**
 * Minimisation et pseudonymisation (RGPD art. 4.5, 5.1.c, 25 et 32.1.a).
 * Fonctions pures, utilisables côté navigateur comme côté serveur.
 */

export function masquerEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

export function masquerTelephone(tel: string): string {
  const digits = tel.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `${"*".repeat(digits.length - 2)}${digits.slice(-2)}`.replace(/(.{2})(?=.)/g, "$1 ");
}

export function masquerNom(nom: string): string {
  return nom
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => `${p[0]}.`)
    .join(" ");
}

/** Valeur de remplacement utilisée lors de l'anonymisation d'un enregistrement. */
export const ANONYME = "[anonymisé]";

/**
 * Produit une copie d'un objet où les champs listés sont remplacés par une
 * valeur neutre. Les champs non listés sont conservés à l'identique.
 */
export function anonymiserChamps<T extends Record<string, unknown>>(obj: T, champs: (keyof T)[]): T {
  const copy = { ...obj };
  for (const c of champs) {
    if (copy[c] !== undefined && copy[c] !== null) (copy as Record<string, unknown>)[c as string] = ANONYME;
  }
  return copy;
}
