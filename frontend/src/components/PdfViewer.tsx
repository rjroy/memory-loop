/**
 * PdfViewer Component
 *
 * Displays a PDF from the vault using the browser's native PDF viewer.
 * Uses <object> tag with fallback for browsers without PDF support.
 */

import { type ReactNode } from "react";
import { encodeAssetPath } from "../utils/file-types";
import "./PdfViewer.css";

export interface PdfViewerProps {
  /** Path to the PDF file relative to vault content root */
  path: string;
  /** Base URL for vault assets (e.g., /vault/{vaultId}/assets) */
  assetBaseUrl: string;
  /** Callback to open mobile file browser (only shown on mobile) */
  onMobileMenuClick?: () => void;
}

/**
 * PdfViewer renders a vault PDF using the browser's native viewer.
 *
 * Uses <object> tag which allows fallback content if the browser
 * cannot render PDFs inline.
 */
export function PdfViewer({ path, assetBaseUrl, onMobileMenuClick }: PdfViewerProps): ReactNode {
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
