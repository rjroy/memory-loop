---
title: Implementation notes: image-webp-conversion
date: 2026-02-14
status: complete
tags: [implementation, notes, image-processing, webp]
source: .lore/plans/image-webp-conversion.md
modules: [file-upload, image-converter]
---

# Implementation Notes: Image-to-WebP Conversion

## Summary

Completed 6-phase implementation of automatic WebP conversion for uploaded images. Static raster images (PNG, JPEG, BMP, static GIF, static WebP) are converted to WebP format using `cwebp -m 6 -q 80` before storage. Animated images, SVG, and non-image files bypass conversion and store as originals.

**Key divergence**: REQ-IMAGE-WEBP-4 (animated image conversion with lossless) was replaced with "store animated images as originals" due to `cwebp` binary limitations (requires `gif2webp` for animated GIF support). User approved this divergence during Phase 3.

**Test coverage**: 103 total tests across image-converter (46), file-upload (58), and instrumentation (6). All tests passing. Uses dependency injection throughout to avoid `mock.module()` per project constraints.

**Files implemented**:
- `nextjs/lib/utils/image-converter.ts` - Format detection and conversion logic
- `nextjs/lib/file-upload.ts` - Upload flow integration
- `nextjs/instrumentation.ts` - Startup binary check
- `nextjs/app/api/vaults/[vaultId]/upload/route.ts` - API response metadata

## Progress
- [x] Phase 1: Create Image Converter Module Structure
- [x] Phase 2: Implement Format and Animation Detection
- [x] Phase 3: Implement WebP Conversion via cwebp Binary
- [x] Phase 4: Integrate Conversion into Upload Flow
- [x] Phase 5: Add Binary Availability Check on Startup
- [x] Phase 6: Validate Against Spec

## Log

### Phase 1: Create Image Converter Module Structure
- **Dispatched**: Create skeleton files with type definitions and test structure
- **Result**: Created `lib/utils/image-converter.ts` with `ConversionResult` and `ImageFormatInfo` interfaces, placeholder functions; created test file with 29 skipped test cases covering all spec scenarios
- **Tests**: Initial linting failures due to unused parameters in placeholders; fixed with underscore prefixes and eslint-disable comments
- **Review**: Clean structure, types match spec requirements, test coverage plan is thorough
- **Note**: Review flagged that Phase 3 will need dependency injection for `execAsync`, `writeFile`, `readFile`, `unlink` - current signature only has `buffer` and `originalFilename`

### Phase 2: Implement Format and Animation Detection
- **Dispatched**: Implement `detectImageFormat()` with magic byte inspection for PNG, JPEG, GIF, WebP, BMP, AVIF, ICO, SVG; add animation detection for GIF/WebP
- **Result**: Implemented format detection with bounds checking, animation detection via GIF frame counting and WebP VP8X chunk parsing; 15 tests passing
- **Tests**: All format detection tests passing (22 tests total after fixes)
- **Review**: Found 3 critical issues: (1) animation detection fail-safe was backwards (returned `false` on error instead of `true`), (2) GIF parser didn't skip Global Color Table, (3) SVG detection too permissive (any XML file). All fixed.
- **Resolution**: Fixed fail-safe to return `true` (animated) on error per REQ-IMAGE-WEBP-11; added GCT skip logic to GIF parser; improved SVG detection to check for `<svg` tag in first 512 bytes (with or without `<?xml` preamble); removed dead code. All tests passing.

### Phase 3: Implement WebP Conversion via cwebp Binary
- **Dispatched**: Implement `convertToWebp()` with cwebp binary execution, dependency injection for testing
- **Result**: Implemented conversion with temp file handling, error fallback, logging; 43 tests passing
- **Tests**: All conversion tests passing; dependency injection pattern works without `mock.module()`
- **Review**: Found 2 critical issues: (1) `cwebp` cannot preserve animation in GIFs (requires `gif2webp`), (2) command injection risk via `exec` with string interpolation. User decided to bypass animated images entirely.
- **Resolution**: Changed to skip conversion for animated images (store originals); replaced `exec` with `execFile` for security; updated tests. Diverges from REQ-IMAGE-WEBP-4 (see Divergence section).

### Phase 4: Integrate Conversion into Upload Flow
- **Dispatched**: Integrate conversion into `uploadFile()` after validation, before filename generation; update return type with conversion metadata
- **Result**: Added conversion call for raster images; extension changes to `.webp` on success; returns `converted` and `originalFormat` fields
- **Tests**: 57 tests passing (10 new conversion integration tests); uses real file I/O and real `cwebp` binary per plan's end-to-end testing requirement
- **Review**: Flagged REQ-IMAGE-WEBP-4 violation (animated bypass), but this is the documented divergence. Noted ICO format may fail conversion (acceptable, falls back). Suggested test naming improvements for fallback scenarios.
- **Resolution**: No changes needed. REQ-IMAGE-WEBP-4 divergence is approved. ICO fallback is acceptable per REQ-IMAGE-WEBP-12. Integration complete.

### Phase 5: Add Binary Availability Check on Startup
- **Dispatched**: Add `checkCwebpAvailability()` function and integrate into `instrumentation.ts` startup
- **Result**: Added startup check with 5-second timeout; logs info on success, error on failure; server continues regardless per REQ-IMAGE-WEBP-16
- **Tests**: 46 tests in image-converter (removed 1 non-deterministic), 6 tests in instrumentation (improved coverage)
- **Review**: Found instrumentation tests calling mocks instead of real code, and one test calling real system binary. Fixed by adding dependency injection to `register()` and removing non-deterministic test.
- **Resolution**: Added DI pattern to `register()` matching rest of codebase; tests now call real register() with mocked deps; all tests passing.

### Phase 6: Validate Against Spec
- **Dispatched**: Invoke `spec-reviewer` agent with spec path to validate implementation against all requirements
- **Result**: Spec reviewer confirmed 16 of 17 requirements met (REQ-IMAGE-WEBP-4 is documented divergence); found critical issue: API route not returning conversion metadata
- **Tests**: 58 tests passing in file-upload after fix (added API metadata test)
- **Review**: Spec validation identified API response missing `converted` and `originalFormat` fields (REQ-IMAGE-WEBP-14 violation)
- **Resolution**: Updated API route to include conversion metadata in response; added integration test. All spec requirements now met except documented REQ-IMAGE-WEBP-4 divergence.

## Divergence

- **REQ-IMAGE-WEBP-4 (Animated image conversion)**: Spec requires animated images use `cwebp -lossless` to preserve frames. Implementation instead bypasses animated images and stores originals unchanged. **Reason**: `cwebp` cannot handle animated GIF input (produces static output); correct tool is `gif2webp` which adds deployment complexity. User chose to defer animation optimization rather than add additional binary dependency. **Status**: Approved (user decision during Phase 3).
