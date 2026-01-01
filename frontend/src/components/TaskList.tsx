/**
 * TaskList Component
 *
 * Displays tasks from vault directories grouped by file with toggle indicators.
 * Supports optimistic updates with rollback on error.
 */

import { useMemo, useCallback, useRef, useState } from "react";
import type { TaskEntry } from "@memory-loop/shared";
import { useSession } from "../contexts/SessionContext";
import "./TaskList.css";

/**
 * Props for TaskList component.
 */
export interface TaskListProps {
  /** Callback when a task is toggled */
  onToggleTask?: (filePath: string, lineNumber: number) => void;
  /** Callback when a task's file is selected for viewing */
  onFileSelect?: (path: string) => void;
}

/**
 * Task state cycle order for toggling.
 * ' ' -> 'x' -> '/' -> '?' -> 'b' -> 'f' -> ' '
 */
const STATE_CYCLE: string[] = [" ", "x", "/", "?", "b", "f"];

/**
 * Get the next state in the cycle for a given current state.
 */
function getNextState(currentState: string): string {
  const currentIndex = STATE_CYCLE.indexOf(currentState);
  if (currentIndex === -1) {
    return "x"; // Unknown state, cycle to complete
  }
  return STATE_CYCLE[(currentIndex + 1) % STATE_CYCLE.length];
}

/**
 * Get the visual indicator for a task state.
 */
function getStateIndicator(state: string): string {
  switch (state) {
    case " ":
      return "\u2610"; // Empty checkbox (ballot box)
    case "x":
      return "\u2611"; // Checked checkbox (ballot box with check)
    case "/":
      return "\u25D0"; // Half-filled circle
    case "?":
      return "?"; // Question mark
    case "b":
      return "\uD83D\uDCCD"; // Pushpin emoji
    case "f":
      return "\uD83D\uDD25"; // Fire emoji
    default:
      return "\u2610"; // Default to empty checkbox
  }
}

/**
 * Get ARIA label for a task state.
 */
function getStateLabel(state: string): string {
  switch (state) {
    case " ":
      return "incomplete";
    case "x":
      return "complete";
    case "/":
      return "partial";
    case "?":
      return "needs info";
    case "b":
      return "bookmarked";
    case "f":
      return "urgent";
    default:
      return "unknown";
  }
}

/**
 * Props for TaskGroup component (internal).
 */
interface TaskGroupProps {
  filePath: string;
  tasks: TaskEntry[];
  onToggle: (filePath: string, lineNumber: number, currentState: string) => void;
  onFileSelect?: (path: string) => void;
}

/**
 * TaskGroup displays tasks from a single file.
 */
function TaskGroup({ filePath, tasks, onToggle, onFileSelect }: TaskGroupProps): React.ReactNode {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { setCurrentPath } = useSession();

  // Calculate rollup count: completed (state = 'x') / total
  const completedCount = tasks.filter((t) => t.state === "x").length;
  const totalCount = tasks.length;

  // Extract just the filename for display
  const fileName = filePath.includes("/")
    ? filePath.substring(filePath.lastIndexOf("/") + 1)
    : filePath;

  // Handle task text click to view the file
  const handleTextClick = useCallback(
    (taskFilePath: string) => {
      setCurrentPath(taskFilePath);
      onFileSelect?.(taskFilePath);
    },
    [setCurrentPath, onFileSelect]
  );

  return (
    <div className="task-list__group">
      <button
        type="button"
        className="task-list__group-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
        aria-expanded={!isCollapsed}
      >
        <span
          className="task-list__group-chevron"
          data-collapsed={isCollapsed}
        >
          <ChevronIcon />
        </span>
        <span className="task-list__group-icon">
          <FileIcon />
        </span>
        <span className="task-list__group-name" title={filePath}>
          {fileName}
        </span>
        <span className="task-list__group-count">
          {completedCount} / {totalCount}
        </span>
      </button>
      {!isCollapsed && (
        <ul className="task-list__items">
          {tasks.map((task) => (
            <li key={`${task.filePath}:${task.lineNumber}`} className="task-list__item">
              <button
                type="button"
                className="task-list__toggle"
                onClick={() => onToggle(task.filePath, task.lineNumber, task.state)}
                aria-label={`Toggle task: ${task.text} (currently ${getStateLabel(task.state)})`}
              >
                <span className="task-list__indicator" data-state={task.state}>
                  {getStateIndicator(task.state)}
                </span>
              </button>
              <button
                type="button"
                className="task-list__text-btn"
                onClick={() => handleTextClick(task.filePath)}
                aria-label={`View file: ${task.filePath}`}
              >
                {task.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * File icon for group headers.
 */
function FileIcon(): React.ReactNode {
  return (
    <svg
      className="task-list__icon-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

/**
 * Chevron icon for collapse/expand indicator.
 */
function ChevronIcon(): React.ReactNode {
  return (
    <svg
      className="task-list__icon-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/**
 * TaskList displays tasks grouped by source file with toggle indicators.
 *
 * Features:
 * - Groups tasks by source file path
 * - Displays rollup count (incomplete / total) per file
 * - Visual indicators for each task state
 * - Click indicator to toggle task state
 * - Optimistic updates with rollback on error
 * - 44px minimum touch targets (REQ-NF-2)
 */
export function TaskList({ onToggleTask, onFileSelect }: TaskListProps): React.ReactNode {
  const { browser, updateTask, setTasksError } = useSession();
  const { tasks, isTasksLoading, tasksError } = browser;

  // State for hiding completed tasks
  const [hideCompleted, setHideCompleted] = useState(false);

  // Track original states for rollback on error
  const pendingTogglesRef = useRef<Map<string, string>>(new Map());

  // Filter and group tasks by file path
  const groupedTasks = useMemo(() => {
    // Filter out completed tasks if hideCompleted is true
    const filteredTasks = hideCompleted
      ? tasks.filter((t) => t.state !== "x")
      : tasks;

    const groups = new Map<string, TaskEntry[]>();
    for (const task of filteredTasks) {
      const existing = groups.get(task.filePath);
      if (existing) {
        existing.push(task);
      } else {
        groups.set(task.filePath, [task]);
      }
    }
    // Sort tasks within each group by line number
    for (const taskList of groups.values()) {
      taskList.sort((a, b) => a.lineNumber - b.lineNumber);
    }
    return groups;
  }, [tasks, hideCompleted]);

  // Get file paths sorted by modification time (newest first)
  // Must be before any early returns to maintain consistent hook ordering
  const sortedFilePaths = useMemo(() => {
    const paths = Array.from(groupedTasks.keys());
    return paths.sort((a, b) => {
      const tasksA = groupedTasks.get(a);
      const tasksB = groupedTasks.get(b);
      // Get mtime from first task in each group (all tasks in a file have same mtime)
      const mtimeA = tasksA?.[0]?.fileMtime ?? 0;
      const mtimeB = tasksB?.[0]?.fileMtime ?? 0;
      // Sort descending (newest first)
      return mtimeB - mtimeA;
    });
  }, [groupedTasks]);

  // Calculate total counts for display (before early returns for consistent hook ordering)
  const completedCount = tasks.filter((t) => t.state === "x").length;
  const totalCount = tasks.length;

  // Handle task toggle with optimistic update
  const handleToggle = useCallback(
    (filePath: string, lineNumber: number, currentState: string) => {
      const taskKey = `${filePath}:${lineNumber}`;
      const newState = getNextState(currentState);

      // Store original state for potential rollback
      if (!pendingTogglesRef.current.has(taskKey)) {
        pendingTogglesRef.current.set(taskKey, currentState);
      }

      // Optimistic update
      updateTask(filePath, lineNumber, newState);

      // Clear any previous error
      setTasksError(null);

      // Notify parent to send WebSocket message
      onToggleTask?.(filePath, lineNumber);
    },
    [updateTask, setTasksError, onToggleTask]
  );

  // Show loading state
  if (isTasksLoading && tasks.length === 0) {
    return (
      <div className="task-list task-list--loading">
        <div className="task-list__loading">
          <span className="task-list__loading-spinner" aria-label="Loading tasks" />
          <span>Loading tasks...</span>
        </div>
      </div>
    );
  }

  // Show error state
  if (tasksError) {
    return (
      <div className="task-list task-list--error">
        <p className="task-list__error-message">{tasksError}</p>
      </div>
    );
  }

  // Show empty state (REQ-F-23)
  if (tasks.length === 0) {
    return (
      <div className="task-list task-list--empty">
        <p className="task-list__empty-message">No tasks found</p>
      </div>
    );
  }

  return (
    <nav className="task-list" aria-label="Task list">
      <div className="task-list__header">
        <label className="task-list__hide-toggle">
          <input
            type="checkbox"
            checked={hideCompleted}
            onChange={(e) => setHideCompleted(e.target.checked)}
          />
          <span>Hide completed</span>
        </label>
        <span className="task-list__total-count">
          {completedCount} / {totalCount}
        </span>
      </div>
      {sortedFilePaths.map((filePath) => {
        const fileTasks = groupedTasks.get(filePath);
        if (!fileTasks) return null;
        return (
          <TaskGroup
            key={filePath}
            filePath={filePath}
            tasks={fileTasks}
            onToggle={handleToggle}
            onFileSelect={onFileSelect}
          />
        );
      })}
    </nav>
  );
}

/**
 * Rollback a pending toggle to its original state.
 * Export for use in BrowseMode error handling.
 */
export function rollbackTaskToggle(
  updateTask: (filePath: string, lineNumber: number, newState: string) => void,
  filePath: string,
  lineNumber: number,
  originalState: string
): void {
  updateTask(filePath, lineNumber, originalState);
}
