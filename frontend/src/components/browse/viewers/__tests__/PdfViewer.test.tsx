/**
 * PdfViewer Component Tests
 */

import { describe, expect, it, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PdfViewer } from "../PdfViewer";

afterEach(() => {
  cleanup();
});

describe("PdfViewer", () => {
  const defaultProps = {
    path: "documents/report.pdf",
    assetBaseUrl: "/vault/test-vault/assets",
  };

  describe("basic rendering", () => {
    it("displays the filename in the header", () => {
      render(<PdfViewer {...defaultProps} />);

      expect(screen.getByText("report.pdf")).toBeDefined();
    });

    it("extracts filename from nested path", () => {
      render(<PdfViewer path="deep/nested/path/manual.pdf" assetBaseUrl="/vault/v1/assets" />);

      expect(screen.getByText("manual.pdf")).toBeDefined();
    });

    it("renders PDF object with correct URL", () => {
      render(<PdfViewer {...defaultProps} />);

      const pdfObject = document.querySelector(".pdf-viewer__object");
      expect(pdfObject).toBeDefined();
      expect(pdfObject?.getAttribute("data")).toBe("/vault/test-vault/assets/documents/report.pdf");
    });

    it("has correct aria-label on PDF object", () => {
      render(<PdfViewer {...defaultProps} />);

      const pdfObject = document.querySelector(".pdf-viewer__object");
      expect(pdfObject?.getAttribute("aria-label")).toBe("PDF document: report.pdf");
    });
  });

  describe("download button", () => {
    it("renders download button with correct href", () => {
      render(<PdfViewer {...defaultProps} />);

      // Use the header download button (not the fallback one)
      const downloadBtn = document.querySelector(".pdf-viewer__download-btn");
      expect(downloadBtn).toBeDefined();
      expect(downloadBtn?.getAttribute("href")).toBe("/vault/test-vault/assets/documents/report.pdf");
      expect(downloadBtn?.getAttribute("download")).toBe("report.pdf");
    });
  });

  describe("fallback content", () => {
    it("renders fallback link inside object tag", () => {
      render(<PdfViewer {...defaultProps} />);

      const fallbackLink = document.querySelector(".pdf-viewer__fallback-link");
      expect(fallbackLink).toBeDefined();
      expect(fallbackLink?.getAttribute("href")).toBe("/vault/test-vault/assets/documents/report.pdf");
    });
  });

  describe("mobile menu button", () => {
    it("does not render mobile menu button when onMobileMenuClick is not provided", () => {
      render(<PdfViewer {...defaultProps} />);

      const menuBtn = screen.queryByRole("button", { name: /open file browser/i });
      expect(menuBtn).toBeNull();
    });

    it("renders mobile menu button when onMobileMenuClick is provided", () => {
      const handleClick = () => {};
      render(<PdfViewer {...defaultProps} onMobileMenuClick={handleClick} />);

      const menuBtn = screen.getByRole("button", { name: /open file browser/i });
      expect(menuBtn).toBeDefined();
    });

    it("calls onMobileMenuClick when mobile menu button is clicked", () => {
      let clicked = false;
      const handleClick = () => {
        clicked = true;
      };
      render(<PdfViewer {...defaultProps} onMobileMenuClick={handleClick} />);

      const menuBtn = screen.getByRole("button", { name: /open file browser/i });
      fireEvent.click(menuBtn);

      expect(clicked).toBe(true);
    });
  });

  describe("URL encoding", () => {
    it("encodes special characters in path", () => {
      render(<PdfViewer path="docs/my report (final).pdf" assetBaseUrl="/vault/v1/assets" />);

      const pdfObject = document.querySelector(".pdf-viewer__object");
      expect(pdfObject?.getAttribute("data")).toBe("/vault/v1/assets/docs/my%20report%20(final).pdf");
    });
  });
});
