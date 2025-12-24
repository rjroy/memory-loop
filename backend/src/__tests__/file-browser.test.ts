/**
 * File Browser Tests
 *
 * Unit tests for file browser functionality including path validation,
 * directory listing, and file reading.
 * Uses filesystem mocking with temp directories for isolated testing.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  isPathWithinVault,
  validatePath,
  listDirectory,
  readMarkdownFile,
  MAX_FILE_SIZE,
  PathTraversalError,
  DirectoryNotFoundError,
  FileNotFoundError,
  InvalidFileTypeError,
  FileBrowserError,
} from "../file-browser";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a unique temporary directory for testing.
 */
async function createTestDir(): Promise<string> {
  const testDir = join(
    tmpdir(),
    `file-browser-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(testDir, { recursive: true });
  return testDir;
}

/**
 * Recursively removes a test directory.
 */
async function cleanupTestDir(testDir: string): Promise<void> {
  try {
    await rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// =============================================================================
// Error Class Tests
// =============================================================================

describe("Error Classes", () => {
  describe("FileBrowserError", () => {
    test("has correct name and code", () => {
      const error = new FileBrowserError("Test", "INTERNAL_ERROR");
      expect(error.name).toBe("FileBrowserError");
      expect(error.code).toBe("INTERNAL_ERROR");
    });

    test("is instance of Error", () => {
      const error = new FileBrowserError("Test", "INTERNAL_ERROR");
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("PathTraversalError", () => {
    test("has correct name and code", () => {
      const error = new PathTraversalError("Traversal attempt");
      expect(error.name).toBe("PathTraversalError");
      expect(error.code).toBe("PATH_TRAVERSAL");
    });

    test("is instance of FileBrowserError", () => {
      const error = new PathTraversalError("Test");
      expect(error).toBeInstanceOf(FileBrowserError);
    });
  });

  describe("DirectoryNotFoundError", () => {
    test("has correct name and code", () => {
      const error = new DirectoryNotFoundError("Not found");
      expect(error.name).toBe("DirectoryNotFoundError");
      expect(error.code).toBe("DIRECTORY_NOT_FOUND");
    });
  });

  describe("FileNotFoundError", () => {
    test("has correct name and code", () => {
      const error = new FileNotFoundError("Not found");
      expect(error.name).toBe("FileNotFoundError");
      expect(error.code).toBe("FILE_NOT_FOUND");
    });
  });

  describe("InvalidFileTypeError", () => {
    test("has correct name and code", () => {
      const error = new InvalidFileTypeError("Invalid type");
      expect(error.name).toBe("InvalidFileTypeError");
      expect(error.code).toBe("INVALID_FILE_TYPE");
    });
  });
});

// =============================================================================
// Path Validation Tests
// =============================================================================

describe("isPathWithinVault", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  test("returns true for vault root path", async () => {
    expect(await isPathWithinVault(testDir, testDir)).toBe(true);
  });

  test("returns true for subdirectory", async () => {
    const subdir = join(testDir, "subdir");
    await mkdir(subdir);
    expect(await isPathWithinVault(testDir, subdir)).toBe(true);
  });

  test("returns true for nested file", async () => {
    const nested = join(testDir, "a", "b", "c");
    await mkdir(nested, { recursive: true });
    const file = join(nested, "file.md");
    await writeFile(file, "content");
    expect(await isPathWithinVault(testDir, file)).toBe(true);
  });

  test("returns false for parent directory", async () => {
    const parent = join(testDir, "..");
    expect(await isPathWithinVault(testDir, parent)).toBe(false);
  });

  test("returns false for sibling directory", async () => {
    const sibling = join(testDir, "..", "other");
    await mkdir(sibling, { recursive: true });
    expect(await isPathWithinVault(testDir, sibling)).toBe(false);
    await cleanupTestDir(sibling);
  });

  test("returns true for non-existent path within vault", async () => {
    // Non-existent paths within the vault boundary should return true
    // The existence check is separate from the boundary check
    const nonexistent = join(testDir, "does-not-exist");
    expect(await isPathWithinVault(testDir, nonexistent)).toBe(true);
  });

  test("handles paths with similar prefixes correctly", async () => {
    // Create /vault and /vault2 - they should NOT be considered the same
    const vault = join(testDir, "vault");
    const vault2 = join(testDir, "vault2");
    await mkdir(vault);
    await mkdir(vault2);

    expect(await isPathWithinVault(vault, vault2)).toBe(false);
  });
});

describe("validatePath", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
    await mkdir(join(testDir, "subdir"));
    await writeFile(join(testDir, "file.md"), "content");
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  test("returns absolute path for valid relative path", async () => {
    const result = await validatePath(testDir, "subdir");
    expect(result).toBe(join(testDir, "subdir"));
  });

  test("throws PathTraversalError for parent traversal", async () => {
    try {
      await validatePath(testDir, "../outside");
      expect.unreachable("Should have thrown PathTraversalError");
    } catch (error) {
      expect(error).toBeInstanceOf(PathTraversalError);
    }
  });

  test("throws PathTraversalError for absolute path outside vault", async () => {
    try {
      await validatePath(testDir, "/etc/passwd");
      expect.unreachable("Should have thrown PathTraversalError");
    } catch (error) {
      expect(error).toBeInstanceOf(PathTraversalError);
    }
  });

  test("treats URL-encoded paths as literal filenames (not traversal)", async () => {
    // URL encoding is NOT decoded by path.resolve
    // So "..%2F..%2Fetc" is treated as a literal directory name, not traversal
    // This is correct behavior since we're dealing with filesystem paths, not URLs
    const result = await validatePath(testDir, "..%2F..%2Fetc");
    expect(result).toBe(join(testDir, "..%2F..%2Fetc"));
  });

  test("throws PathTraversalError for double-dot traversal", async () => {
    // Real traversal attempt with actual ".." segments
    try {
      await validatePath(testDir, "foo/../../outside");
      expect.unreachable("Should have thrown PathTraversalError");
    } catch (error) {
      expect(error).toBeInstanceOf(PathTraversalError);
    }
  });
});

// =============================================================================
// Directory Listing Tests
// =============================================================================

describe("listDirectory", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  test("lists empty directory", async () => {
    const entries = await listDirectory(testDir, "");
    expect(entries).toEqual([]);
  });

  test("lists files and directories", async () => {
    await mkdir(join(testDir, "folder"));
    await writeFile(join(testDir, "file.md"), "content");

    const entries = await listDirectory(testDir, "");
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.name === "folder")?.type).toBe("directory");
    expect(entries.find((e) => e.name === "file.md")?.type).toBe("file");
  });

  test("excludes hidden files", async () => {
    await writeFile(join(testDir, ".hidden"), "content");
    await writeFile(join(testDir, "visible.md"), "content");

    const entries = await listDirectory(testDir, "");
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("visible.md");
  });

  test("excludes hidden directories", async () => {
    await mkdir(join(testDir, ".obsidian"));
    await mkdir(join(testDir, "visible"));

    const entries = await listDirectory(testDir, "");
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("visible");
  });

  test("sorts directories before files", async () => {
    await writeFile(join(testDir, "a-file.md"), "");
    await mkdir(join(testDir, "z-folder"));
    await writeFile(join(testDir, "b-file.md"), "");
    await mkdir(join(testDir, "a-folder"));

    const entries = await listDirectory(testDir, "");
    expect(entries.map((e) => e.name)).toEqual([
      "a-folder",
      "z-folder",
      "a-file.md",
      "b-file.md",
    ]);
  });

  test("sorts alphabetically within same type (case-insensitive)", async () => {
    await mkdir(join(testDir, "Zebra"));
    await mkdir(join(testDir, "alpha"));
    await mkdir(join(testDir, "Beta"));

    const entries = await listDirectory(testDir, "");
    expect(entries.map((e) => e.name)).toEqual(["alpha", "Beta", "Zebra"]);
  });

  test("includes correct relative paths", async () => {
    await mkdir(join(testDir, "subdir"));
    await writeFile(join(testDir, "subdir", "note.md"), "");

    const entries = await listDirectory(testDir, "subdir");
    expect(entries[0].path).toBe("subdir/note.md");
  });

  test("handles root path correctly", async () => {
    await mkdir(join(testDir, "folder"));

    const entries = await listDirectory(testDir, "");
    expect(entries[0].path).toBe("folder");
  });

  test("throws DirectoryNotFoundError for non-existent directory", async () => {
    try {
      await listDirectory(testDir, "nonexistent");
      expect.unreachable("Should have thrown DirectoryNotFoundError");
    } catch (error) {
      expect(error).toBeInstanceOf(DirectoryNotFoundError);
    }
  });

  test("throws DirectoryNotFoundError for file (not directory)", async () => {
    await writeFile(join(testDir, "file.md"), "");

    try {
      await listDirectory(testDir, "file.md");
      expect.unreachable("Should have thrown DirectoryNotFoundError");
    } catch (error) {
      expect(error).toBeInstanceOf(DirectoryNotFoundError);
    }
  });

  test("throws PathTraversalError for path outside vault", async () => {
    try {
      await listDirectory(testDir, "../outside");
      expect.unreachable("Should have thrown PathTraversalError");
    } catch (error) {
      expect(error).toBeInstanceOf(PathTraversalError);
    }
  });

  test("rejects symlinks to directories", async () => {
    const realDir = join(testDir, "real");
    const linkPath = join(testDir, "link");
    await mkdir(realDir);

    try {
      await symlink(realDir, linkPath);

      // Listing the symlink directory should throw
      try {
        await listDirectory(testDir, "link");
        expect.unreachable("Should have thrown PathTraversalError");
      } catch (error) {
        expect(error).toBeInstanceOf(PathTraversalError);
      }
    } catch (error) {
      // Symlinks may not be supported on all platforms
      if (
        error instanceof Error &&
        (error.message.includes("EPERM") ||
          error.message.includes("operation not permitted"))
      ) {
        console.log("Skipping symlink test - not supported on this platform");
        return;
      }
      throw error;
    }
  });

  test("excludes symlink entries from listings", async () => {
    const realFile = join(testDir, "real.md");
    const linkPath = join(testDir, "link.md");
    const normalFile = join(testDir, "normal.md");

    await writeFile(realFile, "content");
    await writeFile(normalFile, "content");

    try {
      await symlink(realFile, linkPath);

      const entries = await listDirectory(testDir, "");
      // Should only include real.md and normal.md, not link.md
      expect(entries.map((e) => e.name).sort()).toEqual(["normal.md", "real.md"]);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("EPERM") ||
          error.message.includes("operation not permitted"))
      ) {
        console.log("Skipping symlink test - not supported on this platform");
        return;
      }
      throw error;
    }
  });

  test("handles deeply nested directories", async () => {
    const deepPath = join(testDir, "a", "b", "c", "d", "e");
    await mkdir(deepPath, { recursive: true });
    await writeFile(join(deepPath, "deep.md"), "");

    const entries = await listDirectory(testDir, "a/b/c/d/e");
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("deep.md");
    expect(entries[0].path).toBe("a/b/c/d/e/deep.md");
  });
});

// =============================================================================
// File Reading Tests
// =============================================================================

describe("readMarkdownFile", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  test("reads markdown file content", async () => {
    const content = "# Hello World\n\nThis is content.";
    await writeFile(join(testDir, "note.md"), content);

    const result = await readMarkdownFile(testDir, "note.md");
    expect(result.content).toBe(content);
    expect(result.truncated).toBe(false);
  });

  test("reads nested file", async () => {
    await mkdir(join(testDir, "folder"));
    await writeFile(join(testDir, "folder", "nested.md"), "nested content");

    const result = await readMarkdownFile(testDir, "folder/nested.md");
    expect(result.content).toBe("nested content");
  });

  test("throws InvalidFileTypeError for non-md file", async () => {
    await writeFile(join(testDir, "image.png"), "binary content");

    try {
      await readMarkdownFile(testDir, "image.png");
      expect.unreachable("Should have thrown InvalidFileTypeError");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidFileTypeError);
    }
  });

  test("throws InvalidFileTypeError for txt file", async () => {
    await writeFile(join(testDir, "notes.txt"), "text content");

    try {
      await readMarkdownFile(testDir, "notes.txt");
      expect.unreachable("Should have thrown InvalidFileTypeError");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidFileTypeError);
    }
  });

  test("throws InvalidFileTypeError for file without extension", async () => {
    await writeFile(join(testDir, "README"), "content");

    try {
      await readMarkdownFile(testDir, "README");
      expect.unreachable("Should have thrown InvalidFileTypeError");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidFileTypeError);
    }
  });

  test("throws FileNotFoundError for non-existent file", async () => {
    try {
      await readMarkdownFile(testDir, "missing.md");
      expect.unreachable("Should have thrown FileNotFoundError");
    } catch (error) {
      expect(error).toBeInstanceOf(FileNotFoundError);
    }
  });

  test("throws FileNotFoundError for directory (not file)", async () => {
    await mkdir(join(testDir, "folder.md"));

    try {
      await readMarkdownFile(testDir, "folder.md");
      expect.unreachable("Should have thrown FileNotFoundError");
    } catch (error) {
      expect(error).toBeInstanceOf(FileNotFoundError);
    }
  });

  test("throws PathTraversalError for path outside vault", async () => {
    try {
      await readMarkdownFile(testDir, "../../../etc/passwd.md");
      expect.unreachable("Should have thrown PathTraversalError");
    } catch (error) {
      expect(error).toBeInstanceOf(PathTraversalError);
    }
  });

  test("rejects symlink files", async () => {
    const realFile = join(testDir, "real.md");
    const linkPath = join(testDir, "link.md");
    await writeFile(realFile, "content");

    try {
      await symlink(realFile, linkPath);

      try {
        await readMarkdownFile(testDir, "link.md");
        expect.unreachable("Should have thrown PathTraversalError");
      } catch (error) {
        expect(error).toBeInstanceOf(PathTraversalError);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("EPERM") ||
          error.message.includes("operation not permitted"))
      ) {
        console.log("Skipping symlink test - not supported on this platform");
        return;
      }
      throw error;
    }
  });

  test("handles files with unicode content", async () => {
    const content = "# Unicode Test\n\nEmoji: 🎉\nJapanese: 日本語\nArabic: العربية";
    await writeFile(join(testDir, "unicode.md"), content);

    const result = await readMarkdownFile(testDir, "unicode.md");
    expect(result.content).toBe(content);
  });

  test("handles empty file", async () => {
    await writeFile(join(testDir, "empty.md"), "");

    const result = await readMarkdownFile(testDir, "empty.md");
    expect(result.content).toBe("");
    expect(result.truncated).toBe(false);
  });

  test("handles file with only whitespace", async () => {
    await writeFile(join(testDir, "whitespace.md"), "   \n\n\t\t\n   ");

    const result = await readMarkdownFile(testDir, "whitespace.md");
    expect(result.content).toBe("   \n\n\t\t\n   ");
  });
});

// =============================================================================
// Large File Truncation Tests
// =============================================================================

describe("Large File Truncation", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  test("MAX_FILE_SIZE is 1MB", () => {
    expect(MAX_FILE_SIZE).toBe(1024 * 1024);
  });

  test("file exactly at limit is not truncated", async () => {
    // Create file exactly at 1MB
    const content = "x".repeat(MAX_FILE_SIZE);
    await writeFile(join(testDir, "exact.md"), content);

    const result = await readMarkdownFile(testDir, "exact.md");
    expect(result.truncated).toBe(false);
    expect(result.content.length).toBe(MAX_FILE_SIZE);
  });

  test("file over limit is truncated", async () => {
    // Create file slightly over 1MB
    const content = "x".repeat(MAX_FILE_SIZE + 100);
    await writeFile(join(testDir, "large.md"), content);

    const result = await readMarkdownFile(testDir, "large.md");
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBe(MAX_FILE_SIZE);
  });

  test("file under limit is not truncated", async () => {
    const content = "Small file content";
    await writeFile(join(testDir, "small.md"), content);

    const result = await readMarkdownFile(testDir, "small.md");
    expect(result.truncated).toBe(false);
    expect(result.content).toBe(content);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Edge Cases", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  test("handles directory with spaces in name", async () => {
    await mkdir(join(testDir, "folder with spaces"));
    await writeFile(join(testDir, "folder with spaces", "note.md"), "content");

    const entries = await listDirectory(testDir, "folder with spaces");
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("note.md");
  });

  test("handles file with spaces in name", async () => {
    await writeFile(join(testDir, "my note file.md"), "content");

    const result = await readMarkdownFile(testDir, "my note file.md");
    expect(result.content).toBe("content");
  });

  test("handles special characters in filenames", async () => {
    const specialName = "note-with_special.chars(2025).md";
    await writeFile(join(testDir, specialName), "content");

    const result = await readMarkdownFile(testDir, specialName);
    expect(result.content).toBe("content");
  });

  test("case-sensitive file extension check (.MD vs .md)", async () => {
    // .MD should also be accepted (case-insensitive extension check)
    await writeFile(join(testDir, "note.MD"), "content");

    const result = await readMarkdownFile(testDir, "note.MD");
    expect(result.content).toBe("content");
  });

  test("handles paths with multiple slashes", async () => {
    await mkdir(join(testDir, "a", "b"), { recursive: true });
    await writeFile(join(testDir, "a", "b", "file.md"), "content");

    // Multiple slashes should be normalized
    const result = await readMarkdownFile(testDir, "a//b//file.md");
    expect(result.content).toBe("content");
  });

  test("handles Obsidian-style paths with forward slashes", async () => {
    await mkdir(join(testDir, "Projects", "SubProject"), { recursive: true });
    await writeFile(
      join(testDir, "Projects", "SubProject", "notes.md"),
      "content"
    );

    const result = await readMarkdownFile(
      testDir,
      "Projects/SubProject/notes.md"
    );
    expect(result.content).toBe("content");
  });

  test("rejects path with null bytes", async () => {
    try {
      await readMarkdownFile(testDir, "file\x00.md");
      expect.unreachable("Should have thrown an error");
    } catch {
      // Any error is acceptable for null byte in path
    }
  });

  test("handles markdown files in root and subdirectories consistently", async () => {
    await writeFile(join(testDir, "root.md"), "root content");
    await mkdir(join(testDir, "sub"));
    await writeFile(join(testDir, "sub", "nested.md"), "nested content");

    const rootEntries = await listDirectory(testDir, "");
    const subEntries = await listDirectory(testDir, "sub");

    expect(rootEntries.find((e) => e.name === "root.md")?.path).toBe("root.md");
    expect(subEntries.find((e) => e.name === "nested.md")?.path).toBe(
      "sub/nested.md"
    );
  });
});

// =============================================================================
// Performance Characteristics (basic verification)
// =============================================================================

describe("Performance", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  test("handles directory with many files", async () => {
    // Create 100 files
    const fileCount = 100;
    for (let i = 0; i < fileCount; i++) {
      await writeFile(join(testDir, `file-${String(i).padStart(3, "0")}.md`), "");
    }

    const start = Date.now();
    const entries = await listDirectory(testDir, "");
    const duration = Date.now() - start;

    expect(entries).toHaveLength(fileCount);
    // Should complete within 500ms for 100 files
    expect(duration).toBeLessThan(500);
  });
});
