/**
 * Tests for Discussion component
 *
 * Tests message display, submission, streaming, and slash commands.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Discussion } from "../Discussion";
import { SessionProvider } from "../../contexts/SessionContext";
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
});

afterEach(() => {
  cleanup();
  globalThis.WebSocket = originalWebSocket;
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

    it("submits on Enter key", async () => {
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
});
