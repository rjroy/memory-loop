/**
 * DownloadViewer Component Tests
 */

import { describe, expect, it, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DownloadViewer } from "../DownloadViewer";

afterEach(() => {
  cleanup();
});

describe("DownloadViewer", () => {
  const defaultProps = {
    path: "attachments/document.docx",
    assetBaseUrl: "/vault/test-vault/assets",
  };

  it("renders the filename", () => {
    render(<DownloadViewer {...defaultProps} />);

    expect(screen.getByText("document.docx")).toBeDefined();
  });

  it("extracts filename from nested path", () => {
    render(<DownloadViewer path="deep/nested/archive.zip" assetBaseUrl="/vault/v1/assets" />);

    expect(screen.getByText("archive.zip")).toBeDefined();
  });

  it("shows file extension in message", () => {
    render(<DownloadViewer {...defaultProps} />);

    expect(screen.getByText("No preview available for DOCX files")).toBeDefined();
  });

  it("shows correct extension for different file types", () => {
    const { rerender } = render(
      <DownloadViewer path="data.xlsx" assetBaseUrl="/vault/v1/assets" />
    );
    expect(screen.getByText("No preview available for XLSX files")).toBeDefined();

    rerender(<DownloadViewer path="archive.zip" assetBaseUrl="/vault/v1/assets" />);
    expect(screen.getByText("No preview available for ZIP files")).toBeDefined();
  });

  it("renders download button with correct link", () => {
    render(<DownloadViewer {...defaultProps} />);

    const link = screen.getByRole("link", { name: "Download File" });
    expect(link).toBeDefined();
    expect(link.getAttribute("href")).toBe("/vault/test-vault/assets/attachments/document.docx");
  });

  it("has download attribute with filename", () => {
    render(<DownloadViewer {...defaultProps} />);

    const link = screen.getByRole("link", { name: "Download File" });
    expect(link.getAttribute("download")).toBe("document.docx");
  });

  it("encodes special characters in URL", () => {
    render(<DownloadViewer path="files/my document (1).docx" assetBaseUrl="/vault/v1/assets" />);

    const link = screen.getByRole("link", { name: "Download File" });
    expect(link.getAttribute("href")).toBe("/vault/v1/assets/files/my%20document%20(1).docx");
  });

  it("handles files without extension gracefully", () => {
    render(<DownloadViewer path="Makefile" assetBaseUrl="/vault/v1/assets" />);

    expect(screen.getByText("Makefile")).toBeDefined();
    expect(screen.getByText("No preview available for FILE files")).toBeDefined();
  });

  it("uses path as filename when no separator exists", () => {
    render(<DownloadViewer path="simple.zip" assetBaseUrl="/vault/v1/assets" />);

    expect(screen.getByText("simple.zip")).toBeDefined();
    const link = screen.getByRole("link", { name: "Download File" });
    expect(link.getAttribute("download")).toBe("simple.zip");
  });

  it("constructs URL correctly with different base URLs", () => {
    const { rerender } = render(
      <DownloadViewer path="file.zip" assetBaseUrl="/vault/vault-1/assets" />
    );

    let link = screen.getByRole("link", { name: "Download File" });
    expect(link.getAttribute("href")).toBe("/vault/vault-1/assets/file.zip");

    rerender(<DownloadViewer path="file.zip" assetBaseUrl="/vault/vault-2/assets" />);
    link = screen.getByRole("link", { name: "Download File" });
    expect(link.getAttribute("href")).toBe("/vault/vault-2/assets/file.zip");
  });

  describe("delete button", () => {
    it("does not render delete button when onDelete is not provided", () => {
      render(<DownloadViewer {...defaultProps} />);

      const deleteBtn = screen.queryByRole("button", { name: /delete file/i });
      expect(deleteBtn).toBeNull();
    });

    it("renders delete button when onDelete is provided", () => {
      const handleDelete = () => {};
      render(<DownloadViewer {...defaultProps} onDelete={handleDelete} />);

      const deleteBtn = screen.getByRole("button", { name: /delete file/i });
      expect(deleteBtn).toBeDefined();
    });

    it("calls onDelete when delete button is clicked", () => {
      let deleted = false;
      const handleDelete = () => {
        deleted = true;
      };
      render(<DownloadViewer {...defaultProps} onDelete={handleDelete} />);

      const deleteBtn = screen.getByRole("button", { name: /delete file/i });
      fireEvent.click(deleteBtn);

      expect(deleted).toBe(true);
    });
  });
});
