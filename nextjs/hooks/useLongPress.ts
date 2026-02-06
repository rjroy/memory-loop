/**
 * useLongPress Hook
 *
 * Provides touch event handlers for detecting long-press gestures.
 * Used for triggering context menus and other actions on mobile devices.
 */

import { useRef, useCallback, useEffect } from "react";

/**
 * Touch event handlers returned by the useLongPress hook.
 */
export interface LongPressHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
}

/**
 * Options for configuring long press behavior.
 */
export interface UseLongPressOptions {
  /** Duration in milliseconds before triggering the callback. Default: 500ms */
  duration?: number;
}

/** Default long press duration in milliseconds */
export const DEFAULT_LONG_PRESS_DURATION = 500;

/**
 * React hook for detecting long-press gestures on touch devices.
 *
 * Starts a timer on touch start, cancels on move or end, and fires
 * the callback if the touch is held for the specified duration.
 *
 * @param callback - Function to call when long press is detected
 * @param options - Configuration options (duration)
 * @returns Touch event handlers to attach to an element
 *
 * @example
 * ```tsx
 * const handlers = useLongPress(
 *   (e) => showContextMenu(e),
 *   { duration: 500 }
 * );
 *
 * return (
 *   <button {...handlers}>
 *     Long press me
 *   </button>
 * );
 * ```
 */
export function useLongPress(
  callback: ((e: React.TouchEvent) => void) | undefined,
  options: UseLongPressOptions = {}
): LongPressHandlers {
  const { duration = DEFAULT_LONG_PRESS_DURATION } = options;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventRef = useRef<React.TouchEvent | null>(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    eventRef.current = null;
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!callback) return;

      // Prevent system context menu from appearing
      e.preventDefault();

      // Store event for callback
      eventRef.current = e;

      timerRef.current = setTimeout(() => {
        if (eventRef.current) {
          callback(eventRef.current);
        }
        timerRef.current = null;
        eventRef.current = null;
      }, duration);
    },
    [callback, duration]
  );

  const onTouchMove = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const onTouchEnd = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };
}
