---
title: Pair Writing Feature
date: 2026-01-28
status: current
tags: [pair-writing, ai-editing, quick-actions, advisory-actions]
modules: [pair-writing-mode, pair-writing-editor]
---

# Feature: Pair Writing

## What It Does

Pair Writing is an AI-assisted editing mode for markdown files. Select text, choose an action, and Claude either transforms it directly (Quick Actions) or provides feedback (Advisory Actions). The editor and conversation live side-by-side.

**Access**: "Pair Writing" button in Recall tab when viewing a markdown file
**Desktop only**: Hidden on mobile devices

## UI Layout

```
┌─────────────────────────────────────────────────────────┐
│ Toolbar: [path] [*unsaved] | [Snapshot] [Actions] [Save] [Exit] │
├─────────────────────────┬───────────────────────────────┤
│ Editor (50%)            │ Discussion (50%)              │
│                         │                               │
│ Your markdown file      │ Same session as Think tab     │
│ with text selection     │ Shows action history          │
│ and context menu        │ and Claude's responses        │
│                         │                               │
└─────────────────────────┴───────────────────────────────┘
```

## Two Action Types

### Quick Actions (Direct Transformation)

Claude edits the file directly using the Edit tool.

| Action | What Claude Does |
|--------|------------------|
| **Tighten** | Remove filler words, shorten while preserving meaning |
| **Embellish** | Add vivid details, enhance clarity, match existing tone |
| **Correct** | Fix spelling and grammar errors, don't change style |
| **Polish** | Improve flow and readability, preserve voice |

**Flow**:
1. Select text → Right-click → Choose action
2. Claude reads file, edits selection, writes back
3. Editor auto-reloads with changes
4. Action appears in conversation history

### Advisory Actions (Feedback Only)

Claude provides feedback in the conversation. You apply changes manually.

| Action | What Claude Does |
|--------|------------------|
| **Validate** | Check accuracy and correctness |
| **Critique** | Provide constructive feedback |
| **Compare** | Analyze differences from snapshot |
| **Discuss** | Open-ended conversation about selection |

**Flow**:
1. Select text → Right-click → Choose action
2. Claude responds in Discussion pane
3. You read feedback and edit manually
4. Manual edits tracked as "unsaved changes"

## Snapshot Feature

Capture selected text for later comparison.

1. Select text you want to remember
2. Click "Snapshot" in toolbar
3. Later, select different text
4. Choose "Compare to snapshot"
5. Claude analyzes what changed

**Constraints**:
- One snapshot at a time (new snapshot replaces old)
- Only captures selected text, not full file
- Cleared when you exit Pair Writing mode

## Shared Session

Pair Writing uses the **same session as Think tab**:
- Actions appear in conversation history
- Full context maintained across both interfaces
- Switch to Think tab and continue the conversation

This means Quick/Advisory Actions are visible in your conversation history alongside regular Think messages.

## User Flow

```
1. Open markdown file in Recall tab
2. Click "Pair Writing" button
3. Split-pane view appears
4. Select text in editor
5. Right-click → Choose action
6. Quick Action: File updates automatically
   Advisory Action: Read feedback, edit manually
7. Save manual changes
8. Exit when done
```

## Implementation

### Files Involved

| File | Role |
|------|------|
| `nextjs/components/pair-writing/PairWritingMode.tsx` | Main container |
| `nextjs/components/pair-writing/PairWritingEditor.tsx` | Text editor |
| `nextjs/components/pair-writing/PairWritingToolbar.tsx` | Controls |
| `nextjs/components/shared/EditorContextMenu.tsx` | Action menu |
| `nextjs/hooks/usePairWritingState.ts` | State (content, snapshot) |
| `nextjs/hooks/useTextSelection.ts` | Selection with context |
| `backend/src/pair-writing-prompts.ts` | Prompt templates |

### Action Delivery

Actions are formatted as chat messages and sent through the regular SSE chat stream (POST `/api/chat`). The component formats the action type, selected text, and surrounding context into a structured prompt, then sends it via `sendMessageRef`. Claude responds through the same SSE stream used for normal conversations.

**Server → Client**: Standard SSE streaming events (response_start, response_chunk, tool_start, etc.)

### SDK Configuration

| Setting | Quick Actions | Advisory Actions |
|---------|---------------|------------------|
| Tools | Read, Edit | None |
| Max turns | 10 | 1 |
| Budget | $0.50 | $0.25 |
| Permission mode | acceptEdits | N/A |

## Unsaved Changes

- Quick Action edits save automatically (Edit tool writes to disk)
- Manual edits in textarea track "unsaved changes"
- Toolbar shows `*` indicator when unsaved
- Exit prompts confirmation if unsaved changes exist
- Save button writes content via REST API

## Context Extraction

When you select text, the system captures:
- **Selection**: The text you highlighted
- **Context before**: One paragraph before selection
- **Context after**: One paragraph after selection
- **Line numbers**: Start/end line, total lines

This context helps Claude understand where the selection fits in the document.

## Connected Features

| Feature | Relationship |
|---------|-------------|
| [Recall](./recall.md) | Entry point, file viewing |
| [Think](./think.md) | Shared session, conversation history |

## Notes

- Desktop only (CSS hides button on mobile)
- Document gets `data-pair-writing="true"` attribute for layout CSS
- Editor reloads from disk after Quick Actions complete
- Snapshot is session-scoped (cleared on exit)
- Context menu also accessible via toolbar "Actions" button (accessibility)
- Long-press triggers context menu on touch devices
