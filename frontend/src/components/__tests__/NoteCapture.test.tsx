/**
 * Tests for NoteCapture component
 *
 * Tests input, localStorage persistence, submission, and feedback.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { NoteCapture } from "../NoteCapture";
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

// Wrapper with providers - vault is pre-selected via localStorage
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

  // Pre-select vault via localStorage (SessionProvider will load this)
  localStorage.setItem("memory-loop:vaultId", "vault-1");

  // @ts-expect-error - mocking WebSocket
  globalThis.WebSocket = MockWebSocket;
});

afterEach(() => {
  cleanup();
  globalThis.WebSocket = originalWebSocket;
});

describe("NoteCapture", () => {
  describe("rendering", () => {
    it("renders textarea and submit button", async () => {
      render(<NoteCapture />, { wrapper: TestWrapper });

      // Wait for WebSocket to connect
      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      expect(screen.getByRole("textbox")).toBeDefined();
      expect(screen.getByRole("button", { name: /capture note/i })).toBeDefined();
    });

    it("has proper accessibility attributes", async () => {
      render(<NoteCapture />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const textarea = screen.getByRole("textbox");
      expect(textarea.getAttribute("aria-label")).toBe("Note content");
    });

    it("shows placeholder text", async () => {
      render(<NoteCapture />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      expect(screen.getByPlaceholderText("What's on your mind?")).toBeDefined();
    });
  });

  describe("input behavior", () => {
    it("updates content on typing", async () => {
      render(<NoteCapture />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Test note content" } });

      expect(textarea.value).toBe("Test note content");
    });

    it("saves draft to localStorage on change", async () => {
      render(<NoteCapture />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Draft content" } });

      await waitFor(() => {
        expect(localStorage.getItem("memory-loop-draft")).toBe("Draft content");
      });
    });

    it("loads draft from localStorage on mount", async () => {
      localStorage.setItem("memory-loop-draft", "Saved draft");

      render(<NoteCapture />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const textarea = screen.getByRole("textbox");
      expect(textarea.value).toBe("Saved draft");
    });
  });

  describe("submission", () => {
    it("sends capture_note message on submit", async () => {
      render(<NoteCapture />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const textarea = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /capture note/i });

      fireEvent.change(textarea, { target: { value: "My note" } });
      fireEvent.click(button);

      await waitFor(() => {
        expect(sentMessages).toContainEqual({
          type: "capture_note",
          text: "My note",
        });
      });
    });

    it("shows 'Saving...' while submitting", async () => {
      render(<NoteCapture />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const textarea = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /capture note/i });

      fireEvent.change(textarea, { target: { value: "My note" } });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /saving/i })).toBeDefined();
      });
    });

    it("disables button when input is empty", async () => {
      render(<NoteCapture />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const button = screen.getByRole("button", { name: /capture note/i });
      expect(button.hasAttribute("disabled")).toBe(true);
    });

    it("disables button when submitting", async () => {
      render(<NoteCapture />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const textarea = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /capture note/i });

      fireEvent.change(textarea, { target: { value: "My note" } });
      fireEvent.click(button);

      await waitFor(() => {
        expect(button.hasAttribute("disabled")).toBe(true);
      });
    });
  });

  describe("success feedback", () => {
    it("shows success toast on note_captured", async () => {
      render(<NoteCapture />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const textarea = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /capture note/i });

      fireEvent.change(textarea, { target: { value: "My note" } });
      fireEvent.click(button);

      // Wait for message to be sent
      await waitFor(() => {
        expect(sentMessages.length).toBeGreaterThan(0);
      });

      // Simulate server response
      const ws = wsInstances[0];
      ws.simulateMessage({
        type: "note_captured",
        timestamp: "12:34:56",
      });

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeDefined();
        expect(screen.getByText(/Note saved at 12:34:56/)).toBeDefined();
      });
    });

    it("clears input after successful capture", async () => {
      render(<NoteCapture />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const textarea = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /capture note/i });

      fireEvent.change(textarea, { target: { value: "My note" } });
      fireEvent.click(button);

      // Wait for message to be sent
      await waitFor(() => {
        expect(sentMessages.length).toBeGreaterThan(0);
      });

      // Simulate server response
      const ws = wsInstances[0];
      ws.simulateMessage({
        type: "note_captured",
        timestamp: "12:34:56",
      });

      await waitFor(() => {
        expect(textarea.value).toBe("");
      });
    });

    it("clears localStorage after successful capture", async () => {
      render(<NoteCapture />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(wsInstances.length).toBeGreaterThan(0);
      });

      const textarea = screen.getByRole("textbox");
      const button = screen.getByRole("button", { name: /capture note/i });

      fireEvent.change(textarea, { target: { value: "My note" } });

      await waitFor(() => {
        expect(localStorage.getItem("memory-loop-draft")).toBe("My note");
      });

      fireEvent.click(button);

      // Wait for message to be sent
      await waitFor(() => {
        expect(sentMessages.length).toBeGreaterThan(0);
      });

      // Simulate server response
      const ws = wsInstances[0];
      ws.simulateMessage({
        type: "note_captured",
        timestamp: "12:34:56",
      });

      await waitFor(() => {
        expect(localStorage.getItem("memory-loop-draft")).toBeNull();
      });
    });
  });
});
