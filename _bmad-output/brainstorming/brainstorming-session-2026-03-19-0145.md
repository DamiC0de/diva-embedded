---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: []
session_topic: 'Features et cas d usage manquants pour transformer Diva en véritable compagnon IA'
session_goals: 'Liste de features prioritaires, cas d usage par profil utilisateur (enfant/adulte/personne âgée), différenciation vs Alexa/Google Home/Siri'
selected_approach: 'ai-recommended'
techniques_used: ['Role Playing', 'Cross-Pollination', 'SCAMPER Method']
ideas_generated: 100
context_file: '/home/jojo/Documents/Projects/iaProject/Diva/_bmad/bmm/data/project-context-template.md'
session_active: false
workflow_completed: true
---

# Brainstorming Session Results — Diva Compagnon IA

**Facilitateur:** Jojo
**Facilitatrice IA:** Mary (Business Analyst)
**Date:** 2026-03-19
**Durée:** ~60 minutes
**Idées générées:** 100

## Session Overview

**Topic:** Features et cas d'usage manquants pour transformer Diva en véritable compagnon IA
**Goals:**
- Liste de features prioritaires à implémenter, triées par impact
- Cas d'usage concrets segmentés par profil (enfant, adulte, personne âgée/Alzheimer)
- Différenciation claire vs Alexa, Google Home, Siri

### Context Guidance

_Projet Diva : compagnon vocal IA sur Rock 5B+ (RK3588). Architecture existante : identification vocale WeSpeaker, mémoire Mem0, personas adaptatives par type d'utilisateur, personnalité enrichie, onboarding interactif, musique YouTube/Spotify, domotique Home Assistant, recherche web, rappels médicaments. Objectif : passer d'assistant vocal à compagnon relationnel._

## Technique Selection

**Approach:** AI-Recommended Techniques

- **Phase 1 — Role Playing (collaborative):** Incarnation de 4 personas (Marie 78 ans, Lucas 8 ans, Thomas 35 ans, Emma 14 ans) pour découvrir les vrais besoins
- **Phase 2 — Cross-Pollination (creative):** Transfert de patterns depuis l'animal de compagnie, le meilleur ami, l'aide-soignante, les jeux vidéo
- **Phase 3 — SCAMPER Method (structured):** 7 lentilles (Substituer, Combiner, Adapter, Modifier, Autres usages, Éliminer, Renverser) + exploration de domaines complémentaires (temporalité, social, santé, créativité, domotique, urgence, mobilité)

---

## Inventaire complet des 100 idées

### Thème A : Proactivité intelligente et conscience situationnelle

| # | Nom | Description | Profil | Vague |
|---|-----|-------------|--------|-------|
| 1 | Présence proactive par capteurs | Capteur Tapo détecte le passage, déclenche automatiquement le briefing matinal (jour, météo, rappels, visites). Pas besoin de wake word. | Tous | V2 |
| 8 | Notification proactive changement planning | Si le fils modifie l'événement dans son calendrier, Diva informe Marie sans qu'elle demande. Évite l'attente inutile. | Personne âgée | V2 |
| 33 | Joie au retour | Diva détecte qu'on rentre (capteur porte/Tapo) et accueille — adapté par persona. Comme un chien qui remue la queue. | Tous | V2 |
| 36 | Partage de découvertes spontanément | "Thomas, le PSG joue ce soir à 21h, tu voulais pas suivre ?" Diva partage des trouvailles basées sur les centres d'intérêt mémorisés. | Adulte | V2 |
| 45 | Conscience situationnelle | Fusion calendrier + mémoire + capteurs. "Marie, n'oublie pas ton rendez-vous à 10h. Tu veux que j'appelle un taxi ?" Trois sources, une action intelligente. | Tous | V2 |
| 50 | Gardienne de la famille | Diva voit que Marie n'a parlé à personne depuis 2 jours, que Lucas a des résultats en baisse. Vue systémique, suggestions douces. | Tous | V3 |
| 57 | Éliminer le silence mort | Micro-réactions contextuelles naturelles pendant la réflexion. "Hmm, attends voir..." lié à la question, pas générique. | Tous | V1 |
| 75 | Rappel contextuel intelligent | "Thomas, le pain !" déclenché quand Thomas rentre (capteur/BLE), pas à une heure fixe. Rappels par contexte, pas par horloge. | Adulte | V2 |
| 84 | Anticipation domotique | Marie dit "bonne nuit" → Diva éteint les lumières, vérifie la porte, baisse le chauffage. Sans demande explicite. | Personne âgée | V2 |
| 87 | Alerte anomalie domestique | Porte ouverte à 23h, four allumé 3h, capteur inondation. "Thomas, la porte d'entrée est ouverte." Surveillance passive. | Tous | V2 |

### Thème B : Mémoire relationnelle et lien émotionnel

| # | Nom | Description | Profil | Vague |
|---|-----|-------------|--------|-------|
| 4 | Conversations proactives avec callbacks mémoire | Check-ins basés sur la mémoire Mem0. "Hier tu me parlais de ton chat malade, ça va mieux ?" Pas de phrases génériques. | Tous | V1 |
| 9 | Suggestion média par mémoire | "Marie, tu aimes bien les téléfilms du mardi non ?" Pioche dans les souvenirs pour recommander. | Tous | V1 |
| 24 | Recommandation film/série par mémoire de couple | Diva cherche via brave_search les nouveautés, croise avec les goûts du couple. Guide cinéphile personnel. | Adulte | V2 |
| 38 | Mémoire des dates qui comptent | Retient anniversaires, dates importantes mentionnées une seule fois. Rappelle 2 jours avant. | Tous | V1 |
| 49 | Mémoire émotionnelle | Détecte le ton de voix, mémorise l'état émotionnel associé aux sujets. Carte émotionnelle de chaque membre. | Tous | V3 |
| 63 | Anniversaire de relation avec Diva | "Ça fait un an qu'on se connaît, Lucas ! La première chose que tu m'as demandée c'était une blague sur les dinosaures." | Tous | V4 |
| 65 | Capsules temporelles vocales | "Diva, enregistre un message pour moi que tu me passeras dans un an." Machine à souvenirs familiaux. | Tous | V3 |
| 96 | L'effet "elle me connaît" | Somme de milliers de micro-attentions. Le lundi, plus douce avec Thomas. Quand il pleut, dit à Marie "ta météo préférée !" Émerge des autres features. | Tous | V4 |
| 97 | Transmission familiale | Marie raconte ses histoires, Diva stocke. Dans 10 ans, Lucas demande "raconte quand papa était petit." Mémoire transgénérationnelle. | Famille | V3 |
| 98 | Diva s'excuse et apprend | "Ah mince, c'était quoi qui t'a pas plu ? Je noterai." Humilité visible, apprentissage par la relation. | Tous | V2 |

### Thème C : Pont familial et communication

| # | Nom | Description | Profil | Vague |
|---|-----|-------------|--------|-------|
| 2 | Connexion calendrier familial | Synchro Google Calendar / Apple Calendar. "Ton fils passe à 14h aujourd'hui." Sans que Marie ait un smartphone. | Personne âgée | V2 |
| 6 | Vérification calendrier temps réel | "C'est toujours maintenu pour 14h ?" → Check API, détecte modifications, répond honnêtement. | Tous | V2 |
| 7 | Messagerie vocale sortante | "Diva, dis à mon fils que le café est prêt" → Email (SMTP), SMS (API Free/Twilio), ou WhatsApp Business. Marie n'a pas besoin de téléphone. | Personne âgée | V2 |
| 47 | Daily standup familial | Le matin, Diva résume la journée de chaque membre. "Lucas a piscine, Emma a contrôle, Thomas le plombier à 14h." 30 secondes, tout le monde aligné. | Famille | V2 |
| 48 | Résumé stories familiales | Fin de semaine : "Cette semaine Lucas a eu 18 en dictée, Marie a aimé le documentaire sur les chats." Narration familiale. | Famille | V4 |
| 62 | Lien inter-foyers | Marie dit "dis à Thomas que je l'embrasse" → la Diva de Thomas transmet. Si Marie ne parle pas pendant 24h, la Diva de Thomas prévient. | Famille | V3 |
| 67 | Médiateur familial | Lucas et Emma se disputent pour la télé. Diva arbitre avec les faits. "Emma ça fait 45 min, Lucas t'as eu 30 hier." Neutre et factuel. | Enfants | V4 |
| 68 | Facilitateur dîner | Diva lance une question à table : "C'est quoi le meilleur moment de votre journée ?" Quiz familial, anecdotes. Anime le repas. | Famille | V4 |
| 69 | Traducteur intergénérationnel | Emma parle argot, Marie comprend rien. Diva traduit naturellement. Pont linguistique entre générations. | Famille | V4 |
| 74 | Planning semaine vocale | Dimanche soir : "Diva, c'est quoi la semaine ?" Déroule le planning croisé de toute la famille. | Adulte | V2 |

### Thème D : Enfants — éducation et divertissement

| # | Nom | Description | Profil | Vague |
|---|-----|-------------|--------|-------|
| 13 | Accueil après l'école | Détection arrivée (capteur/horaire) + accueil chaleureux. "Salut Lucas ! Raconte-moi ta journée !" Avec callbacks mémoire. | Enfant | V2 |
| 14 | Routine goûter → devoirs | Diva guide sans imposer : "Prends ton goûter, quand t'es prêt on attaque les devoirs." Cadre bienveillant. | Enfant | V2 |
| 15 | Aide aux devoirs interactive | Tuteur patient qui guide sans donner les réponses. "L'auxiliaire avoir, et le participe passé de manger c'est..." S'adapte au niveau. | Enfant | V2 |
| 16 | Résumé parental | "Lucas est rentré à 16h35, on a travaillé la conjugaison, il a galéré sur le passé composé." Résumé nounou via dashboard ou notification. | Parents | V2 |
| 17 | Filtre contenu strict intelligent | Pas un blocage binaire — Diva REDIRIGE avec malice. "Les films d'horreur c'est pas pour maintenant ! Mais un dessin animé avec des fantômes rigolos ?" | Enfant | V1 |
| 18 | Recommandation animés par mémoire | "T'avais adoré Dragon Ball ! Naruto c'est pareil avec des ninjas, tu veux ?" Profil de goûts progressif. | Enfant | V1 |
| 19 | Contrôle parental dashboard | Parents définissent : catégories, durée max, plages horaires. Diva applique naturellement avec transitions douces. | Parents | V2 |
| 20 | Activités interactives vocales | Quiz, devinettes, histoires interactives à choix, blind test, blagues. Divertissement sans écran. | Enfant | V2 |
| 41 | Quêtes familiales gamifiées | "Lucas, quête du jour : range ta chambre → 30 min de musique bonus !" Parents configurent via dashboard. | Enfant | V3 |
| 42 | Arbre de compétences RPG | "T'es niveau 3 en conjugaison, niveau 2 en multiplications. On bosse les multis ?" Devoirs = RPG éducatif vocal. | Enfant | V3 |
| 46 | Pipeline éducatif complet | Devoirs (tuteur) + points (gamification) + résumé (reporting). Trois features fusionnées. | Enfant/Parents | V3 |
| 59 | Enfants enseignent à Diva | "Diva, tu sais pas ce qu'est un Pokémon Légendaire ? Je t'explique !" L'enfant est expert, Diva est élève curieuse. Valorisant. | Enfant | V3 |
| 64 | Diva grandit avec l'enfant | Lucas 8 ans → vocabulaire simple. Lucas 10 ans → plus riche. Lucas 13 ans → mode ado. Adaptation progressive automatique. | Enfant | V3 |
| 79 | Conteur d'histoires personnalisées | Histoires générées en temps réel avec le prénom de l'enfant, ses amis, ses passions. "Et Lucas le chevalier retrouva son ami Théo..." | Enfant | V2 |

### Thème E : Ados — espace personnel et confiance

| # | Nom | Description | Profil | Vague |
|---|-----|-------------|--------|-------|
| 28 | Révisions brevet interactives | "Diva, interroge-moi sur la Seconde Guerre mondiale." Quiz, corrections sans jugement, encouragements. Privé. | Ado | V2 |
| 29 | DJ personnel découverte musicale | "Mets un truc dans le style de Ninho que je connais pas." Mémorise les réactions (skip = pas aimé). | Ado | V1 |
| 30 | Confident nocturne | 23h, Emma angoisse. Diva écoute, rassure, propose respiration. RIEN ne remonte aux parents. Espace safe et confidentiel. | Ado | V3 |
| 31 | Alarme et routine matin ado | "Réveille-moi à 7h avec du Aya Nakamura." Puis programme du jour, ton cool pas maternel. | Ado | V2 |
| 32 | Réponses questions gênantes | Questions qu'Emma ne posera jamais aux parents. Réponses franches, adaptées, sans moraliser. Source fiable vs TikTok. | Ado | V3 |
| 80 | Co-auteur créatif | "Aide-moi à trouver une rime avec étoile" ou "mon personnage est coincé dans une grotte, qu'est-ce qui pourrait se passer ?" Inspiration, pas remplacement. | Ado | V4 |
| 81 | Journal intime vocal | "Diva, mode journal." Parler librement, stockage PRIVÉ, inaccessible aux parents. Journaling sans barrière de l'écriture. | Ado | V3 |

### Thème F : Personnes âgées — autonomie et sécurité

| # | Nom | Description | Profil | Vague |
|---|-----|-------------|--------|-------|
| 3 | Check-in émotionnel doux | "Marie, comment tu te sens ce matin ?" Une seule fois, sans insister. Si pas de réponse, Diva se tait. Le bon voisin. | Personne âgée | V1 |
| 5 | Niveau d'initiative configurable | Réglage par persona : de "silencieux" à "bavard". Pour Marie seule, plus haut. Pour Thomas, bas. Ajustable via dashboard. | Tous | V1 |
| 12 | Présence nocturne rassurante | Mode nuit : voix basse, wake word sensible. "Je suis là Marie, tout va bien. Il est 3h, tu veux de la musique douce ?" + alerte si absence prolongée. | Personne âgée | V3 |
| 34 | Présence silencieuse | Mode ambiance — son doux à peine audible (ronronnement, musique) qui rappelle que Diva est là. Anti-silence pour les personnes seules. | Personne âgée | V4 |
| 39 | Détection changement comportement | Marie ne répond plus au check-in 2 jours de suite, ou répète 5× la même question. Alerte discrète au fils. Monitoring comportemental. | Personne âgée | V3 |
| 40 | Stimulation cognitive douce | "Marie, tu te souviens de ce qu'on a fait hier ?" Exercices mémoire intégrés naturellement dans la conversation. Résultats trackés. | Personne âgée | V3 |
| 52 | Journal de vie passif | 6 mois d'interactions = journal de vie. Le fils consulte "Comment va ma mère ?" Marie consulte "Qu'est-ce qu'on a fait la semaine dernière ?" | Personne âgée | V3 |
| 53 | Patterns interaction → indicateur santé | Heure de lever, nb interactions, durée, complexité vocabulaire, répétitions → score bien-être hebdomadaire. Biomarqueur passif. | Personne âgée | V3 |
| 54 | Quêtes douces personnes âgées | "Marie, aujourd'hui le défi c'est de sortir marcher 10 minutes !" Gamification légère adaptée, encouragements. | Personne âgée | V4 |
| 71 | Suivi hydratation alimentation | "Marie, t'as bu un verre d'eau ? Il fait chaud." Rappels doux basés météo/heure. Alertes si Marie ne mange pas. Vital en canicule. | Personne âgée | V2 |
| 72 | Journal sommeil passif | "Bonne nuit" → heure. "Bonjour" → heure. Capteur mouvement nuit. Pattern de sommeil sur semaines, signal pour médecin. | Personne âgée | V3 |
| 76 | Support malvoyants | Diva lit les courriers (caméra + OCR), décrit la météo, aide à identifier. Accès au monde visuel par la voix. | Accessibilité | V4 |
| 77 | Compagnon de convalescence | Post-opération : structure les journées, rappelle médocs, propose activités adaptées, prend des nouvelles. Continuité de soins. | Santé | V4 |
| 85 | Détection de chute par le son | Bruit sourd + silence → "Marie, tout va bien ?" Pas de réponse 30s → répète. 1 min → appelle fils + secours. Micro toujours là. | Personne âgée | V3 |

### Thème G : Personnalité et relation authentique

| # | Nom | Description | Profil | Vague |
|---|-----|-------------|--------|-------|
| 37 | Humour et vannes personnalisées | "Encore du foot Thomas !" Taquineries calibrées par persona. L'humour crée du lien. | Tous | V1 |
| 44 | Voix plus expressive (TTS émotionnel) | Voix qui rit, baisse le ton la nuit, est enthousiaste. TTS cloud (ElevenLabs) pour moments clés, Piper en fallback. | Tous | V3 |
| 55 | Zéro syntaxe | "Mon fils vient à 14h" → Diva comprend que c'est un rappel sans dire "crée un rappel." Zéro courbe d'apprentissage. | Tous | V1 |
| 58 | Diva pose les questions | "Thomas, t'as regardé quoi comme série en ce moment ?" Diva construit sa connaissance en posant des questions par curiosité. | Tous | V2 |
| 60 | Diva raconte sa journée | "Aujourd'hui j'ai aidé Lucas en maths, j'ai discuté avec Marie, et j'ai trouvé une recette de gratin." Continuité narrative, Diva existe. | Tous | V2 |
| 61 | La famille façonne la personnalité | "Diva, tu devrais être plus drôle." Diva évolue par les interactions. Chaque famille a une Diva unique. Personnalité cultivée, pas configurée. | Tous | V4 |
| 66 | Bilan de fin d'année | 31 décembre : "En 2026, Lucas a découvert Naruto, Emma a eu son brevet, Marie a commencé le jardinage, Thomas a enfin appelé le plombier... en septembre." | Famille | V4 |
| 89 | Culture générale au fil de l'eau | "Au fait Thomas, tu savais que la tour Montparnasse a failli ne jamais être construite ?" Anecdotes liées aux conversations passées. | Adulte | V4 |
| 99 | Diva a des préférences et opinions | "Perso je trouve qu'Interstellar c'est mieux que Gravity, mais c'est toi qui vois !" Un compagnon sans opinions c'est un outil. | Tous | V4 |
| 100 | Rituels familiaux émergents | Le quiz du dimanche, la blague du matin de Lucas, le "bonne nuit Diva" de Marie. Rituels non programmés qui émergent et se renforcent. | Famille | V4 |

### Thème H : Domotique émotionnelle et routines

| # | Nom | Description | Profil | Vague |
|---|-----|-------------|--------|-------|
| 82 | Automatismes par conversation | "Tous les soirs quand je rentre, tamise les lumières et mets FIP." Routines construites par la parole, pas par une app. | Adulte | V1 |
| 83 | Scènes émotionnelles | "Ambiance soirée tranquille" = lumières basses + musique douce. "C'est la fête !" = lumières vives + musique. Domotique par émotion. | Tous | V2 |
| 92 | Mode invité intelligent | "Diva, ce soir on a des invités." Mode social : rien de personnel, polie, musique d'ambiance, mot de passe wifi si autorisé. | Adulte | V4 |
| 93 | Aide planification événements | "On fait un anniversaire pour Lucas samedi, 8 enfants." Diva aide : liste courses goûter, jeux, rappels de préparation. | Adulte | V4 |

### Thème I : Identification et capteurs

| # | Nom | Description | Profil | Vague |
|---|-----|-------------|--------|-------|
| 35 | Identification multi-capteurs | Croise heure + capteur présence + BLE téléphone + micro-identification vocale. Sait qui est là sans forcer d'interaction. | Tous | V3 |
| 43 | Wake word remplacé par présence | Pour personnes âgées et enfants, mode "toujours à l'écoute" quand capteur détecte la personne. Filtrage local NPU Qwen. | Personne âgée/Enfant | V3 |
| 51 | Identification vocale → sécurité | Voix inconnue à 3h du matin sans famille identifiée → alerte silencieuse au téléphone de Thomas. Sous-produit de WeSpeaker. | Tous | V3 |
| 86 | Mode urgence familiale | "Diva, urgence !" → appelle contacts d'urgence, active lumières, instructions premiers secours. Calme dans la panique. | Tous | V3 |

### Thème J : Mobilité et services connectés

| # | Nom | Description | Profil | Vague |
|---|-----|-------------|--------|-------|
| 10 | Découverte musicale par goûts | "J'ai trouvé une chanteuse qui ressemble à Dalida, tu veux écouter ?" Recommandation par relation, pas par algorithme. | Tous | V1 |
| 11 | Programme TV temps réel | API guide programmes, croisé avec mémoire. "Documentaire sur les chats sur Arte à 21h, ça pourrait te plaire vu Minou !" | Tous | V2 |
| 25 | Capture charge mentale | "Faut rappeler le plombier" → capturé → rappelé lundi matin. Déchargement verbal naturel, zéro friction. | Adulte | V1 |
| 26 | Liste courses collaborative | N'importe qui dit "on n'a plus de lait" → ajouté. Au supermarché : "Diva, la liste ?" Toute la famille contribue vocalement. | Famille | V1 |
| 27 | Briefing soirée état du foyer | "Lucas a fait ses devoirs, la petite a fait sa sieste, rappel médecin demain, facture EDF vendredi." CRM familial vocal. | Adulte | V2 |
| 73 | Assistant cuisine temps réel | Mains dans la farine : "C'est quoi la prochaine étape ?" Diva lit pas à pas, attend, répète. Cuisine mains libres. | Adulte | V2 |
| 78 | Support multilingue familles mixtes | Grand-mère parle portugais, enfants français. Diva traduit en temps réel. Prof de langue familial intégré. | Famille | V4 |
| 88 | Coach linguistique conversationnel | "Diva, 10 minutes d'anglais." Conversation en anglais, corrections naturelles, niveau adapté. Immersion micro-dosée quotidienne. | Adulte/Ado | V4 |
| 90 | Résumé actualité personnalisé | Le matin : "Les 3 infos qui t'intéressent : PSG 2-1, essence baisse, nouveau Tarantino vendredi." Journal personnel vocal. | Adulte | V2 |
| 91 | Rappels soins animaux | "Marie, tu as donné à manger à Minou ?" Rappels vétérinaire, vermifuges, vaccins. L'animal intégré dans la vie du foyer. | Tous | V1 |
| 94 | Diva sur le téléphone | App ou numéro dédié. Au supermarché : "Diva, la liste de courses ?" La relation continue hors de la maison. | Tous | V4 |
| 95 | Connexion voiture | Via Android Auto/CarPlay/Bluetooth. "Diva, mets ma playlist de route." Continuité maison → voiture → retour. | Adulte | V4 |

### Thème K : Santé et bien-être

| # | Nom | Description | Profil | Vague |
|---|-----|-------------|--------|-------|
| 70 | Coach respiration et gestion stress | Détecte le stress dans la voix. "Thomas, t'as l'air tendu. 2 min de respiration ?" Guide cohérence cardiaque. Au bon moment. | Tous | V3 |

### Thème L : Relais parental

| # | Nom | Description | Profil | Vague |
|---|-----|-------------|--------|-------|
| 21 | Mode relais parental | "Diva, occupe-toi des devoirs de Lucas, je vais donner le bain." Diva prend une mission parentale + débrief au retour. | Parents | V2 |
| 22 | Mode occupation enfants | "Diva, occupe les enfants le temps du repas." Enchaîne quiz, blind test, histoires, adapté aux enfants présents. | Parents | V2 |
| 23 | Contexte multi-utilisateurs | Diva sait qui est dans la pièce et adapte. Thomas demande pour les enfants → filtre enfant appliqué. Deux contextes en parallèle. | Famille | V3 |
| 56 | Zéro dashboard pour non-tech | Marie ne va jamais sur un dashboard. Tout se fait en parlant. Le dashboard est pour les tech-savvy, jamais un prérequis. | Personne âgée | V1 |

---

## Roadmap complète — 4 vagues d'implémentation

### Vague 1 — Quick wins (semaines 1-2)

_Features implémentables rapidement avec l'architecture existante_

| # | Feature | Effort | Impact |
|---|---------|--------|--------|
| 4 | Conversations proactives callbacks mémoire | Brancher Mem0 sur le proactive scheduler | Haut |
| 5 | Niveau d'initiative configurable | 1 champ JSON persona + logique scheduler | Haut |
| 25 | Capture charge mentale (rappels naturels) | Tool "create_reminder" pour Claude | Haut |
| 26 | Liste courses collaborative vocale | Exposer shopping-list.ts comme tool Claude | Moyen |
| 55 | Zéro syntaxe (intention implicite) | Amélioration du system prompt Claude | Haut |
| 82 | Automatismes domotiques conversationnels | Tool "create_routine" via Home Assistant | Haut |
| 91 | Rappels soins animaux | Même infra que #25 | Moyen |
| 57 | Fillers contextuels intelligents | Améliorer filler-manager.ts | Moyen |
| 3 | Check-in émotionnel doux | Améliorer proactive scheduler | Haut |
| 37 | Humour et vannes personnalisées | Enrichir system prompt | Moyen |
| 9 | Suggestion média par mémoire | Mem0 + system prompt | Moyen |
| 38 | Mémoire des dates | Mem0 capture + rappel tool | Moyen |
| 17 | Filtre contenu intelligent enfants | Logique dans persona + prompt | Haut |
| 18 | Recommandation animés par mémoire | Mem0 + yt-dlp search | Moyen |
| 29 | DJ personnel ado | Mem0 + youtube-player.ts | Moyen |
| 10 | Découverte musicale par goûts | Mem0 + youtube-player.ts | Moyen |
| 56 | Zéro dashboard pour non-tech | Tout vocal pour personas elderly | Moyen |

### Vague 2 — Features structurantes (semaines 3-6)

_Le cœur de la transformation en compagnon_

| # | Feature | Effort | Dépendances |
|---|---------|--------|-------------|
| 1 + 33 | Capteurs → briefing + accueil | Moyen | Webhook Tapo → HA → Diva |
| 2 + 6 + 8 | Calendrier Google/Apple + notifications | Moyen | API Google Calendar |
| 7 | Messagerie sortante (email/SMS) | Faible | SMTP + API Free/Twilio |
| 15 + 14 | Aide devoirs + routine | Moyen | Structurer flow éducatif |
| 16 | Résumé parental | Faible | Dashboard + notifications |
| 19 | Contrôle parental dashboard | Moyen | Dashboard UI + persona rules |
| 20 | Activités interactives vocales | Moyen | Quiz engine + histoires |
| 21 + 22 | Relais parental + occupation enfants | Moyen | Mode mission Claude |
| 79 | Conteur histoires personnalisées | Faible | Claude + Mem0 |
| 28 | Révisions brevet interactives | Moyen | Quiz engine adapté ado |
| 31 | Alarme et routine matin ado | Faible | Timer + TTS + persona |
| 58 + 60 | Diva pose questions + raconte sa journée | Moyen | Journal interne + prompt |
| 98 | Diva s'excuse et apprend | Faible | Enrichir prompt |
| 11 | Programme TV temps réel | Moyen | API xmltv/scraping |
| 24 | Recommandation film/série couple | Faible | Brave search + Mem0 |
| 27 | Briefing soirée état du foyer | Moyen | Agrégation dashboard data |
| 47 | Daily standup familial | Faible | Calendrier + scheduler |
| 71 | Suivi hydratation | Faible | Rappels contextuels + météo API |
| 73 | Assistant cuisine temps réel | Moyen | Recette search + step engine |
| 74 | Planning semaine vocale | Faible | Calendrier API |
| 75 | Rappel contextuel intelligent | Moyen | Capteurs + rappels |
| 83 | Scènes émotionnelles domotique | Moyen | HA scènes prédéfinies |
| 84 | Anticipation domotique | Moyen | Routines auto + capteurs |
| 87 | Alerte anomalie domestique | Moyen | HA sensors → alertes |
| 90 | Résumé actualité personnalisé | Faible | Brave search + Mem0 |
| 13 | Accueil après l'école | Faible | Capteur/horaire + persona |
| 36 | Partage découvertes spontané | Moyen | Scheduler + Mem0 + search |
| 45 | Conscience situationnelle | Élevé | Fusion calendrier + Mem0 + capteurs |

### Vague 3 — Killer features (mois 2-3)

_Différenciation profonde, ce que personne d'autre ne fait_

| # | Feature | Effort | Complexité |
|---|---------|--------|------------|
| 62 | Lien inter-foyers | Élevé | Backend cloud léger entre 2 Rock |
| 85 + 39 | Détection chute + changement comportement | Élevé | Analyse audio + patterns Mem0 |
| 97 + 65 | Transmission familiale + capsules temporelles | Moyen | Stockage long terme + narration |
| 64 | Diva grandit avec l'enfant | Moyen | Analyse progressive interactions |
| 49 | Mémoire émotionnelle | Élevé | Analyse sentiment NPU |
| 44 | TTS expressif (ElevenLabs) | Moyen | TTS cloud hybride |
| 35 | Identification multi-capteurs BLE | Élevé | BLE scan + phone ID |
| 43 | Wake word → détection présence | Élevé | NPU filtrage continu |
| 51 | Sécurité par identification vocale | Moyen | WeSpeaker + alertes |
| 86 | Mode urgence familiale | Moyen | Protocole appels + HA |
| 23 | Contexte multi-utilisateurs | Élevé | Gestion sessions parallèles |
| 30 | Confident nocturne ado | Moyen | Mode privé + détection détresse |
| 32 | Réponses questions gênantes ado | Moyen | Filtre contenu "mild" + prompt |
| 81 | Journal intime vocal ado | Moyen | Stockage privé par persona |
| 12 | Présence nocturne rassurante | Moyen | Mode nuit + capteurs |
| 40 | Stimulation cognitive | Moyen | Quiz intégré conversation |
| 41 + 42 | Quêtes gamifiées + arbre compétences | Élevé | Game engine complet |
| 46 | Pipeline éducatif complet | Élevé | Fusion tuteur + gamif + rapport |
| 50 | Gardienne de la famille (vue systémique) | Élevé | Analyse croisée tous membres |
| 52 | Journal de vie passif | Moyen | Agrégation Mem0 longue durée |
| 53 | Patterns → indicateur santé | Élevé | Scoring bien-être algorithmique |
| 59 | Enfants enseignent à Diva | Faible | Mode "élève" dans prompt |
| 70 | Coach respiration stress | Faible | Détection ton + exercices guidés |
| 72 | Journal sommeil passif | Moyen | Timestamp interactions + capteurs |

### Vague 4 — Enrichissement continu (mois 3+)

_Polish, cas d'usage secondaires, long-terme_

| # | Feature | Catégorie |
|---|---------|-----------|
| 34 | Présence silencieuse (ambiance) | Bien-être |
| 48 | Stories familiales hebdo | Communication |
| 54 | Quêtes douces personnes âgées | Personnes âgées |
| 61 | Famille façonne la personnalité | Personnalité |
| 63 | Anniversaire relation Diva | Lien émotionnel |
| 66 | Bilan de fin d'année | Narration |
| 67 | Médiateur familial | Communication |
| 68 | Facilitateur dîner | Communication |
| 69 | Traducteur intergénérationnel | Communication |
| 76 | Support malvoyants | Accessibilité |
| 77 | Compagnon convalescence | Santé |
| 78 | Support multilingue | Accessibilité |
| 80 | Co-auteur créatif ado | Ado |
| 88 | Coach linguistique | Apprentissage |
| 89 | Culture générale au fil de l'eau | Apprentissage |
| 92 | Mode invité intelligent | Domotique |
| 93 | Aide planification événements | Organisation |
| 94 | Diva sur le téléphone | Mobilité |
| 95 | Connexion voiture | Mobilité |
| 96 | L'effet "elle me connaît" | Émergent |
| 99 | Diva a des opinions | Personnalité |
| 100 | Rituels familiaux émergents | Émergent |

---

## Différenciation vs Alexa / Google Home / Siri

| Dimension | Alexa/Google/Siri | Diva |
|-----------|-------------------|------|
| **Paradigme** | Assistant qui attend des commandes | Compagnon qui vit avec la famille |
| **Mémoire** | Zéro mémoire relationnelle | Mémoire émotionnelle long-terme (Mem0) |
| **Personnalité** | Identique pour tous | Unique par famille, façonnée par la relation |
| **Proactivité** | Notifications génériques | Actions contextuelles basées sur capteurs + mémoire + calendrier |
| **Enfants** | Réponses non filtrées ou blocage froid | Tuteur patient, conteur, compagnon de jeu avec filtre intelligent |
| **Personnes âgées** | Aucune adaptation | Check-ins, stimulation cognitive, détection chute, lien familial |
| **Communication** | Aucun pont entre membres | Messagerie inter-foyers, standup familial, résumé parental |
| **Vie privée** | Données envoyées au cloud | Traitement local (NPU), mémoire locale, Claude API uniquement pour conversation |
| **Évolution** | Statique | Diva grandit avec l'enfant, mûrit avec la famille |
| **Attachement** | Remplaçable immédiatement | Switching cost émotionnel après 6 mois |

---

## Session Summary

### Achievements
- **100 idées** générées en ~60 minutes à travers 3 techniques complémentaires
- **10 thèmes** identifiés couvrant tous les aspects du compagnon IA
- **4 vagues** d'implémentation séquencées par impact et faisabilité
- **4 profils** utilisateur explorés en profondeur (Marie, Lucas, Thomas, Emma)
- **Différenciation** claire articulée sur 10 dimensions vs les concurrents

### Creative Breakthroughs
- La **mémoire relationnelle** comme moteur de différenciation irremplaçable (#96, #97)
- Le **pont familial** inter-foyers comme killer feature unique (#62)
- Le **relais parental** comme cas d'usage tueur pour les familles (#21, #22)
- La **détection passive** (chute, comportement, sommeil) comme outil de santé (#85, #39, #53)
- La **personnalité émergente** façonnée par la famille (#61, #100)

### Facilitation Narrative
Session remarquable par l'implication de Jojo dans chaque persona — particulièrement forte sur les cas d'usage personnes âgées (Marie) et enfants (Lucas). L'approche pragmatique de Jojo a systématiquement ramené les idées vers la faisabilité technique, notamment la question clé de l'identification sans voix (capteurs BLE) qui a déclenché une cascade d'idées sur les capteurs. La cross-pollination depuis le domaine animal de compagnie et meilleur ami a produit les idées les plus émotionnellement fortes de la session.
