/**
 * Pair Writing Mode Handlers
 *
 * Handles:
 * - Quick Actions (Tighten, Embellish, Correct, Polish) via existing discussion session
 * - Advisory Actions (Validate, Critique, Compare) via existing discussion session
 *
 * Both action types use the existing discussion session (same as Think tab) so that:
 * - Quick Actions appear in the conversation history with tool usage
 * - Advisory Actions appear as regular conversation turns
 * - Full session context is maintained for coherent assistance
 *
 * Note: pair_chat_request has been removed - users can type directly in Discussion.
 *
 * See: .sdd/plans/memory-loop/2026-01-20-pair-writing-mode-plan.md (TD-2)
 */

import { join } from "node:path";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  QuickActionRequestMessage,
  AdvisoryActionRequestMessage,
} from "@memory-loop/shared";
import { createLogger } from "../logger.js";
import { validatePath } from "../file-browser.js";
import {
  resumeSession as defaultResumeSession,
  appendMessage as defaultAppendMessage,
} from "../session-manager.js";
import {
  buildQuickActionPrompt,
  buildAdvisoryActionPrompt,
  isQuickActionType,
  isAdvisoryActionType,
  type QuickActionContext,
  type AdvisoryActionContext,
} from "../pair-writing-prompts.js";
import { type HandlerContext, requireVault, generateMessageId } from "./types.js";

const log = createLogger("PairWriting");

/**
 * Type for the SDK query function, to enable dependency injection for testing.
 */
export type QueryFunction = typeof query;

/**
 * Dependencies for pair writing handlers (injectable for testing).
 */
export interface PairWritingDependencies {
  queryFn?: QueryFunction;
  resumeSession?: typeof defaultResumeSession;
  appendMessage?: typeof defaultAppendMessage;
}

/**
 * SDK options for Quick Action sessions (when no existing session).
 *
 * Quick Actions are task-scoped: Claude reads the file, makes an edit, confirms.
 * - Read and Edit tools available (scoped to vault via cwd)
 * - acceptEdits: Allow file modifications without user prompts
 * - maxTurns: Limit to prevent runaway sessions (typical flow is 3-5 turns)
 * - Budget capped at $0.50 for single edits
 */
const QUICK_ACTION_OPTIONS: Partial<Options> = {
  allowedTools: ["Read", "Edit"],
  permissionMode: "acceptEdits",
  maxTurns: 10,
  maxBudgetUsd: 0.5,
  includePartialMessages: true,
};

/**
 * Formats a Quick Action as a user-visible message.
 * This appears in the Discussion conversation.
 */
function formatQuickActionUserMessage(
  action: string,
  selection: string
): string {
  const actionDisplay = action.charAt(0).toUpperCase() + action.slice(1);
  const truncatedSelection = selection.length > 100
    ? selection.slice(0, 100) + "..."
    : selection;
  return `[${actionDisplay}] "${truncatedSelection}"`;
}

/**
 * Formats an Advisory Action as a user-visible message.
 * This appears in the Discussion conversation.
 */
function formatAdvisoryActionUserMessage(
  action: string,
  selection: string
): string {
  const actionDisplay = action.charAt(0).toUpperCase() + action.slice(1);
  const truncatedSelection = selection.length > 100
    ? selection.slice(0, 100) + "..."
    : selection;
  return `[${actionDisplay}] "${truncatedSelection}"`;
}

/**
 * Handles a Quick Action request (Tighten, Embellish, Correct, Polish).
 *
 * Flow:
 * 1. Validates file path is within vault
 * 2. Builds the prompt using action-specific template
 * 3. If existing session: resumes it; otherwise creates task-scoped session
 * 4. Streams all events to frontend (tool_start, tool_end, response_chunk, response_end)
 * 5. Appends user message and response to session history
 *
 * When an existing discussion session is available, Quick Actions use it to maintain
 * full context. The Edit tool usage appears in the conversation history.
 *
 * @param ctx - Handler context with connection state and send functions
 * @param request - Quick action request message
 * @param deps - Optional dependencies for testing
 */
export async function handleQuickAction(
  ctx: HandlerContext,
  request: QuickActionRequestMessage,
  deps: PairWritingDependencies = {}
): Promise<void> {
  // Require vault to be selected
  if (!requireVault(ctx)) {
    return;
  }

  const vault = ctx.state.currentVault;
  const sessionId = ctx.state.currentSessionId;
  const queryFn = deps.queryFn ?? query;
  const resumeSession = deps.resumeSession ?? defaultResumeSession;
  const appendMessage = deps.appendMessage ?? defaultAppendMessage;

  log.info(`Quick action "${request.action}" on ${request.filePath}`);
  if (sessionId) {
    log.info(`Using existing session: ${sessionId.slice(0, 8)}...`);
  } else {
    log.info("No existing session, will create task-scoped session");
  }

  // Validate action type (fast, no I/O)
  if (!isQuickActionType(request.action)) {
    ctx.sendError("VALIDATION_ERROR", `Invalid action type: ${String(request.action)}`);
    return;
  }

  // Validate selection (fast, no I/O)
  if (!request.selection || request.selection.length === 0) {
    ctx.sendError("VALIDATION_ERROR", "Selection is required");
    return;
  }

  // Validate file path is within vault content root (requires filesystem)
  try {
    const absolutePath = join(vault.contentRoot, request.filePath);
    await validatePath(vault.contentRoot, request.filePath);
    log.debug(`Validated path: ${absolutePath}`);
  } catch (error) {
    log.warn(`Path validation failed: ${request.filePath}`, error);
    ctx.sendError(
      "PATH_TRAVERSAL",
      `File path "${request.filePath}" is not within vault`
    );
    return;
  }

  // Build the prompt context
  const promptContext: QuickActionContext = {
    filePath: request.filePath,
    selectedText: request.selection,
    contextBefore: request.contextBefore,
    contextAfter: request.contextAfter,
    startLine: request.selectionStartLine,
    endLine: request.selectionEndLine,
    totalLines: request.totalLines,
  };

  // Build the action-specific prompt
  const prompt = buildQuickActionPrompt(request.action, promptContext);
  log.debug(`Built prompt (${prompt.length} chars)`);

  // Generate message ID for streaming
  const messageId = generateMessageId();
  const startTime = Date.now();

  // Add user message to session history (so it appears in Discussion)
  const userMessage = formatQuickActionUserMessage(request.action, request.selection);
  if (sessionId) {
    try {
      await appendMessage(vault.path, sessionId, {
        id: generateMessageId(),
        role: "user",
        content: userMessage,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      log.warn("Failed to append user message to session", error);
    }
  }

  // Send response_start
  ctx.send({ type: "response_start", messageId });

  try {
    let queryResult: AsyncGenerator<SDKMessage, void>;

    if (sessionId) {
      // Resume existing discussion session with Edit tool enabled
      log.info("Resuming existing session for Quick Action...");
      const sessionResult = await resumeSession(
        vault.path,
        sessionId,
        prompt,
        {
          ...QUICK_ACTION_OPTIONS,
          cwd: vault.contentRoot,
          settingSources: ["local", "project", "user"],
        }
      );
      queryResult = sessionResult.events;
    } else {
      // Create task-scoped Claude session (fallback if no session)
      log.info("Creating task-scoped Quick Action session...");
      queryResult = queryFn({
        prompt,
        options: {
          ...QUICK_ACTION_OPTIONS,
          cwd: vault.contentRoot,
          settingSources: ["local", "project", "user"],
        },
      });
    }

    // Stream events to frontend
    const streamResult = await streamQuickActionEvents(ctx, messageId, queryResult);

    const durationMs = Date.now() - startTime;
    log.info(`Quick action completed in ${durationMs}ms`);

    // Append assistant message to session history
    if (sessionId && streamResult.content.length > 0) {
      try {
        await appendMessage(vault.path, sessionId, {
          id: messageId,
          role: "assistant",
          content: streamResult.content,
          timestamp: new Date().toISOString(),
          toolInvocations: streamResult.toolInvocations.length > 0 ? streamResult.toolInvocations : undefined,
          contextUsage: streamResult.contextUsage,
          durationMs,
        });
      } catch (error) {
        log.warn("Failed to append assistant message to session", error);
      }
    }

    // Send response_end
    ctx.send({
      type: "response_end",
      messageId,
      durationMs,
      contextUsage: streamResult.contextUsage,
    });
  } catch (error) {
    log.error("Quick action failed", error);
    const message = error instanceof Error ? error.message : "Quick action failed";
    ctx.sendError("SDK_ERROR", message);
  }
}

/**
 * Result from streaming Quick Action events.
 */
interface StreamingResult {
  content: string;
  toolInvocations: Array<{
    toolUseId: string;
    toolName: string;
    status: "running" | "complete";
    input?: unknown;
    output?: unknown;
  }>;
  contextUsage?: number;
}

/**
 * Streams SDK events for a Quick Action to the frontend.
 *
 * Maps SDK events to WebSocket protocol messages:
 * - content_block_start (tool_use) -> tool_start
 * - content_block_stop (tool_use) -> tool_end
 * - text_delta -> response_chunk
 *
 * @param ctx - Handler context
 * @param messageId - Unique message ID for this response
 * @param queryResult - The SDK query generator
 * @returns Accumulated content, tool invocations, and context usage
 */
async function streamQuickActionEvents(
  ctx: HandlerContext,
  messageId: string,
  queryResult: AsyncGenerator<SDKMessage, void>
): Promise<StreamingResult> {
  const responseChunks: string[] = [];
  const toolsMap = new Map<string, { name: string; inputChunks: string[]; input?: unknown; output?: unknown }>();
  const contentBlocks = new Map<number, { type: string; toolUseId?: string; toolName?: string; inputChunks?: string[] }>();
  let contextUsage: number | undefined;

  for await (const event of queryResult) {
    log.debug(`SDK event: ${event.type}`);

    switch (event.type) {
      case "stream_event": {
        const streamEvent = event.event;

        // Handle content block start (text or tool_use)
        if (streamEvent.type === "content_block_start") {
          const { index, content_block: contentBlock } = streamEvent;

          if (contentBlock.type === "tool_use") {
            const { id: toolUseId, name: toolName } = contentBlock;
            log.info(`Tool started: ${toolName} (${toolUseId})`);

            contentBlocks.set(index, {
              type: "tool_use",
              toolUseId,
              toolName,
              inputChunks: [],
            });

            toolsMap.set(toolUseId, { name: toolName, inputChunks: [] });

            ctx.send({
              type: "tool_start",
              toolName,
              toolUseId,
            });
          } else if (contentBlock.type === "text") {
            contentBlocks.set(index, { type: "text" });
          }
        }

        // Handle content block delta (text or tool input)
        if (streamEvent.type === "content_block_delta") {
          const { index, delta } = streamEvent;

          if (delta.type === "text_delta") {
            const { text } = delta;
            ctx.send({
              type: "response_chunk",
              messageId,
              content: text,
            });
            responseChunks.push(text);
          }

          if (delta.type === "input_json_delta") {
            const { partial_json: partialJson } = delta;
            const block = contentBlocks.get(index);
            if (partialJson && block?.type === "tool_use" && block.inputChunks) {
              block.inputChunks.push(partialJson);
            }
          }
        }

        // Handle content block stop
        if (streamEvent.type === "content_block_stop") {
          const { index } = streamEvent;
          const block = contentBlocks.get(index);

          if (block?.type === "tool_use" && block.toolUseId && block.inputChunks) {
            const jsonStr = block.inputChunks.join("");
            try {
              const input: unknown = jsonStr ? JSON.parse(jsonStr) : {};
              ctx.send({
                type: "tool_input",
                toolUseId: block.toolUseId,
                input,
              });
              // Store input for session history
              const tool = toolsMap.get(block.toolUseId);
              if (tool) {
                tool.input = input;
              }
            } catch {
              log.warn(`Failed to parse tool input JSON for ${block.toolUseId}`);
            }
          }

          contentBlocks.delete(index);
        }
        break;
      }

      case "result": {
        // Extract tool results and context usage
        const { usage, modelUsage } = event;

        if (usage && modelUsage) {
          const inputTokens = usage.input_tokens ?? 0;
          const outputTokens = usage.output_tokens ?? 0;
          const totalTokens = inputTokens + outputTokens;

          const modelNames = Object.keys(modelUsage);
          const modelName = modelNames[0];
          if (modelName && modelUsage[modelName]) {
            const contextWindow = modelUsage[modelName].contextWindow;
            if (contextWindow && contextWindow > 0) {
              contextUsage = Math.round((100 * totalTokens) / contextWindow);
              contextUsage = Math.max(0, Math.min(100, contextUsage));
            }
          }
        }

        // Extract tool results from result content
        const rawEvent = event as unknown as { result?: { content?: unknown[] } };
        const result = rawEvent.result;
        if (result && Array.isArray(result.content)) {
          for (const block of result.content) {
            if (typeof block !== "object" || block === null || !("type" in block)) continue;
            const typedBlock = block as { type: string; tool_use_id?: string; content?: unknown };

            if (typedBlock.type === "tool_result" && typedBlock.tool_use_id) {
              log.info(`Tool completed: ${typedBlock.tool_use_id}`);
              ctx.send({
                type: "tool_end",
                toolUseId: typedBlock.tool_use_id,
                output: typedBlock.content ?? null,
              });
              // Store output for session history
              const tool = toolsMap.get(typedBlock.tool_use_id);
              if (tool) {
                tool.output = typedBlock.content ?? null;
              }
            }
          }
        }
        break;
      }

      case "user": {
        // Handle tool results from user events
        const { message } = event;
        const content = message.content;
        if (!Array.isArray(content)) break;

        for (const block of content) {
          if (typeof block !== "object" || block === null || !("type" in block)) continue;

          if (block.type === "tool_result" && "tool_use_id" in block) {
            const toolUseId = block.tool_use_id;
            const output = "content" in block ? block.content : null;

            log.info(`Tool completed (from user event): ${toolUseId}`);
            ctx.send({
              type: "tool_end",
              toolUseId,
              output: output ?? null,
            });
            // Store output for session history
            const tool = toolsMap.get(toolUseId);
            if (tool) {
              tool.output = output ?? null;
            }
          }
        }
        break;
      }
    }
  }

  // Convert toolsMap to array for storage
  const toolInvocations = Array.from(toolsMap.entries()).map(([toolUseId, tool]) => ({
    toolUseId,
    toolName: tool.name,
    status: "complete" as const,
    input: tool.input,
    output: tool.output,
  }));

  return {
    content: responseChunks.join(""),
    toolInvocations,
    contextUsage,
  };
}

// =============================================================================
// Advisory Action Handler (Validate, Critique, Compare)
// =============================================================================

/**
 * SDK options for Advisory Action sessions (when no existing session).
 *
 * Advisory Actions are read-only: Claude analyzes text and provides feedback.
 * - No tools needed (pure text analysis)
 * - maxTurns: 1 (single response expected)
 * - Budget capped at $0.25 for advisory feedback
 */
const ADVISORY_ACTION_OPTIONS: Partial<Options> = {
  allowedTools: [],
  maxTurns: 1,
  maxBudgetUsd: 0.25,
  includePartialMessages: true,
};

/**
 * Handles an Advisory Action request (Validate, Critique, Compare).
 *
 * Advisory actions stream text responses to the Discussion conversation.
 * When an existing session is available, uses resumeSession to maintain context.
 * The user reads the feedback and manually applies changes.
 *
 * @param ctx - Handler context with connection state and send functions
 * @param request - Advisory action request message
 * @param deps - Optional dependencies for testing
 */
export async function handleAdvisoryAction(
  ctx: HandlerContext,
  request: AdvisoryActionRequestMessage,
  deps: PairWritingDependencies = {}
): Promise<void> {
  // Require vault to be selected
  if (!requireVault(ctx)) {
    return;
  }

  const vault = ctx.state.currentVault;
  const sessionId = ctx.state.currentSessionId;
  const queryFn = deps.queryFn ?? query;
  const resumeSession = deps.resumeSession ?? defaultResumeSession;
  const appendMessage = deps.appendMessage ?? defaultAppendMessage;

  log.info(`Advisory action "${request.action}" on ${request.filePath}`);
  if (sessionId) {
    log.info(`Using existing session: ${sessionId.slice(0, 8)}...`);
  } else {
    log.info("No existing session, will create task-scoped session");
  }

  // Validate action type
  if (!isAdvisoryActionType(request.action)) {
    ctx.sendError("VALIDATION_ERROR", `Invalid advisory action type: ${String(request.action)}`);
    return;
  }

  // Validate selection
  if (!request.selection || request.selection.length === 0) {
    ctx.sendError("VALIDATION_ERROR", "Selection is required");
    return;
  }

  // Validate file path is within vault
  try {
    await validatePath(vault.contentRoot, request.filePath);
  } catch (error) {
    log.warn(`Path validation failed: ${request.filePath}`, error);
    ctx.sendError("PATH_TRAVERSAL", `File path "${request.filePath}" is not within vault`);
    return;
  }

  // Build the prompt context
  const promptContext: AdvisoryActionContext = {
    filePath: request.filePath,
    selectedText: request.selection,
    contextBefore: request.contextBefore,
    contextAfter: request.contextAfter,
    startLine: request.selectionStartLine,
    endLine: request.selectionEndLine,
    totalLines: request.totalLines,
    snapshotSelection: request.snapshotSelection,
  };

  // Build the action-specific prompt
  const prompt = buildAdvisoryActionPrompt(request.action, promptContext);
  log.debug(`Built advisory prompt (${prompt.length} chars)`);

  // Generate message ID and stream response
  const messageId = generateMessageId();
  const startTime = Date.now();

  // Add user message to session history (so it appears in Discussion)
  const userMessage = formatAdvisoryActionUserMessage(request.action, request.selection);
  if (sessionId) {
    try {
      await appendMessage(vault.path, sessionId, {
        id: generateMessageId(),
        role: "user",
        content: userMessage,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      log.warn("Failed to append user message to session", error);
    }
  }

  ctx.send({ type: "response_start", messageId });

  try {
    let queryResult: AsyncGenerator<SDKMessage, void>;

    if (sessionId) {
      // Resume existing discussion session
      log.info("Resuming existing session for Advisory Action...");
      const sessionResult = await resumeSession(
        vault.path,
        sessionId,
        prompt,
        {
          ...ADVISORY_ACTION_OPTIONS,
          cwd: vault.contentRoot,
          settingSources: ["local", "project", "user"],
        }
      );
      queryResult = sessionResult.events;
    } else {
      // Create task-scoped Claude session (fallback if no session)
      log.info("Creating task-scoped Advisory Action session...");
      queryResult = queryFn({
        prompt,
        options: {
          ...ADVISORY_ACTION_OPTIONS,
          cwd: vault.contentRoot,
          settingSources: ["local", "project", "user"],
        },
      });
    }

    // Stream events (advisory actions are text-only, no tools)
    const streamResult = await streamAdvisoryActionEvents(ctx, messageId, queryResult);

    const durationMs = Date.now() - startTime;
    log.info(`Advisory action completed in ${durationMs}ms`);

    // Append assistant message to session history
    if (sessionId && streamResult.content.length > 0) {
      try {
        await appendMessage(vault.path, sessionId, {
          id: messageId,
          role: "assistant",
          content: streamResult.content,
          timestamp: new Date().toISOString(),
          contextUsage: streamResult.contextUsage,
          durationMs,
        });
      } catch (error) {
        log.warn("Failed to append assistant message to session", error);
      }
    }

    ctx.send({
      type: "response_end",
      messageId,
      durationMs,
      contextUsage: streamResult.contextUsage,
    });
  } catch (error) {
    log.error("Advisory action failed", error);
    const message = error instanceof Error ? error.message : "Advisory action failed";
    ctx.sendError("SDK_ERROR", message);
  }
}

/**
 * Result from streaming Advisory Action events.
 */
interface AdvisoryStreamingResult {
  content: string;
  contextUsage?: number;
}

/**
 * Streams SDK events for an Advisory Action to the frontend.
 *
 * Advisory actions are text-only (no tools), so this is simpler than Quick Actions.
 *
 * @param ctx - Handler context
 * @param messageId - Unique message ID for this response
 * @param queryResult - The SDK query generator
 * @returns Accumulated content and context usage
 */
async function streamAdvisoryActionEvents(
  ctx: HandlerContext,
  messageId: string,
  queryResult: AsyncGenerator<SDKMessage, void>
): Promise<AdvisoryStreamingResult> {
  const responseChunks: string[] = [];
  let contextUsage: number | undefined;

  for await (const event of queryResult) {
    log.debug(`SDK event: ${event.type}`);

    switch (event.type) {
      case "stream_event": {
        const streamEvent = event.event;

        // Handle text deltas
        if (streamEvent.type === "content_block_delta") {
          const { delta } = streamEvent;

          if (delta.type === "text_delta") {
            const { text } = delta;
            ctx.send({
              type: "response_chunk",
              messageId,
              content: text,
            });
            responseChunks.push(text);
          }
        }
        break;
      }

      case "result": {
        // Extract context usage
        const { usage, modelUsage } = event;

        if (usage && modelUsage) {
          const inputTokens = usage.input_tokens ?? 0;
          const outputTokens = usage.output_tokens ?? 0;
          const totalTokens = inputTokens + outputTokens;

          const modelNames = Object.keys(modelUsage);
          const modelName = modelNames[0];
          if (modelName && modelUsage[modelName]) {
            const contextWindow = modelUsage[modelName].contextWindow;
            if (contextWindow && contextWindow > 0) {
              contextUsage = Math.round((100 * totalTokens) / contextWindow);
              contextUsage = Math.max(0, Math.min(100, contextUsage));
            }
          }
        }
        break;
      }
    }
  }

  return {
    content: responseChunks.join(""),
    contextUsage,
  };
}
