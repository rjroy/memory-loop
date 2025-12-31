/**
 * BrowseMode Component
 *
 * Split-pane container that coordinates FileTree and MarkdownViewer.
 * Supports collapsible tree panel and mobile-friendly overlay.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "../contexts/SessionContext";
import type { BrowseViewMode } from "../contexts/SessionContext";
import { useWebSocket } from "../hooks/useWebSocket";
import { FileTree } from "./FileTree";
import { TaskList } from "./TaskList";
import { MarkdownViewer } from "./MarkdownViewer";
import "./BrowseMode.css";

/** Error codes that indicate save failure for adjust mode */
const SAVE_ERROR_CODES = ["PATH_TRAVERSAL", "INVALID_FILE_TYPE", "FILE_NOT_FOUND", "INTERNAL_ERROR"] as const;

/**
 * Props for BrowseMode component.
 */
export interface BrowseModeProps {
  /** Base URL for vault assets (images) */
  assetBaseUrl?: string;
}

/**
 * BrowseMode provides a split-pane view for browsing vault files.
 *
 * Features:
 * - CSS Grid layout with collapsible tree pane
 * - Mobile overlay mode for tree navigation
 * - Automatic root directory loading on mount
 * - Coordinates file selection between tree and viewer
 */
export function BrowseMode({ assetBaseUrl }: BrowseModeProps): React.ReactNode {
  const [isTreeCollapsed, setIsTreeCollapsed] = useState(false);
  const [isMobileTreeOpen, setIsMobileTreeOpen] = useState(false);

  const hasSentVaultSelectionRef = useRef(false);
  const [hasSessionReady, setHasSessionReady] = useState(false);

  const { browser, vault, cacheDirectory, clearDirectoryCache, setFileContent, setFileError, setFileLoading, startSave, saveSuccess, saveError, setViewMode, setTasks, setTasksLoading, setTasksError, updateTask } = useSession();

  const { viewMode } = browser;

  // Track saving state in a ref to avoid stale closures in WebSocket message handler
  const isSavingRef = useRef(browser.isSaving);
  isSavingRef.current = browser.isSaving;

  // Track pending task toggles for rollback on error
  const pendingTaskTogglesRef = useRef<Map<string, string>>(new Map());

  // Callback to re-send vault selection on WebSocket reconnect
  const handleReconnect = useCallback(() => {
    hasSentVaultSelectionRef.current = false;
    setHasSessionReady(false);
  }, []);

  const { sendMessage, lastMessage, connectionStatus } = useWebSocket({
    onReconnect: handleReconnect,
  });

  // Send vault selection when WebSocket connects (initial or reconnect)
  useEffect(() => {
    if (
      connectionStatus === "connected" &&
      vault &&
      !hasSentVaultSelectionRef.current
    ) {
      sendMessage({
        type: "select_vault",
        vaultId: vault.id,
      });
      hasSentVaultSelectionRef.current = true;
    }
  }, [connectionStatus, vault, sendMessage]);

  // Load root directory after session is ready, if not cached
  useEffect(() => {
    if (vault && hasSessionReady && !browser.directoryCache.has("")) {
      setFileLoading(true);
      sendMessage({ type: "list_directory", path: "" });
    }
  }, [vault, hasSessionReady, browser.directoryCache, sendMessage, setFileLoading]);

  // Load tasks when viewMode is "tasks"
  useEffect(() => {
    if (vault && hasSessionReady && viewMode === "tasks") {
      setTasksLoading(true);
      sendMessage({ type: "get_tasks" });
    }
  }, [vault, hasSessionReady, viewMode, sendMessage, setTasksLoading]);

  // Auto-load file when currentPath is set externally (e.g., from RecentActivity View button)
  // Only load if we have a file path and no content loaded yet
  const hasAutoLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    const path = browser.currentPath;

    // Reset auto-load ref when blocked so same file can be loaded again on future navigation
    if (
      !hasSessionReady ||
      !path ||
      !path.endsWith(".md") ||
      browser.currentFileContent !== null ||
      browser.fileError ||
      browser.isLoading
    ) {
      hasAutoLoadedRef.current = null;
      return;
    }

    // Only auto-load .md files that haven't been auto-loaded for this path yet
    if (hasAutoLoadedRef.current !== path) {
      hasAutoLoadedRef.current = path;
      setFileLoading(true);
      sendMessage({ type: "read_file", path });
    }
  }, [hasSessionReady, browser.currentPath, browser.currentFileContent, browser.fileError, browser.isLoading, sendMessage, setFileLoading]);

  // Handle server messages for directory listing and file content
  useEffect(() => {
    if (!lastMessage) return;

    switch (lastMessage.type) {
      case "session_ready":
        setHasSessionReady(true);
        break;

      case "directory_listing":
        cacheDirectory(lastMessage.path, lastMessage.entries);
        setFileLoading(false);
        break;

      case "file_content":
        setFileContent(lastMessage.content, lastMessage.truncated);
        // Close mobile tree when file is loaded
        setIsMobileTreeOpen(false);
        break;

      case "error":
        // Check if this is a save error (while in adjust mode)
        // Use ref to get current saving state, avoiding stale closure issue
        if (isSavingRef.current && SAVE_ERROR_CODES.includes(lastMessage.code as typeof SAVE_ERROR_CODES[number])) {
          // Save failed - preserve content and show error (REQ-F-15)
          saveError(lastMessage.message);
        } else if (
          lastMessage.code === "FILE_NOT_FOUND" ||
          lastMessage.code === "DIRECTORY_NOT_FOUND" ||
          lastMessage.code === "INVALID_FILE_TYPE"
        ) {
          // Check if this is a task toggle error - rollback optimistic update
          if (pendingTaskTogglesRef.current.size > 0) {
            // Rollback all pending task toggles and show error (REQ-F-24)
            for (const [taskKey, originalState] of pendingTaskTogglesRef.current) {
              const [filePath, lineNumberStr] = taskKey.split(":");
              const lineNumber = parseInt(lineNumberStr, 10);
              updateTask(filePath, lineNumber, originalState);
            }
            pendingTaskTogglesRef.current.clear();
            setTasksError(lastMessage.message);
          } else {
            setFileError(lastMessage.message);
          }
        }
        setFileLoading(false);
        break;

      case "file_written":
        // File saved successfully - clear adjust state and refresh content
        saveSuccess();
        // Re-request file content to refresh the view with saved content
        setFileLoading(true);
        sendMessage({ type: "read_file", path: lastMessage.path });
        break;

      case "tasks":
        // Task list received from server
        setTasks(lastMessage.tasks);
        break;

      case "task_toggled": {
        // Task toggle confirmed - clear from pending toggles
        const taskKey = `${lastMessage.filePath}:${lastMessage.lineNumber}`;
        pendingTaskTogglesRef.current.delete(taskKey);
        // Update task with confirmed new state
        updateTask(lastMessage.filePath, lastMessage.lineNumber, lastMessage.newState);
        break;
      }
    }
  }, [lastMessage, cacheDirectory, setFileContent, setFileError, setFileLoading, saveSuccess, saveError, sendMessage, setTasks, updateTask, setTasksError]);

  // Handle directory load request from FileTree
  const handleLoadDirectory = useCallback(
    (path: string) => {
      setFileLoading(true);
      sendMessage({ type: "list_directory", path });
    },
    [sendMessage, setFileLoading]
  );

  // Handle file selection from FileTree
  const handleFileSelect = useCallback(
    (path: string) => {
      setFileLoading(true);
      sendMessage({ type: "read_file", path });
    },
    [sendMessage, setFileLoading]
  );

  // Handle navigation from MarkdownViewer (wiki-links)
  const handleNavigate = useCallback(
    (path: string) => {
      if (path) {
        setFileLoading(true);
        sendMessage({ type: "read_file", path });
      }
    },
    [sendMessage, setFileLoading]
  );

  // Handle save from MarkdownViewer adjust mode
  const handleSave = useCallback(
    (content: string) => {
      if (!browser.currentPath) return;

      // Start save operation (sets isSaving state)
      startSave();

      // Send write_file message to backend
      sendMessage({
        type: "write_file",
        path: browser.currentPath,
        content,
      });
    },
    [browser.currentPath, sendMessage, startSave]
  );

  // Toggle tree collapse state
  const toggleTreeCollapse = useCallback(() => {
    setIsTreeCollapsed((prev) => !prev);
  }, []);

  // Reload file tree (clear cache and refetch root, preserves pinned folders)
  const handleReload = useCallback(() => {
    clearDirectoryCache();
    setFileLoading(true);
    sendMessage({ type: "list_directory", path: "" });
  }, [clearDirectoryCache, setFileLoading, sendMessage]);

  // Toggle mobile tree overlay
  const toggleMobileTree = useCallback(() => {
    setIsMobileTreeOpen((prev) => !prev);
  }, []);

  // Close mobile tree overlay
  const closeMobileTree = useCallback(() => {
    setIsMobileTreeOpen(false);
  }, []);

  // Toggle view mode between files and tasks
  const toggleViewMode = useCallback(() => {
    const newMode: BrowseViewMode = viewMode === "files" ? "tasks" : "files";
    setViewMode(newMode);
  }, [viewMode, setViewMode]);

  // Handle task toggle from TaskList
  const handleToggleTask = useCallback(
    (filePath: string, lineNumber: number) => {
      // Store original state for rollback (get from current tasks)
      const task = browser.tasks.find(
        (t) => t.filePath === filePath && t.lineNumber === lineNumber
      );
      if (task) {
        const taskKey = `${filePath}:${lineNumber}`;
        pendingTaskTogglesRef.current.set(taskKey, task.state);
      }

      // Send toggle request to server
      sendMessage({
        type: "toggle_task",
        filePath,
        lineNumber,
      });
    },
    [browser.tasks, sendMessage]
  );

  // Get the view mode title text
  const viewModeTitle = viewMode === "files" ? "Files" : "Tasks";

  return (
    <div className={`browse-mode ${isTreeCollapsed ? "browse-mode--tree-collapsed" : ""}`}>
      {/* Desktop tree pane */}
      <aside className="browse-mode__tree-pane">
        <div className="browse-mode__tree-header">
          <button
            type="button"
            className="browse-mode__tree-title browse-mode__tree-title--clickable"
            onClick={toggleViewMode}
            aria-label={`Switch to ${viewMode === "files" ? "tasks" : "files"} view`}
          >
            {viewModeTitle}
          </button>
          <div className="browse-mode__header-actions">
            {!isTreeCollapsed && (
              <button
                type="button"
                className="browse-mode__reload-btn"
                onClick={handleReload}
                aria-label="Reload file tree"
              >
                ♻
              </button>
            )}
            <button
              type="button"
              className="browse-mode__collapse-btn"
              onClick={toggleTreeCollapse}
              aria-label={isTreeCollapsed ? "Expand file tree" : "Collapse file tree"}
              aria-expanded={!isTreeCollapsed}
            >
              <CollapseIcon isCollapsed={isTreeCollapsed} />
            </button>
          </div>
        </div>
        {!isTreeCollapsed && (
          <div className="browse-mode__tree-content">
            {viewMode === "files" ? (
              <FileTree onFileSelect={handleFileSelect} onLoadDirectory={handleLoadDirectory} />
            ) : (
              <TaskList onToggleTask={handleToggleTask} onFileSelect={handleFileSelect} />
            )}
          </div>
        )}
      </aside>

      {/* Viewer pane */}
      <main className="browse-mode__viewer-pane">
        <div className="browse-mode__viewer-header">
          <button
            type="button"
            className="browse-mode__mobile-menu-btn"
            onClick={toggleMobileTree}
            aria-label="Open file browser"
          >
            <MenuIcon />
          </button>
          <span className="browse-mode__current-file">
            {browser.currentPath || "No file selected"}
          </span>
        </div>
        <div className="browse-mode__viewer-content">
          <MarkdownViewer onNavigate={handleNavigate} assetBaseUrl={assetBaseUrl} onSave={handleSave} />
        </div>
      </main>

      {/* Mobile tree overlay */}
      {isMobileTreeOpen && (
        <>
          <div
            className="browse-mode__overlay"
            onClick={closeMobileTree}
            aria-hidden="true"
          />
          <aside className="browse-mode__mobile-tree">
            <div className="browse-mode__mobile-tree-header">
              <button
                type="button"
                className="browse-mode__tree-title browse-mode__tree-title--clickable"
                onClick={toggleViewMode}
                aria-label={`Switch to ${viewMode === "files" ? "tasks" : "files"} view`}
              >
                {viewModeTitle}
              </button>
              <div className="browse-mode__header-actions">
                <button
                  type="button"
                  className="browse-mode__reload-btn"
                  onClick={handleReload}
                  aria-label="Reload file tree"
                >
                  ♻
                </button>
                <button
                  type="button"
                  className="browse-mode__close-btn"
                  onClick={closeMobileTree}
                  aria-label="Close file browser"
                >
                  <CloseIcon />
                </button>
              </div>
            </div>
            <div className="browse-mode__tree-content">
              {viewMode === "files" ? (
                <FileTree onFileSelect={handleFileSelect} onLoadDirectory={handleLoadDirectory} />
              ) : (
                <TaskList onToggleTask={handleToggleTask} onFileSelect={handleFileSelect} />
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

/**
 * Collapse/expand icon for tree pane toggle.
 */
function CollapseIcon({ isCollapsed }: { isCollapsed: boolean }): React.ReactNode {
  return (
    <svg
      className="browse-mode__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {isCollapsed ? (
        <polyline points="9 18 15 12 9 6" />
      ) : (
        <polyline points="15 18 9 12 15 6" />
      )}
    </svg>
  );
}

/**
 * Menu icon for mobile tree toggle.
 */
function MenuIcon(): React.ReactNode {
  return (
    <svg
      className="browse-mode__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

/**
 * Close icon for mobile tree dismiss.
 */
function CloseIcon(): React.ReactNode {
  return (
    <svg
      className="browse-mode__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
