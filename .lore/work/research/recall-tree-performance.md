---
title: Recall lazy directory loading measurements
date: 2026-11-02
status: completed
tags: [recall, performance, directories]
---

# Recall tree loading

## Cause and change

Recall previously requested the entire recursive vault tree and constructed rows for collapsed descendants. Legacy Browse instead listed individual directories on demand. Ordinary file selection did not refetch the current recursive tree, so tree measurements alone do not explain every reported file-opening delay.

Recall now requests a shallow root listing, fetches child listings when needed, and renders expanded branches only. An in-memory, vault-identity-scoped session cache reuses loaded listings. Focus revalidation retains the displayed view and marks collapsed cached folders stale for refresh when reopened, without eagerly scanning them. Relevant mutations invalidate listings; complete-tree reads remain available on demand for media resolution and move destinations. No note bodies are persisted in browser storage, and the cache does not survive a full page reload.

## Controlled measurements

The owned warm-tmpfs fixture contains 10,000 notes in 100 folders. Measurements use the real vault reader; they do not represent cold storage or the user's vault.

| Operation | Observed duration | Entries returned | JSON size |
| --- | --- | ---: | ---: |
| Recursive tree, same-fixture comparison | 150–228 ms | 10,100 | 2,282,995 bytes |
| Shallow root listing, four runs | 2.9–6.7 ms | 100 | 21,790 bytes |

Earlier baseline recursive-tree runs measured 150–266 ms. Single-note reads in that baseline were under 1 ms.

In one owned browser run per version, the initially collapsed Files view contained 111,499 DOM nodes before and 1,488 after. The new view requested the root once, fetched a folder on first expansion, and made no directory request when reopening it. Focus refresh revealed an externally created note. Observed first expansion, reopening, and selection took approximately 98, 61, and 109 ms respectively in that single run. These are not general device latency guarantees or proof that every click-delay cause is resolved.

## Evidence

- Direct-reader output: `/tmp/opencode/memory-loop-j51-final-scale-reader.log`.
- Browser comparison: `/tmp/opencode/memory-loop-j51-final-scale-{baseline,current}.log`.
- Full browser gate: 68 checks passed; `/tmp/opencode/memory-loop-j51-final-all-browser.log`.
- Frontend: 225 tests passed. Backend: 944 passed in the full run; four subprocess setup failures from the Bun version-manager shim passed when rerun with `/usr/bin` first on PATH. The full backend run was not repeated.
- Both TypeScript checks passed. Source-identical isolated production build and real Next-to-Bun checks were reused; no live application restart or private-vault scan was performed.
- After correcting collapsed-folder freshness and delayed selected-row reveal/focus, independent verification passed 56 focused unit checks, both typechecks, a fresh isolated production build, 42 Recall/Search/Edit browser checks, and three owned Next-to-Bun delayed-response checks. See `/tmp/opencode/memory-loop-j51-fe-green-*.log`. Unchanged backend and scale evidence was retained rather than rerun.
