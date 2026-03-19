/**
 * Shopping List Claude Tool Handler — wraps shopping-list.ts for Claude
 */

import { addItem, removeItem, readList, clearList } from "./shopping-list.js";
import { getCurrentUser } from "./memory-tool.js";

export async function handleShoppingListTool(input: Record<string, string>): Promise<string> {
  const action = (input.action || "list").toLowerCase();
  const item = input.item || "";
  const speaker = getCurrentUser();

  switch (action) {
    case "add":
      if (!item) return "Quel article ajouter ?";
      return addItem(item, speaker);
    case "remove":
      if (!item) return "Quel article retirer ?";
      return removeItem(item);
    case "list":
    case "read":
      return readList();
    case "clear":
      return clearList();
    default:
      if (item) return addItem(item, speaker);
      return readList();
  }
}
