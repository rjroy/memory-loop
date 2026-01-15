/**
 * Tests for BGG XML API Connector
 *
 * Tests cover:
 * - Successful fetch and XML parsing
 * - Rate limiting (429) with exponential backoff
 * - 202 "accepted" responses requiring retry
 * - Invalid XML handling
 * - Missing fields handling
 * - Field extraction based on mappings
 * - Authentication header handling
 */

/* eslint-disable @typescript-eslint/await-thenable */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { BggConnector, type BggConnectorOptions } from "../connectors/bgg-connector.js";
import { clearConnectorRegistry, getConnector } from "../connector-interface.js";
import type { FieldMapping } from "../schemas.js";
import { ConnectorError } from "../connector-interface.js";

// Fast retry options for tests to avoid timeouts
const FAST_RETRY_OPTIONS: BggConnectorOptions = {
  maxRetries: 3,
  initialBackoffMs: 1, // 1ms instead of 1000ms
  maxBackoffMs: 10, // 10ms instead of 30000ms
};

/**
 * Create a properly typed mock fetch function.
 * Bun's fetch type includes a `preconnect` property that we need to satisfy.
 */
function createMockFetch(impl: (url: string | URL | Request, init?: RequestInit) => Promise<Response>): typeof fetch {
  const mockFn = mock(impl);
  // Add the preconnect property to satisfy the type
  (mockFn as unknown as { preconnect: (url: string) => void }).preconnect = () => {};
  return mockFn as unknown as typeof fetch;
}

// =============================================================================
// Test Fixtures: Sample XML Responses
// =============================================================================

const GLOOMHAVEN_XML = `<?xml version="1.0" encoding="utf-8"?>
<items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
  <item type="boardgame" id="174430">
    <name type="primary" sortindex="1" value="Gloomhaven"/>
    <name type="alternate" sortindex="1" value="Gloomhaven: Second Edition"/>
    <yearpublished value="2017"/>
    <minplayers value="1"/>
    <maxplayers value="4"/>
    <minplaytime value="60"/>
    <maxplaytime value="120"/>
    <statistics page="1">
      <ratings>
        <usersrated value="65432"/>
        <average value="8.57"/>
        <bayesaverage value="8.42"/>
        <stddev value="1.82"/>
        <median value="0"/>
        <owned value="123456"/>
        <trading value="1234"/>
        <wanting value="567"/>
        <wishing value="8901"/>
        <numcomments value="12345"/>
        <numweights value="5678"/>
        <averageweight value="3.87"/>
      </ratings>
    </statistics>
    <link type="boardgamecategory" id="1022" value="Adventure"/>
    <link type="boardgamecategory" id="1020" value="Exploration"/>
    <link type="boardgamecategory" id="1010" value="Fantasy"/>
    <link type="boardgamemechanic" id="2023" value="Co-operative Game"/>
    <link type="boardgamemechanic" id="2040" value="Hand Management"/>
    <link type="boardgamemechanic" id="2689" value="Grid Movement"/>
    <link type="boardgamedesigner" id="69802" value="Isaac Childres"/>
    <link type="boardgamepublisher" id="27425" value="Cephalofair Games"/>
  </item>
</items>`;

const SIMPLE_GAME_XML = `<?xml version="1.0" encoding="utf-8"?>
<items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
  <item type="boardgame" id="1">
    <name type="primary" sortindex="1" value="Die Macher"/>
    <yearpublished value="1986"/>
    <minplayers value="3"/>
    <maxplayers value="5"/>
    <minplaytime value="240"/>
    <maxplaytime value="300"/>
    <statistics page="1">
      <ratings>
        <average value="7.5"/>
        <averageweight value="4.32"/>
      </ratings>
    </statistics>
    <link type="boardgamecategory" id="1001" value="Political"/>
    <link type="boardgamemechanic" id="2012" value="Auction/Bidding"/>
  </item>
</items>`;

const MINIMAL_XML = `<?xml version="1.0" encoding="utf-8"?>
<items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
  <item type="boardgame" id="12345">
    <name type="primary" sortindex="1" value="Minimal Game"/>
  </item>
</items>`;

const EMPTY_RESPONSE_XML = `<?xml version="1.0" encoding="utf-8"?>
<items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
</items>`;

const ALTERNATE_NAME_ONLY_XML = `<?xml version="1.0" encoding="utf-8"?>
<items termsofuse="https://boardgamegeek.com/xmlapi/termsofuse">
  <item type="boardgame" id="999">
    <name type="alternate" sortindex="1" value="German Name"/>
  </item>
</items>`;

// =============================================================================
// Mock Response Helper
// =============================================================================

function createMockResponse(
  body: string,
  status: number = 200,
  statusText: string = "OK"
): Response {
  return new Response(body, {
    status,
    statusText,
    headers: { "Content-Type": "application/xml" },
  });
}

// =============================================================================
// Test Suite
// =============================================================================

describe("BggConnector", () => {
  let connector: BggConnector;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    // Create a fresh connector for each test
    connector = new BggConnector();
    // Save original fetch
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    // Restore original fetch
    globalThis.fetch = originalFetch;
  });

  // ===========================================================================
  // Registration Tests
  // ===========================================================================

  describe("registration", () => {
    beforeEach(() => {
      clearConnectorRegistry();
    });

    it("should have name 'bgg'", () => {
      expect(connector.name).toBe("bgg");
    });

    it("should register itself when module loads", async () => {
      // Re-import to trigger registration
      const { bggConnector } = await import("../connectors/bgg-connector.js");
      expect(bggConnector.name).toBe("bgg");
    });
  });

  // ===========================================================================
  // fetchById Tests - Success Cases
  // ===========================================================================

  describe("fetchById - success cases", () => {
    it("should fetch and parse a complete game response", async () => {
      globalThis.fetch = createMockFetch(() =>
        Promise.resolve(createMockResponse(GLOOMHAVEN_XML))
      );

      const result = await connector.fetchById("174430");

      expect(result.id).toBe("174430");
      expect(result.type).toBe("boardgame");
      expect(result.name).toBe("Gloomhaven");
      expect(result.year).toBe(2017);
      expect(result.rating).toBe(8.57);
      expect(result.weight).toBe(3.87);
      expect(result.minPlayers).toBe(1);
      expect(result.maxPlayers).toBe(4);
      expect(result.minPlaytime).toBe(60);
      expect(result.maxPlaytime).toBe(120);
    });

    it("should extract mechanics as array", async () => {
      globalThis.fetch = createMockFetch(() =>
        Promise.resolve(createMockResponse(GLOOMHAVEN_XML))
      );

      const result = await connector.fetchById("174430");

      expect(result.mechanics).toEqual([
        "Co-operative Game",
        "Hand Management",
        "Grid Movement",
      ]);
    });

    it("should extract categories as array", async () => {
      globalThis.fetch = createMockFetch(() =>
        Promise.resolve(createMockResponse(GLOOMHAVEN_XML))
      );

      const result = await connector.fetchById("174430");

      expect(result.categories).toEqual([
        "Adventure",
        "Exploration",
        "Fantasy",
      ]);
    });

    it("should extract designers as array", async () => {
      globalThis.fetch = createMockFetch(() =>
        Promise.resolve(createMockResponse(GLOOMHAVEN_XML))
      );

      const result = await connector.fetchById("174430");

      expect(result.designers).toEqual(["Isaac Childres"]);
    });

    it("should extract publishers as array", async () => {
      globalThis.fetch = createMockFetch(() =>
        Promise.resolve(createMockResponse(GLOOMHAVEN_XML))
      );

      const result = await connector.fetchById("174430");

      expect(result.publishers).toEqual(["Cephalofair Games"]);
    });

    it("should handle minimal game data", async () => {
      globalThis.fetch = createMockFetch(() =>
        Promise.resolve(createMockResponse(MINIMAL_XML))
      );

      const result = await connector.fetchById("12345");

      expect(result.id).toBe("12345");
      expect(result.name).toBe("Minimal Game");
      // Optional fields should be undefined
      expect(result.rating).toBeUndefined();
      expect(result.weight).toBeUndefined();
      expect(result.minPlayers).toBeUndefined();
    });

    it("should use alternate name if no primary name exists", async () => {
      globalThis.fetch = createMockFetch(() =>
        Promise.resolve(createMockResponse(ALTERNATE_NAME_ONLY_XML))
      );

      const result = await connector.fetchById("999");

      expect(result.name).toBe("German Name");
    });

    it("should encode game ID in URL", async () => {
      let capturedUrl: string | undefined;
      globalThis.fetch = createMockFetch((url) => {
        if (typeof url === "string") {
          capturedUrl = url;
        } else if (url instanceof URL) {
          capturedUrl = url.href;
        } else {
          capturedUrl = url.url;
        }
        return Promise.resolve(createMockResponse(SIMPLE_GAME_XML));
      });

      await connector.fetchById("123");

      expect(capturedUrl).toContain("id=123");
      expect(capturedUrl).toContain("stats=1");
    });
  });

  // ===========================================================================
  // fetchById Tests - Error Cases
  // ===========================================================================

  describe("fetchById - error cases", () => {
    it("should throw ConnectorError for empty response", async () => {
      globalThis.fetch = createMockFetch(() =>
        Promise.resolve(createMockResponse(EMPTY_RESPONSE_XML))
      );

      await expect(connector.fetchById("99999")).rejects.toThrow(ConnectorError);
      await expect(connector.fetchById("99999")).rejects.toMatchObject({
        connector: "bgg",
        message: expect.stringContaining("No game found"),
      });
    });

    it("should throw ConnectorError for 404 response", async () => {
      globalThis.fetch = createMockFetch(() =>
        Promise.resolve(createMockResponse("", 404, "Not Found"))
      );

      await expect(connector.fetchById("99999")).rejects.toThrow(ConnectorError);
      await expect(connector.fetchById("99999")).rejects.toMatchObject({
        connector: "bgg",
        statusCode: 404,
      });
    });

    it("should throw ConnectorError for 500 response", async () => {
      globalThis.fetch = createMockFetch(() =>
        Promise.resolve(createMockResponse("", 500, "Internal Server Error"))
      );

      await expect(connector.fetchById("123")).rejects.toThrow(ConnectorError);
      await expect(connector.fetchById("123")).rejects.toMatchObject({
        connector: "bgg",
        statusCode: 500,
      });
    });

    it("should throw ConnectorError for invalid XML", async () => {
      globalThis.fetch = createMockFetch(() =>
        Promise.resolve(createMockResponse("<not-valid-xml", 200))
      );

      // fast-xml-parser handles malformed XML gracefully but won't find items
      await expect(connector.fetchById("123")).rejects.toThrow(ConnectorError);
    });

    it("should throw ConnectorError after network failure retries", async () => {
      const fastConnector = new BggConnector(FAST_RETRY_OPTIONS);
      globalThis.fetch = createMockFetch(() =>
        Promise.reject(new Error("Network error"))
      );

      await expect(fastConnector.fetchById("123")).rejects.toThrow(ConnectorError);

      globalThis.fetch = createMockFetch(() =>
        Promise.reject(new Error("Network error"))
      );
      await expect(fastConnector.fetchById("123")).rejects.toMatchObject({
        connector: "bgg",
        message: expect.stringContaining("after 3 retries"),
      });
    });
  });

  // ===========================================================================
  // Rate Limiting Tests (429)
  // ===========================================================================

  describe("fetchById - rate limiting", () => {
    it("should retry on 429 with backoff", async () => {
      const fastConnector = new BggConnector(FAST_RETRY_OPTIONS);
      let callCount = 0;
      globalThis.fetch = createMockFetch(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.resolve(createMockResponse("", 429, "Too Many Requests"));
        }
        return Promise.resolve(createMockResponse(SIMPLE_GAME_XML));
      });

      const result = await fastConnector.fetchById("1");

      expect(callCount).toBe(3);
      expect(result.name).toBe("Die Macher");
    });

    it("should throw after max retries on persistent 429", async () => {
      const fastConnector = new BggConnector(FAST_RETRY_OPTIONS);
      globalThis.fetch = createMockFetch(() =>
        Promise.resolve(createMockResponse("", 429, "Too Many Requests"))
      );

      await expect(fastConnector.fetchById("123")).rejects.toThrow(ConnectorError);

      globalThis.fetch = createMockFetch(() =>
        Promise.resolve(createMockResponse("", 429, "Too Many Requests"))
      );
      await expect(fastConnector.fetchById("123")).rejects.toMatchObject({
        connector: "bgg",
        statusCode: 429,
        message: expect.stringContaining("Rate limited"),
      });
    });
  });

  // ===========================================================================
  // 202 "Accepted" Response Tests
  // ===========================================================================

  describe("fetchById - 202 accepted responses", () => {
    it("should retry on 202 responses", async () => {
      const fastConnector = new BggConnector(FAST_RETRY_OPTIONS);
      let callCount = 0;
      globalThis.fetch = createMockFetch(() => {
        callCount++;
        if (callCount < 2) {
          return Promise.resolve(createMockResponse("", 202, "Accepted"));
        }
        return Promise.resolve(createMockResponse(SIMPLE_GAME_XML));
      });

      const result = await fastConnector.fetchById("1");

      expect(callCount).toBe(2);
      expect(result.name).toBe("Die Macher");
    });

    it("should throw after max retries on persistent 202", async () => {
      const fastConnector = new BggConnector(FAST_RETRY_OPTIONS);
      globalThis.fetch = createMockFetch(() =>
        Promise.resolve(createMockResponse("", 202, "Accepted"))
      );

      await expect(fastConnector.fetchById("123")).rejects.toThrow(ConnectorError);

      globalThis.fetch = createMockFetch(() =>
        Promise.resolve(createMockResponse("", 202, "Accepted"))
      );
      await expect(fastConnector.fetchById("123")).rejects.toMatchObject({
        connector: "bgg",
        statusCode: 202,
        message: expect.stringContaining("202"),
      });
    });
  });

  // ===========================================================================
  // Authentication Tests
  // ===========================================================================

  describe("authentication", () => {
    it("should include Authorization header when token is set", async () => {
      let capturedHeaders: Record<string, string> | undefined;
      globalThis.fetch = createMockFetch((_url, options) => {
        capturedHeaders = options?.headers as Record<string, string>;
        return Promise.resolve(createMockResponse(SIMPLE_GAME_XML));
      });

      connector.setAuthToken("test-token-123");
      await connector.fetchById("1");

      expect(capturedHeaders?.["Authorization"]).toBe("Bearer test-token-123");
    });

    it("should not include Authorization header when no token set", async () => {
      let capturedHeaders: Record<string, string> | undefined;
      globalThis.fetch = createMockFetch((_url, options) => {
        capturedHeaders = options?.headers as Record<string, string>;
        return Promise.resolve(createMockResponse(SIMPLE_GAME_XML));
      });

      await connector.fetchById("1");

      expect(capturedHeaders?.["Authorization"]).toBeUndefined();
    });
  });

  // ===========================================================================
  // extractFields Tests
  // ===========================================================================

  describe("extractFields", () => {
    const sampleResponse = {
      id: "174430",
      name: "Gloomhaven",
      rating: 8.57,
      weight: 3.87,
      minPlayers: 1,
      maxPlayers: 4,
      mechanics: ["Co-operative Game", "Hand Management"],
      categories: ["Adventure", "Fantasy"],
    };

    it("should extract mapped fields to new target names", () => {
      const mappings: FieldMapping[] = [
        { source: "name", target: "title" },
        { source: "rating", target: "bgg_rating" },
      ];

      const result = connector.extractFields(sampleResponse, mappings);

      expect(result).toEqual({
        title: "Gloomhaven",
        bgg_rating: 8.57,
      });
    });

    it("should handle same source and target names", () => {
      const mappings: FieldMapping[] = [
        { source: "name", target: "name" },
        { source: "mechanics", target: "mechanics" },
      ];

      const result = connector.extractFields(sampleResponse, mappings);

      expect(result).toEqual({
        name: "Gloomhaven",
        mechanics: ["Co-operative Game", "Hand Management"],
      });
    });

    it("should skip fields not present in response", () => {
      const mappings: FieldMapping[] = [
        { source: "name", target: "title" },
        { source: "nonexistent", target: "missing" },
      ];

      const result = connector.extractFields(sampleResponse, mappings);

      expect(result).toEqual({ title: "Gloomhaven" });
      expect(result.missing).toBeUndefined();
    });

    it("should return empty object for empty mappings", () => {
      const result = connector.extractFields(sampleResponse, []);
      expect(result).toEqual({});
    });

    it("should preserve array values", () => {
      const mappings: FieldMapping[] = [
        { source: "mechanics", target: "game_mechanics" },
      ];

      const result = connector.extractFields(sampleResponse, mappings);

      expect(result.game_mechanics).toEqual([
        "Co-operative Game",
        "Hand Management",
      ]);
    });

    it("should preserve numeric values", () => {
      const mappings: FieldMapping[] = [
        { source: "rating", target: "score" },
        { source: "minPlayers", target: "players_min" },
      ];

      const result = connector.extractFields(sampleResponse, mappings);

      expect(result.score).toBe(8.57);
      expect(result.players_min).toBe(1);
    });

    it("should ignore strategy and normalize flags (handled by pipeline)", () => {
      const mappings: FieldMapping[] = [
        { source: "name", target: "title", strategy: "preserve" },
        { source: "mechanics", target: "mechanics", normalize: true },
      ];

      const result = connector.extractFields(sampleResponse, mappings);

      // extractFields just does the mapping, not the strategy or normalization
      expect(result.title).toBe("Gloomhaven");
      expect(result.mechanics).toEqual(["Co-operative Game", "Hand Management"]);
    });
  });

  // ===========================================================================
  // Retry Logic Tests
  // ===========================================================================

  describe("retry logic", () => {
    it("should retry up to 3 times on network errors", async () => {
      const fastConnector = new BggConnector(FAST_RETRY_OPTIONS);
      let callCount = 0;
      globalThis.fetch = createMockFetch(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error("Connection refused"));
        }
        return Promise.resolve(createMockResponse(SIMPLE_GAME_XML));
      });

      const result = await fastConnector.fetchById("1");

      expect(callCount).toBe(3);
      expect(result.name).toBe("Die Macher");
    });

    it("should fail after exactly 3 retries", async () => {
      const fastConnector = new BggConnector(FAST_RETRY_OPTIONS);
      let callCount = 0;
      globalThis.fetch = createMockFetch(() => {
        callCount++;
        return Promise.reject(new Error("Connection refused"));
      });

      await expect(fastConnector.fetchById("123")).rejects.toThrow();

      expect(callCount).toBe(3);
    });
  });

  // ===========================================================================
  // XML Parsing Edge Cases
  // ===========================================================================

  describe("XML parsing edge cases", () => {
    it("should handle single link element", async () => {
      const singleLinkXml = `<?xml version="1.0" encoding="utf-8"?>
<items>
  <item type="boardgame" id="1">
    <name type="primary" value="Test"/>
    <link type="boardgamemechanic" id="1" value="Single Mechanic"/>
  </item>
</items>`;

      globalThis.fetch = createMockFetch(() =>
        Promise.resolve(createMockResponse(singleLinkXml))
      );

      const result = await connector.fetchById("1");

      expect(result.mechanics).toEqual(["Single Mechanic"]);
    });

    it("should handle multiple name elements", async () => {
      const multiNameXml = `<?xml version="1.0" encoding="utf-8"?>
<items>
  <item type="boardgame" id="1">
    <name type="alternate" value="German Title"/>
    <name type="primary" value="English Title"/>
    <name type="alternate" value="French Title"/>
  </item>
</items>`;

      globalThis.fetch = createMockFetch(() =>
        Promise.resolve(createMockResponse(multiNameXml))
      );

      const result = await connector.fetchById("1");

      // Should pick primary name
      expect(result.name).toBe("English Title");
    });

    it("should handle missing statistics node", async () => {
      const noStatsXml = `<?xml version="1.0" encoding="utf-8"?>
<items>
  <item type="boardgame" id="1">
    <name type="primary" value="No Stats Game"/>
    <minplayers value="2"/>
  </item>
</items>`;

      globalThis.fetch = createMockFetch(() =>
        Promise.resolve(createMockResponse(noStatsXml))
      );

      const result = await connector.fetchById("1");

      expect(result.name).toBe("No Stats Game");
      expect(result.rating).toBeUndefined();
      expect(result.weight).toBeUndefined();
    });

    it("should handle statistics with missing ratings", async () => {
      const emptyStatsXml = `<?xml version="1.0" encoding="utf-8"?>
<items>
  <item type="boardgame" id="1">
    <name type="primary" value="Test"/>
    <statistics page="1">
    </statistics>
  </item>
</items>`;

      globalThis.fetch = createMockFetch(() =>
        Promise.resolve(createMockResponse(emptyStatsXml))
      );

      const result = await connector.fetchById("1");

      expect(result.rating).toBeUndefined();
      expect(result.weight).toBeUndefined();
    });
  });
});

// =============================================================================
// Integration with Connector Registry
// =============================================================================

describe("BggConnector registry integration", () => {
  beforeEach(() => {
    clearConnectorRegistry();
  });

  it("should be retrievable by name after import", async () => {
    // Clear and re-import to register
    const { bggConnector } = await import("../connectors/bgg-connector.js");

    // Force registration since clearConnectorRegistry was called
    const { registerConnector } = await import("../connector-interface.js");
    registerConnector(bggConnector);

    const retrieved = getConnector("bgg");
    expect(retrieved).toBe(bggConnector);
    expect(retrieved.name).toBe("bgg");
  });
});
