/**
 * Shopping List — collaborative family shopping list
 * Persistent JSON storage. Verbs: add, remove, read, clear.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const LIST_PATH = "/opt/diva-embedded/data/shopping-list.json";
function loadList() {
    try {
        if (existsSync(LIST_PATH)) {
            return JSON.parse(readFileSync(LIST_PATH, "utf-8"));
        }
    }
    catch { }
    return [];
}
function saveList(items) {
    writeFileSync(LIST_PATH, JSON.stringify(items, null, 2));
}
export function addItem(name, addedBy = "default") {
    const items = loadList();
    const normalized = name.trim().toLowerCase();
    // Check duplicate
    if (items.some((i) => i.name.toLowerCase() === normalized)) {
        return `${name} est deja sur la liste.`;
    }
    items.push({
        name: name.trim(),
        addedBy,
        addedAt: new Date().toISOString(),
    });
    saveList(items);
    return `${name} ajouté a la liste. Il y a ${items.length} article${items.length > 1 ? "s" : ""} au total.`;
}
export function removeItem(name) {
    const items = loadList();
    const normalized = name.trim().toLowerCase();
    const idx = items.findIndex((i) => i.name.toLowerCase() === normalized);
    if (idx === -1) {
        return `${name} n'est pas sur la liste.`;
    }
    items.splice(idx, 1);
    saveList(items);
    return `${name} retire de la liste.`;
}
export function readList() {
    const items = loadList();
    if (items.length === 0) {
        return "La liste de courses est vide.";
    }
    const itemNames = items.map((i) => i.name);
    if (items.length <= 3) {
        return `Sur la liste : ${itemNames.join(", ")}.`;
    }
    return `Il y a ${items.length} articles sur la liste : ${itemNames.slice(0, 5).join(", ")}${items.length > 5 ? ` et ${items.length - 5} de plus` : ""}.`;
}
export function clearList() {
    saveList([]);
    return "Liste de courses videe.";
}
export function getListItems() {
    return loadList();
}
/**
 * Parse a shopping list command and execute it.
 */
export function handleShoppingCommand(text, speaker = "default") {
    const t = text.toLowerCase();
    // Clear
    if (/vide|efface|supprime\s+tout|reset/i.test(t) && /liste/i.test(t)) {
        return { handled: true, response: clearList() };
    }
    // Read
    if (/qu.est.ce qu|quoi|lis|donne|montre|c.est quoi|combien/i.test(t) && /liste/i.test(t)) {
        return { handled: true, response: readList() };
    }
    // Remove: "enlève X de la liste" / "retire X"
    const removeMatch = t.match(/(?:enl[eè]ve|retire|supprime)\s+(?:le|la|les|du|de la|des)?\s*(.+?)(?:\s+(?:de|sur)\s+la\s+liste)?$/i);
    if (removeMatch) {
        return { handled: true, response: removeItem(removeMatch[1].trim()) };
    }
    // Add: "ajoute X à la liste" / "mets X sur la liste" / "X sur la liste"
    const addMatch = t.match(/(?:ajoute|mets?|rajoute)\s+(?:du|de la|des|le|la|les|un|une)?\s*(.+?)(?:\s+(?:[aà]|sur|dans)\s+la\s+liste)?$/i);
    if (addMatch) {
        return { handled: true, response: addItem(addMatch[1].trim(), speaker) };
    }
    return { handled: false };
}
//# sourceMappingURL=shopping-list.js.map