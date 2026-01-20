---
version: 1.0.0
status: Draft
created: 2026-01-04
last_updated: 2026-01-04
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
issue: https://github.com/rjroy/memory-loop/issues/144
---

# SlashCommand UX Specification

## Executive Summary

Memory Loop's Discussion mode supports slash commands through the Claude Agent SDK, but currently only displays a generic "Slash command detected" hint. This specification defines a proper autocomplete experience that helps users discover and invoke available slash commands.

The feature retrieves available commands from the SDK's `supportedCommands()` API, displays a filterable autocomplete popup when the user types `/`, and handles selection with argument hints. The implementation must work across desktop and mobile (touch) devices.

## User Story

As a Memory Loop user, I want autocomplete suggestions when I type `/` in the Discussion input, so that I can discover and invoke slash commands without memorizing their names.

## Stakeholders

- **Primary**: Memory Loop users in Discussion mode
- **Secondary**: Developers maintaining the frontend components
- **Tertiary**: Mobile users (distinct interaction patterns), documentation maintainers

## Success Criteria

1. Autocomplete popup appears within 100ms of typing `/`
2. Users can select commands via keyboard (desktop) or tap (mobile)
3. After selection, the argument hint is displayed inline
4. Zero regressions to existing Discussion mode functionality

## Functional Requirements

### Command Discovery

- **REQ-F-1**: Backend fetches available slash commands from SDK's `supportedCommands()` method on session initialization
- **REQ-F-2**: Backend sends command list to frontend via new WebSocket message type
- **REQ-F-3**: Frontend caches command list for duration of session

### Autocomplete Trigger

- **REQ-F-4**: Autocomplete popup appears immediately when user types `/` as the first character
- **REQ-F-5**: Autocomplete filters commands as user continues typing (e.g., `/com` matches `/commit`)
- **REQ-F-6**: Filtering matches command names only (not descriptions)
- **REQ-F-7**: Autocomplete hides when input no longer starts with `/` or when no matches remain

### Command Display

- **REQ-F-8**: Each autocomplete item displays command name and description
- **REQ-F-9**: Commands are sorted alphabetically by name
- **REQ-F-10**: Popup displays maximum 5 commands at once with scroll for overflow

### Desktop Interaction

- **REQ-F-11**: Arrow keys navigate the list; highlighted item is visually distinct
- **REQ-F-12**: Enter selects highlighted command
- **REQ-F-13**: Escape closes autocomplete without selection
- **REQ-F-14**: Tab selects highlighted command (same as Enter)

### Mobile Interaction

- **REQ-F-15**: Popup appears above keyboard as an overlay
- **REQ-F-16**: Tap on a command selects it
- **REQ-F-17**: Tapping outside popup closes it without selection

### Command Selection

- **REQ-F-18**: Selection replaces partial input with full command name (e.g., `/com` becomes `/commit`)
- **REQ-F-19**: After selection, cursor is positioned after command name
- **REQ-F-20**: If command has an argumentHint, display it as placeholder/hint text after the command

### Edge Cases

- **REQ-F-21**: If SDK returns empty command list, autocomplete does not appear
- **REQ-F-22**: If command fetch fails, system degrades gracefully (no autocomplete, no error shown to user)
- **REQ-F-23**: Rapid typing does not cause flickering or race conditions

## Non-Functional Requirements

- **REQ-NF-1** (Performance): Autocomplete appears within 100ms of trigger keystroke
- **REQ-NF-2** (Performance): Filtering updates within 16ms (60fps) of each keystroke
- **REQ-NF-3** (Accessibility): Popup is navigable via keyboard with proper ARIA attributes
- **REQ-NF-4** (Accessibility): Screen readers announce available commands
- **REQ-NF-5** (Consistency): Popup styling matches existing Discussion mode UI patterns
- **REQ-NF-6** (Mobile): Popup does not overlap with mobile keyboard in a way that hides commands

## Explicit Constraints (DO NOT)

- Do NOT fetch commands on every keystroke; fetch once per session
- Do NOT search command descriptions (name-only filtering per user preference)
- Do NOT auto-submit the command on selection; user must press send
- Do NOT show autocomplete if input is not at the start of a new message
- Do NOT block the input while commands are loading

## Technical Context

- **Existing Stack**: React 19, TypeScript, Hono backend, WebSocket protocol with Zod schemas
- **Integration Points**: Claude Agent SDK `Query.supportedCommands()` method, existing `Discussion.tsx` component
- **Patterns to Respect**: WebSocket message schemas in `shared/src/protocol.ts`, existing CSS patterns in `Discussion.css`

## Acceptance Tests

1. **Basic trigger**: Type `/` in empty input; autocomplete popup appears with available commands
2. **Filtering**: Type `/com`; only commands containing "com" in their name appear
3. **Keyboard selection**: Press down arrow twice, then Enter; third command is selected
4. **Mobile tap**: Tap on a command in the popup; command is inserted into input
5. **Escape dismissal**: Open autocomplete, press Escape; popup closes, input unchanged
6. **Argument hint**: Select a command with argumentHint; hint appears after command name
7. **Empty state**: If SDK returns no commands, typing `/` shows no popup
8. **Reconnection**: After WebSocket reconnect, commands are re-fetched from SDK

## Open Questions

- [x] Trigger behavior: Show on first `/` (confirmed by user)
- [x] Argument handling: Show argument hint (confirmed by user)
- [x] Search scope: Name only (confirmed by user)
- [x] Mobile UX: Best practice recommendation (tap to select in overlay popup)

## Out of Scope

- Command argument validation (SDK handles this)
- Custom command registration (only SDK-provided commands)
- Command history or favorites
- Nested command menus

---

**Next Phase**: Once approved, use `/spiral-grove:plan-generation` to create technical implementation plan.
