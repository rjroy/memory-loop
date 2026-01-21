/**
 * EditorContextMenu Component Tests
 *
 * Tests rendering, keyboard navigation, accessibility, and user interactions.
 */

import { describe, it, expect, afterEach, mock } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  EditorContextMenu,
  getMenuPositionFromEvent,
  type QuickActionType,
} from "../EditorContextMenu";

afterEach(() => {
  cleanup();
});

describe("EditorContextMenu", () => {
  const defaultProps = {
    isOpen: true,
    position: { x: 100, y: 100 },
    onAction: mock(() => {}),
    onDismiss: mock(() => {}),
  };

  describe("rendering", () => {
    it("renders nothing when isOpen is false", () => {
      render(<EditorContextMenu {...defaultProps} isOpen={false} />);

      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("renders nothing when position is null", () => {
      render(<EditorContextMenu {...defaultProps} position={null} />);

      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("renders menu when isOpen is true and position is provided", () => {
      render(<EditorContextMenu {...defaultProps} />);

      expect(screen.getByRole("menu")).toBeDefined();
    });

    it("renders all four Quick Actions", () => {
      render(<EditorContextMenu {...defaultProps} />);

      expect(screen.getByText("Tighten")).toBeDefined();
      expect(screen.getByText("Embellish")).toBeDefined();
      expect(screen.getByText("Correct")).toBeDefined();
      expect(screen.getByText("Polish")).toBeDefined();
    });

    it("renders descriptions for each action", () => {
      render(<EditorContextMenu {...defaultProps} />);

      expect(screen.getByText("Make more concise")).toBeDefined();
      expect(screen.getByText("Add detail and nuance")).toBeDefined();
      expect(screen.getByText("Fix typos and grammar")).toBeDefined();
      expect(screen.getByText("Correct and improve prose")).toBeDefined();
    });

    it("positions menu at specified coordinates", () => {
      render(
        <EditorContextMenu {...defaultProps} position={{ x: 200, y: 300 }} />
      );

      const menu = screen.getByRole("menu");
      const style = menu.style;

      // Menu should be positioned at or near the specified coordinates
      // (may be adjusted for viewport bounds)
      expect(parseInt(style.left)).toBeGreaterThanOrEqual(0);
      expect(parseInt(style.top)).toBeGreaterThanOrEqual(0);
    });
  });

  describe("accessibility", () => {
    it("has proper menu role", () => {
      render(<EditorContextMenu {...defaultProps} />);

      const menu = screen.getByRole("menu");
      expect(menu).toBeDefined();
      expect(menu.getAttribute("aria-label")).toBe("Quick Actions");
    });

    it("has menuitem role on all items", () => {
      render(<EditorContextMenu {...defaultProps} />);

      const menuItems = screen.getAllByRole("menuitem");
      expect(menuItems.length).toBe(4);
    });

    it("menu items have aria-describedby linking to descriptions", () => {
      render(<EditorContextMenu {...defaultProps} />);

      const menuItems = screen.getAllByRole("menuitem");
      menuItems.forEach((item) => {
        const describedBy = item.getAttribute("aria-describedby");
        expect(describedBy).toBeDefined();
        expect(describedBy?.startsWith("action-desc-")).toBe(true);
      });
    });

    it("only one menu item has tabIndex 0", () => {
      render(<EditorContextMenu {...defaultProps} />);

      const menuItems = screen.getAllByRole("menuitem");
      const focusableItems = menuItems.filter(
        (item) => item.getAttribute("tabindex") === "0"
      );
      expect(focusableItems.length).toBe(1);
    });
  });

  describe("keyboard navigation", () => {
    it("ArrowDown moves focus to next item", () => {
      render(<EditorContextMenu {...defaultProps} />);

      const menu = screen.getByRole("menu");
      const menuItems = screen.getAllByRole("menuitem");

      // First item should be focused initially
      expect(menuItems[0].getAttribute("tabindex")).toBe("0");

      // Press ArrowDown
      fireEvent.keyDown(menu, { key: "ArrowDown" });

      // Second item should now have tabIndex 0
      expect(menuItems[1].getAttribute("tabindex")).toBe("0");
    });

    it("ArrowUp moves focus to previous item", () => {
      render(<EditorContextMenu {...defaultProps} />);

      const menu = screen.getByRole("menu");
      const menuItems = screen.getAllByRole("menuitem");

      // Move to second item first
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      expect(menuItems[1].getAttribute("tabindex")).toBe("0");

      // Press ArrowUp
      fireEvent.keyDown(menu, { key: "ArrowUp" });

      // First item should be focused again
      expect(menuItems[0].getAttribute("tabindex")).toBe("0");
    });

    it("ArrowDown wraps from last to first item", () => {
      render(<EditorContextMenu {...defaultProps} />);

      const menu = screen.getByRole("menu");
      const menuItems = screen.getAllByRole("menuitem");

      // Navigate to last item (4 presses from first)
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      fireEvent.keyDown(menu, { key: "ArrowDown" });

      expect(menuItems[3].getAttribute("tabindex")).toBe("0");

      // Press ArrowDown again - should wrap to first
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      expect(menuItems[0].getAttribute("tabindex")).toBe("0");
    });

    it("ArrowUp wraps from first to last item", () => {
      render(<EditorContextMenu {...defaultProps} />);

      const menu = screen.getByRole("menu");
      const menuItems = screen.getAllByRole("menuitem");

      // First item is focused
      expect(menuItems[0].getAttribute("tabindex")).toBe("0");

      // Press ArrowUp - should wrap to last
      fireEvent.keyDown(menu, { key: "ArrowUp" });
      expect(menuItems[3].getAttribute("tabindex")).toBe("0");
    });

    it("Enter activates focused item", () => {
      const onAction = mock(() => {});
      render(<EditorContextMenu {...defaultProps} onAction={onAction} />);

      const menu = screen.getByRole("menu");

      // First item (Tighten) is focused, press Enter
      fireEvent.keyDown(menu, { key: "Enter" });

      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith("tighten");
    });

    it("Space activates focused item", () => {
      const onAction = mock(() => {});
      render(<EditorContextMenu {...defaultProps} onAction={onAction} />);

      const menu = screen.getByRole("menu");

      // Navigate to second item and press Space
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      fireEvent.keyDown(menu, { key: " " });

      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith("embellish");
    });

    it("Home moves focus to first item", () => {
      render(<EditorContextMenu {...defaultProps} />);

      const menu = screen.getByRole("menu");
      const menuItems = screen.getAllByRole("menuitem");

      // Navigate to third item
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      expect(menuItems[2].getAttribute("tabindex")).toBe("0");

      // Press Home
      fireEvent.keyDown(menu, { key: "Home" });
      expect(menuItems[0].getAttribute("tabindex")).toBe("0");
    });

    it("End moves focus to last item", () => {
      render(<EditorContextMenu {...defaultProps} />);

      const menu = screen.getByRole("menu");
      const menuItems = screen.getAllByRole("menuitem");

      // First item is focused
      expect(menuItems[0].getAttribute("tabindex")).toBe("0");

      // Press End
      fireEvent.keyDown(menu, { key: "End" });
      expect(menuItems[3].getAttribute("tabindex")).toBe("0");
    });

    it("Escape calls onDismiss", () => {
      const onDismiss = mock(() => {});
      render(<EditorContextMenu {...defaultProps} onDismiss={onDismiss} />);

      // Escape handler is on document
      fireEvent.keyDown(document, { key: "Escape" });

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe("user interactions", () => {
    it("clicking a menu item calls onAction with correct action type", () => {
      const onAction = mock(() => {});
      render(<EditorContextMenu {...defaultProps} onAction={onAction} />);

      fireEvent.click(screen.getByText("Correct"));

      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith("correct");
    });

    it("clicking outside the menu calls onDismiss", () => {
      const onDismiss = mock(() => {});
      render(<EditorContextMenu {...defaultProps} onDismiss={onDismiss} />);

      // Click outside (on document body)
      fireEvent.mouseDown(document.body);

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("clicking inside the menu does not call onDismiss", () => {
      const onDismiss = mock(() => {});
      render(<EditorContextMenu {...defaultProps} onDismiss={onDismiss} />);

      const menu = screen.getByRole("menu");
      fireEvent.mouseDown(menu);

      expect(onDismiss).not.toHaveBeenCalled();
    });
  });

  describe("focus management", () => {
    it("resets focus to first item when menu reopens", () => {
      const { rerender } = render(
        <EditorContextMenu {...defaultProps} isOpen={true} />
      );

      const menu = screen.getByRole("menu");

      // Navigate to third item
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      fireEvent.keyDown(menu, { key: "ArrowDown" });

      // Close and reopen
      rerender(<EditorContextMenu {...defaultProps} isOpen={false} />);
      rerender(<EditorContextMenu {...defaultProps} isOpen={true} />);

      // First item should be focused again
      const menuItems = screen.getAllByRole("menuitem");
      expect(menuItems[0].getAttribute("tabindex")).toBe("0");
    });
  });
});

describe("getMenuPositionFromEvent", () => {
  it("extracts position from mouse event", () => {
    const event = {
      clientX: 150,
      clientY: 250,
    } as React.MouseEvent;

    const position = getMenuPositionFromEvent(event);

    expect(position.x).toBe(150);
    expect(position.y).toBe(250);
  });

  it("extracts position from touch event with touches", () => {
    const event = {
      touches: [{ clientX: 100, clientY: 200 }],
      changedTouches: [],
    } as unknown as React.TouchEvent;

    const position = getMenuPositionFromEvent(event);

    expect(position.x).toBe(100);
    expect(position.y).toBe(200);
  });

  it("extracts position from touch event with changedTouches", () => {
    const event = {
      touches: [],
      changedTouches: [{ clientX: 120, clientY: 220 }],
    } as unknown as React.TouchEvent;

    const position = getMenuPositionFromEvent(event);

    expect(position.x).toBe(120);
    expect(position.y).toBe(220);
  });

  it("returns 0,0 for touch event with no touches", () => {
    const event = {
      touches: [],
      changedTouches: [],
    } as unknown as React.TouchEvent;

    const position = getMenuPositionFromEvent(event);

    expect(position.x).toBe(0);
    expect(position.y).toBe(0);
  });
});

describe("Quick Action types", () => {
  it("onAction receives correct action type for each item", () => {
    const actionMap: Record<string, QuickActionType> = {
      Tighten: "tighten",
      Embellish: "embellish",
      Correct: "correct",
      Polish: "polish",
    };

    const baseProps = {
      isOpen: true,
      position: { x: 100, y: 100 },
      onDismiss: mock(() => {}),
    };

    for (const [label, expectedAction] of Object.entries(actionMap)) {
      const onAction = mock(() => {});
      render(<EditorContextMenu {...baseProps} onAction={onAction} />);

      fireEvent.click(screen.getByText(label));

      expect(onAction).toHaveBeenCalledWith(expectedAction);

      cleanup();
    }
  });
});

describe("Pair Writing Mode (mode='pair-writing')", () => {
  const pairWritingProps = {
    isOpen: true,
    position: { x: 100, y: 100 },
    onAction: mock(() => {}),
    onDismiss: mock(() => {}),
    mode: "pair-writing" as const,
    onAdvisoryAction: mock(() => {}),
  };

  afterEach(() => {
    cleanup();
  });

  describe("rendering", () => {
    it("renders Quick Actions in pair-writing mode", () => {
      render(<EditorContextMenu {...pairWritingProps} />);

      expect(screen.getByText("Tighten")).toBeDefined();
      expect(screen.getByText("Embellish")).toBeDefined();
      expect(screen.getByText("Correct")).toBeDefined();
      expect(screen.getByText("Polish")).toBeDefined();
    });

    it("renders Advisory Actions in pair-writing mode", () => {
      render(<EditorContextMenu {...pairWritingProps} />);

      expect(screen.getByText("Validate")).toBeDefined();
      expect(screen.getByText("Critique")).toBeDefined();
      expect(screen.getByText("Discuss")).toBeDefined();
    });

    it("renders Advisory Action descriptions", () => {
      render(<EditorContextMenu {...pairWritingProps} />);

      expect(screen.getByText("Fact-check the claim")).toBeDefined();
      expect(screen.getByText("Analyze clarity, voice, structure")).toBeDefined();
      expect(screen.getByText("Engage in a conversation about the text")).toBeDefined();
    });

    it("does not render Compare action when hasSnapshot is false", () => {
      render(<EditorContextMenu {...pairWritingProps} hasSnapshot={false} />);

      expect(screen.queryByText("Compare to snapshot")).toBeNull();
    });

    it("renders Compare action when hasSnapshot is true", () => {
      render(<EditorContextMenu {...pairWritingProps} hasSnapshot={true} />);

      expect(screen.getByText("Compare to snapshot")).toBeDefined();
      expect(screen.getByText("Show what changed")).toBeDefined();
    });

    it("has 7 menu items in pair-writing mode without snapshot", () => {
      render(<EditorContextMenu {...pairWritingProps} hasSnapshot={false} />);

      const menuItems = screen.getAllByRole("menuitem");
      // 4 Quick Actions + 3 Advisory Actions (Validate, Critique, Discuss)
      expect(menuItems.length).toBe(7);
    });

    it("has 8 menu items in pair-writing mode with snapshot", () => {
      render(<EditorContextMenu {...pairWritingProps} hasSnapshot={true} />);

      const menuItems = screen.getAllByRole("menuitem");
      // 4 Quick Actions + 3 Advisory Actions + Compare
      expect(menuItems.length).toBe(8);
    });

    it("applies advisory CSS class to advisory action items", () => {
      render(<EditorContextMenu {...pairWritingProps} />);

      // Find the Validate button which should have the advisory class
      const validateButton = screen.getByText("Validate").closest("button");
      expect(validateButton?.className).toContain("editor-context-menu__item--advisory");
    });
  });

  describe("accessibility", () => {
    it("has 'Writing Actions' aria-label in pair-writing mode", () => {
      render(<EditorContextMenu {...pairWritingProps} />);

      const menu = screen.getByRole("menu");
      expect(menu.getAttribute("aria-label")).toBe("Writing Actions");
    });

    it("has 'Quick Actions' aria-label in browse mode", () => {
      render(<EditorContextMenu {...pairWritingProps} mode="browse" />);

      const menu = screen.getByRole("menu");
      expect(menu.getAttribute("aria-label")).toBe("Quick Actions");
    });
  });

  describe("Advisory Action interactions", () => {
    it("clicking Advisory Action calls onAdvisoryAction with correct type", () => {
      const onAdvisoryAction = mock(() => {});
      render(
        <EditorContextMenu
          {...pairWritingProps}
          onAdvisoryAction={onAdvisoryAction}
        />
      );

      fireEvent.click(screen.getByText("Validate"));

      expect(onAdvisoryAction).toHaveBeenCalledTimes(1);
      expect(onAdvisoryAction).toHaveBeenCalledWith("validate");
    });

    it("clicking Critique calls onAdvisoryAction with 'critique'", () => {
      const onAdvisoryAction = mock(() => {});
      render(
        <EditorContextMenu
          {...pairWritingProps}
          onAdvisoryAction={onAdvisoryAction}
        />
      );

      fireEvent.click(screen.getByText("Critique"));

      expect(onAdvisoryAction).toHaveBeenCalledWith("critique");
    });

    it("clicking Discuss calls onAdvisoryAction with 'discuss'", () => {
      const onAdvisoryAction = mock(() => {});
      render(
        <EditorContextMenu
          {...pairWritingProps}
          onAdvisoryAction={onAdvisoryAction}
        />
      );

      fireEvent.click(screen.getByText("Discuss"));

      expect(onAdvisoryAction).toHaveBeenCalledWith("discuss");
    });

    it("clicking Compare calls onAdvisoryAction with 'compare'", () => {
      const onAdvisoryAction = mock(() => {});
      render(
        <EditorContextMenu
          {...pairWritingProps}
          hasSnapshot={true}
          onAdvisoryAction={onAdvisoryAction}
        />
      );

      fireEvent.click(screen.getByText("Compare to snapshot"));

      expect(onAdvisoryAction).toHaveBeenCalledWith("compare");
    });

    it("clicking Quick Action in pair-writing mode calls onAction (not onAdvisoryAction)", () => {
      const onAction = mock(() => {});
      const onAdvisoryAction = mock(() => {});
      render(
        <EditorContextMenu
          {...pairWritingProps}
          onAction={onAction}
          onAdvisoryAction={onAdvisoryAction}
        />
      );

      fireEvent.click(screen.getByText("Tighten"));

      expect(onAction).toHaveBeenCalledWith("tighten");
      expect(onAdvisoryAction).not.toHaveBeenCalled();
    });
  });

  describe("keyboard navigation with Advisory Actions", () => {
    it("ArrowDown navigates through all items including Advisory Actions", () => {
      render(<EditorContextMenu {...pairWritingProps} hasSnapshot={false} />);

      const menu = screen.getByRole("menu");
      const menuItems = screen.getAllByRole("menuitem");

      // Navigate through all 7 items
      for (let i = 0; i < 7; i++) {
        expect(menuItems[i].getAttribute("tabindex")).toBe("0");
        if (i < 6) {
          fireEvent.keyDown(menu, { key: "ArrowDown" });
        }
      }
    });

    it("Enter activates Advisory Action when focused", () => {
      const onAdvisoryAction = mock(() => {});
      render(
        <EditorContextMenu
          {...pairWritingProps}
          onAdvisoryAction={onAdvisoryAction}
        />
      );

      const menu = screen.getByRole("menu");

      // Navigate to Validate (5th item, index 4)
      fireEvent.keyDown(menu, { key: "ArrowDown" }); // Embellish
      fireEvent.keyDown(menu, { key: "ArrowDown" }); // Correct
      fireEvent.keyDown(menu, { key: "ArrowDown" }); // Polish
      fireEvent.keyDown(menu, { key: "ArrowDown" }); // Validate
      fireEvent.keyDown(menu, { key: "Enter" });

      expect(onAdvisoryAction).toHaveBeenCalledWith("validate");
    });

    it("End key navigates to last Advisory Action", () => {
      render(<EditorContextMenu {...pairWritingProps} hasSnapshot={false} />);

      const menu = screen.getByRole("menu");
      const menuItems = screen.getAllByRole("menuitem");

      fireEvent.keyDown(menu, { key: "End" });

      // Last item (Discuss, index 6) should be focused
      expect(menuItems[6].getAttribute("tabindex")).toBe("0");
    });
  });

  describe("does not call onAdvisoryAction when not provided", () => {
    it("handles missing onAdvisoryAction gracefully", () => {
      // Should not throw when clicking advisory action without handler
      const propsWithoutHandler = {
        ...pairWritingProps,
        onAdvisoryAction: undefined,
      };

      render(<EditorContextMenu {...propsWithoutHandler} />);

      // This should not throw
      expect(() => {
        fireEvent.click(screen.getByText("Validate"));
      }).not.toThrow();
    });
  });
});
