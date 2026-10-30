import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { TestPresentation } from './fixtures/presentation';

it.each(['Ground', 'Capture', 'Think', 'Recall'])('renders a replacement %s view without changing shell destinations', name => {
  window.history.replaceState(null, '', `/${name.toLowerCase()}`);
  render(<TestPresentation><h1>Replacement {name}</h1></TestPresentation>);
  expect(screen.getByRole('heading', { level: 1, name: `Replacement ${name}` })).toBeInTheDocument();
  const nav = screen.getByRole('navigation', { name: 'Primary' });
  for (const destination of ['Ground', 'Capture', 'Think', 'Recall']) {
    expect(within(nav).getByRole('link', { name: destination })).toHaveAttribute('href', `/${destination.toLowerCase()}`);
  }
});
