/**
 * Widget Performance Benchmarks
 *
 * Tests performance requirements for the widget system:
 * - REQ-NF-1: Aggregation completes in <1s for 1000 files
 * - REQ-NF-2: Similarity computation completes in <500ms for 1000 items
 * - REQ-SC-3: Cached similarity returns in <100ms
 *
 * These tests use the test-vault-1000 fixture with programmatically generated
 * files to verify performance at scale.
 *
 * Run with: bun test backend/src/__tests__/widget-performance.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { WidgetEngine, createWidgetEngine } from "../widgets/widget-engine";

// =============================================================================
// Configuration
// =============================================================================

/** Path to the 1000-file fixture vault */
const VAULT_1000_PATH = join(
  import.meta.dir,
  "../../__fixtures__/test-vault-1000"
);

/** Number of files to generate for performance testing */
const FILE_COUNT = 1000;

/** Number of benchmark iterations for statistical significance */
const BENCHMARK_ITERATIONS = 5;

// =============================================================================
// Deterministic Random Generator
// =============================================================================

/**
 * Seeded random number generator for deterministic test data.
 * Using a simple mulberry32 algorithm.
 */
function createSeededRandom(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =============================================================================
// Fixture Generation
// =============================================================================

/**
 * Tag pool for generating realistic frontmatter.
 */
const TAG_POOL = [
  "project",
  "meeting",
  "research",
  "personal",
  "work",
  "notes",
  "ideas",
  "review",
  "planning",
  "development",
  "technology",
  "ai",
  "design",
  "documentation",
  "archive",
  "priority",
  "urgent",
  "followup",
  "reference",
  "template",
];

/**
 * Status options for frontmatter.
 */
const STATUS_OPTIONS = ["draft", "published", "archived"];

/**
 * Category options for frontmatter.
 */
const CATEGORY_OPTIONS = ["work", "personal", "research", "notes"];

/**
 * Generates a single markdown file with frontmatter.
 */
function generateFileContent(
  index: number,
  random: () => number
): { filename: string; content: string } {
  // Generate 1-5 random tags
  const tagCount = Math.floor(random() * 5) + 1;
  const tags: string[] = [];
  for (let i = 0; i < tagCount; i++) {
    const tag = TAG_POOL[Math.floor(random() * TAG_POOL.length)];
    if (!tags.includes(tag)) {
      tags.push(tag);
    }
  }

  // Generate random frontmatter values
  const rating = Math.floor(random() * 10) + 1; // 1-10
  const status = STATUS_OPTIONS[Math.floor(random() * STATUS_OPTIONS.length)];
  const category =
    CATEGORY_OPTIONS[Math.floor(random() * CATEGORY_OPTIONS.length)];

  // Generate a date in 2024-2026
  const year = 2024 + Math.floor(random() * 3);
  const month = String(Math.floor(random() * 12) + 1).padStart(2, "0");
  const day = String(Math.floor(random() * 28) + 1).padStart(2, "0");
  const date = `${year}-${month}-${day}`;

  const filename = `note-${String(index).padStart(4, "0")}.md`;
  const tagsYaml = tags.map((t) => `  - ${t}`).join("\n");

  const content = `---
title: Note ${index}
date: ${date}
tags:
${tagsYaml}
rating: ${rating}
status: ${status}
category: ${category}
---

# Note ${index}

This is generated test content for performance benchmarking.

## Content

Lorem ipsum dolor sit amet, consectetur adipiscing elit.
File index: ${index}

## Tags

${tags.join(", ")}
`;

  return { filename, content };
}

/**
 * Generates 1000 files in the test-vault-1000 fixture.
 * Uses deterministic random generation for reproducibility.
 */
async function generateFixture1000(): Promise<void> {
  const notesDir = join(VAULT_1000_PATH, "notes");

  // Create notes directory
  await mkdir(notesDir, { recursive: true });

  // Check if files already exist
  try {
    const firstFile = join(notesDir, "note-0000.md");
    await stat(firstFile);
    console.log("Fixture already exists, skipping generation");
    return;
  } catch {
    // File doesn't exist, generate
  }

  console.log(`\nGenerating ${FILE_COUNT} test files...`);
  const startTime = performance.now();

  // Initialize seeded random generator for reproducibility
  const random = createSeededRandom(42);

  // Generate files in batches for efficiency
  const batchSize = 100;
  for (let i = 0; i < FILE_COUNT; i += batchSize) {
    const batchPromises = [];

    for (let j = 0; j < Math.min(batchSize, FILE_COUNT - i); j++) {
      const index = i + j;
      const { filename, content } = generateFileContent(index, random);
      batchPromises.push(writeFile(join(notesDir, filename), content));
    }

    await Promise.all(batchPromises);

    if (i % 500 === 0 && i > 0) {
      console.log(`  Generated ${i} files...`);
    }
  }

  const elapsed = performance.now() - startTime;
  console.log(
    `Generated ${FILE_COUNT} files in ${(elapsed / 1000).toFixed(2)}s\n`
  );
}

// =============================================================================
// Benchmark Utilities
// =============================================================================

/**
 * Runs a function multiple times and returns timing statistics.
 */
async function benchmark<T>(
  fn: () => Promise<T>,
  iterations: number = BENCHMARK_ITERATIONS
): Promise<{
  min: number;
  max: number;
  median: number;
  mean: number;
  times: number[];
  results: T[];
}> {
  const times: number[] = [];
  const results: T[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const result = await fn();
    const elapsed = performance.now() - start;
    times.push(elapsed);
    results.push(result);
  }

  times.sort((a, b) => a - b);
  const min = times[0];
  const max = times[times.length - 1];
  const median = times[Math.floor(times.length / 2)];
  const mean = times.reduce((a, b) => a + b, 0) / times.length;

  return { min, max, median, mean, times, results };
}

// =============================================================================
// Test Suite
// =============================================================================

describe("Widget Performance Benchmarks", () => {
  let engine: WidgetEngine;

  beforeAll(async () => {
    // Generate fixture files if needed
    await generateFixture1000();

    // Initialize the widget engine
    console.log("Initializing widget engine...");
    const startInit = performance.now();
    const { engine: e, loaderResult } = await createWidgetEngine(VAULT_1000_PATH);
    engine = e;
    const initTime = performance.now() - startInit;

    console.log(`Engine initialized in ${initTime.toFixed(2)}ms`);
    console.log(`Loaded ${loaderResult.widgets.length} widget(s)`);
    if (loaderResult.errors.length > 0) {
      console.log(`Widget errors: ${loaderResult.errors.length}`);
    }
  }, 120_000); // 2 minute timeout for setup

  afterAll(() => {
    if (engine) {
      engine.shutdown();
    }
  });

  // ===========================================================================
  // REQ-NF-1: Aggregation Performance
  // ===========================================================================

  describe("REQ-NF-1: Aggregation performance", () => {
    test("aggregates 1000 files in under 1 second", async () => {
      // Warm up (first run may have filesystem cache cold)
      await engine.computeGroundWidgets({ force: true });

      // Clear cache for accurate timing
      engine.invalidateAll();

      // Benchmark aggregation
      const stats = await benchmark(
        () => engine.computeGroundWidgets({ force: true }),
        BENCHMARK_ITERATIONS
      );

      console.log(`\nAggregation Performance (${FILE_COUNT} files):`);
      console.log(`  Min:    ${stats.min.toFixed(2)}ms`);
      console.log(`  Max:    ${stats.max.toFixed(2)}ms`);
      console.log(`  Median: ${stats.median.toFixed(2)}ms`);
      console.log(`  Mean:   ${stats.mean.toFixed(2)}ms`);

      // Verify results are correct
      const result = stats.results[0];
      expect(result).toHaveLength(1);
      const data = result[0].data as Record<string, unknown>;
      expect(data.total_count).toBe(FILE_COUNT);

      // REQ-NF-1: Must complete in under 1 second
      expect(stats.median).toBeLessThan(1000);
    }, 30_000);

    test("aggregation with cached results is faster", async () => {
      // Prime the cache
      await engine.computeGroundWidgets();

      // Benchmark cached results
      const stats = await benchmark(
        () => engine.computeGroundWidgets(), // No force flag = use cache
        BENCHMARK_ITERATIONS
      );

      console.log(`\nCached Aggregation Performance:`);
      console.log(`  Min:    ${stats.min.toFixed(2)}ms`);
      console.log(`  Median: ${stats.median.toFixed(2)}ms`);

      // Cached should be significantly faster
      expect(stats.median).toBeLessThan(100);
    });
  });

  // ===========================================================================
  // REQ-NF-2: Similarity Computation Performance
  // ===========================================================================

  describe("REQ-NF-2: Similarity computation", () => {
    test("computes similarity for 1000 items in under 500ms", async () => {
      // Use a file in the middle of the collection
      const sourcePath = "notes/note-0500.md";

      // Clear any cached results
      engine.invalidateAll();

      // Benchmark similarity computation
      const stats = await benchmark(async () => {
        const result = await engine.computeSimilarity(
          "perf-similarity",
          sourcePath
        );
        return result;
      }, BENCHMARK_ITERATIONS);

      console.log(`\nSimilarity Computation (${FILE_COUNT} items):`);
      console.log(`  Min:    ${stats.min.toFixed(2)}ms`);
      console.log(`  Max:    ${stats.max.toFixed(2)}ms`);
      console.log(`  Median: ${stats.median.toFixed(2)}ms`);
      console.log(`  Mean:   ${stats.mean.toFixed(2)}ms`);

      // Verify results
      const firstResult = stats.results[0];
      expect(firstResult.result.length).toBe(10); // limit: 10 in config
      expect(firstResult.cacheHit).toBe(false);

      // REQ-NF-2: Must complete in under 500ms
      expect(stats.median).toBeLessThan(500);
    }, 30_000);

    test("similarity for different source files works correctly", async () => {
      engine.invalidateAll();

      // Test multiple source files
      const sourcePaths = [
        "notes/note-0000.md",
        "notes/note-0250.md",
        "notes/note-0750.md",
        "notes/note-0999.md",
      ];

      for (const sourcePath of sourcePaths) {
        const result = await engine.computeSimilarity(
          "perf-similarity",
          sourcePath
        );

        // Should not include self in results
        const paths = result.result.map((r) => r.path);
        expect(paths).not.toContain(sourcePath);

        // Should return limited results
        expect(result.result.length).toBeLessThanOrEqual(10);

        // Scores should be sorted descending
        for (let i = 1; i < result.result.length; i++) {
          expect(result.result[i - 1].score).toBeGreaterThanOrEqual(
            result.result[i].score
          );
        }
      }
    });
  });

  // ===========================================================================
  // REQ-SC-3: Cached Similarity Performance
  // ===========================================================================

  describe("REQ-SC-3: Cached similarity", () => {
    test("returns cached similarity in under 100ms", async () => {
      const sourcePath = "notes/note-0500.md";

      // Prime the cache with initial computation
      await engine.computeSimilarity("perf-similarity", sourcePath);

      // Benchmark cached lookups
      const stats = await benchmark(async () => {
        const result = await engine.computeSimilarity(
          "perf-similarity",
          sourcePath
        );
        return result;
      }, BENCHMARK_ITERATIONS);

      console.log(`\nCached Similarity Performance:`);
      console.log(`  Min:    ${stats.min.toFixed(2)}ms`);
      console.log(`  Max:    ${stats.max.toFixed(2)}ms`);
      console.log(`  Median: ${stats.median.toFixed(2)}ms`);
      console.log(`  Mean:   ${stats.mean.toFixed(2)}ms`);

      // Verify cache hit
      for (const result of stats.results) {
        expect(result.cacheHit).toBe(true);
      }

      // REQ-SC-3: Cached results in under 100ms
      expect(stats.median).toBeLessThan(100);
    });

    test("cache invalidation triggers recomputation", async () => {
      // Use a different file to avoid conflicts with previous test
      const sourcePath = "notes/note-0600.md";

      // Clear cache to ensure clean state
      engine.invalidateAll();

      // Prime cache - should miss since we just invalidated
      const firstResult = await engine.computeSimilarity(
        "perf-similarity",
        sourcePath
      );
      expect(firstResult.cacheHit).toBe(false);

      // Verify cache hit
      const secondResult = await engine.computeSimilarity(
        "perf-similarity",
        sourcePath
      );
      expect(secondResult.cacheHit).toBe(true);

      // Invalidate via simulated file change
      engine.handleFilesChanged(["notes/note-0500.md"]);

      // Should miss cache after invalidation
      const thirdResult = await engine.computeSimilarity(
        "perf-similarity",
        sourcePath
      );
      expect(thirdResult.cacheHit).toBe(false);

      // Should hit cache again
      const fourthResult = await engine.computeSimilarity(
        "perf-similarity",
        sourcePath
      );
      expect(fourthResult.cacheHit).toBe(true);
    });
  });

  // ===========================================================================
  // Additional Performance Characteristics
  // ===========================================================================

  describe("Additional performance characteristics", () => {
    test("multiple widgets compute efficiently", async () => {
      engine.invalidateAll();

      // Time computing all ground widgets (which includes aggregation widget)
      const start = performance.now();
      const results = await engine.computeGroundWidgets({ force: true });
      const elapsed = performance.now() - start;

      console.log(`\nMultiple Widget Computation:`);
      console.log(`  Widgets computed: ${results.length}`);
      console.log(`  Total time: ${elapsed.toFixed(2)}ms`);

      // All widgets should complete in reasonable time
      expect(elapsed).toBeLessThan(2000);
    });

    test("recall widgets for file filter correctly", async () => {
      // Compute recall widgets for a specific file
      const start = performance.now();
      const results = await engine.computeRecallWidgets("notes/note-0100.md");
      const elapsed = performance.now() - start;

      console.log(`\nRecall Widget Computation:`);
      console.log(`  Widgets returned: ${results.length}`);
      console.log(`  Total time: ${elapsed.toFixed(2)}ms`);

      // Should return the similarity widget
      expect(results.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(1000);
    });

    test("engine handles repeated operations efficiently", async () => {
      // Run multiple operations in sequence to check for memory leaks or degradation
      const iterations = 10;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await engine.computeGroundWidgets();
        await engine.computeSimilarity(
          "perf-similarity",
          `notes/note-${String(i * 100).padStart(4, "0")}.md`
        );
        times.push(performance.now() - start);
      }

      console.log(`\nRepeated Operations (${iterations} iterations):`);
      console.log(`  Min: ${Math.min(...times).toFixed(2)}ms`);
      console.log(`  Max: ${Math.max(...times).toFixed(2)}ms`);
      console.log(`  Mean: ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2)}ms`);

      // Later operations should not be significantly slower (no degradation)
      const firstHalf = times.slice(0, iterations / 2);
      const secondHalf = times.slice(iterations / 2);
      const firstMean = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondMean = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

      // Second half should not be more than 2x slower than first half
      expect(secondMean).toBeLessThan(firstMean * 2);
    });
  });
});
