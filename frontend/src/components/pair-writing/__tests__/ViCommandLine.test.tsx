/**
 * Tests for ViCommandLine component
 *
 * ViCommandLine is a pure display component that shows the command buffer.
 * All keyboard input is handled by useViMode through the textarea.
 *
 * Tests cover:
 * - Visibility toggling
 * - Rendering with colon prefix
 * - Displaying command text
 * - Cursor indicator
 * - Accessibility attributes
 *
 * @see .lore/specs/vi-mode-pair-writing.md (REQ-14, REQ-19)
 */

import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { ViCommandLine } from "../ViCommandLine";

afterEach(() => {
  cleanup();
});

// =============================================================================
// Visibility Tests
// =============================================================================

describe("ViCommandLine - visibility", () => {
  it("renders when visible is true", () => {
    render(
      <ViCommandLine
        visible={true}
        value=""
      />
    );

    expect(screen.getByTestId("vi-command-line")).toBeDefined();
  });

  it("does not render when visible is false", () => {
    render(
      <ViCommandLine
        visible={false}
        value=""
      />
    );

    expect(screen.queryByTestId("vi-command-line")).toBeNull();
  });

  it("returns null (not hidden element) when not visible", () => {
    const { container } = render(
      <ViCommandLine
        visible={false}
        value=""
      />
    );

    expect(container.firstChild).toBeNull();
  });
});

// =============================================================================
// Colon Prefix Tests
// =============================================================================

describe("ViCommandLine - colon prefix", () => {
  it("shows colon prefix", () => {
    render(
      <ViCommandLine
        visible={true}
        value=""
      />
    );

    expect(screen.getByText(":")).toBeDefined();
  });

  it("colon prefix has aria-hidden for accessibility", () => {
    render(
      <ViCommandLine
        visible={true}
        value=""
      />
    );

    const prefix = screen.getByText(":");
    expect(prefix.getAttribute("aria-hidden")).toBe("true");
  });
});

// =============================================================================
// Command Text Display Tests
// =============================================================================

describe("ViCommandLine - command text display", () => {
  it("displays the command value", () => {
    render(
      <ViCommandLine
        visible={true}
        value="wq"
      />
    );

    expect(screen.getByText("wq")).toBeDefined();
  });

  it("displays empty value correctly (shows cursor only)", () => {
    render(
      <ViCommandLine
        visible={true}
        value=""
      />
    );

    // The container should exist even with empty value
    expect(screen.getByTestId("vi-command-line")).toBeDefined();
    // The text span should be empty
    const container = screen.getByTestId("vi-command-line");
    const textSpan = container.querySelector(".vi-command-line__text");
    expect(textSpan?.textContent).toBe("");
  });

  it("updates display when value changes", () => {
    const { rerender } = render(
      <ViCommandLine
        visible={true}
        value="w"
      />
    );

    expect(screen.getByText("w")).toBeDefined();

    rerender(
      <ViCommandLine
        visible={true}
        value="wq"
      />
    );

    expect(screen.getByText("wq")).toBeDefined();
  });
});

// =============================================================================
// Cursor Indicator Tests
// =============================================================================

describe("ViCommandLine - cursor indicator", () => {
  it("shows cursor element after text", () => {
    render(
      <ViCommandLine
        visible={true}
        value="w"
      />
    );

    const container = screen.getByTestId("vi-command-line");
    const cursor = container.querySelector(".vi-command-line__cursor");
    expect(cursor).toBeDefined();
    expect(cursor).not.toBeNull();
  });

  it("cursor has aria-hidden for accessibility", () => {
    render(
      <ViCommandLine
        visible={true}
        value=""
      />
    );

    const container = screen.getByTestId("vi-command-line");
    const cursor = container.querySelector(".vi-command-line__cursor");
    expect(cursor?.getAttribute("aria-hidden")).toBe("true");
  });
});

// =============================================================================
// Accessibility Tests
// =============================================================================

describe("ViCommandLine - accessibility", () => {
  it("has status role for live region", () => {
    render(
      <ViCommandLine
        visible={true}
        value=""
      />
    );

    const container = screen.getByTestId("vi-command-line");
    expect(container.getAttribute("role")).toBe("status");
  });

  it("has aria-label on container", () => {
    render(
      <ViCommandLine
        visible={true}
        value=""
      />
    );

    const container = screen.getByTestId("vi-command-line");
    expect(container.getAttribute("aria-label")).toBe("Vi command line");
  });

  it("has aria-live for screen reader announcements", () => {
    render(
      <ViCommandLine
        visible={true}
        value=""
      />
    );

    const container = screen.getByTestId("vi-command-line");
    expect(container.getAttribute("aria-live")).toBe("polite");
  });
});

// =============================================================================
// CSS Class Tests
// =============================================================================

describe("ViCommandLine - CSS classes", () => {
  it("has vi-command-line class on container", () => {
    render(
      <ViCommandLine
        visible={true}
        value=""
      />
    );

    const container = screen.getByTestId("vi-command-line");
    expect(container.classList.contains("vi-command-line")).toBe(true);
  });

  it("has vi-command-line__prefix class on colon", () => {
    render(
      <ViCommandLine
        visible={true}
        value=""
      />
    );

    const prefix = screen.getByText(":");
    expect(prefix.classList.contains("vi-command-line__prefix")).toBe(true);
  });

  it("has vi-command-line__text class on text display", () => {
    render(
      <ViCommandLine
        visible={true}
        value="w"
      />
    );

    const text = screen.getByText("w");
    expect(text.classList.contains("vi-command-line__text")).toBe(true);
  });

  it("has vi-command-line__cursor class on cursor", () => {
    render(
      <ViCommandLine
        visible={true}
        value=""
      />
    );

    const container = screen.getByTestId("vi-command-line");
    const cursor = container.querySelector(".vi-command-line__cursor");
    expect(cursor?.classList.contains("vi-command-line__cursor")).toBe(true);
  });
});
