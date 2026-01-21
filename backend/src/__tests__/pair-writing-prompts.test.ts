/**
 * Tests for Pair Writing Prompt Templates
 *
 * Tests cover:
 * - Position hint calculation (beginning/middle/end thresholds)
 * - Prompt building for all 4 action types
 * - Context validation
 * - Action config retrieval
 * - Type guard for action types
 */

import { describe, it, expect } from "bun:test";
import {
  calculatePositionHint,
  formatPositionHint,
  buildQuickActionPrompt,
  validateQuickActionContext,
  getActionConfig,
  isQuickActionType,
  type QuickActionContext,
} from "../pair-writing-prompts.js";

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockContext(overrides: Partial<QuickActionContext> = {}): QuickActionContext {
  return {
    filePath: "docs/notes/meeting-notes.md",
    selectedText: "This is the text that needs revision.",
    contextBefore: "The previous paragraph provides context.",
    contextAfter: "The following paragraph continues the thought.",
    startLine: 15,
    endLine: 17,
    totalLines: 100,
    ...overrides,
  };
}

// =============================================================================
// calculatePositionHint Tests
// =============================================================================

describe("calculatePositionHint", () => {
  describe("beginning threshold (1-20%)", () => {
    it("should return 'beginning' for line 1 of 100", () => {
      expect(calculatePositionHint(1, 1, 100)).toBe("beginning");
    });

    it("should return 'beginning' for lines 1-5 of 100", () => {
      expect(calculatePositionHint(1, 5, 100)).toBe("beginning");
    });

    it("should return 'beginning' for line 20 of 100 (boundary)", () => {
      expect(calculatePositionHint(20, 20, 100)).toBe("beginning");
    });

    it("should return 'beginning' for lines 15-25 of 100 (midpoint = 20)", () => {
      expect(calculatePositionHint(15, 25, 100)).toBe("beginning");
    });
  });

  describe("middle threshold (20-80%)", () => {
    it("should return 'middle' for line 50 of 100", () => {
      expect(calculatePositionHint(50, 50, 100)).toBe("middle");
    });

    it("should return 'middle' for lines 30-40 of 100", () => {
      expect(calculatePositionHint(30, 40, 100)).toBe("middle");
    });

    it("should return 'middle' for line 21 of 100 (just past beginning)", () => {
      expect(calculatePositionHint(21, 21, 100)).toBe("middle");
    });

    it("should return 'middle' for line 79 of 100 (just before end)", () => {
      expect(calculatePositionHint(79, 79, 100)).toBe("middle");
    });
  });

  describe("end threshold (80-100%)", () => {
    it("should return 'end' for line 100 of 100", () => {
      expect(calculatePositionHint(100, 100, 100)).toBe("end");
    });

    it("should return 'end' for lines 90-100 of 100", () => {
      expect(calculatePositionHint(90, 100, 100)).toBe("end");
    });

    it("should return 'end' for line 80 of 100 (boundary)", () => {
      expect(calculatePositionHint(80, 80, 100)).toBe("end");
    });

    it("should return 'end' for lines 75-85 of 100 (midpoint = 80)", () => {
      expect(calculatePositionHint(75, 85, 100)).toBe("end");
    });
  });

  describe("edge cases", () => {
    it("should handle single-line documents", () => {
      expect(calculatePositionHint(1, 1, 1)).toBe("end");
    });

    it("should handle very short documents (5 lines)", () => {
      expect(calculatePositionHint(1, 1, 5)).toBe("beginning");
      expect(calculatePositionHint(3, 3, 5)).toBe("middle");
      expect(calculatePositionHint(5, 5, 5)).toBe("end");
    });

    it("should handle totalLines of 0 gracefully", () => {
      expect(calculatePositionHint(1, 1, 0)).toBe("middle");
    });

    it("should handle negative totalLines gracefully", () => {
      expect(calculatePositionHint(1, 1, -10)).toBe("middle");
    });

    it("should use selection midpoint for multi-line selections", () => {
      // Lines 10-30 of 100, midpoint = 20 (boundary of beginning)
      expect(calculatePositionHint(10, 30, 100)).toBe("beginning");
      // Lines 70-90 of 100, midpoint = 80 (boundary of end)
      expect(calculatePositionHint(70, 90, 100)).toBe("end");
    });
  });
});

// =============================================================================
// formatPositionHint Tests
// =============================================================================

describe("formatPositionHint", () => {
  it("should format 'beginning' correctly", () => {
    expect(formatPositionHint("beginning")).toBe("near the beginning of");
  });

  it("should format 'middle' correctly", () => {
    expect(formatPositionHint("middle")).toBe("in the middle of");
  });

  it("should format 'end' correctly", () => {
    expect(formatPositionHint("end")).toBe("near the end of");
  });
});

// =============================================================================
// buildQuickActionPrompt Tests
// =============================================================================

describe("buildQuickActionPrompt", () => {
  describe("common prompt structure", () => {
    it("should include efficiency guidance", () => {
      const prompt = buildQuickActionPrompt("tighten", createMockContext());
      expect(prompt).toContain("Be efficient");
      expect(prompt).toContain("read the file, make the edit, confirm briefly");
    });

    it("should include file path in task description", () => {
      const context = createMockContext({ filePath: "notes/important.md" });
      const prompt = buildQuickActionPrompt("tighten", context);
      expect(prompt).toContain('"notes/important.md"');
    });

    it("should include line numbers in task description", () => {
      const context = createMockContext({ startLine: 25, endLine: 30 });
      const prompt = buildQuickActionPrompt("tighten", context);
      expect(prompt).toContain("(lines 25-30)");
    });

    it("should include selected text", () => {
      const context = createMockContext({ selectedText: "Unique selection text here." });
      const prompt = buildQuickActionPrompt("tighten", context);
      expect(prompt).toContain("Unique selection text here.");
    });

    it("should include context before and after", () => {
      const context = createMockContext({
        contextBefore: "BEFORE_CONTEXT_TEXT",
        contextAfter: "AFTER_CONTEXT_TEXT",
      });
      const prompt = buildQuickActionPrompt("tighten", context);
      expect(prompt).toContain("BEFORE_CONTEXT_TEXT");
      expect(prompt).toContain("AFTER_CONTEXT_TEXT");
      expect(prompt).toContain("[SELECTION TO EDIT]");
    });

    it("should include workflow instructions", () => {
      const prompt = buildQuickActionPrompt("tighten", createMockContext());
      expect(prompt).toContain("1. Read the file to see current state");
      expect(prompt).toContain("2. Use Edit tool to replace the selection");
      expect(prompt).toContain("3. Confirm with one sentence");
    });

    it("should include brief response guidance", () => {
      const prompt = buildQuickActionPrompt("tighten", createMockContext());
      expect(prompt).toContain("Keep responses brief. No lengthy explanations.");
    });

    it("should include context tone matching note", () => {
      const prompt = buildQuickActionPrompt("tighten", createMockContext());
      expect(prompt).toContain("for tone matching - do not modify this");
    });
  });

  describe("position hint integration", () => {
    it("should include position hint for beginning", () => {
      const context = createMockContext({ startLine: 5, endLine: 10, totalLines: 100 });
      const prompt = buildQuickActionPrompt("tighten", context);
      expect(prompt).toContain("near the beginning of");
    });

    it("should include position hint for middle", () => {
      const context = createMockContext({ startLine: 45, endLine: 55, totalLines: 100 });
      const prompt = buildQuickActionPrompt("tighten", context);
      expect(prompt).toContain("in the middle of");
    });

    it("should include position hint for end", () => {
      const context = createMockContext({ startLine: 90, endLine: 100, totalLines: 100 });
      const prompt = buildQuickActionPrompt("tighten", context);
      expect(prompt).toContain("near the end of");
    });
  });

  describe("tighten action", () => {
    it("should include tighten-specific rules", () => {
      const prompt = buildQuickActionPrompt("tighten", createMockContext());
      expect(prompt).toContain('Rules for "Tighten"');
      expect(prompt).toContain("Preserve the core meaning");
      expect(prompt).toContain("Remove filler words, redundant phrases, unnecessary qualifiers");
      expect(prompt).toContain("Maintain the author's voice");
    });

    it("should include tighten task description", () => {
      const prompt = buildQuickActionPrompt("tighten", createMockContext());
      expect(prompt).toContain("Task: Tighten the selected text");
    });

    it("should reference tightened version in workflow", () => {
      const prompt = buildQuickActionPrompt("tighten", createMockContext());
      expect(prompt).toContain("with tightened version");
    });
  });

  describe("embellish action", () => {
    it("should include embellish-specific rules", () => {
      const prompt = buildQuickActionPrompt("embellish", createMockContext());
      expect(prompt).toContain('Rules for "Embellish"');
      expect(prompt).toContain("Add vivid details, examples, or explanatory content");
      expect(prompt).toContain("Enhance clarity and engagement");
      expect(prompt).toContain("Avoid purple prose");
    });

    it("should include embellish task description", () => {
      const prompt = buildQuickActionPrompt("embellish", createMockContext());
      expect(prompt).toContain("Task: Embellish the selected text");
    });

    it("should reference embellished version in workflow", () => {
      const prompt = buildQuickActionPrompt("embellish", createMockContext());
      expect(prompt).toContain("with embellished version");
    });
  });

  describe("correct action", () => {
    it("should include correct-specific rules", () => {
      const prompt = buildQuickActionPrompt("correct", createMockContext());
      expect(prompt).toContain('Rules for "Correct"');
      expect(prompt).toContain("Fix spelling, grammar, and punctuation errors");
      expect(prompt).toContain("Correct word usage and syntax issues");
      expect(prompt).toContain("Do not change the meaning, style, or voice");
      expect(prompt).toContain("Only fix clear errors");
    });

    it("should include correct task description", () => {
      const prompt = buildQuickActionPrompt("correct", createMockContext());
      expect(prompt).toContain("Task: Correct errors in the selected text");
    });

    it("should reference corrected version in workflow", () => {
      const prompt = buildQuickActionPrompt("correct", createMockContext());
      expect(prompt).toContain("with corrected version");
    });
  });

  describe("polish action", () => {
    it("should include polish-specific rules", () => {
      const prompt = buildQuickActionPrompt("polish", createMockContext());
      expect(prompt).toContain('Rules for "Polish"');
      expect(prompt).toContain("Improve sentence flow and readability");
      expect(prompt).toContain("Smooth awkward phrasing");
      expect(prompt).toContain("Enhance word choices");
      expect(prompt).toContain("Maintain the author's voice");
    });

    it("should include polish task description", () => {
      const prompt = buildQuickActionPrompt("polish", createMockContext());
      expect(prompt).toContain("Task: Polish the selected text");
    });

    it("should reference polished version in workflow", () => {
      const prompt = buildQuickActionPrompt("polish", createMockContext());
      expect(prompt).toContain("with polished version");
    });
  });
});

// =============================================================================
// validateQuickActionContext Tests
// =============================================================================

describe("validateQuickActionContext", () => {
  it("should return true for valid context", () => {
    expect(validateQuickActionContext(createMockContext())).toBe(true);
  });

  it("should throw for empty filePath", () => {
    const context = createMockContext({ filePath: "" });
    expect(() => validateQuickActionContext(context)).toThrow("filePath is required");
  });

  it("should throw for empty selectedText", () => {
    const context = createMockContext({ selectedText: "" });
    expect(() => validateQuickActionContext(context)).toThrow("selectedText is required");
  });

  it("should throw for startLine < 1", () => {
    const context = createMockContext({ startLine: 0 });
    expect(() => validateQuickActionContext(context)).toThrow("startLine must be >= 1");
  });

  it("should throw for negative startLine", () => {
    const context = createMockContext({ startLine: -5 });
    expect(() => validateQuickActionContext(context)).toThrow("startLine must be >= 1");
  });

  it("should throw for endLine < startLine", () => {
    const context = createMockContext({ startLine: 20, endLine: 15 });
    expect(() => validateQuickActionContext(context)).toThrow("endLine must be >= startLine");
  });

  it("should allow endLine == startLine (single line selection)", () => {
    const context = createMockContext({ startLine: 10, endLine: 10 });
    expect(validateQuickActionContext(context)).toBe(true);
  });

  it("should throw for totalLines < 1", () => {
    const context = createMockContext({ totalLines: 0 });
    expect(() => validateQuickActionContext(context)).toThrow("totalLines must be >= 1");
  });

  it("should throw for negative totalLines", () => {
    const context = createMockContext({ totalLines: -10 });
    expect(() => validateQuickActionContext(context)).toThrow("totalLines must be >= 1");
  });
});

// =============================================================================
// getActionConfig Tests
// =============================================================================

describe("getActionConfig", () => {
  it("should return config for tighten", () => {
    const config = getActionConfig("tighten");
    expect(config.name).toBe("Tighten");
    expect(config.taskDescription).toContain("Tighten");
    expect(config.rules.length).toBeGreaterThan(0);
  });

  it("should return config for embellish", () => {
    const config = getActionConfig("embellish");
    expect(config.name).toBe("Embellish");
    expect(config.taskDescription).toContain("Embellish");
    expect(config.rules.length).toBeGreaterThan(0);
  });

  it("should return config for correct", () => {
    const config = getActionConfig("correct");
    expect(config.name).toBe("Correct");
    expect(config.taskDescription).toContain("Correct");
    expect(config.rules.length).toBeGreaterThan(0);
  });

  it("should return config for polish", () => {
    const config = getActionConfig("polish");
    expect(config.name).toBe("Polish");
    expect(config.taskDescription).toContain("Polish");
    expect(config.rules.length).toBeGreaterThan(0);
  });

  it("should have unique rules for each action", () => {
    const tightenRules = getActionConfig("tighten").rules.join("");
    const embellishRules = getActionConfig("embellish").rules.join("");
    const correctRules = getActionConfig("correct").rules.join("");
    const polishRules = getActionConfig("polish").rules.join("");

    expect(tightenRules).not.toBe(embellishRules);
    expect(tightenRules).not.toBe(correctRules);
    expect(tightenRules).not.toBe(polishRules);
    expect(embellishRules).not.toBe(correctRules);
    expect(embellishRules).not.toBe(polishRules);
    expect(correctRules).not.toBe(polishRules);
  });
});

// =============================================================================
// isQuickActionType Tests
// =============================================================================

describe("isQuickActionType", () => {
  it("should return true for valid action types", () => {
    expect(isQuickActionType("tighten")).toBe(true);
    expect(isQuickActionType("embellish")).toBe(true);
    expect(isQuickActionType("correct")).toBe(true);
    expect(isQuickActionType("polish")).toBe(true);
  });

  it("should return false for invalid action types", () => {
    expect(isQuickActionType("invalid")).toBe(false);
    expect(isQuickActionType("TIGHTEN")).toBe(false);
    expect(isQuickActionType("Tighten")).toBe(false);
    expect(isQuickActionType("")).toBe(false);
    expect(isQuickActionType("rewrite")).toBe(false);
    expect(isQuickActionType("summarize")).toBe(false);
  });

  it("should work as type guard", () => {
    const action = "tighten" as string;
    if (isQuickActionType(action)) {
      // TypeScript should recognize action as QuickActionType here
      const config = getActionConfig(action);
      expect(config.name).toBe("Tighten");
    }
  });
});
