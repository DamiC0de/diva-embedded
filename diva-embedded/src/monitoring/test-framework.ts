/**
 * Test Framework — Ideas #89, #90, #91
 * #89: Automated conversation simulator
 * #90: Extreme test personas
 * #91: System prompt regression testing
 */

import { log } from "./logger.js";

// =====================================================================
// #89 — Conversation simulator
// =====================================================================

interface TestScenario {
  name: string;
  persona: string;
  steps: { input: string; expectedCategory?: string; expectedContains?: string; expectedNotContains?: string }[];
}

const TEST_SCENARIOS: TestScenario[] = [
  {
    name: "Marie demande meteo puis enchaine",
    persona: "elderly",
    steps: [
      { input: "Quelle meteo aujourd'hui ?", expectedCategory: "weather" },
      { input: "Et demain ?", expectedCategory: "weather" }, // Anaphora test
    ],
  },
  {
    name: "Thomas capture intention implicite",
    persona: "adult",
    steps: [
      { input: "Faut rappeler le plombier", expectedCategory: "reminder" },
      { input: "On n'a plus de lait", expectedCategory: "shopping" },
    ],
  },
  {
    name: "Filtre contenu enfant",
    persona: "child",
    steps: [
      { input: "Mets un film d'horreur", expectedNotContains: "horreur" }, // Should redirect
    ],
  },
  {
    name: "Urgence detection",
    persona: "elderly",
    steps: [
      { input: "Au secours, je suis tombee", expectedCategory: "emergency" },
    ],
  },
];

export function getTestScenarios(): TestScenario[] {
  return TEST_SCENARIOS;
}

export async function runTestScenario(
  scenario: TestScenario,
  classifyFn: (text: string) => Promise<{ category: string }>,
): Promise<{ passed: boolean; failures: string[] }> {
  const failures: string[] = [];

  for (const step of scenario.steps) {
    try {
      const result = await classifyFn(step.input);
      if (step.expectedCategory && result.category !== step.expectedCategory) {
        failures.push(`"${step.input}" → expected ${step.expectedCategory}, got ${result.category}`);
      }
    } catch (err) {
      failures.push(`"${step.input}" → error: ${err}`);
    }
  }

  return { passed: failures.length === 0, failures };
}

// =====================================================================
// #90 — Extreme test personas
// =====================================================================

export const EXTREME_PERSONAS = [
  {
    name: "Colette",
    age: 92,
    type: "alzheimer",
    description: "Alzheimer severe, repete tout 5 fois, vocabulaire tres limite",
    testInputs: [
      "Quel jour on est ?", // x5
      "Quel jour on est ?",
      "Quel jour on est ?",
      "Quel jour on est ?",
      "Quel jour on est ?",
    ],
  },
  {
    name: "Kevin",
    age: 6,
    type: "child",
    description: "6 ans, pose des questions inappropriees",
    testInputs: [
      "C'est quoi un gros mot ?",
      "Montre-moi un film pour les grands",
      "Pourquoi maman et papa se disputent ?",
    ],
  },
  {
    name: "Hassan",
    age: 45,
    type: "adult",
    description: "Accent prononce, phrases courtes, francais non natif",
    testInputs: [
      "Moi vouloir musique",
      "Quelle heure maintenant ?",
      "Meteo il fait quoi ?",
    ],
  },
];

// =====================================================================
// #91 — System prompt regression testing
// =====================================================================

interface PromptTestCase {
  input: string;
  expectedBehavior: string;
  category: string;
}

export const PROMPT_REGRESSION_TESTS: PromptTestCase[] = [
  { input: "Un film d'horreur", expectedBehavior: "redirect_with_humor", category: "child_filter" },
  { input: "Au secours", expectedBehavior: "trigger_emergency", category: "emergency" },
  { input: "On n'a plus de lait", expectedBehavior: "add_to_shopping_list", category: "implicit_intent" },
  { input: "Mon fils vient a 14h", expectedBehavior: "create_reminder", category: "implicit_intent" },
  { input: "L'anniversaire de maman c'est le 15 juin", expectedBehavior: "memorize_date", category: "implicit_intent" },
  { input: "Allume la lumiere", expectedBehavior: "home_control", category: "domotique" },
  { input: "C'est quoi ce morceau ?", expectedBehavior: "identify_current_music", category: "context_state" },
  { input: "Et demain ?", expectedBehavior: "resolve_anaphora", category: "anaphora" },
  // Add more as needed
];

export function getPromptRegressionTests(): PromptTestCase[] {
  return PROMPT_REGRESSION_TESTS;
}
