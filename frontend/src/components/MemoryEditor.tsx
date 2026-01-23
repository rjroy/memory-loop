/**
 * MemoryEditor Component
 *
 * Editor for the memory.md file used by Claude for context injection.
 * Features:
 * - Textarea for editing content
 * - Size indicator showing current/max bytes
 * - Save button with loading state
 * - Error handling and display
 *
 * Spec Requirements:
 * - REQ-F-12: View memory.md
 * - REQ-F-13: Edit memory.md
 * - REQ-NF-1: Enforce 50KB memory file limit
 */

/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises */
// REST API calls in useEffect and button handlers

import { useState, useCallback, useEffect, useRef } from "react";
import { useMemory } from "../hooks/useMemory";
import "./MemoryEditor.css";

/**
 * Maximum memory file size in bytes (50KB).
 */
const MAX_MEMORY_SIZE = 50 * 1024;

/**
 * Warning threshold for memory file size (45KB = 90% of max).
 */
const WARNING_THRESHOLD = 45 * 1024;

/**
 * MemoryEditor Component
 *
 * Provides an interface for viewing and editing the memory.md file.
 * The content is loaded from the server on mount and can be saved back.
 * Uses REST API via useMemory hook. Memory is user-global, not vault-scoped.
 */
export function MemoryEditor(): React.ReactNode {
  // REST API hook for memory operations
  const { getMemory, saveMemory, isLoading: apiLoading, error: apiError } = useMemory();

  // State
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setSizeBytes] = useState(0);
  const [fileExists, setFileExists] = useState(false);

  // Track if we've loaded the content
  const hasLoadedRef = useRef(false);

  // Calculate current content size
  const currentSize = new TextEncoder().encode(content).length;
  const sizePercentage = Math.min((currentSize / MAX_MEMORY_SIZE) * 100, 100);
  const isOverLimit = currentSize > MAX_MEMORY_SIZE;
  const isWarning = currentSize >= WARNING_THRESHOLD && !isOverLimit;
  const hasChanges = content !== originalContent;

  // Load memory content on mount via REST API
  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      getMemory().then((result) => {
        if (result) {
          setContent(result.content);
          setOriginalContent(result.content);
          setSizeBytes(result.sizeBytes);
          setFileExists(result.exists);
        }
        setIsLoading(false);
      });
    }
  }, [getMemory]);

  // Update error state from API error
  useEffect(() => {
    if (apiError) {
      setError(apiError);
      setIsLoading(false);
      setIsSaving(false);
    }
  }, [apiError]);

  // Ref to track current content for save callback
  const contentRef = useRef(content);
  contentRef.current = content;

  // Handle content change
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setContent(e.target.value);
      setError(null); // Clear error on edit
    },
    []
  );

  // Handle save via REST API
  const handleSave = useCallback(async () => {
    if (isSaving || isOverLimit) return;
    setIsSaving(true);
    setError(null);

    const success = await saveMemory(content);

    setIsSaving(false);
    if (success) {
      // Update original content to match current content (use ref to avoid stale closure)
      setOriginalContent(contentRef.current);
      setSizeBytes(new TextEncoder().encode(contentRef.current).length);
      setFileExists(true);
      setError(null);
    } else {
      setError(apiError ?? "Failed to save memory file");
    }
  }, [saveMemory, content, isSaving, isOverLimit, apiError]);

  // Handle reset to original
  const handleReset = useCallback(() => {
    setContent(originalContent);
    setError(null);
  }, [originalContent]);

  // Format bytes for display
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div className="memory-editor">
      {/* Header with info */}
      <div className="memory-editor__header">
        <div className="memory-editor__info">
          <span className="memory-editor__label">
            Memory File
            {!fileExists && !isLoading && (
              <span className="memory-editor__badge memory-editor__badge--new">
                New
              </span>
            )}
          </span>
          <span className="memory-editor__path">~/.claude/rules/memory.md</span>
        </div>
      </div>

      {/* Size indicator */}
      <div className="memory-editor__size-container">
        <div className="memory-editor__size-bar">
          <div
            className={`memory-editor__size-fill${isOverLimit ? " memory-editor__size-fill--error" : isWarning ? " memory-editor__size-fill--warning" : ""}`}
            style={{ width: `${sizePercentage}%` }}
          />
        </div>
        <div className="memory-editor__size-text">
          <span
            className={`memory-editor__size-current${isOverLimit ? " memory-editor__size-current--error" : isWarning ? " memory-editor__size-current--warning" : ""}`}
          >
            {formatBytes(currentSize)}
          </span>
          <span className="memory-editor__size-separator">/</span>
          <span className="memory-editor__size-max">
            {formatBytes(MAX_MEMORY_SIZE)}
          </span>
        </div>
      </div>

      {/* Editor area */}
      <div className="memory-editor__content">
        {isLoading || apiLoading ? (
          <div className="memory-editor__loading">
            <div className="memory-editor__spinner" />
            <span>Loading memory file...</span>
          </div>
        ) : (
          <textarea
            className="memory-editor__textarea"
            value={content}
            onChange={handleChange}
            placeholder="# Memory&#10;&#10;Add facts about yourself that Claude should remember..."
            spellCheck={false}
          />
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="memory-editor__error" role="alert">
          {error}
        </div>
      )}

      {/* Over limit warning */}
      {isOverLimit && (
        <div className="memory-editor__warning" role="alert">
          Content exceeds 50KB limit. Reduce content before saving.
        </div>
      )}

      {/* Actions */}
      <div className="memory-editor__actions">
        <button
          type="button"
          className="memory-editor__btn memory-editor__btn--reset"
          onClick={handleReset}
          disabled={!hasChanges || isSaving}
        >
          Reset
        </button>
        <button
          type="button"
          className={`memory-editor__btn memory-editor__btn--save${isSaving ? " memory-editor__btn--loading" : ""}`}
          onClick={handleSave}
          disabled={!hasChanges || isSaving || isOverLimit}
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
