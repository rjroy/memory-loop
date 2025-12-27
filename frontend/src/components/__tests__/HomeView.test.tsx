/**
 * Tests for HomeView Component
 *
 * Tests rendering and accessibility.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { HomeView } from "../HomeView";
import { SessionProvider } from "../../contexts/SessionContext";

// Clean up after each test
beforeEach(() => {
  cleanup();
});

// Test wrapper with SessionProvider
function Wrapper({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

describe("HomeView", () => {
  describe("rendering", () => {
    it("renders vault name label", () => {
      render(<HomeView />, { wrapper: Wrapper });

      expect(screen.getByText("Current Vault")).toBeTruthy();
    });

    it("renders session stats section", () => {
      render(<HomeView />, { wrapper: Wrapper });

      expect(screen.getByText("Messages")).toBeTruthy();
    });

    it("renders message count of 0 initially", () => {
      render(<HomeView />, { wrapper: Wrapper });

      expect(screen.getByText("0")).toBeTruthy();
    });
  });

  describe("accessibility", () => {
    it("has proper section landmarks", () => {
      render(<HomeView />, { wrapper: Wrapper });

      expect(screen.getByLabelText("Session context")).toBeTruthy();
    });
  });

  describe("inspiration", () => {
    it("does not render InspirationCard when no inspiration data", () => {
      // Initially, no inspiration data is loaded
      render(<HomeView />, { wrapper: Wrapper });

      // InspirationCard has aria-label="Inspiration" so we can check for its absence
      expect(screen.queryByLabelText("Inspiration")).toBeNull();
    });
  });
});
