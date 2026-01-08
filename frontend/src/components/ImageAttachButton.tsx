/**
 * ImageAttachButton Component
 *
 * Button for attaching images to discussion messages.
 * Opens file picker with camera capture support on mobile.
 */

import React, { useRef, useCallback } from "react";
import { useSession } from "../contexts/SessionContext";
import { useImageUpload } from "../hooks/useImageUpload";
import "./ImageAttachButton.css";

/**
 * Props for the ImageAttachButton component.
 */
export interface ImageAttachButtonProps {
  /** Callback when image is uploaded successfully with the relative path */
  onImageUploaded: (path: string) => void;
  /** Whether the button should be disabled */
  disabled?: boolean;
}

/**
 * Accepted image MIME types for the file input.
 */
const ACCEPTED_TYPES = "image/png,image/jpeg,image/gif,image/webp";

/**
 * Button that opens a file picker for images.
 * On mobile, also offers camera capture via the capture attribute.
 *
 * - Shows spinner during upload
 * - Calls onImageUploaded with the path on success
 * - Displays error state briefly on failure
 */
export function ImageAttachButton({
  onImageUploaded,
  disabled = false,
}: ImageAttachButtonProps): React.ReactNode {
  const inputRef = useRef<HTMLInputElement>(null);
  const { vault } = useSession();
  const { uploadImage, isUploading, error, clearError } = useImageUpload(vault?.id);

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

      const path = await uploadImage(file);
      if (path) {
        onImageUploaded(path);
      }
    },
    [uploadImage, onImageUploaded]
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
    <div className="image-attach">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        capture="environment"
        className="image-attach__input"
        onChange={(e) => void handleFileChange(e)}
        disabled={buttonDisabled}
        aria-hidden="true"
        tabIndex={-1}
      />
      <button
        type="button"
        className={`image-attach__button ${error ? "image-attach__button--error" : ""}`}
        onClick={handleClick}
        disabled={buttonDisabled}
        aria-label="Attach image"
        title={error || "Attach image"}
      >
        {isUploading ? (
          <span className="image-attach__spinner" aria-label="Uploading" />
        ) : (
          <svg
            className="image-attach__icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {/* Camera icon */}
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        )}
      </button>
    </div>
  );
}
