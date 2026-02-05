/**
 * JsonViewer Component
 *
 * Renders JSON content with formatted display and editing support.
 * Validates JSON before saving to prevent corruption.
 */

import {
  useMemo,
  useCallback,
  useState,
  useEffect,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { useSession } from "../../../contexts/SessionContext";
import "./JsonViewer.css";

/**
 * Props for JsonViewer component.
 */
export interface JsonViewerProps {
  /** Callback when a path is navigated (breadcrumb) */
  onNavigate?: (path: string) => void;
  /** Callback to save file content in adjust mode */
  onSave?: (content: string) => void;
  /** Callback to open mobile file browser (only shown on mobile) */
  onMobileMenuClick?: () => void;
  /** Callback to delete the current file */
  onDelete?: () => void;
}

/**
 * Breadcrumb component for file path navigation.
 */
function Breadcrumb({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void;
}): ReactNode {
  const [isExpanded, setIsExpanded] = useState(false);
  const segments = path.split("/").filter(Boolean);

  // Reset expanded state when path changes
  useEffect(() => {
    setIsExpanded(false);
  }, [path]);

  if (segments.length === 0) {
    return null;
  }

  // Build path segments with cumulative paths
  const allCrumbs = segments.map((segment, index) => ({
    name: segment,
    path: segments.slice(0, index + 1).join("/"),
    isLast: index === segments.length - 1,
  }));

  // Collapse middle segments if more than 3 and not expanded
  const shouldCollapse = segments.length > 3 && !isExpanded;
  const visibleCrumbs = shouldCollapse ? allCrumbs.slice(-2) : allCrumbs;

  return (
    <nav className="json-viewer__breadcrumb" aria-label="File path">
      <button
        type="button"
        className="json-viewer__breadcrumb-item"
        onClick={() => onNavigate("")}
      >
        Root
      </button>
      {shouldCollapse && (
        <span>
          <span className="json-viewer__breadcrumb-separator">/</span>
          <button
            type="button"
            className="json-viewer__breadcrumb-ellipsis"
            onClick={() => setIsExpanded(true)}
            aria-label="Show full path"
          >
            …
          </button>
        </span>
      )}
      {visibleCrumbs.map((crumb) => (
        <span key={crumb.path}>
          <span className="json-viewer__breadcrumb-separator">/</span>
          {crumb.isLast ? (
            <span className="json-viewer__breadcrumb-current">{crumb.name}</span>
          ) : (
            <button
              type="button"
              className="json-viewer__breadcrumb-item"
              onClick={() => onNavigate(crumb.path)}
            >
              {crumb.name}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}

/**
 * Loading skeleton for JSON content.
 */
function LoadingSkeleton(): ReactNode {
  return (
    <div className="json-viewer__skeleton" aria-label="Loading content">
      <div className="json-viewer__skeleton-line json-viewer__skeleton-line--short" />
      <div className="json-viewer__skeleton-line" />
      <div className="json-viewer__skeleton-line json-viewer__skeleton-line--medium" />
      <div className="json-viewer__skeleton-line" />
      <div className="json-viewer__skeleton-line json-viewer__skeleton-line--short" />
    </div>
  );
}

/**
 * Validates and formats JSON content.
 * Returns formatted JSON or null if invalid.
 */
function formatJson(content: string): string | null {
  try {
    const parsed: unknown = JSON.parse(content);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

/**
 * JsonViewer renders vault JSON files with:
 * - Formatted JSON display
 * - Breadcrumb navigation
 * - Adjust mode for editing
 * - JSON validation on save
 */
export function JsonViewer({
  onNavigate,
  onSave,
  onMobileMenuClick,
  onDelete,
}: JsonViewerProps): ReactNode {
  const {
    browser,
    setCurrentPath,
    startAdjust,
    updateAdjustContent,
    cancelAdjust,
  } = useSession();
  const {
    currentPath,
    currentFileContent,
    currentFileTruncated,
    fileError,
    isLoading,
    isAdjusting,
    adjustContent,
    adjustError,
    isSaving,
  } = browser;

  // Local state for JSON validation error
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Format JSON for display
  const formattedJson = useMemo(() => {
    if (!currentFileContent) return null;
    return formatJson(currentFileContent);
  }, [currentFileContent]);

  // Handle breadcrumb navigation
  const handleBreadcrumbNavigate = useCallback(
    (path: string) => {
      setCurrentPath(path);
      if (!path.endsWith(".json")) {
        onNavigate?.("");
      }
    },
    [setCurrentPath, onNavigate]
  );

  // Handle Escape key in adjust mode
  const handleTextareaKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelAdjust();
        setJsonError(null);
      }
    },
    [cancelAdjust]
  );

  // Handle textarea content change
  const handleContentChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateAdjustContent(event.target.value);
      // Clear validation error when user types
      if (jsonError) {
        setJsonError(null);
      }
    },
    [updateAdjustContent, jsonError]
  );

  // Handle save button click with JSON validation
  const handleSave = useCallback(() => {
    // Validate JSON before saving
    try {
      JSON.parse(adjustContent);
      setJsonError(null);
      onSave?.(adjustContent);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Invalid JSON";
      setJsonError(`Invalid JSON: ${message}`);
    }
  }, [onSave, adjustContent]);

  // Handle cancel with cleanup
  const handleCancel = useCallback(() => {
    cancelAdjust();
    setJsonError(null);
  }, [cancelAdjust]);

  // Loading state
  if (isLoading) {
    return (
      <div className="json-viewer json-viewer--loading">
        <Breadcrumb path={currentPath} onNavigate={handleBreadcrumbNavigate} />
        <LoadingSkeleton />
      </div>
    );
  }

  // Error state
  if (fileError) {
    return (
      <div className="json-viewer json-viewer--error">
        <Breadcrumb path={currentPath} onNavigate={handleBreadcrumbNavigate} />
        <div className="json-viewer__error-content">
          <p className="json-viewer__error-message">{fileError}</p>
        </div>
      </div>
    );
  }

  // Empty state - no file selected
  if (!currentFileContent) {
    return (
      <div className="json-viewer json-viewer--empty">
        <div className="json-viewer__empty-content">
          <p>Select a file to view its content</p>
        </div>
      </div>
    );
  }

  // Adjust mode - show textarea for editing
  if (isAdjusting) {
    return (
      <div className="json-viewer json-viewer--adjusting">
        {/* Toolbar with breadcrumb and Save/Cancel buttons */}
        <div className="json-viewer__toolbar">
          {onMobileMenuClick && (
            <button
              type="button"
              className="viewer-mobile-menu-btn"
              onClick={onMobileMenuClick}
              aria-label="Open file browser"
            >
              <svg
                className="viewer-mobile-menu-btn__icon"
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
            </button>
          )}
          <Breadcrumb path={currentPath} onNavigate={handleBreadcrumbNavigate} />
          <div className="json-viewer__adjust-actions">
            <button
              type="button"
              className="json-viewer__adjust-btn json-viewer__adjust-btn--save"
              onClick={handleSave}
              disabled={isSaving}
              aria-label="Save changes"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className="json-viewer__adjust-btn json-viewer__adjust-btn--cancel"
              onClick={handleCancel}
              disabled={isSaving}
              aria-label="Cancel editing"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Error message display (from backend or JSON validation) */}
        {(adjustError || jsonError) && (
          <div className="json-viewer__adjust-error" role="alert">
            {adjustError || jsonError}
          </div>
        )}

        <div className="json-viewer__adjust-content">
          <textarea
            className="json-viewer__adjust-textarea"
            value={adjustContent}
            onChange={handleContentChange}
            onKeyDown={handleTextareaKeyDown}
            disabled={isSaving}
            autoFocus
            spellCheck={false}
            aria-label="JSON content editor"
          />
        </div>
      </div>
    );
  }

  // Normal view mode
  return (
    <div className="json-viewer">
      <div className="json-viewer__toolbar">
        {onMobileMenuClick && (
          <button
            type="button"
            className="viewer-mobile-menu-btn"
            onClick={onMobileMenuClick}
            aria-label="Open file browser"
          >
            <svg
              className="viewer-mobile-menu-btn__icon"
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
          </button>
        )}
        <Breadcrumb path={currentPath} onNavigate={handleBreadcrumbNavigate} />
        <div className="json-viewer__toolbar-actions">
          <button
            type="button"
            className="json-viewer__adjust-btn"
            onClick={startAdjust}
            aria-label="Adjust file"
          >
            Adjust
          </button>
          {onDelete && (
            <button
              type="button"
              className="json-viewer__delete-btn"
              onClick={onDelete}
              aria-label="Delete file"
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </div>

      {currentFileTruncated && (
        <div className="json-viewer__truncation-warning" role="alert">
          This file was truncated due to size limits. Some content may be missing.
        </div>
      )}

      <div className="json-viewer__content">
        {formattedJson !== null ? (
          <pre className="json-viewer__json">
            <code>{formattedJson}</code>
          </pre>
        ) : (
          <div className="json-viewer__invalid-json" role="alert">
            <p>This file contains invalid JSON and cannot be formatted.</p>
            <pre className="json-viewer__raw">{currentFileContent}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Trash icon for delete button.
 */
function TrashIcon(): ReactNode {
  return (
    <svg
      className="json-viewer__icon"
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
