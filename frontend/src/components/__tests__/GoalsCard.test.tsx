/**
 * Tests for GoalsCard component
 *
 * Tests rendering of goal sections, items, and accessibility.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { GoalsCard } from "../GoalsCard";
import { SessionProvider } from "../../contexts/SessionContext";
import type { GoalSection } from "@memory-loop/shared";

// Test data
const mockSections: GoalSection[] = [
  {
    title: "Active",
    items: ["Learn TypeScript", "Build a web app"],
    hasMore: false,
  },
  {
    title: "Backlog",
    items: ["Set up project"],
    hasMore: false,
  },
];

// Wrapper with providers
function createTestWrapper(goals: GoalSection[] | null) {
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

    it("renders goals section with region", () => {
      render(<GoalsCard />, {
        wrapper: createTestWrapper(mockSections),
      });

      expect(screen.getByRole("region", { name: "Goals" })).toBeDefined();
    });

    it("renders section titles", () => {
      render(<GoalsCard />, {
        wrapper: createTestWrapper(mockSections),
      });

      expect(screen.getByText("Active")).toBeDefined();
      expect(screen.getByText("Backlog")).toBeDefined();
    });

    it("renders all item texts", () => {
      render(<GoalsCard />, {
        wrapper: createTestWrapper(mockSections),
      });

      expect(screen.getByText("Learn TypeScript")).toBeDefined();
      expect(screen.getByText("Build a web app")).toBeDefined();
      expect(screen.getByText("Set up project")).toBeDefined();
    });
  });

  describe("hasMore indicator", () => {
    it("shows ... when section has more items", () => {
      const sectionsWithMore: GoalSection[] = [
        {
          title: "Many Items",
          items: ["Item 1", "Item 2"],
          hasMore: true,
        },
      ];

      render(<GoalsCard />, {
        wrapper: createTestWrapper(sectionsWithMore),
      });

      expect(screen.getByText("...")).toBeDefined();
    });

    it("does not show ... when section has no more items", () => {
      render(<GoalsCard />, {
        wrapper: createTestWrapper(mockSections),
      });

      expect(screen.queryByText("...")).toBeNull();
    });
  });

  describe("accessibility", () => {
    it("has accessible section with aria-label", () => {
      render(<GoalsCard />, {
        wrapper: createTestWrapper(mockSections),
      });

      const section = screen.getByRole("region", { name: "Goals" });
      expect(section).toBeDefined();
    });

    it("has aria-labels on list items", () => {
      render(<GoalsCard />, {
        wrapper: createTestWrapper(mockSections),
      });

      const item = screen.getByLabelText("Learn TypeScript");
      expect(item).toBeDefined();
    });

    it("hides visual bullets from screen readers", () => {
      render(<GoalsCard />, {
        wrapper: createTestWrapper(mockSections),
      });

      const bullets = document.querySelectorAll('[aria-hidden="true"]');
      expect(bullets.length).toBeGreaterThan(0);
    });
  });

  describe("multiple sections", () => {
    it("renders each section with its own heading and list", () => {
      render(<GoalsCard />, {
        wrapper: createTestWrapper(mockSections),
      });

      const headings = screen.getAllByRole("heading", { level: 3 });
      expect(headings).toHaveLength(2);

      const lists = screen.getAllByRole("list");
      expect(lists).toHaveLength(2);
    });
  });
});
