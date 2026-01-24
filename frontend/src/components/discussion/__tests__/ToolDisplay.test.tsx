/**
 * Tests for ToolDisplay component
 *
 * Tests collapsed/expanded states, loading, and content display.
 */

import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ToolDisplay } from "../ToolDisplay";

afterEach(() => {
  cleanup();
});

describe("ToolDisplay", () => {
  describe("collapsed state", () => {
    it("renders tool name", () => {
      render(<ToolDisplay toolName="Read" toolUseId="tool-1" />);

      expect(screen.getByText("Read")).toBeDefined();
    });

    it("shows summary for file path input", () => {
      render(
        <ToolDisplay
          toolName="Read"
          toolUseId="tool-1"
          input={{ file_path: "/home/user/file.txt" }}
        />
      );

      expect(screen.getByText("file.txt")).toBeDefined();
    });

    it("shows summary for command input", () => {
      render(
        <ToolDisplay
          toolName="Bash"
          toolUseId="tool-1"
          input={{ command: "ls -la" }}
        />
      );

      expect(screen.getByText("ls -la")).toBeDefined();
    });

    it("shows summary for pattern input", () => {
      render(
        <ToolDisplay
          toolName="Grep"
          toolUseId="tool-1"
          input={{ pattern: "TODO" }}
        />
      );

      expect(screen.getByText('"TODO"')).toBeDefined();
    });

    it("does not show content by default", () => {
      render(
        <ToolDisplay
          toolName="Read"
          toolUseId="tool-1"
          input={{ file_path: "/test.txt" }}
          output="File contents"
        />
      );

      expect(screen.queryByText("File contents")).toBeNull();
    });
  });

  describe("loading state", () => {
    it("shows spinner when loading", () => {
      render(<ToolDisplay toolName="Read" toolUseId="tool-1" isLoading />);

      // Check for spinner element by class
      const header = screen.getByRole("button");
      expect(header.querySelector(".tool-display__spinner")).toBeDefined();
    });

    it("has loading visual indicator", () => {
      const { container } = render(
        <ToolDisplay toolName="Read" toolUseId="tool-1" isLoading />
      );

      expect(container.querySelector(".tool-display--loading")).toBeDefined();
    });

    it("shows waiting message when expanded and loading", () => {
      render(<ToolDisplay toolName="Read" toolUseId="tool-1" isLoading />);

      // Expand the card
      const header = screen.getByRole("button");
      fireEvent.click(header);

      expect(screen.getByText("Waiting for result...")).toBeDefined();
    });
  });

  describe("expanded state", () => {
    it("expands on click", () => {
      render(
        <ToolDisplay
          toolName="Read"
          toolUseId="tool-1"
          input={{ file_path: "/test.txt" }}
        />
      );

      const header = screen.getByRole("button");
      fireEvent.click(header);

      expect(screen.getByText("Input")).toBeDefined();
    });

    it("expands on Enter key", () => {
      render(
        <ToolDisplay
          toolName="Read"
          toolUseId="tool-1"
          input={{ file_path: "/test.txt" }}
        />
      );

      const header = screen.getByRole("button");
      fireEvent.keyDown(header, { key: "Enter" });

      expect(screen.getByText("Input")).toBeDefined();
    });

    it("expands on Space key", () => {
      render(
        <ToolDisplay
          toolName="Read"
          toolUseId="tool-1"
          input={{ file_path: "/test.txt" }}
        />
      );

      const header = screen.getByRole("button");
      fireEvent.keyDown(header, { key: " " });

      expect(screen.getByText("Input")).toBeDefined();
    });

    it("shows formatted input when expanded", () => {
      render(
        <ToolDisplay
          toolName="Read"
          toolUseId="tool-1"
          input={{ file_path: "/home/user/file.txt" }}
        />
      );

      const header = screen.getByRole("button");
      fireEvent.click(header);

      // Check for JSON-formatted input
      expect(screen.getByText(/file_path/)).toBeDefined();
    });

    it("shows output when expanded", () => {
      render(
        <ToolDisplay
          toolName="Read"
          toolUseId="tool-1"
          output="File contents here"
        />
      );

      const header = screen.getByRole("button");
      fireEvent.click(header);

      expect(screen.getByText("Output")).toBeDefined();
      expect(screen.getByText("File contents here")).toBeDefined();
    });

    it("collapses on second click", () => {
      render(
        <ToolDisplay
          toolName="Read"
          toolUseId="tool-1"
          input={{ file_path: "/test.txt" }}
        />
      );

      const header = screen.getByRole("button");

      // Expand
      fireEvent.click(header);
      expect(screen.getByText("Input")).toBeDefined();

      // Collapse
      fireEvent.click(header);
      expect(screen.queryByText("Input")).toBeNull();
    });

    it("sets aria-expanded correctly", () => {
      render(
        <ToolDisplay
          toolName="Read"
          toolUseId="tool-1"
          input={{ file_path: "/test.txt" }}
        />
      );

      const header = screen.getByRole("button");
      expect(header.getAttribute("aria-expanded")).toBe("false");

      fireEvent.click(header);
      expect(header.getAttribute("aria-expanded")).toBe("true");
    });
  });

  describe("accessibility", () => {
    it("has proper role", () => {
      render(<ToolDisplay toolName="Read" toolUseId="tool-1" />);

      expect(screen.getByRole("listitem")).toBeDefined();
      expect(screen.getByRole("button")).toBeDefined();
    });

    it("has accessible label", () => {
      render(<ToolDisplay toolName="Read" toolUseId="tool-1" />);

      const header = screen.getByRole("button");
      expect(header.getAttribute("aria-label")).toBe("Read tool");
    });

    it("includes loading state in label", () => {
      render(<ToolDisplay toolName="Read" toolUseId="tool-1" isLoading />);

      const header = screen.getByRole("button");
      expect(header.getAttribute("aria-label")).toBe("Read tool, running");
    });

    it("is keyboard accessible", () => {
      render(
        <ToolDisplay
          toolName="Read"
          toolUseId="tool-1"
          input={{ file_path: "/test.txt" }}
        />
      );

      const header = screen.getByRole("button");
      expect(header.getAttribute("tabindex")).toBe("0");
    });
  });
});
