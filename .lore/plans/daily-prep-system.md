---
title: Daily Prep System Implementation Plan
date: 2026-02-02
status: executed
tags: [skill-development, ui-component, rest-api, ground-tab]
modules: [daily-prep-manager, session-actions-card, home-view, daily-prep-skill]
related: [.lore/specs/daily-prep.md]
---

# Daily Prep System Implementation Plan

**Spec**: `.lore/specs/daily-prep.md` (approved)
**Branch**: `feat/daily-prep`

## Overview

Bookend planning system: morning commitment + evening closure. Ground tab restructure with REST endpoint for prep status.

## Phases

### Phase 1: REST Endpoint

**New files:**
- `backend/src/daily-prep-manager.ts` - Read/parse prep files
- `backend/src/routes/daily-prep.ts` - `GET /daily-prep/today` endpoint
- `backend/src/__tests__/daily-prep-manager.test.ts`
- `backend/src/__tests__/routes-daily-prep.test.ts`

**Modify:**
- `backend/src/routes/index.ts` - Register route

**Endpoint response:**
```typescript
{ exists: boolean, commitment?: string[], energy?: string, calendar?: string }
```

**File path:** `{contentRoot}/{inboxPath}/daily-prep/YYYY-MM-DD.md`

---

### Phase 2: Ground Tab Restructure

**New files:**
- `frontend/src/components/home/VaultInfoCard.tsx` - Name + subtitle only
- `frontend/src/components/home/SessionActionsCard.tsx` - Buttons + commitment
- `frontend/src/components/home/SessionActionsCard.css`
- Tests for both components

**Modify:**
- `frontend/src/hooks/useHome.ts` - Add `getDailyPrepStatus()`
- `frontend/src/components/home/HomeView.tsx` - Use new cards
- `frontend/src/components/home/HomeView.css` - Two-card layout

**Layout:**
- Mobile: Stacked (Vault Info on top, Session Actions below)
- Tablet+: Side-by-side (Vault Info left, Session Actions right)

**Button logic:**
- No prep file → "Daily Prep" button
- Prep exists → "Daily Debrief" button
- Weekly/Monthly unchanged

---

### Phase 3: Daily Prep Skill

**Directory structure:**
```
backend/src/skills/daily-prep/
├── SKILL.md              # Core instructions (~1,500-2,000 words)
├── README.md             # Developer overview
└── references/
    └── file-format.md    # Detailed YAML frontmatter spec
```

**SKILL.md requirements (per plugin-dev:skill-development):**

1. **Frontmatter** - Third-person description with specific triggers:
```yaml
---
name: Daily Prep
description: This skill should be used when the user says "/daily-prep", "daily prep", "morning prep", "what should I focus on today", "plan my day", "start my day", or wants help deciding what to work on. Creates a morning commitment with energy/calendar context.
version: 0.1.0
---
```

2. **Writing style** - Imperative/infinitive form, NOT second person:
   - ✅ "To begin morning prep, use AskUserQuestion for energy level"
   - ❌ "You should ask the user about their energy level"

3. **Progressive disclosure** - Keep SKILL.md lean:
   - Core workflow in SKILL.md (~1,500-2,000 words)
   - Detailed file format spec in `references/file-format.md`
   - Reference vault-task-management skill for task queries

4. **Morning flow sections:**
   - Energy Check (AskUserQuestion: Sharp/Steady/Low)
   - Calendar Shape (AskUserQuestion: Clear/Scattered/Heavy)
   - Surfacing (reference vault-task-management, Grep recent captures)
   - Dialogue (allow corrections)
   - Commitment (1-3 items, suggest not enforce)
   - Save (Write tool to {inboxPath}/daily-prep/YYYY-MM-DD.md)

5. **Evening closure** - Document integration with /daily-debrief:
   - Check for prep file existence
   - Show commitment, collect assessments
   - Update file with closure data

**Validation checklist (from skill-development):**
- [x] Frontmatter has name and description
- [x] Description uses third person with trigger phrases
- [x] Body uses imperative form, not second person
- [x] SKILL.md is lean (<2,000 words)
- [x] References file-format.md for detailed spec
- [x] References vault-task-management skill

---

### Phase 4: Integration

- End-to-end manual testing
- Edge case handling (empty files, missing directories)
- Documentation updates

## Critical Files

| Purpose | Path |
|---------|------|
| Route pattern | `backend/src/routes/home.ts` |
| HomeView structure | `frontend/src/components/home/HomeView.tsx` |
| Hook pattern | `frontend/src/hooks/useHome.ts` |
| Skill reference | `backend/src/skills/vault-task-management/SKILL.md` |
| Card pattern | `frontend/src/components/home/GoalsCard.tsx` |

## Verification

Run after each phase:
```bash
bun run test
bun run typecheck
bun run lint
```

Manual verification:
1. Ground tab shows correct button based on prep file existence
2. `/daily-prep` creates file with correct format
3. `/daily-debrief` detects prep and offers closure
4. Commitment summary displays on Ground tab
5. Mobile layout stacks, desktop side-by-side
