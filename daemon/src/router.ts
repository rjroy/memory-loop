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
}
