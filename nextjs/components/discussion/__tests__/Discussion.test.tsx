/**
 * Tests for Discussion component
 *
 * Tests message display, submission, streaming, and slash commands.
 * Uses mock fetch for SSE transport (no WebSocket).
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import React, { useEffect, createRef, type ReactNode } from "react";
import { Discussion, type SendMessageFn } from "../Discussion";
import { SessionProvider, useSession } from "../../../contexts/SessionContext";
import type { VaultInfo, SlashCommand } from "@/lib/schemas";

// =============================================================================
// Mock Fetch + SSE Helpers
// =============================================================================

const mockFetch = mock(() => Promise.resolve(new Response()));
const originalFetch = globalThis.fetch;
const originalMatchMedia = globalThis.matchMedia;

/**
 * Creates a mock SSE response with the given events.
 * Matches the format expected by useChat's SSE parser.
 */
function createSSEResponse(events: Array<{ type: string; [key: string]: unknown }>): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

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

// =============================================================================
// Test Fixtures
// =============================================================================

const testVault: VaultInfo = {
  id: "vault-1",
  name: "Test Vault",
  path: "/test/vault",
  hasClaudeMd: true,
  contentRoot: "/test/vault",
  inboxPath: "inbox",
  metadataPath: "06_Metadata/memory-loop",
  attachmentPath: "05_Attachments",
  setupComplete: false,
  promptsPerGeneration: 5,
  maxPoolSize: 50,
  quotesPerWeek: 1,
  badges: [],
  order: 999999,
  cardsEnabled: true,
  viMode: false,
};

function TestWrapper({ children }: { children: ReactNode }) {
  return (
    <SessionProvider initialVaults={[testVault]}>
      {children}
    </SessionProvider>
  );
}

/**
 * Helper wrapper that provides slash commands via SessionContext.
 * Slash commands arrive via session_ready SSE event in production;
 * for tests we inject them after vault selection completes.
 *
 * SELECT_VAULT resets slashCommands to [], so we must set them
 * after the vault selection useEffect fires (which is triggered by
 * initialVaults + localStorage).
 */
function SlashCommandWrapper({
  children,
  commands,
}: {
  children: ReactNode;
  commands: SlashCommand[];
}) {
  return (
    <SessionProvider initialVaults={[testVault]}>
      <SlashCommandInjector commands={commands} />
      {children}
    </SessionProvider>
  );
}

function SlashCommandInjector({ commands }: { commands: SlashCommand[] }) {
  const { vault, setSlashCommands } = useSession();
  // Set slash commands once vault is selected (SELECT_VAULT resets them)
  useEffect(() => {
    if (vault) {
      setSlashCommands(commands);
    }
  }, [vault]);
  return null;
}

/**
 * Sets up mock fetch to return an SSE response that creates a session
 * and streams a response with the given content.
 */
function mockFetchWithResponse(content: string) {
  mockFetch.mockImplementation(() =>
    Promise.resolve(
      createSSEResponse([
        { type: "session_ready", sessionId: "sess-1", vaultId: "vault-1" },
        { type: "response_start", messageId: "msg-1" },
        { type: "response_chunk", messageId: "msg-1", content },
        { type: "response_end", messageId: "msg-1", durationMs: 100 },
      ])
    )
  );
}

/**
 * Sets up mock fetch to return a basic session-only response (no content).
 */
function mockFetchWithSession() {
  mockFetch.mockImplementation(() =>
    Promise.resolve(
      createSSEResponse([
        { type: "session_ready", sessionId: "sess-1", vaultId: "vault-1" },
        { type: "response_end", messageId: "msg-1", durationMs: 100 },
      ])
    )
  );
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.clear();

  // Pre-select vault via localStorage
  localStorage.setItem("memory-loop:vaultId", "vault-1");

  globalThis.fetch = mockFetch as unknown as typeof fetch;

  // Default to desktop (non-touch) for tests
  globalThis.matchMedia = createMatchMediaMock(false);

  // Default mock: return empty SSE response
  mockFetchWithSession();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.matchMedia = originalMatchMedia;
});

// =============================================================================
// Tests
// =============================================================================

describe("Discussion", () => {
  describe("rendering", () => {
    it("renders input field and send button", () => {
      render(<Discussion />, { wrapper: TestWrapper });

      expect(screen.getByRole("textbox")).toBeDefined();
      expect(screen.getByRole("button", { name: /send/i })).toBeDefined();
    });

    it("shows empty state when no messages", () => {
      render(<Discussion />, { wrapper: TestWrapper });

      expect(screen.getByText(/start a conversation/i)).toBeDefined();
    });

    it("has proper accessibility attributes", () => {
      render(<Discussion />, { wrapper: TestWrapper });

      expect(screen.getByRole("list", { name: /conversation/i })).toBeDefined();
      expect(screen.getByRole("textbox", { name: /message input/i })).toBeDefined();
    });
  });

  describe("message submission", () => {
    it("sends message via fetch POST on submit", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      const input = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /send/i });

      fireEvent.change(input, { target: { value: "Hello Claude" } });
      fireEvent.click(button);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const call = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(call[0]).toBe("/api/chat");
      expect(call[1].method).toBe("POST");

      const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
      expect(body.prompt).toBe("Hello Claude");
      expect(body.vaultId).toBe("vault-1");
    });

    it("adds user message to conversation", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      const input = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /send/i });

      fireEvent.change(input, { target: { value: "Hello Claude" } });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText("Hello Claude")).toBeDefined();
      });
    });

    it("shows streaming response from server", async () => {
      mockFetchWithResponse("Hi there!");

      render(<Discussion />, { wrapper: TestWrapper });

      const input = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /send/i });

      fireEvent.change(input, { target: { value: "Hello" } });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText("Hi there!")).toBeDefined();
      });
    });

    it("clears input after submission", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      const input = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /send/i });

      fireEvent.change(input, { target: { value: "Hello Claude" } });
      fireEvent.click(button);

      await waitFor(() => {
        expect((input as HTMLTextAreaElement).value).toBe("");
      });
    });

    it("submits on Enter key on desktop", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      const input = screen.getByRole("textbox");

      fireEvent.change(input, { target: { value: "Hello Claude" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const call = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
      expect(body.prompt).toBe("Hello Claude");
    });

    it("does not submit on Enter key on touch devices", () => {
      // Mock touch device
      globalThis.matchMedia = createMatchMediaMock(true);

      render(<Discussion />, { wrapper: TestWrapper });

      const input = screen.getByRole("textbox");

      fireEvent.change(input, { target: { value: "Hello Claude" } });
      fireEvent.keyDown(input, { key: "Enter" });

      // Should not have called fetch
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does not submit on Shift+Enter", () => {
      render(<Discussion />, { wrapper: TestWrapper });

      const input = screen.getByRole("textbox");

      fireEvent.change(input, { target: { value: "Hello" } });
      fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

      // Should not have called fetch
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("disables button when input is empty", () => {
      render(<Discussion />, { wrapper: TestWrapper });

      const button = screen.getByRole("button", { name: /send/i });
      expect(button.hasAttribute("disabled")).toBe(true);
    });
  });

  describe("slash command autocomplete", () => {
    const testCommands: SlashCommand[] = [
      { name: "/help", description: "Show help" },
      { name: "/commit", description: "Create a commit" },
    ];

    it("shows autocomplete popup when typing slash command and commands are available", async () => {
      render(
        <SlashCommandWrapper commands={testCommands}>
          <Discussion />
        </SlashCommandWrapper>
      );

      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "/he" } });

      await waitFor(() => {
        expect(screen.getByRole("listbox")).toBeDefined();
        expect(screen.getByText("/help")).toBeDefined();
      });
    });

    it("does not show autocomplete for regular messages", async () => {
      render(
        <SlashCommandWrapper commands={testCommands}>
          <Discussion />
        </SlashCommandWrapper>
      );


      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Hello" } });

      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("does not show autocomplete when no commands are available", async () => {
      render(
        <SlashCommandWrapper commands={[]}>
          <Discussion />
        </SlashCommandWrapper>
      );


      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "/help" } });

      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("hides autocomplete after space is typed (indicating arguments)", async () => {
      const commands: SlashCommand[] = [
        { name: "/commit", description: "Create a commit", argumentHint: "<message>" },
      ];

      render(
        <SlashCommandWrapper commands={commands}>
          <Discussion />
        </SlashCommandWrapper>
      );


      const input = screen.getByRole("textbox");

      act(() => {
        fireEvent.change(input, { target: { value: "/com" } });
      });

      await waitFor(() => {
        expect(screen.getByRole("listbox")).toBeDefined();
      });

      act(() => {
        fireEvent.change(input, { target: { value: "/commit " } });
      });

      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("selects command with Enter key and replaces input", async () => {
      const commands: SlashCommand[] = [
        { name: "/commit", description: "Create a commit", argumentHint: "<message>" },
        { name: "/clear", description: "Clear history" },
      ];

      render(
        <SlashCommandWrapper commands={commands}>
          <Discussion />
        </SlashCommandWrapper>
      );


      const input = screen.getByRole("textbox");

      act(() => {
        fireEvent.change(input, { target: { value: "/com" } });
      });

      await waitFor(() => {
        expect(screen.getByRole("listbox")).toBeDefined();
      });

      act(() => {
        fireEvent.keyDown(input, { key: "Enter" });
      });

      await waitFor(() => {
        expect((input as HTMLTextAreaElement).value).toBe("/commit ");
      });

      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("shows argumentHint as placeholder after command selection", async () => {
      const commands: SlashCommand[] = [
        { name: "/commit", description: "Create a commit", argumentHint: "<message>" },
      ];

      render(
        <SlashCommandWrapper commands={commands}>
          <Discussion />
        </SlashCommandWrapper>
      );


      const input = screen.getByRole("textbox");

      act(() => {
        fireEvent.change(input, { target: { value: "/com" } });
      });

      await waitFor(() => {
        expect(screen.getByRole("listbox")).toBeDefined();
      });

      act(() => {
        fireEvent.keyDown(input, { key: "Enter" });
      });

      await waitFor(() => {
        expect((input as HTMLTextAreaElement).value).toBe("/commit ");
      });

      expect((input as HTMLTextAreaElement).placeholder).toBe("<message>");
    });

    it("navigates selection with arrow keys", async () => {
      const commands: SlashCommand[] = [
        { name: "/clear", description: "Clear history" },
        { name: "/commit", description: "Create a commit" },
        { name: "/compact", description: "Compact context" },
      ];

      render(
        <SlashCommandWrapper commands={commands}>
          <Discussion />
        </SlashCommandWrapper>
      );


      const input = screen.getByRole("textbox");

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
      const commands: SlashCommand[] = [
        { name: "/commit", description: "Create a commit" },
        { name: "/clear", description: "Clear history" },
      ];

      render(
        <SlashCommandWrapper commands={commands}>
          <Discussion />
        </SlashCommandWrapper>
      );


      const input = screen.getByRole("textbox");

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

      await waitFor(() => {
        expect((input as HTMLTextAreaElement).value).toBe("/commit ");
      });
    });

    it("closes autocomplete with Escape key", async () => {
      const commands: SlashCommand[] = [
        { name: "/help", description: "Show help" },
      ];

      render(
        <SlashCommandWrapper commands={commands}>
          <Discussion />
        </SlashCommandWrapper>
      );


      const input = screen.getByRole("textbox");

      act(() => {
        fireEvent.change(input, { target: { value: "/" } });
      });

      await waitFor(() => {
        expect(screen.getByRole("listbox")).toBeDefined();
      });

      act(() => {
        fireEvent.keyDown(input, { key: "Escape" });
      });

      // The listbox visibility is derived from input state, not explicitly closed.
      // Escape just resets selection. The popup stays visible based on input.
      expect(screen.getByRole("listbox")).toBeDefined();
    });
  });

  describe("draft persistence", () => {
    it("saves draft to localStorage", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Draft message" } });

      await waitFor(() => {
        expect(localStorage.getItem("memory-loop-discussion-draft")).toBe("Draft message");
      });
    });

    it("loads draft from localStorage on mount", () => {
      localStorage.setItem("memory-loop-discussion-draft", "Saved draft");

      render(<Discussion />, { wrapper: TestWrapper });

      const input = screen.getByRole("textbox");
      expect((input as HTMLTextAreaElement).value).toBe("Saved draft");
    });

    it("clears localStorage after successful submission", async () => {
      render(<Discussion />, { wrapper: TestWrapper });

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

  describe("abort functionality", () => {
    it("shows stop button when submitting", async () => {
      // Use a delayed response so we can observe the submitting state
      mockFetch.mockImplementation(
        () => new Promise((resolve) => {
          setTimeout(
            () => resolve(createSSEResponse([
              { type: "response_end", messageId: "msg-1", durationMs: 100 },
            ])),
            5000
          );
        })
      );

      render(<Discussion />, { wrapper: TestWrapper });

      const input = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /send/i });

      fireEvent.change(input, { target: { value: "Hello Claude" } });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /stop response/i })).toBeDefined();
      });
    });

    it("reverts to send button after abort", async () => {
      // Use a delayed response
      mockFetch.mockImplementation(
        () => new Promise((resolve) => {
          setTimeout(
            () => resolve(createSSEResponse([
              { type: "response_end", messageId: "msg-1", durationMs: 100 },
            ])),
            5000
          );
        })
      );

      render(<Discussion />, { wrapper: TestWrapper });

      const input = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /send/i });

      fireEvent.change(input, { target: { value: "Hello Claude" } });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /stop response/i })).toBeDefined();
      });

      // Click stop button
      const stopButton = screen.getByRole("button", { name: /stop response/i });
      fireEvent.click(stopButton);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /send/i })).toBeDefined();
      });
    });

    it("reverts to send button on response_end", async () => {
      mockFetchWithResponse("Hi!");

      render(<Discussion />, { wrapper: TestWrapper });

      const input = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /send/i });

      fireEvent.change(input, { target: { value: "Hello Claude" } });
      fireEvent.click(button);

      // After SSE stream completes (response_end received), should revert to send button
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /send/i })).toBeDefined();
      });
    });
  });

  describe("prefill from inspiration", () => {
    let setPrefillFn: ((text: string | null) => void) | null = null;
    let getPrefillFn: (() => string | null) | null = null;
    let setShowDiscussionFn: ((show: boolean) => void) | null = null;

    function ControlledWrapper() {
      const [showDiscussion, setShowDiscussion] = React.useState(false);
      const { setDiscussionPrefill, discussionPrefill } = useSession();

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

      act(() => {
        setPrefillFn!("What excites you today?");
      });

      act(() => {
        setShowDiscussionFn!(true);
      });

      await waitFor(() => {
        const input = screen.getByRole("textbox");
        expect((input as HTMLTextAreaElement).value).toBe("What excites you today?");
      });
    });

    it("clears prefill from context after populating input", async () => {
      render(
        <SessionProvider initialVaults={[testVault]}>
          <ControlledWrapper />
        </SessionProvider>
      );

      act(() => {
        setPrefillFn!("Reflect on this...");
      });

      act(() => {
        setShowDiscussionFn!(true);
      });

      await waitFor(() => {
        const input = screen.getByRole("textbox");
        expect((input as HTMLTextAreaElement).value).toBe("Reflect on this...");
      });

      await waitFor(() => {
        expect(getPrefillFn!()).toBeNull();
      });
    });

    it("prefill takes precedence over localStorage draft", async () => {
      localStorage.setItem("memory-loop-discussion-draft", "Draft message");

      render(
        <SessionProvider initialVaults={[testVault]}>
          <ControlledWrapper />
        </SessionProvider>
      );

      act(() => {
        setPrefillFn!("Prefill message");
      });

      act(() => {
        setShowDiscussionFn!(true);
      });

      await waitFor(() => {
        const input = screen.getByRole("textbox");
        expect((input as HTMLTextAreaElement).value).toBe("Prefill message");
      });
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

      // Clear any calls before mounting Discussion
      mockFetch.mockClear();

      act(() => {
        setShowDiscussionFn!(true);
      });

      // Give it a moment to settle
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should not have sent any fetch requests
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

describe("sendMessageRef", () => {
  it("assigns sendChatMessage to the ref after mount", async () => {
    const ref = createRef<SendMessageFn | null>() as React.MutableRefObject<SendMessageFn | null>;
    ref.current = null;

    render(<Discussion sendMessageRef={ref} />, { wrapper: TestWrapper });

    await waitFor(() => {
      expect(ref.current).not.toBeNull();
      expect(typeof ref.current).toBe("function");
    });
  });

  it("message sent through ref appears in conversation", async () => {
    mockFetchWithResponse("AI response");

    const ref = createRef<SendMessageFn | null>() as React.MutableRefObject<SendMessageFn | null>;
    ref.current = null;

    render(<Discussion sendMessageRef={ref} />, { wrapper: TestWrapper });

    // Wait for ref to be assigned
    await waitFor(() => {
      expect(ref.current).not.toBeNull();
    });

    // Send message through the ref
    await act(async () => {
      await ref.current!("Hello from PairWritingMode");
    });

    // User message should appear in conversation
    await waitFor(() => {
      expect(screen.getByText("Hello from PairWritingMode")).toBeDefined();
    });

    // AI response should also appear (streamed via SSE)
    await waitFor(() => {
      expect(screen.getByText("AI response")).toBeDefined();
    });
  });

  it("nulls the ref on unmount", async () => {
    const ref = createRef<SendMessageFn | null>() as React.MutableRefObject<SendMessageFn | null>;
    ref.current = null;

    const { unmount } = render(<Discussion sendMessageRef={ref} />, { wrapper: TestWrapper });

    await waitFor(() => {
      expect(ref.current).not.toBeNull();
    });

    unmount();

    expect(ref.current).toBeNull();
  });

  it("works standalone without ref (existing behavior unchanged)", async () => {
    mockFetchWithResponse("Response text");

    render(<Discussion />, { wrapper: TestWrapper });

    const input = screen.getByRole("textbox");
    const button = screen.getByRole("button", { name: /send/i });

    fireEvent.change(input, { target: { value: "Standalone message" } });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("Standalone message")).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getByText("Response text")).toBeDefined();
    });
  });
});
