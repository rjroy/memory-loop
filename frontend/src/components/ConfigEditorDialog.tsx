/**
 * ConfigEditorDialog Component
 *
 * Portal-based modal dialog for editing vault configuration settings.
 * Displays a form with all editable config fields and handles change detection.
 * Uses ConfirmDialog for unsaved changes confirmation.
 */

import React, { useId, useState, useCallback, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "./ConfirmDialog";
import "./ConfigEditorDialog.css";

/**
 * Valid badge colors (matches BadgeColorSchema from protocol.ts)
 */
export type BadgeColor =
  | "black"
  | "purple"
  | "red"
  | "cyan"
  | "orange"
  | "blue"
  | "green"
  | "yellow";

/**
 * Badge configuration
 */
export interface Badge {
  text: string;
  color: BadgeColor;
}

/**
 * Editable vault configuration fields.
 * This represents the subset of vault config that users can modify.
 */
export interface EditableVaultConfig {
  title?: string;
  subtitle?: string;
  discussionModel?: "opus" | "sonnet" | "haiku";
  promptsPerGeneration?: number; // 1-20
  maxPoolSize?: number; // 10-200
  quotesPerWeek?: number; // 0-7
  recentCaptures?: number; // 1-20
  recentDiscussions?: number; // 1-20
  badges?: Badge[]; // max 5
}

export interface ConfigEditorDialogProps {
  isOpen: boolean;
  initialConfig: EditableVaultConfig;
  onSave: (config: EditableVaultConfig) => void;
  onCancel: () => void;
}

/**
 * Deep comparison of two config objects.
 * Returns true if they differ.
 */
function hasConfigChanged(
  initial: EditableVaultConfig,
  current: EditableVaultConfig
): boolean {
  // Compare primitive fields
  if (initial.title !== current.title) return true;
  if (initial.subtitle !== current.subtitle) return true;
  if (initial.discussionModel !== current.discussionModel) return true;
  if (initial.promptsPerGeneration !== current.promptsPerGeneration) return true;
  if (initial.maxPoolSize !== current.maxPoolSize) return true;
  if (initial.quotesPerWeek !== current.quotesPerWeek) return true;
  if (initial.recentCaptures !== current.recentCaptures) return true;
  if (initial.recentDiscussions !== current.recentDiscussions) return true;

  // Compare badges array
  const initialBadges = initial.badges ?? [];
  const currentBadges = current.badges ?? [];

  if (initialBadges.length !== currentBadges.length) return true;

  for (let i = 0; i < initialBadges.length; i++) {
    if (
      initialBadges[i].text !== currentBadges[i].text ||
      initialBadges[i].color !== currentBadges[i].color
    ) {
      return true;
    }
  }

  return false;
}

export function ConfigEditorDialog({
  isOpen,
  initialConfig,
  onSave,
  onCancel,
}: ConfigEditorDialogProps): React.ReactNode {
  const titleId = useId();

  // Form state - initialized from initialConfig
  const [formState, setFormState] = useState<EditableVaultConfig>(initialConfig);

  // Track if confirm dialog for unsaved changes is shown
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);

  // Reset form state when dialog opens with new config
  useEffect(() => {
    if (isOpen) {
      setFormState(initialConfig);
    }
  }, [isOpen, initialConfig]);

  // Compute if form has unsaved changes
  const hasChanges = useMemo(
    () => hasConfigChanged(initialConfig, formState),
    [initialConfig, formState]
  );

  // Cancel attempt - show confirmation if there are changes
  const handleCancelAttempt = useCallback(() => {
    if (hasChanges) {
      setShowUnsavedConfirm(true);
    } else {
      onCancel();
    }
  }, [hasChanges, onCancel]);

  // Handle backdrop click - trigger cancel behavior
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        handleCancelAttempt();
      }
    },
    [handleCancelAttempt]
  );

  // Handle Escape key - trigger cancel behavior
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancelAttempt();
      }
    },
    [handleCancelAttempt]
  );

  // Confirm discard changes
  const handleConfirmDiscard = useCallback(() => {
    setShowUnsavedConfirm(false);
    onCancel();
  }, [onCancel]);

  // Cancel discard (keep editing)
  const handleCancelDiscard = useCallback(() => {
    setShowUnsavedConfirm(false);
  }, []);

  // Handle save button click
  const handleSave = useCallback(() => {
    onSave(formState);
  }, [onSave, formState]);

  if (!isOpen) return null;

  return createPortal(
    <>
      <div
        className="config-editor__backdrop"
        onClick={handleBackdropClick}
        onKeyDown={handleKeyDown}
      >
        <div
          className="config-editor"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          {/* Header */}
          <div className="config-editor__header">
            <h2 id={titleId} className="config-editor__title">
              Vault Settings
            </h2>
            <button
              type="button"
              className="config-editor__close-btn"
              onClick={handleCancelAttempt}
              aria-label="Close"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <line x1="4" y1="4" x2="16" y2="16" />
                <line x1="16" y1="4" x2="4" y2="16" />
              </svg>
            </button>
          </div>

          {/* Scrollable content area */}
          <div className="config-editor__content">
            {/* TASK-005: Identity Settings Section */}
            <section className="config-editor__section">
              <h3 className="config-editor__section-title">Identity</h3>
              <p className="config-editor__section-description">
                Customize how this vault appears in Memory Loop.
              </p>
              {/* Placeholder for title, subtitle, and badges fields */}
              <div className="config-editor__placeholder">
                Identity fields will be implemented in TASK-005
              </div>
            </section>

            {/* TASK-006: Discussion Settings Section */}
            <section className="config-editor__section">
              <h3 className="config-editor__section-title">Discussion</h3>
              <p className="config-editor__section-description">
                Configure AI model and conversation history.
              </p>
              {/* Placeholder for discussionModel and recentDiscussions fields */}
              <div className="config-editor__placeholder">
                Discussion fields will be implemented in TASK-006
              </div>
            </section>

            {/* TASK-007: Inspiration Settings Section */}
            <section className="config-editor__section">
              <h3 className="config-editor__section-title">Inspiration</h3>
              <p className="config-editor__section-description">
                Control contextual prompts and quotes on the home screen.
              </p>
              {/* Placeholder for prompts and quotes fields */}
              <div className="config-editor__placeholder">
                Inspiration fields will be implemented in TASK-007
              </div>
            </section>

            {/* TASK-007: Recent Activity Settings Section */}
            <section className="config-editor__section">
              <h3 className="config-editor__section-title">Recent Activity</h3>
              <p className="config-editor__section-description">
                Configure how many recent captures to display.
              </p>
              {/* Placeholder for recentCaptures field */}
              <div className="config-editor__placeholder">
                Recent activity fields will be implemented in TASK-007
              </div>
            </section>
          </div>

          {/* Footer with actions */}
          <div className="config-editor__footer">
            <button
              type="button"
              className="config-editor__btn config-editor__btn--cancel"
              onClick={handleCancelAttempt}
            >
              Cancel
            </button>
            <button
              type="button"
              className="config-editor__btn config-editor__btn--save"
              onClick={handleSave}
              disabled={!hasChanges}
            >
              Save
            </button>
          </div>
        </div>
      </div>

      {/* Unsaved changes confirmation dialog */}
      <ConfirmDialog
        isOpen={showUnsavedConfirm}
        title="Discard Changes?"
        message="You have unsaved changes. Are you sure you want to discard them?"
        confirmLabel="Discard"
        onConfirm={handleConfirmDiscard}
        onCancel={handleCancelDiscard}
      />
    </>,
    document.body
  );
}
