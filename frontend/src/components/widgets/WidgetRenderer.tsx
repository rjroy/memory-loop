/**
 * WidgetRenderer Component
 *
 * Dispatches widget results to type-specific display components.
 * Handles empty states with consistent styling.
 * Renders editable fields when widget has editable configuration.
 */

import React from "react";
import type { WidgetResult } from "@memory-loop/shared";
import { SummaryCardWidget } from "./SummaryCardWidget";
import { TableWidget } from "./TableWidget";
import { ListWidget } from "./ListWidget";
import { MeterWidget } from "./MeterWidget";
import { EditableField } from "./EditableField";
import "./WidgetRenderer.css";

/**
 * Props for WidgetRenderer component.
 */
export interface WidgetRendererProps {
  /** Widget result to render */
  widget: WidgetResult;
  /** Optional class name for styling */
  className?: string;
  /** File path for editable fields (required for recall widgets) */
  filePath?: string;
  /** Callback to send edit to server */
  onEdit?: (filePath: string, fieldPath: string, value: unknown) => void;
  /** Map of pending edits: `${filePath}:${fieldPath}` -> value */
  pendingEdits?: Map<string, unknown>;
  /** Error for widget edits */
  editError?: string | null;
}

/**
 * Renders a widget based on its display type.
 *
 * - Dispatches to SummaryCardWidget, TableWidget, ListWidget, or MeterWidget
 * - Shows empty state for widgets with no data
 * - Renders editable fields when widget has editable configuration
 * - Applies consistent wrapper styling
 */
export function WidgetRenderer({
  widget,
  className = "",
  filePath,
  onEdit,
  pendingEdits,
  editError,
}: WidgetRendererProps): React.ReactNode {
  const displayType = widget.display.type;
  const title = widget.display.title ?? widget.name;
  const hasEditableFields = widget.editable && widget.editable.length > 0 && filePath && onEdit;

  // Handle empty state
  if (widget.isEmpty) {
    return (
      <article
        className={`widget widget--empty ${className}`.trim()}
        aria-label={`${title} widget (empty)`}
      >
        <header className="widget__header">
          <h3 className="widget__title">{title}</h3>
        </header>
        <div className="widget__content widget__content--empty">
          <p className="widget__empty-reason">
            {widget.emptyReason ?? "No data available"}
          </p>
        </div>
      </article>
    );
  }

  // Dispatch to type-specific component
  const content = renderWidgetContent(widget);

  return (
    <article
      className={`widget widget--${displayType} ${className}`.trim()}
      aria-label={`${title} widget`}
    >
      <header className="widget__header">
        <h3 className="widget__title">{title}</h3>
      </header>
      <div className="widget__content">{content}</div>
      {hasEditableFields && (
        <div className="widget__editable">
          {widget.editable!.map((field) => {
            const editKey = `${filePath}:${field.field}`;
            const isPending = pendingEdits?.has(editKey) ?? false;
            return (
              <EditableField
                key={field.field}
                field={field}
                filePath={filePath}
                onEdit={onEdit}
                isPending={isPending}
                error={editError}
              />
            );
          })}
        </div>
      )}
    </article>
  );
}

/**
 * Render the widget content based on display type.
 */
function renderWidgetContent(widget: WidgetResult): React.ReactNode {
  switch (widget.display.type) {
    case "summary-card":
      return <SummaryCardWidget widget={widget} />;
    case "table":
      return <TableWidget widget={widget} />;
    case "list":
      return <ListWidget widget={widget} />;
    case "meter":
      return <MeterWidget widget={widget} />;
    default:
      return (
        <p className="widget__error">
          Unknown display type: {(widget.display as { type: string }).type}
        </p>
      );
  }
}
