/**
 * DownloadViewer Component
 *
 * Displays a download option for file types that don't have a dedicated viewer.
 * Provides a simple interface with file info and download button.
 */

import type { ReactNode } from "react";
import { encodeAssetPath } from "../../../utils/file-types";
import "./DownloadViewer.css";

export interface DownloadViewerProps {
  /** Path to the file relative to vault content root */
  path: string;
  /** Base URL for vault assets (e.g., /vault/{vaultId}/assets) */
  assetBaseUrl: string;
  /** Callback to open mobile file browser (only shown on mobile) */
  onMobileMenuClick?: () => void;
  /** Callback to delete the current file */
  onDelete?: () => void;
}

/**
 * DownloadViewer shows a download prompt for unsupported file types.
 *
 * Uses the existing asset serving endpoint to provide the download,
 * with the download attribute to trigger browser download behavior.
 */
export function DownloadViewer({ path, assetBaseUrl, onMobileMenuClick, onDelete }: DownloadViewerProps): ReactNode {
  const downloadUrl = `${assetBaseUrl}/${encodeAssetPath(path)}`;
  const fileName = path.split("/").pop() ?? path;
  const extension = fileName.includes(".") ? fileName.split(".").pop()?.toUpperCase() : "FILE";

  return (
    <div className="download-viewer">
      <div className="download-viewer__header">
        {onMobileMenuClick && (
          <button
            type="button"
            className="viewer-mobile-menu-btn"
            onClick={onMobileMenuClick}
            aria-label="Open file browser"
          >
            <svg
              className="viewer-mobile-menu-btn__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        )}
        <span className="download-viewer__path">{fileName}</span>
        {onDelete && (
          <button
            type="button"
            className="download-viewer__delete-btn"
            onClick={onDelete}
            aria-label="Delete file"
          >
            <TrashIcon />
          </button>
        )}
      </div>
      <div className="download-viewer__content">
        <div className="download-viewer__icon" aria-hidden="true">
          <FileIcon />
        </div>
        <p className="download-viewer__message">
          No preview available for {extension} files
        </p>
        <a
          href={downloadUrl}
          download={fileName}
          className="download-viewer__button"
        >
          Download File
        </a>
      </div>
    </div>
  );
}

/**
 * Generic file icon for unsupported file types.
 */
function FileIcon(): ReactNode {
  return (
    <svg
      className="download-viewer__file-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  );
}

/**
 * Trash icon for delete button.
 */
function TrashIcon(): ReactNode {
  return (
    <svg
      className="download-viewer__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}
