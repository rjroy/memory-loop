/**
 * Pair Writing Prompt Templates
 *
 * Action-specific system prompts for:
 * - Quick Actions (Tighten, Embellish, Correct, Polish): Use Claude's Read/Edit tools
 * - Advisory Actions (Validate, Critique, Compare): Stream text feedback only
 * - Pair Chat: Freeform chat with optional selection context
 *
 * See: .sdd/plans/memory-loop/2026-01-20-pair-writing-mode-plan.md (TD-3)
 */

/**
 * Quick action types supported by the system.
 */
export type QuickActionType = "tighten" | "embellish" | "correct" | "polish";

/**
 * Advisory action types supported by the system.
 */
export type AdvisoryActionType = "validate" | "critique" | "compare";

/**
 * Context required to build a Quick Action prompt.
 */
export interface QuickActionContext {
  /** Absolute or relative file path being edited */
  filePath: string;
  /** The selected text to revise */
  selectedText: string;
  /** One paragraph before the selection (for tone matching) */
  contextBefore: string;
  /** One paragraph after the selection (for tone matching) */
  contextAfter: string;
  /** 1-indexed line number where selection starts */
  startLine: number;
  /** 1-indexed line number where selection ends */
  endLine: number;
  /** Total lines in the document */
  totalLines: number;
}

/**
 * Position hint indicating where the selection is located in the document.
 */
export type PositionHint = "beginning" | "middle" | "end";

/**
 * Configuration for a single Quick Action type.
 */
interface ActionConfig {
  /** Human-readable action name */
  name: string;
  /** Task description for the prompt */
  taskDescription: string;
  /** Rules specific to this action */
  rules: string[];
}

/**
 * Action configurations for all Quick Action types.
 */
const ACTION_CONFIGS: Record<QuickActionType, ActionConfig> = {
  tighten: {
    name: "Tighten",
    taskDescription: "Tighten the selected text",
    rules: [
      "Preserve the core meaning",
      "Remove filler words, redundant phrases, unnecessary qualifiers",
      "Maintain the author's voice and the document's tone",
    ],
  },
  embellish: {
    name: "Embellish",
    taskDescription: "Embellish the selected text",
    rules: [
      "Add vivid details, examples, or explanatory content",
      "Enhance clarity and engagement without changing the core meaning",
      "Match the existing style and tone of the document",
      "Avoid purple prose or excessive ornamentation",
    ],
  },
  correct: {
    name: "Correct",
    taskDescription: "Correct errors in the selected text",
    rules: [
      "Fix spelling, grammar, and punctuation errors",
      "Correct word usage and syntax issues",
      "Do not change the meaning, style, or voice",
      "Only fix clear errors; do not edit for style preferences",
    ],
  },
  polish: {
    name: "Polish",
    taskDescription: "Polish the selected text",
    rules: [
      "Improve sentence flow and readability",
      "Smooth awkward phrasing while preserving meaning",
      "Enhance word choices where clarity improves",
      "Maintain the author's voice and the document's tone",
    ],
  },
};

/**
 * Calculates a position hint based on where the selection is in the document.
 *
 * Position thresholds:
 * - Beginning: lines 1-20% of document
 * - Middle: lines 20-80% of document
 * - End: lines 80-100% of document
 *
 * @param startLine - 1-indexed line number where selection starts
 * @param endLine - 1-indexed line number where selection ends
 * @param totalLines - Total lines in the document
 * @returns Position hint string
 */
export function calculatePositionHint(
  startLine: number,
  endLine: number,
  totalLines: number
): PositionHint {
  // Use the midpoint of the selection for position calculation
  const midpoint = (startLine + endLine) / 2;

  // Handle edge cases
  if (totalLines <= 0) {
    return "middle";
  }

  // Calculate position as percentage of document
  const positionPercent = (midpoint / totalLines) * 100;

  if (positionPercent <= 20) {
    return "beginning";
  } else if (positionPercent >= 80) {
    return "end";
  } else {
    return "middle";
  }
}

/**
 * Formats the position hint as a human-readable phrase.
 *
 * @param hint - Position hint
 * @returns Human-readable position phrase
 */
export function formatPositionHint(hint: PositionHint): string {
  switch (hint) {
    case "beginning":
      return "near the beginning of";
    case "middle":
      return "in the middle of";
    case "end":
      return "near the end of";
  }
}

/**
 * Builds the system prompt for a Quick Action.
 *
 * The prompt structure follows TD-3 from the plan:
 * - Efficiency guidance ("be efficient", "keep responses brief")
 * - Task description with file path and line numbers
 * - Action-specific rules
 * - Selected text and surrounding context
 * - Workflow instructions (Read -> Edit -> Confirm)
 *
 * @param action - The Quick Action type
 * @param context - The context for the action (file, selection, etc.)
 * @returns Complete system prompt for Claude
 */
export function buildQuickActionPrompt(
  action: QuickActionType,
  context: QuickActionContext
): string {
  const config = ACTION_CONFIGS[action];
  const positionHint = calculatePositionHint(
    context.startLine,
    context.endLine,
    context.totalLines
  );
  const positionPhrase = formatPositionHint(positionHint);

  // Format rules as bullet points
  const formattedRules = config.rules.map((rule) => `- ${rule}`).join("\n");

  return `You are a writing assistant performing a Quick Action. Be efficient: read the file, make the edit, confirm briefly.

Task: ${config.taskDescription} ${positionPhrase} "${context.filePath}" (lines ${context.startLine}-${context.endLine}).

Rules for "${config.name}":
${formattedRules}

Selected text to revise:
${context.selectedText}

Surrounding context (for tone matching - do not modify this):
${context.contextBefore}
[SELECTION TO EDIT]
${context.contextAfter}

Workflow:
1. Read the file to see current state
2. Use Edit tool to replace the selection with ${action === "tighten" ? "tightened" : action === "embellish" ? "embellished" : action === "correct" ? "corrected" : "polished"} version
3. Confirm with one sentence (e.g., "Removed 3 filler phrases." or "Fixed 2 grammar errors.")

Keep responses brief. No lengthy explanations.`;
}

/**
 * Validates that a Quick Action context has required fields.
 *
 * @param context - The context to validate
 * @returns True if valid, throws error if invalid
 */
export function validateQuickActionContext(
  context: QuickActionContext
): boolean {
  if (!context.filePath) {
    throw new Error("filePath is required");
  }
  if (!context.selectedText) {
    throw new Error("selectedText is required");
  }
  if (context.startLine < 1) {
    throw new Error("startLine must be >= 1");
  }
  if (context.endLine < context.startLine) {
    throw new Error("endLine must be >= startLine");
  }
  if (context.totalLines < 1) {
    throw new Error("totalLines must be >= 1");
  }
  return true;
}

/**
 * Returns the action configuration for a given action type.
 * Useful for getting action metadata without building a full prompt.
 *
 * @param action - The Quick Action type
 * @returns Action configuration
 */
export function getActionConfig(action: QuickActionType): ActionConfig {
  return ACTION_CONFIGS[action];
}

/**
 * Checks if a string is a valid Quick Action type.
 *
 * @param action - String to check
 * @returns True if valid action type
 */
export function isQuickActionType(action: string): action is QuickActionType {
  return ["tighten", "embellish", "correct", "polish"].includes(action);
}

/**
 * Checks if a string is a valid Advisory Action type.
 *
 * @param action - String to check
 * @returns True if valid advisory action type
 */
export function isAdvisoryActionType(action: string): action is AdvisoryActionType {
  return ["validate", "critique", "compare"].includes(action);
}

// =============================================================================
// Advisory Action Prompts (Pair Writing Mode)
// =============================================================================

/**
 * Context required to build an Advisory Action prompt.
 */
export interface AdvisoryActionContext {
  /** Absolute or relative file path being edited */
  filePath: string;
  /** The selected text to analyze */
  selectedText: string;
  /** One paragraph before the selection (for context) */
  contextBefore: string;
  /** One paragraph after the selection (for context) */
  contextAfter: string;
  /** 1-indexed line number where selection starts */
  startLine: number;
  /** 1-indexed line number where selection ends */
  endLine: number;
  /** Total lines in the document */
  totalLines: number;
  /** For compare action: the corresponding text from the snapshot */
  snapshotSelection?: string;
}

/**
 * Configuration for Advisory Action types.
 */
interface AdvisoryActionConfig {
  /** Human-readable action name */
  name: string;
  /** Task description for the prompt */
  taskDescription: string;
  /** Detailed instructions for this action */
  instructions: string[];
}

/**
 * Advisory action configurations.
 */
const ADVISORY_ACTION_CONFIGS: Record<AdvisoryActionType, AdvisoryActionConfig> = {
  validate: {
    name: "Validate",
    taskDescription: "Fact-check the selected text",
    instructions: [
      "Identify any factual claims in the selection",
      "Assess the accuracy of each claim based on your knowledge",
      "Note claims you cannot verify (requires specialized knowledge, recent events, etc.)",
      "Be specific about what is correct, questionable, or incorrect",
      "Suggest corrections for any inaccuracies found",
    ],
  },
  critique: {
    name: "Critique",
    taskDescription: "Analyze the clarity, voice, and structure of the selected text",
    instructions: [
      "Evaluate clarity: Is the meaning immediately apparent?",
      "Assess voice: Is the tone consistent with the surrounding context?",
      "Check structure: Does the text flow logically?",
      "Identify specific weaknesses with concrete examples",
      "Suggest improvements without rewriting the text entirely",
      "Be constructive, not just critical",
    ],
  },
  compare: {
    name: "Compare",
    taskDescription: "Analyze how the text has changed from the snapshot",
    instructions: [
      "Describe what changed objectively (additions, deletions, rewording)",
      "Explain how the meaning or emphasis shifted (if at all)",
      "Note whether the changes improved, degraded, or maintained quality",
      "Be descriptive rather than judgmental",
    ],
  },
};

/**
 * Builds the prompt for a Validate action.
 *
 * @param context - The context for the action
 * @returns Complete prompt for Claude
 */
export function buildValidatePrompt(context: AdvisoryActionContext): string {
  const config = ADVISORY_ACTION_CONFIGS.validate;
  const positionHint = calculatePositionHint(
    context.startLine,
    context.endLine,
    context.totalLines
  );
  const positionPhrase = formatPositionHint(positionHint);
  const formattedInstructions = config.instructions.map((i) => `- ${i}`).join("\n");

  return `You are a writing assistant helping fact-check content.

Task: ${config.taskDescription} ${positionPhrase} "${context.filePath}".

Instructions:
${formattedInstructions}

Selected text to validate:
${context.selectedText}

Surrounding context (for reference):
${context.contextBefore}
[SELECTED TEXT]
${context.contextAfter}

Provide your analysis in a clear, organized format. Be specific and actionable.`;
}

/**
 * Builds the prompt for a Critique action.
 *
 * @param context - The context for the action
 * @returns Complete prompt for Claude
 */
export function buildCritiquePrompt(context: AdvisoryActionContext): string {
  const config = ADVISORY_ACTION_CONFIGS.critique;
  const positionHint = calculatePositionHint(
    context.startLine,
    context.endLine,
    context.totalLines
  );
  const positionPhrase = formatPositionHint(positionHint);
  const formattedInstructions = config.instructions.map((i) => `- ${i}`).join("\n");

  return `You are a writing assistant providing editorial feedback.

Task: ${config.taskDescription} ${positionPhrase} "${context.filePath}".

Instructions:
${formattedInstructions}

Selected text to critique:
${context.selectedText}

Surrounding context (for tone/style reference):
${context.contextBefore}
[SELECTED TEXT]
${context.contextAfter}

Provide your analysis in a clear, organized format. Focus on specific, actionable feedback.`;
}

/**
 * Builds the prompt for a Compare action.
 *
 * @param context - The context for the action (must include snapshotSelection)
 * @returns Complete prompt for Claude
 */
export function buildComparePrompt(context: AdvisoryActionContext): string {
  const config = ADVISORY_ACTION_CONFIGS.compare;
  const formattedInstructions = config.instructions.map((i) => `- ${i}`).join("\n");

  // Handle case where no snapshot selection was provided
  if (!context.snapshotSelection) {
    return `You are a writing assistant helping track document changes.

The user selected text to compare to a snapshot, but no corresponding text was found in the snapshot. This usually means the selection is new content that was added after the snapshot was taken.

Current selection (new content):
${context.selectedText}

Respond briefly noting that this appears to be new content not present in the snapshot.`;
  }

  return `You are a writing assistant helping track document changes.

Task: ${config.taskDescription}

Instructions:
${formattedInstructions}

BEFORE (from snapshot):
${context.snapshotSelection}

AFTER (current):
${context.selectedText}

Provide a clear analysis of:
1. What changed (specific additions, deletions, rewording)
2. How the meaning or emphasis shifted
3. Overall assessment of the changes`;
}

/**
 * Builds the appropriate advisory action prompt based on action type.
 *
 * @param action - The advisory action type
 * @param context - The context for the action
 * @returns Complete prompt for Claude
 */
export function buildAdvisoryActionPrompt(
  action: AdvisoryActionType,
  context: AdvisoryActionContext
): string {
  switch (action) {
    case "validate":
      return buildValidatePrompt(context);
    case "critique":
      return buildCritiquePrompt(context);
    case "compare":
      return buildComparePrompt(context);
  }
}

// =============================================================================
// Pair Chat Prompts
// =============================================================================

/**
 * Context for building a pair chat prompt.
 */
export interface PairChatContext {
  /** The user's message */
  userMessage: string;
  /** Path to the file being edited */
  filePath: string;
  /** Optional: selected text for context */
  selectedText?: string;
  /** Optional: paragraph before the selection */
  contextBefore?: string;
  /** Optional: paragraph after the selection */
  contextAfter?: string;
  /** Optional: line number where selection starts */
  startLine?: number;
  /** Optional: line number where selection ends */
  endLine?: number;
  /** Optional: total lines in document */
  totalLines?: number;
}

/**
 * Builds the prompt for a freeform pair chat message.
 *
 * If a selection is provided, includes it as context for the question.
 * Otherwise, just includes the file path for general context.
 *
 * @param context - The chat context
 * @returns Complete prompt for Claude
 */
export function buildPairChatPrompt(context: PairChatContext): string {
  // Base system context
  let prompt = `You are a writing assistant helping the user edit "${context.filePath}".

Respond helpfully and concisely. Focus on the user's specific question.`;

  // Add selection context if provided
  if (context.selectedText) {
    const positionInfo = context.startLine && context.endLine && context.totalLines
      ? ` (lines ${context.startLine}-${context.endLine})`
      : "";

    prompt += `

The user has selected the following text${positionInfo}:
${context.selectedText}`;

    if (context.contextBefore || context.contextAfter) {
      prompt += `

Surrounding context:
${context.contextBefore || "[Beginning of document]"}
[SELECTED TEXT]
${context.contextAfter || "[End of document]"}`;
    }
  }

  prompt += `

User's question:
${context.userMessage}`;

  return prompt;
}
