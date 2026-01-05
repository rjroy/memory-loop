/**
 * SlashCommandAutocomplete Component Tests
 *
 * Tests for the autocomplete popup component including:
 * - Visibility and rendering
 * - Command filtering
 * - Selection highlighting
 * - Click/touch interactions
 * - Keyboard navigation via hook
 * - ARIA accessibility attributes
 */

import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React, { useState } from "react";
import {
  SlashCommandAutocomplete,
  useSlashCommandNavigation,
} from "../SlashCommandAutocomplete";
import type { SlashCommand } from "@memory-loop/shared";

// Test fixtures
const testCommands: SlashCommand[] = [
  { name: "/commit", description: "Create a git commit", argumentHint: "message" },
  { name: "/review", description: "Review code changes" },
  { name: "/help", description: "Show available commands" },
  { name: "/clear", description: "Clear conversation history" },
  { name: "/compact", description: "Compact context window" },
  { name: "/config", description: "Configure settings" },
];

// Utility to mock onClose/onSelect callbacks
function createMockCallbacks() {
  const calls = {
    onSelect: [] as SlashCommand[],
    onClose: [] as boolean[],
    onSelectedIndexChange: [] as number[],
  };

  return {
    calls,
    onSelect: (cmd: SlashCommand) => calls.onSelect.push(cmd),
    onClose: () => calls.onClose.push(true),
    onSelectedIndexChange: (index: number) => calls.onSelectedIndexChange.push(index),
  };
}

afterEach(() => {
  cleanup();
});

describe("SlashCommandAutocomplete", () => {
  describe("visibility and rendering", () => {
    it("renders when visible with commands", () => {
      const { onSelect, onClose, onSelectedIndexChange } = createMockCallbacks();

      render(
        <SlashCommandAutocomplete
          commands={testCommands}
          inputValue="/"
          isVisible={true}
          onSelect={onSelect}
          onClose={onClose}
          selectedIndex={0}
          onSelectedIndexChange={onSelectedIndexChange}
        />
      );

      expect(screen.getByRole("listbox")).toBeDefined();
      expect(screen.getByText("/commit")).toBeDefined();
      expect(screen.getByText("/review")).toBeDefined();
    });

    it("does not render when isVisible is false", () => {
      const { onSelect, onClose, onSelectedIndexChange } = createMockCallbacks();

      render(
        <SlashCommandAutocomplete
          commands={testCommands}
          inputValue="/"
          isVisible={false}
          onSelect={onSelect}
          onClose={onClose}
          selectedIndex={0}
          onSelectedIndexChange={onSelectedIndexChange}
        />
      );

      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("does not render when commands array is empty", () => {
      const { onSelect, onClose, onSelectedIndexChange } = createMockCallbacks();

      render(
        <SlashCommandAutocomplete
          commands={[]}
          inputValue="/"
          isVisible={true}
          onSelect={onSelect}
          onClose={onClose}
          selectedIndex={0}
          onSelectedIndexChange={onSelectedIndexChange}
        />
      );

      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("does not render when no commands match filter", () => {
      const { onSelect, onClose, onSelectedIndexChange } = createMockCallbacks();

      render(
        <SlashCommandAutocomplete
          commands={testCommands}
          inputValue="/xyz"
          isVisible={true}
          onSelect={onSelect}
          onClose={onClose}
          selectedIndex={0}
          onSelectedIndexChange={onSelectedIndexChange}
        />
      );

      expect(screen.queryByRole("listbox")).toBeNull();
    });
  });

  describe("command filtering", () => {
    it("filters commands by prefix (case-insensitive)", () => {
      const { onSelect, onClose, onSelectedIndexChange } = createMockCallbacks();

      render(
        <SlashCommandAutocomplete
          commands={testCommands}
          inputValue="/co"
          isVisible={true}
          onSelect={onSelect}
          onClose={onClose}
          selectedIndex={0}
          onSelectedIndexChange={onSelectedIndexChange}
        />
      );

      // Should match: /commit, /compact, /config
      expect(screen.getByText("/commit")).toBeDefined();
      expect(screen.getByText("/compact")).toBeDefined();
      expect(screen.getByText("/config")).toBeDefined();

      // Should not match: /review, /help, /clear
      expect(screen.queryByText("/review")).toBeNull();
      expect(screen.queryByText("/help")).toBeNull();
      expect(screen.queryByText("/clear")).toBeNull();
    });

    it("shows all commands when input is just /", () => {
      const { onSelect, onClose, onSelectedIndexChange } = createMockCallbacks();

      render(
        <SlashCommandAutocomplete
          commands={testCommands}
          inputValue="/"
          isVisible={true}
          onSelect={onSelect}
          onClose={onClose}
          selectedIndex={0}
          onSelectedIndexChange={onSelectedIndexChange}
        />
      );

      const options = screen.getAllByRole("option");
      expect(options.length).toBe(6);
    });

    it("sorts filtered commands alphabetically", () => {
      const { onSelect, onClose, onSelectedIndexChange } = createMockCallbacks();

      render(
        <SlashCommandAutocomplete
          commands={testCommands}
          inputValue="/c"
          isVisible={true}
          onSelect={onSelect}
          onClose={onClose}
          selectedIndex={0}
          onSelectedIndexChange={onSelectedIndexChange}
        />
      );

      const options = screen.getAllByRole("option");
      const names = options.map(
        (opt) => opt.querySelector(".slash-autocomplete__name")?.textContent
      );

      // /clear, /commit, /compact, /config (alphabetical)
      expect(names).toEqual(["/clear", "/commit", "/compact", "/config"]);
    });
  });

  describe("selection and highlighting", () => {
    it("highlights the selected item with aria-selected", () => {
      const { onSelect, onClose, onSelectedIndexChange } = createMockCallbacks();

      render(
        <SlashCommandAutocomplete
          commands={testCommands}
          inputValue="/"
          isVisible={true}
          onSelect={onSelect}
          onClose={onClose}
          selectedIndex={1}
          onSelectedIndexChange={onSelectedIndexChange}
        />
      );

      const options = screen.getAllByRole("option");
      expect(options[0].getAttribute("aria-selected")).toBe("false");
      expect(options[1].getAttribute("aria-selected")).toBe("true");
    });

    it("applies selected class to highlighted item", () => {
      const { onSelect, onClose, onSelectedIndexChange } = createMockCallbacks();

      render(
        <SlashCommandAutocomplete
          commands={testCommands}
          inputValue="/"
          isVisible={true}
          onSelect={onSelect}
          onClose={onClose}
          selectedIndex={2}
          onSelectedIndexChange={onSelectedIndexChange}
        />
      );

      const options = screen.getAllByRole("option");
      expect(options[2].classList.contains("slash-autocomplete__item--selected")).toBe(
        true
      );
    });
  });

  describe("click interactions", () => {
    it("calls onSelect when item is clicked", () => {
      const { calls, onSelect, onClose, onSelectedIndexChange } = createMockCallbacks();

      render(
        <SlashCommandAutocomplete
          commands={testCommands}
          inputValue="/"
          isVisible={true}
          onSelect={onSelect}
          onClose={onClose}
          selectedIndex={0}
          onSelectedIndexChange={onSelectedIndexChange}
        />
      );

      // Click on /commit (first alphabetically after /clear)
      const commitOption = screen.getByText("/commit").closest('[role="option"]');
      fireEvent.click(commitOption!);

      expect(calls.onSelect.length).toBe(1);
      expect(calls.onSelect[0].name).toBe("/commit");
    });

    it("updates selectedIndex on mouse enter", () => {
      const { calls, onSelect, onClose, onSelectedIndexChange } = createMockCallbacks();

      render(
        <SlashCommandAutocomplete
          commands={testCommands}
          inputValue="/"
          isVisible={true}
          onSelect={onSelect}
          onClose={onClose}
          selectedIndex={0}
          onSelectedIndexChange={onSelectedIndexChange}
        />
      );

      const options = screen.getAllByRole("option");
      fireEvent.mouseEnter(options[2]);

      expect(calls.onSelectedIndexChange).toContain(2);
    });
  });

  describe("ARIA accessibility", () => {
    it("has role=listbox on container", () => {
      const { onSelect, onClose, onSelectedIndexChange } = createMockCallbacks();

      render(
        <SlashCommandAutocomplete
          commands={testCommands}
          inputValue="/"
          isVisible={true}
          onSelect={onSelect}
          onClose={onClose}
          selectedIndex={0}
          onSelectedIndexChange={onSelectedIndexChange}
        />
      );

      expect(screen.getByRole("listbox")).toBeDefined();
    });

    it("has role=option on each item", () => {
      const { onSelect, onClose, onSelectedIndexChange } = createMockCallbacks();

      render(
        <SlashCommandAutocomplete
          commands={testCommands}
          inputValue="/"
          isVisible={true}
          onSelect={onSelect}
          onClose={onClose}
          selectedIndex={0}
          onSelectedIndexChange={onSelectedIndexChange}
        />
      );

      const options = screen.getAllByRole("option");
      expect(options.length).toBe(6);
    });

    it("has aria-label on listbox", () => {
      const { onSelect, onClose, onSelectedIndexChange } = createMockCallbacks();

      render(
        <SlashCommandAutocomplete
          commands={testCommands}
          inputValue="/"
          isVisible={true}
          onSelect={onSelect}
          onClose={onClose}
          selectedIndex={0}
          onSelectedIndexChange={onSelectedIndexChange}
        />
      );

      expect(screen.getByLabelText("Slash commands")).toBeDefined();
    });

    it("has aria-activedescendant pointing to selected option", () => {
      const { onSelect, onClose, onSelectedIndexChange } = createMockCallbacks();

      render(
        <SlashCommandAutocomplete
          commands={testCommands}
          inputValue="/"
          isVisible={true}
          onSelect={onSelect}
          onClose={onClose}
          selectedIndex={1}
          onSelectedIndexChange={onSelectedIndexChange}
        />
      );

      const listbox = screen.getByRole("listbox");
      const activeDescendant = listbox.getAttribute("aria-activedescendant");
      expect(activeDescendant).toContain("-option-1");
    });

    it("announces command count to screen readers", () => {
      const { onSelect, onClose, onSelectedIndexChange } = createMockCallbacks();

      render(
        <SlashCommandAutocomplete
          commands={testCommands}
          inputValue="/c"
          isVisible={true}
          onSelect={onSelect}
          onClose={onClose}
          selectedIndex={0}
          onSelectedIndexChange={onSelectedIndexChange}
        />
      );

      // Should announce "4 commands available"
      expect(screen.getByText("4 commands available")).toBeDefined();
    });

    it("uses singular form for single command", () => {
      const { onSelect, onClose, onSelectedIndexChange } = createMockCallbacks();

      render(
        <SlashCommandAutocomplete
          commands={[{ name: "/help", description: "Help" }]}
          inputValue="/"
          isVisible={true}
          onSelect={onSelect}
          onClose={onClose}
          selectedIndex={0}
          onSelectedIndexChange={onSelectedIndexChange}
        />
      );

      expect(screen.getByText("1 command available")).toBeDefined();
    });
  });

  describe("content display", () => {
    it("displays command name and description", () => {
      const { onSelect, onClose, onSelectedIndexChange } = createMockCallbacks();

      render(
        <SlashCommandAutocomplete
          commands={testCommands}
          inputValue="/"
          isVisible={true}
          onSelect={onSelect}
          onClose={onClose}
          selectedIndex={0}
          onSelectedIndexChange={onSelectedIndexChange}
        />
      );

      expect(screen.getByText("/commit")).toBeDefined();
      expect(screen.getByText("Create a git commit")).toBeDefined();
    });
  });
});

describe("useSlashCommandNavigation hook", () => {
  // Test component that uses the hook
  function TestComponent({
    commands,
    onSelectIndex,
    onClose,
    isVisible,
  }: {
    commands: SlashCommand[];
    onSelectIndex: (index: number) => void;
    onClose: () => void;
    isVisible: boolean;
  }) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    const { handleKeyDown } = useSlashCommandNavigation(
      commands.length,
      selectedIndex,
      setSelectedIndex,
      onSelectIndex,
      onClose,
      isVisible
    );

    return (
      <div>
        <textarea
          data-testid="input"
          onKeyDown={(e) => handleKeyDown(e)}
        />
        <span data-testid="selected">{selectedIndex}</span>
      </div>
    );
  }

  it("moves selection down on ArrowDown", () => {
    const onSelectIndex = () => {};
    const onClose = () => {};

    render(
      <TestComponent
        commands={testCommands}
        onSelectIndex={onSelectIndex}
        onClose={onClose}
        isVisible={true}
      />
    );

    const input = screen.getByTestId("input");
    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(screen.getByTestId("selected").textContent).toBe("1");
  });

  it("wraps to first item when at end and pressing ArrowDown", () => {
    const onSelectIndex = () => {};
    const onClose = () => {};

    // Use only 2 commands for easier testing
    const twoCommands = testCommands.slice(0, 2);

    render(
      <TestComponent
        commands={twoCommands}
        onSelectIndex={onSelectIndex}
        onClose={onClose}
        isVisible={true}
      />
    );

    const input = screen.getByTestId("input");

    // Move down twice (0 -> 1 -> 0)
    fireEvent.keyDown(input, { key: "ArrowDown" }); // 0 -> 1
    fireEvent.keyDown(input, { key: "ArrowDown" }); // 1 -> 0 (wrap)

    expect(screen.getByTestId("selected").textContent).toBe("0");
  });

  it("moves selection up on ArrowUp", () => {
    const onSelectIndex = () => {};
    const onClose = () => {};

    render(
      <TestComponent
        commands={testCommands}
        onSelectIndex={onSelectIndex}
        onClose={onClose}
        isVisible={true}
      />
    );

    const input = screen.getByTestId("input");

    // First move down, then up
    fireEvent.keyDown(input, { key: "ArrowDown" }); // 0 -> 1
    fireEvent.keyDown(input, { key: "ArrowUp" }); // 1 -> 0

    expect(screen.getByTestId("selected").textContent).toBe("0");
  });

  it("wraps to last item when at first and pressing ArrowUp", () => {
    const onSelectIndex = () => {};
    const onClose = () => {};

    const twoCommands = testCommands.slice(0, 2);

    render(
      <TestComponent
        commands={twoCommands}
        onSelectIndex={onSelectIndex}
        onClose={onClose}
        isVisible={true}
      />
    );

    const input = screen.getByTestId("input");
    fireEvent.keyDown(input, { key: "ArrowUp" }); // 0 -> 1 (wrap to last)

    expect(screen.getByTestId("selected").textContent).toBe("1");
  });

  it("calls onSelect with index on Enter", () => {
    const selectCalls: number[] = [];
    const onSelectIndex = (index: number) => selectCalls.push(index);
    const onClose = () => {};

    render(
      <TestComponent
        commands={testCommands}
        onSelectIndex={onSelectIndex}
        onClose={onClose}
        isVisible={true}
      />
    );

    const input = screen.getByTestId("input");
    fireEvent.keyDown(input, { key: "ArrowDown" }); // Move to index 1
    fireEvent.keyDown(input, { key: "Enter" });

    expect(selectCalls).toContain(1);
  });

  it("calls onSelect with index on Tab", () => {
    const selectCalls: number[] = [];
    const onSelectIndex = (index: number) => selectCalls.push(index);
    const onClose = () => {};

    render(
      <TestComponent
        commands={testCommands}
        onSelectIndex={onSelectIndex}
        onClose={onClose}
        isVisible={true}
      />
    );

    const input = screen.getByTestId("input");
    fireEvent.keyDown(input, { key: "Tab" });

    expect(selectCalls).toContain(0);
  });

  it("calls onClose on Escape", () => {
    const onSelectIndex = () => {};
    const closeCalls: boolean[] = [];
    const onClose = () => closeCalls.push(true);

    render(
      <TestComponent
        commands={testCommands}
        onSelectIndex={onSelectIndex}
        onClose={onClose}
        isVisible={true}
      />
    );

    const input = screen.getByTestId("input");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(closeCalls.length).toBe(1);
  });

  it("does not handle keys when not visible", () => {
    const selectCalls: number[] = [];
    const onSelectIndex = (index: number) => selectCalls.push(index);
    const closeCalls: boolean[] = [];
    const onClose = () => closeCalls.push(true);

    render(
      <TestComponent
        commands={testCommands}
        onSelectIndex={onSelectIndex}
        onClose={onClose}
        isVisible={false}
      />
    );

    const input = screen.getByTestId("input");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Escape" });

    // None of the handlers should be called
    expect(selectCalls.length).toBe(0);
    expect(closeCalls.length).toBe(0);
    expect(screen.getByTestId("selected").textContent).toBe("0"); // Unchanged
  });

  it("does not handle keys when command list is empty", () => {
    const selectCalls: number[] = [];
    const onSelectIndex = (index: number) => selectCalls.push(index);
    const closeCalls: boolean[] = [];
    const onClose = () => closeCalls.push(true);

    render(
      <TestComponent
        commands={[]}
        onSelectIndex={onSelectIndex}
        onClose={onClose}
        isVisible={true}
      />
    );

    const input = screen.getByTestId("input");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    // Handlers should not be called for empty list
    expect(selectCalls.length).toBe(0);
    expect(screen.getByTestId("selected").textContent).toBe("0");
  });
});
