---
title: Image to WebP conversion on upload
date: 2026-02-14
status: draft
tags: [image-processing, webp, upload, optimization, compression]
modules: [file-upload]
related: [.lore/reference/think.md, .lore/retros/file-upload-asset-serving-migration-gap.md]
---

# Spec: Image to WebP Conversion on Upload

## Overview

All uploaded images are automatically converted to WebP format on the server before storage. This reduces file sizes while maintaining quality, improving storage efficiency and load times for image-heavy vaults. Conversion uses `cwebp` with `-m 6 -q 80` for static images and `-lossless` for animated content.

## Entry Points

How users trigger image conversion:
- User uploads image via FileAttachButton in Think mode (paperclip icon)
- User selects image from camera, gallery, or file picker
- User drags and drops image file into chat interface

All image uploads flow through `/api/vaults/:id/upload` route, which handles conversion before storage.

## Requirements

### Conversion Processing

- REQ-IMAGE-WEBP-1: All raster image uploads (PNG, JPG, GIF, BMP, AVIF, ICO (image/x-icon)) are converted to WebP format server-side
- REQ-IMAGE-WEBP-2: Existing WebP uploads are re-encoded with standardized settings for consistency (note: re-encoding lossy WebP may degrade quality or increase file size due to double compression; this is intentional for storage uniformity)
- REQ-IMAGE-WEBP-3: Static images use `cwebp -m 6 -q 80` (method 6 = highest compression quality, quality factor 80)
- REQ-IMAGE-WEBP-4: Animated images (GIF, animated WebP) use `cwebp -lossless` to preserve all frames
- REQ-IMAGE-WEBP-5: SVG files bypass conversion (vector format, stored as-is)
- REQ-IMAGE-WEBP-6: Non-image files (documents, videos, text) bypass conversion and are stored with their original extensions
- REQ-IMAGE-WEBP-7: Original uploaded file is discarded after successful conversion (only WebP version stored)
- REQ-IMAGE-WEBP-8: Converted files use `.webp` extension with existing filename generation pattern (`YYYY-MM-DD-image-XXXXX.webp`)

### Animation Detection

- REQ-IMAGE-WEBP-9: System detects animated GIFs by checking for multiple image descriptor blocks in the GIF file structure (implementation may use buffer inspection of the uploaded file or delegate to an image library)
- REQ-IMAGE-WEBP-10: System detects animated WebP files by checking the VP8X chunk flags in the WebP header for the animation bit
- REQ-IMAGE-WEBP-11: Animation detection fails safe: if file parsing throws an error or format is ambiguous, use lossless compression

### Fallback Behavior

- REQ-IMAGE-WEBP-12: If `cwebp` conversion fails (binary missing, unsupported format, processing error), store original file with its original extension (conversion happens in-memory; fallback writes the original buffer instead of converted output)
- REQ-IMAGE-WEBP-13: Fallback behavior logs warning with conversion failure details for debugging
- REQ-IMAGE-WEBP-14: Upload response indicates whether file was converted or stored as-is via `converted: boolean` field (example: `{ path: "/vault/path/to/file.webp", converted: true, originalFormat: "image/jpeg" }`)

### Infrastructure Dependencies

- REQ-IMAGE-WEBP-15: Upload API validates `cwebp` binary availability on startup [STUB: cwebp-deployment]
- REQ-IMAGE-WEBP-16: Missing `cwebp` binary logs error on startup but allows server to run (degrades to fallback behavior)
- REQ-IMAGE-WEBP-17: Runtime `cwebp` failures (non-zero exit code, timeout, missing binary) fall back to storing original file as per REQ-IMAGE-WEBP-12

## Exit Points

| Exit | Triggers When | Target |
|------|---------------|--------|
| File attached to chat | Conversion complete (or fallback) | Existing: Think mode chat input (FileAttachButton inserts path) |
| Upload error | Conversion fails and fallback fails | Existing: Error toast in UI |
| Binary missing warning | Server starts without cwebp | [STUB: cwebp-deployment] |

## Success Criteria

How we know this is done:
- [ ] PNG, JPG, GIF, BMP, AVIF, ICO uploads result in `.webp` files in vault attachments directory
- [ ] Static images use `-m 6 -q 80` settings (verified via output file)
- [ ] Animated GIFs retain all frames after conversion (test with known multi-frame sample)
- [ ] Animated WebP files retain all frames after re-encoding (test with known animated WebP sample)
- [ ] SVG uploads remain as `.svg` files (no conversion)
- [ ] Existing WebP files are re-encoded with standardized settings
- [ ] Upload succeeds with original file if cwebp fails
- [ ] PNG/JPG/GIF → WebP conversion reduces file size (test with at least 3 sample images)

## AI Validation

How the AI verifies completion before declaring done.

**Defaults**:
- Unit tests with mocked time/network/filesystem/LLM calls (including Agent SDK `query()`)
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

**Custom** (feature-specific):
- Test actual file conversion: verify input PNG/JPG → output WebP with `.webp` extension and WebP magic bytes (RIFF header with 'WEBP' tag)
- Test animation preservation: use a known multi-frame GIF (e.g., 10 frames) and verify the output WebP contains the same number of frames
- Test format detection: verify static vs animated detection logic with known static and animated samples
- Test fallback: verify original file stored when cwebp returns non-zero exit code
- Test SVG bypass: verify SVG uploads skip conversion and retain `.svg` extension
- Test WebP re-encoding: verify existing WebP files get re-encoded (output may be larger for lossy inputs due to double compression)
- Verify file size reduction: PNG/JPG/GIF → WebP reduces file size for at least 3 out of 5 sample images; WebP → WebP may vary
- Integration test: upload actual image files via API and verify stored WebP files with correct paths and metadata

## Constraints

### Performance

- Conversion must complete within upload timeout (currently no explicit timeout, but should be reasonable)
- Large images (approaching 10MB limit) may take several seconds to process
- Conversion happens synchronously during upload (user waits for completion)

### Storage

- Only converted WebP file is stored (no duplicate storage of originals)
- Vault attachment directory structure unchanged (`{vault}/06_Metadata/memory-loop/attachments/`)

### Format Support

- Only raster formats supported for conversion (PNG, JPG, GIF, BMP, AVIF, ICO, WebP)
- Vector formats (SVG) excluded from conversion
- Animated format support limited to GIF and WebP (no animated PNG support)

### Dependencies

- Requires `cwebp` binary available on server system (external dependency)
- Deployment/installation of cwebp is out of scope for this spec [STUB: cwebp-deployment]

## Context

### Related Lore

- `.lore/reference/think.md`: Documents existing file upload feature in Think mode (paperclip button, 10MB limit, attachment storage location)
- `.lore/retros/file-upload-asset-serving-migration-gap.md`: Describes upload API implementation in PR #475, emphasizes importance of end-to-end testing for route handlers

### Existing Infrastructure

**Current file upload flow** (`lib/file-upload.ts` + `/api/vaults/:id/upload`):
1. Multipart form data received at POST `/api/vaults/:id/upload`
2. File validation: type, size, security checks
3. Unique filename generation: `YYYY-MM-DD-{category}-XXXXX.ext`
4. Write to `{vault}/06_Metadata/memory-loop/attachments/`
5. Return file path to client

**WebP conversion insertion point**: After validation, before filename generation (because extension changes from `.jpg`/`.png` to `.webp`).

**Accepted MIME types** (current):
```typescript
const ACCEPTED_TYPES = {
  images: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
           "image/avif", "image/bmp", "image/x-icon"],
  // ... other categories
};
```

These MIME types remain valid (user can still upload all these formats), but PNG/JPG/GIF/BMP/AVIF/ICO get converted to WebP before storage.

### Research Findings

**No existing image processing**: The codebase currently has no image manipulation libraries (no `sharp`, `jimp`, etc. in dependencies). WebP conversion will use direct `cwebp` CLI binary invocation.

**No camera integration**: FileAttachButton accepts image files but doesn't use HTML5 `capture` attribute for direct camera access. This spec doesn't change that (camera access is separate feature).

**WebP already in MIME types**: `image/webp` is already an accepted upload type, so converted files are valid within existing validation rules.

### cwebp Command Reference

**Static images**:
```bash
cwebp -m 6 -q 80 input.jpg -o output.webp
```

**Animated images**:
```bash
cwebp -lossless input.gif -o output.webp
```

**Flags**:
- `-m 6`: Compression method (0-6, higher = slower but better compression)
- `-q 80`: Quality factor (0-100)
- `-lossless`: Preserve all image data (required for animations)

### Open Questions

None. Scope is clear: server-side conversion for all raster images, cwebp deployment is separate concern.
