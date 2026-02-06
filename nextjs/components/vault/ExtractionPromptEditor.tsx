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
import "./ExtractionPromptEditor.css";

/**
 * ExtractionPromptEditor Component
 *
 * Provides an interface for viewing and editing the extraction prompt.
 * Shows whether the user has a custom override or is using the default.
 */
export function ExtractionPromptEditor(): React.ReactNode {
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

  // Load extraction prompt on mount
  useEffect(() => {
    if (hasRequestedRef.current) return;
    hasRequestedRef.current = true;

    async function loadPrompt() {
      try {
        const response = await fetch("/api/config/extraction-prompt");
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json() as { content: string; isOverride: boolean };
        setContent(data.content);
        setOriginalContent(data.content);
        setIsOverride(data.isOverride);
        setIsLoading(false);
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load extraction prompt";
        setError(message);
        setIsLoading(false);
      }
    }

    void loadPrompt();
  }, []);

  // Handle content change
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setContent(e.target.value);
      setError(null);
    },
    []
  );

  // Handle save
  const handleSave = useCallback(async () => {
    if (isSaving || isResetting) return;
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/config/extraction-prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await response.json() as { success: boolean; isOverride: boolean; error?: string };

      if (data.success) {
        setOriginalContent(content);
        setIsOverride(data.isOverride);
        setError(null);
      } else {
        setError(data.error ?? "Failed to save extraction prompt");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save extraction prompt";
      setError(message);
    } finally {
      setIsSaving(false);
    }
  }, [content, isSaving, isResetting]);

  // Handle reset to default
  const handleReset = useCallback(async () => {
    if (isSaving || isResetting) return;
    setIsResetting(true);
    setError(null);

    try {
      const response = await fetch("/api/config/extraction-prompt", {
        method: "DELETE",
      });
      const data = await response.json() as { success: boolean; content: string; error?: string };

      if (data.success) {
        setContent(data.content);
        setOriginalContent(data.content);
        setIsOverride(false);
        setError(null);
      } else {
        setError(data.error ?? "Failed to reset extraction prompt");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to reset extraction prompt";
      setError(message);
    } finally {
      setIsResetting(false);
    }
  }, [isSaving, isResetting]);

  // Handle discard changes (revert to original)
  const handleDiscard = useCallback(() => {
    setContent(originalContent);
    setError(null);
  }, [originalContent]);

  // Handle run extraction
  const handleRunExtraction = useCallback(async () => {
    if (extractionStatus === "running") return;
    setError(null);
    setExtractionMessage("Starting extraction...");
    setExtractionStatus("running");

    try {
      const response = await fetch("/api/config/extraction-prompt/trigger", {
        method: "POST",
      });
      const data = await response.json() as {
        status: "running" | "complete" | "error";
        message?: string;
        error?: string;
        transcriptsProcessed?: number;
      };

      setExtractionStatus(data.status);
      setExtractionMessage(data.message ?? null);

      if (data.status === "error" && data.error) {
        setError(data.error);
      }

      // Clear success message after a delay
      if (data.status === "complete") {
        setTimeout(() => {
          setExtractionStatus("idle");
          setExtractionMessage(null);
        }, 5000);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Extraction failed";
      setError(message);
      setExtractionStatus("error");
      setExtractionMessage("Extraction failed unexpectedly");
    }
  }, [extractionStatus]);

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
            onClick={() => void handleRunExtraction()}
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
            onClick={() => void handleReset()}
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
          onClick={() => void handleSave()}
          disabled={!hasChanges || isSaving || isResetting}
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
