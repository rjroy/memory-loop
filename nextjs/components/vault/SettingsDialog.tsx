/**
 * SettingsDialog Component
 *
 * Portal-based modal dialog for Memory Loop settings.
 * Tabbed interface with Memory Editor, Extraction Prompt, and Card Generator tabs.
 * Mobile-optimized layout with proper accessibility.
 *
 * Spec Requirements:
 * - REQ-F-12: Memory.md editor
 * - REQ-F-15: Extraction prompt editor
 * - Card Generator settings (requirements, byte limit, manual trigger)
 */

import { useId, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import "./SettingsDialog.css";

/**
 * Tab identifiers for the settings dialog.
 */
export type SettingsTab = "memory" | "prompt" | "cards";

/**
 * Props for the SettingsDialog component.
 */
export interface SettingsDialogProps {
  /** Whether the dialog is visible */
  isOpen: boolean;
  /** Initial tab to display */
  initialTab?: SettingsTab;
  /** Callback when dialog is closed */
  onClose: () => void;
  /** Optional children to render in tabs */
  memoryEditorContent?: React.ReactNode;
  promptEditorContent?: React.ReactNode;
  cardGeneratorContent?: React.ReactNode;
}

/**
 * SettingsDialog Component
 *
 * Provides a tabbed interface for Memory Loop settings including:
 * - Memory Editor: View and edit memory.md content
 * - Extraction Prompt: View and customize the extraction prompt
 */
export function SettingsDialog({
  isOpen,
  initialTab = "memory",
  onClose,
  memoryEditorContent,
  promptEditorContent,
  cardGeneratorContent,
}: SettingsDialogProps): React.ReactNode {
  const dialogTitleId = useId();
  const tablistId = useId();
  const memoryTabId = useId();
  const promptTabId = useId();
  const cardsTabId = useId();
  const memoryPanelId = useId();
  const promptPanelId = useId();
  const cardsPanelId = useId();

  // Current active tab
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  // Reset to initial tab when dialog opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // Handle Escape key
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  // Handle tab keyboard navigation (cycles through all 3 tabs)
  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const tabs: SettingsTab[] = ["memory", "prompt", "cards"];
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setActiveTab((prev) => {
          const idx = tabs.indexOf(prev);
          return tabs[(idx + 1) % tabs.length];
        });
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setActiveTab((prev) => {
          const idx = tabs.indexOf(prev);
          return tabs[(idx - 1 + tabs.length) % tabs.length];
        });
      }
    },
    []
  );

  if (!isOpen) return null;

  return createPortal(
    <div
      className="settings-dialog__backdrop"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
      >
        {/* Header */}
        <div className="settings-dialog__header">
          <h2 id={dialogTitleId} className="settings-dialog__title">
            Memory Settings
          </h2>
          <button
            type="button"
            className="settings-dialog__close-btn"
            onClick={onClose}
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

        {/* Tab navigation */}
        <div className="settings-dialog__tabs">
          <div
            id={tablistId}
            role="tablist"
            aria-label="Settings sections"
            className="settings-dialog__tablist"
            onKeyDown={handleTabKeyDown}
          >
            <button
              id={memoryTabId}
              role="tab"
              type="button"
              aria-selected={activeTab === "memory"}
              aria-controls={memoryPanelId}
              tabIndex={activeTab === "memory" ? 0 : -1}
              className={`settings-dialog__tab${activeTab === "memory" ? " settings-dialog__tab--active" : ""}`}
              onClick={() => setActiveTab("memory")}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="settings-dialog__tab-icon"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              Memory
            </button>
            <button
              id={promptTabId}
              role="tab"
              type="button"
              aria-selected={activeTab === "prompt"}
              aria-controls={promptPanelId}
              tabIndex={activeTab === "prompt" ? 0 : -1}
              className={`settings-dialog__tab${activeTab === "prompt" ? " settings-dialog__tab--active" : ""}`}
              onClick={() => setActiveTab("prompt")}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="settings-dialog__tab-icon"
              >
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <line x1="10" y1="9" x2="8" y2="9" />
              </svg>
              Extraction Prompt
            </button>
            <button
              id={cardsTabId}
              role="tab"
              type="button"
              aria-selected={activeTab === "cards"}
              aria-controls={cardsPanelId}
              tabIndex={activeTab === "cards" ? 0 : -1}
              className={`settings-dialog__tab${activeTab === "cards" ? " settings-dialog__tab--active" : ""}`}
              onClick={() => setActiveTab("cards")}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="settings-dialog__tab-icon"
              >
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M7 8h10" />
                <path d="M7 12h6" />
              </svg>
              Card Generator
            </button>
          </div>
        </div>

        {/* Tab panels */}
        <div className="settings-dialog__content">
          {/* Memory Editor Panel */}
          <div
            id={memoryPanelId}
            role="tabpanel"
            aria-labelledby={memoryTabId}
            hidden={activeTab !== "memory"}
            className="settings-dialog__panel"
          >
            {memoryEditorContent ?? (
              <div className="settings-dialog__placeholder">
                <p>Memory editor will be implemented in TASK-011.</p>
                <p>
                  This tab allows you to view and edit the memory.md file that
                  Claude uses for context injection.
                </p>
              </div>
            )}
          </div>

          {/* Extraction Prompt Panel */}
          <div
            id={promptPanelId}
            role="tabpanel"
            aria-labelledby={promptTabId}
            hidden={activeTab !== "prompt"}
            className="settings-dialog__panel"
          >
            {promptEditorContent ?? (
              <div className="settings-dialog__placeholder">
                <p>Extraction prompt editor will be implemented in TASK-012.</p>
                <p>
                  This tab allows you to customize the prompt used for fact
                  extraction from transcripts.
                </p>
              </div>
            )}
          </div>

          {/* Card Generator Panel */}
          <div
            id={cardsPanelId}
            role="tabpanel"
            aria-labelledby={cardsTabId}
            hidden={activeTab !== "cards"}
            className="settings-dialog__panel"
          >
            {cardGeneratorContent ?? (
              <div className="settings-dialog__placeholder">
                <p>Card Generator settings.</p>
                <p>
                  Configure the requirements for flashcard generation and set
                  weekly byte limits.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="settings-dialog__footer">
          <button
            type="button"
            className="settings-dialog__btn settings-dialog__btn--close"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
