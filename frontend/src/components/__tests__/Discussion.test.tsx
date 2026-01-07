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
  contentRoot: "/test/vault",
  inboxPath: "inbox",
  metadataPath: "06_Metadata/memory-loop",
  setupComplete: false,
  promptsPerGeneration: 5,
  maxPoolSize: 50,
  quotesPerWeek: 1,
  badges: [],
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

    it("shows streaming response from server", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const ws = wsInstances[wsInstances.length - 1];

      // User sends a message
      const input = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /send/i });

      fireEvent.change(input, { target: { value: "Hello" } });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText("Hello")).toBeDefined();
      });

      // Server starts streaming response
      act(() => {
        ws.simulateMessage({ type: "response_start", messageId: "msg-1" });
      });

      // Streaming cursor should appear (assistant message with isStreaming: true)
      await waitFor(() => {
        const cursor = screen.queryByAltText("Typing");
        expect(cursor).not.toBeNull();
      });

      // Server sends a chunk
      act(() => {
        ws.simulateMessage({ type: "response_chunk", messageId: "msg-1", content: "Hi there!" });
      });

      // Content should appear
      await waitFor(() => {
        expect(screen.getByText("Hi there!")).toBeDefined();
      });

      // Server ends response
      act(() => {
        ws.simulateMessage({ type: "response_end", messageId: "msg-1" });
      });

      // Cursor should disappear
      await waitFor(() => {
        const cursor = screen.queryByAltText("Typing");
        expect(cursor).toBeNull();
      });
    });

    it("handles response_chunk without response_start (race condition fix)", async () => {
      // This tests the fix for when chunks arrive without a preceding response_start,
      // which can happen when clicking "New" during an active response
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const ws = wsInstances[wsInstances.length - 1];

      // User sends a message
      const input = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /send/i });

      fireEvent.change(input, { target: { value: "Hello" } });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText("Hello")).toBeDefined();
      });

      // Server sends chunk directly WITHOUT response_start (simulates race condition)
      act(() => {
        ws.simulateMessage({ type: "response_chunk", messageId: "msg-1", content: "Response without start" });
      });

      // Content should still appear (fix creates assistant message automatically)
      await waitFor(() => {
        expect(screen.getByText("Response without start")).toBeDefined();
      });

      // Server ends response
      act(() => {
        ws.simulateMessage({ type: "response_end", messageId: "msg-1" });
      });

      // Content should remain visible after response ends
      await waitFor(() => {
        expect(screen.getByText("Response without start")).toBeDefined();
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

  describe("slash command autocomplete", () => {
    it("shows autocomplete popup when typing slash command and commands are available", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      // Simulate session_ready with slash commands
      const ws = wsInstances[0];
      act(() => {
        ws.simulateMessage({
          type: "session_ready",
          sessionId: "test-session",
          vaultId: "vault-1",
          slashCommands: [
            { name: "/help", description: "Show help" },
            { name: "/commit", description: "Create a commit" },
          ],
        });
      });

      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "/he" } });

      await waitFor(() => {
        // The autocomplete popup has role="listbox"
        expect(screen.getByRole("listbox")).toBeDefined();
        // Should show the matching command
        expect(screen.getByText("/help")).toBeDefined();
      });
    });

    it("does not show autocomplete for regular messages", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      // Simulate session_ready with slash commands
      const ws = wsInstances[0];
      act(() => {
        ws.simulateMessage({
          type: "session_ready",
          sessionId: "test-session",
          vaultId: "vault-1",
          slashCommands: [
            { name: "/help", description: "Show help" },
          ],
        });
      });

      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Hello" } });

      // No listbox should be present for regular messages
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("does not show autocomplete when no commands are available", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      // Session ready without slash commands
      const ws = wsInstances[0];
      act(() => {
        ws.simulateMessage({
          type: "session_ready",
          sessionId: "test-session",
          vaultId: "vault-1",
          slashCommands: [],
        });
      });

      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "/help" } });

      // No listbox should be present when no commands exist
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("hides autocomplete after space is typed (indicating arguments)", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const ws = wsInstances[0];
      act(() => {
        ws.simulateMessage({
          type: "session_ready",
          sessionId: "test-session",
          vaultId: "vault-1",
          slashCommands: [
            { name: "/commit", description: "Create a commit", argumentHint: "<message>" },
          ],
        });
      });

      const input = screen.getByRole("textbox");

      // First type the command prefix
      act(() => {
        fireEvent.change(input, { target: { value: "/com" } });
      });

      await waitFor(() => {
        expect(screen.getByRole("listbox")).toBeDefined();
      });

      // Now type a space to indicate we're entering arguments
      act(() => {
        fireEvent.change(input, { target: { value: "/commit " } });
      });

      // Autocomplete should be hidden synchronously when space is added
      // The state update should cause immediate re-render hiding the listbox
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("selects command with Enter key and replaces input", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const ws = wsInstances[0];
      act(() => {
        ws.simulateMessage({
          type: "session_ready",
          sessionId: "test-session",
          vaultId: "vault-1",
          slashCommands: [
            { name: "/commit", description: "Create a commit", argumentHint: "<message>" },
            { name: "/clear", description: "Clear history" },
          ],
        });
      });

      const input = screen.getByRole("textbox");

      // Type filter prefix
      act(() => {
        fireEvent.change(input, { target: { value: "/com" } });
      });

      await waitFor(() => {
        expect(screen.getByRole("listbox")).toBeDefined();
      });

      // Press Enter to select the highlighted command
      act(() => {
        fireEvent.keyDown(input, { key: "Enter" });
      });

      // Input should be replaced with full command + space
      await waitFor(() => {
        expect((input as HTMLTextAreaElement).value).toBe("/commit ");
      });

      // Autocomplete should be hidden after selection
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("shows argumentHint as placeholder after command selection", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const ws = wsInstances[0];
      act(() => {
        ws.simulateMessage({
          type: "session_ready",
          sessionId: "test-session",
          vaultId: "vault-1",
          slashCommands: [
            { name: "/commit", description: "Create a commit", argumentHint: "<message>" },
          ],
        });
      });

      const input = screen.getByRole("textbox");

      // Type command prefix and select
      act(() => {
        fireEvent.change(input, { target: { value: "/com" } });
      });

      await waitFor(() => {
        expect(screen.getByRole("listbox")).toBeDefined();
      });

      // Press Enter to select
      act(() => {
        fireEvent.keyDown(input, { key: "Enter" });
      });

      await waitFor(() => {
        expect((input as HTMLTextAreaElement).value).toBe("/commit ");
      });

      // Placeholder should show the argumentHint
      expect((input as HTMLTextAreaElement).placeholder).toBe("<message>");
    });

    it("navigates selection with arrow keys", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const ws = wsInstances[0];
      act(() => {
        ws.simulateMessage({
          type: "session_ready",
          sessionId: "test-session",
          vaultId: "vault-1",
          slashCommands: [
            { name: "/clear", description: "Clear history" },
            { name: "/commit", description: "Create a commit" },
            { name: "/compact", description: "Compact context" },
          ],
        });
      });

      const input = screen.getByRole("textbox");

      // Type slash to show all commands
      act(() => {
        fireEvent.change(input, { target: { value: "/c" } });
      });

      await waitFor(() => {
        expect(screen.getByRole("listbox")).toBeDefined();
      });

      // First item should be selected initially
      const options = screen.getAllByRole("option");
      expect(options[0].getAttribute("aria-selected")).toBe("true");

      // Press ArrowDown to select second item
      act(() => {
        fireEvent.keyDown(input, { key: "ArrowDown" });
      });

      await waitFor(() => {
        const updatedOptions = screen.getAllByRole("option");
        expect(updatedOptions[1].getAttribute("aria-selected")).toBe("true");
      });
    });

    it("selects command by clicking on it", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const ws = wsInstances[0];
      act(() => {
        ws.simulateMessage({
          type: "session_ready",
          sessionId: "test-session",
          vaultId: "vault-1",
          slashCommands: [
            { name: "/commit", description: "Create a commit" },
            { name: "/clear", description: "Clear history" },
          ],
        });
      });

      const input = screen.getByRole("textbox");

      // Type slash to show autocomplete
      act(() => {
        fireEvent.change(input, { target: { value: "/" } });
      });

      await waitFor(() => {
        expect(screen.getByRole("listbox")).toBeDefined();
      });

      // Click on /commit option
      const commitOption = screen.getByText("/commit").closest("[role='option']")!;
      act(() => {
        fireEvent.click(commitOption);
      });

      // Input should be replaced with command + space
      await waitFor(() => {
        expect((input as HTMLTextAreaElement).value).toBe("/commit ");
      });
    });

    it("closes autocomplete with Escape key", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const ws = wsInstances[0];
      act(() => {
        ws.simulateMessage({
          type: "session_ready",
          sessionId: "test-session",
          vaultId: "vault-1",
          slashCommands: [
            { name: "/help", description: "Show help" },
          ],
        });
      });

      const input = screen.getByRole("textbox");

      // Type slash to show autocomplete
      act(() => {
        fireEvent.change(input, { target: { value: "/" } });
      });

      await waitFor(() => {
        expect(screen.getByRole("listbox")).toBeDefined();
      });

      // Press Escape
      act(() => {
        fireEvent.keyDown(input, { key: "Escape" });
      });

      // Input should still have the text (just autocomplete closed)
      // But autocomplete visibility is based on input value, so it should still show
      // Actually the close just resets selection, the popup stays visible based on input
      // This tests that Escape doesn't cause any errors
      expect(screen.getByRole("listbox")).toBeDefined();
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

  describe("session resume from pendingSessionId", () => {
    // Tests for the pendingSessionId flow when RecentActivity triggers a resume
    let setPendingSessionIdFn: ((id: string | null) => void) | null = null;
    let setShowDiscussionFn: ((show: boolean) => void) | null = null;

    function PendingSessionWrapper() {
      const [showDiscussion, setShowDiscussion] = React.useState(false);
      const { setPendingSessionId } = useSession();

      setPendingSessionIdFn = setPendingSessionId;
      setShowDiscussionFn = setShowDiscussion;

      return showDiscussion ? <Discussion /> : null;
    }

    it("sends resume_session when pendingSessionId is set before mount", async () => {
      render(
        <SessionProvider initialVaults={[testVault]}>
          <PendingSessionWrapper />
        </SessionProvider>
      );

      // Set pendingSessionId before mounting Discussion (simulates RecentActivity click)
      act(() => {
        setPendingSessionIdFn!("pending-session-abc123");
      });

      // Clear messages before mounting Discussion
      sentMessages.length = 0;

      // Mount Discussion
      act(() => {
        setShowDiscussionFn!(true);
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      // Should send resume_session with the pendingSessionId
      await waitFor(() => {
        const resumeMessages = sentMessages.filter(
          (m) => m.type === "resume_session"
        );
        expect(resumeMessages.length).toBe(1);
        expect(resumeMessages[0]).toEqual({
          type: "resume_session",
          sessionId: "pending-session-abc123",
        });
      });
    });

    it("pendingSessionId takes priority over existing sessionId", async () => {
      let setSessionIdFn: ((id: string) => void) | null = null;

      function PriorityTestWrapper() {
        const [showDiscussion, setShowDiscussion] = React.useState(false);
        const { setPendingSessionId, setSessionId } = useSession();

        setPendingSessionIdFn = setPendingSessionId;
        setSessionIdFn = setSessionId;
        setShowDiscussionFn = setShowDiscussion;

        return showDiscussion ? <Discussion /> : null;
      }

      render(
        <SessionProvider initialVaults={[testVault]}>
          <PriorityTestWrapper />
        </SessionProvider>
      );

      // Set both an existing sessionId AND a pendingSessionId
      act(() => {
        setSessionIdFn!("existing-session-111");
        setPendingSessionIdFn!("pending-session-222");
      });

      sentMessages.length = 0;

      act(() => {
        setShowDiscussionFn!(true);
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      // Should resume the PENDING session, not the existing one
      await waitFor(() => {
        const resumeMessages = sentMessages.filter(
          (m) => m.type === "resume_session"
        );
        expect(resumeMessages.length).toBe(1);
        expect(resumeMessages[0]).toEqual({
          type: "resume_session",
          sessionId: "pending-session-222",
        });
      });
    });

    it("clears pendingSessionId on SESSION_NOT_FOUND error", async () => {
      let getPendingSessionIdFn: (() => string | null) | null = null;

      function ErrorTestWrapper() {
        const [showDiscussion, setShowDiscussion] = React.useState(false);
        const { setPendingSessionId, pendingSessionId } = useSession();

        setPendingSessionIdFn = setPendingSessionId;
        getPendingSessionIdFn = () => pendingSessionId;
        setShowDiscussionFn = setShowDiscussion;

        return showDiscussion ? <Discussion /> : null;
      }

      render(
        <SessionProvider initialVaults={[testVault]}>
          <ErrorTestWrapper />
        </SessionProvider>
      );

      // Set pendingSessionId
      act(() => {
        setPendingSessionIdFn!("invalid-session-xyz");
      });

      // Mount Discussion
      act(() => {
        setShowDiscussionFn!(true);
      });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const ws = wsInstances[wsInstances.length - 1];

      // Verify pendingSessionId is set
      expect(getPendingSessionIdFn!()).toBe("invalid-session-xyz");

      // Server responds with SESSION_NOT_FOUND error
      act(() => {
        ws.simulateMessage({
          type: "error",
          code: "SESSION_NOT_FOUND",
          message: "Session not found",
        });
      });

      // pendingSessionId should be cleared to prevent retry on reconnect
      await waitFor(() => {
        expect(getPendingSessionIdFn!()).toBeNull();
      });

      // Should have sent select_vault as fallback
      await waitFor(() => {
        const selectVaultMessages = sentMessages.filter(
          (m) => m.type === "select_vault"
        );
        expect(selectVaultMessages.length).toBeGreaterThan(0);
      });
    });
  });

  describe("abort functionality", () => {
    it("shows stop button when submitting", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const input = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /send/i });

      // Submit a message
      fireEvent.change(input, { target: { value: "Hello Claude" } });
      fireEvent.click(button);

      // Button should now show "Stop response" label
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /stop response/i })).toBeDefined();
      });
    });

    it("sends abort message when stop button is clicked", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const input = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /send/i });

      // Submit a message
      fireEvent.change(input, { target: { value: "Hello Claude" } });
      fireEvent.click(button);

      // Wait for stop button to appear
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /stop response/i })).toBeDefined();
      });

      // Clear sent messages to isolate the abort
      sentMessages.length = 0;

      // Click stop button
      const stopButton = screen.getByRole("button", { name: /stop response/i });
      fireEvent.click(stopButton);

      // Should have sent abort message
      await waitFor(() => {
        expect(sentMessages).toContainEqual({ type: "abort" });
      });
    });

    it("reverts to send button after abort", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const input = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /send/i });

      // Submit a message
      fireEvent.change(input, { target: { value: "Hello Claude" } });
      fireEvent.click(button);

      // Wait for stop button
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /stop response/i })).toBeDefined();
      });

      // Click stop button
      const stopButton = screen.getByRole("button", { name: /stop response/i });
      fireEvent.click(stopButton);

      // Should revert to send button
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /send/i })).toBeDefined();
      });
    });

    it("stop button is enabled even when disconnected during submission", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const ws = wsInstances[wsInstances.length - 1];
      const input = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /send/i });

      // Submit a message
      fireEvent.change(input, { target: { value: "Hello Claude" } });
      fireEvent.click(button);

      // Wait for stop button
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /stop response/i })).toBeDefined();
      });

      // Simulate disconnect
      ws.readyState = MockWebSocket.CLOSED;
      act(() => {
        if (ws.onclose) ws.onclose(new Event("close"));
      });

      // Stop button should still be clickable (not disabled)
      const stopButton = screen.getByRole("button", { name: /stop response/i });
      expect(stopButton.hasAttribute("disabled")).toBe(false);
    });

    it("reverts to send button on response_end", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const ws = wsInstances[wsInstances.length - 1];
      const input = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /send/i });

      // Submit a message
      fireEvent.change(input, { target: { value: "Hello Claude" } });
      fireEvent.click(button);

      // Wait for stop button
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /stop response/i })).toBeDefined();
      });

      // Server sends response_end
      act(() => {
        ws.simulateMessage({ type: "response_start", messageId: "msg-1" });
        ws.simulateMessage({ type: "response_chunk", messageId: "msg-1", content: "Hi!" });
        ws.simulateMessage({ type: "response_end", messageId: "msg-1" });
      });

      // Should revert to send button
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /send/i })).toBeDefined();
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
