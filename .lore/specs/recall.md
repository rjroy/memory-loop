# Feature: Recall

## What It Does

Recall is a file browser for your Obsidian vault. Navigate the directory tree, view markdown files with full rendering, search by name or content, and access images, PDFs, and other assets.

**Tab**: Fourth in toolbar: `[ Ground ][ Capture ][ Think ][ Recall ]`
**Internal mode**: `"browse"`

## UI Layout

```
┌─────────────┬───────────────────────┐
│  Tree Pane  │   Viewer Pane         │
│             │                       │
│  [Search] ♻ │  Breadcrumb Path      │
│             │                       │
│  📁 Root    │  Rendered Markdown    │
│  📁 Folder  │  or Image/Video/PDF   │
│  📄 File.md │  or Download Link     │
│             │                       │
└─────────────┴───────────────────────┘
```

**Mobile**: Tree pane becomes an overlay triggered by hamburger button.

## Capabilities

- **Directory navigation**: Expand/collapse folders, lazy-loaded
- **Markdown viewing**: Full rendering with wiki-links, images, tables
- **File search**: Fuzzy name search or full-text content search
- **Multiple viewers**: Markdown, JSON, images, video, PDF, download fallback
- **Wiki-link navigation**: Click `[[other-note]]` to jump to that file
- **Breadcrumb navigation**: Click any path segment to go there
- **Cross-feature integration**: "View" from Ground, "Open source" from cards

## File Tree

### Lazy Loading

Directories load on-demand when expanded:
1. User clicks folder chevron
2. REST call: `GET /api/vaults/{id}/files?path={folder}`
3. Children cached in SessionContext
4. Subsequent clicks use cache (refresh button clears it)

### Sorting

- Directories first, then files
- Alphabetical within each group
- Hidden files (`.` prefix) filtered out

### Expand/Collapse

- Chevron rotates on expand
- Spinner during load
- Indentation increases with depth

## Viewers

| Extension | Viewer | Loads Content? |
|-----------|--------|----------------|
| `.md` | MarkdownViewer | Yes (REST) |
| `.json` | JsonViewer | Yes (REST) |
| `.txt`, `.csv` | TextViewer | Yes (REST) |
| `.png`, `.jpg`, `.gif` | ImageViewer | No (asset URL) |
| `.mp4`, `.webm` | VideoViewer | No (asset URL) |
| `.pdf` | PdfViewer | No (asset URL) |
| Other | DownloadViewer | No (download link) |

### Markdown Rendering

- **react-markdown** with GFM plugin (tables, strikethrough)
- **Wiki-links**: `[[note]]` → clickable, navigates within Recall
- **Images**: Relative paths converted to asset URLs
- **Frontmatter**: YAML blocks parsed but not rendered

### Content Limits

- 1MB max file size for text content
- Larger files truncated with warning
- Images/video served directly (browser handles)

## Search

### Activation

Click search icon in tree header → input appears

### Modes

| Mode | API | What It Matches |
|------|-----|-----------------|
| File name | `GET /search/files?q=` | Fuzzy match on file names |
| Content | `GET /search/content?q=` | Full-text within file bodies |

### Behavior

- 250ms debounce (prevents API spam while typing)
- Results show match count
- Content results expandable → shows context snippets
- Click result → opens file in viewer

## Navigation

### Wiki-Link Click

1. Click `[[other-note]]` in rendered markdown
2. Appends `.md` if missing
3. Fetches and displays target file
4. Tree doesn't auto-expand (file may be anywhere)

### Breadcrumb Click

Path: `Root / notes / daily / 2026-01-28.md`

Click "notes" → navigates to that directory, shows listing in tree

### Cross-Feature Navigation

| Source | Action | Effect |
|--------|--------|--------|
| Ground "View capture" | Click | Opens daily note in Recall |
| Cards "Open source" | Click | Opens source note in Recall |
| Cards "Open" | Click | Opens card file in Recall |

## Security

### Path Traversal Prevention

Multi-layer defense:
1. **Frontend**: Paths come from server-validated entries
2. **Backend route**: URL decoding, parameter extraction
3. **Core validation**: `realpath()` + prefix check

### Rejected Patterns

- `../../../etc/passwd` → Path escapes vault
- Symbolic links → Rejected at `lstat()` check
- Hidden files (`.git/`, `.env`) → Filtered from listings

## Implementation

### Files Involved

| File | Role |
|------|------|
| `frontend/src/components/browse/BrowseMode.tsx` | Main container |
| `frontend/src/components/browse/FileTree.tsx` | Directory tree |
| `frontend/src/components/browse/SearchHeader.tsx` | Search input |
| `frontend/src/components/browse/SearchResults.tsx` | Search results |
| `frontend/src/components/browse/viewers/MarkdownViewer.tsx` | Markdown rendering |
| `frontend/src/hooks/useFileBrowser.ts` | REST client |
| `frontend/src/hooks/useSearch.ts` | Search REST client |
| `backend/src/routes/files.ts` | File REST endpoints |
| `backend/src/file-browser.ts` | Core file operations |
| `backend/src/search/search-index.ts` | Search implementation |

### REST API

| Endpoint | Purpose |
|----------|---------|
| `GET /files?path=` | Directory listing |
| `GET /files/{path}` | Read file content |
| `PUT /files/{path}` | Write file |
| `POST /files` | Create file |
| `DELETE /files/{path}` | Delete file |
| `PATCH /files/{path}` | Rename/move |
| `GET /search/files?q=` | File name search |
| `GET /search/content?q=` | Content search |
| `GET /search/snippets?path=&q=` | Context around matches |

### Caching

- Directory contents cached in SessionContext
- Persists during session, cleared on refresh button
- Reduces redundant API calls

## View Toggle: Files / Tasks

The tree pane header toggles between two views:

| View | Header Text | Content |
|------|-------------|---------|
| Files | "Files" | Directory tree navigation |
| Tasks | "Tasks" | Task list from vault |

Click the header text to toggle. Both views share the same pane location.

See [Task List](./task-list.md) for full documentation of the Tasks view.

## Connected Features

| Feature | Relationship |
|---------|-------------|
| [Ground](./home-dashboard.md) | "View" button opens captures here |
| [Spaced Repetition](./spaced-repetition.md) | "Open" and "Open source" navigate here |
| [Think](./think.md) | Claude's Read tool shows files from here |
| [Capture](./capture.md) | Daily notes viewable here |
| [Pair Writing](./pair-writing.md) | AI-assisted editing from markdown viewer |
| [Task List](./task-list.md) | Alternative view in same pane |

## Notes

- Mobile tree is overlay (doesn't shrink viewer)
- Context menu on right-click: pin, delete, rename, move, "Think about"
- Pinned folders appear at top of tree for quick access
- Asset URLs: `/vault/{vaultId}/assets/{path}` (direct file serving)
- Pair Writing mode available in desktop viewer (split editor + AI)
