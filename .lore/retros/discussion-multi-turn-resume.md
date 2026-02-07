---
title: Bad hook breaks SDK resume, four sessions spent blaming our code
date: 2026-02-06
status: complete
tags: [bug, sdk-lifecycle, session-management, debugging-process, hooks, false-attribution]
modules: [active-session-controller, session-manager, session-streamer, api-chat, useChat]
related: [.lore/_archive/active-session-controller.md, .lore/_archive/session-viewport-separation-spec.md]
---

# Retro: Discussion Multi-Turn Resume Failure

## Summary

Discussion tab couldn't resume sessions. Turn 1 worked, turn 2 got a different session ID from the SDK, turn 3 crashed. Four conversation sessions spent debugging our code (close() behavior, generator draining, session ID migration, sessions-index.json). Root cause: a bad SessionStart hook in the vault's `.claude/settings.json` was interfering with SDK subprocess startup.

## What Actually Happened

The SDK's `settingSources: ["project"]` option tells the subprocess to load `.claude/settings.json` from the project directory. That settings file had a broken SessionStart hook. On create (turn 1), the hook ran and the session completed. On resume (turn 2), the hook created a temporary new session during startup (emitting system events with a different session ID), then fell back to the requested session. Our `extractSessionId()` captured the temporary ID from the first event instead of the real one. On turn 3, we tried to resume the temporary ID, which didn't persist, and the SDK crashed.

The diagnostic that found it: an isolated 30-line script that called `query()` three times with different option combinations. `settingSources: ["project"]` was the variable that reproduced the failure. Removing the bad hook fixed it immediately.

## What Went Well

- **The isolation script was decisive.** After four sessions of reading code and reasoning about subprocess lifecycles, a simple script that called the SDK directly answered the question in minutes. Each config variant took ~30 seconds to run. The bisection (`["local"]` pass, `["project"]` fail, `["user"]` pass) pointed directly at the vault's project settings.
- **The architectural unification was correct regardless.** Collapsing `startSession`/`resumeSession` into `sendMessage` eliminated a real design problem (fake VaultInfo construction, divergent code paths). This was good work even though it didn't fix the bug.
- **Error surfacing gap identified.** Discovered that error events from the SSE stream were captured by `useChat` (`lastError`) but never rendered in the Discussion component. Errors were completely invisible to the user.

## What Could Improve

- **Four sessions before writing an isolation test.** Every session read the same files, reasoned about the same code paths, and proposed fixes based on theory. The isolation script should have been the first thing written, not the last. It cost ~$0.02 in API calls and took 2 minutes to write.
- **Blamed our code instead of checking the environment.** Every debugging session assumed the bug was in our close() calls, our generator handling, or our session ID management. Nobody checked whether the SDK itself was happy with its inputs. The isolation script proved the SDK worked fine in every configuration except one where the vault's settings file was bad.
- **"All tests pass" provided false confidence repeatedly.** Unit tests mock the SDK, so they can't catch bugs at the SDK boundary. This was noted in session 2 and again in session 3, but nobody acted on it. The isolation script IS the integration test we needed.
- **Wrote wrong conclusions in the retro.** The previous version of this retro stated the root cause was `close()` killing the subprocess. That was wrong. The close() changes were tested and shown to be harmless (SDK resume works with or without close() after drain). Writing confident conclusions before verifying them compounded the problem.

## Lessons Learned

- When debugging an integration boundary (your code vs SDK/library), write an isolation script first. Call the SDK directly with minimal code. If it works, the bug is in your code. If it doesn't, vary the inputs until you find which one breaks it. This takes minutes and eliminates entire categories of hypotheses.
- When the same bug survives multiple fix attempts, stop fixing and start observing. Each "try this" fix was a hypothesis we never tested in isolation. The environment (hooks, settings files, configs) is part of the system. Check it.
- Error events that aren't rendered to the user are the same as no error handling. `useChat` captured errors in `lastError` but the Discussion component never displayed them. A user hitting this bug would see a working response followed by silent session corruption.
- When writing a retro, verify the root cause before documenting it. The previous version confidently stated the wrong cause, which would have misdirected future debugging.

## Answers to Previous Unknowns

1. **`close()` after drain is harmless.** Tested: SDK resume works with close() called after full generator drain, without close(), and with close() on error only. All three work. The "forcefully ends" language in the SDK docs is about killing a still-running process, not about preventing persistence on a completed one.
2. **`sessions-index.json` is updated by the SDK, not by our code.** Previous sessions observed it wasn't being updated, but that was because the bad hook was preventing clean session creation.
3. **Different session ID on resume = hook interference.** The SDK emits initial system events from a temporary session created during hook execution, then switches to the resumed session. Our code captured the wrong ID from the first event.
4. **`settingSources: ["project"]` loads `.claude/settings.json` including hooks.** A broken hook in that file breaks the SDK subprocess without any error signal in the events (until the third turn crashes).

## Changes Made

| Session | File | Change | Category |
|---------|------|--------|----------|
| 1-2 | `streaming/types.ts` | `sendMessage` replacing `startSession`/`resumeSession` | Architecture |
| 1-2 | `streaming/active-session-controller.ts` | Single entry point, `resetQueryState()` | Architecture |
| 1-2 | `app/api/chat/route.ts` | Always require `vaultId` and `vaultPath` | Architecture |
| 1-2 | `hooks/useChat.ts` | Always send both fields, added session ID logging | Architecture + Observability |
| 3-4 | `session-manager.ts` | Session ID mismatch detection, `close()` on interface | Error detection |
| 4 | `active-session-controller.ts` | Emit error event on session ID mismatch | Error surfacing |
| 4 | `components/discussion/Discussion.tsx` | Render error events as conversation messages | Error surfacing |

Session 1-2 changes reverted: generator drain in session-streamer (churn from wrong hypothesis).

## Artifacts

- [Design: Active Session Controller](.lore/_archive/active-session-controller.md)
- [Spec: Session Viewport Separation](.lore/_archive/session-viewport-separation-spec.md)
