/**
 * Vault Selection Component
 *
 * Displays available vaults for the user to select.
 * Handles loading state, empty state, and vault selection.
 * Uses REST API for session initialization.
 */

/* eslint-disable @typescript-eslint/no-floating-promises */
// REST API calls in async handlers

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import type { VaultInfo, EditableVaultConfig, SlashCommand, ConversationMessage } from "@memory-loop/shared";
import { useSession, STORAGE_KEY_VAULT } from "../../contexts/SessionContext";
import { createApiClient, vaultPath } from "@/lib/api/client";
import { Toast, type ToastVariant } from "../shared/Toast";
import { ConfigEditorDialog } from "./ConfigEditorDialog";
import { AddVaultDialog } from "./AddVaultDialog";
import { SettingsDialog } from "./SettingsDialog";
import { MemoryEditor } from "./MemoryEditor";
import { ExtractionPromptEditor } from "./ExtractionPromptEditor";
import { CardGeneratorEditor } from "./CardGeneratorEditor";
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
 * Response from session initialization API.
 */
interface SessionInitResponse {
  sessionId: string;
  vaultId: string;
  messages: ConversationMessage[];
  createdAt?: string;
  slashCommands?: SlashCommand[];
  config?: {
    discussionModel?: string;
    viMode?: boolean;
  };
}

/**
 * Vault selection screen component.
 *
 * Fetches vaults from /api/vaults on mount and displays them as cards.
 * When a vault is selected:
 * 1. Calls POST /api/vaults/:vaultId/sessions
 * 2. Receives session data (messages if resuming, slash commands, config)
 * 3. Updates context and notifies parent
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

  const { selectVault, vault: currentVault, setSlashCommands, setSessionId, setMessages } = useSession();

  // API client for REST operations (setup, config)
  const api = useMemo(() => createApiClient(), []);

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

  // Initialize session via REST API
  const initializeSession = useCallback(async (vault: VaultInfo, sessionIdToResume?: string) => {
    console.log(`[VaultSelect] Initializing session for vault: ${vault.id}`);

    try {
      const response = await fetch(`/api/vaults/${vault.id}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: sessionIdToResume ? JSON.stringify({ sessionId: sessionIdToResume }) : undefined,
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string; message?: string };
        throw new Error(errorData.message ?? `HTTP ${response.status}`);
      }

      const data = await response.json() as SessionInitResponse;

      // Update session context
      selectVault(vault);
      if (data.sessionId) {
        setSessionId(data.sessionId);
      }
      if (data.messages && data.messages.length > 0) {
        setMessages(data.messages);
      }
      if (data.slashCommands) {
        setSlashCommands(data.slashCommands);
      }

      setSelectedVaultId(null);
      onReady?.();

      console.log(`[VaultSelect] Session initialized: ${data.sessionId || "(new)"}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to initialize session";
      setError(message);
      setSelectedVaultId(null);
      console.error("[VaultSelect] Session initialization failed:", err);
    }
  }, [selectVault, setSessionId, setMessages, setSlashCommands, onReady]);

  // Auto-resume session from localStorage on page refresh
  useEffect(() => {
    // Only attempt once per component mount
    if (hasAttemptedAutoResumeRef.current) return;

    // Wait until vaults are loaded
    if (loadingState !== "loaded" || vaults.length === 0) return;

    // Check for persisted vault ID
    const persistedVaultId = localStorage.getItem(STORAGE_KEY_VAULT);
    if (!persistedVaultId) return;

    // Find the vault in the list
    const vault = vaults.find((v) => v.id === persistedVaultId);
    if (!vault) return;

    // Mark as attempted and trigger auto-resume
    hasAttemptedAutoResumeRef.current = true;
    console.log(`[VaultSelect] Auto-resuming vault: ${vault.id}`);

    setSelectedVaultId(vault.id);
    void initializeSession(vault);
  }, [loadingState, vaults, initializeSession]);

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
                viMode: config.viMode ?? v.viMode,
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
    setAddVaultError(null);
    setAddVaultDialogOpen(true);
  }

  // Handle Add Vault dialog confirm - use REST API
  async function handleAddVaultConfirm(title: string) {
    setAddVaultCreating(true);
    setAddVaultError(null);
    console.log(`[VaultSelect] Creating vault: ${title}`);

    try {
      interface CreateVaultResponse {
        vault: VaultInfo;
      }
      const result = await api.post<CreateVaultResponse>("/api/vaults", { title });
      const newVault = result.vault;

      // Add the new vault to the list
      setVaults((prev) => [...prev, newVault]);

      // Show success toast
      setToastVariant("success");
      setToastMessage(`Vault "${newVault.name}" created`);
      setToastVisible(true);

      // Close dialog
      setAddVaultDialogOpen(false);

      console.log(`[VaultSelect] Vault created: ${newVault.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create vault";
      setAddVaultError(message);
      console.warn("[VaultSelect] Vault creation failed:", message);
    } finally {
      setAddVaultCreating(false);
    }
  }

  // Handle Add Vault dialog cancel
  function handleAddVaultCancel() {
    if (!addVaultCreating) {
      setAddVaultDialogOpen(false);
      setAddVaultError(null);
    }
  }

  // Handle vault card click - initialize session via REST API
  async function handleVaultClick(vault: VaultInfo) {
    if (selectedVaultId !== null) {
      // Already selecting a vault, ignore
      return;
    }

    setSelectedVaultId(vault.id);
    setError(null);

    await initializeSession(vault);
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
            viMode: configEditorVault.viMode,
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
        onConfirm={(title) => void handleAddVaultConfirm(title)}
        onCancel={handleAddVaultCancel}
        isCreating={addVaultCreating}
        createError={addVaultError}
      />

      {/* Settings Dialog (TASK-010, TASK-011, TASK-012) - now using REST-based editors */}
      <SettingsDialog
        isOpen={settingsDialogOpen}
        onClose={() => setSettingsDialogOpen(false)}
        memoryEditorContent={<MemoryEditor />}
        promptEditorContent={<ExtractionPromptEditor />}
        cardGeneratorContent={<CardGeneratorEditor />}
      />
    </div>
  );
}
