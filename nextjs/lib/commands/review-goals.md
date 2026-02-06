---
description: Review progress toward goals and update the goals file
---

Evaluate how well the user is progressing toward their goals, discuss it with them, and record the progress.

## Process

### 1. Read Goals and Determine Review Scope

First, read the goals file (typically at `06_Metadata/memory-loop/goals.md`).

Check for a `Last Reviewed: YYYY-MM-DD` line at the end of the file:

- **If found**: Review files modified since that date
- **If not found**: Ask the user:
  - "This appears to be your first goal review. Would you like a **comprehensive review** (I'll explore your vault broadly) or a **recent activity review** (focused on the last 2 weeks)?"

### 2. Gather Context

Based on the review scope, examine:

- Daily notes since last review (or within scope)
- Modified files in Projects and Areas directories
- Any notes that mention goals or goal-related keywords
- Completed tasks and accomplishments

Look for evidence of:
- Goals that have been achieved
- Progress toward ongoing goals
- New directions or shifting priorities
- Blockers or stalled efforts

### 3. Discuss Progress

Have a conversation about what you found. This is the core of the review.

**Opening questions based on findings:**
- "I see you've been working on [specific area]. How do you feel about your progress there?"
- "Your goal about [X] seems to have momentum. What's driving that?"
- "I noticed less activity around [goal]. Is that still a priority?"

**Dig into specifics:**
- "What moved forward that you're proud of?"
- "What's been harder than expected?"
- "Are any of these goals no longer relevant?"

**Forward-looking:**
- "Which goal needs the most attention going forward?"
- "Is there anything you want to add or change about your goals?"

### 4. Update the Goals File

When the user is ready, update `goals.md` with:

**For achieved goals:**
- Mark as complete or move to a "Completed" section
- Add a brief note about how/when it was achieved

**For goals with progress:**
- Add progress notes inline (e.g., "- Progress: [description]")
- Keep the goal active unless user says otherwise

**For stalled or deprioritized goals:**
- Discuss whether to keep, modify, or remove
- Note any blockers if keeping

**Always update the last line:**
```
Last Reviewed: YYYY-MM-DD
```

Use today's date in ISO format.

## Guidelines

**Do:**
- Reference specific evidence from notes and files
- Celebrate progress, even small wins
- Ask about goals that show no recent activity
- Let the user drive what gets updated

**Don't:**
- Judge or criticize lack of progress
- Assume goals are still relevant without asking
- Make changes without user confirmation
- Rush through the conversation

## Example

```
Claude: I've read your goals and looked at activity since your last review
on 2024-12-01. I see significant work in your "Learn Rust" project folder
and several daily notes mentioning the health goal. How do you feel about
your progress this month?

User: The Rust stuff is going well, I finished the book. Health has been
harder with the holidays.

Claude: Congrats on finishing the Rust book! That was a big goal. Should we
mark that complete and maybe set a follow-up goal? And for health - totally
understandable about the holidays. Want to keep that goal as-is or adjust it?

User: Yeah, mark Rust complete. For health, let's keep it but I want to be
more specific - focus on sleep schedule.

Claude: Got it. I'll update your goals: mark "Learn Rust fundamentals" as
complete with a note about finishing the book, and refine the health goal
to focus on sleep schedule. Sound right?

User: Perfect.

Claude: Done! I've updated goals.md with those changes and set today as the
last review date.
```
