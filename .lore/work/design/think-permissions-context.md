---
title: Think permissions and OpenCode context
date: 2026-10-30
status: draft
tags: [think, chat, opencode, permissions, configuration, design]
modules: [backend, think]
related: [.lore/work/intents/think.md, .lore/work/design/think-execution-reconnect.md, .lore/work/design/think-transcript-persistence.md, .lore/work/design/hono-next-boundary.md]
---

# Think permissions and OpenCode context

## Recommended direction

Use OpenCode's **native per-session permission rules**, supplied when the daemon creates each Memory Loop conversation. Initial mode is **full**: every available native tool permission check must allow, without approvals or permission-based rejections. Do not inherit a restrictive agent policy, build an application approval service, or edit the user's TUI configuration to approximate this requirement.

In the pinned **OpenCode 2.2.2** public API, the appropriate session field is `permissions: [{ "action": "*", "resource": "*", "effect": "allow" }]`. These rules follow ordinary global/project/agent rules, and built-in subagents inherit them. **However, this is not a universal native bypass:** the matched implementation runs permission hooks afterward; its built-in `policies` mechanism can still impose a hard denial. No per-session bypass for that mechanism was found in the inspected public contracts. Such a conflicting setup is an integration blocker, not permission to weaken full mode or add approval prompts.

Preserve **private Tailscale → Node Next presentation/BFF → Bun/Hono daemon → operator-managed local OpenCode service**. Keep configuration, service credentials and filesystem context in the daemon. **The user selected the configured vault root as the OpenCode working directory.** This selects native context, not a vault sandbox. Reuse supported server configuration at that location, not existing TUI conversations or client-only TUI state.

This is the bounded `memory-loop-42j.3` draft, not approval or implementation. The approved [execution/reconnect design](think-execution-reconnect.md) owns session identity, monitoring, transport and best-effort Stop. The [transcript draft](think-transcript-persistence.md) owns logging; a logging problem must not gate tools. `42j.4` owns presentation. Ground's conversation list and user-selected prior-chat resume remain excluded.

## Evidence and limitations

Read-only official source inspection on 2026-10-30 used commit **`098aa7fd6e02b03d6fc410f0b052038c7d4c5e81`**, the v2.2.2 anchor established in the approved execution design. The earlier CLI version read is not a new verification of a running service. No local OpenCode command, service/model call, private configuration/auth/session store, actual vault/configuration, live app endpoint or build artifact was accessed for this draft.

The consequential public-to-runtime paths were checked, not inferred from current upstream documentation:

- [Public session creation/update][session-api] accepts a permission ruleset; the [creation HTTP handler][session-handler] forwards it, and [core creation][session-create] persists it and inherits it for children. Creation with an existing ID returns the existing session; it does not apply new permissions.
- [Core permission evaluation][permission-core] concatenates agent rules and then session rules, with the **last matching action/resource rule winning**. It subsequently invokes permission hooks. The [built-in policy plugin][policy-plugin] can change an allowed result to denied. These are different precedence layers, not interchangeable spellings of one setting.
- [The permission HTTP endpoint][permission-api] evaluates a request and returns an `effect`; [its handler][permission-handler] returns the native result, including denial. HTTP success does not mean permission was allowed. Actual [tool assertions][permission-core] fail on denial or wait on an ask; there is no HTTP-layer conversion that makes those tools permissive.
- [Session context construction][session-context] uses merged session permissions for tool, skill and MCP discovery. [Built-in delegation][subagent-source], [external-directory/file checks][file-access], [shell checks][shell-tool] and [MCP tool checks][mcp-tool] pass the session into native enforcement. Thus ordinary inherited restrictions can be overridden at execution as well as discovery, subject to the limitations below.
- At the original design inspection, `backend/config.ts:14–43` read only `vaultDirectory` from app-root `.memory-loop/config.json`. Phase 2 now carries Think settings through that loader and validates them in `backend/think/config.ts`; the service-selection clarification below describes its supported contract. `src/web/request-policy.ts:3–16` remains the web policy. This implementation progress does not certify the operator's private setup or imply approval of this whole draft.

This establishes the preferred mechanism and a concrete native limitation. It does not prove the user's selected plugins/configuration are compatible, that the installed binary matches the source, or that every tool succeeds. The isolated capability gate remains mandatory before implementation relies on these contracts.

## Configuration ownership and defaults

Extend the existing daemon JSON, not environment variables or browser preferences. This example uses a fixture path; `location.kind: "vault"` expresses the user's settled working-directory choice without recording the actual vault path:

```json
{
  "vaultDirectory": "/absolute/fixture-vault",
  "think": {
    "service": {
      "registrationFile": "/absolute/fixture/service-discovery.json",
      "requiredVersion": "2.2.2"
    },
    "location": { "kind": "vault" },
    "permissionMode": "full"
  }
}
```

- **`think.service`:** require an absolute `registrationFile` selecting the intended operator-managed service. `requiredVersion` is optional and defaults to `2.2.2`; initially no other version is accepted. The daemon calls `Service.discover({ file: registrationFile, version: "2.2.2" })`, validates the local endpoint and server identity, and reports missing/incompatible configuration without trying an ambient default. Changing a string does not approve an upgrade. Do not add an arbitrary remote endpoint or credentials field. Transcript configuration was not part of the Phase 2 option set; its later implementation is recorded separately below.
- **`think.location`:** the current layer supports `{ "kind": "vault" }`, resolving the already-configured vault. The alternative explicit-directory form discussed in this draft is not implemented or advertised as a current setting; vault-root context is the user's selected scope. Verify an existing canonical directory server-side; do not create a workspace or accept a browser-supplied path. Missing Think/location configuration means setup required; it does not reopen the user's location choice or permit service/daemon cwd fallback.
- **`think.permissionMode`:** default `full`; `full` is the only initially supported value. Reject an unrecognized or future restrictive value as a Think configuration error. No initial restrictive mode, approval UI, rule editor or implicit downgrade is implemented. The field gives a clear future configuration seam without pretending that future modes work now.
- **`think.agent` and `think.model`:** optional explicit native agent ID and model reference `{ "providerID": "fixture-provider", "id": "fixture-model", "variant": "fixture-variant" }`, respectively. Variant is optional. Omission delegates selection to native defaults; do not hardcode `build`, infer the last TUI selection, or pick the first catalog entry in Memory Loop. Validate explicit selections against the selected location's supported catalog; do not silently substitute another explicit agent/model. [Native model resolution][model-selection] can choose native defaults when no session model is set; that is different from promising a fixed TUI model.
- **Phase 4 implementation clarification — `think.transcriptDirectory`:** now accepted as an optional vault-relative directory, default `Conversations/Memory Loop`. The writer independently validates visible slash-separated components; invalid logging configuration degrades logging without disabling otherwise-valid Recall/native chat or narrowing tools. It creates `think-<conversation UUID>.md` exclusively, never adopts/overwrites an existing transcript, and retries automatically without a permission or Retry logging workflow. See the [transcript design's operational clarification](think-transcript-persistence.md#phase-4-operational-clarification--2026-10-31) and [operator instructions](../../../README.md#think-transcripts-fixturestaged-configuration). Final Phase 4 convergence/security review remain pending; this does not change this draft's approval status or authorize activation.

**Phase 2 technical clarification:** requiring the selected registration file deliberately replaces this draft's earlier optional/default-discovery proposal. The earlier sentence did promise a fallback; it was not implemented and must not be presented as working. Explicit selection avoids attaching to an unintended HOME/default registration or shared TUI service merely because it exists, while still using the maintained public discovery/auth contract. It changes no user-facing chat capability, vault context, full-allow policy or native configuration reuse, and adds no service lifecycle ownership. Memory Loop does not create/repair the operator's registration or start a replacement service. There is no default-discovery feature being silently deferred under a completed claim.

Absent/invalid Think-only settings leave valid read-only Recall usable, with Think setup/unavailability reported separately. Malformed JSON or invalid/missing vault configuration retain the current base configuration failure behavior. Never display raw configuration, provider details or secrets as an error response.

Read Memory Loop settings at daemon startup. Changes require a daemon restart and apply to newly created conversations, not an existing run. Do not migrate a session's location, rewrite its permission rules, switch its agent/model or adopt another session as a side effect of reconnect. Restart remains outside the approved resident-receipt continuity guarantee; do not recommend restarting as though accepted work will automatically reattach or stop.

This startup rule does not freeze OpenCode's independently watched configuration. Native agent definitions, instructions and hooks may change under a living service. Report the actual native selection/outcomes; do not claim a complete immutable copy of the user's setup or silently repair a changed policy.

## Explicit context and practical TUI reuse

### Selected location

**Vault root is selected by the user.** Think is a vault-centered thinking tool: relative file operations and native project discovery then start in the user's notes, not the Memory Loop application's source tree. This is context selection, not a file-access restriction or automatic authorization to ingest every note. It settles this choice only; the design remains draft.

The alternatives considered, but not selected for this deployment, have different effects:

- **Memory Loop project directory:** loads that project's engineering context and resolves relative tools there. It is useful for working on Memory Loop, but a poor accidental default for conversations about the vault.
- **Dedicated workspace:** separates project configuration and generated work from the vault. It also means different project agents/instructions/plugins; tools reach vault files through absolute paths or supported references. It requires a deliberate existing directory and setup, not a directory this layer creates silently.

Resolve the configured vault root explicitly; do not choose based on the daemon launch directory. The [public session handler][session-handler] otherwise falls back to service cwd. Resolve the explicit directory through the native [location API][location-api], supply it on root session creation, and supply explicit location context to location-scoped catalog/configuration calls. Use the matched client encoding of `location.directory`, not invented flat query/header parameters. Confirm the created session's canonical location and ownership marker before prompting it; a mismatch is not repaired by adopting/moving that session.

### What is reused

The attached OpenCode service runs under its **own operator-selected account, process environment and installation**. Its global setup, explicit/system configuration, and selected location's project discovery determine the available native agents, models, skills, plugins, references and instructions. [Discovery][config-discovery] walks from that location; [config loading][config-order] puts ordinary global settings below explicit/direct/project settings and managed settings last. Policies have their own stronger precedence and must not be described as ordinary last-wins user settings.

Preserve native discovery rather than copying files or rebuilding that configuration graph in Memory Loop. [Native instruction loading][instruction-source] includes global/project `AGENTS.md` and configured instruction sources. Pass the user's submitted text plus the selected native context; do not automatically attach the entire vault, current Recall note, previous conversation or generated transcript as a prompt. Native configured instructions/plugins can themselves load context; full tool permission is not a guarantee that every native discovery or OS read succeeds.

The [native shell][shell-process] uses the session location as its default cwd and the OpenCode service's environment absent a native session-environment override. Memory Loop must not forward browser environment/context or its own process environment through that override. Native tools may deliberately choose other directories. Selecting the vault does not convert shell/MCP/plugin processes into a sandbox.

Reuse **server-supported** configuration, not TUI windows, keybindings, theme, client-owned `cli.json`, or a plugin's desktop-only GUI. Do not import TUI sessions, copy credentials, install/update plugins or alter global/project files. A native location lookup can load configured plugins; these are trusted code running with service privileges, not passive UI assets. Ordinary server-side plugin behavior must pass the compatibility gate; a plugin needing a TUI-only interaction is not silently treated as supported web functionality.

Agent/model overrides remain operator JSON choices for this layer. A later model/settings interface can use the same validated native references; it is not a reason to add arbitrary workspace/provider configuration controls now.

## Effective full-allow policy

### Native rule precedence

For every newly owned root session, the daemon supplies the following **native session field**, alongside the existing stable ID, ownership metadata and explicit location:

```json
{
  "permissions": [
    { "action": "*", "resource": "*", "effect": "allow" }
  ]
}
```

This is the V2 plural `permissions` ruleset with `action/resource/effect`, not a V1 `permission: "allow"`, `bash`/`task` configuration or prompt instruction. Never pass browser-supplied rules through to OpenCode.

The verified ordinary path is: built-in agent rules → configured global/project rules → agent-specific additions → **session rules**. [Agent configuration][agent-config] appends the inherited and agent-specific rules; core enforcement then appends the session rules. The wildcard therefore wins over ordinary asks/denies, including sensitive-file reads, shell/edit/skill actions, subagent selection and `external_directory`. Saved approvals are not the mechanism and need not be created. There is no need to enumerate today's tools: newly available custom/MCP actions using the same native permission service also match the wildcard. [MCP actions][mcp-tool] use normalized server/tool names, which must not accidentally be excluded by a fixed built-in allowlist.

Built-in subagent creation supplies `parentID` and inherits the parent's session permissions through [core creation][session-create]. The child agent's ordinary denies are therefore also overridden at its actual checks. Do not patch a child only after its first prompt: that would leave a restrictive execution window. A third-party plugin creating an unrelated child or explicitly replacing its permissions is not covered by this inheritance proof and needs compatibility evidence before use.

There is a separate **2.2.2 subagent-discovery limitation**: [the built-in tool description][subagent-source] filters its advertised agent list using selected-agent rules without the session overlay. Actual delegation checks do use session rules. Do not conflate that catalog omission with an execution denial, but verify usable delegation with inherited subagent denies. If the selected setup cannot expose/use its intended subagents, report the compatibility gap; do not silently prune the tool set, rewrite the user's agents or add a home-grown delegation implementation.

### Hard policy and plugin boundary

After ordinary evaluation allows a request, native `permission.evaluate` hooks can still return ask/deny. The built-in [configuration policy plugin][policy-plugin] explicitly applies `tool.use` denials this way. It can also remove providers, MCP integrations and skills through `provider.use`/`integration.use` policy. A later session wildcard does not undo that removal or hook result. A setup narrowed by such policy must not be advertised as full use of the otherwise configured tools.

The inspected [public session create/update/prompt payloads][session-api] expose no hook/policy bypass. The public [configuration patch][config-patch] only changes `shell`, and [plugin endpoints][plugin-api] do not provide a per-session hook-disable operation. Internal unattended evaluation settles some asks but preserves configured denies; it is neither the required mode nor a public universal bypass. Thus **unconditional allow-all in the presence of conflicting hard policies/hooks cannot be promised through this pinned public API**.

**Late-denial observability is not lossless.** [Native assertions][permission-core] throw a denial without emitting a denial event; the [permission schema][permission-schema] defines asked/replied events only. The [MCP wrapper][mcp-tool] can discard the permission cause when converting it to a generic tool failure. The [public error conversion][public-tool-error] then reports `tool.execution`, while a [Code Mode inner-call row][codemode-status] exposes only completed/error status. These generic outcomes do not identify a permission cause. A separate permission-evaluation request's explicit effect is not evidence of what caused an earlier actual tool failure, and evaluating before a call cannot rule out a later policy/hook change. Do not claim universal detection of late policy denials or infer their cause from error text.

Choose this bounded behavior:

- Before activation, establish the chosen service/location/plugin setup is compatible with the native full-allow session mechanism. Inspect only necessary supported server-side metadata/configuration during a later authorized integration; never forward/store raw configuration responses in the browser or operational logs. Known conflicting policies/hooks are setup errors, not per-tool approval opportunities. Arbitrary plugin code has no public always-allow attestation; catalog presence and a few sample checks cannot certify all its future behavior.
- If a required inherited hard policy/hook conflicts, **stop integration activation and report the concrete conflict**. The user must then choose an operator-managed compatible setup or approve a different supported native integration/version. Memory Loop does not edit TUI settings, start a replacement service, silently drop that plugin/tool, inject a last-running bypass plugin, embed a new runtime or autoapprove pending requests. Actual conflicting configuration has not been inspected here, so this is a demonstrated native limitation, not a claim that the user's setup contains it.
- Classify a late outcome as a permission-compatibility failure **only with positive public permission evidence**: an owned `permission.asked` event/current pending request, or a supported public outcome retaining an explicit typed permission rejection. Keep the admitted run, available output and monitoring; retain best-effort Stop. Do not offer an approval/rejection dialog, reply automatically or resend the prompt. A real pending ask uses the existing waiting-for-decision admission state; the application cannot retroactively claim the request was allowed.
- When the actual tool outcome is only a generic execution failure, Code Mode error status or unknown cause, show the tool failure honestly and leave its permission cause **unknown**. Do not invent a compatibility fault, disable subsequent admission/all tools or treat that generic failure as proof of either a policy denial or effective allow-all. Ordinary run/admission eligibility still applies. No interception, per-tool permission probes or new approval gates are added to normal full-mode tool use. Known positive setup conflicts remain subject to the activation policy above.

Custom tools can impose their own validation, authentication or business rules, and a plugin may implement an approval outside native permissions. Do not promise to bypass those arbitrary mechanisms or disguise an approval as an ordinary question. Identify incompatible approval-dependent integrations explicitly. OS/provider failures and a remote service's constraints are not OpenCode permission denials and do not become successes merely because the permission effect is allow.

## Reconnect, pending decisions and execution limits

The daemon records the initial mode and selected native context with its owned conversation, verifies creation/readback, and monitors regardless of browser subscribers or New chat. An existing-session response to create must match ownership, location and required session permissions; it is not proof that this attempt installed them. Do not reset permissions or replay an approval on browser refresh. Use the approved epoch/revision/watch-generation fencing and service-process-change behavior rather than invent another policy state store.

Initial full mode has **no normal permission-reply workflow**. Keep typed permission/form descriptors in the normalized service seam so reconnect can show a permission-compatibility failure supported by observable evidence or an ordinary agent question; it cannot reconstruct a lost denial cause from a generic tool failure. Recover session-owned pending requests via native list/get and ongoing events, not the general location-wide list or a stale popup. [Native permission events][permission-schema] are ephemeral and [pending state][permission-core] is process-local; this does not extend continuity across service failure.

For a separately approved future restrictive mode, reuse `42j.1`'s bounded decision descriptors, paginated collection and authenticated versioned detail/body retrieval; large details must not overflow snapshots or be truncated. A reply targets the owned conversation, exact typed pending ID and current synchronization generation. Revalidate the native request/ownership immediately before reply. A stale/already-settled response produces resync, never a guessed approval or replay on reconnect. [Native reply `always`][permission-core] can save project-scoped approvals: do not call it in initial mode or introduce it casually as a future UI default. This paragraph defines the seam, not authorization to ship that mode or approval UI now.

Ordinary agent forms use the existing session-owned form path, independently of tool permissions. The matched [MCP elicitation implementation][mcp-elicitation] also has location-scoped forms marked `sessionID: "global"`; those cannot safely be attributed to an owned chat by treating them as its pending decisions. Do not adopt unrelated TUI/global forms or autoanswer them. An integration requiring that path needs a supported correlation/interaction contract before it can be declared compatible; a new global-form routing framework is not included here.

**No Memory Loop turn, model-step or tool-call limit is added.** The [native agent step limit][step-limit], configured subagent depth, finite provider context/output, quotas, and native compaction remain distinct execution constraints. Preserve the user's native limit tuning; full permission is not an instruction to erase it. V1 `doom_loop`/`lsp` examples are [not current V2 Core permission actions][permission-docs]; do not invent overrides for them. A run can span many model/tool steps and compaction without becoming a different conversation. Native compaction must not replace full message history or erase the separate vault projection.

## Scope of trust and service attachment

Use the pinned official client's [`Service.discover`][service-discover] with the explicit configured registration file, exact approved version and `Service.headers`, plus the execution design's server-info/process checks. Discovery uses the [native registration contract][service-contract]; it does not start a service or fall back to another registration. Keep the registration and credentials server-side, constrain attachment to the intended local loopback service, and report missing/incompatible service without breaking Recall. No `ensure`, automatic service replacement/reload/stop, copied provider credentials or public OpenCode proxy is part of this layer.

Apply the existing Next web policy unchanged to every read/control/stream: exact Host and supplied Origin, allowed Fetch Metadata, exact configured Tailscale human login and no Funnel. Preserve daemon Host/token checks and rejection of browser-originated headers. Browser input cannot select a native service URL, filesystem context, agent permission rules or credentials. Only fixed application routes cross the BFF; authenticated stream leases, short-request deadlines and content chunks remain as specified in `42j.1`.

Full tool use can execute commands, access networks, and read/modify/delete outside the vault under the **OpenCode process account's privileges**. The read-only Recall reader and transcript writer's path-containment checks do not confine those tools. A permitted tool/plugin may damage transcripts or access other same-account files, including application configuration; bearer tokens do not isolate a hostile local process. State this scope plainly, without adding confirmation gates, raising OS privileges or promising every external side effect can be cancelled. Transcript failures continue to be logging health, not tool authorization.

Log setup/attachment attempts and outcomes, selected-mode transitions and compatibility failures using safe reason codes and generated correlation IDs. Do not log raw prompts, rule resources, host paths, registration/config contents, permission metadata, provider errors or service credentials. Expose only the necessary safe mode/context/compatibility status to the UI; `42j.4` owns its language and treatment.

## Proportionate capability gate and future validation

These are future acceptance checks, **not runtime tests performed for this draft**. Extend the approved isolated gate instead of building a separate permission test platform. Fixtures must own HOME/XDG directories, registration, cwd, config/agent/plugin files, vault, ports and fake provider/tool effects; missing selectors must never fall back to the user's service or setup. No real model calls are required.

- Trace public create/readback with deliberately conflicting built-in/global/project/agent rules. For owned root and built-in child sessions, check wildcard `allow` for sensitive-file, external-directory, shell/edit/skill, subagent and normalized custom/MCP actions; no pending requests or replies should be produced. A fake tool/provider must exercise actual discovery and invocation, **including a fixture MCP tool directly and inside Code Mode**, not just an HTTP mock or separate permission-evaluation call. Assert the intended fixture tool effects occurred. Verify child-agent denies and the advertised-subagent gap separately from the native depth limit.
- Verify a positively known conflicting `tool.use` policy blocks activation. Separately, introduce a late hard denial and a hook returning ask in already-created isolated fixture sessions, then invoke the actual MCP tool directly and inside Code Mode. Capture what those paths expose publicly, including any generic `tool.execution`/inner-call error, and compare an ordinary execution-error control. The harness knows the injected cause, but the adapter may use only evidence the public contract actually preserves: a generic result must remain cause-unknown and must not trigger an invented policy fault or blanket admission/tool shutdown. An observed pending ask or retained typed rejection can be reported as a permission-compatibility failure. A separate permission-evaluation HTTP response must be checked for its **effect**, not treated as allow because it returned 200 or as causal evidence for another invocation. Demonstrate no autoapproval, prompt retry, global/project/session repair or false full-mode success. Apply the same evidence distinction to an explicit child override or plugin approval path.
- Distinguish fixture service cwd, Memory Loop cwd, vault and alternative workspace with different sentinel instructions/agents. Explicit location must select the intended native configuration, relative tool cwd and shell environment; no implicit vault-message injection, config copying, plugin updates or credential leakage. Omitted agent/model uses native selection; unavailable explicit choices are not silently replaced. A version mismatch or missing location leaves Think unavailable and Recall usable without launching a service.
- Disconnect/reconnect while an ordinary form is pending and while a full-mode compatibility fault is pending. Recover exact current IDs/state, discard stale replies, preserve monitoring/editable drafts, and perform no permission reply on resync. Large decision details follow the existing bounded reference/chunk contract. A global MCP form must not be attributed to an unrelated owned conversation. New chat and transcript errors must not change old runs' policy or stop their monitors.
- Denied browser/service requests must reach no OpenCode API. Check safe errors/logs with sentinel secrets, and verify configuration restart semantics without rewriting an existing session. Use scripted limits/compaction and tool errors to show no added application turn cap, no permission-policy conflation and no loss of full message history. Do not use the live ports 3000/3001/9443, actual vault/configuration or `.next` tree for these checks.

## Decisions, settled choice and exclusions

Recommend daemon-owned JSON, exact operator-managed service attachment, explicit native location, optional native agent/model defaults, and per-session wildcard rules inherited by built-in children. Keep initial full mode free of permission prompts/rejections; reject incompatible native policy/plugin setups rather than silently offering a restricted substitute. Preserve OS/provider/native execution limits and the approved monitoring, logging and BFF foundations.

**Settled user choice:** use the configured vault root as Think's OpenCode working directory. That determines project instructions/agents/plugins and relative tool operations; it does not sandbox tools. No working-directory question remains, and this choice does not approve the whole draft.

**Conditional integration blocker:** if the required TUI setup uses conflicting hard policies/permission hooks or unsupported approval/form paths, this pinned public integration cannot honestly promise the requested mode for that setup. Report the specific evidence before asking the user to choose a compatible operator-managed setup or another approved native contract. No such conflict is known in the private setup, because it was not inspected. Generic late tool errors do not establish that conflict; the documented public observability gap remains. There is no separate product decision to weaken initial permissiveness by default.

Excluded: implementation or activation; actual configuration/permission edits; service/model calls; new restrictive modes or approval UI; native bypass plugins or a permission framework; changes to TUI/global/project settings; automatic plugin installation/update; workspace creation or hot switching; model/provider/workspace settings screens; automatic vault ingestion; a vault sandbox; application turn limits; daemon/service crash recovery or exactly-once effects; transcript redesign; Ground listing/prior-chat selection; and the Impeccable screen design. Parent review owns acceptance and canonical tracking.

[session-api]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/protocol/src/groups/session.ts#L165-L355
[session-handler]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/server/src/handlers/session.ts#L105-L117
[session-create]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/session.ts#L288-L318
[permission-core]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/permission.ts#L86-L363
[permission-schema]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/schema/src/permission.ts#L42-L66
[policy-plugin]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/config/plugin/policy.ts#L19-L64
[permission-api]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/protocol/src/groups/permission.ts#L88-L158
[permission-handler]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/server/src/handlers/permission.ts#L21-L84
[session-context]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/session/context.ts#L126-L165
[subagent-source]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/tool/plugin/subagent.ts#L135-L315
[file-access]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/file-access.ts#L95-L160
[shell-tool]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/tool/plugin/shell.ts#L117-L154
[mcp-tool]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/tool/mcp.ts#L20-L113
[public-tool-error]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/session/to-session-error.ts#L73-L80
[codemode-status]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/codemode/tool.ts#L154-L168
[model-selection]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/session/runner/model.ts#L77-L98
[location-api]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/protocol/src/groups/location.ts#L6-L47
[config-discovery]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/config/discovery.ts#L59-L144
[config-order]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/config.ts#L269-L316
[instruction-source]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/config/plugin/instruction.ts#L36-L117
[shell-process]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/shell.ts#L268-L317
[agent-config]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/config/plugin/agent.ts#L82-L122
[config-patch]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/schema/src/config.ts#L119-L121
[plugin-api]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/protocol/src/groups/plugin.ts#L1-L81
[mcp-elicitation]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/mcp/index.ts#L104-L303
[step-limit]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/core/src/session/runner/llm.ts#L240-L275
[permission-docs]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/services/www/src/docs/content/permissions.mdx#L128-L139
[service-discover]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/client/src/promise/service.ts#L12-L25
[service-contract]: https://github.com/anomalyco/opencode/blob/098aa7fd6e02b03d6fc410f0b052038c7d4c5e81/packages/client/src/service-probe.ts#L38-L104
