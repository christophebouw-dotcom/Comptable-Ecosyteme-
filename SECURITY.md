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
| Fuite de la base de données | IBAN, e-mails, téléphones, noms des demandeurs et secrets TOTP chiffrés (AES-256-GCM) ; recherche par index aveugle HMAC |
| Falsification comptable | Triggers SQL d'intangibilité, chaînage SHA-256 des écritures, empreinte de clôture |
| Effacement des traces | `audit_log` en ajout seul (triggers), chaînage vérifiable |
| Fuite par les journaux | Cookies et en-têtes d'authentification expurgés, pas de corps de requête journalisé, message d'erreur 500 générique |
| Injection SQL | Requêtes paramétrées exclusivement |
| Données invalides | Validation Zod de toutes les entrées, montants en centimes entiers |

## Gestion des clés

- `APP_MASTER_KEY` (32 octets) est obligatoire en production. Deux clés indépendantes en sont dérivées par HKDF-SHA-256 : chiffrement et index aveugle.
- Le format chiffré est versionné (`v1.iv.tag.ct`), ce qui permettra une rotation de clé.
- En développement, une clé locale est générée dans `data/.dev-master-key` (permissions 0600, ignorée par git).

## Recommandations de déploiement

- TLS 1.2 minimum derrière un reverse proxy ; `trustProxy` est activé en production pour que l'adresse IP réelle du client soit prise en compte.
- Hébergement dans l'UE ; contrat de sous-traitance (art. 28) avec l'hébergeur.
- Sauvegardes chiffrées, testées régulièrement, conservées hors site.
- Supervision des événements `auth.verrouillage` et des échecs de vérification de chaîne.
- Tests d'intrusion réguliers.
