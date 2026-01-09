/**
 * ImageViewer Component
 *
 * Displays an image from the vault using the asset serving endpoint.
 * Handles loading states and errors gracefully.
 */

import { useState, useCallback, useEffect, type ReactNode } from "react";
import "./ImageViewer.css";

export interface ImageViewerProps {
  /** Path to the image file relative to vault content root */
  path: string;
  /** Base URL for vault assets (e.g., /vault/{vaultId}/assets) */
  assetBaseUrl: string;
}

/**
 * ImageViewer renders a vault image with loading and error states.
 *
 * Uses the existing asset serving endpoint to fetch the image,
 * leveraging the same infrastructure used for embedded markdown images.
 */
export function ImageViewer({ path, assetBaseUrl }: ImageViewerProps): ReactNode {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Reset state when path changes (user navigates to different image)
  useEffect(() => {
    setIsLoading(true);
    setHasError(false);
  }, [path]);

  const imageUrl = `${assetBaseUrl}/${path}`;
  const fileName = path.split("/").pop() ?? path;

  const handleLoad = useCallback(() => {
    setIsLoading(false);
    setHasError(false);
  }, []);

  const handleError = useCallback(() => {
    setIsLoading(false);
    setHasError(true);
  }, []);

  return (
    <div className="image-viewer">
      <div className="image-viewer__header">
        <span className="image-viewer__filename">{fileName}</span>
      </div>

      <div className="image-viewer__container">
        {isLoading && !hasError && (
          <div className="image-viewer__loading" aria-label="Loading image">
            <div className="image-viewer__spinner" />
          </div>
        )}

        {hasError && (
          <div className="image-viewer__error" role="alert">
            <p>Failed to load image</p>
            <p className="image-viewer__error-path">{path}</p>
          </div>
        )}

        <img
          src={imageUrl}
          alt={fileName}
          className={`image-viewer__image ${isLoading ? "image-viewer__image--loading" : ""}`}
          onLoad={handleLoad}
          onError={handleError}
        />
      </div>
    </div>
  );
}
