/**
 * InputDialog Component
 *
 * Dialog with a text input field for collecting user input.
 * Supports validation with pattern matching and custom error messages.
 */

import React, { useId, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import "./InputDialog.css";

export interface InputDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  inputLabel: string;
  inputPlaceholder?: string;
  /** Regex pattern for validation */
  pattern?: RegExp;
  /** Error message shown when pattern doesn't match */
  patternError?: string;
  confirmLabel: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function InputDialog({
  isOpen,
  title,
  message,
  inputLabel,
  inputPlaceholder,
  pattern,
  patternError,
  confirmLabel,
  onConfirm,
  onCancel,
}: InputDialogProps): React.ReactNode {
  const titleId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setValue("");
      setError(null);
      // Focus input after a brief delay for animation
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onCancel();
    } else if (e.key === "Enter" && !error && value.trim()) {
      handleSubmit();
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newValue = e.target.value;
    setValue(newValue);

    // Validate against pattern if provided
    if (pattern && newValue.trim()) {
      if (!pattern.test(newValue)) {
        setError(patternError ?? "Invalid input");
      } else {
        setError(null);
      }
    } else {
      setError(null);
    }
  }

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Value is required");
      return;
    }
    if (pattern && !pattern.test(trimmed)) {
      setError(patternError ?? "Invalid input");
      return;
    }
    onConfirm(trimmed);
  }

  const isValid = value.trim() && !error;

  return createPortal(
    <div
      className="input-dialog__backdrop"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div
        className="input-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="input-dialog__title">
          {title}
        </h2>
        <p className="input-dialog__message">{message}</p>

        <div className="input-dialog__field">
          <label htmlFor={inputId} className="input-dialog__label">
            {inputLabel}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            className={`input-dialog__input ${error ? "input-dialog__input--error" : ""}`}
            value={value}
            onChange={handleInputChange}
            placeholder={inputPlaceholder}
            autoComplete="off"
            spellCheck={false}
          />
          {error && (
            <p className="input-dialog__error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="input-dialog__actions">
          <button
            type="button"
            className="input-dialog__btn input-dialog__btn--cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="input-dialog__btn input-dialog__btn--confirm"
            onClick={handleSubmit}
            disabled={!isValid}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
