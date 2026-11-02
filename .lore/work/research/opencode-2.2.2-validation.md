---
title: OpenCode 2.2.2 integration validation
date: 2026-10-30
status: completed
tags: [opencode, validation, native-client, integration, permissions, reconnect]
modules: [backend, think]
related: [.lore/work/design/think-execution-reconnect.md, .lore/work/design/think-permissions-context.md, .lore/work/design/think-transcript-persistence.md]
---

# OpenCode 2.2.2 integration validation

## Key Findings

**A server application can use the maintained `@opencode/client` library to access a separately running local OpenCode service. It does not need to invoke the CLI for chat, scrape CLI output, embed the agent SDK, or manage the native process.** The operator owns service startup/shutdown. Only the isolated validation fixture launches its own disposable native processes.

The pinned integration passed ordinary asynchronous admission, watcher-disconnect continuity, authoritative message/status recovery, native tool execution, inherited session grants, forms, compaction, large canonical text, direct MCP and MCP through Code Mode. Native durable event replay is **not** needed for this recovery mechanism.

Reuse this report and the retained tests as a baseline in another project. Do not repeat the exploratory research or revive rejected CLI/profile/embedded-SDK alternatives. Do run a small compatibility smoke when versions, platforms or relevant configuration change. This report is completed evidence, **not user approval, certification of arbitrary plugins, or a promise never to revalidate**.

## Versions, provenance and proof

| Component | Validated baseline |
| --- | --- |
| Application library | Exact `@opencode/client@2.2.2`; matching schema/protocol dependencies are pinned in `bun.lock` |
| Native service | CLI/platform packages `@opencode/cli@2.2.2` and `@opencode/cli-linux-x64@2.2.2`; direct executable printed `opencode v2.2.2`; authenticated `server.info()` matched version and owned PID |
| Runtime | Project pin **Bun 1.4.3**; separate real Bun client process successfully authenticated and read native history. That smoke asserts a Bun runtime, not its numeric version; the package-manager pin supplies the recorded version baseline |
| Test runner | Vitest 5.0.5, Node environment for the three native profiles; MCP fixture uses maintained `@modelcontextprotocol/server@2.3.1` |
| Official source | [`v2.2.2`](https://github.com/anomalyco/opencode/releases/tag/v2.2.2), commit **`098aa7fd6e02b03d6fc410f0b052038c7d4c5e81`**. This is a source revision, not a binary digest |
| Reproducible project checkpoint | **`0b2343c94f4313ed6e86440031e15ee8cc7d459c`**, `memory-loop-s1s.1: verify isolated OpenCode capabilities` |

Phase 1 results below were checked against that committed test code and the final convergence records. No experiments, services, model calls or project tests were rerun to write this report. Earlier design paragraphs saying Phase 1 probes were pending describe their earlier evidence state; they do not negate this later completed characterization.

### Native evidence, with sanitized results retained here

| Profile | What actually passed |
| --- | --- |
| `baseline` | Exact service identity and fixture-only model/default; explicit discovery/auth and wrong-password denial; caller IDs and duplicate admission; ordinary form lifecycle; independent daemon/browser watch analogues; abort browser watch while execution remains active; release held fake-provider response; fresh client recovers identical user/AI IDs and full text without resubmission; actual built-in read of a test-owned `.env` sentinel outside workspace; best-effort interrupt retains observed partial text; separate Bun client smoke |
| `agent` | Top-level configured wildcard deny and parent/child read denies overridden by session wildcard allow; actual parent read and built-in child delegation/read; inherited child permissions and location readback; no pending permissions; one **81,920-byte** canonical assistant text part; explicit compaction completes while earlier user objects and assistant text remain in ordinary history; active context becomes shorter than full history |
| `mcp` | Both local stdio servers connected and listed before prompting; actual `fixture_direct_echo` call and actual `execute` → `tools.fixture_code.echo` call, verified by subprocess call witnesses and completed native tool content/inner-call metadata; no pending permissions |

Final native run: **3/3 profiles passed**. The agent receipt recorded an 81,920-byte history decode sample of **3 ms** and **354,424 bytes heap delta**. These are one Node-client sample, not a performance budget, peak-memory measurement, arbitrary-size guarantee or Bun/browser benchmark.

The MCP receipt recorded two tools/list witnesses, connection readiness after 57 ms, then a **250 ms fixture-only settling interval**. Main requests advertised 13 functions, including `fixture_direct_echo` and `execute`; the `fixture_code` namespace was present in instructions. There was one gateway call/result and one direct call/result. Provider request-shape errors and retained invalid-tool/registration warning counts were zero. An auxiliary request with no tools was also observed; it is not another user Send.

Cleanup audit: no remaining owned process-group members, MCP witness PIDs or fixture-marker processes; zero remaining fixture directories. Both known application processes remained alive. This proves cleanup for the recorded run, not cancellation of arbitrary tool descendants.

### Separate project regression evidence

Final convergence also recorded frontend unit **23/23**, backend **237/237**, browser **54/54**, TypeScript and production build passing. There was no configured lint script. The ordinary backend suite excludes native characterization; the native **3/3** result is separate. These project checks preserve the existing app/Recall baseline; they do **not** establish a completed Think UI, Next/Hono reconnect transport or vault transcript implementation.

Original local evidence was `/tmp/opencode/think-final-{convergence,native,cleanup,typecheck,unit,backend,build,browser,missing-selector}.log`. Final receipt basenames were `native-receipt-fbaa268b5cce8608a0da57edd2bcb3d9.json` (baseline), `native-receipt-25a50e1f7ab8a70a41e865edc63c79ce.json` (agent), and `native-receipt-5e1aa9aefb1a10cf3ee64fcc96337729.json` (MCP). Those files are ephemeral; the inline results and checkpoint/test references make this report usable without them.

## Known-good public library patterns

These examples show the checked 2.2.2 API family, not a complete application. Registration, location and credentials stay server-side. Inputs shown as variables are explicit operator/test-owned values, not browser selectors.

### Attach to an existing service; do not ensure one

```ts
import { OpenCode } from '@opencode/client';
import { Service } from '@opencode/client/service';

const endpoint = await Service.discover({
  file: registrationFile, // Absolute operator-selected registration file.
  version: '2.2.2',
});
if (!endpoint) throw new Error('Compatible OpenCode service unavailable');
const client = OpenCode.make({
  baseUrl: endpoint.url,
  headers: Service.headers(endpoint),
});
const identity = await client.server.info({ signal: AbortSignal.timeout(5000) });
```

Check the intended local loopback endpoint, exact version and process identity. Discovery does not establish application ownership of any session. Do not expose this client/credential to the browser, call `Service.ensure`, kill a shared service, or copy provider credentials into app configuration.

The fixture separately verified direct construction with `Service.headers({ url, auth: { type: 'basic', username: 'opencode', password } })`. Its **test-owned** discovery file contained `{ url, pid, version, password }`; correct auth discovered the owned service and a wrong password returned no endpoint. That validates the public file/discovery/auth contract, not native service-mode registration creation or permission to fabricate an operator's registration file. [Public service client][service]

### Stable session/prompt identities and full ordinary grants

```ts
const session = await client.session.create({
  id: sessionID, // Valid tested shape: ses_fixture_<24 hexadecimal characters>.
  location: { directory: vaultDirectory }, // Absolute, explicitly resolved context.
  model: { providerID: 'fixture-provider', id: 'fixture-model' },
  permissions: [{ action: '*', resource: '*', effect: 'allow' }],
}, { signal: AbortSignal.timeout(10000) });

const admitted = await client.session.prompt({
  sessionID: session.id,
  id: promptID, // Valid tested shape: msg_fixture_<24 hexadecimal characters>.
  text: 'fixture prompt',
}, { signal: AbortSignal.timeout(10000) });
```

Allocate these IDs once and retain them; do not generate replacement IDs during transport recovery. The request field is **`id`**, not `messageID`. Prompt returns an admitted inbox record (`admitted.id`, `admitted.payload.text`), **not a completed response**. It returned while the fixture provider was still held. `resume: false` was separately tested to admit without starting generation; inbox list/cancel then produced zero provider requests. [Session protocol][session-api]

Reusing a session ID returned the existing session rather than applying a changed title. Repeating a prompt ID with **different text** returned the first admitted payload and a single inbox item. Native idempotency therefore does not compare payload equality. Source tests also allow reuse after inbox cancellation; that cancellation/re-admission case was **source-checked, not exercised by the final profiles**. Applications need immutable command checks and resident accepted/uncertain/cancelled receipts; do not rely on native IDs as permanent tombstones or promise exactly-once tool effects. [Inbox implementation][inbox] [Cancellation source test][cancel-test]

The fixture model reference is not a production default. Configure explicit agent/model references or deliberately delegate to native defaults. Location-scoped catalog calls use `{ location: { directory } }`, as in `model.list({ location, types: ['chat'] })` and `model.default({ location })`. Read back created location/permissions and verify app ownership metadata before use; caller-supplied IDs alone do not authorize adopting TUI sessions.

### Later integration observation — omitted model variant

**Confirmed after the Phase 1 checkpoint; not part of its three-profile proof.** When the configured model omits `variant`, native `session.get()` returns `model.variant: 'default'`. Pinned [`session/info.ts:26–30`](https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/session/info.ts#L26-L30) explicitly normalizes the missing stored variant this way. Compare readback against `configured.variant ?? 'default'`; provider/model IDs and any explicitly configured variant must still match exactly. Do not reject a valid owned session merely because `undefined !== 'default'`, or weaken unrelated ownership checks.

Evidence: the controlled comparison initially recorded **1 failed / 1 passed**, then **2 passed** after the narrow correction (`think-variant-readback-red.log`, `think-variant-after-fix.log` under `/tmp/opencode`). Native diagnostics accompanying `think-daemon-variant-diagnostic.log` showed identity/ownership/location/grants/provider/model checks true, `variantAbsent: false`, and `variantDefault: true`. Subsequent native creation readback was **verified** in `think-daemon-native-after-variant.log`; that larger Phase 2 run still failed with **`daemon first send timed out`**. This confirms the normalization caveat and creation comparison only—not successful Phase 2 Send completion or end-to-end integration.

### Later integration observation — native ordering and assistant identity

**Post-checkpoint evidence, not an additional Phase 1 assertion.** Native `time.busy` can precede promotion/recording of the admitted user message: one controlled diagnostic measured **15 ms earlier**, despite succeeded/inactive native state and a completed assistant response. Do not require `busy >= user.time.created`, add an arbitrary timing tolerance, or mistake that ordering for an old execution. Correlate the admitted input ID, chronological user/synthetic boundaries, known run metadata and assistant/terminal facts instead.

The public 2.2.2 `SessionMessageAssistant` has **no `parentID`**; native diagnostics also recorded `assistantParentPresent: false`. A session's parent/child field is a different contract. Do not invent an assistant-to-user parent join. The pinned [session-message schema](https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/schema/src/session-message.ts) and installed public client declaration agree. The sanitized diagnostic receipt `native-receipt-75599b1974b5d8f7178619211351fbc2.json` recorded the ordering above; the subsequent `/tmp/opencode/think-daemon-native-after-timefix.log` passed its daemon/native lifecycle case. This resolved the intermediate timeout described above without weakening ownership or treating idle alone as completion.

### Later integration evidence — actual application HTTP chain

**Separate current-working-tree evidence; not contained in Phase 1 commit `0b2343c94f4313ed6e86440031e15ee8cc7d459c`.** The latest `/tmp/opencode/think-phase2-node-fixture-verified.log` records **1/1 passing under the normal Node-hosted runner** for `backend/think-full-stack.test.ts` using `tests/think-fixture.ts`: a separately built/copied Node Next app, its fixed BFF routes, the canonical Bun/Hono daemon listener and native OpenCode 2.2.2 with a local scripted provider.

The test verified explicit native discovery/identity, owned root creation at the fixture vault with wildcard session grants, Send acknowledgement, caller-signal abort **after the 202 response**, New chat while the first native run remained active, completion followed by another Send, Stop reaching native interrupted state, a completed built-in read of a test-owned external sentinel, and ordinary form list/get/reply through Next with native answered readback. Cleanup asserted the fixture directory was removed and recorded owned process groups no longer existed. This is command-path evidence—not an in-flight lost-ack test, browser SSE/body-transfer acceptance, or proof that arbitrary detached tool effects stopped.

The later project convergence passed frontend **23/23**, backend **317/317**, browser **54/54**, TypeScript and build. Its native run passed the **four native profiles**, but its separate full-stack case failed on the fixture's Node-host assumption (`Bun is not defined`). After that correction, the focused full-stack result above and fixture CLI **4/4** passed; a post-fix TypeScript pass was reported. Preserve that sequence rather than describe the original native invocation as wholly passing or claim one post-fix rerun of every suite. Evidence is under `/tmp/opencode/think-phase2-convergence*.log`, `think-phase2-node-fixture-cli.log` and the verified full-stack log above.

The original Phase 1 reproduction files/checkpoint below remain the portable baseline; these later files and the now-present `think:fixture` command are Phase 2 additions. Subsequent senior service corrections passed independent focused **86 tests**, project/test TypeScript checks and the normal full-stack fixture (`/tmp/opencode/think-senior-authority-independent-green.log`, `think-senior-authority-typecheck.log`, and `think-senior-authority-native.log`). Fresh whole-phase verification accepted R5/R6 as resolved without material regressions; Phase 2 is accepted and closed, with its local checkpoint recording these additions. No functional Think UI, vault transcript delivery, private Serve/personal activation or arbitrary-plugin compatibility is claimed by this result.

### Later Phase 3 observation — application watch and content transport

**Accepted Phase 3 controlled transport evidence, separate from the Phase 1 checkpoint.** The application now exposes paginated manifests, snapshot-first Hono SSE and a dedicated validating Node HTTP bridge. Watch events are `snapshot`, bounded monotonic `revision` state signals and `heartbeat`; changed manifests are read through the short snapshot endpoint. A five-minute watch lease requires fresh authenticated reconnect, never Stop or native event replay. Authenticated body responses carry at most 64 KiB raw bytes within 128 KiB JSON, identified by content generation, immutable UTF-8 `through`/offset and a scoped nonce with a renewable 60-second idle lease. See [README's runnable fixture exercise](../../../README.md#local-think-transport-fixture), `backend/app.ts`, `backend/think/content-transfer.ts` and `src/web/think-watch-{http,bff}.ts` for this application contract; it is not a new native OpenCode API.

The native readback seam is the public `client.session.message.get({ sessionID, messageID }, { signal })` (not `client.message.get`). Cache restoration uses the trusted session/message/text ordinal, completed assistant state, retained UTF-8 length and SHA-256 before serving the **same** old canonical generation. Pinned readers prevent reclamation; originals, form replies and unfinished previews stay resident in private spill storage for the daemon epoch. An unavailable/mismatched old body is a content error, not execution failure, cancellation or a reason to loop event-watch resnapshots. Native full-message decoding still allocates a full value; no constant-memory or restart-recovery guarantee is added.

The handoff reports focused foundations **120 GREEN plus TypeScript**. Project convergence passed frontend **23/23**, backend **357/357**, browser **54/54**, build and TypeScript; five native cases passed, while the separate browser transport case initially failed in its harness. After a test-only correction, the completed `/tmp/opencode/think-phase3-dropped-chunk-verified.log` records **1 selected test passed / 1 unselected skipped**, with accompanying TypeScript passing as reported. The retained case is `backend/think-full-stack.test.ts`: `recovers large immutable content across two real browser watches without resending`. It exercises two Chromium same-origin clients through Node Next → Bun/Hono → native scripted provider, including fetching the real chunk response then discarding it before browser delivery, and reconnect without resubmission. This is a corrected focused pass after convergence, **not a post-fix all-suite rerun**. Fresh review then found Bun's default ten-second idle timeout could precede the fifteen-second heartbeat. The corrected runtime applies a per-request idle override only to successfully authenticated watches; independent quiet-heartbeat, affected backend/TypeScript and large-content browser checks passed (`/tmp/opencode/think-phase3-bun-idle-verified.log` and associated backend, typecheck and large-regression logs). Fresh verification accepted the correction without material regressions; Phase 3 is accepted with its local checkpoint.

The completed log's sanitized `phase3_fixture_metrics` sample is retained here so it does not depend on temporary files:

| Measurement | Recorded sample |
| --- | --- |
| Full user / assistant UTF-8 bytes | **238,027 / 210,023 B** |
| Largest observed control frame | **2,260 B** |
| Native-client decode | **5.326 ms** |
| Native RSS, before → after | **279,560,192 → 282,783,744 B** |
| Daemon RSS, before → after | **52,527,104 → 56,889,344 B** |
| Browser user / assistant assembly | **46.2 / 58.6 ms** |
| Browser user / assistant heap delta | **0 / 0 B**, coarse browser API |

RSS values are before/after snapshots, **not peaks**. The coarse heap API's zero delta does **not** establish zero allocation. Timings are one controlled sample, not performance guarantees or Markdown-rendering benchmarks. This transport probe does not establish Think UI, vault transcript, physical-device, private Serve, restart-recovery or arbitrary-size acceptance. No native/project checks were rerun for this documentation update.

### Later Phase 4 observation — application transcript recovery

**Application evidence after Phase 3 checkpoint `3ab9a23`, not a new OpenCode contract or an addition to Phase 1's three-profile proof.** `/tmp/opencode/think-phase4-native-transcript-acceptance.log` records **1 selected case passed / 2 unselected skipped** for the retained `backend/think-full-stack.test.ts` case `runs the owned Node Next → Bun daemon → native fixture command lifecycle`. The real Node Next → Bun/Hono → native fixture wrote ordinary conversation Markdown readable through Recall HTTP. A built-in read completed while a moved transcript directory caused a logging conflict; restoring that same directory allowed autonomous catch-up. Assertions preserved the prior transcript and sentinel, found the original/AI text once, omitted raw tool paths, and confirmed one admitted input and one completed read rather than prompt/tool replay.

The sanitized sample was **4,059 transcript bytes, 8 entries, 1,012 ms from fault start through catch-up**. It is one observation, not a benchmark, retry deadline, size limit or proof of arbitrary filesystem-race safety. Controlled file-fault coverage also reports 7 passing cases. Later Phase 4 convergence passed TypeScript, Next build, frontend 23, backend 374, browser 54 and native 7. Following P4-01/02/03 corrections, independent affected checks passed 166 tests, project/test TypeScript, the normal Node/Next/Bun/native transcript/Recall fixture and the native Chromium large-content fixture. Fresh filesystem/security verification accepted all corrections without material regressions. Phase 4 is accepted; no Think UI, private Serve/personal activation, file adoption or daemon-restart recovery is claimed. [README](../../../README.md#local-think-transport-fixture) describes the fixture transcript/Recall exercise. Phase 1 and Phase 3 evidence above is unchanged; no services or checks were run for this documentation update.

### Ordinary history/status is recovery; live events are signals

Use these ordinary calls for a known owned session:

```ts
const info = await client.session.get({ sessionID });
const active = await client.session.active();
const inbox = await client.session.inbox.list({ sessionID });
const first = await client.message.list({ sessionID, order: 'asc', limit: 50 });
// If first.cursor.next exists, subsequent requests omit order:
if (first.cursor.next) {
  const next = await client.message.list({ sessionID, cursor: first.cursor.next, limit: 50 });
}
```

Continue using returned cursors until no continuation or an empty terminal page; reject repeated cursors. The retained helper implements this loop, but these small histories do **not** prove a forced >50-record paging/stress case. The `cursor`/`order` incompatibility is source-verified. A fixture's 100-page safety bound is not an application conversation-turn limit. [Message handler][message-handler]

Subscribe and consume `client.event.subscribe({ types, signal })` **before** authoritative queries; await its direct typed `server.connected` item. Selected events include `session.execution.started/succeeded/failed/interrupted` and `session.text.delta/ended`. Items are events themselves, not an `.event` wrapper. The stream covers multiple locations/sessions: filter owned IDs. Its connected item is readiness, **not a replay watermark or atomic snapshot barrier**.

Keep the monitor alive independently of browser watches/HTTP request signals. On a browser reconnect, query the same session and retained command/message IDs; do not prompt again. On an upstream stream gap, reconnect/requery with bounded backoff. Queries across endpoints/pages are not atomic; coalesce refreshes and fence stale results. Canonical ended values replace previews; missing unfinished deltas/intermediate states cannot be invented. Abort and **await** owned consumers, suppress only their expected cancellation, and retain unrelated errors. The shared client does not reconnect itself. [Shared events][events]

`session.active()` maps running sessions; an absent entry is not success. `session.get()` has **`outcome`**, `time.busy` and `time.idle`, not `lastRunOutcome`. Old outcome can coexist with newly active work. The passing fixture required its admitted user ID, completed expected assistant text (`time.completed`, `finish: 'stop'`, no error), succeeded outcome and no active execution. A step ending or idle hint alone is insufficient; real applications must correlate the particular operation and preserve uncertainty where native facts do not settle it.

**Do not make `experimental.session.log` an integration prerequisite.** Earlier characterization of the direct CLI profile yielded only `log.synced`, with replay watermark 0 and no retained rows. Pinned CLI startup does not enable event persistence and the Bus defaults to `persist: false`; message projectors run independently before conditional event-archive insertion. Ordinary canonical history recovery above passed. No private DB access, persistence flag, service-profile change, CLI upgrade or embedded SDK was needed. This does not mean the experimental API is absent, nor prove that every launch profile disables archival. [CLI startup][cli-startup] [Bus defaults][bus-defaults] [Projection before archive][bus-project]

### Full text, compaction, forms and best-effort Stop

- **Full history:** `message.list` retained one complete 81,920-byte text part and earlier message identities/text after `session.compact({ sessionID, id: compactionID })`. The corresponding compaction history record reached `status: 'completed'`. `session.context({ sessionID })` became shorter: it is active model context, **not a transcript/history substitute**. The fake provider supplies a deterministic compaction summary; this is not a model-quality or arbitrary-context-size claim.
- **Forms:** `session.form.create({ sessionID, title, fields: [{ key: 'answer', type: 'string', title: 'Answer', required: true }] })`, then `.list`, `.get` and `.reply({ sessionID, formID, answer: { answer: 'fixture answer' } })` passed. Pending state disappeared from the list and readback was answered. Another reply produced typed `FormAlreadySettledError` without changing the answer. Ordinary forms are not tool approvals; session-owned `permission.list({ sessionID })` stayed empty during tested tools. Native location-wide/global MCP forms were not validated as chat-owned interactions.
- **Stop primitives:** `session.inbox.cancel({ sessionID, inboxID: promptID })` removes an undelivered input; `session.interrupt({ sessionID, resume: false })` requests interruption. The final profiles exercised these primitives separately: inbox cancellation before execution, and interruption after observed partial output. The latter returned `interrupted: true`, then ordinary readback established interrupted/inactive state with the partial text retained.
- **Application Stop composition:** cancel the target input if undelivered, then request interruption with resumption disabled; observe settlement. The public inbox-cancel handler converts an internal already-delivered conflict to **204**. Do not misreport that internal conflict as an HTTP failure or treat 204/`interrupted: true` as proof all effects ended. Combined delivery/Stop races and detached/background effects were not exhaustively tested. Completion may win, `interrupted: false` is not “Stopped,” and completed external effects cannot be undone. [Public handler][session-handler] [Interrupt implementation][interrupt]

## Permission and MCP compatibility limits worth keeping

### What full allow did—and did not—prove

The `agent` fixture supplied top-level `permissions: [{ action: '*', resource: '*', effect: 'deny' }]`, parent read deny, and child read deny. Root sessions supplied the wildcard **allow** shown above. Parent and built-in child actually read the controlled external sentinel; child readback retained the parent's session grants and location. No permission replies were used.

This is runtime proof for an **injected ordinary top-level/agent rule overlay**, not an independent experiment with private global/project files: project discovery was deliberately disabled. Source establishes ordinary agent rules followed by session rules, with last matching action/resource rule winning. Built-in children inherit session permissions. Full allow is **not a vault sandbox**: tools act under native process privileges, including outside the selected directory. [Permission implementation][permission] [Creation/inheritance][session-create]

**Subagent catalog limitation:** pinned description generation filters advertised child agents using the parent's ordinary agent rules without the session overlay. The successful fixture therefore explicitly allowed `subagent` on `fixture_child` in the parent, while retaining read denies. Actual delegation/read checks honored session grants. Do not claim that a session wildcard repairs every advertised-agent omission; do not work around it by secretly rewriting user agents. The tested built-in model tool is `subagent`, with `{ agent, description, prompt, background: false }`, not guessed V1 `task` arguments. [Subagent source][subagent]

Native permission hooks/hard `policies` run after ordinary allow evaluation and can still ask/deny or remove integrations. No public universal bypass was established. The late actual MCP/Code Mode policy-denial characterization remains **deferred in `memory-loop-49j`**, not passed by these three profiles. Source shows denial may lack a denial event, MCP wrapping can discard its cause, and a public generic tool failure/inner error status does not prove permission denial. Do not infer all future failures are policy faults, autoapprove asks, add initial approval UI, or certify arbitrary plugins from these positive samples. Known conflicts need operator resolution; unknown causes stay unknown. OS/provider/plugin validation errors are separate from permission checks. [Policy source][policy] [MCP wrapper][mcp-tool]

### MCP exposure and readiness

The correct V2 configuration uses **server-level** `codemode`:

```ts
const mcp = { servers: {
  fixture_direct: {
    type: 'local', command: [bunAbsolute, '--no-env-file', fixtureScript],
    cwd: fixtureRoot, protocol: 'legacy', codemode: false,
  },
  fixture_code: {
    type: 'local', command: [bunAbsolute, '--no-env-file', fixtureScript],
    cwd: fixtureRoot, protocol: 'legacy', codemode: true,
  },
} };
```

Both SDK servers advertise `{ capabilities: { tools: {} } }` and an `echo` descriptor with `inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }`. Actual direct model function: **`fixture_direct_echo`**, arguments `{ text: 'direct-fixture-ok' }`. Gateway model function: **`execute`**, arguments `{ code: 'return await tools.fixture_code.echo({text:"code-fixture-ok"});' }`. The gateway namespace/catalog is in system instructions, **not `execute.description`**; absence of a raw `fixture_code_echo` function is expected. Real call witnesses and native completed tool facts—not connected status alone—proved both paths.

Cold location startup connects MCP asynchronously; the native tool registry refresh is debounced by 100 ms. Initial registration flush does not wait for every later connection. Early prompts initially saw built-ins only. The passing controlled experiment queried `client.mcp.list({ location })` before the prompt until both servers connected, checked tools/list witnesses, and allowed 250 ms settling. **That delay is fixture characterization, not a public readiness guarantee or a production sleep to copy.** No public registry-refresh completion barrier was established. MCP list is a status read, not a magic initialization method. Production compatibility must handle actual discovery/readiness honestly without automatically resubmitting user prompts. [Async MCP startup][mcp-startup] [Registry refresh][mcp-tool]

## Reuse the validation elsewhere

Obtain these files **at checkpoint `0b2343c94f4313ed6e86440031e15ee8cc7d459c`**, preserving their relative paths (for example, inspect/export with `git show <checkpoint>:<path>`):

- `backend/opencode-capabilities.test.ts` — the three native profiles, bounded fake HTTP provider, assertions, preflight and owned cleanup.
- `backend/vitest.opencode.config.ts` — isolated native-suite selection, Node environment, env-file loading off.
- `tests/opencode/isolation.ts` and `tests/opencode/readiness.ts` — pure fail-closed launch-spec and exact loopback readiness checks.
- `tests/opencode/mcp-fixture.ts` — small maintained-SDK stdio echo fixture, not a general MCP emulator.
- `tests/opencode/bun-client-smoke.ts` — the real Bun-side library check.
- `backend/opencode-isolation.test.ts` and `backend/opencode-readiness.test.ts` — retain the non-spawning guard tests in ordinary CI.

The native harness does not require Next/Hono or a running Memory Loop application. Preserve the exact client pin/lock resolution, Vitest runner and MCP test dependency above. Add the equivalent package script `"test:opencode": "vitest run --config backend/vitest.opencode.config.ts"`. Keep fixture code test-only; production code uses the maintained client directly, never imports the fixture or its fake provider.

### Explicit opt-in, never PATH or personal defaults

After independently establishing an existing trusted installation and fixture prerequisites, the retained command is:

```sh
OPENCODE_TEST_BINARY=/absolute/verified-install/@opencode+cli@2.2.2/node_modules/@opencode/cli/bin/opencode.exe \
  bun --no-env-file run test:opencode
```

This is a placeholder, not a machine-specific configured path or an instruction to install anything. The retained fixture is **Linux x64 and installation-layout-specific**: it requires the selected CLI path suffix above plus sibling `@opencode+cli-linux-x64@2.2.2/node_modules/@opencode/cli-linux-x64/bin/opencode`. It checks exact package names/versions, canonical non-link paths, executable regular files, ELF magic, and matching platform binary identity by inode or SHA-256. The Linux CLI file is named `.exe` but is ELF. These checks compare installed package artifacts; they are not independent publisher-signature verification. Another package layout/platform needs a deliberate reviewed preflight adaptation, not bypassing the checks.

**Do not select an `opencode` shell wrapper, `mise exec`, package runner, or mutable tool shim—even for `--version`.** The original wrapper invoked a package manager and isolated HOME changes could trigger installation before any intended probe. Select the already-installed direct executable first. Application service access itself needs none of these CLI calls.

The native fixture then launches only its owned process with `['serve', '--hostname', '127.0.0.1', '--port', '0']`. Its Bun helpers currently require an already-available `/usr/bin/bun`; portability changes must keep an explicitly verified interpreter rather than bootstrap one.

### Isolation and cleanup that must travel with the test

The trusted pre-existing anchor is `/tmp/opencode`; each native run owns a new subdirectory. The guard requires `/etc/opencode` to be definitely absent; an inspection error fails closed without reading its contents. Do not delete/rename system configuration to make this pass; use an appropriate isolated host if necessary.

The launch guard constructs a fresh environment—**no host-environment spread**—with fixture-contained `HOME`, `OPENCODE_TEST_HOME`, all four `XDG_*_HOME` directories, `TMPDIR`, `OPENCODE_CONFIG_DIR`, `OPENCODE_DB` and an empty `GIT_CONFIG_GLOBAL`. Its selected environment also contains:

```text
OPENCODE_CONFIG_CONTENT=<validated fixture JSON>
OPENCODE_CONFIG_PROJECT_DISABLE=1
OPENCODE_DISABLE_CLAUDE_CODE=1
OPENCODE_DISABLE_MODELS_FETCH=1
OPENCODE_DISABLE_FREE_MODELS=1
OPENCODE_DISABLE_AUTOUPDATE=1
OPENCODE_DISABLE_FILEWATCHER=1
OPENCODE_DISABLE_FFF=1
OPENCODE_PASSWORD=<fresh fixture secret>
PATH=/usr/bin:/bin
GIT_CONFIG_NOSYSTEM=1
```

No guessed `OPENCODE_SERVER_PASSWORD`, V1 provider config or `OPENCODE_PURE` replacement is required by this retained fixture. Its only provider is the owned loopback fake at `/v1/chat/completions`, configured with `env: []`, `package: '@opencode/ai/providers/openai-compatible'`, `settings: { baseURL: '<owned-origin>/v1', apiKey: 'fixture-only' }`, and a chat model advertising text/tools with fixture limits 131072/2048. This exact V2 `providers` shape and SSE text/tool-call finish records are retained in the test; do not substitute older `npm:@ai-sdk/openai-compatible` examples. No paid/live model provider is used. Fixture `update: 'disable'`, `share: 'disabled'` and `snapshots: false` are test isolation choices, not production tuning recommendations.

The guard checks fixture path containment/non-links, fixed loopback bind, ephemeral ports and exact provider/config/script allowlists before launching. It excludes known app ports. It does not create an OS sandbox or defend against a hostile same-account filesystem actor. Owned process groups, follower promises, provider sockets and MCP child identities are explicitly cleaned; never kill by process name/port or stop the operator's service. Protect secrets/content in output and retain only sanitized receipts.

Ordinary project tests must not launch native OpenCode. The recorded explicit native invocation **without `OPENCODE_TEST_BINARY` failed all three cases before spawning**, as intended; it did not silently skip, use PATH or fall back to personal registration. Pure guard/readiness tests remain runnable without native OpenCode. In another project, preserve that separation in its normal test include/exclude configuration.

## Application responsibilities and targeted revalidation

The native evidence is a reusable foundation, not a finished chat product. Applications still own stable conversation/run/command mapping, immutable payload checks, browser authentication/BFF routes, daemon-lifetime task supervision, current-chat snapshot/reconnect ordering, bounded content transfer, and honest ambiguity/Stop states. A readable full-user/full-AI Markdown transcript with conservative tool summaries is **application work**; native history is not that export. Retain original user input before plugin preparation; do not dump raw tool payloads/internal reasoning into a vault log by assuming they are user-visible messages.

No application turn cap was added by this characterization. Its finite fixture bounds are safety controls, not proof of infinite turns, unlimited context, provider quota removal or native-step-limit overrides. Browser rendering, arbitrary large values, forced multi-page history, real Next/Hono disconnects, storage retries, arbitrary background descendants, daemon/service restart recovery and exactly-once side effects were **not established by Phase 1**. Positive fixture tool access does not certify every tool or the user's private TUI setup; global/project discovery and personal plugins were intentionally isolated away.

For a new project on this same version, begin with these known-good public calls and retained three-profile compatibility smoke, not another broad source investigation. Revalidate only the affected boundary when changing client/native version, Bun/Node/platform, executable provenance/layout, service launch/auth profile, working directory/config discovery, provider protocol, agents/policies/plugins, or MCP transport/readiness. A new real setup additionally needs an explicitly authorized small harmless operation under that context; isolated fixture success is not an attestation of personal configuration. On an observed mismatch, capture safe version/status/tool-name/error-category facts and narrow the probe. Do not invent private APIs, start replacement services, autoapprove permissions or retry a possibly admitted prompt.

## Pinned source references

The references below were source-checked during Phase 1/design work; the report was reconciled against committed tests/results, not fresh upstream-main assumptions. Source-only behaviors are identified above.

[service]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/client/src/promise/service.ts
[session-api]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/protocol/src/groups/session.ts
[inbox]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/session/inbox.ts#L176-L223
[cancel-test]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/test/session-prompt.test.ts#L1472-L1500
[message-handler]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/server/src/handlers/message.ts#L35-L60
[events]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/client/src/shared-events.ts
[cli-startup]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/cli/src/server-process.ts#L101-L145
[bus-defaults]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/bus.ts#L205-L208
[bus-project]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/bus.ts#L397-L432
[session-handler]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/server/src/handlers/session.ts
[interrupt]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/session/execution.ts#L17-L39
[permission]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/permission.ts#L86-L363
[session-create]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/session.ts#L288-L337
[subagent]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/tool/plugin/subagent.ts#L135-L315
[policy]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/config/plugin/policy.ts#L19-L64
[mcp-tool]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/tool/mcp.ts#L43-L140
[mcp-startup]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/mcp/index.ts#L660-L689
