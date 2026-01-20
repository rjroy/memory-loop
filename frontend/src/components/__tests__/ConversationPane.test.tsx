/**
 * Tests for ConversationPane component
 *
 * Tests message display, auto-scroll behavior, and empty state rendering.
 * ConversationPane is extracted from Discussion.tsx per TD-7 for reuse in PairWritingMode.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { ConversationPane, DiscussionEmptyState } from "../ConversationPane";
import type { ConversationMessage } from "../../contexts/SessionContext";

afterEach(() => {
  cleanup();
});

function createMessage(
  overrides: Partial<ConversationMessage> = {}
): ConversationMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role: "assistant",
    content: "Test content",
    timestamp: new Date(),
    isStreaming: false,
    ...overrides,
  };
}

describe("ConversationPane", () => {
  describe("rendering", () => {
    it("renders message list with proper role attribute", () => {
      const messages = [
        createMessage({ id: "1", content: "Hello" }),
        createMessage({ id: "2", content: "World" }),
      ];

      const { container } = render(<ConversationPane messages={messages} />);

      const messageList = container.querySelector('[role="list"]');
      expect(messageList).not.toBeNull();
    });

    it("renders messages using MessageBubble component", () => {
      const messages = [
        createMessage({ id: "1", role: "user", content: "User message" }),
        createMessage({ id: "2", role: "assistant", content: "Assistant message" }),
      ];

      const { container } = render(<ConversationPane messages={messages} />);

      // MessageBubble renders with message-bubble class
      const bubbles = container.querySelectorAll(".message-bubble");
      expect(bubbles.length).toBe(2);

      // Check user and assistant classes
      expect(
        container.querySelector(".message-bubble--user")
      ).not.toBeNull();
      expect(
        container.querySelector(".message-bubble--assistant")
      ).not.toBeNull();
    });

    it("passes vaultId to MessageBubble for image display", () => {
      const messages = [
        createMessage({
          id: "1",
          role: "assistant",
          content: "Check this: ![[05_Attachments/image.png]]",
        }),
      ];

      const { container } = render(
        <ConversationPane messages={messages} vaultId="test-vault" />
      );

      // MessageBubble with vaultId transforms image paths to img elements
      const img = container.querySelector("img:not(.message-bubble__hr)");
      expect(img).not.toBeNull();
      expect(img?.getAttribute("src")).toBe(
        "/vault/test-vault/assets/05_Attachments/image.png"
      );
    });

    it("applies custom className when provided", () => {
      const { container } = render(
        <ConversationPane messages={[]} className="custom-class" />
      );

      const pane = container.querySelector(".conversation-pane");
      expect(pane?.classList.contains("custom-class")).toBe(true);
    });

    it("uses custom ariaLabel when provided", () => {
      const { container } = render(
        <ConversationPane messages={[]} ariaLabel="Custom conversation" />
      );

      const pane = container.querySelector('[aria-label="Custom conversation"]');
      expect(pane).not.toBeNull();
    });

    it("uses default ariaLabel when not provided", () => {
      const { container } = render(<ConversationPane messages={[]} />);

      const pane = container.querySelector('[aria-label="Conversation"]');
      expect(pane).not.toBeNull();
    });
  });

  describe("empty state", () => {
    it("renders default DiscussionEmptyState when no messages and no custom emptyState", () => {
      const { container } = render(<ConversationPane messages={[]} />);

      // Default empty state shows "Start a conversation" text
      expect(container.textContent).toContain("Start a conversation");
    });

    it("renders custom emptyState when provided and no messages", () => {
      const customEmpty = <div data-testid="custom-empty">Custom empty state</div>;

      const { container } = render(
        <ConversationPane messages={[]} emptyState={customEmpty} />
      );

      expect(
        container.querySelector('[data-testid="custom-empty"]')
      ).not.toBeNull();
      expect(container.textContent).toContain("Custom empty state");
    });

    it("does not render empty state when messages exist", () => {
      const messages = [createMessage({ id: "1", content: "Hello" })];

      const { container } = render(
        <ConversationPane messages={messages} emptyState={<div data-testid="custom-empty" />} />
      );

      expect(container.querySelector('[data-testid="custom-empty"]')).toBeNull();
    });
  });

  describe("DiscussionEmptyState", () => {
    it("renders with expected text content", () => {
      const { container } = render(<DiscussionEmptyState />);

      expect(container.textContent).toContain("Start a conversation about your vault");
      expect(container.textContent).toContain("slash commands");
    });

    it("has proper CSS class for styling", () => {
      const { container } = render(<DiscussionEmptyState />);

      expect(
        container.querySelector(".conversation-pane__empty")
      ).not.toBeNull();
    });
  });

  describe("streaming indicator", () => {
    it("renders streaming indicator when message is streaming", () => {
      const messages = [
        createMessage({
          id: "1",
          role: "assistant",
          content: "Streaming...",
          isStreaming: true,
        }),
      ];

      const { container } = render(<ConversationPane messages={messages} />);

      // Streaming indicator is an img with alt="Typing"
      const cursor = container.querySelector('img[alt="Typing"]');
      expect(cursor).not.toBeNull();
    });

    it("does not render streaming indicator for completed messages", () => {
      const messages = [
        createMessage({
          id: "1",
          role: "assistant",
          content: "Complete message",
          isStreaming: false,
        }),
      ];

      const { container } = render(<ConversationPane messages={messages} />);

      const cursor = container.querySelector('img[alt="Typing"]');
      expect(cursor).toBeNull();
    });
  });

  describe("scroll behavior", () => {
    it("includes scroll anchor element at end", () => {
      const messages = [createMessage({ id: "1", content: "Message" })];

      const { container } = render(<ConversationPane messages={messages} />);

      // The scroll anchor is a div with aria-hidden="true" at the end
      const anchor = container.querySelector('[aria-hidden="true"]');
      expect(anchor).not.toBeNull();
    });
  });

  describe("multiple messages", () => {
    it("renders messages in order", () => {
      const messages = [
        createMessage({ id: "1", role: "user", content: "First message" }),
        createMessage({ id: "2", role: "assistant", content: "Second message" }),
        createMessage({ id: "3", role: "user", content: "Third message" }),
      ];

      const { container } = render(<ConversationPane messages={messages} />);

      const textContent = container.textContent ?? "";
      const firstIndex = textContent.indexOf("First message");
      const secondIndex = textContent.indexOf("Second message");
      const thirdIndex = textContent.indexOf("Third message");

      expect(firstIndex).toBeLessThan(secondIndex);
      expect(secondIndex).toBeLessThan(thirdIndex);
    });

    it("uses message id as key for stable rendering", () => {
      const messages = [
        createMessage({ id: "stable-id-1", content: "Message 1" }),
        createMessage({ id: "stable-id-2", content: "Message 2" }),
      ];

      const { rerender, container } = render(
        <ConversationPane messages={messages} />
      );

      // Get initial render count
      const initialBubbles = container.querySelectorAll(".message-bubble");
      expect(initialBubbles.length).toBe(2);

      // Add a new message
      const updatedMessages = [
        ...messages,
        createMessage({ id: "stable-id-3", content: "Message 3" }),
      ];

      rerender(<ConversationPane messages={updatedMessages} />);

      const updatedBubbles = container.querySelectorAll(".message-bubble");
      expect(updatedBubbles.length).toBe(3);
    });
  });

  describe("tool invocations", () => {
    it("renders tool invocations in assistant messages", () => {
      const messages = [
        createMessage({
          id: "1",
          role: "assistant",
          content: "Using a tool...",
          toolInvocations: [
            {
              toolUseId: "tool-1",
              toolName: "Read",
              input: { path: "/test.txt" },
              output: "file content",
              status: "complete" as const,
            },
          ],
        }),
      ];

      const { container } = render(<ConversationPane messages={messages} />);

      // Tool display component should render
      const toolDisplay = container.querySelector(".message-bubble__tools");
      expect(toolDisplay).not.toBeNull();
    });
  });
});
