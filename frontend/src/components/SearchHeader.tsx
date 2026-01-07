/**
 * SearchHeader Component
 *
 * Search input header for the browse tab.
 * Replaces the file tree header when search is active.
 *
 * Features:
 * - Debounced input (250ms) per TD-4
 * - Files/Content mode toggle
 * - Clear button to dismiss search
 * - Touch-friendly (44px min height per REQ-NF-6)
 * - Keyboard accessible (Escape to clear)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { SearchMode } from "../contexts/SessionContext";
import "./SearchHeader.css";

/** Debounce delay for search input in milliseconds */
const DEBOUNCE_DELAY = 250;

export interface SearchHeaderProps {
  /** Current search mode */
  mode: SearchMode;
  /** Current search query */
  query: string;
  /** Whether search is loading */
  isLoading: boolean;
  /** Callback when query changes (debounced) */
  onQueryChange: (query: string) => void;
  /** Callback when mode changes */
  onModeChange: (mode: SearchMode) => void;
  /** Callback to clear/close search */
  onClear: () => void;
}

/**
 * SearchHeader provides a search input with mode toggle for the browse tab.
 *
 * The input is debounced to prevent excessive search requests while typing.
 * Supports both file name search and content search modes.
 */
export function SearchHeader({
  mode,
  query,
  isLoading,
  onQueryChange,
  onModeChange,
  onClear,
}: SearchHeaderProps): React.ReactNode {
  // Local state for immediate input feedback
  const [localQuery, setLocalQuery] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync local query when prop changes (e.g., on clear)
  useEffect(() => {
    setLocalQuery(query);
  }, [query]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced query callback
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localQuery !== query) {
        onQueryChange(localQuery);
      }
    }, DEBOUNCE_DELAY);

    return () => clearTimeout(timer);
  }, [localQuery, query, onQueryChange]);

  // Handle input change
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setLocalQuery(e.target.value);
    },
    []
  );

  // Handle key down (Escape to clear)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClear();
      }
    },
    [onClear]
  );

  // Toggle mode
  const handleModeToggle = useCallback(() => {
    onModeChange(mode === "files" ? "content" : "files");
  }, [mode, onModeChange]);

  return (
    <div className="search-header">
      <div className="search-header__input-wrapper">
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          className="search-header__input"
          placeholder={
            mode === "files" ? "Search file names..." : "Search content..."
          }
          value={localQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          aria-label="Search query"
        />
        {isLoading && (
          <span className="search-header__spinner" aria-label="Searching" />
        )}
      </div>
      <button
        type="button"
        className="search-header__mode-btn"
        onClick={handleModeToggle}
        aria-label={`Switch to ${mode === "files" ? "content" : "files"} search`}
        aria-pressed={mode === "content"}
      >
        {mode === "files" ? "Names" : "Content"}
      </button>
      <button
        type="button"
        className="search-header__clear-btn"
        onClick={onClear}
        aria-label="Clear search"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

/**
 * Search icon for the input field.
 */
function SearchIcon(): React.ReactNode {
  return (
    <svg
      className="search-header__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

/**
 * Close icon for the clear button.
 */
function CloseIcon(): React.ReactNode {
  return (
    <svg
      className="search-header__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
