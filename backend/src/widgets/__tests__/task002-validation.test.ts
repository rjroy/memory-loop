/**
 * TASK-002 Acceptance Criteria Validation
 * 
 * This test file validates all acceptance criteria for TASK-002:
 * - SortResult interface with sorted array and cycles array
 * - topologicalSort(graph: DependencyGraph): SortResult function
 * - Returns fields in valid execution order (dependencies before dependents)
 * - Fields with no dependencies preserve original insertion order
 * - Remaining nodes after sort are identified as cycle participants
 */

import { describe, test, expect } from "bun:test";
import { buildDependencyGraph, topologicalSort } from "../dependency-graph";
import type { FieldConfig } from "../schemas";

describe("TASK-002: Topological Sort Implementation", () => {
  test("Criterion 1 & 2: SortResult interface and topologicalSort function exist", () => {
    const fields: Record<string, FieldConfig> = {
      a: { sum: "this.value" },
    };
    const graph = buildDependencyGraph(fields);
    const result = topologicalSort(graph);
    
    // Verify SortResult structure
    expect(result).toHaveProperty("sorted");
    expect(result).toHaveProperty("cycles");
    expect(Array.isArray(result.sorted)).toBe(true);
    expect(Array.isArray(result.cycles)).toBe(true);
  });

  test("Criterion 3: Returns fields in valid execution order (dependencies before dependents)", () => {
    // Linear dependency chain: a -> b -> c
    const fields: Record<string, FieldConfig> = {
      a: { sum: "this.value" },
      b: { expr: "result.a * 2" },
      c: { avg: "result.b" },
    };
    
    const graph = buildDependencyGraph(fields);
    const result = topologicalSort(graph);
    
    // Verify all fields are in sorted output
    expect(result.sorted).toContain("a");
    expect(result.sorted).toContain("b");
    expect(result.sorted).toContain("c");
    
    // Verify dependencies come before dependents
    const aIndex = result.sorted.indexOf("a");
    const bIndex = result.sorted.indexOf("b");
    const cIndex = result.sorted.indexOf("c");
    
    expect(aIndex).toBeLessThan(bIndex);
    expect(bIndex).toBeLessThan(cIndex);
    
    // No cycles should be detected
    expect(result.cycles).toHaveLength(0);
  });

  test("Criterion 3: Diamond dependency pattern respects all edges", () => {
    // Diamond: a -> b, a -> c, b -> d, c -> d
    const fields: Record<string, FieldConfig> = {
      a: { sum: "this.value" },
      b: { expr: "result.a * 2" },
      c: { expr: "result.a + 10" },
      d: { expr: "result.b + result.c" },
    };
    
    const graph = buildDependencyGraph(fields);
    const result = topologicalSort(graph);
    
    const aIndex = result.sorted.indexOf("a");
    const bIndex = result.sorted.indexOf("b");
    const cIndex = result.sorted.indexOf("c");
    const dIndex = result.sorted.indexOf("d");
    
    // a must come before b and c
    expect(aIndex).toBeLessThan(bIndex);
    expect(aIndex).toBeLessThan(cIndex);
    
    // b and c must both come before d
    expect(bIndex).toBeLessThan(dIndex);
    expect(cIndex).toBeLessThan(dIndex);
    
    expect(result.cycles).toHaveLength(0);
  });

  test("Criterion 4: Fields with no dependencies preserve original insertion order", () => {
    const fields: Record<string, FieldConfig> = {
      first: { sum: "this.x" },
      second: { avg: "this.y" },
      third: { count: true },
    };
    
    const graph = buildDependencyGraph(fields);
    const result = topologicalSort(graph);
    
    // All fields have no dependencies, should preserve insertion order
    expect(result.sorted).toEqual(["first", "second", "third"]);
    expect(result.cycles).toHaveLength(0);
  });

  test("Criterion 5: Remaining nodes after sort are identified as cycle participants (two-node cycle)", () => {
    const fields: Record<string, FieldConfig> = {
      a: { expr: "result.b" },
      b: { expr: "result.a" },
      c: { sum: "this.value" },
    };
    
    const graph = buildDependencyGraph(fields);
    const result = topologicalSort(graph);
    
    // c has no dependencies and should be sorted
    expect(result.sorted).toContain("c");
    
    // a and b form a cycle and should NOT be in sorted
    expect(result.sorted).not.toContain("a");
    expect(result.sorted).not.toContain("b");
    
    // Cycle should be detected
    expect(result.cycles.length).toBeGreaterThan(0);
    
    // The cycle array should contain both a and b
    const cycleParticipants = result.cycles.flat();
    expect(cycleParticipants).toContain("a");
    expect(cycleParticipants).toContain("b");
  });

  test("Criterion 5: Self-referential cycle detection", () => {
    const fields: Record<string, FieldConfig> = {
      a: { expr: "result.a" },
      b: { sum: "this.value" },
    };
    
    const graph = buildDependencyGraph(fields);
    const result = topologicalSort(graph);
    
    // b should be sorted normally
    expect(result.sorted).toContain("b");
    
    // a references itself and should be in cycles
    expect(result.sorted).not.toContain("a");
    expect(result.cycles.flat()).toContain("a");
  });

  test("Criterion 5: Three-node cycle detection", () => {
    const fields: Record<string, FieldConfig> = {
      a: { expr: "result.b" },
      b: { expr: "result.c" },
      c: { expr: "result.a" },
      d: { sum: "this.value" },
    };
    
    const graph = buildDependencyGraph(fields);
    const result = topologicalSort(graph);
    
    // d should be sorted normally
    expect(result.sorted).toContain("d");
    
    // a, b, c form a cycle
    expect(result.sorted).not.toContain("a");
    expect(result.sorted).not.toContain("b");
    expect(result.sorted).not.toContain("c");
    
    const cycleParticipants = result.cycles.flat();
    expect(cycleParticipants).toContain("a");
    expect(cycleParticipants).toContain("b");
    expect(cycleParticipants).toContain("c");
  });

  test("Mixed scenario: Some fields in cycle, others form valid dependency chain", () => {
    const fields: Record<string, FieldConfig> = {
      // Valid chain
      x: { sum: "this.value" },
      y: { expr: "result.x * 2" },
      // Cycle
      a: { expr: "result.b" },
      b: { expr: "result.a" },
      // Independent
      z: { count: true },
    };
    
    const graph = buildDependencyGraph(fields);
    const result = topologicalSort(graph);
    
    // Valid fields should be sorted
    expect(result.sorted).toContain("x");
    expect(result.sorted).toContain("y");
    expect(result.sorted).toContain("z");
    
    // x must come before y
    expect(result.sorted.indexOf("x")).toBeLessThan(result.sorted.indexOf("y"));
    
    // Cycle fields should not be in sorted
    expect(result.sorted).not.toContain("a");
    expect(result.sorted).not.toContain("b");
    
    // Cycle should be detected
    const cycleParticipants = result.cycles.flat();
    expect(cycleParticipants).toContain("a");
    expect(cycleParticipants).toContain("b");
  });
});
