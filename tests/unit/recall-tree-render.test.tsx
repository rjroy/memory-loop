import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { VaultEntry } from '../../backend/contract';
import VaultFiles from '../../src/recall/VaultFiles';

const leaf = (name: string, id: string[]): VaultEntry => ({ kind: 'note', name, id, identity: `i:${name}`, version: `v:${name}` });
const folder: VaultEntry = { kind: 'directory', name: 'Shelf', id: ['Shelf'], identity: 'shelf-id', version: 'shelf-version', children: [
  leaf('Child.md', ['Shelf', 'Child.md']),
] };

it('mounts descendants only while their folder is expanded', () => {
  const toggle = vi.fn();
  const select = vi.fn();
  const { rerender } = render(<VaultFiles entries={[folder]} selected={null} expanded={new Set()} toggle={toggle} select={select} />);
  expect(screen.queryByText('Child.md')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Shelf' }));
  expect(toggle).toHaveBeenCalledWith('["Shelf"]');
  rerender(<VaultFiles entries={[folder]} selected={null} expanded={new Set(['["Shelf"]'])} toggle={toggle} select={select} />);
  expect(screen.getByRole('link', { name: 'Child.md' })).toHaveAttribute('href', expect.stringContaining('file='));
  rerender(<VaultFiles entries={[folder]} selected={null} expanded={new Set()} toggle={toggle} select={select} />);
  expect(screen.queryByText('Child.md')).not.toBeInTheDocument();
});

it('does not rerender unrelated visible rows when the selected file changes', () => {
  let reads = 0;
  const untouched = { ...leaf('Unchanged.md', ['Unchanged.md']), get name() { reads++; return 'Unchanged.md'; } } as VaultEntry;
  const entries = [leaf('One.md', ['One.md']), leaf('Two.md', ['Two.md']), untouched];
  const expanded = new Set<string>();
  const toggle = vi.fn();
  const select = vi.fn();
  const { rerender } = render(<VaultFiles entries={entries} selected='["One.md"]' expanded={expanded} toggle={toggle} select={select} />);
  expect(screen.getByRole('link', { name: 'One.md' })).toHaveAttribute('aria-current', 'page');
  reads = 0;
  rerender(<VaultFiles entries={entries} selected='["Two.md"]' expanded={expanded} toggle={toggle} select={select} />);
  expect(screen.getByRole('link', { name: 'Two.md' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'One.md' })).not.toHaveAttribute('aria-current');
  expect(reads).toBe(0);
});
