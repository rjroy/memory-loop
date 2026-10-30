import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import GroundView from '../../src/views/GroundView';
import CaptureView from '../../src/views/CaptureView';
import ThinkView from '../../src/views/ThinkView';
import NotFoundView from '../../src/views/NotFoundView';
import { TestPresentation } from './fixtures/presentation';

const placeholders = [
  ['Ground', '/ground', GroundView, 'An overview built from interchangeable panels.', "Panels aren't available yet", "Panel contents haven't been chosen. This preview doesn't display vault information."],
  ['Capture', '/capture', CaptureView, 'Save thoughts as timestamped entries in a daily Markdown note.', "Quick capture isn't available yet", 'Note entry and saving are not available in this preview.'],
  ['Think', '/think', ThinkView, 'Discuss ideas with AI using vault context.', "AI chat isn't available yet", "This preview can't send messages or access vault context."],
] as const;

describe('shell component semantics', () => {
  it.each(placeholders)('%s shows ordered navigation and its approved honest placeholder', (name, path, View, purpose, heading, body) => {
    window.history.replaceState(null, '', path);
    render(<TestPresentation><View /></TestPresentation>);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getAllByRole('link').map(link => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([
      ['Ground', '/ground'], ['Capture', '/capture'], ['Think', '/think'], ['Recall', '/recall'],
    ]);
    expect(within(nav).getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name })).toBeInTheDocument();
    expect(within(main).getByText(purpose)).toBeInTheDocument();
    expect(within(main).getByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
    expect(within(main).getByText(body)).toBeInTheDocument();
    expect(main.querySelector('form, input, textarea, select')).toBeNull();
    if (name === 'Ground') expect(within(main).getByRole('link', { name: 'Open Capture' })).toHaveAttribute('href', '/capture');
  });

  it('offers an unknown-address recovery link without selecting a destination', () => {
    window.history.replaceState(null, '', '/missing');
    render(<TestPresentation><NotFoundView /></TestPresentation>);
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByText("This address doesn't match a Memory Loop view.")).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Primary' })).queryByRole('link', { current: 'page' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Ground' })).toHaveAttribute('href', '/ground');
  });
});
