/** Linux/glibc only. Bun's FFI is experimental; no copy/delete or replacing fallback. */
export async function renameNoReplace(sourceParentFd: number, sourceName: string, destinationParentFd: number, destinationName: string): Promise<void> {
  if (process.platform !== 'linux' || !('Bun' in globalThis)) throw Object.assign(new Error('Unsupported runtime'), { code: 'ENOTSUP' });
  let ffi: typeof import('bun:ffi');
  try { ffi = await import('bun:ffi'); } catch { throw Object.assign(new Error('FFI unavailable'), { code: 'ENOTSUP' }); }
  let libc: ReturnType<typeof ffi.dlopen<{ renameat2: { args: ['i32', 'buffer', 'i32', 'buffer', 'u32']; returns: 'i32' }; __errno_location: { args: []; returns: 'ptr' } }>>;
  try {
    libc = ffi.dlopen('libc.so.6', { renameat2: { args: ['i32', 'buffer', 'i32', 'buffer', 'u32'], returns: 'i32' }, __errno_location: { args: [], returns: 'ptr' } });
  } catch { throw Object.assign(new Error('renameat2 unavailable'), { code: 'ENOTSUP' }); }
  try {
    const errnoPointer = libc.symbols.__errno_location();
    if (errnoPointer === null) throw Object.assign(new Error('errno unavailable'), { code: 'ENOTSUP' });
    const source = Buffer.from(`${sourceName}\0`);
    const destination = Buffer.from(`${destinationName}\0`);
    const result = libc.symbols.renameat2(sourceParentFd, source, destinationParentFd, destination, 1);
    const errno = result === -1 ? ffi.read.i32(errnoPointer) : 0;
    if (result !== 0) {
      const code = ({ 2: 'ENOENT', 17: 'EEXIST', 18: 'EXDEV', 20: 'ENOTDIR', 22: 'EINVAL', 38: 'ENOSYS', 39: 'ENOTEMPTY', 95: 'ENOTSUP' } as Record<number, string>)[errno] ?? 'EIO';
      throw Object.assign(new Error('renameat2 failed'), { code });
    }
  } finally { libc.close(); }
}
