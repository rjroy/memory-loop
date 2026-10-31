import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GroundView from '../../src/views/GroundView';
import CaptureView from '../../src/views/CaptureView';
import ThinkView from '../../src/views/ThinkView';
import NotFoundView from '../../src/views/NotFoundView';
import { TestPresentation } from './fixtures/presentation';

beforeEach(() => window.sessionStorage.removeItem('memory-loop.think.current'));
afterEach(() => window.sessionStorage.removeItem('memory-loop.think.current'));

describe('shell component semantics', () => {
  it('shows ordered navigation and the honest Ground placeholder', () => {
    window.history.replaceState(null, '', '/ground');
    render(<TestPresentation><GroundView /></TestPresentation>);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getAllByRole('link').map(link => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([
      ['Ground', '/ground'], ['Capture', '/capture'], ['Think', '/think'], ['Recall', '/recall'],
    ]);
    expect(within(nav).getByRole('link', { name: 'Ground' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Ground' })).toBeInTheDocument();
    expect(within(main).getByText('An overview built from interchangeable panels.')).toBeInTheDocument();
    expect(within(main).getByRole('heading', { level: 2, name: "Panels aren't available yet" })).toBeInTheDocument();
    expect(within(main).getByText("Panel contents haven't been chosen. This preview doesn't display vault information.")).toBeInTheDocument();
    expect(main.querySelector('form, input, textarea, select')).toBeNull();
    expect(within(main).getByRole('link', { name: 'Open Capture' })).toHaveAttribute('href', '/capture');
  });

  it('keeps shell navigation and accessible editor focus on the live Capture route', () => {
    window.history.replaceState(null, '', '/capture');
    const historyLength = window.history.length;
    render(<TestPresentation><CaptureView /></TestPresentation>);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getAllByRole('link').map(link => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([
      ['Ground', '/ground'], ['Capture', '/capture'], ['Think', '/think'], ['Recall', '/recall'],
    ]);
    expect(within(nav).getByRole('link', { name: 'Capture' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Capture' })).toBeInTheDocument();
    const editor = within(main).getByRole('textbox', { name: 'Thought' });
    expect(editor).toBeEnabled();
    expect(editor).not.toHaveFocus();
    editor.focus();
    expect(editor).toHaveFocus();
    expect(window.history.length).toBe(historyLength);
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
