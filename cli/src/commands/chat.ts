/**
 * Chat commands: send, stream, abort, history
 */

import {
  daemonJson,
  daemonSSE,
  daemonFetch,
  resolveVault,
  DaemonApiError,
} from "../client";
import { formatStreamEvent } from "../formatter";
import type { CommandResult, GlobalFlags } from "../types";
import { EXIT_SUCCESS, EXIT_APP_ERROR } from "../types";

export async function executeChatSend(
  args: Record<string, string>,
  flags: Record<string, unknown>,
  globalFlags: GlobalFlags,
): Promise<CommandResult> {
  const vaultId = await resolveVault(args.vault);

  // Look up vault info to get vaultPath
  const vaultInfo = await daemonJson<{ path: string }>(
    `/vaults/${encodeURIComponent(vaultId)}`,
  );

  const body: Record<string, unknown> = {
    vaultId,
    vaultPath: vaultInfo.path,
    prompt: args.message,
  };

  if (flags.session) {
    body.sessionId = flags.session as string;
  }

  let data: { sessionId: string };
  try {
    data = await daemonJson<{ sessionId: string }>("/session/chat/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof DaemonApiError && error.statusCode === 409) {
      return {
        data: {
          ...error.errorBody,
          error: "A chat session is already active.",
          detail:
            "Use 'chat abort <sessionId>' to stop it, or wait for it to complete.",
        },
        exitCode: EXIT_APP_ERROR,
      };
    }
    throw error;
  }

  // If --stream flag, follow up with streaming
  if (flags.stream) {
    await streamSession(globalFlags);
    return { data: { sessionId: data.sessionId, streamed: true }, exitCode: EXIT_SUCCESS };
  }

  return { data, exitCode: EXIT_SUCCESS };
}

export async function executeChatStream(
  _args: Record<string, string>,
  _flags: Record<string, unknown>,
  globalFlags: GlobalFlags,
): Promise<CommandResult> {
  await streamSession(globalFlags);
  return { data: { completed: true }, exitCode: EXIT_SUCCESS };
}

async function streamSession(globalFlags: GlobalFlags): Promise<void> {
  const abortController = new AbortController();
  let aborted = false;

  const abortHandler = () => {
    if (aborted) {
      // Second Ctrl+C: force quit
      process.exit(130);
    }
    aborted = true;
    abortController.abort();
    daemonFetch("/session/chat/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => {
      // Best-effort abort
    });
  };

  process.on("SIGINT", abortHandler);

  try {
    for await (const event of daemonSSE("/session/chat/stream", {
      signal: abortController.signal,
    })) {

      let eventData: unknown;
      try {
        eventData = JSON.parse(event.data);
      } catch {
        eventData = { type: "raw", data: event.data };
      }

      const output = formatStreamEvent(eventData, globalFlags);
      if (output !== null) {
        process.stdout.write(output);
        if (!globalFlags.human) {
          process.stdout.write("\n");
        }
      }

      // Check for terminal events
      const obj = eventData as Record<string, unknown>;
      if (
        obj.type === "response_end" ||
        obj.type === "error" ||
        obj.type === "session_cleared"
      ) {
        break;
      }
    }
  } finally {
    process.removeListener("SIGINT", abortHandler);
  }
}

export async function executeChatAbort(
  args: Record<string, string>,
): Promise<CommandResult> {
  const data = await daemonJson("/session/chat/abort", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: args.session }),
  });
  return { data, exitCode: EXIT_SUCCESS };
}

export async function executeChatHistory(
  args: Record<string, string>,
): Promise<CommandResult> {
  const vaultId = await resolveVault(args.vault);
  const data = await daemonJson(
    `/session/lookup/${encodeURIComponent(vaultId)}`,
  );
  return { data, exitCode: EXIT_SUCCESS };
}
