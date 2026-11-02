import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';

const suffix = '/@opencode+cli@2.2.2/node_modules/@opencode/cli/bin/opencode.exe';
async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function preflightExecutable(executable: string): Promise<void> {
  if (process.platform !== 'linux' || process.arch !== 'x64' || !isAbsolute(executable) || normalize(executable) !== executable || executable.includes('\0') || !executable.endsWith(suffix)) throw new Error('invalid native binary selector');
  const install = executable.slice(0, -suffix.length);
  const cli = join(install, '@opencode+cli@2.2.2/node_modules/@opencode/cli');
  const platform = join(install, '@opencode+cli-linux-x64@2.2.2/node_modules/@opencode/cli-linux-x64');
  const binary = join(platform, 'bin/opencode');
  for (const path of [cli, platform, executable, binary, join(cli, 'package.json'), join(platform, 'package.json')]) {
    if (await realpath(path) !== path) throw new Error('native installation contains a symlink');
  }
  const [cliStat, platformStat, cliRaw, platformRaw] = await Promise.all([lstat(executable), lstat(binary), readFile(join(cli, 'package.json'), 'utf8'), readFile(join(platform, 'package.json'), 'utf8')]);
  if (!cliStat.isFile() || !platformStat.isFile() || !(cliStat.mode & 0o111) || !(platformStat.mode & 0o111)) throw new Error('native executable is not an executable regular file');
  const file = await open(executable, 'r');
  try {
    const signature = Buffer.alloc(4);
    const { bytesRead } = await file.read(signature, 0, 4, 0);
    if (bytesRead !== 4 || !signature.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) throw new Error('native executable is not ELF');
  } finally { await file.close(); }
  const c: unknown = JSON.parse(cliRaw);
  const p: unknown = JSON.parse(platformRaw);
  if (typeof c !== 'object' || c === null || !('name' in c) || c.name !== '@opencode/cli' || !('version' in c) || c.version !== '2.2.2' ||
      typeof p !== 'object' || p === null || !('name' in p) || p.name !== '@opencode/cli-linux-x64' || !('version' in p) || p.version !== '2.2.2') throw new Error('native package metadata mismatch');
  if ((cliStat.dev !== platformStat.dev || cliStat.ino !== platformStat.ino) && await hashFile(executable) !== await hashFile(binary)) throw new Error('native binary does not match installed platform package');
}
