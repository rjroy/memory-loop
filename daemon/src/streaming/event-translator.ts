/**
 * Event Translator
 *
 * Converts raw SDK events into the intermediate SdkRunnerEvent schema.
 * Ported from Guild Hall's createStreamTranslator() pattern.
 *
 * The translator is a stateful closure: it tracks block index to tool_use ID
 * mapping and accumulates input_json_delta chunks. It has no side effects
 * (no I/O, no event emission, no persistence). It takes an SDKMessage and
 * returns zero or more SdkRunnerEvents.
 */

 
 
 

import type {
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKUserMessage,
  SDKSystemMessage,
  SDKCompactBoundaryMessage,
  ModelUsage,
} from "@anthropic-ai/claude-agent-sdk";
import type { SdkRunnerEvent, TurnUsageData } from "./types";

/**
 * Raw stream event type from the SDK (excludes error events).
 */
type RawStreamEvent = SDKPartialAssistantMessage["event"];
type ContentStreamEvent = Exclude<RawStreamEvent, { type: "error" }>;

/**
 * Creates a stateful stream translator closure.
 *
 * Call the returned function with each SDKMessage. It returns an array of
 * SdkRunnerEvents (possibly empty). Internal state tracks block index to
 * tool_use ID mapping and accumulates input_json_delta chunks per block.
 */
export function createStreamTranslator(): (msg: SDKMessage) => SdkRunnerEvent[] {
  const blockToolIds = new Map<number, string>();
  const blockInputChunks = new Map<number, string[]>();
  const blockToolNames = new Map<number, string>();

  return (msg: SDKMessage): SdkRunnerEvent[] => {
    switch (msg.type) {
      case "system":
        return handleSystemMessage(msg as SDKSystemMessage);

      case "stream_event":
        return handleStreamEvent(
          msg,
          blockToolIds,
          blockInputChunks,
          blockToolNames
        );

      case "assistant":
        // Ignored when includePartialMessages is enabled. Text arrives
        // via stream_event deltas; the assistant message is redundant.
        return [];

      case "user":
        return handleUserMessage(msg as SDKUserMessage);

      case "result":
        return handleResultMessage(msg);

      default:
        return [];
    }
  };
}

function handleSystemMessage(event: SDKSystemMessage): SdkRunnerEvent[] {
  // Check for compact_boundary events
  const maybeCompact = event as unknown as SDKCompactBoundaryMessage;
  if (
    maybeCompact.subtype === "compact_boundary" &&
    maybeCompact.compact_metadata
  ) {
    return [
      {
        type: "compact_boundary",
        preTokens: maybeCompact.compact_metadata.pre_tokens,
        trigger: maybeCompact.compact_metadata.trigger,
      },
    ];
  }

  // Handle init events (contains session ID)
  if (event.subtype === "init" && event.session_id) {
    return [{ type: "session", sessionId: event.session_id }];
  }

  return [];
}

function handleStreamEvent(
  event: SDKPartialAssistantMessage,
  blockToolIds: Map<number, string>,
  blockInputChunks: Map<number, string[]>,
  blockToolNames: Map<number, string>
): SdkRunnerEvent[] {
  const rawStreamEvent = event.event;

  // Defensive check: SDK may send error events
  if ((rawStreamEvent.type as string) === "error") {
    const errorEvent = rawStreamEvent as unknown as {
      type: "error";
      error: { type?: string; message?: string };
    };
    const errorMessage =
      errorEvent.error?.message ??
      errorEvent.error?.type ??
      "Unknown SDK error during streaming";
    return [{ type: "error", reason: errorMessage }];
  }

  const streamEvent = rawStreamEvent as ContentStreamEvent;

  if (streamEvent.type === "content_block_start") {
    const { index: blockIndex, content_block: contentBlock } = streamEvent;

    if (contentBlock.type === "tool_use") {
      const { id: toolUseId, name: toolName } = contentBlock;
      blockToolIds.set(blockIndex, toolUseId);
      blockInputChunks.set(blockIndex, []);
      blockToolNames.set(blockIndex, toolName);
      return [{ type: "tool_use", name: toolName, id: toolUseId }];
    }

    return [];
  }

  if (streamEvent.type === "content_block_delta") {
    const { index: blockIndex, delta } = streamEvent;

    if (delta.type === "text_delta") {
      return [{ type: "text_delta", text: delta.text }];
    }

    if (delta.type === "input_json_delta") {
      const chunks = blockInputChunks.get(blockIndex);
      if (chunks && delta.partial_json) {
        chunks.push(delta.partial_json);
      }
      // Accumulate only, no event emitted until block_stop
      return [];
    }

    return [];
  }

  if (streamEvent.type === "content_block_stop") {
    const { index: blockIndex } = streamEvent;
    const toolUseId = blockToolIds.get(blockIndex);
    const chunks = blockInputChunks.get(blockIndex);

    if (toolUseId && chunks) {
      const jsonStr = chunks.join("");
      // Clean up maps
      blockToolIds.delete(blockIndex);
      blockInputChunks.delete(blockIndex);
      blockToolNames.delete(blockIndex);

      try {
        const input: unknown = jsonStr ? JSON.parse(jsonStr) : {};
        return [{ type: "tool_input", toolUseId, input }];
      } catch {
        // If JSON parse fails, emit with raw string as input
        return [{ type: "tool_input", toolUseId, input: jsonStr }];
      }
    }

    return [];
  }

  return [];
}

function handleUserMessage(event: SDKUserMessage): SdkRunnerEvent[] {
  const { message } = event;
  const content = message.content;
  if (!Array.isArray(content)) return [];

  const events: SdkRunnerEvent[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null || !("type" in block)) {
      continue;
    }

    if (block.type === "tool_result" && "tool_use_id" in block) {
      const toolUseId = block.tool_use_id;
      const output = ("content" in block ? block.content : null) as string;
      events.push({
        type: "tool_result",
        name: "",
        output: output ?? "",
        toolUseId,
      });
    }
  }

  return events;
}

function handleResultMessage(event: SDKResultMessage): SdkRunnerEvent[] {
  // Check for error results
  if (event.subtype !== "success") {
    const errorEvent = event as {
      subtype: string;
      errors?: string[];
    };

    let errorMessage: string;
    if (errorEvent.errors && errorEvent.errors.length > 0) {
      errorMessage = errorEvent.errors.join("; ");
    } else {
      switch (errorEvent.subtype) {
        case "error_max_turns":
          errorMessage = "Conversation reached maximum turns limit.";
          break;
        case "error_max_budget_usd":
          errorMessage = "Conversation exceeded budget limit.";
          break;
        case "error_max_structured_output_retries":
          errorMessage =
            "Failed to generate structured output after maximum retries.";
          break;
        case "error_during_execution":
        default:
          errorMessage = "An error occurred during execution.";
      }
    }

    return [{ type: "error", reason: errorMessage }];
  }

  const { usage, modelUsage, total_cost_usd } = event;

  let usageData: TurnUsageData | undefined;
  if (usage && modelUsage) {
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;

    const modelNames = Object.keys(modelUsage);
    const modelName = modelNames[0];
    let contextWindow: number | undefined;
    if (modelName && modelUsage[modelName]) {
      const modelStats: ModelUsage = modelUsage[modelName];
      contextWindow = modelStats.contextWindow;
    }

    usageData = {
      inputTokens,
      outputTokens,
      contextWindow,
      model: modelName,
    };
  }

  return [
    {
      type: "turn_end",
      cost: total_cost_usd,
      usage: usageData,
    },
  ];
}

/**
 * Checks if an error message indicates a session expiry or not-found error.
 * Used in resume failure detection (Step 3).
 */
export function isSessionExpiryError(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  return (
    lowerMessage.includes("session not found") ||
    lowerMessage.includes("session expired") ||
    lowerMessage.includes("session has expired") ||
    lowerMessage.includes("could not find session") ||
    lowerMessage.includes("no such session") ||
    lowerMessage.includes("invalid session")
  );
}
