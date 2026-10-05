# Matrice de conformité

Chaque exigence est reliée à son fondement juridique, à son implémentation et au test qui la vérifie.

> Ce document décrit des mécanismes techniques. Il ne constitue pas un avis juridique : la conformité d'un cabinet dépend aussi de son organisation, de ses contrats et de ses procédures.

## 1. Obligations comptables

| Exigence | Fondement | Implémentation | Test |
|---|---|---|---|
| Partie double, écriture équilibrée | C. com. L123-12 ; ANC 2014-03 | `packages/core/src/ledger.ts` → `validateEcriture` | `ledger.test.ts` « détecte déséquilibre… » |
| Pièce justificative datée pour chaque écriture | ANC 2014-03 art. 921-3 | `pieceRef` obligatoire (cœur + schéma API) | `ledger.test.ts` |
| Caractère définitif des enregistrements (validation) | ANC 2014-03 art. 921-4 | Statut `validee`, numéro continu, triggers `trg_ecriture_validee_*` | `api.test.ts` « interdit la modification… y compris directement en SQL » |
| Correction par contre-passation uniquement | Principe d'intangibilité | `contrePassation`, route `/extourner` | `api.test.ts` « corrige par contre-passation » |
| Chronologie et numérotation continue | ANC 2014-03 art. 911-1 et s. | `numero` = MAX+1 par exercice, unicité `(exercice_id, numero)` | `api.test.ts` |
| Piste d'audit fiable | BOI-CF-IOR-60-40-10 | Chaînage SHA-256 des écritures (`prev_hash`, `hash`, `seq`), `verifyChain` | `api.test.ts` « intégrité » |
| Clôture et interdiction d'écrire sur un exercice clos | C. com. L123-12 | `cloturer`, trigger `trg_ecriture_exercice_clos`, `trg_exercice_clos_no_reopen` | `api.test.ts` « clôture l'exercice… » |
| Reprise des soldes (à-nouveaux) | PCG | `computeANouveaux` (classes 1 à 5, résultat en 120/129) | `ledger.test.ts`, `api.test.ts` |
| Conservation 10 ans des livres et pièces | C. com. L123-22 | `REGLES_CONSERVATION.livres_comptables`, signalement à la purge | `rgpd.test.ts` |

## 2. Fichier des Écritures Comptables

| Exigence | Fondement | Implémentation | Test |
|---|---|---|---|
| Remise du FEC lors d'un contrôle | LPF L47 A-I | Route `GET …/exercices/:id/fec` | `api.test.ts` « exporte un FEC conforme » |
| 18 zones dans l'ordre réglementaire | LPF A47 A-1 | `FEC_COLUMNS`, `generateFec` | `fec.test.ts` |
| Nom `<SIREN>FEC<AAAAMMJJ>` | LPF A47 A-1 | `fecFileName` | `fec.test.ts`, `api.test.ts` |
| Dates AAAAMMJJ, montants à virgule décimale | BOI-CF-IOR-60-40-20 | `toFecDate`, `formatDecimalComma` | `fec.test.ts` |
| Ordre chronologique de validation | LPF A47 A-1 | Tri par `seq` | `controlerFec` |
| Encodage admis | BOI-CF-IOR-60-40-20 | `encodeLatin9` (ISO 8859-15) ou UTF-8 | `fec.test.ts` |
| Contrôle préalable | Bonne pratique (Test Compta Demat) | `controlerFec` | `fec.test.ts` |

## 3. Facturation

| Exigence | Fondement | Implémentation | Test |
|---|---|---|---|
| Mentions obligatoires | CGI ann. II art. 242 nonies A | `controlerMentions` (bloquant à l'émission) | `facture.test.ts` |
| Numérotation chronologique et continue | CGI ann. II art. 242 nonies A I-2° | Table `facture_sequences`, refus d'une date antérieure à la dernière émise | `api.test.ts` « refuse une date d'émission antérieure… » |
| SIREN du client, catégorie d'opération, option débits | Réforme e-invoicing (ord. 2021-1190, décret 2022-1299) | `controlerMentions`, champs `categorie`, `tvaSurDebits` | `api.test.ts` « exige le SIREN… » |
| Pénalités de retard et indemnité de 40 € | C. com. L441-10, D441-5 | `mentionsLegales` | `facture.test.ts` |
| Délai de paiement ≤ 60 jours | C. com. L441-10 | `echeance` | `facture.test.ts` |
| Inaltérabilité d'une facture émise | CGI art. 289 | Trigger `trg_facture_emise_*`, empreinte SHA-256 | `api.test.ts` |
| Rectification par avoir référencé | CGI art. 272 | `/avoir`, `factureOrigine`, contrôle `AVOIR` | `api.test.ts` |
| Format électronique structuré | Norme EN 16931 | `generateFacturX` (CII, profil EN 16931) | `facture.test.ts` |
| Franchise en base | CGI art. 293 B | Mention automatique, taux 0 | `facture.ts` |

## 4. RGPD

| Exigence | Article | Implémentation | Test |
|---|---|---|---|
| Licéité : base légale par traitement | 6 | `REGISTRE_PAR_DEFAUT[].baseLegale` | `rgpd.test.ts` |
| Registre des traitements | 30 | Table `registre_traitements`, écran Registre | `api.test.ts` « registre » |
| Sous-traitance (cabinet ↔ clients) | 28 | Rôle `sous_traitant` dans le registre | — |
| Minimisation | 5.1.c | Masquage des coordonnées selon le profil, IBAN masqué | `api.test.ts` « masquées pour le lecteur » |
| Limitation de la conservation | 5.1.e | `REGLES_CONSERVATION`, `RgpdService.purger`, purge quotidienne | `api.test.ts` « purge » |
| Information des personnes | 13, 14 | Page `/confidentialite` | — |
| Délai de réponse : 1 mois + 2 | 12.3 | `delaiReponse`, prolongation | `rgpd.test.ts` |
| Vérification d'identité | 12.6 | Traitement bloqué tant que l'identité n'est pas vérifiée | `api.test.ts` |
| Droit d'accès et portabilité | 15, 20 | `exportPersonne` (JSON structuré) | `api.test.ts` « demande d'accès » |
| Effacement et exception d'obligation légale | 17.1, 17.3.b | `analyserEffacement`, `executerEffacement` | `rgpd.test.ts`, `api.test.ts` |
| Limitation du traitement | 18 | `tiers.restricted`, coordonnées non exposées | `api.test.ts` |
| Retrait du consentement, opposition | 7.3, 21 | Enregistrement d'un retrait horodaté | — |
| Preuve du consentement | 7.1 | Table `consentements` (historique) | — |
| Protection dès la conception | 25 | RBAC, cloisonnement, chiffrement par défaut | `api.test.ts` |
| Sécurité du traitement | 32 | Voir SECURITY.md | `api.test.ts` |
| Notification de violation sous 72 h | 33 | `evaluerViolation`, `echeanceNotification` | `rgpd.test.ts`, `api.test.ts` |
| Information des personnes en cas de risque élevé | 34 | `informationPersonnes` | `rgpd.test.ts` |
| Documentation des violations | 33.5 | Table `violations` | `api.test.ts` |
| Analyse d'impact | 35 | Indicateur `aipdRequise` (paie/NIR, LCB-FT) | — |
| Aucun traceur, aucun transfert vers des tiers | 44 et s. ; loi I&L art. 82 | Aucune ressource externe (polices système, CSP `self`), cookie de session seul | En-têtes testés |

## 5. Sécurité (référentiels CNIL)

| Exigence | Référence | Implémentation |
|---|---|---|
| Mots de passe : 12 caractères et 4 types | Délibération CNIL 2022-100 | `checkPassword` |
| Temporisation après échecs | Délibération CNIL 2022-100 | 5 échecs → verrouillage de 15 min |
| Stockage des mots de passe | CNIL / ANSSI | scrypt N=2^15, sel aléatoire, comparaison à temps constant |
| Authentification forte | Recommandation CNIL et ANSSI | TOTP RFC 6238, rotation de session |
| Journalisation des accès | Recommandation CNIL (6 mois à 1 an) | `access_log` purgé à 12 mois ; `audit_log` chaîné, 10 ans |
| Chiffrement des données sensibles | Art. 32.1.a | AES-256-GCM, clés dérivées par HKDF |
