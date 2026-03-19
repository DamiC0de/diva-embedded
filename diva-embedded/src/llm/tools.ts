import type Anthropic from "@anthropic-ai/sdk";

export type ToolName = "brave_search" | "memory_read" | "memory_write" | "play_music" | "reminder" | "shopping_list" | "calendar" | "send_message" | "life_journal" | "gamification" | "ambient";

/**
 * Tool definitions for Claude — v3 with reminder and shopping list.
 */
export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "brave_search",
    description:
      "Recherche sur le web via Brave Search. Utilise cet outil quand l'utilisateur pose une question nécessitant des informations récentes ou factuelles.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "La requête de recherche",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_read",
    description:
      "Lire les souvenirs sauvegardés pour un utilisateur. Utilise pour retrouver des informations passées, les préférences, ou les goûts.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Terme de recherche dans la mémoire",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_write",
    description:
      "Sauvegarder une information importante en mémoire pour s'en souvenir plus tard.",
    input_schema: {
      type: "object" as const,
      properties: {
        content: {
          type: "string",
          description: "Le contenu à mémoriser",
        },
        category: {
          type: "string",
          description: "Catégorie du souvenir (preference, fact, todo, note)",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "play_music",
    description:
      "Contrôler la musique : lancer une chanson, un artiste, une playlist, une radio, ou arrêter/mettre en pause la musique.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          description: "Action : play, stop, pause, next, previous, volume, queue, playing",
          enum: ["play", "stop", "pause", "next", "previous", "volume", "queue", "playing"],
        },
        query: {
          type: "string",
          description: "Recherche musicale : nom d'artiste, chanson, genre, playlist, ou station radio. Pour le volume : 'plus fort', 'moins fort', ou un pourcentage.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "reminder",
    description:
      "Créer, lister ou supprimer des rappels. Utilise quand l'utilisateur mentionne quelque chose à ne pas oublier, une tâche à faire, un rendez-vous, un anniversaire, ou tout ce qui ressemble à un pense-bête. Aussi pour les soins des animaux, les dates importantes, la charge mentale du quotidien.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          description: "Action : create, list, delete",
          enum: ["create", "list", "delete"],
        },
        text: {
          type: "string",
          description: "Contenu du rappel : ce dont il faut se souvenir",
        },
        when: {
          type: "string",
          description: "Quand rappeler : 'dans 30 minutes', 'demain', 'à 14h', 'lundi', 'tous les jours'. Vide si pas de moment précis.",
        },
        category: {
          type: "string",
          description: "Catégorie : task, date, pet, health, family, shopping",
          enum: ["task", "date", "pet", "health", "family", "shopping"],
        },
      },
      required: ["action"],
    },
  },
  {
    name: "shopping_list",
    description:
      "Gérer la liste de courses familiale. Ajouter, lire, retirer ou vider des articles. Utilise quand l'utilisateur mentionne qu'il manque quelque chose, qu'il faut acheter un produit, ou demande la liste de courses.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          description: "Action : add, list, remove, clear",
          enum: ["add", "list", "remove", "clear"],
        },
        item: {
          type: "string",
          description: "Nom de l'article à ajouter ou retirer",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "calendar",
    description:
      "Consulter le calendrier familial. Voir les evenements d'aujourd'hui, de la semaine, ou chercher un evenement specifique. Utilise quand l'utilisateur demande son planning, ses rendez-vous, ce qui est prevu, ou verifie si un evenement est maintenu.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          description: "Action : today (aujourd'hui), week (cette semaine), check (verifier un evenement specifique)",
          enum: ["today", "week", "check"],
        },
        query: {
          type: "string",
          description: "Recherche specifique : nom de personne, type d'evenement, etc.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "send_message",
    description:
      "Envoyer un message (email ou SMS) a un membre de la famille ou un contact. Utilise quand l'utilisateur veut prevenir quelqu'un, envoyer un message, ou contacter un proche.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          description: "Action : send (envoyer), contacts (lister les contacts)",
          enum: ["send", "contacts"],
        },
        to: {
          type: "string",
          description: "Destinataire : nom ou relation (fils, fille, maman, etc.)",
        },
        message: {
          type: "string",
          description: "Contenu du message a envoyer",
        },
        method: {
          type: "string",
          description: "Methode d'envoi : email, sms, ou auto (choix automatique)",
          enum: ["email", "sms", "auto"],
        },
      },
      required: ["action"],
    },
  },  {
    name: "life_journal",
    description:
      "Journal de vie familial : score de bien-etre, capsules temporelles, histoires familiales. Utilise quand l'utilisateur veut enregistrer un souvenir pour plus tard, creer une capsule temporelle, raconter une histoire familiale, ou consulter le bien-etre d'un proche.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          description: "Action : wellness (score bien-etre), capsule (creer capsule), story (enregistrer histoire), search_stories (chercher histoires)",
          enum: ["wellness", "capsule", "story", "search_stories"],
        },
        text: { type: "string", description: "Contenu du message, de l'histoire, ou de la capsule" },
        when: { type: "string", description: "Quand livrer la capsule : '1 an', '6 mois', '2 semaines'" },
        query: { type: "string", description: "Recherche dans les histoires familiales" },
      },
      required: ["action"],
    },
  },
  {
    name: "gamification",
    description:
      "Systeme de quetes et progression pour les enfants. Creer des defis, donner des XP, suivre la progression, gerer les quetes. Utilise quand un parent veut creer un defi, quand un enfant termine un exercice, ou pour voir la progression.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          description: "Action : xp (donner XP), progress (voir progression), quest_create (creer quete), quest_complete (terminer quete), quest_list (lister quetes)",
          enum: ["xp", "progress", "quest_create", "quest_complete", "quest_list"],
        },
        player: { type: "string", description: "Nom du joueur (enfant)" },
        skill: { type: "string", description: "Competence : conjugaison, multiplications, lecture, etc." },
        amount: { type: "string", description: "Points XP a ajouter (defaut 20)" },
        title: { type: "string", description: "Titre de la quete" },
        reward: { type: "string", description: "Recompense de la quete" },
      },
      required: ["action"],
    },
  },
  {
    name: "ambient",
    description:
      "Gerer l'ambiance sonore de fond. Lancer un son d'ambiance doux (nature, pluie, feu de cheminee, cafe, jazz, classique) ou l'arreter. Utilise quand l'utilisateur se sent seul, veut du calme, ou demande une ambiance.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          description: "Action : start (lancer), stop (arreter), list (lister les ambiances)",
          enum: ["start", "stop", "list"],
        },
        type: {
          type: "string",
          description: "Type d'ambiance : nature, rain, fireplace, cafe, jazz_doux, classique_doux",
        },
      },
      required: ["action"],
    },
  },
];
