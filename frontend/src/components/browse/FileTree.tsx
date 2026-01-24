/**
 * FileTree Component
 *
 * Collapsible file tree for navigating vault directories.
 * Supports lazy-loading, expand/collapse, file selection, and pinned folders.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { FileEntry } from "@memory-loop/shared";
import { useSession } from "../../contexts/SessionContext";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import { InputDialog } from "../shared/InputDialog";
import { MoveDialog } from "../shared/MoveDialog";
import "./FileTree.css";

/**
 * Props for FileTree component.
 */
/**
 * Directory contents for deletion preview.
 */
export interface DirectoryContents {
  files: string[];
  directories: string[];
  totalFiles: number;
  totalDirectories: number;
  truncated: boolean;
}

export interface FileTreeProps {
  /** Callback when a file is selected for viewing */
  onFileSelect?: (path: string) => void;
  /** Callback when a directory needs to be loaded */
  onLoadDirectory?: (path: string) => void;
  /** Callback when a file deletion is requested */
  onDeleteFile?: (path: string) => void;
  /** Callback when a directory deletion is requested */
  onDeleteDirectory?: (path: string) => void;
  /** Callback to get directory contents for deletion preview */
  onGetDirectoryContents?: (path: string) => void;
  /** Directory contents for deletion preview (from parent state) */
  pendingDirectoryContents?: DirectoryContents | null;
  /** Callback when a directory archive is requested */
  onArchiveFile?: (path: string) => void;
  /** Callback when "Think about" is selected for a file */
  onThinkAbout?: (path: string) => void;
  /** Callback when pinned assets change (for server sync) */
  onPinnedAssetsChange?: (paths: string[]) => void;
  /** Callback when a new directory is created */
  onCreateDirectory?: (parentPath: string, name: string) => void;
  /** Callback when a new file is created */
  onCreateFile?: (parentPath: string, name: string) => void;
  /** Callback when a file or directory is renamed */
  onRenameFile?: (path: string, newName: string) => void;
  /** Callback when a file or directory is moved */
  onMoveFile?: (path: string, newPath: string) => void;
}

/**
 * Props for TreeNode component (internal).
 */
interface TreeNodeProps {
  entry: FileEntry;
  depth: number;
  isExpanded: boolean;
  isLoading: boolean;
  isSelected: boolean;
  isPinned?: boolean;
  children: FileEntry[];
  onToggle: (path: string) => void;
  onSelect: (path: string, isDirectory: boolean) => void;
  onContextMenu?: (path: string, isDirectory: boolean, event: React.MouseEvent | React.TouchEvent) => void;
  expandedDirs: Set<string>;
  directoryCache: Map<string, FileEntry[]>;
  loadingDirs: Set<string>;
  currentPath: string;
  pinnedFolders?: string[];
}

/**
 * Recursive tree node component for rendering entries.
 */
function TreeNode({
  entry,
  depth,
  isExpanded,
  isLoading,
  isSelected,
  isPinned,
  children,
  onToggle,
  onSelect,
  onContextMenu,
  expandedDirs,
  directoryCache,
  loadingDirs,
  currentPath,
  pinnedFolders,
}: TreeNodeProps): React.ReactNode {
  const isDirectory = entry.type === "directory";
  const isEmpty = isExpanded && !isLoading && children.length === 0;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup long press timer on unmount
  useEffect(() => {
    return () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
      }
    };
  }, []);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (isDirectory) {
      onToggle(entry.path);
    } else {
      onSelect(entry.path, false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (isDirectory) {
        onToggle(entry.path);
      } else {
        onSelect(entry.path, false);
      }
    }
  }

  function handleContextMenu(e: React.MouseEvent) {
    if (onContextMenu) {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(entry.path, isDirectory, e);
    }
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (onContextMenu) {
      longPressTimer.current = setTimeout(() => {
        onContextMenu(entry.path, isDirectory, e);
      }, 500);
    }
  }

  function handleTouchEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function handleTouchMove() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  return (
    <li className="file-tree__node" role="treeitem" aria-expanded={isDirectory ? isExpanded : undefined}>
      <button
        type="button"
        className={`file-tree__item ${isSelected ? "file-tree__item--selected" : ""} ${
          isDirectory ? "file-tree__item--directory" : "file-tree__item--file"
        } ${isPinned ? "file-tree__item--pinned" : ""}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        aria-selected={isSelected}
      >
        {isDirectory && (
          <span className={`file-tree__chevron ${isExpanded ? "file-tree__chevron--expanded" : ""}`}>
            {isLoading ? (
              <span className="file-tree__spinner" aria-label="Loading" />
            ) : (
              <ChevronIcon />
            )}
          </span>
        )}
        <span className="file-tree__icon">
          {isDirectory ? <FolderIcon /> : <FileIcon />}
        </span>
        <span className="file-tree__name">{entry.name}</span>
        {isPinned && (
          <span className="file-tree__pin-indicator" aria-label="Pinned">
            <PinIcon />
          </span>
        )}
      </button>

      {isDirectory && isExpanded && (
        <ul className="file-tree__children" role="group">
          {isEmpty ? (
            <li className="file-tree__empty">(empty)</li>
          ) : (
            children.map((child) => (
              <TreeNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                isExpanded={expandedDirs.has(child.path)}
                isLoading={loadingDirs.has(child.path)}
                isSelected={currentPath === child.path}
                isPinned={pinnedFolders?.includes(child.path)}
                children={directoryCache.get(child.path) ?? []}
                onToggle={onToggle}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                expandedDirs={expandedDirs}
                directoryCache={directoryCache}
                loadingDirs={loadingDirs}
                currentPath={currentPath}
                pinnedFolders={pinnedFolders}
              />
            ))
          )}
        </ul>
      )}
    </li>
  );
}

/**
 * Chevron icon for expand/collapse indicator.
 */
function ChevronIcon(): React.ReactNode {
  return (
    <svg
      className="file-tree__icon-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/**
 * Folder icon for directories.
 */
function FolderIcon(): React.ReactNode {
  return (
    <svg
      className="file-tree__icon-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/**
 * File icon for files.
 */
function FileIcon(): React.ReactNode {
  return (
    <svg
      className="file-tree__icon-svg"
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
 * Pin icon for pinned folders.
 */
function PinIcon(): React.ReactNode {
  return (
    <svg
      className="file-tree__icon-svg file-tree__pin-icon"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2L9.5 9.5L2 12L9.5 14.5L12 22L14.5 14.5L22 12L14.5 9.5L12 2Z" />
    </svg>
  );
}

/**
 * Trash icon for delete action.
 */
function TrashIcon(): React.ReactNode {
  return (
    <svg
      className="file-tree__icon-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

/**
 * Archive icon for archive action.
 */
function ArchiveIcon(): React.ReactNode {
  return (
    <svg
      className="file-tree__icon-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}

/**
 * Folder plus icon for "Add Directory" action.
 */
function FolderPlusIcon(): React.ReactNode {
  return (
    <svg
      className="file-tree__icon-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  );
}

/**
 * File plus icon for "Create File" action.
 */
function FilePlusIcon(): React.ReactNode {
  return (
    <svg
      className="file-tree__icon-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  );
}

/**
 * Think/sparkle icon for "Think about" action.
 */
function ThinkIcon(): React.ReactNode {
  return (
    <svg
      className="file-tree__icon-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v1m0 16v1m-9-9h1m16 0h1m-2.636-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m11.314 11.314l.707.707" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

/**
 * Rename/Edit icon (pencil).
 */
function RenameIcon(): React.ReactNode {
  return (
    <svg
      className="file-tree__icon-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

/**
 * Move icon (folder with arrow).
 */
function MoveIcon(): React.ReactNode {
  return (
    <svg
      className="file-tree__icon-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <path d="M12 11v6" />
      <path d="M9 14l3-3 3 3" />
    </svg>
  );
}

/**
 * Context menu state for pin/unpin actions.
 */
interface ContextMenuState {
  isOpen: boolean;
  path: string;
  isDirectory: boolean;
  x: number;
  y: number;
}

/**
 * FileTree displays a navigable tree of vault files and directories.
 *
 * Features:
 * - Collapsible directories with lazy-loading
 * - File selection for viewing markdown content
 * - Visual feedback for loading and selected states
 * - Touch-friendly with 44px minimum height targets
 * - Pinned folders for quick access
 */
export function FileTree({ onFileSelect, onLoadDirectory, onDeleteFile, onDeleteDirectory, onGetDirectoryContents, pendingDirectoryContents, onArchiveFile, onThinkAbout, onPinnedAssetsChange, onCreateDirectory, onCreateFile, onRenameFile, onMoveFile }: FileTreeProps): React.ReactNode {
  const { browser, toggleDirectory, setCurrentPath, pinFolder, unpinFolder } = useSession();
  const { currentPath, expandedDirs, directoryCache, isLoading, pinnedFolders } = browser;
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    path: "",
    isDirectory: false,
    x: 0,
    y: 0,
  });
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [pendingDeletePath, setPendingDeletePath] = useState<string | null>(null);
  const [pendingDeleteDirPath, setPendingDeleteDirPath] = useState<string | null>(null);
  const [pendingArchivePath, setPendingArchivePath] = useState<string | null>(null);
  const [pendingCreateDirPath, setPendingCreateDirPath] = useState<string | null>(null);
  const [pendingCreateFilePath, setPendingCreateFilePath] = useState<string | null>(null);
  const [pendingRenamePath, setPendingRenamePath] = useState<string | null>(null);
  const [pendingMovePath, setPendingMovePath] = useState<string | null>(null);
  const [pendingMoveIsDirectory, setPendingMoveIsDirectory] = useState<boolean>(false);

  // Track which directories are currently loading
  // For now we just use isLoading for the overall state
  // TODO: Track per-directory loading state if needed
  const loadingDirs = new Set<string>();
  if (isLoading && !directoryCache.has("")) {
    loadingDirs.add("");
  }

  // Get root entries
  const rootEntries = directoryCache.get("") ?? [];

  // Get pinned entries from cache or create placeholder entries
  const pinnedEntries: FileEntry[] = pinnedFolders.map((path) => {
    // Check if entry exists in any cached directory
    const parentPath = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
    const cachedParent = directoryCache.get(parentPath);
    const cachedEntry = cachedParent?.find((e) => e.path === path);

    if (cachedEntry) {
      return cachedEntry;
    }

    // Create a placeholder entry for pinned item not yet loaded
    const name = path.includes("/") ? path.substring(path.lastIndexOf("/") + 1) : path;
    // Heuristic: if name has extension, it's likely a file
    const hasExtension = name.includes(".") && !name.startsWith(".");
    return {
      name,
      path,
      type: hasExtension ? "file" as const : "directory" as const,
    };
  });

  function handleToggle(path: string) {
    // Toggle the directory expansion state
    toggleDirectory(path);

    // If expanding and not cached, request loading
    if (!expandedDirs.has(path) && !directoryCache.has(path)) {
      onLoadDirectory?.(path);
    }
  }

  function handleSelect(path: string, isDirectory: boolean) {
    if (!isDirectory) {
      setCurrentPath(path);
      onFileSelect?.(path);
    }
  }

  const handleContextMenu = useCallback(
    (path: string, isDirectory: boolean, event: React.MouseEvent | React.TouchEvent) => {
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

      // Convert viewport coordinates to file-tree-relative coordinates
      // (backdrop-filter on parent creates new containing block for position:fixed)
      const target = event.target as HTMLElement;
      const fileTree = target.closest(".file-tree");
      const menuWidth = 180;
      // Estimate max menu height: up to 8 items at ~36px each + container padding
      const menuHeight = 300;

      let x = clientX;
      let y = clientY;

      if (fileTree) {
        const rect = fileTree.getBoundingClientRect();
        // Convert to container-relative coordinates
        x = clientX - rect.left;
        y = clientY - rect.top;

        // Keep menu within container bounds horizontally
        if (x + menuWidth > rect.width) {
          x = Math.max(0, x - menuWidth);
        }

        // Keep menu within container bounds vertically
        // If menu would extend past bottom, position it above the click point
        if (y + menuHeight > rect.height) {
          // Try positioning above click point
          const aboveY = y - menuHeight;
          if (aboveY >= 0) {
            y = aboveY;
          } else {
            // Not enough room above either - clamp to top with some padding
            y = Math.max(8, rect.height - menuHeight - 8);
          }
        }
      }

      setContextMenu({
        isOpen: true,
        path,
        isDirectory,
        x,
        y,
      });
    },
    []
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handlePinFolder = useCallback(() => {
    const path = contextMenu.path;
    pinFolder(path);
    // Compute new list and notify parent for server sync
    if (onPinnedAssetsChange && !pinnedFolders.includes(path)) {
      onPinnedAssetsChange([...pinnedFolders, path]);
    }
    closeContextMenu();
  }, [contextMenu.path, pinFolder, closeContextMenu, pinnedFolders, onPinnedAssetsChange]);

  const handleUnpinFolder = useCallback(() => {
    const path = contextMenu.path;
    unpinFolder(path);
    // Compute new list and notify parent for server sync
    if (onPinnedAssetsChange) {
      onPinnedAssetsChange(pinnedFolders.filter((p) => p !== path));
    }
    closeContextMenu();
  }, [contextMenu.path, unpinFolder, closeContextMenu, pinnedFolders, onPinnedAssetsChange]);

  const handleDeleteClick = useCallback(() => {
    setPendingDeletePath(contextMenu.path);
    closeContextMenu();
  }, [contextMenu.path, closeContextMenu]);

  const handleThinkAbout = useCallback(() => {
    onThinkAbout?.(contextMenu.path);
    closeContextMenu();
  }, [contextMenu.path, onThinkAbout, closeContextMenu]);

  const handleConfirmDelete = useCallback(() => {
    if (pendingDeletePath && onDeleteFile) {
      onDeleteFile(pendingDeletePath);
    }
    setPendingDeletePath(null);
  }, [pendingDeletePath, onDeleteFile]);

  const handleCancelDelete = useCallback(() => {
    setPendingDeletePath(null);
  }, []);

  const handleDeleteDirClick = useCallback(() => {
    setPendingDeleteDirPath(contextMenu.path);
    onGetDirectoryContents?.(contextMenu.path);
    closeContextMenu();
  }, [contextMenu.path, closeContextMenu, onGetDirectoryContents]);

  const handleConfirmDeleteDir = useCallback(() => {
    if (pendingDeleteDirPath && onDeleteDirectory) {
      onDeleteDirectory(pendingDeleteDirPath);
    }
    setPendingDeleteDirPath(null);
  }, [pendingDeleteDirPath, onDeleteDirectory]);

  const handleCancelDeleteDir = useCallback(() => {
    setPendingDeleteDirPath(null);
  }, []);

  const handleArchiveClick = useCallback(() => {
    setPendingArchivePath(contextMenu.path);
    closeContextMenu();
  }, [contextMenu.path, closeContextMenu]);

  const handleConfirmArchive = useCallback(() => {
    if (pendingArchivePath && onArchiveFile) {
      onArchiveFile(pendingArchivePath);
    }
    setPendingArchivePath(null);
  }, [pendingArchivePath, onArchiveFile]);

  const handleCancelArchive = useCallback(() => {
    setPendingArchivePath(null);
  }, []);

  const handleCreateDirClick = useCallback(() => {
    setPendingCreateDirPath(contextMenu.path);
    closeContextMenu();
  }, [contextMenu.path, closeContextMenu]);

  const handleConfirmCreateDir = useCallback(
    (name: string) => {
      if (pendingCreateDirPath !== null && onCreateDirectory) {
        onCreateDirectory(pendingCreateDirPath, name);
      }
      setPendingCreateDirPath(null);
    },
    [pendingCreateDirPath, onCreateDirectory]
  );

  const handleCancelCreateDir = useCallback(() => {
    setPendingCreateDirPath(null);
  }, []);

  const handleCreateFileClick = useCallback(() => {
    setPendingCreateFilePath(contextMenu.path);
    closeContextMenu();
  }, [contextMenu.path, closeContextMenu]);

  const handleConfirmCreateFile = useCallback(
    (name: string) => {
      if (pendingCreateFilePath !== null && onCreateFile) {
        onCreateFile(pendingCreateFilePath, name);
      }
      setPendingCreateFilePath(null);
    },
    [pendingCreateFilePath, onCreateFile]
  );

  const handleCancelCreateFile = useCallback(() => {
    setPendingCreateFilePath(null);
  }, []);

  const handleRenameClick = useCallback(() => {
    setPendingRenamePath(contextMenu.path);
    closeContextMenu();
  }, [contextMenu.path, closeContextMenu]);

  const handleConfirmRename = useCallback(
    (newName: string) => {
      if (pendingRenamePath !== null && onRenameFile) {
        onRenameFile(pendingRenamePath, newName);
      }
      setPendingRenamePath(null);
    },
    [pendingRenamePath, onRenameFile]
  );

  const handleCancelRename = useCallback(() => {
    setPendingRenamePath(null);
  }, []);

  const handleMoveRequest = useCallback(() => {
    setPendingMovePath(contextMenu.path);
    setPendingMoveIsDirectory(contextMenu.isDirectory);
    closeContextMenu();
  }, [contextMenu.path, contextMenu.isDirectory, closeContextMenu]);

  const handleConfirmMove = useCallback(
    (newPath: string) => {
      if (pendingMovePath !== null && onMoveFile) {
        onMoveFile(pendingMovePath, newPath);
      }
      setPendingMovePath(null);
      setPendingMoveIsDirectory(false);
    },
    [pendingMovePath, onMoveFile]
  );

  const handleCancelMove = useCallback(() => {
    setPendingMovePath(null);
    setPendingMoveIsDirectory(false);
  }, []);

  // Close context menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(event.target as Node)
      ) {
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

  const isPinned = pinnedFolders.includes(contextMenu.path);

  // Check if the selected directory is archivable
  // Archivable directories are:
  // 1. The "chats" directory under inbox (e.g., "00_Inbox/chats")
  // 2. Direct children of projects folder (e.g., "01_Projects/MyProject")
  // 3. Direct children of areas folder (e.g., "02_Areas/MyArea")
  const isArchivable = (() => {
    if (!contextMenu.isDirectory) return false;

    const path = contextMenu.path;
    const parts = path.split("/");

    // Check for chats folder (e.g., "00_Inbox/chats" or "Inbox/chats")
    if (parts.length >= 2) {
      const dirName = parts[parts.length - 1].toLowerCase();
      const parentName = parts[parts.length - 2].toLowerCase();
      if (dirName === "chats" && (parentName.includes("inbox") || parentName === "00_inbox")) {
        return true;
      }
    }

    // Check for project or area directory (direct child of Projects/Areas folder)
    if (parts.length === 2) {
      const parentDir = parts[0].toLowerCase();
      // Common project folder patterns
      if (parentDir === "01_projects" || parentDir === "projects" || parentDir === "01-projects") {
        return true;
      }
      // Common area folder patterns
      if (parentDir === "02_areas" || parentDir === "areas" || parentDir === "02-areas") {
        return true;
      }
    }

    return false;
  })();

  // Show loading state for root
  if (isLoading && rootEntries.length === 0) {
    return (
      <div className="file-tree file-tree--loading">
        <div className="file-tree__loading">
          <span className="file-tree__loading-spinner" aria-label="Loading files" />
          <span>Loading files...</span>
        </div>
      </div>
    );
  }

  // Show empty state if no entries
  if (rootEntries.length === 0) {
    return (
      <div className="file-tree file-tree--empty">
        <p className="file-tree__empty-message">No files in vault</p>
      </div>
    );
  }

  return (
    <nav className="file-tree" aria-label="Vault files">
      {/* Pinned folders section */}
      {pinnedEntries.length > 0 && (
        <div className="file-tree__pinned-section">
          <h3 className="file-tree__pinned-header">
            <PinIcon />
            <span>Pinned</span>
          </h3>
          <ul className="file-tree__pinned-list" role="tree">
            {pinnedEntries.map((entry) => (
              <TreeNode
                key={`pinned-${entry.path}`}
                entry={entry}
                depth={0}
                isExpanded={expandedDirs.has(entry.path)}
                isLoading={loadingDirs.has(entry.path)}
                isSelected={currentPath === entry.path}
                isPinned={true}
                children={directoryCache.get(entry.path) ?? []}
                onToggle={handleToggle}
                onSelect={handleSelect}
                onContextMenu={handleContextMenu}
                expandedDirs={expandedDirs}
                directoryCache={directoryCache}
                loadingDirs={loadingDirs}
                currentPath={currentPath}
                pinnedFolders={pinnedFolders}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Main file tree */}
      <ul className="file-tree__root" role="tree">
        {rootEntries.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            isExpanded={expandedDirs.has(entry.path)}
            isLoading={loadingDirs.has(entry.path)}
            isSelected={currentPath === entry.path}
            isPinned={pinnedFolders.includes(entry.path)}
            children={directoryCache.get(entry.path) ?? []}
            onToggle={handleToggle}
            onSelect={handleSelect}
            onContextMenu={handleContextMenu}
            expandedDirs={expandedDirs}
            directoryCache={directoryCache}
            loadingDirs={loadingDirs}
            currentPath={currentPath}
            pinnedFolders={pinnedFolders}
          />
        ))}
      </ul>

      {/* Context menu */}
      {contextMenu.isOpen && (
        <div
          ref={contextMenuRef}
          className="file-tree__context-menu"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          role="menu"
        >
          <button
            type="button"
            className="file-tree__context-menu-item"
            onClick={isPinned ? handleUnpinFolder : handlePinFolder}
            role="menuitem"
          >
            <PinIcon />
            <span>{isPinned ? "Unpin folder" : "Pin to top"}</span>
          </button>
          {onThinkAbout && (
            <button
              type="button"
              className="file-tree__context-menu-item"
              onClick={handleThinkAbout}
              role="menuitem"
            >
              <ThinkIcon />
              <span>Think about</span>
            </button>
          )}
          {onRenameFile && (
            <button
              type="button"
              className="file-tree__context-menu-item"
              onClick={handleRenameClick}
              role="menuitem"
            >
              <RenameIcon />
              <span>Rename</span>
            </button>
          )}
          {onMoveFile && (
            <button
              type="button"
              className="file-tree__context-menu-item"
              onClick={handleMoveRequest}
              role="menuitem"
            >
              <MoveIcon />
              <span>Move</span>
            </button>
          )}
          {contextMenu.isDirectory && onCreateDirectory && (
            <button
              type="button"
              className="file-tree__context-menu-item"
              onClick={handleCreateDirClick}
              role="menuitem"
            >
              <FolderPlusIcon />
              <span>Add Directory</span>
            </button>
          )}
          {contextMenu.isDirectory && onCreateFile && (
            <button
              type="button"
              className="file-tree__context-menu-item"
              onClick={handleCreateFileClick}
              role="menuitem"
            >
              <FilePlusIcon />
              <span>Create File</span>
            </button>
          )}
          {isArchivable && onArchiveFile && (
            <button
              type="button"
              className="file-tree__context-menu-item"
              onClick={handleArchiveClick}
              role="menuitem"
            >
              <ArchiveIcon />
              <span>Archive</span>
            </button>
          )}
          {!contextMenu.isDirectory && onDeleteFile && (
            <button
              type="button"
              className="file-tree__context-menu-item file-tree__context-menu-item--danger"
              onClick={handleDeleteClick}
              role="menuitem"
            >
              <TrashIcon />
              <span>Delete file</span>
            </button>
          )}
          {contextMenu.isDirectory && onDeleteDirectory && (
            <button
              type="button"
              className="file-tree__context-menu-item file-tree__context-menu-item--danger"
              onClick={handleDeleteDirClick}
              role="menuitem"
            >
              <TrashIcon />
              <span>Delete folder</span>
            </button>
          )}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        isOpen={pendingDeletePath !== null}
        title="Delete File?"
        message={`This cannot be undone! The file "${pendingDeletePath?.split("/").pop() ?? ""}" will be permanently deleted from your vault.`}
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />

      {/* Archive confirmation dialog */}
      <ConfirmDialog
        isOpen={pendingArchivePath !== null}
        title="Archive Directory?"
        message={`Move "${pendingArchivePath?.split("/").pop() ?? ""}" to the archive folder? The directory will be organized by date in the archive.`}
        confirmLabel="Archive"
        onConfirm={handleConfirmArchive}
        onCancel={handleCancelArchive}
      />

      {/* Delete directory confirmation dialog */}
      <ConfirmDialog
        isOpen={pendingDeleteDirPath !== null}
        title="Delete Folder?"
        message={
          <div className="file-tree__delete-dir-message">
            <p className="file-tree__delete-dir-warning">
              This cannot be undone! The folder "{pendingDeleteDirPath?.split("/").pop() ?? ""}" and all its contents will be permanently deleted.
            </p>
            {pendingDirectoryContents && (pendingDirectoryContents.totalFiles > 0 || pendingDirectoryContents.totalDirectories > 0) && (
              <div className="file-tree__delete-dir-contents">
                <p className="file-tree__delete-dir-summary">
                  This will delete{" "}
                  <strong>{pendingDirectoryContents.totalFiles} file{pendingDirectoryContents.totalFiles !== 1 ? "s" : ""}</strong>
                  {pendingDirectoryContents.totalDirectories > 0 && (
                    <>
                      {" "}and{" "}
                      <strong>{pendingDirectoryContents.totalDirectories} subfolder{pendingDirectoryContents.totalDirectories !== 1 ? "s" : ""}</strong>
                    </>
                  )}:
                </p>
                <ul className="file-tree__delete-dir-list">
                  {pendingDirectoryContents.directories.map((dir) => (
                    <li key={dir} className="file-tree__delete-dir-item file-tree__delete-dir-item--dir">
                      {dir}/
                    </li>
                  ))}
                  {pendingDirectoryContents.files.map((file) => (
                    <li key={file} className="file-tree__delete-dir-item">
                      {file}
                    </li>
                  ))}
                </ul>
                {pendingDirectoryContents.truncated && (
                  <p className="file-tree__delete-dir-truncated">
                    ...and more items not shown
                  </p>
                )}
              </div>
            )}
            {pendingDirectoryContents && pendingDirectoryContents.totalFiles === 0 && pendingDirectoryContents.totalDirectories === 0 && (
              <p className="file-tree__delete-dir-empty">This folder is empty.</p>
            )}
            {!pendingDirectoryContents && (
              <p className="file-tree__delete-dir-loading">Loading folder contents...</p>
            )}
          </div>
        }
        confirmLabel="Delete"
        onConfirm={handleConfirmDeleteDir}
        onCancel={handleCancelDeleteDir}
      />

      {/* Create directory dialog */}
      <InputDialog
        isOpen={pendingCreateDirPath !== null}
        title="Add Directory"
        message={`Create a new directory${pendingCreateDirPath ? ` in "${pendingCreateDirPath}"` : " at the root"}.`}
        inputLabel="Directory name"
        inputPlaceholder="my-new-folder"
        pattern={/^[a-zA-Z0-9_-]+$/}
        patternError="Only letters, numbers, hyphens, and underscores allowed"
        confirmLabel="Create"
        onConfirm={handleConfirmCreateDir}
        onCancel={handleCancelCreateDir}
      />

      {/* Create file dialog */}
      <InputDialog
        isOpen={pendingCreateFilePath !== null}
        title="Create File"
        message={`Create a new markdown file${pendingCreateFilePath ? ` in "${pendingCreateFilePath}"` : " at the root"}. The .md extension will be added automatically.`}
        inputLabel="File name"
        inputPlaceholder="my-new-file"
        pattern={/^[a-zA-Z0-9_-]+$/}
        patternError="Only letters, numbers, hyphens, and underscores allowed"
        confirmLabel="Create"
        onConfirm={handleConfirmCreateFile}
        onCancel={handleCancelCreateFile}
      />

      {/* Rename dialog */}
      <InputDialog
        isOpen={pendingRenamePath !== null}
        title="Rename"
        message={`Enter a new name for "${pendingRenamePath?.split("/").pop() ?? ""}". The file extension will be preserved.`}
        inputLabel="New name"
        inputPlaceholder="new-name"
        pattern={/^[a-zA-Z0-9_-]+$/}
        patternError="Only letters, numbers, hyphens, and underscores allowed"
        confirmLabel="Rename"
        onConfirm={handleConfirmRename}
        onCancel={handleCancelRename}
      />

      {/* Move dialog */}
      <MoveDialog
        isOpen={pendingMovePath !== null}
        sourcePath={pendingMovePath ?? ""}
        isDirectory={pendingMoveIsDirectory}
        onConfirm={handleConfirmMove}
        onCancel={handleCancelMove}
      />
    </nav>
  );
}
