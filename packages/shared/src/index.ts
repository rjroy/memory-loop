/**
 * @memory-loop/shared
 *
 * Shared types, schemas, and utilities used by both the Next.js web app
 * and the daemon process.
 */

export * from "./schemas/index";

export { createLogger, setLogLevel } from "./logger";
export type { LogLevel } from "./logger";

// fileExists/directoryExists and resolveContentRoot are server-only.
// Import them from "@memory-loop/shared/server".
export type { VaultConfig } from "./vault-config";
export {
  CONFIG_FILE_NAME,
  SLASH_COMMANDS_FILE,
  DEFAULT_METADATA_PATH,
  DEFAULT_PROJECT_PATH,
  DEFAULT_AREA_PATH,
  DEFAULT_ATTACHMENT_PATH,
  DEFAULT_PROMPTS_PER_GENERATION,
  DEFAULT_MAX_POOL_SIZE,
  DEFAULT_QUOTES_PER_WEEK,
  DEFAULT_RECENT_CAPTURES,
  DEFAULT_RECENT_DISCUSSIONS,
  DEFAULT_ORDER,
  DEFAULT_CARDS_ENABLED,
  DEFAULT_VI_MODE,
  VALID_BADGE_COLORS,
  resolveMetadataPath,
  resolveGoalsPath,
  resolveContextualPromptsPath,
  resolveGeneralInspirationPath,
  resolveProjectPath,
  resolveAreaPath,
  resolveAttachmentPath,
  resolvePromptsPerGeneration,
  resolveMaxPoolSize,
  resolveQuotesPerWeek,
  resolveBadges,
  resolvePinnedAssets,
  resolveRecentCaptures,
  resolveRecentDiscussions,
  resolveOrder,
  resolveCardsEnabled,
  resolveViMode,
  slashCommandsEqual,
} from "./vault-config";

export {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  isImageFile,
  isVideoFile,
  isPdfFile,
  isMarkdownFile,
  isJsonFile,
  isTxtFile,
  isCsvFile,
  hasSupportedViewer,
  encodeAssetPath,
} from "./file-types";

export {
  formatDateForFilename,
  formatTimeForTimestamp,
  getDailyNoteFilename,
} from "./date-utils";

export type {
  SessionEvent,
  PendingPrompt,
  PromptResponse,
  SessionState,
  SessionSnapshot,
  SessionEventCallback,
} from "./session-types";
export { AlreadyProcessingError } from "./session-types";

export type {
  QuickActionType,
  AdvisoryActionType,
  QuickActionContext,
  PositionHint,
  AdvisoryActionContext,
} from "./pair-writing-prompts";
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
} from "./pair-writing-prompts";

export type { ExtractedTitle } from "./vault-paths";
export {
  DEFAULT_INBOX_PATH,
  GOALS_FILE_PATH,
  INBOX_PATTERNS,
  ATTACHMENT_PATTERNS,
  extractVaultName,
  titleToDirectoryName,
  getVaultInboxPath,
  getVaultMetadataPath,
  getTranscriptsDirectory,
} from "./vault-paths";
