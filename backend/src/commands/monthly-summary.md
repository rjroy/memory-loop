---
description: Generate a monthly summary and open tasks report from periodic notes
argument-hint: [month: YYYY-MM or current]
---

Month: $ARGUMENTS (default: current month)

Generate two reports from the month's periodic notes:
1. **Open Tasks**: All uncompleted tasks (`- [ ]`)
2. **Monthly Summary**: Activities, completed work, key themes

## Task Markers

Only `- [x]` is completed. All other markers are open and should be included in the open tasks report:

| Marker | Meaning | Open Tasks | Summary |
|--------|---------|------------|---------|
| `- [ ]` | Open | ✓ Include | ✓ |
| `- [x]` | Completed | ✗ Exclude | ✓ |
| `- [f]` | Fire / Important | ✓ Include | ✓ |
| `- [?]` | Open Question | ✓ Include | ✓ |
| `- [b]` | Bookmark / Deferred | ✓ Include | ✓ |

## Process

1. **Find files**: Daily notes, weekly notes, meeting notes for the month
2. **Extract open tasks**: All non-`[x]` markers. Group by file/topic with context.
3. **Generate summary**: Completed work, themes, decisions, people, patterns
4. **Create reports**: Save as `YYYY-MM_OpenTasks.md` and `YYYY-MM_Summary.md`

## Guidelines

- Be flexible with note formats and structures
- Don't assume fixed headings; parse what exists
- It's possible there are no open tasks
- Highlight patterns and connections across the month
