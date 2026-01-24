/**
 * FileAttachButton Component Tests
 *
 * Tests the FileAttachButton component by mocking fetch at the network level.
 * This allows the actual useFileUpload hook to run, ensuring proper integration.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import React from "react";
import { FileAttachButton } from "../FileAttachButton";
import { SessionProvider } from "../../../contexts/SessionContext";
import { createMockVault } from "../../../test-helpers";
import type { VaultInfo } from "@memory-loop/shared";

// Store original fetch
const originalFetch = globalThis.fetch;

// Helper to render with session context
function renderWithSession(
  ui: React.ReactElement,
  vault: VaultInfo | null = createMockVault()
) {
  const vaults = vault ? [vault] : [];
  return render(
    <SessionProvider initialVaults={vaults}>{ui}</SessionProvider>
  );
}

describe("FileAttachButton", () => {
  const mockOnFileUploaded = mock(() => {});

  beforeEach(() => {
    mockOnFileUploaded.mockReset();
    localStorage.clear();
    // Pre-select vault via localStorage (same pattern as Discussion tests)
    localStorage.setItem("memory-loop:vaultId", "test-vault");
    // Reset fetch mock with default success response
    (globalThis.fetch as unknown) = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          path: "05_Attachments/test-file.png",
        }),
      } as Response)
    );
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    localStorage.clear();
  });

  describe("rendering", () => {
    it("renders a button with paperclip icon", () => {
      renderWithSession(<FileAttachButton onFileUploaded={mockOnFileUploaded} />);

      const button = screen.getByRole("button", { name: "Attach file" });
      expect(button).toBeDefined();

      // Check for SVG icon
      const svg = button.querySelector("svg");
      expect(svg).toBeDefined();
    });

    it("renders hidden file input", () => {
      renderWithSession(<FileAttachButton onFileUploaded={mockOnFileUploaded} />);

      const input = document.querySelector('input[type="file"]');
      expect(input).toBeDefined();
      // Check that accept includes various file types
      const accept = input?.getAttribute("accept") ?? "";
      expect(accept).toContain("image/png");
      expect(accept).toContain("video/mp4");
      expect(accept).toContain("application/pdf");
      expect(accept).toContain("text/plain");
    });

    it("disables button when disabled prop is true", () => {
      renderWithSession(<FileAttachButton onFileUploaded={mockOnFileUploaded} disabled />);

      const button = screen.getByRole("button", { name: "Attach file" });
      expect(button.hasAttribute("disabled")).toBe(true);
    });

    it("disables button when no vault selected", () => {
      renderWithSession(<FileAttachButton onFileUploaded={mockOnFileUploaded} />, null);

      const button = screen.getByRole("button", { name: "Attach file" });
      expect(button.hasAttribute("disabled")).toBe(true);
    });
  });

  describe("file selection", () => {
    it("has file input with multiple accept types", () => {
      renderWithSession(<FileAttachButton onFileUploaded={mockOnFileUploaded} />);

      // Verify the file input exists with correct attributes
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;

      expect(input).toBeDefined();
      const accept = input.getAttribute("accept") ?? "";
      // Images
      expect(accept).toContain("image/png");
      expect(accept).toContain("image/jpeg");
      // Videos
      expect(accept).toContain("video/mp4");
      expect(accept).toContain("video/quicktime");
      // Documents
      expect(accept).toContain("application/pdf");
      // Text
      expect(accept).toContain("text/plain");
      expect(accept).toContain("text/markdown");
      expect(accept).toContain("application/json");
    });

    it("calls onFileUploaded with path on successful upload", async () => {
      (globalThis.fetch as unknown) = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            path: "05_Attachments/2026-01-08-image-ABC12.png",
          }),
        } as Response)
      );

      renderWithSession(<FileAttachButton onFileUploaded={mockOnFileUploaded} />);

      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["image data"], "photo.png", { type: "image/png" });

      act(() => {
        fireEvent.change(input, { target: { files: [file] } });
      });

      await waitFor(() => {
        expect(mockOnFileUploaded).toHaveBeenCalledWith("05_Attachments/2026-01-08-image-ABC12.png");
      });
    });

    it("calls onFileUploaded for PDF upload", async () => {
      (globalThis.fetch as unknown) = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            path: "05_Attachments/2026-01-08-document-ABC12.pdf",
          }),
        } as Response)
      );

      renderWithSession(<FileAttachButton onFileUploaded={mockOnFileUploaded} />);

      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["pdf data"], "report.pdf", { type: "application/pdf" });

      act(() => {
        fireEvent.change(input, { target: { files: [file] } });
      });

      await waitFor(() => {
        expect(mockOnFileUploaded).toHaveBeenCalledWith("05_Attachments/2026-01-08-document-ABC12.pdf");
      });
    });

    it("calls onFileUploaded for text file upload", async () => {
      (globalThis.fetch as unknown) = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            path: "05_Attachments/2026-01-08-text-ABC12.txt",
          }),
        } as Response)
      );

      renderWithSession(<FileAttachButton onFileUploaded={mockOnFileUploaded} />);

      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["text content"], "notes.txt", { type: "text/plain" });

      act(() => {
        fireEvent.change(input, { target: { files: [file] } });
      });

      await waitFor(() => {
        expect(mockOnFileUploaded).toHaveBeenCalledWith("05_Attachments/2026-01-08-text-ABC12.txt");
      });
    });

    it("does not call onFileUploaded when upload fails", async () => {
      (globalThis.fetch as unknown) = mock(() =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve({
            success: false,
            error: "Invalid file type",
          }),
        } as Response)
      );

      renderWithSession(<FileAttachButton onFileUploaded={mockOnFileUploaded} />);

      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["file data"], "test.exe", { type: "application/x-msdownload" });

      act(() => {
        fireEvent.change(input, { target: { files: [file] } });
      });

      // Wait a tick to ensure async operations complete
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockOnFileUploaded).not.toHaveBeenCalled();
    });

    it("ignores empty file selection", () => {
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, path: "test.png" }),
        } as Response)
      );
      (globalThis.fetch as unknown) = fetchMock;

      renderWithSession(<FileAttachButton onFileUploaded={mockOnFileUploaded} />);

      const input = document.querySelector('input[type="file"]') as HTMLInputElement;

      act(() => {
        fireEvent.change(input, { target: { files: [] } });
      });

      // Fetch should not have been called
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("shows error title when upload fails", async () => {
      (globalThis.fetch as unknown) = mock(() =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve({
            success: false,
            error: "File too large",
          }),
        } as Response)
      );

      renderWithSession(<FileAttachButton onFileUploaded={mockOnFileUploaded} />);

      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["file data"], "large.png", { type: "image/png" });

      act(() => {
        fireEvent.change(input, { target: { files: [file] } });
      });

      // Wait for error state to update
      await waitFor(() => {
        const button = screen.getByRole("button");
        expect(button.getAttribute("title")).toBe("File too large");
      });
    });
  });
});
