/**
 * MarkdownViewer Component
 *
 * Renders markdown content with wiki-link support, breadcrumb navigation,
 * and proper handling of images and external links.
 */

import {
  useMemo,
  useCallback,
  type ReactNode,
  type ComponentProps,
  type KeyboardEvent,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import yaml from "js-yaml";
import { useSession } from "../contexts/SessionContext";
import { encodeAssetPath } from "../utils/file-types";
import "./MarkdownViewer.css";

/**
 * Props for MarkdownViewer component.
 */
export interface MarkdownViewerProps {
  /** Callback when a wiki-link is clicked */
  onNavigate?: (path: string) => void;
  /** Base URL for vault assets (images) */
  assetBaseUrl?: string;
  /** Callback to save file content in adjust mode (wired by parent to WebSocket) */
  onSave?: (content: string) => void;
}

/**
 * Wiki-link pattern: [[note-name]] or [[note-name|display text]]
 */
const WIKI_LINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/**
 * Parses text for wiki-links and returns an array of text and link elements.
 */
function parseWikiLinks(
  text: string,
  onLinkClick: (target: string) => void
): ReactNode[] {
  const result: ReactNode[] = [];
  let lastIndex = 0;

  // Use matchAll to avoid regex state issues
  for (const match of text.matchAll(WIKI_LINK_PATTERN)) {
    // Add text before this match
    if (match.index !== undefined && match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index));
    }

    const target = match[1];
    const display = match[2] ?? target;
    const targetPath = target.endsWith(".md") ? target : `${target}.md`;

    result.push(
      <a
        key={`wiki-${match.index}`}
        href="#"
        className="markdown-viewer__wiki-link"
        data-wiki-target={targetPath}
        onClick={(e) => {
          e.preventDefault();
          onLinkClick(targetPath);
        }}
      >
        {display}
      </a>
    );

    lastIndex = (match.index ?? 0) + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return result.length > 0 ? result : [text];
}

/**
 * Recursively processes children to parse wiki-links in text nodes.
 */
function processChildren(
  children: ReactNode,
  onLinkClick: (target: string) => void
): ReactNode {
  if (typeof children === "string") {
    const parsed = parseWikiLinks(children, onLinkClick);
    return parsed.length === 1 ? parsed[0] : parsed;
  }

  if (Array.isArray(children)) {
    const processed: ReactNode[] = children.map((child, i): ReactNode => {
      if (typeof child === "string") {
        const parsed = parseWikiLinks(child, onLinkClick);
        return parsed.length === 1 ? (
          <span key={i}>{parsed[0]}</span>
        ) : (
          <span key={i}>{parsed}</span>
        );
      }
      return child as ReactNode;
    });
    return processed;
  }

  return children;
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

  // Build path segments with cumulative paths
  const crumbs = segments.map((segment, index) => ({
    name: segment,
    path: segments.slice(0, index + 1).join("/"),
    isLast: index === segments.length - 1,
  }));

  return (
    <nav className="markdown-viewer__breadcrumb" aria-label="File path">
      <button
        type="button"
        className="markdown-viewer__breadcrumb-item"
        onClick={() => onNavigate("")}
      >
        Root
      </button>
      {crumbs.map((crumb) => (
        <span key={crumb.path}>
          <span className="markdown-viewer__breadcrumb-separator">/</span>
          {crumb.isLast ? (
            <span className="markdown-viewer__breadcrumb-current">{crumb.name}</span>
          ) : (
            <button
              type="button"
              className="markdown-viewer__breadcrumb-item"
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
 * Loading skeleton for markdown content.
 */
function LoadingSkeleton(): ReactNode {
  return (
    <div className="markdown-viewer__skeleton" aria-label="Loading content">
      <div className="markdown-viewer__skeleton-line markdown-viewer__skeleton-line--heading" />
      <div className="markdown-viewer__skeleton-line" />
      <div className="markdown-viewer__skeleton-line" />
      <div className="markdown-viewer__skeleton-line markdown-viewer__skeleton-line--short" />
      <div className="markdown-viewer__skeleton-line" />
      <div className="markdown-viewer__skeleton-line markdown-viewer__skeleton-line--medium" />
    </div>
  );
}

/**
 * Formats a frontmatter value for display.
 * Handles arrays, objects, and primitive values.
 */
function formatFrontmatterValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (value instanceof Date) {
    return value.toLocaleDateString();
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * FrontmatterTable renders YAML frontmatter as a styled table.
 * Similar to how GitHub renders frontmatter in markdown files.
 */
function FrontmatterTable({
  data,
}: {
  data: Record<string, unknown>;
}): ReactNode {
  const entries = Object.entries(data);

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="markdown-viewer__frontmatter">
      <table className="markdown-viewer__frontmatter-table">
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <th className="markdown-viewer__frontmatter-key">{key}</th>
              <td className="markdown-viewer__frontmatter-value">
                {formatFrontmatterValue(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Creates custom react-markdown components with wiki-link and asset handling.
 */
function createMarkdownComponents(
  assetBaseUrl: string,
  onWikiLinkClick: (target: string) => void
) {
  return {
    // Handle links - external links get target="_blank", wiki-links are handled in text
    a: ({ href, children, ...props }: ComponentProps<"a">) => {
      const isExternal = href?.startsWith("http://") || href?.startsWith("https://");

      if (isExternal) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="markdown-viewer__external-link"
            {...props}
          >
            {children}
          </a>
        );
      }

      return (
        <a href={href} {...props}>
          {children}
        </a>
      );
    },

    // Handle images - prepend asset base URL for relative paths
    img: ({ src, alt, ...props }: ComponentProps<"img">) => {
      const isRelative =
        src &&
        !src.startsWith("http://") &&
        !src.startsWith("https://") &&
        !src.startsWith("data:");
      const resolvedSrc = isRelative ? `${assetBaseUrl}/${encodeAssetPath(src)}` : src;

      return <img src={resolvedSrc} alt={alt} loading="lazy" {...props} />;
    },

    // Handle paragraphs - parse wiki-links
    p: ({ children, ...props }: ComponentProps<"p">) => (
      <p {...props}>{processChildren(children, onWikiLinkClick)}</p>
    ),

    // Handle list items - parse wiki-links
    li: ({ children, ...props }: ComponentProps<"li">) => (
      <li {...props}>{processChildren(children, onWikiLinkClick)}</li>
    ),

    // Handle headings - parse wiki-links
    h1: ({ children, ...props }: ComponentProps<"h1">) => (
      <h1 {...props}>{processChildren(children, onWikiLinkClick)}</h1>
    ),
    h2: ({ children, ...props }: ComponentProps<"h2">) => (
      <h2 {...props}>{processChildren(children, onWikiLinkClick)}</h2>
    ),
    h3: ({ children, ...props }: ComponentProps<"h3">) => (
      <h3 {...props}>{processChildren(children, onWikiLinkClick)}</h3>
    ),
    h4: ({ children, ...props }: ComponentProps<"h4">) => (
      <h4 {...props}>{processChildren(children, onWikiLinkClick)}</h4>
    ),
    h5: ({ children, ...props }: ComponentProps<"h5">) => (
      <h5 {...props}>{processChildren(children, onWikiLinkClick)}</h5>
    ),
    h6: ({ children, ...props }: ComponentProps<"h6">) => (
      <h6 {...props}>{processChildren(children, onWikiLinkClick)}</h6>
    ),
  };
}

/**
 * MarkdownViewer renders vault file content with:
 * - Markdown formatting via react-markdown
 * - Wiki-link parsing and navigation
 * - Breadcrumb navigation
 * - Truncation warnings
 * - Loading states
 * - Adjust mode for inline editing (REQ-F-1 to REQ-F-6)
 * - Built-in XSS protection (react-markdown sanitizes by default)
 */
export function MarkdownViewer({
  onNavigate,
  assetBaseUrl = "/vault/assets",
  onSave,
}: MarkdownViewerProps): ReactNode {
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

  // Handle wiki-link clicks - resolve paths
  // Obsidian wikilinks with paths (containing /) are absolute from vault root
  // Wikilinks without paths are relative to current directory
  const handleWikiLinkClick = useCallback(
    (targetPath: string) => {
      // If target contains a path separator, treat as absolute from content root
      if (targetPath.includes("/")) {
        onNavigate?.(targetPath);
        return;
      }
      // Otherwise, resolve relative to current directory
      const currentDir = currentPath.includes("/")
        ? currentPath.substring(0, currentPath.lastIndexOf("/"))
        : "";
      const resolvedPath = currentDir ? `${currentDir}/${targetPath}` : targetPath;
      onNavigate?.(resolvedPath);
    },
    [currentPath, onNavigate]
  );

  // Create markdown components with current handlers
  const components = useMemo(
    () => createMarkdownComponents(assetBaseUrl, handleWikiLinkClick),
    [assetBaseUrl, handleWikiLinkClick]
  );

  // Parse frontmatter from content using js-yaml (browser-compatible)
  const { frontmatter, markdownContent } = useMemo(() => {
    if (!currentFileContent) {
      return { frontmatter: null, markdownContent: "" };
    }

    // Check for frontmatter: must start with --- on first line
    if (!currentFileContent.startsWith("---")) {
      return { frontmatter: null, markdownContent: currentFileContent };
    }

    // Find the closing --- delimiter
    const endMatch = currentFileContent.indexOf("\n---", 3);
    if (endMatch === -1) {
      return { frontmatter: null, markdownContent: currentFileContent };
    }

    try {
      // Extract YAML between delimiters
      const yamlContent = currentFileContent.slice(4, endMatch);
      const data = yaml.load(yamlContent) as Record<string, unknown> | null;

      // Extract content after closing delimiter
      const contentStart = endMatch + 4; // Skip \n---
      const content = currentFileContent.slice(contentStart).replace(/^\n+/, "");

      const hasFrontmatter = data !== null && typeof data === "object" && Object.keys(data).length > 0;

      return {
        frontmatter: hasFrontmatter ? data : null,
        markdownContent: content,
      };
    } catch {
      // If YAML parsing fails, render content as-is
      return { frontmatter: null, markdownContent: currentFileContent };
    }
  }, [currentFileContent]);

  // Handle breadcrumb navigation
  const handleBreadcrumbNavigate = useCallback(
    (path: string) => {
      setCurrentPath(path);
      // If navigating to a directory, clear file content
      if (!path.endsWith(".md")) {
        onNavigate?.("");
      }
    },
    [setCurrentPath, onNavigate]
  );

  // Handle Escape key in adjust mode (REQ-F-6)
  const handleTextareaKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelAdjust();
      }
    },
    [cancelAdjust]
  );

  // Handle textarea content change
  const handleContentChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateAdjustContent(event.target.value);
    },
    [updateAdjustContent]
  );

  // Handle save button click
  const handleSave = useCallback(() => {
    onSave?.(adjustContent);
  }, [onSave, adjustContent]);

  // Loading state
  if (isLoading) {
    return (
      <div className="markdown-viewer markdown-viewer--loading">
        <Breadcrumb path={currentPath} onNavigate={handleBreadcrumbNavigate} />
        <LoadingSkeleton />
      </div>
    );
  }

  // Error state
  if (fileError) {
    return (
      <div className="markdown-viewer markdown-viewer--error">
        <Breadcrumb path={currentPath} onNavigate={handleBreadcrumbNavigate} />
        <div className="markdown-viewer__error-content">
          <p className="markdown-viewer__error-message">{fileError}</p>
        </div>
      </div>
    );
  }

  // Empty state - no file selected
  if (!currentFileContent) {
    return (
      <div className="markdown-viewer markdown-viewer--empty">
        <div className="markdown-viewer__empty-content">
          <p>Select a file to view its content</p>
        </div>
      </div>
    );
  }

  // Adjust mode - show textarea for editing (REQ-F-2, REQ-F-3)
  if (isAdjusting) {
    return (
      <div className="markdown-viewer markdown-viewer--adjusting">
        <Breadcrumb path={currentPath} onNavigate={handleBreadcrumbNavigate} />

        {/* Header with Save/Cancel buttons (REQ-F-3) */}
        <div className="markdown-viewer__adjust-header">
          <div className="markdown-viewer__adjust-actions">
            <button
              type="button"
              className="markdown-viewer__adjust-btn markdown-viewer__adjust-btn--save"
              onClick={handleSave}
              disabled={isSaving}
              aria-label="Save changes"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className="markdown-viewer__adjust-btn markdown-viewer__adjust-btn--cancel"
              onClick={cancelAdjust}
              disabled={isSaving}
              aria-label="Cancel editing"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Error message display (REQ-F-14) */}
        {adjustError && (
          <div className="markdown-viewer__adjust-error" role="alert">
            {adjustError}
          </div>
        )}

        {/* Textarea for editing (REQ-F-2, REQ-NF-2) */}
        <div className="markdown-viewer__adjust-content">
          <textarea
            className="markdown-viewer__adjust-textarea"
            value={adjustContent}
            onChange={handleContentChange}
            onKeyDown={handleTextareaKeyDown}
            disabled={isSaving}
            autoFocus
            aria-label="File content editor"
          />
        </div>
      </div>
    );
  }

  // Normal view mode with Adjust button (REQ-F-1)
  return (
    <div className="markdown-viewer">
      <Breadcrumb path={currentPath} onNavigate={handleBreadcrumbNavigate} />

      {/* Header with Adjust button (REQ-F-1) */}
      <div className="markdown-viewer__view-header">
        <button
          type="button"
          className="markdown-viewer__adjust-btn"
          onClick={startAdjust}
          aria-label="Adjust file"
        >
          Adjust
        </button>
      </div>

      {currentFileTruncated && (
        <div className="markdown-viewer__truncation-warning" role="alert">
          This file was truncated due to size limits. Some content may be missing.
        </div>
      )}

      <div className="markdown-viewer__content">
        {frontmatter && <FrontmatterTable data={frontmatter} />}
        <Markdown
          remarkPlugins={[remarkGfm, remarkFrontmatter]}
          components={components}
        >
          {markdownContent}
        </Markdown>
      </div>
    </div>
  );
}
