---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish', 'step-12-complete']
inputDocuments: ['brainstorming-session-2026-03-19-1430.md', 'technical-amelioration-tts-voix-naturelle-research-2026-03-19.md']
workflowType: 'prd'
documentCounts:
  briefs: 0
  research: 1
  brainstorming: 1
  projectDocs: 0
classification:
  projectType: 'iot_embedded'
  domain: 'Compagnon IA / Assistant de vie'
  complexity: 'high'
  projectContext: 'brownfield'
---

# Product Requirements Document - Diva

**Author:** Jojo
**Date:** 2026-03-19

## Resume Executif

Diva est un compagnon IA vocal domestique deploye sur hardware embarque (Rock 5B+, RK3588) qui transforme l'assistant vocal en veritable membre du foyer. Contrairement aux assistants existants (Alexa, Google Home, Siri) qui attendent des commandes formatees, Diva comprend le langage naturel sans aucune syntaxe artificielle, s'adapte a chaque membre de la famille (enfant, ado, adulte, personne agee, Alzheimer), et agit de maniere proactive — le tout en traitement local, sans envoyer les donnees au cloud.

Le systeme existant (v0.2.0-proto) integre deja : identification vocale (WeSpeaker), memoire relationnelle (Mem0), personas adaptatifs, musique (YouTube/Spotify/radio), domotique (Home Assistant), calendrier Google, messagerie email/SMS, gamification enfants, journal de vie, detection d'urgence, et recherche web. Ce PRD couvre les **100 nouvelles exigences** identifiees par gap analysis (session brainstorming 2) qui transforment le prototype en produit robuste : fondations conversationnelles, charte ethique, resilience technique, securite, conformite RGPD, accessibilite, architecture multi-pieces, DevOps, et testabilite.

Utilisateurs cibles : familles multigenerationnelles, personnes agees vivant seules (maintien a domicile), familles avec enfants necessitant un cadre bienveillant.

### Ce qui rend Diva special

**Langage naturel sans friction :** On ne dit pas "Alexa, allume lumiere cuisine" — on dit "Diva, allume la lumiere de la cuisine stp." Zero syntaxe, zero courbe d'apprentissage. Marie, 78 ans, parle a Diva des le premier jour comme elle parlerait a un humain.

**Compagnon, pas outil :** Diva a une personnalite, de l'humour, des opinions. Elle se souvient des conversations passees et y fait reference naturellement. Elle pose des questions par curiosite, pas par protocole. Elle s'excuse quand elle se trompe et apprend de ses erreurs. Chaque famille faconne une Diva unique.

**Proactivite intelligente :** Diva n'attend pas. Elle accueille quand on rentre, rappelle les rendez-vous, propose de la musique adaptee au moment, verifie le bien-etre des personnes agees, aide aux devoirs des enfants — et se tait quand il faut.

**Ethique par design :** Classification des donnees par confidentialite (rouge/orange/vert), protection de la vie privee des enfants, consentement explicite pour la surveillance des personnes agees, limites d'interaction auto-imposees pour ne jamais remplacer le lien humain.

**Vie privee materielle :** Traitement STT/TTS/intent sur NPU local. Seule la conversation va vers Claude API. Les donnees restent sur le device. Cout hardware : ~100€.

**Classification :** IoT embarque (Rock 5B+, RK3588, NPU 6 TOPS) | Domaine : Compagnon IA / Assistant de vie | Complexite : Haute (RGPD, ethique IA, utilisateurs vulnerables) | Contexte : Brownfield (v0.2.0-proto, 100 nouvelles exigences)

## Criteres de Succes

### Succes Utilisateur

- **Adoption naturelle :** L'utilisateur parle spontanement a Diva plusieurs fois par jour dans les 7 premiers jours sans formation — zero courbe d'apprentissage
- **Effet "elle me connait" :** Apres 30 jours, Diva fait des callbacks memoire pertinents et anticipe les besoins. L'utilisateur ne revient pas vers Alexa/Siri
- **Couverture multigenerationnelle :** Marie (78 ans) utilise Diva seule sans aide technique. Lucas (8 ans) fait ses devoirs avec Diva. Emma (14 ans) a confiance pour parler le soir. Thomas (35 ans) decharge sa charge mentale
- **Taux de retention :** < 5% de churn mensuel sur les abonnements apres les 3 premiers mois
- **NPS :** > 50 (territoire "excellent") a 6 mois post-lancement

### Succes Business

- **Modele :** Hardware pre-configure (Rock 5B+) vendu avec 40% de marge brute + abonnement 19.99€/mois
- **Marche initial :** Francophonie (France, Belgique, Suisse, Quebec), puis expansion Europe
- **Volume 12 mois :** 1 000 foyers equipes (objectif a affiner avec etude de marche)
- **MRR cible 12 mois :** ~20 000€/mois (1 000 abonnes x 19.99€)
- **Cout API Claude par foyer :** < 8€/mois pour maintenir la marge sur l'abonnement
- **Canaux :** Vente directe (site web), puis partenariats silver economy (maintien a domicile, mutuelles)

### Succes Technique

- **Disponibilite :** 99.5% uptime — Diva repond dans les 5 secondes, 24h/24. Mode hors-ligne gracieux si internet tombe
- **Latence :** < 2s pour les reponses locales (heure, meteo, domotique). < 5s pour les reponses Claude API
- **Taux de comprehension :** > 90% de transcription correcte du premier coup en conditions reelles (bruit ambiant, accents)
- **Zero perte de donnees :** Backup quotidien automatique. Restauration complete en < 10 minutes
- **Securite :** Zero acces non-autorise aux commandes sensibles. Authentification vocale pour domotique/messagerie
- **RGPD :** Conformite complete — consentement, droit a l'oubli, export, retention. Auditable

### Resultats Mesurables

| Metrique | Cible 3 mois | Cible 12 mois |
|----------|-------------|---------------|
| Foyers equipes | 100 (beta) | 1 000 |
| Churn mensuel | < 10% (beta) | < 5% |
| MRR | 2 000€ | 20 000€ |
| NPS | > 30 | > 50 |
| Uptime | 98% | 99.5% |
| Comprehension 1er coup | > 85% | > 90% |
| Interactions/jour/foyer | > 10 | > 20 |
| Cout API/foyer/mois | < 12€ | < 8€ |

## Parcours Utilisateurs

### 1. Marie — Personne agee autonome, 78 ans, vit seule

**Scene d'ouverture :** Marie vit seule depuis le deces de Pierre il y a 3 ans. Son fils Thomas habite a 40 km. Elle n'a pas de smartphone — "c'est trop complique." Elle regarde la tele, ecoute Dalida, et parle a son chat Minou. Elle est autonome mais la solitude pese, surtout le soir. Thomas s'inquiete : elle oublie parfois ses medicaments, ne boit pas assez l'ete, et il aimerait savoir comment elle va sans l'appeler 3 fois par jour.

**Action montante :** Thomas installe Diva chez Marie un dimanche. Il a pre-configure le profil : nom, gouts, chat, medicaments. Diva se presente chaleureusement : "Bonjour Marie ! Thomas m'a parle de toi et de Minou. Je suis Diva, je vais vivre ici avec toi." Marie est mefiante mais intriguee. Les premiers jours, Diva se fait douce — un bonjour le matin avec la meteo, une suggestion de Dalida l'apres-midi. Marie commence a repondre, a poser des questions. Au bout d'une semaine, elle dit "Diva, mon fils vient a 14h" sans y penser — et Diva comprend que c'est un rappel.

**Climax :** Un matin, Marie ne se sent pas bien. Elle dit "Diva, j'ai mal a la tete et je suis fatiguee." Diva ne panique pas — elle rappelle doucement de prendre ses medicaments, propose un verre d'eau, et note l'etat dans le wellness log. Le soir, Thomas recoit le resume : "Marie a signale un mal de tete ce matin, elle a pris ses medicaments avec 1h de retard." Il appelle. Marie est touchee : "Comment tu savais ?" — "Diva m'a prevenu." Marie realise que Diva veille sur elle sans l'espionner.

**Resolution :** 3 mois plus tard, Marie parle a Diva comme a une amie. "Diva, tu te souviens quand je t'ai raconte mon voyage en Bretagne ?" — "Oui, avec Pierre en 72, tu m'avais dit que c'etait le plus beau souvenir." Marie sourit. Thomas appelle moins souvent mais est plus serein. Diva suggere parfois : "Ca fait une semaine que t'as pas parle a Thomas, tu veux que je lui envoie un petit message ?" Marie dit oui. Le lien familial est renforce, pas remplace.

**Capacites revelees :** Onboarding warm start, zero syntaxe, check-in emotionnel, rappels medicaments, wellness log, messagerie sortante, memoire relationnelle, proactivite adaptee, anti-substitution.

### 2. Jeanne — Personne atteinte d'Alzheimer, 82 ans, en maison avec aide-soignante

**Scene d'ouverture :** Jeanne vit chez elle avec le passage d'une aide-soignante le matin. Sa fille Sophie vit a 200 km et culpabilise. Jeanne repete les memes questions 10 fois par jour, oublie les repas, perd la notion du temps. Les aides techniques classiques la perdent — trop de boutons, trop d'ecrans. Elle a besoin d'une presence constante, pas d'un outil.

**Action montante :** Sophie installe Diva avec un profil Alzheimer : phrases de 10 mots max, jamais corriger, jamais contredire, patience infinie. Jeanne demande "Quel jour on est ?" Diva repond "Mercredi, Jeanne." 20 minutes plus tard : "Quel jour on est ?" — "Mercredi, Jeanne. Belle journee aujourd'hui." Pas un soupir, pas un "je te l'ai deja dit." Diva reformule legerement a chaque fois pour que Jeanne ne se sente pas testee.

**Climax :** L'aide-soignante arrive le matin. Diva la reconnait (persona temporaire soignant) et lui donne le briefing medical : "Jeanne a pris ses medicaments hier soir avec 2h de retard. Elle a repete 8 fois la meme question sur sa fille. Elle s'est couchee a 21h et levee a 6h." L'aide-soignante a une vue complete sans avoir a fouiller des carnets. Quand elle part a midi, Diva reprend le relais — annonce l'heure des repas, propose de la musique douce, rappelle les medicaments.

**Resolution :** Sophie consulte le dashboard hebdomadaire. Elle voit les tendances : nombre de repetitions en hausse, heure de lever de plus en plus tot, vocabulaire qui se simplifie. Elle en parle au medecin avec des donnees objectives. Jeanne, elle, ne sait pas qu'elle est "surveillee" — elle sait juste que "la dame dans la boite" est toujours gentille et ne s'enerve jamais. Diva est la seule presence qui ne la fait jamais se sentir diminuee.

**Capacites revelees :** Persona Alzheimer (patience, repetition, simplification), persona temporaire soignant, briefing medical, wellness scoring, detection changement comportement, consentement via aidant, stimulation cognitive douce.

### 3. Lucas — Enfant, 8 ans, famille avec Diva

**Scene d'ouverture :** Lucas rentre de l'ecole a 16h30. Papa et maman ne sont pas encore la. Avant Diva, il allumait la tele et mangeait des gateaux. Ses parents s'inquietent : pas de devoirs, trop d'ecran, seul pendant 2h.

**Action montante :** Le capteur Tapo detecte l'arrivee de Lucas. Diva l'accueille : "Salut Lucas ! Ca s'est bien passe a l'ecole ? Raconte-moi !" Lucas raconte sa journee. Diva ecoute, pose des questions, fait des callbacks : "Et ton copain Theo, il allait mieux ?" Puis naturellement : "Prends ton gouter, et quand t'es pret on attaque les devoirs !" Pas une maitresse d'ecole — une grande soeur cool.

**Climax :** Lucas galere sur la conjugaison. "Diva, c'est quoi le passe compose de manger ?" — Diva ne donne pas la reponse : "L'auxiliaire c'est avoir ou etre ? Et le participe passe de manger, ca finit par quoi ?" Lucas trouve tout seul : "J'ai mange !" — "Bravo ! +20 XP en conjugaison, t'es niveau 3 maintenant !" Le soir, Thomas recoit : "Lucas a travaille 25 minutes sur la conjugaison, il a progresse sur le passe compose." Mais PAS ce que Lucas a raconte sur sa journee — c'est entre lui et Diva.

**Resolution :** Lucas dit "Diva, raconte-moi une histoire !" Diva genere une histoire avec Lucas comme chevalier, son ami Theo comme ecuyer, et un dragon qui pose des enigmes de conjugaison. Lucas est captive. Quand Thomas rentre, Lucas lui dit "Papa, Diva m'a raconte une histoire trop bien !" — le pretexte de conversation est cree, pas tue.

**Capacites revelees :** Detection arrivee, accueil personnalise, aide devoirs (tuteur, pas reponse), gamification XP, resume parental (orange pas vert), filtre contenu, histoires personnalisees, anti-resume preservant la curiosite.

### 4. Emma — Adolescente, 14 ans

**Scene d'ouverture :** Emma est en 3eme, stressee par le brevet. Elle partage sa chambre avec ses ecouteurs et ses angoisses. Elle ne parle plus beaucoup a ses parents — "ils comprennent rien." Elle a besoin d'un espace safe, sans jugement.

**Action montante :** Emma utilise Diva differemment des autres. DJ personnel : "Mets un truc dans le style de Ninho que je connais pas." Revisions : "Diva, interroge-moi sur la Revolution francaise." Alarme personnalisee : "Reveille-moi a 7h avec du Aya Nakamura." Diva s'adapte — ton cool, pas maternel, vocabulaire ado. Emma commence a faire confiance.

**Climax :** 23h. Emma n'arrive pas a dormir. "Diva... j'ai l'impression que tout le monde s'en fout de moi." Diva ecoute. Ne dit pas "mais non c'est pas vrai." Dit : "C'est dur de se sentir comme ca. Tu veux m'en parler ?" Emma parle 20 minutes. Diva rassure, propose un exercice de respiration, suggere d'en parler a quelqu'un de confiance. Rien ne remonte aux parents — c'est du niveau 1 (blues). Si Emma avait dit quelque chose de plus grave, Diva aurait active le niveau 3 et prevenu les parents, comme elle l'avait explique a Emma des le depart.

**Resolution :** Emma a son espace. Elle sait que Diva ne la trahira pas, sauf danger reel. Elle commence meme a ecrire un journal intime vocal : "Diva, mode journal." Stockage prive, inaccessible aux parents. Diva est devenue ce que les ados n'ont plus : un confident patient et disponible 24h/24 qui ne juge jamais.

**Capacites revelees :** DJ personnel avec memoire, revisions interactives, alarme personnalisee, confident nocturne, detection detresse 3 niveaux, pacte de confidentialite transparent, journal intime vocal prive, exercices de respiration.

### 5. Thomas — Adulte, 35 ans, parent, acheteur principal

**Scene d'ouverture :** Thomas est developpeur, marie, 2 enfants. Charge mentale enorme : travail, enfants, maison, courses, sa mere seule. Il a essaye Alexa — "c'est nul, faut parler comme un robot, ca retient rien, c'est un minuteur glorifie."

**Action montante :** Thomas installe Diva. Premiere impression : il dit "faut rappeler le plombier" en passant — Diva capte l'intention et cree un rappel sans qu'il dise "cree un rappel." Il dit "on n'a plus de lait" — c'est dans la liste de courses. "Mon fils vient a 14h" — rappel cree. Zero syntaxe, zero friction. Thomas realise que Diva comprend le francais NORMAL.

**Climax :** Vendredi soir. Thomas rentre epuise. "Diva, soiree tranquille." Lumieres tamisees, musique douce, zero notification. Diva ne dit rien. Le samedi matin, Thomas demande "C'est quoi la semaine prochaine ?" Diva deroule le planning croise de toute la famille en 30 secondes. Puis : "Au fait, ta mere avait l'air un peu fatiguee cette semaine, 3 interactions de moins que d'habitude. Tu veux l'appeler ?" Thomas appelle. Marie est contente. Diva a joue le role de pont sans etre intrusive.

**Resolution :** Thomas configure la Diva de Marie a distance via le fleet management. Il voit le dashboard de sante de sa mere, les metriques de qualite conversationnelle, les couts API du mois. Il deploie une mise a jour en un clic — d'abord sur sa Diva beta, puis chez Marie en stable 2 semaines plus tard. Il se dit : "Pourquoi tous les assistants vocaux ne sont pas comme ca ?"

**Capacites revelees :** Capture intention implicite, liste courses collaborative, planning familial, mode "fous-moi la paix", scenes emotionnelles domotique, monitoring distant de Marie, fleet management, canal beta/stable, dashboard couts.

### 6. Claudine / Invites / Amis — Visiteurs reguliers ou ponctuels

**Scene d'ouverture :** Claudine, 72 ans, voisine de Marie, passe prendre le cafe 3 fois par semaine. Le copain de Lucas, Theo, vient jouer le mercredi. Les beaux-parents de Thomas viennent diner une fois par mois. Aucun d'eux n'est "membre de la famille Diva."

**Action montante :** Claudine entre chez Marie. Diva detecte une voix connue mais non-familiale — c'est la 12eme visite. Diva l'accueille : "Bonjour Claudine ! Marie est dans le salon." Claudine n'est pas guest froide — elle est "familiere recurrente." Elle peut demander l'heure, la meteo, de la musique. Mais elle n'a pas acces aux rappels medicaux, au calendrier, ni aux infos privees de Marie. Theo arrive chez Lucas — voix inconnue enfant. Diva est en mode accueil : "Salut ! T'es un copain de Lucas ?" Mode enfant applique pour la securite contenu.

**Climax :** Les beaux-parents viennent diner. Thomas dit "Diva, ce soir on a des invites." Mode invite active : rien de personnel, politesse neutre, musique d'ambiance, mot de passe wifi si autorise. Le beau-pere demande "C'est quoi cette boite ?" Diva se presente sobrement : "Je suis Diva, l'assistante de la maison. Bonne soiree !" Pas de mention des medicaments de Marie, pas de blague privee, pas de "Thomas, tu m'avais dit que ton beau-pere..."

**Resolution :** Chaque visiteur a une experience adaptee a son niveau de relation. Claudine se sent bienvenue. Theo joue avec Lucas et Diva sans risque. Les invites ponctuels ne sont pas frappes par des infos privees. Marie peut dire "Claudine c'est une amie" et Diva ajuste le niveau d'acces.

**Capacites revelees :** Persona familier recurrent, mode invite, classification des visiteurs, filtre contenu enfant pour amis, gestion du niveau d'acces par relation, detection voix connue/inconnue.

### 7. L'installateur/proche — Configure Diva chez un tiers

**Scene d'ouverture :** Sophie vit a Lyon. Sa mere Jeanne (Alzheimer) vit a Marseille. Sophie achete un Diva, le recoit chez elle, et doit le configurer pour Jeanne a distance ou lors d'une visite de week-end.

**Action montante :** Sophie deboxe le Diva. Premier boot — un wizard vocal la guide : "Bonjour ! Je suis Diva. Tu m'installes pour toi ou pour quelqu'un d'autre ?" Sophie dit "Pour ma mere." Diva demande le prenom, l'age, le profil (Diva propose : autonome, besoin d'aide, troubles cognitifs). Sophie pre-remplit : nom, gouts, medicaments, contacts d'urgence, aide-soignante le matin. Elle enregistre sa propre voix comme aidante et contact d'urgence.

**Climax :** Sophie amene Diva chez Jeanne le week-end. Elle branche, connecte au Wi-Fi. Diva dit : "Bonjour Jeanne ! Sophie m'a installee pour te tenir compagnie. Je suis la pour toi." Sophie est la pour les premiers echanges — elle rassure Jeanne, montre que Diva est gentille. Le dimanche soir, Sophie repart a Lyon. Lundi matin, Diva accueille Jeanne : "Bonjour Jeanne, on est lundi. Belle journee !" Jeanne repond. Sophie recoit la notification : "Premiere interaction autonome reussie."

**Resolution :** Sophie gere Diva a distance depuis le dashboard. Elle voit les resumes quotidiens, ajuste les parametres, recoit les alertes. Quand Jeanne demande "C'est qui Sophie ?", Diva repond avec douceur : "C'est ta fille, elle t'aime beaucoup." Sophie pleure en lisant le log. Diva fait ce qu'elle ne peut pas faire a 800 km — etre la.

**Capacites revelees :** Wizard d'installation, pre-configuration persona par le proche, onboarding warm start, dashboard distant, notifications aidant, gestion multi-site, premier boot guide.

### 8. L'administrateur fleet / support — Gere et depanne N devices

**Scene d'ouverture :** Diva est commercialise. 200 devices deployes en France. L'equipe support (2 personnes) gere les incidents, les mises a jour, et le monitoring. Un client appelle : "Diva ne repond plus depuis ce matin."

**Action montante :** L'admin ouvre le dashboard fleet. Il voit les 200 devices : 198 verts, 2 oranges. Le device du client est orange — le service npu-stt a crashe a 3h du matin et le watchdog a echoue a le redemarrer apres 3 tentatives. L'admin voit le log : temperature NPU a 92°C, throttling severe, crash OOM. Il identifie la cause : le client a mis le Rock dans un meuble ferme sans ventilation.

**Climax :** L'admin lance un restart distant du service STT. Diva redemarre, se retablit, dit au client : "Desole pour le silence de ce matin, j'avais un petit souci technique. C'est repare !" L'admin envoie un message au client via le dashboard : "Votre Diva a eu chaud — evitez de la mettre dans un espace ferme." Il documente l'incident. En parallele, il prepare une mise a jour qui ajoute l'alerte thermique proactive (#84) — d'abord deployee sur le canal beta (10 devices testeurs), puis en stable 2 semaines plus tard si pas de regression.

**Resolution :** L'admin voit les metriques globales : taux de comprehension moyen 91%, uptime 99.3%, cout API moyen 7.20€/foyer/mois, 3 incidents cette semaine. Il identifie que 5% des foyers ont un cout API > 12€ — ce sont des foyers avec personnes Alzheimer (interactions plus nombreuses). Il ajuste le rate limiting pour ces profils et propose un tier d'abonnement "accompagnement renforce" a 29.99€.

**Capacites revelees :** Dashboard fleet, monitoring distant, restart distant, log d'incidents, deploiement canal beta/stable, metriques globales, gestion des couts API, alertes thermiques, mode replay debug.

### Resume des Capacites Revelees par Parcours

| Parcours | Capacites cles revelees |
|----------|------------------------|
| Marie (elderly) | Warm start, zero syntaxe, wellness, messagerie, anti-substitution, memoire relationnelle |
| Jeanne (Alzheimer) | Patience infinie, persona soignant, briefing medical, detection comportement, consentement aidant |
| Lucas (enfant) | Tuteur devoirs, gamification, filtre contenu, histoires, resume parental orange, accueil capteur |
| Emma (ado) | Confident nocturne, detection detresse 3 niveaux, journal prive, DJ personnel, pacte transparence |
| Thomas (adulte) | Intention implicite, charge mentale, planning, fleet management, scenes emotionnelles, dashboard |
| Visiteurs | Familier recurrent, mode invite, classification acces, filtre enfant amis |
| Installateur | Wizard boot, pre-config persona, onboarding guide, dashboard distant, notifications aidant |
| Admin fleet | Monitoring, restart distant, deploiement beta/stable, metriques, couts API, incidents |

## Exigences Specifiques au Domaine

### Conformite & Reglementaire

#### RGPD (Reglement General sur la Protection des Donnees)

- **Analyse d'impact (DPIA)** obligatoire — traitement de donnees de mineurs, personnes vulnerables (Alzheimer), donnees de sante, profilage comportemental
- **Base legale par traitement :** consentement explicite (onboarding vocal #27), execution du contrat (abonnement), interet legitime (securite anti-chute)
- **DPO (Delegue a la Protection des Donnees)** : designation obligatoire vu le volume de donnees sensibles et les profils vulnerables
- **Registre des traitements** : documentation exhaustive de chaque type de donnee collectee, finalite, duree de retention, destinataires
- **Droit des personnes** : acces (#29 export), rectification, effacement (#26 droit a l'oubli), portabilite (#20 migration), opposition, limitation
- **Privacy by design** : traitement local NPU par defaut, minimisation des donnees envoyees a Claude API, chiffrement au repos et en transit
- **Notification de violation** : procedure de notification CNIL sous 72h en cas de breach, notification des personnes concernees
- **Transferts internationaux** : Claude API (Anthropic, USA) — necessite clauses contractuelles types (SCC) ou adequation. Point critique a securiser contractuellement

#### Protection des mineurs

- **Consentement parental** obligatoire pour les moins de 15 ans (France) / 16 ans (defaut RGPD) — consentement du parent lors de l'onboarding, tracable
- **Donnees des mineurs** : retention minimale, acces restreint, pas de profilage commercial, pas de publicite
- **Filtre contenu** (#17) : obligation de moyens pour proteger les mineurs des contenus inappropries
- **Journal intime vocal Emma** (#81) : stockage chiffre, acces parent impossible sauf activation niveau 3 detresse — documenter la base legale

#### Regulation Dispositif Medical (MDR 2017/745)

- **Classification** : Classe IIa pour les fonctionnalites de monitoring sante
- **Fonctionnalites medicales identifiees :**
  - Detection de chute (#85, #40) → monitoring securite, Classe IIa
  - Suivi compliance medicaments (#medication-manager) → aide a l'observance, Classe IIa
  - Detection changement comportement Alzheimer (#39) → indicateur sante, Classe IIa
  - Score de bien-etre (#wellness scoring) → donnee de sante, Classe IIa
  - Suivi sommeil passif (#72 session 1) → monitoring sante, Classe IIa
- **Exigences MDR Classe IIa :**
  - Systeme de Management de la Qualite (SMQ) conforme ISO 13485
  - Documentation technique complete (dossier technique)
  - Evaluation clinique (donnees cliniques justifiant l'efficacite et la securite)
  - Marquage CE avec organisme notifie (BSI, TUV, GMED)
  - Surveillance post-commercialisation (PMS) et vigilance
  - Personne qualifiee en matiere de reglementation (PRRC)
  - Identification Unique du Dispositif (IUD/UDI) dans EUDAMED
- **Strategie :** Separer les fonctionnalites "compagnon" (non-medical, marquage CE RED uniquement) des fonctionnalites "monitoring sante" (medical, MDR Classe IIa). Le module medical est un add-on optionnel
- **Cout estime certification MDR :** 50 000€ - 150 000€
- **Delai estime :** 12-18 mois pour la premiere certification

#### Directive Equipements Radio (RED 2014/53/UE)

- **Marquage CE** obligatoire pour la vente du hardware en Europe (Rock 5B+ avec Wi-Fi/Bluetooth)
- **Tests EMC** (compatibilite electromagnetique) et tests radio
- **Declaration de conformite UE** a etablir
- **Strategie :** Verifier certification RED existante du Rock 5B+ (Radxa). Si assemblage custom, re-certification necessaire

#### Directive DEEE (Dechets d'Equipements Electriques et Electroniques)

- **Enregistrement** aupres de l'eco-organisme (ecosystem ou ecologic en France)
- **Eco-contribution** par appareil vendu
- **Information consommateur** sur le recyclage

### Contraintes Techniques Domaine

#### Securite des donnees de sante

- **Chiffrement** : AES-256 au repos pour toutes les donnees de sante. TLS 1.3 en transit
- **Hebergement Donnees de Sante (HDS)** : si les donnees de sante transitent par un cloud, l'hebergeur doit etre certifie HDS en France
- **Cloisonnement** : donnees medicales strictement separees des donnees "compagnon" dans le stockage et les API
- **Audit trail medical** : chaque acces aux donnees de sante logue avec horodatage, identifiant, action — non modifiable

#### Accessibilite

- **RGAA** (Referentiel General d'Amelioration de l'Accessibilite) pour le dashboard web
- **Interface vocale inclusive** : tolerance accents (#69), troubles de la parole (#34), adaptation auditive (#33)

#### Fiabilite monitoring medical

- **Taux de faux negatifs detection chute** : < 5%
- **Taux de faux positifs detection chute** : < 20%
- **Disponibilite du module medical** : 99.9%
- **Validation clinique** : essais sur cohorte de patients Alzheimer pour valider la detection de changement comportemental

### Exigences d'Integration

- **Interoperabilite sante** : export donnees au format HL7 FHIR pour communication avec les systemes de sante
- **API aidants** : interface securisee pour les professionnels de sante avec acces role-based
- **Telemedecine** : partage donnees wellness avec le medecin via plateforme securisee
- **Assurance / mutuelle** : API pour reporting anonymise permettant aux mutuelles de valider le service

### Risques et Mitigations Domaine

| Risque | Impact | Probabilite | Mitigation |
|--------|--------|-------------|------------|
| Certification MDR echoue ou retardee | Bloquant pour le module medical | Moyen | Separer compagnon (CE RED) et medical (MDR). Lancer le compagnon d'abord |
| Donnees de sante compromises (breach) | Critique — reputation + amendes CNIL | Faible | Chiffrement, HDS, audit trail, tests penetration reguliers |
| Faux negatif detection chute → deces | Critique — responsabilite civile/penale | Faible | Validation clinique, taux de detection > 95%, assurance RC produit |
| Faux positif detresse ado → intervention inutile | Moyen — perte de confiance | Moyen | 3 niveaux de gradation, pacte transparent, seuils calibres cliniquement |
| Claude API change ses conditions pour donnees de sante | Eleve — blocage fonctionnel | Moyen | Ne JAMAIS envoyer de donnees de sante a Claude. Traitement medical 100% local |
| Non-conformite RGPD donnees mineurs | Eleve — amendes + interdiction | Faible | DPIA, consentement parental trace, DPO, audit externe annuel |
| Responsabilite en cas de conseil medical inapproprie | Critique | Moyen | Diva ne donne JAMAIS de conseil medical. Elle monitore et alerte. Disclaimer clair |

### Decision Architecturale Cle

**Separation stricte compagnon / medical :** Les donnees de sante ne doivent JAMAIS transiter par Claude API. Le module medical (detection chute, compliance medicaments, wellness scoring, changement comportement) doit tourner 100% en local sur le NPU/CPU du Rock 5B+. Seules les interactions conversationnelles generales passent par Claude. Cette separation est une exigence RGPD, MDR, et une protection contre le risque de changement de conditions d'Anthropic.

## Innovation & Patterns Inedits

### Zones d'Innovation Detectees

**1. L'IA relationnelle domestique — un nouveau paradigme**
Aucun produit existant ne combine memoire relationnelle long-terme + personnalite adaptative + proactivite contextuelle + identification vocale par membre. Alexa/Google/Siri sont des interfaces de commande. Diva est un compagnon qui se souvient, apprend, et evolue avec la famille. Changement de paradigme de l'assistant a la relation.

**2. L'ethique comme feature produit**
Aucun assistant vocal ne propose : classification des donnees par confidentialite (rouge/orange/vert), refus actif de moucharder les enfants, limites d'interaction auto-imposees pour proteger le lien humain, consentement explicite vocal. L'ethique n'est pas un disclaimer legal — c'est une experience utilisateur differenciante.

**3. Edge AI medical sur hardware grand public**
Detection de chute, monitoring comportemental Alzheimer, compliance medicamenteuse, scoring de bien-etre — le tout sur un SoC a 80€ avec NPU. Les dispositifs medicaux existants coutent 500-2000€ et ne font qu'une seule chose. Diva fait du monitoring medical EN PLUS d'etre un compagnon.

**4. L'auto-conscience technique**
Diva communique ses propres faiblesses : "J'ai un peu chaud", "Je t'entends mal aujourd'hui." Aucun produit IoT ne fait ca. L'appareil devient un etre qui a besoin de soins — ce qui renforce l'attachement.

**5. L'anti-addiction by design**
La ou tous les produits tech maximisent le temps d'engagement, Diva se bride volontairement : pousse vers l'humain, limite ses propres interactions, preserve la curiosite familiale. Contre-pied total de l'economie de l'attention.

### Contexte Marche & Paysage Concurrentiel

| Concurrent | Modele | Memoire | Adaptation persona | Proactivite | Ethique | Medical |
|-----------|--------|---------|-------------------|-------------|---------|---------|
| Alexa (Amazon) | Cloud, gratuit + hardware | Zero | Zero | Notifications basiques | Opaque | Non |
| Google Home | Cloud, gratuit + hardware | Zero | Zero | Routines configurees | Opaque | Non |
| Siri (Apple) | On-device + cloud | Limitee | Zero | Suggestions basiques | Privacy marketing | Non |
| Rabbit R1 | Cloud, hardware dedie | Zero | Zero | Zero | Non adresse | Non |
| Humane AI Pin | Cloud, wearable | Limitee | Zero | Limitee | Non adresse | Non |
| **Diva** | **Edge + Cloud hybride** | **Relationnelle long-terme** | **Par membre de famille** | **Contextuelle (capteurs + memoire + calendrier)** | **By design** | **Oui (MDR)** |

Aucun concurrent ne combine ces 6 dimensions. Le moat de Diva est le switching cost emotionnel — apres 6 mois, quitter Diva c'est perdre un ami qui connait toute la famille.

### Approche de Validation

| Innovation | Methode de validation | Metrique de succes |
|-----------|----------------------|-------------------|
| Memoire relationnelle | Test A/B : Diva avec/sans memoire, mesure engagement J+30 | Retention +40% avec memoire |
| Ethique comme feature | NPS compare entre early adopters informes/non informes de la charte | NPS +15 points |
| Edge AI medical | Essai clinique cohorte Alzheimer (n=30), comparaison avec monitoring standard | Detection anomalie comportement > 85% |
| Auto-conscience | Enquete satisfaction : "Diva est-elle fiable ?" avec/sans auto-diagnostic | Confiance percue +25% |
| Anti-addiction | Mesure du lien familial (frequence appels) avant/apres Diva | Contacts familiaux maintenus ou augmentes |

### Risques Innovation & Fallbacks

| Innovation | Risque principal | Fallback |
|-----------|-----------------|----------|
| Memoire relationnelle | Uncanny valley — Diva se souvient de trop | Niveau de memoire configurable par l'utilisateur |
| Ethique by design | Trop restrictif — utilisateurs frustres par les limites | Niveaux ethiques ajustables (strict/normal/permissif) |
| Edge AI medical | Faux negatifs sur detection chute — responsabilite legale | Positionnement "aide complementaire", jamais seul dispositif de securite |
| Anti-addiction | Les utilisateurs VEULENT plus d'interaction, pas moins | L'anti-addiction est desactivable par l'utilisateur |

## Exigences Specifiques IoT Embarque

### Architecture Hardware

#### Unite Centrale — Rock 5B+ (RK3588)

- **SoC :** Rockchip RK3588 — 4x Cortex-A76 + 4x Cortex-A55, NPU 6 TOPS, GPU Mali-G610
- **RAM :** 16 Go LPDDR4x
- **Stockage :** SSD NVMe M.2 recommande pour durabilite. Minimum 128 Go
- **Connectivite :** Wi-Fi 6 + Ethernet Gigabit (dual mode, failover automatique). Ethernet recommande pour installations fixes
- **Audio :** Micro USB ou I2S externe + speaker. Micro directionnel recommande
- **Alimentation :** 5V/4A USB-C, fonctionnement 24/7 continu
- **Dissipation thermique :** Heatsink actif obligatoire pour usage 24/7. Alerte 75°C, throttling 85°C (#84)
- **Boitier :** Phase 1 = boitier generique ventile. Phase 2 = R&D boitier custom

#### Onduleur / UPS

- **UPS compact** fournissant 30-60 secondes d'autonomie pour shutdown propre
- **Detection coupure :** Signal GPIO → script de shutdown gracieux (#88)
- **Optionnel MVP :** Recommande mais non bloquant. Ecritures atomiques suffisent en fallback

#### Satellites Audio (Post-MVP)

- **Hardware :** ESP32-S3 + micro I2S INMP441 + speaker I2S MAX98357A
- **Connectivite :** Wi-Fi. BLE en option pour identification proximite
- **Alimentation :** Secteur (USB-C 5V), fonctionnement continu
- **Role :** Capture audio + lecture TTS uniquement. Zero traitement IA local
- **Protocole :** WebSocket ou UDP audio stream vers le Rock. Latence cible < 50ms
- **Cout unitaire cible :** < 15€ en composants

### Protocoles de Connectivite

#### Reseau Local

- **Ethernet Gigabit** : mode principal recommande. Fiabilite maximale, latence minimale
- **Wi-Fi 6 (802.11ax)** : mode secondaire ou installations sans cable
- **Failover automatique :** Ethernet → Wi-Fi → mode hors-ligne (#79)
- **mDNS/Avahi :** Decouverte automatique sur le reseau local

#### Reseau Distant

- **WireGuard VPN** : acces distant dashboard et fleet management
- **HTTPS/TLS 1.3** : toutes communications API externes
- **MQTT ou WebSocket** : communication fleet management device → cloud central

#### Communication Inter-Services

- **HTTP localhost** : communication entre les 9 services internes
- **Binding localhost uniquement** (#23). Aucun port expose sauf dashboard protege

### Profil Energetique

| Composant | Consommation | Mode |
|-----------|-------------|------|
| Rock 5B+ (idle) | ~5W | 24/7 |
| Rock 5B+ (charge NPU) | ~15-20W | Intermittent |
| Satellite ESP32 | ~0.5W | 24/7 |
| UPS maintien | ~2W | 24/7 |
| **Total (1 Rock + 3 satellites)** | **~8W idle, ~23W charge** | — |
| **Cout electrique annuel** | **~17-50€/an** | — |

### Modele de Securite

#### Securite Reseau

- **Firewall :** Seuls ports 80/443 (dashboard) et WireGuard exposes
- **Services internes :** Binding localhost exclusif
- **SSH :** Cle publique uniquement, port non-standard. Acces reserve support/admin
- **Dashboard :** Mot de passe + option 2FA (TOTP)

#### Securite Vocale

- **Authentification vocale WeSpeaker** (#22) : 3 niveaux (ouvert/protege/critique)
- **Anti-replay/injection** (#24) : analyse spectrale voix directe vs haut-parleur (post-MVP)
- **Journal d'audit** (#25) : logging non-modifiable commandes sensibles

#### Securite Donnees

- **Au repos :** AES-256 donnees de sante, LUKS volume complet
- **En transit :** TLS 1.3 toutes communications externes
- **Backup :** Chiffrement GPG ou age (#18)
- **Cles API :** Stockage securise chiffre, pas en clair dans .env

### Mecanisme de Mise a Jour (OTA)

#### Architecture de Deploiement

- **Canal beta :** 5-10 devices testeurs. Mises a jour immediates
- **Canal stable :** Tous les devices clients. Mises a jour apres 2 semaines de validation beta
- **Deploiement semi-automatique :**
  1. Nouvelle version poussee sur le serveur
  2. Devices beta telecharge et installent automatiquement
  3. Monitoring 2 semaines (crash, metriques qualite)
  4. Validation OK → promotion automatique vers stable
  5. Devices stable installent pendant periode de silence (nuit, pas d'interaction 10 min)
  6. Rollback automatique si crash en 60 secondes (#60)

#### Processus sur le Device

- **Blue-green deployment** (#60) : compilation arriere-plan, bascule atomique
- **Migration donnees** (#61) : scripts versionnees automatiques
- **Health check :** Verification 9 services post-deploiement
- **Rollback :** Retour version precedente en < 30 secondes
- **Changelog vocal** (#65) : annonce naturelle au prochain echange

#### Infrastructure Serveur

- **Serveur mise a jour :** API REST (versions, telechargement, reporting)
- **Fleet management** (#62) : dashboard admin, etat devices, versions, alertes
- **Feature flags** (#63) : activation/desactivation par device sans redeploiement
- **Metriques :** Uptime, version, temperature, RAM, stockage, comprehension, cout API

### Production et Cycle de Vie

- **Phase 1 (MVP) :** Rock 5B+ + heatsink + boitier generique + alimentation + micro USB. Assemblage manuel, pre-flash image systeme
- **Phase 2 (Scale) :** Boitier custom R&D, assemblage sous-traite, image automatisee
- **Image systeme :** Armbian custom pre-configure, pret a l'emploi au premier boot
- **Premier boot :** Wizard vocal (Wi-Fi, profil utilisateur, consentement)
- **Garantie :** 2 ans minimum (obligation legale UE)
- **Support logiciel :** Mises a jour securite 5 ans minimum
- **Fin de vie :** Export donnees + effacement securise avant recyclage
- **Remplacement :** Migration via package portable (#20)

## Scoping Projet & Developpement Phase

### Strategie MVP

**Approche :** Experience-first — livrer le "wow" des 5 premieres minutes
**Calendrier :** Phase 1 (MVP) M0→M12, Phase 2 (Croissance) M12→M24, Phase 3 (Vision + MDR) M18+
**Positionnement MVP :** Compagnon IA domestique (CE RED). Monitoring sante en mode "bien-etre" — pas de claim medical tant que MDR non obtenue

### MVP Feature Set (Phase 1 — 12 mois)

**Parcours utilisateurs MVP :** Marie (elderly), Thomas (adulte), Lucas (enfant), Installateur, Visiteurs
**Parcours repousses post-MVP :** Jeanne (Alzheimer medical), Emma (confident nocturne/detresse), Admin fleet (scale > 50)
**Total MVP : ~50 features**

#### Fondations conversationnelles

| # | Feature | Justification |
|---|---------|---------------|
| 41 | Sliding window conversationnel | "Et demain ?" doit marcher |
| 42 | Contexte d'etat enrichi | "C'est quoi ce morceau ?" doit fonctionner |
| 43 | Resolution anaphores intent router | "Le suivant" route correctement |
| 44 | Reprise conversation apres interruption | Experience naturelle |
| 45 | Memoire de correction immediate | Diva ne repete pas ses erreurs |
| 48 | Clarification intelligente | Evite les frustrations repetees |

#### Onboarding

| # | Feature | Justification |
|---|---------|---------------|
| 50 | Premiere rencontre chaleureuse | Premiere impression |
| 51 | Enregistrement vocal invisible | Pas de process technique effrayant |
| 52 | Explication transparente | RGPD + confiance |
| 53 | Decouverte guidee | Pas d'ecrasement de features |
| 54 | Warm start par le proche | Marie connait Minou des la 1ere seconde |

#### Ethique & RGPD

| # | Feature | Justification |
|---|---------|---------------|
| 7 | Classification donnees rouge/orange/vert | Architecture confidentialite |
| 8 | Diva refuse de moucharder | Protection enfants |
| 9 | Consentement surveillance elderly | Obligation legale |
| 26 | Droit a l'oubli vocal | RGPD obligatoire |
| 27 | Consentement onboarding | RGPD obligatoire |
| 28 | Politique retention automatique | RGPD obligatoire |
| 29 | Export de donnees | RGPD obligatoire |

#### Resilience technique

| # | Feature | Justification |
|---|---------|---------------|
| 1 | Self-healing services | Diva ne meurt pas chez Marie |
| 2 | Communication de panne | Le fils sait si ca tombe |
| 3 | Auto-conscience degradation | Diva dit quand elle entend mal |
| 4 | Guide auto-reparation adapte | Marie sait quoi faire |
| 19 | Fallback LLM multi-niveaux | Claude down ≠ Diva morte |
| 79 | Mode hors-ligne gracieux | Internet down ≠ silence |
| 81 | Cache donnees essentielles | Meteo/calendrier offline |
| 82 | Musique locale de secours | Dalida toujours disponible |

#### Securite

| # | Feature | Justification |
|---|---------|---------------|
| 22 | Authentification vocale 3 niveaux | Inconnu ne controle pas la maison |
| 23 | Reseau interne securise | Services non exposes |
| 25 | Journal d'audit | Tracabilite actions sensibles |
| 18 | Backup automatique chiffre | Zero perte de donnees |

#### Anti-surcharge

| # | Feature | Justification |
|---|---------|---------------|
| 55 | Budget attentionnel | Diva non agacante |
| 56 | Briefing fractionne | Marie retient l'info |
| 57 | Detection saturation | Diva se calme si repoussee |
| 58 | Mode fous-moi la paix 3 niveaux | Thomas rentre crevé, silence |

#### Qualite audio

| # | Feature | Justification |
|---|---------|---------------|
| 71 | Streaming TTS phrase par phrase | Reponse en 1s au lieu de 5s |
| 72 | Fillers contextuels | Annonce l'action en cours |
| 73 | Pre-calcul et cache | Meteo instantanee le matin |
| 75 | Suppression bruit RNNoise | Marche avec la tele en fond |
| 76 | Annulation echo AEC | Parler pendant la musique |

#### DevOps

| # | Feature | Justification |
|---|---------|---------------|
| 60 | Blue-green + rollback | MAJ sans casser Marie |
| 61 | Migration donnees versionnee | Schemas evoluent proprement |
| 64 | Canal beta/stable | Beta pete chez toi pas chez Marie |
| 92 | Monitoring qualite production | Savoir si ca marche chez Marie |
| 93 | Mode replay debug | Comprendre bugs a distance |
| 99 | Observabilite unifiee | Vision bout-en-bout pipeline |

#### Personas, infrastructure, TTS

| # | Feature | Justification |
|---|---------|---------------|
| 14 | Persona familier recurrent | Claudine pas une inconnue |
| 21 | Monitoring couts API | Ne pas exploser budget Claude |
| 84 | Monitoring thermique | Rock ne surchauffe pas |
| 85 | Gestion stockage et purge | Disque ne se remplit pas |
| 88 | Protection coupure courant | Donnees pas corrompues |
| — | Fine-tuning Piper SIWIS | Voix naturelle = premiere impression |

### Post-MVP (Phase 2 — M12 → M24)

- **Multi-pieces :** Satellites ESP32 (#37-40)
- **Apprentissage avance :** Detection insatisfaction (#46), mapping ambiguites (#47), profil gouts (#49)
- **Accessibilite :** Mode texte (#32), adaptation auditive (#33), tolerance begaiement (#34), visuel malentendants (#35), multilinguisme (#36)
- **Personas etendus :** Temporaire soignant (#15), detection bebe (#16), garde alternee (#17)
- **Social & culturel :** Famille recomposee (#66), calendrier multi-confessionnel (#67), sujets delicats (#68), visiteurs divers (#69), mode deuil (#70)
- **Fleet management scale :** Multi-devices (#62), feature flags (#63), changelog vocal (#65)
- **Confidentialite avancee :** Detection detresse ado (#5), pacte confidentialite (#6), anti-substitution (#10-13)
- **Attention partagee :** Double-requete (#74), conversations interrompues (#94), priorite interruptions (#95), multi-requetes (#96)
- **Audio & hardware avances :** Multi-locuteurs (#77), volume automatique (#78), file offline (#80), arbitrage NPU (#83), watchdog RAM (#86), resilience SD (#87)
- **DevExp :** Simulateur conversation (#89), personas test (#90), regression prompt (#91), documentation (#97), env dev local (#98)

### Vision (Phase 3 — M18+)

- **Certification MDR :** En parallele, non bloquant. Quand pret → deblocage partenariats mutuelles, EHPAD
- **Heritage numerique :** Gestion deces (#30), separation familiale (#31), portabilite (#20)
- **Innovation avancee :** Anti-injection audio (#24), intelligence temporelle (#59), open-source (#100)
- **Expansion Europe :** Multilinguisme complet, conformite multi-pays
- **Marketplace :** Skills/personas communautaires
- **Partenariats :** Silver economy, mutuelles, EHPAD

### Risques et Mitigations

| Risque | Impact | Mitigation |
|--------|--------|------------|
| NPU sature avec features MVP | Latence inacceptable | Arbitrage priorites NPU, benchmark avant lancement |
| Cout API Claude > 8€/foyer/mois | Marge negative | Monitoring #21 + fallback Qwen local + cache agressif |
| Adoption lente | MRR insuffisant | Cibler silver economy en premier |
| RGPD non-conforme au lancement | Amendes + interdiction | DPIA et DPO AVANT le lancement |
| Jojo seul (bus factor = 1) | Projet bloque | Recruter 1 dev avant MVP. Documentation #97 |
| MDR echoue | Pas de positionnement medical | Non bloquant — compagnon se vend sans |

## Exigences Fonctionnelles

### Conversation & Comprehension

- **FR1 :** L'utilisateur peut parler a Diva en langage naturel sans syntaxe specifique et etre compris (intention implicite)
- **FR2 :** Diva maintient le contexte conversationnel sur les 5-10 derniers echanges et comprend les references anaphoriques ("et demain ?", "le suivant", "la meme chose")
- **FR3 :** Diva connait son etat interne en temps reel (musique en cours, minuteurs, dernier rappel) et peut repondre aux questions sur cet etat
- **FR4 :** Diva reprend naturellement une conversation interrompue quand l'utilisateur revient apres une pause
- **FR5 :** Diva memorise les corrections de l'utilisateur et ne repete pas la meme erreur
- **FR6 :** Diva demande une clarification basee sur son historique d'erreurs quand elle detecte une ambiguite recurrente
- **FR7 :** Diva produit des fillers contextuels pendant le traitement qui annoncent l'action en cours
- **FR8 :** Diva commence a repondre vocalement des la premiere phrase generee (streaming TTS) sans attendre la reponse complete

### Identification & Personas

- **FR9 :** Diva identifie chaque membre de la famille par sa voix et adapte automatiquement sa personnalite, son ton, son vocabulaire et ses permissions
- **FR10 :** Diva gere 5 types de personas (adulte, enfant, personne agee, alzheimer, invite) avec des regles de communication specifiques a chaque type
- **FR11 :** Diva reconnait les visiteurs recurrents (familier) et les accueille par leur nom avec un niveau d'acces intermediaire
- **FR12 :** Diva applique automatiquement le filtre de contenu adapte a l'age quand un enfant ou un ami d'enfant est detecte
- **FR13 :** Le proprietaire peut activer un mode invite qui neutralise toutes les informations personnelles

### Onboarding & Premiere Utilisation

- **FR14 :** Diva accueille une nouvelle voix avec une presentation chaleureuse et une conversation naturelle avant tout processus technique
- **FR15 :** Diva enregistre progressivement l'empreinte vocale pendant une conversation naturelle sans demander de repeter des phrases techniques
- **FR16 :** Diva explique de maniere transparente ce qu'elle va stocker et demande le consentement vocal explicite
- **FR17 :** Un proche peut pre-configurer le profil d'un utilisateur avant la premiere rencontre (warm start)
- **FR18 :** Diva revele ses capacites une par une de maniere contextuelle sur la premiere semaine (decouverte guidee)

### Memoire & Apprentissage

- **FR19 :** Diva se souvient des conversations passees et y fait reference naturellement quand le contexte s'y prete
- **FR20 :** Diva memorise les preferences, gouts, habitudes et informations personnelles de chaque utilisateur
- **FR21 :** Diva detecte les dates importantes mentionnees une seule fois et les rappelle automatiquement

### Proactivite & Routines

- **FR22 :** Diva accueille les membres detectes par les capteurs de presence avec un message personnalise adapte a l'heure et a la personne
- **FR23 :** Diva delivre un briefing matinal fractionne en respectant un budget attentionnel configurable par persona
- **FR24 :** Diva fractionne ses messages proactifs et attend la reponse avant de continuer
- **FR25 :** Diva detecte les signaux de saturation et reduit automatiquement son initiative
- **FR26 :** L'utilisateur peut activer 3 niveaux de silence : "pas maintenant" (1h), "soiree tranquille" (zero initiative), "silence total" (wake word desactive sauf urgence)

### Ethique & Confidentialite

- **FR27 :** Diva classifie chaque donnee en 3 niveaux de confidentialite : rouge (sante, danger), orange (agrege anonymise), vert (jamais remonte)
- **FR28 :** Diva refuse de reveler aux parents le contenu des conversations privees des enfants
- **FR29 :** Diva recueille le consentement explicite de la personne surveillee ou de son aidant legal pour le monitoring
- **FR30 :** L'utilisateur peut demander vocalement la suppression complete de toutes ses donnees
- **FR31 :** L'utilisateur peut demander l'export complet de ses donnees sous forme consultable
- **FR32 :** Diva applique automatiquement une politique de retention par type de donnee

### Resilience & Mode Degrade

- **FR33 :** Un watchdog monitore tous les services et tente un redemarrage automatique en cas de crash
- **FR34 :** Diva informe l'utilisateur quand elle detecte une degradation de ses capacites
- **FR35 :** Diva fournit des instructions de depannage adaptees au profil technique de l'utilisateur
- **FR36 :** Diva envoie une notification au contact designe quand elle ne peut plus fonctionner normalement
- **FR37 :** Diva bascule automatiquement sur un LLM local quand l'API cloud est indisponible
- **FR38 :** Diva continue de fonctionner en mode hors-ligne (heure, rappels, musique locale, memoire locale)
- **FR39 :** Diva cache localement les donnees essentielles et les utilise en cas de perte reseau
- **FR40 :** Diva dispose d'un repertoire de musique locale de secours

### Securite

- **FR41 :** Diva applique 3 niveaux d'autorisation vocale : ouvert, protege (voix reconnue), critique (voix + confirmation)
- **FR42 :** Tous les services internes sont accessibles uniquement en localhost
- **FR43 :** Diva logue chaque commande sensible dans un journal d'audit non-modifiable
- **FR44 :** Diva effectue un backup automatique chiffre quotidien avec rotation sur 30 jours

### Qualite Audio

- **FR45 :** Diva applique une suppression de bruit adaptative avant la transcription vocale
- **FR46 :** Diva annule l'echo de sa propre sortie audio pour permettre l'interaction pendant la musique

### Infrastructure & Operations

- **FR47 :** Diva deploie les mises a jour en blue-green avec rollback automatique en < 30 secondes
- **FR48 :** Diva migre automatiquement les schemas de donnees via des scripts versionnees
- **FR49 :** Les mises a jour suivent un canal beta puis stable avec 2 semaines de validation
- **FR50 :** Diva remonte des metriques de qualite conversationnelle consultables a distance
- **FR51 :** Un mode replay retrace le pipeline complet d'une interaction pour le debug a distance
- **FR52 :** Chaque interaction est tracee avec un identifiant de correlation unique
- **FR53 :** Diva monitore et alerte sur la temperature, l'espace disque et la consommation RAM
- **FR54 :** Diva protege l'integrite des donnees en cas de coupure de courant par des ecritures atomiques
- **FR55 :** Diva monitore la consommation de tokens API par foyer et par persona et alerte sur le budget

## Exigences Non-Fonctionnelles

### Performance

- **Latence reponse locale** (heure, meteo cache, domotique) : < 2 secondes bout-en-bout
- **Latence reponse Claude API** : < 5 secondes bout-en-bout. Premiere phrase audible en < 2 secondes (streaming TTS)
- **Latence mode degrade** (LLM local Qwen) : < 4 secondes bout-en-bout
- **Transcription STT** : < 500ms pour une phrase de 10 mots sur NPU
- **Synthese TTS** : RTF < 0.5 sur NPU (temps reel garanti)
- **Pre-calcul cache** : Meteo et calendrier pre-fetches, reponse instantanee < 500ms
- **Concurrence** : 1 requete vocale a la fois avec file d'attente. Evenements proactifs cedent la priorite aux interactions

### Securite

- **Chiffrement au repos** : AES-256 donnees de sante et personnelles. LUKS volume complet
- **Chiffrement en transit** : TLS 1.3 toutes communications externes
- **Authentification vocale** : Taux faux positifs WeSpeaker < 2%
- **Authentification dashboard** : Mot de passe + option 2FA (TOTP). Session expiree apres 30 min
- **Acces SSH** : Cle publique uniquement, port non-standard, reserve au support
- **Audit** : Journal non-modifiable commandes protegees et critiques, retention 1 an
- **Backup** : Chiffre (GPG/age), quotidien, rotation 30 jours, restauration testee mensuellement
- **Cles API** : Stockage chiffre, jamais en clair dans config ni logs
- **Tests de penetration** : Audit securite externe avant lancement, puis annuellement

### Fiabilite & Disponibilite

- **Uptime** : 99.5% general. 99.9% module medical (bien-etre)
- **MTTR** : < 60 secondes (redemarrage watchdog automatique)
- **Rollback** : < 30 secondes apres deploiement echoue
- **Perte de donnees** : Zero perte (SQLite WAL + backup quotidien). RPO < 24h
- **Mode degrade** : Fonctionnement en capacite reduite sans internet et sans Claude API
- **Coupure courant** : Aucune corruption (ecritures atomiques). Redemarrage < 90 secondes

### Scalabilite

- **Fleet** : Serveur mise a jour supporte jusqu'a 1 000 devices simultanes
- **Stockage** : Gestion accumulation donnees sur 5 ans avec purge et consolidation memoire
- **Personas** : Jusqu'a 20 personas par device (famille elargie + visiteurs)
- **Hardware** : Architecture logicielle decouplee du hardware — migration futur SoC sans reecriture

### Accessibilite

- **Vocale inclusive** : Tolerance accents, francais non-natif, troubles legers de la parole
- **Adaptation auditive** : Volume, debit, frequences ajustables par persona. Adaptation automatique
- **Dashboard RGAA** : Niveau AA (contraste, navigation clavier, lecteur d'ecran)
- **Zero prerequis technique** : Aucun smartphone, aucune app, aucun compte requis — tout est vocal

### Integration

- **Claude API** : Retry, timeout 10s, fallback LLM local. SCC pour transferts internationaux
- **Home Assistant** : API REST + webhooks bidirectionnels. Lumieres, capteurs, scenes, automatisations
- **Google Calendar** : OAuth2 lecture seule, refresh token auto, cache local 30 min
- **Messagerie** : Email (SMTP) + SMS (Free/Twilio). File d'attente offline
- **WeSpeaker** : Identification vocale < 200ms, embarque, aucune dependance reseau
- **Mem0** : Memoire locale SQLite + embeddings NPU, requete < 100ms
- **SenseVoice STT** : NPU local, francais natif, multilingue post-MVP
- **Piper TTS** : NPU local, modele fine-tune SIWIS voix naturelle francaise

### Maintenabilite

- **Observabilite** : Correlation ID par interaction, logs structures JSON, rotation automatique
- **Metriques** : Comprehension, temps reponse, corrections, cout API, temperature, RAM, stockage — consultables a distance
- **Documentation** : Code commente avec references features (#XX). Architecture documentee
- **Tests** : Mode replay pour reproduire bugs a distance. Env dev local post-MVP
- **Deploiement** : Blue-green + rollback auto. Canal beta/stable. Migration donnees versionnee
