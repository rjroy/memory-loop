/**
 * Help / discovery root endpoint.
 *
 * Returns a structured description of available daemon API endpoints.
 * Each migration stage adds entries as new endpoints are created.
 */

import type { Context } from "hono";

export interface HelpResponse {
  name: string;
  version: string;
  description: string;
  endpoints: Array<{
    path: string;
    method: string;
    description: string;
  }>;
}

export function helpHandler(c: Context): Response {
  const body: HelpResponse = {
    name: "memory-loop",
    version: "0.0.0",
    description: "Memory Loop daemon API",
    endpoints: [
      // System
      { path: "/health", method: "GET", description: "Daemon health and status" },
      { path: "/help", method: "GET", description: "API discovery root" },

      // Vaults
      { path: "/vaults", method: "GET", description: "List all discovered vaults" },
      { path: "/vaults", method: "POST", description: "Create a new vault" },
      { path: "/vaults/:id", method: "GET", description: "Get a single vault by ID" },
      { path: "/vaults/:id/config", method: "GET", description: "Get vault configuration" },
      { path: "/vaults/:id/config", method: "PUT", description: "Update vault configuration" },
      { path: "/vaults/:id/config/pinned-assets", method: "PUT", description: "Update pinned assets" },
      { path: "/vaults/:id/config/slash-commands", method: "GET", description: "Get cached slash commands" },
      { path: "/vaults/:id/config/slash-commands", method: "PUT", description: "Save slash commands cache" },
      { path: "/vaults/help", method: "GET", description: "Vault API discovery" },

      // Files
      { path: "/vaults/:id/files", method: "GET", description: "List directory contents (query: path)" },
      { path: "/vaults/:id/files", method: "POST", description: "Create a new file (body: { path, name })" },
      { path: "/vaults/:id/files/*", method: "GET", description: "Read a file" },
      { path: "/vaults/:id/files/*", method: "PUT", description: "Write file content (body: { content })" },
      { path: "/vaults/:id/files/*", method: "PATCH", description: "Rename/move a file (body: { newName?, newPath? })" },
      { path: "/vaults/:id/files/*", method: "DELETE", description: "Delete a file" },

      // Directories
      { path: "/vaults/:id/directories", method: "POST", description: "Create a directory (body: { path, name })" },
      { path: "/vaults/:id/directories/*", method: "GET", description: "Get directory contents" },
      { path: "/vaults/:id/directories/*", method: "DELETE", description: "Delete a directory" },

      // Upload
      { path: "/vaults/:id/upload", method: "POST", description: "Upload a file (multipart)" },

      // Goals
      { path: "/vaults/:id/goals", method: "GET", description: "Read goals file" },

      // Capture
      { path: "/vaults/:id/capture", method: "POST", description: "Capture text (body: { text })" },
      { path: "/vaults/:id/recent-notes", method: "GET", description: "Get recent captured notes (query: limit)" },
      { path: "/vaults/:id/recent-activity", method: "GET", description: "Get recent activity" },

      // Meetings
      { path: "/vaults/:id/meetings", method: "POST", description: "Start a meeting (body: { title })" },
      { path: "/vaults/:id/meetings/current", method: "GET", description: "Get current meeting state" },
      { path: "/vaults/:id/meetings/current", method: "DELETE", description: "Stop current meeting" },

      // Tasks
      { path: "/vaults/:id/tasks", method: "GET", description: "List all tasks" },
      { path: "/vaults/:id/tasks", method: "PATCH", description: "Toggle a task (body: { filePath, lineNumber, newState? })" },

      // Daily Prep
      { path: "/vaults/:id/daily-prep/today", method: "GET", description: "Get daily prep status" },

      // Search
      { path: "/vaults/:id/search/files", method: "GET", description: "Fuzzy file name search (query: q, limit)" },
      { path: "/vaults/:id/search/content", method: "GET", description: "Full-text content search (query: q, limit)" },
      { path: "/vaults/:id/search/snippets", method: "GET", description: "Get context snippets (query: path, q)" },

      // Transcripts
      { path: "/vaults/:id/transcripts", method: "POST", description: "Initialize transcript (body: { sessionId, firstMessage })" },
      { path: "/vaults/:id/transcripts/append", method: "POST", description: "Append to transcript (body: { path, content })" },

      // Extraction
      { path: "/config/extraction/status", method: "GET", description: "Get extraction scheduler status" },
      { path: "/config/extraction/trigger", method: "POST", description: "Manually trigger extraction run" },

      // Memory
      { path: "/config/memory", method: "GET", description: "Read memory file content" },
      { path: "/config/memory", method: "PUT", description: "Update memory file (body: { content })" },

      // Extraction prompt
      { path: "/config/extraction-prompt", method: "GET", description: "Get extraction prompt" },
      { path: "/config/extraction-prompt", method: "PUT", description: "Set custom extraction prompt (body: { content })" },
      { path: "/config/extraction-prompt", method: "DELETE", description: "Reset extraction prompt to default" },

      // Cards (vault-scoped)
      { path: "/vaults/:id/cards/due", method: "GET", description: "Get due cards for review" },
      { path: "/vaults/:id/cards/:cardId", method: "GET", description: "Get card detail" },
      { path: "/vaults/:id/cards/:cardId/review", method: "POST", description: "Submit card review (body: { response })" },
      { path: "/vaults/:id/cards/:cardId/archive", method: "POST", description: "Archive a card" },

      // Card generator config
      { path: "/config/card-generator", method: "GET", description: "Get card generator configuration" },
      { path: "/config/card-generator", method: "PUT", description: "Update card generator config (body: { requirements })" },
      { path: "/config/card-generator/requirements", method: "DELETE", description: "Reset card generator requirements to default" },
      { path: "/config/card-generator/status", method: "GET", description: "Get card generation status" },
      { path: "/config/card-generator/trigger", method: "POST", description: "Manually trigger card generation" },

      // Setup and Inspiration
      { path: "/config/setup", method: "POST", description: "Run vault setup (body: { vaultId })" },
      { path: "/inspiration", method: "GET", description: "Get inspiration data (query: vaultId)" },

      // Session / Chat
      { path: "/session/chat/send", method: "POST", description: "Submit a message (body: { vaultId, vaultPath, prompt, sessionId? })" },
      { path: "/session/chat/stream", method: "GET", description: "SSE stream of session events (snapshot-first)" },
      { path: "/session/chat/abort", method: "POST", description: "Abort current streaming (body: { sessionId })" },
      { path: "/session/chat/permission", method: "POST", description: "Respond to tool permission (body: { sessionId, toolUseId, allowed })" },
      { path: "/session/chat/answer", method: "POST", description: "Respond to AskUserQuestion (body: { sessionId, toolUseId, answers })" },
      { path: "/session/clear", method: "POST", description: "Clear the current session" },
      { path: "/session/state", method: "GET", description: "Get current session state" },
      { path: "/session/lookup/:vaultId", method: "GET", description: "Look up existing session for a vault" },
    ],
  };

  return c.json(body);
}
