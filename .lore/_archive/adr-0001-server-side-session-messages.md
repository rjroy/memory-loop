# ADR 0001: Server-Side Session Message Storage

**Status:** Accepted
**Date:** 2025-12-25
**Authors:** RJ Roy

## Context

Memory Loop's original session architecture split state between frontend and backend:

- **Backend** stored session metadata (id, vaultId, timestamps) in `.memory-loop/sessions/{id}.json`
- **Frontend** stored messages in localStorage, keyed by vaultId

This dual source of truth created coordination problems:

1. **Ordering dependencies** - `SELECT_VAULT` clears messages, `RESTORE_SESSION` restores them. Wrong order loses data.
2. **Multiple resume handlers** - VaultSelect, Discussion, and SessionContext all contained resume logic.
3. **Lazy session creation** - Sessions created on first message meant `session_ready` was sent twice (once empty, once with real ID).
4. **Synchronization bugs** - Backend created sessions without notifying frontend, causing resume failures.

In contrast, Adventure Engine (a similar project) uses a simpler pattern: the server owns all state and sends complete history on reconnect. No localStorage coordination needed.

## Decision

Adopt server-side message storage. The backend becomes the single source of truth for session state including messages.

### Changes Made

**Backend:**
- `SessionData` now includes a `messages: Message[]` field
- Messages are persisted to `.memory-loop/sessions/{id}.json` alongside metadata
- `resume_session` response includes full message history
- `session_ready` event includes messages array

**Frontend:**
- Removed localStorage message persistence
- Removed `RESTORE_SESSION` reducer action
- Session resume renders messages directly from server response
- Simplified to single resume flow in Discussion component

**Protocol:**
- `session_ready` payload extended: `{ sessionId, vaultId, messages }`

## Consequences

### Positive

- **Single source of truth** - No coordination between frontend and backend state
- **Simpler resume flow** - Connect → authenticate → render (3 steps vs 10)
- **No ordering bugs** - Can't restore messages in wrong order if server sends them
- **Easier debugging** - All session state visible in one JSON file
- **Works across devices** - Messages not trapped in browser localStorage

### Negative

- **Increased storage** - Server stores full message history per session
- **Larger payloads** - Resume sends complete history over WebSocket
- **Migration needed** - Existing localStorage sessions not automatically migrated

### Mitigations

- Sessions are per-vault and manually created, limiting storage growth
- Message history is typically small (dozens of messages, not thousands)
- Old localStorage data can be cleared on next deploy; no migration path needed

## References

- Analysis document: `docs/session-architecture-analysis.md` (removed)
- Adventure Engine pattern: Single `adventure_loaded` event with full history
- Related commits: `feat/session-resume` branch
