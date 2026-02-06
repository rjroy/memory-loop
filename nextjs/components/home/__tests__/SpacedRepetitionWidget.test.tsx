/**
 * SpacedRepetitionWidget Component Tests
 *
 * Tests for all widget states: loading, question, revealed, complete.
 * Uses dependency injection for fetch (no mock.module).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { SessionProvider } from "../../../contexts/SessionContext";
import { SpacedRepetitionWidget } from "../SpacedRepetitionWidget";
import type { FetchFn } from "../../../api/types";
import type { DueCardsResponse, CardDetail } from "@memory-loop/shared";

/**
 * Wrapper component that provides SessionContext for testing.
 */
function TestWrapper({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

/**
 * Helper to render component with SessionProvider.
 */
function renderWithSession(ui: React.ReactElement) {
  return render(ui, { wrapper: TestWrapper });
}

// =============================================================================
// Test Data
// =============================================================================

const mockDueCardsResponse: DueCardsResponse = {
  cards: [
    { id: "card-1", question: "What is TypeScript?", next_review: "2026-01-23", card_file: "06_Metadata/memory-loop/cards/card-1.md" },
    { id: "card-2", question: "What is React?", next_review: "2026-01-23", card_file: "06_Metadata/memory-loop/cards/card-2.md" },
    { id: "card-3", question: "What is Bun?", next_review: "2026-01-23", card_file: "06_Metadata/memory-loop/cards/card-3.md" },
  ],
  count: 3,
};

const mockCardDetail: CardDetail = {
  id: "card-1",
  question: "What is TypeScript?",
  answer: "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.",
  ease_factor: 2.5,
  interval: 1,
  repetitions: 0,
  last_reviewed: null,
  next_review: "2026-01-23",
  source_file: "notes/programming.md",
};

const mockReviewResult = {
  id: "card-1",
  next_review: "2026-01-24",
  interval: 1,
  ease_factor: 2.5,
};

const mockArchiveResponse = {
  id: "card-1",
  archived: true,
};

// =============================================================================
// Mock Fetch Helpers
// =============================================================================

interface MockFetchOptions {
  dueCards?: DueCardsResponse | null;
  cardDetail?: CardDetail | null;
  reviewResult?: typeof mockReviewResult | null;
  archiveResult?: typeof mockArchiveResponse | null;
  dueCardsDelay?: number;
  cardDetailDelay?: number;
  reviewDelay?: number;
}

function createMockFetch(options: MockFetchOptions = {}): FetchFn {
  const {
    dueCards = mockDueCardsResponse,
    cardDetail = mockCardDetail,
    reviewResult = mockReviewResult,
    archiveResult = mockArchiveResponse,
    dueCardsDelay = 0,
    cardDetailDelay = 0,
    reviewDelay = 0,
  } = options;

  return async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    const method = init?.method ?? "GET";

    // GET /cards/due
    if (urlStr.includes("/cards/due") && method === "GET") {
      if (dueCardsDelay > 0) {
        await new Promise((r) => setTimeout(r, dueCardsDelay));
      }
      return {
        ok: dueCards !== null,
        status: dueCards !== null ? 200 : 404,
        json: () => Promise.resolve(dueCards ?? { error: { code: "NOT_FOUND", message: "No cards" } }),
      } as Response;
    }

    // GET /cards/:cardId
    if (urlStr.match(/\/cards\/[^/]+$/) && method === "GET") {
      if (cardDetailDelay > 0) {
        await new Promise((r) => setTimeout(r, cardDetailDelay));
      }
      return {
        ok: cardDetail !== null,
        status: cardDetail !== null ? 200 : 404,
        json: () => Promise.resolve(cardDetail ?? { error: { code: "NOT_FOUND", message: "Card not found" } }),
      } as Response;
    }

    // POST /cards/:cardId/review
    if (urlStr.includes("/review") && method === "POST") {
      if (reviewDelay > 0) {
        await new Promise((r) => setTimeout(r, reviewDelay));
      }
      return {
        ok: reviewResult !== null,
        status: reviewResult !== null ? 200 : 400,
        json: () => Promise.resolve(reviewResult ?? { error: { code: "VALIDATION_ERROR", message: "Invalid response" } }),
      } as Response;
    }

    // POST /cards/:cardId/archive
    if (urlStr.includes("/archive") && method === "POST") {
      return {
        ok: archiveResult !== null,
        status: archiveResult !== null ? 200 : 404,
        json: () => Promise.resolve(archiveResult ?? { error: { code: "NOT_FOUND", message: "Card not found" } }),
      } as Response;
    }

    // Unknown endpoint
    return {
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: { code: "NOT_FOUND", message: "Unknown endpoint" } }),
    } as Response;
  };
}

// =============================================================================
// Tests
// =============================================================================

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("SpacedRepetitionWidget", () => {
  describe("initial rendering", () => {
    it("renders nothing when vaultId is undefined", () => {
      const mockFetch = createMockFetch();
      const { container } = renderWithSession(
        <SpacedRepetitionWidget vaultId={undefined} fetchFn={mockFetch} />
      );
      expect(container.firstChild).toBeNull();
    });

    it("shows idle state when no cards are due", async () => {
      const mockFetch = createMockFetch({ dueCards: { cards: [], count: 0 } });
      renderWithSession(
        <SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />
      );

      // Wait for the fetch to complete and show idle state
      await waitFor(() => {
        expect(screen.getByText("No cards due today")).toBeDefined();
      });
    });

    it("shows loading state then transitions to question", async () => {
      const mockFetch = createMockFetch({ dueCardsDelay: 50 });

      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      // Wait for question to appear
      await waitFor(() => {
        expect(screen.getByText("What is TypeScript?")).toBeDefined();
      });
    });
  });

  describe("question phase", () => {
    it("displays the header with card count", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByText("Spaced Repetition")).toBeDefined();
        expect(screen.getByText("3 cards")).toBeDefined();
      });
    });

    it("displays the current question", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByText("What is TypeScript?")).toBeDefined();
      });
    });

    it("has an answer input field", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        const input = screen.getByPlaceholderText("Type your answer...");
        expect(input).toBeDefined();
      });
    });

    it("has Skip, Forget, and Show Answer buttons", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Skip this card" })).toBeDefined();
        expect(screen.getByRole("button", { name: "Forget this card" })).toBeDefined();
        expect(screen.getByRole("button", { name: "Show answer" })).toBeDefined();
      });
    });

    it("updates user answer as they type", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Type your answer...")).toBeDefined();
      });

      const input = screen.getByPlaceholderText("Type your answer...");
      fireEvent.change(input, { target: { value: "A typed JavaScript" } });

      expect((input as HTMLInputElement).value).toBe("A typed JavaScript");
    });
  });

  describe("skip action", () => {
    it("moves current card to end of queue", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByText("What is TypeScript?")).toBeDefined();
      });

      // Click Skip
      fireEvent.click(screen.getByRole("button", { name: "Skip this card" }));

      // Should now show the second card
      await waitFor(() => {
        expect(screen.getByText("What is React?")).toBeDefined();
      });
    });

    it("preserves card count after skip", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByText("3 cards")).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Skip this card" }));

      // Count should still be 3
      await waitFor(() => {
        expect(screen.getByText("3 cards")).toBeDefined();
      });
    });
  });

  describe("show answer action", () => {
    it("transitions to revealed phase when clicking Show Answer", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Show answer" })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Show answer" }));

      await waitFor(() => {
        expect(screen.getByText("Answer:")).toBeDefined();
        expect(screen.getByText(/TypeScript is a typed superset/)).toBeDefined();
      });
    });

    it("transitions to revealed phase when pressing Enter in input", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Type your answer...")).toBeDefined();
      });

      const input = screen.getByPlaceholderText("Type your answer...");
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => {
        expect(screen.getByText("Answer:")).toBeDefined();
      });
    });

    it("shows user answer in revealed phase if provided", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Type your answer...")).toBeDefined();
      });

      const input = screen.getByPlaceholderText("Type your answer...");
      fireEvent.change(input, { target: { value: "A typed JavaScript" } });
      fireEvent.click(screen.getByRole("button", { name: "Show answer" }));

      await waitFor(() => {
        expect(screen.getByText("Your answer:")).toBeDefined();
        expect(screen.getByText("A typed JavaScript")).toBeDefined();
      });
    });

    it("shows source file if available", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Show answer" })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Show answer" }));

      await waitFor(() => {
        expect(screen.getByText(/notes\/programming.md/)).toBeDefined();
      });
    });

    it("shows Open button when source file is available", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Show answer" })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Show answer" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Open source file in Recall tab" })).toBeDefined();
      });
    });

    it("does not show Open button when source file is not available", async () => {
      const cardWithoutSource: CardDetail = {
        ...mockCardDetail,
        source_file: undefined,
      };
      const mockFetch = createMockFetch({ cardDetail: cardWithoutSource });
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Show answer" })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Show answer" }));

      await waitFor(() => {
        expect(screen.getByText("Answer:")).toBeDefined();
      });

      // Open button should not be present
      expect(screen.queryByRole("button", { name: "Open source file in Recall tab" })).toBeNull();
    });
  });

  describe("revealed phase", () => {
    it("shows assessment buttons", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Show answer" })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Show answer" }));

      await waitFor(() => {
        expect(screen.getByText("How well did you remember?")).toBeDefined();
        expect(screen.getByText("Again")).toBeDefined();
        expect(screen.getByText("Hard")).toBeDefined();
        expect(screen.getByText("Good")).toBeDefined();
        expect(screen.getByText("Easy")).toBeDefined();
      });
    });

    it("shows keyboard shortcuts on assessment buttons", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Show answer" })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Show answer" }));

      await waitFor(() => {
        // Shortcuts are displayed alongside labels
        expect(screen.getByText("1")).toBeDefined();
        expect(screen.getByText("2")).toBeDefined();
        expect(screen.getByText("3")).toBeDefined();
        expect(screen.getByText("4")).toBeDefined();
      });
    });

    it("advances to next card after assessment", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Show answer" })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Show answer" }));

      await waitFor(() => {
        expect(screen.getByText("Good")).toBeDefined();
      });

      // Click "Good" assessment
      fireEvent.click(screen.getByText("Good"));

      await waitFor(() => {
        // Should advance to next card
        expect(screen.getByText("What is React?")).toBeDefined();
        expect(screen.getByText("2 cards")).toBeDefined();
      });
    });
  });

  describe("forget action", () => {
    it("shows confirmation dialog when clicking Forget", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Forget this card" })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Forget this card" }));

      await waitFor(() => {
        expect(screen.getByText("Forget Card")).toBeDefined();
        expect(screen.getByText(/removed from your review rotation/)).toBeDefined();
      });
    });

    it("archives card and advances when confirmed", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Forget this card" })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Forget this card" }));

      await waitFor(() => {
        expect(screen.getByText("Forget Card")).toBeDefined();
      });

      // Confirm the dialog
      const confirmButton = screen.getByRole("button", { name: "Forget" });
      fireEvent.click(confirmButton);

      await waitFor(() => {
        // Should advance to next card with reduced count
        expect(screen.getByText("What is React?")).toBeDefined();
        expect(screen.getByText("2 cards")).toBeDefined();
      });
    });

    it("closes dialog without action when cancelled", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Forget this card" })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Forget this card" }));

      await waitFor(() => {
        expect(screen.getByText("Forget Card")).toBeDefined();
      });

      // Cancel the dialog
      const cancelButton = screen.getByRole("button", { name: "Cancel" });
      fireEvent.click(cancelButton);

      await waitFor(() => {
        // Should still be on the same card
        expect(screen.getByText("What is TypeScript?")).toBeDefined();
        expect(screen.getByText("3 cards")).toBeDefined();
      });
    });
  });

  describe("complete phase", () => {
    it("shows completion message when all cards reviewed", async () => {
      // Start with a single card
      const singleCardResponse: DueCardsResponse = {
        cards: [{ id: "card-1", question: "What is TypeScript?", next_review: "2026-01-23", card_file: "06_Metadata/memory-loop/cards/card-1.md" }],
        count: 1,
      };

      const mockFetch = createMockFetch({ dueCards: singleCardResponse });
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Show answer" })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Show answer" }));

      await waitFor(() => {
        expect(screen.getByText("Good")).toBeDefined();
      });

      fireEvent.click(screen.getByText("Good"));

      await waitFor(() => {
        expect(screen.getByText("Great job today!")).toBeDefined();
        expect(screen.getByText("1 card reviewed")).toBeDefined();
      });
    });

    it("shows checkmark icon in completion state", async () => {
      const singleCardResponse: DueCardsResponse = {
        cards: [{ id: "card-1", question: "What is TypeScript?", next_review: "2026-01-23", card_file: "06_Metadata/memory-loop/cards/card-1.md" }],
        count: 1,
      };

      const mockFetch = createMockFetch({ dueCards: singleCardResponse });
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Show answer" })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Show answer" }));

      await waitFor(() => {
        expect(screen.getByText("Good")).toBeDefined();
      });

      fireEvent.click(screen.getByText("Good"));

      await waitFor(() => {
        // Checkmark character
        expect(screen.getByText("✓")).toBeDefined();
      });
    });
  });

  describe("error handling", () => {
    it("displays error when API fails", async () => {
      const errorFetch: FetchFn = () =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: { code: "INTERNAL_ERROR", message: "Server error" } }),
        } as Response);

      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={errorFetch} />);

      // Widget doesn't render when initial fetch fails
      await waitFor(() => {
        // Since fetch fails on due cards, widget returns null
        expect(screen.queryByText("Spaced Repetition")).toBeNull();
      });
    });
  });

  describe("accessibility", () => {
    it("has aria-label on the section", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByRole("region", { name: "Spaced repetition review" })).toBeDefined();
      });
    });

    it("has aria-label on answer input", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByLabelText("Your answer")).toBeDefined();
      });
    });

    it("has aria-labels on all buttons", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Skip this card" })).toBeDefined();
        expect(screen.getByRole("button", { name: "Forget this card" })).toBeDefined();
        expect(screen.getByRole("button", { name: "Show answer" })).toBeDefined();
      });
    });
  });

  describe("keyboard shortcuts", () => {
    it("responds to keyboard shortcut 3 (Good) in revealed phase", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Show answer" })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: "Show answer" }));

      await waitFor(() => {
        expect(screen.getByText("Good")).toBeDefined();
      });

      // Simulate keyboard shortcut
      fireEvent.keyDown(window, { key: "3" });

      await waitFor(() => {
        // Should advance to next card
        expect(screen.getByText("What is React?")).toBeDefined();
      });
    });

    it("ignores keyboard shortcuts when typing in input", async () => {
      const mockFetch = createMockFetch();
      renderWithSession(<SpacedRepetitionWidget vaultId="test-vault" fetchFn={mockFetch} />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText("Type your answer...")).toBeDefined();
      });

      const input = screen.getByPlaceholderText("Type your answer...");

      // Focus the input and type a number
      input.focus();
      fireEvent.keyDown(input, { key: "3" });
      fireEvent.change(input, { target: { value: "3" } });

      // Should not trigger any assessment action
      expect((input as HTMLInputElement).value).toBe("3");
      expect(screen.getByText("What is TypeScript?")).toBeDefined();
    });
  });
});
