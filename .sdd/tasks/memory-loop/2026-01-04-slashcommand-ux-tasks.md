---
specification: ./../specs/2026-01-04-slashcommand-ux.md
plan: ./../plans/2026-01-04-slashcommand-ux-plan.md
status: Draft
version: 1.0.0
created: 2026-01-04
last_updated: 2026-01-04
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# SlashCommand UX - Task Breakdown

## Task Summary
Total: 8 tasks | Complexity Distribution: 3xS, 4xM, 1xL

## Foundation: Protocol & Backend

### TASK-001: Add SlashCommand type to shared protocol
**Priority**: Critical | **Complexity**: S | **Dependencies**: None

**Description**: Define the SlashCommand type and extend SessionReadyMessage schema in the shared protocol.

**Acceptance Criteria**:
- [ ] SlashCommandSchema defined with name, description, argumentHint fields
- [ ] SessionReadyMessageSchema includes optional slashCommands array
- [ ] Types exported for frontend/backend consumption

**Files**:
- Modify: `shared/src/protocol.ts`

**Testing**: TypeScript compiles, schema validates sample data

---

### TASK-002: Fetch and send commands from backend
**Priority**: Critical | **Complexity**: M | **Dependencies**: TASK-001

**Description**: Call SDK's `supportedCommands()` on vault selection and include commands in session_ready message.

**Acceptance Criteria**:
- [ ] `handleSelectVault` calls `supportedCommands()` after session creation
- [ ] Commands included in `session_ready` WebSocket message
- [ ] Graceful handling if SDK call fails (log warning, continue without commands)
- [ ] Empty array handled correctly (no error thrown)

**Files**:
- Modify: `backend/src/session-manager.ts`
- Modify: `backend/src/websocket-handler.ts`

**Testing**:
- Unit test: mock SDK returns commands, verify message includes them
- Unit test: SDK throws error, verify graceful degradation

---

## Frontend: State & Component

### TASK-003: Store commands in SessionContext
**Priority**: High | **Complexity**: S | **Dependencies**: TASK-001

**Description**: Add slashCommands to SessionState and update reducer to handle session_ready.

**Acceptance Criteria**:
- [ ] SessionState includes `slashCommands: SlashCommand[]`
- [ ] Reducer extracts commands from session_ready message
- [ ] Commands cleared on session end/vault change
- [ ] Default to empty array if not present

**Files**:
- Modify: `frontend/src/contexts/SessionContext.tsx`

**Testing**: Reducer test with mock session_ready containing commands

---

### TASK-004: Create SlashCommandAutocomplete component
**Priority**: Critical | **Complexity**: L | **Dependencies**: TASK-003

**Description**: Build the autocomplete popup component with filtering, keyboard/touch interaction, and accessibility.

**Acceptance Criteria**:
- [ ] Renders when input starts with `/` and commands exist
- [ ] Filters commands by name (case-insensitive prefix match)
- [ ] Displays max 5 items with scroll overflow
- [ ] Each item shows name (bold) and description
- [ ] Arrow keys navigate selection
- [ ] Enter/Tab selects highlighted command
- [ ] Escape closes popup
- [ ] Touch/click selects item
- [ ] Click outside closes popup
- [ ] ARIA attributes: role="listbox", aria-selected, aria-activedescendant
- [ ] Positioned absolutely above input

**Files**:
- Create: `frontend/src/components/SlashCommandAutocomplete.tsx`
- Create: `frontend/src/components/SlashCommandAutocomplete.css`

**Testing**:
- Render tests: visibility, filtering, empty state
- Keyboard tests: arrow navigation, selection, dismissal
- Touch tests: tap selection

---

### TASK-005: Integrate autocomplete into Discussion
**Priority**: High | **Complexity**: M | **Dependencies**: TASK-004

**Description**: Wire SlashCommandAutocomplete into Discussion component with event handling.

**Acceptance Criteria**:
- [ ] Autocomplete receives slashCommands from SessionContext
- [ ] onKeyDown intercepts arrows/Enter/Tab/Escape when popup open
- [ ] Selection replaces partial input with full command
- [ ] Cursor positioned after command name
- [ ] argumentHint shown as input placeholder after selection
- [ ] Popup closes on outside click

**Files**:
- Modify: `frontend/src/components/Discussion.tsx`
- Modify: `frontend/src/components/Discussion.css` (container positioning)

**Testing**: Integration test with mocked context and keyboard events

---

## Testing & Validation

### TASK-006: Backend unit tests for command fetching
**Priority**: Medium | **Complexity**: S | **Dependencies**: TASK-002

**Description**: Unit tests for SDK integration and message sending.

**Acceptance Criteria**:
- [ ] Test: SDK returns commands, session_ready includes them
- [ ] Test: SDK returns empty array, no error
- [ ] Test: SDK throws, warning logged, session continues
- [ ] Test: Commands not re-fetched on reconnect within session

**Files**:
- Create or modify: `backend/tests/session-manager.test.ts`
- Create or modify: `backend/tests/websocket-handler.test.ts`

**Testing**: All tests pass

---

### TASK-007: Frontend unit tests for autocomplete
**Priority**: Medium | **Complexity**: M | **Dependencies**: TASK-004, TASK-005

**Description**: Comprehensive tests for SlashCommandAutocomplete behavior.

**Acceptance Criteria**:
- [ ] Test: Popup appears on `/` with commands
- [ ] Test: Filtering narrows results
- [ ] Test: Arrow keys change selection
- [ ] Test: Enter inserts command
- [ ] Test: Escape closes without change
- [ ] Test: Empty commands array, popup never renders
- [ ] Test: ARIA attributes present

**Files**:
- Create: `frontend/tests/SlashCommandAutocomplete.test.tsx`

**Testing**: All tests pass with coverage on component logic

---

### TASK-008: End-to-end acceptance tests
**Priority**: Medium | **Complexity**: M | **Dependencies**: TASK-005, TASK-006

**Description**: Integration tests covering the full flow from vault selection to command insertion.

**Acceptance Criteria**:
- [ ] Test: Select vault, receive commands, type `/`, see popup
- [ ] Test: Filter by typing `/com`, select with Enter
- [ ] Test: Argument hint appears after selection
- [ ] Test: WebSocket reconnect triggers session_ready with fresh commands
- [ ] Test: Mobile tap selection works

**Files**:
- Create: `frontend/tests/SlashCommandFlow.test.tsx`

**Testing**: Tests exercise WebSocket mock through to UI interaction

---

## Dependency Graph
```
TASK-001 (protocol) ──┬──> TASK-002 (backend)
                      │
                      └──> TASK-003 (context) ──> TASK-004 (component) ──> TASK-005 (integration)
                                                         │
                                                         └──> TASK-007 (component tests)

TASK-002 ──> TASK-006 (backend tests)

TASK-005 ──┬──> TASK-008 (e2e tests)
           │
TASK-006 ──┘
```

## Implementation Order
**Phase 1** (Foundation): TASK-001
**Phase 2** (Parallel): TASK-002, TASK-003
**Phase 3** (Component): TASK-004
**Phase 4** (Integration): TASK-005
**Phase 5** (Testing): TASK-006, TASK-007, TASK-008 (parallelizable)

## Notes
- **Parallelization**: TASK-002 and TASK-003 can run in parallel after TASK-001
- **Critical path**: TASK-001 -> TASK-003 -> TASK-004 -> TASK-005
- **Accessibility**: TASK-004 includes ARIA requirements; consider VoiceOver/NVDA testing in TASK-008
