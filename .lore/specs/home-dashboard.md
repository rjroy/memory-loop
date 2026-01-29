# Feature: Ground (Home Dashboard)

## What It Does

Ground is the landing view when users open Memory Loop (the first tab in the `[ Ground ][ Capture ][ Think ][ Recall ]` toolbar). It provides at-a-glance context for the current vault and surfaces actionable items: cards to review, prompts to consider, goals to reflect on, and recent activity to resume.

This is a **container feature**. It orchestrates widgets from several sub-features and provides navigation affordances to the other tabs.

## Capabilities

- **View vault context**: See current vault name, subtitle, and any health issues
- **Review spaced repetition cards**: Answer questions, assess recall, advance through queue
- **See daily inspiration**: Contextual prompt (weekdays) and motivational quote
- **View goals**: Rendered markdown from vault's goals file
- **Browse recent activity**: Recent captures and discussions with quick resume/view actions
- **Trigger debriefs**: Buttons to start daily/weekly/monthly reflection in Discussion mode

## Entry Points

| Entry | Type | Handler |
|-------|------|---------|
| Mode = "home" | Frontend routing | `frontend/src/App.tsx:243` |
| Tab click | UI | `frontend/src/components/shared/ModeToggle.tsx` |
| GET /api/vaults/:id/goals | REST | `backend/src/routes/home.ts:84` |
| GET /api/vaults/:id/inspiration | REST | `backend/src/routes/home.ts:108` |
| GET /api/vaults/:id/tasks | REST | `backend/src/routes/home.ts:146` |

## Implementation

### Files Involved

| File | Role | Lines |
|------|------|-------|
| `frontend/src/components/home/HomeView.tsx` | Main orchestrator | 282 |
| `frontend/src/components/home/GoalsCard.tsx` | Goals markdown display | 70 |
| `frontend/src/components/home/HealthPanel.tsx` | Backend issues display | 172 |
| `frontend/src/components/home/RecentActivity.tsx` | Captures and discussions | 328 |
| `frontend/src/hooks/useHome.ts` | Goals, inspiration, tasks API | - |
| `frontend/src/hooks/useCapture.ts` | Recent activity fetching | - |
| `frontend/src/hooks/useSessions.ts` | Session operations | - |
| `backend/src/routes/home.ts` | REST endpoints | 236 |
| `backend/src/vault-manager.ts` | Goals file reading | - |

### Data

**From SessionContext (global state):**
- `vault` - Current vault info (name, subtitle, paths, config)
- `recentNotes` - Recent capture entries with date/text/time
- `recentDiscussions` - Recent sessions with preview/message count
- `goals` - Goals markdown content
- `health` - Backend health issues

**From vault filesystem:**
- `vault.goalsPath` - Markdown file with user's goals

### Widget Visibility Rules

| Widget | Shown When |
|--------|-----------|
| Daily Debrief button | Today's date appears in `recentNotes` |
| Weekly Debrief button | Friday through Sunday |
| Monthly Summary button | Last 3 or first 3 days of month |
| GoalsCard | `vault.goalsPath` exists and has content |
| HealthPanel | `health.issues.length > 0` |
| RecentActivity | Any recent notes or discussions exist |

### Navigation Actions

| Action | Target Mode | Prefill |
|--------|-------------|---------|
| Debrief button click | Discussion | `/daily-debrief`, `/weekly-debrief`, or `/monthly-summary` |
| Quote/prompt click | Discussion | Inspiration text |
| Goals card click | Discussion | `/review-goals` |
| View capture | Browse | Daily note file path |
| Resume discussion | Discussion | Restores session by ID |

## Connected Features

| Feature | Relationship | Spec |
|---------|-------------|------|
| [Spaced Repetition](./spaced-repetition.md) | Widget embedded in Ground | Not yet documented |
| [Inspiration](./inspiration.md) | Widget embedded in Ground | Not yet documented |
| [Capture](./capture.md) | Tab: recent captures displayed here | Not yet documented |
| [Think](./think.md) | Tab: debrief buttons navigate here | Not yet documented |
| [Recall](./recall.md) | Tab: view capture navigates here | Not yet documented |

## Notes

- Home loads data via REST API on mount, not WebSocket (migrated in TASK-010/011)
- Error handling uses graceful degradation for inspiration (fallback quote on failure)
- SpacedRepetitionWidget is the most complex component (558 lines) and warrants its own spec
- Recent Activity fetches on mount but doesn't auto-refresh; data can become stale
