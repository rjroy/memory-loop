/**
 * WidgetRenderer Component
 *
 * Dispatches widget results to type-specific display components.
 * Handles empty states with consistent styling.
 */

import React from "react";
import type { WidgetResult } from "@memory-loop/shared";
import { SummaryCardWidget } from "./SummaryCardWidget";
import { TableWidget } from "./TableWidget";
import { ListWidget } from "./ListWidget";
import { MeterWidget } from "./MeterWidget";
import "./WidgetRenderer.css";

/**
 * Props for WidgetRenderer component.
 */
export interface WidgetRendererProps {
  /** Widget result to render */
  widget: WidgetResult;
  /** Optional class name for styling */
  className?: string;
}

/**
 * Renders a widget based on its display type.
 *
 * - Dispatches to SummaryCardWidget, TableWidget, ListWidget, or MeterWidget
 * - Shows empty state for widgets with no data
 * - Applies consistent wrapper styling
 */
export function WidgetRenderer({
  widget,
  className = "",
}: WidgetRendererProps): React.ReactNode {
  const displayType = widget.display.type;
  const title = widget.display.title ?? widget.name;

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
