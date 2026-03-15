/**
 * Request router for the daemon API.
 *
 * Registers all routes on a Hono app instance.
 */

import type { Hono } from "hono";
import { healthHandler } from "./routes/health";
import { helpHandler } from "./routes/help";
import {
  listVaultsHandler,
  getVaultHandler,
  createVaultHandler,
  getVaultConfigHandler,
  updateVaultConfigHandler,
  updatePinnedAssetsHandler,
  getSlashCommandsHandler,
  updateSlashCommandsHandler,
  vaultsHelpHandler,
} from "./routes/vaults";
import {
  listFilesHandler,
  createFileHandler,
  readFileHandler,
  writeFileHandler,
  patchFileHandler,
  deleteFileHandler,
  createDirectoryHandler,
  getDirectoryContentsHandler,
  deleteDirectoryHandler,
  uploadFileHandler,
  getGoalsHandler,
} from "./routes/files";
import {
  captureHandler,
  recentNotesHandler,
  recentActivityHandler,
} from "./routes/capture";
import {
  startMeetingHandler,
  getCurrentMeetingHandler,
  stopMeetingHandler,
} from "./routes/meetings";
import {
  listTasksHandler,
  toggleTaskHandler,
} from "./routes/tasks";
import { dailyPrepTodayHandler } from "./routes/daily-prep";
import {
  searchFilesHandler,
  searchContentHandler,
  getSnippetsHandler,
} from "./routes/search";
import {
  initTranscriptHandler,
  appendTranscriptHandler,
} from "./routes/transcripts";
import {
  extractionStatusHandler,
  extractionTriggerHandler,
  memoryGetHandler,
  memoryPutHandler,
  extractionPromptGetHandler,
  extractionPromptPutHandler,
  extractionPromptDeleteHandler,
} from "./routes/extraction";
import {
  dueCardsHandler,
  cardDetailHandler,
  cardReviewHandler,
  cardArchiveHandler,
} from "./routes/cards";
import {
  cardGeneratorConfigGetHandler,
  cardGeneratorConfigPutHandler,
  cardGeneratorRequirementsDeleteHandler,
  cardGeneratorStatusHandler,
  cardGeneratorTriggerHandler,
} from "./routes/card-config";

export function registerRoutes(app: Hono, startTime: number): void {
  // Health and help
  app.get("/health", (c) => healthHandler(c, startTime));
  app.get("/help", (c) => helpHandler(c));

  // Vault routes (order matters: /vaults/help before /vaults/:id)
  app.get("/vaults", (c) => listVaultsHandler(c));
  app.post("/vaults", (c) => createVaultHandler(c));
  app.get("/vaults/help", (c) => vaultsHelpHandler(c));
  app.get("/vaults/:id", (c) => getVaultHandler(c));
  app.get("/vaults/:id/config", (c) => getVaultConfigHandler(c));
  app.put("/vaults/:id/config", (c) => updateVaultConfigHandler(c));
  app.put("/vaults/:id/config/pinned-assets", (c) => updatePinnedAssetsHandler(c));
  app.get("/vaults/:id/config/slash-commands", (c) => getSlashCommandsHandler(c));
  app.put("/vaults/:id/config/slash-commands", (c) => updateSlashCommandsHandler(c));

  // File routes (specific paths before catch-all)
  app.get("/vaults/:id/files", (c) => listFilesHandler(c));
  app.post("/vaults/:id/files", (c) => createFileHandler(c));
  app.get("/vaults/:id/files/*", (c) => readFileHandler(c));
  app.put("/vaults/:id/files/*", (c) => writeFileHandler(c));
  app.patch("/vaults/:id/files/*", (c) => patchFileHandler(c));
  app.delete("/vaults/:id/files/*", (c) => deleteFileHandler(c));

  // Directory routes
  app.post("/vaults/:id/directories", (c) => createDirectoryHandler(c));
  app.get("/vaults/:id/directories/*", (c) => getDirectoryContentsHandler(c));
  app.delete("/vaults/:id/directories/*", (c) => deleteDirectoryHandler(c));

  // Upload
  app.post("/vaults/:id/upload", (c) => uploadFileHandler(c));

  // Goals
  app.get("/vaults/:id/goals", (c) => getGoalsHandler(c));

  // Capture
  app.post("/vaults/:id/capture", (c) => captureHandler(c));
  app.get("/vaults/:id/recent-notes", (c) => recentNotesHandler(c));
  app.get("/vaults/:id/recent-activity", (c) => recentActivityHandler(c));

  // Meetings
  app.post("/vaults/:id/meetings", (c) => startMeetingHandler(c));
  app.get("/vaults/:id/meetings/current", (c) => getCurrentMeetingHandler(c));
  app.delete("/vaults/:id/meetings/current", (c) => stopMeetingHandler(c));

  // Tasks
  app.get("/vaults/:id/tasks", (c) => listTasksHandler(c));
  app.patch("/vaults/:id/tasks", (c) => toggleTaskHandler(c));

  // Daily prep
  app.get("/vaults/:id/daily-prep/today", (c) => dailyPrepTodayHandler(c));

  // Search
  app.get("/vaults/:id/search/files", (c) => searchFilesHandler(c));
  app.get("/vaults/:id/search/content", (c) => searchContentHandler(c));
  app.get("/vaults/:id/search/snippets", (c) => getSnippetsHandler(c));

  // Transcripts
  app.post("/vaults/:id/transcripts", (c) => initTranscriptHandler(c));
  app.post("/vaults/:id/transcripts/append", (c) => appendTranscriptHandler(c));

  // Extraction config
  app.get("/config/extraction/status", (c) => extractionStatusHandler(c));
  app.post("/config/extraction/trigger", (c) => extractionTriggerHandler(c));
  app.get("/config/memory", (c) => memoryGetHandler(c));
  app.put("/config/memory", (c) => memoryPutHandler(c));
  app.get("/config/extraction-prompt", (c) => extractionPromptGetHandler(c));
  app.put("/config/extraction-prompt", (c) => extractionPromptPutHandler(c));
  app.delete("/config/extraction-prompt", (c) => extractionPromptDeleteHandler(c));

  // Card routes (vault-scoped)
  app.get("/vaults/:id/cards/due", (c) => dueCardsHandler(c));
  app.get("/vaults/:id/cards/:cardId", (c) => cardDetailHandler(c));
  app.post("/vaults/:id/cards/:cardId/review", (c) => cardReviewHandler(c));
  app.post("/vaults/:id/cards/:cardId/archive", (c) => cardArchiveHandler(c));

  // Card generator config
  app.get("/config/card-generator", (c) => cardGeneratorConfigGetHandler(c));
  app.put("/config/card-generator", (c) => cardGeneratorConfigPutHandler(c));
  app.delete("/config/card-generator/requirements", (c) => cardGeneratorRequirementsDeleteHandler(c));
  app.get("/config/card-generator/status", (c) => cardGeneratorStatusHandler(c));
  app.post("/config/card-generator/trigger", (c) => cardGeneratorTriggerHandler(c));
}
