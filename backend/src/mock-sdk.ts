/**
 * Mock SDK for E2E Testing
 *
 * Provides mock responses when MOCK_SDK=true environment variable is set.
 * Simulates Claude Agent SDK behavior without making real API calls.
 */

import type { ServerMessage } from "@memory-loop/shared";

/**
 * Check if mock mode is enabled.
 */
export function isMockMode(): boolean {
  return process.env.MOCK_SDK === "true";
}

/**
 * Mock responses for different message types.
 */
const MOCK_RESPONSES: Record<string, string> = {
  default: "This is a mock response from the Memory Loop test environment. In production, this would be a real AI response based on your vault context.",
  greeting: "Hello! I'm running in mock mode. I can help you test the Memory Loop interface.",
  help: "I'm a mock assistant. Try asking questions about your vault or use slash commands like /help.",
};

/**
 * Generates mock response events for a discussion message.
 * Yields events that simulate the streaming response pattern.
 */
export async function* generateMockResponse(
  messageText: string
): AsyncGenerator<ServerMessage> {
  const messageId = `msg_mock_${Date.now()}`;

  // Determine which mock response to use
  let response = MOCK_RESPONSES.default;
  const lowerText = messageText.toLowerCase();

  if (lowerText.includes("hello") || lowerText.includes("hi")) {
    response = MOCK_RESPONSES.greeting;
  } else if (lowerText.includes("help") || lowerText.startsWith("/help")) {
    response = MOCK_RESPONSES.help;
  }

  // Emit response_start
  yield {
    type: "response_start",
    messageId,
  };

  // Simulate tool use for certain queries
  if (lowerText.includes("read") || lowerText.includes("file")) {
    const toolUseId = `tool_mock_${Date.now()}`;

    yield {
      type: "tool_start",
      toolName: "Read",
      toolUseId,
    };

    // Small delay to simulate tool execution
    await sleep(100);

    yield {
      type: "tool_input",
      toolUseId,
      input: { file_path: "/mock/example.md" },
    };

    await sleep(200);

    yield {
      type: "tool_end",
      toolUseId,
      output: "# Mock File Content\n\nThis is simulated file content for testing.",
    };

    response = "I found the file you requested. Here's what I can see in the mock file content...";
  }

  // Stream the response in chunks
  const words = response.split(" ");
  for (let i = 0; i < words.length; i++) {
    const chunk = (i === 0 ? "" : " ") + words[i];

    yield {
      type: "response_chunk",
      messageId,
      content: chunk,
    };

    // Small delay between chunks to simulate streaming
    await sleep(30);
  }

  // Emit response_end
  yield {
    type: "response_end",
    messageId,
  };
}

/**
 * Creates a mock session.
 */
export function createMockSession(vaultId: string): string {
  return `mock_session_${vaultId}_${Date.now()}`;
}

/**
 * Utility for async delays.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
