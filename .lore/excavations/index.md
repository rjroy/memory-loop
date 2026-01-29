# Excavation Index

**Codebase**: Memory Loop
**Started**: 2026-01-28

## Documented Features

| Feature | Spec | Excavated | Type | Connected To |
|---------|------|-----------|------|--------------|
| Vault Selection | [vault-selection.md](../specs/_infrastructure/vault-selection.md) | 2026-01-28 | Infrastructure | configuration, all tabs |
| Ground | [home-dashboard.md](../specs/home-dashboard.md) | 2026-01-28 | Tab (container) | spaced-repetition, inspiration, capture, think, recall |

## Discovered (Not Yet Documented)

### Infrastructure (excavate first)

| Feature | Entry Point | Files | Priority |
|---------|-------------|-------|----------|
| ~~Vault Selection~~ | ~~VaultSelect component, /api/vaults~~ | | ✓ Done |
| **Configuration** | .memory-loop.json, /api/config | `backend/src/vault-config.ts`, `backend/src/routes/config.ts` | High (shapes behavior) |
| **Extraction** | Post-session processing | `backend/src/extraction/` (fact-extractor, memory-writer, transcript-reader, extraction-manager) | High (core knowledge capture) |

### Sub-features (from Ground)

| Feature | Discovered From | Entry Point | Priority |
|---------|-----------------|-------------|----------|
| Spaced Repetition | ground | SpacedRepetitionWidget, /api/cards/* | High (complex state machine) |
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
