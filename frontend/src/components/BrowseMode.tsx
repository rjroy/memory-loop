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
import type { DirectoryContents } from "./FileTree";
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
import { PairWritingMode } from "./PairWritingMode";
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
  const [pendingDirectoryContents, setPendingDirectoryContents] = useState<DirectoryContents | null>(null);
  const [isPairWritingActive, setIsPairWritingActive] = useState(false);

  const hasSentVaultSelectionRef = useRef(false);
  const [hasSessionReady, setHasSessionReady] = useState(false);

  const { browser, vault, cacheDirectory, clearDirectoryCache, setCurrentPath, setFileContent, setFileError, setFileLoading, startSave, saveSuccess, saveError, setViewMode, setTasks, setTasksLoading, setTasksError, updateTask, setSearchActive, setSearchMode, setSearchQuery, setSearchResults, setSearchLoading, toggleResultExpanded, setSnippets, clearSearch, setMode } = useSession();

  // Construct asset base URL with vaultId for image serving
  const assetBaseUrl = vault ? `/vault/${vault.id}/assets` : "/vault/assets";

  const { viewMode } = browser;

  // Track saving state in a ref to avoid stale closures in WebSocket message handler
  const isSavingRef = useRef(browser.isSaving);
  isSavingRef.current = browser.isSaving;

  // Track pending task toggles for rollback on error
  const pendingTaskTogglesRef = useRef<Map<string, string>>(new Map());

  // Track isPairWritingActive in a ref for use in callbacks without stale closures
  const isPairWritingActiveRef = useRef(isPairWritingActive);
  isPairWritingActiveRef.current = isPairWritingActive;

  // Set data attribute on document for CSS styling (full-width layout in pair writing mode)
  useEffect(() => {
    if (isPairWritingActive) {
      document.documentElement.dataset.pairWriting = "true";
    } else {
      delete document.documentElement.dataset.pairWriting;
    }
    return () => {
      delete document.documentElement.dataset.pairWriting;
    };
  }, [isPairWritingActive]);

  // Hook to handle session-level messages (widgets, etc.)
  const handleServerMessage = useServerMessageHandler();

  // Callback to re-send vault selection on WebSocket reconnect
  const handleReconnect = useCallback(() => {
    hasSentVaultSelectionRef.current = false;
    setHasSessionReady(false);
  }, []);

  // Streaming message types that Discussion handles when PairWritingMode is active
  const STREAMING_MESSAGE_TYPES = new Set([
    "response_start",
    "response_chunk",
    "response_end",
    "tool_start",
    "tool_input",
    "tool_end",
  ]);

  // Handle incoming messages - route to server message handler for session-level processing
  // Skip streaming messages when PairWritingMode is active (Discussion handles those)
  const handleMessage = useCallback(
    (message: import("@memory-loop/shared").ServerMessage) => {
      // When PairWritingMode is active, Discussion handles streaming messages
      // via its shared connection. Skip them here to avoid double processing.
      if (isPairWritingActiveRef.current && STREAMING_MESSAGE_TYPES.has(message.type)) {
        return;
      }
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

  // Load pinned assets from server after session is ready
  const hasFetchedPinnedAssetsRef = useRef(false);
  useEffect(() => {
    if (vault && hasSessionReady && !hasFetchedPinnedAssetsRef.current) {
      hasFetchedPinnedAssetsRef.current = true;
      sendMessage({ type: "get_pinned_assets" });
    }
  }, [vault, hasSessionReady, sendMessage]);

  // Reset pinned assets fetch flag on vault change or reconnect
  useEffect(() => {
    if (!hasSessionReady) {
      hasFetchedPinnedAssetsRef.current = false;
    }
  }, [hasSessionReady]);

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

      case "directory_contents":
        // Directory contents received - update state for delete confirmation dialog
        setPendingDirectoryContents({
          files: lastMessage.files,
          directories: lastMessage.directories,
          totalFiles: lastMessage.totalFiles,
          totalDirectories: lastMessage.totalDirectories,
          truncated: lastMessage.truncated,
        });
        break;

      case "directory_deleted": {
        // Directory deleted - refresh parent directory and clear view if needed
        const deletedDirPath = lastMessage.path;
        const parentDirPath = deletedDirPath.includes("/")
          ? deletedDirPath.substring(0, deletedDirPath.lastIndexOf("/"))
          : "";
        // Refresh the parent directory listing
        sendMessage({ type: "list_directory", path: parentDirPath });
        // If the deleted directory or its contents were being viewed, clear the view
        if (browser.currentPath === deletedDirPath || browser.currentPath.startsWith(deletedDirPath + "/")) {
          setCurrentPath("");
          setFileContent("", false);
        }
        break;
      }

      case "file_archived": {
        // Directory archived - refresh parent directory and clear view if needed
        const archivedPath = lastMessage.path;
        const parentPath = archivedPath.includes("/")
          ? archivedPath.substring(0, archivedPath.lastIndexOf("/"))
          : "";
        // Refresh the parent directory listing
        sendMessage({ type: "list_directory", path: parentPath });
        // If the archived directory or its contents were being viewed, clear the view
        if (browser.currentPath === archivedPath || browser.currentPath.startsWith(archivedPath + "/")) {
          setCurrentPath("");
          setFileContent("", false);
        }
        break;
      }

      case "directory_created": {
        // Directory created - refresh the parent directory where it was created
        const createdPath = lastMessage.path;
        const parentPath = createdPath.includes("/")
          ? createdPath.substring(0, createdPath.lastIndexOf("/"))
          : "";
        // Refresh the parent directory listing
        sendMessage({ type: "list_directory", path: parentPath });
        break;
      }

      case "file_created": {
        // File created - refresh the parent directory where it was created
        const createdPath = lastMessage.path;
        const parentPath = createdPath.includes("/")
          ? createdPath.substring(0, createdPath.lastIndexOf("/"))
          : "";
        // Refresh the parent directory listing
        sendMessage({ type: "list_directory", path: parentPath });
        break;
      }

      case "file_renamed": {
        // File/directory renamed - refresh the parent directory
        const newPath = lastMessage.newPath;
        const parentPath = newPath.includes("/")
          ? newPath.substring(0, newPath.lastIndexOf("/"))
          : "";
        // Refresh the parent directory listing
        sendMessage({ type: "list_directory", path: parentPath });
        // If the renamed file was currently being viewed, update the path
        if (browser.currentPath === lastMessage.oldPath) {
          setCurrentPath(newPath);
        }
        // If a file inside a renamed directory was being viewed, update the path
        else if (browser.currentPath.startsWith(lastMessage.oldPath + "/")) {
          const relativePath = browser.currentPath.substring(lastMessage.oldPath.length);
          setCurrentPath(newPath + relativePath);
        }
        break;
      }

      case "file_moved": {
        // File/directory moved - refresh both source and destination directories
        const oldPath = lastMessage.oldPath;
        const newPath = lastMessage.newPath;
        const sourceParent = oldPath.includes("/")
          ? oldPath.substring(0, oldPath.lastIndexOf("/"))
          : "";
        const destParent = newPath.includes("/")
          ? newPath.substring(0, newPath.lastIndexOf("/"))
          : "";
        // Refresh the source parent directory listing
        sendMessage({ type: "list_directory", path: sourceParent });
        // Refresh the destination parent if different from source
        if (destParent !== sourceParent) {
          sendMessage({ type: "list_directory", path: destParent });
        }
        // If the moved file was currently being viewed, update the path
        if (browser.currentPath === oldPath) {
          setCurrentPath(newPath);
        }
        // If a file inside a moved directory was being viewed, update the path
        else if (browser.currentPath.startsWith(oldPath + "/")) {
          const relativePath = browser.currentPath.substring(oldPath.length);
          setCurrentPath(newPath + relativePath);
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

  // Handle directory contents request for delete preview
  const handleGetDirectoryContents = useCallback(
    (path: string) => {
      setPendingDirectoryContents(null);
      sendMessage({ type: "get_directory_contents", path });
    },
    [sendMessage]
  );

  // Handle directory deletion from FileTree context menu
  const handleDeleteDirectory = useCallback(
    (path: string) => {
      sendMessage({ type: "delete_directory", path });
      setPendingDirectoryContents(null);
    },
    [sendMessage]
  );

  // Handle directory archive from FileTree context menu
  const handleArchiveFile = useCallback(
    (path: string) => {
      sendMessage({ type: "archive_file", path });
    },
    [sendMessage]
  );

  // Handle directory creation from FileTree context menu
  const handleCreateDirectory = useCallback(
    (parentPath: string, name: string) => {
      sendMessage({ type: "create_directory", path: parentPath, name });
    },
    [sendMessage]
  );

  // Handle file creation from FileTree context menu
  const handleCreateFile = useCallback(
    (parentPath: string, name: string) => {
      sendMessage({ type: "create_file", path: parentPath, name });
    },
    [sendMessage]
  );

  // Handle file/directory rename from FileTree context menu
  const handleRenameFile = useCallback(
    (path: string, newName: string) => {
      sendMessage({ type: "rename_file", path, newName });
    },
    [sendMessage]
  );

  // Handle file/directory move from FileTree context menu
  const handleMoveFile = useCallback(
    (path: string, newPath: string) => {
      sendMessage({ type: "move_file", path, newPath });
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
        return;
      }
      // For unsupported files, just set the path - DownloadViewer uses asset URL directly
      if (!hasSupportedViewer(path)) {
        setCurrentPath(path);
        return;
      }
      // For text files (markdown, JSON, txt, csv), request content from backend
      setCurrentPath(path);
      setFileLoading(true);
      sendMessage({ type: "read_file", path });
    },
    [sendMessage, setFileLoading, setCurrentPath]
  );

  // Handle navigation from MarkdownViewer (wiki-links)
  const handleNavigate = useCallback(
    (path: string) => {
      if (path) {
        setCurrentPath(path);
        setFileLoading(true);
        sendMessage({ type: "read_file", path });
      }
    },
    [sendMessage, setCurrentPath, setFileLoading]
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

  // Handle pinned assets change from FileTree - sync to server
  const handlePinnedAssetsChange = useCallback(
    (paths: string[]) => {
      sendMessage({ type: "set_pinned_assets", paths });
    },
    [sendMessage]
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

  // Enter Pair Writing Mode (REQ-F-9)
  const handleEnterPairWriting = useCallback(() => {
    setIsPairWritingActive(true);
  }, []);

  // Exit Pair Writing Mode and return to standard Browse view (REQ-F-14)
  const handleExitPairWriting = useCallback(() => {
    setIsPairWritingActive(false);
  }, []);

  // Get the view mode title text
  const viewModeTitle = viewMode === "files" ? "Files" : "Tasks";

  // Check if current file is a markdown file (for Pair Writing button visibility)
  const isCurrentFileMarkdown = isMarkdownFile(browser.currentPath);

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
              <FileTree onFileSelect={handleFileSelect} onLoadDirectory={handleLoadDirectory} onDeleteFile={handleDeleteFile} onDeleteDirectory={handleDeleteDirectory} onGetDirectoryContents={handleGetDirectoryContents} pendingDirectoryContents={pendingDirectoryContents} onArchiveFile={handleArchiveFile} onThinkAbout={handleThinkAbout} onPinnedAssetsChange={handlePinnedAssetsChange} onCreateDirectory={handleCreateDirectory} onCreateFile={handleCreateFile} onRenameFile={handleRenameFile} onMoveFile={handleMoveFile} />
            ) : (
              <TaskList onToggleTask={handleToggleTask} onFileSelect={handleFileSelect} />
            )}
          </div>
        )}
      </aside>

      {/* Viewer pane */}
      <main className="browse-mode__viewer-pane">
        {/* Mobile header - only shown when no file is selected */}
        {!browser.currentPath && (
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
              No file selected
            </span>
          </div>
        )}
        <article className="browse-mode__viewer-content">
          {/* Pair Writing Mode takes over the viewer when active (REQ-F-11) */}
          {isPairWritingActive && isCurrentFileMarkdown && browser.currentFileContent !== null ? (
            <PairWritingMode
              filePath={browser.currentPath}
              content={browser.currentFileContent}
              assetBaseUrl={assetBaseUrl}
              onExit={handleExitPairWriting}
              onSave={handleSave}
              sendMessage={sendMessage}
              lastMessage={lastMessage}
              connectionStatus={connectionStatus}
              onQuickActionComplete={handleNavigate}
            />
          ) : isImageFile(browser.currentPath) ? (
            <ImageViewer path={browser.currentPath} assetBaseUrl={assetBaseUrl} onMobileMenuClick={toggleMobileTree} />
          ) : isVideoFile(browser.currentPath) ? (
            <VideoViewer path={browser.currentPath} assetBaseUrl={assetBaseUrl} onMobileMenuClick={toggleMobileTree} />
          ) : isPdfFile(browser.currentPath) ? (
            <PdfViewer path={browser.currentPath} assetBaseUrl={assetBaseUrl} onMobileMenuClick={toggleMobileTree} />
          ) : isJsonFile(browser.currentPath) ? (
            <JsonViewer onNavigate={handleNavigate} onSave={handleSave} onMobileMenuClick={toggleMobileTree} />
          ) : isTxtFile(browser.currentPath) ? (
            <TxtViewer onNavigate={handleNavigate} onSave={handleSave} onMobileMenuClick={toggleMobileTree} />
          ) : isCsvFile(browser.currentPath) ? (
            <CsvViewer onNavigate={handleNavigate} onMobileMenuClick={toggleMobileTree} />
          ) : isMarkdownFile(browser.currentPath) || !browser.currentPath ? (
            <MarkdownViewer
              onNavigate={handleNavigate}
              assetBaseUrl={assetBaseUrl}
              onSave={handleSave}
              onMobileMenuClick={toggleMobileTree}
              onEnterPairWriting={handleEnterPairWriting}
            />
          ) : (
            <DownloadViewer path={browser.currentPath} assetBaseUrl={assetBaseUrl} onMobileMenuClick={toggleMobileTree} />
          )}
        </article>
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
                <FileTree onFileSelect={handleFileSelect} onLoadDirectory={handleLoadDirectory} onDeleteFile={handleDeleteFile} onDeleteDirectory={handleDeleteDirectory} onGetDirectoryContents={handleGetDirectoryContents} pendingDirectoryContents={pendingDirectoryContents} onArchiveFile={handleArchiveFile} onThinkAbout={handleThinkAbout} onPinnedAssetsChange={handlePinnedAssetsChange} onCreateDirectory={handleCreateDirectory} onCreateFile={handleCreateFile} onRenameFile={handleRenameFile} onMoveFile={handleMoveFile} />
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
