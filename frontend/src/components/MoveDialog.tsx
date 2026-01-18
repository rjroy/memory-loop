/**
 * MoveDialog Component
 *
 * Dialog for moving files/directories to a new location within the vault.
 * Displays a mini file tree for destination selection.
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { useSession } from "../contexts/SessionContext.js";
import { useWebSocket } from "../hooks/useWebSocket.js";
import type { FileEntry } from "@memory-loop/shared";
import "./MoveDialog.css";

interface MoveDialogProps {
  /** Whether the dialog is visible */
  isOpen: boolean;
  /** Path of the item being moved (relative to vault root) */
  sourcePath: string;
  /** Whether the item being moved is a directory */
  isDirectory: boolean;
  /** Called when the move is confirmed with the new path */
  onConfirm: (newPath: string) => void;
  /** Called when the dialog is cancelled */
  onCancel: () => void;
}

/**
 * Extracts the parent directory from a path.
 * Returns empty string for root-level items.
 */
function getParentPath(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash > 0 ? path.substring(0, lastSlash) : "";
}

/**
 * Gets the file/directory name from a path.
 */
function getBaseName(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
}

export function MoveDialog({
  isOpen,
  sourcePath,
  isDirectory,
  onConfirm,
  onCancel,
}: MoveDialogProps): React.ReactNode {
  const { browser } = useSession();
  const { sendMessage } = useWebSocket();
  const { directoryCache } = browser;

  // Track the selected destination directory
  const [selectedDir, setSelectedDir] = useState<string>("");
  // Track expanded directories in the mini tree
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set([""]));
  // Track directories being loaded
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());

  // Get source file/dir name and current parent
  const sourceName = useMemo(() => getBaseName(sourcePath), [sourcePath]);
  const sourceParent = useMemo(() => getParentPath(sourcePath), [sourcePath]);

  // Compute the final destination path
  const destinationPath = useMemo(() => {
    if (selectedDir === "") {
      return sourceName;
    }
    return `${selectedDir}/${sourceName}`;
  }, [selectedDir, sourceName]);

  // Check if the path has actually changed
  const hasChanged = useMemo(() => {
    return selectedDir !== sourceParent;
  }, [selectedDir, sourceParent]);

  // Check if destination is invalid (moving directory into itself)
  const isInvalidDestination = useMemo(() => {
    if (!isDirectory) return false;
    // Can't move a directory into itself or its subdirectories
    return selectedDir === sourcePath || selectedDir.startsWith(sourcePath + "/");
  }, [isDirectory, selectedDir, sourcePath]);

  // Initialize selected directory to source parent when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedDir(sourceParent);
      // Expand path to current location
      const pathParts = sourceParent.split("/").filter(Boolean);
      const dirsToExpand = new Set<string>([""]);
      let current = "";
      for (const part of pathParts) {
        current = current ? `${current}/${part}` : part;
        dirsToExpand.add(current);
      }
      setExpandedDirs(dirsToExpand);
    }
  }, [isOpen, sourceParent]);

  // Load a directory's contents
  const loadDirectory = useCallback(
    (path: string) => {
      if (!directoryCache.get(path) && !loadingDirs.has(path)) {
        setLoadingDirs((prev) => new Set([...prev, path]));
        sendMessage({ type: "list_directory", path });
      }
    },
    [directoryCache, loadingDirs, sendMessage]
  );

  // Load root directory on open
  useEffect(() => {
    if (isOpen) {
      loadDirectory("");
    }
  }, [isOpen, loadDirectory]);

  // Toggle directory expansion
  const toggleDirectory = useCallback(
    (path: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          loadDirectory(path);
        }
        return next;
      });
    },
    [loadDirectory]
  );

  // Select a directory as destination
  const selectDirectory = useCallback((path: string) => {
    setSelectedDir(path);
  }, []);

  // Handle confirm
  const handleConfirm = useCallback(() => {
    if (hasChanged && !isInvalidDestination) {
      onConfirm(destinationPath);
    }
  }, [hasChanged, isInvalidDestination, destinationPath, onConfirm]);

  // Render a directory item and its children
  const renderDirectoryItem = useCallback(
    (entry: FileEntry, depth: number = 0): React.ReactNode => {
      if (entry.type !== "directory") return null;

      // Don't show the source directory being moved (can't move into itself)
      if (isDirectory && entry.path === sourcePath) return null;

      const isExpanded = expandedDirs.has(entry.path);
      const isSelected = selectedDir === entry.path;
      const children = directoryCache.get(entry.path) ?? [];
      const dirs = children.filter((c: FileEntry) => c.type === "directory");

      return (
        <div key={entry.path} className="move-dialog__tree-item">
          <button
            type="button"
            className={`move-dialog__tree-row ${isSelected ? "move-dialog__tree-row--selected" : ""}`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => selectDirectory(entry.path)}
          >
            <span
              className={`move-dialog__tree-toggle ${dirs.length > 0 || !directoryCache.get(entry.path) ? "" : "move-dialog__tree-toggle--empty"}`}
              onClick={(e) => {
                e.stopPropagation();
                if (dirs.length > 0 || !directoryCache.get(entry.path)) {
                  toggleDirectory(entry.path);
                }
              }}
            >
              {dirs.length > 0 || !directoryCache.get(entry.path) ? (isExpanded ? "▼" : "▶") : ""}
            </span>
            <span className="move-dialog__tree-icon">📁</span>
            <span className="move-dialog__tree-name">{entry.name}</span>
          </button>
          {isExpanded && dirs.length > 0 && (
            <div className="move-dialog__tree-children">
              {dirs.map((child: FileEntry) => renderDirectoryItem(child, depth + 1))}
            </div>
          )}
        </div>
      );
    },
    [expandedDirs, selectedDir, directoryCache, isDirectory, sourcePath, selectDirectory, toggleDirectory]
  );

  // Get root-level directories
  const rootDirs = useMemo(() => {
    const entries = directoryCache.get("") ?? [];
    return entries.filter((e: FileEntry) => e.type === "directory");
  }, [directoryCache]);

  if (!isOpen) return null;

  return (
    <div className="move-dialog__backdrop" onClick={onCancel}>
      <div className="move-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="move-dialog__title">
          Move {isDirectory ? "Folder" : "File"}
        </h2>
        <p className="move-dialog__subtitle">
          Select a destination folder for <strong>{sourceName}</strong>
        </p>

        <div className="move-dialog__path-display">
          <span className="move-dialog__path-label">Destination:</span>
          <span className="move-dialog__path-value">
            /{destinationPath || sourceName}
          </span>
        </div>

        <div className="move-dialog__tree-container">
          <button
            type="button"
            className={`move-dialog__tree-row move-dialog__tree-row--root ${selectedDir === "" ? "move-dialog__tree-row--selected" : ""}`}
            onClick={() => selectDirectory("")}
          >
            <span className="move-dialog__tree-icon">🏠</span>
            <span className="move-dialog__tree-name">Vault Root</span>
          </button>
          <div className="move-dialog__tree-children">
            {rootDirs.map((entry: FileEntry) => renderDirectoryItem(entry, 1))}
          </div>
        </div>

        {isInvalidDestination && (
          <p className="move-dialog__error">
            Cannot move a folder into itself or its subfolders
          </p>
        )}

        <div className="move-dialog__actions">
          <button
            type="button"
            className="move-dialog__btn move-dialog__btn--cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="move-dialog__btn move-dialog__btn--confirm"
            onClick={handleConfirm}
            disabled={!hasChanged || isInvalidDestination}
          >
            Move
          </button>
        </div>
      </div>
    </div>
  );
}
