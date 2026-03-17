export declare function loadFillers(): void;
export declare function getRandomFiller(category: string): string | null;
export interface FillerChoice {
    primary: string | null;
    secondary: string | null;
}
export declare function chooseFiller(intent: string, text: string): FillerChoice;
//# sourceMappingURL=filler-manager.d.ts.map