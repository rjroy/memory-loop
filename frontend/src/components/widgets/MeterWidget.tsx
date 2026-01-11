/**
 * MeterWidget Component
 *
 * Displays a single value with a visual scale/gauge.
 * Used for scores, ratings, progress indicators, etc.
 */

import React, { useMemo } from "react";
import type { WidgetResult } from "@memory-loop/shared";
import "./MeterWidget.css";

/**
 * Props for MeterWidget component.
 */
export interface MeterWidgetProps {
  /** Widget result with meter display type */
  widget: WidgetResult;
}

/**
 * Meter data structure.
 */
interface MeterData {
  /** Current value */
  value: number;
  /** Display label (optional) */
  label?: string;
}

/**
 * Renders a single value as a meter/gauge with min/max scale.
 *
 * Expected data format:
 * - Number: uses as value directly
 * - Object: { value: number, label?: string }
 */
export function MeterWidget({ widget }: MeterWidgetProps): React.ReactNode {
  const { value, label } = useMemo(() => extractMeterData(widget.data), [widget.data]);
  const min = widget.display.min ?? 0;
  const max = widget.display.max ?? 100;

  // Calculate percentage for visual representation
  const range = max - min;
  const percentage = range > 0 ? ((value - min) / range) * 100 : 0;
  const clampedPercentage = Math.max(0, Math.min(100, percentage));

  // Determine color based on percentage
  const colorClass = getColorClass(percentage);

  return (
    <div className="meter-widget">
      <div className="meter-widget__display">
        <span className="meter-widget__value">{formatValue(value)}</span>
        {label && <span className="meter-widget__label">{label}</span>}
      </div>
      <div className="meter-widget__track" role="meter" aria-valuenow={value} aria-valuemin={min} aria-valuemax={max}>
        <div
          className={`meter-widget__fill ${colorClass}`}
          style={{ width: `${clampedPercentage}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="meter-widget__range">
        <span className="meter-widget__min">{formatValue(min)}</span>
        <span className="meter-widget__max">{formatValue(max)}</span>
      </div>
    </div>
  );
}

/**
 * Extract meter data from various formats.
 */
function extractMeterData(data: unknown): MeterData {
  // Number: use directly
  if (typeof data === "number") {
    return { value: data };
  }

  // Object: extract fields
  if (data !== null && typeof data === "object") {
    const obj = data as Record<string, unknown>;

    // Check for value in various places
    const value = obj.value ?? obj.score ?? obj.total ?? 0;
    const numValue = typeof value === "number" ? value : 0;

    const label = typeof obj.label === "string" ? obj.label : undefined;

    return { value: numValue, label };
  }

  return { value: 0 };
}

/**
 * Get CSS class for meter fill color based on percentage.
 */
function getColorClass(percentage: number): string {
  if (percentage >= 80) {
    return "meter-widget__fill--high";
  }
  if (percentage >= 50) {
    return "meter-widget__fill--medium";
  }
  if (percentage >= 25) {
    return "meter-widget__fill--low";
  }
  return "meter-widget__fill--critical";
}

/**
 * Format a value for display.
 */
function formatValue(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString()
    : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
