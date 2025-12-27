---
version: 1.0.0
status: Draft
created: 2025-12-26
last_updated: 2025-12-26
authored_by:
  - Claude Code (Reverse-Engineered)
---

# Navigation Bar Specification

**Reverse-Engineered**: true
**Source Module**: frontend/src/components/ModeToggle.tsx

## Executive Summary

The Navigation Bar is a core UI component that provides mode-switching controls for the Memory Loop application. It enables users to navigate between four distinct application modes: Home, Note Capture, Discussion (Chat), and Browse (View). The component is implemented as a segmented control (pill-style toggle) with touch-friendly design optimized for mobile interfaces, featuring a minimum 44px tap target height to meet accessibility standards.

This feature serves as the primary navigation mechanism within the application after vault selection, allowing seamless transitions between different workflows without losing context. The navigation bar maintains visual consistency across modes using gradient-based selected states and glassmorphism design patterns.

## User Story

As a Memory Loop user, I want to quickly switch between different application modes (Home, Note, Chat, View), so that I can seamlessly transition between capturing notes, having AI discussions, browsing vault files, and viewing my dashboard without losing my current session context.

## Stakeholders

- **Primary**: Memory Loop users (mobile-first target audience)
- **Secondary**: Frontend developers maintaining the component, UX designers implementing navigation patterns

## Success Criteria

1. Mode switching occurs within 200ms of user interaction (measured by state update and UI re-render)
2. Component passes WCAG 2.1 Level AA accessibility standards (minimum 44px touch targets, proper ARIA labels)
3. All four modes (Home, Note, Chat, View) are accessible via single tap/click
4. Visual feedback provides clear indication of currently selected mode

## Functional Requirements

- **REQ-F-1**: System must provide four distinct navigation modes: Home, Note, Chat, and View
- **REQ-F-2**: System must display all four mode options simultaneously in a segmented control layout
- **REQ-F-3**: System must highlight the currently active mode with visual distinction (gradient background, color change, glow effect)
- **REQ-F-4**: System must update application mode state when user clicks a mode segment
- **REQ-F-5**: System must prevent mode switching when component is in disabled state
- **REQ-F-6**: System must prevent redundant state updates when user clicks already-selected mode
- **REQ-F-7**: System must integrate with SessionContext to read current mode and invoke setMode action
- **REQ-F-8**: System must render appropriate mode-specific content (HomeView, NoteCapture, Discussion, BrowseMode) based on selected mode
- **REQ-F-9**: System must support programmatic mode switching from other components (e.g., RecentActivity, InspirationCard)
- **REQ-F-10**: System must maintain mode state across component re-renders without loss

## Non-Functional Requirements

- **REQ-NF-1** (Performance): Mode switching must complete within 200ms from click to visual feedback
- **REQ-NF-2** (Usability): Each mode segment must meet minimum 44px height for touch targets (iOS/Android accessibility guidelines)
- **REQ-NF-3** (Usability): Each mode segment must meet minimum 56px width for touch targets
- **REQ-NF-4** (Accessibility): Component must use proper ARIA roles (tablist, tab) and attributes (aria-selected, aria-label)
- **REQ-NF-5** (Accessibility): Component must provide accessible labels for screen readers ("Application mode" tablist label)
- **REQ-NF-6** (Visual Design): Selected mode must use gradient background (--gradient-primary-dim) with cyan accent color
- **REQ-NF-7** (Visual Design): Selected mode must display glow effect (--glow-purple) and increased font weight (bold)
- **REQ-NF-8** (Visual Design): Component must use glassmorphism styling (backdrop blur, semi-transparent background, border)
- **REQ-NF-9** (Interaction): Hover state must change text color for non-selected, non-disabled segments
- **REQ-NF-10** (Interaction): Active click state must apply 0.98 scale transform for tactile feedback
- **REQ-NF-11** (Interaction): Disabled state must reduce opacity to 0.5 and show not-allowed cursor
- **REQ-NF-12** (Responsiveness): Component must support mobile-first responsive design patterns

## Explicit Constraints (DO NOT)

- Do NOT allow mode switching when component is disabled (disabled prop is true)
- Do NOT trigger state updates when clicking the already-selected mode
- Do NOT clear browser state when switching between modes (REQ-F-22 in SessionContext)
- Do NOT clear vault selection when switching modes
- Do NOT persist mode state to localStorage (mode resets to "home" on page reload)
- Do NOT render mode toggle before vault is selected
- Do NOT show more or fewer than four mode options (Home, Note, Chat, View are fixed)

## Technical Context

- **Existing Stack**:
  - React 19 with functional components and hooks
  - TypeScript with strict mode enabled
  - CSS modules with custom properties (CSS variables)
  - Bun for runtime and testing
- **Integration Points**:
  - SessionContext: Reads `mode` state, invokes `setMode(mode: AppMode)` action
  - App.tsx: Conditionally renders mode-specific components based on `mode` value
  - RecentActivity: Programmatically calls `setMode("browse")` and `setMode("discussion")`
  - InspirationCard: Programmatically calls `setMode("discussion")` with prefill text
  - HomeView: Default mode when vault is selected
- **Patterns to Respect**:
  - Use `useSession()` hook for state access (no prop drilling)
  - Follow BEM CSS naming convention (mode-toggle__segment, mode-toggle__segment--selected)
  - Implement as controlled component (state managed externally in SessionContext)
  - Use TypeScript discriminated union for AppMode type ("home" | "note" | "discussion" | "browse")

## Acceptance Tests

1. **Rendering - All Modes Visible**: When component renders, all four mode options (Home, Note, Chat, View) are displayed as buttons
2. **Rendering - Default Selection**: When component renders without prior state, Home mode is selected by default
3. **Rendering - Accessibility Attributes**: Component has role="tablist" with aria-label="Application mode", and each button has role="tab" with aria-selected attribute
4. **Rendering - Selected Visual State**: Selected mode button has "mode-toggle__segment--selected" CSS class applied
5. **Mode Switching - Note**: Clicking "Note" button updates mode to "note" and applies selected visual state
6. **Mode Switching - Chat**: Clicking "Chat" button updates mode to "discussion" and applies selected visual state
7. **Mode Switching - View**: Clicking "View" button updates mode to "browse" and applies selected visual state
8. **Mode Switching - Home**: Clicking "Home" button updates mode to "home" and applies selected visual state
9. **Mode Switching - All Transitions**: User can switch between all four modes in any order without errors
10. **Mode Switching - Idempotent**: Clicking already-selected mode does not trigger redundant state updates
11. **Disabled State - All Buttons**: When disabled prop is true, all four buttons have disabled attribute set
12. **Disabled State - No Switching**: Clicking any button when disabled=true does not change mode state
13. **Programmatic Switching - RecentActivity**: Clicking "View" on capture card switches to browse mode and navigates to file path
14. **Programmatic Switching - Inspiration**: Clicking inspiration item switches to discussion mode with prefilled text
15. **State Preservation - Browser Context**: Switching between modes preserves browser state (current path, expanded directories, file content)

## Open Questions

- [ ] Should mode state persist to localStorage for continuity across page reloads? (Currently resets to "home")
- [ ] Should there be keyboard navigation support (arrow keys to move between modes, Enter to select)?
- [ ] Should mode transitions include animation (sliding indicator) or remain instant?
- [ ] Should disabled state be applied conditionally per mode (e.g., disable Chat when no session)?

## Out of Scope

- Mode-specific content rendering (handled by App.tsx main content area)
- Session management and WebSocket connectivity
- Vault selection and discovery
- Browser state management (file tree, directory cache)
- Message history and conversation state
- Confirmation dialogs for mode switches
- Custom mode addition/removal (four modes are fixed)
- Mode-specific validation or business logic

---

**Next Phase**: Once approved, use `/spiral-grove:plan-generation` to create technical implementation plan.
