/**
 * useImageUpload Hook
 *
 * Handles image file uploads to the vault's attachment directory.
 * Uses fetch with FormData to POST to the backend upload endpoint.
 */

import { useState, useCallback } from "react";

/**
 * Return type for the useImageUpload hook.
 */
export interface UseImageUploadResult {
  /** Upload an image file and return the relative path on success */
  uploadImage: (file: File) => Promise<string | null>;
  /** Whether an upload is currently in progress */
  isUploading: boolean;
  /** Error message from the last failed upload */
  error: string | null;
  /** Clear the current error */
  clearError: () => void;
}

/**
 * Response from the upload endpoint.
 */
interface UploadResponse {
  success: boolean;
  path?: string;
  error?: string;
}

/**
 * React hook for uploading images to the vault attachment directory.
 *
 * @param vaultId - The vault ID to upload to (from session context)
 * @returns Upload function, loading state, and error state
 *
 * @example
 * ```tsx
 * const { uploadImage, isUploading, error } = useImageUpload(vault?.id);
 *
 * const handleFileSelect = async (file: File) => {
 *   const path = await uploadImage(file);
 *   if (path) {
 *     console.log("Uploaded to:", path);
 *   }
 * };
 * ```
 */
export function useImageUpload(vaultId: string | undefined): UseImageUploadResult {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const uploadImage = useCallback(
    async (file: File): Promise<string | null> => {
      if (!vaultId) {
        setError("No vault selected");
        return null;
      }

      setIsUploading(true);
      setError(null);

      try {
        const formData = new FormData();
        formData.append("image", file);

        const response = await fetch(`/vault/${vaultId}/upload`, {
          method: "POST",
          body: formData,
        });

        const data = (await response.json()) as UploadResponse;

        if (!response.ok || !data.success) {
          const errorMessage = data.error ?? "Upload failed";
          setError(errorMessage);
          return null;
        }

        return data.path ?? null;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        setError(message);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [vaultId]
  );

  return {
    uploadImage,
    isUploading,
    error,
    clearError,
  };
}
