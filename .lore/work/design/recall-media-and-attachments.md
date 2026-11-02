---
title: Recall media and attachments
date: 2026-11-02
status: draft
tags: [recall, media, attachments, uploads, design]
related: [.lore/work/intents/recall.md, .lore/work/design/recall-read-only.md]
---

# Recall media and attachments

## Purpose

Restore the remaining file-viewing and attachment capabilities described from the previous system. Recall should display useful vault content beyond Markdown and accept attachments from desktop and iPhone without turning into a general-purpose media editor.

Tracked in **memory-loop-j21**. This records the design discussion; it does not authorize implementation or claim that compatibility has been verified.

## Confirmed scope

- Display images as selected files in Recall.
- Display video using browser-supported playback.
- Display raw text files, including `.json`, `.ts`, and extensionless files such as `LICENSE`. Source is displayed as text, never executed.
- Show supported media embedded within Markdown notes, not only through direct file selection.
- Upload files and photos from desktop and iPhone into **`<vault-root>/06_Attachments/`**. The directory spelling is confirmed.
- Use the standard mobile file/photo picker. Allow camera capture where the platform offers it; a custom camera interface is not required. Choosing existing iPhone photos is the primary mobile use case.

Existing Markdown viewing, editing and file-management behavior remains available. Raw-text editing and additional media-editing tools are not implied by this viewing scope.

## Viewing direction

Recall's file list should expose the newly supported file kinds. Selecting a file chooses the appropriate Markdown, raw-text, image or video presentation while preserving the existing desktop sidebar and mobile Files workflow.

Images and video should fit the available reading area without changing the surrounding navigation model. Use native video controls rather than custom playback machinery. Keep working surfaces dark and retain the existing brand treatment.

Unsupported or unreadable content needs a clear explanation and a way to retrieve the original file. Browser support depends on image format and video container/codec, not simply the filename extension; do not make unsupported playback appear functional.

## Embedded media

The user explicitly included embedded media. The recommended syntax coverage is:

- Standard Markdown image references such as `![Description](relative/path.jpg)`.
- Obsidian media embeds such as `![[photo.jpg]]` and `![[clip.mp4]]`.

The exact syntax, filename-only resolution, ambiguity behavior, escaping and optional Obsidian sizing support still require implementation investigation. Do not silently guess between multiple matching files.

Resolve local references through the selected vault's daemon-owned file-access boundary. Embedded media is not permission to access arbitrary filesystem paths, traverse symlinks outside the supported boundary, execute active documents, or introduce unreviewed remote-resource fetching.

Internal note links, wiki-note navigation, heading fragments and embedded notes are separate from the confirmed media-embed scope. The original issue mentioned them, but this discussion did not settle their inclusion.

## Upload direction

Subsequent explicit user decisions: **zero-byte uploads must be rejected**, and
**slow uploads should time out**. These are intended product constraints, not
defects to remove. Retain the existing Next startup and timeout behavior; do not
introduce a custom server to extend upload duration.

Upload destinations are ordinary files in `06_Attachments/`, usable by Obsidian and filesystem tools. The daemon owns validation, filesystem writes and destination rules; the frontend presents selection, progress and outcomes through the existing Next-to-daemon boundary.

Preserve original files. Do not silently overwrite an existing attachment or perform lossy format conversion. Collision handling, upload size limits, batch behavior and progress/failure/retry semantics need concrete decisions before implementation. In particular, retries must not accidentally create duplicates or replace content after an uncertain response.

Camera availability is a platform capability, not a promise that every browser offers the same picker options. Validate the normal iPhone photo-selection path as well as desktop file selection.

## Compatibility investigation

iPhone photos and video can use HEIC/HEIF and HEVC. Do not assume universal browser display or playback. Determine which formats the intended browsers handle and whether a separately produced display derivative is useful. Any derivative policy must preserve the original and be explicit; conversion infrastructure is not yet an agreed requirement.

Other decisions include safe content-type handling, raw-text versus binary detection, media delivery and video range requests, private response caching, and supported image formats. Active formats must not become a route for executing uploaded code in the application's origin.

## Validation direction

Use controlled fixture vaults and representative files to verify direct image/video/text viewing, both proposed embed syntaxes, missing and ambiguous references, unsupported formats, safe vault-relative resolution, collisions, and failed uploads. Preserve existing Recall editing and file-action behavior.

Include desktop and narrow-screen visual review. Browser automation can establish supported fixture behavior; actual iPhone picker/camera/format behavior must be reported separately rather than inferred from a simulated phone viewport.

## Next step

Investigate the unresolved compatibility and upload details, then define an implementation plan and focused Impeccable design pass. Record significant implementation or deferred work in Beads rather than relying on this document as a task list.
