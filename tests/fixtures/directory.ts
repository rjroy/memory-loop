import { isVaultDirectoryId, type VaultDirectoryResponse, type VaultEntry, type VaultId, type VaultTreeResponse } from '../../backend/contract';

/** Project a test-owned recursive tree without inventing folder identities. */
export function fixtureDirectory(tree: VaultTreeResponse, id: VaultId): VaultDirectoryResponse | null {
  let entries: VaultEntry[] = tree.entries;
  let directoryIdentity = tree.rootIdentity;
  for (const part of id) {
    const folder = entries.find(entry => entry.kind === 'directory' && entry.name === part);
    if (!folder || folder.kind !== 'directory') return null;
    directoryIdentity = folder.identity;
    entries = folder.children;
  }
  return { rootIdentity: tree.rootIdentity, directoryIdentity, id, entries: entries.map(entry => {
    if (entry.kind !== 'directory') return entry;
    const { children: _children, ...directory } = entry;
    return directory;
  }) };
}

export function fixtureDirectoryId(url: URL): VaultId | null {
  try {
    const values = url.searchParams.getAll('id');
    if (values.length !== 1 || [...url.searchParams.keys()].some(key => key !== 'id')) return null;
    const parsed: unknown = JSON.parse(values[0]);
    return isVaultDirectoryId(parsed) ? parsed : null;
  } catch { return null; }
}
