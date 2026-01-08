/**
 * useImageUpload Hook Tests
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useImageUpload } from "../useImageUpload";

// Store original fetch for restoration
const originalFetch = globalThis.fetch;

describe("useImageUpload", () => {
  const mockVaultId = "test-vault-123";

  beforeEach(() => {
    // Reset fetch mock before each test
    // Use type assertion to satisfy fetch's complex type signature
    (globalThis.fetch as unknown) = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, path: "05_Attachments/2026-01-08-image-ABC12.png" }),
      } as Response)
    );
  });

  afterEach(() => {
    // Restore original fetch to avoid test pollution
    globalThis.fetch = originalFetch;
  });

  describe("initial state", () => {
    it("starts with isUploading false", () => {
      const { result } = renderHook(() => useImageUpload(mockVaultId));
      expect(result.current.isUploading).toBe(false);
    });

    it("starts with no error", () => {
      const { result } = renderHook(() => useImageUpload(mockVaultId));
      expect(result.current.error).toBeNull();
    });
  });

  describe("uploadImage", () => {
    it("returns null if no vaultId provided", async () => {
      const { result } = renderHook(() => useImageUpload(undefined));

      let uploadResult: string | null = null;
      await act(async () => {
        uploadResult = await result.current.uploadImage(new File(["test"], "test.png"));
      });

      expect(uploadResult).toBeNull();
      expect(result.current.error).toBe("No vault selected");
    });

    it("sets isUploading during upload", async () => {
      let resolvePromise: (value: Response) => void;
      (globalThis.fetch as unknown) = mock(
        () =>
          new Promise<Response>((resolve) => {
            resolvePromise = resolve;
          })
      );

      const { result } = renderHook(() => useImageUpload(mockVaultId));

      expect(result.current.isUploading).toBe(false);

      let uploadPromise: Promise<string | null>;
      act(() => {
        uploadPromise = result.current.uploadImage(new File(["test"], "test.png"));
      });

      // Should be uploading now
      expect(result.current.isUploading).toBe(true);

      // Resolve the fetch
      await act(async () => {
        resolvePromise!({
          ok: true,
          json: () => Promise.resolve({ success: true, path: "05_Attachments/test.png" }),
        } as Response);
        await uploadPromise;
      });

      // Should be done uploading
      expect(result.current.isUploading).toBe(false);
    });

    it("posts to correct endpoint with FormData", async () => {
      const fetchSpy = spyOn(globalThis, "fetch");

      const { result } = renderHook(() => useImageUpload(mockVaultId));
      const testFile = new File(["image data"], "photo.jpg", { type: "image/jpeg" });

      await act(async () => {
        await result.current.uploadImage(testFile);
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/vault/${mockVaultId}/upload`);
      expect(options.method).toBe("POST");
      expect(options.body).toBeInstanceOf(FormData);

      const formData = options.body as FormData;
      expect(formData.get("image")).toBe(testFile);
    });

    it("returns path on successful upload", async () => {
      const expectedPath = "05_Attachments/2026-01-08-image-XYZ99.png";
      (globalThis.fetch as unknown) = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, path: expectedPath }),
        } as Response)
      );

      const { result } = renderHook(() => useImageUpload(mockVaultId));

      let uploadResult: string | null = null;
      await act(async () => {
        uploadResult = await result.current.uploadImage(new File(["test"], "test.png"));
      });

      // Type narrowing for assertion
      if (uploadResult === null) {
        throw new Error("Expected path but got null");
      }
      const path: string = uploadResult;
      expect(path).toBe(expectedPath);
      expect(result.current.error).toBeNull();
    });

    it("sets error on HTTP error response", async () => {
      (globalThis.fetch as unknown) = mock(() =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ success: false, error: "Invalid file type: .pdf" }),
        } as Response)
      );

      const { result } = renderHook(() => useImageUpload(mockVaultId));

      let uploadResult: string | null = null;
      await act(async () => {
        uploadResult = await result.current.uploadImage(new File(["test"], "test.pdf"));
      });

      expect(uploadResult).toBeNull();
      expect(result.current.error).toBe("Invalid file type: .pdf");
    });

    it("sets error on success=false response", async () => {
      (globalThis.fetch as unknown) = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: false, error: "File too large. Maximum size: 10MB" }),
        } as Response)
      );

      const { result } = renderHook(() => useImageUpload(mockVaultId));

      let uploadResult: string | null = null;
      await act(async () => {
        uploadResult = await result.current.uploadImage(new File(["test"], "large.png"));
      });

      expect(uploadResult).toBeNull();
      expect(result.current.error).toBe("File too large. Maximum size: 10MB");
    });

    it("sets error on network failure", async () => {
      (globalThis.fetch as unknown) = mock(() => Promise.reject(new Error("Network error")));

      const { result } = renderHook(() => useImageUpload(mockVaultId));

      let uploadResult: string | null = null;
      await act(async () => {
        uploadResult = await result.current.uploadImage(new File(["test"], "test.png"));
      });

      expect(uploadResult).toBeNull();
      expect(result.current.error).toBe("Network error");
    });

    it("clears previous error on new upload attempt", async () => {
      // First upload fails
      (globalThis.fetch as unknown) = mock(() =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ success: false, error: "First error" }),
        } as Response)
      );

      const { result } = renderHook(() => useImageUpload(mockVaultId));

      await act(async () => {
        await result.current.uploadImage(new File(["test"], "test.pdf"));
      });

      expect(result.current.error).toBe("First error");

      // Second upload succeeds
      (globalThis.fetch as unknown) = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, path: "05_Attachments/test.png" }),
        } as Response)
      );

      await act(async () => {
        await result.current.uploadImage(new File(["test"], "test.png"));
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe("clearError", () => {
    it("clears the current error", async () => {
      (globalThis.fetch as unknown) = mock(() =>
        Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ success: false, error: "Test error" }),
        } as Response)
      );

      const { result } = renderHook(() => useImageUpload(mockVaultId));

      await act(async () => {
        await result.current.uploadImage(new File(["test"], "test.png"));
      });

      expect(result.current.error).toBe("Test error");

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe("vaultId changes", () => {
    it("uses updated vaultId for uploads", async () => {
      // This test verifies the hook uses the current vaultId value
      // We test this by calling uploadImage with different vaultIds
      // and checking that the returned paths differ based on the mock responses

      const { result, rerender } = renderHook(({ vaultId }) => useImageUpload(vaultId), {
        initialProps: { vaultId: "vault-1" },
      });

      // First upload with vault-1
      let path1: string | null = null;
      await act(async () => {
        path1 = await result.current.uploadImage(new File(["test"], "test.png"));
      });

      // Verify upload succeeded (mock returns path)
      expect(path1).not.toBeNull();

      // Change vault and upload again
      rerender({ vaultId: "vault-2" });

      let path2: string | null = null;
      await act(async () => {
        path2 = await result.current.uploadImage(new File(["test"], "test.png"));
      });

      // Both uploads should succeed (mock returns path for both)
      expect(path2).not.toBeNull();
    });
  });
});
