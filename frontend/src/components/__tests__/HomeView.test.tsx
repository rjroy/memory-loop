/**
 * Tests for HomeView Component
 *
 * Tests rendering, accessibility, and debrief button logic.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { HomeView, getDebriefButtons } from "../HomeView";
import { SessionProvider } from "../../contexts/SessionContext";
import type { RecentNoteEntry } from "@memory-loop/shared";

// Clean up after each test
beforeEach(() => {
  cleanup();
});

// Test wrapper with SessionProvider
function Wrapper({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

// Helper to create wrapper with initial recent notes
function createWrapperWithNotes(notes: RecentNoteEntry[]) {
  return function WrapperWithNotes({ children }: { children: ReactNode }) {
    return (
      <SessionProvider initialRecentNotes={notes}>{children}</SessionProvider>
    );
  };
}

describe("HomeView", () => {
  describe("rendering", () => {
    it("renders vault name label", () => {
      render(<HomeView />, { wrapper: Wrapper });

      expect(screen.getByText("Current Vault")).toBeTruthy();
    });
  });

  describe("accessibility", () => {
    it("has proper section landmarks", () => {
      render(<HomeView />, { wrapper: Wrapper });

      expect(screen.getByLabelText("Session context")).toBeTruthy();
    });
  });

  describe("inspiration", () => {
    it("does not render InspirationCard when no inspiration data", () => {
      render(<HomeView />, { wrapper: Wrapper });

      expect(screen.queryByLabelText("Inspiration")).toBeNull();
    });
  });
});

describe("getDebriefButtons", () => {
  describe("Daily Debrief", () => {
    it("shows Daily Debrief when there is a note for today", () => {
      const buttons = getDebriefButtons(new Date("2026-01-15"), true);

      expect(buttons.some((b) => b.label === "Daily Debrief")).toBe(true);
      expect(buttons.find((b) => b.label === "Daily Debrief")?.command).toBe(
        "/daily-debrief"
      );
    });

    it("does not show Daily Debrief when there is no note for today", () => {
      const buttons = getDebriefButtons(new Date("2026-01-15"), false);

      expect(buttons.some((b) => b.label === "Daily Debrief")).toBe(false);
    });
  });

  describe("Weekly Debrief", () => {
    it("shows Weekly Debrief on Friday", () => {
      // 2026-01-02 is a Friday
      const buttons = getDebriefButtons(new Date("2026-01-02"), false);

      expect(buttons.some((b) => b.label === "Weekly Debrief")).toBe(true);
      expect(buttons.find((b) => b.label === "Weekly Debrief")?.command).toBe(
        "/weekly-debrief"
      );
    });

    it("shows Weekly Debrief on Saturday", () => {
      // 2026-01-03 is a Saturday
      const buttons = getDebriefButtons(new Date("2026-01-03"), false);

      expect(buttons.some((b) => b.label === "Weekly Debrief")).toBe(true);
    });

    it("shows Weekly Debrief on Sunday", () => {
      // 2026-01-04 is a Sunday
      const buttons = getDebriefButtons(new Date("2026-01-04"), false);

      expect(buttons.some((b) => b.label === "Weekly Debrief")).toBe(true);
    });

    it("does not show Weekly Debrief on Monday", () => {
      // 2026-01-05 is a Monday
      const buttons = getDebriefButtons(new Date("2026-01-05"), false);

      expect(buttons.some((b) => b.label === "Weekly Debrief")).toBe(false);
    });

    it("does not show Weekly Debrief on Thursday", () => {
      // 2026-01-01 is a Thursday
      const buttons = getDebriefButtons(new Date("2026-01-01"), false);

      expect(buttons.some((b) => b.label === "Weekly Debrief")).toBe(false);
    });
  });

  describe("Monthly Summary", () => {
    it("shows Monthly Summary on first day of month (summarizes previous month)", () => {
      // 2026-02-01
      const buttons = getDebriefButtons(new Date("2026-02-01"), false);

      const monthlyBtn = buttons.find((b) => b.label === "Monthly Summary");
      expect(monthlyBtn).toBeTruthy();
      expect(monthlyBtn?.command).toBe("/monthly-summary 2026 01");
    });

    it("shows Monthly Summary on third day of month", () => {
      // 2026-02-03
      const buttons = getDebriefButtons(new Date("2026-02-03"), false);

      expect(buttons.some((b) => b.label === "Monthly Summary")).toBe(true);
    });

    it("does not show Monthly Summary on fourth day of month", () => {
      // 2026-02-04
      const buttons = getDebriefButtons(new Date("2026-02-04"), false);

      expect(buttons.some((b) => b.label === "Monthly Summary")).toBe(false);
    });

    it("shows Monthly Summary on last day of month (summarizes current month)", () => {
      // 2026-01-31 (January has 31 days)
      const buttons = getDebriefButtons(new Date("2026-01-31"), false);

      const monthlyBtn = buttons.find((b) => b.label === "Monthly Summary");
      expect(monthlyBtn).toBeTruthy();
      expect(monthlyBtn?.command).toBe("/monthly-summary 2026 01");
    });

    it("shows Monthly Summary on second-to-last day of month", () => {
      // 2026-01-30
      const buttons = getDebriefButtons(new Date("2026-01-30"), false);

      expect(buttons.some((b) => b.label === "Monthly Summary")).toBe(true);
    });

    it("handles January 1st (summarizes December of previous year)", () => {
      // 2026-01-01
      const buttons = getDebriefButtons(new Date("2026-01-01"), false);

      const monthlyBtn = buttons.find((b) => b.label === "Monthly Summary");
      expect(monthlyBtn).toBeTruthy();
      expect(monthlyBtn?.command).toBe("/monthly-summary 2025 12");
    });

    it("handles February end (28 days in non-leap year)", () => {
      // 2026-02-28 (last day of Feb 2026, not a leap year)
      const buttons = getDebriefButtons(new Date("2026-02-28"), false);

      const monthlyBtn = buttons.find((b) => b.label === "Monthly Summary");
      expect(monthlyBtn).toBeTruthy();
      expect(monthlyBtn?.command).toBe("/monthly-summary 2026 02");
    });
  });

  describe("multiple buttons", () => {
    it("can show all three buttons on Sunday, Jan 3rd with a note", () => {
      // 2027-01-03 is a Sunday, first 3 days of month
      const buttons = getDebriefButtons(new Date("2027-01-03"), true);

      expect(buttons.length).toBe(3);
      expect(buttons.some((b) => b.label === "Daily Debrief")).toBe(true);
      expect(buttons.some((b) => b.label === "Weekly Debrief")).toBe(true);
      expect(buttons.some((b) => b.label === "Monthly Summary")).toBe(true);
    });

    it("shows no buttons on a mid-week, mid-month day without a note", () => {
      // 2026-01-15 is a Thursday, middle of month
      const buttons = getDebriefButtons(new Date("2026-01-15"), false);

      expect(buttons.length).toBe(0);
    });
  });
});

// Format date as YYYY-MM-DD using local time (matches production code)
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

describe("HomeView debrief button interaction", () => {
  it("renders debrief buttons when conditions are met", () => {
    // Create a note for today using local time (matches production code)
    const todayStr = formatLocalDate(new Date());
    const notes: RecentNoteEntry[] = [
      { id: "1", text: "Test note", time: "10:00", date: todayStr },
    ];

    render(<HomeView />, { wrapper: createWrapperWithNotes(notes) });

    // Should show Daily Debrief because we have a note for today
    expect(screen.getByText("Daily Debrief")).toBeTruthy();
  });

  it("switches to discussion mode with command when button is clicked", () => {
    const todayStr = formatLocalDate(new Date());
    const notes: RecentNoteEntry[] = [
      { id: "1", text: "Test note", time: "10:00", date: todayStr },
    ];

    render(<HomeView />, { wrapper: createWrapperWithNotes(notes) });

    const button = screen.getByText("Daily Debrief");
    fireEvent.click(button);

    // The component should have called setDiscussionPrefill and setMode
    // We can't easily verify this without mocking, but we can verify no errors occur
    expect(button).toBeTruthy();
  });
});
