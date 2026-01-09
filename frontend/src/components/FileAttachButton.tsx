/**
 * FileAttachButton Component
 *
 * Button for attaching files to discussion messages.
 * Opens file picker with camera capture support on mobile for images.
 */

import React, { useRef, useCallback } from "react";
import { useSession } from "../contexts/SessionContext";
import { useFileUpload } from "../hooks/useFileUpload";
import "./FileAttachButton.css";

/**
 * Props for the FileAttachButton component.
 */
export interface FileAttachButtonProps {
  /** Callback when file is uploaded successfully with the relative path */
  onFileUploaded: (path: string) => void;
  /** Whether the button should be disabled */
  disabled?: boolean;
}

/**
 * Accepted MIME types for the file input.
 * Includes images, videos, PDFs, and text-based files.
 */
const ACCEPTED_TYPES = [
  // Images
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/avif",
  "image/bmp",
  "image/x-icon",
  // Videos
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/ogg",
  "video/x-m4v",
  // Documents
  "application/pdf",
  // Text
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "application/json",
].join(",");

/**
 * Button that opens a file picker for various file types.
 * On mobile, also offers camera capture via the capture attribute for images.
 *
 * - Shows spinner during upload
 * - Calls onFileUploaded with the path on success
 * - Displays error state briefly on failure
 */
export function FileAttachButton({
  onFileUploaded,
  disabled = false,
}: FileAttachButtonProps): React.ReactNode {
  const inputRef = useRef<HTMLInputElement>(null);
  const { vault } = useSession();
  const { uploadFile, isUploading, error, clearError } = useFileUpload(vault?.id);

  const handleClick = useCallback(() => {
    if (inputRef.current) {
      // Reset value so selecting the same file triggers onChange
      inputRef.current.value = "";
      inputRef.current.click();
    }
  }, []);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const path = await uploadFile(file);
      if (path) {
        onFileUploaded(path);
      }
    },
    [uploadFile, onFileUploaded]
  );

  // Clear error after display
  React.useEffect(() => {
    if (error) {
      const timer = setTimeout(clearError, 3000);
      return () => clearTimeout(timer);
    }
  }, [error, clearError]);

  const buttonDisabled = disabled || isUploading || !vault;

  return (
    <div className="file-attach">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        className="file-attach__input"
        onChange={(e) => void handleFileChange(e)}
        disabled={buttonDisabled}
        aria-hidden="true"
        tabIndex={-1}
      />
      <button
        type="button"
        className={`file-attach__button ${error ? "file-attach__button--error" : ""}`}
        onClick={handleClick}
        disabled={buttonDisabled}
        aria-label="Attach file"
        title={error || "Attach file"}
      >
        {isUploading ? (
          <span className="file-attach__spinner" aria-label="Uploading" />
        ) : (
          <svg
            className="file-attach__icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {/* Paperclip icon - more generic for file attachments */}
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        )}
      </button>
    </div>
  );
}
