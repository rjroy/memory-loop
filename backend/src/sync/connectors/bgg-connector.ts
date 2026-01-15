/**
 * BoardGameGeek (BGG) XML API v2 Connector
 *
 * Fetches board game data from BGG's XML API and extracts fields for sync.
 *
 * Spec Requirements:
 * - REQ-F-27: Retry failed API requests up to 3 times before reporting error
 * - REQ-NF-4: Adding a new API connector requires implementing ApiConnector interface
 *
 * Plan Reference:
 * - TD-3: BGG XML API Connector design
 * - TD-6: Retry strategy with exponential backoff
 */

import { XMLParser } from "fast-xml-parser";
import type { FieldMapping } from "../schemas.js";
import {
  type ApiConnector,
  type ApiResponse,
  ConnectorError,
  registerConnector,
} from "../connector-interface.js";

// =============================================================================
// Constants
// =============================================================================

const BGG_API_BASE = "https://boardgamegeek.com/xmlapi2";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 30000;

// =============================================================================
// Connector Options
// =============================================================================

/**
 * Configuration options for the BGG connector.
 * Primarily used for testing to speed up retry timing.
 */
export interface BggConnectorOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial backoff delay in ms (default: 1000) */
  initialBackoffMs?: number;
  /** Maximum backoff delay in ms (default: 30000) */
  maxBackoffMs?: number;
}

// =============================================================================
// XML Parser Configuration
// =============================================================================

/**
 * Configure fast-xml-parser for BGG XML responses.
 *
 * Key settings:
 * - ignoreAttributes: false - We need attribute values (e.g., value="8.5")
 * - attributeNamePrefix: "" - Keep attribute names clean
 * - isArray: Function to force array parsing for repeated elements like <link>
 */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => {
    // These elements can appear multiple times and should always be arrays
    return ["link", "name", "poll", "result", "results"].includes(name);
  },
});

// =============================================================================
// Types for BGG XML Response (internal)
// =============================================================================

interface BggNameElement {
  "@_type": string;
  "@_value": string;
}

interface BggLinkElement {
  "@_type": string;
  "@_id": string;
  "@_value": string;
}

interface BggRatings {
  average?: { "@_value": string };
  averageweight?: { "@_value": string };
  usersrated?: { "@_value": string };
  owned?: { "@_value": string };
}

interface BggStatistics {
  ratings?: BggRatings;
}

interface BggItem {
  "@_type"?: string;
  "@_id"?: string;
  name?: BggNameElement[];
  yearpublished?: { "@_value": string };
  minplayers?: { "@_value": string };
  maxplayers?: { "@_value": string };
  minplaytime?: { "@_value": string };
  maxplaytime?: { "@_value": string };
  statistics?: BggStatistics;
  link?: BggLinkElement[];
}

interface BggApiResponse {
  items?: {
    item?: BggItem | BggItem[];
  };
}

// =============================================================================
// Field Extraction Mapping
// =============================================================================

/**
 * Maps source field names to extraction functions.
 * Each function extracts a specific value from the parsed BGG response.
 */
type FieldExtractor = (item: BggItem) => unknown;

const fieldExtractors: Record<string, FieldExtractor> = {
  name: (item) => {
    const names = item.name ?? [];
    const primary = names.find((n) => n["@_type"] === "primary");
    return primary?.["@_value"] ?? names[0]?.["@_value"];
  },

  rating: (item) => {
    const val = item.statistics?.ratings?.average?.["@_value"];
    return val ? parseFloat(val) : undefined;
  },

  weight: (item) => {
    const val = item.statistics?.ratings?.averageweight?.["@_value"];
    return val ? parseFloat(val) : undefined;
  },

  minPlayers: (item) => {
    const val = item.minplayers?.["@_value"];
    return val ? parseInt(val, 10) : undefined;
  },

  maxPlayers: (item) => {
    const val = item.maxplayers?.["@_value"];
    return val ? parseInt(val, 10) : undefined;
  },

  minPlaytime: (item) => {
    const val = item.minplaytime?.["@_value"];
    return val ? parseInt(val, 10) : undefined;
  },

  maxPlaytime: (item) => {
    const val = item.maxplaytime?.["@_value"];
    return val ? parseInt(val, 10) : undefined;
  },

  year: (item) => {
    const val = item.yearpublished?.["@_value"];
    return val ? parseInt(val, 10) : undefined;
  },

  mechanics: (item) => {
    const links = item.link ?? [];
    return links
      .filter((l) => l["@_type"] === "boardgamemechanic")
      .map((l) => l["@_value"]);
  },

  categories: (item) => {
    const links = item.link ?? [];
    return links
      .filter((l) => l["@_type"] === "boardgamecategory")
      .map((l) => l["@_value"]);
  },

  designers: (item) => {
    const links = item.link ?? [];
    return links
      .filter((l) => l["@_type"] === "boardgamedesigner")
      .map((l) => l["@_value"]);
  },

  publishers: (item) => {
    const links = item.link ?? [];
    return links
      .filter((l) => l["@_type"] === "boardgamepublisher")
      .map((l) => l["@_value"]);
  },
};

// =============================================================================
// Sleep utility for backoff
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// BGG Connector Implementation
// =============================================================================

/**
 * BoardGameGeek API Connector.
 *
 * Implements the ApiConnector interface for fetching board game data from BGG.
 * Handles rate limiting (429 responses) with exponential backoff.
 */
export class BggConnector implements ApiConnector {
  readonly name = "bgg";

  private authToken: string | undefined;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(options: BggConnectorOptions = {}) {
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  }

  /**
   * Set the BGG API authorization token.
   * Required since late 2025 when BGG added authentication requirements.
   *
   * @param token - Bearer token obtained from BGG applications page
   */
  setAuthToken(token: string): void {
    this.authToken = token;
  }

  /**
   * Fetch board game data from BGG by game ID.
   *
   * @param id - BGG game ID (e.g., "174430" for Gloomhaven)
   * @returns Parsed API response with game data
   * @throws ConnectorError if fetch fails after retries
   */
  async fetchById(id: string): Promise<ApiResponse> {
    const url = `${BGG_API_BASE}/thing?id=${encodeURIComponent(id)}&stats=1`;

    let lastError: Error | undefined;
    let backoffMs = this.initialBackoffMs;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.makeRequest(url);

        // Handle rate limiting
        if (response.status === 429) {
          if (attempt < this.maxRetries) {
            await sleep(backoffMs);
            backoffMs = Math.min(backoffMs * 2, this.maxBackoffMs);
            continue;
          }
          throw new ConnectorError(
            `Rate limited by BGG API after ${this.maxRetries} retries`,
            this.name,
            undefined,
            429
          );
        }

        // Handle 202 "request accepted" - BGG sometimes returns this when
        // generating data, requiring a retry
        if (response.status === 202) {
          if (attempt < this.maxRetries) {
            await sleep(backoffMs);
            backoffMs = Math.min(backoffMs * 2, this.maxBackoffMs);
            continue;
          }
          throw new ConnectorError(
            "BGG API returned 202 (request accepted but not ready) after retries",
            this.name,
            undefined,
            202
          );
        }

        // Handle other error responses
        if (!response.ok) {
          throw new ConnectorError(
            `BGG API returned ${response.status}: ${response.statusText}`,
            this.name,
            undefined,
            response.status
          );
        }

        const xml = await response.text();
        return this.parseResponse(xml, id);
      } catch (error) {
        if (error instanceof ConnectorError) {
          // Don't retry connector errors (they're already handled)
          throw error;
        }

        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.maxRetries) {
          await sleep(backoffMs);
          backoffMs = Math.min(backoffMs * 2, this.maxBackoffMs);
        }
      }
    }

    throw new ConnectorError(
      `Failed to fetch game ${id} after ${this.maxRetries} retries`,
      this.name,
      lastError
    );
  }

  /**
   * Make an HTTP request to the BGG API.
   * Separated for easier testing via mocking.
   */
  protected async makeRequest(url: string): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "application/xml",
    };

    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }

    return fetch(url, { headers });
  }

  /**
   * Parse BGG XML response into ApiResponse format.
   */
  private parseResponse(xml: string, requestedId: string): ApiResponse {
    const parsed = xmlParser.parse(xml) as BggApiResponse;
    const items = parsed.items?.item;

    if (!items) {
      throw new ConnectorError(
        `No game found with ID ${requestedId}`,
        this.name
      );
    }

    // Handle both single item and array responses
    const item = Array.isArray(items) ? items[0] : items;

    if (!item) {
      throw new ConnectorError(
        `No game found with ID ${requestedId}`,
        this.name
      );
    }

    // Extract all fields into a flat ApiResponse
    const result: ApiResponse = {
      id: item["@_id"] ?? requestedId,
      type: item["@_type"],
    };

    // Run all extractors and add non-undefined values
    for (const [field, extractor] of Object.entries(fieldExtractors)) {
      const value = extractor(item);
      if (value !== undefined) {
        result[field] = value;
      }
    }

    return result;
  }

  /**
   * Extract fields from an API response based on field mappings.
   *
   * @param response - Raw API response from fetchById
   * @param mappings - Field mappings from pipeline config
   * @returns Object with extracted field values, keyed by target field name
   */
  extractFields(
    response: ApiResponse,
    mappings: FieldMapping[]
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const mapping of mappings) {
      const value = response[mapping.source];
      if (value !== undefined) {
        result[mapping.target] = value;
      }
    }

    return result;
  }
}

// =============================================================================
// Connector Registration
// =============================================================================

/**
 * Create and register the BGG connector singleton.
 * Called when this module is imported.
 */
const bggConnector = new BggConnector();
registerConnector(bggConnector);

// Export for testing and direct access
export { bggConnector };
