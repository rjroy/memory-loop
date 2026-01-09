/**
 * File Upload Tests
 *
 * Tests for the file upload module: filename generation, validation, and file writing.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateFilename,
  isValidFileExtension,
  uploadFile,
  getFileCategory,
  getMaxFileSize,
  ALLOWED_FILE_EXTENSIONS,
  ALL_ALLOWED_EXTENSIONS,
  MAX_FILE_SIZES,
} from "../file-upload";

describe("generateFilename", () => {
  it("generates filename with date prefix", () => {
    const filename = generateFilename(".png");
    const today = new Date().toISOString().split("T")[0];
    expect(filename.startsWith(today)).toBe(true);
  });

  it("includes category in filename for images", () => {
    const filename = generateFilename(".jpg");
    expect(filename).toContain("-image-");
  });

  it("includes category in filename for videos", () => {
    const filename = generateFilename(".mp4");
    expect(filename).toContain("-video-");
  });

  it("includes category in filename for documents", () => {
    const filename = generateFilename(".pdf");
    expect(filename).toContain("-document-");
  });

  it("includes category in filename for text files", () => {
    const filename = generateFilename(".txt");
    expect(filename).toContain("-text-");
  });

  it("preserves the extension", () => {
    expect(generateFilename(".png")).toMatch(/\.png$/);
    expect(generateFilename(".mp4")).toMatch(/\.mp4$/);
    expect(generateFilename(".pdf")).toMatch(/\.pdf$/);
    expect(generateFilename(".txt")).toMatch(/\.txt$/);
    expect(generateFilename(".md")).toMatch(/\.md$/);
  });

  it("lowercases uppercase extensions", () => {
    expect(generateFilename(".PNG")).toMatch(/\.png$/);
    expect(generateFilename(".PDF")).toMatch(/\.pdf$/);
  });

  it("generates unique filenames", () => {
    const filenames = new Set<string>();
    for (let i = 0; i < 100; i++) {
      filenames.add(generateFilename(".png"));
    }
    // Should have at least 90 unique filenames (allowing some collisions due to randomness)
    expect(filenames.size).toBeGreaterThanOrEqual(90);
  });

  it("format matches YYYY-MM-DD-{category}-XXXXX.ext", () => {
    const imageFilename = generateFilename(".png");
    expect(imageFilename).toMatch(/^\d{4}-\d{2}-\d{2}-image-[A-F0-9]{5}\.png$/);

    const videoFilename = generateFilename(".mp4");
    expect(videoFilename).toMatch(/^\d{4}-\d{2}-\d{2}-video-[A-F0-9]{5}\.mp4$/);
  });
});

describe("getFileCategory", () => {
  it("returns image for image extensions", () => {
    expect(getFileCategory(".png")).toBe("image");
    expect(getFileCategory(".jpg")).toBe("image");
    expect(getFileCategory(".jpeg")).toBe("image");
    expect(getFileCategory(".gif")).toBe("image");
    expect(getFileCategory(".webp")).toBe("image");
    expect(getFileCategory(".svg")).toBe("image");
  });

  it("returns video for video extensions", () => {
    expect(getFileCategory(".mp4")).toBe("video");
    expect(getFileCategory(".mov")).toBe("video");
    expect(getFileCategory(".webm")).toBe("video");
  });

  it("returns document for document extensions", () => {
    expect(getFileCategory(".pdf")).toBe("document");
  });

  it("returns text for text extensions", () => {
    expect(getFileCategory(".txt")).toBe("text");
    expect(getFileCategory(".md")).toBe("text");
    expect(getFileCategory(".csv")).toBe("text");
    expect(getFileCategory(".tsv")).toBe("text");
    expect(getFileCategory(".json")).toBe("text");
  });

  it("returns null for unknown extensions", () => {
    expect(getFileCategory(".exe")).toBeNull();
    expect(getFileCategory(".dll")).toBeNull();
    expect(getFileCategory(".unknown")).toBeNull();
  });

  it("handles uppercase extensions", () => {
    expect(getFileCategory(".PNG")).toBe("image");
    expect(getFileCategory(".PDF")).toBe("document");
  });
});

describe("getMaxFileSize", () => {
  it("returns 10MB for images", () => {
    expect(getMaxFileSize(".png")).toBe(10 * 1024 * 1024);
  });

  it("returns 100MB for videos", () => {
    expect(getMaxFileSize(".mp4")).toBe(100 * 1024 * 1024);
  });

  it("returns 25MB for documents", () => {
    expect(getMaxFileSize(".pdf")).toBe(25 * 1024 * 1024);
  });

  it("returns 5MB for text files", () => {
    expect(getMaxFileSize(".txt")).toBe(5 * 1024 * 1024);
  });

  it("returns default 10MB for unknown extensions", () => {
    expect(getMaxFileSize(".unknown")).toBe(10 * 1024 * 1024);
  });
});

describe("isValidFileExtension", () => {
  it("accepts image extensions", () => {
    expect(isValidFileExtension(".png")).toBe(true);
    expect(isValidFileExtension(".jpg")).toBe(true);
    expect(isValidFileExtension(".jpeg")).toBe(true);
    expect(isValidFileExtension(".gif")).toBe(true);
    expect(isValidFileExtension(".webp")).toBe(true);
    expect(isValidFileExtension(".svg")).toBe(true);
  });

  it("accepts video extensions", () => {
    expect(isValidFileExtension(".mp4")).toBe(true);
    expect(isValidFileExtension(".mov")).toBe(true);
    expect(isValidFileExtension(".webm")).toBe(true);
    expect(isValidFileExtension(".ogg")).toBe(true);
    expect(isValidFileExtension(".m4v")).toBe(true);
  });

  it("accepts document extensions", () => {
    expect(isValidFileExtension(".pdf")).toBe(true);
  });

  it("accepts text extensions", () => {
    expect(isValidFileExtension(".txt")).toBe(true);
    expect(isValidFileExtension(".md")).toBe(true);
    expect(isValidFileExtension(".csv")).toBe(true);
    expect(isValidFileExtension(".tsv")).toBe(true);
    expect(isValidFileExtension(".json")).toBe(true);
  });

  it("accepts uppercase extensions", () => {
    expect(isValidFileExtension(".PNG")).toBe(true);
    expect(isValidFileExtension(".PDF")).toBe(true);
    expect(isValidFileExtension(".MP4")).toBe(true);
  });

  it("rejects invalid extensions", () => {
    expect(isValidFileExtension(".exe")).toBe(false);
    expect(isValidFileExtension(".dll")).toBe(false);
    expect(isValidFileExtension(".js")).toBe(false);
    expect(isValidFileExtension(".html")).toBe(false);
    expect(isValidFileExtension("")).toBe(false);
  });
});

describe("ALLOWED_FILE_EXTENSIONS", () => {
  it("has image category with expected extensions", () => {
    expect(ALLOWED_FILE_EXTENSIONS.image.has(".png")).toBe(true);
    expect(ALLOWED_FILE_EXTENSIONS.image.has(".jpg")).toBe(true);
    expect(ALLOWED_FILE_EXTENSIONS.image.has(".svg")).toBe(true);
  });

  it("has video category with expected extensions", () => {
    expect(ALLOWED_FILE_EXTENSIONS.video.has(".mp4")).toBe(true);
    expect(ALLOWED_FILE_EXTENSIONS.video.has(".mov")).toBe(true);
  });

  it("has document category with pdf", () => {
    expect(ALLOWED_FILE_EXTENSIONS.document.has(".pdf")).toBe(true);
  });

  it("has text category with expected extensions", () => {
    expect(ALLOWED_FILE_EXTENSIONS.text.has(".txt")).toBe(true);
    expect(ALLOWED_FILE_EXTENSIONS.text.has(".md")).toBe(true);
    expect(ALLOWED_FILE_EXTENSIONS.text.has(".csv")).toBe(true);
  });
});

describe("ALL_ALLOWED_EXTENSIONS", () => {
  it("contains all extensions from all categories", () => {
    expect(ALL_ALLOWED_EXTENSIONS.has(".png")).toBe(true);
    expect(ALL_ALLOWED_EXTENSIONS.has(".mp4")).toBe(true);
    expect(ALL_ALLOWED_EXTENSIONS.has(".pdf")).toBe(true);
    expect(ALL_ALLOWED_EXTENSIONS.has(".txt")).toBe(true);
  });
});

describe("MAX_FILE_SIZES", () => {
  it("has expected size limits", () => {
    expect(MAX_FILE_SIZES.image).toBe(10 * 1024 * 1024);
    expect(MAX_FILE_SIZES.video).toBe(100 * 1024 * 1024);
    expect(MAX_FILE_SIZES.document).toBe(25 * 1024 * 1024);
    expect(MAX_FILE_SIZES.text).toBe(5 * 1024 * 1024);
  });
});

describe("uploadFile", () => {
  let testDir: string;
  let vaultPath: string;
  let contentRoot: string;
  const attachmentPath = "05_Attachments";

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = join(tmpdir(), `file-upload-test-${Date.now()}`);
    vaultPath = join(testDir, "vault");
    contentRoot = vaultPath; // Same for simplicity

    await mkdir(vaultPath, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  it("rejects invalid file extensions", async () => {
    const buffer = Buffer.from("test data");

    const result = await uploadFile(
      vaultPath,
      contentRoot,
      attachmentPath,
      buffer,
      "test.exe"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid file type");
    expect(result.error).toContain(".exe");
  });

  it("rejects images that are too large", async () => {
    // Create a buffer larger than image max size (10MB)
    const buffer = Buffer.alloc(10 * 1024 * 1024 + 1);

    const result = await uploadFile(
      vaultPath,
      contentRoot,
      attachmentPath,
      buffer,
      "large.png"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("too large");
    expect(result.error).toContain("10MB");
  });

  it("rejects text files that are too large", async () => {
    // Create a buffer larger than text max size (5MB)
    const buffer = Buffer.alloc(5 * 1024 * 1024 + 1);

    const result = await uploadFile(
      vaultPath,
      contentRoot,
      attachmentPath,
      buffer,
      "large.txt"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("too large");
    expect(result.error).toContain("5MB");
  });

  it("creates attachment directory if missing", async () => {
    const buffer = Buffer.from("PNG image data");

    const result = await uploadFile(
      vaultPath,
      contentRoot,
      attachmentPath,
      buffer,
      "test.png"
    );

    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();

    // Verify directory was created
    const fullPath = join(contentRoot, result.path!);
    const content = await readFile(fullPath);
    expect(content.toString()).toBe("PNG image data");
  });

  it("uploads image successfully and returns correct path", async () => {
    const buffer = Buffer.from("test image content");

    const result = await uploadFile(
      vaultPath,
      contentRoot,
      attachmentPath,
      buffer,
      "photo.jpg"
    );

    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();
    expect(result.path).toMatch(/^05_Attachments\/\d{4}-\d{2}-\d{2}-image-[A-F0-9]{5}\.jpg$/);
  });

  it("uploads video successfully with video category in filename", async () => {
    const buffer = Buffer.from("test video content");

    const result = await uploadFile(
      vaultPath,
      contentRoot,
      attachmentPath,
      buffer,
      "video.mp4"
    );

    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();
    expect(result.path).toMatch(/^05_Attachments\/\d{4}-\d{2}-\d{2}-video-[A-F0-9]{5}\.mp4$/);
  });

  it("uploads PDF successfully with document category in filename", async () => {
    const buffer = Buffer.from("test pdf content");

    const result = await uploadFile(
      vaultPath,
      contentRoot,
      attachmentPath,
      buffer,
      "document.pdf"
    );

    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();
    expect(result.path).toMatch(/^05_Attachments\/\d{4}-\d{2}-\d{2}-document-[A-F0-9]{5}\.pdf$/);
  });

  it("uploads text file successfully with text category in filename", async () => {
    const buffer = Buffer.from("test text content");

    const result = await uploadFile(
      vaultPath,
      contentRoot,
      attachmentPath,
      buffer,
      "notes.txt"
    );

    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();
    expect(result.path).toMatch(/^05_Attachments\/\d{4}-\d{2}-\d{2}-text-[A-F0-9]{5}\.txt$/);
  });

  it("uploads markdown file successfully", async () => {
    const buffer = Buffer.from("# Heading\n\nSome content");

    const result = await uploadFile(
      vaultPath,
      contentRoot,
      attachmentPath,
      buffer,
      "readme.md"
    );

    expect(result.success).toBe(true);
    expect(result.path).toMatch(/\.md$/);
  });

  it("uploads CSV file successfully", async () => {
    const buffer = Buffer.from("a,b,c\n1,2,3");

    const result = await uploadFile(
      vaultPath,
      contentRoot,
      attachmentPath,
      buffer,
      "data.csv"
    );

    expect(result.success).toBe(true);
    expect(result.path).toMatch(/\.csv$/);
  });

  it("writes file with correct content", async () => {
    const fileData = "test file binary data";
    const buffer = Buffer.from(fileData);

    const result = await uploadFile(
      vaultPath,
      contentRoot,
      attachmentPath,
      buffer,
      "file.png"
    );

    expect(result.success).toBe(true);

    const fullPath = join(contentRoot, result.path!);
    const writtenContent = await readFile(fullPath, "utf-8");
    expect(writtenContent).toBe(fileData);
  });

  it("preserves original file extension with lowercase", async () => {
    const buffer = Buffer.from("test");

    const pngResult = await uploadFile(
      vaultPath,
      contentRoot,
      attachmentPath,
      buffer,
      "test.PNG"
    );
    expect(pngResult.path).toMatch(/\.png$/);

    const pdfResult = await uploadFile(
      vaultPath,
      contentRoot,
      attachmentPath,
      buffer,
      "test.PDF"
    );
    expect(pdfResult.path).toMatch(/\.pdf$/);
  });

  it("accepts all valid file types", async () => {
    const buffer = Buffer.from("test");
    const extensions = [".png", ".jpg", ".mp4", ".pdf", ".txt", ".md", ".csv", ".json"];

    for (const ext of extensions) {
      const result = await uploadFile(
        vaultPath,
        contentRoot,
        attachmentPath,
        buffer,
        `test${ext}`
      );
      expect(result.success).toBe(true);
      expect(result.path).toMatch(new RegExp(`\\${ext}$`));
    }
  });

  it("handles path traversal attempts", async () => {
    const buffer = Buffer.from("test");

    // Try to escape via attachmentPath
    const result = await uploadFile(
      vaultPath,
      contentRoot,
      "../../../etc", // Malicious attachment path
      buffer,
      "test.png"
    );

    // Should fail because the path would be outside the vault
    expect(result.success).toBe(false);
    expect(result.error).toContain("traversal");
  });

  it("works with custom content root different from vault path", async () => {
    // Create a content subdirectory
    const customContentRoot = join(vaultPath, "content");
    await mkdir(customContentRoot, { recursive: true });

    const buffer = Buffer.from("test file");

    const result = await uploadFile(
      vaultPath,
      customContentRoot,
      attachmentPath,
      buffer,
      "test.png"
    );

    expect(result.success).toBe(true);

    // File should be in content/05_Attachments/
    const fullPath = join(customContentRoot, result.path!);
    const content = await readFile(fullPath);
    expect(content.toString()).toBe("test file");
  });
});
