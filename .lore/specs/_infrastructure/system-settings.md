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

### API (WebSocket)

| Message | Direction | Purpose |
|---------|-----------|---------|
| `get_extraction_prompt` | → Server | Load current prompt |
| `extraction_prompt_content` | ← Server | Return content + isOverride |
| `save_extraction_prompt` | → Server | Save custom prompt |
| `reset_extraction_prompt` | → Server | Delete override |
| `trigger_extraction` | → Server | Run extraction now |
| `extraction_status` | ← Server | Progress/completion updates |

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

### API (WebSocket)

| Message | Direction | Purpose |
|---------|-----------|---------|
| `get_card_generator_config` | → Server | Load requirements + config + usage |
| `card_generator_config_content` | ← Server | Return all settings |
| `save_card_generator_requirements` | → Server | Save custom requirements |
| `save_card_generator_config` | → Server | Save byte limit |
| `reset_card_generator_requirements` | → Server | Delete override |
| `trigger_card_generation` | → Server | Run generation now |
| `card_generation_status` | ← Server | Progress with filesProcessed, cardsCreated |

### Storage
- **Default requirements**: Built into code
- **Override requirements**: `~/.config/memory-loop/card-generator-requirements.md`
- **Config (byte limit)**: `~/.config/memory-loop/card-generator-config.json`

## Implementation

### Files Involved

| File | Role |
|------|------|
| `frontend/src/components/vault/SettingsDialog.tsx` | Dialog shell with tabs |
| `frontend/src/components/vault/MemoryEditor.tsx` | Memory tab content |
| `frontend/src/components/vault/ExtractionPromptEditor.tsx` | Extraction tab content |
| `frontend/src/components/vault/CardGeneratorEditor.tsx` | Card Generator tab content |
| `frontend/src/hooks/useMemory.ts` | REST client for memory |
| `backend/src/routes/memory.ts` | Memory REST endpoints |
| `backend/src/handlers/memory-handlers.ts` | Extraction WebSocket handlers |
| `backend/src/handlers/card-generator-handlers.ts` | Card Generator WebSocket handlers |

### Communication Pattern

| Tab | Protocol | Reason |
|-----|----------|--------|
| Memory Editor | REST | Simple CRUD, no streaming |
| Extraction Prompt | WebSocket | Manual trigger streams status updates |
| Card Generator | WebSocket | Manual trigger streams progress |

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
   - Sends get_extraction_prompt via WebSocket
   - Shows current prompt with Custom/Default badge
   - Can edit, save, reset, or trigger manual run
6. User clicks "Card Generator" tab
   - Sends get_card_generator_config via WebSocket
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
- VaultSelect routes WebSocket messages to correct editor via message type filtering
