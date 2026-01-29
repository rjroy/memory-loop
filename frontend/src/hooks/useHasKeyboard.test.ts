import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { detectKeyboard } from "./useHasKeyboard";

describe("detectKeyboard", () => {
  // Store original values to restore after each test
  let originalMatchMedia: typeof window.matchMedia;
  let originalMaxTouchPoints: number;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    originalMaxTouchPoints = navigator.maxTouchPoints;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    Object.defineProperty(navigator, "maxTouchPoints", {
      value: originalMaxTouchPoints,
      configurable: true,
    });
  });

  function mockMatchMedia(matches: boolean) {
    window.matchMedia = ((query: string) => ({
      matches: query === "(pointer: fine)" ? matches : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    })) as typeof window.matchMedia;
  }

  function mockMaxTouchPoints(value: number) {
    Object.defineProperty(navigator, "maxTouchPoints", {
      value,
      configurable: true,
    });
  }

  describe("desktop with mouse/trackpad", () => {
    test("returns true when fine pointer detected", () => {
      mockMatchMedia(true);
      mockMaxTouchPoints(0);

      expect(detectKeyboard()).toBe(true);
    });

    test("returns true when fine pointer detected even with touch support", () => {
      // Laptop with touchscreen: has fine pointer AND touch
      mockMatchMedia(true);
      mockMaxTouchPoints(10);

      expect(detectKeyboard()).toBe(true);
    });
  });

  describe("keyboard-only device", () => {
    test("returns true when no touch points available", () => {
      mockMatchMedia(false);
      mockMaxTouchPoints(0);

      expect(detectKeyboard()).toBe(true);
    });
  });

  describe("touch-only device", () => {
    test("returns false when coarse pointer and touch points present", () => {
      // Phone or tablet without keyboard
      mockMatchMedia(false);
      mockMaxTouchPoints(5);

      expect(detectKeyboard()).toBe(false);
    });

    test("returns false with high touch point count", () => {
      // Typical mobile device
      mockMatchMedia(false);
      mockMaxTouchPoints(10);

      expect(detectKeyboard()).toBe(false);
    });
  });

  describe("error handling", () => {
    test("returns true when matchMedia throws", () => {
      window.matchMedia = () => {
        throw new Error("Not supported");
      };
      mockMaxTouchPoints(5);

      // Should not throw, should return true as safe fallback
      expect(detectKeyboard()).toBe(true);
    });
  });
});
