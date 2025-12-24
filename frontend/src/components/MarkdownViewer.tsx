/**
 * MarkdownViewer Component
 *
 * Renders markdown content with wiki-link support, breadcrumb navigation,
 * and proper handling of images and external links.
 */

import { useMemo, useCallback } from "react";
import { marked, type Renderer, type Tokens } from "marked";
import DOMPurify from "dompurify";
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
 * Parses wiki-links in text and returns HTML with clickable links.
 */
function parseWikiLinks(text: string): string {
  return text.replace(WIKI_LINK_PATTERN, (_match, target: string, display?: string) => {
    const displayText = display ?? target;
    // Add .md extension if not present
    const targetPath = target.endsWith(".md") ? target : `${target}.md`;
    return `<a href="#" class="markdown-viewer__wiki-link" data-wiki-target="${targetPath}">${displayText}</a>`;
  });
}

/**
 * Creates a custom marked renderer for our needs.
 */
function createRenderer(assetBaseUrl: string): Partial<Renderer> {
  return {
    // Handle images - prepend asset base URL for relative paths
    image({ href, title, text }: Tokens.Image): string {
      const isRelative = href && !href.startsWith("http://") && !href.startsWith("https://") && !href.startsWith("data:");
      const src = isRelative ? `${assetBaseUrl}/${href}` : href;
      const titleAttr = title ? ` title="${title}"` : "";
      return `<img src="${src}" alt="${text}"${titleAttr} loading="lazy" />`;
    },

    // Handle links - add target="_blank" for external URLs
    link({ href, title, tokens }: Tokens.Link): string {
      const text = this.parser?.parseInline(tokens) ?? "";
      const isExternal = href?.startsWith("http://") || href?.startsWith("https://");
      const titleAttr = title ? ` title="${title}"` : "";

      if (isExternal) {
        return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer" class="markdown-viewer__external-link">${text}</a>`;
      }

      return `<a href="${href}"${titleAttr}>${text}</a>`;
    },

    // Handle paragraphs - parse wiki-links in text content
    paragraph({ tokens }: Tokens.Paragraph): string {
      const text = this.parser?.parseInline(tokens) ?? "";
      return `<p>${parseWikiLinks(text)}</p>\n`;
    },

    // Handle list items - parse wiki-links
    listitem({ tokens }: Tokens.ListItem): string {
      const text = this.parser?.parse(tokens) ?? "";
      return `<li>${parseWikiLinks(text)}</li>\n`;
    },

    // Handle headings - parse wiki-links
    heading({ tokens, depth }: Tokens.Heading): string {
      const text = this.parser?.parseInline(tokens) ?? "";
      return `<h${depth}>${parseWikiLinks(text)}</h${depth}>\n`;
    },
  };
}

/**
 * Configure DOMPurify to allow our custom attributes and classes.
 */
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["data-wiki-target", "target", "rel"],
    ADD_TAGS: [],
    ALLOWED_TAGS: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "br", "hr",
      "ul", "ol", "li",
      "blockquote", "pre", "code",
      "a", "img",
      "strong", "em", "del", "s",
      "table", "thead", "tbody", "tr", "th", "td",
      "div", "span",
    ],
    ALLOWED_ATTR: [
      "href", "src", "alt", "title", "class",
      "target", "rel", "data-wiki-target", "loading",
    ],
  });
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
}): React.ReactNode {
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
function LoadingSkeleton(): React.ReactNode {
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
 * MarkdownViewer renders vault file content with:
 * - Markdown formatting via marked
 * - Wiki-link parsing and navigation
 * - Breadcrumb navigation
 * - Truncation warnings
 * - Loading states
 * - XSS protection via DOMPurify
 */
export function MarkdownViewer({
  onNavigate,
  assetBaseUrl = "/vault/assets",
}: MarkdownViewerProps): React.ReactNode {
  const { browser, setCurrentPath } = useSession();
  const { currentPath, currentFileContent, currentFileTruncated, fileError, isLoading } = browser;

  // Create marked instance with custom renderer and sanitize output
  const htmlContent = useMemo(() => {
    if (!currentFileContent) return "";

    const renderer = createRenderer(assetBaseUrl);
    marked.use({ renderer });

    try {
      const rawHtml = marked.parse(currentFileContent) as string;
      // Sanitize the HTML to prevent XSS attacks
      return sanitizeHtml(rawHtml);
    } catch {
      return sanitizeHtml(`<p class="markdown-viewer__error">Failed to parse markdown</p>`);
    }
  }, [currentFileContent, assetBaseUrl]);

  // Handle clicks on wiki-links
  const handleContentClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const wikiLink = target.closest<HTMLAnchorElement>(".markdown-viewer__wiki-link");

      if (wikiLink) {
        e.preventDefault();
        const targetPath = wikiLink.dataset.wikiTarget;
        if (targetPath) {
          // Resolve relative path from current directory
          const currentDir = currentPath.includes("/")
            ? currentPath.substring(0, currentPath.lastIndexOf("/"))
            : "";
          const resolvedPath = currentDir ? `${currentDir}/${targetPath}` : targetPath;
          onNavigate?.(resolvedPath);
        }
      }
    },
    [currentPath, onNavigate]
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

      <div
        className="markdown-viewer__content"
        onClick={handleContentClick}
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    </div>
  );
}
