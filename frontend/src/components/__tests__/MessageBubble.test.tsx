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
    it("renders user content with markdown", () => {
      const message = createMessage({
        role: "user",
        content: "Hello world",
      });

      const { container } = render(<MessageBubble message={message} />);

      expect(container.textContent).toContain("Hello world");
    });

    it("renders hr as decorative image in user messages", () => {
      const message = createMessage({
        role: "user",
        content: "Before\n\n---\n\nAfter",
      });

      const { container } = render(<MessageBubble message={message} />);

      const hrImage = container.querySelector("img.message-bubble__hr");
      expect(hrImage).not.toBeNull();
      expect(hrImage?.getAttribute("src")).toBe("/images/hr.webp");
    });

    it("renders blockquotes in user messages", () => {
      const message = createMessage({
        role: "user",
        content: "> This is a quote",
      });

      const { container } = render(<MessageBubble message={message} />);

      const blockquote = container.querySelector("blockquote");
      expect(blockquote).not.toBeNull();
      expect(blockquote?.textContent).toContain("This is a quote");
    });

    it("renders bold and italic in user messages", () => {
      const message = createMessage({
        role: "user",
        content: "This is **bold** and *italic*",
      });

      const { container } = render(<MessageBubble message={message} />);

      expect(container.querySelector("strong")).not.toBeNull();
      expect(container.querySelector("em")).not.toBeNull();
    });

    it("renders code blocks in user messages", () => {
      const message = createMessage({
        role: "user",
        content: "Use `inline code` here",
      });

      const { container } = render(<MessageBubble message={message} />);

      const code = container.querySelector("code");
      expect(code).not.toBeNull();
      expect(code?.textContent).toBe("inline code");
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
