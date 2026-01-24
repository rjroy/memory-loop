/**
 * AskUserQuestionDialog Component
 *
 * Displays a dialog for Claude's AskUserQuestion tool.
 * Presents 1-4 questions with multiple choice options.
 * Users can select from predefined options or enter custom text via "Other".
 */

import React, { useState, useId, useCallback, useEffect } from "react";
import type { AskUserQuestionItem, AskUserQuestionOption } from "@memory-loop/shared";
import "./AskUserQuestionDialog.css";

export interface AskUserQuestionRequest {
  toolUseId: string;
  questions: AskUserQuestionItem[];
}

export interface AskUserQuestionDialogProps {
  request: AskUserQuestionRequest | null;
  onSubmit: (answers: Record<string, string>) => void;
  onCancel: () => void;
}

/**
 * Tracks the selected answer(s) for a single question.
 * For single-select: string value or empty
 * For multi-select: comma-separated values or empty
 */
interface QuestionAnswer {
  selectedOptions: string[];
  otherText: string;
  isOtherSelected: boolean;
}

/**
 * Creates initial answer state for all questions.
 */
function createInitialAnswers(questions: AskUserQuestionItem[]): Record<string, QuestionAnswer> {
  const answers: Record<string, QuestionAnswer> = {};
  for (const q of questions) {
    answers[q.question] = {
      selectedOptions: [],
      otherText: "",
      isOtherSelected: false,
    };
  }
  return answers;
}

/**
 * Checks if a question has been answered.
 */
function isQuestionAnswered(answer: QuestionAnswer): boolean {
  if (answer.isOtherSelected) {
    return answer.otherText.trim().length > 0;
  }
  return answer.selectedOptions.length > 0;
}

/**
 * Converts answer state to the format expected by the backend.
 */
function formatAnswers(answers: Record<string, QuestionAnswer>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [question, answer] of Object.entries(answers)) {
    if (answer.isOtherSelected && answer.otherText.trim()) {
      // Include "Other" selection with custom text
      const otherParts = [...answer.selectedOptions, answer.otherText.trim()];
      result[question] = otherParts.join(", ");
    } else {
      result[question] = answer.selectedOptions.join(", ");
    }
  }
  return result;
}

export function AskUserQuestionDialog({
  request,
  onSubmit,
  onCancel,
}: AskUserQuestionDialogProps): React.ReactNode {
  const titleId = useId();
  const [answers, setAnswers] = useState<Record<string, QuestionAnswer>>({});

  // Initialize answers when request changes
  useEffect(() => {
    if (request) {
      setAnswers(createInitialAnswers(request.questions));
    }
  }, [request]);

  const handleOptionChange = useCallback((
    question: string,
    optionLabel: string,
    multiSelect: boolean
  ) => {
    setAnswers(prev => {
      const current = prev[question];
      if (!current) return prev;

      let newSelectedOptions: string[];
      if (multiSelect) {
        // Toggle the option in multi-select mode
        if (current.selectedOptions.includes(optionLabel)) {
          newSelectedOptions = current.selectedOptions.filter(o => o !== optionLabel);
        } else {
          newSelectedOptions = [...current.selectedOptions, optionLabel];
        }
      } else {
        // Replace selection in single-select mode
        newSelectedOptions = [optionLabel];
      }

      return {
        ...prev,
        [question]: {
          ...current,
          selectedOptions: newSelectedOptions,
          isOtherSelected: false, // Deselect "Other" when selecting a predefined option
        },
      };
    });
  }, []);

  const handleOtherToggle = useCallback((question: string, multiSelect: boolean) => {
    setAnswers(prev => {
      const current = prev[question];
      if (!current) return prev;

      if (multiSelect) {
        // Toggle "Other" in multi-select mode
        return {
          ...prev,
          [question]: {
            ...current,
            isOtherSelected: !current.isOtherSelected,
          },
        };
      } else {
        // Select only "Other" in single-select mode
        return {
          ...prev,
          [question]: {
            ...current,
            selectedOptions: [],
            isOtherSelected: true,
          },
        };
      }
    });
  }, []);

  const handleOtherTextChange = useCallback((question: string, text: string) => {
    setAnswers(prev => {
      const current = prev[question];
      if (!current) return prev;

      return {
        ...prev,
        [question]: {
          ...current,
          otherText: text,
        },
      };
    });
  }, []);

  const handleSubmit = useCallback(() => {
    onSubmit(formatAnswers(answers));
  }, [answers, onSubmit]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  }, [onCancel]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onCancel();
    }
  }, [onCancel]);

  if (!request) return null;

  // Check if all questions have been answered
  const allAnswered = request.questions.every(q => {
    const answer = answers[q.question];
    return answer && isQuestionAnswered(answer);
  });

  return (
    <div
      className="ask-question__backdrop"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div
        className="ask-question"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="ask-question__header">
          <span className="ask-question__icon" aria-hidden="true">?</span>
          <h2 id={titleId} className="ask-question__title">
            Claude needs your input
          </h2>
        </div>

        <div className="ask-question__content">
          {request.questions.map((q, qIndex) => (
            <QuestionSection
              key={qIndex}
              question={q}
              answer={answers[q.question]}
              onOptionChange={handleOptionChange}
              onOtherToggle={handleOtherToggle}
              onOtherTextChange={handleOtherTextChange}
            />
          ))}
        </div>

        <div className="ask-question__actions">
          <button
            type="button"
            className="ask-question__btn ask-question__btn--cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="ask-question__btn ask-question__btn--submit"
            onClick={handleSubmit}
            disabled={!allAnswered}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders a single question with its options.
 */
interface QuestionSectionProps {
  question: AskUserQuestionItem;
  answer: QuestionAnswer | undefined;
  onOptionChange: (question: string, optionLabel: string, multiSelect: boolean) => void;
  onOtherToggle: (question: string, multiSelect: boolean) => void;
  onOtherTextChange: (question: string, text: string) => void;
}

function QuestionSection({
  question,
  answer,
  onOptionChange,
  onOtherToggle,
  onOtherTextChange,
}: QuestionSectionProps): React.ReactNode {
  const groupId = useId();

  if (!answer) return null;

  const inputType = question.multiSelect ? "checkbox" : "radio";

  return (
    <fieldset className="ask-question__fieldset">
      <legend className="ask-question__legend">
        <span className="ask-question__header-chip">{question.header}</span>
        <span className="ask-question__question-text">{question.question}</span>
      </legend>

      <div className="ask-question__options" role="group" aria-labelledby={groupId}>
        {question.options.map((option: AskUserQuestionOption, optIndex: number) => {
          const isSelected = answer.selectedOptions.includes(option.label);
          const inputId = `${groupId}-opt-${optIndex}`;

          return (
            <label
              key={optIndex}
              className={`ask-question__option ${isSelected ? "ask-question__option--selected" : ""}`}
              htmlFor={inputId}
            >
              <input
                type={inputType}
                id={inputId}
                name={groupId}
                checked={isSelected}
                onChange={() => onOptionChange(question.question, option.label, question.multiSelect)}
                className="ask-question__input"
              />
              <span className="ask-question__option-content">
                <span className="ask-question__option-label">{option.label}</span>
                {option.description && (
                  <span className="ask-question__option-desc">{option.description}</span>
                )}
              </span>
            </label>
          );
        })}

        {/* "Other" option */}
        <label
          className={`ask-question__option ask-question__option--other ${answer.isOtherSelected ? "ask-question__option--selected" : ""}`}
          htmlFor={`${groupId}-other`}
        >
          <input
            type={inputType}
            id={`${groupId}-other`}
            name={groupId}
            checked={answer.isOtherSelected}
            onChange={() => onOtherToggle(question.question, question.multiSelect)}
            className="ask-question__input"
          />
          <span className="ask-question__option-content">
            <span className="ask-question__option-label">Other</span>
            {answer.isOtherSelected && (
              <input
                type="text"
                className="ask-question__other-input"
                value={answer.otherText}
                onChange={(e) => onOtherTextChange(question.question, e.target.value)}
                placeholder="Enter your answer..."
                autoFocus
              />
            )}
          </span>
        </label>
      </div>
    </fieldset>
  );
}
