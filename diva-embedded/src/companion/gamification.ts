/**
 * Gamification — Quests, skill tree, XP for children
 * Features: #41 #42 #46
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const GAME_DIR = "/opt/diva-embedded/data/gamification";

interface Quest {
  id: string;
  title: string;
  description: string;
  reward: string;        // "30 min musique", "une histoire", etc.
  rewardMinutes?: number;
  assignedTo: string;
  createdBy: string;
  createdAt: string;
  completed: boolean;
  completedAt?: string;
}

interface SkillProgress {
  skill: string;         // "conjugaison", "multiplications", "lecture"
  level: number;
  xp: number;
  xpForNextLevel: number;
  lastPractice: string;
}

interface PlayerProfile {
  playerId: string;
  displayName: string;
  totalXp: number;
  skills: SkillProgress[];
  completedQuests: number;
  streak: number;        // consecutive days with activity
  lastActiveDate: string;
}

function getProfilePath(playerId: string): string {
  return `${GAME_DIR}/${playerId}-profile.json`;
}

function getQuestsPath(): string {
  return `${GAME_DIR}/quests.json`;
}

function loadProfile(playerId: string): PlayerProfile {
  const path = getProfilePath(playerId);
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf-8"));
  } catch {}
  return {
    playerId,
    displayName: playerId,
    totalXp: 0,
    skills: [],
    completedQuests: 0,
    streak: 0,
    lastActiveDate: "",
  };
}

function saveProfile(profile: PlayerProfile): void {
  if (!existsSync(GAME_DIR)) mkdirSync(GAME_DIR, { recursive: true });
  writeFileSync(getProfilePath(profile.playerId), JSON.stringify(profile, null, 2));
}

function loadQuests(): Quest[] {
  try {
    if (existsSync(getQuestsPath())) return JSON.parse(readFileSync(getQuestsPath(), "utf-8"));
  } catch {}
  return [];
}

function saveQuests(quests: Quest[]): void {
  if (!existsSync(GAME_DIR)) mkdirSync(GAME_DIR, { recursive: true });
  writeFileSync(getQuestsPath(), JSON.stringify(quests, null, 2));
}

// =====================================================================
// XP & Skills
// =====================================================================

export function addXp(playerId: string, skill: string, amount: number): { level: number; levelUp: boolean; message: string } {
  const profile = loadProfile(playerId);
  const today = new Date().toISOString().slice(0, 10);

  // Streak
  if (profile.lastActiveDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    profile.streak = profile.lastActiveDate === yesterday ? profile.streak + 1 : 1;
    profile.lastActiveDate = today;
  }

  // Find or create skill
  let sp = profile.skills.find(s => s.skill === skill);
  if (!sp) {
    sp = { skill, level: 1, xp: 0, xpForNextLevel: 100, lastPractice: today };
    profile.skills.push(sp);
  }

  sp.xp += amount;
  sp.lastPractice = today;
  profile.totalXp += amount;

  let levelUp = false;
  while (sp.xp >= sp.xpForNextLevel) {
    sp.xp -= sp.xpForNextLevel;
    sp.level++;
    sp.xpForNextLevel = Math.round(sp.xpForNextLevel * 1.5);
    levelUp = true;
  }

  saveProfile(profile);

  const message = levelUp
    ? `Bravo ! Tu passes niveau ${sp.level} en ${skill} ! Plus que ${sp.xpForNextLevel - sp.xp} XP pour le prochain niveau.`
    : `+${amount} XP en ${skill}. Niveau ${sp.level}, encore ${sp.xpForNextLevel - sp.xp} XP pour monter.`;

  return { level: sp.level, levelUp, message };
}

export function getProgress(playerId: string): string {
  const profile = loadProfile(playerId);
  if (profile.skills.length === 0) return "Pas encore de progression. Lance-toi dans un exercice !";

  const lines = profile.skills.map(s =>
    `${s.skill} : niveau ${s.level} (${s.xp}/${s.xpForNextLevel} XP)`
  );

  return `Progression de ${profile.displayName} : ${lines.join(", ")}. ${profile.totalXp} XP total, serie de ${profile.streak} jour${profile.streak > 1 ? "s" : ""}.`;
}

// =====================================================================
// Quests
// =====================================================================

export function createQuest(title: string, assignedTo: string, createdBy: string, reward: string): string {
  const quests = loadQuests();
  quests.push({
    id: Date.now().toString(36),
    title,
    description: title,
    reward,
    assignedTo,
    createdBy,
    createdAt: new Date().toISOString(),
    completed: false,
  });
  saveQuests(quests);
  return `Quete creee pour ${assignedTo} : "${title}". Recompense : ${reward}.`;
}

export function completeQuest(playerId: string, questTitle: string): string {
  const quests = loadQuests();
  const q = quests.find(q =>
    !q.completed &&
    q.assignedTo === playerId &&
    q.title.toLowerCase().includes(questTitle.toLowerCase())
  );

  if (!q) return "Quete non trouvee.";

  q.completed = true;
  q.completedAt = new Date().toISOString();
  saveQuests(quests);

  // Award XP
  const { message } = addXp(playerId, "quetes", 50);
  const profile = loadProfile(playerId);
  profile.completedQuests++;
  saveProfile(profile);

  return `Quete "${q.title}" terminee ! Recompense : ${q.reward}. ${message}`;
}

export function listActiveQuests(playerId: string): string {
  const quests = loadQuests().filter(q => !q.completed && q.assignedTo === playerId);
  if (quests.length === 0) return "Pas de quete en cours.";
  return `Quetes actives : ${quests.map(q => `"${q.title}" (recompense: ${q.reward})`).join(", ")}.`;
}

// =====================================================================
// Claude tool handler
// =====================================================================

export async function handleGamificationTool(input: Record<string, string>): Promise<string> {
  const action = (input.action || "progress").toLowerCase();
  const player = input.player || "default";
  const skill = input.skill || "";
  const amount = parseInt(input.amount || "20");

  switch (action) {
    case "xp":
      if (!skill) return "Quelle competence ?";
      return addXp(player, skill, amount).message;
    case "progress":
      return getProgress(player);
    case "quest_create": {
      const title = input.title || input.text || "";
      const reward = input.reward || "une surprise";
      const assignedTo = input.assigned_to || player;
      const createdBy = input.created_by || "parent";
      if (!title) return "Quel est le defi ?";
      return createQuest(title, assignedTo, createdBy, reward);
    }
    case "quest_complete": {
      const title = input.title || input.text || "";
      return completeQuest(player, title);
    }
    case "quest_list":
      return listActiveQuests(player);
    default:
      return getProgress(player);
  }
}
