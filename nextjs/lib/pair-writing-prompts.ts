/**
 * Pair Writing Prompt Templates
 *
 * Re-exports from @memory-loop/shared for backward compatibility.
 */

export type {
  QuickActionType,
  AdvisoryActionType,
  QuickActionContext,
  PositionHint,
  AdvisoryActionContext,
} from "@memory-loop/shared";

export {
  calculatePositionHint,
  formatPositionHint,
  buildQuickActionPrompt,
  validateQuickActionContext,
  getActionConfig,
  isQuickActionType,
  isAdvisoryActionType,
  buildAdvisoryActionPrompt,
  buildValidatePrompt,
  buildCritiquePrompt,
  buildComparePrompt,
  buildDiscussPrompt,
} from "@memory-loop/shared";
