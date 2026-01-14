---
specification: ./../specs/memory-loop/2026-01-14-vault-config-editor.md
plan: ./../plans/memory-loop/2026-01-14-vault-config-editor-plan.md
status: Ready for Implementation
version: 1.0.0
created: 2026-01-14
last_updated: 2026-01-14
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Vault Configuration Editor - Task Breakdown

## Task Summary
Total: 11 tasks | Complexity Distribution: 3×S, 5×M, 3×L

## Protocol & Types

### TASK-001: Add Protocol Schemas for Config Update Messages
**Priority**: Critical | **Complexity**: S | **Dependencies**: None

**Description**: Define Zod schemas for `update_vault_config` (client→server) and `config_updated` (server→client) WebSocket messages, plus `EditableVaultConfigSchema` for validation.

**Acceptance Criteria**:
- [ ] `EditableVaultConfigSchema` defines all editable fields with constraints per spec
- [ ] `UpdateVaultConfigMessageSchema` with `type: "update_vault_config"` and `config` field
- [ ] `ConfigUpdatedMessageSchema` with `type`, `success`, optional `error`
- [ ] Schemas added to `ClientMessageSchema` and `ServerMessageSchema` discriminated unions
- [ ] Types exported for frontend/backend use

**Files**:
- Modify: `shared/src/protocol.ts`

**Testing**: Schema validation passes for valid messages; rejects invalid constraints

---

## Backend

### TASK-002: Implement saveVaultConfig Function
**Priority**: Critical | **Complexity**: M | **Dependencies**: TASK-001

**Description**: Add `saveVaultConfig()` to `vault-config.ts` that merges editable fields with existing config, preserving path fields and pinnedAssets.

**Acceptance Criteria**:
- [ ] Loads existing `.memory-loop.json` if present
- [ ] Merges only editable fields (title, subtitle, discussionModel, sliders, badges)
- [ ] Preserves non-editable fields (contentRoot, inboxPath, metadataPath, projectPath, areaPath, attachmentPath, pinnedAssets)
- [ ] Writes merged config back to file
- [ ] Does NOT create file if it doesn't exist and all values are defaults (per spec constraint)
- [ ] Returns success/error result

**Files**:
- Modify: `backend/src/vault-config.ts`

**Testing**: Unit tests for merge behavior, preservation of path fields, validation rejection

---

### TASK-003: Add WebSocket Handler for update_vault_config
**Priority**: High | **Complexity**: S | **Dependencies**: TASK-001, TASK-002

**Description**: Add message routing for `update_vault_config` in websocket-handler.ts. Validate config, call saveVaultConfig, return config_updated response.

**Acceptance Criteria**:
- [ ] Handler validates config against `EditableVaultConfigSchema`
- [ ] Calls `saveVaultConfig()` with validated data
- [ ] Returns `config_updated` with `success: true` on success
- [ ] Returns `config_updated` with `success: false, error: "..."` on failure
- [ ] Handler registered in `routeMessage()` switch statement

**Files**:
- Modify: `backend/src/websocket-handler.ts`

**Testing**: Unit test handler with mocked vault-config module

---

## Frontend Foundation

### TASK-004: Create ConfigEditorDialog Component Structure
**Priority**: High | **Complexity**: L | **Dependencies**: None

**Description**: Create the ConfigEditorDialog component with portal-based modal, form layout, save/cancel buttons, and change detection. Follow ConfirmDialog patterns.

**Acceptance Criteria**:
- [ ] Portal-based full-screen modal with backdrop
- [ ] Header with "Vault Settings" title and close (X) button
- [ ] Footer with Save and Cancel buttons (min-height: 44px)
- [ ] Escape key and backdrop click trigger cancel behavior
- [ ] Props: `isOpen`, `initialConfig`, `onSave`, `onCancel`
- [ ] Change detection: tracks if form differs from initial
- [ ] Cancel with unsaved changes shows ConfirmDialog
- [ ] All form controls have associated labels (REQ-NF-4)
- [ ] Dialog traps focus while open (aria-modal)
- [ ] Scrollable on mobile when content exceeds viewport

**Files**:
- Create: `frontend/src/components/ConfigEditorDialog.tsx`
- Create: `frontend/src/components/ConfigEditorDialog.css`

**Testing**: Component tests for render, escape handling, backdrop click, change detection

---

### TASK-005: Implement Text and Dropdown Fields
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-004

**Description**: Add text inputs for title/subtitle and dropdown select for discussionModel to ConfigEditorDialog form.

**Acceptance Criteria**:
- [ ] Title text input with label
- [ ] Subtitle text input with label
- [ ] discussionModel dropdown with opus/sonnet/haiku options
- [ ] Fields populate from initialConfig
- [ ] Changes update local form state
- [ ] Styling matches existing glassmorphism patterns

**Files**:
- Modify: `frontend/src/components/ConfigEditorDialog.tsx`
- Modify: `frontend/src/components/ConfigEditorDialog.css`

**Testing**: Component tests for field rendering and state updates

---

### TASK-006: Implement Slider Controls
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-004

**Description**: Add slider controls for numeric settings: promptsPerGeneration (1-20), maxPoolSize (10-200), quotesPerWeek (0-7), recentCaptures (1-20), recentDiscussions (1-20).

**Acceptance Criteria**:
- [ ] Each slider shows current numeric value (REQ-NF-3)
- [ ] Sliders have proper min/max/step per spec
- [ ] Sliders have aria-valuemin, aria-valuemax, aria-valuenow
- [ ] Fields populate from initialConfig with defaults if undefined
- [ ] 44px touch target for mobile (REQ-NF-2)
- [ ] Visual styling consistent with EditableField patterns

**Files**:
- Modify: `frontend/src/components/ConfigEditorDialog.tsx`
- Modify: `frontend/src/components/ConfigEditorDialog.css`

**Testing**: Component tests for slider interaction, value display, accessibility attrs

---

### TASK-007: Implement BadgeEditor Subcomponent
**Priority**: High | **Complexity**: L | **Dependencies**: TASK-004

**Description**: Create BadgeEditor subcomponent for add/remove badge chips with color picker. Enforces 5-badge limit and 20-char text limit.

**Acceptance Criteria**:
- [ ] Displays existing badges as removable chips with X button
- [ ] "Add badge" button shows input + color palette
- [ ] Color palette: 8 predefined colors per spec
- [ ] Text input with 20-char limit (REQ-F-20)
- [ ] Add button disabled when at 5-badge limit (REQ-F-21)
- [ ] Remove badge removes from list
- [ ] Color buttons have aria-labels

**Files**:
- Modify: `frontend/src/components/ConfigEditorDialog.tsx`
- Modify: `frontend/src/components/ConfigEditorDialog.css`

**Testing**: Component tests for add/remove flow, limits enforcement, color selection

---

## Frontend Integration

### TASK-008: Add Gear Button to VaultSelect
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-004

**Description**: Add understated gear button to vault cards in VaultSelect, positioned next to Setup/Reconfigure button. Opens ConfigEditorDialog.

**Acceptance Criteria**:
- [ ] Gear icon button rendered on each vault card (REQ-F-1)
- [ ] Visually subtle: low contrast, small icon (REQ-F-3)
- [ ] Button click opens ConfigEditorDialog with vault config
- [ ] `onClick` uses `stopPropagation()` to prevent card selection
- [ ] Dialog receives current vault config as initialConfig
- [ ] 44px touch target

**Files**:
- Modify: `frontend/src/components/VaultSelect.tsx`
- Modify: `frontend/src/styles/VaultSelect.css`

**Testing**: Component test for button rendering, click isolation, dialog open

---

### TASK-009: Add Gear Button to App Header
**Priority**: High | **Complexity**: S | **Dependencies**: TASK-004, TASK-008

**Description**: Add understated gear button in App.tsx header near vault name button when inside active vault session.

**Acceptance Criteria**:
- [ ] Gear button appears in header when vault is selected (REQ-F-2)
- [ ] Positioned adjacent to vault name button
- [ ] Same visual styling as VaultSelect gear button
- [ ] Opens ConfigEditorDialog with current vault config

**Files**:
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.css`

**Testing**: Component test for conditional rendering, dialog integration

---

### TASK-010: Implement Save/Cancel Flow with WebSocket
**Priority**: High | **Complexity**: L | **Dependencies**: TASK-001, TASK-003, TASK-005, TASK-006, TASK-007

**Description**: Wire ConfigEditorDialog save action to send `update_vault_config` message, handle `config_updated` response with toast notification.

**Acceptance Criteria**:
- [ ] Save validates all fields client-side before submission (REQ-F-22)
- [ ] Invalid fields show inline error, prevent submission
- [ ] Valid save sends `update_vault_config` via WebSocket (REQ-F-23)
- [ ] Success response shows toast and closes dialog (REQ-F-24)
- [ ] Failure response shows inline error, dialog stays open (REQ-F-25)
- [ ] After success, UI state reflects new config values
- [ ] Loading indicator during save operation

**Files**:
- Modify: `frontend/src/components/ConfigEditorDialog.tsx`
- Modify: `frontend/src/components/VaultSelect.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/contexts/SessionContext.tsx` (if vault state update needed)

**Testing**: Integration test for save flow, error handling, toast display

---

## Testing

### TASK-011: Backend and Frontend Tests
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-002, TASK-003, TASK-010

**Description**: Comprehensive tests for config save backend function and ConfigEditorDialog frontend component.

**Acceptance Criteria**:
- [ ] `vault-config.test.ts`: saveVaultConfig preserves non-editable fields
- [ ] `vault-config.test.ts`: validation rejects out-of-range values
- [ ] `websocket-handler.test.ts`: update_vault_config handler routes correctly
- [ ] `ConfigEditorDialog.test.tsx`: fields populated from initialConfig
- [ ] `ConfigEditorDialog.test.tsx`: slider interactions update value display
- [ ] `ConfigEditorDialog.test.tsx`: badge add/remove respects limits
- [ ] `ConfigEditorDialog.test.tsx`: cancel with changes shows confirmation

**Files**:
- Modify: `backend/src/__tests__/vault-config.test.ts`
- Modify: `backend/src/__tests__/websocket-handler.test.ts`
- Create: `frontend/src/components/__tests__/ConfigEditorDialog.test.tsx`

**Testing**: All tests pass; coverage for save/validation logic

---

## Dependency Graph
```
TASK-001 (Protocol) ─────┬─> TASK-002 (saveVaultConfig) ─> TASK-003 (Handler) ─┐
                         │                                                       │
                         └─────────────────────────────────────────────────────────┤
                                                                                   │
TASK-004 (Dialog structure) ─┬─> TASK-005 (Text/Dropdown) ──────────────────────┐ │
                             ├─> TASK-006 (Sliders) ────────────────────────────┤ │
                             └─> TASK-007 (BadgeEditor) ────────────────────────┤ │
                                                                                 │ │
TASK-004 ────────────────────┬─> TASK-008 (VaultSelect gear) ───────────────────┤ │
                             └─> TASK-009 (App header gear) ────────────────────┤ │
                                                                                 │ │
                               ┌─────────────────────────────────────────────────┘ │
TASK-010 (Save/WebSocket) <────┴───────────────────────────────────────────────────┘
        │
        └─> TASK-011 (Tests)
```

## Implementation Order

**Phase 1** (Foundation - can parallelize): TASK-001, TASK-004
**Phase 2** (Backend): TASK-002, TASK-003
**Phase 3** (Frontend form fields): TASK-005, TASK-006, TASK-007
**Phase 4** (Gear buttons): TASK-008, TASK-009
**Phase 5** (Integration): TASK-010
**Phase 6** (Testing): TASK-011

## Notes

- **Parallelization**: TASK-001 and TASK-004 have no dependencies and can be done concurrently
- **Critical path**: TASK-001 → TASK-002 → TASK-003 → TASK-010 → TASK-011
- **Pattern reuse**: ConfigEditorDialog follows ConfirmDialog patterns; form controls adapt EditableField styling
- **Risk**: BadgeEditor (TASK-007) is most complex UI component; start early in Phase 3
