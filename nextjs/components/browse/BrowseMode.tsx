/**
 * BrowseMode Component
 *
 * Split-pane container that coordinates FileTree and MarkdownViewer.
 * Supports collapsible tree panel and mobile-friendly overlay.
 */

/* eslint-disable @typescript-eslint/no-misused-promises */
// Many async handlers are passed to components that expect sync handlers.
// This is safe because we handle errors within the async functions.

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "../../contexts/SessionContext";
import type { BrowseViewMode, SearchMode } from "../../contexts/SessionContext";
import { useFileBrowser } from "../../hooks/useFileBrowser";
import { useSearch } from "../../hooks/useSearch";
import { useHome } from "../../hooks/useHome";
import { useConfig } from "../../hooks/useConfig";
import { FileTree } from "./FileTree";
import type { DirectoryContents } from "./FileTree";
import { TaskList } from "./TaskList";
import { MarkdownViewer } from "./viewers/MarkdownViewer";
import { ImageViewer } from "./viewers/ImageViewer";
import { VideoViewer } from "./viewers/VideoViewer";
import { PdfViewer } from "./viewers/PdfViewer";
import { JsonViewer } from "./viewers/JsonViewer";
import { TxtViewer } from "./viewers/TxtViewer";
import { CsvViewer } from "./viewers/CsvViewer";
import { DownloadViewer } from "./viewers/DownloadViewer";
import { SearchHeader } from "./SearchHeader";
import { SearchResults } from "./SearchResults";
import { PairWritingMode } from "../pair-writing/PairWritingMode";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { isImageFile, isVideoFile, isPdfFile, isMarkdownFile, isJsonFile, isTxtFile, isCsvFile, hasSupportedViewer } from "@/lib/utils/file-types";
// Note: FileSearchResult, ContentSearchResult types removed - now handled internally by REST API hooks
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
  const [pendingViewerDeletePath, setPendingViewerDeletePath] = useState<string | null>(null);

  const { browser, vault, cacheDirectory, clearDirectoryCache, setCurrentPath, setFileContent, setFileError, setFileLoading, startSave, saveSuccess, saveError, setViewMode, setTasks, setTasksLoading, setTasksError, updateTask, setSearchActive, setSearchMode, setSearchQuery, setSearchResults, setSearchLoading, toggleResultExpanded, setSnippets, clearSearch, setMode, setPinnedAssets } = useSession();

  // REST API hooks for file operations
  const fileBrowser = useFileBrowser(vault?.id);
  const searchApi = useSearch(vault?.id);
  const homeApi = useHome(vault?.id);
  const configApi = useConfig(vault?.id);

  // Construct asset base URL with vaultId for image serving
  const assetBaseUrl = vault ? `/vault/${vault.id}/assets` : "/vault/assets";

  const { viewMode } = browser;

  // Track saving state in a ref to avoid stale closures
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

  // Destructure search state for convenience
  const { search } = browser;

  // Load root directory when vault is selected, if not cached (uses REST API)
  const { listDirectory } = fileBrowser;
  useEffect(() => {
    if (vault && !browser.directoryCache.has("")) {
      setFileLoading(true);
      listDirectory("").then((listing) => {
        cacheDirectory(listing.path, listing.entries);
        setFileLoading(false);
      }).catch((err) => {
        setFileError(err instanceof Error ? err.message : "Failed to load directory");
        setFileLoading(false);
      });
    }
  }, [vault, browser.directoryCache, listDirectory, cacheDirectory, setFileLoading, setFileError]);

  // Load pinned assets from server when vault is selected (uses REST API)
  const hasFetchedPinnedAssetsRef = useRef(false);
  const { getPinnedAssets } = configApi;
  useEffect(() => {
    if (vault && !hasFetchedPinnedAssetsRef.current) {
      hasFetchedPinnedAssetsRef.current = true;
      void getPinnedAssets().then((paths) => {
        if (paths) {
          setPinnedAssets(paths);
        }
      });
    }
  }, [vault, getPinnedAssets, setPinnedAssets]);

  // Reset pinned assets fetch flag on vault change
  useEffect(() => {
    if (!vault) {
      hasFetchedPinnedAssetsRef.current = false;
    }
  }, [vault]);

  // Load tasks when viewMode is "tasks" (uses REST API)
  const { getTasks } = homeApi;
  useEffect(() => {
    if (vault && viewMode === "tasks") {
      setTasksLoading(true);
      getTasks().then((result) => {
        if (result) {
          setTasks(result.tasks);
        }
        setTasksLoading(false);
      }).catch((err) => {
        setTasksError(err instanceof Error ? err.message : "Failed to load tasks");
        setTasksLoading(false);
      });
    }
  }, [vault, viewMode, getTasks, setTasks, setTasksLoading, setTasksError]);

  // Auto-load file when currentPath is set externally (e.g., from RecentActivity View button)
  // Only load text files (markdown, JSON) - images are rendered directly via asset URL
  const hasAutoLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    const path = browser.currentPath;

    // Skip if no vault or no path
    if (!vault || !path) {
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

    // For text files, auto-load if not already loaded (uses REST API)
    if (
      isTextFile &&
      browser.currentFileContent === null &&
      !browser.fileError &&
      !browser.isLoading &&
      hasAutoLoadedRef.current !== path
    ) {
      hasAutoLoadedRef.current = path;
      setFileLoading(true);
      fileBrowser.readFile(path).then((result) => {
        setFileContent(result.content, result.truncated);
        setIsMobileTreeOpen(false);
      }).catch((err) => {
        setFileError(err instanceof Error ? err.message : "Failed to load file");
      }).finally(() => {
        setFileLoading(false);
      });
      return;
    }

    // Reset ref when conditions aren't met (allows reload on future navigation)
    if (!isTextFile || browser.currentFileContent !== null || browser.fileError || browser.isLoading) {
      hasAutoLoadedRef.current = null;
    }
  }, [vault, browser.currentPath, browser.currentFileContent, browser.fileError, browser.isLoading, fileBrowser, setFileLoading, setFileContent, setFileError]);

  // Helper to refresh parent directory after file operations
  const refreshParentDirectory = useCallback(
    async (path: string) => {
      const parentPath = path.includes("/")
        ? path.substring(0, path.lastIndexOf("/"))
        : "";
      try {
        const listing = await fileBrowser.listDirectory(parentPath);
        cacheDirectory(listing.path, listing.entries);
      } catch (err) {
        console.warn("Failed to refresh parent directory:", err);
      }
    },
    [fileBrowser, cacheDirectory]
  );

  // Handle directory load request from FileTree (REST API)
  const handleLoadDirectory = useCallback(
    async (path: string) => {
      setFileLoading(true);
      try {
        const listing = await fileBrowser.listDirectory(path);
        cacheDirectory(listing.path, listing.entries);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "Failed to load directory");
      } finally {
        setFileLoading(false);
      }
    },
    [fileBrowser, cacheDirectory, setFileLoading, setFileError]
  );

  // Handle file deletion from FileTree context menu (REST API)
  const handleDeleteFile = useCallback(
    async (path: string) => {
      try {
        await fileBrowser.deleteFile(path);
        // If the deleted file was currently being viewed, clear the view
        if (browser.currentPath === path) {
          setCurrentPath("");
          setFileContent("", false);
        }
        await refreshParentDirectory(path);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "Failed to delete file");
      }
    },
    [fileBrowser, browser.currentPath, setCurrentPath, setFileContent, refreshParentDirectory, setFileError]
  );

  // Handle directory contents request for delete preview (REST API)
  // Note: This endpoint doesn't exist in REST yet, so we use a placeholder
  const handleGetDirectoryContents = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (_path: string) => {
      setPendingDirectoryContents(null);
      // TODO: Add get_directory_contents REST endpoint if needed
      // For now, we'll show empty contents which allows deletion
      setPendingDirectoryContents({
        files: [],
        directories: [],
        totalFiles: 0,
        totalDirectories: 0,
        truncated: false,
      });
    },
    []
  );

  // Handle directory deletion from FileTree context menu (REST API)
  const handleDeleteDirectory = useCallback(
    async (path: string) => {
      try {
        await fileBrowser.deleteDirectory(path);
        // If the deleted directory or its contents were being viewed, clear the view
        if (browser.currentPath === path || browser.currentPath.startsWith(path + "/")) {
          setCurrentPath("");
          setFileContent("", false);
        }
        await refreshParentDirectory(path);
        setPendingDirectoryContents(null);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "Failed to delete directory");
      }
    },
    [fileBrowser, browser.currentPath, setCurrentPath, setFileContent, refreshParentDirectory, setFileError]
  );

  // Handle directory archive from FileTree context menu
  // Note: Archive functionality may need a separate REST endpoint
  const handleArchiveFile = useCallback(
    async (path: string) => {
      // Archive typically moves file to an archive folder
      // Using move operation to archive directory
      const archivePath = `99_Archive/${path.split("/").pop()}`;
      try {
        await fileBrowser.moveFile(path, archivePath);
        if (browser.currentPath === path || browser.currentPath.startsWith(path + "/")) {
          setCurrentPath("");
          setFileContent("", false);
        }
        await refreshParentDirectory(path);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "Failed to archive");
      }
    },
    [fileBrowser, browser.currentPath, setCurrentPath, setFileContent, refreshParentDirectory, setFileError]
  );

  // Handle directory creation from FileTree context menu (REST API)
  const handleCreateDirectory = useCallback(
    async (parentPath: string, name: string) => {
      try {
        await fileBrowser.createDirectory(parentPath, name);
        await refreshParentDirectory(parentPath ? `${parentPath}/${name}` : name);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "Failed to create directory");
      }
    },
    [fileBrowser, refreshParentDirectory, setFileError]
  );

  // Handle file creation from FileTree context menu (REST API)
  const handleCreateFile = useCallback(
    async (parentPath: string, name: string) => {
      try {
        await fileBrowser.createFile(parentPath, name);
        await refreshParentDirectory(parentPath ? `${parentPath}/${name}` : name);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "Failed to create file");
      }
    },
    [fileBrowser, refreshParentDirectory, setFileError]
  );

  // Handle file/directory rename from FileTree context menu (REST API)
  const handleRenameFile = useCallback(
    async (path: string, newName: string) => {
      try {
        const result = await fileBrowser.renameFile(path, newName);
        // If the renamed file was currently being viewed, update the path
        if (browser.currentPath === result.oldPath) {
          setCurrentPath(result.newPath);
        }
        // If a file inside a renamed directory was being viewed, update the path
        else if (browser.currentPath.startsWith(result.oldPath + "/")) {
          const relativePath = browser.currentPath.substring(result.oldPath.length);
          setCurrentPath(result.newPath + relativePath);
        }
        await refreshParentDirectory(result.newPath);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "Failed to rename");
      }
    },
    [fileBrowser, browser.currentPath, setCurrentPath, refreshParentDirectory, setFileError]
  );

  // Handle file/directory move from FileTree context menu (REST API)
  const handleMoveFile = useCallback(
    async (path: string, newPath: string) => {
      try {
        const result = await fileBrowser.moveFile(path, newPath);
        // If the moved file was currently being viewed, update the path
        if (browser.currentPath === result.oldPath) {
          setCurrentPath(result.newPath);
        }
        // If a file inside a moved directory was being viewed, update the path
        else if (browser.currentPath.startsWith(result.oldPath + "/")) {
          const relativePath = browser.currentPath.substring(result.oldPath.length);
          setCurrentPath(result.newPath + relativePath);
        }
        // Refresh both source and destination
        await refreshParentDirectory(result.oldPath);
        await refreshParentDirectory(result.newPath);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "Failed to move");
      }
    },
    [fileBrowser, browser.currentPath, setCurrentPath, refreshParentDirectory, setFileError]
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

  // Handle file selection from FileTree (REST API)
  const handleFileSelect = useCallback(
    async (path: string) => {
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
      try {
        const result = await fileBrowser.readFile(path);
        setFileContent(result.content, result.truncated);
        setIsMobileTreeOpen(false);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "Failed to load file");
      } finally {
        setFileLoading(false);
      }
    },
    [fileBrowser, setFileLoading, setCurrentPath, setFileContent, setFileError]
  );

  // Handle navigation from MarkdownViewer (wiki-links) (REST API)
  const handleNavigate = useCallback(
    async (path: string) => {
      if (!path) return;
      setCurrentPath(path);
      setFileLoading(true);
      try {
        const result = await fileBrowser.readFile(path);
        setFileContent(result.content, result.truncated);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : "Failed to load file");
      } finally {
        setFileLoading(false);
      }
    },
    [fileBrowser, setCurrentPath, setFileLoading, setFileContent, setFileError]
  );

  // Handle save from MarkdownViewer adjust mode (REST API)
  const handleSave = useCallback(
    async (content: string) => {
      if (!browser.currentPath) return;

      // Start save operation (sets isSaving state)
      startSave();

      try {
        await fileBrowser.writeFile(browser.currentPath, content);
        saveSuccess();
        // Re-request file content to refresh the view with saved content
        const result = await fileBrowser.readFile(browser.currentPath);
        setFileContent(result.content, result.truncated);
      } catch (err) {
        saveError(err instanceof Error ? err.message : "Failed to save file");
      }
    },
    [browser.currentPath, fileBrowser, startSave, saveSuccess, saveError, setFileContent]
  );

  // Handle pinned assets change from FileTree - sync to server (REST API)
  const handlePinnedAssetsChange = useCallback(
    async (paths: string[]) => {
      try {
        await configApi.setPinnedAssets(paths);
      } catch (err) {
        console.warn("Failed to save pinned assets:", err);
      }
    },
    [configApi]
  );

  // Toggle tree collapse state
  const toggleTreeCollapse = useCallback(() => {
    setIsTreeCollapsed((prev) => !prev);
  }, []);

  // Reload file tree and task list (clear cache and refetch, preserves pinned folders) (REST API)
  const handleReload = useCallback(async () => {
    clearDirectoryCache();
    setFileLoading(true);
    setTasksLoading(true);

    try {
      const listing = await fileBrowser.listDirectory("");
      cacheDirectory(listing.path, listing.entries);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "Failed to load directory");
    } finally {
      setFileLoading(false);
    }

    try {
      const result = await homeApi.getTasks();
      if (result) {
        setTasks(result.tasks);
      }
    } catch (err) {
      setTasksError(err instanceof Error ? err.message : "Failed to load tasks");
    } finally {
      setTasksLoading(false);
    }
  }, [clearDirectoryCache, setFileLoading, setTasksLoading, fileBrowser, homeApi, cacheDirectory, setFileError, setTasks, setTasksError]);

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

  // Handle task toggle from TaskList (REST API)
  // The API returns void on success and throws on error
  // This function is async but the TaskList expects sync return
  // We use fire-and-forget pattern with optimistic updates
  const handleToggleTask = useCallback(
    (filePath: string, lineNumber: number, newState: string, originalState: string): boolean => {
      if (!vault) {
        setTasksError("No vault selected.");
        return false;
      }

      // Store original state for rollback on error
      const taskKey = `${filePath}:${lineNumber}`;
      pendingTaskTogglesRef.current.set(taskKey, originalState);

      // Fire-and-forget async operation
      homeApi.toggleTask(filePath, lineNumber, newState)
        .then((result) => {
          // Clear from pending toggles
          pendingTaskTogglesRef.current.delete(taskKey);
          // Update task with confirmed new state (result has the newState)
          if (result) {
            updateTask(result.filePath, result.lineNumber, result.newState);
          }
        })
        .catch((err) => {
          // Rollback on error
          updateTask(filePath, lineNumber, originalState);
          pendingTaskTogglesRef.current.delete(taskKey);
          setTasksError(err instanceof Error ? err.message : "Failed to toggle task");
        });

      return true;
    },
    [vault, homeApi, updateTask, setTasksError]
  );

  // Handle search query change - use REST API
  const handleSearchQueryChange = useCallback(
    async (query: string) => {
      setSearchQuery(query);
      if (query.trim()) {
        setSearchLoading(true);
        try {
          if (search.mode === "files") {
            const result = await searchApi.searchFiles(query);
            if (result) {
              setSearchResults("files", result.results);
            }
          } else {
            const result = await searchApi.searchContent(query);
            if (result) {
              setSearchResults("content", undefined, result.results);
            }
          }
        } catch (err) {
          console.warn("Search failed:", err);
        } finally {
          setSearchLoading(false);
        }
      }
    },
    [search.mode, setSearchQuery, setSearchLoading, searchApi, setSearchResults]
  );

  // Handle search mode change - re-search if query exists (REST API)
  const handleSearchModeChange = useCallback(
    async (mode: SearchMode) => {
      setSearchMode(mode);
      if (search.query.trim()) {
        setSearchLoading(true);
        try {
          if (mode === "files") {
            const result = await searchApi.searchFiles(search.query);
            if (result) {
              setSearchResults("files", result.results);
            }
          } else {
            const result = await searchApi.searchContent(search.query);
            if (result) {
              setSearchResults("content", undefined, result.results);
            }
          }
        } catch (err) {
          console.warn("Search failed:", err);
        } finally {
          setSearchLoading(false);
        }
      }
    },
    [search.query, setSearchMode, setSearchLoading, searchApi, setSearchResults]
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

  // Handle request for snippets (lazy load on expand) (REST API)
  const handleRequestSnippets = useCallback(
    async (path: string) => {
      try {
        const snippets = await searchApi.getSnippets(path, search.query);
        if (snippets) {
          setSnippets(path, snippets);
        }
      } catch (err) {
        console.warn("Failed to get snippets:", err);
      }
    },
    [search.query, searchApi, setSnippets]
  );

  // Enter Pair Writing Mode (REQ-F-9)
  const handleEnterPairWriting = useCallback(() => {
    setIsPairWritingActive(true);
  }, []);

  // Exit Pair Writing Mode and return to standard Browse view (REQ-F-14)
  const handleExitPairWriting = useCallback(() => {
    setIsPairWritingActive(false);
  }, []);

  // Handle viewer delete request - shows confirmation dialog
  const handleViewerDelete = useCallback(() => {
    if (browser.currentPath) {
      setPendingViewerDeletePath(browser.currentPath);
    }
  }, [browser.currentPath]);

  // Confirm viewer delete - delegates to existing handleDeleteFile
  const handleConfirmViewerDelete = useCallback(async () => {
    if (pendingViewerDeletePath) {
      await handleDeleteFile(pendingViewerDeletePath);
      setPendingViewerDeletePath(null);
    }
  }, [pendingViewerDeletePath, handleDeleteFile]);

  // Cancel viewer delete
  const handleCancelViewerDelete = useCallback(() => {
    setPendingViewerDeletePath(null);
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
              onQuickActionComplete={handleNavigate}
            />
          ) : isImageFile(browser.currentPath) ? (
            <ImageViewer path={browser.currentPath} assetBaseUrl={assetBaseUrl} onMobileMenuClick={toggleMobileTree} onDelete={handleViewerDelete} />
          ) : isVideoFile(browser.currentPath) ? (
            <VideoViewer path={browser.currentPath} assetBaseUrl={assetBaseUrl} onMobileMenuClick={toggleMobileTree} onDelete={handleViewerDelete} />
          ) : isPdfFile(browser.currentPath) ? (
            <PdfViewer path={browser.currentPath} assetBaseUrl={assetBaseUrl} onMobileMenuClick={toggleMobileTree} onDelete={handleViewerDelete} />
          ) : isJsonFile(browser.currentPath) ? (
            <JsonViewer onNavigate={handleNavigate} onSave={handleSave} onMobileMenuClick={toggleMobileTree} onDelete={handleViewerDelete} />
          ) : isTxtFile(browser.currentPath) ? (
            <TxtViewer onNavigate={handleNavigate} onSave={handleSave} onMobileMenuClick={toggleMobileTree} onDelete={handleViewerDelete} />
          ) : isCsvFile(browser.currentPath) ? (
            <CsvViewer onNavigate={handleNavigate} onMobileMenuClick={toggleMobileTree} onDelete={handleViewerDelete} />
          ) : isMarkdownFile(browser.currentPath) || !browser.currentPath ? (
            <MarkdownViewer
              onNavigate={handleNavigate}
              assetBaseUrl={assetBaseUrl}
              onSave={handleSave}
              onMobileMenuClick={toggleMobileTree}
              onEnterPairWriting={handleEnterPairWriting}
              onDelete={handleViewerDelete}
            />
          ) : (
            <DownloadViewer path={browser.currentPath} assetBaseUrl={assetBaseUrl} onMobileMenuClick={toggleMobileTree} onDelete={handleViewerDelete} />
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

      {/* Viewer delete confirmation dialog */}
      <ConfirmDialog
        isOpen={pendingViewerDeletePath !== null}
        title="Delete File?"
        message={`This cannot be undone! The file "${pendingViewerDeletePath?.split("/").pop() ?? ""}" will be permanently deleted.`}
        confirmLabel="Delete"
        onConfirm={handleConfirmViewerDelete}
        onCancel={handleCancelViewerDelete}
      />
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
