/**
 * File Browser Tests
 *
 * Unit tests for file browser functionality including path validation,
 * directory listing, and file reading.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile, readFile, rm, symlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  isPathWithinVault,
  validatePath,
  listDirectory,
  readMarkdownFile,
  writeMarkdownFile,
  deleteFile,
  getDirectoryContents,
  deleteDirectory,
  archiveFile,
  createDirectory,
  createFile,
  renameFile,
  moveFile,
  MAX_FILE_SIZE,
  PathTraversalError,
  DirectoryNotFoundError,
  FileNotFoundError,
  InvalidFileTypeError,
  InvalidDirectoryNameError,
  DirectoryExistsError,
  InvalidFileNameError,
  FileExistsError,
  FileBrowserError,
} from "../file-browser.js";

// =============================================================================
// Test Helpers
// =============================================================================

async function createTestDir(): Promise<string> {
  const testDir = join(
    tmpdir(),
    `file-browser-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(testDir, { recursive: true });
  return testDir;
}

async function cleanupTestDir(testDir: string): Promise<void> {
  try {
    await rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Runs a test that requires symlinks. Skips gracefully on platforms that don't support them.
 */
async function withSymlink(
  target: string,
  linkPath: string,
  testFn: () => Promise<void>
): Promise<void> {
  try {
    await symlink(target, linkPath);
    await testFn();
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("EPERM") || error.message.includes("operation not permitted"))
    ) {
      console.log("Skipping symlink test - not supported on this platform");
      return;
    }
    throw error;
  }
}

/**
 * Asserts that an async function throws an error of the expected type.
 */
async function expectError<T extends Error>(
  fn: () => Promise<unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  errorType: new (...args: any[]) => T,
  messageContains?: string
): Promise<void> {
  try {
    await fn();
    expect.unreachable(`Should have thrown ${errorType.name}`);
  } catch (error) {
    expect(error).toBeInstanceOf(errorType);
    if (messageContains) {
      expect((error as Error).message).toContain(messageContains);
    }
  }
}

// =============================================================================
// Error Class Tests
// =============================================================================

describe("Error Classes", () => {
  test("FileBrowserError has correct name and code", () => {
    const error = new FileBrowserError("Test", "INTERNAL_ERROR");
    expect(error.name).toBe("FileBrowserError");
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error).toBeInstanceOf(Error);
  });

  test("PathTraversalError has correct name and code", () => {
    const error = new PathTraversalError("Traversal attempt");
    expect(error.name).toBe("PathTraversalError");
    expect(error.code).toBe("PATH_TRAVERSAL");
    expect(error).toBeInstanceOf(FileBrowserError);
  });

  test("DirectoryNotFoundError has correct name and code", () => {
    const error = new DirectoryNotFoundError("Not found");
    expect(error.name).toBe("DirectoryNotFoundError");
    expect(error.code).toBe("DIRECTORY_NOT_FOUND");
  });

  test("FileNotFoundError has correct name and code", () => {
    const error = new FileNotFoundError("Not found");
    expect(error.name).toBe("FileNotFoundError");
    expect(error.code).toBe("FILE_NOT_FOUND");
  });

  test("InvalidFileTypeError has correct name and code", () => {
    const error = new InvalidFileTypeError("Invalid type");
    expect(error.name).toBe("InvalidFileTypeError");
    expect(error.code).toBe("INVALID_FILE_TYPE");
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
    expect(await isPathWithinVault(testDir, join(testDir, ".."))).toBe(false);
  });

  test("returns false for sibling directory", async () => {
    const sibling = join(testDir, "..", "other");
    await mkdir(sibling, { recursive: true });
    expect(await isPathWithinVault(testDir, sibling)).toBe(false);
    await cleanupTestDir(sibling);
  });

  test("returns true for non-existent path within vault", async () => {
    expect(await isPathWithinVault(testDir, join(testDir, "does-not-exist"))).toBe(true);
  });

  test("handles paths with similar prefixes correctly", async () => {
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
    await expectError(() => validatePath(testDir, "../outside"), PathTraversalError);
  });

  test("throws PathTraversalError for absolute path outside vault", async () => {
    await expectError(() => validatePath(testDir, "/etc/passwd"), PathTraversalError);
  });

  test("treats URL-encoded paths as literal filenames", async () => {
    const result = await validatePath(testDir, "..%2F..%2Fetc");
    expect(result).toBe(join(testDir, "..%2F..%2Fetc"));
  });

  test("throws PathTraversalError for double-dot traversal", async () => {
    await expectError(() => validatePath(testDir, "foo/../../outside"), PathTraversalError);
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
    expect(await listDirectory(testDir, "")).toEqual([]);
  });

  test("lists files and directories", async () => {
    await mkdir(join(testDir, "folder"));
    await writeFile(join(testDir, "file.md"), "content");

    const entries = await listDirectory(testDir, "");
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.name === "folder")?.type).toBe("directory");
    expect(entries.find((e) => e.name === "file.md")?.type).toBe("file");
  });

  test("excludes hidden files and directories", async () => {
    await writeFile(join(testDir, ".hidden"), "content");
    await mkdir(join(testDir, ".obsidian"));
    await writeFile(join(testDir, "visible.md"), "content");
    await mkdir(join(testDir, "visible"));

    const entries = await listDirectory(testDir, "");
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.name).sort()).toEqual(["visible", "visible.md"]);
  });

  test("sorts directories before files, alphabetically within type", async () => {
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

  test("sorts case-insensitively", async () => {
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
    await expectError(() => listDirectory(testDir, "nonexistent"), DirectoryNotFoundError);
  });

  test("throws DirectoryNotFoundError for file (not directory)", async () => {
    await writeFile(join(testDir, "file.md"), "");
    await expectError(() => listDirectory(testDir, "file.md"), DirectoryNotFoundError);
  });

  test("throws PathTraversalError for path outside vault", async () => {
    await expectError(() => listDirectory(testDir, "../outside"), PathTraversalError);
  });

  test("rejects symlinks to directories", async () => {
    const realDir = join(testDir, "real");
    await mkdir(realDir);

    await withSymlink(realDir, join(testDir, "link"), async () => {
      await expectError(() => listDirectory(testDir, "link"), PathTraversalError);
    });
  });

  test("excludes symlink entries from listings", async () => {
    await writeFile(join(testDir, "real.md"), "content");
    await writeFile(join(testDir, "normal.md"), "content");

    await withSymlink(join(testDir, "real.md"), join(testDir, "link.md"), async () => {
      const entries = await listDirectory(testDir, "");
      expect(entries.map((e) => e.name).sort()).toEqual(["normal.md", "real.md"]);
    });
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

  test("throws InvalidFileTypeError for non-text file", async () => {
    await writeFile(join(testDir, "image.png"), "binary content");
    await expectError(() => readMarkdownFile(testDir, "image.png"), InvalidFileTypeError);
  });

  test("throws InvalidFileTypeError for file without extension", async () => {
    await writeFile(join(testDir, "README"), "content");
    await expectError(() => readMarkdownFile(testDir, "README"), InvalidFileTypeError);
  });

  test("throws FileNotFoundError for non-existent file", async () => {
    await expectError(() => readMarkdownFile(testDir, "missing.md"), FileNotFoundError);
  });

  test("throws FileNotFoundError for directory (not file)", async () => {
    await mkdir(join(testDir, "folder.md"));
    await expectError(() => readMarkdownFile(testDir, "folder.md"), FileNotFoundError);
  });

  test("throws PathTraversalError for path outside vault", async () => {
    await expectError(
      () => readMarkdownFile(testDir, "../../../etc/passwd.md"),
      PathTraversalError
    );
  });

  test("rejects symlink files", async () => {
    await writeFile(join(testDir, "real.md"), "content");

    await withSymlink(join(testDir, "real.md"), join(testDir, "link.md"), async () => {
      await expectError(() => readMarkdownFile(testDir, "link.md"), PathTraversalError);
    });
  });

  test("handles files with unicode content", async () => {
    const content = "# Unicode Test\n\nEmoji: \u{1F389}\nJapanese: \u65E5\u672C\u8A9E\nArabic: \u0627\u0644\u0639\u0631\u0628\u064A\u0629";
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
    const content = "x".repeat(MAX_FILE_SIZE);
    await writeFile(join(testDir, "exact.md"), content);

    const result = await readMarkdownFile(testDir, "exact.md");
    expect(result.truncated).toBe(false);
    expect(result.content.length).toBe(MAX_FILE_SIZE);
  });

  test("file over limit is truncated", async () => {
    const content = "x".repeat(MAX_FILE_SIZE + 100);
    await writeFile(join(testDir, "large.md"), content);

    const result = await readMarkdownFile(testDir, "large.md");
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBe(MAX_FILE_SIZE);
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

  test("case-insensitive file extension check (.MD vs .md)", async () => {
    await writeFile(join(testDir, "note.MD"), "content");

    const result = await readMarkdownFile(testDir, "note.MD");
    expect(result.content).toBe("content");
  });

  test("handles paths with multiple slashes", async () => {
    await mkdir(join(testDir, "a", "b"), { recursive: true });
    await writeFile(join(testDir, "a", "b", "file.md"), "content");

    const result = await readMarkdownFile(testDir, "a//b//file.md");
    expect(result.content).toBe("content");
  });

  test("handles Obsidian-style paths with forward slashes", async () => {
    await mkdir(join(testDir, "Projects", "SubProject"), { recursive: true });
    await writeFile(join(testDir, "Projects", "SubProject", "notes.md"), "content");

    const result = await readMarkdownFile(testDir, "Projects/SubProject/notes.md");
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
    expect(subEntries.find((e) => e.name === "nested.md")?.path).toBe("sub/nested.md");
  });
});

// =============================================================================
// Performance Characteristics
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
    const fileCount = 100;
    for (let i = 0; i < fileCount; i++) {
      await writeFile(join(testDir, `file-${String(i).padStart(3, "0")}.md`), "");
    }

    const start = Date.now();
    const entries = await listDirectory(testDir, "");
    const duration = Date.now() - start;

    expect(entries).toHaveLength(fileCount);
    expect(duration).toBeLessThan(500);
  });
});

// =============================================================================
// File Writing Tests
// =============================================================================

describe("writeMarkdownFile", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  test("writes content to existing markdown file", async () => {
    await writeFile(join(testDir, "note.md"), "original");
    const newContent = "# Updated Content\n\nThis has been modified.";

    await writeMarkdownFile(testDir, "note.md", newContent);

    const fileContent = await readFile(join(testDir, "note.md"), "utf-8");
    expect(fileContent).toBe(newContent);
  });

  test("writes to nested file", async () => {
    await mkdir(join(testDir, "folder"));
    await writeFile(join(testDir, "folder", "nested.md"), "original");

    await writeMarkdownFile(testDir, "folder/nested.md", "updated");

    const fileContent = await readFile(join(testDir, "folder", "nested.md"), "utf-8");
    expect(fileContent).toBe("updated");
  });

  test("writes empty content (clears file)", async () => {
    await writeFile(join(testDir, "note.md"), "some content");

    await writeMarkdownFile(testDir, "note.md", "");

    const fileContent = await readFile(join(testDir, "note.md"), "utf-8");
    expect(fileContent).toBe("");
  });

  test("throws InvalidFileTypeError for non-text file", async () => {
    await writeFile(join(testDir, "image.png"), "binary content");
    await expectError(
      () => writeMarkdownFile(testDir, "image.png", "new content"),
      InvalidFileTypeError
    );
  });

  test("throws FileNotFoundError for non-existent file", async () => {
    await expectError(
      () => writeMarkdownFile(testDir, "missing.md", "content"),
      FileNotFoundError
    );
  });

  test("throws FileNotFoundError for directory (not file)", async () => {
    await mkdir(join(testDir, "folder.md"));
    await expectError(
      () => writeMarkdownFile(testDir, "folder.md", "content"),
      FileNotFoundError
    );
  });

  test("throws PathTraversalError for path outside vault", async () => {
    await expectError(
      () => writeMarkdownFile(testDir, "../../../etc/passwd.md", "malicious"),
      PathTraversalError
    );
  });

  test("rejects symlink files", async () => {
    await writeFile(join(testDir, "real.md"), "original content");

    await withSymlink(join(testDir, "real.md"), join(testDir, "link.md"), async () => {
      await expectError(
        () => writeMarkdownFile(testDir, "link.md", "new content"),
        PathTraversalError
      );

      // Verify original file was NOT modified
      const originalContent = await readFile(join(testDir, "real.md"), "utf-8");
      expect(originalContent).toBe("original content");
    });
  });

  test("preserves original content on validation error", async () => {
    const originalContent = "# Important Content";
    await writeFile(join(testDir, "important.md"), originalContent);

    try {
      await writeMarkdownFile(testDir, "../important.md", "malicious");
    } catch {
      // Expected to throw
    }

    const fileContent = await readFile(join(testDir, "important.md"), "utf-8");
    expect(fileContent).toBe(originalContent);
  });
});

// =============================================================================
// Multi-Format File Support Tests (JSON, TXT, CSV, TSV)
// =============================================================================

describe("Multi-format file support", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  const formats = [
    { ext: "json", content: JSON.stringify({ name: "test", value: 42 }, null, 2) },
    { ext: "txt", content: "Plain text content\nwith multiple lines." },
    { ext: "csv", content: "Name,Age,City\nAlice,30,NYC\nBob,25,LA" },
    { ext: "tsv", content: "Name\tAge\tCity\nAlice\t30\tNYC" },
  ];

  for (const { ext, content } of formats) {
    test(`reads ${ext.toUpperCase()} file content`, async () => {
      await writeFile(join(testDir, `data.${ext}`), content);

      const result = await readMarkdownFile(testDir, `data.${ext}`);
      expect(result.content).toBe(content);
      expect(result.truncated).toBe(false);
    });

    test(`reads nested ${ext.toUpperCase()} file`, async () => {
      await mkdir(join(testDir, "folder"));
      await writeFile(join(testDir, "folder", `file.${ext}`), content);

      const result = await readMarkdownFile(testDir, `folder/file.${ext}`);
      expect(result.content).toBe(content);
    });

    test(`handles ${ext.toUpperCase()} file with uppercase extension`, async () => {
      await writeFile(join(testDir, `DATA.${ext.toUpperCase()}`), content);

      const result = await readMarkdownFile(testDir, `DATA.${ext.toUpperCase()}`);
      expect(result.content).toBe(content);
    });

    test(`writes content to existing ${ext.toUpperCase()} file`, async () => {
      await writeFile(join(testDir, `data.${ext}`), "original");

      await writeMarkdownFile(testDir, `data.${ext}`, content);

      const fileContent = await readFile(join(testDir, `data.${ext}`), "utf-8");
      expect(fileContent).toBe(content);
    });

    test(`throws FileNotFoundError for non-existent ${ext.toUpperCase()} file`, async () => {
      await expectError(
        () => writeMarkdownFile(testDir, `missing.${ext}`, content),
        FileNotFoundError
      );
    });
  }
});

// =============================================================================
// deleteFile Tests
// =============================================================================

describe("deleteFile", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  async function expectDeleted(filePath: string): Promise<void> {
    try {
      await stat(filePath);
      expect.unreachable("File should have been deleted");
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
    }
  }

  test("deletes an existing file", async () => {
    await writeFile(join(testDir, "to-delete.txt"), "content");

    await deleteFile(testDir, "to-delete.txt");

    await expectDeleted(join(testDir, "to-delete.txt"));
  });

  test("deletes file in nested directory", async () => {
    await mkdir(join(testDir, "folder", "subfolder"), { recursive: true });
    await writeFile(join(testDir, "folder", "subfolder", "nested.txt"), "content");

    await deleteFile(testDir, "folder/subfolder/nested.txt");

    await expectDeleted(join(testDir, "folder", "subfolder", "nested.txt"));
  });

  test("throws FileNotFoundError for non-existent file", async () => {
    await expectError(() => deleteFile(testDir, "does-not-exist.txt"), FileNotFoundError);
  });

  test("throws InvalidFileTypeError for directories", async () => {
    await mkdir(join(testDir, "a-directory"));
    await expectError(
      () => deleteFile(testDir, "a-directory"),
      InvalidFileTypeError,
      "directory"
    );
  });

  test("throws PathTraversalError for path traversal attempts", async () => {
    const outsideDir = await createTestDir();
    try {
      await writeFile(join(outsideDir, "secret.txt"), "secret content");

      await expectError(
        () => deleteFile(testDir, `../${outsideDir.split("/").pop()}/secret.txt`),
        PathTraversalError
      );
    } finally {
      await cleanupTestDir(outsideDir);
    }
  });

  test("throws PathTraversalError for absolute path", async () => {
    await expectError(() => deleteFile(testDir, "/etc/passwd"), PathTraversalError);
  });

  test("throws PathTraversalError for symlink", async () => {
    await writeFile(join(testDir, "real.txt"), "real content");

    await withSymlink(join(testDir, "real.txt"), join(testDir, "link.txt"), async () => {
      await expectError(
        () => deleteFile(testDir, "link.txt"),
        PathTraversalError,
        "symbolic link"
      );

      // Verify original file was NOT deleted
      const fileContent = await readFile(join(testDir, "real.txt"), "utf-8");
      expect(fileContent).toBe("real content");
    });
  });

  test("handles file with unicode name", async () => {
    const fileName = "\u65E5\u672C\u8A9E\u30D5\u30A1\u30A4\u30EB.txt";
    await writeFile(join(testDir, fileName), "content");

    await deleteFile(testDir, fileName);

    await expectDeleted(join(testDir, fileName));
  });
});

// =============================================================================
// getDirectoryContents Tests
// =============================================================================

describe("getDirectoryContents", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("returns empty contents for empty directory", async () => {
    await mkdir(join(testDir, "empty-dir"));

    const result = await getDirectoryContents(testDir, "empty-dir");

    expect(result.files).toEqual([]);
    expect(result.directories).toEqual([]);
    expect(result.totalFiles).toBe(0);
    expect(result.totalDirectories).toBe(0);
    expect(result.truncated).toBe(false);
  });

  test("returns files and subdirectories", async () => {
    await mkdir(join(testDir, "my-dir"));
    await mkdir(join(testDir, "my-dir", "subdir"));
    await writeFile(join(testDir, "my-dir", "file1.md"), "content");
    await writeFile(join(testDir, "my-dir", "file2.txt"), "content");

    const result = await getDirectoryContents(testDir, "my-dir");

    expect(result.files).toContain("file1.md");
    expect(result.files).toContain("file2.txt");
    expect(result.directories).toContain("subdir");
    expect(result.totalFiles).toBe(2);
    expect(result.totalDirectories).toBe(1);
  });

  test("includes nested files in totalFiles count", async () => {
    await mkdir(join(testDir, "my-dir", "subdir"), { recursive: true });
    await writeFile(join(testDir, "my-dir", "file1.md"), "content");
    await writeFile(join(testDir, "my-dir", "subdir", "file2.md"), "content");

    const result = await getDirectoryContents(testDir, "my-dir");

    expect(result.totalFiles).toBe(2);
    expect(result.totalDirectories).toBe(1);
  });

  test("skips hidden files", async () => {
    await mkdir(join(testDir, "my-dir"));
    await writeFile(join(testDir, "my-dir", ".hidden"), "content");
    await writeFile(join(testDir, "my-dir", "visible.md"), "content");

    const result = await getDirectoryContents(testDir, "my-dir");

    expect(result.files).toEqual(["visible.md"]);
    expect(result.totalFiles).toBe(1);
  });

  test("throws DirectoryNotFoundError for non-existent directory", async () => {
    await expectError(() => getDirectoryContents(testDir, "non-existent"), DirectoryNotFoundError);
  });

  test("throws InvalidFileTypeError if path is a file", async () => {
    await writeFile(join(testDir, "a-file.md"), "content");
    await expectError(() => getDirectoryContents(testDir, "a-file.md"), InvalidFileTypeError);
  });

  test("throws PathTraversalError for symlinks", async () => {
    await mkdir(join(testDir, "real-dir"));
    await symlink(join(testDir, "real-dir"), join(testDir, "symlink-dir"));

    await expectError(() => getDirectoryContents(testDir, "symlink-dir"), PathTraversalError);
  });
});

// =============================================================================
// deleteDirectory Tests
// =============================================================================

describe("deleteDirectory", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  async function expectDirectoryDeleted(dirPath: string): Promise<void> {
    try {
      await stat(dirPath);
      expect.unreachable("Directory should have been deleted");
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
    }
  }

  test("deletes empty directory", async () => {
    await mkdir(join(testDir, "empty-dir"));

    const result = await deleteDirectory(testDir, "empty-dir");

    expect(result.path).toBe("empty-dir");
    expect(result.filesDeleted).toBe(0);
    expect(result.directoriesDeleted).toBe(0);
    await expectDirectoryDeleted(join(testDir, "empty-dir"));
  });

  test("deletes directory with files", async () => {
    await mkdir(join(testDir, "my-dir"));
    await writeFile(join(testDir, "my-dir", "file1.md"), "content");
    await writeFile(join(testDir, "my-dir", "file2.md"), "content");

    const result = await deleteDirectory(testDir, "my-dir");

    expect(result.filesDeleted).toBe(2);
    expect(result.directoriesDeleted).toBe(0);
    await expectDirectoryDeleted(join(testDir, "my-dir"));
  });

  test("deletes directory with subdirectories recursively", async () => {
    await mkdir(join(testDir, "my-dir", "subdir"), { recursive: true });
    await writeFile(join(testDir, "my-dir", "file1.md"), "content");
    await writeFile(join(testDir, "my-dir", "subdir", "file2.md"), "content");

    const result = await deleteDirectory(testDir, "my-dir");

    expect(result.filesDeleted).toBe(2);
    expect(result.directoriesDeleted).toBe(1);
    await expectDirectoryDeleted(join(testDir, "my-dir"));
  });

  test("throws DirectoryNotFoundError for non-existent directory", async () => {
    await expectError(() => deleteDirectory(testDir, "non-existent"), DirectoryNotFoundError);
  });

  test("throws InvalidFileTypeError if path is a file", async () => {
    await writeFile(join(testDir, "a-file.md"), "content");
    await expectError(() => deleteDirectory(testDir, "a-file.md"), InvalidFileTypeError);
  });

  test("throws PathTraversalError for symlinks", async () => {
    await mkdir(join(testDir, "real-dir"));
    await symlink(join(testDir, "real-dir"), join(testDir, "symlink-dir"));

    await expectError(() => deleteDirectory(testDir, "symlink-dir"), PathTraversalError);
  });

  test("prevents path traversal with ..", async () => {
    await mkdir(join(testDir, "my-dir"));
    await expectError(() => deleteDirectory(testDir, "../other-dir"), PathTraversalError);
  });
});

// =============================================================================
// archiveFile Tests
// =============================================================================

describe("archiveFile", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  test("archives a directory to the archive folder with YYYY-MM format", async () => {
    await mkdir(join(testDir, "01_Projects", "MyProject"), { recursive: true });
    await writeFile(join(testDir, "01_Projects", "MyProject", "notes.md"), "content");

    const result = await archiveFile(testDir, "01_Projects/MyProject");

    // Original should be moved
    try {
      await stat(join(testDir, "01_Projects", "MyProject"));
      expect.unreachable("Original directory should have been moved");
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
    }

    expect(result.originalPath).toBe("01_Projects/MyProject");
    expect(result.archivePath).toMatch(/^07_Archive\/\d{4}-\d{2}\/MyProject$/);

    // File should exist at new location
    const archivedFileStats = await stat(join(testDir, result.archivePath, "notes.md"));
    expect(archivedFileStats.isFile()).toBe(true);
  });

  test("archives chats directory to archive/YYYY-MM/chats/", async () => {
    await mkdir(join(testDir, "00_Inbox", "chats"), { recursive: true });
    await writeFile(join(testDir, "00_Inbox", "chats", "chat-2025-01-15.md"), "chat content");

    const result = await archiveFile(testDir, "00_Inbox/chats");

    expect(result.archivePath).toMatch(/^07_Archive\/\d{4}-\d{2}\/chats\/chats$/);
  });

  test("uses last modified date for YYYY-MM calculation", async () => {
    await mkdir(join(testDir, "01_Projects", "OldProject"), { recursive: true });
    await writeFile(join(testDir, "01_Projects", "OldProject", "old-notes.md"), "content");

    const now = new Date();
    const expectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const result = await archiveFile(testDir, "01_Projects/OldProject");

    expect(result.archivePath).toBe(`07_Archive/${expectedMonth}/OldProject`);
  });

  test("uses custom archive root when provided", async () => {
    await mkdir(join(testDir, "Projects", "MyProject"), { recursive: true });
    await writeFile(join(testDir, "Projects", "MyProject", "notes.md"), "content");

    const result = await archiveFile(testDir, "Projects/MyProject", "Archive");

    expect(result.archivePath).toMatch(/^Archive\/\d{4}-\d{2}\/MyProject$/);
  });

  test("creates archive directory if it does not exist", async () => {
    await mkdir(join(testDir, "Projects", "NewProject"), { recursive: true });
    await writeFile(join(testDir, "Projects", "NewProject", "notes.md"), "content");

    const result = await archiveFile(testDir, "Projects/NewProject");

    const archiveStats = await stat(join(testDir, "07_Archive"));
    expect(archiveStats.isDirectory()).toBe(true);

    const archivedFile = await stat(join(testDir, result.archivePath, "notes.md"));
    expect(archivedFile.isFile()).toBe(true);
  });

  test("throws DirectoryNotFoundError for non-existent directory", async () => {
    await expectError(() => archiveFile(testDir, "does-not-exist"), DirectoryNotFoundError);
  });

  test("throws InvalidFileTypeError for files (not directories)", async () => {
    await writeFile(join(testDir, "not-a-dir.txt"), "content");
    await expectError(
      () => archiveFile(testDir, "not-a-dir.txt"),
      InvalidFileTypeError,
      "directories"
    );
  });

  test("throws PathTraversalError for path traversal attempts", async () => {
    const outsideDir = await createTestDir();
    try {
      await mkdir(join(outsideDir, "secret-project"));

      await expectError(
        () => archiveFile(testDir, `../${outsideDir.split("/").pop()}/secret-project`),
        PathTraversalError
      );
    } finally {
      await cleanupTestDir(outsideDir);
    }
  });

  test("throws PathTraversalError for symlink directory", async () => {
    const realDir = join(testDir, "real-project");
    await mkdir(realDir);
    await writeFile(join(realDir, "notes.md"), "content");

    await withSymlink(realDir, join(testDir, "link-project"), async () => {
      await expectError(
        () => archiveFile(testDir, "link-project"),
        PathTraversalError,
        "symbolic link"
      );

      // Verify original directory was NOT moved
      const dirStats = await stat(realDir);
      expect(dirStats.isDirectory()).toBe(true);
    });
  });

  test("handles nested directory structure", async () => {
    await mkdir(join(testDir, "Projects", "Deep", "Nested", "Content"), { recursive: true });
    await writeFile(join(testDir, "Projects", "Deep", "Nested", "Content", "file.md"), "content");

    const result = await archiveFile(testDir, "Projects/Deep");

    const nestedFile = await stat(join(testDir, result.archivePath, "Nested", "Content", "file.md"));
    expect(nestedFile.isFile()).toBe(true);
  });

  test("throws error when destination already exists", async () => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    await mkdir(join(testDir, "Projects", "MyProject"), { recursive: true });
    await writeFile(join(testDir, "Projects", "MyProject", "notes.md"), "source content");

    // Pre-create the archive destination
    await mkdir(join(testDir, "07_Archive", currentMonth, "MyProject"), { recursive: true });

    await expectError(
      () => archiveFile(testDir, "Projects/MyProject"),
      FileBrowserError,
      "already exists"
    );

    // Verify original directory is unchanged
    const sourceFile = await stat(join(testDir, "Projects", "MyProject", "notes.md"));
    expect(sourceFile.isFile()).toBe(true);
  });

  test("handles empty directory", async () => {
    await mkdir(join(testDir, "Projects", "EmptyProject"), { recursive: true });

    const result = await archiveFile(testDir, "Projects/EmptyProject");

    const archivedDir = await stat(join(testDir, result.archivePath));
    expect(archivedDir.isDirectory()).toBe(true);
  });
});

// =============================================================================
// createDirectory Tests
// =============================================================================

describe("createDirectory", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
    await mkdir(join(testDir, "Projects"), { recursive: true });
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  test("creates directory at vault root", async () => {
    const result = await createDirectory(testDir, "", "new-folder");

    expect(result).toBe("new-folder");
    const dirStat = await stat(join(testDir, "new-folder"));
    expect(dirStat.isDirectory()).toBe(true);
  });

  test("creates directory in nested path", async () => {
    const result = await createDirectory(testDir, "Projects", "my-project");

    expect(result).toBe("Projects/my-project");
    const dirStat = await stat(join(testDir, "Projects", "my-project"));
    expect(dirStat.isDirectory()).toBe(true);
  });

  test("allows valid name patterns", async () => {
    const validNames = ["Test123", "my-new-folder", "my_new_folder"];

    for (const name of validNames) {
      const result = await createDirectory(testDir, "", name);
      expect(result).toBe(name);
      const dirStat = await stat(join(testDir, name));
      expect(dirStat.isDirectory()).toBe(true);
    }
  });

  test("rejects invalid name patterns", async () => {
    const invalidNames = ["my folder", "my@folder", "my/folder", "my.folder", ""];

    for (const name of invalidNames) {
      await expectError(
        () => createDirectory(testDir, "", name),
        InvalidDirectoryNameError
      );
    }
  });

  test("throws error if directory already exists", async () => {
    await mkdir(join(testDir, "existing-folder"));
    await expectError(
      () => createDirectory(testDir, "", "existing-folder"),
      DirectoryExistsError
    );
  });

  test("throws error if parent directory does not exist", async () => {
    await expectError(
      () => createDirectory(testDir, "non-existent", "new-folder"),
      DirectoryNotFoundError
    );
  });

  test("rejects path traversal in parent path", async () => {
    await expectError(() => createDirectory(testDir, "..", "new-folder"), PathTraversalError);
  });

  test("rejects symlink as parent directory", async () => {
    await mkdir(join(testDir, "real-dir"));
    await symlink(join(testDir, "real-dir"), join(testDir, "symlink-dir"));

    await expectError(
      () => createDirectory(testDir, "symlink-dir", "new-folder"),
      PathTraversalError
    );
  });

  test("rejects file as parent path", async () => {
    await writeFile(join(testDir, "file.txt"), "content");
    await expectError(
      () => createDirectory(testDir, "file.txt", "new-folder"),
      DirectoryNotFoundError
    );
  });
});

// =============================================================================
// createFile Tests
// =============================================================================

describe("createFile", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
    await mkdir(join(testDir, "Projects"), { recursive: true });
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  test("creates file at vault root", async () => {
    const result = await createFile(testDir, "", "new-note");

    expect(result).toBe("new-note.md");
    const fileStat = await stat(join(testDir, "new-note.md"));
    expect(fileStat.isFile()).toBe(true);

    const content = await readFile(join(testDir, "new-note.md"), "utf-8");
    expect(content).toBe("");
  });

  test("creates file in nested path", async () => {
    const result = await createFile(testDir, "Projects", "my-note");

    expect(result).toBe("Projects/my-note.md");
    const fileStat = await stat(join(testDir, "Projects", "my-note.md"));
    expect(fileStat.isFile()).toBe(true);
  });

  test("automatically adds .md extension", async () => {
    const result = await createFile(testDir, "", "test-file");
    expect(result).toBe("test-file.md");
  });

  test("allows valid name patterns", async () => {
    const validNames = ["Test123", "my-new-note", "my_new_note"];

    for (const name of validNames) {
      const result = await createFile(testDir, "", name);
      expect(result).toBe(`${name}.md`);
      const fileStat = await stat(join(testDir, `${name}.md`));
      expect(fileStat.isFile()).toBe(true);
    }
  });

  test("rejects invalid name patterns", async () => {
    const invalidNames = ["my note", "my@note", "my/note", "my.note", ""];

    for (const name of invalidNames) {
      await expectError(() => createFile(testDir, "", name), InvalidFileNameError);
    }
  });

  test("throws error if file already exists", async () => {
    await writeFile(join(testDir, "existing-note.md"), "content");
    await expectError(() => createFile(testDir, "", "existing-note"), FileExistsError);
  });

  test("throws error if parent directory does not exist", async () => {
    await expectError(
      () => createFile(testDir, "non-existent", "new-note"),
      DirectoryNotFoundError
    );
  });

  test("rejects path traversal in parent path", async () => {
    await expectError(() => createFile(testDir, "..", "new-note"), PathTraversalError);
  });

  test("rejects symlink as parent directory", async () => {
    await mkdir(join(testDir, "real-dir"));
    await symlink(join(testDir, "real-dir"), join(testDir, "symlink-dir"));

    await expectError(() => createFile(testDir, "symlink-dir", "new-note"), PathTraversalError);
  });

  test("handles deeply nested parent paths", async () => {
    await mkdir(join(testDir, "a", "b", "c"), { recursive: true });

    const result = await createFile(testDir, "a/b/c", "deep-note");

    expect(result).toBe("a/b/c/deep-note.md");
    const fileStat = await stat(join(testDir, "a", "b", "c", "deep-note.md"));
    expect(fileStat.isFile()).toBe(true);
  });
});

// =============================================================================
// renameFile Tests
// =============================================================================

describe("renameFile", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
    await mkdir(join(testDir, "Projects"), { recursive: true });
    await writeFile(join(testDir, "test-file.md"), "# Test Content");
    await writeFile(join(testDir, "Projects", "my-note.md"), "# My Note");
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  test("renames file at vault root", async () => {
    const result = await renameFile(testDir, "test-file.md", "renamed-file");

    expect(result.oldPath).toBe("test-file.md");
    expect(result.newPath).toBe("renamed-file.md");

    // Old file should not exist
    try {
      await stat(join(testDir, "test-file.md"));
      expect.unreachable("Old file should not exist");
    } catch {
      // Expected
    }

    // New file should exist with preserved content
    const fileStat = await stat(join(testDir, "renamed-file.md"));
    expect(fileStat.isFile()).toBe(true);
    const content = await readFile(join(testDir, "renamed-file.md"), "utf-8");
    expect(content).toBe("# Test Content");
  });

  test("renames file in nested path", async () => {
    const result = await renameFile(testDir, "Projects/my-note.md", "new-name");

    expect(result.oldPath).toBe("Projects/my-note.md");
    expect(result.newPath).toBe("Projects/new-name.md");

    const fileStat = await stat(join(testDir, "Projects", "new-name.md"));
    expect(fileStat.isFile()).toBe(true);
  });

  test("renames directory at vault root", async () => {
    const result = await renameFile(testDir, "Projects", "MyProjects");

    expect(result.oldPath).toBe("Projects");
    expect(result.newPath).toBe("MyProjects");

    const dirStat = await stat(join(testDir, "MyProjects"));
    expect(dirStat.isDirectory()).toBe(true);

    // Contents should be preserved
    const fileStat = await stat(join(testDir, "MyProjects", "my-note.md"));
    expect(fileStat.isFile()).toBe(true);
  });

  test("rejects invalid name patterns", async () => {
    const invalidNames = ["my file", "my@file", "my/file", ""];

    for (const name of invalidNames) {
      await expectError(() => renameFile(testDir, "test-file.md", name), InvalidFileNameError);
    }
  });

  test("throws error if source file does not exist", async () => {
    await expectError(
      () => renameFile(testDir, "non-existent.md", "new-name"),
      FileNotFoundError
    );
  });

  test("throws error if destination already exists", async () => {
    await writeFile(join(testDir, "existing.md"), "content");
    await expectError(() => renameFile(testDir, "test-file.md", "existing"), FileExistsError);
  });

  test("rejects path traversal in source path", async () => {
    await expectError(
      () => renameFile(testDir, "../test-file.md", "new-name"),
      PathTraversalError
    );
  });

  test("rejects symlink as source", async () => {
    await symlink(join(testDir, "test-file.md"), join(testDir, "symlink-file.md"));

    await expectError(
      () => renameFile(testDir, "symlink-file.md", "new-name"),
      PathTraversalError
    );
  });

  test("handles deeply nested paths", async () => {
    await mkdir(join(testDir, "a", "b", "c"), { recursive: true });
    await writeFile(join(testDir, "a", "b", "c", "deep-file.md"), "# Deep");

    const result = await renameFile(testDir, "a/b/c/deep-file.md", "renamed-deep");

    expect(result.newPath).toBe("a/b/c/renamed-deep.md");
    const fileStat = await stat(join(testDir, "a", "b", "c", "renamed-deep.md"));
    expect(fileStat.isFile()).toBe(true);
  });
});

// =============================================================================
// moveFile Tests
// =============================================================================

describe("moveFile", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTestDir();
    await mkdir(join(testDir, "Projects"), { recursive: true });
    await mkdir(join(testDir, "Archive"), { recursive: true });
    await writeFile(join(testDir, "root-file.md"), "# Root File");
    await writeFile(join(testDir, "Projects", "project-note.md"), "# Project Note");
  });

  afterEach(async () => {
    await cleanupTestDir(testDir);
  });

  test("moves file to a different directory", async () => {
    const result = await moveFile(testDir, "root-file.md", "Projects/root-file.md");

    expect(result.oldPath).toBe("root-file.md");
    expect(result.newPath).toBe("Projects/root-file.md");
    expect(result.isDirectory).toBe(false);

    // Old location should be empty
    try {
      await stat(join(testDir, "root-file.md"));
      expect.unreachable("Old file should not exist");
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
    }

    // New location should have the file with correct content
    const content = await readFile(join(testDir, "Projects", "root-file.md"), "utf-8");
    expect(content).toBe("# Root File");
  });

  test("moves file into existing directory (appends filename)", async () => {
    const result = await moveFile(testDir, "root-file.md", "Projects");

    expect(result.newPath).toBe("Projects/root-file.md");
    expect(result.isDirectory).toBe(false);

    const content = await readFile(join(testDir, "Projects", "root-file.md"), "utf-8");
    expect(content).toBe("# Root File");
  });

  test("moves file to vault root", async () => {
    const result = await moveFile(testDir, "Projects/project-note.md", "project-note.md");

    expect(result.newPath).toBe("project-note.md");
    expect(result.isDirectory).toBe(false);

    const content = await readFile(join(testDir, "project-note.md"), "utf-8");
    expect(content).toBe("# Project Note");
  });

  test("moves file to vault root using empty string", async () => {
    const result = await moveFile(testDir, "Projects/project-note.md", "");

    expect(result.newPath).toBe("project-note.md");
  });

  test("moves directory to another location", async () => {
    await mkdir(join(testDir, "Projects", "MyProject"), { recursive: true });
    await writeFile(join(testDir, "Projects", "MyProject", "readme.md"), "# Readme");

    const result = await moveFile(testDir, "Projects/MyProject", "Archive/MyProject");

    expect(result.isDirectory).toBe(true);

    const dirStat = await stat(join(testDir, "Archive", "MyProject"));
    expect(dirStat.isDirectory()).toBe(true);

    const content = await readFile(join(testDir, "Archive", "MyProject", "readme.md"), "utf-8");
    expect(content).toBe("# Readme");
  });

  test("moves directory into existing directory", async () => {
    await mkdir(join(testDir, "Projects", "MyProject"), { recursive: true });
    await writeFile(join(testDir, "Projects", "MyProject", "readme.md"), "# Readme");

    const result = await moveFile(testDir, "Projects/MyProject", "Archive");

    expect(result.newPath).toBe("Archive/MyProject");
    expect(result.isDirectory).toBe(true);

    const dirStat = await stat(join(testDir, "Archive", "MyProject"));
    expect(dirStat.isDirectory()).toBe(true);
  });

  test("throws FileNotFoundError for non-existent source", async () => {
    await expectError(() => moveFile(testDir, "does-not-exist.md", "Projects"), FileNotFoundError);
  });

  test("throws FileExistsError when destination file exists", async () => {
    await writeFile(join(testDir, "Projects", "duplicate.md"), "Existing");
    await writeFile(join(testDir, "duplicate.md"), "New");

    await expectError(
      () => moveFile(testDir, "duplicate.md", "Projects/duplicate.md"),
      FileExistsError,
      "already exists"
    );

    // Verify original was not moved
    const originalContent = await readFile(join(testDir, "duplicate.md"), "utf-8");
    expect(originalContent).toBe("New");
  });

  test("throws DirectoryNotFoundError when parent directory does not exist", async () => {
    await expectError(
      () => moveFile(testDir, "root-file.md", "NonExistent/file.md"),
      DirectoryNotFoundError,
      "does not exist"
    );
  });

  test("throws PathTraversalError for source path traversal", async () => {
    await expectError(() => moveFile(testDir, "../outside.md", "Projects"), PathTraversalError);
  });

  test("throws PathTraversalError for destination path traversal", async () => {
    await expectError(
      () => moveFile(testDir, "root-file.md", "../outside.md"),
      PathTraversalError
    );
  });

  test("throws PathTraversalError for symlink source", async () => {
    await writeFile(join(testDir, "real.md"), "Real content");

    await withSymlink(join(testDir, "real.md"), join(testDir, "symlink.md"), async () => {
      await expectError(
        () => moveFile(testDir, "symlink.md", "Projects/symlink.md"),
        PathTraversalError,
        "symbolic link"
      );

      // Verify original real file was NOT moved
      const content = await readFile(join(testDir, "real.md"), "utf-8");
      expect(content).toBe("Real content");
    });
  });

  test("throws PathTraversalError for symlink destination directory", async () => {
    await mkdir(join(testDir, "RealDir"));

    await withSymlink(join(testDir, "RealDir"), join(testDir, "SymlinkDir"), async () => {
      await expectError(
        () => moveFile(testDir, "root-file.md", "SymlinkDir"),
        PathTraversalError,
        "symbolic link"
      );
    });
  });

  test("throws error when moving directory into itself", async () => {
    await mkdir(join(testDir, "MyFolder", "SubFolder"), { recursive: true });

    await expectError(
      () => moveFile(testDir, "MyFolder", "MyFolder/SubFolder/MyFolder"),
      FileBrowserError,
      "into itself"
    );
  });

  test("preserves directory contents recursively", async () => {
    await mkdir(join(testDir, "Source", "A", "B", "C"), { recursive: true });
    await writeFile(join(testDir, "Source", "root.md"), "Root");
    await writeFile(join(testDir, "Source", "A", "a.md"), "A content");
    await writeFile(join(testDir, "Source", "A", "B", "b.md"), "B content");
    await writeFile(join(testDir, "Source", "A", "B", "C", "c.md"), "C content");

    const result = await moveFile(testDir, "Source", "Archive/Source");

    expect(result.isDirectory).toBe(true);

    expect(await readFile(join(testDir, "Archive", "Source", "root.md"), "utf-8")).toBe("Root");
    expect(await readFile(join(testDir, "Archive", "Source", "A", "a.md"), "utf-8")).toBe(
      "A content"
    );
    expect(await readFile(join(testDir, "Archive", "Source", "A", "B", "b.md"), "utf-8")).toBe(
      "B content"
    );
    expect(await readFile(join(testDir, "Archive", "Source", "A", "B", "C", "c.md"), "utf-8")).toBe(
      "C content"
    );
  });

  test("allows moving file within same directory with different name", async () => {
    const result = await moveFile(testDir, "root-file.md", "renamed-file.md");

    expect(result.oldPath).toBe("root-file.md");
    expect(result.newPath).toBe("renamed-file.md");
    expect(result.isDirectory).toBe(false);

    const content = await readFile(join(testDir, "renamed-file.md"), "utf-8");
    expect(content).toBe("# Root File");
  });
});
