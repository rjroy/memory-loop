/**
 * Session Streamer
 *
 * Transforms SDK events into SessionEvents for the Active Session Controller.
 * Extracted from websocket-handler.ts streaming logic.
 */

import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKUserMessage,
  SDKSystemMessage,
  SDKCompactBoundaryMessage,
  ModelUsage,
} from "@anthropic-ai/claude-agent-sdk";
import type { StoredToolInvocation } from "@memory-loop/shared";
import type { SessionEvent } from "./types.js";
import { sessionLog as log } from "../logger.js";

/**
 * Type alias for raw stream events from the SDK.
 */
type RawStreamEvent = SDKPartialAssistantMessage["event"];

/**
 * Stream events that have content (excludes error events).
 */
type ContentStreamEvent = Exclude<RawStreamEvent, { type: "error" }>;

/**
 * Tracks state for a content block during streaming.
 */
interface ContentBlockState {
  type: "text" | "tool_use";
  toolUseId?: string;
  toolName?: string;
  inputJsonChunks?: string[];
}

/**
 * Result from streaming SDK events.
 * Contains accumulated response text, tool invocations, and usage stats.
 */
export interface StreamingResult {
  content: string;
  toolInvocations: StoredToolInvocation[];
  contextUsage?: number;
}

/**
 * State tracked across the streaming lifecycle.
 */
export interface StreamerState {
  cumulativeTokens: number;
  contextWindow: number | null;
  activeModel: string | null;
}

/**
 * Emitter interface for the streamer to send events.
 */
export interface StreamerEmitter {
  emit(event: SessionEvent): void;
}

/**
 * Streams SDK events and emits SessionEvents.
 *
 * @param events - Async generator of SDK events
 * @param messageId - Message ID for response events
 * @param emitter - Emitter to send SessionEvents
 * @param state - Mutable state for token tracking
 * @param abortSignal - Optional abort signal to stop streaming
 * @returns StreamingResult with accumulated content and tool invocations
 */
export async function streamSdkEvents(
  events: AsyncGenerator<SDKMessage, void>,
  messageId: string,
  emitter: StreamerEmitter,
  state: StreamerState,
  abortSignal?: AbortSignal
): Promise<StreamingResult> {
  const responseChunks: string[] = [];
  const toolsMap = new Map<string, StoredToolInvocation>();
  const contentBlocks = new Map<number, ContentBlockState>();
  let contextUsage: number | undefined;

  for await (const event of events) {
    // Check for abort
    if (abortSignal?.aborted) {
      log.debug("Streaming aborted");
      // Mark any running tools as incomplete
      for (const tool of toolsMap.values()) {
        if (tool.status === "running") {
          tool.status = "complete";
          tool.output = "[Streaming aborted]";
        }
      }
      break;
    }

    log.debug(`SDK event: ${event.type}`, summarizeEvent(event));

    switch (event.type) {
      case "stream_event": {
        const text = handleStreamEvent(
          event,
          messageId,
          emitter,
          toolsMap,
          contentBlocks
        );
        if (text) {
          responseChunks.push(text);
        }
        break;
      }
      case "assistant": {
        // Assistant event contains the complete message - use as authoritative source
        const assistantEvent = event as SDKAssistantMessage;
        const completeContent = extractAssistantContent(assistantEvent);
        if (completeContent) {
          // Replace accumulated chunks with complete content
          responseChunks.length = 0;
          responseChunks.push(completeContent);
        }
        break;
      }
      case "result": {
        const usage = handleResultEvent(event, emitter, toolsMap, state);
        if (usage !== undefined) {
          contextUsage = usage;
        }
        // Result is the terminal event - return immediately
        return {
          content: responseChunks.join(""),
          toolInvocations: Array.from(toolsMap.values()),
          contextUsage,
        };
      }
      case "user": {
        handleUserEvent(event, emitter, toolsMap);
        break;
      }
      case "system": {
        handleSystemEvent(event, state);
        break;
      }
    }
  }

  return {
    content: responseChunks.join(""),
    toolInvocations: Array.from(toolsMap.values()),
    contextUsage,
  };
}

/**
 * Creates a summary of an SDK event for logging.
 */
function summarizeEvent(event: SDKMessage): Record<string, unknown> {
  const summary: Record<string, unknown> = { type: event.type };

  if (event.type === "stream_event") {
    const rawStreamEvent = event.event;

    // Defensive check: SDK may send error events
    if ((rawStreamEvent.type as string) === "error") {
      summary.streamType = "error";
      return summary;
    }

    const streamEvent = rawStreamEvent as ContentStreamEvent;
    summary.streamType = streamEvent.type;

    if ("index" in streamEvent && typeof streamEvent.index === "number") {
      summary.index = streamEvent.index;
    }

    if (streamEvent.type === "content_block_start") {
      const cb = streamEvent.content_block;
      summary.contentBlock = {
        type: cb.type,
        id: "id" in cb ? cb.id : undefined,
        name: "name" in cb ? cb.name : undefined,
      };
    }

    if (streamEvent.type === "content_block_delta") {
      summary.deltaType = streamEvent.delta.type;
    }
  }

  return summary;
}

/**
 * Handles streaming events containing deltas and content block lifecycle.
 */
function handleStreamEvent(
  event: SDKPartialAssistantMessage,
  messageId: string,
  emitter: StreamerEmitter,
  toolsMap: Map<string, StoredToolInvocation>,
  contentBlocks: Map<number, ContentBlockState>
): string {
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

    log.warn("Stream error event received", { error: errorEvent.error });

    emitter.emit({
      type: "error",
      code: "SDK_ERROR",
      message: errorMessage,
    });

    return "";
  }

  const streamEvent = rawStreamEvent as ContentStreamEvent;

  if (streamEvent.type === "content_block_start") {
    const { index: blockIndex, content_block: contentBlock } = streamEvent;

    if (contentBlock.type === "tool_use") {
      const { id: toolUseId, name: toolName } = contentBlock;

      log.info(`Tool started: ${toolName} (${toolUseId})`);

      contentBlocks.set(blockIndex, {
        type: "tool_use",
        toolUseId,
        toolName,
        inputJsonChunks: [],
      });

      emitter.emit({
        type: "tool_start",
        toolName,
        toolUseId,
      });

      toolsMap.set(toolUseId, {
        toolUseId,
        toolName,
        status: "running",
      });
    } else if (contentBlock.type === "text") {
      contentBlocks.set(blockIndex, { type: "text" });

      // If tools have been used, add a paragraph break before continuing text
      if (toolsMap.size > 0) {
        return "\n\n";
      }
    }

    return "";
  }

  if (streamEvent.type === "content_block_delta") {
    const { index: blockIndex, delta } = streamEvent;

    if (delta.type === "text_delta") {
      const { text } = delta;
      emitter.emit({
        type: "response_chunk",
        messageId,
        content: text,
      });
      return text;
    }

    if (delta.type === "input_json_delta") {
      const { partial_json: partialJson } = delta;
      const block = contentBlocks.get(blockIndex);
      if (partialJson && block?.type === "tool_use" && block.inputJsonChunks) {
        block.inputJsonChunks.push(partialJson);
      }
    }

    return "";
  }

  if (streamEvent.type === "content_block_stop") {
    const { index: blockIndex } = streamEvent;
    const block = contentBlocks.get(blockIndex);

    if (block?.type === "tool_use" && block.toolUseId && block.inputJsonChunks) {
      const jsonStr = block.inputJsonChunks.join("");
      try {
        const input: unknown = jsonStr ? JSON.parse(jsonStr) : {};

        log.debug(`Tool input complete for ${block.toolName}`, {
          inputLength: jsonStr.length,
        });

        emitter.emit({
          type: "tool_input",
          toolUseId: block.toolUseId,
          input,
        });

        const tracked = toolsMap.get(block.toolUseId);
        if (tracked) {
          tracked.input = input;
        }
      } catch (err) {
        log.warn(`Failed to parse tool input JSON for ${block.toolUseId}`, {
          jsonStr,
          err,
        });
      }
    }

    contentBlocks.delete(blockIndex);
    return "";
  }

  return "";
}

/**
 * Handles result events containing tool usage and context statistics.
 */
function handleResultEvent(
  event: SDKResultMessage,
  emitter: StreamerEmitter,
  toolsMap: Map<string, StoredToolInvocation>,
  state: StreamerState
): number | undefined {
  // Check for error results
  if (event.subtype !== "success") {
    const errorEvent = event as {
      subtype: string;
      errors?: string[];
      is_error?: boolean;
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

    log.warn(`SDK result error: ${errorEvent.subtype}`, {
      errors: errorEvent.errors,
    });

    emitter.emit({
      type: "error",
      code: "SDK_ERROR",
      message: errorMessage,
    });
  }

  const { usage, modelUsage } = event;

  let contextUsage: number | undefined;
  if (usage && modelUsage) {
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const turnTokens = inputTokens + outputTokens;

    // Accumulate tokens
    state.cumulativeTokens += turnTokens;

    const modelNames = Object.keys(modelUsage);
    const modelName = state.activeModel ?? modelNames[0];
    if (modelName && modelUsage[modelName]) {
      const modelStats: ModelUsage = modelUsage[modelName];
      const contextWindow = modelStats.contextWindow;
      if (contextWindow && contextWindow > 0) {
        state.contextWindow = contextWindow;
        contextUsage = Math.round(
          (100 * state.cumulativeTokens) / contextWindow
        );
        contextUsage = Math.max(0, Math.min(100, contextUsage));
        log.debug(
          `Context usage: ${state.cumulativeTokens}/${contextWindow} = ${contextUsage}% ` +
            `(turn: +${turnTokens}, model: ${modelName})`
        );
      }
    }
  }

  // Process tool results from event content
  const rawEvent = event as unknown as { result?: { content?: unknown[] } };
  const result = rawEvent.result;
  if (!result || !Array.isArray(result.content)) return contextUsage;

  for (const block of result.content) {
    if (typeof block !== "object" || block === null || !("type" in block))
      continue;
    const typedBlock = block as {
      type: string;
      name?: string;
      id?: string;
      input?: unknown;
      tool_use_id?: string;
      content?: unknown;
    };

    if (typedBlock.type === "tool_use" && typedBlock.name && typedBlock.id) {
      const existing = toolsMap.get(typedBlock.id);
      if (!existing) {
        log.debug(
          `Tool ${typedBlock.name} (${typedBlock.id}) tracked from result event (fallback)`
        );
        toolsMap.set(typedBlock.id, {
          toolUseId: typedBlock.id,
          toolName: typedBlock.name,
          status: "running",
          input: typedBlock.input,
        });
        emitter.emit({
          type: "tool_start",
          toolName: typedBlock.name,
          toolUseId: typedBlock.id,
        });
        if (typedBlock.input !== undefined) {
          emitter.emit({
            type: "tool_input",
            toolUseId: typedBlock.id,
            input: typedBlock.input,
          });
        }
      } else if (!existing.input && typedBlock.input !== undefined) {
        existing.input = typedBlock.input;
      }
    } else if (typedBlock.type === "tool_result" && typedBlock.tool_use_id) {
      log.info(`Tool completed: ${typedBlock.tool_use_id}`);
      emitter.emit({
        type: "tool_end",
        toolUseId: typedBlock.tool_use_id,
        output: typedBlock.content ?? null,
      });
      const tracked = toolsMap.get(typedBlock.tool_use_id);
      if (tracked) {
        tracked.output = typedBlock.content ?? null;
        tracked.status = "complete";
      }
    }
  }

  return contextUsage;
}

/**
 * Handles user events containing tool results.
 */
function handleUserEvent(
  event: SDKUserMessage,
  emitter: StreamerEmitter,
  toolsMap: Map<string, StoredToolInvocation>
): void {
  const { message } = event;
  const content = message.content;
  if (!Array.isArray(content)) return;

  for (const block of content) {
    if (typeof block !== "object" || block === null || !("type" in block))
      continue;

    if (block.type === "tool_result" && "tool_use_id" in block) {
      const toolUseId = block.tool_use_id;
      const output = "content" in block ? block.content : null;

      log.info(`Tool completed (from user event): ${toolUseId}`);
      emitter.emit({
        type: "tool_end",
        toolUseId,
        output: output ?? null,
      });

      const tracked = toolsMap.get(toolUseId);
      if (tracked) {
        tracked.output = output ?? null;
        tracked.status = "complete";
      }
    }
  }
}

/**
 * Handles system events for model info and compact boundaries.
 */
function handleSystemEvent(event: SDKMessage, state: StreamerState): void {
  // Check for compact_boundary events
  const maybeCompact = event as SDKCompactBoundaryMessage;
  if (
    maybeCompact.subtype === "compact_boundary" &&
    maybeCompact.compact_metadata
  ) {
    const preTokens = maybeCompact.compact_metadata.pre_tokens;
    const estimatedPostCompact = Math.round(preTokens * 0.3);
    log.info(
      `Compact boundary: pre_tokens=${preTokens}, ` +
        `trigger=${maybeCompact.compact_metadata.trigger}, ` +
        `resetting cumulative from ${state.cumulativeTokens} to ~${estimatedPostCompact}`
    );
    state.cumulativeTokens = estimatedPostCompact;
    return;
  }

  // Handle init events (sets active model)
  const systemEvent = event as SDKSystemMessage;
  if (systemEvent.subtype === "init" && systemEvent.model) {
    state.activeModel = systemEvent.model;
    log.info(`Active model: ${systemEvent.model}`);
  }
}

/**
 * Extracts text content from an assistant message.
 * The assistant event contains the complete BetaMessage with all content blocks.
 */
function extractAssistantContent(event: SDKAssistantMessage): string {
  const { message } = event;
  if (!message || !message.content) return "";

  const textParts: string[] = [];
  for (const block of message.content) {
    if (block.type === "text" && block.text) {
      textParts.push(block.text);
    }
  }
  return textParts.join("");
}
