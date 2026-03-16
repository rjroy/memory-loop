/**
 * useCards Hook
 *
 * Handles spaced repetition card operations for a vault.
 * Uses REST API client for fetching due cards, card details, reviews, and archiving.
 *
 * Requirements:
 * - REQ-F-31: Due cards via GET /api/vaults/:vaultId/cards/due
 * - REQ-F-32: Card detail via GET /api/vaults/:vaultId/cards/:cardId
 * - REQ-F-33: Review submission via POST /api/vaults/:vaultId/cards/:cardId/review
 * - REQ-F-34: Card archiving via POST /api/vaults/:vaultId/cards/:cardId/archive
 */

import { useState, useCallback, useMemo } from "react";
import { createApiClient, vaultPath, ApiError } from "@/lib/api/client";
import type {
  CardDetail,
  ReviewResponse,
  ReviewResult,
  DueCardsResponse,
  ArchiveResponse,
} from "@memory-loop/shared";
import type { FetchFn } from "@/lib/api/types";

/**
 * Return type for the useCards hook.
 */
export interface UseCardsResult {
  /** Get cards that are due for review */
  getDueCards: () => Promise<DueCardsResponse | null>;
  /** Get full card detail (includes answer) */
  getCard: (cardId: string) => Promise<CardDetail | null>;
  /** Submit a review response for a card */
  submitReview: (cardId: string, response: ReviewResponse) => Promise<ReviewResult | null>;
  /** Archive a card (remove from review rotation) */
  archiveCard: (cardId: string) => Promise<ArchiveResponse | null>;
  /** Whether an operation is currently in progress */
  isLoading: boolean;
  /** Error message from the last failed operation */
  error: string | null;
  /** Clear the current error */
  clearError: () => void;
}

/**
 * Configuration options for useCards hook.
 */
export interface UseCardsOptions {
  /** Custom fetch implementation for testing */
  fetch?: FetchFn;
}

/**
 * React hook for spaced repetition card operations.
 *
 * @param vaultId - The vault ID to operate on
 * @param options - Optional configuration (fetch for testing)
 * @returns Card operation functions, loading state, and error state
 *
 * @example
 * ```tsx
 * const { getDueCards, getCard, submitReview, archiveCard, isLoading } = useCards(vault?.id);
 *
 * useEffect(() => {
 *   getDueCards().then((result) => setDueCards(result?.cards ?? []));
 * }, [getDueCards]);
 *
 * const handleReview = async (cardId: string, response: ReviewResponse) => {
 *   const result = await submitReview(cardId, response);
 *   if (result) {
 *     // Card reviewed, fetch next due cards
 *     getDueCards();
 *   }
 * };
 * ```
 */
export function useCards(
  vaultId: string | undefined,
  options: UseCardsOptions = {}
): UseCardsResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Memoize API client to avoid recreating on each render
  const api = useMemo(
    () => createApiClient(options.fetch ? { fetch: options.fetch } : {}),
    [options.fetch]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Get cards that are due for review.
   */
  const getDueCards = useCallback(async (): Promise<DueCardsResponse | null> => {
    if (!vaultId) {
      setError("No vault selected");
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await api.get<DueCardsResponse>(vaultPath(vaultId, "cards/due"));
      return result;
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to get due cards";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [vaultId, api]);

  /**
   * Get full card detail (includes answer).
   */
  const getCard = useCallback(
    async (cardId: string): Promise<CardDetail | null> => {
      if (!vaultId) {
        setError("No vault selected");
        return null;
      }

      if (!cardId) {
        setError("Card ID is required");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await api.get<CardDetail>(
          vaultPath(vaultId, `cards/${encodeURIComponent(cardId)}`)
        );
        return result;
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to get card";
        setError(message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api]
  );

  /**
   * Submit a review response for a card.
   */
  const submitReview = useCallback(
    async (cardId: string, response: ReviewResponse): Promise<ReviewResult | null> => {
      if (!vaultId) {
        setError("No vault selected");
        return null;
      }

      if (!cardId) {
        setError("Card ID is required");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await api.post<ReviewResult>(
          vaultPath(vaultId, `cards/${encodeURIComponent(cardId)}/review`),
          { response }
        );
        return result;
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to submit review";
        setError(message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api]
  );

  /**
   * Archive a card (remove from review rotation).
   */
  const archiveCard = useCallback(
    async (cardId: string): Promise<ArchiveResponse | null> => {
      if (!vaultId) {
        setError("No vault selected");
        return null;
      }

      if (!cardId) {
        setError("Card ID is required");
        return null;
      }

      setIsLoading(true);
      setError(null);

      try {
        const result = await api.post<ArchiveResponse>(
          vaultPath(vaultId, `cards/${encodeURIComponent(cardId)}/archive`)
        );
        return result;
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to archive card";
        setError(message);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [vaultId, api]
  );

  return {
    getDueCards,
    getCard,
    submitReview,
    archiveCard,
    isLoading,
    error,
    clearError,
  };
}
