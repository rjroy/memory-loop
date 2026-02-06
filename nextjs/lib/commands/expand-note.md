---
description: Expand raw meeting notes into coherent documentation
argument-hint: <file-path>
---

File to expand: $ARGUMENTS

Transform raw timestamped meeting notes into coherent documentation. The goal is to capture what actually occurred, not to generate new insight.

## Process

### 1. Read the Meeting Note

Start by reading the file at the provided path. Understand:
- The meeting title and date from frontmatter
- The raw captures in the ## Capture section
- Any existing structure beyond captures

### 2. Gather Context (Optional)

If captures reference unclear terms or projects, briefly explore:
- CLAUDE.md for vault context and goals
- Related notes that might clarify acronyms or project names
- Recent daily notes if timing context helps

Spend no more than 1-2 minutes on context. If something is unclear, ask rather than assume.

### 3. Ask Clarifying Questions

Before expanding, ask 2-4 focused questions about gaps in the notes:
- "Who was [name] you mentioned?"
- "What does [acronym] stand for?"
- "The note says 'decided X' - what was the alternative?"
- "What was the outcome of the [topic] discussion?"

Do NOT ask about:
- Things already clear in the notes
- Future actions (those come from capture, not invention)
- Your interpretation of what they "should" do next

### 4. Expand the Notes

After getting answers, rewrite the ## Capture section into coherent prose or structured notes:
- Group related items thematically
- Connect timestamps only when sequence matters
- Fill gaps with what the user told you
- Preserve exact decisions, names, and facts from the captures

The expanded notes should read like meeting minutes, not a transcript.

### 5. Confirm and Save

Show the expanded version and ask for approval before saving. Make clear what you changed.

## Time Budget

Total: 5 minutes maximum

- Reading and context: 1-2 minutes
- Questions: 1-2 minutes
- Expansion and save: 1-2 minutes

If the user gives short answers, wrap up faster. If they want to discuss, that's fine, but don't drag out the process.

## Guidelines

**Do:**
- Preserve the user's voice and terminology
- Ask about unclear references before guessing
- Group captures into logical sections
- Keep original timestamps if they add value

**Don't:**
- Invent action items or insights not in the captures
- Add your own analysis or recommendations
- Restructure the entire document (focus on ## Capture)
- Ask more than 4 questions

## Example

**Before (## Capture):**
```
- [10:00] sarah raised qa concern
- [10:05] might need to push timeline
- [10:12] mark has capacity info
- [10:15] decided to check w mark first
- [10:20] also need to update stakeholders
```

**After questions:** "Who is Sarah? What's the QA concern about? What timeline?"

**After (## Meeting Notes):**
```
## Key Discussion

Sarah (QA Lead) raised concerns about testing bandwidth for the Group DMs feature. The current timeline may not be realistic given QA capacity.

## Decision

Check with Mark about actual QA capacity before committing to timeline changes. Once we have that information, update stakeholders on any schedule impacts.

## Attendees Context
- Sarah: QA Lead, raised the capacity concern
- Mark: Has visibility into QA team bandwidth
```
