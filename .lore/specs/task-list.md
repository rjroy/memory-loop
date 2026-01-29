# Feature: Task List

## What It Does

Task List is an alternative view within the Recall tab that displays markdown tasks from across your vault. Instead of navigating a file tree, you see all actionable items grouped by source file, with the ability to toggle completion state directly from the list.

**Tab**: Fourth in toolbar: `[ Ground ][ Capture ][ Think ][ Recall ]`
**Internal mode**: `"browse"` with `viewMode: "tasks"`

## Entry Point

Click the "Files" header in the Recall tree pane to toggle to "Tasks" view.

```
┌─────────────┬───────────────────────┐
│  Tree Pane  │   Viewer Pane         │
│             │                       │
│  [Tasks] ♻  │  (unchanged)          │
│             │                       │
│  ▾ Inbox    │                       │
│    📄 file  │                       │
│  ▾ Projects │                       │
│    📄 file  │                       │
│             │                       │
└─────────────┴───────────────────────┘
```

## Capabilities

- **View all tasks**: See tasks from inbox, projects, and areas in one list
- **Toggle completion**: Click checkbox indicator to mark tasks complete/incomplete
- **Extended states**: Right-click (or long-press on mobile) for special states
- **Hide completed**: Filter out finished tasks
- **Navigate to source**: Click task text to open the source file in viewer
- **Grouped by file**: Tasks organized by their source file with rollup counts

## Task Discovery

### Source Directories

Tasks are discovered from three PARA directories:

| Directory | Config Key | Default |
|-----------|------------|---------|
| Inbox | `inboxPath` | `00_Inbox/` |
| Projects | `projectPath` | `01_Projects/` |
| Areas | `areaPath` | `02_Areas/` |

Directories are scanned recursively for `.md` files.

### Task Format

Standard markdown checkbox syntax with extended states:

```markdown
- [ ] Incomplete task
- [x] Complete task
- [/] Partial progress
- [?] Needs more information
- [b] Bookmarked (📍)
- [f] Urgent/flagged (🔥)
```

**Regex**: `/^(\s*- \[)(.)(] .+)$/`

Captures indentation, state character, and task text.

### State Indicators

| State | Character | Display | Meaning |
|-------|-----------|---------|---------|
| Incomplete | ` ` | ☐ | Not started |
| Complete | `x` | ☑ | Done |
| Partial | `/` | ◐ | In progress |
| Needs info | `?` | ? | Blocked on information |
| Bookmarked | `b` | 📍 | Saved for later |
| Urgent | `f` | 🔥 | High priority |

## Interaction

### Left-Click Toggle

Simple toggle between incomplete and complete:
- `[ ]` → `[x]`
- Any other state → `[ ]`

### Context Menu (Right-Click / Long-Press)

Access special states via context menu:
- Partial (`/`)
- Needs info (`?`)
- Bookmarked (`b`)
- Urgent (`f`)

Long-press threshold: 500ms (mobile convention)

### Backend Cycle

When toggling via API with no `newState` specified, cycles through all states:
`[ ]` → `[x]` → `[/]` → `[?]` → `[b]` → `[f]` → `[ ]`

## Display Structure

```
┌─────────────────────────────────────┐
│ ☐ Hide completed        12 / 45    │  ← Header with toggle and total count
├─────────────────────────────────────┤
│ ▾ Inbox                   3 / 8    │  ← Category header with count
│   ▾ 📄 daily-note.md      2 / 5    │  ← File group with rollup
│     ☐ Buy groceries                 │
│     ☑ Call mom                      │
│     🔥 Submit report                │
│   ▾ 📄 other.md           1 / 3    │
│     ...                             │
├─────────────────────────────────────┤
│ ▾ Projects               ...       │
│   ...                               │
└─────────────────────────────────────┘
```

### Sorting

1. Categories in fixed order: Inbox → Projects → Areas
2. Files within category sorted by modification time (newest first)
3. Tasks within file sorted by line number

### Counts

- **Total count** (header): completed / total across all tasks
- **Category count**: completed / total within category
- **File count**: completed / total within file

Count only considers `[x]` as "completed" for numerator.

## Hide Completed Toggle

- Checkbox in header filters out all `[x]` tasks
- State persists in component (not localStorage in current implementation)
- Counts update to reflect filtered view

## Implementation

### Files Involved

| File | Role |
|------|------|
| `frontend/src/components/browse/TaskList.tsx` | Main component (672 lines) |
| `frontend/src/components/browse/TaskList.css` | Styling |
| `frontend/src/components/browse/BrowseMode.tsx` | Container, view toggle |
| `frontend/src/hooks/useHome.ts` | REST client (`getTasks`, `toggleTask`) |
| `backend/src/task-manager.ts` | Task discovery and parsing |
| `backend/src/routes/home.ts` | REST endpoints |
| `shared/src/protocol.ts` | `TaskEntry`, `TaskCategory` schemas |

### REST API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/vaults/:id/tasks` | Fetch all tasks with metadata |
| `PATCH /api/vaults/:id/tasks` | Toggle task state |

**GET Response**:
```json
{
  "tasks": [
    {
      "text": "Buy groceries",
      "state": " ",
      "filePath": "00_Inbox/daily.md",
      "lineNumber": 5,
      "fileMtime": 1706450400000,
      "category": "inbox"
    }
  ],
  "incomplete": 12,
  "total": 45
}
```

**PATCH Request**:
```json
{
  "filePath": "00_Inbox/daily.md",
  "lineNumber": 5,
  "newState": "x"  // optional: omit to cycle
}
```

**PATCH Response**:
```json
{
  "filePath": "00_Inbox/daily.md",
  "lineNumber": 5,
  "newState": "x"
}
```

### Optimistic Updates

1. User clicks toggle
2. UI immediately updates state (optimistic)
3. API call fires in background
4. On success: state confirmed
5. On error: rollback to original state, show error

Pending toggles tracked in `pendingTaskTogglesRef` for rollback.

### View Mode Toggle

`BrowseMode` maintains `viewMode` state:
- `"files"` → FileTree component
- `"tasks"` → TaskList component

Toggle via clicking the header text ("Files" or "Tasks").

## Connected Features

| Feature | Relationship |
|---------|-------------|
| [Recall](./recall.md) | Shares the Recall tab, same tree pane location |
| [Configuration](./_infrastructure/configuration.md) | `projectPath`, `areaPath` settings |

## Notes

- Tasks load on-demand when switching to Tasks view (not pre-fetched)
- File groups are collapsible (click chevron)
- Category sections are collapsible (click category header)
- Touch targets meet 44px minimum (mobile accessibility)
- Context menu auto-positions to stay within container bounds
- Reload button (♻) refreshes both file tree and task list
