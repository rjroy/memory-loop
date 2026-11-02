---
title: Recall search performance measurement
date: 2026-11-02
status: completed
tags: [performance, search]
---

# Recall search measurement

## Method

Run `/usr/bin/bun backend/vault-search-benchmark.fixture.ts > /tmp/opencode/search-p0d-3-benchmark.json 2> /tmp/opencode/search-p0d-3-benchmark.log` from the repository root. The standalone fixture accepts no arguments and creates and removes only its own `mkdtemp` directory under `/tmp/opencode`. It uses the actual `openVault` reader and search implementation, not an isolated matcher. Iteration 0 is the first query of that kind in this process; iterations 1–3 are repeats, not independent process launches. Fixture generation writes warm the OS page cache. This is not a cold-disk measurement.

The deterministic corpus contains 80 directories, 10,240 generated Markdown, JSON, TypeScript and LICENSE-like files, plus a >2 MiB text file containing a unique match beyond the preview/save limit. File creation uses at most 32 concurrent writes. The fixture also records a same-process loopback HTTP ping and 25 ms timer heartbeat during each search, and exercises cancellation through the reader's existing file-open hook followed by another search. A separate two-file real-reader check tests positive and negative SDK subsequences. These observations are not service-level guarantees.

Environment: Linux x86-64, AMD Ryzen AI MAX+ 395, 32 logical CPUs; `/tmp/opencode` is tmpfs; Bun 1.4.3 at `/usr/bin/bun`; Node 26.13.0 installed (not needed for this command). Source baseline `fb5082c` on `feat/restart`. No external service, user vault, model, cache drop, or production configuration is involved.

## Results

Raw JSON and phase log: `/tmp/opencode/search-p0d-3-benchmark.json` and `/tmp/opencode/search-p0d-3-benchmark.log`. Values below are fixture observations, not a claim about a private vault or a disk-backed deployment.

Run: **2026-11-02 08:06:38.232–08:07:02.205 UTC**. The corpus contained **10,241 visible files, 38,938,657 bytes (37.14 MiB)**, including a 2,320,017-byte text file. Total bytes are the UTF-8 bytes written, plus the large file's stat size. The only first search in the process is filename `sdk`; other iteration-zero timings are first uses of those queries after previous searches.

| Mode / query | First of query (ms) | Three repeats (ms) | Matches / files | Retained / limited |
| --- | ---: | --- | --- | --- |
| filename `sdk` | 885.4 | 839.8, 880.8, 820.5 | 80 / 80 | 50 / true |
| filename no-match | 877.7 | 746.8, 523.9, 527.7 | 0 / 0 | 0 / false |
| content `sdk` | 2594.2 | 2460.9, 2454.4, 2509.1 | 117,841 / 10,241 | 100 / true |
| content no-match | 1363.6 | 1369.9, 1455.4, 1454.6 | 0 / 0 | 0 / false |

The no-match query was `zzqxvnonexistent987654321`. Every measurement searched all 10,241 files with complete coverage, zero skipped files or lines, and no timeout. The 80 injected literal SDK markers are not the expected fuzzy count: ordered-character matching also finds subsequences in generated prose. The distinct two-file physical search found the positive `software development kit`, excluded `quiet plains`, and reported one matching file with complete coverage. A separate `sdkbeyondpreview` search took 1384.0 ms, returned exactly one hit on line 80,001 of the large file, and verified that its byte offset exceeds 2 MiB.

During the four content `sdk` searches the maximum observed gap between 25 ms timer ticks was 26.22 ms and the maximum observed loopback ping time was 1.57 ms, with 98–103 completed pings per scan. These are in-process synthetic idle-host observations, not an SSE or full application responsiveness measurement. The hook-triggered cancellation settled as aborted in 0.36 ms from search start; a subsequent filename search recovered with all 10,241 files covered and 80 matches. This does not establish HTTP-disconnect cancellation behavior.

RSS before/after was 52,273,152 / 92,938,240 bytes; heap used was 3,887,898 / 8,234,228 bytes. These are snapshots, not peaks, leak evidence, or memory guarantees; per-query snapshots are in the JSON. The fixture does not model binary files, inaccessible paths, mutations, longer-than-256-KiB lines, many concurrent users, real storage, or user-vault distributions. It executes the reader directly rather than timing the application's HTTP route or UI. The implemented search has a 30-second deadline and retains up to 50 filename or 100 content hits; those are not 10,000-file scan caps.
