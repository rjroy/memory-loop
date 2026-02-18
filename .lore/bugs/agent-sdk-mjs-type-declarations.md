# Agent SDK .mjs Type Declaration Bug

**Status:** Open (upstream)
**Package:** `@anthropic-ai/claude-agent-sdk`
**Discovered:** 2026-02-18, during SDK update from 0.2.34 to 0.2.47
**Affects:** All versions tested (pre-existing since at least 0.2.34)

## The Bug

The Agent SDK's `sdk.d.ts` imports types from `@anthropic-ai/sdk` using `.mjs` specifiers:

```typescript
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs';
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs';
import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs';
```

typescript-eslint's type resolver can't follow `.mjs` imports in declaration files. It fails to map them back to `.d.ts` files through the package's export map. Every type that flows through these imports becomes an "error type" in eslint's view.

`tsc` doesn't hit this because `skipLibCheck: true` trusts `.d.ts` files without resolving their internal imports.

## Impact

`SDKMessage` is a union that includes `SDKAssistantMessage` (references `BetaMessage`) and `SDKPartialAssistantMessage` (references `BetaRawMessageStreamEvent`). Any code that iterates `AsyncGenerator<SDKMessage>` and accesses properties on the yielded events gets flagged by eslint as unsafe. This affects every file that processes SDK event streams.

In this project: `session-streamer.ts`, `session-manager.ts`, `fact-extractor.ts` (21 false positive lint errors).

## Expected Fix

The Agent SDK should either:
1. Import from extensionless paths (`messages` instead of `messages.mjs`) in its `.d.ts`
2. Declare `@anthropic-ai/sdk` as a peer dependency with version constraints, so the export map alignment is guaranteed

## Current Workaround

eslint config override in `eslint.config.mjs` disables `no-unsafe-member-access`, `no-unsafe-assignment`, and `no-unsafe-argument` for the three affected files. `tsc --noEmit` still validates all types correctly.

## Related

- `@anthropic-ai/sdk` is pinned as a devDependency to match the Agent SDK's build version. When upgrading the Agent SDK, also update `@anthropic-ai/sdk` to the version published alongside it (check npm publish timestamps).
- As of 0.2.47 (built 2026-02-18), the matching SDK version is `0.77.0`.
