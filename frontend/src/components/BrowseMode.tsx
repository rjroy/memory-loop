/**
 * BrowseMode Component
 *
 * Split-pane container that coordinates FileTree and MarkdownViewer.
 * Supports collapsible tree panel and mobile-friendly overlay.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "../contexts/SessionContext";
import { useWebSocket } from "../hooks/useWebSocket";
import { FileTree } from "./FileTree";
import { MarkdownViewer } from "./MarkdownViewer";
import "./BrowseMode.css";

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

  const { browser, vault, cacheDirectory, setFileContent, setFileError, setFileLoading } = useSession();

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
        if (
          lastMessage.code === "FILE_NOT_FOUND" ||
          lastMessage.code === "DIRECTORY_NOT_FOUND" ||
          lastMessage.code === "INVALID_FILE_TYPE"
        ) {
          setFileError(lastMessage.message);
        }
        setFileLoading(false);
        break;
    }
  }, [lastMessage, cacheDirectory, setFileContent, setFileError, setFileLoading]);

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

  // Toggle tree collapse state
  const toggleTreeCollapse = useCallback(() => {
    setIsTreeCollapsed((prev) => !prev);
  }, []);

  // Toggle mobile tree overlay
  const toggleMobileTree = useCallback(() => {
    setIsMobileTreeOpen((prev) => !prev);
  }, []);

  // Close mobile tree overlay
  const closeMobileTree = useCallback(() => {
    setIsMobileTreeOpen(false);
  }, []);

  return (
    <div className={`browse-mode ${isTreeCollapsed ? "browse-mode--tree-collapsed" : ""}`}>
      {/* Desktop tree pane */}
      <aside className="browse-mode__tree-pane">
        <div className="browse-mode__tree-header">
          <h2 className="browse-mode__tree-title">Files</h2>
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
        {!isTreeCollapsed && (
          <div className="browse-mode__tree-content">
            <FileTree onFileSelect={handleFileSelect} onLoadDirectory={handleLoadDirectory} />
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
          <MarkdownViewer onNavigate={handleNavigate} assetBaseUrl={assetBaseUrl} />
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
              <h2 className="browse-mode__tree-title">Files</h2>
              <button
                type="button"
                className="browse-mode__close-btn"
                onClick={closeMobileTree}
                aria-label="Close file browser"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="browse-mode__tree-content">
              <FileTree onFileSelect={handleFileSelect} onLoadDirectory={handleLoadDirectory} />
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
