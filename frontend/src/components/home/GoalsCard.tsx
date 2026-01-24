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
 * GoalsCard displays goals.md content as rendered markdown.
 *
 * - Shows full markdown content from the vault's goals.md file
 * - Supports all markdown formatting (headers, lists, bold, etc.)
 * - Returns null if no goals file exists in the vault
 * - Clicking the card triggers /review-goals command
 */
export function GoalsCard(): React.ReactNode {
  const { goals, setDiscussionPrefill, setMode } = useSession();

  const handleClick = useCallback(() => {
    setDiscussionPrefill("/review-goals");
    setMode("discussion");
  }, [setDiscussionPrefill, setMode]);

  // Don't render if no goals content
  if (!goals) {
    return null;
  }

  return (
    <button
      type="button"
      className="goals-card"
      onClick={handleClick}
      aria-label="Review goals"
    >
      <div className="goals-card__content">
        <Markdown remarkPlugins={[remarkGfm]}>{goals}</Markdown>
      </div>
    </button>
  );
}
