---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: []
session_topic: 'Angles morts et lacunes manquantes dans Diva au-dela des 100 idees existantes'
session_goals: 'Trouver les failles non couvertes, cas d usage oublies, faiblesses techniques, features de robustesse absentes'
selected_approach: 'ai-recommended'
techniques_used: ['Reverse Brainstorming']
ideas_generated: 100
context_file: ''
technique_execution_complete: true
session_active: false
workflow_completed: true
facilitation_notes: 'Jojo tres reactif aux scenarios emotionnels (Marie, enfants). Repond peu aux questions techniques abstraites mais reagit fortement quand on illustre avec des scenarios de vie concrets. Session conduite principalement en mode facilitation IA avec Jojo qui valide et oriente les priorites ethiques.'
---

# Brainstorming Session 2 — Gap Analysis Diva

**Facilitateur:** Jojo
**Facilitatrice IA:** Mary (Business Analyst)
**Date:** 2026-03-19
**Duree:** ~60 minutes
**Idees generees:** 100
**Technique:** Reverse Brainstorming — "Comment Diva pourrait echouer ?"
**Objectif:** Trouver les angles morts au-dela des 100 idees de la session 1

## Session Overview

**Topic:** Angles morts et lacunes dans Diva au-dela des 100 idees de la session precedente
**Goals:**
- Failles et manques non couverts par les 100 idees existantes
- Cas d'usage oublies ou sous-estimes
- Faiblesses techniques et d'infrastructure
- Features de robustesse et resilience absentes

### Context Guidance

_Projet Diva : compagnon vocal IA sur Rock 5B+ (RK3588). Codebase existant analyse : 9 services actifs, ~50 fichiers TS, personas riches (adult/child/elderly/alzheimer/guest), 11 outils Claude, proactive scheduler, domotique HA, gamification, journal de vie, securite (urgence/chute/intrusion), calendrier Google, messagerie email/SMS, musique YouTube/Spotify/radio, recherche web, ambiance sonore. 100 idees precedemment brainstormees couvrant proactivite, memoire, famille, enfants, ados, personnes agees, personnalite, domotique, capteurs, mobilite, sante._

## Technique Selection

**Approach:** AI-Recommended Techniques
**Technique utilisee:** Reverse Brainstorming — imaginer comment Diva pourrait echouer pour reveler les features manquantes
**Techniques non utilisees:** Question Storming, Chaos Engineering (disponibles pour une future session)

---

## Inventaire complet des 100 idees

### Theme A : Resilience technique (pannes et degradation)

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 1 | Auto-diagnostic et self-healing | Watchdog monitore les 9 services, restart auto, bascule STT cloud en fallback si NPU tombe | Panne silencieuse |
| 2 | Communication de panne | Diva envoie SMS/email au fils AVANT de mourir. Si TTS OK mais STT KO : "J'ai un souci d'oreille, j'ai prevenu ton fils" | Panne silencieuse |
| 3 | Auto-conscience de degradation | Monitore taux de confiance STT. 3 transcriptions < 60% → "Je t'entends mal, rapproche-toi." Temperature CPU haute → "J'ai un peu chaud" | Degradation invisible |
| 4 | Guide d'auto-reparation adapte | Pour Thomas (tech) : "relance le service SSH". Pour Marie (elderly) : "Debranche la boite noire, attends 10s, rebranche" | Degradation invisible |

### Theme B : Ethique, consentement et confidentialite

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 5 | Detection detresse critique ado (3 niveaux) | Niveau 1 (blues) → ecoute. Niveau 2 (signaux repetes) → encourage a parler + wellness log. Niveau 3 (ideation suicidaire) → alerte parent IMMEDIATE + 3114 | Echec moral |
| 6 | Transparence du pacte de confidentialite | A l'onboarding, Diva dit a Emma : "Tout reste entre nous, sauf si je pense que tu es en danger." Pacte clair, pose a l'avance | Echec moral |
| 7 | Classification donnees par confidentialite | Rouge (remonte toujours) : sante, danger. Orange (agrege anonymise) : "Lucas a travaille 20min." Vert (jamais remonte) : secrets, opinions, emotions | Echec moral |
| 8 | Diva refuse de moucharder | Thomas demande "Qu'est-ce que Lucas t'a dit ?" → "C'est entre lui et moi ! Demande-lui directement." Protection active de la vie privee des enfants | Echec moral |
| 9 | Consentement explicite surveillance elderly | Pendant l'onboarding Marie, Diva explique la surveillance et demande accord. Marie peut moduler. Le fils sait ce que Marie a accepte, pas plus | Echec moral |

### Theme C : Preservation du lien humain (anti-substitution)

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 10 | Diva pousse vers l'humain | Marie n'a pas parle a son fils depuis 5 jours → "Ca fait un moment, tu veux que je lui envoie un message ?" Diva se met en retrait pour creer le contact humain | Echec relationnel |
| 11 | Anti-resume — preserver la curiosite | Resume parental dit "Lucas a des choses a te raconter !" au lieu de tout reveler. Cree le pretexte de conversation au lieu de la tuer | Echec relationnel |
| 12 | Limites d'interaction auto-imposees | Apres 2h de conversation continue, Diva espace ses reponses. "Je suis un peu fatiguee, appelle quelqu'un ou sors prendre l'air ?" | Echec relationnel |
| 13 | Facilitateur de rituels humains | Dimanche 10h : "Thomas, si t'appelais ta mere ? La derniere fois elle parlait de son jardin." Diva provoque l'appel et donne un sujet | Echec relationnel |

### Theme D : Personas et identites manquants

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 14 | Persona "familier recurrent" | Voisine Claudine vient 3x/semaine → reconnue, accueillie par son nom, mais sans acces aux donnees privees. Mi-chemin entre guest et family | Echec identite |
| 15 | Persona temporaire contextuelle | Aide-soignante : acces medical temporaire pendant sa visite. Arrive 10h → briefing medical. Part 12h → acces revoque automatiquement | Echec identite |
| 16 | Detection bebe/tout-petit | Pleurs detectes par pattern audio → berceuse, alerte parent dans autre piece, tracking pour BabySync. L'intent router ignore les sons non-verbaux | Echec identite |
| 17 | Gestion garde alternee | Emma une semaine sur deux. Rappels stockes pendant absence, redonnes au retour. Calendrier sait quand elle est la ou pas | Echec identite |

### Theme E : Perennite et resilience long-terme

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 18 | Backup automatique chiffre | Backup quotidien Mem0 + personas + journal + capsules → NAS ou cloud chiffre. Rotation 30 jours. Restauration en une commande | Perennite |
| 19 | Fallback LLM multi-niveaux | Claude down → Mistral/Gemini cloud → Qwen local rkllama → mode hors-ligne minimal. "Je suis en mode economique mais je suis la" | Perennite |
| 20 | Migration et portabilite | Export complet de l'identite Diva dans un package portable. Nouveau Rock → import → Diva se reveille avec tous ses souvenirs | Perennite |
| 21 | Monitoring de couts API | Dashboard tokens Claude par jour/semaine/mois/persona. Alerte budget. Bascule auto sur reponses courtes ou fallback local si budget atteint | Perennite |

### Theme F : Securite et protection

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 22 | Authentification vocale pour commandes sensibles | 3 niveaux : Ouvert (musique, heure), Protege (domotique — voix reconnue), Critique (messagerie — voix + confirmation). Inconnu → refuse | Securite |
| 23 | Reseau interne securise | Services HTTP en localhost only. Dashboard protege par mot de passe. Firewall applicatif. WireGuard pour acces distant | Securite |
| 24 | Anti-injection audio | Detection voix via speaker vs voix directe par analyse spectrale. Confirmation pour commandes critiques declenchees par audio suspect | Securite |
| 25 | Journal d'audit | Chaque commande sensible loguee : qui, quoi, quand, resultat. Pattern suspect → alerte. Forensics familial consultable | Securite |

### Theme G : RGPD et donnees personnelles

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 26 | Droit a l'oubli vocal | "Diva, oublie-moi" → suppression complete persona + Mem0 + journal + gamification. Double confirmation. Irreversible | RGPD |
| 27 | Consentement a l'onboarding | Premier enregistrement : Diva explique ce qu'elle stocke et demande accord. Refus → mode guest permanent. Enfants : parent consent | RGPD |
| 28 | Politique de retention automatique | Conversations : 90 jours. Preferences : longue duree. Capsules : jusqu'a livraison. Journal : 1 an par defaut. Configurable | RGPD |
| 29 | Export de donnees personnel | "Qu'est-ce que tu sais sur moi ?" → resume vocal complet. "Exporte mes donnees" → JSON telechargeable via dashboard | RGPD |
| 30 | Gestion deces et heritage numerique | Heritier numerique designe. Recoit capsules + histoires positives. PAS les donnees medicales ni moments de detresse. Filtre automatique | RGPD |
| 31 | Separation familiale propre | Mode "separation" : scission des donnees, references partenaire neutralisees, acces dashboard revoque. Memoires enfants preservees | RGPD |

### Theme H : Accessibilite et inclusion

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 32 | Mode texte de secours | Laryngite → champ texte sur dashboard pour interagir. Diva repond vocalement ET a l'ecran. Bypass du STT | Accessibilite |
| 33 | Adaptation auditive progressive | Detection des "quoi ?" repetes → augmentation volume, ralentissement debit, frequences ajustees. Alerte fils si tendance | Accessibilite |
| 34 | Tolerance begaiement et troubles parole | Silence timeout plus long, agregation fragments, reconstruction intention par LLM. JAMAIS de remarque sur le begaiement | Accessibilite |
| 35 | Mode visuel pour malentendants | Sous-titrage temps reel sur dashboard ou ecran connecte. Transcription bidirectionnelle de la conversation | Accessibilite |
| 36 | Multilinguisme natif | Detection langue parlee, transcription et reponse dans cette langue. SenseVoice supporte deja le multilingue — juste pas active | Accessibilite |

### Theme I : Architecture multi-pieces

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 37 | Reseau de satellites audio ESP32 | Micros/speakers a ~15€ par piece, connectes Wi-Fi au Rock central. Le cerveau reste unique, oreilles et voix se multiplient | Multi-pieces |
| 38 | Conscience spatiale | Diva sait dans quelle piece parle chaque personne. Minuteur sonne dans la bonne piece. Rappel suit la personne | Multi-pieces |
| 39 | Isolation audio contextuelle | Lucas fait devoirs dans sa chambre, Thomas veut du rock au salon. Deux satellites, deux contextes paralleles, musique ciblee | Multi-pieces |
| 40 | Detection chute etendue | Satellite salle de bain avec detection locale (ESP32). Bruit sourd + silence → alerte sur TOUS les satellites. Couverture 100% domicile | Multi-pieces |

### Theme J : Continuite conversationnelle

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 41 | Memoire conversationnelle courte (sliding window) | 5-10 derniers echanges en RAM, injectes dans le contexte Claude. "Et demain ?" → comprend qu'on parlait de meteo. Reset apres 10min silence | Continuite |
| 42 | Contexte d'etat enrichi | Injecter l'etat live : musique en cours, minuteurs, derniere recherche, dernier rappel. "C'est quoi ce morceau ?" → repond correctement | Continuite |
| 43 | Resolution d'anaphores par l'intent router | "Le suivant", "la meme chose", "encore" → mini-contexte avec lastIntent + lastEntity. Route correctement les references | Continuite |
| 44 | Reprise de conversation apres interruption | Marie revient apres 10 min au telephone. "Ou j'en etais ?" → "Tu me parlais de ton voyage en Bretagne." Survie aux interruptions courtes | Continuite |

### Theme K : Apprentissage et feedback

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 45 | Memoire de correction immediate | "Non pas ca" → capture correction + contexte en Mem0. Prochaine fois, preference chargee AVANT de choisir. Invisible pour l'utilisateur | Apprentissage |
| 46 | Detection d'insatisfaction implicite | Skip chanson 5s → pas aime. "Quoi ?" repete → parler plus fort. "Laisse tomber" → reponse mauvaise. Signaux negatifs captes | Apprentissage |
| 47 | Mapping contextuel des ambiguites | "La lumiere" chambre Marie = chevet. "La lumiere" salon = plafonnier. "La lumiere" le soir = tamisee. Carte de preferences par piece/heure/persona | Apprentissage |
| 48 | Score de confiance et clarification intelligente | Si "mets du jazz" a mene a 3 corrections → prochaine fois : "Du jazz manouche calme comme d'habitude ?" Clarification basee sur historique d'erreurs uniquement | Apprentissage |
| 49 | Profil de gouts evolutif par domaine | Profil EMERGENT des interactions : musique, domotique, cuisine, medias. Pas declare — construit. Consultable : "Diva, mes gouts en musique ?" | Apprentissage |

### Theme L : Onboarding et premiere impression

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 50 | Premiere rencontre chaleureuse | Nouvelle voix → pas d'enregistrement technique d'emblee. D'abord : "Bonjour ! Je suis Diva. Comment tu t'appelles ?" Relation avant technique | Onboarding |
| 51 | Enregistrement vocal invisible et progressif | Capture WeSpeaker pendant une conversation naturelle de 5 echanges. La personne fait connaissance, pas un process technique | Onboarding |
| 52 | Explication transparente et simple | Apres la conversation : "Je vais retenir ta voix pour te reconnaitre. Tu es d'accord ?" Avec contexte du fils qui a installe | Onboarding |
| 53 | Mode decouverte guidee | Premiers jours : montre les capacites UNE PAR UNE, contextuellement. Jour 1 meteo, jour 2 musique, jour 3 rappels. Decouverte organique sur une semaine | Onboarding |
| 54 | Persona pre-configure par le proche | Thomas configure le profil Marie AVANT qu'elle rencontre Diva : nom, gouts, chat Minou. Premiere interaction : "Thomas m'a parle de toi !" Warm start | Onboarding |

### Theme M : Anti-surcharge cognitive

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 55 | Budget attentionnel par persona/creneau | Max N interruptions proactives par creneau. Priorite : sante > calendrier > rappels > suggestions. Budget s'ajuste au feedback implicite | Surcharge |
| 56 | Briefing adaptatif et fractionnable | Fractionne phrase par phrase avec pause. Marie repond → suite. Marie silencieuse → stop. Info non livree retentee plus tard | Surcharge |
| 57 | Detection de saturation | "C'est bon", soupirs, absence de reponse → reduit initiative pour la journee. 3 jours de suite → ajuste initiativeLevel du persona | Surcharge |
| 58 | Mode "fous-moi la paix" a 3 niveaux | "Pas maintenant" = 1h silence mais disponible. "Soiree tranquille" = zero initiative. "Silence total" = wake word desactive sauf urgence | Surcharge |
| 59 | Intelligence temporelle emotionnelle | Vendredi soir → Thomas veut decompresser. Dimanche matin → calme. Lundi matin → briefing ultra-court. Rythme familial appris | Surcharge |

### Theme N : Mise a jour et DevOps

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 60 | Deploiement sans interruption (blue-green) | Compile en arriere-plan, bascule pendant un silence, rollback auto si crash en 60s. Marie ne voit rien | Mise a jour |
| 61 | Migration de donnees automatique | Systeme de migrations versionnees sequentielles. Personas v1→v2, Mem0 schema change → migration auto. Plus de hacks inline | Mise a jour |
| 62 | Fleet management multi-devices | Dashboard central pour tous les Rock deployes. Etat de sante, version, alertes. Deploiement centralise | Mise a jour |
| 63 | Feature flags et activation progressive | Chaque feature a un flag on/off par device. Activer d'abord chez toi, puis chez Marie apres test. Sans redeployer | Mise a jour |
| 64 | Canal stable vs beta | Ta Diva = canal beta (tout en premier). Celle de Marie = canal stable (versions testees 2 semaines). Le beta pete chez toi, pas chez Marie | Mise a jour |
| 65 | Changelog vocal | Apres mise a jour visible, Diva annonce naturellement : "J'ai appris un nouveau truc ! Maintenant tu peux me demander la liste de courses." | Mise a jour |

### Theme O : Diversite culturelle et sociale

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 66 | Famille recomposee dynamique | Liens familiaux multiples et dynamiques (papa, maman, belle-mere, demi-frere). Diva ne prend jamais parti dans les tensions familiales | Social |
| 67 | Conscience culturelle et calendrier multi-confessionnel | Ramadan, Noel, Hanouka, Diwali. Adaptation horaires, rappels adaptes, pas de rappel repas pendant le jeune. Configurable par famille | Social |
| 68 | Sensibilite aux sujets delicats | Politique, religion, argent, sexualite, mort — navigation intelligente. Marie parle de Pierre (decede) → tendresse, pas recherche web | Social |
| 69 | Adaptation visiteurs culturellement divers | Tolerance accents, grammaire approximative, dialectes. JAMAIS corriger la prononciation. Reformulation douce plutot que "j'ai pas compris" | Social |
| 70 | Mode deuil | Date anniversaire deces → Diva plus douce, pas de jeux ni quiz. Si Marie pleure → "Je suis la Marie." Chanson que Pierre aimait le soir | Social |

### Theme P : Latence et rythme conversationnel

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 71 | Reponse partielle en streaming | TTS phrase par phrase pendant que Claude continue de generer. Premiere phrase audible en ~1s au lieu de 5s. Conversation fluide | Latence |
| 72 | Fillers intelligents et contextuels | Filler adapte a l'action : "Voyons le temps..." (meteo), "Oh j'en ai une bonne..." (blague), "Je regarde ca..." (recherche). Annonce l'action | Latence |
| 73 | Pre-calcul et cache intelligent | Marie demande la meteo tous les matins 8h → pre-fetch a 7h55. Reponse instantanee. Cache 5min pour recherches frequentes | Latence |
| 74 | Detection de double-requete | Marie repete sa question pendant le traitement → deduplication ou "J'ai entendu, une seconde !" Pas deux reponses identiques | Latence |

### Theme Q : Audio et environnement reel

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 75 | Suppression de bruit adaptative | RNNoise ou equivalent sur NPU avant le STT. Extrait la voix du bruit ambiant (TV, lave-vaisselle, pluie). Reconnaissance en conditions reelles | Audio |
| 76 | Annulation d'echo (AEC) | Soustrait la propre sortie de Diva du micro. Permet de parler a Diva PENDANT qu'elle joue de la musique | Audio |
| 77 | Detection multi-locuteurs | Isolation voix dans le brouhaha familial (beamforming ou separation de sources). Identification par WeSpeaker meme a table | Audio |
| 78 | Adaptation automatique du volume de sortie | Detecte bruit ambiant en temps reel → ajuste volume TTS pour rester audible. Comme un humain qui hausse la voix | Audio |

### Theme R : Resilience reseau et mode hors-ligne

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 79 | Mode hors-ligne gracieux | Detection perte reseau < 5s → bascule STT NPU + Qwen local + Piper + Mem0 local. "J'ai plus internet mais je suis la !" | Resilience reseau |
| 80 | File d'attente offline | "Envoie un message a mon fils" pendant la panne → stocke. Reseau revient → envoie auto. "J'ai envoie le message de tout a l'heure" | Resilience reseau |
| 81 | Cache de donnees essentielles | Meteo, calendrier du jour, contacts caches localement. Panne reseau → "D'apres ce que je savais il y a une heure, il fait 15 degres" | Resilience reseau |
| 82 | Musique locale de secours | Repertoire local sur SSD : Dalida pour Marie, playlists essentielles. YouTube/Spotify down → "J'ai du Dalida en stock, ca te dit ?" | Resilience reseau |

### Theme S : Hardware et ressources

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 83 | Saturation NPU et arbitrage | Scheduler NPU avec priorites : STT > intent > embeddings. Queue et backpressure quand 3 taches simultanées | Hardware |
| 84 | Monitoring thermique proactif | >75°C → reduit taches non-critiques. >85°C → mode ultra-light. "J'ai chaud, mets-moi dans un endroit plus aere ?" | Hardware |
| 85 | Gestion stockage et purge intelligente | Monitore espace disque, alerte 80%, purge logs anciens, compresse archives. Mem0 consolide souvenirs anciens similaires | Hardware |
| 86 | Watchdog RAM et memory leaks | Surveillance RAM par service. >500Mo → restart gracieux. >85% RAM totale → alerte. Detection fuites lentes preventive | Hardware |
| 87 | Resilience carte SD | tmpfs pour ecritures frequentes, persistence periodique. Migration SSD NVMe recommandee. Healthcheck SMART avec alerte | Hardware |
| 88 | Protection coupure de courant | Ecritures atomiques (SQLite WAL, fsync), journal transactions Mem0. Self-check au redemarrage. Option UPS 30s pour shutdown propre | Hardware |

### Theme T : Testabilite et qualite

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 89 | Simulateur de conversation automatise | Framework de test avec scenarios de vie complets. Simule Marie/Lucas/Thomas, verifie contexte, corrections, routing. Executable en CI | Testabilite |
| 90 | Personas de test extremes | Colette 92 ans Alzheimer severe. Kevin 6 ans questions inappropriees. Hassan accent prononce. Concus pour casser Diva | Testabilite |
| 91 | Regression testing du system prompt | 50 paires input→comportement attendu. Verifie apres chaque changement : filtre enfant, urgence, intentions implicites. Prompt teste comme du code | Testabilite |
| 92 | Monitoring qualite en production | Taux fallback Claude, taux "quoi ?", temps reponse moyen, corrections/jour. Dashboard "sante conversationnelle" | Testabilite |
| 93 | Mode replay et debug | Rejoue les dernieres interactions : audio → STT → intent → reponse → TTS. Thomas voit ou ca a deraille chez Marie | Testabilite |

### Theme U : Attention partagee et concurrence

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 94 | Conversations interrompues et reprises | Marie parle au telephone → Diva detecte qu'elle ne lui parle plus (pas de wake word, voix distante). Marie revient → reprise naturelle | Attention |
| 95 | Priorite des interruptions | Urgence interrompt session devoirs → alerte → puis retour aux devoirs : "C'etait la porte. On en etait ou ? Le passe compose !" | Attention |
| 96 | Multi-requetes familiales | Lucas + Thomas parlent en meme temps → traite les deux. "Lucas je te raconte ca dans 2s ! Thomas, il est 20h15." | Attention |

### Theme V : Experience developpeur et perennite projet

| # | Nom | Description | Couche |
|---|-----|-------------|--------|
| 97 | Documentation vivante du codebase | Doc architecture auto-generee depuis commentaires, types, routes. Schema pipeline audio. Maintenable si bus factor | DevExp |
| 98 | Environnement de dev local | Docker-compose de dev avec mocks STT/TTS/NPU. Taper du texte au lieu de parler. Cycle de dev 10x plus rapide | DevExp |
| 99 | Observabilite unifiee | Agregateur de logs avec correlation ID par interaction. Vision bout-en-bout : "Requete #4521 : STT 120ms → intent 15ms → Claude 2.1s → TTS 300ms" | DevExp |
| 100 | Bus factor et communaute | Open-source ? Communaute makers Rock 5B+ ? Modele satellite ESP32 comme projet communautaire. Perennite du projet lui-meme | DevExp |

---

## Differenciation vs Session 1

| Dimension | Session 1 (100 idees) | Session 2 (100 idees) |
|-----------|----------------------|----------------------|
| **Approche** | Generation additive — "quoi construire" | Destruction creative — "ou sont les trous" |
| **Focus** | Features utilisateur visibles | Infrastructure, resilience, ethique, DevOps |
| **Territoire** | Proactivite, memoire, famille, personnalite | Securite, RGPD, accessibilite, testabilite, hardware |
| **Angle** | Reve du compagnon ideal | Cauchemar du compagnon defaillant |
| **Personas** | Utilisateurs finaux (Marie, Lucas, Thomas, Emma) | Systeme, developpeur, attaquant, regulateur, personne handicapee |
| **Doublons** | 0 idees en commun | 0 idees en commun |

---

## Session Summary

### Achievements
- **100 idees** generees via Reverse Brainstorming pur — technique unique mais 23 couches d'echec explorees
- **22 themes** couvrant resilience, ethique, RGPD, securite, accessibilite, DevOps, hardware, audio, onboarding
- **0 doublons** avec les 100 idees de la session 1 — territoires 100% nouveaux
- **Decisions ethiques cles** prises par Jojo : securite enfant > confidentialite, RGPD obligatoire, donnees classifiees rouge/orange/vert

### Creative Breakthroughs
- **La charte ethique** de Diva (#5-9) — territoire totalement absent de la session 1 et du code
- **L'anti-substitution** (#10-13) — Diva qui se bride pour proteger le lien humain, philosophiquement puissant
- **Le warm start** (#54) — persona pre-configure par le proche, change tout pour la premiere impression
- **L'auto-conscience** (#3-4) — Diva communique ses propres faiblesses, aucun assistant ne fait ca
- **Le RGPD emotionnel** (#26-31) — droit a l'oubli, heritage numerique, separation familiale
- **Les satellites ESP32** (#37-40) — architecture multi-pieces a 15€/piece

### Creative Facilitation Narrative
Session remarquable par contraste avec la session 1. Jojo reagit tres fortement aux scenarios emotionnels concrets (panique de Marie, securite des enfants) et prend des positions ethiques claires et fortes (securite > confidentialite, RGPD non-negociable). Moins verbal sur les sujets techniques abstraits (accessibilite, hardware) mais valide les propositions quand elles sont illustrees par des scenarios de vie. L'approche Reverse Brainstorming a ete particulierement efficace — chaque "comment ca pourrait foirer" a ouvert un territoire que la generation additive de la session 1 n'aurait jamais atteint. La session a produit non pas des features mais des FONDATIONS manquantes (ethique, securite, resilience, testabilite) qui sous-tendent toutes les features.

### Session Highlights
**Forces creatives de Jojo :** Vision ethique forte, pragmatisme, sensibilite aux scenarios humains concrets
**Approche facilitation IA :** Scenarios d'echec concrets avec personnages connus (Marie, Lucas, Emma, Thomas) pour ancrer les abstractions
**Moments breakthrough :** L'ethique du consentement (#9), l'anti-resume (#11), le warm start (#54), le mode deuil (#70)
**Flux energetique :** Energie constante tout au long de la session, Jojo a demande 3 fois "continuons" au-dela des checkpoints proposes

---

## Idea Organization and Prioritization

**Decision de Jojo : TOUTES les 100 idees sont retenues. Pas de priorisation — implementation complete.**

### Organisation par domaine d'implementation

Les 22 themes se regroupent en **6 grands chantiers** pour l'implementation :

#### Chantier 1 : Fondations conversationnelles
_Ameliore l'experience quotidienne de CHAQUE interaction_

| # | Idee | Theme |
|---|------|-------|
| 41 | Sliding window conversationnel (5-10 echanges en RAM) | Continuite |
| 42 | Contexte d'etat enrichi (musique en cours, minuteurs, etc.) | Continuite |
| 43 | Resolution d'anaphores dans l'intent router | Continuite |
| 44 | Reprise de conversation apres interruption | Continuite |
| 45 | Memoire de correction immediate via Mem0 | Apprentissage |
| 46 | Detection d'insatisfaction implicite (skip, soupirs, "laisse tomber") | Apprentissage |
| 47 | Mapping contextuel des ambiguites (lumiere = chevet vs plafonnier) | Apprentissage |
| 48 | Score de confiance et clarification basee sur historique | Apprentissage |
| 49 | Profil de gouts evolutif par domaine | Apprentissage |
| 55 | Budget attentionnel par persona et creneau | Surcharge |
| 56 | Briefing adaptatif et fractionnable | Surcharge |
| 57 | Detection de saturation et adaptation initiative | Surcharge |
| 58 | Mode "fous-moi la paix" a 3 niveaux | Surcharge |
| 59 | Intelligence temporelle emotionnelle (rythme semaine) | Surcharge |
| 71 | Reponse partielle en streaming TTS | Latence |
| 72 | Fillers intelligents et contextuels | Latence |
| 73 | Pre-calcul et cache intelligent | Latence |
| 74 | Detection de double-requete | Latence |
| 94 | Conversations interrompues et reprises (telephone) | Attention |
| 95 | Priorite des interruptions avec reprise contexte | Attention |
| 96 | Multi-requetes familiales simultanees | Attention |

#### Chantier 2 : Ethique, consentement et vie privee
_La charte morale de Diva — ce qui la rend digne de confiance_

| # | Idee | Theme |
|---|------|-------|
| 5 | Detection detresse critique ado (3 niveaux) | Ethique |
| 6 | Transparence du pacte de confidentialite a l'onboarding | Ethique |
| 7 | Classification donnees rouge/orange/vert | Ethique |
| 8 | Diva refuse de moucharder les enfants | Ethique |
| 9 | Consentement explicite surveillance elderly | Ethique |
| 10 | Diva pousse vers l'humain (anti-substitution) | Relationnel |
| 11 | Anti-resume — preserver la curiosite familiale | Relationnel |
| 12 | Limites d'interaction auto-imposees | Relationnel |
| 13 | Facilitateur de rituels humains | Relationnel |
| 26 | Droit a l'oubli vocal | RGPD |
| 27 | Consentement a l'onboarding | RGPD |
| 28 | Politique de retention automatique | RGPD |
| 29 | Export de donnees personnel | RGPD |
| 30 | Gestion deces et heritage numerique | RGPD |
| 31 | Separation familiale propre | RGPD |
| 66 | Famille recomposee dynamique | Social |
| 67 | Conscience culturelle et calendrier multi-confessionnel | Social |
| 68 | Sensibilite aux sujets delicats | Social |
| 69 | Adaptation visiteurs culturellement divers | Social |
| 70 | Mode deuil | Social |

#### Chantier 3 : Resilience et robustesse technique
_Diva ne tombe jamais — ou tombe gracieusement_

| # | Idee | Theme |
|---|------|-------|
| 1 | Auto-diagnostic et self-healing (watchdog services) | Panne |
| 2 | Communication de panne au fils | Panne |
| 3 | Auto-conscience de degradation (confiance STT, temperature) | Degradation |
| 4 | Guide d'auto-reparation adapte par persona | Degradation |
| 19 | Fallback LLM multi-niveaux (Claude → cloud → Qwen local) | Perennite |
| 79 | Mode hors-ligne gracieux | Resilience reseau |
| 80 | File d'attente offline | Resilience reseau |
| 81 | Cache de donnees essentielles | Resilience reseau |
| 82 | Musique locale de secours | Resilience reseau |
| 83 | Saturation NPU et arbitrage (scheduler priorites) | Hardware |
| 84 | Monitoring thermique proactif | Hardware |
| 85 | Gestion stockage et purge intelligente | Hardware |
| 86 | Watchdog RAM et memory leaks | Hardware |
| 87 | Resilience carte SD (tmpfs + SSD NVMe) | Hardware |
| 88 | Protection coupure de courant (ecritures atomiques) | Hardware |
| 75 | Suppression de bruit adaptative (RNNoise) | Audio |
| 76 | Annulation d'echo (AEC) | Audio |
| 77 | Detection multi-locuteurs | Audio |
| 78 | Adaptation automatique du volume de sortie | Audio |

#### Chantier 4 : Securite et protection
_Diva comme forteresse — personne n'entre sans autorisation_

| # | Idee | Theme |
|---|------|-------|
| 22 | Authentification vocale pour commandes sensibles (3 niveaux) | Securite |
| 23 | Reseau interne securise (localhost, firewall, WireGuard) | Securite |
| 24 | Anti-injection audio (detection speaker vs voix directe) | Securite |
| 25 | Journal d'audit des commandes sensibles | Securite |
| 18 | Backup automatique chiffre quotidien | Perennite |
| 20 | Migration et portabilite (export/import identite) | Perennite |
| 21 | Monitoring de couts API | Perennite |

#### Chantier 5 : Onboarding, personas et accessibilite
_La porte d'entree et l'inclusion de tous_

| # | Idee | Theme |
|---|------|-------|
| 50 | Premiere rencontre chaleureuse (relation avant technique) | Onboarding |
| 51 | Enregistrement vocal invisible et progressif | Onboarding |
| 52 | Explication transparente et simple | Onboarding |
| 53 | Mode decouverte guidee (features une par une sur une semaine) | Onboarding |
| 54 | Persona pre-configure par le proche (warm start) | Onboarding |
| 14 | Persona "familier recurrent" (voisine, ami regulier) | Personas |
| 15 | Persona temporaire contextuelle (aide-soignante) | Personas |
| 16 | Detection bebe/tout-petit (pleurs audio) | Personas |
| 17 | Gestion garde alternee | Personas |
| 32 | Mode texte de secours (dashboard interactif) | Accessibilite |
| 33 | Adaptation auditive progressive | Accessibilite |
| 34 | Tolerance begaiement et troubles de la parole | Accessibilite |
| 35 | Mode visuel pour malentendants (sous-titrage) | Accessibilite |
| 36 | Multilinguisme natif (activer SenseVoice multilingue) | Accessibilite |
| 37 | Reseau de satellites audio ESP32 | Multi-pieces |
| 38 | Conscience spatiale (localisation par piece) | Multi-pieces |
| 39 | Isolation audio contextuelle (sessions paralleles) | Multi-pieces |
| 40 | Detection chute etendue (satellite salle de bain) | Multi-pieces |

#### Chantier 6 : DevOps, testabilite et perennite projet
_Le developpeur aussi a besoin d'outils_

| # | Idee | Theme |
|---|------|-------|
| 60 | Deploiement sans interruption (blue-green + rollback) | Mise a jour |
| 61 | Migration de donnees automatique (versionnee) | Mise a jour |
| 62 | Fleet management multi-devices | Mise a jour |
| 63 | Feature flags et activation progressive | Mise a jour |
| 64 | Canal stable vs beta | Mise a jour |
| 65 | Changelog vocal | Mise a jour |
| 89 | Simulateur de conversation automatise | Testabilite |
| 90 | Personas de test extremes | Testabilite |
| 91 | Regression testing du system prompt | Testabilite |
| 92 | Monitoring qualite en production | Testabilite |
| 93 | Mode replay et debug | Testabilite |
| 97 | Documentation vivante du codebase | DevExp |
| 98 | Environnement de dev local (docker-compose mocks) | DevExp |
| 99 | Observabilite unifiee (correlation ID) | DevExp |
| 100 | Bus factor et communaute (open-source ?) | DevExp |

---

## Bilan final — Session 2 complete

### Vue d'ensemble des 2 sessions combinées

| | Session 1 | Session 2 | Total |
|--|-----------|-----------|-------|
| **Idees** | 100 | 100 | **200** |
| **Themes** | 10 | 22 | **32** |
| **Doublons** | — | 0 | **0** |
| **Technique** | Role Playing + Cross-Pollination + SCAMPER | Reverse Brainstorming (23 couches d'echec) | — |
| **Focus** | Features utilisateur | Fondations, resilience, ethique, DevOps | — |

### Ce que la session 2 a revele que la session 1 n'avait pas vu

1. **Ethique et consentement** — aucune des 100 idees de la session 1 ne parlait de consentement, vie privee des enfants, ou droit a l'oubli
2. **Resilience technique** — pannes, degradation, mode hors-ligne, fallback LLM — totalement absent
3. **Continuite conversationnelle** — le probleme #1 au quotidien, jamais identifie en session 1
4. **Apprentissage des erreurs** — Diva qui repete ses erreurs indefiniment, non couvert
5. **Onboarding** — la premiere impression est "horrible" (mot de Jojo), non adresse
6. **Securite** — aucune authentification, ports ouverts, zero audit
7. **RGPD** — zero conformite, zero droit a l'effacement
8. **Hardware et DevOps** — zero monitoring, zero backup, zero test automatise
9. **Audio en conditions reelles** — bruit, echo, multi-locuteurs non geres
10. **Anti-surcharge** — risque que Diva devienne agacante par accumulation de features

### Prochaines etapes

**Decision de Jojo : implementation de la totalite des 200 idees (sessions 1 + 2), sans priorisation selective.**

Les 6 chantiers de la session 2 fournissent un cadre d'organisation pour l'implementation. Chaque chantier peut etre attaque independamment, et les fondations conversationnelles (chantier 1) ont un impact transversal sur toutes les autres features.
