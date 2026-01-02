/**
 * Tests for MessageBubble component
 */

import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";
import { MessageBubble } from "../MessageBubble";
import type { ConversationMessage } from "../../contexts/SessionContext";

afterEach(() => {
  cleanup();
});

function createMessage(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: "test-id",
    role: "assistant",
    content: "Test content",
    timestamp: new Date(),
    isStreaming: false,
    ...overrides,
  };
}

describe("MessageBubble", () => {
  describe("horizontal rules", () => {
    it("renders hr as decorative image in assistant messages", () => {
      const message = createMessage({
        content: "Before\n\n---\n\nAfter",
      });

      const { container } = render(<MessageBubble message={message} />);

      const hrImage = container.querySelector("img.message-bubble__hr");
      expect(hrImage).not.toBeNull();
      expect(hrImage?.getAttribute("src")).toBe("/images/hr.webp");
      expect(hrImage?.getAttribute("aria-hidden")).toBe("true");
      expect(hrImage?.getAttribute("alt")).toBe("");
    });

    it("does not render standard hr element in assistant messages", () => {
      const message = createMessage({
        content: "Before\n\n---\n\nAfter",
      });

      const { container } = render(<MessageBubble message={message} />);

      const standardHr = container.querySelector("hr");
      expect(standardHr).toBeNull();
    });
  });

  describe("user messages", () => {
    it("renders user content as plain text", () => {
      const message = createMessage({
        role: "user",
        content: "Hello world",
      });

      const { container } = render(<MessageBubble message={message} />);

      expect(container.textContent).toContain("Hello world");
    });
  });

  describe("assistant messages", () => {
    it("renders markdown content", () => {
      const message = createMessage({
        content: "# Heading\n\nParagraph text",
      });

      const { container } = render(<MessageBubble message={message} />);

      expect(container.querySelector("h1")).not.toBeNull();
      expect(container.textContent).toContain("Heading");
      expect(container.textContent).toContain("Paragraph text");
    });
  });
});
