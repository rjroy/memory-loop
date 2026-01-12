/**
 * EditableField Component
 *
 * Renders editable input controls for widget fields.
 * Supports slider, number, text, date, and select input types.
 * Implements optimistic updates with rollback on error.
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import type { WidgetEditableField } from "@memory-loop/shared";
import "./EditableField.css";

/**
 * Props for EditableField component.
 */
export interface EditableFieldProps {
  /** Field configuration from widget */
  field: WidgetEditableField;
  /** File path for the edit (for widget_edit message) */
  filePath: string;
  /** Callback to send edit to server */
  onEdit: (filePath: string, fieldPath: string, value: unknown) => void;
  /** Whether there's a pending edit for this field */
  isPending?: boolean;
  /** Error message if edit failed */
  error?: string | null;
}

/** Debounce delay for continuous controls (slider, number) */
const DEBOUNCE_MS = 300;

/**
 * Renders an editable input control based on field type.
 *
 * - slider: Range input with min/max/step
 * - number: Numeric input with validation
 * - text: Text input
 * - date: Date picker
 * - select: Dropdown with options
 *
 * Continuous controls (slider, number) are debounced.
 * All controls show optimistic updates immediately.
 */
export function EditableField({
  field,
  filePath,
  onEdit,
  isPending = false,
  error = null,
}: EditableFieldProps): React.ReactNode {
  // Local value for optimistic updates
  const [localValue, setLocalValue] = useState<unknown>(field.currentValue);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local value when server updates field.currentValue
  useEffect(() => {
    if (!isPending) {
      setLocalValue(field.currentValue);
    }
  }, [field.currentValue, isPending]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Send edit to server (debounced for continuous controls)
  const sendEdit = useCallback(
    (value: unknown, immediate = false) => {
      // Update local state immediately (optimistic)
      setLocalValue(value);

      // Clear any pending debounce
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }

      if (immediate) {
        onEdit(filePath, field.field, value);
      } else {
        debounceRef.current = setTimeout(() => {
          debounceRef.current = null;
          onEdit(filePath, field.field, value);
        }, DEBOUNCE_MS);
      }
    },
    [filePath, field.field, onEdit]
  );

  // Render appropriate input based on type
  const renderInput = () => {
    switch (field.type) {
      case "slider":
        return (
          <SliderInput
            value={localValue as number | undefined}
            min={field.min ?? 0}
            max={field.max ?? 100}
            step={field.step ?? 1}
            onChange={(value) => sendEdit(value, false)}
            disabled={isPending}
          />
        );

      case "number":
        return (
          <NumberInput
            value={localValue as number | undefined}
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={(value) => sendEdit(value, false)}
            disabled={isPending}
          />
        );

      case "text":
        return (
          <TextInput
            value={localValue as string | undefined}
            onChange={(value) => sendEdit(value, true)}
            disabled={isPending}
          />
        );

      case "date":
        return (
          <DateInput
            value={localValue as string | undefined}
            onChange={(value) => sendEdit(value, true)}
            disabled={isPending}
          />
        );

      case "select":
        return (
          <SelectInput
            value={localValue as string | undefined}
            options={field.options ?? []}
            onChange={(value) => sendEdit(value, true)}
            disabled={isPending}
          />
        );

      default:
        return <span className="editable-field__error">Unknown type</span>;
    }
  };

  return (
    <div className={`editable-field ${isPending ? "editable-field--pending" : ""}`}>
      <label className="editable-field__label">
        <span className="editable-field__label-text">{field.label}</span>
        {isPending && <span className="editable-field__spinner" aria-label="Saving" />}
      </label>
      <div className="editable-field__input">{renderInput()}</div>
      {error && (
        <p className="editable-field__error-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// =============================================================================
// Input Components
// =============================================================================

interface SliderInputProps {
  value: number | undefined;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

function SliderInput({
  value,
  min,
  max,
  step,
  onChange,
  disabled = false,
}: SliderInputProps): React.ReactNode {
  const currentValue = value ?? min;
  const percentage = ((currentValue - min) / (max - min)) * 100;

  return (
    <div className="editable-field__slider-container">
      <input
        type="range"
        className="editable-field__slider"
        value={currentValue}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={currentValue}
        style={{ "--slider-percentage": `${percentage}%` } as React.CSSProperties}
      />
      <span className="editable-field__slider-value">{currentValue}</span>
    </div>
  );
}

interface NumberInputProps {
  value: number | undefined;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}

function NumberInput({
  value,
  min,
  max,
  step,
  onChange,
  disabled = false,
}: NumberInputProps): React.ReactNode {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === "") {
      onChange(null);
    } else {
      const num = Number(val);
      if (!Number.isNaN(num)) {
        onChange(num);
      }
    }
  };

  return (
    <input
      type="number"
      className="editable-field__number"
      value={value ?? ""}
      min={min}
      max={max}
      step={step}
      onChange={handleChange}
      disabled={disabled}
    />
  );
}

interface TextInputProps {
  value: string | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
}

function TextInput({
  value,
  onChange,
  disabled = false,
}: TextInputProps): React.ReactNode {
  return (
    <input
      type="text"
      className="editable-field__text"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    />
  );
}

interface DateInputProps {
  value: string | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
}

function DateInput({
  value,
  onChange,
  disabled = false,
}: DateInputProps): React.ReactNode {
  return (
    <input
      type="date"
      className="editable-field__date"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    />
  );
}

interface SelectInputProps {
  value: string | undefined;
  options: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

function SelectInput({
  value,
  options,
  onChange,
  disabled = false,
}: SelectInputProps): React.ReactNode {
  return (
    <select
      className="editable-field__select"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      <option value="" disabled>
        Select...
      </option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
