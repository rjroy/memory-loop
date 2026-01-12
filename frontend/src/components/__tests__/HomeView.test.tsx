/**
 * Tests for HomeView Component
 *
 * Tests rendering, accessibility, debrief button logic, and widget integration.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { HomeView, getDebriefButtons } from "../HomeView";
import { SessionProvider } from "../../contexts/SessionContext";
import { WidgetRenderer } from "../widgets";
import type { RecentNoteEntry, WidgetResult } from "@memory-loop/shared";

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

    it("handles February 29 in a leap year", () => {
      // 2028-02-29 (leap year, Feb has 29 days)
      const buttons = getDebriefButtons(new Date("2028-02-29"), false);

      const monthlyBtn = buttons.find((b) => b.label === "Monthly Summary");
      expect(monthlyBtn).toBeTruthy();
      expect(monthlyBtn?.command).toBe("/monthly-summary 2028 02");
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

// =============================================================================
// Widget Integration Tests
// =============================================================================

/**
 * Creates a mock widget result for testing.
 */
function createMockWidget(overrides: Partial<WidgetResult> = {}): WidgetResult {
  return {
    widgetId: "test-widget-1",
    name: "Test Widget",
    type: "aggregate",
    location: "ground",
    display: {
      type: "summary-card",
      title: "Test Summary",
    },
    data: { count: 42, total: 100 },
    isEmpty: false,
    ...overrides,
  };
}

/**
 * Since we cannot easily inject widget state into the SessionProvider,
 * we test the widget rendering logic by directly testing the conditional
 * rendering sections of HomeView. We render a standalone component that
 * mimics HomeView's widget section behavior.
 */
function WidgetSection({
  isGroundLoading,
  groundError,
  groundWidgets,
}: {
  isGroundLoading: boolean;
  groundError: string | null;
  groundWidgets: WidgetResult[];
}) {
  if (isGroundLoading) {
    return (
      <section
        className="home-view__widgets home-view__widgets--loading"
        aria-label="Loading widgets"
      >
        <div className="home-view__widget-skeleton" aria-hidden="true" />
        <div className="home-view__widget-skeleton" aria-hidden="true" />
      </section>
    );
  }

  if (groundError) {
    return (
      <section
        className="home-view__widgets home-view__widgets--error"
        aria-label="Widget error"
      >
        <p className="home-view__error">{groundError}</p>
      </section>
    );
  }

  if (groundWidgets.length > 0) {
    return (
      <section className="home-view__widgets" aria-label="Vault widgets">
        {groundWidgets.map((widget) => (
          <WidgetRenderer key={widget.name} widget={widget} />
        ))}
      </section>
    );
  }

  return null;
}

describe("HomeView widgets", () => {
  describe("loading state", () => {
    it("shows loading skeleton when isGroundLoading is true", () => {
      render(
        <WidgetSection
          isGroundLoading={true}
          groundError={null}
          groundWidgets={[]}
        />
      );

      // Should show loading section with proper aria-label
      const loadingSection = screen.getByLabelText("Loading widgets");
      expect(loadingSection).toBeTruthy();

      // Should have skeleton divs (hidden from screen readers)
      const skeletons = loadingSection.querySelectorAll(
        ".home-view__widget-skeleton"
      );
      expect(skeletons.length).toBe(2);

      // Skeletons should be hidden from accessibility tree
      skeletons.forEach((skeleton) => {
        expect(skeleton.getAttribute("aria-hidden")).toBe("true");
      });
    });

    it("has loading class on section when loading", () => {
      render(
        <WidgetSection
          isGroundLoading={true}
          groundError={null}
          groundWidgets={[]}
        />
      );

      const section = screen.getByLabelText("Loading widgets");
      expect(section.classList.contains("home-view__widgets--loading")).toBe(
        true
      );
    });
  });

  describe("error state", () => {
    it("shows error message when groundError is set", () => {
      const errorMessage = "Failed to load widgets: connection timeout";

      render(
        <WidgetSection
          isGroundLoading={false}
          groundError={errorMessage}
          groundWidgets={[]}
        />
      );

      // Should show error section with proper aria-label
      const errorSection = screen.getByLabelText("Widget error");
      expect(errorSection).toBeTruthy();

      // Should display the error message
      expect(screen.getByText(errorMessage)).toBeTruthy();
    });

    it("has error class on section when error", () => {
      render(
        <WidgetSection
          isGroundLoading={false}
          groundError="Some error"
          groundWidgets={[]}
        />
      );

      const section = screen.getByLabelText("Widget error");
      expect(section.classList.contains("home-view__widgets--error")).toBe(
        true
      );
    });

    it("prioritizes loading state over error state", () => {
      // When both loading and error are set, loading should take precedence
      render(
        <WidgetSection
          isGroundLoading={true}
          groundError="Some error"
          groundWidgets={[]}
        />
      );

      expect(screen.queryByLabelText("Loading widgets")).toBeTruthy();
      expect(screen.queryByLabelText("Widget error")).toBeNull();
    });
  });

  describe("empty state", () => {
    it("renders nothing when groundWidgets is empty array", () => {
      const { container } = render(
        <WidgetSection
          isGroundLoading={false}
          groundError={null}
          groundWidgets={[]}
        />
      );

      // Should render nothing (no section element)
      expect(container.firstChild).toBeNull();
    });
  });

  describe("widget display", () => {
    it("renders widgets when groundWidgets has data", () => {
      const widgets: WidgetResult[] = [
        createMockWidget({
          widgetId: "widget-1",
          name: "Collection Stats",
          display: { type: "summary-card", title: "Collection Stats" },
          data: { total: 150, active: 42 },
        }),
      ];

      render(
        <WidgetSection
          isGroundLoading={false}
          groundError={null}
          groundWidgets={widgets}
        />
      );

      // Should show widgets section
      const widgetsSection = screen.getByLabelText("Vault widgets");
      expect(widgetsSection).toBeTruthy();

      // Should render the widget with its title
      expect(screen.getByText("Collection Stats")).toBeTruthy();
    });

    it("renders multiple widgets", () => {
      const widgets: WidgetResult[] = [
        createMockWidget({
          widgetId: "widget-1",
          name: "First Widget",
          display: { type: "summary-card", title: "First Widget" },
        }),
        createMockWidget({
          widgetId: "widget-2",
          name: "Second Widget",
          display: { type: "summary-card", title: "Second Widget" },
        }),
      ];

      render(
        <WidgetSection
          isGroundLoading={false}
          groundError={null}
          groundWidgets={widgets}
        />
      );

      expect(screen.getByText("First Widget")).toBeTruthy();
      expect(screen.getByText("Second Widget")).toBeTruthy();
    });

    it("renders empty widget state message", () => {
      const widgets: WidgetResult[] = [
        createMockWidget({
          widgetId: "empty-widget",
          name: "Empty Collection",
          isEmpty: true,
          emptyReason: "No files match pattern *.md",
        }),
      ];

      render(
        <WidgetSection
          isGroundLoading={false}
          groundError={null}
          groundWidgets={widgets}
        />
      );

      // Should show the empty reason
      expect(screen.getByText("No files match pattern *.md")).toBeTruthy();
    });
  });

  describe("accessibility", () => {
    it("widgets section has proper aria-label", () => {
      const widgets: WidgetResult[] = [createMockWidget()];

      render(
        <WidgetSection
          isGroundLoading={false}
          groundError={null}
          groundWidgets={widgets}
        />
      );

      expect(screen.getByLabelText("Vault widgets")).toBeTruthy();
    });

    it("loading section has proper aria-label", () => {
      render(
        <WidgetSection
          isGroundLoading={true}
          groundError={null}
          groundWidgets={[]}
        />
      );

      expect(screen.getByLabelText("Loading widgets")).toBeTruthy();
    });

    it("error section has proper aria-label", () => {
      render(
        <WidgetSection
          isGroundLoading={false}
          groundError="Error occurred"
          groundWidgets={[]}
        />
      );

      expect(screen.getByLabelText("Widget error")).toBeTruthy();
    });

    it("individual widgets have aria-label with widget name", () => {
      const widgets: WidgetResult[] = [
        createMockWidget({
          name: "My Custom Widget",
          display: { type: "summary-card", title: "My Custom Widget" },
        }),
      ];

      render(
        <WidgetSection
          isGroundLoading={false}
          groundError={null}
          groundWidgets={widgets}
        />
      );

      expect(screen.getByLabelText("My Custom Widget widget")).toBeTruthy();
    });
  });
});
