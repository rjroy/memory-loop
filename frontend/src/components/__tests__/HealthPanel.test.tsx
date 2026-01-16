/**
 * Tests for HealthPanel component
 *
 * Tests rendering of health issues, expand/collapse behavior, and dismiss functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { HealthPanel } from "../HealthPanel";
import { SessionProvider } from "../../contexts/SessionContext";
import type { HealthIssue, ClientMessage, ServerMessage, VaultInfo } from "@memory-loop/shared";

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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_url: string) {
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
  contentRoot: "/test/vault",
  inboxPath: "inbox",
  metadataPath: "06_Metadata/memory-loop",
  attachmentPath: "05_Attachments",
  setupComplete: false,
  hasSyncConfig: false,
  promptsPerGeneration: 5,
  maxPoolSize: 50,
  quotesPerWeek: 1,
  badges: [],
  order: 999999,
};

beforeEach(() => {
  wsInstances = [];
  sentMessages = [];
  localStorage.clear();
  // Note: We intentionally do NOT set localStorage vault ID here.
  // Setting it would trigger SELECT_VAULT action which resets health state,
  // overwriting the initialHealthIssues we pass to SessionProvider.
  // @ts-expect-error - mocking WebSocket
  globalThis.WebSocket = MockWebSocket;
});

afterEach(() => {
  cleanup();
  globalThis.WebSocket = originalWebSocket;
});

// Helper to create test issues
function createTestIssue(overrides: Partial<HealthIssue> = {}): HealthIssue {
  return {
    id: "test-issue-1",
    severity: "error",
    category: "widget_config",
    message: "Test error message",
    timestamp: new Date().toISOString(),
    dismissible: true,
    ...overrides,
  };
}

// Wrapper with providers
function createTestWrapper(issues: HealthIssue[], isExpanded = false) {
  return function TestWrapper({ children }: { children: ReactNode }) {
    return (
      <SessionProvider
        initialVaults={[testVault]}
        initialHealthIssues={issues}
        initialHealthExpanded={isExpanded}
      >
        {children}
      </SessionProvider>
    );
  };
}

describe("HealthPanel", () => {
  describe("rendering", () => {
    it("renders nothing when there are no issues", () => {
      const { container } = render(<HealthPanel />, {
        wrapper: createTestWrapper([]),
      });

      expect(container.firstChild).toBeNull();
    });

    it("renders panel when issues exist", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([createTestIssue()]),
      });

      expect(screen.getByRole("region", { name: "Backend health issues" })).toBeDefined();
    });

    it("shows error count in header", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([createTestIssue({ severity: "error" })]),
      });

      expect(screen.getByText(/1 error/)).toBeDefined();
    });

    it("shows warning count in header", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([createTestIssue({ severity: "warning" })]),
      });

      expect(screen.getByText(/1 warning/)).toBeDefined();
    });

    it("shows both error and warning counts", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([
          createTestIssue({ id: "error-1", severity: "error" }),
          createTestIssue({ id: "warning-1", severity: "warning" }),
        ]),
      });

      expect(screen.getByText(/1 error, 1 warning/)).toBeDefined();
    });

    it("pluralizes counts correctly", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([
          createTestIssue({ id: "error-1", severity: "error" }),
          createTestIssue({ id: "error-2", severity: "error" }),
        ]),
      });

      expect(screen.getByText(/2 errors/)).toBeDefined();
    });
  });

  describe("expand/collapse", () => {
    it("is collapsed by default", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([createTestIssue()]),
      });

      const headerButton = screen.getByRole("button", { name: /Issues/ });
      expect(headerButton.getAttribute("aria-expanded")).toBe("false");
    });

    it("does not show issue list when collapsed", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([createTestIssue()]),
      });

      expect(screen.queryByRole("list")).toBeNull();
    });

    it("toggles expansion on header click", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([createTestIssue()]),
      });

      const headerButton = screen.getByRole("button", { name: /Issues/ });
      act(() => {
        fireEvent.click(headerButton);
      });

      expect(headerButton.getAttribute("aria-expanded")).toBe("true");
    });

    it("shows issue list when expanded", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([createTestIssue()], true),
      });

      expect(screen.getByRole("list")).toBeDefined();
    });
  });

  describe("issue display", () => {
    it("shows issue message", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([createTestIssue({ message: "Widget failed to load" })], true),
      });

      expect(screen.getByText("Widget failed to load")).toBeDefined();
    });

    it("shows issue details when present", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper(
          [createTestIssue({ details: "/path/to/config.yaml: invalid syntax" })],
          true
        ),
      });

      expect(screen.getByText("/path/to/config.yaml: invalid syntax")).toBeDefined();
    });

    it("shows severity label", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([createTestIssue({ severity: "error" })], true),
      });

      expect(screen.getByText("Error")).toBeDefined();
    });

    it("shows category label", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([createTestIssue({ category: "widget_config" })], true),
      });

      expect(screen.getByText("Widget Config")).toBeDefined();
    });

    it("renders multiple issues", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper(
          [
            createTestIssue({ id: "issue-1", message: "First error" }),
            createTestIssue({ id: "issue-2", message: "Second error" }),
          ],
          true
        ),
      });

      expect(screen.getByText("First error")).toBeDefined();
      expect(screen.getByText("Second error")).toBeDefined();
    });
  });

  describe("dismiss functionality", () => {
    it("shows dismiss button for dismissible issues", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([createTestIssue({ dismissible: true })], true),
      });

      expect(screen.getByRole("button", { name: /Dismiss/ })).toBeDefined();
    });

    it("hides dismiss button for non-dismissible issues", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([createTestIssue({ dismissible: false })], true),
      });

      expect(screen.queryByRole("button", { name: /Dismiss/ })).toBeNull();
    });

    it("sends dismiss message on click", async () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper(
          [createTestIssue({ id: "dismiss-me", dismissible: true })],
          true
        ),
      });

      // Wait for WebSocket to connect
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      const dismissButton = screen.getByRole("button", { name: /Dismiss/ });
      act(() => {
        fireEvent.click(dismissButton);
      });

      // The dismiss_health_issue message should be sent
      const dismissMessage = sentMessages.find((m) => m.type === "dismiss_health_issue");
      expect(dismissMessage).toBeDefined();
      expect((dismissMessage as { issueId: string }).issueId).toBe("dismiss-me");
    });
  });

  describe("category labels", () => {
    const categories: Array<[HealthIssue["category"], string]> = [
      ["widget_config", "Widget Config"],
      ["widget_compute", "Widget Compute"],
      ["vault_config", "Vault Config"],
      ["file_watcher", "File Watcher"],
      ["cache", "Cache"],
      ["general", "General"],
    ];

    for (const [category, expectedLabel] of categories) {
      it(`maps ${category} to "${expectedLabel}"`, () => {
        render(<HealthPanel />, {
          wrapper: createTestWrapper([createTestIssue({ category })], true),
        });

        expect(screen.getByText(expectedLabel)).toBeDefined();
      });
    }
  });

  describe("accessibility", () => {
    it("has aria-label on section", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([createTestIssue()]),
      });

      expect(screen.getByRole("region", { name: "Backend health issues" })).toBeDefined();
    });

    it("has aria-expanded on header button", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([createTestIssue()]),
      });

      const headerButton = screen.getByRole("button", { name: /Issues/ });
      expect(headerButton.hasAttribute("aria-expanded")).toBe(true);
    });

    it("has aria-controls linking header to content", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([createTestIssue()], true),
      });

      const headerButton = screen.getByRole("button", { name: /Issues/ });
      const list = screen.getByRole("list");

      expect(headerButton.getAttribute("aria-controls")).toBe(list.id);
    });

    it("has aria-label on dismiss buttons", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper(
          [createTestIssue({ message: "Widget error", dismissible: true })],
          true
        ),
      });

      expect(screen.getByRole("button", { name: "Dismiss: Widget error" })).toBeDefined();
    });
  });

  describe("visual indicators", () => {
    it("applies error class for error severity", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([createTestIssue({ severity: "error" })], true),
      });

      const listItem = screen.getByRole("listitem");
      expect(listItem.className).toContain("health-panel__item--error");
    });

    it("applies warning class for warning severity", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([createTestIssue({ severity: "warning" })], true),
      });

      const listItem = screen.getByRole("listitem");
      expect(listItem.className).toContain("health-panel__item--warning");
    });

    it("applies has-errors class to panel when errors present", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([createTestIssue({ severity: "error" })]),
      });

      const panel = screen.getByRole("region");
      expect(panel.className).toContain("health-panel--has-errors");
    });

    it("does not apply has-errors class for warnings only", () => {
      render(<HealthPanel />, {
        wrapper: createTestWrapper([createTestIssue({ severity: "warning" })]),
      });

      const panel = screen.getByRole("region");
      expect(panel.className).not.toContain("health-panel--has-errors");
    });
  });
});
