/**
 * API Connector Interface Tests
 *
 * Unit tests for the ApiConnector interface, ConnectorError, and connector registry.
 * These tests verify that the interface contract is correct and the registry functions
 * work as expected.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  type ApiConnector,
  type ApiResponse,
  ConnectorError,
  registerConnector,
  getConnector,
  hasConnector,
  getRegisteredConnectorNames,
  clearConnectorRegistry,
} from "../connector-interface";
import type { FieldMapping } from "../schemas";

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Mock connector implementation for testing.
 * Demonstrates that the interface can be properly implemented.
 */
class MockConnector implements ApiConnector {
  readonly name = "mock";

  fetchById(id: string): Promise<ApiResponse> {
    if (id === "error") {
      return Promise.reject(
        new ConnectorError("API error", this.name, undefined, 500)
      );
    }
    return Promise.resolve({
      id,
      title: `Item ${id}`,
      rating: 4.5,
      tags: ["tag1", "tag2"],
    });
  }

  extractFields(
    response: ApiResponse,
    mappings: FieldMapping[]
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const mapping of mappings) {
      if (mapping.source in response) {
        result[mapping.target] = response[mapping.source];
      }
    }
    return result;
  }
}

/**
 * Another mock connector with a different name.
 */
class AnotherMockConnector implements ApiConnector {
  readonly name = "another";

  fetchById(id: string): Promise<ApiResponse> {
    return Promise.resolve({ id, data: "test" });
  }

  extractFields(
    response: ApiResponse,
    mappings: FieldMapping[]
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const mapping of mappings) {
      if (mapping.source in response) {
        result[mapping.target] = response[mapping.source];
      }
    }
    return result;
  }
}

// =============================================================================
// Registry Tests
// =============================================================================

describe("Connector Registry", () => {
  beforeEach(() => {
    // Reset registry between tests to ensure isolation
    clearConnectorRegistry();
  });

  describe("registerConnector", () => {
    test("registers a connector successfully", () => {
      const connector = new MockConnector();
      registerConnector(connector);
      expect(hasConnector("mock")).toBe(true);
    });

    test("allows registering multiple connectors with different names", () => {
      registerConnector(new MockConnector());
      registerConnector(new AnotherMockConnector());

      expect(hasConnector("mock")).toBe(true);
      expect(hasConnector("another")).toBe(true);
    });

    test("throws error when registering duplicate connector name", () => {
      const connector1 = new MockConnector();
      const connector2 = new MockConnector();

      registerConnector(connector1);

      expect(() => registerConnector(connector2)).toThrow(
        'Connector "mock" is already registered'
      );
    });
  });

  describe("getConnector", () => {
    test("returns registered connector by name", () => {
      const connector = new MockConnector();
      registerConnector(connector);

      const retrieved = getConnector("mock");
      expect(retrieved).toBe(connector);
      expect(retrieved.name).toBe("mock");
    });

    test("throws error for unregistered connector", () => {
      expect(() => getConnector("nonexistent")).toThrow(
        'Unknown connector "nonexistent"'
      );
    });

    test("error message includes available connectors when some exist", () => {
      registerConnector(new MockConnector());
      registerConnector(new AnotherMockConnector());

      try {
        getConnector("nonexistent");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect((error as Error).message).toContain("Available connectors:");
        expect((error as Error).message).toContain("mock");
        expect((error as Error).message).toContain("another");
      }
    });

    test("error message indicates no connectors when registry is empty", () => {
      try {
        getConnector("nonexistent");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect((error as Error).message).toContain("No connectors registered");
      }
    });
  });

  describe("hasConnector", () => {
    test("returns true for registered connector", () => {
      registerConnector(new MockConnector());
      expect(hasConnector("mock")).toBe(true);
    });

    test("returns false for unregistered connector", () => {
      expect(hasConnector("nonexistent")).toBe(false);
    });
  });

  describe("getRegisteredConnectorNames", () => {
    test("returns empty array when no connectors registered", () => {
      const names = getRegisteredConnectorNames();
      expect(names).toEqual([]);
    });

    test("returns names of all registered connectors", () => {
      registerConnector(new MockConnector());
      registerConnector(new AnotherMockConnector());

      const names = getRegisteredConnectorNames();
      expect(names).toContain("mock");
      expect(names).toContain("another");
      expect(names).toHaveLength(2);
    });
  });

  describe("clearConnectorRegistry", () => {
    test("removes all registered connectors", () => {
      registerConnector(new MockConnector());
      registerConnector(new AnotherMockConnector());

      clearConnectorRegistry();

      expect(hasConnector("mock")).toBe(false);
      expect(hasConnector("another")).toBe(false);
      expect(getRegisteredConnectorNames()).toEqual([]);
    });

    test("allows re-registering after clear", () => {
      registerConnector(new MockConnector());
      clearConnectorRegistry();
      registerConnector(new MockConnector());

      expect(hasConnector("mock")).toBe(true);
    });
  });
});

// =============================================================================
// ApiConnector Interface Tests
// =============================================================================

describe("ApiConnector Implementation", () => {
  const connector = new MockConnector();

  describe("fetchById", () => {
    test("returns ApiResponse with data", async () => {
      const response = await connector.fetchById("123");

      expect(response).toBeDefined();
      expect(response.id).toBe("123");
      expect(response.title).toBe("Item 123");
      expect(response.rating).toBe(4.5);
      expect(response.tags).toEqual(["tag1", "tag2"]);
    });

    test("throws ConnectorError on failure", async () => {
      try {
        await connector.fetchById("error");
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ConnectorError);
        const connectorError = error as ConnectorError;
        expect(connectorError.connector).toBe("mock");
        expect(connectorError.statusCode).toBe(500);
        expect(connectorError.message).toBe("API error");
      }
    });
  });

  describe("extractFields", () => {
    test("extracts fields according to mappings", async () => {
      const response = await connector.fetchById("123");
      const mappings: FieldMapping[] = [
        { source: "title", target: "name" },
        { source: "rating", target: "score" },
      ];

      const fields = connector.extractFields(response, mappings);

      expect(fields).toEqual({
        name: "Item 123",
        score: 4.5,
      });
    });

    test("skips missing source fields", async () => {
      const response = await connector.fetchById("123");
      const mappings: FieldMapping[] = [
        { source: "title", target: "name" },
        { source: "nonexistent", target: "missing" },
      ];

      const fields = connector.extractFields(response, mappings);

      expect(fields).toEqual({ name: "Item 123" });
      expect("missing" in fields).toBe(false);
    });

    test("handles array fields", async () => {
      const response = await connector.fetchById("123");
      const mappings: FieldMapping[] = [{ source: "tags", target: "categories" }];

      const fields = connector.extractFields(response, mappings);

      expect(fields.categories).toEqual(["tag1", "tag2"]);
    });

    test("returns empty object for empty mappings", async () => {
      const response = await connector.fetchById("123");
      const fields = connector.extractFields(response, []);

      expect(fields).toEqual({});
    });

    test("respects target field names from mappings", async () => {
      const response = await connector.fetchById("123");
      const mappings: FieldMapping[] = [
        { source: "rating", target: "bgg.rating" },
        { source: "title", target: "synced.name" },
      ];

      const fields = connector.extractFields(response, mappings);

      expect(fields["bgg.rating"]).toBe(4.5);
      expect(fields["synced.name"]).toBe("Item 123");
    });
  });
});

// =============================================================================
// ConnectorError Tests
// =============================================================================

describe("ConnectorError", () => {
  test("creates error with all properties", () => {
    const cause = new Error("Network failure");
    const error = new ConnectorError("API request failed", "bgg", cause, 503);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ConnectorError);
    expect(error.name).toBe("ConnectorError");
    expect(error.message).toBe("API request failed");
    expect(error.connector).toBe("bgg");
    expect(error.cause).toBe(cause);
    expect(error.statusCode).toBe(503);
  });

  test("creates error with minimal properties", () => {
    const error = new ConnectorError("Simple error", "mock");

    expect(error.message).toBe("Simple error");
    expect(error.connector).toBe("mock");
    expect(error.cause).toBeUndefined();
    expect(error.statusCode).toBeUndefined();
  });

  test("inherits from Error prototype chain", () => {
    const error = new ConnectorError("Test", "connector");

    expect(error instanceof Error).toBe(true);
    const proto = Object.getPrototypeOf(error) as { constructor: unknown };
    expect(proto.constructor).toBe(ConnectorError);
  });
});
