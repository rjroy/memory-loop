/**
 * SM-2 Algorithm Tests
 *
 * Tests validate against SM-2 reference implementation behavior:
 * - "again" resets learning (interval=1, repetitions=0, EF decreases)
 * - "hard" small interval increase, slight EF decrease
 * - "good" standard interval increase (first=1, second=6, then interval*EF)
 * - "easy" large interval increase with bonus, EF increases
 * - EF clamped to [1.3, 3.0]
 */

import { describe, expect, test } from "bun:test";
import {
  calculateSM2,
  createNewCardState,
  isValidCardState,
  isValidResponse,
  DEFAULT_EASE_FACTOR,
  MIN_EASE_FACTOR,
  MAX_EASE_FACTOR,
  type CardState,
} from "../sm2-algorithm.js";

// Fixed date for deterministic tests
const TODAY = "2026-01-23";

// =============================================================================
// Helper Functions
// =============================================================================

function makeState(
  interval: number,
  easeFactor: number,
  repetitions: number
): CardState {
  return { interval, ease_factor: easeFactor, repetitions };
}

// =============================================================================
// Core Algorithm Tests
// =============================================================================

describe("calculateSM2", () => {
  describe("new card (interval=0, repetitions=0)", () => {
    const newCard = createNewCardState();

    test("again: resets to interval=1, repetitions=0, EF decreases", () => {
      const result = calculateSM2(newCard, "again", TODAY);

      expect(result.interval).toBe(1);
      expect(result.repetitions).toBe(0);
      expect(result.ease_factor).toBe(DEFAULT_EASE_FACTOR - 0.2); // 2.3
      expect(result.next_review).toBe("2026-01-24");
    });

    test("hard: sets interval=1, increments repetitions, EF decreases slightly", () => {
      const result = calculateSM2(newCard, "hard", TODAY);

      expect(result.interval).toBe(1);
      expect(result.repetitions).toBe(1);
      expect(result.ease_factor).toBe(DEFAULT_EASE_FACTOR - 0.15); // 2.35
      expect(result.next_review).toBe("2026-01-24");
    });

    test("good: sets interval=1, increments repetitions, EF unchanged", () => {
      const result = calculateSM2(newCard, "good", TODAY);

      expect(result.interval).toBe(1);
      expect(result.repetitions).toBe(1);
      expect(result.ease_factor).toBe(DEFAULT_EASE_FACTOR); // 2.5
      expect(result.next_review).toBe("2026-01-24");
    });

    test("easy: jumps to interval=4, increments repetitions, EF increases", () => {
      const result = calculateSM2(newCard, "easy", TODAY);

      expect(result.interval).toBe(4);
      expect(result.repetitions).toBe(1);
      expect(result.ease_factor).toBe(DEFAULT_EASE_FACTOR + 0.15); // 2.65
      expect(result.next_review).toBe("2026-01-27");
    });
  });

  describe("first review complete (interval=1, repetitions=1)", () => {
    const firstReviewCard = makeState(1, 2.5, 1);

    test("again: resets to interval=1, repetitions=0", () => {
      const result = calculateSM2(firstReviewCard, "again", TODAY);

      expect(result.interval).toBe(1);
      expect(result.repetitions).toBe(0);
      expect(result.ease_factor).toBe(2.3);
    });

    test("hard: interval increases slightly", () => {
      const result = calculateSM2(firstReviewCard, "hard", TODAY);

      // Hard on interval=1 should give at least interval+1 = 2
      expect(result.interval).toBe(2);
      expect(result.repetitions).toBe(2);
      expect(result.ease_factor).toBe(2.35);
    });

    test("good: sets interval=6 (SM-2 second review value)", () => {
      const result = calculateSM2(firstReviewCard, "good", TODAY);

      expect(result.interval).toBe(6);
      expect(result.repetitions).toBe(2);
      expect(result.ease_factor).toBe(2.5);
      expect(result.next_review).toBe("2026-01-29");
    });

    test("easy: jumps to interval=10", () => {
      const result = calculateSM2(firstReviewCard, "easy", TODAY);

      expect(result.interval).toBe(10);
      expect(result.repetitions).toBe(2);
      expect(result.ease_factor).toBe(2.65);
      expect(result.next_review).toBe("2026-02-02");
    });
  });

  describe("second review complete (interval=6, repetitions=2)", () => {
    const secondReviewCard = makeState(6, 2.5, 2);

    test("again: resets to interval=1, repetitions=0", () => {
      const result = calculateSM2(secondReviewCard, "again", TODAY);

      expect(result.interval).toBe(1);
      expect(result.repetitions).toBe(0);
      expect(result.ease_factor).toBe(2.3);
    });

    test("hard: interval increases by ~1.2x", () => {
      const result = calculateSM2(secondReviewCard, "hard", TODAY);

      // 6 * 1.2 = 7.2, rounded to 7
      expect(result.interval).toBe(7);
      expect(result.repetitions).toBe(3);
      expect(result.ease_factor).toBe(2.35);
    });

    test("good: interval = previous * EF (6 * 2.5 = 15)", () => {
      const result = calculateSM2(secondReviewCard, "good", TODAY);

      expect(result.interval).toBe(15);
      expect(result.repetitions).toBe(3);
      expect(result.ease_factor).toBe(2.5);
      expect(result.next_review).toBe("2026-02-07");
    });

    test("easy: interval = previous * EF * 1.3 (6 * 2.65 * 1.3 ~ 21)", () => {
      const result = calculateSM2(secondReviewCard, "easy", TODAY);

      // 6 * 2.65 * 1.3 = 20.67, rounded to 21
      expect(result.interval).toBe(21);
      expect(result.repetitions).toBe(3);
      expect(result.ease_factor).toBe(2.65);
    });
  });

  describe("mature card (interval=15, repetitions=3)", () => {
    const matureCard = makeState(15, 2.5, 3);

    test("again: resets completely", () => {
      const result = calculateSM2(matureCard, "again", TODAY);

      expect(result.interval).toBe(1);
      expect(result.repetitions).toBe(0);
      expect(result.ease_factor).toBe(2.3);
    });

    test("good: interval = 15 * 2.5 = 38 (rounded)", () => {
      const result = calculateSM2(matureCard, "good", TODAY);

      expect(result.interval).toBe(38); // 15 * 2.5 = 37.5, rounded to 38
      expect(result.repetitions).toBe(4);
    });

    test("easy: interval = 15 * 2.65 * 1.3 ~ 52", () => {
      const result = calculateSM2(matureCard, "easy", TODAY);

      // 15 * 2.65 * 1.3 = 51.675, rounded to 52
      expect(result.interval).toBe(52);
      expect(result.repetitions).toBe(4);
    });
  });

  describe("long-term progression (good responses)", () => {
    test("simulates standard learning progression", () => {
      // Start with new card
      let state = createNewCardState();

      // Review 1: good -> interval 1
      let result = calculateSM2(state, "good", TODAY);
      expect(result.interval).toBe(1);
      expect(result.repetitions).toBe(1);
      state = { ...result };

      // Review 2: good -> interval 6
      result = calculateSM2(state, "good", "2026-01-24");
      expect(result.interval).toBe(6);
      expect(result.repetitions).toBe(2);
      state = { ...result };

      // Review 3: good -> interval 15 (6 * 2.5)
      result = calculateSM2(state, "good", "2026-01-30");
      expect(result.interval).toBe(15);
      expect(result.repetitions).toBe(3);
      state = { ...result };

      // Review 4: good -> interval 38 (15 * 2.5 = 37.5, rounded)
      result = calculateSM2(state, "good", "2026-02-14");
      expect(result.interval).toBe(38);
      expect(result.repetitions).toBe(4);
      state = { ...result };

      // Review 5: good -> interval 95 (38 * 2.5)
      result = calculateSM2(state, "good", "2026-03-24");
      expect(result.interval).toBe(95);
      expect(result.repetitions).toBe(5);
    });
  });
});

// =============================================================================
// Ease Factor Tests
// =============================================================================

describe("ease factor behavior", () => {
  test("minimum ease factor is 1.3 (REQ-F-32)", () => {
    const lowEfCard = makeState(6, 1.3, 2);

    // Even "again" shouldn't go below 1.3
    const result = calculateSM2(lowEfCard, "again", TODAY);
    expect(result.ease_factor).toBe(MIN_EASE_FACTOR);
  });

  test("ease factor capped at 3.0", () => {
    const highEfCard = makeState(6, 3.0, 2);

    // "easy" shouldn't exceed 3.0
    const result = calculateSM2(highEfCard, "easy", TODAY);
    expect(result.ease_factor).toBe(MAX_EASE_FACTOR);
  });

  test("repeated again responses bottom out at 1.3", () => {
    let state = makeState(6, 2.5, 2);

    // Multiple "again" responses
    for (let i = 0; i < 10; i++) {
      const result = calculateSM2(state, "again", TODAY);
      state = { ...result };
    }

    expect(state.ease_factor).toBe(MIN_EASE_FACTOR);
  });

  test("repeated easy responses cap at 3.0", () => {
    let state = createNewCardState();

    // Multiple "easy" responses
    for (let i = 0; i < 10; i++) {
      const result = calculateSM2(state, "easy", TODAY);
      state = { ...result };
    }

    expect(state.ease_factor).toBe(MAX_EASE_FACTOR);
  });

  test("ease factor adjustments match expected values", () => {
    const baseCard = makeState(6, 2.5, 2);

    expect(calculateSM2(baseCard, "again", TODAY).ease_factor).toBe(2.3);
    expect(calculateSM2(baseCard, "hard", TODAY).ease_factor).toBe(2.35);
    expect(calculateSM2(baseCard, "good", TODAY).ease_factor).toBe(2.5);
    expect(calculateSM2(baseCard, "easy", TODAY).ease_factor).toBe(2.65);
  });
});

// =============================================================================
// Date Calculation Tests
// =============================================================================

describe("next_review date calculation", () => {
  test("correctly adds days to date", () => {
    const card = makeState(10, 2.5, 2);
    const result = calculateSM2(card, "good", "2026-01-15");

    // 10 * 2.5 = 25 days
    expect(result.interval).toBe(25);
    expect(result.next_review).toBe("2026-02-09");
  });

  test("handles month boundaries", () => {
    const card = makeState(6, 2.5, 2);
    const result = calculateSM2(card, "good", "2026-01-28");

    // 6 * 2.5 = 15 days from Jan 28 = Feb 12
    expect(result.next_review).toBe("2026-02-12");
  });

  test("handles year boundaries", () => {
    const card = makeState(6, 2.5, 2);
    const result = calculateSM2(card, "good", "2026-12-20");

    // 15 days from Dec 20 = Jan 4
    expect(result.next_review).toBe("2027-01-04");
  });

  test("handles leap year", () => {
    const card = makeState(1, 2.5, 1);
    const result = calculateSM2(card, "good", "2028-02-25");

    // 6 days from Feb 25, 2028 (leap year) = Mar 2
    expect(result.interval).toBe(6);
    expect(result.next_review).toBe("2028-03-02");
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("edge cases", () => {
  test("card with very high interval", () => {
    const longCard = makeState(365, 2.5, 10);
    const result = calculateSM2(longCard, "good", TODAY);

    // 365 * 2.5 = 912.5, Math.round rounds to 913
    expect(result.interval).toBe(913);
  });

  test("card with minimum ease factor", () => {
    const hardCard = makeState(6, MIN_EASE_FACTOR, 2);
    const result = calculateSM2(hardCard, "good", TODAY);

    // 6 * 1.3 = 7.8, rounded to 8
    expect(result.interval).toBe(8);
  });

  test("hard response on interval=1 guarantees at least 2 days", () => {
    const card = makeState(1, 2.5, 1);
    const result = calculateSM2(card, "hard", TODAY);

    // 1 * 1.2 = 1.2, but we guarantee at least interval+1
    expect(result.interval).toBeGreaterThanOrEqual(2);
  });

  test("hard response always increases interval for established cards", () => {
    const card = makeState(10, 2.5, 3);
    const result = calculateSM2(card, "hard", TODAY);

    expect(result.interval).toBeGreaterThan(card.interval);
  });
});

// =============================================================================
// Regression Tests for SM-2 Reference Values
// =============================================================================

describe("SM-2 reference implementation values", () => {
  /**
   * These tests validate against expected SM-2 behavior.
   * The standard SM-2 algorithm uses:
   * - First successful review: interval = 1
   * - Second successful review: interval = 6
   * - Subsequent: interval = previous * EF
   */

  test("standard progression matches SM-2", () => {
    // New card with default EF=2.5
    const newCard = createNewCardState();

    // First review (good): interval becomes 1
    const r1 = calculateSM2(newCard, "good", TODAY);
    expect(r1.interval).toBe(1);

    // Second review (good): interval becomes 6
    const r2 = calculateSM2(r1, "good", "2026-01-24");
    expect(r2.interval).toBe(6);

    // Third review (good): interval = 6 * 2.5 = 15
    const r3 = calculateSM2(r2, "good", "2026-01-30");
    expect(r3.interval).toBe(15);
  });

  test("again always resets learning state", () => {
    // Even a mature card resets completely on "again"
    const matureCard = makeState(100, 2.8, 8);
    const result = calculateSM2(matureCard, "again", TODAY);

    expect(result.interval).toBe(1);
    expect(result.repetitions).toBe(0);
  });

  test("EF adjustment formula approximates SM-2", () => {
    // Original SM-2: EF' = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02))
    // q=1 (again): EF' = EF + (0.1 - 4 * (0.08 + 4*0.02)) = EF - 0.54 (we use -0.2)
    // q=2 (hard):  EF' = EF + (0.1 - 3 * (0.08 + 3*0.02)) = EF - 0.32 (we use -0.15)
    // q=3 (good):  EF' = EF + (0.1 - 2 * (0.08 + 2*0.02)) = EF - 0.14 (we use 0)
    // q=4 (easy):  EF' = EF + (0.1 - 1 * (0.08 + 1*0.02)) = EF + 0.0  (we use +0.15)

    // Our simplified adjustments are intentionally less aggressive than original SM-2
    // to prevent EF from dropping too fast
    const card = makeState(6, 2.5, 2);

    expect(calculateSM2(card, "again", TODAY).ease_factor).toBe(2.3);
    expect(calculateSM2(card, "hard", TODAY).ease_factor).toBe(2.35);
    expect(calculateSM2(card, "good", TODAY).ease_factor).toBe(2.5);
    expect(calculateSM2(card, "easy", TODAY).ease_factor).toBe(2.65);
  });
});

// =============================================================================
// Utility Function Tests
// =============================================================================

describe("createNewCardState", () => {
  test("returns default SM-2 values (REQ-F-34)", () => {
    const state = createNewCardState();

    expect(state.interval).toBe(0);
    expect(state.repetitions).toBe(0);
    expect(state.ease_factor).toBe(DEFAULT_EASE_FACTOR);
  });

  test("default ease factor is 2.5 (REQ-F-31)", () => {
    expect(DEFAULT_EASE_FACTOR).toBe(2.5);
  });
});

describe("isValidCardState", () => {
  test("accepts valid states", () => {
    expect(isValidCardState({ interval: 0, ease_factor: 2.5, repetitions: 0 })).toBe(true);
    expect(isValidCardState({ interval: 30, ease_factor: 1.3, repetitions: 5 })).toBe(true);
    expect(isValidCardState({ interval: 100, ease_factor: 3.0, repetitions: 10 })).toBe(true);
  });

  test("rejects negative interval", () => {
    expect(isValidCardState({ interval: -1, ease_factor: 2.5, repetitions: 0 })).toBe(false);
  });

  test("rejects ease factor below minimum", () => {
    expect(isValidCardState({ interval: 0, ease_factor: 1.2, repetitions: 0 })).toBe(false);
  });

  test("rejects negative repetitions", () => {
    expect(isValidCardState({ interval: 0, ease_factor: 2.5, repetitions: -1 })).toBe(false);
  });

  test("rejects non-integer repetitions", () => {
    expect(isValidCardState({ interval: 0, ease_factor: 2.5, repetitions: 1.5 })).toBe(false);
  });
});

describe("isValidResponse", () => {
  test("accepts valid responses", () => {
    expect(isValidResponse("again")).toBe(true);
    expect(isValidResponse("hard")).toBe(true);
    expect(isValidResponse("good")).toBe(true);
    expect(isValidResponse("easy")).toBe(true);
  });

  test("rejects invalid responses", () => {
    expect(isValidResponse("invalid")).toBe(false);
    expect(isValidResponse("")).toBe(false);
    expect(isValidResponse("GOOD")).toBe(false);
    expect(isValidResponse("0")).toBe(false);
  });
});

// =============================================================================
// Constants Tests
// =============================================================================

describe("constants", () => {
  test("DEFAULT_EASE_FACTOR is 2.5 (REQ-F-31)", () => {
    expect(DEFAULT_EASE_FACTOR).toBe(2.5);
  });

  test("MIN_EASE_FACTOR is 1.3 (REQ-F-32)", () => {
    expect(MIN_EASE_FACTOR).toBe(1.3);
  });

  test("MAX_EASE_FACTOR provides upper bound", () => {
    expect(MAX_EASE_FACTOR).toBe(3.0);
  });
});
