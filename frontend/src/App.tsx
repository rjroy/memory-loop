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

import React, { useState } from "react";
import { SessionProvider, useSession } from "./contexts/SessionContext";
import { VaultSelect } from "./components/VaultSelect";
import { ModeToggle } from "./components/ModeToggle";
import { HomeView } from "./components/HomeView";
import { NoteCapture } from "./components/NoteCapture";
import { Discussion } from "./components/Discussion";
import { BrowseMode } from "./components/BrowseMode";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { useHoliday } from "./hooks/useHoliday";
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
  const [activeDialog, setActiveDialog] = useState<DialogType>(null);
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

  return (
    <>
      <header className="app-header">
        <div className="app-header__left">
          <div className="app-title-row">
            <img src={logoSrc} alt="" className="app-logo" aria-hidden="true" />
            <h1 className="app-title">Memory Loop</h1>
          </div>
          {vault && (
            <button
              type="button"
              className="app-vault-btn"
              onClick={handleChangeVault}
              aria-label="Change vault"
            >
              {vault.name}
            </button>
          )}
        </div>
        <div className="app-header__center">
          <ModeToggle />
        </div>
        <div className="app-header__right">
          {/* New session button moved to Discussion component */}
        </div>
      </header>

      <main className="app-main">
        {mode === "home" && <HomeView />}
        {mode === "note" && <NoteCapture />}
        {mode === "discussion" && <Discussion />}
        {mode === "browse" && <BrowseMode />}
      </main>

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

  // Reset isReady when vault is cleared
  React.useEffect(() => {
    if (!vault) {
      setIsReady(false);
    }
  }, [vault]);

  // Show vault selection until a vault is selected and session is ready
  if (!vault || !isReady) {
    return (
      <div className="app" data-holiday={holiday ?? undefined}>
        <VaultSelect onReady={() => setIsReady(true)} />
      </div>
    );
  }

  return (
    <div className="app" data-holiday={holiday ?? undefined}>
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
