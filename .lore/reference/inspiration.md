---
title: Inspiration Feature
date: 2026-01-28
status: current
tags: [inspiration, prompts, quotes, llm-generation]
modules: [inspiration-manager, inspiration-card]
---

# Feature: Inspiration

## What It Does

Inspiration displays contextual prompts and quotes on the Ground tab to spark reflection. Prompts are generated daily based on your notes; quotes are generated weekly. Click either to start a discussion.

## What Displays

| Item | Description | When Shown |
|------|-------------|------------|
| **Quote** | Inspirational quote with attribution | Always (fallback guaranteed) |
| **Contextual Prompt** | Reflection or creative question | When available (null on failure) |

Visual layout: Quote at top with attribution, prompt below without attribution. Both are clickable.

## Two Content Types

### Contextual Prompts (Daily)

**Weekday prompts** draw on your recent notes:
- "What progress did you make on the authentication refactor?"
- "You mentioned deadline pressure yesterday. How are you managing that?"

**Weekend prompts** are creative/imaginative (light context):
- "If you could redesign any everyday object, what would you change?"
- "What skill would you learn if time weren't a constraint?"

### Inspirational Quotes (Weekly)

Context-aware quotes relevant to your work:
- "Code is like humor. When you have to explain it, it's bad." -- Cory House
- "The only way to do great work is to love what you do." -- Steve Jobs

## Generation

### When Generation Happens

| Type | Trigger | Model |
|------|---------|-------|
| Contextual prompts | Daily (date changed) | Haiku |
| Quotes | Weekly (ISO week changed) | Haiku |

Generation is lazy: happens on first request after the trigger condition is met.

### Context Gathering

The system reads your vault to provide context:

| Day | Daily Notes | Extra Folder | Purpose |
|-----|-------------|--------------|---------|
| Monday | Past 7 days | Projects | Week-in-review |
| Tue-Thu | Yesterday only | None | Daily check-in |
| Friday | Mon-Fri | Areas | Week wrap-up |
| Weekend | None | Projects (light) | Creative exploration |

Context is truncated to ~3200 characters (newest content first).

### Prompt Templates

**Weekday reflection**:
```
Based on the user's notes, generate {count} thought-provoking prompts
that encourage reflection, action, or deeper thinking.
- Reference specific topics from the content
- Focus on actionable reflection
- Be encouraging and positive
```

**Weekend creative**:
```
Generate {count} creative prompts for weekend exploration.
- Focus on creativity, curiosity, play
- NOT about productivity or work
- Spark imagination
```

**Quotes**:
```
Generate {count} inspirational quotes relevant to themes in the user's notes.
- Draw from appropriate domains (tech leaders, authors, etc.)
- Quotes should feel personally applicable
- Include accurate attribution
```

## Storage

**Location**: `{vault}/{metadataPath}/`

| File | Content |
|------|---------|
| `contextual-prompts.md` | Daily prompts pool |
| `general-inspiration.md` | Weekly quotes pool |

**Format**:
```markdown
<!-- last-generated: 2026-01-28 -->

- "What progress did you make on the authentication refactor?"
- "You mentioned deadline pressure. How are you managing that?"
```

Quotes include attribution:
```markdown
- "Quote text here" -- Attribution
```

## Selection Logic

| Type | Algorithm | Rationale |
|------|-----------|-----------|
| Prompts | Weighted random (favors recent) | Recent prompts more relevant |
| Quotes | Uniform random | All quotes equally good |

Selection happens on every request from the full pool.

## User Interaction

When clicked:
1. Text copied to discussion prefill
2. Mode switches to Discussion
3. Input field pre-populated with prompt/quote
4. User can edit or send immediately

## Configuration

In `.memory-loop.json`:

```json
{
  "promptsPerGeneration": 5,    // 1-20, prompts per day
  "quotesPerWeek": 1,           // 0-7, quotes per week
  "maxPoolSize": 50             // 10-200, max items before pruning
}
```

Older items are pruned when pool exceeds `maxPoolSize`.

## Implementation

### Files Involved

| File | Role |
|------|------|
| `backend/src/inspiration-manager.ts` | Generation, parsing, selection |
| `backend/src/routes/home.ts` | REST endpoint |
| `frontend/src/components/home/InspirationCard.tsx` | Display component |
| `frontend/src/hooks/useHome.ts` | API client |

### API

**GET /api/vaults/:vaultId/inspiration**

Response:
```json
{
  "contextual": { "text": "...", "attribution": null },
  "quote": { "text": "...", "attribution": "Source" }
}
```

`contextual` can be `null` (weekend with no prompts, generation failure).

### Fallback

Hardcoded fallback quote ensures response always succeeds:
```typescript
{
  text: "The only way to do great work is to love what you do.",
  attribution: "Steve Jobs"
}
```

Used when quote file missing, empty, or generation fails.

## Connected Features

| Feature | Relationship |
|---------|-------------|
| [Ground](./home-dashboard.md) | Widget lives in Ground tab |
| [Think](./think.md) | Click navigates here with prefilled text |
| [Configuration](./_infrastructure/configuration.md) | Pool size and generation counts |

## Notes

- Model is hardcoded to Haiku (cost-efficient for generation)
- Weekend prompts intentionally avoid productivity themes
- ISO week numbering used for weekly generation check
- Graceful degradation: failures logged but don't block response
