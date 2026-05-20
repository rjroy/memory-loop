/**
 * Pi-Agent Event Adapter
 *
 * Converts pi-agent AgentSessionEvent objects into the intermediate
 * SdkRunnerEvent schema. The output schema is unchanged from the
 * old SDK translator — only the input changes.
 *
 * Returns a callback to pass directly to session.subscribe(). Stateless:
 * pi-agent accumulates tool input internally so no block-index maps are needed.
 *
 * turn_end is NOT emitted from this adapter. The caller emits it when
 * session.prompt() resolves.
 */

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { createLogger } from "@memory-loop/shared";
import type { SdkRunnerEvent } from "./types";

const log = createLogger("EventTranslator");

/**
 * Returns the text payload of the first content block when it is a text block.
 * Returns null when content is missing, empty, or the first block is non-text.
 */
function extractFirstTextBlock(content: unknown): string | null {
  if (!Array.isArray(content) || content.length === 0) {
    return null;
  }
  const first = content[0] as { type?: unknown; text?: unknown } | null;
  if (first == null || first.type !== "text" || typeof first.text !== "string") {
    return null;
  }
  return first.text || null;
}

/**
 * Creates a pi-agent subscribe adapter.
 *
 * Returns a callback compatible with AgentSession.subscribe(). Each call
 * translates one AgentSessionEvent and forwards zero or more SdkRunnerEvents
 * to onEvent.
 *
 * @param onEvent - Receives translated SdkRunnerEvent values
 */
export function createPiEventAdapter(
  onEvent: (event: SdkRunnerEvent) => void
): (piEvent: AgentSessionEvent) => void {
  return (piEvent: AgentSessionEvent): void => {
    switch (piEvent.type) {
      case "message_update": {
        const assistantEvent = piEvent.assistantMessageEvent;
        if (assistantEvent.type === "text_delta") {
          onEvent({ type: "text_delta", text: assistantEvent.delta });
        }
        // Non-text_delta variants (thinking_delta, toolcall_delta, etc.) are ignored.
        break;
      }

      case "tool_execution_start":
        onEvent({
          type: "tool_use",
          name: piEvent.toolName,
          id: piEvent.toolCallId,
        });
        break;

      case "tool_execution_update": {
        // partialResult.content is a snapshot, not a delta.
        const contentBlocks = piEvent.partialResult?.content;
        const firstText = extractFirstTextBlock(contentBlocks);

        if (!firstText) {
          log.warn("tool_execution_update: no text content in partialResult, skipping event", {
            toolCallId: piEvent.toolCallId,
            hasPartialResult: piEvent.partialResult != null,
            contentLength: Array.isArray(contentBlocks) ? contentBlocks.length : 0,
          });
          break;
        }

        onEvent({
          type: "tool_result",
          name: "",
          output: firstText,
          toolUseId: piEvent.toolCallId,
        });
        break;
      }

      case "compaction_start":
        // Map to compact_boundary to maintain the existing SSE contract.
        // preTokens and trigger are not available from this event; use
        // sentinel values the frontend gracefully ignores.
        onEvent({ type: "compact_boundary", preTokens: 0, trigger: piEvent.reason });
        break;

      case "compaction_end":
        // No frontend consumer for this event. Silently ignore.
        break;

      // Base AgentEvent variants not mapped to SdkRunnerEvents:
      // agent_start, agent_end, turn_start, turn_end (emitted by caller on prompt() resolve),
      // message_start, message_end — informational only.
      // AgentSessionEvent-only variants: queue_update, session_info_changed,
      // thinking_level_changed, auto_retry_start, auto_retry_end — no consumer.

      default:
        // Unknown event types are silently ignored. New pi-agent versions
        // may add events we don't need to handle.
        break;
    }
  };
}

/**
 * Phrases that indicate the underlying session is no longer addressable.
 * Match is case-insensitive substring.
 */
const SESSION_EXPIRY_PHRASES: readonly string[] = [
  "session not found",
  "session expired",
  "session has expired",
  "could not find session",
  "no such session",
  "invalid session",
];

/**
 * Checks if an error message indicates a session expiry or not-found error.
 * Used in resume failure detection.
 */
export function isSessionExpiryError(message: string): boolean {
  const lower = message.toLowerCase();
  return SESSION_EXPIRY_PHRASES.some((phrase) => lower.includes(phrase));
}
