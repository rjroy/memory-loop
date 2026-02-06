/**
 * useCards Hook Tests
 *
 * Tests for the spaced repetition cards REST API hook.
 * Uses dependency injection for fetch (no mock.module).
 */

import { describe, it, expect } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useCards } from "../useCards.js";
import type { FetchFn } from "@/lib/api/types";
import type {
  DueCard,
  CardDetail,
  ReviewResponse,
  ReviewResult,
  DueCardsResponse,
  ArchiveResponse,
} from "@memory-loop/shared";

/**
 * Creates a mock fetch function that returns a successful response.
 */
function createMockFetch(
  responseData: unknown,
  options: { ok?: boolean; status?: number } = {}
): FetchFn {
  const { ok = true, status = 200 } = options;
  return () =>
    Promise.resolve({
      ok,
      status,
      json: () => Promise.resolve(responseData),
    } as Response);
}

/**
 * Creates a mock fetch that returns an error response.
 */
function createErrorFetch(code: string, message: string, status = 400): FetchFn {
  return () =>
    Promise.resolve({
      ok: false,
      status,
      json: () => Promise.resolve({ error: { code, message } }),
    } as Response);
}

/**
 * Sample test data matching the schema types.
 */
const mockDueCard: DueCard = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  question: "What is the capital of France?",
  next_review: "2026-01-23",
  card_file: "06_Metadata/memory-loop/cards/550e8400-e29b-41d4-a716-446655440001.md",
};

const mockCardDetail: CardDetail = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  question: "What is the capital of France?",
  answer: "Paris",
  ease_factor: 2.5,
  interval: 1,
  repetitions: 0,
  last_reviewed: null,
  next_review: "2026-01-23",
  source_file: "geography/capitals.md",
};

const mockReviewResult: ReviewResult = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  next_review: "2026-01-24",
  interval: 1,
  ease_factor: 2.5,
};

const mockArchiveResponse: ArchiveResponse = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  archived: true,
};

describe("useCards", () => {
  const mockVaultId = "test-vault-123";

  describe("initial state", () => {
    it("starts with isLoading false", () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));
      expect(result.current.isLoading).toBe(false);
    });

    it("starts with no error", () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));
      expect(result.current.error).toBeNull();
    });
  });

  describe("getDueCards", () => {
    it("returns null if no vaultId provided", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useCards(undefined, { fetch: mockFetch }));

      let dueCards: unknown;
      await act(async () => {
        dueCards = await result.current.getDueCards();
      });

      expect(dueCards).toBeNull();
      expect(result.current.error).toBe("No vault selected");
    });

    it("fetches due cards from correct endpoint", async () => {
      const mockResponse: DueCardsResponse = {
        cards: [mockDueCard],
        count: 1,
      };

      let capturedUrl: string | undefined;
      const mockFetch: FetchFn = (url) => {
        capturedUrl = url as string;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockResponse),
        } as Response);
      };

      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));

      let dueCards: unknown;
      await act(async () => {
        dueCards = await result.current.getDueCards();
      });

      expect(capturedUrl).toBe(`/api/vaults/${mockVaultId}/cards/due`);
      expect(dueCards).toEqual(mockResponse);
    });

    it("returns empty cards array when no cards due", async () => {
      const mockResponse: DueCardsResponse = { cards: [], count: 0 };
      const mockFetch = createMockFetch(mockResponse);
      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));

      let dueCards: unknown;
      await act(async () => {
        dueCards = await result.current.getDueCards();
      });

      expect(dueCards).toEqual({ cards: [], count: 0 });
      expect(result.current.error).toBeNull();
    });

    it("sets error on API error", async () => {
      const mockFetch = createErrorFetch("INTERNAL_ERROR", "Failed to fetch due cards", 500);
      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));

      let dueCards: unknown;
      await act(async () => {
        dueCards = await result.current.getDueCards();
      });

      expect(dueCards).toBeNull();
      expect(result.current.error).toBe("Failed to fetch due cards");
    });
  });

  describe("getCard", () => {
    it("returns null if no vaultId provided", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useCards(undefined, { fetch: mockFetch }));

      let card: unknown;
      await act(async () => {
        card = await result.current.getCard("some-id");
      });

      expect(card).toBeNull();
      expect(result.current.error).toBe("No vault selected");
    });

    it("returns null if cardId is empty", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));

      let card: unknown;
      await act(async () => {
        card = await result.current.getCard("");
      });

      expect(card).toBeNull();
      expect(result.current.error).toBe("Card ID is required");
    });

    it("fetches card from correct endpoint", async () => {
      const cardId = "550e8400-e29b-41d4-a716-446655440001";

      let capturedUrl: string | undefined;
      const mockFetch: FetchFn = (url) => {
        capturedUrl = url as string;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockCardDetail),
        } as Response);
      };

      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));

      let card: unknown;
      await act(async () => {
        card = await result.current.getCard(cardId);
      });

      expect(capturedUrl).toBe(`/api/vaults/${mockVaultId}/cards/${cardId}`);
      expect(card).toEqual(mockCardDetail);
    });

    it("sets error when card not found", async () => {
      const mockFetch = createErrorFetch("FILE_NOT_FOUND", "Card not found", 404);
      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));

      let card: unknown;
      await act(async () => {
        card = await result.current.getCard("nonexistent-id");
      });

      expect(card).toBeNull();
      expect(result.current.error).toBe("Card not found");
    });

    it("encodes cardId in URL", async () => {
      const cardId = "card-with-special/chars";

      let capturedUrl: string | undefined;
      const mockFetch: FetchFn = (url) => {
        capturedUrl = url as string;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockCardDetail),
        } as Response);
      };

      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));

      await act(async () => {
        await result.current.getCard(cardId);
      });

      expect(capturedUrl).toBe(
        `/api/vaults/${mockVaultId}/cards/${encodeURIComponent(cardId)}`
      );
    });
  });

  describe("submitReview", () => {
    it("returns null if no vaultId provided", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useCards(undefined, { fetch: mockFetch }));

      let reviewResult: unknown;
      await act(async () => {
        reviewResult = await result.current.submitReview("some-id", "good");
      });

      expect(reviewResult).toBeNull();
      expect(result.current.error).toBe("No vault selected");
    });

    it("returns null if cardId is empty", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));

      let reviewResult: unknown;
      await act(async () => {
        reviewResult = await result.current.submitReview("", "good");
      });

      expect(reviewResult).toBeNull();
      expect(result.current.error).toBe("Card ID is required");
    });

    it("sends POST to correct endpoint with response body", async () => {
      const cardId = "550e8400-e29b-41d4-a716-446655440001";
      const reviewResponse: ReviewResponse = "good";

      let capturedUrl: string | undefined;
      let capturedOptions: RequestInit | undefined;
      const mockFetch: FetchFn = (url, options) => {
        capturedUrl = url as string;
        capturedOptions = options;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockReviewResult),
        } as Response);
      };

      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));

      let reviewResult: unknown;
      await act(async () => {
        reviewResult = await result.current.submitReview(cardId, reviewResponse);
      });

      expect(capturedUrl).toBe(`/api/vaults/${mockVaultId}/cards/${cardId}/review`);
      expect(capturedOptions?.method).toBe("POST");
      expect(JSON.parse(capturedOptions?.body as string)).toEqual({
        response: "good",
      });
      expect(reviewResult).toEqual(mockReviewResult);
    });

    it("handles all review response types", async () => {
      const responses: ReviewResponse[] = ["again", "hard", "good", "easy"];
      const cardId = "test-card-id";

      for (const response of responses) {
        let capturedBody: string | undefined;
        const mockFetch: FetchFn = (_url, options) => {
          capturedBody = options?.body as string;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(mockReviewResult),
          } as Response);
        };

        const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));

        await act(async () => {
          await result.current.submitReview(cardId, response);
        });

        expect(JSON.parse(capturedBody!)).toEqual({ response });
      }
    });

    it("sets error on API error", async () => {
      const mockFetch = createErrorFetch("VALIDATION_ERROR", "Invalid response value", 400);
      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));

      let reviewResult: unknown;
      await act(async () => {
        reviewResult = await result.current.submitReview("card-id", "good");
      });

      expect(reviewResult).toBeNull();
      expect(result.current.error).toBe("Invalid response value");
    });
  });

  describe("archiveCard", () => {
    it("returns null if no vaultId provided", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useCards(undefined, { fetch: mockFetch }));

      let archiveResult: unknown;
      await act(async () => {
        archiveResult = await result.current.archiveCard("some-id");
      });

      expect(archiveResult).toBeNull();
      expect(result.current.error).toBe("No vault selected");
    });

    it("returns null if cardId is empty", async () => {
      const mockFetch = createMockFetch({});
      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));

      let archiveResult: unknown;
      await act(async () => {
        archiveResult = await result.current.archiveCard("");
      });

      expect(archiveResult).toBeNull();
      expect(result.current.error).toBe("Card ID is required");
    });

    it("sends POST to correct endpoint", async () => {
      const cardId = "550e8400-e29b-41d4-a716-446655440001";

      let capturedUrl: string | undefined;
      let capturedOptions: RequestInit | undefined;
      const mockFetch: FetchFn = (url, options) => {
        capturedUrl = url as string;
        capturedOptions = options;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockArchiveResponse),
        } as Response);
      };

      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));

      let archiveResult: unknown;
      await act(async () => {
        archiveResult = await result.current.archiveCard(cardId);
      });

      expect(capturedUrl).toBe(`/api/vaults/${mockVaultId}/cards/${cardId}/archive`);
      expect(capturedOptions?.method).toBe("POST");
      expect(archiveResult).toEqual(mockArchiveResponse);
    });

    it("sets error on API error", async () => {
      const mockFetch = createErrorFetch("FILE_NOT_FOUND", "Card not found", 404);
      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));

      let archiveResult: unknown;
      await act(async () => {
        archiveResult = await result.current.archiveCard("nonexistent-id");
      });

      expect(archiveResult).toBeNull();
      expect(result.current.error).toBe("Card not found");
    });
  });

  describe("clearError", () => {
    it("clears the current error", async () => {
      const mockFetch = createErrorFetch("VALIDATION_ERROR", "Test error", 400);
      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));

      await act(async () => {
        await result.current.getDueCards();
      });

      expect(result.current.error).toBe("Test error");

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe("loading state", () => {
    it("sets isLoading during getDueCards", async () => {
      let resolvePromise: (value: Response) => void;
      const mockFetch: FetchFn = () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        });

      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));

      expect(result.current.isLoading).toBe(false);

      let dueCardsPromise: Promise<DueCardsResponse | null>;
      act(() => {
        dueCardsPromise = result.current.getDueCards();
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolvePromise!({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ cards: [], count: 0 }),
        } as Response);
        await dueCardsPromise;
      });

      expect(result.current.isLoading).toBe(false);
    });

    it("sets isLoading during getCard", async () => {
      let resolvePromise: (value: Response) => void;
      const mockFetch: FetchFn = () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        });

      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));

      let cardPromise: Promise<CardDetail | null>;
      act(() => {
        cardPromise = result.current.getCard("test-id");
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolvePromise!({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockCardDetail),
        } as Response);
        await cardPromise;
      });

      expect(result.current.isLoading).toBe(false);
    });

    it("sets isLoading during submitReview", async () => {
      let resolvePromise: (value: Response) => void;
      const mockFetch: FetchFn = () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        });

      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));

      let reviewPromise: Promise<ReviewResult | null>;
      act(() => {
        reviewPromise = result.current.submitReview("test-id", "good");
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolvePromise!({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockReviewResult),
        } as Response);
        await reviewPromise;
      });

      expect(result.current.isLoading).toBe(false);
    });

    it("sets isLoading during archiveCard", async () => {
      let resolvePromise: (value: Response) => void;
      const mockFetch: FetchFn = () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        });

      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));

      let archivePromise: Promise<ArchiveResponse | null>;
      act(() => {
        archivePromise = result.current.archiveCard("test-id");
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolvePromise!({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockArchiveResponse),
        } as Response);
        await archivePromise;
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("vaultId changes", () => {
    it("uses updated vaultId for operations", async () => {
      const capturedUrls: string[] = [];
      const mockFetch: FetchFn = (url) => {
        capturedUrls.push(url as string);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ cards: [], count: 0 }),
        } as Response);
      };

      const { result, rerender } = renderHook(
        ({ vaultId }) => useCards(vaultId, { fetch: mockFetch }),
        { initialProps: { vaultId: "vault-1" } }
      );

      await act(async () => {
        await result.current.getDueCards();
      });

      expect(capturedUrls[0]).toContain("vault-1");

      rerender({ vaultId: "vault-2" });

      await act(async () => {
        await result.current.getDueCards();
      });

      expect(capturedUrls[1]).toContain("vault-2");
    });
  });

  describe("error handling edge cases", () => {
    it("handles network error in getDueCards", async () => {
      const mockFetch: FetchFn = () => Promise.reject(new Error("Network error"));
      const { result } = renderHook(() => useCards(mockVaultId, { fetch: mockFetch }));

      let dueCards: unknown;
      await act(async () => {
        dueCards = await result.current.getDueCards();
      });

      expect(dueCards).toBeNull();
      expect(result.current.error).toBe("Network error");
    });

    it("clears previous error on new request", async () => {
      // First request fails
      const errorFetch = createErrorFetch("INTERNAL_ERROR", "First error", 500);
      const { result, rerender } = renderHook(
        ({ fetch }) => useCards(mockVaultId, { fetch }),
        { initialProps: { fetch: errorFetch } }
      );

      await act(async () => {
        await result.current.getDueCards();
      });

      expect(result.current.error).toBe("First error");

      // Second request succeeds
      const successFetch = createMockFetch({ cards: [], count: 0 });
      rerender({ fetch: successFetch });

      await act(async () => {
        await result.current.getDueCards();
      });

      expect(result.current.error).toBeNull();
    });
  });
});
