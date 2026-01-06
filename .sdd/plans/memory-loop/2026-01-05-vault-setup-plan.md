---
specification: ./../specs/memory-loop/2026-01-05-vault-setup.md
status: Draft
version: 1.0.0
created: 2026-01-05
last_updated: 2026-01-05
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Vault Setup - Technical Plan

## Overview

The vault setup feature adds a "Setup" or "Reconfigure" button to each vault card. The button triggers an agentic backend process that: (1) copies command templates to the vault's `.claude/commands/` directory, (2) creates PARA directories if missing, (3) uses Claude Agent SDK to intelligently update CLAUDE.md with Memory Loop context, and (4) writes a completion marker.

The architecture follows existing patterns: Zod-validated WebSocket messages, backend handler routing, and filesystem operations with path security validation. The LLM call for CLAUDE.md update uses the same `query()` function as discussion mode but with a focused system prompt and no conversation history.

## Architecture

### System Context

```
┌─────────────────┐      WebSocket       ┌─────────────────┐
│    Frontend     │◄────────────────────►│     Backend     │
│  VaultSelect    │   setup_vault        │  websocket-     │
│   component     │   setup_complete     │  handler.ts     │
└─────────────────┘                      └────────┬────────┘
                                                  │
                                         ┌────────▼────────┐
                                         │  vault-setup.ts │
                                         │  (new module)   │
                                         └────────┬────────┘
                                                  │
                    ┌─────────────────────────────┼─────────────────────────────┐
                    │                             │                             │
           ┌────────▼────────┐          ┌────────▼────────┐          ┌────────▼────────┐
           │ Command Install │          │ PARA Directory  │          │ CLAUDE.md Update│
           │ (file copy)     │          │ Creation        │          │ (Claude SDK)    │
           └─────────────────┘          └─────────────────┘          └─────────────────┘
```

### Components

| Component | Responsibility |
|-----------|---------------|
| **VaultSelect.tsx** | Renders setup button per vault card, tracks setup state, shows notifications |
| **protocol.ts** | New message schemas: `setup_vault`, `setup_complete` |
| **websocket-handler.ts** | Routes `setup_vault` to handler, returns `setup_complete` |
| **vault-setup.ts** (new) | Orchestrates setup: commands, PARA, CLAUDE.md, marker |
| **backend/src/commands/** (new) | Static command template files |

## Technical Decisions

### TD-1: New Backend Module vs Extending Existing

**Choice**: Create new `vault-setup.ts` module rather than extending `vault-manager.ts`

**Requirements**: REQ-F-10 through REQ-F-40 (setup process)

**Rationale**: Setup is a distinct operation with its own lifecycle (loading state, partial success, completion marker). vault-manager.ts handles discovery and config loading. Keeping setup separate:
- Isolates LLM-dependent code from pure filesystem operations
- Makes testing easier (mock SDK only for setup tests)
- Follows single-responsibility principle established by other modules (note-capture.ts, file-browser.ts)

### TD-2: Command Template Storage

**Choice**: Store command templates as static `.md` files in `backend/src/commands/`, copy to vaults at runtime

**Requirements**: REQ-F-15 through REQ-F-22, REQ-NF-7

**Rationale**: Alternatives considered:
- Hardcoded strings: Violates REQ-NF-7, hard to maintain
- Database: Overkill, no existing DB infrastructure
- Config files: Templates are code artifacts, should live with source

Static files allow: version control, easy editing, syntax highlighting in editors, straightforward copy operation.

### TD-3: CLAUDE.md Update via Claude Agent SDK

**Choice**: Use SDK `query()` with focused prompt to analyze and update CLAUDE.md

**Requirements**: REQ-F-23 through REQ-F-30

**Rationale**: The CLAUDE.md update requires intelligent analysis:
- Detect if Memory Loop section already exists
- Preserve existing content structure
- Adapt documentation to vault-specific paths
- Handle various CLAUDE.md formats gracefully

Using the existing SDK infrastructure:
- Reuses proven query/response patterns
- No new dependencies
- Consistent error handling with discussion mode
- Already handles rate limits, auth, etc.

Prompt will be a single-turn request (no conversation history) with:
- Current CLAUDE.md content
- Vault config (paths, goals location)
- Clear instructions for what to add/update

### TD-4: Setup State Detection via Marker File

**Choice**: Use `.memory-loop/setup-complete` JSON file as completion marker

**Requirements**: REQ-F-6 through REQ-F-9, REQ-F-38, REQ-F-39

**Rationale**: Alternatives considered:
- Extend VaultInfo schema: Would require vault list refresh
- Check for PARA dirs + commands: False positives if user created manually
- Database/API state: Adds complexity, not portable between installs

Marker file approach:
- Works offline
- Portable with vault
- Contains version for future upgrade detection
- Simple boolean check for UI state

### TD-5: Error Handling Strategy

**Choice**: Partial success with detailed error reporting

**Requirements**: REQ-F-14, REQ-NF-3

**Rationale**: Setup has three independent steps (commands, PARA, CLAUDE.md). If step 2 fails:
- Don't rollback step 1 (commands are useful even without PARA)
- Don't attempt step 3 if it depends on step 2 (it doesn't)
- Report exactly what failed

This matches user expectation: "I clicked setup, some things worked, tell me what didn't."

CLAUDE.md update is the critical step. If it fails, we still write the marker (setup ran) but include failure details in the marker JSON for debugging.

### TD-6: Button Click Isolation

**Choice**: Use nested button with `stopPropagation` for setup action

**Requirements**: REQ-F-4

**Rationale**: The vault card is itself a clickable button for selection. Options:
- Separate button element with stopPropagation (chosen)
- Replace card with div + separate buttons: Breaks existing accessibility
- CSS pointer-events tricks: Fragile, breaks touch interactions

The `stopPropagation` approach is standard React pattern for nested interactive elements.

### TD-7: Notification System

**Choice**: Add toast notification component with auto-dismiss

**Requirements**: REQ-F-12, REQ-F-13, REQ-NF-6

**Rationale**: The app doesn't currently have a notification system. Options:
- Browser alert(): Blocks UI, poor UX
- Inline error in vault card: Gets lost if user scrolls
- Toast notifications (chosen): Non-blocking, visible, standard UX

Implementation: Simple `Toast` component positioned fixed at bottom, renders via portal. Auto-dismiss after 5s (standard UX convention, long enough to read, short enough not to annoy).

### TD-8: Frontend Button State Management

**Choice**: Local component state in VaultSelect for setup-in-progress tracking, VaultInfo.setupComplete for configured status

**Requirements**: REQ-F-1, REQ-F-2, REQ-F-3, REQ-F-5, REQ-F-11, REQ-NF-5

**Rationale**: Two separate state concerns:
1. **Is setup currently running?** - Transient, per-connection state. Lives in VaultSelect as `setupVaultId: string | null`
2. **Has setup ever completed?** - Persistent, loaded from server. Lives in VaultInfo.setupComplete

This separation:
- Avoids polluting SessionContext with setup-specific state
- Matches existing pattern (selectedVaultId is local state)
- Allows multiple browser tabs to show accurate configured/unconfigured status
- Loading indicator naturally targets specific card via setupVaultId match

### TD-9: Pre-Setup Validation

**Choice**: Validate vault exists and has CLAUDE.md before starting setup process

**Requirements**: REQ-F-44

**Rationale**: Validation prevents wasted work and provides clear error messages:
- Check vault ID matches discovered vault: Prevents invalid requests
- Check CLAUDE.md exists: Required for update step (core purpose of setup)
- Check .memory-loop directory is writable: Prevents failure on marker write

Validation happens first, before any filesystem modifications. If validation fails, return `setup_complete` with `success: false` and clear error message.

### TD-10: PARA Directory Creation Strategy

**Choice**: Create only missing directories, respect vault config paths, preserve existing content

**Requirements**: REQ-F-31, REQ-F-32, REQ-F-33, REQ-F-34, REQ-F-35, REQ-F-36, REQ-F-37

**Rationale**: PARA directories may:
- Already exist with user content
- Use custom paths via `.memory-loop.json`
- Not all be needed (user may not want Archives)

Strategy:
1. Load vault config for custom paths
2. For each PARA directory (01_Projects, 02_Areas, 03_Resources, 04_Archives):
   - Resolve path using config or defaults
   - Check if exists
   - If missing, create with `mkdir -p` equivalent
   - If exists, skip (never modify existing)
3. Track which were created vs skipped for summary

This is non-destructive and additive only.

## Data Model

### SetupCompleteMarker

```typescript
interface SetupCompleteMarker {
  completedAt: string;      // ISO 8601 timestamp
  version: string;          // "1.0.0" for this implementation
  commandsInstalled: string[];  // List of successfully installed commands
  paraCreated: string[];    // List of directories created
  claudeMdUpdated: boolean; // Whether CLAUDE.md was modified
  errors?: string[];        // Any non-fatal errors encountered
}
```

### SetupResult (internal)

```typescript
interface SetupResult {
  success: boolean;
  summary: string[];    // Human-readable summary of actions
  errors?: string[];    // What failed (if any)
}

interface SetupStepResult {
  success: boolean;
  message: string;
  error?: string;
}
```

## Command Templates

The following commands are installed to `{vault}/.claude/commands/` during setup. Templates stored in `backend/src/commands/`:

| File | REQ | Purpose |
|------|-----|---------|
| `daily-debrief.md` | REQ-F-16 | Conversational daily check-in with guided reflection questions |
| `weekly-debrief.md` | REQ-F-17 | Weekly reflection and planning with context from notes |
| `monthly-summary.md` | REQ-F-18 | Monthly reports generation (open tasks + summary) |
| `daily-review.md` | REQ-F-19 | Structured end-of-day processing with output template |
| `inbox-processor.md` | REQ-F-20 | PARA-based inbox organization suggestions |
| `weekly-synthesis.md` | REQ-F-21 | Comprehensive weekly analysis with themes and insights |

Templates are copied verbatim. Existing files with same names are skipped (REQ-F-22).

## CLAUDE.md Update Prompt Structure

**Requirements**: REQ-F-23, REQ-F-24, REQ-F-25, REQ-F-26, REQ-F-27, REQ-F-28, REQ-F-29, REQ-F-30

The LLM receives a single-turn prompt with this structure:

```
System: You are updating a CLAUDE.md file for Memory Loop integration.

User:
Current CLAUDE.md content:
---
{existing CLAUDE.md content}
---

Vault configuration:
- Inbox path: {inboxPath}
- Goals file: {goalsPath or "not configured"}
- Content root: {contentRoot}
- PARA directories:
  - Projects: {projectPath}
  - Areas: {areaPath}
  - Resources: 03_Resources
  - Archives: 04_Archives

Instructions:
1. Preserve all existing content
2. Add or update a "## Memory Loop" section with:
   - Inbox location for daily note capture
   - Goals file location (if configured)
   - Note that daily notes are created via the capture tab
   - PARA directory locations for organization
3. If "## Memory Loop" already exists, update it in place
4. Do not remove or reorder existing sections

Return ONLY the complete updated CLAUDE.md content.
```

This prompt:
- Provides full context (existing content + config) so LLM can make intelligent decisions
- Explicitly preserves existing content (REQ-F-29)
- Respects vault-specific config (REQ-F-30)
- Single turn, no conversation history (stateless operation)

## API Design

**Requirements**: REQ-F-41, REQ-F-43 (REQ-F-42 deferred to future)

### WebSocket Messages

**Client → Server: `setup_vault`**
```typescript
{
  type: "setup_vault",
  vaultId: string
}
```

**Server → Client: `setup_complete`**
```typescript
{
  type: "setup_complete",
  vaultId: string,
  success: boolean,
  summary: string[],   // e.g., ["Installed 6 commands", "Created 4 directories", "Updated CLAUDE.md"]
  errors?: string[]    // e.g., ["Failed to create 02_Areas: permission denied"]
}
```

### VaultInfo Extension

Extend `VaultInfoSchema` in protocol.ts:

```typescript
export const VaultInfoSchema = z.object({
  // ... existing fields
  setupComplete: z.boolean(),  // New: indicates if setup has run
});
```

This requires updating `discoverVaults()` to check for marker file existence.

## Integration Points

### vault-config.ts

**Usage**: Path resolution for PARA directories
**Data Flow**: `loadVaultConfig()` → `resolveContentRoot()`, `resolveProjectPath()`, `resolveAreaPath()`
**Why**: REQ-F-33, REQ-F-36 require respecting custom paths

### session-manager.ts

**Usage**: Reference for SDK `query()` usage pattern
**Data Flow**: Not directly called; pattern reused
**Why**: CLAUDE.md update uses same SDK infrastructure

### vault-manager.ts

**Usage**: `discoverVaults()` needs modification to include `setupComplete` field
**Data Flow**: Check `.memory-loop/setup-complete` existence during discovery
**Why**: REQ-F-40 requires frontend state update

### file-browser.ts

**Usage**: Reuse `validatePath()` for path security
**Data Flow**: Import and use for command destination validation
**Why**: Prevent path traversal in vault operations

## Error Handling, Performance, Security

### Error Strategy

1. **Validation errors** (vault not found, no CLAUDE.md): Return `setup_complete` with `success: false` immediately
2. **Step failures**: Continue to next step, accumulate errors in `errors[]`
3. **SDK errors**: Map via existing `mapSdkError()`, include in errors
4. **Critical failures** (backup failed): Stop and return with accumulated results

### Performance Targets

- **Total setup time**: < 30 seconds (REQ-NF-1)
  - Command copy: < 1s (6 small files)
  - PARA creation: < 1s (mkdir operations)
  - CLAUDE.md update: ~20-25s (single SDK turn)
  - Marker write: < 100ms
- **Button state update**: < 100ms after completion (REQ-NF-2)

### Security Measures

- **Path validation**: All file operations use `validatePath()` to prevent traversal
- **Backup before write**: CLAUDE.md backed up before modification (REQ-NF-4)
- **No external execution**: Commands are data files, not executed
- **Vault boundary**: All writes constrained to vault directory (explicit constraint)

## Testing Strategy

### Unit Tests

**vault-setup.test.ts**:
- `installCommands()`: Creates directory, copies files, skips existing
- `createParaDirectories()`: Creates missing dirs, preserves existing
- `updateClaudeMd()`: Mock SDK, verify prompt structure, backup creation
- `writeSetupMarker()`: Correct JSON format and location
- Path validation for all operations

**Coverage target**: 90%+ for vault-setup.ts

### Integration Tests

- Full setup flow with temp vault directory
- Partial failure scenarios (permission errors)
- Re-run setup (reconfigure) on already-configured vault
- Custom paths from `.memory-loop.json`

### Frontend Tests

**VaultSelect.test.tsx**:
- Button shows "Setup" vs "Reconfigure" based on `setupComplete`
- Click isolation (setup doesn't trigger selection)
- Loading state during setup
- Toast notification on completion/error

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| SDK rate limit during setup | Low | Medium | Single short prompt; retry guidance in error message |
| CLAUDE.md corruption | Low | High | Backup before modification; preserve on error |
| Command file conflicts | Medium | Low | Skip existing files, report in summary |
| Setup timeout on slow connections | Low | Medium | 30s is generous; show progress indication |
| Path traversal in vault config | Low | High | Validate all paths against vault boundary |

## Dependencies

### Technical

- **@anthropic-ai/claude-agent-sdk**: Already installed (discussion mode)
- **Zod**: Already installed (protocol validation)
- No new dependencies required

### Filesystem Dependencies

- Command templates: `backend/src/commands/*.md` (must be created)
- Vault marker: `.memory-loop/setup-complete` (created by setup)
- Backup: `.memory-loop/claude-md-backup.md` (created by setup)

## Open Questions

All questions resolved:

- [x] ~~How to handle concurrent setup requests for same vault?~~ **Answer**: Disable button during setup (REQ-F-5); backend is single-threaded per connection
- [x] ~~Should marker include hash of CLAUDE.md for change detection?~~ **Answer**: No, keep simple for v1; version field allows future enhancement
