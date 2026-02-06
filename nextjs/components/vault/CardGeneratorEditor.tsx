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
import "./CardGeneratorEditor.css";

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
export function CardGeneratorEditor(): React.ReactNode {
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
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Load config on mount
  useEffect(() => {
    if (hasRequestedRef.current) return;
    hasRequestedRef.current = true;

    async function loadConfig() {
      try {
        const response = await fetch("/api/config/card-generator");
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json() as {
          requirements: string;
          isOverride: boolean;
          weeklyByteLimit: number;
          weeklyBytesUsed: number;
        };
        setRequirements(data.requirements);
        setOriginalRequirements(data.requirements);
        setIsOverride(data.isOverride);
        setWeeklyByteLimit(data.weeklyByteLimit);
        setOriginalByteLimit(data.weeklyByteLimit);
        setWeeklyBytesUsed(data.weeklyBytesUsed);
        setIsLoading(false);
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load config";
        setError(message);
        setIsLoading(false);
      }
    }

    void loadConfig();
  }, []);

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
  const handleSave = useCallback(async () => {
    if (isSaving || isResetting) return;
    setIsSaving(true);
    setError(null);

    try {
      const body: { requirements?: string; weeklyByteLimit?: number } = {};
      if (hasRequirementsChanges) {
        body.requirements = requirements;
      }
      if (hasConfigChanges) {
        body.weeklyByteLimit = weeklyByteLimit;
      }

      const response = await fetch("/api/config/card-generator", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json() as {
        success: boolean;
        requirements: string;
        isOverride: boolean;
        weeklyByteLimit: number;
        weeklyBytesUsed: number;
        error?: string;
      };

      if (data.success) {
        setOriginalRequirements(data.requirements);
        setIsOverride(data.isOverride);
        setOriginalByteLimit(data.weeklyByteLimit);
        setWeeklyBytesUsed(data.weeklyBytesUsed);
        setError(null);
      } else {
        setError(data.error ?? "Failed to save config");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save config";
      setError(message);
    } finally {
      setIsSaving(false);
    }
  }, [requirements, weeklyByteLimit, hasRequirementsChanges, hasConfigChanges, isSaving, isResetting]);

  // Handle reset requirements to default
  const handleResetRequirements = useCallback(async () => {
    if (isSaving || isResetting) return;
    setIsResetting(true);
    setError(null);

    try {
      const response = await fetch("/api/config/card-generator/requirements", {
        method: "DELETE",
      });
      const data = await response.json() as { success: boolean; content: string; error?: string };

      if (data.success) {
        setRequirements(data.content);
        setOriginalRequirements(data.content);
        setIsOverride(false);
        setError(null);
      } else {
        setError(data.error ?? "Failed to reset requirements");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to reset requirements";
      setError(message);
    } finally {
      setIsResetting(false);
    }
  }, [isSaving, isResetting]);

  // Handle discard changes (revert to original)
  const handleDiscard = useCallback(() => {
    setRequirements(originalRequirements);
    setWeeklyByteLimit(originalByteLimit);
    setError(null);
  }, [originalRequirements, originalByteLimit]);

  // Handle run generation
  const handleRunGeneration = useCallback(async () => {
    if (generationStatus === "running") return;
    setError(null);
    setGenerationMessage("Starting card generation...");
    setGenerationStatus("running");

    try {
      const response = await fetch("/api/config/card-generator/trigger", {
        method: "POST",
      });
      const data = await response.json() as {
        status: "running" | "complete" | "error";
        message?: string;
        error?: string;
        filesProcessed?: number;
        cardsCreated?: number;
        bytesProcessed?: number;
      };

      setGenerationStatus(data.status);
      setGenerationMessage(data.message ?? null);

      if (data.status === "error" && data.error) {
        setError(data.error);
      }

      // Update bytes used on completion
      if (data.status === "complete" && data.bytesProcessed !== undefined) {
        setWeeklyBytesUsed((prev) => prev + data.bytesProcessed!);
      }

      // Clear success message after a delay
      if (data.status === "complete") {
        setTimeout(() => {
          setGenerationStatus("idle");
          setGenerationMessage(null);
        }, 5000);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Generation failed";
      setError(message);
      setGenerationStatus("error");
      setGenerationMessage("Generation failed unexpectedly");
    }
  }, [generationStatus]);

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
            onClick={() => void handleRunGeneration()}
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
            onClick={() => void handleResetRequirements()}
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
          onClick={() => void handleSave()}
          disabled={!hasChanges || isSaving || isResetting}
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
