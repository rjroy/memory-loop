/**
 * Tests for AskUserQuestionDialog Component
 *
 * Tests rendering, minimize/maximize functionality, and answer submission.
 */

import { describe, it, expect, afterEach, mock } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import {
  AskUserQuestionDialog,
  type AskUserQuestionRequest,
} from "../AskUserQuestionDialog";

afterEach(() => {
  cleanup();
});

const mockRequest: AskUserQuestionRequest = {
  toolUseId: "test-tool-use-id",
  questions: [
    {
      question: "What is your energy level?",
      header: "Energy",
      multiSelect: false,
      options: [
        { label: "Sharp", description: "Ready for deep work" },
        { label: "Steady", description: "Normal energy" },
        { label: "Low", description: "Need easy wins" },
      ],
    },
  ],
};

describe("AskUserQuestionDialog", () => {
  describe("rendering", () => {
    it("returns null when request is null", () => {
      const onSubmit = mock(() => {});
      const onCancel = mock(() => {});

      const { container } = render(
        <AskUserQuestionDialog
          request={null}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it("renders dialog with backdrop when request is provided", () => {
      const onSubmit = mock(() => {});
      const onCancel = mock(() => {});

      render(
        <AskUserQuestionDialog
          request={mockRequest}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );

      expect(screen.getByText("Claude needs your input")).toBeTruthy();
      expect(screen.getByText("What is your energy level?")).toBeTruthy();
      expect(screen.getByText("Sharp")).toBeTruthy();
    });

    it("renders question options", () => {
      const onSubmit = mock(() => {});
      const onCancel = mock(() => {});

      render(
        <AskUserQuestionDialog
          request={mockRequest}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );

      expect(screen.getByText("Sharp")).toBeTruthy();
      expect(screen.getByText("Steady")).toBeTruthy();
      expect(screen.getByText("Low")).toBeTruthy();
      expect(screen.getByText("Other")).toBeTruthy();
    });
  });

  describe("minimize/maximize", () => {
    it("starts maximized by default", () => {
      const onSubmit = mock(() => {});
      const onCancel = mock(() => {});

      render(
        <AskUserQuestionDialog
          request={mockRequest}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );

      // Should show the full dialog with all options
      expect(screen.getByText("What is your energy level?")).toBeTruthy();
      expect(screen.getByLabelText("Minimize dialog")).toBeTruthy();
    });

    it("can start minimized with initialMinimized prop", () => {
      const onSubmit = mock(() => {});
      const onCancel = mock(() => {});

      render(
        <AskUserQuestionDialog
          request={mockRequest}
          onSubmit={onSubmit}
          onCancel={onCancel}
          initialMinimized={true}
        />
      );

      // Should show minimized bar, not the full question
      expect(screen.getByText("Claude needs your input")).toBeTruthy();
      expect(screen.queryByText("What is your energy level?")).toBeNull();
      expect(screen.getByLabelText("Expand dialog")).toBeTruthy();
    });

    it("minimizes when minimize button is clicked", () => {
      const onSubmit = mock(() => {});
      const onCancel = mock(() => {});

      render(
        <AskUserQuestionDialog
          request={mockRequest}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );

      // Start maximized
      expect(screen.getByText("What is your energy level?")).toBeTruthy();

      // Click minimize
      fireEvent.click(screen.getByLabelText("Minimize dialog"));

      // Should now be minimized
      expect(screen.queryByText("What is your energy level?")).toBeNull();
      expect(screen.getByLabelText("Expand dialog")).toBeTruthy();
    });

    it("maximizes when expand button is clicked", () => {
      const onSubmit = mock(() => {});
      const onCancel = mock(() => {});

      render(
        <AskUserQuestionDialog
          request={mockRequest}
          onSubmit={onSubmit}
          onCancel={onCancel}
          initialMinimized={true}
        />
      );

      // Start minimized
      expect(screen.queryByText("What is your energy level?")).toBeNull();

      // Click expand
      fireEvent.click(screen.getByLabelText("Expand dialog"));

      // Should now be maximized
      expect(screen.getByText("What is your energy level?")).toBeTruthy();
      expect(screen.getByLabelText("Minimize dialog")).toBeTruthy();
    });

    it("preserves selected answers when minimizing and maximizing", () => {
      const onSubmit = mock(() => {});
      const onCancel = mock(() => {});

      render(
        <AskUserQuestionDialog
          request={mockRequest}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );

      // Select an option
      fireEvent.click(screen.getByText("Sharp"));

      // Minimize
      fireEvent.click(screen.getByLabelText("Minimize dialog"));

      // Maximize
      fireEvent.click(screen.getByLabelText("Expand dialog"));

      // Option should still be selected
      const sharpOption = screen.getByText("Sharp").closest("label");
      expect(sharpOption?.classList.contains("ask-question__option--selected")).toBe(true);
    });
  });

  describe("cancel from minimized state", () => {
    it("can cancel from minimized state", () => {
      const onSubmit = mock(() => {});
      const onCancel = mock(() => {});

      render(
        <AskUserQuestionDialog
          request={mockRequest}
          onSubmit={onSubmit}
          onCancel={onCancel}
          initialMinimized={true}
        />
      );

      // Click cancel in minimized state
      fireEvent.click(screen.getByText("Cancel"));

      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe("submit button state", () => {
    it("submit button is disabled when no answer selected", () => {
      const onSubmit = mock(() => {});
      const onCancel = mock(() => {});

      render(
        <AskUserQuestionDialog
          request={mockRequest}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );

      const submitBtn = screen.getByText("Submit");
      expect(submitBtn.hasAttribute("disabled")).toBe(true);
    });

    it("submit button is enabled when answer is selected", () => {
      const onSubmit = mock(() => {});
      const onCancel = mock(() => {});

      render(
        <AskUserQuestionDialog
          request={mockRequest}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );

      // Select an option
      fireEvent.click(screen.getByText("Steady"));

      const submitBtn = screen.getByText("Submit");
      expect(submitBtn.hasAttribute("disabled")).toBe(false);
    });

    it("submits selected answer", () => {
      const onSubmit = mock(() => {});
      const onCancel = mock(() => {});

      render(
        <AskUserQuestionDialog
          request={mockRequest}
          onSubmit={onSubmit}
          onCancel={onCancel}
        />
      );

      // Select an option
      fireEvent.click(screen.getByText("Steady"));

      // Submit
      fireEvent.click(screen.getByText("Submit"));

      expect(onSubmit).toHaveBeenCalledWith({
        "What is your energy level?": "Steady",
      });
    });
  });
});
