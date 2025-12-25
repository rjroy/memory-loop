/**
 * Vault Selection Component
 *
 * Displays available vaults for the user to select.
 * Handles loading state, empty state, and vault selection.
 */

import { useEffect, useState, useRef } from "react";
import type { VaultInfo } from "@memory-loop/shared";
import {
  useSession,
  loadVaultSession,
  clearVaultSession,
} from "../contexts/SessionContext";
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
 * When a vault is selected, sends select_vault message via WebSocket
 * and calls onReady when session_ready is received.
 */
export function VaultSelect({ onReady }: VaultSelectProps): React.ReactNode {
  const [vaults, setVaults] = useState<VaultInfo[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [selectedVaultId, setSelectedVaultId] = useState<string | null>(null);
  // Track whether we're waiting for resume_session response
  const [awaitingResume, setAwaitingResume] = useState(false);
  // Track if we already attempted resume for this vault selection
  const resumeAttemptedRef = useRef(false);

  const { selectVault, setSessionId, restoreSession, vault: currentVault } = useSession();
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
  useEffect(() => {
    if (lastMessage?.type === "session_ready" && selectedVaultId) {
      const vault = vaults.find((v) => v.id === selectedVaultId);
      if (!vault) return;

      if (lastMessage.sessionId) {
        // Response to resume_session - session was loaded
        // IMPORTANT: selectVault must come FIRST because it clears messages
        // Then restore session with persisted messages
        selectVault(vault);
        const persisted = loadVaultSession(selectedVaultId);
        if (persisted?.messages) {
          restoreSession(lastMessage.sessionId, persisted.messages);
        } else {
          // No persisted messages, just set the session ID
          setSessionId(lastMessage.sessionId);
        }
        setSelectedVaultId(null);
        setAwaitingResume(false);
        resumeAttemptedRef.current = false;
        onReady?.();
      } else if (!resumeAttemptedRef.current) {
        // Response to select_vault (empty sessionId)
        // Check for persisted session to resume
        const persisted = loadVaultSession(selectedVaultId);
        if (persisted?.sessionId) {
          // Try to resume the persisted session
          resumeAttemptedRef.current = true;
          setAwaitingResume(true);
          sendMessage({ type: "resume_session", sessionId: persisted.sessionId });
        } else {
          // No session to resume, proceed as new session
          selectVault(vault);
          setSelectedVaultId(null);
          onReady?.();
        }
      } else {
        // Resume was attempted but returned empty sessionId (shouldn't happen normally)
        // Proceed as new session
        selectVault(vault);
        setSelectedVaultId(null);
        setAwaitingResume(false);
        resumeAttemptedRef.current = false;
        onReady?.();
      }
    }
  }, [lastMessage, selectedVaultId, vaults, selectVault, setSessionId, restoreSession, sendMessage, onReady]);

  // Handle errors during resume
  useEffect(() => {
    if (lastMessage?.type === "error" && awaitingResume && selectedVaultId) {
      // Resume failed - clear invalid session and proceed as new
      clearVaultSession(selectedVaultId);
      setAwaitingResume(false);
      resumeAttemptedRef.current = false;

      // Re-send select_vault to get a fresh session
      sendMessage({ type: "select_vault", vaultId: selectedVaultId });
    }
  }, [lastMessage, awaitingResume, selectedVaultId, sendMessage]);

  // Handle vault card click
  function handleVaultClick(vault: VaultInfo) {
    if (connectionStatus !== "connected") {
      setError("Not connected to server. Please wait...");
      return;
    }

    setSelectedVaultId(vault.id);
    sendMessage({ type: "select_vault", vaultId: vault.id });
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
              onClick={() => handleVaultClick(vault)}
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
