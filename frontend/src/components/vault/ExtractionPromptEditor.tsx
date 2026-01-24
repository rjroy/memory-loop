/**
 * ExtractionPromptEditor Component
 *
 * Editor for the extraction prompt used by the fact extraction system.
 * Features:
 * - Textarea for viewing/editing the extraction prompt
 * - Indicator showing if user override is active
 * - Save button to create/update user override
 * - Reset to default button to remove user override
 *
 * Spec Requirements:
 * - REQ-F-15: View extraction prompt
 * - REQ-F-16: Edit extraction prompt
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { ClientMessage, ServerMessage } from "@memory-loop/shared";
import "./ExtractionPromptEditor.css";

/**
 * Props for the ExtractionPromptEditor component.
 */
export interface ExtractionPromptEditorProps {
  /** Function to send WebSocket messages */
  sendMessage: (message: ClientMessage) => void;
  /** Last received server message (for handling responses) */
  lastMessage: ServerMessage | null;
}

/**
 * ExtractionPromptEditor Component
 *
 * Provides an interface for viewing and editing the extraction prompt.
 * Shows whether the user has a custom override or is using the default.
 */
export function ExtractionPromptEditor({
  sendMessage,
  lastMessage,
}: ExtractionPromptEditorProps): React.ReactNode {
  // State
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOverride, setIsOverride] = useState(false);

  // Extraction status state
  const [extractionStatus, setExtractionStatus] = useState<
    "idle" | "running" | "complete" | "error"
  >("idle");
  const [extractionMessage, setExtractionMessage] = useState<string | null>(null);

  // Track if we've requested the content
  const hasRequestedRef = useRef(false);

  // Calculate if there are unsaved changes
  const hasChanges = content !== originalContent;

  // Request extraction prompt on mount
  useEffect(() => {
    if (!hasRequestedRef.current) {
      hasRequestedRef.current = true;
      sendMessage({ type: "get_extraction_prompt" });
    }
  }, [sendMessage]);

  // Ref to track current content for save/reset callbacks
  const contentRef = useRef(content);
  contentRef.current = content;

  // Handle server messages
  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === "extraction_prompt_content") {
      setContent(lastMessage.content);
      setOriginalContent(lastMessage.content);
      setIsOverride(lastMessage.isOverride);
      setIsLoading(false);
      setError(null);
    } else if (lastMessage.type === "extraction_prompt_saved") {
      setIsSaving(false);
      if (lastMessage.success) {
        // Update original content to match current content
        setOriginalContent(contentRef.current);
        setIsOverride(lastMessage.isOverride);
        setError(null);
      } else {
        setError(lastMessage.error ?? "Failed to save extraction prompt");
      }
    } else if (lastMessage.type === "extraction_prompt_reset") {
      setIsResetting(false);
      if (lastMessage.success) {
        setContent(lastMessage.content);
        setOriginalContent(lastMessage.content);
        setIsOverride(false);
        setIsLoading(false);
        setError(null);
      } else {
        setError(lastMessage.error ?? "Failed to reset extraction prompt");
      }
    } else if (lastMessage.type === "error") {
      setIsLoading(false);
      setIsSaving(false);
      setIsResetting(false);
      setError(lastMessage.message);
    } else if (lastMessage.type === "extraction_status") {
      setExtractionStatus(lastMessage.status);
      setExtractionMessage(lastMessage.message ?? null);
      if (lastMessage.status === "error" && lastMessage.error) {
        setError(lastMessage.error);
      }
      // Clear success message after a delay
      if (lastMessage.status === "complete") {
        setTimeout(() => {
          setExtractionStatus("idle");
          setExtractionMessage(null);
        }, 5000);
      }
    }
  }, [lastMessage]);

  // Handle content change
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setContent(e.target.value);
      setError(null);
    },
    []
  );

  // Handle save
  const handleSave = useCallback(() => {
    if (isSaving || isResetting) return;
    setIsSaving(true);
    setError(null);
    sendMessage({ type: "save_extraction_prompt", content });
  }, [sendMessage, content, isSaving, isResetting]);

  // Handle reset to default
  const handleReset = useCallback(() => {
    if (isSaving || isResetting) return;
    setIsResetting(true);
    setError(null);
    sendMessage({ type: "reset_extraction_prompt" });
  }, [sendMessage, isSaving, isResetting]);

  // Handle discard changes (revert to original)
  const handleDiscard = useCallback(() => {
    setContent(originalContent);
    setError(null);
  }, [originalContent]);

  // Handle run extraction
  const handleRunExtraction = useCallback(() => {
    if (extractionStatus === "running") return;
    setError(null);
    setExtractionMessage(null);
    sendMessage({ type: "trigger_extraction" });
  }, [sendMessage, extractionStatus]);

  return (
    <div className="prompt-editor">
      {/* Header with info */}
      <div className="prompt-editor__header">
        <div className="prompt-editor__info">
          <span className="prompt-editor__label">
            Extraction Prompt
            {isOverride && !isLoading && (
              <span className="prompt-editor__badge prompt-editor__badge--override">
                Custom
              </span>
            )}
            {!isOverride && !isLoading && (
              <span className="prompt-editor__badge prompt-editor__badge--default">
                Default
              </span>
            )}
          </span>
          <span className="prompt-editor__path">
            {isOverride
              ? "~/.config/memory-loop/durable-facts.md"
              : "Built-in default prompt"}
          </span>
        </div>
      </div>

      {/* Description */}
      <p className="prompt-editor__description">
        This prompt instructs Claude how to extract facts from your meeting transcripts.
        Modify it to customize what types of information are captured.
      </p>

      {/* Editor area */}
      <div className="prompt-editor__content">
        {isLoading ? (
          <div className="prompt-editor__loading">
            <div className="prompt-editor__spinner" />
            <span>Loading extraction prompt...</span>
          </div>
        ) : (
          <textarea
            className="prompt-editor__textarea"
            value={content}
            onChange={handleChange}
            placeholder="Enter extraction prompt..."
            spellCheck={false}
          />
        )}
      </div>

      {/* Extraction section */}
      <div className="prompt-editor__extraction">
        <div className="prompt-editor__extraction-header">
          <span className="prompt-editor__extraction-label">Manual Extraction</span>
          <button
            type="button"
            className={`prompt-editor__btn prompt-editor__btn--extract${extractionStatus === "running" ? " prompt-editor__btn--loading" : ""}`}
            onClick={handleRunExtraction}
            disabled={extractionStatus === "running" || isLoading}
            aria-busy={extractionStatus === "running"}
          >
            {extractionStatus === "running" ? "Running..." : "Run Extraction"}
          </button>
        </div>
        {extractionMessage && (
          <div
            className={`prompt-editor__extraction-status prompt-editor__extraction-status--${extractionStatus}`}
            role="status"
          >
            {extractionMessage}
          </div>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="prompt-editor__error" role="alert">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="prompt-editor__actions">
        {isOverride && (
          <button
            type="button"
            className="prompt-editor__btn prompt-editor__btn--reset"
            onClick={handleReset}
            disabled={isSaving || isResetting}
          >
            {isResetting ? "Resetting..." : "Reset to Default"}
          </button>
        )}
        <button
          type="button"
          className="prompt-editor__btn prompt-editor__btn--discard"
          onClick={handleDiscard}
          disabled={!hasChanges || isSaving || isResetting}
        >
          Discard
        </button>
        <button
          type="button"
          className={`prompt-editor__btn prompt-editor__btn--save${isSaving ? " prompt-editor__btn--loading" : ""}`}
          onClick={handleSave}
          disabled={!hasChanges || isSaving || isResetting}
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
