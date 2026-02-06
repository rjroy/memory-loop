/**
 * Tests for RecentActivity component
 *
 * Tests rendering of captures and discussions, click handlers, and date formatting.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { RecentActivity } from "../RecentActivity";
import { SessionProvider, useSession } from "../../../contexts/SessionContext";
import type { VaultInfo, RecentNoteEntry, RecentDiscussionEntry } from "@memory-loop/shared";

import { useEffect } from "react";

// Helper component to capture context state changes
let capturedMode: string | null = null;
let capturedPendingSessionId: string | null = null;

function ContextCapture(): null {
  const { mode, pendingSessionId } = useSession();
  capturedMode = mode;
  capturedPendingSessionId = pendingSessionId;
  return null;
}

/**
 * Injects discussions into context after vault selection completes.
 * SELECT_VAULT resets recentDiscussions, so we must inject after.
 */
function DiscussionInjector({ discussions }: { discussions: RecentDiscussionEntry[] }): null {
  const { vault, setRecentDiscussions } = useSession();
  useEffect(() => {
    if (vault) {
      setRecentDiscussions(discussions);
    }
  }, [vault, discussions, setRecentDiscussions]);
  return null;
}

// Test data
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

const mockCaptures: RecentNoteEntry[] = [
  { id: "note-1", text: "First capture", time: "10:30", date: "2025-01-15" },
  { id: "note-2", text: "Second capture", time: "11:45", date: "2025-01-14" },
];

const mockDiscussions: RecentDiscussionEntry[] = [
  { sessionId: "session-1", preview: "How do I use this?", time: "09:00", date: "2025-01-15", messageCount: 5 },
  { sessionId: "session-2", preview: "Another question", time: "14:30", date: "2025-01-14", messageCount: 3 },
];

// Wrapper with providers - uses useEffect to set recent activity after mount
// to avoid the SELECT_VAULT action from clearing the initial values
function createTestWrapper(
  captures: RecentNoteEntry[] = [],
  discussions: RecentDiscussionEntry[] = [],
  includeContextCapture = false
) {
  return function TestWrapper({ children }: { children: ReactNode }) {
    return (
      <SessionProvider
        initialVaults={[testVault]}
        initialRecentNotes={captures}
        initialRecentDiscussions={discussions}
      >
        {includeContextCapture && <ContextCapture />}
        {children}
      </SessionProvider>
    );
  };
}

const originalFetch = globalThis.fetch;
const mockFetch = mock(() => Promise.resolve(new Response()));

beforeEach(() => {
  localStorage.clear();
  // Reset captured context values
  capturedMode = null;
  capturedPendingSessionId = null;
  // Don't pre-select vault for these tests - we want to test RecentActivity
  // rendering with data, not vault selection behavior
  mockFetch.mockReset();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

describe("RecentActivity", () => {
  describe("rendering", () => {
    it("renders nothing when no captures or discussions", () => {
      const { container } = render(<RecentActivity />, {
        wrapper: createTestWrapper([], []),
      });

      expect(container.firstChild).toBeNull();
    });

    it("renders captures section when captures exist", () => {
      render(<RecentActivity />, {
        wrapper: createTestWrapper(mockCaptures, []),
      });

      expect(screen.getByText("Recent: Captures")).toBeDefined();
      expect(screen.getByText("First capture")).toBeDefined();
      expect(screen.getByText("Second capture")).toBeDefined();
    });

    it("renders discussions section when discussions exist", () => {
      render(<RecentActivity />, {
        wrapper: createTestWrapper([], mockDiscussions),
      });

      expect(screen.getByText("Recent: Discussions")).toBeDefined();
      expect(screen.getByText("How do I use this?")).toBeDefined();
      expect(screen.getByText("Another question")).toBeDefined();
    });

    it("renders both sections when both exist", () => {
      render(<RecentActivity />, {
        wrapper: createTestWrapper(mockCaptures, mockDiscussions),
      });

      expect(screen.getByText("Recent: Captures")).toBeDefined();
      expect(screen.getByText("Recent: Discussions")).toBeDefined();
      expect(screen.getByText("First capture")).toBeDefined();
      expect(screen.getByText("How do I use this?")).toBeDefined();
    });

    it("displays time for all entries", () => {
      render(<RecentActivity />, {
        wrapper: createTestWrapper(mockCaptures, mockDiscussions),
      });

      expect(screen.getByText("10:30")).toBeDefined();
      expect(screen.getByText("11:45")).toBeDefined();
      expect(screen.getByText("09:00")).toBeDefined();
      expect(screen.getByText("14:30")).toBeDefined();
    });

    it("displays message count for discussions", () => {
      render(<RecentActivity />, {
        wrapper: createTestWrapper([], mockDiscussions),
      });

      expect(screen.getByText("5 messages")).toBeDefined();
      expect(screen.getByText("3 messages")).toBeDefined();
    });

    it("has proper accessibility attributes", () => {
      render(<RecentActivity />, {
        wrapper: createTestWrapper(mockCaptures, mockDiscussions),
      });

      expect(screen.getByRole("region", { name: /recent activity/i })).toBeDefined();
      expect(screen.getAllByRole("article")).toHaveLength(4);
    });
  });

  describe("relative date formatting", () => {
    it("shows 'Today' for today's date", () => {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

      const todayCaptures: RecentNoteEntry[] = [
        { id: "today-note", text: "Today's note", time: "12:00", date: todayStr },
      ];

      render(<RecentActivity />, {
        wrapper: createTestWrapper(todayCaptures, []),
      });

      // Today's notes should NOT show a date label (since it's "Today" which is hidden)
      // Check that the raw date is not displayed
      expect(screen.queryByText(todayStr)).toBeNull();
    });

    it("shows 'Yesterday' for yesterday's date", () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

      const yesterdayCaptures: RecentNoteEntry[] = [
        { id: "yesterday-note", text: "Yesterday's note", time: "12:00", date: yesterdayStr },
      ];

      render(<RecentActivity />, {
        wrapper: createTestWrapper(yesterdayCaptures, []),
      });

      expect(screen.getByText("Yesterday")).toBeDefined();
    });

    it("shows raw date for older dates", () => {
      const oldDate = "2024-06-15";
      const oldCaptures: RecentNoteEntry[] = [
        { id: "old-note", text: "Old note", time: "12:00", date: oldDate },
      ];

      render(<RecentActivity />, {
        wrapper: createTestWrapper(oldCaptures, []),
      });

      expect(screen.getByText("2024-06-15")).toBeDefined();
    });
  });

  describe("click handlers", () => {
    it("calls onViewCapture when View button is clicked", () => {
      const onViewCapture = mock(() => {});

      render(<RecentActivity onViewCapture={onViewCapture} />, {
        wrapper: createTestWrapper(mockCaptures, []),
      });

      const viewButtons = screen.getAllByRole("button", { name: /view note/i });
      fireEvent.click(viewButtons[0]);

      expect(onViewCapture).toHaveBeenCalledWith("2025-01-15");
    });

    it("calls onResumeDiscussion when Resume button is clicked", () => {
      const onResumeDiscussion = mock(() => {});

      render(<RecentActivity onResumeDiscussion={onResumeDiscussion} />, {
        wrapper: createTestWrapper([], mockDiscussions),
      });

      const resumeButtons = screen.getAllByRole("button", { name: /resume discussion/i });
      fireEvent.click(resumeButtons[0]);

      expect(onResumeDiscussion).toHaveBeenCalledWith("session-1");
    });

    it("loads session via REST and switches to discussion mode when no custom handler", async () => {
      // Mock the session init endpoint to return session data
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              sessionId: "session-1",
              vaultId: "vault-1",
              messages: [
                { id: "msg-1", role: "user", content: "Hello", timestamp: "2025-01-15T09:00:00Z" },
              ],
              slashCommands: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        )
      );

      // Persist vault ID so SessionProvider auto-selects it.
      // SELECT_VAULT resets recentDiscussions, so we inject them
      // after vault selection via DiscussionInjector.
      localStorage.setItem("memory-loop:vaultId", "vault-1");

      function Wrapper({ children }: { children: ReactNode }) {
        return (
          <SessionProvider initialVaults={[testVault]}>
            <DiscussionInjector discussions={mockDiscussions} />
            <ContextCapture />
            {children}
          </SessionProvider>
        );
      }

      render(<RecentActivity />, { wrapper: Wrapper });

      // Wait for discussions to be injected after vault selection
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: /resume discussion/i })).toHaveLength(2);
      });

      const resumeButtons = screen.getAllByRole("button", { name: /resume discussion/i });
      fireEvent.click(resumeButtons[0]);

      // Wait for async fetch to complete and context to update
      await waitFor(() => {
        expect(capturedMode).toBe("discussion");
      });

      // Verify the session init endpoint was called with the session ID
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
      expect(call[0]).toBe("/api/vaults/vault-1/sessions");
      const body = JSON.parse(call[1].body as string) as Record<string, unknown>;
      expect(body.sessionId).toBe("session-1");

      // pendingSessionId is set so useChat can use it for resume
      expect(capturedPendingSessionId).toBe("session-1");
    });
  });

  describe("View button behavior", () => {
    it("renders View button for each capture", () => {
      render(<RecentActivity />, {
        wrapper: createTestWrapper(mockCaptures, []),
      });

      const viewButtons = screen.getAllByRole("button", { name: /view note/i });
      expect(viewButtons).toHaveLength(2);
    });
  });

  describe("Resume button behavior", () => {
    it("renders Resume button for each discussion", () => {
      render(<RecentActivity />, {
        wrapper: createTestWrapper([], mockDiscussions),
      });

      const resumeButtons = screen.getAllByRole("button", { name: /resume discussion/i });
      expect(resumeButtons).toHaveLength(2);
    });

    it("Resume button has primary styling", () => {
      render(<RecentActivity />, {
        wrapper: createTestWrapper([], mockDiscussions),
      });

      const resumeButtons = screen.getAllByRole("button", { name: /resume discussion/i });
      expect(resumeButtons[0].className).toContain("primary");
    });
  });

  describe("Delete button behavior", () => {
    it("renders Delete button for each discussion", () => {
      render(<RecentActivity />, {
        wrapper: createTestWrapper([], mockDiscussions),
      });

      const deleteButtons = screen.getAllByRole("button", { name: /delete discussion/i });
      expect(deleteButtons).toHaveLength(2);
    });

    it("Delete button has danger styling", () => {
      render(<RecentActivity />, {
        wrapper: createTestWrapper([], mockDiscussions),
      });

      const deleteButtons = screen.getAllByRole("button", { name: /delete discussion/i });
      expect(deleteButtons[0].className).toContain("danger");
    });

    it("shows confirmation dialog when Delete is clicked", () => {
      render(<RecentActivity />, {
        wrapper: createTestWrapper([], mockDiscussions),
      });

      const deleteButtons = screen.getAllByRole("button", { name: /delete discussion/i });
      fireEvent.click(deleteButtons[0]);

      // Confirmation dialog should appear
      expect(screen.getByRole("dialog")).toBeDefined();
      expect(screen.getByText("Delete Session?")).toBeDefined();
      expect(screen.getByText(/this cannot be undone/i)).toBeDefined();
    });

    it("closes confirmation dialog when Cancel is clicked", () => {
      render(<RecentActivity />, {
        wrapper: createTestWrapper([], mockDiscussions),
      });

      // Open the dialog
      const deleteButtons = screen.getAllByRole("button", { name: /delete discussion/i });
      fireEvent.click(deleteButtons[0]);
      expect(screen.getByRole("dialog")).toBeDefined();

      // Click Cancel
      const cancelButton = screen.getByRole("button", { name: /cancel/i });
      fireEvent.click(cancelButton);

      // Dialog should be gone
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("calls onDeleteSession when confirm is clicked", () => {
      const onDeleteSession = mock(() => {});

      render(<RecentActivity onDeleteSession={onDeleteSession} />, {
        wrapper: createTestWrapper([], mockDiscussions),
      });

      // Open the dialog
      const deleteButtons = screen.getAllByRole("button", { name: /delete discussion/i });
      fireEvent.click(deleteButtons[0]);

      // Click Delete in the dialog
      const confirmButton = screen.getByRole("button", { name: /^delete$/i });
      fireEvent.click(confirmButton);

      expect(onDeleteSession).toHaveBeenCalledWith("session-1");
      // Dialog should also be closed
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("disables Delete button for currently active session", () => {
      // Create a wrapper that sets session-1 as the active session
      function ActiveSessionWrapper({ children }: { children: ReactNode }) {
        return (
          <SessionProvider
            initialVaults={[testVault]}
            initialRecentDiscussions={mockDiscussions}
            initialSessionId="session-1"
          >
            {children}
          </SessionProvider>
        );
      }

      render(<RecentActivity />, {
        wrapper: ActiveSessionWrapper,
      });

      const deleteButtons = screen.getAllByRole("button", { name: /cannot delete active session/i });
      expect(deleteButtons).toHaveLength(1);
      expect(deleteButtons[0].hasAttribute("disabled")).toBe(true);
    });
  });
});
