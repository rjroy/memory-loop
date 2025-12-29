/**
 * Tests for RecentActivity component
 *
 * Tests rendering of captures and discussions, click handlers, and date formatting.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { RecentActivity } from "../RecentActivity";
import { SessionProvider, useSession } from "../../contexts/SessionContext";
import type { VaultInfo, RecentNoteEntry, RecentDiscussionEntry } from "@memory-loop/shared";

// Helper component to capture context state changes
let capturedMode: string | null = null;
let capturedPendingSessionId: string | null = null;

function ContextCapture(): null {
  const { mode, pendingSessionId } = useSession();
  capturedMode = mode;
  capturedPendingSessionId = pendingSessionId;
  return null;
}

// Test data
const testVault: VaultInfo = {
  id: "vault-1",
  name: "Test Vault",
  path: "/test/vault",
  hasClaudeMd: true,
  inboxPath: "/test/vault/inbox",
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

beforeEach(() => {
  localStorage.clear();
  // Reset captured context values
  capturedMode = null;
  capturedPendingSessionId = null;
  // Don't pre-select vault for these tests - we want to test RecentActivity
  // rendering with data, not vault selection behavior
});

afterEach(() => {
  cleanup();
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

    it("sets pendingSessionId and mode when no custom handler", () => {
      render(<RecentActivity />, {
        wrapper: createTestWrapper([], mockDiscussions, true),
      });

      const resumeButtons = screen.getAllByRole("button", { name: /resume discussion/i });
      fireEvent.click(resumeButtons[0]);

      // Verify context state was updated
      expect(capturedPendingSessionId).toBe("session-1");
      expect(capturedMode).toBe("discussion");
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
});
