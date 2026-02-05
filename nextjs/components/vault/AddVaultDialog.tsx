/**
 * AddVaultDialog Component
 *
 * Dialog for creating a new vault. Accepts a title which will be
 * converted to a safe directory name on the backend.
 */

import React, { useId, useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import "./AddVaultDialog.css";

export interface AddVaultDialogProps {
  isOpen: boolean;
  onConfirm: (title: string) => void;
  onCancel: () => void;
  /** Show loading indicator during creation */
  isCreating?: boolean;
  /** Show inline error message if creation failed */
  createError?: string | null;
}

export function AddVaultDialog({
  isOpen,
  onConfirm,
  onCancel,
  isCreating = false,
  createError = null,
}: AddVaultDialogProps): React.ReactNode {
  const titleId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");

  // Reset state and focus input when dialog opens
  useEffect(() => {
    if (isOpen) {
      setTitle("");
      // Focus input after a brief delay to ensure dialog is rendered
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  const trimmedTitle = title.trim();
  const canSubmit = trimmedTitle.length > 0 && !isCreating;

  const handleSubmit = useCallback(() => {
    if (canSubmit) {
      onConfirm(trimmedTitle);
    }
  }, [canSubmit, trimmedTitle, onConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && canSubmit) {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === "Escape" && !isCreating) {
        e.preventDefault();
        onCancel();
      }
    },
    [canSubmit, handleSubmit, isCreating, onCancel]
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !isCreating) {
        onCancel();
      }
    },
    [isCreating, onCancel]
  );

  const handleCancelClick = useCallback(() => {
    if (!isCreating) {
      onCancel();
    }
  }, [isCreating, onCancel]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="add-vault-dialog__backdrop"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div
        className="add-vault-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="add-vault-dialog__title">
          Add Vault
        </h2>
        <p className="add-vault-dialog__message">
          Enter a name for your new vault. A directory will be created
          and configured automatically.
        </p>

        <div className="add-vault-dialog__field">
          <label htmlFor={inputId} className="add-vault-dialog__label">
            Vault Name
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            className="add-vault-dialog__input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="My New Vault"
            disabled={isCreating}
            autoComplete="off"
          />
        </div>

        {createError && (
          <div className="add-vault-dialog__error" role="alert">
            {createError}
          </div>
        )}

        <div className="add-vault-dialog__actions">
          <button
            type="button"
            className="add-vault-dialog__btn add-vault-dialog__btn--cancel"
            onClick={handleCancelClick}
            disabled={isCreating}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`add-vault-dialog__btn add-vault-dialog__btn--confirm${isCreating ? " add-vault-dialog__btn--loading" : ""}`}
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {isCreating ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
