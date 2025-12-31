/**
 * Tests for TaskList component
 *
 * Tests task grouping, state indicators, toggle functionality, and optimistic updates.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useEffect } from "react";
import { TaskList } from "../TaskList";
import { SessionProvider, useSession } from "../../contexts/SessionContext";
import type { TaskEntry } from "@memory-loop/shared";

// Clear localStorage and cleanup DOM before/after each test
beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

// Helper component to set up tasks in context
function TaskListWithTasks({
  tasks,
  onToggleTask,
}: {
  tasks: TaskEntry[];
  onToggleTask?: (filePath: string, lineNumber: number) => void;
}) {
  const { setTasks } = useSession();

  useEffect(() => {
    setTasks(tasks);
  }, [setTasks, tasks]);

  return <TaskList onToggleTask={onToggleTask} />;
}

// Helper component to set loading state
function TaskListLoading() {
  const { setTasksLoading } = useSession();

  useEffect(() => {
    setTasksLoading(true);
  }, [setTasksLoading]);

  return <TaskList />;
}

describe("TaskList", () => {
  describe("empty state", () => {
    it("displays 'No tasks found' when empty (REQ-F-23)", () => {
      render(
        <SessionProvider>
          <TaskList />
        </SessionProvider>
      );

      expect(screen.getByText("No tasks found")).toBeDefined();
    });
  });

  describe("loading state", () => {
    it("displays loading spinner when isTasksLoading is true", () => {
      render(
        <SessionProvider>
          <TaskListLoading />
        </SessionProvider>
      );

      expect(screen.getByText("Loading tasks...")).toBeDefined();
    });
  });

  describe("task grouping", () => {
    it("groups tasks by file path", () => {
      const tasks: TaskEntry[] = [
        { text: "Task 1", state: " ", filePath: "folder/file1.md", lineNumber: 1 },
        { text: "Task 2", state: " ", filePath: "folder/file1.md", lineNumber: 2 },
        { text: "Task 3", state: " ", filePath: "folder/file2.md", lineNumber: 1 },
      ];

      render(
        <SessionProvider>
          <TaskListWithTasks tasks={tasks} />
        </SessionProvider>
      );

      // Should show both file names
      expect(screen.getByText("file1.md")).toBeDefined();
      expect(screen.getByText("file2.md")).toBeDefined();
    });

    it("displays rollup count (completed / total) per file", () => {
      const tasks: TaskEntry[] = [
        { text: "Task 1", state: " ", filePath: "file.md", lineNumber: 1 },
        { text: "Task 2", state: "x", filePath: "file.md", lineNumber: 2 },
        { text: "Task 3", state: " ", filePath: "file.md", lineNumber: 3 },
      ];

      render(
        <SessionProvider>
          <TaskListWithTasks tasks={tasks} />
        </SessionProvider>
      );

      // 1 completed (x), 3 total
      expect(screen.getByText("1 / 3")).toBeDefined();
    });
  });

  describe("state indicators", () => {
    it("shows empty checkbox for incomplete tasks (state=' ')", () => {
      const tasks: TaskEntry[] = [
        { text: "Incomplete task", state: " ", filePath: "file.md", lineNumber: 1 },
      ];

      render(
        <SessionProvider>
          <TaskListWithTasks tasks={tasks} />
        </SessionProvider>
      );

      // Check for the ballot box character using getAllByText and check length
      const indicators = screen.getAllByText("\u2610");
      expect(indicators.length).toBeGreaterThanOrEqual(1);
    });

    it("shows checked checkbox for complete tasks (state='x')", () => {
      const tasks: TaskEntry[] = [
        { text: "Complete task", state: "x", filePath: "file.md", lineNumber: 1 },
      ];

      render(
        <SessionProvider>
          <TaskListWithTasks tasks={tasks} />
        </SessionProvider>
      );

      // Check for the ballot box with check character
      const indicators = screen.getAllByText("\u2611");
      expect(indicators.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("task toggle", () => {
    it("calls onToggleTask when toggle button is clicked", () => {
      const tasks: TaskEntry[] = [
        { text: "Task to toggle", state: " ", filePath: "file.md", lineNumber: 5 },
      ];

      let toggledFilePath = "";
      let toggledLineNumber = 0;

      render(
        <SessionProvider>
          <TaskListWithTasks
            tasks={tasks}
            onToggleTask={(filePath, lineNumber) => {
              toggledFilePath = filePath;
              toggledLineNumber = lineNumber;
            }}
          />
        </SessionProvider>
      );

      // Find and click the toggle button
      const toggleButton = screen.getByRole("button", {
        name: /Toggle task: Task to toggle/i,
      });
      fireEvent.click(toggleButton);

      expect(toggledFilePath).toBe("file.md");
      expect(toggledLineNumber).toBe(5);
    });
  });

  describe("touch targets", () => {
    it("has 44px minimum touch target class applied (REQ-NF-2)", () => {
      const tasks: TaskEntry[] = [
        { text: "Touch target test", state: " ", filePath: "touch.md", lineNumber: 1 },
      ];

      render(
        <SessionProvider>
          <TaskListWithTasks tasks={tasks} />
        </SessionProvider>
      );

      const toggleButton = screen.getByRole("button", {
        name: /Toggle task: Touch target test/i,
      });

      // The button should have 44px width and height defined in CSS
      // We can check the class is applied
      expect(toggleButton.className).toContain("task-list__toggle");
    });
  });

  describe("accessibility", () => {
    it("provides aria-label for toggle buttons with task state", () => {
      const tasks: TaskEntry[] = [
        { text: "Accessible task", state: "x", filePath: "access.md", lineNumber: 1 },
      ];

      render(
        <SessionProvider>
          <TaskListWithTasks tasks={tasks} />
        </SessionProvider>
      );

      const toggleButton = screen.getByRole("button", {
        name: /Toggle task: Accessible task \(currently complete\)/i,
      });
      expect(toggleButton).toBeDefined();
    });
  });
});
