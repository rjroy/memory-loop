/**
 * CardGeneratorEditor Component
 *
 * Editor for the card generator configuration.
 * Features:
 * - Textarea for viewing/editing the requirements prompt
 * - Slider for weekly byte limit (100KB - 10MB)
 * - Usage display showing current week's bytes used
 * - Run Generator button to manually trigger generation
 * - Indicator showing if user override is active
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { ClientMessage, ServerMessage } from "@memory-loop/shared";
import "./CardGeneratorEditor.css";

/**
 * Props for the CardGeneratorEditor component.
 */
export interface CardGeneratorEditorProps {
  /** Function to send WebSocket messages */
  sendMessage: (message: ClientMessage) => void;
  /** Last received server message (for handling responses) */
  lastMessage: ServerMessage | null;
}

/**
 * Format bytes as human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * CardGeneratorEditor Component
 *
 * Provides an interface for configuring the card generator.
 */
export function CardGeneratorEditor({
  sendMessage,
  lastMessage,
}: CardGeneratorEditorProps): React.ReactNode {
  // Requirements state
  const [requirements, setRequirements] = useState("");
  const [originalRequirements, setOriginalRequirements] = useState("");
  const [isOverride, setIsOverride] = useState(false);

  // Config state
  const [weeklyByteLimit, setWeeklyByteLimit] = useState(512000); // 500KB default
  const [originalByteLimit, setOriginalByteLimit] = useState(512000);
  const [weeklyBytesUsed, setWeeklyBytesUsed] = useState(0);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [pendingSaves, setPendingSaves] = useState(0);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derived saving state
  const isSaving = pendingSaves > 0;

  // Generation status state
  const [generationStatus, setGenerationStatus] = useState<
    "idle" | "running" | "complete" | "error"
  >("idle");
  const [generationMessage, setGenerationMessage] = useState<string | null>(null);

  // Track if we've requested the content
  const hasRequestedRef = useRef(false);

  // Calculate if there are unsaved changes
  const hasRequirementsChanges = requirements !== originalRequirements;
  const hasConfigChanges = weeklyByteLimit !== originalByteLimit;
  const hasChanges = hasRequirementsChanges || hasConfigChanges;

  // Request config on mount
  useEffect(() => {
    if (!hasRequestedRef.current) {
      hasRequestedRef.current = true;
      sendMessage({ type: "get_card_generator_config" });
    }
  }, [sendMessage]);

  // Ref to track current state for save callbacks
  const requirementsRef = useRef(requirements);
  requirementsRef.current = requirements;
  const byteLimitRef = useRef(weeklyByteLimit);
  byteLimitRef.current = weeklyByteLimit;

  // Handle server messages
  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === "card_generator_config_content") {
      setRequirements(lastMessage.requirements);
      setOriginalRequirements(lastMessage.requirements);
      setIsOverride(lastMessage.isOverride);
      setWeeklyByteLimit(lastMessage.weeklyByteLimit);
      setOriginalByteLimit(lastMessage.weeklyByteLimit);
      setWeeklyBytesUsed(lastMessage.weeklyBytesUsed);
      setIsLoading(false);
      setError(null);
    } else if (lastMessage.type === "card_generator_requirements_saved") {
      setPendingSaves((prev) => Math.max(0, prev - 1));
      if (lastMessage.success) {
        setOriginalRequirements(requirementsRef.current);
        setIsOverride(lastMessage.isOverride);
        setError(null);
      } else {
        setError(lastMessage.error ?? "Failed to save requirements");
      }
    } else if (lastMessage.type === "card_generator_config_saved") {
      setPendingSaves((prev) => Math.max(0, prev - 1));
      if (lastMessage.success) {
        setOriginalByteLimit(byteLimitRef.current);
        setError(null);
      } else {
        setError(lastMessage.error ?? "Failed to save config");
      }
    } else if (lastMessage.type === "card_generator_requirements_reset") {
      setIsResetting(false);
      if (lastMessage.success) {
        setRequirements(lastMessage.content);
        setOriginalRequirements(lastMessage.content);
        setIsOverride(false);
        setError(null);
      } else {
        setError(lastMessage.error ?? "Failed to reset requirements");
      }
    } else if (lastMessage.type === "card_generation_status") {
      setGenerationStatus(lastMessage.status);
      setGenerationMessage(lastMessage.message ?? null);
      if (lastMessage.status === "error" && lastMessage.error) {
        setError(lastMessage.error);
      }
      // Update bytes used on completion
      if (lastMessage.status === "complete" && lastMessage.bytesProcessed !== undefined) {
        const bytesProcessed = lastMessage.bytesProcessed;
        setWeeklyBytesUsed((prev) => prev + bytesProcessed);
      }
      // Clear success message after a delay
      if (lastMessage.status === "complete") {
        setTimeout(() => {
          setGenerationStatus("idle");
          setGenerationMessage(null);
        }, 5000);
      }
    } else if (lastMessage.type === "error") {
      setIsLoading(false);
      setPendingSaves(0);
      setIsResetting(false);
      setError(lastMessage.message);
    }
  }, [lastMessage]);

  // Handle requirements change
  const handleRequirementsChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setRequirements(e.target.value);
      setError(null);
    },
    []
  );

  // Handle byte limit change
  const handleByteLimitChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = parseInt(e.target.value, 10);
      setWeeklyByteLimit(value);
      setError(null);
    },
    []
  );

  // Handle save
  const handleSave = useCallback(() => {
    if (isSaving || isResetting) return;
    setError(null);

    let savesStarted = 0;

    // Save requirements if changed
    if (hasRequirementsChanges) {
      sendMessage({ type: "save_card_generator_requirements", content: requirements });
      savesStarted++;
    }

    // Save config if changed
    if (hasConfigChanges) {
      sendMessage({ type: "save_card_generator_config", weeklyByteLimit });
      savesStarted++;
    }

    if (savesStarted > 0) {
      setPendingSaves(savesStarted);
    }
  }, [sendMessage, requirements, weeklyByteLimit, hasRequirementsChanges, hasConfigChanges, isSaving, isResetting]);

  // Handle reset requirements to default
  const handleResetRequirements = useCallback(() => {
    if (isSaving || isResetting) return;
    setIsResetting(true);
    setError(null);
    sendMessage({ type: "reset_card_generator_requirements" });
  }, [sendMessage, isSaving, isResetting]);

  // Handle discard changes (revert to original)
  const handleDiscard = useCallback(() => {
    setRequirements(originalRequirements);
    setWeeklyByteLimit(originalByteLimit);
    setError(null);
  }, [originalRequirements, originalByteLimit]);

  // Handle run generation
  const handleRunGeneration = useCallback(() => {
    if (generationStatus === "running") return;
    setError(null);
    setGenerationMessage(null);
    sendMessage({ type: "trigger_card_generation" });
  }, [sendMessage, generationStatus]);

  // Calculate usage percentage
  const usagePercent = Math.min(100, Math.round((100 * weeklyBytesUsed) / weeklyByteLimit));
  const remainingBytes = Math.max(0, weeklyByteLimit - weeklyBytesUsed);

  return (
    <div className="card-generator-editor">
      {/* Header with info */}
      <div className="card-generator-editor__header">
        <div className="card-generator-editor__info">
          <span className="card-generator-editor__label">
            Card Generator Requirements
            {isOverride && !isLoading && (
              <span className="card-generator-editor__badge card-generator-editor__badge--override">
                Custom
              </span>
            )}
            {!isOverride && !isLoading && (
              <span className="card-generator-editor__badge card-generator-editor__badge--default">
                Default
              </span>
            )}
          </span>
          <span className="card-generator-editor__path">
            {isOverride
              ? "~/.config/memory-loop/card-generator-requirements.md"
              : "Built-in default requirements"}
          </span>
        </div>
      </div>

      {/* Description */}
      <p className="card-generator-editor__description">
        These requirements instruct Claude how to extract Q&A pairs from your notes.
        Modify them to customize what types of flashcards are generated.
      </p>

      {/* Editor area */}
      <div className="card-generator-editor__content">
        {isLoading ? (
          <div className="card-generator-editor__loading">
            <div className="card-generator-editor__spinner" />
            <span>Loading configuration...</span>
          </div>
        ) : (
          <textarea
            className="card-generator-editor__textarea"
            value={requirements}
            onChange={handleRequirementsChange}
            placeholder="Enter card generation requirements..."
            spellCheck={false}
          />
        )}
      </div>

      {/* Weekly limit section */}
      <div className="card-generator-editor__config">
        <div className="card-generator-editor__config-header">
          <span className="card-generator-editor__config-label">Weekly Byte Limit</span>
          <span className="card-generator-editor__config-value">{formatBytes(weeklyByteLimit)}</span>
        </div>
        <input
          type="range"
          className="card-generator-editor__slider"
          min={102400}
          max={10485760}
          step={102400}
          value={weeklyByteLimit}
          onChange={handleByteLimitChange}
          disabled={isLoading}
        />
        <div className="card-generator-editor__usage">
          <div className="card-generator-editor__usage-bar">
            <div
              className="card-generator-editor__usage-fill"
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          <span className="card-generator-editor__usage-text">
            Used: {formatBytes(weeklyBytesUsed)} of {formatBytes(weeklyByteLimit)} ({usagePercent}%)
          </span>
        </div>
      </div>

      {/* Generation section */}
      <div className="card-generator-editor__generation">
        <div className="card-generator-editor__generation-header">
          <span className="card-generator-editor__generation-label">Manual Generation</span>
          <button
            type="button"
            className={`card-generator-editor__btn card-generator-editor__btn--run${generationStatus === "running" ? " card-generator-editor__btn--loading" : ""}`}
            onClick={handleRunGeneration}
            disabled={generationStatus === "running" || isLoading || remainingBytes <= 0}
            aria-busy={generationStatus === "running"}
          >
            {generationStatus === "running" ? "Running..." : "Run Generator"}
          </button>
        </div>
        {remainingBytes <= 0 && (
          <div className="card-generator-editor__generation-warning">
            Weekly byte limit reached. Increase the limit or wait until next week.
          </div>
        )}
        {generationMessage && (
          <div
            className={`card-generator-editor__generation-status card-generator-editor__generation-status--${generationStatus}`}
            role="status"
          >
            {generationMessage}
          </div>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="card-generator-editor__error" role="alert">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="card-generator-editor__actions">
        {isOverride && (
          <button
            type="button"
            className="card-generator-editor__btn card-generator-editor__btn--reset"
            onClick={handleResetRequirements}
            disabled={isSaving || isResetting}
          >
            {isResetting ? "Resetting..." : "Reset to Default"}
          </button>
        )}
        <button
          type="button"
          className="card-generator-editor__btn card-generator-editor__btn--discard"
          onClick={handleDiscard}
          disabled={!hasChanges || isSaving || isResetting}
        >
          Discard
        </button>
        <button
          type="button"
          className={`card-generator-editor__btn card-generator-editor__btn--save${isSaving ? " card-generator-editor__btn--loading" : ""}`}
          onClick={handleSave}
          disabled={!hasChanges || isSaving || isResetting}
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
