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
        { text: "Task 1", state: " ", filePath: "folder/file1.md", lineNumber: 1, fileMtime: 1000 },
        { text: "Task 2", state: " ", filePath: "folder/file1.md", lineNumber: 2, fileMtime: 1000 },
        { text: "Task 3", state: " ", filePath: "folder/file2.md", lineNumber: 1, fileMtime: 2000 },
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
        { text: "Task 1", state: " ", filePath: "file.md", lineNumber: 1, fileMtime: 1000 },
        { text: "Task 2", state: "x", filePath: "file.md", lineNumber: 2, fileMtime: 1000 },
        { text: "Task 3", state: " ", filePath: "file.md", lineNumber: 3, fileMtime: 1000 },
      ];

      render(
        <SessionProvider>
          <TaskListWithTasks tasks={tasks} />
        </SessionProvider>
      );

      // 1 completed (x), 3 total - appears in both header and per-group count
      // Find the group header button by its aria-expanded attribute
      const groupHeader = screen.getByRole("button", { expanded: true });
      expect(groupHeader.textContent).toContain("1 / 3");
      expect(groupHeader.textContent).toContain("file.md");
    });
  });

  describe("state indicators", () => {
    it("shows empty checkbox for incomplete tasks (state=' ')", () => {
      const tasks: TaskEntry[] = [
        { text: "Incomplete task", state: " ", filePath: "file.md", lineNumber: 1, fileMtime: 1000 },
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
        { text: "Complete task", state: "x", filePath: "file.md", lineNumber: 1, fileMtime: 1000 },
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
        { text: "Task to toggle", state: " ", filePath: "file.md", lineNumber: 5, fileMtime: 1000 },
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
        { text: "Touch target test", state: " ", filePath: "touch.md", lineNumber: 1, fileMtime: 1000 },
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
        { text: "Accessible task", state: "x", filePath: "access.md", lineNumber: 1, fileMtime: 1000 },
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

  describe("hide completed toggle", () => {
    it("renders hide completed checkbox in header", () => {
      const tasks: TaskEntry[] = [
        { text: "Task 1", state: " ", filePath: "file.md", lineNumber: 1, fileMtime: 1000 },
      ];

      render(
        <SessionProvider>
          <TaskListWithTasks tasks={tasks} />
        </SessionProvider>
      );

      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).toBeDefined();
      expect(screen.getByText("Hide completed")).toBeDefined();
    });

    it("filters out completed tasks when toggle is active", () => {
      const tasks: TaskEntry[] = [
        { text: "Incomplete task", state: " ", filePath: "file.md", lineNumber: 1, fileMtime: 1000 },
        { text: "Complete task", state: "x", filePath: "file.md", lineNumber: 2, fileMtime: 1000 },
      ];

      render(
        <SessionProvider>
          <TaskListWithTasks tasks={tasks} />
        </SessionProvider>
      );

      // Both tasks visible initially
      expect(screen.getByText("Incomplete task")).toBeDefined();
      expect(screen.getByText("Complete task")).toBeDefined();

      // Toggle hide completed
      const checkbox = screen.getByRole("checkbox");
      fireEvent.click(checkbox);

      // Only incomplete task visible
      expect(screen.getByText("Incomplete task")).toBeDefined();
      expect(screen.queryByText("Complete task")).toBeNull();
    });

    it("displays total count as completed / total in header", () => {
      const tasks: TaskEntry[] = [
        { text: "Task 1", state: " ", filePath: "file.md", lineNumber: 1, fileMtime: 1000 },
        { text: "Task 2", state: "x", filePath: "file.md", lineNumber: 2, fileMtime: 1000 },
        { text: "Task 3", state: " ", filePath: "file.md", lineNumber: 3, fileMtime: 1000 },
      ];

      render(
        <SessionProvider>
          <TaskListWithTasks tasks={tasks} />
        </SessionProvider>
      );

      // Header shows total count (1 completed / 3 total)
      const totalCount = screen.getByText("1 / 3", { selector: ".task-list__total-count" });
      expect(totalCount).toBeDefined();
    });

    it("keeps total count unchanged when hide toggle is active", () => {
      const tasks: TaskEntry[] = [
        { text: "Task 1", state: " ", filePath: "file.md", lineNumber: 1, fileMtime: 1000 },
        { text: "Task 2", state: "x", filePath: "file.md", lineNumber: 2, fileMtime: 1000 },
      ];

      render(
        <SessionProvider>
          <TaskListWithTasks tasks={tasks} />
        </SessionProvider>
      );

      // Toggle hide completed
      const checkbox = screen.getByRole("checkbox");
      fireEvent.click(checkbox);

      // Total count still reflects all tasks, not just visible ones
      const totalCount = screen.getByText("1 / 2", { selector: ".task-list__total-count" });
      expect(totalCount).toBeDefined();
    });
  });

  describe("sort by modification time", () => {
    it("sorts files by mtime descending (newest first)", () => {
      const tasks: TaskEntry[] = [
        { text: "Old file task", state: " ", filePath: "old.md", lineNumber: 1, fileMtime: 1000 },
        { text: "New file task", state: " ", filePath: "new.md", lineNumber: 1, fileMtime: 3000 },
        { text: "Mid file task", state: " ", filePath: "mid.md", lineNumber: 1, fileMtime: 2000 },
      ];

      render(
        <SessionProvider>
          <TaskListWithTasks tasks={tasks} />
        </SessionProvider>
      );

      // Get all group headers in order
      const headers = screen.getAllByRole("button", { expanded: true });
      const fileNames = headers.map((h) => h.textContent);

      // Should be newest first: new.md, mid.md, old.md
      expect(fileNames[0]).toContain("new.md");
      expect(fileNames[1]).toContain("mid.md");
      expect(fileNames[2]).toContain("old.md");
    });

    it("handles files with mtime=0 (sorted last)", () => {
      const tasks: TaskEntry[] = [
        { text: "No mtime task", state: " ", filePath: "unknown.md", lineNumber: 1, fileMtime: 0 },
        { text: "Has mtime task", state: " ", filePath: "known.md", lineNumber: 1, fileMtime: 1000 },
      ];

      render(
        <SessionProvider>
          <TaskListWithTasks tasks={tasks} />
        </SessionProvider>
      );

      const headers = screen.getAllByRole("button", { expanded: true });
      const fileNames = headers.map((h) => h.textContent);

      // File with mtime should come first, mtime=0 last
      expect(fileNames[0]).toContain("known.md");
      expect(fileNames[1]).toContain("unknown.md");
    });
  });

  describe("left-click toggle behavior", () => {
    it("toggles from incomplete to complete on left-click", () => {
      const tasks: TaskEntry[] = [
        { text: "Incomplete task", state: " ", filePath: "file.md", lineNumber: 1, fileMtime: 1000 },
      ];

      render(
        <SessionProvider>
          <TaskListWithTasks tasks={tasks} />
        </SessionProvider>
      );

      // Find and click the toggle button
      const toggleButton = screen.getByRole("button", {
        name: /Toggle task: Incomplete task/i,
      });
      fireEvent.click(toggleButton);

      // After click, should show checked checkbox (optimistic update)
      const indicators = screen.getAllByText("\u2611");
      expect(indicators.length).toBeGreaterThanOrEqual(1);
    });

    it("toggles from complete to incomplete on left-click", () => {
      const tasks: TaskEntry[] = [
        { text: "Complete task", state: "x", filePath: "file.md", lineNumber: 1, fileMtime: 1000 },
      ];

      render(
        <SessionProvider>
          <TaskListWithTasks tasks={tasks} />
        </SessionProvider>
      );

      // Find and click the toggle button
      const toggleButton = screen.getByRole("button", {
        name: /Toggle task: Complete task/i,
      });
      fireEvent.click(toggleButton);

      // After click, should show empty checkbox (optimistic update)
      const indicators = screen.getAllByText("\u2610");
      expect(indicators.length).toBeGreaterThanOrEqual(1);
    });

    it("toggles from special state to incomplete on left-click", () => {
      const tasks: TaskEntry[] = [
        { text: "Partial task", state: "/", filePath: "file.md", lineNumber: 1, fileMtime: 1000 },
      ];

      render(
        <SessionProvider>
          <TaskListWithTasks tasks={tasks} />
        </SessionProvider>
      );

      // Find and click the toggle button
      const toggleButton = screen.getByRole("button", {
        name: /Toggle task: Partial task/i,
      });
      fireEvent.click(toggleButton);

      // After click, should show empty checkbox (special states go to incomplete)
      const indicators = screen.getAllByText("\u2610");
      expect(indicators.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("context menu", () => {
    it("opens context menu on right-click", () => {
      const tasks: TaskEntry[] = [
        { text: "Task with menu", state: " ", filePath: "file.md", lineNumber: 1, fileMtime: 1000 },
      ];

      render(
        <SessionProvider>
          <TaskListWithTasks tasks={tasks} />
        </SessionProvider>
      );

      const toggleButton = screen.getByRole("button", {
        name: /Toggle task: Task with menu/i,
      });
      fireEvent.contextMenu(toggleButton);

      // Context menu should be visible
      expect(screen.getByRole("menu")).toBeDefined();
      expect(screen.getByText("Set status")).toBeDefined();
    });

    it("displays special state options in context menu", () => {
      const tasks: TaskEntry[] = [
        { text: "Task with menu", state: " ", filePath: "file.md", lineNumber: 1, fileMtime: 1000 },
      ];

      render(
        <SessionProvider>
          <TaskListWithTasks tasks={tasks} />
        </SessionProvider>
      );

      const toggleButton = screen.getByRole("button", {
        name: /Toggle task: Task with menu/i,
      });
      fireEvent.contextMenu(toggleButton);

      // Should show all special state options
      expect(screen.getByText("partial")).toBeDefined();
      expect(screen.getByText("needs info")).toBeDefined();
      expect(screen.getByText("bookmarked")).toBeDefined();
      expect(screen.getByText("urgent")).toBeDefined();
    });

    it("selects state from context menu", () => {
      const tasks: TaskEntry[] = [
        { text: "Task to update", state: " ", filePath: "file.md", lineNumber: 1, fileMtime: 1000 },
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

      // Open context menu
      const toggleButton = screen.getByRole("button", {
        name: /Toggle task: Task to update/i,
      });
      fireEvent.contextMenu(toggleButton);

      // Click "urgent" option
      const urgentOption = screen.getByRole("menuitem", { name: /urgent/i });
      fireEvent.click(urgentOption);

      // Should call onToggleTask
      expect(toggledFilePath).toBe("file.md");
      expect(toggledLineNumber).toBe(1);

      // Context menu should be closed
      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("closes context menu on escape key", () => {
      const tasks: TaskEntry[] = [
        { text: "Task with menu", state: " ", filePath: "file.md", lineNumber: 1, fileMtime: 1000 },
      ];

      render(
        <SessionProvider>
          <TaskListWithTasks tasks={tasks} />
        </SessionProvider>
      );

      const toggleButton = screen.getByRole("button", {
        name: /Toggle task: Task with menu/i,
      });
      fireEvent.contextMenu(toggleButton);

      // Menu should be open
      expect(screen.getByRole("menu")).toBeDefined();

      // Press escape
      fireEvent.keyDown(document, { key: "Escape" });

      // Menu should be closed
      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("closes context menu on click outside", () => {
      const tasks: TaskEntry[] = [
        { text: "Task with menu", state: " ", filePath: "file.md", lineNumber: 1, fileMtime: 1000 },
      ];

      render(
        <SessionProvider>
          <TaskListWithTasks tasks={tasks} />
        </SessionProvider>
      );

      const toggleButton = screen.getByRole("button", {
        name: /Toggle task: Task with menu/i,
      });
      fireEvent.contextMenu(toggleButton);

      // Menu should be open
      expect(screen.getByRole("menu")).toBeDefined();

      // Click outside (on the task list container)
      fireEvent.mouseDown(document.body);

      // Menu should be closed
      expect(screen.queryByRole("menu")).toBeNull();
    });
  });
});
