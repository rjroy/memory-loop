# Capture Tab

The Capture tab is your quick-entry point for thoughts, observations, and fleeting ideas. Notes go straight to your daily note file with a timestamp.

[ img: Capture tab full view ]

## The Capture Interface

The interface is intentionally minimal: a text area and a submit button. This design optimizes for speed, capturing the thought before it escapes.

[ img: Capture text area with button ]

### Text Area

The text area auto-expands as you type. There's no limit on length, though captures work best for quick thoughts rather than long-form writing (use the Recall tab's editor for that).

### Submit Button

Tap **Capture Note** to save your text. While saving, the button changes to "Saving..." and disables further input until complete.

## How Captures Work

When you submit a capture:

1. The text is appended to today's daily note in your inbox folder
2. A timestamp is added (e.g., "10:42 AM")
3. A success toast confirms the save
4. The text area clears, ready for your next thought

[ img: Success toast after capture ]

### Daily Note Format

Captures append to `{inbox}/{YYYY-MM-DD}.md` in this format:

```markdown
## 10:42 AM

Your captured thought goes here.
```

If the daily note doesn't exist, it's created automatically.

### Inbox Location

The inbox path comes from your vault's `CLAUDE.md` configuration. Typically this is `00_Inbox/` or similar. If no inbox is configured, captures go to the vault root.

## Input Behavior

### Desktop

- **Enter**: Submit the capture
- **Shift+Enter**: Add a new line

This lets you quickly fire off thoughts without reaching for the mouse.

### Mobile

- **Enter**: Add a new line
- **Tap button**: Submit the capture

On touch devices, Enter always creates a newline since there's no keyboard shortcut expectation. The button is the primary submit mechanism.

## Draft Preservation

Your draft auto-saves to browser storage as you type. If you navigate away or close the app before submitting:

- The draft persists across sessions
- Reopening Capture restores your text
- Submitting or clearing the field removes the draft

This ensures you never lose a partial thought due to accidental navigation.

## Error Handling

### Connection Issues

If the server connection drops:
- The button disables
- A toast warns "Not connected. Please wait..."
- Once reconnected, you can retry

### Save Failures

If the save fails:
- The system retries automatically (up to 3 times)
- Retries use exponential backoff
- A toast shows retry progress
- After 3 failures, you see the error message

Your text is never cleared on failure, so you can retry manually or copy it elsewhere.

[ img: Error toast during retry ]

## Typical Workflows

### Quick Thought Capture

1. Open Capture when an idea strikes
2. Type the thought
3. Tap **Capture Note** or press Enter
4. Return to what you were doing

The whole interaction takes seconds.

### Meeting Notes Stream

1. Keep Capture open during a meeting
2. Enter key points as they come up
3. Each capture gets its own timestamp
4. Review later in Recall or via Daily Debrief

### Reading Notes

1. While reading, switch to Capture to note reactions
2. Each insight gets captured with context (timestamp)
3. The daily note becomes a record of your reading session

### Morning Pages

1. Use Capture for stream-of-consciousness writing
2. Each paragraph can be a separate capture
3. Timestamps create a natural flow record
4. Review later to find patterns

## Meeting Capture Mode

For focused sessions like meetings, 1-on-1s, or brainstorming, you can start a **Meeting** that routes all captures to a dedicated file instead of your daily note.

[ img: Start Meeting button next to Capture Note button ]

### Starting a Meeting

1. Tap **Start Meeting** on the Capture tab
2. Enter a descriptive title (e.g., "Q3 Planning with Sarah")
3. Tap **Start Meeting** to confirm

The title becomes part of the filename and appears in the file's frontmatter.

[ img: Meeting title prompt dialog ]

### Capturing During a Meeting

Once a meeting starts:

- The interface shows a **meeting status bar** with the title and a pulsing indicator
- The placeholder text changes to "Capturing to: [title]"
- The submit button changes to **Add Note**
- All captures go to the meeting file with `[HH:MM]` timestamps

[ img: Capture tab during active meeting with status bar ]

Capture entries appear as timestamped bullets in the meeting file:

```markdown
## Capture

- [10:42] Sarah raised concern about QA capacity
- [10:45] May need to push timeline
- [10:52] Decided to check with Mark first
```

### Meeting State Persistence

Meeting state persists across tab switches and reconnections. You can:

- Switch to other tabs and return to Capture
- Have the connection drop and reconnect
- Close and reopen the browser

The meeting remains active until you explicitly stop it.

### Stopping a Meeting

Tap **Stop Meeting** in the status bar. This:

1. Finalizes the meeting file
2. Shows how many notes were captured
3. Automatically switches to the **Think** tab
4. Pre-fills `/expand-note [path]` ready to run

The `/expand-note` command helps transform your raw captures into coherent meeting notes. See [Think Tab](./think.md) for details on this command.

[ img: Think tab with expand-note command pre-filled ]

### Meeting File Format

Meeting files are stored in `{inbox}/meetings/` with this structure:

**Filename:** `YYYY-MM-DD-title-slug.md`

**Content:**
```markdown
---
date: 2026-01-15
title: "Q3 Planning with Sarah"
attendees: []
---

# Q3 Planning with Sarah

## Capture

- [10:42] Sarah raised concern about QA capacity
- [10:45] May need to push timeline
...
```

The `attendees` field in frontmatter starts empty. You can populate it later when expanding notes or via direct editing in Recall.

### When to Use Meeting Mode

**Use meeting mode when:**
- Notes belong together as one logical session
- You'll want to expand or summarize them afterward
- Attendees or meeting metadata matter

**Use regular capture when:**
- Thoughts are independent, not part of a session
- You just want them in your daily note stream
- No need for post-meeting processing

## Tips

- **Keep it short**: Capture is for quick notes, not essays
- **Use Think for analysis**: If you want AI engagement, use Think instead
- **Review in Recall**: Tap "View" on recent captures to see full context
- **Use Daily Debrief**: Let the AI summarize your day's captures
- **Use Meeting mode for sessions**: Keep related notes together in one file
