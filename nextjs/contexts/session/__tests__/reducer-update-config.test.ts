/**
 * Tests for UPDATE_VAULT_CONFIG reducer action
 */
import { describe, expect, test } from "bun:test";
import { sessionReducer } from "../reducer";
import { createInitialSessionState } from "../initial-state";
import type { SessionState } from "../types";
import type { VaultInfo } from "@/lib/schemas";

const initialSessionState = createInitialSessionState();

const mockVault: VaultInfo = {
  id: "test-vault",
  name: "Original Name",
  subtitle: "Original Subtitle",
  path: "/test/path",
  hasClaudeMd: true,
  contentRoot: "/test/path",
  inboxPath: "00_Inbox",
  metadataPath: "06_Metadata",
  attachmentPath: "05_Attachments",
  setupComplete: true,
  discussionModel: "opus",
  promptsPerGeneration: 5,
  maxPoolSize: 50,
  quotesPerWeek: 1,
  recentCaptures: 5,
  recentDiscussions: 5,
  badges: [],
  order: 1,
  cardsEnabled: false, // Start with false
  viMode: false,
};

describe("UPDATE_VAULT_CONFIG action", () => {
  test("updates vault name from title", () => {
    const state: SessionState = { ...initialSessionState, vault: mockVault };
    const result = sessionReducer(state, {
      type: "UPDATE_VAULT_CONFIG",
      config: { title: "New Name" },
    });
    expect(result.vault?.name).toBe("New Name");
  });

  test("preserves cardsEnabled false when not in config", () => {
    const state: SessionState = { ...initialSessionState, vault: mockVault };
    const result = sessionReducer(state, {
      type: "UPDATE_VAULT_CONFIG",
      config: { title: "New Name" },
    });
    expect(result.vault?.cardsEnabled).toBe(false);
  });

  test("updates cardsEnabled to true", () => {
    const state: SessionState = { ...initialSessionState, vault: mockVault };
    const result = sessionReducer(state, {
      type: "UPDATE_VAULT_CONFIG",
      config: { cardsEnabled: true },
    });
    expect(result.vault?.cardsEnabled).toBe(true);
  });

  test("updates cardsEnabled to false", () => {
    const vaultWithTrue: VaultInfo = { ...mockVault, cardsEnabled: true };
    const state: SessionState = { ...initialSessionState, vault: vaultWithTrue };
    const result = sessionReducer(state, {
      type: "UPDATE_VAULT_CONFIG",
      config: { cardsEnabled: false },
    });
    expect(result.vault?.cardsEnabled).toBe(false);
  });

  test("preserves subtitle when undefined in config", () => {
    const state: SessionState = { ...initialSessionState, vault: mockVault };
    const result = sessionReducer(state, {
      type: "UPDATE_VAULT_CONFIG",
      config: { title: "New Name" }, // subtitle not provided
    });
    expect(result.vault?.subtitle).toBe("Original Subtitle");
  });
});
