---
title: Implementation plan for image-to-webp conversion
date: 2026-02-14
status: draft
tags: [implementation, plan, image-processing, webp]
modules: [file-upload, image-converter]
related: [.lore/specs/image-webp-conversion.md, .lore/retros/file-upload-asset-serving-migration-gap.md]
---

# Plan: Image to WebP Conversion on Upload

## Spec Reference

**Spec**: `.lore/specs/image-webp-conversion.md`

Requirements addressed:
- REQ-IMAGE-WEBP-1: Convert raster images to WebP → Steps 2, 3
- REQ-IMAGE-WEBP-2: Re-encode existing WebP → Steps 2, 3
- REQ-IMAGE-WEBP-3: Static images use `-m 6 -q 80` → Step 3
- REQ-IMAGE-WEBP-4: Animated images use `-lossless` → Steps 2, 3
- REQ-IMAGE-WEBP-5: SVG files bypass conversion → Step 2
- REQ-IMAGE-WEBP-6: Non-image files bypass conversion → Step 2
- REQ-IMAGE-WEBP-7: Discard original after conversion → Step 3
- REQ-IMAGE-WEBP-8: Use `.webp` extension with existing pattern → Step 4
- REQ-IMAGE-WEBP-9: Detect animated GIFs → Step 2
- REQ-IMAGE-WEBP-10: Detect animated WebP → Step 2
- REQ-IMAGE-WEBP-11: Animation detection fails safe → Step 2
- REQ-IMAGE-WEBP-12: Fallback to original on error → Step 3
- REQ-IMAGE-WEBP-13: Fallback logs warning → Step 3
- REQ-IMAGE-WEBP-14: Response includes conversion status → Step 4
- REQ-IMAGE-WEBP-15: Validate binary on startup → Step 5
- REQ-IMAGE-WEBP-16: Missing binary logs error but continues → Step 5
- REQ-IMAGE-WEBP-17: Runtime failures fall back → Step 3

## Codebase Context

### Current Upload Infrastructure

**Domain logic** (`nextjs/lib/file-upload.ts`):
- Entry point: `uploadFile(vaultPath, contentRoot, attachmentPath, fileBuffer, originalFilename)`
- Validates extension against `ALLOWED_FILE_EXTENSIONS` (already includes `.webp`)
- Size limits: images 10MB, videos 100MB, documents 25MB, text 5MB
- Filename pattern: `YYYY-MM-DD-{category}-XXXXX.ext`
- Returns `FileUploadResult` with success/path/error fields

**API route** (`nextjs/app/api/vaults/[vaultId]/upload/route.ts`):
- POST endpoint receives multipart form data
- Converts File to Buffer via `Buffer.from(await file.arrayBuffer())`
- Calls domain logic and returns JSON response

**Insertion point**: After validation, before filename generation in `uploadFile()`. The extension changes from `.jpg`/`.png` to `.webp`, so conversion must happen before `generateFilename()` is called.

### Binary Execution Pattern

From `nextjs/next.config.ts`:
```typescript
import { execSync } from "child_process";

try {
  return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
} catch {
  return "unknown";
}
```

Pattern established: `execSync` for synchronous execution with try/catch fallback. For runtime (upload), need async execution with timeout.

### Testing Infrastructure

From `nextjs/lib/__tests__/file-upload.test.ts`:
- Uses `bun:test` with temp directories via `tmpdir()`
- Tests actual file I/O (not just mocks)
- Validates both success and error paths
- Checks file content after write
- Tests security (path traversal, size limits)

**Critical lesson** from `.lore/retros/file-upload-asset-serving-migration-gap.md`: Tests that mock `fetch` stayed green when upload routes were missing. WebP conversion needs **end-to-end integration tests** that verify the full HTTP path: client → API route → conversion → storage → asset serving.

### What Doesn't Exist (To Be Built)

1. **Image format detection**: No buffer-based MIME detection (only extension checking)
2. **Animation detection**: No logic to check GIF/WebP for multiple frames
3. **Binary execution wrapper**: No async `cwebp` invocation with timeout/error handling
4. **Conversion module**: No `image-converter.ts` for conversion orchestration

## Implementation Steps

### Step 1: Create Image Converter Module Structure

**Files**:
- `nextjs/lib/utils/image-converter.ts` (new)
- `nextjs/lib/utils/__tests__/image-converter.test.ts` (new)

**Addresses**: Foundation for REQ-IMAGE-WEBP-1 through REQ-IMAGE-WEBP-17
**Expertise**: None needed

Create the module skeleton with type definitions and exports:

```typescript
// nextjs/lib/utils/image-converter.ts

export interface ConversionResult {
  buffer: Buffer;
  converted: boolean;
  originalFormat?: string;
  error?: string;
}

export interface ImageFormatInfo {
  format: 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'avif' | 'ico' | 'svg' | 'unknown';
  isAnimated: boolean;
}

// Placeholder functions to be implemented in Step 2
export async function detectImageFormat(buffer: Buffer): Promise<ImageFormatInfo>;
export async function convertToWebp(buffer: Buffer, originalFilename: string): Promise<ConversionResult>;
```

Set up test file with describe blocks for:
- Format detection (PNG, JPEG, GIF, WebP, BMP, AVIF, ICO, SVG)
- Animation detection (static vs animated GIF, static vs animated WebP)
- Conversion (static images, animated images, fallback scenarios)

No implementation yet—just structure and type definitions.

### Step 2: Implement Format and Animation Detection

**Files**:
- `nextjs/lib/utils/image-converter.ts`
- `nextjs/lib/utils/__tests__/image-converter.test.ts`

**Addresses**: REQ-IMAGE-WEBP-5, REQ-IMAGE-WEBP-6, REQ-IMAGE-WEBP-9, REQ-IMAGE-WEBP-10, REQ-IMAGE-WEBP-11
**Expertise**: None needed (buffer inspection is well-documented)

Implement `detectImageFormat()` using magic byte inspection:

**PNG detection**:
- Signature: `89 50 4E 47 0D 0A 1A 0A` (bytes 0-7)
- Always static (PNG spec doesn't support animation natively)
- Bounds check: buffer must be at least 8 bytes

**JPEG detection**:
- Signature: `FF D8 FF` (bytes 0-2)
- Always static
- Bounds check: buffer must be at least 3 bytes

**GIF detection**:
- Signature: `47 49 46 38` (bytes 0-3, ASCII "GIF8")
- Animation check: Look for multiple Image Descriptor blocks (`0x2C` separator)
- If more than one descriptor found, `isAnimated = true`
- Bounds check: buffer must be at least 4 bytes for signature, check length before scanning for descriptors

**WebP detection**:
- Signature: `52 49 46 46 ... 57 45 42 50` (RIFF...WEBP at bytes 0-11)
- Animation check: Parse VP8X chunk (if present) and check animation flag bit
- VP8X signature: `56 50 38 58` at chunk start
- Animation bit is in the flags field (byte 4 of VP8X data)
- Bounds check: buffer must be at least 12 bytes for RIFF header

**All buffer reads must check bounds**: If buffer is too short for header inspection (truncated file), treat as unknown format (triggers lossless fallback per REQ-IMAGE-WEBP-11).

**BMP/AVIF/ICO detection**:
- BMP: `42 4D` (bytes 0-1, ASCII "BM")
- AVIF: `66 74 79 70 61 76 69 66` at byte offset 4-11 (within ftyp box)
- ICO: `00 00 01 00` (bytes 0-3)
- All static formats

**SVG detection**:
- Text-based format, check for `<svg` or `<?xml` at start
- Return format as 'svg' to trigger bypass

**Unknown format**:
- If no signatures match, return format as 'unknown'
- Per REQ-IMAGE-WEBP-11, fail safe: use lossless compression if format ambiguous

**Error handling**:
- Wrap detection in try/catch
- On parse error, return `{ format: 'unknown', isAnimated: false }` to trigger lossless fallback
- Log error via logger: `log.warn("Format detection failed, falling back to lossless")`

**Tests**:
- Create sample buffers for each format (minimal valid headers)
- Test PNG/JPEG/BMP/AVIF/ICO return correct format + static
- Test static GIF (single frame) returns GIF + static
- Test animated GIF (multiple frames) returns GIF + animated
- Test static WebP returns WebP + static
- Test animated WebP returns WebP + animated
- Test SVG returns SVG (to trigger bypass)
- Test unknown format returns unknown + static
- Test malformed buffer triggers error path and returns unknown

### Step 3: Implement WebP Conversion via cwebp Binary

**Files**:
- `nextjs/lib/utils/image-converter.ts`
- `nextjs/lib/utils/__tests__/image-converter.test.ts`

**Addresses**: REQ-IMAGE-WEBP-1, REQ-IMAGE-WEBP-2, REQ-IMAGE-WEBP-3, REQ-IMAGE-WEBP-4, REQ-IMAGE-WEBP-7, REQ-IMAGE-WEBP-12, REQ-IMAGE-WEBP-13, REQ-IMAGE-WEBP-17
**Expertise**: None needed

Implement `convertToWebp()`:

```typescript
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink } from "fs/promises";
import { randomBytes } from "crypto";
import { join } from "path";
import { tmpdir } from "os";
import { createLogger } from "../logger";

const execAsync = promisify(exec);
const log = createLogger("ImageConverter");

export async function convertToWebp(
  buffer: Buffer,
  originalFilename: string,
  execFn: typeof execAsync = execAsync  // Dependency injection for testing
): Promise<ConversionResult> {
  const formatInfo = await detectImageFormat(buffer);

  // SVG bypass (REQ-IMAGE-WEBP-5)
  if (formatInfo.format === 'svg') {
    log.debug(`SVG detected, bypassing conversion: ${originalFilename}`);
    return {
      buffer,
      converted: false,
    };
  }

  // Unknown format bypass (no conversion support)
  if (formatInfo.format === 'unknown') {
    log.warn(`Unknown format detected, bypassing conversion: ${originalFilename}`);
    return {
      buffer,
      converted: false,
    };
  }

  // Determine cwebp flags based on animation
  const flags = formatInfo.isAnimated
    ? '-lossless'  // REQ-IMAGE-WEBP-4
    : '-m 6 -q 80'; // REQ-IMAGE-WEBP-3

  // Create temp files for input/output (cwebp requires file paths)
  // Use crypto-random bytes to avoid collisions under high load
  const tempInput = join(tmpdir(), `webp-${randomBytes(8).toString('hex')}.input`);
  const tempOutput = join(tmpdir(), `webp-${randomBytes(8).toString('hex')}.webp`);

  try {
    // Write input buffer to temp file
    await writeFile(tempInput, buffer);

    // Execute cwebp with 30-second timeout
    // Timeout allows 10MB images to convert on slower hardware
    const command = `cwebp ${flags} "${tempInput}" -o "${tempOutput}"`;
    log.debug(`Converting ${originalFilename}: ${command}`);

    await execFn(command, { timeout: 30000 }); // 30s timeout for large images

    // Read converted output
    const convertedBuffer = await readFile(tempOutput);

    // Clean up temp files
    await Promise.all([
      unlink(tempInput).catch(() => {}),
      unlink(tempOutput).catch(() => {}),
    ]);

    log.info(`Converted ${originalFilename} (${formatInfo.format}) to WebP: ${buffer.length} → ${convertedBuffer.length} bytes`);

    return {
      buffer: convertedBuffer,
      converted: true,
      originalFormat: `image/${formatInfo.format}`,
    };
  } catch (error) {
    // Fallback: return original buffer (REQ-IMAGE-WEBP-12, REQ-IMAGE-WEBP-17)
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`Conversion failed for ${originalFilename}, storing original: ${message}`); // REQ-IMAGE-WEBP-13

    // Clean up temp files on error
    await Promise.all([
      unlink(tempInput).catch(() => {}),
      unlink(tempOutput).catch(() => {}),
    ]);

    return {
      buffer, // Original buffer
      converted: false,
      error: message,
    };
  }
}
```

**Tests**:
- Pass mock `execFn` to `convertToWebp()` for testing (dependency injection avoids `mock.module()` per project constraints)
- Mock successful conversion: `execFn` resolves, mock `readFile` returns fake WebP buffer
- Mock conversion failure: `execFn` throws error, verify fallback returns original buffer
- Test static image conversion (PNG → WebP with `-m 6 -q 80`)
- Test animated image conversion (GIF → WebP with `-lossless`)
- Test WebP re-encoding (WebP → WebP with appropriate flags)
- Test timeout: mock `execFn` rejects with timeout error after 30s
- Test missing binary: mock `execFn` throws ENOENT error
- Verify temp files cleaned up in both success and error paths (mock `unlink` calls)
- Verify logging (info on success, warn on failure)

**Testing approach**: Use dependency injection. `convertToWebp()` accepts optional `execFn` parameter (defaults to `execAsync`). Tests pass mock function. Also mock `writeFile`, `readFile`, `unlink`. This avoids `mock.module()` which is prohibited by project constraints.

### Step 4: Integrate Conversion into Upload Flow

**Files**:
- `nextjs/lib/file-upload.ts`
- `nextjs/lib/__tests__/file-upload.test.ts`

**Addresses**: REQ-IMAGE-WEBP-1, REQ-IMAGE-WEBP-8, REQ-IMAGE-WEBP-14
**Expertise**: None needed

Modify `uploadFile()` to call conversion before filename generation:

**Integration point**: After size validation (line 155), before `generateFilename()` (line 158). This ensures size limits apply to the original upload size as the spec defines (images 10MB), not post-conversion sizes.

**Changes to `uploadFile()`**:
1. After size validation, check if file category is `image` using `getFileCategory(ext)`
2. Only proceed with conversion for image category files (REQ-IMAGE-WEBP-6: non-images bypass)
3. For images, check if raster format (exclude SVG via extension check: `ext === '.svg'`)
4. If raster image, call `convertToWebp(buffer, originalFilename)`
5. Use converted buffer for subsequent steps, update extension if converted:
   ```typescript
   const finalExtension = conversionResult.converted ? '.webp' : ext;
   const finalBuffer = conversionResult.buffer;
   const filename = generateFilename(finalExtension);
   ```
6. Write `finalBuffer` to disk instead of original `fileBuffer`
7. Return extended `FileUploadResult` with conversion metadata

**Updated return type**:
```typescript
export interface FileUploadResult {
  success: boolean;
  path?: string;
  error?: string;
  converted?: boolean;       // REQ-IMAGE-WEBP-14
  originalFormat?: string;   // REQ-IMAGE-WEBP-14
}
```

**API route changes**: None required. Route already returns the full `FileUploadResult` as JSON, so new fields will be included automatically.

**Tests**:
- Test PNG upload → WebP file created with correct path pattern (`YYYY-MM-DD-image-XXXXX.webp`)
- Test JPEG upload → WebP file created
- Test GIF upload (animated) → WebP file created
- Test WebP upload → Re-encoded WebP file created
- Test SVG upload → SVG file created (no conversion) - REQ-IMAGE-WEBP-5
- Test PDF upload → PDF file created (no conversion) - REQ-IMAGE-WEBP-6
- Test video upload → Video file created (no conversion) - REQ-IMAGE-WEBP-6
- Test text upload → Text file created (no conversion) - REQ-IMAGE-WEBP-6
- Test conversion failure → Original file stored with original extension
- Test response includes `converted: true` and `originalFormat: "image/png"` when conversion succeeds
- Test response includes `converted: false` when conversion fails or is bypassed
- **End-to-end integration test**: Mock HTTP multipart upload (FormData with actual image buffer), verify full flow including API route, check file exists on disk with WebP magic bytes

### Step 5: Add Binary Availability Check on Startup

**Files**:
- `nextjs/instrumentation.ts` (if exists) or create new startup module
- `nextjs/lib/utils/image-converter.ts`

**Addresses**: REQ-IMAGE-WEBP-15, REQ-IMAGE-WEBP-16
**Expertise**: None needed

Add startup validation that `cwebp` binary is available:

**In `image-converter.ts`**:
```typescript
export async function checkCwebpAvailability(): Promise<boolean> {
  try {
    await execAsync('cwebp -version', { timeout: 5000 });
    log.info('cwebp binary found and available');
    return true;
  } catch (error) {
    log.error('cwebp binary not found - WebP conversion will fall back to original files');
    return false;
  }
}
```

**In `instrumentation.ts`**:
```typescript
import { checkCwebpAvailability } from './lib/utils/image-converter';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Check cwebp on server startup
    await checkCwebpAvailability();
    // Server continues regardless of result (REQ-IMAGE-WEBP-16)
  }
}
```

**Tests**:
- Mock successful `cwebp -version` execution → returns true, logs info
- Mock failed execution (ENOENT) → returns false, logs error
- Verify server doesn't crash when binary missing

**Note**: Per spec, missing binary logs error but allows server to run. All uploads will fall back to storing originals when binary is unavailable.

### Step 6: Validate Against Spec

**Files**: All implementation files
**Addresses**: All requirements (verification step)
**Expertise**: None needed

Use the Task tool to invoke the `spec-reviewer` agent with the spec path `.lore/specs/image-webp-conversion.md`. The agent will:
- Read the spec and all requirements
- Review the implementation code
- Flag any requirements not met
- Verify all success criteria are testable

**Validation checklist**:
- All 17 requirements addressed in code
- Success criteria met (all checkboxes from spec)
- Custom AI validation tests implemented (format detection, animation preservation, fallback, etc.)
- End-to-end integration test verifies full HTTP path (client → API → conversion → storage → serving)
- Fallback behavior tested and working
- Logging present for all error paths (conversion failure, binary missing, format detection errors)

Address all gaps identified by the agent before declaring implementation complete. This step is not optional.

## Delegation Guide

Steps requiring specialized expertise: None. This is a straightforward integration task.

If domain-specific agents are needed during implementation (security review, performance audit), consult `.lore/lore-agents.md` (if it exists).

## Open Questions

None. Scope is clear from spec. Binary deployment (`[STUB: cwebp-deployment]`) is out of scope.

## Implementation Notes

**Conversion happens synchronously during upload**: Users wait for conversion to complete. For 10MB images, `cwebp -m 6` can take several seconds. This is acceptable per spec constraints (no explicit timeout, synchronous upload flow).

**Temp file cleanup**: Conversion requires temp files (cwebp operates on file paths, not stdin/stdout). Always clean up temp files in both success and error paths to prevent disk bloat.

**Testing strategy**:
1. Unit tests: Mock all external dependencies (`execAsync`, file I/O)
2. Integration tests: Test full upload flow with mocked HTTP request
3. End-to-end tests: Verify asset serving returns converted WebP files

**Double compression caveat**: Per spec REQ-IMAGE-WEBP-2, re-encoding existing WebP may increase file size or degrade quality. This is intentional for storage uniformity and is explicitly noted in the spec.
