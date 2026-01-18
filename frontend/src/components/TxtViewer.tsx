/**
 * TxtViewer Component
 *
 * Renders plain text content with display and editing support.
 * Similar to JsonViewer but without JSON parsing/validation.
 */

import {
  useCallback,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { useSession } from "../contexts/SessionContext";
import "./TxtViewer.css";

/**
 * Props for TxtViewer component.
 */
export interface TxtViewerProps {
  /** Callback when a path is navigated (breadcrumb) */
  onNavigate?: (path: string) => void;
  /** Callback to save file content in adjust mode */
  onSave?: (content: string) => void;
  /** Callback to open mobile file browser (only shown on mobile) */
  onMobileMenuClick?: () => void;
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
  const segments = path.split("/").filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  const crumbs = segments.map((segment, index) => ({
    name: segment,
    path: segments.slice(0, index + 1).join("/"),
    isLast: index === segments.length - 1,
  }));

  return (
    <nav className="txt-viewer__breadcrumb" aria-label="File path">
      <button
        type="button"
        className="txt-viewer__breadcrumb-item"
        onClick={() => onNavigate("")}
      >
        Root
      </button>
      {crumbs.map((crumb) => (
        <span key={crumb.path}>
          <span className="txt-viewer__breadcrumb-separator">/</span>
          {crumb.isLast ? (
            <span className="txt-viewer__breadcrumb-current">{crumb.name}</span>
          ) : (
            <button
              type="button"
              className="txt-viewer__breadcrumb-item"
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
 * Loading skeleton for text content.
 */
function LoadingSkeleton(): ReactNode {
  return (
    <div className="txt-viewer__skeleton" aria-label="Loading content">
      <div className="txt-viewer__skeleton-line txt-viewer__skeleton-line--short" />
      <div className="txt-viewer__skeleton-line" />
      <div className="txt-viewer__skeleton-line txt-viewer__skeleton-line--medium" />
      <div className="txt-viewer__skeleton-line" />
      <div className="txt-viewer__skeleton-line txt-viewer__skeleton-line--short" />
    </div>
  );
}

/**
 * TxtViewer renders vault plain text files with:
 * - Plain text display
 * - Breadcrumb navigation
 * - Adjust mode for editing
 */
export function TxtViewer({
  onNavigate,
  onSave,
  onMobileMenuClick,
}: TxtViewerProps): ReactNode {
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

  // Local state for any save errors
  const [saveError, setSaveError] = useState<string | null>(null);

  // Handle breadcrumb navigation
  const handleBreadcrumbNavigate = useCallback(
    (path: string) => {
      setCurrentPath(path);
      if (!path.endsWith(".txt")) {
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
        setSaveError(null);
      }
    },
    [cancelAdjust]
  );

  // Handle textarea content change
  const handleContentChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateAdjustContent(event.target.value);
      // Clear error when user types
      if (saveError) {
        setSaveError(null);
      }
    },
    [updateAdjustContent, saveError]
  );

  // Handle save button click
  const handleSave = useCallback(() => {
    setSaveError(null);
    onSave?.(adjustContent);
  }, [onSave, adjustContent]);

  // Handle cancel with cleanup
  const handleCancel = useCallback(() => {
    cancelAdjust();
    setSaveError(null);
  }, [cancelAdjust]);

  // Loading state
  if (isLoading) {
    return (
      <div className="txt-viewer txt-viewer--loading">
        <Breadcrumb path={currentPath} onNavigate={handleBreadcrumbNavigate} />
        <LoadingSkeleton />
      </div>
    );
  }

  // Error state
  if (fileError) {
    return (
      <div className="txt-viewer txt-viewer--error">
        <Breadcrumb path={currentPath} onNavigate={handleBreadcrumbNavigate} />
        <div className="txt-viewer__error-content">
          <p className="txt-viewer__error-message">{fileError}</p>
        </div>
      </div>
    );
  }

  // Empty state - no file selected
  if (!currentFileContent) {
    return (
      <div className="txt-viewer txt-viewer--empty">
        <div className="txt-viewer__empty-content">
          <p>Select a file to view its content</p>
        </div>
      </div>
    );
  }

  // Adjust mode - show textarea for editing
  if (isAdjusting) {
    return (
      <div className="txt-viewer txt-viewer--adjusting">
        {/* Toolbar with breadcrumb and Save/Cancel buttons */}
        <div className="txt-viewer__toolbar">
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
          <div className="txt-viewer__adjust-actions">
            <button
              type="button"
              className="txt-viewer__adjust-btn txt-viewer__adjust-btn--save"
              onClick={handleSave}
              disabled={isSaving}
              aria-label="Save changes"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className="txt-viewer__adjust-btn txt-viewer__adjust-btn--cancel"
              onClick={handleCancel}
              disabled={isSaving}
              aria-label="Cancel editing"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Error message display */}
        {(adjustError || saveError) && (
          <div className="txt-viewer__adjust-error" role="alert">
            {adjustError || saveError}
          </div>
        )}

        <div className="txt-viewer__adjust-content">
          <textarea
            className="txt-viewer__adjust-textarea"
            value={adjustContent}
            onChange={handleContentChange}
            onKeyDown={handleTextareaKeyDown}
            disabled={isSaving}
            autoFocus
            spellCheck={false}
            aria-label="File content editor"
          />
        </div>
      </div>
    );
  }

  // Normal view mode
  return (
    <div className="txt-viewer">
      <div className="txt-viewer__toolbar">
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
        <button
          type="button"
          className="txt-viewer__adjust-btn"
          onClick={startAdjust}
          aria-label="Adjust file"
        >
          Adjust
        </button>
      </div>

      {currentFileTruncated && (
        <div className="txt-viewer__truncation-warning" role="alert">
          This file was truncated due to size limits. Some content may be missing.
        </div>
      )}

      <div className="txt-viewer__content">
        <pre className="txt-viewer__text">
          <code>{currentFileContent}</code>
        </pre>
      </div>
    </div>
  );
}
