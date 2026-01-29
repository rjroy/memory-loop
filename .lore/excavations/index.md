# Excavation Index

**Codebase**: Memory Loop
**Started**: 2026-01-28

## Documented Features

| Feature | Spec | Excavated | Type | Connected To |
|---------|------|-----------|------|--------------|
| Vault Selection | [vault-selection.md](../specs/_infrastructure/vault-selection.md) | 2026-01-28 | Infrastructure | configuration, all tabs |
| Extraction | [extraction.md](../specs/_infrastructure/extraction.md) | 2026-01-28 | Infrastructure | system-settings, think |
| Ground | [home-dashboard.md](../specs/home-dashboard.md) | 2026-01-28 | Tab (container) | spaced-repetition, inspiration, capture, think, recall |
| Spaced Repetition | [spaced-repetition.md](../specs/spaced-repetition.md) | 2026-01-28 | Sub-feature | ground, system-settings, recall |

## Discovered (Not Yet Documented)

### Infrastructure (excavate first)

| Feature | Entry Point | Files | Priority |
|---------|-------------|-------|----------|
| ~~Vault Selection~~ | | | ✓ Done |
| ~~Extraction~~ | | | ✓ Done |
| **Configuration** | ConfigEditorDialog, .memory-loop.json | `backend/src/vault-config.ts`, `frontend/src/components/vault/ConfigEditorDialog.tsx` | Medium (per-vault settings) |
| **System Settings** | SettingsDialog (gear in header) | `frontend/src/components/vault/SettingsDialog.tsx` | Medium (memory editor, prompt, cards) |

### Sub-features (from Ground)

| Feature | Discovered From | Entry Point | Priority |
|---------|-----------------|-------------|----------|
| ~~Spaced Repetition~~ | | | ✓ Done |
| Inspiration | ground | InspirationCard, /api/inspiration | Medium |

### Top-Level Tabs

| Tab | Mode | Entry Point | Priority |
|-----|------|-------------|----------|
| **Capture** | note | ModeToggle, mode="note" | Medium |
| **Think** | discussion | ModeToggle, mode="discussion" | Medium |
| **Recall** | browse | ModeToggle, mode="browse" | Medium |

## Unexplored Entry Points

| Entry Point | Type | Notes |
|-------------|------|-------|
| WebSocket handlers | Backend | Real-time communication (chat streaming) |
| /api/sessions | REST | Discussion session management |
| Card Generator | Backend | Automatic card creation from vault content |

## Architecture Notes

### Navigation

Always-visible toolbar with four tabs:
```
[ Ground ][ Capture ][ Think ][ Recall ]
```

| Tab | Internal Mode | Feature |
|-----|---------------|---------|
| Ground | home | Dashboard with widgets |
| Capture | note | Quick notes to daily file |
| Think | discussion | AI chat with streaming |
| Recall | browse | File tree navigation |

### Communication Pattern
- Frontend ↔ Backend via WebSocket (chat streaming) and REST (data operations)
- Shared Zod schemas in `shared/src/protocol.ts` for type-safe messages
- Recent migration from WebSocket to REST for non-streaming operations

### Data Storage
- Vault files stored in user's Obsidian vault
- Session data in `vault.metadataPath` (default: `06_Metadata/memory-loop/`)
- Cards stored as individual markdown files
