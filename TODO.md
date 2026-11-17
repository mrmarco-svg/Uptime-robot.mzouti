# Mzouti Uptime — Livrables

## Tableau de bord réel
- [x] Créer un site web de monitoring de disponibilité inspiré d’UptimeRobot avec un tableau de bord responsive.
- [x] Ne pas afficher de moniteurs, métriques ou incidents fictifs : le tableau démarre vide et chaque résultat vient de la base et d’un contrôle réseau réel.
- [x] Afficher clairement la marque « by Mzouti - All Right reserved » dans l’interface.

## Contrôles et persistance
- [x] Permettre la création de moniteurs HTTP, PING et PORT avec URL ou hôte, fréquence et premier contrôle immédiat.
- [x] Exécuter les contrôles côté serveur avec timeout, code HTTP, temps de réponse et message d’erreur réel.
- [x] Persister les moniteurs et chaque résultat de contrôle dans la base MySQL gérée du projet.
- [x] Recalculer l’uptime sur les checks réellement enregistrés et afficher « jamais vérifié » lorsqu’il n’existe encore aucun contrôle.
- [x] Exposer un endpoint de santé et un endpoint de contrôle groupé utilisables par le serveur et l’actualisation du dashboard.
- [x] Exécuter automatiquement côté serveur les contrôles arrivés à échéance toutes les 30 secondes, même sans dashboard ouvert.
- [x] Préparer le callback sécurisé `/api/scheduled/checks` pour les contrôles périodiques après publication.

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
