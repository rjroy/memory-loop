/**
 * Card Generator Tests
 *
 * Tests for LLM-based Q&A card extraction.
 * Uses mock SDK to avoid real API calls.
 */

import { describe, test, expect, afterEach } from "bun:test";
import {
  QACardGenerator,
  createQACardGenerator,
  buildQAExtractionPrompt,
  parseQAResponse,
  GENERATION_MODEL,
  MIN_CONTENT_LENGTH,
  MAX_CONTENT_LENGTH,
} from "../card-generator.js";
import {
  configureSdkForTesting,
  _resetForTesting,
  type QueryFunction,
} from "../../sdk-provider.js";

// =============================================================================
// Mock SDK Helpers
// =============================================================================

/**
 * Create a mock SDK query function that returns a predetermined response.
 *
 * @param response - The text response to return
 * @returns Mock query function
 */
function createMockSdk(response: string): QueryFunction {
  return (() => {
    // Create an async generator that yields an assistant event
    // eslint-disable-next-line @typescript-eslint/require-await
    async function* mockGenerator() {
      yield {
        type: "assistant",
        message: {
          content: [{ type: "text", text: response }],
        },
      };
    }
    return mockGenerator();
  }) as unknown as QueryFunction;
}

/**
 * Create a mock SDK that throws an error.
 *
 * @param error - The error to throw
 * @returns Mock query function that throws
 */
function createErrorMockSdk(error: Error): QueryFunction {
  return (() => {
    // Generator that throws immediately - no yield needed since error is thrown first
    // eslint-disable-next-line require-yield, @typescript-eslint/require-await
    async function* mockGenerator(): AsyncGenerator<{ type: string }> {
      throw error;
    }
    return mockGenerator();
  }) as unknown as QueryFunction;
}

/**
 * Create a mock SDK that captures the prompt for inspection.
 *
 * @param response - The text response to return
 * @param capturedCalls - Array to push captured call info to
 * @returns Mock query function
 */
function createCapturingMockSdk(
  response: string,
  capturedCalls: Array<{ prompt: string; options: unknown }>
): QueryFunction {
  return ((args: { prompt: string; options: unknown }) => {
    capturedCalls.push({ prompt: args.prompt, options: args.options });

    // eslint-disable-next-line @typescript-eslint/require-await
    async function* mockGenerator() {
      yield {
        type: "assistant",
        message: {
          content: [{ type: "text", text: response }],
        },
      };
    }
    return mockGenerator();
  }) as unknown as QueryFunction;
}

// =============================================================================
// Test Setup
// =============================================================================

afterEach(() => {
  _resetForTesting();
});

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
});

// =============================================================================
// QACardGenerator Tests
// =============================================================================

describe("QACardGenerator", () => {
  describe("type property", () => {
    test("has type 'qa'", () => {
      const generator = createQACardGenerator();
      expect(generator.type).toBe("qa");
    });
  });

  describe("generate", () => {
    test("extracts Q&A pairs from content", async () => {
      const mockResponse = `[
        {"question": "What is TypeScript?", "answer": "A typed superset of JavaScript"}
      ]`;
      configureSdkForTesting(createMockSdk(mockResponse));

      const generator = createQACardGenerator();
      const content = "TypeScript is a typed superset of JavaScript. ".repeat(10);
      const cards = await generator.generate(content, "notes/ts.md");

      expect(cards).toHaveLength(1);
      expect(cards[0].question).toBe("What is TypeScript?");
      expect(cards[0].answer).toBe("A typed superset of JavaScript");
    });

    test("returns multiple cards when LLM extracts multiple", async () => {
      const mockResponse = `[
        {"question": "Q1", "answer": "A1"},
        {"question": "Q2", "answer": "A2"},
        {"question": "Q3", "answer": "A3"}
      ]`;
      configureSdkForTesting(createMockSdk(mockResponse));

      const generator = createQACardGenerator();
      const content = "Lots of content here. ".repeat(50);
      const cards = await generator.generate(content, "notes.md");

      expect(cards).toHaveLength(3);
    });

    test("returns empty array for content below minimum length", async () => {
      // Should not call SDK at all for short content
      let sdkCalled = false;
      const mockSdk = (() => {
        sdkCalled = true;
        // eslint-disable-next-line @typescript-eslint/require-await
        return (async function* () {
          yield { type: "never" };
        })();
      }) as unknown as QueryFunction;
      configureSdkForTesting(mockSdk);

      const generator = createQACardGenerator();
      const shortContent = "Too short.";
      expect(shortContent.length).toBeLessThan(MIN_CONTENT_LENGTH);

      const cards = await generator.generate(shortContent, "short.md");

      expect(cards).toEqual([]);
      expect(sdkCalled).toBe(false);
    });

    test("truncates content exceeding maximum length", async () => {
      const capturedCalls: Array<{ prompt: string; options: unknown }> = [];
      configureSdkForTesting(createCapturingMockSdk("[]", capturedCalls));

      const generator = createQACardGenerator();
      // Create content larger than MAX_CONTENT_LENGTH
      const longContent = "x".repeat(MAX_CONTENT_LENGTH + 1000);

      await generator.generate(longContent, "long.md");

      expect(capturedCalls).toHaveLength(1);
      const prompt = capturedCalls[0].prompt;
      // Prompt should contain truncated content, not full content
      expect(prompt).toContain("[Content truncated...]");
      // The original long content should not appear in full
      expect(prompt.length).toBeLessThan(longContent.length + 500);
    });

    test("uses correct model", async () => {
      const capturedCalls: Array<{ prompt: string; options: unknown }> = [];
      configureSdkForTesting(createCapturingMockSdk("[]", capturedCalls));

      const generator = createQACardGenerator();
      await generator.generate("Content here. ".repeat(20), "file.md");

      expect(capturedCalls).toHaveLength(1);
      const options = capturedCalls[0].options as { model: string };
      expect(options.model).toBe(GENERATION_MODEL);
    });

    test("uses maxTurns=1 and no tools", async () => {
      const capturedCalls: Array<{ prompt: string; options: unknown }> = [];
      configureSdkForTesting(createCapturingMockSdk("[]", capturedCalls));

      const generator = createQACardGenerator();
      await generator.generate("Content here. ".repeat(20), "file.md");

      expect(capturedCalls).toHaveLength(1);
      const options = capturedCalls[0].options as { maxTurns: number; allowedTools: unknown[] };
      expect(options.maxTurns).toBe(1);
      expect(options.allowedTools).toEqual([]);
    });

    test("returns empty array when LLM returns empty array", async () => {
      configureSdkForTesting(createMockSdk("[]"));

      const generator = createQACardGenerator();
      const cards = await generator.generate("Some content. ".repeat(20), "empty.md");

      expect(cards).toEqual([]);
    });

    test("returns empty array on LLM error (graceful degradation)", async () => {
      configureSdkForTesting(createErrorMockSdk(new Error("API rate limit exceeded")));

      const generator = createQACardGenerator();
      const cards = await generator.generate("Content here. ".repeat(20), "error.md");

      expect(cards).toEqual([]);
    });

    test("returns empty array on invalid LLM response", async () => {
      configureSdkForTesting(createMockSdk("This is not JSON at all!"));

      const generator = createQACardGenerator();
      const cards = await generator.generate("Content here. ".repeat(20), "invalid.md");

      expect(cards).toEqual([]);
    });

    test("handles markdown-wrapped JSON response", async () => {
      const mockResponse = `Here's the extracted Q&A:

\`\`\`json
[{"question": "Wrapped Q", "answer": "Wrapped A"}]
\`\`\`

That's all I found.`;
      configureSdkForTesting(createMockSdk(mockResponse));

      const generator = createQACardGenerator();
      const cards = await generator.generate("Content here. ".repeat(20), "wrapped.md");

      expect(cards).toHaveLength(1);
      expect(cards[0].question).toBe("Wrapped Q");
    });

    test("includes file path in prompt for context", async () => {
      const capturedCalls: Array<{ prompt: string; options: unknown }> = [];
      configureSdkForTesting(createCapturingMockSdk("[]", capturedCalls));

      const generator = createQACardGenerator();
      const filePath = "01_Projects/spaced-rep/design.md";
      await generator.generate("Content here. ".repeat(20), filePath);

      expect(capturedCalls[0].prompt).toContain(filePath);
    });
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe("createQACardGenerator", () => {
  test("creates QACardGenerator instance", () => {
    const generator = createQACardGenerator();

    expect(generator).toBeInstanceOf(QACardGenerator);
    expect(generator.type).toBe("qa");
  });

  test("implements CardTypeGenerator interface", () => {
    const generator = createQACardGenerator();

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
    configureSdkForTesting(createMockSdk(mockResponse));

    const content = `
# RAII in C++

RAII (Resource Acquisition Is Initialization) is a programming idiom
where resources are tied to object lifetime. Resources are acquired
in constructors and released in destructors. This ensures resources
are automatically cleaned up when objects go out of scope.
    `;

    const generator = createQACardGenerator();
    const cards = await generator.generate(content, "docs/cpp/raii.md");

    expect(cards).toHaveLength(2);
    expect(cards[0].question).toContain("RAII");
  });

  test("handles content with no extractable facts", async () => {
    configureSdkForTesting(createMockSdk("[]"));

    const content = `
# TODO

- [ ] Think about something
- [ ] Maybe do a thing later
- [ ] Random musings with no facts
    `.repeat(5);

    const generator = createQACardGenerator();
    const cards = await generator.generate(content, "notes/todo.md");

    expect(cards).toEqual([]);
  });
});
