/**
 * SearchResults Component
 *
 * Displays search results for the browse tab.
 * Replaces FileTree when search is active.
 */

import { useCallback, useRef, useState, useEffect } from "react";
import type {
  FileSearchResult,
  ContentSearchResult,
  ContextSnippet,
} from "@memory-loop/shared";
import type { SearchMode } from "../contexts/SessionContext";
import "./SearchResults.css";

export interface SearchResultsProps {
  /** Current search mode */
  mode: SearchMode;
  /** File search results (when mode is "files") */
  fileResults: FileSearchResult[];
  /** Content search results (when mode is "content") */
  contentResults: ContentSearchResult[];
  /** Whether search is loading */
  isLoading: boolean;
  /** Current search query (for empty state message) */
  query: string;
  /** Expanded content result paths */
  expandedPaths: Set<string>;
  /** Snippets cache for expanded results */
  snippetsCache: Map<string, ContextSnippet[]>;
  /** Callback when file is selected */
  onFileSelect: (path: string) => void;
  /** Callback to toggle result expansion */
  onToggleExpand: (path: string) => void;
  /** Callback to request snippets for a path */
  onRequestSnippets: (path: string) => void;
}

export function SearchResults({
  mode,
  fileResults,
  contentResults,
  isLoading,
  query,
  expandedPaths,
  snippetsCache,
  onFileSelect,
  onToggleExpand,
  onRequestSnippets,
}: SearchResultsProps): React.ReactNode {
  const listRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // Get results based on mode
  const results = mode === "files" ? fileResults : contentResults;

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(-1);
  }, [results]);

  // Handle content result expansion
  const handleToggleExpand = useCallback(
    (path: string) => {
      onToggleExpand(path);
      // Request snippets if not cached
      if (!snippetsCache.has(path)) {
        onRequestSnippets(path);
      }
    },
    [onToggleExpand, snippetsCache, onRequestSnippets]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (results.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && selectedIndex >= 0) {
        e.preventDefault();
        onFileSelect(results[selectedIndex].path);
      }
    },
    [results, selectedIndex, onFileSelect]
  );

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll(
        ".search-results__item, .search-results__content-item"
      );
      const selectedItem = items[selectedIndex];
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  // Loading state
  if (isLoading && results.length === 0) {
    return (
      <div
        className="search-results search-results--loading"
        data-testid="search-loading"
      >
        <div className="search-results__spinner" />
        <span>Searching...</span>
      </div>
    );
  }

  // Empty state
  if (!isLoading && results.length === 0 && query) {
    return (
      <div
        className="search-results search-results--empty"
        data-testid="search-empty"
      >
        No results for "{query}"
      </div>
    );
  }

  // No query state
  if (!query) {
    return (
      <div
        className="search-results search-results--empty"
        data-testid="search-prompt"
      >
        Type to search...
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="search-results"
      role="listbox"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      data-testid="search-results"
    >
      {mode === "files"
        ? fileResults.map((result, index) => (
            <FileResultItem
              key={result.path}
              result={result}
              isSelected={selectedIndex === index}
              onSelect={onFileSelect}
            />
          ))
        : contentResults.map((result, index) => (
            <ContentResultItem
              key={result.path}
              result={result}
              isSelected={selectedIndex === index}
              isExpanded={expandedPaths.has(result.path)}
              snippets={snippetsCache.get(result.path)}
              onSelect={onFileSelect}
              onToggleExpand={handleToggleExpand}
              query={query}
            />
          ))}
    </div>
  );
}

/**
 * File result item with highlighted matches.
 */
function FileResultItem({
  result,
  isSelected,
  onSelect,
}: {
  result: FileSearchResult;
  isSelected: boolean;
  onSelect: (path: string) => void;
}): React.ReactNode {
  const handleClick = useCallback(() => {
    onSelect(result.path);
  }, [result.path, onSelect]);

  // Extract directory path from full path
  const dirPath = result.path.includes("/")
    ? result.path.substring(0, result.path.lastIndexOf("/"))
    : "";

  return (
    <button
      type="button"
      className={`search-results__item ${isSelected ? "search-results__item--selected" : ""}`}
      onClick={handleClick}
      role="option"
      aria-selected={isSelected}
      data-testid="file-result"
    >
      <span className="search-results__icon">
        <FileIcon />
      </span>
      <span className="search-results__name">
        <HighlightedText text={result.name} positions={result.matchPositions} />
      </span>
      {dirPath && <span className="search-results__path">{dirPath}</span>}
    </button>
  );
}

/**
 * Content result item with expandable snippets.
 */
function ContentResultItem({
  result,
  isSelected,
  isExpanded,
  snippets,
  onSelect,
  onToggleExpand,
  query,
}: {
  result: ContentSearchResult;
  isSelected: boolean;
  isExpanded: boolean;
  snippets?: ContextSnippet[];
  onSelect: (path: string) => void;
  onToggleExpand: (path: string) => void;
  query: string;
}): React.ReactNode {
  const handleClick = useCallback(() => {
    onSelect(result.path);
  }, [result.path, onSelect]);

  const handleExpand = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleExpand(result.path);
    },
    [result.path, onToggleExpand]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        onToggleExpand(result.path);
      }
    },
    [result.path, onToggleExpand]
  );

  // Extract directory path from full path
  const dirPath = result.path.includes("/")
    ? result.path.substring(0, result.path.lastIndexOf("/"))
    : "";

  return (
    <div className="search-results__content-item" data-testid="content-result">
      <div
        className={`search-results__item ${isSelected ? "search-results__item--selected" : ""}`}
        role="option"
        aria-selected={isSelected}
      >
        <button
          type="button"
          className="search-results__expand-btn"
          onClick={handleExpand}
          onKeyDown={handleKeyDown}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? "Collapse snippets" : "Expand snippets"}
          data-testid="expand-button"
        >
          <ChevronIcon expanded={isExpanded} />
        </button>
        <button
          type="button"
          className="search-results__content-btn"
          onClick={handleClick}
        >
          <span className="search-results__icon">
            <FileIcon />
          </span>
          <span className="search-results__name">{result.name}</span>
          {dirPath && <span className="search-results__path">{dirPath}</span>}
          <span className="search-results__count" data-testid="match-count">
            {result.matchCount} {result.matchCount === 1 ? "match" : "matches"}
          </span>
        </button>
      </div>
      {isExpanded && snippets && (
        <div className="search-results__snippets" data-testid="snippets">
          {snippets.map((snippet, i) => (
            <SnippetItem key={i} snippet={snippet} query={query} />
          ))}
        </div>
      )}
      {isExpanded && !snippets && (
        <div
          className="search-results__snippets search-results__snippets--loading"
          data-testid="snippets-loading"
        >
          <div className="search-results__spinner search-results__spinner--small" />
          <span>Loading snippets...</span>
        </div>
      )}
    </div>
  );
}

/**
 * Snippet display with context.
 */
function SnippetItem({
  snippet,
  query,
}: {
  snippet: ContextSnippet;
  query: string;
}): React.ReactNode {
  return (
    <div className="search-results__snippet" data-testid="snippet">
      <span className="search-results__line-number">{snippet.lineNumber}</span>
      <pre className="search-results__snippet-text">
        {snippet.contextBefore.map((line, i) => (
          <div key={`before-${i}`} className="search-results__context-line">
            {line || "\u00A0"}
          </div>
        ))}
        <div className="search-results__match-line">
          <HighlightedLine text={snippet.line} query={query} />
        </div>
        {snippet.contextAfter.map((line, i) => (
          <div key={`after-${i}`} className="search-results__context-line">
            {line || "\u00A0"}
          </div>
        ))}
      </pre>
    </div>
  );
}

/**
 * Highlight matching characters in text using positions array.
 */
function HighlightedText({
  text,
  positions,
}: {
  text: string;
  positions: number[];
}): React.ReactNode {
  if (positions.length === 0) {
    return <>{text}</>;
  }

  const positionSet = new Set(positions);
  const chars = text.split("");

  // Group consecutive positions into spans to reduce DOM nodes
  const segments: { text: string; highlighted: boolean }[] = [];
  let currentText = "";
  let currentHighlighted = positionSet.has(0);

  chars.forEach((char, i) => {
    const isHighlighted = positionSet.has(i);
    if (isHighlighted === currentHighlighted) {
      currentText += char;
    } else {
      if (currentText) {
        segments.push({ text: currentText, highlighted: currentHighlighted });
      }
      currentText = char;
      currentHighlighted = isHighlighted;
    }
  });
  if (currentText) {
    segments.push({ text: currentText, highlighted: currentHighlighted });
  }

  return (
    <>
      {segments.map((segment, i) =>
        segment.highlighted ? (
          <mark key={i} className="search-results__highlight">
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        )
      )}
    </>
  );
}

/**
 * Highlight query matches in a line.
 */
function HighlightedLine({
  text,
  query,
}: {
  text: string;
  query: string;
}): React.ReactNode {
  if (!query) {
    return <>{text}</>;
  }

  const regex = new RegExp(`(${escapeRegex(query)})`, "gi");
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="search-results__highlight">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

/**
 * Escape special regex characters.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * File icon for results.
 */
function FileIcon(): React.ReactNode {
  return (
    <svg
      className="search-results__icon-svg"
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
 * Chevron icon for expand/collapse.
 */
function ChevronIcon({ expanded }: { expanded: boolean }): React.ReactNode {
  return (
    <svg
      className={`search-results__chevron-svg ${expanded ? "search-results__chevron-svg--expanded" : ""}`}
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
