/**
 * Card Generator Handlers Tests
 *
 * Tests for WebSocket handlers that manage card generator configuration.
 * Uses dependency injection to test handlers without file I/O.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerMessage, ErrorCode } from "@memory-loop/shared";
import type { HandlerContext, RequiredHandlerDependencies } from "../types.js";
import { createConnectionState } from "../types.js";
import {
  handleGetCardGeneratorConfig,
  handleSaveCardGeneratorRequirements,
  handleSaveCardGeneratorConfig,
  handleResetCardGeneratorRequirements,
  handleGetCardGenerationStatus,
  handleTriggerCardGeneration,
} from "../card-generator-handlers.js";
import {
  saveRequirementsOverride,
  saveCardGeneratorConfig,
  DEFAULT_WEEKLY_BYTE_LIMIT,
  DEFAULT_REQUIREMENTS,
} from "../../spaced-repetition/card-generator-config.js";

describe("card-generator-handlers", () => {
  let testDir: string;
  let originalHome: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `card-handler-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
    originalHome = process.env.HOME ?? "";
    process.env.HOME = testDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Create a mock handler context that captures sent messages.
   */
  function createMockContext(): { ctx: HandlerContext; messages: ServerMessage[] } {
    const messages: ServerMessage[] = [];

    const ctx: HandlerContext = {
      state: createConnectionState(),
      send: (message: ServerMessage) => {
        messages.push(message);
      },
      sendError: (code: ErrorCode, message: string) => {
        messages.push({ type: "error", code, message });
      },
      deps: {} as RequiredHandlerDependencies, // Not used by card generator handlers
    };

    return { ctx, messages };
  }

  // =============================================================================
  // handleGetCardGeneratorConfig Tests
  // =============================================================================

  describe("handleGetCardGeneratorConfig", () => {
    test("returns default config when no overrides exist", async () => {
      const { ctx, messages } = createMockContext();

      await handleGetCardGeneratorConfig(ctx);

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe("card_generator_config_content");

      const msg = messages[0] as {
        type: "card_generator_config_content";
        requirements: string;
        isOverride: boolean;
        weeklyByteLimit: number;
        weeklyBytesUsed: number;
      };
      expect(msg.requirements).toBe(DEFAULT_REQUIREMENTS);
      expect(msg.isOverride).toBe(false);
      expect(msg.weeklyByteLimit).toBe(DEFAULT_WEEKLY_BYTE_LIMIT);
      expect(msg.weeklyBytesUsed).toBe(0);
    });

    test("returns custom requirements when override exists", async () => {
      await saveRequirementsOverride("Custom requirements content");

      const { ctx, messages } = createMockContext();
      await handleGetCardGeneratorConfig(ctx);

      expect(messages).toHaveLength(1);
      const msg = messages[0] as {
        type: "card_generator_config_content";
        requirements: string;
        isOverride: boolean;
      };
      expect(msg.requirements).toBe("Custom requirements content");
      expect(msg.isOverride).toBe(true);
    });

    test("returns custom byte limit when configured", async () => {
      await saveCardGeneratorConfig({ weeklyByteLimit: 1000000 });

      const { ctx, messages } = createMockContext();
      await handleGetCardGeneratorConfig(ctx);

      expect(messages).toHaveLength(1);
      const msg = messages[0] as {
        type: "card_generator_config_content";
        weeklyByteLimit: number;
      };
      expect(msg.weeklyByteLimit).toBe(1000000);
    });
  });

  // =============================================================================
  // handleSaveCardGeneratorRequirements Tests
  // =============================================================================

  describe("handleSaveCardGeneratorRequirements", () => {
    test("saves requirements and returns success", async () => {
      const { ctx, messages } = createMockContext();

      await handleSaveCardGeneratorRequirements(ctx, "New requirements");

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe("card_generator_requirements_saved");

      const msg = messages[0] as {
        type: "card_generator_requirements_saved";
        success: boolean;
        isOverride: boolean;
      };
      expect(msg.success).toBe(true);
      expect(msg.isOverride).toBe(true);
    });

    test("persists requirements to disk", async () => {
      const { ctx } = createMockContext();

      await handleSaveCardGeneratorRequirements(ctx, "Persisted requirements");

      // Verify by loading config
      const { ctx: ctx2, messages } = createMockContext();
      await handleGetCardGeneratorConfig(ctx2);

      const msg = messages[0] as {
        type: "card_generator_config_content";
        requirements: string;
        isOverride: boolean;
      };
      expect(msg.requirements).toBe("Persisted requirements");
      expect(msg.isOverride).toBe(true);
    });
  });

  // =============================================================================
  // handleSaveCardGeneratorConfig Tests
  // =============================================================================

  describe("handleSaveCardGeneratorConfig", () => {
    test("saves byte limit and returns success", async () => {
      const { ctx, messages } = createMockContext();

      await handleSaveCardGeneratorConfig(ctx, 2000000);

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe("card_generator_config_saved");

      const msg = messages[0] as {
        type: "card_generator_config_saved";
        success: boolean;
      };
      expect(msg.success).toBe(true);
    });

    test("persists byte limit to disk", async () => {
      const { ctx } = createMockContext();

      await handleSaveCardGeneratorConfig(ctx, 3000000);

      // Verify by loading config
      const { ctx: ctx2, messages } = createMockContext();
      await handleGetCardGeneratorConfig(ctx2);

      const msg = messages[0] as {
        type: "card_generator_config_content";
        weeklyByteLimit: number;
      };
      expect(msg.weeklyByteLimit).toBe(3000000);
    });
  });

  // =============================================================================
  // handleResetCardGeneratorRequirements Tests
  // =============================================================================

  describe("handleResetCardGeneratorRequirements", () => {
    test("removes override and returns default", async () => {
      // First create an override
      await saveRequirementsOverride("Custom content to be reset");

      const { ctx, messages } = createMockContext();
      await handleResetCardGeneratorRequirements(ctx);

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe("card_generator_requirements_reset");

      const msg = messages[0] as {
        type: "card_generator_requirements_reset";
        success: boolean;
        content: string;
      };
      expect(msg.success).toBe(true);
      expect(msg.content).toBe(DEFAULT_REQUIREMENTS);
    });

    test("is idempotent when no override exists", async () => {
      const { ctx, messages } = createMockContext();

      await handleResetCardGeneratorRequirements(ctx);

      expect(messages).toHaveLength(1);
      const msg = messages[0] as {
        type: "card_generator_requirements_reset";
        success: boolean;
        content: string;
      };
      expect(msg.success).toBe(true);
      expect(msg.content).toBe(DEFAULT_REQUIREMENTS);
    });

    test("subsequent load returns default after reset", async () => {
      await saveRequirementsOverride("To be reset");

      const { ctx } = createMockContext();
      await handleResetCardGeneratorRequirements(ctx);

      // Verify by loading config
      const { ctx: ctx2, messages } = createMockContext();
      await handleGetCardGeneratorConfig(ctx2);

      const msg = messages[0] as {
        type: "card_generator_config_content";
        isOverride: boolean;
      };
      expect(msg.isOverride).toBe(false);
    });
  });

  // =============================================================================
  // handleGetCardGenerationStatus Tests
  // =============================================================================

  describe("handleGetCardGenerationStatus", () => {
    test("returns idle status when no generation running", () => {
      const { ctx, messages } = createMockContext();

      handleGetCardGenerationStatus(ctx);

      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe("card_generation_status");

      const msg = messages[0] as {
        type: "card_generation_status";
        status: string;
        message: string;
      };
      expect(msg.status).toBe("idle");
      expect(msg.message).toContain("No generation running");
    });
  });

  // =============================================================================
  // handleTriggerCardGeneration Tests
  // =============================================================================

  describe("handleTriggerCardGeneration", () => {
    test("sends initial running status", async () => {
      const { ctx, messages } = createMockContext();

      // Start the generation (will complete quickly since no vaults configured)
      await handleTriggerCardGeneration(ctx);

      // Should have at least 2 messages: initial "running" and final status
      expect(messages.length).toBeGreaterThanOrEqual(2);

      // First message should be the initial "running" status
      expect(messages[0].type).toBe("card_generation_status");
      const initialMsg = messages[0] as {
        type: "card_generation_status";
        status: string;
        message: string;
      };
      expect(initialMsg.status).toBe("running");
      expect(initialMsg.message).toContain("Starting");
    });

    test("sends final status after completion", async () => {
      const { ctx, messages } = createMockContext();

      await handleTriggerCardGeneration(ctx);

      // Last message should be the final status (complete or error)
      const lastMsg = messages[messages.length - 1] as {
        type: "card_generation_status";
        status: string;
      };
      expect(lastMsg.type).toBe("card_generation_status");
      // Status should be either "complete" or "error" (no vaults = error case)
      expect(["complete", "error"]).toContain(lastMsg.status);
    });

    test("handles generation with no configured vaults gracefully", async () => {
      const { ctx, messages } = createMockContext();

      // With HOME pointing to temp dir, there are no vaults
      await handleTriggerCardGeneration(ctx);

      // Should not throw and should send status messages
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages.every((m) => m.type === "card_generation_status")).toBe(true);
    });
  });

  // =============================================================================
  // Integration Tests
  // =============================================================================

  describe("integration: full config workflow", () => {
    test("customize, verify, reset workflow", async () => {
      // Start fresh - get defaults
      const { ctx: ctx1, messages: msgs1 } = createMockContext();
      await handleGetCardGeneratorConfig(ctx1);

      let configMsg = msgs1[0] as {
        type: "card_generator_config_content";
        requirements: string;
        isOverride: boolean;
        weeklyByteLimit: number;
      };
      expect(configMsg.isOverride).toBe(false);
      expect(configMsg.weeklyByteLimit).toBe(DEFAULT_WEEKLY_BYTE_LIMIT);

      // Save custom requirements
      const { ctx: ctx2 } = createMockContext();
      await handleSaveCardGeneratorRequirements(ctx2, "Custom rules");

      // Save custom byte limit
      const { ctx: ctx3 } = createMockContext();
      await handleSaveCardGeneratorConfig(ctx3, 5000000);

      // Verify custom config
      const { ctx: ctx4, messages: msgs4 } = createMockContext();
      await handleGetCardGeneratorConfig(ctx4);

      configMsg = msgs4[0] as typeof configMsg;
      expect(configMsg.requirements).toBe("Custom rules");
      expect(configMsg.isOverride).toBe(true);
      expect(configMsg.weeklyByteLimit).toBe(5000000);

      // Reset requirements
      const { ctx: ctx5 } = createMockContext();
      await handleResetCardGeneratorRequirements(ctx5);

      // Verify reset (requirements default, byte limit still custom)
      const { ctx: ctx6, messages: msgs6 } = createMockContext();
      await handleGetCardGeneratorConfig(ctx6);

      configMsg = msgs6[0] as typeof configMsg;
      expect(configMsg.requirements).toBe(DEFAULT_REQUIREMENTS);
      expect(configMsg.isOverride).toBe(false);
      expect(configMsg.weeklyByteLimit).toBe(5000000); // Byte limit preserved
    });
  });
});
