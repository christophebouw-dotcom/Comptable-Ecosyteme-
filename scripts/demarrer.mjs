// Démarrage en une commande : vérifie l'environnement, crée la base de
// démonstration si nécessaire, puis lance l'API et l'interface.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const racine = fileURLToPath(new URL("..", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (args) => spawnSync(npm, args, { cwd: racine, stdio: "inherit" }).status === 0;

if (!existsSync(new URL("../apps/api/data/compta.db", import.meta.url))) {
  console.log("\n📦 Première utilisation : création de la base de démonstration…");
  if (!run(["run", "seed"])) process.exit(1);
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
