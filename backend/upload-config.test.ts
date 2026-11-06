import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config';

let fixture: string;
let vault: string;
beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'j21-upload-config-'));
  vault = join(fixture, 'vault');
  await mkdir(vault);
  await mkdir(join(fixture, '.memory-loop'));
});
afterEach(async () => { if (fixture) await rm(fixture, { recursive: true, force: true }); });
async function config(recall: unknown) {
  await writeFile(join(fixture, '.memory-loop', 'config.json'), JSON.stringify({ vaultDirectory: vault, recall }));
  return loadConfig(fixture);
}

it('retains an explicitly configured upload limit', async () => {
  await expect(config({ uploads: { maxFileBytes: 17 } })).resolves.toMatchObject({ vaultDirectory: vault, recall: { uploads: { maxFileBytes: 17 } } });
});
it.each([0, -1, 1.5, 1024 * 1024 * 1024 + 1, '17', null])('rejects invalid maxFileBytes %o', async maxFileBytes => {
  await expect(config({ uploads: { maxFileBytes } })).rejects.toMatchObject({ code: 'config_invalid' });
});
it('accepts the exact 1 GiB hard maximum', async () => {
  await expect(config({ uploads: { maxFileBytes: 1024 * 1024 * 1024 } })).resolves.toMatchObject({ recall: { uploads: { maxFileBytes: 1024 * 1024 * 1024 } } });
});
