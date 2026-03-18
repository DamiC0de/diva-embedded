/**
 * Shopping List — collaborative family shopping list
 * Persistent JSON storage. Verbs: add, remove, read, clear.
 */
interface ShoppingItem {
    name: string;
    addedBy: string;
    addedAt: string;
}
export declare function addItem(name: string, addedBy?: string): string;
export declare function removeItem(name: string): string;
export declare function readList(): string;
export declare function clearList(): string;
export declare function getListItems(): ShoppingItem[];
/**
 * Parse a shopping list command and execute it.
 */
export declare function handleShoppingCommand(text: string, speaker?: string): {
    handled: boolean;
    response?: string;
};
export {};
//# sourceMappingURL=shopping-list.d.ts.map