/**
 * ConfigEditorDialog Component
 *
 * Portal-based modal dialog for editing vault configuration settings.
 * Displays a form with all editable config fields and handles change detection.
 * Uses ConfirmDialog for unsaved changes confirmation.
 */

import {
  useId,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";
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
  order?: number; // display order on vault selection screen
}

export interface ConfigEditorDialogProps {
  isOpen: boolean;
  initialConfig: EditableVaultConfig;
  onSave: (config: EditableVaultConfig) => void;
  onCancel: () => void;
  /** Show loading indicator during save (TASK-010) */
  isSaving?: boolean;
  /** Show inline error message if save failed (TASK-010) */
  saveError?: string | null;
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
  if (initial.order !== current.order) return true;

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

/**
 * Predefined badge colors available for selection
 */
const BADGE_COLORS: BadgeColor[] = [
  "black",
  "purple",
  "red",
  "cyan",
  "orange",
  "blue",
  "green",
  "yellow",
];

/**
 * CSS color values for badge backgrounds
 */
const BADGE_COLOR_VALUES: Record<BadgeColor, string> = {
  black: "var(--color-badge-black, #333)",
  purple: "var(--color-badge-purple, #9b59b6)",
  red: "var(--color-badge-red, #e74c3c)",
  cyan: "var(--color-badge-cyan, #00bcd4)",
  orange: "var(--color-badge-orange, #e67e22)",
  blue: "var(--color-badge-blue, #3498db)",
  green: "var(--color-badge-green, #27ae60)",
  yellow: "var(--color-badge-yellow, #f1c40f)",
};

/**
 * Maximum character length for badge text (REQ-F-20)
 */
const MAX_BADGE_TEXT_LENGTH = 20;

/**
 * Props for the BadgeEditor subcomponent
 */
interface BadgeEditorProps {
  badges: Badge[];
  onChange: (badges: Badge[]) => void;
  maxBadges?: number;
}

/**
 * BadgeEditor Component
 *
 * Allows users to add, remove, and customize badge chips with color selection.
 * Enforces a maximum of 5 badges (REQ-F-21) and 20-character text limit (REQ-F-20).
 */
function BadgeEditor({ badges, onChange, maxBadges = 5 }: BadgeEditorProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newBadgeText, setNewBadgeText] = useState("");
  const [newBadgeColor, setNewBadgeColor] = useState<BadgeColor>("purple");
  const textInputRef = useRef<HTMLInputElement>(null);

  // Focus input when add form opens
  useEffect(() => {
    if (isAdding && textInputRef.current) {
      textInputRef.current.focus();
    }
  }, [isAdding]);

  const canAddMore = badges.length < maxBadges;
  const trimmedText = newBadgeText.trim();
  const canConfirmAdd =
    trimmedText.length > 0 && trimmedText.length <= MAX_BADGE_TEXT_LENGTH;

  const handleAddClick = useCallback(() => {
    setIsAdding(true);
    setNewBadgeText("");
    setNewBadgeColor("purple");
  }, []);

  const handleCancelAdd = useCallback(() => {
    setIsAdding(false);
    setNewBadgeText("");
    setNewBadgeColor("purple");
  }, []);

  const handleConfirmAdd = useCallback(() => {
    if (!canConfirmAdd) return;

    const newBadge: Badge = {
      text: trimmedText,
      color: newBadgeColor,
    };
    onChange([...badges, newBadge]);
    setIsAdding(false);
    setNewBadgeText("");
    setNewBadgeColor("purple");
  }, [badges, onChange, trimmedText, newBadgeColor, canConfirmAdd]);

  const handleRemoveBadge = useCallback(
    (index: number) => {
      const newBadges = badges.filter((_, i) => i !== index);
      onChange(newBadges);
    },
    [badges, onChange]
  );

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // Enforce max length at input level
      const value = e.target.value;
      if (value.length <= MAX_BADGE_TEXT_LENGTH) {
        setNewBadgeText(value);
      }
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && canConfirmAdd) {
        e.preventDefault();
        handleConfirmAdd();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancelAdd();
      }
    },
    [canConfirmAdd, handleConfirmAdd, handleCancelAdd]
  );

  return (
    <div className="badge-editor">
      {/* Existing badges list */}
      {badges.length > 0 && (
        <div className="badge-editor__list">
          {badges.map((badge, index) => (
            <span
              key={index}
              className="badge-editor__chip"
              style={{ backgroundColor: BADGE_COLOR_VALUES[badge.color] }}
            >
              {badge.text}
              <button
                type="button"
                className="badge-editor__chip-remove"
                onClick={() => handleRemoveBadge(index)}
                aria-label={`Remove ${badge.text} badge`}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Add badge form or button */}
      {isAdding ? (
        <div className="badge-editor__add-form">
          {/* Color palette */}
          <div className="badge-editor__color-palette">
            {BADGE_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`badge-editor__color-btn${newBadgeColor === color ? " badge-editor__color-btn--selected" : ""}`}
                style={{ backgroundColor: BADGE_COLOR_VALUES[color] }}
                onClick={() => setNewBadgeColor(color)}
                aria-label={`Select ${color} color`}
              />
            ))}
          </div>

          {/* Text input */}
          <input
            ref={textInputRef}
            type="text"
            className="badge-editor__text-input"
            placeholder="Badge text..."
            value={newBadgeText}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            maxLength={MAX_BADGE_TEXT_LENGTH}
          />

          {/* Character count */}
          <div className="badge-editor__char-count">
            {newBadgeText.length}/{MAX_BADGE_TEXT_LENGTH}
          </div>

          {/* Actions */}
          <div className="badge-editor__add-actions">
            <button
              type="button"
              className="badge-editor__cancel-btn"
              onClick={handleCancelAdd}
            >
              Cancel
            </button>
            <button
              type="button"
              className="badge-editor__confirm-btn"
              onClick={handleConfirmAdd}
              disabled={!canConfirmAdd}
            >
              Add
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="badge-editor__add-btn"
          onClick={handleAddClick}
          disabled={!canAddMore}
        >
          Add badge
        </button>
      )}
    </div>
  );
}

export function ConfigEditorDialog({
  isOpen,
  initialConfig,
  onSave,
  onCancel,
  isSaving = false,
  saveError = null,
}: ConfigEditorDialogProps): React.ReactNode {
  const dialogTitleId = useId();
  const titleInputId = useId();
  const subtitleInputId = useId();
  const orderInputId = useId();
  const discussionModelId = useId();

  // Slider field IDs for accessibility
  const promptsPerGenerationId = useId();
  const maxPoolSizeId = useId();
  const quotesPerWeekId = useId();
  const recentCapturesId = useId();
  const recentDiscussionsId = useId();

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
  // Disable cancel while saving (TASK-010)
  const handleCancelAttempt = useCallback(() => {
    if (isSaving) return; // Prevent cancel during save
    if (hasChanges) {
      setShowUnsavedConfirm(true);
    } else {
      onCancel();
    }
  }, [hasChanges, onCancel, isSaving]);

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
          aria-labelledby={dialogTitleId}
        >
          {/* Header */}
          <div className="config-editor__header">
            <h2 id={dialogTitleId} className="config-editor__title">
              Vault Settings
            </h2>
            <button
              type="button"
              className="config-editor__close-btn"
              onClick={handleCancelAttempt}
              aria-label="Close"
              disabled={isSaving}
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
            {/* Identity Settings Section */}
            <section className="config-editor__section">
              <h3 className="config-editor__section-title">Identity</h3>
              <p className="config-editor__section-description">
                Customize how this vault appears in Memory Loop.
              </p>
              <div className="config-editor__field">
                <label htmlFor={titleInputId} className="config-editor__label">
                  Vault Title
                </label>
                <input
                  id={titleInputId}
                  type="text"
                  className="config-editor__input"
                  value={formState.title ?? ""}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      title: e.target.value || undefined,
                    }))
                  }
                  placeholder="My Vault"
                />
              </div>
              <div className="config-editor__field">
                <label
                  htmlFor={subtitleInputId}
                  className="config-editor__label"
                >
                  Subtitle
                </label>
                <input
                  id={subtitleInputId}
                  type="text"
                  className="config-editor__input"
                  value={formState.subtitle ?? ""}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      subtitle: e.target.value || undefined,
                    }))
                  }
                  placeholder="A brief description"
                />
              </div>
              <div className="config-editor__field">
                <label
                  htmlFor={orderInputId}
                  className="config-editor__label"
                >
                  Display Order
                </label>
                <input
                  id={orderInputId}
                  type="number"
                  className="config-editor__input config-editor__input--narrow"
                  value={formState.order ?? ""}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      order: e.target.value ? parseInt(e.target.value, 10) : undefined,
                    }))
                  }
                  placeholder="Auto"
                  min={1}
                />
                <p className="config-editor__field-hint">
                  Lower numbers appear first. Leave empty to sort last.
                </p>
              </div>
              <div className="config-editor__field">
                <label className="config-editor__label">Badges</label>
                <BadgeEditor
                  badges={formState.badges ?? []}
                  onChange={(badges) =>
                    setFormState((prev) => ({ ...prev, badges }))
                  }
                />
              </div>
            </section>

            {/* Discussion Settings Section */}
            <section className="config-editor__section">
              <h3 className="config-editor__section-title">Discussion</h3>
              <p className="config-editor__section-description">
                Configure AI model and conversation history.
              </p>
              <div className="config-editor__field">
                <label
                  htmlFor={discussionModelId}
                  className="config-editor__label"
                >
                  AI Model
                </label>
                <select
                  id={discussionModelId}
                  className="config-editor__select"
                  value={formState.discussionModel ?? ""}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      discussionModel:
                        (e.target.value as "opus" | "sonnet" | "haiku") ||
                        undefined,
                    }))
                  }
                >
                  <option value="" disabled>
                    Select model
                  </option>
                  <option value="opus">Opus (Most capable)</option>
                  <option value="sonnet">Sonnet (Balanced)</option>
                  <option value="haiku">Haiku (Fastest)</option>
                </select>
              </div>

              {/* Recent Discussions slider */}
              <div className="config-editor__slider-field">
                <label
                  htmlFor={recentDiscussionsId}
                  className="config-editor__label"
                >
                  Recent Discussions to Show
                </label>
                <div className="config-editor__slider-row">
                  <input
                    id={recentDiscussionsId}
                    type="range"
                    className="config-editor__slider"
                    min={1}
                    max={20}
                    step={1}
                    value={formState.recentDiscussions ?? 5}
                    aria-valuemin={1}
                    aria-valuemax={20}
                    aria-valuenow={formState.recentDiscussions ?? 5}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        recentDiscussions: parseInt(e.target.value, 10),
                      }))
                    }
                  />
                  <span className="config-editor__slider-value">
                    {formState.recentDiscussions ?? 5}
                  </span>
                </div>
              </div>
            </section>

            {/* Inspiration Settings Section */}
            <section className="config-editor__section">
              <h3 className="config-editor__section-title">Inspiration</h3>
              <p className="config-editor__section-description">
                Control contextual prompts and quotes on the home screen.
              </p>

              {/* Prompts per Generation slider */}
              <div className="config-editor__slider-field">
                <label
                  htmlFor={promptsPerGenerationId}
                  className="config-editor__label"
                >
                  Prompts per Generation
                </label>
                <div className="config-editor__slider-row">
                  <input
                    id={promptsPerGenerationId}
                    type="range"
                    className="config-editor__slider"
                    min={1}
                    max={20}
                    step={1}
                    value={formState.promptsPerGeneration ?? 5}
                    aria-valuemin={1}
                    aria-valuemax={20}
                    aria-valuenow={formState.promptsPerGeneration ?? 5}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        promptsPerGeneration: parseInt(e.target.value, 10),
                      }))
                    }
                  />
                  <span className="config-editor__slider-value">
                    {formState.promptsPerGeneration ?? 5}
                  </span>
                </div>
              </div>

              {/* Prompt Pool Size slider */}
              <div className="config-editor__slider-field">
                <label htmlFor={maxPoolSizeId} className="config-editor__label">
                  Prompt Pool Size
                </label>
                <div className="config-editor__slider-row">
                  <input
                    id={maxPoolSizeId}
                    type="range"
                    className="config-editor__slider"
                    min={10}
                    max={200}
                    step={10}
                    value={formState.maxPoolSize ?? 50}
                    aria-valuemin={10}
                    aria-valuemax={200}
                    aria-valuenow={formState.maxPoolSize ?? 50}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        maxPoolSize: parseInt(e.target.value, 10),
                      }))
                    }
                  />
                  <span className="config-editor__slider-value">
                    {formState.maxPoolSize ?? 50}
                  </span>
                </div>
              </div>

              {/* Quotes per Week slider */}
              <div className="config-editor__slider-field">
                <label
                  htmlFor={quotesPerWeekId}
                  className="config-editor__label"
                >
                  Quotes per Week
                </label>
                <div className="config-editor__slider-row">
                  <input
                    id={quotesPerWeekId}
                    type="range"
                    className="config-editor__slider"
                    min={0}
                    max={7}
                    step={1}
                    value={formState.quotesPerWeek ?? 2}
                    aria-valuemin={0}
                    aria-valuemax={7}
                    aria-valuenow={formState.quotesPerWeek ?? 2}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        quotesPerWeek: parseInt(e.target.value, 10),
                      }))
                    }
                  />
                  <span className="config-editor__slider-value">
                    {formState.quotesPerWeek ?? 2}
                  </span>
                </div>
              </div>
            </section>

            {/* Recent Activity Settings Section */}
            <section className="config-editor__section">
              <h3 className="config-editor__section-title">Recent Activity</h3>
              <p className="config-editor__section-description">
                Configure how many recent captures to display.
              </p>

              {/* Recent Captures slider */}
              <div className="config-editor__slider-field">
                <label
                  htmlFor={recentCapturesId}
                  className="config-editor__label"
                >
                  Recent Captures to Show
                </label>
                <div className="config-editor__slider-row">
                  <input
                    id={recentCapturesId}
                    type="range"
                    className="config-editor__slider"
                    min={1}
                    max={20}
                    step={1}
                    value={formState.recentCaptures ?? 5}
                    aria-valuemin={1}
                    aria-valuemax={20}
                    aria-valuenow={formState.recentCaptures ?? 5}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        recentCaptures: parseInt(e.target.value, 10),
                      }))
                    }
                  />
                  <span className="config-editor__slider-value">
                    {formState.recentCaptures ?? 5}
                  </span>
                </div>
              </div>
            </section>
          </div>

          {/* Footer with actions */}
          <div className="config-editor__footer">
            {/* Save error display (TASK-010) */}
            {saveError && (
              <div className="config-editor__error" role="alert">
                {saveError}
              </div>
            )}
            <div className="config-editor__footer-actions">
              <button
                type="button"
                className="config-editor__btn config-editor__btn--cancel"
                onClick={handleCancelAttempt}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`config-editor__btn config-editor__btn--save${isSaving ? " config-editor__btn--loading" : ""}`}
                onClick={handleSave}
                disabled={!hasChanges || isSaving}
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
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
