/**
 * Toast Component
 *
 * Non-blocking notification for success/error messages.
 * Renders via portal at bottom of screen, auto-dismisses after 5 seconds.
 * Supports manual dismissal and accessibility via role="alert".
 */

import React, { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import "./Toast.css";

export type ToastVariant = "success" | "error";

export interface ToastProps {
  /** Whether the toast is visible */
  isVisible: boolean;
  /** Toast variant determines styling and icon */
  variant: ToastVariant;
  /** Message to display */
  message: string;
  /** Called when toast should be dismissed (timeout or manual) */
  onDismiss: () => void;
  /** Auto-dismiss delay in milliseconds (default: 5000) */
  autoDismissMs?: number;
}

/**
 * Toast notification component.
 *
 * - Fixed position at bottom of screen
 * - Auto-dismisses after 5 seconds (configurable)
 * - Can be manually dismissed by clicking
 * - Uses role="alert" for accessibility (announces to screen readers)
 * - Renders via portal to avoid z-index issues
 */
export function Toast({
  isVisible,
  variant,
  message,
  onDismiss,
  autoDismissMs = 5000,
}: ToastProps): React.ReactNode {
  const handleDismiss = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  // Auto-dismiss after timeout
  useEffect(() => {
    if (!isVisible) return;

    const timer = setTimeout(() => {
      handleDismiss();
    }, autoDismissMs);

    return () => clearTimeout(timer);
  }, [isVisible, autoDismissMs, handleDismiss]);

  // Handle click dismissal
  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    handleDismiss();
  }

  // Handle keyboard dismissal
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleDismiss();
    }
  }

  if (!isVisible) return null;

  const icon = variant === "success" ? "\u2713" : "\u2717";

  return createPortal(
    <div
      className={`toast toast--${variant}`}
      role="alert"
      aria-live="assertive"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <span className="toast__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="toast__message">{message}</span>
      <button
        type="button"
        className="toast__dismiss"
        onClick={handleClick}
        aria-label="Dismiss notification"
      >
        <span aria-hidden="true">&times;</span>
      </button>
    </div>,
    document.body
  );
}
