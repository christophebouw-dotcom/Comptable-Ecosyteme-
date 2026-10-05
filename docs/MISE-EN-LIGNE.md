# Mettre l'application en ligne

Ce guide permet d'installer Compta Écosystème sur un serveur, accessible depuis n'importe où en **HTTPS**, avec **sauvegardes chiffrées quotidiennes**. Comptez environ une heure la première fois et **10 à 25 € par mois** d'hébergement.

> Il n'est pas nécessaire d'être informaticien : il suffit de copier-coller les commandes. Pour un cabinet qui n'a personne pour s'en occuper, un prestataire informatique peut réaliser ces étapes en une demi-journée à partir de ce document.

## Vue d'ensemble

```
Navigateur ──HTTPS──▶ Caddy (certificat automatique) ──▶ Application ──▶ Base SQLite chiffrée
                                                              └──▶ Sauvegardes chiffrées (chaque nuit)
```

Tout tourne dans **Docker**, sur un seul serveur. Le certificat HTTPS (Let's Encrypt) est obtenu et renouvelé automatiquement.

## 1. Choisir un hébergeur (en France ou dans l'UE)

Le RGPD impose d'encadrer l'hébergement des données de vos clients. Choisissez un hébergeur **européen, avec des serveurs en France**, qui propose un **contrat de sous-traitance (art. 28 RGPD)**. Par exemple :

| Hébergeur | Offre adaptée | Ordre de prix |
|---|---|---|
| OVHcloud | VPS « Comfort » (4 Go de mémoire), datacenter de Gravelines ou Roubaix | ~12 €/mois |
| Scaleway | Instance « DEV1-M » ou « PLAY2-S », région Paris | ~10 à 20 €/mois |
| Infomaniak, Ionos, Hetzner | VPS 4 Go, région UE | ~5 à 15 €/mois |

Choisissez le système **Ubuntu 24.04** (ou Debian 12). Activez l'option de **sauvegarde/snapshot** de l'hébergeur si elle existe : c'est une protection de plus.

**Pour les cabinets aux exigences élevées** : il existe des offres qualifiées **SecNumCloud** (ANSSI), par exemple chez OVHcloud, Outscale ou Cloud Temple. L'hébergement de données de santé (**HDS**) n'est **pas** requis pour de la comptabilité.

À faire côté RGPD :
- signez le contrat de sous-traitance de l'hébergeur (souvent dans les conditions générales) ;
- ajoutez l'hébergeur comme sous-traitant dans le **registre** (Centre RGPD → registre, traitements T-01 à T-03) ;
- complétez la page **Confidentialité** (nom du cabinet, DPO, hébergeur).

## 2. Nom de domaine

Il faut une adresse du type `compta.mon-cabinet.fr` :

1. Dans l'espace client de votre registraire (souvent le même que pour votre site web), créez un enregistrement **DNS de type A** :
   - nom : `compta` ;
   - valeur : l'**adresse IP du serveur**, indiquée par l'hébergeur.
2. Patientez de 5 minutes à 1 heure. Pour vérifier, tapez `ping compta.mon-cabinet.fr` : l'adresse IP du serveur doit s'afficher.

## 3. Préparer le serveur

Connectez-vous au serveur. L'hébergeur vous donne l'adresse et le mot de passe ou la clé.
- Sur Mac, ouvrez le Terminal.
- Sous Windows, ouvrez PowerShell.

```bash
ssh root@ADRESSE_IP_DU_SERVEUR
```

Puis copiez-collez ce bloc, qui :
- met à jour le système et active les mises à jour de sécurité automatiques ;
- installe Docker ;
- n'ouvre que les ports nécessaires (SSH, HTTP, HTTPS) :

```bash
apt update && apt -y upgrade
apt -y install unattended-upgrades ufw git fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp && ufw --force enable
```

Sécurité recommandée : utilisez une **clé SSH** plutôt qu'un mot de passe. L'hébergeur l'explique dans sa documentation (« ajouter une clé SSH »).

## 4. Installer l'application

```bash
cd /opt
git clone https://github.com/christophebouw-dotcom/Comptable-Ecosyteme-.git compta
cd compta
```

> Le dépôt est privé ? Créez un jeton d'accès sur GitHub (Settings → Developer settings → Personal access tokens, droit « Contents: read »), puis utilisez `git clone https://VOTRE_JETON@github.com/...`. Vous pouvez aussi copier le dossier depuis votre Mac avec `scp -r`.

Générez la configuration avec **votre** nom de domaine. Node.js n'étant pas nécessaire sur le serveur, la commande passe par Docker :

```bash
docker run --rm -v "$PWD":/app -w /app node:22-alpine node scripts/configurer-production.mjs compta.mon-cabinet.fr
```

La commande crée le fichier `.env` et **affiche la clé maîtresse**.

> ⚠️ **Copiez immédiatement la clé maîtresse dans le gestionnaire de mots de passe du cabinet**, hors du serveur. Elle chiffre les données sensibles (IBAN, NIR, salaires, messages, pièces) **et les sauvegardes**. Sans elle, aucune donnée n'est récupérable, même par nous.

Démarrez l'application. La première construction prend 3 à 5 minutes :

```bash
docker compose up -d --build
```

Créez le compte administrateur. Le mot de passe provisoire s'affiche **une seule fois** :

```bash
docker compose exec app npm run initialiser -- --email vous@mon-cabinet.fr --nom "Prénom Nom"
```

Ouvrez **https://compta.mon-cabinet.fr** : le cadenas HTTPS doit apparaître. Connectez-vous, puis :
1. **Mon compte** : changez le mot de passe et activez la **double authentification**.
2. **Utilisateurs** : créez les comptes des collaborateurs, de l'expert-comptable, du DPO et des clients (profil « Client » : ils accèdent au portail client).
3. **Dossiers clients** : créez vos dossiers. Pour reprendre un dossier existant, importez son FEC dans l'onglet *Clôture & FEC*.

## 5. Sauvegardes

L'application réalise **chaque nuit** une sauvegarde **chiffrée** de la base. Ces sauvegardes sont conservées 30 jours, durée réglable avec `BACKUP_RETENTION_DAYS` dans `.env`.

Commandes utiles :

```bash
docker compose exec app npm run sauvegarde     # sauvegarde immédiate
docker compose exec app npm run sauvegardes    # liste des sauvegardes
```

### Copie hors du serveur (indispensable)

Une sauvegarde restée sur le même serveur ne protège pas contre la perte du serveur. Copiez-la chaque nuit vers un **stockage objet européen**. Les fichiers étant chiffrés, l'hébergeur du stockage ne peut pas les lire.

Exemple avec **rclone** vers Scaleway Object Storage ou OVHcloud Object Storage :

```bash
apt -y install rclone
rclone config   # créer un « remote » nommé "sauvegardes" (type S3, fournisseur Scaleway ou OVHcloud)
```

Ensuite, programmez la copie chaque nuit à 4 h :

```bash
VOLUME=$(docker volume inspect compta_sauvegardes -f '{{ .Mountpoint }}')
( crontab -l 2>/dev/null; echo "0 4 * * * rclone copy $VOLUME sauvegardes:compta-sauvegardes --max-age 48h" ) | crontab -
```

### Restaurer (à tester une fois par trimestre)

Choisissez d'abord un fichier dans la liste donnée par `npm run sauvegardes`, puis :

```bash
docker compose stop app
docker compose run --rm app npm run restaurer -- /app/sauvegardes/compta-AAAAMMJJ-HHMMSS.db.enc --forcer
docker compose start app
```

La restauration vérifie que le fichier n'a pas été altéré et que la base est intègre. Pour restaurer sur un **nouveau serveur** :
1. réinstallez l'application avec la **même clé maîtresse** dans `.env` ;
2. copiez le fichier de sauvegarde dans le volume ;
3. lancez la commande de restauration ci-dessus.

## 6. Mises à jour

```bash
cd /opt/compta
docker compose exec app npm run sauvegarde   # par précaution
git pull
docker compose up -d --build
```

La base de données est migrée automatiquement au démarrage.

## 7. Surveillance

- **État de santé** : l'adresse `https://compta.mon-cabinet.fr/api/health` répond `{"status":"ok"}`. Un service de surveillance peut l'interroger toutes les 5 minutes et vous prévenir par e-mail en cas de panne. Choisissez-en un européen ou auto-hébergé : cette adresse ne transmet aucune donnée personnelle.
- **Journaux techniques** : `docker compose logs --tail 100 app`. Ils ne contiennent ni mot de passe, ni cookie, ni contenu de pièce.
- **Journal d'audit** : menu *Journal d'audit* de l'application. Les sauvegardes y figurent (`systeme.sauvegarde`), ainsi que leurs échecs.

## 8. Lecture des factures par IA (facultatif)

1. Créez une clé sur [console.anthropic.com](https://console.anthropic.com).
2. Ajoutez la ligne `ANTHROPIC_API_KEY=...` dans `.env`, puis lancez `docker compose up -d`.
3. Activez l'IA **dossier par dossier**, dans l'onglet *Mission*, après accord écrit du client (lettre de mission).

## Liste de contrôle avant l'ouverture aux clients

- [ ] HTTPS fonctionne (cadenas), et `http://` redirige vers `https://`
- [ ] Clé maîtresse copiée dans un coffre-fort, **hors du serveur**
- [ ] Double authentification activée pour tous les comptes du cabinet
- [ ] Comptes de démonstration absents (n'exécutez jamais `npm run seed` en production)
- [ ] Copie des sauvegardes hors site programmée, **restauration testée**
- [ ] Contrat de sous-traitance de l'hébergeur signé, registre RGPD et page Confidentialité complétés
- [ ] Lettres de mission mentionnant le portail client (et l'IA si elle est utilisée)
- [ ] Barème de paie et paramètres comptables vérifiés par l'expert-comptable

## En cas de problème

| Symptôme | Solution |
|---|---|
| Le site ne répond pas | `docker compose ps` : les deux services doivent être « Up ». Sinon `docker compose logs app` |
| Erreur de certificat | Vérifiez que le DNS pointe bien vers le serveur et que les ports 80 et 443 sont ouverts, puis consultez `docker compose logs caddy` |
| « PUBLIC_ORIGIN doit être une adresse https:// » | Corrigez `PUBLIC_ORIGIN` dans `.env` (par exemple `https://compta.mon-cabinet.fr`) |
| « Déchiffrement impossible » à la restauration | La clé maîtresse de `.env` n'est pas celle d'origine |
| Disque plein | `docker system prune` supprime les anciennes images ; réduisez `BACKUP_RETENTION_DAYS` |
