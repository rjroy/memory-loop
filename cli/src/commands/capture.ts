/**
 * Capture command: append text to today's daily note
 */

import { daemonJson, resolveVault } from "../client";
import type { CommandResult } from "../types";
import { EXIT_SUCCESS } from "../types";

export async function executeCapture(
  args: Record<string, string>,
): Promise<CommandResult> {
  const vaultId = await resolveVault(args.vault);
  let text = args.text;

  // Read from stdin if text is "-"
  if (text === "-") {
    const chunks: string[] = [];
    const reader = Bun.stdin.stream().getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(new TextDecoder().decode(value));
      }
    } finally {
      reader.releaseLock();
    }
    text = chunks.join("");
  }

  const data = await daemonJson(
    `/vaults/${encodeURIComponent(vaultId)}/capture`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    },
  );
  return { data, exitCode: EXIT_SUCCESS };
}
