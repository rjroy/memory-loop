/**
 * Cards commands: due, review
 */

import { daemonJson, resolveVault } from "../client";
import type { CommandResult } from "../types";
import { EXIT_SUCCESS, EXIT_USAGE_ERROR } from "../types";

export async function executeCardsDue(
  args: Record<string, string>,
): Promise<CommandResult> {
  const vaultId = await resolveVault(args.vault);
  const data = await daemonJson(
    `/vaults/${encodeURIComponent(vaultId)}/cards/due`,
  );
  return { data, exitCode: EXIT_SUCCESS };
}

const RATING_MAP: Record<string, string> = {
  again: "again",
  hard: "hard",
  good: "good",
  easy: "easy",
  "0": "again",
  "1": "hard",
  "2": "good",
  "3": "easy",
};

export async function executeCardsReview(
  args: Record<string, string>,
): Promise<CommandResult> {
  const vaultId = await resolveVault(args.vault);
  const rating = RATING_MAP[args.rating.toLowerCase()];
  if (!rating) {
    return {
      data: {
        error: `Invalid rating: "${args.rating}". Use: again, hard, good, easy (or 0-3).`,
        code: "INVALID_RATING",
      },
      exitCode: EXIT_USAGE_ERROR,
    };
  }

  const data = await daemonJson(
    `/vaults/${encodeURIComponent(vaultId)}/cards/${encodeURIComponent(args.id)}/review`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: rating }),
    },
  );
  return { data, exitCode: EXIT_SUCCESS };
}
