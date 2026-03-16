/**
 * Fuzzy Matcher Tests
 *
 * Unit tests for the fuzzy subsequence matching algorithm.
 * Tests cover the scoring algorithm, edge cases, and acceptance criteria
 * from the specification.
 */

import { describe, test, expect } from "bun:test";
import { fuzzySearchFiles, escapeRegex, type FuzzyMatchFile } from "../search/fuzzy-matcher";

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a FuzzyMatchFile from a file name.
 * Automatically generates a path under "notes/".
 */
function file(name: string, pathPrefix = "notes"): FuzzyMatchFile {
  return {
    name,
    path: `${pathPrefix}/${name}`,
  };
}

/**
 * Gets the names of results in order.
 */
function resultNames(results: ReturnType<typeof fuzzySearchFiles>): string[] {
  return results.map((r) => r.name);
}

// =============================================================================
// Core Matching Tests
// =============================================================================

describe("fuzzySearchFiles", () => {
  describe("basic subsequence matching", () => {
    test("finds exact matches", () => {
      const files = [file("test.md"), file("other.md")];
      const results = fuzzySearchFiles("test", files);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("test.md");
    });

    test("finds prefix matches", () => {
      const files = [file("testing.md"), file("other.md")];
      const results = fuzzySearchFiles("test", files);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("testing.md");
    });

    test("finds subsequence matches", () => {
      const files = [file("mytest.md"), file("other.md")];
      const results = fuzzySearchFiles("myt", files);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("mytest.md");
    });

    test("is case insensitive", () => {
      const files = [file("MyTest.md"), file("other.md")];
      const results = fuzzySearchFiles("mytest", files);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("MyTest.md");
    });

    test("matches scattered characters", () => {
      const files = [file("f_o_o.md")];
      const results = fuzzySearchFiles("foo", files);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("f_o_o.md");
    });

    test("returns empty for no matches", () => {
      const files = [file("test.md"), file("other.md")];
      const results = fuzzySearchFiles("xyz", files);

      expect(results).toHaveLength(0);
    });
  });

  describe("match positions", () => {
    test("returns correct positions for consecutive match", () => {
      const files = [file("foobar.md")];
      const results = fuzzySearchFiles("foo", files);

      expect(results[0].matchPositions).toEqual([0, 1, 2]);
    });

    test("returns correct positions for scattered match", () => {
      const files = [file("f_o_o.md")];
      const results = fuzzySearchFiles("foo", files);

      expect(results[0].matchPositions).toEqual([0, 2, 4]);
    });

    test("returns correct positions for mid-string match", () => {
      const files = [file("prefixtest.md")];
      const results = fuzzySearchFiles("test", files);

      expect(results[0].matchPositions).toEqual([6, 7, 8, 9]);
    });
  });
});

// =============================================================================
// Scoring Tests
// =============================================================================

describe("scoring algorithm", () => {
  describe("consecutive preference (REQ-F-7)", () => {
    test("ranks consecutive matches above scattered matches", () => {
      // Acceptance test: "foo" ranks "foobar.md" above "f_o_o.md"
      const files = [file("f_o_o.md"), file("foobar.md")];
      const results = fuzzySearchFiles("foo", files);

      expect(resultNames(results)).toEqual(["foobar.md", "f_o_o.md"]);
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    test("consecutive bonus increases score significantly", () => {
      const files = [file("abc.md"), file("a_b_c.md")];
      const results = fuzzySearchFiles("abc", files);

      // "abc.md": base 3 + word boundary (a) +2 + consecutive (b) +3 + consecutive (c) +3 = 11
      // "a_b_c.md": base 3 + word boundary (a) +2 + word boundary (b) +2 + word boundary (c) +2 = 9
      // Net difference: consecutive bonus (+6) beats word boundary bonus (+4) by 2
      expect(results[0].name).toBe("abc.md");
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });
  });

  describe("start position (REQ-F-7)", () => {
    test("ranks earlier matches higher than later matches", () => {
      const files = [file("prefixfoo.md"), file("foo.md")];
      const results = fuzzySearchFiles("foo", files);

      expect(resultNames(results)).toEqual(["foo.md", "prefixfoo.md"]);
    });

    test("start position penalty scales with distance", () => {
      const files = [file("xfoo.md"), file("xxfoo.md"), file("xxxfoo.md")];
      const results = fuzzySearchFiles("foo", files);

      // Should be ordered by start position
      expect(resultNames(results)).toEqual(["xfoo.md", "xxfoo.md", "xxxfoo.md"]);
    });
  });

  describe("word boundary (REQ-F-7)", () => {
    test("ranks word boundary matches higher", () => {
      // Acceptance test: "PT" finds "Performance Testing.md" (P-erformance T-esting)
      const files = [
        file("Performance Testing.md"),
        file("aPpThing.md"), // scattered P and T
      ];
      const results = fuzzySearchFiles("PT", files);

      expect(results[0].name).toBe("Performance Testing.md");
    });

    test("recognizes underscore as word boundary", () => {
      const files = [file("some_test.md"), file("sometest.md")];
      const results = fuzzySearchFiles("st", files);

      // "some_test.md" has T at word boundary (after _)
      expect(results[0].name).toBe("some_test.md");
    });

    test("recognizes hyphen as word boundary", () => {
      const files = [file("some-test.md"), file("sometest.md")];
      const results = fuzzySearchFiles("st", files);

      // "some-test.md" has T at word boundary (after -)
      expect(results[0].name).toBe("some-test.md");
    });

    test("recognizes space as word boundary", () => {
      const files = [file("some test.md"), file("sometest.md")];
      const results = fuzzySearchFiles("st", files);

      // "some test.md" has T at word boundary (after space)
      expect(results[0].name).toBe("some test.md");
    });

    test("recognizes dot as word boundary", () => {
      const files = [file("some.test.md"), file("sometest.md")];
      const results = fuzzySearchFiles("st", files);

      // "some.test.md" has T at word boundary (after .)
      expect(results[0].name).toBe("some.test.md");
    });

    test("first character counts as word boundary", () => {
      const files = [file("test.md"), file("atest.md")];
      const results = fuzzySearchFiles("t", files);

      // "test.md" starts with T (word boundary)
      expect(results[0].name).toBe("test.md");
    });
  });

  describe("combined scoring", () => {
    test("consecutive + boundary beats scattered", () => {
      const files = [
        file("Performance_Testing.md"), // PT at boundaries, consecutive in "Pe" and "Te"
        file("xPxTx.md"), // scattered P and T
      ];
      const results = fuzzySearchFiles("PT", files);

      expect(results[0].name).toBe("Performance_Testing.md");
    });

    test("fuzzy matching acceptance test: perftst finds Performance EOS SDK Testing", () => {
      const files = [
        file("Performance EOS SDK Testing.md"),
        file("random.md"),
        file("performance.md"),
      ];
      const results = fuzzySearchFiles("perftst", files);

      // Should find "Performance EOS SDK Testing.md" as it contains all letters
      expect(results.some((r) => r.name === "Performance EOS SDK Testing.md")).toBe(true);
    });
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("edge cases", () => {
  describe("empty query (REQ-F-26)", () => {
    test("returns empty array for empty string", () => {
      const files = [file("test.md")];
      const results = fuzzySearchFiles("", files);

      expect(results).toEqual([]);
    });

    test("returns empty array for whitespace-only query", () => {
      const files = [file("test.md")];
      const results = fuzzySearchFiles("   ", files);

      expect(results).toEqual([]);
    });

    test("returns empty array for tab-only query", () => {
      const files = [file("test.md")];
      const results = fuzzySearchFiles("\t\t", files);

      expect(results).toEqual([]);
    });
  });

  describe("special characters in query", () => {
    test("handles regex metacharacters safely", () => {
      // These characters would break regex if not handled
      const files = [file("test[1].md"), file("test.md")];
      const results = fuzzySearchFiles("[1]", files);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("test[1].md");
    });

    test("handles parentheses in query", () => {
      const files = [file("test(2024).md"), file("test.md")];
      const results = fuzzySearchFiles("(2024)", files);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("test(2024).md");
    });

    test("handles asterisk in query", () => {
      const files = [file("test*.md"), file("test.md")];
      const results = fuzzySearchFiles("*", files);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("test*.md");
    });

    test("handles dot in query", () => {
      // Only "test.notes.md" matches since it contains the literal "."
      // "testnotes.md" doesn't match because the query requires a "." character
      const files = [file("test.notes.md"), file("testnotes.md")];
      const results = fuzzySearchFiles("test.notes", files);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("test.notes.md");
    });

    test("handles plus in query", () => {
      const files = [file("C++.md"), file("test.md")];
      const results = fuzzySearchFiles("C++", files);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("C++.md");
    });

    test("handles question mark in query", () => {
      const files = [file("what?.md"), file("test.md")];
      const results = fuzzySearchFiles("?", files);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("what?.md");
    });

    test("handles backslash in query", () => {
      const files = [file("path\\file.md"), file("test.md")];
      const results = fuzzySearchFiles("\\", files);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("path\\file.md");
    });

    test("handles caret in query", () => {
      const files = [file("x^2.md"), file("test.md")];
      const results = fuzzySearchFiles("^2", files);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("x^2.md");
    });

    test("handles dollar sign in query", () => {
      const files = [file("$100.md"), file("test.md")];
      const results = fuzzySearchFiles("$100", files);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("$100.md");
    });

    test("handles pipe in query", () => {
      const files = [file("a|b.md"), file("test.md")];
      const results = fuzzySearchFiles("|", files);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("a|b.md");
    });
  });

  describe("unicode handling", () => {
    test("handles unicode characters in file names", () => {
      const files = [file("日本語.md"), file("test.md")];
      const results = fuzzySearchFiles("日", files);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("日本語.md");
    });

    test("handles emoji in file names", () => {
      const files = [file("notes 📝.md"), file("test.md")];
      const results = fuzzySearchFiles("📝", files);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("notes 📝.md");
    });

    test("handles accented characters", () => {
      const files = [file("café.md"), file("test.md")];
      const results = fuzzySearchFiles("café", files);

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("café.md");
    });
  });

  describe("empty file list", () => {
    test("returns empty array for empty file list", () => {
      const results = fuzzySearchFiles("test", []);

      expect(results).toEqual([]);
    });
  });

  describe("single character queries", () => {
    test("handles single character query", () => {
      const files = [file("a.md"), file("b.md"), file("abc.md")];
      const results = fuzzySearchFiles("a", files);

      expect(results).toHaveLength(2);
      expect(resultNames(results)).toContain("a.md");
      expect(resultNames(results)).toContain("abc.md");
    });
  });

  describe("long queries", () => {
    test("handles very long query", () => {
      const longName = "a".repeat(100) + ".md";
      const files = [file(longName)];
      const results = fuzzySearchFiles("a".repeat(50), files);

      expect(results).toHaveLength(1);
    });
  });
});

// =============================================================================
// Result Limiting
// =============================================================================

describe("result limiting", () => {
  test("respects default limit of 50", () => {
    const files = Array.from({ length: 100 }, (_, i) => file(`test${i}.md`));
    const results = fuzzySearchFiles("test", files);

    expect(results).toHaveLength(50);
  });

  test("respects custom limit", () => {
    const files = Array.from({ length: 100 }, (_, i) => file(`test${i}.md`));
    const results = fuzzySearchFiles("test", files, { limit: 10 });

    expect(results).toHaveLength(10);
  });

  test("returns all results when fewer than limit", () => {
    const files = [file("test1.md"), file("test2.md"), file("test3.md")];
    const results = fuzzySearchFiles("test", files, { limit: 10 });

    expect(results).toHaveLength(3);
  });

  test("returns best matches within limit", () => {
    // Create files where "test" is a better match than "xtest"
    const files = [
      ...Array.from({ length: 5 }, (_, i) => file(`test${i}.md`)),
      ...Array.from({ length: 5 }, (_, i) => file(`xtest${i}.md`)),
    ];
    const results = fuzzySearchFiles("test", files, { limit: 5 });

    // All 5 results should be "test*" files (higher score due to start position)
    for (const result of results) {
      expect(result.name).toMatch(/^test\d\.md$/);
    }
  });
});

// =============================================================================
// Result Structure
// =============================================================================

describe("result structure", () => {
  test("includes correct path", () => {
    const files = [{ name: "test.md", path: "deep/nested/path/test.md" }];
    const results = fuzzySearchFiles("test", files);

    expect(results[0].path).toBe("deep/nested/path/test.md");
  });

  test("includes correct name", () => {
    const files = [{ name: "test.md", path: "notes/test.md" }];
    const results = fuzzySearchFiles("test", files);

    expect(results[0].name).toBe("test.md");
  });

  test("includes numeric score", () => {
    const files = [file("test.md")];
    const results = fuzzySearchFiles("test", files);

    expect(typeof results[0].score).toBe("number");
    expect(results[0].score).toBeGreaterThan(0);
  });

  test("includes matchPositions array", () => {
    const files = [file("test.md")];
    const results = fuzzySearchFiles("test", files);

    expect(Array.isArray(results[0].matchPositions)).toBe(true);
    expect(results[0].matchPositions).toHaveLength(4); // "test" = 4 chars
  });
});

// =============================================================================
// escapeRegex Utility
// =============================================================================

describe("escapeRegex", () => {
  test("escapes special regex characters", () => {
    expect(escapeRegex(".*+?^${}()|[]\\")).toBe("\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");
  });

  test("leaves normal characters unchanged", () => {
    expect(escapeRegex("abc123")).toBe("abc123");
  });

  test("handles empty string", () => {
    expect(escapeRegex("")).toBe("");
  });

  test("handles mixed content", () => {
    expect(escapeRegex("test[1].md")).toBe("test\\[1\\]\\.md");
  });
});
