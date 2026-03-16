/**
 * Qwen 0.5B Local — NPU via RKLLaMA
 * For simple conversational queries (~360ms warm)
 */
const QWEN_URL = process.env.QWEN_URL ?? "http://localhost:8080";
const QWEN_MODEL = "qwen2.5-0.5b";
const QWEN_SYSTEM = `Tu es Diva, une assistante vocale sympathique.
Reponds en francais, en 1-2 phrases courtes maximum.
Pas d emojis. Sois naturelle et chaleureuse.`;
export async function chatQwen(userMessage) {
    try {
        const res = await fetch(`${QWEN_URL}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: QWEN_MODEL,
                messages: [
                    { role: "system", content: QWEN_SYSTEM },
                    { role: "user", content: userMessage },
                ],
                max_tokens: 60,
                temperature: 0.7,
            }),
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok)
            throw new Error(`Qwen HTTP ${res.status}`);
        const data = (await res.json());
        const reply = data.choices?.[0]?.message?.content?.trim() ?? "";
        if (!reply)
            throw new Error("Empty Qwen response");
        console.log(`[Qwen] Local response (${data.choices?.[0]?.message?.content?.length ?? 0} chars)`);
        return reply;
    }
    catch (err) {
        console.warn(`[Qwen] Failed: ${err}, falling back to Claude`);
        return ""; // empty = fallback to Claude
    }
}
//# sourceMappingURL=qwen-local.js.map