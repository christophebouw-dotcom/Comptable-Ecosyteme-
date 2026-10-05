// Démarrage en une commande : vérifie l'environnement, crée la base de
// démonstration si nécessaire, puis lance l'API et l'interface.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const racine = fileURLToPath(new URL("..", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (args, env = {}) => spawnSync(npm, args, { cwd: racine, stdio: "inherit", env: { ...process.env, ...env } }).status === 0;

if (!existsSync(new URL("../apps/api/data/compta.db", import.meta.url))) {
  console.log("\n📦 Première utilisation : création de la base de démonstration…");
  if (!run(["run", "seed"])) process.exit(1);
} else {
  // Sauvegarde chiffrée automatique, au plus une fois toutes les 12 heures (conservée 30 jours).
  const dossier = join(racine, "sauvegardes");
  const recente = existsSync(dossier) && readdirSync(dossier).some((f) => f.endsWith(".db.enc") && Date.now() - statSync(join(dossier, f)).mtimeMs < 12 * 3_600_000);
  if (!recente) {
    console.log("\n💾 Sauvegarde de vos données…");
    if (!run(["run", "sauvegarde", "--silent"], { BACKUP_DIR: dossier })) console.warn("⚠️  Sauvegarde impossible (voir ci-dessus) : le démarrage continue.");
  }
}

console.log(`
🚀 Démarrage de Compta Écosystème…
   Ouvrez http://localhost:5173 dans votre navigateur dans quelques secondes.
   Identifiant : expert@cabinet.fr   Mot de passe : Demo-Compta-2026!
   (Laissez cette fenêtre ouverte ; Ctrl+C pour arrêter.)
`);
const opts = { cwd: racine, stdio: "inherit" };
const api = spawn(npm, ["run", "dev", "--workspace", "@compta/api"], opts);
const web = spawn(npm, ["run", "dev", "--workspace", "@compta/web"], opts);
const stop = () => { api.kill(); web.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of [api, web]) p.on("exit", (code) => { if (code) { console.error("\n❌ Un des services s'est arrêté (voir le message ci-dessus)."); stop(); } });
