---
version: 1.0.0
status: Approved
created: 2026-01-14
last_updated: 2026-01-14
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
issue: "#266"
---

# Vault Configuration Editor Specification

## Executive Summary

Memory Loop vaults are configured via `.memory-loop.json` files, but currently users must edit these files manually. This feature adds a visual configuration editor accessible via a gear button, allowing users to modify vault settings through an intuitive full-screen interface with appropriate input controls for each setting type.

The editor appears in two locations: on the vault selection screen (next to the existing Setup/Reconfigure button) and inside an active vault session (near the vault name button). Changes are validated and persisted via WebSocket to the backend.

## User Story

As a Memory Loop user, I want to configure my vault settings through a visual interface, so that I can customize behavior without manually editing JSON files.

## Stakeholders

- **Primary**: Memory Loop users who want to customize vault behavior
- **Secondary**: Developers maintaining the configuration system
- **Tertiary**: Future contributors extending configuration options

## Success Criteria

1. Users can open config editor from both vault selection and active vault views
2. All supported settings are editable with appropriate input controls
3. Changes persist to `.memory-loop.json` after save
4. Invalid configurations display error message identifying specific validation failure
5. Unsaved changes prompt for confirmation before closing

## Functional Requirements

### Gear Button Placement

- **REQ-F-1**: Display understated gear button on vault cards (VaultSelect) next to the Setup/Reconfigure button
- **REQ-F-2**: Display understated gear button in the header near the vault name button when inside an active vault session
- **REQ-F-3**: Gear button must be visually subtle (low contrast, small icon) to avoid drawing attention from primary actions

### Config Editor Dialog

- **REQ-F-4**: Config editor displays as a full-screen modal overlay (similar to existing dialog patterns)
- **REQ-F-5**: Dialog includes a header with title "Vault Settings" and close (X) button
- **REQ-F-6**: Dialog includes Save and Cancel buttons in the footer
- **REQ-F-7**: Clicking backdrop or pressing Escape triggers cancel behavior

### Editable Fields

- **REQ-F-8**: `title` - Text input for vault display name override
- **REQ-F-9**: `subtitle` - Text input for vault subtitle override
- **REQ-F-10**: `discussionModel` - Dropdown select with options: opus, sonnet, haiku
- **REQ-F-11**: `promptsPerGeneration` - Numeric slider (range: 1-20, default: 5)
- **REQ-F-12**: `maxPoolSize` - Numeric slider (range: 10-200, default: 50)
- **REQ-F-13**: `quotesPerWeek` - Numeric slider (range: 0-7, default: 1)
- **REQ-F-14**: `recentCaptures` - Numeric slider (range: 1-20, default: 5)
- **REQ-F-15**: `recentDiscussions` - Numeric slider (range: 1-20, default: 5)
- **REQ-F-16**: `badges` - Badge list editor (add/remove badges with text and color picker)

### Badge Editor

- **REQ-F-17**: Display existing badges as removable chips
- **REQ-F-18**: Provide "Add badge" button to create new badges
- **REQ-F-19**: Badge creation requires text input and color selection from predefined palette (black, purple, red, cyan, orange, blue, green, yellow)
- **REQ-F-20**: Limit badge text to 20 characters
- **REQ-F-21**: Limit total badges to 5 per vault

### Save/Cancel Behavior

- **REQ-F-22**: Save validates all fields before submission
- **REQ-F-23**: Save sends config update via WebSocket message
- **REQ-F-24**: Successful save closes dialog and shows success toast
- **REQ-F-25**: Failed save shows error message inline without closing dialog
- **REQ-F-26**: Cancel with unsaved changes prompts confirmation dialog
- **REQ-F-27**: Cancel without changes closes immediately

### Backend Support

- **REQ-F-28**: Add `update_vault_config` WebSocket message type to protocol
- **REQ-F-29**: Backend validates config values against defined constraints
- **REQ-F-30**: Backend writes validated config to `.memory-loop.json` preserving any fields not in the editable set (paths, pinnedAssets)
- **REQ-F-31**: Backend sends `config_updated` response with success/error status
- **REQ-F-32**: After successful save, backend broadcasts updated vault info to refresh UI state

## Non-Functional Requirements

- **REQ-NF-1** (Performance): Dialog must open within 100ms of button click
- **REQ-NF-2** (Usability): All form controls must have minimum 44px touch target
- **REQ-NF-3** (Usability): Slider controls must show current numeric value
- **REQ-NF-4** (Accessibility): All form controls must have associated labels
- **REQ-NF-5** (Accessibility): Dialog must trap focus while open
- **REQ-NF-6** (Consistency): Dialog styling must match existing ConfirmDialog and ToolPermissionDialog patterns
- **REQ-NF-7** (Mobile): Dialog must be scrollable on small screens if content exceeds viewport

## Explicit Constraints (DO NOT)

- Do NOT allow editing path fields (contentRoot, inboxPath, metadataPath, projectPath, areaPath, attachmentPath) - these require filesystem knowledge
- Do NOT allow editing pinnedAssets - managed separately via Browse mode
- Do NOT auto-save on field change - require explicit Save action
- Do NOT allow saving with validation errors
- Do NOT create `.memory-loop.json` if it doesn't exist and all values are defaults

## Technical Context

- **Existing Stack**: React 19, TypeScript, Hono backend, WebSocket protocol with Zod schemas
- **Integration Points**:
  - `shared/src/protocol.ts` - Add new message types
  - `backend/src/vault-config.ts` - Add save function
  - `backend/src/websocket-handler.ts` - Handle new message
  - `frontend/src/components/VaultSelect.tsx` - Add gear button
  - `frontend/src/App.tsx` - Add gear button in header
- **Patterns to Respect**:
  - Existing dialog patterns (ConfirmDialog, ToolPermissionDialog)
  - Glassmorphism styling with CSS variables
  - BEM naming convention for CSS classes
  - Zod schema validation for WebSocket messages

## Acceptance Tests

1. **Gear button visibility (VaultSelect)**: On vault selection screen, gear button appears on each vault card next to Setup/Reconfigure button
2. **Gear button visibility (Active vault)**: When inside a vault, gear button appears in header near vault name button
3. **Dialog opens**: Clicking gear button opens full-screen config editor dialog
4. **Fields populated**: Dialog fields show current values from vault config
5. **Slider interaction**: Moving slider updates displayed numeric value in real-time
6. **Badge add**: Can add new badge with custom text and selected color
7. **Badge remove**: Can remove existing badge by clicking X on chip
8. **Save success**: Valid config saves successfully, shows toast, closes dialog
9. **Save failure**: Invalid config shows inline error, dialog stays open
10. **Cancel with changes**: Cancel with unsaved changes shows confirmation prompt
11. **Cancel without changes**: Cancel with no changes closes immediately
12. **Escape key**: Pressing Escape triggers cancel behavior
13. **Backdrop click**: Clicking backdrop triggers cancel behavior
14. **Persistence**: Saved config persists across page refresh
15. **Preserved fields**: Saving config preserves path fields that weren't edited

## Out of Scope

- Editing path-based configuration fields
- Editing pinnedAssets array
- Creating new `.memory-loop.json` files (handled by existing Setup flow)
- Import/export of configuration
- Configuration presets or templates
- Undo/redo within the editor

---

**Next Phase**: Once approved, use `/spiral-grove:plan-generation` to create technical implementation plan.
