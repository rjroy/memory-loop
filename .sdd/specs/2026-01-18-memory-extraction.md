---
version: 1.0.0
status: Approved
created: 2026-01-18
last_updated: 2026-01-18
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
github_issue: 356
---

# Memory Extraction System Specification

## Executive Summary

Memory Extraction enables cross-session continuity by automatically discovering durable facts from conversation transcripts and persisting them as injectable Claude context. Without this, each Memory Loop session starts with Claude having no awareness of accumulated relationship and project understanding.

The system parses transcript markdown files via scheduled batch processing, extracts facts matching user-defined categories, and writes them to `~/.claude/rules/memory.md` for automatic context injection. Vault-specific insights are written to a dedicated section in each vault's CLAUDE.md, isolated from manually-authored content.

## User Story

As a Memory Loop user, I want my conversations with Claude to build on accumulated understanding, so that Claude remembers my preferences, project decisions, and recurring themes without me re-explaining context each session.

## Stakeholders

- **Primary**: Memory Loop users who maintain ongoing relationships with Claude across sessions
- **Secondary**: Vault owners who benefit from improved CLAUDE.md content
- **Tertiary**: Developers maintaining the extraction pipeline and prompts

## Success Criteria

1. Extracted memories appear in Claude's context for new sessions (verified by Claude referencing facts not mentioned in current session)
2. Memory file remains under 50KB to avoid context window bloat
3. Extraction runs without user intervention (batch job completes successfully)
4. User can view and edit memories through Memory Loop settings UI
5. Duplicate facts are merged rather than appended

## Functional Requirements

### Memory Storage

- **REQ-F-1**: Memories must be stored in `~/.claude/rules/memory.md` for automatic injection into Claude's context
- **REQ-F-2**: Memory file must be structured markdown readable by humans and optimized for LLM consumption
- **REQ-F-3**: Vault-specific insights must be written to a dedicated section in the vault's CLAUDE.md (e.g., `## Memory Loop Insights`) to isolate extracted content from manually-authored sections

### Extraction Pipeline

- **REQ-F-4**: Extraction must run as a daily scheduled batch process during overnight hours (configurable time)
- **REQ-F-5**: Extraction source must be transcript markdown files from `{inbox}/chats/` directories
- **REQ-F-6**: Extraction must use LLM analysis with prompt defining fact categories; default prompt at `backend/src/prompts/extraction-prompt.md`, user override at `~/.config/memory-loop/extraction-prompt.md` if present
- **REQ-F-7**: Extraction prompt must support multiple fact categories (identity, goals, preferences, project context, insights)
- **REQ-F-8**: Extraction must track processed transcripts to avoid reprocessing (via checksum or modification time)
- **REQ-F-9**: Extraction must not append verbatim duplicate facts (detection via normalized text comparison)

### Fact Categories (Default Prompt)

- **REQ-F-10**: Default extraction prompt must define at least these categories:
  - Identity facts (who the user is, background, expertise)
  - Goal facts (what the user is trying to achieve)
  - Preference facts (communication style, tool preferences, constraints)
  - Project context (architectural decisions, why things exist)
  - Recurring insights (patterns that emerged across conversations)

### Manual Curation

- **REQ-F-11**: Memory Loop must provide a Settings dialog accessible from the vault selection screen
- **REQ-F-12**: Settings dialog must include a text editor tab for viewing/editing the memory file
- **REQ-F-13**: Memory file edits must be saved to `~/.claude/rules/memory.md`
- **REQ-F-14**: User must be able to delete individual memory entries

### Extraction Prompt Configuration

- **REQ-F-15**: Settings dialog must include a tab for editing the extraction prompt
- **REQ-F-16**: Editing the prompt must create user override at `~/.config/memory-loop/extraction-prompt.md` (copies default on first edit)

## Non-Functional Requirements

- **REQ-NF-1** (Size): Memory file must not exceed 50KB to preserve context window budget
- **REQ-NF-2** (Reliability): Extraction must be idempotent (safe to re-run without duplication)
- **REQ-NF-3** (Privacy): Memory file location (`~/.claude/rules/`) must be outside vault content
- **REQ-NF-4** (Transparency): User must be able to see exactly what Claude "remembers" about them

## Explicit Constraints (DO NOT)

- Do NOT modify vault CLAUDE.md content outside the dedicated `## Memory Loop Insights` section
- Do NOT run extraction on session end (use scheduled batch only)
- Do NOT exceed 50KB memory file size (prune oldest/least-relevant if needed)
- Do NOT store memories inside vaults (use global `~/.claude/rules/` location)
- Do NOT use user override prompt without showing user it exists (Settings UI must indicate when override is active)
- Do NOT reprocess already-processed transcripts unless forced

## Technical Context

### Existing Stack
- Backend: Bun + Hono, Claude Agent SDK
- Transcript storage: `{vault}/{inbox}/chats/*.md` with YAML frontmatter
- Session storage: `.memory-loop/sessions/*.json` (not used for extraction)
- Configuration: `.memory-loop.json` per vault

### Integration Points
- Transcript Manager: Provides source data at `{inbox}/chats/`
- Vault Selection UI: Host for new Settings dialog
- Claude Agent SDK: Used for LLM-based extraction analysis

### Patterns to Respect
- Scheduled jobs should be non-blocking background processes
- File operations must handle permission errors gracefully
- Settings UI should match existing Memory Loop visual style

## Acceptance Tests

1. **First extraction**: Run extraction on vault with 5 transcripts → memory.md created with categorized facts
2. **Incremental extraction**: Add 2 new transcripts, re-run → only new transcripts processed, facts appended
3. **Duplicate handling**: Extract fact that already exists → fact merged, not duplicated
4. **Manual edit**: Open Settings, edit memory text, save → changes persisted to file
5. **Context injection**: Start new session → Claude can reference memories without prompting
6. **Size limit**: Run extraction that would exceed 50KB → oldest entries pruned to stay under limit
7. **Prompt customization**: Edit extraction prompt, re-run → extraction uses custom categories

## Open Questions

- [ ] Should there be a "forget this" action to permanently exclude a fact? (Enhancement for v2)

## Out of Scope

- Real-time extraction during conversation
- Semantic search over memories
- Memory sharing between users
- Memory encryption or access control

---

**Next Phase**: Once approved, use `/spiral-grove:plan-generation` to create technical implementation plan.
