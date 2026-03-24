/**
 * Multi-Request Handler — Story 1.6 / FR206
 * Orchestrates parallel classification and treatment of multiple sub-requests.
 * Classifies each sub-request independently, treats local and complex ones in parallel,
 * then assembles a unified narrative response.
 */

import { classifyIntent, handleLocalIntent } from "./intent-router.js";
import { composeResponse, type SubResult } from "./response-composer.js";
import type { SubRequest } from "./multi-request-parser.js";
import { log } from "../monitoring/logger.js";

/** Target latency for multi-request processing (configurable) */
export const MULTI_REQUEST_TARGET_MS = parseInt(process.env.MULTI_REQUEST_TARGET_MS ?? "3000", 10);

/**
 * Handle multiple sub-requests in parallel.
 *
 * 1. Classify all sub-requests in parallel via classifyIntent()
 * 2. Separate into local vs complex groups
 * 3. Treat local sub-requests in parallel via handleLocalIntent()
 * 4. Group complex sub-requests into a single Claude call
 * 5. Assemble all results and compose a unified narrative response
 *
 * @param subRequests - Array of parsed sub-requests
 * @param fullTranscription - Original full transcription text
 * @param speaker - Speaker identifier
 * @param correlationId - Correlation ID for logging
 * @param claudeChat - Optional Claude chat function for complex sub-requests
 * @returns Unified narrative response string
 */
export async function handleMultiRequest(
  subRequests: SubRequest[],
  fullTranscription: string,
  speaker: string,
  correlationId: string,
  claudeChat?: (message: string) => Promise<string>,
): Promise<string> {
  const t0 = Date.now();

  log.info("multi-request-detected", {
    event: "multi-request-detected",
    subRequestCount: subRequests.length,
    correlationId,
  });

  // Step 1: Classify all sub-requests in parallel
  const classificationStart = Date.now();
  const classifications = await Promise.all(
    subRequests.map(sr => classifyIntent(sr.text).catch(err => {
      log.warn("Multi-request classification failed", {
        correlationId,
        error: String(err),
        subRequestIndex: sr.originalIndex,
      });
      return { intent: "complex" as const, category: "fallback", confidence: 0, latency_ms: 0 };
    }))
  );
  const classificationMs = Date.now() - classificationStart;

  // Step 2: Separate into local and complex groups
  const localRequests: Array<{ subRequest: SubRequest; classification: typeof classifications[0] }> = [];
  const complexRequests: Array<{ subRequest: SubRequest; classification: typeof classifications[0] }> = [];

  for (let i = 0; i < subRequests.length; i++) {
    const classification = classifications[i];
    if (classification.intent === "local" || classification.intent === "local_simple") {
      localRequests.push({ subRequest: subRequests[i], classification });
    } else {
      complexRequests.push({ subRequest: subRequests[i], classification });
    }
  }

  // Step 3: Process local and complex in parallel
  const results: SubResult[] = new Array(subRequests.length);
  const perRequestLatencyMs: number[] = new Array(subRequests.length).fill(0);

  // Create timeout race helper
  const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
  };

  const remainingBudget = MULTI_REQUEST_TARGET_MS - (Date.now() - t0);

  // Process local requests
  const localPromise = Promise.allSettled(
    localRequests.map(async ({ subRequest, classification }) => {
      const tLocal = Date.now();
      try {
        const localResult = await withTimeout(
          handleLocalIntent(classification.category, subRequest.text),
          Math.max(remainingBudget, 1000),
          { handled: false, response: undefined },
        );
        perRequestLatencyMs[subRequest.originalIndex] = Date.now() - tLocal;

        if (localResult.handled && localResult.response) {
          results[subRequest.originalIndex] = {
            text: localResult.response,
            category: classification.category,
            success: true,
            originalIndex: subRequest.originalIndex,
          };
        } else {
          // Handler declined, treat as complex
          results[subRequest.originalIndex] = {
            text: "",
            category: classification.category,
            success: false,
            error: `Impossible de traiter: ${subRequest.text}`,
            originalIndex: subRequest.originalIndex,
          };
        }
      } catch (err) {
        perRequestLatencyMs[subRequest.originalIndex] = Date.now() - tLocal;
        log.warn("Multi-request local handler failed", {
          correlationId,
          error: String(err),
          subRequestIndex: subRequest.originalIndex,
          category: classification.category,
        });
        results[subRequest.originalIndex] = {
          text: "",
          category: classification.category,
          success: false,
          error: String(err),
          originalIndex: subRequest.originalIndex,
        };
      }
    })
  );

  // Process complex requests (grouped into a single Claude call)
  const complexPromise = (async () => {
    if (complexRequests.length === 0) return;

    const tComplex = Date.now();

    if (!claudeChat) {
      // No Claude function provided — mark all complex as failed
      for (const { subRequest, classification } of complexRequests) {
        perRequestLatencyMs[subRequest.originalIndex] = Date.now() - tComplex;
        results[subRequest.originalIndex] = {
          text: "",
          category: classification.category,
          success: false,
          error: "Service Claude non disponible",
          originalIndex: subRequest.originalIndex,
        };
      }
      return;
    }

    try {
      // Build multi-request prompt for Claude
      const subPrompts = complexRequests.map(({ subRequest }, idx) =>
        `[REQ_${idx + 1}]: ${subRequest.text}`
      ).join("\n");

      const multiPrompt = `L'utilisateur a fait plusieurs demandes dans une seule phrase. Reponds a chacune separement, en commencant chaque reponse par [REQ_N]:\n\n${subPrompts}`;

      const claudeResponse = await withTimeout(
        claudeChat(multiPrompt),
        Math.max(remainingBudget, 2000),
        "",
      );

      // Parse Claude response to extract individual responses
      const responseMap = parseClaudeMultiResponse(claudeResponse, complexRequests.length);

      for (let i = 0; i < complexRequests.length; i++) {
        const { subRequest, classification } = complexRequests[i];
        perRequestLatencyMs[subRequest.originalIndex] = Date.now() - tComplex;

        const responseText = responseMap[i] || "";
        results[subRequest.originalIndex] = {
          text: responseText,
          category: classification.category,
          success: responseText.length > 0,
          error: responseText.length === 0 ? "Pas de reponse de Claude" : undefined,
          originalIndex: subRequest.originalIndex,
        };
      }
    } catch (err) {
      for (const { subRequest, classification } of complexRequests) {
        perRequestLatencyMs[subRequest.originalIndex] = Date.now() - tComplex;
        results[subRequest.originalIndex] = {
          text: "",
          category: classification.category,
          success: false,
          error: String(err),
          originalIndex: subRequest.originalIndex,
        };
      }
      log.warn("Multi-request Claude call failed", {
        correlationId,
        error: String(err),
      });
    }
  })();

  // Wait for both local and complex processing
  await Promise.all([localPromise, complexPromise]);

  // Fill in any missing results (shouldn't happen, but safety net)
  for (let i = 0; i < subRequests.length; i++) {
    if (!results[i]) {
      results[i] = {
        text: "",
        category: "unknown",
        success: false,
        error: "Timeout",
        originalIndex: i,
      };
    }
  }

  // Step 4: Compose unified response
  const response = composeResponse(results.filter(r => r != null));

  const totalLatencyMs = Date.now() - t0;

  log.info("multi-request-completed", {
    event: "multi-request-completed",
    subRequestCount: subRequests.length,
    localCount: localRequests.length,
    claudeCount: complexRequests.length,
    totalLatencyMs,
    classificationMs,
    perRequestLatencyMs,
    correlationId,
  });

  // Log warning if over target
  if (totalLatencyMs > MULTI_REQUEST_TARGET_MS) {
    log.warn("Multi-request exceeded target latency", {
      totalLatencyMs,
      targetMs: MULTI_REQUEST_TARGET_MS,
      correlationId,
    });
  }

  return response;
}

/**
 * Parse a Claude multi-response into individual responses by [REQ_N] markers.
 */
function parseClaudeMultiResponse(response: string, expectedCount: number): string[] {
  const results: string[] = Array.from({ length: expectedCount }, () => "");

  if (!response) return results;

  // Try to extract by [REQ_N] markers
  for (let i = 0; i < expectedCount; i++) {
    const marker = `[REQ_${i + 1}]`;
    const nextMarker = `[REQ_${i + 2}]`;
    const startIdx = response.indexOf(marker);
    if (startIdx === -1) continue;

    const afterMarker = startIdx + marker.length;
    const endIdx = i < expectedCount - 1 ? response.indexOf(nextMarker) : response.length;
    const text = response.slice(afterMarker, endIdx === -1 ? response.length : endIdx)
      .replace(/^[\s:]+/, "")
      .trim();
    results[i] = text;
  }

  // If no markers found, try splitting by newlines
  if (results.every(r => r === "")) {
    const lines = response.split(/\n+/).filter(l => l.trim().length > 0);
    for (let i = 0; i < Math.min(lines.length, expectedCount); i++) {
      (results as string[])[i] = lines[i].trim();
    }
  }

  return results;
}
