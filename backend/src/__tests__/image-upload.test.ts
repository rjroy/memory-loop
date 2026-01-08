/**
 * Image Upload Tests
 *
 * Tests for the image upload module: filename generation, validation, and file writing.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateImageFilename,
  isValidImageExtension,
  uploadImage,
  ALLOWED_IMAGE_EXTENSIONS,
  MAX_IMAGE_SIZE,
} from "../image-upload";

describe("generateImageFilename", () => {
  it("generates filename with date prefix", () => {
    const filename = generateImageFilename(".png");
    const today = new Date().toISOString().split("T")[0];
    expect(filename.startsWith(today)).toBe(true);
  });

  it("includes 'image' in filename", () => {
    const filename = generateImageFilename(".jpg");
    expect(filename).toContain("-image-");
  });

  it("preserves the extension", () => {
    expect(generateImageFilename(".png")).toMatch(/\.png$/);
    expect(generateImageFilename(".jpg")).toMatch(/\.jpg$/);
    expect(generateImageFilename(".jpeg")).toMatch(/\.jpeg$/);
    expect(generateImageFilename(".gif")).toMatch(/\.gif$/);
    expect(generateImageFilename(".webp")).toMatch(/\.webp$/);
  });

  it("generates unique filenames", () => {
    const filenames = new Set<string>();
    for (let i = 0; i < 100; i++) {
      filenames.add(generateImageFilename(".png"));
    }
    // Should have at least 90 unique filenames (allowing some collisions due to randomness)
    expect(filenames.size).toBeGreaterThanOrEqual(90);
  });

  it("format matches YYYY-MM-DD-image-XXXXX.ext", () => {
    const filename = generateImageFilename(".png");
    expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}-image-[A-F0-9]{5}\.png$/);
  });
});

describe("isValidImageExtension", () => {
  it("accepts valid image extensions", () => {
    expect(isValidImageExtension(".png")).toBe(true);
    expect(isValidImageExtension(".jpg")).toBe(true);
    expect(isValidImageExtension(".jpeg")).toBe(true);
    expect(isValidImageExtension(".gif")).toBe(true);
    expect(isValidImageExtension(".webp")).toBe(true);
  });

  it("accepts uppercase extensions", () => {
    expect(isValidImageExtension(".PNG")).toBe(true);
    expect(isValidImageExtension(".JPG")).toBe(true);
    expect(isValidImageExtension(".JPEG")).toBe(true);
  });

  it("rejects invalid extensions", () => {
    expect(isValidImageExtension(".pdf")).toBe(false);
    expect(isValidImageExtension(".svg")).toBe(false);
    expect(isValidImageExtension(".txt")).toBe(false);
    expect(isValidImageExtension(".exe")).toBe(false);
    expect(isValidImageExtension(".js")).toBe(false);
    expect(isValidImageExtension("")).toBe(false);
  });
});

describe("ALLOWED_IMAGE_EXTENSIONS", () => {
  it("includes expected extensions", () => {
    expect(ALLOWED_IMAGE_EXTENSIONS.has(".png")).toBe(true);
    expect(ALLOWED_IMAGE_EXTENSIONS.has(".jpg")).toBe(true);
    expect(ALLOWED_IMAGE_EXTENSIONS.has(".jpeg")).toBe(true);
    expect(ALLOWED_IMAGE_EXTENSIONS.has(".gif")).toBe(true);
    expect(ALLOWED_IMAGE_EXTENSIONS.has(".webp")).toBe(true);
  });

  it("does not include svg (not supported by Claude)", () => {
    expect(ALLOWED_IMAGE_EXTENSIONS.has(".svg")).toBe(false);
  });
});

describe("MAX_IMAGE_SIZE", () => {
  it("is 10MB", () => {
    expect(MAX_IMAGE_SIZE).toBe(10 * 1024 * 1024);
  });
});

describe("uploadImage", () => {
  let testDir: string;
  let vaultPath: string;
  let contentRoot: string;
  const attachmentPath = "05_Attachments";

  beforeEach(async () => {
    // Create a temporary test directory
    testDir = join(tmpdir(), `image-upload-test-${Date.now()}`);
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

    const result = await uploadImage(
      vaultPath,
      contentRoot,
      attachmentPath,
      buffer,
      "test.pdf"
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid file type");
    expect(result.error).toContain(".pdf");
  });

  it("rejects files that are too large", async () => {
    // Create a buffer larger than MAX_IMAGE_SIZE
    const buffer = Buffer.alloc(MAX_IMAGE_SIZE + 1);

    const result = await uploadImage(
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

  it("creates attachment directory if missing", async () => {
    const buffer = Buffer.from("PNG image data");

    const result = await uploadImage(
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

    const result = await uploadImage(
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

  it("writes file with correct content", async () => {
    const imageData = "test image binary data";
    const buffer = Buffer.from(imageData);

    const result = await uploadImage(
      vaultPath,
      contentRoot,
      attachmentPath,
      buffer,
      "image.png"
    );

    expect(result.success).toBe(true);

    const fullPath = join(contentRoot, result.path!);
    const writtenContent = await readFile(fullPath, "utf-8");
    expect(writtenContent).toBe(imageData);
  });

  it("preserves original file extension", async () => {
    const buffer = Buffer.from("test");

    const pngResult = await uploadImage(
      vaultPath,
      contentRoot,
      attachmentPath,
      buffer,
      "test.PNG"
    );
    expect(pngResult.path).toMatch(/\.png$/);

    const jpgResult = await uploadImage(
      vaultPath,
      contentRoot,
      attachmentPath,
      buffer,
      "test.JPG"
    );
    expect(jpgResult.path).toMatch(/\.jpg$/);
  });

  it("accepts all valid image types", async () => {
    const buffer = Buffer.from("test");
    const extensions = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

    for (const ext of extensions) {
      const result = await uploadImage(
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
    const result = await uploadImage(
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

    const buffer = Buffer.from("test image");

    const result = await uploadImage(
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
    expect(content.toString()).toBe("test image");
  });
});
