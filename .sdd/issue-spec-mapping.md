# GitHub Issues to Spec Mapping

Generated: 2026-01-01
Total Issues: 39 (Open: 5, Closed: 34)

## Legend

- **COVERED**: Issue requirements are defined in current specs
- **PARTIAL**: Some aspects covered, others missing
- **NOT COVERED**: Issue describes functionality not in specs
- **BUG FIX**: Bug that should be prevented by existing specs
- **IMPLEMENTATION**: Technical/implementation detail, not a spec concern

---

## Open Issues (5)

### #119 - Add a delete session button on the Ground tab
**Status**: OPEN | **Coverage**: NOT COVERED
**Summary**: Add delete button to DiscussionCard with confirmation, remove from display and server storage
**Spec Analysis**: home.md covers session display (REQ-F-17-25) but not session deletion. New feature requiring spec work.

### #117 - Implement canUseTool
**Status**: OPEN | **Coverage**: COVERED by `chat.md`
**Summary**: Add canUseTool option to session-manager with frontend permission dialog
**Spec Refs**: REQ-F-23 to REQ-F-28 (Tool Permission section), Acceptance Tests #16-21

### #105 - Add support for mermaid diagrams to Markdown view
**Status**: OPEN | **Coverage**: COVERED by `view.md`
**Summary**: Support mermaid diagrams in fenced code blocks for markdown rendering
**Spec Refs**: REQ-F-20 (mermaid as SVG), Acceptance Test #31

### #103 - Should user space be allowed during discussion?
**Status**: OPEN | **Coverage**: NOT COVERED
**Summary**: Clarify if user-scoped CLAUDE.md rules should apply in discussions
**Spec Analysis**: No spec mentions user vs project CLAUDE.md scope. Need spec clarification.

### #67 - Proper logging integration
**Status**: OPEN | **Coverage**: NOT COVERED
**Summary**: File rotation, configurable log levels
**Spec Analysis**: No logging spec exists. Infrastructure concern, may not need feature spec.

---

## Closed Issues - COVERED (24)

### #101 - Task List on Recall tab
**Coverage**: COVERED by `task-list.md`
**Spec Refs**: REQ-F-1 to REQ-F-27, full feature spec exists

### #110 - task improvements
**Coverage**: COVERED by `task-list.md`
**Spec Refs**: REQ-F-9 (newest-first sort), REQ-F-12 (sticky headers), REQ-F-13-14 (hide completed), Acceptance Tests #12-15

### #86 - Add lightweight edit capability to Recall tab
**Coverage**: COVERED by `view.md` (merged)
**Spec Refs**: REQ-F-33 to REQ-F-43 (File Content Editing section)

### #85 - The Recall tab needs a Reload button
**Coverage**: COVERED by `view.md`
**Spec Refs**: REQ-F-16 (Reload button), Acceptance Test #29

### #96 - Markdown frontmatter rendering improvement
**Coverage**: COVERED by `view.md`
**Spec Refs**: REQ-F-19 (frontmatter as table), Acceptance Test #30

### #82 - Stop/Abort button during AI thinking
**Coverage**: COVERED by `memory-loop.md`
**Spec Refs**: REQ-F-18 (abort message)

### #80 - Configure read directory
**Coverage**: COVERED by `vault-selection.md` + `task-list.md`
**Spec Refs**: vault-selection REQ-F-7 (inbox detection), task-list REQ-F-1-3 (projectPath, areaPath)

### #71 - There's no way to shift+enter on mobile
**Coverage**: COVERED by `chat.md` + `note-capture.md`
**Spec Refs**: chat REQ-F-4 (Shift+Enter for newline), note-capture design

### #70 - The Chat input box should expand larger
**Coverage**: COVERED by `note-capture.md`
**Spec Refs**: REQ-F-2 (auto-resize textarea)

### #69 - New button should integrated into Chat tab
**Coverage**: COVERED by `chat.md`
**Spec Refs**: REQ-F-12 (New button for new session)

### #29 - Feature: Enhanced Recent Notes with Discussions
**Coverage**: COVERED by `home.md`
**Spec Refs**: REQ-F-17 to REQ-F-25 (Recent Activity section)

### #28 - Feature: Pinned Folders for Quick Navigation
**Coverage**: COVERED by `view.md`
**Spec Refs**: REQ-F-13 to REQ-F-15 (pin/unpin, persist)

### #27 - Feature: Goal Tracker via goals.md
**Coverage**: COVERED by `home.md`
**Spec Refs**: REQ-F-11 to REQ-F-16 (Goals Display)

### #26 - Feature: Contextual Prompts / Inspiration System
**Coverage**: COVERED by `home.md`
**Spec Refs**: REQ-F-5 to REQ-F-10 (display), REQ-F-32 to REQ-F-46 (generation)

### #25 - Feature: Task Surfacing via AI Discussion
**Coverage**: COVERED by `chat.md`
**Spec Refs**: REQ-F-27-29 (slash commands), system prompt awareness

### #24 - Feature: Home View - Action-oriented dashboard
**Coverage**: COVERED by `home.md`
**Spec Refs**: Full home.md spec covers this

### #10 - Calls to query are missing options
**Coverage**: COVERED by `chat.md`
**Spec Refs**: REQ-F-8 (SDK session options)

### #9 - Need a go back to select button
**Coverage**: COVERED by `vault-selection.md` + `memory-loop.md`
**Spec Refs**: Vault switcher in header

### #4 - Another tab to view markdown files
**Coverage**: COVERED by `view.md`
**Spec Refs**: Full view.md spec

### #2 - Markdown should look like good HTML
**Coverage**: COVERED by `chat.md` + `view.md`
**Spec Refs**: chat REQ-F-6, view REQ-F-17 (GFM support)

### #107 - Tool details should be displayed in a status bar
**Coverage**: COVERED by `chat.md`
**Spec Refs**: REQ-F-17 to REQ-F-22 (Tool Usage Display)

### #56 - Long press on iOS obscures context menu
**Coverage**: COVERED by `view.md`
**Spec Refs**: REQ-F-13 (long-press context menu)

### #61 - chunked messages get muddled
**Coverage**: COVERED by `chat.md`
**Spec Refs**: REQ-F-2 (streaming chunks)

### #47 - Double streaming render
**Coverage**: COVERED by `chat.md`
**Spec Refs**: REQ-F-2, REQ-F-7 (streaming behavior)

---

## Closed Issues - BUG FIXES (6)

These are bugs that existing specs should prevent. Specs define correct behavior.

### #102 - New Discussion resets when switching tabs
**Coverage**: BUG FIX - chat.md covers session persistence
**Spec Refs**: REQ-F-8 to REQ-F-16 (Session Management)

### #89 - Think tab Send button sometimes disabled
**Coverage**: BUG FIX - chat.md covers button state
**Spec Refs**: REQ-F-4, REQ-F-5

### #53 - First streaming reply gets added to user box
**Coverage**: BUG FIX - chat.md covers message display
**Spec Refs**: REQ-F-3 (chronological order)

### #50 - Initial load on Home page shows 0 messages
**Coverage**: BUG FIX - home.md covers session display
**Spec Refs**: REQ-F-1 to REQ-F-4 (Session Context Display)

### #51 - the inspiration quote by line can be hard to read
**Coverage**: BUG FIX - styling issue, no spec impact

### #49 - should add icons/images
**Coverage**: BUG FIX - styling enhancement, covered generally

---

## Closed Issues - NOT COVERED (4)

### #118 - Refactor the 2 dialogs into 1
**Coverage**: IMPLEMENTATION (refactoring, not user-facing spec)

### #3 - It's just ugly
**Coverage**: NOT COVERED (visual design, not spec concern)

### #5 - HOST env should be used
**Coverage**: NOT COVERED (deployment config, not feature spec)

### #16 - Unify markdown rendering libraries
**Coverage**: IMPLEMENTATION (tech debt, not user-facing spec)

---

## Summary

| Category | Count |
|----------|-------|
| COVERED | 26 |
| PARTIAL | 0 |
| NOT COVERED (needs spec) | 3 |
| BUG FIX | 6 |
| IMPLEMENTATION/INFRA | 4 |
| **Total** | **39** |

### Issues Needing Spec Work (3)

**Open - Need new specs or spec updates:**
1. #119 - Delete session button (NEW FEATURE)
2. #103 - User vs project CLAUDE.md scope (CLARIFICATION)
3. #67 - Logging integration (infrastructure)
