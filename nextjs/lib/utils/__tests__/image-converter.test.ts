import { describe, test, expect, beforeEach } from 'bun:test';
import { detectImageFormat, convertToWebp, checkCwebpAvailability } from '../image-converter';
import type { ExecException } from 'child_process';

describe('image-converter', () => {
  describe('checkCwebpAvailability', () => {
    test('returns true and logs info when cwebp binary is available', async () => {
      const deps = {
        execFileAsync: async () => {
          return { stdout: 'cwebp 1.2.3', stderr: '' };
        },
      };

      const result = await checkCwebpAvailability(deps);

      expect(result).toBe(true);
    });

    test('returns false and logs error when cwebp binary is missing (ENOENT)', async () => {
      const deps = {
        execFileAsync: async () => {
          const error = new Error('spawn cwebp ENOENT') as ExecException;
          error.code = 'ENOENT';
          throw error;
        },
      };

      const result = await checkCwebpAvailability(deps);

      expect(result).toBe(false);
    });

    test('returns false and logs error when cwebp execution fails', async () => {
      const deps = {
        execFileAsync: async () => {
          throw new Error('Permission denied');
        },
      };

      const result = await checkCwebpAvailability(deps);

      expect(result).toBe(false);
    });
  });

  describe('detectImageFormat', () => {
    describe('format detection', () => {
      test('detects PNG format', () => {
        // PNG signature: 89 50 4E 47 0D 0A 1A 0A
        const pngBuffer = Buffer.from([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
        ]);
        const result = detectImageFormat(pngBuffer);
        expect(result).toEqual({ format: 'png', isAnimated: false });
      });

      test('detects JPEG format', () => {
        // JPEG signature: FF D8 FF
        const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF]);
        const result = detectImageFormat(jpegBuffer);
        expect(result).toEqual({ format: 'jpeg', isAnimated: false });
      });

      test('detects GIF format', () => {
        // GIF signature: 47 49 46 38 (ASCII "GIF8")
        const gifBuffer = Buffer.from([0x47, 0x49, 0x46, 0x38]);
        const result = detectImageFormat(gifBuffer);
        expect(result.format).toBe('gif');
      });

      test('detects WebP format', () => {
        // WebP signature: RIFF....WEBP
        const webpBuffer = Buffer.from([
          0x52, 0x49, 0x46, 0x46, // RIFF
          0x00, 0x00, 0x00, 0x00, // file size (placeholder)
          0x57, 0x45, 0x42, 0x50  // WEBP
        ]);
        const result = detectImageFormat(webpBuffer);
        expect(result.format).toBe('webp');
      });

      test('detects BMP format', () => {
        // BMP signature: 42 4D (ASCII "BM")
        const bmpBuffer = Buffer.from([0x42, 0x4D]);
        const result = detectImageFormat(bmpBuffer);
        expect(result).toEqual({ format: 'bmp', isAnimated: false });
      });

      test('detects AVIF format', () => {
        // AVIF signature: ftyp box with avif at bytes 4-11
        const avifBuffer = Buffer.from([
          0x00, 0x00, 0x00, 0x00, // size placeholder
          0x66, 0x74, 0x79, 0x70, // ftyp
          0x61, 0x76, 0x69, 0x66  // avif
        ]);
        const result = detectImageFormat(avifBuffer);
        expect(result).toEqual({ format: 'avif', isAnimated: false });
      });

      test('detects ICO format', () => {
        // ICO signature: 00 00 01 00
        const icoBuffer = Buffer.from([0x00, 0x00, 0x01, 0x00]);
        const result = detectImageFormat(icoBuffer);
        expect(result).toEqual({ format: 'ico', isAnimated: false });
      });

      test('detects SVG format', () => {
        // SVG: text-based, starts with <svg
        const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
        const result = detectImageFormat(svgBuffer);
        expect(result).toEqual({ format: 'svg', isAnimated: false });
      });

      test('returns unknown for unrecognized format', () => {
        // Random bytes that don't match any signature
        const unknownBuffer = Buffer.from([0x01, 0x02, 0x03, 0x04]);
        const result = detectImageFormat(unknownBuffer);
        expect(result).toEqual({ format: 'unknown', isAnimated: false });
      });
    });

    describe('animation detection', () => {
      test('detects static GIF', () => {
        // Static GIF: header + logical screen descriptor + single image descriptor
        const staticGif = Buffer.from([
          // Header (6 bytes)
          0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
          // Logical Screen Descriptor (7 bytes)
          0x0A, 0x00, 0x0A, 0x00, 0x00, 0x00, 0x00,
          // Image Descriptor (10 bytes)
          0x2C, // Image separator
          0x00, 0x00, 0x00, 0x00, 0x0A, 0x00, 0x0A, 0x00, 0x00,
          // LZW minimum code size + terminator
          0x02, 0x00,
          // Trailer
          0x3B
        ]);
        const result = detectImageFormat(staticGif);
        expect(result).toEqual({ format: 'gif', isAnimated: false });
      });

      test('detects animated GIF', () => {
        // Animated GIF: header + logical screen descriptor + two image descriptors
        const animatedGif = Buffer.from([
          // Header (6 bytes)
          0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
          // Logical Screen Descriptor (7 bytes)
          0x0A, 0x00, 0x0A, 0x00, 0x00, 0x00, 0x00,
          // First Image Descriptor (10 bytes)
          0x2C, // Image separator
          0x00, 0x00, 0x00, 0x00, 0x0A, 0x00, 0x0A, 0x00, 0x00,
          // LZW minimum code size + terminator
          0x02, 0x00,
          // Second Image Descriptor (10 bytes)
          0x2C, // Image separator
          0x00, 0x00, 0x00, 0x00, 0x0A, 0x00, 0x0A, 0x00, 0x00,
          // LZW minimum code size + terminator
          0x02, 0x00,
          // Trailer
          0x3B
        ]);
        const result = detectImageFormat(animatedGif);
        expect(result).toEqual({ format: 'gif', isAnimated: true });
      });

      test('detects static WebP', () => {
        // Static WebP: RIFF header + VP8 chunk (no VP8X or animation flag)
        const staticWebp = Buffer.from([
          0x52, 0x49, 0x46, 0x46, // RIFF
          0x1A, 0x00, 0x00, 0x00, // file size
          0x57, 0x45, 0x42, 0x50, // WEBP
          // VP8 chunk (simple lossy)
          0x56, 0x50, 0x38, 0x20, // VP8
          0x0E, 0x00, 0x00, 0x00, // chunk size
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
        ]);
        const result = detectImageFormat(staticWebp);
        expect(result).toEqual({ format: 'webp', isAnimated: false });
      });

      test('detects animated WebP', () => {
        // Animated WebP: RIFF header + VP8X chunk with animation flag set
        const animatedWebp = Buffer.from([
          0x52, 0x49, 0x46, 0x46, // RIFF
          0x20, 0x00, 0x00, 0x00, // file size
          0x57, 0x45, 0x42, 0x50, // WEBP
          // VP8X chunk
          0x56, 0x50, 0x38, 0x58, // VP8X
          0x0A, 0x00, 0x00, 0x00, // chunk size (10 bytes)
          0x02, 0x00, 0x00, 0x00, // flags (bit 1 set = animated)
          0x00, 0x00, 0x00, // width-1 (3 bytes)
          0x00, 0x00, 0x00  // height-1 (3 bytes)
        ]);
        const result = detectImageFormat(animatedWebp);
        expect(result).toEqual({ format: 'webp', isAnimated: true });
      });

      test('marks PNG as non-animated', () => {
        const pngBuffer = Buffer.from([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
        ]);
        const result = detectImageFormat(pngBuffer);
        expect(result.isAnimated).toBe(false);
      });

      test('marks JPEG as non-animated', () => {
        const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF]);
        const result = detectImageFormat(jpegBuffer);
        expect(result.isAnimated).toBe(false);
      });
    });

    describe('fail-safe behavior (REQ-IMAGE-WEBP-11)', () => {
      test('returns unknown for empty buffer', () => {
        const emptyBuffer = Buffer.from([]);
        const result = detectImageFormat(emptyBuffer);
        expect(result).toEqual({ format: 'unknown', isAnimated: false });
      });

      test('detects GIF with Global Color Table', () => {
        // GIF with Global Color Table flag set (bit 7 of byte 10)
        const gifWithGct = Buffer.from([
          // Header (6 bytes)
          0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
          // Logical Screen Descriptor (7 bytes)
          0x0A, 0x00, 0x0A, 0x00,
          0x81, // Packed byte: GCT flag set, size = 2 (2 colors)
          0x00, 0x00,
          // Global Color Table (2 colors * 3 bytes = 6 bytes)
          0xFF, 0x00, 0x00, // Red
          0x00, 0x00, 0xFF, // Blue
          // Image Descriptor
          0x2C,
          0x00, 0x00, 0x00, 0x00, 0x0A, 0x00, 0x0A, 0x00, 0x00,
          // LZW minimum code size + terminator
          0x02, 0x00,
          // Trailer
          0x3B
        ]);
        const result = detectImageFormat(gifWithGct);
        expect(result).toEqual({ format: 'gif', isAnimated: false });
      });

      test('handles truncated GIF gracefully', () => {
        // Valid GIF header but truncated mid-frame - should not crash
        const truncatedGif = Buffer.from([
          0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a header
          0x0A, 0x00, 0x0A, 0x00, 0x00, 0x00, 0x00, // Logical screen descriptor
          0x2C, // Image separator
          0x00, 0x00 // Truncated image descriptor
        ]);
        const result = detectImageFormat(truncatedGif);
        // Parser stops early on truncation, returns false (static)
        expect(result).toEqual({ format: 'gif', isAnimated: false });
      });

      test('handles truncated WebP gracefully', () => {
        // Valid RIFF header but VP8X chunk truncated - should not crash
        const truncatedWebp = Buffer.from([
          0x52, 0x49, 0x46, 0x46, // RIFF
          0x1A, 0x00, 0x00, 0x00, // file size
          0x57, 0x45, 0x42, 0x50, // WEBP
          0x56, 0x50, 0x38, 0x58, // VP8X
          0x0A, 0x00, 0x00, 0x00, // chunk size (10 bytes)
          // Truncated: missing flags and dimensions
        ]);
        const result = detectImageFormat(truncatedWebp);
        // Parser stops early on truncation, returns false (static)
        expect(result).toEqual({ format: 'webp', isAnimated: false });
      });
    });

    describe('SVG detection edge cases', () => {
      test('detects SVG with <svg tag', () => {
        const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
        const result = detectImageFormat(svgBuffer);
        expect(result).toEqual({ format: 'svg', isAnimated: false });
      });

      test('detects SVG with <?xml and <svg', () => {
        const svgBuffer = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>');
        const result = detectImageFormat(svgBuffer);
        expect(result).toEqual({ format: 'svg', isAnimated: false });
      });

      test('does not detect XML without <svg as SVG', () => {
        const xmlBuffer = Buffer.from('<?xml version="1.0"?>\n<document></document>');
        const result = detectImageFormat(xmlBuffer);
        expect(result).toEqual({ format: 'unknown', isAnimated: false });
      });
    });
  });

  describe('convertToWebp', () => {
    // Track calls to verify cleanup
    let unlinkCalls: string[];
    let writeFileCalls: Array<{ path: string; buffer: Buffer }>;
    let readFileCalls: string[];

    // Mock dependencies
    const mockDeps = {
      execFileAsync: async () => {
        return { stdout: '', stderr: '' };
      },
      writeFile: async (path: string, buffer: Buffer) => {
        writeFileCalls.push({ path, buffer });
      },
      readFile: async (path: string): Promise<Buffer> => {
        readFileCalls.push(path);
        // Return fake WebP buffer (smaller than input to simulate compression)
        return Buffer.from([
          0x52, 0x49, 0x46, 0x46, // RIFF
          0x1A, 0x00, 0x00, 0x00, // file size
          0x57, 0x45, 0x42, 0x50, // WEBP
          0x56, 0x50, 0x38, 0x20, // VP8
          0x0E, 0x00, 0x00, 0x00, // chunk size
          0x00, 0x00, 0x00, 0x00,
        ]);
      },
      unlink: async (path: string) => {
        unlinkCalls.push(path);
      },
    };

    beforeEach(() => {
      unlinkCalls = [];
      writeFileCalls = [];
      readFileCalls = [];
    });

    describe('static image conversion', () => {
      test('converts PNG to WebP with correct flags', async () => {
        const pngBuffer = Buffer.from([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
        ]);

        let capturedArgs: string[] = [];
        const deps = {
          ...mockDeps,
          execFileAsync: async (_file: string, args: string[]) => {
            capturedArgs = args;
            return { stdout: '', stderr: '' };
          },
        };

        const result = await convertToWebp(pngBuffer, 'test.png', deps);

        expect(result.converted).toBe(true);
        expect(result.originalFormat).toBe('image/png');
        expect(capturedArgs).toContain('-m');
        expect(capturedArgs).toContain('6');
        expect(capturedArgs).toContain('-q');
        expect(capturedArgs).toContain('80'); // Static image flags
        expect(result.buffer).toBeDefined();
      });

      test('converts JPEG to WebP', async () => {
        const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF]);

        const result = await convertToWebp(jpegBuffer, 'test.jpg', mockDeps);

        expect(result.converted).toBe(true);
        expect(result.originalFormat).toBe('image/jpeg');
      });

      test('converts BMP to WebP', async () => {
        const bmpBuffer = Buffer.from([0x42, 0x4D]);

        const result = await convertToWebp(bmpBuffer, 'test.bmp', mockDeps);

        expect(result.converted).toBe(true);
        expect(result.originalFormat).toBe('image/bmp');
      });

      test('converts static GIF to WebP', async () => {
        const staticGif = Buffer.from([
          // Header (6 bytes)
          0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
          // Logical Screen Descriptor (7 bytes)
          0x0A, 0x00, 0x0A, 0x00, 0x00, 0x00, 0x00,
          // Image Descriptor (10 bytes)
          0x2C, 0x00, 0x00, 0x00, 0x00, 0x0A, 0x00, 0x0A, 0x00, 0x00,
          // LZW minimum code size + terminator
          0x02, 0x00,
          // Trailer
          0x3B
        ]);

        let capturedArgs: string[] = [];
        const deps = {
          ...mockDeps,
          execFileAsync: async (_file: string, args: string[]) => {
            capturedArgs = args;
            return { stdout: '', stderr: '' };
          },
        };

        const result = await convertToWebp(staticGif, 'test.gif', deps);

        expect(result.converted).toBe(true);
        expect(result.originalFormat).toBe('image/gif');
        expect(capturedArgs).toContain('-m');
        expect(capturedArgs).toContain('6');
        expect(capturedArgs).toContain('-q');
        expect(capturedArgs).toContain('80'); // Static GIF uses static flags
      });

      test('re-encodes WebP with appropriate flags', async () => {
        const webpBuffer = Buffer.from([
          0x52, 0x49, 0x46, 0x46, // RIFF
          0x1A, 0x00, 0x00, 0x00, // file size
          0x57, 0x45, 0x42, 0x50, // WEBP
          0x56, 0x50, 0x38, 0x20, // VP8 (simple lossy)
          0x0E, 0x00, 0x00, 0x00, // chunk size
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
        ]);

        const result = await convertToWebp(webpBuffer, 'test.webp', mockDeps);

        expect(result.converted).toBe(true);
        expect(result.originalFormat).toBe('image/webp');
      });
    });

    describe('animated image handling', () => {
      test('skips animated GIF and stores original', async () => {
        const animatedGif = Buffer.from([
          // Header (6 bytes)
          0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
          // Logical Screen Descriptor (7 bytes)
          0x0A, 0x00, 0x0A, 0x00, 0x00, 0x00, 0x00,
          // First Image Descriptor (10 bytes)
          0x2C, 0x00, 0x00, 0x00, 0x00, 0x0A, 0x00, 0x0A, 0x00, 0x00,
          // LZW minimum code size + terminator
          0x02, 0x00,
          // Second Image Descriptor (10 bytes)
          0x2C, 0x00, 0x00, 0x00, 0x00, 0x0A, 0x00, 0x0A, 0x00, 0x00,
          // LZW minimum code size + terminator
          0x02, 0x00,
          // Trailer
          0x3B
        ]);

        const result = await convertToWebp(animatedGif, 'animated.gif', mockDeps);

        expect(result.converted).toBe(false);
        expect(result.buffer).toBe(animatedGif); // Original buffer unchanged
        expect(writeFileCalls.length).toBe(0); // No temp file operations
      });

      test('skips animated WebP and stores original', async () => {
        const animatedWebp = Buffer.from([
          0x52, 0x49, 0x46, 0x46, // RIFF
          0x20, 0x00, 0x00, 0x00, // file size
          0x57, 0x45, 0x42, 0x50, // WEBP
          // VP8X chunk
          0x56, 0x50, 0x38, 0x58, // VP8X
          0x0A, 0x00, 0x00, 0x00, // chunk size (10 bytes)
          0x02, 0x00, 0x00, 0x00, // flags (bit 1 set = animated)
          0x00, 0x00, 0x00, // width-1 (3 bytes)
          0x00, 0x00, 0x00  // height-1 (3 bytes)
        ]);

        const result = await convertToWebp(animatedWebp, 'animated.webp', mockDeps);

        expect(result.converted).toBe(false);
        expect(result.buffer).toBe(animatedWebp); // Original buffer unchanged
        expect(writeFileCalls.length).toBe(0); // No temp file operations
      });
    });

    describe('special format handling', () => {
      test('returns SVG unchanged (REQ-IMAGE-WEBP-5)', async () => {
        const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

        const result = await convertToWebp(svgBuffer, 'test.svg', mockDeps);

        expect(result.converted).toBe(false);
        expect(result.buffer).toBe(svgBuffer); // Original buffer unchanged
        expect(writeFileCalls.length).toBe(0); // No temp file operations
      });

      test('returns unknown format unchanged', async () => {
        const unknownBuffer = Buffer.from([0x01, 0x02, 0x03, 0x04]);

        const result = await convertToWebp(unknownBuffer, 'test.unknown', mockDeps);

        expect(result.converted).toBe(false);
        expect(result.buffer).toBe(unknownBuffer); // Original buffer unchanged
        expect(writeFileCalls.length).toBe(0); // No temp file operations
      });

      test('handles AVIF gracefully', async () => {
        const avifBuffer = Buffer.from([
          0x00, 0x00, 0x00, 0x00, // size placeholder
          0x66, 0x74, 0x79, 0x70, // ftyp
          0x61, 0x76, 0x69, 0x66  // avif
        ]);

        const result = await convertToWebp(avifBuffer, 'test.avif', mockDeps);

        expect(result.converted).toBe(true);
        expect(result.originalFormat).toBe('image/avif');
      });

      test('handles ICO gracefully', async () => {
        const icoBuffer = Buffer.from([0x00, 0x00, 0x01, 0x00]);

        const result = await convertToWebp(icoBuffer, 'test.ico', mockDeps);

        expect(result.converted).toBe(true);
        expect(result.originalFormat).toBe('image/ico');
      });
    });

    describe('error handling', () => {
      test('returns original buffer on conversion failure (REQ-IMAGE-WEBP-12, REQ-IMAGE-WEBP-17)', async () => {
        const pngBuffer = Buffer.from([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
        ]);

        const deps = {
          ...mockDeps,
          execFileAsync: async () => {
            throw new Error('Conversion failed');
          },
        };

        const result = await convertToWebp(pngBuffer, 'test.png', deps);

        expect(result.converted).toBe(false);
        expect(result.buffer).toBe(pngBuffer); // Original buffer returned
        expect(result.error).toBe('Conversion failed');
      });

      test('includes error message in result (REQ-IMAGE-WEBP-13)', async () => {
        const pngBuffer = Buffer.from([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
        ]);

        const deps = {
          ...mockDeps,
          execFileAsync: async () => {
            throw new Error('cwebp binary not found');
          },
        };

        const result = await convertToWebp(pngBuffer, 'test.png', deps);

        expect(result.error).toBe('cwebp binary not found');
      });

      test('handles timeout error', async () => {
        const pngBuffer = Buffer.from([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
        ]);

        const deps = {
          ...mockDeps,
          execFileAsync: async () => {
            const error = new Error('Command failed') as ExecException;
            error.killed = true;
            error.signal = 'SIGTERM';
            throw error;
          },
        };

        const result = await convertToWebp(pngBuffer, 'test.png', deps);

        expect(result.converted).toBe(false);
        expect(result.buffer).toBe(pngBuffer);
        expect(result.error).toContain('Command failed');
      });

      test('handles missing binary (ENOENT)', async () => {
        const pngBuffer = Buffer.from([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
        ]);

        const deps = {
          ...mockDeps,
          execFileAsync: async () => {
            const error = new Error('spawn cwebp ENOENT') as ExecException;
            error.code = 'ENOENT';
            throw error;
          },
        };

        const result = await convertToWebp(pngBuffer, 'test.png', deps);

        expect(result.converted).toBe(false);
        expect(result.error).toContain('ENOENT');
      });
    });

    describe('cleanup behavior', () => {
      test('cleans up temp files on success', async () => {
        const pngBuffer = Buffer.from([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
        ]);

        await convertToWebp(pngBuffer, 'test.png', mockDeps);

        expect(unlinkCalls.length).toBe(2); // Input and output files
        expect(unlinkCalls.some(path => path.includes('.input'))).toBe(true);
        expect(unlinkCalls.some(path => path.includes('.webp'))).toBe(true);
      });

      test('cleans up temp files on error', async () => {
        const pngBuffer = Buffer.from([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
        ]);

        const deps = {
          ...mockDeps,
          execFileAsync: async () => {
            throw new Error('Conversion failed');
          },
        };

        await convertToWebp(pngBuffer, 'test.png', deps);

        expect(unlinkCalls.length).toBe(2); // Input and output files
      });

      test('handles cleanup errors gracefully', async () => {
        const pngBuffer = Buffer.from([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
        ]);

        const deps = {
          ...mockDeps,
          unlink: async () => {
            throw new Error('File not found');
          },
        };

        // Should not throw even if cleanup fails
        const result = await convertToWebp(pngBuffer, 'test.png', deps);
        expect(result.converted).toBe(true);
      });
    });

    describe('temp file handling', () => {
      test('creates unique temp files', async () => {
        const pngBuffer = Buffer.from([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
        ]);

        await convertToWebp(pngBuffer, 'test1.png', mockDeps);
        const firstInputPath = writeFileCalls[0].path;

        writeFileCalls = [];
        await convertToWebp(pngBuffer, 'test2.png', mockDeps);
        const secondInputPath = writeFileCalls[0].path;

        expect(firstInputPath).not.toBe(secondInputPath); // Unique paths
      });

      test('writes input buffer to temp file', async () => {
        const pngBuffer = Buffer.from([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
        ]);

        await convertToWebp(pngBuffer, 'test.png', mockDeps);

        expect(writeFileCalls.length).toBe(1);
        expect(writeFileCalls[0].buffer).toBe(pngBuffer);
      });

      test('reads output from temp file', async () => {
        const pngBuffer = Buffer.from([
          0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
        ]);

        await convertToWebp(pngBuffer, 'test.png', mockDeps);

        expect(readFileCalls.length).toBe(1);
        expect(readFileCalls[0]).toContain('.webp');
      });
    });
  });
});
