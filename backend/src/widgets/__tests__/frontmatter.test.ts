/**
 * Frontmatter Parsing Tests
 *
 * Unit tests for YAML frontmatter extraction and dot-notation field access.
 */

import { describe, test, expect } from "bun:test";
import {
  parseFrontmatter,
  extractField,
  extractFields,
  hasFrontmatter,
  FrontmatterParseError,
} from "../frontmatter";

// =============================================================================
// Test Fixtures
// =============================================================================

const simpleContent = `---
title: Test Note
rating: 8
status: owned
---
# Content

This is the note body.`;

const nestedContent = `---
title: Board Game
bgg:
  id: 12345
  play_count: 42
  rating: 8.5
  mechanics:
    - worker-placement
    - deck-building
  categories:
    - strategy
    - euro
hepcat:
  score: 0.75
  dimensions:
    complexity: 3
    interaction: 2
---
# Game Notes`;

const arrayContent = `---
tags:
  - strategy
  - euro
  - family
players:
  - 2
  - 3
  - 4
matrix:
  - [1, 2, 3]
  - [4, 5, 6]
---
Content here`;

const emptyFrontmatter = `---
---
# Empty frontmatter content`;

const noFrontmatter = `# Just Markdown

No frontmatter here.`;

const whitespaceBeforeFrontmatter = `
---
title: Whitespace Test
---
Content`;

// =============================================================================
// parseFrontmatter Tests
// =============================================================================

describe("parseFrontmatter", () => {
  test("parses simple key-value pairs", () => {
    const result = parseFrontmatter(simpleContent);
    expect(result.data.title).toBe("Test Note");
    expect(result.data.rating).toBe(8);
    expect(result.data.status).toBe("owned");
  });

  test("returns content after frontmatter", () => {
    const result = parseFrontmatter(simpleContent);
    expect(result.content).toContain("# Content");
    expect(result.content).toContain("This is the note body.");
  });

  test("parses nested objects", () => {
    const result = parseFrontmatter(nestedContent);
    const bgg = result.data.bgg as Record<string, unknown>;
    expect(bgg.id).toBe(12345);
    expect(bgg.play_count).toBe(42);
    expect(bgg.rating).toBe(8.5);
  });

  test("parses arrays", () => {
    const result = parseFrontmatter(arrayContent);
    expect(result.data.tags).toEqual(["strategy", "euro", "family"]);
    expect(result.data.players).toEqual([2, 3, 4]);
  });

  test("parses nested arrays", () => {
    const result = parseFrontmatter(arrayContent);
    expect(result.data.matrix).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  test("handles empty frontmatter", () => {
    const result = parseFrontmatter(emptyFrontmatter);
    expect(result.data).toEqual({});
    expect(result.content).toContain("# Empty frontmatter content");
  });

  test("handles content without frontmatter", () => {
    const result = parseFrontmatter(noFrontmatter);
    expect(result.data).toEqual({});
    expect(result.content).toContain("# Just Markdown");
  });

  test("handles whitespace before frontmatter", () => {
    // gray-matter does NOT trim leading whitespace, so frontmatter is not recognized
    const result = parseFrontmatter(whitespaceBeforeFrontmatter);
    // Leading whitespace means it's not recognized as frontmatter
    expect(result.data).toEqual({});
    // The entire content (including the --- delimiters) becomes body content
    expect(result.content).toContain("title: Whitespace Test");
  });

  test("throws FrontmatterParseError for invalid YAML", () => {
    const invalidYaml = `---
title: Test
  invalid: indentation error
---`;
    expect(() => parseFrontmatter(invalidYaml)).toThrow(FrontmatterParseError);
  });

  test("error message includes original YAML error details", () => {
    const invalidYaml = `---
[invalid: unclosed bracket
---`;
    try {
      parseFrontmatter(invalidYaml);
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(FrontmatterParseError);
      expect((error as FrontmatterParseError).message).toContain("Failed to parse frontmatter");
    }
  });

  test("FrontmatterParseError includes cause", () => {
    const invalidYaml = `---
{invalid}yaml
---`;
    try {
      parseFrontmatter(invalidYaml);
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(FrontmatterParseError);
      expect((error as FrontmatterParseError).cause).toBeDefined();
    }
  });

  test("handles various YAML data types", () => {
    const content = `---
string: hello
number: 42
float: 3.14
boolean_true: true
boolean_false: false
null_value: null
date: 2024-01-15
---`;
    const result = parseFrontmatter(content);
    expect(result.data.string).toBe("hello");
    expect(result.data.number).toBe(42);
    expect(result.data.float).toBe(3.14);
    expect(result.data.boolean_true).toBe(true);
    expect(result.data.boolean_false).toBe(false);
    expect(result.data.null_value).toBeNull();
    // YAML dates are parsed as Date objects by gray-matter
    expect(result.data.date).toBeInstanceOf(Date);
  });
});

// =============================================================================
// extractField Tests
// =============================================================================

describe("extractField", () => {
  describe("top-level fields", () => {
    test("extracts string field", () => {
      expect(extractField(simpleContent, "title")).toBe("Test Note");
    });

    test("extracts number field", () => {
      expect(extractField(simpleContent, "rating")).toBe(8);
    });

    test("returns null for missing field", () => {
      expect(extractField(simpleContent, "nonexistent")).toBeNull();
    });
  });

  describe("nested fields with dot-notation", () => {
    test("extracts deeply nested field", () => {
      expect(extractField(nestedContent, "bgg.play_count")).toBe(42);
    });

    test("extracts nested float", () => {
      expect(extractField(nestedContent, "bgg.rating")).toBe(8.5);
    });

    test("extracts nested nested field", () => {
      expect(extractField(nestedContent, "hepcat.dimensions.complexity")).toBe(3);
    });

    test("returns null when parent is missing", () => {
      expect(extractField(nestedContent, "missing.path")).toBeNull();
    });

    test("returns null when deep parent is missing", () => {
      expect(extractField(nestedContent, "missing.deep.nested.path")).toBeNull();
    });

    test("returns null when leaf is missing but parent exists", () => {
      expect(extractField(nestedContent, "bgg.missing_field")).toBeNull();
    });
  });

  describe("array index access", () => {
    test("extracts array element by index", () => {
      expect(extractField(arrayContent, "tags.0")).toBe("strategy");
      expect(extractField(arrayContent, "tags.1")).toBe("euro");
      expect(extractField(arrayContent, "tags.2")).toBe("family");
    });

    test("extracts number array element", () => {
      expect(extractField(arrayContent, "players.0")).toBe(2);
      expect(extractField(arrayContent, "players.1")).toBe(3);
    });

    test("returns null for out-of-bounds index", () => {
      expect(extractField(arrayContent, "tags.10")).toBeNull();
    });

    test("extracts nested array element", () => {
      expect(extractField(arrayContent, "matrix.0.0")).toBe(1);
      expect(extractField(arrayContent, "matrix.1.2")).toBe(6);
    });

    test("extracts array from nested object", () => {
      expect(extractField(nestedContent, "bgg.mechanics.0")).toBe("worker-placement");
      expect(extractField(nestedContent, "bgg.mechanics.1")).toBe("deck-building");
    });
  });

  describe("edge cases", () => {
    test("returns entire array when path points to array", () => {
      const result = extractField(arrayContent, "tags");
      expect(result).toEqual(["strategy", "euro", "family"]);
    });

    test("returns entire object when path points to object", () => {
      const result = extractField(nestedContent, "bgg") as Record<string, unknown>;
      expect(result.id).toBe(12345);
      expect(result.play_count).toBe(42);
    });

    test("handles empty string path", () => {
      // Empty path with lodash get returns undefined, which we normalize to null
      const result = extractField(simpleContent, "");
      expect(result).toBeNull();
    });

    test("handles content without frontmatter", () => {
      expect(extractField(noFrontmatter, "anything")).toBeNull();
    });

    test("handles empty frontmatter", () => {
      expect(extractField(emptyFrontmatter, "anything")).toBeNull();
    });

    test("throws for malformed YAML", () => {
      const invalid = `---
{malformed yaml
---`;
      expect(() => extractField(invalid, "field")).toThrow(FrontmatterParseError);
    });

    test("handles null value in frontmatter", () => {
      const content = `---
explicit_null: null
---`;
      // Explicit null is preserved (not converted to our missing-field null)
      expect(extractField(content, "explicit_null")).toBeNull();
    });

    test("handles boolean false value", () => {
      const content = `---
enabled: false
---`;
      expect(extractField(content, "enabled")).toBe(false);
    });

    test("handles zero value", () => {
      const content = `---
count: 0
---`;
      expect(extractField(content, "count")).toBe(0);
    });

    test("handles empty string value", () => {
      const content = `---
name: ""
---`;
      expect(extractField(content, "name")).toBe("");
    });
  });
});

// =============================================================================
// extractFields Tests
// =============================================================================

describe("extractFields", () => {
  test("extracts multiple fields in one call", () => {
    const fields = extractFields(simpleContent, ["title", "rating", "status"]);
    expect(fields.get("title")).toBe("Test Note");
    expect(fields.get("rating")).toBe(8);
    expect(fields.get("status")).toBe("owned");
  });

  test("includes null for missing fields", () => {
    const fields = extractFields(simpleContent, ["title", "missing", "rating"]);
    expect(fields.get("title")).toBe("Test Note");
    expect(fields.get("missing")).toBeNull();
    expect(fields.get("rating")).toBe(8);
  });

  test("handles nested paths", () => {
    const fields = extractFields(nestedContent, [
      "bgg.play_count",
      "bgg.rating",
      "hepcat.score",
    ]);
    expect(fields.get("bgg.play_count")).toBe(42);
    expect(fields.get("bgg.rating")).toBe(8.5);
    expect(fields.get("hepcat.score")).toBe(0.75);
  });

  test("handles array index paths", () => {
    const fields = extractFields(arrayContent, ["tags.0", "tags.1", "players.0"]);
    expect(fields.get("tags.0")).toBe("strategy");
    expect(fields.get("tags.1")).toBe("euro");
    expect(fields.get("players.0")).toBe(2);
  });

  test("returns empty map for empty paths array", () => {
    const fields = extractFields(simpleContent, []);
    expect(fields.size).toBe(0);
  });

  test("handles content without frontmatter", () => {
    const fields = extractFields(noFrontmatter, ["title", "rating"]);
    expect(fields.get("title")).toBeNull();
    expect(fields.get("rating")).toBeNull();
  });

  test("throws for malformed YAML", () => {
    const invalid = `---
{malformed
---`;
    expect(() => extractFields(invalid, ["field"])).toThrow(FrontmatterParseError);
  });

  test("preserves field path order in map", () => {
    const paths = ["c", "a", "b"];
    const content = `---
a: 1
b: 2
c: 3
---`;
    const fields = extractFields(content, paths);
    const keys = Array.from(fields.keys());
    expect(keys).toEqual(["c", "a", "b"]);
  });

  test("handles duplicate paths", () => {
    const fields = extractFields(simpleContent, ["title", "title", "title"]);
    // Map only keeps one entry per key
    expect(fields.size).toBe(1);
    expect(fields.get("title")).toBe("Test Note");
  });
});

// =============================================================================
// hasFrontmatter Tests
// =============================================================================

describe("hasFrontmatter", () => {
  test("returns true for content with frontmatter", () => {
    expect(hasFrontmatter(simpleContent)).toBe(true);
  });

  test("returns false for content without frontmatter", () => {
    expect(hasFrontmatter(noFrontmatter)).toBe(false);
  });

  test("returns true for empty frontmatter", () => {
    expect(hasFrontmatter(emptyFrontmatter)).toBe(true);
  });

  test("returns false for content starting with similar pattern", () => {
    const notFrontmatter = "-- This is not frontmatter";
    expect(hasFrontmatter(notFrontmatter)).toBe(false);
  });

  test("returns true when whitespace precedes frontmatter", () => {
    expect(hasFrontmatter(whitespaceBeforeFrontmatter)).toBe(true);
  });

  test("returns false for empty content", () => {
    expect(hasFrontmatter("")).toBe(false);
  });

  test("returns false for only whitespace", () => {
    expect(hasFrontmatter("   \n\t  ")).toBe(false);
  });

  test("handles content with dashes in body", () => {
    const content = `Some content
---
This is not frontmatter, it's a horizontal rule
---`;
    expect(hasFrontmatter(content)).toBe(false);
  });
});

// =============================================================================
// Real-World Scenarios
// =============================================================================

describe("Real-World Scenarios", () => {
  test("board game frontmatter extraction", () => {
    const gameContent = `---
title: Wingspan
bgg:
  id: 266192
  play_count: 23
  rating: 8.4
  weight: 2.4
  mechanics:
    - card-drafting
    - engine-building
    - hand-management
  categories:
    - animals
    - card-game
hepcat:
  complexity: 0.48
  interaction: 0.32
  strategy: 0.75
  luck: 0.35
status: owned
plays_last_30_days: 3
---
# Wingspan

A competitive bird-collection engine-building game.`;

    // Extract widget-relevant fields
    expect(extractField(gameContent, "bgg.play_count")).toBe(23);
    expect(extractField(gameContent, "bgg.rating")).toBe(8.4);
    expect(extractField(gameContent, "bgg.mechanics")).toEqual([
      "card-drafting",
      "engine-building",
      "hand-management",
    ]);
    expect(extractField(gameContent, "hepcat.complexity")).toBe(0.48);
    expect(extractField(gameContent, "status")).toBe("owned");

    // For similarity widgets
    expect(extractField(gameContent, "bgg.mechanics.0")).toBe("card-drafting");
    expect(extractField(gameContent, "bgg.categories.0")).toBe("animals");
  });

  test("recipe frontmatter extraction", () => {
    const recipeContent = `---
title: Sourdough Bread
servings: 2
prep_time_minutes: 30
cook_time_minutes: 45
difficulty: intermediate
ratings:
  taste: 9
  ease: 6
  time_efficiency: 5
tags:
  - bread
  - fermented
  - baking
ingredients:
  - flour: 500g
  - water: 350ml
  - salt: 10g
---
# Recipe

Mix ingredients...`;

    expect(extractField(recipeContent, "prep_time_minutes")).toBe(30);
    expect(extractField(recipeContent, "ratings.taste")).toBe(9);
    expect(extractField(recipeContent, "tags")).toEqual(["bread", "fermented", "baking"]);
  });

  test("bulk field extraction for aggregation widget", () => {
    const gameContent = `---
bgg:
  play_count: 15
  rating: 7.8
  weight: 3.2
status: owned
last_played: 2024-01-10
---`;

    // Widget needs multiple fields for aggregation
    const fields = extractFields(gameContent, [
      "bgg.play_count",
      "bgg.rating",
      "bgg.weight",
      "status",
    ]);

    expect(fields.get("bgg.play_count")).toBe(15);
    expect(fields.get("bgg.rating")).toBe(7.8);
    expect(fields.get("bgg.weight")).toBe(3.2);
    expect(fields.get("status")).toBe("owned");
  });

  test("handles files with missing optional fields", () => {
    // Some games might not have all fields filled in
    const partialContent = `---
title: Incomplete Game
bgg:
  id: 999
  # rating not yet added
  # play_count not tracked
status: wishlist
---`;

    expect(extractField(partialContent, "bgg.id")).toBe(999);
    expect(extractField(partialContent, "bgg.rating")).toBeNull();
    expect(extractField(partialContent, "bgg.play_count")).toBeNull();
    expect(extractField(partialContent, "status")).toBe("wishlist");
  });
});
