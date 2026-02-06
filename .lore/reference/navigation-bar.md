---
title: Navigation Bar Feature
date: 2026-01-28
status: current
tags: [navigation, gctr, mode-toggle, ui]
modules: [mode-toggle]
---

# Feature: Navigation Bar

## What It Does

The navigation bar provides persistent access to the four application modes. It encodes the GCTR framework (Ground, Capture, Think, Recall) directly into the interface, making the philosophy of knowledge work visible and actionable. Users tap a mode to switch contexts instantly; state persists across switches.

## Philosophy

The names **Ground, Capture, Think, Recall** are deliberate. They describe what users *do* rather than what the app *implements*:

| User Action | Internal Mode | Purpose |
|-------------|---------------|---------|
| **Ground** | home | Orient. See goals, recent activity, what matters today. |
| **Capture** | note | Record. Get fleeting thoughts into the vault quickly. |
| **Think** | discussion | Synthesize. Engage AI to process, question, connect. |
| **Recall** | browse | Retrieve. Navigate the vault to find and review. |

This vocabulary teaches the practice while using the app. The sigils (🪨🪶✨🪞) reinforce the metaphors: solid foundation, light writing tool, spark of insight, reflective surface.

## Capabilities

- **Switch modes**: Tap any segment to change the active mode
- **See current mode**: Selected segment has distinct visual treatment (gradient, glow, bold text)
- **Disable navigation**: Pass `disabled` prop to prevent mode changes during critical operations
- **Touch-friendly targets**: 44px minimum height meets accessibility guidelines

## Entry Points

| Entry | Type | Handler |
|-------|------|---------|
| Always visible in header | Component | `nextjs/components/shared/ModeToggle.tsx` |
| Mode state | Context | `nextjs/contexts/SessionContext.tsx` |

## Implementation

### Files Involved

| File | Role |
|------|------|
| `nextjs/components/shared/ModeToggle.tsx` | Component rendering and click handling |
| `nextjs/components/shared/ModeToggle.css` | Styles: glass morphism, selected state, sigil treatment |
| `nextjs/contexts/SessionContext.tsx` | Mode state via `useReducer` pattern |
| `nextjs/contexts/session/types.ts` | `AppMode` type definition |
| `nextjs/app/page.tsx` | Renders `ModeToggle` in header, conditionally renders mode views |

### Data

- **AppMode**: Union type `"home" | "note" | "discussion" | "browse"`
- Mode is stored in React state only (not persisted to localStorage or server)
- Switching modes does not clear other mode's state (browser path, messages, etc.)

### Mode Options

Defined in `ModeToggle.tsx`:

```typescript
const modes: ModeOption[] = [
  { value: "home", label: "Ground", sigil: "🪨" },
  { value: "note", label: "Capture", sigil: "🪶" },
  { value: "discussion", label: "Think", sigil: "✨" },
  { value: "browse", label: "Recall", sigil: "🪞" },
];
```

### Visual Design

- **Container**: Glass morphism with blur backdrop
- **Segments**: Flex row, equal width, 4px gap
- **Selected state**: Gradient background (`--gradient-tertiary`), glow shadow, bold text
- **Sigil**: Large (2.25rem), blurred, low opacity watermark behind label
- **Hover**: Text lightens on non-selected segments
- **Active**: Subtle scale-down on press

### Accessibility

- `role="tablist"` on container
- `role="tab"` on each segment
- `aria-selected` reflects current mode
- `aria-label="Application mode"` for screen readers
- Disabled state uses `disabled` attribute

## Connected Features

| Feature | Relationship |
|---------|-------------|
| [Home Dashboard](./home-dashboard.md) | Ground mode content |
| [Capture](./capture.md) | Capture mode content |
| [Think](./think.md) | Think mode content |
| [Recall](./recall.md) | Recall mode content |
| [Configuration](./_infrastructure/configuration.md) | Header layout context |

## Diagrams

- [GCTR Mode Transitions](../diagrams/gctr-mode-transitions.md) - All mode switches and contextual transitions with data flow

## Notes

**Why not tabs?** The component uses `role="tablist"` for accessibility but isn't a traditional tabbed interface. Each "tab" leads to a completely different experience with its own state model. The shared vocabulary and persistent navigation create cohesion.

**State isolation**: Switching from Think to Recall and back preserves your conversation. Switching to Capture and back preserves your browser position. This lets users flow between modes without losing context.

**Mobile-first**: The 44px touch targets and collapsible header (handled in `App.tsx`) ensure the navigation works well on phones, which is the primary use case for Memory Loop.

**No persistence**: Mode is not saved to localStorage. On page refresh, users return to Ground. This is intentional: Ground is designed as the starting point to orient before diving into work.
