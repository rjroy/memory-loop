/**
 * SearchHeader Component
 *
 * Search input header for the browse tab.
 * Replaces the file tree header when search is active.
 *
 * Features:
 * - Debounced input (250ms) per TD-4
 * - Files/Content mode toggle via dropdown menu
 * - Clear button to dismiss search via dropdown menu
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
  onQueryChange: (query: string) => void | Promise<void>;
  /** Callback when mode changes */
  onModeChange: (mode: SearchMode) => void | Promise<void>;
  /** Callback to clear/close search */
  onClear: () => void;
}

/**
 * SearchHeader provides a search input with mode toggle for the browse tab.
 *
 * The input is debounced to prevent excessive search requests while typing.
 * Supports both file name search and content search modes.
 * Uses a dropdown menu triggered by the search icon for mode toggle and close.
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
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Sync local query when prop changes (e.g., on clear)
  useEffect(() => {
    setLocalQuery(query);
  }, [query]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    if (!isMenuOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isMenuOpen]);

  // Debounced query callback
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localQuery !== query) {
        void onQueryChange(localQuery);
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
        if (isMenuOpen) {
          setIsMenuOpen(false);
        } else {
          onClear();
        }
      }
    },
    [onClear, isMenuOpen]
  );

  // Toggle dropdown menu
  const handleMenuToggle = useCallback(() => {
    setIsMenuOpen((prev) => !prev);
  }, []);

  // Toggle mode
  const handleModeToggle = useCallback(() => {
    void onModeChange(mode === "files" ? "content" : "files");
    setIsMenuOpen(false);
  }, [mode, onModeChange]);

  // Close search
  const handleClose = useCallback(() => {
    setIsMenuOpen(false);
    onClear();
  }, [onClear]);

  return (
    <div className="search-header">
      <div className="search-header__menu-container" ref={menuRef}>
        <button
          type="button"
          className="search-header__menu-trigger"
          onClick={handleMenuToggle}
          aria-label="Search options"
          aria-expanded={isMenuOpen}
          aria-haspopup="true"
        >
          <SearchIcon />
          <ChevronIcon isOpen={isMenuOpen} />
        </button>
        {isMenuOpen && (
          <div className="search-header__menu" role="menu">
            <button
              type="button"
              className="search-header__menu-item"
              onClick={handleModeToggle}
              role="menuitem"
            >
              <ModeIcon />
              <span>
                Switch to {mode === "files" ? "Content" : "File Name"} Search
              </span>
            </button>
            <button
              type="button"
              className="search-header__menu-item search-header__menu-item--close"
              onClick={handleClose}
              role="menuitem"
            >
              <CloseIcon />
              <span>Close Search</span>
            </button>
          </div>
        )}
      </div>
      <div className="search-header__input-wrapper">
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
    </div>
  );
}

/**
 * Search icon for the menu trigger.
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
 * Chevron icon indicating dropdown state.
 */
function ChevronIcon({ isOpen }: { isOpen: boolean }): React.ReactNode {
  return (
    <svg
      className={`search-header__chevron ${isOpen ? "search-header__chevron--open" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/**
 * Mode icon for the toggle option.
 */
function ModeIcon(): React.ReactNode {
  return (
    <svg
      className="search-header__menu-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22 6 12 13 2 6" />
    </svg>
  );
}

/**
 * Close icon for the close option.
 */
function CloseIcon(): React.ReactNode {
  return (
    <svg
      className="search-header__menu-icon"
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
