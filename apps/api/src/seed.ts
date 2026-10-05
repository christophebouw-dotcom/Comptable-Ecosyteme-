/**
 * Données de démonstration : un cabinet, ses utilisateurs, deux dossiers
 * clients, des tiers, des écritures et des factures.
 *
 * Usage : npm run seed
 * Les comptes de démonstration partagent le mot de passe SEED_PASSWORD
 * (par défaut « Demo-Compta-2026! »). Ne jamais utiliser en production.
 */
import { REGISTRE_PAR_DEFAUT } from "@compta/core";
import { loadConfig } from "./config.js";
import { createContext } from "./context.js";
import { hashPassword } from "./security/crypto.js";

const config = loadConfig();
if (config.env === "production" && !process.env.SEED_PASSWORD) {
  console.error("Refus : définissez SEED_PASSWORD pour initialiser une base de production.");
  process.exit(1);
}
const ctx = createContext(config);
const { db, cipher, compta } = ctx;

if (db.get("SELECT 1 FROM users LIMIT 1")) {
  console.log("La base contient déjà des utilisateurs : seed ignoré.");
  process.exit(0);
}

const password = process.env.SEED_PASSWORD ?? "Demo-Compta-2026!";
const hash = await hashPassword(password);
const year = new Date().getFullYear();

const users = [
  ["admin@cabinet.fr", "Claire Admin", "admin"],
  ["expert@cabinet.fr", "Marc Lefèvre", "expert"],
  ["collaborateur@cabinet.fr", "Sophie Bernard", "collaborateur"],
  ["dpo@cabinet.fr", "Nadia Kader", "dpo"],
  ["client@boulangerie-martin.fr", "Paul Martin", "client"],
] as const;
const ids: Record<string, number> = {};
for (const [email, nom, role] of users) {
  ids[role] = db.run("INSERT INTO users (email, nom, role, password_hash) VALUES (?, ?, ?, ?)", email, nom, role, hash).lastInsertRowid;
}

function dossier(d: {
  raison: string; forme: string; siren: string; adresse: string; cp: string; ville: string; regime: string; impot: "IS" | "IR"; iban?: string; capital?: string;
}) {
  const id = db.run(
    `INSERT INTO dossiers (raison_sociale, forme_juridique, siren, adresse, code_postal, ville, capital, rcs, regime_tva, impot, email_contact, iban_enc, bic)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    d.raison, d.forme, d.siren, d.adresse, d.cp, d.ville, d.capital ?? null, d.ville, d.regime, d.impot, null,
    cipher.encrypt(d.iban ?? null), d.iban ? "BNPAFRPP" : null,
  ).lastInsertRowid;
  compta.initDossier(id, `${year}-01-01`, `${year}-12-31`);
  return id;
}

const martin = dossier({
  raison: "Boulangerie Martin SARL", forme: "SARL", siren: "404833048", adresse: "12 rue du Four", cp: "75006", ville: "Paris",
  regime: "reel_normal_mensuel", impot: "IS", iban: "FR7630006000011234567890189", capital: "8 000 €",
});
const studio = dossier({
  raison: "Studio Lumière SAS", forme: "SAS", siren: "552100554", adresse: "45 quai Saint-Antoine", cp: "69002", ville: "Lyon",
  regime: "reel_simplifie", impot: "IS", capital: "1 000 €",
});
db.run("INSERT INTO dossier_access (user_id, dossier_id) VALUES (?, ?), (?, ?), (?, ?)", ids.collaborateur!, martin, ids.collaborateur!, studio, ids.client!, martin);

function tiers(dossierId: number, type: "client" | "fournisseur", aux: string, nom: string, extra: { pp?: boolean; email?: string; siren?: string; pro?: boolean } = {}) {
  return db.run(
    `INSERT INTO tiers (dossier_id, type, compte_aux, nom, personne_physique, professionnel, siren, adresse, code_postal, ville, email_enc, email_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    dossierId, type, aux, nom, extra.pp ? 1 : 0, extra.pro === false ? 0 : 1, extra.siren ?? null, "1 avenue de la République", "75011", "Paris",
    cipher.encrypt(extra.email ?? null), cipher.blindIndex(extra.email ?? null),
  ).lastInsertRowid;
}
const hotel = tiers(martin, "client", "CHOTELLUX", "Hôtel du Luxembourg SAS", { siren: "542065479", email: "achats@hotel-lux.fr" });
tiers(martin, "client", "CDUPONT", "Jeanne Dupont", { pp: true, pro: false, email: "jeanne.dupont@exemple.fr" });
tiers(martin, "fournisseur", "FMOULIN", "Moulins de Beauce", { siren: "775672272" });
tiers(martin, "fournisseur", "FEDF", "EDF Entreprises", { siren: "552081317" });
tiers(studio, "client", "CAGENCE", "Agence Horizon", { siren: "732829320" });

const ecritures: Parameters<typeof compta.create>[1][] = [
  { journal: "BQ", date: `${year}-01-03`, libelle: "Apport en capital", pieceRef: "STATUTS", lignes: [
    { compte: "512", debit: 800_000, credit: 0 }, { compte: "1013", debit: 0, credit: 800_000 }] },
  { journal: "AC", date: `${year}-01-10`, libelle: "Farine — Moulins de Beauce", pieceRef: "FA-2201", lignes: [
    { compte: "601", debit: 120_000, credit: 0 }, { compte: "44566", debit: 6_600, credit: 0, tauxTva: 550 },
    { compte: "401", compteAux: "FMOULIN", debit: 0, credit: 126_600 }] },
  { journal: "AC", date: `${year}-01-31`, libelle: "Électricité janvier", pieceRef: "EDF-01", lignes: [
    { compte: "6061", debit: 45_000, credit: 0 }, { compte: "44566", debit: 9_000, credit: 0, tauxTva: 2000 },
    { compte: "401", compteAux: "FEDF", debit: 0, credit: 54_000 }] },
  { journal: "VE", date: `${year}-01-31`, libelle: "Ventes comptoir janvier", pieceRef: "Z-01", lignes: [
    { compte: "530", debit: 633_000, credit: 0 }, { compte: "707", debit: 0, credit: 600_000 },
    { compte: "44571", debit: 0, credit: 33_000, tauxTva: 550 }] },
  { journal: "BQ", date: `${year}-02-05`, libelle: "Règlement Moulins de Beauce", pieceRef: "VIR-0205", lignes: [
    { compte: "401", compteAux: "FMOULIN", debit: 126_600, credit: 0 }, { compte: "512", debit: 0, credit: 126_600 }] },
  { journal: "BQ", date: `${year}-02-06`, libelle: "Remise d'espèces", pieceRef: "REM-0206", lignes: [
    { compte: "512", debit: 600_000, credit: 0 }, { compte: "530", debit: 0, credit: 600_000 }] },
  { journal: "AC", date: `${year}-03-15`, libelle: "Four professionnel", pieceRef: "FA-IMMO-1", lignes: [
    { compte: "2154", debit: 1_500_000, credit: 0 }, { compte: "44562", debit: 300_000, credit: 0, tauxTva: 2000 },
    { compte: "404", debit: 0, credit: 1_800_000 }] },
];
const validees: number[] = [];
for (const e of ecritures) validees.push(compta.create(martin, e, ids.collaborateur!));
compta.validate(martin, validees, ids.expert!);
compta.create(martin, {
  journal: "OD", date: `${year}-03-31`, libelle: "Salaires mars (à valider)", pieceRef: "PAIE-03", lignes: [
    { compte: "641", debit: 210_000, credit: 0 }, { compte: "431", debit: 0, credit: 46_000 }, { compte: "421", debit: 0, credit: 164_000 }],
}, ids.collaborateur!);

// Facture brouillon prête à émettre.
db.run(
  "INSERT INTO factures (dossier_id, tiers_id, type, data, created_by) VALUES (?, ?, 'facture', ?, ?)",
  martin, hotel,
  JSON.stringify({
    tiersId: hotel, type: "facture", delaiPaiementJours: 30, categorie: "biens", tvaSurDebits: false,
    tauxPenalitesRetard: "3 fois le taux d'intérêt légal",
    lignes: [
      { designation: "Viennoiseries petit-déjeuner (lot de 100)", quantite: 20, prixUnitaireHT: 9_500, tauxTvaBp: 550 },
      { designation: "Livraison quotidienne", quantite: 20, prixUnitaireHT: 1_500, tauxTvaBp: 2000 },
    ],
  }),
  ids.collaborateur!,
);

for (const t of REGISTRE_PAR_DEFAUT) db.run("INSERT INTO registre_traitements (reference, data) VALUES (?, ?)", t.reference, JSON.stringify(t));
const today = new Date().toISOString().slice(0, 10);
db.run(
  `INSERT INTO demandes_droits (type, statut, demandeur_nom_enc, demandeur_email_enc, demandeur_email_hash, canal, recue_le, echeance, created_by)
   VALUES ('acces', 'identite_a_verifier', ?, ?, ?, 'e-mail', ?, date(?, '+1 month'), ?)`,
  cipher.encrypt("Jeanne Dupont"), cipher.encrypt("jeanne.dupont@exemple.fr"), cipher.blindIndex("jeanne.dupont@exemple.fr"), today, today, ids.dpo!,
);
ctx.audit.record({ action: "systeme.initialisation", details: { seed: true } });

console.log(`\n✅ Base initialisée (${config.databasePath}).\n`);
console.log("Comptes de démonstration (mot de passe commun : %s) :", process.env.SEED_PASSWORD ? "<SEED_PASSWORD>" : password);
for (const [email, nom, role] of users) console.log(`  • ${role.padEnd(14)} ${email.padEnd(32)} ${nom}`);
console.log("\n⚠️  Changez ces mots de passe et activez la double authentification avant tout usage réel.\n");
