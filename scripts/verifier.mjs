// Vérification de l'environnement avant le démarrage.
// Volontairement écrit en JavaScript simple pour fonctionner même sur une
// ancienne version de Node.js et afficher un message compréhensible.
import { existsSync } from "node:fs";

const [major, minor] = process.versions.node.split(".").map(Number);
const ok = major > 22 || (major === 22 && minor >= 13);

if (!ok) {
  console.error(`
❌ Version de Node.js trop ancienne : ${process.versions.node}
   Compta Écosystème nécessite Node.js 22.13 ou plus récent
   (la base de données intégrée node:sqlite n'existe pas avant).

   Pour corriger :
   1. Téléchargez la version « LTS » sur https://nodejs.org (bouton vert) et installez-la.
   2. Fermez puis rouvrez le Terminal.
   3. Vérifiez avec : node -v   (doit afficher v22.13 ou plus, ou v24…)
   4. Relancez : npm install  puis  npm run demarrer
`);
  process.exit(1);
}

if (!existsSync(new URL("../node_modules", import.meta.url))) {
  console.error(`
❌ Les dépendances ne sont pas installées.
   Lancez d'abord :  npm install
`);
  process.exit(1);
}

console.log(`✅ Node.js ${process.versions.node} — environnement correct.`);
