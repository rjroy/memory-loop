/**
 * Memory Loop - Main App Component
 *
 * Root component for the Memory Loop application.
 * Provides the app shell with:
 * - Vault selection screen
 * - Note capture mode
 * - Discussion mode
 * - Browse mode (file browser and markdown viewer)
 * - Session management
 */

import React, { useState, useEffect, useRef } from "react";
import { SessionProvider, useSession } from "./contexts/SessionContext";
import { VaultSelect } from "./components/VaultSelect";
import { ModeToggle } from "./components/ModeToggle";
import { HomeView } from "./components/HomeView";
import { NoteCapture } from "./components/NoteCapture";
import { Discussion } from "./components/Discussion";
import { BrowseMode } from "./components/BrowseMode";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ConfigEditorDialog, type EditableVaultConfig } from "./components/ConfigEditorDialog";
import { Toast, type ToastVariant } from "./components/Toast";
import { useHoliday } from "./hooks/useHoliday";
import { useWebSocket } from "./hooks/useWebSocket";
import "./App.css";

/**
 * Dialog types for confirmation.
 */
type DialogType = "changeVault" | null;

/**
 * Main app content when a vault is selected.
 */
function MainContent(): React.ReactNode {
  const { mode, vault, clearVault } = useSession();
  const { sendMessage, lastMessage } = useWebSocket();
  const [activeDialog, setActiveDialog] = useState<DialogType>(null);
  const [configEditorOpen, setConfigEditorOpen] = useState(false);
  // Config save state (TASK-010)
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaveError, setConfigSaveError] = useState<string | null>(null);
  const pendingConfigRef = useRef<EditableVaultConfig | null>(null);
  // Toast state for success feedback (TASK-010)
  const [toastVisible, setToastVisible] = useState(false);
  const [toastVariant, setToastVariant] = useState<ToastVariant>("success");
  const [toastMessage, setToastMessage] = useState("");
  const holiday = useHoliday();

  // Use holiday-specific logo if available
  const logoSrc = holiday ? `/images/holiday/${holiday}-logo.webp` : "/images/logo.webp";

  function handleChangeVault() {
    setActiveDialog("changeVault");
  }

  function handleConfirmChangeVault() {
    clearVault();
    setActiveDialog(null);
  }

  function handleCancelDialog() {
    setActiveDialog(null);
  }

  function handleGearClick() {
    setConfigEditorOpen(true);
    setConfigSaveError(null); // Clear any previous error (TASK-010)
  }

  // Handle config editor save - send update_vault_config via WebSocket (TASK-010)
  function handleConfigSave(config: EditableVaultConfig) {
    if (!vault) return;

    setConfigSaving(true);
    setConfigSaveError(null);
    pendingConfigRef.current = config; // Store for local state update on success
    console.log(`[App] Saving config for vault: ${vault.id}`, config);
    sendMessage({ type: "update_vault_config", config, vaultId: vault.id });
  }

  function handleConfigCancel() {
    setConfigEditorOpen(false);
  }

  // Handle config_updated response (TASK-010)
  useEffect(() => {
    if (lastMessage?.type === "config_updated" && configSaving) {
      setConfigSaving(false);

      if (lastMessage.success) {
        // Note: We don't update vault state in context here because
        // SessionContext doesn't expose a setVault action. The config
        // is persisted to the backend and will be loaded on next session.
        // VaultSelect does update local vault state because it maintains
        // its own vaults array.

        // Clear pending config
        pendingConfigRef.current = null;

        // Show success toast
        setToastVariant("success");
        setToastMessage("Settings saved");
        setToastVisible(true);

        // Close dialog
        setConfigEditorOpen(false);
        console.log("[App] Config saved successfully");
      } else {
        // Show error in dialog
        setConfigSaveError(lastMessage.error ?? "Failed to save settings");
        console.warn("[App] Config save failed:", lastMessage.error);
      }
    }
  }, [lastMessage, configSaving]);

  // Toast dismiss handler
  function handleToastDismiss() {
    setToastVisible(false);
  }

  return (
    <>
      <header className="app-header">
        <div className="app-header__left">
          <div className="app-title-row">
            <img src={logoSrc} alt="" className="app-logo" aria-hidden="true" />
            <h1 className="app-title">Memory Loop</h1>
          </div>
          {vault && (
            <div className="app-vault-row">
              <button
                type="button"
                className="app-vault-btn"
                onClick={handleChangeVault}
                aria-label="Change vault"
              >
                {vault.name}
              </button>
              <button
                type="button"
                className="app-gear-btn"
                onClick={handleGearClick}
                aria-label="Vault settings"
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
          )}
        </div>
        <div className="app-header__center">
          <ModeToggle />
        </div>
        <div className="app-header__right">
          <span className="app-version">{__APP_VERSION__}</span>
        </div>
      </header>

      <main className="app-main">
        {mode === "home" && <HomeView />}
        {mode === "note" && <NoteCapture />}
        {mode === "discussion" && <Discussion />}
        {mode === "browse" && <BrowseMode />}
      </main>

      {vault && (
        <ConfigEditorDialog
          isOpen={configEditorOpen}
          initialConfig={{
            title: vault.name,
            subtitle: vault.subtitle,
            discussionModel: vault.discussionModel,
            promptsPerGeneration: vault.promptsPerGeneration,
            maxPoolSize: vault.maxPoolSize,
            quotesPerWeek: vault.quotesPerWeek,
            recentCaptures: vault.recentCaptures,
            recentDiscussions: vault.recentDiscussions,
            badges: vault.badges,
            order: vault.order === Infinity ? undefined : vault.order,
          }}
          onSave={handleConfigSave}
          onCancel={handleConfigCancel}
          isSaving={configSaving}
          saveError={configSaveError}
        />
      )}

      {/* Toast for config save success (TASK-010) */}
      <Toast
        isVisible={toastVisible}
        variant={toastVariant}
        message={toastMessage}
        onDismiss={handleToastDismiss}
      />

      <ConfirmDialog
        isOpen={activeDialog === "changeVault"}
        title="Change Vault?"
        message="This will return to vault selection. Your current session will be preserved and can be resumed later."
        confirmLabel="Change"
        onConfirm={handleConfirmChangeVault}
        onCancel={handleCancelDialog}
      />
    </>
  );
}

/**
 * App shell with conditional rendering.
 */
function AppShell(): React.ReactNode {
  const { vault } = useSession();
  const [isReady, setIsReady] = useState(false);
  const holiday = useHoliday();

  // Set holiday attribute on <html> so it covers portaled dialogs
  React.useEffect(() => {
    if (holiday) {
      document.documentElement.setAttribute("data-holiday", holiday);
    } else {
      document.documentElement.removeAttribute("data-holiday");
    }
    return () => {
      document.documentElement.removeAttribute("data-holiday");
    };
  }, [holiday]);

  // Reset isReady when vault is cleared
  React.useEffect(() => {
    if (!vault) {
      setIsReady(false);
    }
  }, [vault]);

  // Show vault selection until a vault is selected and session is ready
  if (!vault || !isReady) {
    return (
      <div className="app">
        <VaultSelect onReady={() => setIsReady(true)} />
      </div>
    );
  }

  return (
    <div className="app">
      <MainContent />
    </div>
  );
}

/**
 * Root App component with providers.
 */
export function App(): React.ReactNode {
  return (
    <SessionProvider>
      <AppShell />
    </SessionProvider>
  );
}
