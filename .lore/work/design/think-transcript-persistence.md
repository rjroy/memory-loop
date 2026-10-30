---
title: Think vault transcript persistence
date: 2026-10-30
status: draft
tags: [think, chat, transcripts, persistence, vault, design]
modules: [backend, think]
related: [.lore/work/intents/think.md, .lore/work/design/think-execution-reconnect.md, .lore/work/design/hono-next-boundary.md]
---

# Think vault transcript persistence

## Recommended direction

Have the **Bun/Hono daemon append a readable Markdown transcript to one vault file per conversation**. Use ordinary native file operations and the approved execution service's normalized events/body references. Do not export OpenCode's raw session JSON, add a database, rewrite the growing conversation after each token/message, or ask another model to summarize tools.

Preserve full original user submissions and all assistant **text** parts. Tool activity gets deterministic, deliberately conservative summaries, not arguments/results. Exclude internal reasoning and injected instructions. Append canonical text at part boundaries, not streaming deltas; preserve observed incomplete output explicitly when a run ends or monitoring fails without a canonical value. A later canonical replacement is labeled as a replacement, never silently substituted for a different message.

**Logging failure does not stop chat or gate tools.** Show degraded logging, keep native history and available pending content, and offer explicit Retry logging. Retry writes the projection; it never sends a prompt or repeats a tool. This is practical logging while the daemon lives, not a new crash-recovery system or an exactly-once claim.

This draft covers `memory-loop-42j.2` only. The approved [execution design](think-execution-reconnect.md), including the user's proportionate best-effort Stop amendment, remains the execution/transport foundation. Initial full-allow permissions must not be weakened by a transcript problem. `42j.3` owns their effective configuration, and `42j.4` owns the interaction/visual treatment. The future conversation list and user-selected prior-chat resume belong on Ground, not this layer.

## Evidence and boundaries

Read-only inspection on 2026-10-30 established:

- `backend/config.ts:14–43` reads `.memory-loop/config.json` from the app root and currently returns only `vaultDirectory`. `backend/contract.ts:1–4` has no transcript option. The new field below is a design choice, **not implemented configuration**. `backend/server.ts:18–35` prepares daemon services without a listener; neither Next nor a browser should open transcript files.
- `backend/vault.ts:46–52,97–146` pins the selected root and uses Linux procfs descriptor paths plus no-follow opens for descendants. Its regular-file reader is read-only, not an already-safe writer. Preserve its namespace/trusted-local-OS assumptions, but apply separate exclusive-create/append rules to new transcript files. In particular, do not inherit the reader's acceptance of hardlinked files for writes.
- Official OpenCode **2.2.2**, commit `098aa7fd6e02b03d6fc410f0b052038c7d4c5e81`, distinguishes [user, synthetic, system, skill, shell, assistant text, reasoning and tool content][message-schema]. Dumping these objects would export substantially more than a conversation log. The [prompt preparation hook][prompt-source] can change submitted text, so projected native user history cannot by itself prove what the user originally typed.
- The matched [event schema][event-schema] provides replayable full-value `session.text.ended` events with assistant message ID and ordinal, while text deltas are ephemeral. The [step implementation][step-source] flushes fragments and records interrupted outcomes during normal cleanup. These are useful foundations, not proof of every installed plugin/tool's behavior or of recovery after process failure.
- The matched [message API][message-api] supplies ordered paginated projected history. [`session.context`][context-api] is only active context after the last compaction. Catch-up must use the full-history/log seam, not mistake compacted context for the whole conversation.
- [Native filesystem documentation][native-fs] describes exclusive creation, no-follow flags, serialized file-handle writes and explicit synchronization. It also warns that promise-based modifications are not automatically synchronized. Actual Linux/Bun behavior, the adapter and injected I/O-failure handling still need fixture verification; Node API documentation is not Bun runtime proof.

No personal vault/configuration, OpenCode auth/config/session store, live app endpoint or running build artifact was inspected. No OpenCode/model/service was started or called for this design. Version-pinned official network source reads do not establish integration acceptance.

## Three distinct kinds of persistence

| Owner | What it retains | What it does not establish |
| --- | --- | --- |
| OpenCode | Native admitted inputs, projected full history and agent/session state through its supported service. | Original pre-plugin user text in every case; successful vault logging; exactly-once external effects. |
| Memory Loop daemon | Living command receipts, original submitted text/body references, normalized lifecycle, writer ownership and last confirmed append position. The approved private spill path can retain pending large bodies. | Durable command recovery or automatic reattachment after daemon restart. |
| Vault Markdown | A human-readable, attributed projection: full user/assistant text, tool summaries, and meaningful lifecycle facts. | A command outbox, executable model context, complete tool payload store, or sufficient state to resume an agent. |

The writer consumes the daemon service, not the browser event stream or the selected Think view. It keeps working with zero browser subscribers, after tab navigation and after New chat. Background output belongs to the original conversation's file. A foreground run ending does not close the conversation permanently or erase later background activity.

## Location, naming and configuration

Extend the existing daemon-owned JSON configuration with one optional field. This is a test-owned example, not a request to read/change the operator's file:

```json
{
  "vaultDirectory": "/absolute/fixture-vault",
  "think": {
    "transcriptDirectory": "Conversations/Memory Loop"
  }
}
```

Recommend **`Conversations/Memory Loop`** as the default when omitted: visible to ordinary Obsidian/Recall browsing, separate from daily captures, and independent of a prompt or model-generated title. The user can override it in JSON before startup; no settings UI or environment-variable discovery is added. A valid vault selection with an invalid Think transcript setting degrades logging without invalidating otherwise-working Recall or turning logging into agent-admission policy. Malformed JSON/missing vault configuration retains the existing configuration error behavior.

The directory is vault-relative, slash-separated, nonempty filename components. Reject absolute paths, empty components, `.`, `..`, dot-prefixed components, backslash and NUL rather than normalize ambiguous targets. These deliberately match the visible namespace Recall can represent. Filenames are **`think-<conversation UUID>.md`**, using the existing application identity, not raw prompt text, a title, a timestamp alone, or a run ID. All runs in that conversation append to this file. Empty New chat creates no transcript until its first daemon-registered user Send; an unused empty conversation need not create vault clutter.

Resolve the selected root and transcript directory once at daemon startup. Pin each writer's target for its daemon lifetime. Config changes require restart; this design does not migrate files, switch an active run's vault, watch config changes, or retrospectively adopt previous files. A new configured location applies to new writers after restart. Existing files remain untouched. Configuration, writer receipts, ownership fingerprints and content-cache metadata stay **outside the vault**; the transcript's small identity/format metadata is intentional document content.

## Markdown file contract

Use UTF-8 ordinary Markdown with small stable YAML frontmatter, a fixed title, and chronological append-only entries. The transcript frontmatter is **not a Lore lifecycle document** and needs no draft/approved status:

````markdown
---
memory_loop_transcript: 1
conversation_id: "11111111-1111-4111-8111-111111111111"
created_at: "2026-10-30T12:00:00.000Z"
---

# Think conversation

## User — 2026-10-30T12:00:01.000Z

<!-- memory-loop-entry {"entry_id":"user:33333333-3333-4333-8333-333333333333","kind":"user","run_id":"22222222-2222-4222-8222-222222222222","message_id":"msg_fixture_user","at":"2026-10-30T12:00:01.000Z","delivery":"registered","body_utf8_bytes":13} -->
```text
Fixture text.
```
<!-- memory-loop-end {"entry_id":"user:33333333-3333-4333-8333-333333333333"} -->
````

All values in the example are fixtures. The user entry's `registered` state explicitly does not claim that OpenCode has admitted it. Later Run entries record admission/rejection/uncertainty and execution outcome without rewriting the User entry.

### Framing and full message text

- Visible headings say **User**, **AI**, **Tool** or **Run**, with UTC ISO-8601 timestamps. Metadata includes a stable `entry_id`, kind, relevant existing run/message/tool identity, and source time. Assistant text records also carry the existing part ordinal and canonical/observed-partial distinction. Native event ID/sequence may be included when available; they are correlation, not tool-effect receipts. Locally registered events use daemon receipt time; native events use their source time. Unknown times are identified as observed time, never invented provider timestamps.
- Put user/AI text in **literal fenced blocks**. This deliberately favors faithful readable source over a second rich-chat renderer: embedded headings, HTML, frontmatter and code fences remain text, cannot masquerade as writer-authored roles/metadata, and are not auto-executed by Memory Loop. The conversation UI still renders Markdown under `42j.4`; an ordinary editor can read the transcript directly.
- Choose a backtick fence at least three characters long and longer than every backtick run in that body. Stream a scan over the immutable body reference, then stream its bytes unchanged; do not cap the fence or clip the message. `body_utf8_bytes` identifies exactly the source bytes after the opening fence line. Append one format-owned LF before the closing fence, irrespective of whether source text had a final newline. This preserves source whitespace, Unicode, line endings, empty bodies and lack of a terminal newline without confusing formatting bytes with message bytes. A large body is not required to fit one control frame, one write or one in-memory string.
- Metadata comments contain only schema-owned fields, validated opaque identities, timestamps, numbers and controlled status values, never prompt/tool strings inserted into JSON comments. The complete-entry end marker follows the fence. A failed append may leave an incomplete last entry; an end marker alone is not proof that the file was synchronized.

This is a small document framing convention, not a new event-store framework. Ordinary reading needs no parser. Future analysis can group native message IDs/part ordinals and read full bodies using the format version and framing/byte count; it must not try to recover arbitrary embedded Markdown with role-heading regular expressions. Do not put mutable “all saved” or final-status fields in frontmatter that would require repeatedly rewriting the document.

### What “full messages” includes

| Content | Vault projection |
| --- | --- |
| User presses Send and the daemon registers it | Full **original** submission, once, with its allocated message/run identity and registered state. No unsent drafts. Rejection or uncertain upstream admission is recorded separately rather than deleting the user's words or claiming they reached the agent. |
| Assistant text | Every assistant **text** part, including intermediate visible prose and final output, in full. Write one entry per canonical closed part, grouped by message ID/ordinal; multiple entries can therefore form one native assistant message. This avoids waiting for a long tool to settle and avoids rewriting previously logged text. |
| Confirmed interrupted/failed run, or monitoring loss without a canonical closed part | Save the complete **available observed prefix**, explicitly labeled partial and possibly incomplete because of a live-stream gap. Permit one provisional entry at the first monitoring loss and, if its prefix advanced, one replacement at the eventual confirmed terminal. Do not copy a growing prefix on every disconnect/retry. This bounded exception preserves terminal output without quadratic token-live rewriting; transport failure alone never means stopped. |
| Later canonical value for a provisional/corrected part | Append its full canonical text with `supersedes_entry_id` and a visible replacement label. It is a replacement of the same message/part, not a second user turn. Keep the earlier partial readable; analysis uses the canonical entry when available. No token-by-token full-prefix snapshots. |
| Reasoning, hidden chain-of-thought, system prompts, injected skills/instructions, native/provider metadata | **Omit.** “Full AI message” here means full assistant text, not every internal provider/session object. Do not export internal reasoning by assuming it is ordinary conversational text. |
| Tool calls/results, shell output and synthetic background notifications | Summaries only, described below. Never reclassify a synthetic/tool payload as User or AI text just to include it. |
| Context compaction | Small Run entry saying context was compacted, with available source identity/time; no compaction-summary body. It neither replaces nor removes full earlier messages in the file. No application turn cap is introduced. |

An ordinary agent-form reply that contains user-authored text should enter the same original-user-content seam, attributed as a form reply with its existing command/decision identity, not an invented native message ID. Do not dump the form's whole tool payload. Initial permissive execution has no tool approval/rejection workflow added by the logger; any future permission decision is a controlled lifecycle fact, not authorization to export sensitive request details.

## Deterministic, sensitive-tool summaries

Append a short Tool entry when a known call starts and when an actual outcome is observed, keyed by its existing call/message/run identities. Example writer-authored prose: **File read — started**, then **File read — completed** with measured duration when available. A long-running tool with no terminal fact remains started/unknown; Stop is not proof of rollback or of every descendant ending.

Use a small mapping from recognized integration tool identities to safe labels. Unknown/plugin tools are **Custom tool**, with an opaque correlation identity, not a copied model-generated title. Summary fields are a closed set: safe tool category, started/completed/failed/interrupted/unknown state, source time, and duration if known. There is no requirement to extract paths, domains or useful-looking strings from arbitrary payloads. More detailed summaries can be deliberately added later for a demonstrated need; they are not necessary for the initial readable activity record.

Never include full arguments/results, shell commands/stdout, file paths/content snippets, URLs/query strings, form schemas, arbitrary tool metadata/titles, exception text, provider-native data or credentials. Map failures to short controlled categories such as execution error or unavailable outcome. Do not add an LLM/provider call, run another tool to create a summary, or make tool execution wait for a summary to succeed. An unfamiliar schema gets the conservative summary, not a tool denial.

This reduces accidental **summary** leakage; it is not secret detection or redaction of the conversation. If the user or AI writes a secret, path or tool result in normal message text, the full-message requirement preserves it. State plainly that transcripts are sensitive vault notes subject to that vault's permissions, Obsidian sync/backups and the user's normal handling. No automatic content-redaction, encryption or “vault sandbox” guarantee is added.

## Append strategy and cadence

Choose **append at meaningful boundaries**, not whole-file atomic reprojection. Atomic full-document replacement is attractive for a small finished export, but repeatedly applying it to a continuing unbounded conversation creates quadratic rewriting and risks replacing user edits. A raw native export also includes reasoning/tool payloads and may contain prepared rather than original user text. Neither is the default writer.

1. After the first Send is registered, independently attempt exclusive file creation, header and original User entry. Do not await successful vault I/O before dispatching accepted agent work. Incoming normalized events continue to be consumed regardless of browser presence.
2. A closed assistant text part, tool start/outcome, admission change, run terminal or compaction boundary becomes a deterministic pending entry. Deduplicate by stable semantic/source identity, not by body text or timestamp; identical text can be a legitimate different message. Replay does not append an entry already confirmed by this living writer.
3. Attempt writes promptly, allowing a short batch of already-ready entries (at most one second of deliberate batching). Serialize writes and handle short writes. Stream body bytes from pinned immutable references/spill files, rather than copying the entire file or each growing preview into a new buffer. Only the new serialized bytes are written in normal operation.
4. Advance the writer's confirmed entry/cursor only after the full entry/batch and file synchronization succeed. A new file's header/name creation must also be flushed appropriately on the supported filesystem before reporting success. `last_synced_at` is an observed successful flush, not a promise against hardware failure, a cross-process transaction, or daemon-restart recovery.
5. Live text remains in the execution service/private content path until a canonical part ends. The vault is **not token-live**. The health seam indicates that an unfinished live part is not yet written, so “up to date” means all currently eligible entries are synchronized, not that every preview token is on disk. On a terminal/monitoring-loss boundary, the explicit provisional path preserves available partial output. A later canonical part appends the labeled replacement only once.

Retain original user bytes and required partial/body references until their entries are confirmed. Catch-up can page native full history and replay lifecycle facts, but native prepared prompts are not an acceptable replacement for a lost original submission. Pending work is identities/references, not an ever-growing copy of all text in RAM. If native data/private retained bytes become unavailable, show an explicit logging gap; never claim full catch-up or silently fill it with a summary. Finite disk/RAM and upstream JSON decoding remain real limits, as described by the approved large-content design.

One writer serializes each conversation in the daemon; different conversation writers may progress independently. A writer failure pauses that writer's append attempts instead of retrying for every new token/event. Keep observing execution and recording available pending references; do not block other conversations, the daemon's upstream consumer, or agent tools behind the vault writer. Graceful shutdown may attempt to flush ready entries within ordinary shutdown bounds, but must report failure rather than pretend all unfinished work was saved.

## Safe file ownership and namespace

Use the current Linux descriptor-based vault foundation and native `node:fs` APIs, not pathname-prefix checks or a new filesystem abstraction framework. The implementation must verify its write behavior separately from Recall's read tests:

- Start from the configured, pinned vault directory. Walk/create each transcript directory component relative to held descriptors, with no-follow directory opens. Never follow a descendant symlink. Create missing directories with owner-only permissions; do not change permissions/ownership of existing vault directories or repair the user's configuration silently.
- Create the final file **exclusively**, append-enabled, no-follow and nonblocking, with owner-only `0600` permissions. Check the opened descriptor is a regular file owned by the daemon user with one link. Reject symlinks, hardlinks, FIFOs, sockets, devices, directory targets and an already-existing filename. A matching frontmatter ID is not proof that this process owns an existing file. Never use truncating open modes or an automatic overwrite/suffix fallback.
- Retain in-memory ownership identity and the last confirmed size/fingerprint for files this daemon created. Before each batch, revalidate the configured root/descendant namespace and target identity against held/known descriptors and check for unexpected size, modification/change time or link-count changes. Reopen an idle-owned handle only without create/truncate and only after these checks. A moved/replaced root, target or directory pauses logging; do not knowingly continue into a different vault or follow the replacement. Close descriptors explicitly, including idle/shutdown/error paths.
- Treat external editing, renaming, removal and appending as a **conflict**, not permission to re-render over the user's file. The transcript is a generated active log; the operator can copy it into an authored note, but this layer has no merge or force-overwrite feature. Normal appends never rewrite earlier bytes. On conflict preserve everything, report the problem, and require operator resolution before Retry can proceed safely.

Exclusive creation also handles two daemon processes targeting the same conversation: one creates the file, the other reports conflict rather than interleaving appends or adopting it. No global lock/lease server, stale-lock recovery, or multi-process writer coordination is added. Existing files from a prior daemon are not automatically reopened for continuation in this layer.

As with Recall, this trusts the local OS/account and personal namespace; it is not isolation from a hostile process. Ordinary pre-write checks are not an atomic defense against every rename/edit concurrent with the final syscall. A permitted OpenCode tool/plugin can alter or delete the transcript, change links, or operate outside the vault under its own privileges. Do not respond by adding tool approval gates, quietly narrowing full-allow permissions, or claiming the logging writer's path checks sandbox agent execution. Report detected damage honestly.

## Failure policy and manual catch-up

Expose logging independently of execution: not started, writing/pending, up to date, degraded, or retrying; include `last_synced_at`, whether live text is pending, and a safe error category. Do not show “saved” merely because a file exists, an entry end marker was emitted, or the AI completed. Operational logs record attempt/outcome, generated correlation and reason codes, never file contents, raw exceptions, host paths, filenames or tool payloads.

| Failure | Behavior |
| --- | --- |
| Missing permission, full disk, unavailable vault or failed write/sync | Chat/tools continue. Pause affected appends, retain available pending state, show logging degraded and offer Retry logging after the condition is corrected. No fallback into another vault, app directory or console transcript. |
| Existing filename, symlink/nonregular/hardlink, changed/moved/removed target, or external edits | File conflict; preserve existing bytes and do not adopt, overwrite, truncate, rename or recreate a previously written file automatically. Retry must pass ownership checks, not a user's generic Send/Stop action. |
| Missing original text/native full-history/observed prefix needed for catch-up | Explicit content gap; retain the last good transcript and do not call catch-up complete. Do not replace original human text with plugin expansion or synthesize lost AI output. |
| Lost browser response/disconnection/New chat | No writer cancellation or prompt resubmission. The living daemon continues; reconnect reports actual logging health. |
| Daemon/service crash or restart | Existing Markdown remains readable, possibly with an incomplete last entry. No automatic ownership adoption, tail repair, historical import or exactly-once claim. Native history may remain available, but restart recovery is separately scoped. |

For an ordinary I/O error **within the same living writer**, manual Retry can safely finish its pending append without introducing a crash-recovery system:

- Keep the last confirmed byte count and an incrementally computed prefix digest, plus the immutable pending entry/batch. Before Retry, perform one streamed verification of the same owned file: its confirmed prefix must match, and any additional tail must be an exact prefix of those pending serialized bytes. An unrelated/changed tail or prefix is a conflict. This verification is linear **on explicit retry**, not a whole-file scan/rewrite after each message.
- If no pending bytes landed, append them; if only a matching prefix landed, append only the remainder; if all landed but synchronization failed, retry synchronization. Only then confirm entries and release retained bytes. Do not truncate, seek back over existing bytes, or blindly append the full record twice. If verification/source retention cannot establish this ordinary continuation, leave degraded and ask for operator attention rather than invent a repair.
- Catch up subsequent missing entries from the normalized native full-history/lifecycle seam and retained original-user ledger. Use the approved projection's verified part identity mapping; a mixed text/reasoning/tool array offset is not automatically a text ordinal. Deduplicate using the living writer's confirmed IDs/cursor; do not replay commands/tools, edit earlier canonical entries, or read back the Markdown as agent context. New events arriving during catch-up remain queued by identity in that writer and follow its captured catch-up boundary.

This is a local retry of an append whose source/ownership are still known. It is not a persisted journal or a claim that the same procedure works after those resident receipts are lost.

### A small application seam, not another chat interface

Provide an authenticated **Retry logging** command, proposed as `POST /api/think/transcripts/retry`, with no browser-supplied vault/path/file target. It starts/coalesces one daemon-owned retry pass for affected writers in this daemon and returns promptly with accepted/current health, rather than holding a five-second BFF request open for large catch-up. Repeated clicks while a pass is running do not start competing writers. It never calls prompt/generate or changes tool permissions.

The current conversation snapshot/watch carries its logging state and an aggregate count/flag for **other background logging failures**. This prevents New chat from hiding a failed transcript while avoiding a prior-chat list/resume UI. Retry can address those owned background writers as well; unresolved conflicts remain visible in the aggregate and operator diagnostics use safe reason codes. `42j.4` chooses the accessible warning/action treatment; this design does not add navigation or require listing previous conversations.

Preserve the existing Next web policy, fresh BFF service headers, daemon authentication/Host checks, no-store responses and short request deadlines. Only the daemon reads/writes the vault. A verified current transcript can expose its ordinary vault-relative note ID for reading through Recall; an absolute root, service credentials, private cache references or raw native session dump must not be returned to the browser. No new public or browser-direct service boundary is needed.

## Analysis and future Ground seam

The same `conversation_id` is present in the filename/frontmatter and the approved application/OpenCode ownership mapping. Run/message/part/tool identifiers relate entries without deriving identity from titles, timestamps, file order or a chat tab. A future Ground index can use that stable mapping and format version to find a transcript and open the associated conversation. Neither finding the file nor parsing its text is sufficient authorization/state for resuming an agent, and this layer supplies no chat listing/resume route or controls.

Append order is observation/write order, with source timestamps/IDs identifying delayed tool completions or catch-up. Do not shuffle earlier file sections to simulate a perfectly ordered real-world timeline. Lifecycle entries distinguish admission, execution completion, best-effort interruption, errors, compaction, logging gaps and later activity. A Run completed entry means the observed foreground run completed, not that every detached side effect stopped or the log is forever final.

## Proportionate future validation

These are implementation acceptance criteria, **not tests run for this draft**. Use existing fixture patterns with test-owned vaults, clocks, IDs, normalized events and injected file-I/O failures; keep the actual vault/config, OpenCode private state, live ports 3000/3001/9443 and live `.next` tree untouched.

- Exercise a real fixture Markdown file from registered User text through multiple full AI parts, tool summaries, Stop/failure and late background output after browser closure/New chat. Replayed events append no duplicate entries; identical messages with different IDs remain distinct. Verify no prompt/tool call occurs on Retry logging.
- Round-trip full bodies with whitespace, Unicode, CR/LF/CRLF, no final newline, empty text, headings, HTML, fake metadata/end markers and long backtick runs. Read the fixture in an ordinary Markdown viewer/source editor; assert full source bytes and clear roles, not just a snapshot of a few easy strings. Large single parts use bounded serializer/body reads rather than whole-file rewriting or oversized browser frames.
- Put sentinel secrets in raw arguments/results, tool titles/metadata, shell output, injected prompts, reasoning and exceptions: none belongs in summaries/operational logs. A sentinel deliberately in an original User or AI text body remains there, demonstrating the full-message/redaction distinction. Unknown tools get conservative summaries without being denied.
- Verify compaction leaves all earlier conversation entries intact, catch-up uses paginated full native history, original user text is not replaced by the prepared prompt, partial entries are honestly labeled, and a late canonical replacement has the correct message/part link.
- Denied web/service requests must touch no writer. Test target traversal, intermediate/final symlinks, nonregular targets, hardlinks, exclusive-create collisions, a second process, and external root/file replacement/edit/removal using outside sentinels. Confirm no existing content is overwritten and descriptors close; do not claim isolation from hostile local tools.
- Inject short writes, disk-full/permission errors before and during a body, sync failure after complete bytes, and failure during header creation. The last confirmed checkpoint never advances on failure. Retry verifies and completes only matching pending bytes; changed prefixes/tails stay conflicts. Background failures remain visible, other chat execution continues, and there is no automatic retry storm or false saved state.
- Confirm an omitted valid transcript option selects the documented default, an override remains within the pinned fixture vault, invalid Think-only options leave Recall usable, and configuration changes require restart without moving/adopting files. A simulated new daemon does not claim ownership of the old file or recovery from lost resident state.

The existing OpenCode 2.2.2 capability gate still applies: prove that the chosen adapter supplies all public text parts, stable identities, native lifecycle and full-history retention after compaction in controlled fixtures. A missing contract is reported before implementation relies on it, not patched by dumping private stores or adding a new recovery engine.

## Decisions, remaining questions and exclusions

Recommend the visible configurable directory, stable UUID filename, small frontmatter plus literal full-text entries, canonical-part append cadence, conservative non-LLM tool summaries, omitted internal reasoning, failure-independent execution, safe exclusive ownership, and manual in-process catch-up described above.

**No additional product decision blocks this bounded default.** The user may choose a different vault-relative directory before activation. Whether to add automatic daemon-restart recovery, cross-process continuation, transcript editing/merge or richer tool summaries is future scope, not an unresolved prerequisite disguised as a feature here. File/adapter capability failures must still be reported honestly.

Excluded: implementation/configuration edits or activation; token-live vault mirroring; raw tool/provider/reasoning exports; automatic sensitive-message redaction; transcript import into model context; a new database/journal/queue/content service; automatic full-document rewriting; conflict overwrite/merge; automatic recovery after daemon/service failure; exactly-once tools; permission gates; Ground's list and user-selected prior-chat resume; detailed Impeccable UI; and changes to the approved Next/BFF/Bun/Hono/Tailscale boundary. The parent owns fresh design review and canonical Beads/approval state.

[message-schema]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/schema/src/session-message.ts#L76-L246
[prompt-source]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/session/prompt.ts#L34-L85
[event-schema]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/schema/src/session-event.ts#L396-L470
[step-source]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/session/runner/step.ts#L137-L225
[message-api]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/protocol/src/groups/message.ts#L23-L115
[context-api]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/protocol/src/groups/session.ts#L506-L515
[native-fs]: https://nodejs.org/docs/v26.13.0/api/fs.html
