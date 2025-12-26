/**
 * GoalsCard Component
 *
 * Displays active goals from the vault's goals.md file.
 * Shows a compact card on the Home View with the user's current goals.
 */

import React from "react";
import { useSession } from "../contexts/SessionContext";
import "./GoalsCard.css";

/**
 * GoalsCard displays the user's active goals from goals.md.
 *
 * - Shows goals from the vault's 06_Metadata/memory-loop/goals.md file
 * - Displays incomplete goals first, then completed goals
 * - Returns null if no goals file exists in the vault
 */
export function GoalsCard(): React.ReactNode {
  const { goals, vault } = useSession();

  // Don't render if vault has no goals file or goals haven't loaded
  if (goals === null) {
    // Check if vault has a goals path configured - if so, show loading placeholder
    if (vault?.goalsPath) {
      return null; // Goals are loading, will render once setGoals is called
    }
    return null;
  }

  // Don't render if there are no goals
  if (goals.length === 0) {
    return null;
  }

  // Separate incomplete and completed goals
  const incompleteGoals = goals.filter((g) => !g.completed);
  const completedGoals = goals.filter((g) => g.completed);

  return (
    <section className="goals-card" aria-label="Goals">
      <h3 className="goals-card__heading">Goals</h3>
      <ul className="goals-card__list">
        {incompleteGoals.map((goal, index) => (
          <li key={`incomplete-${index}`} className="goals-card__item">
            <span className="goals-card__checkbox" aria-hidden="true">
              ○
            </span>
            <span className="goals-card__text">{goal.text}</span>
          </li>
        ))}
        {completedGoals.map((goal, index) => (
          <li
            key={`completed-${index}`}
            className="goals-card__item goals-card__item--completed"
          >
            <span className="goals-card__checkbox" aria-hidden="true">
              ●
            </span>
            <span className="goals-card__text">{goal.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
