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

  describe("context usage display", () => {
    it("displays context usage percentage for assistant messages", () => {
      const message = createMessage({
        role: "assistant",
        content: "Response content",
        contextUsage: 42,
      });

      const { container } = render(<MessageBubble message={message} />);

      const contextUsage = container.querySelector(".message-bubble__context-usage");
      expect(contextUsage).not.toBeNull();
      expect(contextUsage?.textContent).toBe("42%");
    });

    it("does not display context usage when undefined", () => {
      const message = createMessage({
        role: "assistant",
        content: "Response content",
        contextUsage: undefined,
      });

      const { container } = render(<MessageBubble message={message} />);

      const contextUsage = container.querySelector(".message-bubble__context-usage");
      expect(contextUsage).toBeNull();
    });

    it("does not display context usage for user messages", () => {
      const message = createMessage({
        role: "user",
        content: "User message",
        contextUsage: 50,
      });

      const { container } = render(<MessageBubble message={message} />);

      const contextUsage = container.querySelector(".message-bubble__context-usage");
      expect(contextUsage).toBeNull();
    });

    it("displays 0% when context usage is 0", () => {
      const message = createMessage({
        role: "assistant",
        content: "Response content",
        contextUsage: 0,
      });

      const { container } = render(<MessageBubble message={message} />);

      const contextUsage = container.querySelector(".message-bubble__context-usage");
      expect(contextUsage).not.toBeNull();
      expect(contextUsage?.textContent).toBe("0%");
    });

    it("displays 100% when context usage is at maximum", () => {
      const message = createMessage({
        role: "assistant",
        content: "Response content",
        contextUsage: 100,
      });

      const { container } = render(<MessageBubble message={message} />);

      const contextUsage = container.querySelector(".message-bubble__context-usage");
      expect(contextUsage).not.toBeNull();
      expect(contextUsage?.textContent).toBe("100%");
    });
  });

  describe("image display", () => {
    describe("Obsidian wiki-link syntax", () => {
      it("transforms ![[path/image.png]] to img in user messages", () => {
        const message = createMessage({
          role: "user",
          content: "Check this image: ![[some/path/photo.png]]",
        });

        const { container } = render(<MessageBubble message={message} vaultId="test-vault" />);

        const img = container.querySelector("img:not(.message-bubble__hr)");
        expect(img).not.toBeNull();
        expect(img?.getAttribute("src")).toBe("/vault/test-vault/assets/some/path/photo.png");
        expect(img?.getAttribute("alt")).toBe("some/path/photo.png");
      });

      it("transforms ![[path/image.png]] to img in assistant messages", () => {
        const message = createMessage({
          role: "assistant",
          content: "Here is the image you requested: ![[vault/images/result.jpg]]",
        });

        const { container } = render(<MessageBubble message={message} vaultId="test-vault" />);

        const img = container.querySelector("img:not(.message-bubble__hr)");
        expect(img).not.toBeNull();
        expect(img?.getAttribute("src")).toBe("/vault/test-vault/assets/vault/images/result.jpg");
        expect(img?.getAttribute("alt")).toBe("vault/images/result.jpg");
      });

      it("handles multiple Obsidian images in one message", () => {
        const message = createMessage({
          role: "assistant",
          content: "![[first.png]] and ![[second.webp]]",
        });

        const { container } = render(<MessageBubble message={message} vaultId="test-vault" />);

        const imgs = container.querySelectorAll("img:not(.message-bubble__hr)");
        expect(imgs.length).toBe(2);
      });

      it("supports various image extensions", () => {
        const message = createMessage({
          role: "assistant",
          content: "![[a.png]] ![[b.jpg]] ![[c.jpeg]] ![[d.gif]] ![[e.webp]]",
        });

        const { container } = render(<MessageBubble message={message} vaultId="test-vault" />);

        const imgs = container.querySelectorAll("img:not(.message-bubble__hr)");
        expect(imgs.length).toBe(5);
      });
    });

    describe("attachment folder paths", () => {
      it("transforms attachment folder paths to img in user messages", () => {
        const message = createMessage({
          role: "user",
          content: "Look at 05_Attachments/screenshot.png",
        });

        const { container } = render(<MessageBubble message={message} vaultId="test-vault" />);

        const img = container.querySelector("img:not(.message-bubble__hr)");
        expect(img).not.toBeNull();
        expect(img?.getAttribute("src")).toBe("/vault/test-vault/assets/05_Attachments/screenshot.png");
      });

      it("transforms attachment folder paths in assistant messages", () => {
        const message = createMessage({
          role: "assistant",
          content: "The file is at Attachments/diagram.webp",
        });

        const { container } = render(<MessageBubble message={message} vaultId="test-vault" />);

        const img = container.querySelector("img:not(.message-bubble__hr)");
        expect(img).not.toBeNull();
        expect(img?.getAttribute("src")).toBe("/vault/test-vault/assets/Attachments/diagram.webp");
      });
    });

    describe("without vaultId", () => {
      it("does not transform images when vaultId is not provided", () => {
        const message = createMessage({
          role: "assistant",
          content: "![[some/image.png]]",
        });

        const { container } = render(<MessageBubble message={message} />);

        const img = container.querySelector("img:not(.message-bubble__hr)");
        expect(img).toBeNull();
        expect(container.textContent).toContain("![[some/image.png]]");
      });
    });

    describe("paths inside inline code", () => {
      it("does not transform attachment paths inside backticks", () => {
        const message = createMessage({
          role: "assistant",
          content: "The file is at `05_Attachments/screenshot.png`",
        });

        const { container } = render(<MessageBubble message={message} vaultId="test-vault" />);

        const img = container.querySelector("img:not(.message-bubble__hr)");
        expect(img).toBeNull();
        const code = container.querySelector("code");
        expect(code).not.toBeNull();
        expect(code?.textContent).toBe("05_Attachments/screenshot.png");
      });

      it("does not transform wiki-link syntax inside backticks", () => {
        const message = createMessage({
          role: "assistant",
          content: "Use `![[path/to/image.png]]` syntax",
        });

        const { container } = render(<MessageBubble message={message} vaultId="test-vault" />);

        const img = container.querySelector("img:not(.message-bubble__hr)");
        expect(img).toBeNull();
        const code = container.querySelector("code");
        expect(code).not.toBeNull();
        expect(code?.textContent).toBe("![[path/to/image.png]]");
      });
    });
  });
});
