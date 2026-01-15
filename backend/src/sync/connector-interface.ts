/**
 * API Connector Interface
 *
 * Defines the contract for all external API connectors. This interface enables
 * extensibility (adding books, movies, etc.) without modifying core sync logic.
 *
 * Spec Requirements:
 * - REQ-NF-4: Adding a new API connector requires implementing a defined interface,
 *   not modifying core sync logic
 *
 * Plan Reference:
 * - TD-2: API Connector Interface design
 */

import type { FieldMapping } from "./schemas.js";

// =============================================================================
// API Response Type
// =============================================================================

/**
 * Raw response data from an external API.
 *
 * This is a flexible type that accommodates different API response formats.
 * Each connector is responsible for parsing its API's response into this shape.
 * The structure is intentionally loose (Record<string, unknown>) because:
 * - Different APIs have different response structures (XML, JSON, nested objects)
 * - Connectors transform these into a normalized key-value format
 * - Field extraction then maps these keys to frontmatter fields
 *
 * Example for BGG (after XML parsing):
 * ```typescript
 * {
 *   name: "Gloomhaven",
 *   rating: 8.5,
 *   weight: 3.87,
 *   mechanics: ["Hand Management", "Campaign"],
 *   minPlayers: 1,
 *   maxPlayers: 4
 * }
 * ```
 */
export type ApiResponse = Record<string, unknown>;

// =============================================================================
// API Connector Interface
// =============================================================================

/**
 * Interface that all external API connectors must implement.
 *
 * Connectors encapsulate:
 * - API authentication and request formatting
 * - Rate limiting and retry logic
 * - Response parsing (XML, JSON, etc.)
 * - Field extraction based on mappings
 *
 * This abstraction allows the sync pipeline to work with any API without
 * knowing the implementation details. New connectors (books via OpenLibrary,
 * movies via TMDB) can be added by implementing this interface.
 *
 * Usage:
 * ```typescript
 * const connector = getConnector("bgg");
 * const response = await connector.fetchById("174430");
 * const fields = connector.extractFields(response, fieldMappings);
 * ```
 */
export interface ApiConnector {
  /**
   * Unique identifier for this connector.
   * Used in pipeline config to select which connector to use.
   * Example: "bgg", "openlibrary", "tmdb"
   */
  readonly name: string;

  /**
   * Fetch data from the external API by ID.
   *
   * @param id - The external identifier (e.g., BGG game ID "174430")
   * @returns Parsed API response data
   * @throws ConnectorError if the fetch fails after retries
   *
   * Implementations should handle:
   * - Rate limiting (429 responses with exponential backoff)
   * - Network errors (retry up to 3 times per REQ-F-27)
   * - Response parsing (XML/JSON to ApiResponse)
   */
  fetchById(id: string): Promise<ApiResponse>;

  /**
   * Extract fields from an API response based on field mappings.
   *
   * @param response - Raw API response from fetchById
   * @param mappings - Field mappings from pipeline config
   * @returns Object with extracted field values, keyed by target field name
   *
   * Example:
   * ```typescript
   * const mappings = [
   *   { source: "name", target: "title" },
   *   { source: "mechanics", target: "mechanics", normalize: true }
   * ];
   * const fields = connector.extractFields(response, mappings);
   * // { title: "Gloomhaven", mechanics: ["Hand Management", "Campaign"] }
   * ```
   *
   * Note: The normalize flag is included in mappings but normalization itself
   * is handled by the sync pipeline (vocabulary-normalizer), not the connector.
   * Connectors just extract raw values.
   */
  extractFields(
    response: ApiResponse,
    mappings: FieldMapping[]
  ): Record<string, unknown>;
}

// =============================================================================
// Connector Error
// =============================================================================

/**
 * Error thrown by connectors when API operations fail.
 * Provides context about which connector failed and why.
 */
export class ConnectorError extends Error {
  constructor(
    /** Human-readable error message */
    message: string,
    /** Connector that threw the error */
    public readonly connector: string,
    /** Original error if wrapping another error */
    public readonly cause?: Error,
    /** HTTP status code if applicable */
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

// =============================================================================
// Connector Registry
// =============================================================================

/**
 * Registry of available API connectors.
 * Connectors register themselves on import using registerConnector().
 */
const connectorRegistry = new Map<string, ApiConnector>();

/**
 * Register an API connector in the global registry.
 *
 * Connectors should call this on module initialization:
 * ```typescript
 * // In bgg-connector.ts
 * registerConnector(new BggConnector());
 * ```
 *
 * @param connector - Connector instance to register
 * @throws Error if a connector with the same name is already registered
 */
export function registerConnector(connector: ApiConnector): void {
  if (connectorRegistry.has(connector.name)) {
    throw new Error(
      `Connector "${connector.name}" is already registered. ` +
        "Each connector name must be unique."
    );
  }
  connectorRegistry.set(connector.name, connector);
}

/**
 * Get a registered connector by name.
 *
 * @param name - Connector identifier (e.g., "bgg")
 * @returns The registered connector
 * @throws Error if no connector with that name is registered
 *
 * Usage:
 * ```typescript
 * const connector = getConnector(pipelineConfig.connector);
 * ```
 */
export function getConnector(name: string): ApiConnector {
  const connector = connectorRegistry.get(name);
  if (!connector) {
    const available = Array.from(connectorRegistry.keys()).join(", ");
    throw new Error(
      `Unknown connector "${name}". ` +
        (available ? `Available connectors: ${available}` : "No connectors registered.")
    );
  }
  return connector;
}

/**
 * Check if a connector is registered.
 *
 * @param name - Connector identifier to check
 * @returns true if the connector is registered
 */
export function hasConnector(name: string): boolean {
  return connectorRegistry.has(name);
}

/**
 * Get names of all registered connectors.
 * Useful for validation error messages and debugging.
 *
 * @returns Array of registered connector names
 */
export function getRegisteredConnectorNames(): string[] {
  return Array.from(connectorRegistry.keys());
}

/**
 * Clear all registered connectors.
 * Used primarily for testing to reset state between tests.
 */
export function clearConnectorRegistry(): void {
  connectorRegistry.clear();
}
