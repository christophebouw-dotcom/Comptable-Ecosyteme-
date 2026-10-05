#!/bin/bash
# Double-cliquez sur ce fichier dans le Finder pour lancer Compta Écosystème.
# (Première fois : clic droit sur le fichier → Ouvrir → Ouvrir.)
cd "$(dirname "$0")" || exit 1
pause() { read -r -p "Appuyez sur Entrée pour fermer cette fenêtre…"; }

echo "📁 Dossier : $(pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js n'est pas installé. Téléchargez la version LTS sur https://nodejs.org puis relancez ce fichier."
  pause; exit 1
fi

# Arrête une version déjà lancée (sinon l'ancienne reste affichée ou le démarrage échoue).
ANCIENS=$(lsof -ti tcp:3000 -ti tcp:5173 2>/dev/null)
if [ -n "$ANCIENS" ]; then
  echo "🔄 Arrêt de la version déjà lancée…"
  echo "$ANCIENS" | xargs kill 2>/dev/null; sleep 2
fi

echo "📦 Vérification des dépendances…"
npm install --no-audit --no-fund || { echo "❌ Échec de l'installation des dépendances (voir le message ci-dessus)."; pause; exit 1; }
node scripts/verifier.mjs || { pause; exit 1; }

( sleep 8; open "http://localhost:5173" ) &
npm run demarrer
echo
echo "L'application s'est arrêtée."
pause
