/**
 * GoalsCard Component
 *
 * Displays goals from the vault's goals.md file as rendered markdown.
 * Clickable to trigger /review-goals command.
 */

import { useCallback } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSession } from "../../contexts/SessionContext";
import "./GoalsCard.css";

/**
 * Props for GoalsCard component.
 */
export interface GoalsCardProps {
  /** Whether goals are still loading */
  isLoading?: boolean;
}

/**
 * GoalsCard displays goals.md content as rendered markdown.
 *
 * - Shows full markdown content from the vault's goals.md file
 * - Supports all markdown formatting (headers, lists, bold, etc.)
 * - Returns null if no goals file exists in the vault
 * - Clicking the card triggers /review-goals command
 */
export function GoalsCard({ isLoading = false }: GoalsCardProps): React.ReactNode {
  const { goals, setDiscussionPrefill, setMode } = useSession();

  const handleClick = useCallback(() => {
    setDiscussionPrefill("/review-goals");
    setMode("discussion");
  }, [setDiscussionPrefill, setMode]);

  // Show skeleton during load
  if (isLoading) {
    return (
      <div className="goals-card goals-card--loading" aria-label="Goals loading">
        <div className="goals-card__skeleton">
          <div className="goals-card__skeleton-header" />
          <div className="goals-card__skeleton-line" />
          <div className="goals-card__skeleton-line goals-card__skeleton-line--short" />
          <div className="goals-card__skeleton-line" />
        </div>
      </div>
    );
  }

  // Don't render if no goals content (vault might not have goalsPath)
  if (!goals) {
    return null;
  }

  return (
    <button
      type="button"
      className="goals-card goals-card--enter"
      onClick={handleClick}
      aria-label="Review goals"
    >
      <div className="goals-card__content">
        <Markdown remarkPlugins={[remarkGfm]}>{goals}</Markdown>
      </div>
    </button>
  );
}
