/**
 * File Type Utilities Tests
 */

import { describe, expect, it } from "bun:test";
import { isImageFile, isMarkdownFile, isTxtFile, IMAGE_EXTENSIONS } from "../file-types";

describe("isImageFile", () => {
  it("returns true for common image extensions", () => {
    expect(isImageFile("photo.jpg")).toBe(true);
    expect(isImageFile("photo.jpeg")).toBe(true);
    expect(isImageFile("image.png")).toBe(true);
    expect(isImageFile("icon.gif")).toBe(true);
    expect(isImageFile("modern.webp")).toBe(true);
    expect(isImageFile("vector.svg")).toBe(true);
    expect(isImageFile("next-gen.avif")).toBe(true);
    expect(isImageFile("bitmap.bmp")).toBe(true);
    expect(isImageFile("favicon.ico")).toBe(true);
  });

  it("handles uppercase extensions", () => {
    expect(isImageFile("PHOTO.JPG")).toBe(true);
    expect(isImageFile("Image.PNG")).toBe(true);
    expect(isImageFile("photo.JPEG")).toBe(true);
  });

  it("handles paths with directories", () => {
    expect(isImageFile("attachments/photo.jpg")).toBe(true);
    expect(isImageFile("deep/nested/path/image.png")).toBe(true);
    expect(isImageFile("00_Attachments/2024/vacation.webp")).toBe(true);
  });

  it("returns false for non-image files", () => {
    expect(isImageFile("document.md")).toBe(false);
    expect(isImageFile("notes.txt")).toBe(false);
    expect(isImageFile("data.json")).toBe(false);
    expect(isImageFile("script.js")).toBe(false);
    expect(isImageFile("styles.css")).toBe(false);
  });

  it("returns false for files without extensions", () => {
    expect(isImageFile("README")).toBe(false);
    expect(isImageFile("Makefile")).toBe(false);
  });

  it("returns false for paths ending with a dot", () => {
    expect(isImageFile("photo.")).toBe(false);
    expect(isImageFile("file.")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isImageFile("")).toBe(false);
  });
});

describe("isMarkdownFile", () => {
  it("returns true for .md files", () => {
    expect(isMarkdownFile("notes.md")).toBe(true);
    expect(isMarkdownFile("README.md")).toBe(true);
    expect(isMarkdownFile("CLAUDE.md")).toBe(true);
  });

  it("handles uppercase extensions", () => {
    expect(isMarkdownFile("notes.MD")).toBe(true);
    expect(isMarkdownFile("README.Md")).toBe(true);
  });

  it("handles paths with directories", () => {
    expect(isMarkdownFile("docs/readme.md")).toBe(true);
    expect(isMarkdownFile("00_Inbox/2024-01-01.md")).toBe(true);
  });

  it("returns false for non-markdown files", () => {
    expect(isMarkdownFile("photo.jpg")).toBe(false);
    expect(isMarkdownFile("document.txt")).toBe(false);
    expect(isMarkdownFile("data.json")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isMarkdownFile("")).toBe(false);
  });
});

describe("isTxtFile", () => {
  it("returns true for .txt files", () => {
    expect(isTxtFile("notes.txt")).toBe(true);
    expect(isTxtFile("readme.txt")).toBe(true);
    expect(isTxtFile("log.txt")).toBe(true);
  });

  it("handles uppercase extensions", () => {
    expect(isTxtFile("notes.TXT")).toBe(true);
    expect(isTxtFile("README.Txt")).toBe(true);
  });

  it("handles paths with directories", () => {
    expect(isTxtFile("docs/readme.txt")).toBe(true);
    expect(isTxtFile("logs/2024-01-01.txt")).toBe(true);
  });

  it("returns false for non-txt files", () => {
    expect(isTxtFile("photo.jpg")).toBe(false);
    expect(isTxtFile("document.md")).toBe(false);
    expect(isTxtFile("data.json")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isTxtFile("")).toBe(false);
  });
});

describe("IMAGE_EXTENSIONS", () => {
  it("contains expected extensions", () => {
    expect(IMAGE_EXTENSIONS.has("jpg")).toBe(true);
    expect(IMAGE_EXTENSIONS.has("jpeg")).toBe(true);
    expect(IMAGE_EXTENSIONS.has("png")).toBe(true);
    expect(IMAGE_EXTENSIONS.has("gif")).toBe(true);
    expect(IMAGE_EXTENSIONS.has("webp")).toBe(true);
    expect(IMAGE_EXTENSIONS.has("svg")).toBe(true);
    expect(IMAGE_EXTENSIONS.has("avif")).toBe(true);
    expect(IMAGE_EXTENSIONS.has("bmp")).toBe(true);
    expect(IMAGE_EXTENSIONS.has("ico")).toBe(true);
  });

  it("does not contain non-image extensions", () => {
    expect(IMAGE_EXTENSIONS.has("md")).toBe(false);
    expect(IMAGE_EXTENSIONS.has("txt")).toBe(false);
    expect(IMAGE_EXTENSIONS.has("pdf")).toBe(false);
  });
});
