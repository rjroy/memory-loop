/**
 * Widgets Module - Barrel Export
 *
 * Public API for widget display components. Import from this module
 * rather than individual files for stable API access.
 */

// Main renderer
export { WidgetRenderer, type WidgetRendererProps } from "./WidgetRenderer";

// Type-specific widgets
export { SummaryCardWidget, type SummaryCardWidgetProps } from "./SummaryCardWidget";
export { TableWidget, type TableWidgetProps } from "./TableWidget";
export { ListWidget, type ListWidgetProps } from "./ListWidget";
export { MeterWidget, type MeterWidgetProps } from "./MeterWidget";

// Editable controls
export { EditableField, type EditableFieldProps } from "./EditableField";
