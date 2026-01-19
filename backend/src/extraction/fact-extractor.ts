/**
 * Fact Extractor
 *
 * Calls Claude Agent SDK to analyze transcripts and extract durable facts.
 * Uses Haiku model for cost efficiency with a focused extraction prompt.
 *
 * Spec Requirements:
 * - REQ-F-6: Customizable extraction prompt
 * - REQ-F-7: LLM-based fact extraction
 *
 * Plan Reference:
 * - TD-2: Single query() call using Haiku, tools enabled
 * - TD-6: Default prompt in codebase, user override in ~/.config
 * - TD-12: Sandbox pattern (caller handles copy to/from VAULTS_DIR)
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "../logger.js";
import { fileExists } from "../vault-manager.js";
import type { DiscoveredTranscript } from "./transcript-reader.js";

const log = createLogger("fact-extractor");

// =============================================================================
// Constants
// =============================================================================

/**
 * Default durable facts prompt location (in codebase).
 */
function getDefaultPromptPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const extractionDir = dirname(currentFile);
  const backendSrc = dirname(extractionDir);
  return join(backendSrc, "prompts", "durable-facts.md");
}

/**
 * User override durable facts prompt location.
 * Per TD-6: ~/.config/memory-loop/durable-facts.md
 */
export const USER_PROMPT_PATH = join(
  homedir(),
  ".config",
  "memory-loop",
  "durable-facts.md"
);

/**
 * Retry delay for SDK errors (in milliseconds).
 */
const RETRY_DELAY_MS = 2000;

/**
 * SDK options for extraction.
 * Uses Haiku for cost efficiency (per TD-2).
 */
export const EXTRACTION_SDK_OPTIONS: Partial<Options> = {
  model: "haiku",
  allowedTools: [
    "Glob",
    "Grep",
    "Read",
    "Edit",
    "Write",
    "Task",
  ],
  permissionMode: "acceptEdits",
  maxBudgetUsd: 0.50, // Conservative budget for extraction
};

// =============================================================================
// Types
// =============================================================================

/**
 * Type for the SDK query function, to enable dependency injection for testing.
 */
export type QueryFunction = typeof query;

/**
 * Result of an extraction run.
 */
export interface ExtractionResult {
  /** Whether extraction completed successfully */
  success: boolean;
  /** Error message if extraction failed */
  error?: string;
  /** Number of transcripts processed */
  transcriptsProcessed: number;
  /** Whether this was a retry attempt */
  wasRetry: boolean;
}

/**
 * Info about the loaded extraction prompt.
 */
export interface PromptInfo {
  /** The prompt content */
  content: string;
  /** Whether this is a user override */
  isOverride: boolean;
  /** Path to the loaded prompt file */
  path: string;
}

// =============================================================================
// Prompt Loading
// =============================================================================

/**
 * Load the extraction prompt, preferring user override if it exists.
 *
 * @returns PromptInfo with content and metadata
 * @throws Error if neither default nor override can be read
 */
export async function loadExtractionPrompt(): Promise<PromptInfo> {
  log.info(`Checking for user override at: ${USER_PROMPT_PATH}`);

  // Check for user override first
  if (await fileExists(USER_PROMPT_PATH)) {
    try {
      const content = await readFile(USER_PROMPT_PATH, "utf-8");
      log.info(`Loaded user extraction prompt override from ${USER_PROMPT_PATH}`);
      return {
        content,
        isOverride: true,
        path: USER_PROMPT_PATH,
      };
    } catch (error) {
      log.warn(`Failed to read user prompt override: ${(error as Error).message}`);
      // Fall through to default
    }
  }

  // Load default prompt from codebase
  const defaultPath = getDefaultPromptPath();
  log.info(`No user override, loading default from: ${defaultPath}`);
  try {
    const content = await readFile(defaultPath, "utf-8");
    log.info(`Loaded default extraction prompt from ${defaultPath} (${content.length} chars)`);
    return {
      content,
      isOverride: false,
      path: defaultPath,
    };
  } catch (error) {
    log.error(`Failed to read default prompt at ${defaultPath}: ${(error as Error).message}`);
    throw new Error(`Failed to load extraction prompt: ${(error as Error).message}`);
  }
}

/**
 * Check if a user override prompt exists.
 */
export async function hasPromptOverride(): Promise<boolean> {
  return fileExists(USER_PROMPT_PATH);
}

// =============================================================================
// Extraction Prompt Construction
// =============================================================================

/**
 * Build the full extraction prompt including operational instructions.
 *
 * The basePrompt (durable-facts.md) defines WHAT to extract.
 * This function adds HOW to operate (tools, paths, process).
 *
 * @param basePrompt - The durable facts prompt (user-customizable)
 * @param transcripts - Transcripts to process
 * @param vaultsDir - Path to VAULTS_DIR for sandboxed operations
 * @returns Complete prompt for the SDK
 */
export function buildExtractionPrompt(
  basePrompt: string,
  transcripts: DiscoveredTranscript[],
  vaultsDir: string
): string {
  // Build transcript listing with absolute paths
  const transcriptList = transcripts
    .map((t) => `- \`${t.absolutePath}\``)
    .join("\n");

  const memoryPath = `${vaultsDir}/.memory-extraction/memory.md`;

  // Combine user-customizable categories with operational instructions
  return `# Memory Extraction

Extract durable facts about the user from conversation transcripts. Focus on information that remains true across sessions, not transient conversation details.

${basePrompt}

## What to Extract vs. Ignore

**Extract** (durable facts):
- "I've been programming for 15 years"
- "Our team uses trunk-based development"
- "I prefer TypeScript over JavaScript for larger projects"
- "Memory Loop is my side project for AI-augmented note-taking"

**Ignore** (transient details):
- "Can you fix this bug?"
- "I'm working on the login page today"
- "Thanks, that worked!"
- Session-specific troubleshooting steps
- Temporary workarounds

The test: would this fact be useful context in a conversation six months from now?

---

## Task

Extract durable facts from the transcripts listed below and update the memory file.

### Memory File

\`${memoryPath}\`

### Transcripts to Process (${transcripts.length})

${transcriptList}

### Process

1. Read the existing memory file
2. Read each transcript listed above
3. Extract durable facts according to the categories above
4. Merge new facts with existing content
5. Write the updated memory file

### Output Format

Use a hybrid narrative and list format. Write prose for interconnected information; use bullet lists only for truly independent items.

Good example:
\`\`\`markdown
## Preferences
Values concise communication over verbose explanations. Prefers seeing tradeoffs explicitly stated rather than having decisions made silently. When implementing:
- Start simple, add complexity when needed
- Avoid over-engineering
- Show your reasoning
\`\`\`

Bad example (over-bulleted):
\`\`\`markdown
## Preferences
- Prefers concise communication
- Wants to see tradeoffs
- Likes simple solutions
- Dislikes over-engineering
\`\`\`

### Merge Behavior

You are updating an existing memory file, not creating a new one.

- **Add** new facts that don't exist yet
- **Update** existing facts when new information contradicts or refines them (prefer newer information but preserve relevant context)
- **Preserve** existing facts that aren't contradicted (don't remove information just because current transcripts don't mention it)
- **Consolidate** redundant facts (if adding something already captured, update the existing entry instead)

### Security

**Never extract:**
- Passwords, API keys, tokens, or credentials
- Private keys or secrets
- Personal identification numbers
- Financial account details
- Any information that looks like it should be kept secret

If a transcript contains sensitive information, extract the context around it (what the user was working on) without the sensitive values themselves.
`;
}

// =============================================================================
// SDK Interaction
// =============================================================================

/**
 * Consume all events from an SDK query, waiting for completion.
 *
 * @param events - Async generator of SDK events
 * @returns Final result message content if available
 */
async function consumeQueryEvents(
  events: AsyncGenerator<SDKMessage, void>
): Promise<string | undefined> {
  let lastContent: string | undefined;

  for await (const event of events) {
    // Capture any result content
    if (event.type === "result" && "result" in event) {
      lastContent = String(event.result);
    }
  }

  return lastContent;
}

/**
 * Run a single extraction attempt.
 *
 * @param prompt - Full extraction prompt
 * @param vaultsDir - Working directory for SDK
 * @param queryFn - Query function (for testing)
 * @returns Result content or throws on error
 */
async function runExtractionAttempt(
  prompt: string,
  vaultsDir: string,
  queryFn: QueryFunction
): Promise<string | undefined> {
  log.info("Starting extraction query...");

  const queryResult = queryFn({
    prompt,
    options: {
      ...EXTRACTION_SDK_OPTIONS,
      cwd: vaultsDir,
    },
  });

  // Consume all events and wait for completion
  const result = await consumeQueryEvents(queryResult);

  log.info("Extraction query completed");
  return result;
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Main Extraction Function
// =============================================================================

/**
 * Extract facts from transcripts using Claude Agent SDK.
 *
 * This function:
 * 1. Loads the extraction prompt (user override or default)
 * 2. Builds the full prompt with transcript references
 * 3. Calls the SDK to run extraction
 * 4. Handles errors with single retry
 *
 * The caller is responsible for:
 * - Setting up the sandbox (copying memory.md to VAULTS_DIR)
 * - Cleaning up after extraction
 * - Copying results back to ~/.claude/rules/
 *
 * @param transcripts - Transcripts to process
 * @param vaultsDir - VAULTS_DIR path for sandboxed operations
 * @param queryFn - Optional query function for testing
 * @returns Extraction result with success status
 */
export async function extractFacts(
  transcripts: DiscoveredTranscript[],
  vaultsDir: string,
  queryFn: QueryFunction = query
): Promise<ExtractionResult> {
  if (transcripts.length === 0) {
    log.info("No transcripts to process");
    return {
      success: true,
      transcriptsProcessed: 0,
      wasRetry: false,
    };
  }

  log.info(`Extracting facts from ${transcripts.length} transcript(s)`);

  // Load extraction prompt
  let promptInfo: PromptInfo;
  try {
    promptInfo = await loadExtractionPrompt();
  } catch (error) {
    return {
      success: false,
      error: `Failed to load extraction prompt: ${(error as Error).message}`,
      transcriptsProcessed: 0,
      wasRetry: false,
    };
  }

  // Build full prompt
  const fullPrompt = buildExtractionPrompt(
    promptInfo.content,
    transcripts,
    vaultsDir
  );

  // First attempt
  try {
    await runExtractionAttempt(fullPrompt, vaultsDir, queryFn);
    return {
      success: true,
      transcriptsProcessed: transcripts.length,
      wasRetry: false,
    };
  } catch (error) {
    log.warn(`First extraction attempt failed: ${(error as Error).message}`);
  }

  // Retry with backoff
  log.info(`Retrying extraction after ${RETRY_DELAY_MS}ms...`);
  await sleep(RETRY_DELAY_MS);

  try {
    await runExtractionAttempt(fullPrompt, vaultsDir, queryFn);
    return {
      success: true,
      transcriptsProcessed: transcripts.length,
      wasRetry: true,
    };
  } catch (error) {
    const errorMessage = (error as Error).message;
    log.error(`Extraction failed after retry: ${errorMessage}`);
    return {
      success: false,
      error: errorMessage,
      transcriptsProcessed: 0,
      wasRetry: true,
    };
  }
}
