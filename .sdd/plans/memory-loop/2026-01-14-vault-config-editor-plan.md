---
specification: [./../specs/memory-loop/2026-01-14-vault-config-editor.md](../specs/memory-loop/2026-01-14-vault-config-editor.md)
status: Approved
version: 1.0.0
created: 2026-01-14
last_updated: 2026-01-14
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
---

# Vault Configuration Editor - Technical Plan

## Overview

This plan describes how to build a visual configuration editor for Memory Loop vault settings. The feature adds gear buttons in two locations (VaultSelect cards and App header), opening a full-screen dialog where users can modify `.memory-loop.json` settings through appropriate form controls. Changes are validated client-side and sent via WebSocket for backend persistence.

The architecture reuses existing patterns: the dialog follows ConfirmDialog/ToolPermissionDialog structure, form controls adapt EditableField patterns, and WebSocket messages follow the established Zod-validated protocol.

## Architecture

### System Context

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                          │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────────┐  │
│  │ VaultSelect  │   │    App.tsx   │   │  ConfigEditor      │  │
│  │ (gear btn)   │──▶│  (gear btn)  │──▶│  Dialog            │  │
│  └──────────────┘   └──────────────┘   │  ├─ TextFields     │  │
│                                         │  ├─ Sliders        │  │
│                                         │  ├─ Dropdown       │  │
│                                         │  └─ BadgeEditor    │  │
│                                         └────────┬───────────┘  │
│                                                  │              │
│                                    update_vault_config          │
│                                                  ▼              │
└──────────────────────────────────────────────────────────────────┘
                                                   │
                                            WebSocket
                                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                        Backend (Hono)                            │
│  ┌────────────────────┐   ┌─────────────────────────────────┐   │
│  │ websocket-handler  │──▶│  handleUpdateVaultConfig        │   │
│  │ (route message)    │   │  ├─ validate constraints        │   │
│  └────────────────────┘   │  ├─ merge with existing config  │   │
│                           │  └─ write .memory-loop.json     │   │
│                           └─────────────────────────────────┘   │
│                                         │                        │
│                               config_updated response            │
│                                         ▼                        │
│                           ┌─────────────────────────────────┐   │
│                           │  Refresh vault info broadcast   │   │
│                           └─────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Responsibility |
|-----------|---------------|
| `ConfigEditorDialog` | Full-screen modal with form, save/cancel, change detection |
| `ConfigForm` | Form layout and field rendering |
| `BadgeEditor` | Add/remove badge chips with color picker |
| Gear buttons | Trigger dialog open (VaultSelect and App header) |
| `handleUpdateVaultConfig` | Backend handler for validation and persistence |

### State Flow

1. User clicks gear button → Dialog opens with current config values
2. User modifies fields → Local form state updates
3. User clicks Save → Frontend validation runs
4. If valid → Send `update_vault_config` message
5. Backend validates → Writes file → Sends `config_updated` response
6. Success → Toast notification, dialog closes, UI refreshes
7. Failure → Inline error, dialog stays open

## Technical Decisions

### TD-1: Reuse EditableField Component Patterns
**Choice**: Adapt slider/select/text patterns from `EditableField.tsx` instead of creating new components
**Requirements**: REQ-F-8 through REQ-F-15, REQ-NF-3
**Rationale**: The existing EditableField component already implements:
- Slider with value display (REQ-NF-3)
- Select dropdown
- Text input
- Debounced updates
- Consistent styling

Copying the input rendering patterns (not the optimistic update logic) keeps the codebase consistent. The config editor doesn't need per-field debouncing since it has explicit Save.

### TD-2: Dialog Structure Following ConfirmDialog Pattern
**Choice**: Use portal-based full-screen modal with backdrop, matching ConfirmDialog/ToolPermissionDialog
**Requirements**: REQ-F-4 through REQ-F-7, REQ-NF-2, REQ-NF-4, REQ-NF-5, REQ-NF-6
**Rationale**:
- Portal rendering ensures z-index stacking above all content
- Existing CSS variables and glassmorphism patterns maintain visual consistency
- Backdrop click and Escape key handling are established patterns
- `aria-modal="true"` provides focus trapping foundation
- All buttons must have minimum 44px height (REQ-NF-2) via `min-height: 44px`
- All form controls use native HTML `<label>` elements wrapping or `htmlFor` attribute (REQ-NF-4)
- Sliders include `aria-valuemin`, `aria-valuemax`, `aria-valuenow` (pattern from EditableField)

### TD-3: Form State Management with useState/useReducer
**Choice**: Local component state for form values, not context
**Requirements**: REQ-F-22, REQ-F-26, REQ-F-27
**Rationale**: Config editor is a self-contained dialog. Form state doesn't need to persist across the app. Local state simplifies:
- Change detection (compare local state to initial props)
- Reset on cancel
- No context provider overhead

Use `useReducer` if form grows complex; `useState` with object spread is sufficient for current field count.

### TD-4: Validation Strategy - Client-Side First, Server Confirms
**Choice**: Validate all fields client-side before sending; backend re-validates for security
**Requirements**: REQ-F-22, REQ-F-29
**Rationale**:
- Client validation provides instant feedback without round-trip
- Backend validation protects against malicious/malformed requests
- Zod schemas can be shared: define `EditableVaultConfigSchema` in shared/protocol.ts

### TD-5: Badge Editor as Subcomponent
**Choice**: Create `BadgeEditor` subcomponent within ConfigEditorDialog module
**Requirements**: REQ-F-16 through REQ-F-21
**Rationale**: Badge editing is self-contained and complex enough to warrant separation:
- Chip display with remove button
- Add badge flow (text input + color picker)
- Character limit validation
- Badge count limit

Not exported as standalone component since it's only used here.

### TD-6: Preserve Non-Editable Fields on Save
**Choice**: Backend loads existing config, merges editable fields, writes back
**Requirements**: REQ-F-30, explicit constraint "DO NOT allow editing path fields"
**Rationale**: The config file contains path fields (contentRoot, inboxPath, etc.) and pinnedAssets that aren't editable via this dialog. The backend must:
1. Load existing `.memory-loop.json`
2. Update only the editable fields from the message
3. Preserve everything else
4. Write back

This matches the existing `savePinnedAssets` pattern in vault-config.ts.

### TD-7: Toast Notification on Success
**Choice**: Use existing Toast component for success/error feedback
**Requirements**: REQ-F-24, REQ-F-25
**Rationale**: VaultSelect already uses Toast for setup_complete feedback. Reusing provides consistency and avoids implementing new notification UI.

### TD-8: No Full-Screen on Large Viewports
**Choice**: Use max-width constrained dialog (similar to ConfirmDialog), not full-screen at all sizes
**Requirements**: REQ-NF-7 (mobile scrollable)
**Rationale**: The spec says "full-screen modal overlay" but ConfirmDialog shows this means covering the viewport with a backdrop, not making the dialog fill the screen. On mobile, the dialog should scroll if content exceeds viewport. On desktop, the dialog should be centered with max-width (~500px).

### TD-9: Gear Button Placement and Styling
**Choice**: Add understated gear icon buttons in two locations with consistent low-contrast styling
**Requirements**: REQ-F-1, REQ-F-2, REQ-F-3
**Rationale**:
- **VaultSelect (REQ-F-1)**: Position gear button next to existing Setup/Reconfigure button in vault card. Uses same button structure but smaller icon, lower opacity.
- **App header (REQ-F-2)**: Position gear button adjacent to vault name button. Same styling approach.
- **Visual subtlety (REQ-F-3)**: Use `opacity: 0.6` at rest, `opacity: 0.8` on hover. No background color, just icon. This prevents gear from competing with primary actions (Setup button, vault name navigation).
- Icon: Use CSS-based gear icon or inline SVG matching existing icon patterns in the codebase.

## Data Model

### Editable Config Fields

```typescript
// Fields sent in update_vault_config message
interface EditableVaultConfig {
  title?: string;           // REQ-F-8
  subtitle?: string;        // REQ-F-9
  discussionModel?: "opus" | "sonnet" | "haiku";  // REQ-F-10
  promptsPerGeneration?: number;  // REQ-F-11: 1-20
  maxPoolSize?: number;           // REQ-F-12: 10-200
  quotesPerWeek?: number;         // REQ-F-13: 0-7
  recentCaptures?: number;        // REQ-F-14: 1-20
  recentDiscussions?: number;     // REQ-F-15: 1-20
  badges?: Badge[];               // REQ-F-16 through REQ-F-21
}

// Badge from shared/protocol.ts (already exists)
interface Badge {
  text: string;   // max 20 chars
  color: BadgeColor;
}
```

### Constraints Reference

| Field | Type | Min | Max | Default |
|-------|------|-----|-----|---------|
| title | string | - | - | (vault name) |
| subtitle | string | - | - | - |
| discussionModel | enum | - | - | opus |
| promptsPerGeneration | number | 1 | 20 | 5 |
| maxPoolSize | number | 10 | 200 | 50 |
| quotesPerWeek | number | 0 | 7 | 1 |
| recentCaptures | number | 1 | 20 | 5 |
| recentDiscussions | number | 1 | 20 | 5 |
| badges | array | 0 | 5 | [] |
| badge.text | string | 1 | 20 | - |

## API Design

### New WebSocket Messages

**Client → Server: `update_vault_config`**
```typescript
const UpdateVaultConfigMessageSchema = z.object({
  type: z.literal("update_vault_config"),
  config: EditableVaultConfigSchema,
});
```

**Server → Client: `config_updated`**
```typescript
const ConfigUpdatedMessageSchema = z.object({
  type: z.literal("config_updated"),
  success: z.boolean(),
  error: z.string().optional(),  // Present when success=false
});
```

**Message Flow**:
1. Client sends `update_vault_config` with edited fields
2. Backend validates constraints
3. If valid: merge with existing config, write file, respond `{ success: true }`
4. If invalid: respond `{ success: false, error: "..." }`
5. After success, backend may optionally broadcast updated `vault_list` to refresh UI state

### Validation Schema

```typescript
// Shared between frontend validation and backend validation
const EditableVaultConfigSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  discussionModel: z.enum(["opus", "sonnet", "haiku"]).optional(),
  promptsPerGeneration: z.number().int().min(1).max(20).optional(),
  maxPoolSize: z.number().int().min(10).max(200).optional(),
  quotesPerWeek: z.number().int().min(0).max(7).optional(),
  recentCaptures: z.number().int().min(1).max(20).optional(),
  recentDiscussions: z.number().int().min(1).max(20).optional(),
  badges: z.array(BadgeSchema).max(5).optional(),
});

// Badge text constraint (REQ-F-20)
const BadgeSchema = z.object({
  text: z.string().min(1).max(20),
  color: BadgeColorSchema,  // Already exists in protocol.ts
});
```

## Integration Points

### Frontend Integration

| File | Changes |
|------|---------|
| `shared/src/protocol.ts` | Add `UpdateVaultConfigMessageSchema`, `ConfigUpdatedMessageSchema`, types |
| `frontend/src/components/VaultSelect.tsx` | Add gear button next to Setup/Reconfigure |
| `frontend/src/App.tsx` | Add gear button in header near vault name |
| `frontend/src/components/ConfigEditorDialog.tsx` | New component (dialog + form) |
| `frontend/src/components/ConfigEditorDialog.css` | Styling following existing patterns |
| `frontend/src/hooks/useWebSocket.ts` | Handle `config_updated` message (already handles new types via discriminated union) |

### Backend Integration

| File | Changes |
|------|---------|
| `backend/src/websocket-handler.ts` | Add case for `update_vault_config` in routeMessage |
| `backend/src/vault-config.ts` | Add `saveVaultConfig` function for merging and writing |
| `backend/src/handlers/` | Consider new `config-handlers.ts` if logic grows |

### Dependencies

- No new npm packages required
- All form controls use native HTML elements
- Color picker uses preset palette (no color picker library)

## Error Handling, Performance, Security

### Error Strategy
- **Client validation errors**: Display inline beneath form, prevent submission
- **Server validation errors**: Display in error banner within dialog, dialog stays open
- **Network errors**: Show generic error message, allow retry
- **File write errors**: Return specific error message from backend

### Performance Targets
- **REQ-NF-1**: Dialog open within 100ms
  - Achieved by: pre-loading current config from props, no API call on open
  - Dialog component lazy-loaded if bundle size becomes concern
- **Form interactions**: Instant feedback (local state)
- **Save operation**: Typically <50ms (local file write)

### Security Measures
- **Input sanitization**: Zod validation on backend before writing
- **Path preservation**: Backend never writes user-supplied path values
- **No config creation**: Per spec constraint, don't create `.memory-loop.json` if it doesn't exist with all defaults

## Testing Strategy

### Unit Tests

**ConfigEditorDialog.test.tsx**:
- Renders with all fields populated from initial config
- Slider interactions update value display
- Text field changes update state
- Badge addition respects 5-badge limit
- Badge text respects 20-char limit
- Save disabled when validation fails
- Save triggers onSave callback with form data
- Cancel with no changes closes immediately
- Cancel with changes shows confirmation dialog
- Escape key triggers cancel behavior
- Backdrop click triggers cancel behavior

**BadgeEditor.test.tsx** (if extracted):
- Add badge flow: input → color select → add
- Remove badge removes from list
- Cannot add badge when at limit

**Backend: vault-config.test.ts**:
- `saveVaultConfig` preserves non-editable fields
- `saveVaultConfig` validates constraints
- Invalid config returns error, doesn't write

### Integration Tests

**WebSocket message round-trip**:
1. Client sends `update_vault_config`
2. Server responds `config_updated`
3. File contains updated values
4. Non-editable fields preserved

**End-to-end (manual or Playwright)**:
- Open config editor from VaultSelect
- Modify slider, verify value display
- Add badge, verify it appears
- Save, verify toast and file update
- Re-open, verify values persisted

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Form state complexity grows | Medium | Low | Start with useState; refactor to useReducer if >10 fields |
| Color picker accessibility | Low | Medium | Use predefined color buttons with aria-labels for each color |
| Badge editor interaction on mobile | Medium | Medium | Ensure 44px touch targets, test on device |
| Concurrent config file modification | Low | Medium | Last-write wins is acceptable for single-user app; document in error message if write fails |
| Network failure during save | Low | Medium | Show "Save failed, please try again" error; dialog stays open so user can retry |
| File write permission error | Low | High | Backend returns specific error message; user guidance in error text |
| Existing config has >5 badges | Low | Low | Truncate to 5 on load; user can remove before adding more |

## Dependencies

### Technical
- React 19 (existing)
- Zod (existing)
- Existing CSS variables and component patterns

### Team
- None (self-contained feature)

## Open Questions

- [ ] None - all requirements are clear from the spec
