---
custom_directories:
  commissions: [completed, abandoned]
  meetings: [open, closed, deferred]
  bugs: [open, resolved, wontfix]
  reviews: [complete]

filename_exemptions:
  - "^commission-.+-\\d{8}-\\d{6}\\.md$"
  - "^audience-.+-\\d{8}-\\d{6}.*\\.md$"
  - "^meeting-request-\\d{8}-\\d{6}-.+\\.md$"

custom_fields:
  commissions: [worker, workerDisplayTitle, prompt, dependencies, linked_artifacts, type]
  meetings: [worker, workerDisplayTitle, workerPortraitUrl, agenda, deferred_until, meeting_log, linked_artifacts]
---

# Project Lore Configuration

This file tells `/tend` what's intentional about this project's `.lore/` structure.

## Non-Standard Directories

- **commissions/**: Guild Hall agent work records. Machine-generated filenames with timestamps.
- **meetings/**: Guild Hall audience and meeting records. Machine-generated filenames with timestamps.
- **bugs/**: Bug tracking documents.
- **reviews/**: Spec validation reviews.

## Filename Patterns

Commission and meeting files use `{type}-{Agent}-{YYYYMMDD}-{HHMMSS}.md` naming with timestamps as unique identifiers. These are exempt from kebab-case and date-in-filename checks.
