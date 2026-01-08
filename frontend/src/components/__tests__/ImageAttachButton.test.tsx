/**
 * ImageAttachButton Component Tests
 *
 * Tests the ImageAttachButton component by mocking fetch at the network level.
 * This allows the actual useImageUpload hook to run, ensuring proper integration.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import React from "react";
import { ImageAttachButton } from "../ImageAttachButton";
import { SessionProvider } from "../../contexts/SessionContext";
import { createMockVault } from "../../test-helpers";
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

describe("ImageAttachButton", () => {
  const mockOnImageUploaded = mock(() => {});

  beforeEach(() => {
    mockOnImageUploaded.mockReset();
    localStorage.clear();
    // Pre-select vault via localStorage (same pattern as Discussion tests)
    localStorage.setItem("memory-loop:vaultId", "test-vault");
    // Reset fetch mock with default success response
    (globalThis.fetch as unknown) = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          path: "05_Attachments/test-image.png",
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
    it("renders a button with camera icon", () => {
      renderWithSession(<ImageAttachButton onImageUploaded={mockOnImageUploaded} />);

      const button = screen.getByRole("button", { name: "Attach image" });
      expect(button).toBeDefined();

      // Check for SVG icon
      const svg = button.querySelector("svg");
      expect(svg).toBeDefined();
    });

    it("renders hidden file input", () => {
      renderWithSession(<ImageAttachButton onImageUploaded={mockOnImageUploaded} />);

      const input = document.querySelector('input[type="file"]');
      expect(input).toBeDefined();
      expect(input?.getAttribute("accept")).toBe("image/png,image/jpeg,image/gif,image/webp");
      expect(input?.getAttribute("capture")).toBe("environment");
    });

    it("disables button when disabled prop is true", () => {
      renderWithSession(<ImageAttachButton onImageUploaded={mockOnImageUploaded} disabled />);

      const button = screen.getByRole("button", { name: "Attach image" });
      expect(button.hasAttribute("disabled")).toBe(true);
    });

    it("disables button when no vault selected", () => {
      renderWithSession(<ImageAttachButton onImageUploaded={mockOnImageUploaded} />, null);

      const button = screen.getByRole("button", { name: "Attach image" });
      expect(button.hasAttribute("disabled")).toBe(true);
    });
  });

  describe("file selection", () => {
    it("has file input with correct accept types", () => {
      renderWithSession(<ImageAttachButton onImageUploaded={mockOnImageUploaded} />);

      // Verify the file input exists with correct attributes
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;

      expect(input).toBeDefined();
      expect(input.getAttribute("accept")).toBe("image/png,image/jpeg,image/gif,image/webp");
      expect(input.getAttribute("capture")).toBe("environment");
    });

    it("calls onImageUploaded with path on successful upload", async () => {
      (globalThis.fetch as unknown) = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            path: "05_Attachments/2026-01-08-image-ABC12.png",
          }),
        } as Response)
      );

      renderWithSession(<ImageAttachButton onImageUploaded={mockOnImageUploaded} />);

      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["image data"], "photo.png", { type: "image/png" });

      act(() => {
        fireEvent.change(input, { target: { files: [file] } });
      });

      await waitFor(() => {
        expect(mockOnImageUploaded).toHaveBeenCalledWith("05_Attachments/2026-01-08-image-ABC12.png");
      });
    });

    it("does not call onImageUploaded when upload fails", async () => {
      (globalThis.fetch as unknown) = mock(() =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve({
            success: false,
            error: "Invalid file type",
          }),
        } as Response)
      );

      renderWithSession(<ImageAttachButton onImageUploaded={mockOnImageUploaded} />);

      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["image data"], "photo.png", { type: "image/png" });

      act(() => {
        fireEvent.change(input, { target: { files: [file] } });
      });

      // Wait a tick to ensure async operations complete
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockOnImageUploaded).not.toHaveBeenCalled();
    });

    it("ignores empty file selection", () => {
      const fetchMock = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, path: "test.png" }),
        } as Response)
      );
      (globalThis.fetch as unknown) = fetchMock;

      renderWithSession(<ImageAttachButton onImageUploaded={mockOnImageUploaded} />);

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

      renderWithSession(<ImageAttachButton onImageUploaded={mockOnImageUploaded} />);

      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(["image data"], "large.png", { type: "image/png" });

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
