/**
 * Vault Selection Component
 *
 * Displays available vaults for the user to select.
 * Handles loading state, empty state, and vault selection.
 * Uses API to check for existing sessions before connecting.
 */

import { useEffect, useState } from "react";
import type { VaultInfo } from "@memory-loop/shared";
import { useSession } from "../contexts/SessionContext";
import { useWebSocket } from "../hooks/useWebSocket";
import "./VaultSelect.css";

/**
 * Props for VaultSelect component.
 */
export interface VaultSelectProps {
  /** Callback when a vault is selected and session is ready */
  onReady?: () => void;
}

/**
 * Component state for vault loading.
 */
type LoadingState = "loading" | "loaded" | "error";

/**
 * Vault selection screen component.
 *
 * Fetches vaults from /api/vaults on mount and displays them as cards.
 * When a vault is selected:
 * 1. Checks /api/sessions/:vaultId for existing session
 * 2. Sends resume_session or select_vault accordingly
 * 3. Server sends session_ready with messages if resuming
 */
export function VaultSelect({ onReady }: VaultSelectProps): React.ReactNode {
  const [vaults, setVaults] = useState<VaultInfo[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedVaultId, setSelectedVaultId] = useState<string | null>(null);

  const { selectVault, vault: currentVault } = useSession();
  const { sendMessage, lastMessage, connectionStatus } = useWebSocket();

  // Fetch vaults on mount
  useEffect(() => {
    async function fetchVaults() {
      try {
        const response = await fetch("/api/vaults");
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = (await response.json()) as { vaults: VaultInfo[] };
        setVaults(data.vaults);
        setLoadingState("loaded");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load vaults";
        setError(message);
        setLoadingState("error");
      }
    }

    void fetchVaults();
  }, []);

  // Handle vault selection from WebSocket vault_list message
  useEffect(() => {
    if (lastMessage?.type === "vault_list") {
      // Server sent vault list on connection open - use it if we don't have vaults yet
      if (vaults.length === 0 && lastMessage.vaults.length > 0) {
        setVaults(lastMessage.vaults);
        setLoadingState("loaded");
      }
    }
  }, [lastMessage, vaults.length]);

  // Handle session ready message
  // Note: useServerMessageHandler handles sessionId and messages from session_ready
  useEffect(() => {
    if (lastMessage?.type === "session_ready" && selectedVaultId) {
      const vault = vaults.find((v) => v.id === selectedVaultId);
      if (!vault) return;

      // Session is ready - update context and notify parent
      selectVault(vault);
      setSelectedVaultId(null);
      onReady?.();
    }
  }, [lastMessage, selectedVaultId, vaults, selectVault, onReady]);

  // Handle errors during vault selection
  useEffect(() => {
    if (lastMessage?.type === "error" && selectedVaultId) {
      // If resume failed (SESSION_NOT_FOUND), start fresh
      if (lastMessage.code === "SESSION_NOT_FOUND") {
        // Send select_vault to start a new session
        sendMessage({ type: "select_vault", vaultId: selectedVaultId });
      } else {
        // Other error - show to user
        setError(lastMessage.message);
        setSelectedVaultId(null);
      }
    }
  }, [lastMessage, selectedVaultId, sendMessage]);

  // Handle vault card click - check for existing session via API
  async function handleVaultClick(vault: VaultInfo) {
    if (connectionStatus !== "connected") {
      setError("Not connected to server. Please wait...");
      return;
    }

    setSelectedVaultId(vault.id);
    setError(null);

    try {
      // Check if server has an existing session for this vault
      const response = await fetch(`/api/sessions/${vault.id}`);
      if (!response.ok) {
        // Non-2xx status - fall back to starting a new session
        console.warn(`[VaultSelect] Session check failed with status ${response.status}, starting fresh`);
        sendMessage({ type: "select_vault", vaultId: vault.id });
        return;
      }
      const data = (await response.json()) as { sessionId: string | null };

      if (data.sessionId) {
        // Resume existing session - server will send messages
        console.log(`[VaultSelect] Resuming session: ${data.sessionId.slice(0, 8)}...`);
        sendMessage({ type: "resume_session", sessionId: data.sessionId });
      } else {
        // No existing session - start new
        console.log(`[VaultSelect] Starting new session for vault: ${vault.id}`);
        sendMessage({ type: "select_vault", vaultId: vault.id });
      }
    } catch (err) {
      // API error - fall back to select_vault
      console.warn("[VaultSelect] Failed to check session, starting fresh:", err);
      sendMessage({ type: "select_vault", vaultId: vault.id });
    }
  }

  // Render loading state
  if (loadingState === "loading") {
    return (
      <div className="vault-select">
        <div className="vault-select__loading">
          <div className="vault-select__spinner" aria-label="Loading vaults" />
          <p>Loading vaults...</p>
        </div>
      </div>
    );
  }

  // Render error state
  if (loadingState === "error") {
    return (
      <div className="vault-select">
        <div className="vault-select__error">
          <h2>Failed to Load Vaults</h2>
          <p>{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="vault-select__retry-btn"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Render empty state
  if (vaults.length === 0) {
    return (
      <div className="vault-select">
        <div className="vault-select__empty">
          <h2>No Vaults Configured</h2>
          <p>
            Memory Loop needs to know where your Obsidian vaults are located.
          </p>
          <div className="vault-select__instructions">
            <h3>Setup Instructions</h3>
            <ol>
              <li>
                Set the <code>VAULTS_DIR</code> environment variable to the
                directory containing your Obsidian vaults
              </li>
              <li>
                Each vault should contain a <code>.obsidian</code> folder
              </li>
              <li>Restart the server after configuration</li>
            </ol>
            <p className="vault-select__example">
              Example: <code>VAULTS_DIR=~/Documents/Obsidian</code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Render vault list
  return (
    <div className="vault-select">
      <header className="vault-select__header">
        <h1>Select a Vault</h1>
        <p className="vault-select__connection-status">
          {connectionStatus === "connected" ? (
            <span className="vault-select__status vault-select__status--connected">
              Connected
            </span>
          ) : connectionStatus === "connecting" ? (
            <span className="vault-select__status vault-select__status--connecting">
              Connecting...
            </span>
          ) : (
            <span className="vault-select__status vault-select__status--disconnected">
              Disconnected
            </span>
          )}
        </p>
      </header>

      {error && (
        <div className="vault-select__error-banner" role="alert">
          {error}
        </div>
      )}

      <ul className="vault-select__list" role="listbox" aria-label="Available vaults">
        {vaults.map((vault) => (
          <li key={vault.id}>
            <button
              type="button"
              className={`vault-select__card ${
                selectedVaultId === vault.id ? "vault-select__card--loading" : ""
              } ${currentVault?.id === vault.id ? "vault-select__card--selected" : ""}`}
              onClick={() => void handleVaultClick(vault)}
              disabled={selectedVaultId !== null}
              role="option"
              aria-selected={currentVault?.id === vault.id}
            >
              <h2 className="vault-select__vault-name">{vault.name}</h2>
              <p className="vault-select__vault-path">{vault.path}</p>
              <div className="vault-select__vault-badges">
                {vault.hasClaudeMd && (
                  <span className="vault-select__badge vault-select__badge--claude">
                    CLAUDE.md
                  </span>
                )}
              </div>
              {selectedVaultId === vault.id && (
                <div className="vault-select__card-spinner" aria-label="Connecting" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
