---
version: 1.0.0
status: Draft
created: 2025-12-26
last_updated: 2025-12-26
authored_by:
  - Claude Code (Reverse-Engineered)
---

# Note Capture Feature Specification

**Reverse-Engineered**: true
**Source Module**: frontend/src/components/NoteCapture.tsx, backend/src/note-capture.ts

## Executive Summary

The Note Capture feature provides a streamlined interface for users to quickly capture thoughts and ideas into daily notes within their Obsidian vault. This feature is designed for mobile-first usage with a simple textarea input and one-button submission that saves notes to daily markdown files using ISO 8601 date format (YYYY-MM-DD.md). Notes are automatically timestamped and appended to a dedicated "Capture" section in the daily file, preserving all existing content and maintaining chronological order.

The system implements intelligent draft persistence using localStorage to protect against accidental data loss, automatic retry logic with exponential backoff for network failures, and real-time toast notifications for user feedback. The feature bridges the gap between quick mobile note-taking and structured knowledge management by automatically organizing captures into date-based files that integrate seamlessly with Obsidian's daily notes workflow.

## User Story

As a knowledge worker using Memory Loop on my mobile device, I want to quickly capture fleeting thoughts and ideas without friction, so that I can preserve important insights throughout my day without interrupting my workflow, knowing they'll be automatically organized into my Obsidian vault's daily notes structure.

## Stakeholders

- **Primary**: Mobile and desktop users capturing quick notes throughout their day
- **Secondary**: Obsidian vault maintainers who need consistent daily note formatting; developers maintaining the WebSocket protocol and note-capture backend logic

## Success Criteria

1. Notes are captured and saved to the correct daily file within 3 seconds under normal network conditions
2. Draft content is automatically persisted to localStorage and restored on page reload with zero data loss
3. Failed captures automatically retry up to 3 times with exponential backoff before showing error to user
4. All captured notes appear under the `## Capture` section with HH:MM timestamp prefix in chronological order
5. Mobile users can capture notes with minimal interaction (type and tap submit) without UI friction
6. Daily notes follow strict ISO 8601 naming (YYYY-MM-DD.md) for Obsidian compatibility

## Functional Requirements

### Note Input and Draft Management

- **REQ-F-1**: System must provide a multiline textarea input with placeholder text "What's on your mind?"
- **REQ-F-2**: System must auto-resize textarea height based on content length (minimum 120px mobile, 200px tablet/desktop)
- **REQ-F-3**: System must automatically save draft content to localStorage (`memory-loop-draft` key) on every keystroke
- **REQ-F-4**: System must restore draft content from localStorage when component mounts
- **REQ-F-5**: System must clear draft from localStorage after successful capture
- **REQ-F-6**: System must trim whitespace from user input before submission (reject empty or whitespace-only submissions)

### Note Submission and Persistence

- **REQ-F-7**: System must send `capture_note` WebSocket message with trimmed text content when user submits
- **REQ-F-8**: System must require active WebSocket connection (`connected` status) before allowing submission
- **REQ-F-9**: System must require selected vault before allowing submission
- **REQ-F-10**: System must disable submit button when input is empty, WebSocket is disconnected, or no vault is selected
- **REQ-F-11**: System must automatically re-send vault selection message (`select_vault`) when WebSocket reconnects

### Daily Note File Management

- **REQ-F-12**: System must create daily note files using ISO 8601 date format: `YYYY-MM-DD.md`
- **REQ-F-13**: System must store daily notes in the vault's inbox directory (configurable via `VaultInfo.inboxPath`, default `00_Inbox`)
- **REQ-F-14**: System must create inbox directory if it does not exist (recursive creation)
- **REQ-F-15**: System must preserve user input text verbatim (including leading/trailing whitespace, special characters, markdown syntax, unicode, and multi-line content)
- **REQ-F-16**: System must create new daily note with template structure if file does not exist:
  ```markdown
  # YYYY-MM-DD

  ## Capture

  ```
- **REQ-F-17**: System must format capture entries with timestamp prefix: `- [HH:MM] {user_text}\n`
- **REQ-F-18**: System must append new captures to the end of the `## Capture` section (chronological order)
- **REQ-F-19**: System must create `## Capture` section at end of file if it doesn't exist in existing daily note
- **REQ-F-20**: System must preserve all existing content in daily note (before, within, and after `## Capture` section)

### Line Ending Normalization

- **REQ-F-21**: System must normalize Windows-style CRLF (`\r\n`) line endings to Unix-style LF (`\n`) before processing
- **REQ-F-22**: System must handle mixed line endings (CRLF and LF) in existing files

### Error Handling and Retry Logic

- **REQ-F-23**: System must retry failed captures up to 3 times with exponential backoff (initial delay 1000ms, doubling each retry)
- **REQ-F-24**: System must show retry status in toast notifications ("Failed, retrying... (1/3)")
- **REQ-F-25**: System must maintain submit button disabled state during retry attempts
- **REQ-F-26**: System must preserve draft content in localStorage during retry attempts
- **REQ-F-27**: System must clear retry counter and re-enable submit after successful capture or max retries exceeded
- **REQ-F-28**: System must validate input is non-empty (after trimming) and return failure result with error message
- **REQ-F-29**: System must handle filesystem errors (directory creation, file read/write failures) and return descriptive error messages

### User Feedback

- **REQ-F-30**: System must show "Saving..." button text while submission is in progress
- **REQ-F-31**: System must show success toast with timestamp ("Note saved at HH:MM") for 3 seconds after successful capture
- **REQ-F-32**: System must show error toast with descriptive message for 3 seconds after final retry failure
- **REQ-F-33**: System must show error toast if user attempts submission while WebSocket is disconnected
- **REQ-F-34**: System must clear textarea and draft storage after successful capture
- **REQ-F-35**: System must trigger `get_recent_activity` WebSocket message after successful capture to refresh HomeView

### Accessibility

- **REQ-F-36**: System must provide `aria-label="Note content"` on textarea for screen readers
- **REQ-F-37**: System must provide `role="alert"` and `aria-live="polite"` on toast notifications

## Non-Functional Requirements

- **REQ-NF-1** (Performance): Textarea auto-resize must execute synchronously on content change with no perceptible lag (< 16ms)
- **REQ-NF-2** (Performance): localStorage draft persistence must complete within 50ms to avoid blocking UI
- **REQ-NF-3** (Performance): Note capture round-trip (send → backend write → response) must complete within 3 seconds under normal network conditions
- **REQ-NF-4** (Reliability): Draft persistence must survive browser crashes and page reloads with zero data loss
- **REQ-NF-5** (Reliability): Exponential backoff retry logic must recover from transient network failures (< 10 second outages) without user intervention
- **REQ-NF-6** (Usability): Submit button must have minimum touch target size of 48x48px for mobile accessibility
- **REQ-NF-7** (Usability): Toast notifications must be positioned to avoid overlap with navigation bar (bottom + 60px offset)
- **REQ-NF-8** (Usability): Interface must be responsive with mobile-first breakpoint at 768px (larger textarea on desktop)
- **REQ-NF-9** (Maintainability): All date/time formatting logic must use pure functions for testability
- **REQ-NF-10** (Maintainability): Backend note-capture module must be framework-agnostic (works with any Node.js server)
- **REQ-NF-11** (Data Integrity): File write operations must be atomic (no partial writes that corrupt daily notes)
- **REQ-NF-12** (Data Integrity): Capture section parsing must correctly handle edge cases (multiple `## Capture` sections, malformed headers, CRLF endings)
- **REQ-NF-13** (Security): Text input must be preserved verbatim without sanitization or modification (Obsidian handles rendering)
- **REQ-NF-14** (Consistency): All timestamps must use 24-hour HH:MM format with zero-padded hours and minutes

## Explicit Constraints (DO NOT)

- Do NOT modify or sanitize user input text (preserve verbatim per REQ-F-15)
- Do NOT allow submission when WebSocket is disconnected or vault is not selected
- Do NOT exceed 3 retry attempts for failed captures
- Do NOT block UI thread during localStorage operations
- Do NOT create daily notes outside the vault's designated inbox directory
- Do NOT use date formats other than ISO 8601 (YYYY-MM-DD) for daily note filenames
- Do NOT use 12-hour time format or non-zero-padded timestamps (always HH:MM 24-hour)
- Do NOT insert captures at the beginning of `## Capture` section (always append to end)
- Do NOT modify existing content outside the `## Capture` section
- Do NOT strip trailing newlines from formatted capture entries (always include `\n`)

## Technical Context

- **Existing Stack**:
  - Frontend: React 19, TypeScript (strict mode), Vite, Bun runtime
  - Backend: Hono server, Node.js fs/promises, Bun runtime
  - Shared: Zod schemas for WebSocket protocol validation
  - Testing: Bun test, @testing-library/react, happy-dom (frontend), temp directory mocking (backend)

- **Integration Points**:
  - WebSocket protocol: Sends `capture_note` messages, receives `note_captured` responses
  - SessionContext: Requires selected vault (`VaultInfo`) for inbox path resolution
  - useWebSocket hook: Manages connection state and message transmission
  - VaultManager: Provides inbox path resolution and directory validation
  - RecentActivity: Refreshed via `get_recent_activity` message after successful capture
  - localStorage: Browser storage for draft persistence (key: `memory-loop-draft`)

- **Patterns to Respect**:
  - Discriminated union types for WebSocket messages (Zod schemas)
  - Custom error classes with `.code` property (e.g., `NoteCaptureError`)
  - Ref-based state for retry logic (avoid re-renders during retry)
  - CSS variables for theming (--spacing-*, --color-*, --glass-*)
  - Mobile-first responsive design with 768px breakpoint
  - Pure function exports for date/time formatting (testable without mocking)

## Acceptance Tests

1. **New Daily Note Creation**: Given no daily note exists for today, When user captures "Test note", Then system creates `YYYY-MM-DD.md` with template heading and `## Capture` section containing `- [HH:MM] Test note`

2. **Append to Existing Daily Note**: Given daily note exists with existing captures, When user captures "New thought", Then system appends `- [HH:MM] New thought` to end of `## Capture` section preserving all existing content

3. **Draft Persistence**: Given user types "Draft content" and navigates away, When user returns to Note Capture view, Then textarea displays "Draft content" restored from localStorage

4. **Draft Cleared on Success**: Given textarea contains "Captured note" and localStorage has matching draft, When capture succeeds and `note_captured` message is received, Then textarea is empty and localStorage draft is removed

5. **Retry Logic**: Given network failure occurs during capture, When submission fails, Then system retries up to 3 times with exponential backoff (1s, 2s, 4s delays) before showing final error

6. **WebSocket Reconnection**: Given WebSocket disconnects and reconnects, When connection status changes to "connected", Then system automatically re-sends `select_vault` message for current vault

7. **Empty Input Rejection**: Given textarea is empty or contains only whitespace, Then submit button is disabled and submission is rejected with error "Cannot capture empty text"

8. **Timestamp Format**: Given current time is 08:05 AM, When note is captured, Then entry uses 24-hour format `- [08:05] {text}` with zero-padded hour

9. **Preserve Content Verbatim**: Given user input is `"  Check [[note]] and #tag  "` with leading/trailing spaces, When captured, Then daily note contains exactly `- [HH:MM]   Check [[note]] and #tag  ` preserving all whitespace

10. **Create Missing Capture Section**: Given existing daily note lacks `## Capture` section, When note is captured, Then system appends `## Capture` section at end of file before adding entry

11. **Windows Line Ending Handling**: Given existing daily note uses CRLF (`\r\n`) line endings, When note is captured, Then system normalizes to LF and correctly identifies `## Capture` section boundaries

12. **Toast Notification**: Given successful capture at 14:30, Then toast displays "Note saved at 14:30" for 3 seconds with success styling (green border, glow effect)

13. **Mobile Responsiveness**: Given viewport width < 768px, Then textarea has min-height 120px and submit button has min-height 48px for touch accessibility

14. **Accessibility**: Given screen reader is active, Then textarea announces "Note content" label and toast announces success/error messages via aria-live region

15. **Chronological Order**: Given existing captures at [08:00] and [10:00], When new capture occurs at [12:00], Then entry appears after [10:00] entry at end of `## Capture` section

## Open Questions

- [ ] Should maximum capture text length be enforced? (Current: unlimited, tests verify 10,000+ character support)
- [ ] Should system support custom timestamp formats or remain fixed at HH:MM 24-hour?
- [ ] Should retry delays be configurable or remain hardcoded (1s initial, exponential backoff)?
- [ ] Should successful captures show note file path in toast notification for transparency?

## Out of Scope

- Rich text editing (markdown preview, WYSIWYG editor)
- Inline markdown formatting toolbar
- Voice-to-text capture
- Image or file attachments
- Custom capture templates per vault
- Organizing captures into categories/tags within daily note
- Editing or deleting previously captured notes
- Offline queue for captures when WebSocket is unavailable
- Configurable timestamp formats (always HH:MM 24-hour)
- Custom `## Capture` section names or multiple capture sections

---

**Next Phase**: Once approved, use `/spiral-grove:plan-generation` to create technical implementation plan.
