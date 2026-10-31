import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GroundView from '../../src/views/GroundView';
import CaptureView from '../../src/views/CaptureView';
import ThinkView from '../../src/views/ThinkView';
import NotFoundView from '../../src/views/NotFoundView';
import { TestPresentation } from './fixtures/presentation';

const placeholders = [
  ['Ground', '/ground', GroundView, 'An overview built from interchangeable panels.', "Panels aren't available yet", "Panel contents haven't been chosen. This preview doesn't display vault information."],
  ['Capture', '/capture', CaptureView, 'Save thoughts as timestamped entries in a daily Markdown note.', "Quick capture isn't available yet", 'Note entry and saving are not available in this preview.'],
] as const;
beforeEach(() => window.sessionStorage.removeItem('memory-loop.think.current'));
afterEach(() => window.sessionStorage.removeItem('memory-loop.think.current'));

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

  it('keeps shell navigation and accessible message composition on the live Think route', () => {
    const current = '11111111-1111-4111-8111-111111111111';
    window.sessionStorage.setItem('memory-loop.think.current', '22222222-2222-4222-8222-222222222222');
    window.history.replaceState(null, '', `/think?conversation=${current}`);
    const historyLength = window.history.length;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fixture offline')));
    render(<TestPresentation><ThinkView /></TestPresentation>);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getAllByRole('link').map(link => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([
      ['Ground', '/ground'], ['Capture', '/capture'], ['Think', `/think?conversation=${current}`], ['Recall', '/recall'],
    ]);
    expect(within(nav).getByRole('link', { name: 'Think' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Think' })).toBeInTheDocument();
    const editor = within(main).getByRole('textbox', { name: 'Message' });
    expect(editor).toBeEnabled();
    editor.focus();
    expect(editor).toHaveFocus();
    expect(window.history.length).toBe(historyLength);
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
