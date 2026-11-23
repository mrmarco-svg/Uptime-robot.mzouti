# Mzouti Uptime — Livrables

## Tableau de bord réel
- [x] Créer un site web de monitoring de disponibilité inspiré d’UptimeRobot avec un tableau de bord responsive.
- [x] Ne pas afficher de moniteurs, métriques ou incidents fictifs : le tableau démarre vide et chaque résultat vient de la base et d’un contrôle réseau réel.
- [x] Afficher clairement la marque « by Mzouti - All Right reserved » dans l’interface.
- [x] Protéger l’accès avec Supabase Auth : inscription, connexion, session persistante et déconnexion.

## Contrôles et persistance
- [x] Permettre la création de moniteurs HTTP, PING et PORT avec URL ou hôte, fréquence et premier contrôle immédiat.
- [x] Exécuter les contrôles côté serveur avec timeout, code HTTP, temps de réponse et message d’erreur réel.
- [x] Persister les moniteurs et chaque résultat de contrôle dans Supabase (Postgres) avec historique et suppression en cascade.
- [x] Recalculer l’uptime sur les checks réellement enregistrés et afficher « jamais vérifié » lorsqu’il n’existe encore aucun contrôle.
- [x] Exposer un endpoint de santé et un endpoint de contrôle groupé utilisables par le serveur et l’actualisation du dashboard.
- [x] Exécuter automatiquement côté serveur les contrôles arrivés à échéance toutes les 30 secondes, même sans dashboard ouvert.
- [x] Préparer le callback sécurisé `/api/scheduled/checks` pour les contrôles périodiques après publication.
- [x] Associer chaque moniteur à `auth.uid()` et isoler les données avec les policies RLS Supabase.
- [x] Utiliser la clé `service_role` uniquement côté serveur pour les contrôles automatiques en arrière-plan.

## Interface et navigation
- [x] Fournir une navigation latérale responsive donnant accès à la vue d’ensemble et aux moniteurs.
- [x] Afficher les indicateurs clés : nombre de moniteurs, états opérationnels ou en panne, uptime calculé et temps de réponse moyen.
- [x] Afficher pour chaque moniteur son nom, son URL, son état réel, son uptime, sa réponse et sa dernière vérification.
- [x] Ajouter une recherche textuelle et des filtres par état.
- [x] Garantir une interface professionnelle sur ordinateur, tablette et mobile.

## Actions et détails
- [x] Ajouter un moniteur via un formulaire et déclencher sa première vérification réelle.
- [x] Fournir une vue détaillée avec état actuel, métriques, configuration et historique des contrôles enregistrés.
- [x] Permettre l’actualisation manuelle, l’actualisation périodique du dashboard et la suppression d’un moniteur.
- [x] Afficher un état vide explicite tant qu’aucun moniteur n’a été configuré.


## Plans, paiements et incidents — patch 2026-11-22
- [x] Ajouter des plafonds serveur Free/Starter/Pro/Business et bloquer les nouvelles créations au-delà du quota.
- [x] Conserver les moniteurs existants lors d'une expiration ou d'un downgrade.
- [x] Ajouter les abonnements et les demandes de paiement NatCash/Meru en attente de vérification manuelle.
- [x] Réserver l'approbation des paiements aux UUID administrateurs configurés côté serveur.
- [x] Ajouter un historique persistant des incidents et leur résolution.
- [x] Calculer l'uptime selon la durée couverte par les contrôles.
- [x] Ajouter les notes d'installation et de configuration dans PATCH-NOTES.md.
- [ ] Définir et confirmer les prix officiels mensuels et annuels.
- [ ] Ajouter les documentations/identifiants API NatCash ou Meru pour une éventuelle vérification automatique.
- [ ] Ajouter un panneau graphique d'administration des paiements.
- [ ] Configurer un fournisseur email et les préférences de notifications.
- [ ] Exécuter la migration SQL dans Supabase puis vérifier le déploiement réel.
