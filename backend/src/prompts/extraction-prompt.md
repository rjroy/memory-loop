# Memory Extraction

Extract durable facts about the user from conversation transcripts. Focus on information that remains true across sessions, not transient conversation details.

## Your Task

1. Read unprocessed transcripts from `VAULTS_DIR/.memory-extraction/unprocessed/`
2. Extract facts that belong in the categories below
3. Read the existing memory file at `VAULTS_DIR/.memory-extraction/memory.md`
4. Merge new facts with existing content, updating or adding as appropriate
5. Write the updated memory file

## Categories

Extract facts into these categories only:

### Identity
Who the user is: background, expertise, roles, experience. Information that establishes context for who you're working with.

### Goals
What the user is trying to achieve: projects they're building, outcomes they want, problems they're solving. Both immediate objectives and longer-term aspirations.

### Preferences
How the user likes to work: communication style, decision-making approach, tool preferences, constraints they operate under. Patterns in how they want things done.

### Project Context
Technical and organizational context: architectural decisions, why things exist the way they do, team structure, codebase patterns. Information that helps you make better suggestions.

### Recurring Insights
Patterns that emerged across conversations: repeated themes, evolving understanding, realizations the user has had. Things worth remembering because they keep coming up.

## Output Format

Use a hybrid narrative and list format. Write prose for interconnected information; use bullet lists only for truly independent items.

Good example:
```markdown
## Preferences
Values concise communication over verbose explanations. Prefers seeing tradeoffs explicitly stated rather than having decisions made silently. When implementing:
- Start simple, add complexity when needed
- Avoid over-engineering
- Show your reasoning
```

Bad example (over-bulleted):
```markdown
## Preferences
- Prefers concise communication
- Wants to see tradeoffs
- Likes simple solutions
- Dislikes over-engineering
```

## Merge Behavior

You are updating an existing memory file, not creating a new one.

**Add** new facts that don't exist yet.

**Update** existing facts when new information contradicts or refines them. When updating, prefer the newer information but preserve relevant context from the original.

**Preserve** existing facts that aren't contradicted. Don't remove information just because the current transcripts don't mention it.

**Consolidate** redundant facts. If you're about to add something that's already captured (even if worded differently), update the existing entry instead.

## Security

**Never extract:**
- Passwords, API keys, tokens, or credentials
- Private keys or secrets
- Personal identification numbers
- Financial account details
- Any information that looks like it should be kept secret

If a transcript contains sensitive information, extract the context around it (what the user was working on) without the sensitive values themselves.

## What to Extract vs. Ignore

**Extract** (durable facts):
- "I've been programming for 15 years"
- "Our team uses trunk-based development"
- "I prefer TypeScript over JavaScript for larger projects"
- "Memory Loop is my side project for AI-augmented note-taking"

**Ignore** (transient details):
- "Can you fix this bug?"
- "I'm working on the login page today"
- "Thanks, that worked!"
- Session-specific troubleshooting steps
- Temporary workarounds

The test: would this fact be useful context in a conversation six months from now?

## Process

Use the tools available to you:
- `Glob` to find transcript files
- `Read` to examine transcript and memory file contents
- `Edit` to update specific sections of the memory file
- `Write` to save the complete memory file if needed
- `Task` to process individual transcripts in parallel if there are many

For large transcript sets, consider using `Task` to spawn sub-agents for individual transcripts, then consolidate the extracted facts before writing.
