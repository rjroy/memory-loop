---
title: OpenCode 2.2.2 restricted-generation compatibility
date: 2026-11-01
status: completed
tags: [opencode, restricted-generation, permissions, scheduling, pagination, validation]
modules: [backend, ground-generation, think]
related: [.lore/work/research/opencode-2.2.2-validation.md, .lore/work/design/ground-contracts.md, .lore/work/design/think-permissions-context.md]
---

# OpenCode 2.2.2 restricted-generation compatibility

Completed source/owned-fixture evidence for `memory-loop-9ya.7` and the reduced
two-job extension `memory-loop-9ya.8`, separate from the
[earlier full-allow Think characterization](opencode-2.2.2-validation.md). Reuse
these public API facts and retained tests; do not repeat broad SDK discovery,
install another OpenCode or change an operator service to rediscover them. This
record is not approval of arbitrary plugins or activation against personal data.
No tests, builds, services or model calls were run to write this document.

## Pinned boundary and compatibility rules

The baseline is `@opencode/client` and native CLI **2.2.2**, Bun **1.4.3**, Node
**26.13.0**. The official source revision is
`098aa7fd6e02b03d6fc410f0b052038c7d4c5e81`, not upstream main or a binary digest.
Production uses the existing configured operator-managed service and SDK client
factory; only test-owned fixtures launch disposable native processes/providers.

1. **Initial requested model versus effective settings.** If a model object is
   supplied, native readback applies `row.model.variant ?? 'default'`. Compare
   exact provider/model IDs and actual variant against `requested.variant ??
   'default'` **only before an effective baseline exists**. Explicit empty strings
   remain empty at this native API boundary; `||` is wrong. Application config
   validation remains separate. Omitting the entire model delegates selection;
   creation may still return no model. Do not fabricate a model object or put
   explicit `default` into fixture/operator config merely to hide this behavior:
   the selected model's catalog need not advertise a `default` variant.
2. **Pin actual readback.** Persist exact returned agent/model settings; all
   subsequent session and assistant-history comparisons stay strict. Do not
   globally loosen equality or ownership, location, parent, PID/version or
   permission checks. Native remains authoritative for its canonical assistant
   content; correlate the persisted user/prompt ID and input digest, not a busy
   hint or guessed timestamp.
3. **History cursors carry ordering.** Start with `{ sessionID, order: 'asc',
   limit: 50 }`; follow with `{ sessionID, cursor, limit: 50 }`, **without order**.
   Native rejects order plus cursor. Follow the opaque returned cursor, retain
   page/message bounds and reject repeated cursors/messages rather than silently
   truncating. The generation reader currently bounds this to eight 50-item pages;
   that is a job safety bound, not an application conversation-turn quota.

Durable anchors: [generation adapter](../../../backend/ground-generation-native.ts)
(`verify`, `create`, `observe`),
[two-page runtime regression](../../../backend/ground-generation-runtime.test.ts)
(`Ground candidate pagination uses cursor-only continuation and publishes the completed answer`),
and the existing cursor-only Think reader in
[service.ts](../../../backend/think/service.ts). Pinned source:
[model readback](https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/session/info.ts#L26-L32)
and [message handler](https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/server/src/handlers/message.ts#L35-L60).

## Restricted sessions and actual enforcement

Generation creates separate `ground-generation` sessions using the public field:

```json
{ "permissions": [{ "action": "*", "resource": "*", "effect": "deny" }] }
```

The adapter verifies the singleton rule on create/readback and before accepting
history. It does not reuse or change Think's wildcard-allow creator, autoapprove
asks, rely on a prompt instruction, guess `tools: []`, or use a private native DB.
The model receives bounded excerpts explicitly; its ordinary reply is validated
as candidate JSON by the daemon, not an assumed SDK structured-output option.

Representative actual-native controls used the same forced tool attempt with
ordinary wildcard **allow versus deny**, not merely an empty advertised catalog:

| Path | Allow control | Deny-all observation |
| --- | --- | --- |
| Built-in `read` | Returned the owned external sentinel | Tool unavailable/error; sentinel absent from returned content; no ask |
| Built-in `write` | Created the owned test file | Tool unavailable/error; target stayed absent; no ask |
| Built-in `shell` | Created the owned shell sentinel | Tool unavailable/error; target stayed absent; no ask |
| Built-in `subagent` | Completed delegation and created one child | Tool unavailable/error; no child created; no ask |
| Code Mode `execute` → `fetch` | Returned the owned HTTP token with one GET | Tool unavailable/error; no additional GET; no ask |

The original temporary receipts are
`/tmp/opencode/ground-9ya7-native-deny-probe.json`,
`/tmp/opencode/ground-9ya7-tools-probe.json` and
`/tmp/opencode/ground-9ya7-gateway-probe.json`. They recorded passed controls,
fixture-root/process cleanup and no use of personal notes or paid/personal model
requests. These paths are ephemeral; the sanitized outcomes above preserve the
scope without depending on their survival. The probes did **not** exercise a
configured direct-MCP server or arbitrary privileged hooks/plugins. Ordinary
permission denial is not a native-process sandbox or universal gateway/policy
certification, and the earlier full-allow MCP proof is not deny-all proof.

## Lasting two-job proof and reuse

The retained
[real-native case](../../../backend/think-full-stack.test.ts),
`Ground real native scheduled questions and quotes publish without a browser and deny Code Mode`,
uses [launchThinkFixture](../../../tests/think-fixture.ts): an isolated source
copy/Next build, real Bun daemon, explicit native 2.2.2 binary, owned vault and
local scripted model HTTP provider. It leaves the requested variant omitted.
It asserts:

- Two owned generation sessions, one per persisted question/quote job, with exact
  deny-all readback and no permission asks. Forced `execute` on the question job
  returns a tool error with no owned gateway request; advertised model tools do
  not include `execute`.
- The daemon, without a browser trigger, writes both actual canonical resources
  and exposes them through the real Ground API. The quote has attribution but no
  invented Source field; its API projection omits `source`.
- After restarting only the owned daemon, both files retain identical bytes and
  inodes, both jobs remain settled, and the same native sessions each have exactly
  their original user prompt IDs. No extra sessions/prompts or forced generation
  repeats occur.
- Recent conversations stays empty; private Think conversation/command/transcript
  rows and actual transcript files stay absent. Think may independently prepare
  its empty transcript directory; directory existence is not a transcript.

Quotes use model training knowledge plus bounded recent vault context, with
model-supplied attribution. The fictional scripted quote tests integration and
structure, not factual attribution accuracy. External research/source fetching,
verification, allowlists and provider/key workflows were removed from the scope,
not deferred. These existing native permission/sandbox limits are descriptions,
not new capability gates or source-policy choices.

Publication fault/ownership regressions remain in
[ground-generation-publication.test.ts](../../../backend/ground-generation-publication.test.ts)
and [its Bun/SQLite helper](../../../tests/ground-generation-publication-fixture.ts).
They protect output-hash confirmation, no-replace/manual-conflict behavior,
unbound-temp substitution rejection, durable witness-to-inode transfer before
terminal cleanup, case-folded duplicate no-ops and v8-to-v9 preservation of old
question plans/facts. A pre-witness create crash is still ambiguous and fails
closed; this is not universal crash recovery or
filesystem/distributed compare-and-swap.

The **2026-11-01** independent final run records frontend **144**, backend **745
across 34 files**, Playwright **60**, native integration **7 passed / 3 intentional
unselected skips**, both TypeScript programs and an isolated **Next 16.4.3** build
passing. Validation used `f70f41a` plus the accepted working changes; terminal
cross-boundary review accepted with no findings and no later code changes. Evidence:
`/tmp/opencode/ground-9ya8-final-validation.log` and
`/tmp/opencode/ground-9ya8-final-validation.json`. This is source/fixture acceptance,
not live deployment or personal-data activation. The final configuration/activation
handoff remains `memory-loop-9ya.9`.

For a relevant version/platform/configuration change, rerun the affected retained
test with an explicitly selected verified native executable and owned isolation,
not PATH/personal defaults. Native test invocation and cleanup requirements stay
in [README](../../../README.md#opencode-characterization-tests) and the earlier
validation report. Never rebuild a live `.next` artifact, alter personal native
configuration or silently redispatch uncertain work to obtain a passing result.
