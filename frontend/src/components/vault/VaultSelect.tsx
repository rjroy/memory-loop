/**
 * Vault Selection Component
 *
 * Displays available vaults for the user to select.
 * Handles loading state, empty state, and vault selection.
 * Uses API to check for existing sessions before connecting.
 */

/* eslint-disable @typescript-eslint/no-floating-promises */
// REST API calls in async handlers

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import type { VaultInfo, ServerMessage, EditableVaultConfig } from "@memory-loop/shared";
import { useSession, STORAGE_KEY_VAULT } from "../../contexts/SessionContext";
import { useWebSocket } from "../../hooks/useWebSocket";
import { createApiClient, vaultPath } from "../../api/client.js";
import { Toast, type ToastVariant } from "../shared/Toast";
import { ConfigEditorDialog } from "./ConfigEditorDialog";
import { AddVaultDialog } from "./AddVaultDialog";
import { SettingsDialog } from "./SettingsDialog";
import { MemoryEditor } from "./MemoryEditor";
import { ExtractionPromptEditor } from "./ExtractionPromptEditor";
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
  // Config save state (TASK-010)
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaveError, setConfigSaveError] = useState<string | null>(null);

  // Add Vault dialog state
  const [addVaultDialogOpen, setAddVaultDialogOpen] = useState(false);
  const [addVaultCreating, setAddVaultCreating] = useState(false);
  const [addVaultError, setAddVaultError] = useState<string | null>(null);

  // Settings dialog state (TASK-010)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);

  // Dedicated message state for Settings dialog editors to avoid race conditions
  // (MemoryEditor now uses REST API, only ExtractionPromptEditor uses WebSocket)
  const [extractionPromptMessage, setExtractionPromptMessage] = useState<ServerMessage | null>(null);

  const { selectVault, vault: currentVault, setSlashCommands } = useSession();

  // API client for REST operations (setup, config)
  const api = useMemo(() => createApiClient(), []);

  // Route messages to appropriate handlers - onMessage fires for every message
  const handleWebSocketMessage = useCallback((message: ServerMessage) => {
    // Route extraction prompt messages to ExtractionPromptEditor
    if (
      message.type === "extraction_prompt_content" ||
      message.type === "extraction_prompt_saved" ||
      message.type === "extraction_prompt_reset" ||
      message.type === "extraction_status"
    ) {
      setExtractionPromptMessage(message);
    }
    // Error messages go to extraction prompt editor
    if (message.type === "error") {
      setExtractionPromptMessage(message);
    }
  }, []);

  const { sendMessage, lastMessage, connectionStatus } = useWebSocket({
    onMessage: handleWebSocketMessage,
  });

  // Track whether we've attempted auto-resume from localStorage
  const hasAttemptedAutoResumeRef = useRef(false);

  // Sort vaults by order (lower first), then alphabetically by name
  // This ensures consistent display even if backend doesn't pre-sort
  const sortedVaults = useMemo(() => {
    return [...vaults].sort((a, b) => {
      if (a.order !== b.order) {
        return a.order - b.order;
      }
      return a.name.localeCompare(b.name);
    });
  }, [vaults]);

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

  // Note: setup_complete message handling moved to REST API in handleSetupClick

  // Handle vault_created response
  useEffect(() => {
    if (lastMessage?.type === "vault_created" && addVaultCreating) {
      setAddVaultCreating(false);
      setAddVaultDialogOpen(false);
      setAddVaultError(null);

      // Add the new vault to the list
      const newVault = lastMessage.vault;
      setVaults((prev) => [...prev, newVault]);

      // Show success toast
      setToastVariant("success");
      setToastMessage(`Vault "${newVault.name}" created`);
      setToastVisible(true);

      console.log(`[VaultSelect] Vault created: ${newVault.id}`);
    }
  }, [lastMessage, addVaultCreating]);

  // Handle error during vault creation
  useEffect(() => {
    if (lastMessage?.type === "error" && addVaultCreating) {
      setAddVaultCreating(false);
      setAddVaultError(lastMessage.message);
      console.warn("[VaultSelect] Vault creation failed:", lastMessage.message);
    }
  }, [lastMessage, addVaultCreating]);

  // Note: config_updated message handling moved to REST API in handleConfigSave

  // Toast dismiss handler
  const handleToastDismiss = useCallback(() => {
    setToastVisible(false);
  }, []);

  // Handle setup button click - call REST API
  async function handleSetupClick(vault: VaultInfo) {
    setSetupVaultId(vault.id);
    setError(null);
    console.log(`[VaultSelect] Starting setup for vault: ${vault.id}`);

    try {
      interface SetupResponse {
        success: boolean;
        summary: Array<{ step: string; success: boolean; message?: string }>;
      }
      const result = await api.post<SetupResponse>(vaultPath(vault.id, "setup"));

      if (result.success) {
        // Update vault's setupComplete status in local state
        setVaults((prev) =>
          prev.map((v) =>
            v.id === vault.id ? { ...v, setupComplete: true } : v
          )
        );
        // Show success toast with summary
        const summaryText = result.summary
          .filter((s) => s.success)
          .map((s) => s.message ?? s.step)
          .join(", ") || "Setup complete";
        setToastVariant("success");
        setToastMessage(summaryText);
        setToastVisible(true);
        console.log(`[VaultSelect] Setup complete for vault: ${vault.id}`);
      } else {
        // Setup failed - show error toast
        const errorMessages = result.summary
          .filter((s) => !s.success)
          .map((s) => s.message ?? s.step)
          .join(", ") || "Setup failed";
        setToastVariant("error");
        setToastMessage(errorMessages);
        setToastVisible(true);
        console.warn(`[VaultSelect] Setup failed for vault: ${vault.id}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to setup vault";
      setToastVariant("error");
      setToastMessage(message);
      setToastVisible(true);
      console.warn(`[VaultSelect] Setup error for vault: ${vault.id}`, err);
    } finally {
      setSetupVaultId(null);
    }
  }

  // Handle gear button click - open config editor (TASK-008)
  function handleGearClick(vault: VaultInfo, e: React.MouseEvent) {
    e.stopPropagation(); // Prevent card selection
    setConfigEditorVault(vault);
    setConfigEditorOpen(true);
    setConfigSaveError(null); // Clear any previous error (TASK-010)
  }

  // Handle config editor save - call REST API (TASK-010)
  async function handleConfigSave(config: EditableVaultConfig) {
    if (!configEditorVault) return;

    setConfigSaving(true);
    setConfigSaveError(null);
    console.log(`[VaultSelect] Saving config for vault: ${configEditorVault.id}`, config);

    try {
      interface ConfigUpdateResponse {
        success: boolean;
      }
      await api.patch<ConfigUpdateResponse>(
        vaultPath(configEditorVault.id, "config"),
        config
      );

      const vaultId = configEditorVault.id;

      // Update local vault state with the saved config values
      setVaults((prev) =>
        prev.map((v) =>
          v.id === vaultId
            ? {
                ...v,
                // Map EditableVaultConfig fields to VaultInfo fields
                name: config.title ?? v.name,
                subtitle: config.subtitle ?? v.subtitle,
                discussionModel: config.discussionModel ?? v.discussionModel,
                promptsPerGeneration: config.promptsPerGeneration ?? v.promptsPerGeneration,
                maxPoolSize: config.maxPoolSize ?? v.maxPoolSize,
                quotesPerWeek: config.quotesPerWeek ?? v.quotesPerWeek,
                recentCaptures: config.recentCaptures ?? v.recentCaptures,
                recentDiscussions: config.recentDiscussions ?? v.recentDiscussions,
                badges: config.badges ?? v.badges,
                order: config.order ?? v.order,
                cardsEnabled: config.cardsEnabled ?? v.cardsEnabled,
              }
            : v
        )
      );

      // Show success toast
      setToastVariant("success");
      setToastMessage("Settings saved");
      setToastVisible(true);

      // Close dialog
      setConfigEditorOpen(false);
      setConfigEditorVault(null);
      console.log("[VaultSelect] Config saved successfully");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save settings";
      setConfigSaveError(message);
      console.warn("[VaultSelect] Config save failed:", message);
    } finally {
      setConfigSaving(false);
    }
  }

  // Handle config editor cancel
  function handleConfigCancel() {
    setConfigEditorOpen(false);
    setConfigEditorVault(null);
  }

  // Handle Add Vault button click - open dialog
  function handleAddVaultClick() {
    if (connectionStatus !== "connected") {
      setError("Not connected to server. Please wait...");
      return;
    }
    setAddVaultError(null);
    setAddVaultDialogOpen(true);
  }

  // Handle Add Vault dialog confirm - send create_vault message
  function handleAddVaultConfirm(title: string) {
    setAddVaultCreating(true);
    setAddVaultError(null);
    console.log(`[VaultSelect] Creating vault: ${title}`);
    sendMessage({ type: "create_vault", title });
  }

  // Handle Add Vault dialog cancel
  function handleAddVaultCancel() {
    if (!addVaultCreating) {
      setAddVaultDialogOpen(false);
      setAddVaultError(null);
    }
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
        <div className="vault-select__header-top">
          <h1>Select a Vault</h1>
          <button
            type="button"
            className="vault-select__header-settings-btn"
            onClick={() => setSettingsDialogOpen(true)}
            aria-label="Memory settings"
          >
            <svg
              width="20"
              height="20"
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
        {sortedVaults.map((vault) => (
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
                {vault.badges.map((badge, index) => (
                  <span
                    key={`${badge.text}-${index}`}
                    className={`vault-select__badge vault-select__badge--${badge.color}`}
                  >
                    {badge.text}
                  </span>
                ))}
                {vault.setupComplete && (
                  <span className="vault-select__badge vault-select__badge--setup">
                    Memory Loop
                  </span>
                )}
                {vault.hasClaudeMd && (
                  <span className="vault-select__badge vault-select__badge--claude">
                    CLAUDE.md
                  </span>
                )}
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
        {/* Add Vault card */}
        <li>
          <div
            className={`vault-select__card vault-select__card--add ${
              selectedVaultId !== null || addVaultCreating ? "vault-select__card--disabled" : ""
            }`}
            onClick={() => {
              if (selectedVaultId === null && !addVaultCreating) {
                handleAddVaultClick();
              }
            }}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && selectedVaultId === null && !addVaultCreating) {
                e.preventDefault();
                handleAddVaultClick();
              }
            }}
            role="option"
            tabIndex={selectedVaultId !== null || addVaultCreating ? -1 : 0}
            aria-selected={false}
            aria-disabled={selectedVaultId !== null || addVaultCreating}
          >
            <h2 className="vault-select__vault-name vault-select__vault-name--add">
              Add Vault
            </h2>
            <p className="vault-select__vault-subtitle">
              Create a new vault directory
            </p>
          </div>
        </li>
      </ul>

      {/* Config Editor Dialog (TASK-008, TASK-010) */}
      {configEditorVault && (
        <ConfigEditorDialog
          isOpen={configEditorOpen}
          initialConfig={{
            title: configEditorVault.name,
            subtitle: configEditorVault.subtitle,
            discussionModel: configEditorVault.discussionModel,
            promptsPerGeneration: configEditorVault.promptsPerGeneration,
            maxPoolSize: configEditorVault.maxPoolSize,
            quotesPerWeek: configEditorVault.quotesPerWeek,
            recentCaptures: configEditorVault.recentCaptures,
            recentDiscussions: configEditorVault.recentDiscussions,
            badges: configEditorVault.badges,
            order: configEditorVault.order === Infinity ? undefined : configEditorVault.order,
            cardsEnabled: configEditorVault.cardsEnabled,
          }}
          onSave={handleConfigSave}
          onCancel={handleConfigCancel}
          isSaving={configSaving}
          saveError={configSaveError}
        />
      )}

      <Toast
        isVisible={toastVisible}
        variant={toastVariant}
        message={toastMessage}
        onDismiss={handleToastDismiss}
      />

      {/* Add Vault Dialog */}
      <AddVaultDialog
        isOpen={addVaultDialogOpen}
        onConfirm={handleAddVaultConfirm}
        onCancel={handleAddVaultCancel}
        isCreating={addVaultCreating}
        createError={addVaultError}
      />

      {/* Settings Dialog (TASK-010, TASK-011, TASK-012) */}
      <SettingsDialog
        isOpen={settingsDialogOpen}
        onClose={() => setSettingsDialogOpen(false)}
        memoryEditorContent={<MemoryEditor />}
        promptEditorContent={
          <ExtractionPromptEditor
            sendMessage={sendMessage}
            lastMessage={extractionPromptMessage}
          />
        }
      />
    </div>
  );
}
