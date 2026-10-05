// Prépare la configuration d'un serveur de production : npm run configurer -- compta.mon-cabinet.fr
// Génère le fichier .env (clé maîtresse aléatoire, origine HTTPS, sauvegardes) sans jamais écraser l'existant.
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const domaine = (process.argv[2] ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
if (!/^(localhost|([a-z0-9-]+\.)+[a-z]{2,})$/.test(domaine)) {
  console.error("Usage : npm run configurer -- compta.mon-cabinet.fr\n(nom de domaine pointant vers ce serveur, sans https://)");
  process.exit(1);
}
const fichier = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(fichier)) {
  console.error("❌ Un fichier .env existe déjà : il n'est pas écrasé (la clé maîtresse qu'il contient protège vos données).");
  process.exit(1);
}
const cle = randomBytes(32).toString("base64");
writeFileSync(
  fichier,
  `# Configuration de production générée le ${new Date().toISOString().slice(0, 10)}
DOMAINE=${domaine}
PUBLIC_ORIGIN=https://${domaine}
NODE_ENV=production

# Clé maîtresse : chiffre les données sensibles ET les sauvegardes.
# ⚠️  Copiez-la MAINTENANT dans un coffre-fort (gestionnaire de mots de passe du cabinet) :
#     sans elle, ni la base ni les sauvegardes ne peuvent être relues.
APP_MASTER_KEY=${cle}

SESSION_IDLE_MINUTES=30
SESSION_MAX_HOURS=12
LOG_LEVEL=info
BACKUP_RETENTION_DAYS=30

# Lecture des pièces par IA (facultatif) : renseignez votre clé Anthropic.
# ANTHROPIC_API_KEY=
`,
  { mode: 0o600 },
);
console.log(`✅ Fichier .env créé pour https://${domaine}

Clé maîtresse (à conserver dans un coffre-fort, hors du serveur) :

    ${cle}

Étapes suivantes :
  docker compose up -d --build
  docker compose exec app npm run initialiser -- --email vous@cabinet.fr --nom "Prénom Nom"
`);
