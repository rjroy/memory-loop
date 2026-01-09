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
}

/**
 * PdfViewer renders a vault PDF using the browser's native viewer.
 *
 * Uses <object> tag which allows fallback content if the browser
 * cannot render PDFs inline.
 */
export function PdfViewer({ path, assetBaseUrl }: PdfViewerProps): ReactNode {
  const pdfUrl = `${assetBaseUrl}/${encodeAssetPath(path)}`;
  const fileName = path.split("/").pop() ?? path;

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer__header">
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
