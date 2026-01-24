/**
 * Tests for GoalsCard component
 *
 * Tests rendering of markdown content, click behavior, and accessibility.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { GoalsCard } from "../GoalsCard";
import { SessionProvider, useSession } from "../../../contexts/SessionContext";

// Test markdown content
const mockGoalsMarkdown = `# Goals

## Active

- Learn TypeScript
- Build a web app

## Backlog

- Set up project
`;

// Wrapper with providers
function createTestWrapper(goals: string | null) {
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

    it("renders nothing when goals is empty string", () => {
      const { container } = render(<GoalsCard />, {
        wrapper: createTestWrapper(""),
      });

      expect(container.firstChild).toBeNull();
    });

    it("renders goals card as a button", () => {
      render(<GoalsCard />, {
        wrapper: createTestWrapper(mockGoalsMarkdown),
      });

      expect(screen.getByRole("button", { name: "Review goals" })).toBeDefined();
    });

    it("renders markdown headings", () => {
      render(<GoalsCard />, {
        wrapper: createTestWrapper(mockGoalsMarkdown),
      });

      expect(screen.getByText("Goals")).toBeDefined();
      expect(screen.getByText("Active")).toBeDefined();
      expect(screen.getByText("Backlog")).toBeDefined();
    });

    it("renders markdown list items", () => {
      render(<GoalsCard />, {
        wrapper: createTestWrapper(mockGoalsMarkdown),
      });

      expect(screen.getByText("Learn TypeScript")).toBeDefined();
      expect(screen.getByText("Build a web app")).toBeDefined();
      expect(screen.getByText("Set up project")).toBeDefined();
    });
  });

  describe("markdown formatting", () => {
    it("renders task lists with checkboxes", () => {
      const taskListMarkdown = `## Tasks

- [ ] Incomplete task
- [x] Complete task
`;

      render(<GoalsCard />, {
        wrapper: createTestWrapper(taskListMarkdown),
      });

      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes.length).toBe(2);
    });

    it("renders bold text", () => {
      const boldMarkdown = `## Goals

**Important goal**
`;

      render(<GoalsCard />, {
        wrapper: createTestWrapper(boldMarkdown),
      });

      const strong = document.querySelector("strong");
      expect(strong).toBeDefined();
      expect(strong?.textContent).toBe("Important goal");
    });
  });

  describe("accessibility", () => {
    it("has accessible button with aria-label", () => {
      render(<GoalsCard />, {
        wrapper: createTestWrapper(mockGoalsMarkdown),
      });

      const button = screen.getByRole("button", { name: "Review goals" });
      expect(button).toBeDefined();
    });
  });

  describe("click behavior", () => {
    it("calls setDiscussionPrefill with /review-goals on click", () => {
      let capturedPrefill = "";

      function PrefillCapture({ children }: { children: ReactNode }) {
        const { discussionPrefill } = useSession();
        capturedPrefill = discussionPrefill ?? "";
        return <>{children}</>;
      }

      function TestWrapper({ children }: { children: ReactNode }) {
        return (
          <SessionProvider initialGoals={mockGoalsMarkdown}>
            <PrefillCapture>{children}</PrefillCapture>
          </SessionProvider>
        );
      }

      render(<GoalsCard />, { wrapper: TestWrapper });

      const button = screen.getByRole("button", { name: "Review goals" });
      fireEvent.click(button);

      expect(capturedPrefill).toBe("/review-goals");
    });

    it("sets mode to discussion on click", () => {
      let capturedMode = "";

      function ModeCapture({ children }: { children: ReactNode }) {
        const { mode } = useSession();
        capturedMode = mode;
        return <>{children}</>;
      }

      function TestWrapper({ children }: { children: ReactNode }) {
        return (
          <SessionProvider initialGoals={mockGoalsMarkdown}>
            <ModeCapture>{children}</ModeCapture>
          </SessionProvider>
        );
      }

      render(<GoalsCard />, { wrapper: TestWrapper });

      const button = screen.getByRole("button", { name: "Review goals" });
      fireEvent.click(button);

      expect(capturedMode).toBe("discussion");
    });
  });
});
