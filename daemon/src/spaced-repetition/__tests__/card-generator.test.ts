/**
 * Card Generator Tests
 *
 * Tests for LLM-based Q&A card extraction.
 * Uses mock session factory to avoid real pi-agent calls.
 */

import { describe, test, expect } from "bun:test";
import {
  QACardGenerator,
  createQACardGenerator,
  buildQAExtractionPrompt,
  parseQAResponse,
  GENERATION_MODEL,
  MIN_CONTENT_LENGTH,
  MAX_CONTENT_LENGTH,
  type CreateSessionFn,
} from "../card-generator";
import type { AgentSession } from "@earendil-works/pi-coding-agent";

// =============================================================================
// Mock Session Helpers
// =============================================================================

/** Build a minimal AgentSession mock that returns a predetermined text response. */
function buildMockSession(response: string): AgentSession {
  return {
    messages: [
      { role: "assistant", content: [{ type: "text", text: response }] },
    ],
    prompt: async () => {},
    abort: () => {},
    subscribe: () => () => {},
    bindExtensions: async () => {},
    modelRegistry: { find: () => undefined },
    setModel: async () => {},
    sessionFile: undefined,
  } as unknown as AgentSession;
}

/**
 * Create a mock session factory that returns a predetermined text response.
 */
function createMockSessionFn(response: string): CreateSessionFn {
  return async () => ({ session: buildMockSession(response), jsonlPath: null });
}

/**
 * Create a mock session factory that throws an error.
 */
function createErrorSessionFn(error: Error): CreateSessionFn {
  return async () => {
    throw error;
  };
}

/**
 * Create a mock session factory that captures prompts for inspection.
 */
function createCapturingSessionFn(
  response: string,
  capturedPrompts: string[]
): CreateSessionFn {
  return async () => {
    const session = {
      messages: [
        { role: "assistant", content: [{ type: "text", text: response }] },
      ],
      prompt: async (p: string) => {
        capturedPrompts.push(p);
      },
      abort: () => {},
      subscribe: () => () => {},
      bindExtensions: async () => {},
      modelRegistry: { find: () => undefined },
      setModel: async () => {},
      sessionFile: undefined,
    } as unknown as AgentSession;
    return { session, jsonlPath: null };
  };
}

// =============================================================================
// parseQAResponse Tests
// =============================================================================

describe("parseQAResponse", () => {
  test("parses valid JSON array of Q&A pairs", () => {
    const response = `[
      {"question": "What is TypeScript?", "answer": "A typed superset of JavaScript"},
      {"question": "What is Bun?", "answer": "A fast JavaScript runtime"}
    ]`;

    const result = parseQAResponse(response);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      question: "What is TypeScript?",
      answer: "A typed superset of JavaScript",
    });
    expect(result[1]).toEqual({
      question: "What is Bun?",
      answer: "A fast JavaScript runtime",
    });
  });

  test("parses JSON wrapped in markdown code block", () => {
    const response = `\`\`\`json
[{"question": "Q1", "answer": "A1"}]
\`\`\``;

    const result = parseQAResponse(response);

    expect(result).toHaveLength(1);
    expect(result[0].question).toBe("Q1");
  });

  test("parses JSON wrapped in plain code block", () => {
    const response = `\`\`\`
[{"question": "Q1", "answer": "A1"}]
\`\`\``;

    const result = parseQAResponse(response);

    expect(result).toHaveLength(1);
  });

  test("wraps single object in array", () => {
    const response = `{"question": "Single Q", "answer": "Single A"}`;

    const result = parseQAResponse(response);

    expect(result).toHaveLength(1);
    expect(result[0].question).toBe("Single Q");
  });

  test("returns empty array for empty response", () => {
    expect(parseQAResponse("")).toEqual([]);
    expect(parseQAResponse("   ")).toEqual([]);
  });

  test("returns empty array for empty JSON array", () => {
    expect(parseQAResponse("[]")).toEqual([]);
  });

  test("returns empty array for invalid JSON", () => {
    expect(parseQAResponse("not json at all")).toEqual([]);
    expect(parseQAResponse("{ broken json")).toEqual([]);
  });

  test("returns empty array for non-array/non-object JSON", () => {
    expect(parseQAResponse(`"just a string"`)).toEqual([]);
    expect(parseQAResponse("123")).toEqual([]);
    expect(parseQAResponse("null")).toEqual([]);
  });

  test("filters out items with missing question", () => {
    const response = `[
      {"question": "Valid Q", "answer": "Valid A"},
      {"answer": "No question here"}
    ]`;

    const result = parseQAResponse(response);

    expect(result).toHaveLength(1);
    expect(result[0].question).toBe("Valid Q");
  });

  test("filters out items with missing answer", () => {
    const response = `[
      {"question": "Valid Q", "answer": "Valid A"},
      {"question": "No answer here"}
    ]`;

    const result = parseQAResponse(response);

    expect(result).toHaveLength(1);
  });

  test("filters out items with empty question", () => {
    const response = `[
      {"question": "", "answer": "A"},
      {"question": "   ", "answer": "A"},
      {"question": "Valid", "answer": "A"}
    ]`;

    const result = parseQAResponse(response);

    expect(result).toHaveLength(1);
    expect(result[0].question).toBe("Valid");
  });

  test("filters out items with empty answer", () => {
    const response = `[
      {"question": "Q", "answer": ""},
      {"question": "Q", "answer": "   "},
      {"question": "Q", "answer": "Valid"}
    ]`;

    const result = parseQAResponse(response);

    expect(result).toHaveLength(1);
    expect(result[0].answer).toBe("Valid");
  });

  test("trims whitespace from question and answer", () => {
    const response = `[{"question": "  Spaced Q  ", "answer": "  Spaced A  "}]`;

    const result = parseQAResponse(response);

    expect(result[0].question).toBe("Spaced Q");
    expect(result[0].answer).toBe("Spaced A");
  });

  test("filters out non-string question/answer", () => {
    const response = `[
      {"question": 123, "answer": "A"},
      {"question": "Q", "answer": true},
      {"question": "Valid Q", "answer": "Valid A"}
    ]`;

    const result = parseQAResponse(response);

    expect(result).toHaveLength(1);
    expect(result[0].question).toBe("Valid Q");
  });
});

// =============================================================================
// buildQAExtractionPrompt Tests
// =============================================================================

describe("buildQAExtractionPrompt", () => {
  test("includes content in prompt", () => {
    const content = "TypeScript is a typed superset of JavaScript.";
    const filePath = "notes/typescript.md";

    const prompt = buildQAExtractionPrompt(content, filePath);

    expect(prompt).toContain(content);
  });

  test("includes file path for context", () => {
    const content = "Some content";
    const filePath = "01_Projects/my-project/README.md";

    const prompt = buildQAExtractionPrompt(content, filePath);

    expect(prompt).toContain(filePath);
  });

  test("asks for JSON output", () => {
    const prompt = buildQAExtractionPrompt("content", "file.md");

    expect(prompt).toContain("JSON");
    expect(prompt).toContain("question");
    expect(prompt).toContain("answer");
  });

  test("mentions spaced repetition context", () => {
    const prompt = buildQAExtractionPrompt("content", "file.md");

    expect(prompt.toLowerCase()).toContain("spaced repetition");
  });

  test("instructs to return empty array when no facts", () => {
    const prompt = buildQAExtractionPrompt("content", "file.md");

    expect(prompt).toContain("[]");
  });

  test("requires questions to be self-contained", () => {
    const prompt = buildQAExtractionPrompt("content", "file.md");

    expect(prompt).toContain("self-contained");
    expect(prompt).toContain("without seeing the source");
  });
});

// =============================================================================
// GENERATION_MODEL constant
// =============================================================================

describe("GENERATION_MODEL", () => {
  test("is a non-empty string", () => {
    expect(typeof GENERATION_MODEL).toBe("string");
    expect(GENERATION_MODEL.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// QACardGenerator Tests
// =============================================================================

describe("QACardGenerator", () => {
  describe("type property", () => {
    test("has type 'qa'", () => {
      const generator = createQACardGenerator(createMockSessionFn("[]"));
      expect(generator.type).toBe("qa");
    });
  });

  describe("generate", () => {
    test("extracts Q&A pairs from content", async () => {
      const mockResponse = `[
        {"question": "What is TypeScript?", "answer": "A typed superset of JavaScript"}
      ]`;

      const generator = createQACardGenerator(createMockSessionFn(mockResponse));
      const content = "TypeScript is a typed superset of JavaScript. ".repeat(10);
      const result = await generator.generate(content, "notes/ts.md");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.cards).toHaveLength(1);
        expect(result.cards[0].question).toBe("What is TypeScript?");
        expect(result.cards[0].answer).toBe("A typed superset of JavaScript");
      }
    });

    test("returns multiple cards when LLM extracts multiple", async () => {
      const mockResponse = `[
        {"question": "Q1", "answer": "A1"},
        {"question": "Q2", "answer": "A2"},
        {"question": "Q3", "answer": "A3"}
      ]`;

      const generator = createQACardGenerator(createMockSessionFn(mockResponse));
      const content = "Lots of content here. ".repeat(50);
      const result = await generator.generate(content, "notes.md");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.cards).toHaveLength(3);
      }
    });

    test("returns skipped result for content below minimum length", async () => {
      // Session should not be called for short content
      let sessionCalled = false;
      const neverCalledFn: CreateSessionFn = async () => {
        sessionCalled = true;
        throw new Error("Should not be called");
      };

      const generator = createQACardGenerator(neverCalledFn);
      const shortContent = "Too short.";
      expect(shortContent.length).toBeLessThan(MIN_CONTENT_LENGTH);

      const result = await generator.generate(shortContent, "short.md");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.cards).toEqual([]);
        expect(result.skipped).toBe(true);
      }
      expect(sessionCalled).toBe(false);
    });

    test("truncates content exceeding maximum length", async () => {
      const capturedPrompts: string[] = [];
      const generator = createQACardGenerator(
        createCapturingSessionFn("[]", capturedPrompts)
      );
      // Create content larger than MAX_CONTENT_LENGTH
      const longContent = "x".repeat(MAX_CONTENT_LENGTH + 1000);

      await generator.generate(longContent, "long.md");

      expect(capturedPrompts).toHaveLength(1);
      const prompt = capturedPrompts[0];
      // Prompt should contain truncated content, not full content
      expect(prompt).toContain("[Content truncated...]");
      // The original long content should not appear in full
      expect(prompt).not.toContain(longContent);
    });

    test("includes file path in prompt", async () => {
      const capturedPrompts: string[] = [];
      const generator = createQACardGenerator(
        createCapturingSessionFn("[]", capturedPrompts)
      );
      const filePath = "01_Projects/spaced-rep/design.md";
      await generator.generate("Content here. ".repeat(20), filePath);

      expect(capturedPrompts[0]).toContain(filePath);
    });

    test("returns empty cards when LLM returns empty array", async () => {
      const generator = createQACardGenerator(createMockSessionFn("[]"));
      const result = await generator.generate("Some content. ".repeat(20), "empty.md");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.cards).toEqual([]);
      }
    });

    test("returns failure result on LLM error with retriable flag", async () => {
      const generator = createQACardGenerator(
        createErrorSessionFn(new Error("API rate limit exceeded"))
      );
      const result = await generator.generate("Content here. ".repeat(20), "error.md");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("rate limit");
        expect(result.retriable).toBe(true);
      }
    });

    test("returns success with empty cards on invalid LLM response", async () => {
      const generator = createQACardGenerator(
        createMockSessionFn("This is not JSON at all!")
      );
      const result = await generator.generate("Content here. ".repeat(20), "invalid.md");

      // Invalid JSON is a successful call that just didn't extract anything
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.cards).toEqual([]);
      }
    });

    test("handles markdown-wrapped JSON response", async () => {
      const mockResponse = `Here's the extracted Q&A:

\`\`\`json
[{"question": "Wrapped Q", "answer": "Wrapped A"}]
\`\`\`

That's all I found.`;

      const generator = createQACardGenerator(createMockSessionFn(mockResponse));
      const result = await generator.generate("Content here. ".repeat(20), "wrapped.md");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.cards).toHaveLength(1);
        expect(result.cards[0].question).toBe("Wrapped Q");
      }
    });
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe("createQACardGenerator", () => {
  test("creates QACardGenerator instance", () => {
    const generator = createQACardGenerator(createMockSessionFn("[]"));

    expect(generator).toBeInstanceOf(QACardGenerator);
    expect(generator.type).toBe("qa");
  });

  test("implements CardTypeGenerator interface", () => {
    const generator = createQACardGenerator(createMockSessionFn("[]"));

    expect(typeof generator.type).toBe("string");
    expect(typeof generator.generate).toBe("function");
  });
});

// =============================================================================
// Integration-Style Tests
// =============================================================================

describe("integration: realistic content extraction", () => {
  test("extracts facts from technical documentation", async () => {
    const mockResponse = `[
      {"question": "What does RAII stand for?", "answer": "Resource Acquisition Is Initialization"},
      {"question": "When are resources released in RAII?", "answer": "In destructors, automatically when objects go out of scope"}
    ]`;

    const content = `
# RAII in C++

RAII (Resource Acquisition Is Initialization) is a programming idiom
where resources are tied to object lifetime. Resources are acquired
in constructors and released in destructors. This ensures resources
are automatically cleaned up when objects go out of scope.
    `;

    const generator = createQACardGenerator(createMockSessionFn(mockResponse));
    const result = await generator.generate(content, "docs/cpp/raii.md");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.cards).toHaveLength(2);
      expect(result.cards[0].question).toContain("RAII");
    }
  });

  test("handles content with no extractable facts", async () => {
    const content = `
# TODO

- [ ] Think about something
- [ ] Maybe do a thing later
- [ ] Random musings with no facts
    `.repeat(5);

    const generator = createQACardGenerator(createMockSessionFn("[]"));
    const result = await generator.generate(content, "notes/todo.md");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.cards).toEqual([]);
    }
  });
});
