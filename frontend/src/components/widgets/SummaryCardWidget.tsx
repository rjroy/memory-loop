/**
 * SummaryCardWidget Component
 *
 * Displays aggregate widget data as key-value pairs.
 * Used for collection statistics like total count, average, etc.
 */

import React from "react";
import type { WidgetResult } from "@memory-loop/shared";
import "./SummaryCardWidget.css";

/**
 * Props for SummaryCardWidget component.
 */
export interface SummaryCardWidgetProps {
  /** Widget result with summary-card display type */
  widget: WidgetResult;
}

/**
 * Data structure for summary card items.
 * Each item has a label and value to display.
 */
interface SummaryItem {
  label: string;
  value: string | number | null;
  /** Optional format hint: "number", "percent", "currency" */
  format?: string;
}

/**
 * Renders aggregate data as a summary card with key-value pairs.
 *
 * Expected data format:
 * - Array of { label, value, format? } objects
 * - Or object with { [label]: value } pairs
 */
export function SummaryCardWidget({
  widget,
}: SummaryCardWidgetProps): React.ReactNode {
  const items = normalizeData(widget.data);

  if (items.length === 0) {
    return <p className="summary-card__empty">No summary data</p>;
  }

  return (
    <dl className="summary-card">
      {items.map((item, index) => (
        <div key={index} className="summary-card__item">
          <dt className="summary-card__label">{item.label}</dt>
          <dd className="summary-card__value">{formatValue(item)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Normalize various data shapes into a consistent array format.
 */
function normalizeData(data: unknown): SummaryItem[] {
  if (Array.isArray(data)) {
    return data.filter(isValidItem).map((item) => ({
      label: String(item.label),
      value: item.value as string | number | null,
      format: typeof item.format === "string" ? item.format : undefined,
    }));
  }

  if (data !== null && typeof data === "object") {
    return Object.entries(data as Record<string, unknown>).map(
      ([label, value]) => ({
        label,
        value: value as string | number | null,
      })
    );
  }

  return [];
}

/**
 * Check if an item has the required shape.
 */
function isValidItem(item: unknown): item is { label: unknown; value: unknown; format?: unknown } {
  return (
    item !== null &&
    typeof item === "object" &&
    "label" in item &&
    "value" in item
  );
}

/**
 * Format a value for display based on its type and format hint.
 */
function formatValue(item: SummaryItem): string {
  const { value, format } = item;

  if (value === null || value === undefined) {
    return "—";
  }

  if (typeof value === "number") {
    if (format === "percent") {
      return `${(value * 100).toFixed(1)}%`;
    }
    if (format === "currency") {
      return `$${value.toFixed(2)}`;
    }
    // Default number formatting: use locale-aware formatting
    return Number.isInteger(value)
      ? value.toLocaleString()
      : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  return String(value);
}
