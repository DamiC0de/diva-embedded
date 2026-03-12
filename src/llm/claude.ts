import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./system-prompt.js";
import { toolDefinitions, type ToolName } from "./tools.js";

const MODEL = "claude-3-5-haiku-20241022";

interface ToolHandler {
  (input: Record<string, string>): Promise<string>;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string | Anthropic.ContentBlock[];
}

/**
 * Claude Haiku LLM client with tool use support.
 */
export class ClaudeClient {
  private client: Anthropic;
  private toolHandlers: Map<ToolName, ToolHandler> = new Map();
  private conversationHistory: ConversationMessage[] = [];
  private memorySummary: string | undefined;

  constructor() {
    this.client = new Anthropic();
  }

  /** Register a handler for a tool. */
  registerTool(name: ToolName, handler: ToolHandler): void {
    this.toolHandlers.set(name, handler);
  }

  /** Set memory summary for system prompt. */
  setMemorySummary(summary: string): void {
    this.memorySummary = summary;
  }

  /** Add a message to conversation history. */
  addToHistory(role: "user" | "assistant", content: string): void {
    this.conversationHistory.push({ role, content });
    // Keep last 20 messages
    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-20);
    }
  }

  /** Clear conversation history. */
  clearHistory(): void {
    this.conversationHistory = [];
  }

  /**
   * Send a message and get a streaming response.
   * Handles tool use automatically.
   * @param userMessage - User's transcribed speech
   * @param onChunk - Callback for each text chunk (for streaming TTS)
   * @returns Full response text
   */
  async chat(
    userMessage: string,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    this.addToHistory("user", userMessage);

    const messages: Anthropic.MessageParam[] = this.conversationHistory.map(
      (msg) => ({
        role: msg.role,
        content: msg.content as string,
      })
    );

    let fullResponse = "";
    let continueLoop = true;

    while (continueLoop) {
      continueLoop = false;

      const stream = this.client.messages.stream({
        model: MODEL,
        max_tokens: 1024,
        system: buildSystemPrompt(this.memorySummary),
        messages,
        tools: toolDefinitions,
      });

      const response = await stream.finalMessage();

      // Process content blocks
      const textParts: string[] = [];
      const toolUseBlocks: Anthropic.ToolUseBlock[] = [];

      for (const block of response.content) {
        if (block.type === "text") {
          textParts.push(block.text);
          if (onChunk) onChunk(block.text);
        } else if (block.type === "tool_use") {
          toolUseBlocks.push(block);
        }
      }

      fullResponse += textParts.join("");

      // Handle tool use
      if (toolUseBlocks.length > 0 && response.stop_reason === "tool_use") {
        // Add assistant message with tool use to messages
        messages.push({ role: "assistant", content: response.content });

        // Execute tools and add results
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const toolBlock of toolUseBlocks) {
          const handler = this.toolHandlers.get(toolBlock.name as ToolName);
          let result: string;
          if (handler) {
            try {
              const input: Record<string, string> = {};
              for (const [k, v] of Object.entries(
                toolBlock.input as Record<string, unknown>
              )) {
                input[k] = String(v);
              }
              result = await handler(input);
            } catch (err) {
              result = `Erreur: ${err instanceof Error ? err.message : String(err)}`;
            }
          } else {
            result = `Outil "${toolBlock.name}" non disponible`;
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolBlock.id,
            content: result,
          });
        }

        messages.push({ role: "user", content: toolResults });
        continueLoop = true; // Continue to get final response after tool use
      }
    }

    this.addToHistory("assistant", fullResponse);
    return fullResponse;
  }

  /**
   * Simple non-streaming chat for quick responses.
   */
  async chatSimple(userMessage: string): Promise<string> {
    return this.chat(userMessage);
  }
}
