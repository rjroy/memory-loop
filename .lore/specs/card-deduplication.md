---
title: Card Deduplication
date: 2026-01-31
status: implemented
tags: [spaced-repetition, deduplication, similarity, cards]
modules: [card-discovery-scheduler, card-manager, card-storage]
related: [.lore/reference/spaced-repetition.md, .lore/reference/_infrastructure/card-generator.md]
---

# Spec: Card Deduplication

## Overview

Two-phase deduplication for spaced repetition cards. When the same fact appears in multiple notes (daily debrief, synthesis, weekly summary), the card generator creates semantically duplicate cards with different wording. This feature detects duplicates using Jaccard similarity on question text, verifies with LLM, and archives older duplicates while keeping the newest version.

## Entry Points

- **Card Discovery Pass** - Dedup runs automatically after card generation during daily/weekly discovery
- **Manual Trigger** - [STUB: manual-dedup-trigger] User-initiated dedup via Settings UI (out of scope for initial implementation)

## Requirements

### Phase 1: Similarity Detection

- REQ-1: Calculate Jaccard similarity on question text between new and existing cards
- REQ-2: Remove stopwords before comparison to focus on content words
- REQ-3: Normalize text (lowercase, strip punctuation) before tokenization
- REQ-4: Use 0.5 similarity threshold to identify candidates for LLM verification
- REQ-5: Self-deduplicate within new cards from the same file (compare new cards against each other)

### Phase 2: LLM Verification

- REQ-6: Send candidate pairs (above threshold) to LLM for semantic verification
- REQ-7: Batch multiple candidate pairs into single LLM call where possible
- REQ-8: LLM prompt asks: "Do these questions test the same knowledge?" with YES/NO response
- REQ-9: Use Claude Haiku for cost efficiency (same as card generation)

### Duplicate Resolution

- REQ-10: When duplicate confirmed, archive the older card (by created_date, or arbitrary if same timestamp)
- REQ-11: Keep the newer card (fresher wording, potentially updated facts)
- REQ-12: Archived cards retain all metadata and move to cards/archive/
- REQ-13: Log which cards were deduplicated

### Error Handling

- REQ-14: If LLM verification fails (rate limit, network error), treat as non-duplicate (fail open - safer to allow duplicates than lose cards)

### Integration

- REQ-15: Load existing cards once at start of discovery pass (in-memory cache, discarded after pass)
- REQ-16: Check each new card against cached existing cards before saving
- REQ-17: Update cache with newly saved cards for self-dedup within pass
- REQ-18: Report dedup stats in discovery pass results (duplicatesDetected, duplicatesArchived)

## Algorithm

### Jaccard Similarity

```
similarity(q1, q2) = |tokens(q1) ∩ tokens(q2)| / |tokens(q1) ∪ tokens(q2)|
```

Where `tokens(q)` is:
1. Lowercase the question
2. Remove punctuation
3. Split on whitespace
4. Remove stopwords
5. Return set of remaining words

### Stopwords

Common English stopwords to remove (non-exhaustive, expand as needed):
```
a, an, the, is, are, was, were, be, been, being,
have, has, had, do, does, did, will, would, could, should,
what, which, who, whom, whose, when, where, why, how,
in, on, at, to, for, of, with, by, from, about,
this, that, these, those, it, its
```

### Example: Duplicate Detected

Question 1: "What is the Q4 shipping deadline?"
Question 2: "What is the deadline for Q4 shipping?"

After normalization and stopword removal:
- Q1 tokens: {q4, shipping, deadline}
- Q2 tokens: {deadline, q4, shipping}

Intersection: {q4, shipping, deadline} = 3
Union: {q4, shipping, deadline} = 3
Similarity: 3/3 = 1.0 ✓ (above 0.5, sent to LLM)

### Example: Similar But Distinct

Question 1: "What frontend framework does Memory Loop use?"
Question 2: "What backend runtime does Memory Loop use?"

After processing:
- Q1 tokens: {frontend, framework, memory, loop, use}
- Q2 tokens: {backend, runtime, memory, loop, use}

Intersection: {memory, loop, use} = 3
Union: {frontend, framework, memory, loop, use, backend, runtime} = 7
Similarity: 3/7 = 0.43 (below 0.5, not flagged)

These are distinct questions testing different knowledge, correctly not flagged.

### Example: Rephrased Duplicate

Question 1: "What database does the project use for persistence?"
Question 2: "Which database is used for data persistence?"

After processing:
- Q1 tokens: {database, project, use, persistence}
- Q2 tokens: {database, used, data, persistence}

Intersection: {database, persistence} = 2
Union: {database, project, use, persistence, used, data} = 6
Similarity: 2/6 = 0.33 (below 0.5)

This duplicate would be missed by Jaccard alone. Acceptable tradeoff:
1. Perfect dedup is not required; reducing duplicates is the goal
2. Users can manually archive obvious duplicates via review UI
3. Threshold can be tuned based on real-world results

### Tuning Note

If too many duplicates slip through, consider:
- Lowering threshold to 0.3 (catches more rephrased duplicates)
- Adding stemming (use/used → use)
- Both changes together for maximum coverage at cost of more LLM calls

## Exit Points

| Exit | Triggers When | Target |
|------|---------------|--------|
| Card archived | LLM confirms duplicate | [Spec: spaced-repetition] - archived cards |
| Card saved | No duplicate found | [Spec: spaced-repetition] - active cards |
| Stats reported | Discovery pass complete | [Spec: card-generator] - status message |

## Success Criteria

- [ ] Jaccard similarity function correctly calculates word overlap
- [ ] Stopwords are removed before comparison
- [ ] Candidate pairs above 0.5 threshold are sent to LLM
- [ ] LLM correctly identifies semantic duplicates
- [ ] Older duplicate is archived, newer is kept
- [ ] Discovery pass stats include dedup metrics
- [ ] No regression in card generation performance (< 2x slowdown)
- [ ] Works correctly with empty card set (first run)

## AI Validation

**Defaults** (apply):
- Unit tests with mocked LLM calls
- 90%+ coverage on new dedup code
- Code review by fresh-context sub-agent

**Custom**:
- Test cases for edge cases: empty questions, single-word questions, identical questions
- Test self-dedup within single file's new cards
- Integration test with mock vault containing known duplicate content

## Constraints

- Must not significantly slow down daily discovery pass
- LLM calls should be batched to minimize API overhead
- Dedup only runs on question text, not answers
- Threshold is configurable for future tuning

## Context

**Research findings:**
- `card-storage.ts` provides `loadAllCards()` for fetching existing cards
- Integration point is `processFile()` in `card-discovery-scheduler.ts`
- Cards have `source_file` field that could help identify related content
- Jaccard similarity chosen for simplicity (word-level, no external dependencies)

**Issue reference:** GitHub #440

**User workflow causing duplicates:**
1. Meeting notes taken
2. Daily debrief extracts key moments
3. Daily synthesis summarizes events
4. Weekly debrief aggregates
5. Monthly summary compiles

Same fact appears in 3-5 notes with slightly different wording, each generating cards.
