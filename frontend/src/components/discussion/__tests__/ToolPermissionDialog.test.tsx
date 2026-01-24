/**
 * Tests for ToolPermissionDialog component
 *
 * Tests rendering, accessibility, and user interactions.
 */

import { describe, it, expect, afterEach, mock } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ToolPermissionDialog } from "../ToolPermissionDialog";

afterEach(() => {
  cleanup();
});

describe("ToolPermissionDialog", () => {
  const defaultProps = {
    request: {
      toolUseId: "tool_123_abc",
      toolName: "Read",
      input: { file_path: "/path/to/file.md" },
    },
    onAllow: mock(() => {}),
    onDeny: mock(() => {}),
  };

  describe("rendering", () => {
    it("renders nothing when request is null", () => {
      const { container } = render(
        <ToolPermissionDialog request={null} onAllow={mock()} onDeny={mock()} />
      );
      expect(container.innerHTML).toBe("");
    });

    it("renders dialog when request is provided", () => {
      render(<ToolPermissionDialog {...defaultProps} />);

      expect(screen.getByRole("dialog")).toBeDefined();
      expect(screen.getByText("Tool Permission Request")).toBeDefined();
    });

    it("displays the tool name", () => {
      render(<ToolPermissionDialog {...defaultProps} />);

      expect(screen.getByText("Read")).toBeDefined();
    });

    it("displays human-readable description for known tools", () => {
      render(<ToolPermissionDialog {...defaultProps} />);

      // "Read" should display "Read a file from your vault"
      expect(screen.getByText(/Read a file from your vault/)).toBeDefined();
    });

    it("displays generic description for unknown tools", () => {
      const unknownToolProps = {
        ...defaultProps,
        request: { ...defaultProps.request, toolName: "CustomTool" },
      };
      render(<ToolPermissionDialog {...unknownToolProps} />);

      expect(screen.getByText(/Use the CustomTool tool/)).toBeDefined();
    });

    it("displays formatted tool input", () => {
      render(<ToolPermissionDialog {...defaultProps} />);

      // JSON should be formatted with file_path
      expect(screen.getByText(/file_path/)).toBeDefined();
      expect(screen.getByText(/\/path\/to\/file\.md/)).toBeDefined();
    });

    it("renders Allow and Deny buttons", () => {
      render(<ToolPermissionDialog {...defaultProps} />);

      expect(screen.getByText("Allow")).toBeDefined();
      expect(screen.getByText("Deny")).toBeDefined();
    });

    it("handles null input gracefully", () => {
      const nullInputProps = {
        ...defaultProps,
        request: { ...defaultProps.request, input: null },
      };
      render(<ToolPermissionDialog {...nullInputProps} />);

      expect(screen.getByText("null")).toBeDefined();
    });

    it("truncates long input", () => {
      const longInput = { data: "x".repeat(600) };
      const longInputProps = {
        ...defaultProps,
        request: { ...defaultProps.request, input: longInput },
      };
      render(<ToolPermissionDialog {...longInputProps} />);

      // Should show truncated indicator
      expect(screen.getByText(/\.\.\./)).toBeDefined();
    });
  });

  describe("accessibility", () => {
    it("has proper dialog role and aria attributes", () => {
      render(<ToolPermissionDialog {...defaultProps} />);

      const dialog = screen.getByRole("dialog");
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      expect(dialog.getAttribute("aria-labelledby")).toBeDefined();
    });

    it("has accessible title linked via aria-labelledby", () => {
      render(<ToolPermissionDialog {...defaultProps} />);

      const dialog = screen.getByRole("dialog");
      const labelledById = dialog.getAttribute("aria-labelledby");
      expect(labelledById).toBeDefined();

      const title = screen.getByText("Tool Permission Request");
      expect(title.id).toBe(labelledById as string);
    });
  });

  describe("user interactions", () => {
    it("calls onAllow when Allow button is clicked", () => {
      const onAllow = mock(() => {});
      render(<ToolPermissionDialog {...defaultProps} onAllow={onAllow} />);

      fireEvent.click(screen.getByText("Allow"));

      expect(onAllow).toHaveBeenCalledTimes(1);
    });

    it("calls onDeny when Deny button is clicked", () => {
      const onDeny = mock(() => {});
      render(<ToolPermissionDialog {...defaultProps} onDeny={onDeny} />);

      fireEvent.click(screen.getByText("Deny"));

      expect(onDeny).toHaveBeenCalledTimes(1);
    });

    it("calls onDeny when backdrop is clicked", () => {
      const onDeny = mock(() => {});
      const { container } = render(<ToolPermissionDialog {...defaultProps} onDeny={onDeny} />);

      const backdrop = container.querySelector(".tool-permission__backdrop");
      expect(backdrop).not.toBeNull();
      fireEvent.click(backdrop!);

      expect(onDeny).toHaveBeenCalledTimes(1);
    });

    it("does not call onDeny when dialog content is clicked", () => {
      const onDeny = mock(() => {});
      render(<ToolPermissionDialog {...defaultProps} onDeny={onDeny} />);

      const dialog = screen.getByRole("dialog");
      fireEvent.click(dialog);

      expect(onDeny).not.toHaveBeenCalled();
    });

    it("calls onDeny when Escape key is pressed", () => {
      const onDeny = mock(() => {});
      const { container } = render(<ToolPermissionDialog {...defaultProps} onDeny={onDeny} />);

      const backdrop = container.querySelector(".tool-permission__backdrop");
      fireEvent.keyDown(backdrop!, { key: "Escape" });

      expect(onDeny).toHaveBeenCalledTimes(1);
    });

    it("does not call onDeny for other keys", () => {
      const onDeny = mock(() => {});
      const { container } = render(<ToolPermissionDialog {...defaultProps} onDeny={onDeny} />);

      const backdrop = container.querySelector(".tool-permission__backdrop");
      fireEvent.keyDown(backdrop!, { key: "Enter" });

      expect(onDeny).not.toHaveBeenCalled();
    });
  });

  describe("button types", () => {
    it("renders buttons with type='button' to prevent form submission", () => {
      render(<ToolPermissionDialog {...defaultProps} />);

      const buttons = screen.getAllByRole("button");
      buttons.forEach((button) => {
        expect(button.getAttribute("type")).toBe("button");
      });
    });
  });

  describe("tool descriptions", () => {
    const tools = [
      { name: "Read", expected: /Read a file/ },
      { name: "Write", expected: /Write content/ },
      { name: "Edit", expected: /Edit a file/ },
      { name: "Bash", expected: /Execute a shell command/ },
      { name: "Glob", expected: /Search for files/ },
      { name: "Grep", expected: /Search file contents/ },
      { name: "WebFetch", expected: /Fetch content from a URL/ },
      { name: "WebSearch", expected: /Search the web/ },
      { name: "Task", expected: /Run a background task/ },
    ];

    tools.forEach(({ name, expected }) => {
      it(`displays correct description for ${name} tool`, () => {
        const props = {
          ...defaultProps,
          request: { ...defaultProps.request, toolName: name },
        };
        render(<ToolPermissionDialog {...props} />);

        expect(screen.getByText(expected)).toBeDefined();
        cleanup();
      });
    });
  });
});
