/**
 * MarkdownViewer Component
 *
 * Renders markdown content with wiki-link support, breadcrumb navigation,
 * and proper handling of images and external links.
 */

import { useMemo, useCallback, type ReactNode, type ComponentProps } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSession } from "../contexts/SessionContext";
import "./MarkdownViewer.css";

/**
 * Props for MarkdownViewer component.
 */
export interface MarkdownViewerProps {
  /** Callback when a wiki-link is clicked */
  onNavigate?: (path: string) => void;
  /** Base URL for vault assets (images) */
  assetBaseUrl?: string;
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
      const resolvedSrc = isRelative ? `${assetBaseUrl}/${src}` : src;

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
 * - Built-in XSS protection (react-markdown sanitizes by default)
 */
export function MarkdownViewer({
  onNavigate,
  assetBaseUrl = "/vault/assets",
}: MarkdownViewerProps): ReactNode {
  const { browser, setCurrentPath } = useSession();
  const { currentPath, currentFileContent, currentFileTruncated, fileError, isLoading } =
    browser;

  // Handle wiki-link clicks - resolve relative paths
  const handleWikiLinkClick = useCallback(
    (targetPath: string) => {
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

  return (
    <div className="markdown-viewer">
      <Breadcrumb path={currentPath} onNavigate={handleBreadcrumbNavigate} />

      {currentFileTruncated && (
        <div className="markdown-viewer__truncation-warning" role="alert">
          This file was truncated due to size limits. Some content may be missing.
        </div>
      )}

      <div className="markdown-viewer__content">
        <Markdown remarkPlugins={[remarkGfm]} components={components}>
          {currentFileContent}
        </Markdown>
      </div>
    </div>
  );
}
