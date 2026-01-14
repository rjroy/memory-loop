/**
 * Vault Selection Component
 *
 * Displays available vaults for the user to select.
 * Handles loading state, empty state, and vault selection.
 * Uses API to check for existing sessions before connecting.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import type { VaultInfo } from "@memory-loop/shared";
import { useSession, STORAGE_KEY_VAULT } from "../contexts/SessionContext";
import { useWebSocket } from "../hooks/useWebSocket";
import { Toast, type ToastVariant } from "./Toast";
import { ConfigEditorDialog, type EditableVaultConfig } from "./ConfigEditorDialog";
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
  // Track which vault is being set up (TASK-008)
  const [setupVaultId, setSetupVaultId] = useState<string | null>(null);
  // Toast notification state (TASK-010)
  const [toastVisible, setToastVisible] = useState(false);
  const [toastVariant, setToastVariant] = useState<ToastVariant>("success");
  const [toastMessage, setToastMessage] = useState("");

  // Config editor dialog state (TASK-008)
  const [configEditorOpen, setConfigEditorOpen] = useState(false);
  const [configEditorVault, setConfigEditorVault] = useState<VaultInfo | null>(null);

  const { selectVault, vault: currentVault, setSlashCommands } = useSession();
  const { sendMessage, lastMessage, connectionStatus } = useWebSocket();

  // Track whether we've attempted auto-resume from localStorage
  const hasAttemptedAutoResumeRef = useRef(false);
  // Track the last processed setup_complete vaultId to prevent re-processing
  const lastProcessedSetupVaultIdRef = useRef<string | null>(null);

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

  // Auto-resume session from localStorage on page refresh
  useEffect(() => {
    // Only attempt once per component mount
    if (hasAttemptedAutoResumeRef.current) return;

    // Wait until vaults are loaded and connection is ready
    if (loadingState !== "loaded" || vaults.length === 0) return;
    if (connectionStatus !== "connected") return;

    // Check for persisted vault ID
    const persistedVaultId = localStorage.getItem(STORAGE_KEY_VAULT);
    if (!persistedVaultId) return;

    // Find the vault in the list
    const vault = vaults.find((v) => v.id === persistedVaultId);
    if (!vault) return;

    // Mark as attempted and trigger auto-resume
    hasAttemptedAutoResumeRef.current = true;
    console.log(`[VaultSelect] Auto-resuming vault: ${vault.id}`);

    // Trigger the same flow as handleVaultClick
    setSelectedVaultId(vault.id);

    // Check for existing session and resume/create
    void (async () => {
      try {
        const response = await fetch(`/api/sessions/${vault.id}`);
        if (!response.ok) {
          console.warn(`[VaultSelect] Session check failed with status ${response.status}, starting fresh`);
          sendMessage({ type: "select_vault", vaultId: vault.id });
          return;
        }
        const data = (await response.json()) as { sessionId: string | null };

        if (data.sessionId) {
          console.log(`[VaultSelect] Auto-resuming session: ${data.sessionId.slice(0, 8)}...`);
          sendMessage({ type: "resume_session", sessionId: data.sessionId });
        } else {
          console.log(`[VaultSelect] Starting new session for auto-resumed vault: ${vault.id}`);
          sendMessage({ type: "select_vault", vaultId: vault.id });
        }
      } catch (err) {
        console.warn("[VaultSelect] Failed to check session during auto-resume:", err);
        sendMessage({ type: "select_vault", vaultId: vault.id });
      }
    })();
  }, [loadingState, vaults.length, connectionStatus, sendMessage]);

  // Handle session ready message
  // Note: useServerMessageHandler handles sessionId and messages from session_ready
  useEffect(() => {
    if (lastMessage?.type === "session_ready" && selectedVaultId) {
      const vault = vaults.find((v) => v.id === selectedVaultId);
      if (!vault) return;

      // Session is ready - update context and notify parent
      selectVault(vault);
      // Set slash commands from the session_ready message (after selectVault clears them)
      if (lastMessage.slashCommands) {
        setSlashCommands(lastMessage.slashCommands);
      }
      setSelectedVaultId(null);
      onReady?.();
    }
  }, [lastMessage, selectedVaultId, vaults, selectVault, setSlashCommands, onReady]);

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

  // Handle setup_complete message (TASK-008, TASK-010)
  // Note: We don't depend on setupVaultId for matching because the server response
  // may arrive before React finishes processing setSetupVaultId (race condition).
  // Instead, we use the vaultId from the message and verify the vault exists.
  useEffect(() => {
    if (lastMessage?.type === "setup_complete") {
      const { vaultId, success, summary, errors } = lastMessage;

      // Prevent re-processing the same setup_complete message
      // This can happen because setVaults() triggers a re-render with the same lastMessage
      if (lastProcessedSetupVaultIdRef.current === vaultId) {
        return;
      }

      // Verify this vault exists in our list (guards against stale messages)
      const vault = vaults.find((v) => v.id === vaultId);
      if (!vault) {
        console.warn(`[VaultSelect] Received setup_complete for unknown vault: ${vaultId}`);
        return;
      }

      // Mark this message as processed before any state updates
      lastProcessedSetupVaultIdRef.current = vaultId;

      // Update vault's setupComplete status in local state
      if (success) {
        setVaults((prev) =>
          prev.map((v) =>
            v.id === vaultId ? { ...v, setupComplete: true } : v
          )
        );
        // Show success toast with summary
        const summaryText = summary?.join(", ") ?? "Setup complete";
        setToastVariant("success");
        setToastMessage(summaryText);
        setToastVisible(true);
        console.log(`[VaultSelect] Setup complete for vault: ${vaultId}`);
      } else {
        // Setup failed - show error toast
        const errorMessages = errors?.join(", ") ?? "Setup failed";
        setToastVariant("error");
        setToastMessage(errorMessages);
        setToastVisible(true);
        console.warn(`[VaultSelect] Setup failed for vault: ${vaultId}`, errors);
      }

      // Clear setup state (if it was set)
      setSetupVaultId(null);
    }
  }, [lastMessage, vaults]);

  // Toast dismiss handler
  const handleToastDismiss = useCallback(() => {
    setToastVisible(false);
  }, []);

  // Handle setup button click - send setup_vault message
  function handleSetupClick(vault: VaultInfo) {
    if (connectionStatus !== "connected") {
      setError("Not connected to server. Please wait...");
      return;
    }

    setSetupVaultId(vault.id);
    setError(null);
    // Reset the processed ref so this vault's setup_complete will be processed
    lastProcessedSetupVaultIdRef.current = null;
    console.log(`[VaultSelect] Starting setup for vault: ${vault.id}`);
    sendMessage({ type: "setup_vault", vaultId: vault.id });
  }

  // Handle gear button click - open config editor (TASK-008)
  function handleGearClick(vault: VaultInfo, e: React.MouseEvent) {
    e.stopPropagation(); // Prevent card selection
    setConfigEditorVault(vault);
    setConfigEditorOpen(true);
  }

  // Handle config editor save (TASK-010 will add WebSocket integration)
  function handleConfigSave(config: EditableVaultConfig) {
    // TODO: TASK-010 will implement WebSocket save
    console.log("Config save:", config);
    setConfigEditorOpen(false);
    setConfigEditorVault(null);
  }

  // Handle config editor cancel
  function handleConfigCancel() {
    setConfigEditorOpen(false);
    setConfigEditorVault(null);
  }

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
            <div
              className={`vault-select__card ${
                selectedVaultId === vault.id ? "vault-select__card--loading" : ""
              } ${currentVault?.id === vault.id ? "vault-select__card--selected" : ""} ${
                selectedVaultId !== null ? "vault-select__card--disabled" : ""
              }`}
              onClick={() => {
                if (selectedVaultId === null) void handleVaultClick(vault);
              }}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && selectedVaultId === null) {
                  e.preventDefault();
                  void handleVaultClick(vault);
                }
              }}
              role="option"
              tabIndex={selectedVaultId !== null ? -1 : 0}
              aria-selected={currentVault?.id === vault.id}
              aria-disabled={selectedVaultId !== null}
            >
              <h2 className="vault-select__vault-name">{vault.name}</h2>
              {vault.subtitle && (
                <p className="vault-select__vault-subtitle">{vault.subtitle}</p>
              )}
              <p className="vault-select__vault-path">{vault.path}</p>
              <div className="vault-select__vault-badges">
                {vault.hasClaudeMd && (
                  <span className="vault-select__badge vault-select__badge--claude">
                    CLAUDE.md
                  </span>
                )}
                {vault.setupComplete && (
                  <span className="vault-select__badge vault-select__badge--setup">
                    Memory Loop
                  </span>
                )}
                {vault.badges.map((badge, index) => (
                  <span
                    key={`${badge.text}-${index}`}
                    className={`vault-select__badge vault-select__badge--${badge.color}`}
                  >
                    {badge.text}
                  </span>
                ))}
              </div>
              {/* Card actions row with setup and gear buttons */}
              <div className="vault-select__card-actions">
                {vault.hasClaudeMd && (
                  <button
                    type="button"
                    className={`vault-select__setup-btn ${
                      setupVaultId === vault.id ? "vault-select__setup-btn--loading" : ""
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSetupClick(vault);
                    }}
                    disabled={selectedVaultId !== null || setupVaultId !== null}
                    aria-label={vault.setupComplete ? `Reconfigure ${vault.name}` : `Setup ${vault.name}`}
                  >
                    {vault.setupComplete ? "Reconfigure" : "Setup"}
                  </button>
                )}
                {/* Config Editor Gear Button (TASK-008) */}
                <button
                  type="button"
                  className="vault-select__gear-btn"
                  onClick={(e) => handleGearClick(vault, e)}
                  disabled={selectedVaultId !== null || setupVaultId !== null}
                  aria-label={`Configure ${vault.name} settings`}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </button>
              </div>
              {selectedVaultId === vault.id && (
                <div className="vault-select__card-spinner" aria-label="Connecting" />
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Config Editor Dialog (TASK-008) */}
      {configEditorVault && (
        <ConfigEditorDialog
          isOpen={configEditorOpen}
          initialConfig={{
            title: configEditorVault.name,
            subtitle: configEditorVault.subtitle,
            promptsPerGeneration: configEditorVault.promptsPerGeneration,
            maxPoolSize: configEditorVault.maxPoolSize,
            quotesPerWeek: configEditorVault.quotesPerWeek,
            badges: configEditorVault.badges,
            // Note: discussionModel, recentCaptures, recentDiscussions not in VaultInfo
            // They will use defaults in ConfigEditorDialog
          }}
          onSave={handleConfigSave}
          onCancel={handleConfigCancel}
        />
      )}

      <Toast
        isVisible={toastVisible}
        variant={toastVariant}
        message={toastMessage}
        onDismiss={handleToastDismiss}
      />
    </div>
  );
}
