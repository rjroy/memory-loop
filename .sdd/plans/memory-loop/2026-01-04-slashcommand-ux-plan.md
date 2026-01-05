---
specification: ./../specs/2026-01-04-slashcommand-ux.md
status: Draft
version: 1.0.0
created: 2026-01-04
last_updated: 2026-01-04
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# SlashCommand UX - Technical Plan

## Overview

This plan implements slash command autocomplete for the Discussion mode. The approach fetches commands from the Claude Agent SDK on session initialization, sends them to the frontend via WebSocket, and renders an autocomplete popup in the input area.

The implementation spans three layers: backend (SDK integration, WebSocket message), shared protocol (new message types), and frontend (autocomplete component with keyboard/touch interaction).

## Architecture

**System Context**: The autocomplete enhances the existing Discussion component's input area. It integrates with the SDK via the backend session manager and communicates through the established WebSocket protocol.

**Components**:
- `session-manager.ts` - Calls `supportedCommands()` on session creation
- `websocket-handler.ts` - Sends `slash_commands` message to frontend
- `shared/protocol.ts` - Defines `SlashCommand` type and new message schemas
- `SlashCommandAutocomplete.tsx` - New component rendering the popup
- `Discussion.tsx` - Integrates autocomplete with input handling

```
┌─────────────────────────────────────────────────────────────────┐
│                          Frontend                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                     Discussion.tsx                       │   │
│  │  ┌──────────────────┐  ┌────────────────────────────┐   │   │
│  │  │  Input Textarea  │  │ SlashCommandAutocomplete   │   │   │
│  │  │                  │  │  - Filter commands         │   │   │
│  │  │  onKeyDown →     │  │  - Keyboard navigation     │   │   │
│  │  │  onChange →      │  │  - Touch selection         │   │   │
│  │  └──────────────────┘  └────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ↑                                  │
│                     slash_commands                              │
│                              ↑                                  │
└──────────────────────────────│──────────────────────────────────┘
                               │ WebSocket
┌──────────────────────────────│──────────────────────────────────┐
│                          Backend                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │               websocket-handler.ts                       │   │
│  │  handleSelectVault() ──→ session-manager.ts              │   │
│  │                              │                           │   │
│  │                              ↓                           │   │
│  │                    SDK.supportedCommands()               │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Technical Decisions

### TD-1: Fetch Commands on Vault Selection
**Choice**: Call `supportedCommands()` when a vault is selected (in `handleSelectVault`), not on each discussion message.
**Requirements**: REQ-F-1, REQ-F-3 (cache for session), constraint "Do NOT fetch on every keystroke"
**Rationale**: Commands are static per SDK session. Fetching once and caching reduces latency (REQ-NF-1: 100ms popup) and API calls. The `session_ready` message already marks vault readiness; we extend it to include commands.

### TD-2: Extend session_ready Message
**Choice**: Add optional `slashCommands` field to the existing `session_ready` WebSocket message rather than creating a new message type.
**Requirements**: REQ-F-2 (send via WebSocket)
**Rationale**: The `session_ready` message already fires on vault selection and session resume. Adding commands here avoids a new message type and ensures commands arrive before user interaction. The field is optional for backward compatibility.

### TD-3: Inline Autocomplete Component
**Choice**: Create `SlashCommandAutocomplete.tsx` as a child of Discussion, positioned absolutely above the input. Popup appears when input starts with `/` (REQ-F-4) and supports touch selection (REQ-F-16).
**Requirements**: REQ-F-4 (trigger on `/`), REQ-F-15 (popup above keyboard), REQ-F-16 (touch selection), REQ-NF-5 (match UI patterns)
**Rationale**: Absolute positioning allows the popup to overlay content without disrupting layout. Unlike dialogs (ConfirmDialog, ToolPermissionDialog) that use portals, the autocomplete is tightly coupled to the input and benefits from inheriting Discussion's CSS variables and context. Touch selection uses `onClick` with pointer-events, avoiding mobile tap delay issues.

### TD-4: Use CSS for Position, Not Portal
**Choice**: Position autocomplete via CSS `position: absolute` relative to the input-area, not via `createPortal`.
**Requirements**: REQ-F-15 (above keyboard), REQ-NF-6 (no keyboard overlap)
**Rationale**: Portals to document.body would require recalculating position on scroll/resize and handling z-index conflicts with the keyboard. Relative positioning with `bottom: 100%` naturally places the popup above the input. Mobile keyboard behavior pushes the viewport, and the popup moves with it.

### TD-5: Filter Logic in useMemo
**Choice**: Compute filtered command list via `useMemo` based on input value.
**Requirements**: REQ-F-5 (filter on typing), REQ-F-6 (name-only), REQ-NF-2 (16ms updates)
**Rationale**: Simple string filtering is O(n) where n is typically <20 commands. `useMemo` avoids recalculating on unrelated re-renders. React's batching handles rapid keystrokes without debouncing.

### TD-6: Controlled Selection Index
**Choice**: Track `selectedIndex` as local state, reset to 0 on filter changes.
**Requirements**: REQ-F-11 (arrow navigation), REQ-F-9 (sorted alphabetically)
**Rationale**: Keyboard navigation requires tracking which item is highlighted. Resetting to 0 on filter change ensures the first match is always highlighted, matching user expectations.

### TD-7: Argument Hint as Placeholder
**Choice**: After command selection, show `argumentHint` as placeholder text in the input (not as a separate element).
**Requirements**: REQ-F-20 (display argumentHint)
**Rationale**: Using the input's placeholder attribute provides native UX (hint disappears when typing), accessibility (screen readers announce placeholders), and minimal implementation. The hint is cleared when user types or clears the command.

### TD-8: Event Handling Order
**Choice**: Intercept keyboard events on input via `onKeyDown`, preventing default for navigation keys when autocomplete is open.
**Requirements**: REQ-F-11 (arrow navigation), REQ-F-12 (Enter selection), REQ-F-13 (Escape dismissal), REQ-F-14 (Tab selection), REQ-F-23 (no race conditions)
**Rationale**: `onKeyDown` fires before `onChange`, allowing us to prevent textarea's default behavior (cursor movement on arrows, form submission on Enter). This ensures clean separation between autocomplete interaction and normal typing.

### TD-9: Accessibility Implementation
**Choice**: Add ARIA attributes (`role="listbox"`, `aria-selected`, `aria-label`) and live region announcements for screen readers.
**Requirements**: REQ-NF-3 (keyboard navigation with ARIA), REQ-NF-4 (screen reader announcements)
**Rationale**: WCAG 2.1 combobox pattern requires listbox role and option selection states. Live region (`aria-live="polite"`) announces filtered result count without interrupting typing. Native accessibility is critical for users relying on assistive technology.

### TD-10: Popup Display and Scroll Behavior
**Choice**: Limit visible items to 5 with vertical scroll overflow; each item shows command name (bold) and description.
**Requirements**: REQ-F-8 (display name and description), REQ-F-10 (max 5 with scroll)
**Rationale**: 5 items provides enough context without overwhelming mobile screens. Scrollable overflow maintains usability when many commands match. Bold command name aids scanability.

### TD-11: Selection and Cursor Behavior
**Choice**: On selection, replace partial input with full command, position cursor after command name, and show argumentHint as placeholder.
**Requirements**: REQ-F-18 (replace partial input), REQ-F-19 (cursor after command), REQ-F-20 (argumentHint display)
**Rationale**: Replacing partial input ensures clean command entry. Cursor positioning allows immediate argument typing. Placeholder hint disappears on typing, avoiding confusion with actual input.

### TD-12: Popup Dismissal Triggers
**Choice**: Close popup when: (a) input no longer starts with `/`, (b) no matches remain, (c) user presses Escape, (d) user taps outside popup.
**Requirements**: REQ-F-7 (hide on invalid input), REQ-F-13 (Escape dismissal), REQ-F-17 (tap outside closes)
**Rationale**: Multiple dismissal paths match user expectations from native autocomplete UX. Outside-tap detection uses event delegation with `mousedown` (not `click`) to fire before input blur.

## Data Model

### SlashCommand Type (shared/protocol.ts)
```typescript
export interface SlashCommand {
  name: string;        // Command name including "/" (e.g., "/commit")
  description: string; // User-facing description
  argumentHint?: string; // Optional hint for expected arguments
}
```

### SessionState Extension (SessionContext.tsx)
```typescript
// Add to SessionState
slashCommands: SlashCommand[];
```

### WebSocket Message Extension
```typescript
// Extend SessionReadyMessage
export const SessionReadyMessageSchema = z.object({
  type: z.literal("session_ready"),
  sessionId: z.string(),
  vaultId: z.string(),
  messages: z.array(ConversationMessageProtocolSchema).optional(),
  createdAt: z.string().optional(),
  slashCommands: z.array(SlashCommandSchema).optional(), // NEW
});
```

## Integration Points

### Claude Agent SDK
- **Integration type**: Method call on Query object
- **Purpose**: Retrieve available slash commands for current session
- **Data flow**: `session-manager.ts` calls `query.supportedCommands()` after creating/resuming session
- **Dependencies**: SDK must expose `supportedCommands()` method

### WebSocket Protocol
- **Integration type**: Message schema extension
- **Purpose**: Transport commands from backend to frontend
- **Data flow**: Backend includes commands in `session_ready`, frontend stores in SessionContext
- **Dependencies**: Zod schema update in shared package

### Discussion Component
- **Integration type**: Child component composition
- **Purpose**: Render autocomplete popup and handle selection
- **Data flow**: Discussion passes `slashCommands` and input state to SlashCommandAutocomplete
- **Dependencies**: Input ref for cursor positioning

## Error Handling, Performance, Security

### Error Strategy
- **SDK failure** (REQ-F-22): If `supportedCommands()` throws, log warning and continue without autocomplete. No user-facing error.
- **Empty commands** (REQ-F-21): If SDK returns empty array, `slashCommands` state is empty and popup never renders.
- **Parse errors**: Zod schema validation rejects malformed command data at protocol layer.

### Performance Targets
- **Popup appearance** (REQ-NF-1): <100ms from typing `/`. Achieved by pre-caching commands in state (no network request on trigger).
- **Filter updates** (REQ-NF-2): <16ms per keystroke. Achieved by simple string matching in `useMemo`; array of ~20 items is negligible.
- **No flicker** (REQ-F-23): React's batching handles rapid state updates. No debouncing needed for filter input.

### Security Measures
- Commands come from trusted SDK source; no user input validation needed.
- Command names displayed as text content, not rendered as HTML.

## Testing Strategy

### Unit Tests
- **SlashCommandAutocomplete.tsx**: Render tests with mock commands, keyboard interaction, touch interaction
- **Filtering logic**: Name-only matching, case sensitivity, empty states
- **SessionContext**: `slashCommands` state initialization and updates

### Integration Tests
- **End-to-end flow**: Select vault → receive commands → type `/` → see popup → select command
- **Reconnection**: Verify commands re-fetched after WebSocket reconnect

### Manual Test Scenarios (from spec)
1. Basic trigger: Type `/` → popup appears
2. Filtering: Type `/com` → filtered results
3. Keyboard selection: Arrow keys + Enter
4. Mobile tap: Touch selection
5. Escape dismissal
6. Argument hint display
7. Empty state (no commands)
8. Reconnection refresh

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| SDK doesn't expose `supportedCommands()` | L | H | Verify SDK API before implementation; if missing, file SDK issue |
| Mobile keyboard covers popup | M | M | Use `bottom: 100%` positioning; test on iOS/Android browsers |
| Race condition: commands arrive after first `/` typed | L | L | Show popup only when commands are loaded; subtle loading state not needed per spec |
| Accessibility violations | M | H | Implement TD-9 ARIA attributes; test with VoiceOver/NVDA |
| Focus lost after selection | M | M | Explicit focus management via input ref; verify keyboard reopens on mobile |

## Dependencies

### Technical
- Claude Agent SDK with `supportedCommands()` method
- React 19 (already in use)
- No new npm dependencies required

### Team
- No external approvals needed
- Follows existing patterns from codebase

## Open Questions

- [x] All spec questions resolved
