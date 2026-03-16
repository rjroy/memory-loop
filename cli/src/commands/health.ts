/**
 * Health command: daemon status
 */

import { daemonJson } from "../client";
import type { CommandResult } from "../types";
import { EXIT_SUCCESS } from "../types";

export async function executeHealth(): Promise<CommandResult> {
  const data = await daemonJson("/health");
  return { data, exitCode: EXIT_SUCCESS };
}
