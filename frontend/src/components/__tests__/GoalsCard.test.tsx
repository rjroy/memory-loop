/**
 * Tests for GoalsCard component
 *
 * Tests rendering of goals, separation of incomplete/completed, and accessibility.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { GoalsCard } from "../GoalsCard";
import { SessionProvider } from "../../contexts/SessionContext";
import type { GoalItem } from "@memory-loop/shared";

// Test data
const mockGoals: GoalItem[] = [
  { text: "Learn TypeScript", completed: false },
  { text: "Build a web app", completed: false },
  { text: "Set up project", completed: true },
];

// Wrapper with providers
function createTestWrapper(goals: GoalItem[] | null) {
  return function TestWrapper({ children }: { children: ReactNode }) {
    return (
      <SessionProvider initialGoals={goals}>
        {children}
      </SessionProvider>
    );
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("GoalsCard", () => {
  describe("rendering", () => {
    it("renders nothing when goals is null", () => {
      const { container } = render(<GoalsCard />, {
        wrapper: createTestWrapper(null),
      });

      expect(container.firstChild).toBeNull();
    });

    it("renders nothing when goals array is empty", () => {
      const { container } = render(<GoalsCard />, {
        wrapper: createTestWrapper([]),
      });

      expect(container.firstChild).toBeNull();
    });

    it("renders goals section with heading", () => {
      render(<GoalsCard />, {
        wrapper: createTestWrapper(mockGoals),
      });

      expect(screen.getByRole("region", { name: "Goals" })).toBeDefined();
      expect(screen.getByText("Goals")).toBeDefined();
    });

    it("renders all goal texts", () => {
      render(<GoalsCard />, {
        wrapper: createTestWrapper(mockGoals),
      });

      expect(screen.getByText("Learn TypeScript")).toBeDefined();
      expect(screen.getByText("Build a web app")).toBeDefined();
      expect(screen.getByText("Set up project")).toBeDefined();
    });
  });

  describe("goal ordering", () => {
    it("renders incomplete goals before completed goals", () => {
      render(<GoalsCard />, {
        wrapper: createTestWrapper(mockGoals),
      });

      const listItems = screen.getAllByRole("listitem");
      expect(listItems).toHaveLength(3);

      // First two should be incomplete
      expect(listItems[0].getAttribute("aria-label")).toContain("Incomplete");
      expect(listItems[1].getAttribute("aria-label")).toContain("Incomplete");
      // Last should be completed
      expect(listItems[2].getAttribute("aria-label")).toContain("Completed");
    });

    it("handles all incomplete goals", () => {
      const incompleteOnly: GoalItem[] = [
        { text: "Task 1", completed: false },
        { text: "Task 2", completed: false },
      ];

      render(<GoalsCard />, {
        wrapper: createTestWrapper(incompleteOnly),
      });

      const listItems = screen.getAllByRole("listitem");
      expect(listItems).toHaveLength(2);
      expect(listItems[0].getAttribute("aria-label")).toContain("Incomplete");
      expect(listItems[1].getAttribute("aria-label")).toContain("Incomplete");
    });

    it("handles all completed goals", () => {
      const completedOnly: GoalItem[] = [
        { text: "Done 1", completed: true },
        { text: "Done 2", completed: true },
      ];

      render(<GoalsCard />, {
        wrapper: createTestWrapper(completedOnly),
      });

      const listItems = screen.getAllByRole("listitem");
      expect(listItems).toHaveLength(2);
      expect(listItems[0].getAttribute("aria-label")).toContain("Completed");
      expect(listItems[1].getAttribute("aria-label")).toContain("Completed");
    });
  });

  describe("accessibility", () => {
    it("has accessible section with aria-label", () => {
      render(<GoalsCard />, {
        wrapper: createTestWrapper(mockGoals),
      });

      const section = screen.getByRole("region", { name: "Goals" });
      expect(section).toBeDefined();
    });

    it("has aria-labels on list items indicating completion status", () => {
      render(<GoalsCard />, {
        wrapper: createTestWrapper(mockGoals),
      });

      // Check incomplete goals have correct aria-label
      const incompleteItem = screen.getByLabelText("Incomplete: Learn TypeScript");
      expect(incompleteItem).toBeDefined();

      // Check completed goals have correct aria-label
      const completedItem = screen.getByLabelText("Completed: Set up project");
      expect(completedItem).toBeDefined();
    });

    it("hides visual checkboxes from screen readers", () => {
      render(<GoalsCard />, {
        wrapper: createTestWrapper(mockGoals),
      });

      // The checkbox symbols should have aria-hidden
      const checkboxes = document.querySelectorAll('[aria-hidden="true"]');
      expect(checkboxes.length).toBeGreaterThan(0);
    });
  });

  describe("visual indicators", () => {
    it("applies completed modifier class to completed goals", () => {
      render(<GoalsCard />, {
        wrapper: createTestWrapper(mockGoals),
      });

      const completedItem = screen.getByLabelText("Completed: Set up project");
      expect(completedItem.className).toContain("goals-card__item--completed");
    });

    it("does not apply completed modifier to incomplete goals", () => {
      render(<GoalsCard />, {
        wrapper: createTestWrapper(mockGoals),
      });

      const incompleteItem = screen.getByLabelText("Incomplete: Learn TypeScript");
      expect(incompleteItem.className).not.toContain("goals-card__item--completed");
    });
  });
});
