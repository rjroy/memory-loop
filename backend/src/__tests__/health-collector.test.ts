/**
 * Health Collector Tests
 *
 * Unit tests for the centralized health issue collection system.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { HealthCollector, createHealthCollector } from "../health-collector";

describe("HealthCollector", () => {
  let collector: HealthCollector;

  beforeEach(() => {
    collector = createHealthCollector();
  });

  describe("report", () => {
    test("adds a new issue", () => {
      collector.report({
        id: "test-issue-1",
        severity: "error",
        category: "widget_config",
        message: "Test error message",
      });

      const issues = collector.getIssues();
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe("test-issue-1");
      expect(issues[0].severity).toBe("error");
      expect(issues[0].category).toBe("widget_config");
      expect(issues[0].message).toBe("Test error message");
      expect(issues[0].dismissible).toBe(true);
    });

    test("adds issue with details", () => {
      collector.report({
        id: "test-issue-2",
        severity: "warning",
        category: "file_watcher",
        message: "File watch warning",
        details: "/path/to/file.md: permission denied",
      });

      const issues = collector.getIssues();
      expect(issues[0].details).toBe("/path/to/file.md: permission denied");
    });

    test("replaces existing issue with same ID", () => {
      collector.report({
        id: "test-issue",
        severity: "warning",
        category: "cache",
        message: "First message",
      });

      collector.report({
        id: "test-issue",
        severity: "error",
        category: "cache",
        message: "Updated message",
      });

      const issues = collector.getIssues();
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe("error");
      expect(issues[0].message).toBe("Updated message");
    });

    test("respects dismissible flag", () => {
      collector.report({
        id: "non-dismissible",
        severity: "error",
        category: "general",
        message: "Cannot dismiss this",
        dismissible: false,
      });

      const issues = collector.getIssues();
      expect(issues[0].dismissible).toBe(false);
    });

    test("ignores dismissed issue IDs", () => {
      collector.report({
        id: "dismiss-test",
        severity: "error",
        category: "general",
        message: "Will be dismissed",
      });

      collector.dismiss("dismiss-test");

      // Try to re-add the same issue
      collector.report({
        id: "dismiss-test",
        severity: "error",
        category: "general",
        message: "Should not appear",
      });

      const issues = collector.getIssues();
      expect(issues).toHaveLength(0);
    });
  });

  describe("resolve", () => {
    test("removes an existing issue", () => {
      collector.report({
        id: "to-resolve",
        severity: "error",
        category: "widget_compute",
        message: "Error to resolve",
      });

      const result = collector.resolve("to-resolve");
      expect(result).toBe(true);
      expect(collector.getIssues()).toHaveLength(0);
    });

    test("returns false for non-existent issue", () => {
      const result = collector.resolve("non-existent");
      expect(result).toBe(false);
    });
  });

  describe("dismiss", () => {
    test("removes an existing issue", () => {
      collector.report({
        id: "to-dismiss",
        severity: "warning",
        category: "vault_config",
        message: "Warning to dismiss",
      });

      const result = collector.dismiss("to-dismiss");
      expect(result).toBe(true);
      expect(collector.getIssues()).toHaveLength(0);
    });

    test("returns false for non-existent issue", () => {
      const result = collector.dismiss("non-existent");
      expect(result).toBe(false);
    });

    test("prevents issue from being re-added", () => {
      collector.report({
        id: "dismiss-persist",
        severity: "error",
        category: "general",
        message: "First time",
      });

      collector.dismiss("dismiss-persist");

      collector.report({
        id: "dismiss-persist",
        severity: "error",
        category: "general",
        message: "Second time",
      });

      expect(collector.getIssues()).toHaveLength(0);
    });
  });

  describe("clear", () => {
    test("removes all issues", () => {
      collector.report({
        id: "issue-1",
        severity: "error",
        category: "general",
        message: "Error 1",
      });
      collector.report({
        id: "issue-2",
        severity: "warning",
        category: "cache",
        message: "Warning 1",
      });

      collector.clear();

      expect(collector.getIssues()).toHaveLength(0);
    });

    test("clears dismissed IDs allowing re-addition", () => {
      collector.report({
        id: "cleared-dismiss",
        severity: "error",
        category: "general",
        message: "Will be dismissed",
      });

      collector.dismiss("cleared-dismiss");
      collector.clear();

      collector.report({
        id: "cleared-dismiss",
        severity: "error",
        category: "general",
        message: "Can be added again",
      });

      expect(collector.getIssues()).toHaveLength(1);
      expect(collector.getIssues()[0].message).toBe("Can be added again");
    });
  });

  describe("getIssues", () => {
    test("sorts errors before warnings", () => {
      collector.report({
        id: "warning-1",
        severity: "warning",
        category: "cache",
        message: "Warning",
      });

      // Wait a bit to ensure different timestamps
      collector.report({
        id: "error-1",
        severity: "error",
        category: "general",
        message: "Error",
      });

      const issues = collector.getIssues();
      expect(issues[0].severity).toBe("error");
      expect(issues[1].severity).toBe("warning");
    });

    test("returns empty array when no issues", () => {
      expect(collector.getIssues()).toEqual([]);
    });
  });

  describe("hasIssues", () => {
    test("returns false when no issues", () => {
      expect(collector.hasIssues()).toBe(false);
    });

    test("returns true when issues exist", () => {
      collector.report({
        id: "any-issue",
        severity: "warning",
        category: "general",
        message: "Any message",
      });

      expect(collector.hasIssues()).toBe(true);
    });
  });

  describe("getCounts", () => {
    test("returns zero counts when empty", () => {
      const counts = collector.getCounts();
      expect(counts).toEqual({ errors: 0, warnings: 0, total: 0 });
    });

    test("counts errors and warnings separately", () => {
      collector.report({
        id: "error-1",
        severity: "error",
        category: "general",
        message: "Error 1",
      });
      collector.report({
        id: "error-2",
        severity: "error",
        category: "cache",
        message: "Error 2",
      });
      collector.report({
        id: "warning-1",
        severity: "warning",
        category: "file_watcher",
        message: "Warning 1",
      });

      const counts = collector.getCounts();
      expect(counts).toEqual({ errors: 2, warnings: 1, total: 3 });
    });
  });

  describe("subscribe", () => {
    test("notifies listener on report", () => {
      let notifiedIssues: unknown[] = [];
      collector.subscribe((issues) => {
        notifiedIssues = issues;
      });

      collector.report({
        id: "notify-test",
        severity: "error",
        category: "general",
        message: "Notification test",
      });

      expect(notifiedIssues).toHaveLength(1);
    });

    test("notifies listener on resolve", () => {
      let notifyCount = 0;
      collector.subscribe(() => {
        notifyCount++;
      });

      collector.report({
        id: "to-resolve",
        severity: "error",
        category: "general",
        message: "Test",
      });

      collector.resolve("to-resolve");

      // One notification for report, one for resolve
      expect(notifyCount).toBe(2);
    });

    test("notifies listener on dismiss", () => {
      let notifyCount = 0;
      collector.subscribe(() => {
        notifyCount++;
      });

      collector.report({
        id: "to-dismiss",
        severity: "warning",
        category: "general",
        message: "Test",
      });

      collector.dismiss("to-dismiss");

      expect(notifyCount).toBe(2);
    });

    test("notifies listener on clear", () => {
      let notifyCount = 0;
      collector.subscribe(() => {
        notifyCount++;
      });

      collector.report({
        id: "any",
        severity: "error",
        category: "general",
        message: "Test",
      });

      collector.clear();

      expect(notifyCount).toBe(2);
    });

    test("unsubscribe stops notifications", () => {
      let notifyCount = 0;
      const unsubscribe = collector.subscribe(() => {
        notifyCount++;
      });

      collector.report({
        id: "before-unsub",
        severity: "error",
        category: "general",
        message: "Before",
      });

      expect(notifyCount).toBe(1);

      unsubscribe();

      collector.report({
        id: "after-unsub",
        severity: "error",
        category: "general",
        message: "After",
      });

      // Should still be 1, no new notification
      expect(notifyCount).toBe(1);
    });

    test("supports multiple subscribers", () => {
      let count1 = 0;
      let count2 = 0;

      collector.subscribe(() => {
        count1++;
      });
      collector.subscribe(() => {
        count2++;
      });

      collector.report({
        id: "multi-sub",
        severity: "error",
        category: "general",
        message: "Test",
      });

      expect(count1).toBe(1);
      expect(count2).toBe(1);
    });
  });
});

describe("createHealthCollector", () => {
  test("creates a new instance", () => {
    const collector = createHealthCollector();
    expect(collector).toBeInstanceOf(HealthCollector);
    expect(collector.getIssues()).toEqual([]);
  });
});
