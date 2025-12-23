/**
 * Memory Loop - Main App Component
 *
 * Root component for the Memory Loop application.
 * Provides the app shell with:
 * - Vault selection screen
 * - Note capture mode
 * - Discussion mode
 * - Session management
 */

import React, { useState } from "react";
import { SessionProvider, useSession } from "./contexts/SessionContext";
import { VaultSelect } from "./components/VaultSelect";
import { ModeToggle } from "./components/ModeToggle";
import { NoteCapture } from "./components/NoteCapture";
import { Discussion } from "./components/Discussion";
import "./App.css";

/**
 * Confirmation dialog for new session.
 */
interface ConfirmDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ isOpen, onConfirm, onCancel }: ConfirmDialogProps): React.ReactNode {
  if (!isOpen) return null;

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onCancel();
    }
  }

  return (
    <div
      className="confirm-dialog__backdrop"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="confirm-dialog">
        <h2 id="confirm-dialog-title" className="confirm-dialog__title">
          Start New Session?
        </h2>
        <p className="confirm-dialog__message">
          This will clear the current conversation. Your notes are already saved to the vault.
        </p>
        <div className="confirm-dialog__actions">
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--confirm"
            onClick={onConfirm}
          >
            New Session
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Main app content when a vault is selected.
 */
function MainContent(): React.ReactNode {
  const { mode, vault, startNewSession } = useSession();
  const [showConfirm, setShowConfirm] = useState(false);

  function handleNewSession() {
    setShowConfirm(true);
  }

  function handleConfirmNewSession() {
    startNewSession();
    setShowConfirm(false);
  }

  function handleCancelNewSession() {
    setShowConfirm(false);
  }

  return (
    <>
      <header className="app-header">
        <div className="app-header__left">
          <h1 className="app-title">Memory Loop</h1>
          {vault && (
            <span className="app-vault-name">{vault.name}</span>
          )}
        </div>
        <div className="app-header__center">
          <ModeToggle />
        </div>
        <div className="app-header__right">
          <button
            type="button"
            className="app-new-session-btn"
            onClick={handleNewSession}
            aria-label="Start new session"
          >
            New Session
          </button>
        </div>
      </header>

      <main className="app-main">
        {mode === "note" ? <NoteCapture /> : <Discussion />}
      </main>

      <ConfirmDialog
        isOpen={showConfirm}
        onConfirm={handleConfirmNewSession}
        onCancel={handleCancelNewSession}
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
