/**
 * Politique de mots de passe conforme à la recommandation de la CNIL
 * (délibération n° 2022-100 du 21 juillet 2022) : en l'absence d'autre mesure,
 * une entropie d'au moins 80 bits, soit 12 caractères mêlant majuscules,
 * minuscules, chiffres et caractères spéciaux. Le verrouillage temporaire
 * après échecs répétés est assuré par le module d'authentification.
 */

const COMMON = new Set([
  "motdepasse123!", "password123!", "azerty123456", "azertyuiop12", "123456789012", "bonjour12345!", "comptabilite1!",
  "soleil123456", "qwertyuiop12",
]);

export interface PasswordCheck {
  ok: boolean;
  errors: string[];
}

export function checkPassword(password: string, context: { email?: string; nom?: string } = {}): PasswordCheck {
  const errors: string[] = [];
  if (password.length < 12) errors.push("Au moins 12 caractères");
  if (password.length > 256) errors.push("Au plus 256 caractères");
  if (!/[a-z]/.test(password)) errors.push("Au moins une minuscule");
  if (!/[A-Z]/.test(password)) errors.push("Au moins une majuscule");
  if (!/\d/.test(password)) errors.push("Au moins un chiffre");
  if (!/[^A-Za-z0-9]/.test(password)) errors.push("Au moins un caractère spécial");
  if (/(.)\1{3,}/.test(password)) errors.push("Pas plus de 3 caractères identiques consécutifs");
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) errors.push("Mot de passe trop courant");
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) errors.push("Ne doit pas contenir votre identifiant");
  const nom = context.nom?.toLowerCase().split(/\s+/).find((p) => p.length >= 4 && lower.includes(p));
  if (nom) errors.push("Ne doit pas contenir votre nom");
  return { ok: errors.length === 0, errors };
}
