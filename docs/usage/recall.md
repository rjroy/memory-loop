# Recall Tab

The Recall tab is your file browser and content viewer. Navigate your vault structure, read files, search across notes, manage tasks, and make quick edits.

<img src="../screenshots/recall.webp"/>

## Layout

The Recall tab uses a split-pane layout:
- **Left pane**: File tree or task list (collapsible on desktop)
- **Right pane**: Content viewer

On mobile, the left pane appears as an overlay that slides in when needed.

## File Tree

The file tree shows your vault's folder structure. Navigate by expanding folders and selecting files.

[ img: File tree with expanded folders ]

### Navigation

- **Tap folder**: Expand or collapse to show/hide contents
- **Tap file**: Open in the viewer pane
- **Pinned folders**: Starred folders appear at top for quick access

### Pinned Assets

Frequently accessed folders can be pinned. Pinned items appear at the top of the file tree for quick access regardless of their location in the vault hierarchy.

[ img: Pinned folders section at top of file tree ]

### Context Menu

Long-press (mobile) or right-click (desktop) a file or folder to see context actions:

| Action | Applies to | Description |
|--------|-----------|-------------|
| Pin / Unpin | Files & Directories | Add or remove from pinned assets at top of tree |
| Think about | All | Opens Think with file path pre-filled for AI discussion |
| Rename | Files & Directories | Change the name while preserving location |
| Move | Files & Directories | Relocate to a different folder in the vault |
| Add Directory | Directories only | Create a new subfolder |
| Create File | Directories only | Create a new file in this folder |
| Archive | Specific directories | Move to archive location (only appears for PARA-aligned directories) |
| Delete | Files & Directories | Remove permanently (requires confirmation) |

[ img: Context menu on file ]

### Reload

Tap the refresh icon (♻) in the header to reload the file tree. This fetches the latest state from your vault, useful if files changed outside the app.

## View Modes

The left pane has two modes, toggled by tapping the header title:

### Files Mode

The default view showing your vault's folder structure. Use this to browse and navigate.

### Tasks Mode

Shows a consolidated list of tasks (checkboxes) from across your vault.

[ img: Tasks view showing checkboxes from multiple files ]

Each task shows:
- The task text (checkbox state indicated visually)
- Source file path

**Interaction**: Tap a task to toggle its checkbox state. The change writes back to the source file. Tap the file path to open that file in the viewer.

## Search

Tap the search icon (magnifying glass) to enter search mode.

[ img: Search header with mode toggle ]

### File Search

Search by filename. Results show matching file paths. Tap a result to open the file.

[ img: File search results ]

### Content Search

Search within file contents. Results show files containing matches with expandable snippets.

[ img: Content search results with snippets ]

- **Tap result**: Open the file in viewer
- **Expand arrow**: Show matched text snippets from that file

### Clearing Search

Tap the X button to exit search mode and return to the file tree.

## Content Viewer

The right pane displays file content based on file type.

### Markdown Files

Markdown renders with full formatting: headers, lists, bold, italic, code blocks, tables, and more.

[ img: Markdown viewer with formatted content ]

**Wiki-links**: Tap `[[wiki-style links]]` to navigate to the linked file.

**Images**: Embedded images (`![[image.png]]`) display inline.

### Adjust Mode

For markdown files, tap the **Adjust** button to enter edit mode.

[ img: Adjust mode with editor ]

- The content becomes editable
- Make your changes
- Tap **Save** to write changes back to the file
- Tap **Cancel** to discard changes

Changes are saved directly to your vault. If the save fails, your changes are preserved so you can retry.

### Pair Writing Mode

For longer writing sessions, tap the **Pair Writing** button in the markdown viewer toolbar to enter a split-pane editing experience with AI assistance.

[ img: Pair Writing split-pane view ]

**Availability**: Pair Writing is designed for larger screens. The button is hidden on phones but visible on tablets and desktops where the split layout is practical.

#### Layout

The screen splits into two panes:
- **Left pane**: Markdown editor with your document
- **Right pane**: AI conversation for writing assistance

Both panes share the same Think session, so conversation context persists if you exit and return.

#### Quick Actions

Quick action buttons apply specific transformations to selected text or the entire document:

| Action | Effect |
|--------|--------|
| Tighten | Remove unnecessary words, make prose more concise |
| Embellish | Add detail, expand descriptions, enrich language |
| Correct | Fix grammar, spelling, and punctuation |
| Polish | Light overall improvement without changing voice |

Select text before tapping to transform just that selection. With no selection, the action applies to the full document.

#### Advisory Actions

Advisory actions don't modify your text directly. Instead, they provide feedback in the conversation pane:

| Action | Purpose |
|--------|---------|
| Validate | Check claims, consistency, and accuracy |
| Critique | Identify weaknesses and suggest improvements |
| Compare | Compare current version against a snapshot |
| Discuss | Open-ended conversation about the document |

#### Snapshots

Tap **Snapshot** to save the current document state. Use snapshots to:
- Mark a "known good" version before major changes
- Create comparison points for the Compare action
- Track progress across editing sessions

Snapshots are stored in the session and persist across tab switches.

### Images

Image files display with pan and zoom controls.

[ img: Image viewer with zoom controls ]

### Videos

Video files play in an embedded player with standard controls.

### PDFs

PDF files render page by page with navigation controls.

### JSON Files

JSON displays with syntax highlighting and proper indentation. Adjust mode is available for editing.

### Plain Text

`.txt` files display as plain text. Adjust mode is available for editing.

### CSV Files

CSV files render as tables for easy reading.

### Other Files

Unsupported file types show a download button to save the file locally.

## Recall Widgets

When viewing a file that matches a widget's source pattern, contextual widgets appear in a collapsible panel below the viewer.

[ img: Recall widgets panel expanded ]

These widgets show data related to the current file, such as:
- Similarity scores to other items
- Aggregated statistics for the collection
- Editable fields for frontmatter updates

See the [Widgets documentation](../widgets/README.md) for configuration details.

### Editing via Widgets

Some widgets support inline editing. For example, a rating widget might show a slider to adjust a file's rating directly without opening the markdown editor.

[ img: Widget with editable slider ]

## Mobile Navigation

On mobile, the file tree is hidden by default to maximize viewer space.

[ img: Mobile view with menu button ]

- **Menu button** (three lines): Opens the file tree as a slide-in overlay
- **Tap outside**: Closes the overlay
- **Select file**: Opens in viewer and closes overlay automatically

[ img: Mobile file tree overlay ]

## Header Bar

The header shows the current file path and provides quick actions.

[ img: Header bar with file path and actions ]

- **File path**: Shows which file is currently displayed
- **Collapse/expand**: Toggle the file tree visibility (desktop)

## Typical Workflows

### Finding a Specific Note

1. Use file search to find by name
2. Or navigate the folder structure
3. Tap to open in viewer
4. Use wiki-links to navigate related notes

### Reviewing Daily Notes

1. From Ground, tap **View** on a recent capture
2. Recall opens with that daily note
3. Read through your timestamped captures
4. Navigate to linked notes as needed

### Quick Edit

1. Find and open the file
2. Tap **Adjust** to enter edit mode
3. Make your changes
4. Tap **Save** to persist

### Task Review

1. Switch to Tasks mode via header
2. See all uncompleted tasks across vault
3. Toggle tasks as you complete them
4. Tap file paths to see context

### Content Discovery

1. Use content search with a keyword
2. Expand results to see matching snippets
3. Open promising files
4. Follow wiki-links to explore connections

### Image Review

1. Navigate to an image in the file tree
2. View renders with zoom capability
3. Pan and zoom to examine details

## Tips

- **Pin frequently used folders**: Speeds up navigation
- **Use content search for ideas**: Find where concepts appear across notes
- **Wiki-links are powerful**: Build a connected vault and navigate freely
- **Tasks mode for accountability**: See all your commitments in one place
- **Adjust mode for quick fixes**: No need to open Obsidian for small edits
