/**
 * Hook to detect physical keyboard presence.
 *
 * Uses two heuristics:
 * 1. `matchMedia('(pointer: fine)')` - true for mouse/trackpad (implies desktop with keyboard)
 * 2. `navigator.maxTouchPoints === 0` - no touch capability (implies keyboard-only device)
 *
 * If either condition is true, we assume a keyboard is present.
 * If detection fails or is uncertain, returns true (safe fallback: assume keyboard exists).
 *
 * This is not reactive; keyboard presence doesn't change mid-session.
 */

/**
 * Detect keyboard presence. Exported for testing.
 */
export function detectKeyboard(): boolean {
  // Server-side or unusual environment: assume keyboard exists
  if (typeof window === "undefined") {
    return true;
  }

  try {
    // Fine pointer (mouse/trackpad) implies desktop with keyboard
    const hasFinePointer = window.matchMedia("(pointer: fine)").matches;
    if (hasFinePointer) {
      return true;
    }

    // No touch capability implies keyboard-only device
    const noTouchPoints = navigator.maxTouchPoints === 0;
    if (noTouchPoints) {
      return true;
    }

    // Touch-only device (no fine pointer, has touch points)
    return false;
  } catch {
    // If detection fails, assume keyboard exists (safe fallback)
    return true;
  }
}

/**
 * React hook that returns whether a physical keyboard is likely present.
 *
 * Used to enable/disable vi mode: vi mode requires a keyboard and is
 * disabled on touch-only devices where it would be unusable.
 */
export function useHasKeyboard(): boolean {
  // Detection happens once; result is stable for the session
  return detectKeyboard();
}
