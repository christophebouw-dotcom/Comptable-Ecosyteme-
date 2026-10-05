/**
 * Schéma de la base de données.
 *
 * Les garanties d'intégrité légales sont portées AU NIVEAU DE LA BASE par des
 * triggers, et non seulement par le code applicatif :
 *  - une écriture validée est intangible (ANC 2014-03 art. 921-4) : ni
 *    modification ni suppression, hors lettrage ;
 *  - aucune écriture ne peut être ajoutée sur un exercice clôturé ;
 *  - une facture émise ne peut être modifiée ni supprimée (CGI art. 289) ;
 *  - le journal d'audit est en ajout seul.
 */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: "schema initial",
    sql: /* sql */ `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nom TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','expert','collaborateur','client','dpo')),
  password_hash TEXT NOT NULL,
  totp_secret_enc TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  password_changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  active INTEGER NOT NULL DEFAULT 1,
  anonymized_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                 -- SHA-256 du jeton, jamais le jeton lui-même
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  mfa_ok INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE access_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  user_id INTEGER,
  email_hash TEXT,
  event TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX idx_access_log_at ON access_log(at);

CREATE TABLE dossiers (
  id INTEGER PRIMARY KEY,
  raison_sociale TEXT NOT NULL,
  forme_juridique TEXT NOT NULL,
  siren TEXT NOT NULL UNIQUE,
  adresse TEXT NOT NULL,
  code_postal TEXT NOT NULL,
  ville TEXT NOT NULL,
  pays TEXT NOT NULL DEFAULT 'FR',
  capital TEXT,
  rcs TEXT,
  regime_tva TEXT NOT NULL,
  impot TEXT NOT NULL CHECK (impot IN ('IS','IR')),
  email_contact TEXT,
  iban_enc TEXT,
  bic TEXT,
  prefixe_facture TEXT NOT NULL DEFAULT 'F',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at TEXT
);

CREATE TABLE dossier_access (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, dossier_id)
);

CREATE TABLE exercices (
  id INTEGER PRIMARY KEY,
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id),
  debut TEXT NOT NULL,
  fin TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'ouvert' CHECK (statut IN ('ouvert','cloture')),
  cloture_at TEXT,
  cloture_by INTEGER,
  empreinte_cloture TEXT,
  CHECK (fin > debut),
  UNIQUE (dossier_id, debut)
);

CREATE TABLE journaux (
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id),
  code TEXT NOT NULL,
  libelle TEXT NOT NULL,
  type TEXT NOT NULL,
  PRIMARY KEY (dossier_id, code)
);

CREATE TABLE comptes (
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id),
  numero TEXT NOT NULL,
  libelle TEXT NOT NULL,
  PRIMARY KEY (dossier_id, numero)
);

CREATE TABLE tiers (
  id INTEGER PRIMARY KEY,
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id),
  type TEXT NOT NULL CHECK (type IN ('client','fournisseur')),
  compte_aux TEXT NOT NULL,
  nom TEXT NOT NULL,
  personne_physique INTEGER NOT NULL DEFAULT 0,
  professionnel INTEGER NOT NULL DEFAULT 1,
  siren TEXT,
  tva_intra TEXT,
  adresse TEXT,
  code_postal TEXT,
  ville TEXT,
  pays TEXT NOT NULL DEFAULT 'FR',
  email_enc TEXT,
  email_hash TEXT,
  telephone_enc TEXT,
  iban_enc TEXT,
  fin_relation TEXT,
  restricted INTEGER NOT NULL DEFAULT 0,  -- limitation du traitement (RGPD art. 18)
  anonymized_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (dossier_id, compte_aux)
);
CREATE INDEX idx_tiers_email ON tiers(email_hash);

CREATE TABLE ecritures (
  id INTEGER PRIMARY KEY,
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id),
  exercice_id INTEGER NOT NULL REFERENCES exercices(id),
  journal TEXT NOT NULL,
  numero INTEGER,                      -- attribué à la validation, séquence continue par exercice
  seq INTEGER,                         -- ordre de validation dans le dossier (chaînage des empreintes)
  date TEXT NOT NULL,
  libelle TEXT NOT NULL,
  piece_ref TEXT NOT NULL,
  piece_date TEXT,
  statut TEXT NOT NULL DEFAULT 'brouillard' CHECK (statut IN ('brouillard','validee')),
  extourne_de INTEGER REFERENCES ecritures(id),
  facture_id INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  validated_by INTEGER,
  validated_at TEXT,
  prev_hash TEXT,
  hash TEXT,
  UNIQUE (exercice_id, numero),
  UNIQUE (dossier_id, seq)
);
CREATE INDEX idx_ecritures_dossier ON ecritures(dossier_id, exercice_id, date);

CREATE TABLE ecriture_lignes (
  id INTEGER PRIMARY KEY,
  ecriture_id INTEGER NOT NULL REFERENCES ecritures(id) ON DELETE CASCADE,
  ordre INTEGER NOT NULL,
  compte TEXT NOT NULL,
  compte_aux TEXT,
  libelle TEXT,
  debit INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
  taux_tva INTEGER,
  lettrage TEXT,
  date_lettrage TEXT,
  CHECK (NOT (debit > 0 AND credit > 0))
);
CREATE INDEX idx_lignes_ecriture ON ecriture_lignes(ecriture_id);
CREATE INDEX idx_lignes_compte ON ecriture_lignes(compte);

-- Intangibilité des écritures validées --------------------------------------
CREATE TRIGGER trg_ecriture_validee_no_update BEFORE UPDATE ON ecritures
WHEN OLD.statut = 'validee'
BEGIN SELECT RAISE(ABORT, 'Écriture validée : modification interdite (utilisez une contre-passation)'); END;

CREATE TRIGGER trg_ecriture_validee_no_delete BEFORE DELETE ON ecritures
WHEN OLD.statut = 'validee'
BEGIN SELECT RAISE(ABORT, 'Écriture validée : suppression interdite'); END;

CREATE TRIGGER trg_ecriture_exercice_clos BEFORE INSERT ON ecritures
WHEN (SELECT statut FROM exercices WHERE id = NEW.exercice_id) = 'cloture'
BEGIN SELECT RAISE(ABORT, 'Exercice clôturé : aucune écriture ne peut y être ajoutée'); END;

CREATE TRIGGER trg_ligne_validee_no_insert BEFORE INSERT ON ecriture_lignes
WHEN (SELECT statut FROM ecritures WHERE id = NEW.ecriture_id) = 'validee'
BEGIN SELECT RAISE(ABORT, 'Écriture validée : ajout de ligne interdit'); END;

CREATE TRIGGER trg_ligne_validee_no_update BEFORE UPDATE ON ecriture_lignes
WHEN (SELECT statut FROM ecritures WHERE id = OLD.ecriture_id) = 'validee'
  AND (NEW.compte IS NOT OLD.compte OR NEW.compte_aux IS NOT OLD.compte_aux OR NEW.debit IS NOT OLD.debit
       OR NEW.credit IS NOT OLD.credit OR NEW.libelle IS NOT OLD.libelle OR NEW.taux_tva IS NOT OLD.taux_tva
       OR NEW.ecriture_id IS NOT OLD.ecriture_id OR NEW.ordre IS NOT OLD.ordre)
BEGIN SELECT RAISE(ABORT, 'Écriture validée : seul le lettrage peut être modifié'); END;

CREATE TRIGGER trg_ligne_validee_no_delete BEFORE DELETE ON ecriture_lignes
WHEN (SELECT statut FROM ecritures WHERE id = OLD.ecriture_id) = 'validee'
BEGIN SELECT RAISE(ABORT, 'Écriture validée : suppression de ligne interdite'); END;

CREATE TRIGGER trg_exercice_clos_no_reopen BEFORE UPDATE ON exercices
WHEN OLD.statut = 'cloture'
BEGIN SELECT RAISE(ABORT, 'Exercice clôturé : réouverture interdite'); END;

-- Facturation -----------------------------------------------------------------
CREATE TABLE facture_sequences (
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id),
  prefixe TEXT NOT NULL,
  annee INTEGER NOT NULL,
  dernier INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (dossier_id, prefixe, annee)
);

CREATE TABLE factures (
  id INTEGER PRIMARY KEY,
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id),
  tiers_id INTEGER NOT NULL REFERENCES tiers(id),
  type TEXT NOT NULL CHECK (type IN ('facture','avoir')),
  numero TEXT,
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','emise','payee')),
  date_emission TEXT,
  date_echeance TEXT,
  facture_origine_id INTEGER REFERENCES factures(id),
  data TEXT NOT NULL,                   -- brouillon puis instantané figé de la facture émise (JSON)
  total_ht INTEGER NOT NULL DEFAULT 0,
  total_tva INTEGER NOT NULL DEFAULT 0,
  total_ttc INTEGER NOT NULL DEFAULT 0,
  ecriture_id INTEGER REFERENCES ecritures(id),
  hash TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  emitted_at TEXT,
  paid_at TEXT,
  UNIQUE (dossier_id, numero)
);

CREATE TRIGGER trg_facture_emise_no_update BEFORE UPDATE ON factures
WHEN OLD.statut <> 'brouillon'
  AND (NEW.numero IS NOT OLD.numero OR NEW.data IS NOT OLD.data OR NEW.total_ttc IS NOT OLD.total_ttc
       OR NEW.tiers_id IS NOT OLD.tiers_id OR NEW.date_emission IS NOT OLD.date_emission OR NEW.hash IS NOT OLD.hash
       OR NEW.type IS NOT OLD.type OR (NEW.statut = 'brouillon'))
BEGIN SELECT RAISE(ABORT, 'Facture émise : modification interdite (émettez un avoir)'); END;

CREATE TRIGGER trg_facture_emise_no_delete BEFORE DELETE ON factures
WHEN OLD.statut <> 'brouillon'
BEGIN SELECT RAISE(ABORT, 'Facture émise : suppression interdite'); END;

-- Journal d'audit chaîné (ajout seul) -------------------------------------------
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id INTEGER,
  user_email TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  dossier_id INTEGER,
  ip TEXT,
  details TEXT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE
);
CREATE INDEX idx_audit_dossier ON audit_log(dossier_id, at);

CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'Journal d''audit : modification interdite'); END;

CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log
WHEN OLD.at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 years')
BEGIN SELECT RAISE(ABORT, 'Journal d''audit : suppression interdite avant 10 ans'); END;

-- RGPD ------------------------------------------------------------------------
CREATE TABLE registre_traitements (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by INTEGER
);

CREATE TABLE demandes_droits (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'recue',
  demandeur_nom_enc TEXT NOT NULL,
  demandeur_email_enc TEXT,
  demandeur_email_hash TEXT,
  canal TEXT,
  recue_le TEXT NOT NULL,
  echeance TEXT NOT NULL,
  prolongee INTEGER NOT NULL DEFAULT 0,
  identite_verifiee INTEGER NOT NULL DEFAULT 0,
  analyse TEXT,
  reponse TEXT,
  cloturee_le TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE violations (
  id INTEGER PRIMARY KEY,
  titre TEXT NOT NULL,
  description TEXT NOT NULL,
  connue_le TEXT NOT NULL,
  dpc INTEGER NOT NULL,
  ei REAL NOT NULL,
  circonstances TEXT NOT NULL,
  score REAL NOT NULL,
  niveau TEXT NOT NULL,
  notification_cnil_requise INTEGER NOT NULL,
  notifiee_cnil_le TEXT,
  information_personnes_requise INTEGER NOT NULL,
  personnes_informees_le TEXT,
  nb_personnes INTEGER,
  categories_donnees TEXT,
  mesures TEXT,
  statut TEXT NOT NULL DEFAULT 'ouverte' CHECK (statut IN ('ouverte','cloturee')),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE consentements (
  id INTEGER PRIMARY KEY,
  email_hash TEXT NOT NULL,
  finalite TEXT NOT NULL,
  accorde INTEGER NOT NULL,
  source TEXT NOT NULL,
  texte_version TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_consentements_email ON consentements(email_hash, finalite, at);
`,
  },
  {
    version: 2,
    name: "outils de l'expert-comptable",
    sql: /* sql */ `
CREATE TABLE immobilisations (
  id INTEGER PRIMARY KEY,
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id),
  compte TEXT NOT NULL,
  libelle TEXT NOT NULL,
  date_mise_en_service TEXT NOT NULL,
  valeur_ht INTEGER NOT NULL CHECK (valeur_ht > 0),
  duree_annees INTEGER NOT NULL CHECK (duree_annees BETWEEN 1 AND 100),
  mode TEXT NOT NULL CHECK (mode IN ('lineaire','degressif','non_amortissable')),
  amortissements_anterieurs INTEGER NOT NULL DEFAULT 0,  -- reprise d'un dossier existant
  date_sortie TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_immos_dossier ON immobilisations(dossier_id);

CREATE TABLE releves_bancaires (
  id INTEGER PRIMARY KEY,
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id),
  compte TEXT NOT NULL,
  fichier TEXT,
  format TEXT NOT NULL,
  nb_lignes INTEGER NOT NULL,
  imported_by INTEGER,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE lignes_bancaires (
  id INTEGER PRIMARY KEY,
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id),
  releve_id INTEGER NOT NULL REFERENCES releves_bancaires(id),
  compte TEXT NOT NULL,
  date TEXT NOT NULL,
  libelle TEXT NOT NULL,
  montant INTEGER NOT NULL,
  cle TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'a_traiter' CHECK (statut IN ('a_traiter','rapprochee','ignoree')),
  ecriture_ligne_id INTEGER,  -- libéré par trg_ligne_ecriture_suppr_releve
  UNIQUE (dossier_id, compte, cle)
);
CREATE INDEX idx_lignes_bancaires ON lignes_bancaires(dossier_id, compte, statut, date);

-- Une ligne d'écriture supprimée (brouillard modifié ou supprimé) libère la ligne de relevé.
CREATE TRIGGER trg_ligne_ecriture_suppr_releve AFTER DELETE ON ecriture_lignes
BEGIN
  UPDATE lignes_bancaires SET ecriture_ligne_id = NULL, statut = 'a_traiter'
  WHERE ecriture_ligne_id = OLD.id;
END;

CREATE TABLE regles_imputation (
  id INTEGER PRIMARY KEY,
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id),
  motif TEXT NOT NULL,
  compte TEXT NOT NULL,
  compte_aux TEXT,
  UNIQUE (dossier_id, motif)
);

CREATE TABLE revision_points (
  exercice_id INTEGER NOT NULL REFERENCES exercices(id),
  code TEXT NOT NULL,
  statut TEXT NOT NULL CHECK (statut IN ('a_faire','fait','na','anomalie')),
  commentaire TEXT,
  user_id INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (exercice_id, code)
);

CREATE TABLE missions (
  dossier_id INTEGER PRIMARY KEY REFERENCES dossiers(id),
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER
);
`,
  },
  {
    version: 3,
    name: "pièces justificatives et assistance IA",
    sql: /* sql */ `
ALTER TABLE dossiers ADD COLUMN ia_autorisee INTEGER NOT NULL DEFAULT 0;

CREATE TABLE pieces (
  id INTEGER PRIMARY KEY,
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id),
  nom_fichier TEXT NOT NULL,
  mime TEXT NOT NULL,
  taille INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  contenu_enc TEXT NOT NULL,              -- fichier chiffré (AES-256-GCM)
  statut TEXT NOT NULL CHECK (statut IN ('a_traiter','a_valider','comptabilisee','rejetee','erreur')),
  source TEXT,                            -- 'ia', 'facturx' ou NULL (saisie manuelle)
  extraction TEXT,
  erreur TEXT,
  ecriture_id INTEGER REFERENCES ecritures(id),
  ia_modele TEXT,
  ia_tokens_entree INTEGER,
  ia_tokens_sortie INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  traitee_at TEXT,
  UNIQUE (dossier_id, sha256)
);
CREATE INDEX idx_pieces_dossier ON pieces(dossier_id, statut);

-- Une pièce comptabilisée ne peut plus être supprimée (justificatif à conserver 10 ans).
CREATE TRIGGER trg_piece_comptabilisee_no_delete BEFORE DELETE ON pieces
WHEN OLD.statut = 'comptabilisee'
BEGIN SELECT RAISE(ABORT, 'Pièce comptabilisée : suppression interdite (C. com. art. L123-22)'); END;

-- Brouillard supprimé : la pièce redevient à valider.
CREATE TRIGGER trg_ecriture_suppr_piece AFTER DELETE ON ecritures
BEGIN
  UPDATE pieces SET ecriture_id = NULL, statut = 'a_valider' WHERE ecriture_id = OLD.id;
END;
`,
  },
  {
    version: 4,
    name: "inventaire, paie et portail client",
    sql: /* sql */ `
-- Écritures d'inventaire (régularisations de fin d'exercice) -------------------------
CREATE TABLE regularisations (
  id INTEGER PRIMARY KEY,
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id),
  exercice_id INTEGER NOT NULL REFERENCES exercices(id),
  type TEXT NOT NULL,
  cle TEXT,
  data TEXT NOT NULL,
  montant INTEGER NOT NULL,
  ecriture_id INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_regularisations ON regularisations(dossier_id, exercice_id);

-- Brouillard supprimé depuis la liste des écritures : la régularisation disparaît avec lui.
CREATE TRIGGER trg_ecriture_suppr_regularisation AFTER DELETE ON ecritures
BEGIN
  DELETE FROM regularisations WHERE ecriture_id = OLD.id;
END;

-- Paie -------------------------------------------------------------------------
CREATE TABLE paie_parametres (
  dossier_id INTEGER PRIMARY KEY REFERENCES dossiers(id),
  effectif INTEGER NOT NULL DEFAULT 1,
  taux_at_mp REAL NOT NULL DEFAULT 2.08,
  taux_versement_mobilite REAL NOT NULL DEFAULT 0,
  convention TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE salaries (
  id INTEGER PRIMARY KEY,
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id),
  matricule TEXT NOT NULL,
  nom_enc TEXT NOT NULL,                 -- identité chiffrée (AES-256-GCM)
  prenom_enc TEXT NOT NULL,
  nir_enc TEXT,                          -- numéro de sécurité sociale chiffré (donnée à accès restreint)
  email_enc TEXT,
  email_hash TEXT,
  iban_enc TEXT,
  emploi TEXT NOT NULL,
  statut TEXT NOT NULL CHECK (statut IN ('non_cadre','cadre')),
  date_entree TEXT NOT NULL,
  date_sortie TEXT,
  profil TEXT NOT NULL,                  -- salaire de base, durée, taux PAS chiffré, mutuelle (JSON chiffré)
  anonymized_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (dossier_id, matricule)
);
CREATE INDEX idx_salaries_email ON salaries(email_hash);

CREATE TABLE bulletins (
  id INTEGER PRIMARY KEY,
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id),
  salarie_id INTEGER NOT NULL REFERENCES salaries(id),
  periode TEXT NOT NULL,                 -- AAAA-MM
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','valide')),
  variables TEXT NOT NULL,
  resultat_enc TEXT NOT NULL,            -- bulletin calculé (JSON chiffré)
  net_a_payer INTEGER NOT NULL,
  cout_employeur INTEGER NOT NULL,
  ecriture_id INTEGER,
  hash TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  validated_by INTEGER,
  validated_at TEXT,
  UNIQUE (salarie_id, periode)
);
CREATE INDEX idx_bulletins ON bulletins(dossier_id, periode);

CREATE TRIGGER trg_bulletin_valide_no_update BEFORE UPDATE ON bulletins
WHEN OLD.statut = 'valide'
  AND (NEW.statut IS NOT OLD.statut OR NEW.variables IS NOT OLD.variables OR NEW.resultat_enc IS NOT OLD.resultat_enc
       OR NEW.net_a_payer IS NOT OLD.net_a_payer OR NEW.hash IS NOT OLD.hash OR NEW.periode IS NOT OLD.periode OR NEW.salarie_id IS NOT OLD.salarie_id)
BEGIN SELECT RAISE(ABORT, 'Bulletin validé : modification interdite (établissez un bulletin rectificatif)'); END;

-- Suppression possible uniquement après la durée légale de conservation (5 ans).
CREATE TRIGGER trg_bulletin_valide_no_delete BEFORE DELETE ON bulletins
WHEN OLD.statut = 'valide' AND OLD.validated_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 years')
BEGIN SELECT RAISE(ABORT, 'Bulletin validé : suppression interdite (C. trav. art. L3243-4)'); END;

CREATE TRIGGER trg_ecriture_suppr_bulletin AFTER DELETE ON ecritures
BEGIN
  UPDATE bulletins SET ecriture_id = NULL WHERE ecriture_id = OLD.id;
END;

-- Portail client ---------------------------------------------------------------------
CREATE TABLE demandes_pieces (
  id INTEGER PRIMARY KEY,
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id),
  ligne_bancaire_id INTEGER,
  objet TEXT NOT NULL,
  date_operation TEXT,
  montant INTEGER,
  message TEXT,
  statut TEXT NOT NULL DEFAULT 'ouverte' CHECK (statut IN ('ouverte','repondue','close')),
  reponse TEXT,
  piece_id INTEGER REFERENCES pieces(id),
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  repondue_par INTEGER,
  repondue_at TEXT,
  close_at TEXT
);
CREATE INDEX idx_demandes_pieces ON demandes_pieces(dossier_id, statut);

-- Une pièce supprimée rouvre la demande qu'elle satisfaisait.
CREATE TRIGGER trg_piece_suppr_demande AFTER DELETE ON pieces
BEGIN
  UPDATE demandes_pieces SET piece_id = NULL, statut = 'ouverte' WHERE piece_id = OLD.id AND statut <> 'close';
END;

CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id),
  auteur_id INTEGER NOT NULL REFERENCES users(id),
  cote TEXT NOT NULL CHECK (cote IN ('cabinet','client')),
  contenu_enc TEXT NOT NULL,             -- message chiffré
  demande_id INTEGER REFERENCES demandes_pieces(id),
  created_at TEXT NOT NULL,
  lu_at TEXT
);
CREATE INDEX idx_messages ON messages(dossier_id, created_at);

ALTER TABLE pieces ADD COLUMN deposee_par_client INTEGER NOT NULL DEFAULT 0;
`,
  },
];
