/**
 * Pair Writing Mode Handlers
 *
 * Handles Quick Actions (Tighten, Embellish, Correct, Polish) via Claude tool use.
 * Claude reads the file and uses the Edit tool to make changes directly.
 *
 * See: .sdd/plans/memory-loop/2026-01-20-pair-writing-mode-plan.md (TD-2)
 */

import { join } from "node:path";
import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { QuickActionRequestMessage } from "@memory-loop/shared";
import { createLogger } from "../logger.js";
import { validatePath } from "../file-browser.js";
import {
  buildQuickActionPrompt,
  isQuickActionType,
  type QuickActionContext,
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
}

/**
 * SDK options for Quick Action sessions.
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
 * Handles a Quick Action request (Tighten, Embellish, Correct, Polish).
 *
 * Flow:
 * 1. Validates file path is within vault
 * 2. Builds the prompt using action-specific template
 * 3. Creates a Claude session with Read/Edit tools
 * 4. Streams all events to frontend (tool_start, tool_end, response_chunk, response_end)
 * 5. Session terminates after Claude confirms completion
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
  const queryFn = deps.queryFn ?? query;

  log.info(`Quick action "${request.action}" on ${request.filePath}`);

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

  // Send response_start
  ctx.send({ type: "response_start", messageId });

  try {
    // Create task-scoped Claude session
    log.info("Creating Quick Action session...");
    const queryResult = queryFn({
      prompt,
      options: {
        ...QUICK_ACTION_OPTIONS,
        cwd: vault.contentRoot,
        settingSources: ["local", "project", "user"],
      },
    });

    // Stream events to frontend
    const streamResult = await streamQuickActionEvents(ctx, messageId, queryResult);

    const durationMs = Date.now() - startTime;
    log.info(`Quick action completed in ${durationMs}ms`);

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
 * @returns Accumulated content and context usage
 */
async function streamQuickActionEvents(
  ctx: HandlerContext,
  messageId: string,
  queryResult: AsyncGenerator<SDKMessage, void>
): Promise<StreamingResult> {
  const responseChunks: string[] = [];
  const toolsMap = new Map<string, { name: string; inputChunks: string[] }>();
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
