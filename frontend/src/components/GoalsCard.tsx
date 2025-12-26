/**
 * GoalsCard Component
 *
 * Displays goals from the vault's goals.md file.
 * Shows sections with headers and items parsed from markdown.
 */

import React from "react";
import { useSession } from "../contexts/SessionContext";
import "./GoalsCard.css";

/**
 * GoalsCard displays goals from goals.md organized by sections.
 *
 * - Shows goals from the vault's 06_Metadata/memory-loop/goals.md file
 * - Displays sections with their markdown headers as titles
 * - Shows "..." if a section has more than 9 items
 * - Returns null if no goals file exists in the vault
 */
export function GoalsCard(): React.ReactNode {
  const { goals } = useSession();

  // Don't render if no goals data (either no goals file or not yet loaded)
  if (goals === null) {
    return null;
  }

  // Don't render if there are no sections
  if (goals.length === 0) {
    return null;
  }

  return (
    <section className="goals-card" aria-label="Goals">
      {goals.map((section, sectionIndex) => (
        <div key={sectionIndex} className="goals-card__section">
          <h3 className="goals-card__heading">{section.title}</h3>
          <ul className="goals-card__list" role="list">
            {section.items.map((item, itemIndex) => (
              <li
                key={itemIndex}
                className="goals-card__item"
                aria-label={item}
              >
                <span className="goals-card__bullet" aria-hidden="true">
                  •
                </span>
                <span className="goals-card__text">{item}</span>
              </li>
            ))}
            {section.hasMore && (
              <li className="goals-card__item goals-card__item--more">
                <span className="goals-card__bullet" aria-hidden="true">
                  &nbsp;
                </span>
                <span className="goals-card__text goals-card__text--more">
                  ...
                </span>
              </li>
            )}
          </ul>
        </div>
      ))}
    </section>
  );
}
