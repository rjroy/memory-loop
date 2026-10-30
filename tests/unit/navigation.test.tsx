import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '../../src/App';

const placeholders = [
  ['Ground', '/ground', 'An overview built from interchangeable panels.', "Panels aren't available yet", "Panel contents haven't been chosen. This preview doesn't display vault information."],
  ['Capture', '/capture', 'Save thoughts as timestamped entries in a daily Markdown note.', "Quick capture isn't available yet", 'Note entry and saving are not available in this preview.'],
  ['Think', '/think', 'Discuss ideas with AI using vault context.', "AI chat isn't available yet", "This preview can't send messages or access vault context."],
] as const;

const destinations = [...placeholders.map(([name, path]) => [name, path]), ['Recall', '/recall']];

describe('shell navigation', () => {
  it('exposes ordered links, skip link and page semantics, and focuses the new heading', async () => {
    window.history.replaceState(null, '', '/ground');
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const links = within(nav).getAllByRole('link');
    expect(links.map(link => [link.textContent?.trim(), link.getAttribute('href')])).toEqual(destinations);
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', expect.stringMatching(/^#/));
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(links[0]).toHaveAttribute('aria-current', 'page');
    await userEvent.click(within(nav).getByRole('link', { name: 'Capture' }));
    expect(within(nav).getByRole('link', { name: 'Capture' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1, name: 'Capture' })).toHaveFocus();
    expect(document.title).toBe('Capture · Memory Loop');
  });

  it.each(placeholders)('%s shows the approved honest placeholder', (name, path, purpose, heading, body) => {
    window.history.replaceState(null, '', path);
    render(<App />);
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name })).toBeInTheDocument();
    expect(within(main).getByText(purpose)).toBeInTheDocument();
    expect(within(main).getByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
    expect(within(main).getByText(body)).toBeInTheDocument();
    expect(within(main).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(main).queryByRole('button')).not.toBeInTheDocument();
    expect(main.querySelector('form, input, textarea, select')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Vault files' })).not.toBeInTheDocument();
    if (name === 'Ground') expect(within(main).getByRole('link', { name: 'Open Capture' })).toHaveAttribute('href', '/capture');
  });

  it('recovers from an unknown address without selecting a destination', async () => {
    window.history.replaceState(null, '', '/missing');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByText("This address doesn't match a Memory Loop view.")).toBeInTheDocument();
    expect(document.title).toBe('Page not found · Memory Loop');
    expect(within(screen.getByRole('navigation', { name: 'Primary' })).queryByRole('link', { current: 'page' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Go to Ground' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Ground' })).toBeInTheDocument();
  });
});
