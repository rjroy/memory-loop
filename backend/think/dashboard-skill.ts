import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openSafeRoot, type SafeRoot } from '../safe-fs';

const components = ['.opencode', 'skills', 'memory-loop-dashboard-setup'] as const;
const target = [...components, 'SKILL.md'];
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const missing = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
const exists = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';

async function checkedBytes(root: SafeRoot, path: readonly string[], limit: number): Promise<Buffer> {
  const file = await root.openFile(path, 'read');
  try {
    const info = await file.stat();
    if (info.nlink !== 1 || info.size > limit) throw new Error('Unsafe managed skill file');
    const bytes = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    if (offset > limit) throw new Error('Oversized managed skill file');
    return bytes.subarray(0, offset);
  } finally { await file.close(); }
}

async function directory(root: SafeRoot, path: readonly string[]): Promise<boolean> {
  try { await root.createDirectory(path); return true; }
  catch (error) {
    if (!exists(error)) throw error;
    await root.resolve(path, 'directory');
    return false;
  }
}

async function exclusiveWrite(root: SafeRoot, path: readonly string[], bytes: Uint8Array): Promise<void> {
  const file = await root.createFile(path);
  try { await file.chmod(0o600); await file.writeFile(bytes); await file.sync(); }
  finally { await file.close(); }
  await root.syncDirectory(path.slice(0, -1));
}

/** Installs only into a directory created by this installation. A private digest
 * records the last managed bytes; missing or changed ownership always fails closed. */
export async function installDashboardSkill(vaultDirectory: string, projectRoot: string): Promise<'installed' | 'updated' | 'unchanged' | 'conflict'> {
  const vault = await openSafeRoot(vaultDirectory);
  const state = await openSafeRoot(projectRoot);
  await state.resolve(['.memory-loop'], 'directory');
  const manifest = ['.memory-loop', `dashboard-skill-${digest(vault.path)}.json`];
  const bundle = await readFile(new URL('./dashboard-skill/SKILL.md', import.meta.url));
  if (!bundle.length || bundle.length > 65536) throw new Error('Invalid bundled dashboard skill');
  const desired = digest(bundle);
  let previous: string | undefined;
  let manifestDigest: string | undefined;
  try {
    const bytes = await checkedBytes(state, manifest, 1024);
    manifestDigest = digest(bytes);
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || !('digest' in parsed) || typeof parsed.digest !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.digest)) throw new Error('Invalid managed skill record');
    previous = parsed.digest;
  } catch (error) { if (!missing(error)) throw error; }

  await directory(vault, components.slice(0, 1));
  await directory(vault, components.slice(0, 2));
  const created = await directory(vault, components);
  const record = Buffer.from(JSON.stringify({ digest: desired }) + '\n');
  if (created) {
    await exclusiveWrite(vault, target, bundle);
    if (previous === undefined) await exclusiveWrite(state, manifest, record);
    else await state.replaceFile(manifest, record, { validate: async () => {
      if (digest(await checkedBytes(vault, target, 65536)) !== desired) throw new Error('Managed skill changed');
      if (digest(await checkedBytes(state, manifest, 1024)) !== manifestDigest) throw new Error('Managed skill record changed');
    } });
    return 'installed';
  }
  if (previous === undefined) return 'conflict';
  let current: string;
  try { current = digest(await checkedBytes(vault, target, 65536)); }
  catch (error) { if (missing(error)) return 'conflict'; throw error; }
  if (current !== previous) return 'conflict';
  if (current === desired) return 'unchanged';
  await vault.replaceFile(target, bundle, { validate: async () => {
    if (digest(await checkedBytes(vault, target, 65536)) !== previous) throw new Error('Managed skill changed');
  } });
  await state.replaceFile(manifest, record, { validate: async () => {
    if (digest(await checkedBytes(vault, target, 65536)) !== desired) throw new Error('Managed skill changed');
    if (digest(await checkedBytes(state, manifest, 1024)) !== manifestDigest) throw new Error('Managed skill record changed');
  } });
  return 'updated';
}
