---
title: System Settings Infrastructure
date: 2026-01-28
status: current
tags: [settings, memory-editor, extraction-prompt, card-generator]
modules: [settings-dialog, memory-editor]
---

# Infrastructure: System Settings

## What It Does

System Settings is a global configuration dialog accessed from the vault selection screen. It manages user-wide settings that apply across all vaults:

- **Memory Editor**: Edit the global memory.md file (Claude's context)
- **Extraction Prompt**: Customize fact extraction behavior
- **Card Generator**: Configure flashcard generation

**Important**: This is different from ConfigEditorDialog (gear on vault cards), which edits per-vault `.memory-loop.json`.

## Entry Point

**Location**: Gear button in VaultSelect header (top-right of vault selection screen)

```
┌─────────────────────────────────────────┐
│ Select Vault                     [⚙️]  │  ← This gear opens System Settings
├─────────────────────────────────────────┤
│ ┌─────────────┐  ┌─────────────┐       │
│ │ Work Vault  │  │ Personal    │       │
│ │         [⚙️]│  │         [⚙️]│       │  ← These gears open ConfigEditorDialog
│ └─────────────┘  └─────────────┘       │
└─────────────────────────────────────────┘
```

## Tab 1: Memory Editor

### Purpose
Edit `~/.claude/rules/memory.md`, the file that provides context to Claude in all conversations.

### Features
- **50KB limit**: Hard limit enforced on save (auto-prunes if exceeded)
- **Size indicator**: Visual progress bar showing current/max bytes
- **"New" badge**: Shown if file doesn't exist yet

### API (REST)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/config/memory` | Load content, size, exists flag |
| `PUT /api/config/memory` | Save content (enforces 50KB limit) |

### Storage
`~/.claude/rules/memory.md`

## Tab 2: Extraction Prompt

### Purpose
Customize the prompt used by the nightly extraction pipeline to identify durable facts from transcripts.

### Features
- **Override badge**: Shows "Custom" or "Default"
- **Reset to Default**: Deletes override, reverts to built-in prompt
- **Run Extraction**: Manual trigger for testing

### API (REST)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/config/extraction-prompt` | Load current prompt + isOverride |
| PUT | `/api/config/extraction-prompt` | Save custom prompt |
| DELETE | `/api/config/extraction-prompt` | Delete override, restore default |
| POST | `/api/config/extraction-prompt/trigger` | Run extraction now |

### Storage
- **Default**: Built into code (`backend/src/prompts/durable-facts.md`)
- **Override**: `~/.config/memory-loop/durable-facts.md`

## Tab 3: Card Generator

### Purpose
Configure flashcard generation from vault notes.

### Features
- **Requirements prompt**: Instructions for Q&A extraction (supports override)
- **Weekly byte limit**: Slider from 100KB to 10MB (default 500KB)
- **Usage bar**: Shows bytes processed this week vs limit
- **Run Generator**: Manual trigger (disabled if weekly limit reached)

### API (REST)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/config/card-generator` | Load requirements + config + usage |
| PUT | `/api/config/card-generator` | Save requirements and/or byte limit |
| DELETE | `/api/config/card-generator/requirements` | Delete override, restore default |
| POST | `/api/config/card-generator/trigger` | Run generation now |
| GET | `/api/config/card-generator/status` | Check generation progress |

### Storage
- **Default requirements**: Built into code
- **Override requirements**: `~/.config/memory-loop/card-generator-requirements.md`
- **Config (byte limit)**: `~/.config/memory-loop/card-generator-config.json`

## Implementation

### Files Involved

| File | Role |
|------|------|
| `nextjs/components/vault/SettingsDialog.tsx` | Dialog shell with tabs |
| `nextjs/components/vault/MemoryEditor.tsx` | Memory tab content |
| `nextjs/components/vault/ExtractionPromptEditor.tsx` | Extraction tab content |
| `nextjs/components/vault/CardGeneratorEditor.tsx` | Card Generator tab content |
| `nextjs/hooks/useMemory.ts` | REST client for memory |
| `nextjs/app/api/config/memory/route.ts` | Memory REST endpoints |
| `nextjs/app/api/config/extraction-prompt/route.ts` | Extraction REST endpoints |
| `nextjs/app/api/config/card-generator/route.ts` | Card Generator REST endpoints |

### Communication Pattern

All three tabs use REST. Manual triggers (extraction, card generation) return results synchronously in the response rather than streaming progress.

### Override Pattern

Both Extraction Prompt and Card Generator use the same pattern:

1. **Load**: Check for override file → use if exists, else use default
2. **Save**: Write to override file location
3. **Reset**: Delete override file → next load returns default
4. **Badge**: UI shows "Custom" or "Default" based on `isOverride` flag

## User Flow

```
1. User on vault selection screen
2. Clicks gear button in header
3. SettingsDialog opens (portal to body)
4. Default tab: Memory Editor
   - Loads ~/.claude/rules/memory.md via REST
   - User edits content
   - Clicks Save → PUT to server
5. User clicks "Extraction Prompt" tab
   - Fetches prompt via GET /api/config/extraction-prompt
   - Shows current prompt with Custom/Default badge
   - Can edit, save, reset, or trigger manual run
6. User clicks "Card Generator" tab
   - Fetches config via GET /api/config/card-generator
   - Shows requirements + byte limit slider + usage bar
   - Can edit requirements, adjust limit, or trigger manual generation
7. Clicks X or outside dialog to close
```

## Connected Features

| Feature | Relationship |
|---------|-------------|
| [Vault Selection](./vault-selection.md) | Dialog opens from VaultSelect header |
| [Extraction](./extraction.md) | Prompt tab configures extraction pipeline |
| [Spaced Repetition](../spaced-repetition.md) | Card Generator tab configures card creation |

## Notes

- All settings are user-global, stored in home directory
- Memory.md is read by Claude at conversation start (context injection)
- Manual triggers are for testing; normal operation is scheduled (3am extraction, 4am cards)
- Status updates auto-clear after 5 seconds on success
- Each editor tab manages its own REST calls independently
