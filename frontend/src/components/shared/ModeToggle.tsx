/**
 * Mode Toggle Component
 *
 * Segmented control for switching between Note, Discussion, and Browse modes.
 * Touch-friendly with 44px minimum height.
 */

import { useSession, type AppMode } from "../../contexts/SessionContext";
import "./ModeToggle.css";

/**
 * Props for ModeToggle component.
 */
export interface ModeToggleProps {
  /** Optional disabled state */
  disabled?: boolean;
}

/**
 * Mode option definition.
 */
interface ModeOption {
  value: AppMode;
  label: string;
  sigil: string;
}

/**
 * Available mode options.
 */
const modes: ModeOption[] = [
  { value: "home", label: "Ground", sigil: "🪨" },
  { value: "note", label: "Capture", sigil: "🪶" },
  { value: "discussion", label: "Think", sigil: "✨" },
  { value: "browse", label: "Recall", sigil: "🪞" },
];

/**
 * Segmented control for switching between Note, Discussion, and Browse modes.
 *
 * - Three segments with visual highlight on selected
 * - 44px minimum height for touch targets
 * - Calls setMode from SessionContext on selection
 */
export function ModeToggle({ disabled = false }: ModeToggleProps): React.ReactNode {
  const { mode, setMode } = useSession();

  function handleClick(newMode: AppMode) {
    if (!disabled && newMode !== mode) {
      setMode(newMode);
    }
  }

  return (
    <div className="mode-toggle" role="tablist" aria-label="Application mode">
      {modes.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={mode === option.value}
          className={`mode-toggle__segment ${
            mode === option.value ? "mode-toggle__segment--selected" : ""
          }`}
          onClick={() => handleClick(option.value)}
          disabled={disabled}
        >
          <span className="mode-toggle__sigil" aria-hidden="true">
            {option.sigil}
          </span>
          <span className="mode-toggle__label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
