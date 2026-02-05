/**
 * PdfViewer Component
 *
 * Displays a PDF from the vault using the browser's native PDF viewer.
 * Uses <object> tag with fallback for browsers without PDF support.
 */

import { type ReactNode } from "react";
import { encodeAssetPath } from "@/lib/utils/file-types";
import "./PdfViewer.css";

export interface PdfViewerProps {
  /** Path to the PDF file relative to vault content root */
  path: string;
  /** Base URL for vault assets (e.g., /vault/{vaultId}/assets) */
  assetBaseUrl: string;
  /** Callback to open mobile file browser (only shown on mobile) */
  onMobileMenuClick?: () => void;
  /** Callback to delete the current file */
  onDelete?: () => void;
}

/**
 * PdfViewer renders a vault PDF using the browser's native viewer.
 *
 * Uses <object> tag which allows fallback content if the browser
 * cannot render PDFs inline.
 */
export function PdfViewer({ path, assetBaseUrl, onMobileMenuClick, onDelete }: PdfViewerProps): ReactNode {
  const pdfUrl = `${assetBaseUrl}/${encodeAssetPath(path)}`;
  const fileName = path.split("/").pop() ?? path;

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer__header">
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
        <span className="pdf-viewer__filename">{fileName}</span>
        <a
          href={pdfUrl}
          download={fileName}
          className="pdf-viewer__download-btn"
          aria-label={`Download ${fileName}`}
        >
          Download
        </a>
        {onDelete && (
          <button
            type="button"
            className="pdf-viewer__delete-btn"
            onClick={onDelete}
            aria-label="Delete file"
          >
            <TrashIcon />
          </button>
        )}
      </div>

      <div className="pdf-viewer__container">
        <object
          data={pdfUrl}
          type="application/pdf"
          className="pdf-viewer__object"
          aria-label={`PDF document: ${fileName}`}
        >
          <div className="pdf-viewer__fallback">
            <p>Your browser cannot display PDFs inline.</p>
            <a href={pdfUrl} download={fileName} className="pdf-viewer__fallback-link">
              Download {fileName}
            </a>
          </div>
        </object>
      </div>
    </div>
  );
}

/**
 * Trash icon for delete button.
 */
function TrashIcon(): ReactNode {
  return (
    <svg
      className="pdf-viewer__icon"
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
