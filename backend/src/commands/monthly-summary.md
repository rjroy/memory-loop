---
allowed-tools: [Read, Write, Bash]
description: Generate a monthly summary and open tasks report from periodic notes.
argument-hint: (optional) [YEAR] [MONTH]
---

# /monthly-summary

Generate a monthly summary and open tasks report from periodic notes.

If no arguments provided, uses the current month.

## Task
Analyze the user's Obsidian notes for the specified month and create two reports:

1. **Open Tasks Report**: Find all uncompleted tasks (lines starting with `- [ ]`)
2. **Monthly Summary**: Synthesize the month's activities, completed work, and key themes

## Task Markers Reference
**CRITICAL**: Understand these task markers to correctly identify task status:
- `- [ ]` - Open task (INCLUDE in Open Tasks report)
- `- [>]` or `- [<]` - Forwarded task (EXCLUDE from reports - has been moved elsewhere)
- `- [x]` - Completed task (include in summary, not in open tasks)
- `- [-]` or `- [/]` - Canceled task (mention in summary if relevant)

### Examples:
- INCLUDE in Open Tasks: `- [ ] Review document`
- EXCLUDE from Open Tasks: `- [>] Review document` (forwarded elsewhere)
- EXCLUDE from Open Tasks: `- [<] Review document` (forwarded elsewhere)
- EXCLUDE from Open Tasks: `- [x] Review document [completion:: 2024-04-15]` (completed)

## Instructions

1. **Find relevant files**:
   - Look for daily notes matching pattern `YYYY-MM-DD.md` for the specified month
   - Look for meeting specific notes matching pattern `YYYY-MM-DD XXXXXX.md` for the specified month
   - Include weekly notes that overlap with the month (pattern `YYYY-WXX.md`)
   - Include the monthly note if it exists (pattern `YYYY-MM.md`)
   - Search in these locations:
     - `00_Inbox/` (and subdirectories)

2. **Extract Open Tasks** (CRITICAL - Check task markers carefully):
   - Find all lines that start with `- [ ]` (open checkbox)
   - **NEVER include** forwarded tasks (`- [>]`) - these have been moved elsewhere
   - **NEVER include** forwarded tasks (`- [<]`) - these have been moved elsewhere
   - **PLEASE** NEVER include forwarded tasks. Including them makes the data useless.
   - **NEVER include** completed tasks (`- [x]`) - these are done
   - **NEVER include** canceled tasks (`- [-]` or `- [/]`) - these were abandoned
   - Note the file and heading context for each task
   - Group by file or topic for better organization
   - Validate each task marker before including
   - It's possible there are no open tasks!

3. **Generate Summary**:
   - Look for key sections like "Goals", "Highlights", "Accomplishments"
   - Identify completed tasks (marked with `- [x]` and often have `[completion:: YYYY-MM-DD]`)
   - Note canceled tasks (`- [-]` or `- [/]`)
   - Skip forwarded tasks (`- [>]`) as they've been moved elsewhere
   - Skip forwarded tasks (`- [<]`) as they've been moved elsewhere
   - Extract meeting notes and interactions (people mentioned in `[[brackets]]`)
   - Identify recurring themes or focus areas
   - Note all major decisions, commitments, surprises, and patterns

4. **Adapt to note structure**:
   - Don't assume fixed headings - intelligently parse whatever structure exists
   - Handle variations in task markers and metadata
   - Work with incomplete or "poor" notes by extracting what's available
   - Recognize different note-taking styles across time periods

5. **Create reports**:
   - Save reports in `00_Inbox/Monthly_Reports/` as:
     - `YYYY-MM_OpenTasks.md`
     - `YYYY-MM_Summary.md`
   - Format reports in clean Markdown with appropriate headings
   - Include generation timestamp and file counts

## Key Principles
- Be flexible with note formats and evolving structures
- Prioritize extracting meaningful information over perfect parsing
- Group and organize information logically
- Provide context for tasks and activities
- Highlight patterns and connections across the month
