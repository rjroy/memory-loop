---
title: Ground dashboard intent
date: 2026-10-31
status: draft
tags: [ground, dashboard, intent]
---

# Ground dashboard intent

## Purpose and composition

Ground organizes and displays information as a dashboard of independent cards.
It is a holder for those elements, not the owner of their business logic.

Each card must be a separate element with a self-contained responsibility.
Adding, removing or replacing a card should not require changes to other cards.
Expect the selection and design to change frequently as the user's tastes evolve.
A fixed composition in code is sufficient initially; a fully configurable
dashboard, plugin framework or dashboard editor is not required.

Ground remains a frontend presentation surface. File operations, data retrieval,
conversation lifecycle and scheduled agent work belong to the daemon. Keep the
card host, daemon-backed capabilities and scheduled content generation distinct.

## Vault-backed resources

Files designated as dashboard resources belong under the configured vault root:

```text
03_Resources/Memory-Loop/
```

This applies to the Quick Actions definition, inspiration collection, suggested
questions and Current Goals file. Exact filenames and content schemas remain to
be designed. Existing captures stay in `00_Inbox`; existing conversation
transcripts retain their established location rather than moving into resources.

## Initial cards

### Quick Actions

Provide a toolbar of quick commands read from a Markdown resource file. These
commands are skill cheat sheets, such as `@intent` and `@write-lyrics`.

The desired authoring format is Markdown headings with descriptions beneath
them, supplying the skill reference and descriptive button content. Finalize the
precise parsing rules during design.

Activating an action opens a fresh Think conversation with the skill reference
prefilled in the editor. Do not send it automatically: the user must be able to
add context or edit it before sending.

### Inspiration

Display a random quote from a vault resource file. Attribute every quote.

Select using increasing weights in file order: the first entry has weight 1,
the second 2, and so on. This favors entries at the bottom. For three entries,
the total weight is 6 and the final entry has a 50% chance of selection.

Cap the collection at 50 entries. A scheduled agent populates it weekly by
considering recent vault edits and choosing famous quotes to inspire the user.
The agent's output is persisted in the resource file, not held only in the UI.

### Prompts

Display suggested questions from a vault resource file, similarly to the
inspiration card. An agent populates the questions daily.

Clicking a question opens a fresh Think conversation with that question prefilled
and editable. Do not send it automatically.

Exact prompt collection limits and whether every inspiration selection rule also
applies remain to be settled during design; the weekly quote schedule does not
apply to this daily question generation.

### Recent captures

Show the latest five timestamped captures across dated files in `00_Inbox`, with
the most recent at the top. Each item opens its associated source note in Recall.
These are capture entries, not merely the five most recently modified files.

### Recent conversations

Show the latest ten conversations. Each has Resume and Delete actions.

- Resume reopens the selected conversation in Think.
- The conversation currently selected in Think cannot be deleted.
- Explicit deletion removes both the conversation and its associated vault
  transcript.
- Falling outside the latest-ten display limit never deletes a conversation or
  its transcript. This is not an age-based retention or cleanup policy.

Resuming conversations is a real daemon capability, including continuity across
daemon restarts, not simply a card-local link or in-memory list.

### Current Goals

Render a designated Markdown resource file containing the user's current goals.
This card is a file display, not a new goals-management or editing system.

## Foundation boundaries

The implementation should provide three coherent foundations:

1. An independent card host with a consistent dashboard layout.
2. Daemon-backed resource reads, recent capture retrieval, conversation listing,
   resume and deletion, and frontend integration for editable chat prefills.
3. Scheduled daily question generation and weekly attributed-quote generation,
   persisted as ordinary vault content.

These are architectural boundaries, not a committed phase order. Card layout,
resource schemas, scheduling details and the implementation sequence require a
focused design and planning pass. Do not represent those capabilities as working
through placeholder data or UI-only shortcuts.
