---
title: Configuration Infrastructure
date: 2026-01-28
status: current
tags: [config, vault-settings, badges, per-vault]
modules: [vault-config, config-editor-dialog]
---

# Infrastructure: Configuration

## What It Does

Configuration manages per-vault settings via `.memory-loop.json`. Each vault can have its own title, subtitle, AI model, inspiration settings, badges, and display order.

**Important**: This is different from System Settings (gear in header). Configuration is per-vault, System Settings is user-global.

## Entry Point

**Location**: Gear button on vault cards in the vault selection screen

```
┌─────────────────────────────────────────┐
│ Select Vault                     [⚙️]  │  ← System Settings (user-global)
├─────────────────────────────────────────┤
│ ┌─────────────┐  ┌─────────────┐       │
│ │ Work Vault  │  │ Personal    │       │
│ │         [⚙️]│  │         [⚙️]│       │  ← Configuration (per-vault)
│ └─────────────┘  └─────────────┘       │
└─────────────────────────────────────────┘
```

## Editable Settings

### Identity

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `title` | string | From CLAUDE.md H1 | Vault display name |
| `subtitle` | string | From CLAUDE.md | Description under title |
| `order` | int (≥1) | 999999 | Sort priority (lower first) |
| `badges` | Badge[] (≤5) | [] | Custom badge chips |

### AI Model

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `discussionModel` | "opus" \| "sonnet" \| "haiku" | "opus" | Model for conversations |

### Inspiration

| Field | Type | Range | Default | Purpose |
|-------|------|-------|---------|---------|
| `promptsPerGeneration` | int | 1-20 | 5 | Prompts per generation cycle |
| `maxPoolSize` | int | 10-200 | 50 | Max items before pruning |
| `quotesPerWeek` | int | 0-7 | 1 | Quotes generated per week |

### Display

| Field | Type | Range | Default | Purpose |
|-------|------|-------|---------|---------|
| `recentCaptures` | int | 1-20 | 5 | Captures shown on Ground |
| `recentDiscussions` | int | 1-20 | 5 | Discussions shown on Ground |

### Spaced Repetition

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `cardsEnabled` | boolean | true | Enable card discovery |

## Non-Editable Settings (Manual JSON Only)

These fields exist in `.memory-loop.json` but are not exposed in the UI:

| Field | Purpose | Example |
|-------|---------|---------|
| `contentRoot` | Subdirectory for content (Quartz-style) | `"content"` |
| `inboxPath` | Daily notes location | `"00_Inbox"` |
| `metadataPath` | Memory Loop data storage | `"06_Metadata/memory-loop"` |
| `projectPath` | Projects folder | `"01_Projects"` |
| `areaPath` | Areas folder | `"02_Areas"` |
| `attachmentPath` | Attachments folder | `"05_Attachments"` |
| `pinnedAssets` | Pinned files for context | `["README.md"]` |

## Badge System

Badges are colored chips displayed on vault cards.

**Constraints**:
- Maximum 5 badges per vault
- Text maximum 20 characters
- 8 colors: black, purple, red, cyan, orange, blue, green, yellow

**Format**:
```json
{
  "badges": [
    { "text": "Work", "color": "blue" },
    { "text": "Personal", "color": "green" }
  ]
}
```

## File Format

**Location**: `{vault}/.memory-loop.json`

```json
{
  "title": "Work Notes",
  "subtitle": "Daily journal and projects",
  "discussionModel": "sonnet",
  "promptsPerGeneration": 10,
  "maxPoolSize": 100,
  "quotesPerWeek": 3,
  "recentCaptures": 8,
  "recentDiscussions": 10,
  "badges": [
    { "text": "Work", "color": "blue" }
  ],
  "order": 1,
  "cardsEnabled": true
}
```

**Note**: File is not created if all values match defaults. This avoids cluttering vaults with redundant config.

## Implementation

### Files Involved

| File | Role |
|------|------|
| `nextjs/components/vault/ConfigEditorDialog.tsx` | Edit dialog UI |
| `nextjs/components/vault/VaultSelect.tsx` | Opens dialog, handles save |
| `backend/src/routes/config.ts` | REST endpoint |
| `backend/src/handlers/config-handlers.ts` | Update handler |
| `backend/src/vault-config.ts` | Load/save/defaults |
| `shared/src/types.ts` | Zod schemas |

### API

**PATCH /api/vaults/:vaultId/config**

Request (partial update):
```json
{
  "title": "New Title",
  "discussionModel": "haiku"
}
```

Response:
```json
{ "success": true }
```

Only submitted fields are updated. Existing values preserved.

### Validation

Zod schema enforces:
- `promptsPerGeneration`: int, 1-20
- `maxPoolSize`: int, 10-200
- `quotesPerWeek`: int, 0-7
- `recentCaptures`: int, 1-20
- `recentDiscussions`: int, 1-20
- `badges`: array max 5, text max 20 chars
- `order`: int, min 1
- `discussionModel`: enum ["opus", "sonnet", "haiku"]

Invalid values return 400 error with message displayed inline in dialog.

### Resolution During Discovery

Config values are resolved when vaults are discovered:

```
CLAUDE.md title    →  config.title override?  →  VaultInfo.name
CLAUDE.md subtitle →  config.subtitle override?  →  VaultInfo.subtitle
Default values     →  config field exists?    →  VaultInfo field
```

This means `VaultInfo` always has resolved values; the frontend doesn't need to handle defaults.

## Connected Features

| Feature | Relationship |
|---------|-------------|
| [Vault Selection](./vault-selection.md) | Dialog opens from vault card gear |
| [Inspiration](../inspiration.md) | promptsPerGeneration, maxPoolSize, quotesPerWeek |
| [Ground](../home-dashboard.md) | recentCaptures, recentDiscussions |
| [Spaced Repetition](../spaced-repetition.md) | cardsEnabled |
| [Think](../think.md) | discussionModel |

## Notes

- Title/subtitle from config override CLAUDE.md extraction
- Order uses 999999 as default (Infinity not JSON-serializable)
- Path fields have security validation (no traversal outside vault)
- Local state updates immediately after save (no refetch)
- Dialog shows "Unsaved changes" warning when closing with changes
