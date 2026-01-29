# Infrastructure: Vault Selection

## What It Does

Vault Selection is the entry gate for the entire application. Users must select a vault before any other feature becomes available. It discovers vaults from the filesystem, validates they meet requirements, and establishes a session that persists across page refreshes.

## User Flow

```
App Start
    │
    ▼
┌─────────────────────────┐
│ Check for stored vault  │ (localStorage)
└───────────┬─────────────┘
            │
    ┌───────┴───────┐
    │               │
    ▼               ▼
 Found          Not Found
    │               │
    ▼               ▼
Auto-resume     Show vault list
    │               │
    └───────┬───────┘
            │
            ▼
    Select vault card
            │
            ▼
    Check for existing session
            │
    ┌───────┴───────┐
    │               │
    ▼               ▼
 Resume          Create new
 session         session
    │               │
    └───────┬───────┘
            │
            ▼
    App ready (show main interface)
```

## Capabilities

- **Browse vaults**: See all available vaults with badges, subtitles, and status
- **Select vault**: Click to activate and enter the app
- **Auto-resume**: Page refresh restores previous vault and session
- **Create vault**: Add new vault via dialog (creates directory + CLAUDE.md)
- **Configure vault**: Edit settings via gear icon (title, badges, paths, etc.)

## Entry Points

| Entry | Type | Handler |
|-------|------|---------|
| App mount (no vault) | Frontend | `App.tsx` → `AppShell` renders `VaultSelect` |
| GET /api/vaults | REST | `backend/src/server.ts:228` |
| GET /api/sessions/:vaultId | REST | `backend/src/server.ts:242` |
| select_vault | WebSocket | `backend/src/websocket-handler.ts` |
| resume_session | WebSocket | `backend/src/websocket-handler.ts` |
| create_vault | WebSocket | `backend/src/websocket-handler.ts` |

## Implementation

### Files Involved

| File | Role |
|------|------|
| `frontend/src/App.tsx` | AppShell decides VaultSelect vs MainContent |
| `frontend/src/components/vault/VaultSelect.tsx` | Main selection UI, auto-resume logic |
| `frontend/src/components/vault/AddVaultDialog.tsx` | New vault creation dialog |
| `frontend/src/components/vault/ConfigEditorDialog.tsx` | Settings editor |
| `frontend/src/contexts/SessionContext.tsx` | Stores selected vault, handles session_ready |
| `frontend/src/contexts/session/storage.ts` | localStorage persistence |
| `backend/src/vault-manager.ts` | Discovery, parsing, creation |
| `backend/src/vault-config.ts` | .memory-loop.json handling |
| `backend/src/session-manager.ts` | Session lifecycle |
| `backend/src/websocket-handler.ts` | Message routing |

### Vault Discovery

**Function**: `discoverVaults()` in `vault-manager.ts`

1. Read `VAULTS_DIR` env var (default: `{project}/vaults`)
2. List all non-hidden directories
3. For each, check for `CLAUDE.md` at root (required)
4. Parse metadata from CLAUDE.md and .memory-loop.json
5. Sort by `order` field, then alphabetically
6. Return `VaultInfo[]`

### Vault Requirements

A valid vault must have:
- A directory in `VAULTS_DIR`
- A `CLAUDE.md` file at root (non-negotiable)

Optional structure (auto-detected or configured):
```
my-vault/
├── CLAUDE.md              # REQUIRED - title from H1 heading
├── .memory-loop.json      # Optional config overrides
├── .memory-loop/
│   └── setup-complete     # Marker file for "configured" badge
├── 00_Inbox/              # Auto-detected inbox
└── 06_Metadata/
    └── memory-loop/
        └── goals.md       # Optional goals display
```

### Title Extraction

From CLAUDE.md first H1 heading:
```markdown
# Work Notes - Personal Projects
```
Becomes: `title: "Work Notes"`, `subtitle: "Personal Projects"`

Config file can override both.

### Session Flow

```
Client                          Server
   │                               │
   │  GET /api/sessions/:vaultId   │
   │──────────────────────────────>│
   │                               │
   │  { sessionId: "..." | null }  │
   │<──────────────────────────────│
   │                               │
   │  WS: select_vault/resume      │
   │──────────────────────────────>│
   │                               │
   │  WS: session_ready            │
   │  (sessionId, messages,        │
   │   slashCommands)              │
   │<──────────────────────────────│
```

Sessions are stored in-memory on the server. They survive WebSocket disconnect/reconnect but not server restart.

### Auto-Resume

On VaultSelect mount:
1. Check WebSocket connected
2. Load `memory-loop.vault` from localStorage
3. Find vault in discovered list
4. Trigger normal selection flow (check session → resume or create)
5. Track attempt to prevent loops

### Reconnection Handling

When WebSocket reconnects after disconnect, MainContent re-sends `select_vault` to restore server-side context. The vault info is already in SessionContext from localStorage.

## Configuration (.memory-loop.json)

All fields optional:

```json
{
  "title": "Override Title",
  "subtitle": "Override Subtitle",
  "order": 1,
  "badges": [{ "text": "Work", "color": "blue" }],

  "contentRoot": "content",
  "inboxPath": "00_Inbox",
  "metadataPath": "06_Metadata/memory-loop",
  "attachmentPath": "05_Attachments",

  "promptsPerGeneration": 5,
  "maxPoolSize": 50,
  "quotesPerWeek": 1,

  "recentCaptures": 5,
  "recentDiscussions": 5,
  "discussionModel": "opus",
  "cardsEnabled": true
}
```

## Connected Features

| Feature | Relationship |
|---------|-------------|
| [Configuration](./configuration.md) | Vault config editing |
| [Ground](../home-dashboard.md) | First tab after selection |
| All tabs | Require vault to be selected |

## Notes

- Vault ID is the directory name (sanitized for URL safety)
- Creating a vault converts title to safe directory name: "My Vault!" → "my-vault"
- Session persists server-side by vaultId, not WebSocket connection
- The `setup-complete` marker controls badge display and button text
- Health issues can block vault readiness (shown in HealthPanel)
