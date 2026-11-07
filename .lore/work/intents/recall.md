---
title: Read-only Recall
date: 2026-10-29
status: draft
tags: [recall, vault, configuration, markdown, intent]
related: [.lore/work/intents/project-restart.md]
---

# Read-only Recall

This intent describes the original read-only layer, not a permanent restriction on Recall. Later work added editing, search, media and uploads. Those capabilities and this direction remain revisable as needs change; see the [current application overview](../../../README.md) and [work boundaries](../../../ARCHITECTURE.md).

## Why this layer comes next

The four-tab frontend shell is the starting point. The next functional layer is read-only Recall, before Capture or Think. Quick capture remains the product's core capability, but Recall establishes shared foundations first: vault configuration, daemon file retrieval, and Markdown rendering. Think will need a vault to record chat history; establish that foundation without implementing chat yet.

This direction refines the broader [restart brief](project-restart.md). The existing Recall interior is a disposable placeholder, not a layout or workflow constraint.

## Vault configuration

Use a JSON configuration file with a value identifying the local vault directory. Start with one configured vault; multiple-vault discovery and selection are not part of this MVP.

JSON is deliberate: configuration should be capable of being updated from within the application later. Environment variables should not be the primary store for the vault-directory setting. An in-app settings editor is future work, not required in this layer.

The configuration file's location, exact key/schema, and reload behavior remain planning decisions. Configuration is application metadata, distinct from vault notes.

## Read-only browsing and reading

The daemon reads the configured vault and provides the file listing and selected Markdown file contents to the frontend. Filesystem access and vault-boundary enforcement belong in the daemon; the frontend presents the tree and renders the selected document.

- Show vault folders and files in a standard collapsible tree.
- Let the user expand and collapse folders and select a Markdown file.
- Selecting a Markdown file displays its rendered contents, not an editor or raw-source-only view.
- Keep the experience read-only: no note creation, edits, deletion, moves, renames, uploads, or vault-content writes.

Markdown is the supported content type for this MVP. Support for other media types is planned for later, not included now. How unsupported files appear in the tree remains open. Search is also outside this layer.

## Phone and desktop behavior

On mobile, the file tree is toggleable and occupies the full screen when shown. Selecting a file hides the tree and reveals the document. The user can reopen the tree to choose another file. Its initial mobile visibility remains a design decision.

On desktop, the tree is a side panel, visible by default, that can be toggled off so the document has more space. It can be shown again without leaving Recall.

The tree and document layout can replace the current placeholder completely. Preserve the four application destinations and the established personal-brand direction, not the placeholder's internal structure.

## Safety and boundaries

Read only within the configured vault. Do not expose arbitrary host filesystem paths or make the whole vault a public static directory. Render Markdown without allowing note content to execute scripts. Detailed path/symlink policy and Markdown/link handling belong in planning.

The existing private Tailscale preview does not by itself establish safe access to real vault contents. Deliberately choose daemon access controls and network exposure before serving notes through it.

Missing or invalid configuration, an inaccessible vault, and an unreadable or missing selected file must produce understandable states rather than pretend that the vault is empty or a document loaded successfully. Exact presentation is a design decision.

This layer does not implement Capture, AI, chat-history persistence, configuration editing, or general-purpose media viewing. It establishes the foundations those later capabilities can use without requiring their implementation now.

## Useful outcome

With a vault directory configured in JSON, the user can open Recall on phone or desktop, navigate folders, select an existing Markdown note, and read it without modifying the vault. Tree visibility follows the device-specific behavior above. The daemon supplies real vault data rather than frontend fixtures.
