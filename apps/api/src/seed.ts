/**
 * Données de démonstration : un cabinet, ses utilisateurs, deux dossiers
 * clients, des tiers, des écritures et des factures.
 *
 * Usage : npm run seed
 * Les comptes de démonstration partagent le mot de passe SEED_PASSWORD
 * (par défaut « Demo-Compta-2026! »). Ne jamais utiliser en production.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BAREME_2026, REGISTRE_PAR_DEFAUT, calculerBulletin, cleReleve, ecriturePaie, parseReleveCsv } from "@compta/core";
import { loadConfig } from "./config.js";
import { createContext } from "./context.js";
import { canonicalJson, hashPassword, sha256 } from "./security/crypto.js";

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

// Immobilisation : le four acquis en mars.
db.run(
  "INSERT INTO immobilisations (dossier_id, compte, libelle, date_mise_en_service, valeur_ht, duree_annees, mode) VALUES (?, '2154', 'Four professionnel', ?, 1500000, 10, 'degressif')",
  martin, `${year}-03-15`,
);

// Relevé bancaire d'exemple (dates ramenées à l'année courante).
const csv = readFileSync(resolve(import.meta.dirname, "../../../docs/exemples/releve-banque-exemple.csv"), "utf8").replaceAll("/2026", `/${year}`);
const releve = parseReleveCsv(csv);
const releveId = db.run("INSERT INTO releves_bancaires (dossier_id, compte, fichier, format, nb_lignes, imported_by) VALUES (?, '512', 'releve-banque-exemple.csv', 'csv', ?, ?)", martin, releve.lignes.length, ids.collaborateur!).lastInsertRowid;
for (const l of releve.lignes) {
  db.run("INSERT INTO lignes_bancaires (dossier_id, releve_id, compte, date, libelle, montant, cle) VALUES (?, ?, '512', ?, ?, ?, ?)", martin, releveId, l.date, l.libelle, l.montant, cleReleve(l));
}

// Mission : en règle pour Martin, absente pour Studio Lumière (alerte).
db.run(
  "INSERT INTO missions (dossier_id, data, updated_at, updated_by) VALUES (?, ?, ?, ?)",
  martin,
  JSON.stringify({
    types: ["tenue_presentation", "social"], lettreSigneeLe: `${year}-01-05`, honorairesAnnuelsHT: 420_000, risqueLcbft: "faible",
    identiteVerifieeLe: `${year}-01-05`, beneficiairesEffectifs: "Paul Martin, gérant, 100 % des parts", revueLcbftLe: `${year}-01-05`, ppe: false,
  }),
  new Date().toISOString(), ids.expert!,
);

// Paie : deux salariés, bulletins du mois précédent validés.
db.run("INSERT INTO paie_parametres (dossier_id, effectif, taux_at_mp, taux_versement_mobilite, convention, updated_at) VALUES (?, 2, 2.08, 0, ?, ?)",
  martin, "Boulangerie-pâtisserie artisanale (IDCC 843)", new Date().toISOString());
db.run("INSERT OR IGNORE INTO journaux (dossier_id, code, libelle, type) VALUES (?, 'PA', 'Paie', 'od')", martin);
const nirDemo = (corps: string) => `${corps}${String(97 - Number(BigInt(corps) % 97n)).padStart(2, "0")}`;
const salaries = [
  { matricule: "S001", nom: "Lambert", prenom: "Julie", nir: nirDemo("2920675123045"), emploi: "Vendeuse", statut: "non_cadre", base: 190_000, pas: 1.6, entree: `${year}-01-02` },
  { matricule: "S002", nom: "Haddad", prenom: "Karim", nir: nirDemo("1880593054012"), emploi: "Ouvrier boulanger", statut: "non_cadre", base: 245_000, pas: 4.2, entree: `${year}-01-02` },
] as const;
const moisPaie = new Date().getMonth() >= 1 ? `${year}-${String(new Date().getMonth()).padStart(2, "0")}` : `${year}-01`;
const finMoisPaie = new Date(Date.UTC(year, Number(moisPaie.slice(5)), 0)).toISOString().slice(0, 10);
for (const sa of salaries) {
  const profil = { salaireBase: sa.base, heuresMensuelles: 151.67, tauxPas: sa.pas, mutuelleSalarie: 2_100, mutuelleEmployeur: 2_100 };
  const sid = db.run(
    `INSERT INTO salaries (dossier_id, matricule, nom_enc, prenom_enc, nir_enc, emploi, statut, date_entree, profil) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    martin, sa.matricule, cipher.encrypt(sa.nom), cipher.encrypt(sa.prenom), cipher.encrypt(sa.nir), sa.emploi, sa.statut, sa.entree, cipher.encrypt(JSON.stringify(profil)),
  ).lastInsertRowid;
  const variables = { heuresSup25: sa.matricule === "S002" ? 6 : 0, heuresSup50: 0, primes: 0, heuresAbsence: 0, indemnitesNonSoumises: 0 };
  const b = calculerBulletin({ statut: sa.statut, ...profil }, variables, { effectif: 2, tauxAtMp: 2.08, tauxVersementMobilite: 0 }, BAREME_2026);
  const ecritureId = compta.create(martin, ecriturePaie(b, { journal: "PA", date: finMoisPaie, pieceRef: `PAIE-${moisPaie.replace("-", "")}-${sa.matricule}`, nomSalarie: sa.matricule, periode: moisPaie }), ids.collaborateur!);
  const validatedAt = new Date().toISOString();
  db.run(
    `INSERT INTO bulletins (dossier_id, salarie_id, periode, statut, variables, resultat_enc, net_a_payer, cout_employeur, ecriture_id, hash, created_by, validated_by, validated_at)
     VALUES (?, ?, ?, 'valide', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    martin, sid, moisPaie, JSON.stringify(variables), cipher.encrypt(JSON.stringify(b)), b.netAPayer, b.coutEmployeur, ecritureId,
    sha256(canonicalJson({ dossier: martin, salarie: sid, periode: moisPaie, variables: JSON.stringify(variables), resultat: b, validatedAt })), ids.collaborateur!, ids.collaborateur!, validatedAt,
  );
}

// Portail client : une demande de justificatif et un échange de messages.
const ligneSansPiece = db.get<{ id: number; date: string; libelle: string; montant: number }>(
  "SELECT id, date, libelle, montant FROM lignes_bancaires WHERE dossier_id = ? AND montant < 0 ORDER BY date DESC LIMIT 1", martin,
);
if (ligneSansPiece) {
  db.run(
    "INSERT INTO demandes_pieces (dossier_id, ligne_bancaire_id, objet, date_operation, montant, message, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
    martin, ligneSansPiece.id, `Justificatif de l'opération « ${ligneSansPiece.libelle} »`, ligneSansPiece.date, ligneSansPiece.montant,
    "Pouvez-vous nous transmettre la facture correspondante ?", ids.collaborateur!,
  );
}
db.run("INSERT INTO demandes_pieces (dossier_id, objet, message, created_by) VALUES (?, ?, ?, ?)", martin, "Contrat de prêt du four professionnel", "Le tableau d'amortissement de l'emprunt nous permettra de comptabiliser les intérêts.", ids.collaborateur!);
const ilYa = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
db.run("INSERT INTO messages (dossier_id, auteur_id, cote, contenu_enc, created_at, lu_at) VALUES (?, ?, 'cabinet', ?, ?, ?)", martin, ids.collaborateur!,
  cipher.encrypt("Bonjour Monsieur Martin, votre espace est ouvert : vous pouvez y déposer vos factures et tickets au fil de l'eau."), ilYa(50), ilYa(48));
db.run("INSERT INTO messages (dossier_id, auteur_id, cote, contenu_enc, created_at) VALUES (?, ?, 'client', ?, ?)", martin, ids.client!,
  cipher.encrypt("Merci ! Je dépose les tickets de la semaine ce soir. Pour la TVA de ce mois, quel montant dois-je prévoir ?"), ilYa(3));

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
