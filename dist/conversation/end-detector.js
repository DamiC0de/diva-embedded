// End of conversation detector using Qwen NPU

// Obvious END patterns - no need for Qwen
const OBVIOUS_END_PATTERNS = [
    /^(stop|arr[eê]te|tais[- ]toi|ta gueule|ferme[- ]la|silence)\b/i,
    /^(bye|ciao|adieu|bonne nuit)\s*[!.]*$/i,
    /\b([aà] plus|[aà] bient[oô]t|[aà] demain)\s*[!.]*$/i,
    /\b(c.est (bon|fini|tout)|j.ai fini|merci.{0,10}(c.est tout|[aà] plus))\b/i,
    /\b(salut|bonne soir[eé]e)\s*[!.]*$/i,
];

// Obvious QUESTION patterns - definitely NOT an end
const OBVIOUS_QUESTION_PATTERNS = [
    /\b(qui|que|quoi|quel|quelle|comment|pourquoi|combien|o[uù]|quand)\b.*\?/i,
    /\b(est-ce que|c.est quoi|peux-tu|dis-moi|explique|cherche|trouve)\b/i,
    /\b(allume|[eé]teins|mets|lance|joue|r[eè]gle|programme)\b/i,
    /\b(et aussi|autre chose|encore une|derni[eè]re chose|sinon)\b/i,
];

export async function detectEndOfConversation(text) {
    const start = Date.now();
    const clean = text.trim();
    
    // Fast check 1: Obvious end
    for (const pattern of OBVIOUS_END_PATTERNS) {
        if (pattern.test(clean)) {
            console.log('[EndDetect] Fast end:', pattern);
            return { isEnd: true, method: 'fast', latency_ms: Date.now() - start };
        }
    }
    
    // Fast check 2: Obvious question (not an end)
    for (const pattern of OBVIOUS_QUESTION_PATTERNS) {
        if (pattern.test(clean)) {
            console.log('[EndDetect] Fast question, not end');
            return { isEnd: false, method: 'fast', latency_ms: Date.now() - start };
        }
    }
    
    // Short phrases are often conclusions
    if (clean.length < 20 && /^(ok|parfait|super|nickel|top|merci|cool|g[eé]nial)\b/i.test(clean)) {
        console.log('[EndDetect] Short conclusion phrase');
        return { isEnd: true, method: 'short', latency_ms: Date.now() - start };
    }
    
    // Default: not an end (continue conversation)
    console.log('[EndDetect] Ambiguous, defaulting to continue');
    return { isEnd: false, method: 'default', latency_ms: Date.now() - start };
}
