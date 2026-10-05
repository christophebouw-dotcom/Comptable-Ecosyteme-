# Sécurité

## Signaler une vulnérabilité

N'ouvrez pas de ticket public. Écrivez à l'équipe de sécurité du cabinet ([adresse à définir]) en décrivant le problème et les étapes de reproduction. Accusé de réception sous 72 heures.

## Modèle de menace

| Menace | Mesures |
|---|---|
| Vol d'identifiants, force brute | scrypt, politique CNIL, verrouillage après 5 échecs, limitation de débit par IP et par compte, TOTP |
| Énumération des comptes | Message d'erreur identique et temps de réponse égalisé (hachage factice) |
| Vol ou fixation de session | Jeton de 256 bits dont seule l'empreinte SHA-256 est stockée ; cookie `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict` ; rotation après le second facteur ; expiration après 30 min d'inactivité et 12 h au maximum ; révocation au changement de mot de passe |
| CSRF | `SameSite=Strict`, corps JSON obligatoire (pré-vol CORS), contrôle de l'en-tête `Origin` |
| XSS | Rendu React échappé, CSP `script-src 'self'`, aucun script tiers |
| Clickjacking | `frame-ancestors 'none'`, `X-Frame-Options: DENY` |
| Accès horizontal à un dossier | Contrôle systématique par `requireDossier` ; un dossier non autorisé renvoie 404 |
| Élévation de privilèges | Matrice RBAC centralisée (`security/rbac.ts`), séparation saisie / validation |
| Fuite de la base de données | IBAN, e-mails, téléphones, noms des demandeurs, secrets TOTP, pièces justificatives, identité, NIR et rémunération des salariés, bulletins de paie et messages du portail chiffrés (AES-256-GCM) ; recherche par index aveugle HMAC |
| Vol d'une sauvegarde | Sauvegardes chiffrées en AES-256-GCM (clé dérivée dédiée), authentifiées : un fichier altéré ou tronqué est refusé à la restauration |
| Accès d'un client à d'autres dossiers | Portail limité aux dossiers affectés (`dossier_access`), routes `portail:*` réservées au profil client, aucune alerte LCB-FT exposée au client (interdiction de divulgation, CMF L561-18) |
| Falsification de la paie | Bulletin validé figé par trigger SQL et empreinte SHA-256 ; suppression impossible avant 5 ans |
| Falsification comptable | Triggers SQL d'intangibilité, chaînage SHA-256 des écritures, empreinte de clôture |
| Effacement des traces | `audit_log` en ajout seul (triggers), chaînage vérifiable |
| Fuite par les journaux | Cookies et en-têtes d'authentification expurgés, pas de corps de requête journalisé, message d'erreur 500 générique |
| Injection SQL | Requêtes paramétrées exclusivement |
| Données invalides | Validation Zod de toutes les entrées, montants en centimes entiers |

## Gestion des clés

- `APP_MASTER_KEY` (32 octets) est obligatoire en production. Deux clés indépendantes en sont dérivées par HKDF-SHA-256 : chiffrement et index aveugle.
- Le format chiffré est versionné (`v1.iv.tag.ct`), ce qui permettra une rotation de clé.
- Les sauvegardes utilisent une troisième clé dérivée (`compta/sauvegarde/v1`) : la clé maîtresse doit être conservée hors du serveur pour pouvoir restaurer.
- En développement, une clé locale est générée dans `data/.dev-master-key` (permissions 0600, ignorée par git).

## Recommandations de déploiement

- Guide pas à pas : [docs/MISE-EN-LIGNE.md](docs/MISE-EN-LIGNE.md) (`docker-compose.yml` + Caddy, HTTPS automatique).
- TLS 1.2 minimum derrière un reverse proxy ; `trustProxy` est activé en production pour que l'adresse IP réelle du client soit prise en compte. Le serveur refuse de démarrer si `PUBLIC_ORIGIN` n'est pas en `https://`.
- Conteneur durci : système de fichiers en lecture seule, utilisateur non privilégié, aucune capacité Linux, `no-new-privileges`.
- Hébergement dans l'UE ; contrat de sous-traitance (art. 28) avec l'hébergeur.
- Sauvegardes chiffrées quotidiennes (`BACKUP_DIR`, rotation `BACKUP_RETENTION_DAYS`), copiées hors site, restauration testée chaque trimestre (`npm run restaurer`).
- Supervision des événements `auth.verrouillage` et des échecs de vérification de chaîne.
- Tests d'intrusion réguliers.
