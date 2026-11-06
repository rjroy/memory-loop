import { constants, closeSync, fstatSync, lstatSync, openSync, type BigIntStats } from 'node:fs';
import { dirname, join } from 'node:path';
import { openSafeRootSync, sameFileIdentity, type SafeRootSync } from '../safe-fs';
import { ThinkStateError } from './state';

const metadataComponents = ['.memory-loop'] as const;
const databaseComponents = [...metadataComponents, 'application.sqlite'];
const fileFlags = constants.O_RDWR | (constants.O_NONBLOCK ?? 0);
function unavailable(): never { throw new ThinkStateError('unavailable'); }
const absent = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

function regularFile(stat: BigIntStats): void {
  if (!stat.isFile() || stat.nlink !== 1n) unavailable();
}

function checkOutsideVault(directory: string, vault: SafeRootSync): void {
  const vaultIdentity = lstatSync(vault.resolve([], 'directory'), { bigint: true });
  // Compare filesystem objects, not case-folded path spellings: Windows supports
  // both case-sensitive siblings and multiple spellings for the same directory.
  for (let ancestor = directory;;) {
    const entry = lstatSync(ancestor, { bigint: true });
    if (!entry.isDirectory() || sameFileIdentity(entry, vaultIdentity)) unavailable();
    const parent = dirname(ancestor);
    if (parent === ancestor) return;
    ancestor = parent;
  }
}

/** Checks the state namespace outside SQL transactions; not a hostile-writer sandbox. */
export class ThinkStateFile {
  private root?: SafeRootSync;
  private databaseFd?: number;
  private directoryIdentity?: BigIntStats;
  private databaseIdentity?: BigIntStats;
  private databasePath = '';

  constructor(projectRoot: string, vaultDirectory: string) {
    try {
      this.root = openSafeRootSync(projectRoot);
      const directory = this.root.resolve(metadataComponents, 'directory');
      this.directoryIdentity = lstatSync(directory, { bigint: true });
      checkOutsideVault(directory, openSafeRootSync(vaultDirectory));
      this.databasePath = join(directory, 'application.sqlite');
      // Check SQLite's auxiliary names even when the selected journal mode does not use them.
      this.checkSidecars();
      let existing: BigIntStats | undefined;
      try { existing = this.checkFile(databaseComponents); }
      catch (error) {
        if (!absent(error)) throw error;
        this.root.resolve(databaseComponents, 'missing');
      }
      // A native write-capable, nontruncating handle pins the database's identity.
      // SQLite itself uses the stable ordinary path, not a platform-specific fd path.
      this.databaseFd = openSync(this.path, fileFlags | (existing ? 0 : constants.O_CREAT | constants.O_EXCL), 0o600);
      this.databaseIdentity = fstatSync(this.databaseFd, { bigint: true });
      if (existing && !sameFileIdentity(existing, this.databaseIdentity)) unavailable();
      this.validate();
    } catch {
      try { this.close(); } finally { unavailable(); }
    }
  }

  get path(): string {
    if (!this.root || !this.directoryIdentity) unavailable();
    return this.databasePath;
  }

  private checkDirectory(): void {
    if (!this.root || !this.directoryIdentity) unavailable();
    const directory = lstatSync(this.root.resolve(metadataComponents, 'directory'), { bigint: true });
    if (!directory.isDirectory() || !sameFileIdentity(directory, this.directoryIdentity)) unavailable();
  }

  private checkFile(components: readonly string[]): BigIntStats {
    if (!this.root) unavailable();
    const stat = lstatSync(this.root.resolve(components, 'file'), { bigint: true });
    regularFile(stat);
    return stat;
  }

  private checkSidecars(): void {
    for (const suffix of ['-journal', '-wal', '-shm']) {
      const components = [...metadataComponents, `application.sqlite${suffix}`];
      let named: BigIntStats;
      try { named = this.checkFile(components); }
      catch (error) { if (absent(error)) continue; throw error; }
      let fd: number | undefined;
      try {
        fd = openSync(`${this.path}${suffix}`, fileFlags);
        const held = fstatSync(fd, { bigint: true });
        regularFile(held);
        if (!sameFileIdentity(named, held) || !sameFileIdentity(this.checkFile(components), held)) unavailable();
      }
      finally { if (fd !== undefined) closeSync(fd); }
    }
  }

  validate(): void {
    try {
      if (this.databaseFd === undefined || !this.databaseIdentity) unavailable();
      this.checkDirectory();
      const named = this.checkFile(databaseComponents);
      const held = fstatSync(this.databaseFd, { bigint: true });
      regularFile(held);
      if (!sameFileIdentity(named, this.databaseIdentity) || !sameFileIdentity(held, this.databaseIdentity)) unavailable();
      this.checkSidecars();
      this.checkDirectory();
    } catch { unavailable(); }
  }

  syncDirectory(): void {
    this.validate();
    try {
      if (!this.root) unavailable();
      this.root.syncDirectory(metadataComponents);
      this.validate();
    } catch { unavailable(); }
  }

  close(): void {
    const fd = this.databaseFd;
    this.databaseFd = undefined;
    this.root = undefined;
    if (fd !== undefined) try { closeSync(fd); } catch { unavailable(); }
  }
}
