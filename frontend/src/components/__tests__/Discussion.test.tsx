/**
 * Tests for Discussion component
 *
 * Tests message display, submission, streaming, and slash commands.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { Discussion } from "../Discussion";
import { SessionProvider, useSession } from "../../contexts/SessionContext";
import type { ServerMessage, ClientMessage, VaultInfo } from "@memory-loop/shared";

// Mock WebSocket
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;

  constructor(public url: string) {
    wsInstances.push(this);
    setTimeout(() => {
      if (this.onopen) this.onopen(new Event("open"));
    }, 0);
  }

  send(data: string): void {
    sentMessages.push(JSON.parse(data) as ClientMessage);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  simulateMessage(msg: ServerMessage): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data: JSON.stringify(msg) }));
    }
  }
}

let wsInstances: MockWebSocket[] = [];
let sentMessages: ClientMessage[] = [];
const originalWebSocket = globalThis.WebSocket;
const originalMatchMedia = globalThis.matchMedia;

// Mock matchMedia for touch device detection
function createMatchMediaMock(matches: boolean) {
  return (query: string): MediaQueryList => ({
    matches: query === "(hover: none)" ? matches : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  });
}

const testVault: VaultInfo = {
  id: "vault-1",
  name: "Test Vault",
  path: "/test/vault",
  hasClaudeMd: true,
  inboxPath: "/test/vault/inbox",
};

function TestWrapper({ children }: { children: ReactNode }) {
  return (
    <SessionProvider initialVaults={[testVault]}>
      {children}
    </SessionProvider>
  );
}

beforeEach(() => {
  wsInstances = [];
  sentMessages = [];
  localStorage.clear();

  // Pre-select vault via localStorage
  localStorage.setItem("memory-loop:vaultId", "vault-1");

  // @ts-expect-error - mocking WebSocket
  globalThis.WebSocket = MockWebSocket;

  // Default to desktop (non-touch) for tests
  globalThis.matchMedia = createMatchMediaMock(false);
});

afterEach(() => {
  cleanup();
  globalThis.WebSocket = originalWebSocket;
  globalThis.matchMedia = originalMatchMedia;
});

describe("Discussion", () => {
  describe("vault selection", () => {
    it("sends select_vault on WebSocket connect", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      // Wait for the select_vault message to be sent
      await waitFor(() => {
        expect(sentMessages).toContainEqual({
          type: "select_vault",
          vaultId: "vault-1",
        });
      });
    });

    it("sends select_vault with correct vault ID", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      // Verify the select_vault message has the correct vault ID
      await waitFor(() => {
        const vaultSelections = sentMessages.filter(
          (m) => m.type === "select_vault"
        );
        expect(vaultSelections.length).toBe(1);
        expect(vaultSelections[0]).toEqual({
          type: "select_vault",
          vaultId: "vault-1",
        });
      });
    });
  });

  describe("new session", () => {
    it("sends new_session when sessionId is cleared", async () => {
      // Create a wrapper that can trigger startNewSession
      let triggerNewSession: (() => void) | null = null;
      let triggerSetSessionId: ((id: string) => void) | null = null;

      function NewSessionTrigger() {
        const { startNewSession, setSessionId } = useSession();
        triggerNewSession = startNewSession;
        triggerSetSessionId = setSessionId;
        return null;
      }

      function TestWrapperWithTrigger({ children }: { children: ReactNode }) {
        return (
          <SessionProvider initialVaults={[testVault]}>
            <NewSessionTrigger />
            {children}
          </SessionProvider>
        );
      }

      render(<Discussion />, { wrapper: TestWrapperWithTrigger });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      // Set up initial sessionId
      act(() => {
        triggerSetSessionId!("existing-session-123");
      });

      // Clear messages from initial connection
      sentMessages.length = 0;

      // Now trigger startNewSession
      expect(triggerNewSession).not.toBeNull();
      act(() => {
        triggerNewSession!();
      });

      // Should send new_session message to backend
      await waitFor(() => {
        const newSessionMessages = sentMessages.filter(
          (m) => m.type === "new_session"
        );
        expect(newSessionMessages.length).toBe(1);
      });
    });
  });

  describe("rendering", () => {
    it("renders input field and send button", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      expect(screen.getByRole("textbox")).toBeDefined();
      expect(screen.getByRole("button", { name: /send/i })).toBeDefined();
    });

    it("shows empty state when no messages", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      expect(screen.getByText(/start a conversation/i)).toBeDefined();
    });

    it("has proper accessibility attributes", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      expect(screen.getByRole("list", { name: /conversation/i })).toBeDefined();
      expect(screen.getByRole("textbox", { name: /message input/i })).toBeDefined();
    });
  });

  describe("message submission", () => {
    it("sends discussion_message on submit", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const input = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /send/i });

      fireEvent.change(input, { target: { value: "Hello Claude" } });
      fireEvent.click(button);

      await waitFor(() => {
        expect(sentMessages).toContainEqual({
          type: "discussion_message",
          text: "Hello Claude",
        });
      });
    });

    it("adds user message to conversation", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const input = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /send/i });

      fireEvent.change(input, { target: { value: "Hello Claude" } });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText("Hello Claude")).toBeDefined();
      });
    });

    it("clears input after submission", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const input = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /send/i });

      fireEvent.change(input, { target: { value: "Hello Claude" } });
      fireEvent.click(button);

      await waitFor(() => {
        expect((input as HTMLTextAreaElement).value).toBe("");
      });
    });

    it("submits on Enter key on desktop", async () => {
      // Default mock is desktop (non-touch)
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const input = screen.getByRole("textbox");

      fireEvent.change(input, { target: { value: "Hello Claude" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => {
        expect(sentMessages).toContainEqual({
          type: "discussion_message",
          text: "Hello Claude",
        });
      });
    });

    it("does not submit on Enter key on touch devices", async () => {
      // Mock touch device
      globalThis.matchMedia = createMatchMediaMock(true);

      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const input = screen.getByRole("textbox");

      fireEvent.change(input, { target: { value: "Hello Claude" } });
      fireEvent.keyDown(input, { key: "Enter" });

      // Should not have sent discussion_message - only select_vault
      const discussionMessages = sentMessages.filter(
        (m) => m.type === "discussion_message"
      );
      expect(discussionMessages.length).toBe(0);
    });

    it("does not submit on Shift+Enter", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const input = screen.getByRole("textbox");

      fireEvent.change(input, { target: { value: "Hello" } });
      fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

      // Should not have sent any discussion_message (select_vault is expected on connect)
      const discussionMessages = sentMessages.filter(
        (m) => m.type === "discussion_message"
      );
      expect(discussionMessages.length).toBe(0);
    });

    it("disables button when input is empty", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const button = screen.getByRole("button", { name: /send/i });
      expect(button.hasAttribute("disabled")).toBe(true);
    });
  });

  describe("slash command detection", () => {
    it("shows hint when typing slash command", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "/help" } });

      await waitFor(() => {
        expect(screen.getByText(/slash command detected/i)).toBeDefined();
      });
    });

    it("does not show hint for regular messages", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Hello" } });

      expect(screen.queryByText(/slash command detected/i)).toBeNull();
    });
  });

  describe("draft persistence", () => {
    it("saves draft to localStorage", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Draft message" } });

      await waitFor(() => {
        expect(localStorage.getItem("memory-loop-discussion-draft")).toBe("Draft message");
      });
    });

    it("loads draft from localStorage on mount", async () => {
      localStorage.setItem("memory-loop-discussion-draft", "Saved draft");

      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const input = screen.getByRole("textbox");
      expect((input as HTMLTextAreaElement).value).toBe("Saved draft");
    });

    it("clears localStorage after successful submission", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const input = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /send/i });

      fireEvent.change(input, { target: { value: "Hello" } });

      await waitFor(() => {
        expect(localStorage.getItem("memory-loop-discussion-draft")).toBe("Hello");
      });

      fireEvent.click(button);

      await waitFor(() => {
        expect(localStorage.getItem("memory-loop-discussion-draft")).toBeNull();
      });
    });
  });

  describe("prefill from inspiration", () => {
    // Shared test helpers - using a controlled wrapper that preserves SessionProvider state
    let setPrefillFn: ((text: string | null) => void) | null = null;
    let getPrefillFn: (() => string | null) | null = null;
    let setShowDiscussionFn: ((show: boolean) => void) | null = null;

    function ControlledWrapper() {
      const [showDiscussion, setShowDiscussion] = React.useState(false);
      const { setDiscussionPrefill, discussionPrefill } = useSession();

      // Expose functions to test
      setPrefillFn = setDiscussionPrefill;
      getPrefillFn = () => discussionPrefill;
      setShowDiscussionFn = setShowDiscussion;

      return showDiscussion ? <Discussion /> : null;
    }

    it("populates input with prefill text on mount", async () => {
      render(
        <SessionProvider initialVaults={[testVault]}>
          <ControlledWrapper />
        </SessionProvider>
      );

      // Set prefill before mounting Discussion
      act(() => {
        setPrefillFn!("What excites you today?");
      });

      // Mount Discussion
      act(() => {
        setShowDiscussionFn!(true);
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const input = screen.getByRole("textbox");
      expect((input as HTMLTextAreaElement).value).toBe("What excites you today?");
    });

    it("clears prefill from context after populating input", async () => {
      render(
        <SessionProvider initialVaults={[testVault]}>
          <ControlledWrapper />
        </SessionProvider>
      );

      // Set prefill
      act(() => {
        setPrefillFn!("Reflect on this...");
      });

      // Mount Discussion
      act(() => {
        setShowDiscussionFn!(true);
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      // Verify input has the prefill
      const input = screen.getByRole("textbox");
      expect((input as HTMLTextAreaElement).value).toBe("Reflect on this...");

      // Verify prefill was cleared from context
      await waitFor(() => {
        expect(getPrefillFn!()).toBeNull();
      });
    });

    it("prefill takes precedence over localStorage draft", async () => {
      // Set draft in localStorage
      localStorage.setItem("memory-loop-discussion-draft", "Draft message");

      render(
        <SessionProvider initialVaults={[testVault]}>
          <ControlledWrapper />
        </SessionProvider>
      );

      // Set prefill
      act(() => {
        setPrefillFn!("Prefill message");
      });

      // Mount Discussion
      act(() => {
        setShowDiscussionFn!(true);
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const input = screen.getByRole("textbox");
      // Prefill should win over draft
      expect((input as HTMLTextAreaElement).value).toBe("Prefill message");
    });

    it("does not auto-submit prefill (user must click send)", async () => {
      render(
        <SessionProvider initialVaults={[testVault]}>
          <ControlledWrapper />
        </SessionProvider>
      );

      act(() => {
        setPrefillFn!("Some prefill");
      });

      // Clear any sent messages before mounting Discussion
      sentMessages.length = 0;

      act(() => {
        setShowDiscussionFn!(true);
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      // Should not have sent discussion_message
      const discussionMessages = sentMessages.filter(
        (m) => m.type === "discussion_message"
      );
      expect(discussionMessages.length).toBe(0);
    });
  });
});
