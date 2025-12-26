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

  describe("quick actions", () => {
    it("renders all three quick action buttons", () => {
      render(<HomeView />, { wrapper: Wrapper });

      expect(screen.getByText("Capture thought")).toBeTruthy();
      expect(screen.getByText("Ask Claude")).toBeTruthy();
      expect(screen.getByText("Browse vault")).toBeTruthy();
    });

    it("quick action buttons are clickable", () => {
      render(<HomeView />, { wrapper: Wrapper });

      const captureButton = screen.getByRole("button", { name: /capture thought/i });
      const chatButton = screen.getByRole("button", { name: /ask claude/i });
      const browseButton = screen.getByRole("button", { name: /browse vault/i });

      expect(captureButton).toBeTruthy();
      expect(chatButton).toBeTruthy();
      expect(browseButton).toBeTruthy();
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
});
