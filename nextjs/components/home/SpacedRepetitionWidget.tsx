/**
 * SpacedRepetitionWidget Component
 *
 * Displays due flashcards and allows users to review them with spaced repetition.
 * Shows question, allows answer input, and provides self-assessment buttons.
 *
 * Requirements:
 * - REQ-F-31: Display due cards from GET /api/vaults/:vaultId/cards/due
 * - REQ-F-32: Fetch card detail (with answer) via GET /api/vaults/:vaultId/cards/:cardId
 * - REQ-F-33: Submit review via POST /api/vaults/:vaultId/cards/:cardId/review
 * - REQ-F-34: Archive card via POST /api/vaults/:vaultId/cards/:cardId/archive
 */

import React, { useEffect, useState, useCallback, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSession } from "../../contexts/SessionContext";
import { useCards } from "../../hooks/useCards";
import { ConfirmDialog } from "../shared/ConfirmDialog";
import type { DueCard, CardDetail, ReviewResponse } from "@memory-loop/shared";
import type { FetchFn } from "@/lib/api/types";
import "./SpacedRepetitionWidget.css";

/**
 * Props for SpacedRepetitionWidget component.
 */
export interface SpacedRepetitionWidgetProps {
  /** Vault ID to fetch cards from */
  vaultId: string | undefined;
  /** Custom fetch implementation for testing */
  fetchFn?: FetchFn;
}

/**
 * Widget state machine phases.
 * - loading: Initial fetch in progress
 * - idle: No cards due today
 * - question: Showing question, awaiting user input
 * - revealed: Answer shown, awaiting self-assessment
 * - complete: All cards reviewed for this session
 */
type WidgetPhase = "loading" | "idle" | "question" | "revealed" | "complete";

/**
 * Internal widget state.
 */
interface WidgetState {
  phase: WidgetPhase;
  /** Current card being reviewed */
  currentCard: DueCard | null;
  /** Full card detail (with answer) when revealed */
  cardDetail: CardDetail | null;
  /** User's typed answer */
  userAnswer: string;
  /** Queue of remaining cards to review */
  queue: DueCard[];
  /** Initial count of due cards (for header display) */
  initialCount: number;
  /** Whether we've started a review session */
  sessionStarted: boolean;
  /** Whether the initial fetch failed (hide widget on error) */
  fetchFailed: boolean;
}

const INITIAL_STATE: WidgetState = {
  phase: "loading",
  currentCard: null,
  cardDetail: null,
  userAnswer: "",
  queue: [],
  initialCount: 0,
  sessionStarted: false,
  fetchFailed: false,
};

/**
 * Assessment button configuration.
 */
const ASSESSMENT_BUTTONS: Array<{
  response: ReviewResponse;
  label: string;
  shortcut: string;
  className: string;
}> = [
  { response: "again", label: "Again", shortcut: "1", className: "again" },
  { response: "hard", label: "Hard", shortcut: "2", className: "hard" },
  { response: "good", label: "Good", shortcut: "3", className: "good" },
  { response: "easy", label: "Easy", shortcut: "4", className: "easy" },
];

/**
 * SpacedRepetitionWidget displays due flashcards for review.
 *
 * Flow:
 * 1. Load due cards on mount
 * 2. Show question, allow user to type answer
 * 3. User can Skip (move to end), Forget (archive), or Show Answer
 * 4. After revealing, user self-assesses with Again/Hard/Good/Easy
 * 5. Repeat until queue is empty, then show completion message
 *
 * @returns null if no cards are due, otherwise renders the review widget
 */
export function SpacedRepetitionWidget({
  vaultId,
  fetchFn,
}: SpacedRepetitionWidgetProps): React.ReactNode {
  const [state, setState] = useState<WidgetState>(INITIAL_STATE);
  const [showForgetConfirm, setShowForgetConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { setMode, setCurrentPath } = useSession();
  const { getDueCards, getCard, submitReview, archiveCard, isLoading, error } =
    useCards(vaultId, { fetch: fetchFn });

  /**
   * Load due cards when vault changes.
   */
  useEffect(() => {
    if (!vaultId) {
      setState(INITIAL_STATE);
      return;
    }

    setState((prev) => ({ ...prev, phase: "loading" }));

    getDueCards()
      .then((result) => {
        // API error (returns null on failure) - hide widget
        if (result === null) {
          setState({ ...INITIAL_STATE, fetchFailed: true });
          return;
        }

        // No cards due - show idle state
        if (result.count === 0) {
          setState({
            ...INITIAL_STATE,
            phase: "idle",
            sessionStarted: true,
          });
          return;
        }

        // Cards available - show first question
        const cards = result.cards;
        setState({
          phase: "question",
          currentCard: cards[0],
          cardDetail: null,
          userAnswer: "",
          queue: cards.slice(1),
          initialCount: result.count,
          sessionStarted: true,
          fetchFailed: false,
        });
      })
      .catch(() => {
        // Unexpected error - hide widget
        setState({ ...INITIAL_STATE, fetchFailed: true });
      });
  }, [vaultId, getDueCards]);

  /**
   * Focus input when entering question phase.
   */
  useEffect(() => {
    if (state.phase === "question" && inputRef.current) {
      inputRef.current.focus();
    }
  }, [state.phase, state.currentCard?.id]);

  /**
   * Move to the next card or complete state.
   */
  const advanceToNextCard = useCallback(() => {
    setState((prev) => {
      if (prev.queue.length === 0) {
        return {
          ...prev,
          phase: "complete",
          currentCard: null,
          cardDetail: null,
          userAnswer: "",
        };
      }

      const [nextCard, ...remainingQueue] = prev.queue;
      return {
        ...prev,
        phase: "question",
        currentCard: nextCard,
        cardDetail: null,
        userAnswer: "",
        queue: remainingQueue,
      };
    });
  }, []);

  /**
   * Handle Skip action: move current card to end of queue.
   */
  const handleSkip = useCallback(() => {
    setState((prev) => {
      if (!prev.currentCard) return prev;

      const newQueue = [...prev.queue, prev.currentCard];
      const [nextCard, ...remainingQueue] = newQueue;

      return {
        ...prev,
        phase: "question",
        currentCard: nextCard,
        cardDetail: null,
        userAnswer: "",
        queue: remainingQueue,
      };
    });
  }, []);

  /**
   * Handle Forget action: archive the card (requires confirmation).
   */
  const handleForgetConfirm = useCallback(async () => {
    if (!state.currentCard) return;

    const result = await archiveCard(state.currentCard.id);
    setShowForgetConfirm(false);

    if (result) {
      // Successfully archived, move to next card
      setState((prev) => ({
        ...prev,
        initialCount: prev.initialCount - 1,
      }));
      advanceToNextCard();
    }
  }, [state.currentCard, archiveCard, advanceToNextCard]);

  /**
   * Handle Show Answer action: fetch full card detail.
   */
  const handleShowAnswer = useCallback(async () => {
    if (!state.currentCard) return;

    const detail = await getCard(state.currentCard.id);
    if (detail) {
      setState((prev) => ({
        ...prev,
        phase: "revealed",
        cardDetail: detail,
      }));
    }
  }, [state.currentCard, getCard]);

  /**
   * Handle self-assessment after revealing answer.
   */
  const handleAssessment = useCallback(
    async (response: ReviewResponse) => {
      if (!state.currentCard) return;

      const result = await submitReview(state.currentCard.id, response);
      if (result) {
        advanceToNextCard();
      }
    },
    [state.currentCard, submitReview, advanceToNextCard]
  );

  /**
   * Handle Open Source action: navigate to source file in Recall tab.
   * Used in revealed phase to view the original note.
   */
  const handleOpenSource = useCallback(() => {
    if (!state.cardDetail?.source_file) return;
    setCurrentPath(state.cardDetail.source_file);
    setMode("browse");
  }, [state.cardDetail?.source_file, setCurrentPath, setMode]);

  /**
   * Handle Open Card action: navigate to card file in Recall tab.
   * Used in question phase to edit the card (e.g., fix the question).
   */
  const handleOpenCard = useCallback(() => {
    if (!state.currentCard?.card_file) return;
    setCurrentPath(state.currentCard.card_file);
    setMode("browse");
  }, [state.currentCard?.card_file, setCurrentPath, setMode]);

  /**
   * Handle keyboard shortcuts for assessment (1/2/3/4 keys).
   * Must be defined after handleAssessment to avoid reference error.
   */
  useEffect(() => {
    if (state.phase !== "revealed") return;

    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const shortcutIndex = ["1", "2", "3", "4"].indexOf(e.key);
      if (shortcutIndex !== -1) {
        e.preventDefault();
        const response = ASSESSMENT_BUTTONS[shortcutIndex].response;
        void handleAssessment(response);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.phase, state.currentCard?.id, handleAssessment]);

  /**
   * Handle answer input change.
   */
  const handleAnswerChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setState((prev) => ({ ...prev, userAnswer: e.target.value }));
    },
    []
  );

  /**
   * Handle Enter key in answer input.
   */
  const handleAnswerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void handleShowAnswer();
      }
    },
    [handleShowAnswer]
  );

  // Don't render if no vault or if initial fetch failed
  if (!vaultId) return null;
  if (state.fetchFailed) return null;

  // Calculate remaining cards for header (0 during loading/idle)
  const remainingCount = state.queue.length + (state.currentCard ? 1 : 0);

  // Show loading state during initial fetch
  const showLoading = state.phase === "loading";

  return (
    <>
      <section
        className="spaced-repetition-widget"
        aria-label="Spaced repetition review"
      >
        {/* Header */}
        <header className="spaced-repetition-widget__header">
          <h3 className="spaced-repetition-widget__title">Spaced Repetition</h3>
          {!showLoading && state.phase !== "idle" && (
            <span className="spaced-repetition-widget__count">
              {remainingCount} {remainingCount === 1 ? "card" : "cards"}
            </span>
          )}
        </header>

        {/* Loading state */}
        {showLoading && (
          <div className="spaced-repetition-widget__loading">
            <div className="spaced-repetition-widget__spinner" />
            <span>Loading cards...</span>
          </div>
        )}

        {/* Idle state - no cards due */}
        {state.phase === "idle" && (
          <div className="spaced-repetition-widget__idle">
            <span className="spaced-repetition-widget__idle-message">
              No cards due today
            </span>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="spaced-repetition-widget__error" role="alert">
            {error}
          </div>
        )}

        {/* Question phase */}
        {state.phase === "question" && state.currentCard && (
          <>
            <div className="spaced-repetition-widget__question">
              <Markdown remarkPlugins={[remarkGfm]}>
                {state.currentCard.question}
              </Markdown>
            </div>

            <input
              ref={inputRef}
              type="text"
              className="spaced-repetition-widget__input"
              placeholder="Type your answer..."
              value={state.userAnswer}
              onChange={handleAnswerChange}
              onKeyDown={handleAnswerKeyDown}
              aria-label="Your answer"
              disabled={isLoading}
            />

            <div className="spaced-repetition-widget__actions">
              <button
                type="button"
                className="spaced-repetition-widget__btn spaced-repetition-widget__btn--skip"
                onClick={handleSkip}
                disabled={isLoading}
                aria-label="Skip this card"
              >
                Skip
              </button>
              <button
                type="button"
                className="spaced-repetition-widget__btn spaced-repetition-widget__btn--forget"
                onClick={() => setShowForgetConfirm(true)}
                disabled={isLoading}
                aria-label="Forget this card"
              >
                Forget
              </button>
              {state.currentCard?.card_file && (
                <button
                  type="button"
                  className="spaced-repetition-widget__btn spaced-repetition-widget__btn--open"
                  onClick={handleOpenCard}
                  disabled={isLoading}
                  aria-label="Open card file in Recall tab"
                >
                  Open
                </button>
              )}
              <button
                type="button"
                className="spaced-repetition-widget__btn spaced-repetition-widget__btn--reveal"
                onClick={() => void handleShowAnswer()}
                disabled={isLoading}
                aria-label="Show answer"
              >
                Show Answer
              </button>
            </div>
          </>
        )}

        {/* Revealed phase */}
        {state.phase === "revealed" && state.cardDetail && (
          <>
            <div className="spaced-repetition-widget__question">
              <Markdown remarkPlugins={[remarkGfm]}>
                {state.cardDetail.question}
              </Markdown>
            </div>

            {state.userAnswer && (
              <div className="spaced-repetition-widget__user-answer">
                <span className="spaced-repetition-widget__user-answer-label">
                  Your answer:
                </span>
                <span className="spaced-repetition-widget__user-answer-text">
                  {state.userAnswer}
                </span>
              </div>
            )}

            <div className="spaced-repetition-widget__answer">
              <span className="spaced-repetition-widget__answer-label">
                Answer:
              </span>
              <div className="spaced-repetition-widget__answer-content">
                <Markdown remarkPlugins={[remarkGfm]}>
                  {state.cardDetail.answer}
                </Markdown>
              </div>
            </div>

            {state.cardDetail.source_file && (
              <div className="spaced-repetition-widget__source">
                <span className="spaced-repetition-widget__source-text">
                  Source: {state.cardDetail.source_file}
                </span>
                <button
                  type="button"
                  className="spaced-repetition-widget__btn spaced-repetition-widget__btn--open"
                  onClick={handleOpenSource}
                  aria-label="Open source file in Recall tab"
                >
                  Open
                </button>
              </div>
            )}

            <div className="spaced-repetition-widget__assessment">
              <span className="spaced-repetition-widget__assessment-label">
                How well did you remember?
              </span>
              <div className="spaced-repetition-widget__assessment-buttons">
                {ASSESSMENT_BUTTONS.map((btn) => (
                  <button
                    key={btn.response}
                    type="button"
                    className={`spaced-repetition-widget__btn spaced-repetition-widget__btn--${btn.className}`}
                    onClick={() => void handleAssessment(btn.response)}
                    disabled={isLoading}
                    aria-label={`${btn.label} (keyboard shortcut: ${btn.shortcut})`}
                  >
                    <span className="spaced-repetition-widget__btn-label">
                      {btn.label}
                    </span>
                    <span className="spaced-repetition-widget__btn-shortcut">
                      {btn.shortcut}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Complete phase */}
        {state.phase === "complete" && (
          <div className="spaced-repetition-widget__complete">
            <span className="spaced-repetition-widget__complete-icon">
              &#10003;
            </span>
            <span className="spaced-repetition-widget__complete-message">
              Great job today!
            </span>
            <span className="spaced-repetition-widget__complete-count">
              {state.initialCount} {state.initialCount === 1 ? "card" : "cards"}{" "}
              reviewed
            </span>
          </div>
        )}
      </section>

      {/* Forget confirmation dialog */}
      <ConfirmDialog
        isOpen={showForgetConfirm}
        title="Forget Card"
        message="Are you sure you want to forget this card? It will be removed from your review rotation permanently."
        confirmLabel="Forget"
        onConfirm={() => void handleForgetConfirm()}
        onCancel={() => setShowForgetConfirm(false)}
      />
    </>
  );
}
