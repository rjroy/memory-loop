/**
 * ListWidget Component
 *
 * Displays widget data as an ordered list with optional limit.
 * Used for similar items, recent files, top-N rankings, etc.
 */

import React, { useMemo } from "react";
import type { WidgetResult } from "@memory-loop/shared";
import "./ListWidget.css";

/**
 * Props for ListWidget component.
 */
export interface ListWidgetProps {
  /** Widget result with list display type */
  widget: WidgetResult;
  /** Optional click handler for list items */
  onItemClick?: (item: ListItem, index: number) => void;
}

/**
 * List item data structure.
 */
interface ListItem {
  /** Primary display text */
  title: string;
  /** Optional secondary text */
  subtitle?: string;
  /** Optional path for linking */
  path?: string;
  /** Optional score or value */
  score?: number;
  /** Optional metadata object */
  metadata?: Record<string, unknown>;
}

/**
 * Renders widget data as an ordered list with optional limit.
 *
 * Expected data format:
 * - Array of strings
 * - Array of { title, subtitle?, path?, score? } objects
 */
export function ListWidget({
  widget,
  onItemClick,
}: ListWidgetProps): React.ReactNode {
  // Normalize and limit data
  const items = useMemo(() => {
    const normalized = normalizeData(widget.data);
    const limit = widget.display.limit ?? normalized.length;
    return normalized.slice(0, limit);
  }, [widget.data, widget.display.limit]);

  const hasMore = useMemo(() => {
    const normalized = normalizeData(widget.data);
    const limit = widget.display.limit ?? normalized.length;
    return normalized.length > limit;
  }, [widget.data, widget.display.limit]);

  if (items.length === 0) {
    return <p className="list-widget__empty">No items</p>;
  }

  return (
    <ol className="list-widget" role="list">
      {items.map((item, index) => (
        <li key={index} className="list-widget__item">
          {onItemClick ? (
            <button
              type="button"
              className="list-widget__button"
              onClick={() => onItemClick(item, index)}
              aria-label={item.subtitle ? `${item.title}: ${item.subtitle}` : item.title}
            >
              <ItemContent item={item} showRank={true} rank={index + 1} />
            </button>
          ) : (
            <div className="list-widget__content">
              <ItemContent item={item} showRank={true} rank={index + 1} />
            </div>
          )}
        </li>
      ))}
      {hasMore && (
        <li className="list-widget__item list-widget__item--more">
          <span className="list-widget__more">
            ...
          </span>
        </li>
      )}
    </ol>
  );
}

/**
 * Content display for a single list item.
 */
interface ItemContentProps {
  item: ListItem;
  showRank: boolean;
  rank: number;
}

function ItemContent({ item, showRank, rank }: ItemContentProps): React.ReactNode {
  return (
    <>
      {showRank && (
        <span className="list-widget__rank" aria-hidden="true">
          {rank}.
        </span>
      )}
      <span className="list-widget__text">
        <span className="list-widget__title">{item.title}</span>
        {item.subtitle && (
          <span className="list-widget__subtitle">{item.subtitle}</span>
        )}
      </span>
      {item.score !== undefined && (
        <span className="list-widget__score">
          {formatScore(item.score)}
        </span>
      )}
    </>
  );
}

/**
 * Normalize various data shapes into a consistent array format.
 */
function normalizeData(data: unknown): ListItem[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((item) => normalizeItem(item)).filter((item): item is ListItem => item !== null);
}

/**
 * Normalize a single item to the ListItem format.
 */
function normalizeItem(item: unknown): ListItem | null {
  // String: use as title
  if (typeof item === "string") {
    return { title: item };
  }

  // Object: extract fields
  if (item !== null && typeof item === "object") {
    const obj = item as Record<string, unknown>;

    // Must have at least a title or name field
    const title = obj.title ?? obj.name ?? obj.label;
    if (typeof title !== "string") {
      return null;
    }

    return {
      title,
      subtitle: typeof obj.subtitle === "string" ? obj.subtitle : undefined,
      path: typeof obj.path === "string" ? obj.path : undefined,
      score: typeof obj.score === "number" ? obj.score : undefined,
      metadata: obj,
    };
  }

  return null;
}

/**
 * Format a similarity score for display.
 */
function formatScore(score: number): string {
  // Scores are typically 0-1, display as percentage
  if (score >= 0 && score <= 1) {
    return `${(score * 100).toFixed(0)}%`;
  }
  // Otherwise display as-is with limited precision
  return score.toFixed(2);
}
