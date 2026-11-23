# MZOUTI Uptime — patch plans, paiements et incidents

## Contenu
- Quotas serveur par forfait : Free 5, Starter 20, Pro 50, Business 150.
- Fréquence minimale : Free 5 min ; forfaits payants 1 min.
- Historique affiché selon le forfait : 7 / 30 / 90 / 365 jours.
- Les moniteurs existants ne sont jamais supprimés lors d'une expiration ou d'un changement de forfait. Le serveur bloque uniquement les nouvelles créations au-delà du quota.
- Demandes de paiement NatCash et Meru avec référence, montant, devise et URL HTTPS facultative de preuve.
- Validation manuelle côté serveur ; aucune activation basée sur une réponse du navigateur.
- Historique d'incidents ouvert/résolu conservé dans une nouvelle table.
- Uptime calculé par durée couverte entre les contrôles enregistrés, plutôt que par simple ratio du nombre de checks.
- Vérification IPv6 publique plus restrictive et suppression de l'ancienne limite silencieuse de 200 moniteurs dans le robot planifié.

## Valeurs provisoires des forfaits
Les quotas et durées sont des valeurs initiales de configuration, pas une grille commerciale confirmée :
| Forfait | Moniteurs | Historique | Fréquence minimale |
|---|---:|---:|---:|
| Free | 5 | 7 jours | 5 min |
| Starter | 20 | 30 jours | 1 min |
| Pro | 50 | 90 jours | 1 min |
| Business | 150 | 365 jours | 1 min |

Aucun prix n'est imposé dans le code. Le client saisit le montant réellement envoyé et l'administrateur vérifie le montant, le compte destinataire et la référence avant d'approuver.

## Destinataires affichés
- NatCash : Mompremier Marc — +50941131299
- Meru Tag : $mzouti
- Support : marcododji284@gmail.com

Les intégrations automatiques NatCash/Meru ne sont pas prétendues : les demandes sont manuelles en attendant les documentations/API officielles.

## Installation obligatoire
1. Dans Supabase SQL Editor, exécuter le nouveau fichier `supabase/migrations/20261122000000_plans_payments_incidents.sql`. Les deux anciennes migrations doivent déjà avoir été appliquées.
2. Dans Render, conserver les variables existantes et vérifier que `SUPABASE_SERVICE_ROLE_KEY` et `CRON_SECRET` sont bien configurées côté serveur.
3. Ajouter `ADMIN_USER_IDS` avec l'UUID Supabase de chaque administrateur, séparés par des virgules. Ne pas mettre une adresse email. L'UUID se trouve dans Supabase > Authentication > Users.
4. Ajouter `SUPPORT_EMAIL=marcododji284@gmail.com` (facultatif : c'est déjà la valeur par défaut).
5. Déployer le code. Ne pas exécuter de migration automatiquement depuis l'application.

## Traitement des paiements
- L'utilisateur effectue le transfert vers le destinataire affiché.
- Il envoie le formulaire avec forfait, période, montant, devise et référence de transaction.
- La demande reste `pending` ; le forfait n'est pas activé.
- Un administrateur connecté dont l'UUID figure dans `ADMIN_USER_IDS` vérifie réellement le paiement, puis appelle `POST /api/admin/payment-requests/:id/review` avec son Bearer token et `{"status":"approved"}` ou `{"status":"rejected","note":"..."}`.
- L'approbation passe par une fonction SQL transactionnelle accessible uniquement à `service_role`, qui met à jour la demande et l'abonnement ensemble.
- `GET /api/admin/payment-requests` liste les demandes pour l'administrateur. Il n'y a pas encore de panneau admin graphique dans cette version.

## Sécurité / limites
- Ne jamais exposer `SUPABASE_SERVICE_ROLE_KEY` dans Vite ou dans une variable `VITE_*`.
- Ne jamais demander ni enregistrer un PIN NatCash/Meru.
- Ne jamais approuver un paiement uniquement sur la base d'une capture ou d'une référence non vérifiée.
- Les prix, la politique de remboursement, les alertes email et les API automatiques de paiement restent à définir.
- Le patch ajoute les tables et policies ; il ne touche pas aux moniteurs existants ni aux réglages Cron.
