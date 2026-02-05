/**
 * TaskList Component
 *
 * Displays tasks from vault directories grouped by file with toggle indicators.
 * Supports optimistic updates with rollback on error.
 */

import { useMemo, useCallback, useRef, useState, useEffect } from "react";
import type { TaskEntry, TaskCategory } from "@memory-loop/shared";
import { useSession } from "../../contexts/SessionContext";
import "./TaskList.css";

/**
 * Props for TaskList component.
 */
export interface TaskListProps {
  /** Callback when a task is toggled. Returns false to indicate failure (triggers rollback). */
  onToggleTask?: (filePath: string, lineNumber: number, newState: string, originalState: string) => boolean;
  /** Callback when a task's file is selected for viewing */
  onFileSelect?: (path: string) => void;
}

/**
 * Available task states for context menu selection.
 * These are the "special" states beyond basic incomplete/complete.
 */
const CONTEXT_MENU_STATES: string[] = ["/", "?", "b", "f"];

/**
 * Get the next state for left-click toggle.
 * Left-click toggles between ' ' (incomplete) and 'x' (complete).
 * Any other state goes to ' ' (incomplete).
 */
function getNextState(currentState: string): string {
  if (currentState === " ") {
    return "x";
  }
  return " ";
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
 * Context menu state for task state selection.
 */
interface TaskContextMenuState {
  isOpen: boolean;
  filePath: string;
  lineNumber: number;
  currentState: string;
  x: number;
  y: number;
}

/**
 * Props for TaskGroup component (internal).
 */
interface TaskGroupProps {
  filePath: string;
  tasks: TaskEntry[];
  onToggle: (filePath: string, lineNumber: number, currentState: string) => void;
  onFileSelect?: (path: string) => void;
  onContextMenu: (filePath: string, lineNumber: number, currentState: string, event: React.MouseEvent | React.TouchEvent) => void;
}

/**
 * TaskGroup displays tasks from a single file.
 */
function TaskGroup({ filePath, tasks, onToggle, onFileSelect, onContextMenu }: TaskGroupProps): React.ReactNode {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { setCurrentPath } = useSession();
  const longPressTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Cleanup long press timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of longPressTimerRef.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

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
          {tasks.map((task) => {
            const taskKey = `${task.filePath}:${task.lineNumber}`;

            const handleRightClick = (e: React.MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenu(task.filePath, task.lineNumber, task.state, e);
            };

            const handleTouchStart = (e: React.TouchEvent) => {
              const timer = setTimeout(() => {
                onContextMenu(task.filePath, task.lineNumber, task.state, e);
              }, 500);
              longPressTimerRef.current.set(taskKey, timer);
            };

            const handleTouchEnd = () => {
              const timer = longPressTimerRef.current.get(taskKey);
              if (timer) {
                clearTimeout(timer);
                longPressTimerRef.current.delete(taskKey);
              }
            };

            const handleTouchMove = () => {
              const timer = longPressTimerRef.current.get(taskKey);
              if (timer) {
                clearTimeout(timer);
                longPressTimerRef.current.delete(taskKey);
              }
            };

            return (
              <li key={taskKey} className="task-list__item">
                <button
                  type="button"
                  className="task-list__toggle"
                  onClick={() => onToggle(task.filePath, task.lineNumber, task.state)}
                  onContextMenu={handleRightClick}
                  onTouchStart={handleTouchStart}
                  onTouchEnd={handleTouchEnd}
                  onTouchMove={handleTouchMove}
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
            );
          })}
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

  // State for collapsed categories
  const [collapsedCategories, setCollapsedCategories] = useState<Set<TaskCategory>>(new Set());

  // Context menu state for task state selection
  const [contextMenu, setContextMenu] = useState<TaskContextMenuState>({
    isOpen: false,
    filePath: "",
    lineNumber: 0,
    currentState: " ",
    x: 0,
    y: 0,
  });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Track original states for rollback on error
  const pendingTogglesRef = useRef<Map<string, string>>(new Map());

  // Category display order: Inbox first, then Projects, then Areas
  const CATEGORY_ORDER: TaskCategory[] = ["inbox", "projects", "areas"];

  // Category display names for headers
  const CATEGORY_LABELS: Record<TaskCategory, string> = {
    inbox: "Inbox",
    projects: "Projects",
    areas: "Areas",
  };

  // Filter and group tasks by category, then by file path
  const groupedByCategory = useMemo(() => {
    // Filter out completed tasks if hideCompleted is true
    const filteredTasks = hideCompleted
      ? tasks.filter((t) => t.state !== "x")
      : tasks;

    // Group by category first, then by file path within each category
    const categoryGroups = new Map<TaskCategory, Map<string, TaskEntry[]>>();

    for (const task of filteredTasks) {
      let categoryMap = categoryGroups.get(task.category);
      if (!categoryMap) {
        categoryMap = new Map<string, TaskEntry[]>();
        categoryGroups.set(task.category, categoryMap);
      }

      const existing = categoryMap.get(task.filePath);
      if (existing) {
        existing.push(task);
      } else {
        categoryMap.set(task.filePath, [task]);
      }
    }

    // Sort tasks within each file group by line number
    for (const categoryMap of categoryGroups.values()) {
      for (const taskList of categoryMap.values()) {
        taskList.sort((a, b) => a.lineNumber - b.lineNumber);
      }
    }

    return categoryGroups;
  }, [tasks, hideCompleted]);

  // Get file paths sorted by mtime within each category
  // Returns array of { category, filePaths } in category order
  const sortedCategories = useMemo(() => {
    return CATEGORY_ORDER
      .filter((category) => groupedByCategory.has(category))
      .map((category) => {
        const fileGroups = groupedByCategory.get(category)!;
        const paths = Array.from(fileGroups.keys());

        // Sort file paths by mtime descending (newest first)
        paths.sort((a, b) => {
          const tasksA = fileGroups.get(a);
          const tasksB = fileGroups.get(b);
          const mtimeA = tasksA?.[0]?.fileMtime ?? 0;
          const mtimeB = tasksB?.[0]?.fileMtime ?? 0;
          return mtimeB - mtimeA;
        });

        return { category, filePaths: paths };
      });
  }, [groupedByCategory]);

  // Calculate total counts for display (before early returns for consistent hook ordering)
  const completedCount = tasks.filter((t) => t.state === "x").length;
  const totalCount = tasks.length;

  // Toggle category collapse state
  const toggleCategory = useCallback((category: TaskCategory) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

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

      // Notify parent with both new and original state
      // Parent returns false if unable to send (e.g., disconnected)
      const success = onToggleTask?.(filePath, lineNumber, newState, currentState) ?? true;

      // Rollback if parent indicates failure
      if (!success) {
        updateTask(filePath, lineNumber, currentState);
        pendingTogglesRef.current.delete(taskKey);
      }
    },
    [updateTask, setTasksError, onToggleTask]
  );

  // Handle opening context menu for state selection
  const handleContextMenu = useCallback(
    (filePath: string, lineNumber: number, currentState: string, event: React.MouseEvent | React.TouchEvent) => {
      let clientX: number;
      let clientY: number;

      if ("touches" in event) {
        const touch = event.touches[0] || event.changedTouches[0];
        clientX = touch?.clientX ?? 0;
        clientY = touch?.clientY ?? 0;
      } else {
        clientX = event.clientX;
        clientY = event.clientY;
      }

      // Position the menu, adjusting for viewport bounds
      const target = event.target as HTMLElement;
      const taskList = target.closest(".task-list");
      const menuWidth = 160;
      const menuHeight = 200;

      let x = clientX;
      let y = clientY;

      if (taskList) {
        const rect = taskList.getBoundingClientRect();
        x = clientX - rect.left;
        y = clientY - rect.top;

        // Keep menu within container bounds
        if (x + menuWidth > rect.width) {
          x = Math.max(0, x - menuWidth);
        }
        if (y + menuHeight > rect.height) {
          y = Math.max(0, rect.height - menuHeight - 8);
        }
      }

      setContextMenu({
        isOpen: true,
        filePath,
        lineNumber,
        currentState,
        x,
        y,
      });
    },
    []
  );

  // Close the context menu
  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // Handle selecting a state from the context menu
  const handleStateSelect = useCallback(
    (newState: string) => {
      const { filePath, lineNumber, currentState } = contextMenu;
      const taskKey = `${filePath}:${lineNumber}`;

      // Store original state for potential rollback
      if (!pendingTogglesRef.current.has(taskKey)) {
        pendingTogglesRef.current.set(taskKey, currentState);
      }

      // Optimistic update
      updateTask(filePath, lineNumber, newState);

      // Clear any previous error
      setTasksError(null);

      // Notify parent with both new and original state
      onToggleTask?.(filePath, lineNumber, newState, currentState);

      // Close the menu
      closeContextMenu();
    },
    [contextMenu, updateTask, setTasksError, onToggleTask, closeContextMenu]
  );

  // Close context menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        closeContextMenu();
      }
    }

    if (contextMenu.isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [contextMenu.isOpen, closeContextMenu]);

  // Close context menu on escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    }

    if (contextMenu.isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [contextMenu.isOpen, closeContextMenu]);

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
      {sortedCategories.map(({ category, filePaths }) => {
        const fileGroups = groupedByCategory.get(category);
        if (!fileGroups) return null;
        const isCategoryCollapsed = collapsedCategories.has(category);

        // Calculate category rollup: completed / total tasks in this category
        let categoryCompleted = 0;
        let categoryTotal = 0;
        for (const taskList of fileGroups.values()) {
          for (const task of taskList) {
            categoryTotal++;
            if (task.state === "x") categoryCompleted++;
          }
        }

        return (
          <section key={category} className="task-list__category">
            <button
              type="button"
              className="task-list__category-header"
              onClick={() => toggleCategory(category)}
              aria-expanded={!isCategoryCollapsed}
            >
              <span
                className="task-list__group-chevron"
                data-collapsed={isCategoryCollapsed}
              >
                <ChevronIcon />
              </span>
              <span className="task-list__category-name">{CATEGORY_LABELS[category]}</span>
              <span className="task-list__category-count">
                {categoryCompleted} / {categoryTotal}
              </span>
            </button>
            {!isCategoryCollapsed && filePaths.map((filePath) => {
              const fileTasks = fileGroups.get(filePath);
              if (!fileTasks) return null;
              return (
                <TaskGroup
                  key={filePath}
                  filePath={filePath}
                  tasks={fileTasks}
                  onToggle={handleToggle}
                  onFileSelect={onFileSelect}
                  onContextMenu={handleContextMenu}
                />
              );
            })}
          </section>
        );
      })}

      {/* Context menu for task state selection */}
      {contextMenu.isOpen && (
        <div
          ref={contextMenuRef}
          className="task-list__context-menu"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          role="menu"
        >
          <div className="task-list__context-menu-header">Set status</div>
          {CONTEXT_MENU_STATES.map((state) => (
            <button
              key={state}
              type="button"
              className={`task-list__context-menu-item ${contextMenu.currentState === state ? "task-list__context-menu-item--active" : ""}`}
              onClick={() => handleStateSelect(state)}
              role="menuitem"
            >
              <span className="task-list__context-menu-indicator" data-state={state}>
                {getStateIndicator(state)}
              </span>
              <span>{getStateLabel(state)}</span>
            </button>
          ))}
        </div>
      )}
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
