/**
 * FileTree Component
 *
 * Collapsible file tree for navigating vault directories.
 * Supports lazy-loading, expand/collapse, and file selection.
 */

import type { FileEntry } from "@memory-loop/shared";
import { useSession } from "../contexts/SessionContext";
import "./FileTree.css";

/**
 * Props for FileTree component.
 */
export interface FileTreeProps {
  /** Callback when a file is selected for viewing */
  onFileSelect?: (path: string) => void;
  /** Callback when a directory needs to be loaded */
  onLoadDirectory?: (path: string) => void;
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
  children: FileEntry[];
  onToggle: (path: string) => void;
  onSelect: (path: string, isDirectory: boolean) => void;
  expandedDirs: Set<string>;
  directoryCache: Map<string, FileEntry[]>;
  loadingDirs: Set<string>;
  currentPath: string;
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
  children,
  onToggle,
  onSelect,
  expandedDirs,
  directoryCache,
  loadingDirs,
  currentPath,
}: TreeNodeProps): React.ReactNode {
  const isDirectory = entry.type === "directory";
  const isEmpty = isExpanded && !isLoading && children.length === 0;

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

  return (
    <li className="file-tree__node" role="treeitem" aria-expanded={isDirectory ? isExpanded : undefined}>
      <button
        type="button"
        className={`file-tree__item ${isSelected ? "file-tree__item--selected" : ""} ${
          isDirectory ? "file-tree__item--directory" : "file-tree__item--file"
        }`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
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
                children={directoryCache.get(child.path) ?? []}
                onToggle={onToggle}
                onSelect={onSelect}
                expandedDirs={expandedDirs}
                directoryCache={directoryCache}
                loadingDirs={loadingDirs}
                currentPath={currentPath}
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
 * FileTree displays a navigable tree of vault files and directories.
 *
 * Features:
 * - Collapsible directories with lazy-loading
 * - File selection for viewing markdown content
 * - Visual feedback for loading and selected states
 * - Touch-friendly with 44px minimum height targets
 */
export function FileTree({ onFileSelect, onLoadDirectory }: FileTreeProps): React.ReactNode {
  const { browser, toggleDirectory, setCurrentPath } = useSession();
  const { currentPath, expandedDirs, directoryCache, isLoading } = browser;

  // Track which directories are currently loading
  // For now we just use isLoading for the overall state
  // TODO: Track per-directory loading state if needed
  const loadingDirs = new Set<string>();
  if (isLoading && !directoryCache.has("")) {
    loadingDirs.add("");
  }

  // Get root entries
  const rootEntries = directoryCache.get("") ?? [];

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
      <ul className="file-tree__root" role="tree">
        {rootEntries.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            isExpanded={expandedDirs.has(entry.path)}
            isLoading={loadingDirs.has(entry.path)}
            isSelected={currentPath === entry.path}
            children={directoryCache.get(entry.path) ?? []}
            onToggle={handleToggle}
            onSelect={handleSelect}
            expandedDirs={expandedDirs}
            directoryCache={directoryCache}
            loadingDirs={loadingDirs}
            currentPath={currentPath}
          />
        ))}
      </ul>
    </nav>
  );
}
