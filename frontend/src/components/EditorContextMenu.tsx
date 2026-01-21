/**
 * EditorContextMenu Component
 *
 * Context menu for Quick Actions on text selections in the markdown editor.
 * Supports right-click (desktop) and long-press (mobile) triggers.
 * Renders via portal at the selection position.
 *
 * In Pair Writing Mode, also shows Advisory Actions (Validate, Critique)
 * and Compare to snapshot action.
 *
 * Implements: TD-1, TD-12 from the Pair Writing Mode plan.
 * Addresses: REQ-F-2, REQ-F-3, REQ-F-15, REQ-F-18, REQ-F-25, REQ-NF-3, REQ-NF-5 from spec.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import "./EditorContextMenu.css";

/**
 * Editor modes that affect context menu contents.
 */
export type EditorMode = "browse" | "pair-writing";

/**
 * Quick Action types available in the context menu.
 * These are transformative actions that directly modify the selected text.
 */
export type QuickActionType = "tighten" | "embellish" | "correct" | "polish";

/**
 * Advisory Action types available in Pair Writing Mode.
 * These actions send selection to conversation pane (not inline replacement).
 */
export type AdvisoryActionType = "validate" | "critique" | "compare";

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
  /**
   * Editor mode determines which actions are shown.
   * - "browse": Only Quick Actions (Tighten, Embellish, Correct, Polish)
   * - "pair-writing": Quick Actions + Advisory Actions (Validate, Critique) + Compare
   * Defaults to "browse" for backward compatibility.
   */
  mode?: EditorMode;
  /**
   * Whether a snapshot exists. When true and mode is "pair-writing",
   * the "Compare to snapshot" action is shown.
   */
  hasSnapshot?: boolean;
  /**
   * Callback when an Advisory Action is selected (Validate, Critique, Compare).
   * Advisory actions dispatch to conversation pane, not inline replacement.
   * Only relevant in "pair-writing" mode.
   */
  onAdvisoryAction?: (action: AdvisoryActionType) => void;
}

/**
 * Menu item configuration for Quick Actions.
 */
interface QuickMenuItem {
  action: QuickActionType;
  label: string;
  description: string;
}

/**
 * Menu item configuration for Advisory Actions.
 */
interface AdvisoryMenuItem {
  action: AdvisoryActionType;
  label: string;
  description: string;
}

/**
 * Quick Actions menu items configuration.
 * These are transformative actions (REQ-F-1).
 */
const QUICK_ACTIONS: QuickMenuItem[] = [
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
 * Advisory Actions menu items configuration.
 * These are non-transformative actions shown only in Pair Writing Mode (REQ-F-15).
 */
const ADVISORY_ACTIONS: AdvisoryMenuItem[] = [
  {
    action: "validate",
    label: "Validate",
    description: "Fact-check the claim",
  },
  {
    action: "critique",
    label: "Critique",
    description: "Analyze clarity, voice, structure",
  },
];

/**
 * Compare action shown when snapshot exists (REQ-F-25).
 */
const COMPARE_ACTION: AdvisoryMenuItem = {
  action: "compare",
  label: "Compare to snapshot",
  description: "Show what changed",
};

/**
 * EditorContextMenu displays Quick Actions for text selections.
 *
 * Features:
 * - Renders via React portal at specified position
 * - Keyboard navigation (Arrow keys, Enter, Escape)
 * - Click outside dismissal
 * - Accessible via role="menu" and role="menuitem"
 * - In Pair Writing Mode: shows Advisory Actions (Validate, Critique)
 * - Shows Compare action when snapshot exists
 *
 * Usage:
 * ```tsx
 * // Browse mode (default)
 * <EditorContextMenu
 *   isOpen={menuOpen}
 *   position={{ x: 100, y: 200 }}
 *   onAction={(action) => handleQuickAction(action)}
 *   onDismiss={() => setMenuOpen(false)}
 * />
 *
 * // Pair Writing Mode with snapshot
 * <EditorContextMenu
 *   isOpen={menuOpen}
 *   position={{ x: 100, y: 200 }}
 *   onAction={(action) => handleQuickAction(action)}
 *   onAdvisoryAction={(action) => handleAdvisoryAction(action)}
 *   onDismiss={() => setMenuOpen(false)}
 *   mode="pair-writing"
 *   hasSnapshot={true}
 * />
 * ```
 */
export function EditorContextMenu({
  isOpen,
  position,
  onAction,
  onDismiss,
  mode = "browse",
  hasSnapshot = false,
  onAdvisoryAction,
}: EditorContextMenuProps): React.ReactNode {
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);

  // Build the list of all menu items based on mode
  const allItems = buildMenuItems(mode, hasSnapshot);
  const itemCount = allItems.length;

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

  // Handle action based on item type
  const handleItemAction = useCallback(
    (item: MenuItem) => {
      if (item.type === "quick") {
        onAction(item.action as QuickActionType);
      } else if (onAdvisoryAction) {
        onAdvisoryAction(item.action as AdvisoryActionType);
      }
    },
    [onAction, onAdvisoryAction]
  );

  // Keyboard navigation within the menu
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setFocusedIndex((prev) => (prev + 1) % itemCount);
          break;
        case "ArrowUp":
          event.preventDefault();
          setFocusedIndex((prev) => (prev - 1 + itemCount) % itemCount);
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          handleItemAction(allItems[focusedIndex]);
          break;
        case "Home":
          event.preventDefault();
          setFocusedIndex(0);
          break;
        case "End":
          event.preventDefault();
          setFocusedIndex(itemCount - 1);
          break;
      }
    },
    [focusedIndex, itemCount, allItems, handleItemAction]
  );

  // Focus the correct item when focusedIndex changes
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;

    const items = menuRef.current.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]'
    );
    items[focusedIndex]?.focus();
  }, [focusedIndex, isOpen]);

  if (!isOpen || !position) {
    return null;
  }

  // Calculate menu position to keep it in viewport (consider more items in pair-writing mode)
  const estimatedHeight = itemCount * 56 + 16; // 56px per item + padding
  const menuStyle = calculateMenuPosition(position, estimatedHeight);

  // Determine aria-label based on mode
  const ariaLabel = mode === "pair-writing" ? "Writing Actions" : "Quick Actions";

  const menuContent = (
    <div
      ref={menuRef}
      className="editor-context-menu"
      style={menuStyle}
      role="menu"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      {allItems.map((item, index) => (
        <button
          key={item.action}
          type="button"
          className={`editor-context-menu__item ${
            index === focusedIndex ? "editor-context-menu__item--focused" : ""
          }${item.type === "advisory" ? " editor-context-menu__item--advisory" : ""}`}
          role="menuitem"
          tabIndex={index === focusedIndex ? 0 : -1}
          onClick={() => handleItemAction(item)}
          aria-describedby={`action-desc-${item.action}`}
        >
          <span className="editor-context-menu__icon">
            <MenuItemIcon action={item.action} />
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

// ----------------------------------------------------------------------------
// Helper Types and Functions
// ----------------------------------------------------------------------------

/**
 * Unified menu item type that can represent both quick and advisory actions.
 */
interface MenuItem {
  action: QuickActionType | AdvisoryActionType;
  label: string;
  description: string;
  type: "quick" | "advisory";
}

/**
 * Build the list of menu items based on mode and snapshot state.
 */
function buildMenuItems(mode: EditorMode, hasSnapshot: boolean): MenuItem[] {
  // Always include Quick Actions
  const items: MenuItem[] = QUICK_ACTIONS.map((item) => ({
    ...item,
    type: "quick" as const,
  }));

  // In Pair Writing Mode, add Advisory Actions (REQ-F-15)
  if (mode === "pair-writing") {
    items.push(
      ...ADVISORY_ACTIONS.map((item) => ({
        ...item,
        type: "advisory" as const,
      }))
    );

    // Add Compare action if snapshot exists (REQ-F-25)
    if (hasSnapshot) {
      items.push({
        ...COMPARE_ACTION,
        type: "advisory" as const,
      });
    }
  }

  return items;
}

/**
 * Calculate menu position to keep it within viewport bounds.
 */
function calculateMenuPosition(
  position: MenuPosition,
  estimatedHeight = 200
): React.CSSProperties {
  // Menu dimensions (approximate, CSS will handle actual sizing)
  const menuWidth = 200;
  const menuHeight = estimatedHeight;
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
 * Icon component for all menu item types (quick and advisory actions).
 */
function MenuItemIcon({ action }: { action: QuickActionType | AdvisoryActionType }): React.ReactNode {
  switch (action) {
    case "tighten":
      return <TightenIcon />;
    case "embellish":
      return <EmbellishIcon />;
    case "correct":
      return <CorrectIcon />;
    case "polish":
      return <PolishIcon />;
    case "validate":
      return <ValidateIcon />;
    case "critique":
      return <CritiqueIcon />;
    case "compare":
      return <CompareIcon />;
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
 * Validate icon (shield with checkmark).
 */
function ValidateIcon(): React.ReactNode {
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
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

/**
 * Critique icon (magnifying glass with lines).
 */
function CritiqueIcon(): React.ReactNode {
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
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="8" y1="9" x2="14" y2="9" />
      <line x1="8" y1="13" x2="12" y2="13" />
    </svg>
  );
}

/**
 * Compare icon (two documents with diff).
 */
function CompareIcon(): React.ReactNode {
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
      <rect x="3" y="3" width="7" height="13" rx="1" />
      <rect x="14" y="8" width="7" height="13" rx="1" />
      <line x1="10" y1="12" x2="14" y2="12" />
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
