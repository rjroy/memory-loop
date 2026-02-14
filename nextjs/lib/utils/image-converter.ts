/**
 * Image format conversion utilities for Memory Loop
 *
 * Handles detection and conversion of various image formats to WebP for storage optimization.
 * Supports both static and animated images where applicable.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile as writeFileDefault, readFile as readFileDefault, unlink as unlinkDefault } from "fs/promises";
import { randomBytes } from "crypto";
import { join } from "path";
import { tmpdir } from "os";
import { createLogger } from '../logger';

const execFileAsyncDefault = promisify(execFile);
const log = createLogger('ImageConverter');

/**
 * Result of an image conversion operation
 */
export interface ConversionResult {
  /** The converted image buffer (or original if conversion not needed/failed) */
  buffer: Buffer;
  /** Whether conversion was performed */
  converted: boolean;
  /** Original format detected (if applicable) */
  originalFormat?: string;
  /** Error message if conversion failed */
  error?: string;
}

/**
 * Information about a detected image format
 */
export interface ImageFormatInfo {
  /** Detected image format */
  format: 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'avif' | 'ico' | 'svg' | 'unknown';
  /** Whether the image contains animation frames */
  isAnimated: boolean;
}

/**
 * Detects the format of an image from its buffer data
 *
 * Uses magic byte signatures to identify format. For GIF and WebP, also
 * detects animation status by parsing format-specific structures.
 *
 * @param buffer - Raw image data
 * @returns Format information including type and animation status
 */
export function detectImageFormat(buffer: Buffer): ImageFormatInfo {
  try {
    // PNG: 89 50 4E 47 0D 0A 1A 0A (8 bytes)
    if (buffer.length >= 8 &&
        buffer[0] === 0x89 && buffer[1] === 0x50 &&
        buffer[2] === 0x4E && buffer[3] === 0x47 &&
        buffer[4] === 0x0D && buffer[5] === 0x0A &&
        buffer[6] === 0x1A && buffer[7] === 0x0A) {
      return { format: 'png', isAnimated: false };
    }

    // JPEG: FF D8 FF (3 bytes)
    if (buffer.length >= 3 &&
        buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return { format: 'jpeg', isAnimated: false };
    }

    // GIF: 47 49 46 38 (4 bytes, ASCII "GIF8")
    if (buffer.length >= 4 &&
        buffer[0] === 0x47 && buffer[1] === 0x49 &&
        buffer[2] === 0x46 && buffer[3] === 0x38) {
      const isAnimated = detectGifAnimation(buffer);
      return { format: 'gif', isAnimated };
    }

    // WebP: 52 49 46 46 ... 57 45 42 50 (RIFF...WEBP, 12 bytes)
    if (buffer.length >= 12 &&
        buffer[0] === 0x52 && buffer[1] === 0x49 &&
        buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 &&
        buffer[10] === 0x42 && buffer[11] === 0x50) {
      const isAnimated = detectWebpAnimation(buffer);
      return { format: 'webp', isAnimated };
    }

    // BMP: 42 4D (2 bytes, ASCII "BM")
    if (buffer.length >= 2 &&
        buffer[0] === 0x42 && buffer[1] === 0x4D) {
      return { format: 'bmp', isAnimated: false };
    }

    // AVIF: 66 74 79 70 61 76 69 66 at offset 4-11 (ftyp box)
    if (buffer.length >= 12 &&
        buffer[4] === 0x66 && buffer[5] === 0x74 &&
        buffer[6] === 0x79 && buffer[7] === 0x70 &&
        buffer[8] === 0x61 && buffer[9] === 0x76 &&
        buffer[10] === 0x69 && buffer[11] === 0x66) {
      return { format: 'avif', isAnimated: false };
    }

    // ICO: 00 00 01 00 (4 bytes)
    if (buffer.length >= 4 &&
        buffer[0] === 0x00 && buffer[1] === 0x00 &&
        buffer[2] === 0x01 && buffer[3] === 0x00) {
      return { format: 'ico', isAnimated: false };
    }

    // SVG: text-based, check for <svg tag (with or without <?xml preamble)
    // Scanning first 512 bytes is sufficient to find <svg in valid SVG files
    if (buffer.length >= 4) {
      const start = buffer.toString('utf8', 0, Math.min(512, buffer.length));
      if (start.includes('<svg')) {
        return { format: 'svg', isAnimated: false };
      }
    }

    return { format: 'unknown', isAnimated: false };
  } catch (error) {
    log.warn('Error detecting image format:', error);
    return { format: 'unknown', isAnimated: false };
  }
}

/**
 * Detects if a GIF contains animation by counting Image Descriptor blocks
 *
 * GIF Image Descriptors start with 0x2C separator. Multiple descriptors
 * indicate multiple frames (animation).
 *
 * Fail-safe behavior (REQ-IMAGE-WEBP-11): Returns true (animated) on parse
 * errors to ensure lossless compression. This protects against malformed GIFs
 * or future format variations that the parser doesn't handle correctly.
 *
 * @param buffer - GIF image data
 * @returns true if animated or parse error, false if static
 */
function detectGifAnimation(buffer: Buffer): boolean {
  try {
    let descriptorCount = 0;
    let offset = 13; // Skip header (6) + logical screen descriptor (7)

    // Check and skip Global Color Table if present
    if (buffer.length > 10) {
      const packed = buffer[10];
      if ((packed & 0x80) !== 0) {
        // Global Color Table present
        const gctSize = 2 << (packed & 0x07);
        const gctBytes = gctSize * 3;
        offset += gctBytes;
      }
    }

    while (offset < buffer.length) {
      const separator = buffer[offset];

      if (separator === 0x2C) {
        // Image Descriptor
        descriptorCount++;
        if (descriptorCount > 1) {
          return true; // Multiple frames = animated
        }
        offset += 10; // Skip descriptor header (10 bytes)

        // Skip color table if present
        if (offset > 0 && buffer.length > offset - 1) {
          const packed = buffer[offset - 1];
          if ((packed & 0x80) !== 0) {
            const colorTableSize = 2 << (packed & 0x07);
            offset += colorTableSize * 3;
          }
        }

        // Skip image data (LZW compressed blocks)
        if (offset < buffer.length) {
          offset++; // Skip LZW minimum code size
          offset = skipDataSubBlocks(buffer, offset);
        }
      } else if (separator === 0x21) {
        // Extension block
        offset += 2; // Skip separator and label
        offset = skipDataSubBlocks(buffer, offset);
      } else if (separator === 0x3B) {
        // Trailer - end of GIF
        break;
      } else {
        // Unknown block, stop parsing
        break;
      }
    }

    return false;
  } catch (error) {
    log.warn('Error detecting GIF animation:', error);
    // Fail safe to lossless: return true on parse error (REQ-IMAGE-WEBP-11)
    return true;
  }
}

/**
 * Skips data sub-blocks in GIF format
 *
 * GIF uses variable-length blocks where each block starts with a size byte.
 * A size of 0 indicates end of blocks.
 *
 * @param buffer - GIF data
 * @param offset - Current position
 * @returns New offset after skipping blocks
 */
function skipDataSubBlocks(buffer: Buffer, offset: number): number {
  while (offset < buffer.length) {
    const blockSize = buffer[offset];
    offset++;

    if (blockSize === 0) {
      break; // Block terminator
    }

    offset += blockSize;
  }

  return offset;
}

/**
 * Detects if a WebP contains animation by parsing VP8X chunk flags
 *
 * VP8X chunk contains flags where bit 1 indicates animation.
 * VP8X signature: 56 50 38 58
 *
 * Fail-safe behavior (REQ-IMAGE-WEBP-11): Returns true (animated) on parse
 * errors to ensure lossless compression. This protects against malformed WebP
 * or future format variations that the parser doesn't handle correctly.
 *
 * @param buffer - WebP image data
 * @returns true if animated or parse error, false if static
 */
function detectWebpAnimation(buffer: Buffer): boolean {
  try {
    // WebP format: RIFF header (12) + chunks
    let offset = 12;

    while (offset + 8 <= buffer.length) {
      // Read chunk FourCC (4 bytes)
      const chunkType = buffer.toString('ascii', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);

      offset += 8;

      if (chunkType === 'VP8X') {
        // VP8X chunk found - check animation flag
        if (offset + 4 > buffer.length) {
          break; // Not enough data
        }

        const flags = buffer.readUInt32LE(offset);
        const animationBit = (flags >> 1) & 1; // Bit 1 is animation flag
        return animationBit === 1;
      }

      // Move to next chunk (aligned to even boundary)
      offset += chunkSize;
      if (chunkSize % 2 === 1) {
        offset++; // Padding byte
      }
    }

    // No VP8X chunk found, assume static
    return false;
  } catch (error) {
    log.warn('Error detecting WebP animation:', error);
    // Fail safe to lossless: return true on parse error (REQ-IMAGE-WEBP-11)
    return true;
  }
}

/**
 * Checks if the cwebp binary is available on the system
 *
 * Validates binary presence by executing `cwebp -version`. Missing binary
 * logs an error but allows server to continue (REQ-IMAGE-WEBP-16).
 *
 * @param deps - Optional dependencies for testing (execFileAsync)
 * @returns true if binary available, false if missing or error
 */
export async function checkCwebpAvailability(
  deps: {
    execFileAsync?: typeof execFileAsyncDefault;
  } = {}
): Promise<boolean> {
  const { execFileAsync = execFileAsyncDefault } = deps;

  try {
    await execFileAsync('cwebp', ['-version'], { timeout: 5000 });
    log.info('cwebp binary found and available');
    return true;
  } catch {
    log.error('cwebp binary not found - WebP conversion will fall back to original files');
    return false;
  }
}

/**
 * Converts an image buffer to WebP format
 *
 * For static images, converts to lossy WebP with quality 80.
 * For animated images (GIF, APNG, animated WebP), stores original unchanged.
 * For SVG, returns original unchanged.
 *
 * @param buffer - Raw image data
 * @param originalFilename - Original filename (used for context/logging)
 * @param deps - Optional dependencies for testing (execFileAsync, writeFile, readFile, unlink)
 * @returns Conversion result with buffer and metadata
 */
export async function convertToWebp(
  buffer: Buffer,
  originalFilename: string,
  deps: {
    execFileAsync?: (file: string, args: string[], options?: { timeout?: number }) => Promise<{ stdout: string; stderr: string }>;
    writeFile?: (path: string, data: Buffer) => Promise<void>;
    readFile?: (path: string) => Promise<Buffer>;
    unlink?: (path: string) => Promise<void>;
  } = {}
): Promise<ConversionResult> {
  // Use dependency injection with defaults
  const {
    execFileAsync = execFileAsyncDefault,
    writeFile = writeFileDefault,
    readFile = readFileDefault,
    unlink = unlinkDefault,
  } = deps;

  const formatInfo = detectImageFormat(buffer);

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

  // Skip animated images (store as original)
  if (formatInfo.isAnimated) {
    log.debug(`Animated ${formatInfo.format} detected, storing original: ${originalFilename}`);
    return {
      buffer,
      converted: false,
    };
  }

  // Static images only - convert to lossy WebP (REQ-IMAGE-WEBP-3)
  const flags = ['-m', '6', '-q', '80'];

  // Create temp files for input/output (cwebp requires file paths)
  // Use crypto-random bytes to avoid collisions under high load
  const tempInput = join(tmpdir(), `webp-${randomBytes(8).toString('hex')}.input`);
  const tempOutput = join(tmpdir(), `webp-${randomBytes(8).toString('hex')}.webp`);

  try {
    // Write input buffer to temp file
    await writeFile(tempInput, buffer);

    // Execute cwebp with 30-second timeout
    // Timeout allows 10MB images to convert on slower hardware
    // Use execFile to avoid shell interpretation (command injection protection)
    const args = [...flags, tempInput, '-o', tempOutput];
    log.debug(`Converting ${originalFilename}: cwebp ${args.join(' ')}`);

    await execFileAsync('cwebp', args, { timeout: 30000 }); // 30s timeout for large images

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
