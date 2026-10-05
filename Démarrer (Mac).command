#!/bin/bash
# Double-cliquez sur ce fichier dans le Finder pour lancer Compta Écosystème.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js n'est pas installé. Téléchargez la version LTS sur https://nodejs.org puis relancez ce fichier."
  read -r -p "Appuyez sur Entrée pour fermer…"; exit 1
fi
node scripts/verifier.mjs 2>/dev/null || [ -d node_modules ] || { echo "📦 Installation des dépendances (une seule fois)…"; npm install || { read -r -p "Échec de l'installation. Entrée pour fermer…"; exit 1; }; }
node scripts/verifier.mjs || { read -r -p "Appuyez sur Entrée pour fermer…"; exit 1; }
( sleep 6; open "http://localhost:5173" ) &
npm run demarrer
