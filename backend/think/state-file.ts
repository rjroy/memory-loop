import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, realpathSync, type Stats } from 'node:fs';
import { isAbsolute, join, normalize, relative, sep } from 'node:path';
import { ThinkStateError } from './state';

const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fileFlags = constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;
function unavailable(): never { throw new ThinkStateError('unavailable'); }
const absent = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

function privateStat(stat: Stats, directory: boolean): void {
  if (!process.getuid || stat.uid !== process.getuid() ||
      (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) ||
      (stat.mode & 0o7777) !== (directory ? 0o700 : 0o600)) unavailable();
}

/** Pins the private namespace; validation is outside SQL transactions, never a vault sandbox. */
export class ThinkStateFile {
  private rootFd?: number;
  private directoryFd?: number;
  private databaseFd?: number;
  private rootIdentity?: Stats;
  private directoryIdentity?: Stats;
  private databaseIdentity?: Stats;
  private root = '';
  private directoryName = '';

  constructor(projectRoot: string, vaultDirectory: string) {
    try {
      if (process.platform !== 'linux' || !process.getuid || !isAbsolute(projectRoot) ||
          normalize(projectRoot) !== projectRoot || projectRoot.includes('\0')) unavailable();
      this.root = realpathSync(projectRoot);
      const directory = join(this.root, '.memory-loop');
      const fromVault = relative(realpathSync(vaultDirectory), directory);
      if (fromVault === '' || fromVault !== '..' && !fromVault.startsWith(`..${sep}`) && !isAbsolute(fromVault)) unavailable();
      this.rootFd = openSync(this.root, directoryFlags);
      this.rootIdentity = fstatSync(this.rootFd);
      this.directoryName = `/proc/self/fd/${this.rootFd}/.memory-loop`;
      this.directoryFd = openSync(this.directoryName, directoryFlags);
      this.directoryIdentity = fstatSync(this.directoryFd);
      privateStat(this.directoryIdentity, true);
      // Check SQLite's auxiliary names even when the selected journal mode does not use them.
      this.checkSidecars();
      try { this.databaseFd = openSync(this.path, fileFlags); }
      catch (error) {
        if (!absent(error)) throw error;
        this.databaseFd = openSync(this.path, fileFlags | constants.O_CREAT | constants.O_EXCL, 0o600);
      }
      this.databaseIdentity = fstatSync(this.databaseFd);
      this.validate();
    } catch {
      try { this.close(); } finally { unavailable(); }
    }
  }

  get path(): string {
    if (this.directoryFd === undefined) unavailable();
    return `/proc/self/fd/${this.directoryFd}/application.sqlite`;
  }

  private checkSidecars(): void {
    for (const suffix of ['-journal', '-wal', '-shm']) {
      const path = `${this.path}${suffix}`;
      let fd: number | undefined;
      try {
        const named = lstatSync(path);
        privateStat(named, false);
        fd = openSync(path, fileFlags);
        const held = fstatSync(fd);
        privateStat(held, false);
        if (!same(named, held)) unavailable();
      } catch (error) { if (!absent(error)) throw error; }
      finally { if (fd !== undefined) closeSync(fd); }
    }
  }

  validate(): void {
    if (this.rootFd === undefined || this.directoryFd === undefined || this.databaseFd === undefined ||
        !this.rootIdentity || !this.directoryIdentity || !this.databaseIdentity) unavailable();
    const root = lstatSync(this.root);
    const directory = lstatSync(this.directoryName);
    const heldDirectory = fstatSync(this.directoryFd);
    const named = lstatSync(this.path);
    const held = fstatSync(this.databaseFd);
    if (!root.isDirectory() || !same(root, this.rootIdentity) || !same(fstatSync(this.rootFd), this.rootIdentity) ||
        !same(directory, this.directoryIdentity) || !same(heldDirectory, this.directoryIdentity) ||
        !same(named, this.databaseIdentity) || !same(held, this.databaseIdentity)) unavailable();
    privateStat(directory, true); privateStat(heldDirectory, true);
    privateStat(named, false); privateStat(held, false);
    this.checkSidecars();
  }

  syncDirectory(): void {
    this.validate();
    if (this.directoryFd === undefined) unavailable();
    fsyncSync(this.directoryFd);
  }

  close(): void {
    let failed = false;
    for (const key of ['databaseFd', 'directoryFd', 'rootFd'] as const) {
      const fd = this[key];
      this[key] = undefined;
      if (fd !== undefined) try { closeSync(fd); } catch { failed = true; }
    }
    if (failed) unavailable();
  }
}
