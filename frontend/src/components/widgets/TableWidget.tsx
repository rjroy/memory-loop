/**
 * TableWidget Component
 *
 * Displays widget data as a sortable table with rows and columns.
 * Used for ranked lists, comparison data, etc.
 */

import React, { useState, useCallback, useMemo } from "react";
import type { WidgetResult } from "@memory-loop/shared";
import "./TableWidget.css";

/**
 * Props for TableWidget component.
 */
export interface TableWidgetProps {
  /** Widget result with table display type */
  widget: WidgetResult;
}

/**
 * Row data structure for the table.
 */
type RowData = Record<string, unknown>;

/**
 * Sort direction type.
 */
type SortDirection = "asc" | "desc" | null;

/**
 * Renders widget data as a table with sortable columns.
 *
 * Expected data format:
 * - Array of objects where each object is a row
 * - Columns defined in widget.display.columns or auto-detected from data
 */
export function TableWidget({ widget }: TableWidgetProps): React.ReactNode {
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // Extract columns and rows from widget data
  const { columns, rows } = useMemo(() => {
    const data = widget.data as RowData[] | undefined;
    if (!Array.isArray(data) || data.length === 0) {
      return { columns: [], rows: [] };
    }

    // Use configured columns or auto-detect from first row
    const cols = widget.display.columns ?? Object.keys(data[0]);
    return { columns: cols, rows: data };
  }, [widget.data, widget.display.columns]);

  // Handle column header click for sorting
  const handleSort = useCallback((column: string) => {
    setSortColumn((prevColumn) => {
      if (prevColumn === column) {
        // Toggle direction or clear
        setSortDirection((prevDir) => {
          if (prevDir === "asc") return "desc";
          if (prevDir === "desc") return null;
          return "asc";
        });
        return prevColumn;
      }
      // New column, start ascending
      setSortDirection("asc");
      return column;
    });
  }, []);

  // Sort rows based on current sort state
  const sortedRows = useMemo(() => {
    if (!sortColumn || !sortDirection) return rows;

    return [...rows].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];

      // Handle null/undefined
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sortDirection === "asc" ? 1 : -1;
      if (bVal == null) return sortDirection === "asc" ? -1 : 1;

      // Compare based on type
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }

      // String comparison - use formatCellValue to safely convert to string
      const aStr = formatCellValue(aVal).toLowerCase();
      const bStr = formatCellValue(bVal).toLowerCase();
      const cmp = aStr.localeCompare(bStr);
      return sortDirection === "asc" ? cmp : -cmp;
    });
  }, [rows, sortColumn, sortDirection]);

  if (columns.length === 0 || rows.length === 0) {
    return <p className="table-widget__empty">No table data</p>;
  }

  return (
    <div className="table-widget">
      <table className="table-widget__table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                className="table-widget__header"
                onClick={() => handleSort(column)}
                aria-sort={
                  sortColumn === column
                    ? sortDirection === "asc"
                      ? "ascending"
                      : sortDirection === "desc"
                        ? "descending"
                        : "none"
                    : undefined
                }
              >
                <button
                  type="button"
                  className="table-widget__sort-btn"
                  aria-label={`Sort by ${column}`}
                >
                  <span className="table-widget__header-text">{formatColumnName(column)}</span>
                  <span className="table-widget__sort-indicator" aria-hidden="true">
                    {sortColumn === column && sortDirection === "asc" && " ↑"}
                    {sortColumn === column && sortDirection === "desc" && " ↓"}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, rowIndex) => (
            <tr key={rowIndex} className="table-widget__row">
              {columns.map((column) => (
                <td key={column} className="table-widget__cell">
                  {formatCellValue(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Format a column name for display (e.g., snake_case to Title Case).
 */
function formatColumnName(column: string): string {
  return column
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Format a cell value for display.
 */
function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isInteger(value)
      ? value.toLocaleString()
      : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");
  }

  // Handle objects by JSON stringifying them
  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  // Remaining primitives (bigint, symbol)
  return String(value as string | bigint | symbol);
}
