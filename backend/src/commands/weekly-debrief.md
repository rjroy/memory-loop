---
description: Process and remember what was important this week through guided conversation.
argument-hint: [optional: last-week|specific week start date in YYYY-MM-DD format]
---
# /weekly-debrief

Help me process and remember what was important this week through guided conversation. If `$ARGUMENTS` is provided, focus on that week instead of the current week.

## Process

Review context sources first, then ask targeted questions to help me crystallize what matters from the week:

### 1. Gather Context

Before asking questions, review:

- **This week's daily notes** (`00_Inbox/YYYY-MM-DD.md`) - What did I capture each day?
- **Modified notes this week** - What projects/areas got attention?
- **Project progress** - What moved forward? What stalled?
- **Calendar patterns** (if accessible) - What types of meetings dominated?
- **Status updates** - What did I formally report on?

### 2. Ask Adaptive Questions

Based on what you find, ask questions to:

**Identify the through-line:**
- "What theme kept showing up across different days?"
- "What was the week really about, underneath the task list?"
- "What single thing had the most impact on how the week went?"

**Surface key moments:**
- "What conversation this week changed your thinking?"
- "What breakthrough or realization stands out?"
- "What obstacle took more time than it should have?"

**Recognize contributions:**
- "Who unblocked significant work this week?"
- "What did someone do that you want to remember and appreciate?"
- "Who surprised you in a good way?"

**Crystallize learning:**
- "What do you understand now that you didn't on Monday?"
- "What pattern did you notice across multiple situations?"
- "What assumption got challenged or confirmed?"
- "What did you learn about how you work best?"

**Assess momentum:**
- "What has real forward movement right now?"
- "What's stuck and why?"
- "What are you avoiding that needs attention?"

**Plan the week ahead:**
- "What's the most important thing to accomplish next week?"
- "What needs to shift to make next week better than this one?"
- "Who do you need to talk to?"
- "What decision can't wait any longer?"

### 3. Adapt Based on Responses

- If I give brief answers, dig deeper with follow-ups
- If I mention something significant, help me expand on why it matters
- If I'm stuck, offer specific prompts based on what you saw in notes
- If I'm overwhelmed, focus on the critical 2-3 themes to remember
- Connect threads across different days to help me see patterns

### 4. Capture What Matters

As we talk, create or update this week's summary note in `00_Inbox/` with:
- `## Week in Review` - 2-3 sentence summary of what the week was about
- `## Key Moments` - Significant conversations, decisions, breakthroughs
- `## Progress` - What actually moved forward in projects/areas
- `## Learnings` - Insights and realizations
- `## For Next Week` - Priorities and follow-ups
- `## Gratitude` - People who made a difference

## Guidelines

**DO:**
- Start with 1-2 broad questions about the week's theme
- Reference specific projects, meetings, or patterns you discovered
- Help me connect dots between different days and areas
- Ask follow-up questions when I give surface-level answers
- Keep it conversational and reflective, not just reporting
- Focus on what mattered, not just what happened

**DON'T:**
- Ask generic "how was your week" questions
- List all possible questions at once
- Force me through every single day in detail
- Ask about things you can see didn't happen this week
- Generate summaries for me - draw them out through questions
- Let the conversation go on forever - aim for 10-15 minutes

## Example Flow

```
Claude: Looking at your week, I see Epic Social 39.00 had daily stand-ups, plus
you spent Wednesday and Thursday deep in the UE5 upgrade work. What was this
week really about for you - the Epic Social push or the technical migration?

Ron: [responds]

Claude: That's interesting that the migration kept pulling you away from Epic
Social. When you look at both, which one actually needs your focus next week?

Ron: [responds]

Claude: So Epic Social is more urgent but the migration is blocking other teams.
How did that tension show up in your 1-on-1 with Sarah this week?

[Conversation continues, Claude adapts based on responses and synthesizes themes]

Claude: Before we wrap - you mentioned feeling scattered between these two big
efforts. What's one thing you could do differently next week to feel more focused?

Ron: [responds]

Claude: Got it. So let me capture what we've surfaced:
- This week was split between Epic Social planning and unplanned UE5 deep work
- The UE5 work is more urgent than it seemed - blocking mobile team
- Sarah's supportive but wants clearer timeline on Epic Social
- Next week: delegate more of the UE5 investigation to let you focus on Epic Social
- Follow-up with mobile team lead on their actual timeline

Does that capture it?
```

## Success Criteria

- I have clarity on what the week was really about (beyond task completion)
- Important patterns or themes I might have missed are now visible
- I feel ready for next week with clear priorities
- The conversation felt reflective and valuable, not just administrative
- Total time: 10-15 minutes of conversation
- I can articulate "this was a week where..." with confidence

---

**Note:** Use this for weekly reflection to find patterns and prepare for the week ahead. Use `/daily-debrief` for lighter daily check-ins. Use `/weekly-synthesis` for more structured analysis of weekly patterns.
