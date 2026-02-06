/**
 * InspirationCard Component
 *
 * Displays contextual prompts and inspirational quotes.
 * Clicking an item prefills the discussion input and switches to discussion mode.
 */

import React, { useCallback } from "react";
import { useSession } from "../../contexts/SessionContext";
import type { InspirationItem } from "@/lib/schemas";
import "./InspirationCard.css";

/**
 * Props for InspirationCard component.
 */
export interface InspirationCardProps {
  /** Contextual prompt (null if not available or on weekends) */
  contextual: InspirationItem | null;
  /** Inspirational quote (null during loading or if unavailable) */
  quote: InspirationItem | null;
  /** Whether data is still loading */
  isLoading?: boolean;
}

/**
 * Displays inspiration content with click-to-discuss behavior.
 *
 * Shows contextual prompt at top (if present) and quote at bottom.
 * Clicking either item prefills discussion input and switches mode.
 */
export function InspirationCard({
  contextual,
  quote,
  isLoading = false,
}: InspirationCardProps): React.ReactNode {
  const { setMode, setDiscussionPrefill } = useSession();

  // Handle click on an inspiration item
  const handleClick = useCallback(
    (text: string) => {
      setDiscussionPrefill(text);
      setMode("discussion");
    },
    [setDiscussionPrefill, setMode]
  );

  // Show skeleton if loading or no quote available
  if (isLoading || !quote) {
    return (
      <section className="inspiration-card inspiration-card--loading" aria-label="Inspiration">
        <div className="inspiration-card__skeleton">
          <div className="inspiration-card__skeleton-line" />
          <div className="inspiration-card__skeleton-line inspiration-card__skeleton-line--short" />
        </div>
      </section>
    );
  }

  return (
    <section className="inspiration-card" aria-label="Inspiration">
      <button
        type="button"
        className="inspiration-card__item inspiration-card__quote inspiration-card__item--enter"
        onClick={() => handleClick(quote.text)}
        aria-label="Use this quote for discussion"
      >
        <p className="inspiration-card__text">&ldquo;{quote.text}&rdquo;</p>
        {quote.attribution && (
          <span className="inspiration-card__attribution">
            -- {quote.attribution}
          </span>
        )}
      </button>

      {contextual && (
        <button
          type="button"
          className="inspiration-card__item inspiration-card__prompt inspiration-card__item--enter"
          onClick={() => handleClick(contextual.text)}
          aria-label="Use this prompt for discussion"
        >
          <p className="inspiration-card__text">{contextual.text}</p>
          {contextual.attribution && (
            <span className="inspiration-card__attribution">
              -- {contextual.attribution}
            </span>
          )}
        </button>
      )}
    </section>
  );
}
