/**
 * Extract commands: trigger, status
 */

import { daemonJson } from "../client";
import type { CommandResult } from "../types";
import { EXIT_SUCCESS } from "../types";

export async function executeExtractTrigger(): Promise<CommandResult> {
  const data = await daemonJson("/config/extraction/trigger", {
    method: "POST",
  });
  return { data, exitCode: EXIT_SUCCESS };
}

export async function executeExtractStatus(): Promise<CommandResult> {
  const data = await daemonJson("/config/extraction/status");
  return { data, exitCode: EXIT_SUCCESS };
}
