import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { TestPresentation } from './fixtures/presentation';

const conversationId = '11111111-1111-4111-8111-111111111111';
beforeEach(() => window.sessionStorage.removeItem('memory-loop.think.current'));
afterEach(() => window.sessionStorage.removeItem('memory-loop.think.current'));

it.each(['Ground', 'Capture', 'Think', 'Recall'])('renders a replacement %s view without changing shell destinations', name => {
  window.history.replaceState(null, '', name === 'Think' ? `/think?conversation=${conversationId}` : `/${name.toLowerCase()}`);
  render(<TestPresentation><h1>Replacement {name}</h1></TestPresentation>);
  expect(screen.getByRole('heading', { level: 1, name: `Replacement ${name}` })).toBeInTheDocument();
  const nav = screen.getByRole('navigation', { name: 'Primary' });
  for (const destination of ['Ground', 'Capture', 'Think', 'Recall']) {
    expect(within(nav).getByRole('link', { name: destination })).toHaveAttribute('href',
      destination === 'Think' && name === 'Think' ? `/think?conversation=${conversationId}` : `/${destination.toLowerCase()}`);
  }
});
