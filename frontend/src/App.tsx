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

import React, { useState, useEffect, useRef, useCallback } from "react";
import { SessionProvider, useSession, useServerMessageHandler } from "./contexts/SessionContext";
import { VaultSelect } from "./components/vault";
import { ModeToggle, ConfirmDialog, Toast, type ToastVariant } from "./components/shared";
import { HomeView } from "./components/home";
import { NoteCapture } from "./components/capture";
import { Discussion } from "./components/discussion";
import { BrowseMode } from "./components/browse";
import { ConfigEditorDialog, type EditableVaultConfig } from "./components/vault";
import { useHoliday } from "./hooks/useHoliday";
import { useWebSocket } from "./hooks/useWebSocket";
import { useMeetings } from "./hooks/useMeetings";
import { useConfig } from "./hooks/useConfig";
import "./App.css";

/**
 * Dialog types for confirmation.
 */
type DialogType = "changeVault" | null;

/**
 * Main app content when a vault is selected.
 */
function MainContent(): React.ReactNode {
  const { mode, vault, clearVault, setMeetingState, updateVaultConfig } = useSession();
  const handleServerMessage = useServerMessageHandler();
  const [activeDialog, setActiveDialog] = useState<DialogType>(null);
  const [configEditorOpen, setConfigEditorOpen] = useState(false);
  // Toast state for success feedback (TASK-010)
  const [toastVisible, setToastVisible] = useState(false);
  const [toastVariant, setToastVariant] = useState<ToastVariant>("success");
  const [toastMessage, setToastMessage] = useState("");
  const holiday = useHoliday();
  // Mobile header collapse state
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(true);
  // Session restoration tracking (for page refresh and WebSocket reconnection)
  const hasRequestedMeetingStateRef = useRef(false);
  const hasSentVaultSelectionRef = useRef(false);

  // REST API hooks for meeting and config operations (migrated from WebSocket)
  const { getMeetingState } = useMeetings(vault?.id);
  const { updateConfig, isLoading: configSaving, error: configError } = useConfig(vault?.id);

  // Re-establish vault context on WebSocket reconnection.
  // After reconnect, the server has a fresh connection state and needs to know
  // which vault we're using.
  const handleReconnect = useCallback(() => {
    hasSentVaultSelectionRef.current = false;
    hasRequestedMeetingStateRef.current = false;
  }, []);

  const { sendMessage, lastMessage, connectionStatus } = useWebSocket({
    onReconnect: handleReconnect,
  });

  // Process server messages through the session handler
  useEffect(() => {
    if (lastMessage) {
      handleServerMessage(lastMessage);
    }
  }, [lastMessage, handleServerMessage]);

  // Re-send vault selection on WebSocket reconnect (server needs vault context)
  useEffect(() => {
    if (
      connectionStatus === "connected" &&
      vault &&
      !hasSentVaultSelectionRef.current
    ) {
      sendMessage({ type: "select_vault", vaultId: vault.id });
      hasSentVaultSelectionRef.current = true;
    }
  }, [connectionStatus, vault, sendMessage]);

  // Request meeting state after vault selection to restore any active meeting.
  // This runs on initial mount (page refresh) and after WebSocket reconnection.
  // Uses REST API (migrated from WebSocket). Fixes #377 where refreshing with
  // an active meeting orphaned it.
  useEffect(() => {
    if (
      connectionStatus === "connected" &&
      vault &&
      hasSentVaultSelectionRef.current &&
      !hasRequestedMeetingStateRef.current
    ) {
      hasRequestedMeetingStateRef.current = true;
      // Use REST API to get meeting state
      void getMeetingState().then((state) => {
        if (state) {
          setMeetingState({
            isActive: state.isActive,
            title: state.title,
            filePath: state.filePath,
            startedAt: state.startedAt,
          });
        }
      });
    }
  }, [connectionStatus, vault, getMeetingState, setMeetingState]);

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
  }

  // Handle config editor save - use REST API (migrated from WebSocket in TASK-010)
  async function handleConfigSave(config: EditableVaultConfig) {
    if (!vault) return;

    console.log(`[App] Saving config for vault: ${vault.id}`, config);
    const success = await updateConfig(config);

    if (success) {
      // Update session vault with new config values
      updateVaultConfig(config);

      // Show success toast
      setToastVariant("success");
      setToastMessage("Settings saved");
      setToastVisible(true);

      // Close dialog
      setConfigEditorOpen(false);
      console.log("[App] Config saved successfully");
    } else {
      // Error is already set by the hook
      console.warn("[App] Config save failed:", configError);
    }
  }

  function handleConfigCancel() {
    setConfigEditorOpen(false);
  }

  // Toast dismiss handler
  function handleToastDismiss() {
    setToastVisible(false);
  }

  const headerClassName = isHeaderCollapsed
    ? "app-header app-header--collapsed"
    : "app-header app-header--expanded";

  function handleHeaderToggle() {
    setIsHeaderCollapsed((prev) => !prev);
  }

  return (
    <>
      <header className={headerClassName}>
        {/* Collapsed mobile view: logo button + toolbar */}
        <button
          type="button"
          className="app-header__collapse-btn"
          onClick={handleHeaderToggle}
          aria-label={isHeaderCollapsed ? "Expand header" : "Collapse header"}
          aria-expanded={!isHeaderCollapsed}
        >
          <img src={logoSrc} alt="" className="app-logo" aria-hidden="true" />
        </button>

        <div className="app-header__left">
          <div className="app-title-row">
            <img src={logoSrc} alt="" className="app-logo" aria-hidden="true" />
            <button
              type="button"
              className="app-title-btn"
              onClick={handleHeaderToggle}
              aria-label="Collapse header"
            >
              <h1 className="app-title">Memory Loop</h1>
            </button>
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
            cardsEnabled: vault.cardsEnabled,
            viMode: vault.viMode,
          }}
          onSave={handleConfigSave}
          onCancel={handleConfigCancel}
          isSaving={configSaving}
          saveError={configError}
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
