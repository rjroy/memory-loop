import { useEffect, useId, useState } from 'react';
import type { Ref } from 'react';

export default function FilesToggle({ expanded, active = true, onToggle, ref }: {
  expanded: boolean;
  active?: boolean;
  onToggle: () => void;
  ref: Ref<HTMLButtonElement>;
}) {
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const label = expanded ? 'Collapse files sidebar' : 'Expand files sidebar';
  const showTooltip = active && !dismissed && (hovered || focused);

  useEffect(() => {
    if (!active) { setHovered(false); setFocused(false); setDismissed(false); }
  }, [active]);

  useEffect(() => {
    if (!showTooltip) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
    };
    // A hovered label must also dismiss when keyboard focus is elsewhere.
    document.addEventListener('keydown', dismiss, true);
    return () => document.removeEventListener('keydown', dismiss, true);
  }, [showTooltip]);

  return <span className={`files-control${expanded ? ' files-control--collapse' : ''}`}
    onPointerEnter={() => { setHovered(true); setDismissed(false); }}
    onPointerLeave={() => setHovered(false)}>
    <button className="files-toggle" type="button" ref={ref} aria-label={label}
      aria-expanded={expanded} aria-controls="recall-files" aria-describedby={showTooltip ? tooltipId : undefined}
      onFocus={() => { setFocused(true); setDismissed(false); }} onBlur={() => setFocused(false)} onClick={onToggle}>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
        <path d={expanded ? 'm12 5-5 5 5 5' : 'm8 5 5 5-5 5'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
    {showTooltip && <span className="files-tooltip" role="tooltip" id={tooltipId}>{label}</span>}
  </span>;
}
