---
title: Capture Feature
date: 2026-01-28
status: current
tags: [capture, daily-notes, meeting-mode, gctr]
modules: [note-capture, meeting-capture]
---

# Feature: Capture

## What It Does

Capture is a quick note-taking interface for jotting down thoughts throughout the day. Notes are timestamped and appended to daily files in your vault's inbox.

**Tab**: Second in toolbar: `[ Ground ][ Capture ][ Think ][ Recall ]`
**Internal mode**: `"note"`

## User Flow

```
1. Open Capture tab
2. Type a thought
3. Press Enter (desktop) or tap "Capture Note"
4. Note saved to daily file with timestamp
5. Toast confirms: "Note saved at 14:23"
6. Textarea clears, ready for next capture
```

## Capabilities

- **Quick capture**: Type and submit with Enter (desktop)
- **Timestamped entries**: Each note gets `[HH:MM]` prefix
- **Daily files**: Notes go to `{inbox}/YYYY-MM-DD.md`
- **Draft auto-save**: Unsaved text persists across page refreshes
- **Meeting mode**: Route captures to a dedicated meeting file
- **Retry on failure**: Automatic retries with exponential backoff

## Daily Note Format

**Location**: `{vault}/{inboxPath}/YYYY-MM-DD.md`

```markdown
# 2026-01-28

## Capture

- [09:15] Morning standup: discussed auth refactor timeline
- [11:42] Remember to follow up with Sarah about QA capacity
- [14:23] Idea: add keyboard shortcuts to capture mode
```

New captures append to the `## Capture` section. If the file doesn't exist, it's created with the template.

## Keyboard Behavior

| Platform | Enter | Shift+Enter |
|----------|-------|-------------|
| Desktop | Submit | New line |
| Mobile | New line | New line |

Mobile is detected via `matchMedia("hover: none")`. This ensures touch users can create multi-line notes without accidentally submitting.

## Meeting Mode

An alternative capture destination for focused note-taking during meetings.

### Starting a Meeting

1. Click "Start Meeting" button
2. Enter meeting title (e.g., "Q3 Planning with Sarah")
3. Captures now route to: `{inbox}/meetings/YYYY-MM-DD-{slug}.md`

### During a Meeting

- Status bar shows meeting title with pulsing indicator
- Placeholder shows: "Capturing to: Q3 Planning with Sarah"
- Submit button becomes: "Add Note"
- Meeting state persists across page refreshes

### Stopping a Meeting

1. Click "Stop Meeting"
2. Toast shows: "Meeting ended: 12 notes captured"
3. Auto-navigates to Think tab with `/expand-note {filePath}` prefilled
4. User can immediately expand raw captures into structured notes

### Meeting File Format

```markdown
---
date: 2026-01-28
title: "Q3 Planning with Sarah"
attendees: []
---

# Q3 Planning with Sarah

## Capture

- [14:23] Sarah raised concern about QA capacity
- [14:25] May need to push timeline by 2 weeks
```

## Implementation

### Files Involved

| File | Role |
|------|------|
| `frontend/src/components/capture/NoteCapture.tsx` | Main UI component |
| `frontend/src/hooks/useCapture.ts` | REST API client |
| `frontend/src/hooks/useMeetings.ts` | Meeting operations |
| `backend/src/note-capture.ts` | Daily note logic |
| `backend/src/meeting-capture.ts` | Meeting note logic |
| `backend/src/routes/capture.ts` | Capture endpoint |
| `backend/src/routes/meetings.ts` | Meeting endpoints |
| `backend/src/meeting-store.ts` | Meeting state |

### API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/vaults/:id/capture` | Submit a capture |
| POST | `/api/vaults/:id/meetings` | Start meeting mode |
| DELETE | `/api/vaults/:id/meetings/current` | Stop meeting mode |
| GET | `/api/vaults/:id/meetings/current` | Check active meeting |

### Capture Request/Response

**Request**:
```json
{ "text": "Remember to follow up with Sarah" }
```

**Response**:
```json
{
  "success": true,
  "timestamp": "2026-01-28T14:23:00.000Z",
  "notePath": "/vault/00_Inbox/2026-01-28.md"
}
```

### Draft Persistence

- localStorage key: `"memory-loop-draft"`
- Saves on every keystroke
- Restored on component mount
- Cleared on successful submission

### Retry Logic

- Max 3 retries on failure
- Exponential backoff: 1s, 2s, 4s
- Toast shows progress: "Failed, retrying... (2/3)"

## Recent Captures (Ground Tab)

Captures appear in the Recent Activity section on Ground:

1. Ground tab calls `GET /api/vaults/:id/recent-activity`
2. Backend reads daily note files, parses `## Capture` sections
3. Returns most recent entries (configurable via `recentCaptures` setting)
4. Each entry shows time, text, and "View" button to open in Recall

**Entry format**:
```typescript
{
  id: "2026-01-28-14:23-5",
  text: "Remember to follow up with Sarah",
  time: "14:23",
  date: "2026-01-28"
}
```

## Connected Features

| Feature | Relationship |
|---------|-------------|
| [Ground](./home-dashboard.md) | Shows recent captures |
| [Think](./think.md) | `/expand-note` processes capture files |
| [Recall](./recall.md) | "View" button opens daily note |
| [Configuration](./_infrastructure/configuration.md) | `recentCaptures` setting |

## Notes

- No file upload in Capture (exists elsewhere but not integrated here)
- No voice input/speech-to-text
- Meeting state stored server-side, survives WebSocket reconnects
- Section-based appending keeps captures separate from other daily note content
- Auto-growing textarea (starts at 3 rows) for better mobile UX
