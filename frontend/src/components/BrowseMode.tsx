/**
 * BrowseMode Component
 *
 * Split-pane container that coordinates FileTree and MarkdownViewer.
 * Supports collapsible tree panel and mobile-friendly overlay.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession, useServerMessageHandler } from "../contexts/SessionContext";
import type { BrowseViewMode, SearchMode } from "../contexts/SessionContext";
import { useWebSocket } from "../hooks/useWebSocket";
import { FileTree } from "./FileTree";
import { TaskList } from "./TaskList";
import { MarkdownViewer } from "./MarkdownViewer";
import { ImageViewer } from "./ImageViewer";
import { VideoViewer } from "./VideoViewer";
import { PdfViewer } from "./PdfViewer";
import { JsonViewer } from "./JsonViewer";
import { TxtViewer } from "./TxtViewer";
import { CsvViewer } from "./CsvViewer";
import { DownloadViewer } from "./DownloadViewer";
import { SearchHeader } from "./SearchHeader";
import { SearchResults } from "./SearchResults";
import { WidgetRenderer } from "./widgets";
import { isImageFile, isVideoFile, isPdfFile, isMarkdownFile, isJsonFile, isTxtFile, isCsvFile, hasSupportedViewer } from "../utils/file-types";
import type { FileSearchResult, ContentSearchResult } from "@memory-loop/shared";
import "./BrowseMode.css";

/** Error codes that indicate save failure for adjust mode */
const SAVE_ERROR_CODES = ["PATH_TRAVERSAL", "INVALID_FILE_TYPE", "FILE_NOT_FOUND", "INTERNAL_ERROR"] as const;

/** Storage key for discussion draft (shared with Discussion component) */
const DISCUSSION_DRAFT_STORAGE_KEY = "memory-loop-discussion-draft";

/**
 * BrowseMode provides a split-pane view for browsing vault files.
 *
 * Features:
 * - CSS Grid layout with collapsible tree pane
 * - Mobile overlay mode for tree navigation
 * - Automatic root directory loading on mount
 * - Coordinates file selection between tree and viewer
 */
export function BrowseMode(): React.ReactNode {
  const [isTreeCollapsed, setIsTreeCollapsed] = useState(false);
  const [isMobileTreeOpen, setIsMobileTreeOpen] = useState(false);
  const [isWidgetsPanelCollapsed, setIsWidgetsPanelCollapsed] = useState(false);

  const hasSentVaultSelectionRef = useRef(false);
  const [hasSessionReady, setHasSessionReady] = useState(false);

  const { browser, vault, widgets, cacheDirectory, clearDirectoryCache, setCurrentPath, setFileContent, setFileError, setFileLoading, startSave, saveSuccess, saveError, setViewMode, setTasks, setTasksLoading, setTasksError, updateTask, setSearchActive, setSearchMode, setSearchQuery, setSearchResults, setSearchLoading, toggleResultExpanded, setSnippets, clearSearch, setMode, setRecallWidgetsLoading, addPendingEdit } = useSession();

  // Construct asset base URL with vaultId for image serving
  const assetBaseUrl = vault ? `/vault/${vault.id}/assets` : "/vault/assets";

  const { viewMode } = browser;

  // Track saving state in a ref to avoid stale closures in WebSocket message handler
  const isSavingRef = useRef(browser.isSaving);
  isSavingRef.current = browser.isSaving;

  // Track pending task toggles for rollback on error
  const pendingTaskTogglesRef = useRef<Map<string, string>>(new Map());

  // Hook to handle session-level messages (widgets, etc.)
  const handleServerMessage = useServerMessageHandler();

  // Callback to re-send vault selection on WebSocket reconnect
  const handleReconnect = useCallback(() => {
    hasSentVaultSelectionRef.current = false;
    setHasSessionReady(false);
  }, []);

  // Handle incoming messages - route to server message handler for session-level processing
  const handleMessage = useCallback(
    (message: import("@memory-loop/shared").ServerMessage) => {
      handleServerMessage(message);
    },
    [handleServerMessage]
  );

  const { sendMessage, lastMessage, connectionStatus, sendSearchFiles, sendSearchContent, sendGetSnippets } = useWebSocket({
    onReconnect: handleReconnect,
    onMessage: handleMessage,
  });

  // Destructure search state for convenience
  const { search } = browser;

  // Clear search state on WebSocket disconnect (REQ-F-26 error handling)
  // This ensures stale search results aren't shown when connection is lost
  useEffect(() => {
    if (connectionStatus === "disconnected" && search.isActive) {
      clearSearch();
    }
  }, [connectionStatus, search.isActive, clearSearch]);

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
  // Only load text files (markdown, JSON) - images are rendered directly via asset URL
  const hasAutoLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    const path = browser.currentPath;

    // Skip if no path or not ready
    if (!hasSessionReady || !path) {
      hasAutoLoadedRef.current = null;
      return;
    }

    // Media files (images, videos, PDFs) don't need loading - they render directly from asset URL
    if (isImageFile(path) || isVideoFile(path) || isPdfFile(path)) {
      hasAutoLoadedRef.current = null;
      return;
    }

    // Unsupported files don't need loading - DownloadViewer uses asset URL directly
    if (!hasSupportedViewer(path)) {
      hasAutoLoadedRef.current = null;
      return;
    }

    // Check if this is a text file that needs loading
    const isTextFile = isMarkdownFile(path) || isJsonFile(path) || isTxtFile(path) || isCsvFile(path);

    // For text files, auto-load if not already loaded
    if (
      isTextFile &&
      browser.currentFileContent === null &&
      !browser.fileError &&
      !browser.isLoading &&
      hasAutoLoadedRef.current !== path
    ) {
      hasAutoLoadedRef.current = path;
      setFileLoading(true);
      sendMessage({ type: "read_file", path });
      return;
    }

    // Reset ref when conditions aren't met (allows reload on future navigation)
    if (!isTextFile || browser.currentFileContent !== null || browser.fileError || browser.isLoading) {
      hasAutoLoadedRef.current = null;
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
        // Re-request recall widgets in case file frontmatter changed
        setRecallWidgetsLoading(true);
        sendMessage({ type: "get_recall_widgets", path: lastMessage.path });
        break;

      case "file_deleted": {
        // File deleted - refresh parent directory and clear view if needed
        const deletedPath = lastMessage.path;
        const parentPath = deletedPath.includes("/")
          ? deletedPath.substring(0, deletedPath.lastIndexOf("/"))
          : "";
        // Refresh the parent directory listing
        sendMessage({ type: "list_directory", path: parentPath });
        // If the deleted file was currently being viewed, clear the view
        if (browser.currentPath === deletedPath) {
          setCurrentPath("");
          setFileContent("", false);
        }
        break;
      }

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

      case "search_results":
        // Update search results based on mode
        if (lastMessage.mode === "files") {
          setSearchResults("files", lastMessage.results as FileSearchResult[]);
        } else {
          setSearchResults("content", undefined, lastMessage.results as ContentSearchResult[]);
        }
        setSearchLoading(false);
        break;

      case "snippets":
        // Update snippets cache for the specified file
        setSnippets(lastMessage.path, lastMessage.snippets);
        break;
    }
  }, [lastMessage, cacheDirectory, setFileContent, setFileError, setFileLoading, saveSuccess, saveError, sendMessage, setTasks, updateTask, setTasksError, setSearchResults, setSearchLoading, setSnippets, browser.currentPath, setCurrentPath]);

  // Handle directory load request from FileTree
  const handleLoadDirectory = useCallback(
    (path: string) => {
      setFileLoading(true);
      sendMessage({ type: "list_directory", path });
    },
    [sendMessage, setFileLoading]
  );

  // Handle file deletion from FileTree context menu
  const handleDeleteFile = useCallback(
    (path: string) => {
      sendMessage({ type: "delete_file", path });
    },
    [sendMessage]
  );

  // Handle "Think about" from FileTree context menu
  // Appends file path to discussion draft and navigates to Think tab
  const handleThinkAbout = useCallback(
    (path: string) => {
      // Get current draft from localStorage
      const currentDraft = localStorage.getItem(DISCUSSION_DRAFT_STORAGE_KEY) || "";

      // Append the file path to the draft
      const newDraft = currentDraft.trim()
        ? `${currentDraft.trim()}\n${path}`
        : path;

      // Save back to localStorage
      localStorage.setItem(DISCUSSION_DRAFT_STORAGE_KEY, newDraft);

      // Navigate to Think (discussion) mode
      setMode("discussion");
    },
    [setMode]
  );

  // Handle file selection from FileTree
  const handleFileSelect = useCallback(
    (path: string) => {
      // For media files (images, videos, PDFs), just set the path - we render directly via asset URL
      if (isImageFile(path) || isVideoFile(path) || isPdfFile(path)) {
        setCurrentPath(path);
        // Request recall widgets for the file (backend filters by source pattern)
        setRecallWidgetsLoading(true);
        sendMessage({ type: "get_recall_widgets", path });
        return;
      }
      // For unsupported files, just set the path - DownloadViewer uses asset URL directly
      if (!hasSupportedViewer(path)) {
        setCurrentPath(path);
        // Request recall widgets for the file (backend filters by source pattern)
        setRecallWidgetsLoading(true);
        sendMessage({ type: "get_recall_widgets", path });
        return;
      }
      // For text files (markdown, JSON, txt, csv), request content from backend
      setFileLoading(true);
      sendMessage({ type: "read_file", path });
      // Request recall widgets for the file (backend filters by source pattern)
      setRecallWidgetsLoading(true);
      sendMessage({ type: "get_recall_widgets", path });
    },
    [sendMessage, setFileLoading, setCurrentPath, setRecallWidgetsLoading]
  );

  // Handle navigation from MarkdownViewer (wiki-links)
  const handleNavigate = useCallback(
    (path: string) => {
      if (path) {
        setFileLoading(true);
        sendMessage({ type: "read_file", path });
        // Request recall widgets for the navigated file
        setRecallWidgetsLoading(true);
        sendMessage({ type: "get_recall_widgets", path });
      }
    },
    [sendMessage, setFileLoading, setRecallWidgetsLoading]
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

  // Handle widget edit from recall widgets
  const handleWidgetEdit = useCallback(
    (filePath: string, fieldPath: string, value: unknown) => {
      // Optimistic update - track pending edit
      addPendingEdit(filePath, fieldPath, value);
      // Send edit to server
      sendMessage({
        type: "widget_edit",
        path: filePath,
        field: fieldPath,
        value,
      });
    },
    [sendMessage, addPendingEdit]
  );

  // Toggle tree collapse state
  const toggleTreeCollapse = useCallback(() => {
    setIsTreeCollapsed((prev) => !prev);
  }, []);

  // Reload file tree and task list (clear cache and refetch, preserves pinned folders)
  const handleReload = useCallback(() => {
    clearDirectoryCache();
    setFileLoading(true);
    sendMessage({ type: "list_directory", path: "" });
    // Also refresh task list
    setTasksLoading(true);
    sendMessage({ type: "get_tasks" });
  }, [clearDirectoryCache, setFileLoading, setTasksLoading, sendMessage]);

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
  // Returns true if message was sent, false if unable to send (e.g., disconnected)
  const handleToggleTask = useCallback(
    (filePath: string, lineNumber: number, newState: string, originalState: string): boolean => {
      // Check connection status before attempting to send
      if (connectionStatus !== "connected") {
        setTasksError("Not connected. Please wait and try again.");
        return false;
      }

      // Store original state for rollback on server error
      const taskKey = `${filePath}:${lineNumber}`;
      pendingTaskTogglesRef.current.set(taskKey, originalState);

      // Send toggle request to server with the desired new state
      sendMessage({
        type: "toggle_task",
        filePath,
        lineNumber,
        newState,
      });

      return true;
    },
    [sendMessage, connectionStatus, setTasksError]
  );

  // Handle search query change - send WebSocket request
  const handleSearchQueryChange = useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (query.trim()) {
        setSearchLoading(true);
        if (search.mode === "files") {
          sendSearchFiles(query);
        } else {
          sendSearchContent(query);
        }
      }
    },
    [search.mode, setSearchQuery, setSearchLoading, sendSearchFiles, sendSearchContent]
  );

  // Handle search mode change - re-search if query exists
  const handleSearchModeChange = useCallback(
    (mode: SearchMode) => {
      setSearchMode(mode);
      if (search.query.trim()) {
        setSearchLoading(true);
        if (mode === "files") {
          sendSearchFiles(search.query);
        } else {
          sendSearchContent(search.query);
        }
      }
    },
    [search.query, setSearchMode, setSearchLoading, sendSearchFiles, sendSearchContent]
  );

  // Handle clear search
  const handleClearSearch = useCallback(() => {
    clearSearch();
  }, [clearSearch]);

  // Handle result expansion toggle
  const handleToggleExpand = useCallback(
    (path: string) => {
      toggleResultExpanded(path);
    },
    [toggleResultExpanded]
  );

  // Handle request for snippets (lazy load on expand)
  const handleRequestSnippets = useCallback(
    (path: string) => {
      sendGetSnippets(path, search.query);
    },
    [search.query, sendGetSnippets]
  );

  // Get the view mode title text
  const viewModeTitle = viewMode === "files" ? "Files" : "Tasks";

  return (
    <div className={`browse-mode ${isTreeCollapsed ? "browse-mode--tree-collapsed" : ""}`}>
      {/* Desktop tree pane */}
      <aside className="browse-mode__tree-pane">
        {search.isActive ? (
          <SearchHeader
            mode={search.mode}
            query={search.query}
            isLoading={search.isLoading}
            onQueryChange={handleSearchQueryChange}
            onModeChange={handleSearchModeChange}
            onClear={handleClearSearch}
          />
        ) : (
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
                <>
                  <button
                    type="button"
                    className="browse-mode__search-btn"
                    onClick={() => setSearchActive(true)}
                    aria-label="Search files"
                  >
                    <SearchIcon />
                  </button>
                  <button
                    type="button"
                    className="browse-mode__reload-btn"
                    onClick={handleReload}
                    aria-label="Reload file tree"
                  >
                    ♻
                  </button>
                </>
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
        )}
        {!isTreeCollapsed && (
          <div className="browse-mode__tree-content">
            {search.isActive ? (
              <SearchResults
                mode={search.mode}
                fileResults={search.fileResults}
                contentResults={search.contentResults}
                isLoading={search.isLoading}
                query={search.query}
                expandedPaths={search.expandedPaths}
                snippetsCache={search.snippetsCache}
                onFileSelect={handleFileSelect}
                onToggleExpand={handleToggleExpand}
                onRequestSnippets={handleRequestSnippets}
              />
            ) : viewMode === "files" ? (
              <FileTree onFileSelect={handleFileSelect} onLoadDirectory={handleLoadDirectory} onDeleteFile={handleDeleteFile} onThinkAbout={handleThinkAbout} />
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
          {isImageFile(browser.currentPath) ? (
            <ImageViewer path={browser.currentPath} assetBaseUrl={assetBaseUrl} />
          ) : isVideoFile(browser.currentPath) ? (
            <VideoViewer path={browser.currentPath} assetBaseUrl={assetBaseUrl} />
          ) : isPdfFile(browser.currentPath) ? (
            <PdfViewer path={browser.currentPath} assetBaseUrl={assetBaseUrl} />
          ) : isJsonFile(browser.currentPath) ? (
            <JsonViewer onNavigate={handleNavigate} onSave={handleSave} />
          ) : isTxtFile(browser.currentPath) ? (
            <TxtViewer onNavigate={handleNavigate} onSave={handleSave} />
          ) : isCsvFile(browser.currentPath) ? (
            <CsvViewer onNavigate={handleNavigate} />
          ) : isMarkdownFile(browser.currentPath) || !browser.currentPath ? (
            <MarkdownViewer onNavigate={handleNavigate} assetBaseUrl={assetBaseUrl} onSave={handleSave} />
          ) : (
            <DownloadViewer path={browser.currentPath} assetBaseUrl={assetBaseUrl} />
          )}
        </div>
        {/* Recall Widgets - collapsible panel shown when viewing files that match widget source patterns */}
        {browser.currentPath && (widgets.isRecallLoading || widgets.recallError || (widgets.recallWidgets.length > 0 && widgets.recallFilePath === browser.currentPath)) && (
          <div className={`browse-mode__recall-widgets ${isWidgetsPanelCollapsed ? "browse-mode__recall-widgets--collapsed" : ""}`}>
            <button
              type="button"
              className="browse-mode__recall-widgets-header"
              onClick={() => setIsWidgetsPanelCollapsed(!isWidgetsPanelCollapsed)}
              aria-expanded={!isWidgetsPanelCollapsed}
              aria-controls="recall-widgets-content"
            >
              <span className="browse-mode__recall-widgets-title">
                Widgets
                {!widgets.isRecallLoading && widgets.recallWidgets.length > 0 && (
                  <span className="browse-mode__recall-widgets-count">({widgets.recallWidgets.length})</span>
                )}
              </span>
              <span className={`browse-mode__recall-widgets-chevron ${isWidgetsPanelCollapsed ? "browse-mode__recall-widgets-chevron--collapsed" : ""}`}>
                ▼
              </span>
            </button>
            {!isWidgetsPanelCollapsed && (
              <div id="recall-widgets-content" className="browse-mode__recall-widgets-content">
                {widgets.isRecallLoading ? (
                  <div className="browse-mode__recall-widgets-loading" aria-label="Loading widgets">
                    <div className="browse-mode__widget-skeleton" aria-hidden="true" />
                  </div>
                ) : widgets.recallError ? (
                  <div className="browse-mode__recall-widgets-error" aria-label="Widget error">
                    <p className="browse-mode__error">{widgets.recallError}</p>
                  </div>
                ) : (
                  <section className="browse-mode__widgets" aria-label="File widgets">
                    {widgets.recallWidgets.map((widget) => (
                      <WidgetRenderer
                        key={widget.name}
                        widget={widget}
                        filePath={browser.currentPath}
                        onEdit={handleWidgetEdit}
                        pendingEdits={widgets.pendingEdits}
                        editError={widgets.recallError}
                      />
                    ))}
                  </section>
                )}
              </div>
            )}
          </div>
        )}
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
            {search.isActive ? (
              <SearchHeader
                mode={search.mode}
                query={search.query}
                isLoading={search.isLoading}
                onQueryChange={handleSearchQueryChange}
                onModeChange={handleSearchModeChange}
                onClear={handleClearSearch}
              />
            ) : (
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
                    className="browse-mode__search-btn"
                    onClick={() => setSearchActive(true)}
                    aria-label="Search files"
                  >
                    <SearchIcon />
                  </button>
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
            )}
            <div className="browse-mode__tree-content">
              {search.isActive ? (
                <SearchResults
                  mode={search.mode}
                  fileResults={search.fileResults}
                  contentResults={search.contentResults}
                  isLoading={search.isLoading}
                  query={search.query}
                  expandedPaths={search.expandedPaths}
                  snippetsCache={search.snippetsCache}
                  onFileSelect={handleFileSelect}
                  onToggleExpand={handleToggleExpand}
                  onRequestSnippets={handleRequestSnippets}
                />
              ) : viewMode === "files" ? (
                <FileTree onFileSelect={handleFileSelect} onLoadDirectory={handleLoadDirectory} onDeleteFile={handleDeleteFile} onThinkAbout={handleThinkAbout} />
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

/**
 * Search icon for search button.
 */
function SearchIcon(): React.ReactNode {
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
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
