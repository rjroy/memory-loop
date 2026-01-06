---
specification: ./../specs/memory-loop/2026-01-05-vault-setup.md
plan: ./../plans/memory-loop/2026-01-05-vault-setup-plan.md
status: Draft
version: 1.0.0
created: 2026-01-05
last_updated: 2026-01-05
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Vault Setup - Task Breakdown

## Task Summary
Total: 12 tasks | Complexity Distribution: 4xS, 5xM, 3xL

## Protocol & Types

### TASK-001: Add Protocol Schemas for Setup Messages
**Priority**: Critical | **Complexity**: S | **Dependencies**: None

**Description**: Add Zod schemas for `setup_vault` and `setup_complete` WebSocket messages, plus extend `VaultInfoSchema` with `setupComplete` field.

**Acceptance Criteria**:
- [ ] `SetupVaultSchema` defined with `type: "setup_vault"` and `vaultId: string`
- [ ] `SetupCompleteSchema` defined with `type`, `vaultId`, `success`, `summary[]`, optional `errors[]`
- [ ] `VaultInfoSchema` extended with `setupComplete: z.boolean()`
- [ ] Both schemas added to `ClientMessageSchema` and `ServerMessageSchema` discriminated unions
- [ ] TypeScript types exported for use in backend/frontend

**Files**:
- Modify: `shared/src/protocol.ts`

**Testing**: Type tests compile; schema validation passes for valid messages

---

## Backend Foundation

### TASK-002: Create Command Template Files
**Priority**: Critical | **Complexity**: S | **Dependencies**: None

**Description**: Copy the 6 command templates from `151-examples/` to `backend/src/commands/` as the source templates for vault installation.

**Acceptance Criteria**:
- [ ] `backend/src/commands/` directory created
- [ ] All 6 templates present: `daily-debrief.md`, `weekly-debrief.md`, `monthly-summary.md`, `daily-review.md`, `inbox-processor.md`, `weekly-synthesis.md`
- [ ] Templates copied verbatim from examples

**Files**:
- Create: `backend/src/commands/daily-debrief.md`
- Create: `backend/src/commands/weekly-debrief.md`
- Create: `backend/src/commands/monthly-summary.md`
- Create: `backend/src/commands/daily-review.md`
- Create: `backend/src/commands/inbox-processor.md`
- Create: `backend/src/commands/weekly-synthesis.md`

**Testing**: Files exist and match example content

---

### TASK-003: Implement vault-setup.ts Module - Core Structure
**Priority**: Critical | **Complexity**: L | **Dependencies**: TASK-001, TASK-002

**Description**: Create the new `vault-setup.ts` backend module with the main orchestration function and internal types. This task implements the setup orchestration, command installation, and PARA directory creation (everything except CLAUDE.md LLM update).

**Acceptance Criteria**:
- [ ] `SetupResult` and `SetupStepResult` interfaces defined
- [ ] `SetupCompleteMarker` interface defined per plan
- [ ] `runVaultSetup(vaultId: string)` main function implemented
- [ ] `installCommands(vaultPath: string)` - copies templates, skips existing
- [ ] `createParaDirectories(vaultPath: string, config: VaultConfig)` - creates missing dirs
- [ ] `writeSetupMarker(vaultPath: string, result: SetupCompleteMarker)` implemented
- [ ] Path validation using `validatePath()` from file-browser.ts
- [ ] Unit tests verify partial failure accumulates errors in `errors[]` array and continues to next step

**Files**:
- Create: `backend/src/vault-setup.ts`

**Testing**: Unit tests for each helper function; integration test with temp directory

---

### TASK-004: Implement CLAUDE.md Update with SDK
**Priority**: Critical | **Complexity**: L | **Dependencies**: TASK-003

**Description**: Add the LLM-powered CLAUDE.md update step to `vault-setup.ts`. Creates backup, constructs prompt per plan, calls SDK `query()`, writes result.

**Acceptance Criteria**:
- [ ] `createClaudeMdBackup(vaultPath: string)` - backs up to `.memory-loop/claude-md-backup.md`
- [ ] `updateClaudeMd(vaultPath: string, config: VaultConfig)` implemented
- [ ] Prompt includes: current CLAUDE.md content, vault config (inbox/goals/PARA paths), preservation instructions
- [ ] Uses existing SDK `query()` pattern from session-manager.ts
- [ ] Backup created before modification
- [ ] If backup fails, abort CLAUDE.md update step
- [ ] Errors mapped via existing `mapSdkError()`

**Files**:
- Modify: `backend/src/vault-setup.ts`

**Testing**: Unit test with mocked SDK; verify prompt structure; backup creation test

---

### TASK-005: Add WebSocket Handler for setup_vault
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-003, TASK-004

**Description**: Add message routing for `setup_vault` in websocket-handler.ts. Validate vault exists and has CLAUDE.md, then invoke setup.

**Acceptance Criteria**:
- [ ] `handleSetupVault(ws, message)` handler function created
- [ ] Pre-setup validation: vault exists in discovered vaults (returns error with clear message if not)
- [ ] Pre-setup validation: CLAUDE.md exists at vault root (returns error with clear message if not)
- [ ] Calls `runVaultSetup()` and returns `setup_complete` message
- [ ] Handler registered in `routeMessage()` switch statement

**Files**:
- Modify: `backend/src/websocket-handler.ts`

**Testing**: Unit test handler with mocked vault-setup module

---

### TASK-006: Update Vault Discovery for setupComplete Status
**Priority**: High | **Complexity**: S | **Dependencies**: TASK-001

**Description**: Modify `discoverVaults()` to check for `.memory-loop/setup-complete` marker and populate the `setupComplete` field in VaultInfo.

**Acceptance Criteria**:
- [ ] During vault discovery, check for marker file existence
- [ ] `VaultInfo.setupComplete` set to `true` if marker exists, `false` otherwise
- [ ] No parsing of marker content needed (existence check only)

**Files**:
- Modify: `backend/src/vault-manager.ts`

**Testing**: Unit test with temp vault containing/missing marker file

---

## Frontend

### TASK-007: Add Setup Button to VaultSelect Component
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-001, TASK-006

**Description**: Add a setup button to each vault card that shows "Setup" or "Reconfigure" based on `setupComplete` status. Button click must not trigger vault selection.

**Acceptance Criteria**:
- [ ] Setup button rendered on each vault card
- [ ] Button shows "Setup" when `vault.setupComplete === false`
- [ ] Button shows "Reconfigure" when `vault.setupComplete === true`
- [ ] `onClick` uses `stopPropagation()` to prevent card selection
- [ ] Button styling follows existing BEM patterns
- [ ] Button is accessible (proper aria labels)

**Files**:
- Modify: `frontend/src/components/VaultSelect.tsx`
- Modify: `frontend/src/styles/VaultSelect.css` (if needed)

**Testing**: Component test for button rendering and click isolation

---

### TASK-008: Implement Setup Loading State and WebSocket Integration
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-005, TASK-007

**Description**: Add local state to track setup-in-progress, send `setup_vault` message on button click, handle `setup_complete` response.

**Acceptance Criteria**:
- [ ] `setupVaultId: string | null` local state tracks which vault is setting up
- [ ] Button shows loading indicator when `setupVaultId === vault.id`
- [ ] Button disabled during setup
- [ ] `sendMessage({ type: "setup_vault", vaultId })` sent on click
- [ ] `setup_complete` message handled in WebSocket hook/reducer
- [ ] `VaultInfo.setupComplete` updated in state on successful completion

**Files**:
- Modify: `frontend/src/components/VaultSelect.tsx`
- Modify: `frontend/src/hooks/useWebSocket.ts` (if message handling needed)
- Modify: `frontend/src/contexts/SessionContext.tsx` (reducer for setup_complete)

**Testing**: Component test with mocked WebSocket; test loading state transitions

---

### TASK-009: Add Toast Notification Component
**Priority**: Medium | **Complexity**: M | **Dependencies**: None

**Description**: Create a Toast notification component for displaying setup success/error messages with auto-dismiss.

**Acceptance Criteria**:
- [ ] `Toast` component renders fixed at bottom of screen
- [ ] Supports success and error variants
- [ ] Auto-dismisses after 5 seconds
- [ ] Can be manually dismissed
- [ ] Renders via portal to avoid z-index issues
- [ ] Accessible (role="alert")

**Files**:
- Create: `frontend/src/components/Toast.tsx`
- Create: `frontend/src/styles/Toast.css`

**Testing**: Component test for rendering, auto-dismiss timing, manual dismiss

---

### TASK-010: Integrate Toast with Setup Completion
**Priority**: Medium | **Complexity**: S | **Dependencies**: TASK-008, TASK-009

**Description**: Show toast notification when setup completes (success or error), displaying the summary or error messages.

**Acceptance Criteria**:
- [ ] Success toast shows summary items (e.g., "Installed 6 commands", "Created 4 directories")
- [ ] Error toast shows what failed
- [ ] Toast triggered when `setup_complete` message received

**Files**:
- Modify: `frontend/src/components/VaultSelect.tsx`

**Testing**: Integration test showing toast on setup completion

---

## Testing & Integration

### TASK-011: Backend Integration Tests
**Priority**: High | **Complexity**: L | **Dependencies**: TASK-003, TASK-004, TASK-005, TASK-006

**Description**: Comprehensive integration tests for the vault setup flow using temp directories.

**Acceptance Criteria**:
- [ ] Test full setup flow: commands installed, PARA created, marker written
- [ ] Test partial failure scenarios (permission errors)
- [ ] Test re-run (reconfigure) on already-configured vault
- [ ] Test custom paths from `.memory-loop.json`
- [ ] Test validation failures (missing CLAUDE.md, invalid vault)
- [ ] SDK calls mocked for CLAUDE.md update tests

**Files**:
- Create: `backend/tests/vault-setup.test.ts`

**Testing**: Tests pass with coverage >90% for vault-setup.ts

---

### TASK-012: Frontend Component Tests
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-007, TASK-008, TASK-009, TASK-010

**Description**: Test VaultSelect setup button behavior and Toast component.

**Acceptance Criteria**:
- [ ] Test button shows "Setup" vs "Reconfigure" based on setupComplete
- [ ] Test click isolation (setup click doesn't select vault)
- [ ] Test loading state during setup
- [ ] Test toast appears on completion
- [ ] Test toast auto-dismiss behavior

**Files**:
- Create: `frontend/tests/VaultSelect.setup.test.tsx`
- Create: `frontend/tests/Toast.test.tsx`

**Testing**: All tests pass

---

## Dependency Graph
```
TASK-001 (Protocol) ──┬─> TASK-003 (vault-setup core) ──> TASK-004 (CLAUDE.md) ──┐
                      │                                                           │
TASK-002 (Templates) ─┘                                                           │
                                                                                  │
                      ┌─> TASK-006 (Discovery) ──> TASK-007 (Button) ─────────────┤
TASK-001 ─────────────┤                                                           │
                      └─────────────────────────────────────────────────┐         │
                                                                        │         │
TASK-009 (Toast) ─────────────────────────────────────────────────────>┬┤         │
                                                                        ││         │
TASK-005 (Handler) <── TASK-003, TASK-004                               ││         │
        │                                                               ││         │
        └───────────> TASK-008 (Loading/WS) <── TASK-007                ││         │
                              │                                         ││         │
                              └───────────> TASK-010 (Toast integration)┘│         │
                                                                         │         │
TASK-011 (Backend tests) <── TASK-003, TASK-004, TASK-005, TASK-006 ────┘         │
                                                                                  │
TASK-012 (Frontend tests) <── TASK-007, TASK-008, TASK-009, TASK-010 ─────────────┘
```

## Implementation Order

**Phase 1** (Foundation - can parallelize): TASK-001, TASK-002, TASK-009
**Phase 2** (Backend core): TASK-003, TASK-006
**Phase 3** (Backend complete): TASK-004, TASK-005
**Phase 4** (Frontend): TASK-007, TASK-008, TASK-010
**Phase 5** (Testing): TASK-011, TASK-012

## Notes

- **Parallelization**: TASK-001, TASK-002, and TASK-009 have no dependencies and can be done concurrently
- **Critical path**: TASK-001 → TASK-003 → TASK-004 → TASK-005 → TASK-008 → TASK-011/TASK-012
- **Risk mitigation**: TASK-004 (SDK integration) is highest risk; consider stubbing initially
