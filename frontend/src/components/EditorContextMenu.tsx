/**
 * EditorContextMenu Component
 *
 * Context menu for Quick Actions on text selections in the markdown editor.
 * Supports right-click (desktop) and long-press (mobile) triggers.
 * Renders via portal at the selection position.
 *
 * Implements: TD-1, TD-12 from the Pair Writing Mode plan.
 * Addresses: REQ-F-2, REQ-F-3, REQ-NF-3, REQ-NF-5 from spec.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import "./EditorContextMenu.css";

/**
 * Quick Action types available in the context menu.
 * These are transformative actions that directly modify the selected text.
 */
export type QuickActionType = "tighten" | "embellish" | "correct" | "polish";

/**
 * Position for rendering the context menu.
 */
export interface MenuPosition {
  x: number;
  y: number;
}

/**
 * Props for EditorContextMenu component.
 */
export interface EditorContextMenuProps {
  /** Whether the menu is currently open */
  isOpen: boolean;
  /** Position to render the menu at (viewport coordinates) */
  position: MenuPosition | null;
  /** Callback when a Quick Action is selected */
  onAction: (action: QuickActionType) => void;
  /** Callback when the menu should be dismissed */
  onDismiss: () => void;
}

/**
 * Menu item configuration for Quick Actions.
 */
interface MenuItem {
  action: QuickActionType;
  label: string;
  description: string;
}

/**
 * Quick Actions menu items configuration.
 */
const QUICK_ACTIONS: MenuItem[] = [
  {
    action: "tighten",
    label: "Tighten",
    description: "Make more concise",
  },
  {
    action: "embellish",
    label: "Embellish",
    description: "Add detail and nuance",
  },
  {
    action: "correct",
    label: "Correct",
    description: "Fix typos and grammar",
  },
  {
    action: "polish",
    label: "Polish",
    description: "Correct and improve prose",
  },
];

/**
 * EditorContextMenu displays Quick Actions for text selections.
 *
 * Features:
 * - Renders via React portal at specified position
 * - Keyboard navigation (Arrow keys, Enter, Escape)
 * - Click outside dismissal
 * - Accessible via role="menu" and role="menuitem"
 *
 * Usage:
 * ```tsx
 * <EditorContextMenu
 *   isOpen={menuOpen}
 *   position={{ x: 100, y: 200 }}
 *   onAction={(action) => handleQuickAction(action)}
 *   onDismiss={() => setMenuOpen(false)}
 * />
 * ```
 */
export function EditorContextMenu({
  isOpen,
  position,
  onAction,
  onDismiss,
}: EditorContextMenuProps): React.ReactNode {
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);

  // Reset focus index when menu opens
  useEffect(() => {
    if (isOpen) {
      setFocusedIndex(0);
    }
  }, [isOpen]);

  // Focus the menu when it opens
  useEffect(() => {
    if (isOpen && menuRef.current) {
      // Focus the first menu item
      const firstItem = menuRef.current.querySelector<HTMLButtonElement>(
        '[role="menuitem"]'
      );
      firstItem?.focus();
    }
  }, [isOpen]);

  // Click outside handler
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onDismiss();
      }
    }

    // Use mousedown to catch click before it propagates
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onDismiss]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onDismiss]);

  // Keyboard navigation within the menu
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setFocusedIndex((prev) => (prev + 1) % QUICK_ACTIONS.length);
          break;
        case "ArrowUp":
          event.preventDefault();
          setFocusedIndex(
            (prev) => (prev - 1 + QUICK_ACTIONS.length) % QUICK_ACTIONS.length
          );
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          onAction(QUICK_ACTIONS[focusedIndex].action);
          break;
        case "Home":
          event.preventDefault();
          setFocusedIndex(0);
          break;
        case "End":
          event.preventDefault();
          setFocusedIndex(QUICK_ACTIONS.length - 1);
          break;
      }
    },
    [focusedIndex, onAction]
  );

  // Focus the correct item when focusedIndex changes
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;

    const items = menuRef.current.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]'
    );
    items[focusedIndex]?.focus();
  }, [focusedIndex, isOpen]);

  // Handle item click
  const handleItemClick = useCallback(
    (action: QuickActionType) => {
      onAction(action);
    },
    [onAction]
  );

  if (!isOpen || !position) {
    return null;
  }

  // Calculate menu position to keep it in viewport
  const menuStyle = calculateMenuPosition(position);

  const menuContent = (
    <div
      ref={menuRef}
      className="editor-context-menu"
      style={menuStyle}
      role="menu"
      aria-label="Quick Actions"
      onKeyDown={handleKeyDown}
    >
      {QUICK_ACTIONS.map((item, index) => (
        <button
          key={item.action}
          type="button"
          className={`editor-context-menu__item ${
            index === focusedIndex ? "editor-context-menu__item--focused" : ""
          }`}
          role="menuitem"
          tabIndex={index === focusedIndex ? 0 : -1}
          onClick={() => handleItemClick(item.action)}
          aria-describedby={`action-desc-${item.action}`}
        >
          <span className="editor-context-menu__icon">
            <ActionIcon action={item.action} />
          </span>
          <span className="editor-context-menu__content">
            <span className="editor-context-menu__label">{item.label}</span>
            <span
              id={`action-desc-${item.action}`}
              className="editor-context-menu__description"
            >
              {item.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  );

  // Render via portal to document.body
  return createPortal(menuContent, document.body);
}

/**
 * Calculate menu position to keep it within viewport bounds.
 */
function calculateMenuPosition(
  position: MenuPosition
): React.CSSProperties {
  // Menu dimensions (approximate, CSS will handle actual sizing)
  const menuWidth = 200;
  const menuHeight = 200;
  const padding = 8;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let x = position.x;
  let y = position.y;

  // Keep menu within horizontal bounds
  if (x + menuWidth > viewportWidth - padding) {
    x = viewportWidth - menuWidth - padding;
  }
  if (x < padding) {
    x = padding;
  }

  // Keep menu within vertical bounds
  if (y + menuHeight > viewportHeight - padding) {
    // Position above if not enough space below
    y = position.y - menuHeight;
    if (y < padding) {
      y = padding;
    }
  }

  return {
    left: x,
    top: y,
  };
}

/**
 * Icon component for each Quick Action type.
 */
function ActionIcon({ action }: { action: QuickActionType }): React.ReactNode {
  switch (action) {
    case "tighten":
      return <TightenIcon />;
    case "embellish":
      return <EmbellishIcon />;
    case "correct":
      return <CorrectIcon />;
    case "polish":
      return <PolishIcon />;
  }
}

/**
 * Tighten icon (compress/minimize).
 */
function TightenIcon(): React.ReactNode {
  return (
    <svg
      className="editor-context-menu__icon-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Arrows pointing inward */}
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

/**
 * Embellish icon (expand/add).
 */
function EmbellishIcon(): React.ReactNode {
  return (
    <svg
      className="editor-context-menu__icon-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Arrows pointing outward */}
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

/**
 * Correct icon (checkmark).
 */
function CorrectIcon(): React.ReactNode {
  return (
    <svg
      className="editor-context-menu__icon-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/**
 * Polish icon (sparkles).
 */
function PolishIcon(): React.ReactNode {
  return (
    <svg
      className="editor-context-menu__icon-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
      <path d="M19 14l.9 2.7 2.7.9-2.7.9-.9 2.7-.9-2.7-2.7-.9 2.7-.9.9-2.7z" />
      <path d="M5 17l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6.6-1.8z" />
    </svg>
  );
}

/**
 * Exported for use by parent components that need to extract position
 * from contextmenu or long-press events.
 */
export function getMenuPositionFromEvent(
  event: React.MouseEvent | React.TouchEvent
): MenuPosition {
  if ("touches" in event) {
    const touch = event.touches[0] || event.changedTouches[0];
    return {
      x: touch?.clientX ?? 0,
      y: touch?.clientY ?? 0,
    };
  }
  return {
    x: event.clientX,
    y: event.clientY,
  };
}
