# Architecture

```
┌────────────────────────────── Navigateur ──────────────────────────────┐
│  apps/web (React 19)                                                   │
│  • aucune ressource tierce • validations instantanées via @compta/core │
└───────────────┬────────────────────────────────────────────────────────┘
                │ HTTPS · cookie de session __Host-sid · JSON
┌───────────────▼────────────────────────────────────────────────────────┐
│  apps/api (Fastify)                                                    │
│  onRequest : en-têtes de sécurité → limite de débit → CSRF → session   │
│  routes/   : validation Zod → garde RBAC + dossier → service           │
│  services/ : ComptaService · AuditLog · RgpdService                    │
│  security/ : FieldCipher (AES-GCM, HMAC) · scrypt · TOTP · RBAC        │
└───────────────┬────────────────────────────────────────────────────────┘
                │ node:sqlite (WAL, clés étrangères)
┌───────────────▼────────────────────────────────────────────────────────┐
│  SQLite : tables + TRIGGERS d'intégrité (intangibilité, ajout seul)    │
└────────────────────────────────────────────────────────────────────────┘
        ▲
        │ importe
┌───────┴────────────────────────────────────────────────────────────────┐
│  packages/core : domaine pur (PCG, ledger, FEC, TVA, facture, Factur-X,│
│  validateurs, RGPD). Aucune E/S, entièrement testé unitairement.       │
└────────────────────────────────────────────────────────────────────────┘
```

## Cycle de vie d'une écriture

```
saisie (collaborateur) ──► BROUILLARD ──validation (expert)──► VALIDÉE
                              │  modifiable / supprimable        │ numéro continu
                              │                                  │ seq + prev_hash + hash
                              ▼                                  ▼
                          suppression              contre-passation (nouveau brouillard)
                                                                 │
                                    clôture de l'exercice ◄──────┘
                                    • aucun brouillard • balance équilibrée
                                    • chaîne vérifiée • empreinte de clôture
                                    • à-nouveaux validés sur l'exercice suivant
```

L'empreinte d'une écriture est `SHA-256(prev_hash ‖ JSON canonique)`, où le JSON couvre le dossier, l'exercice, le numéro, le journal, la date, le libellé, la pièce, la date de validation et toutes les lignes. La séquence `seq` fixe l'ordre de la chaîne dans le dossier, indépendamment des horodatages.

## Cycle de vie d'une facture

```
BROUILLON ──émission──► ÉMISE ──règlement──► PAYÉE
  │ contrôles des mentions (bloquants)
  │ numéro <préfixe><année>-<000001> (séquence sans trou)
  │ date ≥ dernière facture émise de la série
  │ instantané JSON figé + empreinte SHA-256
  └─► écriture VE en brouillard (411 / 70x / 44571 par taux)
ÉMISE ──► AVOIR (série AV, référence à la facture d'origine)
```

## Effacement RGPD d'une personne

```
demande ─► identité vérifiée ─► inventaire (tiers par index aveugle, consentements, compte)
                                   │
                    analyserEffacement (règles de conservation)
                 ┌─────────────────┴──────────────────┐
     obligation légale en cours            aucune obligation
     (pièces comptables 10 ans)            (contact, prospection, compte)
                 │                                     │
     coordonnées effacées                    suppression / anonymisation
     nom et adresse conservés en limitation (art. 18)
     date d'effacement communiquée
```

## Choix techniques

| Choix | Raison |
|---|---|
| `node:sqlite` | Aucune dépendance native ni serveur : une instance tient dans un fichier, sauvegarde simple. Pour du multi-instances, la couche `Database` isole les accès en vue d'un passage à PostgreSQL. |
| Triggers SQL | Les invariants légaux tiennent même en cas de bug applicatif ou d'accès direct à la base. |
| Centimes entiers | Exactitude comptable ; la répartition par plus fort reste (`allocate`) ne perd aucun centime. |
| TVA calculée par taux sur la base cumulée | Règle EN 16931 BR-CO-17 : pas d'écart d'arrondi ligne à ligne. |
| Domaine partagé front/back | Une seule source de vérité pour les validations ; retour immédiat dans l'interface. |
