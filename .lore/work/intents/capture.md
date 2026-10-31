---
title: Capture intent
date: 2026-10-31
status: draft
tags: [capture, intent]
---

# Capture

Provide a low-friction way to save thoughts as timestamped Markdown entries in
the configured vault. Capture remains a core capability independent of Ground
and its dashboard panels.

## Interface

- Place a Capture button at the top.
- Let the text editor fill the remaining screen space.
- On desktop, Enter captures and Shift+Enter inserts a newline.
- On mobile, Enter inserts a newline; the Capture button submits the entry.
- Clear the editor only after a successful save. Retain the draft on failure.

## Storage

The daemon owns capture writes and uses the configured vault root.

- Append to `<vault-root>/00_Inbox/<YYYY-MM-DD>.md`.
- Create the inbox directory and dated file when missing.
- Use the server timezone for both the dated filename and entry timestamp.
- Format each entry as `- [HH:MM] <text>`.
- Preserve multiline captures as one Markdown list entry: timestamp the first
  line and indent continuation lines beneath it.
- Append without rewriting existing entries or altering unrelated vault content.

Example:

```md
- [14:35] First line
  Second line
```

## Implementation direction

Build on the existing frontend, daemon, and JSON vault configuration. Perform a
focused UI design pass before implementation. Technical details such as mobile
input classification and save-retry handling belong in the implementation plan;
this intent does not select their mechanisms.
