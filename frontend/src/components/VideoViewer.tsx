/**
 * VideoViewer Component
 *
 * Displays a video from the vault using the asset serving endpoint.
 * Handles loading states and errors gracefully.
 */

import { useState, useCallback, useEffect, type ReactNode } from "react";
import { encodeAssetPath } from "../utils/file-types";
import "./VideoViewer.css";

export interface VideoViewerProps {
  /** Path to the video file relative to vault content root */
  path: string;
  /** Base URL for vault assets (e.g., /vault/{vaultId}/assets) */
  assetBaseUrl: string;
}

/**
 * VideoViewer renders a vault video with loading and error states.
 *
 * Uses the existing asset serving endpoint to fetch the video,
 * leveraging the same infrastructure used for embedded markdown images.
 */
export function VideoViewer({ path, assetBaseUrl }: VideoViewerProps): ReactNode {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Reset state when path changes (user navigates to different video)
  useEffect(() => {
    setIsLoading(true);
    setHasError(false);
  }, [path]);

  const videoUrl = `${assetBaseUrl}/${encodeAssetPath(path)}`;
  const fileName = path.split("/").pop() ?? path;

  const handleLoadedData = useCallback(() => {
    setIsLoading(false);
    setHasError(false);
  }, []);

  const handleError = useCallback(() => {
    setIsLoading(false);
    setHasError(true);
  }, []);

  return (
    <div className="video-viewer">
      <div className="video-viewer__header">
        <span className="video-viewer__filename">{fileName}</span>
      </div>

      <div className="video-viewer__container">
        {isLoading && !hasError && (
          <div className="video-viewer__loading" aria-label="Loading video">
            <div className="video-viewer__spinner" />
          </div>
        )}

        {hasError && (
          <div className="video-viewer__error" role="alert">
            <p>Failed to load video</p>
            <p className="video-viewer__error-path">{path}</p>
          </div>
        )}

        <video
          src={videoUrl}
          className={`video-viewer__video ${isLoading ? "video-viewer__video--loading" : ""}`}
          onLoadedData={handleLoadedData}
          onError={handleError}
          controls
          playsInline
        >
          Your browser does not support the video tag.
        </video>
      </div>
    </div>
  );
}
