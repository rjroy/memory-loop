/**
 * Tests for ViModeIndicator component
 *
 * Tests cover:
 * - Rendering correct mode labels
 * - Visibility toggling
 * - Command buffer display in command mode
 * - Accessibility attributes
 *
 * @see .lore/specs/vi-mode-pair-writing.md REQ-5
 */

import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { ViModeIndicator } from "../ViModeIndicator";
import type { ViMode } from "../../../hooks/useViMode";

afterEach(() => {
  cleanup();
});

// =============================================================================
// Mode Label Tests
// =============================================================================

describe("ViModeIndicator - mode labels", () => {
  it("renders '-- NORMAL --' when mode is normal", () => {
    render(<ViModeIndicator mode="normal" visible={true} />);

    expect(screen.getByText("-- NORMAL --")).toBeDefined();
  });

  it("renders '-- INSERT --' when mode is insert", () => {
    render(<ViModeIndicator mode="insert" visible={true} />);

    expect(screen.getByText("-- INSERT --")).toBeDefined();
  });

  it("renders '-- COMMAND --' when mode is command", () => {
    render(<ViModeIndicator mode="command" visible={true} />);

    expect(screen.getByText("-- COMMAND --")).toBeDefined();
  });

  it("sets data-mode attribute for CSS styling", () => {
    const modes: ViMode[] = ["normal", "insert", "command"];

    for (const mode of modes) {
      cleanup();
      render(<ViModeIndicator mode={mode} visible={true} />);

      const indicator = document.querySelector(".vi-mode-indicator");
      expect(indicator?.getAttribute("data-mode")).toBe(mode);
    }
  });
});

// =============================================================================
// Visibility Tests
// =============================================================================

describe("ViModeIndicator - visibility", () => {
  it("renders when visible is true", () => {
    render(<ViModeIndicator mode="normal" visible={true} />);

    const indicator = document.querySelector(".vi-mode-indicator");
    expect(indicator).not.toBeNull();
  });

  it("does not render when visible is false", () => {
    render(<ViModeIndicator mode="normal" visible={false} />);

    const indicator = document.querySelector(".vi-mode-indicator");
    expect(indicator).toBeNull();
  });

  it("returns null (not hidden element) when not visible", () => {
    const { container } = render(
      <ViModeIndicator mode="normal" visible={false} />
    );

    // Container should be empty when not visible
    expect(container.firstChild).toBeNull();
  });
});

// =============================================================================
// Command Buffer Tests
// =============================================================================

describe("ViModeIndicator - command buffer", () => {
  it("shows commandBuffer in command mode", () => {
    render(
      <ViModeIndicator mode="command" visible={true} commandBuffer=":w" />
    );

    expect(screen.getByText("-- COMMAND -- :w")).toBeDefined();
  });

  it("shows full command buffer with longer commands", () => {
    render(
      <ViModeIndicator mode="command" visible={true} commandBuffer=":wq" />
    );

    expect(screen.getByText("-- COMMAND -- :wq")).toBeDefined();
  });

  it("ignores commandBuffer in normal mode", () => {
    render(
      <ViModeIndicator mode="normal" visible={true} commandBuffer=":w" />
    );

    expect(screen.getByText("-- NORMAL --")).toBeDefined();
    expect(screen.queryByText(":w")).toBeNull();
  });

  it("ignores commandBuffer in insert mode", () => {
    render(
      <ViModeIndicator mode="insert" visible={true} commandBuffer=":w" />
    );

    expect(screen.getByText("-- INSERT --")).toBeDefined();
    expect(screen.queryByText(":w")).toBeNull();
  });

  it("shows only mode label when commandBuffer is empty string", () => {
    render(<ViModeIndicator mode="command" visible={true} commandBuffer="" />);

    expect(screen.getByText("-- COMMAND --")).toBeDefined();
  });

  it("shows only mode label when commandBuffer is undefined", () => {
    render(<ViModeIndicator mode="command" visible={true} />);

    expect(screen.getByText("-- COMMAND --")).toBeDefined();
  });
});

// =============================================================================
// Accessibility Tests
// =============================================================================

describe("ViModeIndicator - accessibility", () => {
  it("has aria-live attribute for screen readers", () => {
    render(<ViModeIndicator mode="normal" visible={true} />);

    const indicator = document.querySelector(".vi-mode-indicator");
    expect(indicator?.getAttribute("aria-live")).toBe("polite");
  });

  it("has descriptive aria-label", () => {
    render(<ViModeIndicator mode="normal" visible={true} />);

    const indicator = document.querySelector(".vi-mode-indicator");
    expect(indicator?.getAttribute("aria-label")).toBe("Vi mode: normal");
  });

  it("updates aria-label based on mode", () => {
    const { rerender } = render(
      <ViModeIndicator mode="normal" visible={true} />
    );

    let indicator = document.querySelector(".vi-mode-indicator");
    expect(indicator?.getAttribute("aria-label")).toBe("Vi mode: normal");

    rerender(<ViModeIndicator mode="insert" visible={true} />);

    indicator = document.querySelector(".vi-mode-indicator");
    expect(indicator?.getAttribute("aria-label")).toBe("Vi mode: insert");

    rerender(<ViModeIndicator mode="command" visible={true} />);

    indicator = document.querySelector(".vi-mode-indicator");
    expect(indicator?.getAttribute("aria-label")).toBe("Vi mode: command");
  });
});

// =============================================================================
// CSS Class Tests
// =============================================================================

describe("ViModeIndicator - CSS classes", () => {
  it("has vi-mode-indicator class", () => {
    render(<ViModeIndicator mode="normal" visible={true} />);

    const indicator = document.querySelector(".vi-mode-indicator");
    expect(indicator).not.toBeNull();
  });
});
