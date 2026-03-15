/**
 * Meeting Store Tests
 *
 * Unit tests for the module-level meeting state store.
 * Tests store operations and meeting lifecycle management.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import type { ActiveMeeting } from "../meeting-capture";
import {
  getActiveMeeting,
  setActiveMeeting,
  clearActiveMeeting,
  hasActiveMeeting,
  incrementMeetingEntryCount,
  getAllActiveMeetings,
  clearAllMeetings,
} from "../meeting-store";

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockMeeting(title: string = "Test Meeting"): ActiveMeeting {
  return {
    title,
    filePath: `/vaults/test/00_Inbox/meetings/2026-01-21-${title.toLowerCase().replace(/\s+/g, "-")}.md`,
    relativePath: `00_Inbox/meetings/2026-01-21-${title.toLowerCase().replace(/\s+/g, "-")}.md`,
    startedAt: new Date().toISOString(),
    entryCount: 0,
  };
}

// =============================================================================
// Store Operations Tests
// =============================================================================

describe("meeting-store", () => {
  // Clear all meetings before each test to ensure isolation
  beforeEach(() => {
    clearAllMeetings();
  });

  describe("getActiveMeeting", () => {
    test("returns null when no meeting is active", () => {
      const result = getActiveMeeting("vault-1");
      expect(result).toBeNull();
    });

    test("returns the active meeting when one exists", () => {
      const meeting = createMockMeeting("Q3 Planning");
      setActiveMeeting("vault-1", meeting);

      const result = getActiveMeeting("vault-1");
      expect(result).toEqual(meeting);
    });

    test("returns null for different vault ID", () => {
      const meeting = createMockMeeting("Team Sync");
      setActiveMeeting("vault-1", meeting);

      const result = getActiveMeeting("vault-2");
      expect(result).toBeNull();
    });
  });

  describe("setActiveMeeting", () => {
    test("stores a new meeting", () => {
      const meeting = createMockMeeting("Design Review");
      setActiveMeeting("vault-1", meeting);

      expect(hasActiveMeeting("vault-1")).toBe(true);
      expect(getActiveMeeting("vault-1")).toEqual(meeting);
    });

    test("replaces existing meeting for same vault", () => {
      const meeting1 = createMockMeeting("First Meeting");
      const meeting2 = createMockMeeting("Second Meeting");

      setActiveMeeting("vault-1", meeting1);
      setActiveMeeting("vault-1", meeting2);

      expect(getActiveMeeting("vault-1")).toEqual(meeting2);
      expect(getAllActiveMeetings().length).toBe(1);
    });

    test("stores meetings for different vaults independently", () => {
      const meeting1 = createMockMeeting("Vault 1 Meeting");
      const meeting2 = createMockMeeting("Vault 2 Meeting");

      setActiveMeeting("vault-1", meeting1);
      setActiveMeeting("vault-2", meeting2);

      expect(getActiveMeeting("vault-1")).toEqual(meeting1);
      expect(getActiveMeeting("vault-2")).toEqual(meeting2);
      expect(getAllActiveMeetings().length).toBe(2);
    });
  });

  describe("clearActiveMeeting", () => {
    test("removes an active meeting", () => {
      const meeting = createMockMeeting("Test");
      setActiveMeeting("vault-1", meeting);

      clearActiveMeeting("vault-1");

      expect(hasActiveMeeting("vault-1")).toBe(false);
      expect(getActiveMeeting("vault-1")).toBeNull();
    });

    test("is safe to call when no meeting exists", () => {
      // Should not throw
      clearActiveMeeting("nonexistent-vault");
      expect(hasActiveMeeting("nonexistent-vault")).toBe(false);
    });

    test("only clears the specified vault", () => {
      const meeting1 = createMockMeeting("Meeting 1");
      const meeting2 = createMockMeeting("Meeting 2");

      setActiveMeeting("vault-1", meeting1);
      setActiveMeeting("vault-2", meeting2);

      clearActiveMeeting("vault-1");

      expect(hasActiveMeeting("vault-1")).toBe(false);
      expect(hasActiveMeeting("vault-2")).toBe(true);
      expect(getActiveMeeting("vault-2")).toEqual(meeting2);
    });
  });

  describe("hasActiveMeeting", () => {
    test("returns false when no meeting exists", () => {
      expect(hasActiveMeeting("vault-1")).toBe(false);
    });

    test("returns true when meeting exists", () => {
      const meeting = createMockMeeting("Test");
      setActiveMeeting("vault-1", meeting);

      expect(hasActiveMeeting("vault-1")).toBe(true);
    });

    test("returns false after meeting is cleared", () => {
      const meeting = createMockMeeting("Test");
      setActiveMeeting("vault-1", meeting);
      clearActiveMeeting("vault-1");

      expect(hasActiveMeeting("vault-1")).toBe(false);
    });
  });

  describe("incrementMeetingEntryCount", () => {
    test("increments entry count for active meeting", () => {
      const meeting = createMockMeeting("Test");
      meeting.entryCount = 0;
      setActiveMeeting("vault-1", meeting);

      incrementMeetingEntryCount("vault-1");

      const stored = getActiveMeeting("vault-1");
      expect(stored?.entryCount).toBe(1);
    });

    test("increments multiple times correctly", () => {
      const meeting = createMockMeeting("Test");
      meeting.entryCount = 0;
      setActiveMeeting("vault-1", meeting);

      incrementMeetingEntryCount("vault-1");
      incrementMeetingEntryCount("vault-1");
      incrementMeetingEntryCount("vault-1");

      const stored = getActiveMeeting("vault-1");
      expect(stored?.entryCount).toBe(3);
    });

    test("is a no-op when no meeting exists", () => {
      // Should not throw
      incrementMeetingEntryCount("nonexistent-vault");
      expect(getActiveMeeting("nonexistent-vault")).toBeNull();
    });

    test("preserves entry count from initial meeting", () => {
      const meeting = createMockMeeting("Test");
      meeting.entryCount = 5;
      setActiveMeeting("vault-1", meeting);

      incrementMeetingEntryCount("vault-1");

      const stored = getActiveMeeting("vault-1");
      expect(stored?.entryCount).toBe(6);
    });
  });

  describe("getAllActiveMeetings", () => {
    test("returns empty array when no meetings exist", () => {
      const result = getAllActiveMeetings();
      expect(result).toEqual([]);
    });

    test("returns all active meetings as tuples", () => {
      const meeting1 = createMockMeeting("Meeting 1");
      const meeting2 = createMockMeeting("Meeting 2");

      setActiveMeeting("vault-1", meeting1);
      setActiveMeeting("vault-2", meeting2);

      const result = getAllActiveMeetings();
      expect(result.length).toBe(2);

      const vaultIds = result.map(([id]) => id);
      expect(vaultIds).toContain("vault-1");
      expect(vaultIds).toContain("vault-2");
    });

    test("reflects current state after modifications", () => {
      const meeting1 = createMockMeeting("Meeting 1");
      const meeting2 = createMockMeeting("Meeting 2");

      setActiveMeeting("vault-1", meeting1);
      setActiveMeeting("vault-2", meeting2);

      clearActiveMeeting("vault-1");

      const result = getAllActiveMeetings();
      expect(result.length).toBe(1);
      expect(result[0][0]).toBe("vault-2");
    });
  });

  describe("clearAllMeetings", () => {
    test("clears all meetings", () => {
      setActiveMeeting("vault-1", createMockMeeting("Meeting 1"));
      setActiveMeeting("vault-2", createMockMeeting("Meeting 2"));
      setActiveMeeting("vault-3", createMockMeeting("Meeting 3"));

      clearAllMeetings();

      expect(getAllActiveMeetings().length).toBe(0);
      expect(hasActiveMeeting("vault-1")).toBe(false);
      expect(hasActiveMeeting("vault-2")).toBe(false);
      expect(hasActiveMeeting("vault-3")).toBe(false);
    });

    test("is safe to call when already empty", () => {
      clearAllMeetings();
      expect(getAllActiveMeetings().length).toBe(0);
    });
  });
});

// =============================================================================
// Single Meeting Per Vault Enforcement Tests
// =============================================================================

describe("Single Meeting Per Vault Enforcement", () => {
  beforeEach(() => {
    clearAllMeetings();
  });

  test("only one meeting can be active per vault", () => {
    const meeting1 = createMockMeeting("First");
    const meeting2 = createMockMeeting("Second");

    setActiveMeeting("vault-1", meeting1);
    setActiveMeeting("vault-1", meeting2);

    const active = getActiveMeeting("vault-1");
    expect(active?.title).toBe("Second");
    expect(getAllActiveMeetings().length).toBe(1);
  });

  test("different vaults can have concurrent meetings", () => {
    const meeting1 = createMockMeeting("Vault 1 Meeting");
    const meeting2 = createMockMeeting("Vault 2 Meeting");
    const meeting3 = createMockMeeting("Vault 3 Meeting");

    setActiveMeeting("vault-1", meeting1);
    setActiveMeeting("vault-2", meeting2);
    setActiveMeeting("vault-3", meeting3);

    expect(getAllActiveMeetings().length).toBe(3);
    expect(getActiveMeeting("vault-1")?.title).toBe("Vault 1 Meeting");
    expect(getActiveMeeting("vault-2")?.title).toBe("Vault 2 Meeting");
    expect(getActiveMeeting("vault-3")?.title).toBe("Vault 3 Meeting");
  });
});

// =============================================================================
// Meeting Lifecycle Integration Tests
// =============================================================================

describe("Meeting Lifecycle", () => {
  beforeEach(() => {
    clearAllMeetings();
  });

  test("complete meeting lifecycle: start, capture, stop", () => {
    const vaultId = "test-vault";

    // Start meeting
    expect(hasActiveMeeting(vaultId)).toBe(false);

    const meeting = createMockMeeting("Sprint Retro");
    setActiveMeeting(vaultId, meeting);
    expect(hasActiveMeeting(vaultId)).toBe(true);
    expect(getActiveMeeting(vaultId)?.entryCount).toBe(0);

    // Capture entries
    incrementMeetingEntryCount(vaultId);
    incrementMeetingEntryCount(vaultId);
    incrementMeetingEntryCount(vaultId);
    expect(getActiveMeeting(vaultId)?.entryCount).toBe(3);

    // Stop meeting
    clearActiveMeeting(vaultId);
    expect(hasActiveMeeting(vaultId)).toBe(false);
  });

  test("simulates reconnection scenario", () => {
    const vaultId = "reconnection-test";

    // First connection starts meeting
    const meeting = createMockMeeting("Long Meeting");
    setActiveMeeting(vaultId, meeting);
    incrementMeetingEntryCount(vaultId);
    incrementMeetingEntryCount(vaultId);

    // Simulate connection drop (nothing happens to store)
    // New connection reads existing state
    expect(hasActiveMeeting(vaultId)).toBe(true);
    const restored = getActiveMeeting(vaultId);
    expect(restored?.title).toBe("Long Meeting");
    expect(restored?.entryCount).toBe(2);

    // Continue capturing
    incrementMeetingEntryCount(vaultId);
    expect(getActiveMeeting(vaultId)?.entryCount).toBe(3);
  });

  test("handles vault switch scenario", () => {
    const vault1 = "vault-1";
    const vault2 = "vault-2";

    // Start meeting in vault1
    const meeting1 = createMockMeeting("Vault 1 Meeting");
    setActiveMeeting(vault1, meeting1);
    incrementMeetingEntryCount(vault1);

    // Switch to vault2 (vault1 meeting persists)
    expect(hasActiveMeeting(vault1)).toBe(true);
    expect(hasActiveMeeting(vault2)).toBe(false);

    // Start meeting in vault2
    const meeting2 = createMockMeeting("Vault 2 Meeting");
    setActiveMeeting(vault2, meeting2);

    // Both meetings are active
    expect(hasActiveMeeting(vault1)).toBe(true);
    expect(hasActiveMeeting(vault2)).toBe(true);
    expect(getActiveMeeting(vault1)?.entryCount).toBe(1);
    expect(getActiveMeeting(vault2)?.entryCount).toBe(0);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("Edge Cases", () => {
  beforeEach(() => {
    clearAllMeetings();
  });

  test("handles empty string vault ID", () => {
    const meeting = createMockMeeting("Test");
    setActiveMeeting("", meeting);

    expect(hasActiveMeeting("")).toBe(true);
    expect(getActiveMeeting("")).toEqual(meeting);

    clearActiveMeeting("");
    expect(hasActiveMeeting("")).toBe(false);
  });

  test("handles vault ID with special characters", () => {
    const vaultId = "vault/with:special!chars@#$%";
    const meeting = createMockMeeting("Test");

    setActiveMeeting(vaultId, meeting);

    expect(hasActiveMeeting(vaultId)).toBe(true);
    expect(getActiveMeeting(vaultId)).toEqual(meeting);
  });

  test("handles very long vault ID", () => {
    const vaultId = "a".repeat(1000);
    const meeting = createMockMeeting("Test");

    setActiveMeeting(vaultId, meeting);

    expect(hasActiveMeeting(vaultId)).toBe(true);
    expect(getActiveMeeting(vaultId)).toEqual(meeting);
  });

  test("meeting object mutations are reflected in store", () => {
    const meeting = createMockMeeting("Test");
    setActiveMeeting("vault-1", meeting);

    // Direct mutation of the stored meeting object
    meeting.entryCount = 10;

    // The store holds a reference, not a copy
    expect(getActiveMeeting("vault-1")?.entryCount).toBe(10);
  });

  test("handles rapid set/clear operations", () => {
    const vaultId = "rapid-ops";

    for (let i = 0; i < 100; i++) {
      setActiveMeeting(vaultId, createMockMeeting(`Meeting ${i}`));
      if (i % 2 === 0) {
        clearActiveMeeting(vaultId);
      }
    }

    // Last iteration: i=99, set Meeting 99, not cleared (99 % 2 !== 0)
    expect(hasActiveMeeting(vaultId)).toBe(true);
    expect(getActiveMeeting(vaultId)?.title).toBe("Meeting 99");
  });
});
