/**
 * CsvViewer Component
 *
 * Renders CSV and TSV files as formatted HTML tables.
 * Handles edge cases like quoted fields, escaped delimiters, and empty cells.
 * Shows graceful fallback for malformed files.
 */

import { useMemo, useCallback, useState, useEffect, type ReactNode } from "react";
import { useSession } from "../../../contexts/SessionContext";
import "./CsvViewer.css";

/**
 * Props for CsvViewer component.
 */
export interface CsvViewerProps {
  /** Callback when a path is navigated (breadcrumb) */
  onNavigate?: (path: string) => void;
  /** Callback to open mobile file browser (only shown on mobile) */
  onMobileMenuClick?: () => void;
}

/**
 * Result of parsing CSV/TSV content.
 */
interface ParseResult {
  /** Column headers (first row) */
  headers: string[];
  /** Data rows (all rows after first) */
  rows: string[][];
  /** Warnings about data issues (e.g., inconsistent columns) */
  warnings: string[];
  /** Fatal error that prevented parsing */
  error: string | null;
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
    <nav className="csv-viewer__breadcrumb" aria-label="File path">
      <button
        type="button"
        className="csv-viewer__breadcrumb-item"
        onClick={() => onNavigate("")}
      >
        Root
      </button>
      {shouldCollapse && (
        <span>
          <span className="csv-viewer__breadcrumb-separator">/</span>
          <button
            type="button"
            className="csv-viewer__breadcrumb-ellipsis"
            onClick={() => setIsExpanded(true)}
            aria-label="Show full path"
          >
            …
          </button>
        </span>
      )}
      {visibleCrumbs.map((crumb) => (
        <span key={crumb.path}>
          <span className="csv-viewer__breadcrumb-separator">/</span>
          {crumb.isLast ? (
            <span className="csv-viewer__breadcrumb-current">{crumb.name}</span>
          ) : (
            <button
              type="button"
              className="csv-viewer__breadcrumb-item"
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
 * Loading skeleton for CSV content.
 */
function LoadingSkeleton(): ReactNode {
  return (
    <div className="csv-viewer__skeleton" aria-label="Loading content">
      <div className="csv-viewer__skeleton-line csv-viewer__skeleton-line--short" />
      <div className="csv-viewer__skeleton-line" />
      <div className="csv-viewer__skeleton-line csv-viewer__skeleton-line--medium" />
      <div className="csv-viewer__skeleton-line" />
      <div className="csv-viewer__skeleton-line csv-viewer__skeleton-line--short" />
    </div>
  );
}

/**
 * Detects the delimiter based on file path extension.
 * Returns comma for .csv, tab for .tsv.
 */
function getDelimiter(path: string): string {
  return path.toLowerCase().endsWith(".tsv") ? "\t" : ",";
}

/**
 * Parses CSV/TSV content into headers and rows.
 * Follows RFC 4180 with graceful error handling.
 *
 * Handles:
 * - Quoted fields with embedded delimiters
 * - Escaped quotes (doubled: "")
 * - Newlines within quoted fields
 * - Empty cells
 * - UTF-8 BOM
 * - Inconsistent column counts (pads shorter rows)
 */
function parseCsv(content: string, delimiter: string): ParseResult {
  const warnings: string[] = [];
  const allRows: string[][] = [];

  // Strip UTF-8 BOM if present
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;

  // Handle empty content
  if (!text.trim()) {
    return { headers: [], rows: [], warnings: [], error: null };
  }

  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote (doubled)
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        // End of quoted field
        inQuotes = false;
      } else {
        field += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        row.push(field);
        field = "";
      } else if (char === "\r" && text[i + 1] === "\n") {
        // CRLF line ending
        row.push(field);
        allRows.push(row);
        row = [];
        field = "";
        i++; // Skip the \n
      } else if (char === "\n") {
        // LF line ending
        row.push(field);
        allRows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }
    i++;
  }

  // Handle final field/row (file may not end with newline)
  if (field || row.length > 0) {
    row.push(field);
    allRows.push(row);
  }

  // Check for unclosed quote (parse error)
  if (inQuotes) {
    return {
      headers: [],
      rows: [],
      warnings: [],
      error: "Unclosed quote detected. The file may be malformed.",
    };
  }

  // Handle no data
  if (allRows.length === 0) {
    return { headers: [], rows: [], warnings: [], error: null };
  }

  // Extract headers (first row) and data rows
  const [headers, ...dataRows] = allRows;

  // Check for inconsistent column counts and normalize
  const headerCount = headers.length;
  let inconsistentCount = 0;

  const normalizedRows: string[][] = dataRows.map((r): string[] => {
    if (r.length !== headerCount) {
      inconsistentCount++;
      // Pad shorter rows with empty strings, truncate longer rows
      if (r.length < headerCount) {
        const padding: string[] = Array<string>(headerCount - r.length).fill("");
        return [...r, ...padding];
      }
      return r.slice(0, headerCount);
    }
    return r;
  });

  if (inconsistentCount > 0) {
    warnings.push(
      `${inconsistentCount} row${inconsistentCount > 1 ? "s" : ""} had inconsistent column counts and ${inconsistentCount > 1 ? "were" : "was"} normalized.`
    );
  }

  return {
    headers,
    rows: normalizedRows,
    warnings,
    error: null,
  };
}

/**
 * CsvViewer renders vault CSV/TSV files as HTML tables with:
 * - Formatted table display
 * - Breadcrumb navigation
 * - Warning banners for data issues
 * - Fallback to raw content for malformed files
 */
export function CsvViewer({ onNavigate, onMobileMenuClick }: CsvViewerProps): ReactNode {
  const { browser, setCurrentPath } = useSession();
  const {
    currentPath,
    currentFileContent,
    currentFileTruncated,
    fileError,
    isLoading,
  } = browser;

  // Parse CSV content
  const parseResult = useMemo<ParseResult | null>(() => {
    if (!currentFileContent) return null;
    const delimiter = getDelimiter(currentPath);
    return parseCsv(currentFileContent, delimiter);
  }, [currentFileContent, currentPath]);

  // Handle breadcrumb navigation
  const handleBreadcrumbNavigate = useCallback(
    (path: string) => {
      setCurrentPath(path);
      if (!path.endsWith(".csv") && !path.endsWith(".tsv")) {
        onNavigate?.("");
      }
    },
    [setCurrentPath, onNavigate]
  );

  // Loading state
  if (isLoading) {
    return (
      <div className="csv-viewer csv-viewer--loading">
        <Breadcrumb path={currentPath} onNavigate={handleBreadcrumbNavigate} />
        <LoadingSkeleton />
      </div>
    );
  }

  // Error state (from backend)
  if (fileError) {
    return (
      <div className="csv-viewer csv-viewer--error">
        <Breadcrumb path={currentPath} onNavigate={handleBreadcrumbNavigate} />
        <div className="csv-viewer__error-content">
          <p className="csv-viewer__error-message">{fileError}</p>
        </div>
      </div>
    );
  }

  // Empty state - no file selected (null means no file, empty string is an empty file)
  if (currentFileContent === null) {
    return (
      <div className="csv-viewer csv-viewer--empty">
        <div className="csv-viewer__empty-content">
          <p>Select a file to view its content</p>
        </div>
      </div>
    );
  }

  // Parse error - show raw content with warning
  if (parseResult?.error) {
    return (
      <div className="csv-viewer csv-viewer--parse-error">
        <Breadcrumb path={currentPath} onNavigate={handleBreadcrumbNavigate} />
        <div className="csv-viewer__warning" role="alert">
          {parseResult.error}
        </div>
        <div className="csv-viewer__raw-content">
          <pre>{currentFileContent}</pre>
        </div>
      </div>
    );
  }

  // Empty CSV (no headers)
  if (!parseResult || parseResult.headers.length === 0) {
    return (
      <div className="csv-viewer">
        <Breadcrumb path={currentPath} onNavigate={handleBreadcrumbNavigate} />
        <div className="csv-viewer__empty-content">
          <p>This file appears to be empty.</p>
        </div>
      </div>
    );
  }

  // Normal view mode - render table
  return (
    <div className="csv-viewer">
      <div className="csv-viewer__toolbar">
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
      </div>

      {currentFileTruncated && (
        <div className="csv-viewer__warning" role="alert">
          This file was truncated due to size limits. Some rows may be missing.
        </div>
      )}

      {parseResult.warnings.map((warning, i) => (
        <div key={i} className="csv-viewer__warning" role="alert">
          {warning}
        </div>
      ))}

      <div className="csv-viewer__table-container">
        <table className="csv-viewer__table">
          <thead>
            <tr>
              {parseResult.headers.map((header, i) => (
                <th key={i}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {parseResult.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
