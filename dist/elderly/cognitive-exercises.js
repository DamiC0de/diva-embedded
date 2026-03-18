/**
 * Cognitive Stimulation Exercises — gentle activities for Alzheimer personas
 * Reminiscence, memory quiz, songs to complete
 * Always encouraging. No scoring, no judgment.
 */
import { readFileSync, existsSync } from "node:fs";
const EXERCISES_PATH = "/opt/diva-embedded/data/cognitive-exercises.json";
const DEFAULT_EXERCISES = [
    // Reminiscence
    { id: 1, type: "reminiscence", prompt: "Quel est votre plus beau souvenir d'enfance ?", encouragement: "Merci de partager ca avec moi, c'est un tres beau souvenir." },
    { id: 2, type: "reminiscence", prompt: "Racontez-moi votre plat prefere quand vous etiez petit.", encouragement: "Ca a l'air delicieux ! Merci pour ce joli souvenir." },
    { id: 3, type: "reminiscence", prompt: "Quel etait votre jeu prefere quand vous etiez enfant ?", encouragement: "Oh, ca devait etre tres amusant !" },
    { id: 4, type: "reminiscence", prompt: "Parlez-moi d'un endroit que vous avez aime visiter.", encouragement: "Ca a l'air magnifique. Merci de m'en parler." },
    { id: 5, type: "reminiscence", prompt: "Quel metier vouliez-vous faire quand vous etiez jeune ?", encouragement: "C'est un tres beau reve !" },
    // Song completion
    { id: 10, type: "song", prompt: "Completez la chanson : A la claire fontaine, m'en allant...", hint: "promener", encouragement: "Bravo ! Vous avez une belle memoire musicale." },
    { id: 11, type: "song", prompt: "Completez : Frere Jacques, Frere Jacques, dormez-vous...", hint: "dormez-vous", encouragement: "Parfait ! Quelle belle chanson." },
    { id: 12, type: "song", prompt: "Completez : Au clair de la lune, mon ami...", hint: "Pierrot", encouragement: "Magnifique ! Vous connaissez bien vos classiques." },
    // Proverbs
    { id: 20, type: "proverb", prompt: "Completez le proverbe : Qui seme le vent...", hint: "recolte la tempete", encouragement: "Excellent ! Vous connaissez bien vos proverbes." },
    { id: 21, type: "proverb", prompt: "Completez : Pierre qui roule...", hint: "n'amasse pas mousse", encouragement: "Tres bien ! Bravo." },
    { id: 22, type: "proverb", prompt: "Completez : L'habit ne fait pas...", hint: "le moine", encouragement: "Parfait ! Belle reponse." },
    // Simple quizzes (always encouraging, never wrong)
    { id: 30, type: "quiz", prompt: "De quelle couleur est le ciel quand il fait beau ?", hint: "bleu", encouragement: "Tout a fait ! Le ciel bleu, c'est magnifique." },
    { id: 31, type: "quiz", prompt: "Combien de pattes a un chat ?", hint: "quatre", encouragement: "Exactement ! Vous etes fort." },
    { id: 32, type: "quiz", prompt: "En quelle saison les feuilles tombent des arbres ?", hint: "automne", encouragement: "Bravo ! L'automne est une belle saison." },
];
const usedExercises = new Set();
function loadExercises() {
    try {
        if (existsSync(EXERCISES_PATH)) {
            return JSON.parse(readFileSync(EXERCISES_PATH, "utf-8"));
        }
    }
    catch { }
    return DEFAULT_EXERCISES;
}
export function getRandomExercise(type) {
    const exercises = loadExercises();
    const filtered = type ? exercises.filter((e) => e.type === type) : exercises;
    if (filtered.length === 0)
        return null;
    const available = filtered.filter((e) => !usedExercises.has(e.id));
    if (available.length === 0) {
        usedExercises.clear();
        return filtered[Math.floor(Math.random() * filtered.length)];
    }
    const pick = available[Math.floor(Math.random() * available.length)];
    usedExercises.add(pick.id);
    return pick;
}
/**
 * Generate a cognitive exercise interaction response.
 * The caller should speak the prompt, listen, then speak the encouragement.
 */
export function buildExerciseResponse(exercise) {
    return {
        prompt: exercise.prompt,
        encouragement: exercise.encouragement,
        hint: exercise.hint,
    };
}
//# sourceMappingURL=cognitive-exercises.js.map