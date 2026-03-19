---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
status: 'complete'
completedAt: '2026-03-19'
inputDocuments: ['prd.md', 'architecture.md']
---

# Diva - Epic Breakdown

## Overview

Ce document fournit le decoupage complet en epics et stories pour Diva, decomposant les exigences du PRD et de l'Architecture en stories implementables.

## Requirements Inventory

### Functional Requirements

- FR1: L'utilisateur peut parler a Diva en langage naturel sans syntaxe specifique et etre compris (intention implicite)
- FR2: Diva maintient le contexte conversationnel sur les 5-10 derniers echanges et comprend les references anaphoriques
- FR3: Diva connait son etat interne en temps reel et peut repondre aux questions sur cet etat
- FR4: Diva reprend naturellement une conversation interrompue quand l'utilisateur revient apres une pause
- FR5: Diva memorise les corrections de l'utilisateur et ne repete pas la meme erreur
- FR6: Diva demande une clarification basee sur son historique d'erreurs quand elle detecte une ambiguite recurrente
- FR7: Diva produit des fillers contextuels pendant le traitement qui annoncent l'action en cours
- FR8: Diva commence a repondre vocalement des la premiere phrase generee (streaming TTS)
- FR9: Diva identifie chaque membre de la famille par sa voix et adapte automatiquement sa personnalite, ton, vocabulaire et permissions
- FR10: Diva gere 5 types de personas (adulte, enfant, personne agee, alzheimer, invite) avec des regles specifiques
- FR11: Diva reconnait les visiteurs recurrents (familier) et les accueille par leur nom avec un niveau d'acces intermediaire
- FR12: Diva applique automatiquement le filtre de contenu adapte a l'age quand un enfant ou ami d'enfant est detecte
- FR13: Le proprietaire peut activer un mode invite qui neutralise toutes les informations personnelles
- FR14: Diva accueille une nouvelle voix avec une presentation chaleureuse et une conversation naturelle avant tout processus technique
- FR15: Diva enregistre progressivement l'empreinte vocale pendant une conversation naturelle sans demander de repeter des phrases techniques
- FR16: Diva explique de maniere transparente ce qu'elle va stocker et demande le consentement vocal explicite
- FR17: Un proche peut pre-configurer le profil d'un utilisateur avant la premiere rencontre (warm start)
- FR18: Diva revele ses capacites une par une de maniere contextuelle sur la premiere semaine (decouverte guidee)
- FR19: Diva se souvient des conversations passees et y fait reference naturellement
- FR20: Diva memorise les preferences, gouts, habitudes et informations personnelles de chaque utilisateur
- FR21: Diva detecte les dates importantes mentionnees une seule fois et les rappelle automatiquement
- FR22: Diva accueille les membres detectes par les capteurs de presence avec un message personnalise
- FR23: Diva delivre un briefing matinal fractionne en respectant un budget attentionnel configurable
- FR24: Diva fractionne ses messages proactifs et attend la reponse avant de continuer
- FR25: Diva detecte les signaux de saturation et reduit automatiquement son initiative
- FR26: L'utilisateur peut activer 3 niveaux de silence : "pas maintenant", "soiree tranquille", "silence total"
- FR27: Diva classifie chaque donnee en 3 niveaux de confidentialite : rouge, orange, vert
- FR28: Diva refuse de reveler aux parents le contenu des conversations privees des enfants
- FR29: Diva recueille le consentement explicite de la personne surveillee ou de son aidant legal
- FR30: L'utilisateur peut demander vocalement la suppression complete de toutes ses donnees
- FR31: L'utilisateur peut demander l'export complet de ses donnees sous forme consultable
- FR32: Diva applique automatiquement une politique de retention par type de donnee
- FR33: Un watchdog monitore tous les services et tente un redemarrage automatique en cas de crash
- FR34: Diva informe l'utilisateur quand elle detecte une degradation de ses capacites
- FR35: Diva fournit des instructions de depannage adaptees au profil technique de l'utilisateur
- FR36: Diva envoie une notification au contact designe quand elle ne peut plus fonctionner normalement
- FR37: Diva bascule automatiquement sur un LLM local quand l'API cloud est indisponible
- FR38: Diva continue de fonctionner en mode hors-ligne
- FR39: Diva cache localement les donnees essentielles et les utilise en cas de perte reseau
- FR40: Diva dispose d'un repertoire de musique locale de secours
- FR41: Diva applique 3 niveaux d'autorisation vocale : ouvert, protege, critique
- FR42: Tous les services internes sont accessibles uniquement en localhost
- FR43: Diva logue chaque commande sensible dans un journal d'audit non-modifiable
- FR44: Diva effectue un backup automatique chiffre quotidien avec rotation sur 30 jours
- FR45: Diva applique une suppression de bruit adaptative avant la transcription vocale
- FR46: Diva annule l'echo de sa propre sortie audio pour permettre l'interaction pendant la musique
- FR47: Diva deploie les mises a jour en blue-green avec rollback automatique en < 30 secondes
- FR48: Diva migre automatiquement les schemas de donnees via des scripts versionnees
- FR49: Les mises a jour suivent un canal beta puis stable avec 2 semaines de validation
- FR50: Diva remonte des metriques de qualite conversationnelle consultables a distance
- FR51: Un mode replay retrace le pipeline complet d'une interaction pour le debug a distance
- FR52: Chaque interaction est tracee avec un identifiant de correlation unique
- FR53: Diva monitore et alerte sur la temperature, l'espace disque et la consommation RAM
- FR54: Diva protege l'integrite des donnees en cas de coupure de courant par des ecritures atomiques
- FR55: Diva monitore la consommation de tokens API par foyer et par persona et alerte sur le budget

### NonFunctional Requirements

- NFR-PERF-1: Latence reponse locale < 2 secondes bout-en-bout
- NFR-PERF-2: Latence reponse Claude API < 5 secondes bout-en-bout, premiere phrase < 2 secondes
- NFR-PERF-3: Latence mode degrade (Qwen local) < 4 secondes bout-en-bout
- NFR-PERF-4: Transcription STT < 500ms pour une phrase de 10 mots sur NPU
- NFR-PERF-5: Synthese TTS RTF < 0.5 sur NPU
- NFR-PERF-6: Cache pre-calcul reponse < 500ms
- NFR-PERF-7: 1 requete vocale a la fois avec file d'attente, proactif cede la priorite
- NFR-SEC-1: Chiffrement au repos AES-256 donnees sante, LUKS volume complet
- NFR-SEC-2: Chiffrement en transit TLS 1.3 toutes communications externes
- NFR-SEC-3: Authentification vocale WeSpeaker faux positifs < 2%
- NFR-SEC-4: Dashboard mot de passe + option 2FA TOTP, session 30 min
- NFR-SEC-5: SSH cle publique uniquement, port non-standard
- NFR-SEC-6: Audit journal non-modifiable, retention 1 an
- NFR-SEC-7: Backup chiffre GPG/age, quotidien, rotation 30 jours
- NFR-SEC-8: Cles API stockage chiffre, jamais en clair
- NFR-SEC-9: Tests penetration avant lancement puis annuellement
- NFR-REL-1: Uptime 99.5% general, 99.9% module medical
- NFR-REL-2: MTTR < 60 secondes (watchdog auto)
- NFR-REL-3: Rollback < 30 secondes
- NFR-REL-4: Zero perte donnees, SQLite WAL + backup, RPO < 24h
- NFR-REL-5: Mode degrade sans internet et sans Claude API
- NFR-REL-6: Coupure courant aucune corruption, redemarrage < 90s
- NFR-SCALE-1: Fleet management 1000 devices simultanes
- NFR-SCALE-2: Gestion donnees 5 ans avec purge et consolidation
- NFR-SCALE-3: 20 personas par device
- NFR-SCALE-4: Architecture decouplée du hardware
- NFR-ACC-1: Tolerance accents, francais non-natif, troubles legers parole
- NFR-ACC-2: Volume, debit, frequences ajustables par persona
- NFR-ACC-3: Dashboard RGAA niveau AA
- NFR-ACC-4: Zero prerequis technique, tout est vocal
- NFR-MAINT-1: Correlation ID unique par interaction a travers tous les services
- NFR-MAINT-2: Metriques consultables a distance
- NFR-MAINT-3: Documentation code avec references features
- NFR-MAINT-4: Mode replay debug a distance
- NFR-MAINT-5: Blue-green + rollback + canal beta/stable + migrations versionnees

### Additional Requirements

_Depuis le document d'Architecture :_

- AR1: Watchdog Go comme process separe (binaire statique, survit au crash Node)
- AR2: Session Manager comme nouveau composant central (sliding window, etat enrichi, correlation ID)
- AR3: Auth Gate integre dans le pipeline AVANT l'intent router
- AR4: Audio preprocessing C/C++ (RNNoise suppression bruit + AEC annulation echo via child_process)
- AR5: LLM Router (Claude → cloud alternatif → Qwen local) avec detection auto et basculement
- AR6: 3 domaines de donnees cloisonnes (diva.db compagnon, diva-medical.db sante chiffre AES-256, audit.db append-only)
- AR7: Migration personas JSON → SQLite pour transactions atomiques
- AR8: Blue-green deployment via symlink atomique + restart systemd
- AR9: Cache RAM (Map TypeScript) avec TTL configurable pour meteo/calendrier/recherches
- AR10: Communication fleet via MQTT (telemetrie) + HTTPS REST (operations) via WireGuard VPN
- AR11: Fine-tuning Piper TTS avec dataset SIWIS pour voix naturelle francaise
- AR12: Streaming TTS phrase par phrase (decoupage reponse Claude en phrases, TTS incremental)
- AR13: Anaphora resolver dans l'intent router (lastIntent/lastEntity pour "le suivant", "la meme chose")
- AR14: Context injector pour enrichir chaque appel Claude avec l'etat du systeme
- AR15: Data classifier pour classification automatique rouge/orange/vert de chaque donnee
- AR16: Visitor classifier pour detection familier recurrent vs invite ponctuel vs inconnu
- AR17: Degradation announcer pour communication vocale des pannes a l'utilisateur
- AR18: Offline queue pour stockage et rejeu des actions en attente au retour du reseau
- AR19: Correction tracker pour memoire des corrections utilisateur dans Mem0

### UX Design Requirements

_Aucun document UX Design disponible._

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR1 | Epic 2 | Langage naturel sans syntaxe |
| FR2 | Epic 2 | Contexte conversationnel sliding window |
| FR3 | Epic 2 | Connaissance etat interne |
| FR4 | Epic 2 | Reprise conversation apres interruption |
| FR5 | Epic 8 | Memoire de correction |
| FR6 | Epic 8 | Clarification basee sur historique erreurs |
| FR7 | Epic 2 | Fillers contextuels |
| FR8 | Epic 2 | Streaming TTS phrase par phrase |
| FR9 | Epic 7 | Identification vocale et adaptation persona |
| FR10 | Epic 7 | 5 types de personas |
| FR11 | Epic 7 | Visiteurs recurrents (familier) |
| FR12 | Epic 7 | Filtre contenu adapte a l'age |
| FR13 | Epic 7 | Mode invite |
| FR14 | Epic 6 | Accueil chaleureux nouvelle voix |
| FR15 | Epic 6 | Enregistrement vocal progressif |
| FR16 | Epic 6 | Explication transparente et consentement |
| FR17 | Epic 6 | Warm start par le proche |
| FR18 | Epic 6 | Decouverte guidee premiere semaine |
| FR19 | Epic 8 | Souvenir conversations passees |
| FR20 | Epic 8 | Memorisation preferences et gouts |
| FR21 | Epic 8 | Detection dates importantes |
| FR22 | Epic 9 | Accueil capteurs de presence |
| FR23 | Epic 9 | Briefing matinal fractionne |
| FR24 | Epic 9 | Messages proactifs fractionnes |
| FR25 | Epic 9 | Detection saturation |
| FR26 | Epic 9 | 3 niveaux de silence |
| FR27 | Epic 5 | Classification donnees rouge/orange/vert |
| FR28 | Epic 5 | Refus moucharder enfants |
| FR29 | Epic 5 | Consentement surveillance |
| FR30 | Epic 5 | Droit a l'oubli vocal |
| FR31 | Epic 5 | Export donnees |
| FR32 | Epic 5 | Politique retention automatique |
| FR33 | Epic 1 | Watchdog services |
| FR34 | Epic 10 | Information degradation |
| FR35 | Epic 10 | Instructions depannage adaptees |
| FR36 | Epic 10 | Notification contact en cas de panne |
| FR37 | Epic 10 | Fallback LLM local |
| FR38 | Epic 10 | Mode hors-ligne |
| FR39 | Epic 10 | Cache donnees essentielles |
| FR40 | Epic 10 | Musique locale de secours |
| FR41 | Epic 4 | 3 niveaux autorisation vocale |
| FR42 | Epic 1 | Services localhost uniquement |
| FR43 | Epic 4 | Journal audit non-modifiable |
| FR44 | Epic 4 | Backup chiffre quotidien |
| FR45 | Epic 3 | Suppression bruit RNNoise |
| FR46 | Epic 3 | Annulation echo AEC |
| FR47 | Epic 1 | Blue-green rollback |
| FR48 | Epic 1 | Migration schemas versionnee |
| FR49 | Epic 11 | Canal beta/stable |
| FR50 | Epic 11 | Metriques qualite a distance |
| FR51 | Epic 11 | Mode replay debug |
| FR52 | Epic 1 | Correlation ID |
| FR53 | Epic 1 | Monitoring temperature/disque/RAM |
| FR54 | Epic 1 | Ecritures atomiques coupure courant |
| FR55 | Epic 11 | Monitoring couts API |

**Couverture : 55/55 FR — 100%**

## Epic List

### Epic 1: Fondations & Observabilite
Diva devient monitorable, resiliente et deploiable de maniere fiable — le socle technique indispensable avant tout nouveau developpement.
**FRs couvertes:** FR33, FR42, FR47, FR48, FR52, FR53, FR54

### Epic 2: Conversation Naturelle & Contexte
L'utilisateur peut avoir une vraie conversation avec Diva — elle se souvient de ce qui vient d'etre dit, comprend "et demain ?", connait son propre etat, et repond en streaming sans delai.
**FRs couvertes:** FR1, FR2, FR3, FR4, FR7, FR8

### Epic 3: Qualite Audio en Conditions Reelles
Diva fonctionne correctement meme quand la tele est allumee, le lave-vaisselle tourne, ou qu'elle joue de la musique — l'utilisateur est compris du premier coup.
**FRs couvertes:** FR45, FR46

### Epic 4: Securite Vocale & Protection des Donnees
Seuls les membres autorises peuvent controler la maison, les donnees sont chiffrees et sauvegardees, et chaque action sensible est tracee.
**FRs couvertes:** FR41, FR43, FR44

### Epic 5: Ethique, Confidentialite & RGPD
Diva respecte la vie privee de chaque membre, classifie les donnees par sensibilite, demande le consentement, et permet le droit a l'oubli et l'export — conformite RGPD complete.
**FRs couvertes:** FR27, FR28, FR29, FR30, FR31, FR32

### Epic 6: Onboarding Chaleureux & Premiere Impression
Un nouvel utilisateur est accueilli chaleureusement, son profil vocal est capture naturellement, et il decouvre Diva progressivement sur une semaine — zero friction, zero peur.
**FRs couvertes:** FR14, FR15, FR16, FR17, FR18

### Epic 7: Personas Etendus & Gestion des Visiteurs
Diva reconnait les visiteurs reguliers, gere les invites avec discretion, et adapte automatiquement le filtre contenu pour les enfants d'amis — chaque personne a le bon niveau d'acces.
**FRs couvertes:** FR9, FR10, FR11, FR12, FR13

### Epic 8: Memoire & Apprentissage des Preferences
Diva se souvient des conversations, apprend des corrections, et ne repete jamais la meme erreur — elle connait les gouts, les dates importantes, et fait des callbacks pertinents.
**FRs couvertes:** FR5, FR6, FR19, FR20, FR21

### Epic 9: Proactivite Intelligente & Anti-Surcharge
Diva accueille les membres quand ils rentrent, delivre un briefing fractionne, detecte l'agacement, et propose 3 niveaux de silence — proactive sans etre envahissante.
**FRs couvertes:** FR22, FR23, FR24, FR25, FR26

### Epic 10: Resilience & Mode Degrade
Diva continue de fonctionner quand internet tombe, bascule sur le LLM local, utilise la musique et les donnees en cache, et previent l'utilisateur de ses limitations — elle ne meurt jamais.
**FRs couvertes:** FR34, FR35, FR36, FR37, FR38, FR39, FR40

### Epic 11: Monitoring, Metriques & Fleet MVP
Les metriques de qualite conversationnelle sont collectees, consultables a distance, et un mode replay permet de debugger les problemes chez les utilisateurs — pret pour le support commercial.
**FRs couvertes:** FR49, FR50, FR51, FR55

---

## Epic 1: Fondations & Observabilite

Diva devient monitorable, resiliente et deploiable de maniere fiable — le socle technique indispensable avant tout nouveau developpement.

### Story 1.1: Watchdog Go — Surveillance des services

As a operateur Diva,
I want un watchdog independant qui surveille tous les services et les redemarre automatiquement en cas de crash,
So that Diva maintient un uptime de 99.5% sans intervention humaine.

**Acceptance Criteria:**

**Given** les 9 services Diva sont en cours d'execution
**When** un service crash ou ne repond plus sur son port pendant 30 secondes
**Then** le watchdog tente un redemarrage automatique du service
**And** si le redemarrage echoue apres 3 tentatives, le watchdog logue l'echec et envoie une alerte

**Given** le process Node.js principal (diva-server) crash
**When** le watchdog detecte l'absence du process
**Then** le watchdog survit au crash (binaire Go statique) et redemarre le service
**And** le MTTR est < 60 secondes

### Story 1.2: Correlation ID et logs structures

As a developpeur/support,
I want chaque interaction tracee avec un identifiant de correlation unique a travers tous les services et des logs JSON structures,
So that je peux retracer le pipeline complet d'une interaction pour le debug.

**Acceptance Criteria:**

**Given** un utilisateur declenche le wake word
**When** le diva-server cree une nouvelle interaction
**Then** un UUID v4 est genere comme correlation ID
**And** le correlation ID est propage via le header X-Correlation-Id a chaque appel inter-service

**Given** un service traite une requete avec un correlation ID
**When** le service logue un evenement
**Then** le log est au format JSON structure avec ts, level, service, correlationId, msg, data
**And** les fichiers de log sont en rotation automatique (logrotate)

### Story 1.3: Systeme de migration de base de donnees

As a developpeur,
I want un systeme de migration versionnee qui execute automatiquement les scripts SQL au demarrage,
So that les schemas de donnees evoluent proprement sans perte de donnees.

**Acceptance Criteria:**

**Given** des scripts de migration dans data/migrations/ (001-init.sql, 002-xxx.sql...)
**When** diva-server demarre
**Then** le systeme detecte les migrations non executees et les applique sequentiellement
**And** la version courante est tracee dans la base de donnees

**Given** une migration echoue
**When** le systeme detecte l'erreur
**Then** la migration est annulee (rollback), le service demarre avec le schema precedent
**And** l'erreur est loguee avec le correlation ID

### Story 1.4: Cloisonnement des bases de donnees

As a architecte securite,
I want 3 bases SQLite cloisonnees (diva.db, diva-medical.db, audit.db) avec chiffrement AES-256 pour les donnees de sante,
So that les donnees de sante sont isolees et protegees conformement aux exigences RGPD et MDR.

**Acceptance Criteria:**

**Given** le systeme demarre
**When** les bases de donnees sont initialisees
**Then** 3 fichiers SQLite separes sont crees : diva.db (compagnon), diva-medical.db (sante), audit.db (audit)
**And** diva-medical.db est chiffre au niveau applicatif avec AES-256
**And** audit.db est en mode append-only

**Given** un module ecrit des donnees de sante
**When** les donnees concernent wellness, medicaments, chute ou comportement
**Then** les donnees sont ecrites UNIQUEMENT dans diva-medical.db, jamais dans diva.db

### Story 1.5: Securisation des services localhost

As a utilisateur,
I want tous les services internes accessibles uniquement en localhost,
So that aucun acces externe non autorise n'est possible sur les services Diva.

**Acceptance Criteria:**

**Given** les 9 services Diva sont en cours d'execution
**When** une requete arrive depuis une IP externe (non localhost)
**Then** la requete est rejetee par le firewall (iptables/nftables)
**And** seul le dashboard (port 80/443) est accessible sur le reseau local, protege par mot de passe

### Story 1.6: Deploiement blue-green avec rollback

As a operateur Diva,
I want un deploiement sans interruption avec rollback automatique si la mise a jour echoue,
So that les mises a jour ne cassent jamais Diva chez les utilisateurs.

**Acceptance Criteria:**

**Given** une nouvelle version est disponible
**When** le script deploy.sh est execute
**Then** la nouvelle version est compilee dans /opt/diva-next pendant que l'ancienne tourne
**And** la bascule se fait par symlink atomique + restart systemd pendant une periode de silence

**Given** la nouvelle version est deployee
**When** le health check echoue dans les 60 secondes
**Then** le systeme rollback automatiquement vers la version precedente en < 30 secondes
**And** l'echec est logue et une alerte est envoyee

### Story 1.7: Monitoring hardware (temperature, disque, RAM)

As a operateur Diva,
I want Diva monitore sa temperature, son espace disque et sa consommation RAM et alerte en cas de depassement,
So that les problemes hardware sont detectes avant de causer des pannes.

**Acceptance Criteria:**

**Given** Diva fonctionne normalement
**When** la temperature du SoC depasse 75°C
**Then** une alerte est loguee et les taches non-critiques sont reduites

**Given** l'espace disque disponible passe sous 20%
**When** le monitoring detecte le seuil
**Then** une alerte est loguee et les logs anciens sont purges automatiquement

**Given** la RAM utilisee depasse 85% du total
**When** le monitoring detecte le seuil
**Then** une alerte est loguee avec le detail par service

### Story 1.8: Ecritures atomiques et protection coupure courant

As a utilisateur,
I want que les donnees ne soient jamais corrompues en cas de coupure de courant,
So that Diva redemarre proprement sans perte de donnees.

**Acceptance Criteria:**

**Given** Diva ecrit des donnees dans SQLite
**When** une coupure de courant survient pendant l'ecriture
**Then** SQLite WAL mode garantit zero corruption de donnees

**Given** Diva ecrit des fichiers JSON (personas, config)
**When** le systeme ecrit un fichier
**Then** l'ecriture passe par un fichier temporaire + rename atomique
**And** au redemarrage, un self-check verifie l'integrite des donnees avant de dire "Bonjour"

---

## Epic 2: Conversation Naturelle & Contexte

L'utilisateur peut avoir une vraie conversation avec Diva — elle se souvient de ce qui vient d'etre dit, comprend "et demain ?", connait son propre etat, et repond en streaming sans delai.

### Story 2.1: Session Manager — Sliding Window conversationnel

As a utilisateur,
I want que Diva se souvienne de ce que je viens de dire dans les dernieres minutes,
So that je peux avoir une vraie conversation naturelle sans repeter le contexte.

**Acceptance Criteria:**

**Given** un utilisateur a une conversation avec Diva
**When** il enchaine plusieurs echanges
**Then** les 10 derniers echanges (user + Diva) sont maintenus en RAM dans une ConversationSession

**Given** une session est active
**When** l'utilisateur ne parle pas pendant 10 minutes
**Then** la session est reinitalisee (nouvelle conversation)

**Given** une session existe pour un persona
**When** un autre persona parle
**Then** une session separee est creee/reprise pour ce persona

### Story 2.2: Context Injector — Etat enrichi dans chaque appel Claude

As a utilisateur,
I want que Diva sache ce qui se passe en ce moment (musique, minuteurs, dernier rappel),
So that je peux poser des questions comme "c'est quoi ce morceau ?" ou "il reste combien de temps ?".

**Acceptance Criteria:**

**Given** une requete est envoyee a Claude API
**When** le context injector prepare le prompt
**Then** il injecte : sliding window + etat systeme (musique en cours, minuteurs actifs, derniere recherche, dernier rappel cree)

**Given** Diva joue "Les copains d'abord" de Brassens
**When** l'utilisateur demande "C'est quoi ce morceau ?"
**Then** Diva repond correctement avec le titre et l'artiste

### Story 2.3: Resolution d'anaphores dans l'Intent Router

As a utilisateur,
I want que Diva comprenne "le suivant", "la meme chose", "encore", "et demain ?",
So that je n'ai pas besoin de reformuler entierement ma demande a chaque fois.

**Acceptance Criteria:**

**Given** l'utilisateur a dit "Mets du Brassens" (lastIntent=music, lastEntity=Brassens)
**When** il dit "Le suivant"
**Then** l'intent router resout l'anaphore et route vers play_music avec action=next

**Given** l'utilisateur a demande la meteo (lastIntent=weather)
**When** il dit "Et demain ?"
**Then** l'intent router injecte le contexte temporel et route vers la bonne action

**Given** aucune session n'est active (lastIntent=null)
**When** l'utilisateur dit "Le suivant"
**Then** Diva demande une clarification : "Le suivant de quoi ?"

### Story 2.4: Reprise de conversation apres interruption

As a utilisateur,
I want que Diva reprenne la ou on en etait apres une interruption courte,
So that je ne perds pas le fil de la conversation quand le telephone sonne.

**Acceptance Criteria:**

**Given** Marie raconte un souvenir a Diva et s'arrete 5 minutes
**When** Marie dit "Ou j'en etais ?"
**Then** Diva utilise le sliding window pour reprendre : "Tu me parlais de ton voyage en Bretagne"

**Given** la session a expire (> 10 min de silence)
**When** l'utilisateur dit "Ou j'en etais ?"
**Then** Diva repond honnetement : "Ca fait un moment, on peut reprendre si tu veux"

### Story 2.5: Fillers contextuels intelligents

As a utilisateur,
I want que Diva m'indique ce qu'elle est en train de faire pendant qu'elle reflechit,
So that le silence n'est pas anxiogene et je sais qu'elle m'a entendu.

**Acceptance Criteria:**

**Given** Diva recoit une requete qui necessite une recherche web
**When** le traitement commence
**Then** le filler dit "Je regarde ca..."

**Given** Diva recoit une requete meteo
**When** le traitement commence
**Then** le filler dit "Voyons le temps..."

**Given** le traitement prend < 1 seconde
**When** la reponse est prete
**Then** aucun filler n'est joue

### Story 2.6: Streaming TTS phrase par phrase

As a utilisateur,
I want entendre la reponse de Diva des la premiere phrase sans attendre la reponse complete,
So that la conversation est fluide et la latence percue est < 2 secondes.

**Acceptance Criteria:**

**Given** Claude API genere une reponse en streaming
**When** la premiere phrase complete est recue
**Then** le TTS la synthetise et la joue immediatement pendant que la suite arrive

**Given** une reponse de 3 phrases
**When** le streaming TTS est actif
**Then** l'utilisateur entend la premiere phrase en < 2 secondes apres sa question
**And** les phrases suivantes s'enchainent sans coupure audible

---

## Epic 3: Qualite Audio en Conditions Reelles

Diva fonctionne correctement meme quand la tele est allumee, le lave-vaisselle tourne, ou qu'elle joue de la musique.

### Story 3.1: Suppression de bruit adaptative (RNNoise)

As a utilisateur,
I want que Diva me comprenne meme quand la tele est allumee ou le lave-vaisselle tourne,
So that je n'ai pas besoin de crier ou d'eteindre les appareils pour parler a Diva.

**Acceptance Criteria:**

**Given** un bruit ambiant est present (TV, electromenager, pluie)
**When** l'utilisateur parle a Diva
**Then** le module RNNoise (C/C++) filtre le bruit avant d'envoyer l'audio au STT NPU
**And** le taux de comprehension du premier coup reste > 85% en conditions bruyantes

**Given** aucun bruit ambiant
**When** l'utilisateur parle normalement
**Then** RNNoise ne degrade pas la qualite audio

**Given** le module RNNoise crash
**When** une requete audio arrive
**Then** l'audio brut est envoye directement au STT (degradation gracieuse)

### Story 3.2: Annulation d'echo (AEC)

As a utilisateur,
I want pouvoir parler a Diva pendant qu'elle joue de la musique,
So that je n'ai pas besoin d'attendre la fin du morceau pour interagir.

**Acceptance Criteria:**

**Given** Diva joue de la musique ou parle via TTS
**When** l'utilisateur dit le wake word ou parle
**Then** le module AEC (C/C++ Speex) soustrait la sortie audio de Diva du signal micro
**And** le STT recoit un signal propre contenant uniquement la voix de l'utilisateur

**Given** le module AEC crash
**When** Diva joue de la musique et l'utilisateur parle
**Then** le systeme coupe brievement la musique pour ecouter (fallback existant)

### Story 3.3: Fine-tuning Piper TTS voix naturelle francaise

As a utilisateur,
I want que la voix de Diva soit naturelle et agreable, pas robotique,
So that j'ai l'impression de parler a quelqu'un de reel.

**Acceptance Criteria:**

**Given** le modele Piper actuel (fr_FR-siwis-medium)
**When** le modele fine-tune avec le dataset SIWIS complet est deploye
**Then** la prosodie est nettement amelioree (intonation variee, pauses naturelles)
**And** un test A/B avec 5 utilisateurs montre une preference > 80% pour la nouvelle voix

**Given** le modele fine-tune est deploye sur le NPU
**When** une synthese TTS est demandee
**Then** le RTF reste < 0.5 (temps reel garanti)

---

## Epic 4: Securite Vocale & Protection des Donnees

Seuls les membres autorises peuvent controler la maison, les donnees sont chiffrees et sauvegardees, et chaque action sensible est tracee.

### Story 4.1: Auth Gate — 3 niveaux d'autorisation vocale

As a utilisateur,
I want que seuls les membres reconnus puissent controler la maison et envoyer des messages,
So that un inconnu ou un invite ne puisse pas ouvrir la porte ou lire mes rappels.

**Acceptance Criteria:**

**Given** une commande de niveau "ouvert" (musique, heure, blague)
**When** n'importe qui la prononce
**Then** la commande est executee sans verification d'identite

**Given** une commande de niveau "protege" (domotique, calendrier, rappels)
**When** une voix non reconnue par WeSpeaker la prononce
**Then** Diva refuse poliment : "Desole, je ne reconnais pas ta voix pour ca"

**Given** une commande de niveau "critique" (envoi message, mode urgence)
**When** une voix reconnue la prononce
**Then** Diva demande une confirmation vocale : "Tu veux bien confirmer ?"
**And** la commande s'execute uniquement apres confirmation

### Story 4.2: Journal d'audit non-modifiable

As a operateur Diva,
I want que chaque commande sensible soit tracee dans un journal non-modifiable,
So that je peux reconstituer ce qui s'est passe en cas d'incident ou d'audit RGPD.

**Acceptance Criteria:**

**Given** une commande de niveau protege ou critique est executee
**When** l'action est completee
**Then** une entree est ajoutee dans audit.db : speakerId, commande, resultat, timestamp, correlationId

**Given** le journal audit.db existe
**When** un process tente de modifier ou supprimer une entree
**Then** l'operation est rejetee (mode append-only)

**Given** le journal a plus de 12 mois d'entrees
**When** la rotation mensuelle s'execute
**Then** les entrees > 12 mois sont archivees dans un fichier chiffre

### Story 4.3: Backup automatique chiffre quotidien

As a utilisateur,
I want que toutes mes donnees soient sauvegardees automatiquement chaque jour,
So that je ne perds jamais mes souvenirs, mes preferences, ni mes donnees de sante.

**Acceptance Criteria:**

**Given** Diva fonctionne depuis plus de 24h depuis le dernier backup
**When** une periode de silence est detectee (nuit, pas d'interaction depuis 30 min)
**Then** un backup complet est cree : diva.db, diva-medical.db, audit.db, personas, config

**Given** le backup est cree
**When** il est ecrit sur le disque
**Then** il est chiffre avec GPG ou age avant ecriture
**And** les backups > 30 jours sont supprimes (rotation)

**Given** une restauration est necessaire
**When** l'operateur lance la commande de restauration
**Then** les donnees sont restaurees en < 10 minutes avec zero perte (RPO < 24h)

---

## Epic 5: Ethique, Confidentialite & RGPD

Diva respecte la vie privee de chaque membre, classifie les donnees par sensibilite, demande le consentement, et permet le droit a l'oubli et l'export.

### Story 5.1: Classification des donnees rouge/orange/vert

As a responsable produit,
I want que chaque donnee soit automatiquement classifiee par niveau de confidentialite,
So that le systeme sait quoi remonter, quoi agreger, et quoi ne jamais partager.

**Acceptance Criteria:**

**Given** Diva stocke une donnee concernant la sante, le danger ou une detresse
**When** le data classifier analyse la donnee
**Then** elle est classifiee ROUGE (remonte toujours)

**Given** Diva stocke une donnee d'activite (temps devoirs, nombre interactions)
**When** le data classifier analyse la donnee
**Then** elle est classifiee ORANGE (agrege et anonymise dans les resumes)

**Given** Diva stocke un secret, une opinion, une emotion du quotidien
**When** le data classifier analyse la donnee
**Then** elle est classifiee VERT (jamais remontee)

### Story 5.2: Protection vie privee des enfants

As a parent,
I want que Diva protege activement la vie privee de mes enfants,
So that mes enfants font confiance a Diva et lui parlent librement.

**Acceptance Criteria:**

**Given** Thomas demande "Qu'est-ce que Lucas t'a raconte aujourd'hui ?"
**When** Diva traite la requete
**Then** Diva refuse : "On a discute, mais c'est entre lui et moi ! Demande-lui directement"

**Given** Lucas dit quelque chose classifie ROUGE (sante, danger)
**When** le data classifier detecte le niveau rouge
**Then** l'information est remontee aux parents malgre le secret — la securite prime

### Story 5.3: Consentement explicite pour la surveillance

As a personne surveillee,
I want etre informee et donner mon accord avant que Diva surveille ma sante,
So that je sais exactement ce que Diva fait et je ne me sens pas espionnee.

**Acceptance Criteria:**

**Given** un persona elderly ou alzheimer est configure avec proactiveCheckins=true
**When** Diva interagit pour la premiere fois avec cette personne
**Then** Diva explique le monitoring et demande : "Tu es d'accord ?"

**Given** la personne refuse
**When** Diva enregistre le refus
**Then** les fonctionnalites de monitoring sante sont desactivees
**And** le fils/aidant est informe du refus

**Given** le consentement est obtenu
**When** il est enregistre
**Then** il est horodate et stocke dans audit.db

### Story 5.4: Droit a l'oubli vocal

As a utilisateur,
I want pouvoir demander vocalement la suppression complete de toutes mes donnees,
So that je peux exercer mon droit RGPD a l'effacement.

**Acceptance Criteria:**

**Given** un utilisateur dit "Diva, oublie-moi"
**When** Diva recoit la commande
**Then** Diva demande une double confirmation : "Tu es sur ? C'est definitif."

**Given** l'utilisateur confirme
**When** le processus de suppression s'execute
**Then** persona, memoires Mem0, journal de vie, gamification, et donnees medicales sont supprimes
**And** l'action est loguee dans audit.db (seul le fait de la suppression)

### Story 5.5: Export complet des donnees personnelles

As a utilisateur,
I want pouvoir demander l'export complet de mes donnees,
So that je peux exercer mon droit RGPD a la portabilite.

**Acceptance Criteria:**

**Given** un utilisateur dit "Diva, qu'est-ce que tu sais sur moi ?"
**When** Diva traite la requete
**Then** Diva genere un resume vocal complet de toutes les informations stockees

**Given** un utilisateur dit "Diva, exporte mes donnees"
**When** l'export est declenche
**Then** un fichier JSON est genere et telechargeable via le dashboard local

### Story 5.6: Politique de retention automatique

As a responsable RGPD,
I want que les donnees soient automatiquement purgees selon leur type apres une duree definie,
So that Diva ne stocke pas de donnees indefiniment.

**Acceptance Criteria:**

**Given** des memoires Mem0 conversationnelles ont plus de 90 jours
**When** le job de retention s'execute (quotidien)
**Then** les memoires > 90 jours sont purgees (preferences et gouts conserves longue duree)

**Given** des logs et metriques ont plus de 12 mois
**When** le job de retention s'execute
**Then** les logs > 12 mois sont archives chiffres puis purges

---

## Epic 6: Onboarding Chaleureux & Premiere Impression

Un nouvel utilisateur est accueilli chaleureusement, son profil vocal est capture naturellement, et il decouvre Diva progressivement.

### Story 6.1: Premiere rencontre chaleureuse

As a nouvel utilisateur,
I want que Diva se presente chaleureusement quand elle entend ma voix pour la premiere fois,
So that je ne suis pas effraye et j'ai envie de continuer a parler.

**Acceptance Criteria:**

**Given** WeSpeaker detecte une voix inconnue
**When** Diva traite la premiere interaction
**Then** Diva se presente : "Oh, bonjour ! Je suis Diva. Comment tu t'appelles ?"
**And** Diva ne lance PAS l'enregistrement vocal technique immediatement

### Story 6.2: Enregistrement vocal progressif et invisible

As a nouvel utilisateur,
I want que Diva retienne ma voix sans me demander de repeter des phrases techniques,
So that l'enregistrement se fait naturellement pendant qu'on fait connaissance.

**Acceptance Criteria:**

**Given** un nouvel utilisateur discute avec Diva
**When** 5 echanges conversationnels ont eu lieu
**Then** WeSpeaker a accumule suffisamment d'echantillons pour creer une empreinte
**And** l'utilisateur n'a jamais ete invite a "repeter cette phrase"

### Story 6.3: Consentement transparent et explication simple

As a nouvel utilisateur,
I want que Diva m'explique ce qu'elle va retenir et me demande mon accord,
So that je donne mon consentement en toute confiance.

**Acceptance Criteria:**

**Given** l'enregistrement vocal est complete
**When** Diva a assez d'echantillons
**Then** Diva explique et demande : "Je vais retenir ta voix pour te reconnaitre. Tu es d'accord ?"

**Given** l'utilisateur refuse
**When** Diva enregistre le refus
**Then** l'empreinte vocale est supprimee, l'utilisateur reste en mode guest

### Story 6.4: Warm start — pre-configuration par le proche

As a installateur/proche,
I want pre-configurer le profil d'un utilisateur avant qu'il rencontre Diva,
So that la premiere impression est magique.

**Acceptance Criteria:**

**Given** Thomas configure le profil de Marie via le dashboard
**When** il saisit prenom, gouts (Dalida), animal (Minou), contacts, medicaments
**Then** les informations sont stockees et pretes pour le warm start

**Given** Marie parle a Diva pour la premiere fois avec un warm start configure
**When** Diva l'accueille
**Then** Diva dit : "Bonjour Marie ! Thomas m'a parle de toi et de Minou !"

### Story 6.5: Decouverte guidee sur la premiere semaine

As a nouvel utilisateur,
I want decouvrir les capacites de Diva progressivement,
So that je ne suis pas submerge de fonctionnalites.

**Acceptance Criteria:**

**Given** un nouveau persona est cree (jour 0)
**When** le premier matin arrive
**Then** Diva montre la meteo : "Bonjour Marie ! Il fait beau, 18 degres"

**Given** c'est le jour 2
**When** l'heure du dejeuner arrive
**Then** Diva propose la musique : "Tu veux un peu de musique ?"

**Given** toutes les capacites principales ont ete revelees (~7 jours)
**When** le flag decouverte est marque
**Then** Diva fonctionne normalement sans decouverte guidee

---

## Epic 7: Personas Etendus & Gestion des Visiteurs

Diva reconnait les visiteurs reguliers, gere les invites avec discretion, et adapte le filtre contenu pour les enfants d'amis.

### Story 7.1: Identification vocale et adaptation automatique du persona

As a membre de la famille,
I want que Diva me reconnaisse par ma voix et s'adapte immediatement,
So that elle me parle avec le bon ton et les bonnes permissions.

**Acceptance Criteria:**

**Given** Thomas (adulte) parle a Diva
**When** WeSpeaker identifie sa voix
**Then** Diva charge le persona adulte : tutoiement, humour, reponses concises, toutes permissions

**Given** Lucas (enfant) parle a Diva
**When** WeSpeaker identifie sa voix
**Then** Diva charge le persona enfant : ton enjoue, vocabulaire simple, filtre strict

**Given** le changement de persona se produit
**When** WeSpeaker identifie un autre locuteur
**Then** la bascule se fait en < 200ms

### Story 7.2: Gestion des 5 types de personas avec regles specifiques

As a proprietaire Diva,
I want que chaque type de persona ait des regles de communication et permissions specifiques,
So that chaque membre est traite de maniere adaptee.

**Acceptance Criteria:**

**Given** un persona de type "alzheimer"
**When** Diva genere une reponse
**Then** phrases max 10 mots, jamais corriger, jamais contredire, reformuler si question repetee

**Given** un persona de type "child" et une demande de contenu inapproprie
**When** Diva traite la requete
**Then** Diva redirige avec malice, ne dit jamais "interdit"

**Given** un persona de type "guest"
**When** l'invite parle
**Then** seuls les intents basiques sont autorises, aucune info personnelle accessible

### Story 7.3: Visiteur recurrent (familier)

As a visiteur regulier,
I want que Diva me reconnaisse et m'accueille par mon nom,
So that je me sens bienvenue sans avoir acces aux infos privees.

**Acceptance Criteria:**

**Given** une voix est detectee pour la 3eme fois sans etre un membre
**When** le visitor classifier analyse l'historique
**Then** Diva propose de retenir : "Je t'ai deja entendue ! Comment tu t'appelles ?"

**Given** Claudine est enregistree comme "familier"
**When** elle arrive chez Marie
**Then** Diva l'accueille : "Bonjour Claudine !" avec acces heure, meteo, musique uniquement

### Story 7.4: Filtre contenu automatique pour enfants d'amis

As a parent,
I want que le filtre enfant s'applique automatiquement quand un ami de mon enfant est detecte,
So that les enfants en visite sont proteges.

**Acceptance Criteria:**

**Given** une voix inconnue avec caracteristiques enfant est detectee
**When** le visitor classifier analyse la voix
**Then** le mode enfant (filtre strict) est applique automatiquement

### Story 7.5: Mode invite sur commande

As a proprietaire,
I want activer un mode invite qui neutralise toutes les infos personnelles,
So that mes invites ne sont pas exposes a des donnees privees.

**Acceptance Criteria:**

**Given** Thomas dit "Diva, ce soir on a des invites"
**When** le mode invite est active
**Then** politesse neutre, aucune info personnelle, musique d'ambiance

**Given** Thomas dit "Diva, mode normal" ou le lendemain matin arrive
**When** le mode invite se desactive
**Then** Diva reprend son comportement normal

---

## Epic 8: Memoire & Apprentissage des Preferences

Diva se souvient des conversations, apprend des corrections, et ne repete jamais la meme erreur.

### Story 8.1: Memoire de correction immediate

As a utilisateur,
I want que Diva retienne mes corrections et ne refasse jamais la meme erreur,
So that je n'ai pas a repeter 10 fois la meme chose.

**Acceptance Criteria:**

**Given** Thomas dit "Mets du jazz" et Diva met du jazz fusion, Thomas corrige "Non, du jazz manouche calme"
**When** Diva capture la correction
**Then** Diva stocke dans Mem0 : "Quand Thomas dit jazz = jazz manouche calme"
**And** la capture est invisible

**Given** Thomas dit "Mets du jazz" une semaine plus tard
**When** Diva traite la requete
**Then** memory_read("jazz") ramene la preference AVANT le choix et Diva met du jazz manouche

### Story 8.2: Clarification intelligente basee sur l'historique d'erreurs

As a utilisateur,
I want que Diva me demande de preciser uniquement quand elle a deja echoue sur une ambiguite,
So that elle ne pose pas de questions inutiles mais evite les erreurs repetees.

**Acceptance Criteria:**

**Given** "Mets du jazz" a genere 3 corrections
**When** Thomas dit "Mets du jazz"
**Then** Diva demande : "Du jazz manouche calme comme d'habitude, ou autre chose ?"

**Given** "Mets du Brassens" n'a jamais genere de correction
**When** Thomas dit "Mets du Brassens"
**Then** Diva met du Brassens directement sans clarification

### Story 8.3: Callbacks memoire naturels dans la conversation

As a utilisateur,
I want que Diva fasse reference a nos conversations passees naturellement,
So that j'ai l'impression de parler a quelqu'un qui me connait.

**Acceptance Criteria:**

**Given** Marie a parle de son voyage en Bretagne il y a 2 semaines
**When** Marie mentionne la Bretagne
**Then** Diva fait un callback : "Tu m'avais parle de ton voyage avec Pierre !"
**And** le callback est contextuel, pas force

### Story 8.4: Memorisation preferences et gouts par persona

As a utilisateur,
I want que Diva retienne mes gouts et habitudes au fil du temps,
So that ses recommandations s'ameliorent.

**Acceptance Criteria:**

**Given** Thomas dit "J'adore le PSG"
**When** Diva traite l'information
**Then** Diva stocke : preference sport Thomas = PSG

**Given** un utilisateur change de preference
**When** il corrige
**Then** la preference est mise a jour, pas dupliquee

### Story 8.5: Detection automatique des dates importantes

As a utilisateur,
I want que Diva retienne les dates que je mentionne une seule fois,
So that elle me les rappelle sans creer un rappel explicite.

**Acceptance Criteria:**

**Given** Marie dit "L'anniversaire de maman c'est le 15 juin"
**When** Diva traite la phrase
**Then** Diva memorise la date ET cree un rappel pour le 13 juin (J-2)

---

## Epic 9: Proactivite Intelligente & Anti-Surcharge

Diva accueille les membres, delivre un briefing fractionne, detecte l'agacement, et propose 3 niveaux de silence.

### Story 9.1: Accueil personnalise par detection de presence

As a membre de la famille,
I want que Diva m'accueille quand je rentre avec un message adapte,
So that je me sens attendu.

**Acceptance Criteria:**

**Given** le capteur Tapo detecte une arrivee et WeSpeaker identifie Thomas a 18h30
**When** l'accueil est declenche
**Then** Diva dit "Ah Thomas, te voila !"

**Given** un accueil a deja ete fait il y a moins de 60 minutes
**When** le capteur detecte un mouvement du meme persona
**Then** Diva ne repete pas l'accueil

### Story 9.2: Briefing matinal fractionne avec budget attentionnel

As a utilisateur,
I want que Diva me donne les infos du matin par petites bouchees,
So that je retiens ce qu'elle me dit.

**Acceptance Criteria:**

**Given** Marie arrive le matin
**When** Diva delivre le briefing
**Then** elle donne la premiere info et attend une reponse ou 3 secondes avant de continuer

**Given** Marie ne repond pas apres le premier message
**When** 5 secondes passent
**Then** Diva s'arrete, les infos restantes sont reproposees plus tard

**Given** le budget attentionnel est atteint
**When** le max est depasse
**Then** les infos restantes sont reportees au prochain creneau

### Story 9.3: Detection de saturation et reduction d'initiative

As a utilisateur,
I want que Diva detecte quand je suis agace et se fasse plus discrete,
So that Diva ne devienne jamais envahissante.

**Acceptance Criteria:**

**Given** l'utilisateur repond "C'est bon", soupire, ou ne repond pas 3+ fois dans la journee
**When** les signaux s'accumulent
**Then** Diva reduit son initiative pour le reste de la journee

**Given** les signaux se repetent 3 jours consecutifs
**When** le systeme analyse la tendance
**Then** Diva ajuste le initiativeLevel vers le bas et dit "Je vais me faire plus discrete"

### Story 9.4: Trois niveaux de silence

As a utilisateur,
I want pouvoir demander differents niveaux de silence,
So that je controle quand Diva m'interrompt.

**Acceptance Criteria:**

**Given** Thomas dit "Diva, pas maintenant"
**When** le niveau 1 est active
**Then** Diva se tait 1 heure mais reste disponible au wake word

**Given** Thomas dit "Diva, soiree tranquille"
**When** le niveau 2 est active
**Then** zero initiative mais repond si on lui parle

**Given** Thomas dit "Diva, silence total"
**When** le niveau 3 est active
**Then** wake word desactive sauf "Diva, urgence"
**And** desactivation automatique le lendemain matin a 7h

---

## Epic 10: Resilience & Mode Degrade

Diva continue de fonctionner quand internet tombe, bascule sur le LLM local, et previent l'utilisateur de ses limitations.

### Story 10.1: Detection perte reseau et communication degradation

As a utilisateur,
I want que Diva m'informe honnetement quand elle a un probleme technique,
So that je comprends pourquoi elle est moins performante.

**Acceptance Criteria:**

**Given** Diva detecte une perte de connexion internet
**When** la detection se fait en < 5 secondes
**Then** Diva dit : "J'ai plus internet, mais je suis toujours la !"

**Given** le reseau revient
**When** Diva detecte le retour
**Then** Diva dit : "Ah, je suis de retour a pleine puissance !"

### Story 10.2: Instructions depannage adaptees au persona

As a utilisateur,
I want que Diva me guide pour resoudre un probleme avec des mots que je comprends,
So that meme Marie peut aider.

**Acceptance Criteria:**

**Given** un probleme et l'utilisateur est Thomas (tech)
**When** Diva fournit des instructions
**Then** instructions techniques (SSH, service restart)

**Given** le meme probleme et l'utilisateur est Marie (elderly)
**When** Diva fournit des instructions
**Then** instructions simples : "Debranche la boite noire, attends 10 secondes, rebranche"

### Story 10.3: Notification au contact en cas de panne

As a aidant/proche,
I want etre prevenu si Diva ne fonctionne plus chez mon proche,
So that je peux intervenir.

**Acceptance Criteria:**

**Given** Diva ne peut plus fonctionner normalement
**When** le systeme de messagerie est encore operationnel
**Then** Diva envoie un SMS/email : "Je ne fonctionne plus correctement chez Marie."

### Story 10.4: LLM Router — Fallback multi-niveaux

As a utilisateur,
I want que Diva continue de converser meme quand Claude est indisponible,
So that je ne me retrouve jamais face au silence.

**Acceptance Criteria:**

**Given** Claude API ne repond pas (timeout 10s)
**When** le LLM Router detecte l'echec
**Then** bascule sur Qwen local en < 2 secondes
**And** Diva dit : "Je suis en mode economique mais je suis la !"

**Given** Qwen est aussi indisponible
**When** double echec
**Then** mode intent-only (heure, meteo cache, domotique, musique locale)

**Given** Claude redevient disponible
**When** le LLM Router detecte le retour
**Then** rebascule automatiquement sur Claude

### Story 10.5: Cache de donnees essentielles

As a utilisateur,
I want que Diva me donne la meteo et mon planning meme sans internet,
So that les questions du quotidien ont toujours une reponse.

**Acceptance Criteria:**

**Given** la meteo est fetchee avec internet
**When** elle est stockee
**Then** cache RAM avec TTL 60 minutes

**Given** internet est coupe et cache < 60 min
**When** l'utilisateur demande la meteo
**Then** Diva repond : "D'apres ce que je savais il y a [X] minutes, il fait 15 degres"

### Story 10.6: Musique locale de secours

As a utilisateur,
I want que Diva mette de la musique meme sans internet,
So that le silence n'est jamais la seule option.

**Acceptance Criteria:**

**Given** YouTube et Spotify indisponibles
**When** l'utilisateur demande de la musique
**Then** Diva joue depuis assets/local-music/ : "J'ai du Dalida en stock, ca te dit ?"

### Story 10.7: File d'attente offline

As a utilisateur,
I want que les actions necessitant internet soient executees quand la connexion revient,
So that "Envoie un message a mon fils" fonctionne meme en panne.

**Acceptance Criteria:**

**Given** "Envoie un message a mon fils" pendant une panne
**When** le systeme echoue
**Then** demande stockee en file d'attente, Diva confirme : "Je l'enverrai des que j'aurai internet"

**Given** la connexion revient
**When** la file contient des actions
**Then** execution automatique et Diva informe : "J'ai envoye le message de tout a l'heure"

---

## Epic 11: Monitoring, Metriques & Fleet MVP

Les metriques de qualite sont collectees, consultables a distance, et un mode replay permet de debugger.

### Story 11.1: Collecte de metriques de qualite conversationnelle

As a operateur Diva,
I want que Diva collecte des metriques sur la qualite de ses interactions,
So that je sais si Diva fonctionne bien chez chaque utilisateur.

**Acceptance Criteria:**

**Given** Diva traite des interactions
**When** chaque interaction est completee
**Then** metriques dans metrics.db : confiance STT, temps reponse, corrections/jour, "quoi ?"/jour

**Given** Diva utilise Claude API
**When** des tokens sont consommes
**Then** consommation trackee par foyer et par persona
**And** alerte si cout > 80% du budget

### Story 11.2: Mode replay pour debug a distance

As a support technique,
I want retracer le pipeline complet d'une interaction passee,
So that je peux identifier exactement ou un probleme est survenu.

**Acceptance Criteria:**

**Given** un correlation ID est identifie
**When** le mode replay est active
**Then** pipeline complet retrace : STT → intent → reponse → TTS
**And** le support voit exactement ou ca a deraille

### Story 11.3: Canal de mise a jour beta/stable

As a operateur Diva,
I want que les mises a jour soient testees sur mes devices avant les clients,
So that un bug ne casse jamais Diva chez Marie.

**Acceptance Criteria:**

**Given** une nouvelle version est prete
**When** poussee sur le serveur
**Then** seuls les devices beta la recoivent

**Given** la version beta tourne 2 semaines sans incident
**When** les metriques sont stables
**Then** promotion automatique sur stable

**Given** un device stable recoit une mise a jour
**When** l'installation est declenchee
**Then** uniquement pendant une periode de silence + rollback automatique

### Story 11.4: Monitoring des couts API et alertes budget

As a operateur Diva,
I want suivre le cout API par foyer et etre alerte quand le budget approche,
So that je maitrise les couts.

**Acceptance Criteria:**

**Given** le cout mensuel depasse 80% du budget (6.40€)
**When** l'alerte est declenchee
**Then** log warn et alerte fleet

**Given** le cout depasse 100% du budget
**When** alerte critique
**Then** mode economique : reponses courtes, cache agressif, fallback Qwen pour questions simples

### Story 11.5: Fleet Reporter — Push metriques vers serveur fleet

As a operateur fleet,
I want que chaque device remonte ses metriques au serveur central,
So that j'ai une vue d'ensemble.

**Acceptance Criteria:**

**Given** un device connecte au fleet via WireGuard
**When** 5 minutes passent depuis le dernier push
**Then** envoi MQTT : heartbeat, version, uptime, temperature, RAM, stockage, metriques, cout API

**Given** le serveur fleet est injoignable
**When** le push echoue
**Then** metriques stockees localement, poussees au retour de la connexion
**And** le device continue de fonctionner normalement
