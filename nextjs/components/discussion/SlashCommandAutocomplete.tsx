/**
 * SlashCommandAutocomplete Component
 *
 * Renders an autocomplete popup for slash commands when the user types "/".
 * Features:
 * - Case-insensitive prefix filtering by command name
 * - Keyboard navigation (arrow keys, Enter/Tab to select, Escape to close)
 * - Touch/click selection
 * - Click outside to close
 * - ARIA attributes for accessibility (listbox pattern)
 * - Maximum 5 visible items with scroll overflow
 */

import React, { useEffect, useRef, useMemo, useId, useCallback } from "react";
import type { SlashCommand } from "@/lib/schemas";
import "./SlashCommandAutocomplete.css";

export interface SlashCommandAutocompleteProps {
  /** Available slash commands to display */
  commands: SlashCommand[];
  /** Current input value (used for filtering) */
  inputValue: string;
  /** Whether the autocomplete should be visible */
  isVisible: boolean;
  /** Callback when a command is selected */
  onSelect: (command: SlashCommand) => void;
  /** Callback to close the autocomplete */
  onClose: () => void;
  /** Currently selected index in the filtered list */
  selectedIndex: number;
  /** Callback to update selected index */
  onSelectedIndexChange: (index: number) => void;
}

/**
 * Extracts the command prefix from input (everything after "/" until first space).
 * Returns empty string if input doesn't start with "/".
 */
function getCommandPrefix(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return "";
  }
  // Get text after "/" up to first space (or end of string)
  const afterSlash = trimmed.slice(1);
  const spaceIndex = afterSlash.indexOf(" ");
  return spaceIndex === -1 ? afterSlash : afterSlash.slice(0, spaceIndex);
}

/**
 * Filters and sorts commands based on input prefix.
 * - Case-insensitive prefix match on command name (without "/" prefix)
 * - Sorted alphabetically by name
 */
function filterCommands(commands: SlashCommand[], input: string): SlashCommand[] {
  const prefix = getCommandPrefix(input).toLowerCase();

  const filtered = commands.filter((cmd) => {
    // Command name includes "/" prefix, so we compare without it
    const cmdName = cmd.name.startsWith("/") ? cmd.name.slice(1) : cmd.name;
    return cmdName.toLowerCase().startsWith(prefix);
  });

  // Sort alphabetically by name
  return filtered.sort((a, b) => a.name.localeCompare(b.name));
}

export function SlashCommandAutocomplete({
  commands,
  inputValue,
  isVisible,
  onSelect,
  onClose,
  selectedIndex,
  onSelectedIndexChange,
}: SlashCommandAutocompleteProps): React.ReactNode {
  const listboxId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Memoized filtered commands for performance (TD-5)
  const filteredCommands = useMemo(
    () => filterCommands(commands, inputValue),
    [commands, inputValue]
  );

  // Reset selection to 0 when filter changes (TD-6)
  const prevFilteredLengthRef = useRef(filteredCommands.length);
  useEffect(() => {
    // Only reset if the filtered list changed (not just re-render)
    if (filteredCommands.length !== prevFilteredLengthRef.current) {
      onSelectedIndexChange(0);
      prevFilteredLengthRef.current = filteredCommands.length;
    }
  }, [filteredCommands.length, onSelectedIndexChange]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current || filteredCommands.length === 0) return;

    const selectedOption = listRef.current.querySelector<HTMLElement>(
      `[data-index="${selectedIndex}"]`
    );

    selectedOption?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex, filteredCommands.length]);

  // Handle click outside to close (TD-12)
  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isVisible && filteredCommands.length > 0) {
      // Use mousedown to fire before input blur
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [isVisible, filteredCommands.length, handleClickOutside]);

  // Handle keyboard navigation (called by parent via onKeyDown)
  // This is exposed for the parent to call, not used internally
  // The parent (Discussion) handles onKeyDown and calls these methods

  // Handle item click/touch selection
  function handleItemClick(command: SlashCommand) {
    onSelect(command);
  }

  // Handle item mouse enter for selection
  function handleItemMouseEnter(index: number) {
    onSelectedIndexChange(index);
  }

  // Don't render if not visible or no matches (TD-12: close on no matches)
  if (!isVisible || filteredCommands.length === 0) {
    return null;
  }

  const activeDescendantId =
    filteredCommands.length > 0
      ? `${listboxId}-option-${selectedIndex}`
      : undefined;

  return (
    <div
      ref={containerRef}
      className="slash-autocomplete"
      role="listbox"
      id={listboxId}
      aria-label="Slash commands"
      aria-activedescendant={activeDescendantId}
    >
      <ul ref={listRef} className="slash-autocomplete__list">
        {filteredCommands.map((command, index) => {
          const isSelected = index === selectedIndex;
          const optionId = `${listboxId}-option-${index}`;

          return (
            <li
              key={command.name}
              id={optionId}
              className={`slash-autocomplete__item${isSelected ? " slash-autocomplete__item--selected" : ""}`}
              role="option"
              aria-selected={isSelected}
              data-index={index}
              onClick={() => handleItemClick(command)}
              onMouseEnter={() => handleItemMouseEnter(index)}
            >
              <span className="slash-autocomplete__name">{command.name}</span>
              <span className="slash-autocomplete__description">
                {command.description}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="visually-hidden" aria-live="polite">
        {filteredCommands.length} command{filteredCommands.length !== 1 ? "s" : ""} available
      </div>
    </div>
  );
}

/**
 * Hook to manage autocomplete keyboard navigation.
 * Returns handlers to be attached to the input element.
 */
export function useSlashCommandNavigation(
  filteredCommandsLength: number,
  selectedIndex: number,
  onSelectedIndexChange: (index: number) => void,
  onSelect: (index: number) => void,
  onClose: () => void,
  isVisible: boolean
): {
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
} {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!isVisible || filteredCommandsLength === 0) {
        return false;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          onSelectedIndexChange(
            selectedIndex < filteredCommandsLength - 1
              ? selectedIndex + 1
              : 0
          );
          return true;

        case "ArrowUp":
          e.preventDefault();
          onSelectedIndexChange(
            selectedIndex > 0
              ? selectedIndex - 1
              : filteredCommandsLength - 1
          );
          return true;

        case "Enter":
        case "Tab":
          e.preventDefault();
          onSelect(selectedIndex);
          return true;

        case "Escape":
          e.preventDefault();
          onClose();
          return true;

        default:
          return false;
      }
    },
    [isVisible, filteredCommandsLength, selectedIndex, onSelectedIndexChange, onSelect, onClose]
  );

  return { handleKeyDown };
}
