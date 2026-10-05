/**
 * Commandes d'administration d'une installation de production.
 *
 *   npm run initialiser -- --email admin@cabinet.fr --nom "Prénom Nom"
 *       Première installation : crée le compte administrateur (mot de passe
 *       aléatoire affiché une seule fois) et le registre RGPD par défaut.
 *   npm run sauvegarde
 *       Sauvegarde chiffrée immédiate dans BACKUP_DIR.
 *   npm run restaurer -- <fichier.db.enc> [--forcer]
 *       Restaure une sauvegarde (serveur arrêté) vers DATABASE_PATH.
 */
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { REGISTRE_PAR_DEFAUT } from "@compta/core";
import { loadConfig } from "./config.js";
import { Database } from "./db/index.js";
import { AuditLog } from "./services/audit.js";
import { listerSauvegardes, restaurer, sauvegarder } from "./services/sauvegarde.js";
import { checkPassword } from "./security/password-policy.js";
import { hashPassword } from "./security/crypto.js";

const [commande, ...args] = process.argv.slice(2);
const option = (nom: string) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const config = loadConfig();
const echec = (msg: string): never => {
  console.error(`❌ ${msg}`);
  process.exit(1);
};

/** Mot de passe aléatoire conforme à la politique (12+ caractères, 4 types). */
function motDePasse(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const base = [...randomBytes(18)].map((b) => alphabet[b % alphabet.length]).join("");
  return `${base.slice(0, 6)}-${base.slice(6, 12)}-${base.slice(12)}!7aK`;
}

switch (commande) {
  case "initialiser": {
    const email = option("email") ?? echec("Indiquez --email");
    const nom = option("nom") ?? echec("Indiquez --nom");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) echec("Adresse e-mail invalide");
    const db = new Database(config.databasePath);
    if (db.get("SELECT 1 FROM users LIMIT 1")) echec("La base contient déjà des utilisateurs : initialisation refusée.");
    let mdp = motDePasse();
    while (!checkPassword(mdp, { email, nom }).ok) mdp = motDePasse();
    db.run("INSERT INTO users (email, nom, role, password_hash) VALUES (?, ?, 'admin', ?)", email, nom, await hashPassword(mdp));
    if (!db.get("SELECT 1 FROM registre_traitements LIMIT 1")) {
      for (const t of REGISTRE_PAR_DEFAUT) db.run("INSERT INTO registre_traitements (reference, data) VALUES (?, ?)", t.reference, JSON.stringify(t));
    }
    new AuditLog(db).record({ userEmail: email, action: "systeme.initialisation", details: { production: true } });
    db.close();
    console.log(`\n✅ Installation initialisée.\n\n   Administrateur : ${email}\n   Mot de passe provisoire : ${mdp}\n`);
    console.log("   Notez-le maintenant : il ne sera plus affiché. À la première connexion, changez-le et activez la double authentification.\n");
    break;
  }
  case "sauvegarde": {
    if (!config.backupDir) echec("Définissez BACKUP_DIR (répertoire des sauvegardes)");
    const db = new Database(config.databasePath);
    const r = await sauvegarder(db, config.masterKey, config.backupDir!, config.backupRetentionDays);
    db.close();
    console.log(`✅ Sauvegarde chiffrée : ${r.fichier} (${(r.taille / 1024).toFixed(0)} Ko)${r.supprimees.length ? ` — ${r.supprimees.length} ancienne(s) supprimée(s)` : ""}`);
    break;
  }
  case "sauvegardes": {
    for (const s of listerSauvegardes(config.backupDir ?? echec("Définissez BACKUP_DIR"))) {
      console.log(`${s.date.toISOString()}  ${(s.taille / 1024).toFixed(0).padStart(8)} Ko  ${s.fichier}`);
    }
    break;
  }
  case "restaurer": {
    const fichier = args.find((a) => !a.startsWith("--")) ?? echec("Indiquez le fichier de sauvegarde à restaurer");
    if (!existsSync(fichier)) echec(`Fichier introuvable : ${fichier}`);
    if (existsSync(config.databasePath) && !args.includes("--forcer")) {
      echec(`La base ${config.databasePath} existe déjà. Arrêtez le serveur, puis relancez avec --forcer pour la remplacer.`);
    }
    const r = await restaurer(fichier, config.masterKey, config.databasePath);
    console.log(`✅ Base restaurée dans ${config.databasePath} (${r.tables} tables, intégrité : ${r.integrite}). Redémarrez le serveur.`);
    break;
  }
  default:
    console.log("Commandes : initialiser --email <e-mail> --nom <nom> | sauvegarde | sauvegardes | restaurer <fichier> [--forcer]");
    process.exit(commande ? 1 : 0);
}
