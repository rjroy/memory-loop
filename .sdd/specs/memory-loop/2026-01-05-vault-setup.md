---
version: 1.0.0
status: Draft
created: 2026-01-05
last_updated: 2026-01-05
authored_by:
  - Ronald Roy <gsdwig@gmail.com>
parent_spec: memory-loop/2025-12-26-vault-selection.md
issue_ref: https://github.com/rjroy/memory-loop/issues/151
---

# Vault Setup Specification

## Executive Summary

The Vault Setup feature adds a "Setup" button to each vault card on the vault selection screen. When clicked, the button runs an agentic process that configures the vault for optimal use with Memory Loop: installing Claude slash commands, updating CLAUDE.md with Memory Loop context, and ensuring PARA directory structure exists.

The setup process runs invisibly (fully agentic) with only a loading indicator and success/failure notification shown to the user. Vaults that have already been configured show a "Reconfigure" button instead, allowing users to re-run setup if needed.

## User Story

As a Memory Loop user setting up a new vault, I want to click a single button that configures everything Memory Loop needs, so that I can start using the app without manually editing files or creating directories.

## Stakeholders

- **Primary**: Memory Loop users configuring new vaults or updating existing configurations
- **Secondary**: Claude Code users who want the installed slash commands in their workflow
- **Tertiary**: Memory Loop maintainers debugging setup issues; vault backup systems preserving .memory-loop metadata

## Success Criteria

1. Setup completes successfully for vaults with valid CLAUDE.md in under 30 seconds
2. Users can distinguish configured vs unconfigured vaults by button label (Setup vs Reconfigure)
3. All six Claude slash commands are installed and functional after setup
4. PARA directories exist after setup (created if missing)
5. CLAUDE.md contains Memory Loop context after setup

## Functional Requirements

### Setup Button Display

- **REQ-F-1**: Each vault card must display a setup action button
- **REQ-F-2**: Button must show "Setup" for unconfigured vaults (no `.memory-loop/setup-complete` marker)
- **REQ-F-3**: Button must show "Reconfigure" for previously configured vaults
- **REQ-F-4**: Button click must not trigger vault selection (separate click target from card)
- **REQ-F-5**: Button must be disabled during setup process with loading indicator

### Setup Detection

- **REQ-F-6**: System must check for `.memory-loop/setup-complete` file to determine configuration state
- **REQ-F-7**: The marker file must contain JSON with `{ completedAt: ISO8601, version: "1.0.0" }`
- **REQ-F-8**: Missing marker file indicates unconfigured vault (show "Setup")
- **REQ-F-9**: Present marker file indicates configured vault (show "Reconfigure")

### Setup Process - Overview

- **REQ-F-10**: Setup must run as a single agentic operation (no user interaction during execution)
- **REQ-F-11**: Setup must show loading state on the button during execution
- **REQ-F-12**: Setup must show success notification with summary on completion
- **REQ-F-13**: Setup must show error notification with details on failure
- **REQ-F-14**: Partial success must preserve completed steps and report what failed

### Setup Process - Command Installation

- **REQ-F-15**: Setup must create `.claude/commands/` directory in the vault if it doesn't exist
- **REQ-F-16**: Setup must install `daily-debrief.md` slash command (conversational daily check-in)
- **REQ-F-17**: Setup must install `weekly-debrief.md` slash command (weekly reflection and planning)
- **REQ-F-18**: Setup must install `monthly-summary.md` slash command (monthly reports generation)
- **REQ-F-19**: Setup must install `daily-review.md` slash command (structured end-of-day processing)
- **REQ-F-20**: Setup must install `inbox-processor.md` slash command (PARA inbox organization)
- **REQ-F-21**: Setup must install `weekly-synthesis.md` slash command (comprehensive weekly analysis)
- **REQ-F-22**: Command files must not overwrite existing files with same names (skip and note in summary)

### Setup Process - CLAUDE.md Update

- **REQ-F-23**: Setup must use LLM to analyze current CLAUDE.md content
- **REQ-F-24**: Setup must add/update a `## Memory Loop` section in CLAUDE.md
- **REQ-F-25**: The Memory Loop section must document the inbox path (from vault config)
- **REQ-F-26**: The Memory Loop section must document the goals file location (if exists)
- **REQ-F-27**: The Memory Loop section must explain that daily notes are created via the capture tab
- **REQ-F-28**: The Memory Loop section must document PARA directory locations
- **REQ-F-29**: Setup must preserve existing CLAUDE.md content (append/update, not replace)
- **REQ-F-30**: LLM must respect vault-specific config from `.memory-loop.json` when documenting paths

### Setup Process - PARA Structure

- **REQ-F-31**: Setup must check for PARA directories relative to content root
- **REQ-F-32**: Setup must create `01_Projects/` if it doesn't exist
- **REQ-F-33**: Setup must create `02_Areas/` if it doesn't exist
- **REQ-F-34**: Setup must create `03_Resources/` if it doesn't exist
- **REQ-F-35**: Setup must create `04_Archives/` if it doesn't exist
- **REQ-F-36**: Setup must respect custom paths from `.memory-loop.json` (projectPath, areaPath)
- **REQ-F-37**: Existing directories must not be modified (only missing ones created)

### Setup Process - Completion

- **REQ-F-38**: Setup must write `.memory-loop/setup-complete` marker on successful completion
- **REQ-F-39**: Marker must be written even if some non-critical steps were skipped
- **REQ-F-40**: Setup must update VaultInfo in frontend state to reflect new configuration status

### API/Protocol

- **REQ-F-41**: Add `setup_vault` client message type with `{ type: "setup_vault", vaultId: string }`
- **REQ-F-42**: Add `setup_progress` server message for streaming progress updates (optional, future enhancement)
- **REQ-F-43**: Add `setup_complete` server message with `{ success: boolean, summary: string[], errors?: string[] }`
- **REQ-F-44**: Backend must validate vault exists and has CLAUDE.md before starting setup

## Non-Functional Requirements

- **REQ-NF-1** (Performance): Setup must complete within 30 seconds for typical vaults
- **REQ-NF-2** (Performance): Button state must update within 100ms of setup completion
- **REQ-NF-3** (Reliability): Partial failures must not corrupt existing vault content
- **REQ-NF-4** (Reliability): CLAUDE.md backup must be created before modification (`.memory-loop/claude-md-backup.md`)
- **REQ-NF-5** (Usability): Loading indicator must be visible on the specific vault card being configured
- **REQ-NF-6** (Usability): Success/error notifications must auto-dismiss after 5 seconds
- **REQ-NF-7** (Maintainability): Command templates must be stored as static files, not hardcoded strings
- **REQ-NF-8** (Consistency): Setup must use existing vault-config.ts path resolution functions

## Explicit Constraints (DO NOT)

- Do NOT prompt user during setup (fully agentic execution)
- Do NOT delete or overwrite existing user files (append/create only)
- Do NOT modify files outside the vault directory
- Do NOT proceed with CLAUDE.md update if backup fails
- Do NOT mark setup complete if CLAUDE.md update fails (critical step)
- Do NOT block vault selection while setup is running (user can click elsewhere)
- Do NOT run setup automatically on vault selection (explicit button click required)

## Technical Context

### Existing Stack (Inherited)

- **Frontend**: React 19, TypeScript, Vite
- **Backend**: Hono server, Claude Agent SDK
- **Protocol**: WebSocket with Zod validation
- **Vault Config**: `.memory-loop.json` for custom paths

### Integration Points

- **VaultSelect.tsx**: Add setup button to vault cards
- **vault-config.ts**: Use existing path resolution (resolveContentRoot, resolveProjectPath, etc.)
- **websocket-handler.ts**: Add setup_vault message handler
- **session-manager.ts**: May need vault context without full session for setup
- **Claude Agent SDK**: LLM calls for CLAUDE.md analysis and update

### Command File Locations

Commands will be stored in the backend and copied to vaults during setup:
- Source: `backend/src/commands/` (template files)
- Destination: `{vault}/.claude/commands/` (per-vault installation)

### Patterns to Respect

- Use Zod schemas for new message types in shared/src/protocol.ts
- Follow existing error handling patterns (ErrorCode enum)
- Use existing CSS patterns for button styling (BEM naming)
- Backup files before modification

## Acceptance Tests

1. **Setup Button - Unconfigured Vault**: Given a vault without `.memory-loop/setup-complete`, when the vault card renders, then the button shows "Setup".

2. **Setup Button - Configured Vault**: Given a vault with `.memory-loop/setup-complete`, when the vault card renders, then the button shows "Reconfigure".

3. **Setup Button - Click Isolation**: Given a vault card with setup button, when user clicks the setup button, then vault selection does not trigger (only setup starts).

4. **Command Installation**: Given setup runs on a vault without `.claude/commands/`, when setup completes, then all 6 command files exist in `.claude/commands/`: `daily-debrief.md`, `weekly-debrief.md`, `monthly-summary.md`, `daily-review.md`, `inbox-processor.md`, `weekly-synthesis.md`.

5. **Command Preservation**: Given a vault with existing `.claude/commands/daily-debrief.md`, when setup runs, then the existing file is not overwritten and summary notes it was skipped.

6. **PARA Creation**: Given a vault without PARA directories, when setup completes, then `01_Projects/`, `02_Areas/`, `03_Resources/`, `04_Archives/` exist relative to content root.

7. **PARA Preservation**: Given a vault with existing `01_Projects/` containing files, when setup runs, then the directory and its contents are unchanged.

8. **CLAUDE.md Update**: Given a vault with CLAUDE.md lacking Memory Loop section, when setup completes, then CLAUDE.md contains a `## Memory Loop` section with inbox and PARA documentation.

9. **CLAUDE.md Backup**: Given setup runs successfully, when CLAUDE.md is modified, then `.memory-loop/claude-md-backup.md` contains the original content.

10. **Setup Marker**: Given setup completes successfully, when checking the vault, then `.memory-loop/setup-complete` exists with valid JSON.

11. **Partial Failure**: Given setup fails during PARA creation after commands are installed, when the error is reported, then commands remain installed and error message indicates what failed.

12. **Loading State**: Given user clicks setup button, when setup is in progress, then the button shows a loading indicator and is disabled.

13. **Success Notification**: Given setup completes successfully, when the notification appears, then it shows a summary of actions taken.

14. **Custom Paths**: Given a vault with `.memory-loop.json` specifying `contentRoot: "content"`, when setup creates PARA directories, then they are created in `content/01_Projects/` etc.

## Open Questions

*All questions resolved for v1:*

- [x] ~~Should the debrief commands have configurable prompts per-vault, or use fixed templates?~~ **Decision**: Fixed templates for v1. Per-vault customization deferred to future version.
- [x] ~~Should setup verify that installed commands are syntactically valid before marking complete?~~ **Decision**: No validation in v1. Command templates are pre-tested; Claude Code will handle any syntax issues.
- [x] ~~Should there be a "dry run" mode that shows what would be changed without making changes?~~ **Decision**: Not for v1. Simple enough that dry run adds complexity without proportional value.

## Out of Scope

- Uninstalling/removing setup changes (manual cleanup required)
- Custom command templates per-vault (fixed templates for v1)
- Setup progress streaming (v1 shows only loading/complete states)
- Batch setup across multiple vaults
- Setup configuration UI (predefined behavior only)
- Rollback on failure (keep partial, report errors)

---

**Next Phase**: Once approved, use `/spiral-grove:plan-generation` to create technical implementation plan.
