---
argument-hint: [optional: yesterday|specific date in YYYY-MM-DD format]
---
# Daily Debrief

Quick, focused conversation (5-10 minutes) to capture what matters from today before moving on. If `$ARGUMENTS` is provided, focus on that day instead of today.

**Goal:** Identify the 1-2 most important things to remember, not comprehensive documentation.

## Process

Review context briefly, then ask focused questions to crystallize what matters:

### 1. Gather Context

Before asking questions, review:

- **Today's daily note** (`00_Inbox/YYYY-MM-DD.md`) - What did I capture?
- **Modified notes today** - What did I work on?
- **Calendar events** (if accessible) - What meetings happened?
- **Project activity** - What moved forward?

### 2. Ask 2-3 Focused Questions

Start with ONE opening question based on what you found, then follow up based on responses:

**Opening question (choose the most relevant):**
- "What was the most significant moment in [specific meeting you found]?"
- "I see you worked on [project] - what actually moved forward?"
- "What changed your thinking today?"

**Then follow up on what they share:**
- If they mention a person: "What did they do/say that mattered?"
- If they mention a decision: "What made that clear?"
- If they mention a blocker: "What's the next step there?"
- If they mention learning: "How does that change your approach?"

**Close with ONE forward-looking question:**
- "What's the one thing you need to carry forward tomorrow?"
- "Who do you need to follow up with?"
- "What's still unresolved that matters?"

### 3. Adapt Based on Responses

- If I give brief answers, ask ONE clarifying follow-up
- If I mention something significant, help me expand on why it matters
- If I'm tired or give short answers, move to closing - don't push
- **After 3-4 questions total, move to capture** - this should be quick

### 4. Capture What Matters

Add 1-3 key items to today's daily note:
- `## Key Moment` - The one thing worth remembering
- `## For Tomorrow` - Critical follow-up (if any)
- `## Quick Note` - Any other brief insight

## Guidelines

**DO:**
- Start with ONE specific question based on what you found
- Ask ONE follow-up if the answer needs depth
- Reference specific meetings, people, or work you discovered
- Keep it conversational and quick (target: 5-10 minutes)
- **Wrap up after 3-4 questions total** - resist going deeper

**DON'T:**
- Ask generic "how was your day" questions
- Ask more than 3-4 questions total
- Turn this into a therapy session or comprehensive review
- Force exploration if I give short answers - that's a signal to wrap up
- Generate summaries for me - draw them out through questions

**HOW TO END:**
The user can say any of these to signal they're done:
- "That's it" / "That's all" / "I think we're good"
- "Let's wrap up" / "I'm done"
- "Nothing else" / Short answers to 2+ questions in a row

When you see these signals: Immediately capture the key point(s) and confirm you're done.

## Example Flow (Short Version)

```
Claude: I see you had the Epic Social 39.00 sync and a 1-on-1 with Sarah today.
What was the most significant moment between those two?

Ron: The 1-on-1. Sarah raised concerns about the QA bandwidth for Group DMs.

Claude: How did that land for you - is it a real risk?

Ron: Yeah, I think she's right. We might need to push the timeline.

Claude: What's the next step there?

Ron: I need to talk to Mark tomorrow about realistic QA capacity.

Claude: Got it. So the key thing to remember is Sarah's QA concern, and you need
to follow up with Mark tomorrow about timeline implications. That capture it?

Ron: Yep, that's it.

Claude: Perfect. Captured in today's note. Done!
```

**Note:** Total of 3 questions, ~5 minutes. If Ron had given shorter answers or said
"that's it" earlier, Claude would have wrapped up immediately.

## Success Criteria

- **Quick:** Conversation took 5-10 minutes, max 3-4 questions
- **Focused:** Captured the 1-2 most important things, not everything
- **Easy to exit:** I could say "that's it" and you wrapped up immediately
- **Natural:** Felt like a quick check-in, not an interrogation
- **Useful:** The one key thing is now captured and won't be forgotten

---

**Note:** This is a LIGHT daily check-in (5-10 min). For deeper reflection:
- Use `/weekly-debrief` for weekly patterns and planning
- Use `/daily-review` for structured end-of-day processing
- Use `/weekly-synthesis` for comprehensive weekly analysis
