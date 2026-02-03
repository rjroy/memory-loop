---
description: Evening reflection that closes the bookend with morning prep, or quick capture if no prep exists
argument-hint: [date: today|yesterday|YYYY-MM-DD]
---

Focus date: $ARGUMENTS (default: today)

This command has two modes based on whether a daily prep file exists for the focus date.

## Mode Detection

First, check for a prep file at `{inboxPath}/daily-prep/YYYY-MM-DD.md` (where YYYY-MM-DD is the focus date).

- **Prep file exists** → Run Closure Flow (complete the bookend)
- **No prep file** → Run Standard Debrief (quick capture)

---

## Closure Flow (Prep Exists)

The morning prep created a contract. Evening closure evaluates it.

### 1. Load Context

Read the prep file and extract:
- Energy level and calendar shape from morning
- Commitment items (the `commitment` array in frontmatter)

Present this context to the user:

```
This morning you felt [energy] with a [calendar] calendar.

You committed to:
1. [commitment 1]
2. [commitment 2]
3. [commitment 3]

Let's see how it went.
```

### 2. Collect Assessments

For each commitment item, use AskUserQuestion to collect the assessment:

```
Question: "How did '[commitment text]' go?"
Options:
- Done: Completed as intended
- Partial: Started but not finished
- Blocked: Could not proceed (external factors)
- Skipped: Intentionally not done (priorities changed)
```

After each selection, if the assessment is Partial, Blocked, or Skipped, ask a brief follow-up:

```
Question: "Any context to capture?"
Options:
- [Let them type freeform via "Other"]
```

This captures the optional `note` field for the commitment item.

### 3. Gather Reflection

After all assessments are collected, ask for overall reflection:

```
"What else should you remember about today? Any pivots, surprises, or lessons?"
```

Allow freeform response. Keep it conversational, not interrogative.

### 4. Update Prep File

Read the existing prep file, then update it with closure data:

**Frontmatter updates:**
- Set `assessment` for each commitment item (lowercase: done, partial, blocked, skipped)
- Add `note` fields where user provided context
- Add `closure.completed_at` with current ISO 8601 timestamp
- Add `closure.reflection` with user's reflection text

**Markdown body updates:**
Append an Evening section:

```markdown
## Evening

**What Happened**:
- [Commitment 1]: [Assessment]. [Note if provided]
- [Commitment 2]: [Assessment]. [Note if provided]

**Reflection**: [User's reflection text]
```

Write the updated file back to the same path.

### 5. Confirm and Close

Briefly confirm the closure:

```
"Captured. Your [energy] morning led to [summary of outcomes]. See you tomorrow."
```

Keep it short. The value is in the capture, not the summary.

---

## Standard Debrief (No Prep)

Quick, focused conversation (5-10 minutes) to capture the 1-2 most important things to remember. Not comprehensive documentation.

### 1. Gather Context

Before asking questions, review:
- Today's daily note
- Notes modified today
- Project activity

### 2. Ask 2-3 Focused Questions

Start with ONE opening question based on what you found:
- "What was the most significant moment in [specific meeting]?"
- "I see you worked on [project] - what actually moved forward?"
- "What changed your thinking today?"

Follow up based on responses:
- Person mentioned → "What did they do/say that mattered?"
- Decision mentioned → "What made that clear?"
- Blocker mentioned → "What's the next step there?"

Close with ONE forward-looking question:
- "What's the one thing you need to carry forward tomorrow?"
- "What's still unresolved that matters?"

### 3. Adapt and Exit

- Brief answers → ONE clarifying follow-up, then move on
- Short or tired responses → wrap up immediately
- **After 3-4 questions total, move to capture**

Exit signals: "That's it", "I'm done", short answers to 2+ questions. When you see these, immediately capture and confirm done.

### 4. Capture

Add to the daily note:
- **Key Moment**: The one thing worth remembering
- **For Tomorrow**: Critical follow-up (if any)

---

## Guidelines

**Closure Flow:**
- Do: Show the morning context, collect assessments systematically
- Don't: Re-interrogate about every detail; assessments are enough

**Standard Debrief:**
- Do: Reference specific things you discovered. Keep it conversational.
- Don't: Ask generic "how was your day" questions. Turn this into comprehensive review.

## Example: Closure Flow

```
Claude: This morning you felt steady with a scattered calendar.

You committed to:
1. Review Roman's PR with real feedback
2. Revisit auth ADR from last week
3. TTS spec response to Ryan

Let's see how it went.

[AskUserQuestion: How did "Review Roman's PR" go?]

User selects: Done

[AskUserQuestion: How did "Revisit auth ADR" go?]

User selects: Partial

Claude: Any context to capture?

User: Started but got pulled into TTS escalation

[AskUserQuestion: How did "TTS spec response" go?]

User selects: Blocked

Claude: Any context to capture?

User: Waiting on EGSM requirements

Claude: What else should you remember about today?

User: Roman's PR was better than expected. Good code.

Claude: [Updates prep file with closure data]

Captured. Your steady morning led to one done, one partial, one blocked. See you tomorrow.
```

## Example: Standard Debrief

```
Claude: I see you had a 1-on-1 with Sarah today. What was significant about it?

User: She raised concerns about QA bandwidth for Group DMs.

Claude: Is that a real risk?

User: Yeah. We might need to push the timeline.

Claude: What's the next step?

User: Talk to Mark tomorrow about realistic QA capacity.

Claude: Got it - Sarah's QA concern, follow up with Mark tomorrow. Captured. Done!
```

Three questions, ~5 minutes. If shorter answers came earlier, wrap up earlier.
