/**
 * Tests for file type utilities.
 */

import { describe, expect, test } from "bun:test";
import { isImageFile, isVideoFile, isPdfFile, isMarkdownFile, isJsonFile, isCsvFile, encodeAssetPath } from "./file-types";

describe("isImageFile", () => {
  test("returns true for common image extensions", () => {
    expect(isImageFile("photo.jpg")).toBe(true);
    expect(isImageFile("photo.jpeg")).toBe(true);
    expect(isImageFile("photo.png")).toBe(true);
    expect(isImageFile("photo.gif")).toBe(true);
    expect(isImageFile("photo.webp")).toBe(true);
    expect(isImageFile("photo.svg")).toBe(true);
  });

  test("returns true regardless of case", () => {
    expect(isImageFile("photo.JPG")).toBe(true);
    expect(isImageFile("photo.PNG")).toBe(true);
    expect(isImageFile("photo.Gif")).toBe(true);
  });

  test("works with paths", () => {
    expect(isImageFile("attachments/photo.png")).toBe(true);
    expect(isImageFile("deep/nested/path/image.webp")).toBe(true);
  });

  test("returns false for non-image files", () => {
    expect(isImageFile("document.md")).toBe(false);
    expect(isImageFile("script.js")).toBe(false);
    expect(isImageFile("noextension")).toBe(false);
  });
});

describe("isVideoFile", () => {
  test("returns true for common video extensions", () => {
    expect(isVideoFile("movie.mp4")).toBe(true);
    expect(isVideoFile("clip.mov")).toBe(true);
    expect(isVideoFile("video.webm")).toBe(true);
    expect(isVideoFile("audio.ogg")).toBe(true);
    expect(isVideoFile("movie.m4v")).toBe(true);
  });

  test("returns true regardless of case", () => {
    expect(isVideoFile("movie.MP4")).toBe(true);
    expect(isVideoFile("clip.MOV")).toBe(true);
    expect(isVideoFile("video.WebM")).toBe(true);
  });

  test("works with paths", () => {
    expect(isVideoFile("videos/movie.mp4")).toBe(true);
    expect(isVideoFile("deep/nested/path/clip.mov")).toBe(true);
  });

  test("returns false for non-video files", () => {
    expect(isVideoFile("document.md")).toBe(false);
    expect(isVideoFile("photo.png")).toBe(false);
    expect(isVideoFile("script.js")).toBe(false);
    expect(isVideoFile("noextension")).toBe(false);
  });
});

describe("isPdfFile", () => {
  test("returns true for .pdf files", () => {
    expect(isPdfFile("document.pdf")).toBe(true);
    expect(isPdfFile("report.PDF")).toBe(true);
  });

  test("works with paths", () => {
    expect(isPdfFile("docs/report.pdf")).toBe(true);
    expect(isPdfFile("deep/nested/path/document.pdf")).toBe(true);
  });

  test("returns false for non-pdf files", () => {
    expect(isPdfFile("document.md")).toBe(false);
    expect(isPdfFile("photo.png")).toBe(false);
    expect(isPdfFile("script.js")).toBe(false);
    expect(isPdfFile("noextension")).toBe(false);
  });
});

describe("isMarkdownFile", () => {
  test("returns true for .md files", () => {
    expect(isMarkdownFile("notes.md")).toBe(true);
    expect(isMarkdownFile("README.MD")).toBe(true);
  });

  test("works with paths", () => {
    expect(isMarkdownFile("docs/notes.md")).toBe(true);
  });

  test("returns false for non-markdown files", () => {
    expect(isMarkdownFile("photo.png")).toBe(false);
    expect(isMarkdownFile("script.js")).toBe(false);
  });
});

describe("isJsonFile", () => {
  test("returns true for .json files", () => {
    expect(isJsonFile("data.json")).toBe(true);
    expect(isJsonFile("config.JSON")).toBe(true);
  });

  test("works with paths", () => {
    expect(isJsonFile("config/settings.json")).toBe(true);
    expect(isJsonFile("deep/nested/path/data.json")).toBe(true);
  });

  test("returns false for non-json files", () => {
    expect(isJsonFile("photo.png")).toBe(false);
    expect(isJsonFile("notes.md")).toBe(false);
    expect(isJsonFile("script.js")).toBe(false);
    expect(isJsonFile("data.jsonl")).toBe(false);
  });
});

describe("isCsvFile", () => {
  test("returns true for .csv files", () => {
    expect(isCsvFile("data.csv")).toBe(true);
    expect(isCsvFile("export.CSV")).toBe(true);
  });

  test("returns true for .tsv files", () => {
    expect(isCsvFile("data.tsv")).toBe(true);
    expect(isCsvFile("export.TSV")).toBe(true);
  });

  test("works with paths", () => {
    expect(isCsvFile("exports/data.csv")).toBe(true);
    expect(isCsvFile("deep/nested/path/file.tsv")).toBe(true);
  });

  test("returns false for non-csv files", () => {
    expect(isCsvFile("photo.png")).toBe(false);
    expect(isCsvFile("notes.md")).toBe(false);
    expect(isCsvFile("data.json")).toBe(false);
    expect(isCsvFile("script.js")).toBe(false);
    expect(isCsvFile("noextension")).toBe(false);
  });
});

describe("encodeAssetPath", () => {
  test("passes through simple paths unchanged", () => {
    expect(encodeAssetPath("attachments/image.png")).toBe("attachments/image.png");
  });

  test("encodes spaces", () => {
    expect(encodeAssetPath("my photos/image 1.png")).toBe("my%20photos/image%201.png");
  });

  test("encodes special characters", () => {
    expect(encodeAssetPath("notes#1/file?v=2.png")).toBe("notes%231/file%3Fv%3D2.png");
  });

  test("preserves directory separators", () => {
    expect(encodeAssetPath("a/b/c/d.png")).toBe("a/b/c/d.png");
  });

  test("encodes ampersands", () => {
    expect(encodeAssetPath("docs/Q&A.png")).toBe("docs/Q%26A.png");
  });

  test("handles empty path", () => {
    expect(encodeAssetPath("")).toBe("");
  });

  test("handles single segment", () => {
    expect(encodeAssetPath("file name.png")).toBe("file%20name.png");
  });
});
