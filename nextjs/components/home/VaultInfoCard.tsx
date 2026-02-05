/**
 * VaultInfoCard Component
 *
 * Displays vault name and subtitle.
 * Part of the Ground tab restructure (split from context card).
 */

import React from "react";
import "./VaultInfoCard.css";

export interface VaultInfoCardProps {
  /** Vault name to display */
  name: string | undefined;
  /** Optional vault subtitle */
  subtitle: string | undefined;
}

/**
 * VaultInfoCard displays the current vault name and subtitle.
 * No interactive elements - just context information.
 */
export function VaultInfoCard({ name, subtitle }: VaultInfoCardProps): React.ReactNode {
  return (
    <section className="vault-info-card" aria-label="Vault information">
      <span className="vault-info-card__label">Current Vault</span>
      <h2 className="vault-info-card__name">{name ?? "—"}</h2>
      {subtitle && <p className="vault-info-card__subtitle">{subtitle}</p>}
    </section>
  );
}
