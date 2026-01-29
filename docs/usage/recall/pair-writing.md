# Pair Writing

Pair Writing is a split-pane editing mode for longer writing sessions with AI assistance. Select text, choose an action, and Claude either transforms it directly or provides feedback.

[ img: Pair Writing split-pane view ]

**Entry point**: Tap the **Pair Writing** button in the markdown viewer toolbar.

**Availability**: Pair Writing is designed for larger screens. The button is hidden on phones but visible on tablets and desktops where the split layout is practical.

## Layout

The screen splits into two panes:
- **Left pane**: Markdown editor with your document
- **Right pane**: AI conversation for writing assistance

Both panes share the same Think session, so conversation context persists if you exit and return.

## Quick Actions

Quick actions apply transformations directly to selected text (or the entire document if nothing is selected):

| Action | Effect |
|--------|--------|
| Tighten | Remove unnecessary words, make prose more concise |
| Embellish | Add detail, expand descriptions, enrich language |
| Correct | Fix grammar, spelling, and punctuation |
| Polish | Light overall improvement without changing voice |

Select text before tapping to transform just that selection. With no selection, the action applies to the full document.

## Advisory Actions

Advisory actions provide feedback in the conversation pane without modifying your text:

| Action | Purpose |
|--------|---------|
| Validate | Check claims, consistency, and accuracy |
| Critique | Identify weaknesses and suggest improvements |
| Compare | Compare current version against a snapshot |
| Discuss | Open-ended conversation about the document |

## Snapshots

Tap **Snapshot** to save the current document state. Use snapshots to:
- Mark a "known good" version before major changes
- Create comparison points for the Compare action
- Track progress across editing sessions

Snapshots are stored in the session and persist across tab switches.

## Typical Workflow

1. Open a markdown file in Recall
2. Tap **Pair Writing** in the toolbar
3. Select text you want to work on
4. Choose a Quick Action to transform it, or an Advisory Action for feedback
5. For Quick Actions, the file updates automatically
6. For Advisory Actions, read feedback and edit manually
7. Tap **Save** to persist manual changes
8. Tap **Exit** when done
