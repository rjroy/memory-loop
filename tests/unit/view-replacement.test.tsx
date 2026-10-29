import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import App from '../../src/App';

const selection = vi.hoisted(() => ({ name: '' }));
vi.mock('../../src/views/GroundView', async (original) => {
  const actual = await original<typeof import('../../src/views/GroundView')>();
  return { default: () => selection.name === 'Ground' ? <h1>Replacement Ground</h1> : <actual.default /> };
});
vi.mock('../../src/views/CaptureView', async (original) => {
  const actual = await original<typeof import('../../src/views/CaptureView')>();
  return { default: () => selection.name === 'Capture' ? <h1>Replacement Capture</h1> : <actual.default /> };
});
vi.mock('../../src/views/ThinkView', async (original) => {
  const actual = await original<typeof import('../../src/views/ThinkView')>();
  return { default: () => selection.name === 'Think' ? <h1>Replacement Think</h1> : <actual.default /> };
});
vi.mock('../../src/views/RecallView', async (original) => {
  const actual = await original<typeof import('../../src/views/RecallView')>();
  return { default: () => selection.name === 'Recall' ? <h1>Replacement Recall</h1> : <actual.default /> };
});

beforeEach(() => { selection.name = ''; });
it.each(['Ground', 'Capture', 'Think', 'Recall'])('replaces %s independently while other destinations remain reachable', async (name) => {
  selection.name = name;
  window.history.replaceState(null, '', `/${name.toLowerCase()}`);
  render(<App />);
  expect(screen.getByRole('heading', { level: 1, name: `Replacement ${name}` })).toBeInTheDocument();
  const nav = screen.getByRole('navigation');
  for (const other of ['Ground', 'Capture', 'Think', 'Recall'].filter(item => item !== name)) {
    await userEvent.click(within(nav).getByRole('link', { name: other }));
    expect(screen.getByRole('heading', { level: 1, name: other })).toBeInTheDocument();
  }
});
