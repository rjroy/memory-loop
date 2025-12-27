/**
 * Tests for HomeView Component
 *
 * Tests rendering, quick actions, and accessibility.
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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
      expect(screen.getByLabelText("Quick actions")).toBeTruthy();
    });
  });

  describe("mode change callback", () => {
    it("calls onModeChange when capture button is clicked", () => {
      const mockOnModeChange = mock(() => {});
      render(<HomeView onModeChange={mockOnModeChange} />, { wrapper: Wrapper });

      fireEvent.click(screen.getByText("Capture thought"));

      expect(mockOnModeChange).toHaveBeenCalledWith("note");
    });

    it("calls onModeChange when chat button is clicked", () => {
      const mockOnModeChange = mock(() => {});
      render(<HomeView onModeChange={mockOnModeChange} />, { wrapper: Wrapper });

      fireEvent.click(screen.getByText("Ask Claude"));

      expect(mockOnModeChange).toHaveBeenCalledWith("discussion");
    });

    it("calls onModeChange when browse button is clicked", () => {
      const mockOnModeChange = mock(() => {});
      render(<HomeView onModeChange={mockOnModeChange} />, { wrapper: Wrapper });

      fireEvent.click(screen.getByText("Browse vault"));

      expect(mockOnModeChange).toHaveBeenCalledWith("browse");
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
